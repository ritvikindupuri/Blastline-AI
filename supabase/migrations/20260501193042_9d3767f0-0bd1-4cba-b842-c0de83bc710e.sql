-- principal_replays
CREATE TABLE public.principal_replays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL,
  principal_arn TEXT NOT NULL,
  account_id TEXT,
  region TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 0,
  top_apis JSONB NOT NULL DEFAULT '[]'::jsonb,
  anomalies JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary TEXT,
  ai_risk_score INTEGER NOT NULL DEFAULT 0,
  raw_sample JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'completed',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.principal_replays ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pr s" ON public.principal_replays FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pr i" ON public.principal_replays FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pr d" ON public.principal_replays FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_principal_replays_user_created ON public.principal_replays(user_id, created_at DESC);

-- pr_reviews
CREATE TABLE public.pr_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  repo_full_name TEXT NOT NULL,
  pr_number INTEGER NOT NULL,
  pr_title TEXT,
  pr_url TEXT,
  head_sha TEXT,
  author TEXT,
  plan_text TEXT,
  verdict TEXT NOT NULL DEFAULT 'pending',
  risk_score INTEGER NOT NULL DEFAULT 0,
  findings JSONB NOT NULL DEFAULT '[]'::jsonb,
  ai_summary TEXT,
  comment_posted BOOLEAN NOT NULL DEFAULT false,
  comment_url TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pr_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own prr s" ON public.pr_reviews FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own prr i" ON public.pr_reviews FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own prr u" ON public.pr_reviews FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own prr d" ON public.pr_reviews FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_pr_reviews_user_created ON public.pr_reviews(user_id, created_at DESC);

CREATE TRIGGER update_pr_reviews_updated_at
BEFORE UPDATE ON public.pr_reviews
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- pr_bot_configs (per-user GitHub token + repo allowlist, used by webhook to find owner)
CREATE TABLE public.pr_bot_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  github_token TEXT,
  webhook_secret TEXT NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
  default_connection_id UUID,
  repo_allowlist TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.pr_bot_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own pbc s" ON public.pr_bot_configs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own pbc i" ON public.pr_bot_configs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own pbc u" ON public.pr_bot_configs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own pbc d" ON public.pr_bot_configs FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER update_pr_bot_configs_updated_at
BEFORE UPDATE ON public.pr_bot_configs
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();