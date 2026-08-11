-- ══════════════════════════════════════════════════════════════════
-- Migration 42: Brain Fights discipline + weekly accumulation
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Обновляем CHECK на challenge_results ───────────────────────
ALTER TABLE public.challenge_results
  DROP CONSTRAINT IF EXISTS challenge_results_challenge_type_check;

ALTER TABLE public.challenge_results
  ADD CONSTRAINT challenge_results_challenge_type_check
  CHECK (challenge_type IN ('bar_quiz', 'online_quiz', 'brain_fights'));

-- ── 2. Недельная таблица Brain Fights ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.team_weekly_brain_fights (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id      uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  week_start   date NOT NULL,  -- Monday 00:00 UTC
  points       integer NOT NULL DEFAULT 0,
  updated_at   timestamptz DEFAULT now(),
  UNIQUE (team_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_twbf_week ON public.team_weekly_brain_fights(week_start);
CREATE INDEX IF NOT EXISTS idx_twbf_team ON public.team_weekly_brain_fights(team_id);

ALTER TABLE public.team_weekly_brain_fights ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "twbf_read" ON public.team_weekly_brain_fights;
CREATE POLICY "twbf_read" ON public.team_weekly_brain_fights FOR SELECT USING (true);


-- ── 3. Функция: начислить дневные баллы команде в Brain Fights ────
-- Вызывается ежедневно в 23:55 UTC для каждой команды.
-- База = сумма нейронов ТОП-3 игроков за сутки + 5 за каждого активного.
-- "Активный" = сделал quiz_reward или daily_goal_bonus за сутки.
CREATE OR REPLACE FUNCTION accumulate_daily_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - EXTRACT(DOW FROM v_today)::int + 1; -- Monday
  v_team       record;
  v_top3       integer;
  v_active_cnt integer;
  v_points     integer;
BEGIN
  FOR v_team IN SELECT id FROM teams LOOP

    -- Сумма нейронов ТОП-3 игроков команды
    SELECT COALESCE(SUM(neurons), 0) INTO v_top3
    FROM (
      SELECT neurons FROM profiles
      WHERE team_id = v_team.id
      ORDER BY neurons DESC NULLS LAST
      LIMIT 3
    ) t;

    -- Кол-во активных игроков сегодня
    SELECT COUNT(DISTINCT p.id) INTO v_active_cnt
    FROM profiles p
    WHERE p.team_id = v_team.id
      AND EXISTS (
        SELECT 1 FROM currency_ledger cl
        WHERE cl.user_id = p.id
          AND cl.operation_type IN ('quiz_reward', 'daily_goal_bonus', 'duel_win')
          AND cl.created_at::date = v_today
      );

    v_points := v_top3 + (v_active_cnt * 5);

    -- Upsert в недельную таблицу
    INSERT INTO team_weekly_brain_fights (team_id, week_start, points)
    VALUES (v_team.id, v_week_start, v_points)
    ON CONFLICT (team_id, week_start)
    DO UPDATE SET
      points     = team_weekly_brain_fights.points + EXCLUDED.points,
      updated_at = now();

  END LOOP;
END;
$$;


-- ── 4. Функция: воскресный подсчёт → challenge_results ────────────
-- Запускается в воскресенье 23:59 UTC.
-- Берёт топ команд по points за текущую неделю, раздаёт места,
-- записывает турнирные очки в challenge_results, сбрасывает неделю.
CREATE OR REPLACE FUNCTION finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date;
  v_row        record;
  v_rank       integer := 1;
  v_points_map int[]   := ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5];
  v_pts        integer;
BEGIN
  -- Текущая понедельная дата
  v_week_start := (now() AT TIME ZONE 'UTC')::date
                  - EXTRACT(DOW FROM (now() AT TIME ZONE 'UTC'))::int + 1;

  FOR v_row IN
    SELECT team_id, points
    FROM team_weekly_brain_fights
    WHERE week_start = v_week_start
    ORDER BY points DESC
  LOOP
    v_pts := CASE
      WHEN v_rank <= array_length(v_points_map, 1) THEN v_points_map[v_rank]
      ELSE 0
    END;

    IF v_pts > 0 THEN
      INSERT INTO challenge_results (team_id, provider_id, challenge_type, rank, points_earned)
      VALUES (v_row.team_id, 'bfc_internal', 'brain_fights', v_rank, v_pts);
    END IF;

    v_rank := v_rank + 1;
  END LOOP;

  -- Сбрасываем недельные баллы
  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
END;
$$;


-- ── 5. Cron через pg_cron (если расширение активно в Supabase) ────
-- Если pg_cron не активен — задачи нужно запускать вручную или через Edge Function.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'daily-brain-fights',
      '55 23 * * *',
      'SELECT accumulate_daily_brain_fights()'
    );
    PERFORM cron.schedule(
      'weekly-brain-fights-finalize',
      '59 23 * * 0',
      'SELECT finalize_weekly_brain_fights()'
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL; -- pg_cron недоступен, пропускаем
END;
$$;
