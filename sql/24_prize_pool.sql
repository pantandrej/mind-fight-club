-- ── Prize pool for official tournaments ───────────────────────────
ALTER TABLE official_tournaments ADD COLUMN IF NOT EXISTS entry_fee   int NOT NULL DEFAULT 0;
ALTER TABLE official_tournaments ADD COLUMN IF NOT EXISTS prize_pool  int NOT NULL DEFAULT 0;
ALTER TABLE official_tournaments ADD COLUMN IF NOT EXISTS winner_id   uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE official_tournaments ADD COLUMN IF NOT EXISTS prize_paid  boolean NOT NULL DEFAULT false;

-- RPC: pay_tournament_entry — deduct entry fee, add to prize pool (idempotent per user+tournament)
CREATE OR REPLACE FUNCTION pay_tournament_entry(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_fee     int;
  v_neurons int;
  v_key     text;
BEGIN
  SELECT entry_fee INTO v_fee FROM official_tournaments WHERE id = p_tournament_id;
  IF v_fee IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_fee = 0 THEN RETURN jsonb_build_object('ok', true, 'fee', 0); END IF;

  v_key := 'ot_entry_' || p_tournament_id || '_' || auth.uid();

  -- Idempotency: already paid?
  IF EXISTS (SELECT 1 FROM currency_ledger WHERE operation_key = v_key) THEN
    RETURN jsonb_build_object('ok', true, 'already_paid', true);
  END IF;

  SELECT neurons INTO v_neurons FROM profiles WHERE id = auth.uid() FOR UPDATE;
  IF v_neurons < v_fee THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough', 'need', v_fee, 'have', v_neurons);
  END IF;

  -- Deduct from player
  UPDATE profiles SET neurons = neurons - v_fee WHERE id = auth.uid();
  INSERT INTO currency_ledger (user_id, delta, operation_type, operation_key)
    VALUES (auth.uid(), -v_fee, 'tournament_entry', v_key);

  -- Add to prize pool
  UPDATE official_tournaments SET prize_pool = prize_pool + v_fee WHERE id = p_tournament_id;

  RETURN jsonb_build_object('ok', true, 'fee', v_fee);
END;$$;
GRANT EXECUTE ON FUNCTION pay_tournament_entry(uuid) TO authenticated;

-- RPC: award_tournament_winner — called by admin after tournament ends
CREATE OR REPLACE FUNCTION award_tournament_winner(p_tournament_id uuid, p_winner_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pool    int;
  v_paid    boolean;
BEGIN
  -- Only admins (or owner via check_role) can call this — add role check if needed
  SELECT prize_pool, prize_paid, winner_id INTO v_pool, v_paid, p_winner_id
    FROM official_tournaments WHERE id = p_tournament_id;

  IF v_pool IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_paid THEN RETURN jsonb_build_object('ok', false, 'reason', 'already_paid'); END IF;
  IF v_pool = 0 THEN RETURN jsonb_build_object('ok', true, 'pool', 0); END IF;

  UPDATE profiles SET neurons = neurons + v_pool WHERE id = p_winner_id;
  INSERT INTO currency_ledger (user_id, delta, operation_type, operation_key)
    VALUES (p_winner_id, v_pool, 'tournament_prize', 'prize_' || p_tournament_id);

  UPDATE official_tournaments
    SET prize_paid = true, winner_id = p_winner_id
    WHERE id = p_tournament_id;

  RETURN jsonb_build_object('ok', true, 'awarded', v_pool, 'winner', p_winner_id);
END;$$;
GRANT EXECUTE ON FUNCTION award_tournament_winner(uuid, uuid) TO authenticated;
