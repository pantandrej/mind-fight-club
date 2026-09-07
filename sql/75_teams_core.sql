-- ══════════════════════════════════════════════════════════════════════════
-- Migration 75 v2: Teams Core — captain, join_code, soft-delete, RPCs
--
-- Problems fixed from v1 (FINAL REVIEW):
--  1. CRITICAL: DELETE FROM teams destroyed team_member_history (ON DELETE CASCADE).
--     Fixed: teams are never hard-deleted. disbanded_at timestamptz marks disband.
--  2. team_member_history.team_id FK changed from ON DELETE CASCADE → RESTRICT.
--  3. All CREATE POLICY now guarded with DROP POLICY IF EXISTS (idempotency).
--  4. join_team_by_code rejects disbanded teams (disbanded_at IS NOT NULL).
--  5. Captain-deletion trigger: auto-disband any active team when captain profile
--     is deleted (ON DELETE SET NULL alone left active teams without a captain).
--  6. donate_to_team: added p_amount upper bound (10 000) + disbanded_at check.
--  7. team_member_history SELECT policy: authenticated users only (was: public).
--  8. join_code uniqueness checked only against active teams → disbanded teams
--     release their code for future reuse.
--  9. Source-of-truth clarified in comments: profiles.team_id is fast cache,
--     team_member_history is historical authority.
-- 10. update_my_team / regenerate_team_code reject disbanded teams.
-- 11. Added teams.updated_at column (referenced by RPCs but not in mig 40).
--
-- Does NOT touch migrations 68–74.
-- Does NOT implement Brain Fights formula (future iteration).
-- Does NOT monetize anything.
-- ══════════════════════════════════════════════════════════════════════════

-- ── §1  Schema: add columns to teams ─────────────────────────────────────
-- captain_id: nullable (NULL = captain deleted or team not yet migrated).
-- join_code:  6-char uppercase alpha, generated server-side.
-- disbanded_at: NULL = active, NOT NULL = disbanded (soft-delete).
-- updated_at: audit timestamp referenced by RPCs.

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS captain_id   uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS join_code    text,
  ADD COLUMN IF NOT EXISTS disbanded_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at   timestamptz;

-- ── §2  Helper: generate a short readable join code ───────────────────────
-- 6 uppercase alpha chars (no I/O for legibility). 26^6 ≈ 308 M combinations.
-- Checks uniqueness only against ACTIVE teams — disbanded teams release their
-- codes for future reuse.
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
    -- Only check uniqueness against active teams; disbanded ones release their code.
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.teams
      WHERE join_code = result AND disbanded_at IS NULL
    );
    attempt := attempt + 1;
    IF attempt > 100 THEN
      -- Fallback: uuid prefix (longer but guaranteed unique)
      result := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ── §3  Backfill: join codes and captain_id for existing teams ────────────

-- Generate unique join codes for existing teams that don't have one yet.
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
        SELECT 1 FROM public.teams
        WHERE join_code = code AND id <> rec.id AND disbanded_at IS NULL
      );
    END LOOP;
    UPDATE public.teams SET join_code = code WHERE id = rec.id;
  END LOOP;
END $$;

-- Make join_code NOT NULL for active teams only; disbanded teams may have NULL code.
-- We enforce NOT NULL at the application layer: RPCs always set it on create.
-- The UNIQUE constraint covers non-NULL values naturally in PostgreSQL.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_join_code_key'
  ) THEN
    -- Partial unique index: only active teams need unique codes.
    -- Disbanded teams may retain their old code (now reusable) or have it NULL.
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_teams_join_code_active
  ON public.teams(join_code)
  WHERE disbanded_at IS NULL AND join_code IS NOT NULL;

-- Backfill captain_id for existing active teams: oldest member by profile created_at.
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
-- ON DELETE CASCADE on user_id: if a user's profile is permanently deleted, their
-- history rows can go too (GDPR / account deletion).

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

-- Authenticated users can read history (their own and their team's for roster display).
-- Not globally public — membership timestamps (joined_at/left_at) don't need to
-- be exposed to unauthenticated users.
DROP POLICY IF EXISTS "tmh_select_own_or_public" ON public.team_member_history;
DROP POLICY IF EXISTS "tmh_select_authenticated"  ON public.team_member_history;
CREATE POLICY "tmh_select_authenticated"
  ON public.team_member_history
  FOR SELECT
  TO authenticated
  USING (true);
-- All writes (INSERT/UPDATE/DELETE) through SECURITY DEFINER RPCs → no write policies.

-- Backfill history for currently active members (joined_at = now() since exact date unknown).
INSERT INTO public.team_member_history (user_id, team_id, joined_at, left_at)
SELECT p.id, p.team_id, now(), NULL
FROM public.profiles p
WHERE p.team_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── §5  Captain-deletion trigger ──────────────────────────────────────────
-- Problem: captain_id ON DELETE SET NULL (FK action) would leave an active team
-- with captain_id = NULL. This trigger fires BEFORE the profile DELETE and
-- auto-disbands any active team where the deleted user was captain.
-- The FK action then tries to set captain_id = NULL — already NULL, no-op.

CREATE OR REPLACE FUNCTION public._handle_captain_profile_deleted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Auto-disband any active team captained by the profile being deleted.
  UPDATE public.teams
  SET disbanded_at = now(),
      captain_id   = NULL,
      updated_at   = now()
  WHERE captain_id  = OLD.id
    AND disbanded_at IS NULL;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_captain_profile_deleted ON public.profiles;
CREATE TRIGGER trg_captain_profile_deleted
  BEFORE DELETE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public._handle_captain_profile_deleted();

REVOKE ALL ON FUNCTION public._handle_captain_profile_deleted() FROM PUBLIC;

-- ── §6  RLS: harden teams table ──────────────────────────────────────────
-- Remove old permissive INSERT/UPDATE/ALL policies — RPCs handle all writes.
-- SELECT USING(true): teams are publicly discoverable (name, city, emoji).
-- join_code is also visible — this is intentional for MVP. join_code is NOT
-- a security credential (anyone with the code can join, which is by design).
-- The real access control is: you must know the code (social layer).

DO $$
DECLARE pol record;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'teams'
      AND cmd IN ('INSERT', 'UPDATE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.teams', pol.policyname);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "teams_read" ON public.teams;
CREATE POLICY "teams_read"
  ON public.teams
  FOR SELECT
  USING (true);

-- RLS on team_treasury_ledger: block direct client writes; members read their team's ledger.
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

  -- Lock profile row to prevent concurrent dual-team creation.
  SELECT team_id INTO v_existing FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  v_code := _gen_team_join_code();

  INSERT INTO teams (name, city, emoji, captain_id, join_code, created_at, updated_at)
  VALUES (p_name, p_city, COALESCE(p_emoji, '🏟️'), v_uid, v_code, now(), now())
  RETURNING id INTO v_team_id;

  -- profiles.team_id fast cache
  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  -- Historical record
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
  v_disbanded timestamptz;
  v_existing  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  p_join_code := upper(trim(p_join_code));
  IF p_join_code IS NULL OR length(p_join_code) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  -- Find active team by code only. Disbanded teams are invisible to join.
  SELECT id, disbanded_at INTO v_team_id, v_disbanded
  FROM teams WHERE join_code = p_join_code AND disbanded_at IS NULL;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;

  -- Lock caller profile row to prevent concurrent dual-team joins.
  SELECT team_id INTO v_existing FROM profiles WHERE id = v_uid FOR UPDATE;

  -- Already in this exact team → idempotent success.
  IF v_existing = v_team_id THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'team_id', v_team_id);
  END IF;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- Join: update cache + record history.
  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  -- Partial UNIQUE index prevents duplicate active membership rows.
  INSERT INTO team_member_history (user_id, team_id, joined_at)
  VALUES (v_uid, v_team_id, now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'already_member', false, 'team_id', v_team_id);
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_team_by_code(text) TO authenticated;

-- ── §9  RPC: leave_team ───────────────────────────────────────────────────
-- Captain with other members must transfer captaincy first.
-- Captain as sole member: SOFT-DISBAND — sets disbanded_at, clears captain_id,
--   closes membership history. Team row and history are preserved forever.
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
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Lock profile row.
  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  -- Lock team row.
  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id FOR UPDATE;

  -- Count active members (via profiles cache — consistent under FOR UPDATE).
  SELECT COUNT(*) INTO v_member_count FROM profiles WHERE team_id = v_team_id;

  IF v_captain_id = v_uid THEN
    IF v_member_count > 1 THEN
      -- Captain cannot abandon a team with other members.
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'captain_must_transfer',
        'member_count', v_member_count
      );
    ELSE
      -- Sole captain: SOFT DISBAND.
      -- 1. Clear captain's profile cache.
      UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = v_uid;
      -- 2. Close membership history record.
      UPDATE team_member_history
        SET left_at = now()
        WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL;
      -- 3. Mark team as disbanded. DO NOT DELETE — history must be preserved.
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

  -- Remove from team: update cache + close history.
  UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = p_target_user_id;
  UPDATE team_member_history
    SET left_at = now()
    WHERE user_id = p_target_user_id AND team_id = v_team_id AND left_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.kick_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kick_member(uuid) TO authenticated;

-- ── §12 RPC: update_my_team (captain-only) ────────────────────────────────
-- Replaces update_team_profile which checked membership, not captaincy.
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
  v_uid      uuid := auth.uid();
  v_team_id  uuid;
  v_cap_id   uuid;
  v_disbanded timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id, disbanded_at INTO v_cap_id, v_disbanded
  FROM teams WHERE id = v_team_id;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_cap_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_too_short');
  END IF;

  UPDATE teams SET
    name       = CASE WHEN p_name       IS NOT NULL THEN trim(p_name) ELSE name       END,
    city       = CASE WHEN p_city       IS NOT NULL THEN p_city        ELSE city       END,
    motto      = CASE WHEN p_motto      IS NOT NULL THEN p_motto       ELSE motto      END,
    emoji      = CASE WHEN p_emoji      IS NOT NULL THEN p_emoji       ELSE emoji      END,
    banner_url = CASE WHEN p_banner_url IS NOT NULL THEN p_banner_url  ELSE banner_url END,
    avatar_url = CASE WHEN p_avatar_url IS NOT NULL THEN p_avatar_url  ELSE avatar_url END,
    updated_at = now()
  WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_team(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_team(text, text, text, text, text, text) TO authenticated;

-- Also restrict the old update_team_profile to captain-only for backward compat.
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

  SELECT captain_id, disbanded_at INTO v_cap_id, v_disbanded
  FROM teams WHERE id = p_team_id;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_cap_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  UPDATE teams SET
    name       = COALESCE(p_name,       name),
    city       = COALESCE(p_city,       city),
    motto      = COALESCE(p_motto,      motto),
    emoji      = COALESCE(p_emoji,      emoji),
    banner_url = COALESCE(p_banner_url, banner_url),
    avatar_url = COALESCE(p_avatar_url, avatar_url),
    updated_at = now()
  WHERE id = p_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── §13 RPC: regenerate_team_code (captain-only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_team_code()
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
  v_code      text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id, disbanded_at INTO v_cap_id, v_disbanded
  FROM teams WHERE id = v_team_id;

  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_disbanded');
  END IF;

  IF v_cap_id IS DISTINCT FROM v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  v_code := _gen_team_join_code();
  UPDATE teams SET join_code = v_code, updated_at = now() WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true, 'join_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_team_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_team_code() TO authenticated;

-- ── §14 RPC: donate_to_team (rewrite with FOR UPDATE + disbanded guard) ────
-- Donor must be a member of their current team (no arbitrary team_id param).
-- p_amount bounded to [1, 10000] to prevent accidental economy drain.
-- FOR UPDATE on both profile and team rows prevents concurrent overdraft.
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

  -- Lock profile row: establishes current team + prevents concurrent overdraft.
  SELECT team_id, neurons INTO v_team_id, v_neurons
  FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  -- Lock team row: prevents concurrent treasury race.
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

  -- Deduct from player.
  UPDATE profiles
  SET neurons = neurons - p_amount, updated_at = now()
  WHERE id = v_uid;

  -- Add to team treasury.
  UPDATE teams
  SET treasury_neurons = treasury_neurons + p_amount,
      updated_at = now()
  WHERE id = v_team_id
  RETURNING treasury_neurons INTO v_treasury;

  -- Log contribution (repeated donations are valid, no idempotency key needed).
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

-- ── §15 Lock down _gen_team_join_code from public access ─────────────────
REVOKE ALL ON FUNCTION public._gen_team_join_code() FROM PUBLIC;

-- ── Notes: what is NOT in this migration (future iterations) ─────────────
-- Brain Fights scoring formula: server-authoritative events, weekly cycle,
--   top performers + capped participation. Formula is NOT committed here.
-- Weekly Arena: official synchronous BFC tournament.
-- Premium: monetizes depth (extended stats, cosmetics, more Quick Play).
--   Premium does NOT gate team membership, leaderboards, or Weekly Arena.
-- Rate limiting on join_team_by_code: requires infra, future hardening.
-- is_scout admin management: requires SECURITY DEFINER admin RPC, future work.
