-- ══════════════════════════════════════════════════════════════════
-- Migration 34: Two-Tier Franchise Model (Master Brand ➔ City Branch)
-- ══════════════════════════════════════════════════════════════════
-- brand_profiles already has `city` and `parent_id` (from migration 27).
-- This migration:
--   1. Adds country_code for multi-country support
--   2. Renames the FK semantics to be explicit (parent_brand_id alias
--      via a generated column would break existing code, so we keep
--      `parent_id` as the canonical column and document it clearly)
--   3. Adds a unique constraint so a master brand can't have two
--      branches in the same city
--   4. Creates v_city_branches view for unified display-name resolution
--   5. Adds RLS scoped to branch ownership
-- ══════════════════════════════════════════════════════════════════

-- ── 1. New columns ─────────────────────────────────────────────────
ALTER TABLE brand_profiles ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'RU';

-- parent_id already exists (sql/27) — this IS parent_brand_id semantically.
-- Add a clarifying comment so future devs don't duplicate the column.
COMMENT ON COLUMN brand_profiles.parent_id IS
  'References the master franchise brand. NULL = this row is a master/standalone brand. Non-NULL = this row is a local city branch.';
COMMENT ON COLUMN brand_profiles.city IS
  'Required for branch rows (parent_id IS NOT NULL). NULL for master brands operating globally.';

-- ── 2. Prevent duplicate branches in the same city for one franchise ─
CREATE UNIQUE INDEX IF NOT EXISTS uq_brand_parent_city
  ON brand_profiles (parent_id, city)
  WHERE parent_id IS NOT NULL;

-- Sanity constraint: a branch (parent_id set) must have a city
ALTER TABLE brand_profiles DROP CONSTRAINT IF EXISTS chk_branch_requires_city;
ALTER TABLE brand_profiles ADD CONSTRAINT chk_branch_requires_city
  CHECK (parent_id IS NULL OR city IS NOT NULL);

-- Prevent a branch from pointing to itself or creating a 3-level chain
-- (franchise model is strictly 2-tier: master -> branch, not master -> branch -> sub-branch)
CREATE OR REPLACE FUNCTION _check_franchise_depth()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL THEN
    IF NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'A brand cannot be its own parent franchise.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM brand_profiles WHERE id = NEW.parent_id AND parent_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Franchise model is two-tier only: the parent brand must itself be a master brand (parent_id IS NULL).';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_franchise_depth ON brand_profiles;
CREATE TRIGGER trg_franchise_depth
  BEFORE INSERT OR UPDATE OF parent_id ON brand_profiles
  FOR EACH ROW EXECUTE FUNCTION _check_franchise_depth();

-- ── 3. View: v_city_branches ───────────────────────────────────────
-- Resolves the display name for ANY brand row:
--   - Master brand (parent_id IS NULL): just `name`
--   - City branch (parent_id IS NOT NULL): "{parent.name} {city}"
CREATE OR REPLACE VIEW v_city_branches AS
SELECT
  b.id,
  b.slug,
  b.owner_id,
  b.parent_id,
  b.city,
  b.country_code,
  b.logo_url,
  b.description,
  b.external_links,
  b.created_at,
  CASE
    WHEN b.parent_id IS NOT NULL THEN
      COALESCE(p.name, b.name) || ' ' || COALESCE(b.city, '')
    ELSE
      b.name
  END AS display_name,
  -- Convenience flags for frontend logic
  (b.parent_id IS NOT NULL)            AS is_branch,
  p.name                                AS parent_brand_name,
  p.slug                                AS parent_brand_slug
FROM brand_profiles b
LEFT JOIN brand_profiles p ON p.id = b.parent_id;

-- View inherits RLS from underlying table automatically in Postgres
-- (security_invoker is the default for views in PG15+; for older
-- versions on Supabase, explicitly enable it)
ALTER VIEW v_city_branches SET (security_invoker = true);

-- ── 4. RLS: branch owners manage only their own branch ──────────────
-- (brand_profiles_owner_write from sql/27 already does this correctly
--  via `owner_id = auth.uid()` — branches and master brands both have
--  their own owner_id, so no change needed there. Re-asserting for clarity.)
DROP POLICY IF EXISTS "brand_profiles_owner_write" ON brand_profiles;
CREATE POLICY "brand_profiles_owner_write"
  ON brand_profiles FOR ALL
  USING (auth.uid() = owner_id)
  WITH CHECK (auth.uid() = owner_id);

-- ── 5. RLS: branch owners see only THEIR city's cashback ledger ────
-- (organizer_cashback_ledger from sql/33 already scopes by brand_id
--  owned by auth.uid() — since each branch is its own brand_profiles
--  row with its own owner_id, this already isolates by city/branch.
--  No schema change needed; documenting the guarantee here.)
COMMENT ON POLICY "cashback_organizer_read" ON organizer_cashback_ledger IS
  'Each city branch has a distinct brand_profiles row with its own owner_id, so this policy already isolates ledger visibility per-branch, not just per-franchise.';

-- ── 6. Helper RPC: register a new city branch (used by Organizer Cabinet) ──
CREATE OR REPLACE FUNCTION register_city_branch(
  p_parent_brand_id uuid,
  p_city            text,
  p_slug            text,
  p_country_code    text DEFAULT 'RU'
)
RETURNS brand_profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent brand_profiles;
  v_row    brand_profiles;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to register a branch.';
  END IF;

  SELECT * INTO v_parent FROM brand_profiles WHERE id = p_parent_brand_id;
  IF v_parent.id IS NULL THEN
    RAISE EXCEPTION 'Parent franchise brand not found.';
  END IF;
  IF v_parent.parent_id IS NOT NULL THEN
    RAISE EXCEPTION 'Selected brand is itself a branch — choose a master franchise.';
  END IF;

  INSERT INTO brand_profiles (owner_id, slug, name, city, country_code, parent_id)
  VALUES (auth.uid(), p_slug, v_parent.name, p_city, p_country_code, p_parent_brand_id)
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

GRANT EXECUTE ON FUNCTION register_city_branch(uuid, text, text, text) TO authenticated;

-- ── 7. Index for master-brand dropdown query ────────────────────────
CREATE INDEX IF NOT EXISTS idx_brand_profiles_masters
  ON brand_profiles (name) WHERE parent_id IS NULL;
