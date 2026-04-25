-- We've verified that role_arn, external_id, access_key_id, and secret_access_key
-- all exist in the schema and are correctly typed.
-- However, we can add a column for access_level if we want to store the
-- user's intent (audit vs remediation). For now, it's a UI concept, but let's
-- add it for completeness.

ALTER TABLE public.aws_connections
  ADD COLUMN IF NOT EXISTS access_level text DEFAULT 'audit';
