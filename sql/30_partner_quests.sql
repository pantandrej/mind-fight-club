-- ── Migration 30: Partner Quests ─────────────────────────────────
-- Brands reward players with Neurons for online/offline activities.
-- Quest types: 'geo_qr' (scan QR at venue), 'social_click' (follow/share),
--              'sponsored_quiz' (complete branded quiz pack)

-- ── Table: partner_quests ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS partner_quests (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id            uuid        NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  title               text        NOT NULL,
  description         text,
  reward_neurons      int         NOT NULL CHECK (reward_neurons > 0),
  quest_type          text        NOT NULL
    CHECK (quest_type IN ('geo_qr', 'social_click', 'sponsored_quiz')),
  -- Stored as bcrypt hash — never expose raw secret to clients
  verification_secret text,
  is_active           boolean     NOT NULL DEFAULT true,
  expires_at          timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pq_brand    ON partner_quests(brand_id);
CREATE INDEX IF NOT EXISTS idx_pq_active   ON partner_quests(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_pq_type     ON partner_quests(quest_type);

ALTER TABLE partner_quests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pq_public_read"       ON partner_quests;
DROP POLICY IF EXISTS "pq_brand_owner_write" ON partner_quests;

-- Public can read active, non-expired quests
CREATE POLICY "pq_public_read"
  ON partner_quests FOR SELECT
  USING (
    is_active = true
    AND (expires_at IS NULL OR expires_at > now())
  );

-- Brand owners can manage their own quests
CREATE POLICY "pq_brand_owner_write"
  ON partner_quests FOR ALL
  USING  (brand_id IN (SELECT id FROM brand_profiles WHERE owner_id = auth.uid()))
  WITH CHECK (brand_id IN (SELECT id FROM brand_profiles WHERE owner_id = auth.uid()));

-- ── Table: partner_quest_completions ─────────────────────────────
CREATE TABLE IF NOT EXISTS partner_quest_completions (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  quest_id   uuid        NOT NULL REFERENCES partner_quests(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pqc_unique_user_quest UNIQUE (user_id, quest_id)
);

CREATE INDEX IF NOT EXISTS idx_pqc_user  ON partner_quest_completions(user_id);
CREATE INDEX IF NOT EXISTS idx_pqc_quest ON partner_quest_completions(quest_id);

ALTER TABLE partner_quest_completions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pqc_user_read"        ON partner_quest_completions;
DROP POLICY IF EXISTS "pqc_no_direct_write"  ON partner_quest_completions;

-- Users can only read their own completions
CREATE POLICY "pqc_user_read"
  ON partner_quest_completions FOR SELECT
  USING (auth.uid() = user_id);

-- Only RPC (SECURITY DEFINER) may insert — no direct client writes
CREATE POLICY "pqc_no_direct_write"
  ON partner_quest_completions FOR INSERT
  WITH CHECK (false);

-- ── RPC: complete_partner_quest ───────────────────────────────────
-- Validates quest, checks secret, awards neurons atomically.
-- Returns: { ok, reason, neurons_awarded }
CREATE OR REPLACE FUNCTION complete_partner_quest(
  p_quest_id uuid,
  p_secret   text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid    uuid := auth.uid();
  v_quest  partner_quests%ROWTYPE;
  v_op_key text;
BEGIN
  -- Must be authenticated
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Lock quest row for update to prevent race conditions
  SELECT * INTO v_quest
  FROM partner_quests
  WHERE id = p_quest_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quest_not_found');
  END IF;

  -- Check quest is active
  IF NOT v_quest.is_active THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quest_inactive');
  END IF;

  -- Check expiry
  IF v_quest.expires_at IS NOT NULL AND v_quest.expires_at <= now() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'quest_expired');
  END IF;

  -- Verify secret for QR-based quests
  -- For geo_qr: p_secret must match verification_secret (plain compare for MVP;
  -- upgrade to crypt(p_secret, verification_secret) = verification_secret with pgcrypto)
  IF v_quest.quest_type = 'geo_qr' AND v_quest.verification_secret IS NOT NULL THEN
    IF p_secret IS NULL OR p_secret <> v_quest.verification_secret THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'invalid_secret');
    END IF;
  END IF;

  -- Idempotency key: one award per user per quest
  v_op_key := 'partner_quest:' || p_quest_id::text || ':' || v_uid::text;

  -- Try to record completion — UNIQUE constraint prevents duplicates
  BEGIN
    INSERT INTO partner_quest_completions (user_id, quest_id)
    VALUES (v_uid, p_quest_id);
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_completed');
  END;

  -- Award neurons via currency_ledger (idempotent — UNIQUE(user_id, operation_key))
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_uid, 'partner_quest', v_op_key, v_quest.reward_neurons, 0)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  -- Update profile balance only if ledger row was actually inserted (not a duplicate)
  IF FOUND THEN
    UPDATE profiles
    SET neurons = neurons + v_quest.reward_neurons
    WHERE id = v_uid;
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'neurons_awarded', v_quest.reward_neurons,
    'quest_title',    v_quest.title
  );
END;$$;

GRANT EXECUTE ON FUNCTION complete_partner_quest(uuid, text) TO authenticated;

-- ── RPC: get_brand_quests(p_brand_id) ────────────────────────────
-- Returns active quests for a brand page, with completion status for current user.
CREATE OR REPLACE FUNCTION get_brand_quests(p_brand_id uuid)
RETURNS TABLE (
  id              uuid,
  title           text,
  description     text,
  reward_neurons  int,
  quest_type      text,
  expires_at      timestamptz,
  completed       boolean
) LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    q.id,
    q.title,
    q.description,
    q.reward_neurons,
    q.quest_type,
    q.expires_at,
    (c.id IS NOT NULL) AS completed
  FROM partner_quests q
  LEFT JOIN partner_quest_completions c
    ON c.quest_id = q.id AND c.user_id = auth.uid()
  WHERE q.brand_id   = p_brand_id
    AND q.is_active  = true
    AND (q.expires_at IS NULL OR q.expires_at > now())
  ORDER BY q.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_brand_quests(uuid) TO authenticated, anon;

-- ── NOTE on secret hashing ────────────────────────────────────────
-- For production QR codes, enable pgcrypto extension and store secrets as:
--   UPDATE partner_quests SET verification_secret = crypt('RAW_SECRET', gen_salt('bf'))
--   WHERE id = '...';
-- Then change the verification check to:
--   crypt(p_secret, v_quest.verification_secret) = v_quest.verification_secret
