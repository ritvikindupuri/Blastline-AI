import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { GitCompare, TrendingUp, TrendingDown, Minus, RefreshCw, ArrowRight } from "lucide-react";
import { toast } from "sonner";

const SEV: Record<string, string> = {
  critical: "border-destructive/50 text-destructive bg-destructive/10",
  high: "border-orange-500/50 text-orange-400 bg-orange-500/10",
  medium: "border-yellow-500/50 text-yellow-400 bg-yellow-500/10",
  low: "border-blue-500/50 text-blue-400 bg-blue-500/10",
};

export default function Drift() {
  const [diffs, setDiffs] = useState<any[]>([]);
  const [audits, setAudits] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const { data: d } = await supabase.from("audit_diffs").select("*").order("created_at", { ascending: false }).limit(50);
    setDiffs(d ?? []);
    const { data: a } = await supabase.from("audits").select("id, account_label:connection_id, status, created_at").eq("status", "completed").order("created_at", { ascending: false }).limit(50);
    setAudits(a ?? []);
  }
  useEffect(() => { load(); }, []);

  async function runFor(auditId: string) {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("run-drift-diff", { body: { audit_id: auditId } });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    toast.success("Drift computed");
    load();
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
              <GitCompare className="h-3 w-3" /> Drift detection
            </div>
            <h1 className="font-display text-3xl font-bold">What changed since last audit?</h1>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Every audit is compared against the previous run on the same account. New criticals, regressions, and silent fixes are surfaced here — so you find out before your CEO does.
            </p>
          </div>
          {audits[0] && (
            <Button onClick={() => runFor(audits[0].id)} disabled={busy} variant="outline">
              <RefreshCw className={`h-3.5 w-3.5 mr-2 ${busy ? "animate-spin" : ""}`} />
              Recompute latest
            </Button>
          )}
        </div>

        {diffs.length === 0 && (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <div className="text-sm text-muted-foreground mb-3">No drift comparisons yet. Run two audits and Blastline will start tracking changes automatically.</div>
            {audits[0] && <Button onClick={() => runFor(audits[0].id)} disabled={busy}>Compute drift for latest audit</Button>}
          </div>
        )}

        <div className="space-y-4">
          {diffs.map((d) => (
            <div key={d.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div className="text-xs font-mono text-muted-foreground">
                  {new Date(d.created_at).toLocaleString()} · audit <Link to={`/audits/${d.current_audit_id}`} className="text-primary hover:underline">{d.current_audit_id.slice(0, 8)}</Link>
                  {d.previous_audit_id && (
                    <> vs <Link to={`/audits/${d.previous_audit_id}`} className="text-primary hover:underline">{d.previous_audit_id.slice(0, 8)}</Link></>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mb-4">
                <Stat label="New" value={d.new_count} icon={<TrendingUp className="h-3.5 w-3.5" />} tone={d.new_count > 0 ? "bad" : "neutral"} />
                <Stat label="Regressed" value={d.regressed_count} icon={<TrendingUp className="h-3.5 w-3.5" />} tone={d.regressed_count > 0 ? "bad" : "neutral"} />
                <Stat label="Fixed" value={d.fixed_count} icon={<TrendingDown className="h-3.5 w-3.5" />} tone={d.fixed_count > 0 ? "good" : "neutral"} />
                <Stat label="Unchanged" value={d.unchanged_count} icon={<Minus className="h-3.5 w-3.5" />} tone="neutral" />
              </div>

              <DetailGroup title="🆕 New findings" items={d.details?.new ?? []} bySev={d.details?.new_by_severity} />
              <DetailGroup title="🔁 Regressed (was fixed, came back)" items={d.details?.regressed ?? []} bySev={d.details?.regressed_by_severity} />
              <DetailGroup title="✅ Fixed since last audit" items={d.details?.fixed ?? []} bySev={d.details?.fixed_by_severity} muted />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: "good" | "bad" | "neutral" }) {
  const cls = tone === "bad" ? "border-destructive/40 text-destructive" : tone === "good" ? "border-success/40 text-success" : "border-border text-muted-foreground";
  return (
    <div className={`rounded-lg border p-3 ${cls}`}>
      <div className="text-[10px] font-mono uppercase tracking-wider flex items-center gap-1.5">{icon} {label}</div>
      <div className="text-2xl font-display font-bold mt-1">{value}</div>
    </div>
  );
}

function DetailGroup({ title, items, bySev, muted }: { title: string; items: any[]; bySev?: Record<string, number>; muted?: boolean }) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`mt-3 rounded-lg border border-border/60 ${muted ? "opacity-80" : ""}`}>
      <div className="px-3 py-2 border-b border-border/60 text-xs font-mono flex items-center justify-between">
        <span>{title}</span>
        {bySev && (
          <span className="flex gap-1">
            {Object.entries(bySev).map(([s, n]) => (
              <span key={s} className={`text-[10px] px-1.5 py-0.5 rounded border ${SEV[s] ?? "border-border"}`}>{s} {n}</span>
            ))}
          </span>
        )}
      </div>
      <div className="divide-y divide-border/40">
        {items.slice(0, 10).map((f: any) => (
          <Link key={f.id} to={`/findings`} className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-primary/5">
            <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${SEV[f.severity] ?? "border-border"}`}>{f.severity}</span>
            <span className="font-mono text-muted-foreground">{f.service}</span>
            <span className="truncate flex-1">{f.title}</span>
            <span className="font-mono text-muted-foreground truncate max-w-[280px]">{f.resource_arn}</span>
            <ArrowRight className="h-3 w-3 text-muted-foreground" />
          </Link>
        ))}
      </div>
    </div>
  );
}