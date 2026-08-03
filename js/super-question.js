// ── Супервопрос дня ───────────────────────────────────────────────
import { sb }           from './services/supabase.js';
import { getState }     from './state.js';
import { updNeurons }   from './economy/wallet.js';

const TODAY = () => new Date().toISOString().slice(0, 10);
const DONE_KEY = () => `bfc_superq_${TODAY()}`;

export async function loadSuperQuestion() {
  const el = document.getElementById('home-super-q');
  if (!el) return;

  const { currentUser } = getState();
  if (!currentUser) return;

  if (localStorage.getItem(DONE_KEY())) { el.style.display = 'none'; return; }

  const { data: q } = await sb.from('daily_super_questions')
    .select('id, question_text, image_url')
    .eq('active_date', TODAY())
    .maybeSingle();

  if (!q) { el.style.display = 'none'; return; }

  el.style.display = 'block';
  el.innerHTML = `
    <div onclick="window.openSuperQuestion()"
      style="background:linear-gradient(135deg,rgba(245,196,0,.12),rgba(240,150,0,.08));border:1px solid rgba(245,196,0,.3);border-radius:16px;padding:14px 16px;cursor:pointer;display:flex;align-items:center;gap:14px">
      <div style="font-size:28px;flex-shrink:0">🌟</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#f5c400;font-weight:800;margin-bottom:3px">Супервопрос дня</div>
        <div style="font-size:13px;font-weight:800;line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${q.question_text}</div>
      </div>
      <div style="font-size:15px;font-weight:900;color:#f5c400;flex-shrink:0">+10 ⚡</div>
    </div>`;

  window._superQ = q;
}

window.openSuperQuestion = function() {
  const q = window._superQ;
  if (!q) return;

  const existing = document.getElementById('super-q-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'super-q-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.85);display:flex;align-items:flex-end;padding:0';

  modal.innerHTML = `
    <div style="background:var(--bg);border-radius:24px 24px 0 0;padding:24px 20px 40px;width:100%;max-width:560px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div>
          <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:#f5c400;font-weight:800;margin-bottom:4px">🌟 Супервопрос дня · +10 ⚡</div>
          <div style="font-size:16px;font-weight:800;line-height:1.4">${q.question_text}</div>
        </div>
        <button onclick="document.getElementById('super-q-modal').remove()"
          style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0 0 0 10px;flex-shrink:0">×</button>
      </div>
      ${q.image_url ? `<img src="${q.image_url}" style="width:100%;border-radius:12px;margin-bottom:16px;max-height:200px;object-fit:cover"/>` : ''}
      <div style="font-size:12px;color:var(--muted);margin-bottom:10px">Введи ответ — засчитается при частичном совпадении</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input id="sq-input" placeholder="Твой ответ..."
          style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none"
          onkeydown="if(event.key==='Enter') window._sqSubmit()"/>
        <button onclick="window._sqSubmit()"
          style="background:#f5c400;border:none;border-radius:12px;padding:12px 18px;font-size:14px;font-weight:900;color:#111;cursor:pointer;font-family:inherit">
          →
        </button>
      </div>
      <div id="sq-result" style="display:none;text-align:center;padding:8px 0"></div>
    </div>`;

  document.body.appendChild(modal);
  setTimeout(() => modal.querySelector('#sq-input')?.focus(), 100);

  let _sent = false;
  window._sqSubmit = async function() {
    if (_sent) return;
    const answer = document.getElementById('sq-input')?.value?.trim();
    if (!answer) return;
    _sent = true;

    const btn = modal.querySelector('button[onclick="window._sqSubmit()"]');
    if (btn) btn.disabled = true;

    try {
      const { data, error } = await sb.rpc('answer_super_question', {
        p_question_id: q.id,
        p_answer: answer,
      });

      const resultEl = document.getElementById('sq-result');
      if (!resultEl) return;
      resultEl.style.display = 'block';

      if (error) {
        const msg = error.message || '';
        if (msg.includes('already_attempted')) {
          resultEl.innerHTML = `<div style="font-size:14px;color:var(--muted)">Ты уже отвечал сегодня</div>`;
        } else {
          resultEl.innerHTML = `<div style="font-size:14px;color:var(--muted)">Ошибка. Попробуй позже.</div>`;
        }
      } else if (data?.is_correct) {
        resultEl.innerHTML = `<div style="font-size:22px;margin-bottom:6px">🎉</div><div style="font-size:16px;font-weight:900;color:#4ade80">Правильно! +10 ⚡</div>`;
        if (typeof updNeurons === 'function') updNeurons();
      } else {
        resultEl.innerHTML = `<div style="font-size:22px;margin-bottom:6px">😬</div><div style="font-size:13px;color:var(--muted)">Не совсем... попробуй ещё раз завтра</div>`;
      }

      localStorage.setItem(DONE_KEY(), '1');
      const teaser = document.getElementById('home-super-q');
      if (teaser) teaser.style.display = 'none';
      setTimeout(() => modal.remove(), 2500);
    } catch(e) {
      _sent = false;
      if (btn) btn.disabled = false;
    }
  };
};
