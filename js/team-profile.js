// ── Публичный профиль команды ─────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

const SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co';
const SUPA_KEY = 'sb_publishable_lFVRCP-PPnGnNzn9G60A3A_gTy40vMs';

export async function loadTeamProfile(teamId) {
  const el = document.getElementById('team-profile-screen');
  if (!el) return;

  el.innerHTML = `<div style="padding:80px 20px;text-align:center;color:var(--muted)">Загрузка...</div>`;
  window.showScreen('team-profile-screen');

  // Прямые запросы — без Vercel proxy
  const [teamRes, membersRes, rankRes, brainRes] = await Promise.all([
    fetch(`${SUPA_URL}/rest/v1/teams?id=eq.${teamId}&select=id,name,city,motto,banner_url,avatar_url,emoji`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    }).then(r => r.json()),
    fetch(`${SUPA_URL}/rest/v1/profiles?team_id=eq.${teamId}&select=id,display_name,neurons,avatar_url&order=neurons.desc`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    }).then(r => r.json()),
    fetch(`${SUPA_URL}/rest/v1/challenge_results?select=team_id,points_earned,challenge_type`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    }).then(r => r.json()),
    fetch(`${SUPA_URL}/rest/v1/team_weekly_brain_fights?team_id=eq.${teamId}&week_start=eq.${_getWeekStart()}&select=points`, {
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
    }).then(r => r.json()),
  ]);

  const team    = teamRes?.[0];
  const members = Array.isArray(membersRes) ? membersRes : [];

  if (!team) {
    el.innerHTML = `<div style="padding:80px 20px;text-align:center;color:var(--muted)">Команда не найдена</div>`;
    return;
  }

  // Считаем ранги из challenge_results
  const barRank    = _calcRank(rankRes, teamId, 'bar_quiz');
  const onlineRank = _calcRank(rankRes, teamId, 'online_quiz');
  const totalPts   = _calcTotal(rankRes, teamId);
  const brainPoints = brainRes?.[0]?.points ?? 0;

  const { currentUser } = getState();
  const isMyTeam = members.some(m => m.id === currentUser?.id);

  _render(el, { team, members, barRank, onlineRank, totalPts, brainPoints, isMyTeam });
}

function _calcRank(rows, teamId, type) {
  if (!Array.isArray(rows)) return null;
  const filtered = rows.filter(r => r.challenge_type === type);
  const totals = {};
  for (const r of filtered) totals[r.team_id] = (totals[r.team_id] || 0) + r.points_earned;
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const idx = sorted.findIndex(([id]) => id === teamId);
  return idx === -1 ? null : { rank: idx + 1, points: totals[teamId], total: sorted.length };
}

function _calcTotal(rows, teamId) {
  if (!Array.isArray(rows)) return 0;
  return rows.filter(r => r.team_id === teamId).reduce((s, r) => s + r.points_earned, 0);
}

function _getWeekStart() {
  const d = new Date();
  const diff = (d.getUTCDay() === 0 ? -6 : 1 - d.getUTCDay());
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return mon.toISOString().slice(0, 10);
}

function _render(el, { team, members, barRank, onlineRank, totalPts, brainPoints, isMyTeam }) {
  const emoji  = team.emoji || '🏟️';
  const medals = ['👑', '🥈', '🥉'];
  const totalNeurons = members.reduce((s, m) => s + (m.neurons || 0), 0);

  const avatar = team.avatar_url
    ? `<img src="${_esc(team.avatar_url)}" style="width:100%;height:100%;object-fit:cover">`
    : `<span style="font-size:38px">${emoji}</span>`;

  // ── Баннер + аватар ────────────────────────────────────────────
  const bannerBg = team.banner_url
    ? `background:url('${_esc(team.banner_url)}') center/cover no-repeat`
    : `background:linear-gradient(135deg,var(--accent) 0%,#a78bfa 50%,#ec4899 100%)`;

  // ── Статы ──────────────────────────────────────────────────────
  const statPill = (icon, val, label, color = 'var(--text)') => `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:16px 12px;text-align:center;flex:1;min-width:0">
      <div style="font-size:20px;margin-bottom:4px">${icon}</div>
      <div style="font-size:22px;font-weight:900;color:${color};line-height:1">${val}</div>
      <div style="font-size:10px;color:var(--muted);font-weight:700;margin-top:4px;text-transform:uppercase;letter-spacing:.04em">${label}</div>
    </div>`;

  const rankVal = (r) => r ? `#${r.rank}` : '—';
  const rankColor = (r) => r?.rank === 1 ? 'var(--gold)' : r?.rank <= 3 ? '#c0c0c0' : 'var(--text)';

  // ── Участники ──────────────────────────────────────────────────
  const memberRows = members.map((m, i) => {
    const isTop = i < 3;
    const medal = medals[i] || '';
    const bg = i === 0
      ? 'background:linear-gradient(135deg,rgba(240,192,64,.12),rgba(240,150,0,.06));border-color:rgba(240,192,64,.35)'
      : i < 3
        ? 'background:rgba(0,237,181,.06);border-color:rgba(0,237,181,.2)'
        : 'background:var(--bg2)';

    return `
      <div style="display:flex;align-items:center;gap:12px;${bg};border:1px solid var(--border);border-radius:14px;padding:12px 14px">
        <div style="width:18px;text-align:center;flex-shrink:0;font-size:${isTop ? '16' : '11'}px;font-weight:900;color:var(--muted)">
          ${isTop ? medal : i + 1}
        </div>
        <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;overflow:hidden;border:${i === 0 ? '2px solid var(--gold)' : '2px solid transparent'}">
          ${m.avatar_url ? `<img src="${_esc(m.avatar_url)}" style="width:100%;height:100%;object-fit:cover">` : '🧠'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:${isTop ? '900' : '700'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(m.display_name || 'Игрок')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:4px;flex-shrink:0">
          <span style="font-size:15px;font-weight:900;color:${i === 0 ? 'var(--gold)' : i < 3 ? 'var(--accent2)' : 'var(--text)'}">${(m.neurons || 0).toLocaleString()}</span>
          <span style="font-size:11px;color:var(--muted)">⚡</span>
        </div>
      </div>`;
  }).join('');

  el.innerHTML = `
    <!-- Шапка sticky -->
    <div style="position:sticky;top:0;z-index:20;backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);background:rgba(var(--bg-rgb,255,255,255),.82);border-bottom:0.5px solid var(--border);display:flex;align-items:center;justify-content:space-between;padding:0 16px;height:52px">
      <button onclick="window.loadTeamsList?.()" style="background:none;border:none;color:var(--text);font-size:24px;cursor:pointer;padding:0;line-height:1;display:flex;align-items:center;gap:4px">
        <span>‹</span>
      </button>
      <div style="font-size:15px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px">${_esc(team.name)}</div>
      ${isMyTeam
        ? `<button onclick="window.showScreen?.('my-team-screen');window.loadMyTeam?.()" style="background:rgba(0,237,181,.15);border:1px solid rgba(0,237,181,.3);border-radius:10px;color:var(--accent2);font-size:12px;font-weight:800;cursor:pointer;padding:5px 12px;font-family:inherit">⚙️ Моя</button>`
        : `<div style="width:60px"></div>`}
    </div>

    <!-- Баннер -->
    <div style="position:relative;height:200px;overflow:hidden;${bannerBg}">
      <!-- Тёмный оверлей снизу для плавного перехода -->
      <div style="position:absolute;inset:0;background:linear-gradient(to bottom,transparent 40%,rgba(0,0,0,.45) 100%)"></div>
      <!-- Имя поверх баннера -->
      <div style="position:absolute;bottom:60px;left:0;right:0;text-align:center">
        <div style="font-size:24px;font-weight:900;color:#fff;text-shadow:0 2px 12px rgba(0,0,0,.5)">${_esc(team.name)}</div>
        ${team.city ? `<div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:3px">📍 ${_esc(team.city)}</div>` : ''}
      </div>
    </div>

    <!-- Аватар — переходит между баннером и контентом -->
    <div style="position:relative;height:0;display:flex;justify-content:center">
      <div style="position:absolute;top:-44px;width:88px;height:88px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));border:4px solid var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.25)">
        ${avatar}
      </div>
    </div>

    <!-- Контент -->
    <div style="padding:56px 16px 80px;display:flex;flex-direction:column;gap:20px">

      <!-- Мотто и описание -->
      <div style="text-align:center;padding-top:4px">
        ${team.motto ? `<div style="font-size:14px;font-style:italic;color:var(--accent2);font-weight:600;margin-bottom:8px">"${_esc(team.motto)}"</div>` : ''}
        <div style="display:flex;align-items:center;justify-content:center;gap:16px">
          <div style="font-size:12px;color:var(--muted)"><span style="font-weight:800;color:var(--text)">${members.length}</span> участников</div>
          ${totalNeurons > 0 ? `<div style="width:4px;height:4px;border-radius:50%;background:var(--border)"></div><div style="font-size:12px;color:var(--muted)"><span style="font-weight:800;color:var(--gold)">${totalNeurons.toLocaleString()}</span> ⚡ всего</div>` : ''}
        </div>
      </div>

      <!-- Статы -->
      <div style="display:flex;gap:10px">
        ${statPill('🍺', rankVal(barRank), 'Барный', rankColor(barRank))}
        ${statPill('🌐', rankVal(onlineRank), 'Онлайн', rankColor(onlineRank))}
        ${statPill('🏆', totalPts > 0 ? totalPts : '—', 'Очков', totalPts > 0 ? 'var(--accent2)' : 'var(--muted)')}
        ${brainPoints > 0 ? statPill('🧠', brainPoints, 'BF неделя', '#3cc864') : ''}
      </div>

      ${barRank || onlineRank ? `
      <!-- Подпись к рейтингу -->
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${barRank ? `<div style="font-size:11px;background:rgba(240,192,64,.1);border:1px solid rgba(240,192,64,.25);border-radius:8px;padding:4px 10px;color:var(--muted)">🍺 ${barRank.points} очков из ${barRank.total} команд</div>` : ''}
        ${onlineRank ? `<div style="font-size:11px;background:rgba(0,237,181,.08);border:1px solid rgba(0,237,181,.2);border-radius:8px;padding:4px 10px;color:var(--muted)">🌐 ${onlineRank.points} очков из ${onlineRank.total} команд</div>` : ''}
      </div>` : ''}

      <!-- Состав -->
      <div>
        <div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:1.5px;text-transform:uppercase;margin-bottom:12px">
          Состав · ${members.length} ${members.length === 1 ? 'игрок' : members.length < 5 ? 'игрока' : 'игроков'}
        </div>
        ${members.length > 0
          ? `<div style="display:flex;flex-direction:column;gap:8px">${memberRows}</div>`
          : `<div style="padding:24px;text-align:center;color:var(--muted);font-size:13px;background:var(--bg2);border-radius:14px">Пока нет участников</div>`}
      </div>

    </div>`;
}

function _esc(s) {
  return String(s || '').replace(/[<>"'&]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '&': '&amp;' }[c]));
}

window.loadTeamProfile = loadTeamProfile;
