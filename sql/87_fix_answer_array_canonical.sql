-- ══════════════════════════════════════════════════════════════════════════════
-- Migration87 — Fix canonical answer array ordering in all gameplay RPCs
--
-- Root cause (confirmed 2026-09-14):
--   All server-authoritative gameplay RPCs use COALESCE(answers_ru, answers_json)
--   to select and return the question answer array. However questions.correct_index
--   is indexed into answers_json, not answers_ru. For the 671 active official_general
--   questions where both arrays exist but differ in ordering, any answer that is
--   correct per answers_json is wrong per answers_ru, causing systematic wrong grading.
--
-- Proof (football question id=4c2654b7-423c-4533-80df-de25d96f56cf):
--   answers_json = ["Первый дивизион","Премьер-лига","Чемпионшип"]  correct_index=1 → Премьер-лига ✓
--   answers_ru   = ["Премьер-лига","Первый дивизион","Чемпионшип"]  correct_index=1 → Первый дивизион ✗
--
-- Bank-wide scope (active official_general multiple_choice with both arrays):
--   total_both_present: 1017
--   identical:           275
--   different arrays:    742
--   grading_mismatch:    671  (← active release blocker)
--
-- Fix: swap COALESCE order to COALESCE(answers_json, answers_ru) in all affected
--      server-authoritative RPCs. correct_index remains canonical to answers_json.
--
-- Affected functions (all CREATE OR REPLACE — no DDL changes):
--   1. public.get_duel(text)                     — M78: answer display during battle
--   2. public.start_duel(text)                   — M78: question staging + payload
--   3. public.submit_duel_answer(text,int,int)    — M78: range validation (consistency)
--   4. public.start_virtual_battle_session(uuid) — M85: question staging + payload
--   5. public.submit_virtual_battle_answer(uuid,int) — M85: range validation + v_n
--   6. public.start_daily_bf_session()           — M86: question staging + payload
--
-- Security preserved on every function:
--   SECURITY DEFINER, SET search_path = public
--   REVOKE ALL FROM PUBLIC, anon; GRANT EXECUTE TO authenticated
--   correct_index never exposed before answer submission
--
-- !! STOP BEFORE APPLY — requires owner review !!
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. get_duel(p_code text) ──────────────────────────────────────────────
-- Fix: answers returned during STARTED/FINISHED now use answers_json ordering.
CREATE OR REPLACE FUNCTION get_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid          uuid := auth.uid();
  _room         duel_rooms%ROWTYPE;
  _role         text;
  _opp_uid      uuid;
  _questions    jsonb := NULL;
  _my_answered  int   := 0;
  _opp_answered int   := 0;
  _total_qs     int   := 0;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Determine caller role
  IF _room.host_user_id = _uid THEN
    _role    := 'host';
    _opp_uid := _room.guest_user_id;
  ELSIF _room.guest_user_id = _uid THEN
    _role    := 'guest';
    _opp_uid := _room.host_user_id;
  ELSIF _room.status IN ('waiting', 'ready') THEN
    _role := NULL; -- lobby observer (pre-join)
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  -- Load sanitized questions during STARTED or FINISHED: no question_id, no correct_index
  IF _room.status IN ('started', 'finished') THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'idx', dqa.question_idx,
        'cat', COALESCE(q.category, 'GENERAL'),
        'q',   COALESCE(q.question_ru, q.question_text, ''),
        'a',   COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb),  -- M87 fix
        't',   dqa.question_time
      ) ORDER BY dqa.question_idx
    ) INTO _questions
    FROM duel_question_assignments dqa
    JOIN questions q ON q.id = dqa.question_id
    WHERE dqa.duel_code = p_code;

    SELECT COUNT(*) INTO _total_qs
    FROM duel_question_assignments WHERE duel_code = p_code;
  END IF;

  -- Neutral answered counts from immutable ledger (LIVE only)
  IF _room.status = 'started' AND _role IS NOT NULL THEN
    SELECT COUNT(*) INTO _my_answered
    FROM duel_answers WHERE duel_code = p_code AND user_id = _uid;

    IF _opp_uid IS NOT NULL THEN
      SELECT COUNT(*) INTO _opp_answered
      FROM duel_answers WHERE duel_code = p_code AND user_id = _opp_uid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',                      true,
    'status',                  _room.status,
    'role',                    _role,
    'host_name',               _room.host_name,
    'guest_name',              _room.guest_name,
    'expires_at',              _room.expires_at,
    'questions',               _questions,
    'my_answered_count',       _my_answered,
    'opponent_answered_count', _opp_answered,
    'total_questions',         _total_qs
  );
END;
$$;
REVOKE ALL ON FUNCTION get_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_duel(text) TO authenticated;

-- ── 2. start_duel(p_code text) ────────────────────────────────────────────
-- Fix: staged question payload uses answers_json ordering to match correct_index.
CREATE OR REPLACE FUNCTION start_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid              uuid := auth.uid();
  _room             duel_rooms%ROWTYPE;
  v_day             DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  _host_elig        jsonb;
  _guest_elig       jsonb;
  _progression      int[]   := ARRAY[2, 3, 4, 5, 6];
  _opt_count        int;
  _used_ids         uuid[]  := ARRAY[]::uuid[];
  _staged_ids       uuid[]  := ARRAY[]::uuid[];
  _staged_corrects  int[]   := ARRAY[]::int[];
  _staged_times     int[]   := ARRAY[]::int[];
  _staged_json      jsonb   := '[]'::jsonb;
  _q_id             uuid;
  _q_text           text;
  _q_answers        jsonb;
  _q_category       text;
  _q_correct        int;
  _q_time           int;
  _idx              int := 0;
  _expires_min      int := 15;
  _lock_first       uuid;
  _lock_second      uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_host');
  END IF;

  IF _room.status != 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready', 'status', _room.status);
  END IF;

  IF _room.guest_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_guest');
  END IF;

  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first  := _room.host_user_id;
    _lock_second := _room.guest_user_id;
  ELSE
    _lock_first  := _room.guest_user_id;
    _lock_second := _room.host_user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || v_day::TEXT || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || v_day::TEXT || ':battle'));

  _host_elig := _check_duel_battle_eligibility(_room.host_user_id, _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');
  END IF;

  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id, NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached');
  END IF;

  FOREACH _opt_count IN ARRAY _progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_json, q.answers_ru),             -- M87 fix
      COALESCE(q.category, 'GENERAL'),
      q.correct_index
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct
    FROM questions q
    WHERE q.status = 'active'
      AND q.question_type = 'multiple_choice'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND q.is_competitive_secret = false                              -- public bank
      AND q.source_type = 'official_general'                          -- curated bank only
      AND q.correct_index < jsonb_array_length(                       -- upper-bound guard
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))      -- M87 fix
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = _opt_count  -- M87 fix
      AND NOT (q.id = ANY(_used_ids))
      AND q.id NOT IN (
        SELECT waq.question_id
        FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random()
    LIMIT 1;

    IF NOT FOUND OR _q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'not_enough_questions',
        'needed_opt_count', _opt_count
      );
    END IF;

    _q_time := CASE _opt_count
      WHEN 2 THEN 30 WHEN 3 THEN 35 WHEN 4 THEN 40
      WHEN 5 THEN 45 WHEN 6 THEN 50 ELSE 30
    END;

    _staged_ids      := _staged_ids     || ARRAY[_q_id];
    _staged_corrects := _staged_corrects || ARRAY[_q_correct];
    _staged_times    := _staged_times   || ARRAY[_q_time];
    _staged_json     := _staged_json || jsonb_build_array(jsonb_build_object(
      'idx', _idx, 'cat', _q_category, 'q', _q_text, 'a', _q_answers, 't', _q_time
    ));
    _used_ids := _used_ids || ARRAY[_q_id];
    _idx := _idx + 1;
  END LOOP;

  DELETE FROM duel_question_assignments WHERE duel_code = p_code;

  FOR _idx IN 1..array_length(_staged_ids, 1)
  LOOP
    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx - 1, _staged_ids[_idx], _staged_corrects[_idx], _staged_times[_idx]);
  END LOOP;

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.host_user_id,  'friend_battle', v_day, _room.guest_user_id, (_host_elig->>'social_bonus')::boolean);

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.guest_user_id, 'friend_battle', v_day, _room.host_user_id,  (_guest_elig->>'social_bonus')::boolean);

  UPDATE duel_rooms SET
    status       = 'started',
    started_at   = now(),
    expires_at   = now() + (_expires_min || ' minutes')::interval,
    host_score   = 0,
    guest_score  = 0,
    host_answers = '[]'::jsonb,
    guest_answers= '[]'::jsonb,
    host_done    = false,
    guest_done   = false,
    winner_id    = NULL,
    finished_at  = NULL
  WHERE code = p_code;

  RETURN jsonb_build_object(
    'ok',        true,
    'questions', _staged_json,
    'expires_at', (now() + (_expires_min || ' minutes')::interval)
  );
END;
$$;
REVOKE ALL ON FUNCTION start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION start_duel(text) TO authenticated;

-- ── 3. submit_duel_answer(text,int,int) ───────────────────────────────────
-- Fix: range validation uses answers_json length for consistency with start_duel.
CREATE OR REPLACE FUNCTION submit_duel_answer(
  p_code         text,
  p_question_idx int,
  p_selected_idx int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid         uuid := auth.uid();
  _room        duel_rooms%ROWTYPE;
  _correct_idx int;
  _q_time      int;
  _is_correct  boolean;
  _pts         int := 0;
  _inserted    int;
  _my_answered int;
  _total_qs    int;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id != _uid AND _room.guest_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  IF _room.status != 'started' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_live', 'status', _room.status);
  END IF;

  IF _room.expires_at IS NOT NULL AND now() > _room.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duel_expired');
  END IF;

  SELECT correct_index, question_time INTO _correct_idx, _q_time
  FROM duel_question_assignments
  WHERE duel_code = p_code AND question_idx = p_question_idx;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_not_found');
  END IF;

  IF p_selected_idx != -1 THEN
    SELECT COUNT(*) INTO _inserted
    FROM duel_question_assignments dqa
    JOIN questions q ON q.id = dqa.question_id
    WHERE dqa.duel_code = p_code AND dqa.question_idx = p_question_idx
      AND p_selected_idx >= 0
      AND p_selected_idx < jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb));  -- M87 fix
    IF _inserted = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_idx');
    END IF;
  END IF;

  _is_correct := (p_selected_idx >= 0 AND p_selected_idx = _correct_idx);
  IF _is_correct THEN _pts := 10; END IF;

  INSERT INTO duel_answers (duel_code, user_id, question_idx, selected_idx, is_correct, points)
  VALUES (p_code, _uid, p_question_idx, p_selected_idx, _is_correct, _pts)
  ON CONFLICT (duel_code, user_id, question_idx) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  SELECT COUNT(*) INTO _my_answered
  FROM duel_answers WHERE duel_code = p_code AND user_id = _uid;

  SELECT COUNT(*) INTO _total_qs
  FROM duel_question_assignments WHERE duel_code = p_code;

  RETURN jsonb_build_object(
    'ok',              true,
    'accepted',        true,
    'answered_count',  _my_answered,
    'total_questions', _total_qs,
    'completed',       _my_answered >= _total_qs
  );
END;
$$;
REVOKE ALL ON FUNCTION submit_duel_answer(text, int, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION submit_duel_answer(text, int, int) TO authenticated;

-- ── 4. start_virtual_battle_session(uuid) ────────────────────────────────
-- Fix: answer array sent to client uses answers_json ordering.
CREATE OR REPLACE FUNCTION public.start_virtual_battle_session(
  p_game_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_qids       uuid[] := ARRAY[]::uuid[];
  v_q_id       uuid;
  v_sq_id      uuid;
  v_q_text     text;
  v_answers    jsonb;
  v_category   text;
  v_questions  jsonb := '[]'::jsonb;
  progression  int[] := ARRAY[2, 3, 4, 5, 6];
  v_opt_count  int;
  v_pos        int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM game_sessions
    WHERE id = p_game_session_id
      AND user_id = v_user_id
      AND mode = 'virtual_battle'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  IF EXISTS (
    SELECT 1 FROM session_questions WHERE session_id = p_game_session_id LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_assigned');
  END IF;

  FOR v_pos IN 0..4 LOOP
    v_opt_count := progression[v_pos + 1];

    SELECT q.id,
           q.question_text,
           COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb),  -- M87 fix
           COALESCE(q.category, 'GENERAL')
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status                = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = v_opt_count  -- M87 fix
      AND q.correct_index < jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))  -- M87 fix
      AND q.id <> ALL(v_qids)
    ORDER BY random()
    LIMIT 1;

    IF v_q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok',               false,
        'reason',           'not_enough_questions',
        'missing_opt_count', v_opt_count
      );
    END IF;

    v_qids := v_qids || v_q_id;

    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (p_game_session_id, v_q_id, v_pos)
    RETURNING id INTO v_sq_id;

    v_questions := v_questions || jsonb_build_object(
      'sq_id',    v_sq_id,
      'position', v_pos,
      'q',        v_q_text,
      'a',        v_answers,
      'cat',      v_category,
      't',        30
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok',        true,
    'session_id', p_game_session_id,
    'questions',  v_questions
  );
END;
$$;

-- ── 5. submit_virtual_battle_answer(uuid,int) ────────────────────────────
-- Fix: v_n (array length) and v_answers use answers_json ordering, matching
-- the array returned by start_virtual_battle_session after M87.
CREATE OR REPLACE FUNCTION public.submit_virtual_battle_answer(
  p_sq_id        uuid,
  p_selected_idx int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id              uuid := auth.uid();
  v_session_id           uuid;
  v_question_id          uuid;
  v_correct_idx          int;
  v_answers              jsonb;
  v_n                    int;
  v_is_correct           bool;
  v_wrong_idxs           int[];
  v_rows_updated         int;
  v_selected_persisted   int;
  v_is_correct_persisted bool;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT sq.session_id,
         sq.question_id,
         q.correct_index,
         jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)),  -- M87 fix
         COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)                        -- M87 fix
  INTO v_session_id, v_question_id, v_correct_idx, v_n, v_answers
  FROM session_questions sq
  JOIN game_sessions     gs ON gs.id    = sq.session_id
  JOIN questions         q  ON q.id     = sq.question_id
  WHERE sq.id        = p_sq_id
    AND gs.user_id   = v_user_id
    AND gs.mode      = 'virtual_battle';

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sq_not_found');
  END IF;

  IF p_selected_idx <> -1 AND (p_selected_idx < 0 OR p_selected_idx >= v_n) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_selected_idx');
  END IF;

  v_is_correct := (p_selected_idx >= 0 AND p_selected_idx = v_correct_idx);

  UPDATE session_questions
  SET selected_idx = p_selected_idx,
      is_correct   = v_is_correct,
      answered_at  = now()
  WHERE id           = p_sq_id
    AND selected_idx IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  SELECT array_agg(s.i ORDER BY s.i)
  INTO v_wrong_idxs
  FROM generate_series(0, v_n - 1) AS s(i)
  WHERE s.i <> v_correct_idx;

  IF v_rows_updated = 0 THEN
    SELECT sq.selected_idx, sq.is_correct
    INTO v_selected_persisted, v_is_correct_persisted
    FROM session_questions sq
    WHERE sq.id = p_sq_id;

    RETURN jsonb_build_object(
      'ok',               true,
      'accepted',         false,
      'reason',           'already_answered',
      'selected_idx',     v_selected_persisted,
      'is_correct',       v_is_correct_persisted,
      'correct_index',    v_correct_idx,
      'n_answers',        v_n,
      'bot_wrong_indices', to_jsonb(v_wrong_idxs)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',               true,
    'accepted',         true,
    'selected_idx',     p_selected_idx,
    'is_correct',       v_is_correct,
    'correct_index',    v_correct_idx,
    'n_answers',        v_n,
    'bot_wrong_indices', to_jsonb(v_wrong_idxs)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_virtual_battle_session(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_virtual_battle_session(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  TO authenticated;

-- ── 6. start_daily_bf_session() ──────────────────────────────────────────
-- Fix: question staging and final payload both use answers_json ordering.
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
      COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)        AS answers,  -- M87 fix
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
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))                -- M87 fix
      AND jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = v_opt_count  -- M87 fix
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
      COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb),  -- M87 fix
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

COMMIT;
