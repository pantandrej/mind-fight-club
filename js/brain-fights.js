// brain-fights.js — Brain Fights Core screen
// Architecture:
//   player_weekly_bf_points  → per-player weekly BF points (public SELECT)
//   team_weekly_brain_fights → per-team weekly aggregation (computed by cron, public SELECT)
//   challenge_results        → finalized historical results (public SELECT, server-written)
//   teams                    → team metadata (public SELECT for safe columns)
//
// Security:
//   Client never writes BF points directly. All scoring is through SECURITY DEFINER RPCs
//   called by the player at activity time, aggregated nightly by a cron job.
//   Training BF (record_training_bf) is DISABLED — p_correct was client-supplied.
//   Duel BF (record_duel_win_bf) is client self-reported — included in the system
//   but NOT promoted in UI as a trustworthy metric.
//   Super Question BF is the primary safe source (server-enforced daily cap).
import { sb }       from './services/supabase.js';
import { getState } from './state.js';

// ── i18n ──────────────────────────────────────────────────────────────────────
const BF = {
  title:          { ru: 'Brain Fights',                               en: 'Brain Fights' },
  loading:        { ru: 'Загрузка...',                                en: 'Loading...' },
  signIn:         { ru: 'Войдите, чтобы видеть Brain Fights',        en: 'Sign in to see Brain Fights' },
  noTeam:         { ru: 'Вступи в команду',                          en: 'Join a team' },
  noTeamSub:      { ru: 'Brain Fights — командное соревнование. Без команды нет вклада.', en: 'Brain Fights is a team competition. Join a team first.' },
  joinTeam:       { ru: 'Найти команду →',                          en: 'Find a team →' },
  weekLabel:      { ru: 'Неделя',                                    en: 'Week' },
  teamScore:      { ru: 'Очков BF',                                  en: 'BF Points' },
  rank:           { ru: 'место',                                      en: 'rank' },
  of:             { ru: 'из',                                         en: 'of' },
  contributors:   { ru: 'Вклад команды',                            en: 'Team contributions' },
  myContrib:      { ru: 'Мой вклад на этой неделе',                 en: 'My contribution this week' },
  superq:         { ru: 'Суперквиз',                                 en: 'Super Q' },
  duels:          { ru: 'Дуэли',                                     en: 'Duels' },
  training:       { ru: 'Тренировки',                                en: 'Training' },
  total:          { ru: 'Итого',                                      en: 'Total' },
  leaderboard:    { ru: 'Лидерборд',                                 en: 'Leaderboard' },
  tabGlobal:      { ru: 'Глобальный',                                en: 'Global' },
  tabCity:        { ru: 'По городу',                                  en: 'City' },
  howToEarn:      { ru: 'Как помочь команде',                        en: 'How to contribute' },
  earn1:          { ru: '🧠 Отвечай на Суперквиз каждый день (+5 за правильный ответ)', en: '🧠 Answer the Super Question daily (+5 for correct)' },
  earn2:          { ru: '📈 Твои очки суммируются в недельный счёт команды', en: '📈 Your points add to your team\'s weekly score' },
  earn3:          { ru: '🏆 Топ команды определяется в воскресенье',  en: '🏆 Top teams ranked every Sunday' },
  noActivity:     { ru: 'Очков ещё нет. Сыграй Суперквиз!',         en: 'No points yet. Play the Super Question!' },
  history:        { ru: 'История',                                    en: 'History' },
  historyEmpty:   { ru: 'История Brain Fights появится после первого сезона.', en: 'Brain Fights history will appear after the first season.' },
  pts:            { ru: 'очк.',                                       en: 'pts' },
  errorLoad:      { ru: 'Ошибка загрузки. Попробуй ещё раз.',       en: 'Load error. Try again.' },
  retry:          { ru: 'Обновить',                                   en: 'Retry' },
  noCityData:     { ru: 'Город команды не указан — показываем глобальный рейтинг.', en: 'Team city not set — showing global ranking.' },
  disbanded:      { ru: 'Команда расформирована',                    en: 'Team disbanded' },
  disbandedSub:   { ru: 'Вступи в активную команду, чтобы участвовать в Brain Fights.', en: 'Join an active team to participate.' },
  backHome:       { ru: '← Главная',                                 en: '← Home' },
};

function _t(key) {
  const l = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  return BF[key]?.[l] ?? BF[key]?.ru ?? key;
}

// ── XSS ───────────────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Week helpers ──────────────────────────────────────────────────────────────
function _weekStart() {
  const d   = new Date();
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  const mon  = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + diff));
  return mon.toISOString().slice(0, 10);
}

function _weekLabel(startStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end   = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const lang  = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const fmt    = { day: 'numeric', month: 'long' };
  const s = start.toLocaleDateString(locale, fmt).replace(' г.','');
  const e = end.toLocaleDateString(locale, fmt).replace(' г.','');
  // Remove repeated month if same: "7 – 13 сентября"
  const startDay = start.getUTCDate();
  const endDay   = end.getUTCDate();
  if (start.getUTCMonth() === end.getUTCMonth()) {
    const monthStr = end.toLocaleDateString(locale, { month: 'long' }).replace(' г.','');
    return `${startDay} – ${endDay} ${monthStr}`;
  }
  return `${s} – ${e}`;
}

// ── Header helper ─────────────────────────────────────────────────────────────
function _hdr() {
  return `
    <div class="hdr bf-hdr">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🧠 ${_t('title')}</div>
      <div style="width:46px"></div>
    </div>`;
}

// ── Main load ─────────────────────────────────────────────────────────────────
export async function loadBrainFights() {
  const el = document.getElementById('brain-fights-screen');
  if (!el) return;

  const { currentUser } = getState();
  if (!currentUser) {
    _renderSignIn(el);
    return;
  }

  el.innerHTML = `${_hdr()}<div style="padding:60px;text-align:center;color:var(--muted)">${_t('loading')}</div>`;

  try {
    const weekStart = _weekStart();

    // 1. Get user's current team
    const { data: me } = await sb.from('profiles')
      .select('team_id')
      .eq('id', currentUser.id)
      .single();

    if (!me?.team_id) {
      _renderNoTeam(el);
      return;
    }

    // 2. Parallel fetch everything needed
    const [
      teamRes,
      rosterRes,
      myContribRes,
      teamBFRes,
      allTeamsBFRes,
      historyRes,
    ] = await Promise.all([
      sb.rpc('get_my_team'),
      sb.rpc('get_my_team_roster'),
      sb.from('player_weekly_bf_points')
        .select('training_pts,duel_pts,superq_pts')
        .eq('user_id', currentUser.id)
        .eq('week_start', weekStart)
        .maybeSingle(),
      sb.from('team_weekly_brain_fights')
        .select('points')
        .eq('team_id', me.team_id)
        .eq('week_start', weekStart)
        .maybeSingle(),
      sb.from('team_weekly_brain_fights')
        .select('team_id, points')
        .eq('week_start', weekStart)
        .order('points', { ascending: false })
        .limit(100),
      sb.from('challenge_results')
        .select('rank,points_earned,created_at')
        .eq('challenge_type', 'brain_fights')
        .eq('team_id', me.team_id)
        .order('created_at', { ascending: false })
        .limit(5),
    ]);

    const team = teamRes.data?.ok ? teamRes.data : null;
    if (!team || team.disbanded_at) {
      _renderDisbanded(el);
      return;
    }

    const members = rosterRes.data?.members || [];
    const memberIds = members.map(m => m.id);

    // 3. Fetch contributor points for all team members
    const { data: contribData } = memberIds.length ? await sb
      .from('player_weekly_bf_points')
      .select('user_id,training_pts,duel_pts,superq_pts')
      .eq('week_start', weekStart)
      .in('user_id', memberIds) : { data: [] };

    // 4. Fetch team names for leaderboard
    const lbEntries  = allTeamsBFRes.data || [];
    const lbTeamIds  = lbEntries.map(r => r.team_id);
    const { data: lbTeams } = lbTeamIds.length ? await sb
      .from('teams')
      .select('id,name,city,emoji')
      .in('id', lbTeamIds) : { data: [] };

    const teamMap = {};
    for (const t of (lbTeams || [])) teamMap[t.id] = t;

    // Build ranked leaderboard entries (points already sorted desc from DB)
    const rankedLB = lbEntries.map((entry, i) => ({
      rank: i + 1,
      teamId: entry.team_id,
      points: entry.points,
      ...teamMap[entry.team_id],
    }));

    // Find my team rank
    const myRankEntry = rankedLB.find(r => r.teamId === me.team_id);
    const myTeamPoints = teamBFRes.data?.points ?? 0;

    _renderBF(el, {
      team, members,
      weekStart,
      myContrib:  myContribRes.data,
      contributions: contribData || [],
      rankedLB,
      myRankEntry,
      myTeamPoints,
      history: historyRes.data || [],
      currentUser,
    });

  } catch (err) {
    console.error('[BF] load error:', err);
    _renderError(el, err?.message);
  }
}

// ── State: no team ─────────────────────────────────────────────────────────────
function _renderNoTeam(el) {
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">
      <div class="bf-empty-hero">
        <div style="font-size:52px;margin-bottom:14px">🧠</div>
        <h1 style="font-size:20px;font-weight:900;margin:0 0 8px">${_t('noTeam')}</h1>
        <p style="font-size:13px;color:var(--muted);margin:0;line-height:1.6;max-width:280px">${_t('noTeamSub')}</p>
        <button onclick="showScreen('my-team-screen');window.loadMyTeam?.()"
          class="bf-btn-cta" style="margin-top:20px">${_t('joinTeam')}</button>
      </div>
    </div>`;
}

// ── State: disbanded ───────────────────────────────────────────────────────────
function _renderDisbanded(el) {
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">
      <div class="bf-empty-hero">
        <div style="font-size:52px;margin-bottom:14px">🏚️</div>
        <h1 style="font-size:20px;font-weight:900;margin:0 0 8px">${_t('disbanded')}</h1>
        <p style="font-size:13px;color:var(--muted);margin:0;line-height:1.6;max-width:280px">${_t('disbandedSub')}</p>
        <button onclick="showScreen('my-team-screen');window.loadMyTeam?.()"
          class="bf-btn-cta" style="margin-top:20px">${_t('joinTeam')}</button>
      </div>
    </div>`;
}

// ── State: signed out ──────────────────────────────────────────────────────────
function _renderSignIn(el) {
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">
      <div class="bf-empty-hero">
        <div style="font-size:52px;margin-bottom:14px">🧠</div>
        <p style="font-size:14px;color:var(--muted);margin:0">${_t('signIn')}</p>
      </div>
    </div>`;
}

// ── State: error ───────────────────────────────────────────────────────────────
function _renderError(el, msg) {
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">
      <div class="bf-empty-hero">
        <div style="font-size:48px;margin-bottom:14px">⚠️</div>
        <p style="font-size:14px;color:var(--muted);margin:0 0 16px">${_t('errorLoad')}</p>
        <button onclick="window.loadBrainFights?.()" class="bf-btn-sec">${_t('retry')}</button>
      </div>
    </div>`;
}

// ── Main render ────────────────────────────────────────────────────────────────
function _renderBF(el, {
  team, members, weekStart, myContrib, contributions,
  rankedLB, myRankEntry, myTeamPoints, history, currentUser,
}) {
  const weekLbl  = _weekLabel(weekStart);
  const myTotal  = (myContrib?.superq_pts || 0) + (myContrib?.duel_pts || 0) + (myContrib?.training_pts || 0);
  const teamCity = team.city || '';

  // ── HERO ─────────────────────────────────────────────────────────────
  const rankDisplay = myRankEntry
    ? `#${myRankEntry.rank} ${_t('of')} ${rankedLB.length}`
    : '—';

  const heroScoreColor = myTeamPoints > 0 ? '#3cc864' : 'var(--muted)';

  // ── CONTRIBUTORS ─────────────────────────────────────────────────────
  // Merge member roster with their BF points, sort by total desc
  const contribMap = {};
  for (const c of contributions) {
    contribMap[c.user_id] = (c.superq_pts || 0) + (c.duel_pts || 0) + (c.training_pts || 0);
  }
  const contribList = members
    .map(m => ({ ...m, bfPts: contribMap[m.id] || 0 }))
    .sort((a, b) => b.bfPts - a.bfPts)
    .filter(m => m.bfPts > 0);

  const top3 = contribList.slice(0, 3);
  const rest  = contribList.slice(3);

  const top3Cards = top3.length ? top3.map((m, i) => {
    const medals = ['🥇','🥈','🥉'];
    const initial = (m.display_name || '?')[0].toUpperCase();
    const av = m.avatar_url
      ? `<img src="${_esc(m.avatar_url)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`
      : `<span style="font-size:13px;font-weight:800;color:#fff">${_esc(initial)}</span>`;
    const isMe = m.id === currentUser.id;
    return `
      <div class="bf-contrib-card${isMe ? ' bf-contrib-me' : ''}">
        <div class="bf-contrib-medal">${medals[i]}</div>
        <div class="bf-contrib-av">${av}</div>
        <div class="bf-contrib-name">${_esc(m.display_name || 'Игрок')}</div>
        <div class="bf-contrib-pts">${m.bfPts} <span style="font-size:10px;font-weight:600">${_t('pts')}</span></div>
      </div>`;
  }).join('') : `<p style="font-size:13px;color:var(--muted);padding:16px 0;text-align:center;margin:0">${_t('noActivity')}</p>`;

  const restRows = rest.map(m => {
    const isMe = m.id === currentUser.id;
    return `
      <div class="bf-contrib-row${isMe ? ' bf-contrib-me-row' : ''}">
        <span class="bf-contrib-row-name">${_esc(m.display_name || 'Игрок')}${isMe ? ' <span class="bf-me-badge">ты</span>' : ''}</span>
        <span class="bf-contrib-row-pts">${m.bfPts} ${_t('pts')}</span>
      </div>`;
  }).join('');

  // ── MY CONTRIBUTION CARD ──────────────────────────────────────────────
  const superqPts   = myContrib?.superq_pts   || 0;
  const duelPts     = myContrib?.duel_pts     || 0;

  const myContribCard = `
    <div class="bf-card bf-mycontrib-card">
      <div class="bf-section-hd">${_t('myContrib')}</div>
      <div class="bf-mycontrib-total">${myTotal} <span style="font-size:14px;color:var(--muted);font-weight:600">${_t('pts')}</span></div>
      <div class="bf-mycontrib-rows">
        <div class="bf-mycontrib-row">
          <span>🧠 ${_t('superq')}</span>
          <span class="bf-mc-pts">${superqPts}</span>
        </div>
        <div class="bf-mycontrib-row">
          <span>⚔️ ${_t('duels')}</span>
          <span class="bf-mc-pts" style="color:var(--muted)">${duelPts}</span>
        </div>
      </div>
    </div>`;

  // ── LEADERBOARD ────────────────────────────────────────────────────────
  const hasCityTab  = !!teamCity;
  const cityTeams   = hasCityTab
    ? rankedLB.filter(r => r.city?.toLowerCase() === teamCity.toLowerCase())
    : [];

  const lbRowsGlobal = _lbRows(rankedLB, me_team_id(team));
  const lbRowsCity   = hasCityTab ? _lbRows(cityTeams, me_team_id(team)) : '';

  const cityTabHtml = hasCityTab ? `
    <button class="bf-tab" id="bf-tab-city" onclick="window._bfSwitchTab('city')">${_t('tabCity')}: ${_esc(teamCity)}</button>` : '';

  const cityNoteHtml = !hasCityTab ? `
    <div style="font-size:11px;color:var(--muted);margin:-4px 0 8px;padding:0 4px">${_t('noCityData')}</div>` : '';

  const lbSection = `
    <div class="bf-section-hd">${_t('leaderboard')}</div>
    ${cityNoteHtml}
    <div class="bf-tabs">
      <button class="bf-tab bf-tab-active" id="bf-tab-global" onclick="window._bfSwitchTab('global')">${_t('tabGlobal')}</button>
      ${cityTabHtml}
    </div>
    <div class="bf-card" style="padding:8px">
      <div id="bf-lb-global">${lbRowsGlobal}</div>
      <div id="bf-lb-city" style="display:none">${lbRowsCity}</div>
    </div>`;

  // ── HISTORY ────────────────────────────────────────────────────────────
  const historyRows = history.length ? history.map(h => {
    const d = new Date(h.created_at);
    const dateStr = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    return `
      <div class="bf-history-row">
        <span>#${h.rank} место</span>
        <span style="color:var(--muted);font-size:11px">${_esc(dateStr)}</span>
        <span class="bf-history-pts">${h.points_earned} ${_t('pts')}</span>
      </div>`;
  }).join('') : `<p class="bf-empty-label">${_t('historyEmpty')}</p>`;

  // ── HOW TO EARN ────────────────────────────────────────────────────────
  const howToEarn = `
    <div class="bf-card bf-how-card">
      <div class="bf-section-hd">${_t('howToEarn')}</div>
      <div class="bf-how-list">
        <div class="bf-how-row">${_t('earn1')}</div>
        <div class="bf-how-row">${_t('earn2')}</div>
        <div class="bf-how-row">${_t('earn3')}</div>
      </div>
      <button onclick="showScreen('home')" class="bf-btn-cta" style="margin-top:14px;width:100%">
        🧠 Играть Суперквиз →
      </button>
    </div>`;

  // ── FULL HTML ──────────────────────────────────────────────────────────
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">

      <!-- HERO card -->
      <div class="bf-hero-card">
        <div class="bf-hero-week">${_t('weekLabel')}: ${_esc(weekLbl)}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
          <div class="bf-team-emoji">${_esc(team.emoji || '🏟️')}</div>
          <div style="flex:1;min-width:0">
            <div class="bf-hero-teamname">${_esc(team.name)}</div>
            ${team.city ? `<div class="bf-hero-city">📍 ${_esc(team.city)}</div>` : ''}
          </div>
        </div>
        <div class="bf-hero-score-row">
          <div class="bf-hero-score" style="color:${heroScoreColor}">${myTeamPoints}</div>
          <div class="bf-hero-score-lbl">${_t('teamScore')}</div>
          <div class="bf-hero-rank">${rankDisplay}</div>
        </div>
      </div>

      <!-- My contribution -->
      ${myContribCard}

      <!-- Contributors -->
      <div class="bf-section-hd">${_t('contributors')}</div>
      <div class="bf-top3-grid">${top3Cards}</div>
      ${rest.length ? `<div class="bf-card" style="padding:8px">${restRows}</div>` : ''}

      <!-- Leaderboard -->
      ${lbSection}

      <!-- How to earn -->
      ${howToEarn}

      <!-- History -->
      <div class="bf-section-hd">${_t('history')}</div>
      <div class="bf-card">${historyRows}</div>

      <div style="height:30px"></div>
    </div>`;
}

// ── Leaderboard rows helper ───────────────────────────────────────────────────
function me_team_id(team) { return team?.id; }

function _lbRows(entries, myTeamId) {
  if (!entries.length) {
    return `<p class="bf-empty-label" style="padding:12px 8px">${BF.noActivity?.ru}</p>`;
  }
  return entries.map(r => {
    const isMe = r.teamId === myTeamId;
    return `
      <div class="bf-lb-row${isMe ? ' bf-lb-me' : ''}">
        <span class="bf-lb-rank">#${r.rank}</span>
        <span class="bf-lb-emoji">${_esc(r.emoji || '🏟️')}</span>
        <span class="bf-lb-name">${_esc(r.name || '—')}</span>
        ${r.city ? `<span class="bf-lb-city">${_esc(r.city)}</span>` : ''}
        <span class="bf-lb-pts">${r.points} ${_t('pts')}</span>
      </div>`;
  }).join('');
}

// ── Tab switcher ───────────────────────────────────────────────────────────────
window._bfSwitchTab = function(tab) {
  const globalPanel = document.getElementById('bf-lb-global');
  const cityPanel   = document.getElementById('bf-lb-city');
  const globalBtn   = document.getElementById('bf-tab-global');
  const cityBtn     = document.getElementById('bf-tab-city');

  if (tab === 'global') {
    if (globalPanel) globalPanel.style.display = '';
    if (cityPanel)   cityPanel.style.display   = 'none';
    globalBtn?.classList.add('bf-tab-active');
    cityBtn?.classList.remove('bf-tab-active');
  } else {
    if (globalPanel) globalPanel.style.display = 'none';
    if (cityPanel)   cityPanel.style.display   = '';
    globalBtn?.classList.remove('bf-tab-active');
    cityBtn?.classList.add('bf-tab-active');
  }
};

window.loadBrainFights = loadBrainFights;
