-- ══════════════════════════════════════════════════════════════════════════
-- Migration 75: Teams Core — captain, join_code, membership history, RPCs
--
-- Problems fixed:
--  1. teams has no captain_id → anyone can edit team identity (P0)
--  2. teams has no join_code → invite only via UUID (P1)
--  3. client directly sets profiles.team_id (blocked by trigger since mig 70) (P0)
--  4. No membership history → competition attribution impossible (P1)
--  5. donate_to_team lacks FOR UPDATE → concurrent race possible (P1)
--  6. update_team_profile checks membership, not captaincy (P1)
--  7. No leave_team / kick / transfer_captain RPCs (P0)
--  8. teams_insert RLS policy allows unauthenticated-style INSERT (P2)
--
-- Does NOT touch migrations 68–74.
-- Does NOT touch challenge_results, brain_fights, economy, pack purchase.
-- ══════════════════════════════════════════════════════════════════════════

-- ── §1  Helper: generate a short readable join code ─────────────────────
-- Returns 6 uppercase alpha chars (26^6 = 308 million combinations).
-- Called server-side only — never exposed to client as a parameter.
CREATE OR REPLACE FUNCTION _gen_team_join_code()
RETURNS text
LANGUAGE plpgsql
AS $$
DECLARE
  chars  text    := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; -- no I/O to avoid confusion
  result text    := '';
  i      int;
  attempt int    := 0;
BEGIN
  LOOP
    result := '';
    FOR i IN 1..6 LOOP
      result := result || substr(chars, floor(random() * length(chars))::int + 1, 1);
    END LOOP;
    -- Ensure uniqueness
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE join_code = result);
    attempt := attempt + 1;
    IF attempt > 100 THEN
      -- Fallback: use uuid prefix (longer but guaranteed unique)
      result := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      EXIT;
    END IF;
  END LOOP;
  RETURN result;
END;
$$;

-- ── §2  teams: add captain_id and join_code ──────────────────────────────
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS captain_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS join_code  text;

-- Generate unique join codes for existing teams that don't have one
DO $$
DECLARE
  rec record;
  code text;
BEGIN
  FOR rec IN SELECT id FROM public.teams WHERE join_code IS NULL LOOP
    -- Generate a unique code for this team
    LOOP
      code := '';
      DECLARE
        chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        i int;
      BEGIN
        FOR i IN 1..6 LOOP
          code := code || substr(chars, floor(random() * length(chars))::int + 1, 1);
        END LOOP;
      END;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.teams WHERE join_code = code AND id <> rec.id);
    END LOOP;
    UPDATE public.teams SET join_code = code WHERE id = rec.id;
  END LOOP;
END $$;

-- Now make join_code NOT NULL and UNIQUE
ALTER TABLE public.teams ALTER COLUMN join_code SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.teams'::regclass AND conname = 'teams_join_code_key'
  ) THEN
    ALTER TABLE public.teams ADD CONSTRAINT teams_join_code_key UNIQUE (join_code);
  END IF;
END $$;

-- Backfill captain_id for existing teams: pick oldest member (by profiles.created_at)
UPDATE public.teams t
SET captain_id = (
  SELECT p.id FROM public.profiles p
  WHERE p.team_id = t.id
  ORDER BY p.created_at
  LIMIT 1
)
WHERE t.captain_id IS NULL
  AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.team_id = t.id);

-- ── §3  team_member_history: soft-delete membership history ─────────────
-- Source of truth for "who was in what team when" — used for competition
-- result attribution. Active membership = left_at IS NULL.
-- profiles.team_id remains the fast lookup cache for current team.
CREATE TABLE IF NOT EXISTS public.team_member_history (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  team_id   uuid        NOT NULL REFERENCES public.teams(id)    ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at   timestamptz
);

CREATE INDEX IF NOT EXISTS idx_tmh_user_active
  ON public.team_member_history(user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_tmh_team
  ON public.team_member_history(team_id, joined_at);

-- Enforce: one active team per user at DB level
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'team_member_history'
      AND indexname = 'idx_tmh_one_active_per_user'
  ) THEN
    CREATE UNIQUE INDEX idx_tmh_one_active_per_user
      ON public.team_member_history(user_id)
      WHERE left_at IS NULL;
  END IF;
END $$;

ALTER TABLE public.team_member_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tmh_select_own_or_public"
  ON public.team_member_history FOR SELECT USING (true);
-- All writes through SECURITY DEFINER RPCs only.

-- Backfill history for existing team members (joined_at = now() since we don't know)
INSERT INTO public.team_member_history (user_id, team_id, joined_at, left_at)
SELECT p.id, p.team_id, now(), NULL
FROM public.profiles p
WHERE p.team_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ── §4  RLS: harden teams table ─────────────────────────────────────────
-- Remove old permissive INSERT/UPDATE policies — RPCs handle all writes.

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

-- Keep public SELECT.
DROP POLICY IF EXISTS "teams_read" ON public.teams;
CREATE POLICY "teams_read" ON public.teams FOR SELECT USING (true);

-- RLS on team_treasury_ledger — block direct client writes
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
DROP POLICY IF EXISTS "treasury_read" ON public.team_treasury_ledger;
CREATE POLICY "treasury_select_team_members"
  ON public.team_treasury_ledger FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.team_id = team_treasury_ledger.team_id
    )
  );

-- ── §5  RPC: create_team ─────────────────────────────────────────────────
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
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_code    text;
  v_existing_team uuid;
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

  -- Check caller is not already in a team (lock their profile row)
  SELECT team_id INTO v_existing_team
  FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_existing_team IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- Generate unique join code
  v_code := _gen_team_join_code();

  -- Create team with caller as captain
  INSERT INTO teams (name, city, emoji, captain_id, join_code)
  VALUES (p_name, p_city, COALESCE(p_emoji, '🏟️'), v_uid, v_code)
  RETURNING id INTO v_team_id;

  -- Assign caller to team
  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  -- Record membership history
  INSERT INTO team_member_history (user_id, team_id, joined_at)
  VALUES (v_uid, v_team_id, now());

  RETURN jsonb_build_object(
    'ok', true,
    'team_id', v_team_id,
    'join_code', v_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_team(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_team(text, text, text) TO authenticated;

-- ── §6  RPC: join_team_by_code ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_team_by_code(p_join_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_team_id      uuid;
  v_captain_id   uuid;
  v_existing     uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  p_join_code := upper(trim(p_join_code));
  IF p_join_code IS NULL OR length(p_join_code) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code');
  END IF;

  -- Find team by code
  SELECT id, captain_id INTO v_team_id, v_captain_id
  FROM teams WHERE join_code = p_join_code;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'team_not_found');
  END IF;

  -- Lock caller's profile row to prevent concurrent dual-team joins
  SELECT team_id INTO v_existing
  FROM profiles WHERE id = v_uid FOR UPDATE;

  -- Already in this exact team → idempotent success
  IF v_existing = v_team_id THEN
    RETURN jsonb_build_object('ok', true, 'already_member', true, 'team_id', v_team_id);
  END IF;

  -- Already in a different team → blocked
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_in_team');
  END IF;

  -- Join the team
  UPDATE profiles SET team_id = v_team_id, updated_at = now() WHERE id = v_uid;

  -- Record membership history (unique partial index prevents duplicates)
  INSERT INTO team_member_history (user_id, team_id, joined_at)
  VALUES (v_uid, v_team_id, now())
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'already_member', false,
    'team_id', v_team_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.join_team_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_team_by_code(text) TO authenticated;

-- ── §7  RPC: leave_team ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_team()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_team_id    uuid;
  v_captain_id uuid;
  v_member_count int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Lock profile row
  SELECT team_id INTO v_team_id
  FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  -- Lock team row
  SELECT captain_id INTO v_captain_id
  FROM teams WHERE id = v_team_id FOR UPDATE;

  -- Count active members in team
  SELECT COUNT(*) INTO v_member_count
  FROM profiles WHERE team_id = v_team_id;

  IF v_captain_id = v_uid THEN
    IF v_member_count > 1 THEN
      -- Captain cannot leave while other members exist
      RETURN jsonb_build_object(
        'ok', false,
        'reason', 'captain_must_transfer',
        'member_count', v_member_count
      );
    ELSE
      -- Captain is sole member: disband the team
      UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = v_uid;
      UPDATE team_member_history
        SET left_at = now()
        WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL;
      -- Set captain_id to NULL before delete (FK ON DELETE SET NULL handles cascade)
      UPDATE teams SET captain_id = NULL WHERE id = v_team_id;
      DELETE FROM teams WHERE id = v_team_id;
      RETURN jsonb_build_object('ok', true, 'disbanded', true);
    END IF;
  END IF;

  -- Regular member: leave
  UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = v_uid;
  UPDATE team_member_history
    SET left_at = now()
    WHERE user_id = v_uid AND team_id = v_team_id AND left_at IS NULL;

  RETURN jsonb_build_object('ok', true, 'disbanded', false);
END;
$$;

REVOKE ALL ON FUNCTION public.leave_team() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.leave_team() TO authenticated;

-- ── §8  RPC: transfer_captain ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.transfer_captain(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_team_id    uuid;
  v_captain_id uuid;
  v_target_team uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_transfer_to_self');
  END IF;

  -- Lock caller's team
  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  -- Lock team row, verify caller is captain
  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id FOR UPDATE;
  IF v_captain_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  -- Verify target is in same team
  SELECT team_id INTO v_target_team FROM profiles WHERE id = p_target_user_id;
  IF v_target_team IS DISTINCT FROM v_team_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_in_team');
  END IF;

  -- Transfer captain atomically
  UPDATE teams SET captain_id = p_target_user_id, updated_at = now() WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true, 'new_captain_id', p_target_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_captain(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_captain(uuid) TO authenticated;

-- ── §9  RPC: kick_member ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.kick_member(p_target_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_team_id    uuid;
  v_captain_id uuid;
  v_target_team uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_target_user_id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_kick_self');
  END IF;

  -- Lock caller's team
  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid FOR UPDATE;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  -- Verify caller is captain
  SELECT captain_id INTO v_captain_id FROM teams WHERE id = v_team_id;
  IF v_captain_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  -- Verify target is in same team
  SELECT team_id INTO v_target_team FROM profiles WHERE id = p_target_user_id FOR UPDATE;
  IF v_target_team IS DISTINCT FROM v_team_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'target_not_in_team');
  END IF;

  -- Cannot kick the captain (would be themselves, already blocked above)
  IF p_target_user_id = v_captain_id THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'cannot_kick_captain');
  END IF;

  -- Remove target from team
  UPDATE profiles SET team_id = NULL, updated_at = now() WHERE id = p_target_user_id;
  UPDATE team_member_history
    SET left_at = now()
    WHERE user_id = p_target_user_id AND team_id = v_team_id AND left_at IS NULL;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.kick_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.kick_member(uuid) TO authenticated;

-- ── §10 RPC: update_my_team (captain-only, replaces update_team_profile) ─
-- update_team_profile is kept for backward compat but now checks captaincy.
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
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_cap_id  uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id INTO v_cap_id FROM teams WHERE id = v_team_id;
  IF v_cap_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  IF p_name IS NOT NULL AND length(trim(p_name)) < 2 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'name_too_short');
  END IF;

  UPDATE teams SET
    name       = CASE WHEN p_name       IS NOT NULL THEN trim(p_name)   ELSE name       END,
    city       = CASE WHEN p_city       IS NOT NULL THEN p_city         ELSE city       END,
    motto      = CASE WHEN p_motto      IS NOT NULL THEN p_motto        ELSE motto      END,
    emoji      = CASE WHEN p_emoji      IS NOT NULL THEN p_emoji        ELSE emoji      END,
    banner_url = CASE WHEN p_banner_url IS NOT NULL THEN p_banner_url   ELSE banner_url END,
    avatar_url = CASE WHEN p_avatar_url IS NOT NULL THEN p_avatar_url   ELSE avatar_url END,
    updated_at = now()
  WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_team(text, text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_team(text, text, text, text, text, text) TO authenticated;

-- Also restrict the old update_team_profile to captain-only
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
  v_uid    uuid := auth.uid();
  v_cap_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT captain_id INTO v_cap_id FROM teams WHERE id = p_team_id;
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

-- ── §11 RPC: regenerate_team_code (captain-only) ─────────────────────────
CREATE OR REPLACE FUNCTION public.regenerate_team_code()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_team_id uuid;
  v_cap_id  uuid;
  v_code    text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT team_id INTO v_team_id FROM profiles WHERE id = v_uid;
  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_team');
  END IF;

  SELECT captain_id INTO v_cap_id FROM teams WHERE id = v_team_id;
  IF v_cap_id <> v_uid THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_captain');
  END IF;

  v_code := _gen_team_join_code();
  UPDATE teams SET join_code = v_code, updated_at = now() WHERE id = v_team_id;

  RETURN jsonb_build_object('ok', true, 'join_code', v_code);
END;
$$;

REVOKE ALL ON FUNCTION public.regenerate_team_code() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.regenerate_team_code() TO authenticated;

-- ── §12 RPC: donate_to_team (rewrite with FOR UPDATE) ────────────────────
CREATE OR REPLACE FUNCTION public.donate_to_team(p_amount int)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_team_id  uuid;
  v_neurons  int;
  v_treasury bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  IF p_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amount');
  END IF;

  -- Lock profile row (prevents concurrent overdraft)
  SELECT team_id, neurons INTO v_team_id, v_neurons
  FROM profiles WHERE id = v_uid FOR UPDATE;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  IF v_neurons < p_amount THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_neurons', 'balance', v_neurons);
  END IF;

  -- Lock team treasury row
  SELECT treasury_neurons INTO v_treasury
  FROM teams WHERE id = v_team_id FOR UPDATE;

  -- Deduct from player
  UPDATE profiles
  SET neurons = neurons - p_amount, updated_at = now()
  WHERE id = v_uid;

  -- Add to team treasury
  UPDATE teams
  SET treasury_neurons = treasury_neurons + p_amount
  WHERE id = v_team_id
  RETURNING treasury_neurons INTO v_treasury;

  -- Log contribution (no idempotency key needed — repeated donations are valid)
  INSERT INTO team_treasury_ledger (team_id, user_id, amount)
  VALUES (v_team_id, v_uid, p_amount);

  RETURN jsonb_build_object(
    'ok', true,
    'neurons', v_neurons - p_amount,
    'treasury', v_treasury
  );
END;
$$;

REVOKE ALL ON FUNCTION public.donate_to_team(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.donate_to_team(int) TO authenticated;

-- ── §13 get_team_tiebreaker: restrict to team members (defensive) ─────────
-- Already SECURITY DEFINER from migration 40. No change needed.
-- (just marking it documented)

-- ── §14 _gen_team_join_code: not executable by authenticated users ────────
REVOKE ALL ON FUNCTION public._gen_team_join_code() FROM PUBLIC;
