import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ============================================================
// SigV4 — same shape as list-aws-resources
// ============================================================
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
  path?: string; query?: Record<string, string>; body?: string;
  headers?: Record<string, string>; creds: Creds;
}): Promise<Response> {
  const method = opts.method ?? "POST";
  const service = opts.service;
  const region = opts.region;
  const host = opts.host ?? `${service}.${region}.amazonaws.com`;
  const path = opts.path ?? "/";
  const body = opts.body ?? "";
  const queryStr = opts.query
    ? Object.keys(opts.query).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(opts.query![k])}`).join("&")
    : "";

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const payloadHash = await sha256Hex(body);
  const baseHeaders: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    "x-amz-content-sha256": payloadHash,
    ...(opts.creds.st ? { "x-amz-security-token": opts.creds.st } : {}),
    ...(opts.headers ?? {}),
  };
  if (method !== "GET" && !baseHeaders["content-type"]) {
    baseHeaders["content-type"] = "application/x-www-form-urlencoded; charset=utf-8";
  }

  const sortedHeaderKeys = Object.keys(baseHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${baseHeaders[Object.keys(baseHeaders).find((h) => h.toLowerCase() === k)!].trim()}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [method, path, queryStr, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credScope, await sha256Hex(canonicalRequest)].join("\n");

  const kDate = await hmac(enc.encode("AWS4" + opts.creds.sk), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, service);
  const kSigning = await hmac(kService, "aws4_request");
  const signature = hex(await hmac(kSigning, stringToSign));

  baseHeaders["authorization"] = `AWS4-HMAC-SHA256 Credential=${opts.creds.ak}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const url = `https://${host}${path}${queryStr ? "?" + queryStr : ""}`;
  return fetch(url, { method, headers: baseHeaders, body: method === "GET" ? undefined : body });
}

// ============================================================
// Action plan executor — supports the most common AWS hardening verbs
// ============================================================
type Action = {
  id: string;
  description: string;
  service: "s3" | "iam" | "ec2" | "rds" | "kms" | "logs" | "cloudtrail" | "lambda" | "secretsmanager" | "guardduty";
  api: string; // e.g. PutBucketPublicAccessBlock
  region?: string;
  params: Record<string, any>;
  console_url?: string;
};

type ExecResult = {
  action: Action;
  ok: boolean;
  status?: number;
  response?: string;
  error?: string;
};

function prettyAwsResponse(raw: string): string {
  const t = raw.trim();
  if (!t) return "(empty)";
  // JSON
  if (t.startsWith("{") || t.startsWith("[")) {
    try { return JSON.stringify(JSON.parse(t), null, 2); } catch { /* fallthrough */ }
  }
  // XML — pretty-print with simple indentation
  if (t.startsWith("<")) {
    const withBreaks = t.replace(/></g, ">\n<");
    const lines = withBreaks.split("\n");
    let depth = 0;
    const out: string[] = [];
    for (const ln of lines) {
      const isClose = /^<\//.test(ln);
      const isSelfOrDecl = /\/>$/.test(ln) || /^<\?/.test(ln) || /^<!/.test(ln);
      if (isClose) depth = Math.max(0, depth - 1);
      out.push("  ".repeat(depth) + ln);
      if (!isClose && !isSelfOrDecl && /^<[^/!?]/.test(ln) && !/<\/[^>]+>\s*$/.test(ln)) depth++;
    }
    return out.join("\n");
  }
  return t;
}

function consoleUrlFor(action: Action, region: string): string {
  const r = action.region || region;
  const p = action.params || {};
  switch (action.service) {
    case "iam":
      if (p.UserName) return `https://console.aws.amazon.com/iam/home#/users/details/${encodeURIComponent(p.UserName)}`;
      if (p.RoleName) return `https://console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(p.RoleName)}`;
      if (action.api.includes("PasswordPolicy")) return "https://console.aws.amazon.com/iam/home#/account_settings";
      return "https://console.aws.amazon.com/iam/home#/home";
    case "s3":
      if (p.Bucket) return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(p.Bucket)}?region=${r}&tab=permissions`;
      return "https://s3.console.aws.amazon.com/s3/home";
    case "ec2":
      if (p.GroupId) return `https://console.aws.amazon.com/ec2/home?region=${r}#SecurityGroup:groupId=${p.GroupId}`;
      return `https://console.aws.amazon.com/ec2/home?region=${r}`;
    case "rds":
      if (p.DBInstanceIdentifier) return `https://console.aws.amazon.com/rds/home?region=${r}#database:id=${p.DBInstanceIdentifier};is-cluster=false`;
      return `https://console.aws.amazon.com/rds/home?region=${r}#databases:`;
    case "kms":
      if (p.KeyId) return `https://console.aws.amazon.com/kms/home?region=${r}#/kms/keys/${p.KeyId}`;
      return `https://console.aws.amazon.com/kms/home?region=${r}`;
    case "logs":
      return `https://console.aws.amazon.com/cloudwatch/home?region=${r}#logsV2:log-groups`;
    case "cloudtrail":
      return `https://console.aws.amazon.com/cloudtrailv2/home?region=${r}#/dashboard`;
    case "lambda":
      if (p.FunctionName) return `https://console.aws.amazon.com/lambda/home?region=${r}#/functions/${encodeURIComponent(p.FunctionName)}`;
      return `https://console.aws.amazon.com/lambda/home?region=${r}#/functions`;
    case "secretsmanager":
      return `https://console.aws.amazon.com/secretsmanager/listsecrets?region=${r}`;
    case "guardduty":
      return `https://console.aws.amazon.com/guardduty/home?region=${r}#/findings`;
  }
}

async function execAction(a: Action, defaultRegion: string, creds: Creds): Promise<ExecResult> {
  const region = a.region || defaultRegion;
  try {
    let resp: Response;
    switch (a.service) {
      // ---------- IAM (query API) ----------
      case "iam": {
        const params: Record<string, string> = { Action: a.api, Version: "2010-05-08" };
        for (const [k, v] of Object.entries(a.params || {})) {
          if (v === undefined || v === null) continue;
          if (typeof v === "boolean") params[k] = v ? "true" : "false";
          else params[k] = String(v);
        }
        const body = new URLSearchParams(params).toString();
        resp = await awsRequest({ service: "iam", region: "us-east-1", host: "iam.amazonaws.com", method: "POST", body, creds });
        break;
      }

      // ---------- S3 ----------
      case "s3": {
        const bucket = a.params?.Bucket;
        if (!bucket) throw new Error("S3 action requires Bucket param");
        const host = `${bucket}.s3.${region}.amazonaws.com`;
        if (a.api === "PutBucketPublicAccessBlock") {
          const xml = `<?xml version="1.0" encoding="UTF-8"?><PublicAccessBlockConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><BlockPublicAcls>true</BlockPublicAcls><IgnorePublicAcls>true</IgnorePublicAcls><BlockPublicPolicy>true</BlockPublicPolicy><RestrictPublicBuckets>true</RestrictPublicBuckets></PublicAccessBlockConfiguration>`;
          resp = await awsRequest({ service: "s3", region, host, method: "PUT", path: "/?publicAccessBlock", body: xml, headers: { "content-type": "application/xml" }, creds });
        } else if (a.api === "PutBucketEncryption") {
          const xml = `<?xml version="1.0" encoding="UTF-8"?><ServerSideEncryptionConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Rule><ApplyServerSideEncryptionByDefault><SSEAlgorithm>AES256</SSEAlgorithm></ApplyServerSideEncryptionByDefault><BucketKeyEnabled>true</BucketKeyEnabled></Rule></ServerSideEncryptionConfiguration>`;
          resp = await awsRequest({ service: "s3", region, host, method: "PUT", path: "/?encryption", body: xml, headers: { "content-type": "application/xml" }, creds });
        } else if (a.api === "PutBucketVersioning") {
          const xml = `<?xml version="1.0" encoding="UTF-8"?><VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>`;
          resp = await awsRequest({ service: "s3", region, host, method: "PUT", path: "/?versioning", body: xml, headers: { "content-type": "application/xml" }, creds });
        } else if (a.api === "PutBucketLogging") {
          const target = a.params?.TargetBucket || bucket;
          const xml = `<?xml version="1.0" encoding="UTF-8"?><BucketLoggingStatus xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><LoggingEnabled><TargetBucket>${target}</TargetBucket><TargetPrefix>logs/${bucket}/</TargetPrefix></LoggingEnabled></BucketLoggingStatus>`;
          resp = await awsRequest({ service: "s3", region, host, method: "PUT", path: "/?logging", body: xml, headers: { "content-type": "application/xml" }, creds });
        } else {
          throw new Error(`Unsupported S3 action: ${a.api}`);
        }
        break;
      }

      // ---------- EC2 (query API) ----------
      case "ec2": {
        const params: Record<string, string> = { Action: a.api, Version: "2016-11-15" };
        const flatten = (obj: any, prefix = "") => {
          for (const [k, v] of Object.entries(obj)) {
            const key = prefix ? `${prefix}.${k}` : k;
            if (Array.isArray(v)) v.forEach((item, i) => {
              if (typeof item === "object") flatten(item, `${key}.${i + 1}`);
              else params[`${key}.${i + 1}`] = String(item);
            });
            else if (typeof v === "object" && v !== null) flatten(v, key);
            else if (v !== undefined && v !== null) params[key] = String(v);
          }
        };
        flatten(a.params || {});
        const body = new URLSearchParams(params).toString();
        resp = await awsRequest({ service: "ec2", region, method: "POST", body, creds });
        break;
      }

      // ---------- RDS (query API) ----------
      case "rds": {
        const params: Record<string, string> = { Action: a.api, Version: "2014-10-31" };
        for (const [k, v] of Object.entries(a.params || {})) {
          if (v === undefined || v === null) continue;
          params[k] = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
        }
        const body = new URLSearchParams(params).toString();
        resp = await awsRequest({ service: "rds", region, method: "POST", body, creds });
        break;
      }

      // ---------- KMS (JSON 1.1) ----------
      case "kms": {
        const body = JSON.stringify(a.params || {});
        resp = await awsRequest({
          service: "kms", region, method: "POST", body,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `TrentService.${a.api}` },
          creds,
        });
        break;
      }

      // ---------- CloudWatch Logs ----------
      case "logs": {
        const body = JSON.stringify(a.params || {});
        resp = await awsRequest({
          service: "logs", region, method: "POST", body,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `Logs_20140328.${a.api}` },
          creds,
        });
        break;
      }

      // ---------- CloudTrail ----------
      case "cloudtrail": {
        const body = JSON.stringify(a.params || {});
        resp = await awsRequest({
          service: "cloudtrail", region, method: "POST", body,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `CloudTrail_20131101.${a.api}` },
          creds,
        });
        break;
      }

      // ---------- Lambda (REST) ----------
      case "lambda": {
        // not all Lambda APIs are JSON; for simple updates we expose UpdateFunctionConfiguration via PUT
        const fn = a.params?.FunctionName;
        if (!fn) throw new Error("Lambda action requires FunctionName");
        const body = JSON.stringify(a.params || {});
        resp = await awsRequest({
          service: "lambda", region, method: "PUT",
          path: `/2015-03-31/functions/${encodeURIComponent(fn)}/configuration`,
          body, headers: { "content-type": "application/json" }, creds,
        });
        break;
      }

      // ---------- Secrets Manager ----------
      case "secretsmanager": {
        const body = JSON.stringify(a.params || {});
        resp = await awsRequest({
          service: "secretsmanager", region, method: "POST", body,
          headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `secretsmanager.${a.api}` },
          creds,
        });
        break;
      }

      // ---------- GuardDuty (REST JSON) ----------
      case "guardduty": {
        const detectorId = a.params?.DetectorId || a.params?.detectorId;
        if (a.api !== "CreateDetector" && !detectorId) throw new Error("GuardDuty action requires DetectorId param");
        const gdParams = { ...(a.params || {}) };
        delete gdParams.DetectorId;
        delete gdParams.detectorId;
        const body = JSON.stringify(gdParams);
        const path = a.api === "CreateDetector" ? "/detector" : `/detector/${encodeURIComponent(detectorId)}`;
        const method = a.api === "CreateDetector" ? "POST" : a.api === "GetDetector" ? "GET" : "POST";
        resp = await awsRequest({ service: "guardduty", region, method, path, body: method === "GET" ? "" : body, headers: { "content-type": "application/json" }, creds });
        break;
      }
    }

    const text = await resp!.text().catch((err) => `Could not read AWS response body: ${err?.message ?? String(err)}`);
    return { action: a, ok: resp!.ok, status: resp!.status, response: text.slice(0, 8000), error: resp!.ok ? undefined : prettyAwsResponse(text).slice(0, 1500) };
  } catch (e: any) {
    return { action: a, ok: false, error: e?.message ?? String(e) };
  }
}

// ============================================================
// AI planner — translates a remediation snippet into Action[]
// ============================================================
async function planActions(snippet: string, finding: any): Promise<{ actions: Action[]; reason?: string; raw?: string }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const system = `You are an AWS remediation planner. Convert a Terraform/CloudFormation/CLI snippet (or a natural-language fix) into a JSON plan of concrete AWS API calls that, when executed, will apply the security fix.

Return STRICT JSON: {"actions":[{"id":"a1","description":"...","service":"iam|s3|ec2|rds|kms|logs|cloudtrail|lambda|secretsmanager","api":"<AWS API name>","region":"us-east-1","params":{...}}]}

Rules:
- Use ONLY these services: iam, s3, ec2, rds, kms, logs, cloudtrail, lambda, secretsmanager.
- Use exact AWS API names: UpdateAccountPasswordPolicy, PutBucketPublicAccessBlock, PutBucketEncryption, PutBucketVersioning, RevokeSecurityGroupIngress, AuthorizeSecurityGroupIngress, ModifyDBInstance, EnableKeyRotation, PutRetentionPolicy, UpdateTrail, StartLogging, etc.
- Params must use AWS API param names exactly (PascalCase as in AWS docs).
- For IAM password policy, use UpdateAccountPasswordPolicy with full required fields.
- Prefer the smallest set of idempotent calls (1-3 actions).
- Do NOT create destructive calls (DeleteUser, DeleteBucket, TerminateInstances) unless the snippet explicitly removes a resource.
- ALWAYS try to produce at least one action. Only return empty actions if the snippet is truly nonsensical.
- If the snippet is a natural-language fix (no code), still infer the most likely AWS API call from the finding title and resource ARN.
- If you cannot safely translate, return {"actions":[],"reason":"<why>"}.`;

  const user = `Finding: ${finding?.title || ""} (${finding?.check_id || ""})
Service: ${finding?.service || ""} | Region: ${finding?.region || "us-east-1"} | ARN: ${finding?.resource_arn || "(none)"}

Snippet:
\`\`\`
${snippet.slice(0, 8000)}
\`\`\``;

  async function callModel(model: string) {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
      }),
    });
    if (!r.ok) throw new Error(`AI planner failed (${model}): ${r.status} ${(await r.text()).slice(0, 300)}`);
    const j = await r.json();
    const content = j?.choices?.[0]?.message?.content || "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(content); } catch { parsed = {}; }
    const actions: Action[] = (Array.isArray(parsed?.actions) ? parsed.actions : [])
      .filter((a: any) => a && a.service && a.api)
      .slice(0, 8);
    return { actions, reason: parsed?.reason as string | undefined, raw: content };
  }

  // First pass: fast model
  let result = await callModel("google/gemini-2.5-flash");
  console.log(`[planActions] flash → ${result.actions.length} actions${result.reason ? `, reason: ${result.reason}` : ""}`);

  // Retry with a stronger model if empty
  if (result.actions.length === 0) {
    console.log(`[planActions] retrying with gemini-2.5-pro. snippet preview: ${snippet.slice(0, 300)}`);
    try {
      const retry = await callModel("google/gemini-2.5-pro");
      console.log(`[planActions] pro → ${retry.actions.length} actions${retry.reason ? `, reason: ${retry.reason}` : ""}`);
      if (retry.actions.length > 0) return retry;
      result = retry; // keep richer reason
    } catch (e: any) {
      console.error("[planActions] pro retry failed", e?.message);
    }
  }
  return result;
}

// ============================================================
// AI verifier — produces a READ-ONLY check that proves the fix landed
// ============================================================
type Verification = {
  verified: boolean;
  summary: string;
  evidence: Array<{ check: string; service: string; api: string; ok: boolean; status?: number; matched?: boolean; expected?: string; actual_preview?: string; error?: string }>;
};

type CheckPlan = {
  checks: Array<{
    id: string;
    description: string;
    service: Action["service"];
    api: string; // must be a READ-ONLY API (Get*, Describe*, List*)
    region?: string;
    params: Record<string, any>;
    expect: { contains?: string; not_contains?: string; status_ok?: boolean };
  }>;
};

async function planVerification(actions: Action[], finding: any): Promise<CheckPlan> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY not configured");

  const system = `You are an AWS post-remediation verifier. Given a list of WRITE actions just executed, produce a list of READ-ONLY AWS API calls that prove the change landed.

Return STRICT JSON: {"checks":[{"id":"v1","description":"...","service":"iam|s3|ec2|rds|kms|logs|cloudtrail|lambda|secretsmanager","api":"<Read API>","region":"...","params":{...},"expect":{"contains":"<substring that must appear in response>","not_contains":"<substring that must NOT appear>","status_ok":true}}]}

Rules:
- Use ONLY read APIs: GetAccountPasswordPolicy, GetBucketPublicAccessBlock, GetBucketEncryption, GetBucketVersioning, DescribeSecurityGroups, DescribeDBInstances, GetKeyRotationStatus, DescribeLogGroups, GetTrailStatus, GetTrail, GetFunctionConfiguration, etc.
- Match each WRITE action with a verifying READ. 1 check per write action.
- "contains" should be a string from the AWS response that PROVES the fix (e.g. "BlockPublicAcls>true", "MinimumPasswordLength>14", "<KeyRotationEnabled>true").
- Keep checks small (1-4 total).`;

  const user = `Finding being fixed: ${finding?.title} (${finding?.check_id})
Resource: ${finding?.resource_arn || "(none)"} | Region: ${finding?.region || "us-east-1"}

Write actions just executed:
${JSON.stringify(actions.map((a) => ({ service: a.service, api: a.api, params: a.params })), null, 2)}`;

  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) throw new Error(`Verifier planner failed: ${r.status}`);
  const j = await r.json();
  const content = j?.choices?.[0]?.message?.content || "{}";
  const parsed = JSON.parse(content);
  return { checks: Array.isArray(parsed?.checks) ? parsed.checks.slice(0, 4) : [] };
}

async function runVerification(actions: Action[], finding: any, defaultRegion: string, creds: Creds): Promise<Verification> {
  const plan = await planVerification(actions, finding);
  if (plan.checks.length === 0) {
    return { verified: false, summary: "No verification checks could be planned.", evidence: [] };
  }
  const evidence: Verification["evidence"] = [];
  for (const c of plan.checks) {
    // Reuse execAction shape — these are READ APIs but go through same protocol
    const fakeAction: Action = { id: c.id, description: c.description, service: c.service, api: c.api, region: c.region, params: c.params };
    const res = await execAction(fakeAction, defaultRegion, creds);
    const text = res.response || "";
    const containsOk = c.expect?.contains ? text.toLowerCase().includes(c.expect.contains.toLowerCase()) : true;
    const notContainsOk = c.expect?.not_contains ? !text.toLowerCase().includes(c.expect.not_contains.toLowerCase()) : true;
    const matched = res.ok && containsOk && notContainsOk;
    evidence.push({
      check: c.description,
      service: c.service, api: c.api,
      ok: res.ok, status: res.status,
      matched,
      expected: c.expect?.contains || c.expect?.not_contains || "(status only)",
      actual_preview: text.slice(0, 300),
      error: res.error,
    });
  }
  const verified = evidence.every((e) => e.matched);
  return {
    verified,
    summary: verified
      ? `All ${evidence.length} post-fix checks passed — the change is live in AWS.`
      : `${evidence.filter((e) => e.matched).length}/${evidence.length} checks passed. Fix may not have fully landed.`,
    evidence,
  };
}

// ============================================================
// Handler
// ============================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { remediation_id, dry_run } = await req.json();
    if (!remediation_id) return json({ error: "remediation_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Load remediation + finding + connection
    const { data: rem, error: remErr } = await admin
      .from("remediations").select("*").eq("id", remediation_id).eq("user_id", user.id).single();
    if (remErr || !rem) return json({ error: "remediation not found" }, 404);

    if (!dry_run && rem.lifecycle_state !== "approved") {
      return json({ error: `Remediation must be approved before execution (current: ${rem.lifecycle_state})` }, 400);
    }

    const { data: finding } = await admin.from("findings").select("*").eq("id", rem.finding_id).single();
    if (!finding) return json({ error: "finding not found" }, 404);

    const { data: audit } = await admin.from("audits").select("connection_id").eq("id", finding.audit_id).single();
    if (!audit?.connection_id) return json({ error: "no connection on audit" }, 400);

    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", audit.connection_id).single();
    if (!conn) return json({ error: "connection not found" }, 404);
    if (!conn.access_key_id || !conn.secret_access_key) return json({ error: "connection has no access keys" }, 400);

    const creds: Creds = { ak: conn.access_key_id, sk: conn.secret_access_key };
    const region = finding.region || conn.default_region || "us-east-1";

    // 1) PLAN — ask AI to translate snippet to AWS API calls
    const snippet = rem.executed_script || rem.snippet || "";
    if (!snippet.trim()) return json({ error: "remediation has no snippet to execute" }, 400);

    const planned = await planActions(snippet, finding);
    const actions = planned.actions;
    if (actions.length === 0) {
      console.error("[apply-remediation] empty plan", { reason: planned.reason, snippet_preview: snippet.slice(0, 500), finding_title: finding?.title, check_id: finding?.check_id });
      return json({
        error: `AI could not produce a safe action plan: ${planned.reason || "snippet was too vague or contained no actionable AWS change"}. Edit the remediation snippet to include concrete resource names (bucket, role, security group ID, etc.) or apply manually via the AWS Console.`,
        ai_reason: planned.reason,
        ai_raw_preview: planned.raw?.slice(0, 400),
      }, 422);
    }

    // Attach console URLs upfront
    actions.forEach((a) => { a.console_url = consoleUrlFor(a, region); });

    if (dry_run) {
      return json({ ok: true, dry_run: true, planned_actions: actions });
    }

    // 2) EXECUTE
    const results: ExecResult[] = [];
    for (const a of actions) {
      const res = await execAction(a, region, creds);
      results.push(res);
      if (!res.ok) break; // stop on first failure
    }

    const allOk = results.every((r) => r.ok);
    const primaryConsoleUrl =
      results[0]?.action?.console_url ||
      consoleUrlFor(actions[0], region);

    const outputLines: string[] = [];
    outputLines.push(`# Blastline remediation execution`);
    outputLines.push(`# Time: ${new Date().toISOString()}`);
    outputLines.push(`# Account: ${conn.aws_account_id || "(unknown)"} | Region: ${region}`);
    outputLines.push(`# Actions: ${results.length} | Success: ${results.filter(r => r.ok).length}`);
    outputLines.push("");
    for (const r of results) {
      outputLines.push(`── ${r.action.service}.${r.action.api} ${r.ok ? "✓" : "✗"} (${r.status ?? "ERR"})`);
      outputLines.push(`   ${r.action.description}`);
      outputLines.push(`   params: ${JSON.stringify(r.action.params)}`);
      if (r.action.console_url) outputLines.push(`   aws console: ${r.action.console_url}`);
      if (r.error) outputLines.push(`   error: ${r.error}`);
      if (r.response && r.response.trim()) {
        outputLines.push(`   ── AWS response (HTTP ${r.status ?? "ERR"}) ──`);
        const pretty = prettyAwsResponse(r.response);
        for (const line of pretty.split("\n")) outputLines.push(`   ${line}`);
      } else if (r.ok) {
        outputLines.push(`   ── AWS response (HTTP ${r.status}) ──`);
        outputLines.push(`   (empty body — AWS returned success with no payload)`);
      }
      outputLines.push("");
    }

    let refinedSnippet = snippet;

    // AI AUTO-REFINE: If it failed, ask AI to explain and suggest a new snippet
    if (!allOk) {
      const failedResult = results.find((r) => !r.ok);
      const failedAction = failedResult?.action;
      const errorMsg = failedResult?.error || "Unknown error";
      const awsResponse = failedResult?.response || "No response body";

      const system = `You are an expert AWS Remediation Engineer. The previous execution of a remediation script failed.
Analyze the following failure details:
1. Identify why the AWS API call failed based on the error message and AWS response.
2. Provide a clear, brief explanation of the failure.
3. Generate a refined, corrected snippet (Terraform/CloudFormation/CLI) that fixes the issue so the user can try again.

Output strictly as JSON:
{
  "explanation": "A short, actionable explanation of why it failed and how it was fixed.",
  "refined_snippet": "The updated snippet text."
}`;

      const userPrompt = `
Original Snippet:
${snippet}

Failed Action: ${failedAction?.service}.${failedAction?.api}
Params: ${JSON.stringify(failedAction?.params)}
Error: ${errorMsg}
AWS Response: ${awsResponse}
`;

      try {
        const resp = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: system },
              { role: "user", content: userPrompt }
            ]
          }),
        });

        if (resp.ok) {
          const body = await resp.json();
          const content = JSON.parse(body.choices[0].message.content);
          if (content.explanation && content.refined_snippet) {
            outputLines.push(`── AI FAILURE ANALYSIS & REFINEMENT ──`);
            outputLines.push(`   Explanation: ${content.explanation}`);
            outputLines.push(`   The script snippet has been automatically updated with the proposed fix.`);
            outputLines.push(`   Please review the new script and click 'Apply' again.`);

            refinedSnippet = content.refined_snippet;
          }
        } else {
          console.error("AI auto-refine failed", await resp.text());
        }
      } catch (err) {
        console.error("AI auto-refine error", err);
      }
    }

    const exec_status = allOk ? "applied" : "failed";
    const lifecycle: string = allOk ? "executed" : rem.lifecycle_state;

    const update: Record<string, any> = {
      lifecycle_state: lifecycle,
      execution_status: exec_status,
      execution_output: outputLines.join("\n"),
      executed_script: refinedSnippet,
      snippet: refinedSnippet, // Ensure the UI sees the new snippet for editing
      executed_by: user.id,
      executed_at: new Date().toISOString(),
      applied: allOk,
      aws_console_url: primaryConsoleUrl,
      aws_changes: { actions, results: results.map((r) => ({
        api: `${r.action.service}.${r.action.api}`, ok: r.ok, status: r.status, console_url: r.action.console_url,
        error: r.error, response_preview: r.response?.slice(0, 400),
      })) },
    };

    await admin.from("remediations").update(update).eq("id", remediation_id);

    // Add a remediation_event for the audit trail
    await admin.from("remediation_events").insert({
      user_id: user.id,
      remediation_id,
      finding_id: rem.finding_id,
      attack_path_id: rem.attack_path_id,
      event_type: allOk ? "executed" : "execution_failed",
      actor_id: user.id,
      actor_label: "Blastline AI agent",
      command: actions.map((a) => `${a.service}.${a.api}`).join(" → "),
      api_call: actions[0] ? `${actions[0].service}.${actions[0].api}` : null,
      after_state: { results: update.aws_changes.results },
      notes: allOk ? `Applied ${results.length} AWS API call(s) successfully.` : `Execution stopped after failure on ${results.findIndex(r => !r.ok) + 1}/${results.length}.`,
    });

    // 3) AUTO-VERIFY — re-check live AWS state to prove the fix landed
    let verification: Verification | null = null;
    if (allOk) {
      try {
        verification = await runVerification(actions, finding, region, creds);

        const verifyUpdate: Record<string, any> = {
          verification_result: {
            verified_at: new Date().toISOString(),
            method: "blastline_auto_verify",
            verified: verification.verified,
            summary: verification.summary,
            evidence: verification.evidence,
          },
        };
        if (verification.verified) {
          verifyUpdate.lifecycle_state = "verified";
          verifyUpdate.verified_at = new Date().toISOString();
          verifyUpdate.verified_by = user.id;
          // Mark the finding itself as resolved
          await admin.from("findings").update({
            status: "resolved",
            status_lifecycle: "resolved",
            resolved_at: new Date().toISOString(),
          }).eq("id", rem.finding_id);
        }
        await admin.from("remediations").update(verifyUpdate).eq("id", remediation_id);

        await admin.from("remediation_events").insert({
          user_id: user.id,
          remediation_id,
          finding_id: rem.finding_id,
          attack_path_id: rem.attack_path_id,
          event_type: verification.verified ? "verified" : "verification_failed",
          actor_id: user.id,
          actor_label: "Blastline auto-verifier",
          command: verification.evidence.map((e) => `${e.service}.${e.api}`).join(" → "),
          verification: verification as any,
          notes: verification.summary,
        });
      } catch (e: any) {
        console.error("verification error", e);
      }
    }

    return json({
      ok: allOk,
      lifecycle_state: lifecycle,
      execution_status: exec_status,
      console_url: primaryConsoleUrl,
      actions,
      results: update.aws_changes.results,
      verification,
    });
  } catch (e: any) {
    console.error("apply-remediation error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}