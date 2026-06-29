-- ── last_seen for online presence ────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_seen timestamptz;
CREATE INDEX IF NOT EXISTS idx_profiles_last_seen ON profiles(last_seen DESC) WHERE last_seen IS NOT NULL;

-- RPC: ping_presence — update last_seen (called every 60s from client)
CREATE OR REPLACE FUNCTION ping_presence()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_seen = now() WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION ping_presence() TO authenticated;
