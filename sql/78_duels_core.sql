-- ═══════════════════════════════════════════════════════════════
-- Migration 78: Duels Core — Server-Authoritative v1.0
-- DRAFT ONLY — DO NOT APPLY WITHOUT REVIEW
-- Security principle: CLIENT REQUESTS. SERVER DECIDES.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. Add guest_user_id to duel_rooms (host_user_id already exists) ──
ALTER TABLE duel_rooms
  ADD COLUMN IF NOT EXISTS guest_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

-- ── 2. Private answer key table (no RLS reads for users) ─────────────
CREATE TABLE IF NOT EXISTS duel_answer_keys (
  id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  duel_code    text    NOT NULL,
  question_idx int     NOT NULL,
  correct_index int    NOT NULL,
  question_time int    NOT NULL DEFAULT 20,
  UNIQUE (duel_code, question_idx)
);

ALTER TABLE duel_answer_keys ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE for authenticated users.
-- Only SECURITY DEFINER RPCs can access this table.
-- (No policies = implicit deny for all roles except postgres/service_role)

-- ── 3. RPC: store_duel_questions ──────────────────────────────────────
-- Called by host after loadBattleQuestions().
-- Stores correct_index privately; returns questions WITHOUT correct_index
-- for writing to duel_rooms.questions (guest-readable).
CREATE OR REPLACE FUNCTION store_duel_questions(
  p_duel_code  text,
  p_questions  jsonb   -- array of {cat, q, a, c, t}
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _q       jsonb;
  _idx     int     := 0;
  _pub_qs  jsonb   := '[]'::jsonb;
BEGIN
  -- Caller must be authenticated host of this room
  IF NOT EXISTS (
    SELECT 1 FROM duel_rooms
    WHERE code = p_duel_code
      AND host_user_id = auth.uid()
      AND status IN ('waiting', 'ready', 'started')
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_host');
  END IF;

  -- Idempotent: clear previous keys for this duel
  DELETE FROM duel_answer_keys WHERE duel_code = p_duel_code;

  FOR _q IN SELECT value FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO duel_answer_keys (duel_code, question_idx, correct_index, question_time)
    VALUES (
      p_duel_code,
      _idx,
      (_q->>'c')::int,
      COALESCE((_q->>'t')::int, 20)
    );
    -- Strip correct_index from public version
    _pub_qs := _pub_qs || jsonb_build_array(_q - 'c');
    _idx := _idx + 1;
  END LOOP;

  -- Update duel_rooms.questions with the sanitized (no c) version
  UPDATE duel_rooms
  SET questions = _pub_qs, status = 'started'
  WHERE code = p_duel_code;

  RETURN jsonb_build_object('ok', true, 'count', _idx);
END;
$$;

GRANT EXECUTE ON FUNCTION store_duel_questions(text, jsonb) TO authenticated;

-- ── 4. RPC: submit_duel_answer ────────────────────────────────────────
-- Called by each player when they pick an answer (or timeout).
-- Server checks correctness, awards points, writes score.
-- Returns correct_index so client can highlight the right answer.
CREATE OR REPLACE FUNCTION submit_duel_answer(
  p_duel_code    text,
  p_question_idx int,
  p_selected_idx int   -- -1 = timeout (no answer)
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _room          duel_rooms%ROWTYPE;
  _role          text;
  _correct_idx   int;
  _is_correct    boolean;
  _pts           int := 0;
  _cur_score     int;
  _cur_answers   jsonb;
  _already       boolean := false;
BEGIN
  SELECT * INTO _room FROM duel_rooms WHERE code = p_duel_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'room_not_found');
  END IF;
  IF _room.status != 'started' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_started');
  END IF;

  -- Identify caller role
  IF _room.host_user_id = auth.uid() THEN
    _role        := 'host';
    _cur_score   := COALESCE(_room.host_score,   0);
    _cur_answers := COALESCE(_room.host_answers,  '[]'::jsonb);
  ELSIF _room.guest_user_id = auth.uid() THEN
    _role        := 'guest';
    _cur_score   := COALESCE(_room.guest_score,  0);
    _cur_answers := COALESCE(_room.guest_answers, '[]'::jsonb);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  -- Idempotency: already answered this question?
  IF jsonb_array_length(_cur_answers) > p_question_idx THEN
    SELECT correct_index INTO _correct_idx FROM duel_answer_keys
      WHERE duel_code = p_duel_code AND question_idx = p_question_idx;
    RETURN jsonb_build_object(
      'ok', true, 'already_answered', true,
      'correct_index', _correct_idx, 'points', 0
    );
  END IF;

  -- Get correct answer from private key table
  SELECT correct_index INTO _correct_idx FROM duel_answer_keys
    WHERE duel_code = p_duel_code AND question_idx = p_question_idx;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'question_not_found');
  END IF;

  _is_correct := (p_selected_idx >= 0 AND p_selected_idx = _correct_idx);

  -- v1 scoring: 10 pts per correct answer (no client-controlled speed bonus)
  IF _is_correct THEN _pts := 10; END IF;

  -- Write score atomically
  UPDATE duel_rooms SET
    host_score    = CASE WHEN _role = 'host'  THEN _cur_score + _pts ELSE host_score  END,
    guest_score   = CASE WHEN _role = 'guest' THEN _cur_score + _pts ELSE guest_score END,
    host_answers  = CASE WHEN _role = 'host'  THEN _cur_answers || jsonb_build_array(_pts) ELSE host_answers  END,
    guest_answers = CASE WHEN _role = 'guest' THEN _cur_answers || jsonb_build_array(_pts) ELSE guest_answers END
  WHERE code = p_duel_code;

  RETURN jsonb_build_object(
    'ok',            true,
    'correct',       _is_correct,
    'points',        _pts,
    'correct_index', _correct_idx,
    'role',          _role
  );
END;
$$;

GRANT EXECUTE ON FUNCTION submit_duel_answer(text, int, int) TO authenticated;

-- ── 5. RPC: finalize_duel ─────────────────────────────────────────────
-- Called by each player after seeing result screen.
-- Server determines winner, updates game_sessions.won, awards BF point.
CREATE OR REPLACE FUNCTION finalize_duel(p_duel_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  _room     duel_rooms%ROWTYPE;
  _role     text;
  _my_score int;
  _op_score int;
  _win      boolean;
BEGIN
  SELECT * INTO _room FROM duel_rooms WHERE code = p_duel_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id = auth.uid() THEN
    _role     := 'host';
    _my_score := COALESCE(_room.host_score,  0);
    _op_score := COALESCE(_room.guest_score, 0);
  ELSIF _room.guest_user_id = auth.uid() THEN
    _role     := 'guest';
    _my_score := COALESCE(_room.guest_score, 0);
    _op_score := COALESCE(_room.host_score,  0);
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  _win := _my_score > _op_score;

  -- Update most recent game_session for this user
  UPDATE game_sessions SET won = _win
  WHERE user_id = auth.uid()
    AND mode IN ('friend_battle', 'random_battle')
    AND created_at > now() - interval '2 hours'
    AND (won IS NULL OR won = false)
  ORDER BY created_at DESC
  LIMIT 1;

  -- Award Brain Fights point if won
  IF _win THEN
    BEGIN
      PERFORM record_duel_win_bf(auth.uid());
    EXCEPTION WHEN OTHERS THEN NULL; -- graceful: BF RPC may not exist yet
    END;
  END IF;

  RETURN jsonb_build_object(
    'ok',       true,
    'win',      _win,
    'tie',      _my_score = _op_score,
    'my_score', _my_score,
    'op_score', _op_score
  );
END;
$$;

GRANT EXECUTE ON FUNCTION finalize_duel(text) TO authenticated;

-- ── 6. RLS on duel_rooms: tighten score writes ────────────────────────
-- Users must NOT be able to write host_score/guest_score directly.
-- All score mutations go through submit_duel_answer (SECURITY DEFINER).
-- Existing RLS policies should be reviewed; add a RESTRICTIVE policy
-- that blocks direct score updates from authenticated users.
-- (Implementation: drop direct UPDATE policy, keep status/done flags only
--  via a narrowed policy — exact implementation depends on current policies.)

-- NOTE: Check current policies with:
--   SELECT policyname, cmd, qual FROM pg_policies WHERE tablename = 'duel_rooms';
-- Then drop any permissive UPDATE policy that covers score columns.

-- ── 7. Cleanup: auto-expire old duel_answer_keys ─────────────────────
-- Optional cron: delete keys for rooms older than 24h
-- (Can be added to existing pg_cron jobs)
