-- ══════════════════════════════════════════════════════════════════
-- Migration 61: Economy Reset + City-Based BF Rankings
--
-- Изменения:
--   1. Обнуление нейронов и недельных BF-баллов
--   2. Нейроны — только speed_answer (1-30) + referral_bonus + partner_task
--   3. finalize_weekly_brain_fights — рейтинг по городу:
--      1 место = 100 очков, 2 = 80, 3 = 60, 4 = 40, 5 = 20, далее = 10
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Сброс ──────────────────────────────────────────────────────
UPDATE profiles SET neurons = 0, xp = 0;
DELETE FROM player_weekly_bf_points;
DELETE FROM team_weekly_brain_fights;


-- ── 2. Новая формула нейронов ──────────────────────────────────────
-- Нейроны = только скорость ответа + рефералы + партнёрские задания
CREATE OR REPLACE FUNCTION _bfc_award_amounts(p_type text, p_client_amount int DEFAULT NULL)
RETURNS TABLE(neurons int, xp int)
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  RETURN QUERY SELECT
    CASE p_type
      WHEN 'speed_answer'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 1), 30)
      WHEN 'referral_bonus' THEN 100
      WHEN 'partner_task'   THEN 50
      ELSE 0
    END::int AS neurons,
    CASE p_type
      WHEN 'speed_answer'   THEN LEAST(GREATEST(COALESCE(p_client_amount, 0), 1), 30)
      WHEN 'referral_bonus' THEN 20
      WHEN 'partner_task'   THEN 20
      ELSE 0
    END::int AS xp;
END;
$$;


-- ── 3. Финал недели — рейтинг по городу ───────────────────────────
-- Запускается в воскресенье 23:59 UTC.
-- 1) Синхронизирует командные счета из player_weekly_bf_points
-- 2) Ранжирует команды ВНУТРИ ГОРОДА по накопленным баллам
-- 3) Начисляет очки в challenge_results (тип brain_fights)
-- 4) Сбрасывает недельные счетчики
CREATE OR REPLACE FUNCTION finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  -- 1 место = 100, 2 = 80, 3 = 60, 4 = 40, 5 = 20, 6+ = 10
  v_points_map int[] := ARRAY[100, 80, 60, 40, 20, 10];
  v_row        record;
  v_pts        integer;
BEGIN
  -- Сначала синхронизируем командные счета из личных очков игроков
  PERFORM sync_team_brain_fights_daily();

  -- Ранжируем по городу и начисляем очки
  FOR v_row IN
    WITH city_ranked AS (
      SELECT
        tw.team_id,
        tw.points AS weekly_pts,
        t.city,
        ROW_NUMBER() OVER (
          PARTITION BY t.city
          ORDER BY tw.points DESC
        ) AS city_rank
      FROM team_weekly_brain_fights tw
      JOIN teams t ON t.id = tw.team_id
      WHERE tw.week_start = v_week_start
        AND tw.points > 0
        AND t.city IS NOT NULL AND t.city != ''
    )
    SELECT team_id, weekly_pts, city, city_rank,
           CASE
             WHEN city_rank <= array_length(v_points_map, 1) THEN v_points_map[city_rank]
             ELSE 10
           END AS pts_awarded
    FROM city_ranked
  LOOP
    INSERT INTO challenge_results (team_id, provider_id, challenge_type, rank, points_earned)
    VALUES (v_row.team_id, 'bfc_internal', 'brain_fights', v_row.city_rank, v_row.pts_awarded);
  END LOOP;

  -- Сбрасываем недельные счетчики
  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
END;
$$;
