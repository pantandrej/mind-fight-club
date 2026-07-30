-- ══════════════════════════════════════════════════════════════════
-- Migration 40: Teams, Challenge Results, Fixed Economy, Super Question
-- ══════════════════════════════════════════════════════════════════


-- ── 1. PROVIDERS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.providers (
  id   text PRIMARY KEY,
  name text NOT NULL
);

INSERT INTO public.providers (id, name) VALUES
  ('li_spb',       'Лига Интеллекта СПб'),
  ('mysliclub',    'Мысликлаб'),
  ('quiz_please',  'Quiz Please'),
  ('mozgobojnia',  'Мозгобойня'),
  ('bfc_internal', 'BFC Internal')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.providers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "providers_read" ON public.providers;
CREATE POLICY "providers_read" ON public.providers FOR SELECT USING (true);


-- ── 2. TEAMS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.teams (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  city       text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "teams_read"   ON public.teams;
DROP POLICY IF EXISTS "teams_insert" ON public.teams;
CREATE POLICY "teams_read"   ON public.teams FOR SELECT USING (true);
CREATE POLICY "teams_insert" ON public.teams FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);


-- ── 3. CHALLENGE RESULTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.challenge_results (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  provider_id    text REFERENCES public.providers(id),
  challenge_type text NOT NULL CHECK (challenge_type IN ('bar_quiz', 'online_quiz')),
  rank           integer NOT NULL CHECK (rank BETWEEN 1 AND 100),
  points_earned  integer NOT NULL DEFAULT 0,
  created_at     timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_challenge_team ON public.challenge_results(team_id);
CREATE INDEX IF NOT EXISTS idx_challenge_type ON public.challenge_results(challenge_type);
CREATE INDEX IF NOT EXISTS idx_challenge_date ON public.challenge_results(created_at);

ALTER TABLE public.challenge_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "challenge_results_read" ON public.challenge_results;
CREATE POLICY "challenge_results_read" ON public.challenge_results FOR SELECT USING (true);


-- ── 4. DAILY SUPER QUESTIONS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_super_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id    text REFERENCES public.providers(id),
  question_text  text NOT NULL,
  image_url      text,
  correct_answer text NOT NULL,
  active_date    date NOT NULL UNIQUE
);

ALTER TABLE public.daily_super_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "super_questions_read" ON public.daily_super_questions;
CREATE POLICY "super_questions_read" ON public.daily_super_questions FOR SELECT USING (true);


-- ── 5. USER SUPER QUESTION ATTEMPTS ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_super_question_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.daily_super_questions(id),
  is_correct  boolean NOT NULL,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON public.user_super_question_attempts(user_id);

ALTER TABLE public.user_super_question_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "attempts_own_insert" ON public.user_super_question_attempts;
DROP POLICY IF EXISTS "attempts_own_read"   ON public.user_super_question_attempts;
CREATE POLICY "attempts_own_insert" ON public.user_super_question_attempts
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "attempts_own_read" ON public.user_super_question_attempts
  FOR SELECT USING (auth.uid() = user_id);


-- ── 6. ALTER PROFILES ─────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS team_id  uuid REFERENCES public.teams(id),
  ADD COLUMN IF NOT EXISTS is_scout boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_profiles_team ON public.profiles(team_id);


-- ── 7. FIXED ECONOMY — обновляем таблицу начислений ──────────────
--
-- Новая логика:
--   quiz_reward     → фиксировано +2 за каждый верный ответ
--                     клиент передаёт кол-во верных ответов в p_client_amount
--                     сервер умножает × 2, cap 20 (макс 10 верных)
--   daily_goal_bonus → +50, 1 раз в сутки (без изменений)
--   duel_win        → +15 за победу, макс 3 победы в сутки
--   super_question  → +10, через отдельный RPC answer_super_question
--   streak_*        → без изменений (milestone-based)
--
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY SELECT
    CASE p_type
      -- Тренировка: +2 за каждый верный ответ, cap 20
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0) * 2, 20)
      -- Дуэль: +15 за победу (лимит 3/день — проверяется в award_currency)
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      -- Турнир: место-based (передаётся клиентом, сервер обрезает)
      WHEN 'tournament_reward'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      -- Ежедневный бонус
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      -- Реферал и онбординг
      WHEN 'referral_bonus'      THEN 100
      WHEN 'onboarding_complete' THEN 50
      -- Стрики
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      -- Супервопрос — через отдельный RPC, сюда не должен приходить
      WHEN 'super_question'      THEN 10
      ELSE 0
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0) * 2, 20)
      WHEN 'duel_win'            THEN 15
      WHEN 'duel_loss'           THEN  0
      WHEN 'duel_tie'            THEN  0
      WHEN 'tournament_reward'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      WHEN 'daily_goal_bonus'    THEN 50
      WHEN 'daily_login'         THEN 20
      WHEN 'referral_bonus'      THEN 20
      WHEN 'onboarding_complete' THEN 10
      WHEN 'streak_reward'       THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 500)
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'super_question'      THEN 10
      ELSE 0
    END::int AS xp;
END;
$$;


-- ── 8. ОБНОВЛЯЕМ award_currency — добавляем лимит на дуэли ───────
CREATE OR REPLACE FUNCTION award_currency(
  p_operation_type text,
  p_operation_key  text DEFAULT NULL,
  p_client_amount  int  DEFAULT NULL
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
  v_duel_count int;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Суточный лимит дуэлей: первые 3 победы в день платные
  IF p_operation_type = 'duel_win' THEN
    SELECT COUNT(*) INTO v_duel_count
    FROM currency_ledger
    WHERE user_id = v_user_id
      AND operation_type = 'duel_win'
      AND created_at::date = v_today;

    IF v_duel_count >= 3 THEN
      SELECT neurons, xp INTO v_profile.neurons, v_profile.xp
      FROM profiles WHERE id = v_user_id;
      RETURN jsonb_build_object(
        'ok', true, 'daily_limit_reached', true,
        'neurons', v_profile.neurons, 'xp', v_profile.xp,
        'awarded_neurons', 0, 'awarded_xp', 0
      );
    END IF;
  END IF;

  SELECT n.neurons, n.xp INTO v_neurons, v_xp
  FROM _bfc_award_amounts(p_operation_type, p_client_amount) n;

  -- Idempotency key: явный или ежедневный по типу
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
      xp         = COALESCE(xp, 0)      + v_xp,
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

REVOKE ALL ON FUNCTION award_currency(text, text, int) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION award_currency(text, text, int) TO authenticated;


-- ── 9. RPC: ОТВЕТ НА СУПЕРВОПРОС ─────────────────────────────────
CREATE OR REPLACE FUNCTION answer_super_question(
  p_question_id uuid,
  p_answer      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_correct_ans text;
  v_active_date date;
  v_is_correct  boolean;
  v_profile     profiles%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Получаем вопрос
  SELECT correct_answer, active_date
  INTO v_correct_ans, v_active_date
  FROM daily_super_questions
  WHERE id = p_question_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'question_not_found';
  END IF;

  -- Проверяем что вопрос активен сегодня
  IF v_active_date != (now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'question_expired';
  END IF;

  -- 1 попытка в день (UNIQUE constraint)
  BEGIN
    v_is_correct := lower(trim(p_answer)) = lower(trim(v_correct_ans));

    INSERT INTO user_super_question_attempts (user_id, question_id, is_correct)
    VALUES (v_user_id, p_question_id, v_is_correct);
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_attempted';
  END;

  -- Начисляем +10 если верно
  IF v_is_correct THEN
    INSERT INTO currency_ledger (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
    VALUES (v_user_id, 'super_question', 'sq_' || p_question_id::text || '_' || v_user_id::text, 10, 10)
    ON CONFLICT DO NOTHING;

    UPDATE profiles
    SET neurons = COALESCE(neurons, 0) + 10,
        xp      = COALESCE(xp, 0)      + 10
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  ELSE
    SELECT * INTO v_profile FROM profiles WHERE id = v_user_id;
  END IF;

  RETURN jsonb_build_object(
    'is_correct',     v_is_correct,
    'correct_answer', CASE WHEN v_is_correct THEN v_correct_ans ELSE NULL END,
    'neurons',        v_profile.neurons,
    'xp',             v_profile.xp,
    'awarded',        CASE WHEN v_is_correct THEN 10 ELSE 0 END
  );
END;
$$;

REVOKE ALL ON FUNCTION answer_super_question(uuid, text) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION answer_super_question(uuid, text) TO authenticated;


-- ── 10. ФУНКЦИЯ КОМАНДНОГО ТАЙ-БРЕЙКЕРА ──────────────────────────
--
-- Возвращает: SUM(нейроны ТОП-3 игроков) + (кол-во активных сегодня × 5)
-- Активный = провёл тренировку ИЛИ ответил на супервопрос сегодня
--
CREATE OR REPLACE FUNCTION get_team_tiebreaker(p_team_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  v_today AS (
    SELECT (now() AT TIME ZONE 'UTC')::date AS d
  ),
  top3 AS (
    SELECT COALESCE(SUM(neurons), 0) AS base
    FROM (
      SELECT neurons
      FROM profiles
      WHERE team_id = p_team_id
      ORDER BY neurons DESC NULLS LAST
      LIMIT 3
    ) t
  ),
  active_today AS (
    SELECT COUNT(DISTINCT p.id) AS cnt
    FROM profiles p
    CROSS JOIN v_today
    WHERE p.team_id = p_team_id
      AND (
        -- Тренировка сегодня
        EXISTS (
          SELECT 1 FROM currency_ledger cl
          WHERE cl.user_id = p.id
            AND cl.operation_type IN ('quiz_reward', 'daily_goal_bonus')
            AND cl.created_at::date = v_today.d
        )
        OR
        -- Попытка супервопроса сегодня
        EXISTS (
          SELECT 1 FROM user_super_question_attempts a
          JOIN daily_super_questions q ON q.id = a.question_id
          WHERE a.user_id = p.id
            AND q.active_date = v_today.d
        )
      )
  )
  SELECT (top3.base + (active_today.cnt * 5))::integer
  FROM top3, active_today;
$$;

GRANT EXECUTE ON FUNCTION get_team_tiebreaker(uuid) TO authenticated, anon;


-- ── 11. RPC: СКАУТ ВНОСИТ РЕЗУЛЬТАТЫ БАР-КВИЗА ───────────────────
--
-- Принимает: provider_id + массив [{name, rank}]
-- Сопоставляет названия команд (без учёта регистра)
-- Очки по месту: 1→100, 2→80, 3→60, 4→40, 5→30, 6→25, 7→20, 8→15, 9→10, 10→5
--
CREATE OR REPLACE FUNCTION scout_record_bar_quiz(
  p_provider_id text,
  p_results     jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id   uuid := auth.uid();
  v_is_scout  boolean;
  v_entry     jsonb;
  v_team_id   uuid;
  v_rank      integer;
  v_points    integer;
  v_inserted  integer := 0;
  v_not_found text[]  := '{}';
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'not_authenticated'; END IF;

  SELECT is_scout INTO v_is_scout FROM profiles WHERE id = v_user_id;
  IF NOT COALESCE(v_is_scout, false) THEN RAISE EXCEPTION 'not_authorized'; END IF;

  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    v_rank := (v_entry->>'rank')::integer;

    IF v_rank < 1 OR v_rank > 10 THEN CONTINUE; END IF;

    v_points := CASE v_rank
      WHEN 1  THEN 100
      WHEN 2  THEN  80
      WHEN 3  THEN  60
      WHEN 4  THEN  40
      WHEN 5  THEN  30
      WHEN 6  THEN  25
      WHEN 7  THEN  20
      WHEN 8  THEN  15
      WHEN 9  THEN  10
      WHEN 10 THEN   5
      ELSE 0
    END;

    SELECT id INTO v_team_id
    FROM teams
    WHERE lower(trim(name)) = lower(trim(v_entry->>'name'))
    LIMIT 1;

    IF v_team_id IS NULL THEN
      v_not_found := array_append(v_not_found, v_entry->>'name');
      CONTINUE;
    END IF;

    INSERT INTO challenge_results (team_id, provider_id, challenge_type, rank, points_earned)
    VALUES (v_team_id, p_provider_id, 'bar_quiz', v_rank, v_points);

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'inserted',   v_inserted,
    'not_found',  v_not_found
  );
END;
$$;

REVOKE ALL ON FUNCTION scout_record_bar_quiz(text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION scout_record_bar_quiz(text, jsonb) TO authenticated;
