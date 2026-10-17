import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyAuth, jsonResponse, validateInput, getCorsHeaders, getSecurityHeaders, enforceRateLimit, redactSecrets } from "../_shared/security.ts";
import { verifyConnectionOwnership } from "../_shared/authorization.ts";

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const corsHeaders = getCorsHeaders(origin);
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { ...corsHeaders, ...getSecurityHeaders() } });
  }

  try {
    // Verify authentication
    const auth = await verifyAuth(req);
    if (!auth) {
      return jsonResponse({ error: "unauthenticated" }, 401, origin);
    }
    const { user } = auth;

    // Rate limiting for expensive AWS audit operations
    const rateLimitResponse = await enforceRateLimit(req, user.id, origin, {
      maxPerUser: 30, // 30 audits per hour per user
      maxPerIP: 50,   // 50 per hour per IP
      windowMs: 3600000, // 1 hour
    });
    if (rateLimitResponse) return rateLimitResponse;

    // Parse and validate input
    const body = await req.json().catch(() => ({}));
    const validation = validateInput(body, {
      connection_id: { type: "string", required: true },
      services: { type: "array", required: true },
    });
    
    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400, origin);
    }
    
    const { connection_id, services } = body;
    
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);
    
    // Server-side authorization: verify connection ownership
    const authCheck = await verifyConnectionOwnership(admin, connection_id, user.id);
    if (!authCheck.authorized) {
      await admin.rpc("log_audit_action", {
        p_user_id: user.id,
        p_action: "start_audit_unauthorized",
        p_resource_type: "aws_connection",
        p_resource_id: connection_id,
        p_details: { reason: "ownership_verification_failed" },
        p_success: false,
      });
      return jsonResponse({ error: "connection not found" }, 404, origin);
    }
    const conn = authCheck.connection;

    const { data: audit, error } = await admin.from("audits").insert({
      user_id: user.id,
      connection_id,
      status: "queued",
      scope: { services },
    }).select().single();
    if (error) return jsonResponse({ error: error.message }, 500, origin);

    // fire-and-forget pipeline
    const pipelineUrl = `${SUPABASE_URL}/functions/v1/run-agent-pipeline`;
    fetch(pipelineUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE}` },
      body: JSON.stringify({ audit_id: audit.id, user_id: user.id }),
    }).catch((e) => console.error("pipeline kickoff failed", redactSecrets(String(e))));

    // Audit log
    await admin.rpc("log_audit_action", {
      p_user_id: user.id,
      p_action: "audit_started",
      p_resource_type: "audit",
      p_resource_id: audit.id,
      p_details: { connection_id, services },
      p_success: true,
    });

    return jsonResponse({ audit_id: audit.id }, 200, origin);
  } catch (e: any) {
    const errorMessage = redactSecrets(e.message || String(e));
    console.error("start-audit error:", errorMessage);
    return jsonResponse({ error: "Internal server error" }, 500, origin);
  }
});