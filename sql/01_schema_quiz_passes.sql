-- ============================================================
-- BFC: Quiz Passes Schema
-- Run once in Supabase SQL Editor
-- ============================================================

-- Quiz passes created by organizers
CREATE TABLE IF NOT EXISTS quiz_passes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organizer_name text NOT NULL DEFAULT '',
  title         text NOT NULL,
  description   text,
  event_date    timestamptz,
  location      text,
  price         int  NOT NULL DEFAULT 0 CHECK (price >= 0),
  slots_total   int  NOT NULL DEFAULT 10 CHECK (slots_total > 0),
  slots_left    int  NOT NULL DEFAULT 10 CHECK (slots_left >= 0),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','completed')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT slots_left_lte_total CHECK (slots_left <= slots_total)
);

-- Individual purchases / tickets
CREATE TABLE IF NOT EXISTS quiz_pass_purchases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_id       uuid NOT NULL REFERENCES quiz_passes(id) ON DELETE RESTRICT,
  organizer_id  uuid NOT NULL,
  buyer_id      uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  buyer_name    text NOT NULL DEFAULT '',
  price_paid    int  NOT NULL DEFAULT 0,
  ticket_code   text NOT NULL UNIQUE DEFAULT upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)),
  refunded      boolean NOT NULL DEFAULT false,
  purchased_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_quiz_passes_organizer ON quiz_passes(organizer_id);
CREATE INDEX IF NOT EXISTS idx_quiz_passes_status    ON quiz_passes(status);
CREATE INDEX IF NOT EXISTS idx_qpp_pass_id           ON quiz_pass_purchases(pass_id);
CREATE INDEX IF NOT EXISTS idx_qpp_buyer_id          ON quiz_pass_purchases(buyer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qpp_no_double  ON quiz_pass_purchases(pass_id, buyer_id);

-- RLS
ALTER TABLE quiz_passes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_pass_purchases ENABLE ROW LEVEL SECURITY;

-- quiz_passes: anyone can read active passes; only organizer can write
CREATE POLICY "read active passes"   ON quiz_passes FOR SELECT USING (status = 'active');
CREATE POLICY "organizer insert"     ON quiz_passes FOR INSERT WITH CHECK (organizer_id = auth.uid());
CREATE POLICY "organizer update own" ON quiz_passes FOR UPDATE USING (organizer_id = auth.uid());

-- quiz_pass_purchases: buyer sees own tickets; organizer sees their pass purchases
CREATE POLICY "buyer sees own"       ON quiz_pass_purchases FOR SELECT USING (buyer_id = auth.uid() OR organizer_id = auth.uid());
