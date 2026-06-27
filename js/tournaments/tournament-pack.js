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
  const resultColor = myPick !== undefined ? (correct ? '#4ade80' : '#e05555') : 'var(--muted)';
  const resultText  = myPick !== undefined ? (correct ? '✓ Правильно!' : `✗ Правильный: ${q.a[q.c]}`) : 'Время вышло';

  document.getElementById('trn-body').innerHTML = `
    <div style="display:flex;flex-direction:column;height:100%">
      <div style="padding:4px 14px 0;display:flex;gap:4px;justify-content:center;flex-wrap:wrap" id="trn-dots"></div>
      <div style="display:flex;align-items:center;justify-content:center;padding:6px 12px;max-height:40vh;min-height:0">
        <img src="${q.ans_img || q.img}" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain"/>
      </div>
      <div style="text-align:center;padding:6px 14px 4px;font-size:16px;font-weight:900;color:${resultColor}">
        ${resultText}
      </div>
      <div id="trn-live-board" style="flex:1;overflow-y:auto;padding:6px 12px 12px;display:flex;flex-direction:column;gap:4px">
        <div style="text-align:center;color:var(--muted);font-size:12px;padding:8px">Загружаем таблицу...</div>
      </div>
    </div>
  `;
  renderDots(qIdx);
  updateBar(leftMs / (_t.a_duration * 1000));
  loadLiveLeaderboard();
}

async function loadLiveLeaderboard() {
  const el = document.getElementById('trn-live-board');
  if (!el) return;

  const { data: rows } = await sb.from('tournament_participants')
    .select('user_id, score, correct, profiles(display_name)')
    .eq('tournament_id', _t.id)
    .order('score', { ascending: false })
    .limit(20);

  if (!rows || !rows.length) { el.innerHTML = ''; return; }

  const user = (await sb.auth.getUser()).data?.user;
  const myIdx = rows.findIndex(r => user && r.user_id === user.id);
  const myPlace = myIdx + 1;

  // Show: top-3 + context rows around me (2 above, me, 2 below)
  const show = new Set([0, 1, 2]);
  if (myIdx >= 0) for (let i = Math.max(0, myIdx-2); i <= Math.min(rows.length-1, myIdx+2); i++) show.add(i);

  let html = `<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--muted);font-weight:800;margin-bottom:4px;text-align:center">
    📊 Таблица ${myPlace > 0 ? `· Ты на <span style="color:var(--accent2);font-size:13px;font-weight:900">${myPlace}</span> месте` : ''}
  </div>`;

  let prev = -1;
  rows.forEach((r, i) => {
    if (!show.has(i)) return;
    if (prev >= 0 && i > prev + 1) html += `<div style="text-align:center;color:var(--muted);font-size:11px;padding:2px">···</div>`;
    prev = i;

    const isMe   = user && r.user_id === user.id;
    const medal  = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    const name   = r.profiles?.display_name || 'Игрок';
    html += `<div style="display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:10px;font-size:13px;
      ${isMe ? 'background:rgba(108,99,255,.2);border:1px solid rgba(108,99,255,.4);font-weight:800' : 'background:rgba(255,255,255,.04)'}">
      <div style="min-width:26px;font-size:15px">${medal}</div>
      <div style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isMe ? '👉 ' : ''}${name}</div>
      <div style="color:var(--accent2);font-weight:800;flex-shrink:0">⚡${r.score}</div>
    </div>`;
  });

  el.innerHTML = html;
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

  // Just mark chosen button as selected — don't reveal correct/wrong until answer phase
  document.querySelectorAll('.sp-ans-btn').forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === i) btn.style.cssText += ';border-color:rgba(255,255,255,.5);opacity:1;background:rgba(255,255,255,.15)';
    else btn.style.opacity = '0.4';
  });
  const fb = document.getElementById('trn-feedback');
  if (fb) { fb.textContent = '✓ Ответ принят'; fb.style.color = 'var(--muted)'; }

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

    return `<div onclick="openTournamentLobby('${t.id}')" style="background:rgba(255,255,255,.05);border-radius:14px;padding:16px;border:1px solid ${isLive ? 'rgba(74,222,128,.3)' : 'rgba(255,255,255,.08)'};cursor:pointer">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
        <div style="font-size:16px;font-weight:900">${t.title}</div>
        <div style="font-size:12px">${timeStr}</div>
      </div>
      ${t.description ? `<div style="font-size:13px;color:var(--muted);margin-bottom:10px;line-height:1.4">${t.description}</div>` : ''}
      <div style="font-size:12px;color:var(--muted)">
        ⏱ ${t.q_duration}с на вопрос · 📅 ${startsAt.toLocaleDateString('ru', {day:'numeric',month:'long',hour:'2-digit',minute:'2-digit'})}
        ${isReg ? ' · <span style="color:#4ade80;font-weight:700">✓ Зарегистрирован</span>' : ''}
      </div>
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

// ── Tournament Lobby ──────────────────────────────────────────────────

let _lobbyT = null;
let _lobbyTimer = null;

window.openTournamentLobby = async function(id) {
  const { data: t } = await sb.from('tournaments').select('*').eq('id', id).single();
  if (!t) return;
  _lobbyT = t;

  // Load participant count
  const { count } = await sb.from('tournament_participants')
    .select('*', { count: 'exact', head: true }).eq('tournament_id', id);

  const screen = document.getElementById('tournament-lobby-screen');
  screen.style.display = 'flex';

  document.getElementById('lobby-title').textContent = t.title;
  document.getElementById('lobby-q-dur').textContent = t.q_duration + 'с';

  // Try to load pack for question count
  try {
    const res = await fetch(`/packs/${t.pack_id}/pack.json`);
    const pack = await res.json();
    document.getElementById('lobby-q-count').textContent = pack.questions.length;
  } catch(_) {}

  document.getElementById('lobby-participants').textContent = (count || 0) + ' чел.';

  const descWrap = document.getElementById('lobby-desc-wrap');
  if (t.description) {
    descWrap.style.display = '';
    descWrap.textContent = t.description;
  }

  const startsAt = new Date(t.starts_at);
  document.getElementById('lobby-starts-at').textContent =
    startsAt.toLocaleDateString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

  // Check registration
  const user = (await sb.auth.getUser()).data?.user;
  const action = document.getElementById('lobby-action');
  let isReg = false;
  if (user) {
    const { data: reg } = await sb.from('tournament_participants')
      .select('id').eq('tournament_id', id).eq('user_id', user.id).maybeSingle();
    isReg = !!reg;
  }

  const diffMs = startsAt.getTime() - Date.now();
  const isLive = diffMs <= 0;

  const shareBtn = `<button onclick="shareTournamentLink('${id}')" style="width:100%;margin-top:8px;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.15);border-radius:12px;padding:11px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">📤 Позвать друзей</button>`;

  if (isLive) {
    action.innerHTML = `<button class="big-btn" style="width:100%;padding:16px;font-size:16px;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="openLobbyAndPlay('${id}')">▶ Играть сейчас</button>${shareBtn}`;
  } else if (isReg) {
    action.innerHTML = `
      <button class="score-sec-btn" style="width:100%;padding:16px;color:#4ade80" disabled>✓ Зарегистрирован — ждём старта</button>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button onclick="notifyTournamentTG('${id}')" style="flex:1;background:rgba(44,165,224,.12);border:0.5px solid rgba(44,165,224,.3);border-radius:12px;padding:11px;font-size:12px;font-weight:700;color:rgba(44,165,224,.9);cursor:pointer;font-family:inherit">✈️ Уведомить в TG</button>
        <button onclick="requestPushForTournament('${id}')" style="flex:1;background:rgba(255,255,255,.06);border:0.5px solid rgba(255,255,255,.15);border-radius:12px;padding:11px;font-size:12px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">🔔 Push</button>
      </div>
      ${shareBtn}`;
  } else if (user) {
    action.innerHTML = `<button class="big-btn" style="width:100%;padding:16px" onclick="trnRegisterLobby('${id}', this)">Зарегистрироваться</button>${shareBtn}`;
  } else {
    action.innerHTML = `<button class="big-btn" style="width:100%;padding:16px" onclick="signInGoogle()">Войти и зарегистрироваться</button>${shareBtn}`;
  }

  // Countdown ticker
  clearInterval(_lobbyTimer);
  _updateLobbyCountdown();
  _lobbyTimer = setInterval(_updateLobbyCountdown, 1000);
};

function _updateLobbyCountdown() {
  if (!_lobbyT) return;
  const diffMs = new Date(_lobbyT.starts_at).getTime() - Date.now();
  const el = document.getElementById('lobby-countdown');
  const actionEl = document.getElementById('lobby-action');
  if (!el) return;
  if (diffMs <= 0) {
    el.textContent = '● LIVE';
    el.style.color = '#4ade80';
    document.getElementById('lobby-status-label').textContent = 'Турнир идёт!';
    // Switch button to play
    if (actionEl && !actionEl.querySelector('.play-now-btn')) {
      actionEl.innerHTML = `<button class="big-btn play-now-btn" style="width:100%;padding:16px;font-size:16px;background:linear-gradient(135deg,#22c55e,#16a34a)" onclick="openLobbyAndPlay('${_lobbyT.id}')">▶ Играть сейчас</button>`;
    }
    return;
  }
  const h = Math.floor(diffMs / 3600000);
  const m = Math.floor((diffMs % 3600000) / 60000);
  const s = Math.floor((diffMs % 60000) / 1000);
  el.textContent = h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
}

window.closeTournamentLobby = function() {
  clearInterval(_lobbyTimer);
  document.getElementById('tournament-lobby-screen').style.display = 'none';
};

window.openLobbyAndPlay = function(id) {
  window.closeTournamentLobby();
  document.getElementById('tournaments-list-screen').style.display = 'none';
  openTournament(id);
};

window.trnRegisterLobby = async function(id, btn) {
  const user = (await sb.auth.getUser()).data?.user;
  if (!user) { window.toast?.('Войдите'); return; }
  if (btn) { btn.disabled = true; btn.textContent = '...'; }
  const { data } = await sb.rpc('register_for_tournament', { p_tournament_id: id });
  if (data?.ok) {
    window.toast?.('✓ Зарегистрированы!');
    _listRegIds?.add(id);
    if (btn) { btn.textContent = '✓ Зарегистрирован — ждём старта'; btn.style.color = '#4ade80'; }
  } else {
    if (btn) { btn.disabled = false; btn.textContent = 'Зарегистрироваться'; }
  }
};

// ── Home banner ───────────────────────────────────────────────────────

export async function refreshHomeBanner() {
  const { data: rows } = await sb.from('tournaments')
    .select('*').in('status', ['upcoming', 'active'])
    .order('starts_at', { ascending: true }).limit(3);

  const banner = document.getElementById('home-trn-banner');
  if (!banner) return;

  // Find soonest upcoming or live
  const now = Date.now();
  const t = (rows || []).find(r => new Date(r.starts_at).getTime() - now < 24 * 3600 * 1000);
  if (!t) { banner.style.display = 'none'; return; }

  banner.style.display = '';
  document.getElementById('home-trn-title').textContent = t.title;
  banner.onclick = () => window.openTournamentLobby(t.id);

  const diffMs = new Date(t.starts_at).getTime() - now;
  const label = document.getElementById('home-trn-label');
  const timeEl = document.getElementById('home-trn-time');

  if (diffMs <= 0) {
    label.textContent = '🔴 LIVE';
    timeEl.textContent = 'Турнир идёт — заходи!';
  } else {
    label.textContent = '🏆 СКОРО ТУРНИР';
    const m = Math.floor(diffMs / 60000);
    const h = Math.floor(m / 60);
    timeEl.textContent = h > 0 ? `через ${h}ч ${m % 60}м` : `через ${m}м`;
  }

  // Re-check every minute
  setTimeout(refreshHomeBanner, 60000);
}

// ── Create tournament (admin) ─────────────────────────────────────────

window.openCreateTournament = function() {
  // Set default start time to 1 hour from now
  const dt = new Date(Date.now() + 3600000);
  const pad = n => String(n).padStart(2, '0');
  const local = `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
  document.getElementById('ctrn-starts').value = local;
  document.getElementById('create-trn-modal').style.display = 'flex';
};

window.submitCreateTournament = async function() {
  const title    = document.getElementById('ctrn-title').value.trim();
  const desc     = document.getElementById('ctrn-desc').value.trim();
  const pack_id  = document.getElementById('ctrn-pack').value;
  const starts   = document.getElementById('ctrn-starts').value;
  const q_dur    = parseInt(document.getElementById('ctrn-qdur').value) || 30;

  if (!title || !starts) { window.toast?.('Заполни название и время'); return; }

  const { error } = await sb.from('tournaments').insert({
    title, description: desc || null, pack_id,
    starts_at: new Date(starts).toISOString(),
    q_duration: q_dur, a_duration: 15,
  });

  if (error) { window.toast?.('Ошибка: ' + error.message); return; }
  window.toast?.('✓ Турнир создан!');
  document.getElementById('create-trn-modal').style.display = 'none';
  document.getElementById('ctrn-title').value = '';
  document.getElementById('ctrn-desc').value = '';
  refreshHomeBanner();
};

window.shareTournamentLink = function(id) {
  const url = `${location.origin}${location.pathname}?t=${id}`;
  const t = _lobbyT;
  const title = t?.title || 'Турнир';
  const text = `🏆 Иду на «${title}» в Brain Fight Club!\nПрисоединяйся:\n${url}`;
  if (navigator.share) {
    navigator.share({ text, url }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text).then(() => window.toast?.('Ссылка скопирована!'));
  }
};

window.notifyTournamentTG = function(id) {
  const t = _lobbyT;
  const title = t?.title || 'Турнир';
  const url = `${location.origin}${location.pathname}?t=${id}`;
  const starts = t?.starts_at ? new Date(t.starts_at).toLocaleString('ru', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '';
  const text = `🏆 Напомни мне про турнир «${title}» (${starts})\n${url}`;
  const encoded = encodeURIComponent(text);
  window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encoded}`, '_blank');
};
