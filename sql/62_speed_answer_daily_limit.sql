-- ══════════════════════════════════════════════════════════════════
-- Migration 62: Daily limit for speed_answer neurons
--
-- Проблема: клиент может вызывать award_currency('speed_answer', ...)
-- с произвольными operation_key и накручивать нейроны без ограничений.
--
-- Решение: лимит 300 нейронов в день с одного пользователя
-- (10 вопросов × 30 сек = честный максимум за одну игровую сессию).
-- ══════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL,
  p_is_hype_pack   boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_neurons    int;
  v_xp         int;
  v_profile    profiles%ROWTYPE;
  v_key        text;
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_count      int;
  v_is_premium boolean;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── Лимит speed_answer: макс 300 нейронов в день ─────────────────
  -- Честный максимум: 10 вопросов × 30 сек = 300
  IF p_operation_type = 'speed_answer' THEN
    SELECT COALESCE(SUM(awarded_neurons), 0) INTO v_count
    FROM currency_ledger
    WHERE user_id = v_user_id
      AND operation_type = 'speed_answer'
      AND created_at::date = v_today;
    IF v_count >= 300 THEN
      SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object(
        'ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0
      );
    END IF;
  END IF;

  -- ── Лимит дуэлей: 3 победы в день ────────────────────────────────
  IF p_operation_type = 'duel_win' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id = v_user_id AND operation_type = 'duel_win'
      AND created_at::date = v_today;
    IF v_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
      FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object(
        'ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0
      );
    END IF;
  END IF;

  -- ── Лимит тренировок: 3 сессии в день ────────────────────────────
  IF p_operation_type = 'quiz_reward' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id = v_user_id AND operation_type = 'quiz_reward'
      AND created_at::date = v_today;
    IF v_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
      FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object(
        'ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0
      );
    END IF;
  END IF;

  -- ── Лимит паков ───────────────────────────────────────────────────
  IF p_operation_type = 'pack_reward' THEN
    IF p_is_hype_pack THEN
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id = v_user_id AND operation_type = 'pack_reward'
        AND operation_key LIKE 'hype_%'
        AND created_at::date = v_today;
      IF v_count >= 1 THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
        FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object(
          'ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0
        );
      END IF;
    ELSE
      IF NOT v_is_premium THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
        FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object(
          'ok', false, 'reason', 'premium_required',
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0
        );
      END IF;
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id = v_user_id AND operation_type = 'pack_reward'
        AND operation_key NOT LIKE 'hype_%'
        AND created_at::date = v_today;
      IF v_count >= 3 THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
        FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object(
          'ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0
        );
      END IF;
    END IF;
  END IF;

  -- ── Получаем размер награды из таблицы ───────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  -- ── Для speed_answer: не превысить дневной остаток ───────────────
  IF p_operation_type = 'speed_answer' THEN
    v_neurons := LEAST(v_neurons, 300 - v_count);
    v_xp      := LEAST(v_xp,      300 - v_count);
    IF v_neurons <= 0 THEN
      SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object(
        'ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0
      );
    END IF;
  END IF;

  v_key := COALESCE(
    p_operation_key,
    p_operation_type || '_' || v_user_id::text || '_' || v_today::text
  );

  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_user_id, p_operation_type, v_key, v_neurons, v_xp)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF NOT FOUND THEN
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
    RETURN jsonb_build_object(
      'ok', true, 'already_processed', true,
      'neurons', v_profile.neurons, 'xp', v_profile.xp,
      'awarded_neurons', 0, 'awarded_xp', 0
    );
  END IF;

  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)     + v_xp,
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

REVOKE ALL ON FUNCTION award_currency(text, text, int, boolean) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_currency(text, text, int, boolean) TO authenticated;
