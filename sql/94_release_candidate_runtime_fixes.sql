-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 94: Release Candidate Runtime Fixes (Security Rev 2)
-- Applied: NO
-- ══════════════════════════════════════════════════════════════════════════════
-- Changes:
--   1. club_recruitment_board.club_id → nullable (solo player listing fix)
--   2. complete_virtual_battle_session(p_session_id uuid) — server-authoritative
--      Uses completed_at as idempotency sentinel; SELECT FOR UPDATE to prevent race.
--      Derives correct_answers/questions_count from session_questions only.
--      score/won left NULL (not server-provable).
--   3. get_my_today_neurons() — local-day window from profiles.timezone.
--      Both boundaries derived as local calendar midnights (DST-safe).
--   4. get_my_daily_state() — canonical streak state from profiles.
--   5. player_stats VIEW — duels_won = friend_battle + random_battle only.
-- ══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. club_recruitment_board: make club_id nullable ─────────────────────────
ALTER TABLE club_recruitment_board ALTER COLUMN club_id DROP NOT NULL;


-- ── 2. complete_virtual_battle_session ───────────────────────────────────────
-- Drop the old 5-param client-result overload (existed before Security Rev).
DROP FUNCTION IF EXISTS public.complete_virtual_battle_session(uuid, int, int, int, boolean);

-- Server-authoritative completion for virtual (bot) duels.
-- Idempotency sentinel: completed_at (not questions_count).
-- Race safety: SELECT ... FOR UPDATE on the owned game_sessions row.
-- Derives correct_answers/questions_count from session_questions.is_correct
-- (server-derived by submit_virtual_battle_answer — never client-supplied).
-- score and won are intentionally NOT written (not server-provable).
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
  v_session     game_sessions%ROWTYPE;
  v_total       int;
  v_answered    int;
  v_correct     int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Lock the row to prevent concurrent completion races
  SELECT * INTO v_session
  FROM game_sessions
  WHERE id = p_session_id AND user_id = v_uid AND mode = 'virtual_battle'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_not_found');
  END IF;

  -- completed_at is the canonical idempotency sentinel
  IF v_session.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',              true,
      'already_set',     true,
      'correct_answers', v_session.correct_answers,
      'questions_count', v_session.questions_count
    );
  END IF;

  -- Derive canonical counts from session_questions (server-side records)
  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE is_correct IS NOT NULL),
         COUNT(*) FILTER (WHERE is_correct = true)
  INTO v_total, v_answered, v_correct
  FROM session_questions
  WHERE session_id = p_session_id;

  -- Virtual battle contract: exactly 5 questions
  IF v_total <> 5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'wrong_question_count',
      'got', v_total, 'expected', 5
    );
  END IF;

  -- All questions must be resolved before completion
  IF v_answered <> 5 THEN
    RETURN jsonb_build_object(
      'ok', false, 'reason', 'incomplete_session',
      'answered', v_answered, 'total', 5
    );
  END IF;

  -- Write server-provable fields only.
  -- score: not written — speed points not tracked per-question server-side.
  -- won:   not written — virtual opponent result not persisted server-side.
  UPDATE game_sessions
  SET correct_answers = v_correct,
      questions_count = v_total,
      completed_at    = now()
  WHERE id = p_session_id AND user_id = v_uid AND mode = 'virtual_battle';

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
-- Local-day boundaries derived as calendar midnights in profiles.timezone.
-- Both v_day_start and v_day_end are computed from the local date,
-- not by adding an interval — DST-safe (clocks can spring/fall on transition).
-- Sums currency_ledger.awarded_neurons > 0 in [day_start, day_end).
-- Authenticated only.
CREATE OR REPLACE FUNCTION public.get_my_today_neurons()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_tz          text;
  v_local_today date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
  v_earned      bigint;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT COALESCE(NULLIF(TRIM(timezone), ''), 'UTC')
  INTO v_tz FROM profiles WHERE id = v_uid;
  v_tz := COALESCE(v_tz, 'UTC');

  -- Derive both boundaries from the local calendar date (DST-safe).
  -- v_day_start + interval '1 day' would be wrong around DST transitions.
  BEGIN
    v_local_today := (now() AT TIME ZONE v_tz)::date;
    v_day_start   := v_local_today::timestamp             AT TIME ZONE v_tz;
    v_day_end     := (v_local_today + 1)::timestamp       AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    v_tz          := 'UTC';
    v_local_today := (now() AT TIME ZONE 'UTC')::date;
    v_day_start   := v_local_today::timestamp             AT TIME ZONE 'UTC';
    v_day_end     := (v_local_today + 1)::timestamp       AT TIME ZONE 'UTC';
  END;

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
-- Returns canonical streak state for the home widget.
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
-- No DROP — CREATE OR REPLACE preserves column order and dependent grants.
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
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle')
      AND gs.won = true
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp,
         p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;

COMMIT;
