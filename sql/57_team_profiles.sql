-- ══════════════════════════════════════════════════════════════════
-- Migration 57: Team profiles — banner, motto, avatar, public page
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Добавляем поля в teams ─────────────────────────────────────
ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS motto       text,
  ADD COLUMN IF NOT EXISTS banner_url  text,
  ADD COLUMN IF NOT EXISTS avatar_url  text,
  ADD COLUMN IF NOT EXISTS emoji       text DEFAULT '🏟️',
  ADD COLUMN IF NOT EXISTS updated_at  timestamptz DEFAULT now();

-- Только капитан команды (первый игрок с team_id) может редактировать
-- Используем RLS через profiles — капитан = кто угодно из команды (упрощённо)
DROP POLICY IF EXISTS "teams_update" ON public.teams;
CREATE POLICY "teams_update" ON public.teams FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.team_id = teams.id
        AND profiles.id = auth.uid()
    )
  );


-- ── 2. RPC: обновить профиль команды ─────────────────────────────
CREATE OR REPLACE FUNCTION update_team_profile(
  p_team_id   uuid,
  p_name      text DEFAULT NULL,
  p_city      text DEFAULT NULL,
  p_motto     text DEFAULT NULL,
  p_emoji     text DEFAULT NULL,
  p_banner_url text DEFAULT NULL,
  p_avatar_url text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  -- Проверяем что пользователь в этой команде
  IF NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = v_user_id AND team_id = p_team_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_member');
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
