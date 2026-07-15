// ── Leaderboard + Club aggregation + Team Chat ────────────────
import { sb }       from './services/supabase.js';
import { getState } from './state.js';

// ── Leaderboard ───────────────────────────────────────────────
export async function loadLeaderboard(tab = 'players') {
  const listEl = document.getElementById('lb-list');
  const myRowEl = document.getElementById('lb-my-row');
  if (!listEl) return;

  // Update tab button styles
  ['players','week','clubs'].forEach(t => {
    const btn = document.getElementById(`lb-tab-${t}`);
    if (btn) btn.classList.toggle('active', t === tab);
  });

  listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Загружаем...</div>';
  if (myRowEl) myRowEl.style.display = 'none';

  try {
    if (tab === 'players') {
      const { data, error } = await sb.from('leaderboard_global').select('*');
      if (error) throw error;
      renderPlayerLeaderboard(data || [], listEl, myRowEl);
    } else if (tab === 'week') {
      await renderWeekLeaderboard(listEl, myRowEl);
    } else {
      // Try leaderboard_clubs view first; fall back to direct teams query
      let rows = [];
      const { data: viewData, error: viewErr } = await sb.from('leaderboard_clubs').select('*');
      if (!viewErr && viewData) {
        rows = viewData;
      } else {
        const { data: teamsData, error: teamsErr } = await sb
          .from('teams')
          .select('id, name, emoji, city, total_neurons')
          .order('total_neurons', { ascending: false })
          .limit(50);
        if (teamsErr) throw teamsErr;
        rows = (teamsData || []).map((t, i) => ({
          rank: i + 1,
          name: t.name,
          avatar_emoji: t.emoji,
          city: t.city,
          members_count: '?',
          total_xp: t.total_neurons || 0,
        }));
      }
      renderClubLeaderboard(rows, listEl);
    }
  } catch(e) {
    console.error('[lb]', e.message);
    listEl.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)">Ошибка загрузки</div>';
  }
}

async function renderWeekLeaderboard(listEl, myRowEl) {
  const { currentUser } = getState();

  // Monday 00:00 this week
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  mon.setHours(0, 0, 0, 0);

  // Next Monday
  const nextMon = new Date(mon);
  nextMon.setDate(mon.getDate() + 7);

  // Time until reset
  const msLeft = nextMon - now;
  const daysLeft = Math.floor(msLeft / 86400000);
  const hoursLeft = Math.floor((msLeft % 86400000) / 3600000);
  const resetLabel = daysLeft > 0 ? `Сброс через ${daysLeft}д ${hoursLeft}ч` : `Сброс через ${hoursLeft}ч`;

  const { data: rows, error } = await sb
    .from('pack_results')
    .select('user_id, score')
    .gte('played_at', mon.toISOString())
    .order('score', { ascending: false })
    .limit(500);

  if (error) throw error;

  // Aggregate by user
  const agg = {};
  (rows || []).forEach(r => {
    if (!agg[r.user_id]) agg[r.user_id] = { user_id: r.user_id, score: 0 };
    agg[r.user_id].score += r.score || 0;
  });

  // Fetch profiles for top users
  const topIds = Object.keys(agg);
  if (topIds.length) {
    const { data: profiles } = await sb.from('profiles').select('id,display_name,city').in('id', topIds.slice(0, 200));
    (profiles || []).forEach(p => { if (agg[p.id]) { agg[p.id].display_name = p.display_name; agg[p.id].city = p.city; } });
  }

  const sorted = Object.values(agg).sort((a, b) => b.score - a.score);
  const myIdx = sorted.findIndex(r => r.user_id === currentUser?.id);

  const resetBanner = `<div style="font-size:11px;color:var(--muted);text-align:center;padding:8px 0 12px;border-bottom:0.5px solid var(--border);margin-bottom:4px">🔄 ${resetLabel} · Топ-3 получат бонусные нейроны</div>`;

  if (!sorted.length) {
    listEl.innerHTML = resetBanner + '<div style="text-align:center;padding:24px;color:var(--muted)">Никто ещё не играл на этой неделе</div>';
    return;
  }

  const html = sorted.slice(0, 50).map((r, i) => {
    const rank = i + 1;
    const isMe = r.user_id === currentUser?.id;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const bonusBadge = rank <= 3 ? `<span style="font-size:10px;background:rgba(240,192,64,.15);border:0.5px solid rgba(240,192,64,.3);border-radius:6px;padding:2px 6px;color:var(--gold);margin-left:6px">+${[300,150,75][rank-1]}⚡</span>` : '';
    return `<div class="lb-row${isMe ? ' lb-me' : ''}">
      <div class="lb-rank">${medal}</div>
      <div class="lb-info">
        <div class="lb-name">${_esc(r.display_name || 'Игрок')}${bonusBadge}</div>
        <div class="lb-city">${r.city ? _esc(r.city) : ''}</div>
      </div>
      <div class="lb-score">${r.score.toLocaleString('ru')} ⚡</div>
    </div>`;
  }).join('');

  listEl.innerHTML = resetBanner + html;

  // My position if outside top 50
  if (myRowEl && myIdx >= 50 && currentUser) {
    const me = sorted[myIdx];
    myRowEl.style.display = 'flex';
    myRowEl.innerHTML = `<div class="lb-rank" style="color:var(--muted)">#${myIdx+1}</div>
      <div class="lb-info"><div class="lb-name">Вы</div></div>
      <div class="lb-score">${me.score.toLocaleString('ru')} ⚡</div>`;
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
