-- ══════════════════════════════════════════════════════════════════
-- Migration 93: Duel → game_session link + duels_won in stats
-- ══════════════════════════════════════════════════════════════════
-- Root cause: start_duel() inserts game_sessions for both players but
-- does not record which session belongs to which player.  get_duel_result
-- therefore cannot write won/score/correct_answers back to game_sessions.
-- Result: history always shows "—", accuracy is 0 for real duels.
--
-- Fix plan:
--   1. Add host_session_id / guest_session_id columns to duel_rooms.
--   2. Capture session IDs in start_duel() at INSERT time (minimal diff
--      from M87 live body — only RETURNING + UPDATE columns added).
--   3. Write BOTH players' results atomically in get_duel_result()
--      when the duel is finalized.  Whichever player calls first writes
--      both rows; the second caller hits the 'finished' branch which is
--      already idempotent.
--   4. Add duels_won to player_stats view (CREATE OR REPLACE — no DROP CASCADE).
--   5. Add duels_won to get_public_profile RPC.
--
-- Tie contract: game_sessions.won = NULL means tie.
--   won = true  → player won
--   won = false → player lost
--   won = NULL  → tie (or result not yet written — indistinguishable until M93 applied)
--
-- Dependency audit (player_stats):
--   sql/17_fixes.sql created the view.  No other migration references it
--   via a dependent view or function.  GRANT SELECT is to authenticated+anon.
--   CREATE OR REPLACE VIEW preserves column order and adds duels_won at end.
--
-- Live start_duel comparison (M87 body):
--   Uses: questions table, status='active', FOREACH _opt_count loop,
--   weekly_arena_questions exclusion, no questions_count in INSERT.
--   M93 changes: + _host_sid/_guest_sid DECLARE, + RETURNING id, + UPDATE columns.
--   All other logic is byte-for-byte identical to M87.
--
-- games_played semantic note (out of scope for M93):
--   player_stats.games_played = COUNT(DISTINCT game_sessions.id) — includes
--   started-but-abandoned sessions (completed_at IS NULL).  Semantic debt noted.
--   Not fixed here; a completed_at filter would exclude real duel sessions
--   (which don't use the BF session completion flow) and needs separate work.
--
-- DO NOT APPLY until reviewed and cleared.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add session-link columns to duel_rooms ────────────────────
ALTER TABLE public.duel_rooms
  ADD COLUMN IF NOT EXISTS host_session_id  uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL;

-- ── 2. start_duel — minimal diff from M87 live body ──────────────
-- Changes vs M87: added _host_sid/_guest_sid DECLARE vars, RETURNING id
-- captures, and two new SET columns on duel_rooms UPDATE.
-- All other logic (question filter, locks, eligibility, progression)
-- is semantically identical to M87.
CREATE OR REPLACE FUNCTION public.start_duel(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid              uuid := auth.uid();
  _room             duel_rooms%ROWTYPE;
  v_day             DATE := (NOW() AT TIME ZONE 'UTC')::DATE;
  _host_elig        jsonb;
  _guest_elig       jsonb;
  _progression      int[]   := ARRAY[2, 3, 4, 5, 6];
  _opt_count        int;
  _used_ids         uuid[]  := ARRAY[]::uuid[];
  _staged_ids       uuid[]  := ARRAY[]::uuid[];
  _staged_corrects  int[]   := ARRAY[]::int[];
  _staged_times     int[]   := ARRAY[]::int[];
  _staged_json      jsonb   := '[]'::jsonb;
  _q_id             uuid;
  _q_text           text;
  _q_answers        jsonb;
  _q_category       text;
  _q_correct        int;
  _q_time           int;
  _idx              int := 0;
  _expires_min      int := 15;
  _lock_first       uuid;
  _lock_second      uuid;
  _host_sid         uuid;   -- M93: capture host game_session id
  _guest_sid        uuid;   -- M93: capture guest game_session id
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id != _uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_host');
  END IF;

  IF _room.status != 'ready' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_ready', 'status', _room.status);
  END IF;

  IF _room.guest_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_guest');
  END IF;

  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first  := _room.host_user_id;
    _lock_second := _room.guest_user_id;
  ELSE
    _lock_first  := _room.guest_user_id;
    _lock_second := _room.host_user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || v_day::TEXT || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || v_day::TEXT || ':battle'));

  _host_elig := _check_duel_battle_eligibility(_room.host_user_id, _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');
  END IF;

  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id, NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached');
  END IF;

  -- Question selection: identical to M87
  FOREACH _opt_count IN ARRAY _progression
  LOOP
    SELECT
      q.id,
      COALESCE(q.question_ru, q.question_text),
      COALESCE(q.answers_json, q.answers_ru),             -- M87 fix preserved
      COALESCE(q.category, 'GENERAL'),
      q.correct_index
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct
    FROM questions q
    WHERE q.status = 'active'
      AND q.question_type = 'multiple_choice'
      AND q.correct_index IS NOT NULL
      AND q.correct_index >= 0
      AND q.is_competitive_secret = false
      AND q.source_type = 'official_general'
      AND q.correct_index < jsonb_array_length(
            COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb))
      AND jsonb_array_length(COALESCE(q.answers_json, q.answers_ru, '[]'::jsonb)) = _opt_count
      AND NOT (q.id = ANY(_used_ids))
      AND q.id NOT IN (
        SELECT waq.question_id
        FROM weekly_arena_questions waq
        JOIN weekly_arenas wa ON wa.id = waq.arena_id
        WHERE now() < wa.ends_at
      )
    ORDER BY random()
    LIMIT 1;

    IF NOT FOUND OR _q_id IS NULL THEN
      RETURN jsonb_build_object(
        'ok', false,
        'error', 'not_enough_questions',
        'needed_opt_count', _opt_count
      );
    END IF;

    _q_time := CASE _opt_count
      WHEN 2 THEN 30 WHEN 3 THEN 35 WHEN 4 THEN 40
      WHEN 5 THEN 45 WHEN 6 THEN 50 ELSE 30
    END;

    _staged_ids      := _staged_ids     || ARRAY[_q_id];
    _staged_corrects := _staged_corrects || ARRAY[_q_correct];
    _staged_times    := _staged_times   || ARRAY[_q_time];
    _staged_json     := _staged_json || jsonb_build_array(jsonb_build_object(
      'idx', _idx, 'cat', _q_category, 'q', _q_text, 'a', _q_answers, 't', _q_time
    ));
    _used_ids := _used_ids || ARRAY[_q_id];
    _idx := _idx + 1;
  END LOOP;

  DELETE FROM duel_question_assignments WHERE duel_code = p_code;

  FOR _idx IN 1..array_length(_staged_ids, 1)
  LOOP
    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx - 1, _staged_ids[_idx], _staged_corrects[_idx], _staged_times[_idx]);
  END LOOP;

  -- M93: INSERT with RETURNING to capture session IDs
  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.host_user_id, 'friend_battle', v_day, _room.guest_user_id, (_host_elig->>'social_bonus')::boolean)
  RETURNING id INTO _host_sid;

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus)
  VALUES (_room.guest_user_id, 'friend_battle', v_day, _room.host_user_id, (_guest_elig->>'social_bonus')::boolean)
  RETURNING id INTO _guest_sid;

  UPDATE duel_rooms SET
    status            = 'started',
    started_at        = now(),
    expires_at        = now() + (_expires_min || ' minutes')::interval,
    host_score        = 0,
    guest_score       = 0,
    host_answers      = '[]'::jsonb,
    guest_answers     = '[]'::jsonb,
    host_done         = false,
    guest_done        = false,
    winner_id         = NULL,
    finished_at       = NULL,
    host_session_id   = _host_sid,   -- M93
    guest_session_id  = _guest_sid   -- M93
  WHERE code = p_code;

  RETURN jsonb_build_object(
    'ok',        true,
    'questions', _staged_json,
    'expires_at', (now() + (_expires_min || ' minutes')::interval)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.start_duel(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_duel(text) TO authenticated;

-- ── 3. get_duel_result — write BOTH sessions on finalization ─────
-- Changes vs M78: added _host_correct/_guest_correct, and the dual
-- UPDATE game_sessions block after UPDATE duel_rooms.  All existing
-- guards, locking, and score logic are identical to M78.
--
-- Already-finished branch: sessions already written, returns stored result.
-- Idempotent: status='started' guard prevents double-finalize.
CREATE OR REPLACE FUNCTION public.get_duel_result(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid           uuid := auth.uid();
  _room          duel_rooms%ROWTYPE;
  _role          text;
  _host_done     boolean;
  _guest_done    boolean;
  _host_score    int;
  _guest_score   int;
  _my_score      int;
  _op_score      int;
  _my_correct    int;
  _host_correct  int;   -- M93
  _guest_correct int;   -- M93
  _win           boolean;
  _tie           boolean;
  _total_qs      int;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF _room.host_user_id = _uid THEN
    _role := 'host';
  ELSIF _room.guest_user_id = _uid THEN
    _role := 'guest';
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  SELECT COUNT(*) INTO _total_qs FROM duel_question_assignments WHERE duel_code = p_code;

  SELECT COUNT(*) >= _total_qs INTO _host_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
  SELECT COUNT(*) >= _total_qs INTO _guest_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  -- Already finished: idempotent. Sessions were written by first finalizer.
  IF _room.status = 'finished' THEN
    SELECT COALESCE(SUM(points), 0) INTO _host_score
    FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
    SELECT COALESCE(SUM(points), 0) INTO _guest_score
    FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;
    _my_score := CASE _role WHEN 'host' THEN _host_score ELSE _guest_score END;
    _op_score := CASE _role WHEN 'host' THEN _guest_score ELSE _host_score END;
    _win := CASE _role WHEN 'host' THEN _room.winner_id = _room.host_user_id ELSE _room.winner_id = _room.guest_user_id END;
    _tie := _room.winner_id IS NULL AND _room.finished_at IS NOT NULL;
    SELECT COUNT(*) INTO _my_correct FROM duel_answers WHERE duel_code = p_code AND user_id = _uid AND is_correct = true;
    RETURN jsonb_build_object(
      'ok', true, 'waiting', false, 'win', _win, 'tie', _tie,
      'my_score', _my_score, 'op_score', _op_score, 'correct_count', _my_correct
    );
  END IF;

  DECLARE
    _expired   boolean := (_room.expires_at IS NOT NULL AND now() >= _room.expires_at);
    _both_done boolean := (_host_done AND _guest_done);
  BEGIN
    IF NOT _both_done AND NOT _expired THEN
      RETURN jsonb_build_object('ok', true, 'waiting', true);
    END IF;
  END;

  SELECT COALESCE(SUM(points), 0) INTO _host_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
  SELECT COALESCE(SUM(points), 0) INTO _guest_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  _my_score := CASE _role WHEN 'host' THEN _host_score ELSE _guest_score END;
  _op_score := CASE _role WHEN 'host' THEN _guest_score ELSE _host_score END;
  _win      := _my_score > _op_score;
  _tie      := _my_score = _op_score;

  -- Finalize exactly once (status='started' guard)
  UPDATE duel_rooms SET
    status      = 'finished',
    finished_at = now(),
    host_score  = _host_score,
    guest_score = _guest_score,
    winner_id   = CASE
      WHEN _host_score > _guest_score THEN _room.host_user_id
      WHEN _guest_score > _host_score THEN _room.guest_user_id
      ELSE NULL  -- tie
    END
  WHERE code = p_code AND status = 'started';

  -- M93: write BOTH players' results atomically.
  -- Tie: won = NULL (nullable boolean — game_sessions schema supports this).
  SELECT COUNT(*) INTO _host_correct
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id AND is_correct = true;
  SELECT COUNT(*) INTO _guest_correct
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id AND is_correct = true;

  IF _room.host_session_id IS NOT NULL THEN
    UPDATE game_sessions SET
      won             = CASE
                          WHEN _host_score > _guest_score THEN true
                          WHEN _host_score < _guest_score THEN false
                          ELSE NULL  -- tie
                        END,
      score           = _host_score,
      correct_answers = _host_correct,
      questions_count = _total_qs
    WHERE id = _room.host_session_id;
  END IF;

  IF _room.guest_session_id IS NOT NULL THEN
    UPDATE game_sessions SET
      won             = CASE
                          WHEN _guest_score > _host_score THEN true
                          WHEN _guest_score < _host_score THEN false
                          ELSE NULL  -- tie
                        END,
      score           = _guest_score,
      correct_answers = _guest_correct,
      questions_count = _total_qs
    WHERE id = _room.guest_session_id;
  END IF;

  _my_correct := CASE _role WHEN 'host' THEN _host_correct ELSE _guest_correct END;

  RETURN jsonb_build_object(
    'ok', true, 'waiting', false,
    'win', _win, 'tie', _tie,
    'my_score', _my_score, 'op_score', _op_score,
    'correct_count', _my_correct
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_duel_result(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_duel_result(text) TO authenticated;

-- ── 4. player_stats — CREATE OR REPLACE, no DROP CASCADE ─────────
-- Existing columns preserved in exact order (user_id, display_name, city,
-- neurons, xp, streak, best_streak, games_played, duels_played, packs_played,
-- correct_total, questions_total, accuracy_pct).  duels_won appended at end.
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
  -- M93: wins exclude draws (won=NULL = tie, won=false = loss)
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')
      AND gs.won = true
  )                                                                 AS duels_won
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;

-- ── 5. get_public_profile — add duels_won ────────────────────────
CREATE OR REPLACE FUNCTION public.get_public_profile(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  SELECT
    p.id,
    p.display_name,
    p.city,
    p.neurons,
    p.xp,
    p.avatar_url,
    COALESCE(p.daily_streak, 0)        AS streak,
    COALESCE(p.best_daily_streak, 0)   AS best_streak,
    COUNT(DISTINCT gs.id)              AS games_played,
    COUNT(DISTINCT gs.id) FILTER (
      WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')
    )                                  AS duels_played,
    COUNT(DISTINCT gs.id) FILTER (
      WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')
        AND gs.won = true
    )                                  AS duels_won,
    COALESCE(SUM(gs.correct_answers), 0) AS correct_total,
    COALESCE(SUM(gs.questions_count), 0) AS questions_total,
    CASE
      WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
      ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
    END AS accuracy_pct
  INTO v_row
  FROM profiles p
  LEFT JOIN game_sessions gs ON gs.user_id = p.id
  WHERE p.id = p_user_id
  GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.avatar_url, p.daily_streak, p.best_daily_streak;

  IF v_row.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  RETURN jsonb_build_object(
    'ok',           true,
    'user_id',      v_row.id,
    'display_name', v_row.display_name,
    'city',         v_row.city,
    'neurons',      v_row.neurons,
    'xp',           v_row.xp,
    'avatar_url',   v_row.avatar_url,
    'streak',       v_row.streak,
    'best_streak',  v_row.best_streak,
    'games_played', v_row.games_played,
    'duels_played', v_row.duels_played,
    'duels_won',    v_row.duels_won,
    'correct_total',v_row.correct_total,
    'accuracy_pct', v_row.accuracy_pct
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_public_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_profile(uuid) TO authenticated, anon;

COMMIT;
