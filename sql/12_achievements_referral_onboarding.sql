-- ============================================================
-- BFC: Achievements, Referral system, Onboarding flag
-- ============================================================

-- ── 1. Onboarding flag in profiles ───────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS onboarding_done boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code   text UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referred_by     uuid REFERENCES auth.users(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_count  int DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS level           int DEFAULT 1;

-- Generate referral code for existing users who don't have one
UPDATE profiles
SET referral_code = UPPER(SUBSTRING(MD5(id::text), 1, 6))
WHERE referral_code IS NULL;

-- ── 2. Achievements ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_achievements (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  badge_id     text NOT NULL,
  unlocked_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_id)
);

CREATE INDEX IF NOT EXISTS idx_achievements_user ON user_achievements(user_id);

ALTER TABLE user_achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user sees own achievements" ON user_achievements
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "server inserts achievements" ON user_achievements
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- ── 3. Award achievement RPC (idempotent) ─────────────────────
CREATE OR REPLACE FUNCTION award_achievement(p_badge_id text)
RETURNS boolean   -- true = newly unlocked, false = already had it
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_new boolean;
BEGIN
  INSERT INTO user_achievements(user_id, badge_id)
  VALUES (auth.uid(), p_badge_id)
  ON CONFLICT (user_id, badge_id) DO NOTHING;
  GET DIAGNOSTICS v_new = ROW_COUNT;
  RETURN v_new > 0;
END;
$$;
GRANT EXECUTE ON FUNCTION award_achievement(text) TO authenticated;

-- ── 4. Referral claim RPC ──────────────────────────────────────
CREATE OR REPLACE FUNCTION claim_referral(p_code text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_referrer_id uuid;
  v_self_id     uuid := auth.uid();
BEGIN
  -- Can't refer yourself
  SELECT id INTO v_referrer_id FROM profiles WHERE referral_code = UPPER(p_code) AND id != v_self_id;
  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;
  -- Already referred
  IF (SELECT referred_by FROM profiles WHERE id = v_self_id) IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;
  -- Apply referral
  UPDATE profiles SET referred_by = v_referrer_id WHERE id = v_self_id;
  UPDATE profiles SET referral_count = referral_count + 1 WHERE id = v_referrer_id;
  -- Award both parties via award_currency
  PERFORM award_currency('referral', 'ref_new:' || v_self_id::text);
  -- Award referrer (switch uid context trick via security definer insert)
  INSERT INTO currency_ledger(user_id, event_type, idempotency_key, neurons_delta, xp_delta)
  VALUES (v_referrer_id, 'referral', 'ref_gave:' || v_self_id::text, 50, 50)
  ON CONFLICT (idempotency_key) DO NOTHING;
  UPDATE profiles SET neurons = neurons + 50, xp = xp + 50 WHERE id = v_referrer_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
GRANT EXECUTE ON FUNCTION claim_referral(text) TO authenticated;

-- ── 5. Level calculation function ────────────────────────────
-- Level thresholds: 1=0xp, 2=100, 3=250, 4=500, 5=1000, then +500 per level
CREATE OR REPLACE FUNCTION xp_to_level(p_xp int)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_xp <  100  THEN 1
    WHEN p_xp <  250  THEN 2
    WHEN p_xp <  500  THEN 3
    WHEN p_xp <  1000 THEN 4
    WHEN p_xp <  2000 THEN 5
    WHEN p_xp <  3500 THEN 6
    WHEN p_xp <  5500 THEN 7
    WHEN p_xp <  8000 THEN 8
    WHEN p_xp <  11000 THEN 9
    ELSE 10 + (p_xp - 11000) / 5000
  END;
$$;
