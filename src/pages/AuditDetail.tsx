import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { AGENT_META, FALLBACK_AGENT, SEV_RING, type Severity } from "@/lib/severity";
import { Loader2, CheckCircle2, XCircle, Network as NetIcon, ExternalLink, Terminal, ChevronRight, FileDown, FileSpreadsheet, PlayCircle, ShieldCheck, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

function awsConsoleFor(finding?: any, remediation?: any) {
  if (remediation?.aws_console_url) return remediation.aws_console_url;
  const region = finding?.region || "us-east-1";
  const service = String(finding?.service || "").toLowerCase();
  const arn: string = finding?.resource_arn || "";
  if (service === "iam" && arn) {
    if (arn.includes(":user/")) return `https://us-east-1.console.aws.amazon.com/iam/home#/users/details/${encodeURIComponent(arn.split(":user/")[1])}`;
    if (arn.includes(":role/")) return `https://us-east-1.console.aws.amazon.com/iam/home#/roles/details/${encodeURIComponent(arn.split(":role/")[1])}`;
    if (arn.includes("password-policy")) return `https://us-east-1.console.aws.amazon.com/iam/home#/account_settings`;
    return "https://us-east-1.console.aws.amazon.com/iam/home#/home";
  }
  if (service === "iam") return "https://us-east-1.console.aws.amazon.com/iam/home#/home";
  if (service === "s3" && arn.startsWith("arn:aws:s3:::")) {
    const bucket = arn.replace("arn:aws:s3:::", "").split("/")[0];
    return `https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(bucket)}?region=${region}&tab=permissions`;
  }
  if (service === "s3") return "https://s3.console.aws.amazon.com/s3/home";
  if (service === "ec2") return `https://${region}.console.aws.amazon.com/ec2/home?region=${region}`;
  if (service === "rds") return `https://${region}.console.aws.amazon.com/rds/home?region=${region}#databases:`;
  if (service === "lambda") return `https://${region}.console.aws.amazon.com/lambda/home?region=${region}#/functions`;
  if (service === "cloudtrail") return `https://${region}.console.aws.amazon.com/cloudtrailv2/home?region=${region}#/dashboard`;
  if (service === "guardduty") return `https://${region}.console.aws.amazon.com/guardduty/home?region=${region}#/findings`;
  if (service === "kms") return `https://${region}.console.aws.amazon.com/kms/home?region=${region}#/kms/keys`;
  return `https://${region}.console.aws.amazon.com/console/home?region=${region}`;
}

export default function AuditDetail() {
  const { id } = useParams();
  const [audit, setAudit] = useState<any>(null);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [paths, setPaths] = useState<any[]>([]);
  const [remediations, setRemediations] = useState<any[]>([]);
  const [busyRemId, setBusyRemId] = useState<string | null>(null);
  const [remError, setRemError] = useState<Record<string, string>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  async function applyRemediation(r: any) {
    setBusyRemId(r.id);
    setRemError((m) => ({ ...m, [r.id]: "" }));
    try {
      // Auto-advance lifecycle if needed: proposed → reviewed → approved → executed
      if (r.lifecycle_state === "proposed" || r.lifecycle_state === "reviewed") {
        const patch: any = { lifecycle_state: "approved" };
        await supabase.from("remediations").update(patch).eq("id", r.id);
      }
      const { data, error } = await supabase.functions.invoke("apply-remediation", { body: { remediation_id: r.id } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      await reload();
    } catch (e: any) {
      setRemError((m) => ({ ...m, [r.id]: e?.message ?? String(e) }));
    } finally {
      setBusyRemId(null);
    }
  }

  async function reload() {
    const [a, t, f, p] = await Promise.all([
      supabase.from("audits").select("*").eq("id", id).single(),
      supabase.from("agent_transcripts").select("*").eq("audit_id", id).order("seq", { ascending: true }),
      supabase.from("findings").select("*").eq("audit_id", id).order("severity"),
      supabase.from("attack_paths").select("*").eq("audit_id", id),
    ]);
    setAudit(a.data);
    setTranscripts(t.data ?? []);
    setFindings(f.data ?? []);
    setPaths(p.data ?? []);
    if (f.data?.length) {
      const { data: r } = await supabase.from("remediations").select("*").in("finding_id", f.data.map((row) => row.id)).order("created_at", { ascending: false });
      setRemediations(r ?? []);
    } else {
      setRemediations([]);
    }
  }

  useEffect(() => {
    if (!id) return;
    reload();
    const ch = supabase.channel(`audit-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "agent_transcripts", filter: `audit_id=eq.${id}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "findings", filter: `audit_id=eq.${id}` }, () => reload())
      .on("postgres_changes", { event: "*", schema: "public", table: "attack_paths", filter: `audit_id=eq.${id}` }, () => reload())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "audits", filter: `id=eq.${id}` }, () => reload())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [transcripts.length]);

  const running = audit?.status === "running" || audit?.status === "queued";

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-mono text-muted-foreground">Audit {id?.slice(0, 8)}</div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-3">
              Audit run
              {running && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
              {audit?.status === "completed" && <CheckCircle2 className="h-5 w-5 text-success" />}
              {audit?.status === "failed" && <XCircle className="h-5 w-5 text-sev-critical" />}
            </h1>
          </div>
          <span className={`text-xs font-mono px-3 py-1 rounded border ${
            audit?.status === "completed" ? "text-success border-success/30 bg-success/10" :
            audit?.status === "failed" ? "text-sev-critical border-sev-critical/30 bg-sev-critical/10" :
            "text-primary border-primary/30 bg-primary/10"
          }`}>{audit?.status ?? "loading"}</span>
        </div>

        {audit?.status === "completed" && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline" className="gap-2">
              <a
                href={`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-audit?audit_id=${id}&format=pdf`}
                target="_blank" rel="noreferrer"
                onClick={async (e) => {
                  e.preventDefault();
                  const { data: s } = await supabase.auth.getSession();
                  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-audit?audit_id=${id}&format=pdf`, { headers: { Authorization: `Bearer ${s.session?.access_token}` } });
                  const blob = await r.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `audit-${id}.pdf`; a.click(); URL.revokeObjectURL(url);
                }}
              ><FileDown className="h-4 w-4" /> Executive PDF</a>
            </Button>
            <Button asChild size="sm" variant="outline" className="gap-2">
              <a
                href="#"
                onClick={async (e) => {
                  e.preventDefault();
                  const { data: s } = await supabase.auth.getSession();
                  const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-audit?audit_id=${id}&format=csv`, { headers: { Authorization: `Bearer ${s.session?.access_token}` } });
                  const blob = await r.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a"); a.href = url; a.download = `audit-${id}.csv`; a.click(); URL.revokeObjectURL(url);
                }}
              ><FileSpreadsheet className="h-4 w-4" /> Engineer CSV</a>
            </Button>
          </div>
        )}

        <div className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-xs font-mono text-muted-foreground">Agent transcript</div>
              <div className="text-xs font-mono text-muted-foreground">{transcripts.length} events</div>
            </div>
            <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto p-3 space-y-2 font-mono text-xs">
              {transcripts.length === 0 && <div className="text-muted-foreground p-3">awaiting agents…</div>}
              {transcripts.map((t) => {
                const meta = AGENT_META[t.agent] ?? { ...FALLBACK_AGENT, label: t.agent };
                const Icon = meta.Icon;
                const data = t.data as any;
                const cmd = data?.command || data?.cmd;
                const output = data?.output || data?.result;
                const thinking = data?.thinking || data?.reasoning;
                return (
                  <div key={t.id} className="rounded-md border border-border/60 bg-background/40 hover:border-border transition-colors">
                    <div className="flex items-start gap-3 px-3 py-2">
                      <div className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${meta.ring}`}>
                        <Icon className={`h-3.5 w-3.5 ${meta.color}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2">
                          <span className={`text-[11px] font-semibold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                          {t.phase && (
                            <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                              <ChevronRight className="h-2.5 w-2.5" />{t.phase}
                            </span>
                          )}
                          <span className="ml-auto text-[10px] text-muted-foreground/70">
                            {new Date(t.created_at).toLocaleTimeString([], { hour12: false })}
                          </span>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-foreground/90 leading-relaxed">{t.content}</div>
                        {thinking && (
                          <div className="mt-2 rounded border border-accent/20 bg-accent/5 px-2 py-1.5 text-[11px] text-accent/90 italic">
                            <span className="not-italic font-semibold mr-1">thinking:</span>{thinking}
                          </div>
                        )}
                        {cmd && (
                          <div className="mt-2">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">$ command</div>
                            <pre className="rounded border border-border bg-background/80 p-2 text-[11px] leading-relaxed text-primary overflow-auto whitespace-pre-wrap break-words">{cmd}</pre>
                          </div>
                        )}
                        {output && (
                          <div className="mt-1.5">
                            <div className="text-[9px] uppercase tracking-wider text-muted-foreground mb-0.5">↳ output</div>
                            <pre className="rounded border border-border bg-background/80 p-2 text-[11px] leading-relaxed text-foreground/80 max-h-40 overflow-auto whitespace-pre-wrap break-words">{typeof output === "string" ? output : JSON.stringify(output, null, 2)}</pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
              <div className="text-xs font-mono text-muted-foreground">Summary</div>
              <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                {(["critical", "high", "medium"] as Severity[]).map((s) => {
                  const v = findings.filter((f) => f.severity === s).length;
                  return (
                    <div key={s} className={`rounded-md border p-2 ${SEV_RING[s]}`}>
                      <div className="font-display text-xl font-bold">{v}</div>
                      <div className="text-[10px] font-mono uppercase">{s}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
              <div className="text-xs font-mono text-muted-foreground">Attack paths</div>
              <div className="mt-2 space-y-2">
                {paths.length === 0 && <div className="text-sm text-muted-foreground">none yet</div>}
                {paths.map((p) => (
                  <Link key={p.id} to={`/attack-paths/${p.id}`}
                    className="flex items-center gap-2 rounded-md border border-border bg-background/50 p-2 hover:border-primary/40">
                    <NetIcon className="h-4 w-4 text-sev-critical" />
                    <span className="text-sm flex-1 truncate">{p.title}</span>
                    <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${SEV_RING[p.severity as Severity] ?? ""}`}>{p.severity}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className="font-display font-semibold mb-3">Findings ({findings.length})</h3>
          <div className="space-y-2">
            {findings.map((f) => (
              <div key={f.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_RING[f.severity as Severity] ?? ""}`}>{f.severity}</span>
                  <span className="text-xs font-mono text-muted-foreground">{f.service} · {f.check_id}</span>
                </div>
                <div className="mt-1 font-medium">{f.title}</div>
                {f.description && <div className="text-sm text-muted-foreground mt-1">{f.description}</div>}
                {f.resource_arn && <div className="mt-2 text-xs font-mono text-muted-foreground truncate">{f.resource_arn}</div>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="font-display font-semibold mb-3">Remediation evidence ({remediations.length})</h3>
          <div className="grid xl:grid-cols-2 gap-3">
            {remediations.length === 0 && <div className="text-sm text-muted-foreground">No remediation scripts generated yet.</div>}
            {remediations.map((r) => {
              const finding = findings.find((f) => f.id === r.finding_id);
              const awsUrl = awsConsoleFor(finding, r);
              const status = r.execution_status ?? "not_applied";
              const isApplied = status === "applied" || r.lifecycle_state === "executed" || r.lifecycle_state === "verified";
              const isFailed = status === "failed";
              const isBusy = busyRemId === r.id;
              return (
                <div key={r.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
                        <Terminal className="h-4 w-4 text-primary" />
                        <span className="text-primary">{r.fix_type}</span>
                        <span className="text-muted-foreground">·</span>
                        <span className={isApplied ? "text-success" : isFailed ? "text-sev-critical" : "text-muted-foreground"}>{status.replace(/_/g, " ")}</span>
                      </div>
                      <div className="mt-2 font-medium">{r.title}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {!isApplied && (
                        <Button size="sm" disabled={isBusy} onClick={() => applyRemediation(r)} className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90">
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                          {isBusy ? "Applying…" : "Apply via AI agent"}
                        </Button>
                      )}
                      {isApplied && (
                        <span className="flex items-center gap-1.5 rounded-md border border-success/40 bg-success/10 px-2 py-1 text-xs font-mono text-success">
                          <ShieldCheck className="h-3.5 w-3.5" /> Applied
                        </span>
                      )}
                      <Button asChild size="sm" variant="outline" className="gap-2 border-border bg-transparent hover:bg-secondary">
                        <a href={awsUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                          {isApplied ? "View result in AWS" : "Review in AWS"} <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </Button>
                    </div>
                  </div>
                  <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed">{r.executed_script || r.snippet}</pre>
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background/70 p-3 text-xs font-mono leading-relaxed text-muted-foreground">{r.execution_output || "Not executed yet — hit \"Apply via AI agent\" and Blastline will run the AWS API calls for you, then deep-link you to the resource."}</pre>
                  {remError[r.id] && (
                    <div className="mt-2 flex items-start gap-2 rounded-md border border-sev-critical/40 bg-sev-critical/10 p-2.5 text-xs font-mono text-sev-critical">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      <div className="flex-1 break-words">{remError[r.id]}</div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </AppShell>
  );
}