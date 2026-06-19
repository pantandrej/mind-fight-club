-- ════════════════════════════════════════════════════════════════
-- DRAFT ONLY. Do not run in production until RLS/write policies
-- are completed. Missing:
--   - RLS for organization_departments (no read/write policies)
--   - RLS for corporate_tournament_teams (no policies at all)
--   - insert/update policies for org owner/admin only
--   - trigger to auto-add owner to organization_members on org create
--   - separate RLS for partner_offers (no write policy; admins need INSERT)
--   - policy to prevent clients from setting status='featured' directly
-- ════════════════════════════════════════════════════════════════

-- ════════════════════════════════════════════════════════════════
-- Corporate Tournaments + Shop/Partner Offers Schema
-- These tables lay the architectural foundation.
-- Full implementation is in future iterations.
-- ════════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────────
-- CORPORATE TOURNAMENTS (B2B mode — separate from public tournaments)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS organizations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT        NOT NULL,
  slug         TEXT        NOT NULL UNIQUE,  -- for invite links
  logo_url     TEXT,
  owner_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  plan         TEXT        NOT NULL DEFAULT 'corporate' CHECK (plan IN ('trial','corporate','enterprise')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_departments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_members (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id   UUID REFERENCES organization_departments(id) ON DELETE SET NULL,
  role            TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS corporate_tournaments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title           TEXT        NOT NULL,
  description     TEXT,
  status          TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','scheduled','live','finished','cancelled')),
  starts_at       TIMESTAMPTZ,
  ends_at         TIMESTAMPTZ,
  question_pack   JSONB,      -- questions embedded at creation
  scoring_mode    TEXT        NOT NULL DEFAULT 'individual'
                              CHECK (scoring_mode IN ('individual','department','both')),
  invite_code     TEXT        NOT NULL UNIQUE DEFAULT upper(substring(gen_random_uuid()::text,1,8)),
  created_by      UUID        NOT NULL REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corporate_tournament_teams (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES corporate_tournaments(id) ON DELETE CASCADE,
  department_id  UUID REFERENCES organization_departments(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  total_score    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS corporate_tournament_results (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID        NOT NULL REFERENCES corporate_tournaments(id) ON DELETE CASCADE,
  user_id       UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  team_id       UUID        REFERENCES corporate_tournament_teams(id) ON DELETE SET NULL,
  score         INTEGER     NOT NULL DEFAULT 0,
  rank          INTEGER,
  completed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tournament_id, user_id)
);

-- RLS: corporate data visible only to org members
ALTER TABLE organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_tournaments  ENABLE ROW LEVEL SECURITY;
ALTER TABLE corporate_tournament_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_read" ON organization_members
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "org_read_members" ON organizations
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_members WHERE organization_id = id AND user_id = auth.uid())
  );

CREATE POLICY "corp_tourn_read" ON corporate_tournaments
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM organization_members
             WHERE organization_id = corporate_tournaments.organization_id AND user_id = auth.uid())
  );

CREATE POLICY "corp_results_own" ON corporate_tournament_results
  FOR SELECT USING (user_id = auth.uid());

-- ────────────────────────────────────────────────────────────────
-- SHOP / PARTNER OFFERS (curated marketplace)
-- ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS partner_offers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_name    TEXT        NOT NULL,
  title           TEXT        NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  description     TEXT,
  offer_type      TEXT        NOT NULL DEFAULT 'discount'
                              CHECK (offer_type IN ('discount','product','experience','quiz_pass')),
  price_neurons   INTEGER     NOT NULL DEFAULT 0 CHECK (price_neurons >= 0),
  slots_total     INTEGER,    -- NULL = unlimited
  slots_sold      INTEGER     NOT NULL DEFAULT 0,
  status          TEXT        NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft','active','featured','hidden','expired')),
  image_url       TEXT,
  partner_contact TEXT,       -- how redeemer contacts partner
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS partner_redemptions (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id   UUID        NOT NULL REFERENCES partner_offers(id) ON DELETE RESTRICT,
  user_id    UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code       TEXT        NOT NULL UNIQUE DEFAULT upper(substring(gen_random_uuid()::text,1,8)),
  status     TEXT        NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','used','expired','cancelled')),
  redeemed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(offer_id, user_id)  -- one redemption per user per offer
);

ALTER TABLE partner_offers      ENABLE ROW LEVEL SECURITY;
ALTER TABLE partner_redemptions ENABLE ROW LEVEL SECURITY;

-- Active/featured offers visible to all authenticated users
CREATE POLICY "offers_read_active" ON partner_offers
  FOR SELECT USING (status IN ('active','featured'));

-- Users see their own redemptions
CREATE POLICY "redemptions_own" ON partner_redemptions
  FOR SELECT USING (user_id = auth.uid());

-- ── Shop display rule (enforced in UI, not DB) ────────────────────
-- Home shop shows ONLY:
--   featured offers: 1 (partner of the week)
--   active live events: up to 3
--   active packs: up to 3
--   active prizes/discounts: up to 2
-- This is enforced by ORDER BY + LIMIT queries in the client, not by this schema.

-- ════════════════════════════════════════════════════════════════
-- Indexes
-- ════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_partner_offers_status ON partner_offers(status);
CREATE INDEX IF NOT EXISTS idx_corp_tourn_org ON corporate_tournaments(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_corp_results_tourn ON corporate_tournament_results(tournament_id);
CREATE INDEX IF NOT EXISTS idx_org_members_user ON organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_partner_redemptions_user ON partner_redemptions(user_id);
