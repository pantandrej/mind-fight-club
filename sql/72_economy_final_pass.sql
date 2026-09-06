-- Migration 72: Economy Final Pass
--
-- What this migration does:
--   1. CREATE activate_referral(p_invited_user_id uuid) as a defined, safe RPC.
--      Previously undefined in SQL files — existed only in the Supabase dashboard
--      (or not at all). Overrides any dashboard version with a known-safe implementation:
--      only updates referrals.status to 'activated', awards NO neurons.
--
--      Payout model (consistent with existing ledger keys):
--        - Invited user: +100n immediately at registration via checkRefParam →
--          award_currency('referral_bonus') → key referral_bonus_received_{invited_id}
--        - Referrer: +100n when invited reaches daily_streak=5 →
--          _check_referral_on_streak trigger → award_referrer() →
--          key referral_bonus_given_{invited_id}
--        - activate_referral: marks the referral 'activated' only. No second payment.
--          The invited user was already paid at registration; the referrer is paid
--          by the trigger. Paying again here would be a duplicate.
--
-- Migrations 68-71 are already applied — NOT edited here.
-- This migration is idempotent and production-safe.
-- Does NOT touch currency_ledger history or any balance.

-- ── 1. activate_referral: safe status-update only ─────────────────────────────
--
-- Security properties:
--   - SECURITY DEFINER runs as postgres (bypasses referrals RLS which blocks UPDATE)
--   - Checks auth.uid() = p_invited_user_id so caller can only activate their own referral
--   - Returns {ok: true, reward_invited: 0} so JS knows not to show a reward toast

CREATE OR REPLACE FUNCTION activate_referral(p_invited_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  -- Security: only the invited user themselves can call this
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF v_caller != p_invited_user_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthorized');
  END IF;

  -- Check a referral row exists for this user
  IF NOT EXISTS (
    SELECT 1 FROM referrals WHERE invited_user_id = v_caller LIMIT 1
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_referral');
  END IF;

  -- Mark referral as activated (idempotent: only updates if currently 'signed_up')
  UPDATE referrals
  SET    status = 'activated'
  WHERE  invited_user_id = v_caller
    AND  status           = 'signed_up';

  -- reward_invited = 0: no neuron payment here.
  -- Invited user was already paid at registration via award_currency('referral_bonus').
  -- Referrer is paid by the _check_referral_on_streak trigger at invited's streak=5.
  RETURN jsonb_build_object('ok', true, 'reward_invited', 0);
END;
$$;

REVOKE ALL  ON FUNCTION activate_referral(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION activate_referral(uuid) TO authenticated;
