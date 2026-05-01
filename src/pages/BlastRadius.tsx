import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { AlertTriangle, Radar, ShieldAlert, Zap, Check, ExternalLink, Copy, ArrowLeft, Sparkles, Loader2, Search } from "lucide-react";
import { InfoTip } from "@/components/InfoTip";
import { toast } from "sonner";

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

type ServiceDef = {
  key: string;
  label: string;
  arnExample: string;
  arnHint: string;
  consoleUrl: string;
  consoleLabel: string;
  changes: { id: string; label: string; description: string; prompt: string }[];
};

const SERVICES: ServiceDef[] = [
  {
    key: "s3", label: "S3 bucket",
    arnExample: "arn:aws:s3:::my-bucket",
    arnHint: "S3 ARNs have no region or account ID. Just the bucket name. Find it in S3 console → Properties → 'Amazon Resource Name (ARN)'.",
    consoleUrl: "https://s3.console.aws.amazon.com/s3/buckets",
    consoleLabel: "Open S3 console",
    changes: [
      { id: "private", label: "Make bucket private", description: "Remove public-read ACL + enable Block Public Access", prompt: "Make this S3 bucket private: remove any public-read or public-read-write ACLs, set Block Public Access to all 4 settings ON, and remove any bucket policy statements that grant Principal '*'." },
      { id: "encryption", label: "Enforce SSE-KMS encryption", description: "Default encryption + deny unencrypted PutObject", prompt: "Enable default SSE-KMS encryption on this bucket using a customer-managed KMS key, and add a bucket policy that denies s3:PutObject when x-amz-server-side-encryption is not 'aws:kms'." },
      { id: "delete", label: "Delete this bucket", description: "Empty all objects and remove the bucket", prompt: "Empty and delete this S3 bucket entirely, including all object versions and delete markers." },
      { id: "policy", label: "Replace bucket policy", description: "Apply a new restrictive bucket policy", prompt: "Replace this bucket's resource policy with one that only allows access from a specific VPC endpoint and denies all other principals." },
    ],
  },
  {
    key: "iam", label: "IAM role or user",
    arnExample: "arn:aws:iam::123456789012:role/MyAppRole",
    arnHint: "Find in IAM console → Users or Roles → click the principal → ARN is at the top of the summary panel.",
    consoleUrl: "https://console.aws.amazon.com/iam/home#/users",
    consoleLabel: "Open IAM console",
    changes: [
      { id: "detach", label: "Detach a policy", description: "Remove an attached managed/inline policy", prompt: "Detach the AdministratorAccess (or named) policy from this principal." },
      { id: "delete", label: "Delete this principal", description: "Remove the user or role entirely", prompt: "Delete this IAM role/user, including any inline policies and access keys." },
      { id: "boundary", label: "Add a permission boundary", description: "Constrain effective permissions", prompt: "Attach a permission boundary to this principal that limits effective permissions to read-only across all services." },
      { id: "rotate", label: "Rotate / disable access keys", description: "Deactivate existing access keys", prompt: "Deactivate all access keys belonging to this user." },
    ],
  },
  {
    key: "sg", label: "Security group",
    arnExample: "arn:aws:ec2:us-east-1:123456789012:security-group/sg-0abc123def456",
    arnHint: "Find in EC2 console → Security Groups → click the group → 'Owner ID' + 'Group ID' build the ARN. Or just paste the sg-… ID below.",
    consoleUrl: "https://console.aws.amazon.com/ec2/v2/home#SecurityGroups:",
    consoleLabel: "Open Security Groups",
    changes: [
      { id: "remove-0000", label: "Remove 0.0.0.0/0 ingress", description: "Close inbound rules open to the world", prompt: "Remove all ingress rules on this security group that allow 0.0.0.0/0 or ::/0 on any port." },
      { id: "delete", label: "Delete security group", description: "Remove SG (must be unattached)", prompt: "Delete this security group. Identify any ENIs/instances/Lambda/RDS still using it and what would break." },
      { id: "tighten", label: "Tighten SSH/RDP", description: "Restrict 22/3389 to a CIDR", prompt: "Replace any 0.0.0.0/0 rule on ports 22 (SSH) or 3389 (RDP) with the corporate VPN CIDR only." },
    ],
  },
  {
    key: "kms", label: "KMS key",
    arnExample: "arn:aws:kms:us-east-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab",
    arnHint: "Find in KMS console → Customer managed keys → click the key → 'ARN' is at the top.",
    consoleUrl: "https://console.aws.amazon.com/kms/home#/kms/keys",
    consoleLabel: "Open KMS console",
    changes: [
      { id: "schedule-delete", label: "Schedule key deletion", description: "Mark key for deletion (7–30 days)", prompt: "Schedule this KMS key for deletion in 7 days. Identify all encrypted resources (S3, EBS, RDS, Secrets Manager) that will become unreadable." },
      { id: "disable", label: "Disable this key", description: "Make it unusable without deleting", prompt: "Disable this KMS key. Identify all workloads that will start failing decrypt/encrypt calls." },
      { id: "policy", label: "Tighten key policy", description: "Remove broad principals from key policy", prompt: "Remove the kms:* permission for AWS account root from this key policy and grant only specific role ARNs." },
    ],
  },
  {
    key: "rds", label: "RDS database",
    arnExample: "arn:aws:rds:us-east-1:123456789012:db:my-db-instance",
    arnHint: "Find in RDS console → Databases → click the DB → 'Configuration' tab → 'ARN'.",
    consoleUrl: "https://console.aws.amazon.com/rds/home#databases:",
    consoleLabel: "Open RDS console",
    changes: [
      { id: "private", label: "Make DB not publicly accessible", description: "Disable PubliclyAccessible flag", prompt: "Set PubliclyAccessible=false on this RDS instance. Identify connectivity that will break and required VPC routing." },
      { id: "delete", label: "Delete this DB", description: "Drop the DB instance", prompt: "Delete this RDS instance. Identify final-snapshot policy and downstream apps that will lose connectivity." },
      { id: "rotate", label: "Rotate master password", description: "Force password change", prompt: "Rotate the master credentials for this RDS instance." },
    ],
  },
  {
    key: "lambda", label: "Lambda function",
    arnExample: "arn:aws:lambda:us-east-1:123456789012:function:my-fn",
    arnHint: "Find in Lambda console → click the function → 'Function ARN' in the top-right.",
    consoleUrl: "https://console.aws.amazon.com/lambda/home#/functions",
    consoleLabel: "Open Lambda console",
    changes: [
      { id: "delete", label: "Delete this function", description: "Remove the Lambda entirely", prompt: "Delete this Lambda function. Identify EventBridge/SQS/SNS/API Gateway triggers that will break." },
      { id: "role", label: "Replace execution role", description: "Swap the IAM role attached", prompt: "Change this Lambda's execution role to a least-privilege role that only allows it to read from one specific DynamoDB table." },
      { id: "remove-trigger", label: "Remove a trigger", description: "Detach a trigger from the function", prompt: "Remove the API Gateway trigger from this Lambda function." },
    ],
  },
  {
    key: "secretsmanager", label: "Secret",
    arnExample: "arn:aws:secretsmanager:us-east-1:123456789012:secret:prod/db/password-AbCdEf",
    arnHint: "Find in Secrets Manager console → click the secret → 'Secret ARN' (note the random 6-char suffix is part of it).",
    consoleUrl: "https://console.aws.amazon.com/secretsmanager/home#!/listSecrets",
    consoleLabel: "Open Secrets Manager",
    changes: [
      { id: "rotate", label: "Rotate this secret", description: "Force a value rotation now", prompt: "Trigger immediate rotation of this secret. Identify consumers that cache the old value and may need restart." },
      { id: "delete", label: "Delete this secret", description: "Schedule deletion (7–30 days)", prompt: "Schedule this secret for deletion in 7 days. Identify all callers of GetSecretValue for this ARN." },
    ],
  },
];

export default function BlastRadius() {
  const [connections, setConnections] = useState<any[]>([]);
  const [connectionId, setConnectionId] = useState<string>("");
  const [resourceArn, setResourceArn] = useState("");
  const [serviceKey, setServiceKey] = useState<string>("s3");
  const [changeId, setChangeId] = useState<string>("");
  const [change, setChange] = useState("");
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerItems, setPickerItems] = useState<{ arn: string; label: string; hint?: string }[]>([]);
  const [pickerQuery, setPickerQuery] = useState("");
  const [pickerRegion, setPickerRegion] = useState<string | null>(null);

  const svc = SERVICES.find((s) => s.key === serviceKey)!;

  useEffect(() => {
    supabase.from("aws_connections").select("id,account_label,aws_account_id").order("created_at", { ascending: false }).then(({ data }) => {
      setConnections(data ?? []);
      if (data?.[0]) setConnectionId(data[0].id);
    });
  }, []);

  async function discoverResources() {
    if (!connectionId) {
      toast.error("Pick an AWS account first");
      return;
    }
    setPickerOpen(true);
    setPickerLoading(true);
    setPickerError(null);
    setPickerItems([]);
    setPickerQuery("");
    try {
      const { data, error } = await supabase.functions.invoke("list-aws-resources", {
        body: { connection_id: connectionId, service: serviceKey },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setPickerItems(data?.items ?? []);
      setPickerRegion(data?.region ?? null);
      if (!data?.items?.length) setPickerError("No resources of this type found in your account.");
    } catch (e: any) {
      setPickerError(e?.message ?? String(e));
    } finally {
      setPickerLoading(false);
    }
  }

  const filteredItems = pickerItems.filter((it) => {
    if (!pickerQuery) return true;
    const q = pickerQuery.toLowerCase();
    return it.label.toLowerCase().includes(q) || it.arn.toLowerCase().includes(q);
  });

  async function simulate() {
    setLoading(true); setError(null); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("simulate-impact", {
        body: { mode: "blast_radius", connection_id: connectionId || undefined, target: { resource_arn: resourceArn, service: serviceKey, change } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResult(data?.result ?? null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally { setLoading(false); }
  }

  function reset() {
    setResult(null); setError(null); setStep(1);
    setChangeId(""); setChange(""); setResourceArn("");
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
          {result && <Button variant="outline" size="sm" onClick={reset}>New simulation</Button>}
        </header>

        <div className="grid gap-6 lg:grid-cols-[420px_1fr]">
          <section className="rounded-lg border border-border bg-card/60 p-5 shadow-card space-y-4 h-fit">
            {/* Step indicator */}
            <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider">
              {[1, 2, 3].map((n) => (
                <div key={n} className="flex items-center gap-1.5">
                  <span className={`h-5 w-5 rounded-full flex items-center justify-center border ${step >= n ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"}`}>
                    {step > n ? <Check className="h-3 w-3" /> : n}
                  </span>
                  <span className={step >= n ? "text-foreground" : "text-muted-foreground"}>
                    {n === 1 ? "Resource" : n === 2 ? "Change" : "Review"}
                  </span>
                  {n < 3 && <span className="text-muted-foreground/40 mx-1">·</span>}
                </div>
              ))}
            </div>

            <div>
              <Label className="text-xs flex items-center gap-1.5">AWS account <InfoTip>The simulation is grounded in this account's latest completed audit.</InfoTip></Label>
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select account" /></SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.account_label} {c.aws_account_id ? `(${c.aws_account_id})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Step 1: pick resource */}
            {step === 1 && (
              <div className="space-y-3">
                <div>
                  <Label className="text-xs flex items-center gap-1.5">Resource type <InfoTip>What kind of AWS resource you're about to change. We'll show you exactly where to find its ARN.</InfoTip></Label>
                  <div className="mt-1 grid grid-cols-2 gap-1.5">
                    {SERVICES.map((s) => (
                      <button key={s.key} type="button" onClick={() => { setServiceKey(s.key); setChangeId(""); setChange(""); setPickerItems([]); setPickerError(null); setPickerRegion(null); }} className={`text-left rounded-md border px-2.5 py-2 text-xs transition-colors ${serviceKey === s.key ? "border-primary/60 bg-primary/5 text-foreground" : "border-border bg-background/40 hover:bg-background/60 text-muted-foreground"}`}>
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1.5">
                    Resource ARN
                    <InfoTip>{svc.arnHint}</InfoTip>
                  </Label>
                  <Input className="mt-1 font-mono text-xs" placeholder={svc.arnExample} value={resourceArn} onChange={(e) => setResourceArn(e.target.value)} />
                  <div className="mt-2 space-y-1.5">
                    <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={discoverResources}
                          disabled={!connectionId || pickerLoading}
                          className="w-full justify-start gap-2 border-primary/40 text-primary hover:bg-primary/5 hover:text-primary"
                        >
                          {pickerLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                          Pick from your account
                          <span className="ml-auto text-[10px] font-mono uppercase tracking-wider text-muted-foreground">read-only</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-[420px] p-0" align="start">
                        <div className="border-b border-border px-3 py-2">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
                              {svc.label}{pickerRegion ? ` · ${pickerRegion}` : ""}
                            </div>
                            <button onClick={discoverResources} className="text-[10px] font-mono uppercase text-primary hover:underline" disabled={pickerLoading}>
                              {pickerLoading ? "loading…" : "refresh"}
                            </button>
                          </div>
                          <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-background px-2">
                            <Search className="h-3.5 w-3.5 text-muted-foreground" />
                            <input
                              autoFocus
                              value={pickerQuery}
                              onChange={(e) => setPickerQuery(e.target.value)}
                              placeholder="Filter by name or ARN…"
                              className="flex-1 bg-transparent py-1.5 text-xs font-mono outline-none placeholder:text-muted-foreground/60"
                            />
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto">
                          {pickerLoading && (
                            <div className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Listing {svc.label.toLowerCase()}s in your account…
                            </div>
                          )}
                          {!pickerLoading && pickerError && (
                            <div className="p-3 text-xs text-destructive flex items-start gap-2">
                              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                              <span>{pickerError}</span>
                            </div>
                          )}
                          {!pickerLoading && !pickerError && filteredItems.length === 0 && (
                            <div className="p-4 text-xs text-muted-foreground">No matches.</div>
                          )}
                          {!pickerLoading && filteredItems.map((it) => (
                            <button
                              key={it.arn}
                              type="button"
                              onClick={() => { setResourceArn(it.arn); setPickerOpen(false); toast.success(`Selected ${it.label}`); }}
                              className="w-full text-left border-b border-border/50 px-3 py-2 hover:bg-primary/5 transition-colors"
                            >
                              <div className="text-xs font-medium truncate">{it.label}</div>
                              <div className="font-mono text-[10px] text-muted-foreground truncate">{it.arn}</div>
                            </button>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                    <div className="flex items-center justify-between text-[11px]">
                      <button type="button" onClick={() => { setResourceArn(svc.arnExample); toast.success("Example ARN inserted — replace with yours"); }} className="text-muted-foreground hover:text-primary inline-flex items-center gap-1">
                        <Copy className="h-3 w-3" /> Use example
                      </button>
                      <a href={svc.consoleUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                        {svc.consoleLabel} <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>

                <Button onClick={() => setStep(2)} disabled={!resourceArn} className="w-full">
                  Next: pick change
                </Button>
              </div>
            )}

            {/* Step 2: pick change */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="rounded-md border border-border bg-background/40 px-3 py-2 text-[11px]">
                  <div className="font-mono uppercase tracking-wider text-muted-foreground mb-1">Target</div>
                  <div className="font-mono text-xs break-all">{resourceArn}</div>
                </div>

                <div>
                  <Label className="text-xs flex items-center gap-1.5">What change are you proposing? <InfoTip>Pick a common change for this resource type, or describe your own below.</InfoTip></Label>
                  <div className="mt-1 space-y-1.5">
                    {svc.changes.map((c) => (
                      <button key={c.id} type="button" onClick={() => { setChangeId(c.id); setChange(c.prompt); }} className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${changeId === c.id ? "border-primary/60 bg-primary/5" : "border-border bg-background/40 hover:bg-background/60"}`}>
                        <div className="text-sm font-medium">{c.label}</div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">{c.description}</div>
                      </button>
                    ))}
                    <button type="button" onClick={() => { setChangeId("custom"); setChange(""); }} className={`w-full text-left rounded-md border border-dashed px-3 py-2 transition-colors ${changeId === "custom" ? "border-primary/60 bg-primary/5" : "border-border bg-background/40 hover:bg-background/60"}`}>
                      <div className="text-sm font-medium">Custom change…</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">Describe it in your own words below.</div>
                    </button>
                  </div>
                </div>

                {changeId && (
                  <div>
                    <Label className="text-xs flex items-center gap-1.5">Change description <InfoTip>This is the prompt sent to the simulator. Tweak it to be more specific (account ID, role names, etc.).</InfoTip></Label>
                    <Textarea className="mt-1 text-sm font-mono text-xs leading-relaxed" rows={5} value={change} onChange={(e) => setChange(e.target.value)} placeholder="e.g. Remove the AdministratorAccess managed policy from role MyAppRole" />
                  </div>
                )}

                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" />Back</Button>
                  <Button onClick={() => { setStep(3); simulate(); }} disabled={!change || loading} className="flex-1 gap-2">
                    {loading ? "Simulating…" : <><Zap className="h-4 w-4" />Run simulation</>}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">No changes are applied to your AWS account. Simulation is read-only.</p>
              </div>
            )}

            {/* Step 3: summary of what's running / ran */}
            {step === 3 && (
              <div className="space-y-3 text-xs">
                <div className="rounded-md border border-border bg-background/40 px-3 py-2">
                  <div className="font-mono uppercase tracking-wider text-muted-foreground mb-1">Target</div>
                  <div className="font-mono break-all">{resourceArn}</div>
                </div>
                <div className="rounded-md border border-border bg-background/40 px-3 py-2">
                  <div className="font-mono uppercase tracking-wider text-muted-foreground mb-1">Change</div>
                  <div className="leading-relaxed">{change}</div>
                </div>
                <Button variant="outline" onClick={() => setStep(2)} className="w-full gap-1.5"><ArrowLeft className="h-4 w-4" />Edit change</Button>
              </div>
            )}
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