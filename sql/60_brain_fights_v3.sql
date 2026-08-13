-- ══════════════════════════════════════════════════════════════════
-- Migration 60: Brain Fights v3 — correct daily accumulation
--
-- Проблемы в предыдущих версиях:
--   1. accumulate_daily_brain_fights() считал от neurons — неверно
--   2. Бонус массовки был * 5, должен * 1
--   3. finalize в migration 55 удалял player_weekly_bf_points,
--      но team_weekly_brain_fights не обновлял в течение недели
--
-- Решение:
--   - sync_team_brain_fights_daily(): ежедневно пересчитывает
--     командный счёт из player_weekly_bf_points (TOP-3 + массовка)
--   - finalize_weekly_brain_fights(): запускает sync, затем читает
--     team_weekly_brain_fights и пишет в challenge_results
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Ежедневный пересчёт командного счёта ──────────────────────
-- Запускается каждый день в 23:55 UTC.
-- Формула: TOP-3 игрока по личным BF-баллам за неделю суммируются,
-- каждый остальной активный (total > 0) добавляет +1.
-- Перезаписывает team_weekly_brain_fights текущим состоянием.
CREATE OR REPLACE FUNCTION sync_team_brain_fights_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_team       record;
  v_top3_pts   integer;
  v_mass_pts   integer;
BEGIN
  FOR v_team IN SELECT id FROM teams LOOP
    WITH member_pts AS (
      SELECT
        COALESCE(pw.training_pts, 0)
          + COALESCE(pw.duel_pts, 0)
          + COALESCE(pw.superq_pts, 0) AS total,
        ROW_NUMBER() OVER (
          ORDER BY (COALESCE(pw.training_pts,0)
                  + COALESCE(pw.duel_pts,0)
                  + COALESCE(pw.superq_pts,0)) DESC
        ) AS rn
      FROM profiles pr
      LEFT JOIN player_weekly_bf_points pw
             ON pw.user_id = pr.id AND pw.week_start = v_week_start
      WHERE pr.team_id = v_team.id
    )
    SELECT
      COALESCE(SUM(CASE WHEN rn <= 3 THEN total ELSE 0 END), 0),
      COALESCE(COUNT(CASE WHEN rn > 3 AND total > 0 THEN 1 END)::int, 0)
    INTO v_top3_pts, v_mass_pts
    FROM member_pts;

    INSERT INTO team_weekly_brain_fights (team_id, week_start, points)
    VALUES (v_team.id, v_week_start, v_top3_pts + v_mass_pts)
    ON CONFLICT (team_id, week_start)
    DO UPDATE SET
      points     = v_top3_pts + v_mass_pts,
      updated_at = now();
  END LOOP;
END;
$$;


-- ── 2. Воскресный финал ───────────────────────────────────────────
-- Запускается в воскресенье 23:59 UTC.
-- Синхронизирует → читает team_weekly_brain_fights →
-- пишет в challenge_results → сбрасывает неделю.
CREATE OR REPLACE FUNCTION finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_row        record;
  v_rank       integer := 1;
  v_points_map int[]   := ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5];
  v_pts        integer;
BEGIN
  PERFORM sync_team_brain_fights_daily();

  FOR v_row IN
    SELECT team_id, points
    FROM team_weekly_brain_fights
    WHERE week_start = v_week_start AND points > 0
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

  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
END;
$$;


-- ── 3. Cron: убираем старый, ставим новый ────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN PERFORM cron.unschedule('daily-brain-fights');        EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('sync-team-brain-fights');    EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM cron.unschedule('weekly-brain-fights-finalize'); EXCEPTION WHEN OTHERS THEN NULL; END;
    PERFORM cron.schedule('sync-team-brain-fights',         '55 23 * * *', 'SELECT sync_team_brain_fights_daily()');
    PERFORM cron.schedule('weekly-brain-fights-finalize',   '59 23 * * 0', 'SELECT finalize_weekly_brain_fights()');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END;
$$;
