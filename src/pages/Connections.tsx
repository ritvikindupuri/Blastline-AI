import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plug, CheckCircle2, XCircle, Loader2, Trash2, ShieldCheck, ExternalLink, Eye, EyeOff, Copy, Info, Filter, Key } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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

  // Role ARN state
  const [roleArn, setRoleArn] = useState("");
  const [externalId] = useState(() => crypto.randomUUID());

  // Access Key state
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);

  const [region, setRegion] = useState("us-east-1");
  const [verifying, setVerifying] = useState(false);
  const [enabledServices, setEnabledServices] = useState<Set<ServiceKey>>(
    new Set<ServiceKey>(["iam", "cloudtrail_guardduty", "s3"]),
  );

  const [connType, setConnType] = useState<"role" | "keys">("role");
  const [accessLevel, setAccessLevel] = useState<"audit" | "remediation">("audit");

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
    const payload: any = {
      user_id: user!.id,
      account_label: label,
      default_region: region,
      external_id: externalId,
      access_level: accessLevel,
    };

    if (connType === "keys") {
      if (!accessKeyId.startsWith("AKIA") && !accessKeyId.startsWith("ASIA")) {
        toast.error("Access key ID should start with AKIA or ASIA");
        return;
      }
      if (secretAccessKey.length < 30) {
        toast.error("Secret access key looks invalid");
        return;
      }
      payload.access_key_id = accessKeyId;
      payload.secret_access_key = secretAccessKey;
      payload.role_arn = null;
    } else {
      if (!roleArn.startsWith("arn:aws:iam::")) {
        toast.error("Role ARN should start with arn:aws:iam::");
        return;
      }
      payload.role_arn = roleArn;
      payload.access_key_id = null;
      payload.secret_access_key = null;
    }

    const { data, error } = await supabase.from("aws_connections").insert(payload).select().single();
    if (error) { toast.error(error.message); return; }

    toast.success("Connection saved. Verifying…");
    if (connType === "keys") {
      setAccessKeyId("");
      setSecretAccessKey("");
    } else {
      setRoleArn("");
    }

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

  const isSaveDisabled = verifying || (connType === "keys" ? (!accessKeyId || !secretAccessKey) : !roleArn);

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <div className="text-xs font-mono text-muted-foreground">Configure access</div>
          <h1 className="font-display text-3xl font-bold">AWS Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect an AWS account using a cross-account IAM Role (recommended) or access keys. Trace primarily needs read-only permissions to audit your posture.
          </p>
        </div>

        {/* Audit preset */}
        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-4 shadow-card">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary">
              <Filter className="h-5 w-5" />
              <h3 className="font-display font-semibold">Access Scope</h3>
            </div>
          </div>

          <div className="flex gap-4 p-1 rounded-lg bg-background/50 border border-border w-fit">
            <Button
              variant={accessLevel === "audit" ? "default" : "ghost"}
              size="sm"
              className={accessLevel === "audit" ? "shadow-glow" : ""}
              onClick={() => setAccessLevel("audit")}
            >
              Audit-only
            </Button>
            <Button
              variant={accessLevel === "remediation" ? "default" : "ghost"}
              size="sm"
              className={accessLevel === "remediation" ? "shadow-glow" : ""}
              onClick={() => setAccessLevel("remediation")}
            >
              Audit + Remediation
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            {accessLevel === "audit"
              ? "Pick the services Trace should audit. We'll recommend the minimal set of AWS-managed policies to attach."
              : "Remediation requires additional permissions. Trace will prompt for approval before executing any destructive or mutating actions."}
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
              <span className="font-mono text-primary">
                {Array.from(recommended).join(" + ")}
                {accessLevel === "remediation" && " + Custom Remediation Policy"}
              </span>
            )}
          </div>

          {accessLevel === "remediation" && (
             <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex gap-2">
               <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
               <div className="text-muted-foreground">
                 <strong className="text-amber-500">Warning:</strong> Remediation requires write access. We recommend restricting remediation roles to specific tag-based conditions or designated test accounts initially.
               </div>
             </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-5 shadow-card">
          <Tabs defaultValue="role" onValueChange={(v) => setConnType(v as "role" | "keys")}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2 text-primary">
                <ShieldCheck className="h-5 w-5" />
                <h3 className="font-display font-semibold">Connect AWS Account</h3>
              </div>
              <TabsList className="grid w-[300px] grid-cols-2">
                <TabsTrigger value="role">Role ARN</TabsTrigger>
                <TabsTrigger value="keys">Access Keys</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="role" className="space-y-4">
              <ol className="space-y-4 text-sm leading-relaxed">
                <li>
                  <span className="font-mono text-primary">[1]</span> Open the{" "}
                  <a className="text-primary inline-flex items-center gap-1 hover:underline" href="https://console.aws.amazon.com/iam/home#/roles" target="_blank" rel="noreferrer">
                    IAM Roles console <ExternalLink className="h-3 w-3" />
                  </a>{" "}
                  and click <span className="font-mono text-foreground">Create role</span>.
                </li>
                <li>
                  <span className="font-mono text-primary">[2]</span> Select <span className="font-mono text-foreground">AWS account</span> as the trusted entity type. Select <span className="font-mono text-foreground">Another AWS account</span> and enter Trace's Account ID: <span className="font-mono font-bold text-primary">767397793134</span> <i>(example)</i>.
                </li>
                <li>
                  <span className="font-mono text-primary">[3]</span> Check <span className="font-mono text-foreground">Require external ID</span> and paste this exact value:
                  <div className="mt-2 flex items-center gap-2">
                    <code className="px-2 py-1 bg-background/60 border border-border rounded font-mono text-primary text-xs">{externalId}</code>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => copy(externalId, "External ID")}>
                      <Copy className="h-3 w-3 mr-1" /> Copy
                    </Button>
                  </div>
                </li>
                <li>
                  <span className="font-mono text-primary">[4]</span> Attach the recommended policies shown in the Access Scope section above. Name the role <span className="font-mono text-foreground">trace-auditor-role</span>.
                </li>
                <li>
                  <span className="font-mono text-primary">[5]</span> After creating, copy the <span className="font-mono text-foreground">Role ARN</span> and paste it below.
                </li>
              </ol>

              <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-border mt-4">
                <div>
                  <Label htmlFor="role-lbl">Account label</Label>
                  <Input id="role-lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production" />
                </div>
                <div>
                  <Label htmlFor="role-reg">Default region</Label>
                  <Input id="role-reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="role-arn">Role ARN</Label>
                  <Input id="role-arn" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/trace-auditor-role" className="font-mono" autoComplete="off" />
                </div>
              </div>
            </TabsContent>

            <TabsContent value="keys" className="space-y-4">
              <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm flex gap-2 mb-4">
               <Info className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
               <div className="text-muted-foreground">
                 <strong className="text-amber-500">Not Recommended:</strong> Long-lived access keys are a security risk. Please use cross-account Role ARNs if possible.
               </div>
             </div>

              <ol className="space-y-4 text-sm leading-relaxed">
                <li>
                  <span className="font-mono text-primary">[1]</span> Create an IAM User named <span className="font-mono text-foreground">trace-auditor</span>.
                </li>
                <li>
                  <span className="font-mono text-primary">[2]</span> Attach the recommended policies shown above.
                </li>
                <li>
                  <span className="font-mono text-primary">[3]</span> Create a <span className="font-mono text-foreground">Third-party service</span> Access Key.
                </li>
                <li>
                  <span className="font-mono text-primary">[4]</span> Paste the <span className="font-mono text-foreground">Access key ID</span> and <span className="font-mono text-foreground">Secret access key</span> below.
                </li>
              </ol>

              <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-border mt-4">
                <div>
                  <Label htmlFor="key-lbl">Account label</Label>
                  <Input id="key-lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production" />
                </div>
                <div>
                  <Label htmlFor="key-reg">Default region</Label>
                  <Input id="key-reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
                </div>
                <div>
                  <Label htmlFor="ak">Access Key ID</Label>
                  <Input id="ak" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)} placeholder="AKIA…" className="font-mono" autoComplete="off" />
                </div>
                <div>
                  <Label htmlFor="sk">Secret Access Key</Label>
                  <div className="relative">
                    <Input id="sk" type={showSecret ? "text" : "password"} value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)} placeholder="••••••••••••••••" className="font-mono pr-9" autoComplete="off" />
                    <button type="button" onClick={() => setShowSecret((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>
            </TabsContent>
          </Tabs>

          <Button onClick={add} disabled={isSaveDisabled} className="gap-2 shadow-glow w-full sm:w-auto">
            {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            Save & verify connection
          </Button>
        </div>

        <div className="space-y-3">
          <h3 className="font-display font-semibold text-lg">Connected accounts</h3>
          {conns.length === 0 && <div className="text-sm text-muted-foreground">No connections yet.</div>}
          {conns.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 flex items-center justify-between">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {c.account_label}
                  <span className="text-xs text-muted-foreground font-mono bg-background/50 px-1.5 py-0.5 rounded border border-border">
                    {c.aws_account_id} · {c.default_region}
                  </span>
                  {c.role_arn && (
                     <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/20 text-primary border border-primary/30">
                       ROLE ARN
                     </span>
                  )}
                  {c.access_key_id && (
                     <span className="text-[10px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-500 border border-amber-500/30">
                       ACCESS KEYS
                     </span>
                  )}
                </div>
                <div className="text-xs font-mono text-muted-foreground truncate max-w-xl mt-1">
                  {c.role_arn ? c.role_arn : (c.access_key_id ? `${c.access_key_id.slice(0, 8)}••••${c.access_key_id.slice(-4)}` : 'Unknown')}
                </div>
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
          ))}
        </div>
      </div>
    </AppShell>
  );
}
