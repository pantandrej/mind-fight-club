-- ══════════════════════════════════════════════════════════════════
-- Migration 77: Weekly Arena  (DRAFT — DO NOT APPLY)
-- "Client requests. Server decides."
--
-- ── What this migration does ──────────────────────────────────────
-- §1  Fix official_tournament_answers — enable RLS (was fully open)
-- §2  weekly_arenas — canonical event table
-- §3  weekly_arena_questions — ordered question list per arena
-- §4  weekly_arena_participants — team captured at join time
-- §5  weekly_arena_answers — server-derived correctness/points
-- §6  Extend brain_fight_contributions source_type to 'weekly_arena'
-- §7  get_weekly_arena() — event + questions without correct_index
-- §8  join_weekly_arena(arena_id) — creates participant row
-- §9  submit_weekly_arena_answer() — server derives correct/points
-- §10 get_weekly_arena_results() — ranked leaderboard
--
-- ── Security principles ───────────────────────────────────────────
-- Client never sends: p_correct, p_points, p_score, correct_index
-- correct_index derived server-side via questions.correct_index
-- scoring_user_id pattern (from migration 76) used throughout
-- weekly_arena_answers has NO client SELECT policy (raw data hidden)
-- BF contribution created server-side on completion
-- ══════════════════════════════════════════════════════════════════

BEGIN;


-- ──────────────────────────────────────────────────────────────────
-- §1  Fix official_tournament_answers — enable RLS
--
-- Before: no RLS → anon could INSERT arbitrary rows with
--   is_correct=true, points=9999. Confirmed in smoke test.
-- After:  RLS ON, own SELECT only, no INSERT policy.
--   All writes must go through future SECURITY DEFINER RPC.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.official_tournament_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ota_select_own" ON public.official_tournament_answers;
CREATE POLICY "ota_select_own" ON public.official_tournament_answers
  FOR SELECT USING (user_id = auth.uid());
-- No INSERT/UPDATE/DELETE policy — clients blocked from all writes.


-- ──────────────────────────────────────────────────────────────────
-- §2  weekly_arenas — canonical Weekly Arena event table
--
-- status field:
--   'upcoming'  — scheduled, not yet open
--   'live'      — participation window open (between starts_at and ends_at)
--   'finished'  — window closed, results final
--
-- Server RPCs check now() against starts_at / ends_at.
-- Client UI derives display state from returned timestamps.
-- Admin sets status manually (or future cron via sync_weekly_arena_status).
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arenas (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  title       text        NOT NULL,
  title_en    text,
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  status      text        NOT NULL DEFAULT 'upcoming'
              CHECK (status IN ('upcoming', 'live', 'finished')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wa_ends_after_starts CHECK (ends_at > starts_at)
);

ALTER TABLE public.weekly_arenas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wa_read_all" ON public.weekly_arenas
  FOR SELECT USING (true);
-- No client INSERT/UPDATE/DELETE.


-- ──────────────────────────────────────────────────────────────────
-- §3  weekly_arena_questions — ordered question list for each arena
--
-- get_weekly_arena() delivers these via SECURITY DEFINER,
-- EXCLUDING questions.correct_index from the payload.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_questions (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id    uuid        NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  question_id uuid        NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  position    int         NOT NULL,
  CONSTRAINT waq_arena_question UNIQUE (arena_id, question_id),
  CONSTRAINT waq_arena_position UNIQUE (arena_id, position)
);

CREATE INDEX IF NOT EXISTS idx_waq_arena ON public.weekly_arena_questions(arena_id, position);

ALTER TABLE public.weekly_arena_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "waq_read_all" ON public.weekly_arena_questions
  FOR SELECT USING (true);


-- ──────────────────────────────────────────────────────────────────
-- §4  weekly_arena_participants — one row per player per arena
--
-- team_id captured at join time (immutable team attribution).
-- scoring_user_id: same pattern as migration 76 — no FK, stable
--   after profile deletion, used for ranking.
-- user_id: nullable FK ON DELETE SET NULL — privacy-removable.
-- score/correct/rank: updated by server on each answer, finalized
--   when all questions answered (completed_at IS NOT NULL).
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_participants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id        uuid        NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  scoring_user_id uuid        NOT NULL,    -- immutable; no FK; survives profile deletion
  user_id         uuid        REFERENCES public.profiles(id) ON DELETE SET NULL,
  team_id         uuid        REFERENCES public.teams(id)    ON DELETE SET NULL,
  score           int         NOT NULL DEFAULT 0,
  correct         int         NOT NULL DEFAULT 0,
  total_questions int         NOT NULL DEFAULT 0,
  rank            int,
  completed_at    timestamptz,
  joined_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT wap_arena_user UNIQUE (arena_id, scoring_user_id)
);

CREATE INDEX IF NOT EXISTS idx_wap_arena       ON public.weekly_arena_participants(arena_id);
CREATE INDEX IF NOT EXISTS idx_wap_scoring     ON public.weekly_arena_participants(scoring_user_id, arena_id);
CREATE INDEX IF NOT EXISTS idx_wap_team        ON public.weekly_arena_participants(team_id, arena_id);

ALTER TABLE public.weekly_arena_participants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wap_read_all" ON public.weekly_arena_participants
  FOR SELECT USING (true);
-- No client INSERT/UPDATE — all via SECURITY DEFINER RPCs.


-- ──────────────────────────────────────────────────────────────────
-- §5  weekly_arena_answers — server-derived answer records
--
-- is_correct and points are NEVER accepted from client.
-- Server derives both from questions.correct_index.
-- scoring_user_id: immutable, no FK, same stability guarantee.
-- No client SELECT policy — raw answers are server-internal.
--   Leaderboard aggregates served via get_weekly_arena_results().
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_answers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id        uuid        NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  participant_id  uuid        NOT NULL REFERENCES public.weekly_arena_participants(id) ON DELETE CASCADE,
  scoring_user_id uuid        NOT NULL,    -- immutable; no FK
  question_id     uuid        NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_index  int         NOT NULL,
  is_correct      boolean     NOT NULL,    -- server-derived; never client-supplied
  points          int         NOT NULL DEFAULT 0,  -- server-derived
  answered_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waa_unique_answer UNIQUE (arena_id, scoring_user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_waa_participant ON public.weekly_arena_answers(participant_id);
CREATE INDEX IF NOT EXISTS idx_waa_arena       ON public.weekly_arena_answers(arena_id);

ALTER TABLE public.weekly_arena_answers ENABLE ROW LEVEL SECURITY;
-- No policies: RLS blocks all client reads/writes.
-- SECURITY DEFINER functions bypass RLS.


-- ──────────────────────────────────────────────────────────────────
-- §6  Extend brain_fight_contributions source_type CHECK
--
-- Migration 76 applied CHECK (source_type IN ('superq')).
-- Weekly Arena needs source_type = 'weekly_arena'.
-- Do NOT modify migration 76 file.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.brain_fight_contributions
  DROP CONSTRAINT IF EXISTS brain_fight_contributions_source_type_check;

ALTER TABLE public.brain_fight_contributions
  ADD CONSTRAINT brain_fight_contributions_source_type_check
  CHECK (source_type IN ('superq', 'weekly_arena'));


-- ──────────────────────────────────────────────────────────────────
-- §7  get_weekly_arena() — authoritative read RPC
--
-- Returns the most relevant arena: LIVE first, then nearest
-- UPCOMING, then most recently FINISHED.
-- Questions delivered WITHOUT correct_index (client never sees it).
-- Returns participant status for authenticated user.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_weekly_arena()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_arena     weekly_arenas%ROWTYPE;
  v_part      weekly_arena_participants%ROWTYPE;
  v_q_count   int;
  v_answered  int := 0;
BEGIN
  -- Priority: live > nearest upcoming > most recent finished
  SELECT * INTO v_arena FROM (
    (SELECT * FROM weekly_arenas WHERE status = 'live'     ORDER BY starts_at        LIMIT 1)
    UNION ALL
    (SELECT * FROM weekly_arenas WHERE status = 'upcoming' ORDER BY starts_at ASC    LIMIT 1)
    UNION ALL
    (SELECT * FROM weekly_arenas WHERE status = 'finished' ORDER BY starts_at DESC   LIMIT 1)
  ) combined LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_arena');
  END IF;

  -- Question count for this arena
  SELECT COUNT(*) INTO v_q_count FROM weekly_arena_questions WHERE arena_id = v_arena.id;

  -- My participation (if authenticated)
  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_part FROM weekly_arena_participants
    WHERE arena_id = v_arena.id AND user_id = v_uid;

    IF FOUND AND v_part.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
      WHERE arena_id = v_arena.id AND scoring_user_id = v_part.scoring_user_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',          true,
    'arena', jsonb_build_object(
      'id',         v_arena.id,
      'title',      v_arena.title,
      'title_en',   v_arena.title_en,
      'status',     v_arena.status,
      'starts_at',  v_arena.starts_at,
      'ends_at',    v_arena.ends_at,
      'q_count',    v_q_count
    ),
    -- Questions only delivered for LIVE arenas (safe: correct_index excluded)
    'questions', CASE WHEN v_arena.status = 'live' THEN (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'question_id',   q.id,
          'position',      waq.position,
          'question_text', q.question_text,
          'question_ru',   q.question_ru,
          'question_en',   q.question_text,
          'answers_json',  q.answers_json,
          'answers_ru',    q.answers_ru,
          'image_url',     q.image_url,
          'audio_url',     q.audio_url,
          'video_url',     q.video_url,
          'media_type',    q.media_type
          -- correct_index intentionally excluded
        ) ORDER BY waq.position
      ), '[]'::jsonb)
      FROM weekly_arena_questions waq
      JOIN questions q ON q.id = waq.question_id
      WHERE waq.arena_id = v_arena.id
    ) ELSE NULL END,
    -- Participation status
    'my_participation', CASE WHEN v_uid IS NOT NULL AND v_part.id IS NOT NULL THEN
      jsonb_build_object(
        'participant_id',  v_part.id,
        'score',           v_part.score,
        'correct',         v_part.correct,
        'total_questions', v_q_count,
        'answered',        v_answered,
        'rank',            v_part.rank,
        'completed',       v_part.completed_at IS NOT NULL,
        'joined_at',       v_part.joined_at
      )
    ELSE NULL END,
    -- Participant count (public info)
    'participant_count', (
      SELECT COUNT(*) FROM weekly_arena_participants WHERE arena_id = v_arena.id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_arena() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_arena() TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §8  join_weekly_arena(p_arena_id) — register participation
--
-- Captures team_id at join time (immutable attribution).
-- Only allowed when arena status = 'live'.
-- Idempotent: re-join returns existing participant.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_weekly_arena(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_arena     weekly_arenas%ROWTYPE;
  v_team_id   uuid;
  v_part_id   uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;

  IF v_arena.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_live', 'status', v_arena.status);
  END IF;

  -- Idempotent: already joined?
  SELECT id INTO v_part_id FROM weekly_arena_participants
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;

  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'participant_id', v_part_id, 'already_joined', true);
  END IF;

  -- Capture team at join time (active team only)
  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;
  IF v_team_id IS NOT NULL THEN
    SELECT t.id INTO v_team_id FROM teams t
    WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
  END IF;

  INSERT INTO weekly_arena_participants
    (arena_id, scoring_user_id, user_id, team_id, total_questions)
  VALUES
    (p_arena_id, v_uid, v_uid,
     v_team_id,
     (SELECT COUNT(*) FROM weekly_arena_questions WHERE arena_id = p_arena_id))
  RETURNING id INTO v_part_id;

  RETURN jsonb_build_object('ok', true, 'participant_id', v_part_id, 'already_joined', false);
END;
$$;

REVOKE ALL ON FUNCTION public.join_weekly_arena(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_weekly_arena(uuid) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §9  submit_weekly_arena_answer() — server-authoritative submission
--
-- Client supplies: arena_id, question_id, selected_index only.
-- Server derives: correctness (from questions.correct_index),
--   points (10 per correct; 0 wrong), completion status, BF contribution.
-- Validates: arena LIVE, participant exists, question belongs to arena,
--   not already answered, window open.
-- BF contribution on completion: fixed 5 pts (server-verified participation).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_weekly_arena_answer(
  p_arena_id      uuid,
  p_question_id   uuid,
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
  v_part          weekly_arena_participants%ROWTYPE;
  v_question      questions%ROWTYPE;
  v_pos_check     int;
  v_is_correct    boolean;
  v_pts           int;
  v_answer_rows   int;
  v_answered      int;
  v_total         int;
  v_completed     boolean := false;
  v_today         date := (now() AT TIME ZONE 'UTC')::date;
  v_week_start    date;
  v_bf_rows       int;
  v_bf_pts        int := 5;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Validate arena is LIVE
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;
  IF v_arena.status <> 'live' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_live', 'status', v_arena.status);
  END IF;
  -- Double-check window with server clock
  IF now() < v_arena.starts_at OR now() > v_arena.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outside_window');
  END IF;

  -- Validate participation
  SELECT * INTO v_part FROM weekly_arena_participants
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_joined');
  END IF;

  -- Validate question belongs to this arena
  SELECT 1 INTO v_pos_check FROM weekly_arena_questions
  WHERE arena_id = p_arena_id AND question_id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_in_arena');
  END IF;

  -- Load question for server-side correctness (correct_index never sent to client)
  SELECT * INTO v_question FROM questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Server derives correctness and points
  v_is_correct := p_selected_index = v_question.correct_index;
  v_pts        := CASE WHEN v_is_correct THEN 10 ELSE 0 END;

  -- Concurrency-safe answer insert
  INSERT INTO weekly_arena_answers
    (arena_id, participant_id, scoring_user_id, question_id, selected_index, is_correct, points)
  VALUES
    (p_arena_id, v_part.id, v_uid, p_question_id, p_selected_index, v_is_correct, v_pts)
  ON CONFLICT (arena_id, scoring_user_id, question_id) DO NOTHING;

  GET DIAGNOSTICS v_answer_rows = ROW_COUNT;
  IF v_answer_rows = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Update participant running totals
  UPDATE weekly_arena_participants
  SET score   = score   + v_pts,
      correct = correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = v_part.id;

  -- Check completion: all questions answered?
  SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;

  v_total := v_part.total_questions;

  IF v_answered >= v_total AND v_total > 0 THEN
    -- Mark completed
    UPDATE weekly_arena_participants
    SET completed_at = now()
    WHERE id = v_part.id AND completed_at IS NULL;

    v_completed := true;

    -- BF contribution on completion (server-verified; fixed 5 pts)
    v_week_start := v_today - ((EXTRACT(DOW FROM v_today)::int + 6) % 7);

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
  END IF;

  RETURN jsonb_build_object(
    'ok',             true,
    'is_correct',     v_is_correct,
    'correct_index',  v_question.correct_index,  -- revealed AFTER server stores answer
    'points',         v_pts,
    'total_score',    v_part.score + v_pts,
    'answered',       v_answered,
    'total_questions', v_total,
    'completed',      v_completed,
    'bf_pts',         CASE WHEN v_completed THEN v_bf_pts ELSE NULL END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §10  get_weekly_arena_results(p_arena_id) — server-derived leaderboard
--
-- Returns ranked participant list with aggregated server-derived scores.
-- Does NOT expose individual answers or correct_index.
-- Rank is server-computed by score DESC (ties broken by joined_at ASC).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_weekly_arena_results(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_arena weekly_arenas%ROWTYPE;
BEGIN
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok',    true,
    'arena', jsonb_build_object(
      'id',       v_arena.id,
      'title',    v_arena.title,
      'status',   v_arena.status,
      'ends_at',  v_arena.ends_at
    ),
    'leaderboard', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'rank',            ranked.rn,
          'display_name',    pr.display_name,
          'avatar_url',      pr.avatar_url,
          'team_name',       t.name,
          'team_emoji',      t.emoji,
          'score',           ranked.score,
          'correct',         ranked.correct,
          'total_questions', ranked.total_questions,
          'completed',       ranked.completed_at IS NOT NULL,
          'is_me',           ranked.user_id = v_uid
        ) ORDER BY ranked.rn
      )
      FROM (
        SELECT *,
               ROW_NUMBER() OVER (ORDER BY score DESC, joined_at ASC)::int AS rn
        FROM weekly_arena_participants
        WHERE arena_id = p_arena_id
      ) ranked
      LEFT JOIN profiles pr ON pr.id = ranked.user_id
      LEFT JOIN teams    t  ON t.id  = ranked.team_id
    ), '[]'::jsonb),
    'my_result', (
      SELECT jsonb_build_object(
        'score',           wap.score,
        'correct',         wap.correct,
        'total_questions', wap.total_questions,
        'rank',            (
          SELECT COUNT(*) + 1
          FROM weekly_arena_participants
          WHERE arena_id = p_arena_id AND score > wap.score
        )::int,
        'completed',       wap.completed_at IS NOT NULL
      )
      FROM weekly_arena_participants wap
      WHERE wap.arena_id = p_arena_id AND wap.user_id = v_uid
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_arena_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_arena_results(uuid) TO authenticated;


COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- SECURITY SUMMARY
--
-- official_tournament_answers:
--   BEFORE: no RLS → anon INSERT with arbitrary is_correct/points
--   AFTER:  RLS ON, own SELECT only, no client INSERT
--
-- weekly_arenas:           SELECT public, no client writes
-- weekly_arena_questions:  SELECT public, no client writes
-- weekly_arena_participants: SELECT public, no client writes
-- weekly_arena_answers:    NO policies — RLS blocks all client access
--
-- Client never supplies: correct_index, is_correct, points, p_correct
-- Server derives correctness via questions.correct_index (SECURITY DEFINER)
-- BF contribution created server-side on completion (source_type='weekly_arena')
-- Team captured at join_weekly_arena() — later switch does not move result
-- scoring_user_id: immutable, no FK, same pattern as migration 76
-- ══════════════════════════════════════════════════════════════════
