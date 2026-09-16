-- M96: Runtime bug fixes — battle quota + player_stats + local-day semantics
-- APPLIED = NO — DO NOT APPLY without owner confirmation
-- Branch: dev
--
-- Fixes:
--   Issue 1 (Stats): player_stats accuracy_pct — historical pre-M93 sessions have NULL
--     correct_answers/questions_count because host_session_id/guest_session_id were not
--     stored on duel_rooms before M93. New M93+ real duels ARE populated by get_duel_result().
--     Fix: exclude sessions with NULL questions_count from accuracy denominator so old rows
--     don't drag accuracy to 0. duels_won stays game_sessions.won=true (M93 writes this).
--     Virtual wins are excluded (M94 product decision: only competitive real wins count).
--
--   Issue 5 (False 3/3 battles): TWO live paths enforce the battle quota:
--     (a) start_game_session — called for virtual_battle only (not friend duel)
--     (b) _check_duel_battle_eligibility — called inside start_duel for both players
--     BOTH currently count virtual_battle in the same 3/day social slot.
--     BOTH use UTC day, not player-local day → quota resets at UTC midnight, not local midnight.
--
--   Fix: separate virtual_battle from friend/random quota in both paths.
--         Use profiles.timezone (M91 pattern) for local-day computation.
--         Friend Duel: host and guest each use their OWN timezone (independent).

BEGIN;

-- ── Helper: resolve a user's local calendar date (M91 defensive pattern) ───
-- Used inline in the two functions below; no new SQL object needed.

-- ── 1. player_stats VIEW: fix accuracy_pct for historical pre-M93 sessions ──
-- duels_won semantics (unchanged from M94):
--   friend_battle + random_battle, gs.won = true only.
--   Virtual battles do NOT count in duels_won (M94 product decision).
-- accuracy_pct:
--   Includes any session where questions_count IS NOT NULL (training + M93+ real duels
--   + completed virtual battles). Pre-M93 NULL rows are excluded so they don't distort.
-- All other columns unchanged.
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
  -- Only sessions with known question count contribute to accuracy.
  -- Pre-M93 real-duel rows (no host_session_id link) have NULL → excluded.
  -- M93+ real duels and virtual battles are populated → included.
  CASE
    WHEN COALESCE(SUM(gs.questions_count) FILTER (WHERE gs.questions_count IS NOT NULL), 0) = 0
    THEN 0
    ELSE ROUND(
      SUM(gs.correct_answers) FILTER (WHERE gs.questions_count IS NOT NULL)::numeric
      / SUM(gs.questions_count) FILTER (WHERE gs.questions_count IS NOT NULL) * 100
    )
  END                                                               AS accuracy_pct,
  -- M94 product decision: duels_won = real competitive wins only.
  -- M93+ get_duel_result() writes game_sessions.won for both players.
  -- Virtual wins intentionally excluded.
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle')
      AND gs.won = true
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp,
         p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;


-- ── 2. _check_duel_battle_eligibility: separate virtual quota + local day ───
-- Called inside start_duel() for BOTH host and guest independently.
-- Each user's local day is computed from their own profiles.timezone (M91 pattern).
-- Social quota counts only friend_battle + random_battle.
-- Virtual battles are counted separately (own v_virtual_used variable) but this
-- function is only called for friend_battle context — virtual count is informational.
-- Social bonus behavior preserved exactly as before.
CREATE OR REPLACE FUNCTION _check_duel_battle_eligibility(
  p_user_id     uuid,
  p_opponent_id uuid DEFAULT NULL,
  p_invite_id   uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz           TEXT;
  v_today        DATE;
  v_plan         TEXT;
  v_battle_limit INTEGER;
  v_battles_used INTEGER;
  v_social_used  INTEGER;
BEGIN
  -- Resolve user's local calendar date (M91 defensive pattern)
  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM profiles WHERE id = p_user_id;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  SELECT get_user_plan(p_user_id) INTO v_plan;

  v_battle_limit := CASE WHEN v_plan = 'premium' THEN 10 ELSE 3 END;

  -- Social quota: friend_battle + random_battle only (virtual_battle excluded)
  SELECT COUNT(*) INTO v_battles_used
  FROM game_sessions
  WHERE user_id    = p_user_id
    AND day_utc    = v_today
    AND mode IN ('friend_battle', 'random_battle')
    AND social_bonus = false;

  IF v_battles_used < v_battle_limit THEN
    RETURN jsonb_build_object(
      'allowed',      true,
      'plan',         v_plan,
      'used',         v_battles_used,
      'limit',        v_battle_limit,
      'social_bonus', false
    );
  END IF;

  -- Over base limit: check social bonus (same logic as before)
  IF p_invite_id IS NOT NULL AND p_opponent_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM battle_invites
      WHERE id          = p_invite_id
        AND receiver_id = p_user_id
        AND sender_id   = p_opponent_id
        AND status      = 'accepted'
    ) THEN
      SELECT COUNT(*) INTO v_social_used
      FROM game_sessions
      WHERE user_id    = p_user_id
        AND day_utc    = v_today
        AND social_bonus = true;
      IF v_social_used < 1 THEN
        RETURN jsonb_build_object(
          'allowed',      true,
          'plan',         v_plan,
          'used',         v_battles_used,
          'limit',        v_battle_limit,
          'social_bonus', true
        );
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'allowed',      false,
    'plan',         v_plan,
    'used',         v_battles_used,
    'limit',        v_battle_limit,
    'social_bonus', false
  );
END;
$$;
-- Internal only — not callable by users or anon
REVOKE ALL ON FUNCTION _check_duel_battle_eligibility(uuid, uuid, uuid) FROM PUBLIC, anon;


-- ── 3. start_game_session: separate virtual quota + local day ────────────────
-- start_game_session is called for training and virtual_battle (NOT friend_battle;
-- friend duels go through start_duel → _check_duel_battle_eligibility).
-- Social quota: friend_battle + random_battle only.
-- Virtual quota: separate 3/day (free) / 10/day (premium).
-- Local day: player's profiles.timezone (M91 pattern).
-- Social bonus behavior preserved (virtual_battle path never triggers social bonus).
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
  v_tz               TEXT    := 'UTC';
  v_today            DATE;
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

  -- Resolve player's local calendar date (M91 defensive pattern)
  SELECT COALESCE(timezone, 'UTC') INTO v_tz
  FROM profiles WHERE id = v_user_id;

  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = v_tz) THEN
    v_tz := 'UTC';
  END IF;

  v_today := (now() AT TIME ZONE v_tz)::date;

  -- Advisory lock per user+day+bucket
  IF v_is_training THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_today::TEXT || ':training')
    );
  ELSIF v_is_virtual THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_today::TEXT || ':virtual')
    );
  ELSE
    PERFORM pg_advisory_xact_lock(
      hashtext(v_user_id::TEXT || ':' || v_today::TEXT || ':battle')
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
      AND day_utc = v_today
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
      AND day_utc    = v_today
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
      AND day_utc    = v_today
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
            AND day_utc    = v_today
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
    v_today,
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


-- ── 4. start_duel: use player-local day for advisory locks + session day_utc ─
-- M93 start_duel uses v_day := (NOW() AT TIME ZONE 'UTC')::DATE for both players.
-- Fix: each player's game_session uses their own local day.
-- Advisory lock key also switches to local day to stay consistent with
-- _check_duel_battle_eligibility (same key space).
-- NOTE: if host and guest are in different timezones and it's near midnight,
-- their game_sessions may record different day_utc values. This is correct:
-- each player's quota day must match their own local calendar.
CREATE OR REPLACE FUNCTION public.start_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid              uuid := auth.uid();
  _room             duel_rooms%ROWTYPE;
  _host_tz          TEXT;
  _guest_tz         TEXT;
  _host_day         DATE;
  _guest_day        DATE;
  _host_elig        jsonb;
  _guest_elig       jsonb;
  _progression      int[]   := ARRAY[2, 3, 4, 5, 6];
  _opt_count        int;
  _used_ids         uuid[]  := ARRAY[]::uuid[];
  _staged_ids       uuid[]  := ARRAY[]::uuid[];
  _staged_corrects  int[]   := ARRAY[]::int[];
  _staged_times     int[]   := ARRAY[]::int[];
  _staged_json      jsonb   := '[]'::jsonb;
  _q_id             uuid;
  _q_text           text;
  _q_answers        jsonb;
  _q_category       text;
  _q_correct        int;
  _q_time           int;
  _idx              int := 0;
  _expires_min      int := 15;
  _lock_first       uuid;
  _lock_second      uuid;
  _host_sid         uuid;
  _guest_sid        uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_host');
  END IF;

  IF _room.status != 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready', 'status', _room.status);
  END IF;

  IF _room.guest_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_guest');
  END IF;

  -- Resolve each player's local calendar date independently (M91 pattern)
  SELECT COALESCE(timezone, 'UTC') INTO _host_tz
  FROM profiles WHERE id = _room.host_user_id;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _host_tz) THEN
    _host_tz := 'UTC';
  END IF;
  _host_day := (now() AT TIME ZONE _host_tz)::date;

  SELECT COALESCE(timezone, 'UTC') INTO _guest_tz
  FROM profiles WHERE id = _room.guest_user_id;
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _guest_tz) THEN
    _guest_tz := 'UTC';
  END IF;
  _guest_day := (now() AT TIME ZONE _guest_tz)::date;

  -- Advisory locks — use deterministic ordering to prevent deadlock
  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first  := _room.host_user_id;
    _lock_second := _room.guest_user_id;
  ELSE
    _lock_first  := _room.guest_user_id;
    _lock_second := _room.host_user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || _host_day::TEXT  || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || _guest_day::TEXT || ':battle'));

  -- Eligibility uses updated _check_duel_battle_eligibility (local day + no virtual)
  _host_elig := _check_duel_battle_eligibility(_room.host_user_id, _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');
  END IF;

  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id, NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached');
  END IF;

  -- Question selection (identical to M93/M87)
  FOREACH _opt_count IN ARRAY _progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_json, q.answers_ru),
      COALESCE(q.category, 'GENERAL'),
      q.correct_index
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct
    FROM questions q
    WHERE q.status = 'active'
      AND q.question_type = 'multiple_choice'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND q.is_competitive_secret = false
      AND q.source_type = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = _opt_count
      AND NOT (q.id = ANY(_used_ids))
      AND q.id NOT IN (
        SELECT waq.question_id
        FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random()
    LIMIT 1;

    IF NOT FOUND OR _q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'not_enough_questions',
        'needed_opt_count', _opt_count
      );
    END IF;

    _q_time := CASE _opt_count
      WHEN 2 THEN 30 WHEN 3 THEN 35 WHEN 4 THEN 40
      WHEN 5 THEN 45 WHEN 6 THEN 50 ELSE 30
    END;

    _staged_ids      := _staged_ids     || ARRAY[_q_id];
    _staged_corrects := _staged_corrects || ARRAY[_q_correct];
    _staged_times    := _staged_times   || ARRAY[_q_time];
    _staged_json     := _staged_json || jsonb_build_array(jsonb_build_object(
      'idx', _idx, 'cat', _q_category, 'q', _q_text, 'a', _q_answers, 't', _q_time
    ));
    _used_ids := _used_ids || ARRAY[_q_id];
    _idx := _idx + 1;
  END LOOP;

  DELETE FROM duel_question_assignments WHERE duel_code = p_code;

  FOR _idx IN 1..array_length(_staged_ids, 1)
  LOOP
    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx - 1, _staged_ids[_idx], _staged_corrects[_idx], _staged_times[_idx]);
  END LOOP;

  -- Each player's game_session records their own local day
  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.host_user_id, 'friend_battle', _host_day, _room.guest_user_id, (_host_elig->>'social_bonus')::boolean)
  RETURNING id INTO _host_sid;

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.guest_user_id, 'friend_battle', _guest_day, _room.host_user_id, (_guest_elig->>'social_bonus')::boolean)
  RETURNING id INTO _guest_sid;

  UPDATE duel_rooms SET
    status            = 'started',
    started_at        = now(),
    expires_at        = now() + (_expires_min || ' minutes')::interval,
    host_score        = 0,
    guest_score       = 0,
    host_answers      = '[]'::jsonb,
    guest_answers     = '[]'::jsonb,
    host_done         = false,
    guest_done        = false,
    winner_id         = NULL,
    finished_at       = NULL,
    host_session_id   = _host_sid,
    guest_session_id  = _guest_sid
  WHERE code = p_code;

  RETURN jsonb_build_object(
    'ok',        true,
    'questions', _staged_json,
    'expires_at', (now() + (_expires_min || ' minutes')::interval)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_duel(text) TO authenticated;


COMMIT;
