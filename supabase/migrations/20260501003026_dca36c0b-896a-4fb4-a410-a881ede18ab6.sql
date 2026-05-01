-- 1. Lifecycle fields on remediations
ALTER TABLE public.remediations
  ADD COLUMN IF NOT EXISTS lifecycle_state text NOT NULL DEFAULT 'proposed',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS approved_by uuid,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS executed_by uuid,
  ADD COLUMN IF NOT EXISTS verified_by uuid,
  ADD COLUMN IF NOT EXISTS verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS verification_result jsonb,
  ADD COLUMN IF NOT EXISTS rolled_back_by uuid,
  ADD COLUMN IF NOT EXISTS rolled_back_at timestamptz,
  ADD COLUMN IF NOT EXISTS rollback_reason text,
  ADD COLUMN IF NOT EXISTS attack_path_id uuid,
  ADD COLUMN IF NOT EXISTS attack_node_id text,
  ADD COLUMN IF NOT EXISTS proposer_thinking text;

-- Constrain lifecycle states
DO $$ BEGIN
  ALTER TABLE public.remediations
    ADD CONSTRAINT remediations_lifecycle_state_chk
    CHECK (lifecycle_state IN ('proposed','reviewed','approved','executed','verified','rolled_back','rejected'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Approval gating on connections
ALTER TABLE public.aws_connections
  ADD COLUMN IF NOT EXISTS require_separate_approver boolean NOT NULL DEFAULT false;

-- 3. Immutable evidence trail
CREATE TABLE IF NOT EXISTS public.remediation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  remediation_id uuid NOT NULL REFERENCES public.remediations(id) ON DELETE CASCADE,
  finding_id uuid,
  attack_path_id uuid,
  attack_node_id text,
  event_type text NOT NULL,
  actor_id uuid,
  actor_label text,
  api_call text,
  command text,
  before_state jsonb,
  after_state jsonb,
  verification jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  ALTER TABLE public.remediation_events
    ADD CONSTRAINT remediation_events_type_chk
    CHECK (event_type IN ('proposed','reviewed','approved','rejected','executed','verified','rolled_back','api_call','note'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS remediation_events_remediation_idx ON public.remediation_events(remediation_id, created_at);
CREATE INDEX IF NOT EXISTS remediation_events_path_node_idx ON public.remediation_events(attack_path_id, attack_node_id);

ALTER TABLE public.remediation_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own ev s" ON public.remediation_events FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own ev i" ON public.remediation_events FOR INSERT WITH CHECK (auth.uid() = user_id);
-- intentionally no UPDATE or DELETE policies → append-only/immutable

-- 4. Trigger: on remediations updates, set timestamps and append a remediation_event row
CREATE OR REPLACE FUNCTION public.remediation_lifecycle_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  acting uuid := auth.uid();
BEGIN
  -- Auto timestamps when state transitions
  IF NEW.lifecycle_state IS DISTINCT FROM OLD.lifecycle_state THEN
    IF NEW.lifecycle_state = 'reviewed' AND NEW.reviewed_at IS NULL THEN
      NEW.reviewed_at = now(); NEW.reviewed_by = COALESCE(NEW.reviewed_by, acting);
    ELSIF NEW.lifecycle_state = 'approved' AND NEW.approved_at IS NULL THEN
      NEW.approved_at = now(); NEW.approved_by = COALESCE(NEW.approved_by, acting);
      NEW.approved = true;
    ELSIF NEW.lifecycle_state = 'executed' AND NEW.executed_at IS NULL THEN
      NEW.executed_at = now(); NEW.executed_by = COALESCE(NEW.executed_by, acting);
      NEW.applied = true; NEW.execution_status = 'applied';
    ELSIF NEW.lifecycle_state = 'verified' AND NEW.verified_at IS NULL THEN
      NEW.verified_at = now(); NEW.verified_by = COALESCE(NEW.verified_by, acting);
    ELSIF NEW.lifecycle_state = 'rolled_back' AND NEW.rolled_back_at IS NULL THEN
      NEW.rolled_back_at = now(); NEW.rolled_back_by = COALESCE(NEW.rolled_back_by, acting);
      NEW.execution_status = 'rolled_back';
    END IF;

    -- Append immutable event (skips if no auth.uid() — e.g. service role direct edits)
    IF acting IS NOT NULL THEN
      INSERT INTO public.remediation_events (
        user_id, remediation_id, finding_id, attack_path_id, attack_node_id,
        event_type, actor_id, before_state, after_state, notes
      ) VALUES (
        NEW.user_id, NEW.id, NEW.finding_id, NEW.attack_path_id, NEW.attack_node_id,
        NEW.lifecycle_state, acting,
        jsonb_build_object('lifecycle_state', OLD.lifecycle_state, 'execution_status', OLD.execution_status),
        jsonb_build_object('lifecycle_state', NEW.lifecycle_state, 'execution_status', NEW.execution_status, 'verification', NEW.verification_result),
        NEW.review_notes
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS remediation_lifecycle_trg ON public.remediations;
CREATE TRIGGER remediation_lifecycle_trg
  BEFORE UPDATE ON public.remediations
  FOR EACH ROW
  EXECUTE FUNCTION public.remediation_lifecycle_audit();

-- 5. Backfill: set lifecycle_state for existing rows
UPDATE public.remediations SET lifecycle_state = 'executed' WHERE applied = true AND lifecycle_state = 'proposed';
UPDATE public.remediations SET lifecycle_state = 'approved' WHERE approved = true AND applied = false AND lifecycle_state = 'proposed';