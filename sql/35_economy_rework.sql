-- ══════════════════════════════════════════════════════════════════
-- Migration 35: Economy rework — training pays by time, duels by win only
-- ══════════════════════════════════════════════════════════════════
-- BUG FIXED: award_currency('quiz_reward') previously fell through to
-- the ELSE 10 branch because 'quiz_reward' wasn't in the CASE list —
-- every logged-in player got a flat 10 neurons per training round
-- regardless of their actual timed-points score (guests got the real
-- amount via client-only preview, which never reached the database).
--
-- FIX: award_currency now accepts an optional p_client_amount, used
-- ONLY for operation types that are legitimately variable (quiz_reward,
-- tournament_reward). The server clamps it to a hard per-type ceiling
-- so a tampered client request can't mint unlimited neurons.
--
-- Everything else (duel_win, streaks, referral, onboarding, login)
-- stays 100% server-determined — client cannot influence the amount.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Award table — final sums ──────────────────────────────────
--
-- TRAINING (quiz_reward): client reports _roundScore (sum of timed
--   points, 1-90 per question based on speed × answer-count), server
--   clamps to MAX_QUESTIONS_PER_ROUND × 90.
-- DUEL: ONLY duel_win awards neurons. Per-question points during a
--   duel are purely an in-battle score for comparing winner — never
--   converted to currency. duel_loss/tie = 0.
-- TOURNAMENT: placement-based, NOT per-question (1st=150, 2nd=80, 3rd=50).
-- Everything else: fixed daily/streak/referral/onboarding amounts.
--
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_clamped int;
BEGIN
  RETURN QUERY
  SELECT
    CASE p_type
      -- Training: time-based score, server-clamped (max 25 questions × 90 pts)
      WHEN 'quiz_reward'          THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 2250)
      -- Duel: ONLY win pays. Per-question score never reaches currency.
      WHEN 'duel_win'             THEN 50
      WHEN 'duel_loss'            THEN  0
      WHEN 'duel_tie'             THEN  0
      -- Tournament: placement-based flat bonus (set by tournament-game.js)
      WHEN 'tournament_reward'    THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      -- Engagement loops — fully fixed, never client-influenced
      WHEN 'daily_login'          THEN 20
      WHEN 'referral_bonus'       THEN 100
      WHEN 'onboarding_complete'  THEN 50
      WHEN 'streak_7_days'        THEN 50
      WHEN 'streak_30_days'       THEN 200
      WHEN 'streak_100_days'      THEN 500
      ELSE 10
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_reward'          THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 2250)
      WHEN 'duel_win'             THEN 50
      WHEN 'duel_loss'            THEN  0
      WHEN 'duel_tie'             THEN  0
      WHEN 'tournament_reward'    THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      WHEN 'daily_login'          THEN 20
      WHEN 'referral_bonus'       THEN 20
      WHEN 'onboarding_complete'  THEN 10
      WHEN 'streak_7_days'        THEN 50
      WHEN 'streak_30_days'       THEN 200
      WHEN 'streak_100_days'      THEN 500
      ELSE 10
    END::int AS xp;
END;
$$;

-- ── 2. award_currency — now accepts a clamped client amount ──────
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_neurons  int;
  v_xp       int;
  v_profile  profiles%ROWTYPE;
  v_key      text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT neurons, xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount);

  IF v_neurons IS NULL THEN
    v_neurons := 10; v_xp := 10; -- safe fallback
  END IF;

  v_key := COALESCE(p_operation_key, p_operation_type || '_' || extract(epoch FROM date_trunc('day', now()))::text);

  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_user_id, p_operation_type, v_key, v_neurons, v_xp)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'already_processed', true,
      'neurons', v_profile.neurons, 'xp', v_profile.xp,
      'awarded_neurons', 0, 'awarded_xp', 0
    );
  END IF;

  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)      + v_xp,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true, 'already_processed', false,
    'neurons', v_neurons, 'xp', v_profile.xp,
    'awarded_neurons', v_neurons, 'awarded_xp', v_xp
  );
END;
$$;

REVOKE ALL ON FUNCTION award_currency(text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_currency(text, text, int) TO authenticated;

-- Drop the old 2-arg signature so old cached PostgREST schema doesn't
-- accidentally route calls to it (Supabase resolves by arg count)
DROP FUNCTION IF EXISTS award_currency(text, text);
