-- ============================================================
-- BFC: cancel_quiz_pass()
-- Organizer cancels a pass → refunds all buyers atomically.
-- ============================================================

CREATE OR REPLACE FUNCTION cancel_quiz_pass(p_pass_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id  uuid := auth.uid();
  v_pass       quiz_passes%ROWTYPE;
  v_purchase   quiz_pass_purchases%ROWTYPE;
  v_refund_cnt int := 0;
BEGIN
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_pass FROM quiz_passes WHERE id = p_pass_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_pass.organizer_id <> v_caller_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'forbidden');
  END IF;

  IF v_pass.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', true, 'refunded', 0, 'already_cancelled', true);
  END IF;

  -- Refund all non-refunded buyers
  FOR v_purchase IN
    SELECT * FROM quiz_pass_purchases
    WHERE pass_id = p_pass_id AND NOT refunded
    FOR UPDATE
  LOOP
    UPDATE profiles
    SET neurons    = COALESCE(neurons, 0) + v_purchase.price_paid,
        updated_at = now()
    WHERE id = v_purchase.buyer_id;

    UPDATE quiz_pass_purchases
    SET refunded = true
    WHERE id = v_purchase.id;

    v_refund_cnt := v_refund_cnt + 1;
  END LOOP;

  -- Deduct refunded amount from organizer
  IF v_refund_cnt > 0 THEN
    UPDATE profiles
    SET neurons    = GREATEST(0, neurons - (v_pass.price * v_refund_cnt)),
        updated_at = now()
    WHERE id = v_pass.organizer_id;
  END IF;

  -- Mark pass cancelled
  UPDATE quiz_passes
  SET status     = 'cancelled',
      updated_at = now()
  WHERE id = p_pass_id;

  RETURN jsonb_build_object('ok', true, 'refunded', v_refund_cnt);
END;
$$;

REVOKE ALL ON FUNCTION cancel_quiz_pass(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cancel_quiz_pass(uuid) TO authenticated;
