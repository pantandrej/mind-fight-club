// ── Публичный профиль команды ─────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

let _currentTeamId = null;

export async function loadTeamProfile(teamId) {
  _currentTeamId = teamId;
  const el = document.getElementById('team-profile-screen');
  if (!el) return;

  el.innerHTML = `<div style="padding:60px;text-align:center;color:var(--muted)">Загрузка...</div>`;
  window.showScreen('team-profile');

  const [teamRes, membersRes] = await Promise.all([
    sb.from('teams').select('id,name,city,motto,banner_url,avatar_url,emoji').eq('id', teamId).single(),
    sb.from('profiles').select('id,display_name,neurons,avatar_url').eq('team_id', teamId).order('neurons', { ascending: false }),
  ]);

  const team    = teamRes.data;
  const members = membersRes.data || [];

  if (!team) {
    el.innerHTML = `<div style="padding:60px;text-align:center;color:var(--muted)">Команда не найдена</div>`;
    return;
  }

  const [barRank, onlineRank, weekStart] = [
    await _getTeamRank(teamId, 'bar_quiz'),
    await _getTeamRank(teamId, 'online_quiz'),
    _getWeekStart(),
  ];
  const { data: brainRow } = await sb.from('team_weekly_brain_fights')
    .select('points').eq('team_id', teamId).eq('week_start', weekStart).maybeSingle();
  const brainPoints = brainRow?.points ?? 0;

  const { currentUser } = getState();
  const isMyTeam = members.some(m => m.id === currentUser?.id);

  _renderTeamProfile(el, { team, members, barRank, onlineRank, brainPoints, isMyTeam });
}

async function _getTeamRank(teamId, type) {
  const { data } = await sb.from('challenge_results')
    .select('team_id, points_earned').eq('challenge_type', type);
  if (!data) return null;
  const totals = {};
  for (const r of data) totals[r.team_id] = (totals[r.team_id] || 0) + r.points_earned;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const idx = sorted.findIndex(([id]) => id === teamId);
  return idx === -1 ? null : { rank: idx + 1, points: totals[teamId], total: sorted.length };
}

function _getWeekStart() {
  const d = new Date();
  const diff = (d.getUTCDay() === 0 ? -6 : 1 - d.getUTCDay());
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return mon.toISOString().slice(0, 10);
}

function _renderTeamProfile(el, { team, members, barRank, onlineRank, brainPoints, isMyTeam }) {
  const emoji  = team.emoji || '🏟️';
  const medals = ['👑', '🥈', '🥉'];

  const rankCard = (label, r, icon) => r
    ? `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center;flex:1">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">${icon} ${label}</div>
        <div style="font-size:28px;font-weight:900;color:var(--gold)">#${r.rank}</div>
        <div style="font-size:11px;color:var(--muted)">из ${r.total} команд</div>
        <div style="font-size:12px;color:var(--accent2);margin-top:4px">${r.points} очков</div>
      </div>`
    : `<div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center;flex:1">
        <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">${icon} ${label}</div>
        <div style="font-size:24px;font-weight:900;color:var(--muted)">—</div>
        <div style="font-size:11px;color:var(--muted)">нет данных</div>
      </div>`;

  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(10,10,20,.85)">
      <button onclick="history.back()" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">${_esc(team.name)}</div>
      ${isMyTeam ? `<button onclick="window.showScreen('my-team')" style="background:none;border:none;color:var(--accent2);font-size:12px;font-weight:700;cursor:pointer">Моя</button>` : `<div style="width:40px"></div>`}
    </div>

    <!-- Баннер -->
    <div style="position:relative;height:180px;overflow:hidden;background:linear-gradient(135deg,rgba(108,99,255,.25),rgba(168,85,247,.2))">
      ${team.banner_url
        ? `<img src="${_esc(team.banner_url)}" style="width:100%;height:100%;object-fit:cover">`
        : `<div style="width:100%;height:100%;background:linear-gradient(135deg,rgba(108,99,255,.3),rgba(168,85,247,.2),rgba(30,30,60,.4))"></div>`}
      <!-- Аватар поверх баннера -->
      <div style="position:absolute;bottom:-32px;left:50%;transform:translateX(-50%)">
        <div style="width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));border:3px solid var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;font-size:32px">
          ${team.avatar_url
            ? `<img src="${_esc(team.avatar_url)}" style="width:100%;height:100%;object-fit:cover">`
            : emoji}
        </div>
      </div>
    </div>

    <div style="padding:48px 16px 16px;display:flex;flex-direction:column;gap:16px">

      <!-- Название и мотто -->
      <div style="text-align:center">
        <div style="font-size:22px;font-weight:900;margin-bottom:4px">${_esc(team.name)}</div>
        ${team.city ? `<div style="font-size:13px;color:var(--muted);margin-bottom:6px">📍 ${_esc(team.city)}</div>` : ''}
        ${team.motto ? `<div style="font-size:13px;color:var(--accent2);font-style:italic;font-weight:600">"${_esc(team.motto)}"</div>` : ''}
        <div style="margin-top:10px;font-size:12px;color:var(--muted)">${members.length} участников</div>
      </div>

      <!-- Рейтинг -->
      <div style="display:flex;gap:10px">
        ${rankCard('БАРНЫЙ', barRank, '🍺')}
        ${rankCard('ОНЛАЙН', onlineRank, '🌐')}
      </div>

      <!-- Brain Fights -->
      ${brainPoints > 0 ? `
        <div style="background:linear-gradient(135deg,rgba(60,200,100,.08),rgba(0,180,80,.05));border:1px solid rgba(60,200,100,.25);border-radius:16px;padding:14px;display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:13px;font-weight:800">🧠 Brain Fights</div>
            <div style="font-size:11px;color:var(--muted)">Очки за текущую неделю</div>
          </div>
          <div style="font-size:24px;font-weight:900;color:#3cc864">${brainPoints}</div>
        </div>` : ''}

      <!-- Состав -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Состав · ${members.length} игроков</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${members.map((m, i) => `
            <div style="display:flex;align-items:center;gap:12px;background:${i < 3 ? 'rgba(108,99,255,.08)' : 'var(--bg2)'};border:1px solid ${i < 3 ? 'rgba(108,99,255,.25)' : 'var(--border)'};border-radius:14px;padding:12px">
              <div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;overflow:hidden">
                ${m.avatar_url ? `<img src="${m.avatar_url}" style="width:100%;height:100%;object-fit:cover">` : '🧠'}
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:5px">
                  ${i < 3 ? `<span style="font-size:14px">${medals[i]}</span>` : ''}
                  <span style="font-size:14px;font-weight:${i < 3 ? '900' : '700'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(m.display_name || 'Игрок')}</span>
                </div>
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:15px;font-weight:900;color:${i < 3 ? 'var(--gold)' : 'var(--text)'}">${m.neurons || 0}</div>
                <div style="font-size:10px;color:var(--muted)">⚡</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <div style="height:24px"></div>
    </div>`;
}

function _esc(s) {
  return String(s || '').replace(/[<>"'&]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
}

window.loadTeamProfile = loadTeamProfile;
