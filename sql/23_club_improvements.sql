-- ── Club total_neurons auto-sync trigger ──────────────────────────
-- Fires when profiles.neurons changes (via award_currency RPC)
CREATE OR REPLACE FUNCTION _sync_club_neurons()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Sync old club (if user left or moved)
  IF OLD.club_id IS NOT NULL AND OLD.club_id IS DISTINCT FROM NEW.club_id THEN
    UPDATE clubs
      SET total_neurons = GREATEST(0, (
        SELECT COALESCE(SUM(p.neurons), 0) FROM profiles p WHERE p.club_id = OLD.club_id
      ))
      WHERE id = OLD.club_id;
  END IF;
  -- Sync current club
  IF NEW.club_id IS NOT NULL THEN
    UPDATE clubs
      SET total_neurons = (
        SELECT COALESCE(SUM(p.neurons), 0) FROM profiles p WHERE p.club_id = NEW.club_id
      )
      WHERE id = NEW.club_id;
  END IF;
  RETURN NEW;
END;$$;

DROP TRIGGER IF EXISTS trg_sync_club_neurons ON profiles;
CREATE TRIGGER trg_sync_club_neurons
  AFTER UPDATE OF neurons, club_id ON profiles
  FOR EACH ROW EXECUTE FUNCTION _sync_club_neurons();

-- ── Streak restore RPC ─────────────────────────────────────────────
-- Deducts neurons and resets daily_streak to 1 so user can continue.
-- Cost: 50 neurons (server-side, client can't fake it).
CREATE OR REPLACE FUNCTION restore_streak()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cost    int  := 50;
  v_neurons int;
  v_streak  int;
BEGIN
  SELECT neurons, daily_streak INTO v_neurons, v_streak
    FROM profiles WHERE id = auth.uid() FOR UPDATE;

  IF v_neurons IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;
  IF v_neurons < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_enough', 'need', v_cost, 'have', v_neurons);
  END IF;
  IF v_streak > 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'streak_active');
  END IF;

  UPDATE profiles
    SET neurons       = neurons - v_cost,
        daily_streak  = 1,
        updated_at    = now()
    WHERE id = auth.uid();

  RETURN jsonb_build_object('ok', true, 'cost', v_cost, 'new_streak', 1);
END;$$;

GRANT EXECUTE ON FUNCTION restore_streak() TO authenticated;
