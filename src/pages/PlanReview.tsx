import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { GitPullRequest, ShieldAlert, Sparkles, AlertTriangle, CheckCircle2, XCircle, Copy, ChevronRight, FileCode2, Loader2 } from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import { toast } from "sonner";

type Change = {
  id: string;
  action: "create" | "update" | "delete" | "replace" | "read";
  resource_type: string;
  address: string;
  service: string;
  name: string;
  key_attributes: Record<string, string>;
  diff_summary: string;
};
type Issue = { severity: "info" | "warn" | "high" | "critical"; title: string; detail: string };
type Review = {
  change_id: string;
  verdict: "ship" | "warn" | "block";
  risk_level: "low" | "medium" | "high" | "critical";
  confidence: number;
  summary: string;
  issues: Issue[];
  impacted: { type: string; name: string; reason: string }[];
  preconditions: string[];
  rollback_steps: string[];
  pr_comment: string;
  evidence_refs: { finding_check_id?: string; path_title?: string; note: string }[];
};
type Result = {
  format_detected: string;
  changes: Change[];
  reviews: Review[];
  overall: { verdict: "ship" | "warn" | "block"; summary: string; blocking: number; warnings: number; audit_id: string | null };
};

const VERDICT_STYLES: Record<string, { ring: string; chip: string; Icon: any; label: string }> = {
  ship:  { ring: "border-success/40 bg-success/5",   chip: "border-success text-success bg-success/10",   Icon: CheckCircle2, label: "Ship" },
  warn:  { ring: "border-medium/40 bg-medium/5",     chip: "border-medium text-medium bg-medium/10",     Icon: AlertTriangle, label: "Warn" },
  block: { ring: "border-critical/40 bg-critical/5", chip: "border-critical text-critical bg-critical/10", Icon: XCircle,      label: "Block" },
};

const ISSUE_DOT: Record<string, string> = {
  critical: "bg-critical",
  high: "bg-high",
  warn: "bg-medium",
  info: "bg-low",
};

const ACTION_STYLES: Record<string, string> = {
  create:  "border-low/50 text-low bg-low/10",
  update:  "border-medium/50 text-medium bg-medium/10",
  delete:  "border-critical/50 text-critical bg-critical/10",
  replace: "border-high/50 text-high bg-high/10",
  read:    "border-border text-muted-foreground bg-background/50",
};

const SAMPLE_PLAN = `Terraform will perform the following actions:

  # aws_s3_bucket.public_logs will be updated in-place
  ~ resource "aws_s3_bucket" "public_logs" {
        id                = "acme-prod-logs"
      ~ acl               = "private" -> "public-read"
    }

  # aws_iam_role_policy_attachment.app_admin will be created
  + resource "aws_iam_role_policy_attachment" "app_admin" {
      + role       = "AppRole"
      + policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"
    }

  # aws_kms_key.payments must be replaced
-/+ resource "aws_kms_key" "payments" {
      ~ id                       = "1234abcd-..." -> (known after apply)
      ~ key_rotation_enabled     = true -> false
      ~ deletion_window_in_days  = 30 -> 7
    }

Plan: 1 to add, 1 to change, 1 to destroy.`;

export default function PlanReview() {
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [planText, setPlanText] = useState("");
  const [format, setFormat] = useState<"auto" | "terraform" | "cloudformation">("auto");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeChange, setActiveChange] = useState<string | null>(null);

  useEffect(() => {
    supabase.from("aws_connections").select("id,account_label,aws_account_id").order("created_at", { ascending: false }).then(({ data }) => {
      setConnections(data ?? []);
      if (data?.[0]) setConnectionId(data[0].id);
    });
  }, []);

  async function review() {
    if (!planText.trim()) {
      toast.error("Paste a terraform plan or CFN change set first");
      return;
    }
    setLoading(true); setError(null); setResult(null); setActiveChange(null);
    try {
      const { data, error } = await supabase.functions.invoke("review-plan", {
        body: { plan_text: planText, format, connection_id: connectionId || undefined },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setActiveChange(data?.changes?.[0]?.id ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setResult(null); setError(null); setActiveChange(null);
  }

  const activeReview = activeChange && result ? result.reviews.find((r) => r.change_id === activeChange) : null;
  const activeChangeObj = activeChange && result ? result.changes.find((c) => c.id === activeChange) : null;

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-primary flex items-center gap-2">
              <GitPullRequest className="h-3.5 w-3.5" /> Pre-merge change reviewer
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold tracking-tight">Plan review</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Paste a <span className="font-mono text-foreground">terraform plan</span> or CloudFormation change set.
              Blastline parses every proposed change, simulates blast radius against your latest audit, and gives you a ship / warn / block verdict per resource.
            </p>
          </div>
          {result && <Button variant="outline" size="sm" onClick={reset}>New review</Button>}
        </header>

        {!result && (
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <section className="rounded-lg border border-border bg-card/60 p-5 shadow-card space-y-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[180px]">
                  <Label className="text-xs flex items-center gap-1.5">
                    AWS account <InfoTip>Reviews are grounded in this account's latest completed audit (findings + attack paths).</InfoTip>
                  </Label>
                  <Select value={connectionId} onValueChange={setConnectionId}>
                    <SelectTrigger className="mt-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                    <SelectContent>
                      {connections.map((c) => (
                        <SelectItem key={c.id} value={c.id}>{c.account_label} {c.aws_account_id ? `(${c.aws_account_id})` : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="w-44">
                  <Label className="text-xs flex items-center gap-1.5">Format <InfoTip>Auto-detect works for most inputs. Override only if parsing fails.</InfoTip></Label>
                  <Select value={format} onValueChange={(v) => setFormat(v as any)}>
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto-detect</SelectItem>
                      <SelectItem value="terraform">Terraform plan</SelectItem>
                      <SelectItem value="cloudformation">CloudFormation</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <Label className="text-xs flex items-center gap-1.5">
                    Plan output
                    <InfoTip>Output of <span className="font-mono">terraform plan</span>, <span className="font-mono">terraform show -json</span>, or a CloudFormation change set. Up to ~60 KB.</InfoTip>
                  </Label>
                  <button
                    type="button"
                    onClick={() => { setPlanText(SAMPLE_PLAN); toast.success("Sample plan loaded"); }}
                    className="text-[11px] text-muted-foreground hover:text-primary inline-flex items-center gap-1"
                  >
                    <Copy className="h-3 w-3" /> Use sample
                  </button>
                </div>
                <Textarea
                  value={planText}
                  onChange={(e) => setPlanText(e.target.value)}
                  rows={18}
                  spellCheck={false}
                  className="font-mono text-[11px] leading-relaxed"
                  placeholder={`# aws_s3_bucket.logs will be updated in-place\n  ~ acl = "private" -> "public-read"\n\n# aws_iam_role_policy_attachment.app will be created\n  + policy_arn = "arn:aws:iam::aws:policy/AdministratorAccess"\n\nPlan: 1 to add, 1 to change, 0 to destroy.`}
                />
                <div className="mt-1 text-[11px] text-muted-foreground font-mono">{planText.length.toLocaleString()} chars · cap 60,000</div>
              </div>

              <Button onClick={review} disabled={loading || !planText.trim()} className="gap-2 shadow-glow">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {loading ? "Reviewing changes…" : "Review this plan"}
              </Button>

              {error && (
                <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5" />{error}
                </div>
              )}
            </section>

            <aside className="space-y-4">
              <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                <div className="text-xs font-mono uppercase tracking-wider text-primary mb-2">How it works</div>
                <ol className="space-y-2 text-sm text-muted-foreground list-decimal list-inside">
                  <li>Parses every resource change in your plan.</li>
                  <li>Reasons about each one against your latest audit, IAM graph, and attack paths.</li>
                  <li>Returns ship / warn / block per change + a paste-ready PR comment.</li>
                </ol>
              </div>
              <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
                <div className="text-xs font-mono uppercase tracking-wider text-primary mb-2">What we look for</div>
                <ul className="space-y-1.5 text-sm text-muted-foreground">
                  <li className="flex gap-2"><span className="text-primary">›</span><span>Public exposure (S3 ACL, SG 0.0.0.0/0, RDS public)</span></li>
                  <li className="flex gap-2"><span className="text-primary">›</span><span>IAM blast (Admin policies, role chains, boundaries)</span></li>
                  <li className="flex gap-2"><span className="text-primary">›</span><span>Destructive replaces (KMS, RDS, secrets)</span></li>
                  <li className="flex gap-2"><span className="text-primary">›</span><span>Encryption removal &amp; key rotation off</span></li>
                  <li className="flex gap-2"><span className="text-primary">›</span><span>Resource policies that grant <span className="font-mono">*</span></span></li>
                </ul>
              </div>
            </aside>
          </div>
        )}

        {loading && !result && (
          <div className="rounded-lg border border-border bg-card/40 p-12 text-center text-sm text-muted-foreground animate-pulse">
            Parsing plan, then reasoning across each change against your latest audit…
          </div>
        )}

        {result && (() => {
          const v = VERDICT_STYLES[result.overall.verdict];
          const VIcon = v.Icon;
          return (
            <div className="space-y-6">
              {/* Overall verdict banner */}
              <div className={`rounded-lg border-2 p-5 shadow-card ${v.ring}`}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-xs uppercase tracking-wider ${v.chip}`}>
                    <VIcon className="h-3.5 w-3.5" /> {v.label}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    format · {result.format_detected}
                  </span>
                  <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                    {result.changes.length} change{result.changes.length === 1 ? "" : "s"} reviewed
                  </span>
                  {result.overall.audit_id && (
                    <span className="text-xs font-mono text-muted-foreground uppercase tracking-wider">
                      grounded · audit {result.overall.audit_id.slice(0, 8)}
                    </span>
                  )}
                </div>
                <p className="mt-3 text-base font-medium text-foreground">{result.overall.summary}</p>
                <div className="mt-2 flex gap-4 text-xs font-mono text-muted-foreground">
                  <span><span className="text-critical">{result.overall.blocking}</span> blocking</span>
                  <span><span className="text-medium">{result.overall.warnings}</span> warnings</span>
                  <span><span className="text-success">{result.changes.length - result.overall.blocking - result.overall.warnings}</span> safe</span>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
                {/* Changes list */}
                <section className="rounded-lg border border-border bg-card/60 shadow-card overflow-hidden">
                  <div className="border-b border-border px-3 py-2 text-xs font-mono uppercase tracking-wider text-foreground/80">
                    Proposed changes
                  </div>
                  <div className="max-h-[640px] overflow-y-auto">
                    {result.changes.map((c) => {
                      const r = result.reviews.find((rr) => rr.change_id === c.id);
                      const vs = VERDICT_STYLES[r?.verdict ?? "warn"];
                      const VsIcon = vs.Icon;
                      const isActive = activeChange === c.id;
                      return (
                        <button
                          key={c.id}
                          onClick={() => setActiveChange(c.id)}
                          className={`w-full text-left border-b border-border/50 px-3 py-2.5 transition-colors ${isActive ? "bg-primary/5 border-l-2 border-l-primary" : "hover:bg-background/40 border-l-2 border-l-transparent"}`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${ACTION_STYLES[c.action] ?? ""}`}>
                              {c.action}
                            </span>
                            <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${vs.chip}`}>
                              <VsIcon className="h-2.5 w-2.5" /> {vs.label}
                            </span>
                          </div>
                          <div className="mt-1.5 font-mono text-[11px] text-foreground truncate">{c.address}</div>
                          <div className="mt-0.5 text-[10px] text-muted-foreground truncate">{c.resource_type}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Active change detail */}
                <section className="space-y-4">
                  {activeReview && activeChangeObj ? (
                    <ReviewDetail change={activeChangeObj} review={activeReview} />
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-card/30 p-10 text-center text-sm text-muted-foreground">
                      Select a change to see the detailed review.
                    </div>
                  )}
                </section>
              </div>
            </div>
          );
        })()}
      </div>
    </AppShell>
  );
}

function ReviewDetail({ change, review }: { change: Change; review: Review }) {
  const v = VERDICT_STYLES[review.verdict];
  const VIcon = v.Icon;
  return (
    <Tabs defaultValue="review" className="w-full">
      <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${ACTION_STYLES[change.action]}`}>
            {change.action}
          </span>
          <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${v.chip}`}>
            <VIcon className="h-3 w-3" /> {v.label}
          </span>
          <span className="text-[11px] font-mono text-muted-foreground uppercase tracking-wider">
            {review.risk_level} risk · {(review.confidence * 100).toFixed(0)}% confidence
          </span>
        </div>
        <div className="mt-2 font-mono text-sm text-foreground break-all">{change.address}</div>
        <div className="text-xs text-muted-foreground">{change.resource_type}</div>
        <p className="mt-3 text-sm leading-relaxed">{review.summary}</p>

        <TabsList className="mt-4">
          <TabsTrigger value="review">Review</TabsTrigger>
          <TabsTrigger value="diff">Diff</TabsTrigger>
          <TabsTrigger value="pr">PR comment</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="review" className="space-y-4 mt-4">
        {review.issues?.length > 0 && (
          <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-primary"><ShieldAlert className="h-4 w-4" /> Issues ({review.issues.length})</div>
            <ul className="mt-3 space-y-2.5">
              {review.issues.map((i, k) => (
                <li key={k} className="rounded border border-border bg-background/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${ISSUE_DOT[i.severity] ?? "bg-muted"}`} />
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{i.severity}</span>
                    <span className="text-sm font-medium text-foreground">{i.title}</span>
                  </div>
                  <div className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{i.detail}</div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {review.impacted?.length > 0 && (
          <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="text-xs font-mono uppercase tracking-wider text-primary mb-3">Impacted ({review.impacted.length})</div>
            <div className="grid gap-2 md:grid-cols-2">
              {review.impacted.map((it, i) => (
                <div key={i} className="rounded border border-border bg-background/40 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{it.type}</div>
                  <div className="mt-1 font-mono text-xs text-foreground break-words">{it.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground leading-snug">{it.reason}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Preconditions</div>
            <ul className="space-y-1.5 text-sm">
              {(review.preconditions ?? []).map((p, i) => <li key={i} className="flex gap-2"><span className="text-primary">›</span><span>{p}</span></li>)}
              {!review.preconditions?.length && <li className="text-muted-foreground text-xs">— none</li>}
            </ul>
          </div>
          <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Rollback plan</div>
            <ol className="space-y-1.5 text-sm list-decimal list-inside">
              {(review.rollback_steps ?? []).map((p, i) => <li key={i}>{p}</li>)}
              {!review.rollback_steps?.length && <li className="text-muted-foreground text-xs list-none">— none</li>}
            </ol>
          </div>
        </div>

        {review.evidence_refs?.length > 0 && (
          <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Evidence from your audit</div>
            <ul className="space-y-1.5 text-xs">
              {review.evidence_refs.map((e, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2">
                  {e.finding_check_id && <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">finding · {e.finding_check_id}</span>}
                  {e.path_title && <span className="rounded border border-border bg-background/40 px-1.5 py-0.5 font-mono text-[10px]">path · {e.path_title}</span>}
                  <span className="text-muted-foreground">{e.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </TabsContent>

      <TabsContent value="diff" className="mt-4">
        <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card space-y-3">
          <div>
            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-1">Plain-English diff</div>
            <p className="text-sm leading-relaxed">{change.diff_summary}</p>
          </div>
          {change.key_attributes && Object.keys(change.key_attributes).length > 0 && (
            <div>
              <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-2">Key attributes</div>
              <div className="rounded border border-border bg-background/40 p-3 space-y-1">
                {Object.entries(change.key_attributes).map(([k, val]) => (
                  <div key={k} className="flex gap-3 text-xs font-mono">
                    <span className="text-muted-foreground w-44 shrink-0 truncate">{k}</span>
                    <span className="break-all">{String(val)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </TabsContent>

      <TabsContent value="pr" className="mt-4">
        <div className="rounded-lg border border-border bg-card/60 p-5 shadow-card">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-mono uppercase tracking-wider text-primary">PR-ready comment</div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => { navigator.clipboard.writeText(review.pr_comment ?? ""); toast.success("Copied to clipboard"); }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </div>
          <pre className="rounded border border-border bg-background/60 p-3 text-xs font-mono whitespace-pre-wrap leading-relaxed">{review.pr_comment || "— no comment generated"}</pre>
        </div>
      </TabsContent>
    </Tabs>
  );
}