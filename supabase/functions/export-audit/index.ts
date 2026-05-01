import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

function csvEscape(v: any): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildCSV(rows: any[], cols: string[]): string {
  const header = cols.join(",");
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return header + "\n" + body;
}

// Minimal single-page PDF (no deps). Good enough for an executive summary.
function buildPDF(title: string, lines: string[]): Uint8Array {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const wrappedLines: string[] = [];
  for (const l of lines) {
    const chunks = (l ?? "").toString().match(/.{1,95}/g) ?? [""];
    for (const c of chunks) wrappedLines.push(c);
  }
  let y = 760;
  let stream = `BT\n/F1 16 Tf\n50 ${y} Td\n(${esc(title)}) Tj\nET\n`;
  y -= 28;
  stream += `BT\n/F1 9 Tf\n50 ${y} Td\n(Generated ${new Date().toISOString()}) Tj\nET\n`;
  y -= 22;
  for (const ln of wrappedLines) {
    if (y < 50) break;
    stream += `BT\n/F1 10 Tf\n50 ${y} Td\n(${esc(ln)}) Tj\nET\n`;
    y -= 14;
  }
  const enc = new TextEncoder();
  const objs: string[] = [];
  objs.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objs.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n");
  objs.push("3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>\nendobj\n");
  objs.push(`4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}endstream\nendobj\n`);
  objs.push("5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n");
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const o of objs) { offsets.push(pdf.length); pdf += o; }
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${off.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return enc.encode(pdf);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    const audit_id = url.searchParams.get("audit_id");
    const format = (url.searchParams.get("format") ?? "pdf").toLowerCase();
    if (!audit_id) return new Response(JSON.stringify({ error: "audit_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const auth = req.headers.get("Authorization") ?? "";
    const userClient = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: auth } } });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: audit } = await admin.from("audits").select("*, aws_connections(account_label, aws_account_id)").eq("id", audit_id).eq("user_id", userData.user.id).single();
    if (!audit) return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const { data: findings = [] } = await admin.from("findings").select("*").eq("audit_id", audit_id).order("severity");
    const { data: paths = [] } = await admin.from("attack_paths").select("*").eq("audit_id", audit_id);
    const { data: rems = [] } = await admin.from("remediations").select("*").in("finding_id", (findings ?? []).map((f: any) => f.id).length ? (findings ?? []).map((f: any) => f.id) : ["00000000-0000-0000-0000-000000000000"]);

    if (format === "csv") {
      const csv = buildCSV(findings ?? [], ["severity","service","check_id","title","resource_arn","region","status_lifecycle","sla_due_at","critic_verdict","finding_score","account_id"]);
      return new Response(csv, { headers: { ...corsHeaders, "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="audit-${audit_id}.csv"` } });
    }

    const conn = (audit as any).aws_connections ?? {};
    const counts = {
      critical: (findings ?? []).filter((f: any) => f.severity === "critical").length,
      high: (findings ?? []).filter((f: any) => f.severity === "high").length,
      medium: (findings ?? []).filter((f: any) => f.severity === "medium").length,
    };
    const lines = [
      `Account: ${conn.account_label ?? "—"} (${conn.aws_account_id ?? "—"})`,
      `Status: ${audit.status} · Risk score: ${audit.risk_score ?? "—"}`,
      `Findings: ${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${(findings ?? []).length} total`,
      `Attack paths: ${(paths ?? []).length} · Remediations proposed: ${(rems ?? []).length}`,
      "",
      "Top findings:",
      ...((findings ?? []).slice(0, 25).map((f: any) => `  [${(f.severity ?? "").toUpperCase()}] ${f.check_id} — ${f.title}`)),
      "",
      "Attack paths:",
      ...((paths ?? []).map((p: any) => `  · ${p.title} (${p.severity})`)),
    ];
    const pdf = buildPDF(`Trace Audit Report — ${audit_id.slice(0, 8)}`, lines);
    return new Response(pdf, { headers: { ...corsHeaders, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="audit-${audit_id}.pdf"` } });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});