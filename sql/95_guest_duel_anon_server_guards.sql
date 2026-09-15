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
-- This migration adds server-authoritative guards to the four entry-point RPCs
-- that violate the guest product contract if called by an anonymous user:
--
--   1. create_duel()                  — guests cannot be hosts
--   2. award_currency(text,text,int,boolean) — guests cannot earn neurons/XP
--   3. start_daily_bf_session()       — guests cannot play Brain Fights
--   4. record_daily_activity(uuid)    — guests cannot earn streak rewards
--
-- RPCs intentionally left open for anonymous users (product contract):
--   join_duel_by_code, get_duel, submit_duel_answer,
--   get_duel_result, forfeit_duel
--
-- start_game_session is not in this repo's SQL files (created via dashboard);
-- it must be patched separately in the Supabase dashboard with the same guard.
-- Client-side `is_anonymous` check in matchmaking.js prevents UI access.
--
-- Guard pattern used in all functions:
--   IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
--     RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
--   END IF;
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
-- Reproduces M87 body verbatim; adds anon guard after uid check.
CREATE OR REPLACE FUNCTION public.start_daily_bf_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_today         date := (now() AT TIME ZONE 'UTC')::date;
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


-- ── NOTE: start_game_session ───────────────────────────────────────────────────
-- start_game_session is not tracked in this repo's SQL files (created via
-- Supabase dashboard). Apply this equivalent guard manually in the dashboard:
--
--   IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
--     RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed',
--       'allowed', false);
--   END IF;
--
-- Add it immediately after the existing `IF v_uid IS NULL THEN` check.
-- Client-side is_anonymous guard in matchmaking.js prevents UI-level access.


COMMIT;
