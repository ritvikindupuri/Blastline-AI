import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Plus, Activity, ShieldAlert, Network, Plug } from "lucide-react";
import { SEV_DOT, type Severity } from "@/lib/severity";

export default function Dashboard() {
  const [stats, setStats] = useState({ audits: 0, findings: 0, paths: 0, conns: 0 });
  const [bySev, setBySev] = useState<Record<string, number>>({});
  const [recent, setRecent] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const [a, f, p, c, ra] = await Promise.all([
        supabase.from("audits").select("id", { count: "exact", head: true }),
        supabase.from("findings").select("severity"),
        supabase.from("attack_paths").select("id", { count: "exact", head: true }),
        supabase.from("aws_connections").select("id", { count: "exact", head: true }),
        supabase.from("audits").select("*").order("created_at", { ascending: false }).limit(5),
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
    })();
  }, []);

  const cards = [
    { label: "Audits", value: stats.audits, icon: Activity, href: "/audits" },
    { label: "Findings", value: stats.findings, icon: ShieldAlert, href: "/findings" },
    { label: "Attack Paths", value: stats.paths, icon: Network, href: "/attack-paths" },
    { label: "AWS Accounts", value: stats.conns, icon: Plug, href: "/connections" },
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-xs font-mono text-muted-foreground">// command center</div>
            <h1 className="font-display text-3xl font-bold">Dashboard</h1>
          </div>
          <Link to="/audits/new"><Button className="gap-2 shadow-glow"><Plus className="h-4 w-4" /> New audit</Button></Link>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {cards.map((c) => (
            <Link key={c.label} to={c.href} className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card hover:border-primary/40 transition-colors">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-xs font-mono uppercase tracking-wider">{c.label}</span>
                <c.icon className="h-4 w-4" />
              </div>
              <div className="mt-3 font-display text-3xl font-bold">{c.value}</div>
            </Link>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card">
            <div className="text-xs font-mono text-muted-foreground">// severity distribution</div>
            <h3 className="font-display font-semibold mt-1 mb-4">Findings by severity</h3>
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
            <div className="text-xs font-mono text-muted-foreground">// recent runs</div>
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