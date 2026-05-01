import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, KeyRound, Network, ShieldAlert, Search } from "lucide-react";

type Result = {
  principal: { arn: string; type: string };
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical";
  confidence: number;
  effective_actions: { action: string; resource: string; via: string; boundary_blocks: boolean; notes: string }[];
  assumable_roles: { role_arn: string; via: string; depth: number }[];
  reachable_resources: { arn: string; actions: string[]; path: string[] }[];
  toxic_combinations: { name: string; reason: string; severity: "warn" | "high" | "critical" }[];
  gaps: string[];
};

const RISK_COLOR: Record<string, string> = {
  critical: "border-critical text-critical bg-critical/10",
  high: "border-high text-high bg-high/10",
  medium: "border-medium text-medium bg-medium/10",
  low: "border-low text-low bg-low/10",
};

export default function EffectivePermissions() {
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [arn, setArn] = useState("");
  const [type, setType] = useState("role");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("aws_connections").select("id,account_label,aws_account_id").order("created_at", { ascending: false }).then(({ data }) => {
      setConnections(data ?? []);
      if (data?.[0]) setConnectionId(data[0].id);
    });
  }, []);

  async function explore() {
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-impact", {
        body: { mode: "effective_permissions", connection_id: connectionId || undefined, principal: { arn, type, name } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data?.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setLoading(false); }
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-primary flex items-center gap-2"><Network className="h-3.5 w-3.5" /> IAM reachability</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Effective-permissions explorer</h1>
            <p className="mt-2 max-w-3xl text-sm text-muted-foreground">Pick a principal. See every action it can effectively perform across role chains, SCPs, resource policies, and permission boundaries — with the path each permission travels through.</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-border bg-card/60 p-5 shadow-card space-y-4 h-fit">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Principal</div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">AWS account</Label>
                <Select value={connectionId} onValueChange={setConnectionId}>
                  <SelectTrigger className="mt-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                  <SelectContent>
                    {connections.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.account_label} {c.aws_account_id ? `(${c.aws_account_id})` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Type</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="role">IAM Role</SelectItem>
                    <SelectItem value="user">IAM User</SelectItem>
                    <SelectItem value="federated">Federated identity</SelectItem>
                    <SelectItem value="service">Service principal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Principal ARN</Label>
                <Input className="mt-1 font-mono text-xs" placeholder="arn:aws:iam::123456789012:role/MyRole" value={arn} onChange={(e) => setArn(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Or name (if ARN unknown)</Label>
                <Input className="mt-1 font-mono text-xs" placeholder="MyRole" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <Button onClick={explore} disabled={loading || (!arn && !name)} className="w-full">
                {loading ? "Computing reachability…" : <><Search className="h-4 w-4 mr-2" />Explore permissions</>}
              </Button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">Computes transitive role chains (depth ≤ 3), resource policies, permission boundaries, and SCPs against your latest audit context.</p>
            </div>
          </section>

          <section className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5" />{error}
              </div>
            )}
            {!result && !loading && !error && (
              <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
                Pick a principal and explore to see its effective reachability graph.
              </div>
            )}
            {loading && <div className="rounded-lg border border-border bg-card/40 p-10 text-center text-sm text-muted-foreground animate-pulse">Walking the policy graph…</div>}
            {result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${RISK_COLOR[result.risk_level] ?? ""}`}>{result.risk_level} risk</span>
                    <span className="text-xs font-mono text-muted-foreground">confidence {(result.confidence * 100).toFixed(0)}%</span>
                    {result.principal?.arn && <span className="text-xs font-mono text-muted-foreground break-all">· {result.principal.arn}</span>}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed">{result.summary}</p>
                </div>

                {result.toxic_combinations?.length > 0 && (
                  <div className="rounded-lg border border-critical/40 bg-critical/5 p-5 shadow-card">
                    <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-critical"><ShieldAlert className="h-4 w-4" /> Toxic combinations</div>
                    <div className="mt-3 grid gap-2 md:grid-cols-2">
                      {result.toxic_combinations.map((t, i) => (
                        <div key={i} className="rounded border border-border bg-background/40 p-3">
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${RISK_COLOR[t.severity === "warn" ? "medium" : t.severity] ?? ""}`}>{t.severity}</span>
                            <span className="font-mono text-xs">{t.name}</span>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">{t.reason}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary"><KeyRound className="h-4 w-4" /> Effective actions ({result.effective_actions?.length ?? 0})</div>
                  <div className="mt-3 max-h-96 overflow-auto rounded border border-border">
                    <table className="w-full text-xs">
                      <thead className="bg-background/60 sticky top-0">
                        <tr className="text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                          <th className="px-3 py-2">Action</th>
                          <th className="px-3 py-2">Resource</th>
                          <th className="px-3 py-2">Via</th>
                          <th className="px-3 py-2 text-center">Boundary</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(result.effective_actions ?? []).map((a, i) => (
                          <tr key={i} className="border-t border-border hover:bg-secondary/30">
                            <td className="px-3 py-2 font-mono">{a.action}</td>
                            <td className="px-3 py-2 font-mono text-muted-foreground break-all">{a.resource}</td>
                            <td className="px-3 py-2 text-muted-foreground">{a.via}</td>
                            <td className="px-3 py-2 text-center">{a.boundary_blocks ? <span className="text-critical">blocked</span> : <span className="text-success">allowed</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {result.assumable_roles?.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Assumable roles (transitive)</div>
                    <div className="space-y-1.5">
                      {result.assumable_roles.map((r, i) => (
                        <div key={i} className="flex flex-wrap items-center gap-2 rounded border border-border bg-background/40 px-3 py-2 text-xs">
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">depth {r.depth}</span>
                          <span className="font-mono break-all">{r.role_arn}</span>
                          <span className="ml-auto text-muted-foreground">{r.via}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.reachable_resources?.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Reachable resources</div>
                    <div className="space-y-2">
                      {result.reachable_resources.map((r, i) => (
                        <div key={i} className="rounded border border-border bg-background/40 p-3">
                          <div className="font-mono text-xs break-all">{r.arn}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            {r.actions.map((a, j) => <span key={j} className="rounded border border-border bg-background/60 px-1.5 py-0.5 font-mono text-[10px]">{a}</span>)}
                          </div>
                          <div className="mt-2 font-mono text-[10px] text-muted-foreground">path: {r.path.join(" → ")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {result.gaps?.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/40 p-4 text-xs text-muted-foreground">
                    <span className="font-mono uppercase tracking-wider text-foreground/70">Coverage gaps:</span> {result.gaps.join(" · ")}
                  </div>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}