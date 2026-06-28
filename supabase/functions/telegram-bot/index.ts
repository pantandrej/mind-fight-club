// Telegram Bot for Brain Fight Club
// Commands: /start, /play, /duel, /stats, /tournament
//
// Setup:
// 1. Create bot via @BotFather → get token
// 2. supabase secrets set TELEGRAM_BOT_TOKEN="your_token"
// 3. supabase functions deploy telegram-bot --no-verify-jwt
// 4. Set webhook: https://api.telegram.org/bot{TOKEN}/setWebhook?url=https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/telegram-bot

import { createClient } from 'npm:@supabase/supabase-js@2';

const BOT_APP_URL = 'https://brainfight.club'; // your app URL

async function sendMessage(chatId: number, text: string, keyboard?: object) {
  const token = Deno.env.get('TELEGRAM_BOT_TOKEN')!;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      reply_markup: keyboard,
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('ok');

  try {
    const update = await req.json();
    const msg = update.message || update.callback_query?.message;
    if (!msg) return new Response('ok');

    const chatId = msg.chat.id;
    const text = (update.message?.text || '').trim();
    const firstName = msg.from?.first_name || 'Игрок';

    const keyboard = {
      inline_keyboard: [
        [{ text: '⚔️ Играть', web_app: { url: BOT_APP_URL } }],
        [{ text: '🏆 Турниры', web_app: { url: BOT_APP_URL + '?nav=tournaments' } }],
        [{ text: '👤 Мой профиль', web_app: { url: BOT_APP_URL + '?nav=profile' } }],
      ],
    };

    if (text === '/start' || text === '/play') {
      await sendMessage(chatId,
        `👋 Привет, ${firstName}!\n\nДобро пожаловать в <b>Brain Fight Club</b> ⚡\n\nЗдесь ты можешь:\n• ⚔️ Вызвать друга на дуэль\n• 🏆 Участвовать в турнирах\n• 🧠 Прокачивать знания каждый день\n\nНажми кнопку ниже чтобы начать:`,
        keyboard,
      );
    } else if (text === '/stats') {
      await sendMessage(chatId,
        `📊 Открой профиль чтобы увидеть свою статистику:`,
        { inline_keyboard: [[{ text: '👤 Мой профиль', web_app: { url: BOT_APP_URL + '?nav=profile' } }]] },
      );
    } else if (text === '/tournament') {
      await sendMessage(chatId,
        `🏆 Актуальные турниры:`,
        { inline_keyboard: [[{ text: '🏆 Открыть турниры', web_app: { url: BOT_APP_URL + '?nav=tournaments' } }]] },
      );
    } else if (text === '/duel') {
      await sendMessage(chatId,
        `⚔️ Готов к дуэли?\n\nОткрой приложение, создай комнату и поделись ссылкой с другом:`,
        { inline_keyboard: [[{ text: '⚔️ Начать дуэль', web_app: { url: BOT_APP_URL + '?nav=duel' } }]] },
      );
    } else if (text.startsWith('/')) {
      await sendMessage(chatId,
        `Команды:\n/start — главное меню\n/play — играть\n/duel — дуэль\n/tournament — турниры\n/stats — статистика`,
      );
    } else {
      await sendMessage(chatId, `Используй /play чтобы начать игру! ⚡`, keyboard);
    }
  } catch (e) {
    console.error('[telegram-bot]', e);
  }

  return new Response('ok');
});
