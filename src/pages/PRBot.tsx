import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GitPullRequest, Github, Copy, Check, ExternalLink, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";

const VERDICT: Record<string, string> = {
  block: "border-destructive/50 text-destructive bg-destructive/10",
  comment: "border-orange-500/50 text-orange-400 bg-orange-500/10",
  approve: "border-success/50 text-success bg-success/10",
  skipped: "border-border text-muted-foreground",
  pending: "border-border text-muted-foreground",
};

export default function PRBot() {
  const [cfg, setCfg] = useState<any | null>(null);
  const [reviews, setReviews] = useState<any[]>([]);
  const [token, setToken] = useState("");
  const [allowlist, setAllowlist] = useState("");
  const [savedHint, setSavedHint] = useState(false);
  const [copied, setCopied] = useState(false);
  const [testPlan, setTestPlan] = useState("");
  const [testing, setTesting] = useState(false);
  const [userId, setUserId] = useState<string>("");

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserId(user.id);
    const { data: c } = await supabase.from("pr_bot_configs").select("*").maybeSingle();
    if (c) {
      setCfg(c);
      setToken(c.github_token ?? "");
      setAllowlist((c.repo_allowlist ?? []).join(", "));
    }
    const { data: r } = await supabase.from("pr_reviews").select("*").order("created_at", { ascending: false }).limit(50);
    setReviews(r ?? []);
  }
  useEffect(() => { load(); }, []);

  async function save() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const repos = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
    if (cfg) {
      const { error } = await supabase.from("pr_bot_configs").update({
        github_token: token || null, repo_allowlist: repos, enabled: true,
      }).eq("id", cfg.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("pr_bot_configs").insert({
        user_id: user.id, github_token: token || null, repo_allowlist: repos, enabled: true,
      });
      if (error) return toast.error(error.message);
    }
    setSavedHint(true);
    setTimeout(() => setSavedHint(false), 2000);
    load();
  }

  async function runTest() {
    if (!testPlan.trim()) return toast.error("Paste a Terraform plan");
    setTesting(true);
    const { data, error } = await supabase.functions.invoke("github-pr-webhook/manual", {
      body: { plan_text: testPlan, repo_full_name: "manual/test", pr_number: 0, pr_title: "Manual test" },
    });
    setTesting(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    toast.success(`Verdict: ${data?.review?.verdict}`);
    load();
  }

  async function del(id: string) {
    await supabase.from("pr_reviews").delete().eq("id", id);
    load();
  }

  const projectRef = (import.meta.env.VITE_SUPABASE_URL || "").match(/https:\/\/([^.]+)/)?.[1] ?? "";
  const webhookUrl = userId && projectRef
    ? `https://${projectRef}.supabase.co/functions/v1/github-pr-webhook?owner=${userId}`
    : "";

  function copy(s: string) { navigator.clipboard.writeText(s); setCopied(true); setTimeout(() => setCopied(false), 1500); }

  return (
    <AppShell>
      <div className="space-y-6">
        <div>
          <div className="text-xs font-mono text-muted-foreground flex items-center gap-2">
            <GitPullRequest className="h-3 w-3" /> Blastline PR Bot · pre-merge security on every Terraform PR
          </div>
          <h1 className="font-display text-3xl font-bold">Stop bad infra at the pull request.</h1>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Connect once. Every PR with a <code className="font-mono text-xs">terraform plan</code> in its body or a comment gets reviewed by the Blastline agent and commented on automatically — verdict, risk score, line-by-line findings, suggested fixes.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card space-y-4">
            <div className="flex items-center gap-2">
              <Github className="h-4 w-4" />
              <div className="font-medium">Webhook setup</div>
            </div>
            <ol className="text-sm space-y-3 text-muted-foreground">
              <li>
                <span className="text-foreground">1.</span> In your repo → <span className="text-foreground">Settings → Webhooks → Add webhook</span>.
              </li>
              <li>
                <span className="text-foreground">2.</span> Payload URL:
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 font-mono text-[11px] bg-background border border-border rounded px-2 py-1.5 break-all">{webhookUrl || "Sign in to see your URL"}</code>
                  {webhookUrl && (
                    <Button size="sm" variant="ghost" onClick={() => copy(webhookUrl)}>
                      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  )}
                </div>
              </li>
              <li>
                <span className="text-foreground">3.</span> Content-type: <code className="font-mono text-xs">application/json</code>.
              </li>
              <li>
                <span className="text-foreground">4.</span> Secret (paste this exact value):
                {cfg?.webhook_secret ? (
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 font-mono text-[11px] bg-background border border-border rounded px-2 py-1.5 break-all">{cfg.webhook_secret}</code>
                    <Button size="sm" variant="ghost" onClick={() => copy(cfg.webhook_secret)}><Copy className="h-3.5 w-3.5" /></Button>
                  </div>
                ) : <span className="text-xs"> (saved after first config)</span>}
              </li>
              <li>
                <span className="text-foreground">5.</span> Events: <span className="text-foreground">Pull requests</span> + <span className="text-foreground">Issue comments</span>.
              </li>
            </ol>
          </div>

          <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card space-y-4">
            <div className="font-medium">Configuration</div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground">GitHub token (Fine-grained PAT with <code>pull_request:write</code>)</label>
              <Input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="github_pat_..." className="font-mono text-sm" />
              <div className="text-[11px] text-muted-foreground">Stored encrypted. Without it, reviews still run but no comment is posted.</div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-mono text-muted-foreground">Repo allowlist (comma-separated, optional)</label>
              <Input value={allowlist} onChange={(e) => setAllowlist(e.target.value)} placeholder="acme/infra, acme/platform" className="font-mono text-sm" />
            </div>
            <Button onClick={save}>{savedHint ? "Saved ✓" : "Save"}</Button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card/60 backdrop-blur p-5 shadow-card space-y-3">
          <div className="font-medium">Try it now — paste a plan</div>
          <Textarea rows={6} value={testPlan} onChange={(e) => setTestPlan(e.target.value)}
            placeholder='Terraform will perform the following actions:&#10;&#10;  # aws_s3_bucket.public will be created&#10;  + resource "aws_s3_bucket" "public" {&#10;      + acl = "public-read"&#10;    }&#10;&#10;Plan: 1 to add, 0 to change, 0 to destroy.'
            className="font-mono text-xs" />
          <Button onClick={runTest} disabled={testing}>
            {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Run review
          </Button>
        </div>

        <div>
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-2">Recent reviews</div>
          <div className="space-y-2">
            {reviews.length === 0 && <div className="text-sm text-muted-foreground">No PR reviews yet.</div>}
            {reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card/60 backdrop-blur p-4 shadow-card">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-mono uppercase px-2 py-0.5 rounded border ${VERDICT[r.verdict] ?? VERDICT.pending}`}>{r.verdict}</span>
                      <span className="text-xs font-mono text-muted-foreground">risk {r.risk_score}/100</span>
                      <span className="text-xs font-mono text-muted-foreground">· {r.repo_full_name}#{r.pr_number}</span>
                      {r.comment_posted && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-success/50 text-success bg-success/10">posted</span>}
                      {r.status === "no_plan" && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">no plan</span>}
                    </div>
                    <div className="mt-1.5 font-medium text-sm">{r.pr_title || "(untitled)"}</div>
                    {r.ai_summary && <div className="text-sm text-muted-foreground mt-1">{r.ai_summary}</div>}
                    {(r.findings as any[])?.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {(r.findings as any[]).slice(0, 4).map((f: any, i: number) => (
                          <div key={i} className="text-xs flex items-center gap-2">
                            <span className={`text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border ${VERDICT[f.severity === "critical" || f.severity === "high" ? "block" : f.severity === "medium" ? "comment" : "approve"]}`}>{f.severity}</span>
                            <span className="font-mono text-muted-foreground">{f.resource}</span>
                            <span className="truncate">{f.title}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {r.pr_url && <a href={r.pr_url} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-foreground"><ExternalLink className="h-3.5 w-3.5" /></a>}
                    <Button size="sm" variant="ghost" onClick={() => del(r.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </AppShell>
  );
}