import { createClient } from "npm:@supabase/supabase-js@2.45.0";
import { STSClient, AssumeRoleCommand } from "npm:@aws-sdk/client-sts@3.658.1";
import { IAMClient, ListUsersCommand, ListRolesCommand, ListAccessKeysCommand, GetAccountPasswordPolicyCommand, ListAttachedRolePoliciesCommand } from "npm:@aws-sdk/client-iam@3.658.1";
import { S3Client, ListBucketsCommand, GetBucketPolicyStatusCommand, GetBucketEncryptionCommand, GetPublicAccessBlockCommand } from "npm:@aws-sdk/client-s3@3.658.1";
import { EC2Client, DescribeSecurityGroupsCommand, DescribeVolumesCommand, DescribeInstancesCommand } from "npm:@aws-sdk/client-ec2@3.658.1";
import { RDSClient, DescribeDBInstancesCommand } from "npm:@aws-sdk/client-rds@3.658.1";
import { LambdaClient, ListFunctionsCommand, GetFunctionUrlConfigCommand } from "npm:@aws-sdk/client-lambda@3.658.1";
import { CloudTrailClient, DescribeTrailsCommand, GetTrailStatusCommand } from "npm:@aws-sdk/client-cloudtrail@3.658.1";
import { GuardDutyClient, ListDetectorsCommand } from "npm:@aws-sdk/client-guardduty@3.658.1";

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
    // run async — but we'll await for clean error handling here since we already returned early in start-audit
    runPipeline(audit_id, user_id).catch(async (e) => {
      console.error("pipeline error", e);
      await admin.from("audits").update({ status: "failed", error: String(e?.message ?? e), completed_at: new Date().toISOString() }).eq("id", audit_id);
    });
    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});

async function log(audit_id: string, user_id: string, agent: string, content: string, phase?: string, data?: any) {
  await admin.from("agent_transcripts").insert({ audit_id, user_id, agent, content, phase, data: data ?? null, seq: ++_seq });
}

async function runPipeline(audit_id: string, user_id: string) {
  await admin.from("audits").update({ status: "running", started_at: new Date().toISOString() }).eq("id", audit_id);

  const { data: audit } = await admin.from("audits").select("*, aws_connections(*)").eq("id", audit_id).single();
  const conn = (audit as any).aws_connections;
  const services: string[] = audit?.scope?.services ?? [];

  await log(audit_id, user_id, "recon", `Booting recon agent · target ${conn.aws_account_id} · region ${conn.default_region}`, "init");

  // Assume role
  const sts = new STSClient({
    region: conn.default_region,
    credentials: {
      accessKeyId: Deno.env.get("AWS_BOOTSTRAP_ACCESS_KEY_ID")!,
      secretAccessKey: Deno.env.get("AWS_BOOTSTRAP_SECRET_ACCESS_KEY")!,
    },
  });
  const assumed = await sts.send(new AssumeRoleCommand({
    RoleArn: conn.role_arn,
    RoleSessionName: `sentrygrid-audit-${audit_id.slice(0, 8)}`,
    ExternalId: conn.external_id,
    DurationSeconds: 3600,
  }));
  const c = assumed.Credentials!;
  const creds = { accessKeyId: c.AccessKeyId!, secretAccessKey: c.SecretAccessKey!, sessionToken: c.SessionToken! };
  const region = conn.default_region;

  await log(audit_id, user_id, "recon", `STS AssumeRole succeeded · session credentials acquired (1h TTL)`, "auth");

  // ===== Recon =====
  const recon: any = {};
  const findings: any[] = [];

  if (services.includes("iam")) {
    await log(audit_id, user_id, "recon", "→ enumerating IAM (users, roles, password policy)", "iam");
    const iam = new IAMClient({ region, credentials: creds });
    const users = (await iam.send(new ListUsersCommand({}))).Users ?? [];
    const roles = (await iam.send(new ListRolesCommand({}))).Roles ?? [];
    let pwdPolicy: any = null;
    try { pwdPolicy = (await iam.send(new GetAccountPasswordPolicyCommand({}))).PasswordPolicy; } catch { /* none */ }
    recon.iam = { users, roles, pwdPolicy };
    await log(audit_id, user_id, "recon", `IAM: ${users.length} users · ${roles.length} roles · password policy: ${pwdPolicy ? "present" : "MISSING"}`, "iam");

    // Misconfig: no password policy
    if (!pwdPolicy) {
      findings.push(mkFinding(audit_id, user_id, "iam", "IAM-PWD-001", "high", "No IAM account password policy configured",
        "AWS account has no password complexity policy. Enables weak passwords across all IAM users.",
        `arn:aws:iam::${conn.aws_account_id}:account`, region,
        { framework_refs: { cis: "1.5-1.11", nist: "IA-5" }, evidence: { passwordPolicy: null } }));
    }

    // Users with access keys + no MFA-ish heuristic
    for (const u of users.slice(0, 25)) {
      try {
        const keys = (await iam.send(new ListAccessKeysCommand({ UserName: u.UserName }))).AccessKeyMetadata ?? [];
        const oldKeys = keys.filter((k) => k.CreateDate && (Date.now() - new Date(k.CreateDate).getTime()) > 90 * 24 * 3600 * 1000);
        if (oldKeys.length) {
          findings.push(mkFinding(audit_id, user_id, "iam", "IAM-KEY-AGE", "medium",
            `IAM user ${u.UserName} has access key older than 90 days`,
            "Long-lived access keys increase breach blast radius. Rotate or migrate to roles.",
            u.Arn, region, { framework_refs: { cis: "1.14" }, evidence: { keys: oldKeys.map((k) => ({ id: k.AccessKeyId, created: k.CreateDate })) } }));
        }
      } catch { /* skip */ }
    }

    // Wildcard trust on roles
    for (const r of roles.slice(0, 50)) {
      const doc = r.AssumeRolePolicyDocument ? decodeURIComponent(r.AssumeRolePolicyDocument) : "";
      if (/"Principal"\s*:\s*"\*"/.test(doc) || /"AWS"\s*:\s*"\*"/.test(doc)) {
        findings.push(mkFinding(audit_id, user_id, "iam", "IAM-TRUST-WILDCARD", "critical",
          `Role ${r.RoleName} trusts wildcard principal (*)`,
          "Any AWS principal can assume this role. Catastrophic privilege escalation surface.",
          r.Arn, region, { framework_refs: { mitre: "T1078.004", cis: "1.16" }, evidence: { trust: doc } }));
      }
    }
  }

  if (services.includes("s3")) {
    await log(audit_id, user_id, "recon", "→ enumerating S3 (buckets, public access, encryption)", "s3");
    const s3 = new S3Client({ region, credentials: creds });
    const buckets = (await s3.send(new ListBucketsCommand({}))).Buckets ?? [];
    recon.s3 = { buckets: buckets.map((b) => b.Name) };
    await log(audit_id, user_id, "recon", `S3: ${buckets.length} buckets`, "s3");
    for (const b of buckets.slice(0, 30)) {
      let enc = true, publicBlock = true, isPublic = false;
      try { await s3.send(new GetBucketEncryptionCommand({ Bucket: b.Name })); } catch { enc = false; }
      try {
        const pab = await s3.send(new GetPublicAccessBlockCommand({ Bucket: b.Name }));
        const cfg = pab.PublicAccessBlockConfiguration;
        publicBlock = !!(cfg?.BlockPublicAcls && cfg?.BlockPublicPolicy && cfg?.IgnorePublicAcls && cfg?.RestrictPublicBuckets);
      } catch { publicBlock = false; }
      try {
        const ps = await s3.send(new GetBucketPolicyStatusCommand({ Bucket: b.Name }));
        isPublic = !!ps.PolicyStatus?.IsPublic;
      } catch { /* none */ }
      if (!enc) findings.push(mkFinding(audit_id, user_id, "s3", "S3-ENC-001", "high",
        `S3 bucket ${b.Name} has no default encryption`, "Objects at rest are not encrypted by default.",
        `arn:aws:s3:::${b.Name}`, region, { framework_refs: { cis: "2.1.1", nist: "SC-28" }, evidence: { encryption: false } }));
      if (!publicBlock) findings.push(mkFinding(audit_id, user_id, "s3", "S3-PAB-001", "high",
        `S3 bucket ${b.Name} missing full Public Access Block`, "Public ACLs/policies can expose data publicly.",
        `arn:aws:s3:::${b.Name}`, region, { framework_refs: { cis: "2.1.5" }, evidence: { publicAccessBlock: false } }));
      if (isPublic) findings.push(mkFinding(audit_id, user_id, "s3", "S3-PUB-001", "critical",
        `S3 bucket ${b.Name} is PUBLIC`, "Bucket policy allows public access — possible data leak.",
        `arn:aws:s3:::${b.Name}`, region, { framework_refs: { cis: "2.1.5", mitre: "T1530" }, evidence: { isPublic: true } }));
    }
  }

  if (services.includes("ec2")) {
    await log(audit_id, user_id, "recon", "→ enumerating EC2 (security groups, EBS, instances)", "ec2");
    const ec2 = new EC2Client({ region, credentials: creds });
    const sgs = (await ec2.send(new DescribeSecurityGroupsCommand({}))).SecurityGroups ?? [];
    const vols = (await ec2.send(new DescribeVolumesCommand({}))).Volumes ?? [];
    recon.ec2 = { sgs: sgs.length, vols: vols.length };
    await log(audit_id, user_id, "recon", `EC2: ${sgs.length} SGs · ${vols.length} EBS volumes`, "ec2");
    for (const sg of sgs) {
      for (const p of sg.IpPermissions ?? []) {
        const open = (p.IpRanges ?? []).some((r) => r.CidrIp === "0.0.0.0/0");
        if (open) {
          const port = p.FromPort === p.ToPort ? `${p.FromPort}` : `${p.FromPort}-${p.ToPort}`;
          const sevPort = [22, 3389, 3306, 5432, 6379, 27017].includes(p.FromPort ?? -1) ? "critical" : "high";
          findings.push(mkFinding(audit_id, user_id, "ec2", "EC2-SG-OPEN", sevPort,
            `Security Group ${sg.GroupId} opens port ${port} to 0.0.0.0/0`,
            `Internet-exposed ${p.IpProtocol}/${port}. Common ingress vector for attackers.`,
            `arn:aws:ec2:${region}:${conn.aws_account_id}:security-group/${sg.GroupId}`, region,
            { framework_refs: { cis: "5.2", mitre: "T1190" }, evidence: { protocol: p.IpProtocol, port } }));
        }
      }
    }
    for (const v of vols.slice(0, 50)) {
      if (v.Encrypted === false) {
        findings.push(mkFinding(audit_id, user_id, "ec2", "EBS-ENC-001", "medium",
          `EBS volume ${v.VolumeId} is unencrypted`, "Data at rest unencrypted on this EBS volume.",
          `arn:aws:ec2:${region}:${conn.aws_account_id}:volume/${v.VolumeId}`, region,
          { framework_refs: { cis: "2.2.1", nist: "SC-28" }, evidence: { encrypted: false } }));
      }
    }
  }

  if (services.includes("rds")) {
    await log(audit_id, user_id, "recon", "→ enumerating RDS instances", "rds");
    const rds = new RDSClient({ region, credentials: creds });
    const dbs = (await rds.send(new DescribeDBInstancesCommand({}))).DBInstances ?? [];
    recon.rds = { count: dbs.length };
    await log(audit_id, user_id, "recon", `RDS: ${dbs.length} instances`, "rds");
    for (const d of dbs) {
      if (d.PubliclyAccessible) findings.push(mkFinding(audit_id, user_id, "rds", "RDS-PUB-001", "critical",
        `RDS ${d.DBInstanceIdentifier} is publicly accessible`, "Database is reachable from the internet.",
        d.DBInstanceArn, region, { framework_refs: { cis: "2.3.3" }, evidence: { publiclyAccessible: true } }));
      if (!d.StorageEncrypted) findings.push(mkFinding(audit_id, user_id, "rds", "RDS-ENC-001", "high",
        `RDS ${d.DBInstanceIdentifier} storage unencrypted`, "DB storage is not encrypted at rest.",
        d.DBInstanceArn, region, { framework_refs: { cis: "2.3.1", nist: "SC-28" }, evidence: { storageEncrypted: false } }));
    }
  }

  if (services.includes("lambda")) {
    await log(audit_id, user_id, "recon", "→ enumerating Lambda", "lambda");
    const lam = new LambdaClient({ region, credentials: creds });
    const fns = (await lam.send(new ListFunctionsCommand({}))).Functions ?? [];
    recon.lambda = { count: fns.length };
    await log(audit_id, user_id, "recon", `Lambda: ${fns.length} functions`, "lambda");
    for (const f of fns.slice(0, 30)) {
      try {
        const url = await lam.send(new GetFunctionUrlConfigCommand({ FunctionName: f.FunctionName }));
        if (url.AuthType === "NONE") findings.push(mkFinding(audit_id, user_id, "lambda", "LAMBDA-URL-NOAUTH", "high",
          `Lambda ${f.FunctionName} has unauthenticated function URL`, "Function URL is publicly invokable without auth.",
          f.FunctionArn, region, { framework_refs: { mitre: "T1190" }, evidence: { authType: "NONE", url: url.FunctionUrl } }));
      } catch { /* no URL */ }
      const env = f.Environment?.Variables ?? {};
      const suspect = Object.entries(env).filter(([k]) => /SECRET|TOKEN|PASSWORD|KEY/i.test(k));
      if (suspect.length) findings.push(mkFinding(audit_id, user_id, "lambda", "LAMBDA-ENV-SECRET", "medium",
        `Lambda ${f.FunctionName} has secret-like env vars`, "Plaintext secrets in environment variables. Use Secrets Manager.",
        f.FunctionArn, region, { framework_refs: { nist: "IA-5" }, evidence: { keys: suspect.map(([k]) => k) } }));
    }
  }

  if (services.includes("cloudtrail")) {
    await log(audit_id, user_id, "recon", "→ enumerating CloudTrail", "cloudtrail");
    const ct = new CloudTrailClient({ region, credentials: creds });
    const trails = (await ct.send(new DescribeTrailsCommand({}))).trailList ?? [];
    recon.cloudtrail = { count: trails.length };
    if (trails.length === 0) findings.push(mkFinding(audit_id, user_id, "cloudtrail", "CT-NONE", "critical",
      "No CloudTrail trails configured", "No audit logging — incident response will be blind.",
      `arn:aws:cloudtrail:${region}:${conn.aws_account_id}:*`, region,
      { framework_refs: { cis: "3.1", nist: "AU-2" }, evidence: { trails: 0 } }));
    else {
      for (const t of trails) {
        try {
          const status = await ct.send(new GetTrailStatusCommand({ Name: t.TrailARN! }));
          if (!status.IsLogging) findings.push(mkFinding(audit_id, user_id, "cloudtrail", "CT-STOPPED", "high",
            `CloudTrail ${t.Name} is not logging`, "Trail exists but logging is disabled.",
            t.TrailARN, region, { framework_refs: { cis: "3.1" }, evidence: { isLogging: false } }));
        } catch { /* skip */ }
      }
    }
  }

  if (services.includes("guardduty")) {
    await log(audit_id, user_id, "recon", "→ checking GuardDuty", "guardduty");
    const gd = new GuardDutyClient({ region, credentials: creds });
    const det = (await gd.send(new ListDetectorsCommand({}))).DetectorIds ?? [];
    if (det.length === 0) findings.push(mkFinding(audit_id, user_id, "guardduty", "GD-OFF", "high",
      `GuardDuty disabled in ${region}`, "No threat detection enabled in this region.",
      `arn:aws:guardduty:${region}:${conn.aws_account_id}:*`, region,
      { framework_refs: { nist: "SI-4" }, evidence: { detectors: 0 } }));
  }

  await log(audit_id, user_id, "misconfig", `Misconfig agent evaluated checks · ${findings.length} findings raised`, "summary");

  // Persist findings
  if (findings.length) await admin.from("findings").insert(findings);

  // ===== Critic (LLM) — challenge findings to remove false positives =====
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

  // ===== Attack Path agent (LLM) =====
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
        await log(audit_id, user_id, "attackpath", `⚡ ${p.title} (${p.severity})`, "path");
      }
    } catch (e) {
      await log(audit_id, user_id, "attackpath", `Parsing failed: ${e}`, "warn");
    }
  }

  // ===== Remediation agent (LLM) — top critical/high =====
  const top = findings.filter((f) => f.severity === "critical" || f.severity === "high").slice(0, 8);
  if (top.length) {
    await log(audit_id, user_id, "remediation", `→ generating Terraform/CLI fixes for top ${top.length} findings`, "fixes");
    for (const f of top) {
      const remResp = await llm("google/gemini-3-flash-preview", [
        { role: "system", content: "You are an AWS remediation engineer. Output JSON only." },
        { role: "user", content: `For this AWS finding, write a Terraform fix. Respond {title,description,fix_type:"terraform"|"cli",risk:"low"|"medium"|"high",snippet}. Finding: ${JSON.stringify({ check_id: f.check_id, title: f.title, resource_arn: f.resource_arn, evidence: f.evidence })}` },
      ], true);
      try {
        const parsed = JSON.parse(remResp);
        // need DB id of finding (re-query since we inserted bulk)
        const { data: row } = await admin.from("findings").select("id").eq("audit_id", audit_id).eq("check_id", f.check_id).limit(1).single();
        if (row) await admin.from("remediations").insert({
          finding_id: row.id, user_id,
          title: parsed.title, description: parsed.description,
          fix_type: parsed.fix_type, risk: parsed.risk ?? "medium", snippet: parsed.snippet,
        });
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

function mkFinding(audit_id: string, user_id: string, service: string, check_id: string, severity: string,
  title: string, description: string, resource_arn: string | null | undefined, region: string, extra: any) {
  return {
    audit_id, user_id, service, check_id, severity, title, description,
    resource_arn: resource_arn ?? null, region,
    framework_refs: extra.framework_refs ?? null,
    evidence: extra.evidence ?? null,
    confidence: 0.9,
  };
}

async function llm(model: string, messages: any[], json = false): Promise<string> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model, messages,
      ...(json ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? "{}";
}