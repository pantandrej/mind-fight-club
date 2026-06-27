-- ── Tournaments ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournaments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     text NOT NULL,                        -- e.g. 'videogames'
  title       text NOT NULL,
  description text,
  starts_at   timestamptz NOT NULL,
  q_duration  int NOT NULL DEFAULT 30,              -- seconds per question
  a_duration  int NOT NULL DEFAULT 15,              -- seconds to show answer
  status      text NOT NULL DEFAULT 'upcoming'
                CHECK (status IN ('upcoming','active','finished')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tournaments readable by all" ON tournaments FOR SELECT USING (true);
CREATE POLICY "tournaments writable by admins" ON tournaments FOR ALL
  USING (EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournament_participants (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  score           int NOT NULL DEFAULT 0,
  correct         int NOT NULL DEFAULT 0,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tournament_id, user_id)
);

ALTER TABLE tournament_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "participants readable by all" ON tournament_participants FOR SELECT USING (true);
CREATE POLICY "participants insert own" ON tournament_participants FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "participants update own" ON tournament_participants FOR UPDATE
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournament_answers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id   uuid NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  question_n      int NOT NULL,
  picked          int NOT NULL,   -- answer index chosen (-1 = timeout)
  correct         bool NOT NULL,
  pts             int NOT NULL DEFAULT 0,
  answered_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tournament_id, user_id, question_n)
);

ALTER TABLE tournament_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "answers insert own" ON tournament_answers FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "answers select own" ON tournament_answers FOR SELECT
  USING (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────────────

-- Register for tournament (idempotent)
CREATE OR REPLACE FUNCTION register_for_tournament(p_tournament_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_t tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason', 'not_found'); END IF;
  IF v_t.status = 'finished' THEN RETURN jsonb_build_object('ok', false, 'reason', 'finished'); END IF;

  INSERT INTO tournament_participants (tournament_id, user_id)
  VALUES (p_tournament_id, auth.uid())
  ON CONFLICT (tournament_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Submit answer for a question
CREATE OR REPLACE FUNCTION submit_tournament_answer(
  p_tournament_id uuid,
  p_question_n    int,
  p_picked        int,
  p_correct       bool,
  p_pts           int
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO tournament_answers (tournament_id, user_id, question_n, picked, correct, pts)
  VALUES (p_tournament_id, auth.uid(), p_question_n, p_picked, p_correct, p_pts)
  ON CONFLICT (tournament_id, user_id, question_n) DO NOTHING;

  -- Update participant score
  UPDATE tournament_participants
  SET score   = score + p_pts,
      correct = correct + (CASE WHEN p_correct THEN 1 ELSE 0 END)
  WHERE tournament_id = p_tournament_id AND user_id = auth.uid();

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Auto-activate tournaments when starts_at is reached (call from cron or client check)
CREATE OR REPLACE FUNCTION sync_tournament_statuses()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  r tournaments%ROWTYPE;
BEGIN
  FOR r IN SELECT * FROM tournaments WHERE status != 'finished' LOOP
    IF r.status = 'upcoming' AND r.starts_at <= now() THEN
      UPDATE tournaments SET status = 'active' WHERE id = r.id;
    END IF;
    -- Mark finished: starts_at + (q_count * (q_duration + a_duration)) seconds
    -- We use 15 questions * 45s = 675s as a rough estimate; refined on client
  END LOOP;
END;
$$;

-- Insert first tournament: Видеоигры, starts 7 days from now
INSERT INTO tournaments (pack_id, title, description, starts_at, q_duration, a_duration)
VALUES (
  'videogames',
  'Видеоигры — сезон 1',
  '15 вопросов про культовые игры. Все отвечают одновременно, таймер на вопрос — 30 секунд.',
  now() + interval '7 days',
  30,
  15
);
