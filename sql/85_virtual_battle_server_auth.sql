-- ════════════════════════════════════════════════════════════════════════════
-- Migration 85 — Virtual Battle Server-Authoritative Question Assignment
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problem: virtual battle calls loadBattleQuestions() which embeds correct_index
--   as field "c" in the question payload sent to the browser. pickDuel() and
--   duelExpire() use q.c locally before submitting any answer. Client has all
--   correct answers at game start — violates server-authority architecture.
--
-- Solution: two SECURITY DEFINER RPCs reusing the existing session_questions
--   table (created by Migration 82). No new tables required.
--
-- Question bank (canonical, matching start_daily_bf_session + start_duel):
--   status = 'active'
--   question_type = 'multiple_choice'
--   is_competitive_secret = false
--   source_type = 'official_general'
--   correct_index IS NOT NULL AND correct_index >= 0 AND in bounds
--
-- Prod eligible counts (queried 2026-09-13):
--   2 options: 277  |  3: 215  |  4: 429  |  5: 172  |  6: 119
--
-- start_virtual_battle_session(p_game_session_id uuid)
--   Called after start_game_session('virtual_battle') succeeds.
--   Assigns 5 questions with option progression [2,3,4,5,6].
--   Returns: {ok, session_id, questions:[{sq_id, position, q, a, cat, t}]}
--   Never returns correct_index.
--
-- submit_virtual_battle_answer(p_sq_id uuid, p_selected_idx int)
--   p_selected_idx: -1 = timeout (always incorrect), 0..n-1 = valid choice.
--   Validates range. Atomic UPDATE WHERE selected_idx IS NULL.
--   If 0 rows updated (duplicate submit): returns persisted canonical values
--   with accepted=false (never overwrites first answer).
--   Returns correct_index only AFTER the atomic write succeeds.
--
-- Permissions: SECURITY DEFINER; REVOKE PUBLIC/anon; GRANT authenticated.
-- session_questions: no client policies (SECURITY DEFINER bypasses RLS).
--
-- !! STOP BEFORE APPLY !!
-- Client changes required before applying:
--   js/battles/matchmaking.js  — startBotDuel calls start_virtual_battle_session
--   js/battles/friend-battle.js — pickDuel/duelExpire call submit_virtual_battle_answer
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── start_virtual_battle_session ─────────────────────────────────────────
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

  -- Verify caller owns this game_session with mode=virtual_battle
  IF NOT EXISTS (
    SELECT 1 FROM game_sessions
    WHERE id = p_game_session_id
      AND user_id = v_user_id
      AND mode = 'virtual_battle'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  -- Idempotency: reject if questions already assigned to this session
  IF EXISTS (
    SELECT 1 FROM session_questions WHERE session_id = p_game_session_id LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_assigned');
  END IF;

  -- Assign one question per progression slot [2,3,4,5,6]
  -- Canonical bank: matches start_daily_bf_session and start_duel
  FOR v_pos IN 0..4 LOOP
    v_opt_count := progression[v_pos + 1];

    SELECT q.id,
           q.question_text,
           COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb),
           COALESCE(q.category, 'GENERAL')
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status                = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = v_opt_count
      AND q.correct_index < jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
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

    -- Store assignment: correct_index held server-side, never returned here
    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (p_game_session_id, v_q_id, v_pos)
    RETURNING id INTO v_sq_id;

    -- Build payload: no correct_index, no question_id
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

-- ── submit_virtual_battle_answer ──────────────────────────────────────────
-- Atomic: UPDATE WHERE selected_idx IS NULL. If 0 rows → first answer wins.
-- Returns correct_index only after the atomic write. Never before.
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

  -- Validate ownership + fetch question metadata
  -- (single query; correct_index never returned to client from here)
  SELECT sq.session_id,
         sq.question_id,
         q.correct_index,
         jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)),
         COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)
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

  -- Validate selected_idx: -1 = timeout, 0..n-1 = valid answer
  IF p_selected_idx <> -1 AND (p_selected_idx < 0 OR p_selected_idx >= v_n) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_selected_idx');
  END IF;

  -- Timeout (-1) is always incorrect
  v_is_correct := (p_selected_idx >= 0 AND p_selected_idx = v_correct_idx);

  -- Atomic write: first submission wins; second gets accepted=false
  UPDATE session_questions
  SET selected_idx = p_selected_idx,
      is_correct   = v_is_correct,
      answered_at  = now()
  WHERE id           = p_sq_id
    AND selected_idx IS NULL;

  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  -- Bot wrong-option indices (for client bot animation; excludes correct answer)
  SELECT array_agg(s.i ORDER BY s.i)
  INTO v_wrong_idxs
  FROM generate_series(0, v_n - 1) AS s(i)
  WHERE s.i <> v_correct_idx;

  IF v_rows_updated = 0 THEN
    -- Duplicate submit: return persisted canonical answer, never overwrite
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

-- Permissions: authenticated only; revoke from public and anon explicitly
REVOKE ALL ON FUNCTION public.start_virtual_battle_session(uuid)       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_virtual_battle_session(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  TO authenticated;

COMMIT;
