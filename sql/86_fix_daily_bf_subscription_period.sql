-- ──────────────────────────────────────────────────────────────────────────
-- Migration86: fix start_daily_bf_session subscription column mismatch
--
-- Root cause (SQLSTATE 42703, confirmed 2026-09-14):
--   The deployed function queries subscriptions.expires_at which does not
--   exist in production. The correct column is current_period_end.
--
-- Scope:
--   Single semantic change — subscriptions WHERE/ORDER BY clause.
--   All other logic (advisory lock, quota, bf_eligible, question selection,
--   Arena exclusion, sanitized payload, session_questions insert) unchanged.
--
-- Context:
--   Migration82 is historical applied state and must NOT be edited.
--   This migration is the canonical corrective patch.
--
-- Diagnosed via:
--   SELECT public.start_daily_bf_session() under authenticated claim
--   ERROR: column "expires_at" does not exist
--   CONTEXT: PL/pgSQL function start_daily_bf_session() line 33
-- ──────────────────────────────────────────────────────────────────────────

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

  -- Advisory lock: same key as start_game_session training — serializes
  -- concurrent calls for this user+day, preventing double-session race.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_uid::text || ':' || v_today::text || ':training')
  );

  -- Determine plan (server-only).
  -- FIX (M86): subscriptions uses current_period_end, not expires_at.
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

  -- BF eligibility: canonical check while holding the advisory lock (BLOCKER 1).
  -- Check game_sessions for any session that already claimed bf_eligible=true today.
  -- This prevents the race where two Premium sessions start before either completes.
  IF EXISTS (
    SELECT 1 FROM game_sessions
    WHERE user_id     = v_uid
      AND day_utc     = v_today
      AND mode        = 'training'
      AND bf_eligible = true
  ) THEN
    v_bf_eligible := false;
  END IF;

  -- Defense-in-depth: if a contribution somehow already exists (e.g. manual admin
  -- insert), also mark ineligible.
  IF v_bf_eligible AND EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE scoring_user_id = v_uid
      AND source_type     = 'training'
      AND activity_date   = v_today
  ) THEN
    v_bf_eligible := false;
  END IF;

  -- Stage all 10 questions (validate before any DB write)
  FOREACH v_opt_count IN ARRAY v_progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text)          AS q_text,
      COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb) AS answers,
      COALESCE(q.category, 'GENERAL')                   AS category
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status               = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
      AND jsonb_array_length(
            COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = v_opt_count
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

    -- Build payload entry: no correct_index, no q_id (P0 security).
    -- sq_id is the only client token for submitting answers.
    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'sq_id', null::uuid,  -- placeholder; real sq_id set after INSERT below
      'pos',   v_pos,
      'q',     v_q_text,
      'a',     v_answers,
      'cat',   v_category,
      't',     20 + v_opt_count * 5
    ));
  END LOOP;

  -- All 10 questions staged — now create session + session_questions.
  -- Persist bf_eligible on the session row (P4: canonical per-session eligibility).
  INSERT INTO game_sessions (user_id, mode, day_utc, bf_eligible)
  VALUES (v_uid, 'training', v_today, v_bf_eligible)
  RETURNING id INTO v_session_id;

  -- Insert session_questions and patch sq_ids into payload.
  v_questions := '[]'::jsonb;
  FOR _i IN 0..(array_length(v_progression, 1) - 1)
  LOOP
    v_opt_count := v_progression[_i + 1];
    v_q_id      := v_used_ids[_i + 1];

    -- Re-fetch question text/answers (needed to build final payload)
    SELECT
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb),
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
