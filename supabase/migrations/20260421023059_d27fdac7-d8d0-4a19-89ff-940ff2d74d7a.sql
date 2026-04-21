-- Profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own profile" ON public.profiles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = user_id);

-- updated_at trigger fn
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Connections (per-user config; tokens live in secrets, not here)
CREATE TABLE public.connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  splunk_realm TEXT,
  aws_region TEXT DEFAULT 'us-east-1',
  aws_account_label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);
ALTER TABLE public.connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own conn" ON public.connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert own conn" ON public.connections FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users update own conn" ON public.connections FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users delete own conn" ON public.connections FOR DELETE USING (auth.uid() = user_id);
CREATE TRIGGER trg_conn_updated BEFORE UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Incidents (pulled from Splunk O11y)
CREATE TABLE public.incidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  splunk_incident_id TEXT,
  detector_name TEXT,
  severity TEXT,
  status TEXT,
  triggered_at TIMESTAMPTZ,
  raw JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users CRUD own incidents s" ON public.incidents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users CRUD own incidents i" ON public.incidents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users CRUD own incidents u" ON public.incidents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users CRUD own incidents d" ON public.incidents FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_incidents_user ON public.incidents(user_id, created_at DESC);

-- War Room Runs
CREATE TABLE public.war_room_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  incident_id UUID REFERENCES public.incidents(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  final_report JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);
ALTER TABLE public.war_room_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users runs s" ON public.war_room_runs FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users runs i" ON public.war_room_runs FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users runs u" ON public.war_room_runs FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users runs d" ON public.war_room_runs FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_runs_user ON public.war_room_runs(user_id, started_at DESC);

-- Agent messages
CREATE TABLE public.agent_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.war_room_runs(id) ON DELETE CASCADE,
  agent TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'assistant',
  content TEXT,
  data JSONB,
  seq INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users msgs s" ON public.agent_messages FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users msgs i" ON public.agent_messages FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users msgs u" ON public.agent_messages FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users msgs d" ON public.agent_messages FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX idx_msgs_run ON public.agent_messages(run_id, seq);

-- Remediation actions
CREATE TABLE public.remediation_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  run_id UUID NOT NULL REFERENCES public.war_room_runs(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  risk TEXT DEFAULT 'medium',
  command_type TEXT,
  command TEXT,
  approved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.remediation_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users rem s" ON public.remediation_actions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users rem i" ON public.remediation_actions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users rem u" ON public.remediation_actions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users rem d" ON public.remediation_actions FOR DELETE USING (auth.uid() = user_id);

-- Realtime for transcript
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.war_room_runs;