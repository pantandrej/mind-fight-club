-- ══════════════════════════════════════════════════════════════════════════════
-- Migration 94: Release Candidate Runtime Fixes
-- Applied: NO
-- ══════════════════════════════════════════════════════════════════════════════
-- Changes:
--   1. club_recruitment_board.club_id → nullable
--      Fixes listing submit for players not in a team (NOT NULL caused silent fail).
--   2. complete_virtual_battle_session(uuid,int,int,int,bool) — SECURITY DEFINER
--      Writes score/correct_answers/questions_count/won to game_sessions for bot duels.
--      M70 locked game_sessions to SELECT-only for client; this RPC bypasses RLS.
--   3. player_stats VIEW — exclude virtual_battle from duels_won
--      Competitive "Дуэли выиграны" counts only friend_battle + random_battle wins.
--      virtual_battle wins remain in duels_played but are NOT in duels_won.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. club_recruitment_board: make club_id nullable ─────────────────────────
-- Original schema (M28): club_id NOT NULL REFERENCES teams_v2(id).
-- Players without a team cannot insert (club_id=null fails NOT NULL).
-- Fix: allow null club_id so any authenticated user can post a listing.
ALTER TABLE club_recruitment_board ALTER COLUMN club_id DROP NOT NULL;


-- ── 2. complete_virtual_battle_session ───────────────────────────────────────
-- Called by the client at the end of a virtual (bot) duel.
-- Writes canonical result to game_sessions row owned by the caller.
-- Idempotent: repeated calls with same session_id overwrite safely.
-- Security: validates user_id = auth.uid() AND mode = 'virtual_battle'.
CREATE OR REPLACE FUNCTION public.complete_virtual_battle_session(
  p_session_id   uuid,
  p_score        int,
  p_correct      int,
  p_questions    int,
  p_won          boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_rows int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Clamp inputs to sane ranges
  p_score     := GREATEST(0, COALESCE(p_score, 0));
  p_correct   := GREATEST(0, LEAST(COALESCE(p_correct, 0), COALESCE(p_questions, 5)));
  p_questions := GREATEST(1, COALESCE(p_questions, 5));

  UPDATE game_sessions SET
    score           = p_score,
    correct_answers = p_correct,
    questions_count = p_questions,
    won             = p_won
  WHERE id      = p_session_id
    AND user_id = v_uid
    AND mode    = 'virtual_battle';

  GET DIAGNOSTICS v_rows = ROW_COUNT;

  IF v_rows = 0 THEN
    -- Row may already have these values (idempotent), or genuinely not found.
    -- Return ok=true if row exists for this user (idempotent call).
    IF EXISTS (
      SELECT 1 FROM game_sessions
      WHERE id = p_session_id AND user_id = v_uid AND mode = 'virtual_battle'
    ) THEN
      RETURN jsonb_build_object('ok', true, 'already_set', true);
    END IF;
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_virtual_battle_session(uuid, int, int, int, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_virtual_battle_session(uuid, int, int, int, boolean)
  TO authenticated;


-- ── 3. player_stats — exclude virtual_battle from duels_won ─────────────────
-- M93 added duels_won counting friend+random+virtual wins.
-- Product decision: virtual wins are non-competitive and must not inflate
-- the canonical "Дуэли выиграны" stat.
-- duels_played still includes virtual_battle (total duel games played).
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
  -- M94: competitive wins only (friend_battle + random_battle); virtual excluded
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle')
      AND gs.won = true
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;
