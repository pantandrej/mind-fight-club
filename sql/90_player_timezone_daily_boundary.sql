-- M90: Player timezone for daily boundary
-- ───────────────────────────────────────────────────────────────────────────────
-- Root cause (BFC-C): start_daily_bf_session() used UTC day. At 01:53 Moscow
-- (UTC+3), server day = UTC Sep 14 (exhausted quota). Client local day = Sep 15
-- (fresh). localStorage locks cleared → RPC returned training_limit_reached.
--
-- Fix: add profiles.timezone (IANA, e.g. 'Europe/Moscow'). Client syncs via
-- Intl.DateTimeFormat().resolvedOptions().timeZone on login. Server calculates
-- the daily boundary as now() AT TIME ZONE profile.timezone.
--
-- game_sessions.day_utc semantics change: the column now stores the player's
-- local calendar date (not necessarily UTC). Column not renamed to avoid schema
-- migration complexity — internal field, only queried by start_daily_bf_session.
-- ───────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. Add timezone column to profiles ────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'UTC';

-- ── 2. Recreate start_daily_bf_session() — use player local day ───────────────
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

  -- M90: use player's stored IANA timezone for local-day boundary
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM profiles WHERE id = v_uid;
  v_today := (now() AT TIME ZONE v_tz)::date;

  PERFORM pg_advisory_xact_lock(
    hashtext(v_uid::text || ':' || v_today::text || ':training')
  );

  -- Plan determination (M86 fix retained: current_period_end, not expires_at)
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

  -- Stage 10 questions with answers_json ordering (M87 fix)
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
GRANT EXECUTE ON FUNCTION public.start_daily_bf_session() TO authenticated;

-- ── 3. Recreate record_daily_activity() — use player local day for streak ─────
-- (sql/05 original used current_date = UTC server date)
CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_profile   profiles%ROWTYPE;
  v_tz        text;
  v_today     date;
  v_yesterday date;
  v_gap       int;
  v_freeze_used boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- M90: use player's local timezone for day boundary
  v_tz        := COALESCE(v_profile.timezone, 'UTC');
  v_today     := (now() AT TIME ZONE v_tz)::date;
  v_yesterday := v_today - 1;

  -- Already recorded today → idempotent
  IF v_profile.streak_last_date = v_today THEN
    RETURN jsonb_build_object(
      'ok', true, 'streak', v_profile.daily_streak,
      'already_recorded', true, 'freeze_used', false
    );
  END IF;

  v_gap := COALESCE(v_today - v_profile.streak_last_date, 999);

  IF v_gap = 1 THEN
    UPDATE profiles
    SET daily_streak     = COALESCE(daily_streak, 0) + 1,
        streak_last_date = v_today,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;

  ELSIF v_gap = 2 AND COALESCE(v_profile.streak_freezes, 0) > 0 THEN
    UPDATE profiles
    SET daily_streak     = COALESCE(daily_streak, 0) + 1,
        streak_last_date = v_today,
        streak_freezes   = streak_freezes - 1,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
    v_freeze_used := true;

  ELSE
    UPDATE profiles
    SET daily_streak     = 1,
        streak_last_date = v_today,
        updated_at       = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  END IF;

  -- Milestone bonuses: award neurons for 7 / 30 / 100-day streaks
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
    'ok',          true,
    'streak',          v_profile.daily_streak,
    'freezes_left',    v_profile.streak_freezes,
    'freeze_used',     v_freeze_used,
    'milestone',       CASE
                         WHEN v_profile.daily_streak IN (7,30,100)
                         THEN v_profile.daily_streak
                         ELSE NULL
                       END
  );
END;
$$;

REVOKE ALL ON FUNCTION record_daily_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_daily_activity() TO authenticated;

COMMIT;
