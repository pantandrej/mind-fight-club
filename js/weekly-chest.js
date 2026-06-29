// ── Weekly Club Chest ─────────────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';
import { track } from './services/analytics.js';

// ── Load weekly leaderboard for club screen ───────────────────────
export async function loadWeeklyChest() {
  const { currentUser } = getState();
  if (!currentUser) return;

  const { data: rows, error } = await sb.rpc('get_weekly_leaderboard', { p_limit: 5 });
  if (error || !rows?.length) return;

  const wrap = document.getElementById('weekly-chest-wrap');
  const lb   = document.getElementById('wc-leaderboard');
  if (!wrap || !lb) return;

  wrap.style.display = 'block';

  // My club's weekly neurons
  const myTeamRaw = localStorage.getItem('mfc_team');
  const myTeamId  = myTeamRaw ? (JSON.parse(myTeamRaw)?.id || myTeamRaw) : null;
  const myRow     = rows.find(r => r.club_id === myTeamId);
  const myEl     = document.getElementById('wc-my-weekly');
  if (myEl) myEl.textContent = myRow?.weekly_neurons ?? 0;

  const medals = ['🥇', '🥈', '🥉', '4', '5'];
  lb.innerHTML = rows.slice(0, 3).map((r, i) => {
    const bonus = i === 0 ? '+500' : i === 1 ? '+250' : '+100';
    const isMe  = r.club_id === myTeamId;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0${isMe ? ';background:rgba(240,192,64,.08);border-radius:8px;padding:5px 8px' : ''}">
        <div style="font-size:16px;width:22px;text-align:center;flex-shrink:0">${medals[i]}</div>
        <div style="flex:1;font-size:12px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(r.name)}</div>
        <div style="font-size:11px;color:var(--muted);flex-shrink:0">${r.weekly_neurons} ⚡</div>
        <div style="font-size:10px;font-weight:800;color:var(--gold);flex-shrink:0">${bonus}</div>
      </div>`;
  }).join('');

  // Days until Sunday
  const now  = new Date();
  const days = (7 - now.getUTCDay()) % 7 || 7;
  const hint = document.createElement('div');
  hint.style.cssText = 'font-size:10px;color:var(--muted);margin-top:6px;text-align:center';
  hint.textContent   = `Раздача через ${days} дн. · Играй, чтобы поднять клуб в топ`;
  lb.appendChild(hint);
}

// ── Award weekly neurons to club on quiz complete ─────────────────
export async function awardWeeklyNeurons(amount = 10) {
  const myTeamRaw = localStorage.getItem('mfc_team');
  const teamId    = myTeamRaw ? (JSON.parse(myTeamRaw)?.id || null) : null;
  if (!teamId) return;
  await sb.rpc('add_club_weekly_neurons', { p_club_id: teamId, p_amount: amount }).then(null, () => {});
}

function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.loadWeeklyChest    = loadWeeklyChest;
window.awardWeeklyNeurons = awardWeeklyNeurons;
