-- M92: Remove anon EXECUTE on record_daily_activity(uuid)
-- Root cause: M91 revoked FROM PUBLIC but not FROM anon explicitly.
-- anon retained an explicit EXECUTE grant. This corrects the permission.
-- Function body is NOT modified.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.record_daily_activity(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.record_daily_activity(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_daily_activity(uuid) TO authenticated;

COMMIT;
