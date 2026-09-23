-- M97: 14-day cross-mode question anti-repeat protection
-- APPLIED = NO — DO NOT APPLY without owner confirmation
-- Branch: dev
--
-- Problem:
--   Users see the same questions repeated across Quick Play, virtual battle,
--   friend battle, and random battle with no server-side deduplication.
--
-- Solution:
--   Before each question selection loop, build a uuid[] of question IDs the
--   user has already been assigned within the previous 14 local calendar days,
--   across ALL four modes. Exclude those IDs from the random selection query.
--
-- History sources (canonical, server-authoritative):
--   training + virtual_battle: session_questions → game_sessions
--   friend_battle + random_battle: duel_question_assignments → duel_rooms
--     (joined via host_session_id / guest_session_id from M93)
--
-- Local-day window:
--   Uses profiles.timezone resolved per M91 pattern (v_today - 13 = 14 days inclusive).
--   game_sessions.day_utc stores the user's local calendar day (M96).
--
-- If strict pool exhausted: returns 'not_enough_fresh_questions' (never falls back).
--
-- Functions replaced (all bodies updated; all grants/revokes preserved):
--   1. start_daily_bf_session()
--   2. start_virtual_battle_session(uuid)
--   3. start_duel(text)
--
-- Indexes added for the cross-mode seen-question lookup.

BEGIN;

-- ── Indexes for anti-repeat lookups ──────────────────────────────────────────

-- Reverse lookup: which session_questions reference a given question
CREATE INDEX IF NOT EXISTS idx_sq_question_id
  ON public.session_questions(question_id);

-- User+day lookup across all modes (supplements existing partial index for training)
CREATE INDEX IF NOT EXISTS idx_gs_user_day
  ON public.game_sessions(user_id, day_utc);

-- Fast lookup of duel_rooms by host/guest session IDs (M93 columns)
CREATE INDEX IF NOT EXISTS idx_dr_host_session_id
  ON public.duel_rooms(host_session_id) WHERE host_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dr_guest_session_id
  ON public.duel_rooms(guest_session_id) WHERE guest_session_id IS NOT NULL;


-- ── Helper macro (inline): build seen-question array for one user ─────────────
-- Used inside each function body. Not a separate SQL function (avoids RPC overhead).
-- Pattern:
--
--   SELECT ARRAY(
--     -- Quick Play + Virtual: session_questions is the ledger
--     SELECT sq.question_id
--     FROM session_questions sq
--     JOIN game_sessions gs ON gs.id = sq.session_id
--     WHERE gs.user_id = _uid
--       AND gs.day_utc >= _today - 13
--     UNION
--     -- Friend + Random: duel_question_assignments, user linked via M93 session columns
--     SELECT dqa.question_id
--     FROM duel_question_assignments dqa
--     JOIN duel_rooms dr ON dr.code = dqa.duel_code
--     WHERE dr.host_session_id IN (
--         SELECT id FROM game_sessions
--         WHERE user_id = _uid AND day_utc >= _today - 13 AND mode = 'friend_battle'
--       )
--       OR dr.guest_session_id IN (
--         SELECT id FROM game_sessions
--         WHERE user_id = _uid AND day_utc >= _today - 13 AND mode = 'friend_battle'
--       )
--   ) INTO v_seen_ids;
--
-- Note: random_battle also uses duel_question_assignments via start_duel (same path).


-- ── 1. start_daily_bf_session() ─────────────────────────────────────────────
-- Adds 14-day cross-mode seen-question exclusion.
-- All other logic (M91 timezone, M87 answer array, bf_eligible, progression) unchanged.
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
  v_seen_ids      uuid[] := ARRAY[]::uuid[];
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

  -- M95: anonymous users (Supabase anonymous auth) must not play Quick Play.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'anonymous_not_allowed');
  END IF;

  -- M91: defensive timezone resolution
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

  -- Build 14-day cross-mode seen-question exclusion set (once, before selection loop)
  SELECT ARRAY(
    SELECT sq.question_id
    FROM session_questions sq
    JOIN game_sessions gs ON gs.id = sq.session_id
    WHERE gs.user_id = v_uid
      AND gs.day_utc >= v_today - 13
    UNION
    SELECT dqa.question_id
    FROM duel_question_assignments dqa
    WHERE dqa.duel_code IN (
      SELECT dr.code FROM duel_rooms dr
      WHERE dr.host_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = v_uid AND day_utc >= v_today - 13 AND mode = 'friend_battle'
      )
      OR dr.guest_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = v_uid AND day_utc >= v_today - 13 AND mode = 'friend_battle'
      )
    )
  ) INTO v_seen_ids;

  -- Stage 10 questions
  FOREACH v_opt_count IN ARRAY v_progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text)                   AS q_text,
      COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)        AS answers,
      COALESCE(q.category, 'GENERAL')                            AS category
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
      AND NOT (q.id = ANY(v_seen_ids))        -- M97: 14-day cross-mode exclusion
      AND q.id NOT IN (
        SELECT waq.question_id FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random() LIMIT 1;

    IF NOT FOUND OR v_q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'reason',          'not_enough_fresh_questions',   -- M97: strict pool exhaustion
        'needed_opt_count', v_opt_count,
        'mode',            'training'
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


-- ── 2. start_virtual_battle_session(uuid) ────────────────────────────────────
-- Adds 14-day cross-mode seen-question exclusion AND atomic staging:
--   Phase 1 — SELECT all 5 question IDs into staging arrays.
--             If any bucket is empty → return not_enough_fresh_questions
--             BEFORE any INSERT (no partial write possible).
--   Phase 2 — INSERT all 5 session_questions and build client payload.
-- This eliminates the half-assigned session state: a failed pool exhaustion
-- always leaves session_questions empty, so retry remains possible.
CREATE OR REPLACE FUNCTION public.start_virtual_battle_session(
  p_game_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id         uuid  := auth.uid();
  v_tz              text  := 'UTC';
  v_today           date;
  v_seen_ids        uuid[] := ARRAY[]::uuid[];
  -- Phase-1 staging arrays (no INSERT until all 5 are found)
  v_staged_ids      uuid[]   := ARRAY[]::uuid[];
  v_staged_texts    text[]   := ARRAY[]::text[];
  v_staged_answers  jsonb[]  := ARRAY[]::jsonb[];
  v_staged_cats     text[]   := ARRAY[]::text[];
  -- Phase-2 write
  v_sq_id           uuid;
  v_questions       jsonb := '[]'::jsonb;
  progression       int[] := ARRAY[2, 3, 4, 5, 6];
  v_opt_count       int;
  v_pos             int;
  v_q_id            uuid;
  v_q_text          text;
  v_answers         jsonb;
  v_category        text;
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

  -- Resolve user's local calendar date for 14-day window (M91 pattern)
  SELECT COALESCE(timezone, 'UTC') INTO v_tz FROM profiles WHERE id = v_user_id;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;
  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Build 14-day cross-mode seen-question exclusion set (M97)
  SELECT ARRAY(
    SELECT sq.question_id
    FROM session_questions sq
    JOIN game_sessions gs ON gs.id = sq.session_id
    WHERE gs.user_id = v_user_id
      AND gs.day_utc >= v_today - 13
    UNION
    SELECT dqa.question_id
    FROM duel_question_assignments dqa
    WHERE dqa.duel_code IN (
      SELECT dr.code FROM duel_rooms dr
      WHERE dr.host_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = v_user_id AND day_utc >= v_today - 13 AND mode = 'friend_battle'
      )
      OR dr.guest_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = v_user_id AND day_utc >= v_today - 13 AND mode = 'friend_battle'
      )
    )
  ) INTO v_seen_ids;

  -- ── Phase 1: Stage all 5 questions BEFORE any INSERT ─────────────────────
  -- If ANY bucket is empty, return error immediately — no rows have been written.
  FOR v_pos IN 0..4 LOOP
    v_opt_count := progression[v_pos + 1];

    SELECT q.id,
           q.question_text,
           COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb),
           COALESCE(q.category, 'GENERAL')
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status                = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = v_opt_count
      AND q.correct_index < jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))
      AND q.id <> ALL(v_staged_ids)
      AND NOT (q.id = ANY(v_seen_ids))      -- M97: 14-day cross-mode exclusion
    ORDER BY random()
    LIMIT 1;

    IF v_q_id IS NULL THEN
      -- Pool exhausted BEFORE any INSERT — session_questions is still empty,
      -- retry remains possible.
      RETURN jsonb_build_object(
        'ok',               false,
        'reason',           'not_enough_fresh_questions',
        'missing_opt_count', v_opt_count,
        'mode',             'virtual_battle'
      );
    END IF;

    v_staged_ids     := v_staged_ids     || ARRAY[v_q_id];
    v_staged_texts   := v_staged_texts   || ARRAY[v_q_text];
    v_staged_answers := v_staged_answers || ARRAY[v_answers];
    v_staged_cats    := v_staged_cats    || ARRAY[v_category];
  END LOOP;

  -- ── Phase 2: All 5 staged — write session_questions and build payload ─────
  FOR v_pos IN 0..4 LOOP
    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (p_game_session_id, v_staged_ids[v_pos + 1], v_pos)
    RETURNING id INTO v_sq_id;

    v_questions := v_questions || jsonb_build_object(
      'sq_id',    v_sq_id,
      'position', v_pos,
      'q',        v_staged_texts[v_pos + 1],
      'a',        v_staged_answers[v_pos + 1],
      'cat',      v_staged_cats[v_pos + 1],
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

REVOKE ALL ON FUNCTION public.start_virtual_battle_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_virtual_battle_session(uuid) TO authenticated;


-- ── 3. start_duel(text) ──────────────────────────────────────────────────────
-- Adds 14-day cross-mode seen-question exclusion (UNION of host + guest IDs).
-- Both players must not have seen any selected question in the last 14 local days.
-- Each player's window uses their own resolved local calendar day (M96 semantics).
-- All other logic (M96 local-day locks, M93 session linking, M87 question pool) unchanged.
CREATE OR REPLACE FUNCTION public.start_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid              uuid := auth.uid();
  _room             duel_rooms%ROWTYPE;
  _host_tz          TEXT;
  _guest_tz         TEXT;
  _host_day         DATE;
  _guest_day        DATE;
  _host_elig        jsonb;
  _guest_elig       jsonb;
  _progression      int[]   := ARRAY[2, 3, 4, 5, 6];
  _opt_count        int;
  _used_ids         uuid[]  := ARRAY[]::uuid[];
  _seen_ids         uuid[]  := ARRAY[]::uuid[];   -- M97: union of host+guest recent questions
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
  _lock_first_day   date;
  _lock_second      uuid;
  _lock_second_day  date;
  _host_sid         uuid;
  _guest_sid        uuid;
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

  -- Resolve each player's local calendar date independently (M96)
  SELECT COALESCE(timezone, 'UTC') INTO _host_tz
  FROM profiles WHERE id = _room.host_user_id;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _host_tz) THEN
    _host_tz := 'UTC';
  END IF;
  _host_day := (now() AT TIME ZONE _host_tz)::date;

  SELECT COALESCE(timezone, 'UTC') INTO _guest_tz
  FROM profiles WHERE id = _room.guest_user_id;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _guest_tz) THEN
    _guest_tz := 'UTC';
  END IF;
  _guest_day := (now() AT TIME ZONE _guest_tz)::date;

  -- Advisory locks — deterministic UUID ordering, each UUID paired with its own local day (M96)
  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first      := _room.host_user_id;
    _lock_first_day  := _host_day;
    _lock_second     := _room.guest_user_id;
    _lock_second_day := _guest_day;
  ELSE
    _lock_first      := _room.guest_user_id;
    _lock_first_day  := _guest_day;
    _lock_second     := _room.host_user_id;
    _lock_second_day := _host_day;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || _lock_first_day::TEXT  || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || _lock_second_day::TEXT || ':battle'));

  -- Eligibility (M96: local day + no virtual in social quota)
  _host_elig := _check_duel_battle_eligibility(_room.host_user_id, _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');
  END IF;

  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id, NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached');
  END IF;

  -- M97: Build UNION of host + guest seen question IDs (14 local calendar days each)
  -- A question is excluded if EITHER player has seen it recently.
  -- Registered host always gets full protection; anonymous guest treated by uid.
  SELECT ARRAY(
    -- HOST seen: session_questions (training + virtual_battle)
    SELECT sq.question_id
    FROM session_questions sq
    JOIN game_sessions gs ON gs.id = sq.session_id
    WHERE gs.user_id = _room.host_user_id
      AND gs.day_utc >= _host_day - 13
    UNION
    -- HOST seen: duel_question_assignments (friend + random)
    SELECT dqa.question_id
    FROM duel_question_assignments dqa
    WHERE dqa.duel_code IN (
      SELECT dr.code FROM duel_rooms dr
      WHERE dr.host_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = _room.host_user_id
          AND day_utc >= _host_day - 13 AND mode = 'friend_battle'
      )
      OR dr.guest_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = _room.host_user_id
          AND day_utc >= _host_day - 13 AND mode = 'friend_battle'
      )
    )
    UNION
    -- GUEST seen: session_questions (training + virtual_battle)
    SELECT sq.question_id
    FROM session_questions sq
    JOIN game_sessions gs ON gs.id = sq.session_id
    WHERE gs.user_id = _room.guest_user_id
      AND gs.day_utc >= _guest_day - 13
    UNION
    -- GUEST seen: duel_question_assignments (friend + random)
    SELECT dqa.question_id
    FROM duel_question_assignments dqa
    WHERE dqa.duel_code IN (
      SELECT dr.code FROM duel_rooms dr
      WHERE dr.host_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = _room.guest_user_id
          AND day_utc >= _guest_day - 13 AND mode = 'friend_battle'
      )
      OR dr.guest_session_id IN (
        SELECT id FROM game_sessions
        WHERE user_id = _room.guest_user_id
          AND day_utc >= _guest_day - 13 AND mode = 'friend_battle'
      )
    )
  ) INTO _seen_ids;

  -- Question selection (M87 pool + M97 fresh exclusion)
  FOREACH _opt_count IN ARRAY _progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_json, q.answers_ru),
      COALESCE(q.category, 'GENERAL'),
      q.correct_index
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct
    FROM questions q
    WHERE q.status = 'active'
      AND q.question_type = 'multiple_choice'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND q.is_competitive_secret = false
      AND q.source_type = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = _opt_count
      AND NOT (q.id = ANY(_used_ids))
      AND NOT (q.id = ANY(_seen_ids))           -- M97: 14-day cross-mode exclusion
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
        'ok',              false,
        'error',           'not_enough_fresh_questions',    -- M97: strict pool exhaustion
        'needed_opt_count', _opt_count,
        'mode',            'friend_battle'
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

  -- Each player's game_session records their own local day (M96)
  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.host_user_id, 'friend_battle', _host_day, _room.guest_user_id, (_host_elig->>'social_bonus')::boolean)
  RETURNING id INTO _host_sid;

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.guest_user_id, 'friend_battle', _guest_day, _room.host_user_id, (_guest_elig->>'social_bonus')::boolean)
  RETURNING id INTO _guest_sid;

  UPDATE duel_rooms SET
    status            = 'started',
    started_at        = now(),
    expires_at        = now() + (_expires_min || ' minutes')::interval,
    host_score        = 0,
    guest_score       = 0,
    host_answers      = '[]'::jsonb,
    guest_answers     = '[]'::jsonb,
    host_done         = false,
    guest_done        = false,
    winner_id         = NULL,
    finished_at       = NULL,
    host_session_id   = _host_sid,
    guest_session_id  = _guest_sid
  WHERE code = p_code;

  RETURN jsonb_build_object(
    'ok',        true,
    'questions', _staged_json,
    'expires_at', (now() + (_expires_min || ' minutes')::interval)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_duel(text) TO authenticated;


COMMIT;
