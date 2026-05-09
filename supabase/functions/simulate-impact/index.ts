import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;

async function ai(system: string, user: string): Promise<any> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`AI gateway ${res.status}: ${await res.text()}`);
  const j = await res.json();
  const content = j.choices?.[0]?.message?.content ?? "{}";
  try { return JSON.parse(content); } catch { return { raw: content }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const user_id = userData.user.id;

    const body = await req.json();
    const mode = body.mode as "blast_radius" | "effective_permissions" | "suggest_principals";
    const connection_id = body.connection_id as string | undefined;
    if (!mode) return new Response(JSON.stringify({ error: "mode required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Pull the latest completed audit for this connection (if specified) to ground the simulation
    let auditQuery = admin.from("audits").select("id, summary, scope").eq("user_id", user_id).eq("status", "completed").order("completed_at", { ascending: false }).limit(1);
    if (connection_id) auditQuery = auditQuery.eq("connection_id", connection_id);
    const { data: audits } = await auditQuery;
    const latest = audits?.[0];

    let findings: any[] = [];
    let paths: any[] = [];
    if (latest?.id) {
      const { data: f } = await admin.from("findings").select("check_id,title,service,severity,resource_arn,region,evidence,status_lifecycle").eq("audit_id", latest.id).limit(200);
      const { data: p } = await admin.from("attack_paths").select("title,severity,narrative,graph").eq("audit_id", latest.id).limit(50);
      findings = f ?? [];
      paths = p ?? [];
    }

    if (mode === "suggest_principals") {
      const system = `You are an AWS IAM principal recommender. Given audit findings and attack paths, return up to 8 distinct, real-looking IAM principals worth investigating with an effective-permissions explorer. Prefer principals that show up in evidence, attack-path graphs, or findings (roles, users, federated identities). For each, include an ARN if known, a short name, the principal type, and a one-line reason explaining why it is interesting from a blast-radius perspective.
Strict JSON: {"candidates":[{"arn": string|null, "name": string, "type": "role"|"user"|"federated"|"service", "reason": string, "risk_hint": "low"|"medium"|"high"|"critical"}]}`;
      const user = JSON.stringify({ audit_summary: latest?.summary ?? null, findings: findings.slice(0, 120), paths: paths.slice(0, 15) });
      const result = await ai(system, user);
      return new Response(JSON.stringify({ ok: true, mode, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "blast_radius") {
      const target = body.target as { resource_arn?: string; service?: string; change?: string };
      if (!target?.change) return new Response(JSON.stringify({ error: "target.change required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const system = `You are an AWS blast-radius simulator for cloud security engineers.
Given a proposed change to a single AWS resource, output a JSON object with the projected downstream impact, grounded in the provided audit context. Be concrete, name principals/services, and rank confidence honestly.
Strict JSON shape:
{
  "summary": string,
  "risk_level": "low"|"medium"|"high"|"critical",
  "confidence": number (0..1),
  "impacted": [{"type": "principal"|"service"|"resource"|"workflow", "name": string, "reason": string, "severity": "info"|"warn"|"break"}],
  "preconditions": string[],
  "rollback_steps": string[],
  "evidence_refs": [{"finding_check_id"?: string, "path_title"?: string, "note": string}]
}`;
      const user = JSON.stringify({ target, audit_summary: latest?.summary ?? null, findings: findings.slice(0, 80), paths: paths.slice(0, 10) });
      const result = await ai(system, user);
      return new Response(JSON.stringify({ ok: true, mode, target, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (mode === "effective_permissions") {
      const principal = body.principal as { arn?: string; type?: string; name?: string };
      if (!principal?.arn && !principal?.name) return new Response(JSON.stringify({ error: "principal.arn or principal.name required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const system = `You are an AWS IAM effective-permissions explorer for cloud security engineers.
Given a principal (user/role) and the audit context (findings + attack paths), compute the effective permissions across:
- attached identity policies, inline policies, group policies
- assumed roles via sts:AssumeRole chains (transitive, max depth 3)
- resource-based policies that grant access to this principal
- permission boundaries and SCPs that restrict it
Output a reachability-style JSON. ALWAYS populate effective_actions with at least 5 best-effort entries inferred from the principal's name, service context, related findings, and common AWS role patterns — mark uncertain entries clearly in the "notes" field (e.g. "inferred from role name, not confirmed by policy document"). Never return an empty effective_actions array unless the principal genuinely has zero permissions. Be honest about uncertainty in the gaps array; each gap should be a short, standalone bullet (one issue per string, no run-on sentences).
Strict JSON shape:
{
  "principal": {"arn": string, "type": string},
  "summary": string,
  "risk_level": "low"|"medium"|"high"|"critical",
  "confidence": number (0..1),
  "effective_actions": [{"action": string, "resource": string, "via": string, "boundary_blocks": boolean, "notes": string}],
  "assumable_roles": [{"role_arn": string, "via": string, "depth": number}],
  "reachable_resources": [{"arn": string, "actions": string[], "path": string[]}],
  "toxic_combinations": [{"name": string, "reason": string, "severity": "warn"|"high"|"critical"}],
  "gaps": string[]
}`;
      const user = JSON.stringify({ principal, audit_summary: latest?.summary ?? null, findings: findings.slice(0, 120), paths: paths.slice(0, 10) });
      const result = await ai(system, user);
      return new Response(JSON.stringify({ ok: true, mode, principal, result }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown mode" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});