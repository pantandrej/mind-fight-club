-- ══════════════════════════════════════════════════════════════════
-- Migration 56: Quiz Daily Questions (Супервопрос дня)
-- ══════════════════════════════════════════════════════════════════

-- ── 1. Таблица вопросов от квизов ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_daily_questions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quiz_id        uuid NOT NULL REFERENCES public.quizzes(id) ON DELETE CASCADE,
  image_url      text NOT NULL,               -- картинка вопроса
  answer_text    text NOT NULL,               -- правильный ответ текстом
  hint_options   text,                        -- подсказки через запятую (опционально)
  scheduled_date date,                        -- дата публикации (ставит админ)
  status         text NOT NULL DEFAULT 'pending',  -- pending | approved | rejected
  submitted_at   timestamptz DEFAULT now(),
  approved_at    timestamptz,
  approved_by    uuid REFERENCES auth.users(id),
  UNIQUE (scheduled_date)                     -- один вопрос в день
);

CREATE INDEX IF NOT EXISTS idx_qdq_date   ON public.quiz_daily_questions(scheduled_date);
CREATE INDEX IF NOT EXISTS idx_qdq_quiz   ON public.quiz_daily_questions(quiz_id);
CREATE INDEX IF NOT EXISTS idx_qdq_status ON public.quiz_daily_questions(status);

ALTER TABLE public.quiz_daily_questions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qdq_public_read"  ON public.quiz_daily_questions;
DROP POLICY IF EXISTS "qdq_owner_insert" ON public.quiz_daily_questions;
DROP POLICY IF EXISTS "qdq_owner_read"   ON public.quiz_daily_questions;

-- Все видят одобренные вопросы
CREATE POLICY "qdq_public_read" ON public.quiz_daily_questions
  FOR SELECT USING (status = 'approved');

-- Организатор видит свои вопросы в любом статусе
CREATE POLICY "qdq_owner_read" ON public.quiz_daily_questions
  FOR SELECT USING (
    quiz_id IN (SELECT id FROM quizzes WHERE owner_id = auth.uid())
  );

-- Организатор может добавлять вопросы
CREATE POLICY "qdq_owner_insert" ON public.quiz_daily_questions
  FOR INSERT WITH CHECK (
    quiz_id IN (SELECT id FROM quizzes WHERE owner_id = auth.uid() AND status = 'active')
  );


-- ── 2. Таблица ответов пользователей ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.quiz_daily_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id  uuid NOT NULL REFERENCES public.quiz_daily_questions(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answer_text  text NOT NULL,
  is_correct   boolean NOT NULL DEFAULT false,
  answered_at  timestamptz DEFAULT now(),
  UNIQUE (question_id, user_id)
);

ALTER TABLE public.quiz_daily_answers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qda_own"  ON public.quiz_daily_answers;
DROP POLICY IF EXISTS "qda_read" ON public.quiz_daily_answers;

CREATE POLICY "qda_own"  ON public.quiz_daily_answers FOR ALL  USING (user_id = auth.uid());
-- Организаторы видят все ответы на свои вопросы
CREATE POLICY "qda_read" ON public.quiz_daily_answers FOR SELECT USING (
  question_id IN (
    SELECT qdq.id FROM quiz_daily_questions qdq
    JOIN quizzes q ON q.id = qdq.quiz_id
    WHERE q.owner_id = auth.uid()
  )
);


-- ── 3. RPC: отправить ответ на супервопрос ────────────────────────
CREATE OR REPLACE FUNCTION answer_quiz_daily_question(
  p_question_id uuid,
  p_answer_text text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    uuid := auth.uid();
  v_question   quiz_daily_questions%ROWTYPE;
  v_is_correct boolean;
  v_bf_pts     integer;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authenticated');
  END IF;

  -- Проверяем, не отвечал ли уже
  IF EXISTS (SELECT 1 FROM quiz_daily_answers WHERE question_id = p_question_id AND user_id = v_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_answered');
  END IF;

  -- Загружаем вопрос
  SELECT * INTO v_question FROM quiz_daily_questions
  WHERE id = p_question_id AND status = 'approved' AND scheduled_date = (now() AT TIME ZONE 'UTC')::date;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'question_not_found');
  END IF;

  -- Сравниваем ответ (без учёта регистра и пробелов)
  v_is_correct := lower(trim(p_answer_text)) = lower(trim(v_question.answer_text));

  -- Записываем ответ
  INSERT INTO quiz_daily_answers (question_id, user_id, answer_text, is_correct)
  VALUES (p_question_id, v_user_id, p_answer_text, v_is_correct);

  -- Начисляем Brain Fights баллы
  v_bf_pts := (SELECT record_superq_bf(v_user_id, v_is_correct));

  RETURN jsonb_build_object(
    'ok',         true,
    'is_correct', v_is_correct,
    'bf_pts',     v_bf_pts,
    'correct_answer', CASE WHEN NOT v_is_correct THEN v_question.answer_text ELSE NULL END
  );
END;
$$;
