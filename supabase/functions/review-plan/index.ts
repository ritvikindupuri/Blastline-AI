import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function ai(system: string, user: string, model = "google/gemini-2.5-flash"): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (res.status === 429) throw new Error("Rate limited — please try again in a minute.");
  if (res.status === 402) throw new Error("AI credits exhausted — add funds in Settings → Workspace → Usage.");
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(content); } catch { return { raw: content }; }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const body = await req.json();
    const planText = String(body.plan_text ?? "").slice(0, 60_000);
    const planFormat = String(body.format ?? "auto"); // "terraform" | "cloudformation" | "auto"
    const connectionId = body.connection_id as string | undefined;
    if (!planText || planText.length < 20) return json({ error: "plan_text too short" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Pull latest audit context (findings + paths) for grounding
    let auditQuery = admin
      .from("audits").select("id, summary, scope, connection_id")
      .eq("user_id", user.id).eq("status", "completed")
      .order("completed_at", { ascending: false }).limit(1);
    if (connectionId) auditQuery = auditQuery.eq("connection_id", connectionId);
    const { data: audits } = await auditQuery;
    const latest = audits?.[0];

    let findings: any[] = [];
    let paths: any[] = [];
    if (latest?.id) {
      const { data: f } = await admin.from("findings")
        .select("check_id,title,service,severity,resource_arn,region,evidence")
        .eq("audit_id", latest.id).limit(150);
      const { data: p } = await admin.from("attack_paths")
        .select("title,severity,narrative")
        .eq("audit_id", latest.id).limit(20);
      findings = f ?? [];
      paths = p ?? [];
    }

    // ---------- Step 1: Parse the plan into structured changes ----------
    const parseSystem = `You are a Terraform/CloudFormation plan parser. Given raw plan output, extract every proposed resource change.
Detect format automatically (terraform plan, terraform show -json, CloudFormation change set, raw diff).
Return STRICT JSON with this shape:
{
  "format_detected": "terraform" | "cloudformation" | "diff" | "unknown",
  "changes": [
    {
      "id": string,                              // stable id like "aws_s3_bucket.logs"
      "action": "create" | "update" | "delete" | "replace" | "read",
      "resource_type": string,                   // e.g. "aws_s3_bucket", "AWS::IAM::Role", "Microsoft.Storage..." (AWS only normally)
      "address": string,                         // terraform address or logical CFN id
      "service": string,                         // short: "s3", "iam", "ec2", "rds", "lambda", "kms", "secretsmanager", "sg", "vpc", "cloudfront", "other"
      "name": string,                            // human label
      "key_attributes": Record<string, string>,  // 3-8 most security-relevant attributes (policy, public flag, encryption, ingress, etc.)
      "diff_summary": string                     // 1-2 sentence plain-English description of what changes
    }
  ]
}
Rules:
- Cap at 25 changes max. Prioritize destructive (delete/replace) and IAM/SG/S3/KMS/RDS/Lambda/Secrets changes.
- Skip pure tag-only changes unless that's all there is.
- Never invent resources not present in the input.`;
    const parsed = await ai(parseSystem, JSON.stringify({ format_hint: planFormat, plan_text: planText }), "google/gemini-2.5-flash");
    const changes = Array.isArray(parsed?.changes) ? parsed.changes.slice(0, 25) : [];
    const formatDetected = parsed?.format_detected ?? "unknown";

    if (changes.length === 0) {
      return json({ ok: true, format_detected: formatDetected, changes: [], reviews: [], overall: { verdict: "block", summary: "No resource changes detected. Paste the output of `terraform plan` or a CloudFormation change set." } });
    }

    // ---------- Step 2: Review each change against the audit context ----------
    const reviewSystem = `You are an AWS pre-merge change reviewer for cloud security engineers.
Given ONE proposed Terraform/CloudFormation change and the engineer's latest audit context (findings + attack paths), produce a strict JSON review.
Be concrete: name principals/services that break or get exposed, cite specific findings/paths when relevant, and rank confidence honestly.
Be strict on destructive actions, IAM blast, public exposure, encryption removal, and KMS/secret deletions.
Return JSON:
{
  "verdict": "ship" | "warn" | "block",
  "risk_level": "low" | "medium" | "high" | "critical",
  "confidence": number,
  "summary": string,
  "issues": [{"severity": "info"|"warn"|"high"|"critical", "title": string, "detail": string}],
  "impacted": [{"type": "principal"|"service"|"resource"|"workflow", "name": string, "reason": string}],
  "preconditions": string[],
  "rollback_steps": string[],
  "pr_comment": string,                  // ready-to-paste GitHub PR review comment, markdown, < 600 chars
  "evidence_refs": [{"finding_check_id"?: string, "path_title"?: string, "note": string}]
}`;

    // Trim audit context per call to keep latency low
    const auditContext = {
      audit_summary: latest?.summary ?? null,
      findings: findings.slice(0, 60),
      paths: paths.slice(0, 8),
    };

    const reviews = await Promise.all(changes.map(async (ch: any) => {
      try {
        const out = await ai(
          reviewSystem,
          JSON.stringify({ change: ch, context: auditContext }),
          "google/gemini-2.5-flash",
        );
        return { change_id: ch.id, ...out };
      } catch (e: any) {
        return { change_id: ch.id, verdict: "warn", risk_level: "medium", confidence: 0, summary: `Review failed: ${e.message ?? e}`, issues: [], impacted: [], preconditions: [], rollback_steps: [], pr_comment: "", evidence_refs: [] };
      }
    }));

    // ---------- Step 3: Roll up to overall verdict ----------
    const verdictRank: Record<string, number> = { ship: 0, warn: 1, block: 2 };
    const overallVerdict = reviews.reduce((acc, r) => verdictRank[r.verdict] > verdictRank[acc] ? r.verdict : acc, "ship" as string);
    const blockCount = reviews.filter((r) => r.verdict === "block").length;
    const warnCount = reviews.filter((r) => r.verdict === "warn").length;
    const overallSummary =
      overallVerdict === "block" ? `${blockCount} blocking issue${blockCount === 1 ? "" : "s"} found — do not merge as-is.` :
      overallVerdict === "warn"  ? `${warnCount} warning${warnCount === 1 ? "" : "s"} — review carefully before merging.` :
      `Looks safe to ship. ${changes.length} change${changes.length === 1 ? "" : "s"} reviewed.`;

    return json({
      ok: true,
      format_detected: formatDetected,
      changes,
      reviews,
      overall: { verdict: overallVerdict, summary: overallSummary, blocking: blockCount, warnings: warnCount, audit_id: latest?.id ?? null },
    });
  } catch (e: any) {
    console.error("review-plan error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});