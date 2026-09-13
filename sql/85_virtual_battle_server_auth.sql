-- ════════════════════════════════════════════════════════════════════════════
-- Migration 85 — Virtual Battle Server-Authoritative Question Assignment
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problem: virtual battle calls loadBattleQuestions() which returns correct_index
--   as field "c" to the browser. pickDuel() uses q.c locally to check answers.
--   Client has all correct answers at game start — violates server-authority arch.
--
-- Solution: two SECURITY DEFINER RPCs that reuse the existing session_questions
--   table (created by Migration 82). No new tables needed.
--
--   start_virtual_battle_session(p_game_session_id uuid)
--     Called after start_game_session('virtual_battle') succeeds.
--     Assigns 5 questions with option progression [2,3,4,5,6].
--     Returns: {ok, session_id, questions:[{sq_id, position, q, a, cat, t}]}
--     Never returns correct_index.
--
--   submit_virtual_battle_answer(p_sq_id uuid, p_selected_idx int)
--     Server reads correct_index from questions table.
--     Writes is_correct atomically to session_questions.
--     Returns: {ok, is_correct, correct_index, n_answers, bot_wrong_indices}
--     correct_index only reaches the client AFTER the answer is submitted.
--
-- Virtual persona correctness (Макс 0.575, София 0.705, Даниил 0.84):
--   Client uses per-question random to decide if the bot answered correctly.
--   If bot is correct: show correct_index (revealed by submit response).
--   If bot is wrong:   client picks from bot_wrong_indices (all incorrect options).
--   Client never receives correct_index before submitting its own answer.
--
-- DO NOT APPLY without corresponding client changes in:
--   js/battles/matchmaking.js  — startBotDuel() must call start_virtual_battle_session
--   js/battles/friend-battle.js — pickDuel() / duelExpire() must call
--                                  submit_virtual_battle_answer, not use q.c locally
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

  -- Idempotency guard: if questions already assigned, reject
  IF EXISTS (SELECT 1 FROM session_questions WHERE session_id = p_game_session_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_assigned');
  END IF;

  -- Assign one question per progression slot [2,3,4,5,6]
  FOR v_pos IN 0..4 LOOP
    v_opt_count := progression[v_pos + 1];

    SELECT q.id,
           q.question_text,
           COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb),
           COALESCE(q.category, 'GENERAL')
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status = 'published'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = v_opt_count
      AND q.correct_index < jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
      AND q.id <> ALL(v_qids)
    ORDER BY random()
    LIMIT 1;

    IF v_q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'reason',          'not_enough_questions',
        'missing_opt_count', v_opt_count
      );
    END IF;

    v_qids := v_qids || v_q_id;

    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (p_game_session_id, v_q_id, v_pos)
    RETURNING id INTO v_sq_id;

    -- Build question payload: no correct_index, no question_id
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
-- Returns correct_index only AFTER writing the answer to session_questions.
-- Also returns bot_wrong_indices so the client can animate a wrong bot choice
-- without having had access to correct_index before submission.
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
  v_user_id     uuid := auth.uid();
  v_session_id  uuid;
  v_question_id uuid;
  v_correct_idx int;
  v_answers     jsonb;
  v_n           int;
  v_is_correct  bool;
  v_wrong_idxs  int[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Validate sq_id: must belong to caller's virtual_battle session, unanswered
  SELECT sq.session_id, sq.question_id
  INTO v_session_id, v_question_id
  FROM session_questions sq
  JOIN game_sessions gs ON gs.id = sq.session_id
  WHERE sq.id = p_sq_id
    AND gs.user_id = v_user_id
    AND gs.mode = 'virtual_battle'
    AND sq.selected_idx IS NULL;  -- no re-submission

  IF v_session_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sq_not_found_or_already_answered');
  END IF;

  -- Read correct_index server-side (column-level REVOKE blocks client reads)
  SELECT q.correct_index,
         COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)
  INTO v_correct_idx, v_answers
  FROM questions q
  WHERE q.id = v_question_id;

  v_n := jsonb_array_length(v_answers);
  v_is_correct := (p_selected_idx = v_correct_idx);

  -- Persist atomically: answer is now locked, correct_index is safe to return
  UPDATE session_questions
  SET selected_idx = p_selected_idx,
      is_correct   = v_is_correct,
      answered_at  = now()
  WHERE id = p_sq_id;

  -- All indices that are NOT the correct answer (for bot wrong-answer animation)
  SELECT array_agg(s.i ORDER BY s.i)
  INTO v_wrong_idxs
  FROM generate_series(0, v_n - 1) AS s(i)
  WHERE s.i <> v_correct_idx;

  RETURN jsonb_build_object(
    'ok',               true,
    'is_correct',       v_is_correct,
    'correct_index',    v_correct_idx,
    'n_answers',        v_n,
    'bot_wrong_indices', to_jsonb(v_wrong_idxs)
  );
END;
$$;

-- Permissions: authenticated only; anon and public cannot call these
REVOKE ALL ON FUNCTION public.start_virtual_battle_session(uuid)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_virtual_battle_session(uuid)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.submit_virtual_battle_answer(uuid, int)  TO authenticated;

COMMIT;
