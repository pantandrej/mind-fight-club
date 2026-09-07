-- ══════════════════════════════════════════════════════════════════
-- Migration 76: Brain Fights Authority  (DRAFT — DO NOT APPLY)
-- "Client requests. Server decides."
--
-- ── Migration 60 finalization semantics (preserved exactly) ──────
-- finalize_weekly_brain_fights() in migration 60 uses GLOBAL ranking:
--   ORDER BY points DESC (all teams, no city partitioning).
-- Points map: ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5]
-- Migration 76 preserves BOTH of these unchanged.
-- Note: the claim "migration 60 finalized within city" does NOT match
-- the actual SQL in migration 60 — no city column is referenced there.
--
-- ── Security problems fixed ───────────────────────────────────────
-- P0.1  "pwbf_own FOR ALL" — authenticated users could UPDATE
--       player_weekly_bf_points.superq_pts directly.
-- P0.2  record_superq_bf(uuid, boolean) was publicly executable —
--       client controlled p_correct argument.
-- P0.3  record_training_bf / record_duel_win_bf also directly
--       callable; record_duel_win_bf accepted arbitrary p_user_id.
-- P0.4  "qda_own FOR ALL" on quiz_daily_answers allowed DELETE —
--       player could delete answer, replay, earn BF again.
-- P0.5  sync_team_brain_fights_daily included duel_pts (client
--       self-reported via client-writable duel_rooms).
-- P0.6  sync used profiles.team_id at sync time, not at contribution
--       time — team switch mid-week re-attributed historical points.
-- P0.7  finalize was not idempotent; retry could duplicate rows.
-- P0.8  (new) Alias bug in finalize team_totals CTE: inner subquery
--       aliased as `x` but outer referenced `ps`.
-- P0.9  (new) brain_fight_contributions.user_id ON DELETE CASCADE
--       would retroactively erase team score on account deletion.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- §1  player_weekly_bf_points — remove client write policy (P0.1)
--
-- Before: "pwbf_own" FOR ALL → INSERT/UPDATE/DELETE by row owner.
-- After:  SELECT only via existing "pwbf_read" FOR SELECT USING (true).
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pwbf_own" ON public.player_weekly_bf_points;
-- "pwbf_read" FOR SELECT USING (true) remains unchanged.


-- ──────────────────────────────────────────────────────────────────
-- §2  quiz_daily_answers — prevent client DELETE; no client INSERT (P0.4, P0.7)
--
-- Before: "qda_own" FOR ALL → owner could DELETE their answer,
--   then re-answer the same question (replay attack).
-- Active call sites investigated:
--   quiz-daily-question.js:35 — direct SELECT (read existing answer for UI display).
--   quiz-daily-question.js:130 — calls answer_quiz_daily_question() RPC (SECURITY DEFINER).
--   No direct client INSERT exists.
-- After:
--   SELECT only (for UI to read own answer).
--   No INSERT/UPDATE/DELETE client policies — all writes via RPC.
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "qda_own"        ON public.quiz_daily_answers;
DROP POLICY IF EXISTS "qda_own_insert" ON public.quiz_daily_answers;  -- clean up draft 64644ad
DROP POLICY IF EXISTS "qda_own_select" ON public.quiz_daily_answers;  -- clean up draft 64644ad
CREATE POLICY "qda_own_select" ON public.quiz_daily_answers
  FOR SELECT USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policies.
-- quiz_daily_answers inserts happen inside SECURITY DEFINER function (bypasses RLS).


-- ──────────────────────────────────────────────────────────────────
-- §3  REVOKE direct-execute on all BF scoring RPCs (P0.2, P0.3)
-- ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.record_superq_bf(uuid, boolean)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_training_bf(uuid, integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_duel_win_bf(uuid)           FROM PUBLIC, anon, authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §4  brain_fight_contributions — immutable contribution ledger
--
-- Design decisions:
--   user_id nullable, ON DELETE SET NULL (P0.9):
--     Account deletion sets user_id = NULL but the contribution row
--     survives. team_id, points, week_start, source_type, source_id
--     remain for team score integrity. Deleted user is not personally
--     identifiable. Display queries filter user_id IS NOT NULL.
--     Edge-case: multi-day contributions from a deleted user within
--     the same week each count as a separate player in the top-3
--     formula (we lose the cross-day grouping after deletion).
--     This is accepted for v1 — the case is rare and the effect
--     slightly benefits the team (more participation points).
--
--   activity_date (P0-new):
--     Server-set UTC date of the contribution. Enables UNIQUE
--     (user_id, source_type, activity_date) to enforce exactly one
--     BF award per user per UTC day, even if two different approved
--     question UUIDs share the same scheduled_date. DB constraint is
--     the concurrency-safe enforcement; ON CONFLICT DO NOTHING in
--     the INSERT detects duplicate-day races.
--
--   source_id retained:
--     Audit reference to the actual question answered, even when
--     the daily UNIQUE fires and bf_pts = 0 for a second question.
--     The source_id uniqueness constraint (per-question idempotency)
--     remains as belt-and-suspenders.
--
--   No client SELECT:
--     RLS enabled, no SELECT policy → clients cannot read raw
--     contribution events. Frontend receives only scoped aggregates
--     through get_brain_fights_week() SECURITY DEFINER.
--     SECURITY DEFINER functions bypass RLS and can read/write freely.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brain_fight_contributions (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid                 REFERENCES public.profiles(id)  ON DELETE SET NULL,
  team_id       uuid                 REFERENCES public.teams(id)      ON DELETE SET NULL,
  week_start    date        NOT NULL,
  source_type   text        NOT NULL CHECK (source_type IN ('superq')), -- 'duel'/'training' disabled
  source_id     uuid        NOT NULL,   -- quiz_daily_questions.id for 'superq'
  activity_date date        NOT NULL,   -- server-set UTC date; never client-supplied
  points        integer     NOT NULL CHECK (points > 0),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bfc_source_unique UNIQUE (user_id, source_type, source_id),
  CONSTRAINT bfc_daily_unique  UNIQUE (user_id, source_type, activity_date)
);

CREATE INDEX IF NOT EXISTS idx_bfc_user_week   ON public.brain_fight_contributions(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_team_week   ON public.brain_fight_contributions(team_id, week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_week        ON public.brain_fight_contributions(week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_activity    ON public.brain_fight_contributions(user_id, source_type, activity_date);

ALTER TABLE public.brain_fight_contributions ENABLE ROW LEVEL SECURITY;
-- No policies: RLS blocks all client reads/writes.
-- SECURITY DEFINER functions bypass RLS entirely.


-- ──────────────────────────────────────────────────────────────────
-- §5  challenge_results — week_start + idempotency constraint
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.challenge_results
  ADD COLUMN IF NOT EXISTS week_start date;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'cr_bf_team_week_unique'
      AND conrelid = 'public.challenge_results'::regclass
  ) THEN
    ALTER TABLE public.challenge_results
      ADD CONSTRAINT cr_bf_team_week_unique
      UNIQUE (team_id, challenge_type, week_start);
  END IF;
END;
$$;


-- ──────────────────────────────────────────────────────────────────
-- §6  answer_quiz_daily_question — hardened, writes to ledger
--
-- Server determines: correctness (from canonical answer_text),
--   points (5 correct / 1 wrong), week_start, team_id (at answer time),
--   activity_date (server UTC).
-- Client supplies: question_id and raw answer text only.
-- Dual idempotency:
--   1. quiz_daily_answers pre-check (same question, same user).
--   2. bfc_daily_unique constraint ON CONFLICT (different questions, same day).
-- GET DIAGNOSTICS detects if BF was actually awarded (0 if conflict).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.answer_quiz_daily_question(
  p_question_id uuid,
  p_answer_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid        := auth.uid();
  v_question   quiz_daily_questions%ROWTYPE;
  v_is_correct boolean;
  v_bf_pts     integer;
  v_team_id    uuid;
  v_today      date        := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date;
  v_rows       integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Primary idempotency: this question already answered by this user
  IF EXISTS (
    SELECT 1 FROM quiz_daily_answers
    WHERE question_id = p_question_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Server loads and verifies question: approved + scheduled for today
  SELECT * INTO v_question FROM quiz_daily_questions
  WHERE id = p_question_id
    AND status = 'approved'
    AND scheduled_date = v_today;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Server derives correctness — client supplies raw text only, no p_correct
  v_is_correct := lower(trim(p_answer_text)) = lower(trim(v_question.answer_text));

  -- Server determines BF points
  v_bf_pts     := CASE WHEN v_is_correct THEN 5 ELSE 1 END;

  -- Server determines canonical week_start (Monday 00:00 UTC)
  v_week_start := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);

  -- Server looks up team membership at the moment of this answer
  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_user_id;

  -- Only attribute to active (non-disbanded) teams
  IF v_team_id IS NOT NULL THEN
    SELECT t.id INTO v_team_id FROM teams t
    WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
    -- If disbanded: v_team_id → NULL; contribution recorded but unattributed
  END IF;

  -- Concurrency-safe answer recording: ON CONFLICT handles simultaneous same-question calls
  INSERT INTO quiz_daily_answers (question_id, user_id, answer_text, is_correct)
  VALUES (p_question_id, v_user_id, p_answer_text, v_is_correct)
  ON CONFLICT (question_id, user_id) DO NOTHING;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    -- Concurrent call already recorded this answer; safe early return
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Write immutable contribution ledger entry.
  -- ON CONFLICT bfc_daily_unique: different question answered same UTC day
  --   → DO NOTHING (daily BF already awarded); bf_pts set to 0 below.
  -- ON CONFLICT bfc_source_unique: would only occur in race condition
  --   (pre-check already guards this; this INSERT is unreachable in that case).
  INSERT INTO brain_fight_contributions (
    user_id, team_id, week_start, source_type, source_id,
    activity_date, points, occurred_at
  ) VALUES (
    v_user_id, v_team_id, v_week_start, 'superq', p_question_id,
    v_today, v_bf_pts, now()
  )
  ON CONFLICT DO NOTHING;  -- handles both bfc_source_unique and bfc_daily_unique

  -- Detect whether BF was actually awarded (0 rows = conflict = already earned today)
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN v_bf_pts := 0; END IF;

  -- Update backward-compat cache (player_weekly_bf_points — server-only after §1+§3)
  IF v_rows > 0 THEN
    PERFORM record_superq_bf(v_user_id, v_is_correct);
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'is_correct',     v_is_correct,
    'bf_pts',         v_bf_pts,
    'correct_answer', CASE WHEN NOT v_is_correct THEN v_question.answer_text ELSE NULL END
  );
END;
$$;


-- ──────────────────────────────────────────────────────────────────
-- §7  get_brain_fights_week() — authoritative read RPC
--
-- Single call aggregates from brain_fight_contributions (superq only).
-- Returns everything the BF screen needs; no staleness from cron cache.
-- Exposed fields: team name/emoji/city, aggregated points, ranks.
-- Not exposed: join_code, treasury, raw contribution events, timestamps.
-- Authenticated only; no anon access.
--
-- Scoring:
--   Team score = sum of top-3 player totals
--               + 1 per additional player with >0 points.
-- Grouping for deleted users:
--   COALESCE(user_id, id) used as effective_player_id.
--   Deleted users (user_id=NULL) each count as distinct player per row.
-- City rank:
--   Server-computed via PARTITION BY lower(trim(city)).
--   NULL/empty city → city_rank and total_city_teams are NULL.
-- My contribution:
--   Filtered to current team only (bfc.team_id = v_team_id).
--   After mid-week team switch, only current-team contributions shown.
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
  v_disbanded  timestamptz;
BEGIN
  v_week_end := v_week_start + 7;

  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_team');
  END IF;

  SELECT t.disbanded_at INTO v_disbanded FROM teams t WHERE t.id = v_team_id;
  IF v_disbanded IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'disbanded');
  END IF;

  RETURN (
    WITH
    -- Per-effective-player scores (COALESCE handles deleted-user rows)
    player_scores AS (
      SELECT
        COALESCE(bfc.user_id, bfc.id)  AS effective_player_id,
        bfc.user_id,
        bfc.team_id,
        SUM(bfc.points)                AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       IS NOT NULL
        AND bfc.source_type   = 'superq'
      GROUP BY COALESCE(bfc.user_id, bfc.id), bfc.user_id, bfc.team_id
    ),
    -- Apply team formula: top-3 fully, each beyond with >0 pts → +1
    team_totals AS (
      SELECT
        ranked.team_id,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END)
          + COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int AS team_pts
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY team_id ORDER BY total DESC
               ) AS rn
        FROM player_scores
      ) ranked
      GROUP BY ranked.team_id
    ),
    -- Global + city ranks, all computed server-side
    ranked_lb AS (
      SELECT
        tt.team_id,
        tt.team_pts                                                      AS points,
        ROW_NUMBER() OVER (ORDER BY tt.team_pts DESC)::int               AS global_rank,
        COUNT(*) OVER ()::int                                             AS total_global_teams,
        CASE
          WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(t.city))
              ORDER BY tt.team_pts DESC
            )::int
          ELSE NULL
        END                                                               AS city_rank,
        CASE
          WHEN t.city IS NOT NULL AND trim(t.city) <> '' THEN
            COUNT(*) OVER (PARTITION BY lower(trim(t.city)))::int
          ELSE NULL
        END                                                               AS total_city_teams,
        t.name,
        t.emoji,
        t.city
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
    ),
    -- My team's score and ranks
    my_team_row AS (
      SELECT rl.points, rl.global_rank, rl.city_rank,
             rl.total_global_teams, rl.total_city_teams
      FROM ranked_lb rl
      WHERE rl.team_id = v_team_id
    ),
    -- My verified BF contributions for THIS TEAM this week (not cross-team)
    my_contrib AS (
      SELECT COALESCE(SUM(bfc.points), 0) AS superq_pts
      FROM brain_fight_contributions bfc
      WHERE bfc.user_id     = v_uid
        AND bfc.team_id     = v_team_id
        AND bfc.week_start  = v_week_start
        AND bfc.source_type = 'superq'
    ),
    -- Display contributors for this team (active users only, for profile JOIN)
    display_contributors AS (
      SELECT
        ps.user_id,
        ps.total                                                            AS points,
        pr.display_name,
        pr.avatar_url,
        ROW_NUMBER() OVER (ORDER BY ps.total DESC)::int                     AS rn
      FROM player_scores ps
      JOIN profiles pr ON pr.id = ps.user_id
      WHERE ps.team_id  = v_team_id
        AND ps.user_id IS NOT NULL
    ),
    -- Historical BF results for this team
    hist AS (
      SELECT cr.rank, cr.points_earned, cr.created_at
      FROM challenge_results cr
      WHERE cr.team_id        = v_team_id
        AND cr.challenge_type = 'brain_fights'
      ORDER BY cr.created_at DESC
      LIMIT 5
    ),
    -- Team metadata
    team_info AS (
      SELECT t.id, t.name, t.emoji, t.city
      FROM teams t WHERE t.id = v_team_id
    )
    SELECT jsonb_build_object(
      'ok',         true,
      'week_start', v_week_start::text,
      'week_end',   v_week_end::text,
      'my_team', (
        SELECT jsonb_build_object(
          'id',                ti.id,
          'name',              ti.name,
          'emoji',             ti.emoji,
          'city',              ti.city,
          'points',            COALESCE(mtr.points, 0),
          'global_rank',       mtr.global_rank,
          'city_rank',         mtr.city_rank,
          'total_global_teams', mtr.total_global_teams,
          'total_city_teams',  mtr.total_city_teams
        )
        FROM team_info ti
        LEFT JOIN my_team_row mtr ON true
      ),
      'my_contrib', (
        SELECT jsonb_build_object(
          'superq_pts', mc.superq_pts,
          'total',      mc.superq_pts
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
            'team_id',         rl.team_id,
            'name',            rl.name,
            'emoji',           rl.emoji,
            'city',            rl.city,
            'points',          rl.points,
            'global_rank',     rl.global_rank,
            'city_rank',       rl.city_rank,
            'is_my_team',      rl.team_id = v_team_id
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
GRANT EXECUTE ON FUNCTION public.get_brain_fights_week() TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §8  sync_team_brain_fights_daily — aggregate from ledger (P0.5, P0.6)
--
-- Aggregates from brain_fight_contributions (source_type='superq' only).
-- team_id is immutably captured at contribution time — no team-switch bug.
-- COALESCE(user_id, id) groups deleted-user contributions per row
-- (same edge-case limitation as get_brain_fights_week; accepted for v1).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sync_team_brain_fights_daily()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_team       record;
  v_top3_pts   integer;
  v_mass_pts   integer;
BEGIN
  FOR v_team IN SELECT id FROM teams WHERE disbanded_at IS NULL LOOP
    WITH player_scores AS (
      SELECT
        COALESCE(bfc.user_id, bfc.id) AS effective_player_id,
        SUM(bfc.points)               AS total,
        ROW_NUMBER() OVER (ORDER BY SUM(bfc.points) DESC)::int AS rn
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       = v_team.id
        AND bfc.source_type   = 'superq'
      GROUP BY COALESCE(bfc.user_id, bfc.id)
    )
    SELECT
      COALESCE(SUM(CASE WHEN rn <= 3 THEN total ELSE 0 END), 0),
      COALESCE(COUNT(CASE WHEN rn > 3 AND total > 0 THEN 1 END)::int, 0)
    INTO v_top3_pts, v_mass_pts
    FROM player_scores;

    INSERT INTO team_weekly_brain_fights (team_id, week_start, points)
    VALUES (v_team.id, v_week_start, COALESCE(v_top3_pts, 0) + COALESCE(v_mass_pts, 0))
    ON CONFLICT (team_id, week_start)
    DO UPDATE SET
      points     = COALESCE(v_top3_pts, 0) + COALESCE(v_mass_pts, 0),
      updated_at = now();
  END LOOP;
END;
$$;


-- ──────────────────────────────────────────────────────────────────
-- §9  finalize_weekly_brain_fights — idempotent, correct attribution (P0.7, P0.8)
--
-- Fixes:
--   P0.8: CTE alias bug — inner subquery was aliased 'x' but outer
--     referenced 'ps'. Fixed: inner alias changed to 'ranked' throughout.
--   P0.7: idempotent via ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique.
--   Source: aggregates from brain_fight_contributions (superq only).
--   brain_fight_contributions is NOT deleted (permanent audit trail).
--   team_weekly_brain_fights + player_weekly_bf_points caches are cleared.
--
-- Preserved from migration 60:
--   Global ranking (ORDER BY team_score DESC, no city partitioning).
--   Points map: ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5].
--   Teams without city are included in the same global ranking.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.finalize_weekly_brain_fights()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_today      date    := (now() AT TIME ZONE 'UTC')::date;
  v_week_start date    := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);
  v_rank       integer := 1;
  v_points_map int[]   := ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5];  -- unchanged from migration 60
  v_pts        integer;
  v_row        record;
BEGIN
  PERFORM sync_team_brain_fights_daily();

  -- Compute global standings from immutable ledger (superq only)
  FOR v_row IN
    WITH player_scores AS (
      SELECT
        COALESCE(bfc.user_id, bfc.id) AS effective_player_id,
        bfc.team_id,
        SUM(bfc.points)               AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       IS NOT NULL
        AND bfc.source_type   = 'superq'
      GROUP BY COALESCE(bfc.user_id, bfc.id), bfc.team_id
    ),
    team_totals AS (
      SELECT
        ranked.team_id,
        SUM(CASE WHEN ranked.rn <= 3 THEN ranked.total ELSE 0 END)
          + COUNT(CASE WHEN ranked.rn > 3 AND ranked.total > 0 THEN 1 END)::int AS team_score
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                 PARTITION BY team_id ORDER BY total DESC
               ) AS rn
        FROM player_scores
      ) ranked
      GROUP BY ranked.team_id
    )
    SELECT team_id, team_score
    FROM team_totals
    WHERE team_score > 0
    ORDER BY team_score DESC  -- global ranking, same as migration 60
  LOOP
    v_pts := CASE
      WHEN v_rank <= array_length(v_points_map, 1) THEN v_points_map[v_rank]
      ELSE 0
    END;

    IF v_pts > 0 THEN
      -- Idempotent: ON CONFLICT cr_bf_team_week_unique (team_id, challenge_type, week_start)
      INSERT INTO challenge_results
        (team_id, provider_id, challenge_type, rank, points_earned, week_start)
      VALUES
        (v_row.team_id, 'bfc_internal', 'brain_fights', v_rank, v_pts, v_week_start)
      ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING;
    END IF;

    v_rank := v_rank + 1;
  END LOOP;

  -- Clear rolling caches only; brain_fight_contributions is permanent
  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
END;
$$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- POLICY STATE BEFORE / AFTER
--
-- player_weekly_bf_points:
--   BEFORE: "pwbf_own" FOR ALL + "pwbf_read" FOR SELECT
--   AFTER:  "pwbf_read" FOR SELECT only
--
-- quiz_daily_answers:
--   BEFORE: "qda_own" FOR ALL (owner could DELETE)
--   AFTER:  "qda_own_select" FOR SELECT only (answers immutable)
--
-- brain_fight_contributions (new table):
--   No policies — RLS blocks all client access (read and write).
--   SECURITY DEFINER functions bypass RLS.
--
-- team_weekly_brain_fights:
--   UNCHANGED — already "twbf_read" FOR SELECT only (migration 42).
--
-- Revoked:
--   EXECUTE on record_superq_bf, record_training_bf, record_duel_win_bf
--   from PUBLIC, anon, authenticated.
--
-- Added:
--   get_brain_fights_week() EXECUTE granted to authenticated only.
-- ══════════════════════════════════════════════════════════════════
