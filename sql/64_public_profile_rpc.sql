-- ══════════════════════════════════════════════════════════════════
-- Migration 64: Public profile RPC (bypasses RLS for read-only data)
-- ══════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so RLS on profiles does not block reading other users
CREATE OR REPLACE FUNCTION get_public_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT
    p.id,
    p.display_name,
    p.city,
    p.neurons,
    p.xp,
    p.avatar_url,
    COALESCE(p.daily_streak, 0)       AS streak,
    COALESCE(p.best_daily_streak, 0)  AS best_streak,
    COUNT(DISTINCT gs.id)             AS games_played,
    COUNT(DISTINCT gs.id) FILTER (WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')) AS duels_played,
    COALESCE(SUM(gs.correct_answers), 0) AS correct_total,
    COALESCE(SUM(gs.questions_count), 0) AS questions_total,
    CASE
      WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
      ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
    END AS accuracy_pct
  INTO v_row
  FROM profiles p
  LEFT JOIN game_sessions gs ON gs.user_id = p.id
  WHERE p.id = p_user_id
  GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.avatar_url, p.daily_streak, p.best_daily_streak;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'user_id',      v_row.id,
    'display_name', v_row.display_name,
    'city',         v_row.city,
    'neurons',      v_row.neurons,
    'xp',           v_row.xp,
    'avatar_url',   v_row.avatar_url,
    'streak',       v_row.streak,
    'best_streak',  v_row.best_streak,
    'games_played', v_row.games_played,
    'duels_played', v_row.duels_played,
    'correct_total',v_row.correct_total,
    'accuracy_pct', v_row.accuracy_pct
  );
END;
$$;

REVOKE ALL ON FUNCTION get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_public_profile(uuid) TO authenticated, anon;
