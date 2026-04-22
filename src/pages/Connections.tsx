import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plug, Copy, CheckCircle2, XCircle, Loader2, Trash2, ShieldCheck } from "lucide-react";

function newExternalId() {
  return "sg-" + crypto.randomUUID();
}

const CFN_TEMPLATE = (externalId: string, accountId: string) => `AWSTemplateFormatVersion: '2010-09-09'
Description: SentryGrid read-only audit role
Resources:
  SentryGridAuditRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: SentryGridAuditRole
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal:
              AWS: arn:aws:iam::${accountId || "<SENTRYGRID_ACCOUNT_ID>"}:root
            Action: sts:AssumeRole
            Condition:
              StringEquals:
                sts:ExternalId: '${externalId}'
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/SecurityAudit
        - arn:aws:iam::aws:policy/ReadOnlyAccess
Outputs:
  RoleArn:
    Value: !GetAtt SentryGridAuditRole.Arn
`;

export default function Connections() {
  const { user } = useAuth();
  const [conns, setConns] = useState<any[]>([]);
  const [externalId] = useState(newExternalId());
  const [label, setLabel] = useState("Production");
  const [roleArn, setRoleArn] = useState("");
  const [region, setRegion] = useState("us-east-1");
  const [verifying, setVerifying] = useState(false);

  async function load() {
    const { data } = await supabase.from("aws_connections").select("*").order("created_at", { ascending: false });
    setConns(data ?? []);
  }
  useEffect(() => { load(); }, []);

  async function add() {
    if (!roleArn.startsWith("arn:aws:iam::")) {
      toast.error("Role ARN must start with arn:aws:iam::");
      return;
    }
    const accountId = roleArn.split(":")[4];
    const { data, error } = await supabase.from("aws_connections").insert({
      user_id: user!.id,
      account_label: label,
      role_arn: roleArn,
      external_id: externalId,
      aws_account_id: accountId,
      default_region: region,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    toast.success("Connection saved. Verifying…");
    setRoleArn("");
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

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <div className="text-xs font-mono text-muted-foreground">// configure access</div>
          <h1 className="font-display text-3xl font-bold">AWS Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Grant SentryGrid read-only access via an IAM role. We use STS AssumeRole with a unique external ID — no long-lived keys leave AWS.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-5 shadow-card">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <h3 className="font-display font-semibold">Add a new connection</h3>
          </div>

          <ol className="space-y-4 text-sm">
            <li className="space-y-2">
              <div><span className="font-mono text-primary">[1]</span> Deploy this CloudFormation template in your AWS account:</div>
              <div className="relative">
                <pre className="rounded-md border border-border bg-background/60 p-4 text-xs font-mono overflow-x-auto max-h-72">{CFN_TEMPLATE(externalId, "")}</pre>
                <Button size="sm" variant="outline" className="absolute top-2 right-2 gap-1.5"
                  onClick={() => { navigator.clipboard.writeText(CFN_TEMPLATE(externalId, "")); toast.success("Copied"); }}>
                  <Copy className="h-3 w-3" /> Copy
                </Button>
              </div>
              <div className="text-xs text-muted-foreground font-mono">External ID: <span className="text-foreground">{externalId}</span> (unique per connection)</div>
            </li>
            <li className="grid md:grid-cols-3 gap-3">
              <div>
                <Label htmlFor="lbl">Account label</Label>
                <Input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production" />
              </div>
              <div>
                <Label htmlFor="reg">Default region</Label>
                <Input id="reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
              </div>
              <div className="md:col-span-3">
                <Label htmlFor="arn"><span className="font-mono text-primary">[2]</span> Paste the resulting Role ARN</Label>
                <Input id="arn" value={roleArn} onChange={(e) => setRoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/SentryGridAuditRole" className="font-mono" />
              </div>
            </li>
          </ol>

          <Button onClick={add} disabled={!roleArn || verifying} className="gap-2 shadow-glow">
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
                <div className="font-medium">{c.account_label} <span className="text-xs text-muted-foreground font-mono ml-2">{c.aws_account_id} · {c.default_region}</span></div>
                <div className="text-xs font-mono text-muted-foreground truncate max-w-xl">{c.role_arn}</div>
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