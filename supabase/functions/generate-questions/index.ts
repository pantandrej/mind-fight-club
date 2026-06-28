// Supabase Edge Function — generate-questions
// Calls Claude Haiku to generate quiz questions from a topic.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
//   supabase functions deploy generate-questions --no-verify-jwt
//
// Get API key: https://console.anthropic.com/

import Anthropic from 'npm:@anthropic-ai/sdk@0.27';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { topic, count = 10, lang = 'ru' } = await req.json();
    if (!topic?.trim()) {
      return new Response(JSON.stringify({ ok: false, reason: 'missing topic' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY')! });

    const prompt = lang === 'ru'
      ? `Создай ${count} вопросов для викторины на тему: "${topic}".

Верни ТОЛЬКО валидный JSON массив без пояснений:
[
  {
    "q": "Текст вопроса?",
    "a": ["Правильный ответ", "Неправильный 1", "Неправильный 2", "Неправильный 3"],
    "c": 0,
    "cat": "${topic}"
  }
]

Правила:
- Правильный ответ ВСЕГДА первый (индекс 0), остальные — правдоподобные дистракторы
- Вопросы разной сложности
- Ответы краткие (1-6 слов)
- Только реальные факты`
      : `Create ${count} quiz questions about: "${topic}".

Return ONLY valid JSON array, no explanation:
[{"q":"Question?","a":["Correct","Wrong1","Wrong2","Wrong3"],"c":0,"cat":"${topic}"}]

Rules: correct answer always first (index 0), answers 1-6 words, real facts only, varied difficulty.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2500,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = ((message.content[0] as { text: string }).text || '').trim();
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in response');

    const questions = JSON.parse(match[0]);
    const valid = questions.filter((q: any) =>
      q.q && Array.isArray(q.a) && q.a.length === 4 && typeof q.c === 'number'
    );

    return new Response(JSON.stringify({ ok: true, questions: valid, count: valid.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    console.error('[generate-questions]', e);
    return new Response(JSON.stringify({ ok: false, reason: String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
