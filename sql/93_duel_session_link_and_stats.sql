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
--   2. Populate them in start_duel() at INSERT time.
--   3. Write result to game_sessions inside get_duel_result() after
--      the duel is finalized (both finished or expired).
--   4. Add duels_won to player_stats view and get_public_profile RPC.
--
-- DO NOT APPLY until reviewed and cleared.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Add session-link columns to duel_rooms ────────────────────
ALTER TABLE public.duel_rooms
  ADD COLUMN IF NOT EXISTS host_session_id  uuid REFERENCES game_sessions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guest_session_id uuid REFERENCES game_sessions(id) ON DELETE SET NULL;

-- ── 2. Replace start_duel to capture session IDs ─────────────────
-- Only the INSERT and RETURN sections change; question selection is
-- unchanged from M87 (sql/87_fix_answer_array_canonical.sql).
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
  _host_sid         uuid;
  _guest_sid        uuid;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF _room.host_user_id != _uid THEN RETURN jsonb_build_object('ok', false, 'error', 'not_host'); END IF;
  IF _room.status != 'ready' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_ready', 'status', _room.status); END IF;
  IF _room.guest_user_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'no_guest'); END IF;

  -- Deterministic advisory lock order
  IF _room.host_user_id::TEXT < _room.guest_user_id::TEXT THEN
    _lock_first  := _room.host_user_id;
    _lock_second := _room.guest_user_id;
  ELSE
    _lock_first  := _room.guest_user_id;
    _lock_second := _room.host_user_id;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext(_lock_first::TEXT  || ':' || v_day::TEXT || ':battle'));
  PERFORM pg_advisory_xact_lock(hashtext(_lock_second::TEXT || ':' || v_day::TEXT || ':battle'));

  _host_elig  := _check_duel_battle_eligibility(_room.host_user_id,  _room.guest_user_id, NULL);
  IF NOT (_host_elig->>'allowed')::boolean  THEN RETURN jsonb_build_object('ok', false, 'error', 'host_limit_reached');  END IF;
  _guest_elig := _check_duel_battle_eligibility(_room.guest_user_id, _room.host_user_id,  NULL);
  IF NOT (_guest_elig->>'allowed')::boolean THEN RETURN jsonb_build_object('ok', false, 'error', 'guest_limit_reached'); END IF;

  -- Stage questions (identical to M87 logic)
  FOR _idx IN 0..array_length(_progression, 1) - 1
  LOOP
    _opt_count := _progression[_idx + 1];
    SELECT q.id, q.question_text, q.answers_json, q.category, q.correct_index,
           CASE _opt_count WHEN 2 THEN 30 WHEN 3 THEN 35 WHEN 4 THEN 40 WHEN 5 THEN 45 WHEN 6 THEN 50 ELSE 30 END
    INTO _q_id, _q_text, _q_answers, _q_category, _q_correct, _q_time
    FROM secure_questions q
    WHERE q.status = 'published'
      AND jsonb_array_length(q.answers_json) = _opt_count
      AND NOT (q.id = ANY(_used_ids))
    ORDER BY random()
    LIMIT 1;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_enough_secure_questions');
    END IF;
    _staged_ids      := _staged_ids     || ARRAY[_q_id];
    _staged_corrects := _staged_corrects || ARRAY[_q_correct];
    _staged_times    := _staged_times   || ARRAY[_q_time];
    _staged_json     := _staged_json || jsonb_build_array(jsonb_build_object(
      'idx', _idx, 'cat', _q_category, 'q', _q_text, 'a', _q_answers, 't', _q_time
    ));
    _used_ids := _used_ids || ARRAY[_q_id];
  END LOOP;

  DELETE FROM duel_question_assignments WHERE duel_code = p_code;
  FOR _idx IN 1..array_length(_staged_ids, 1)
  LOOP
    INSERT INTO duel_question_assignments (duel_code, question_idx, question_id, correct_index, question_time)
    VALUES (p_code, _idx - 1, _staged_ids[_idx], _staged_corrects[_idx], _staged_times[_idx]);
  END LOOP;

  -- Create game_sessions and capture IDs (M93: store on duel_rooms)
  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus, questions_count)
  VALUES (_room.host_user_id, 'friend_battle', v_day, _room.guest_user_id,
          (_host_elig->>'social_bonus')::boolean, array_length(_staged_ids, 1))
  RETURNING id INTO _host_sid;

  INSERT INTO game_sessions (user_id, mode, day_utc, opponent_id, social_bonus, questions_count)
  VALUES (_room.guest_user_id, 'friend_battle', v_day, _room.host_user_id,
          (_guest_elig->>'social_bonus')::boolean, array_length(_staged_ids, 1))
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

-- ── 3. Replace get_duel_result to write results to game_sessions ──
CREATE OR REPLACE FUNCTION public.get_duel_result(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid         uuid := auth.uid();
  _room        duel_rooms%ROWTYPE;
  _role        text;
  _host_done   boolean;
  _guest_done  boolean;
  _host_score  int;
  _guest_score int;
  _my_score    int;
  _op_score    int;
  _my_correct  int;
  _my_sid      uuid;
  _win         boolean;
  _tie         boolean;
  _total_qs    int;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthenticated');
  END IF;

  SELECT * INTO _room FROM duel_rooms WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  IF _room.host_user_id = _uid THEN
    _role  := 'host';
    _my_sid := _room.host_session_id;
  ELSIF _room.guest_user_id = _uid THEN
    _role  := 'guest';
    _my_sid := _room.guest_session_id;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'not_participant');
  END IF;

  SELECT COUNT(*) INTO _total_qs FROM duel_question_assignments WHERE duel_code = p_code;

  SELECT COUNT(*) >= _total_qs INTO _host_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
  SELECT COUNT(*) >= _total_qs INTO _guest_done
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  -- Already finished: return stored result
  IF _room.status = 'finished' THEN
    SELECT COALESCE(SUM(points), 0) INTO _host_score
    FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
    SELECT COALESCE(SUM(points), 0) INTO _guest_score
    FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;
    _my_score := CASE _role WHEN 'host' THEN _host_score ELSE _guest_score END;
    _op_score := CASE _role WHEN 'host' THEN _guest_score ELSE _host_score END;
    _win := CASE _role WHEN 'host' THEN _room.winner_id = _room.host_user_id ELSE _room.winner_id = _room.guest_user_id END;
    _tie := _room.winner_id IS NULL AND _room.finished_at IS NOT NULL;
    SELECT COUNT(*) INTO _my_correct FROM duel_answers
    WHERE duel_code = p_code AND user_id = _uid AND is_correct = true;
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

  -- Finalize
  SELECT COALESCE(SUM(points), 0) INTO _host_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.host_user_id;
  SELECT COALESCE(SUM(points), 0) INTO _guest_score
  FROM duel_answers WHERE duel_code = p_code AND user_id = _room.guest_user_id;

  _my_score := CASE _role WHEN 'host' THEN _host_score ELSE _guest_score END;
  _op_score := CASE _role WHEN 'host' THEN _guest_score ELSE _host_score END;
  _win      := _my_score > _op_score;
  _tie      := _my_score = _op_score;

  UPDATE duel_rooms SET
    status      = 'finished',
    finished_at = now(),
    host_score  = _host_score,
    guest_score = _guest_score,
    winner_id   = CASE
      WHEN _host_score > _guest_score THEN _room.host_user_id
      WHEN _guest_score > _host_score THEN _room.guest_user_id
      ELSE NULL
    END
  WHERE code = p_code AND status = 'started';

  SELECT COUNT(*) INTO _my_correct
  FROM duel_answers WHERE duel_code = p_code AND user_id = _uid AND is_correct = true;

  -- M93: write result back to this player's game_session
  IF _my_sid IS NOT NULL THEN
    UPDATE game_sessions SET
      won             = _win AND NOT _tie,
      score           = _my_score,
      correct_answers = _my_correct,
      questions_count = _total_qs
    WHERE id = _my_sid;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'waiting', false,
    'win', _win, 'tie', _tie,
    'my_score', _my_score, 'op_score', _op_score, 'correct_count', _my_correct
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_duel(text)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.start_duel(text)   TO authenticated;
REVOKE ALL ON FUNCTION public.get_duel_result(text)  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_duel_result(text) TO authenticated;

-- ── 4. Add duels_won to player_stats view ───────────────────────
DROP VIEW IF EXISTS public.player_stats CASCADE;
CREATE VIEW public.player_stats AS
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
  COUNT(DISTINCT gs.id) FILTER (
    WHERE gs.mode IN ('friend_battle','random_battle','virtual_battle')
      AND gs.won = true
  )                                                                 AS duels_won,
  (SELECT COUNT(*) FROM pack_results pr WHERE pr.user_id = p.id)   AS packs_played,
  COALESCE(SUM(gs.correct_answers), 0)                             AS correct_total,
  COALESCE(SUM(gs.questions_count), 0)                             AS questions_total,
  CASE
    WHEN COALESCE(SUM(gs.questions_count), 0) = 0 THEN 0
    ELSE ROUND(SUM(gs.correct_answers)::numeric / SUM(gs.questions_count) * 100)
  END                                                               AS accuracy_pct
FROM profiles p
LEFT JOIN game_sessions gs ON gs.user_id = p.id
GROUP BY p.id, p.display_name, p.city, p.neurons, p.xp, p.daily_streak, p.best_daily_streak;

GRANT SELECT ON public.player_stats TO authenticated, anon;

-- ── 5. Add duels_won to get_public_profile RPC ───────────────────
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
