-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 95: Guest Friend Duel — Anonymous Auth Server-Side Guards
-- Applied: NO
-- ══════════════════════════════════════════════════════════════════════════════
-- Context:
--   M94 + client changes (auth.js) implement Guest Friend Duel via Supabase
--   Anonymous Auth (signInAnonymously). Anonymous users receive the
--   `authenticated` PostgreSQL role, so all RPCs granted to `authenticated`
--   are callable by them — including economy and progression RPCs that
--   guests must not access.
--
--   Client-side `currentUser.is_anonymous` checks alone are insufficient;
--   a guest can call the API directly or via dev tools.
--
-- This migration adds server-authoritative guards to entry-point RPCs that
-- violate the guest product contract if called by an anonymous user:
--
--   1. create_duel()                       — guests cannot be hosts
--   2. award_currency(text,text,int,bool)  — guests cannot earn neurons/XP
--   3. start_daily_bf_session()            — guests cannot play Brain Fights
--   4. record_daily_activity(uuid)         — guests cannot earn streak rewards
--   5. _bf_award_duel_win(uuid,text,date)  — anonymous winner gets 0 BF
--   6. claim_random_match()                — anonymous cannot join Random Battle
--   7. cancel_random_matchmaking()            — anonymous cannot cancel
--   8. start_game_session(text,uuid,uuid)     — guests cannot start any game mode
--   9. matchmaking_queue RLS + privileges     — anon locked out; authenticated INSERT/SELECT only
--
-- RPCs intentionally left open for anonymous users (product contract):
--   join_duel_by_code, get_duel, submit_duel_answer,
--   get_duel_result, forfeit_duel
--
-- No manual dashboard steps remain — all blockers resolved.
--
-- Guard pattern used in caller-context functions (auth.jwt() available):
--   IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
--     RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
--   END IF;
--
-- Guard for _bf_award_duel_win (called from trigger, not user context):
--   Checks winner_id against auth.users.is_anonymous column (confirmed live).
--   auth.users.is_anonymous boolean NOT NULL — set by Supabase anonymous auth.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;


-- ── Helper ────────────────────────────────────────────────────────────────────
-- Returns true when the current JWT belongs to a Supabase anonymous auth user.
-- STABLE + SECURITY DEFINER so it can be called from other SECURITY DEFINER fns.
CREATE OR REPLACE FUNCTION public._is_anon_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;
REVOKE ALL ON FUNCTION public._is_anon_user() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public._is_anon_user() TO authenticated;


-- ── 1. create_duel() — guests cannot be hosts ─────────────────────────────────
-- Reproduces M78 body verbatim; adds anon guard after uid check.
CREATE OR REPLACE FUNCTION public.create_duel()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    uuid := auth.uid();
  _code   text;
  _exists boolean;
  _tries  int := 0;
  _name   text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- Anonymous users (guest duel joiners) may not create rooms as host.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'anonymous_not_allowed');
  END IF;

  -- Fetch display name from profiles (fallback to email prefix)
  SELECT COALESCE(display_name, split_part(email, '@', 1), 'Host')
    INTO _name
    FROM profiles WHERE id = _uid;
  IF _name IS NULL THEN _name := 'Host'; END IF;

  -- Generate unique 6-char alphanumeric code (server-side, sufficient entropy)
  LOOP
    _code := upper(substring(md5(gen_random_uuid()::text) from 1 for 6));
    SELECT EXISTS(SELECT 1 FROM duel_rooms WHERE code = _code AND created_at > now() - interval '1 day')
      INTO _exists;
    EXIT WHEN NOT _exists;
    _tries := _tries + 1;
    IF _tries > 20 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'code_gen_failed');
    END IF;
  END LOOP;

  INSERT INTO duel_rooms (
    code, status, host_user_id, host_name,
    host_score, guest_score, host_done, guest_done,
    created_at
  ) VALUES (
    _code, 'waiting', _uid, _name,
    0, 0, false, false,
    now()
  );

  RETURN jsonb_build_object('ok', true, 'code', _code, 'host_name', _name);
END;
$$;
REVOKE ALL ON FUNCTION public.create_duel() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_duel() TO authenticated;


-- ── 2. award_currency(4-param) — guests cannot earn neurons or XP ─────────────
-- Reproduces M70 body verbatim; adds anon guard after uid check.
-- The 3-param wrapper (M70 line 398) calls this 4-param version; guarding here
-- is sufficient because auth.jwt() context is preserved across SECURITY DEFINER
-- call chains within the same DB session.
CREATE OR REPLACE FUNCTION public.award_currency(
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

  c_blocked_types text[] := ARRAY[
    'speed_answer',
    'duel_win', 'duel_loss', 'duel_tie',
    'tournament_reward',
    'onboarding_complete'
  ];
BEGIN
  -- ── 0. Auth ────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Anonymous users must not earn neurons or XP.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  -- ── 1. Размер награды ──────────────────────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  IF v_neurons IS NULL OR v_neurons < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation_type');
  END IF;

  -- ── 2. Server-internal типы заблокированы ─────────────────────
  IF p_operation_type = ANY(c_blocked_types) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_dedicated_rpc',
      'hint', p_operation_type || ' must be claimed via its own server RPC');
  END IF;

  -- ── 3. Eligibility checks ──────────────────────────────────────
  IF p_operation_type = 'referral_bonus' THEN
    IF NOT EXISTS (
      SELECT 1 FROM referrals WHERE invited_user_id = v_user_id LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_referral',
        'hint', 'referral_bonus requires a verified referral record');
    END IF;
  END IF;

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

  IF p_operation_type IN ('daily_goal', 'daily_goal_bonus') THEN
    IF NOT EXISTS (
      SELECT 1 FROM game_sessions
      WHERE user_id     = v_user_id
        AND mode        = 'training'
        AND started_at >= v_day_start
        AND started_at <  v_day_end
        AND completed_at IS NOT NULL
      LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'daily_goal_not_earned',
        'hint', 'complete a training session (Quick Play) first');
    END IF;
  END IF;

  -- ── 4. Премиум-проверка для pack_reward ───────────────────────
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── 5. Advisory lock для daily COUNT cap операций ─────────────
  IF p_operation_type IN ('quiz_reward', 'pack_reward') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':daily_cap:' || p_operation_type)
    );
  END IF;

  -- ── 6. Дневные лимиты ─────────────────────────────────────────
  IF p_operation_type = 'quiz_reward' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id        = v_user_id
      AND operation_type = 'quiz_reward'
      AND created_at >= v_day_start AND created_at < v_day_end;
    IF v_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
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
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    ELSE
      IF NOT v_is_premium THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
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
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    END IF;
  END IF;

  -- ── 7. Принудительные серверные ключи ─────────────────────────
  IF p_operation_type = 'referral_bonus' THEN
    v_key := 'referral_bonus_received_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_7_days' THEN
    v_key := 'streak_7_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_30_days' THEN
    v_key := 'streak_30_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_100_days' THEN
    v_key := 'streak_100_days_' || v_user_id::text;
  ELSIF p_operation_type IN ('daily_login', 'daily_goal', 'daily_goal_bonus',
                              'daily_question', 'streak_reward') THEN
    v_key := p_operation_type || '_' || v_user_id::text || '_' || v_today::text;
  ELSE
    v_key := COALESCE(
      p_operation_key,
      p_operation_type || '_' || v_user_id::text || '_' || v_today::text
    );
  END IF;

  -- ── 8. Ledger insert (UNIQUE = idempotency) ────────────────────
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

  -- ── 9. Начисление ─────────────────────────────────────────────
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
REVOKE ALL ON FUNCTION public.award_currency(text, text, int, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.award_currency(text, text, int, boolean) TO authenticated;


-- ── 3. start_daily_bf_session() — guests cannot play Brain Fights ──────────────
-- Reproduces M91 body verbatim (timezone-aware, current_period_end semantics).
-- Adds anon guard immediately after uid null check, before timezone resolution.
-- WARNING: This is the M91 body — NOT the M87 body (UTC-only).
-- The M91 contract: v_today derived from profiles.timezone, validated against
-- pg_timezone_names, with UTC fallback. Advisory lock key includes v_today.
CREATE OR REPLACE FUNCTION public.start_daily_bf_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_tz            text := 'UTC';
  v_today         date;
  v_plan          text := 'free';
  v_train_limit   int;
  v_train_used    int;
  v_session_id    uuid;
  v_bf_eligible   boolean := true;
  v_progression   int[]  := ARRAY[2,2,3,3,4,4,5,5,6,6];
  v_opt_count     int;
  v_used_ids      uuid[] := ARRAY[]::uuid[];
  v_q_id          uuid;
  v_q_text        text;
  v_answers       jsonb;
  v_category      text;
  v_sq_id         uuid;
  v_pos           int := 0;
  v_questions     jsonb := '[]'::jsonb;
  _i              int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Anonymous users must not access Brain Fights.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  -- M91: defensive timezone resolution — invalid stored tz falls back to UTC
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM profiles WHERE id = v_uid;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_uid::text || ':' || v_today::text || ':training')
  );

  SELECT COALESCE(
    (SELECT plan FROM subscriptions
     WHERE user_id = v_uid
       AND (current_period_end IS NULL OR current_period_end > now())
     ORDER BY current_period_end DESC NULLS FIRST LIMIT 1),
    'free'
  ) INTO v_plan;

  v_train_limit := CASE v_plan WHEN 'premium' THEN 5 ELSE 1 END;

  SELECT COUNT(*) INTO v_train_used
  FROM game_sessions
  WHERE user_id = v_uid AND day_utc = v_today AND mode = 'training';

  IF v_train_used >= v_train_limit THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'reason', 'training_limit_reached',
      'used',   v_train_used,
      'limit',  v_train_limit,
      'plan',   v_plan
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM game_sessions
    WHERE user_id     = v_uid
      AND day_utc     = v_today
      AND mode        = 'training'
      AND bf_eligible = true
  ) THEN
    v_bf_eligible := false;
  END IF;

  IF v_bf_eligible AND EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE scoring_user_id = v_uid
      AND source_type     = 'training'
      AND activity_date   = v_today
  ) THEN
    v_bf_eligible := false;
  END IF;

  FOREACH v_opt_count IN ARRAY v_progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text)                  AS q_text,
      COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)        AS answers,
      COALESCE(q.category, 'GENERAL')                           AS category
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status               = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))
      AND jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = v_opt_count
      AND NOT (q.id = ANY(v_used_ids))
      AND q.id NOT IN (
        SELECT waq.question_id FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random() LIMIT 1;

    IF NOT FOUND OR v_q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'reason',          'not_enough_questions',
        'needed_opt_count', v_opt_count
      );
    END IF;

    v_used_ids := v_used_ids || ARRAY[v_q_id];
    v_pos      := v_pos + 1;

    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'sq_id', null::uuid,
      'pos',   v_pos,
      'q',     v_q_text,
      'a',     v_answers,
      'cat',   v_category,
      't',     20 + v_opt_count * 5
    ));
  END LOOP;

  INSERT INTO game_sessions (user_id, mode, day_utc, bf_eligible)
  VALUES (v_uid, 'training', v_today, v_bf_eligible)
  RETURNING id INTO v_session_id;

  v_questions := '[]'::jsonb;
  FOR _i IN 0..(array_length(v_progression, 1) - 1)
  LOOP
    v_opt_count := v_progression[_i + 1];
    v_q_id      := v_used_ids[_i + 1];

    SELECT
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb),
      COALESCE(q.category, 'GENERAL')
    INTO v_q_text, v_answers, v_category
    FROM questions q WHERE q.id = v_q_id;

    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (v_session_id, v_q_id, _i + 1)
    RETURNING id INTO v_sq_id;

    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'sq_id', v_sq_id,
      'pos',   _i + 1,
      'q',     v_q_text,
      'a',     v_answers,
      'cat',   v_category,
      't',     20 + v_opt_count * 5
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'bf_eligible', v_bf_eligible,
    'session_id',  v_session_id,
    'questions',   v_questions,
    'plan',        v_plan,
    'remaining',   v_train_limit - v_train_used - 1
  );
END;
$$;
REVOKE ALL ON FUNCTION public.start_daily_bf_session() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_daily_bf_session() TO authenticated;


-- ── 4. record_daily_activity(uuid) — guests cannot earn streak rewards ─────────
-- Reproduces M91 body verbatim; adds anon guard after uid check.
CREATE OR REPLACE FUNCTION public.record_daily_activity(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id      uuid := auth.uid();
  v_session      game_sessions%ROWTYPE;
  v_assigned_cnt int;
  v_resolved_cnt int;
  v_profile      profiles%ROWTYPE;
  v_tz           text;
  v_today        date;
  v_gap          int;
  v_freeze_used  boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Anonymous users must not earn streak rewards.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  SELECT * INTO v_session
  FROM game_sessions
  WHERE id = p_session_id AND user_id = v_user_id AND mode = 'training';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_correct IS NOT NULL)
  INTO v_assigned_cnt, v_resolved_cnt
  FROM session_questions
  WHERE session_id = p_session_id;

  IF v_assigned_cnt <> 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_incomplete',
      'assigned_count', v_assigned_cnt, 'resolved_count', v_resolved_cnt);
  END IF;
  IF v_resolved_cnt <> 10 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_fully_answered',
      'assigned_count', v_assigned_cnt, 'resolved_count', v_resolved_cnt);
  END IF;

  v_today := v_session.day_utc;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.streak_last_date IS NOT NULL
     AND v_today < v_profile.streak_last_date
  THEN
    RETURN jsonb_build_object(
      'ok',               false,
      'reason',           'stale_session',
      'streak',           v_profile.daily_streak,
      'best_streak',      COALESCE(v_profile.best_daily_streak, v_profile.daily_streak),
      'streak_last_date', v_profile.streak_last_date
    );
  END IF;

  IF v_profile.streak_last_date = v_today THEN
    RETURN jsonb_build_object(
      'ok',               true,
      'streak',           v_profile.daily_streak,
      'best_streak',      COALESCE(v_profile.best_daily_streak, v_profile.daily_streak),
      'streak_last_date', v_today,
      'already_recorded', true,
      'freeze_used',      false
    );
  END IF;

  v_gap := COALESCE(v_today - v_profile.streak_last_date, 999);

  IF v_gap = 1 THEN
    UPDATE profiles
    SET daily_streak      = COALESCE(daily_streak, 0) + 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), COALESCE(daily_streak, 0) + 1),
        streak_last_date  = v_today,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;

  ELSIF v_gap = 2 AND COALESCE(v_profile.streak_freezes, 0) > 0 THEN
    UPDATE profiles
    SET daily_streak      = COALESCE(daily_streak, 0) + 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), COALESCE(daily_streak, 0) + 1),
        streak_last_date  = v_today,
        streak_freezes    = streak_freezes - 1,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
    v_freeze_used := true;

  ELSE
    UPDATE profiles
    SET daily_streak      = 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), 1),
        streak_last_date  = v_today,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  END IF;

  DECLARE
    v_milestone_type text := NULL;
    v_milestone_key  text;
  BEGIN
    IF v_profile.daily_streak = 7   THEN v_milestone_type := 'streak_7_days';   END IF;
    IF v_profile.daily_streak = 30  THEN v_milestone_type := 'streak_30_days';  END IF;
    IF v_profile.daily_streak = 100 THEN v_milestone_type := 'streak_100_days'; END IF;

    IF v_milestone_type IS NOT NULL THEN
      v_milestone_key := v_milestone_type || ':' || v_user_id::text;
      PERFORM award_currency(v_milestone_type, v_milestone_key);
    END IF;
  END;

  RETURN jsonb_build_object(
    'ok',               true,
    'streak',           v_profile.daily_streak,
    'best_streak',      v_profile.best_daily_streak,
    'streak_last_date', v_today,
    'freezes_left',     v_profile.streak_freezes,
    'freeze_used',      v_freeze_used,
    'milestone',        CASE
                          WHEN v_profile.daily_streak IN (7,30,100)
                          THEN v_profile.daily_streak
                          ELSE NULL
                        END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.record_daily_activity(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.record_daily_activity(uuid) TO authenticated;


-- ── 5. _bf_award_duel_win(uuid, text, date) — anonymous winner gets 0 BF ───────
-- Reproduces M82 body verbatim; adds winner anonymity check via auth.users.
-- CRITICAL: Uses auth.users.is_anonymous column (set by Supabase anonymous auth).
-- This function is called from a trigger (_trg_duel_finished_bf), so auth.jwt()
-- reflects the finalizing player — NOT the winner. Must check winner_id against
-- auth.users directly. auth.users.is_anonymous = true means the account was
-- created via signInAnonymously() and has never been converted to a full account.
CREATE OR REPLACE FUNCTION public._bf_award_duel_win(
  p_winner_id uuid,
  p_duel_code text,
  p_today     date
) RETURNS int   -- bf_pts awarded (3 or 0)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);
  v_team_id    uuid;
  v_source_id  uuid;
  v_wins_today int;
  v_rows       int;
BEGIN
  -- No winner (tie) → 0 BF, nothing to do.
  IF p_winner_id IS NULL THEN RETURN 0; END IF;

  -- Anonymous winner never earns BF — check winner's auth record, not caller JWT.
  -- auth.users.is_anonymous is set by Supabase when the account was created via
  -- signInAnonymously() and has not been linked to a permanent identity.
  IF EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_winner_id AND is_anonymous = true
  ) THEN
    RETURN 0;
  END IF;

  -- Serialize: one BF duel award at a time per winner per UTC day.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_winner_id::text || '::bf_duel_wins::' || p_today::text)
  );

  -- Stable source_id for this specific win (duel code + winner).
  v_source_id := md5(p_duel_code || '::duel_win::' || p_winner_id::text)::uuid;

  -- Already awarded for this exact duel+winner? Idempotent guard.
  IF EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE scoring_user_id = p_winner_id
      AND source_type     = 'duel'
      AND source_id       = v_source_id
  ) THEN
    RETURN 0;
  END IF;

  -- Count today's verified duel wins (under lock — race-safe).
  SELECT COUNT(*) INTO v_wins_today
  FROM brain_fight_contributions
  WHERE scoring_user_id = p_winner_id
    AND source_type     = 'duel'
    AND activity_date   = p_today;

  IF v_wins_today >= 3 THEN
    RETURN 0;  -- daily cap reached
  END IF;

  -- Team attribution at event time (not at query time).
  SELECT t.id INTO v_team_id
  FROM profiles pr
  LEFT JOIN teams t ON t.id = pr.team_id AND t.disbanded_at IS NULL
  WHERE pr.id = p_winner_id;

  INSERT INTO brain_fight_contributions (
    scoring_user_id, user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    p_winner_id, p_winner_id, v_team_id, v_week_start,
    'duel', v_source_id, p_today, 3, now()
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN CASE WHEN v_rows > 0 THEN 3 ELSE 0 END;
END;
$$;

REVOKE ALL ON FUNCTION public._bf_award_duel_win(uuid, text, date)
  FROM PUBLIC, anon, authenticated;


-- ── 6. claim_random_match() — anonymous cannot initiate Random Battle ──────────
-- Reproduces M82 body verbatim; adds anon guard after uid check.
CREATE OR REPLACE FUNCTION public.claim_random_match()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_my_row       matchmaking_queue%ROWTYPE;
  v_opp_row      matchmaking_queue%ROWTYPE;
  v_duel         duel_rooms%ROWTYPE;
  v_duel_code    text;
  v_my_name      text;
  v_role         text;
  v_opp_name     text;
  v_attempt      int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Anonymous users cannot participate in Random Battle.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  -- Serialize all pairing operations under a single advisory lock.
  PERFORM pg_advisory_xact_lock(hashtext('bfc_random_matchmaking'));

  -- Re-read caller's LATEST active queue row under lock (DESC = newest wins).
  -- Include 'matched': guest's row is already 'matched' after host paired them;
  -- returning the existing duel avoids guest staying stuck until 15s timeout.
  -- DESC ensures a new 'waiting' row beats any old 'matched' row from a prior battle.
  SELECT * INTO v_my_row
  FROM matchmaking_queue
  WHERE user_id = v_uid
    AND status IN ('waiting', 'matched')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No active queue row — cancelled or never queued
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_queue');
  END IF;

  -- If caller is already matched, return canonical duel state immediately.
  -- Role is derived server-side from duel_rooms — never inferred by client.
  IF v_my_row.status = 'matched' THEN
    SELECT * INTO v_duel
    FROM duel_rooms
    WHERE code = v_my_row.matched_duel_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duel_not_found');
    END IF;

    IF v_duel.host_user_id = v_uid THEN
      v_role     := 'host';
      v_opp_name := v_duel.guest_name;
    ELSE
      v_role     := 'guest';
      v_opp_name := v_duel.host_name;
    END IF;

    RETURN jsonb_build_object(
      'ok',            true,
      'matched',       true,
      'role',          v_role,
      'duel_code',     v_duel.code,
      'opponent_name', v_opp_name
    );
  END IF;

  -- status='waiting': attempt normal atomic pairing
  v_my_name := v_my_row.display_name;

  SELECT * INTO v_opp_row
  FROM matchmaking_queue
  WHERE status  = 'waiting'
    AND user_id <> v_uid
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No opponent yet — caller stays waiting
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  -- Generate duel code, retry on collision
  LOOP
    v_duel_code := upper(substring(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_attempt   := v_attempt + 1;
    BEGIN
      INSERT INTO duel_rooms (
        code, host_user_id, guest_user_id,
        host_name, guest_name,
        host_score, guest_score,
        status, created_at
      ) VALUES (
        v_duel_code, v_uid, v_opp_row.user_id,
        v_my_name, v_opp_row.display_name,
        0, 0,
        'ready', now()
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'code_collision_exhausted');
      END IF;
    END;
  END LOOP;

  UPDATE matchmaking_queue
  SET status = 'matched', matched_duel_id = v_duel_code
  WHERE id IN (v_my_row.id, v_opp_row.id);

  -- Caller is host (created the duel); opponent will receive role='guest' on its next tick
  RETURN jsonb_build_object(
    'ok',            true,
    'matched',       true,
    'role',          'host',
    'duel_code',     v_duel_code,
    'opponent_name', v_opp_row.display_name
  );
END;
$$;
REVOKE ALL ON FUNCTION public.claim_random_match() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_random_match() TO authenticated;


-- ── 7. cancel_random_matchmaking() — anonymous cannot cancel (defensive) ───────
-- Reproduces M82 body verbatim; adds anon guard after uid check.
-- Anonymous users should never be in the queue, but guard defensively.
CREATE OR REPLACE FUNCTION public.cancel_random_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_row      matchmaking_queue%ROWTYPE;
  v_duel     duel_rooms%ROWTYPE;
  v_role     text;
  v_opp_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Anonymous users cannot participate in Random Battle.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  -- Same advisory lock as claim_random_match — prevents cancel racing a match
  PERFORM pg_advisory_xact_lock(hashtext('bfc_random_matchmaking'));

  -- Find any active queue row for this caller
  SELECT * INTO v_row
  FROM matchmaking_queue
  WHERE user_id = v_uid
    AND status IN ('waiting', 'matched')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'cancelled', false, 'matched', false);
  END IF;

  IF v_row.status = 'matched' THEN
    -- Server already matched this player — do NOT cancel.
    -- Resolve role and opponent_name from canonical duel_rooms row.
    SELECT * INTO v_duel
    FROM duel_rooms
    WHERE code = v_row.matched_duel_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duel_not_found');
    END IF;

    IF v_duel.host_user_id = v_uid THEN
      v_role     := 'host';
      v_opp_name := v_duel.guest_name;
    ELSE
      v_role     := 'guest';
      v_opp_name := v_duel.host_name;
    END IF;

    RETURN jsonb_build_object(
      'ok',            true,
      'cancelled',     false,
      'matched',       true,
      'role',          v_role,
      'duel_code',     v_duel.code,
      'opponent_name', v_opp_name
    );
  END IF;

  -- status='waiting' — safe to cancel
  UPDATE matchmaking_queue
  SET status = 'cancelled'
  WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'matched', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_random_matchmaking() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_random_matchmaking() TO authenticated;


-- ── 8. start_game_session(text, uuid, uuid) — guests cannot start any game mode ─
-- Live body reproduced verbatim from Supabase (preflight 2026-09-16).
-- Exact live signature: start_game_session(p_mode text, p_opponent_id uuid, p_invite_id uuid)
-- Anon guard inserted immediately after uid null check, before mode validation.
-- All other logic (limits, social bonus, advisory locks, return shape) unchanged.
CREATE OR REPLACE FUNCTION public.start_game_session(
  p_mode        text,
  p_opponent_id uuid DEFAULT NULL::uuid,
  p_invite_id   uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          UUID    := auth.uid();
  v_day              DATE    := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_plan             TEXT    := 'free';

  v_is_battle        BOOLEAN := p_mode IN ('friend_battle','random_battle','virtual_battle');
  v_is_training      BOOLEAN := p_mode = 'training';

  v_training_limit   INTEGER;
  v_battle_limit     INTEGER;

  v_training_used    INTEGER := 0;
  v_battles_used     INTEGER := 0;
  v_social_used      INTEGER := 0;

  v_is_social_bonus  BOOLEAN := false;
  v_session_id       UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Anonymous users (guest duel participants) must not create any game session.
  -- Guest Friend Duel uses the canonical duel RPCs — not this generic session starter.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'anonymous_not_allowed'
    );
  END IF;

  IF p_mode NOT IN ('training','friend_battle','random_battle','virtual_battle') THEN
    RAISE EXCEPTION 'Invalid mode: %', p_mode;
  END IF;

  IF v_is_training THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_day::TEXT || ':training')
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_day::TEXT || ':battle')
    );
  END IF;

  SELECT get_user_plan(v_user_id) INTO v_plan;

  IF v_plan = 'premium' THEN
    v_training_limit := 5;
    v_battle_limit   := 10;
  ELSE
    v_training_limit := 1;
    v_battle_limit   := 3;
  END IF;

  IF v_is_training THEN
    SELECT COUNT(*) INTO v_training_used
    FROM game_sessions
    WHERE user_id = v_user_id
      AND day_utc = v_day
      AND mode = 'training';

    IF v_training_used >= v_training_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason',  'training_limit_reached',
        'used',    v_training_used,
        'limit',   v_training_limit,
        'plan',    v_plan
      );
    END IF;
  END IF;

  IF v_is_battle THEN
    SELECT COUNT(*) INTO v_battles_used
    FROM game_sessions
    WHERE user_id = v_user_id
      AND day_utc = v_day
      AND mode IN ('friend_battle','random_battle','virtual_battle')
      AND social_bonus = false;

    IF v_battles_used >= v_battle_limit THEN

      IF p_invite_id IS NOT NULL AND p_opponent_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM battle_invites
          WHERE id          = p_invite_id
            AND receiver_id = v_user_id
            AND sender_id   = p_opponent_id
            AND status      = 'accepted'
        ) THEN

          SELECT COUNT(*) INTO v_social_used
          FROM game_sessions
          WHERE user_id    = v_user_id
            AND day_utc    = v_day
            AND social_bonus = true;

          IF v_social_used < 1 THEN
            v_is_social_bonus := true;

            UPDATE battle_invites
            SET status      = 'expired',
                accepted_at = NOW()
            WHERE id = p_invite_id;
          ELSE
            RETURN jsonb_build_object(
              'allowed', false,
              'reason',  'social_bonus_already_used',
              'used',    v_battles_used,
              'limit',   v_battle_limit,
              'plan',    v_plan
            );
          END IF;
        ELSE
          RETURN jsonb_build_object(
            'allowed', false,
            'reason',  'invalid_invite',
            'used',    v_battles_used,
            'limit',   v_battle_limit,
            'plan',    v_plan
          );
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'allowed', false,
          'reason',  'battle_limit_reached',
          'used',    v_battles_used,
          'limit',   v_battle_limit,
          'plan',    v_plan
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO game_sessions(
    user_id,
    mode,
    day_utc,
    opponent_id,
    invite_id,
    social_bonus
  )
  VALUES (
    v_user_id,
    p_mode,
    v_day,
    p_opponent_id,
    p_invite_id,
    v_is_social_bonus
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'allowed',      true,
    'session_id',   v_session_id,
    'social_bonus', v_is_social_bonus,
    'plan',         v_plan,
    'remaining',
      CASE
        WHEN v_is_training THEN
          v_training_limit - v_training_used - 1
        WHEN v_is_battle THEN
          v_battle_limit - v_battles_used - CASE WHEN v_is_social_bonus THEN 0 ELSE 1 END
        ELSE NULL
      END
  );
END;
$$;
REVOKE ALL ON FUNCTION public.start_game_session(text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_game_session(text, uuid, uuid) TO authenticated;


-- ── 9. matchmaking_queue — lock down direct table access ─────────────────────
-- Live preflight (2026-09-16) found:
--   RLS enabled = true, FORCE = false
--   Policy mm_all: roles={public}, cmd=ALL, qual=true, with_check=true  ← unsafe
--   Table grants: anon + authenticated have ALL privileges              ← unsafe
--
-- Client access pattern (matchmaking.js):
--   • Direct INSERT to create caller's waiting row (line 137)
--   • Direct SELECT of waiting rows for battle board display (line 654)
--   • UPDATE/DELETE only through SECURITY DEFINER claim_random_match /
--     cancel_random_matchmaking (which bypass RLS by design)
--
-- New model:
--   anon   — no table access at all
--   authenticated — INSERT own row only (user_id = auth.uid(), not anonymous)
--                   SELECT own row + waiting rows of others (for battle board)
--                   no UPDATE/DELETE/TRUNCATE (handled by SECURITY DEFINER RPCs)

-- Drop the unsafe catch-all policy.
DROP POLICY IF EXISTS mm_all ON public.matchmaking_queue;

-- Remove all direct table privileges; re-grant only what the client needs.
REVOKE ALL ON TABLE public.matchmaking_queue FROM anon;
REVOKE ALL ON TABLE public.matchmaking_queue FROM authenticated;

GRANT INSERT ON TABLE public.matchmaking_queue TO authenticated;
GRANT SELECT ON TABLE public.matchmaking_queue TO authenticated;

-- INSERT policy: own row only, fresh waiting row only, non-anonymous only.
-- status='waiting' and matched_duel_id IS NULL enforced server-side so a client
-- cannot inject a pre-matched row — claim_random_match() is the only path that
-- sets status='matched'.
CREATE POLICY mm_insert_own
  ON public.matchmaking_queue
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id         = auth.uid()
    AND NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
    AND status          = 'waiting'
    AND matched_duel_id IS NULL
  );

-- SELECT policy: non-anonymous users only; own row OR other waiting rows.
-- The anon guard wraps the whole USING expression so an anonymous uid cannot
-- read its own row via the first branch.
CREATE POLICY mm_select_own_or_waiting
  ON public.matchmaking_queue
  FOR SELECT
  TO authenticated
  USING (
    NOT COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false)
    AND (
      user_id = auth.uid()
      OR status = 'waiting'
    )
  );


COMMIT;
