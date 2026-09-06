-- ══════════════════════════════════════════════════════════════════
-- Migration 70: Server Authority Final
--
-- Устраняет уязвимости, выявленные после migration 69:
--
-- [CRITICAL #1] claim_speed_reward: убираем p_neurons.
--   Сервер НЕ имеет authoritative answer events → не может вычислить
--   legitimate speed reward. Функция временно возвращает
--   server_verification_unavailable.
--   Полная реализация: submit_training_answer() RPC + session_questions table.
--   JS продолжает показывать локальный счётчик (UX), wallet НЕ кредитуется.
--
-- [CRITICAL #2] _gameId lifecycle: заменён на window._quickPlaySessionId
--   в training.js. SQL не меняется.
--
-- [HIGH #3] daily_goal: добавляем game_sessions.completed_at.
--   complete_training_session(session_id) RPC устанавливает completed_at.
--   award_currency для daily_goal проверяет completed_at IS NOT NULL.
--   Минимальный elapsed time (60s) предотвращает start→immediate-claim.
--
-- [HIGH #4] game_sessions RLS: только SELECT для authenticated.
--   Явно удаляем любые UPDATE/INSERT политики (если были добавлены в dashboard).
--   Клиентский UPDATE/INSERT молча отклоняется.
--
-- [HIGH #6] record_training_bf: p_correct от клиента нельзя доверять.
--   Функция временно возвращает 0. Параметры сохранены для совместимости JS.
--   Re-enable: когда будут server-verified answer events.
--
-- [MEDIUM #7] referrals: RLS + register_referral() SECURITY DEFINER RPC.
--   Клиент больше не может самостоятельно вставить referrals строку.
--   Весь flow через RPC, который валидирует ref_code server-side.
--
-- [MEDIUM #8] profiles: BEFORE UPDATE trigger защищает критические поля.
--   neurons, xp, daily_streak, referred_by, is_admin, is_scout, premium_until
--   сбрасываются к OLD значениям при client-originated UPDATE (current_user='authenticated').
--   SECURITY DEFINER функции (current_user='postgres') могут обновлять эти поля.
--
-- Не затронуто:
--   - quiz_reward / pack_reward (client-side correctness, known limitation)
--   - display_name, city, avatar_url, team_id, onboarding_done (client-settable, safe)
--   - existing ledger history, streak, referral records
--   - Brain Fights leaderboard history (только новые записи отключены)
-- ══════════════════════════════════════════════════════════════════


-- ── 1. game_sessions: добавляем completed_at ──────────────────────
ALTER TABLE public.game_sessions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

-- Индекс для быстрой проверки completion в eligibility check
CREATE INDEX IF NOT EXISTS idx_game_sessions_completed
  ON public.game_sessions(user_id, completed_at)
  WHERE mode = 'training' AND completed_at IS NOT NULL;


-- ── 2. game_sessions RLS: только SELECT для клиента ───────────────
-- Явно удаляем любые UPDATE/INSERT политики (могут существовать в dashboard)
DROP POLICY IF EXISTS "game_sessions_update_own" ON public.game_sessions;
DROP POLICY IF EXISTS "game_sessions_insert_own" ON public.game_sessions;
DROP POLICY IF EXISTS "game_sessions_own_write"  ON public.game_sessions;

-- SELECT политика уже существует (из start_game_session_rpc.sql).
-- Пересоздаём явно для надёжности.
DROP POLICY IF EXISTS "game_sessions_own" ON public.game_sessions;
CREATE POLICY "game_sessions_own" ON public.game_sessions
  FOR SELECT USING (auth.uid() = user_id);

-- INSERT и UPDATE допустимы только через SECURITY DEFINER RPC (обходят RLS).


-- ── 3. complete_training_session(session_id) ──────────────────────
-- Клиент вызывает после завершения Quick Play.
-- Сервер проверяет: владельца, режим training, минимальное время игры,
-- идемпотентно устанавливает completed_at.
-- completed_at необходимо для eligibility проверки daily_goal в award_currency.
CREATE OR REPLACE FUNCTION complete_training_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session game_sessions%ROWTYPE;
  v_elapsed_sec int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Блокируем строку для атомарного обновления
  SELECT * INTO v_session
  FROM game_sessions
  WHERE id      = p_session_id
    AND user_id = v_user_id
    AND mode    = 'training'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session',
      'hint', 'session not found, wrong user, or not training mode');
  END IF;

  -- Уже завершена (idempotent)
  IF v_session.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_completed', true);
  END IF;

  -- Минимальное время: 60 секунд.
  -- Quick Play содержит 10 вопросов, минимально реалистичное время ≥ 60с.
  -- Предотвращает start_game_session → immediate complete_training_session.
  v_elapsed_sec := EXTRACT(EPOCH FROM (now() - v_session.started_at))::int;
  IF v_elapsed_sec < 60 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'too_soon',
      'elapsed_seconds', v_elapsed_sec,
      'required_seconds', 60
    );
  END IF;

  UPDATE game_sessions
  SET completed_at = now()
  WHERE id = p_session_id;

  RETURN jsonb_build_object('ok', true, 'already_completed', false,
    'elapsed_seconds', v_elapsed_sec);
END;
$$;

REVOKE ALL ON FUNCTION complete_training_session(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION complete_training_session(uuid) TO authenticated;


-- ── 4. claim_speed_reward: убираем p_neurons ─────────────────────
-- Старая версия (p_session_id uuid, p_neurons int) из migration 69 удаляется.
-- Новая версия не принимает p_neurons и возвращает server_verification_unavailable,
-- пока не реализован submit_training_answer() с server-side correctness.
DROP FUNCTION IF EXISTS claim_speed_reward(uuid, int);

CREATE OR REPLACE FUNCTION claim_speed_reward(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session game_sessions%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Проверяем сессию (без FOR UPDATE — только читаем для лога)
  SELECT * INTO v_session
  FROM game_sessions
  WHERE id      = p_session_id
    AND user_id = v_user_id
    AND mode    = 'training';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  -- Speed reward временно отключён.
  -- Причина: нет server-side answer events для вычисления legitimate speed neurons.
  -- Клиент показывает локальный счётчик (UX), но wallet НЕ кредитуется.
  -- Re-enable path:
  --   1. Добавить session_questions таблицу (какие вопросы выданы в сессии)
  --   2. Реализовать submit_training_answer(session_id, question_id, selected_index)
  --   3. В claim_speed_reward: SUM(speed_neurons) по подтверждённым ответам
  RETURN jsonb_build_object(
    'ok', false,
    'reason', 'server_verification_unavailable',
    'hint', 'Speed reward requires server-side answer tracking. Pending implementation.'
  );
END;
$$;

REVOKE ALL ON FUNCTION claim_speed_reward(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION claim_speed_reward(uuid) TO authenticated;


-- ── 5. award_currency: обновляем eligibility для daily_goal ───────
-- Добавляем проверку completed_at IS NOT NULL.
-- Полная функция переписывается поверх migration 69.
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text    DEFAULT NULL,
  p_client_amount  int     DEFAULT NULL,
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
  v_day_start  timestamptz := (v_today::text || ' 00:00:00+00')::timestamptz;
  v_day_end    timestamptz := (v_day_start + interval '1 day');
  v_count      int;
  v_is_premium boolean;

  -- Типы, заблокированные в public award_currency.
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

  -- ── 1. Размер награды ──────────────────────────────────────────
  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  IF v_neurons IS NULL OR v_neurons < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unknown_operation_type');
  END IF;

  -- ── 2. Server-internal типы заблокированы ─────────────────────
  IF p_operation_type = ANY(c_blocked_types) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'use_dedicated_rpc',
      'hint', p_operation_type || ' must be claimed via its own server RPC');
  END IF;

  -- ── 3. Eligibility checks ──────────────────────────────────────

  -- referral_bonus: нужна запись в referrals (созданная через register_referral RPC)
  IF p_operation_type = 'referral_bonus' THEN
    IF NOT EXISTS (
      SELECT 1 FROM referrals WHERE invited_user_id = v_user_id LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'no_referral',
        'hint', 'referral_bonus requires a verified referral record');
    END IF;
  END IF;

  -- streak milestones: проверяем реальный стрик
  IF p_operation_type = 'streak_7_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 7) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 7);
    END IF;
  END IF;

  IF p_operation_type = 'streak_30_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 30) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 30);
    END IF;
  END IF;

  IF p_operation_type = 'streak_100_days' THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = v_user_id AND daily_streak >= 100) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'streak_not_earned', 'required_streak', 100);
    END IF;
  END IF;

  -- daily_goal: нужна завершённая training сессия сегодня (completed_at IS NOT NULL)
  IF p_operation_type IN ('daily_goal', 'daily_goal_bonus') THEN
    IF NOT EXISTS (
      SELECT 1 FROM game_sessions
      WHERE user_id     = v_user_id
        AND mode        = 'training'
        AND started_at >= v_day_start
        AND started_at <  v_day_end
        AND completed_at IS NOT NULL   -- сессия должна быть завершена
      LIMIT 1
    ) THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'daily_goal_not_earned',
        'hint', 'complete a training session (Quick Play) first');
    END IF;
  END IF;

  -- ── 4. Премиум-проверка для pack_reward ───────────────────────
  SELECT (premium_until IS NOT NULL AND premium_until > now()) INTO v_is_premium
  FROM profiles WHERE id = v_user_id;

  -- ── 5. Advisory lock для daily COUNT cap операций ─────────────
  IF p_operation_type IN ('quiz_reward', 'pack_reward') THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':daily_cap:' || p_operation_type)
    );
  END IF;

  -- ── 6. Дневные лимиты (range-based queries для btree index) ───

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

  -- ── 7. Принудительные серверные ключи ─────────────────────────
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

  -- ── 8. Ledger insert (UNIQUE = idempotency) ────────────────────
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


-- ── 6. record_training_bf: временно отключаем ─────────────────────
-- p_correct от клиента нельзя доверять (нет server-side correctness verification).
-- Функция возвращает 0, параметры сохранены для JS-совместимости.
-- Re-enable: реализовать submit_training_answer() RPC и SUM correct answers.
CREATE OR REPLACE FUNCTION record_training_bf(
  p_user_id uuid,    -- IGNORED: kept for JS backwards compatibility
  p_correct  integer -- IGNORED: client-supplied, cannot be trusted
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Training Brain Fights points temporarily disabled.
  -- Reason: p_correct comes from client and cannot be verified server-side.
  -- Architecture needed: submit_training_answer() stores per-question correctness;
  -- this function then SUMs from verified records instead of trusting p_correct.
  RETURN 0;
END;
$$;
GRANT EXECUTE ON FUNCTION record_training_bf(uuid, integer) TO authenticated;


-- ── 7. referrals: RLS + register_referral() RPC ──────────────────
-- Если таблица ещё не имеет RLS — добавляем.
-- Клиент больше не может вставлять строки напрямую.
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- Удаляем любые permissive INSERT политики
DROP POLICY IF EXISTS "referrals_insert_own"   ON public.referrals;
DROP POLICY IF EXISTS "referrals_self_insert"  ON public.referrals;
DROP POLICY IF EXISTS "referrals_write_own"    ON public.referrals;

-- SELECT: пользователь видит свои referral-записи
DROP POLICY IF EXISTS "referrals_select_own" ON public.referrals;
CREATE POLICY "referrals_select_own" ON public.referrals
  FOR SELECT USING (invited_user_id = auth.uid() OR referrer_id = auth.uid());

-- INSERT только через SECURITY DEFINER RPC (который обходит RLS как postgres)
-- → нет INSERT/UPDATE/DELETE политики для authenticated


-- Серверный RPC для создания referral-записи
CREATE OR REPLACE FUNCTION register_referral(p_ref_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_self_id     uuid := auth.uid();
  v_referrer_id uuid;
BEGIN
  IF v_self_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Разрешаем referrer по коду (server-side lookup, клиент не может подделать)
  SELECT id INTO v_referrer_id
  FROM profiles
  WHERE referral_code = UPPER(TRIM(p_ref_code))
    AND id != v_self_id;  -- нельзя реферить самого себя

  IF v_referrer_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_ref_code');
  END IF;

  -- Проверяем, что у пользователя ещё нет referral-записи
  IF EXISTS (SELECT 1 FROM referrals WHERE invited_user_id = v_self_id LIMIT 1) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_referred');
  END IF;

  -- Вставляем referral-запись server-side
  INSERT INTO referrals (
    referrer_id, invited_user_id, ref_code,
    status, reward_referrer, reward_invited,
    signed_up_at, created_at
  )
  VALUES (
    v_referrer_id, v_self_id, UPPER(TRIM(p_ref_code)),
    'signed_up', 100, 100,
    now(), now()
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'referrer_id', v_referrer_id);
END;
$$;

REVOKE ALL ON FUNCTION register_referral(text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION register_referral(text) TO authenticated;


-- ── 8. profiles: защищаем критические поля через trigger ─────────
-- BEFORE UPDATE trigger: при client-originated UPDATE (current_user='authenticated')
-- принудительно сохраняет OLD значения критических полей.
-- SECURITY DEFINER функции выполняются как 'postgres' → не затронуты.
--
-- Защищаемые поля:
--   neurons, xp           — экономика (обновляются только через award_currency/spend_neurons)
--   daily_streak          — стрик-миграция (через record_daily_activity SECURITY DEFINER)
--   referred_by           — реферальная система (через register_referral/claim_referral)
--   is_admin, is_scout    — права доступа (только через dashboard/service role)
--   premium_until         — премиум-статус (только через billing RPC)
--
-- Безопасно изменяются клиентом:
--   display_name, city, avatar_url — пользовательские данные
--   onboarding_done, onboarded    — флаг онбординга
--   team_id                       — управление командой (my-team.js)
--   ref_code                      — собственный referral-код
--   updated_at                    — timestamp

CREATE OR REPLACE FUNCTION guard_critical_profile_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- current_user = 'authenticated' → прямой PostgREST запрос от клиента
  -- current_user = 'postgres'      → вызов из SECURITY DEFINER RPC
  IF current_user = 'authenticated' THEN
    -- Экономические поля
    NEW.neurons       := OLD.neurons;
    NEW.xp            := OLD.xp;
    -- Стрик (обновляется только через record_daily_activity)
    NEW.daily_streak  := OLD.daily_streak;
    -- Реферал (устанавливается только через RPC)
    NEW.referred_by   := OLD.referred_by;
    -- Права доступа (только service_role / dashboard)
    NEW.is_admin      := OLD.is_admin;
    NEW.is_scout      := OLD.is_scout;
    -- Премиум-статус (только через billing)
    NEW.premium_until := OLD.premium_until;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_fields ON public.profiles;
CREATE TRIGGER trg_guard_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_critical_profile_fields();


-- ── Итоговые ограничения и known limitations ──────────────────────
-- (Для документации — не исполняемый код)
--
-- ОТКЛЮЧЕНО (ожидает архитектурных изменений):
--   speed_answer reward    → requires submit_training_answer() + session_questions table
--   training BF points     → requires server-verified answer events
--
-- ИЗВЕСТНЫЕ ОГРАНИЧЕНИЯ (acceptable risk):
--   quiz_reward / pack_reward   → client-side correctness; bounded by daily caps
--   daily_question              → client-side answer; deterministic daily key
--   questions.correct_index     → доступен клиенту в SELECT * (game rendering)
--   duel_rooms scores           → client-writable; duel_win заблокирован в award_currency
