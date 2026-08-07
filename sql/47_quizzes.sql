-- ══════════════════════════════════════════════════════════════════
-- Migration 47: Quizzes (bar quiz venue pages)
-- ══════════════════════════════════════════════════════════════════

-- Storage bucket for logos and answer images
INSERT INTO storage.buckets (id, name, public)
VALUES ('quiz-media', 'quiz-media', true)
ON CONFLICT (id) DO NOTHING;

-- Allow authenticated users to upload to quiz-media
CREATE POLICY "quiz_media_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'quiz-media');

-- Allow public read
CREATE POLICY "quiz_media_public_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'quiz-media');

-- Allow owner to delete their uploads
CREATE POLICY "quiz_media_owner_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'quiz-media' AND auth.uid()::text = (storage.foldername(name))[1]);

-- ── Main table ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS quizzes (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name           text NOT NULL,
  slug           text UNIQUE NOT NULL,
  description    text,
  logo_url       text,
  website_url    text,
  social_links   jsonb DEFAULT '{}',   -- { vk, tg, instagram, youtube }
  newcomer_offer text,
  status         text DEFAULT 'pending', -- pending | active | rejected
  reject_reason  text,
  created_at     timestamptz DEFAULT now()
);

ALTER TABLE quizzes ENABLE ROW LEVEL SECURITY;

-- Public can read active quizzes
CREATE POLICY "quizzes_public_read" ON quizzes
  FOR SELECT USING (status = 'active');

-- Owner can read own quizzes (any status)
CREATE POLICY "quizzes_owner_read" ON quizzes
  FOR SELECT USING (auth.uid() = owner_id);

-- Authenticated users can create quizzes
CREATE POLICY "quizzes_insert" ON quizzes
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = owner_id);

-- ── RPCs ──────────────────────────────────────────────────────────

-- Create quiz (sets slug, status=pending)
CREATE OR REPLACE FUNCTION create_quiz(
  p_name           text,
  p_slug           text,
  p_description    text DEFAULT NULL,
  p_website_url    text DEFAULT NULL,
  p_social_links   jsonb DEFAULT '{}',
  p_newcomer_offer text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;
  -- Validate slug (letters, digits, hyphens only)
  IF p_slug !~ '^[a-z0-9\-]{2,50}$' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_slug');
  END IF;
  -- Check slug uniqueness
  IF EXISTS (SELECT 1 FROM quizzes WHERE slug = p_slug) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'slug_taken');
  END IF;

  INSERT INTO quizzes (owner_id, name, slug, description, website_url, social_links, newcomer_offer)
  VALUES (auth.uid(), p_name, p_slug, p_description, p_website_url, p_social_links, p_newcomer_offer)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;
GRANT EXECUTE ON FUNCTION create_quiz(text,text,text,text,jsonb,text) TO authenticated;


-- Update quiz (owner only, cannot change status)
CREATE OR REPLACE FUNCTION update_quiz(
  p_id             uuid,
  p_name           text,
  p_description    text DEFAULT NULL,
  p_website_url    text DEFAULT NULL,
  p_social_links   jsonb DEFAULT '{}',
  p_newcomer_offer text DEFAULT NULL,
  p_logo_url       text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_id AND owner_id = auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_owner');
  END IF;

  UPDATE quizzes SET
    name           = p_name,
    description    = p_description,
    website_url    = p_website_url,
    social_links   = p_social_links,
    newcomer_offer = p_newcomer_offer,
    logo_url       = COALESCE(p_logo_url, logo_url)
  WHERE id = p_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION update_quiz(uuid,text,text,text,jsonb,text,text) TO authenticated;


-- Set logo URL (called after storage upload)
CREATE OR REPLACE FUNCTION set_quiz_logo(p_id uuid, p_logo_url text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM quizzes WHERE id = p_id AND owner_id = auth.uid()) THEN
    IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
    END IF;
  END IF;
  UPDATE quizzes SET logo_url = p_logo_url WHERE id = p_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION set_quiz_logo(uuid,text) TO authenticated;


-- Get quiz by slug (public, no auth needed)
CREATE OR REPLACE FUNCTION get_quiz_by_slug(p_slug text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_quiz quizzes;
BEGIN
  SELECT * INTO v_quiz FROM quizzes WHERE slug = p_slug AND status = 'active';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  RETURN jsonb_build_object('ok', true, 'quiz', row_to_json(v_quiz));
END;
$$;
GRANT EXECUTE ON FUNCTION get_quiz_by_slug(text) TO anon, authenticated;


-- Admin: approve quiz
CREATE OR REPLACE FUNCTION admin_approve_quiz(p_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  UPDATE quizzes SET status = 'active', reject_reason = NULL WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_approve_quiz(uuid) TO authenticated;


-- Admin: reject quiz
CREATE OR REPLACE FUNCTION admin_reject_quiz(p_id uuid, p_reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  UPDATE quizzes SET status = 'rejected', reject_reason = p_reason WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_reject_quiz(uuid,text) TO authenticated;


-- Admin: get all quizzes
CREATE OR REPLACE FUNCTION admin_get_quizzes(p_status text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  RETURN jsonb_build_object('ok', true, 'quizzes', (
    SELECT jsonb_agg(row_to_json(q) ORDER BY q.created_at DESC)
    FROM quizzes q
    WHERE (p_status IS NULL OR q.status = p_status)
  ));
END;
$$;
GRANT EXECUTE ON FUNCTION admin_get_quizzes(text) TO authenticated;


-- Admin: update any quiz field
CREATE OR REPLACE FUNCTION admin_update_quiz(
  p_id             uuid,
  p_name           text DEFAULT NULL,
  p_description    text DEFAULT NULL,
  p_website_url    text DEFAULT NULL,
  p_social_links   jsonb DEFAULT NULL,
  p_newcomer_offer text DEFAULT NULL,
  p_logo_url       text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND is_active = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_admin');
  END IF;
  UPDATE quizzes SET
    name           = COALESCE(p_name, name),
    description    = COALESCE(p_description, description),
    website_url    = COALESCE(p_website_url, website_url),
    social_links   = COALESCE(p_social_links, social_links),
    newcomer_offer = COALESCE(p_newcomer_offer, newcomer_offer),
    logo_url       = COALESCE(p_logo_url, logo_url)
  WHERE id = p_id;
  RETURN jsonb_build_object('ok', FOUND);
END;
$$;
GRANT EXECUTE ON FUNCTION admin_update_quiz(uuid,text,text,text,jsonb,text,text) TO authenticated;
