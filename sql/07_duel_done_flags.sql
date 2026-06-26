-- Add host_done / guest_done flags to duel_rooms for clean end-of-battle sync
ALTER TABLE duel_rooms
  ADD COLUMN IF NOT EXISTS host_done  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS guest_done boolean DEFAULT false;
