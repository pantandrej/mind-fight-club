-- ════════════════════════════════════════════════════════════════════════════
-- Migration 82 — Brain Fights: Complete Weekly Model  (CORRECTIVE PASS v2)
-- ════════════════════════════════════════════════════════════════════════════
--
-- P0 ISSUES ADDRESSED (see full brief for details):
--   P0.1  Uniqueness redesign: drop bfc_daily_unique; partial indexes for
--         superq+training only; duel/arena allow multiple rows/day.
--   P0.2  Duel daily cap: advisory lock per winner+UTC day.
--   P0.3  Single internal _bf_award_duel_win helper; trigger delegates to it.
--   P0.4  Arena 50% threshold applies on partial completion, not 100%.
--   P0.5  Arena BF single-pass via finalize_weekly_arena_bf after FINISHED.
--   P0.6  Arena placement uses RANK() OVER (ORDER BY wap.score DESC) —
--         same canonical rule as get_weekly_arena_results; true ties share rank.
--   P0.7  get_brain_fights_week(): fix `INTO v_team_city, NULL` SQL bug;
--         proper DECLARE + SELECT INTO for disbanded_at check.
--   P0.8  finalize_weekly_brain_fights(): no DELETE of legacy cache tables.
--         team_weekly_brain_fights + player_weekly_bf_points are pre-m76 legacy
--         scratch tables — reported as cleanup debt, not deleted here.
--   P0.9  finalize_weekly_brain_fights(p_week_start date DEFAULT NULL):
--         explicit week targeting; safe Monday-boundary rule.
--   P0.10 Daily Game BF is ACTIVE (not future-gated).
--   P0.11 start_daily_bf_session() assigns questions server-side; payload
--         contains sq_id tokens but never correct_index and never q_id.
--   P0.12 Only first BF-eligible Daily Game session earns BF; Premium extra
--         sessions earn 0 BF. Free/Premium game quota unchanged.
--   P0.13 Team attribution captured at award time (not current team).
--   P0.14 UI removes "Скоро" for Daily Game (handled in training.js / brain-fights.js).
--   P0.15 Migration syntax validated via `supabase db query --linked --file` (dry-run).
--
-- BEFORE-STATE AUDIT (basis):
--   brain_fight_contributions (m76): two constraints:
--     bfc_source_unique UNIQUE (scoring_user_id, source_type, source_id)
--     bfc_daily_unique  UNIQUE (scoring_user_id, source_type, activity_date)
--   source_type CHECK: IN ('superq', 'weekly_arena')
--   Arena BF: awarded on 100% completion with fixed 5 pts (m77)
--   Duel BF: not wired (m78 comment: "No call to record_duel_win_bf")
--   Daily Game: client-authoritative (correctness derived locally)
--   Team formula: +1 per active player outside top-3 (spec requires +5)
--   Finalization: global ranking only
--
-- DO NOT APPLY WITHOUT REVIEW.
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;


-- ──────────────────────────────────────────────────────────────────────────
-- §1  Uniqueness redesign  (P0.1)
--
-- PROBLEM: bfc_daily_unique (scoring_user_id, source_type, activity_date)
--   blocks inserting a second or third duel-win BF row on the same day,
--   and would block Arena pass-1 + pass-2 rows on the same day.
--
-- FIX: Drop the broad daily constraint. Replace with source-specific partial
--   unique indexes only where "one per day" semantics are actually required:
--
--   superq   — one canonical BF contribution per user per UTC day
--   training — one canonical aggregated BF contribution per user per UTC day
--
--   duel     — multiple rows per day OK (up to 3 wins = 3 separate rows,
--               each keyed by duel source_id); cap enforced by count + lock
--   weekly_arena — one row per player per arena (keyed by stable source_id,
--               not by activity_date); no daily constraint needed
--
-- KEEP: bfc_source_unique (scoring_user_id, source_type, source_id) — event
--   identity guard; primary idempotency constraint for all sources.
-- ──────────────────────────────────────────────────────────────────────────

-- Drop the broad daily constraint (exact name from m76).
ALTER TABLE public.brain_fight_contributions
  DROP CONSTRAINT IF EXISTS bfc_daily_unique;

-- Partial unique index: superq — one row per user per UTC day.
CREATE UNIQUE INDEX IF NOT EXISTS bfc_superq_daily_uidx
  ON public.brain_fight_contributions (scoring_user_id, activity_date)
  WHERE source_type = 'superq';

-- Partial unique index: training — one row per user per UTC day.
-- ON CONFLICT on this index provides the daily cap for Daily Game BF.
CREATE UNIQUE INDEX IF NOT EXISTS bfc_training_daily_uidx
  ON public.brain_fight_contributions (scoring_user_id, activity_date)
  WHERE source_type = 'training';

-- Extend source_type CHECK: add 'duel' and 'training'.
-- Drop ALL existing CHECK constraints that mention source_type.
DO $$
DECLARE
  _c text;
BEGIN
  FOR _c IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.brain_fight_contributions'::regclass
      AND contype  = 'c'
      AND pg_get_constraintdef(oid) LIKE '%source_type%'
  LOOP
    EXECUTE format('ALTER TABLE public.brain_fight_contributions DROP CONSTRAINT IF EXISTS %I', _c);
  END LOOP;
END;
$$;

ALTER TABLE public.brain_fight_contributions
  ADD CONSTRAINT bfc_source_type_check
  CHECK (source_type IN ('superq', 'weekly_arena', 'duel', 'training'));


-- ──────────────────────────────────────────────────────────────────────────
-- §2  session_questions — server-authoritative Daily Game answer ledger
--
-- Populated by start_daily_bf_session() (§7).
-- Selected_idx and is_correct are set atomically by submit_daily_bf_answer() (§7.5).
-- No client SELECT policy — all reads/writes via SECURITY DEFINER functions.
--
-- Architecture for Daily Game authority:
--   start_daily_bf_session() → assigns 10 canonical questions → returns
--     payload WITHOUT correct_index and WITHOUT q_id.
--   submit_daily_bf_answer(session_id, sq_id, selected_idx) → atomic
--     UPDATE...RETURNING; returns persisted is_correct + correct_index after write.
--   complete_daily_bf_session(session_id) → verifies 10 assigned + 10 resolved;
--     awards BF (1 per correct, max 10) via single training contribution row.
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.session_questions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid        NOT NULL REFERENCES public.game_sessions(id) ON DELETE CASCADE,
  question_id  uuid        NOT NULL REFERENCES public.questions(id)     ON DELETE CASCADE,
  position     int         NOT NULL,
  selected_idx int,                      -- client-submitted index (NULL = unanswered)
  is_correct   boolean,                  -- server-derived ONLY
  answered_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sq_session_position_unique UNIQUE (session_id, position),
  CONSTRAINT sq_session_question_unique UNIQUE (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_sq_session ON public.session_questions(session_id);

ALTER TABLE public.session_questions ENABLE ROW LEVEL SECURITY;
-- No client policies: RLS blocks all client reads/writes.
-- SECURITY DEFINER functions bypass RLS.


-- ──────────────────────────────────────────────────────────────────────────
-- §3  _bf_award_duel_win(winner_id, duel_code, today)
--     Single internal helper — called by trigger only (§4).
--
-- SECURITY:
--   REVOKE from all roles. Never called directly by authenticated clients.
--   Trigger fires as function owner (SECURITY DEFINER context).
--
-- CONCURRENCY (P0.2):
--   Acquires a transaction-level advisory lock keyed by winner + UTC day.
--   Serializes all concurrent BF duel awards for the same player on the same
--   day. The fourth concurrent win correctly observes count=3 and awards 0.
--   Lock is released when the triggering transaction commits/rolls back.
--
-- IDEMPOTENCY (P0.3):
--   source_id = md5(duel_code || '::duel_win::' || winner_id)::uuid
--   bfc_source_unique (scoring_user_id, source_type, source_id) → unique per
--   player per duel. ON CONFLICT DO NOTHING on INSERT; explicit pre-check
--   first (avoids counting an already-awarded duel in today's cap).
--
-- DAILY CAP:
--   Count existing 'duel' BF rows for winner+today (after advisory lock).
--   If COUNT >= 3 → award 0. Returns 0 for ties (winner_id IS NULL).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._bf_award_duel_win(
  p_winner_id uuid,
  p_duel_code text,
  p_today     date
) RETURNS int   -- bf_pts awarded (3 or 0)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_week_start date := p_today - ((EXTRACT(DOW FROM p_today)::int + 6) % 7);
  v_team_id    uuid;
  v_source_id  uuid;
  v_wins_today int;
  v_rows       int;
BEGIN
  -- No winner (tie) → 0 BF, nothing to do.
  IF p_winner_id IS NULL THEN RETURN 0; END IF;

  -- Serialize: one BF duel award at a time per winner per UTC day.
  PERFORM pg_advisory_xact_lock(
    hashtext(p_winner_id::text || '::bf_duel_wins::' || p_today::text)
  );

  -- Stable source_id for this specific win (duel code + winner).
  v_source_id := md5(p_duel_code || '::duel_win::' || p_winner_id::text)::uuid;

  -- Already awarded for this exact duel+winner? Idempotent guard.
  IF EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE scoring_user_id = p_winner_id
      AND source_type     = 'duel'
      AND source_id       = v_source_id
  ) THEN
    RETURN 0;
  END IF;

  -- Count today's verified duel wins (under lock — race-safe).
  SELECT COUNT(*) INTO v_wins_today
  FROM brain_fight_contributions
  WHERE scoring_user_id = p_winner_id
    AND source_type     = 'duel'
    AND activity_date   = p_today;

  IF v_wins_today >= 3 THEN
    RETURN 0;  -- daily cap reached
  END IF;

  -- Team attribution at event time (not at query time).
  SELECT t.id INTO v_team_id
  FROM profiles pr
  LEFT JOIN teams t ON t.id = pr.team_id AND t.disbanded_at IS NULL
  WHERE pr.id = p_winner_id;

  INSERT INTO brain_fight_contributions (
    scoring_user_id, user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    p_winner_id, p_winner_id, v_team_id, v_week_start,
    'duel', v_source_id, p_today, 3, now()
  )
  ON CONFLICT DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN CASE WHEN v_rows > 0 THEN 3 ELSE 0 END;
END;
$$;

REVOKE ALL ON FUNCTION public._bf_award_duel_win(uuid, text, date)
  FROM PUBLIC, anon, authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §4  Trigger: wire Duel BF award on duel finalization
--
-- Fires AFTER UPDATE on duel_rooms when status transitions to 'finished'.
-- Calls _bf_award_duel_win — single canonical implementation (P0.3).
-- Trigger runs in the same transaction as submit_duel_answer() (m78).
-- No modification to m78 or m81 required.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._trg_duel_finished_bf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'UPDATE')
     AND (NEW.status = 'finished')
     AND (OLD.status IS DISTINCT FROM 'finished')
     AND (NEW.winner_id IS NOT NULL)
  THEN
    PERFORM public._bf_award_duel_win(
      NEW.winner_id,
      NEW.code,
      (now() AT TIME ZONE 'UTC')::date
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_duel_finished_bf ON public.duel_rooms;
CREATE TRIGGER trg_duel_finished_bf
  AFTER UPDATE ON public.duel_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public._trg_duel_finished_bf();


-- ──────────────────────────────────────────────────────────────────────────
-- §5  submit_weekly_arena_answer() — BF awarding REMOVED  (P0.4, P0.5)
--
-- Arena BF is now awarded in a single pass via finalize_weekly_arena_bf()
-- (§6) after the arena is FINISHED. This:
--   • Fixes the 50% threshold (players who answered 50-99% were excluded)
--   • Eliminates the same-day double-row conflict for Arena source_type
--   • Produces the canonical placement ranking in one authoritative pass
--   • Simplifies idempotency (one source_id per player/arena)
--
-- All other logic (auth, arena live check, waq_id resolution, correctness
-- derivation, answer insert, score update, completion flag) is unchanged
-- from migration 77.
--
-- Authority verdict: unchanged — fully server-authoritative (A–G).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_weekly_arena_answer(
  p_arena_id      uuid,
  p_waq_id        uuid,
  p_selected_index int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_arena         weekly_arenas%ROWTYPE;
  v_waq           weekly_arena_questions%ROWTYPE;
  v_part          weekly_arena_participants%ROWTYPE;
  v_correct_index int;
  v_is_correct    boolean;
  v_pts           int;
  v_answer_rows   int;
  v_answered      int;
  v_total         int;
  v_completed     boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Arena must be LIVE (server clock, not client)
  SELECT * INTO v_arena FROM weekly_arenas
  WHERE id = p_arena_id AND now() BETWEEN starts_at AND ends_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_live');
  END IF;

  -- Resolve waq_id → question_id server-side (client only has waq_id)
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

  -- Server derives correctness (correct_index never returned to client)
  SELECT q.correct_index INTO v_correct_index
  FROM questions q WHERE q.id = v_waq.question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  v_is_correct := p_selected_index = v_correct_index;
  v_pts        := CASE WHEN v_is_correct THEN 10 ELSE 0 END;

  -- Concurrency-safe answer insert (idempotent)
  INSERT INTO weekly_arena_answers
    (arena_id, participant_id, scoring_user_id, question_id,
     selected_index, is_correct, points)
  VALUES
    (p_arena_id, v_part.id, v_uid, v_waq.question_id,
     p_selected_index, v_is_correct, v_pts)
  ON CONFLICT (arena_id, scoring_user_id, question_id) DO NOTHING;

  GET DIAGNOSTICS v_answer_rows = ROW_COUNT;
  IF v_answer_rows = 0 THEN
    SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
    WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
    RETURN jsonb_build_object(
      'ok',              false,
      'reason',          'already_answered',
      'answered',        v_answered,
      'total_questions', v_part.total_questions
    );
  END IF;

  -- Update participant running totals (server-maintained)
  UPDATE weekly_arena_participants
  SET score   = score   + v_pts,
      correct = correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = v_part.id;

  SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
  v_total := v_part.total_questions;

  IF v_answered >= v_total AND v_total > 0 THEN
    UPDATE weekly_arena_participants
    SET completed_at = now()
    WHERE id = v_part.id AND completed_at IS NULL;
    v_completed := true;
  END IF;

  -- Response: no correctness fields during LIVE (competitive integrity)
  -- BF is NOT awarded here — single-pass finalize_weekly_arena_bf after FINISHED.
  RETURN jsonb_build_object(
    'ok',              true,
    'accepted',        true,
    'answered',        v_answered,
    'total_questions', v_total,
    'completed',       v_completed
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int)
  FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int)
  TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §6  finalize_weekly_arena_bf(p_arena_id uuid)
--     Single-pass Arena BF: participation + performance + placement  (P0.5)
--
-- Called by server cron/admin after arena effective status = 'finished'.
-- DO NOT GRANT to authenticated — cron/admin only.
--
-- QUALIFICATION (P0.4):
--   Player qualifies if answered_count >= CEIL(total_questions × 0.5).
--   answered_count comes from COUNT(weekly_arena_answers) per participant.
--   Players who answered exactly 50%+ qualify; those below get 0 BF.
--
-- BF FORMULA:
--   participation_bf = 2
--   performance_bf   = ROUND(10 × wap.correct / wap.total_questions)
--     denominator = TOTAL Arena questions, not only answered (P0.4 spec)
--     wap.correct = server-derived count of correct answers
--   placement_bf     = 5 (1st) / 3 (2nd) / 2 (3rd) / 0 (4th+)
--   total_bf         = participation_bf + performance_bf + placement_bf ≤ 17
--
-- PLACEMENT (P0.6):
--   RANK() OVER (ORDER BY wap.score DESC) — true ties share rank.
--   No tie-break — same as get_weekly_arena_results() canonical leaderboard.
--   wap.score = correct_count × 10 (score per correct answer in m77).
--   Equal scores = equal rank → both receive the same placement bonus.
--
-- SOURCE_ID (one per player per arena):
--   md5(arena_id::text || '::arena_bf::' || scoring_user_id::text)::uuid
--   bfc_source_unique prevents double-award on re-run → idempotent.
--
-- WEEK ATTRIBUTION:
--   Uses arena.starts_at week (not now()) — consistent for cross-midnight finishes.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_weekly_arena_bf(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_arena        weekly_arenas%ROWTYPE;
  v_week_start   date;
  v_today        date := (now() AT TIME ZONE 'UTC')::date;
  v_place_bonus  int[] := ARRAY[5, 3, 2];  -- 1st, 2nd, 3rd
  v_row          record;
  v_source_id    uuid;
  v_total_bf     int;
  v_bf_pts       int;
  v_awarded      int := 0;
BEGIN
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;
  IF now() < v_arena.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_still_live');
  END IF;

  v_week_start := DATE_TRUNC('week', v_arena.starts_at AT TIME ZONE 'UTC')::date;

  FOR v_row IN
    WITH answered AS (
      SELECT waa.participant_id, COUNT(*) AS answered_count
      FROM weekly_arena_answers waa
      WHERE waa.arena_id = p_arena_id
      GROUP BY waa.participant_id
    ),
    ranked AS (
      SELECT
        wap.id              AS participant_id,
        wap.scoring_user_id,
        wap.user_id,
        wap.team_id,
        wap.score,
        wap.correct,
        wap.total_questions,
        COALESCE(an.answered_count, 0) AS answered_count,
        -- Canonical Arena ranking: RANK() on score, true ties share rank.
        -- Matches get_weekly_arena_results() exactly (P0.6).
        RANK() OVER (ORDER BY wap.score DESC)::int AS placement
      FROM weekly_arena_participants wap
      LEFT JOIN answered an ON an.participant_id = wap.id
      WHERE wap.arena_id = p_arena_id
    )
    SELECT * FROM ranked
    WHERE total_questions > 0
      AND answered_count >= CEIL(total_questions::numeric * 0.5)  -- 50% threshold
  LOOP
    -- BF = participation(2) + performance(0-10) + placement(0-5)
    v_bf_pts := 2
      + ROUND(10::numeric * v_row.correct / v_row.total_questions)::int;

    -- Placement bonus for top 3 (ties: both get the same bonus)
    IF v_row.placement <= array_length(v_place_bonus, 1) THEN
      v_bf_pts := v_bf_pts + v_place_bonus[v_row.placement];
    END IF;

    -- Stable source_id: one per player per arena (not per day)
    v_source_id := md5(
      p_arena_id::text || '::arena_bf::' || v_row.scoring_user_id::text
    )::uuid;

    INSERT INTO brain_fight_contributions (
      scoring_user_id, user_id, team_id, week_start, source_type, source_id,
      activity_date, points, occurred_at
    ) VALUES (
      v_row.scoring_user_id, v_row.user_id, v_row.team_id, v_week_start,
      'weekly_arena', v_source_id, v_today, v_bf_pts, now()
    )
    ON CONFLICT DO NOTHING;  -- idempotent on re-run

    v_awarded := v_awarded + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',      true,
    'arena_id', p_arena_id,
    'awarded', v_awarded
  );
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_weekly_arena_bf(uuid)
  FROM PUBLIC, anon, authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §7  start_daily_bf_session()
--     Server-authoritative Daily Game BF session  (P0.10, P0.11, P0.12)
--
-- AUTHORITY:
--   Server assigns 10 canonical questions (2 each of 2,3,4,5,6 options).
--   Payload: sq_id (session_questions.id token) + question text/answers.
--   NO correct_index. NO q_id (prevents anon get_question_reveals bypass).
--   Correctness revealed only through submit_daily_bf_answer() response.
--   BF is derived by complete_daily_bf_session() from session_questions, not
--   from any client-supplied correctness claim.
--
-- QUOTA:
--   Uses start_game_session advisory lock (same key) to prevent race.
--   Checks plan limits (free=1, premium=5 training sessions/day).
--   Inserts game_sessions row (counts toward plan quota).
--
-- BF ELIGIBILITY (P4, BLOCKER 1 FIX):
--   Canonical rule: first training session of the user/UTC day gets bf_eligible=true.
--   Check is based on game_sessions (not brain_fight_contributions) while holding
--   the user/day advisory lock. This prevents the race where two Premium sessions
--   start before either completes — both would otherwise see no contribution yet.
--   Under the advisory lock, if any session with bf_eligible=true already exists
--   today, the new session gets bf_eligible=false.
--   Contribution check kept as defense-in-depth (secondary guard).
--
-- QUESTION BANK:
--   Same public curated bank as Friend Duel (m81):
--     status='active', question_type='multiple_choice', correct_index valid,
--     is_competitive_secret=false, source_type='official_general'.
--   Excludes currently-live Arena questions (same exclusion as start_duel).
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.start_daily_bf_session()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_today         date := (now() AT TIME ZONE 'UTC')::date;
  v_plan          text := 'free';
  v_train_limit   int;
  v_train_used    int;
  v_session_id    uuid;
  v_bf_eligible   boolean := true;
  v_progression   int[]  := ARRAY[2,2,3,3,4,4,5,5,6,6];
  v_opt_count     int;
  v_used_ids      uuid[] := ARRAY[]::uuid[];
  v_q_id          uuid;
  v_q_text        text;
  v_answers       jsonb;
  v_category      text;
  v_sq_id         uuid;
  v_pos           int := 0;
  v_questions     jsonb := '[]'::jsonb;
  _i              int;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Advisory lock: same key as start_game_session training — serializes
  -- concurrent calls for this user+day, preventing double-session race.
  PERFORM pg_advisory_xact_lock(
    hashtext(v_uid::text || ':' || v_today::text || ':training')
  );

  -- Determine plan (server-only — same logic as start_game_session)
  SELECT COALESCE(
    (SELECT plan FROM subscriptions
     WHERE user_id = v_uid
       AND (expires_at IS NULL OR expires_at > now())
     ORDER BY expires_at DESC NULLS FIRST LIMIT 1),
    'free'
  ) INTO v_plan;

  v_train_limit := CASE v_plan WHEN 'premium' THEN 5 ELSE 1 END;

  SELECT COUNT(*) INTO v_train_used
  FROM game_sessions
  WHERE user_id = v_uid AND day_utc = v_today AND mode = 'training';

  IF v_train_used >= v_train_limit THEN
    RETURN jsonb_build_object(
      'ok',     false,
      'reason', 'training_limit_reached',
      'used',   v_train_used,
      'limit',  v_train_limit,
      'plan',   v_plan
    );
  END IF;

  -- BF eligibility: canonical check while holding the advisory lock (BLOCKER 1).
  -- Check game_sessions for any session that already claimed bf_eligible=true today.
  -- This prevents the race where two Premium sessions start before either completes.
  IF EXISTS (
    SELECT 1 FROM game_sessions
    WHERE user_id     = v_uid
      AND day_utc     = v_today
      AND mode        = 'training'
      AND bf_eligible = true
  ) THEN
    v_bf_eligible := false;
  END IF;

  -- Defense-in-depth: if a contribution somehow already exists (e.g. manual admin
  -- insert), also mark ineligible.
  IF v_bf_eligible AND EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE scoring_user_id = v_uid
      AND source_type     = 'training'
      AND activity_date   = v_today
  ) THEN
    v_bf_eligible := false;
  END IF;

  -- Stage all 10 questions (validate before any DB write)
  FOREACH v_opt_count IN ARRAY v_progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text)          AS q_text,
      COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb) AS answers,
      COALESCE(q.category, 'GENERAL')                   AS category
    INTO v_q_id, v_q_text, v_answers, v_category
    FROM questions q
    WHERE q.status               = 'active'
      AND q.question_type        = 'multiple_choice'
      AND q.correct_index        IS NOT NULL
      AND q.correct_index        >= 0
      AND q.is_competitive_secret = false
      AND q.source_type          = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
      AND jsonb_array_length(
            COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb)) = v_opt_count
      AND NOT (q.id = ANY(v_used_ids))
      AND q.id NOT IN (
        SELECT waq.question_id FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random() LIMIT 1;

    IF NOT FOUND OR v_q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok',              false,
        'reason',          'not_enough_questions',
        'needed_opt_count', v_opt_count
      );
    END IF;

    v_used_ids := v_used_ids || ARRAY[v_q_id];
    v_pos      := v_pos + 1;

    -- Build payload entry: no correct_index, no q_id (P0 security).
    -- sq_id is the only client token for submitting answers.
    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'sq_id', null::uuid,  -- placeholder; real sq_id set after INSERT below
      'pos',   v_pos,
      'q',     v_q_text,
      'a',     v_answers,
      'cat',   v_category,
      't',     20 + v_opt_count * 5
    ));
  END LOOP;

  -- All 10 questions staged — now create session + session_questions.
  -- Persist bf_eligible on the session row (P4: canonical per-session eligibility).
  INSERT INTO game_sessions (user_id, mode, day_utc, bf_eligible)
  VALUES (v_uid, 'training', v_today, v_bf_eligible)
  RETURNING id INTO v_session_id;

  -- Insert session_questions and patch sq_ids into payload.
  v_questions := '[]'::jsonb;
  FOR _i IN 0..(array_length(v_progression, 1) - 1)
  LOOP
    v_opt_count := v_progression[_i + 1];
    v_q_id      := v_used_ids[_i + 1];

    -- Re-fetch question text/answers (needed to build final payload)
    SELECT
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb),
      COALESCE(q.category, 'GENERAL')
    INTO v_q_text, v_answers, v_category
    FROM questions q WHERE q.id = v_q_id;

    INSERT INTO session_questions (session_id, question_id, position)
    VALUES (v_session_id, v_q_id, _i + 1)
    RETURNING id INTO v_sq_id;

    v_questions := v_questions || jsonb_build_array(jsonb_build_object(
      'sq_id', v_sq_id,
      'pos',   _i + 1,
      'q',     v_q_text,
      'a',     v_answers,
      'cat',   v_category,
      't',     20 + v_opt_count * 5
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok',          true,
    'bf_eligible', v_bf_eligible,
    'session_id',  v_session_id,
    'questions',   v_questions,
    'plan',        v_plan,
    'remaining',   v_train_limit - v_train_used - 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_daily_bf_session() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.start_daily_bf_session() TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §7.5  submit_daily_bf_answer(p_session_id, p_sq_id, p_selected_idx)
--       Per-answer server authority  (A1, A2, P1)
--
-- Called by client for EACH answer (including timeout: p_selected_idx = -1).
-- Server derives is_correct from questions.correct_index, never trusts client.
--
-- ATOMICITY (P1): Uses UPDATE...RETURNING instead of EXISTS + UPDATE.
--   Two concurrent requests cannot both return accepted=true:
--   only the request that wins the UPDATE (is_correct IS NULL guard) gets RETURNING rows.
--   The loser reads PERSISTED values and returns accepted=false with canonical result.
--
-- Returns: {ok, accepted, is_correct, correct_index}
--   accepted=true on first write; accepted=false on retry (with persisted values)
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_daily_bf_answer(
  p_session_id  uuid,
  p_sq_id       uuid,
  p_selected_idx int   -- 0-based index into answers array, or -1 for timeout
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_session       game_sessions%ROWTYPE;
  v_question_id   uuid;
  v_correct_idx   int;
  v_ans_count     int;
  v_is_correct    boolean;
  v_updated_id    uuid;
  v_stored_idx    int;
  v_stored_correct boolean;
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

  -- Validate sq_id belongs to this session and get question data
  SELECT sq.question_id, q.correct_index,
         jsonb_array_length(COALESCE(q.answers_ru, q.answers_json, '[]'::jsonb))
  INTO v_question_id, v_correct_idx, v_ans_count
  FROM session_questions sq
  JOIN questions q ON q.id = sq.question_id
  WHERE sq.id = p_sq_id AND sq.session_id = p_session_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_sq_id');
  END IF;

  -- Validate selected_idx range: -1 = timeout, 0..n-1 = valid choice
  IF p_selected_idx <> -1 AND (p_selected_idx < 0 OR p_selected_idx >= v_ans_count) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_selected_idx');
  END IF;

  -- Derive correctness server-side; timeout always wrong
  v_is_correct := (p_selected_idx >= 0) AND (p_selected_idx = v_correct_idx);

  -- Atomic commit: UPDATE...RETURNING guards against race condition (P1).
  -- Only the request that wins the race (is_correct IS NULL) gets a returned id.
  UPDATE session_questions
  SET selected_idx = p_selected_idx,
      is_correct   = v_is_correct,
      answered_at  = now()
  WHERE id = p_sq_id AND session_id = p_session_id AND is_correct IS NULL
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    -- Race lost or duplicate call: read PERSISTED canonical values and return them.
    SELECT sq.selected_idx, sq.is_correct
    INTO v_stored_idx, v_stored_correct
    FROM session_questions sq
    WHERE sq.id = p_sq_id;

    RETURN jsonb_build_object(
      'ok',           true,
      'accepted',     false,
      'reason',       'already_answered',
      'selected_idx', v_stored_idx,
      'is_correct',   v_stored_correct,
      'correct_index', v_correct_idx
    );
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'accepted',     true,
    'selected_idx', p_selected_idx,
    'is_correct',   v_is_correct,
    'correct_index', v_correct_idx
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_daily_bf_answer(uuid, uuid, int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.submit_daily_bf_answer(uuid, uuid, int) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §8  complete_daily_bf_session(p_session_id)
--     Awards Daily Game BF — counts from per-answer ledger  (A3, P0.11, P0.12, P3, P4)
--
-- No p_answers param: correctness was recorded per-answer via submit_daily_bf_answer.
-- Server counts is_correct=true rows from session_questions.
--
-- FLOW:
--   1. Verify session ownership (mode='training', user = caller).
--   2. Verify bf_eligible=true on session row (P4: canonical per-session flag).
--   3. Verify assigned_count=10 AND resolved_count=10 (P3: all 10 must be answered).
--      Returns {session_incomplete} if resolved_count < assigned_count.
--   4. COUNT is_correct=true across all session_questions for this session.
--   5. BF = MIN(correct_count, 10). Award as single 'training' contribution.
--   6. Idempotent: ON CONFLICT on bfc_source_unique (session_id as source_id)
--      + bfc_training_daily_uidx (one training row per day).
--      Re-running returns {ok:true, already_completed:true, bf_pts:0}.
-- ──────────────────────────────────────────────────────────────────────────
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
  v_today         date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start    date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
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

  v_bf_pts    := LEAST(v_correct_cnt, 10);  -- max 10 BF
  v_source_id := p_session_id;              -- stable per-session source_id

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
    -- Either this session was already completed, or another training session
    -- already earned BF today (bfc_training_daily_uidx). Return 0.
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


-- ──────────────────────────────────────────────────────────────────────────
-- §9  get_brain_fights_week() — corrected SQL, all sources, ×5 formula  (P0.7)
--
-- FIXES vs migration 77 / original migration 82 draft:
--   A. P0.7: Fixed `SELECT ... INTO v_team_city, NULL` SQL bug.
--      DECLARE v_disbanded_at timestamptz; SELECT city, disbanded_at INTO
--      v_team_city, v_disbanded_at — proper PL/pgSQL variable assignment.
--   B. All 4 sources: superq, duel, training, weekly_arena.
--   C. Team formula: +5 (not +1) per active player outside top-3.
--   D. my_contrib: all 4 per-source breakdowns returned.
--   E. Participation bonus field for team display.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_brain_fights_week()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid            uuid := auth.uid();
  v_today          date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start     date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_week_end       date;
  v_team_id        uuid;
  v_team_city      text;
  v_team_name      text;
  v_team_emoji     text;
  v_disbanded_at   timestamptz;  -- P0.7: proper variable
BEGIN
  v_week_end := v_week_start + 7;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  -- P0.7: proper SELECT INTO; also fetch name/emoji for P6 (always available)
  SELECT t.city, t.name, t.emoji, t.disbanded_at
  INTO v_team_city, v_team_name, v_team_emoji, v_disbanded_at
  FROM teams t WHERE t.id = v_team_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  IF v_disbanded_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disbanded');
  END IF;

  RETURN (
    WITH
    -- All verified BF contributions for this week (all 4 sources)
    player_scores AS (
      SELECT
        bfc.scoring_user_id,
        bfc.user_id,
        bfc.team_id,
        SUM(bfc.points)                                                          AS total,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'superq')               AS superq_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'duel')                 AS duel_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'training')             AS training_pts,
        SUM(bfc.points) FILTER (WHERE bfc.source_type = 'weekly_arena')         AS arena_pts
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start  = v_week_start
        AND bfc.team_id     IS NOT NULL
        AND bfc.source_type IN ('superq', 'weekly_arena', 'duel', 'training')
      GROUP BY bfc.scoring_user_id, bfc.user_id, bfc.team_id
    ),
    -- Team BF formula: SUM(top-3 full) + 5 × active players from #4+
    team_totals AS (
      SELECT
        ranked.team_id,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END) AS top3_pts,
        COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int AS active_beyond,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END)
          + COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int * 5
          AS team_pts
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
    -- Global + city leaderboard with ranks
    ranked_lb AS (
      SELECT
        tt.team_id,
        tt.team_pts AS points,
        t.name,
        t.emoji,
        t.city,
        ROW_NUMBER() OVER (
          ORDER BY tt.team_pts DESC, tt.team_id ASC
        )::int AS global_rank,
        COUNT(*) OVER ()::int AS total_global_teams,
        CASE WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
          ROW_NUMBER() OVER (
            PARTITION BY lower(trim(t.city))
            ORDER BY tt.team_pts DESC, tt.team_id ASC
          )::int
        END AS city_rank,
        CASE WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
          COUNT(*) OVER (PARTITION BY lower(trim(t.city)))::int
        END AS total_city_teams
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
    ),
    my_team_row AS (
      SELECT rl.points, rl.global_rank, rl.city_rank,
             rl.total_global_teams, rl.total_city_teams,
             tt.top3_pts, tt.active_beyond
      FROM ranked_lb rl
      LEFT JOIN team_totals tt ON tt.team_id = rl.team_id
      WHERE rl.team_id = v_team_id
    ),
    -- My personal contribution: per-source breakdown
    my_contrib AS (
      SELECT
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'superq'),       0) AS superq_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'duel'),          0) AS duel_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'training'),      0) AS training_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'weekly_arena'),  0) AS arena_pts,
        COALESCE(SUM(bfc.points), 0)                                                  AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.user_id     = v_uid
        AND bfc.team_id     = v_team_id
        AND bfc.week_start  = v_week_start
        AND bfc.source_type IN ('superq', 'weekly_arena', 'duel', 'training')
    ),
    -- Team top contributors for display (all ranked players)
    team_player_scores AS (
      SELECT
        ps.scoring_user_id,
        ps.user_id,
        ps.total,
        ps.superq_pts,
        ps.duel_pts,
        ps.training_pts,
        ps.arena_pts,
        ROW_NUMBER() OVER (
          ORDER BY ps.total DESC, ps.scoring_user_id ASC
        ) AS rn,
        COUNT(CASE WHEN ps.total > 0 THEN 1 END) OVER () AS active_count,
        COUNT(CASE WHEN rn2 > 3 AND ps.total > 0 THEN 1 END) OVER () AS active_beyond_top3
      FROM (
        SELECT *, ROW_NUMBER() OVER (ORDER BY total DESC, scoring_user_id ASC) AS rn2
        FROM player_scores WHERE team_id = v_team_id
      ) ps
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
      ORDER BY cr.created_at DESC LIMIT 5
    )
    SELECT jsonb_build_object(
      'ok',         true,
      'week_start', v_week_start::text,
      'week_end',   v_week_end::text,
      'my_team', (
        SELECT jsonb_build_object(
          'id',                  v_team_id,
          'name',                v_team_name,
          'emoji',               v_team_emoji,
          'city',                v_team_city,
          'points',              COALESCE(mtr.points, 0),
          'global_rank',         mtr.global_rank,
          'city_rank',           mtr.city_rank,
          'total_global_teams',  mtr.total_global_teams,
          'total_city_teams',    mtr.total_city_teams,
          'top3_pts',            COALESCE(mtr.top3_pts, 0),
          'active_beyond',       COALESCE(mtr.active_beyond, 0),
          'participation_bonus', COALESCE(mtr.active_beyond, 0) * 5
        )
        FROM (SELECT * FROM my_team_row UNION ALL
              SELECT 0, NULL, NULL, NULL, NULL, 0, 0
              WHERE NOT EXISTS (SELECT 1 FROM my_team_row)
             ) mtr
        LIMIT 1
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


-- ──────────────────────────────────────────────────────────────────────────
-- §10  finalize_weekly_brain_fights(p_week_start date DEFAULT NULL)  (P0.8, P0.9)
--
-- EXPLICIT WEEK TARGETING (P0.9):
--   p_week_start IS NOT NULL → finalize exactly that week.
--     Validation: must be a Monday; week must have ended (week_start+7 <= today).
--   p_week_start IS NULL → finalize the most recently completed week:
--     v_week_start = current_monday - 7.
--     This is always safe: "current Monday" has arrived → that week is over.
--     Even if cron fires at 00:00:01 Monday, it targets the just-ended week.
--
-- CITY-FIRST RANKING (spec):
--   Teams ranked within their city first.
--   Points: 1st=100, 2nd=80, 3rd=60, 4th=40, 5th=20, 6th+=10.
--   Teams with 0 BF points: not included in challenge_results.
--   Teams without city: skipped (0 season points, no challenge_results row).
--   Idempotent: ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING.
--
-- NO DELETE (P0.8):
--   team_weekly_brain_fights and player_weekly_bf_points are pre-m76 legacy
--   scratch tables. They are NOT deleted here:
--   - brain_fight_contributions is the permanent authoritative ledger.
--   - New week starts because get_brain_fights_week() uses a new week_start
--     key, not because old rows are erased.
--   - Legacy table cleanup is a separate future migration.
--   LEGACY DEBT: team_weekly_brain_fights, player_weekly_bf_points (pre-m42)
--   are orphaned — no RPC in m76+ writes or reads them. Safe to DROP in a
--   future cleanup migration after confirming they have no active dependents.
--
-- TEAM FORMULA (same as get_brain_fights_week):
--   TEAM_BF = SUM(top-3 full BF) + 5 × active players from #4+.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_weekly_brain_fights(
  p_week_start date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today        date := (now() AT TIME ZONE 'UTC')::date;
  v_current_mon  date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_week_start   date;
  v_week_end     date;
  v_city_map     int[] := ARRAY[100, 80, 60, 40, 20, 10];
  v_row          record;
  v_pts          int;
BEGIN
  -- Determine and validate target week
  IF p_week_start IS NOT NULL THEN
    -- Validate: must be a Monday
    IF (EXTRACT(DOW FROM p_week_start)::int + 6) % 7 <> 0 THEN
      RAISE EXCEPTION 'p_week_start must be a Monday, got %', p_week_start;
    END IF;
    v_week_start := p_week_start;
  ELSE
    -- Default: previous complete week (always safe for Monday-boundary cron)
    v_week_start := v_current_mon - 7;
  END IF;

  v_week_end := v_week_start + 7;

  -- Validate: target week must be fully ended
  IF v_week_end > v_today THEN
    RAISE EXCEPTION 'Week % has not ended yet (ends %)', v_week_start, v_week_end;
  END IF;

  -- City-first ranking with spec points map
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
        CASE WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
          ROW_NUMBER() OVER (
            PARTITION BY lower(trim(t.city))
            ORDER BY tt.team_score DESC, tt.team_id ASC
          )::int
        END AS city_rank
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
      WHERE tt.team_score > 0           -- only teams with BF points
        AND t.city IS NOT NULL          -- only teams with city
        AND trim(t.city) <> ''
    )
    SELECT team_id, team_score, city, city_rank FROM city_ranked
    ORDER BY city, city_rank
  LOOP
    v_pts := CASE
      WHEN v_row.city_rank <= 5 THEN v_city_map[v_row.city_rank]
      ELSE 10
    END;

    INSERT INTO challenge_results
      (team_id, provider_id, challenge_type, rank, points_earned, week_start)
    VALUES
      (v_row.team_id, 'bfc_internal', 'brain_fights',
       v_row.city_rank, v_pts, v_week_start)
    ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING;
  END LOOP;
END;
$$;


-- ──────────────────────────────────────────────────────────────────────────
-- §11  get_question_reveals — block unresolved Daily BF questions; anon revoked (A4, P0)
--
-- Adds exclusion of questions currently assigned to the caller's open Daily BF
-- sessions (session_questions rows where is_correct IS NULL). Defense-in-depth:
-- start_daily_bf_session omits correct_index AND q_id from payload, but this
-- prevents reveals via get_question_reveals during an active session.
--
-- SECURITY (P0): GRANT restricted to authenticated only.
-- An authenticated player calling as anon (auth.uid()=NULL) cannot bypass:
-- anon is no longer granted EXECUTE on this function.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_question_reveals(p_ids uuid[])
RETURNS TABLE(id uuid, correct_index int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.id, q.correct_index
  FROM questions q
  WHERE q.id = ANY(p_ids)
    AND q.is_competitive_secret = false
    -- Block questions in live Weekly Arena
    AND q.id NOT IN (
      SELECT waq.question_id
      FROM weekly_arena_questions waq
      JOIN weekly_arenas wa ON wa.id = waq.arena_id
      WHERE now() < wa.ends_at
    )
    -- Block questions assigned to active duels
    AND q.id NOT IN (
      SELECT dqa.question_id
      FROM duel_question_assignments dqa
      JOIN duel_rooms dr ON dr.code = dqa.duel_code
      WHERE dr.status = 'started'
    )
    -- Block questions in caller's unresolved Daily BF sessions (A4)
    AND q.id NOT IN (
      SELECT sq.question_id
      FROM session_questions sq
      JOIN game_sessions gs ON gs.id = sq.session_id
      WHERE gs.user_id = auth.uid()
        AND gs.mode    = 'training'
        AND sq.is_correct IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.get_question_reveals(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_question_reveals(uuid[]) TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §12  game_sessions.bf_eligible column  (P4, BLOCKER 1 FIX)
--
-- Persists BF eligibility at session creation time.
-- Eligibility is determined under the user/day advisory lock in
-- start_daily_bf_session(), checking existing game_sessions rows.
-- The FIRST session of the day gets bf_eligible=true; all subsequent sessions
-- (including Premium extras started before the first completes) get false.
-- complete_daily_bf_session() verifies this flag before awarding BF.
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE public.game_sessions
  ADD COLUMN IF NOT EXISTS bf_eligible boolean DEFAULT false;


-- ──────────────────────────────────────────────────────────────────────────
-- §13  claim_random_match()  (B1, B2, B3, BLOCKER 2 FIX)
--      Atomic server-side random battle matchmaking
--
-- Replaces client-side duel_rooms.insert() + matchmaking_queue.update().
--
-- CONCURRENCY (BLOCKER 2): Single transaction-level advisory lock on the
--   'bfc_random_matchmaking' key serializes ALL pairing operations globally.
--   FOR UPDATE SKIP LOCKED alone was insufficient: two callers could each lock
--   the other as opponent, creating reciprocal duels. The advisory lock
--   makes pairing strictly sequential at v1 scale.
--
-- FLOW (under advisory lock):
--   1. Re-read caller's own row — verify still status='waiting'.
--   2. Find one other waiting row.
--   3. If found: generate duel code (with INSERT retry on collision),
--      create canonical duel_rooms row, update both queue rows → matched.
--      Return {ok:true, matched:true, role:'host', duel_code, opponent_name}.
--   4. If not found: return {ok:true, matched:false} — caller stays waiting.
--
-- CLIENT FLOW after matched=true:
--   role='host': call start_duel(duel_code) via canonical m78 RPC.
--   Opponent's next claim_random_match() tick finds its row status='matched'
--   and returns role='guest' + canonical duel fields immediately.
--
-- SECURITY: SECURITY DEFINER — bypasses RLS for duel_rooms and matchmaking_queue.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_random_match()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid          uuid := auth.uid();
  v_my_row       matchmaking_queue%ROWTYPE;
  v_opp_row      matchmaking_queue%ROWTYPE;
  v_duel         duel_rooms%ROWTYPE;
  v_duel_code    text;
  v_my_name      text;
  v_role         text;
  v_opp_name     text;
  v_attempt      int := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Serialize all pairing operations under a single advisory lock.
  PERFORM pg_advisory_xact_lock(hashtext('bfc_random_matchmaking'));

  -- Re-read caller's LATEST active queue row under lock (DESC = newest wins).
  -- Include 'matched': guest's row is already 'matched' after host paired them;
  -- returning the existing duel avoids guest staying stuck until 15s timeout.
  -- DESC ensures a new 'waiting' row beats any old 'matched' row from a prior battle.
  SELECT * INTO v_my_row
  FROM matchmaking_queue
  WHERE user_id = v_uid
    AND status IN ('waiting', 'matched')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No active queue row — cancelled or never queued
    RETURN jsonb_build_object('ok', false, 'reason', 'not_in_queue');
  END IF;

  -- If caller is already matched, return canonical duel state immediately.
  -- Role is derived server-side from duel_rooms — never inferred by client.
  IF v_my_row.status = 'matched' THEN
    SELECT * INTO v_duel
    FROM duel_rooms
    WHERE code = v_my_row.matched_duel_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duel_not_found');
    END IF;

    IF v_duel.host_user_id = v_uid THEN
      v_role     := 'host';
      v_opp_name := v_duel.guest_name;
    ELSE
      v_role     := 'guest';
      v_opp_name := v_duel.host_name;
    END IF;

    RETURN jsonb_build_object(
      'ok',            true,
      'matched',       true,
      'role',          v_role,
      'duel_code',     v_duel.code,
      'opponent_name', v_opp_name
    );
  END IF;

  -- status='waiting': attempt normal atomic pairing
  v_my_name := v_my_row.display_name;

  SELECT * INTO v_opp_row
  FROM matchmaking_queue
  WHERE status  = 'waiting'
    AND user_id <> v_uid
  ORDER BY created_at ASC
  LIMIT 1;

  IF NOT FOUND THEN
    -- No opponent yet — caller stays waiting
    RETURN jsonb_build_object('ok', true, 'matched', false);
  END IF;

  -- Generate duel code, retry on collision
  LOOP
    v_duel_code := upper(substring(md5(random()::text || clock_timestamp()::text), 1, 6));
    v_attempt   := v_attempt + 1;
    BEGIN
      INSERT INTO duel_rooms (
        code, host_user_id, guest_user_id,
        host_name, guest_name,
        host_score, guest_score,
        status, created_at
      ) VALUES (
        v_duel_code, v_uid, v_opp_row.user_id,
        v_my_name, v_opp_row.display_name,
        0, 0,
        'ready', now()
      );
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      IF v_attempt >= 5 THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'code_collision_exhausted');
      END IF;
    END;
  END LOOP;

  UPDATE matchmaking_queue
  SET status = 'matched', matched_duel_id = v_duel_code
  WHERE id IN (v_my_row.id, v_opp_row.id);

  -- Caller is host (created the duel); opponent will receive role='guest' on its next tick
  RETURN jsonb_build_object(
    'ok',            true,
    'matched',       true,
    'role',          'host',
    'duel_code',     v_duel_code,
    'opponent_name', v_opp_row.display_name
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_random_match() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.claim_random_match() TO authenticated;


-- ──────────────────────────────────────────────────────────────────────────
-- §14  cancel_random_matchmaking()  (BLOCKER 3)
--      Canonical server-side queue cancellation
--
-- Replaces all direct matchmaking_queue.update({status:'cancelled'}) client calls.
-- Uses the SAME advisory lock as claim_random_match() to prevent the race where
-- the server matches a row at second 14.9 and the client cancels it at second 15.
--
-- FLOW (under advisory lock):
--   - Caller's row status='waiting':
--       UPDATE to 'cancelled'
--       Return {ok:true, cancelled:true, matched:false}
--   - Caller's row status='matched':
--       DO NOT cancel — return duel_code and opponent so client enters real match
--       Return {ok:true, cancelled:false, matched:true, duel_code, opponent_name}
--   - No queue row found: Return {ok:true, cancelled:false, matched:false}
--
-- CLIENT MUST: on matched=true → enter real match, do NOT show virtual opponents.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_random_matchmaking()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_row      matchmaking_queue%ROWTYPE;
  v_duel     duel_rooms%ROWTYPE;
  v_role     text;
  v_opp_name text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Same advisory lock as claim_random_match — prevents cancel racing a match
  PERFORM pg_advisory_xact_lock(hashtext('bfc_random_matchmaking'));

  -- Find any active queue row for this caller
  SELECT * INTO v_row
  FROM matchmaking_queue
  WHERE user_id = v_uid
    AND status IN ('waiting', 'matched')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'cancelled', false, 'matched', false);
  END IF;

  IF v_row.status = 'matched' THEN
    -- Server already matched this player — do NOT cancel.
    -- Resolve role and opponent_name from canonical duel_rooms row.
    SELECT * INTO v_duel
    FROM duel_rooms
    WHERE code = v_row.matched_duel_id
    LIMIT 1;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'reason', 'duel_not_found');
    END IF;

    IF v_duel.host_user_id = v_uid THEN
      v_role     := 'host';
      v_opp_name := v_duel.guest_name;
    ELSE
      v_role     := 'guest';
      v_opp_name := v_duel.host_name;
    END IF;

    RETURN jsonb_build_object(
      'ok',            true,
      'cancelled',     false,
      'matched',       true,
      'role',          v_role,
      'duel_code',     v_duel.code,
      'opponent_name', v_opp_name
    );
  END IF;

  -- status='waiting' — safe to cancel
  UPDATE matchmaking_queue
  SET status = 'cancelled'
  WHERE id = v_row.id;

  RETURN jsonb_build_object('ok', true, 'cancelled', true, 'matched', false);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_random_matchmaking() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.cancel_random_matchmaking() TO authenticated;


COMMIT;

-- ════════════════════════════════════════════════════════════════════════════
-- CANONICAL BF SOURCE TABLE (migration 82 final state)
-- ────────────────────────────────────────────────────────────────────────────
-- source_type    status   points                           cap
-- ────────────────────────────────────────────────────────────────────────────
-- training       ACTIVE   +1/correct answer                max 10 BF/day
-- duel           ACTIVE   +3/win                           max 3 wins/day = 9 BF
-- superq         ACTIVE   +5 correct / +1 attempt          1/day (m76 unchanged)
-- weekly_arena   ACTIVE   2 + perf(0-10) + place(0/2/3/5) 1/arena via finalize
-- ────────────────────────────────────────────────────────────────────────────
-- TEAM FORMULA:  SUM(top-3 full BF) + 5 × active players from #4+
-- FINALIZATION:  city-first RANK() on team_score; points [100,80,60,40,20,10]
-- WEEK KEY:      Monday UTC; new week starts by key change, not data deletion
-- LEGACY DEBT:   team_weekly_brain_fights, player_weekly_bf_points — orphaned
--                pre-m76 scratch tables. Safe to DROP in a future migration.
-- ════════════════════════════════════════════════════════════════════════════
