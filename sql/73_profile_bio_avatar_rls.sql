-- Migration 73: Profile bio/avatar write access + storage policies
--
-- Root causes fixed:
--   1. profiles UPDATE RLS: no policy existed → POST /profiles?id=eq.* returns 400.
--      guard_critical_profile_fields trigger (migration 70) already protects economy/
--      security fields server-side, so a broad UPDATE policy is safe.
--   2. storage.objects: no INSERT+UPDATE policy for avatars/* → upload returns 400.
--   3. Ensure bio + avatar_url columns exist (defensive IF NOT EXISTS).
--
-- Migrations 68–72 are already applied — not edited here.
-- This migration is idempotent and production-safe.

-- ── 1. Ensure user-controlled profile columns exist ───────────────────────────
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio        text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

-- ── 2. profiles: UPDATE RLS policy for authenticated users ───────────────────
-- Allows authenticated users to UPDATE their own row.
-- Critical fields (neurons, xp, daily_streak, referred_by, is_admin, is_scout,
-- premium_until) are protected by the guard_critical_profile_fields BEFORE UPDATE
-- trigger (migration 70) — the trigger resets those fields to OLD values when
-- current_user = 'authenticated'. No additional column-level restriction needed.

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own" ON public.profiles
  FOR UPDATE
  TO authenticated
  USING    (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ── 3. Storage: avatars upload/replace policy ─────────────────────────────────
-- Path format: avatars/<user_id>.<ext>  (e.g. avatars/abc-123.jpg)
-- INSERT: user can only write to their own avatar path.
-- UPDATE: user can replace their own avatar (upsert: true in JS).
-- SELECT: public read (bucket is public — getPublicUrl works without signing).

DROP POLICY IF EXISTS "avatars_insert_own"      ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_own"      ON storage.objects;
DROP POLICY IF EXISTS "mfc_media_select_public" ON storage.objects;

CREATE POLICY "avatars_insert_own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  );

CREATE POLICY "avatars_update_own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND owner  = auth.uid()
  )
  WITH CHECK (
    bucket_id = 'mfc-media'
    AND (storage.foldername(name))[1] = 'avatars'
    AND name LIKE 'avatars/' || auth.uid()::text || '.%'
  );

CREATE POLICY "mfc_media_select_public" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'mfc-media');
