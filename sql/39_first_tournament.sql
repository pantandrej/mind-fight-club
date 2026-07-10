-- ── First Live Tournament: Первый турнир ──────────────────────────
-- Run in Supabase SQL Editor (Dashboard → SQL Editor)
-- Status: draft (admin-only, not visible publicly)

-- Add answer media columns to questions table
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS answer_image_url text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS answer_video_url text DEFAULT NULL;

-- ── Base URL for media files ───────────────────────────────────────
-- Files committed to GitHub repo at /media/t1/
-- Served via GitHub raw CDN

DO $$
DECLARE
  base text := 'https://raw.githubusercontent.com/pantandrej/mind-fight-club/main/media/t1/';
  q_ids uuid[];
  ot_id uuid;

  -- Question data arrays (15 questions)
  q_texts text[] := ARRAY[
    'Где на фото Джордж Уизли?',
    'Назовите главного героя мультфильма по аудиофрагменту',
    'Сколько букв в названии обуви на фото?',
    'Назовите скульптуру. Это знаменитое произведение французского скульптора 1881 года — первый официальный заказ для будущего музея декоративного искусства.',
    'В какой сфере деятельности используется предмет на фото?',
    'Выберете название деревни с самым длинным официальным названием в мире.',
    'На фото схема оригами. Кто получится, если следовать инструкции?',
    'Назовите певца по аудиофрагменту из его интервью',
    'Согласно народным приметам, если сорока сидит напротив дома и стрекочет, то это к чему?',
    'Назовите блюдо на фото',
    'Назовите актрису, закрытую на видеофрагменте, которая по сюжету фильма была женой Брэда Питта',
    'Анаграммами загаданы коктейли. НИНЕ РОГ | ХМ ЭТ НЕТ НА | НИ СРИ ОС — назовите их цвет.',
    'Расставьте логотипы брендов по порядку: Dove, Чижик, Famous grouse, ХК Авангард',
    'Назовите игру по описанию: действие происходит в Междуземье — стране «за завесой тумана», которой с давних времён правила королева Марика Вечная.',
    'Что рекламируется на видеофрагменте?'
  ];

  answers_list jsonb[] := ARRAY[
    '["Слева","Справа"]'::jsonb,
    '["Арбуз","Тыква"]'::jsonb,
    '["4","5"]'::jsonb,
    '["Мыслитель","Дискобол","Давид"]'::jsonb,
    '["Строительство","Медицина","Кулинария"]'::jsonb,
    '["Llanfairpwllgwyngyllgogerychwyrndrobwllllantysiliogogogoch","Vjhdbvdfhsdjksjkfeufjdfjhfsklsjdksjfhjgsyubnsofsge","Tyryiusbvpwhdvaeefcvbhsyetgfhbsnftsfgyf"]'::jsonb,
    '["Журавль","Кошка","Пчела","Медведь"]'::jsonb,
    '["Сергей Лазарев","Денис Клявер","Дима Билан","Алексей Чумаков"]'::jsonb,
    '["К дождю","К ссоре","К новостям","К деньгам"]'::jsonb,
    '["Тортилья","Ризотто","Бирьяни","Гаспачо","Паэлья"]'::jsonb,
    '["Кейт Бланшетт","Анджелина Джоли","Шарлиз Терон","Марион Котийяр","Сандра Буллок"]'::jsonb,
    '["Голубой","Жёлтый","Красный","Зелёный","Коричневый"]'::jsonb,
    '["1432","1423","3421","3412","2413","2431"]'::jsonb,
    '["Baldur''s Gate 3","Mass Effect","Elden Ring","Uncharted","Atomic Heart","Dead Space"]'::jsonb,
    '["Освежитель воздуха","Мягкие игрушки","Кигуруми","Аквагрим","Зубная паста","Подгузники"]'::jsonb
  ];

  correct_indices int[] := ARRAY[0, 1, 0, 0, 2, 0, 2, 2, 2, 4, 1, 2, 5, 2, 5];

  image_urls text[] := ARRAY[
    'q01_q.jpg', NULL, 'q03_q.jpg', NULL,
    'q05_q.jpg', NULL, 'q07_q.jpg', NULL,
    NULL, 'q10_q.jpg', NULL, NULL,
    'q13_q.jpg', NULL, NULL
  ];

  audio_urls text[] := ARRAY[
    NULL, 'q02_audio.mp3', NULL, NULL, NULL, NULL, NULL,
    'q08_audio.mp3', NULL, NULL, NULL, NULL, NULL, NULL, NULL
  ];

  video_urls text[] := ARRAY[
    NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'q11_video.mp4', NULL, NULL, NULL, 'q15_video.mp4'
  ];

  answer_image_urls text[] := ARRAY[
    'q01_a.jpg', 'q02_a.jpg', 'q03_q.jpg', 'q04_a.jpg',
    'q05_a.jpg', 'q06_a.jpg', 'q07_q.jpg', 'q08_a.jpg',
    'q09_a.jpg', 'q10_q.jpg', 'q11_a.jpg', 'q12_a.jpg',
    NULL, 'q14_a.jpg', 'q15_a.jpg'
  ];

  answer_video_urls text[] := ARRAY[
    NULL, 'q02_a_video.mp4', NULL, NULL, NULL, NULL, NULL,
    'q08_a_video.mp4', NULL, NULL, 'q11_a_video.mp4', NULL,
    NULL, NULL, 'q15_a_video.mp4'
  ];

  explanations text[] := ARRAY[
    NULL,
    'Мультфильм о тыквёнке, который благодаря умению расти спас друзей',
    'На фото мюли. Название происходит от латинского слова mulleus — древняя церемониальная обувь.',
    'Изначально скульптура должна была стать центральной фигурой в «Вратах Ада» Родена.',
    NULL,
    'Деревня в Уэльсе: Лланвайрпуллгуингиллгогерихуирндробуллллантисилиогogogох',
    NULL,
    NULL,
    'С давних времён стрекотание сороки символизирует скорых гостей, сплетни или важные известия.',
    'Национальное испанское блюдо из риса с шафраном, оливковым маслом и морепродуктами.',
    'Фильм о супружеской паре, сбежавшей от суеты Нью-Йорка на Лазурный Берег. Актёры были женаты в реальной жизни.',
    'Негрони, Манхэттен, Россини — все три коктейля красного цвета.',
    'Famous grouse — 4, Чижик — 2, Dove — 1, ХК Авангард',
    'Elden Ring (2022, FromSoftware) — действие в Междуземье.',
    NULL
  ];

  media_types text[] := ARRAY[
    'image', 'audio', 'image', 'none',
    'image', 'none', 'image', 'audio',
    'none', 'image', 'video', 'none',
    'image', 'none', 'video'
  ];

  i int;
  new_id uuid;

BEGIN
  q_ids := ARRAY[]::uuid[];

  FOR i IN 1..15 LOOP
    INSERT INTO questions (
      question_text, question_ru, answers_ru, correct_index,
      image_url, audio_url, video_url,
      answer_image_url, answer_video_url,
      explanation_ru, media_type,
      category, status, source_type,
      created_at
    ) VALUES (
      q_texts[i],
      q_texts[i],
      answers_list[i],
      correct_indices[i],
      CASE WHEN image_urls[i] IS NOT NULL THEN base || image_urls[i] ELSE NULL END,
      CASE WHEN audio_urls[i] IS NOT NULL THEN base || audio_urls[i] ELSE NULL END,
      CASE WHEN video_urls[i] IS NOT NULL THEN base || video_urls[i] ELSE NULL END,
      CASE WHEN answer_image_urls[i] IS NOT NULL THEN base || answer_image_urls[i] ELSE NULL END,
      CASE WHEN answer_video_urls[i] IS NOT NULL THEN base || answer_video_urls[i] ELSE NULL END,
      explanations[i],
      media_types[i],
      'general', 'published', 'official_general',
      now()
    )
    RETURNING id INTO new_id;
    q_ids := array_append(q_ids, new_id);
  END LOOP;

  -- Create the tournament (draft/lobby status, private)
  INSERT INTO official_tournaments (
    code, title, description,
    status, is_private, access_code, org_name,
    entry_fee, prize_pool,
    created_at
  ) VALUES (
    'T1FIRST',
    'Первый турнир',
    '15 вопросов — 5 раундов. Каждый раунд: 3 вопроса, время на ответ — 60 секунд.',
    'lobby',
    true,
    'ADMIN2025',
    'BFC',
    0, 0,
    now()
  )
  RETURNING id INTO ot_id;

  -- Link questions to tournament
  FOR i IN 1..15 LOOP
    INSERT INTO official_tournament_questions (
      tournament_id, question_id, position
    ) VALUES (ot_id, q_ids[i], i);
  END LOOP;

  RAISE NOTICE 'Created tournament id=% with 15 questions', ot_id;
END $$;
