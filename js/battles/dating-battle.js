// ── BFC Match — Blind Consensus Battle ───────────────────────────
import { sb } from '../services/supabase.js';
import { getState } from '../state.js';
import { track } from '../services/analytics.js';

// ── State ─────────────────────────────────────────────────────────
let _room        = null;   // current room row
let _role        = null;   // 'p1' | 'p2'
let _channel     = null;   // Supabase Realtime channel
let _myChoice    = null;   // current pending choice
let _oppChoice   = null;
let _question    = null;   // current question object
let _revealShown = false;

const TOTAL_Q    = 5;

// ── Entry point ───────────────────────────────────────────────────
let _searchTimeout = null;

export async function startDatingBattle() {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.('Войдите для BFC Match'); return; }

  showScreen('dating');
  _setState('searching');
  track('dating_enter_queue', {});

  const { data, error } = await sb.rpc('enter_dating_queue');
  if (error || !data?.ok) {
    _setState('error', error?.message || data?.reason);
    return;
  }

  _role   = data.role;
  await _subscribeRoom(data.room_id);

  if (data.status === 'playing') {
    if (_searchTimeout) { clearTimeout(_searchTimeout); _searchTimeout = null; }
    await _loadRoom();
  } else {
    // Waiting for opponent — show cancel button + timeout after 60s
    _renderSearchingUI(data.room_id);
    _searchTimeout = setTimeout(() => {
      window.leaveDatingRoom?.();
      window.toast?.('Соперник не найден — попробуй позже');
      showScreen('home');
    }, 60000);
  }
}

function _renderSearchingUI(roomId) {
  const wrap = document.getElementById('dt-searching');
  if (!wrap) return;
  wrap.style.display = 'block';
  // Add cancel button if not already there
  if (!document.getElementById('dt-cancel-search')) {
    const btn = document.createElement('button');
    btn.id = 'dt-cancel-search';
    btn.style.cssText = 'margin-top:20px;background:none;border:0.5px solid var(--border);border-radius:12px;padding:11px 24px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit';
    btn.textContent = 'Отменить поиск';
    btn.onclick = () => {
      if (_searchTimeout) { clearTimeout(_searchTimeout); _searchTimeout = null; }
      window.leaveDatingRoom?.();
      showScreen('home');
    };
    wrap.appendChild(btn);
  }
}

// ── Realtime subscription ─────────────────────────────────────────
async function _subscribeRoom(roomId) {
  if (_channel) { await _channel.unsubscribe(); _channel = null; }

  _channel = sb.channel(`dating:${roomId}`, {
    config: { broadcast: { self: false }, presence: { key: getState().currentUser?.id } }
  });

  // Broadcast: choice updates + chat
  _channel.on('broadcast', { event: 'choice' }, ({ payload }) => _onOppChoice(payload));
  _channel.on('broadcast', { event: 'chat'   }, ({ payload }) => _appendChat(payload, false));

  // DB changes: room status, likes, matched
  _channel.on('postgres_changes',
    { event: 'UPDATE', schema: 'public', table: 'dating_rooms', filter: `id=eq.${roomId}` },
    ({ new: row }) => _onRoomUpdate(row)
  );

  await _channel.subscribe();
}

// ── Load current room + question ──────────────────────────────────
async function _loadRoom() {
  const { data: room } = await sb
    .from('dating_rooms')
    .select('*')
    .eq('id', _room?.id || await _getMyRoomId())
    .maybeSingle();

  if (!room) return;
  _room = room;

  if (room.status === 'searching') { _setState('searching'); return; }
  if (room.status === 'game_over' || room.status === 'matched' || room.status === 'closed') {
    _showPostGame(room); return;
  }

  // Load question
  if (room.current_question_id) {
    const { data: q } = await sb
      .from('questions')
      .select('id,q,a,correct_index,category')
      .eq('id', room.current_question_id)
      .maybeSingle();
    _question = q;
  }

  _setState('playing');
  _renderQuestion();
}

async function _getMyRoomId() {
  const uid = getState().currentUser?.id;
  const { data } = await sb
    .from('dating_rooms')
    .select('id')
    .or(`player_1_id.eq.${uid},player_2_id.eq.${uid}`)
    .in('status', ['searching','playing'])
    .maybeSingle();
  return data?.id;
}

// ── Room update handler ───────────────────────────────────────────
function _onRoomUpdate(row) {
  _room = row;

  if (row.status === 'searching') { _setState('searching'); return; }

  if (row.status === 'playing') {
    // New question pushed by DB
    if (row.current_question_id !== _question?.id) {
      _loadRoom();
    }
    // Check consensus: both chose same answer
    const myChoice  = _role === 'p1' ? row.p1_current_choice : row.p2_current_choice;
    const oppChoice = _role === 'p1' ? row.p2_current_choice : row.p1_current_choice;
    _oppChoice = oppChoice;
    _updateOppIndicator();

    if (myChoice && oppChoice && myChoice === oppChoice && !row.consensus_locked) {
      _onConsensus(myChoice);
    }
    return;
  }

  if (row.status === 'game_over' || row.status === 'matched') {
    _showPostGame(row);
  }
}

// ── Choice handling ───────────────────────────────────────────────
export async function datingPickChoice(idx) {
  if (!_room || !_question) return;
  const letter = String.fromCharCode(65 + idx); // 0→A, 1→B...
  if (_myChoice === letter) return; // no change

  _myChoice = letter;
  _highlightMyChoice(idx);

  // Broadcast to opponent (non-blocking)
  _channel?.send({ type: 'broadcast', event: 'choice', payload: { letter, name: _blindName('me') } });

  // Write choice to DB via update — DB trigger checks for consensus
  const col = _role === 'p1' ? 'p1_current_choice' : 'p2_current_choice';
  await sb.from('dating_rooms').update({ [col]: letter }).eq('id', _room.id);
}

function _onOppChoice({ letter }) {
  _oppChoice = letter;
  _updateOppIndicator();

  // Check local consensus
  if (_myChoice && _myChoice === letter) {
    _onConsensus(letter);
  }
}

// ── Consensus: both chose same answer ────────────────────────────
async function _onConsensus(letter) {
  if (!_question || !_room) return;
  const correctLetter = String.fromCharCode(65 + _question.correct_index);
  const isRight       = letter === correctLetter;

  _showConsensusFlash(isRight);

  if (!isRight) {
    // Game over immediately
    await sb.from('dating_rooms').update({ status: 'game_over' }).eq('id', _room.id);
    return;
  }

  // Correct — advance or finish
  const nextIdx = (_room.question_index || 0) + 1;
  if (nextIdx >= TOTAL_Q) {
    await sb.from('dating_rooms').update({ status: 'game_over', question_index: nextIdx })
      .eq('id', _room.id);
  } else {
    const nextQId = _room.question_ids?.[nextIdx] || null;
    await sb.from('dating_rooms').update({
      question_index:      nextIdx,
      current_question_id: nextQId,
      p1_current_choice:   null,
      p2_current_choice:   null,
      consensus_locked:    false,
    }).eq('id', _room.id);
  }

  _myChoice  = null;
  _oppChoice = null;
}

// ── Post-game: Reveal + Like ──────────────────────────────────────
async function _showPostGame(room) {
  if (_revealShown) return;
  _revealShown = true;
  track('dating_post_game', { room_id: room.id, status: room.status });

  const myLiked  = _role === 'p1' ? room.p1_liked : room.p2_liked;
  const oppLiked = _role === 'p1' ? room.p2_liked : room.p1_liked;

  if (room.status === 'matched') {
    _showMatch(room); return;
  }

  _setState('post_game');
  const el = document.getElementById('dt-postgame');
  if (!el) return;

  el.innerHTML = `
    <div style="text-align:center;padding:20px 0">
      <div style="font-size:52px;margin-bottom:8px">${room.status === 'game_over' ? '💥' : '🎉'}</div>
      <div style="font-size:20px;font-weight:900;margin-bottom:6px">
        ${room.status === 'game_over' ? 'Игра окончена' : 'Раунд завершён!'}
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:28px">
        Вы ответили синхронно на ${room.question_index || 0} из ${TOTAL_Q} вопросов
      </div>
      ${myLiked === null ? `
        <div style="font-size:14px;font-weight:700;margin-bottom:14px">Хочешь встретиться снова?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:320px;margin:0 auto">
          <button onclick="window.datingLike(true)"
            style="background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.4);border-radius:16px;padding:16px 8px;font-size:22px;cursor:pointer">
            👍<div style="font-size:11px;font-weight:800;color:#4ade80;margin-top:4px">Match Mind</div>
          </button>
          <button onclick="window.datingLike(false)"
            style="background:rgba(255,255,255,.05);border:0.5px solid var(--border);border-radius:16px;padding:16px 8px;font-size:22px;cursor:pointer">
            ✕<div style="font-size:11px;font-weight:700;color:var(--muted);margin-top:4px">Пропустить</div>
          </button>
        </div>` : `
        <div style="font-size:13px;color:var(--muted)">
          ${myLiked ? '👍 Ты поставил лайк · ждём ответа партнёра...' : '✕ Ты пропустил · ждём ответа партнёра...'}
        </div>`}
    </div>`;

  // Watch for partner's like via room subscription (already active)
}

function _showMatch(room) {
  _setState('matched');
  const el = document.getElementById('dt-postgame');
  if (!el) return;

  el.innerHTML = `
    <div style="text-align:center;padding:20px 0" id="dt-match-reveal">
      <div style="font-size:64px;animation:bounce .6s ease infinite alternate;margin-bottom:8px">💎</div>
      <div style="font-size:24px;font-weight:900;background:linear-gradient(135deg,#a855f7,#6c63ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:6px">Mind Match!</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:24px">Вы мыслите одинаково</div>
      <button onclick="window.datingStartDuoClub('${room.id}')"
        style="width:100%;background:linear-gradient(135deg,var(--accent),#a855f7);border:none;border-radius:16px;padding:16px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">
        💎 Создать Дуо-клуб вместе
      </button>
      <button onclick="showScreen('home')"
        style="width:100%;background:transparent;border:0.5px solid var(--border);border-radius:16px;padding:13px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">
        На главную
      </button>
    </div>`;
}

// ── Like action ───────────────────────────────────────────────────
window.datingLike = async function(liked) {
  if (!_room) return;
  const btns = document.querySelectorAll('#dt-postgame button');
  btns.forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

  const { data } = await sb.rpc('submit_dating_like', { p_room_id: _room.id, p_liked: liked });
  track('dating_like', { liked, room_id: _room.id });

  if (data?.matched) {
    _showMatch(_room);
  } else {
    const msg = liked
      ? '👍 Лайк отправлен · ждём партнёра...'
      : '✕ Пропущено · ждём партнёра...';
    const el = document.getElementById('dt-postgame');
    if (el) el.querySelector('div[style*="grid"]')?.replaceWith(
      Object.assign(document.createElement('div'), {
        style: 'font-size:13px;color:var(--muted);text-align:center;padding:10px 0',
        textContent: msg
      })
    );
  }
};

window.datingStartDuoClub = function(roomId) {
  // Pre-fill club creation form and navigate
  const nameEl = document.getElementById('new-club-name');
  if (nameEl) nameEl.value = '💎 Дуо-клуб';
  window._duoRoomId = roomId;
  showScreen('club');
  track('dating_create_duo_club', { room_id: roomId });
};

// ── Chat ──────────────────────────────────────────────────────────
export function datingSendChat(text) {
  if (!text?.trim() || !_channel) return;
  const uid  = getState().currentUser?.id;
  const name = _blindName('me');
  _channel.send({ type: 'broadcast', event: 'chat', payload: { text, name, uid } });
  _appendChat({ text, name, uid }, true);
}

function _appendChat({ text, name }, isMine) {
  const box = document.getElementById('dt-chat-messages');
  if (!box) return;
  const div = document.createElement('div');
  div.style.cssText = `margin-bottom:8px;display:flex;${isMine ? 'justify-content:flex-end' : 'justify-content:flex-start'}`;
  div.innerHTML = `
    <div style="max-width:70%;background:${isMine ? 'var(--accent)' : 'var(--bg2)'};border-radius:${isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};padding:8px 12px">
      ${!isMine ? `<div style="font-size:10px;color:var(--muted);margin-bottom:3px">${name}</div>` : ''}
      <div style="font-size:13px;line-height:1.4">${_esc(text)}</div>
    </div>`;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

// ── Rendering helpers ─────────────────────────────────────────────
function _renderQuestion() {
  if (!_question) return;
  const qnum  = (_room?.question_index || 0) + 1;
  const qEl   = document.getElementById('dt-question-text');
  const optsEl = document.getElementById('dt-options');
  const progEl = document.getElementById('dt-progress');

  if (progEl) progEl.textContent = `${qnum} / ${TOTAL_Q}`;
  if (qEl)   qEl.textContent = _question.q || _question.question_text || '';
  if (!optsEl) return;

  optsEl.innerHTML = (_question.a || []).map((opt, i) => `
    <button id="dt-opt-${i}" onclick="window.datingPickChoice(${i})"
      style="width:100%;text-align:left;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:13px 14px;font-size:14px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;margin-bottom:8px;transition:all .2s;display:flex;align-items:center;gap:10px">
      <span style="background:rgba(108,99,255,.2);border-radius:8px;padding:2px 8px;font-size:12px;font-weight:800;color:var(--accent2);flex-shrink:0">${String.fromCharCode(65+i)}</span>
      <span>${_esc(opt)}</span>
    </button>`).join('');

  // Reset indicators
  _myChoice = null; _oppChoice = null;
  _updateOppIndicator();
}

function _highlightMyChoice(idx) {
  document.querySelectorAll('[id^="dt-opt-"]').forEach((b, i) => {
    b.style.background  = i === idx ? 'rgba(108,99,255,.25)' : 'var(--bg2)';
    b.style.borderColor = i === idx ? 'var(--accent)' : 'var(--border)';
    b.style.fontWeight  = i === idx ? '800' : '600';
  });
}

function _updateOppIndicator() {
  const el = document.getElementById('dt-opp-indicator');
  if (!el) return;
  if (!_oppChoice) { el.style.display = 'none'; return; }
  el.style.display = '';
  el.textContent = `🤔 Партнёр выбрал ${_oppChoice}...`;
}

function _showConsensusFlash(isRight) {
  const el = document.getElementById('dt-consensus-flash');
  if (!el) return;
  el.textContent = isRight ? '✅ Синхронно! Верно!' : '💥 Синхронно, но неверно!';
  el.style.cssText = `display:block;text-align:center;font-size:16px;font-weight:900;color:${isRight ? '#4ade80' : '#f87171'};padding:12px;animation:fadeIn .3s ease`;
  setTimeout(() => { el.style.display = 'none'; }, 2000);
}

function _setState(state, msg) {
  ['dt-searching','dt-playing','dt-postgame','dt-error'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });
  const target = {
    searching: 'dt-searching',
    playing:   'dt-playing',
    post_game: 'dt-postgame',
    matched:   'dt-postgame',
    error:     'dt-error',
  }[state];
  if (target) {
    const el = document.getElementById(target);
    if (el) el.style.display = '';
  }
  if (state === 'error' && msg) {
    const el = document.getElementById('dt-error');
    if (el) el.textContent = 'Ошибка: ' + msg;
  }
}

function _blindName(who) {
  return who === 'me'
    ? (_role === 'p1' ? 'Интеллект Игрок 1' : 'Интеллект Игрок 2')
    : (_role === 'p1' ? 'Интеллект Игрок 2' : 'Интеллект Игрок 1');
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Leave room ────────────────────────────────────────────────────
export async function leaveDatingRoom() {
  if (_searchTimeout) { clearTimeout(_searchTimeout); _searchTimeout = null; }
  if (_channel) { await _channel.unsubscribe(); _channel = null; }
  if (_room) {
    await sb.from('dating_rooms').update({ status: 'closed' }).eq('id', _room.id);
  }
  _room = null; _role = null; _myChoice = null; _oppChoice = null;
  _question = null; _revealShown = false;
}

// ── Window exports ─────────────────────────────────────────────────
window.startDatingBattle  = startDatingBattle;
window.datingPickChoice   = datingPickChoice;
window.datingSendChat     = datingSendChat;
window.leaveDatingRoom    = leaveDatingRoom;
