-- M91: Fix daily local-day consistency
-- ───────────────────────────────────────────────────────────────────────────────
-- M90 fixed start_daily_bf_session() and record_daily_activity() to use the
-- player's stored IANA timezone. M91 fixes the remaining gaps:
--
-- BLOCKER A: complete_daily_bf_session() still recomputes v_today from the UTC
--   clock. If a session was started just before local midnight (player's day D)
--   and completed just after (UTC now → day D+1), activity_date and week_start
--   would be wrong, mismatching the session's day_utc. Fix: read day_utc from
--   the session row and use it directly.
--
-- NEW RPC: set_my_timezone(p_timezone text) — validated write, replaces the
--   fire-and-forget direct profiles.update in auth.js (BLOCKER C).
--
-- record_daily_activity() enhancement: also maintain best_daily_streak server-
--   side so the client can read it from the RPC response (no direct write needed).
-- ───────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── 1. set_my_timezone(p_timezone text) ──────────────────────────────────────
-- Validates p_timezone against pg_timezone_names before writing.
-- Client should await this before calling start_daily_bf_session.
CREATE OR REPLACE FUNCTION public.set_my_timezone(p_timezone text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Validate against pg's own timezone catalog
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = p_timezone) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_timezone', 'value', p_timezone);
  END IF;

  -- Skip write if already stored (avoid unnecessary row churn)
  UPDATE profiles
  SET    timezone   = p_timezone,
         updated_at = now()
  WHERE  id         = v_uid
    AND  COALESCE(timezone, '') <> p_timezone;

  RETURN jsonb_build_object('ok', true, 'timezone', p_timezone);
END;
$$;

REVOKE ALL ON FUNCTION public.set_my_timezone(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.set_my_timezone(text) TO authenticated;

-- ── 2. complete_daily_bf_session() — use session.day_utc, not clock ──────────
-- Blocker A: v_today was (now() AT TIME ZONE 'UTC')::date — wrong when the
-- session started in player-local day D but completes in UTC day D+1.
-- Fix: v_today := v_session.day_utc (player's local calendar day at session start).
CREATE OR REPLACE FUNCTION public.complete_daily_bf_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_today         date;
  v_week_start    date;
  v_session       game_sessions%ROWTYPE;
  v_assigned_cnt  int;
  v_resolved_cnt  int;
  v_correct_cnt   int;
  v_bf_pts        int;
  v_team_id       uuid;
  v_source_id     uuid;
  v_rows          int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Verify session ownership and mode
  SELECT * INTO v_session
  FROM game_sessions
  WHERE id = p_session_id AND user_id = v_uid AND mode = 'training';
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_session');
  END IF;

  -- M91 BLOCKER A FIX: use the player's local calendar day stored at session start,
  -- not the current UTC clock (which may have rolled to the next calendar day).
  v_today      := v_session.day_utc;
  v_week_start := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);

  -- P4: verify BF eligibility persisted on session row
  IF NOT COALESCE(v_session.bf_eligible, false) THEN
    RETURN jsonb_build_object(
      'ok',          true,
      'bf_pts',      0,
      'bf_eligible', false,
      'reason',      'session_not_bf_eligible'
    );
  END IF;

  -- P3: require exactly 10 assigned AND 10 resolved questions
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_correct IS NOT NULL)
  INTO v_assigned_cnt, v_resolved_cnt
  FROM session_questions
  WHERE session_id = p_session_id;

  IF v_assigned_cnt <> 10 OR v_resolved_cnt <> 10 THEN
    RETURN jsonb_build_object(
      'ok',             false,
      'reason',         'session_incomplete',
      'assigned_count', v_assigned_cnt,
      'resolved_count', v_resolved_cnt
    );
  END IF;

  -- Count correct answers from per-answer ledger
  SELECT COUNT(*) INTO v_correct_cnt
  FROM session_questions
  WHERE session_id = p_session_id AND is_correct = true;

  v_bf_pts    := LEAST(v_correct_cnt, 10);
  v_source_id := p_session_id;

  -- Team attribution at award time
  SELECT t.id INTO v_team_id
  FROM profiles pr
  LEFT JOIN teams t ON t.id = pr.team_id AND t.disbanded_at IS NULL
  WHERE pr.id = v_uid;

  -- Idempotent BF insert (two guards: source_unique + training_daily_uidx)
  INSERT INTO brain_fight_contributions (
    scoring_user_id, user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    v_uid, v_uid, v_team_id, v_week_start,
    'training', v_source_id, v_today, v_bf_pts, now()
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    RETURN jsonb_build_object(
      'ok',               true,
      'already_completed', true,
      'bf_pts',           0,
      'correct_count',    v_correct_cnt
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',            true,
    'bf_pts',        v_bf_pts,
    'correct_count', v_correct_cnt
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_daily_bf_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_daily_bf_session(uuid) TO authenticated;

-- ── 3. record_daily_activity() — also maintain best_daily_streak ─────────────
-- Enhancement: include best_streak in the response so the client doesn't need
-- to write it directly; removes the last reason for a client-side profiles.update.
CREATE OR REPLACE FUNCTION record_daily_activity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id     uuid := auth.uid();
  v_profile     profiles%ROWTYPE;
  v_tz          text;
  v_today       date;
  v_yesterday   date;
  v_gap         int;
  v_freeze_used boolean := false;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  SELECT * INTO v_profile FROM profiles WHERE id = v_user_id FOR UPDATE;

  v_tz        := COALESCE(v_profile.timezone, 'UTC');
  v_today     := (now() AT TIME ZONE v_tz)::date;
  v_yesterday := v_today - 1;

  -- Already recorded today → idempotent
  IF v_profile.streak_last_date = v_today THEN
    RETURN jsonb_build_object(
      'ok',               true,
      'streak',           v_profile.daily_streak,
      'best_streak',      COALESCE(v_profile.best_daily_streak, v_profile.daily_streak),
      'already_recorded', true,
      'freeze_used',      false
    );
  END IF;

  v_gap := COALESCE(v_today - v_profile.streak_last_date, 999);

  IF v_gap = 1 THEN
    UPDATE profiles
    SET daily_streak      = COALESCE(daily_streak, 0) + 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), COALESCE(daily_streak, 0) + 1),
        streak_last_date  = v_today,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;

  ELSIF v_gap = 2 AND COALESCE(v_profile.streak_freezes, 0) > 0 THEN
    UPDATE profiles
    SET daily_streak      = COALESCE(daily_streak, 0) + 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), COALESCE(daily_streak, 0) + 1),
        streak_last_date  = v_today,
        streak_freezes    = streak_freezes - 1,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
    v_freeze_used := true;

  ELSE
    UPDATE profiles
    SET daily_streak      = 1,
        best_daily_streak = GREATEST(COALESCE(best_daily_streak, 0), 1),
        streak_last_date  = v_today,
        updated_at        = now()
    WHERE id = v_user_id
    RETURNING * INTO v_profile;
  END IF;

  -- Milestone bonuses
  DECLARE
    v_milestone_type text := NULL;
    v_milestone_key  text;
  BEGIN
    IF v_profile.daily_streak = 7   THEN v_milestone_type := 'streak_7_days';   END IF;
    IF v_profile.daily_streak = 30  THEN v_milestone_type := 'streak_30_days';  END IF;
    IF v_profile.daily_streak = 100 THEN v_milestone_type := 'streak_100_days'; END IF;

    IF v_milestone_type IS NOT NULL THEN
      v_milestone_key := v_milestone_type || ':' || v_user_id::text;
      PERFORM award_currency(v_milestone_type, v_milestone_key);
    END IF;
  END;

  RETURN jsonb_build_object(
    'ok',           true,
    'streak',       v_profile.daily_streak,
    'best_streak',  v_profile.best_daily_streak,
    'freezes_left', v_profile.streak_freezes,
    'freeze_used',  v_freeze_used,
    'milestone',    CASE
                      WHEN v_profile.daily_streak IN (7,30,100)
                      THEN v_profile.daily_streak
                      ELSE NULL
                    END
  );
END;
$$;

REVOKE ALL ON FUNCTION record_daily_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_daily_activity() TO authenticated;

COMMIT;
