-- ============================================================
-- BFC: award_currency() + spend_neurons()
-- Idempotent award with operation_key dedup.
-- Atomic spend with FOR UPDATE balance lock.
-- ============================================================

-- Drop old version if exists (fixes return type mismatch)
DROP FUNCTION IF EXISTS _bfc_award_amounts(text);

-- Ledger table for idempotency (prevents double-award on retry/reload)
CREATE TABLE IF NOT EXISTS currency_ledger (
  id             bigserial PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  operation_key  text NOT NULL,
  awarded_neurons int NOT NULL DEFAULT 0,
  awarded_xp      int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, operation_key)
);

CREATE INDEX IF NOT EXISTS idx_ledger_user ON currency_ledger(user_id);
ALTER TABLE currency_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user reads own ledger" ON currency_ledger FOR SELECT USING (user_id = auth.uid());

-- ── Award amounts by operation type ──────────────────────────────────
-- Centralised here — client NEVER sends an amount
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_type
      WHEN 'quiz_correct'         THEN 10
      WHEN 'quiz_correct_streak'  THEN 15
      WHEN 'duel_win'             THEN 50
      WHEN 'duel_loss'            THEN 10
      WHEN 'tournament_q_correct' THEN 20
      WHEN 'daily_login'          THEN 20
      WHEN 'referral_bonus'       THEN 100
      WHEN 'onboarding_complete'  THEN 50
      ELSE 10
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_correct'         THEN 10
      WHEN 'quiz_correct_streak'  THEN 15
      WHEN 'duel_win'             THEN 50
      WHEN 'duel_loss'            THEN 10
      WHEN 'tournament_q_correct' THEN 20
      WHEN 'daily_login'          THEN  5
      WHEN 'referral_bonus'       THEN 20
      WHEN 'onboarding_complete'  THEN 10
      ELSE 10
    END::int AS xp;
END;
$$;

-- ── award_currency ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id  uuid := auth.uid();
  v_neurons  int;
  v_xp       int;
  v_profile  profiles%ROWTYPE;
  v_key      text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT neurons, xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type);

  IF v_neurons IS NULL THEN
    v_neurons := 10; v_xp := 10; -- safe fallback
  END IF;

  -- Build idempotency key
  v_key := COALESCE(p_operation_key, p_operation_type || '_' || extract(epoch FROM date_trunc('day', now()))::text);

  -- Insert into ledger (UNIQUE constraint prevents double-award)
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_user_id, p_operation_type, v_key, v_neurons, v_xp)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  -- If nothing inserted → already processed
  IF NOT FOUND THEN
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'already_processed', true,
      'neurons', v_profile.neurons, 'xp', v_profile.xp,
      'awarded_neurons', 0, 'awarded_xp', 0
    );
  END IF;

  -- Apply award
  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)      + v_xp,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true, 'already_processed', false,
    'neurons', v_profile.neurons, 'xp', v_profile.xp,
    'awarded_neurons', v_neurons, 'awarded_xp', v_xp
  );
END;
$$;

REVOKE ALL ON FUNCTION award_currency(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_currency(text, text) TO authenticated;


-- ── spend_neurons ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION spend_neurons(
  p_amount         int,
  p_operation_type text DEFAULT 'purchase',
  p_operation_key  text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile profiles%ROWTYPE;
  v_key     text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  -- Lock profile row to prevent concurrent overdraft
  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  IF v_profile.neurons IS NULL OR v_profile.neurons < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient',
      'balance', COALESCE(v_profile.neurons, 0));
  END IF;

  -- Idempotency for spends too
  IF p_operation_key IS NOT NULL THEN
    v_key := p_operation_key;
    INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
    VALUES (v_user_id, p_operation_type, v_key, -p_amount, 0)
    ON CONFLICT (user_id, operation_key) DO NOTHING;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_processed', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp);
    END IF;
  END IF;

  UPDATE profiles
  SET neurons    = neurons - p_amount,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true,
    'neurons', v_profile.neurons,
    'xp', v_profile.xp
  );
END;
$$;

REVOKE ALL ON FUNCTION spend_neurons(int, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION spend_neurons(int, text, text) TO authenticated;
