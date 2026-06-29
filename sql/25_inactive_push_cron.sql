-- ── Helper RPC for inactive push job ──────────────────────────────
-- Returns users with push subscriptions who haven't played since `cutoff`
CREATE OR REPLACE FUNCTION get_inactive_users_with_push(cutoff timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_agg(
    jsonb_build_object(
      'user_id', u.id,
      'display_name', u.display_name,
      'subscriptions', (
        SELECT jsonb_agg(jsonb_build_object('id', ps.id, 'endpoint', ps.endpoint, 'keys', ps.keys))
        FROM push_subscriptions ps WHERE ps.user_id = u.id
      )
    )
  ) INTO result
  FROM profiles u
  WHERE EXISTS (SELECT 1 FROM push_subscriptions ps WHERE ps.user_id = u.id)
    AND NOT EXISTS (
      SELECT 1 FROM game_sessions gs
      WHERE gs.user_id = u.id AND gs.created_at >= cutoff
    );
  RETURN COALESCE(result, '[]'::jsonb);
END;$$;

-- ── pg_cron schedule (run once after enabling pg_cron extension) ───
-- Enable extension first in Supabase Dashboard → Database → Extensions → pg_cron
-- Then uncomment and run:
--
-- SELECT cron.schedule(
--   'push-inactive-daily',
--   '0 10 * * *',   -- every day at 10:00 UTC
--   $$
--   SELECT net.http_post(
--     url      := 'https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/push-inactive-users',
--     body     := '{}'::jsonb,
--     headers  := jsonb_build_object(
--       'Content-Type',  'application/json',
--       'Authorization', 'Bearer ' || current_setting('app.service_role_key')
--     )
--   );
--   $$
-- );
