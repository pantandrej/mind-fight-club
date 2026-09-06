-- Migration 71: Economy Security Cleanup
--
-- What this migration does:
--   1. Block daily_goal / daily_goal_bonus in award_currency (server_verification_unavailable).
--      elapsed time ≠ proof of play; disabled until session_questions is implemented.
--   2. Robust RLS cleanup for game_sessions: drop all write policies via pg_catalog scan.
--   3. Robust RLS cleanup for referrals: drop all write policies via pg_catalog scan.
--   4. Fix register_referral to also SET profiles.referred_by so the streak-5 trigger
--      (_check_referral_on_streak → award_referrer) can find the referrer.
--
-- Migrations 68, 69, 70 are already applied — NOT edited here.
-- Does NOT restore any client write policies.
-- Does NOT implement session_questions / submit_training_answer.

-- ── 1. award_currency: block daily_goal / daily_goal_bonus ───────────────────
--
-- Attack vector: start session → wait 60s → complete_training_session()
-- → award_currency('daily_goal'). elapsed ≥ 60s ≠ proof the user answered
-- questions. Block both types until session_questions is implemented.
--
-- Full function rewrite (preserving all migration-70 logic).
-- Signature unchanged: (text, text, int, boolean).

CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text    DEFAULT NULL,
  p_client_amount  int     DEFAULT NULL,
  p_is_hype_pack   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid    := auth.uid();
  v_neurons    int;
  v_xp         int;
  v_profile    profiles%ROWTYPE;
  v_key        text;
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_day_start  timestamptz := (v_today::text || ' 00:00:00+00')::timestamptz;
  v_day_end    timestamptz := (v_day_start + interval '1 day');
  v_count      int;
  v_is_premium boolean;

  -- Types blocked in public award_currency (use their own dedicated RPC)
  c_blocked_types text[] := ARRAY[
    'speed_answer',
    'duel_win', 'duel_loss', 'duel_tie',
    'tournament_reward',
    'onboarding_complete'
  ];
BEGIN
  -- ── 0. Auth ────────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- ── 1. Block daily_goal / daily_goal_bonus (migration 71) ─────────
  -- 60s elapsed ≠ proof of play. Disabled until session_questions +
  -- submit_training_answer are implemented.
  IF p_operation_type IN ('daily_goal', 'daily_goal_bonus') THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'reason', 'server_verification_unavailable'
    );
  END IF;

  -- ── 2. Award amount ────────────────────────────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  IF v_neurons IS NULL OR v_neurons < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation_type');
  END IF;

  -- ── 3. Blocked server-internal types ──────────────────────────────
  IF p_operation_type = ANY(c_blocked_types) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_dedicated_rpc',
      'hint', p_operation_type || ' must be claimed via its own server RPC');
  END IF;

  -- ── 4. Eligibility checks ──────────────────────────────────────────

  -- referral_bonus: needs a referrals row (created via register_referral RPC)
  IF p_operation_type = 'referral_bonus' THEN
    IF NOT EXISTS (
      SELECT 1 FROM referrals WHERE invited_user_id = v_user_id LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_referral',
        'hint', 'referral_bonus requires a verified referral record');
    END IF;
  END IF;

  -- streak milestones: check actual streak
  IF p_operation_type = 'streak_7_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 7) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 7);
    END IF;
  END IF;

  IF p_operation_type = 'streak_30_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 30) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 30);
    END IF;
  END IF;

  IF p_operation_type = 'streak_100_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 100) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 100);
    END IF;
  END IF;

  -- ── 5. Premium check for pack_reward ──────────────────────────────
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── 6. Advisory lock for daily COUNT-cap operations ───────────────
  IF p_operation_type IN ('quiz_reward', 'pack_reward') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':daily_cap:' || p_operation_type)
    );
  END IF;

  -- ── 7. Daily limits ────────────────────────────────────────────────

  IF p_operation_type = 'quiz_reward' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id        = v_user_id
      AND operation_type = 'quiz_reward'
      AND created_at >= v_day_start AND created_at < v_day_end;
    IF v_count >= 3 THEN
      SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0);
    END IF;
  END IF;

  IF p_operation_type = 'pack_reward' THEN
    IF p_is_hype_pack THEN
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id        = v_user_id
        AND operation_type = 'pack_reward'
        AND operation_key  LIKE 'hype_%'
        AND created_at >= v_day_start AND created_at < v_day_end;
      IF v_count >= 1 THEN
        SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    ELSE
      IF NOT v_is_premium THEN
        SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', false, 'reason', 'premium_required',
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id        = v_user_id
        AND operation_type = 'pack_reward'
        AND operation_key  NOT LIKE 'hype_%'
        AND created_at >= v_day_start AND created_at < v_day_end;
      IF v_count >= 3 THEN
        SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    END IF;
  END IF;

  -- ── 8. Forced server-side idempotency keys ─────────────────────────
  IF p_operation_type = 'referral_bonus' THEN
    v_key := 'referral_bonus_received_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_7_days' THEN
    v_key := 'streak_7_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_30_days' THEN
    v_key := 'streak_30_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_100_days' THEN
    v_key := 'streak_100_days_' || v_user_id::text;
  ELSIF p_operation_type IN ('daily_login', 'daily_question', 'streak_reward') THEN
    v_key := p_operation_type || '_' || v_user_id::text || '_' || v_today::text;
  ELSE
    v_key := COALESCE(
      p_operation_key,
      p_operation_type || '_' || v_user_id::text || '_' || v_today::text
    );
  END IF;

  -- ── 9. Ledger insert (UNIQUE = idempotency) ────────────────────────
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

  -- ── 10. Credit ─────────────────────────────────────────────────────
  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)     + v_xp,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true, 'already_processed', false,
    'neurons', v_profile.neurons, 'xp', v_profile.xp,
    'awarded_neurons', v_neurons, 'awarded_xp', v_xp
  );
END;
$$;

REVOKE ALL ON FUNCTION award_currency(text, text, int, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_currency(text, text, int, boolean) TO authenticated;

-- 3-parameter compatibility shim (unchanged from migration 70)
DROP FUNCTION IF EXISTS award_currency(text, text, int);
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT award_currency(p_operation_type, p_operation_key, p_client_amount, false);
$$;
GRANT EXECUTE ON FUNCTION award_currency(text, text, int) TO authenticated;


-- ── 2. game_sessions: robust RLS cleanup via pg_catalog ──────────────────────
--
-- Migration 70 dropped 3 named policies. Any remaining write policies (differently
-- named, or added since) are found and dropped here by catalog scan.
-- After this block: authenticated users can only SELECT their own rows.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM   pg_policies
    WHERE  tablename  = 'game_sessions'
      AND  schemaname = 'public'
      AND  cmd        != 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.game_sessions', r.policyname);
  END LOOP;
END;
$$;

-- Re-assert the SELECT policy (idempotent with migration 70)
DROP POLICY IF EXISTS "game_sessions_own" ON public.game_sessions;
CREATE POLICY "game_sessions_own" ON public.game_sessions
  FOR SELECT
  USING (user_id = auth.uid());

ALTER TABLE public.game_sessions ENABLE ROW LEVEL SECURITY;


-- ── 3. referrals: robust RLS cleanup via pg_catalog ──────────────────────────
--
-- Clients must never INSERT/UPDATE/DELETE referrals directly.
-- register_referral() is SECURITY DEFINER and handles all writes server-side.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT policyname
    FROM   pg_policies
    WHERE  tablename  = 'referrals'
      AND  schemaname = 'public'
      AND  cmd        != 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.referrals', r.policyname);
  END LOOP;
END;
$$;

-- Re-assert the SELECT-only policy (idempotent with migration 70)
DROP POLICY IF EXISTS "referrals_own_read" ON public.referrals;
CREATE POLICY "referrals_own_read" ON public.referrals
  FOR SELECT
  USING (
    referrer_id        = auth.uid()
    OR invited_user_id = auth.uid()
  );

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;


-- ── 4. register_referral: also SET profiles.referred_by ─────────────────────
--
-- Migration 70's register_referral() inserts the referrals row but does NOT
-- set profiles.referred_by. The _check_referral_on_streak trigger reads
-- profiles.referred_by to find the referrer at streak = 5.
-- Without this fix award_referrer() returns 'no_referrer' and the referrer
-- never receives their bonus.
--
-- guard_critical_profile_fields() (migration 70) blocks client UPDATE of
-- referred_by but allows SECURITY DEFINER writes (current_user = 'postgres').

CREATE OR REPLACE FUNCTION register_referral(p_ref_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_id     uuid := auth.uid();
  v_referrer_id uuid;
BEGIN
  IF v_self_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Resolve referrer by code (server-side; client cannot forge)
  SELECT id INTO v_referrer_id
  FROM   profiles
  WHERE  referral_code = UPPER(TRIM(p_ref_code))
    AND  id != v_self_id;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ref_code');
  END IF;

  -- Idempotent: already referred
  IF EXISTS (SELECT 1 FROM referrals WHERE invited_user_id = v_self_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  -- Insert referral row (SECURITY DEFINER bypasses referrals RLS)
  INSERT INTO referrals (
    referrer_id, invited_user_id, ref_code,
    status, reward_referrer, reward_invited,
    signed_up_at, created_at
  )
  VALUES (
    v_referrer_id, v_self_id, UPPER(TRIM(p_ref_code)),
    'signed_up', 100, 100,
    now(), now()
  )
  ON CONFLICT DO NOTHING;

  -- Set profiles.referred_by so the streak-5 trigger can find the referrer.
  -- guard_critical_profile_fields() allows this: current_user = 'postgres'
  -- (SECURITY DEFINER runs as the function owner, not as 'authenticated').
  UPDATE profiles
  SET    referred_by = v_referrer_id
  WHERE  id          = v_self_id
    AND  referred_by IS NULL;

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer_id);
END;
$$;

REVOKE ALL  ON FUNCTION register_referral(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION register_referral(text) TO authenticated;
