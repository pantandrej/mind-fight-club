-- Fix sync_tournament_statuses to actually mark finished
CREATE OR REPLACE FUNCTION sync_tournament_statuses()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r tournaments%ROWTYPE;
  q_count int;
  ends_at timestamptz;
BEGIN
  FOR r IN SELECT * FROM tournaments WHERE status != 'finished' LOOP
    IF r.status = 'upcoming' AND r.starts_at <= now() THEN
      UPDATE tournaments SET status = 'active' WHERE id = r.id;
    END IF;
    -- Count questions in pack to compute end time
    SELECT COUNT(*) INTO q_count FROM questions WHERE pack_id = r.pack_id;
    IF q_count = 0 THEN q_count := 15; END IF;
    ends_at := r.starts_at + ((q_count * (r.q_duration + r.a_duration)) || ' seconds')::interval;
    IF ends_at <= now() THEN
      UPDATE tournaments SET status = 'finished' WHERE id = r.id;
    END IF;
  END LOOP;
END;
$$;
