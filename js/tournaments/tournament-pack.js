// ── Tournament Pack Player ────────────────────────────────────────────
// Timer-based: no host needed. start_at is known → each client calculates
// current question/phase from Date.now().

import { sb }     from '../services/supabase.js';
import { track }  from '../services/analytics.js';

let _t       = null;   // tournament row
let _pack    = null;   // pack.json data
let _timer   = null;
let _answered = {};    // {question_n: true}
let _score   = 0;
let _correct = 0;
let _phase   = null;   // 'lobby'|'question'|'answer'|'finished'
let _qIdx    = 0;

const SLOT = (t) => (t.q_duration + t.a_duration) * 1000;  // ms per question slot

// ── Public API ───────────────────────────────────────────────────────

export async function openTournament(tournamentId) {
  const { data: t } = await sb.from('tournaments').select('*').eq('id', tournamentId).single();
  if (!t) return window.toast?.('Турнир не найден');

  _t       = t;
  _pack    = null;
  _answered = {};
  _score   = 0;
  _correct = 0;

  // Load pack
  try {
    const res = await fetch(`/packs/${t.pack_id}/pack.json`);
    _pack = await res.json();
  } catch(e) { return window.toast?.('Не удалось загрузить пак'); }

  showScreen();
  tick();
  _timer = setInterval(tick, 500);
  track('tournament_opened', { id: tournamentId });
}

export async function closeTournament() {
  clearInterval(_timer);
  _timer = null;
  document.getElementById('tournament-screen').style.display = 'none';
}

window.closeTournament = closeTournament;

// ── Timer loop ───────────────────────────────────────────────────────

function tick() {
  if (!_t || !_pack) return;

  const now      = Date.now();
  const start    = new Date(_t.starts_at).getTime();
  const elapsed  = now - start;
  const total    = _pack.questions.length * SLOT(_t);

  if (elapsed < 0) {
    // Upcoming — show countdown
    if (_phase !== 'lobby') { _phase = 'lobby'; renderLobby(-elapsed); }
    else updateCountdown(-elapsed);
    return;
  }

  if (elapsed >= total) {
    if (_phase !== 'finished') { _phase = 'finished'; clearInterval(_timer); renderFinished(); }
    return;
  }

  const slotMs    = SLOT(_t);
  const qIdx      = Math.floor(elapsed / slotMs);
  const slotElapsed = elapsed % slotMs;
  const inAnswer  = slotElapsed >= _t.q_duration * 1000;

  const newPhase = inAnswer ? 'answer' : 'question';

  if (qIdx !== _qIdx || newPhase !== _phase) {
    _qIdx  = qIdx;
    _phase = newPhase;
    if (inAnswer) renderAnswer(qIdx, slotElapsed - _t.q_duration * 1000);
    else          renderQuestion(qIdx, slotElapsed);
  } else {
    // Just update timer bar
    if (_phase === 'question') {
      const leftMs = _t.q_duration * 1000 - slotElapsed;
      updateBar(leftMs / (_t.q_duration * 1000));
    } else {
      const leftMs = slotMs - slotElapsed;
      updateBar(leftMs / (_t.a_duration * 1000));
    }
  }
}

// ── Renders ──────────────────────────────────────────────────────────

function showScreen() {
  document.getElementById('tournament-screen').style.display = 'flex';
}

async function renderLobby(msLeft) {
  const secs = Math.ceil(msLeft / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const cd = h > 0 ? `${h}ч ${m}м` : m > 0 ? `${m}м ${s}с` : `${s}с`;

  document.getElementById('trn-body').innerHTML = `
    <div style="text-align:center;padding:32px 16px">
      <div style="font-size:48px;margin-bottom:12px">🏆</div>
      <div style="font-size:22px;font-weight:900;margin-bottom:8px">${_t.title}</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:24px">${_t.description || ''}</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:6px">До старта:</div>
      <div id="trn-countdown" style="font-size:40px;font-weight:900;color:var(--accent);font-variant-numeric:tabular-nums">${cd}</div>
      <div style="font-size:13px;color:var(--muted);margin-top:16px">${_pack.questions.length} вопросов · ${_t.q_duration}с на вопрос</div>
      ${await _isRegistered() ? '<div style="margin-top:20px;color:#4ade80;font-weight:700">✓ Вы зарегистрированы</div>' : ''}
    </div>
  `;
  renderRegisterBtn();
}

async function _isRegistered() {
  const user = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;
  if (!user) return false;
  const { data } = await sb.from('tournament_participants')
    .select('id').eq('tournament_id', _t.id).eq('user_id', user.id).maybeSingle();
  return !!data;
}

function updateCountdown(msLeft) {
  const secs = Math.ceil(msLeft / 1000);
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const cd = h > 0 ? `${h}ч ${m}м` : m > 0 ? `${m}м ${s}с` : `${s}с`;
  const el = document.getElementById('trn-countdown');
  if (el) el.textContent = cd;
}

function renderQuestion(qIdx, slotElapsed) {
  const q      = _pack.questions[qIdx];
  const leftMs = _t.q_duration * 1000 - slotElapsed;
  const alreadyAnswered = !!_answered[q.n];

  document.getElementById('trn-body').innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:4px 14px 0;display:flex;gap:4px;justify-content:center;flex-wrap:wrap" id="trn-dots"></div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:6px 12px;min-height:0">
        <img src="${q.img}" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain"/>
      </div>
      <div id="trn-q-text" style="font-size:12px;color:var(--muted);text-align:center;padding:2px 14px"></div>
      <div id="trn-feedback" style="text-align:center;font-size:14px;font-weight:800;min-height:20px;padding:2px 14px"></div>
      <div id="trn-ans-grid" style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:8px 14px 14px"></div>
    </div>
  `;

  renderDots(qIdx);
  const n = q.a.length;
  const grid = document.getElementById('trn-ans-grid');
  grid.innerHTML = q.a.map((ans, i) => {
    const center = (n % 2 === 1 && i === n - 1) ? ' style="grid-column:1/-1;max-width:50%;margin:0 auto;width:100%"' : '';
    const disabled = alreadyAnswered ? ' disabled' : '';
    const cls = alreadyAnswered && _answered[q.n] === i ? ' sp-correct' : '';
    return `<button class="sp-ans-btn${cls}"${disabled}${center} onclick="trnPick(${i})">${ans}</button>`;
  }).join('');

  updateBar(leftMs / (_t.q_duration * 1000));
}

function renderAnswer(qIdx, ansElapsed) {
  const q      = _pack.questions[qIdx];
  const leftMs = _t.a_duration * 1000 - ansElapsed;
  const myPick = _answered[q.n];
  const correct = myPick === q.c;

  document.getElementById('trn-body').innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:4px 14px 0;display:flex;gap:4px;justify-content:center;flex-wrap:wrap" id="trn-dots"></div>
      <div style="flex:1;display:flex;align-items:center;justify-content:center;padding:6px 12px;min-height:0">
        <img src="${q.ans_img || q.img}" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain"/>
      </div>
      <div style="text-align:center;padding:8px 14px;font-size:16px;font-weight:900;${myPick !== undefined ? (correct ? 'color:#4ade80' : 'color:#e05555') : 'color:var(--muted)'}">
        ${myPick !== undefined ? (correct ? '✓ Правильно!' : `✗ Правильный: ${q.a[q.c]}`) : 'Время вышло без ответа'}
      </div>
    </div>
  `;
  renderDots(qIdx);
  updateBar(leftMs / (_t.a_duration * 1000));
}

function renderFinished() {
  document.getElementById('trn-bar').style.width = '0%';
  loadLeaderboardAndRender();
}

async function loadLeaderboardAndRender() {
  const { data: rows } = await sb.from('tournament_participants')
    .select('user_id, score, correct, profiles(display_name, avatar_url)')
    .eq('tournament_id', _t.id)
    .order('score', { ascending: false })
    .limit(50);

  const user = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;

  const list = (rows || []).map((r, i) => {
    const name  = r.profiles?.display_name || 'Игрок';
    const isMe  = user && r.user_id === user.id;
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    return `<div style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;${isMe ? 'background:rgba(108,99,255,.15);font-weight:800' : ''}">
      <div style="font-size:18px;min-width:28px">${medal}</div>
      <div style="flex:1">${name}</div>
      <div style="color:var(--accent2);font-weight:800">⚡ ${r.score}</div>
      <div style="color:var(--muted);font-size:12px">${r.correct}/${_pack.questions.length}</div>
    </div>`;
  }).join('');

  document.getElementById('trn-body').innerHTML = `
    <div style="text-align:center;padding:20px 14px 10px">
      <div style="font-size:36px">🏆</div>
      <div style="font-size:20px;font-weight:900;margin:6px 0">${_t.title} — итоги</div>
      <div style="font-size:14px;color:var(--accent2);font-weight:800">Ваш счёт: ⚡ ${_score} · ${_correct}/${_pack.questions.length}</div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:0 4px 16px">${list}</div>
    <div style="padding:12px 14px">
      <button class="big-btn" onclick="closeTournament()">← Назад</button>
    </div>
  `;
}

function renderDots(activeIdx) {
  const el = document.getElementById('trn-dots');
  if (!el) return;
  el.innerHTML = _pack.questions.map((q, i) => {
    const answered = _answered[q.n];
    let cls = 'sp-dot';
    if (i < activeIdx) cls += answered !== undefined ? (answered === q.c ? ' done' : ' done wrong') : ' done';
    else if (i === activeIdx) cls += ' active';
    return `<div class="${cls}"></div>`;
  }).join('');
}

function renderRegisterBtn() {
  // Add register button to lobby
}

function updateBar(fraction) {
  const bar = document.getElementById('trn-bar');
  if (bar) bar.style.width = Math.max(0, Math.min(1, fraction) * 100) + '%';
}

// ── Pick answer ───────────────────────────────────────────────────────

window.trnPick = async function(i) {
  if (_phase !== 'question') return;
  const q = _pack.questions[_qIdx];
  if (_answered[q.n] !== undefined) return;

  const now      = Date.now();
  const start    = new Date(_t.starts_at).getTime();
  const elapsed  = now - start;
  const slotMs   = SLOT(_t);
  const slotElapsed = elapsed % slotMs;
  const leftMs   = _t.q_duration * 1000 - slotElapsed;

  const correct  = i === q.c;
  const pts      = correct ? Math.max(1, Math.round(30 * leftMs / (_t.q_duration * 1000))) : 0;

  _answered[q.n] = i;
  if (correct) { _score += pts; _correct++; }

  // Highlight chosen button
  document.querySelectorAll('.sp-ans-btn').forEach((btn, idx) => {
    if (idx === q.c)  btn.classList.add('sp-correct');
    else if (idx === i) btn.classList.add('sp-wrong');
    btn.disabled = true;
  });
  const fb = document.getElementById('trn-feedback');
  if (fb) { fb.textContent = correct ? `✓ +${pts}` : `✗ ${q.a[q.c]}`; fb.style.color = correct ? '#4ade80' : '#e05555'; }

  // Save to DB
  const user = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;
  if (user) {
    await sb.rpc('submit_tournament_answer', {
      p_tournament_id: _t.id,
      p_question_n: q.n,
      p_picked: i,
      p_correct: correct,
      p_pts: pts,
    });
  }
};

// ── Register ──────────────────────────────────────────────────────────

window.trnRegister = async function(tournamentId) {
  const user = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;
  if (!user) { window.toast?.('Войдите, чтобы зарегистрироваться'); return; }
  const { data } = await sb.rpc('register_for_tournament', { p_tournament_id: tournamentId });
  if (data?.ok) {
    window.toast?.('✓ Зарегистрированы!');
    document.getElementById('trn-register-btn')?.remove();
  } else {
    window.toast?.(data?.reason || 'Ошибка');
  }
};

// ── Tournaments list screen ───────────────────────────────────────────

let _listRefreshTimer = null;

window.closeTournamentsList = function() {
  clearInterval(_listRefreshTimer);
  _listRefreshTimer = null;
  document.getElementById('tournaments-list-screen').style.display = 'none';
};

let _listRows = [];
let _listUser = null;
let _listRegIds = new Set();

function _renderTournamentList() {
  const body = document.getElementById('trn-list-body');
  if (!body || !_listRows.length) return;

  body.innerHTML = _listRows.map(t => {
    const startsAt = new Date(t.starts_at);
    const diffMs   = startsAt.getTime() - Date.now();
    const isLive   = t.status === 'active' || diffMs <= 0;
    const isReg    = _listRegIds.has(t.id);

    let timeStr;
    if (isLive) {
      timeStr = '<span style="color:#4ade80;font-weight:800">● LIVE</span>';
    } else {
      const d = Math.floor(diffMs / 86400000);
      const h = Math.floor((diffMs % 86400000) / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      const s = Math.floor((diffMs % 60000) / 1000);
      timeStr = d > 0 ? `через ${d}д ${h}ч` : h > 0 ? `через ${h}ч ${m}м` : m > 0 ? `через ${m}м ${s}с` : `через ${s}с`;
    }

    let btn;
    if (isLive) {
      btn = `<button class="big-btn" style="flex:1;padding:10px;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="openTournamentAndClose('${t.id}')">▶ Играть сейчас</button>`;
    } else if (isReg) {
      btn = `<button class="score-sec-btn" style="flex:1;padding:10px;color:#4ade80" disabled>✓ Зарегистрирован</button>`;
    } else if (_listUser) {
      btn = `<button class="big-btn" style="flex:1;padding:10px" onclick="trnRegister('${t.id}',this)">Зарегистрироваться</button>`;
    } else {
      btn = `<button class="score-sec-btn" style="flex:1;padding:10px" onclick="window.toast?.('Войдите, чтобы зарегистрироваться')">Войти и зарегистрироваться</button>`;
    }

    return `<div style="background:rgba(255,255,255,.05);border-radius:14px;padding:16px;border:1px solid ${isLive ? 'rgba(74,222,128,.3)' : 'rgba(255,255,255,.08)'}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:16px;font-weight:900">${t.title}</div>
        <div style="font-size:12px">${timeStr}</div>
      </div>
      ${t.description ? `<div style="font-size:13px;color:var(--muted);margin-bottom:12px;line-height:1.4">${t.description}</div>` : ''}
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">
        ⏱ ${t.q_duration}с на вопрос · 📅 ${startsAt.toLocaleDateString('ru', {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}
      </div>
      <div style="display:flex;gap:8px">${btn}</div>
    </div>`;
  }).join('');
}

window.openTournamentsListScreen = async function() {
  const screen = document.getElementById('tournaments-list-screen');
  screen.style.display = 'flex';
  clearInterval(_listRefreshTimer);
  _listRefreshTimer = setInterval(_renderTournamentList, 1000);  // re-render every second (no DB call)

  const body = document.getElementById('trn-list-body');
  body.innerHTML = `<div style="text-align:center;color:var(--muted);padding:24px">Загрузка...</div>`;

  const { data: rows } = await sb.from('tournaments')
    .select('*')
    .in('status', ['upcoming', 'active'])
    .order('starts_at', { ascending: true });

  if (!rows || rows.length === 0) {
    body.innerHTML = `<div style="text-align:center;color:var(--muted);padding:40px 16px">
      <div style="font-size:40px;margin-bottom:12px">🏆</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:6px">Турниров пока нет</div>
      <div style="font-size:13px">Следите за анонсами!</div>
    </div>`;
    return;
  }

  _listRows = rows;
  _listUser = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;
  _listRegIds = new Set();
  if (_listUser) {
    const { data: reg } = await sb.from('tournament_participants')
      .select('tournament_id').eq('user_id', _listUser.id);
    (reg || []).forEach(r => _listRegIds.add(r.tournament_id));
  }
  _renderTournamentList();
};

window.openTournamentAndClose = function(id) {
  document.getElementById('tournaments-list-screen').style.display = 'none';
  openTournament(id);
};

window.trnRegister = async function(id, btn) {
  const user = sb.auth?.getUser ? (await sb.auth.getUser()).data?.user : null;
  if (!user) { window.toast?.('Войдите, чтобы зарегистрироваться'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const { data } = await sb.rpc('register_for_tournament', { p_tournament_id: id });
  if (data?.ok) {
    window.toast?.('✓ Зарегистрированы!');
    if (btn) { btn.textContent = '✓ Зарегистрирован'; btn.style.color = '#4ade80'; }
  } else {
    window.toast?.(data?.reason || 'Ошибка');
    if (btn) { btn.disabled = false; btn.textContent = 'Зарегистрироваться'; }
  }
};

window.openTournament = openTournament;
