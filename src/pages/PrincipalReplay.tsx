import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, History, AlertTriangle, ShieldAlert, Activity, Trash2, User, Calendar, Cloud, Sparkles, BarChart3, Wand2, RefreshCw } from "lucide-react";
import { toast } from "sonner";

const SEV_COLOR: Record<string, string> = {
  critical: "border-destructive/50 text-destructive bg-destructive/10",
  high: "border-orange-500/50 text-orange-400 bg-orange-500/10",
  medium: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
  low: "border-blue-500/50 text-blue-400 bg-blue-500/10",
};

export default function PrincipalReplay() {
  const [conns, setConns] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [arn, setArn] = useState("");
  const [days, setDays] = useState(90);
  const [running, setRunning] = useState(false);
  const [rows, setRows] = useState<any[]>([]);
  const [active, setActive] = useState<any | null>(null);
  const [principals, setPrincipals] = useState<any[]>([]);
  const [loadingPrincipals, setLoadingPrincipals] = useState(false);
  const [suggesting, setSuggesting] = useState(false);

  async function load() {
    const { data: c } = await supabase.from("aws_connections").select("id, account_label, aws_account_id, default_region").order("created_at", { ascending: false });
    setConns(c ?? []);
    if (!connectionId && c?.[0]) setConnectionId(c[0].id);
    const { data } = await supabase.from("principal_replays").select("*").order("created_at", { ascending: false }).limit(100);
    setRows(data ?? []);
  }
  useEffect(() => { load(); }, []);

  // Auto-fetch principals whenever the connection changes
  useEffect(() => {
    if (!connectionId) return;
    setPrincipals([]);
    setArn("");
    fetchPrincipals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId]);

  async function fetchPrincipals() {
    if (!connectionId) return;
    setLoadingPrincipals(true);
    const { data, error } = await supabase.functions.invoke("list-aws-resources", {
      body: { connection_id: connectionId, service: "iam" },
    });
    setLoadingPrincipals(false);
    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Failed to load principals");
      return;
    }
    const items = (data?.items ?? []) as any[];
    setPrincipals(items);
    if (items[0] && !arn) setArn(items[0].arn);
  }

  async function suggestPrincipal() {
    if (principals.length === 0) {
      toast.error("No principals loaded yet");
      return;
    }
    setSuggesting(true);
    try {
      // Heuristic agent: prefer human IAM users, then non-service roles with broad names
      const score = (p: any) => {
        const a = (p.arn || "").toLowerCase();
        const h = (p.hint || "").toLowerCase();
        let s = 0;
        if (h.includes("user")) s += 50;
        if (/admin|root|power|deploy|ci|terraform|ops/.test(a)) s += 40;
        if (a.includes(":role/")) s += 20;
        if (a.includes("service-role") || a.includes("aws-service-role")) s -= 100;
        return s;
      };
      const ranked = [...principals].sort((a, b) => score(b) - score(a));
      const pick = ranked[0];
      setArn(pick.arn);
      toast.success(`AI picked ${pick.label || pick.arn.split("/").pop()}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function run() {
    if (!connectionId || !arn) return toast.error("Pick a connection and enter a principal ARN");
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("cloudtrail-replay", {
      body: { connection_id: connectionId, principal_arn: arn, days },
    });
    setRunning(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    toast.success(`Replayed ${data?.replay?.event_count ?? 0} events`);
    setActive(data.replay);
    load();
  }

  async function del(id: string) {
    await supabase.from("principal_replays").delete().eq("id", id);
    if (active?.id === id) setActive(null);
    load();
  }

  return (
    <AppShell>
      <div className="space-y-8 max-w-[1400px]">
        {/* HERO */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card/80 to-background p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)] pointer-events-none" />
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 text-[11px] font-mono text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                <History className="h-3 w-3" /> CLOUDTRAIL REPLAY
              </div>
              <h1 className="font-display text-4xl font-bold mt-3 tracking-tight">
                What did this principal <span className="text-primary">actually do?</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                Replay up to 90 days of real API activity for any IAM principal. Blastline's AI profiles
                their behavior, surfaces anomalies, and tells you whether their permissions match reality.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[280px]">
              <Stat label="Replays" value={String(rows.length)} />
              <Stat label="Avg risk" value={rows.length ? String(Math.round(rows.reduce((s, r) => s + (r.ai_risk_score || 0), 0) / rows.length)) : "—"} />
              <Stat label="Window" value="90d" />
            </div>
          </div>
        </section>

        {/* CONFIG */}
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
          <header className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">New Replay</span>
            </div>
          </header>
          <div className="p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <Field label="AWS Account" icon={Cloud} cols="md:col-span-3">
              <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}
                className="w-full bg-background border border-border rounded-md px-3 h-10 text-sm font-mono focus:border-primary outline-none">
                {conns.map((c) => <option key={c.id} value={c.id}>{c.account_label} ({c.aws_account_id})</option>)}
              </select>
            </Field>
            <Field label="Principal" icon={User} cols="md:col-span-6">
              <div className="flex gap-2">
                <select
                  value={principals.some((p) => p.arn === arn) ? arn : ""}
                  onChange={(e) => setArn(e.target.value)}
                  disabled={loadingPrincipals || principals.length === 0}
                  className="flex-1 min-w-0 bg-background border border-border rounded-md px-3 h-10 text-sm font-mono focus:border-primary outline-none disabled:opacity-50"
                >
                  {loadingPrincipals && <option value="">Loading principals…</option>}
                  {!loadingPrincipals && principals.length === 0 && <option value="">No principals found</option>}
                  {!loadingPrincipals && principals.length > 0 && (
                    <>
                      <option value="">Select a principal…</option>
                      <optgroup label="IAM Users">
                        {principals.filter((p) => (p.hint || "").toLowerCase().includes("user")).map((p) => (
                          <option key={p.arn} value={p.arn}>{p.label} — {p.arn}</option>
                        ))}
                      </optgroup>
                      <optgroup label="IAM Roles">
                        {principals.filter((p) => (p.hint || "").toLowerCase().includes("role")).map((p) => (
                          <option key={p.arn} value={p.arn}>{p.label} — {p.arn}</option>
                        ))}
                      </optgroup>
                    </>
                  )}
                </select>
                <Button type="button" variant="outline" size="sm" onClick={fetchPrincipals} disabled={loadingPrincipals || !connectionId}
                  className="h-10 px-2.5" title="Refresh principals from AWS">
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingPrincipals ? "animate-spin" : ""}`} />
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={suggestPrincipal} disabled={suggesting || principals.length === 0}
                  className="h-10 px-2.5 gap-1.5 border-primary/40 text-primary hover:bg-primary/10" title="Let the agent pick the most interesting principal">
                  <Wand2 className="h-3.5 w-3.5" /> AI pick
                </Button>
              </div>
              {arn && !principals.some((p) => p.arn === arn) && (
                <Input value={arn} onChange={(e) => setArn(e.target.value)} className="font-mono text-xs h-8 mt-2" placeholder="Or paste a custom ARN" />
              )}
            </Field>
            <Field label="Window" icon={Calendar} cols="md:col-span-1">
              <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="w-full bg-background border border-border rounded-md px-2 h-10 text-sm font-mono focus:border-primary outline-none">
                {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}d</option>)}
              </select>
            </Field>
            <div className="md:col-span-2">
              <Button onClick={run} disabled={running} className="w-full h-10 font-medium">
                {running ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Replaying…</> : <>Run Replay</>}
              </Button>
            </div>
          </div>
        </section>

        {/* MAIN GRID */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Sidebar */}
          <aside className="lg:col-span-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Recent Replays</h2>
              <span className="text-[10px] font-mono text-muted-foreground">{rows.length}</span>
            </div>
            {rows.length === 0 && (
              <div className="rounded-xl border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                No replays yet. Run your first one above.
              </div>
            )}
            <div className="space-y-2">
              {rows.map((r) => {
                const isActive = active?.id === r.id;
                const risk = r.ai_risk_score ?? 0;
                const ringColor = risk >= 70 ? "bg-destructive" : risk >= 40 ? "bg-orange-400" : "bg-success";
                return (
                  <button key={r.id} onClick={() => setActive(r)}
                    className={`w-full text-left rounded-xl border p-3.5 transition-all ${isActive ? "border-primary bg-primary/5 shadow-card" : "border-border bg-card/40 hover:border-primary/40 hover:bg-card/60"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`h-1.5 w-1.5 rounded-full ${ringColor}`} />
                        <div className="font-mono text-xs truncate">{r.principal_arn.split("/").pop()}</div>
                      </div>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-background border border-border">{risk}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground font-mono mt-2 flex items-center gap-2">
                      <Activity className="h-3 w-3" /> {r.event_count} events
                      <span className="opacity-50">·</span>
                      <span>{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Detail */}
          <div className="lg:col-span-8">
            {!active ? (
              <div className="rounded-2xl border border-dashed border-border p-16 text-center">
                <History className="h-10 w-10 text-muted-foreground/40 mx-auto mb-3" />
                <div className="text-sm text-muted-foreground">Select a replay or run a new one to see the behavioral profile.</div>
              </div>
            ) : (
              <div className="space-y-5">
                {/* Profile header */}
                <div className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <User className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Behavioral Profile</span>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => del(active.id)} className="h-7 text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-sm break-all text-foreground">{active.principal_arn}</div>
                        <div className="mt-3 flex items-center gap-4 flex-wrap text-xs font-mono text-muted-foreground">
                          <span className="flex items-center gap-1.5"><Activity className="h-3 w-3" /> {active.event_count} events</span>
                          <span className="flex items-center gap-1.5"><Calendar className="h-3 w-3" /> {new Date(active.window_start).toLocaleDateString()} → {new Date(active.window_end).toLocaleDateString()}</span>
                          <span className="flex items-center gap-1.5"><Cloud className="h-3 w-3" /> acct {active.account_id ?? "?"}</span>
                        </div>
                      </div>
                      <RiskBadge score={active.ai_risk_score} />
                    </div>
                    {active.ai_summary && (
                      <div className="mt-4 pt-4 border-t border-border text-sm leading-relaxed text-foreground/90">
                        {active.ai_summary}
                      </div>
                    )}
                  </div>
                </div>

                {/* Anomalies */}
                {(active.anomalies as any[])?.length > 0 && (
                  <div className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
                    <div className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-3.5 w-3.5 text-orange-400" />
                        <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Anomalies Detected</span>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">{(active.anomalies as any[]).length} found</span>
                    </div>
                    <div className="p-5 space-y-2">
                      {(active.anomalies as any[]).map((a, i) => (
                        <div key={i} className="rounded-lg border border-border bg-background/30 p-3.5 hover:border-primary/30 transition-colors">
                          <div className="flex items-center gap-2.5">
                            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_COLOR[a.severity] ?? "border-border"}`}>{a.severity}</span>
                            <div className="font-medium text-sm">{a.title}</div>
                          </div>
                          {a.evidence && <div className="text-xs text-muted-foreground mt-2 font-mono leading-relaxed pl-1">{a.evidence}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Top APIs */}
                <div className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
                  <div className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <BarChart3 className="h-3.5 w-3.5 text-primary" />
                      <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Top APIs Called</span>
                    </div>
                    <span className="text-[10px] font-mono text-muted-foreground">by frequency</span>
                  </div>
                  <div className="p-5">
                    <ApiBars apis={(active.top_apis as any[]) ?? []} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 backdrop-blur px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-display text-xl font-bold mt-0.5">{value}</div>
    </div>
  );
}

function Field({ label, icon: Icon, cols, children }: { label: string; icon: any; cols: string; children: React.ReactNode }) {
  return (
    <div className={cols}>
      <label className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5 mb-1.5">
        <Icon className="h-3 w-3" /> {label}
      </label>
      {children}
    </div>
  );
}

function RiskBadge({ score }: { score: number }) {
  const s = score ?? 0;
  const tone = s >= 70 ? "border-destructive/50 text-destructive bg-destructive/10" : s >= 40 ? "border-orange-500/50 text-orange-400 bg-orange-500/10" : "border-success/50 text-success bg-success/10";
  const label = s >= 70 ? "HIGH RISK" : s >= 40 ? "ELEVATED" : "LOW RISK";
  return (
    <div className={`rounded-xl border px-4 py-2.5 text-right ${tone}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider opacity-80">{label}</div>
      <div className="font-display text-2xl font-bold leading-none mt-0.5">{s}<span className="text-xs opacity-60">/100</span></div>
    </div>
  );
}

function ApiBars({ apis }: { apis: any[] }) {
  const top = apis.slice(0, 12);
  const max = Math.max(1, ...top.map((a) => a.count));
  if (top.length === 0) return <div className="text-xs text-muted-foreground font-mono">No API activity recorded.</div>;
  return (
    <div className="space-y-1.5">
      {top.map((a, i) => (
        <div key={i} className="grid grid-cols-[1fr_auto] gap-3 items-center text-xs font-mono">
          <div className="relative h-6 bg-background/40 rounded border border-border/40 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-primary/15 border-r border-primary/40" style={{ width: `${(a.count / max) * 100}%` }} />
            <div className="absolute inset-0 flex items-center px-2 truncate">{a.api}</div>
          </div>
          <div className="text-muted-foreground tabular-nums w-10 text-right">{a.count}</div>
        </div>
      ))}
    </div>
  );
}