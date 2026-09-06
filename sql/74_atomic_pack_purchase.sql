-- ══════════════════════════════════════════════════════════════════════════
-- Migration 74: Atomic pack purchase + RLS for user_pack_purchases
--
-- Problem: buyDBPack() ran two separate transactions:
--   1. spendNeurons() RPC → COMMIT (neurons gone)
--   2. INSERT user_pack_purchases → separate tx (could fail → neurons lost)
--   Additionally: no RLS on user_pack_purchases → client could INSERT
--   price_neurons=0 for a paid pack (confirmed: table not in any prior migration,
--   no policies found in sql/00–73).
--
-- Solution: purchase_pack(p_pack_id) SECURITY DEFINER executes everything
-- in ONE plpgsql transaction: balance lock → ledger → balance deduct →
-- ownership INSERT. If any step raises an exception the whole tx rolls back.
--
-- Does NOT touch migrations 68–73.
-- Does NOT reset balances or delete ledger history.
-- ══════════════════════════════════════════════════════════════════════════

-- ── Step 1: Ensure UNIQUE constraint on user_pack_purchases ──────────────
-- The table was created via Supabase Dashboard (not in sql/00–73).
-- We add the constraint only if it doesn't already exist, and only if
-- there are no duplicate rows (we check first and abort if duplicates found).

DO $$
DECLARE
  v_dup_count int;
BEGIN
  -- Check for existing duplicates before adding UNIQUE constraint
  SELECT COUNT(*) INTO v_dup_count
  FROM (
    SELECT user_id, game_pack_id, COUNT(*) AS cnt
    FROM public.user_pack_purchases
    GROUP BY user_id, game_pack_id
    HAVING COUNT(*) > 1
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION
      'Migration 74 ABORTED: % duplicate (user_id, game_pack_id) rows found in user_pack_purchases. '
      'Resolve duplicates manually, then re-run this migration.',
      v_dup_count;
  END IF;

  -- Add UNIQUE constraint only if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_pack_purchases'::regclass
      AND contype = 'u'
      AND conname = 'user_pack_purchases_user_id_game_pack_id_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_pack_purchases'::regclass
      AND contype = 'u'
      AND array_length(conkey, 1) = 2  -- covers any 2-col unique constraint
  ) THEN
    ALTER TABLE public.user_pack_purchases
      ADD CONSTRAINT user_pack_purchases_user_id_game_pack_id_key
      UNIQUE (user_id, game_pack_id);
  END IF;
END $$;

-- ── Step 2: RLS on user_pack_purchases ───────────────────────────────────
-- The table may have had no RLS (created via Dashboard).
-- We enable it and define minimal policies:
--   SELECT own rows only.
--   INSERT/UPDATE/DELETE blocked for authenticated role (only SECURITY DEFINER
--   purchase_pack can write, which runs as the function owner, not 'authenticated').

ALTER TABLE public.user_pack_purchases ENABLE ROW LEVEL SECURITY;

-- Drop any pre-existing write policies to avoid permissive OR-ing.
-- We query by name; if they don't exist, DROP IF EXISTS is a no-op.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_pack_purchases'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_pack_purchases', pol.policyname);
  END LOOP;
END $$;

-- Keep or create a SELECT policy (users can read their own purchases for shop UI).
-- Drop any existing SELECT policy to recreate consistently.
DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'user_pack_purchases'
      AND cmd = 'SELECT'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_pack_purchases', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "upack_select_own"
  ON public.user_pack_purchases
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- No INSERT/UPDATE/DELETE policies → authenticated role cannot write directly.
-- SECURITY DEFINER purchase_pack runs as its owner (postgres/service role),
-- bypassing RLS entirely for its internal writes.

-- ── Step 3: purchase_pack RPC ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.purchase_pack(p_pack_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid    := auth.uid();
  v_price       int;
  v_is_free     boolean;
  v_pack_status text;
  v_op_key      text;
  v_neurons     int;
BEGIN
  -- 1. Authentication guard
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- 2. Load authoritative pack data — server decides price and availability.
  --    Only 'published' packs are purchasable by regular users.
  --    Columns confirmed in JS: price_neurons, is_free, is_hype, status.
  --    NOTE: is_hype packs are free by design (is_hype = true → price = 0).
  SELECT
    COALESCE(price_neurons, 0),
    COALESCE(is_free, false) OR COALESCE(is_hype, false) OR COALESCE(price_neurons, 0) = 0,
    status
  INTO v_price, v_is_free, v_pack_status
  FROM public.game_packs
  WHERE id = p_pack_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pack_not_found');
  END IF;

  -- Only published packs are purchasable through this public RPC.
  -- draft / tester / archived variants require admin access (separate flow).
  IF v_pack_status <> 'published' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'pack_not_available');
  END IF;

  -- 3. Already owned? → idempotent success, no second charge.
  --    ON CONFLICT below also handles the concurrent-request race,
  --    but this early check avoids the FOR UPDATE lock on profiles
  --    when the common case is a repeat tap on an already-owned pack.
  IF EXISTS (
    SELECT 1 FROM public.user_pack_purchases
    WHERE user_id = v_uid AND game_pack_id = p_pack_id
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;

  -- 4. FREE PACK: grant ownership immediately, no balance interaction.
  IF v_is_free THEN
    INSERT INTO public.user_pack_purchases (user_id, game_pack_id, price_neurons, purchased_at)
    VALUES (v_uid, p_pack_id, 0, now())
    ON CONFLICT (user_id, game_pack_id) DO NOTHING;

    RETURN jsonb_build_object('ok', true, 'already_owned', false, 'neurons_spent', 0);
  END IF;

  -- 5. PAID PACK: atomic balance lock → ledger → deduct → grant ownership.
  --    All in one plpgsql transaction — if any statement raises, the whole
  --    tx rolls back (no partial state).

  -- 5a. Lock profile row to prevent concurrent overdraft.
  SELECT neurons INTO v_neurons
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF v_neurons IS NULL OR v_neurons < v_price THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'insufficient',
      'balance', COALESCE(v_neurons, 0),
      'required', v_price
    );
  END IF;

  -- 5b. Idempotency key — derived entirely server-side, client never supplies it.
  v_op_key := 'pack_purchase:' || v_uid::text || ':' || p_pack_id::text;

  -- 5c. Ledger entry — UNIQUE(user_id, operation_key) prevents double-spend.
  --     If the key already exists the pack was already granted; return already_owned.
  INSERT INTO public.currency_ledger
    (user_id, operation_type, operation_key, awarded_neurons, awarded_xp)
  VALUES
    (v_uid, 'pack_purchase', v_op_key, -v_price, 0)
  ON CONFLICT (user_id, operation_key) DO NOTHING;

  IF NOT FOUND THEN
    -- Ledger row existed → purchase already processed.
    RETURN jsonb_build_object('ok', true, 'already_owned', true);
  END IF;

  -- 5d. Deduct balance.
  UPDATE public.profiles
  SET    neurons    = neurons - v_price,
         updated_at = now()
  WHERE  id = v_uid;

  -- 5e. Grant ownership. ON CONFLICT is a safety net for concurrent requests
  --     that raced past the early EXISTS check above.
  INSERT INTO public.user_pack_purchases (user_id, game_pack_id, price_neurons, purchased_at)
  VALUES (v_uid, p_pack_id, v_price, now())
  ON CONFLICT (user_id, game_pack_id) DO NOTHING;

  -- Return updated balance so client can sync without an extra fetch.
  SELECT neurons INTO v_neurons FROM public.profiles WHERE id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'already_owned', false,
    'neurons_spent', v_price,
    'neurons', v_neurons
  );
END;
$$;

-- ── Step 4: Grants ────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.purchase_pack(uuid) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.purchase_pack(uuid) TO authenticated;
