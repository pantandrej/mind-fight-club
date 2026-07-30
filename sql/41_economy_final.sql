-- ══════════════════════════════════════════════════════════════════
-- Migration 41: Final Economy Rules
-- Hype packs, referral protection, daily bonus, remove tournament neurons
-- ══════════════════════════════════════════════════════════════════

-- ── 1. game_packs: добавляем тип 'hype' ──────────────────────────
-- Существующие паки остаются 'standard' (= премиум-паки)
-- Хайп-паки: is_hype = true, бесплатны для всех
ALTER TABLE public.game_packs
  ADD COLUMN IF NOT EXISTS is_hype boolean DEFAULT false;

-- ── 2. ОБНОВЛЯЕМ ТАБЛИЦУ НАЧИСЛЕНИЙ ─────────────────────────────
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY SELECT
    CASE p_type
      -- Тренировка: +2 за верный ответ (max 20), платные первые 3 сессии
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0)*2, 20)
      -- Дуэль: +15 за победу, платные первые 3 победы
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      -- Паки: +1 за верный ответ (hype и premium одинаково)
      -- лимиты (hype: 1/day free / premium: 3/day) проверяются в award_currency
      WHEN 'pack_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 10)
      -- Ежедневный бонус первого действия
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      -- Реферал: 100 нейронов после 5 дней стрика реферала
      WHEN 'referral_bonus'      THEN 100
      -- Онбординг
      WHEN 'onboarding_complete' THEN 50
      -- Стрики
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      -- Супервопрос
      WHEN 'super_question'      THEN 10
      -- Турнир — больше не даёт нейроны, только турнирные очки
      WHEN 'tournament_reward'   THEN 0
      ELSE 0
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0)*2, 20)
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      WHEN 'pack_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 10)
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      WHEN 'referral_bonus'      THEN 20
      WHEN 'onboarding_complete' THEN 10
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'super_question'      THEN 10
      WHEN 'tournament_reward'   THEN 0
      ELSE 0
    END::int AS xp;
END;
$$;


-- ── 3. award_currency — лимиты дуэлей (3 платных) + паки ─────────
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL,
  p_is_hype_pack   boolean DEFAULT false  -- для pack_reward: true = хайп-пак
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

  -- Проверяем премиум
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── Лимит дуэлей: 3 платных победы в день (free и premium одинаково)
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

  -- ── Лимит тренировок: 3 платных сессии в день
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

  -- ── Лимит паков
  IF p_operation_type = 'pack_reward' THEN
    IF p_is_hype_pack THEN
      -- Хайп-пак: 1/день для всех
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
      -- Премиум-пак: только для premium, 3/день
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

  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

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
  SET neurons    = COALESCE(neurons,0) + v_neurons,
      xp         = COALESCE(xp,0)      + v_xp,
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

-- Совместимость со старой сигнатурой без p_is_hype_pack
DROP FUNCTION IF EXISTS award_currency(text, text, int);
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT award_currency(p_operation_type, p_operation_key, p_client_amount, false);
$$;
GRANT EXECUTE ON FUNCTION award_currency(text, text, int) TO authenticated;


-- ── 4. РЕФЕРАЛЬНАЯ ЗАЩИТА: бонус только после 5 дней стрика ──────
CREATE OR REPLACE FUNCTION award_referrer(p_referred_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id  uuid;
  v_streak       int;
  v_key_referred text;
  v_key_referrer text;
BEGIN
  -- Находим реферера
  SELECT referred_by INTO v_referrer_id
  FROM profiles WHERE id = p_referred_user_id;

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_referrer');
  END IF;

  -- Проверяем стрик приглашённого: минимум 5 дней
  SELECT COALESCE(daily_streak, 0) INTO v_streak
  FROM profiles WHERE id = p_referred_user_id;

  IF v_streak < 5 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'streak_too_low',
      'current_streak', v_streak,
      'required_streak', 5
    );
  END IF;

  v_key_referred := 'referral_bonus_received_' || p_referred_user_id::text;
  v_key_referrer := 'referral_bonus_given_'    || p_referred_user_id::text;

  -- Начисляем приглашённому
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (p_referred_user_id, 'referral_bonus', v_key_referred, 100, 20)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF FOUND THEN
    UPDATE profiles SET neurons = COALESCE(neurons,0)+100, xp = COALESCE(xp,0)+20
    WHERE id = p_referred_user_id;
  END IF;

  -- Начисляем реферу
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_referrer_id, 'referral_bonus', v_key_referrer, 100, 20)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF FOUND THEN
    UPDATE profiles SET neurons = COALESCE(neurons,0)+100, xp = COALESCE(xp,0)+20
    WHERE id = v_referrer_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'streak', v_streak);
END;
$$;

REVOKE ALL ON FUNCTION award_referrer(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_referrer(uuid) TO authenticated;


-- ── 5. ТРИГГЕР: проверять реферал при каждом обновлении стрика ───
-- Вызывается когда daily_streak игрока меняется (из streak.js через RPC)
CREATE OR REPLACE FUNCTION _check_referral_on_streak()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Когда стрик достигает 5 — пробуем начислить реферальный бонус
  IF NEW.daily_streak >= 5 AND (OLD.daily_streak IS NULL OR OLD.daily_streak < 5) THEN
    PERFORM award_referrer(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_referral_streak ON public.profiles;
CREATE TRIGGER trg_referral_streak
  AFTER UPDATE OF daily_streak ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION _check_referral_on_streak();
