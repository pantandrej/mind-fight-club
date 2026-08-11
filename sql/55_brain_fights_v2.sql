-- ══════════════════════════════════════════════════════════════════
-- Migration 55: Brain Fights v2 — player weekly points + speed neurons
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Таблица: личные очки игрока за неделю ─────────────────────
CREATE TABLE IF NOT EXISTS public.player_weekly_bf_points (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  week_start           date NOT NULL,          -- Понедельник недели (UTC)
  -- Накопленные баллы
  training_pts         integer NOT NULL DEFAULT 0,
  duel_pts             integer NOT NULL DEFAULT 0,
  superq_pts           integer NOT NULL DEFAULT 0,
  -- Дневные лимиты: обнуляются при смене даты
  last_training_date   date,
  training_pts_today   integer NOT NULL DEFAULT 0,  -- макс 10 в день
  last_duel_date       date,
  duel_wins_today      integer NOT NULL DEFAULT 0,  -- макс 3 в день
  last_superq_date     date,                        -- 1 попытка в день
  UNIQUE (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_pwbf_user   ON public.player_weekly_bf_points(user_id);
CREATE INDEX IF NOT EXISTS idx_pwbf_week   ON public.player_weekly_bf_points(week_start);

ALTER TABLE public.player_weekly_bf_points ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pwbf_own"  ON public.player_weekly_bf_points;
DROP POLICY IF EXISTS "pwbf_read" ON public.player_weekly_bf_points;
CREATE POLICY "pwbf_own"  ON public.player_weekly_bf_points FOR ALL  USING (user_id = auth.uid());
CREATE POLICY "pwbf_read" ON public.player_weekly_bf_points FOR SELECT USING (true);


-- ── 2. RPC: запись баллов за тренировку ──────────────────────────
-- +1 балл за каждый верный ответ, макс 10 баллов в день.
CREATE OR REPLACE FUNCTION record_training_bf(
  p_user_id uuid,
  p_correct  integer
)
RETURNS integer   -- сколько баллов реально добавлено
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_add        integer;
  v_rec        player_weekly_bf_points%ROWTYPE;
BEGIN
  -- Получаем или создаём запись
  INSERT INTO player_weekly_bf_points (user_id, week_start)
  VALUES (p_user_id, v_week_start)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  SELECT * INTO v_rec FROM player_weekly_bf_points
  WHERE user_id = p_user_id AND week_start = v_week_start;

  -- Если дата изменилась — сбрасываем дневной счётчик
  IF v_rec.last_training_date IS DISTINCT FROM v_today THEN
    v_rec.training_pts_today := 0;
    v_rec.last_training_date := v_today;
  END IF;

  -- Сколько можно добавить (до лимита 10/день)
  v_add := LEAST(GREATEST(p_correct, 0), 10 - v_rec.training_pts_today);
  IF v_add <= 0 THEN RETURN 0; END IF;

  UPDATE player_weekly_bf_points SET
    training_pts       = training_pts + v_add,
    training_pts_today = v_rec.training_pts_today + v_add,
    last_training_date = v_today
  WHERE user_id = p_user_id AND week_start = v_week_start;

  RETURN v_add;
END;
$$;


-- ── 3. RPC: запись победы в дуэли ────────────────────────────────
-- +3 балла за победу, макс 3 победы в день (9 баллов).
CREATE OR REPLACE FUNCTION record_duel_win_bf(p_user_id uuid)
RETURNS boolean   -- true = баллы начислены, false = лимит исчерпан
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_rec        player_weekly_bf_points%ROWTYPE;
BEGIN
  INSERT INTO player_weekly_bf_points (user_id, week_start)
  VALUES (p_user_id, v_week_start)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  SELECT * INTO v_rec FROM player_weekly_bf_points
  WHERE user_id = p_user_id AND week_start = v_week_start;

  IF v_rec.last_duel_date IS DISTINCT FROM v_today THEN
    v_rec.duel_wins_today := 0;
    v_rec.last_duel_date  := v_today;
  END IF;

  IF v_rec.duel_wins_today >= 3 THEN RETURN false; END IF;

  UPDATE player_weekly_bf_points SET
    duel_pts       = duel_pts + 3,
    duel_wins_today = v_rec.duel_wins_today + 1,
    last_duel_date  = v_today
  WHERE user_id = p_user_id AND week_start = v_week_start;

  RETURN true;
END;
$$;


-- ── 4. RPC: запись Супервопроса дня ──────────────────────────────
-- +5 за верный ответ, +1 за попытку. 1 попытка в день.
CREATE OR REPLACE FUNCTION record_superq_bf(
  p_user_id  uuid,
  p_correct  boolean
)
RETURNS integer   -- 5/1/0 (0 = уже отвечал сегодня)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_rec        player_weekly_bf_points%ROWTYPE;
  v_add        integer;
BEGIN
  INSERT INTO player_weekly_bf_points (user_id, week_start)
  VALUES (p_user_id, v_week_start)
  ON CONFLICT (user_id, week_start) DO NOTHING;

  SELECT * INTO v_rec FROM player_weekly_bf_points
  WHERE user_id = p_user_id AND week_start = v_week_start;

  IF v_rec.last_superq_date = v_today THEN RETURN 0; END IF;

  v_add := CASE WHEN p_correct THEN 5 ELSE 1 END;

  UPDATE player_weekly_bf_points SET
    superq_pts    = superq_pts + v_add,
    last_superq_date = v_today
  WHERE user_id = p_user_id AND week_start = v_week_start;

  RETURN v_add;
END;
$$;


-- ── 5. Перезаписываем finalize_weekly_brain_fights ────────────────
-- TOP-3 суммируются, каждый остальной активный игрок добавляет +5
CREATE OR REPLACE FUNCTION finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_team       record;
  v_rank       integer := 1;
  v_points_map int[]   := ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5];
  v_pts        integer;
BEGIN
  FOR v_team IN
    WITH member_pts AS (
      SELECT
        pr.team_id,
        COALESCE(pw.training_pts, 0) + COALESCE(pw.duel_pts, 0) + COALESCE(pw.superq_pts, 0) AS total,
        ROW_NUMBER() OVER (PARTITION BY pr.team_id
                           ORDER BY (COALESCE(pw.training_pts,0)+COALESCE(pw.duel_pts,0)+COALESCE(pw.superq_pts,0)) DESC) AS rn
      FROM profiles pr
      LEFT JOIN player_weekly_bf_points pw
             ON pw.user_id = pr.id AND pw.week_start = v_week_start
      WHERE pr.team_id IS NOT NULL
    )
    SELECT
      team_id,
      COALESCE(SUM(CASE WHEN rn <= 3 THEN total ELSE 0 END), 0)
        + COALESCE(COUNT(CASE WHEN rn > 3 AND total > 0 THEN 1 END)::int * 5, 0) AS team_score
    FROM member_pts
    GROUP BY team_id
    HAVING SUM(CASE WHEN rn <= 3 THEN total ELSE 0 END) > 0
    ORDER BY team_score DESC
  LOOP
    v_pts := CASE
      WHEN v_rank <= array_length(v_points_map, 1) THEN v_points_map[v_rank]
      ELSE 0
    END;
    IF v_pts > 0 THEN
      INSERT INTO challenge_results (team_id, provider_id, challenge_type, rank, points_earned)
      VALUES (v_team.team_id, 'bfc_internal', 'brain_fights', v_rank, v_pts);
    END IF;
    v_rank := v_rank + 1;
  END LOOP;

  -- Сбрасываем недельные баллы
  DELETE FROM player_weekly_bf_points WHERE week_start = v_week_start;
END;
$$;


-- ── 6. Добавляем speed_answer в экономику нейронов ───────────────
-- Клиент передаёт timeLeft (0-30), сервер клампит.
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY
  SELECT
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 2250)
      WHEN 'speed_answer'        THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 1), 30)
      WHEN 'duel_win'            THEN 0   -- теперь нейроны идут через speed_answer
      WHEN 'duel_loss'           THEN 0
      WHEN 'duel_tie'            THEN 0
      WHEN 'tournament_reward'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      WHEN 'daily_login'         THEN 20
      WHEN 'referral_bonus'      THEN 100
      WHEN 'onboarding_complete' THEN 50
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'daily_question'      THEN 25
      WHEN 'partner_task'        THEN 50
      ELSE 10
    END::int AS neurons,
    CASE p_type
      WHEN 'quiz_reward'         THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 2250)
      WHEN 'speed_answer'        THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 1), 30)
      WHEN 'duel_win'            THEN 0
      WHEN 'duel_loss'           THEN 0
      WHEN 'duel_tie'            THEN 0
      WHEN 'tournament_reward'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 0), 150)
      WHEN 'daily_login'         THEN 20
      WHEN 'referral_bonus'      THEN 20
      WHEN 'onboarding_complete' THEN 10
      WHEN 'streak_7_days'       THEN 50
      WHEN 'streak_30_days'      THEN 200
      WHEN 'streak_100_days'     THEN 500
      WHEN 'daily_question'      THEN 10
      WHEN 'partner_task'        THEN 50
      ELSE 10
    END::int AS xp;
END;
$$;


-- ── 7. Cron: только воскресенье 23:59 ────────────────────────────
-- daily-brain-fights больше не нужен (баллы пишутся в реальном времени)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('daily-brain-fights');
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    PERFORM cron.schedule(
      'weekly-brain-fights-finalize',
      '59 23 * * 0',
      'SELECT finalize_weekly_brain_fights()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
