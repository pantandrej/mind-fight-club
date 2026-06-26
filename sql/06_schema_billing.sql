-- ============================================================
-- BFC: Billing tables for YooKassa / Premium subscriptions
-- Run once in Supabase SQL Editor
-- ============================================================

-- ── payments ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider                    text NOT NULL DEFAULT 'yookassa',
  provider_payment_id         text,
  provider_payment_method_id  text,
  amount_rub                  int  NOT NULL,
  currency                    text NOT NULL DEFAULT 'RUB',
  status                      text NOT NULL DEFAULT 'pending'
                                   CHECK (status IN ('pending','succeeded','failed','canceled','refunded')),
  product_type                text NOT NULL,
  description                 text,
  confirmation_url            text,
  subscription_id             uuid,
  raw_payload                 jsonb,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_user        ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_provider_id ON payments(provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_status      ON payments(status);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
-- Users see their own payments; service role sees all (for webhook)
CREATE POLICY "user sees own payments" ON payments FOR SELECT USING (user_id = auth.uid());

-- ── subscriptions ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS subscriptions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  plan                        text NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  status                      text NOT NULL DEFAULT 'active' CHECK (status IN ('active','canceled','expired','paused')),
  provider                    text NOT NULL DEFAULT 'yookassa',
  provider_payment_method_id  text,
  amount_rub                  int,
  current_period_start        timestamptz,
  current_period_end          timestamptz,
  next_charge_at              timestamptz,
  cancel_at_period_end        boolean NOT NULL DEFAULT false,
  last_payment_id             uuid REFERENCES payments(id),
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user   ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_charge ON subscriptions(next_charge_at) WHERE next_charge_at IS NOT NULL;

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
-- Users read their own; webhook (service role) writes
CREATE POLICY "user reads own subscription" ON subscriptions FOR SELECT USING (user_id = auth.uid());

-- ── billing_events ────────────────────────────────────────────
-- Webhook idempotency log
CREATE TABLE IF NOT EXISTS billing_events (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider             text NOT NULL,
  event_type           text NOT NULL,
  provider_payment_id  text NOT NULL,
  payload              jsonb,
  processed            boolean NOT NULL DEFAULT false,
  error                text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_payment_id, event_type)
);

CREATE INDEX IF NOT EXISTS idx_billing_events_pid ON billing_events(provider_payment_id);

ALTER TABLE billing_events ENABLE ROW LEVEL SECURITY;
-- Only service role can read/write (webhook) — no user-facing policy needed

-- ── Helper: is_premium() ──────────────────────────────────────
-- Returns true if the calling user has an active premium subscription
CREATE OR REPLACE FUNCTION is_premium()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions
    WHERE user_id = auth.uid()
      AND plan    = 'premium'
      AND status  = 'active'
      AND (current_period_end IS NULL OR current_period_end > now())
  );
$$;

GRANT EXECUTE ON FUNCTION is_premium() TO authenticated;
