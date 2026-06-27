-- Add per-question score arrays to duel_rooms for accurate dot display
ALTER TABLE duel_rooms
  ADD COLUMN IF NOT EXISTS host_answers jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS guest_answers jsonb DEFAULT '[]'::jsonb;
