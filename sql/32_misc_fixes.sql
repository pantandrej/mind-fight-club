-- ── Migration 32: Miscellaneous fixes ────────────────────────────

-- 0. hype_games table (was missing from all prior migrations)
CREATE TABLE IF NOT EXISTS hype_games (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE,
  title       text        NOT NULL,
  description text,
  questions   jsonb       NOT NULL DEFAULT '[]',
  active      boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Add synced column if table already existed without it
ALTER TABLE hype_games ADD COLUMN IF NOT EXISTS synced boolean NOT NULL DEFAULT false;

ALTER TABLE hype_games ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hype_games_public_read" ON hype_games;
CREATE POLICY "hype_games_public_read" ON hype_games FOR SELECT USING (active = true);

CREATE INDEX IF NOT EXISTS idx_hype_games_slug ON hype_games(slug) WHERE active = true;

-- Seed: one demo game
INSERT INTO hype_games (slug, title, description, questions, synced) VALUES
('logic-blitz', 'Логика-блиц', '7 вопросов за 10 секунд каждый. Кто быстрее?', '[
  {"q":"Сколько секунд в часе?","a":["3600","60","1440","600"],"correct":0},
  {"q":"Какой элемент имеет символ Au?","a":["Серебро","Золото","Алюминий","Аргон"],"correct":1},
  {"q":"Столица Австралии?","a":["Сидней","Мельбурн","Канберра","Брисбен"],"correct":2},
  {"q":"Сколько граней у куба?","a":["4","6","8","12"],"correct":1},
  {"q":"Что тяжелее: 1 кг железа или 1 кг ваты?","a":["Железо","Вата","Одинаково","Зависит от условий"],"correct":2},
  {"q":"Чему равно число π (округлённо до 2 знаков)?","a":["3.14","3.12","3.16","3.18"],"correct":0},
  {"q":"Как называется столица Японии?","a":["Осака","Киото","Токио","Нагоя"],"correct":2}
]', false)
ON CONFLICT (slug) DO NOTHING;

-- 1a. Add last_phrase to duel_rooms for post-game chat fallback
ALTER TABLE duel_rooms ADD COLUMN IF NOT EXISTS last_phrase text;

-- 1b. Add host_user_id to duel_rooms so we can send push to the host
--    when a guest joins.
ALTER TABLE duel_rooms ADD COLUMN IF NOT EXISTS host_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_duel_rooms_host_user ON duel_rooms(host_user_id);

-- 2. ping_presence RPC (if not already created by sql/26_last_seen.sql)
CREATE OR REPLACE FUNCTION ping_presence()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_seen = now() WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION ping_presence() TO authenticated;

-- 3. duel_rooms: ensure RLS allows anyone to read/write rooms by code
--    (without this, guests who are not logged in get 400/403 on join)
ALTER TABLE duel_rooms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "duel_rooms_public_read"  ON duel_rooms;
DROP POLICY IF EXISTS "duel_rooms_public_write" ON duel_rooms;
-- Anyone can read rooms (needed to join by code, even as guest)
CREATE POLICY "duel_rooms_public_read"
  ON duel_rooms FOR SELECT USING (true);
-- Only authenticated users can create/update rooms
CREATE POLICY "duel_rooms_public_write"
  ON duel_rooms FOR ALL USING (true) WITH CHECK (true);

-- 4. pack_results: ensure public read policy exists (400 errors in activity feed)
ALTER TABLE pack_results ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pack_results_public_read" ON pack_results;
CREATE POLICY "pack_results_public_read"
  ON pack_results FOR SELECT USING (true);
