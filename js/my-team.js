// ── My Team Screen ────────────────────────────────────────────────
// All team writes go through SECURITY DEFINER RPCs (never direct table writes).
// profiles.team_id is guarded by trigger (migration 70+73) — client cannot
// set it directly. RPCs bypass the trigger as function owner.
//
// Data semantics:
//   profiles.team_id          = fast cache of current team
//   team_member_history       = historical source of truth (competition attribution)
//   Both updated atomically by every RPC.
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

  // Handle ?team_code=ABCDEF invite link (canonical form).
  // Also handles legacy ?join=UUID with backward-compat fallback.
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('team_code');
  const inviteUUID = params.get('join');
  if (inviteCode || inviteUUID) {
    history.replaceState({}, '', window.location.pathname);
    // Dispatch join after rendering the screen.
    setTimeout(() => _handleInviteLink(inviteCode, inviteUUID), 0);
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

  const weekStart = _getWeekStart();
  const [teamRes, membersRes, tiebreakRes, barRankRes, onlineRankRes, brainRes, treasuryRes] = await Promise.all([
    sb.from('teams')
      .select('id,name,city,motto,banner_url,avatar_url,emoji,treasury_neurons,captain_id,join_code,disbanded_at')
      .eq('id', me.team_id)
      .single(),
    // Roster: captain first, then alphabetical. No competitive ordering by neurons.
    sb.from('profiles')
      .select('id,display_name,avatar_url,is_scout')
      .eq('team_id', me.team_id)
      .order('display_name', { ascending: true }),
    sb.rpc('get_team_tiebreaker', { p_team_id: me.team_id }),
    _getTeamRank(me.team_id, 'bar_quiz'),
    _getTeamRank(me.team_id, 'online_quiz'),
    sb.from('team_weekly_brain_fights')
      .select('points')
      .eq('team_id', me.team_id)
      .eq('week_start', weekStart)
      .maybeSingle(),
    sb.from('team_treasury_ledger')
      .select('amount,created_at,profiles(display_name)')
      .eq('team_id', me.team_id)
      .order('created_at', { ascending: false })
      .limit(5),
  ]);

  const team     = teamRes.data;
  const tiebreak = tiebreakRes.data ?? 0;
  const today    = new Date().toISOString().slice(0, 10);

  // Sort: captain first, then alphabetical.
  let members = membersRes.data || [];
  const captainId = team?.captain_id;
  members = [
    ...members.filter(m => m.id === captainId),
    ...members.filter(m => m.id !== captainId),
  ];

  const memberIds = members.map(m => m.id);
  const [{ data: activeToday }, { data: trainedToday }] = await Promise.all([
    memberIds.length
      ? sb.from('user_super_question_attempts').select('user_id').in('user_id', memberIds)
      : Promise.resolve({ data: [] }),
    memberIds.length
      ? sb.from('currency_ledger').select('user_id')
          .in('user_id', memberIds)
          .in('operation_type', ['quiz_reward', 'daily_goal_bonus'])
          .gte('created_at', today + 'T00:00:00Z')
      : Promise.resolve({ data: [] }),
  ]);

  const activeSet = new Set([
    ...(activeToday  || []).map(r => r.user_id),
    ...(trainedToday || []).map(r => r.user_id),
  ]);

  const isAdmin   = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
  const isCaptain = captainId === currentUser.id;
  const brainPoints      = brainRes.data?.points ?? 0;
  const treasuryContribs = treasuryRes.data || [];

  _renderMyTeam(el, {
    team, members, tiebreak,
    barRankRes, onlineRankRes,
    activeSet, currentUser,
    isAdmin, isCaptain, brainPoints,
    myTeamId: me.team_id, treasuryContribs,
  });
}

// ── No team screen ────────────────────────────────────────────────────────
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
        <div style="font-size:13px;color:var(--muted)">Вступи по коду или создай свою</div>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:20px">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px">🔑 Вступить по коду</div>
        <input id="mt-join-code" placeholder="Код команды (6 букв)" maxlength="8"
          style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:16px;letter-spacing:3px;text-transform:uppercase;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;text-align:center"/>
        <button onclick="window._mtJoinTeam()"
          style="margin-top:10px;width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit">
          Вступить
        </button>
      </div>

      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:18px;padding:20px">
        <div style="font-size:14px;font-weight:800;margin-bottom:12px">✨ Создать команду</div>
        <input id="mt-create-name" placeholder="Название команды" maxlength="60"
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

// ── Team rank helper ──────────────────────────────────────────────────────
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

function _getWeekStart() {
  const d   = new Date();
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return mon.toISOString().slice(0, 10);
}

// ── Main render ───────────────────────────────────────────────────────────
function _renderMyTeam(el, {
  team, members, tiebreak,
  barRankRes, onlineRankRes,
  activeSet, currentUser,
  isAdmin, isCaptain, brainPoints,
  myTeamId, treasuryContribs,
}) {
  const bar    = barRankRes;
  const online = onlineRankRes;
  const emoji  = team.emoji || '🏟️';

  // Captain-only: edit section
  const captainEditSection = isCaptain ? `
    <div id="mt-edit-section" style="display:none;background:var(--bg2);border:1px solid rgba(0,237,181,.3);border-radius:18px;padding:18px">
      <div style="font-size:13px;font-weight:800;margin-bottom:14px">✏️ Редактировать команду</div>
      <div style="display:flex;flex-direction:column;gap:10px">
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Название</div>
          <input id="mt-edit-name" value="${_escAttr(team.name)}" maxlength="60"
            style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Город</div>
          <input id="mt-edit-city" value="${_escAttr(team.city || '')}" maxlength="60"
            style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Девиз</div>
          <input id="mt-edit-motto" value="${_escAttr(team.motto || '')}" maxlength="100" placeholder="Ваш девиз..."
            style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Эмодзи аватар</div>
          <input id="mt-edit-emoji" value="${_escAttr(team.emoji || '🏟️')}" maxlength="4"
            style="width:80px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:18px;text-align:center;color:var(--text);font-family:inherit;outline:none">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Баннер (URL)</div>
          <input id="mt-edit-banner" value="${_escAttr(team.banner_url || '')}" placeholder="https://..." type="url"
            style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Аватар (URL)</div>
          <input id="mt-edit-avatar" value="${_escAttr(team.avatar_url || '')}" placeholder="https://..." type="url"
            style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <button onclick="window._mtSaveProfile()"
          style="background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">
          Сохранить
        </button>
      </div>
    </div>
  ` : `<div id="mt-edit-section" style="display:none"></div>`;

  // Admin scout management.
  // NOTE: is_scout is guarded by guard_critical_profile_fields trigger (mig 70+73).
  // Direct profiles.update({ is_scout }) is a silent no-op for authenticated role.
  // Requires a SECURITY DEFINER admin RPC (future iteration).
  // Shown as disabled with explanation to avoid fake-success UX.
  const scoutSection = isAdmin ? `
    <div style="background:rgba(255,200,0,.06);border:1px solid rgba(255,200,0,.25);border-radius:18px;padding:20px">
      <div style="font-size:14px;font-weight:800;margin-bottom:4px">🎯 Управление скаутами</div>
      <div style="font-size:12px;color:rgba(255,200,0,.7);margin-bottom:8px">Только для администраторов</div>
      <div style="font-size:12px;color:var(--muted);background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;line-height:1.6">
        ⚠️ Назначение скаутов через UI пока недоступно.<br>
        Поле <code>is_scout</code> защищено триггером на уровне БД.<br>
        Используй SQL Editor (Supabase) → <code>UPDATE profiles SET is_scout = true WHERE id = '...'</code><br>
        (от service role, не от authenticated).
      </div>
    </div>
  ` : '';

  // Captain controls
  const captainControls = isCaptain ? `
    <div style="background:rgba(0,237,181,.04);border:1px solid rgba(0,237,181,.2);border-radius:18px;padding:18px">
      <div style="font-size:13px;font-weight:800;margin-bottom:12px;color:var(--accent2)">👑 Управление командой</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        <button onclick="window._mtOpenTransfer()"
          style="background:rgba(0,237,181,.08);border:1px solid rgba(0,237,181,.25);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit;text-align:left">
          🔄 Передать капитанство
        </button>
        <button onclick="window._mtOpenKick()"
          style="background:rgba(224,85,85,.06);border:1px solid rgba(224,85,85,.2);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:rgba(224,85,85,.8);cursor:pointer;font-family:inherit;text-align:left">
          ⛔ Исключить участника
        </button>
        <button onclick="window._mtRegenerateCode()"
          style="background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:12px;padding:10px 14px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;text-align:left">
          🔁 Обновить код приглашения
        </button>
      </div>
    </div>
  ` : '';

  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(10,10,20,.85)">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🏟️ Моя Команда</div>
      ${isCaptain
        ? `<button onclick="window._mtToggleEdit()" style="background:none;border:none;color:var(--accent2);font-size:12px;font-weight:700;cursor:pointer;padding:0">✏️ Ред.</button>`
        : `<div style="width:46px"></div>`}
    </div>

    <div style="padding:16px;display:flex;flex-direction:column;gap:16px">

      <!-- 1. Team identity ─────────────────────────────────────── -->
      <div style="border-radius:20px;overflow:hidden;border:1px solid rgba(0,237,181,.3);position:relative">
        <div style="height:140px;overflow:hidden;background:linear-gradient(135deg,rgba(0,237,181,.3),rgba(168,85,247,.2))">
          ${team.banner_url ? `<img src="${team.banner_url}" style="width:100%;height:100%;object-fit:cover">` : ''}
        </div>
        <div style="position:absolute;top:100px;left:50%;transform:translateX(-50%)">
          <div style="width:64px;height:64px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));border:3px solid var(--bg);display:flex;align-items:center;justify-content:center;font-size:28px;overflow:hidden">
            ${team.avatar_url ? `<img src="${team.avatar_url}" style="width:100%;height:100%;object-fit:cover">` : emoji}
          </div>
        </div>
        <div style="background:var(--bg2);padding:44px 16px 16px;text-align:center">
          <div style="font-size:20px;font-weight:900;margin-bottom:4px">${team.name}</div>
          ${isCaptain ? `<div style="font-size:10px;color:var(--accent2);font-weight:700;margin-bottom:2px">👑 Капитан</div>` : ''}
          ${team.city ? `<div style="font-size:12px;color:var(--muted)">📍 ${team.city}</div>` : ''}
          ${team.motto ? `<div style="font-size:12px;color:var(--accent2);font-style:italic;margin-top:4px">"${team.motto}"</div>` : ''}
          <div style="margin-top:10px;display:inline-flex;align-items:center;gap:6px;background:rgba(0,237,181,.15);border-radius:20px;padding:6px 14px">
            <span style="font-size:14px">⚡</span>
            <span style="font-size:16px;font-weight:900">${tiebreak}</span>
            <span style="font-size:11px;color:var(--muted)">очков тай-брейка</span>
          </div>
          <!-- Invite: canonical ?team_code= link -->
          <div style="margin-top:10px;display:flex;flex-direction:column;align-items:center;gap:6px">
            ${team.join_code
              ? `<div style="font-size:11px;color:var(--muted)">Код команды: <strong style="color:var(--text);letter-spacing:2px;font-size:14px">${team.join_code}</strong></div>`
              : ''}
            <button onclick="window._mtCopyInvite('${team.join_code || ''}')"
              style="background:rgba(0,237,181,.15);border:1px solid rgba(0,237,181,.3);border-radius:20px;padding:7px 16px;font-size:12px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">
              🔗 Пригласить в команду
            </button>
          </div>
        </div>
      </div>

      ${captainEditSection}

      <!-- 2. Rankings ──────────────────────────────────────────── -->
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

        <!-- Brain Fights (competitive score, not economy) -->
        <div style="margin-top:10px;background:linear-gradient(135deg,rgba(60,200,100,.08),rgba(0,180,80,.05));border:1px solid rgba(60,200,100,.25);border-radius:16px;padding:16px">
          <div style="display:flex;align-items:center;justify-content:space-between">
            <div>
              <div style="font-size:13px;font-weight:800">🧠 Brain Fights</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">Очки Brain Fights за эту неделю</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:28px;font-weight:900;color:#3cc864">${brainPoints}</div>
              <div style="font-size:10px;color:var(--muted)">очков BF</div>
            </div>
          </div>
          <div style="margin-top:8px;background:rgba(60,200,100,.08);border-radius:8px;padding:7px 10px;font-size:11px;color:var(--muted)">
            Играй за команду и поднимай её в рейтингах BFC.
          </div>
        </div>
      </div>

      <!-- 3. Roster ─────────────────────────────────────────────── -->
      <!-- Captain first, then alphabetical. No competitive ranking by wealth. -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Состав · ${members.length} игроков</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${members.map((m) => {
            const isThisCaptain = m.id === team.captain_id;
            const isMe = m.id === currentUser.id;
            return `
            <div style="display:flex;align-items:center;gap:12px;background:${isThisCaptain ? 'rgba(0,237,181,.06)' : 'var(--bg2)'};border:1px solid ${isThisCaptain ? 'rgba(0,237,181,.25)' : 'var(--border)'};border-radius:14px;padding:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;overflow:hidden">
                ${m.avatar_url ? `<img src="${m.avatar_url}" style="width:100%;height:100%;object-fit:cover"/>` : '🧠'}
              </div>
              <div style="flex:1;min-width:0">
                <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                  <span style="font-size:14px;font-weight:${isThisCaptain ? '900' : '700'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
                    ${m.display_name || 'Игрок'}${isMe ? ' <span style="font-size:10px;color:var(--accent2)">(ты)</span>' : ''}
                  </span>
                  ${isThisCaptain ? '<span style="font-size:10px;background:rgba(0,237,181,.15);color:var(--accent2);border-radius:6px;padding:2px 6px;font-weight:700">👑 капитан</span>' : ''}
                  ${m.is_scout ? '<span style="font-size:10px;background:rgba(255,200,0,.15);color:#f5c400;border-radius:6px;padding:2px 6px;font-weight:700">🎯 скаут</span>' : ''}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      <!-- 4. Team activity today (factual, no predicted BF score) ─ -->
      <div style="background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
          <div style="font-size:13px;font-weight:800">Активность сегодня</div>
          <div style="font-size:13px;font-weight:700;color:var(--accent2)">${activeSet.size} из ${members.length}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${members.map(m => `
            <div style="display:flex;align-items:center;gap:5px;background:${activeSet.has(m.id) ? 'rgba(60,200,100,.1)' : 'rgba(255,255,255,.04)'};border:1px solid ${activeSet.has(m.id) ? 'rgba(60,200,100,.3)' : 'var(--border)'};border-radius:20px;padding:4px 10px">
              <div style="width:7px;height:7px;border-radius:50%;background:${activeSet.has(m.id) ? '#3cc864' : 'var(--muted)'}"></div>
              <span style="font-size:11px;font-weight:700;color:${activeSet.has(m.id) ? 'var(--text)' : 'var(--muted)'}">${m.display_name || 'Игрок'}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 5. Treasury ──────────────────────────────────────────── -->
      <div id="mt-treasury-card" style="background:linear-gradient(135deg,rgba(245,196,0,.08),rgba(255,160,0,.05));border:1px solid rgba(245,196,0,.25);border-radius:18px;padding:20px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
          <div>
            <div style="font-size:14px;font-weight:800">💰 Казна команды</div>
            <div style="font-size:11px;color:var(--muted);margin-top:2px">Общий фонд нейронов</div>
          </div>
          <div style="text-align:right">
            <div id="mt-treasury-amount" style="font-size:28px;font-weight:900;color:#f5c400">${team.treasury_neurons || 0}</div>
            <div style="font-size:10px;color:var(--muted)">⚡ нейронов</div>
          </div>
        </div>
        <button onclick="window._mtOpenDonate()"
          style="width:100%;background:rgba(245,196,0,.15);border:1px solid rgba(245,196,0,.35);border-radius:12px;padding:10px;font-size:13px;font-weight:700;color:#f5c400;cursor:pointer;font-family:inherit">
          💛 Внести нейроны
        </button>
        ${treasuryContribs.length ? `
        <div style="margin-top:14px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-weight:700;text-transform:uppercase;letter-spacing:.05em">Последние взносы</div>
          ${treasuryContribs.map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:12px">
              <span style="color:var(--muted)">${c.profiles?.display_name || 'Игрок'}</span>
              <span style="font-weight:700;color:#f5c400">+${c.amount} ⚡</span>
            </div>
          `).join('')}
        </div>` : ''}
      </div>

      <!-- 6. Captain controls ──────────────────────────────────── -->
      ${captainControls}
      ${scoutSection}

      <!-- Leave team -->
      <button onclick="window._mtLeaveTeam()"
        style="width:100%;background:transparent;border:1px solid rgba(224,85,85,.35);border-radius:14px;padding:12px;font-size:13px;font-weight:700;color:rgba(224,85,85,.8);cursor:pointer;font-family:inherit">
        Покинуть команду
      </button>

      <div style="height:24px"></div>
    </div>`;
}

// ── Join by code ──────────────────────────────────────────────────────────
window._mtJoinTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.('Войдите в аккаунт'); return; }

  const code = document.getElementById('mt-join-code')?.value?.trim()?.toUpperCase();
  if (!code || code.length < 4) { window.toast?.('Введи код команды'); return; }

  const { data, error } = await sb.rpc('join_team_by_code', { p_join_code: code });

  if (error) { window.toast?.('Ошибка: ' + error.message); return; }
  if (!data?.ok) {
    const msgs = {
      team_not_found: 'Команда с таким кодом не найдена (или расформирована)',
      already_in_team: 'Ты уже состоишь в команде',
      invalid_code:   'Неверный формат кода',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка вступления'));
    return;
  }
  window.toast?.('✅ Ты в команде!');
  loadMyTeam();
};

// ── Create team ───────────────────────────────────────────────────────────
window._mtCreateTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.('Войдите в аккаунт'); return; }

  const name = document.getElementById('mt-create-name')?.value?.trim();
  const city = document.getElementById('mt-create-city')?.value?.trim() || null;
  if (!name) { window.toast?.('Введи название команды'); return; }

  const { data, error } = await sb.rpc('create_team', {
    p_name: name, p_city: city, p_emoji: '🏟️',
  });

  if (error) {
    window.toast?.('Ошибка создания команды');
    console.error('[mt] create_team:', error);
    return;
  }
  if (!data?.ok) {
    const msgs = {
      already_in_team: 'Ты уже в команде',
      name_too_short: 'Название слишком короткое (мин. 2 символа)',
      name_too_long:  'Название слишком длинное (макс. 60 символов)',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка создания'));
    return;
  }
  window.toast?.('✅ Команда создана!');
  loadMyTeam();
};

// ── Leave team ────────────────────────────────────────────────────────────
window._mtLeaveTeam = async function() {
  if (!confirm('Покинуть команду? Твои результаты сохранятся.')) return;
  const { currentUser } = getState();
  if (!currentUser) return;

  const { data, error } = await sb.rpc('leave_team', {});

  if (error) {
    window.toast?.('Ошибка при выходе из команды');
    console.error('[mt] leave_team:', error);
    return;
  }
  if (!data?.ok) {
    if (data?.reason === 'captain_must_transfer') {
      window.toast?.(
        `👑 Передай капитанство другому игроку (${data.member_count} участников), затем выйди.`,
        4000
      );
    } else {
      window.toast?.('Ошибка при выходе из команды');
    }
    return;
  }
  window.toast?.(data.disbanded ? 'Команда расформирована' : 'Ты покинул команду');
  loadMyTeam();
};

// ── Copy invite — canonical: ?team_code=ABCDEF ────────────────────────────
// join_code is the canonical share surface. UUID is not in the invite URL.
window._mtCopyInvite = function(joinCode) {
  if (!joinCode) { window.toast?.('Код команды недоступен'); return; }
  const url  = `${window.location.origin}/?team_code=${joinCode}`;
  const text = `Вступай в мою команду BFC! Код: ${joinCode}\n${url}`;
  navigator.clipboard.writeText(text).then(() => {
    window.toast?.('✅ Ссылка скопирована!');
  }).catch(() => {
    window.toast?.(`Код: ${joinCode}`);
  });
};

// ── Handle invite link on page load ──────────────────────────────────────
// Supports canonical ?team_code=ABCDEF and legacy ?join=UUID (backward compat).
async function _handleInviteLink(code, uuid) {
  const { currentUser } = getState();
  if (!currentUser) return;

  if (code) {
    // Canonical path: join directly by code.
    const { data: profile } = await sb.from('profiles')
      .select('team_id').eq('id', currentUser.id).single();
    if (profile?.team_id) return; // already in a team

    if (!confirm(`Вступить в команду по коду ${code}?`)) return;
    const { data, error } = await sb.rpc('join_team_by_code', { p_join_code: code });
    if (error || !data?.ok) {
      const msgs = {
        team_not_found: 'Команда не найдена (или расформирована)',
        already_in_team: 'Ты уже в команде',
      };
      window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка вступления'));
      return;
    }
    window.toast?.('✅ Ты в команде!');
    loadMyTeam();
    return;
  }

  if (uuid) {
    // Legacy path: UUID link. Fetch team's join_code and proceed via canonical join.
    const { data: profile } = await sb.from('profiles')
      .select('team_id').eq('id', currentUser.id).single();
    if (profile?.team_id === uuid) return;

    const { data: team } = await sb.from('teams')
      .select('name,join_code,disbanded_at')
      .eq('id', uuid)
      .single();
    if (!team || team.disbanded_at) {
      window.toast?.('Эта команда больше не существует');
      return;
    }
    if (!team.join_code) {
      window.toast?.('Команда не поддерживает вступление по ссылке. Попроси код у капитана.');
      return;
    }
    if (!confirm(`Вступить в команду «${team.name}»?`)) return;

    const { data, error } = await sb.rpc('join_team_by_code', { p_join_code: team.join_code });
    if (error || !data?.ok) {
      window.toast?.('Ошибка при вступлении');
      return;
    }
    window.toast?.(`✅ Ты в команде «${team.name}»!`);
    loadMyTeam();
  }
}

// Legacy export (called from legacy.js / index.html ?join= handler if exists).
window._mtJoinViaLink = async function(teamId) {
  await _handleInviteLink(null, teamId);
};

// ── Toggle edit (captain only) ────────────────────────────────────────────
window._mtToggleEdit = function() {
  const s = document.getElementById('mt-edit-section');
  if (s) s.style.display = s.style.display === 'none' ? 'block' : 'none';
};

// ── Save team profile (captain only via update_my_team RPC) ──────────────
window._mtSaveProfile = async function() {
  const { currentUser } = getState();
  if (!currentUser) return;

  const name      = document.getElementById('mt-edit-name')?.value?.trim();
  const city      = document.getElementById('mt-edit-city')?.value?.trim()   || null;
  const motto     = document.getElementById('mt-edit-motto')?.value?.trim()  || null;
  const emoji     = document.getElementById('mt-edit-emoji')?.value?.trim()  || null;
  const bannerUrl = document.getElementById('mt-edit-banner')?.value?.trim() || null;
  const avatarUrl = document.getElementById('mt-edit-avatar')?.value?.trim() || null;

  if (!name) { window.toast?.('Введи название команды'); return; }

  const { data, error } = await sb.rpc('update_my_team', {
    p_name:       name,
    p_city:       city,
    p_motto:      motto,
    p_emoji:      emoji,
    p_banner_url: bannerUrl,
    p_avatar_url: avatarUrl,
  });

  if (error || !data?.ok) {
    const msgs = {
      not_captain:    'Только капитан может редактировать команду',
      team_disbanded: 'Команда расформирована',
      name_too_short: 'Название слишком короткое',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка сохранения'));
    console.error('[mt] update_my_team:', error, data);
    return;
  }
  window.toast?.('✅ Профиль команды обновлён');
  loadMyTeam();
};

// ── Transfer captain ──────────────────────────────────────────────────────
window._mtOpenTransfer = function() {
  const targetId = prompt('Введи ID игрока, которому передать капитанство:');
  if (!targetId?.trim()) return;
  window._mtTransferCaptain(targetId.trim());
};

window._mtTransferCaptain = async function(targetId) {
  if (!confirm('Передать капитанство? Ты станешь обычным участником.')) return;

  const { data, error } = await sb.rpc('transfer_captain', { p_target_user_id: targetId });
  if (error || !data?.ok) {
    const msgs = {
      not_captain:              'Ты не являешься капитаном',
      target_not_in_team:       'Игрок не состоит в вашей команде',
      cannot_transfer_to_self:  'Нельзя передать капитанство себе',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка передачи'));
    return;
  }
  window.toast?.('✅ Капитанство передано');
  loadMyTeam();
};

// ── Kick member (captain only) ────────────────────────────────────────────
window._mtOpenKick = function() {
  const targetId = prompt('Введи ID игрока для исключения:');
  if (!targetId?.trim()) return;
  if (!confirm('Исключить игрока из команды?')) return;
  window._mtKickMember(targetId.trim());
};

window._mtKickMember = async function(targetId) {
  const { data, error } = await sb.rpc('kick_member', { p_target_user_id: targetId });
  if (error || !data?.ok) {
    const msgs = {
      not_captain:        'Только капитан может исключать игроков',
      target_not_in_team: 'Игрок не состоит в вашей команде',
      cannot_kick_self:   'Нельзя исключить себя',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка исключения'));
    return;
  }
  window.toast?.('✅ Игрок исключён');
  loadMyTeam();
};

// ── Regenerate join code (captain only) ──────────────────────────────────
window._mtRegenerateCode = async function() {
  if (!confirm('Обновить код приглашения? Старые ссылки перестанут работать.')) return;

  const { data, error } = await sb.rpc('regenerate_team_code', {});
  if (error || !data?.ok) {
    const msgs = { not_captain: 'Только капитан может обновить код' };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка обновления кода'));
    return;
  }
  window.toast?.(`✅ Новый код: ${data.join_code}`);
  loadMyTeam();
};

// ── Treasury donate modal ─────────────────────────────────────────────────
window._mtOpenDonate = function() {
  document.getElementById('mt-donate-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mt-donate-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:flex-end;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border-radius:24px 24px 0 0;padding:28px 24px 40px;width:100%;max-width:480px;box-sizing:border-box">
      <div style="font-size:16px;font-weight:900;margin-bottom:4px">💰 Внести вклад в казну</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:20px">Нейроны перейдут в общий фонд команды</div>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        ${[50, 100, 300].map(n => `
          <button onclick="document.getElementById('mt-donate-input').value=${n}"
            style="flex:1;background:rgba(245,196,0,.12);border:1px solid rgba(245,196,0,.3);border-radius:12px;padding:12px 0;font-size:15px;font-weight:900;color:#f5c400;cursor:pointer;font-family:inherit">
            ${n}
          </button>`).join('')}
      </div>
      <input id="mt-donate-input" type="number" min="1" max="10000" placeholder="Или введи своё число"
        style="width:100%;background:var(--bg);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:15px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:14px"/>
      <button onclick="window._mtDonate()"
        style="width:100%;background:linear-gradient(135deg,#f5c400,#ff9800);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit">
        Внести нейроны
      </button>
      <button onclick="document.getElementById('mt-donate-overlay').remove()"
        style="width:100%;background:transparent;border:none;border-radius:14px;padding:10px;font-size:13px;color:var(--muted);cursor:pointer;font-family:inherit;margin-top:4px">
        Отмена
      </button>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

window._mtDonate = async function() {
  const input  = document.getElementById('mt-donate-input');
  const amount = parseInt(input?.value, 10);
  if (!amount || amount <= 0)     { window.toast?.('Введи сумму'); return; }
  if (amount > 10000)             { window.toast?.('Максимум 10 000 за раз'); return; }

  const { data, error } = await sb.rpc('donate_to_team', { p_amount: amount });
  document.getElementById('mt-donate-overlay')?.remove();

  if (error || !data?.ok) {
    const reason = data?.reason;
    if (reason === 'insufficient_neurons') {
      window.toast?.(`Недостаточно нейронов (у тебя ${data.balance} ⚡)`);
    } else if (reason === 'team_disbanded') {
      window.toast?.('Команда расформирована');
    } else {
      window.toast?.('Ошибка при взносе');
      console.error('[mt] donate_to_team:', error, data);
    }
    return;
  }

  window.toast?.(`✅ Внесено ${amount} ⚡ в казну!`);
  const treasuryEl = document.getElementById('mt-treasury-amount');
  if (treasuryEl) treasuryEl.textContent = data.treasury;
  loadMyTeam();
};

function _escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.loadMyTeam = loadMyTeam;
