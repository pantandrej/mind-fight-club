-- ══════════════════════════════════════════════════════════════════════
-- Migration 80: Admin-only question read RPCs
-- DRAFT — DO NOT APPLY until explicitly instructed.
--
-- Root cause:
--   authenticated has column-level SELECT on 27 safe questions columns,
--   but NOT on correct_index or is_competitive_secret.
--   select('*') and any query that touches revoked columns fails with
--   "permission denied". GRANT SELECT ON questions TO authenticated would
--   be additive and override column-level REVOKEs — rejected.
--
-- Fix: two SECURITY DEFINER admin-only RPCs that bypass column restrictions
--   server-side after a canonical admin_users gate check.
--
-- ── RPC 1 ────────────────────────────────────────────────────────────
--   admin_get_questions_for_moderation(p_status, p_offset, p_limit)
--   Used by: js/q-moderation.js (Модерация вопросов screen)
--   Returns: { ok, rows:[...], total }
--   Modes: 'pending' (status IS NULL or 'pending') | 'active'
--
-- ── RPC 2 ────────────────────────────────────────────────────────────
--   admin_get_questions_for_tester(p_mode, p_key, p_limit)
--   Used by: js/legacy.js Tester + "Все вопросы" admin overlay
--   Returns: { ok, rows:[...], pack_title?, empty? }
--   Modes: general | community | import | pack | fix | overlay
--
-- Security model (both RPCs):
--   - auth.uid() must be in admin_users WHERE is_active = true
--   - SECURITY DEFINER / SET search_path = public
--   - REVOKE ALL FROM PUBLIC, anon
--   - GRANT EXECUTE TO authenticated (admin gate inside body)
--   - Never returns is_competitive_secret = true rows
--   - Never returns is_competitive_secret column itself
--   - correct_index is safe to return because admin gate is enforced
--
-- No changes to migrations 74–79, triggers, RLS policies, or table grants.
-- DO NOT include GRANT SELECT ON questions TO authenticated.
-- ══════════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- RPC 1: admin_get_questions_for_moderation
-- ════════════════════════════════════════════════════════════════

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

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
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

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
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

-- ════════════════════════════════════════════════════════════════
-- RPC 2: admin_get_questions_for_tester
-- ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION admin_get_questions_for_tester(
  p_mode   text,
  p_key    text DEFAULT NULL,
  p_limit  int  DEFAULT 500
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid    := auth.uid();
  v_rows        jsonb;
  v_pack_id     uuid;
  v_pack_title  text;
  v_pack_prefix text;
  v_import_keys text[];
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
  p_limit := GREATEST(1, LEAST(p_limit, 5000));

  -- ── Validate mode ────────────────────────────────────────────────
  IF p_mode NOT IN ('general','community','import','pack','fix','overlay') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_mode');
  END IF;

  -- ════════════════════════════════════════════════════════════════
  IF p_mode = 'general' THEN
  -- ════════════════════════════════════════════════════════════════
    -- official_general + official_pack MC questions, non-archived, no legacy game_% keys
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             status, category, source_type, approved_at,
             import_key, explanation_ru,
             image_url, audio_url, video_url,
             media_type, media_filename,
             render_mode, question_scope, question_type, media_required, created_at
      FROM questions
      WHERE source_type IN ('official_general', 'official_pack')
        AND question_type = 'multiple_choice'
        AND status NOT IN ('archived_unsupported', 'needs_reimport', 'archived')
        AND import_key NOT LIKE 'game_%'
        AND is_competitive_secret = false
      ORDER BY import_key
      LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));

  -- ════════════════════════════════════════════════════════════════
  ELSIF p_mode = 'community' THEN
  -- ════════════════════════════════════════════════════════════════
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             status, category, source_type, approved_at,
             import_key, explanation_ru,
             image_url, audio_url, video_url,
             media_type, media_filename,
             render_mode, question_scope, question_type, media_required, created_at
      FROM questions
      WHERE source_type = 'community'
        AND question_type = 'multiple_choice'
        AND status NOT IN ('archived_unsupported', 'needs_reimport', 'archived')
        AND is_competitive_secret = false
      ORDER BY created_at DESC
      LIMIT LEAST(p_limit, 200)
    ) t;
    RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));

  -- ════════════════════════════════════════════════════════════════
  ELSIF p_mode = 'import' THEN
  -- ════════════════════════════════════════════════════════════════
    IF p_key IS NULL OR trim(p_key) = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'p_key_required');
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             status, category, source_type, approved_at,
             import_key, explanation_ru,
             image_url, audio_url, video_url,
             media_type, media_filename,
             render_mode, question_scope, question_type, media_required, created_at
      FROM questions
      WHERE import_key LIKE (p_key || '_q%')
        AND question_type = 'multiple_choice'
        AND is_competitive_secret = false
      ORDER BY import_key
      LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));

  -- ════════════════════════════════════════════════════════════════
  ELSIF p_mode = 'pack' THEN
  -- ════════════════════════════════════════════════════════════════
    IF p_key IS NULL OR trim(p_key) = '' THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'p_key_required');
    END IF;

    -- Resolve pack by import_key
    SELECT id, title_ru INTO v_pack_id, v_pack_title
    FROM game_packs WHERE import_key = p_key;

    IF v_pack_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'pack_not_found');
    END IF;

    -- Try linked questions ordered by position
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT q.id, q.question_text, q.question_ru,
             q.answers_json, q.answers_ru, q.correct_index,
             q.status, q.category, q.source_type, q.approved_at,
             q.import_key, q.explanation_ru,
             q.image_url, q.audio_url, q.video_url,
             q.media_type, q.media_filename,
             q.render_mode, q.question_scope, q.question_type, q.media_required, q.created_at,
             gpq.position AS pack_position
      FROM questions q
      JOIN game_pack_questions gpq
        ON gpq.question_id = q.id AND gpq.game_pack_id = v_pack_id
      WHERE q.is_competitive_secret = false
        AND q.question_type = 'multiple_choice'
        AND q.status NOT IN ('archived_unsupported', 'needs_reimport', 'archived')
      ORDER BY gpq.position
      LIMIT p_limit
    ) t;

    -- Return linked rows if found
    IF jsonb_array_length(COALESCE(v_rows, '[]'::jsonb)) > 0 THEN
      RETURN jsonb_build_object(
        'ok', true, 'rows', v_rows,
        'pack_title', v_pack_title,
        'linked', true
      );
    END IF;

    -- Fallback: import_key prefix (strip 'game_' prefix used in pack import keys)
    v_pack_prefix := replace(p_key, 'game_', '');

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             status, category, source_type, approved_at,
             import_key, explanation_ru,
             image_url, audio_url, video_url,
             media_type, media_filename,
             render_mode, question_scope, question_type, media_required, created_at,
             NULL::int AS pack_position
      FROM questions
      WHERE import_key LIKE (v_pack_prefix || '_q%')
        AND question_type = 'multiple_choice'
        AND status NOT IN ('archived_unsupported', 'needs_reimport', 'archived')
        AND is_competitive_secret = false
      ORDER BY import_key
      LIMIT p_limit
    ) t;

    RETURN jsonb_build_object(
      'ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb),
      'pack_title', v_pack_title,
      'linked', false
    );

  -- ════════════════════════════════════════════════════════════════
  ELSIF p_mode = 'fix' THEN
  -- ════════════════════════════════════════════════════════════════
    -- Derive import_keys from question_reviews server-side (no direct questions read needed)
    SELECT ARRAY(
      SELECT DISTINCT qr.import_key
      FROM question_reviews qr
      WHERE qr.verdict IN ('fix', 'bad')
        AND qr.import_key IS NOT NULL
    ) INTO v_import_keys;

    IF array_length(v_import_keys, 1) IS NULL THEN
      RETURN jsonb_build_object('ok', true, 'rows', '[]'::jsonb, 'empty', true);
    END IF;

    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             status, category, source_type, approved_at,
             import_key, explanation_ru,
             image_url, audio_url, video_url,
             media_type, media_filename,
             render_mode, question_scope, question_type, media_required, created_at
      FROM questions
      WHERE import_key = ANY(v_import_keys)
        AND is_competitive_secret = false
      ORDER BY import_key
      LIMIT p_limit
    ) t;
    RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));

  -- ════════════════════════════════════════════════════════════════
  ELSIF p_mode = 'overlay' THEN
  -- ════════════════════════════════════════════════════════════════
    -- "Все вопросы" admin overlay — all non-official_pack questions, for client-side filtering
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
    INTO   v_rows
    FROM (
      SELECT id, question_text, question_ru,
             answers_json, answers_ru, correct_index,
             category, status, source_type, import_key,
             media_type, image_url, audio_url, video_url,
             explanation_ru, created_at
      FROM questions
      WHERE source_type NOT LIKE 'official_pack'
        AND is_competitive_secret = false
      ORDER BY created_at DESC
      LIMIT LEAST(p_limit, 2000)
    ) t;
    RETURN jsonb_build_object('ok', true, 'rows', COALESCE(v_rows, '[]'::jsonb));

  END IF;

  -- Unreachable; mode validated above
  RETURN jsonb_build_object('ok', false, 'reason', 'unknown_mode');
END;
$$;

REVOKE ALL ON FUNCTION admin_get_questions_for_tester(text, text, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION admin_get_questions_for_tester(text, text, int) FROM anon;
GRANT  EXECUTE ON FUNCTION admin_get_questions_for_tester(text, text, int) TO authenticated;
