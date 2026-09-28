import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyAuth, jsonResponse, validateInput, getCorsHeaders, getSecurityHeaders } from "../_shared/security.ts";

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
    
    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", connection_id).eq("user_id", user.id).single();
    if (!conn) return jsonResponse({ error: "connection not found" }, 404, origin);

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
    }).catch((e) => console.error("pipeline kickoff failed", e));

    return jsonResponse({ audit_id: audit.id }, 200, origin);
  } catch (e: any) {
    console.error("start-audit error:", e.message);
    return jsonResponse({ error: "Internal server error" }, 500, origin);
  }
});