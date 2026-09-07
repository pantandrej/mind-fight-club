-- ══════════════════════════════════════════════════════════════════
-- Migration 76: Brain Fights Authority
-- "Client requests. Server decides."
--
-- DO NOT APPLY without explicit approval.
--
-- Security problems fixed:
--   P0.1  player_weekly_bf_points "pwbf_own FOR ALL" allowed any
--         authenticated user to directly UPDATE/INSERT/DELETE their own
--         BF points row (e.g. SET superq_pts = 9999).
--   P0.2  record_superq_bf(uuid, boolean) was executable by any
--         authenticated user directly — client controlled p_correct.
--   P0.3  record_training_bf / record_duel_win_bf also executable
--         directly; record_duel_win_bf took p_user_id allowing
--         any player to award BF points to another user's row.
--   P0.4  quiz_daily_answers "qda_own FOR ALL" allowed DELETE —
--         player could delete their answer then call
--         answer_quiz_daily_question again (replay attack).
--   P0.5  Duel pts (client self-reported) contaminated official
--         team BF score via sync_team_brain_fights_daily.
--   P0.6  sync_team_brain_fights_daily used profiles.team_id at
--         sync time — team switch mid-week re-attributed old points.
--   P0.7  finalize_weekly_brain_fights was not idempotent; could
--         duplicate challenge_results on retry.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ──────────────────────────────────────────────────────────────────
-- §1  player_weekly_bf_points — REMOVE CLIENT WRITE POLICY (P0.1)
--
-- Before: "pwbf_own" FOR ALL USING (user_id = auth.uid())
--   → authenticated user could: UPDATE SET superq_pts = 9999
-- After: SELECT only via "pwbf_read" (already exists, unchanged).
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "pwbf_own" ON public.player_weekly_bf_points;
-- "pwbf_read" FOR SELECT USING (true) remains as-is.


-- ──────────────────────────────────────────────────────────────────
-- §2  quiz_daily_answers — PREVENT CLIENT DELETE (P0.4 replay attack)
--
-- Before: "qda_own" FOR ALL → player could DELETE own answer row,
--   then call answer_quiz_daily_question again to earn points twice.
-- After: INSERT + SELECT only. Answers are immutable from client side.
-- ──────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "qda_own" ON public.quiz_daily_answers;
CREATE POLICY "qda_own_insert" ON public.quiz_daily_answers
  FOR INSERT WITH CHECK (user_id = auth.uid());
CREATE POLICY "qda_own_select" ON public.quiz_daily_answers
  FOR SELECT USING (user_id = auth.uid());
-- No UPDATE or DELETE policies — client answers are immutable.


-- ──────────────────────────────────────────────────────────────────
-- §3  REVOKE direct-execute on all BF scoring RPCs (P0.2, P0.3)
--
-- These must only be called server-side from SECURITY DEFINER
-- functions (answer_quiz_daily_question → record_superq_bf).
-- ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.record_superq_bf(uuid, boolean)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_training_bf(uuid, integer)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_duel_win_bf(uuid)           FROM PUBLIC, anon, authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §4  brain_fight_contributions — immutable contribution ledger
--
-- Each verified BF contribution is a permanent row.
-- Server sets: team_id (from membership at answer time), week_start,
--              source_type, points.
-- Client cannot INSERT/UPDATE/DELETE (no policies for writes).
-- team_id is captured at contribution time; subsequent team changes
-- do NOT move historical contributions (P0.6 fix).
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.brain_fight_contributions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES public.profiles(id)  ON DELETE CASCADE,
  team_id      uuid                 REFERENCES public.teams(id)      ON DELETE SET NULL,
  week_start   date        NOT NULL,
  source_type  text        NOT NULL CHECK (source_type IN ('superq')), -- 'duel'/'training' disabled
  source_id    uuid        NOT NULL,  -- quiz_daily_questions.id for 'superq'
  points       integer     NOT NULL CHECK (points > 0),
  occurred_at  timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id)  -- idempotency key
);

CREATE INDEX IF NOT EXISTS idx_bfc_user_week ON public.brain_fight_contributions(user_id, week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_team_week ON public.brain_fight_contributions(team_id, week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_week      ON public.brain_fight_contributions(week_start);
CREATE INDEX IF NOT EXISTS idx_bfc_source    ON public.brain_fight_contributions(source_type, source_id);

ALTER TABLE public.brain_fight_contributions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "bfc_read" ON public.brain_fight_contributions;
CREATE POLICY "bfc_read" ON public.brain_fight_contributions
  FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies — all writes are server-only.


-- ──────────────────────────────────────────────────────────────────
-- §5  challenge_results — add week_start for idempotent finalization
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.challenge_results
  ADD COLUMN IF NOT EXISTS week_start date;

-- Unique constraint enables ON CONFLICT DO NOTHING in finalize.
-- Existing NULL rows (from pre-76 finalizations) are unaffected
-- because NULL != NULL in UNIQUE constraints.
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
-- §6  answer_quiz_daily_question — write to contribution ledger
--
-- Already server-derives correctness (no p_correct input).
-- New: also writes to brain_fight_contributions with server-set
--      team_id (membership at moment of answer), week_start, points.
-- Dual idempotency: contribution ledger uniqueness + quiz_daily_answers.
-- The contribution ledger check is primary (cannot be deleted by client).
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
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Primary idempotency via contribution ledger (client cannot delete this)
  IF EXISTS (
    SELECT 1 FROM brain_fight_contributions
    WHERE user_id = v_user_id AND source_type = 'superq' AND source_id = p_question_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Belt-and-suspenders: also check quiz_daily_answers
  IF EXISTS (
    SELECT 1 FROM quiz_daily_answers
    WHERE question_id = p_question_id AND user_id = v_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Server verifies question: must be approved and scheduled for today
  SELECT * INTO v_question FROM quiz_daily_questions
  WHERE id = p_question_id
    AND status = 'approved'
    AND scheduled_date = v_today;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Server derives correctness — client supplies only raw answer text
  v_is_correct := lower(trim(p_answer_text)) = lower(trim(v_question.answer_text));

  -- Record answer (INSERT-only policy after §2 — cannot be deleted by client)
  INSERT INTO quiz_daily_answers (question_id, user_id, answer_text, is_correct)
  VALUES (p_question_id, v_user_id, p_answer_text, v_is_correct);

  -- Server determines points
  v_bf_pts := CASE WHEN v_is_correct THEN 5 ELSE 1 END;

  -- Server determines canonical week_start (Monday UTC)
  v_week_start := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);

  -- Server determines team attribution at moment of answer
  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_user_id;

  -- Only attribute to active (non-disbanded) teams
  IF v_team_id IS NOT NULL THEN
    SELECT t.id INTO v_team_id FROM teams t
    WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
    -- If disbanded: v_team_id → NULL; contribution is unattributed
  END IF;

  -- Write immutable contribution ledger entry
  -- ON CONFLICT DO NOTHING: idempotent if somehow called twice
  INSERT INTO brain_fight_contributions (
    user_id, team_id, week_start, source_type, source_id, points, occurred_at
  ) VALUES (
    v_user_id, v_team_id, v_week_start, 'superq', p_question_id, v_bf_pts, now()
  )
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING;

  -- Update backward-compat cache in player_weekly_bf_points (server-only after §1+§3)
  PERFORM record_superq_bf(v_user_id, v_is_correct);

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
-- Single call returns everything the BF screen needs.
-- Aggregates directly from brain_fight_contributions — no stale cache.
-- Excludes duel_pts and training_pts from all aggregation.
-- Does not expose: join_code, private profile fields, treasury details.
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
    -- Per-player scores from immutable ledger (superq only)
    player_scores AS (
      SELECT bfc.user_id,
             bfc.team_id,
             SUM(bfc.points) AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start = v_week_start
        AND bfc.team_id IS NOT NULL
        AND bfc.source_type = 'superq'
      GROUP BY bfc.user_id, bfc.team_id
    ),
    -- Apply team formula: top-3 fully, each beyond top-3 contributes +1
    team_totals AS (
      SELECT
        ps.team_id,
        SUM(CASE WHEN rn <= 3 THEN ps.total ELSE 0 END)
          + COUNT(CASE WHEN rn > 3 AND ps.total > 0 THEN 1 END)::int AS team_pts
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY total DESC) AS rn
        FROM player_scores
      ) ps
      GROUP BY ps.team_id
    ),
    -- Global leaderboard with rank
    ranked_lb AS (
      SELECT
        tt.team_id,
        tt.team_pts                                              AS points,
        ROW_NUMBER() OVER (ORDER BY tt.team_pts DESC)::int      AS rank,
        t.name,
        t.emoji,
        t.city,
        COUNT(*) OVER ()::int                                   AS total_teams
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
    ),
    -- My team score + rank
    my_team_row AS (
      SELECT rl.points, rl.rank, rl.total_teams
      FROM ranked_lb rl
      WHERE rl.team_id = v_team_id
    ),
    -- My verified contributions this week (superq only)
    my_contrib AS (
      SELECT COALESCE(SUM(bfc.points), 0) AS superq_pts
      FROM brain_fight_contributions bfc
      WHERE bfc.user_id = v_uid
        AND bfc.week_start = v_week_start
        AND bfc.source_type = 'superq'
    ),
    -- Team contributors ranked by points
    contributors AS (
      SELECT
        ps.user_id,
        ps.total                                                        AS points,
        pr.display_name,
        pr.avatar_url,
        ROW_NUMBER() OVER (ORDER BY ps.total DESC)::int                 AS rn
      FROM player_scores ps
      JOIN profiles pr ON pr.id = ps.user_id
      WHERE ps.team_id = v_team_id
    ),
    -- Historical BF results for this team
    hist AS (
      SELECT cr.rank, cr.points_earned, cr.created_at, cr.week_start AS hist_week
      FROM challenge_results cr
      WHERE cr.team_id = v_team_id
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
          'id',          ti.id,
          'name',        ti.name,
          'emoji',       ti.emoji,
          'city',        ti.city,
          'points',      COALESCE(mtr.points, 0),
          'rank',        mtr.rank,
          'total_teams', mtr.total_teams
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
            'user_id',      c.user_id,
            'display_name', c.display_name,
            'avatar_url',   c.avatar_url,
            'points',       c.points,
            'is_me',        c.user_id = v_uid,
            'rn',           c.rn
          ) ORDER BY c.rn
        )
        FROM contributors c
      ), '[]'::jsonb),
      'leaderboard', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'team_id',    rl.team_id,
            'name',       rl.name,
            'emoji',      rl.emoji,
            'city',       rl.city,
            'points',     rl.points,
            'rank',       rl.rank,
            'is_my_team', rl.team_id = v_team_id
          ) ORDER BY rl.rank
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
-- Previously aggregated from player_weekly_bf_points using profiles.team_id
-- at sync time (team-switch bug) and included duel_pts (unsafe).
-- Now aggregates from brain_fight_contributions (source_type='superq' only),
-- where team_id is immutably captured at contribution time.
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
        bfc.user_id,
        SUM(bfc.points)                                        AS total,
        ROW_NUMBER() OVER (ORDER BY SUM(bfc.points) DESC)::int AS rn
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start = v_week_start
        AND bfc.team_id    = v_team.id
        AND bfc.source_type = 'superq'
      GROUP BY bfc.user_id
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
-- §9  finalize_weekly_brain_fights — idempotent, uses ledger (P0.7)
--
-- Uses brain_fight_contributions for correct attribution.
-- ON CONFLICT DO NOTHING on challenge_results (via §5 constraint).
-- Does NOT delete brain_fight_contributions (permanent audit trail).
-- Clears only rolling caches (team_weekly_brain_fights,
-- player_weekly_bf_points).
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
  v_points_map int[]   := ARRAY[100, 80, 60, 40, 30, 25, 20, 15, 10, 5];
  v_pts        integer;
  v_row        record;
BEGIN
  -- Refresh rolling cache first
  PERFORM sync_team_brain_fights_daily();

  -- Compute final standings from immutable ledger
  FOR v_row IN
    WITH player_scores AS (
      SELECT bfc.user_id, bfc.team_id, SUM(bfc.points) AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start = v_week_start
        AND bfc.team_id    IS NOT NULL
        AND bfc.source_type = 'superq'
      GROUP BY bfc.user_id, bfc.team_id
    ),
    team_totals AS (
      SELECT
        ps.team_id,
        SUM(CASE WHEN rn <= 3 THEN ps.total ELSE 0 END)
          + COUNT(CASE WHEN rn > 3 AND ps.total > 0 THEN 1 END)::int AS team_score
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY team_id ORDER BY total DESC) AS rn
        FROM player_scores
      ) x
      GROUP BY ps.team_id
    )
    SELECT team_id, team_score
    FROM team_totals
    WHERE team_score > 0
    ORDER BY team_score DESC
  LOOP
    v_pts := CASE
      WHEN v_rank <= array_length(v_points_map, 1) THEN v_points_map[v_rank]
      ELSE 0
    END;

    IF v_pts > 0 THEN
      -- Idempotent via cr_bf_team_week_unique constraint (§5)
      INSERT INTO challenge_results
        (team_id, provider_id, challenge_type, rank, points_earned, week_start)
      VALUES
        (v_row.team_id, 'bfc_internal', 'brain_fights', v_rank, v_pts, v_week_start)
      ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING;
    END IF;

    v_rank := v_rank + 1;
  END LOOP;

  -- Clear rolling caches only (brain_fight_contributions is permanent)
  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
  -- brain_fight_contributions intentionally NOT deleted: permanent audit trail
END;
$$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- SECURITY STATE BEFORE / AFTER
--
-- player_weekly_bf_points:
--   BEFORE: "pwbf_own" FOR ALL (INSERT/UPDATE/DELETE by owner)
--           "pwbf_read" FOR SELECT (public)
--   AFTER:  "pwbf_read" FOR SELECT only (no client writes)
--
-- quiz_daily_answers:
--   BEFORE: "qda_own" FOR ALL (owner can DELETE their answer)
--   AFTER:  "qda_own_insert" FOR INSERT + "qda_own_select" FOR SELECT
--           (answers immutable from client side)
--
-- brain_fight_contributions (new):
--   "bfc_read" FOR SELECT USING (true) only
--   No INSERT/UPDATE/DELETE policies
--
-- team_weekly_brain_fights:
--   BEFORE: "twbf_read" FOR SELECT only (already correct, no change)
--   AFTER:  same
--
-- record_superq_bf / record_training_bf / record_duel_win_bf:
--   BEFORE: EXECUTE granted to PUBLIC (Supabase default)
--   AFTER:  REVOKE from PUBLIC, anon, authenticated
--
-- get_brain_fights_week:
--   NEW FUNCTION: EXECUTE granted to authenticated only
-- ══════════════════════════════════════════════════════════════════
