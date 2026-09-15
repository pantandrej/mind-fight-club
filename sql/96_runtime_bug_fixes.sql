-- M96: Runtime bug fixes — player_stats + start_game_session virtual battle quota
-- APPLIED = NO — DO NOT APPLY without owner confirmation
-- Branch: dev
-- Related bugs:
--   Issue 1: player_stats.duels_won = 0 for real duels (won never written to game_sessions)
--            player_stats.accuracy_pct = 0 (real duels have NULL correct_answers/questions_count)
--   Issue 5: virtual_battle counts in social battle quota → real friend battles blocked after 3 bot games

BEGIN;

-- ── 1. player_stats VIEW: fix duels_won + accuracy_pct ──────────────────────
-- Changes:
--   duels_won: count from duel_rooms WHERE winner_id = user_id (authoritative for real duels)
--              PLUS game_sessions.won = true for virtual battles (bot duels)
--   accuracy_pct: only include sessions with questions_count IS NOT NULL (training + virtual_battle)
--                 Real friend/random duels intentionally have NULL — exclude them to avoid 0% distortion

CREATE OR REPLACE VIEW public.player_stats AS
SELECT
  p.id                                                              AS user_id,
  p.display_name,
  p.city,
  p.neurons,
  p.xp,
  COALESCE(p.daily_streak, 0)                                       AS streak,
  COALESCE(p.best_daily_streak, 0)                                  AS best_streak,
  COUNT(DISTINCT gs.id)                                             AS games_played,
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')
  )                                                                 AS duels_played,
  (SELECT COUNT(*) FROM pack_results pr WHERE pr.user_id = p.id)   AS packs_played,
  COALESCE(SUM(gs.correct_answers) FILTER (
    WHERE gs.questions_count IS NOT NULL
  ), 0)                                                             AS correct_total,
  COALESCE(SUM(gs.questions_count) FILTER (
    WHERE gs.questions_count IS NOT NULL
  ), 0)                                                             AS questions_total,
  CASE
    WHEN COALESCE(SUM(gs.questions_count) FILTER (WHERE gs.questions_count IS NOT NULL), 0) = 0 THEN 0
    ELSE ROUND(
      SUM(gs.correct_answers) FILTER (WHERE gs.questions_count IS NOT NULL)::numeric
      / SUM(gs.questions_count) FILTER (WHERE gs.questions_count IS NOT NULL) * 100
    )
  END                                                               AS accuracy_pct,
  (
    -- Real duels: winner tracked in duel_rooms
    (SELECT COUNT(*) FROM duel_rooms dr WHERE dr.winner_id = p.id)
    -- Virtual (bot) duels: winner tracked in game_sessions.won
    + COUNT(DISTINCT gs.id) FILTER (
        WHERE gs.mode = 'virtual_battle' AND gs.won = true
      )
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp,
         p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;


-- ── 2. start_game_session: separate virtual_battle quota from social battles ─
-- Before: mode IN ('friend_battle','random_battle','virtual_battle') all share 3/day quota
-- After:  friend_battle + random_battle share 3/day social quota (unchanged)
--         virtual_battle has its own separate 3/day quota (free) / 10/day (premium)
-- This prevents bot games from exhausting the social battle slot.

CREATE OR REPLACE FUNCTION public.start_game_session(
  p_mode        text,
  p_opponent_id uuid DEFAULT NULL,
  p_invite_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user_id          UUID    := auth.uid();
  v_day              DATE    := (NOW() AT TIME ZONE 'UTC')::DATE;
  v_plan             TEXT    := 'free';

  v_is_social_battle BOOLEAN := p_mode IN ('friend_battle','random_battle');
  v_is_virtual       BOOLEAN := p_mode = 'virtual_battle';
  v_is_training      BOOLEAN := p_mode = 'training';

  v_training_limit   INTEGER;
  v_battle_limit     INTEGER;
  v_virtual_limit    INTEGER;

  v_training_used    INTEGER := 0;
  v_battles_used     INTEGER := 0;
  v_virtual_used     INTEGER := 0;
  v_social_used      INTEGER := 0;

  v_is_social_bonus  BOOLEAN := false;
  v_session_id       UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Anonymous users must not create game sessions.
  IF COALESCE((auth.jwt() ->> 'is_anonymous')::boolean, false) THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason',  'anonymous_not_allowed'
    );
  END IF;

  IF p_mode NOT IN ('training','friend_battle','random_battle','virtual_battle') THEN
    RAISE EXCEPTION 'Invalid mode: %', p_mode;
  END IF;

  -- Advisory lock per user+day+bucket to prevent race conditions
  IF v_is_training THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_day::TEXT || ':training')
    );
  ELSIF v_is_virtual THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_day::TEXT || ':virtual')
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_day::TEXT || ':battle')
    );
  END IF;

  SELECT get_user_plan(v_user_id) INTO v_plan;

  IF v_plan = 'premium' THEN
    v_training_limit := 5;
    v_battle_limit   := 10;
    v_virtual_limit  := 10;
  ELSE
    v_training_limit := 1;
    v_battle_limit   := 3;
    v_virtual_limit  := 3;
  END IF;

  -- Training quota check
  IF v_is_training THEN
    SELECT COUNT(*) INTO v_training_used
    FROM game_sessions
    WHERE user_id = v_user_id
      AND day_utc = v_day
      AND mode = 'training';

    IF v_training_used >= v_training_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason',  'training_limit_reached',
        'used',    v_training_used,
        'limit',   v_training_limit,
        'plan',    v_plan
      );
    END IF;
  END IF;

  -- Virtual battle quota check (separate from social battles)
  IF v_is_virtual THEN
    SELECT COUNT(*) INTO v_virtual_used
    FROM game_sessions
    WHERE user_id    = v_user_id
      AND day_utc    = v_day
      AND mode       = 'virtual_battle'
      AND social_bonus = false;

    IF v_virtual_used >= v_virtual_limit THEN
      RETURN jsonb_build_object(
        'allowed', false,
        'reason',  'battle_limit_reached',
        'used',    v_virtual_used,
        'limit',   v_virtual_limit,
        'plan',    v_plan
      );
    END IF;
  END IF;

  -- Social battle quota check (friend_battle + random_battle only)
  IF v_is_social_battle THEN
    SELECT COUNT(*) INTO v_battles_used
    FROM game_sessions
    WHERE user_id    = v_user_id
      AND day_utc    = v_day
      AND mode IN ('friend_battle','random_battle')
      AND social_bonus = false;

    IF v_battles_used >= v_battle_limit THEN

      IF p_invite_id IS NOT NULL AND p_opponent_id IS NOT NULL THEN
        IF EXISTS (
          SELECT 1
          FROM battle_invites
          WHERE id          = p_invite_id
            AND receiver_id = v_user_id
            AND sender_id   = p_opponent_id
            AND status      = 'accepted'
        ) THEN

          SELECT COUNT(*) INTO v_social_used
          FROM game_sessions
          WHERE user_id    = v_user_id
            AND day_utc    = v_day
            AND social_bonus = true;

          IF v_social_used < 1 THEN
            v_is_social_bonus := true;

            UPDATE battle_invites
            SET status      = 'expired',
                accepted_at = NOW()
            WHERE id = p_invite_id;
          ELSE
            RETURN jsonb_build_object(
              'allowed', false,
              'reason',  'social_bonus_already_used',
              'used',    v_battles_used,
              'limit',   v_battle_limit,
              'plan',    v_plan
            );
          END IF;
        ELSE
          RETURN jsonb_build_object(
            'allowed', false,
            'reason',  'invalid_invite',
            'used',    v_battles_used,
            'limit',   v_battle_limit,
            'plan',    v_plan
          );
        END IF;
      ELSE
        RETURN jsonb_build_object(
          'allowed', false,
          'reason',  'battle_limit_reached',
          'used',    v_battles_used,
          'limit',   v_battle_limit,
          'plan',    v_plan
        );
      END IF;
    END IF;
  END IF;

  INSERT INTO game_sessions(
    user_id,
    mode,
    day_utc,
    opponent_id,
    invite_id,
    social_bonus
  )
  VALUES (
    v_user_id,
    p_mode,
    v_day,
    p_opponent_id,
    p_invite_id,
    v_is_social_bonus
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object(
    'allowed',      true,
    'session_id',   v_session_id,
    'social_bonus', v_is_social_bonus,
    'plan',         v_plan,
    'remaining',
      CASE
        WHEN v_is_training THEN
          v_training_limit - v_training_used - 1
        WHEN v_is_virtual THEN
          v_virtual_limit - v_virtual_used - 1
        WHEN v_is_social_battle THEN
          v_battle_limit - v_battles_used - CASE WHEN v_is_social_bonus THEN 0 ELSE 1 END
        ELSE NULL
      END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_game_session(text, uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_game_session(text, uuid, uuid) TO authenticated;


COMMIT;
