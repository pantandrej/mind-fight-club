-- ══════════════════════════════════════════════════════════════════
-- 67_security_hardening.sql
-- 1. RLS на challenge_results — прямой INSERT с клиента запрещён всем.
--    Все записи идут через SECURITY DEFINER функции (finalize_weekly_brain_fights,
--    scout_record_bar_quiz), которые исполняются от имени postgres и обходят RLS.
-- 2. Защита scout_record_bar_quiz — серверная проверка is_scout внутри функции.
-- ══════════════════════════════════════════════════════════════════

-- ── 1. RLS для challenge_results ─────────────────────────────────

ALTER TABLE public.challenge_results ENABLE ROW LEVEL SECURITY;

-- Чтение — публичное (для лидербордов)
DROP POLICY IF EXISTS "challenge_results_select_all" ON public.challenge_results;
CREATE POLICY "challenge_results_select_all"
  ON public.challenge_results
  FOR SELECT
  USING (true);

-- INSERT/UPDATE/DELETE — запрещены для всех ролей с клиента.
-- SECURITY DEFINER функции работают от имени postgres, RLS для них не применяется.
DROP POLICY IF EXISTS "challenge_results_insert_deny" ON public.challenge_results;
-- (отсутствие INSERT-политики при включённом RLS = полный запрет)

DROP POLICY IF EXISTS "challenge_results_update_deny" ON public.challenge_results;
DROP POLICY IF EXISTS "challenge_results_delete_deny" ON public.challenge_results;

-- ── 2. Усиление scout_record_bar_quiz — проверка is_scout на сервере ──

CREATE OR REPLACE FUNCTION public.scout_record_bar_quiz(
  p_provider_id uuid,
  p_results     jsonb   -- [{name: text, rank: int}, ...]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_is_scout   boolean;
  v_item       jsonb;
  v_team_id    uuid;
  v_not_found  text[] := '{}';
  v_inserted   int    := 0;
  v_event_date date   := now()::date;
BEGIN
  -- Аутентификация
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'unauthenticated');
  END IF;

  -- Серверная проверка is_scout — клиентский флаг не доверенен
  SELECT is_scout INTO v_is_scout FROM profiles WHERE id = v_user_id;
  IF NOT COALESCE(v_is_scout, false) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_scout');
  END IF;

  -- Провайдер должен существовать
  IF NOT EXISTS (SELECT 1 FROM providers WHERE id = p_provider_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_provider');
  END IF;

  -- Обработка результатов
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_results)
  LOOP
    SELECT id INTO v_team_id
    FROM teams
    WHERE lower(name) = lower(trim(v_item->>'name'))
    LIMIT 1;

    IF v_team_id IS NULL THEN
      v_not_found := v_not_found || (v_item->>'name');
      CONTINUE;
    END IF;

    INSERT INTO challenge_results (team_id, provider_id, challenge_type, rank, points_earned)
    VALUES (
      v_team_id,
      p_provider_id,
      'bar_quiz',
      (v_item->>'rank')::int,
      CASE (v_item->>'rank')::int
        WHEN 1 THEN 100
        WHEN 2 THEN 80
        WHEN 3 THEN 60
        WHEN 4 THEN 40
        WHEN 5 THEN 20
        WHEN 6 THEN 10
        WHEN 7 THEN 10
        WHEN 8 THEN 10
        WHEN 9 THEN 10
        WHEN 10 THEN 10
        ELSE 5
      END
    )
    ON CONFLICT DO NOTHING;

    v_inserted := v_inserted + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok',        true,
    'inserted',  v_inserted,
    'not_found', v_not_found
  );
END;
$$;

-- Права: только аутентифицированные пользователи могут вызвать RPC,
-- но is_scout проверяется внутри функции на сервере.
REVOKE ALL ON FUNCTION public.scout_record_bar_quiz(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.scout_record_bar_quiz(uuid, jsonb) TO authenticated;
