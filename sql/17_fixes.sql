-- ── Fix 1: activity feed — allow public read of recent pack_results ──
-- Drop private-only policy, add public read for recent rows
DROP POLICY IF EXISTS "pack_results select own" ON pack_results;

-- Own rows: full access (history in profile)
CREATE POLICY "pack_results select own" ON pack_results
  FOR SELECT USING (auth.uid() = user_id);

-- Public feed: anyone can see last 24h results (no user_id exposed in query)
CREATE POLICY "pack_results public feed" ON pack_results
  FOR SELECT USING (played_at > now() - interval '24 hours');

-- ── Fix 2: player_stats — include pack_results in games count ─────────
CREATE OR REPLACE VIEW player_stats AS
SELECT
  p.id                                                          AS user_id,
  p.display_name,
  p.city,
  p.neurons,
  p.xp,
  COALESCE(p.daily_streak, 0)                                   AS streak,
  COALESCE(p.best_daily_streak, 0)                              AS best_streak,
  -- game_sessions (duels, training)
  COUNT(DISTINCT gs.id)                                         AS games_played,
  COUNT(DISTINCT gs.id) FILTER (WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')) AS duels_played,
  -- pack plays
  (SELECT COUNT(*) FROM pack_results pr WHERE pr.user_id = p.id) AS packs_played,
  COALESCE(SUM(gs.correct_answers), 0)                         AS correct_total,
  COALESCE(SUM(gs.questions_count), 0)                         AS questions_total,
  CASE
    WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
    ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
  END                                                           AS accuracy_pct
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.daily_streak, p.best_daily_streak;

GRANT SELECT ON player_stats TO authenticated, anon;

-- ── Fix 3: name_color and title fields for shop items ─────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name_color  text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS name_title  text DEFAULT NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_frame text DEFAULT NULL;
