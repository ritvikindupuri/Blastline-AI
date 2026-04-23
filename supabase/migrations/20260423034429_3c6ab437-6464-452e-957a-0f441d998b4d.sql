-- Switch AWS connections from STS AssumeRole to long-lived access keys
ALTER TABLE public.aws_connections
  ALTER COLUMN role_arn DROP NOT NULL,
  ALTER COLUMN external_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS access_key_id text,
  ADD COLUMN IF NOT EXISTS secret_access_key text;