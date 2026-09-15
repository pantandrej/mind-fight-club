-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 94: Release Candidate Runtime Fixes (Security Rev)
-- Applied: NO
-- ══════════════════════════════════════════════════════════════════════════════
-- Changes:
--   1. club_recruitment_board.club_id → nullable
--      Fixes listing submit for players not in a team.
--      RLS (crb_creator_write: auth.uid() = creator_id) still enforces ownership.
--
--   2. complete_virtual_battle_session(p_session_id uuid)
--      Server-authoritative — NO client result params accepted.
--      Derives correct_answers / questions_count from session_questions.
--      score/won are left NULL: speed score is not tracked server-side
--      (no points column in session_questions) and opponent result is not
--      persisted server-side. Security > cosmetic history.
--      Requires exactly 5 answered questions (virtual battle contract).
--
--   3. get_my_today_neurons()
--      Returns earned neurons for the caller's canonical local calendar day
--      (using profiles.timezone, fallback UTC). Sums currency_ledger
--      awarded_neurons > 0 within that window. Authenticated only.
--
--   4. get_my_daily_state()
--      Returns canonical streak state from profiles for the home widget.
--      Compares profiles.streak_last_date against player's local today.
--      Authenticated only.
--
--   5. player_stats VIEW — duels_won = friend_battle + random_battle only
--      M93 included virtual_battle in duels_won. Product decision:
--      virtual wins are non-competitive. Still counted in duels_played.
-- ══════════════════════════════════════════════════════════════════════════════


-- ── 1. club_recruitment_board: make club_id nullable ─────────────────────────
-- Original schema (M28): club_id NOT NULL REFERENCES teams_v2(id).
-- Solo players (no team) fail with NOT NULL constraint on INSERT.
-- Fix: allow null club_id. Ownership still enforced by crb_creator_write RLS.
ALTER TABLE club_recruitment_board ALTER COLUMN club_id DROP NOT NULL;


-- ── 2. complete_virtual_battle_session(p_session_id uuid) ────────────────────
-- Server-authoritative session completion for virtual (bot) duels.
-- NO client-supplied score/correct/won. All derived from session_questions.
--
-- Security contract:
--   - SECURITY DEFINER + SET search_path = public
--   - REVOKE from PUBLIC, anon; GRANT to authenticated only
--   - Validates user_id = auth.uid() AND mode = 'virtual_battle'
--   - Validates exactly 5 questions exist for the session
--   - Validates all 5 are answered (is_correct IS NOT NULL)
--
-- Fields written:
--   correct_answers = COUNT(*) FILTER (WHERE is_correct = true)   — provable
--   questions_count = COUNT(*) = 5                                — provable
--   completed_at    = now() (if not already set)                  — provable
--   score           = NOT WRITTEN (no server-side speed tracking)
--   won             = NOT WRITTEN (no server-side opponent result)
--
-- Idempotent: returns {ok:true, already_set:true} if questions_count already set.
DROP FUNCTION IF EXISTS public.complete_virtual_battle_session(uuid, int, int, int, boolean);

CREATE OR REPLACE FUNCTION public.complete_virtual_battle_session(
  p_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_already_set bool;
  v_total       int;
  v_answered    int;
  v_correct     int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Verify session ownership and mode
  IF NOT EXISTS (
    SELECT 1 FROM game_sessions
    WHERE id = p_session_id AND user_id = v_uid AND mode = 'virtual_battle'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  -- Idempotent: already completed
  SELECT (questions_count IS NOT NULL AND questions_count > 0)
  INTO v_already_set
  FROM game_sessions WHERE id = p_session_id;

  IF v_already_set THEN
    RETURN jsonb_build_object('ok', true, 'already_set', true);
  END IF;

  -- Count canonical questions from session_questions
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_correct IS NOT NULL),
         COUNT(*) FILTER (WHERE is_correct = true)
  INTO v_total, v_answered, v_correct
  FROM session_questions
  WHERE session_id = p_session_id;

  -- Require exactly 5 questions (virtual battle contract from start_virtual_battle_session)
  IF v_total <> 5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'wrong_question_count',
      'got', v_total, 'expected', 5
    );
  END IF;

  -- Require all questions answered
  IF v_answered <> 5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'incomplete_session',
      'answered', v_answered, 'total', 5
    );
  END IF;

  -- Write server-provable fields only.
  -- score and won are intentionally NOT written:
  --   score: speed points are not tracked in session_questions (no points column).
  --   won:   virtual opponent result is not persisted server-side.
  UPDATE game_sessions
  SET correct_answers = v_correct,
      questions_count = v_total,
      completed_at    = COALESCE(completed_at, now())
  WHERE id      = p_session_id
    AND user_id = v_uid
    AND mode    = 'virtual_battle';

  RETURN jsonb_build_object(
    'ok',              true,
    'already_set',     false,
    'correct_answers', v_correct,
    'questions_count', v_total
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_virtual_battle_session(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.complete_virtual_battle_session(uuid) TO authenticated;


-- ── 3. get_my_today_neurons() ─────────────────────────────────────────────────
-- Returns earned neurons for the caller's canonical local calendar day.
-- Uses profiles.timezone (M91 validated); falls back to UTC.
-- Sums currency_ledger.awarded_neurons > 0 within [local_day_start, local_day_start + 1day).
-- Does NOT count spends (awarded_neurons <= 0).
-- Authenticated only.
CREATE OR REPLACE FUNCTION public.get_my_today_neurons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_tz        text;
  v_day_start timestamptz;
  v_day_end   timestamptz;
  v_earned    bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'UTC')
  INTO v_tz
  FROM profiles WHERE id = v_uid;

  v_tz := COALESCE(v_tz, 'UTC');

  -- Validate timezone is usable; fall back to UTC on error
  BEGIN
    v_day_start := date_trunc('day', now() AT TIME ZONE v_tz) AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_day_start := date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
    v_tz := 'UTC';
  END;

  v_day_end := v_day_start + interval '1 day';

  SELECT COALESCE(SUM(awarded_neurons), 0) INTO v_earned
  FROM currency_ledger
  WHERE user_id         = v_uid
    AND created_at     >= v_day_start
    AND created_at      < v_day_end
    AND awarded_neurons  > 0;

  RETURN jsonb_build_object('ok', true, 'earned', v_earned::int, 'tz', v_tz);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_today_neurons() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_today_neurons() TO authenticated;


-- ── 4. get_my_daily_state() ───────────────────────────────────────────────────
-- Returns canonical daily streak state for the home widget.
-- Source of truth: profiles.daily_streak, profiles.streak_last_date, profiles.timezone.
-- Returns:
--   ok                bool
--   streak            int    — current daily streak
--   best_streak       int    — best daily streak
--   streak_saved_today bool  — streak_last_date = local today (M91 semantics)
--   local_today       text   — YYYY-MM-DD in player's local timezone
-- Authenticated only.
CREATE OR REPLACE FUNCTION public.get_my_daily_state()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid              uuid := auth.uid();
  v_tz               text;
  v_streak           int;
  v_best_streak      int;
  v_streak_last_date date;
  v_local_today      date;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'UTC'),
         COALESCE(daily_streak, 0),
         COALESCE(best_daily_streak, 0),
         streak_last_date
  INTO v_tz, v_streak, v_best_streak, v_streak_last_date
  FROM profiles WHERE id = v_uid;

  BEGIN
    v_local_today := (now() AT TIME ZONE COALESCE(v_tz, 'UTC'))::date;
  EXCEPTION WHEN OTHERS THEN
    v_local_today := (now() AT TIME ZONE 'UTC')::date;
  END;

  RETURN jsonb_build_object(
    'ok',                true,
    'streak',            v_streak,
    'best_streak',       v_best_streak,
    'streak_saved_today', (v_streak_last_date IS NOT NULL
                            AND v_streak_last_date = v_local_today),
    'local_today',       v_local_today::text
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_daily_state() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_my_daily_state() TO authenticated;


-- ── 5. player_stats VIEW: duels_won = friend_battle + random_battle only ──────
-- M93 counted virtual_battle wins in duels_won.
-- Product decision: virtual wins are non-competitive.
-- virtual_battle is still counted in duels_played (total games).
-- No DROP — CREATE OR REPLACE preserves column order and dependent grants.
-- Column list: user_id, display_name, city, neurons, xp, streak, best_streak,
--   games_played, duels_played, packs_played, correct_total, questions_total,
--   accuracy_pct, duels_won  (same as M93, only duels_won expression changes).
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
  COALESCE(SUM(gs.correct_answers), 0)                             AS correct_total,
  COALESCE(SUM(gs.questions_count), 0)                             AS questions_total,
  CASE
    WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
    ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
  END                                                               AS accuracy_pct,
  -- M94: competitive wins only — virtual_battle excluded
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle')
      AND gs.won = true
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp,
         p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;
