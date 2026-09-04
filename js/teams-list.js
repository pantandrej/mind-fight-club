// ── Список команд (публичный браузер) ─────────────────────────────
import { getState } from './state.js';
import { sb } from './services/supabase.js';

const SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co';
const SUPA_KEY = 'sb_publishable_lFVRCP-PPnGnNzn9G60A3A_gTy40vMs';

async function _sfetch(path) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` },
  });
  if (!r.ok) return [];
  return r.json();
}

export async function loadTeamsList() {
  const el = document.getElementById('teams-list-screen');
  if (!el) return;

  el.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--muted);font-size:14px">Загрузка...</div>`;
  window.showScreen('teams-list-screen');

  const { currentUser } = getState();

  const [teams, rankRows, profileData] = await Promise.all([
    _sfetch('teams?select=id,name,city,emoji,avatar_url&order=name.asc'),
    _sfetch('challenge_results?select=team_id,points_earned'),
    currentUser
      ? sb.from('profiles').select('team_id').eq('id', currentUser.id).maybeSingle().then(r => r.data)
      : Promise.resolve(null),
  ]);

  // Считаем суммарные очки каждой команды
  const rankData = {};
  for (const r of rankRows) {
    rankData[r.team_id] = (rankData[r.team_id] || 0) + r.points_earned;
  }

  // Сортируем по очкам
  teams.sort((a, b) => (rankData[b.id] || 0) - (rankData[a.id] || 0));

  const myTeamId = profileData?.team_id || null;
  _render(el, teams, myTeamId, rankData);
}

function _render(el, teams, myTeamId, rankData) {
  const myTeam    = myTeamId ? teams.find(t => t.id === myTeamId) : null;
  const otherTeams = myTeamId ? teams.filter(t => t.id !== myTeamId) : teams;
  const medals = ['🥇', '🥈', '🥉'];
  const globalIdxOf = t => teams.findIndex(x => x.id === t.id);

  const teamCard = (team, isMine) => {
    const idx   = globalIdxOf(team);
    const emoji = team.emoji || '🏟️';
    const pts   = rankData[team.id] || 0;

    const avatar = team.avatar_url
      ? `<img src="${_esc(team.avatar_url)}" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
      : `<span style="font-size:26px">${emoji}</span>`;

    const rankBadge = idx < 3
      ? `<div style="position:absolute;top:-4px;right:-4px;font-size:16px;line-height:1">${medals[idx]}</div>`
      : `<div style="position:absolute;top:-4px;right:-4px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;font-size:10px;font-weight:900;color:var(--muted);padding:1px 5px">#${idx + 1}</div>`;

    const highlight = isMine
      ? 'border-color:rgba(0,237,181,.5);background:rgba(0,237,181,.07);'
      : idx < 3
        ? 'border-color:rgba(240,192,64,.3);background:rgba(240,192,64,.04);'
        : '';

    return `
      <div onclick="window.loadTeamProfile?.('${team.id}')"
           style="display:flex;align-items:center;gap:14px;padding:14px 16px;background:var(--bg2);border:1px solid var(--border);border-radius:18px;cursor:pointer;${highlight}">
        <div style="position:relative;flex-shrink:0">
          <div style="width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,rgba(0,237,181,.25),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;overflow:hidden;border:2px solid ${isMine ? 'rgba(0,237,181,.5)' : 'var(--border)'}">
            ${avatar}
          </div>
          ${rankBadge}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px">
            <span style="font-size:15px;font-weight:${idx < 3 || isMine ? '900' : '800'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(team.name)}</span>
            ${isMine ? `<span style="font-size:10px;font-weight:800;background:rgba(0,237,181,.2);color:var(--accent2);border-radius:6px;padding:1px 6px;flex-shrink:0">МОЯ</span>` : ''}
          </div>
          ${team.city ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">📍 ${_esc(team.city)}</div>` : ''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          ${pts > 0
            ? `<div style="font-size:16px;font-weight:900;color:var(--gold)">${pts}</div><div style="font-size:10px;color:var(--muted);font-weight:700">очков</div>`
            : `<div style="font-size:12px;color:var(--muted)">—</div>`}
        </div>
      </div>`;
  };

  const noTeamBanner = !myTeam ? `
    <div onclick="window.showScreen?.('my-team-screen');window.loadMyTeam?.()"
         style="background:linear-gradient(135deg,rgba(0,237,181,.15),rgba(168,85,247,.1));border:1px solid rgba(0,237,181,.3);border-radius:18px;padding:20px 16px;margin-bottom:16px;cursor:pointer;display:flex;align-items:center;gap:14px">
      <div style="font-size:36px">🏟️</div>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:900;margin-bottom:4px">Вступить в команду</div>
        <div style="font-size:13px;color:var(--muted);line-height:1.4">Участвуй в рейтингах и соревнованиях вместе с командой</div>
      </div>
      <div style="font-size:20px;color:var(--accent2)">→</div>
    </div>` : '';

  const myTeamMgmtBtn = myTeam ? `
    <div onclick="window.showScreen?.('my-team-screen');window.loadMyTeam?.()"
         style="background:rgba(0,237,181,.1);border:1px solid rgba(0,237,181,.3);border-radius:14px;padding:12px 16px;margin-bottom:12px;cursor:pointer;display:flex;align-items:center;gap:10px">
      <span style="font-size:18px">⚙️</span>
      <span style="font-size:13px;font-weight:800;color:var(--accent2)">Управление моей командой</span>
      <span style="margin-left:auto;font-size:16px;color:var(--accent2)">→</span>
    </div>` : '';

  const myTeamSection = myTeam ? `
    <div style="margin-bottom:12px">
      <div style="font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1.5px;margin-bottom:8px;padding:0 4px">МОЯ КОМАНДА</div>
      ${teamCard(myTeam, true)}
    </div>` : '';

  const listSection = otherTeams.length ? `
    <div>
      <div style="font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1.5px;margin-bottom:8px;padding:0 4px;display:flex;justify-content:space-between;align-items:center">
        <span>${myTeam ? 'ДРУГИЕ КОМАНДЫ' : 'ВСЕ КОМАНДЫ'}</span>
        <span>${teams.length} команд</span>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${otherTeams.map(t => teamCard(t, false)).join('')}
      </div>
    </div>` : `<div style="padding:40px 20px;text-align:center;color:var(--muted);font-size:14px">Команд пока нет</div>`;

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
