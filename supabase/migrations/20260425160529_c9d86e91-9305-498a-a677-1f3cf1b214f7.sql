ALTER TABLE public.remediations
ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'not_applied',
ADD COLUMN IF NOT EXISTS executed_script TEXT,
ADD COLUMN IF NOT EXISTS execution_output TEXT,
ADD COLUMN IF NOT EXISTS aws_changes JSONB,
ADD COLUMN IF NOT EXISTS aws_console_url TEXT,
ADD COLUMN IF NOT EXISTS executed_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS idx_remediations_execution_status ON public.remediations(execution_status);

CREATE OR REPLACE FUNCTION public.set_remediation_execution_defaults()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.execution_status = 'applied' AND NEW.executed_at IS NULL THEN
    NEW.executed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS set_remediation_execution_defaults_trigger ON public.remediations;
CREATE TRIGGER set_remediation_execution_defaults_trigger
BEFORE INSERT OR UPDATE ON public.remediations
FOR EACH ROW
EXECUTE FUNCTION public.set_remediation_execution_defaults();