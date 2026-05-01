-- 1. Account groups
CREATE TABLE IF NOT EXISTS public.account_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  color text NOT NULL DEFAULT 'primary',
  tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ag s" ON public.account_groups FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ag i" ON public.account_groups FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own ag u" ON public.account_groups FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own ag d" ON public.account_groups FOR DELETE USING (auth.uid() = user_id);

-- 2. AWS connections — multi-account & role onboarding
ALTER TABLE public.aws_connections
  ADD COLUMN IF NOT EXISTS group_id uuid REFERENCES public.account_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tags jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS allowed_regions text[] NOT NULL DEFAULT ARRAY['us-east-1']::text[],
  ADD COLUMN IF NOT EXISTS connection_method text NOT NULL DEFAULT 'access_key',
  ADD COLUMN IF NOT EXISTS role_session_name text,
  ADD COLUMN IF NOT EXISTS is_org_member boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS environment text;

DO $$ BEGIN
  ALTER TABLE public.aws_connections
    ADD CONSTRAINT aws_connections_method_chk
    CHECK (connection_method IN ('access_key','assume_role'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. Audits — multi-account, multi-region
ALTER TABLE public.audits
  ADD COLUMN IF NOT EXISTS group_id uuid,
  ADD COLUMN IF NOT EXISTS account_ids text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS regions text[] NOT NULL DEFAULT ARRAY[]::text[],
  ADD COLUMN IF NOT EXISTS multi_account boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS risk_score integer;

-- 4. Findings — lifecycle, SLA, scoring, controls
ALTER TABLE public.findings
  ADD COLUMN IF NOT EXISTS status_lifecycle text NOT NULL DEFAULT 'open',
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS suppressed_until timestamptz,
  ADD COLUMN IF NOT EXISTS suppression_reason text,
  ADD COLUMN IF NOT EXISTS suppressed_by uuid,
  ADD COLUMN IF NOT EXISTS risk_accepted_reason text,
  ADD COLUMN IF NOT EXISTS risk_accepted_by uuid,
  ADD COLUMN IF NOT EXISTS risk_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz,
  ADD COLUMN IF NOT EXISTS finding_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS controls jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS account_id text,
  ADD COLUMN IF NOT EXISTS dedup_key text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz NOT NULL DEFAULT now();

DO $$ BEGIN
  ALTER TABLE public.findings
    ADD CONSTRAINT findings_lifecycle_chk
    CHECK (status_lifecycle IN ('open','in_progress','suppressed','risk_accepted','resolved'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Auto-set SLA + score on insert
CREATE OR REPLACE FUNCTION public.set_finding_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.sla_due_at IS NULL THEN
    NEW.sla_due_at := now() + CASE NEW.severity
      WHEN 'critical' THEN interval '24 hours'
      WHEN 'high'     THEN interval '7 days'
      WHEN 'medium'   THEN interval '30 days'
      WHEN 'low'      THEN interval '90 days'
      ELSE interval '180 days'
    END;
  END IF;
  IF NEW.finding_score = 0 THEN
    NEW.finding_score := CASE NEW.severity
      WHEN 'critical' THEN 100
      WHEN 'high'     THEN 60
      WHEN 'medium'   THEN 30
      WHEN 'low'      THEN 10
      ELSE 3 END;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.set_finding_defaults() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS set_finding_defaults_trg ON public.findings;
CREATE TRIGGER set_finding_defaults_trg
  BEFORE INSERT ON public.findings
  FOR EACH ROW EXECUTE FUNCTION public.set_finding_defaults();

-- 5. Control mappings (compliance frameworks per check)
CREATE TABLE IF NOT EXISTS public.control_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_id text NOT NULL UNIQUE,
  cis text[] NOT NULL DEFAULT ARRAY[]::text[],
  nist text[] NOT NULL DEFAULT ARRAY[]::text[],
  soc2 text[] NOT NULL DEFAULT ARRAY[]::text[],
  pci text[] NOT NULL DEFAULT ARRAY[]::text[],
  mitre text[] NOT NULL DEFAULT ARRAY[]::text[],
  description text
);
ALTER TABLE public.control_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cm read all" ON public.control_mappings FOR SELECT USING (true);

INSERT INTO public.control_mappings (check_id, cis, nist, soc2, pci, mitre, description) VALUES
  ('IAM-PWD-001',         ARRAY['1.5','1.6','1.7','1.8','1.9','1.10','1.11'], ARRAY['IA-5'],          ARRAY['CC6.1'], ARRAY['8.2.3'], ARRAY[]::text[], 'Account password policy'),
  ('IAM-KEY-AGE',         ARRAY['1.14'],                                       ARRAY['IA-5(1)'],       ARRAY['CC6.1'], ARRAY['8.2.4'], ARRAY[]::text[], 'IAM access key rotation'),
  ('IAM-TRUST-WILDCARD',  ARRAY['1.16'],                                       ARRAY['AC-6'],          ARRAY['CC6.3'], ARRAY['7.1'],   ARRAY['T1078.004'], 'Wildcard trust policy'),
  ('S3-ENC-001',          ARRAY['2.1.1'],                                      ARRAY['SC-28'],         ARRAY['CC6.7'], ARRAY['3.5.1'], ARRAY[]::text[], 'S3 default encryption'),
  ('S3-PAB-001',          ARRAY['2.1.5'],                                      ARRAY['AC-3'],          ARRAY['CC6.6'], ARRAY['1.3'],   ARRAY[]::text[], 'S3 Public Access Block'),
  ('S3-PUB-001',          ARRAY['2.1.5'],                                      ARRAY['AC-3'],          ARRAY['CC6.6'], ARRAY['1.3'],   ARRAY['T1530'],   'S3 public bucket'),
  ('EC2-SG-OPEN',         ARRAY['5.2'],                                        ARRAY['SC-7'],          ARRAY['CC6.6'], ARRAY['1.2'],   ARRAY['T1190'],   'Security group open to internet'),
  ('EBS-ENC-001',         ARRAY['2.2.1'],                                      ARRAY['SC-28'],         ARRAY['CC6.7'], ARRAY['3.5.1'], ARRAY[]::text[], 'EBS encryption at rest'),
  ('RDS-PUB-001',         ARRAY['2.3.3'],                                      ARRAY['SC-7'],          ARRAY['CC6.6'], ARRAY['1.2'],   ARRAY['T1190'],   'RDS publicly accessible'),
  ('RDS-ENC-001',         ARRAY['2.3.1'],                                      ARRAY['SC-28'],         ARRAY['CC6.7'], ARRAY['3.5.1'], ARRAY[]::text[], 'RDS storage encryption'),
  ('LAMBDA-URL-NOAUTH',   ARRAY[]::text[],                                     ARRAY['AC-3'],          ARRAY['CC6.1'], ARRAY['1.3'],   ARRAY['T1190'],   'Lambda URL unauthenticated'),
  ('LAMBDA-ENV-SECRET',   ARRAY[]::text[],                                     ARRAY['IA-5'],          ARRAY['CC6.1'], ARRAY['8.2.1'], ARRAY[]::text[], 'Plaintext secret in Lambda env'),
  ('CT-NONE',             ARRAY['3.1'],                                        ARRAY['AU-2'],          ARRAY['CC7.2'], ARRAY['10.1'],  ARRAY[]::text[], 'CloudTrail not configured'),
  ('CT-STOPPED',          ARRAY['3.1'],                                        ARRAY['AU-2'],          ARRAY['CC7.2'], ARRAY['10.1'],  ARRAY[]::text[], 'CloudTrail stopped'),
  ('GD-OFF',              ARRAY[]::text[],                                     ARRAY['SI-4'],          ARRAY['CC7.1'], ARRAY['11.4'],  ARRAY[]::text[], 'GuardDuty disabled'),
  ('KMS-ROTATION-OFF',    ARRAY['3.8'],                                        ARRAY['SC-12'],         ARRAY['CC6.7'], ARRAY['3.6.4'], ARRAY[]::text[], 'KMS key rotation disabled'),
  ('SECRETS-NO-ROTATION', ARRAY[]::text[],                                     ARRAY['IA-5(1)'],       ARRAY['CC6.1'], ARRAY['8.2.4'], ARRAY[]::text[], 'Secret rotation disabled'),
  ('ECR-NO-SCAN',         ARRAY[]::text[],                                     ARRAY['RA-5'],          ARRAY['CC7.1'], ARRAY['6.2'],   ARRAY[]::text[], 'ECR image scanning disabled'),
  ('VPC-FLOWLOGS-OFF',    ARRAY['3.9'],                                        ARRAY['AU-2','SI-4'],   ARRAY['CC7.2'], ARRAY['10.1'],  ARRAY[]::text[], 'VPC flow logs disabled'),
  ('EKS-PUBLIC-API',      ARRAY[]::text[],                                     ARRAY['AC-3','SC-7'],   ARRAY['CC6.6'], ARRAY['1.3'],   ARRAY['T1190'],   'EKS public API endpoint'),
  ('GD-CORRELATION',      ARRAY[]::text[],                                     ARRAY['IR-4','SI-4'],   ARRAY['CC7.3'], ARRAY['12.10'], ARRAY[]::text[], 'GuardDuty correlated finding'),
  ('CT-ROOT-LOGIN',       ARRAY['1.7','3.6'],                                  ARRAY['AC-2','AU-2'],   ARRAY['CC6.1'], ARRAY['8.1.5'], ARRAY['T1078'],   'Root account console login detected')
ON CONFLICT (check_id) DO NOTHING;

-- 6. Account risk scores (per audit)
CREATE TABLE IF NOT EXISTS public.account_risk_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  audit_id uuid NOT NULL,
  account_id text,
  score integer NOT NULL,
  grade text NOT NULL,
  breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.account_risk_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ars s" ON public.account_risk_scores FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ars i" ON public.account_risk_scores FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 7. Audit diffs
CREATE TABLE IF NOT EXISTS public.audit_diffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  current_audit_id uuid NOT NULL,
  previous_audit_id uuid,
  new_count integer NOT NULL DEFAULT 0,
  fixed_count integer NOT NULL DEFAULT 0,
  regressed_count integer NOT NULL DEFAULT 0,
  unchanged_count integer NOT NULL DEFAULT 0,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_diffs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own ad s" ON public.audit_diffs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ad i" ON public.audit_diffs FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 8. Scheduled audits
CREATE TABLE IF NOT EXISTS public.scheduled_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  name text NOT NULL,
  cadence text NOT NULL DEFAULT 'daily',
  services text[] NOT NULL DEFAULT ARRAY['iam','s3','ec2','rds','cloudtrail','guardduty']::text[],
  regions text[] NOT NULL DEFAULT ARRAY['us-east-1']::text[],
  enabled boolean NOT NULL DEFAULT true,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
DO $$ BEGIN
  ALTER TABLE public.scheduled_audits ADD CONSTRAINT scheduled_audits_cadence_chk
    CHECK (cadence IN ('hourly','daily','weekly'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE public.scheduled_audits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own sa s" ON public.scheduled_audits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own sa i" ON public.scheduled_audits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own sa u" ON public.scheduled_audits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "own sa d" ON public.scheduled_audits FOR DELETE USING (auth.uid() = user_id);

-- 9. Indexes
CREATE INDEX IF NOT EXISTS findings_status_idx ON public.findings(status_lifecycle, sla_due_at);
CREATE INDEX IF NOT EXISTS findings_dedup_idx ON public.findings(user_id, dedup_key);
CREATE INDEX IF NOT EXISTS audits_connection_idx ON public.audits(connection_id, created_at DESC);
CREATE INDEX IF NOT EXISTS aws_connections_group_idx ON public.aws_connections(group_id);