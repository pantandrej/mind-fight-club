-- ══════════════════════════════════════════════════════════════════════════
-- Migration 75 v5: Teams Core — captain, join_code, soft-delete, RPCs
--
-- v1 fixes: soft-delete, ON DELETE RESTRICT, idempotent policies,
--           disbanded guard, captain trigger, donate hardening.
-- v2 fixes: disbaned team UI, invite URL, scout silent no-op, activity panel.
-- v3 fixes: captain delete clears all members, global join_code uniqueness,
--           _gen_team_join_code checks all teams, TMH SELECT narrowed,
--           join_team_by_code explicit conflict, create_team checks history,
--           leave/kick handle missing history, XSS _escHtml, scout section.
-- v4 fixes:
--  1. regenerate_team_code REMOVED — join_code is permanent.
--  2. teams write policy cleanup now includes DELETE.
--  3. update_team_profile: explicit REVOKE/GRANT added.
--  4. get_my_team_roster() RPC added.
--  5. get_my_team_activity_today() RPC added.
--  6. update_my_team: server-side field length limits + https://.
--  7. Captain backfill: no legacy captain field; oldest member fallback.
--  8. Tiebreak icon: JS concern (fixed in JS).
-- v5 fixes:
--  9. update_team_profile (legacy) bypassed validation — now a thin wrapper
--     around _apply_team_profile_update(), same validation as update_my_team.
-- 10. create_team: added city <= 60, emoji <= 8 server-side limits.
-- v6 pre-flight fixes (defensive idempotency):
-- 11. §1 now ensures treasury_neurons (from mig 63) and team identity columns
--     (motto/banner_url/avatar_url/emoji from mig 57) exist via IF NOT EXISTS.
-- 12. team_treasury_ledger (from mig 63) created IF NOT EXISTS before RLS block.
-- 13. Entire migration wrapped in BEGIN/COMMIT for atomic execution.
-- v7 security fix — join_code enumeration:
-- 14. Enable RLS on teams (was missing — policies existed but had no effect).
-- 15. REVOKE SELECT on teams from authenticated/anon; GRANT SELECT only on
--     safe public columns (join_code excluded). Direct sb.from('teams').select(*)
--     or any explicit join_code select → permission denied.
-- 16. get_my_team() RPC: returns full team row incl. join_code for own team only.
-- 17. get_public_team(uuid) RPC: returns public fields, never join_code.
-- 18. join_team_by_legacy_id(uuid) RPC: handles ?join=UUID invite links
--     server-side — looks up join_code internally, never returns it to client.
-- 19. my-team.js: replaced direct teams SELECT with get_my_team() RPC;
--     legacy UUID invite path uses join_team_by_legacy_id().
--
-- Dependency audit (all tables/columns used but not created here):
--   teams                             ← migration 40
--   profiles (auth.users extension)   ← pre-migration (Supabase auth)
--   profiles.team_id                  ← migration 40
--   profiles.neurons                  ← migration 04 (currency_ledger RPC)
--   profiles.is_scout                 ← migration 40
--   teams.motto/banner_url/avatar_url/emoji ← migration 57 (+ IF NOT EXISTS here)
--   teams.treasury_neurons (bigint)   ← migration 63 (+ IF NOT EXISTS here)
--   team_treasury_ledger              ← migration 63 (+ CREATE IF NOT EXISTS here)
--   team_weekly_brain_fights          ← migration 42
--   challenge_results                 ← migration 40
--   user_super_question_attempts      ← migration 40
--   currency_ledger                   ← migration 04
--
-- Does NOT touch migrations 68–74.
-- Does NOT implement Brain Fights formula (future iteration).
-- Does NOT monetize anything.
-- ══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── §1  Schema: add columns to teams ─────────────────────────────────────
-- captain_id: nullable (NULL = captain deleted or team not yet migrated).
-- join_code:  6-char uppercase alpha, generated once at team creation. Permanent.
-- disbanded_at: NULL = active, NOT NULL = disbanded (soft-delete).
-- updated_at: audit timestamp referenced by RPCs.
--
-- Defensive: also ensure columns from earlier migrations exist.
-- treasury_neurons: migration 63. motto/banner_url/avatar_url/emoji: migration 57.
-- IF NOT EXISTS means re-runs are safe; applied migrations are no-ops.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS captain_id      uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS join_code       text,
  ADD COLUMN IF NOT EXISTS disbanded_at    timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz,
  -- From migration 57 (team profiles):
  ADD COLUMN IF NOT EXISTS motto           text,
  ADD COLUMN IF NOT EXISTS banner_url      text,
  ADD COLUMN IF NOT EXISTS avatar_url      text,
  ADD COLUMN IF NOT EXISTS emoji           text DEFAULT '🏟️',
  -- From migration 63 (team treasury):
  ADD COLUMN IF NOT EXISTS treasury_neurons bigint NOT NULL DEFAULT 0;

-- ── §1b  team_treasury_ledger: create if not exists ───────────────────────
-- Created in migration 63. Defensive CREATE IF NOT EXISTS ensures this migration
-- is self-contained. ON DELETE CASCADE on both FKs: ledger entry is meaningless
-- without its team or user; cascade avoids orphaned rows on GDPR deletion.
-- Note: migration 63 used ON DELETE CASCADE for both — preserved here.
CREATE TABLE IF NOT EXISTS public.team_treasury_ledger (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES public.teams(id)    ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount     int         NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_treasury_ledger_team
  ON public.team_treasury_ledger(team_id, created_at DESC);

-- ── §2  Helper: generate a short readable join code ───────────────────────
-- 6 uppercase alpha chars (no I/O for legibility). 26^6 ≈ 308 M combinations.
-- Checks uniqueness against ALL teams — disbanded codes are never reused.
-- join_code is assigned once at create_team and never changed (no regenerate).
-- Called server-side only; REVOKE from PUBLIC at end of migration.
CREATE OR REPLACE FUNCTION public._gen_team_join_code()
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  chars   text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  result  text := '';
  i       int;
  attempt int  := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;
    -- Check uniqueness across ALL teams — disbanded codes must not be reissued.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.teams WHERE join_code = result
    );
    attempt := attempt + 1;
    IF attempt > 100 THEN
      result := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ── §3  Backfill: join codes and captain_id for existing teams ────────────

-- Generate unique join codes for existing active teams that don't have one.
-- Uniqueness checked globally — disbanded codes must not be reissued.
DO $$
DECLARE
  rec  record;
  code text;
  chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  i    int;
BEGIN
  FOR rec IN SELECT id FROM public.teams WHERE join_code IS NULL AND disbanded_at IS NULL LOOP
    LOOP
      code := '';
      FOR i IN 1..6 LOOP
        code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
      END LOOP;
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.teams WHERE join_code = code AND id <> rec.id
      );
    END LOOP;
    UPDATE public.teams SET join_code = code WHERE id = rec.id;
  END LOOP;
END $$;

-- Drop old partial unique index (only covered active teams — allowed code reuse
-- after disband). Replace with global unique index: codes are retired permanently.
DROP INDEX IF EXISTS idx_teams_join_code_active;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_join_code_global
  ON public.teams(join_code)
  WHERE join_code IS NOT NULL;

-- Backfill captain_id for existing active teams.
-- Legacy teams table (migration 40) has NO owner_id, creator_id, or captain field.
-- Migration 57 added motto/banner_url/avatar_url — also no captain.
-- There is no authoritative legacy captain source in the schema.
-- Fallback: oldest member by profiles.created_at (best proxy for "founding member").
UPDATE public.teams t
SET captain_id = (
  SELECT p.id FROM public.profiles p
  WHERE p.team_id = t.id
  ORDER BY p.created_at
  LIMIT 1
)
WHERE t.captain_id IS NULL
  AND t.disbanded_at IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.team_id = t.id);

-- ── §4  team_member_history: soft-delete membership log ──────────────────
-- HISTORICAL SOURCE OF TRUTH: "who was in what team when" — competition attribution.
-- profiles.team_id is the FAST CACHE for current team (updated atomically with history).
-- All writes through SECURITY DEFINER RPCs only.
--
-- ON DELETE RESTRICT on team_id: prevents accidental hard-deletion of teams while
-- history exists. Teams must be soft-deleted (disbanded_at) instead.
-- ON DELETE CASCADE on user_id: if a user's profile is permanently deleted,
-- their history rows are also deleted (GDPR / account deletion).
-- This is intentional: a deleted account loses its personal history.
-- Team-level competition results (challenge_results) are unaffected.

CREATE TABLE IF NOT EXISTS public.team_member_history (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  team_id   uuid        NOT NULL REFERENCES public.teams(id)     ON DELETE RESTRICT,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tmh_user_active
  ON public.team_member_history(user_id) WHERE left_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_tmh_team
  ON public.team_member_history(team_id, joined_at);

-- Partial UNIQUE: one active membership per user at DB level.
-- Prevents dual-team join even under concurrent requests.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public'
      AND tablename  = 'team_member_history'
      AND indexname  = 'idx_tmh_one_active_per_user'
  ) THEN
    CREATE UNIQUE INDEX idx_tmh_one_active_per_user
      ON public.team_member_history(user_id)
      WHERE left_at IS NULL;
  END IF;
END $$;

ALTER TABLE public.team_member_history ENABLE ROW LEVEL SECURITY;

-- Own rows OR same-team rows (roster display). Not globally public.
DROP POLICY IF EXISTS "tmh_select_own_or_public" ON public.team_member_history;
DROP POLICY IF EXISTS "tmh_select_authenticated"  ON public.team_member_history;
DROP POLICY IF EXISTS "tmh_select_own_or_team"    ON public.team_member_history;
CREATE POLICY "tmh_select_own_or_team"
  ON public.team_member_history
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.team_id = team_member_history.team_id
    )
  );
-- All writes through SECURITY DEFINER RPCs → no write policies.

-- Backfill history for currently active members.
INSERT INTO public.team_member_history (user_id, team_id, joined_at, left_at)
SELECT p.id, p.team_id, now(), NULL
FROM public.profiles p
WHERE p.team_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── §5  Captain-deletion trigger ──────────────────────────────────────────
-- Fires BEFORE DELETE on profiles. Soft-disbands any active team the deleted
-- user captained, closes all remaining active history rows, and clears
-- profiles.team_id for all remaining members.
-- The captain's own history row is closed by ON DELETE CASCADE (profiles.id FK).

CREATE OR REPLACE FUNCTION public._handle_captain_profile_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_team_id uuid;
BEGIN
  UPDATE public.teams
  SET disbanded_at = now(),
      captain_id   = NULL,
      updated_at   = now()
  WHERE captain_id  = OLD.id
    AND disbanded_at IS NULL
  RETURNING id INTO v_team_id;

  IF v_team_id IS NOT NULL THEN
    -- Close active history rows for remaining members (captain's handled by CASCADE).
    UPDATE public.team_member_history
    SET left_at = now()
    WHERE team_id = v_team_id
      AND left_at IS NULL
      AND user_id <> OLD.id;

    -- Clear team_id from remaining members' profile cache.
    UPDATE public.profiles
    SET team_id    = NULL,
        updated_at = now()
    WHERE team_id = v_team_id
      AND id <> OLD.id;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_captain_profile_deleted ON public.profiles;
CREATE TRIGGER trg_captain_profile_deleted
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._handle_captain_profile_deleted();

REVOKE ALL ON FUNCTION public._handle_captain_profile_deleted() FROM PUBLIC;

-- ── §6  RLS: harden teams table ──────────────────────────────────────────
-- Remove ALL old direct-write policies (INSERT, UPDATE, DELETE, ALL).
-- After this migration, authenticated clients have no direct write path to teams.
-- All writes go through SECURITY DEFINER RPCs.

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'teams'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teams', pol.policyname);
  END LOOP;
END $$;

-- Enable RLS so the policies above actually take effect.
-- Without this, all policies on teams are created but never evaluated.
ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

-- Row-level: all active and disbanded teams are publicly enumerable (discovery).
DROP POLICY IF EXISTS "teams_read" ON public.teams;
CREATE POLICY "teams_read"
  ON public.teams
  FOR SELECT
  USING (true);

-- Column-level: revoke table-level SELECT (which exposed join_code) and
-- re-grant only safe public columns. join_code is accessible only via
-- get_my_team() SECURITY DEFINER (runs as function owner, not 'authenticated').
-- SECURITY DEFINER functions bypass column-level grants (run as postgres).
-- This makes sb.from('teams').select('*') and any explicit join_code select
-- return permission denied for authenticated and anon callers.
REVOKE SELECT ON public.teams FROM authenticated, anon;
GRANT SELECT (
  id, name, city, motto, banner_url, avatar_url, emoji,
  captain_id, disbanded_at, treasury_neurons, updated_at, created_at
) ON public.teams TO authenticated, anon;

-- RLS on team_treasury_ledger: block all direct client writes.
ALTER TABLE public.team_treasury_ledger ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'team_treasury_ledger'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.team_treasury_ledger', pol.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "treasury_read"                    ON public.team_treasury_ledger;
DROP POLICY IF EXISTS "treasury_select_team_members"     ON public.team_treasury_ledger;
CREATE POLICY "treasury_select_team_members"
  ON public.team_treasury_ledger
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.team_id = team_treasury_ledger.team_id
    )
  );

-- ── §7  RPC: create_team ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_team(
  p_name  text,
  p_city  text DEFAULT NULL,
  p_emoji text DEFAULT '🏟️'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_team_id      uuid;
  v_code         text;
  v_existing     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  p_name := trim(p_name);
  IF p_name IS NULL OR length(p_name) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_too_short');
  END IF;
  IF length(p_name) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_too_long');
  END IF;
  IF p_city IS NOT NULL THEN
    p_city := trim(p_city);
    IF length(p_city) > 60 THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'city_too_long');
    END IF;
  END IF;
  IF p_emoji IS NOT NULL AND length(p_emoji) > 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'emoji_too_long');
  END IF;

  -- Lock profile row to prevent concurrent dual-team creation.
  SELECT team_id INTO v_existing FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- Also check history — profiles.team_id can be stale if the trigger blocked a direct write.
  IF EXISTS (
    SELECT 1 FROM team_member_history WHERE user_id = v_uid AND left_at IS NULL
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  v_code := _gen_team_join_code();

  INSERT INTO teams (name, city, emoji, captain_id, join_code, created_at, updated_at)
  VALUES (p_name, p_city, COALESCE(p_emoji, '🏟️'), v_uid, v_code, now(), now())
  RETURNING id INTO v_team_id;

  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  INSERT INTO team_member_history (user_id, team_id, joined_at)
  VALUES (v_uid, v_team_id, now());

  RETURN jsonb_build_object('ok', true, 'team_id', v_team_id, 'join_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.create_team(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_team(text, text, text) TO authenticated;

-- ── §8  RPC: join_team_by_code ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_team_by_code(p_join_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_team_id   uuid;
  v_existing  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  p_join_code := upper(trim(p_join_code));
  IF p_join_code IS NULL OR length(p_join_code) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  SELECT id INTO v_team_id
  FROM teams WHERE join_code = p_join_code AND disbanded_at IS NULL;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;

  SELECT team_id INTO v_existing FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_existing = v_team_id THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'team_id', v_team_id);
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- Explicit history conflict check — no ON CONFLICT DO NOTHING (silent inconsistency).
  IF EXISTS (
    SELECT 1 FROM team_member_history
    WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL
  ) THEN
    -- Active history row exists but profile cache says no team — repair.
    UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'team_id', v_team_id);
  END IF;

  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  -- Unique violation here = concurrent join sneaked past the FOR UPDATE; correct behavior.
  INSERT INTO team_member_history (user_id, team_id, joined_at)
  VALUES (v_uid, v_team_id, now());

  RETURN jsonb_build_object('ok', true, 'already_member', false, 'team_id', v_team_id);
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_team_by_code(text) TO authenticated;

-- ── §9  RPC: leave_team ───────────────────────────────────────────────────
-- Captain with other members must transfer captaincy first.
-- Sole captain: SOFT-DISBAND. Team row is preserved; history rows are preserved
-- unless the user later deletes their profile (ON DELETE CASCADE removes them then).
CREATE OR REPLACE FUNCTION public.leave_team()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_team_id      uuid;
  v_captain_id   uuid;
  v_member_count int;
  v_rows_closed  int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id FOR UPDATE;
  SELECT COUNT(*) INTO v_member_count FROM profiles WHERE team_id = v_team_id;

  IF v_captain_id = v_uid THEN
    IF v_member_count > 1 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'captain_must_transfer',
        'member_count', v_member_count
      );
    ELSE
      -- Sole captain: SOFT DISBAND.
      UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = v_uid;
      UPDATE team_member_history
        SET left_at = now()
        WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL;
      GET DIAGNOSTICS v_rows_closed = ROW_COUNT;
      IF v_rows_closed = 0 THEN
        INSERT INTO team_member_history (user_id, team_id, joined_at, left_at)
        VALUES (v_uid, v_team_id, now(), now())
        ON CONFLICT DO NOTHING;
      END IF;
      UPDATE teams
        SET captain_id   = NULL,
            disbanded_at = now(),
            updated_at   = now()
        WHERE id = v_team_id;
      RETURN jsonb_build_object('ok', true, 'disbanded', true);
    END IF;
  END IF;

  -- Regular member: leave.
  UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = v_uid;
  UPDATE team_member_history
    SET left_at = now()
    WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL;
  GET DIAGNOSTICS v_rows_closed = ROW_COUNT;
  IF v_rows_closed = 0 THEN
    INSERT INTO team_member_history (user_id, team_id, joined_at, left_at)
    VALUES (v_uid, v_team_id, now(), now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true, 'disbanded', false);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_team() TO authenticated;

-- ── §10 RPC: transfer_captain ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_captain(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_team_id     uuid;
  v_captain_id  uuid;
  v_target_team uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_transfer_to_self');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id FOR UPDATE;
  IF v_captain_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  SELECT team_id INTO v_target_team FROM profiles WHERE id = p_target_user_id;
  IF v_target_team IS DISTINCT FROM v_team_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_in_team');
  END IF;

  UPDATE teams
  SET captain_id = p_target_user_id, updated_at = now()
  WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true, 'new_captain_id', p_target_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_captain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_captain(uuid) TO authenticated;

-- ── §11 RPC: kick_member ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kick_member(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_team_id     uuid;
  v_captain_id  uuid;
  v_target_team uuid;
  v_rows_closed int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_kick_self');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id;
  IF v_captain_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  SELECT team_id INTO v_target_team FROM profiles WHERE id = p_target_user_id FOR UPDATE;
  IF v_target_team IS DISTINCT FROM v_team_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_in_team');
  END IF;

  UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = p_target_user_id;
  UPDATE team_member_history
    SET left_at = now()
    WHERE user_id = p_target_user_id AND team_id = v_team_id AND left_at IS NULL;
  GET DIAGNOSTICS v_rows_closed = ROW_COUNT;
  IF v_rows_closed = 0 THEN
    INSERT INTO team_member_history (user_id, team_id, joined_at, left_at)
    VALUES (p_target_user_id, v_team_id, now(), now())
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.kick_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kick_member(uuid) TO authenticated;

-- ── §12 Internal helper: _apply_team_profile_update ─────────────────────
-- Validates field limits and applies the UPDATE.
-- Called by both update_my_team and update_team_profile so both paths
-- enforce identical server-side constraints. REVOKED from PUBLIC — not
-- directly callable by authenticated users.
CREATE OR REPLACE FUNCTION public._apply_team_profile_update(
  p_team_id    uuid,
  p_name       text,
  p_city       text,
  p_motto      text,
  p_emoji      text,
  p_banner_url text,
  p_avatar_url text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Name
  IF p_name IS NOT NULL THEN
    p_name := trim(p_name);
    IF length(p_name) < 2  THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_too_short'); END IF;
    IF length(p_name) > 60 THEN RETURN jsonb_build_object('ok', false, 'reason', 'name_too_long');  END IF;
  END IF;
  -- City
  IF p_city IS NOT NULL AND length(p_city) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'city_too_long');
  END IF;
  -- Motto
  IF p_motto IS NOT NULL AND length(p_motto) > 100 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'motto_too_long');
  END IF;
  -- Emoji
  IF p_emoji IS NOT NULL AND length(p_emoji) > 8 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'emoji_too_long');
  END IF;
  -- HTTPS-only for image URLs. Allow NULL (no change) or empty string (clear).
  IF p_banner_url IS NOT NULL AND p_banner_url <> '' AND p_banner_url NOT LIKE 'https://%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banner_url_not_https');
  END IF;
  IF p_avatar_url IS NOT NULL AND p_avatar_url <> '' AND p_avatar_url NOT LIKE 'https://%' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'avatar_url_not_https');
  END IF;
  IF p_banner_url IS NOT NULL AND length(p_banner_url) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'banner_url_too_long');
  END IF;
  IF p_avatar_url IS NOT NULL AND length(p_avatar_url) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'avatar_url_too_long');
  END IF;

  UPDATE teams SET
    name       = CASE WHEN p_name       IS NOT NULL THEN p_name       ELSE name       END,
    city       = CASE WHEN p_city       IS NOT NULL THEN p_city       ELSE city       END,
    motto      = CASE WHEN p_motto      IS NOT NULL THEN p_motto      ELSE motto      END,
    emoji      = CASE WHEN p_emoji      IS NOT NULL THEN p_emoji      ELSE emoji      END,
    banner_url = CASE WHEN p_banner_url IS NOT NULL THEN p_banner_url ELSE banner_url END,
    avatar_url = CASE WHEN p_avatar_url IS NOT NULL THEN p_avatar_url ELSE avatar_url END,
    updated_at = now()
  WHERE id = p_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Internal only: REVOKE from PUBLIC, no GRANT to any role.
REVOKE ALL ON FUNCTION public._apply_team_profile_update(uuid, text, text, text, text, text, text) FROM PUBLIC;

-- ── §13 RPC: update_my_team (captain-only) ───────────────────────────────
-- Auth/captain check here; validation + UPDATE delegated to helper above.
-- Client maxlength attributes are UX aids only — bypassable via direct API call.
CREATE OR REPLACE FUNCTION public.update_my_team(
  p_name       text DEFAULT NULL,
  p_city       text DEFAULT NULL,
  p_motto      text DEFAULT NULL,
  p_emoji      text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_team_id   uuid;
  v_cap_id    uuid;
  v_disbanded timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id, disbanded_at INTO v_cap_id, v_disbanded FROM teams WHERE id = v_team_id;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_cap_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  RETURN public._apply_team_profile_update(
    v_team_id, p_name, p_city, p_motto, p_emoji, p_banner_url, p_avatar_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_team(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_team(text, text, text, text, text, text) TO authenticated;

-- ── §14 RPC: update_team_profile (legacy compat — thin captain wrapper) ──
-- Legacy callers pass p_team_id explicitly. Auth/captain check here;
-- validation + UPDATE delegated to _apply_team_profile_update.
-- v5: previously bypassed all server-side validation — now enforces identical
--     limits as update_my_team. Bypass was the HIGH issue from v4 review.
CREATE OR REPLACE FUNCTION public.update_team_profile(
  p_team_id    uuid,
  p_name       text DEFAULT NULL,
  p_city       text DEFAULT NULL,
  p_motto      text DEFAULT NULL,
  p_emoji      text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_cap_id    uuid;
  v_disbanded timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT captain_id, disbanded_at INTO v_cap_id, v_disbanded FROM teams WHERE id = p_team_id;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_cap_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  RETURN public._apply_team_profile_update(
    p_team_id, p_name, p_city, p_motto, p_emoji, p_banner_url, p_avatar_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_team_profile(uuid, text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_team_profile(uuid, text, text, text, text, text, text) TO authenticated;

-- ── §15 RPC: donate_to_team ───────────────────────────────────────────────
-- FOR UPDATE on both profile and team rows prevents concurrent overdraft.
-- p_amount bounded to [1, 10000].
CREATE OR REPLACE FUNCTION public.donate_to_team(p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_team_id   uuid;
  v_neurons   int;
  v_disbanded timestamptz;
  v_treasury  bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  IF p_amount > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'amount_too_large', 'max', 10000);
  END IF;

  SELECT team_id, neurons INTO v_team_id, v_neurons
  FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  SELECT disbanded_at, treasury_neurons INTO v_disbanded, v_treasury
  FROM teams WHERE id = v_team_id FOR UPDATE;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_neurons < p_amount THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient_neurons',
      'balance', v_neurons
    );
  END IF;

  UPDATE profiles
  SET neurons = neurons - p_amount, updated_at = now()
  WHERE id = v_uid;

  UPDATE teams
  SET treasury_neurons = treasury_neurons + p_amount,
      updated_at = now()
  WHERE id = v_team_id
  RETURNING treasury_neurons INTO v_treasury;

  INSERT INTO team_treasury_ledger (team_id, user_id, amount)
  VALUES (v_team_id, v_uid, p_amount);

  RETURN jsonb_build_object(
    'ok',       true,
    'neurons',  v_neurons - p_amount,
    'treasury', v_treasury
  );
END;
$$;

REVOKE ALL ON FUNCTION public.donate_to_team(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.donate_to_team(int) TO authenticated;

-- ── §16 RPC: get_my_team_roster ───────────────────────────────────────────
-- Returns id, display_name, avatar_url, is_scout for current user's team members.
-- profiles SELECT is effectively public (leaderboard reads arbitrary profiles
-- directly), but this RPC scopes the read to teammates only and limits columns,
-- providing a stable interface for future RLS hardening.
CREATE OR REPLACE FUNCTION public.get_my_team_roster()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT jsonb_build_object(
    'ok', true,
    'members', COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id',           p.id,
          'display_name', p.display_name,
          'avatar_url',   p.avatar_url,
          'is_scout',     COALESCE(p.is_scout, false)
        )
        ORDER BY p.display_name
      ),
      '[]'::jsonb
    )
  ) INTO v_result
  FROM profiles p
  WHERE p.team_id = v_team_id;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_team_roster() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_team_roster() TO authenticated;

-- ── §17 RPC: get_my_team_activity_today ──────────────────────────────────
-- Returns list of user_ids active today within the current user's team.
-- currency_ledger RLS: "user reads own ledger" (user_id = auth.uid()) — own only.
-- user_super_question_attempts RLS: "attempts_own_read" (user_id = auth.uid()) — own only.
-- Direct client queries for teammates return empty results from both tables.
-- This SECURITY DEFINER RPC bypasses RLS to aggregate activity across all team members.
-- Returns ONLY boolean active flags — no amounts, no ledger details.
CREATE OR REPLACE FUNCTION public.get_my_team_activity_today()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_today   date := (now() AT TIME ZONE 'UTC')::date;
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  -- Collect distinct user_ids with any activity today.
  -- Sources: super question attempts OR qualifying currency ledger entries.
  -- No amounts or details exposed — only the user_id list.
  SELECT jsonb_build_object(
    'ok', true,
    'active_user_ids', COALESCE(jsonb_agg(DISTINCT u.user_id), '[]'::jsonb)
  ) INTO v_result
  FROM (
    SELECT user_id
    FROM public.user_super_question_attempts
    WHERE user_id IN (SELECT id FROM profiles WHERE team_id = v_team_id)
      AND created_at::date = v_today
    UNION
    SELECT user_id
    FROM public.currency_ledger
    WHERE user_id IN (SELECT id FROM profiles WHERE team_id = v_team_id)
      AND operation_type IN ('quiz_reward', 'daily_goal_bonus')
      AND created_at::date = v_today
  ) u;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_team_activity_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_team_activity_today() TO authenticated;

-- ── §18 RPC: get_my_team — full team data for current user (incl. join_code) ─
-- Only members of a team can retrieve that team's join_code.
-- Runs as function owner (SECURITY DEFINER), so it bypasses the column-level
-- REVOKE that hides join_code from direct authenticated/anon client SELECTs.
CREATE OR REPLACE FUNCTION public.get_my_team()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT jsonb_build_object(
    'ok',               true,
    'id',               t.id,
    'name',             t.name,
    'city',             t.city,
    'motto',            t.motto,
    'banner_url',       t.banner_url,
    'avatar_url',       t.avatar_url,
    'emoji',            t.emoji,
    'captain_id',       t.captain_id,
    'join_code',        t.join_code,
    'disbanded_at',     t.disbanded_at,
    'treasury_neurons', t.treasury_neurons,
    'updated_at',       t.updated_at
  ) INTO v_result
  FROM teams t
  WHERE t.id = v_team_id;

  RETURN COALESCE(v_result, jsonb_build_object('ok', false, 'reason', 'team_not_found'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_team() TO authenticated;

-- ── §19 RPC: get_public_team — safe public fields, no join_code ──────────
-- Used for team profile pages, invite confirmation dialogs, leaderboard overlays.
-- Never returns join_code regardless of who calls.
CREATE OR REPLACE FUNCTION public.get_public_team(p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'ok',           true,
    'id',           t.id,
    'name',         t.name,
    'city',         t.city,
    'motto',        t.motto,
    'banner_url',   t.banner_url,
    'avatar_url',   t.avatar_url,
    'emoji',        t.emoji,
    'captain_id',   t.captain_id,
    'disbanded_at', t.disbanded_at,
    'updated_at',   t.updated_at
  ) INTO v_result
  FROM teams t
  WHERE t.id = p_team_id;

  RETURN COALESCE(v_result, jsonb_build_object('ok', false, 'reason', 'team_not_found'));
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_team(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_team(uuid) TO authenticated, anon;

-- ── §20 RPC: join_team_by_legacy_id — legacy ?join=UUID invite ────────────
-- Handles invite links that used team UUID directly (pre-canonical join_code links).
-- Retrieves join_code server-side; never exposes it to the client.
-- join_team_by_code() is called internally for consistent membership logic.
CREATE OR REPLACE FUNCTION public.join_team_by_legacy_id(p_team_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_code      text;
  v_disbanded timestamptz;
  v_name      text;
  v_join_result jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT join_code, disbanded_at, name INTO v_code, v_disbanded, v_name
  FROM teams WHERE id = p_team_id;

  IF v_name IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_code IS NULL THEN
    -- Team exists but has no join_code (edge case: pre-75 team not yet backfilled).
    RETURN jsonb_build_object('ok', false, 'reason', 'no_join_code');
  END IF;

  -- Delegate to join_team_by_code for consistent membership logic.
  -- join_code is never returned to the caller.
  v_join_result := public.join_team_by_code(v_code);

  -- Strip join_code from result if present; add team_name for UX.
  RETURN (v_join_result - 'join_code') || jsonb_build_object('team_name', v_name);
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_by_legacy_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_team_by_legacy_id(uuid) TO authenticated;

-- ── §21 Lock down _gen_team_join_code from public access ──────────────────
REVOKE ALL ON FUNCTION public._gen_team_join_code() FROM PUBLIC;

-- ── Notes: what is NOT in this migration ─────────────────────────────────
-- regenerate_team_code: INTENTIONALLY OMITTED. join_code is assigned once
--   at create_team and is permanent. Regenerating would orphan the old code
--   (removed from teams row) making it available for future reuse — breaking
--   the "old invite must never point to another team" invariant.
-- Brain Fights formula: future iteration (server-authoritative events, weekly cycle).
-- Weekly Arena: future iteration (synchronous first-party BFC tournament).
-- Premium: monetizes depth, not participation. Future iteration.
-- Rate limiting on join_team_by_code: requires infra, future hardening.
-- is_scout admin management: requires SECURITY DEFINER admin RPC, future work.
-- profiles SELECT RLS: currently exposes arbitrary profile rows/columns to
--   client queries. Security debt — separate iteration (leaderboard/social
--   depend on direct SELECT; hardening requires scoping those paths first).

COMMIT;
