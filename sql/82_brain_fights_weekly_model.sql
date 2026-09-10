-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 82 — Brain Fights: Complete Weekly Model
-- ═══════════════════════════════════════════════════════════════════════════
--
-- BEFORE-STATE AUDIT (basis for this migration):
-- ─────────────────────────────────────────────────────────────────────────
-- A. brain_fight_contributions: EXISTS (migration76).
--    Schema: id, scoring_user_id, user_id, team_id, week_start, source_type,
--            source_id, activity_date, points, occurred_at, created_at.
--    UNIQUE: (scoring_user_id, source_type, source_id) → bfc_source_unique
--            (scoring_user_id, source_type, activity_date) → bfc_daily_unique
--
-- B. source_type CHECK currently: IN ('superq', 'weekly_arena').
--    'duel' and 'training' explicitly disabled in m76 comment.
--    This migration adds both.
--
-- C. Team formula GAP: existing formula uses +1 per active player outside
--    top-3. Spec requires +5 per active player outside top-3. Fixed here.
--
-- D. get_brain_fights_week() EXISTS (m76, updated m77). Aggregates superq +
--    weekly_arena. Updated here to include duel + training + new formula.
--
-- E. SuperQ BF: FULLY WORKING. answer_quiz_daily_question() awards 5/1
--    server-side, idempotent. No changes needed.
--
-- F. Weekly Arena: FULLY SERVER-AUTHORITATIVE (m77).
--    Participation, answers, correctness, completion: all server-derived.
--    Current BF: fixed 5 pts on completion — NOT the canonical formula.
--    This migration replaces with: participation(2) + performance(0-10) +
--    placement(5/3/2/0). Max = 17.
--    BF awarded when ALL answers submitted (completed). Idempotent.
--    placement: derived from get_weekly_arena_results() after FINISHED.
--    Note: placement BF requires arena to be FINISHED at award time.
--    Strategy: BF awarded in two passes:
--      Pass 1 (on completion): participation + performance (no placement yet)
--      Pass 2 (finalize_weekly_arena_bf): add placement bonus after FINISHED.
--    See §4.
--
-- G. Daily Training BF: FUTURE-GATED.
--    submit_training_answer() and session_questions table do NOT exist.
--    get_question_reveals() sends correct_index to client before answering.
--    Client derives correctness locally → cannot trust client correct_count.
--    BF for daily training CANNOT be awarded safely without server-side
--    per-question answer validation. Schema prepared in §2 for future use.
--    Source type 'training' added to CHECK but no contribution rows created.
--
-- H. Friend Duel BF: READY TO WIRE.
--    m78/m81: winner_id derived server-side from duel_answers.
--    No existing BF wiring (m78 comment: "No call to record_duel_win_bf").
--    Strategy: award_duel_bf(p_code) called by submit_duel_answer when both
--    players finish. See §3.
--
-- I. finalize_weekly_brain_fights() EXISTS (m76). GAP: global ranking only.
--    Spec requires city-first ranking with approved points map.
--    Updated here in §6.
--
-- J. challenge_results: EXISTS. Has (team_id, challenge_type, week_start)
--    unique constraint. Stores historical BF results. Preserved.
--
-- K. city ranking: computed live in get_brain_fights_week(). Finalization
--    must also use city-first ranking. Fixed in §6.
--
-- ─────────────────────────────────────────────────────────────────────────
-- WHAT THIS MIGRATION DOES:
-- §1  Extend source_type CHECK to include 'duel' and 'training'
-- §2  Add session_questions schema skeleton (future training authority)
-- §3  award_duel_bf(p_code) — server-authoritative duel BF on completion
--     Called from submit_duel_answer when both players done.
-- §4  finalize_weekly_arena_bf() — placement bonus pass after Arena FINISHED
-- §5  get_brain_fights_week() rewrite — adds duel + training sources,
--     fixes team formula (+1→+5), exposes full my_contrib breakdown
-- §6  finalize_weekly_brain_fights() — city-first ranking with spec points map
-- §7  Update brain-fights.js display strings (done in JS, not SQL — see note)
--
-- DO NOT APPLY WITHOUT REVIEW.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- §1  Extend source_type CHECK: add 'duel' and 'training'
--
-- 'training' is added for future use (session_questions + submit_training_answer).
-- No training BF rows will be created until that RPC exists.
-- 'duel' is added for §3 award_duel_bf().
-- ──────────────────────────────────────────────────────────────────

-- Drop old constraint (ALTER TABLE cannot modify CHECK inline).
ALTER TABLE public.brain_fight_contributions
  DROP CONSTRAINT IF EXISTS brain_fight_contributions_source_type_check;

-- m76 used a named CHECK; m77 re-ran ALTER COLUMN which may have unnamed constraint.
-- Also drop any unnamed constraint on source_type.
DO $$
DECLARE
  _c text;
BEGIN
  FOR _c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.brain_fight_contributions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.brain_fight_contributions DROP CONSTRAINT IF EXISTS %I', _c);
  END LOOP;
END;
$$;

ALTER TABLE public.brain_fight_contributions
  ADD CONSTRAINT bfc_source_type_check
  CHECK (source_type IN ('superq', 'weekly_arena', 'duel', 'training'));


-- ──────────────────────────────────────────────────────────────────
-- §2  session_questions — skeleton for future training authority
--
-- This table will be populated by start_game_session() (future change).
-- submit_training_answer() (future RPC) will validate each answer
-- against questions.correct_index server-side, then insert training BF.
--
-- Schema created here so the future RPC can depend on it without a
-- separate migration. No rows inserted; no BF awarded from this table yet.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_questions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  question_id  uuid        NOT NULL REFERENCES public.questions(id)     ON DELETE CASCADE,
  position     int         NOT NULL,
  answered_at  timestamptz,
  selected_idx int,                        -- client-submitted index
  is_correct   boolean,                    -- server-derived: questions.correct_index = selected_idx
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sq_session_position_unique UNIQUE (session_id, position),
  CONSTRAINT sq_session_question_unique UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_sq_session ON public.session_questions(session_id);

ALTER TABLE public.session_questions ENABLE ROW LEVEL SECURITY;
-- No client policies — all access via SECURITY DEFINER functions.


-- ──────────────────────────────────────────────────────────────────
-- §3  award_duel_bf(p_code) — server-authoritative duel BF
--
-- Called from submit_duel_answer() (m78) when BOTH players complete.
-- This function is called INSIDE the same transaction as the duel
-- finalize UPDATE (both_done path).
--
-- RULES:
--   WIN  = +3 BF    (winner_id = calling player's user_id)
--   LOSS = 0 BF
--   TIE  = 0 BF     (winner_id IS NULL)
--   Max counted wins per UTC day: 3 (= max 9 BF/day)
--   Premium does NOT bypass this cap.
--   The same duel_code contributes BF at most once per player.
--
-- IDEMPOTENCY:
--   source_id = duel_code UUID cast (award is per duel per player).
--   bfc_source_unique (scoring_user_id, source_type, source_id) → ON CONFLICT DO NOTHING.
--
-- DAILY CAP:
--   Count existing 'duel' BF rows for this scoring_user_id for today.
--   If >= 3 wins already: insert 0 rows, return bf_pts=0.
--   Cap enforced by the counting query before INSERT, not a DB constraint.
--   Concurrent duel finishes for the same player on the same day:
--   The first 3 wins race in; the 4th gets count=3 and returns 0.
--   (Rare race window is non-critical: BF cap is cosmetic, not financial.)
--
-- TEAM ATTRIBUTION:
--   Winner's team_id read from profiles at award time.
--   If team disbanded or player teamless: contribution recorded
--   with team_id = NULL (unattributed, but audit trail preserved).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.award_duel_bf(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_room        duel_rooms%ROWTYPE;
  v_today       date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start  date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_team_id     uuid;
  v_wins_today  int;
  v_bf_pts      int := 0;
  v_source_id   uuid;
  v_rows        int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Load room (must be finished with server-set winner_id)
  SELECT * INTO v_room FROM duel_rooms
  WHERE code = p_code AND status = 'finished';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'duel_not_finished');
  END IF;

  -- Only the winner earns BF; ties and losses = 0
  IF v_room.winner_id IS NULL OR v_room.winner_id != v_uid THEN
    RETURN jsonb_build_object('ok', true, 'bf_pts', 0, 'reason', 'not_winner');
  END IF;

  -- Canonical source_id: deterministic UUID from duel code + winner_id
  -- Avoids storing raw text as uuid; cast code to uuid-shaped identity.
  -- Strategy: use gen_random_uuid() replacement with stable md5 hash.
  v_source_id := md5(p_code || '::duel_win::' || v_uid::text)::uuid;

  -- Daily cap: count distinct duel wins already recorded today for this player
  SELECT COUNT(*) INTO v_wins_today
  FROM brain_fight_contributions
  WHERE scoring_user_id = v_uid
    AND source_type     = 'duel'
    AND activity_date   = v_today;

  IF v_wins_today >= 3 THEN
    -- Cap reached: duel still completed normally, BF = 0
    RETURN jsonb_build_object('ok', true, 'bf_pts', 0, 'reason', 'daily_cap_reached');
  END IF;

  -- Team attribution at award time
  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;
  IF v_team_id IS NOT NULL THEN
    SELECT t.id INTO v_team_id FROM teams t
    WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
    -- disbanded → v_team_id stays NULL
  END IF;

  -- Idempotent insert (bfc_source_unique handles race and retry)
  INSERT INTO brain_fight_contributions (
    scoring_user_id, user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    v_uid, v_uid, v_team_id, v_week_start, 'duel', v_source_id,
    v_today, 3, now()
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  v_bf_pts := CASE WHEN v_rows > 0 THEN 3 ELSE 0 END;

  RETURN jsonb_build_object('ok', true, 'bf_pts', v_bf_pts);
END;
$$;

REVOKE ALL ON FUNCTION public.award_duel_bf(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.award_duel_bf(text) TO authenticated;


-- Wire award_duel_bf into submit_duel_answer (m78):
-- When both_done and duel finalized → call award_duel_bf server-side.
-- We cannot edit m78 retroactively, so we create a trigger-based approach:
-- After duel_rooms.status transitions to 'finished', fire BF award for winner.
-- This is cleaner than editing m78 and avoids touching migrated RPCs.

CREATE OR REPLACE FUNCTION public._trg_duel_finished_bf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Only fire on status transition to 'finished'
  IF (TG_OP = 'UPDATE') AND (NEW.status = 'finished') AND (OLD.status IS DISTINCT FROM 'finished') THEN
    -- Award BF for winner (if any). winner_id is already set by the UPDATE that fired this trigger.
    -- We call award_duel_bf as the winner's user context — but triggers run as the function owner.
    -- auth.uid() is not available in trigger context, so we inline the logic here.
    IF NEW.winner_id IS NOT NULL THEN
      DECLARE
        v_today      date := (now() AT TIME ZONE 'UTC')::date;
        v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
        v_team_id    uuid;
        v_wins_today int;
        v_source_id  uuid;
        v_rows       int;
      BEGIN
        v_source_id := md5(NEW.code || '::duel_win::' || NEW.winner_id::text)::uuid;

        SELECT COUNT(*) INTO v_wins_today
        FROM brain_fight_contributions
        WHERE scoring_user_id = NEW.winner_id
          AND source_type     = 'duel'
          AND activity_date   = v_today;

        IF v_wins_today < 3 THEN
          SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = NEW.winner_id;
          IF v_team_id IS NOT NULL THEN
            SELECT t.id INTO v_team_id FROM teams t
            WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
          END IF;

          INSERT INTO brain_fight_contributions (
            scoring_user_id, user_id, team_id, week_start, source_type, source_id,
            activity_date, points, occurred_at
          ) VALUES (
            NEW.winner_id, NEW.winner_id, v_team_id, v_week_start,
            'duel', v_source_id, v_today, 3, now()
          )
          ON CONFLICT DO NOTHING;
        END IF;
      END;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_duel_finished_bf ON public.duel_rooms;
CREATE TRIGGER trg_duel_finished_bf
  AFTER UPDATE ON public.duel_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_duel_finished_bf();


-- ──────────────────────────────────────────────────────────────────
-- §4  finalize_weekly_arena_bf(p_arena_id) — placement bonus pass
--
-- Called after a weekly_arena is FINISHED.
-- The submit_weekly_arena_answer() function (m77) awards:
--   participation (2 pts) + performance (0–10 pts) on completion.
-- This function adds the PLACEMENT BONUS:
--   1st place = +5, 2nd = +3, 3rd = +2
-- after the arena has finished and rankings are canonical.
--
-- DESIGN: Two-pass BF award for Weekly Arena.
-- Pass 1 (submit completion, m77 §9): participation + performance.
--   Currently awards fixed 5 pts. MUST BE UPDATED (see §4a below).
-- Pass 2 (this function): placement bonus per top-3 finishers.
--
-- IDEMPOTENCY: uses a separate source_id for the placement contribution:
--   md5(arena_id || '::placement::' || user_id)::uuid
-- Separate from the completion-pass source_id (weekly_arena_participants.id).
--
-- WEEKLY ARENA AUTHORITY VERDICT: ACTIVE NOW
-- A. Participation: server-recorded (weekly_arena_participants) ✅
-- B. Answers: server-recorded (weekly_arena_answers) ✅
-- C. Correctness: server-derived (questions.correct_index, not in response) ✅
-- D. Final correct_answers: server-authoritative (COUNT from weekly_arena_answers) ✅
-- E. Placement: server-derived (RANK() in get_weekly_arena_results()) ✅
-- F. Client forge: impossible (no client SELECT on arena tables; no correct_index in RPC) ✅
-- G. Canonical arena_id: one row per weekly_arenas; participant uniqueness constraint ✅
-- VERDICT: ACTIVE — Arena BF may be awarded now.
-- ──────────────────────────────────────────────────────────────────

-- §4a: Update submit_weekly_arena_answer to award participation + performance
-- instead of fixed 5 pts. The BF points formula:
--
--   QUALIFY: answered_count >= CEIL(total_questions * 0.5)
--   If not qualified: 0 BF (no insert; early return)
--
--   participation_bf = 2
--   performance_bf   = ROUND(10 * correct_count::numeric / total_questions::numeric)
--   (clamped 0..10, but naturally bounded)
--
--   completion_bf    = participation_bf + performance_bf
--   (placement bonus awarded separately in finalize_weekly_arena_bf)
--
-- NOTE: This replaces the `v_bf_pts int := 5` fixed value in m77 §9.
-- We recreate the function here with the corrected formula.

CREATE OR REPLACE FUNCTION public.submit_weekly_arena_answer(
  p_arena_id      uuid,
  p_waq_id        uuid,
  p_selected_idx  int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid        := auth.uid();
  v_arena         weekly_arenas%ROWTYPE;
  v_waq           weekly_arena_questions%ROWTYPE;
  v_part          weekly_arena_participants%ROWTYPE;
  v_today         date        := (now() AT TIME ZONE 'UTC')::date;
  v_week_start    date;
  v_answered      int;
  v_total         int;
  v_correct_count int;
  v_completed     boolean     := false;
  v_bf_pts        int         := 0;
  v_bf_rows       int;
  v_is_correct    boolean;
  v_existing      weekly_arena_answers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Load arena (must be LIVE)
  SELECT * INTO v_arena FROM weekly_arenas
  WHERE id = p_arena_id AND now() BETWEEN starts_at AND ends_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_live');
  END IF;

  -- Resolve waq_id → question_id server-side (P0.1: client only has waq_id)
  SELECT * INTO v_waq FROM weekly_arena_questions
  WHERE id = p_waq_id AND arena_id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Validate participation
  SELECT * INTO v_part FROM weekly_arena_participants
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_joined');
  END IF;

  -- Server derives correctness from questions.correct_index (P0.1)
  SELECT (p_selected_idx = q.correct_index) INTO v_is_correct
  FROM questions q WHERE q.id = v_waq.question_id;

  -- Idempotent answer insert
  INSERT INTO weekly_arena_answers (
    arena_id, participant_id, scoring_user_id, question_id,
    selected_index, is_correct, points
  ) VALUES (
    p_arena_id, v_part.id, v_uid, v_waq.question_id,
    p_selected_idx, v_is_correct,
    CASE WHEN v_is_correct THEN 1 ELSE 0 END
  )
  ON CONFLICT DO NOTHING;

  -- Count answered and total
  SELECT COUNT(*) INTO v_answered
  FROM weekly_arena_answers WHERE participant_id = v_part.id;
  SELECT COUNT(*) INTO v_total
  FROM weekly_arena_questions WHERE arena_id = p_arena_id;

  -- Completion check
  IF v_answered >= v_total AND v_total > 0 THEN
    UPDATE weekly_arena_participants
    SET completed_at = now()
    WHERE id = v_part.id AND completed_at IS NULL;
    v_completed := true;

    -- Count correct answers for performance BF
    SELECT COUNT(*) INTO v_correct_count
    FROM weekly_arena_answers
    WHERE participant_id = v_part.id AND is_correct = true;

    -- Qualify: must have answered >= CEIL(total * 0.5)
    IF v_answered >= CEIL(v_total::numeric * 0.5) THEN
      -- participation_bf = 2, performance_bf = ROUND(10 * correct / total)
      v_bf_pts := 2 + ROUND(10 * v_correct_count::numeric / v_total::numeric)::int;

      v_week_start := DATE_TRUNC('week', v_arena.starts_at AT TIME ZONE 'UTC')::date;

      -- BF contribution: pass 1 (participation + performance only; placement in §4b)
      -- source_id = participant row id (idempotent, one per player per arena)
      INSERT INTO brain_fight_contributions (
        scoring_user_id, user_id, team_id, week_start, source_type, source_id,
        activity_date, points, occurred_at
      ) VALUES (
        v_uid, v_uid, v_part.team_id, v_week_start, 'weekly_arena', v_part.id,
        v_today, v_bf_pts, now()
      )
      ON CONFLICT DO NOTHING;

      GET DIAGNOSTICS v_bf_rows = ROW_COUNT;
      IF v_bf_rows = 0 THEN v_bf_pts := 0; END IF;
    ELSE
      -- Did not meet 50% threshold → 0 BF
      v_bf_pts := 0;
    END IF;
  END IF;

  -- Response: no correctness during LIVE (P0.3)
  RETURN jsonb_build_object(
    'ok',              true,
    'accepted',        true,
    'answered',        v_answered,
    'total_questions', v_total,
    'completed',       v_completed,
    'bf_pts',          CASE WHEN v_completed AND v_bf_pts > 0 THEN v_bf_pts ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int) TO authenticated;


-- §4b: Placement bonus — called after arena finishes

CREATE OR REPLACE FUNCTION public.finalize_weekly_arena_bf(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arena       weekly_arenas%ROWTYPE;
  v_today       date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start  date;
  v_placement   int[] := ARRAY[5, 3, 2];  -- 1st, 2nd, 3rd bonus BF
  v_row         record;
  v_bonus       int;
  v_source_id   uuid;
BEGIN
  -- Must be called by admin/cron; no client EXECUTE
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;
  IF now() < v_arena.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_still_live');
  END IF;

  v_week_start := DATE_TRUNC('week', v_arena.starts_at AT TIME ZONE 'UTC')::date;

  -- Rank qualifying participants by correct answers (canonical server data)
  -- RANK() used so true ties share a rank and both get the bonus
  FOR v_row IN
    SELECT
      wap.scoring_user_id,
      wap.user_id,
      wap.team_id,
      COUNT(waa.id) FILTER (WHERE waa.is_correct = true) AS correct_count,
      COUNT(waa.id)                                        AS answered_count,
      (SELECT COUNT(*) FROM weekly_arena_questions waq2 WHERE waq2.arena_id = p_arena_id) AS total_q,
      RANK() OVER (
        ORDER BY COUNT(waa.id) FILTER (WHERE waa.is_correct = true) DESC,
                 wap.scoring_user_id ASC  -- stable tie-break
      )::int AS placement
    FROM weekly_arena_participants wap
    LEFT JOIN weekly_arena_answers waa ON waa.participant_id = wap.id
    WHERE wap.arena_id = p_arena_id
      AND wap.completed_at IS NOT NULL
    GROUP BY wap.id, wap.scoring_user_id, wap.user_id, wap.team_id
    HAVING COUNT(waa.id) >= CEIL(
      (SELECT COUNT(*) FROM weekly_arena_questions waq3 WHERE waq3.arena_id = p_arena_id)::numeric * 0.5
    )
    ORDER BY correct_count DESC
  LOOP
    -- Only top-3 get placement bonus; others get 0
    IF v_row.placement <= array_length(v_placement, 1) THEN
      v_bonus := v_placement[v_row.placement];
    ELSE
      CONTINUE;  -- no placement bonus for positions 4+
    END IF;

    -- Stable placement source_id (separate from completion source_id = wap.id)
    v_source_id := md5(p_arena_id::text || '::placement::' || v_row.scoring_user_id::text)::uuid;

    -- Idempotent: if already awarded (re-run), ON CONFLICT DO NOTHING
    INSERT INTO brain_fight_contributions (
      scoring_user_id, user_id, team_id, week_start, source_type, source_id,
      activity_date, points, occurred_at
    ) VALUES (
      v_row.scoring_user_id, v_row.user_id, v_row.team_id, v_week_start,
      'weekly_arena', v_source_id, v_today, v_bonus, now()
    )
    ON CONFLICT DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'arena_id', p_arena_id::text);
END;
$$;

-- No authenticated EXECUTE — called only by server cron / admin
REVOKE ALL ON FUNCTION public.finalize_weekly_arena_bf(uuid) FROM PUBLIC, anon, authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §5  get_brain_fights_week() — complete rewrite
--
-- Changes vs migration77 version:
--   A. source_type IN ('superq', 'weekly_arena', 'duel', 'training')
--   B. my_contrib exposes: superq_pts, duel_pts, training_pts,
--      weekly_arena_pts, total
--   C. Team formula: +5 per active player outside top-3 (was +1)
--   D. contributors CTE: all sources, not just superq
--   E. player_scores: all sources, not just superq/arena
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brain_fights_week()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_week_end   date;
  v_team_id    uuid;
  v_team_city  text;
BEGIN
  v_week_end := v_week_start + 7;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  SELECT t.city, t.disbanded_at INTO v_team_city, NULL FROM teams t WHERE t.id = v_team_id;

  IF NOT FOUND OR (SELECT t.disbanded_at IS NOT NULL FROM teams t WHERE t.id = v_team_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disbanded');
  END IF;

  RETURN (
    WITH
    -- All verified BF contributions for this week
    player_scores AS (
      SELECT
        bfc.scoring_user_id,
        bfc.user_id,
        bfc.team_id,
        SUM(bfc.points)                   AS total,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'superq')        AS superq_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'duel')          AS duel_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'training')      AS training_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'weekly_arena')  AS arena_pts
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start  = v_week_start
        AND bfc.team_id     IS NOT NULL
        AND bfc.source_type IN ('superq', 'weekly_arena', 'duel', 'training')
      GROUP BY bfc.scoring_user_id, bfc.user_id, bfc.team_id
    ),
    -- Team BF: TOP-3 full score + 5 per active player from #4 onward
    team_totals AS (
      SELECT
        ranked.team_id,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END)
          + COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int * 5
          AS team_pts
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY team_id
                 ORDER BY total DESC, scoring_user_id ASC  -- stable tie-break
               ) AS rn
        FROM player_scores
      ) ranked
      GROUP BY ranked.team_id
    ),
    -- Global + city ranks
    ranked_lb AS (
      SELECT
        tt.team_id,
        tt.team_pts                                                       AS points,
        ROW_NUMBER() OVER (ORDER BY tt.team_pts DESC, tt.team_id ASC)::int AS global_rank,
        COUNT(*) OVER ()::int                                              AS total_global_teams,
        CASE
          WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(t.city))
              ORDER BY tt.team_pts DESC, tt.team_id ASC
            )::int
          ELSE NULL
        END                                                                AS city_rank,
        CASE
          WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
            COUNT(*) OVER (PARTITION BY lower(trim(t.city)))::int
          ELSE NULL
        END                                                                AS total_city_teams,
        t.name,
        t.emoji,
        t.city
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
    ),
    my_team_row AS (
      SELECT rl.points, rl.global_rank, rl.city_rank,
             rl.total_global_teams, rl.total_city_teams
      FROM ranked_lb rl WHERE rl.team_id = v_team_id
    ),
    -- My contribution: per-source breakdown, current team only
    my_contrib AS (
      SELECT
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'superq'),       0) AS superq_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'duel'),          0) AS duel_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'training'),      0) AS training_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'weekly_arena'),  0) AS arena_pts,
        COALESCE(SUM(bfc.points), 0)                                                 AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.user_id     = v_uid
        AND bfc.team_id     = v_team_id
        AND bfc.week_start  = v_week_start
        AND bfc.source_type IN ('superq', 'weekly_arena', 'duel', 'training')
    ),
    -- Top-3 players for this team (for display)
    team_player_scores AS (
      SELECT
        ps.scoring_user_id, ps.user_id, ps.total, ps.superq_pts, ps.duel_pts,
        ps.training_pts, ps.arena_pts,
        ROW_NUMBER() OVER (ORDER BY ps.total DESC, ps.scoring_user_id ASC) AS rn,
        COUNT(CASE WHEN ps.total > 0 THEN 1 END) OVER () AS active_count
      FROM player_scores ps
      WHERE ps.team_id = v_team_id
    ),
    display_contributors AS (
      SELECT
        tps.user_id,
        tps.total AS points,
        tps.rn,
        pr.display_name,
        pr.avatar_url
      FROM team_player_scores tps
      JOIN profiles pr ON pr.id = tps.user_id
      WHERE tps.user_id IS NOT NULL
    ),
    hist AS (
      SELECT cr.rank, cr.points_earned, cr.created_at
      FROM challenge_results cr
      WHERE cr.team_id        = v_team_id
        AND cr.challenge_type = 'brain_fights'
      ORDER BY cr.created_at DESC
      LIMIT 5
    ),
    team_info AS (
      SELECT t.id, t.name, t.emoji, t.city FROM teams t WHERE t.id = v_team_id
    ),
    -- Participation summary for team display
    team_participation AS (
      SELECT
        COUNT(CASE WHEN rn <= 3 THEN 1 END)::int   AS top3_count,
        SUM(CASE WHEN rn <= 3 THEN total ELSE 0 END) AS top3_pts,
        COUNT(CASE WHEN rn > 3 AND total > 0 THEN 1 END)::int AS active_beyond,
        COUNT(CASE WHEN total > 0 THEN 1 END)::int  AS total_active
      FROM team_player_scores
    )
    SELECT jsonb_build_object(
      'ok',         true,
      'week_start', v_week_start::text,
      'week_end',   v_week_end::text,
      'my_team', (
        SELECT jsonb_build_object(
          'id',                 ti.id,
          'name',               ti.name,
          'emoji',              ti.emoji,
          'city',               ti.city,
          'points',             COALESCE(mtr.points, 0),
          'global_rank',        mtr.global_rank,
          'city_rank',          mtr.city_rank,
          'total_global_teams', mtr.total_global_teams,
          'total_city_teams',   mtr.total_city_teams,
          'top3_pts',           tp.top3_pts,
          'active_beyond',      tp.active_beyond,
          'participation_bonus', tp.active_beyond * 5
        )
        FROM team_info ti
        LEFT JOIN my_team_row mtr ON true
        LEFT JOIN team_participation tp ON true
      ),
      'my_contrib', (
        SELECT jsonb_build_object(
          'superq_pts',       mc.superq_pts,
          'duel_pts',         mc.duel_pts,
          'training_pts',     mc.training_pts,
          'weekly_arena_pts', mc.arena_pts,
          'total',            mc.total
        )
        FROM my_contrib mc
      ),
      'contributors', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'user_id',      dc.user_id,
            'display_name', dc.display_name,
            'avatar_url',   dc.avatar_url,
            'points',       dc.points,
            'is_me',        dc.user_id = v_uid,
            'rn',           dc.rn
          ) ORDER BY dc.rn
        )
        FROM display_contributors dc
      ), '[]'::jsonb),
      'leaderboard', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'team_id',      rl.team_id,
            'name',         rl.name,
            'emoji',        rl.emoji,
            'city',         rl.city,
            'points',       rl.points,
            'global_rank',  rl.global_rank,
            'city_rank',    rl.city_rank,
            'is_my_team',   rl.team_id = v_team_id
          ) ORDER BY rl.global_rank
        )
        FROM ranked_lb rl
      ), '[]'::jsonb),
      'history', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'rank',          h.rank,
            'points_earned', h.points_earned,
            'created_at',    h.created_at
          ) ORDER BY h.created_at DESC
        )
        FROM hist h
      ), '[]'::jsonb)
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_brain_fights_week() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_brain_fights_week() TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §6  finalize_weekly_brain_fights() — city-first ranking
--
-- Changes vs migration76/77 version:
--   A. City-first ranking (teams ranked within their city).
--   B. Points map per spec: 1st=100, 2nd=80, 3rd=60, 4th=40, 5th=20, 6th+=10.
--   C. Teams with 0 BF receive no placement points.
--   D. Teams without city receive global-only rank (no city placement).
--   E. All sources aggregated (not just superq).
--   F. Idempotent via ON CONFLICT cr_bf_team_week_unique.
--   G. challenge_results NOT deleted (permanent history).
--   H. team_weekly_brain_fights + player_weekly_bf_points caches cleared.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date    := (now() AT TIME ZONE 'UTC')::date;
  v_week_start   date    := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_city_map     int[]   := ARRAY[100, 80, 60, 40, 20, 10];  -- 1st–5th then 6+
  v_row          record;
  v_pts          integer;
BEGIN
  -- §6.1: Per-city finalization
  FOR v_row IN
    WITH player_scores AS (
      SELECT
        bfc.scoring_user_id,
        bfc.team_id,
        SUM(bfc.points) AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start  = v_week_start
        AND bfc.team_id     IS NOT NULL
        AND bfc.source_type IN ('superq', 'weekly_arena', 'duel', 'training')
      GROUP BY bfc.scoring_user_id, bfc.team_id
    ),
    team_totals AS (
      SELECT
        ranked.team_id,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END)
          + COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int * 5
          AS team_score
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY team_id
                 ORDER BY total DESC, scoring_user_id ASC
               ) AS rn
        FROM player_scores
      ) ranked
      GROUP BY ranked.team_id
    ),
    city_ranked AS (
      SELECT
        tt.team_id,
        tt.team_score,
        t.city,
        -- City rank (NULL for teams without city)
        CASE
          WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(t.city))
              ORDER BY tt.team_score DESC, tt.team_id ASC
            )::int
          ELSE NULL
        END AS city_rank
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
      WHERE tt.team_score > 0  -- only teams with BF points participate
    )
    SELECT team_id, team_score, city, city_rank FROM city_ranked
    ORDER BY city, city_rank NULLS LAST
  LOOP
    -- Points awarded based on city rank; no city → no placement points
    IF v_row.city_rank IS NOT NULL THEN
      v_pts := CASE
        WHEN v_row.city_rank <= 5           THEN v_city_map[v_row.city_rank]
        WHEN v_row.city_rank >= 6           THEN 10
        ELSE 0
      END;
    ELSE
      -- Team without city: informational record only (0 season points)
      v_pts := 0;
    END IF;

    -- Idempotent: ON CONFLICT (team_id, challenge_type, week_start) DO NOTHING
    INSERT INTO challenge_results
      (team_id, provider_id, challenge_type, rank, points_earned, week_start)
    VALUES
      (v_row.team_id, 'bfc_internal', 'brain_fights',
       COALESCE(v_row.city_rank, 0), v_pts, v_week_start)
    ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING;
  END LOOP;

  -- §6.2: Clear rolling caches (brain_fight_contributions is permanent)
  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
END;
$$;


-- ──────────────────────────────────────────────────────────────────
-- §7  Daily Training BF — FUTURE-GATED
--
-- Architecture specification for when submit_training_answer() is built:
--
-- When session_questions is populated by start_game_session() with
-- the canonical question IDs assigned to this session:
--   - Client submits: submit_training_answer(session_id, question_id, selected_index)
--   - Server looks up: questions.correct_index for that question_id
--   - Server derives: is_correct = (selected_index = correct_index)
--   - Server inserts: session_questions row with is_correct
--   - On completion (all 10 answered): aggregate correct count (server-side)
--   - Award BF: +1 per correct, max 10 BF total, cap enforced by
--     bfc_daily_unique (scoring_user_id, 'training', activity_date)
--
-- BF contribution source_id for training:
--   game_sessions.id (one per session, one per day per player in practice)
--
-- Daily cap safety:
--   bfc_daily_unique already prevents two training contributions on same day.
--   Even if player completes two sessions (unusual), only one BF row exists.
--
-- Premium cap:
--   Premium allows up to 50 training questions (5 × 10). But BF may only
--   be awarded for the FIRST eligible session of the day.
--   Enforced via bfc_daily_unique — second session gets ON CONFLICT DO NOTHING.
--
-- This comment block is the authoritative design contract.
-- No training BF rows may be created until submit_training_answer() exists.
-- ──────────────────────────────────────────────────────────────────

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- CANONICAL BF SOURCE TABLE (after migration82)
-- ─────────────────────────────────────────────────────────────────────────
-- source_type      status         points          cap
-- ─────────────────────────────────────────────────────────────────────────
-- superq           ACTIVE         5 correct / 1   1/day
-- weekly_arena     ACTIVE         2+perf+bonus    1/arena (2 inserts per player)
-- duel             ACTIVE         3/win           3 wins/day (9 BF/day max)
-- training         FUTURE-GATED   +1/correct      10 BF/day (10 correct max)
-- ─────────────────────────────────────────────────────────────────────────
-- TEAM FORMULA (live and final):
--   TEAM_BF = SUM(full BF of TOP-3 players) + 5 × ACTIVE_PLAYERS_FROM_#4
--   where ACTIVE = at least 1 verified BF contribution this week
-- ─────────────────────────────────────────────────────────────────────────
-- CITY SEASON INTEGRATION:
--   challenge_results (type='brain_fights') receives city_rank + points_earned
--   after finalize_weekly_brain_fights(). Season protocol beyond BF is a
--   separate future dependency — do not extend challenge_results schema here.
-- ─────────────────────────────────────────────────────────────────────────
-- DO NOT APPLY WITHOUT REVIEW.
-- ═══════════════════════════════════════════════════════════════════════════
