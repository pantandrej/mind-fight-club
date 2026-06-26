-- ============================================================
-- BFC: Stats, Leaderboard, Club Aggregation, Team Chat
-- ============================================================

-- ── 1. Player stats view ──────────────────────────────────────
-- Aggregates game_sessions into readable stats per user
CREATE OR REPLACE VIEW player_stats AS
SELECT
  p.id                                                          AS user_id,
  p.display_name,
  p.city,
  p.neurons,
  p.xp,
  COALESCE(p.daily_streak, 0)                                   AS streak,
  COALESCE(p.best_daily_streak, 0)                              AS best_streak,
  COUNT(gs.id)                                                  AS games_played,
  COUNT(gs.id) FILTER (WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')) AS duels_played,
  COALESCE(SUM(gs.correct_answers), 0)                         AS correct_total,
  COALESCE(SUM(gs.questions_count), 0)                         AS questions_total,
  CASE
    WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
    ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
  END                                                           AS accuracy_pct
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.daily_streak, p.best_daily_streak;

-- game_sessions needs correct_answers + questions_count columns
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS correct_answers int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS questions_count int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS score          int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS won            boolean DEFAULT NULL;

-- ── 2. Leaderboard view (top 100 by XP) ──────────────────────
CREATE OR REPLACE VIEW leaderboard_global AS
SELECT
  ROW_NUMBER() OVER (ORDER BY xp DESC, neurons DESC) AS rank,
  id AS user_id,
  display_name,
  city,
  xp,
  neurons,
  COALESCE(daily_streak, 0) AS streak
FROM profiles
WHERE xp > 0
ORDER BY xp DESC, neurons DESC
LIMIT 100;

-- ── 3. Club (team) aggregation ────────────────────────────────
-- Add total_neurons to teams_v2 if not exists
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS total_neurons bigint DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS total_xp      bigint DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS members_count int    DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS updated_at    timestamptz DEFAULT now();

-- Function to recalculate team totals from member profiles
CREATE OR REPLACE FUNCTION sync_team_score(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE teams_v2 t
  SET
    total_neurons  = COALESCE((
      SELECT SUM(p.neurons) FROM team_members tm
      JOIN profiles p ON p.id = tm.user_id
      WHERE tm.team_id = t.id
    ), 0),
    total_xp = COALESCE((
      SELECT SUM(p.xp) FROM team_members tm
      JOIN profiles p ON p.id = tm.user_id
      WHERE tm.team_id = t.id
    ), 0),
    members_count = COALESCE((
      SELECT COUNT(*) FROM team_members WHERE team_id = t.id
    ), 0),
    updated_at = now()
  WHERE t.id = p_team_id;
END;
$$;

GRANT EXECUTE ON FUNCTION sync_team_score(uuid) TO authenticated;

-- Leaderboard for clubs
CREATE OR REPLACE VIEW leaderboard_clubs AS
SELECT
  ROW_NUMBER() OVER (ORDER BY total_xp DESC, total_neurons DESC) AS rank,
  id AS team_id,
  name,
  city,
  avatar_emoji,
  total_xp,
  total_neurons,
  members_count
FROM teams_v2
WHERE total_xp > 0
ORDER BY total_xp DESC
LIMIT 100;

-- ── 4. Team chat ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS team_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id     uuid NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  content     text,
  sticker_id  text,            -- e.g. 'fire', 'brain', 'trophy'
  msg_type    text NOT NULL DEFAULT 'text' CHECK (msg_type IN ('text','sticker','system')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_team_messages_team ON team_messages(team_id, created_at DESC);

ALTER TABLE team_messages ENABLE ROW LEVEL SECURITY;

-- Members of a team can read and write messages
CREATE POLICY "team members read messages" ON team_messages
  FOR SELECT USING (
    team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
  );

CREATE POLICY "team members send messages" ON team_messages
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND team_id IN (SELECT team_id FROM team_members WHERE user_id = auth.uid())
    AND length(COALESCE(content, sticker_id)) <= 500
  );

-- ── 5. Admin tables ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'moderator' CHECK (role IN ('superadmin','moderator','support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;
-- Only superadmins can read (managed directly in DB)
CREATE POLICY "superadmin only" ON admin_users FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM admin_users WHERE role = 'superadmin'));

-- RLS bypass helper for server-side checks
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid());
$$;
GRANT EXECUTE ON FUNCTION is_admin() TO authenticated;

-- Admin: organizer approval
CREATE OR REPLACE FUNCTION admin_approve_organizer(p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE organizer_profiles SET status = 'approved', approved_at = now()
  WHERE user_id = p_user_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION admin_approve_organizer(uuid) TO authenticated;

-- Admin: get pending organizers
CREATE OR REPLACE FUNCTION admin_get_pending_organizers()
RETURNS TABLE(user_id uuid, display_name text, contact_email text, city text, about text, created_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  RETURN QUERY
    SELECT op.user_id, op.display_name, op.contact_email, op.city, op.about, op.created_at
    FROM organizer_profiles op WHERE op.status = 'pending'
    ORDER BY op.created_at ASC;
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_pending_organizers() TO authenticated;
