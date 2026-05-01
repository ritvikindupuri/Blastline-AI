import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function gh(token: string, path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "blastline-prbot-agent",
      ...(init.headers ?? {}),
    },
  });
  return r;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "unauthenticated" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action ?? "validate";
    const token = (body?.token ?? "").trim();
    if (!token) return json({ error: "github token required" }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE);

    // 1) Validate token + grab user info
    const meR = await gh(token, "/user");
    if (!meR.ok) {
      const t = await meR.text();
      return json({ error: `Token rejected by GitHub (${meR.status}). ${t.slice(0, 200)}` }, 400);
    }
    const me = await meR.json();

    // Detect scopes (only present on classic PATs; fine-grained returns nothing here)
    const scopes = (meR.headers.get("x-oauth-scopes") ?? "").split(",").map((s) => s.trim()).filter(Boolean);

    // 2) List repos the token can access (push perms = able to comment on PRs)
    const reposR = await gh(token, "/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member");
    if (!reposR.ok) {
      return json({ error: `Could not list repositories: ${reposR.status}` }, 400);
    }
    const reposRaw: any[] = await reposR.json();
    const repos = reposRaw
      .filter((r) => r?.permissions?.admin || r?.permissions?.push || r?.permissions?.maintain)
      .map((r) => ({
        full_name: r.full_name,
        private: r.private,
        admin: !!r?.permissions?.admin,
        push: !!r?.permissions?.push,
        updated_at: r.updated_at,
      }));

    if (action === "validate") {
      return json({
        ok: true,
        github_user: { login: me.login, name: me.name, avatar_url: me.avatar_url, id: me.id },
        scopes,
        repos,
        repo_count: repos.length,
      });
    }

    if (action === "install") {
      const selected: string[] = Array.isArray(body?.repos) ? body.repos : [];
      if (selected.length === 0) return json({ error: "Pick at least one repository" }, 400);

      // Ensure config row exists & we have webhook_secret
      let { data: cfg } = await admin.from("pr_bot_configs").select("*").eq("user_id", user.id).maybeSingle();
      if (!cfg) {
        const ins = await admin.from("pr_bot_configs").insert({
          user_id: user.id,
          github_token: token,
          repo_allowlist: selected,
          enabled: true,
        }).select().single();
        if (ins.error) return json({ error: ins.error.message }, 500);
        cfg = ins.data;
      } else {
        // merge allowlist
        const merged = Array.from(new Set([...(cfg.repo_allowlist ?? []), ...selected]));
        const upd = await admin.from("pr_bot_configs").update({
          github_token: token, repo_allowlist: merged, enabled: true,
        }).eq("id", cfg.id).select().single();
        if (upd.error) return json({ error: upd.error.message }, 500);
        cfg = upd.data;
      }

      const webhookUrl = `${SUPABASE_URL}/functions/v1/github-pr-webhook?owner=${user.id}`;
      const results: Array<{ repo: string; ok: boolean; status: number; message: string; existing?: boolean }> = [];

      for (const repo of selected) {
        try {
          // Check existing hooks
          const hooksR = await gh(token, `/repos/${repo}/hooks?per_page=100`);
          if (!hooksR.ok) {
            results.push({ repo, ok: false, status: hooksR.status, message: `cannot list hooks (need admin)` });
            continue;
          }
          const hooks: any[] = await hooksR.json();
          const existing = hooks.find((h) => h?.config?.url === webhookUrl);

          const payload = {
            name: "web",
            active: true,
            events: ["pull_request", "issue_comment"],
            config: {
              url: webhookUrl,
              content_type: "json",
              secret: cfg.webhook_secret,
              insecure_ssl: "0",
            },
          };

          if (existing) {
            const patchR = await gh(token, `/repos/${repo}/hooks/${existing.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            results.push({
              repo, ok: patchR.ok, status: patchR.status, existing: true,
              message: patchR.ok ? "updated existing webhook" : `update failed: ${(await patchR.text()).slice(0, 160)}`,
            });
          } else {
            const postR = await gh(token, `/repos/${repo}/hooks`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });
            results.push({
              repo, ok: postR.ok, status: postR.status,
              message: postR.ok ? "webhook installed" : `install failed: ${(await postR.text()).slice(0, 160)}`,
            });
          }
        } catch (e: any) {
          results.push({ repo, ok: false, status: 0, message: e?.message ?? String(e) });
        }
      }

      return json({ ok: true, webhook_url: webhookUrl, results, config: cfg });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e: any) {
    console.error("agent-setup-prbot error", e);
    return json({ error: e?.message ?? String(e) }, 500);
  }
});