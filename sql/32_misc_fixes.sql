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

-- 1. Add host_user_id to duel_rooms so we can send push to the host
--    when a guest joins.
ALTER TABLE duel_rooms ADD COLUMN IF NOT EXISTS host_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_duel_rooms_host_user ON duel_rooms(host_user_id);

-- 2. ping_presence RPC (if not already created by sql/26_last_seen.sql)
CREATE OR REPLACE FUNCTION ping_presence()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE profiles SET last_seen = now() WHERE id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION ping_presence() TO authenticated;

-- 3. Drop stale policy name if re-running sql/30 again
-- (already handled in sql/30_partner_quests.sql via DROP POLICY IF EXISTS)
