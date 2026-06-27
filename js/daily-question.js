// ── Daily Question ────────────────────────────────────────────────────
// One question per day from pack questions, seeded by date.
// Awards +25 neurons on correct answer.

import { sb }          from './services/supabase.js';
import { getState }    from './state.js';
import { awardNeurons } from './economy/wallet.js';

const TODAY_KEY = () => `bfc_daily_q_${new Date().toISOString().slice(0, 10)}`;

export function isDailyDone() {
  return !!localStorage.getItem(TODAY_KEY());
}

export async function loadDailyQuestion() {
  const el = document.getElementById('home-daily-teaser');
  if (!el) return;

  if (isDailyDone()) {
    el.style.display = 'none';
    return;
  }

  // Pick a question seeded by today's date (deterministic for all users)
  const seed = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const offset = parseInt(seed) % 1000;

  const { data: questions } = await sb
    .from('questions')
    .select('id, q, a, correct_index')
    .eq('status', 'active')
    .range(offset, offset)
    .limit(1);

  if (!questions?.length) return;
  const q = questions[0];

  // Show the teaser card
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(108,99,255,.15),rgba(168,85,247,.1));border:0.5px solid rgba(108,99,255,.35);border-radius:16px;padding:14px 16px;cursor:pointer" onclick="openDailyQuestion()">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0">
        <div>
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent2);font-weight:800;margin-bottom:3px">❓ Вопрос дня</div>
          <div style="font-size:14px;font-weight:800;line-height:1.3">${q.q?.slice(0, 60)}${q.q?.length > 60 ? '...' : ''}</div>
        </div>
        <div style="font-size:24px;color:var(--gold);flex-shrink:0;margin-left:10px">+25⚡</div>
      </div>
    </div>`;

  window._dailyQ = q;
  window.openDailyQuestion = () => _showDailyModal(q);
}

function _showDailyModal(q) {
  const existing = document.getElementById('daily-q-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'daily-q-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.8);display:flex;align-items:flex-end;padding:0';

  const answers = (q.a || []).map((ans, i) => `
    <button onclick="window._dailyPick(${i})" id="dq-btn-${i}"
      style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid rgba(255,255,255,.15);border-radius:12px;padding:13px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:8px;text-align:left">
      ${ans}
    </button>`).join('');

  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:24px 24px 0 0;padding:24px 20px 36px;width:100%;max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--accent2);font-weight:800;margin-bottom:4px">❓ Вопрос дня · +25 ⚡</div>
          <div style="font-size:16px;font-weight:800;line-height:1.4">${q.q}</div>
        </div>
        <button onclick="document.getElementById('daily-q-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0 0 0 10px;flex-shrink:0">×</button>
      </div>
      <div id="dq-answers">${answers}</div>
      <div id="dq-result" style="display:none;text-align:center;padding:8px 0 4px"></div>
    </div>`;

  document.body.appendChild(modal);

  let _answered = false;
  window._dailyPick = function(idx) {
    if (_answered) return;
    _answered = true;

    const correct = idx === q.correct_index;
    const btns = modal.querySelectorAll('[id^=dq-btn-]');
    btns.forEach((btn, i) => {
      btn.disabled = true;
      btn.style.opacity = i === idx ? '1' : '0.4';
      if (i === q.correct_index) {
        btn.style.background = 'rgba(74,222,128,.2)';
        btn.style.borderColor = 'rgba(74,222,128,.5)';
        btn.style.color = '#4ade80';
      } else if (i === idx && !correct) {
        btn.style.background = 'rgba(224,85,85,.2)';
        btn.style.borderColor = 'rgba(224,85,85,.4)';
        btn.style.color = '#e05555';
      }
    });

    const resultEl = modal.querySelector('#dq-result');
    resultEl.style.display = 'block';

    if (correct) {
      resultEl.innerHTML = `<div style="font-size:22px;margin-bottom:6px">🎉</div><div style="font-size:16px;font-weight:900;color:#4ade80">Правильно! +25 ⚡</div>`;
      const { currentUser } = getState();
      if (currentUser) awardNeurons(25, 'daily_question', q.id);
    } else {
      resultEl.innerHTML = `<div style="font-size:22px;margin-bottom:6px">😬</div><div style="font-size:14px;font-weight:700;color:var(--muted)">Правильный: ${q.a[q.correct_index]}</div>`;
    }

    localStorage.setItem(TODAY_KEY(), '1');

    // Hide teaser on home
    const teaser = document.getElementById('home-daily-teaser');
    if (teaser) teaser.style.display = 'none';

    // Auto-close after 2.5s
    setTimeout(() => modal.remove(), 2500);
  };
}

window.openDailyQuestion = () => window._dailyQ && _showDailyModal(window._dailyQ);
