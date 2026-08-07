-- ══════════════════════════════════════════════════════════════════
-- Migration 45: admin_update_question RPC
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_update_question(
  p_id      uuid,
  p_text    text,
  p_answers jsonb,
  p_correct int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  UPDATE questions
  SET
    question_ru   = p_text,
    question_text = p_text,
    answers_json  = p_answers,
    correct_index = p_correct
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_update_question(uuid, text, jsonb, int) TO authenticated;
