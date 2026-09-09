-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 81 — Friend Duel: use public curated bank
-- ═══════════════════════════════════════════════════════════════════════════
--
-- MOTIVATION
-- ----------
-- Friend Duel v1 is a casual social mode (no BF contribution, no high-stakes
-- authority). It was originally wired to is_competitive_secret=true, which
-- required a zero-count secret pool → every duel attempt returned
-- not_enough_secure_questions before the pool was populated.
--
-- The 1212-question public curated bank (source_type='official_general') is
-- fully sufficient for Friend Duel v1. Counts verified 2026-09-10:
--   2-option: 277   3-option: 215   4-option: 429
--   5-option: 172   6-option: 119   (total: 1212)
-- ALL eligible questions are source_type='official_general'; no other
-- source_type rows exist in the eligible pool.
--
-- DESIGN DECISION: BANK SEPARATION
-- ---------------------------------
-- PUBLIC CURATED BANK (is_competitive_secret = false, source_type = 'official_general'):
--   • Quick Play, Friend Duel v1
--   • Questions may have been seen before
--   • No high-integrity competitive rewards
--
-- COMPETITIVE SECRET BANK (is_competitive_secret = true):
--   • Future Ranked Duel, high-stakes competition, synchronized arenas
--   • Answer secrecy matters before/during competition
--   • Weekly Arena continues using secret content (UNCHANGED)
--
-- SCOPE OF THIS MIGRATION
-- -----------------------
-- ① Replace start_duel() question filter:
--      is_competitive_secret = false
--      source_type = 'official_general'
--      correct_index upper-bound guard: correct_index < answer-count
-- ② Rename error code: not_enough_questions (was: not_enough_secure_questions)
-- ③ All other start_duel() logic is preserved exactly:
--    - advisory lock / deadlock prevention
--    - eligibility check via _check_duel_battle_eligibility()
--    - staged commit (all 5 slots before any INSERT)
--    - server stores correct_index in duel_question_assignments
--    - sanitized response: no correct_index, no question_id in payload
--    - submit_duel_answer remains server-authoritative
--    - get_duel_result remains server-authoritative
-- ④ Weekly Arena / ranked modes NOT touched
--
-- DO NOT APPLY WITHOUT REVIEW.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── start_duel() — question-selection filter updated ─────────────────────
-- Full function re-declared (PostgreSQL requires it for SECURITY DEFINER).
-- Changes vs migration78 version:
--   is_competitive_secret = false  (was: = true)
--   source_type = 'official_general'  (new guard — restricts to curated bank)
--   correct_index < answer-count  (new guard — rejects malformed rows)
--   error code not_enough_questions  (was: not_enough_secure_questions)
-- Everything else is byte-for-byte identical to migration78.

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
  -- Staged question data (collected before any INSERT)
  _progression      int[]   := ARRAY[2, 3, 4, 5, 6];
  _opt_count        int;
  _used_ids         uuid[]  := ARRAY[]::uuid[];
  _staged_ids       uuid[]  := ARRAY[]::uuid[];
  _staged_corrects  int[]   := ARRAY[]::int[];
  _staged_times     int[]   := ARRAY[]::int[];
  _staged_json      jsonb   := '[]'::jsonb; -- sanitized client payload
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

  -- ── Deterministic advisory lock order ────────────────────────────
  -- Lock the user with the lexicographically smaller UUID first to prevent
  -- A↔B deadlock when two rooms have the same two players in opposite roles.
  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first  := _room.host_user_id;
    _lock_second := _room.guest_user_id;
  ELSE
    _lock_first  := _room.guest_user_id;
    _lock_second := _room.host_user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || v_day::TEXT || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || v_day::TEXT || ':battle'));

  -- ── Eligibility: host ─────────────────────────────────────────────
  _host_elig := _check_duel_battle_eligibility(_room.host_user_id, _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');
  END IF;

  -- ── Eligibility: guest ────────────────────────────────────────────
  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id, NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached');
  END IF;

  -- ── Stage full question set (validate first, mutate second) ──────
  -- All 5 slots must be found before any duel_question_assignments INSERT.
  -- Pool: official_general curated bank (is_competitive_secret=false,
  -- source_type='official_general', correct_index bounds checked).
  -- ★ CHANGED from migration78: see filter block below
  FOREACH _opt_count IN ARRAY _progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_ru, q.answers_json),
      COALESCE(q.category, 'GENERAL'),
      q.correct_index
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct
    FROM questions q
    WHERE q.status = 'active'
      AND q.question_type = 'multiple_choice'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND q.is_competitive_secret = false                         -- ★ public bank
      AND q.source_type = 'official_general'                     -- ★ curated bank only
      AND q.correct_index < jsonb_array_length(                  -- ★ upper-bound guard
            COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
      AND jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = _opt_count
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
      -- Pool empty for this opt_count — should not happen with 1212 questions.
      -- ★ CHANGED: error code is now 'not_enough_questions' (was: 'not_enough_secure_questions')
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

    -- Accumulate into local arrays only — no DB write yet
    _staged_ids      := _staged_ids     || ARRAY[_q_id];
    _staged_corrects := _staged_corrects || ARRAY[_q_correct];
    _staged_times    := _staged_times   || ARRAY[_q_time];
    _staged_json     := _staged_json || jsonb_build_array(jsonb_build_object(
      'idx', _idx, 'cat', _q_category, 'q', _q_text, 'a', _q_answers, 't', _q_time
    ));
    _used_ids := _used_ids || ARRAY[_q_id];
    _idx := _idx + 1;
  END LOOP;

  -- ── All 5 slots found — now commit persistently ──────────────────
  -- Clear any stale assignments from a previous attempt first
  DELETE FROM duel_question_assignments WHERE duel_code = p_code;

  -- Bulk insert all staged assignments
  FOR _idx IN 1..array_length(_staged_ids, 1)
  LOOP
    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx - 1, _staged_ids[_idx], _staged_corrects[_idx], _staged_times[_idx]);
  END LOOP;

  -- Create game_sessions for both players (consume quota)
  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.host_user_id,  'friend_battle', v_day, _room.guest_user_id, (_host_elig->>'social_bonus')::boolean);

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.guest_user_id, 'friend_battle', v_day, _room.host_user_id,  (_guest_elig->>'social_bonus')::boolean);

  -- Transition room
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

-- Permissions unchanged from migration78
REVOKE ALL ON FUNCTION start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION start_duel(text) TO authenticated;

-- ── Comment: no other RPCs modified ─────────────────────────────────────
-- submit_duel_answer: reads correct_index from duel_question_assignments
--   (server-stored) → unchanged, still server-authoritative.
-- get_duel (LIVE): returns sanitized questions with no correct_index → unchanged.
-- get_duel_result: derives winner from duel_rooms.host_score/guest_score → unchanged.
-- Weekly Arena / ranked modes: not touched. Still use is_competitive_secret=true
--   (enforced by the separate weekly_arena_questions table join, unchanged).
-- _get_question_for_correction (migration78 line ~874): still checks
--   is_competitive_secret=false → correct behavior unchanged.
