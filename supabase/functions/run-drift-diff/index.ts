import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// dedup key from finding shape (resource + check) to compare across audits
function keyOf(f: any): string {
  return f.dedup_key || `${f.check_id}::${f.resource_arn ?? ""}::${f.account_id ?? ""}`;
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

    const { audit_id } = await req.json();
    if (!audit_id) return json({ error: "audit_id required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: current } = await admin.from("audits").select("*").eq("id", audit_id).eq("user_id", user.id).single();
    if (!current) return json({ error: "audit not found" }, 404);

    // previous completed audit on same connection
    const { data: prev } = await admin
      .from("audits")
      .select("*")
      .eq("user_id", user.id)
      .eq("connection_id", current.connection_id)
      .eq("status", "completed")
      .neq("id", audit_id)
      .lt("created_at", current.created_at)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: curFindings } = await admin.from("findings").select("*").eq("audit_id", audit_id).eq("user_id", user.id);
    const cur = curFindings ?? [];

    if (!prev) {
      const { data: row } = await admin.from("audit_diffs").insert({
        user_id: user.id, connection_id: current.connection_id,
        current_audit_id: audit_id, previous_audit_id: null,
        new_count: cur.length, fixed_count: 0, regressed_count: 0, unchanged_count: 0,
        details: { note: "first audit on this account", new_critical: cur.filter((f: any) => f.severity === "critical").length },
      }).select().single();
      return json({ ok: true, diff: row, baseline: true });
    }

    const { data: prevFindings } = await admin.from("findings").select("*").eq("audit_id", prev.id).eq("user_id", user.id);
    const prevList = prevFindings ?? [];

    const curMap = new Map<string, any>(cur.map((f: any) => [keyOf(f), f]));
    const prevMap = new Map<string, any>(prevList.map((f: any) => [keyOf(f), f]));

    const newOnes: any[] = [];
    const regressed: any[] = [];   // existed in prev as resolved/suppressed, now open
    const fixed: any[] = [];       // existed in prev as open, now resolved or absent
    const unchanged: any[] = [];

    for (const [k, f] of curMap) {
      const p = prevMap.get(k);
      if (!p) { newOnes.push(f); continue; }
      const pOpen = (p.status_lifecycle ?? p.status) === "open";
      const cOpen = (f.status_lifecycle ?? f.status) === "open";
      if (!pOpen && cOpen) regressed.push(f);
      else unchanged.push(f);
    }
    for (const [k, p] of prevMap) {
      const c = curMap.get(k);
      const pOpen = (p.status_lifecycle ?? p.status) === "open";
      const cOpen = c ? (c.status_lifecycle ?? c.status) === "open" : false;
      if (pOpen && !cOpen) fixed.push(p);
    }

    const summarize = (arr: any[]) => arr.slice(0, 50).map((f) => ({
      id: f.id, title: f.title, severity: f.severity, service: f.service, resource_arn: f.resource_arn, account_id: f.account_id,
    }));

    const { data: row, error } = await admin.from("audit_diffs").insert({
      user_id: user.id, connection_id: current.connection_id,
      current_audit_id: audit_id, previous_audit_id: prev.id,
      new_count: newOnes.length, fixed_count: fixed.length, regressed_count: regressed.length, unchanged_count: unchanged.length,
      details: {
        new: summarize(newOnes), fixed: summarize(fixed), regressed: summarize(regressed),
        new_by_severity: countBy(newOnes, "severity"),
        fixed_by_severity: countBy(fixed, "severity"),
        regressed_by_severity: countBy(regressed, "severity"),
      },
    }).select().single();
    if (error) throw error;

    return json({ ok: true, diff: row });
  } catch (e: any) {
    console.error("run-drift-diff error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});

function countBy(arr: any[], key: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of arr) out[x[key] ?? "unknown"] = (out[x[key] ?? "unknown"] ?? 0) + 1;
  return out;
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}