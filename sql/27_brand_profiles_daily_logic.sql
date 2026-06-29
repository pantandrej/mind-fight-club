-- ── Migration 27: Brand Profiles + Daily Logic Question ─────────────

-- ── brand_profiles ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS brand_profiles (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  slug          text        NOT NULL UNIQUE,
  name          text        NOT NULL,
  logo_url      text,
  description   text,
  city          text,
  parent_id     uuid        REFERENCES brand_profiles(id) ON DELETE SET NULL,
  external_links jsonb      NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_brand_profiles_slug     ON brand_profiles(slug);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_parent   ON brand_profiles(parent_id);
CREATE INDEX IF NOT EXISTS idx_brand_profiles_owner    ON brand_profiles(owner_id);

ALTER TABLE brand_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "brand_profiles_public_read"
  ON brand_profiles FOR SELECT USING (true);

CREATE POLICY "brand_profiles_owner_write"
  ON brand_profiles FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ── Link official_tournaments to a brand ──────────────────────────
ALTER TABLE official_tournaments ADD COLUMN IF NOT EXISTS brand_id uuid REFERENCES brand_profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_ot_brand ON official_tournaments(brand_id);

-- ── daily_logic_questions ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logic_questions (
  id                 uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id           uuid  REFERENCES brand_profiles(id) ON DELETE SET NULL,
  question_text      text  NOT NULL,
  media_url          text,
  correct_answer_raw text  NOT NULL,
  explanation        text  NOT NULL,
  active_date        date  NOT NULL UNIQUE,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dlq_active_date ON daily_logic_questions(active_date DESC);

ALTER TABLE daily_logic_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_logic_questions_public_read"
  ON daily_logic_questions FOR SELECT USING (true);

CREATE POLICY "daily_logic_questions_admin_write"
  ON daily_logic_questions FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM brand_profiles bp
      WHERE bp.id = brand_id AND bp.owner_id = auth.uid()
    )
  );

-- ── daily_logic_attempts ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_logic_attempts (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  question_id uuid        NOT NULL REFERENCES daily_logic_questions(id) ON DELETE CASCADE,
  is_correct  boolean     NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_daily_attempt UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_dla_user    ON daily_logic_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_dla_question ON daily_logic_attempts(question_id);

ALTER TABLE daily_logic_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_logic_attempts_own_read"
  ON daily_logic_attempts FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "daily_logic_attempts_own_insert"
  ON daily_logic_attempts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- ── RPC: submit_daily_logic ───────────────────────────────────────
-- Awards 50 neurons server-side if correct. Idempotent via UNIQUE constraint.
CREATE OR REPLACE FUNCTION submit_daily_logic(
  p_question_id uuid,
  p_is_correct  boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_reward  int  := 50;
  v_op_key  text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Idempotency: already attempted?
  IF EXISTS (
    SELECT 1 FROM daily_logic_attempts
    WHERE user_id = v_uid AND question_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_attempted');
  END IF;

  -- Log the attempt
  INSERT INTO daily_logic_attempts (user_id, question_id, is_correct)
  VALUES (v_uid, p_question_id, p_is_correct);

  -- Award neurons only if correct
  IF p_is_correct THEN
    v_op_key := 'daily_logic_' || p_question_id || '_' || v_uid;

    -- Idempotent reward via currency_ledger
    IF NOT EXISTS (SELECT 1 FROM currency_ledger WHERE operation_key = v_op_key) THEN
      UPDATE profiles SET neurons = neurons + v_reward WHERE id = v_uid;
      INSERT INTO currency_ledger (user_id, delta, operation_type, operation_key)
      VALUES (v_uid, v_reward, 'daily_logic_reward', v_op_key);
    END IF;

    RETURN jsonb_build_object('ok', true, 'awarded', v_reward);
  END IF;

  RETURN jsonb_build_object('ok', true, 'awarded', 0);
END;$$;

GRANT EXECUTE ON FUNCTION submit_daily_logic(uuid, boolean) TO authenticated;
