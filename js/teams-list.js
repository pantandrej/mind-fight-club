// ── Список команд (публичный браузер) ─────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

export async function loadTeamsList() {
  const el = document.getElementById('teams-list-screen');
  if (!el) return;

  el.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--muted);font-size:14px">Загрузка...</div>`;
  window.showScreen('teams-list-screen');

  const { currentUser } = getState();

  // Грузим всё параллельно
  const [teamsRes, profileRes, rankData] = await Promise.all([
    sb.from('teams')
      .select('id,name,city,emoji,avatar_url,banner_url,score')
      .order('score', { ascending: false }),
    currentUser
      ? sb.from('profiles').select('team_id').eq('id', currentUser.id).maybeSingle()
      : Promise.resolve({ data: null }),
    _getAllRanks(),
  ]);

  const teams   = teamsRes.data || [];
  const myTeamId = profileRes?.data?.team_id || null;

  _render(el, teams, myTeamId, rankData);
}

async function _getAllRanks() {
  const { data } = await sb.from('challenge_results')
    .select('team_id,points_earned,challenge_type');
  if (!data) return {};
  const totals = {};
  for (const r of data) {
    if (!totals[r.team_id]) totals[r.team_id] = 0;
    totals[r.team_id] += r.points_earned;
  }
  return totals;
}

function _render(el, teams, myTeamId, rankData) {
  const myTeam = myTeamId ? teams.find(t => t.id === myTeamId) : null;
  const otherTeams = myTeamId ? teams.filter(t => t.id !== myTeamId) : teams;

  const medals = ['🥇', '🥈', '🥉'];

  const teamCard = (team, globalIdx, isMine) => {
    const emoji = team.emoji || '🏟️';
    const pts   = rankData[team.id] || 0;
    const score = team.score || 0;

    const avatar = team.avatar_url
      ? `<img src="${_esc(team.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<span style="font-size:26px">${emoji}</span>`;

    const medal  = globalIdx < 3 ? medals[globalIdx] : null;
    const rankBadge = medal
      ? `<div style="position:absolute;top:-4px;right:-4px;font-size:16px;line-height:1">${medal}</div>`
      : `<div style="position:absolute;top:-4px;right:-4px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;font-size:10px;font-weight:900;color:var(--muted);padding:1px 5px">#${globalIdx + 1}</div>`;

    const highlight = isMine
      ? 'border-color:rgba(108,99,255,.5);background:rgba(108,99,255,.07)'
      : globalIdx < 3
        ? 'border-color:rgba(240,192,64,.3);background:rgba(240,192,64,.04)'
        : '';

    return `
      <div onclick="window.loadTeamProfile?.('${team.id}')"
           style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:18px;cursor:pointer;transition:opacity .15s;${highlight}">
        <div style="position:relative;flex-shrink:0">
          <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,rgba(108,99,255,.25),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid ${isMine ? 'rgba(108,99,255,.5)' : 'var(--border)'}">
            ${avatar}
          </div>
          ${rankBadge}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:15px;font-weight:${globalIdx < 3 || isMine ? '900' : '800'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(team.name)}</span>
            ${isMine ? `<span style="font-size:10px;font-weight:800;background:rgba(108,99,255,.2);color:var(--accent2);border-radius:6px;padding:1px 6px;flex-shrink:0">МОЯ</span>` : ''}
          </div>
          ${team.city ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">📍 ${_esc(team.city)}</div>` : ''}
          ${pts > 0 ? `<div style="font-size:11px;color:var(--muted);margin-top:1px">${pts} очков в рейтинге</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:18px;font-weight:900;color:var(--gold)">${score}</div>
          <div style="font-size:10px;color:var(--muted);font-weight:700">нейроны</div>
        </div>
      </div>`;
  };

  // Глобальный индекс с учётом того, что moя команда на месте в общем ранге
  const allSorted = [...teams]; // уже отсортированы по score
  const globalIdxOf = t => allSorted.findIndex(x => x.id === t.id);

  const myTeamSection = myTeam ? `
    <div style="margin-bottom:8px">
      <div style="font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1.5px;margin-bottom:8px;padding:0 4px">МОЯ КОМАНДА</div>
      ${teamCard(myTeam, globalIdxOf(myTeam), true)}
    </div>` : '';

  const listSection = otherTeams.length ? `
    <div>
      <div style="font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1.5px;margin-bottom:8px;padding:0 4px;display:flex;justify-content:space-between;align-items:center">
        <span>${myTeam ? 'ДРУГИЕ КОМАНДЫ' : 'ВСЕ КОМАНДЫ'}</span>
        <span>${teams.length} команд</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${otherTeams.map(t => teamCard(t, globalIdxOf(t), false)).join('')}
      </div>
    </div>` : '';

  const noTeamBanner = !myTeam ? `
    <div onclick="window.showScreen?.('my-team-screen');window.loadMyTeam?.()"
         style="background:linear-gradient(135deg,rgba(108,99,255,.15),rgba(168,85,247,.1));border:1px solid rgba(108,99,255,.3);border-radius:18px;padding:20px 16px;margin-bottom:16px;cursor:pointer;display:flex;align-items:center;gap:14px">
      <div style="font-size:36px">🏟️</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:900;margin-bottom:4px">Вступить в команду</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.4">Участвуй в рейтингах и соревнованиях вместе с командой</div>
      </div>
      <div style="font-size:20px;color:var(--accent2)">→</div>
    </div>` : '';

  const myTeamMgmtBtn = myTeam ? `
    <div onclick="window.showScreen?.('my-team-screen');window.loadMyTeam?.()"
         style="background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:12px 16px;margin-bottom:16px;cursor:pointer;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">⚙️</span>
      <span style="font-size:13px;font-weight:800;color:var(--accent2)">Управление моей командой</span>
      <span style="margin-left:auto;font-size:16px;color:var(--accent2)">→</span>
    </div>` : '';

  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(var(--bg-rgb,10,10,20),.88);border-bottom:0.5px solid var(--border)">
      <div style="font-size:17px;font-weight:900">🏟️ Команды</div>
      <div style="font-size:12px;color:var(--muted);font-weight:700">${teams.length} команд</div>
    </div>
    <div style="padding:16px;display:flex;flex-direction:column;gap:0;padding-bottom:80px">
      ${noTeamBanner}
      ${myTeamMgmtBtn}
      ${myTeamSection}
      ${listSection}
    </div>`;
}

function _esc(s) {
  return String(s || '').replace(/[<>"'&]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
}

window.loadTeamsList = loadTeamsList;
