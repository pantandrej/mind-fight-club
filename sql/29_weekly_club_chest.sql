-- ── Migration 29: Weekly Club Chest ──────────────────────────────
-- Every Sunday at 23:59 UTC: top-3 clubs by neurons earned that week
-- get bonus neurons distributed among their members.

-- Track weekly neurons (reset each Monday)
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS weekly_neurons int NOT NULL DEFAULT 0;
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS last_chest_at  timestamptz;

-- Index for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_teams_weekly ON teams_v2(weekly_neurons DESC);

-- ── RPC: award_weekly_neurons(club_id, amount) ────────────────────
-- Called from cron: adds neurons to the club's weekly counter
CREATE OR REPLACE FUNCTION add_club_weekly_neurons(p_club_id uuid, p_amount int)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE teams_v2 SET weekly_neurons = weekly_neurons + p_amount WHERE id = p_club_id;
END;$$;

-- ── RPC: distribute_weekly_chests() ──────────────────────────────
-- Run via pg_cron every Sunday 23:59 UTC
-- Awards bonus neurons to members of top-3 clubs
CREATE OR REPLACE FUNCTION distribute_weekly_chests()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_club  record;
  v_bonus int;
  v_rank  int := 0;
  v_total int := 0;
BEGIN
  -- Top 3 clubs with at least 100 weekly neurons
  FOR v_club IN
    SELECT id, name, weekly_neurons
    FROM teams_v2
    WHERE weekly_neurons >= 100
    ORDER BY weekly_neurons DESC
    LIMIT 3
  LOOP
    v_rank := v_rank + 1;
    v_bonus := CASE v_rank WHEN 1 THEN 500 WHEN 2 THEN 250 ELSE 100 END;

    -- Award each member of the club
    UPDATE profiles
    SET neurons = neurons + v_bonus
    WHERE club_id = v_club.id;

    -- Mark chest distributed
    UPDATE teams_v2
    SET last_chest_at = now()
    WHERE id = v_club.id;

    v_total := v_total + v_bonus;
  END LOOP;

  -- Reset weekly counters for all clubs
  UPDATE teams_v2 SET weekly_neurons = 0;

  RETURN jsonb_build_object('ok', true, 'clubs_rewarded', v_rank, 'neurons_distributed', v_total);
END;$$;
GRANT EXECUTE ON FUNCTION distribute_weekly_chests() TO service_role;

-- ── pg_cron schedule: every Sunday at 23:59 UTC ──────────────────
-- Run this once manually after migration:
-- SELECT cron.schedule('weekly-club-chest', '59 23 * * 0', 'SELECT distribute_weekly_chests()');

-- ── RPC: get_weekly_leaderboard() ────────────────────────────────
-- Returns clubs sorted by weekly_neurons with rank
CREATE OR REPLACE FUNCTION get_weekly_leaderboard(p_limit int DEFAULT 10)
RETURNS TABLE(rank bigint, club_id uuid, name text, emoji text, weekly_neurons int, member_count bigint)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT
    ROW_NUMBER() OVER (ORDER BY t.weekly_neurons DESC) AS rank,
    t.id,
    t.name,
    t.avatar_emoji AS emoji,
    t.weekly_neurons,
    COUNT(p.id) AS member_count
  FROM teams_v2 t
  LEFT JOIN profiles p ON p.club_id = t.id
  WHERE t.weekly_neurons > 0
  GROUP BY t.id, t.name, t.avatar_emoji, t.weekly_neurons
  ORDER BY t.weekly_neurons DESC
  LIMIT p_limit;
$$;
GRANT EXECUTE ON FUNCTION get_weekly_leaderboard(int) TO authenticated, anon;
