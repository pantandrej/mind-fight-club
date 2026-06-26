// ── Leaderboard + Club aggregation + Team Chat ────────────────
import { sb }       from './services/supabase.js';
import { getState } from './state.js';

// ── Leaderboard ───────────────────────────────────────────────
export async function loadLeaderboard(tab = 'players') {
  const listEl = document.getElementById('lb-list');
  const myRowEl = document.getElementById('lb-my-row');
  if (!listEl) return;

  listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Загружаем...</div>';

  try {
    if (tab === 'players') {
      const { data, error } = await sb.from('leaderboard_global').select('*');
      if (error) throw error;
      renderPlayerLeaderboard(data || [], listEl, myRowEl);
    } else {
      const { data, error } = await sb.from('leaderboard_clubs').select('*');
      if (error) throw error;
      renderClubLeaderboard(data || [], listEl);
    }
  } catch(e) {
    console.error('[lb]', e.message);
    listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Ошибка загрузки</div>';
  }
}

function renderPlayerLeaderboard(rows, listEl, myRowEl) {
  const { currentUser } = getState();
  let myRank = null;

  const html = rows.map(r => {
    const isMe = r.user_id === currentUser?.id;
    if (isMe) myRank = r.rank;
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`;
    return `<div class="lb-row${isMe ? ' lb-me' : ''}">
      <div class="lb-rank">${medal}</div>
      <div class="lb-info">
        <div class="lb-name">${_esc(r.display_name || 'Игрок')}</div>
        <div class="lb-city">${r.city ? _esc(r.city) : ''} ${r.streak > 2 ? '🔥' + r.streak : ''}</div>
      </div>
      <div class="lb-score">${r.xp.toLocaleString('ru')} XP</div>
    </div>`;
  }).join('');

  listEl.innerHTML = html || '<div style="text-align:center;padding:30px;color:var(--muted)">Пока никого нет</div>';

  if (myRowEl) {
    if (myRank) {
      myRowEl.style.display = 'none'; // already visible in list
    } else if (currentUser) {
      // Show current user rank outside top 100
      sb.from('profiles').select('display_name,xp,city').eq('id', currentUser.id).single().then(({data}) => {
        if (!data) return;
        myRowEl.style.display = 'flex';
        myRowEl.innerHTML = `<div class="lb-rank" style="color:var(--muted)">Вне топа</div>
          <div class="lb-info"><div class="lb-name">${_esc(data.display_name||'Вы')}</div></div>
          <div class="lb-score">${(data.xp||0).toLocaleString('ru')} XP</div>`;
      });
    }
  }
}

function renderClubLeaderboard(rows, listEl) {
  const html = rows.map(r => {
    const medal = r.rank === 1 ? '🥇' : r.rank === 2 ? '🥈' : r.rank === 3 ? '🥉' : `#${r.rank}`;
    return `<div class="lb-row">
      <div class="lb-rank">${medal}</div>
      <div class="lb-info">
        <div class="lb-name">${r.avatar_emoji || '⚡'} ${_esc(r.name || 'Клуб')}</div>
        <div class="lb-city">${r.city ? _esc(r.city) : ''} · ${r.members_count} чел.</div>
      </div>
      <div class="lb-score">${r.total_xp.toLocaleString('ru')} XP</div>
    </div>`;
  }).join('');
  listEl.innerHTML = html || '<div style="text-align:center;padding:30px;color:var(--muted)">Пока никого нет</div>';
}

// ── Club score sync ───────────────────────────────────────────
export async function syncTeamScoreAfterGame() {
  const myTeam = JSON.parse(localStorage.getItem('mfc_team') || 'null');
  if (!myTeam?.id) return;
  try {
    await sb.rpc('sync_team_score', { p_team_id: myTeam.id });
  } catch(e) {
    console.warn('[club] sync_team_score:', e.message);
  }
}
window.syncTeamScoreAfterGame = syncTeamScoreAfterGame;

// ── Team Chat ─────────────────────────────────────────────────
const STICKERS = {
  fire:    '🔥', brain:   '🧠', trophy:  '🏆', muscle: '💪',
  clap:    '👏', rocket:  '🚀', eyes:    '👀', 100:    '💯',
  dead:    '💀', diamond: '💎', crown:   '👑', goat:   '🐐',
};

let _chatTeamId   = null;
let _chatSub      = null;
let _chatMessages = [];

export async function openTeamChat(teamId) {
  _chatTeamId = teamId;
  const panel = document.getElementById('team-chat-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  await loadChatHistory();
  subscribeChatRealtime();
}

export function closeTeamChat() {
  if (_chatSub) { _chatSub.unsubscribe(); _chatSub = null; }
  const panel = document.getElementById('team-chat-panel');
  if (panel) panel.style.display = 'none';
}

async function loadChatHistory() {
  if (!_chatTeamId) return;
  const { data } = await sb.from('team_messages')
    .select('*')
    .eq('team_id', _chatTeamId)
    .order('created_at', { ascending: true })
    .limit(100);
  _chatMessages = data || [];
  renderChat();
}

function subscribeChatRealtime() {
  if (_chatSub) _chatSub.unsubscribe();
  _chatSub = sb.channel('team-chat-' + _chatTeamId)
    .on('postgres_changes', {
      event: 'INSERT', schema: 'public', table: 'team_messages',
      filter: `team_id=eq.${_chatTeamId}`
    }, payload => {
      _chatMessages.push(payload.new);
      renderChat();
    })
    .subscribe();
}

function renderChat() {
  const list = document.getElementById('chat-messages-list');
  if (!list) return;
  const { currentUser } = getState();
  list.innerHTML = _chatMessages.map(m => {
    const isMe = m.user_id === currentUser?.id;
    const time = new Date(m.created_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    if (m.msg_type === 'sticker') {
      return `<div class="chat-msg${isMe ? ' chat-me' : ''}">
        <div class="chat-bubble chat-sticker">${STICKERS[m.sticker_id] || '❓'}</div>
        <div class="chat-meta">${isMe ? '' : _esc(m.display_name) + ' · '}${time}</div>
      </div>`;
    }
    if (m.msg_type === 'system') {
      return `<div class="chat-system">${_esc(m.content)}</div>`;
    }
    return `<div class="chat-msg${isMe ? ' chat-me' : ''}">
      ${!isMe ? `<div class="chat-sender">${_esc(m.display_name)}</div>` : ''}
      <div class="chat-bubble">${_esc(m.content)}</div>
      <div class="chat-meta">${time}</div>
    </div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

export async function sendChatMessage(content) {
  const { currentUser } = getState();
  if (!currentUser || !_chatTeamId || !content?.trim()) return;
  const display_name = currentUser.user_metadata?.full_name?.split(' ')[0]
    || currentUser.email?.split('@')[0] || 'Игрок';
  await sb.from('team_messages').insert({
    team_id: _chatTeamId, user_id: currentUser.id,
    display_name, content: content.trim(), msg_type: 'text'
  });
}

export async function sendSticker(stickerId) {
  const { currentUser } = getState();
  if (!currentUser || !_chatTeamId || !STICKERS[stickerId]) return;
  const display_name = currentUser.user_metadata?.full_name?.split(' ')[0]
    || currentUser.email?.split('@')[0] || 'Игрок';
  await sb.from('team_messages').insert({
    team_id: _chatTeamId, user_id: currentUser.id,
    display_name, sticker_id: stickerId, msg_type: 'sticker'
  });
}

function _esc(s) {
  return String(s || '').replace(/[<>"'&]/g, c =>
    ({ '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;', '&':'&amp;' }[c]));
}

// Exports to window for legacy HTML onclick
window.sendChatMessage  = sendChatMessage;
window.sendSticker      = sendSticker;
window.openTeamChat     = openTeamChat;
window.closeTeamChat    = closeTeamChat;
window.loadLeaderboard  = loadLeaderboard;
