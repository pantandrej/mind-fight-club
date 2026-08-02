// ── My Team Screen ────────────────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

export async function loadMyTeam() {
  const { currentUser } = getState();
  const el = document.getElementById('my-team-screen');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Войдите в аккаунт</div>`;
    return;
  }

  el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">Загрузка...</div>`;

  const { data: me } = await sb.from('profiles')
    .select('team_id, display_name, is_scout')
    .eq('id', currentUser.id)
    .single();

  if (!me?.team_id) {
    _renderNoTeam(el);
    return;
  }

  const [teamRes, membersRes, tiebreakRes, barRankRes, onlineRankRes] = await Promise.all([
    sb.from('teams').select('id,name,city').eq('id', me.team_id).single(),
    sb.from('profiles').select('id,display_name,neurons,avatar_url,is_scout').eq('team_id', me.team_id).order('neurons', { ascending: false }),
    sb.rpc('get_team_tiebreaker', { p_team_id: me.team_id }),
    _getTeamRank(me.team_id, 'bar_quiz'),
    _getTeamRank(me.team_id, 'online_quiz'),
  ]);

  const team     = teamRes.data;
  const members  = membersRes.data || [];
  const tiebreak = tiebreakRes.data ?? 0;
  const today    = new Date().toISOString().slice(0, 10);

  const memberIds = members.map(m => m.id);
  const [{ data: activeToday }, { data: trainedToday }] = await Promise.all([
    sb.from('user_super_question_attempts').select('user_id').in('user_id', memberIds),
    sb.from('currency_ledger').select('user_id')
      .in('user_id', memberIds)
      .in('operation_type', ['quiz_reward', 'daily_goal_bonus'])
      .gte('created_at', today + 'T00:00:00Z'),
  ]);

  const activeSet = new Set([
    ...(activeToday || []).map(r => r.user_id),
    ...(trainedToday || []).map(r => r.user_id),
  ]);

  const isAdmin = typeof window.isAdmin === 'function' ? window.isAdmin() : false;

  _renderMyTeam(el, { team, members, tiebreak, barRankRes, onlineRankRes, activeSet, currentUser, isAdmin });
}

function _renderNoTeam(el) {
  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(10,10,20,.85)">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🏟️ Моя Команда</div>
      <div style="width:30px"></div>
    </div>
    <div style="padding:24px;display:flex;flex-direction:column;gap:16px">
      <div style="text-align:center;padding:24px 0">
        <div style="font-size:48px;margin-bottom:12px">🏟️</div>
        <div style="font-size:18px;font-weight:900;margin-bottom:6px">Ты ещё не в команде</div>
        <div style="font-size:13px;color:var(--muted)">Вступи в существующую или создай свою</div>
      </div>

      <!-- Вступить -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:20px">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px">🔑 Вступить по ID</div>
        <input id="mt-join-id" placeholder="ID команды (uuid)" maxlength="36"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box"/>
        <button onclick="window._mtJoinTeam()"
          style="margin-top:10px;width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit">
          Вступить
        </button>
      </div>

      <!-- Создать -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:20px">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px">✨ Создать команду</div>
        <input id="mt-create-name" placeholder="Название команды" maxlength="50"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:8px"/>
        <input id="mt-create-city" placeholder="Город (необязательно)" maxlength="60"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box"/>
        <button onclick="window._mtCreateTeam()"
          style="margin-top:10px;width:100%;background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit">
          Создать
        </button>
      </div>
    </div>`;
}

async function _getTeamRank(teamId, type) {
  const { data } = await sb.from('challenge_results')
    .select('team_id, points_earned')
    .eq('challenge_type', type);
  if (!data) return null;

  const totals = {};
  for (const row of data) {
    totals[row.team_id] = (totals[row.team_id] || 0) + row.points_earned;
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1]);
  const idx    = sorted.findIndex(([id]) => id === teamId);
  return idx === -1 ? null : { rank: idx + 1, points: totals[teamId], total: sorted.length };
}

function _renderMyTeam(el, { team, members, tiebreak, barRankRes, onlineRankRes, activeSet, currentUser, isAdmin }) {
  const bar    = barRankRes;
  const online = onlineRankRes;
  const massBonus = activeSet.size * 5;

  const crownFor = (i) => {
    if (i === 0) return '<span style="font-size:16px">👑</span>';
    if (i === 1) return '<span style="font-size:14px">🥈</span>';
    if (i === 2) return '<span style="font-size:14px">🥉</span>';
    return '';
  };

  const scoutSection = isAdmin ? `
    <div style="background:rgba(255,200,0,.06);border:1px solid rgba(255,200,0,.25);border-radius:18px;padding:20px">
      <div style="font-size:14px;font-weight:800;margin-bottom:4px">🎯 Управление скаутами</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:14px">Только для администраторов</div>
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <input id="mt-scout-search" placeholder="Имя или email игрока"
          style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none"/>
        <button onclick="window._mtSearchScout()"
          style="background:var(--accent);border:none;border-radius:10px;padding:10px 14px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">
          Найти
        </button>
      </div>
      <div id="mt-scout-results"></div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(10,10,20,.85)">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🏟️ Моя Команда</div>
      <div style="width:30px"></div>
    </div>

    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">

      <div style="background:linear-gradient(135deg,rgba(108,99,255,.2),rgba(168,85,247,.15));border:1px solid rgba(108,99,255,.3);border-radius:20px;padding:20px;text-align:center">
        <div style="font-size:40px;margin-bottom:8px">🏟️</div>
        <div style="font-size:22px;font-weight:900;margin-bottom:4px">${team.name}</div>
        ${team.city ? `<div style="font-size:13px;color:var(--muted)">📍 ${team.city}</div>` : ''}
        <div style="font-size:11px;color:var(--muted);margin-top:8px;word-break:break-all;opacity:.5">ID: ${team.id}</div>
        <div style="margin-top:12px;display:inline-flex;align-items:center;gap:6px;background:rgba(108,99,255,.15);border-radius:20px;padding:8px 16px">
          <span style="font-size:16px">⚡</span>
          <span style="font-size:18px;font-weight:900">${tiebreak}</span>
          <span style="font-size:12px;color:var(--muted)">командных нейронов</span>
        </div>
      </div>

      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Рейтинговые позиции</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">🍺 БАРНЫЙ</div>
            ${bar
              ? `<div style="font-size:32px;font-weight:900;color:var(--gold)">#${bar.rank}</div>
                 <div style="font-size:11px;color:var(--muted)">из ${bar.total} команд</div>
                 <div style="font-size:12px;color:var(--accent2);margin-top:4px">${bar.points} очков</div>`
              : `<div style="font-size:24px;font-weight:900;color:var(--muted)">—</div>
                 <div style="font-size:11px;color:var(--muted)">нет результатов</div>`}
          </div>
          <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:16px;text-align:center">
            <div style="font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px">🌐 ОНЛАЙН</div>
            ${online
              ? `<div style="font-size:32px;font-weight:900;color:var(--accent)">#${online.rank}</div>
                 <div style="font-size:11px;color:var(--muted)">из ${online.total} команд</div>
                 <div style="font-size:12px;color:var(--accent2);margin-top:4px">${online.points} очков</div>`
              : `<div style="font-size:24px;font-weight:900;color:var(--muted)">—</div>
                 <div style="font-size:11px;color:var(--muted)">нет результатов</div>`}
          </div>
        </div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:13px;font-weight:800">Бонус за массовку сегодня</div>
          <div style="font-size:14px;font-weight:900;color:var(--accent2)">+${massBonus} ⚡</div>
        </div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px">${activeSet.size} из ${members.length} игроков активны</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${members.map(m => `
            <div style="display:flex;align-items:center;gap:5px;background:${activeSet.has(m.id) ? 'rgba(60,200,100,.1)' : 'rgba(255,255,255,.04)'};border:1px solid ${activeSet.has(m.id) ? 'rgba(60,200,100,.3)' : 'var(--border)'};border-radius:20px;padding:4px 10px">
              <div style="width:7px;height:7px;border-radius:50%;background:${activeSet.has(m.id) ? '#3cc864' : 'var(--muted)'}"></div>
              <span style="font-size:11px;font-weight:700;color:${activeSet.has(m.id) ? 'var(--text)' : 'var(--muted)'}">${m.display_name || 'Игрок'}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Состав клана · ${members.length} игроков</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${members.map((m, i) => `
            <div style="display:flex;align-items:center;gap:12px;background:${i < 3 ? 'rgba(108,99,255,.08)' : 'var(--bg2)'};border:1px solid ${i < 3 ? 'rgba(108,99,255,.25)' : 'var(--border)'};border-radius:14px;padding:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;overflow:hidden">
                ${m.avatar_url ? `<img src="${m.avatar_url}" style="width:100%;height:100%;object-fit:cover"/>` : '🧠'}
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                  ${crownFor(i)}
                  <span style="font-size:14px;font-weight:${i < 3 ? '900' : '700'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${m.display_name || 'Игрок'}${m.id === currentUser.id ? ' <span style="font-size:10px;color:var(--accent2)">(ты)</span>' : ''}
                  </span>
                  ${m.is_scout ? '<span style="font-size:10px;background:rgba(255,200,0,.15);color:#f5c400;border-radius:6px;padding:2px 6px;font-weight:700">🎯 скаут</span>' : ''}
                </div>
                ${i < 3 ? `<div style="font-size:10px;color:var(--accent2);font-weight:700;margin-top:1px">Лидер тай-брейка</div>` : ''}
              </div>
              <div style="text-align:right;flex-shrink:0">
                <div style="font-size:16px;font-weight:900;color:${i < 3 ? 'var(--gold)' : 'var(--text)'}">${m.neurons || 0}</div>
                <div style="font-size:10px;color:var(--muted)">⚡ нейронов</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      ${scoutSection}

      <div style="height:24px"></div>
    </div>`;
}

// ── Вступить в команду ────────────────────────────────────────────
window._mtJoinTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) return;
  const teamId = document.getElementById('mt-join-id')?.value?.trim();
  if (!teamId) { window.toast?.('Введи ID команды'); return; }

  const { error } = await sb.from('profiles').update({ team_id: teamId }).eq('id', currentUser.id);
  if (error) {
    window.toast?.('Ошибка: неверный ID команды');
  } else {
    window.toast?.('✅ Ты в команде!');
    loadMyTeam();
  }
};

// ── Создать команду ───────────────────────────────────────────────
window._mtCreateTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) return;

  const name = document.getElementById('mt-create-name')?.value?.trim();
  const city = document.getElementById('mt-create-city')?.value?.trim() || null;
  if (!name) { window.toast?.('Введи название команды'); return; }

  // Создаём команду
  const { data: team, error: teamErr } = await sb.from('teams')
    .insert({ name, city })
    .select('id')
    .single();

  if (teamErr) {
    window.toast?.('Ошибка создания команды');
    console.error(teamErr);
    return;
  }

  // Привязываем пользователя к команде
  const { error: profileErr } = await sb.from('profiles')
    .update({ team_id: team.id })
    .eq('id', currentUser.id);

  if (profileErr) {
    window.toast?.('Команда создана, но не удалось привязать профиль');
  } else {
    window.toast?.('✅ Команда создана!');
    loadMyTeam();
  }
};

// ── Поиск и назначение скаутов (только для admin) ────────────────
window._mtSearchScout = async function() {
  const query = document.getElementById('mt-scout-search')?.value?.trim();
  if (!query) return;

  const resultsEl = document.getElementById('mt-scout-results');
  resultsEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Поиск...</div>';

  const { data, error } = await sb.from('profiles')
    .select('id, display_name, is_scout')
    .ilike('display_name', `%${query}%`)
    .limit(10);

  if (error || !data?.length) {
    resultsEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Игроки не найдены</div>';
    return;
  }

  resultsEl.innerHTML = data.map(p => `
    <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:6px">
      <div>
        <div style="font-size:13px;font-weight:700">${p.display_name || 'Игрок'}</div>
        <div style="font-size:11px;color:${p.is_scout ? '#f5c400' : 'var(--muted)'}">${p.is_scout ? '🎯 скаут' : 'обычный игрок'}</div>
      </div>
      <button onclick="window._mtToggleScout('${p.id}', ${!p.is_scout})"
        style="background:${p.is_scout ? 'rgba(255,60,60,.15)' : 'rgba(245,196,0,.15)'};border:1px solid ${p.is_scout ? 'rgba(255,60,60,.3)' : 'rgba(245,196,0,.3)'};border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:${p.is_scout ? '#ff6b6b' : '#f5c400'};cursor:pointer;font-family:inherit">
        ${p.is_scout ? 'Снять' : 'Назначить'}
      </button>
    </div>
  `).join('');
};

window._mtToggleScout = async function(userId, makeScout) {
  const { error } = await sb.from('profiles')
    .update({ is_scout: makeScout })
    .eq('id', userId);

  if (error) {
    window.toast?.('Ошибка при изменении роли');
  } else {
    window.toast?.(makeScout ? '✅ Скаут назначен' : '✅ Роль скаута снята');
    window._mtSearchScout();
  }
};

window.loadMyTeam = loadMyTeam;
