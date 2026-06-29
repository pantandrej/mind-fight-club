-- ══════════════════════════════════════════════════════════════════
-- Migration 33: Multi-Club Alignments + B2B Cashback Ledger
-- ══════════════════════════════════════════════════════════════════
-- teams_v2      — player clubs (captain stored in profiles.club_id
--                 logic; we track captain via teams_v2.created_by)
-- brand_profiles— sponsor/organizer brands (owner_id = organizer)
-- ══════════════════════════════════════════════════════════════════

-- ── 0. Prerequisite: captain column on teams_v2 ───────────────────
-- Marks who controls alignment decisions for this club.
ALTER TABLE teams_v2 ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Prerequisite: XP columns for brand sponsor tracking
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS lifetime_xp bigint NOT NULL DEFAULT 0;
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS weekly_xp   bigint NOT NULL DEFAULT 0;

-- ── 1. Table: team_club_alignments ────────────────────────────────
CREATE TABLE IF NOT EXISTS team_club_alignments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id    uuid        NOT NULL REFERENCES teams_v2(id)      ON DELETE CASCADE,
  brand_id   uuid        NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tca_unique_pair UNIQUE (team_id, brand_id)
);

CREATE INDEX IF NOT EXISTS idx_tca_team  ON team_club_alignments(team_id);
CREATE INDEX IF NOT EXISTS idx_tca_brand ON team_club_alignments(brand_id);

-- ── 2. Trigger: enforce max 3 aligned clubs per team ─────────────
CREATE OR REPLACE FUNCTION _check_team_alignment_limit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM team_club_alignments
    WHERE team_id = NEW.team_id
  ) >= 3 THEN
    RAISE EXCEPTION
      'A team can only align with a maximum of 3 clubs simultaneously.'
      USING ERRCODE = 'check_violation', HINT = 'Remove an existing alignment first.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_team_alignment_limit ON team_club_alignments;
CREATE TRIGGER trg_team_alignment_limit
  BEFORE INSERT ON team_club_alignments
  FOR EACH ROW EXECUTE FUNCTION _check_team_alignment_limit();

-- ── 3. Table: organizer_cashback_ledger ───────────────────────────
CREATE TABLE IF NOT EXISTS organizer_cashback_ledger (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id      uuid        NOT NULL REFERENCES brand_profiles(id) ON DELETE CASCADE,
  team_id       uuid        NOT NULL REFERENCES teams_v2(id),
  amount_rub    numeric(12, 2) NOT NULL CHECK (amount_rub > 0),
  purchase_type text        NOT NULL,          -- e.g. 'pro_training_subscription'
  idempotency_key text      UNIQUE,            -- prevents double-crediting same event
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cashback_brand   ON organizer_cashback_ledger(brand_id);
CREATE INDEX IF NOT EXISTS idx_cashback_team    ON organizer_cashback_ledger(team_id);
CREATE INDEX IF NOT EXISTS idx_cashback_created ON organizer_cashback_ledger(created_at DESC);

-- ── 4. RPC: propagate XP gain to all aligned sponsor brands ──────
--
-- Called after any XP-awarding event (duel win, training complete, etc.)
-- Arguments:
--   p_team_id  — the team that earned XP
--   p_xp_delta — amount of XP to credit to each aligned brand
--
CREATE OR REPLACE FUNCTION propagate_team_xp_to_brands(
  p_team_id  uuid,
  p_xp_delta int
)
RETURNS int                          -- returns number of brands updated
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int;
BEGIN
  -- Atomically increment both lifetime and weekly XP for every
  -- brand currently aligned with this team.
  WITH aligned AS (
    SELECT brand_id
    FROM team_club_alignments
    WHERE team_id = p_team_id
    FOR UPDATE                        -- lock rows to prevent race conditions
  )
  UPDATE brand_profiles bp
  SET
    lifetime_xp = lifetime_xp + p_xp_delta,
    weekly_xp   = weekly_xp   + p_xp_delta
  FROM aligned
  WHERE bp.id = aligned.brand_id;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION propagate_team_xp_to_brands(uuid, int) TO authenticated, service_role;

-- ── 5. RPC: add cashback entry (idempotent) ───────────────────────
--
-- Called from purchase webhook / Edge Function.
-- Returns the new ledger row (or existing on conflict).
--
CREATE OR REPLACE FUNCTION record_organizer_cashback(
  p_brand_id        uuid,
  p_team_id         uuid,
  p_amount_rub      numeric,
  p_purchase_type   text,
  p_idempotency_key text
)
RETURNS organizer_cashback_ledger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row organizer_cashback_ledger;
BEGIN
  INSERT INTO organizer_cashback_ledger
    (brand_id, team_id, amount_rub, purchase_type, idempotency_key)
  VALUES
    (p_brand_id, p_team_id, p_amount_rub, p_purchase_type, p_idempotency_key)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING * INTO v_row;

  -- If row already existed (DO NOTHING), fetch it
  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM organizer_cashback_ledger
    WHERE idempotency_key = p_idempotency_key;
  END IF;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION record_organizer_cashback(uuid, uuid, numeric, text, text) TO service_role;
-- Note: intentionally NOT granted to 'authenticated' — only called from trusted backend

-- ── 6. RLS: team_club_alignments ─────────────────────────────────
ALTER TABLE team_club_alignments ENABLE ROW LEVEL SECURITY;

-- Anyone can read alignments (used for public sponsor badge display)
DROP POLICY IF EXISTS "tca_public_read"   ON team_club_alignments;
CREATE POLICY "tca_public_read"
  ON team_club_alignments FOR SELECT
  USING (true);

-- Only the team captain (created_by) can add/remove alignments
DROP POLICY IF EXISTS "tca_captain_write" ON team_club_alignments;
CREATE POLICY "tca_captain_write"
  ON team_club_alignments FOR ALL
  USING (
    team_id IN (
      SELECT id FROM teams_v2 WHERE created_by = auth.uid()
    )
  )
  WITH CHECK (
    team_id IN (
      SELECT id FROM teams_v2 WHERE created_by = auth.uid()
    )
  );

-- ── 7. RLS: organizer_cashback_ledger ────────────────────────────
ALTER TABLE organizer_cashback_ledger ENABLE ROW LEVEL SECURITY;

-- Organizers can only see their own brand's cashback rows
DROP POLICY IF EXISTS "cashback_organizer_read" ON organizer_cashback_ledger;
CREATE POLICY "cashback_organizer_read"
  ON organizer_cashback_ledger FOR SELECT
  USING (
    brand_id IN (
      SELECT id FROM brand_profiles WHERE owner_id = auth.uid()
    )
  );

-- No direct client writes — inserts happen only via record_organizer_cashback() RPC
-- (SECURITY DEFINER, called from service_role webhook)
DROP POLICY IF EXISTS "cashback_no_client_write" ON organizer_cashback_ledger;
CREATE POLICY "cashback_no_client_write"
  ON organizer_cashback_ledger FOR INSERT
  WITH CHECK (false);

-- ── 8. Utility view: organizer cashback summary ───────────────────
CREATE OR REPLACE VIEW organizer_cashback_summary AS
SELECT
  ocl.brand_id,
  bp.name                                    AS brand_name,
  COUNT(*)                                   AS total_transactions,
  SUM(ocl.amount_rub)                        AS total_cashback_rub,
  SUM(ocl.amount_rub) FILTER (
    WHERE ocl.created_at >= date_trunc('month', now())
  )                                          AS current_month_rub,
  MAX(ocl.created_at)                        AS last_transaction_at
FROM organizer_cashback_ledger ocl
JOIN brand_profiles bp ON bp.id = ocl.brand_id
WHERE bp.owner_id = auth.uid()       -- row-level: each organizer sees only their own
GROUP BY ocl.brand_id, bp.name;

-- ── 9. Weekly XP reset for brand sponsor leaderboard ─────────────
-- Run via pg_cron every Monday 00:00 UTC:
-- SELECT cron.schedule('reset-brand-weekly-xp', '0 0 * * 1', 'UPDATE brand_profiles SET weekly_xp = 0');
