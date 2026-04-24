import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Play, Loader2 } from "lucide-react";

const SERVICES = [
  { id: "iam", label: "IAM (users, roles, policies)" },
  { id: "s3", label: "S3 (buckets, public access)" },
  { id: "ec2", label: "EC2 + Security Groups" },
  { id: "rds", label: "RDS (encryption, public)" },
  { id: "lambda", label: "Lambda (URL, env vars)" },
  { id: "cloudtrail", label: "CloudTrail (logging)" },
  { id: "guardduty", label: "GuardDuty (threat detection)" },
];

export default function NewAudit() {
  const [conns, setConns] = useState<any[]>([]);
  const [connId, setConnId] = useState<string>("");
  const [services, setServices] = useState<string[]>(SERVICES.map((s) => s.id));
  const [starting, setStarting] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("aws_connections").select("*").eq("verification_status", "verified");
      setConns(data ?? []);
      if (data?.[0]) setConnId(data[0].id);
    })();
  }, []);

  async function start() {
    if (!connId) return toast.error("Pick a connection");
    setStarting(true);
    const { data, error } = await supabase.functions.invoke("start-audit", {
      body: { connection_id: connId, services },
    });
    setStarting(false);
    if (error || !data?.audit_id) return toast.error(error?.message ?? "Failed to start");
    toast.success("Audit started");
    navigate(`/audits/${data.audit_id}`);
  }

  return (
    <AppShell>
      <div className="max-w-3xl space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground">new run</div>
          <h1 className="font-display text-3xl font-bold">Configure audit</h1>
        </div>

        {conns.length === 0 ? (
          <div className="rounded-xl border border-accent/30 bg-accent/5 p-6 text-sm">
            No verified AWS connections. Add one first under <span className="text-primary">AWS Accounts</span>.
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-6 space-y-5 shadow-card">
            <div>
              <Label>Target account</Label>
              <select className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono"
                value={connId} onChange={(e) => setConnId(e.target.value)}>
                {conns.map((c) => (
                  <option key={c.id} value={c.id}>{c.account_label} — {c.aws_account_id} ({c.default_region})</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Services to audit</Label>
              <div className="mt-2 grid sm:grid-cols-2 gap-2">
                {SERVICES.map((s) => (
                  <label key={s.id} className="flex items-center gap-2 rounded-md border border-border bg-background/50 p-3 cursor-pointer hover:border-primary/40">
                    <Checkbox
                      checked={services.includes(s.id)}
                      onCheckedChange={(v) => setServices(v ? [...services, s.id] : services.filter((x) => x !== s.id))}
                    />
                    <span className="text-sm">{s.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button onClick={start} disabled={starting || services.length === 0} className="gap-2 shadow-glow">
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              Launch agent pipeline
            </Button>
          </div>
        )}
      </div>
    </AppShell>
  );
}