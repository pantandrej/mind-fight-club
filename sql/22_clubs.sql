CREATE TABLE IF NOT EXISTS clubs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL UNIQUE,
  description text,
  emoji       text DEFAULT '🧠',
  owner_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_count int NOT NULL DEFAULT 1,
  total_neurons bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_clubs_neurons ON clubs(total_neurons DESC);
ALTER TABLE clubs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clubs public read" ON clubs FOR SELECT USING (true);
CREATE POLICY "owner manages" ON clubs FOR ALL USING (owner_id = auth.uid());

CREATE TABLE IF NOT EXISTS club_members (
  club_id    uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
  joined_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_club_members_club ON club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members(user_id);
ALTER TABLE club_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "members public read" ON club_members FOR SELECT USING (true);
CREATE POLICY "self manage" ON club_members FOR ALL USING (user_id = auth.uid());

-- Add club_id to profiles for quick lookup
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS club_id uuid REFERENCES clubs(id) ON DELETE SET NULL;

-- RPC: join_club — atomic member_count increment + profile update
CREATE OR REPLACE FUNCTION join_club(p_club_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE clubs SET member_count = member_count + 1 WHERE id = p_club_id AND member_count < 50;
  UPDATE profiles SET club_id = p_club_id WHERE id = auth.uid();
END;$$;
GRANT EXECUTE ON FUNCTION join_club(uuid) TO authenticated;

-- RPC: leave_club — atomic member_count decrement + profile update
CREATE OR REPLACE FUNCTION leave_club(p_club_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE clubs SET member_count = GREATEST(member_count - 1, 0) WHERE id = p_club_id;
  UPDATE profiles SET club_id = NULL WHERE id = auth.uid() AND club_id = p_club_id;
END;$$;
GRANT EXECUTE ON FUNCTION leave_club(uuid) TO authenticated;
