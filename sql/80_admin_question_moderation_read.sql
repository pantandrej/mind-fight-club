-- ══════════════════════════════════════════════════════════════════════
-- Migration 80: Admin-only question moderation read RPC
-- DRAFT — DO NOT APPLY until explicitly instructed.
--
-- Root cause addressed:
--   PostgREST checks has_table_privilege(role,'questions','SELECT') before
--   serving REST queries. authenticated has no table-level SELECT on questions
--   (correct: protects correct_index and is_competitive_secret). Column-level
--   SELECT grants on safe columns are invisible to PostgREST's access gate.
--   All sb.from('questions').select(...) calls therefore fail with
--   "permission denied for table questions".
--
-- Fix:
--   One SECURITY DEFINER RPC that bypasses the column/table restriction
--   server-side, performs the admin gate check, and returns ONLY the columns
--   needed for moderation — including correct_index — while EXCLUDING
--   is_competitive_secret rows from the public moderation list.
--
-- Provides:
--   admin_get_questions_for_moderation(p_status, p_offset, p_limit)
--     Returns { ok, rows:[...], total } for pending or active filter.
--     Handles pending (status IS NULL OR 'pending') in one query.
--
-- Security model:
--   - auth.uid() must be in admin_users WHERE is_active = true
--   - SECURITY DEFINER / SET search_path = public
--   - REVOKE ALL FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated (admin gate is inside the body)
--   - Never returns is_competitive_secret = true rows
--   - Never returns is_competitive_secret column itself
--
-- No changes to migrations 74–79, triggers, RLS policies, or table grants.
-- DO NOT include GRANT SELECT ON questions TO authenticated.
-- ══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_get_questions_for_moderation(
  p_status  text DEFAULT 'pending',   -- 'pending' | 'active'
  p_offset  int  DEFAULT 0,
  p_limit   int  DEFAULT 5000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_rows  jsonb;
  v_total bigint := 0;
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

  -- ── Clamp limit ──────────────────────────────────────────────────
  p_limit  := GREATEST(1, LEAST(p_limit,  5000));
  p_offset := GREATEST(0, p_offset);

  IF p_status = 'active' THEN
    -- ── Active (approved) questions ──────────────────────────────
    SELECT COUNT(*) INTO v_total
    FROM questions
    WHERE status = 'active'
      AND is_competitive_secret = false;

    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT
        id, question_text, question_ru,
        answers_json, answers_ru, correct_index,
        status, category, source_type, approved_at,
        import_key, explanation_ru,
        image_url, audio_url, video_url,
        media_type, media_filename,
        render_mode, question_scope, question_type, media_required
      FROM questions
      WHERE status = 'active'
        AND is_competitive_secret = false
      ORDER BY approved_at DESC NULLS LAST
      LIMIT  p_limit
      OFFSET p_offset
    ) t;

  ELSE
    -- ── Pending / unsorted: status IS NULL OR 'pending', not official_pack
    SELECT COUNT(*) INTO v_total
    FROM questions
    WHERE (status IS NULL OR status = 'pending')
      AND source_type <> 'official_pack'
      AND is_competitive_secret = false;

    SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT
        id, question_text, question_ru,
        answers_json, answers_ru, correct_index,
        status, category, source_type, approved_at,
        import_key, explanation_ru,
        image_url, audio_url, video_url,
        media_type, media_filename,
        render_mode, question_scope, question_type, media_required
      FROM questions
      WHERE (status IS NULL OR status = 'pending')
        AND source_type <> 'official_pack'
        AND is_competitive_secret = false
      ORDER BY id DESC
      LIMIT  p_limit
      OFFSET p_offset
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'ok',    true,
    'rows',  COALESCE(v_rows, '[]'::jsonb),
    'total', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_get_questions_for_moderation(text, int, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_questions_for_moderation(text, int, int) FROM anon;
GRANT  EXECUTE ON FUNCTION admin_get_questions_for_moderation(text, int, int) TO authenticated;
