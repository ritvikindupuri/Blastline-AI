import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Radar, ShieldAlert, Zap } from "lucide-react";

type Impacted = { type: string; name: string; reason: string; severity: "info" | "warn" | "break" };
type Result = {
  summary: string;
  risk_level: "low" | "medium" | "high" | "critical";
  confidence: number;
  impacted: Impacted[];
  preconditions: string[];
  rollback_steps: string[];
  evidence_refs: { finding_check_id?: string; path_title?: string; note: string }[];
};

const RISK_COLOR: Record<string, string> = {
  critical: "border-critical text-critical bg-critical/10",
  high: "border-high text-high bg-high/10",
  medium: "border-medium text-medium bg-medium/10",
  low: "border-low text-low bg-low/10",
};

const SEV_DOT: Record<string, string> = {
  break: "bg-critical",
  warn: "bg-high",
  info: "bg-low",
};

export default function BlastRadius() {
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [resourceArn, setResourceArn] = useState("");
  const [service, setService] = useState("s3");
  const [change, setChange] = useState("Make this S3 bucket private (remove public-read ACL and block public access)");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("aws_connections").select("id,account_label,aws_account_id").order("created_at", { ascending: false }).then(({ data }) => {
      setConnections(data ?? []);
      if (data?.[0]) setConnectionId(data[0].id);
    });
  }, []);

  async function simulate() {
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-impact", {
        body: { mode: "blast_radius", connection_id: connectionId || undefined, target: { resource_arn: resourceArn, service, change } },
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
            <div className="text-xs font-mono uppercase tracking-wider text-primary flex items-center gap-2"><Radar className="h-3.5 w-3.5" /> Pre-execution simulator</div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Blast-radius simulator</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">Before you change a production resource, see exactly which principals, services, and workflows break. Grounded in your latest completed audit.</p>
          </div>
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-border bg-card/60 p-5 shadow-card space-y-4 h-fit">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Target</div>
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
                <Label className="text-xs">Service</Label>
                <Select value={service} onValueChange={setService}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {["iam","s3","ec2","rds","lambda","kms","sg","vpc","secretsmanager","ecr","eks"].map((s) => <SelectItem key={s} value={s}>{s.toUpperCase()}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Resource ARN</Label>
                <Input className="mt-1 font-mono text-xs" placeholder="arn:aws:s3:::my-bucket" value={resourceArn} onChange={(e) => setResourceArn(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Proposed change</Label>
                <Textarea className="mt-1 text-sm" rows={4} value={change} onChange={(e) => setChange(e.target.value)} />
              </div>
              <Button onClick={simulate} disabled={loading || !change} className="w-full">
                {loading ? "Simulating…" : <><Zap className="h-4 w-4 mr-2" />Run simulation</>}
              </Button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">No changes are applied to your AWS account. Simulation is read-only and uses your latest audit as ground truth.</p>
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
                Run a simulation to see the projected blast radius here.
              </div>
            )}
            {loading && (
              <div className="rounded-lg border border-border bg-card/40 p-10 text-center text-sm text-muted-foreground animate-pulse">
                Reasoning over your latest audit, role chains, and resource policies…
              </div>
            )}
            {result && (
              <div className="space-y-4">
                <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${RISK_COLOR[result.risk_level] ?? ""}`}>{result.risk_level} risk</span>
                    <span className="text-xs font-mono text-muted-foreground">confidence {(result.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed">{result.summary}</p>
                </div>

                <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                  <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary"><ShieldAlert className="h-4 w-4" /> Impacted ({result.impacted?.length ?? 0})</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {(result.impacted ?? []).map((it, i) => (
                      <div key={i} className="rounded border border-border bg-background/40 p-3">
                        <div className="flex items-center gap-2">
                          <span className={`h-2 w-2 rounded-full ${SEV_DOT[it.severity] ?? "bg-muted"}`} />
                          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{it.type}</span>
                          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{it.severity}</span>
                        </div>
                        <div className="mt-1 font-mono text-xs text-foreground break-words">{it.name}</div>
                        <div className="mt-1 text-xs text-muted-foreground leading-snug">{it.reason}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Preconditions to satisfy first</div>
                    <ul className="space-y-1.5 text-sm">
                      {(result.preconditions ?? []).map((p, i) => <li key={i} className="flex gap-2"><span className="text-primary">›</span><span>{p}</span></li>)}
                      {!result.preconditions?.length && <li className="text-muted-foreground text-xs">— none</li>}
                    </ul>
                  </div>
                  <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Rollback plan</div>
                    <ol className="space-y-1.5 text-sm list-decimal list-inside">
                      {(result.rollback_steps ?? []).map((p, i) => <li key={i}>{p}</li>)}
                      {!result.rollback_steps?.length && <li className="text-muted-foreground text-xs list-none">— none</li>}
                    </ol>
                  </div>
                </div>

                {result.evidence_refs?.length > 0 && (
                  <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                    <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Evidence</div>
                    <ul className="space-y-1.5 text-xs">
                      {result.evidence_refs.map((e, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          {e.finding_check_id && <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">finding · {e.finding_check_id}</span>}
                          {e.path_title && <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">path · {e.path_title}</span>}
                          <span className="text-muted-foreground">{e.note}</span>
                        </li>
                      ))}
                    </ul>
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