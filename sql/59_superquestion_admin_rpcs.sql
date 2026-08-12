-- ══════════════════════════════════════════════════════════════════
-- Migration 59: Admin RPCs for superquestion moderation
-- Bypasses RLS via SECURITY DEFINER so admins can approve/reject/date
-- ══════════════════════════════════════════════════════════════════

-- Одобрить супервопрос
CREATE OR REPLACE FUNCTION admin_approve_superquestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() NOT IN ('mysliklub@gmail.com') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  UPDATE quiz_daily_questions
  SET status = 'approved', approved_at = now()
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Отклонить супервопрос
CREATE OR REPLACE FUNCTION admin_reject_superquestion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() NOT IN ('mysliklub@gmail.com') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  UPDATE quiz_daily_questions
  SET status = 'rejected'
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Поставить дату показа супервопроса
CREATE OR REPLACE FUNCTION admin_set_superquestion_date(p_id uuid, p_date date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.email() NOT IN ('mysliklub@gmail.com') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;

  UPDATE quiz_daily_questions
  SET scheduled_date = p_date
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
