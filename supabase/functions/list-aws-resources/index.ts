import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ---------------- SigV4 helper (same shape as run-agent-pipeline) ----------------
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

function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function attrAll(xml: string, parentTag: string, attrTag: string): string[] {
  const items = xmlAll(xml, parentTag);
  const re = new RegExp(`<${attrTag}[^>]*>([\\s\\S]*?)</${attrTag}>`);
  return items.map((it) => {
    const m = it.match(re);
    return m ? m[1] : "";
  }).filter(Boolean);
}

// ---------------- Per-service listers ----------------
type ResourceItem = { arn: string; label: string; hint?: string };

async function listS3(creds: Creds): Promise<ResourceItem[]> {
  const r = await awsRequest({ service: "s3", region: "us-east-1", host: "s3.amazonaws.com", method: "GET", creds });
  const text = await r.text();
  if (!r.ok) throw new Error(`S3 ListBuckets failed: ${text.slice(0, 200)}`);
  const names = xmlAll(text, "Name");
  return names.slice(0, 50).map((n) => ({ arn: `arn:aws:s3:::${n}`, label: n, hint: "S3 bucket" }));
}

async function listIam(creds: Creds): Promise<ResourceItem[]> {
  const out: ResourceItem[] = [];
  const usersXml = await (await awsRequest({
    service: "iam", region: "us-east-1", host: "iam.amazonaws.com",
    body: new URLSearchParams({ Action: "ListUsers", Version: "2010-05-08", MaxItems: "50" }).toString(), creds,
  })).text();
  for (const arn of xmlAll(usersXml, "Arn")) {
    const name = arn.split("/").pop() ?? arn;
    out.push({ arn, label: name, hint: "IAM user" });
  }
  const rolesXml = await (await awsRequest({
    service: "iam", region: "us-east-1", host: "iam.amazonaws.com",
    body: new URLSearchParams({ Action: "ListRoles", Version: "2010-05-08", MaxItems: "50" }).toString(), creds,
  })).text();
  for (const arn of xmlAll(rolesXml, "Arn")) {
    if (arn.includes(":role/aws-service-role/")) continue; // skip service-linked
    const name = arn.split("/").pop() ?? arn;
    out.push({ arn, label: name, hint: "IAM role" });
  }
  return out.slice(0, 60);
}

async function listSg(region: string, creds: Creds, account: string): Promise<ResourceItem[]> {
  const body = new URLSearchParams({ Action: "DescribeSecurityGroups", Version: "2016-11-15" }).toString();
  const r = await awsRequest({ service: "ec2", region, body, creds });
  const text = await r.text();
  if (!r.ok) throw new Error(`EC2 DescribeSecurityGroups failed: ${text.slice(0, 200)}`);
  const items = xmlAll(text, "item");
  // crude parse — pull groupId + groupName from each item
  const out: ResourceItem[] = [];
  for (const it of items) {
    const id = (it.match(/<groupId>([^<]+)<\/groupId>/) ?? [])[1];
    const name = (it.match(/<groupName>([^<]+)<\/groupName>/) ?? [])[1];
    if (!id) continue;
    out.push({
      arn: `arn:aws:ec2:${region}:${account}:security-group/${id}`,
      label: `${name ?? id} (${id})`,
      hint: "Security group",
    });
    if (out.length >= 50) break;
  }
  return out;
}

async function listKms(region: string, creds: Creds): Promise<ResourceItem[]> {
  const r = await awsRequest({
    service: "kms", region, creds, body: JSON.stringify({ Limit: 50 }),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.ListKeys" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`KMS ListKeys failed: ${JSON.stringify(j).slice(0, 200)}`);
  const keys = (j?.Keys ?? []) as any[];
  // Get aliases to make labels human-readable
  const aliasRes = await awsRequest({
    service: "kms", region, creds, body: JSON.stringify({ Limit: 100 }),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.ListAliases" },
  });
  const aliases = ((await aliasRes.json().catch(() => ({})))?.Aliases ?? []) as any[];
  const aliasFor = (id: string) => aliases.find((a) => a.TargetKeyId === id)?.AliasName as string | undefined;
  return keys.slice(0, 50).map((k) => ({
    arn: k.KeyArn as string,
    label: aliasFor(k.KeyId) ?? k.KeyId,
    hint: "KMS key",
  }));
}

async function listRds(region: string, creds: Creds): Promise<ResourceItem[]> {
  const body = new URLSearchParams({ Action: "DescribeDBInstances", Version: "2014-10-31" }).toString();
  const r = await awsRequest({ service: "rds", region, body, creds });
  const text = await r.text();
  if (!r.ok) throw new Error(`RDS DescribeDBInstances failed: ${text.slice(0, 200)}`);
  const arns = xmlAll(text, "DBInstanceArn");
  return arns.slice(0, 50).map((arn) => ({
    arn,
    label: arn.split(":db:").pop() ?? arn,
    hint: "RDS database",
  }));
}

async function listLambda(region: string, creds: Creds): Promise<ResourceItem[]> {
  const r = await awsRequest({ service: "lambda", region, method: "GET", path: "/2015-03-31/functions/", creds });
  const text = await r.text();
  if (!r.ok) throw new Error(`Lambda ListFunctions failed: ${text.slice(0, 200)}`);
  const j = JSON.parse(text);
  const fns = (j?.Functions ?? []) as any[];
  return fns.slice(0, 50).map((f) => ({
    arn: f.FunctionArn as string,
    label: f.FunctionName as string,
    hint: "Lambda function",
  }));
}

async function listSecrets(region: string, creds: Creds): Promise<ResourceItem[]> {
  const r = await awsRequest({
    service: "secretsmanager", region, creds, body: JSON.stringify({ MaxResults: 50 }),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "secretsmanager.ListSecrets" },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Secrets ListSecrets failed: ${JSON.stringify(j).slice(0, 200)}`);
  return ((j?.SecretList ?? []) as any[]).slice(0, 50).map((s) => ({
    arn: s.ARN as string,
    label: s.Name as string,
    hint: "Secret",
  }));
}

// ---------------- Handler ----------------
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

    const { connection_id, service } = await req.json();
    if (!connection_id || !service) return json({ error: "connection_id and service required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: conn } = await admin.from("aws_connections").select("*").eq("id", connection_id).eq("user_id", user.id).single();
    if (!conn) return json({ error: "connection not found" }, 404);
    if (!conn.access_key_id || !conn.secret_access_key) return json({ error: "connection has no access keys" }, 400);

    const creds: Creds = { ak: conn.access_key_id, sk: conn.secret_access_key };
    const region: string = conn.default_region || "us-east-1";
    const account: string = conn.aws_account_id || "";

    let items: ResourceItem[] = [];
    switch (service) {
      case "s3":              items = await listS3(creds); break;
      case "iam":             items = await listIam(creds); break;
      case "sg":              items = await listSg(region, creds, account); break;
      case "kms":             items = await listKms(region, creds); break;
      case "rds":             items = await listRds(region, creds); break;
      case "lambda":          items = await listLambda(region, creds); break;
      case "secretsmanager":  items = await listSecrets(region, creds); break;
      default: return json({ error: `unsupported service: ${service}` }, 400);
    }

    return json({ ok: true, region, items });
  } catch (e: any) {
    console.error("list-aws-resources error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}