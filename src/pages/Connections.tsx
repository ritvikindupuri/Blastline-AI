import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plug, CheckCircle2, XCircle, Loader2, Trash2, ShieldCheck, ExternalLink, Eye, EyeOff, Copy, Info, Filter } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/InfoTip";

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
            Three steps: create an IAM user → attach permissions → paste the access key here. Takes about 2 minutes.
          </p>
        </div>

        {/* Stepper */}
        <div className="grid grid-cols-3 gap-2">
          {[
            { n: 1, t: "Create IAM user", s: "in AWS console" },
            { n: 2, t: "Attach permissions", s: "managed policy or JSON" },
            { n: 3, t: "Paste access key", s: "Blastline verifies it" },
          ].map((s) => (
            <div key={s.n} className="rounded-md border border-border bg-card/40 px-3 py-2.5 flex items-center gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/40 bg-primary/10 font-mono text-xs text-primary">{s.n}</div>
              <div className="min-w-0">
                <div className="text-sm font-medium leading-tight">{s.t}</div>
                <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{s.s}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Audit preset */}
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-4 shadow-card">
          <div className="flex items-center gap-2 text-primary">
            <Filter className="h-5 w-5" />
            <h3 className="font-display font-semibold flex items-center gap-2">
              Audit preset
              <InfoTip>Pick which AWS service families Blastline should scan. We only recommend the AWS-managed policies you actually need based on your selection — minimum privilege.</InfoTip>
            </h3>
          </div>
          <p className="text-sm text-muted-foreground">
            Pick the services Blastline should audit. We'll recommend the minimal set of AWS-managed policies to attach.
          </p>
          <div className="grid sm:grid-cols-2 gap-2">
            {AUDIT_SERVICES.map((s) => {
              const checked = enabledServices.has(s.key);
              return (
                <label
                  key={s.key}
                  className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                    checked ? "border-primary/60 bg-primary/5" : "border-border bg-background/40 hover:bg-background/60"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => {
                      setEnabledServices((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(s.key); else next.delete(s.key);
                        return next;
                      });
                    }}
                  />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{s.label}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{s.needs.join(" + ")}</div>
                  </div>
                </label>
              );
            })}
          </div>
          <div className="rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
            <span className="text-muted-foreground">Recommended policies for your selection: </span>
            {recommended.size === 0 ? (
              <span className="text-muted-foreground">none — pick at least one service.</span>
            ) : (
              <span className="font-mono text-primary">{Array.from(recommended).join(" + ")}</span>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-5 shadow-card">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <h3 className="font-display font-semibold flex items-center gap-2">
              Create a Blastline IAM user in AWS
              <InfoTip>Each AWS account you connect needs its own dedicated IAM user with only the read permissions Blastline requires. Don't reuse an existing power-user.</InfoTip>
            </h3>
          </div>

          <ol className="space-y-4 text-sm leading-relaxed">
            <li>
              <span className="font-mono text-primary">[1]</span> Open the{" "}
              <a className="text-primary inline-flex items-center gap-1 hover:underline" href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noreferrer">
                IAM Users console <ExternalLink className="h-3 w-3" />
              </a>{" "}
              and click <span className="font-mono text-foreground">Create user</span>.
            </li>
            <li>
              <span className="font-mono text-primary">[2]</span> Name the user{" "}
              <span className="font-mono text-foreground inline-flex items-center gap-1">blastline-auditor
                <button type="button" onClick={() => copy("blastline-auditor", "Username")} className="text-muted-foreground hover:text-primary"><Copy className="h-3 w-3" /></button>
              </span>. Leave “Provide user access to the AWS Management Console” <span className="font-mono text-foreground">unchecked</span>. Click <span className="font-mono text-foreground">Next</span>, then <span className="font-mono text-foreground">Next</span> again on the permissions screen (we'll attach permissions on the next step). Click <span className="font-mono text-foreground">Create user</span>.
            </li>
            <li>
              <span className="font-mono text-primary">[3]</span> Open the new <span className="font-mono text-foreground">blastline-auditor</span> user, go to the <span className="font-mono text-foreground">Permissions</span> tab and choose <span className="font-mono text-foreground">Add permissions → Attach policies directly</span>. Attach the AWS-managed policies below
              <InfoTip>You can also paste the minimum-privilege custom policy further down — that's the most-secure option.</InfoTip>.
              <div className="mt-3 space-y-2">
                {(Object.values(AWS_POLICIES)).map((p) => {
                  const isRecommended = recommended.has(p.name as "SecurityAudit" | "ReadOnlyAccess");
                  return (
                    <div
                      key={p.arn}
                      className={`rounded-md border ${isRecommended ? "border-primary/60 bg-primary/5" : "border-border bg-background/60"} p-3`}
                    >
                      <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-display font-semibold text-sm">{p.name}</span>
                          {isRecommended && (
                            <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                              Recommended
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(p.name, p.name)}>
                            <Copy className="h-3 w-3" /> Name
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(p.arn, "ARN")}>
                            <Copy className="h-3 w-3" /> ARN
                          </Button>
                        </div>
                      </div>
                      <div className="mt-1.5 font-mono text-xs text-muted-foreground break-all">{p.arn}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{p.blurb}</div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-md border border-border bg-background/40 p-3 flex gap-2 text-xs text-muted-foreground">
                <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  Can't find <span className="font-mono text-foreground">ReadOnlyAccess</span> or <span className="font-mono text-foreground">SecurityAudit</span> in the picker?
                  Click <span className="font-mono text-foreground">Filter by Type</span> at the top of the policy list and switch it from
                  <span className="font-mono text-foreground"> AWS managed</span> to <span className="font-mono text-foreground">All types</span>.
                  Both policies live under the <span className="font-mono text-foreground">Job function</span> category and are hidden by the default filter.
                </div>
              </div>
            </li>
            <li>
              <span className="font-mono text-primary">[3b]</span> <span className="text-muted-foreground">(Most secure, optional)</span> Instead of the managed policies above, attach this minimum-privilege custom policy
              <InfoTip>Same coverage as SecurityAudit + ReadOnlyAccess but scoped to only the API actions Blastline calls. Recommended for production.</InfoTip>:
              <div className="mt-2 rounded-md border border-border bg-background/60 overflow-hidden">
                <div className="flex items-center justify-between border-b border-border bg-background/80 px-3 py-1.5">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">BlastlineReadOnly · IAM policy JSON</span>
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={() => copy(MIN_PRIVILEGE_POLICY, "Policy JSON")}>
                    <Copy className="h-3 w-3" /> Copy JSON
                  </Button>
                </div>
                <pre className="p-3 font-mono text-[11px] leading-relaxed overflow-x-auto whitespace-pre max-h-64">{MIN_PRIVILEGE_POLICY}</pre>
              </div>
              <div className="mt-2 text-xs text-muted-foreground">In AWS: <span className="font-mono text-foreground">IAM → Policies → Create policy → JSON</span> → paste → name it <span className="font-mono text-foreground">BlastlineReadOnly</span> → attach to <span className="font-mono text-foreground">blastline-auditor</span>.</div>
            </li>
            <li>
              <span className="font-mono text-primary">[4]</span> <span className="text-muted-foreground">(Faster, optional)</span> Or attach both ARNs from the AWS CLI:
              <pre className="mt-2 rounded-md border border-border bg-background/60 p-3 font-mono text-xs overflow-x-auto whitespace-pre">{`aws iam attach-user-policy --user-name blastline-auditor \\
  --policy-arn arn:aws:iam::aws:policy/SecurityAudit
aws iam attach-user-policy --user-name blastline-auditor \\
  --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess`}</pre>
            </li>
            <li>
              <span className="font-mono text-primary">[5]</span> On the user, go to <span className="font-mono text-foreground">Security credentials → Access keys → Create access key</span>. Choose <span className="font-mono text-foreground">Third-party service</span>, then <span className="font-mono text-foreground">Create</span>.
            </li>
            <li>
              <span className="font-mono text-primary">[6]</span> Copy the <span className="font-mono text-foreground">Access key ID</span> and <span className="font-mono text-foreground">Secret access key</span> and paste them below.
              <InfoTip>The secret is shown only once in AWS. If you lose it, deactivate the key and create a new one — never email or share the secret.</InfoTip>
            </li>
          </ol>

          <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-border">
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
        </div>

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