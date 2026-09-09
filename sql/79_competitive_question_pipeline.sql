-- ══════════════════════════════════════════════════════════════════════
-- Migration 79: Competitive-secret question pipeline
-- DRAFT — DO NOT APPLY until explicitly instructed.
--
-- Provides three admin-only SECURITY DEFINER RPCs:
--   create_competitive_question   — single question, born is_competitive_secret=true
--   bulk_import_competitive       — JSON array import, row-level results
--   admin_count_competitive       — counts by answer-count for dashboard
--
-- Security model (all three RPCs):
--   - auth.uid() must be in admin_users WHERE is_active = true
--   - SECURITY DEFINER / SET search_path = public (bypass RLS to INSERT)
--   - REVOKE ALL FROM PUBLIC, anon
--   - GRANT authenticated only (admin check is inside the function body)
--   - Client cannot supply is_competitive_secret — server forces true
--   - Client cannot supply user_id — server ignores it
--
-- No changes to migrations 74–78, triggers, or RLS policies.
-- ══════════════════════════════════════════════════════════════════════

-- ── Helper: inline admin check (same table/pattern as migration 44) ──
-- Not a separate function to avoid polluting public namespace.
-- Each RPC inlines the EXISTS check against admin_users.

-- ══════════════════════════════════════════════════════════════════════
-- 1. create_competitive_question
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION create_competitive_question(
  p_question_text text,
  p_answers       jsonb,       -- json array of strings, length 2–6
  p_correct_index int,
  p_category      text DEFAULT 'GENERAL',
  p_explanation   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_len       int;
  v_answer    text;
  v_answers   text[];
  v_seen      text[];
  v_new_id    uuid;
  v_norm_text text;
BEGIN
  -- ── Auth check ───────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = v_uid AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  -- ── Validate question text ────────────────────────────────────────
  IF p_question_text IS NULL OR length(trim(p_question_text)) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_too_short',
      'detail', 'question_text must be at least 3 characters');
  END IF;

  -- ── Validate answers array ────────────────────────────────────────
  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'answers_not_array');
  END IF;

  v_len := jsonb_array_length(p_answers);
  IF v_len < 2 OR v_len > 6 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'answers_count_invalid',
      'detail', 'answers must have 2–6 elements, got ' || v_len);
  END IF;

  -- Check each answer: non-empty, no whitespace-only, no duplicates
  v_seen := ARRAY[]::text[];
  FOR i IN 0 .. v_len - 1 LOOP
    v_answer := trim(p_answers->>i);
    IF v_answer IS NULL OR length(v_answer) = 0 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'empty_answer',
        'detail', 'answer at index ' || i || ' is empty');
    END IF;
    IF v_answer = ANY(v_seen) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_answer',
        'detail', 'answer "' || v_answer || '" appears more than once');
    END IF;
    v_seen := array_append(v_seen, v_answer);
  END LOOP;

  -- ── Validate correct_index ────────────────────────────────────────
  IF p_correct_index IS NULL OR p_correct_index < 0 OR p_correct_index >= v_len THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'correct_index_invalid',
      'detail', 'correct_index must be 0–' || (v_len - 1) || ', got ' || COALESCE(p_correct_index::text, 'null'));
  END IF;

  -- ── Duplicate detection (normalized text equality) ────────────────
  v_norm_text := lower(trim(p_question_text));
  IF EXISTS (
    SELECT 1 FROM questions
    WHERE lower(trim(COALESCE(question_ru, question_text, ''))) = v_norm_text
      AND is_competitive_secret = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duplicate_question',
      'detail', 'a competitive-secret question with this text already exists');
  END IF;

  -- ── Rebuild answers array with trimmed values ─────────────────────
  SELECT jsonb_agg(trim(elem::text, '"'))
  INTO   p_answers
  FROM   jsonb_array_elements_text(p_answers) AS elem;

  -- ── INSERT — server forces is_competitive_secret = true ──────────
  INSERT INTO questions (
    question_text,
    question_ru,
    answers_ru,
    correct_index,
    category,
    explanation_ru,
    question_type,
    source_type,
    status,
    is_competitive_secret
  ) VALUES (
    trim(p_question_text),
    trim(p_question_text),
    p_answers,
    p_correct_index,
    COALESCE(upper(trim(p_category)), 'GENERAL'),
    p_explanation,
    'multiple_choice',
    'competitive',
    'active',
    true              -- born secret; cannot be overridden by client
  )
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'ok',       true,
    'id',       v_new_id,
    'answers',  p_answers,
    'opt_count', v_len
  );
END;
$$;

REVOKE ALL ON FUNCTION create_competitive_question(text, jsonb, int, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION create_competitive_question(text, jsonb, int, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION create_competitive_question(text, jsonb, int, text, text) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 2. bulk_import_competitive
-- ══════════════════════════════════════════════════════════════════════
-- Accepts a JSON array of question objects:
--   [{ "question_text": "...", "answers": ["A","B","C"], "correct_index": 0,
--      "category": "SCIENCE", "explanation": "optional" }, ...]
--
-- Returns: { ok, inserted, rejected, errors: [{row, reason, detail}] }
-- Atomicity: partial success — valid rows inserted, invalid rows reported.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION bulk_import_competitive(p_questions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_total      int;
  v_inserted   int := 0;
  v_rejected   int := 0;
  v_errors     jsonb := '[]'::jsonb;
  v_item       jsonb;
  v_idx        int := 0;
  v_result     jsonb;
  v_qtext      text;
  v_answers    jsonb;
  v_correct    int;
  v_category   text;
  v_expl       text;
  v_len        int;
  v_answer     text;
  v_seen       text[];
  v_norm_text  text;
  v_new_id     uuid;
BEGIN
  -- ── Auth check ───────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = v_uid AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  IF p_questions IS NULL OR jsonb_typeof(p_questions) <> 'array' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'input_not_array');
  END IF;

  v_total := jsonb_array_length(p_questions);
  IF v_total = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'empty_array');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_questions) LOOP
    v_idx := v_idx + 1;

    -- Extract fields
    v_qtext    := trim(COALESCE(v_item->>'question_text', v_item->>'question', ''));
    v_answers  := v_item->'answers';
    v_correct  := (v_item->>'correct_index')::int;
    v_category := COALESCE(upper(trim(v_item->>'category')), 'GENERAL');
    v_expl     := v_item->>'explanation';

    -- Validate question text
    IF length(v_qtext) < 3 THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'question_too_short', 'detail', left(v_qtext,50));
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- Validate answers
    IF v_answers IS NULL OR jsonb_typeof(v_answers) <> 'array' THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'answers_not_array');
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    v_len := jsonb_array_length(v_answers);
    IF v_len < 2 OR v_len > 6 THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'answers_count_invalid', 'detail', v_len);
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- Check empty / duplicate answers
    v_seen := ARRAY[]::text[];
    DECLARE v_bad bool := false;
    BEGIN
      FOR i IN 0 .. v_len - 1 LOOP
        v_answer := trim(v_answers->>i);
        IF v_answer IS NULL OR length(v_answer) = 0 THEN
          v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'empty_answer', 'detail', 'index ' || i);
          v_rejected := v_rejected + 1;
          v_bad := true;
          EXIT;
        END IF;
        IF v_answer = ANY(v_seen) THEN
          v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'duplicate_answer', 'detail', v_answer);
          v_rejected := v_rejected + 1;
          v_bad := true;
          EXIT;
        END IF;
        v_seen := array_append(v_seen, v_answer);
      END LOOP;
      IF v_bad THEN CONTINUE; END IF;
    END;

    -- Validate correct_index
    IF v_correct IS NULL OR v_correct < 0 OR v_correct >= v_len THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'correct_index_invalid', 'detail', v_correct);
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- Duplicate check
    v_norm_text := lower(v_qtext);
    IF EXISTS (
      SELECT 1 FROM questions
      WHERE lower(trim(COALESCE(question_ru, question_text, ''))) = v_norm_text
        AND is_competitive_secret = true
    ) THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'duplicate_question', 'detail', left(v_qtext, 60));
      v_rejected := v_rejected + 1;
      CONTINUE;
    END IF;

    -- Rebuild trimmed answers
    SELECT jsonb_agg(trim(elem::text, '"'))
    INTO   v_answers
    FROM   jsonb_array_elements_text(v_answers) AS elem;

    -- INSERT
    BEGIN
      INSERT INTO questions (
        question_text, question_ru, answers_ru, correct_index,
        category, explanation_ru, question_type, source_type,
        status, is_competitive_secret
      ) VALUES (
        v_qtext, v_qtext, v_answers, v_correct,
        v_category, v_expl, 'multiple_choice', 'competitive',
        'active', true
      )
      RETURNING id INTO v_new_id;
      v_inserted := v_inserted + 1;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('row', v_idx, 'reason', 'insert_error', 'detail', SQLERRM);
      v_rejected := v_rejected + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',       true,
    'total',    v_total,
    'inserted', v_inserted,
    'rejected', v_rejected,
    'errors',   v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION bulk_import_competitive(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION bulk_import_competitive(jsonb) FROM anon;
GRANT  EXECUTE ON FUNCTION bulk_import_competitive(jsonb) TO authenticated;


-- ══════════════════════════════════════════════════════════════════════
-- 3. admin_count_competitive
-- ══════════════════════════════════════════════════════════════════════
-- Returns counts by answer-count (2–6) for admin dashboard.
-- Runs as SECURITY DEFINER to bypass the RESTRICTIVE RLS policy
-- that hides is_competitive_secret=true rows from authenticated users.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_count_competitive()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rec  record;
  v_out  jsonb := '{}'::jsonb;
  v_total int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM admin_users WHERE user_id = v_uid AND is_active = true
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  FOR v_rec IN
    SELECT
      jsonb_array_length(COALESCE(answers_ru, answers_json, '[]'::jsonb)) AS opt_count,
      COUNT(*) AS cnt
    FROM   questions
    WHERE  is_competitive_secret = true
      AND  status = 'active'
      AND  question_type = 'multiple_choice'
    GROUP  BY opt_count
    ORDER  BY opt_count
  LOOP
    v_out   := v_out || jsonb_build_object(v_rec.opt_count::text, v_rec.cnt);
    v_total := v_total + v_rec.cnt;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',     true,
    'counts', v_out,
    'total',  v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_count_competitive() FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_count_competitive() FROM anon;
GRANT  EXECUTE ON FUNCTION admin_count_competitive() TO authenticated;
