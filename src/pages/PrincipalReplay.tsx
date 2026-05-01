import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, History, AlertTriangle, ShieldAlert, Activity, Trash2 } from "lucide-react";
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

  async function load() {
    const { data: c } = await supabase.from("aws_connections").select("id, account_label, aws_account_id, default_region").order("created_at", { ascending: false });
    setConns(c ?? []);
    if (!connectionId && c?.[0]) setConnectionId(c[0].id);
    const { data } = await supabase.from("principal_replays").select("*").order("created_at", { ascending: false }).limit(100);
    setRows(data ?? []);
  }
  useEffect(() => { load(); }, []);

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
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <History className="h-3 w-3" /> CloudTrail Replay · 90-day behavioral profile
          </div>
          <h1 className="font-display text-3xl font-bold">What did this principal actually do?</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Replay every API call an IAM principal made in the last 90 days. Blastline's AI profiles their behavior, surfaces anomalies, and tells you whether their permissions match reality — not just what's written in policy.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <select value={connectionId} onChange={(e) => setConnectionId(e.target.value)}
              className="md:col-span-3 bg-background border border-border rounded-md px-3 py-2 text-sm font-mono">
              {conns.map((c) => <option key={c.id} value={c.id}>{c.account_label} ({c.aws_account_id})</option>)}
            </select>
            <Input value={arn} onChange={(e) => setArn(e.target.value)}
              placeholder="arn:aws:iam::123456789012:user/alice  or  arn:aws:iam::123456789012:role/deploy"
              className="md:col-span-7 font-mono text-sm" />
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="md:col-span-1 bg-background border border-border rounded-md px-2 py-2 text-sm font-mono">
              {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d}d</option>)}
            </select>
            <Button onClick={run} disabled={running} className="md:col-span-1">
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Replay"}
            </Button>
          </div>
          <div className="text-xs font-mono text-muted-foreground">
            Pulls real CloudTrail LookupEvents · attributes by Username · runs Gemini-class AI for behavioral analysis
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-1 space-y-2">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Recent replays</div>
            {rows.length === 0 && <div className="text-sm text-muted-foreground">No replays yet.</div>}
            {rows.map((r) => (
              <button key={r.id} onClick={() => setActive(r)}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${active?.id === r.id ? "border-primary bg-primary/5" : "border-border bg-card/60 hover:border-primary/40"}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-mono text-xs truncate">{r.principal_arn.split("/").pop()}</div>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border">{r.ai_risk_score}/100</span>
                </div>
                <div className="text-[11px] text-muted-foreground font-mono mt-1 flex items-center gap-2">
                  <Activity className="h-3 w-3" /> {r.event_count} events
                  <span>·</span>
                  <span>{new Date(r.window_start).toLocaleDateString()} → {new Date(r.window_end).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>

          <div className="lg:col-span-2">
            {!active && <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Select or run a replay to see the behavioral profile.</div>}
            {active && (
              <div className="space-y-4">
                <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-mono text-muted-foreground">Principal</div>
                      <div className="font-mono text-sm break-all">{active.principal_arn}</div>
                      <div className="mt-2 flex items-center gap-2 flex-wrap text-xs font-mono text-muted-foreground">
                        <span>{active.event_count} events</span>
                        <span>·</span>
                        <span>{new Date(active.window_start).toLocaleDateString()} → {new Date(active.window_end).toLocaleDateString()}</span>
                        <span>·</span>
                        <span>account {active.account_id ?? "?"}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono px-2 py-1 rounded border ${active.ai_risk_score >= 70 ? "border-destructive/50 text-destructive bg-destructive/10" : active.ai_risk_score >= 40 ? "border-orange-500/50 text-orange-400 bg-orange-500/10" : "border-success/50 text-success bg-success/10"}`}>
                        AI risk {active.ai_risk_score}/100
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => del(active.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                  <div className="mt-4 text-sm leading-relaxed">{active.ai_summary}</div>
                </div>

                {(active.anomalies as any[])?.length > 0 && (
                  <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
                    <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
                      <AlertTriangle className="h-3.5 w-3.5" /> Anomalies detected
                    </div>
                    <div className="space-y-2">
                      {(active.anomalies as any[]).map((a, i) => (
                        <div key={i} className="rounded-lg border border-border p-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${SEV_COLOR[a.severity] ?? "border-border"}`}>{a.severity}</span>
                            <div className="font-medium text-sm">{a.title}</div>
                          </div>
                          {a.evidence && <div className="text-xs text-muted-foreground mt-1.5 font-mono">{a.evidence}</div>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
                  <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">
                    <ShieldAlert className="h-3.5 w-3.5" /> Top APIs called
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {(active.top_apis as any[])?.slice(0, 20).map((a, i) => (
                      <div key={i} className="flex items-center justify-between text-xs font-mono py-1 border-b border-border/40">
                        <span className="truncate">{a.api}</span>
                        <span className="text-muted-foreground">{a.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}