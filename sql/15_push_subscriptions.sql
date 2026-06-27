CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  endpoint     text NOT NULL UNIQUE,
  keys         jsonb NOT NULL,
  tournament_id uuid REFERENCES tournaments(id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "push own" ON push_subscriptions FOR ALL USING (auth.uid() = user_id);
