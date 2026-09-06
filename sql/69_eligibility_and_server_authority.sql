-- ══════════════════════════════════════════════════════════════════
-- Migration 69: Eligibility verification + server authority
--
-- Принцип: idempotency ≠ eligibility.
-- UNIQUE(operation_key) защищает только от дублирования.
-- Сервер ОБЯЗАН доказать, что событие реально произошло.
--
-- Что исправлено поверх migration 68:
--
-- [CRITICAL] speed_answer — заблокирован в public award_currency;
--   вместо него добавлен claim_speed_reward(session_id, neurons).
--   Сервер проверяет: принадлежность сессии, сегодняшняя дата,
--   reward ещё не выдавался. Neurons clamped 0..300.
--
-- [HIGH] referral_bonus — добавлена проверка наличия записи
--   в таблице referrals (invited_user_id = auth.uid()).
--   Без реального реферала — ошибка 'no_referral'.
--
-- [HIGH] streak_7/30/100_days — сервер проверяет daily_streak
--   в profiles. Без реального стрика — ошибка 'streak_not_earned'.
--
-- [HIGH] daily_goal/daily_goal_bonus — сервер проверяет наличие
--   game_sessions (mode=training) сегодня UTC. Без игры — ошибка.
--
-- [MEDIUM] onboarding_complete, duel_win/loss/tie,
--   tournament_reward — заблокированы в public award_currency.
--   Дуэльные награды должны приходить через специализированные
--   server-side RPC (существующие или будущие).
--
-- [MEDIUM] Concurrency в daily caps — добавлен pg_advisory_xact_lock
--   для quiz_reward и pack_reward. Два параллельных запроса с разными
--   ключами теперь не могут оба пройти дневной лимит.
--
-- [MEDIUM] Timezone: created_at::date = v_today заменён на range
--   created_at >= day_start AND created_at < day_end.
--   Позволяет использовать btree-индекс на created_at.
--
-- Что НЕ изменяется:
--   - record_daily_activity: вызывает award_currency для milestone;
--     eligibility-check (daily_streak >= N) проходит, т.к. стрик
--     только что был обновлён до нужного значения.
--   - checkRefParam (legacy.js): вставляет в referrals ДО вызова
--     award_currency, поэтому eligibility-check проходит.
--   - quiz_reward / pack_reward: сохраняются с дневными лимитами
--     как архитектурный компромисс (нет server-side correctness).
--   - RLS, FK, currency_ledger history — не затронуты.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. game_sessions.reward_claimed — предотвращает replay ────────
ALTER TABLE public.game_sessions
  ADD COLUMN IF NOT EXISTS reward_claimed boolean NOT NULL DEFAULT false;


-- ── 2. award_currency — финальная hardened версия ─────────────────
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
  v_user_id    uuid    := auth.uid();
  v_neurons    int;
  v_xp         int;
  v_profile    profiles%ROWTYPE;
  v_key        text;
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  -- Timezone-safe day boundaries для range-scan индекса
  v_day_start  timestamptz := (v_today::text || ' 00:00:00+00')::timestamptz;
  v_day_end    timestamptz := (v_day_start + interval '1 day');
  v_count      int;
  v_is_premium boolean;

  -- Типы, заблокированные в public award_currency.
  -- Должны начисляться только через специализированные SECURITY DEFINER RPC:
  --   speed_answer     → claim_speed_reward(session_id, neurons)
  --   duel_win/loss    → будущий claim_duel_result()
  --   tournament_reward→ finalize_tournament() (внутренний)
  --   onboarding_complete → не используется; orphaned type
  c_blocked_types text[] := ARRAY[
    'speed_answer',
    'duel_win', 'duel_loss', 'duel_tie',
    'tournament_reward',
    'onboarding_complete'
  ];
BEGIN
  -- ── 0. Auth ────────────────────────────────────────────────────
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- ── 1. Проверяем размер награды ───────────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  -- Неизвестный тип (ELSE -1 из _bfc_award_amounts)
  IF v_neurons IS NULL OR v_neurons < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation_type');
  END IF;

  -- ── 2. Блокируем server-internal типы ─────────────────────────
  IF p_operation_type = ANY(c_blocked_types) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_dedicated_rpc',
      'hint', p_operation_type || ' must be claimed via its own server RPC');
  END IF;

  -- ── 3. Eligibility checks — факт события server-side ──────────

  -- referral_bonus: нужна реальная запись в referrals
  IF p_operation_type = 'referral_bonus' THEN
    IF NOT EXISTS (
      SELECT 1 FROM referrals WHERE invited_user_id = v_user_id LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_referral',
        'hint', 'referral_bonus requires a referrals record for this user');
    END IF;
  END IF;

  -- streak milestones: проверяем реальный стрик в profiles
  IF p_operation_type = 'streak_7_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 7) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned',
        'required_streak', 7);
    END IF;
  END IF;

  IF p_operation_type = 'streak_30_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 30) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned',
        'required_streak', 30);
    END IF;
  END IF;

  IF p_operation_type = 'streak_100_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 100) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned',
        'required_streak', 100);
    END IF;
  END IF;

  -- daily_goal/daily_goal_bonus: пользователь должен сыграть training сегодня
  IF p_operation_type IN ('daily_goal', 'daily_goal_bonus') THEN
    IF NOT EXISTS (
      SELECT 1 FROM game_sessions
      WHERE user_id = v_user_id
        AND mode    = 'training'
        AND started_at >= v_day_start
        AND started_at <  v_day_end
      LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'daily_goal_not_earned',
        'hint', 'complete a training session first');
    END IF;
  END IF;

  -- ── 4. Премиум-проверка для pack_reward ───────────────────────
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── 5. Advisory lock для типов с daily COUNT cap ──────────────
  -- Предотвращает race condition: два параллельных запроса с разными
  -- ключами могут одновременно пройти COUNT-проверку и оба записаться.
  -- Lock per (user_id, operation_type) — разные пользователи не блокируют друг друга.
  IF p_operation_type IN ('quiz_reward', 'pack_reward') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':daily_cap:' || p_operation_type)
    );
  END IF;

  -- ── 6. Дневные лимиты (с timezone-safe range query) ──────────

  IF p_operation_type = 'quiz_reward' THEN
    SELECT COUNT(*) INTO v_count FROM currency_ledger
    WHERE user_id        = v_user_id
      AND operation_type = 'quiz_reward'
      AND created_at >= v_day_start AND created_at < v_day_end;
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
      WHERE user_id        = v_user_id
        AND operation_type = 'pack_reward'
        AND operation_key  LIKE 'hype_%'
        AND created_at >= v_day_start AND created_at < v_day_end;
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
      WHERE user_id        = v_user_id
        AND operation_type = 'pack_reward'
        AND operation_key  NOT LIKE 'hype_%'
        AND created_at >= v_day_start AND created_at < v_day_end;
      IF v_count >= 3 THEN
        SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
        RETURN jsonb_build_object('ok', true, 'daily_limit_reached', true,
          'neurons', v_profile.neurons, 'xp', v_profile.xp,
          'awarded_neurons', 0, 'awarded_xp', 0);
      END IF;
    END IF;
  END IF;

  -- ── 7. Принудительные серверные ключи (из migration 68) ────────
  -- Клиентский p_operation_key игнорируется для этих типов.
  IF p_operation_type = 'referral_bonus' THEN
    v_key := 'referral_bonus_received_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_7_days' THEN
    v_key := 'streak_7_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_30_days' THEN
    v_key := 'streak_30_days_' || v_user_id::text;
  ELSIF p_operation_type = 'streak_100_days' THEN
    v_key := 'streak_100_days_' || v_user_id::text;
  ELSIF p_operation_type IN ('daily_login', 'daily_goal', 'daily_goal_bonus',
                              'daily_question', 'streak_reward') THEN
    v_key := p_operation_type || '_' || v_user_id::text || '_' || v_today::text;
  ELSE
    v_key := COALESCE(
      p_operation_key,
      p_operation_type || '_' || v_user_id::text || '_' || v_today::text
    );
  END IF;

  -- ── 8. Ledger insert (UNIQUE защищает от двойного начисления) ──
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

  -- ── 9. Начисление ─────────────────────────────────────────────
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

-- Обратная совместимость: 3-параметровый вариант
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


-- ── 3. claim_speed_reward — server-authoritative speed bonus ──────
-- Клиент вызывает это вместо award_currency('speed_answer', ...).
-- Сервер проверяет: сессия принадлежит вызывающему, создана сегодня UTC,
-- reward_claimed = false. Neurons clamped в 0..300.
CREATE OR REPLACE FUNCTION claim_speed_reward(
  p_session_id uuid,
  p_neurons    int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_today     date := (now() AT TIME ZONE 'UTC')::date;
  v_day_start timestamptz := (v_today::text || ' 00:00:00+00')::timestamptz;
  v_session   game_sessions%ROWTYPE;
  v_neurons   int;
  v_profile   profiles%ROWTYPE;
  v_key       text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_neurons IS NULL OR p_neurons <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'awarded_neurons', 0, 'awarded_xp', 0);
  END IF;

  -- Clamp: max 10 вопросов × 30 сек = 300 нейронов
  v_neurons := LEAST(p_neurons, 300);

  -- Проверяем сессию с блокировкой строки (FOR UPDATE предотвращает
  -- параллельные попытки заявить reward для одной сессии)
  SELECT * INTO v_session
  FROM game_sessions
  WHERE id        = p_session_id
    AND user_id   = v_user_id
    AND started_at >= v_day_start     -- только сессии сегодня UTC
    AND mode      = 'training'        -- только тренировки
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session',
      'hint', 'session not found, wrong user, wrong mode, or too old');
  END IF;

  -- Replay protection: reward уже был выдан
  IF v_session.reward_claimed THEN
    SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
    FROM profiles WHERE id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'already_processed', true,
      'neurons', v_profile.neurons, 'xp', v_profile.xp,
      'awarded_neurons', 0, 'awarded_xp', 0);
  END IF;

  v_key := 'speed_session_' || p_session_id::text;

  -- Помечаем сессию как использованную ДО записи в ledger
  -- (если запись в ledger упадёт — транзакция откатится вместе с этим UPDATE)
  UPDATE game_sessions
  SET reward_claimed = true
  WHERE id = p_session_id;

  -- Запись в ledger (UNIQUE защищает от двойного начисления при retry)
  INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES (v_user_id, 'speed_answer', v_key, v_neurons, v_neurons)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  -- Если по какой-то причине ledger запись уже есть — не начисляем дважды
  IF NOT FOUND THEN
    SELECT neurons, xp INTO v_profile.neurons, v_profile.xp FROM profiles WHERE id = v_user_id;
    RETURN jsonb_build_object('ok', true, 'already_processed', true,
      'neurons', v_profile.neurons, 'xp', v_profile.xp,
      'awarded_neurons', 0, 'awarded_xp', 0);
  END IF;

  -- Начисление
  UPDATE profiles
  SET neurons    = COALESCE(neurons, 0) + v_neurons,
      xp         = COALESCE(xp, 0)     + v_neurons,
      updated_at = now()
  WHERE id = v_user_id
  RETURNING * INTO v_profile;

  RETURN jsonb_build_object(
    'ok', true, 'already_processed', false,
    'neurons', v_profile.neurons, 'xp', v_profile.xp,
    'awarded_neurons', v_neurons, 'awarded_xp', v_neurons
  );
END;
$$;

REVOKE ALL ON FUNCTION claim_speed_reward(uuid, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION claim_speed_reward(uuid, int) TO authenticated;


-- ── 4. spend_neurons — добавляем timezone-safe range для ledger ──
-- Функция не менялась с migration 04/41, но если внутри есть date cast,
-- обновляем. В текущей версии spend_neurons не делает date-cast queries,
-- поэтому оставляем без изменений.
-- (No changes needed for spend_neurons)


-- ── 5. Индекс: поддержка range-scan по created_at ────────────────
-- Существующий индекс idx_ledger_user_type_date (из migration 68) покрывает
-- (user_id, operation_type, created_at). Range-запросы вида
-- created_at >= day_start AND created_at < day_end могут использовать этот индекс.
-- Дополнительный индекс не нужен.

-- Дополнительно: частичный индекс для быстрой проверки дневной goal
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_training_day
  ON public.game_sessions(user_id, started_at)
  WHERE mode = 'training';

-- ── 6. КОММЕНТАРИИ к известным архитектурным ограничениям ────────
-- Нижеперечисленные типы остаются с известными ограничениями:
--
-- quiz_reward / pack_reward:
--   Правильность ответов проверяется на клиенте (нет server-side correctness).
--   Reward clamped к жёсткому ceiling; daily caps ограничивают max abuse
--   до 60 / 30 нейронов в день соответственно.
--   Полная server-authoritative модель требует переноса игровой логики
--   в SECURITY DEFINER RPC — отложено как architectural roadmap item.
--
-- duel_win:
--   Заблокирован в public award_currency. Нейроны за победу в дуэли
--   не начисляются ни из одного текущего JS-пути (claim через отдельный RPC
--   будет добавлен когда duel_rooms.score станет server-verified).
--
-- daily_question:
--   Правильность ответа client-side. После migration 68 cap = 25н/день
--   через принудительный дневной ключ. Acceptable risk.
