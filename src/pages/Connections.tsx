import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plug, CheckCircle2, XCircle, Loader2, Trash2, ShieldCheck, ExternalLink, Eye, EyeOff, Copy, Info, Filter, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/InfoTip";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const MIN_PRIVILEGE_POLICY = `{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BlastlineReadOnly",
      "Effect": "Allow",
      "Action": [
        "iam:Get*", "iam:List*", "iam:GenerateCredentialReport", "iam:GenerateServiceLastAccessedDetails",
        "s3:GetBucket*", "s3:GetObject*", "s3:ListAllMyBuckets", "s3:GetEncryptionConfiguration",
        "ec2:Describe*", "lambda:Get*", "lambda:List*",
        "rds:Describe*", "dynamodb:Describe*", "dynamodb:List*",
        "kms:Describe*", "kms:List*", "kms:GetKeyRotationStatus",
        "secretsmanager:Describe*", "secretsmanager:List*",
        "ecr:Describe*", "ecr:List*", "eks:Describe*", "eks:List*",
        "cloudtrail:Describe*", "cloudtrail:Get*", "cloudtrail:List*", "cloudtrail:LookupEvents",
        "guardduty:Get*", "guardduty:List*",
        "config:Describe*", "config:Get*", "config:List*",
        "sts:GetCallerIdentity"
      ],
      "Resource": "*"
    }
  ]
}`;

const AWS_POLICIES = {
  SecurityAudit: {
    name: "SecurityAudit",
    arn: "arn:aws:iam::aws:policy/SecurityAudit",
    blurb: "Read-only access to security configuration metadata across AWS services.",
  },
  ReadOnlyAccess: {
    name: "ReadOnlyAccess",
    arn: "arn:aws:iam::aws:policy/ReadOnlyAccess",
    blurb: "Broader read-only access — required for deep resource enumeration (S3 contents, EC2, Lambda, RDS, etc.).",
  },
} as const;

type ServiceKey = "iam" | "s3" | "ec2_lambda" | "rds_dynamodb" | "cloudtrail_guardduty";

const AUDIT_SERVICES: { key: ServiceKey; label: string; needs: ("SecurityAudit" | "ReadOnlyAccess")[] }[] = [
  { key: "iam", label: "IAM (users, roles, policies)", needs: ["SecurityAudit"] },
  { key: "cloudtrail_guardduty", label: "CloudTrail & GuardDuty", needs: ["SecurityAudit"] },
  { key: "s3", label: "S3 (buckets + object-level metadata)", needs: ["SecurityAudit", "ReadOnlyAccess"] },
  { key: "ec2_lambda", label: "EC2 & Lambda enumeration", needs: ["ReadOnlyAccess"] },
  { key: "rds_dynamodb", label: "RDS & DynamoDB", needs: ["ReadOnlyAccess"] },
];

export default function Connections() {
  const { user } = useAuth();
  const [conns, setConns] = useState<any[]>([]);
  const [label, setLabel] = useState("Production");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [region, setRegion] = useState("us-east-1");
  const [verifying, setVerifying] = useState(false);
  const [enabledServices, setEnabledServices] = useState<Set<ServiceKey>>(
    new Set<ServiceKey>(["iam", "cloudtrail_guardduty", "s3"]),
  );
  const [showAdvanced, setShowAdvanced] = useState(false);

  const recommended = (() => {
    const set = new Set<"SecurityAudit" | "ReadOnlyAccess">();
    enabledServices.forEach((s) => {
      AUDIT_SERVICES.find((x) => x.key === s)?.needs.forEach((n) => set.add(n));
    });
    return set;
  })();

  function copy(text: string, label: string) {
    navigator.clipboard.writeText(text);
    toast.success(`${label} copied`);
  }

  async function load() {
    const { data } = await supabase.from("aws_connections").select("*").order("created_at", { ascending: false });
    setConns(data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!accessKeyId.startsWith("AKIA") && !accessKeyId.startsWith("ASIA")) {
      toast.error("Access key ID should start with AKIA or ASIA");
      return;
    }
    if (secretAccessKey.length < 30) {
      toast.error("Secret access key looks invalid");
      return;
    }
    const { data, error } = await supabase.from("aws_connections").insert({
      user_id: user!.id,
      account_label: label,
      access_key_id: accessKeyId,
      secret_access_key: secretAccessKey,
      default_region: region,
      external_id: crypto.randomUUID(),
      role_arn: null,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success("Connection saved. Verifying…");
    setAccessKeyId("");
    setSecretAccessKey("");
    setVerifying(true);
    const { data: v, error: ve } = await supabase.functions.invoke("verify-aws-connection", { body: { connection_id: data.id } });
    setVerifying(false);
    if (ve) toast.error(ve.message);
    else if (v?.ok) toast.success(`Verified — caller: ${v.arn}`);
    else toast.error(v?.error ?? "Verification failed");
    load();
  }

  async function remove(id: string) {
    await supabase.from("aws_connections").delete().eq("id", id);
    toast.success("Connection removed");
    load();
  }

  async function reverify(id: string) {
    setVerifying(true);
    const { data, error } = await supabase.functions.invoke("verify-aws-connection", { body: { connection_id: id } });
    setVerifying(false);
    if (error || !data?.ok) toast.error(data?.error ?? error?.message ?? "Failed");
    else toast.success(`Verified — ${data.arn}`);
    load();
  }

  async function toggleApprover(id: string, value: boolean) {
    const { error } = await supabase.from("aws_connections").update({ require_separate_approver: value } as any).eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success(value ? "Separate approver required" : "Self-approve allowed");
    load();
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Configure access</div>
          <h1 className="font-display text-3xl font-bold flex items-center gap-2">
            AWS Accounts
            <InfoTip>Blastline runs <span className="font-mono">read-only</span> against your AWS account. Connect each account with its own IAM user + access key, scoped to the policies below.</InfoTip>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            ~2 minutes. Pick services → attach 2 AWS policies → paste your access key.
          </p>
        </div>

        {/* Compact accordion setup */}
        <Accordion type="single" collapsible defaultValue="step-1" className="space-y-2">
          {/* Step 1 — pick services */}
          <AccordionItem value="step-1" className="rounded-xl border border-border bg-card/60 backdrop-blur px-5 shadow-card">
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex items-center gap-3 text-left">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">1</div>
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">Pick what to audit <InfoTip>Drives which AWS-managed policies we recommend in the next step.</InfoTip></div>
                  <div className="text-xs text-muted-foreground">{enabledServices.size} service group{enabledServices.size === 1 ? "" : "s"} selected · needs <span className="font-mono text-primary">{Array.from(recommended).join(" + ") || "—"}</span></div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-5">
              <div className="grid sm:grid-cols-2 gap-2">
                {AUDIT_SERVICES.map((s) => {
                  const checked = enabledServices.has(s.key);
                  return (
                    <label key={s.key} className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${checked ? "border-primary/60 bg-primary/5" : "border-border bg-background/40 hover:bg-background/60"}`}>
                      <Checkbox checked={checked} onCheckedChange={(v) => {
                        setEnabledServices((prev) => { const next = new Set(prev); if (v) next.add(s.key); else next.delete(s.key); return next; });
                      }} />
                      <div className="min-w-0">
                        <div className="text-sm font-medium">{s.label}</div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">{s.needs.join(" + ")}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Step 2 — create user + attach policies */}
          <AccordionItem value="step-2" className="rounded-xl border border-border bg-card/60 backdrop-blur px-5 shadow-card">
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex items-center gap-3 text-left">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">2</div>
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">Create IAM user & attach policies <InfoTip>One dedicated read-only IAM user per AWS account. Don't reuse an existing power-user.</InfoTip></div>
                  <div className="text-xs text-muted-foreground">Console clicks or one-line CLI — your choice.</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-5 space-y-4">
              {/* Quick CLI path — fastest */}
              <div className="rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="text-xs font-mono uppercase tracking-wider text-primary flex items-center gap-1.5">⚡ Fastest · AWS CLI <InfoTip>Run from any shell with AWS CLI configured against the target account.</InfoTip></div>
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(`aws iam create-user --user-name blastline-auditor\naws iam attach-user-policy --user-name blastline-auditor --policy-arn arn:aws:iam::aws:policy/SecurityAudit\naws iam attach-user-policy --user-name blastline-auditor --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess\naws iam create-access-key --user-name blastline-auditor`, "CLI commands")}>
                    <Copy className="h-3 w-3" /> Copy
                  </Button>
                </div>
                <pre className="font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre text-foreground">{`aws iam create-user --user-name blastline-auditor
aws iam attach-user-policy --user-name blastline-auditor --policy-arn arn:aws:iam::aws:policy/SecurityAudit
aws iam attach-user-policy --user-name blastline-auditor --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam create-access-key --user-name blastline-auditor`}</pre>
                <div className="text-[11px] text-muted-foreground mt-2">Copy the <span className="font-mono">AccessKeyId</span> + <span className="font-mono">SecretAccessKey</span> from the last command's output and paste in step 3.</div>
              </div>

              {/* Console path — collapsed under disclosure */}
              <details className="group rounded-md border border-border bg-background/40">
                <summary className="cursor-pointer list-none p-3 flex items-center gap-2 text-sm">
                  <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-90" />
                  <span>Prefer clicking through the AWS console? <span className="text-muted-foreground">(3 clicks)</span></span>
                </summary>
                <div className="px-4 pb-4 pt-1 text-sm space-y-2.5 text-muted-foreground">
                  <div><span className="font-mono text-primary mr-1">1.</span> <a className="text-primary inline-flex items-center gap-1 hover:underline" href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noreferrer">Open IAM Users <ExternalLink className="h-3 w-3" /></a> → <span className="font-mono text-foreground">Create user</span>. Name it <span className="font-mono text-foreground inline-flex items-center gap-1">blastline-auditor<button type="button" onClick={() => copy("blastline-auditor", "Username")} className="hover:text-primary"><Copy className="h-3 w-3" /></button></span>. Leave console access <span className="font-mono">unchecked</span>.</div>
                  <div><span className="font-mono text-primary mr-1">2.</span> Permissions → <span className="font-mono text-foreground">Attach policies directly</span> → search for the policies below and check both.</div>
                  <div><span className="font-mono text-primary mr-1">3.</span> Open the user → <span className="font-mono text-foreground">Security credentials → Create access key → Third-party service</span>.</div>
                  <div className="rounded border border-border bg-background/60 p-2.5 flex gap-2 text-xs">
                    <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                    <div>Can't find the policies in the picker? Switch <span className="font-mono text-foreground">Filter by Type</span> from <span className="font-mono">AWS managed</span> to <span className="font-mono">All types</span>.</div>
                  </div>
                </div>
              </details>

              {/* Policies — compact one-line cards */}
              <div className="space-y-1.5">
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Policies to attach</div>
                {(Object.values(AWS_POLICIES)).map((p) => {
                  const isRecommended = recommended.has(p.name as "SecurityAudit" | "ReadOnlyAccess");
                  return (
                    <div key={p.arn} className={`rounded-md border ${isRecommended ? "border-primary/60 bg-primary/5" : "border-border bg-background/40"} px-3 py-2 flex items-center gap-3 flex-wrap`}>
                      <span className="font-display font-semibold text-sm">{p.name}</span>
                      {isRecommended && <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground">Recommended</span>}
                      <span className="font-mono text-[11px] text-muted-foreground truncate flex-1 min-w-0">{p.arn}</span>
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(p.name, p.name)}><Copy className="h-3 w-3" /> Name</Button>
                        <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(p.arn, "ARN")}><Copy className="h-3 w-3" /> ARN</Button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Advanced — minimum-privilege JSON */}
              <button type="button" onClick={() => setShowAdvanced((s) => !s)} className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-primary inline-flex items-center gap-1.5">
                <ChevronRight className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
                Advanced · minimum-privilege custom policy
              </button>
              {showAdvanced && (
                <div className="rounded-md border border-border bg-background/60 overflow-hidden">
                  <div className="flex items-center justify-between border-b border-border bg-background/80 px-3 py-1.5">
                    <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">BlastlineReadOnly · IAM policy JSON</span>
                    <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(MIN_PRIVILEGE_POLICY, "Policy JSON")}><Copy className="h-3 w-3" /> Copy JSON</Button>
                  </div>
                  <pre className="p-3 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre max-h-64">{MIN_PRIVILEGE_POLICY}</pre>
                  <div className="px-3 py-2 text-[11px] text-muted-foreground border-t border-border">In AWS: <span className="font-mono text-foreground">IAM → Policies → Create policy → JSON</span> → paste → name it <span className="font-mono text-foreground">BlastlineReadOnly</span>.</div>
                </div>
              )}
            </AccordionContent>
          </AccordionItem>

          {/* Step 3 — paste keys */}
          <AccordionItem value="step-3" className="rounded-xl border border-border bg-card/60 backdrop-blur px-5 shadow-card">
            <AccordionTrigger className="hover:no-underline py-4">
              <div className="flex items-center gap-3 text-left">
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">3</div>
                <div>
                  <div className="text-sm font-semibold flex items-center gap-2">Paste access key <InfoTip>Stored encrypted at rest. Never displayed in logs or shared with model providers.</InfoTip></div>
                  <div className="text-xs text-muted-foreground">Blastline runs <span className="font-mono text-primary">sts:GetCallerIdentity</span> to verify.</div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pb-5 space-y-4">
              <div className="grid md:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="lbl" className="flex items-center gap-1.5">Account label <InfoTip>Friendly name shown across Blastline (e.g. "Production", "EU staging").</InfoTip></Label>
              <Input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production" />
            </div>
            <div>
              <Label htmlFor="reg" className="flex items-center gap-1.5">Default region <InfoTip>Region used when an audit doesn't specify one. Audits can still target other regions per run.</InfoTip></Label>
              <Input id="reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
            </div>
            <div>
              <Label htmlFor="ak" className="flex items-center gap-1.5">Access Key ID <InfoTip>Starts with <span className="font-mono">AKIA</span> (long-lived) or <span className="font-mono">ASIA</span> (temporary STS).</InfoTip></Label>
              <Input id="ak" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" className="font-mono" autoComplete="off" />
            </div>
            <div>
              <Label htmlFor="sk" className="flex items-center gap-1.5">Secret Access Key <InfoTip>Stored encrypted at rest. Never displayed in logs or shared with model providers.</InfoTip></Label>
              <div className="relative">
                <Input id="sk" type={showSecret ? "text" : "password"} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} placeholder="••••••••••••••••" className="font-mono pr-9" autoComplete="off" />
                <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
              </div>
              <Button onClick={add} disabled={!accessKeyId || !secretAccessKey || verifying} className="gap-2 shadow-glow">
                {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
                Save & verify connection
              </Button>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div className="space-y-3">
          <h3 className="font-display font-semibold text-lg flex items-center gap-2">Connected accounts <InfoTip>Each row is one AWS account. Re-verify periodically to confirm credentials still work.</InfoTip></h3>
          {conns.length === 0 && <div className="text-sm text-muted-foreground">No connections yet.</div>}
          {conns.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium">{c.account_label} <span className="text-xs text-muted-foreground font-mono ml-2">{c.aws_account_id} · {c.default_region}</span></div>
                  <div className="text-xs font-mono text-muted-foreground truncate max-w-xl">{c.access_key_id ? `${c.access_key_id.slice(0, 8)}••••${c.access_key_id.slice(-4)}` : c.role_arn}</div>
                </div>
                <div className="flex items-center gap-2">
                  {c.verification_status === "verified" ? (
                    <span className="flex items-center gap-1 text-xs font-mono text-success"><CheckCircle2 className="h-3.5 w-3.5" /> verified</span>
                  ) : c.verification_status === "failed" ? (
                    <span className="flex items-center gap-1 text-xs font-mono text-sev-critical"><XCircle className="h-3.5 w-3.5" /> failed</span>
                  ) : (
                    <span className="text-xs font-mono text-muted-foreground">pending</span>
                  )}
                  <Button size="sm" variant="outline" onClick={() => reverify(c.id)}>Re-verify</Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(c.id)}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between rounded-md border border-border/60 bg-background/40 px-3 py-2">
                <div>
                  <div className="text-xs font-medium flex items-center gap-1.5">Require separate approver for remediations <InfoTip>Two-person rule. The user who proposes a remediation cannot approve it. Strongly recommended for production accounts.</InfoTip></div>
                  <div className="text-[11px] text-muted-foreground">When on, the user who proposes a fix can&apos;t also approve it. Recommended for production.</div>
                </div>
                <label className="inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    className="sr-only peer"
                    checked={Boolean(c.require_separate_approver)}
                    onChange={(e) => toggleApprover(c.id, e.target.checked)}
                  />
                  <div className="relative w-10 h-5 bg-secondary rounded-full peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-background after:rounded-full after:h-4 after:w-4 after:transition-transform peer-checked:after:translate-x-5"></div>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}