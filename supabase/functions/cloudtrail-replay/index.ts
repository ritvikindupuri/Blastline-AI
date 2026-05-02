import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------- SigV4 ----------------
type Creds = { ak: string; sk: string; st?: string };
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
async function awsRequest(opts: {
  service: string; region: string; host?: string; method?: string;
  path?: string; body?: string; headers?: Record<string, string>; creds: Creds;
}): Promise<Response> {
  const method = opts.method ?? "POST";
  const region = opts.region;
  const host = opts.host ?? `${opts.service}.${region}.amazonaws.com`;
  const path = opts.path ?? "/";
  const body = opts.body ?? "";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = await sha256Hex(body);
  const baseHeaders: Record<string, string> = {
    host, "x-amz-date": amzDate, "x-amz-content-sha256": payloadHash,
    ...(opts.creds.st ? { "x-amz-security-token": opts.creds.st } : {}),
    ...(opts.headers ?? {}),
  };
  if (method !== "GET" && !baseHeaders["content-type"]) baseHeaders["content-type"] = "application/x-amz-json-1.1";
  const sortedKeys = Object.keys(baseHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${baseHeaders[Object.keys(baseHeaders).find((h) => h.toLowerCase() === k)!].trim()}`).join("\n") + "\n";
  const signedHeaders = sortedKeys.join(";");
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credScope = `${dateStamp}/${region}/${opts.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, await sha256Hex(canonicalRequest)].join("\n");
  const kDate = await hmac(enc.encode("AWS4" + opts.creds.sk), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, opts.service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));
  baseHeaders["authorization"] = `AWS4-HMAC-SHA256 Credential=${opts.creds.ak}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return fetch(`https://${host}${path}`, { method, headers: baseHeaders, body: method === "GET" ? undefined : body });
}

// CloudTrail LookupEvents — paginates up to maxPages
async function lookupEvents(region: string, creds: Creds, principalName: string, startISO: string, endISO: string, maxPages = 10): Promise<any[]> {
  const events: any[] = [];
  let token: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const body: any = {
      LookupAttributes: [{ AttributeKey: "Username", AttributeValue: principalName }],
      StartTime: Math.floor(new Date(startISO).getTime() / 1000),
      EndTime: Math.floor(new Date(endISO).getTime() / 1000),
      MaxResults: 50,
    };
    if (token) body.NextToken = token;
    const r = await awsRequest({
      service: "cloudtrail", region, body: JSON.stringify(body), creds,
      headers: { "x-amz-target": "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents" },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`CloudTrail LookupEvents failed: ${JSON.stringify(j).slice(0, 300)}`);
    const page = (j.Events ?? []) as any[];
    events.push(...page);
    token = j.NextToken;
    if (!token || page.length === 0) break;
  }
  return events;
}

// Pull principal short name from ARN (last path segment)
function principalShortName(arn: string): string {
  const segs = arn.split("/");
  return segs[segs.length - 1] || arn;
}

// AI behavioral analysis via Lovable AI
async function aiAnalyze(principalArn: string, topApis: any[], rawSample: any[], windowDays: number): Promise<{ summary: string; anomalies: any[]; risk: number; explanation: string }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { summary: "AI key not configured", anomalies: [], risk: 0, explanation: "" };
  const prompt = `You are a senior AWS detection engineer reviewing real CloudTrail activity for an IAM principal.

Principal: ${principalArn}
Window: last ${windowDays} days
Top APIs called (api -> count): ${JSON.stringify(topApis.slice(0, 25))}
Sample of recent events (eventName, eventTime, sourceIPAddress, userAgent, errorCode):
${JSON.stringify(rawSample.slice(0, 30).map((e: any) => ({
  ev: e.EventName, t: e.EventTime, src: e.CloudTrailEvent ? (() => { try { return JSON.parse(e.CloudTrailEvent)?.sourceIPAddress; } catch { return null; } })() : null,
  err: e.CloudTrailEvent ? (() => { try { return JSON.parse(e.CloudTrailEvent)?.errorCode; } catch { return null; } })() : null,
})))}

Return STRICT JSON: {
  "summary": "1-paragraph behavioral profile",
  "risk": 0-100,
  "explanation": "A brief explanation of why this principal was chosen and which signals drove the risk score",
  "anomalies": [{"title": "...", "severity": "low|medium|high|critical", "evidence": "..."}]
}.
Look for: privilege escalation patterns (iam:Put*, sts:AssumeRole chains), data exfil (s3:Get* spikes), recon (Describe/List bursts), failed auth, unusual source IPs, off-hours activity, dormant principals suddenly active.`;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) {
    const txt = await r.text();
    return { summary: `AI analysis failed: ${txt.slice(0, 200)}`, anomalies: [], risk: 0, explanation: "" };
  }
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content ?? "{}";
  try {
    const parsed = JSON.parse(content);
    return { summary: parsed.summary ?? "", anomalies: parsed.anomalies ?? [], risk: Number(parsed.risk) || 0, explanation: parsed.explanation ?? "" };
  } catch {
    return { summary: content.slice(0, 500), anomalies: [], risk: 0, explanation: "" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { connection_id, principal_arn, days } = await req.json();
    if (!connection_id || !principal_arn) return json({ error: "connection_id and principal_arn required" }, 400);
    const windowDays = Math.min(90, Math.max(1, Number(days) || 90));

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", connection_id).eq("user_id", user.id).single();
    if (!conn) return json({ error: "connection not found" }, 404);
    if (!conn.access_key_id || !conn.secret_access_key) return json({ error: "connection has no access keys" }, 400);

    const creds: Creds = { ak: conn.access_key_id, sk: conn.secret_access_key };
    const region = conn.default_region || "us-east-1";
    const end = new Date();
    const start = new Date(end.getTime() - windowDays * 24 * 3600 * 1000);
    const principalName = principalShortName(principal_arn);

    const events = await lookupEvents(region, creds, principalName, start.toISOString(), end.toISOString(), 10);

    // Aggregate top APIs
    const apiCounts: Record<string, number> = {};
    for (const e of events) apiCounts[e.EventName ?? "unknown"] = (apiCounts[e.EventName ?? "unknown"] ?? 0) + 1;
    const topApis = Object.entries(apiCounts).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([api, count]) => ({ api, count }));
    const rawSample = events.slice(0, 30);

    // Build timeline: Group by day, then by service
    const timelineData: Record<string, Record<string, number>> = {};
    for (const e of events) {
      if (!e.EventTime) continue;
      // Truncate to day "YYYY-MM-DD"
      const day = e.EventTime.slice(0, 10);
      const service = e.EventSource?.split(".")[0] || "unknown";
      if (!timelineData[day]) timelineData[day] = {};
      timelineData[day][service] = (timelineData[day][service] || 0) + 1;
    }
    const timeline = Object.entries(timelineData).sort((a, b) => a[0].localeCompare(b[0])).map(([date, services]) => {
      const point: any = { date };
      let total = 0;
      for (const [s, c] of Object.entries(services)) {
        point[s] = c;
        total += c;
      }
      point.total = total;
      return point;
    });

    const analysis = await aiAnalyze(principal_arn, topApis, rawSample, windowDays);

    const { data: row, error: insErr } = await admin.from("principal_replays").insert({
      user_id: user.id, connection_id, principal_arn,
      account_id: conn.aws_account_id, region,
      window_start: start.toISOString(), window_end: end.toISOString(),
      event_count: events.length, top_apis: topApis, anomalies: analysis.anomalies,
      ai_summary: analysis.summary, ai_risk_score: analysis.risk,
      ai_explanation: analysis.explanation, timeline,
      raw_sample: rawSample, status: "completed",
    }).select().single();
    if (insErr) throw insErr;

    return json({ ok: true, replay: row });
  } catch (e: any) {
    console.error("cloudtrail-replay error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}