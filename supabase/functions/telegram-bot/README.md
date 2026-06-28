# Telegram Bot

## Setup:
1. Создай бота через @BotFather в Telegram → скопируй токен
2. supabase secrets set TELEGRAM_BOT_TOKEN="1234567890:ABC..."
3. supabase functions deploy telegram-bot --no-verify-jwt
4. Установи webhook (вставь в браузер):
   https://api.telegram.org/bot{ТВОЙ_ТОКЕН}/setWebhook?url=https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/telegram-bot

## Команды бота:
/start — главное меню
/play  — открыть игру
/duel  — быстрая дуэль
/tournament — турниры
/stats — статистика
