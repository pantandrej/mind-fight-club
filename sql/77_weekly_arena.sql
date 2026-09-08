-- ══════════════════════════════════════════════════════════════════
-- Migration 77: Weekly Arena  (DRAFT — DO NOT APPLY)
-- "Client requests. Server decides."
--
-- ── What this migration does ──────────────────────────────────────
-- §1   Fix official_tournament_answers — enable RLS (was fully open)
-- §2   weekly_arenas — canonical event table
-- §3   weekly_arena_questions — ordered question list; NO client SELECT
-- §4   weekly_arena_participants — team captured at join; NO client SELECT
-- §5   weekly_arena_answers — server-derived correctness; no client SELECT
-- §6   Extend brain_fight_contributions source_type to 'weekly_arena'
-- §7   get_weekly_arena() — effective status from timestamps; waq_id tokens;
--       my_participation hides score/correct during LIVE
-- §8   join_weekly_arena(arena_id) — timestamp eligibility; ON CONFLICT safe
-- §9   submit_weekly_arena_answer(arena_id, waq_id, selected_index)
--       waq_id → question_id resolved server-side; no correctness in response
-- §10  get_weekly_arena_results() — RANK() ties; leaderboard after FINISHED only
-- §11  get_brain_fights_week() — add weekly_arena to BF aggregation
-- §12  sync_team_brain_fights_daily() — add weekly_arena
-- §13  finalize_weekly_brain_fights() — add weekly_arena
--
-- ── Answer-key security (P0.1) ────────────────────────────────────
-- Client receives waq_id (= weekly_arena_questions.id), NOT question_id.
-- weekly_arena_questions has NO client SELECT → client cannot map
--   waq_id → question_id → questions.correct_index via REST.
-- submit_weekly_arena_answer resolves waq_id → question_id server-side.
-- correct_index is never included in any RPC response.
--
-- ── Competitive integrity (P0.3) ─────────────────────────────────
-- submit returns: ok, accepted, answered, total_questions, completed, bf_pts.
-- is_correct / correct_index / points / total_score: NOT returned during LIVE.
-- get_weekly_arena my_participation during LIVE: no score/correct fields.
-- get_weekly_arena_results leaderboard: empty during LIVE.
--
-- ── Status model (P0.4) ───────────────────────────────────────────
-- Effective status is ALWAYS derived from server timestamps:
--   'live'     if starts_at <= now() < ends_at
--   'upcoming' if now() < starts_at
--   'finished' if now() >= ends_at
-- Stored `status` column is for admin display only; eligibility RPCs
-- use server clock exclusively.
-- ══════════════════════════════════════════════════════════════════

BEGIN;


-- ──────────────────────────────────────────────────────────────────
-- §1  Fix official_tournament_answers — enable RLS
--
-- Before: no RLS → anon INSERT arbitrary rows (is_correct=true, points=9999).
-- After:  RLS ON, own SELECT only; no INSERT policy (all writes via future RPC).
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.official_tournament_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ota_select_own" ON public.official_tournament_answers;
CREATE POLICY "ota_select_own" ON public.official_tournament_answers
  FOR SELECT USING (user_id = auth.uid());


-- ──────────────────────────────────────────────────────────────────
-- §2  weekly_arenas — canonical Weekly Arena event table
--
-- status column: admin-managed display field (upcoming/live/finished).
-- Eligibility in all RPCs uses starts_at / ends_at with server clock.
-- Client reads title, timestamps; derives display state locally.
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
DROP POLICY IF EXISTS "wa_read_all" ON public.weekly_arenas;
CREATE POLICY "wa_read_all" ON public.weekly_arenas
  FOR SELECT USING (true);
-- No client INSERT/UPDATE/DELETE.


-- ──────────────────────────────────────────────────────────────────
-- §3  weekly_arena_questions — ordered question list per arena
--
-- NO client SELECT policy (P0.1 / P1.6):
--   Client never learns question_id → cannot look up questions.correct_index.
--   All content delivered via get_weekly_arena() SECURITY DEFINER using
--   waq_id (= this table's PK) as the opaque submission token.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_questions (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id    uuid    NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  question_id uuid    NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  position    int     NOT NULL,
  CONSTRAINT waq_arena_question UNIQUE (arena_id, question_id),
  CONSTRAINT waq_arena_position UNIQUE (arena_id, position)
);

CREATE INDEX IF NOT EXISTS idx_waq_arena ON public.weekly_arena_questions(arena_id, position);

ALTER TABLE public.weekly_arena_questions ENABLE ROW LEVEL SECURITY;
-- No policies: RLS blocks all client reads/writes.
-- SECURITY DEFINER functions bypass RLS.


-- ──────────────────────────────────────────────────────────────────
-- §4  weekly_arena_participants — one row per player per arena
--
-- NO client SELECT policy (P1.6):
--   scoring_user_id and running totals are server-internal.
--   All participant data served via get_weekly_arena() SECURITY DEFINER.
--
-- scoring_user_id: no FK, stable after profile deletion (migration 76 pattern).
-- user_id: nullable FK ON DELETE SET NULL (privacy-removable).
-- team_id: captured at join time — immutable attribution.
-- score/correct: server-derived totals; not returned during LIVE.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_participants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id        uuid        NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  scoring_user_id uuid        NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_wap_arena   ON public.weekly_arena_participants(arena_id);
CREATE INDEX IF NOT EXISTS idx_wap_scoring ON public.weekly_arena_participants(scoring_user_id, arena_id);
CREATE INDEX IF NOT EXISTS idx_wap_team    ON public.weekly_arena_participants(team_id, arena_id);

ALTER TABLE public.weekly_arena_participants ENABLE ROW LEVEL SECURITY;
-- No policies: RLS blocks all client reads/writes.


-- ──────────────────────────────────────────────────────────────────
-- §5  weekly_arena_answers — server-derived answer records
--
-- is_correct and points are NEVER accepted from client.
-- scoring_user_id: immutable, no FK.
-- No client SELECT policy — raw answers are server-internal.
--   Leaderboard aggregates served via get_weekly_arena_results() only
--   after arena effective status = 'finished'.
-- ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.weekly_arena_answers (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id        uuid        NOT NULL REFERENCES public.weekly_arenas(id) ON DELETE CASCADE,
  participant_id  uuid        NOT NULL REFERENCES public.weekly_arena_participants(id) ON DELETE CASCADE,
  scoring_user_id uuid        NOT NULL,
  question_id     uuid        NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_index  int         NOT NULL,
  is_correct      boolean     NOT NULL,
  points          int         NOT NULL DEFAULT 0,
  answered_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT waa_unique_answer UNIQUE (arena_id, scoring_user_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_waa_participant ON public.weekly_arena_answers(participant_id);
CREATE INDEX IF NOT EXISTS idx_waa_arena       ON public.weekly_arena_answers(arena_id);

ALTER TABLE public.weekly_arena_answers ENABLE ROW LEVEL SECURITY;
-- No policies: RLS blocks all client reads/writes.


-- ──────────────────────────────────────────────────────────────────
-- §5.1  Answer-key security — table-level REVOKE + column GRANT + competitive secrets
--
-- P0.1 — Column-level REVOKE alone is insufficient.
--   When anon/authenticated have TABLE-LEVEL SELECT on public.questions (the
--   Supabase default), a REVOKE on a single column is a no-op: table-level
--   privilege already authorises every column. Pattern from migration 75 (teams):
--     REVOKE SELECT ON table FROM anon, authenticated;
--     GRANT SELECT (safe_col1, ...) ON table TO anon, authenticated;
--   SECURITY DEFINER functions run as postgres → unaffected by this REVOKE.
--
-- P0.2 — Competitive-secret reservation model.
--   questions.is_competitive_secret = true: admin-reserved for a future arena.
--   get_question_reveals() NEVER returns correct_index for:
--     (a) questions where is_competitive_secret = true, OR
--     (b) questions in weekly_arena_questions for any arena where now() < ends_at
--         (covers both UPCOMING and LIVE, not just LIVE).
--   Lifecycle: admin sets is_competitive_secret=true before arena creation →
--   question flows through UPCOMING/LIVE with answer hidden → admin optionally
--   resets to false after arena finishes to re-enable training reveals.
--
-- P0.3 — Guest (anon) gameplay.
--   get_question_reveals is now granted to anon as well as authenticated.
--   Safe: the function only returns non-secret, non-arena correct_indexes.
--
-- get_question_reveals_admin(ids): admin-only, bypasses all secrecy checks.
-- ──────────────────────────────────────────────────────────────────

-- Add is_competitive_secret column (idempotent).
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS is_competitive_secret boolean NOT NULL DEFAULT false;

-- Table-level REVOKE (correct pattern — replaces the ineffective column-level REVOKE).
REVOKE SELECT ON public.questions FROM anon, authenticated;

-- Re-grant all safe columns. DO block skips any column that doesn't exist yet.
DO $$
DECLARE col text;
BEGIN
  FOREACH col IN ARRAY ARRAY[
    'id','question_text','question_ru','question_en',
    'answers_json','answers_ru','answers_en',
    'q','a',
    'image_url','audio_url','video_url',
    'answer_image_url','answer_audio_url','answer_video_url',
    'slide_img_url','answer_slide_img_url',
    'explanation_ru','media_type','question_type',
    'category','difficulty','status','source_type',
    'game_type','language','import_key',
    'created_at','updated_at','approved_at'
    -- is_competitive_secret intentionally excluded: server/admin metadata only
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name   = 'questions'
        AND column_name  = col
    ) THEN
      EXECUTE format('GRANT SELECT (%I) ON public.questions TO anon, authenticated', col);
    END IF;
  END LOOP;
END;
$$;
-- correct_index and is_competitive_secret are intentionally NOT in the list above.

-- ── Row-level secrecy for competitive questions ────────────────────
-- Problem: column grants alone hide correct_index but leave the full question row
--   (question_text, answers, media URLs) readable via direct REST. An attacker
--   can pre-download all future Arena questions before the Arena starts,
--   solve them offline, and arrive with pre-cached answers.
--
-- Fix: enable RLS on questions; add a RESTRICTIVE SELECT policy that blocks
--   rows where is_competitive_secret = true from anon/authenticated.
--   RESTRICTIVE policies ANDed with permissive ones — this guarantees secret rows
--   are never returned regardless of other existing permissive policies.
--   SECURITY DEFINER functions run as postgres (superuser), which bypasses RLS,
--   so get_weekly_arena(), submit_weekly_arena_answer(), and moderation RPCs
--   continue to access secret rows internally without any change.
--
-- After FINISHED: row remains hidden while is_competitive_secret=true.
-- Admin releases via UPDATE questions SET is_competitive_secret=false.
-- After release the row becomes a normal readable training question.
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS questions_hide_competitive_secrets ON public.questions;
CREATE POLICY questions_hide_competitive_secrets
  ON public.questions
  FOR SELECT
  TO anon, authenticated
  USING (is_competitive_secret = false);
-- PERMISSIVE (default): normal questions pass (false = visible); secret rows
-- fail the USING check and are invisible. No separate restrictive policy needed.
-- Without at least one permissive SELECT policy, RLS would block all rows.

-- ── Lifecycle enforcement: is_competitive_secret immutability ──────
-- Rule: once a question is public (false), it can never become a competitive
-- secret (true). A previously public question cannot be re-used for Arena.
-- Allowed: INSERT with true; true→false (release after Arena); false stays false.
-- Blocked: false→true (would allow caching then re-use as competitive content).

CREATE OR REPLACE FUNCTION public._check_competitive_secret_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.is_competitive_secret = false AND NEW.is_competitive_secret = true THEN
    RAISE EXCEPTION
      'is_competitive_secret cannot be changed to true on a previously-public question (id: %). '
      'Create a new question with is_competitive_secret=true instead.',
      NEW.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS questions_competitive_secret_immutable ON public.questions;
CREATE TRIGGER questions_competitive_secret_immutable
  BEFORE UPDATE OF is_competitive_secret ON public.questions
  FOR EACH ROW
  EXECUTE FUNCTION public._check_competitive_secret_immutability();

-- Rule: weekly_arena_questions can only reference questions born secret.
-- Prevents ordinary training questions from being assigned to a competitive Arena.

CREATE OR REPLACE FUNCTION public._check_waq_question_is_secret()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.questions q
    WHERE q.id = NEW.question_id AND q.is_competitive_secret = true
  ) THEN
    RAISE EXCEPTION
      'weekly_arena_questions: question % must have is_competitive_secret=true. '
      'Ordinary training questions cannot be assigned to a competitive Arena.',
      NEW.question_id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS waq_question_must_be_secret ON public.weekly_arena_questions;
CREATE TRIGGER waq_question_must_be_secret
  BEFORE INSERT ON public.weekly_arena_questions
  FOR EACH ROW
  EXECUTE FUNCTION public._check_waq_question_is_secret();

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
    AND q.id NOT IN (
      SELECT waq.question_id
      FROM weekly_arena_questions waq
      JOIN weekly_arenas wa ON wa.id = waq.arena_id
      WHERE now() < wa.ends_at   -- blocks UPCOMING and LIVE (not just LIVE)
    );
$$;
REVOKE ALL ON FUNCTION public.get_question_reveals(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_question_reveals(uuid[]) TO authenticated, anon;

CREATE OR REPLACE FUNCTION public.get_question_reveals_admin(p_ids uuid[])
RETURNS TABLE(id uuid, correct_index int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true) THEN
    RETURN;
  END IF;
  RETURN QUERY SELECT q.id, q.correct_index FROM questions q WHERE q.id = ANY(p_ids);
END;
$$;
REVOKE ALL ON FUNCTION public.get_question_reveals_admin(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_question_reveals_admin(uuid[]) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §6  Extend brain_fight_contributions source_type CHECK
--
-- Migration 76 applied CHECK (source_type IN ('superq')).
-- Weekly Arena needs source_type = 'weekly_arena'.
-- ──────────────────────────────────────────────────────────────────
ALTER TABLE public.brain_fight_contributions
  DROP CONSTRAINT IF EXISTS brain_fight_contributions_source_type_check;

ALTER TABLE public.brain_fight_contributions
  ADD CONSTRAINT brain_fight_contributions_source_type_check
  CHECK (source_type IN ('superq', 'weekly_arena'));


-- ──────────────────────────────────────────────────────────────────
-- §7  get_weekly_arena() — authoritative read RPC
--
-- Arena selection: LIVE (by timestamps) > nearest UPCOMING > most recent FINISHED.
-- Effective status always derived from starts_at / ends_at (server clock).
-- Questions delivered as waq_id tokens (NOT question_id) — client cannot
--   map waq_id → question_id → questions.correct_index via REST.
-- my_participation during LIVE: answered/total/completed only (no score/correct).
-- my_participation after FINISHED: full stats including score/correct/rank.
-- participant_count: always returned (public aggregate).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_weekly_arena()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid         uuid := auth.uid();
  v_arena       RECORD;
  v_part        weekly_arena_participants%ROWTYPE;
  v_eff_status  text;
  v_q_count     int;
  v_answered    int := 0;
BEGIN
  -- Priority: LIVE (by server timestamp) > nearest UPCOMING > most recent FINISHED
  SELECT * INTO v_arena FROM (
    (SELECT * FROM weekly_arenas
     WHERE starts_at <= now() AND now() < ends_at
     ORDER BY starts_at LIMIT 1)
    UNION ALL
    (SELECT * FROM weekly_arenas
     WHERE now() < starts_at
     ORDER BY starts_at ASC LIMIT 1)
    UNION ALL
    (SELECT * FROM weekly_arenas
     WHERE now() >= ends_at
     ORDER BY ends_at DESC LIMIT 1)
  ) combined LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_arena');
  END IF;

  -- Effective status from server clock (stored status is admin display only)
  v_eff_status := CASE
    WHEN v_arena.starts_at <= now() AND now() < v_arena.ends_at THEN 'live'
    WHEN now() < v_arena.starts_at                               THEN 'upcoming'
    ELSE                                                               'finished'
  END;

  SELECT COUNT(*) INTO v_q_count
  FROM weekly_arena_questions WHERE arena_id = v_arena.id;

  -- My participation (authenticated users only)
  IF v_uid IS NOT NULL THEN
    SELECT * INTO v_part FROM weekly_arena_participants
    WHERE arena_id = v_arena.id AND scoring_user_id = v_uid;

    IF FOUND AND v_part.id IS NOT NULL THEN
      SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
      WHERE arena_id = v_arena.id AND scoring_user_id = v_uid;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok',   true,
    'arena', jsonb_build_object(
      'id',          v_arena.id,
      'title',       v_arena.title,
      'title_en',    v_arena.title_en,
      'eff_status',  v_eff_status,       -- derived from timestamps; use this for all logic
      'starts_at',   v_arena.starts_at,
      'ends_at',     v_arena.ends_at,
      'q_count',     v_q_count
    ),
    -- Questions delivered ONLY when LIVE; waq_id is the opaque submission token
    'questions', CASE WHEN v_eff_status = 'live' THEN (
      SELECT COALESCE(jsonb_agg(
        jsonb_build_object(
          'waq_id',        waq.id,          -- opaque token; submit with this, not question_id
          'position',      waq.position,
          'question_text', q.question_text,
          'question_ru',   q.question_ru,
          'answers_json',  q.answers_json,
          'answers_ru',    q.answers_ru,
          'image_url',     q.image_url,
          'audio_url',     q.audio_url,
          'video_url',     q.video_url,
          'media_type',    q.media_type
          -- question_id intentionally excluded (prevents correct_index lookup)
          -- correct_index intentionally excluded
        ) ORDER BY waq.position
      ), '[]'::jsonb)
      FROM weekly_arena_questions waq
      JOIN questions q ON q.id = waq.question_id
      WHERE waq.arena_id = v_arena.id
    ) ELSE NULL END,
    -- Participation status (per effective state — P0.3)
    'my_participation', CASE
      WHEN v_uid IS NULL OR v_part.id IS NULL THEN NULL
      -- During LIVE: no score/correct/rank (competitive integrity)
      WHEN v_eff_status = 'live' THEN jsonb_build_object(
        'participant_id',  v_part.id,
        'answered',        v_answered,
        'total_questions', v_q_count,
        'completed',       v_part.completed_at IS NOT NULL,
        'joined_at',       v_part.joined_at
      )
      -- After FINISHED: full stats
      ELSE jsonb_build_object(
        'participant_id',  v_part.id,
        'answered',        v_answered,
        'total_questions', v_q_count,
        'completed',       v_part.completed_at IS NOT NULL,
        'score',           v_part.score,
        'correct',         v_part.correct,
        'rank', (
          SELECT COUNT(*) + 1 FROM weekly_arena_participants
          WHERE arena_id = v_arena.id AND score > v_part.score
        )::int,
        'joined_at',       v_part.joined_at
      )
    END,
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
-- Eligibility uses server timestamps (not stored status) — P0.4.
-- Concurrency-safe: INSERT ON CONFLICT DO NOTHING then SELECT — P0.5.
-- team_id captured at join time (immutable attribution).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_weekly_arena(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_arena     RECORD;
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

  -- Eligibility from server clock (P0.4)
  IF NOT (v_arena.starts_at <= now() AND now() < v_arena.ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_live',
      'eff_status', CASE
        WHEN now() < v_arena.starts_at THEN 'upcoming'
        ELSE 'finished'
      END);
  END IF;

  -- Capture active team at join time
  SELECT p.team_id INTO v_team_id FROM profiles p WHERE p.id = v_uid;
  IF v_team_id IS NOT NULL THEN
    SELECT t.id INTO v_team_id FROM teams t
    WHERE t.id = v_team_id AND t.disbanded_at IS NULL;
  END IF;

  -- Concurrency-safe join: INSERT then always SELECT (P0.5)
  INSERT INTO weekly_arena_participants
    (arena_id, scoring_user_id, user_id, team_id, total_questions)
  VALUES
    (p_arena_id, v_uid, v_uid,
     v_team_id,
     (SELECT COUNT(*) FROM weekly_arena_questions WHERE arena_id = p_arena_id))
  ON CONFLICT (arena_id, scoring_user_id) DO NOTHING;

  SELECT id INTO v_part_id FROM weekly_arena_participants
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;

  RETURN jsonb_build_object('ok', true, 'participant_id', v_part_id);
END;
$$;

REVOKE ALL ON FUNCTION public.join_weekly_arena(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.join_weekly_arena(uuid) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §9  submit_weekly_arena_answer() — server-authoritative submission
--
-- p_waq_id: opaque token (= weekly_arena_questions.id).
--   Server resolves waq_id → question_id → correct_index internally.
--   Client never learns question_id; cannot reconstruct answer key.
--
-- Response during LIVE (P0.3):
--   {ok, accepted, answered, total_questions, completed, bf_pts}
--   NO is_correct, correct_index, points, total_score.
--
-- Eligibility: server timestamps only (P0.4).
-- Concurrency: INSERT ON CONFLICT DO NOTHING + GET DIAGNOSTICS (P0.5 pattern).
-- BF contribution: fixed 5 pts on completion (server-verified).
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_weekly_arena_answer(
  p_arena_id       uuid,
  p_waq_id         uuid,
  p_selected_index int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid           uuid := auth.uid();
  v_arena         RECORD;
  v_waq           weekly_arena_questions%ROWTYPE;
  v_part          weekly_arena_participants%ROWTYPE;
  v_correct_index int;
  v_is_correct    boolean;
  v_pts           int;
  v_answer_rows   int;
  v_answered      int;
  v_total         int;
  v_completed     boolean := false;
  v_today         date    := (now() AT TIME ZONE 'UTC')::date;
  v_week_start    date;
  v_bf_rows       int;
  v_bf_pts        int := 5;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Validate arena exists
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;

  -- Eligibility from server clock only (P0.4)
  IF NOT (v_arena.starts_at <= now() AND now() < v_arena.ends_at) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'outside_window');
  END IF;

  -- Validate participation
  SELECT * INTO v_part FROM weekly_arena_participants
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_joined');
  END IF;

  -- Resolve waq_id → question_id (P0.1: client never supplied question_id)
  SELECT * INTO v_waq FROM weekly_arena_questions
  WHERE id = p_waq_id AND arena_id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_in_arena');
  END IF;

  -- Load correct_index server-side (never returned to client)
  SELECT q.correct_index INTO v_correct_index FROM questions q WHERE q.id = v_waq.question_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Server derives correctness and points (never client-supplied)
  v_is_correct := p_selected_index = v_correct_index;
  v_pts        := CASE WHEN v_is_correct THEN 10 ELSE 0 END;

  -- Concurrency-safe answer insert
  INSERT INTO weekly_arena_answers
    (arena_id, participant_id, scoring_user_id, question_id, selected_index, is_correct, points)
  VALUES
    (p_arena_id, v_part.id, v_uid, v_waq.question_id, p_selected_index, v_is_correct, v_pts)
  ON CONFLICT (arena_id, scoring_user_id, question_id) DO NOTHING;

  GET DIAGNOSTICS v_answer_rows = ROW_COUNT;
  IF v_answer_rows = 0 THEN
    -- Already answered; return progress so client can advance
    SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
    WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;
    RETURN jsonb_build_object(
      'ok',              false,
      'reason',          'already_answered',
      'answered',        v_answered,
      'total_questions', v_part.total_questions
    );
  END IF;

  -- Update participant running totals
  UPDATE weekly_arena_participants
  SET score   = score   + v_pts,
      correct = correct + CASE WHEN v_is_correct THEN 1 ELSE 0 END
  WHERE id = v_part.id;

  -- Check completion
  SELECT COUNT(*) INTO v_answered FROM weekly_arena_answers
  WHERE arena_id = p_arena_id AND scoring_user_id = v_uid;

  v_total := v_part.total_questions;

  IF v_answered >= v_total AND v_total > 0 THEN
    UPDATE weekly_arena_participants
    SET completed_at = now()
    WHERE id = v_part.id AND completed_at IS NULL;

    v_completed := true;

    -- BF contribution on completion (source_type='weekly_arena')
    -- Canonical week_start from arena.starts_at, not now() — all participants
    -- completing the same arena always credit the same BF week regardless of when
    -- they finish (fixes cross-midnight attribution bug).
    v_week_start := DATE_TRUNC('week', v_arena.starts_at AT TIME ZONE 'UTC')::date;

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

  -- Response: no correctness fields during LIVE (P0.3)
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
GRANT EXECUTE ON FUNCTION public.submit_weekly_arena_answer(uuid, uuid, int) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §10  get_weekly_arena_results(p_arena_id) — ranked leaderboard
--
-- RANK() OVER (ORDER BY score DESC): equal scores get equal rank (P1.7).
--   No join_at tie-break — simultaneous players with same score share rank.
-- Leaderboard: returned ONLY after arena effective status = 'finished' (P0.3).
--   During LIVE: leaderboard = [], my_result has no score/rank.
-- Does not expose individual answers or correct_index.
-- ──────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_weekly_arena_results(p_arena_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid        uuid := auth.uid();
  v_arena      RECORD;
  v_eff_status text;
BEGIN
  SELECT * INTO v_arena FROM weekly_arenas WHERE id = p_arena_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'arena_not_found');
  END IF;

  -- Effective status from server clock
  v_eff_status := CASE
    WHEN v_arena.starts_at <= now() AND now() < v_arena.ends_at THEN 'live'
    WHEN now() < v_arena.starts_at                               THEN 'upcoming'
    ELSE                                                               'finished'
  END;

  -- During LIVE: return minimal info; no leaderboard scores (P0.3)
  IF v_eff_status <> 'finished' THEN
    RETURN jsonb_build_object(
      'ok',    true,
      'arena', jsonb_build_object(
        'id',          v_arena.id,
        'title',       v_arena.title,
        'eff_status',  v_eff_status,
        'ends_at',     v_arena.ends_at
      ),
      'leaderboard', '[]'::jsonb,
      'my_result', (
        SELECT jsonb_build_object(
          'answered', (
            SELECT COUNT(*)::int FROM weekly_arena_answers waa
            WHERE waa.arena_id = p_arena_id AND waa.scoring_user_id = v_uid
          ),
          'total_questions', wap.total_questions,
          'completed',       wap.completed_at IS NOT NULL
        )
        FROM weekly_arena_participants wap
        WHERE wap.arena_id = p_arena_id AND wap.scoring_user_id = v_uid
      )
    );
  END IF;

  -- After FINISHED: full leaderboard with RANK() — equal scores share rank (P1.7)
  RETURN jsonb_build_object(
    'ok',   true,
    'arena', jsonb_build_object(
      'id',          v_arena.id,
      'title',       v_arena.title,
      'eff_status',  v_eff_status,
      'ends_at',     v_arena.ends_at
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
          'is_me',           ranked.scoring_user_id = v_uid
        ) ORDER BY ranked.rn
      )
      FROM (
        SELECT wap.*,
               RANK() OVER (ORDER BY wap.score DESC)::int AS rn
        FROM weekly_arena_participants wap
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
        'rank', (
          SELECT COUNT(*) + 1 FROM weekly_arena_participants
          WHERE arena_id = p_arena_id AND score > wap.score
        )::int,
        'completed',       wap.completed_at IS NOT NULL
      )
      FROM weekly_arena_participants wap
      WHERE wap.arena_id = p_arena_id AND wap.scoring_user_id = v_uid
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_weekly_arena_results(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_arena_results(uuid) TO authenticated;


-- ──────────────────────────────────────────────────────────────────
-- §11  get_brain_fights_week() — add weekly_arena to BF aggregation
--
-- Changes from migration 76:
--   player_scores: source_type IN ('superq', 'weekly_arena')  [was = 'superq']
--   my_contrib: returns superq_pts, weekly_arena_pts, total   [was superq_pts only]
--     uses scoring_user_id for filtering (migration 76 fix; preserved here)
--   Everything else: identical to migration 76 version.
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
    player_scores AS (
      SELECT
        bfc.scoring_user_id,
        bfc.user_id,
        bfc.team_id,
        SUM(bfc.points) AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       IS NOT NULL
        AND bfc.source_type   IN ('superq', 'weekly_arena')
      GROUP BY bfc.scoring_user_id, bfc.user_id, bfc.team_id
    ),
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
        t.name, t.emoji, t.city
      FROM team_totals tt
      JOIN teams t ON t.id = tt.team_id AND t.disbanded_at IS NULL
    ),
    my_team_row AS (
      SELECT rl.points, rl.global_rank, rl.city_rank,
             rl.total_global_teams, rl.total_city_teams
      FROM ranked_lb rl
      WHERE rl.team_id = v_team_id
    ),
    -- My verified BF contributions for THIS TEAM this week (both source types)
    my_contrib AS (
      SELECT
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'superq'),        0) AS superq_pts,
        COALESCE(SUM(bfc.points) FILTER (WHERE bfc.source_type = 'weekly_arena'),  0) AS weekly_arena_pts
      FROM brain_fight_contributions bfc
      WHERE bfc.scoring_user_id = v_uid
        AND bfc.team_id         = v_team_id
        AND bfc.week_start      = v_week_start
        AND bfc.source_type     IN ('superq', 'weekly_arena')
    ),
    display_contributors AS (
      SELECT
        ps.user_id,
        ps.total                                                        AS points,
        pr.display_name,
        pr.avatar_url,
        ROW_NUMBER() OVER (ORDER BY ps.total DESC)::int                 AS rn
      FROM player_scores ps
      JOIN profiles pr ON pr.id = ps.user_id
      WHERE ps.team_id  = v_team_id
        AND ps.user_id IS NOT NULL
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
      SELECT t.id, t.name, t.emoji, t.city
      FROM teams t WHERE t.id = v_team_id
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
          'total_city_teams',   mtr.total_city_teams
        )
        FROM team_info ti
        LEFT JOIN my_team_row mtr ON true
      ),
      'my_contrib', (
        SELECT jsonb_build_object(
          'superq_pts',       mc.superq_pts,
          'weekly_arena_pts', mc.weekly_arena_pts,
          'total',            mc.superq_pts + mc.weekly_arena_pts
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
            'team_id',           rl.team_id,
            'name',              rl.name,
            'emoji',             rl.emoji,
            'city',              rl.city,
            'points',            rl.points,
            'global_rank',       rl.global_rank,
            'city_rank',         rl.city_rank,
            'is_my_team',        rl.team_id = v_team_id
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
-- §12  sync_team_brain_fights_daily() — add weekly_arena
--
-- Change: source_type IN ('superq', 'weekly_arena')  [was = 'superq']
-- Everything else identical to migration 76.
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
        bfc.scoring_user_id,
        SUM(bfc.points)               AS total,
        ROW_NUMBER() OVER (ORDER BY SUM(bfc.points) DESC)::int AS rn
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       = v_team.id
        AND bfc.source_type   IN ('superq', 'weekly_arena')
      GROUP BY bfc.scoring_user_id
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
-- §13  finalize_weekly_brain_fights() — add weekly_arena
--
-- Change: source_type IN ('superq', 'weekly_arena')  [was = 'superq']
-- Everything else identical to migration 76 (global ranking preserved,
-- points map preserved, idempotent ON CONFLICT preserved).
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
  PERFORM sync_team_brain_fights_daily();

  FOR v_row IN
    WITH player_scores AS (
      SELECT
        bfc.scoring_user_id,
        bfc.team_id,
        SUM(bfc.points) AS total
      FROM brain_fight_contributions bfc
      WHERE bfc.week_start    = v_week_start
        AND bfc.team_id       IS NOT NULL
        AND bfc.source_type   IN ('superq', 'weekly_arena')
      GROUP BY bfc.scoring_user_id, bfc.team_id
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
    ORDER BY team_score DESC
  LOOP
    v_pts := CASE
      WHEN v_rank <= array_length(v_points_map, 1) THEN v_points_map[v_rank]
      ELSE 0
    END;

    IF v_pts > 0 THEN
      INSERT INTO challenge_results
        (team_id, provider_id, challenge_type, rank, points_earned, week_start)
      VALUES
        (v_row.team_id, 'bfc_internal', 'brain_fights', v_rank, v_pts, v_week_start)
      ON CONFLICT ON CONSTRAINT cr_bf_team_week_unique DO NOTHING;
    END IF;

    v_rank := v_rank + 1;
  END LOOP;

  DELETE FROM team_weekly_brain_fights WHERE week_start = v_week_start;
  DELETE FROM player_weekly_bf_points   WHERE week_start = v_week_start;
END;
$$;


COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- SECURITY SUMMARY
--
-- official_tournament_answers:
--   BEFORE: no RLS → anon INSERT with arbitrary is_correct/points
--   AFTER:  RLS ON, own SELECT only, no client INSERT
--
-- weekly_arenas:             SELECT public (timestamps visible for UI)
-- weekly_arena_questions:    NO policies — RLS blocks all client access
-- weekly_arena_participants: NO policies — RLS blocks all client access
-- weekly_arena_answers:      NO policies — RLS blocks all client access
--
-- Answer-key path (P0.1 — complete fix):
--   REVOKE SELECT (correct_index) ON questions FROM anon, authenticated.
--   PostgREST respects column-level privileges: column excluded from SELECT *;
--   explicit column request returns 403. SECURITY DEFINER functions unaffected.
--   Client receives waq_id (weekly_arena_questions.id), NOT question_id.
--   No client SELECT on weekly_arena_questions → cannot map waq_id→question_id.
--   Even if attacker matches question_text → question_id via REST, get_question_reveals()
--   returns no row for questions in a live Arena → correct_index still unavailable.
--   Server resolves waq_id→question_id→correct_index internally.
--   correct_index never appears in any RPC response.
--   get_question_reveals(ids): non-Arena correct_index for authenticated clients.
--   get_question_reveals_admin(ids): all correct_indexes for is_admin users.
--
-- BF week attribution (P0.6 fix):
--   submit_weekly_arena_answer: v_week_start from DATE_TRUNC(arena.starts_at)
--   not from now() — all participants completing the same Arena credit the
--   same BF week regardless of finish time (cross-midnight fix).
--
-- LIVE answered count (P0.7 fix):
--   get_weekly_arena_results LIVE branch: actual COUNT(*) from weekly_arena_answers
--   not the tautology wap.correct + (wap.total_questions - wap.correct).
--
-- Competitive integrity (P0.3):
--   submit returns: ok, accepted, answered, total_questions, completed, bf_pts
--   No is_correct / correct_index / points / total_score in response
--   get_weekly_arena my_participation during LIVE: no score/correct
--   get_weekly_arena_results leaderboard: empty during LIVE
--
-- Eligibility (P0.4):
--   All RPCs use starts_at <= now() < ends_at (server clock only)
--   Stored status column is admin display only
--
-- Ranking (P1.7):
--   RANK() OVER (ORDER BY score DESC) — equal scores share rank
--   No joined_at tie-break
--
-- BF aggregation (P0.2, §11–§13):
--   source_type IN ('superq', 'weekly_arena') in all three BF functions
--   my_contrib returns superq_pts, weekly_arena_pts, total
--   scoring_user_id used for filtering (stable; migration 76 pattern)
-- ══════════════════════════════════════════════════════════════════
