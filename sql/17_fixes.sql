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

-- ── Fix 4: award_referrer() — credit referrer when invited user signs up ──
-- Runs as SECURITY DEFINER so it can update another user's row.
-- Caller must be the invited user (p_invited_id = auth.uid()) to prevent abuse.
CREATE OR REPLACE FUNCTION award_referrer(
  p_referrer_id uuid,
  p_invited_id  uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_key       text;
  v_neurons   int := 100;
  v_xp        int := 20;
BEGIN
  -- Only the invited user can trigger this award
  IF v_caller_id IS NULL OR v_caller_id != p_invited_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- Cannot refer yourself
  IF p_referrer_id = p_invited_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'self_referral');
  END IF;

  v_key := 'ref_gave:' || p_invited_id::text;

  -- Idempotent insert into ledger
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (p_referrer_id, 'referral_bonus', v_key, v_neurons, v_xp)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'already_processed', true);
  END IF;

  -- Credit the referrer
  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)      + v_xp,
      updated_at = now()
  WHERE id = p_referrer_id;

  RETURN jsonb_build_object('ok', true, 'already_processed', false, 'awarded_neurons', v_neurons);
END;
$$;

GRANT EXECUTE ON FUNCTION award_referrer(uuid, uuid) TO authenticated;
