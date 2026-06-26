-- Пересоздаём admin_users с правильной схемой и добавляем суперадмина

DROP TABLE IF EXISTS admin_users CASCADE;

CREATE TABLE admin_users (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'moderator' CHECK (role IN ('superadmin','moderator','support')),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin only" ON admin_users FOR SELECT
  USING (auth.uid() IN (SELECT user_id FROM admin_users WHERE role = 'superadmin'));

-- Добавляем суперадмина
INSERT INTO admin_users (user_id, role)
SELECT id, 'superadmin'
FROM auth.users
WHERE email = 'mozgokvest.intop@gmail.com';
