-- ════════════════════════════════════════════════════════════════════════════
-- Migration 84 — Lock down BF finalizer permissions
-- ════════════════════════════════════════════════════════════════════════════
--
-- Problem: finalize_weekly_brain_fights(date) is SECURITY DEFINER but has
--   EXECUTE granted to PUBLIC, anon, and authenticated. In Supabase, any
--   public-schema function with these grants is callable via PostgREST/RPC.
--   Neither finalizer contains an internal auth/admin check.
--
-- finalize_weekly_arena_bf(uuid) already has correct permissions
--   (only postgres + service_role) — included here for consistency and to
--   guard against any future accidental re-grant.
--
-- No function bodies changed. No ownership changed. No SECURITY DEFINER changed.
-- Only EXECUTE permission changes.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.finalize_weekly_brain_fights(date)
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.finalize_weekly_arena_bf(uuid)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.finalize_weekly_brain_fights(date)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.finalize_weekly_arena_bf(uuid)
  TO service_role;

COMMIT;
