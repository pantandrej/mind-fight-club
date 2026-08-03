# BFC — Инструкции для Claude

## Публикация игры из архива (всегда так!)

**Пользователь даёт:** zip-архив с `.pptx` + медиафайлы (картинки, аудио)  
**Claude делает:** парсит слайды → генерирует JSON → даёт команду для запуска

### Шаг 1 — Распаковка и парсинг (делает Claude)

Извлечь архив, прочитать слайды PPTX с помощью `markitdown`, создать файл:
```
scripts/ИМЯ_questions.json
```

### Формат JSON (строго этот, без изменений)

```json
[
  {
    "question_type": "info",
    "question_text": "Первый раунд",
    "answers": [],
    "correct": 0,
    "slide_q_url": "URL_картинки"
  },
  {
    "question_text": "Текст вопроса?",
    "answers": ["Вариант А", "Вариант Б", "Вариант В", "Вариант Г"],
    "correct": 0,
    "slide_q_url": "URL_картинки_вопроса",
    "slide_a_url": "URL_картинки_ответа"
  },
  {
    "question_text": "Аудио-вопрос",
    "answers": ["Вариант А", "Вариант Б"],
    "correct": 1,
    "audio": "URL_аудиофайла",
    "slide_q_url": "URL_картинки_вопроса",
    "slide_a_url": "URL_картинки_ответа"
  }
]
```

**Правила:**
- `question_type: "info"` — разделитель раундов, `answers: []`, `correct: 0`
- `correct` — индекс правильного ответа (0-based)
- Картинки — GitHub raw URL: `https://raw.githubusercontent.com/pantandrej/mind-fight-club/main/public/games/КОД/slide_001.jpg`
- Медиафайлы сначала коммитятся в `public/games/КОД/`, потом строятся URL
- Число вариантов: 2, 3, 4, 5 или 6 — по слайду

### Шаг 2 — Claude говорит пользователю запустить

```bash
python3 scripts/publish_game.py scripts/ИМЯ_questions.json --name "Название игры" --code КОД
```

**Параметры:**
- `--name` — название пака/турнира (отображается в интерфейсе)
- `--code` — короткий код (T1, MB4 и т.п.), используется как папка в public/games/
- `--type pack` или `--type tournament` (по умолчанию tournament)
- `--time 30` — время на вопрос в секундах (по умолчанию из scoring_scheme)

**Claude НЕ запускает publish_game.py сам.** Только генерирует JSON и даёт команду.

### Scoring scheme (время на вопрос по числу вариантов)

| Вариантов | Время |
|-----------|-------|
| 2         | 30 с  |
| 3         | 35 с  |
| 4         | 40 с  |
| 5         | 45 с  |
| 6         | 50 с  |

Итого за игру: 400 баллов.

---

## Структура проекта

- `js/` — SPA на vanilla JS (ES modules), без React
- `js/auth/auth.js` — авторизация через Supabase + VK ID
- `js/leaderboard.js` — таблица лидеров по дисциплинам
- `js/my-team.js` — экран «Моя Команда» + создание/вступление + скауты
- `js/scout-form.js` — ввод результатов бар-квиза (только для is_scout)
- `sql/` — миграции Supabase (запускать вручную в SQL Editor)
- `scripts/publish_game.py` — публикация игры в БД
- `scripts/zip_to_json.py` — конвертация zip → JSON с загрузкой медиа

## VK Auth

App ID: 54683964. Использовать `id.vk.ru/authorize` + ручной PKCE. **НЕ использовать VK SDK для авторизации.**

## Деплой

Сайт на Vercel. После каждого `git commit` делать `git push origin main`.
