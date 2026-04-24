import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { AGENT_META, SEV_RING, type Severity } from "@/lib/severity";
import { Loader2, CheckCircle2, XCircle, Network as NetIcon } from "lucide-react";

export default function AuditDetail() {
  const { id } = useParams();
  const [audit, setAudit] = useState<any>(null);
  const [transcripts, setTranscripts] = useState<any[]>([]);
  const [findings, setFindings] = useState<any[]>([]);
  const [paths, setPaths] = useState<any[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

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

        <div className="grid lg:grid-cols-5 gap-4">
          <div className="lg:col-span-3 rounded-xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <div className="text-xs font-mono text-muted-foreground">Agent transcript</div>
              <div className="text-xs font-mono text-muted-foreground">{transcripts.length} events</div>
            </div>
            <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto p-4 space-y-3 font-mono text-xs">
              {transcripts.length === 0 && <div className="text-muted-foreground">awaiting agents…</div>}
              {transcripts.map((t) => {
                const meta = AGENT_META[t.agent] ?? { label: t.agent, color: "text-foreground", icon: "•" };
                return (
                  <div key={t.id} className="flex gap-3">
                    <div className="w-32 shrink-0">
                      <span className={meta.color}>{meta.icon} {meta.label}</span>
                      {t.phase && <div className="text-muted-foreground text-[10px]">{t.phase}</div>}
                    </div>
                    <div className="flex-1 whitespace-pre-wrap text-foreground/90">{t.content}</div>
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
      </div>
    </AppShell>
  );
}