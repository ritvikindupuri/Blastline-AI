-- Append-only audit log for privileged actions
-- Records all security-relevant operations for compliance and forensics

CREATE TABLE IF NOT EXISTS public.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID, -- NULL for unauthenticated attempts
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip_address TEXT,
  user_agent TEXT,
  success BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_audit_log_user_created ON public.audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource ON public.audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON public.audit_log(action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_failed ON public.audit_log(success, created_at DESC) WHERE success = false;

-- Enable RLS
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Users can only view their own audit logs
CREATE POLICY "Users view own audit logs" ON public.audit_log 
  FOR SELECT USING (auth.uid() = user_id);

-- Only service role can insert (via function calls)
CREATE POLICY "Service role inserts audit logs" ON public.audit_log 
  FOR INSERT WITH CHECK (auth.role() = 'service_role');

-- Prevent updates and deletes (append-only)
-- No UPDATE or DELETE policies = nobody can modify or delete

-- Helper function to log privileged actions
CREATE OR REPLACE FUNCTION public.log_audit_action(
  p_user_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_details JSONB DEFAULT '{}'::jsonb,
  p_success BOOLEAN DEFAULT true
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id UUID;
BEGIN
  INSERT INTO public.audit_log (
    user_id,
    action,
    resource_type,
    resource_id,
    details,
    success
  ) VALUES (
    p_user_id,
    p_action,
    p_resource_type,
    p_resource_id,
    p_details,
    p_success
  ) RETURNING id INTO v_log_id;
  
  RETURN v_log_id;
END;
$$;

-- Verify RLS on all existing tables
-- This migration ensures every table has RLS enabled

DO $$ 
DECLARE
  r RECORD;
BEGIN
  -- Enable RLS on all tables in public schema that don't have it
  FOR r IN 
    SELECT tablename 
    FROM pg_tables 
    WHERE schemaname = 'public' 
      AND tablename NOT LIKE 'pg_%'
      AND tablename NOT IN ('schema_migrations', 'supabase_migrations')
  LOOP
    -- Check if RLS is enabled
    IF NOT EXISTS (
      SELECT 1 FROM pg_tables 
      WHERE schemaname = 'public' 
        AND tablename = r.tablename 
        AND rowsecurity = true
    ) THEN
      RAISE NOTICE 'Enabling RLS on table: %', r.tablename;
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', r.tablename);
    END IF;
  END LOOP;
END $$;

-- Ensure critical tables have user_id-based policies
DO $$
BEGIN
  -- audit_log policies already defined above
  
  -- Verify aws_connections has RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'aws_connections' AND policyname LIKE '%user_id%') THEN
    RAISE NOTICE 'aws_connections missing user-based RLS policies';
  END IF;
  
  -- Verify audits has RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audits' AND policyname LIKE '%user_id%') THEN
    RAISE NOTICE 'audits missing user-based RLS policies';
  END IF;
  
  -- Verify findings has RLS (via audit ownership)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'findings') THEN
    RAISE NOTICE 'findings missing RLS policies';
  END IF;
  
  -- Verify remediations has RLS
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'remediations' AND policyname LIKE '%user_id%') THEN
    RAISE NOTICE 'remediations missing user-based RLS policies';
  END IF;
END $$;

-- Add RLS policies for findings if they don't exist
DO $$
BEGIN
  -- Findings are owned via audit ownership
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'findings' AND policyname = 'own findings s') THEN
    CREATE POLICY "own findings s" ON public.findings 
      FOR SELECT USING (
        auth.uid() IN (
          SELECT user_id FROM public.audits WHERE id = findings.audit_id
        )
      );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'findings' AND policyname = 'own findings i') THEN
    CREATE POLICY "own findings i" ON public.findings 
      FOR INSERT WITH CHECK (
        auth.uid() IN (
          SELECT user_id FROM public.audits WHERE id = findings.audit_id
        )
      );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'findings' AND policyname = 'own findings u') THEN
    CREATE POLICY "own findings u" ON public.findings 
      FOR UPDATE USING (
        auth.uid() IN (
          SELECT user_id FROM public.audits WHERE id = findings.audit_id
        )
      );
  END IF;
  
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'findings' AND policyname = 'own findings d') THEN
    CREATE POLICY "own findings d" ON public.findings 
      FOR DELETE USING (
        auth.uid() IN (
          SELECT user_id FROM public.audits WHERE id = findings.audit_id
        )
      );
  END IF;
END $$;

COMMENT ON TABLE public.audit_log IS 'Append-only audit log for security-critical operations. No updates or deletes allowed.';
