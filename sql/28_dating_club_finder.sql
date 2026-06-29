-- ── Migration 28: BFC Match + Club Finder ────────────────────────

-- ── Profile expansion ─────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS gender       text CHECK (gender IN ('male','female','other'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS looking_for  text CHECK (looking_for IN ('male','female','all'));
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS birth_date   date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS bio          text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url   text;

-- ── dating_rooms ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dating_rooms (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  player_1_id         uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player_2_id         uuid        REFERENCES profiles(id) ON DELETE SET NULL,
  current_question_id uuid        REFERENCES questions(id) ON DELETE SET NULL,
  question_ids        uuid[]      NOT NULL DEFAULT '{}',  -- pre-fetched set of 5
  question_index      int         NOT NULL DEFAULT 0,
  p1_current_choice   text,
  p2_current_choice   text,
  consensus_locked    boolean     NOT NULL DEFAULT false,  -- prevents race on double-submit
  p1_score            int         NOT NULL DEFAULT 0,
  p2_score            int         NOT NULL DEFAULT 0,
  p1_liked            boolean,
  p2_liked            boolean,
  status              text        NOT NULL DEFAULT 'searching'
    CHECK (status IN ('searching','playing','game_over','matched','closed')),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dr_p1     ON dating_rooms(player_1_id);
CREATE INDEX IF NOT EXISTS idx_dr_p2     ON dating_rooms(player_2_id);
CREATE INDEX IF NOT EXISTS idx_dr_status ON dating_rooms(status);

ALTER TABLE dating_rooms ENABLE ROW LEVEL SECURITY;

-- Participants can read their own room
CREATE POLICY "dr_participant_read"
  ON dating_rooms FOR SELECT
  USING (auth.uid() = player_1_id OR auth.uid() = player_2_id);

-- Only RPC functions (SECURITY DEFINER) write — no direct client writes
CREATE POLICY "dr_no_direct_write"
  ON dating_rooms FOR ALL
  USING (false)
  WITH CHECK (false);

-- ── RPC: enter_dating_queue ───────────────────────────────────────
-- Finds a waiting room or creates one. Returns room id + role.
CREATE OR REPLACE FUNCTION enter_dating_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_room dating_rooms%ROWTYPE;
  v_qids uuid[];
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_authenticated'); END IF;

  -- Already in an active room?
  SELECT * INTO v_room FROM dating_rooms
  WHERE (player_1_id = v_uid OR player_2_id = v_uid)
    AND status IN ('searching','playing')
  LIMIT 1;
  IF FOUND THEN
    RETURN jsonb_build_object('ok',true,'room_id',v_room.id,
      'role', CASE WHEN v_room.player_1_id = v_uid THEN 'p1' ELSE 'p2' END,
      'status', v_room.status);
  END IF;

  -- Find a waiting room from another player
  SELECT * INTO v_room FROM dating_rooms
  WHERE status = 'searching' AND player_2_id IS NULL AND player_1_id <> v_uid
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    -- Pick 5 random active questions
    SELECT array_agg(id) INTO v_qids
    FROM (SELECT id FROM questions WHERE status = 'active' ORDER BY random() LIMIT 5) q;

    UPDATE dating_rooms
    SET player_2_id = v_uid, status = 'playing',
        question_ids = v_qids, current_question_id = v_qids[1]
    WHERE id = v_room.id;

    RETURN jsonb_build_object('ok',true,'room_id',v_room.id,'role','p2','status','playing');
  END IF;

  -- Create new room, wait for opponent
  INSERT INTO dating_rooms (player_1_id, status) VALUES (v_uid, 'searching')
  RETURNING * INTO v_room;

  RETURN jsonb_build_object('ok',true,'room_id',v_room.id,'role','p1','status','searching');
END;$$;
GRANT EXECUTE ON FUNCTION enter_dating_queue() TO authenticated;

-- ── RPC: submit_dating_like ───────────────────────────────────────
CREATE OR REPLACE FUNCTION submit_dating_like(p_room_id uuid, p_liked boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_room dating_rooms%ROWTYPE;
  v_both boolean;
BEGIN
  SELECT * INTO v_room FROM dating_rooms WHERE id = p_room_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','not_found'); END IF;
  IF v_room.player_1_id <> v_uid AND v_room.player_2_id <> v_uid THEN
    RETURN jsonb_build_object('ok',false,'reason','not_participant');
  END IF;

  IF v_room.player_1_id = v_uid THEN
    UPDATE dating_rooms SET p1_liked = p_liked WHERE id = p_room_id;
  ELSE
    UPDATE dating_rooms SET p2_liked = p_liked WHERE id = p_room_id;
  END IF;

  -- Check mutual match
  SELECT (p1_liked = true AND p2_liked = true) INTO v_both
  FROM dating_rooms WHERE id = p_room_id;

  IF v_both THEN
    UPDATE dating_rooms SET status = 'matched' WHERE id = p_room_id;
    -- Award both players
    UPDATE profiles SET neurons = neurons + 100
    WHERE id IN (v_room.player_1_id, v_room.player_2_id);
  END IF;

  RETURN jsonb_build_object('ok',true,'matched',COALESCE(v_both,false));
END;$$;
GRANT EXECUTE ON FUNCTION submit_dating_like(uuid,boolean) TO authenticated;

-- ── club_recruitment_board ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS club_recruitment_board (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id     uuid        NOT NULL REFERENCES teams_v2(id) ON DELETE CASCADE,
  creator_id  uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       text        NOT NULL,
  description text,
  category    text,
  city        text,
  slots_open  int         NOT NULL DEFAULT 1,
  is_active   boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crb_club     ON club_recruitment_board(club_id);
CREATE INDEX IF NOT EXISTS idx_crb_active   ON club_recruitment_board(is_active, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_crb_city     ON club_recruitment_board(city);
CREATE INDEX IF NOT EXISTS idx_crb_category ON club_recruitment_board(category);

ALTER TABLE club_recruitment_board ENABLE ROW LEVEL SECURITY;

CREATE POLICY "crb_public_read"
  ON club_recruitment_board FOR SELECT USING (true);

CREATE POLICY "crb_creator_write"
  ON club_recruitment_board FOR ALL
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);

-- ── RPC: apply_to_club ────────────────────────────────────────────
-- Sends push notification to club creator with applicant stats.
CREATE OR REPLACE FUNCTION apply_to_club(p_post_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid      uuid := auth.uid();
  v_post     club_recruitment_board%ROWTYPE;
  v_applicant record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','not_authenticated'); END IF;

  SELECT * INTO v_post FROM club_recruitment_board WHERE id = p_post_id AND is_active = true;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'reason','post_not_found'); END IF;
  IF v_post.creator_id = v_uid THEN RETURN jsonb_build_object('ok',false,'reason','own_post'); END IF;

  SELECT display_name, neurons, xp INTO v_applicant FROM profiles WHERE id = v_uid;

  -- Notify creator via push_subscriptions (Edge Function picks this up)
  INSERT INTO push_queue (recipient_id, title, body, url, created_at)
  VALUES (
    v_post.creator_id,
    '👥 Новая заявка в клуб',
    (v_applicant.display_name || ' хочет вступить · ' || COALESCE(v_applicant.xp,0)::text || ' XP'),
    '/?uid=' || v_uid::text,
    now()
  ) ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object('ok',true,
    'creator_id', v_post.creator_id,
    'applicant', jsonb_build_object(
      'id', v_uid,
      'name', v_applicant.display_name,
      'xp', v_applicant.xp,
      'neurons', v_applicant.neurons
    )
  );
END;$$;
GRANT EXECUTE ON FUNCTION apply_to_club(uuid) TO authenticated;

-- push_queue table (lightweight, Edge Function polls it)
CREATE TABLE IF NOT EXISTS push_queue (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title        text        NOT NULL,
  body         text        NOT NULL,
  url          text,
  sent         boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE push_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pq_service_only" ON push_queue FOR ALL USING (false);
