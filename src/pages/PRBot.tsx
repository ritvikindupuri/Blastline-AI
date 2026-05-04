import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { GitPullRequest, Github, Check, ExternalLink, Loader2, Trash2, Sparkles, ShieldCheck, KeyRound, Wand2, ChevronRight, CircleAlert, FileCode2, Settings, Webhook } from "lucide-react";
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
  const [testPlan, setTestPlan] = useState("");
  const [testing, setTesting] = useState(false);
  const [userId, setUserId] = useState<string>("");
  const [showCustom, setShowCustom] = useState(false);

  // Agent state
  const [validating, setValidating] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [ghUser, setGhUser] = useState<any | null>(null);
  const [repos, setRepos] = useState<any[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [installResults, setInstallResults] = useState<any[] | null>(null);
  const [repoFilter, setRepoFilter] = useState("");

  async function load() {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) setUserId(user.id);
    const { data: c } = await supabase.from("pr_bot_configs").select("*").maybeSingle();
    if (c) {
      setCfg(c);
      // Pre-select previously installed repos
      setPicked(new Set(c.repo_allowlist ?? []));
    }
    const { data: r } = await supabase.from("pr_reviews").select("*").order("created_at", { ascending: false }).limit(50);
    setReviews(r ?? []);
  }
  useEffect(() => { load(); }, []);

  async function validateToken() {
    if (!token.trim()) return toast.error("Paste your GitHub token first");
    setValidating(true);
    setInstallResults(null);
    const { data, error } = await supabase.functions.invoke("agent-setup-prbot", {
      body: { action: "validate", token: token.trim() },
    });
    setValidating(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    setGhUser(data.github_user);
    setRepos(data.repos);
    if (data.repos.length === 0) toast.warning("No repos with write access found for this token");
    else toast.success(`Connected as ${data.github_user.login} — ${data.repos.length} repos available`);
  }

  async function runAgent() {
    if (picked.size === 0) return toast.error("Pick at least one repository");
    setInstalling(true);
    const { data, error } = await supabase.functions.invoke("agent-setup-prbot", {
      body: { action: "install", token: token.trim(), repos: Array.from(picked) },
    });
    setInstalling(false);
    if (error) return toast.error(error.message);
    if (data?.error) return toast.error(data.error);
    setInstallResults(data.results);
    const ok = (data.results as any[]).filter((r) => r.ok).length;
    toast.success(`Agent installed ${ok}/${data.results.length} webhooks`);
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

  const tokenPasted = token.trim().length > 10;
  const tokenValidated = !!ghUser;
  const repoList = repos.filter((r) => !repoFilter || r.full_name.toLowerCase().includes(repoFilter.toLowerCase()));

  return (
    <AppShell>
      <div className="space-y-8 max-w-[1400px]">
        {/* HERO */}
        <section className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-card via-card/80 to-background p-8">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,hsl(var(--primary)/0.15),transparent_50%)] pointer-events-none" />
          <div className="relative flex items-start justify-between gap-6 flex-wrap">
            <div className="max-w-2xl">
              <div className="inline-flex items-center gap-2 text-[11px] font-mono text-primary bg-primary/10 border border-primary/20 px-2.5 py-1 rounded-full">
                <GitPullRequest className="h-3 w-3" /> PR BOT · AGENT-INSTALLED
              </div>
              <h1 className="font-display text-4xl font-bold mt-3 tracking-tight">
                Stop bad infra <span className="text-primary">at the pull request.</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-3 leading-relaxed">
                Paste one GitHub token. The Blastline agent validates it, finds your repos, and installs the webhook
                on every one you select — no copy-paste, no settings menus, no webhook secret to manage.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3 min-w-[280px]">
              <Stat label="Repos wired" value={String((cfg?.repo_allowlist ?? []).length)} />
              <Stat label="Reviews" value={String(reviews.length)} />
              <Stat label="Status" value={cfg?.enabled ? "Live" : "—"} tone={cfg?.enabled ? "good" : undefined} />
            </div>
          </div>
        </section>

        {/* WIZARD */}
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
          <header className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wand2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Setup Wizard</span>
            </div>
            <StepBar step={tokenValidated ? (installResults ? 3 : 2) : (tokenPasted ? 1 : 0)} />
          </header>

          {/* STEP 1 — get token */}
          <div className="border-b border-border">
            <StepHeader n={1} title="Generate a GitHub token" done={tokenPasted} icon={KeyRound} />
            <div className="px-5 pb-5 grid grid-cols-1 lg:grid-cols-5 gap-5">
              <ol className="lg:col-span-3 space-y-3 text-sm">
                <Numbered n="a">
                  Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-1">
                    GitHub → Fine-grained tokens <ExternalLink className="h-3 w-3" />
                  </a>
                </Numbered>
                <Numbered n="b">
                  Token name: <code className="font-mono text-xs bg-background border border-border rounded px-1.5 py-0.5">blastline-pr-bot</code> · Expiration: 90 days
                </Numbered>
                <Numbered n="c">
                  Repository access → <span className="text-foreground">Only select repositories</span> → pick the repos you want reviewed
                </Numbered>
                <Numbered n="d">
                  Permissions → Repository → set:
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <Perm name="Administration" level="Read & write" hint="install the webhook" />
                    <Perm name="Webhooks" level="Read & write" hint="required on fine-grained tokens" />
                    <Perm name="Pull requests" level="Read & write" hint="post review comments" />
                    <Perm name="Contents" level="Read-only" hint="read terraform plans" />
                    <Perm name="Metadata" level="Read-only" hint="auto-included" />
                  </div>
                </Numbered>
                <Numbered n="e">
                  Click <span className="text-foreground">Generate token</span>, copy it, and paste it on the right →
                </Numbered>
              </ol>

              <div className="lg:col-span-2 rounded-xl border border-border bg-background/40 p-4 space-y-3 self-start">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-3.5 w-3.5 text-success" />
                  <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Why these scopes?</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  <strong className="text-foreground">Administration</strong> lets the agent install one webhook per repo automatically.
                  <strong className="text-foreground"> Pull requests</strong> lets it post the security review as a PR comment.
                  Token is stored encrypted and never leaves your backend.
                </p>
                <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens" target="_blank" rel="noreferrer" className="text-[11px] text-primary hover:underline inline-flex items-center gap-1">
                  GitHub docs <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>

          {/* STEP 2 — paste token */}
          <div className={`border-b border-border transition-opacity ${tokenPasted || tokenValidated ? "opacity-100" : "opacity-60"}`}>
            <StepHeader n={2} title="Paste your token — the agent takes over" done={tokenValidated} icon={Sparkles} />
            <div className="px-5 pb-5 space-y-3">
              <div className="flex gap-2">
                <Input
                  type="password"
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setGhUser(null); setRepos([]); setInstallResults(null); }}
                  placeholder="github_pat_11ABCDEFG0..."
                  className="font-mono text-sm h-11 flex-1"
                />
                <Button onClick={validateToken} disabled={validating || !tokenPasted} className="h-11 px-5">
                  {validating ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Talking to GitHub…</> : <>Connect</>}
                </Button>
              </div>
              {tokenValidated && (
                <div className="rounded-xl border border-success/30 bg-success/5 p-3 flex items-center gap-3">
                  {ghUser?.avatar_url && <img src={ghUser.avatar_url} alt="" className="h-8 w-8 rounded-full" />}
                  <div className="flex-1 text-sm">
                    <div>Connected as <span className="font-mono text-foreground">{ghUser.login}</span></div>
                    <div className="text-xs text-muted-foreground">{repos.length} repositories with write access</div>
                  </div>
                  <Check className="h-5 w-5 text-success" />
                </div>
              )}
            </div>
          </div>

          {/* STEP 3 — pick repos & let agent install */}
          <div className={`transition-opacity ${tokenValidated ? "opacity-100" : "opacity-50 pointer-events-none"}`}>
            <StepHeader n={3} title="Pick repos — agent installs the webhook" done={!!installResults} icon={Github} />
            <div className="px-5 pb-5 space-y-3">
              {tokenValidated && (
                <>
                  <div className="flex items-center gap-2">
                    <Input
                      value={repoFilter}
                      onChange={(e) => setRepoFilter(e.target.value)}
                      placeholder="Filter repositories…"
                      className="font-mono text-sm h-9 flex-1"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(repoList.map((r) => r.full_name)))}>Select all</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                  </div>
                  <div className="rounded-xl border border-border bg-background/30 max-h-72 overflow-y-auto divide-y divide-border/40">
                    {repoList.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No repositories match.</div>}
                    {repoList.map((r) => {
                      const checked = picked.has(r.full_name);
                      const installed = (cfg?.repo_allowlist ?? []).includes(r.full_name);
                      return (
                        <label key={r.full_name} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-background/40 ${checked ? "bg-primary/5" : ""}`}>
                          <input type="checkbox" checked={checked} onChange={(e) => {
                            const next = new Set(picked);
                            if (e.target.checked) next.add(r.full_name); else next.delete(r.full_name);
                            setPicked(next);
                          }} className="accent-primary h-4 w-4" />
                          <div className="flex-1 min-w-0 flex items-center gap-2">
                            <span className="font-mono text-sm truncate">{r.full_name}</span>
                            {r.private && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-border text-muted-foreground">private</span>}
                            {!r.admin && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-orange-500/40 text-orange-400 bg-orange-500/5">no admin</span>}
                            {installed && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-success/40 text-success bg-success/5">live</span>}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs font-mono text-muted-foreground">
                      {picked.size} selected · agent will install pull_request + issue_comment hooks
                    </div>
                    <Button onClick={runAgent} disabled={installing || picked.size === 0} className="h-10 px-5">
                      {installing ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Agent working…</> : <><Wand2 className="h-4 w-4 mr-2" />Run agent</>}
                    </Button>
                  </div>

                  {installResults && (
                    <div className="rounded-xl border border-border bg-background/30 divide-y divide-border/40">
                      {installResults.map((res, i) => (
                        <div key={i} className="px-3 py-2 flex items-center gap-3 text-sm">
                          {res.ok
                            ? <Check className="h-4 w-4 text-success shrink-0" />
                            : <CircleAlert className="h-4 w-4 text-destructive shrink-0" />}
                          <a href={`https://github.com/${res.repo}`} target="_blank" rel="noreferrer"
                             className="font-mono text-xs flex-1 truncate text-foreground hover:text-primary inline-flex items-center gap-1.5">
                            {res.repo} <ExternalLink className="h-3 w-3 opacity-60" />
                          </a>
                          <span className="text-xs text-muted-foreground truncate max-w-[35%]">{res.message}</span>
                          <a href={`https://github.com/${res.repo}/settings/hooks`} target="_blank" rel="noreferrer"
                             className="text-[10px] font-mono px-2 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary/40 inline-flex items-center gap-1">
                            <Webhook className="h-3 w-3" /> hooks
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </section>

        {/* CONFIGURED REPOS — quick view of every repo wired up */}
        {(cfg?.repo_allowlist?.length ?? 0) > 0 && (
          <section className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
            <header className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Github className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Configured Repos · live on GitHub</span>
              </div>
              <span className="text-[10px] font-mono text-muted-foreground">{cfg.repo_allowlist.length}</span>
            </header>
            <div className="divide-y divide-border/40">
              {(cfg.repo_allowlist as string[]).map((repo) => (
                <div key={repo} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-background/40 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <Github className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer"
                         className="font-mono text-sm hover:text-primary inline-flex items-center gap-1.5 truncate">
                        {repo} <ExternalLink className="h-3 w-3 opacity-60" />
                      </a>
                      <div className="text-[10px] font-mono text-muted-foreground mt-0.5">pull_request + issue_comment hooks installed</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a href={`https://github.com/${repo}`} target="_blank" rel="noreferrer"
                       className="text-[11px] font-mono px-2.5 py-1 rounded border border-border hover:border-primary/40 hover:text-primary inline-flex items-center gap-1">
                      <Github className="h-3 w-3" /> View repo
                    </a>
                    <a href={`https://github.com/${repo}/pulls`} target="_blank" rel="noreferrer"
                       className="text-[11px] font-mono px-2.5 py-1 rounded border border-border hover:border-primary/40 hover:text-primary inline-flex items-center gap-1">
                      <GitPullRequest className="h-3 w-3" /> Pull requests
                    </a>
                    <a href={`https://github.com/${repo}/settings/hooks`} target="_blank" rel="noreferrer"
                       className="text-[11px] font-mono px-2.5 py-1 rounded border border-border hover:border-primary/40 hover:text-primary inline-flex items-center gap-1">
                      <Webhook className="h-3 w-3" /> Webhook
                    </a>
                    <a href={`https://github.com/${repo}/settings`} target="_blank" rel="noreferrer"
                       className="text-[11px] font-mono px-2 py-1 rounded border border-border hover:border-primary/40 hover:text-primary inline-flex items-center gap-1">
                      <Settings className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* CUSTOM PLAN — collapsed by default */}
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
          <button
            onClick={() => setShowCustom((v) => !v)}
            className="w-full px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between hover:bg-background/60 transition-colors"
          >
            <div className="flex items-center gap-2">
              <FileCode2 className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Or paste a plan manually</span>
            </div>
            <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${showCustom ? "rotate-90" : ""}`} />
          </button>
          {showCustom && (
            <div className="p-5 space-y-3">
              <p className="text-xs text-muted-foreground">Useful for one-off reviews without configuring a webhook.</p>
              <Textarea rows={6} value={testPlan} onChange={(e) => setTestPlan(e.target.value)}
                placeholder='Terraform will perform the following actions:&#10;&#10;  # aws_s3_bucket.public will be created&#10;  + resource "aws_s3_bucket" "public" {&#10;      + acl = "public-read"&#10;    }&#10;&#10;Plan: 1 to add, 0 to change, 0 to destroy.'
                className="font-mono text-xs" />
              <Button onClick={runTest} disabled={testing}>
                {testing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Run review
              </Button>
            </div>
          )}
        </section>

        {/* RECENT REVIEWS */}
        <section className="rounded-2xl border border-border bg-card/60 backdrop-blur shadow-card overflow-hidden">
          <header className="px-5 py-3 border-b border-border bg-background/40 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Recent Reviews</span>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">{reviews.length}</span>
          </header>
          <div className="p-5 space-y-2">
            {reviews.length === 0 && <div className="text-sm text-muted-foreground text-center py-6">No PR reviews yet — they'll appear here once the bot runs.</div>}
            {reviews.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-background/30 p-4 hover:border-primary/30 transition-colors">
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
        </section>
      </div>
    </AppShell>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" }) {
  return (
    <div className="rounded-xl border border-border bg-background/60 backdrop-blur px-3 py-2.5">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`font-display text-xl font-bold mt-0.5 ${tone === "good" ? "text-success" : ""}`}>{value}</div>
    </div>
  );
}

function StepBar({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {[0, 1, 2].map((i) => (
        <div key={i} className={`h-1.5 w-8 rounded-full transition-colors ${step > i ? "bg-primary" : "bg-border"}`} />
      ))}
    </div>
  );
}

function StepHeader({ n, title, done, icon: Icon }: { n: number; title: string; done: boolean; icon: any }) {
  return (
    <div className="px-5 py-4 flex items-center gap-3">
      <div className={`h-8 w-8 rounded-full border flex items-center justify-center text-xs font-mono shrink-0 ${done ? "bg-success/10 border-success/40 text-success" : "bg-primary/10 border-primary/40 text-primary"}`}>
        {done ? <Check className="h-4 w-4" /> : n}
      </div>
      <div className="flex-1 flex items-center gap-2">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{title}</span>
      </div>
    </div>
  );
}

function Numbered({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <li className="flex gap-3 text-muted-foreground">
      <span className="font-mono text-xs text-primary mt-0.5">{n}.</span>
      <div className="flex-1 leading-relaxed">{children}</div>
    </li>
  );
}

function Perm({ name, level, hint }: { name: string; level: string; hint: string }) {
  return (
    <div className="rounded-md border border-border bg-background/40 px-2.5 py-1.5">
      <div className="text-xs font-mono text-foreground">{name}</div>
      <div className="text-[10px] font-mono text-primary">{level}</div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>
    </div>
  );
}