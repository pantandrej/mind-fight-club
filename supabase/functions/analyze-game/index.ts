// Supabase Edge Function — analyze-game
// Analyzes quiz results and returns personalized AI feedback.
//
// Deploy:
//   supabase functions deploy analyze-game --no-verify-jwt

import Anthropic from 'npm:@anthropic-ai/sdk@0.27';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const { questions, answers, lang = 'ru' } = await req.json();
    // questions: [{q, a:[4], c:0, cat}], answers: [chosen_index or null]
    if (!Array.isArray(questions) || !questions.length) {
      return new Response(JSON.stringify({ ok: false, reason: 'no questions' }), {
        status: 400, headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // Build per-category stats
    const cats: Record<string, { total: number; correct: number }> = {};
    questions.forEach((q: any, i: number) => {
      const cat = q.cat || 'Общее';
      if (!cats[cat]) cats[cat] = { total: 0, correct: 0 };
      cats[cat].total++;
      if (answers[i] === q.c) cats[cat].correct++;
    });

    const totalQ   = questions.length;
    const totalOk  = Object.values(cats).reduce((s, c) => s + c.correct, 0);
    const accuracy = Math.round((totalOk / totalQ) * 100);

    const catLines = Object.entries(cats)
      .map(([cat, s]) => `- ${cat}: ${s.correct}/${s.total}`)
      .join('\n');

    const wrongQs = questions
      .filter((q: any, i: number) => answers[i] !== q.c)
      .slice(0, 5)
      .map((q: any) => `• ${q.q} (правильно: ${q.a[q.c]})`)
      .join('\n');

    const prompt = lang === 'ru'
      ? `Ты тренер по интеллектуальным играм. Игрок только что прошёл квиз.

Результат: ${totalOk} из ${totalQ} (${accuracy}%)
По категориям:
${catLines}

Вопросы где ошибся:
${wrongQs || 'ошибок нет!'}

Напиши персональный разбор в 3-4 коротких предложения:
1. Что получилось хорошо (если есть)
2. Где слабые места (конкретные категории)
3. Один конкретный совет что изучить

Тон: дружелюбный, мотивирующий, без воды. Без заголовков и списков — просто текст.`
      : `You are an intellectual game coach. A player just completed a quiz.

Result: ${totalOk} of ${totalQ} (${accuracy}%)
By category:
${catLines}

Wrong answers:
${wrongQs || 'none!'}

Write a personal 3-4 sentence review: what went well, weak spots, one specific tip. Friendly tone, no headers or lists.`;

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = ((message.content[0] as { text: string }).text || '').trim();

    return new Response(JSON.stringify({
      ok: true, text, accuracy, totalOk, totalQ,
      cats: Object.entries(cats).map(([cat, s]) => ({ cat, ...s, pct: Math.round(s.correct / s.total * 100) })),
    }), { headers: { ...cors, 'Content-Type': 'application/json' } });

  } catch (e) {
    console.error('[analyze-game]', e);
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
