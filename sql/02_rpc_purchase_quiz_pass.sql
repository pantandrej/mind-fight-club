-- ============================================================
-- BFC: purchase_quiz_pass()
-- Atomic ticket purchase with FOR UPDATE row locking.
-- Client sends ONLY p_pass_id — price read from DB server-side.
-- Returns JSON: { ok, reason?, ticket_code?, neurons, xp }
-- ============================================================

CREATE OR REPLACE FUNCTION purchase_quiz_pass(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_buyer_id   uuid := auth.uid();
  v_pass       quiz_passes%ROWTYPE;
  v_buyer      profiles%ROWTYPE;
  v_ticket     text;
  v_already    boolean;
BEGIN
  -- Must be authenticated
  IF v_buyer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Lock the pass row — prevents overselling under concurrent requests
  SELECT * INTO v_pass
  FROM quiz_passes
  WHERE id = p_pass_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  -- Status check
  IF v_pass.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_active');
  END IF;

  -- Slots check
  IF v_pass.slots_left <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'sold_out');
  END IF;

  -- Duplicate purchase check (unique index also guards this)
  SELECT EXISTS(
    SELECT 1 FROM quiz_pass_purchases
    WHERE pass_id = p_pass_id AND buyer_id = v_buyer_id AND NOT refunded
  ) INTO v_already;

  IF v_already THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_purchased');
  END IF;

  -- Buyer balance check (lock profile row too)
  SELECT * INTO v_buyer
  FROM profiles
  WHERE id = v_buyer_id
  FOR UPDATE;

  IF v_buyer.neurons IS NULL OR v_buyer.neurons < v_pass.price THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient');
  END IF;

  -- Generate unique ticket code
  v_ticket := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  -- Deduct neurons from buyer
  UPDATE profiles
  SET neurons     = neurons - v_pass.price,
      updated_at  = now()
  WHERE id = v_buyer_id;

  -- Credit organizer (neurons only — not XP)
  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_pass.price,
      updated_at = now()
  WHERE id = v_pass.organizer_id;

  -- Decrement slot
  UPDATE quiz_passes
  SET slots_left = slots_left - 1,
      updated_at = now()
  WHERE id = p_pass_id;

  -- Record purchase
  INSERT INTO quiz_pass_purchases
    (pass_id, organizer_id, buyer_id, buyer_name, price_paid, ticket_code)
  VALUES
    (p_pass_id, v_pass.organizer_id, v_buyer_id,
     COALESCE(v_buyer.display_name, ''), v_pass.price, v_ticket);

  -- Return fresh balance + ticket
  SELECT neurons, xp INTO v_buyer FROM profiles WHERE id = v_buyer_id;

  RETURN jsonb_build_object(
    'ok',          true,
    'ticket_code', v_ticket,
    'pass_title',  v_pass.title,
    'event_date',  v_pass.event_date,
    'location',    v_pass.location,
    'neurons',     v_buyer.neurons,
    'xp',          v_buyer.xp
  );

EXCEPTION WHEN unique_violation THEN
  -- Race condition: another request inserted the purchase concurrently
  RETURN jsonb_build_object('ok', false, 'reason', 'already_purchased');
END;
$$;

REVOKE ALL ON FUNCTION purchase_quiz_pass(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION purchase_quiz_pass(uuid) TO authenticated;
