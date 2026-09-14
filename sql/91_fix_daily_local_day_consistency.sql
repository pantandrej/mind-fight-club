-- M91: Fix daily local-day consistency + server-authoritative streak
-- ───────────────────────────────────────────────────────────────────────────────
-- M90 LIVE: start_daily_bf_session + record_daily_activity use player timezone.
-- M90 LIVE: complete_daily_bf_session still used UTC clock (BLOCKER A, fixed here).
--
-- M91 fixes:
--   BLOCKER A: complete_daily_bf_session uses session.day_utc not clock.
--   BLOCKER B: record_daily_activity(p_session_id) — server validates session
--              completion before awarding streak (spoofing closed).
--   BLOCKER C: set_my_timezone RPC + trigger blocking direct timezone writes
--              + defensive tz validation in all Daily functions.
-- ───────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. set_my_timezone(p_timezone text) ──────────────────────────────────────
-- Validated SECURITY DEFINER write. Runs as postgres (function owner).
-- Client awaits this before start_daily_bf_session.
CREATE OR REPLACE FUNCTION public.set_my_timezone(p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_timezone', 'value', p_timezone);
  END IF;

  -- Skip write when already stored (no unnecessary row churn)
  UPDATE profiles
  SET    timezone   = p_timezone,
         updated_at = now()
  WHERE  id         = v_uid
    AND  COALESCE(timezone, '') <> p_timezone;

  RETURN jsonb_build_object('ok', true, 'timezone', p_timezone);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_timezone(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_my_timezone(text) TO authenticated;

-- ── 2. Guard: block direct authenticated writes to profiles.timezone ──────────
-- set_my_timezone() is SECURITY DEFINER (owner = postgres).
-- Triggers it fires see current_user = 'postgres', not 'authenticated'.
-- Direct client updates arrive as current_user = 'authenticated' → timezone reset.
CREATE OR REPLACE FUNCTION public.guard_profile_timezone()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.timezone IS DISTINCT FROM OLD.timezone
     AND current_user = 'authenticated'
  THEN
    NEW.timezone := OLD.timezone;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_timezone ON public.profiles;
CREATE TRIGGER trg_guard_profile_timezone
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profile_timezone();

-- ── 3. start_daily_bf_session() — add defensive tz fallback ──────────────────
-- M90 live version trusts stored timezone without validation.
-- Defensive: if stored tz is null or not in pg_timezone_names, fall back to UTC.
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
GRANT EXECUTE ON FUNCTION public.start_daily_bf_session() TO authenticated;

-- ── 4. complete_daily_bf_session() — use session.day_utc, not clock ──────────
-- BLOCKER A: v_today was (now() AT TIME ZONE 'UTC')::date — wrong when the
-- session started before player-local midnight but completes after.
-- Fix: v_today := v_session.day_utc (player's local calendar day at session start).
CREATE OR REPLACE FUNCTION public.complete_daily_bf_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_today         date;
  v_week_start    date;
  v_session       game_sessions%ROWTYPE;
  v_assigned_cnt  int;
  v_resolved_cnt  int;
  v_correct_cnt   int;
  v_bf_pts        int;
  v_team_id       uuid;
  v_source_id     uuid;
  v_rows          int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_session
  FROM game_sessions
  WHERE id = p_session_id AND user_id = v_uid AND mode = 'training';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  -- M91 BLOCKER A: session start day owns BF day — never recompute from clock
  v_today      := v_session.day_utc;
  v_week_start := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);

  IF NOT COALESCE(v_session.bf_eligible, false) THEN
    RETURN jsonb_build_object(
      'ok',          true,
      'bf_pts',      0,
      'bf_eligible', false,
      'reason',      'session_not_bf_eligible'
    );
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_correct IS NOT NULL)
  INTO v_assigned_cnt, v_resolved_cnt
  FROM session_questions
  WHERE session_id = p_session_id;

  IF v_assigned_cnt <> 10 OR v_resolved_cnt <> 10 THEN
    RETURN jsonb_build_object(
      'ok',             false,
      'reason',         'session_incomplete',
      'assigned_count', v_assigned_cnt,
      'resolved_count', v_resolved_cnt
    );
  END IF;

  SELECT COUNT(*) INTO v_correct_cnt
  FROM session_questions
  WHERE session_id = p_session_id AND is_correct = true;

  v_bf_pts    := LEAST(v_correct_cnt, 10);
  v_source_id := p_session_id;

  SELECT t.id INTO v_team_id
  FROM profiles pr
  LEFT JOIN teams t ON t.id = pr.team_id AND t.disbanded_at IS NULL
  WHERE pr.id = v_uid;

  INSERT INTO brain_fight_contributions (
    scoring_user_id, user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    v_uid, v_uid, v_team_id, v_week_start,
    'training', v_source_id, v_today, v_bf_pts, now()
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object(
      'ok',               true,
      'already_completed', true,
      'bf_pts',           0,
      'correct_count',    v_correct_cnt
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'bf_pts',        v_bf_pts,
    'correct_count', v_correct_cnt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_daily_bf_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_daily_bf_session(uuid) TO authenticated;

-- ── 5. record_daily_activity(p_session_id uuid) ──────────────────────────────
-- BLOCKER B: Old no-arg version was callable by any authenticated user,
-- bypassing the game requirement. New version validates session ownership
-- and completion before awarding streak.
--
-- Eligibility checks (must all pass or returns ok=false with reason):
--   1. auth.uid() is not null
--   2. game_sessions.id = p_session_id exists
--   3. session.user_id = auth.uid()
--   4. session.mode = 'training'
--   5. exactly 10 session_questions assigned
--   6. all 10 have is_correct IS NOT NULL (answered)
--
-- Streak date: session.day_utc (invariant: start-day owns the streak day).
-- Idempotent: if streak_last_date already equals session.day_utc → return existing state.

-- Drop old no-arg signature (M90 live)
DROP FUNCTION IF EXISTS public.record_daily_activity();

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

  -- Verify session ownership, mode, and completion
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

  -- Session start day owns the streak day — never recompute from current clock
  v_today := v_session.day_utc;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- Idempotent: already recorded for this session's day
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

  -- Milestone bonuses (canonical: 7, 30, 100 — per award_currency config)
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
GRANT EXECUTE ON FUNCTION public.record_daily_activity(uuid) TO authenticated;

COMMIT;
