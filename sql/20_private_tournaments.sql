-- Private / org tournaments (office championships, sports clubs, etc.)
-- Accessible only via QR code or invite link; hidden from the public list.

ALTER TABLE official_tournaments
  ADD COLUMN IF NOT EXISTS is_private  boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS access_code text    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS org_name    text    DEFAULT NULL;

-- Index so lookups by access_code are fast
CREATE INDEX IF NOT EXISTS idx_official_tournaments_access_code
  ON official_tournaments (access_code)
  WHERE access_code IS NOT NULL;
