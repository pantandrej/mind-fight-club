-- ============================================================
-- BFC: Streak freeze — buy and apply
-- ============================================================

-- Add freeze columns to profiles if missing
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS daily_streak      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS streak_last_date  date,
  ADD COLUMN IF NOT EXISTS streak_freezes    int NOT NULL DEFAULT 0;

-- ── buy_streak_freeze() ───────────────────────────────────────────────
-- Price: 200 neurons (STREAK_FREEZE_PRICE in config.js)
CREATE OR REPLACE FUNCTION buy_streak_freeze()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_price   int  := 200;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  IF COALESCE(v_profile.neurons, 0) < v_price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
      'balance', COALESCE(v_profile.neurons, 0), 'price', v_price);
  END IF;

  UPDATE profiles
  SET neurons        = neurons - v_price,
      streak_freezes = COALESCE(streak_freezes, 0) + 1,
      updated_at     = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true,
    'neurons',        v_profile.neurons,
    'xp',             v_profile.xp,
    'streak_freezes', v_profile.streak_freezes
  );
END;
$$;

REVOKE ALL ON FUNCTION buy_streak_freeze() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION buy_streak_freeze() TO authenticated;


-- ── record_daily_activity() ──────────────────────────────────────────
-- Called once per day when user completes any activity.
-- Handles streak increment, break detection, and auto-freeze application.
CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile   profiles%ROWTYPE;
  v_today     date := current_date;
  v_yesterday date := current_date - 1;
  v_gap       int;
  v_freeze_used boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- Already recorded today → idempotent
  IF v_profile.streak_last_date = v_today THEN
    RETURN jsonb_build_object(
      'ok', true, 'streak', v_profile.daily_streak,
      'already_recorded', true, 'freeze_used', false
    );
  END IF;

  v_gap := COALESCE(v_today - v_profile.streak_last_date, 999);

  IF v_gap = 1 THEN
    -- Consecutive day → extend streak
    UPDATE profiles
    SET daily_streak     = COALESCE(daily_streak, 0) + 1,
        streak_last_date = v_today,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;

  ELSIF v_gap = 2 AND COALESCE(v_profile.streak_freezes, 0) > 0 THEN
    -- Missed exactly 1 day AND has a freeze → auto-apply freeze
    UPDATE profiles
    SET daily_streak     = COALESCE(daily_streak, 0) + 1,
        streak_last_date = v_today,
        streak_freezes   = streak_freezes - 1,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
    v_freeze_used := true;

  ELSE
    -- Streak broken → reset
    UPDATE profiles
    SET daily_streak     = 1,
        streak_last_date = v_today,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'streak',       v_profile.daily_streak,
    'freezes_left', v_profile.streak_freezes,
    'freeze_used',  v_freeze_used
  );
END;
$$;

REVOKE ALL ON FUNCTION record_daily_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_daily_activity() TO authenticated;
