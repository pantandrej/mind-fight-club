-- ═══════════════════════════════════════════════════════════════════════
-- Migration 78: Duels Core v1.0 — Full Server Authority
-- DRAFT ONLY — DO NOT APPLY WITHOUT REVIEW
-- Principle: CLIENT REQUESTS. SERVER DECIDES.
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. duel_rooms schema additions ──────────────────────────────────────
-- Add columns needed for server-authoritative lifecycle.
-- host_user_id already exists in some deployments; guest_user_id is new.
ALTER TABLE duel_rooms
  ADD COLUMN IF NOT EXISTS guest_user_id  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS host_name      text,
  ADD COLUMN IF NOT EXISTS guest_name     text,
  ADD COLUMN IF NOT EXISTS started_at     timestamptz,
  ADD COLUMN IF NOT EXISTS expires_at     timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at    timestamptz,
  ADD COLUMN IF NOT EXISTS winner_id      uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forfeit_by     uuid        REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Lock duel_rooms — REVOKE all direct DML from users ───────────────
-- Current policies (from migration 32):
--   "duel_rooms_public_read"  FOR SELECT USING (true)          ← keep narrow version
--   "duel_rooms_public_write" FOR ALL    USING (true) WITH CHECK (true)  ← DROP
-- After: authenticated may SELECT safe columns. No INSERT/UPDATE/DELETE directly.

DROP POLICY IF EXISTS "duel_rooms_public_write" ON duel_rooms;
DROP POLICY IF EXISTS "duel_rooms_public_read"  ON duel_rooms;

-- Allow authenticated users to SELECT rows (row-level: any row is readable for lobby join)
-- Column-level REVOKE below hides sensitive fields.
CREATE POLICY "duel_rooms_auth_read"
  ON duel_rooms FOR SELECT
  TO authenticated
  USING (true);

-- REVOKE sensitive columns from direct REST reads.
-- host_user_id / guest_user_id: private identity — never expose to clients
-- questions: legacy column no longer used; revoke for safety
-- winner_id / forfeit_by: sensitive until duel is finished (RPCs handle reveal)
REVOKE SELECT ON TABLE duel_rooms FROM authenticated, anon;
GRANT  SELECT (
  code, status, host_name, guest_name,
  host_score, guest_score,
  host_answers, guest_answers,
  host_done, guest_done,
  created_at, started_at, expires_at, finished_at,
  last_phrase
) ON TABLE duel_rooms TO authenticated;
-- anon: no direct table access; unauthenticated players cannot duel in v1
REVOKE ALL ON TABLE duel_rooms FROM anon;

-- ── 3. Private question assignment table ────────────────────────────────
-- Server-only: question selection per duel. No user RLS policies (implicit deny).
CREATE TABLE IF NOT EXISTS duel_question_assignments (
  id            uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_code     text  NOT NULL,
  question_idx  int   NOT NULL,
  question_id   uuid  NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  correct_index int   NOT NULL,
  question_time int   NOT NULL DEFAULT 30,
  UNIQUE (duel_code, question_idx)
);
ALTER TABLE duel_question_assignments ENABLE ROW LEVEL SECURITY;
-- No policies → implicit deny for all user roles. Only SECURITY DEFINER RPCs access this.

-- ── 4. Immutable answer ledger ───────────────────────────────────────────
-- One row per (duel, player, question). UNIQUE constraint enforces idempotency.
-- Duplicate submit scores exactly once (ON CONFLICT DO NOTHING).
CREATE TABLE IF NOT EXISTS duel_answers (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_code    text        NOT NULL,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  question_idx int         NOT NULL,
  selected_idx int         NOT NULL,  -- -1 = timeout (no answer)
  is_correct   boolean     NOT NULL,
  points       int         NOT NULL DEFAULT 0,
  answered_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (duel_code, user_id, question_idx)
);
ALTER TABLE duel_answers ENABLE ROW LEVEL SECURITY;
-- No policies → implicit deny. Only SECURITY DEFINER RPCs access this.

-- ── 5. RPC: create_duel() ────────────────────────────────────────────────
-- Host creates a duel room. Server generates code and sets host identity.
CREATE OR REPLACE FUNCTION create_duel()
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
REVOKE ALL ON FUNCTION create_duel() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION create_duel() TO authenticated;

-- ── 6. RPC: join_duel_by_code(p_code) ───────────────────────────────────
-- Guest joins by code. Server validates state and sets guest identity.
CREATE OR REPLACE FUNCTION join_duel_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid    uuid := auth.uid();
  _room   duel_rooms%ROWTYPE;
  _name   text;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  -- Lock row to prevent concurrent joins
  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found');
  END IF;

  -- Self-join: host cannot be their own guest
  IF _room.host_user_id = _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'self_join');
  END IF;

  -- Third player: room already has a guest
  IF _room.guest_user_id IS NOT NULL AND _room.guest_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_full');
  END IF;

  -- Reject expired/started/finished rooms
  IF _room.status NOT IN ('waiting', 'ready') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_joinable',
      'status', _room.status);
  END IF;

  -- Fetch guest display name
  SELECT COALESCE(display_name, split_part(email, '@', 1), 'Guest')
    INTO _name
    FROM profiles WHERE id = _uid;
  IF _name IS NULL THEN _name := 'Guest'; END IF;

  UPDATE duel_rooms
  SET status = 'ready', guest_user_id = _uid, guest_name = _name
  WHERE code = p_code;

  RETURN jsonb_build_object('ok', true, 'guest_name', _name, 'host_name', _room.host_name);
END;
$$;
REVOKE ALL ON FUNCTION join_duel_by_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION join_duel_by_code(text) TO authenticated;

-- ── 7. RPC: get_duel(p_code) ─────────────────────────────────────────────
-- Safe snapshot of duel state for polling. Returns sanitized questions (no id, no c).
-- Participants only (or waiting/ready rooms for lobby display).
CREATE OR REPLACE FUNCTION get_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid      uuid := auth.uid();
  _room     duel_rooms%ROWTYPE;
  _role     text;
  _questions jsonb := NULL;
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
    _role := 'host';
  ELSIF _room.guest_user_id = _uid THEN
    _role := 'guest';
  ELSIF _room.status IN ('waiting', 'ready') THEN
    _role := NULL; -- lobby observer (pre-join)
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  -- Load sanitized questions: no question_id, no correct_index
  IF _room.status IN ('started', 'finished') THEN
    SELECT jsonb_agg(
      jsonb_build_object(
        'idx', dqa.question_idx,
        'cat', COALESCE(q.category, 'GENERAL'),
        'q',   COALESCE(q.question_ru, q.question_text, ''),
        'a',   COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb),
        't',   dqa.question_time
      ) ORDER BY dqa.question_idx
    ) INTO _questions
    FROM duel_question_assignments dqa
    JOIN questions q ON q.id = dqa.question_id
    WHERE dqa.duel_code = p_code;
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'status',       _room.status,
    'role',         _role,
    'host_name',    _room.host_name,
    'guest_name',   _room.guest_name,
    'host_score',   COALESCE(_room.host_score,  0),
    'guest_score',  COALESCE(_room.guest_score, 0),
    'host_answers', COALESCE(_room.host_answers,  '[]'::jsonb),
    'guest_answers',COALESCE(_room.guest_answers, '[]'::jsonb),
    'host_done',    COALESCE(_room.host_done,  false),
    'guest_done',   COALESCE(_room.guest_done, false),
    'expires_at',   _room.expires_at,
    'started_at',   _room.started_at,
    'finished_at',  _room.finished_at,
    'questions',    _questions
  );
END;
$$;
REVOKE ALL ON FUNCTION get_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_duel(text) TO authenticated;

-- ── 8. RPC: start_duel(p_code) ───────────────────────────────────────────
-- Host triggers start. SERVER selects questions, stores private key, sets expiry.
-- Client NEVER sends questions or correct answers.
-- Questions without question IDs are returned (sanitized).
CREATE OR REPLACE FUNCTION start_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid        uuid := auth.uid();
  _room       duel_rooms%ROWTYPE;
  _progression int[] := ARRAY[2, 3, 4, 5, 6]; -- answer counts per question
  _opt_count  int;
  _used_ids   uuid[] := ARRAY[]::uuid[];
  _q_id       uuid;
  _q_text     text;
  _q_answers  jsonb;
  _q_category text;
  _q_correct  int;
  _q_time     int;
  _idx        int := 0;
  _qs_out     jsonb := '[]'::jsonb;
  _expires_min int := 15; -- minutes for entire duel
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  -- Only host can start
  IF _room.host_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_host');
  END IF;

  -- Must be in ready state (guest has joined)
  IF _room.status != 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready',
      'status', _room.status);
  END IF;

  -- Clear any previous question assignment (idempotent restart safety)
  DELETE FROM duel_question_assignments WHERE duel_code = p_code;

  -- SERVER selects one question per answer-count in the progression
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
      AND jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = _opt_count
      AND NOT (q.id = ANY(_used_ids))
      -- Exclude questions currently in active Weekly Arena (privacy boundary from migration 77)
      AND q.id NOT IN (
        SELECT waq.question_id
        FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random()
    LIMIT 1;

    IF NOT FOUND OR _q_id IS NULL THEN
      -- Not enough secure questions — abort. SAFE + disabled > insecure fallback.
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'not_enough_secure_questions',
        'needed_opt_count', _opt_count
      );
    END IF;

    -- Determine time limit based on option count
    _q_time := CASE _opt_count
      WHEN 2 THEN 30
      WHEN 3 THEN 35
      WHEN 4 THEN 40
      WHEN 5 THEN 45
      WHEN 6 THEN 50
      ELSE 30
    END;

    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx, _q_id, _q_correct, _q_time);

    -- Build sanitized question for public payload: no id, no correct_index
    _qs_out := _qs_out || jsonb_build_array(jsonb_build_object(
      'idx', _idx,
      'cat', _q_category,
      'q',   _q_text,
      'a',   _q_answers,
      't',   _q_time
    ));

    _used_ids := _used_ids || ARRAY[_q_id];
    _idx := _idx + 1;
  END LOOP;

  -- Transition room to started with server-set expiry
  UPDATE duel_rooms SET
    status     = 'started',
    started_at = now(),
    expires_at = now() + (_expires_min || ' minutes')::interval,
    -- Reset scores (in case of retry)
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
    'questions', _qs_out,
    'expires_at', (now() + (_expires_min || ' minutes')::interval)
  );
END;
$$;
REVOKE ALL ON FUNCTION start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION start_duel(text) TO authenticated;

-- ── 9. RPC: submit_duel_answer(p_code, p_question_idx, p_selected_idx) ──
-- Player submits an answer (or timeout sentinel -1).
-- Server verifies correctness from private ledger.
-- Response is NEUTRAL: no correct_index, no is_correct, no points during LIVE.
-- Duplicate submits score exactly once (ON CONFLICT DO NOTHING).
CREATE OR REPLACE FUNCTION submit_duel_answer(
  p_code         text,
  p_question_idx int,
  p_selected_idx int   -- -1 = timeout / no answer
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

  -- Must be a participant
  IF _room.host_user_id != _uid AND _room.guest_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  -- Must be live
  IF _room.status != 'started' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_live', 'status', _room.status);
  END IF;

  -- Server expiry check
  IF _room.expires_at IS NOT NULL AND now() > _room.expires_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'duel_expired');
  END IF;

  -- Get correct answer from private table
  SELECT correct_index, question_time INTO _correct_idx, _q_time
  FROM duel_question_assignments
  WHERE duel_code = p_code AND question_idx = p_question_idx;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_not_found');
  END IF;

  -- Validate selected_idx range
  IF p_selected_idx != -1 THEN
    SELECT COUNT(*) INTO _inserted -- reuse var for jsonb_array_length
    FROM duel_question_assignments dqa
    JOIN questions q ON q.id = dqa.question_id
    WHERE dqa.duel_code = p_code AND dqa.question_idx = p_question_idx
      AND p_selected_idx >= 0
      AND p_selected_idx < jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb));
    IF _inserted = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_selected_idx');
    END IF;
  END IF;

  -- Server-side correctness and scoring (v1: fixed 10 pts per correct answer)
  _is_correct := (p_selected_idx >= 0 AND p_selected_idx = _correct_idx);
  IF _is_correct THEN _pts := 10; END IF;

  -- Immutable ledger insert — ON CONFLICT DO NOTHING ensures idempotency
  -- Simultaneous duplicate submits: only the first INSERT succeeds; score derived from inserted rows only
  INSERT INTO duel_answers (duel_code, user_id, question_idx, selected_idx, is_correct, points)
  VALUES (p_code, _uid, p_question_idx, p_selected_idx, _is_correct, _pts)
  ON CONFLICT (duel_code, user_id, question_idx) DO NOTHING;

  GET DIAGNOSTICS _inserted = ROW_COUNT;

  -- Only update running score if a new row was inserted (idempotency)
  IF _inserted > 0 THEN
    IF _room.host_user_id = _uid THEN
      UPDATE duel_rooms SET
        host_score   = COALESCE(host_score, 0) + _pts,
        host_answers = COALESCE(host_answers, '[]'::jsonb) || jsonb_build_array(_pts)
      WHERE code = p_code;
    ELSE
      UPDATE duel_rooms SET
        guest_score   = COALESCE(guest_score, 0) + _pts,
        guest_answers = COALESCE(guest_answers, '[]'::jsonb) || jsonb_build_array(_pts)
      WHERE code = p_code;
    END IF;
  END IF;

  -- Return neutral response — no correct_index, no is_correct, no points during LIVE
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

-- ── 10. RPC: get_duel_result(p_code) ────────────────────────────────────
-- Called by each player after completing all questions or when waiting for opponent.
-- Finalizes the duel server-side (idempotent) and returns authoritative result.
-- Returns waiting: true if opponent not yet done and expiry not reached.
CREATE OR REPLACE FUNCTION get_duel_result(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid         uuid := auth.uid();
  _room        duel_rooms%ROWTYPE;
  _role        text;
  _host_done   boolean;
  _guest_done  boolean;
  _host_score  int;
  _guest_score int;
  _my_score    int;
  _op_score    int;
  _my_correct  int;
  _win         boolean;
  _tie         boolean;
  _total_qs    int;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id = _uid THEN
    _role := 'host';
  ELSIF _room.guest_user_id = _uid THEN
    _role := 'guest';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  SELECT COUNT(*) INTO _total_qs FROM duel_question_assignments WHERE duel_code = p_code;

  -- Determine completion from immutable ledger (not from client-supplied done flags)
  SELECT COUNT(*) >= _total_qs INTO _host_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;

  SELECT COUNT(*) >= _total_qs INTO _guest_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  -- If already finished, return cached result
  IF _room.status = 'finished' THEN
    _my_score := CASE _role WHEN 'host' THEN COALESCE(_room.host_score, 0) ELSE COALESCE(_room.guest_score, 0) END;
    _op_score := CASE _role WHEN 'host' THEN COALESCE(_room.guest_score, 0) ELSE COALESCE(_room.host_score, 0) END;
    _win := CASE _role WHEN 'host' THEN _room.winner_id = _room.host_user_id ELSE _room.winner_id = _room.guest_user_id END;
    _tie := _room.winner_id IS NULL AND _room.finished_at IS NOT NULL;
    SELECT COUNT(*) INTO _my_correct FROM duel_answers WHERE duel_code = p_code AND user_id = _uid AND is_correct = true;
    RETURN jsonb_build_object(
      'ok', true, 'waiting', false, 'win', _win, 'tie', _tie,
      'my_score', _my_score, 'op_score', _op_score, 'correct_count', _my_correct
    );
  END IF;

  -- Not finished yet — check if we should finalize now
  DECLARE
    _expired boolean := (_room.expires_at IS NOT NULL AND now() >= _room.expires_at);
    _both_done boolean := (_host_done AND _guest_done);
  BEGIN
    IF NOT _both_done AND NOT _expired THEN
      -- Still waiting for opponent
      RETURN jsonb_build_object('ok', true, 'waiting', true);
    END IF;
  END;

  -- Derive authoritative scores from immutable ledger
  SELECT COALESCE(SUM(points), 0) INTO _host_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;

  SELECT COALESCE(SUM(points), 0) INTO _guest_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  _my_score := CASE _role WHEN 'host' THEN _host_score ELSE _guest_score END;
  _op_score := CASE _role WHEN 'host' THEN _guest_score ELSE _host_score END;
  _win      := _my_score > _op_score;
  _tie      := _my_score = _op_score;

  -- Finalize exactly once (idempotent via status check above)
  UPDATE duel_rooms SET
    status      = 'finished',
    finished_at = now(),
    host_score  = _host_score,
    guest_score = _guest_score,
    winner_id   = CASE
      WHEN _host_score > _guest_score THEN _room.host_user_id
      WHEN _guest_score > _host_score THEN _room.guest_user_id
      ELSE NULL  -- tie
    END
  WHERE code = p_code AND status = 'started'; -- guard against concurrent finalize

  -- Update game_sessions.won from server-authoritative result
  UPDATE game_sessions SET
    won             = _win,
    score           = _my_score,
    questions_count = _total_qs
  WHERE user_id = _uid
    AND mode IN ('friend_battle', 'random_battle')
    AND created_at > now() - interval '2 hours'
    AND (won IS NULL OR won = false)
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT COUNT(*) INTO _my_correct FROM duel_answers WHERE duel_code = p_code AND user_id = _uid AND is_correct = true;

  RETURN jsonb_build_object(
    'ok', true, 'waiting', false,
    'win', _win, 'tie', _tie,
    'my_score', _my_score, 'op_score', _op_score,
    'correct_count', _my_correct
  );
END;
$$;
REVOKE ALL ON FUNCTION get_duel_result(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION get_duel_result(text) TO authenticated;

-- ── 11. RPC: forfeit_duel(p_code) ────────────────────────────────────────
-- Server-side forfeit record. Client calls this instead of fabricating fake scores.
CREATE OR REPLACE FUNCTION forfeit_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid  uuid := auth.uid();
  _room duel_rooms%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated'); END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  IF _room.host_user_id != _uid AND _room.guest_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  IF _room.status NOT IN ('started', 'ready', 'waiting') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_finished');
  END IF;

  UPDATE duel_rooms SET
    status      = 'finished',
    finished_at = now(),
    forfeit_by  = _uid,
    winner_id   = CASE
      WHEN _room.host_user_id = _uid  THEN _room.guest_user_id
      WHEN _room.guest_user_id = _uid THEN _room.host_user_id
      ELSE NULL
    END
  WHERE code = p_code;

  RETURN jsonb_build_object('ok', true, 'forfeited', true);
END;
$$;
REVOKE ALL ON FUNCTION forfeit_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION forfeit_duel(text) TO authenticated;

-- ── 12. Extend get_question_reveals to block active duel questions ───────
-- Prevents a player from looking up correct_index by question ID
-- even if they somehow obtain question IDs from the duel payload.
-- (Note: get_duel / start_duel intentionally omit question IDs from responses,
--  so this is defense-in-depth.)
CREATE OR REPLACE FUNCTION public.get_question_reveals(p_ids uuid[])
RETURNS TABLE(id uuid, correct_index int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.correct_index
  FROM questions q
  WHERE q.id = ANY(p_ids)
    AND q.is_competitive_secret = false
    -- Block questions in live Weekly Arena (from migration 77)
    AND q.id NOT IN (
      SELECT waq.question_id
      FROM weekly_arena_questions waq
      JOIN weekly_arenas wa ON wa.id = waq.arena_id
      WHERE now() < wa.ends_at
    )
    -- Block questions assigned to active duels (new in migration 78)
    AND q.id NOT IN (
      SELECT dqa.question_id
      FROM duel_question_assignments dqa
      JOIN duel_rooms dr ON dr.code = dqa.duel_code
      WHERE dr.status = 'started'
    );
$$;
-- Grants unchanged from migration 77
REVOKE ALL ON FUNCTION public.get_question_reveals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_reveals(uuid[]) TO authenticated, anon;

-- ── 13. Brain Fights — explicitly NO duel contribution ──────────────────
-- No call to record_duel_win_bf in any of the above RPCs.
-- Duel wins do NOT create Brain Fights contributions in v1.

-- ── 14. matchmaking_queue — block anon writes (Random Duel disabled v1) ─
-- Random Duel is disabled in v1 frontend. Ensure queue is not writable by anon.
DROP POLICY IF EXISTS "matchmaking_queue_anon_write" ON matchmaking_queue;

-- ── 15. Indexes for performance ──────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_dqa_duel_code ON duel_question_assignments(duel_code);
CREATE INDEX IF NOT EXISTS idx_da_duel_user  ON duel_answers(duel_code, user_id);
CREATE INDEX IF NOT EXISTS idx_dr_code       ON duel_rooms(code);
CREATE INDEX IF NOT EXISTS idx_dr_status     ON duel_rooms(status) WHERE status IN ('waiting','ready','started');

-- ══════════════════════════════════════════════════════════════════════════
-- VERIFY QUERIES (run after applying to confirm security posture)
-- ══════════════════════════════════════════════════════════════════════════
-- SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'duel_rooms';
-- SELECT grantee, privilege_type, column_name FROM information_schema.column_privileges
--   WHERE table_name = 'duel_rooms' ORDER BY column_name;
-- SELECT policyname, cmd FROM pg_policies WHERE tablename IN ('duel_question_assignments','duel_answers');
-- SELECT routinename FROM information_schema.routines WHERE routine_name LIKE '%duel%';
