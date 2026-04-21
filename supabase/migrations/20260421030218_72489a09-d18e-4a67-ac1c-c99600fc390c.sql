-- Drop old SRE/Splunk tables
DROP TABLE IF EXISTS public.remediation_actions CASCADE;
DROP TABLE IF EXISTS public.agent_messages CASCADE;
DROP TABLE IF EXISTS public.war_room_runs CASCADE;
DROP TABLE IF EXISTS public.incidents CASCADE;
DROP TABLE IF EXISTS public.connections CASCADE;

-- =========================================================
-- AWS Connections (read-only IAM role assumption)
-- =========================================================
CREATE TABLE public.aws_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  account_label TEXT NOT NULL,
  aws_account_id TEXT,
  role_arn TEXT NOT NULL,
  external_id TEXT NOT NULL,
  default_region TEXT NOT NULL DEFAULT 'us-east-1',
  last_verified_at TIMESTAMPTZ,
  verification_status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.aws_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own conn s" ON public.aws_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own conn i" ON public.aws_connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own conn u" ON public.aws_connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own conn d" ON public.aws_connections FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER aws_conn_updated BEFORE UPDATE ON public.aws_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================================================
-- Audits (scan runs)
-- =========================================================
CREATE TABLE public.audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  connection_id UUID NOT NULL REFERENCES public.aws_connections(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | completed | failed
  scope JSONB,                            -- which services/regions
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  summary JSONB,                          -- counts by severity, etc.
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own audits s" ON public.audits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own audits i" ON public.audits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own audits u" ON public.audits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own audits d" ON public.audits FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- Findings
-- =========================================================
CREATE TABLE public.findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  check_id TEXT NOT NULL,                 -- e.g. CIS_1_4, IAM_WILDCARD_ADMIN
  title TEXT NOT NULL,
  description TEXT,
  service TEXT NOT NULL,                  -- iam, s3, ec2, lambda, rds, guardduty, cloudtrail...
  region TEXT,
  resource_arn TEXT,
  severity TEXT NOT NULL,                 -- info | low | medium | high | critical
  status TEXT NOT NULL DEFAULT 'open',    -- open | suppressed | fixed
  framework_refs JSONB,                   -- {"cis": ["1.4"], "nist": ["AC-2"]}
  evidence JSONB,                         -- raw API output snippet
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  critic_verdict TEXT,                    -- confirmed | false_positive | uncertain
  critic_reasoning TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX findings_audit_idx ON public.findings(audit_id);
CREATE INDEX findings_user_idx ON public.findings(user_id);
ALTER TABLE public.findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own find s" ON public.findings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own find i" ON public.findings FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own find u" ON public.findings FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own find d" ON public.findings FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- Attack paths (chained findings)
-- =========================================================
CREATE TABLE public.attack_paths (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  narrative TEXT,
  severity TEXT NOT NULL,
  blast_radius JSONB,        -- {resources: n, data_classes: [...], tier: "crown_jewels"}
  graph JSONB NOT NULL,      -- {nodes:[], edges:[]}
  finding_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.attack_paths ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ap s" ON public.attack_paths FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ap i" ON public.attack_paths FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own ap u" ON public.attack_paths FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own ap d" ON public.attack_paths FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- Agent transcripts (live reasoning stream)
-- =========================================================
CREATE TABLE public.agent_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,        -- recon | misconfig | attackpath | blastradius | remediation | critic | reporter
  phase TEXT,                 -- thinking | tool_call | result | conclusion
  content TEXT,
  data JSONB,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX transcripts_audit_idx ON public.agent_transcripts(audit_id, seq);
ALTER TABLE public.agent_transcripts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tr s" ON public.agent_transcripts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own tr i" ON public.agent_transcripts FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own tr d" ON public.agent_transcripts FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- Remediations
-- =========================================================
CREATE TABLE public.remediations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  finding_id UUID NOT NULL REFERENCES public.findings(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  risk TEXT NOT NULL DEFAULT 'medium',   -- low | medium | high
  fix_type TEXT NOT NULL,                -- terraform | aws_cli | console_steps
  snippet TEXT NOT NULL,
  approved BOOLEAN NOT NULL DEFAULT false,
  applied BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.remediations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rem s" ON public.remediations FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own rem i" ON public.remediations FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own rem u" ON public.remediations FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own rem d" ON public.remediations FOR DELETE USING (auth.uid() = user_id);

-- =========================================================
-- Realtime for live audit UI
-- =========================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_transcripts;
ALTER PUBLICATION supabase_realtime ADD TABLE public.findings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.audits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.attack_paths;

-- Ensure handle_new_user trigger exists on auth.users (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();