-- ══════════════════════════════════════════════════════════════════
-- Migration 88: Repair correct_index corruption — deterministic rows
-- DRAFT ONLY — DO NOT APPLY
-- Source of truth: scripts/active_questions_export.json (snapshot 2026-08-11)
-- Total deterministic repairs: 704
-- Unresolved rows (manual review needed): 196
--
-- Root causes (multiple historical write paths):
--
-- PATH A — saveTesterEdit (pre-commit 11bdc42):
--   Displayed answers_ru order. Admin could retype answer texts in different
--   positions and click a new radio button → both answers_json order AND
--   correct_index changed. answers_ru was NOT written (left at original order).
--   Saved: answers_json: JSON.stringify(newAnswers), correct_index: <radio int>
--   Did NOT save: answers_ru
--   This explains why correct_index itself CHANGED (Titanic 3→1, Моне 1→3):
--   admin saw answers_ru order, rearranged answer texts, clicked different radio.
--
-- PATH B — aqSaveEdit (historical, pre-11bdc42):
--   Displayed answers_ru||answers_json order. Had a numeric <select> for ci.
--   Wrote answers_json: JSON.stringify(newAnswers), answers_ru: newAnswers (same).
--   Admin could independently set ci from the dropdown without matching answer text.
--   Both arrays written identically but ci could be set to any integer value.
--
-- PATH C — admin_update_question RPC (sql/45_qmod_update.sql):
--   Updates answers_json and correct_index only. Does NOT update answers_ru.
--   Any save via this RPC diverged answers_json from answers_ru if arrays differed.
--
-- Pattern P3 (519 rows): answers_json reordered, answers_ru preserved, ci not remapped
-- Pattern P4 ( 23 rows): both arrays reordered independently, ci not remapped
-- Pattern P5 (162 rows): source export already had correct_index mismatch
--
-- Fix strategy: UPDATE correct_index only, targeting current answers_json ordering.
-- Safety predicate: WHERE id = '...' AND correct_index = <expected old value>
-- DO NOT rewrite answer arrays unless explicitly noted in ARRAY NORMALIZATION section.
-- ══════════════════════════════════════════════════════════════════

BEGIN;

-- ── SECTION 1: P3 — answers_json reordered, ci not remapped (519 rows)
-- Fix: set correct_index to position of correct_text in current answers_json

-- Кто написал балет «Ромео и Джульетта»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Прокофьев'
UPDATE questions
  SET correct_index = 1
  WHERE id = '00101b06-0826-4ff4-9ca1-0da049edfab5'
    AND correct_index = 2;

-- Кто написал «Капитанскую дочку»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Пушкин'
UPDATE questions
  SET correct_index = 0
  WHERE id = '00253928-b190-4a68-8f50-b78d0d380d1e'
    AND correct_index = 1;

-- Что такое золотое сечение?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Пропорция ~1.618 встречающаяся в природе'
UPDATE questions
  SET correct_index = 4
  WHERE id = '003725a8-f5ee-4639-9896-5cb0cac7684a'
    AND correct_index = 1;

-- Какой океан пересёк Магеллан первым?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Тихий'
UPDATE questions
  SET correct_index = 2
  WHERE id = '004977a6-2235-40d3-b462-1faaabc2a581'
    AND correct_index = 0;

-- В какой стране Стена Плача?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Израиль'
UPDATE questions
  SET correct_index = 0
  WHERE id = '00e657c0-a30c-41fe-959a-9d8a7e59de23'
    AND correct_index = 1;

-- Какая империя построила Колизей?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Римская'
UPDATE questions
  SET correct_index = 1
  WHERE id = '01521b8c-c133-4bcc-9ea6-84c18689c3c5'
    AND correct_index = 2;

-- Какая игра считается классикой жанра battle royale?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'PUBG'
UPDATE questions
  SET correct_index = 0
  WHERE id = '01776150-315b-4a3a-a968-3a479fd412df'
    AND correct_index = 1;

-- Кто создал «новый образ» (New Look) в 1947?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Кристиан Диор'
UPDATE questions
  SET correct_index = 1
  WHERE id = '017ef5f7-5724-45ed-8e76-154c0c34cdf6'
    AND correct_index = 2;

-- Что такое Тора?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Священные тексты иудаизма'
UPDATE questions
  SET correct_index = 1
  WHERE id = '01c121aa-764c-43ab-89b5-cf5e7f94df8a'
    AND correct_index = 2;

-- Что такое импичмент?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Процедура отстранения от должности'
UPDATE questions
  SET correct_index = 0
  WHERE id = '01e9a728-4fc2-4072-89bc-9403b90d7d66'
    AND correct_index = 2;

-- Кто написал «Полёт шмеля»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Римский-Корсаков'
UPDATE questions
  SET correct_index = 0
  WHERE id = '02148954-d8e7-4cc7-8f31-1abb55fe5dfa'
    AND correct_index = 3;

-- Какой фильм получил “Оскар” за лучший фильм в 2020 году?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Паразиты'
UPDATE questions
  SET correct_index = 2
  WHERE id = '02edec0a-7c9f-44c6-9dba-43f997c82cd2'
    AND correct_index = 1;

-- Как зовут главного героя «Доктора Живаго»?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Юрий'
UPDATE questions
  SET correct_index = 4
  WHERE id = '032545a4-6b55-486d-97dc-e031a3b6a79f'
    AND correct_index = 0;

-- Кто написал “Лунную сонату”?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Бетховен'
UPDATE questions
  SET correct_index = 3
  WHERE id = '03a22851-f59a-4dc6-9366-dc8e1f6510e7'
    AND correct_index = 2;

-- Что такое CO2?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Углекислый газ'
UPDATE questions
  SET correct_index = 0
  WHERE id = '03a2e82f-c4ae-4c29-89a9-b1e175cb6a27'
    AND correct_index = 2;

-- Что такое олигархия?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Власть небольшой группы богатых'
UPDATE questions
  SET correct_index = 1
  WHERE id = '03a79859-0947-47fb-9857-d394933274c4'
    AND correct_index = 0;

-- В каком году Россия продала Аляску?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1867'
UPDATE questions
  SET correct_index = 1
  WHERE id = '03d85c41-6019-4b5b-a29f-8798fc3e7ebc'
    AND correct_index = 4;

-- В каком году последний раз проводился ЧМ по футболу без VAR?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '2014'
UPDATE questions
  SET correct_index = 3
  WHERE id = '04271cc1-ada2-4760-b8e9-6d2e91cb007a'
    AND correct_index = 1;

-- Столица Норвегии?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Осло'
UPDATE questions
  SET correct_index = 1
  WHERE id = '04a0276b-f35c-4b7c-a55e-4671a81611e3'
    AND correct_index = 0;

-- Кто сыграл Майкла Корлеоне в «Крёстном отце»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Аль Пачино'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0500b5e3-3621-4c60-9672-909d900e7340'
    AND correct_index = 3;

-- В какой стране находится Биг-Бен?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Великобритания'
UPDATE questions
  SET correct_index = 0
  WHERE id = '05064b68-64e2-4d62-b8fa-474d0c34f75c'
    AND correct_index = 1;

-- Какой газ составляет большую часть атмосферы Земли?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Азот'
UPDATE questions
  SET correct_index = 3
  WHERE id = '057f9cc1-7e40-4b56-aafc-24ea7e06128a'
    AND correct_index = 0;

-- Кто расписал потолок Сикстинской капеллы?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Микеланджело'
UPDATE questions
  SET correct_index = 4
  WHERE id = '058c5f92-54c9-4ed7-a50b-d05e493e4fd3'
    AND correct_index = 1;

-- В каком году основана организация ЮНЕСКО?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1945'
UPDATE questions
  SET correct_index = 0
  WHERE id = '05a28940-c730-4035-b401-b6b598691120'
    AND correct_index = 4;

-- Какой фильм начинается с выбора красной или синей таблетки?
-- Export ci=3 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Матрица'
UPDATE questions
  SET correct_index = 4
  WHERE id = '05f6233c-38b5-4963-82f4-90a80e1403cd'
    AND correct_index = 3;

-- Какая компания создала консоль PlayStation?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Sony'
UPDATE questions
  SET correct_index = 0
  WHERE id = '06a84cc9-449e-491a-8f66-1eda5d769dd8'
    AND correct_index = 2;

-- Какой клуб известен прозвищем «Старая синьора»?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Ювентус'
UPDATE questions
  SET correct_index = 2
  WHERE id = '06c9e65d-ca52-4004-a3c4-cfee648f67c8'
    AND correct_index = 3;

-- Что такое ферментация в кулинарии?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Преобразование продуктов микроорганизмами'
UPDATE questions
  SET correct_index = 3
  WHERE id = '074c8c1a-1d4f-4951-a705-a85c601124e1'
    AND correct_index = 2;

-- Что такое «второе начало термодинамики»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Энтропия замкнутой системы не убывает'
UPDATE questions
  SET correct_index = 1
  WHERE id = '08672444-5e8d-4b32-b847-75c25c70726a'
    AND correct_index = 0;

-- В каком фильме Де Ниро худеет для роли?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Бешеный бык'
UPDATE questions
  SET correct_index = 1
  WHERE id = '0889bc79-dec7-4386-8cd2-5351b288d4bf'
    AND correct_index = 0;

-- В каком городе родился Пикассо?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Малага'
UPDATE questions
  SET correct_index = 3
  WHERE id = '08a6795f-cc5c-4f17-868a-7ff1d6deaefb'
    AND correct_index = 2;

-- Что такое Красная книга?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Список исчезающих видов'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0945c977-ffaf-41f0-aa04-373e785c3e30'
    AND correct_index = 1;

-- Длина марафона в километрах?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '42,195'
UPDATE questions
  SET correct_index = 3
  WHERE id = '096a5afe-dc66-4710-99b3-62dadc2f9717'
    AND correct_index = 0;

-- Что такое рибосома?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Органелла синтезирующая белки'
UPDATE questions
  SET correct_index = 1
  WHERE id = '098329f5-d092-46ea-9fa6-58bbbdf6afe8'
    AND correct_index = 3;

-- Кто открыл морской путь в Индию?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Васко да Гама'
UPDATE questions
  SET correct_index = 2
  WHERE id = '0a106c75-8f6a-4796-9e8d-cd214d1d4e7f'
    AND correct_index = 0;

-- Какая река впадает в Каспийское море?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Волга'
UPDATE questions
  SET correct_index = 2
  WHERE id = '0a8ab014-2672-41fa-b55b-a320b28e25fe'
    AND correct_index = 0;

-- В каком году был запущен первый спутник?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1957'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0c059851-394c-43a7-8e17-9ca7f63583de'
    AND correct_index = 2;

-- Кто снял «Последнее танго в Париже»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Бертолуччи'
UPDATE questions
  SET correct_index = 3
  WHERE id = '0c561c2c-798a-4de9-ae79-a15701b97d5c'
    AND correct_index = 0;

-- Столица Германии?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Берлин'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0c5a6d20-141a-4404-a5be-66947afe2b81'
    AND correct_index = 1;

-- Где находится Ватикан?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'В Риме'
UPDATE questions
  SET correct_index = 2
  WHERE id = '0cb52a8a-0146-4420-899f-49a29a90c546'
    AND correct_index = 1;

-- Какой клуб выиграл ЛЧ в 2023?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Манчестер Сити'
UPDATE questions
  SET correct_index = 3
  WHERE id = '0cd9bc3c-f4ce-49c1-a3e8-46546df4c978'
    AND correct_index = 1;

-- Какая река самая длинная в Европе?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Волга'
UPDATE questions
  SET correct_index = 1
  WHERE id = '0d25bf3a-6dd8-4114-8714-0e9b4b815bb2'
    AND correct_index = 0;

-- Какое животное самое высокое среди современных наземных животных?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Жираф'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0d6465ef-a500-41ba-8eed-b107460b1d59'
    AND correct_index = 2;

-- Какой горный хребет является самым длинным в мире?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Анды'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0e3ab870-13ce-47e4-a0d1-fbc38cf4750a'
    AND correct_index = 3;

-- Кто написал «Критику чистого разума»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Кант'
UPDATE questions
  SET correct_index = 1
  WHERE id = '0ed2351f-4659-4ab7-bd7b-0a0e12081f62'
    AND correct_index = 0;

-- В каком фильме Чаплин сыграл Гитлера?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Великий диктатор'
UPDATE questions
  SET correct_index = 1
  WHERE id = '0f47fbf7-3550-4ed3-9a72-f68767df3187'
    AND correct_index = 0;

-- Кто такой Гленн Гульд?
-- Export ci=5 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Канадский пианист'
UPDATE questions
  SET correct_index = 0
  WHERE id = '0f6b94ed-59f5-4619-b1fd-b46a4075a9e1'
    AND correct_index = 5;

-- В каком году открыли пенициллин?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '1928'
UPDATE questions
  SET correct_index = 3
  WHERE id = '0ffa76f7-9580-40f1-aa44-676ced5e514f'
    AND correct_index = 2;

-- Кто снял «Восемь с половиной»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Феллини'
UPDATE questions
  SET correct_index = 0
  WHERE id = '114d62c5-27ce-4124-b122-0cc777d4b7c4'
    AND correct_index = 2;

-- Что такое паломничество?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Путешествие к священному месту'
UPDATE questions
  SET correct_index = 1
  WHERE id = '12235853-4b72-4eda-b0f6-c7de0ab75827'
    AND correct_index = 0;

-- Какой инструмент у Джими Хендрикса?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Электрогитара'
UPDATE questions
  SET correct_index = 2
  WHERE id = '126af0f0-a178-4b58-8394-b8f6f889c809'
    AND correct_index = 1;

-- Кто сыграл Джокера в «Тёмном рыцаре»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Хит Леджер'
UPDATE questions
  SET correct_index = 0
  WHERE id = '14061c8a-b756-4dc6-9752-153e8dfcca4d'
    AND correct_index = 3;

-- Что такое дамплинги?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Пельмени или вареники в азиатской кухне'
UPDATE questions
  SET correct_index = 4
  WHERE id = '14b39dc1-35de-40be-a11b-7852acf7f3b0'
    AND correct_index = 2;

-- В каком году произошла Бородинская битва?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1812'
UPDATE questions
  SET correct_index = 2
  WHERE id = '15c00c36-b0a3-4f48-849d-864ff7966ecf'
    AND correct_index = 0;

-- Кто написал «Игра в классики»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Кортасар'
UPDATE questions
  SET correct_index = 2
  WHERE id = '15e624a2-6182-49bb-be23-80d9d6a295fc'
    AND correct_index = 1;

-- Кто играл Тони Монтану в «Лице со шрамом»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Аль Пачино'
UPDATE questions
  SET correct_index = 0
  WHERE id = '16375b7f-f94f-4a9d-a2dd-d984b89afae3'
    AND correct_index = 3;

-- В какой стране находится Боробудур?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Индонезия'
UPDATE questions
  SET correct_index = 1
  WHERE id = '16c6b8da-9422-45c7-845e-f1f52c89658a'
    AND correct_index = 2;

-- Из какой страны блюдо крок-месье?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Франция'
UPDATE questions
  SET correct_index = 0
  WHERE id = '16e825dd-2a47-4f3e-850a-76754886f57a'
    AND correct_index = 3;

-- Кто выиграл ЧМ по шахматам 2023?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Дин Лижэнь'
UPDATE questions
  SET correct_index = 3
  WHERE id = '1709b718-151f-4af5-973b-5d3516b8dd13'
    AND correct_index = 0;

-- Сколько лет Микеланджело расписывал Сикстинскую капеллу?
-- Export ci=2 (was for old order), new ci=5 (correct in current json)
-- Correct answer: '4 года'
UPDATE questions
  SET correct_index = 5
  WHERE id = '178be42e-3e40-47d8-a013-85c484d9b92c'
    AND correct_index = 2;

-- Какой фильм Нолана о войне на пляже?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Дюнкерк'
UPDATE questions
  SET correct_index = 1
  WHERE id = '17e752c8-412f-4990-a3a8-42e1bf2c4ac9'
    AND correct_index = 2;

-- Кто написал «Явление Христа народу»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Иванов'
UPDATE questions
  SET correct_index = 2
  WHERE id = '1862136a-45f8-4682-bf23-1290cf1982e3'
    AND correct_index = 1;

-- Какой язык является официальным в наибольшем числе стран?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Английский'
UPDATE questions
  SET correct_index = 2
  WHERE id = '18642cbb-a81b-4f1e-a6b4-6d30b4da2a04'
    AND correct_index = 1;

-- В какой стране находится Колизей?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Италия'
UPDATE questions
  SET correct_index = 3
  WHERE id = '189b8e4b-4d42-4452-ae47-055368720958'
    AND correct_index = 2;

-- Как зовут ведьму в «Белоснежке»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Злая королева'
UPDATE questions
  SET correct_index = 2
  WHERE id = '18cf2f21-7326-468e-abec-2a0d6bb57b50'
    AND correct_index = 0;

-- Какой турнир в велоспорте проходит во Франции и длится несколько недел
-- Export ci=0 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Тур де Франс'
UPDATE questions
  SET correct_index = 5
  WHERE id = '19f2ad20-4815-4085-ba21-b60bddb39b14'
    AND correct_index = 0;

-- Кто написал «Фауст»?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Гёте'
UPDATE questions
  SET correct_index = 1
  WHERE id = '1a284e1e-3a86-47d0-979b-9ae61f6ba6f1'
    AND correct_index = 3;

-- Какой персонаж Disney живёт под водой и мечтает о мире людей?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Ариэль'
UPDATE questions
  SET correct_index = 3
  WHERE id = '1a5e8c06-90b3-4a30-b956-023f730f9ca4'
    AND correct_index = 4;

-- В какой стране находится Стоунхендж?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Великобритания'
UPDATE questions
  SET correct_index = 1
  WHERE id = '1b44736d-68b9-42b7-8cc6-f74b0004a3b2'
    AND correct_index = 2;

-- Что такое число Фибоначчи?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Сумма двух предыдущих в последовательности'
UPDATE questions
  SET correct_index = 3
  WHERE id = '1c01713b-1f7c-4917-aaf7-4f2ede898320'
    AND correct_index = 2;

-- Кто был первым президентом США?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Джордж Вашингтон'
UPDATE questions
  SET correct_index = 2
  WHERE id = '1ca34324-524f-44c7-98bb-8c4d23f76e9f'
    AND correct_index = 0;

-- Как называется знаменитая скульптура Родена?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Мыслитель'
UPDATE questions
  SET correct_index = 1
  WHERE id = '1cc82d4e-4d1c-4feb-a8b9-a8706bff7766'
    AND correct_index = 2;

-- Какой горный хребет разделяет Европу и Азию?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Уральский'
UPDATE questions
  SET correct_index = 1
  WHERE id = '1ccb55d5-70d6-4053-b3c4-a9a001de29f7'
    AND correct_index = 2;

-- Какой фильм начинается с фразы про далёкую-далёкую галактику?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Звёздные войны'
UPDATE questions
  SET correct_index = 0
  WHERE id = '1dfefb4f-2b88-4733-a524-b8331a76220a'
    AND correct_index = 1;

-- Кто такой Сезанн?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Французский постимпрессионист'
UPDATE questions
  SET correct_index = 0
  WHERE id = '1e1cd9f6-95f7-4f9c-a96f-8e4363ea8f02'
    AND correct_index = 1;

-- В какой стране происходит «Анна Каренина»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Россия'
UPDATE questions
  SET correct_index = 2
  WHERE id = '20591377-7854-4222-acba-4bd05ed3f348'
    AND correct_index = 0;

-- Из какой страны блюдо пад тай?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Таиланд'
UPDATE questions
  SET correct_index = 2
  WHERE id = '20a6d074-b303-4a6f-b686-218d1e6c07c7'
    AND correct_index = 0;

-- Какое животное является символом WWF?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Панда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '2298250f-d50b-4be5-bfa4-d0212a31ad7e'
    AND correct_index = 1;

-- Кто такой Отто фон Бисмарк?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Прусский и немецкий политик'
UPDATE questions
  SET correct_index = 1
  WHERE id = '22b4cdc2-4157-4fb8-b13b-ae9bde3e702f'
    AND correct_index = 0;

-- Кто создал Linux?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Линус Торвальдс'
UPDATE questions
  SET correct_index = 2
  WHERE id = '24d897c1-c0a9-4cd1-a4ef-2592223b92b1'
    AND correct_index = 3;

-- Какая страна имеет самую длинную сухопутную границу с Россией?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Казахстан'
UPDATE questions
  SET correct_index = 1
  WHERE id = '24f082da-9bdc-44b7-a1f9-a499795c07dd'
    AND correct_index = 0;

-- Кто написал «Над пропастью во ржи»?
-- Export ci=2 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Сэлинджер'
UPDATE questions
  SET correct_index = 5
  WHERE id = '25e96302-d317-4d44-88d2-de743b52c570'
    AND correct_index = 2;

-- Кто создал серию Castlevania?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Konami'
UPDATE questions
  SET correct_index = 2
  WHERE id = '26cf3ffd-852a-4ea8-96d2-27d693962723'
    AND correct_index = 1;

-- Как называется знаменитая симфония Бетховена №5?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Судьба'
UPDATE questions
  SET correct_index = 0
  WHERE id = '27725d42-9026-45fc-80a0-12981bf71fca'
    AND correct_index = 2;

-- Какой актёр сыграл в «Форресте Гампе» и «Изгое»?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Том Хэнкс'
UPDATE questions
  SET correct_index = 4
  WHERE id = '278a2286-b2b0-4ecd-aef2-6a66260cf8b3'
    AND correct_index = 0;

-- Какой музыкальный жанр связан с Новым Орлеаном?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Джаз'
UPDATE questions
  SET correct_index = 1
  WHERE id = '286a4fa2-d183-4af0-b66d-f4a28f26aa4b'
    AND correct_index = 2;

-- Что означает термин «allegro»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Быстро'
UPDATE questions
  SET correct_index = 0
  WHERE id = '29254474-504b-4fb0-ad6a-fd855b70740a'
    AND correct_index = 1;

-- Какая студия создала Outer Wilds?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Mobius Digital'
UPDATE questions
  SET correct_index = 2
  WHERE id = '29dc04a6-6379-4d19-848d-ff7b04a5f800'
    AND correct_index = 3;

-- Кто такой Аугусто Пиночет?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Чилийский диктатор'
UPDATE questions
  SET correct_index = 2
  WHERE id = '29e99760-cd7c-44bf-8f9e-ae829e1d87a4'
    AND correct_index = 1;

-- Кто написал «Половецкие пляски»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Бородин'
UPDATE questions
  SET correct_index = 0
  WHERE id = '2b001206-bcac-434f-8bec-06cdb23ebc9f'
    AND correct_index = 1;

-- Какая из этих игр является футбольным симулятором?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'EA Sports FC'
UPDATE questions
  SET correct_index = 2
  WHERE id = '2b0d0905-da60-4458-b90a-538ccec3aecf'
    AND correct_index = 0;

-- Кто написал «Героя нашего времени»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Лермонтов'
UPDATE questions
  SET correct_index = 1
  WHERE id = '2b587b9c-fd0b-43e9-8342-8f5c265f3fa7'
    AND correct_index = 0;

-- В каком виде спорта используется ракетка и волан?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Бадминтон'
UPDATE questions
  SET correct_index = 1
  WHERE id = '2cc34c0f-0c30-470b-8f1b-9d51360c270b'
    AND correct_index = 0;

-- Что такое карпаччо?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Тонко нарезанное сырое мясо'
UPDATE questions
  SET correct_index = 2
  WHERE id = '2ccc97fb-6cc3-4f6f-92f2-b8c269b30790'
    AND correct_index = 1;

-- Кто такой Паганини?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Итальянский скрипач'
UPDATE questions
  SET correct_index = 1
  WHERE id = '2e409e6c-44f9-4ca0-ab42-85a726194bef'
    AND correct_index = 0;

-- Какой композитор написал «Кармен»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Бизе'
UPDATE questions
  SET correct_index = 2
  WHERE id = '2fce496f-1369-45f7-8de8-680f11bab92b'
    AND correct_index = 0;

-- Какой орган вырабатывает инсулин?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Поджелудочная железа'
UPDATE questions
  SET correct_index = 1
  WHERE id = '31030f21-0115-43ff-8a70-fc96c9a36e15'
    AND correct_index = 3;

-- Какой фильм Стэнли Кубрика снят по Стивену Кингу?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Сияние'
UPDATE questions
  SET correct_index = 1
  WHERE id = '312e0e3e-99bf-4479-a224-25e6c05b3e0c'
    AND correct_index = 2;

-- Какой художник связан с импрессионизмом и серией картин с кувшинками?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Клод Моне'
UPDATE questions
  SET correct_index = 0
  WHERE id = '31ced482-9262-4e49-9d04-3e5fcf5852a8'
    AND correct_index = 3;

-- Какой язык программирования создал Гвидо ван Россум?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Python'
UPDATE questions
  SET correct_index = 1
  WHERE id = '32b23cef-46d5-4066-883f-152e476411a9'
    AND correct_index = 2;

-- Как зовут профессора в «Собачьем сердце»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Преображенский'
UPDATE questions
  SET correct_index = 0
  WHERE id = '35745405-2d5f-47b1-b096-d2c0671d2b49'
    AND correct_index = 1;

-- Что такое «Книга мёртвых»?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Египетские тексты для умерших'
UPDATE questions
  SET correct_index = 2
  WHERE id = '3674aeac-4450-439d-8947-12a3218bcae8'
    AND correct_index = 3;

-- Какой инструмент считается королём оркестра?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Скрипка'
UPDATE questions
  SET correct_index = 2
  WHERE id = '3781050a-4e9e-417f-82b6-799b1a2ce4e6'
    AND correct_index = 0;

-- Кто снял «Дюну» 2021?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Дени Вильнёв'
UPDATE questions
  SET correct_index = 2
  WHERE id = '37d7b9b9-83d8-4989-a7fd-fd543d2b276e'
    AND correct_index = 0;

-- Как называется позиция в американском футболе, бросающая мяч?
-- Export ci=5 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Квотербек'
UPDATE questions
  SET correct_index = 0
  WHERE id = '37dbb2d4-78bc-4f12-9051-8f78f47ebde1'
    AND correct_index = 5;

-- В каком году распался СССР — и вышел альбом Nirvana Nevermind?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1991'
UPDATE questions
  SET correct_index = 0
  WHERE id = '387211a9-d58c-4eff-a8ed-b435323d0201'
    AND correct_index = 2;

-- Кто написал «Думай медленно решай быстро»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Даниэль Канеман'
UPDATE questions
  SET correct_index = 0
  WHERE id = '38f385eb-05ad-4c09-88b8-39aa56b335aa'
    AND correct_index = 2;

-- Кто сформулировал теорию относительности?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Альберт Эйнштейн'
UPDATE questions
  SET correct_index = 2
  WHERE id = '39537919-c1c9-4543-8e16-ccb2503e0db0'
    AND correct_index = 1;

-- Какая река протекает через Рим?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Тибр'
UPDATE questions
  SET correct_index = 0
  WHERE id = '3a6c9375-ca59-48a9-9ac3-df4338e52b23'
    AND correct_index = 4;

-- Что такое синтоизм?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Японская традиционная религия'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3ac030e9-1808-4ed9-a75e-ab3a1ac4c6f6'
    AND correct_index = 0;

-- В каком году вышел фильм «Матрица»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1999'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3ac0ac91-c431-4360-8bd2-cba0ee1558f6'
    AND correct_index = 2;

-- В каком году вышел «Бойцовский клуб»?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1999'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3b7910cd-8f3d-4a12-8538-bae4479a2676'
    AND correct_index = 3;

-- Сколько букв в японской слоговой азбуке хирагана?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '46'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3dc4c54f-effa-4677-a960-20a3c73158d6'
    AND correct_index = 0;

-- Кто снял «Синий бархат»?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Дэвид Линч'
UPDATE questions
  SET correct_index = 3
  WHERE id = '3e3fb809-ce96-40e8-a8e4-b05478e3299b'
    AND correct_index = 1;

-- Кто снял «Пианиста» 2002?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Роман Полански'
UPDATE questions
  SET correct_index = 2
  WHERE id = '3efa69e1-21f7-4956-99a5-73260547d012'
    AND correct_index = 1;

-- В каком году родился Пушкин?
-- Export ci=1 (was for old order), new ci=5 (correct in current json)
-- Correct answer: '1799'
UPDATE questions
  SET correct_index = 5
  WHERE id = '3f6da083-7e39-432a-aae1-004ee5f7136d'
    AND correct_index = 1;

-- Какая игра имеет персонажа Линка?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'The Legend of Zelda'
UPDATE questions
  SET correct_index = 2
  WHERE id = '3fcf5087-d719-484e-b692-57fc9010e6ed'
    AND correct_index = 1;

-- Какой художник известен картиной «Крик»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Мунк'
UPDATE questions
  SET correct_index = 3
  WHERE id = '3fd07699-2f2b-4768-b59e-3c5c482cf0c0'
    AND correct_index = 0;

-- В каком городе галерея Уффици?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Флоренция'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3fe9da22-7bd2-4996-8a45-6abe5eacb50a'
    AND correct_index = 3;

-- Как называется наука о болезнях?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Патология'
UPDATE questions
  SET correct_index = 0
  WHERE id = '4016ba6f-ea02-48a6-a1a0-e4afcb954c73'
    AND correct_index = 1;

-- В каком году вышел «Список Шиндлера»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1993'
UPDATE questions
  SET correct_index = 0
  WHERE id = '40cb694f-bb07-44d3-9b99-8360cfebc029'
    AND correct_index = 2;

-- Кто режиссёр «Бёрдмэна»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Иньярриту'
UPDATE questions
  SET correct_index = 0
  WHERE id = '411d1b43-8980-4e54-8881-8188df77ff0e'
    AND correct_index = 1;

-- В каком году первые зимние Олимпийские игры?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1924'
UPDATE questions
  SET correct_index = 0
  WHERE id = '41403096-a770-47d9-8e5c-f71726aa8853'
    AND correct_index = 1;

-- Через сколько стран протекает Нил?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: '11'
UPDATE questions
  SET correct_index = 4
  WHERE id = '41826c15-79ee-47c4-bb89-b3874107f9eb'
    AND correct_index = 1;

-- Сколько геймов минимум в теннисном сете?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '6'
UPDATE questions
  SET correct_index = 0
  WHERE id = '41b1cda2-21be-4311-a041-05dea6817036'
    AND correct_index = 2;

-- Как называется роман Булгакова о дьяволе?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Мастер и Маргарита'
UPDATE questions
  SET correct_index = 0
  WHERE id = '42bd2309-4590-4f04-b044-1d74333ac1e5'
    AND correct_index = 3;

-- Кто написал «Мёртвые души»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Гоголь'
UPDATE questions
  SET correct_index = 1
  WHERE id = '42c28a5e-fa19-45c5-b848-294770060532'
    AND correct_index = 0;

-- Сколько видов спорта в современном пятиборье?
-- Export ci=5 (was for old order), new ci=4 (correct in current json)
-- Correct answer: '5'
UPDATE questions
  SET correct_index = 4
  WHERE id = '43aae4bf-117b-4795-81c9-a5aea5cbcac1'
    AND correct_index = 5;

-- Какой фильм Тарантино про самураев и невест?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Убить Билла'
UPDATE questions
  SET correct_index = 3
  WHERE id = '43e6c87b-40b8-458b-a492-fe76779878fb'
    AND correct_index = 0;

-- Что такое «Grand Slam» в теннисе?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Победа на всех 4 турнирах Большого шлема в году'
UPDATE questions
  SET correct_index = 2
  WHERE id = '44c521be-8875-4101-94f3-a5b1768eb7ba'
    AND correct_index = 1;

-- Кто написал оперу «Дон Жуан»?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Моцарт'
UPDATE questions
  SET correct_index = 4
  WHERE id = '454211ce-fd85-4ec0-960b-2af24ac461a9'
    AND correct_index = 1;

-- Как называется ближайшая к Земле звезда после Солнца?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Проксима Центавра'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4627507f-d45c-40c7-8daa-de89928daa5b'
    AND correct_index = 4;

-- Сколько стран в Южной Америке?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '12'
UPDATE questions
  SET correct_index = 3
  WHERE id = '4685c23e-ed67-4858-98e7-8bd818a86dc8'
    AND correct_index = 0;

-- Сколько игроков в команде в волейболе?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '6'
UPDATE questions
  SET correct_index = 1
  WHERE id = '46d5c14e-90a1-4e86-8ec9-cc2a53d00ab4'
    AND correct_index = 3;

-- Какое государство самое маленькое в Азии?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Мальдивы'
UPDATE questions
  SET correct_index = 1
  WHERE id = '477ce44d-a10e-492f-a3d9-a585414aee0a'
    AND correct_index = 2;

-- Кто сыграл Джека Воробья в “Пиратах Карибского моря”?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Джонни Депп'
UPDATE questions
  SET correct_index = 0
  WHERE id = '47983dba-3cfd-49f6-8b79-529107a10961'
    AND correct_index = 1;

-- Кто такой Серена Уильямс?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Американская теннисистка'
UPDATE questions
  SET correct_index = 4
  WHERE id = '47a33825-3008-4e24-b2fc-9c5e51e5bbb1'
    AND correct_index = 2;

-- Кто такой Жан-Клод Килли?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Французский горнолыжник'
UPDATE questions
  SET correct_index = 3
  WHERE id = '48154769-e574-4e46-bc06-b63e88fdfc8f'
    AND correct_index = 1;

-- В каких городах проходят недели моды «Большой четвёрки»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Нью-Йорк Лондон Милан Париж'
UPDATE questions
  SET correct_index = 0
  WHERE id = '48341bae-2c9a-48a0-b7bb-cbf0268b9599'
    AND correct_index = 3;

-- Какой художник написал «Рождение Венеры»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Боттичелли'
UPDATE questions
  SET correct_index = 1
  WHERE id = '48454121-74a1-49a4-a81a-afd9c87dfacd'
    AND correct_index = 0;

-- Кто снял «Андалузский пёс»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Бунюэль и Дали'
UPDATE questions
  SET correct_index = 3
  WHERE id = '49a5c160-00a6-4f15-91a3-88c7f2aa0a59'
    AND correct_index = 2;

-- Кто написал «Последний день Помпеи»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Брюллов'
UPDATE questions
  SET correct_index = 3
  WHERE id = '4a082973-796d-40e1-80b7-238a037c8835'
    AND correct_index = 0;

-- Какой океан омывает западное побережье США?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Тихий'
UPDATE questions
  SET correct_index = 2
  WHERE id = '4a0dfaeb-f53f-4408-8187-6e3bb12c0a68'
    AND correct_index = 0;

-- Как называется тихая педаль на фортепиано?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Una corda'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4a21c479-d08d-4667-9d95-b857a3846f6a'
    AND correct_index = 4;

-- Что такое фондю?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Швейцарское блюдо с расплавленным сыром'
UPDATE questions
  SET correct_index = 2
  WHERE id = '4b362d95-8fcb-4963-92eb-bdd98d83a338'
    AND correct_index = 0;

-- Что такое бланширование?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Кратковременная варка в кипятке'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4b5117a6-eac6-4505-8407-bc6832329c58'
    AND correct_index = 0;

-- Правда или ложь: «Лебединое озеро» написал Игорь Стравинский.
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4c218d81-a460-4f96-9046-acfdadfe0cd6'
    AND correct_index = 0;

-- Какой роман написал Булгаков о театре?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Театральный роман'
UPDATE questions
  SET correct_index = 3
  WHERE id = '4c46fb76-1cca-4847-943e-eefb0f5995fc'
    AND correct_index = 4;

-- Какой город принимал летние Олимпийские игры 2012 года?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Лондон'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4c87bc4c-a381-4909-9b5c-b4763d41d779'
    AND correct_index = 3;

-- В каком жанре снят «Психо» Хичкока?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Триллер'
UPDATE questions
  SET correct_index = 0
  WHERE id = '4cbd3d4a-0de3-4ca7-9882-3e8fe99f14fe'
    AND correct_index = 1;

-- Правда или ложь: Юрий Гагарин был первым человеком в космосе.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '4da38e33-99e1-44b5-8d3b-09c7be809663'
    AND correct_index = 1;

-- Из чего делают настоящий вустерский соус?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Анчоусы тамаринд уксус специи'
UPDATE questions
  SET correct_index = 2
  WHERE id = '4dacc066-064c-415d-bf8f-41821b89120c'
    AND correct_index = 3;

-- Кто был автором «Божественной комедии»?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Данте Алигьери'
UPDATE questions
  SET correct_index = 3
  WHERE id = '4ed6b33d-cd56-4159-abaf-a92ae45db665'
    AND correct_index = 1;

-- Сколько будет 0!?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1'
UPDATE questions
  SET correct_index = 1
  WHERE id = '4fec989a-f927-4f6b-a2dd-2f75a55b3198'
    AND correct_index = 0;

-- Какой инструмент чаще всего ассоциируют с Фредди Меркьюри на сцене?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Микрофон'
UPDATE questions
  SET correct_index = 0
  WHERE id = '50caec42-215c-4e42-a245-aaa8ba3d559f'
    AND correct_index = 2;

-- В каком городе галерея Прадо?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Мадрид'
UPDATE questions
  SET correct_index = 1
  WHERE id = '511730ec-ff84-4c70-b841-2926a5f39336'
    AND correct_index = 0;

-- Сколько раз Бразилия выигрывала ЧМ по футболу?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '5'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5135c0dd-e88d-4cf3-8c46-457d1a273540'
    AND correct_index = 2;

-- Кто сыграл Джека в «Титанике»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Леонардо ДиКаприо'
UPDATE questions
  SET correct_index = 1
  WHERE id = '51c08ebe-0b77-49ce-b950-ac32446d07d0'
    AND correct_index = 0;

-- Кто такой Авиценна?
-- Export ci=3 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Средневековый персидский учёный'
UPDATE questions
  SET correct_index = 5
  WHERE id = '52680a97-80cb-4fa2-8fde-32b5619a813d'
    AND correct_index = 3;

-- Кто написал «Утро в сосновом лесу»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Шишкин'
UPDATE questions
  SET correct_index = 0
  WHERE id = '53212207-2ae6-4989-a55c-dd005ce93b34'
    AND correct_index = 3;

-- Кто такой Мао Цзэдун?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Китайский политик'
UPDATE questions
  SET correct_index = 1
  WHERE id = '53c960bc-d502-4f9b-a981-4bb591874dca'
    AND correct_index = 4;

-- В каком году Китай стал коммунистическим?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1949'
UPDATE questions
  SET correct_index = 1
  WHERE id = '53f4c4a6-941e-4fbe-a089-f8e95fd6cb70'
    AND correct_index = 0;

-- Кто выиграл Золотой мяч 2023?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Месси'
UPDATE questions
  SET correct_index = 1
  WHERE id = '5475e9e5-1987-4aa0-bd03-4db2997e359c'
    AND correct_index = 2;

-- Какой герой комиксов живёт в Готэме?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Бэтмен'
UPDATE questions
  SET correct_index = 0
  WHERE id = '54c9fb10-e964-4806-a9c3-05ab82f7ddb0'
    AND correct_index = 1;

-- Кто снял «Чужой» 1979 года?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Ридли Скотт'
UPDATE questions
  SET correct_index = 2
  WHERE id = '54eb223c-bc37-4d0b-ae90-1ad1df931bc9'
    AND correct_index = 3;

-- Какой газ растения поглощают в процессе фотосинтеза?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Углекислый газ'
UPDATE questions
  SET correct_index = 2
  WHERE id = '565836fb-1484-49ff-826e-fdeac7730363'
    AND correct_index = 1;

-- Правда или ложь: вода при нормальном давлении кипит при 100 °C.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5681f3af-f6f0-43f4-b8c8-0cc2967a8e9c'
    AND correct_index = 1;

-- Кто такой Карл Льюис?
-- Export ci=4 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Американский спринтер'
UPDATE questions
  SET correct_index = 2
  WHERE id = '56cf2aea-ec9b-45a5-b18b-bbc7aae5a88e'
    AND correct_index = 4;

-- Какой газ мы вдыхаем?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Кислород'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5766ae2c-c7ea-4328-b5c7-6838adebf3f3'
    AND correct_index = 1;

-- Кто написал «Американские боги»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Нил Гейман'
UPDATE questions
  SET correct_index = 3
  WHERE id = '578551bc-dab1-4e1f-90f3-e7ec33bd69c0'
    AND correct_index = 0;

-- В каком фильме Хоакин Феникс играет императора Рима?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Гладиатор'
UPDATE questions
  SET correct_index = 1
  WHERE id = '58192a3f-9cf8-485c-b03a-40acd5a48bda'
    AND correct_index = 0;

-- Кто снял «Земляничную поляну»?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Бергман'
UPDATE questions
  SET correct_index = 1
  WHERE id = '58ebb81e-c956-4f4e-b9a5-cd3c6c0be018'
    AND correct_index = 4;

-- Кто написал оперу «Нос»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Шостакович'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5905293e-44eb-4378-a39f-7e2027770d2a'
    AND correct_index = 1;

-- Что изучает квантовая механика?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Поведение частиц на атомном уровне'
UPDATE questions
  SET correct_index = 1
  WHERE id = '59c14100-2c69-49b0-a92c-ee628213da5f'
    AND correct_index = 3;

-- Что такое морфема?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Минимальная значимая единица языка'
UPDATE questions
  SET correct_index = 3
  WHERE id = '59c97e1f-1997-479d-b9db-1511b153dde2'
    AND correct_index = 1;

-- Кто такой Симон Боливар?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Освободитель Южной Америки'
UPDATE questions
  SET correct_index = 3
  WHERE id = '5a402164-aeb2-4805-addc-c3c4378f6100'
    AND correct_index = 2;

-- В каком году произошло восстание декабристов?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1825'
UPDATE questions
  SET correct_index = 2
  WHERE id = '5a93a7c3-62ef-41a3-90db-7d2f79e294f3'
    AND correct_index = 1;

-- Кто основал Amazon?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Джефф Безос'
UPDATE questions
  SET correct_index = 1
  WHERE id = '5b0b6f01-cfde-40b5-bf4d-fb10fd79a3ad'
    AND correct_index = 2;

-- Кто написал «Капитал»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Карл Маркс'
UPDATE questions
  SET correct_index = 2
  WHERE id = '5b2f2d55-aa57-4a3b-83cc-4825b650fc81'
    AND correct_index = 0;

-- Столица Египта?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Каир'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5b57445e-5463-4bc6-9c92-778c38c46d44'
    AND correct_index = 1;

-- Назовите главного героя «Идиота»
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Мышкин'
UPDATE questions
  SET correct_index = 2
  WHERE id = '5c1ab7fc-c98f-4f55-8879-b0f85fe7cd71'
    AND correct_index = 0;

-- Кто режиссёр «Американской красоты»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Сэм Мендес'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5d3070f7-efb9-4fbb-ba7c-460a644e59f1'
    AND correct_index = 2;

-- Правда или ложь: Эверест находится в Южной Америке.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5d3ee025-69d9-48fb-b654-a4421724c0c3'
    AND correct_index = 1;

-- Сколько элементов в таблице Менделеева было на 2024 год?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '118'
UPDATE questions
  SET correct_index = 2
  WHERE id = '5dfaeebd-d311-4378-80de-b268fc4b3e2b'
    AND correct_index = 0;

-- Какой клуб называют “Красные дьяволы”?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Манчестер Юнайтед'
UPDATE questions
  SET correct_index = 3
  WHERE id = '5e6fa803-1cc8-453a-b614-84f76ba351b5'
    AND correct_index = 1;

-- Что такое синтаксис?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Раздел грамматики о строении предложений'
UPDATE questions
  SET correct_index = 0
  WHERE id = '5f13a7c2-df80-4299-85e5-42294a8a760c'
    AND correct_index = 2;

-- Кто снял «Лабиринт Фавна»?
-- Export ci=5 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Гильермо дель Торо'
UPDATE questions
  SET correct_index = 3
  WHERE id = '5f67b726-f328-4220-a5a5-e7228fc3cf56'
    AND correct_index = 5;

-- Что такое «Энума Элиш»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Вавилонский эпос о сотворении мира'
UPDATE questions
  SET correct_index = 3
  WHERE id = '5fd530c9-9cfc-4d26-9f57-0c17ad7005f1'
    AND correct_index = 0;

-- Кто играл Вито Корлеоне в молодости в «Крёстном Отце 2»?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Роберт Де Ниро'
UPDATE questions
  SET correct_index = 4
  WHERE id = '5feb76c0-a4c2-4dcb-9459-314762d7a9f7'
    AND correct_index = 1;

-- Кто такой Гордон Фримен?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Главный герой Half-Life'
UPDATE questions
  SET correct_index = 1
  WHERE id = '5ffba170-6f70-4b03-8aaa-c02bfdf5e906'
    AND correct_index = 2;

-- Сколько лет длилась Тридцатилетняя война?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '30 лет'
UPDATE questions
  SET correct_index = 0
  WHERE id = '603a42a0-b7de-4226-b7eb-6f7c319c2af7'
    AND correct_index = 4;

-- Кто написал «Времена года»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Вивальди'
UPDATE questions
  SET correct_index = 0
  WHERE id = '60559400-52e5-4bf3-abb3-dda26a8dc5cf'
    AND correct_index = 2;

-- Кто снял «Семь самураев»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Куросава'
UPDATE questions
  SET correct_index = 0
  WHERE id = '61202bd7-3704-41e9-bde6-29d514a70f5b'
    AND correct_index = 2;

-- Кто такой Чингисхан?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Монгольский хан'
UPDATE questions
  SET correct_index = 3
  WHERE id = '6134f9d4-2b2a-462d-bb5d-353cb61d772e'
    AND correct_index = 0;

-- Как называется последний роман Толстого?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Воскресение'
UPDATE questions
  SET correct_index = 0
  WHERE id = '61747630-9fd1-4eb5-8217-225a2325c065'
    AND correct_index = 2;

-- В каком городе находится мечеть аль-Акса?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Иерусалим'
UPDATE questions
  SET correct_index = 2
  WHERE id = '61db01bc-29dc-4160-a24d-c6528d5585d5'
    AND correct_index = 0;

-- В каком городе родился Моцарт?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Зальцбург'
UPDATE questions
  SET correct_index = 3
  WHERE id = '61f462bf-ba04-4152-8fce-8efd1dcf9b3f'
    AND correct_index = 2;

-- Что такое «овертайм» в НБА?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Дополнительные 5 минут при ничьей'
UPDATE questions
  SET correct_index = 1
  WHERE id = '621cf0b3-4bca-4a0d-ab23-acc54c4a4c3b'
    AND correct_index = 2;

-- Кто такой Жан-Поль Сартр?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Французский экзистенциалист'
UPDATE questions
  SET correct_index = 2
  WHERE id = '62338245-01fd-4da0-9282-9745ba6d0512'
    AND correct_index = 3;

-- Какая страна первой запустила искусственный спутник Земли?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'СССР'
UPDATE questions
  SET correct_index = 4
  WHERE id = '63751faa-295e-4337-89b1-522291032922'
    AND correct_index = 0;

-- Что такое диффракция?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Огибание волнами препятствий'
UPDATE questions
  SET correct_index = 3
  WHERE id = '64202e7f-a1c0-4cf6-b9c6-92c2f7f5c57d'
    AND correct_index = 2;

-- Кто открыл таблицу элементов?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Менделеев'
UPDATE questions
  SET correct_index = 0
  WHERE id = '649a9fb7-2d81-4e37-a703-769dd3d28857'
    AND correct_index = 1;

-- Правда или ложь: Париж расположен на реке Темзе.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 0
  WHERE id = '659126c5-d1e1-4f28-bdbe-5718f7853e1e'
    AND correct_index = 1;

-- В каком году Наполеон был сослан на Эльбу?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1814'
UPDATE questions
  SET correct_index = 1
  WHERE id = '663a50b3-07e8-4f13-9eae-aad5c647305e'
    AND correct_index = 2;

-- Что такое блокчейн?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Распределённая база данных'
UPDATE questions
  SET correct_index = 2
  WHERE id = '6682e4ab-a9f5-4a56-91f3-82b22e1fff5c'
    AND correct_index = 0;

-- Кто написал «Поцелуй» (картину)?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Климт'
UPDATE questions
  SET correct_index = 4
  WHERE id = '6773aaf4-e4b3-4a37-9e07-c6928dfab6f8'
    AND correct_index = 2;

-- Кто написал «Степной волк»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Гессе'
UPDATE questions
  SET correct_index = 3
  WHERE id = '680ceb91-1999-483d-93f9-6a159e513312'
    AND correct_index = 0;

-- Правда или ложь: у треугольника три стороны.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '681dfd7c-57d0-458b-920b-6e8449d58b93'
    AND correct_index = 1;

-- Из чего делают хумус?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Нут'
UPDATE questions
  SET correct_index = 1
  WHERE id = '69b86b45-825c-49df-bb5e-bc40fae714fd'
    AND correct_index = 2;

-- Что такое «шерцо»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Быстрая шутливая пьеса'
UPDATE questions
  SET correct_index = 3
  WHERE id = '6a93d2f7-a51c-466b-bfe5-102ef6f56d0f'
    AND correct_index = 2;

-- В каком году написан «Дон Кихот»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1605'
UPDATE questions
  SET correct_index = 0
  WHERE id = '6b38c793-327e-4133-acb2-3d28b84c8ec3'
    AND correct_index = 3;

-- Какой остров является крупнейшим в мире?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Гренландия'
UPDATE questions
  SET correct_index = 2
  WHERE id = '6c5efa4f-d505-4ccf-9e00-9b7a5e42339b'
    AND correct_index = 1;

-- Что такое «допинг» и ВАДА?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Запрещённые вещества и Всемирное антидопинговое агентство'
UPDATE questions
  SET correct_index = 1
  WHERE id = '6d86ac6b-cdd5-4bef-b356-be54a8b181d2'
    AND correct_index = 3;

-- Столица Таиланда?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Бангкок'
UPDATE questions
  SET correct_index = 1
  WHERE id = '6df77e4e-4120-4da7-b547-78679abc3ee7'
    AND correct_index = 2;

-- В каком году вышел «Броненосец Потёмкин»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1925'
UPDATE questions
  SET correct_index = 1
  WHERE id = '6e04e66c-3ac9-4a16-bfcb-37a4917a95d4'
    AND correct_index = 0;

-- Какая единица измеряет частоту?
-- Export ci=5 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Герц'
UPDATE questions
  SET correct_index = 3
  WHERE id = '6e08fe87-cfda-4386-be98-9ab269f1ad3f'
    AND correct_index = 5;

-- Кто написал «Пасторальную симфонию»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Бетховен'
UPDATE questions
  SET correct_index = 0
  WHERE id = '6f8c016a-e506-45f3-a5b3-426d4f27c013'
    AND correct_index = 2;

-- Кто написал «Одиссею»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Гомер'
UPDATE questions
  SET correct_index = 3
  WHERE id = '6fc72fa1-097d-42af-a9d6-48ff0dc0bc3d'
    AND correct_index = 2;

-- Кто играл главную роль в «Таксисте» Скорсезе?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Роберт Де Ниро'
UPDATE questions
  SET correct_index = 0
  WHERE id = '6ff7f6f8-dbc0-427d-b114-834a2f02b0d7'
    AND correct_index = 2;

-- Какая единица измеряет электрическое сопротивление?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Ом'
UPDATE questions
  SET correct_index = 1
  WHERE id = '7036fef0-bc71-4623-9d49-621f13b1d6c9'
    AND correct_index = 4;

-- Кто такой Джон Мейнард Кейнс?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Британский экономист'
UPDATE questions
  SET correct_index = 2
  WHERE id = '720ef685-ac1a-4a0f-b364-903f21bffa57'
    AND correct_index = 1;

-- Какой город столица Австрии?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Вена'
UPDATE questions
  SET correct_index = 3
  WHERE id = '72136647-c3e2-4c0e-a97d-f3059277d415'
    AND correct_index = 2;

-- Через сколько стран протекает Дунай?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '10'
UPDATE questions
  SET correct_index = 1
  WHERE id = '72b52926-f787-4b57-9f0d-1ac2aa47eae1'
    AND correct_index = 3;

-- Что такое «свободный стиль» в борьбе?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Разрешены захваты ниже пояса'
UPDATE questions
  SET correct_index = 3
  WHERE id = '72d09116-2f4a-4073-a056-10f3ac8ee4b9'
    AND correct_index = 0;

-- Какая империя была самой большой в истории?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Британская'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7336d83b-0537-43d1-a488-c19ecbecf5ed'
    AND correct_index = 1;

-- Кто написал «Вишнёвый сад»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Чехов'
UPDATE questions
  SET correct_index = 1
  WHERE id = '739d860b-3d6a-48ec-a12b-512cc88905e7'
    AND correct_index = 0;

-- Кто написал «Идиот»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Достоевский'
UPDATE questions
  SET correct_index = 1
  WHERE id = '7420f6c5-7821-4967-8fb4-96a4c20910bb'
    AND correct_index = 0;

-- Какой жанр фильма «Молчание ягнят»?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Триллер'
UPDATE questions
  SET correct_index = 1
  WHERE id = '76591915-63f1-4e2f-b176-b4620b26a906'
    AND correct_index = 4;

-- Правда или ложь: Земля имеет один естественный спутник.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7918bba2-aafb-4225-9acb-d03b52b538cc'
    AND correct_index = 1;

-- В какой стране находится Акрополь?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Греция'
UPDATE questions
  SET correct_index = 2
  WHERE id = '79840572-28dc-4858-9d71-5de02db578e5'
    AND correct_index = 0;

-- Сколько клавиш на стандартном фортепиано?
-- Export ci=5 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '88'
UPDATE questions
  SET correct_index = 3
  WHERE id = '79ca7542-71d7-4ba6-bf64-959e09c519bd'
    AND correct_index = 5;

-- Какой прибор измеряет температуру?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Термометр'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7a054559-7c37-402b-99c7-020834b66c33'
    AND correct_index = 1;

-- Какой остров является самым большим в Средиземном море?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Сицилия'
UPDATE questions
  SET correct_index = 2
  WHERE id = '7b125c5d-eee1-4bd7-af5f-78b9f2a9fba6'
    AND correct_index = 0;

-- В каком фильме Брандо кричит «Стелла»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Трамвай желание'
UPDATE questions
  SET correct_index = 1
  WHERE id = '7b99da8e-8f88-4cfe-a178-af164204417b'
    AND correct_index = 0;

-- В каком году вышел первый Sonic the Hedgehog?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: '1991'
UPDATE questions
  SET correct_index = 4
  WHERE id = '7c3e1537-5f6f-46bd-81c7-f161493b4f5c'
    AND correct_index = 2;

-- В каком году основан Google?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1998'
UPDATE questions
  SET correct_index = 2
  WHERE id = '7c6b9143-54cb-428e-83ba-7ede3cac637a'
    AND correct_index = 3;

-- Как называется самый большой спутник Сатурна?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Титан'
UPDATE questions
  SET correct_index = 2
  WHERE id = '7d229b2d-6558-40ac-aec1-4792be2f2295'
    AND correct_index = 0;

-- Кто из них занимает Пиренейский полуостров?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Испания и Португалия'
UPDATE questions
  SET correct_index = 2
  WHERE id = '7d39af4e-4d2f-4783-9689-6d060dbc0e3b'
    AND correct_index = 1;

-- Кто режиссёр «Реквием по мечте»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Даррен Аронофски'
UPDATE questions
  SET correct_index = 3
  WHERE id = '7d490682-b7d2-4a3b-8375-d988db2c4919'
    AND correct_index = 2;

-- Какой металл жидкий при комнатной температуре?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Ртуть'
UPDATE questions
  SET correct_index = 3
  WHERE id = '7e1e4b28-f71a-4393-8abb-c916074292f3'
    AND correct_index = 1;

-- Какой цвет у центрального круга на флаге Японии?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Красный'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7eb3fa60-6bc5-4fd2-8f07-c302057766a7'
    AND correct_index = 1;

-- Как называется нота «до» в английской системе?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'C'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7f6b63d0-9411-4826-940c-781a60c9c5b4'
    AND correct_index = 1;

-- Что такое ИИ?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Искусственный интеллект'
UPDATE questions
  SET correct_index = 1
  WHERE id = '7fdc8b5f-d95a-4607-8122-ad2a9a0863e1'
    AND correct_index = 2;

-- Как называется финальная часть сонаты?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Кода'
UPDATE questions
  SET correct_index = 0
  WHERE id = '7fe9e69a-5fce-4cbc-beab-4d2c5919c6cf'
    AND correct_index = 1;

-- Кто такой Захид Хадид?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Иракско-британский архитектор'
UPDATE questions
  SET correct_index = 2
  WHERE id = '805f69fc-2553-4e48-9aad-87fa8f83f5eb'
    AND correct_index = 1;

-- Правда или ложь: в Super Mario главный герой носит красную кепку.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = '80af6b18-bfb2-42bb-9023-548b3ed0aa2d'
    AND correct_index = 1;

-- Как зовут коня Рапунцель?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Максимус'
UPDATE questions
  SET correct_index = 0
  WHERE id = '80ead740-b971-4265-b11a-52906be34f6b'
    AND correct_index = 4;

-- Кто написал «Граф Монте-Кристо»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Александр Дюма'
UPDATE questions
  SET correct_index = 2
  WHERE id = '8129352f-af4e-46f2-87f7-b689b0ebb426'
    AND correct_index = 0;

-- Кто ввёл брюки для женщин в моду?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Коко Шанель'
UPDATE questions
  SET correct_index = 3
  WHERE id = '81ea3bed-298a-436b-a3c2-077bdf4dbce2'
    AND correct_index = 2;

-- Правда или ложь: валюта Японии — юань.
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 1
  WHERE id = '82075b16-6f27-46fe-9f51-38b02357341b'
    AND correct_index = 0;

-- Кто написал «Имя розы»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Умберто Эко'
UPDATE questions
  SET correct_index = 1
  WHERE id = '828f2be8-6d3d-4f39-a613-fdcba2bb7f5d'
    AND correct_index = 0;

-- Сколько симфоний написал Бетховен?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '9'
UPDATE questions
  SET correct_index = 1
  WHERE id = '82b56a3b-56ba-4517-a5d8-a74b9bc4190b'
    AND correct_index = 3;

-- Кто написал балет «Весна священная»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Стравинский'
UPDATE questions
  SET correct_index = 1
  WHERE id = '82d5867c-001f-4ce7-be8d-0b97db57dbde'
    AND correct_index = 2;

-- Как называется модель ИИ от OpenAI?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'GPT'
UPDATE questions
  SET correct_index = 1
  WHERE id = '84406ef2-d310-42ba-a3f0-e18a10db51f5'
    AND correct_index = 2;

-- Кто написал «На дне»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Горький'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8477c4c9-2191-4ce9-82c0-a6d513da45bc'
    AND correct_index = 1;

-- В каком фильме Disney есть Тиана?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Принцесса и лягушка'
UPDATE questions
  SET correct_index = 1
  WHERE id = '84d08800-3892-4c0c-a61a-93e8703d9b20'
    AND correct_index = 3;

-- Сколько цветов в радуге?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '7'
UPDATE questions
  SET correct_index = 1
  WHERE id = '850b5b73-02b6-4c07-8dea-e846657be77b'
    AND correct_index = 0;

-- Что такое прокариот?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Организм без оформленного ядра'
UPDATE questions
  SET correct_index = 1
  WHERE id = '85a85806-2d84-48e0-a633-16d9ba31684e'
    AND correct_index = 0;

-- Что такое «резонанс» в физике?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Усиление колебаний при совпадении частот'
UPDATE questions
  SET correct_index = 2
  WHERE id = '865c7f61-93b9-40e0-acf5-f163e6a17f64'
    AND correct_index = 0;

-- Кто изобрёл лампочку?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Томас Эдисон'
UPDATE questions
  SET correct_index = 3
  WHERE id = '86ae26aa-f9a2-4602-bf6b-49eece4bb568'
    AND correct_index = 1;

-- Когда была Тридцатилетняя война?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1618-1648'
UPDATE questions
  SET correct_index = 1
  WHERE id = '86ce0aa0-423b-4f6d-875a-bc93404d85f5'
    AND correct_index = 0;

-- Кто такой Жан-Поль Готье?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Французский дизайнер'
UPDATE questions
  SET correct_index = 1
  WHERE id = '87604be5-520f-48e4-a0c5-cf0dc80af66b'
    AND correct_index = 2;

-- В каком спорте есть термин «страйк»?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Боулинг'
UPDATE questions
  SET correct_index = 0
  WHERE id = '882c961a-426c-4fac-8757-606bd8515b97'
    AND correct_index = 4;

-- В каком году Петр I стал царём?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1682'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8879ce6e-f868-42c0-901f-81117a3e70ae'
    AND correct_index = 1;

-- Какой город является самым высокогорным столицей мира?
-- Export ci=3 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Ла-Пас'
UPDATE questions
  SET correct_index = 4
  WHERE id = '889e61f0-5d0d-4c0f-bba2-10f0a2e5f25a'
    AND correct_index = 3;

-- Какой композитор написал “Времена года”?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Антонио Вивальди'
UPDATE questions
  SET correct_index = 3
  WHERE id = '88fdee30-2176-485b-a115-f8cd286c661d'
    AND correct_index = 4;

-- Какая древняя цивилизация построила пирамиды в Гизе?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Египтяне'
UPDATE questions
  SET correct_index = 2
  WHERE id = '891f025e-14cd-4dba-8e88-74959564e7c6'
    AND correct_index = 1;

-- Какой город является столицей Южной Кореи?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Сеул'
UPDATE questions
  SET correct_index = 0
  WHERE id = '89c1d0ce-91ab-4281-9b34-1385f3acea82'
    AND correct_index = 3;

-- Какой фильм Кубрика о Первой мировой?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Тропы славы'
UPDATE questions
  SET correct_index = 3
  WHERE id = '89d69423-a852-4edd-920e-d350c5a4137d'
    AND correct_index = 1;

-- Как называется самая высокая гора Африки?
-- Export ci=3 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Килиманджаро'
UPDATE questions
  SET correct_index = 4
  WHERE id = '89ef6304-a59f-46fa-9fbb-4f52e983e753'
    AND correct_index = 3;

-- Кто режиссёр фильма «Аватар» 2009 года?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Джеймс Кэмерон'
UPDATE questions
  SET correct_index = 1
  WHERE id = '8a2b2944-6f99-41b3-8060-088c26a3ff53'
    AND correct_index = 2;

-- Кто написал пьесу “Гамлет”?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Уильям Шекспир'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8a731ad8-0574-4056-9ff5-f44e17f79e01'
    AND correct_index = 4;

-- Кто написал роман «Война и мир»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Лев Толстой'
UPDATE questions
  SET correct_index = 1
  WHERE id = '8aacd4a7-d82c-496c-9c4a-9f8617a7f4d8'
    AND correct_index = 2;

-- Какой фильм про вторжение в мозг?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Начало'
UPDATE questions
  SET correct_index = 1
  WHERE id = '8ac5c365-cba7-45f2-a7d3-1ccc4cd93c49'
    AND correct_index = 2;

-- Кто написал «Хорошо темперированный клавир»?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Бах'
UPDATE questions
  SET correct_index = 3
  WHERE id = '8b777d77-3fca-4eba-bc1b-0bde14cc71c7'
    AND correct_index = 1;

-- Кто написал «Кольцо нибелунга»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Вагнер'
UPDATE questions
  SET correct_index = 2
  WHERE id = '8c4eb6cf-3995-4cab-af51-fd36a2b9f1f9'
    AND correct_index = 1;

-- Что такое ковалентная связь?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Связь через общие электроны'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8cf17f51-1f6f-41b7-a69b-b1cc6d252e0d'
    AND correct_index = 2;

-- Какое животное имеет самую длинную шею?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Жираф'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8ec940e0-63f1-42ce-91bd-687ddbabbcb9'
    AND correct_index = 2;

-- Сколько костей у взрослого человека?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '206'
UPDATE questions
  SET correct_index = 0
  WHERE id = '8f5a4e26-fc08-4cdc-8e2e-025d1725e4b3'
    AND correct_index = 3;

-- Как называется низкий женский голос в опере?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Контральто'
UPDATE questions
  SET correct_index = 1
  WHERE id = '8ff65914-1793-46d7-a153-85cd67fab715'
    AND correct_index = 0;

-- Кто озвучивал Шрека в оригинальной версии?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Майк Майерс'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9108856f-77fb-4d32-8c43-2861787bc7cd'
    AND correct_index = 3;

-- Кто такой Вирджил Абло?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Американский дизайнер основатель Off-White'
UPDATE questions
  SET correct_index = 1
  WHERE id = '91d97b0a-df76-4ab9-b59b-cf221e798de4'
    AND correct_index = 4;

-- Что такое рагу?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Тушёное мясо с овощами'
UPDATE questions
  SET correct_index = 2
  WHERE id = '92941b3f-89ca-4ecb-8311-59d19841e096'
    AND correct_index = 3;

-- Кто открыл Америку для европейцев в 1492 году?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Христофор Колумб'
UPDATE questions
  SET correct_index = 1
  WHERE id = '933f7df8-5e36-434b-bc2e-ced3ea990f41'
    AND correct_index = 3;

-- Какой клуб играет домашние матчи на стадионе «Сантьяго Бернабеу»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Реал Мадрид'
UPDATE questions
  SET correct_index = 3
  WHERE id = '93bf689b-e7e7-432a-ad7d-13de261377a1'
    AND correct_index = 2;

-- Кто сыграл Хановера в «Хаосе»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Джейсон Стэйтем'
UPDATE questions
  SET correct_index = 1
  WHERE id = '941f6aa7-d3af-4967-a62f-3cd48f9d7710'
    AND correct_index = 2;

-- Кто написал музыку к балету “Лебединое озеро”?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Пётр Чайковский'
UPDATE questions
  SET correct_index = 2
  WHERE id = '950f3613-c5e2-41e3-8efe-13510f035604'
    AND correct_index = 1;

-- Какая страна имеет самую длинную береговую линию?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Канада'
UPDATE questions
  SET correct_index = 2
  WHERE id = '95a87944-ebe5-429f-ab3e-40c253c50767'
    AND correct_index = 3;

-- Правда или ложь: химический символ золота — Au.
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 1
  WHERE id = '96f00303-5c6e-42fb-b0fe-ef4e4448a127'
    AND correct_index = 0;

-- Кто снял «Горбатую гору»?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Энг Ли'
UPDATE questions
  SET correct_index = 3
  WHERE id = '977cea25-0901-4b06-ad37-b4e349d7190a'
    AND correct_index = 1;

-- Кто написал «Обломов»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Гончаров'
UPDATE questions
  SET correct_index = 0
  WHERE id = '979bdb17-ffa1-4564-82a9-3ac13f3fe795'
    AND correct_index = 2;

-- Кто был вокалистом Queen?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Фредди Меркьюри'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9992a5ba-8710-4e39-9b81-182a4ca9e79f'
    AND correct_index = 0;

-- Что такое производная?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Скорость изменения функции'
UPDATE questions
  SET correct_index = 0
  WHERE id = '9a391d4c-1474-4b10-916a-24991856abf0'
    AND correct_index = 1;

-- В каком году Пастернак получил Нобелевскую премию?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1958'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9b3d9cfa-11a1-4b73-a32c-32f38ad41da3'
    AND correct_index = 1;

-- Назовите главного героя «Героя нашего времени»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Печорин'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9b3f883b-90c7-41d9-80a6-5af614637f3b'
    AND correct_index = 0;

-- Какое море омывает Испанию с востока?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Средиземное'
UPDATE questions
  SET correct_index = 0
  WHERE id = '9b47fe33-2537-4d5a-91a2-e47d605f3088'
    AND correct_index = 1;

-- В каком фильме Марчелло Мастроянни в фонтане?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Сладкая жизнь'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9b75185c-30bf-41f8-a622-40ee488cdbfb'
    AND correct_index = 0;

-- В какой игре есть блоки крипера, алмазы и Нижний мир?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Minecraft'
UPDATE questions
  SET correct_index = 0
  WHERE id = '9bc6a93b-b47b-4109-8bc7-b43bc0ed6363'
    AND correct_index = 2;

-- Кто провёл «Стэнфордский тюремный эксперимент»?
-- Export ci=5 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Зимбардо'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9bdafea3-cff1-4d47-975d-587beb9f880e'
    AND correct_index = 5;

-- Правда или ложь: сердце человека обычно имеет четыре камеры.
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9d9ed899-8ca3-41c1-b3ce-2a4797020a1f'
    AND correct_index = 0;

-- Кто играл Джокера в фильме 2019 года?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Хоакин Феникс'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9db586ab-d34f-408a-ae69-ef46d252472b'
    AND correct_index = 2;

-- Что такое интервальное голодание?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Режим питания с окнами для еды и голодания'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9e0cc03e-c08e-434d-a905-721cfeaabb83'
    AND correct_index = 1;

-- Кто снял «Криминальное чтиво»?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Квентин Тарантино'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9e1dd7c8-c061-4957-a229-c023df070911'
    AND correct_index = 3;

-- Как называется музыкальный размер 3/4?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Вальс'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9e28bb27-f5e1-45ca-ba97-106cdd7c6263'
    AND correct_index = 4;

-- Какая страна состоит из четырёх исторических частей: Англии, Шотландии
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Великобритания'
UPDATE questions
  SET correct_index = 3
  WHERE id = '9e4f206e-f73c-475b-b9bb-41127458e727'
    AND correct_index = 1;

-- Какое море омывает Египет с востока?
-- Export ci=5 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Красное море'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9e72ccad-59cc-4f17-a269-871593a90ad9'
    AND correct_index = 5;

-- Какая страна выиграла первый чемпионат мира по футболу в 1930 году?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Уругвай'
UPDATE questions
  SET correct_index = 3
  WHERE id = '9ec83158-2c00-41aa-877b-a69dedee772b'
    AND correct_index = 2;

-- Какой фильм Клинта Иствуда получил Оскар за лучший фильм?
-- Export ci=5 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Малышка на миллион'
UPDATE questions
  SET correct_index = 2
  WHERE id = '9ed1c251-bc4d-48c6-b5dd-f344518a5333'
    AND correct_index = 5;

-- Правда или ложь: звук может распространяться в полном вакууме.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 0
  WHERE id = '9fccf014-f805-47b0-8a58-600dee9f8fc3'
    AND correct_index = 1;

-- Как называется наука о наследственности?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Генетика'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a0306924-fb7f-461d-b41f-ff60c980b191'
    AND correct_index = 0;

-- Какой город был разрушен извержением Везувия в 79 году?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Помпеи'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a13c4eaf-6a9a-4dd0-976f-b43c7b78ef75'
    AND correct_index = 0;

-- Из чего делают кимчи?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Ферментированная капуста'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'a187a636-f07e-4dd2-9bdb-0b454bc037d1'
    AND correct_index = 1;

-- Что такое праймериз?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Внутрипартийные выборы кандидата'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a1cf1091-f23d-42a7-be89-77a8749d48a4'
    AND correct_index = 4;

-- Какое море между Италией и Балканами?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Адриатическое'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a23ba2f8-b97a-4f90-bb1b-e1e8d606fbf3'
    AND correct_index = 2;

-- В каком году был основан Константинополь?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '330'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a28e7ae2-1c36-442d-bebc-f1bc31df6c5c'
    AND correct_index = 0;

-- Какой океан самый большой по площади?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Тихий'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a2a1e0e9-f308-4740-a194-fed6d536ef96'
    AND correct_index = 0;

-- Какой фильм Скорсезе о торговце акциями?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Волк с Уолл-стрит'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a2b747ed-1910-4e78-b205-10c17c3ff71b'
    AND correct_index = 4;

-- Через сколько стран протекает Амазонка?
-- Export ci=4 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '9'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a343bb89-4fba-4bbb-af2f-2caa5bbdecfa'
    AND correct_index = 4;

-- Кто снял «Весь этот джаз»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Боб Фосс'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'a349e7f7-06a9-4c38-9a13-d4e101d1794b'
    AND correct_index = 3;

-- Столица Новой Зеландии?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Веллингтон'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a3807b7c-1dda-4ce3-bca6-a3bc9cbb2d0e'
    AND correct_index = 3;

-- В каком году произошла битва при Куликовом поле?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1380'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a3821217-c12d-4b4e-a3d9-655aa45e306e'
    AND correct_index = 2;

-- Какой пролив разделяет Европу и Африку у входа в Средиземное море?
-- Export ci=4 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Гибралтарский пролив'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'a475fd10-1e0d-43dd-98bc-ec6ec0e91137'
    AND correct_index = 4;

-- Кто такой Хаммурапи?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Вавилонский царь'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a48a68ae-e67f-43b9-8cf4-109a32b3d7b8'
    AND correct_index = 4;

-- Что изучает энтомология?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Насекомых'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'a51f9aa3-5914-4bec-93e7-dd84d2b9f1b0'
    AND correct_index = 2;

-- Правда или ложь: картина «Мона Лиза» написана Винсентом ван Гогом.
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Ложь'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'a60d2547-ffb8-4385-8056-4e1a949dee72'
    AND correct_index = 1;

-- В каком году вышел первый Pokémon?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1996'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a6a22b61-a10c-4e89-a015-0a84a0e3ec3f'
    AND correct_index = 0;

-- Что такое «лор» в игровых и фандомных сообществах?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Вымышленная история и мифология вселенной'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'a6f97406-87cb-4b3c-9baa-ad97631c1849'
    AND correct_index = 3;

-- Кто такой Ришелье?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Французский кардинал и политик'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'a8762265-af70-4c18-9615-38ae4b7e68fd'
    AND correct_index = 1;

-- Что такое «форте»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Громко'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a96e0b2b-f7c1-419c-8e92-2f96114fa334'
    AND correct_index = 0;

-- Кто написал музыку к Undertale?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Тоби Фокс'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a98c9182-e958-4d08-9422-10701c283f91'
    AND correct_index = 2;

-- Кто написал «Мастер и Маргарита»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Булгаков'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'a9ab3f99-1bb2-45e8-8dd6-f31b69b9e949'
    AND correct_index = 1;

-- В каком жанре написан «Дон Кихот»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Роман'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'a9be15ee-a176-4f8a-9522-0add5eedceaa'
    AND correct_index = 1;

-- Сколько лет длилась Холодная война?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '44 года'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'aa1f0b1a-856a-4de9-9a12-9daf044832a1'
    AND correct_index = 3;

-- Какой элемент самый распространённый во вселенной?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Водород'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'aa2af844-fcd4-4888-8862-796cb1286f19'
    AND correct_index = 2;

-- Что такое «экзопланета»?
-- Export ci=3 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Планета вне Солнечной системы'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'aa49e82d-b5c0-4214-a8ab-974fb05f68f8'
    AND correct_index = 3;

-- Кто предложил модель атома с ядром?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Резерфорд'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'aa6529e9-065f-4f9d-bca0-8b3a426ab06f'
    AND correct_index = 2;

-- Что такое логарифм?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Показатель степени в которую нужно возвести основание'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'aaaf09d1-ca5d-4926-a811-37d8e5e77f82'
    AND correct_index = 2;

-- Что такое трансплантация?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Пересадка органов или тканей'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'abac5147-a776-4962-9c4f-d0d2a7040fe3'
    AND correct_index = 1;

-- Какая планета находится ближе всего к Солнцу?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Меркурий'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'ac8de62e-88d0-45c9-ba82-1030c67e3af9'
    AND correct_index = 2;

-- Что такое федерация?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Союз государственных образований'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'ad0e3c3b-f60b-4762-b70c-82024267cfb3'
    AND correct_index = 0;

-- Что такое КПТ?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Когнитивно-поведенческая терапия'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ae979c17-729d-4d12-b588-8a419ca971c8'
    AND correct_index = 1;

-- Как называется язык программирования созданный Гвидо ван Россумом?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Python'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'af2c70bb-60d1-4eba-a913-48f3e672f702'
    AND correct_index = 0;

-- Какой остров является самым населённым в мире?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Ява'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'af5346e1-a406-43ae-99e2-1886a83f6c0e'
    AND correct_index = 0;

-- Кто такой Фидель Кастро?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Кубинский революционер и лидер'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'af561589-9040-4ba7-a2b3-f128402aa8fb'
    AND correct_index = 2;

-- В каком году сборная Дании выиграла Евро по футболу?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1992'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'af96a16e-df4d-45c0-9bf3-d3a56a8b617b'
    AND correct_index = 1;

-- В каком году Каннский фестиваль присудил Золотую пальмовую ветвь «Апок
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1979'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b03f422b-6878-4ef5-80dd-8d9a00797304'
    AND correct_index = 3;

-- Кто написал музыку к «Психо»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Бернард Херрманн'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'b10f275c-f4fb-4c5a-aca2-8fa57b128422'
    AND correct_index = 2;

-- Как называется столица Австралии?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Канберра'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'b1732f30-76a7-4f7b-8ca0-1e0712125146'
    AND correct_index = 0;

-- В каком году произошла Варфоломеевская ночь?
-- Export ci=5 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1572'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'b1a4f78d-3aa9-4a54-8921-5d66faba1c33'
    AND correct_index = 5;

-- Кто написал «Симфонические этюды»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Шуман'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'b230942f-60cf-4347-bec9-9a3d36213f03'
    AND correct_index = 3;

-- Какой город является столицей Аргентины?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Буэнос-Айрес'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'b2b46b49-7dda-462a-9e80-c777b1e0e654'
    AND correct_index = 1;

-- Какая страна не имеет выхода к морю?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Швейцария'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'b307a4ef-1ccd-429d-aa4c-15496cde5840'
    AND correct_index = 3;

-- В каком фильме фраза «Frankly my dear I don't give a damn»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Унесённые ветром'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b35d699c-ac17-4813-b87e-e1692103d8be'
    AND correct_index = 0;

-- Какой фильм Кубрика снят по роману Теккерея?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Барри Линдон'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'b3c12f87-8407-4e4d-88d1-e7b4070d5cec'
    AND correct_index = 4;

-- В какой стране находится Ангкор-Ват?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Камбоджа'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'b3ca349e-2cec-49ab-b2bb-c5e7b072ba11'
    AND correct_index = 1;

-- В каком году Пётр I основал Петербург?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1703'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'b3d03f8a-567c-4262-879b-5a1735a3d6a6'
    AND correct_index = 1;

-- Что такое гравюра?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Рисунок выдавленный на материале'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b4f87f7c-6556-409e-9e47-4ba566ed3b78'
    AND correct_index = 0;

-- Где родился Иисус Христос?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Вифлеем'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'b4fce772-cc7d-4a6f-8cbc-8313dc72d32c'
    AND correct_index = 1;

-- В каком году Усэйн Болт установил мировой рекорд на 100м?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '2009'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b7103335-67db-442a-9d48-0c1db7a9e1a8'
    AND correct_index = 2;

-- Кто такой Артуро Тосканини?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Итальянский дирижёр'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b77e5b76-a719-442f-aea1-91c64abd099f'
    AND correct_index = 2;

-- Какая игра про выживание с крафтингом вышла в 2011?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Minecraft'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b7d300e9-7b9f-4520-807c-26ba6c1c792b'
    AND correct_index = 4;

-- Кто написал «Государь»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Макиавелли'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'b8ef727c-37ce-4a35-a302-bde4994b90bb'
    AND correct_index = 0;

-- Как называется самый известный альбом Pink Floyd?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'The Dark Side of the Moon'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ba2e92b8-8975-4e90-b9ad-f6fdf1d6e6d8'
    AND correct_index = 2;

-- Согласно народным приметам, если сорока сидит напротив дома и стрекоче
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'К новостям'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'baedb55c-2470-4e3d-aba4-333aa51e3814'
    AND correct_index = 2;

-- Какой фильм получил 11 “Оскаров” и связан с кораблём?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Титаник'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'bb8dc652-1e42-47ff-a60c-6d5d03c61af9'
    AND correct_index = 1;

-- Кто такая Афина?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Богиня мудрости и войны'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'bc658918-ff09-4dc6-860b-f41e9cc7de03'
    AND correct_index = 1;

-- Сколько планет в Солнечной системе?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '8'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'bcd4ce08-7c65-44f9-b0b5-ae1cadc67b3a'
    AND correct_index = 0;

-- Какой город был столицей Древнего Египта в разные периоды?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Мемфис'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'bd3aef29-23ca-4b62-bbb8-ac30672eb8d3'
    AND correct_index = 0;

-- В каком году произошёл Карибский кризис?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '1962'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'be019d9e-63a4-40fa-b248-dd3836c447dd'
    AND correct_index = 4;

-- Назовите главного героя «Мёртвых душ»
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Чичиков'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'be5f7ad5-7004-4cd5-ba96-92057e2ac5dc'
    AND correct_index = 0;

-- Кто такой Каруссо?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Итальянский тенор'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'be87d007-6dc6-4e09-80e3-5730cac3609d'
    AND correct_index = 0;

-- Какой материк почти полностью покрыт льдом?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Антарктида'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'bebee15b-b85d-4d65-b357-c7cbb00e106e'
    AND correct_index = 0;

-- В каком фильме звучит фраза «Я вижу мёртвых людей»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Шестое чувство'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'bf75c030-bb46-4d96-b30c-6dcbe32b2e02'
    AND correct_index = 0;

-- В каком фильме Брэд Питт играет боксёра?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Большой куш'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'c01a5265-565f-415e-b1bb-c66815e5ed63'
    AND correct_index = 2;

-- Чему равна абсолютная нулевая температура?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '-273,15°C'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'c01b53a6-8d97-42e3-8fb5-b425e500af9a'
    AND correct_index = 2;

-- Кто написал «Нейромант»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Гибсон'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c0ce0de7-c739-4511-9c93-d1c476d15aff'
    AND correct_index = 2;

-- Как называется главный враг в Zelda?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Ганон'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c125e2d7-6bcc-4e2e-8911-f103edc27f93'
    AND correct_index = 1;

-- Какой писатель создал «Алису в Стране чудес»?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Льюис Кэрролл'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'c126203e-2ae4-469d-a5d0-133e7411da16'
    AND correct_index = 0;

-- Как называется студия которая сделала «Историю игрушек»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Pixar'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'c15a1164-1372-46b0-9f37-f0355ec3d252'
    AND correct_index = 0;

-- Кто такой Новак Джокович?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Сербский теннисист'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'c1d08cde-5107-4d71-93a0-8bb863207f5f'
    AND correct_index = 0;

-- Что такое интерференция?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Сложение волн с усилением или ослаблением'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c1e017ef-aeca-4a8e-82aa-9084dff59982'
    AND correct_index = 1;

-- В каком году произошла Куликовская битва?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1380'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c2248677-3ea2-49aa-8892-91a2341fe08f'
    AND correct_index = 1;

-- Что такое нейрон?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Нервная клетка'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'c240a477-b127-47a5-977f-29f1c001dfb3'
    AND correct_index = 0;

-- Какая студия создала мультфильм «Унесённые призраками»?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Studio Ghibli'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c25e50f7-0151-45af-acda-3343056d7c1e'
    AND correct_index = 3;

-- В каком году вышел «Метрополис» Ланга?
-- Export ci=5 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1927'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c2969147-aab0-4c2e-bb83-f5940218c817'
    AND correct_index = 5;

-- В каком году Майкл Джордан выиграл первый чемпионат НБА?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1991'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c298003a-fc9a-45a5-ad60-998f2ae3b29c'
    AND correct_index = 2;

-- Что такое православие?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Восточное христианство'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'c2b4478b-697c-4aa1-90be-793b90d520a4'
    AND correct_index = 0;

-- Какой город является крупнейшим в Африке?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Лагос'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'c2d5ced1-7dde-4c54-9bb3-615f614915c4'
    AND correct_index = 1;

-- Сколько сетов нужно выиграть в теннисе на мужском Шлеме?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '3'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'c35e4a3b-fd0a-4d14-b094-45fc2311f3e5'
    AND correct_index = 0;

-- Кто написал «Парфюмер»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Патрик Зюскинд'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'c42cdfa7-7d1a-43f5-ad73-6e5179a0f850'
    AND correct_index = 1;

-- Кто такой Валентино Росси?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Итальянский мотогонщик'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'c492753b-116f-48f5-b520-eb5661cd5a26'
    AND correct_index = 1;

-- В каком году человек впервые высадился на Луне?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1969'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c4ee55fd-155e-4326-9ab4-dedf01ddd219'
    AND correct_index = 1;

-- Кто написал «Весну» (La Primavera)?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Боттичелли'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c57718a3-7f46-45bc-b600-dbd6e2773e89'
    AND correct_index = 1;

-- Как называется картина Мунка?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Крик'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'c6259159-98b6-4a43-8aad-f0280ef80d72'
    AND correct_index = 1;

-- В каком году Индия получила независимость?
-- Export ci=4 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1947'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'c71e7c18-809d-48c4-98d7-92d0aca8427c'
    AND correct_index = 4;

-- Кто такой Меттерних?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Австрийский дипломат'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'c7d6a316-8fdc-4c91-ac01-f0d09d398d43'
    AND correct_index = 0;

-- Что такое «теорема Пифагора»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'a²+b²=c² для прямоугольного треугольника'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c82b79d5-33c1-4144-a54d-33f741f36d3a'
    AND correct_index = 1;

-- Какой язык самый распространённый по числу носителей?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Мандаринский китайский'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c8dbbb33-708b-4128-846e-396691ad11b0'
    AND correct_index = 1;

-- Кто написал «Цветы зла»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Бодлер'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'c97c72ec-cbac-4d30-8fd6-76f2765d9fdc'
    AND correct_index = 2;

-- Кто создал серию Ico и Shadow of the Colossus?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Фумито Уэда'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c9947830-9aee-4e87-a58c-16e14521074a'
    AND correct_index = 4;

-- Кто написал «Картинки с выставки»?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Мусоргский'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'c9b07577-48b2-4611-83e4-30f6c69f0afc'
    AND correct_index = 4;

-- Кто написал роман на основе которого снят «Побег из Шоушенка»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Стивен Кинг'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'c9ece0d1-70ba-4e95-8aea-884fd6c820be'
    AND correct_index = 2;

-- Кто снял «Список Шиндлера»?
-- Export ci=0 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Стивен Спилберг'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'cbac1f91-3ee5-4483-89af-0d91889e39c8'
    AND correct_index = 0;

-- Кто такой Анубис?
-- Export ci=1 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Египетский бог смерти с головой шакала'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'cbf71764-8dbf-463f-9148-1fd7c73e6eca'
    AND correct_index = 1;

-- Сколько частей у оригинальной истории «Назад в будущее»?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '3'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'cc069705-e1ad-4da9-9a28-42594e0d5bd5'
    AND correct_index = 2;

-- Кто снял «Однажды на Диком Западе»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Серджио Леоне'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'cc3a4215-d5da-40fd-95c2-0b062bafcbea'
    AND correct_index = 0;

-- Из какого города родом Дэвид Боуи?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Лондон'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'cc505e73-dbf0-4e2c-80df-e7eb003d5b0f'
    AND correct_index = 0;

-- Кто был правителем Франции во время похода в Россию 1812 года?
-- Export ci=3 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Наполеон Бонапарт'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'cce6c3f5-0342-4c6d-8156-eac39cbe97bb'
    AND correct_index = 3;

-- Какой художник написал «Крик»?
-- Export ci=5 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Эдвард Мунк'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'cd9063a7-a7a3-4ecb-a6aa-b06d8d4c0205'
    AND correct_index = 5;

-- Какое животное имеет самый большой мозг?
-- Export ci=1 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Кашалот'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'cda17264-8594-4ea7-80b7-342e69efd595'
    AND correct_index = 1;

-- Что такое миграция животных?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Сезонное перемещение'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ce20c85c-093e-4e27-afea-a3433c6eb175'
    AND correct_index = 2;

-- Что такое закон Мура?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Число транзисторов в процессоре удваивается каждые 2 года'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ce7f4bd0-0556-4155-a486-b35cdb8eb592'
    AND correct_index = 4;

-- В каком году Эйнштейн опубликовал теорию относительности?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1905'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'ce90a545-3d50-4f9b-9114-d3ac7bfd6b51'
    AND correct_index = 0;

-- Кто основал Монгольскую империю?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Чингисхан'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd01b1f0a-25cb-445d-9542-f76350e149cb'
    AND correct_index = 1;

-- Сколько видов насекомых существует примерно?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '~1 млн'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd01f9d57-617a-47aa-bc13-edc8f5263c47'
    AND correct_index = 3;

-- Сколько Оскаров у «Унесённых ветром»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '8'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'd0709c3e-9108-4478-8d8d-1f735fca0e06'
    AND correct_index = 0;

-- Как называется подземное царство в греческой мифологии?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Аид'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd15756e4-8fa5-4be7-8d08-f9ae1b59e7e0'
    AND correct_index = 1;

-- Кто написал «Котлован»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Платонов'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd1f86259-aa04-43ed-8863-e1142b5c4574'
    AND correct_index = 0;

-- Какая страна выиграла чемпионат мира по футболу 2018 года?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Франция'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd1fed9c7-7831-471a-bdbc-b3239ff138b4'
    AND correct_index = 1;

-- Кто написал «Дивный новый мир»?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Олдос Хаксли'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd2516ad5-2ba1-4856-ae6f-7da34ccc219b'
    AND correct_index = 2;

-- Что такое «хет-трик»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '3 гола одного игрока в матче'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd2e18119-f01d-4bec-bedd-b0f949536f96'
    AND correct_index = 1;

-- Как называется испанский холодный суп?
-- Export ci=0 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Гаспачо'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'd32a02bc-a699-41bd-9a66-5e6d2bf6ed5b'
    AND correct_index = 0;

-- Когда жил Шекспир?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'XVI-XVII'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd35de8a6-da3e-4f0d-ba9a-c080e8f49a8c'
    AND correct_index = 0;

-- Что такое инфляция?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Рост цен'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'd3ae1bad-c69c-4c24-a96e-d8e5dc5914b1'
    AND correct_index = 0;

-- Сколько лет строили Колизей?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '8 лет'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd3df4d58-c9c8-4c46-adbe-6b490db1d21b'
    AND correct_index = 3;

-- В каком году Япония капитулировала во Второй мировой?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '1945'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd3ece1d6-34ce-434d-bea9-270cdbd829b2'
    AND correct_index = 1;

-- Как называется опера Верди о египетской принцессе?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Аида'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd4adade8-d328-43e3-9b00-76075644a529'
    AND correct_index = 3;

-- Какой актёр сыграл Нео в “Матрице”?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Киану Ривз'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd5cbd6b4-fad3-4cb3-9725-04914d2fc21d'
    AND correct_index = 2;

-- Сколько нейронов в человеческом мозге примерно?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '86 миллиардов'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'd6879470-f3ef-4d57-8f1d-d64bf7cc733a'
    AND correct_index = 4;

-- Какая группа выпустила альбом “Abbey Road”?
-- Export ci=4 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'The Beatles'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd760ebb5-264c-41b0-ad68-06bd08a7c6b5'
    AND correct_index = 4;

-- В каком году Месси выиграл ЧМ?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '2022'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd86779a5-ed2d-47a2-894f-c86bdfccc444'
    AND correct_index = 0;

-- В каком году вышел первый Warcraft?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1994'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'd91eb514-8834-4902-b8c7-f0e2e20e997a'
    AND correct_index = 3;

-- В каком году началось монгольское нашествие на Русь?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: '1237'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'd9251ede-b79d-4f31-87fe-b171cc00bbda'
    AND correct_index = 0;

-- Как зовут ковбоя из «Истории игрушек»?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Вуди'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd92aa3f8-5102-45cf-89fa-987a2c389572'
    AND correct_index = 3;

-- Кто такой Платон?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Греческий философ ученик Сократа'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'd9ebe264-0284-4d6b-aa70-fabf8009b592'
    AND correct_index = 1;

-- Кто написал «Поэму экстаза»?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Скрябин'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'da27b1b3-e80b-4b35-9745-497dda0eda44'
    AND correct_index = 2;

-- Как называется знаменитый шутер от Valve?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Half-Life'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'dab413ba-da73-4483-9dac-dfa74bd34044'
    AND correct_index = 1;

-- В каком году Испания выиграла первый ЧМ по футболу?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '2010'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'dae7ebd7-e465-46e8-8d4a-ef3cc8ed0a20'
    AND correct_index = 3;

-- Кто написал «Менины»?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Веласкес'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'dae9eb7a-c9d2-4e11-ad14-aaf2ae2bde1a'
    AND correct_index = 4;

-- Как зовут снежную королеву из мультфильма Disney “Холодное сердце”?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Эльза'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'db79257e-9314-4a5d-a117-0a432a7187e6'
    AND correct_index = 4;

-- Какая планета известна своими кольцами?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Сатурн'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'dbf1db43-fe69-4abc-b108-aee186661add'
    AND correct_index = 4;

-- Какой город является столицей Швейцарии?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Берн'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'dcd52a4e-09f1-4e3b-8681-2ac2138b91f9'
    AND correct_index = 4;

-- В каком году родился Наполеон?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '1769'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'dd15bb71-4b8c-48e9-921f-08aa8fef2eee'
    AND correct_index = 0;

-- Кто написал картину “Девятый вал”?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Иван Айвазовский'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'dd9d857e-7c99-4847-ae37-d2661d1da80f'
    AND correct_index = 1;

-- В какой технике работал Моне?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Импрессионизм'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'de2df98a-f8f3-44f3-94a5-cd243b9f5101'
    AND correct_index = 1;

-- Как называется тип героя в «Отцах и детях»?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Нигилист'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'deabf427-50fd-41f1-88a8-7ec71f8f09bc'
    AND correct_index = 2;

-- Как зовут главного героя «451 градуса»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Монтэг'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'df3a5a62-aa22-4ca3-a01f-2c1900d5bed1'
    AND correct_index = 0;

-- Какой персонаж Disney теряет хрустальную туфельку?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Золушка'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'dfd3f61c-c19e-4653-aa5b-09274650d9c1'
    AND correct_index = 0;

-- Кто был первым человеком на Луне?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Нил Армстронг'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'dff7083a-8268-4b81-8560-79ffa77d0f48'
    AND correct_index = 0;

-- Кто написал «Болеро»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Равель'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'e03d41c6-e7a0-42cb-b140-6694602ba3cd'
    AND correct_index = 1;

-- Что такое «мизансцена»?
-- Export ci=1 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Расположение актёров и предметов в кадре'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'e0d437ef-922a-48cf-822c-455a15e0494d'
    AND correct_index = 1;

-- Какой художник отрезал себе часть уха?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Винсент ван Гог'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e18034d1-b841-47a6-ad5e-93e293d9ec7f'
    AND correct_index = 1;

-- В каком фильме оживают динозавры?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Парк юрского периода'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e1bfc3a3-306c-4bd1-baec-edd1031fb030'
    AND correct_index = 1;

-- Сколько игроков в бейсбольной команде?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '9'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e211996f-e073-4fe2-baaf-24fdf73c9838'
    AND correct_index = 1;

-- Какая наука изучает землетрясения?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Сейсмология'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'e22b476d-4ee1-49d7-a496-bc6f63e2dd33'
    AND correct_index = 2;

-- Сколько стран граничат с Россией?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '14'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'e298fa0f-b3b6-42e6-bace-4459e2e1bbd1'
    AND correct_index = 2;

-- Какая страна самая большая по площади?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Россия'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'e2f2e38a-a5eb-40fd-a336-cfc7eac45ec0'
    AND correct_index = 2;

-- Сколько раундов в боксёрском бою за титул чемпиона?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '12'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e398974b-daba-4653-bcaa-4235366ca9a2'
    AND correct_index = 0;

-- Какой персонаж Disney дружит с драконом Мушу?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Мулан'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e3b1a405-4a9e-47e3-893d-e717559f8b9d'
    AND correct_index = 1;

-- Как зовут принцессу из мультфильма Disney “Красавица и Чудовище”?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Белль'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'e3d70af5-eaea-4f04-90e8-7dc567488844'
    AND correct_index = 3;

-- Какая страна расположена на Пиренейском полуострове вместе с Испанией?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Португалия'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'e41c2232-ba3a-40af-b879-b3680b84087e'
    AND correct_index = 1;

-- Какой музей находится в Париже и знаменит “Моной Лизой”?
-- Export ci=0 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Лувр'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'e47cfddb-330f-4b81-9cf2-245f1f9bdd02'
    AND correct_index = 0;

-- Какой художник создал “Гернику”?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Пабло Пикассо'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e510c28e-dc53-45b6-8981-c1ce125fa33c'
    AND correct_index = 0;

-- Какая древняя культура построила город Мачу-Пикчу?
-- Export ci=5 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Инки'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'e525d582-761e-40b4-8cda-b9002a0c8050'
    AND correct_index = 5;

-- Кто написал «Замок»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Кафка'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e5dfd35a-6847-406b-baf5-dd57bb38527a'
    AND correct_index = 0;

-- Сколько периодов в хоккейном матче?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '3'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e649dac3-9bde-472d-bd1d-1f9f3dce1185'
    AND correct_index = 0;

-- Из какой страны блюдо тагин?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Марокко'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'e6898586-bc4d-49e0-9767-2b87e321f9b8'
    AND correct_index = 1;

-- Какая птица не умеет летать?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Пингвин'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e72968da-059c-4781-adc2-e43f5bfd349e'
    AND correct_index = 0;

-- Какой сыр самый дорогой в мире?
-- Export ci=3 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Пулиньи-Монтраше'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'e72aeeb8-2836-4017-bda3-1c5d9840a4ca'
    AND correct_index = 3;

-- Что такое фотоэффект?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Выбивание электронов светом'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'e788fcb6-aade-4f27-bae9-e4e4a962dd66'
    AND correct_index = 0;

-- Кто такой Мартин Лютер Кинг?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Американский борец за права чернокожих'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e9246268-4458-46df-8701-7d31f2a924ff'
    AND correct_index = 0;

-- Сколько глав в романе «Евгений Онегин»?
-- Export ci=5 (was for old order), new ci=1 (correct in current json)
-- Correct answer: '8'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e9c7ccd4-5dec-4c00-9283-c28b76e3cdfa'
    AND correct_index = 5;

-- Правда или ложь: в шахматах конь ходит буквой «Г».
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Правда'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ea76e342-67dc-4670-a4ca-a56113763004'
    AND correct_index = 1;

-- Что такое «4'33"» Кейджа?
-- Export ci=3 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Произведение из тишины'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ea96cadc-4849-47e8-8f60-b281372996f3'
    AND correct_index = 3;

-- Кто написал «Шум и ярость»?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Фолкнер'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'eab3063b-6661-4fd1-8772-dca7333a5e86'
    AND correct_index = 3;

-- Кто такой Ив Сен-Лоран?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Французский дизайнер'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'eaedaaef-2d24-4ac9-a032-a9d250157fba'
    AND correct_index = 2;

-- Сколько томов в «Войне и мире»?
-- Export ci=5 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '4'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'eb111f46-ad26-42c8-bba4-adbf84260dd3'
    AND correct_index = 5;

-- Столица Саудовской Аравии?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Эр-Рияд'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'eba45779-875a-41c9-8119-0a1f8e2fde91'
    AND correct_index = 1;

-- В какой стране больше всего объектов ЮНЕСКО?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Италия'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'ec884282-8f41-4df0-b68b-0d5fab00db3b'
    AND correct_index = 0;

-- В каком году основана группа The Rolling Stones?
-- Export ci=5 (was for old order), new ci=3 (correct in current json)
-- Correct answer: '1962'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'ecd8894e-6210-4a0c-a5af-3ae9ff28b5ff'
    AND correct_index = 5;

-- Какая из этих стран находится в Южной Америке?
-- Export ci=4 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Перу'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'ed97aae9-9e0c-468a-86ff-c62e05b85d6d'
    AND correct_index = 4;

-- Какая студия создала Hollow Knight?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Team Cherry'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'edb93497-79ae-4aa3-a15f-f4b6796946c7'
    AND correct_index = 1;

-- Какая страна называется «Страной восходящего солнца»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Япония'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'ee15caa0-7047-42b0-a990-99b5f73bcfb7'
    AND correct_index = 0;

-- Кто написал «Сто лет одиночества»?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Гарсиа Маркес'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'ee81778c-0e05-4dce-a5a8-736d17d88bad'
    AND correct_index = 0;

-- Кто создал игру Braid?
-- Export ci=2 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Джонатан Блоу'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ef096b93-19aa-41a1-99cc-8dbcefc45469'
    AND correct_index = 2;

-- Кто написал «Братья Карамазовы»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Достоевский'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'ef0eea11-7062-4f97-b051-a445a123fb24'
    AND correct_index = 1;

-- Кто такой Карл Маркс?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Немецкий философ и экономист'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'efea43f4-4470-4841-8580-99c4d397a654'
    AND correct_index = 3;

-- Что такое «четвёртая стена» в играх?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Обращение к игроку напрямую'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'f0ca6e20-6856-48c9-a1ad-54477189fd0b'
    AND correct_index = 2;

-- Кто создал персонажа Шерлока Холмса?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Артур Конан Дойл'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f2afd19f-3084-4f6d-8c33-e0fd9bb0f28f'
    AND correct_index = 1;

-- Какой мультфильм Disney начинается с песни “Circle of Life”?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Король Лев'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f2b83240-cad8-415a-95fd-dc80292b0119'
    AND correct_index = 0;

-- В каком фильме Стэнли Кубрика есть сцена с монолитом?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '2001: Космическая одиссея'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f325b614-cfe0-44df-9e7d-368930cd569f'
    AND correct_index = 1;

-- Сколько гномов у Белоснежки?
-- Export ci=2 (was for old order), new ci=5 (correct in current json)
-- Correct answer: '7'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'f374b5c1-65d0-463c-81b6-8f0fffab4e8d'
    AND correct_index = 2;

-- В каком городе находится Дворец дожей?
-- Export ci=3 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Венеция'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f37f6982-0edb-484e-b67e-d4bceb362023'
    AND correct_index = 3;

-- Кто основал Константинополь?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Константин I'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'f3c18ffe-51ee-402c-8e1b-9c7af5810902'
    AND correct_index = 4;

-- Какой из этих химических элементов является благородным газом?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Неон'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f4b2861d-e1cf-44fd-b8bf-ff020286f841'
    AND correct_index = 0;

-- Кто такой Спартак?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Предводитель восстания рабов'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'f6a25be5-eff0-4c49-b73b-be619a0427a7'
    AND correct_index = 1;

-- Что такое «Пятидесятница» в христианстве?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'День сошествия Святого Духа'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'f707305b-59fa-4fed-9554-0003b5de2ce9'
    AND correct_index = 2;

-- Какой орган производит инсулин?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Поджелудочная железа'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'f78f4fbc-2eac-42f0-9029-b7359014f551'
    AND correct_index = 0;

-- Кто написал «Старик и море»?
-- Export ci=0 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Хемингуэй'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'f85782af-bb66-4461-ac52-c447f583be0b'
    AND correct_index = 0;

-- Кто такой Дюшан?
-- Export ci=4 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Французский дадаист'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'f8aefc3c-8628-477e-844f-d6976e0629c2'
    AND correct_index = 4;

-- Что такое «метароман»?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Роман о написании романа'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f93588c6-893a-483b-bdb8-bf599a0214fa'
    AND correct_index = 1;

-- Что такое TCP/IP?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Протоколы передачи данных в интернете'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'f97ab35b-87ba-498e-b394-597c98fb4c25'
    AND correct_index = 0;

-- Кто написал «Прощальную симфонию»?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Гайдн'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f9ccea0f-e005-4ac6-94a8-0f1131c6db01'
    AND correct_index = 0;

-- Что такое пирамида Маслоу?
-- Export ci=2 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Иерархия потребностей'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'fa573a6a-5091-4678-abe4-c0f54b0621d9'
    AND correct_index = 2;

-- Кто снял «Носталгию» 1983?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Андрей Тарковский'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'fa9d207b-c878-497e-afc7-ec0ee8fac02a'
    AND correct_index = 1;

-- Что такое «дроп» в моде и музыке?
-- Export ci=1 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Неожиданный выпуск продукта'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'fab199db-012f-457d-b7ac-10e6f31e21e6'
    AND correct_index = 1;

-- Какой фильм Кристофера Нолана вышел первым?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Преследование'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'fb66771f-b396-4378-81fc-5b3790d75347'
    AND correct_index = 0;

-- Кто написал оперу «Борис Годунов»?
-- Export ci=4 (was for old order), new ci=3 (correct in current json)
-- Correct answer: 'Мусоргский'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'fb946541-04e1-4d9c-9db7-8b87ffce6abf'
    AND correct_index = 4;

-- Что такое Ренессанс?
-- Export ci=0 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Эпоха возрождения античной культуры'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'fc17ca81-89d9-4330-a51a-e53a10cfd8d3'
    AND correct_index = 0;

-- Что такое факториал числа n?
-- Export ci=3 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Произведение всех чисел от 1 до n'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'fc470531-6d59-43c5-b431-90c8ab87e9cf'
    AND correct_index = 3;

-- В каком году вышел «Апокалипсис сегодня»?
-- Export ci=1 (was for old order), new ci=0 (correct in current json)
-- Correct answer: '1979'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'fd09eba1-12ec-4b5b-917b-f1e2b4acee60'
    AND correct_index = 1;

-- Что такое «ловушка ликвидности»?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Ситуация когда низкие ставки не стимулируют экономику'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'fd9d2094-2fcc-4b2d-8964-ae4f681c3051'
    AND correct_index = 2;

-- В каком городе находится Тауэр?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: 'Лондон'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'fe9b6dd0-36d3-4b06-bdfc-c5c27501c993'
    AND correct_index = 0;

-- Сколько букв в русском алфавите?
-- Export ci=0 (was for old order), new ci=2 (correct in current json)
-- Correct answer: '33'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'fea32a06-d6a6-4775-a3b3-e32b928841dd'
    AND correct_index = 0;

-- Какая игра от Valve включает персонажа Гордона Фримена?
-- Export ci=2 (was for old order), new ci=4 (correct in current json)
-- Correct answer: 'Half-Life'
UPDATE questions
  SET correct_index = 4
  WHERE id = 'fef51225-affd-4c1c-923f-2f660dde3b06'
    AND correct_index = 2;

-- Какой цвет получается при смешении синего и жёлтого?
-- Export ci=2 (was for old order), new ci=1 (correct in current json)
-- Correct answer: 'Зелёный'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'ff0fddaf-2ff6-4883-a626-f631895c2608'
    AND correct_index = 2;

-- Какой певец известен как “Король поп-музыки”?
-- Export ci=3 (was for old order), new ci=5 (correct in current json)
-- Correct answer: 'Майкл Джексон'
UPDATE questions
  SET correct_index = 5
  WHERE id = 'ff235f57-b3a0-4d77-a54c-db73bedcb570'
    AND correct_index = 3;

-- Столица Пакистана?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Исламабад'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ff769639-3b0e-447b-9f04-0c9393ebd00c'
    AND correct_index = 4;

-- Что такое когнаты?
-- Export ci=4 (was for old order), new ci=0 (correct in current json)
-- Correct answer: 'Слова разных языков с общим происхождением'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ff872c22-e90b-49c5-be89-2fcb1aed4831'
    AND correct_index = 4;

-- ── SECTION 2: P4 — both arrays independently reordered (23 rows)
-- Fix: set correct_index to position of correct_text in current answers_json

-- В каком море находится остров Сицилия?
-- Correct answer: 'Средиземном'
UPDATE questions
  SET correct_index = 4
  WHERE id = '16f7bb73-53d4-4ade-bc99-759c305e8835'
    AND correct_index = 2;

-- Кто такой Фридрих Ницше?
-- Correct answer: 'Немецкий философ'
UPDATE questions
  SET correct_index = 2
  WHERE id = '1bb1e7ff-89c4-4c09-b435-7138fc901eb4'
    AND correct_index = 3;

-- Какой язык имеет наибольшее число слов?
-- Correct answer: 'Английский'
UPDATE questions
  SET correct_index = 1
  WHERE id = '22ec2d25-5750-430e-b091-0d6d59852990'
    AND correct_index = 2;

-- Кто такой Посейдон?
-- Correct answer: 'Греческий бог моря'
UPDATE questions
  SET correct_index = 0
  WHERE id = '30139645-fd6d-40ba-ab1e-bacfba9efbd1'
    AND correct_index = 1;

-- В каком году родился Рембрандт?
-- Correct answer: '1606'
UPDATE questions
  SET correct_index = 3
  WHERE id = '34a03969-e8d9-46f3-b4c3-d513cfcaba1b'
    AND correct_index = 1;

-- В каком году произошло взятие Бастилии?
-- Correct answer: '1789'
UPDATE questions
  SET correct_index = 1
  WHERE id = '3d4517c4-2427-4d6f-83e3-20869658039c'
    AND correct_index = 2;

-- Кто такой Саладин?
-- Correct answer: 'Египетский султан'
UPDATE questions
  SET correct_index = 2
  WHERE id = '4dfeab55-c14b-49e7-b0c1-bc33f7f5f8ce'
    AND correct_index = 3;

-- Назовите аздел медицины о крови
-- Correct answer: 'Гематология'
UPDATE questions
  SET correct_index = 0
  WHERE id = '4f3b48fa-4e68-4a0d-9e75-efcb1e99f2a1'
    AND correct_index = 3;

-- Кто такой Марадона?
-- Correct answer: 'Аргентинский футболист'
UPDATE questions
  SET correct_index = 1
  WHERE id = '50a29ba3-e29b-4dde-869b-41bcea7e9916'
    AND correct_index = 2;

-- Кто выиграл больше всего Олимпийских медалей в истории?
-- Correct answer: 'Майкл Фелпс'
UPDATE questions
  SET correct_index = 1
  WHERE id = '622148a9-975e-4aca-b981-012f4b338f22'
    AND correct_index = 5;

-- Как называется самая длинная нота?
-- Correct answer: 'Двойная целая'
UPDATE questions
  SET correct_index = 0
  WHERE id = '646f0216-c20a-49e0-bc9c-3c37ff4bd3da'
    AND correct_index = 1;

-- Что такое ЕС?
-- Correct answer: 'Европейский союз'
UPDATE questions
  SET correct_index = 1
  WHERE id = '6a2c34ed-e69e-4f19-9fa3-089b5fa72436'
    AND correct_index = 0;

-- Какое блюдо считается национальным во Франции?
-- Correct answer: 'Луковый суп'
UPDATE questions
  SET correct_index = 0
  WHERE id = '6d11ea7b-f805-49ef-b383-674c2a46f847'
    AND correct_index = 1;

-- Кто такой Петер Тиль?
-- Correct answer: 'Соучредитель PayPal'
UPDATE questions
  SET correct_index = 1
  WHERE id = '9650b2c4-8072-4b09-b5cd-392f7d5a29c1'
    AND correct_index = 3;

-- Как называется термин в гольфе когда мяч в лунке за 1 удар?
-- Correct answer: 'Эйс'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'a81a1b4a-c3b5-4ab0-9cbd-e574c262715f'
    AND correct_index = 3;

-- В каком море находятся Галапагосские острова?
-- Correct answer: 'Тихом океане'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'aac4a3b0-fdd1-4dbd-b490-872f4fdb4ad5'
    AND correct_index = 3;

-- Кто написал «Девушка с жемчужной серьгой»?
-- Correct answer: 'Вермеер'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'b266af41-3b49-4d44-945c-e3a6a0ce5d96'
    AND correct_index = 1;

-- Назовите раздел математики о случайных событиях
-- Correct answer: 'Теория вероятностей'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'b4fc680c-6b5b-42b1-9cff-3b4e80847450'
    AND correct_index = 1;

-- Кто создал Minecraft?
-- Correct answer: 'Маркус Перссон'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'b9c46f73-835b-483b-af09-fa66df972a1c'
    AND correct_index = 1;

-- Какой фильм открыл эру звукового кино?
-- Correct answer: 'Певец джаза'
UPDATE questions
  SET correct_index = 3
  WHERE id = 'd47299d8-2baa-4828-8b7f-ee91fcc234b6'
    AND correct_index = 2;

-- Кто такой Тот в египетской мифологии?
-- Correct answer: 'Бог мудрости письма и луны'
UPDATE questions
  SET correct_index = 1
  WHERE id = 'e6650f9b-a1cc-4d6e-9b64-5f5e02b68ef2'
    AND correct_index = 2;

-- Что такое «катализ»?
-- Correct answer: 'Ускорение реакции катализатором'
UPDATE questions
  SET correct_index = 0
  WHERE id = 'ed09fbd4-94fb-4926-b3d1-5f35997e2d35'
    AND correct_index = 1;

-- В каком фильме фраза «Элементарно, Ватсон»?
-- Correct answer: 'Шерлок Холмс'
UPDATE questions
  SET correct_index = 2
  WHERE id = 'f8048c20-6642-40cf-a8c7-edb45a944ea0'
    AND correct_index = 0;

-- ── SECTION 3: P5 — export answers_json ordering unchanged but ci wrong (162 rows)
-- Note: These rows have current answers_json == export answers_json order
-- but correct_index already pointed to wrong element even in export.
-- Ground truth: the export's correct_index itself may be wrong for these.
-- *** THESE ARE SEPARATELY FLAGGED — DO NOT APPLY WITHOUT MANUAL VERIFICATION ***

-- NEEDS VERIFICATION: В каком году пала Берлинская стена?
-- Export ci=1, proposed=0, correct_text='1989'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '014e06b5-4f45-4363-a610-b1a1e9f962dc' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком году снят первый фильм о Бонде?
-- Export ci=1, proposed=0, correct_text='1962'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '01b0d4e5-6774-463c-b77a-794bd5f58032' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое «ларго»?
-- Export ci=0, proposed=1, correct_text='Очень медленный темп'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '036c9ea2-f5cd-4487-bd28-e1f2b8001577' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое простое число?
-- Export ci=1, proposed=0, correct_text='Делится только на 1 и себя'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '046b6d46-fa88-44b9-bafd-50772c850649' AND correct_index = 1;

-- NEEDS VERIFICATION: Как расшифровывается CPU?
-- Export ci=1, proposed=0, correct_text='Центральный процессор'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '04e9db4b-7e43-4436-a680-2f6902e67dbc' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется французская техника приготовления в вакууме?
-- Export ci=4, proposed=5, correct_text='Су-вид'
-- UPDATE questions SET correct_index = 5
--   WHERE id = '05efbeec-9211-4cf5-b5b9-0a6fdc9d50d1' AND correct_index = 4;

-- NEEDS VERIFICATION: Какой вид спорта связан с Уимблдоном?
-- Export ci=0, proposed=2, correct_text='Теннис'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '06d2af3f-f645-4f61-8912-761f3adea4cd' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое лейаут?
-- Export ci=0, proposed=1, correct_text='Пересадка в аэропорту'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '08ccfbec-bab7-47e6-affb-1b34e3e71d09' AND correct_index = 0;

-- NEEDS VERIFICATION: Какой горный хребет отделяет Испанию от Франции?
-- Export ci=1, proposed=2, correct_text='Пиренеи'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '0928370c-5949-4867-8aee-fdd141eee9dd' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто такой Перикл?
-- Export ci=1, proposed=2, correct_text='Афинский политик'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '093786de-7642-410a-8d60-185fbbdc1430' AND correct_index = 1;

-- NEEDS VERIFICATION: Какая компания создала Mario?
-- Export ci=0, proposed=1, correct_text='Nintendo'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '135e643d-30f4-4873-a2b5-88f0c98bca76' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто снял «Птицы»?
-- Export ci=1, proposed=2, correct_text='Альфред Хичкок'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '14b69d6c-5ddc-4b80-b4d0-7768408aca2c' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком спорте есть «пенальти»?
-- Export ci=0, proposed=1, correct_text='Футбол'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '160a6c7a-6e64-4626-8fe9-55bf17e7ef81' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Огюст Роден?
-- Export ci=1, proposed=0, correct_text='Французский скульптор'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '176765ff-28b5-4175-96d5-dbaa957d2679' AND correct_index = 1;

-- NEEDS VERIFICATION: В какой стране находится пустыня Намиб?
-- Export ci=1, proposed=4, correct_text='Намибия'
-- UPDATE questions SET correct_index = 4
--   WHERE id = '182d5161-e89e-4d3d-97bb-432bbe074aa3' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Евгений Онегин»?
-- Export ci=1, proposed=0, correct_text='Пушкин'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '1acc5486-8e05-483c-b0d1-d21b6539c2cc' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто предложил теорию эволюции?
-- Export ci=1, proposed=0, correct_text='Дарвин'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '1ce98e16-2284-4bed-a1e0-7dbf0e932590' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Алые паруса»?
-- Export ci=0, proposed=1, correct_text='Грин'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '1f1042da-424a-4aa9-9df6-18f115a731c0' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто играл Нео в «Матрице»?
-- Export ci=0, proposed=1, correct_text='Киану Ривз'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '206aa7fd-b8b6-48f5-97dc-5c03daa57974' AND correct_index = 0;

-- NEEDS VERIFICATION: Правда или ложь: «Маленького принца» написал Антуан де Сент-Экзюпери.
-- Export ci=1, proposed=0, correct_text='Правда'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '2415cd0f-884c-4f36-8d48-36256050e220' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто такой Юлий Цезарь?
-- Export ci=3, proposed=0, correct_text='Римский политик и полководец'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '245b69a0-264a-4002-8200-1bcc3f7332a5' AND correct_index = 3;

-- NEEDS VERIFICATION: Кто написал «Баллады» для фортепиано?
-- Export ci=3, proposed=2, correct_text='Шопен'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '254cb6e6-6e11-478c-9020-3809f395d9e1' AND correct_index = 3;

-- NEEDS VERIFICATION: Какое животное может регенерировать конечности?
-- Export ci=1, proposed=2, correct_text='Аксолотль'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '26ad0b85-f013-427b-afea-39cafb25be14' AND correct_index = 1;

-- NEEDS VERIFICATION: Столица Португалии?
-- Export ci=0, proposed=1, correct_text='Лиссабон'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '27f086aa-4d3b-49c1-accc-cda8f0a3159c' AND correct_index = 0;

-- NEEDS VERIFICATION: Правда или ложь: пингвины умеют летать.
-- Export ci=0, proposed=1, correct_text='Ложь'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '29c14309-254a-4522-a0d6-1681b1a03ed2' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто написал «Доктор Живаго»?
-- Export ci=1, proposed=0, correct_text='Пастернак'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '2a6ba0fe-213b-4f56-b2e9-79420047542d' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком городе находится Sagrada Familia?
-- Export ci=2, proposed=3, correct_text='Барселона'
-- UPDATE questions SET correct_index = 3
--   WHERE id = '2a8bd0fa-1a94-48fd-a534-097c266da4f0' AND correct_index = 2;

-- NEEDS VERIFICATION: Как зовут злодея в «Аладдине»?
-- Export ci=0, proposed=5, correct_text='Джафар'
-- UPDATE questions SET correct_index = 5
--   WHERE id = '32176739-c106-4eb4-bf79-e86d4ee1e99f' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто создал серию Metal Gear?
-- Export ci=0, proposed=4, correct_text='Хидео Кодзима'
-- UPDATE questions SET correct_index = 4
--   WHERE id = '323aa9e7-0eaf-4e18-a098-4eb4cbe6fd68' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Авраам Линкольн?
-- Export ci=0, proposed=1, correct_text='16-й президент США'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '344ef3e4-23a0-4db8-8a8d-ca668a4ea559' AND correct_index = 0;

-- NEEDS VERIFICATION: Сколько Оскаров получил «Властелин колец: Возвращение короля»?
-- Export ci=0, proposed=1, correct_text='11'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '37342d2a-5eed-4fcb-80de-1d7acf50df73' AND correct_index = 0;

-- NEEDS VERIFICATION: Правда или ложь: Солнце — звезда.
-- Export ci=1, proposed=0, correct_text='Правда'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '382681fa-1574-4b67-9389-920f7a36ae59' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое кварк?
-- Export ci=1, proposed=4, correct_text='Элементарная частица'
-- UPDATE questions SET correct_index = 4
--   WHERE id = '41381167-4b7c-4e57-ab1f-715497ba6837' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое лингвистика?
-- Export ci=0, proposed=1, correct_text='Наука о языке'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '41a64c5b-74e8-4228-816a-2b36a5bd2a90' AND correct_index = 0;

-- NEEDS VERIFICATION: Чья песня Smells Like Teen Spirit?
-- Export ci=2, proposed=1, correct_text='Nirvana'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '422e419d-3aaa-407a-a5e9-f878d1ee9a36' AND correct_index = 2;

-- NEEDS VERIFICATION: Что такое «Гильгамеш»?
-- Export ci=4, proposed=0, correct_text='Шумерский эпос о поиске бессмертия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '4461d009-dacd-41d5-99ca-8476e292670f' AND correct_index = 4;

-- NEEDS VERIFICATION: Сколько будет 2 в степени 10?
-- Export ci=0, proposed=1, correct_text='1024'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '45b50a20-b8af-480a-a55b-ce29555a9d92' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто написал «Лолита»?
-- Export ci=0, proposed=1, correct_text='Набоков'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '4652b3d1-67a0-4173-b83f-e0c99546b707' AND correct_index = 0;

-- NEEDS VERIFICATION: Из чего делают гуакамоле?
-- Export ci=1, proposed=0, correct_text='Авокадо'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '47620bfe-aded-4654-94b0-62e76bedef7a' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой город был столицей Турции до Анкары?
-- Export ci=3, proposed=5, correct_text='Стамбул'
-- UPDATE questions SET correct_index = 5
--   WHERE id = '489083c7-b255-4cb8-a684-072b147c2930' AND correct_index = 3;

-- NEEDS VERIFICATION: Правда или ложь: Моцарт родился в Австрии.
-- Export ci=0, proposed=1, correct_text='Правда'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '4db10abf-a671-4dc7-841f-251ae59ae277' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое квант?
-- Export ci=1, proposed=0, correct_text='Минимальная порция энергии'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '5031a2b4-1e40-4efc-9b15-20ffca778622' AND correct_index = 1;

-- NEEDS VERIFICATION: Какая страна является родиной самураев?
-- Export ci=1, proposed=0, correct_text='Япония'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '50534f27-ab1f-41cd-9e4f-180c8f13a994' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Щелкунчик»?
-- Export ci=0, proposed=1, correct_text='Чайковский'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '5211d881-ab8d-4841-bab9-ccbf314400a2' AND correct_index = 0;

-- NEEDS VERIFICATION: Как называется первая книга «Гарри Поттера»?
-- Export ci=1, proposed=4, correct_text='Философский камень'
-- UPDATE questions SET correct_index = 4
--   WHERE id = '5212ed86-a05b-46fc-87f0-e3b1919627be' AND correct_index = 1;

-- NEEDS VERIFICATION: Из какой страны группа U2?
-- Export ci=1, proposed=0, correct_text='Ирландия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '52d1b65f-72d0-4788-a5ff-3ca0d1f7cc71' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто такой Джексон Поллок?
-- Export ci=1, proposed=2, correct_text='Американский абстракционист'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '5455d61b-e11e-442d-84b4-2e9792adc518' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Шехеразаду»?
-- Export ci=5, proposed=2, correct_text='Римский-Корсаков'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '547be2f6-2bd3-404a-9cd1-f1f57c1df95f' AND correct_index = 5;

-- NEEDS VERIFICATION: Кто написал оперу «Мадам Баттерфляй»?
-- Export ci=1, proposed=0, correct_text='Пуччини'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '54e5a3f9-04eb-4dd6-bb6f-446296789167' AND correct_index = 1;

-- NEEDS VERIFICATION: Из какой страны The Beatles?
-- Export ci=1, proposed=0, correct_text='Великобритания'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '55cea65d-abf3-47c9-858e-449731d071e9' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком году началась Холодная война?
-- Export ci=1, proposed=0, correct_text='1947'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '5a1cdf8c-f66d-46cd-9be3-34c136a90e36' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Моби Дик»?
-- Export ci=0, proposed=1, correct_text='Герман Мелвилл'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '5ad2cc11-a697-4876-9335-71ded3dae55e' AND correct_index = 0;

-- NEEDS VERIFICATION: Певица Адель получила Оскар за песню к фильму...?
-- Export ci=0, proposed=1, correct_text='Скайфолл'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '5af0ee55-1a9f-4206-a390-5071a9df0fbc' AND correct_index = 0;

-- NEEDS VERIFICATION: В каком году Германия выиграла ЧМ по футболу?
-- Export ci=1, proposed=0, correct_text='2014'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '5cff36c2-e42f-4114-bfe7-2e06be9155f8' AND correct_index = 1;

-- NEEDS VERIFICATION: Из какой страны бренд Gucci?
-- Export ci=1, proposed=0, correct_text='Италия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '5dfa2516-c2f7-4104-b66f-7163cba8d57c' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое танго?
-- Export ci=2, proposed=0, correct_text='Аргентинский парный танец и жанр музыки'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '5e4a9ffa-a548-4f32-9fe9-87011a732a03' AND correct_index = 2;

-- NEEDS VERIFICATION: В каком городе снимали «Третий человек»?
-- Export ci=1, proposed=0, correct_text='Вена'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '609329af-2626-4441-8044-2e0d4a33c495' AND correct_index = 1;

-- NEEDS VERIFICATION: Из чего делают тофу?
-- Export ci=0, proposed=1, correct_text='Соевое молоко'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '6100cf1c-5a5f-4578-b871-e4703113ee63' AND correct_index = 0;

-- NEEDS VERIFICATION: Какая страна первой дала женщинам право голоса?
-- Export ci=0, proposed=1, correct_text='Новая Зеландия'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '62a3b995-1bdc-48fe-ae86-ba2857b1a02c' AND correct_index = 0;

-- NEEDS VERIFICATION: Правда или ложь: «Властелина колец» написал Дж. Р. Р. Толкин.
-- Export ci=1, proposed=0, correct_text='Правда'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '653bd4a9-b0ab-422d-842a-8ad23c3624c2' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое акция?
-- Export ci=1, proposed=0, correct_text='Доля в компании'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '67d47cca-d0f0-4dc0-ad7c-a3a5ca00a721' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое тренч?
-- Export ci=1, proposed=0, correct_text='Длинное пальто-плащ'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '6b66b69a-cd6d-4ffa-a5db-eaaa0349b665' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое кислота?
-- Export ci=0, proposed=1, correct_text='Вещество отдающее протоны'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '6bd63d09-b7bd-4ccc-8979-14a52a4a3d45' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто играл Индиану Джонса?
-- Export ci=0, proposed=1, correct_text='Харрисон Форд'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '6c7b9c45-4c19-4555-8469-0cd4a4ec1123' AND correct_index = 0;

-- NEEDS VERIFICATION: В каком городе находится Акрополь?
-- Export ci=1, proposed=2, correct_text='Афины'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '6ca72a6d-68f8-4d79-82ba-b851fe1af3dc' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой инструмент у Моцарта был основным?
-- Export ci=1, proposed=0, correct_text='Фортепиано'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '6d8535b7-5dd0-4c81-b6c0-9c78e1d0829f' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто режиссёр «Криминального чтива»?
-- Export ci=2, proposed=0, correct_text='Квентин Тарантино'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '6dfab6ab-c2f7-46e7-a046-547ccc14b45a' AND correct_index = 2;

-- NEEDS VERIFICATION: Правда или ложь: у человека 206 костей во взрослом возрасте.
-- Export ci=1, proposed=0, correct_text='Правда'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '70d41599-85fd-4b7e-a427-6e32f2c58800' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой композитор написал оперу «Волшебная флейта»?
-- Export ci=1, proposed=0, correct_text='Моцарт'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '73b115f4-d8a4-4df1-a547-a6daa0052dfd' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое «аминокислота»?
-- Export ci=1, proposed=2, correct_text='Строительный блок белков'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '74c33097-3c52-4b37-9287-c98ea2e7fd66' AND correct_index = 1;

-- NEEDS VERIFICATION: Правда или ложь: Статуя Свободы была подарком Франции США.
-- Export ci=1, proposed=0, correct_text='Правда'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '76ec8f19-4c64-41c1-a58f-8176523f9ea9' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком году основан Рим?
-- Export ci=0, proposed=2, correct_text='753 до н.э.'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '771aba82-7b85-4958-86dc-d26fd3fa6636' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто сыграл главную роль в «Ла-Ла Ленд»?
-- Export ci=1, proposed=3, correct_text='Эмма Стоун'
-- UPDATE questions SET correct_index = 3
--   WHERE id = '7890b37f-a41c-46ce-8824-fec49611f683' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком стиле построен Храм Василия Блаженного?
-- Export ci=0, proposed=1, correct_text='Русское узорочье'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '7a872519-e1cc-42f8-8985-60430122f78c' AND correct_index = 0;

-- NEEDS VERIFICATION: Как называется главный злодей в Portal?
-- Export ci=1, proposed=0, correct_text='GLaDOS'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '8155c724-50b4-42c5-993b-1c3528117c8b' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто такой Аполлон?
-- Export ci=0, proposed=1, correct_text='Греческий бог солнца и искусств'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '819f9e52-2213-4f51-bdc1-dab4c1d2a1a2' AND correct_index = 0;

-- NEEDS VERIFICATION: Какая планета называется Красной планетой?
-- Export ci=1, proposed=2, correct_text='Марс'
-- UPDATE questions SET correct_index = 2
--   WHERE id = '846a9450-2796-454f-880b-1357512ca7de' AND correct_index = 1;

-- NEEDS VERIFICATION: В какой стране родился Шекспир?
-- Export ci=1, proposed=0, correct_text='Англия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '87b1b7bc-b280-46f0-b985-462d20367394' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком году Россия вступила в Первую мировую войну?
-- Export ci=1, proposed=0, correct_text='1914'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '8f0835e7-79f0-4ef0-84f8-1cace86671c7' AND correct_index = 1;

-- NEEDS VERIFICATION: Из какой страны блюдо гуляш?
-- Export ci=1, proposed=0, correct_text='Венгрия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '8f3602fb-4120-427c-95a6-efdf64ec841a' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «В поисках утраченного времени»?
-- Export ci=2, proposed=1, correct_text='Пруст'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '9034ccd9-d2ea-47ac-8640-2e8e7bebec71' AND correct_index = 2;

-- NEEDS VERIFICATION: Кто построил пирамиды в Гизе?
-- Export ci=1, proposed=0, correct_text='Древние египтяне'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '929d7a8c-ae0b-4734-a4d1-f26a3b284280' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется самый лёгкий элемент?
-- Export ci=0, proposed=1, correct_text='Водород'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '92de23cb-57e3-42a0-8d8d-1c21543b781c' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое ЭИ (EQ)?
-- Export ci=1, proposed=0, correct_text='Эмоциональный интеллект'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '94a3bcb9-ce15-44fd-8b06-12bab3684fba' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется главная тема в джазе?
-- Export ci=1, proposed=0, correct_text='Стандарт'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '96d99166-fa5e-45bf-adcc-5a3e0a8340b4' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое органическая химия?
-- Export ci=3, proposed=0, correct_text='Химия соединений углерода'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '96e6d2d5-3637-494f-99f7-479056630118' AND correct_index = 3;

-- NEEDS VERIFICATION: Какой вид спорта связан с Кубком Стэнли?
-- Export ci=0, proposed=3, correct_text='Хоккей'
-- UPDATE questions SET correct_index = 3
--   WHERE id = '979e1206-c53a-4a8b-8114-ab94b94a64dd' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое Аргонавты?
-- Export ci=2, proposed=1, correct_text='Герои плывшие за золотым руном'
-- UPDATE questions SET correct_index = 1
--   WHERE id = '98033b5b-fdbc-4de7-ab90-2d904f397838' AND correct_index = 2;

-- NEEDS VERIFICATION: Какой вид спорта использует шайбу?
-- Export ci=1, proposed=3, correct_text='Хоккей'
-- UPDATE questions SET correct_index = 3
--   WHERE id = '998e8bd3-a3b7-4615-aabb-10d8afa3fa70' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое облигация?
-- Export ci=1, proposed=0, correct_text='Долговое обязательство'
-- UPDATE questions SET correct_index = 0
--   WHERE id = '9c3d91c9-014f-4667-bc51-c1b329ae1ef6' AND correct_index = 1;

-- NEEDS VERIFICATION: Какое животное самое большое на Земле?
-- Export ci=0, proposed=1, correct_text='Синий кит'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'a0ab23e9-5e9d-4041-a955-1c3c3db7fb86' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Александр Невский?
-- Export ci=1, proposed=0, correct_text='Русский князь'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'a0b8b023-a9ad-4dbc-8e1a-655495209836' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Собачье сердце»?
-- Export ci=0, proposed=1, correct_text='Булгаков'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'a5227870-4ad7-437f-adba-05751fe39ca0' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое скульптура?
-- Export ci=0, proposed=1, correct_text='Трёхмерное произведение искусства'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'a52a60d9-3738-494c-8a66-bed1f19a6322' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Юстиниан?
-- Export ci=1, proposed=0, correct_text='Византийский emperor'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'a53cb372-9118-47b4-8fbc-0064e93515e5' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто создал серию Resident Evil?
-- Export ci=0, proposed=1, correct_text='Capcom'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'a6e42224-b100-48b4-827c-9a63a6da673c' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое экосистема тундры?
-- Export ci=0, proposed=3, correct_text='Безлесная зона с вечной мерзлотой'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'aaf7d44b-78de-4db1-8877-9adc3e94a8ae' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто снял «Меланхолию»?
-- Export ci=1, proposed=0, correct_text='Ларс фон Триер'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'ab313ddb-287a-4455-a191-bab9e8dd1709' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Аве Мария»?
-- Export ci=1, proposed=0, correct_text='Шуберт'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'acb3839b-503e-4bdd-9625-b4959278b940' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто написал «Три товарища»?
-- Export ci=0, proposed=1, correct_text='Ремарк'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ad71c2b1-021a-465f-9788-66165315a832' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто написал «Преступление и наказание»?
-- Export ci=0, proposed=2, correct_text='Фёдор Достоевский'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'aed47ab0-a780-4bca-9bff-4d50a9539b11' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто написал музыку к «Звёздным войнам»?
-- Export ci=3, proposed=0, correct_text='Джон Уильямс'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'b0acd50d-946e-4c62-898e-3b3b25648bb2' AND correct_index = 3;

-- NEEDS VERIFICATION: Что изучает фонетика?
-- Export ci=2, proposed=0, correct_text='Звуки языка'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'b2293a22-5fb9-470a-be7c-e8b2847d61ef' AND correct_index = 2;

-- NEEDS VERIFICATION: Какой сыр используют в пицце Маргарита?
-- Export ci=0, proposed=1, correct_text='Моцарелла'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'b26264f5-bc25-49b8-9f3a-c015a653adfc' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое тапиока?
-- Export ci=1, proposed=0, correct_text='Крахмал из маниоки'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'b2c42f62-54cb-49b4-9b33-491281102d15' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой режиссёр снял фильм «Интерстеллар»?
-- Export ci=1, proposed=0, correct_text='Кристофер Нолан'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'b54b5e45-2e9e-4bd6-8f66-58c7181044e7' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется высший ранг в сумо?
-- Export ci=1, proposed=2, correct_text='Йокодзуна'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'b5505728-1f4a-4ae5-b825-8443431dc8f7' AND correct_index = 1;

-- NEEDS VERIFICATION: Какая группа исполнила песню “Bohemian Rhapsody”?
-- Export ci=0, proposed=1, correct_text='Queen'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'b761eec3-63ae-4eab-8f38-7f5ccfd35c5f' AND correct_index = 0;

-- NEEDS VERIFICATION: Какая игра вышла раньше остальных?
-- Export ci=2, proposed=1, correct_text='Tetris'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'b8c9f6f8-30ca-44c8-bd6b-d76a4d07d048' AND correct_index = 2;

-- NEEDS VERIFICATION: Сколько очков за победу в регби?
-- Export ci=0, proposed=1, correct_text='5'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'b941ce74-dce4-41d5-9ee1-2423da625dd3' AND correct_index = 0;

-- NEEDS VERIFICATION: Какая кость защищает мозг?
-- Export ci=1, proposed=3, correct_text='Череп'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'b954629d-d0f4-4292-8eaa-753e16ba3162' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется процесс превращения воды в пар?
-- Export ci=2, proposed=0, correct_text='Испарение'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'b9b0e6cc-bd71-4b63-a335-9cda29b8fc02' AND correct_index = 2;

-- NEEDS VERIFICATION: Из какой страны блюдо паэлья?
-- Export ci=2, proposed=0, correct_text='Испания'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'bbc4357b-d40e-454d-83bc-d99bf931c5e9' AND correct_index = 2;

-- NEEDS VERIFICATION: Кто сыграл Железного человека в киновселенной Marvel?
-- Export ci=0, proposed=1, correct_text='Роберт Дауни мл.'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'bc7746bd-6d8b-4a81-9016-db3d5e1c36df' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое инквизиция?
-- Export ci=1, proposed=0, correct_text='Церковный суд против ересей'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'bf5994d6-a693-4ebc-b890-e8163b30fb83' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой элемент обозначается символом Fe?
-- Export ci=2, proposed=1, correct_text='Железо'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'c2c4f429-58e0-44f3-97cf-aae234a7a7e5' AND correct_index = 2;

-- NEEDS VERIFICATION: Какой жанр у Civilization?
-- Export ci=0, proposed=2, correct_text='4X стратегия'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'c46f19de-7140-420c-9a07-d40875c57d7d' AND correct_index = 0;

-- NEEDS VERIFICATION: Сколько языков существует в мире примерно?
-- Export ci=0, proposed=1, correct_text='~7000'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'c58db7ae-3fb4-4888-9eba-ae1031d34cf7' AND correct_index = 0;

-- NEEDS VERIFICATION: Какой певец был лидером группы Queen?
-- Export ci=1, proposed=0, correct_text='Фредди Меркьюри'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'c79571b1-7039-4fa1-96c1-02db765b6e4c' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто был тренером сборной Франции на ЧМ-2018?
-- Export ci=0, proposed=3, correct_text='Дидье Дешам'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'c7995fef-3064-4c6a-9deb-adb84764a04a' AND correct_index = 0;

-- NEEDS VERIFICATION: Какой алфавит самый распространённый в мире?
-- Export ci=1, proposed=0, correct_text='Латинский'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'cb4d0552-9bd7-4e79-a330-5dbbf3696123' AND correct_index = 1;

-- NEEDS VERIFICATION: Где находится Ниагарский водопад?
-- Export ci=0, proposed=1, correct_text='США и Канада'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'cd5a8429-8948-4fbd-9f3d-3507d1de3288' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое стоицизм?
-- Export ci=5, proposed=0, correct_text='Философия принятия того что вне контроля'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'cde1a3f8-891a-4600-a5d5-c7647137c4cb' AND correct_index = 5;

-- NEEDS VERIFICATION: Что такое хирургия?
-- Export ci=0, proposed=1, correct_text='Лечение методом операций'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd2460a53-ca66-4354-8ee8-127c449fa8e4' AND correct_index = 0;

-- NEEDS VERIFICATION: Как зовут сестёр в пьесе Чехова «Три сестры»?
-- Export ci=0, proposed=1, correct_text='Ольга Маша Ирина'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd2bb672e-eec6-4e54-94de-611c16ac32c9' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое вектор?
-- Export ci=3, proposed=1, correct_text='Величина с направлением и модулем'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd355abbc-5793-4d29-8abe-bc4fbbaf1ac1' AND correct_index = 3;

-- NEEDS VERIFICATION: Кто выиграл больше всего Гран-при Формулы 1?
-- Export ci=0, proposed=1, correct_text='Льюис Хэмилтон'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd5d46f1e-d55d-4640-bef7-3ee2035b43a9' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Пол Пот?
-- Export ci=3, proposed=0, correct_text='Лидер Красных кхмеров Камбоджи'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'd6484666-6901-4fa9-8677-12db25064ac1' AND correct_index = 3;

-- NEEDS VERIFICATION: В каком виде спорта используется термин “эйс”?
-- Export ci=2, proposed=0, correct_text='Теннис'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'd64bb71d-17ec-402e-b04e-f20eef5e6fcc' AND correct_index = 2;

-- NEEDS VERIFICATION: Что такое стриминг?
-- Export ci=0, proposed=1, correct_text='Онлайн-трансляция или просмотр контента'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd68a1909-c01e-4960-9c79-61fa4e8b7e0f' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто основал Facebook?
-- Export ci=0, proposed=3, correct_text='Марк Цукерберг'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'd76ba13a-5ada-480c-979c-6d2d36f033fa' AND correct_index = 0;

-- NEEDS VERIFICATION: Сколько струн у стандартной гитары?
-- Export ci=1, proposed=2, correct_text='6'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'd85d553e-deee-4952-9ee9-8a4daad4a3a6' AND correct_index = 1;

-- NEEDS VERIFICATION: Кто снял «Зелёную книгу»?
-- Export ci=1, proposed=3, correct_text='Питер Фаррелли'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'd8b695c1-3ba0-42fc-a10e-d5892c54a2d4' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком городе прошли первые современные Олимпийские игры?
-- Export ci=0, proposed=1, correct_text='Афины'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd8d12b9d-ff3f-480f-94af-5dd77c12eb10' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто основал супрематизм?
-- Export ci=3, proposed=1, correct_text='Малевич'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd8f12536-ce22-4a1f-a479-2c27c40ccbf6' AND correct_index = 3;

-- NEEDS VERIFICATION: Какая религия самая распространённая?
-- Export ci=0, proposed=1, correct_text='Христианство'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd9d80282-99cc-4a5e-a70a-5b9e1a8dbbce' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто главный герой серии God of War?
-- Export ci=0, proposed=1, correct_text='Кратос'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd9f80e05-fbef-42d3-a013-edbf834ad41c' AND correct_index = 0;

-- NEEDS VERIFICATION: Сколько геймов минимум в тай-брейке тенниса?
-- Export ci=0, proposed=1, correct_text='7'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'd9ffe158-eeee-41d4-b101-38a1c614e251' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто написал «Краткую историю времени»?
-- Export ci=2, proposed=3, correct_text='Стивен Хокинг'
-- UPDATE questions SET correct_index = 3
--   WHERE id = 'dc9ed93f-c6a1-4468-80ad-3bf51f8b70ec' AND correct_index = 2;

-- NEEDS VERIFICATION: Кто основал психоанализ?
-- Export ci=0, proposed=1, correct_text='Зигмунд Фрейд'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ddb7df80-ba7c-41ad-b9ff-293427c24a27' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто такой Айртон Сенна?
-- Export ci=0, proposed=1, correct_text='Бразильский гонщик Ф1'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ddd81933-6b85-4736-95ee-e14adf46c3ea' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое инвестиция?
-- Export ci=0, proposed=1, correct_text='Вложение капитала с целью дохода'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'e61943c3-7435-44ed-b55b-fc853e58bc53' AND correct_index = 0;

-- NEEDS VERIFICATION: Как называется последняя симфония Бетховена?
-- Export ci=0, proposed=2, correct_text='Девятая'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'e67bb11e-4406-45be-8b9b-a15f271a64ae' AND correct_index = 0;

-- NEEDS VERIFICATION: В каком стиле работал Сальвадор Дали?
-- Export ci=0, proposed=1, correct_text='Сюрреализм'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'e6d966d9-0e94-46a3-9a86-3fa07c26b767' AND correct_index = 0;

-- NEEDS VERIFICATION: Сколько лет длилась Столетняя война?
-- Export ci=0, proposed=1, correct_text='116 лет'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'e79633fb-b87d-4def-90e4-a1d33125e4a5' AND correct_index = 0;

-- NEEDS VERIFICATION: В каком году Колумб открыл Америку?
-- Export ci=0, proposed=1, correct_text='1492'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'e7c1e026-96f2-4e21-be79-4fadc7a02562' AND correct_index = 0;

-- NEEDS VERIFICATION: Как называется самая известная опера Пуччини?
-- Export ci=1, proposed=0, correct_text='Тоска'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'e932459f-60ed-486e-b3d6-3caa2b1b7b62' AND correct_index = 1;

-- NEEDS VERIFICATION: В каком году написан «Гамлет»?
-- Export ci=2, proposed=1, correct_text='~1600'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ebef835f-3e1d-4915-a981-3a19f6fbd6af' AND correct_index = 2;

-- NEEDS VERIFICATION: Что такое монархия?
-- Export ci=0, proposed=1, correct_text='Власть одного наследственного правителя'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ec747d71-117c-45e8-9f95-73ea65b9506c' AND correct_index = 0;

-- NEEDS VERIFICATION: Что такое MMORPG?
-- Export ci=1, proposed=0, correct_text='Массовая онлайн ролевая игра'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'ede968d6-675b-49ce-b5fd-2e3e69aa4191' AND correct_index = 1;

-- NEEDS VERIFICATION: Где находится озеро Титикака?
-- Export ci=1, proposed=0, correct_text='Перу и Боливия'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'eec1d8bd-f357-4fbf-b5d9-21c769e08b8b' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое интеграл?
-- Export ci=0, proposed=1, correct_text='Площадь под кривой'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'eedbf707-4ca7-4ec5-8c8d-f0bf8b906bb2' AND correct_index = 0;

-- NEEDS VERIFICATION: В каком фильме Мэттью МакКонахи путешествует сквозь чёрную дыру?
-- Export ci=0, proposed=1, correct_text='Интерстеллар'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ef45bf4a-ead0-4aba-936d-a6642c9a5f1e' AND correct_index = 0;

-- NEEDS VERIFICATION: В какой стране находится Пирамида Солнца?
-- Export ci=1, proposed=0, correct_text='Мексика'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'f2c9d156-8e78-4093-9e92-1dd735a55bcb' AND correct_index = 1;

-- NEEDS VERIFICATION: Какой газ выделяют растения при фотосинтезе?
-- Export ci=1, proposed=0, correct_text='Кислород'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'f31063ad-b0da-4e58-afe8-556cf37fca03' AND correct_index = 1;

-- NEEDS VERIFICATION: Что такое JRPG?
-- Export ci=0, proposed=2, correct_text='Японская ролевая игра'
-- UPDATE questions SET correct_index = 2
--   WHERE id = 'f55aac3a-8015-4fcb-b61d-fecc9c0bc3ed' AND correct_index = 0;

-- NEEDS VERIFICATION: Кто играл Супермена в фильме 1978 года?
-- Export ci=1, proposed=0, correct_text='Кристофер Рив'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'f7445645-efdd-406f-bb2f-31f4603d7688' AND correct_index = 1;

-- NEEDS VERIFICATION: Правда или ложь: Нил протекает через Египет.
-- Export ci=0, proposed=1, correct_text='Правда'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'fa025154-5df6-4196-a045-95610f893deb' AND correct_index = 0;

-- NEEDS VERIFICATION: Как называется самая маленькая единица живого?
-- Export ci=1, proposed=0, correct_text='Клетка'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'fa32646d-22ad-43f0-a583-5768094d93c9' AND correct_index = 1;

-- NEEDS VERIFICATION: Актриса Мэрил Стрип получила сколько Оскаров?
-- Export ci=2, proposed=0, correct_text='3'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'fc24f908-083c-40c1-8894-595eb6acb331' AND correct_index = 2;

-- NEEDS VERIFICATION: Что такое медитация?
-- Export ci=1, proposed=0, correct_text='Практика осознанности и концентрации'
-- UPDATE questions SET correct_index = 0
--   WHERE id = 'fce38745-8596-4fc1-b4fc-6469973e9434' AND correct_index = 1;

-- NEEDS VERIFICATION: Как называется самый продаваемый альбом в истории?
-- Export ci=0, proposed=1, correct_text='Thriller — Michael Jackson'
-- UPDATE questions SET correct_index = 1
--   WHERE id = 'ff778969-feff-42c3-834e-f85817b381e8' AND correct_index = 0;

-- ── TRANSACTION ASSERTION: verify key repairs landed before committing
DO $$
DECLARE
  v_brazil  integer;
  v_titanic integer;
  v_mone    integer;
  v_dushan  integer;
BEGIN
  -- Brazil (5135c0dd): correct answer '5', must be at index 0
  SELECT correct_index INTO v_brazil
    FROM questions WHERE id = '5135c0dd-e88d-4cf3-8c46-457d1a273540';
  IF v_brazil IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'M88 ASSERTION FAILED: Brazil correct_index = %, expected 0', v_brazil;
  END IF;

  -- Titanic (bb8dc652): correct answer 'Титаник', must be at index 4
  SELECT correct_index INTO v_titanic
    FROM questions WHERE id = 'bb8dc652-1e42-47ff-a60c-6d5d03c61af9';
  IF v_titanic IS DISTINCT FROM 4 THEN
    RAISE EXCEPTION 'M88 ASSERTION FAILED: Titanic correct_index = %, expected 4', v_titanic;
  END IF;

  -- Моне (de2df98a): correct answer 'Импрессионизм', must be at index 0
  SELECT correct_index INTO v_mone
    FROM questions WHERE id = 'de2df98a-f8f3-44f3-94a5-cd243b9f5101';
  IF v_mone IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'M88 ASSERTION FAILED: Mone correct_index = %, expected 0', v_mone;
  END IF;

  -- Дюшан (f8aefc3c): correct answer 'Французский дадаист', must be at index 1
  SELECT correct_index INTO v_dushan
    FROM questions WHERE id = 'f8aefc3c-8628-477e-844f-d6976e0629c2';
  IF v_dushan IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'M88 ASSERTION FAILED: Dushan correct_index = %, expected 1', v_dushan;
  END IF;

  RAISE NOTICE 'M88 assertions passed: Brazil=0 Titanic=4 Mone=0 Dushan=1';
END $$;

COMMIT;

-- ══════════════════════════════════════════════════════════════════
-- ROWS EXCLUDED (unresolved / no deterministic ground truth): 196
-- See: scripts/m88_unresolved_manual_review.json
-- ══════════════════════════════════════════════════════════════════