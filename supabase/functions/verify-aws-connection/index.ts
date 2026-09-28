import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { verifyAuth, jsonResponse, validateInput, getCorsHeaders, getSecurityHeaders } from "../_shared/security.ts";

const enc = new TextEncoder();
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const keyData = key instanceof ArrayBuffer ? key : new Uint8Array(key).slice().buffer;
  const k = await crypto.subtle.importKey("raw", keyData, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
async function sha256Hex(data: string): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", enc.encode(data));
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function stsCall(body: string, ak: string, sk: string, st?: string): Promise<string> {
  const host = "sts.amazonaws.com";
  const region = "us-east-1";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "content-type": "application/x-www-form-urlencoded; charset=utf-8",
    ...(st ? { "x-amz-security-token": st } : {}),
  };
  const sortedKeys = Object.keys(headers).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headers[k].trim()}`).join("\n") + "\n";
  const signedHeaders = sortedKeys.join(";");
  const payloadHash = await sha256Hex(body);
  const canonicalRequest = ["POST", "/", "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credScope = `${dateStamp}/${region}/sts/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + sk), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "sts");
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  headers["authorization"] = `AWS4-HMAC-SHA256 Credential=${ak}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const r = await fetch(`https://${host}/`, { method: "POST", headers, body });
  const text = await r.text();
  if (!r.ok) throw new Error(text);
  return text;
}
function xmlOne(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

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
    });
    
    if (!validation.valid) {
      return jsonResponse({ error: validation.error }, 400, origin);
    }
    
    const { connection_id } = body;
    
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", connection_id).eq("user_id", user.id).single();
    if (!conn) return jsonResponse({ error: "connection not found" }, 404, origin);

    try {
      if (!conn.access_key_id || !conn.secret_access_key) {
        return jsonResponse({ ok: false, error: "Connection has no access keys configured" }, 200, origin);
      }
      // GetCallerIdentity with the user's stored access keys
      const idXml = await stsCall("Action=GetCallerIdentity&Version=2011-06-15", conn.access_key_id, conn.secret_access_key);
      const account = xmlOne(idXml, "Account");
      const arn = xmlOne(idXml, "Arn");

      await admin.from("aws_connections").update({
        verification_status: "verified",
        last_verified_at: new Date().toISOString(),
        aws_account_id: account,
      }).eq("id", connection_id);
      return jsonResponse({ ok: true, arn, account }, 200, origin);
    } catch (e: any) {
      await admin.from("aws_connections").update({
        verification_status: "failed",
        last_verified_at: new Date().toISOString(),
      }).eq("id", connection_id);
      return jsonResponse({ ok: false, error: e.message ?? String(e) }, 200, origin);
    }
  } catch (e: any) {
    console.error("verify-aws-connection error:", e.message);
    return jsonResponse({ error: "Internal server error" }, 500, origin);
  }
});