import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Plug, CheckCircle2, XCircle, Loader2, Trash2, ShieldCheck, ExternalLink, Eye, EyeOff } from "lucide-react";

export default function Connections() {
  const { user } = useAuth();
  const [conns, setConns] = useState<any[]>([]);
  const [label, setLabel] = useState("Production");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [secretAccessKey, setSecretAccessKey] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [region, setRegion] = useState("us-east-1");
  const [verifying, setVerifying] = useState(false);

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

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl">
        <div>
          <div className="text-xs font-mono text-muted-foreground">configure access</div>
          <h1 className="font-display text-3xl font-bold">AWS Accounts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Connect an AWS account using an IAM user's access key + secret. Trace only needs read-only permissions to audit your posture.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-5 shadow-card">
          <div className="flex items-center gap-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
            <h3 className="font-display font-semibold">Create a Trace IAM user in AWS</h3>
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
              <span className="font-mono text-primary">[2]</span> Name the user <span className="font-mono text-foreground">trace-auditor</span>. Leave “Provide user access to the AWS Management Console” <span className="font-mono text-foreground">unchecked</span>. Click <span className="font-mono text-foreground">Next</span>.
            </li>
            <li>
              <span className="font-mono text-primary">[3]</span> Choose <span className="font-mono text-foreground">Attach policies directly</span> and attach these two AWS-managed policies:
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                <div className="rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs">SecurityAudit</div>
                <div className="rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs">ReadOnlyAccess</div>
              </div>
              <div className="text-xs text-muted-foreground mt-2">Both are read-only. Trace cannot modify, create, or delete anything in your account.</div>
            </li>
            <li>
              <span className="font-mono text-primary">[4]</span> Finish creating the user. Open it, go to <span className="font-mono text-foreground">Security credentials → Access keys → Create access key</span>. Choose <span className="font-mono text-foreground">Third-party service</span>, then <span className="font-mono text-foreground">Create</span>.
            </li>
            <li>
              <span className="font-mono text-primary">[5]</span> Copy the <span className="font-mono text-foreground">Access key ID</span> and <span className="font-mono text-foreground">Secret access key</span> and paste them below.
            </li>
          </ol>

          <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-border">
            <div>
              <Label htmlFor="lbl">Account label</Label>
              <Input id="lbl" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Production" />
            </div>
            <div>
              <Label htmlFor="reg">Default region</Label>
              <Input id="reg" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="us-east-1" />
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

          <Button onClick={add} disabled={!accessKeyId || !secretAccessKey || verifying} className="gap-2 shadow-glow">
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
          ))}
        </div>
      </div>
    </AppShell>
  );
}