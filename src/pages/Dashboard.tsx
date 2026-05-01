import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Plus, Activity, ShieldAlert, Network, Plug, GitCompare, TrendingUp, TrendingDown } from "lucide-react";
import { SEV_DOT, type Severity } from "@/lib/severity";
import { InfoTip } from "@/components/InfoTip";

export default function Dashboard() {
  const [stats, setStats] = useState({ audits: 0, findings: 0, paths: 0, conns: 0 });
  const [bySev, setBySev] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<any[]>([]);
  const [drift, setDrift] = useState<any | null>(null);

  useEffect(() => {
    (async () => {
      const [a, f, p, c, ra, dd] = await Promise.all([
        supabase.from("audits").select("id", { count: "exact", head: true }),
        supabase.from("findings").select("severity"),
        supabase.from("attack_paths").select("id", { count: "exact", head: true }),
        supabase.from("aws_connections").select("id", { count: "exact", head: true }),
        supabase.from("audits").select("*").order("created_at", { ascending: false }).limit(5),
        supabase.from("audit_diffs").select("*").order("created_at", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const sev: Record<string, number> = {};
      (f.data ?? []).forEach((x: any) => { sev[x.severity] = (sev[x.severity] ?? 0) + 1; });
      setBySev(sev);
      setStats({
        audits: a.count ?? 0,
        findings: (f.data ?? []).length,
        paths: p.count ?? 0,
        conns: c.count ?? 0,
      });
      setRecent(ra.data ?? []);
      setDrift(dd.data ?? null);
    })();
  }, []);

  const cards = [
    { label: "Audits",        value: stats.audits,    icon: Activity,    href: "/audits",        tip: "Total audit runs across all your AWS accounts (queued, running, completed, failed)." },
    { label: "Findings",      value: stats.findings,  icon: ShieldAlert, href: "/findings",      tip: "Distinct misconfigurations or risk signals detected. One finding may appear in multiple audits if it persists." },
    { label: "Attack Paths",  value: stats.paths,     icon: Network,     href: "/attack-paths",  tip: "Chains of findings that link into a real privilege-escalation, exposure, or lateral-movement path." },
    { label: "AWS Accounts",  value: stats.conns,     icon: Plug,        href: "/connections",   tip: "AWS accounts you've connected. Each runs audits independently and rolls up here." },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Command center</div>
            <h1 className="font-display text-3xl font-bold flex items-center gap-2">Dashboard <InfoTip>Aggregated view across every AWS account you've connected. Click any card to drill in.</InfoTip></h1>
          </div>
          <Link to="/audits/new"><Button className="gap-2 shadow-glow"><Plus className="h-4 w-4" /> New audit</Button></Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <Link key={c.label} to={c.href} className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card hover:border-primary/40 transition-colors">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-mono uppercase tracking-wider flex items-center gap-1.5">
                  {c.label}
                  <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                    <InfoTip>{c.tip}</InfoTip>
                  </span>
                </span>
                <c.icon className="h-4 w-4" />
              </div>
              <div className="mt-3 font-display text-3xl font-bold tabular-nums">{c.value}</div>
            </Link>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          {drift && (
            <Link to="/drift" className="lg:col-span-2 rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card hover:border-primary/40 transition-colors">
              <div className="flex items-center justify-between">
                <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <GitCompare className="h-3.5 w-3.5" /> Drift since last audit
                </div>
                <span className="text-xs text-primary">View →</span>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-3">
                <div className={`rounded-lg border p-3 ${drift.new_count > 0 ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>
                  <div className="text-[10px] font-mono uppercase flex items-center gap-1.5"><TrendingUp className="h-3 w-3" /> New</div>
                  <div className="text-2xl font-display font-bold mt-1">{drift.new_count}</div>
                </div>
                <div className={`rounded-lg border p-3 ${drift.regressed_count > 0 ? "border-destructive/40 text-destructive" : "border-border text-muted-foreground"}`}>
                  <div className="text-[10px] font-mono uppercase flex items-center gap-1.5"><TrendingUp className="h-3 w-3" /> Regressed</div>
                  <div className="text-2xl font-display font-bold mt-1">{drift.regressed_count}</div>
                </div>
                <div className={`rounded-lg border p-3 ${drift.fixed_count > 0 ? "border-success/40 text-success" : "border-border text-muted-foreground"}`}>
                  <div className="text-[10px] font-mono uppercase flex items-center gap-1.5"><TrendingDown className="h-3 w-3" /> Fixed</div>
                  <div className="text-2xl font-display font-bold mt-1">{drift.fixed_count}</div>
                </div>
                <div className="rounded-lg border border-border p-3 text-muted-foreground">
                  <div className="text-[10px] font-mono uppercase">Unchanged</div>
                  <div className="text-2xl font-display font-bold mt-1">{drift.unchanged_count}</div>
                </div>
              </div>
            </Link>
          )}
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
            <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Severity distribution</div>
            <h3 className="font-display font-semibold mt-1 mb-4 flex items-center gap-2">Findings by severity <InfoTip>Critical breaks security model immediately. High = exploitable in days. Medium/Low = compliance + hygiene.</InfoTip></h3>
            <div className="space-y-2">
              {(["critical", "high", "medium", "low", "info"] as Severity[]).map((s) => {
                const v = bySev[s] ?? 0;
                const total = Object.values(bySev).reduce((a, b) => a + b, 0) || 1;
                return (
                  <div key={s} className="flex items-center gap-3">
                    <span className={`h-2 w-2 rounded-full ${SEV_DOT[s]}`} />
                    <span className="text-sm capitalize w-20">{s}</span>
                    <div className="flex-1 h-2 rounded bg-secondary overflow-hidden">
                      <div className={`h-full ${SEV_DOT[s]}`} style={{ width: `${(v / total) * 100}%` }} />
                    </div>
                    <span className="text-sm font-mono w-8 text-right">{v}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
            <div className="text-xs font-mono text-muted-foreground">Recent runs</div>
            <h3 className="font-display font-semibold mt-1 mb-4">Recent audits</h3>
            {recent.length === 0 ? (
              <div className="text-sm text-muted-foreground">No audits yet. <Link to="/audits/new" className="text-primary">Start one →</Link></div>
            ) : (
              <div className="space-y-2">
                {recent.map((a) => (
                  <Link key={a.id} to={`/audits/${a.id}`} className="flex items-center justify-between rounded-md border border-border bg-background/50 p-3 hover:border-primary/40">
                    <div>
                      <div className="text-sm font-mono">{a.id.slice(0, 8)}</div>
                      <div className="text-xs text-muted-foreground">{new Date(a.created_at).toLocaleString()}</div>
                    </div>
                    <span className={`text-xs font-mono px-2 py-0.5 rounded border ${
                      a.status === "completed" ? "text-success border-success/30 bg-success/10" :
                      a.status === "failed" ? "text-sev-critical border-sev-critical/30 bg-sev-critical/10" :
                      "text-primary border-primary/30 bg-primary/10"
                    }`}>{a.status}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}