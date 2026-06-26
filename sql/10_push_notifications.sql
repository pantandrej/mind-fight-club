-- ── Push notification tokens ─────────────────────────────────
CREATE TABLE IF NOT EXISTS push_tokens (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token      text NOT NULL,
  platform   text DEFAULT 'web',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, token)
);

ALTER TABLE push_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages own tokens" ON push_tokens
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Admin push log (written by admin panel) ──────────────────
CREATE TABLE IF NOT EXISTS push_notifications_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title             text NOT NULL,
  body              text NOT NULL,
  audience          text NOT NULL DEFAULT 'all',
  sent_by           uuid REFERENCES auth.users(id),
  sent_at           timestamptz NOT NULL DEFAULT now(),
  recipients_count  int DEFAULT 0
);

ALTER TABLE push_notifications_log ENABLE ROW LEVEL SECURITY;
-- Admins can read/write (inline check so this file is self-contained)
CREATE POLICY "admins manage push log" ON push_notifications_log
  FOR ALL USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

-- ── RPC: register push token ──────────────────────────────────
CREATE OR REPLACE FUNCTION register_push_token(p_token text, p_platform text DEFAULT 'web')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO push_tokens(user_id, token, platform)
  VALUES (auth.uid(), p_token, p_platform)
  ON CONFLICT (user_id, token) DO UPDATE SET created_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION register_push_token(text, text) TO authenticated;
