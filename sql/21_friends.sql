CREATE TABLE IF NOT EXISTS friendships (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  friend_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, friend_id),
  CHECK(user_id != friend_id)
);
CREATE INDEX IF NOT EXISTS idx_friendships_user ON friendships(user_id);
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user manages own" ON friendships FOR ALL USING (user_id = auth.uid());
CREATE POLICY "see friend relation" ON friendships FOR SELECT USING (friend_id = auth.uid());

CREATE TABLE IF NOT EXISTS async_challenges (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  challenger_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  challenged_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  questions    jsonb NOT NULL DEFAULT '[]',
  challenger_answers jsonb DEFAULT NULL,
  challenged_answers jsonb DEFAULT NULL,
  challenger_score int DEFAULT NULL,
  challenged_score  int DEFAULT NULL,
  status       text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','challenger_done','challenged_done','finished','expired')),
  expires_at   timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_async_challenges_challenged ON async_challenges(challenged_id) WHERE status='pending';
ALTER TABLE async_challenges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants see own" ON async_challenges FOR ALL
  USING (challenger_id = auth.uid() OR challenged_id = auth.uid());
