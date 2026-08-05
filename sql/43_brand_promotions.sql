-- ══════════════════════════════════════════════════════════════════
-- Migration 43: Brand Promotions (акции для страниц бизнесов)
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Таблица акций ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brand_promotions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id     uuid        NOT NULL REFERENCES public.brand_profiles(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  description  text,
  promo_code   text,               -- промокод (необязательно)
  discount_text text,              -- "10% скидка на напитки"
  image_url    text,
  cta_label    text,               -- текст кнопки: "Получить скидку", "Показать официанту"
  cta_url      text,               -- ссылка кнопки (необязательно)
  is_active    boolean     NOT NULL DEFAULT true,
  expires_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bp_brand  ON public.brand_promotions(brand_id);
CREATE INDEX IF NOT EXISTS idx_bp_active ON public.brand_promotions(is_active, expires_at);

ALTER TABLE public.brand_promotions ENABLE ROW LEVEL SECURITY;

-- Все видят активные акции
DROP POLICY IF EXISTS "bp_public_read"       ON public.brand_promotions;
CREATE POLICY "bp_public_read"
  ON public.brand_promotions FOR SELECT
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Владелец бренда управляет своими акциями
DROP POLICY IF EXISTS "bp_owner_write" ON public.brand_promotions;
CREATE POLICY "bp_owner_write"
  ON public.brand_promotions FOR ALL
  USING  (brand_id IN (SELECT id FROM public.brand_profiles WHERE owner_id = auth.uid()))
  WITH CHECK (brand_id IN (SELECT id FROM public.brand_profiles WHERE owner_id = auth.uid()));

-- Admins manage all
DROP POLICY IF EXISTS "bp_admin_all" ON public.brand_promotions;
CREATE POLICY "bp_admin_all"
  ON public.brand_promotions FOR ALL
  USING  (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true))
  WITH CHECK (EXISTS (SELECT 1 FROM public.admin_users WHERE user_id = auth.uid() AND is_active = true));


-- ── 2. RPC: добавить акцию (владелец или admin) ───────────────────
CREATE OR REPLACE FUNCTION upsert_brand_promotion(
  p_brand_id    uuid,
  p_id          uuid     DEFAULT NULL,
  p_title       text     DEFAULT '',
  p_description text     DEFAULT NULL,
  p_promo_code  text     DEFAULT NULL,
  p_discount    text     DEFAULT NULL,
  p_image_url   text     DEFAULT NULL,
  p_cta_label   text     DEFAULT NULL,
  p_cta_url     text     DEFAULT NULL,
  p_expires_at  timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_is_owner boolean;
  v_is_admin boolean;
  v_promo_id uuid;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT EXISTS(SELECT 1 FROM brand_profiles WHERE id = p_brand_id AND owner_id = v_user_id) INTO v_is_owner;
  SELECT EXISTS(SELECT 1 FROM admin_users WHERE user_id = v_user_id AND is_active = true)    INTO v_is_admin;

  IF NOT (v_is_owner OR v_is_admin) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorized');
  END IF;

  IF p_id IS NOT NULL THEN
    UPDATE brand_promotions SET
      title        = p_title,
      description  = p_description,
      promo_code   = p_promo_code,
      discount_text = p_discount,
      image_url    = p_image_url,
      cta_label    = p_cta_label,
      cta_url      = p_cta_url,
      expires_at   = p_expires_at
    WHERE id = p_id AND brand_id = p_brand_id
    RETURNING id INTO v_promo_id;
  ELSE
    INSERT INTO brand_promotions (brand_id, title, description, promo_code, discount_text, image_url, cta_label, cta_url, expires_at)
    VALUES (p_brand_id, p_title, p_description, p_promo_code, p_discount, p_image_url, p_cta_label, p_cta_url, p_expires_at)
    RETURNING id INTO v_promo_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'id', v_promo_id);
END;
$$;

GRANT EXECUTE ON FUNCTION upsert_brand_promotion(uuid,uuid,text,text,text,text,text,text,text,timestamptz) TO authenticated;


-- ── 3. RPC: удалить акцию ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION delete_brand_promotion(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  DELETE FROM brand_promotions
  WHERE id = p_id
    AND (
      brand_id IN (SELECT id FROM brand_profiles WHERE owner_id = v_user_id)
      OR EXISTS (SELECT 1 FROM admin_users WHERE user_id = v_user_id AND is_active = true)
    );

  RETURN jsonb_build_object('ok', FOUND);
END;
$$;

GRANT EXECUTE ON FUNCTION delete_brand_promotion(uuid) TO authenticated;
