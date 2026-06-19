-- ════════════════════════════════════════════════════════════════
-- start_game_session RPC  (v2 — race-condition safe)
-- Enforces plan limits server-side before any game starts.
-- Client NEVER sends plan tier — server determines from subscriptions.
-- ════════════════════════════════════════════════════════════════

-- ── Supporting tables ────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS subscriptions (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  plan       TEXT        NOT NULL DEFAULT 'free' CHECK (plan IN ('free','premium')),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "subscriptions_read_own" ON subscriptions;
CREATE POLICY "subscriptions_read_own" ON subscriptions FOR SELECT USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS game_sessions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  mode         TEXT        NOT NULL CHECK (mode IN ('training','friend_battle','random_battle','virtual_battle')),
  day_utc      DATE        NOT NULL,
  opponent_id  UUID,
  invite_id    UUID,
  social_bonus BOOLEAN     NOT NULL DEFAULT false,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_game_sessions_user_day  ON game_sessions(user_id, day_utc, mode);
CREATE INDEX IF NOT EXISTS idx_game_sessions_battle    ON game_sessions(user_id, day_utc)
  WHERE mode IN ('friend_battle','random_battle','virtual_battle') AND social_bonus = false;
CREATE INDEX IF NOT EXISTS idx_game_sessions_social    ON game_sessions(user_id, opponent_id, day_utc)
  WHERE social_bonus = true;

ALTER TABLE game_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "game_sessions_own" ON game_sessions;
CREATE POLICY "game_sessions_own" ON game_sessions FOR SELECT USING (auth.uid() = user_id);
-- No INSERT from client — only via RPC (SECURITY DEFINER)

-- ── battle_invites (required for social bonus validation) ─────────
CREATE TABLE IF NOT EXISTS battle_invites (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  receiver_id UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','accepted','expired','cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_battle_invites_receiver ON battle_invites(receiver_id, status);
CREATE INDEX IF NOT EXISTS idx_battle_invites_sender   ON battle_invites(sender_id, status);

ALTER TABLE battle_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "battle_invites_read" ON battle_invites;
CREATE POLICY "battle_invites_read" ON battle_invites
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = receiver_id);
DROP POLICY IF EXISTS "battle_invites_insert" ON battle_invites;
CREATE POLICY "battle_invites_insert" ON battle_invites
  FOR INSERT WITH CHECK (auth.uid() = sender_id);
DROP POLICY IF EXISTS "battle_invites_update_receiver" ON battle_invites;
CREATE POLICY "battle_invites_update_receiver" ON battle_invites
  FOR UPDATE USING (auth.uid() = receiver_id AND status = 'pending')
  WITH CHECK (status IN ('accepted','cancelled'));

-- ── RPC ───────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS start_game_session(TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION start_game_session(
  p_mode        TEXT,
  p_opponent_id UUID DEFAULT NULL,
  p_invite_id   UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id       UUID    := auth.uid();
  -- Fix: use (NOW() AT TIME ZONE 'UTC')::DATE for consistent UTC day across all clients
  v_day           DATE    := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_plan          TEXT    := 'free';
  v_is_battle     BOOLEAN := p_mode IN ('friend_battle','random_battle','virtual_battle');
  v_is_training   BOOLEAN := p_mode = 'training';
  v_training_limit  INTEGER;
  v_battle_limit    INTEGER;
  v_training_used   INTEGER := 0;
  v_battles_used    INTEGER := 0;
  v_social_used     INTEGER := 0;
  v_is_social_bonus BOOLEAN := false;
  v_session_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF p_mode NOT IN ('training','friend_battle','random_battle','virtual_battle') THEN
    RAISE EXCEPTION 'Invalid mode: %', p_mode;
  END IF;

  -- ── Advisory lock to prevent race conditions ────────────────────
  -- Training: lock per user+day+mode
  -- Battles: use shared 'battle' key so friend/random/virtual share one lock
  --          preventing three simultaneous requests from bypassing the limit
  IF v_is_training THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':' || v_day::text || ':training')
    );
  ELSE
    -- All battle modes share one lock key per user per day
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::text || ':' || v_day::text || ':battle')
    );
  END IF;

  -- ── Determine plan (server only) ────────────────────────────────
  SELECT COALESCE(
    (SELECT plan FROM subscriptions
      WHERE user_id = v_user_id
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY expires_at DESC NULLS FIRST
      LIMIT 1),
    'free'
  ) INTO v_plan;

  -- ── Set limits ──────────────────────────────────────────────────
  IF v_plan = 'premium' THEN
    v_training_limit := 5;
    v_battle_limit   := 10;
  ELSE
    v_training_limit := 1;
    v_battle_limit   := 3;
  END IF;

  -- ── Count today's usage (AFTER advisory lock — no race possible) ─
  IF v_is_training THEN
    SELECT COUNT(*) INTO v_training_used
      FROM game_sessions
     WHERE user_id = v_user_id AND day_utc = v_day AND mode = 'training';

    IF v_training_used >= v_training_limit THEN
      RETURN jsonb_build_object(
        'allowed', false, 'reason', 'training_limit_reached',
        'used', v_training_used, 'limit', v_training_limit, 'plan', v_plan
      );
    END IF;
  END IF;

  IF v_is_battle THEN
    SELECT COUNT(*) INTO v_battles_used
      FROM game_sessions
     WHERE user_id = v_user_id AND day_utc = v_day
       AND mode IN ('friend_battle','random_battle','virtual_battle')
       AND social_bonus = false;

    IF v_battles_used >= v_battle_limit THEN
      -- ── Social bonus check ──────────────────────────────────────
      -- Allowed ONLY if:
      --   1. p_invite_id references a real accepted invite
      --   2. invite.receiver_id = auth.uid()
      --   3. invite.sender_id = p_opponent_id
      --   4. Not already used social bonus today
      IF p_invite_id IS NOT NULL AND p_opponent_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1 FROM battle_invites
           WHERE id          = p_invite_id
             AND receiver_id = v_user_id
             AND sender_id   = p_opponent_id
             AND status      = 'accepted'
        ) THEN
          SELECT COUNT(*) INTO v_social_used
            FROM game_sessions
           WHERE user_id = v_user_id AND day_utc = v_day AND social_bonus = true;

          IF v_social_used < 1 THEN
            v_is_social_bonus := true;
            -- Mark invite as consumed (can't be replayed)
            UPDATE battle_invites SET status = 'expired', accepted_at = NOW()
             WHERE id = p_invite_id;
          ELSE
            RETURN jsonb_build_object(
              'allowed', false, 'reason', 'social_bonus_already_used',
              'used', v_battles_used, 'limit', v_battle_limit, 'plan', v_plan
            );
          END IF;
        ELSE
          RETURN jsonb_build_object(
            'allowed', false, 'reason', 'invalid_invite',
            'used', v_battles_used, 'limit', v_battle_limit, 'plan', v_plan
          );
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'allowed', false, 'reason', 'battle_limit_reached',
          'used', v_battles_used, 'limit', v_battle_limit, 'plan', v_plan
        );
      END IF;
    END IF;
  END IF;

  -- ── Create session ───────────────────────────────────────────────
  INSERT INTO game_sessions(user_id, mode, day_utc, opponent_id, invite_id, social_bonus)
  VALUES (v_user_id, p_mode, v_day, p_opponent_id, p_invite_id, v_is_social_bonus)
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'allowed',      true,
    'session_id',   v_session_id,
    'social_bonus', v_is_social_bonus,
    'plan',         v_plan,
    'remaining',    CASE
                      WHEN v_is_training THEN v_training_limit - v_training_used - 1
                      WHEN v_is_battle   THEN v_battle_limit   - v_battles_used  - (CASE WHEN v_is_social_bonus THEN 0 ELSE 1 END)
                      ELSE NULL
                    END
  );
END;
$$;

-- ── Permissions ───────────────────────────────────────────────────
REVOKE ALL ON FUNCTION start_game_session(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION start_game_session(TEXT, UUID, UUID) FROM anon;
GRANT  EXECUTE ON FUNCTION start_game_session(TEXT, UUID, UUID) TO authenticated;

-- ════════════════════════════════════════════════════════════════
-- Usage from client (via training.js / friend-battle.js):
--
--   const { data, error } = await sb.rpc('start_game_session', {
--     p_mode: 'training'
--   });
--   if (error || !data.allowed) {
--     track('training_limit_reached', { plan: data.plan, used: data.used, limit: data.limit });
--     showPaywall(data.reason);
--     return;
--   }
--   // proceed with data.session_id
-- ════════════════════════════════════════════════════════════════
