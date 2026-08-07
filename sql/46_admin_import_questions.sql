-- ══════════════════════════════════════════════════════════════════
-- Migration 46: admin_import_questions RPC
-- Принимает JSON-массив вопросов, вставляет со status=NULL (На сортировку)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_import_questions(p_questions jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
  v_item  jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_questions)
  LOOP
    INSERT INTO questions (
      question_ru,
      question_text,
      answers_json,
      correct_index,
      category,
      source_type,
      status
    ) VALUES (
      v_item->>'question',
      v_item->>'question',
      v_item->'answers',
      (v_item->>'correct')::int,
      COALESCE(v_item->>'category', 'GENERAL'),
      'manual_import',
      NULL  -- попадает в "На сортировку"
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'imported', v_count);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_import_questions(jsonb) TO authenticated;
