-- ══════════════════════════════════════════════════════════════════
-- Migration 44: Question moderation RPCs (admin only)
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_approve_question(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  UPDATE questions SET status = 'active' WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_approve_question(uuid) TO authenticated;


CREATE OR REPLACE FUNCTION admin_delete_question(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  DELETE FROM questions WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION admin_delete_question(uuid) TO authenticated;
