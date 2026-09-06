-- ══════════════════════════════════════════════════════════════════
-- Migration 68: Economy Security Hardening
--
-- Уязвимости, которые закрывает эта миграция:
--
-- 1. [CRITICAL] referral_bonus — клиент мог вызывать award_currency с
--    произвольным operation_key и получать +100 нейронов на каждый вызов.
--    Исправление: сервер всегда использует ключ 'referral_bonus_received_{uid}'.
--
-- 2. [HIGH] onboarding_complete — аналогично, +50 за вызов с любым ключом.
--    Исправление: ключ 'onboarding_complete_{uid}', однократно за жизнь.
--
-- 3. [HIGH] streak_7_days, streak_30_days, streak_100_days — +50/200/500
--    нейронов за вызов с произвольным ключом, без ограничений.
--    Исправление: ключ 'streak_{type}_{uid}', однократно за жизнь.
--
-- 4. [MEDIUM] streak_reward — p_client_amount до 500, любой ключ, без лимита.
--    Исправление: принудительный дневной ключ (1 раз в день).
--
-- 5. [MEDIUM] daily_login — 20 нейронов с любым ключом без дневного лимита.
--    Исправление: принудительный дневной ключ, клиентский ключ игнорируется.
--
-- 6. [MEDIUM] donate_to_team — race condition, нет FOR UPDATE при чтении баланса.
--    Исправление: SELECT ... FOR UPDATE.
--
-- 7. [LOW] daily_question — correctness client-side, unlimited keys.
--    Исправление: принудительный дневной ключ (1 раз в день, max 25n/day).
--
-- 8. [LOW] speed_answer — не был определён в _bfc_award_amounts (ELSE 0),
--    функция сломана. Исправление: добавлен с cap 30 нейронов за вопрос.
--
-- 9. [LOW] Неизвестные operation_type — возвращали 0, теперь блокируются.
--
-- Что НЕ меняется:
--   - quiz_reward/pack_reward (ограничены дневными лимитами, cap p_client_amount)
--   - duel_win (не вызывается из JS, защищён дневным лимитом)
--   - RLS на currency_ledger / challenge_results
--   - Каскадные FK
-- ══════════════════════════════════════════════════════════════════

-- ── 1. _bfc_award_amounts — добавляем недостающие типы ───────────
--    ELSE теперь возвращает -1 (сигнал: неизвестный тип, блокировать)
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY SELECT
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0)*2, 20)
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      WHEN 'pack_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 10)
      -- speed_answer: клиент передаёт оставшееся время (1–30), сервер это принимает
      -- но ограничивает дневным лимитом 300 в award_currency
      WHEN 'speed_answer'        THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 30)
      WHEN 'daily_goal'          THEN 50
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      WHEN 'daily_question'      THEN 25
      WHEN 'referral_bonus'      THEN 100
      WHEN 'onboarding_complete' THEN 50
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'super_question'      THEN 10
      WHEN 'tournament_reward'   THEN  0
      ELSE -1  -- неизвестный тип — заблокировать в award_currency
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0)*2, 20)
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      WHEN 'pack_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 10)
      WHEN 'speed_answer'        THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 30)
      WHEN 'daily_goal'          THEN 50
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      WHEN 'daily_question'      THEN 25
      WHEN 'referral_bonus'      THEN 20
      WHEN 'onboarding_complete' THEN 10
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount,0),0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'super_question'      THEN 10
      WHEN 'tournament_reward'   THEN  0
      ELSE -1
    END::int AS xp;
END;
$$;


-- ── 2. award_currency — полная замена с security-fix'ами ──────────
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

  -- ── Получаем размер награды ───────────────────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  -- Блокируем неизвестные operation_type (ELSE -1 в _bfc_award_amounts)
  IF v_neurons IS NULL OR v_neurons < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation_type');
  END IF;

  -- ── Принудительные серверные ключи идемпотентности ───────────────
  -- Для этих типов клиентский p_operation_key полностью игнорируется.
  -- Это закрывает вектор: "передать случайный ключ → получить награду повторно".

  -- Однократные в жизни (tied to user_id)
  IF p_operation_type = 'referral_bonus' THEN
    v_key := 'referral_bonus_received_' || v_user_id::text;

  ELSIF p_operation_type = 'onboarding_complete' THEN
    v_key := 'onboarding_complete_' || v_user_id::text;

  ELSIF p_operation_type IN ('streak_7_days', 'streak_30_days', 'streak_100_days') THEN
    v_key := p_operation_type || '_' || v_user_id::text;

  -- Дневные (tied to user_id + UTC date)
  ELSIF p_operation_type IN ('daily_login', 'daily_goal', 'daily_goal_bonus',
                              'daily_question', 'streak_reward') THEN
    v_key := p_operation_type || '_' || v_user_id::text || '_' || v_today::text;

  -- Для остальных: принимаем клиентский ключ или строим дефолтный
  ELSE
    v_key := COALESCE(
      p_operation_key,
      p_operation_type || '_' || v_user_id::text || '_' || v_today::text
    );
  END IF;

  -- ── Премиум-проверка ──────────────────────────────────────────────
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── Дневные лимиты по типу операции ──────────────────────────────

  IF p_operation_type = 'speed_answer' THEN
    SELECT COALESCE(SUM(awarded_neurons), 0) INTO v_count
    FROM currency_ledger
    WHERE user_id = v_user_id
      AND operation_type = 'speed_answer'
      AND created_at::date = v_today;
    IF v_count >= 300 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0);
    END IF;
    -- Не превысить дневной остаток
    v_neurons := LEAST(v_neurons, 300 - v_count);
    v_xp      := LEAST(v_xp,      300 - v_count);
    IF v_neurons <= 0 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0);
    END IF;
  END IF;

  IF p_operation_type = 'duel_win' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id = v_user_id AND operation_type = 'duel_win'
      AND created_at::date = v_today;
    IF v_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0);
    END IF;
  END IF;

  IF p_operation_type = 'quiz_reward' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id = v_user_id AND operation_type = 'quiz_reward'
      AND created_at::date = v_today;
    IF v_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0);
    END IF;
  END IF;

  IF p_operation_type = 'pack_reward' THEN
    IF p_is_hype_pack THEN
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id = v_user_id AND operation_type = 'pack_reward'
        AND operation_key LIKE 'hype_%'
        AND created_at::date = v_today;
      IF v_count >= 1 THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    ELSE
      IF NOT v_is_premium THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', false, 'reason', 'premium_required',
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
      SELECT COUNT(*) INTO v_count FROM currency_ledger
      WHERE user_id = v_user_id AND operation_type = 'pack_reward'
        AND operation_key NOT LIKE 'hype_%'
        AND created_at::date = v_today;
      IF v_count >= 3 THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    END IF;
  END IF;

  -- ── Запись в ledger (UNIQUE защищает от двойного начисления) ──────
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

  -- ── Начисление ────────────────────────────────────────────────────
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


-- ── 3. donate_to_team — fix race condition (нет FOR UPDATE) ───────
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

  -- FOR UPDATE блокирует строку профиля до конца транзакции,
  -- предотвращая одновременный overspend при конкурентных запросах
  SELECT team_id, neurons INTO v_team_id, v_neurons
  FROM profiles WHERE id = v_user_id
  FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  IF v_neurons < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_neurons', 'balance', v_neurons);
  END IF;

  UPDATE profiles
  SET neurons = neurons - p_amount, updated_at = now()
  WHERE id = v_user_id;

  UPDATE teams
  SET treasury_neurons = treasury_neurons + p_amount
  WHERE id = v_team_id
  RETURNING treasury_neurons INTO v_treasury;

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


-- ── 4. award_referrer — защита от прямого вызова с чужим user_id ─
-- Уязвимость: любой auth пользователь мог вызвать award_referrer(uuid)
-- для произвольного пользователя, начислив нейроны им и их реферерам.
-- Теперь RPC принимает только ID самого вызывающего (auth.uid()).
-- Старая сигнатура (p_referred_user_id uuid) больше не принимает произвольный UUID.
CREATE OR REPLACE FUNCTION award_referrer_self()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Триггер trg_referral_streak вызывает perform award_referrer(NEW.id),
  -- поэтому старая функция с параметром нужна для триггера.
  -- Этот новый вариант без параметра предназначен для прямых вызовов через RPC
  -- и ограничен только собственным пользователем.
  PERFORM award_referrer(auth.uid());
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION award_referrer_self() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_referrer_self() TO authenticated;

-- award_referrer с параметром: оставляем для внутреннего триггера,
-- но отзываем право у authenticated role (триггер работает как postgres)
REVOKE ALL ON FUNCTION award_referrer(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION award_referrer(uuid) FROM authenticated;
-- Триггер _check_referral_on_streak вызывает PERFORM award_referrer(NEW.id)
-- из SECURITY DEFINER функции от имени postgres — GRANT не нужен.


-- ── 5. Индекс для быстрой проверки дневных лимитов ───────────────
-- Используется в award_currency при COUNT по (user_id, operation_type, created_at::date)
CREATE INDEX IF NOT EXISTS idx_ledger_user_type_date
  ON currency_ledger(user_id, operation_type, created_at);
