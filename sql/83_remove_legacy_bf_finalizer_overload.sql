-- ════════════════════════════════════════════════════════════════════════════
-- Migration 83 — Remove legacy zero-arg finalize_weekly_brain_fights overload
-- ════════════════════════════════════════════════════════════════════════════
--
-- Context: Migration82 used CREATE OR REPLACE with a new signature
--   finalize_weekly_brain_fights(p_week_start date DEFAULT NULL)
-- This created a NEW overload rather than replacing the old zero-arg function:
--   finalize_weekly_brain_fights()   ← OID 21798, legacy (pre-M82)
-- Both now exist. This migration removes only the legacy overload.
--
-- Canonical function retained:
--   public.finalize_weekly_brain_fights(p_week_start date DEFAULT NULL)
--
-- Dependencies checked (pg_depend on OID 21798): none.
-- No CASCADE. No other objects touched.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.finalize_weekly_brain_fights();

COMMIT;
