// brain-fights.js — Brain Fights Core screen
//
// Data source after migration 76:
//   get_brain_fights_week() SECURITY DEFINER RPC — single call returns
//   everything aggregated server-side from brain_fight_contributions.
//
// Security contract:
//   Client never writes BF points. All scoring via SECURITY DEFINER RPCs.
//   Training and Duel excluded from official score until server-authoritative.
//   Only Super Question (server-verified) contributes to official BF.
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
  rank:           { ru: 'место',                                      en: 'place' },
  of:             { ru: 'из',                                         en: 'of' },
  contributors:   { ru: 'Вклад команды',                            en: 'Team contributions' },
  myContrib:      { ru: 'Мой вклад на этой неделе',                 en: 'My contribution this week' },
  superq:         { ru: 'Суперквиз',                                 en: 'Super Q' },
  total:          { ru: 'Итого',                                      en: 'Total' },
  leaderboard:    { ru: 'Лидерборд',                                 en: 'Leaderboard' },
  tabGlobal:      { ru: 'Глобальный',                                en: 'Global' },
  tabCity:        { ru: 'По городу',                                  en: 'City' },
  howToEarn:      { ru: 'Как помочь команде',                        en: 'How to contribute' },
  earn1:          { ru: '🧠 Отвечай на Суперквиз каждый день (+5 за правильный ответ, +1 за попытку)', en: '🧠 Answer the Super Question daily (+5 correct, +1 for any attempt)' },
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

// ── Week label (display only — server determines canonical week_start) ────────
function _weekLabel(startStr) {
  const start = new Date(startStr + 'T00:00:00Z');
  const end   = new Date(start); end.setUTCDate(end.getUTCDate() + 6);
  const lang  = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  const fmt    = { day: 'numeric', month: 'long' };
  const startDay = start.getUTCDate();
  const endDay   = end.getUTCDate();
  if (start.getUTCMonth() === end.getUTCMonth()) {
    const monthStr = end.toLocaleDateString(locale, { month: 'long' }).replace(' г.','');
    return `${startDay} – ${endDay} ${monthStr}`;
  }
  const s = start.toLocaleDateString(locale, fmt).replace(' г.','');
  const e = end.toLocaleDateString(locale, fmt).replace(' г.','');
  return `${s} – ${e}`;
}

// ── Header ────────────────────────────────────────────────────────────────────
function _hdr() {
  return `
    <div class="hdr bf-hdr">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🧠 ${_t('title')}</div>
      <div style="width:46px"></div>
    </div>`;
}

// ── Main load — single authoritative RPC call ─────────────────────────────────
export async function loadBrainFights() {
  const el = document.getElementById('brain-fights-screen');
  if (!el) return;

  const { currentUser } = getState();
  if (!currentUser) { _renderSignIn(el); return; }

  el.innerHTML = `${_hdr()}<div style="padding:60px;text-align:center;color:var(--muted)">${_t('loading')}</div>`;

  try {
    const { data, error } = await sb.rpc('get_brain_fights_week');
    if (error) throw error;

    if (!data?.ok) {
      const reason = data?.reason;
      if (reason === 'no_team')           { _renderNoTeam(el);    return; }
      if (reason === 'disbanded')         { _renderDisbanded(el); return; }
      if (reason === 'not_authenticated') { _renderSignIn(el);    return; }
      throw new Error(reason || 'unknown');
    }

    _renderBF(el, data, currentUser.id);
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
// data shape from get_brain_fights_week():
//   { ok, week_start, week_end, my_team, my_contrib, contributors, leaderboard, history }
function _renderBF(el, data, myUserId) {
  const { week_start, my_team, my_contrib, contributors, leaderboard, history } = data;

  const weekLbl  = _weekLabel(week_start);
  const teamCity = my_team.city || '';

  // HERO — global rank (server-derived)
  const rankDisplay = my_team.global_rank
    ? `#${my_team.global_rank} ${_t('of')} ${my_team.total_global_teams ?? ''}`
    : '—';
  const heroScoreColor = my_team.points > 0 ? '#3cc864' : 'var(--muted)';

  // CONTRIBUTORS — from RPC (already filtered to verified superq contributions)
  const contribList = (contributors || []);
  const top3 = contribList.filter(c => c.rn <= 3);
  const rest  = contribList.filter(c => c.rn > 3);

  const top3Cards = top3.length ? top3.map((c, i) => {
    const medals  = ['🥇','🥈','🥉'];
    const initial = (c.display_name || '?')[0].toUpperCase();
    const av = c.avatar_url
      ? `<img src="${_esc(c.avatar_url)}" style="width:100%;height:100%;object-fit:cover" alt=""/>`
      : `<span style="font-size:13px;font-weight:800;color:#fff">${_esc(initial)}</span>`;
    return `
      <div class="bf-contrib-card${c.is_me ? ' bf-contrib-me' : ''}">
        <div class="bf-contrib-medal">${medals[i]}</div>
        <div class="bf-contrib-av">${av}</div>
        <div class="bf-contrib-name">${_esc(c.display_name || 'Игрок')}</div>
        <div class="bf-contrib-pts">${c.points} <span style="font-size:10px;font-weight:600">${_t('pts')}</span></div>
      </div>`;
  }).join('') : `<p style="font-size:13px;color:var(--muted);padding:16px 0;text-align:center;margin:0">${_t('noActivity')}</p>`;

  const restRows = rest.map(c => `
    <div class="bf-contrib-row${c.is_me ? ' bf-contrib-me-row' : ''}">
      <span class="bf-contrib-row-name">${_esc(c.display_name || 'Игрок')}${c.is_me ? ' <span class="bf-me-badge">ты</span>' : ''}</span>
      <span class="bf-contrib-row-pts">${c.points} ${_t('pts')}</span>
    </div>`).join('');

  // MY CONTRIBUTION — superq only (no unsafe duel/training)
  const superqPts = my_contrib?.superq_pts || 0;

  const myContribCard = `
    <div class="bf-card bf-mycontrib-card">
      <div class="bf-section-hd">${_t('myContrib')}</div>
      <div class="bf-mycontrib-total">${superqPts} <span style="font-size:14px;color:var(--muted);font-weight:600">${_t('pts')}</span></div>
      <div class="bf-mycontrib-rows">
        <div class="bf-mycontrib-row">
          <span>🧠 ${_t('superq')}</span>
          <span class="bf-mc-pts">${superqPts}</span>
        </div>
      </div>
    </div>`;

  // LEADERBOARD — from RPC
  const hasCityTab = !!teamCity;
  const cityEntries = hasCityTab
    ? (leaderboard || []).filter(r => r.city?.trim().toLowerCase() === teamCity.trim().toLowerCase())
    : [];

  // Global tab uses global_rank; city tab uses server-computed city_rank
  const lbRowsGlobal = _lbRows(leaderboard || [], 'global_rank');
  const lbRowsCity   = hasCityTab ? _lbRows(cityEntries, 'city_rank') : '';

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

  // HISTORY — i18n dates and rank suffix
  const lang = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const dateLocale = lang === 'en' ? 'en-US' : 'ru-RU';
  const rankSuffix = _t('rank');

  const historyRows = (history || []).length ? (history || []).map(h => {
    const d = new Date(h.created_at);
    const dateStr = d.toLocaleDateString(dateLocale, { day: 'numeric', month: 'long' });
    return `
      <div class="bf-history-row">
        <span>#${h.rank} ${_esc(rankSuffix)}</span>
        <span style="color:var(--muted);font-size:11px">${_esc(dateStr)}</span>
        <span class="bf-history-pts">${h.points_earned} ${_t('pts')}</span>
      </div>`;
  }).join('') : `<p class="bf-empty-label">${_t('historyEmpty')}</p>`;

  // WEEKLY ARENA card (loaded async, injected after render)
  const arenaCardId = 'bf-arena-card';

  // HOW TO EARN
  const howToEarn = `
    <div id="${arenaCardId}"></div>
    <div class="bf-card bf-how-card">
      <div class="bf-section-hd">${_t('howToEarn')}</div>
      <div class="bf-how-list">
        <div class="bf-how-row">${_t('earn1')}</div>
        <div class="bf-how-row">${_t('earn2')}</div>
        <div class="bf-how-row">${_t('earn3')}</div>
      </div>
      <button onclick="showScreen('home')" class="bf-btn-cta" style="margin-top:14px;width:100%">
        🧠 ${_t('superq')} →
      </button>
    </div>`;

  // FULL HTML
  el.innerHTML = `
    ${_hdr()}
    <div class="bf-page">

      <div class="bf-hero-card">
        <div class="bf-hero-week">${_t('weekLabel')}: ${_esc(weekLbl)}</div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
          <div class="bf-team-emoji">${_esc(my_team.emoji || '🏟️')}</div>
          <div style="flex:1;min-width:0">
            <div class="bf-hero-teamname">${_esc(my_team.name)}</div>
            ${my_team.city ? `<div class="bf-hero-city">📍 ${_esc(my_team.city)}</div>` : ''}
          </div>
        </div>
        <div class="bf-hero-score-row">
          <div class="bf-hero-score" style="color:${heroScoreColor}">${my_team.points}</div>
          <div class="bf-hero-score-lbl">${_t('teamScore')}</div>
          <div class="bf-hero-rank">${rankDisplay}</div>
        </div>
      </div>

      ${myContribCard}

      <div class="bf-section-hd">${_t('contributors')}</div>
      <div class="bf-top3-grid">${top3Cards}</div>
      ${rest.length ? `<div class="bf-card" style="padding:8px">${restRows}</div>` : ''}

      ${lbSection}

      ${howToEarn}

      <div class="bf-section-hd">${_t('history')}</div>
      <div class="bf-card">${historyRows}</div>

      <div style="height:30px"></div>
    </div>`;

  // Async: inject Weekly Arena card if arena is live/upcoming
  _injectArenaCard();
}

async function _injectArenaCard() {
  const slot = document.getElementById('bf-arena-card');
  if (!slot || !window.sb) return;
  try {
    const { data } = await window.sb.rpc('get_weekly_arena');
    if (!data?.ok) return;
    const a = data.arena;
    if (a.status === 'finished') return; // don't clutter BF screen with old arenas
    const statusLabel = { upcoming: '⏰ Скоро', live: '🔴 Live' }[a.status] || '';
    const endsAt = a.status === 'live'
      ? 'До ' + new Date(a.ends_at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'Начало ' + new Date(a.starts_at).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    slot.innerHTML = `
      <div class="bf-card" style="border:1px solid rgba(60,200,100,.25);cursor:pointer"
           onclick="showScreen('weekly-arena-screen');window.loadWeeklyArena?.()">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div>
            <div style="font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#3cc864;font-weight:700;margin-bottom:4px">Weekly Arena ${statusLabel}</div>
            <div style="font-size:15px;font-weight:800;color:var(--text)">${_esc(a.title)}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:3px">${_esc(endsAt)}</div>
          </div>
          <span style="color:var(--accent);font-size:20px;font-weight:900">›</span>
        </div>
      </div>`;
  } catch (_) {}
}

// ── Leaderboard rows ───────────────────────────────────────────────────────────
// rankKey: 'global_rank' for the global tab, 'city_rank' for the city tab.
// city_rank is server-computed (PARTITION BY city) — not derived from array position.
function _lbRows(entries, rankKey = 'global_rank') {
  if (!entries.length) {
    return `<p class="bf-empty-label" style="padding:12px 8px">${_t('noActivity')}</p>`;
  }
  return entries.map(r => `
    <div class="bf-lb-row${r.is_my_team ? ' bf-lb-me' : ''}">
      <span class="bf-lb-rank">#${r[rankKey] ?? '—'}</span>
      <span class="bf-lb-emoji">${_esc(r.emoji || '🏟️')}</span>
      <span class="bf-lb-name">${_esc(r.name || '—')}</span>
      ${r.city ? `<span class="bf-lb-city">${_esc(r.city)}</span>` : ''}
      <span class="bf-lb-pts">${r.points} ${_t('pts')}</span>
    </div>`).join('');
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
