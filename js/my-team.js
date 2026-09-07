// ── My Team Screen ────────────────────────────────────────────────
// All team writes go through SECURITY DEFINER RPCs (never direct table writes).
// profiles.team_id is guarded by trigger (migration 70+73) — client cannot
// set it directly. RPCs bypass the trigger as function owner.
//
// Data semantics:
//   profiles.team_id          = fast cache of current team
//   team_member_history       = historical source of truth (competition attribution)
//   Both updated atomically by every RPC.
//
// RLS notes (confirmed by reading all migrations 01–74):
//   profiles SELECT: effectively public (leaderboard reads arbitrary user profiles
//     directly without SECURITY DEFINER — confirmed working in prod).
//   currency_ledger SELECT: own rows only ("user reads own ledger").
//   user_super_question_attempts SELECT: own rows only ("attempts_own Attempts").
//   → Roster uses get_my_team_roster() RPC (narrow, stable interface).
//   → Activity uses get_my_team_activity_today() RPC (bypasses own-only RLS).
import { sb } from './services/supabase.js';
import { getState } from './state.js';

// Module-level roster cache — populated by _renderMyTeam, read by click handlers.
// Avoids putting any user-controlled string into inline JS onclick attributes.
let _cachedMembers = [];

// Named delegation handler — stored at module scope so removeEventListener can
// de-duplicate it across repeated loadMyTeam() calls.
function _rosterClickHandler(e) {
  const btn = e.target.closest('[data-mid]');
  if (!btn) return;
  const mid    = btn.dataset.mid;
  const action = btn.dataset.action;
  const member = _cachedMembers.find(m => m.id === mid);
  const name   = member?.display_name || 'Игрок';
  if (action === 'transfer') window._mtDoTransfer(mid, name);
  if (action === 'kick')     window._mtDoKick(mid, name);
}

// ── i18n ─────────────────────────────────────────────────────────────────────
function _lang() {
  return document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
}
const S = {
  myTeam:           { ru: 'Моя Команда',                    en: 'My Team' },
  loading:          { ru: 'Загрузка...',                    en: 'Loading...' },
  signIn:           { ru: 'Войдите в аккаунт',              en: 'Sign in' },
  disbanded:        { ru: 'Команда расформирована',         en: 'Team disbanded' },
  disbandedSub:     { ru: 'Вступи в другую или создай новую.', en: 'Join another or create your own.' },
  findTeam:         { ru: 'Найти команду',                  en: 'Find a team' },
  noTeam:           { ru: 'Ты ещё не в команде',           en: 'You are not in a team' },
  noTeamSub:        { ru: 'Вступи по коду или создай свою', en: 'Join by code or create your own' },
  joinByCode:       { ru: 'Вступить по коду',               en: 'Join by code' },
  codePlaceholder:  { ru: 'Код команды (6 букв)',           en: 'Team code (6 letters)' },
  joinBtn:          { ru: 'Вступить',                       en: 'Join' },
  createTeam:       { ru: 'Создать команду',                en: 'Create a team' },
  namePlaceholder:  { ru: 'Название команды',               en: 'Team name' },
  cityPlaceholder:  { ru: 'Город (необязательно)',          en: 'City (optional)' },
  createBtn:        { ru: 'Создать',                        en: 'Create' },
  captain:          { ru: 'Капитан',                        en: 'Captain' },
  members:          { ru: 'участников',                     en: 'members' },
  invite:           { ru: 'Пригласить',                     en: 'Invite' },
  copyLink:         { ru: 'Скопировать ссылку',             en: 'Copy link' },
  share:            { ru: 'Поделиться',                     en: 'Share' },
  teamCode:         { ru: 'Код',                            en: 'Code' },
  roster:           { ru: 'Состав',                         en: 'Roster' },
  you:              { ru: 'ты',                             en: 'you' },
  scout:            { ru: 'скаут',                          en: 'scout' },
  activityToday:    { ru: 'Активны сегодня',                en: 'Active today' },
  treasury:         { ru: 'Казна',                          en: 'Treasury' },
  teamFund:         { ru: 'Общий баланс команды',           en: 'Team fund' },
  donate:           { ru: 'Пополнить',                      en: 'Contribute' },
  competitions:     { ru: 'Соревнования',                   en: 'Competitions' },
  barQuiz:          { ru: 'Барный квиз',                    en: 'Bar Quiz' },
  onlineQuiz:       { ru: 'Онлайн-квиз',                   en: 'Online Quiz' },
  brainFights:      { ru: 'Brain Fights',                   en: 'Brain Fights' },
  comingSoon:       { ru: 'Скоро',                          en: 'Coming soon' },
  noResults:        { ru: 'Нет результатов',                en: 'No results' },
  rank:             { ru: 'место',                          en: 'rank' },
  of:               { ru: 'из',                             en: 'of' },
  history:          { ru: 'История',                        en: 'History' },
  historyEmpty:     { ru: 'История команды появится после первых соревнований.', en: 'Team history will appear after your first competitions.' },
  settings:         { ru: 'Настройки команды',              en: 'Team settings' },
  editTeam:         { ru: 'Редактировать команду',          en: 'Edit team' },
  transferCaptain:  { ru: 'Передать капитанство',           en: 'Transfer captaincy' },
  kickMember:       { ru: 'Исключить участника',            en: 'Kick member' },
  leaveTeam:        { ru: 'Покинуть команду',               en: 'Leave team' },
  cancel:           { ru: 'Отмена',                         en: 'Cancel' },
  save:             { ru: 'Сохранить',                      en: 'Save' },
  selectMember:     { ru: 'Выбери участника',               en: 'Select a member' },
  transferTo:       { ru: 'Передать капитанство',           en: 'Transfer captaincy to' },
  kickConfirm:      { ru: 'Исключить из команды',           en: 'Kick from team' },
  tiebreak:         { ru: 'очков тай-брейка',              en: 'tiebreak points' },
  lastContribs:     { ru: 'Последние взносы',               en: 'Recent contributions' },
  neuronsFull:      { ru: 'нейронов',                       en: 'neurons' },
};
function t(key) {
  const l = _lang();
  return S[key]?.[l] ?? S[key]?.ru ?? key;
}

// ── Main load ─────────────────────────────────────────────────────────────────
export async function loadMyTeam() {
  const { currentUser } = getState();
  const el = document.getElementById('my-team-screen');
  if (!el) return;

  if (!currentUser) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">${t('signIn')}</div>`;
    return;
  }

  // Handle ?team_code=ABCDEF invite link (canonical form).
  // Also handles legacy ?join=UUID with backward-compat fallback.
  const params = new URLSearchParams(window.location.search);
  const inviteCode = params.get('team_code');
  const inviteUUID = params.get('join');
  if (inviteCode || inviteUUID) {
    history.replaceState({}, '', window.location.pathname);
    setTimeout(() => _handleInviteLink(inviteCode, inviteUUID), 0);
  }

  el.innerHTML = `<div style="padding:60px;text-align:center;color:var(--muted)">${t('loading')}</div>`;

  const { data: me } = await sb.from('profiles')
    .select('team_id, display_name, is_scout')
    .eq('id', currentUser.id)
    .single();

  if (!me?.team_id) {
    _renderNoTeam(el);
    return;
  }

  const weekStart = _getWeekStart();
  const [teamRes, rosterRes, tiebreakRes, barRankRes, onlineRankRes, brainRes, treasuryRes, activityRes] = await Promise.all([
    sb.rpc('get_my_team'),
    sb.rpc('get_my_team_roster'),
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
    sb.rpc('get_my_team_activity_today'),
  ]);

  const team = teamRes.data?.ok ? teamRes.data : null;

  if (!team || team.disbanded_at) {
    _renderDisbanded(el);
    return;
  }

  const tiebreak = tiebreakRes.data ?? 0;

  let members = rosterRes.data?.members || [];
  const captainId = team.captain_id;
  members = [
    ...members.filter(m => m.id === captainId),
    ...members.filter(m => m.id !== captainId),
  ];

  const activeUserIds = activityRes.data?.active_user_ids || [];
  const activeSet = new Set(activeUserIds);
  const activityAvailable = activityRes.error === null;

  const isAdmin   = typeof window.isAdmin === 'function' ? window.isAdmin() : false;
  const isCaptain = captainId === currentUser.id;
  const brainPoints      = brainRes.data?.points ?? null;
  const treasuryContribs = treasuryRes.data || [];

  _renderMyTeam(el, {
    team, members, tiebreak,
    barRankRes, onlineRankRes,
    activeSet, activityAvailable,
    currentUser,
    isAdmin, isCaptain, brainPoints,
    myTeamId: team.id, treasuryContribs,
  });
}

// ── Disbanded ─────────────────────────────────────────────────────────────────
function _renderDisbanded(el) {
  el.innerHTML = `
    ${_hdr('')}
    <div style="padding:60px 24px;display:flex;flex-direction:column;align-items:center;gap:16px;text-align:center">
      <div style="font-size:56px">🏚️</div>
      <div style="font-size:18px;font-weight:900">${t('disbanded')}</div>
      <div style="font-size:13px;color:var(--muted);max-width:280px;line-height:1.6">${t('disbandedSub')}</div>
      <button onclick="window._mtClearAndReload()" class="mt-btn-primary" style="margin-top:8px">
        ${t('findTeam')}
      </button>
    </div>`;
}

window._mtClearAndReload = async function() {
  await sb.rpc('leave_team', {}).catch(() => {});
  loadMyTeam();
};

// ── No team ───────────────────────────────────────────────────────────────────
function _renderNoTeam(el) {
  el.innerHTML = `
    ${_hdr('')}
    <div class="mt-page">
      <div class="mt-noteam-hero">
        <div style="font-size:52px;margin-bottom:14px">👥</div>
        <h1 style="font-size:20px;font-weight:900;margin:0 0 6px">${t('noTeam')}</h1>
        <p style="font-size:13px;color:var(--muted);margin:0">${t('noTeamSub')}</p>
      </div>

      <div class="mt-card">
        <div class="mt-card-label">${t('joinByCode')}</div>
        <input id="mt-join-code" placeholder="${t('codePlaceholder')}" maxlength="8"
          class="mt-input" style="letter-spacing:3px;text-transform:uppercase;text-align:center;font-size:16px"/>
        <button onclick="window._mtJoinTeam()" class="mt-btn-primary" style="margin-top:10px;width:100%">
          ${t('joinBtn')}
        </button>
      </div>

      <div class="mt-card">
        <div class="mt-card-label">${t('createTeam')}</div>
        <input id="mt-create-name" placeholder="${t('namePlaceholder')}" maxlength="60" class="mt-input"/>
        <input id="mt-create-city" placeholder="${t('cityPlaceholder')}" maxlength="60" class="mt-input" style="margin-top:8px"/>
        <button onclick="window._mtCreateTeam()" class="mt-btn-gradient" style="margin-top:10px;width:100%">
          ${t('createBtn')}
        </button>
      </div>
    </div>`;
}

// ── Team rank helper ──────────────────────────────────────────────────────────
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

// ── XSS helpers ───────────────────────────────────────────────────────────────
function _escHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function _escAttr(s) {
  return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Shared header ─────────────────────────────────────────────────────────────
function _hdr(rightSlot) {
  return `
    <div class="hdr mt-hdr">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">${t('myTeam')}</div>
      ${rightSlot || '<div style="width:46px"></div>'}
    </div>`;
}

// ── Main render ───────────────────────────────────────────────────────────────
function _renderMyTeam(el, {
  team, members, tiebreak,
  barRankRes, onlineRankRes,
  activeSet, activityAvailable,
  currentUser,
  isAdmin, isCaptain, brainPoints,
  myTeamId, treasuryContribs,
}) {
  const bar    = barRankRes;
  const online = onlineRankRes;
  const emoji  = _escHtml(team.emoji || '🏟️');

  const safeJoinCode     = _escHtml(team.join_code || '');
  const safeJoinCodeAttr = _escAttr(team.join_code || '');

  // ── HERO ────────────────────────────────────────────────────────────
  const heroAvatar = team.avatar_url
    ? `<img src="${_escAttr(team.avatar_url)}" style="width:100%;height:100%;object-fit:cover" alt="team avatar"/>`
    : `<span style="font-size:34px">${emoji}</span>`;

  const heroBanner = team.banner_url
    ? `<img src="${_escAttr(team.banner_url)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`
    : '';

  const captainMember = members.find(m => m.id === team.captain_id);

  // Cache members in module scope so click handlers can look up names without
  // interpolating user-controlled strings into JS onclick attribute literals.
  _cachedMembers = members;

  // ── ROSTER rows ──────────────────────────────────────────────────────
  const rosterRows = members.map(m => {
    const isThisCaptain = m.id === team.captain_id;
    const isMe          = m.id === currentUser.id;
    const initial       = (m.display_name || '?')[0].toUpperCase();
    const av            = m.avatar_url
      ? `<img src="${_escAttr(m.avatar_url)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`
      : `<span style="font-size:15px;font-weight:800;color:#fff">${_escHtml(initial)}</span>`;

    // Captain-only controls — only the UUID (not display_name) goes into the
    // attribute. The handler looks up display_name from _cachedMembers.
    let controls = '';
    if (isCaptain && !isMe) {
      controls = `
        <div style="display:flex;gap:6px;flex-shrink:0">
          <button data-mid="${_escAttr(m.id)}" data-action="transfer"
            class="mt-member-ctrl mt-ctrl-transfer" title="${t('transferCaptain')}">👑</button>
          <button data-mid="${_escAttr(m.id)}" data-action="kick"
            class="mt-member-ctrl mt-ctrl-kick" title="${t('kickMember')}">✕</button>
        </div>`;
    }

    return `
      <div class="mt-roster-row${isThisCaptain ? ' mt-roster-captain' : ''}">
        <div class="mt-member-av">${av}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
            <span class="mt-member-name">${_escHtml(m.display_name || 'Игрок')}</span>
            ${isMe ? `<span class="mt-badge mt-badge-me">${t('you')}</span>` : ''}
            ${isThisCaptain ? `<span class="mt-badge mt-badge-cap">👑 ${t('captain')}</span>` : ''}
            ${m.is_scout ? `<span class="mt-badge mt-badge-scout">${t('scout')}</span>` : ''}
          </div>
        </div>
        ${controls}
      </div>`;
  }).join('');

  // ── ACTIVITY PULSE ───────────────────────────────────────────────────
  const activitySection = activityAvailable ? `
    <div class="mt-section-hd">${t('activityToday')}: <strong style="color:var(--accent2)">${activeSet.size}/${members.length}</strong></div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:4px">
      ${members.map(m => `
        <div class="mt-pulse-pill${activeSet.has(m.id) ? ' mt-pulse-active' : ''}">
          <div class="mt-pulse-dot${activeSet.has(m.id) ? ' mt-pulse-dot-active' : ''}"></div>
          <span>${_escHtml(m.display_name || 'Игрок')}</span>
        </div>`).join('')}
    </div>` : '';

  // ── COMPETITION SECTION ──────────────────────────────────────────────
  const rankCard = (label, res) => res
    ? `<div class="mt-comp-card">
        <div class="mt-comp-label">${_escHtml(label)}</div>
        <div class="mt-comp-rank">#${res.rank}</div>
        <div class="mt-comp-sub">${t('of')} ${res.total} · ${res.points} pts</div>
       </div>`
    : `<div class="mt-comp-card mt-comp-empty">
        <div class="mt-comp-label">${_escHtml(label)}</div>
        <div class="mt-comp-rank" style="color:var(--muted)">—</div>
        <div class="mt-comp-sub">${t('noResults')}</div>
       </div>`;

  // Brain Fights: show "скоро" if no real points data yet
  const bfCard = (brainPoints !== null && brainPoints > 0)
    ? `<div class="mt-comp-card mt-comp-brain">
        <div class="mt-comp-label">Brain Fights</div>
        <div class="mt-comp-rank" style="color:#3cc864">${brainPoints}</div>
        <div class="mt-comp-sub">очков BF за неделю</div>
       </div>`
    : `<div class="mt-comp-card mt-comp-empty">
        <div class="mt-comp-label">Brain Fights</div>
        <div style="font-size:13px;font-weight:700;color:var(--muted);margin:6px 0 2px">${t('comingSoon')}</div>
        <div class="mt-comp-sub" style="font-size:10px">Backend в разработке</div>
       </div>`;

  // ── TREASURY CONTRIBS ────────────────────────────────────────────────
  const contribRows = treasuryContribs.length ? `
    <div style="margin-top:12px;border-top:0.5px solid var(--border);padding-top:10px">
      <div style="font-size:10px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.8px;margin-bottom:8px">${t('lastContribs')}</div>
      ${treasuryContribs.map(c => `
        <div style="display:flex;justify-content:space-between;padding:5px 0;font-size:12px;border-bottom:0.5px solid rgba(255,255,255,.04)">
          <span style="color:var(--muted)">${_escHtml(c.profiles?.display_name || 'Игрок')}</span>
          <span style="font-weight:700;color:var(--gold)">+${c.amount} ⚡</span>
        </div>`).join('')}
    </div>` : '';

  // ── CAPTAIN SETTINGS ─────────────────────────────────────────────────
  const captainSection = isCaptain ? `
    <div class="mt-section-hd">${t('settings')}</div>
    <div class="mt-card">
      <button onclick="window._mtOpenCaptainEdit()" class="mt-settings-row">
        <span>✏️ ${t('editTeam')}</span>
        <span class="mt-arrow">›</span>
      </button>
    </div>` : '';

  // ── ADMIN SCOUT SECTION ───────────────────────────────────────────────
  const scoutSection = isAdmin ? `
    <div class="mt-card" style="border-color:rgba(255,200,0,.25);background:rgba(255,200,0,.04)">
      <div style="font-size:13px;font-weight:800;margin-bottom:4px;color:#f5c400">Управление скаутами</div>
      <div style="font-size:11px;color:var(--muted)">Только для администраторов</div>
      <div style="font-size:12px;color:var(--muted);background:rgba(255,255,255,.04);border-radius:10px;padding:10px 12px;margin-top:8px;line-height:1.5">
        Назначение скаутов через UI временно недоступно.
      </div>
    </div>` : '';

  // ── TIEBREAK PILL ─────────────────────────────────────────────────────
  const tiebreakPill = tiebreak > 0 ? `
    <div class="mt-tiebreak-pill">
      <strong>${tiebreak}</strong>
      <span>${t('tiebreak')}</span>
    </div>` : '';

  // ── FULL HTML ─────────────────────────────────────────────────────────
  el.innerHTML = `
    ${_hdr(isCaptain
      ? `<button onclick="window._mtOpenCaptainEdit()" class="mt-hdr-edit">${t('editTeam')}</button>`
      : `<div style="width:80px"></div>`)}

    <div class="mt-page">

      <!-- HERO ────────────────────────────────── -->
      <div class="mt-hero-card">
        <div class="mt-hero-banner">
          ${heroBanner}
        </div>
        <div class="mt-hero-av-wrap">
          <div class="mt-hero-av">${heroAvatar}</div>
        </div>
        <div class="mt-hero-body">
          <h1 class="mt-hero-name">${_escHtml(team.name)}</h1>
          ${team.city ? `<div class="mt-hero-city">📍 ${_escHtml(team.city)}</div>` : ''}
          <div class="mt-hero-meta">
            <span class="mt-badge mt-badge-cap">👑 ${_escHtml(captainMember?.display_name || t('captain'))}</span>
            <span class="mt-hero-count">${members.length} ${t('members')}</span>
          </div>
          ${team.motto ? `<div class="mt-hero-motto">"${_escHtml(team.motto)}"</div>` : ''}
          ${tiebreakPill}
        </div>
      </div>

      <!-- INVITE ──────────────────────────────── -->
      <div class="mt-section-hd">${t('invite')}</div>
      <div class="mt-card mt-invite-card">
        ${safeJoinCode ? `
          <div class="mt-invite-code-row">
            <span class="mt-invite-code-label">${t('teamCode')}:</span>
            <strong class="mt-invite-code">${safeJoinCode}</strong>
          </div>` : ''}
        <div class="mt-invite-btns">
          <button onclick="window._mtCopyInvite('${safeJoinCodeAttr}')" class="mt-btn-invite">
            🔗 ${t('copyLink')}
          </button>
          <button onclick="window._mtShareInvite('${safeJoinCodeAttr}')" class="mt-btn-invite-sec">
            ${t('share')}
          </button>
        </div>
      </div>

      <!-- ROSTER ──────────────────────────────── -->
      <div class="mt-section-hd">${t('roster')} · ${members.length} ${t('members')}</div>
      <div class="mt-card" style="padding:8px">
        ${rosterRows}
      </div>

      <!-- ACTIVITY ────────────────────────────── -->
      ${activitySection ? `<div class="mt-card">${activitySection}</div>` : ''}

      <!-- TREASURY ────────────────────────────── -->
      <div class="mt-section-hd">${t('treasury')}</div>
      <div class="mt-card mt-treasury-card">
        <div class="mt-treasury-top">
          <div>
            <div class="mt-treasury-label">${t('treasury')}</div>
            <div class="mt-treasury-sub">${t('teamFund')}</div>
          </div>
          <div id="mt-treasury-amount" class="mt-treasury-amount">${(team.treasury_neurons || 0).toLocaleString('ru')} ⚡</div>
        </div>
        <button onclick="window._mtOpenDonate()" class="mt-btn-donate">${t('donate')}</button>
        ${contribRows}
      </div>

      <!-- COMPETITIONS ────────────────────────── -->
      <div class="mt-section-hd">${t('competitions')}</div>
      <div class="mt-comp-grid">
        ${rankCard(t('barQuiz'), bar)}
        ${rankCard(t('onlineQuiz'), online)}
        ${bfCard}
      </div>

      <!-- HISTORY ─────────────────────────────── -->
      <div class="mt-section-hd">${t('history')}</div>
      <div class="mt-card">
        <p class="mt-history-empty">${t('historyEmpty')}</p>
      </div>

      <!-- CAPTAIN SETTINGS ────────────────────── -->
      ${captainSection}
      ${scoutSection}

      <!-- DANGER ZONE ─────────────────────────── -->
      <div class="mt-danger-zone">
        <button onclick="window._mtLeaveTeam()" class="mt-btn-leave">${t('leaveTeam')}</button>
      </div>

      <div style="height:30px"></div>
    </div>

    <!-- Captain edit modal (hidden) -->
    <div id="mt-captain-edit-modal" class="mt-modal-overlay" style="display:none" onclick="if(event.target===this)window._mtCloseCaptainEdit()">
      <div class="mt-modal">
        <div class="mt-modal-hdr">
          <span class="mt-modal-title">${t('editTeam')}</span>
          <button onclick="window._mtCloseCaptainEdit()" class="mt-modal-close">✕</button>
        </div>
        <div class="mt-modal-body">
          <label class="mt-modal-label">Название</label>
          <input id="mt-edit-name" value="${_escAttr(team.name)}" maxlength="60" class="mt-input"/>
          <label class="mt-modal-label" style="margin-top:10px">Город</label>
          <input id="mt-edit-city" value="${_escAttr(team.city || '')}" maxlength="60" class="mt-input"/>
          <label class="mt-modal-label" style="margin-top:10px">Девиз</label>
          <input id="mt-edit-motto" value="${_escAttr(team.motto || '')}" maxlength="100" placeholder="Ваш девиз..." class="mt-input"/>
          <label class="mt-modal-label" style="margin-top:10px">Эмодзи аватар</label>
          <input id="mt-edit-emoji" value="${_escAttr(team.emoji || '🏟️')}" maxlength="4" class="mt-input" style="width:72px;text-align:center;font-size:18px"/>
          <label class="mt-modal-label" style="margin-top:10px">Аватар (URL)</label>
          <input id="mt-edit-avatar" value="${_escAttr(team.avatar_url || '')}" placeholder="https://..." type="url" class="mt-input"/>
          <label class="mt-modal-label" style="margin-top:10px">Баннер (URL)</label>
          <input id="mt-edit-banner" value="${_escAttr(team.banner_url || '')}" placeholder="https://..." type="url" class="mt-input"/>
        </div>
        <div class="mt-modal-actions">
          <button onclick="window._mtSaveProfile()" class="mt-btn-gradient" style="flex:1">${t('save')}</button>
          <button onclick="window._mtCloseCaptainEdit()" class="mt-btn-sec">${t('cancel')}</button>
        </div>
      </div>
    </div>`;

  // Idempotent delegation: remove before add so repeated loadMyTeam() calls
  // never accumulate duplicate handlers on the same element.
  el.removeEventListener('click', _rosterClickHandler);
  el.addEventListener('click', _rosterClickHandler);
}

// ── Join by code ──────────────────────────────────────────────────────────────
window._mtJoinTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.(t('signIn')); return; }

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

// ── Create team ───────────────────────────────────────────────────────────────
window._mtCreateTeam = async function() {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.(t('signIn')); return; }

  const name = document.getElementById('mt-create-name')?.value?.trim();
  const city = document.getElementById('mt-create-city')?.value?.trim() || null;
  if (!name) { window.toast?.('Введи название команды'); return; }

  const { data, error } = await sb.rpc('create_team', {
    p_name: name, p_city: city, p_emoji: '🏟️',
  });

  if (error) { window.toast?.('Ошибка создания команды'); console.error('[mt] create_team:', error); return; }
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

// ── Leave team ────────────────────────────────────────────────────────────────
window._mtLeaveTeam = async function() {
  if (!confirm('Покинуть команду? Твои результаты сохранятся.')) return;
  const { currentUser } = getState();
  if (!currentUser) return;

  const { data, error } = await sb.rpc('leave_team', {});

  if (error) { window.toast?.('Ошибка при выходе из команды'); console.error('[mt] leave_team:', error); return; }
  if (!data?.ok) {
    if (data?.reason === 'captain_must_transfer') {
      window.toast?.(`👑 Передай капитанство другому игроку, затем выйди.`, 4000);
    } else {
      window.toast?.('Ошибка при выходе из команды');
    }
    return;
  }
  window.toast?.(data.disbanded ? 'Команда расформирована' : 'Ты покинул команду');
  loadMyTeam();
};

// ── Copy / share invite — canonical: ?team_code=ABCDEF ───────────────────────
window._mtCopyInvite = function(joinCode) {
  if (!joinCode) { window.toast?.('Код команды недоступен'); return; }
  const url  = `${window.location.origin}/?team_code=${encodeURIComponent(joinCode)}`;
  const text = `Вступай в мою команду BFC! Код: ${joinCode}\n${url}`;
  navigator.clipboard.writeText(text).then(() => {
    window.toast?.('✅ Ссылка скопирована!');
  }).catch(() => {
    window.toast?.(`Код: ${joinCode}`);
  });
};

window._mtShareInvite = function(joinCode) {
  if (!joinCode) { window.toast?.('Код команды недоступен'); return; }
  const url  = `${window.location.origin}/?team_code=${encodeURIComponent(joinCode)}`;
  const text = `Вступай в мою команду BFC! Код: ${joinCode}`;
  if (navigator.share) {
    navigator.share({ title: 'BFC — команда', text, url }).catch(() => {});
  } else {
    window._mtCopyInvite(joinCode);
  }
};

// ── Handle invite link on page load ──────────────────────────────────────────
async function _handleInviteLink(code, uuid) {
  const { currentUser } = getState();
  if (!currentUser) return;

  if (code) {
    const { data: profile } = await sb.from('profiles')
      .select('team_id').eq('id', currentUser.id).single();
    if (profile?.team_id) return;

    if (!confirm(`Вступить в команду по коду ${_escHtml(code)}?`)) return;
    const { data, error } = await sb.rpc('join_team_by_code', { p_join_code: code });
    if (error || !data?.ok) {
      const msgs = { team_not_found: 'Команда не найдена', already_in_team: 'Ты уже в команде' };
      window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка вступления'));
      return;
    }
    window.toast?.('✅ Ты в команде!');
    loadMyTeam();
    return;
  }

  if (uuid) {
    const { data: pubTeam } = await sb.rpc('get_public_team', { p_team_id: uuid });
    const teamName = pubTeam?.ok ? `«${_escHtml(pubTeam.name)}»` : 'команды';
    window.toast?.(
      `Ссылка приглашения в ${teamName} устарела. Попроси у капитана актуальный код команды.`,
      5000
    );
    loadMyTeam();
  }
}

window._mtJoinViaLink = async function(teamId) {
  await _handleInviteLink(null, teamId);
};

// ── Captain edit modal open/close ─────────────────────────────────────────────
window._mtOpenCaptainEdit = function() {
  const modal = document.getElementById('mt-captain-edit-modal');
  if (modal) { modal.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
};

window._mtCloseCaptainEdit = function() {
  const modal = document.getElementById('mt-captain-edit-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
};

// ── Save team profile (captain only via update_my_team RPC) ──────────────────
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

  if (bannerUrl && !bannerUrl.startsWith('https://')) { window.toast?.('❌ URL баннера должен начинаться с https://'); return; }
  if (avatarUrl && !avatarUrl.startsWith('https://')) { window.toast?.('❌ URL аватара должен начинаться с https://'); return; }

  const { data, error } = await sb.rpc('update_my_team', {
    p_name: name, p_city: city, p_motto: motto, p_emoji: emoji,
    p_banner_url: bannerUrl, p_avatar_url: avatarUrl,
  });

  if (error || !data?.ok) {
    const msgs = {
      not_captain:          'Только капитан может редактировать команду',
      team_disbanded:       'Команда расформирована',
      name_too_short:       'Название слишком короткое',
      name_too_long:        'Название слишком длинное (макс. 60 символов)',
      city_too_long:        'Город — максимум 60 символов',
      motto_too_long:       'Девиз — максимум 100 символов',
      banner_url_not_https: 'URL баннера должен начинаться с https://',
      avatar_url_not_https: 'URL аватара должен начинаться с https://',
      banner_url_too_long:  'URL баннера слишком длинный',
      avatar_url_too_long:  'URL аватара слишком длинный',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка сохранения'));
    console.error('[mt] update_my_team:', error, data);
    return;
  }

  window._mtCloseCaptainEdit();
  window.toast?.('✅ Профиль команды обновлён');
  loadMyTeam();
};

// ── Transfer captain — inline button on roster row ────────────────────────────
window._mtDoTransfer = async function(targetId, targetName) {
  if (!confirm(`Передать капитанство игроку ${targetName}? Ты станешь обычным участником.`)) return;
  const { data, error } = await sb.rpc('transfer_captain', { p_target_user_id: targetId });
  if (error || !data?.ok) {
    const msgs = {
      not_captain:             'Ты не являешься капитаном',
      target_not_in_team:      'Игрок не состоит в вашей команде',
      cannot_transfer_to_self: 'Нельзя передать капитанство себе',
    };
    window.toast?.('❌ ' + (msgs[data?.reason] || 'Ошибка передачи'));
    return;
  }
  window.toast?.('✅ Капитанство передано');
  loadMyTeam();
};

// ── Kick member — inline button on roster row ─────────────────────────────────
window._mtDoKick = async function(targetId, targetName) {
  if (!confirm(`Исключить ${targetName} из команды?`)) return;
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

// Keep legacy window refs in case any external code calls them
window._mtOpenTransfer = function() { window.toast?.('Используй кнопки 👑 в списке состава'); };
window._mtOpenKick     = function() { window.toast?.('Используй кнопки ✕ в списке состава'); };
window._mtTransferCaptain = window._mtDoTransfer;
window._mtKickMember      = window._mtDoKick;
window._mtToggleEdit = function() { window._mtOpenCaptainEdit?.(); };

// ── Treasury donate modal ─────────────────────────────────────────────────────
window._mtOpenDonate = function() {
  document.getElementById('mt-donate-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'mt-donate-overlay';
  overlay.className = 'mt-modal-overlay';
  overlay.innerHTML = `
    <div class="mt-modal">
      <div class="mt-modal-hdr">
        <span class="mt-modal-title">Пополнить казну</span>
        <button onclick="document.getElementById('mt-donate-overlay').remove()" class="mt-modal-close">✕</button>
      </div>
      <div class="mt-modal-body">
        <p style="font-size:12px;color:var(--muted);margin:0 0 14px">Нейроны перейдут в общий фонд команды</p>
        <div style="display:flex;gap:8px;margin-bottom:12px">
          ${[50, 100, 300].map(n => `
            <button onclick="document.getElementById('mt-donate-input').value=${n}"
              class="mt-donate-preset">${n}</button>`).join('')}
        </div>
        <input id="mt-donate-input" type="number" min="1" max="10000" placeholder="Или введи своё число" class="mt-input"/>
      </div>
      <div class="mt-modal-actions">
        <button onclick="window._mtDonate()" class="mt-btn-gradient" style="flex:1">Внести ⚡</button>
        <button onclick="document.getElementById('mt-donate-overlay').remove()" class="mt-btn-sec">${t('cancel')}</button>
      </div>
    </div>`;
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
};

window._mtDonate = async function() {
  const input  = document.getElementById('mt-donate-input');
  const amount = parseInt(input?.value, 10);
  if (!amount || amount <= 0) { window.toast?.('Введи сумму'); return; }
  if (amount > 10000)         { window.toast?.('Максимум 10 000 за раз'); return; }

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
  if (treasuryEl) treasuryEl.textContent = (data.treasury || 0).toLocaleString('ru') + ' ⚡';
  loadMyTeam();
};

window.loadMyTeam = loadMyTeam;
