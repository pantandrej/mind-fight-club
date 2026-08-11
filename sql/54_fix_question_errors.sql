-- 1. Багамские острова: правильный ответ - Атлантическом (index 4, не 3)
UPDATE questions
SET correct_index = 4
WHERE id = '93316311-6167-4e74-8cf8-52580ebaef72';

-- 2. Гленн Миллер: трубач → тромбонист
UPDATE questions
SET answers_json = jsonb_set(
  answers_json,
  '{3}',
  '"Американский джазовый тромбонист и аранжировщик"'
)
WHERE id = '45851b2d-6d88-4b69-9d67-c69d814fd8b7';

-- 3. Геркулес: греческий → римский
UPDATE questions
SET answers_json = jsonb_set(
  answers_json,
  '{1}',
  '"Римский герой полубог"'
)
WHERE id = '0179c630-485f-4c34-b3f5-fd574d6b1a8c';

-- 4. Удар ниже пояса - ни один вариант не верен, удаляем
DELETE FROM questions WHERE id = '9db22c62-9ec8-4e94-84c9-f4206b70f8ed';

-- 5. Эйфелева башня (материал) - нет верного варианта среди ответов, удаляем
DELETE FROM questions WHERE id = '50fa898e-61aa-4af2-ad63-1ccd2863dcb5';
