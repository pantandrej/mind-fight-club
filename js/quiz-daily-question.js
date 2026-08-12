// ── Супервопрос дня от квизов ─────────────────────────────────────
import { sb }       from './services/supabase.js';
import { getState, setState } from './state.js';
import { updNeurons } from './economy/wallet.js';

// ── Загрузка и рендер блока ───────────────────────────────────────
export async function loadQuizDailyQuestion() {
  const wrap = document.getElementById('quiz-daily-wrap');
  if (!wrap) return;

  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await sb
    .from('quiz_daily_questions')
    .select('id,image_url,hint_options,quiz_id,quizzes(name,slug,logo_url)')
    .eq('status', 'approved')
    .eq('scheduled_date', today)
    .limit(1)
    .maybeSingle();

  if (error || !data) { wrap.style.display = 'none'; return; }
  const q = data;
  if (!q) { wrap.style.display = 'none'; return; }

  // Проверяем, отвечал ли уже
  const { currentUser } = getState();
  let alreadyAnswered = false;
  if (currentUser) {
    const { data: ans } = await sb.from('quiz_daily_answers')
      .select('is_correct, answer_text')
      .eq('question_id', q.id)
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (ans) { alreadyAnswered = true; _renderAnswered(wrap, q, ans); return; }
  }

  _renderQuestion(wrap, q, alreadyAnswered);
}

function _renderQuestion(wrap, q, alreadyAnswered) {
  const quiz    = q.quizzes || {};
  const hints   = q.hint_options ? q.hint_options.split(',').map(s => s.trim()).filter(Boolean) : [];

  wrap.style.display = 'block';
  wrap.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;overflow:hidden;margin:12px 0">
      <!-- Шапка квиза -->
      <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:0.5px solid var(--border)">
        ${quiz.logo_url
          ? `<img src="${quiz.logo_url}" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,rgba(108,99,255,.3),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🧠</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Супервопрос от</div>
          <div style="font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(quiz.name || 'Квиз')}</div>
        </div>
        <a href="/quiz/${_esc(quiz.slug || '')}" style="font-size:11px;font-weight:700;color:var(--accent2);text-decoration:none;flex-shrink:0">Открыть →</a>
      </div>
      <!-- Картинка вопроса -->
      <img src="${_esc(q.image_url)}" style="width:100%;max-height:320px;object-fit:contain;background:#000;display:block">
      <!-- Поле ответа -->
      <div style="padding:14px 16px">
        ${hints.length ? `
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
            ${hints.map(h => `<button onclick="document.getElementById('qdq-input').value='${_esc(h)}'" style="background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.3);border-radius:20px;padding:5px 12px;font-size:12px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">${_esc(h)}</button>`).join('')}
          </div>` : ''}
        <div style="display:flex;gap:8px">
          <input id="qdq-input" type="text" placeholder="Введи ответ..."
            style="flex:1;padding:12px 14px;border-radius:12px;border:1.5px solid var(--border);background:var(--bg);color:var(--text);font-size:14px;font-family:inherit;outline:none"
            onkeydown="if(event.key==='Enter')window._submitQuizDailyAnswer('${q.id}')">
          <button onclick="window._submitQuizDailyAnswer('${q.id}')"
            style="padding:12px 18px;background:linear-gradient(135deg,#6c63ff,#a78bfa);border:none;border-radius:12px;color:#fff;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit;flex-shrink:0">
            Ответить
          </button>
        </div>
        <div id="qdq-result" style="margin-top:10px;min-height:20px"></div>
      </div>
    </div>`;
}

function _renderAnswered(wrap, q, ans) {
  const quiz = q.quizzes || {};
  wrap.style.display = 'block';
  wrap.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;overflow:hidden;margin:12px 0">
      <div style="padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:0.5px solid var(--border)">
        ${quiz.logo_url
          ? `<img src="${quiz.logo_url}" style="width:32px;height:32px;border-radius:8px;object-fit:cover;flex-shrink:0">`
          : `<div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,rgba(108,99,255,.3),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0">🧠</div>`}
        <div style="flex:1">
          <div style="font-size:11px;font-weight:800;color:var(--muted);text-transform:uppercase;letter-spacing:.05em">Супервопрос от</div>
          <div style="font-size:13px;font-weight:800">${_esc(quiz.name || 'Квиз')}</div>
        </div>
        <a href="/quiz/${_esc(quiz.slug || '')}" style="font-size:11px;font-weight:700;color:var(--accent2);text-decoration:none">Открыть →</a>
      </div>
      <img src="${_esc(q.image_url)}" style="width:100%;max-height:320px;object-fit:contain;background:#000;display:block;opacity:.7">
      <div style="padding:14px 16px;text-align:center">
        <div style="font-size:22px;margin-bottom:6px">${ans.is_correct ? '✅' : '❌'}</div>
        <div style="font-size:14px;font-weight:800;color:${ans.is_correct ? '#4ade80' : 'var(--red)'}">
          ${ans.is_correct ? 'Верно! +5 очков BF' : `Неверно · Твой ответ: «${_esc(ans.answer_text)}»`}
        </div>
        ${!ans.is_correct ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">+1 очко BF за попытку</div>` : ''}
      </div>
    </div>`;
}

// ── Отправка ответа ───────────────────────────────────────────────
window._submitQuizDailyAnswer = async function(questionId) {
  const input  = document.getElementById('qdq-input');
  const result = document.getElementById('qdq-result');
  const answer = input?.value?.trim();
  if (!answer) { if(result) result.textContent = 'Введи ответ'; return; }

  const { currentUser } = getState();
  if (!currentUser) { window.showScreen?.('auth'); return; }

  if (result) result.textContent = '...';

  const { data, error } = await sb.rpc('answer_quiz_daily_question', {
    p_question_id: questionId,
    p_answer_text: answer,
  });

  if (error || !data?.ok) {
    if (result) result.textContent = data?.reason === 'already_answered'
      ? 'Ты уже отвечал сегодня' : 'Ошибка, попробуй снова';
    return;
  }

  const wrap = document.getElementById('quiz-daily-wrap');
  if (data.is_correct) {
    if (result) {
      result.innerHTML = `<div style="color:#4ade80;font-weight:800">✅ Верно! +5 очков Brain Fights</div>`;
    }
    setTimeout(() => loadQuizDailyQuestion(), 1200);
  } else {
    if (result) {
      result.innerHTML = `<div style="color:var(--red);font-weight:800">❌ Неверно — +1 очко за попытку</div>
        ${data.correct_answer ? `<div style="font-size:12px;color:var(--muted);margin-top:4px">Правильный ответ: «${_esc(data.correct_answer)}»</div>` : ''}`;
    }
    setTimeout(() => loadQuizDailyQuestion(), 2000);
  }
};

function _esc(s) {
  return String(s || '').replace(/[<>"'&]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '&':'&amp;' }[c]));
}

window.loadQuizDailyQuestion = loadQuizDailyQuestion;
