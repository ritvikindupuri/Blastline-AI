import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE);

let _seq = 0;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { audit_id, user_id } = await req.json();
    runPipeline(audit_id, user_id).catch(async (e) => {
      console.error("pipeline error", e);
      await admin.from("audits").update({ status: "failed", error: String(e?.message ?? e), completed_at: new Date().toISOString() }).eq("id", audit_id);
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

// ============================================================
// Tiny SigV4 helper — replaces 8 AWS SDK packages (~30MB bundle)
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

  const baseHeaders: Record<string, string> = {
    host,
    "x-amz-date": amzDate,
    ...(opts.creds.st ? { "x-amz-security-token": opts.creds.st } : {}),
    ...(opts.headers ?? {}),
  };
  if (method !== "GET" && !baseHeaders["content-type"]) {
    baseHeaders["content-type"] = "application/x-www-form-urlencoded; charset=utf-8";
  }

  const sortedHeaderKeys = Object.keys(baseHeaders).map((k) => k.toLowerCase()).sort();
  const canonicalHeaders = sortedHeaderKeys.map((k) => `${k}:${baseHeaders[Object.keys(baseHeaders).find((h) => h.toLowerCase() === k)!].trim()}`).join("\n") + "\n";
  const signedHeaders = sortedHeaderKeys.join(";");
  const payloadHash = await sha256Hex(body);

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

// Parse XML response → extract repeated element text
function xmlAll(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function xmlOne(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
}

// ============================================================
// AWS API wrappers
// ============================================================
async function getCallerIdentity(creds: Creds, region: string): Promise<{ account: string | null; arn: string | null }> {
  const r = await awsRequest({
    service: "sts", region, host: "sts.amazonaws.com",
    body: "Action=GetCallerIdentity&Version=2011-06-15", creds,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`GetCallerIdentity failed: ${text}`);
  return { account: xmlOne(text, "Account"), arn: xmlOne(text, "Arn") };
}

async function ec2Call(action: string, region: string, creds: Creds, params: Record<string, string> = {}): Promise<string> {
  const body = new URLSearchParams({ Action: action, Version: "2016-11-15", ...params }).toString();
  const r = await awsRequest({ service: "ec2", region, body, creds });
  return r.text();
}
async function rdsCall(action: string, region: string, creds: Creds): Promise<string> {
  const body = new URLSearchParams({ Action: action, Version: "2014-10-31" }).toString();
  const r = await awsRequest({ service: "rds", region, body, creds });
  return r.text();
}
async function iamCall(action: string, creds: Creds, params: Record<string, string> = {}): Promise<string> {
  // IAM is global → us-east-1
  const body = new URLSearchParams({ Action: action, Version: "2010-05-08", ...params }).toString();
  const r = await awsRequest({ service: "iam", region: "us-east-1", host: "iam.amazonaws.com", body, creds });
  return r.text();
}
async function s3List(creds: Creds): Promise<string[]> {
  const r = await awsRequest({ service: "s3", region: "us-east-1", host: "s3.amazonaws.com", method: "GET", creds });
  const text = await r.text();
  return xmlAll(text, "Name");
}
async function s3BucketGet(bucket: string, region: string, subresource: string, creds: Creds): Promise<{ ok: boolean; text: string }> {
  const host = `${bucket}.s3.${region}.amazonaws.com`;
  const r = await awsRequest({ service: "s3", region, host, method: "GET", path: `/?${subresource}`, creds });
  return { ok: r.ok, text: await r.text() };
}
async function lambdaCall(path: string, region: string, creds: Creds): Promise<{ ok: boolean; json: any }> {
  const r = await awsRequest({ service: "lambda", region, method: "GET", path, creds });
  const text = await r.text();
  try { return { ok: r.ok, json: JSON.parse(text) }; } catch { return { ok: r.ok, json: text }; }
}
async function gdCall(region: string, creds: Creds): Promise<any> {
  const r = await awsRequest({ service: "guardduty", region, method: "GET", path: "/detector", creds });
  return r.json().catch(() => ({}));
}
async function ctCall(action: "DescribeTrails" | "GetTrailStatus", region: string, creds: Creds, name?: string): Promise<any> {
  const body = JSON.stringify(name ? { Name: name } : {});
  const r = await awsRequest({
    service: "cloudtrail", region, body, creds,
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.${action}` },
  });
  return r.json().catch(() => ({}));
}

// ===== Expanded service helpers =====
async function kmsListKeys(region: string, creds: Creds): Promise<any[]> {
  const r = await awsRequest({
    service: "kms", region, creds, body: JSON.stringify({}),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.ListKeys" },
  });
  const j = await r.json().catch(() => ({}));
  return j?.Keys ?? [];
}
async function kmsRotationStatus(keyId: string, region: string, creds: Creds): Promise<{ enabled: boolean; ok: boolean }> {
  const r = await awsRequest({
    service: "kms", region, creds, body: JSON.stringify({ KeyId: keyId }),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "TrentService.GetKeyRotationStatus" },
  });
  const j = await r.json().catch(() => ({}));
  return { enabled: Boolean(j?.KeyRotationEnabled), ok: r.ok };
}
async function ecrRepos(region: string, creds: Creds): Promise<any[]> {
  const r = await awsRequest({
    service: "ecr", region, creds, body: JSON.stringify({}),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "AmazonEC2ContainerRegistry_V20150921.DescribeRepositories" },
  });
  const j = await r.json().catch(() => ({}));
  return j?.repositories ?? [];
}
async function smList(region: string, creds: Creds): Promise<any[]> {
  const r = await awsRequest({
    service: "secretsmanager", region, creds, body: JSON.stringify({}),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "secretsmanager.ListSecrets" },
  });
  const j = await r.json().catch(() => ({}));
  return j?.SecretList ?? [];
}
async function eksList(region: string, creds: Creds): Promise<string[]> {
  const r = await awsRequest({ service: "eks", region, method: "GET", path: "/clusters", creds });
  const j = await r.json().catch(() => ({}));
  return j?.clusters ?? [];
}
async function eksDescribe(name: string, region: string, creds: Creds): Promise<any> {
  const r = await awsRequest({ service: "eks", region, method: "GET", path: `/clusters/${encodeURIComponent(name)}`, creds });
  const j = await r.json().catch(() => ({}));
  return j?.cluster ?? {};
}
async function vpcFlowLogs(region: string, creds: Creds): Promise<{ flowLogIds: string[]; vpcIds: string[] }> {
  const vpcsXml = await ec2Call("DescribeVpcs", region, creds);
  const flXml = await ec2Call("DescribeFlowLogs", region, creds);
  return {
    vpcIds: xmlAll(vpcsXml, "vpcId"),
    flowLogIds: xmlAll(flXml, "flowLogId"),
  };
}
async function gdFindings(detectorId: string, region: string, creds: Creds): Promise<any[]> {
  const r = await awsRequest({
    service: "guardduty", region, method: "POST",
    path: `/detector/${detectorId}/findings`,
    creds,
    body: JSON.stringify({ MaxResults: 50 }),
    headers: { "content-type": "application/json" },
  });
  const j = await r.json().catch(() => ({}));
  const ids: string[] = j?.FindingIds ?? [];
  if (!ids.length) return [];
  const get = await awsRequest({
    service: "guardduty", region, method: "POST",
    path: `/detector/${detectorId}/findings/get`,
    creds,
    body: JSON.stringify({ FindingIds: ids }),
    headers: { "content-type": "application/json" },
  });
  const gj = await get.json().catch(() => ({}));
  return gj?.Findings ?? [];
}
async function ctLookup(region: string, creds: Creds, eventName: string): Promise<any[]> {
  const r = await awsRequest({
    service: "cloudtrail", region, creds,
    body: JSON.stringify({ LookupAttributes: [{ AttributeKey: "EventName", AttributeValue: eventName }], MaxResults: 10 }),
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": "com.amazonaws.cloudtrail.v20131101.CloudTrail_20131101.LookupEvents" },
  });
  const j = await r.json().catch(() => ({}));
  return j?.Events ?? [];
}

// ============================================================
async function log(audit_id: string, user_id: string, agent: string, content: string, phase?: string, data?: any) {
  await admin.from("agent_transcripts").insert({ audit_id, user_id, agent, content, phase, data: data ?? null, seq: ++_seq });
}

// Structured execution log: command + output streamed to UI in realtime
async function logExec(audit_id: string, user_id: string, agent: string, phase: string, summary: string, command: string, output: any, thinking?: string) {
  await admin.from("agent_transcripts").insert({
    audit_id, user_id, agent, content: summary, phase,
    data: { command, output: typeof output === "string" ? output.slice(0, 4000) : output, ...(thinking ? { thinking } : {}) },
    seq: ++_seq,
  });
}

let _controlCache: Record<string, any> | null = null;
async function loadControls() {
  if (_controlCache) return _controlCache;
  const { data } = await admin.from("control_mappings").select("*");
  _controlCache = {};
  for (const c of data ?? []) _controlCache[c.check_id] = c;
  return _controlCache;
}

function mkFinding(audit_id: string, user_id: string, service: string, check_id: string, severity: string,
  title: string, description: string, resource_arn: string | null | undefined, region: string, extra: any, accountId?: string | null) {
  const ctl = _controlCache?.[check_id] ?? {};
  const controls = {
    cis: ctl.cis ?? [], nist: ctl.nist ?? [], soc2: ctl.soc2 ?? [], pci: ctl.pci ?? [], mitre: ctl.mitre ?? [],
  };
  const dedup_key = `${accountId ?? "?"}:${region}:${check_id}:${resource_arn ?? "global"}`;
  return {
    audit_id, user_id, service, check_id, severity, title, description,
    resource_arn: resource_arn ?? null, region,
    framework_refs: extra.framework_refs ?? controls,
    evidence: extra.evidence ?? null,
    confidence: 0.9,
    account_id: accountId ?? null,
    controls,
    dedup_key,
  };
}

async function llm(model: string, messages: any[], json = false): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, ...(json ? { response_format: { type: "json_object" } } : {}) }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "{}";
}

async function runPipeline(audit_id: string, user_id: string) {
  await admin.from("audits").update({ status: "running", started_at: new Date().toISOString() }).eq("id", audit_id);

  const { data: audit } = await admin.from("audits").select("*, aws_connections(*)").eq("id", audit_id).single();
  const conn = (audit as any).aws_connections;
  const services: string[] = audit?.scope?.services ?? [];
  const region = conn.default_region;

  await log(audit_id, user_id, "recon", `Booting recon agent · target ${conn.aws_account_id ?? "(pending)"} · region ${region}`, "init");

  if (!conn.access_key_id || !conn.secret_access_key) {
    throw new Error("Connection has no access keys configured");
  }
  const creds: Creds = { ak: conn.access_key_id, sk: conn.secret_access_key };
  const ident = await getCallerIdentity(creds, region);
  await logExec(audit_id, user_id, "recon", "auth",
    `Authenticated as ${ident.arn ?? "unknown"} · account ${ident.account ?? "?"}`,
    `aws sts get-caller-identity --region ${region}`,
    { Account: ident.account, Arn: ident.arn },
    "Verifying credentials and resolving the audit target account before enumeration.");

  const findings: any[] = [];

  // ===== IAM =====
  if (services.includes("iam")) {
    await log(audit_id, user_id, "recon", "Enumerating IAM (users, roles, password policy)", "iam", { thinking: "IAM is the highest-leverage service: weak password policy, stale keys, and wildcard trust policies enable account takeover." });
    const usersXml = await iamCall("ListUsers", creds);
    const rolesXml = await iamCall("ListRoles", creds);
    const userNames = xmlAll(usersXml, "UserName");
    const roleBlocks = xmlAll(rolesXml, "member");
    let pwdPresent = true;
    try {
      const pp = await iamCall("GetAccountPasswordPolicy", creds);
      if (/<Error>|NoSuchEntity/.test(pp)) pwdPresent = false;
    } catch { pwdPresent = false; }
    await logExec(audit_id, user_id, "recon", "iam",
      `IAM: ${userNames.length} users · ${roleBlocks.length} roles · password policy: ${pwdPresent ? "present" : "MISSING"}`,
      "aws iam list-users && aws iam list-roles && aws iam get-account-password-policy",
      { users: userNames.length, roles: roleBlocks.length, passwordPolicyPresent: pwdPresent });

    if (!pwdPresent) {
      findings.push(mkFinding(audit_id, user_id, "iam", "IAM-PWD-001", "high", "No IAM account password policy configured",
        "AWS account has no password complexity policy. Enables weak passwords across all IAM users.",
        `arn:aws:iam::${conn.aws_account_id}:account`, region,
        { framework_refs: { cis: "1.5-1.11", nist: "IA-5" }, evidence: { passwordPolicy: null } }));
    }

    for (const u of userNames.slice(0, 25)) {
      try {
        const keysXml = await iamCall("ListAccessKeys", creds, { UserName: u });
        const dates = xmlAll(keysXml, "CreateDate").map((d) => new Date(d).getTime());
        const ids = xmlAll(keysXml, "AccessKeyId");
        const old = dates.filter((d) => Date.now() - d > 90 * 86400000);
        if (old.length) {
          findings.push(mkFinding(audit_id, user_id, "iam", "IAM-KEY-AGE", "medium",
            `IAM user ${u} has access key older than 90 days`,
            "Long-lived access keys increase breach blast radius. Rotate or migrate to roles.",
            `arn:aws:iam::${conn.aws_account_id}:user/${u}`, region,
            { framework_refs: { cis: "1.14" }, evidence: { keyIds: ids } }));
        }
      } catch { /* skip */ }
    }

    // Wildcard trust scan
    for (const block of roleBlocks.slice(0, 50)) {
      const name = (block.match(/<RoleName>([^<]+)<\/RoleName>/) || [])[1];
      const docRaw = (block.match(/<AssumeRolePolicyDocument>([^<]+)<\/AssumeRolePolicyDocument>/) || [])[1];
      if (!name || !docRaw) continue;
      const doc = decodeURIComponent(docRaw.replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      if (/"Principal"\s*:\s*"\*"/.test(doc) || /"AWS"\s*:\s*"\*"/.test(doc)) {
        findings.push(mkFinding(audit_id, user_id, "iam", "IAM-TRUST-WILDCARD", "critical",
          `Role ${name} trusts wildcard principal (*)`,
          "Any AWS principal can assume this role. Catastrophic privilege escalation surface.",
          `arn:aws:iam::${conn.aws_account_id}:role/${name}`, region,
          { framework_refs: { mitre: "T1078.004", cis: "1.16" }, evidence: { trust: doc } }));
      }
    }
  }

  // ===== S3 =====
  if (services.includes("s3")) {
    await log(audit_id, user_id, "recon", "Enumerating S3 (buckets, public access, encryption)", "s3", { thinking: "Public buckets and missing default encryption are the most common data-leak vectors. Checking PublicAccessBlock + policyStatus + encryption config per bucket." });
    const buckets = await s3List(creds);
    await logExec(audit_id, user_id, "recon", "s3",
      `S3: ${buckets.length} buckets discovered`,
      "aws s3api list-buckets",
      { buckets: buckets.slice(0, 50) });
    for (const b of buckets.slice(0, 30)) {
      const enc = await s3BucketGet(b, region, "encryption", creds);
      const pab = await s3BucketGet(b, region, "publicAccessBlock", creds);
      const ps = await s3BucketGet(b, region, "policyStatus", creds);
      const hasEnc = enc.ok && !/NoSuchEncryptionConfig/.test(enc.text);
      const cfg = pab.text;
      const fullBlock = pab.ok &&
        /<BlockPublicAcls>true/.test(cfg) && /<BlockPublicPolicy>true/.test(cfg) &&
        /<IgnorePublicAcls>true/.test(cfg) && /<RestrictPublicBuckets>true/.test(cfg);
      const isPublic = ps.ok && /<IsPublic>true</.test(ps.text);
      if (!hasEnc) findings.push(mkFinding(audit_id, user_id, "s3", "S3-ENC-001", "high",
        `S3 bucket ${b} has no default encryption`, "Objects at rest are not encrypted by default.",
        `arn:aws:s3:::${b}`, region, { framework_refs: { cis: "2.1.1", nist: "SC-28" }, evidence: { encryption: false } }));
      if (!fullBlock) findings.push(mkFinding(audit_id, user_id, "s3", "S3-PAB-001", "high",
        `S3 bucket ${b} missing full Public Access Block`, "Public ACLs/policies can expose data publicly.",
        `arn:aws:s3:::${b}`, region, { framework_refs: { cis: "2.1.5" }, evidence: { publicAccessBlock: false } }));
      if (isPublic) findings.push(mkFinding(audit_id, user_id, "s3", "S3-PUB-001", "critical",
        `S3 bucket ${b} is PUBLIC`, "Bucket policy allows public access — possible data leak.",
        `arn:aws:s3:::${b}`, region, { framework_refs: { cis: "2.1.5", mitre: "T1530" }, evidence: { isPublic: true } }));
    }
  }

  // ===== EC2 =====
  if (services.includes("ec2")) {
    await log(audit_id, user_id, "recon", "Enumerating EC2 (security groups, EBS volumes)", "ec2", { thinking: "Looking for SGs that expose admin ports (22/3389/3306/5432) to 0.0.0.0/0 and unencrypted EBS volumes." });
    const sgXml = await ec2Call("DescribeSecurityGroups", region, creds);
    const volXml = await ec2Call("DescribeVolumes", region, creds);
    const sgItems = xmlAll(sgXml, "item");
    const sgCount = (sgXml.match(/<groupId>/g) || []).length;
    const volIds = xmlAll(volXml, "volumeId");
    await logExec(audit_id, user_id, "recon", "ec2",
      `EC2: ${sgCount} SGs · ${volIds.length} EBS volumes`,
      `aws ec2 describe-security-groups --region ${region} && aws ec2 describe-volumes --region ${region}`,
      { securityGroups: sgCount, volumes: volIds.length });

    // Naive SG open-port scan
    const openMatches = sgXml.matchAll(/<groupId>(sg-[a-f0-9]+)<\/groupId>([\s\S]*?)(?=<groupId>|<\/SecurityGroupInfo>|$)/g);
    for (const m of openMatches) {
      const sgId = m[1];
      const blob = m[2];
      const portMatches = blob.matchAll(/<fromPort>(-?\d+)<\/fromPort>[\s\S]*?<toPort>(-?\d+)<\/toPort>[\s\S]*?<ipProtocol>([^<]+)<\/ipProtocol>([\s\S]*?)(?=<fromPort>|<\/ipPermissions>)/g);
      for (const p of portMatches) {
        if (!/<cidrIp>0\.0\.0\.0\/0</.test(p[4])) continue;
        const from = parseInt(p[1]); const to = parseInt(p[2]); const proto = p[3];
        const port = from === to ? `${from}` : `${from}-${to}`;
        const sev = [22, 3389, 3306, 5432, 6379, 27017].includes(from) ? "critical" : "high";
        findings.push(mkFinding(audit_id, user_id, "ec2", "EC2-SG-OPEN", sev,
          `Security Group ${sgId} opens port ${port} to 0.0.0.0/0`,
          `Internet-exposed ${proto}/${port}. Common ingress vector for attackers.`,
          `arn:aws:ec2:${region}:${conn.aws_account_id}:security-group/${sgId}`, region,
          { framework_refs: { cis: "5.2", mitre: "T1190" }, evidence: { protocol: proto, port } }));
      }
    }
    // Unencrypted EBS
    const volBlocks = volXml.matchAll(/<volumeId>(vol-[a-f0-9]+)<\/volumeId>([\s\S]*?)(?=<volumeId>|<\/volumeSet>)/g);
    for (const v of volBlocks) {
      if (/<encrypted>false</.test(v[2])) {
        findings.push(mkFinding(audit_id, user_id, "ec2", "EBS-ENC-001", "medium",
          `EBS volume ${v[1]} is unencrypted`, "Data at rest unencrypted on this EBS volume.",
          `arn:aws:ec2:${region}:${conn.aws_account_id}:volume/${v[1]}`, region,
          { framework_refs: { cis: "2.2.1", nist: "SC-28" }, evidence: { encrypted: false } }));
      }
    }
  }

  // ===== RDS =====
  if (services.includes("rds")) {
    await log(audit_id, user_id, "recon", "→ enumerating RDS instances", "rds");
    const xml = await rdsCall("DescribeDBInstances", region, creds);
    const dbBlocks = xml.matchAll(/<DBInstance>([\s\S]*?)<\/DBInstance>/g);
    let count = 0;
    for (const m of dbBlocks) {
      count++;
      const blob = m[1];
      const id = (blob.match(/<DBInstanceIdentifier>([^<]+)/) || [])[1];
      const arn = (blob.match(/<DBInstanceArn>([^<]+)/) || [])[1];
      if (/<PubliclyAccessible>true</.test(blob)) {
        findings.push(mkFinding(audit_id, user_id, "rds", "RDS-PUB-001", "critical",
          `RDS ${id} is publicly accessible`, "Database is reachable from the internet.",
          arn, region, { framework_refs: { cis: "2.3.3" }, evidence: { publiclyAccessible: true } }));
      }
      if (/<StorageEncrypted>false</.test(blob)) {
        findings.push(mkFinding(audit_id, user_id, "rds", "RDS-ENC-001", "high",
          `RDS ${id} storage unencrypted`, "DB storage is not encrypted at rest.",
          arn, region, { framework_refs: { cis: "2.3.1", nist: "SC-28" }, evidence: { storageEncrypted: false } }));
      }
    }
    await log(audit_id, user_id, "recon", `RDS: ${count} instances`, "rds");
  }

  // ===== Lambda =====
  if (services.includes("lambda")) {
    await log(audit_id, user_id, "recon", "→ enumerating Lambda", "lambda");
    const list = await lambdaCall("/2015-03-31/functions/", region, creds);
    const fns: any[] = list.json?.Functions ?? [];
    await log(audit_id, user_id, "recon", `Lambda: ${fns.length} functions`, "lambda");
    for (const f of fns.slice(0, 30)) {
      const url = await lambdaCall(`/2021-10-31/functions/${encodeURIComponent(f.FunctionName)}/url`, region, creds);
      if (url.ok && url.json?.AuthType === "NONE") {
        findings.push(mkFinding(audit_id, user_id, "lambda", "LAMBDA-URL-NOAUTH", "high",
          `Lambda ${f.FunctionName} has unauthenticated function URL`, "Function URL is publicly invokable without auth.",
          f.FunctionArn, region, { framework_refs: { mitre: "T1190" }, evidence: { authType: "NONE", url: url.json.FunctionUrl } }));
      }
      const env = f.Environment?.Variables ?? {};
      const suspect = Object.keys(env).filter((k) => /SECRET|TOKEN|PASSWORD|KEY/i.test(k));
      if (suspect.length) {
        findings.push(mkFinding(audit_id, user_id, "lambda", "LAMBDA-ENV-SECRET", "medium",
          `Lambda ${f.FunctionName} has secret-like env vars`, "Plaintext secrets in environment variables. Use Secrets Manager.",
          f.FunctionArn, region, { framework_refs: { nist: "IA-5" }, evidence: { keys: suspect } }));
      }
    }
  }

  // ===== CloudTrail =====
  if (services.includes("cloudtrail")) {
    await log(audit_id, user_id, "recon", "→ enumerating CloudTrail", "cloudtrail");
    const trails = await ctCall("DescribeTrails", region, creds);
    const list: any[] = trails.trailList ?? [];
    if (list.length === 0) {
      findings.push(mkFinding(audit_id, user_id, "cloudtrail", "CT-NONE", "critical",
        "No CloudTrail trails configured", "No audit logging — incident response will be blind.",
        `arn:aws:cloudtrail:${region}:${conn.aws_account_id}:*`, region,
        { framework_refs: { cis: "3.1", nist: "AU-2" }, evidence: { trails: 0 } }));
    } else {
      for (const t of list) {
        const status = await ctCall("GetTrailStatus", region, creds, t.TrailARN);
        if (!status.IsLogging) {
          findings.push(mkFinding(audit_id, user_id, "cloudtrail", "CT-STOPPED", "high",
            `CloudTrail ${t.Name} is not logging`, "Trail exists but logging is disabled.",
            t.TrailARN, region, { framework_refs: { cis: "3.1" }, evidence: { isLogging: false } }));
        }
      }
    }
  }

  // ===== GuardDuty =====
  if (services.includes("guardduty")) {
    await log(audit_id, user_id, "recon", "→ checking GuardDuty", "guardduty");
    const det = await gdCall(region, creds);
    const ids: string[] = det?.DetectorIds ?? [];
    if (ids.length === 0) {
      findings.push(mkFinding(audit_id, user_id, "guardduty", "GD-OFF", "high",
        `GuardDuty disabled in ${region}`, "No threat detection enabled in this region.",
        `arn:aws:guardduty:${region}:${conn.aws_account_id}:*`, region,
        { framework_refs: { nist: "SI-4" }, evidence: { detectors: 0 } }));
    }
  }

  await log(audit_id, user_id, "misconfig", `Misconfig agent evaluated checks · ${findings.length} findings raised`, "summary");
  if (findings.length) await admin.from("findings").insert(findings);

  // ===== Critic =====
  if (findings.length) {
    await log(audit_id, user_id, "critic", "→ challenging findings for false positives", "review");
    const critique = await llm("google/gemini-3-flash-preview", [
      { role: "system", content: "You are a senior AWS security auditor. For each finding, decide if it is a real risk. Be terse." },
      { role: "user", content: `Review these AWS findings and respond with JSON {verdicts:[{check_id,verdict:"confirmed"|"false_positive",reasoning}]}. Findings: ${JSON.stringify(findings.map((f) => ({ check_id: f.check_id, title: f.title, evidence: f.evidence })))}` },
    ], true);
    try {
      const parsed = JSON.parse(critique);
      for (const v of parsed.verdicts ?? []) {
        await admin.from("findings").update({ critic_verdict: v.verdict, critic_reasoning: v.reasoning })
          .eq("audit_id", audit_id).eq("check_id", v.check_id);
      }
      await log(audit_id, user_id, "critic", `Reviewed ${parsed.verdicts?.length ?? 0} findings`, "done");
    } catch (e) {
      await log(audit_id, user_id, "critic", `Review parsing failed: ${e}`, "warn");
    }
  }

  // ===== Attack Path =====
  if (findings.length >= 2) {
    await log(audit_id, user_id, "attackpath", "→ chaining findings into attack paths", "analysis");
    const apResp = await llm("google/gemini-3-flash-preview", [
      { role: "system", content: "You are an offensive security analyst. Identify chained attack paths from misconfigurations. Respond ONLY with valid JSON." },
      { role: "user", content: `Given these AWS findings, identify up to 3 attack paths. Each path chains 2+ findings. Respond {paths:[{title,severity:"critical"|"high"|"medium",narrative,finding_check_ids:[],graph:{nodes:[{id,label,position:{x,y}}],edges:[{source,target,label}]},blast_radius:{resources_at_risk:number,data_classes:[],summary}}]}. Findings: ${JSON.stringify(findings.map((f) => ({ check_id: f.check_id, service: f.service, title: f.title, resource_arn: f.resource_arn, severity: f.severity })))}` },
    ], true);
    try {
      const parsed = JSON.parse(apResp);
      for (const p of parsed.paths ?? []) {
        const ids = findings.filter((f) => p.finding_check_ids?.includes(f.check_id)).map((f) => f.id);
        await admin.from("attack_paths").insert({
          audit_id, user_id, title: p.title, narrative: p.narrative, severity: p.severity,
          graph: p.graph ?? { nodes: [], edges: [] },
          blast_radius: p.blast_radius ?? null,
          finding_ids: ids,
        });
        await log(audit_id, user_id, "attackpath", `${p.title} (${p.severity})`, "path", { thinking: p.narrative });
      }
    } catch (e) {
      await log(audit_id, user_id, "attackpath", `Parsing failed: ${e}`, "warn");
    }
  }

  // ===== Remediation =====
  const top = findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 8);
  if (top.length) {
    await log(audit_id, user_id, "remediation", `Generating Terraform/CLI fixes for top ${top.length} findings`, "fixes", { thinking: "Prioritizing critical+high. For each finding I produce a least-privilege fix, a risk grade, and an executable command so an engineer can review before applying." });
    for (const f of top) {
      const remResp = await llm("google/gemini-3-flash-preview", [
        { role: "system", content: "You are an AWS remediation engineer. Output JSON only." },
        { role: "user", content: `For this AWS finding, write a Terraform fix. Respond {title,description,fix_type:"terraform"|"cli",risk:"low"|"medium"|"high",snippet}. Finding: ${JSON.stringify({ check_id: f.check_id, title: f.title, resource_arn: f.resource_arn, evidence: f.evidence })}` },
      ], true);
      try {
        const parsed = JSON.parse(remResp);
        const { data: row } = await admin.from("findings").select("id").eq("audit_id", audit_id).eq("check_id", f.check_id).limit(1).single();
        if (row) await admin.from("remediations").insert({
          finding_id: row.id, user_id,
          title: parsed.title, description: parsed.description,
          fix_type: parsed.fix_type, risk: parsed.risk ?? "medium", snippet: parsed.snippet,
        });
        await logExec(audit_id, user_id, "remediation", "fix",
          `Proposed ${parsed.fix_type} fix for ${f.check_id}: ${parsed.title}`,
          parsed.snippet ?? "(no snippet)",
          { risk: parsed.risk ?? "medium", resource: f.resource_arn },
          parsed.description);
      } catch { /* skip */ }
    }
    await log(audit_id, user_id, "remediation", "Fixes generated", "done");
  }

  // ===== Reporter =====
  const summary = {
    total: findings.length,
    critical: findings.filter((f) => f.severity === "critical").length,
    high: findings.filter((f) => f.severity === "high").length,
    medium: findings.filter((f) => f.severity === "medium").length,
    services_scanned: services,
  };
  await log(audit_id, user_id, "reporter", `Audit complete · ${summary.total} findings · ${summary.critical} critical · ${summary.high} high`, "final", summary);
  await admin.from("audits").update({ status: "completed", completed_at: new Date().toISOString(), summary }).eq("id", audit_id);
}