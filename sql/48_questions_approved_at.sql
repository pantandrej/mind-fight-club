-- Migration 48: approved_at column for questions
ALTER TABLE questions ADD COLUMN IF NOT EXISTS approved_at timestamptz;

-- Обновить approve RPC — теперь ставит approved_at = now()
CREATE OR REPLACE FUNCTION admin_approve_question(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  UPDATE questions SET status = 'active', approved_at = now() WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;$$;
GRANT EXECUTE ON FUNCTION admin_approve_question(uuid) TO authenticated;

-- unapprove — сбрасывает approved_at
CREATE OR REPLACE FUNCTION admin_unapprove_question(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  UPDATE questions SET status = NULL, approved_at = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;$$;
GRANT EXECUTE ON FUNCTION admin_unapprove_question(uuid) TO authenticated;
