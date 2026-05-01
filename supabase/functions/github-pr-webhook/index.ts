import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256, x-github-event",
};

const enc = new TextEncoder();
async function hmacSha256Hex(key: string, data: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

// Find a `terraform plan` block inside the PR body or a recent comment
function extractPlan(text: string | null | undefined): string | null {
  if (!text) return null;
  // ```terraform ... ``` or ```hcl ... ``` or ```plan ... ```
  const fenced = text.match(/```(?:terraform|hcl|plan|tf)?\s*([\s\S]*?)```/i);
  if (fenced && /(?:Plan:|will be created|will be destroyed|will be updated|resource ")/i.test(fenced[1])) return fenced[1].trim();
  // raw plan-like content
  if (/Plan:\s*\d+\s*to add/i.test(text)) return text;
  return null;
}

async function aiReview(plan: string): Promise<{ verdict: string; risk: number; summary: string; findings: any[] }> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return { verdict: "comment", risk: 0, summary: "AI key not configured", findings: [] };
  const sys = `You are Blastline, an autonomous cloud security reviewer for Terraform plans. Be concise, decisive, and reason about blast radius.`;
  const usr = `Review this Terraform plan for security risks. Return STRICT JSON:
{"verdict": "approve|comment|block", "risk": 0-100, "summary": "<= 3 sentences", "findings": [{"title": "...", "severity": "low|medium|high|critical", "resource": "<address>", "why": "<reason>", "fix": "<short fix>"}]}

Block (verdict=block) for: public S3 buckets, 0.0.0.0/0 ingress on sensitive ports (22/3389/3306/5432), IAM "*" actions on "*", deleting CloudTrail/GuardDuty, disabling KMS rotation, public RDS/EKS endpoints, removing logging.
Comment for: medium risks, missing tags, encryption defaults.
Approve only if no risks at all.

PLAN:
${plan.slice(0, 12000)}`;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: sys }, { role: "user", content: usr }],
      response_format: { type: "json_object" },
    }),
  });
  if (!r.ok) return { verdict: "comment", risk: 0, summary: `AI review failed: ${(await r.text()).slice(0, 200)}`, findings: [] };
  const j = await r.json();
  try {
    const p = JSON.parse(j?.choices?.[0]?.message?.content ?? "{}");
    return { verdict: p.verdict ?? "comment", risk: Number(p.risk) || 0, summary: p.summary ?? "", findings: p.findings ?? [] };
  } catch {
    return { verdict: "comment", risk: 0, summary: "Could not parse AI response", findings: [] };
  }
}

function renderComment(review: { verdict: string; risk: number; summary: string; findings: any[] }): string {
  const emoji = review.verdict === "block" ? "🛑" : review.verdict === "approve" ? "✅" : "⚠️";
  const head = `## ${emoji} Blastline review · risk ${review.risk}/100 · **${review.verdict.toUpperCase()}**\n\n${review.summary}\n`;
  if (review.findings.length === 0) return head + "\n_No security findings._\n\n— [Blastline](https://blastline.lovable.app) · pre-merge cloud security agent";
  const rows = review.findings.map((f) => `| ${f.severity ?? "?"} | \`${f.resource ?? ""}\` | ${f.title ?? ""} — ${f.why ?? ""} | ${f.fix ?? ""} |`).join("\n");
  return `${head}\n| Severity | Resource | Issue | Fix |\n|---|---|---|---|\n${rows}\n\n— [Blastline](https://blastline.lovable.app) · pre-merge cloud security agent`;
}

async function postComment(token: string, repo: string, prNumber: number, body: string): Promise<{ url?: string; error?: string }> {
  const r = await fetch(`https://api.github.com/repos/${repo}/issues/${prNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "Blastline-PR-Bot",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  if (!r.ok) return { error: `GitHub API ${r.status}: ${(await r.text()).slice(0, 200)}` };
  const j = await r.json();
  return { url: j.html_url };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const url = new URL(req.url);
  const ownerId = url.searchParams.get("owner");

  // Manual trigger path (called from UI for testing) — POST { user_id (auth), repo_full_name, pr_number, plan_text }
  if (url.pathname.endsWith("/manual")) {
    return handleManual(req);
  }

  if (!ownerId) return json({ error: "missing owner query param (user_id)" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(SUPABASE_URL, SERVICE);

  const { data: cfg } = await admin.from("pr_bot_configs").select("*").eq("user_id", ownerId).maybeSingle();
  if (!cfg) return json({ error: "no PR bot config for this owner" }, 404);
  if (!cfg.enabled) return json({ ok: true, skipped: "disabled" });

  const raw = await req.text();
  const sig = req.headers.get("x-hub-signature-256") ?? "";
  if (cfg.webhook_secret) {
    const expected = "sha256=" + (await hmacSha256Hex(cfg.webhook_secret, raw));
    if (!timingSafeEqual(expected, sig)) return json({ error: "invalid signature" }, 401);
  }

  const event = req.headers.get("x-github-event") ?? "";
  if (event === "ping") return json({ ok: true, pong: true });
  if (event !== "pull_request" && event !== "issue_comment") return json({ ok: true, ignored: event });

  let payload: any = {};
  try { payload = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }

  // Extract PR info
  const repoFull = payload.repository?.full_name;
  if (!repoFull) return json({ error: "missing repository" }, 400);
  if (cfg.repo_allowlist?.length && !cfg.repo_allowlist.includes(repoFull)) return json({ ok: true, skipped: "repo not allowlisted" });

  let pr: any, planSource: string | null = null;
  if (event === "pull_request") {
    if (!["opened", "synchronize", "reopened", "edited"].includes(payload.action)) return json({ ok: true, skipped: payload.action });
    pr = payload.pull_request;
    planSource = pr?.body ?? "";
  } else {
    // issue_comment containing plan
    if (payload.action !== "created" || !payload.issue?.pull_request) return json({ ok: true, skipped: "non-pr comment" });
    pr = { number: payload.issue.number, title: payload.issue.title, html_url: payload.issue.html_url, user: payload.issue.user, head: { sha: null } };
    planSource = payload.comment?.body ?? "";
  }

  const plan = extractPlan(planSource);
  if (!plan) {
    // record as no-plan event so UI shows it
    await admin.from("pr_reviews").insert({
      user_id: ownerId, repo_full_name: repoFull, pr_number: pr.number, pr_title: pr.title,
      pr_url: pr.html_url, head_sha: pr.head?.sha ?? null, author: pr.user?.login ?? null,
      plan_text: null, status: "no_plan", verdict: "skipped", ai_summary: "No `terraform plan` block found in PR body or comment.",
    });
    return json({ ok: true, skipped: "no plan found" });
  }

  const review = await aiReview(plan);
  let posted = false, commentUrl: string | undefined, postErr: string | undefined;
  if (cfg.github_token) {
    const res = await postComment(cfg.github_token, repoFull, pr.number, renderComment(review));
    posted = !!res.url;
    commentUrl = res.url;
    postErr = res.error;
  }

  const { data: row } = await admin.from("pr_reviews").insert({
    user_id: ownerId, repo_full_name: repoFull, pr_number: pr.number, pr_title: pr.title,
    pr_url: pr.html_url, head_sha: pr.head?.sha ?? null, author: pr.user?.login ?? null,
    plan_text: plan, verdict: review.verdict, risk_score: review.risk,
    findings: review.findings, ai_summary: review.summary,
    comment_posted: posted, comment_url: commentUrl ?? null,
    status: posted ? "reviewed" : (postErr ? "comment_failed" : "reviewed_no_token"),
    error: postErr ?? null,
  }).select().single();

  return json({ ok: true, review: row });
});

async function handleManual(req: Request): Promise<Response> {
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const { repo_full_name, pr_number, pr_title, pr_url, plan_text } = await req.json();
    if (!plan_text) return json({ error: "plan_text required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: cfg } = await admin.from("pr_bot_configs").select("*").eq("user_id", user.id).maybeSingle();
    const review = await aiReview(plan_text);

    let posted = false, commentUrl: string | undefined, postErr: string | undefined;
    if (cfg?.github_token && repo_full_name && pr_number) {
      const res = await postComment(cfg.github_token, repo_full_name, pr_number, renderComment(review));
      posted = !!res.url; commentUrl = res.url; postErr = res.error;
    }

    const { data: row } = await admin.from("pr_reviews").insert({
      user_id: user.id,
      repo_full_name: repo_full_name ?? "manual/test",
      pr_number: pr_number ?? 0,
      pr_title: pr_title ?? "Manual test",
      pr_url: pr_url ?? null,
      plan_text, verdict: review.verdict, risk_score: review.risk,
      findings: review.findings, ai_summary: review.summary,
      comment_posted: posted, comment_url: commentUrl ?? null,
      status: posted ? "reviewed" : (cfg?.github_token ? "comment_failed" : "reviewed_no_token"),
      error: postErr ?? null,
    }).select().single();
    return json({ ok: true, review: row });
  } catch (e: any) {
    return json({ error: e?.message ?? String(e) }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}