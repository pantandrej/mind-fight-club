-- ══════════════════════════════════════════════════════════════════
-- Migration 63: Team Treasury (Казна команды)
-- ══════════════════════════════════════════════════════════════════

-- 1. Add treasury column to teams
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS treasury_neurons bigint NOT NULL DEFAULT 0;

-- 2. Ledger table for contributions
CREATE TABLE IF NOT EXISTS public.team_treasury_ledger (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount     int         NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_ledger_team
  ON public.team_treasury_ledger(team_id, created_at DESC);

-- 3. RPC: donate_to_team
CREATE OR REPLACE FUNCTION donate_to_team(p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_team_id   uuid;
  v_neurons   int;
  v_treasury  bigint;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  -- Get team and neuron balance
  SELECT team_id, neurons INTO v_team_id, v_neurons
  FROM profiles WHERE id = v_user_id;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  IF v_neurons < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_neurons', 'balance', v_neurons);
  END IF;

  -- Deduct from player
  UPDATE profiles
  SET neurons = neurons - p_amount, updated_at = now()
  WHERE id = v_user_id;

  -- Add to team treasury
  UPDATE teams
  SET treasury_neurons = treasury_neurons + p_amount
  WHERE id = v_team_id
  RETURNING treasury_neurons INTO v_treasury;

  -- Log contribution
  INSERT INTO team_treasury_ledger (team_id, user_id, amount)
  VALUES (v_team_id, v_user_id, p_amount);

  RETURN jsonb_build_object(
    'ok', true,
    'neurons', v_neurons - p_amount,
    'treasury', v_treasury
  );
END;
$$;

REVOKE ALL ON FUNCTION donate_to_team(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION donate_to_team(int) TO authenticated;
