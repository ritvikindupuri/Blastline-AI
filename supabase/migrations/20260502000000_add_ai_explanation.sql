ALTER TABLE public.principal_replays ADD COLUMN IF NOT EXISTS ai_explanation TEXT;
ALTER TABLE public.principal_replays ADD COLUMN IF NOT EXISTS timeline JSONB NOT NULL DEFAULT '[]'::jsonb;
