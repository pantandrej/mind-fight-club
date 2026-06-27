-- Pack play history
CREATE TABLE IF NOT EXISTS pack_results (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  pack_id    text NOT NULL,
  pack_title text,
  score      int NOT NULL DEFAULT 0,
  correct    int NOT NULL DEFAULT 0,
  total      int NOT NULL DEFAULT 0,
  played_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pack_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pack_results insert own" ON pack_results FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "pack_results select own" ON pack_results FOR SELECT USING (auth.uid() = user_id);
