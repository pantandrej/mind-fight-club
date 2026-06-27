-- Run this if sql/09 was not applied yet, or to refresh the views

ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS correct_answers int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS questions_count int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS score          int DEFAULT 0;
ALTER TABLE game_sessions ADD COLUMN IF NOT EXISTS won            boolean DEFAULT NULL;

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

-- Grant read access
GRANT SELECT ON player_stats   TO authenticated, anon;
GRANT SELECT ON leaderboard_global TO authenticated, anon;
