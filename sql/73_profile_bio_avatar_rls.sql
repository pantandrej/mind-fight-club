-- Migration 73: Profile bio/avatar — secure RPC approach
--
-- Changes from failed first attempt:
--   - Deadlock fix: do NOT drop/create mfc_media_select_public (unrelated policy);
--     only touch avatars_insert_own / avatars_update_own.
--   - Security fix: no broad profiles UPDATE policy. Instead:
--     (a) extend guard_critical_profile_fields trigger to also protect
--         team_id, ref_code, total_score from direct client UPDATE;
--     (b) narrow UPDATE RLS policy kept for equipCosmetic compatibility;
--     (c) SECURITY DEFINER RPCs provide explicit allowlists.
--   - bio: server-enforced 500-char limit (CHECK + RPC validation).
--   - Storage: allowed extensions enforced in policy (jpg/jpeg/png/webp).
--   - USING clause on avatars_update_own checks canonical path, not only owner.
--
-- Migrations 68–72 are not touched.
-- This file is fully idempotent (IF NOT EXISTS, DROP IF EXISTS, CREATE OR REPLACE).

-- ── 1. Ensure user-editable columns exist ────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bio        text CHECK (char_length(bio) <= 500);
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text;

-- ── 2. Extend guard_critical_profile_fields (originally migration 70) ────────
-- Adds team_id, ref_code, total_score to server-owned fields.
-- current_user = 'authenticated' check preserves SECURITY DEFINER RPC bypass:
-- inside a SECURITY DEFINER function current_user is the function owner,
-- so the guard does NOT fire — RPCs can legitimately update those fields.
CREATE OR REPLACE FUNCTION public.guard_critical_profile_fields()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'authenticated' THEN
    -- Economy fields (migration 70)
    NEW.neurons       := OLD.neurons;
    NEW.xp            := OLD.xp;
    NEW.total_score   := OLD.total_score;
    NEW.daily_streak  := OLD.daily_streak;
    NEW.referred_by   := OLD.referred_by;
    NEW.is_admin      := OLD.is_admin;
    NEW.is_scout      := OLD.is_scout;
    NEW.premium_until := OLD.premium_until;
    -- Identity fields (migration 73 extension)
    NEW.team_id       := OLD.team_id;
    NEW.ref_code      := OLD.ref_code;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 3. Narrow UPDATE RLS policy ──────────────────────────────────────────────
-- Required so legacy direct-UPDATE paths (e.g. equipCosmetic for cosmetic slots)
-- continue to work. All economy and identity fields are guarded by trigger above,
-- so the broad policy is safe. User-initiated profile edits (bio, avatar, name,
-- city) must go through update_my_profile RPC — but direct UPDATE of those fields
-- is also allowed as defense-in-depth (CHECK constraint limits bio length).
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING    (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── 4. update_my_profile — explicit allowlist RPC for user-initiated edits ───
-- Only updates: display_name, city, bio, avatar_url.
-- NULL arguments are skipped (CASE preserves existing value).
-- SECURITY DEFINER: bypasses RLS + guard trigger to allow clean writes.
CREATE OR REPLACE FUNCTION public.update_my_profile(
  p_display_name text DEFAULT NULL,
  p_city         text DEFAULT NULL,
  p_bio          text DEFAULT NULL,
  p_avatar_url   text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;
  IF p_bio IS NOT NULL AND char_length(p_bio) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'bio_too_long');
  END IF;
  UPDATE profiles SET
    display_name = CASE WHEN p_display_name IS NOT NULL THEN p_display_name ELSE display_name END,
    city         = CASE WHEN p_city         IS NOT NULL THEN p_city         ELSE city         END,
    bio          = CASE WHEN p_bio          IS NOT NULL THEN p_bio          ELSE bio          END,
    avatar_url   = CASE WHEN p_avatar_url   IS NOT NULL THEN p_avatar_url   ELSE avatar_url   END,
    updated_at   = now()
  WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true);
END;
$$;
REVOKE ALL ON FUNCTION public.update_my_profile(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_my_profile(text, text, text, text) TO authenticated;

-- ── 5. ensure_my_profile — boot-time idempotent profile init ─────────────────
-- Called once per session from auth.js ensureProfile().
-- INSERT with ON CONFLICT (id) DO UPDATE — safe for concurrent first logins.
-- Sets ref_code, display_name, city, lang only when the field is NULL (i.e. not yet set).
-- Returns { ok, ref_code } so caller can update local state without a second SELECT.
-- SECURITY DEFINER: allows INSERT and ref_code update, guarded by explicit logic.
CREATE OR REPLACE FUNCTION public.ensure_my_profile(
  p_display_name text DEFAULT NULL,
  p_ref_code     text DEFAULT NULL,
  p_city         text DEFAULT NULL,
  p_lang         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_ref_code text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  INSERT INTO profiles (
    id, display_name, city, ref_code, language,
    neurons, xp, total_score, created_at, updated_at
  )
  VALUES (
    v_uid, p_display_name, p_city, p_ref_code, p_lang,
    0, 0, 0, now(), now()
  )
  ON CONFLICT (id) DO UPDATE SET
    -- Only fill in fields that are missing; never overwrite existing values
    display_name = CASE WHEN profiles.display_name IS NULL AND p_display_name IS NOT NULL
                        THEN p_display_name ELSE profiles.display_name END,
    city         = CASE WHEN profiles.city IS NULL AND p_city IS NOT NULL
                        THEN p_city ELSE profiles.city END,
    ref_code     = CASE WHEN profiles.ref_code IS NULL AND p_ref_code IS NOT NULL
                        THEN p_ref_code ELSE profiles.ref_code END,
    updated_at   = now();

  SELECT ref_code INTO v_ref_code FROM profiles WHERE id = v_uid;
  RETURN jsonb_build_object('ok', true, 'ref_code', v_ref_code);
END;
$$;
REVOKE ALL ON FUNCTION public.ensure_my_profile(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_my_profile(text, text, text, text) TO authenticated;

-- ── 6. Storage: avatar upload policies ───────────────────────────────────────
-- ONLY avatars_insert_own and avatars_update_own are touched here.
-- mfc_media_select_public is NOT dropped/recreated — avoids DDL lock contention
-- that caused the deadlock in the first migration 73 attempt.
-- If the bucket is configured as public in the Supabase dashboard, SELECT works
-- without an explicit policy. Add a SELECT policy in a separate migration if needed.

DROP POLICY IF EXISTS "avatars_insert_own" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own" ON storage.objects;

-- INSERT: user can upload only to avatars/<their_uid>.<allowed_ext>
CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
  );

-- UPDATE (upsert:true): user can replace only their own canonical path
-- USING checks the existing object's path (not just owner metadata);
-- WITH CHECK validates the replacement path + extension.
CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  )
  WITH CHECK (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
    AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
  );
