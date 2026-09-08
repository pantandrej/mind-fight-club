// home-dashboard.js — authenticated home dashboard renderer

import { getState } from './state.js';

// ── i18n helper (falls back to key) ──────────────────────────────────────────
function _t(key, ru, en) {
  const lang = typeof window.t === 'function' ? null : null; // resolved below
  if (typeof window.t === 'function') {
    const v = window.t(key);
    if (v && v !== key) return v;
  }
  const l = typeof lang === 'string' ? lang : (document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru');
  return l === 'en' ? en : ru;
}

const HOME_STRINGS = {
  greeting:     { ru: 'Привет',                en: 'Hi' },
  todayLabel:   { ru: 'Сегодня в BFC',         en: 'Today in BFC' },
  neurons:      { ru: 'нейронов',              en: 'neurons' },
  quickPlay:    { ru: 'Быстрая игра',          en: 'Quick Play' },
  qRemaining:   { ru: 'вопр. осталось',        en: 'left' },
  qLimit:       { ru: 'Лимит исчерпан',        en: 'Limit reached' },
  streakBest:   { ru: 'Лучшая серия',          en: 'Best streak' },
  streakDays:   { ru: 'дн.',                   en: 'd.' },
  streakStart:  { ru: 'Сыграй сегодня — начни серию!', en: 'Play today — start a streak!' },
  teamLabel:    { ru: 'Команда',               en: 'Team' },
  teamJoin:     { ru: 'Вступи в команду',      en: 'Join a team' },
  teamCreate:   { ru: 'или создай свою →',     en: 'or create your own →' },
  treasury:     { ru: 'Казна',                 en: 'Treasury' },
  playLabel:    { ru: 'Играть',                en: 'Play' },
  duel:         { ru: 'Дуэль',                 en: 'Duel' },
  duelSub:      { ru: 'С другом по коду',      en: 'With a friend by code' },
  brainFights:  { ru: 'Brain Fights',          en: 'Brain Fights' },
  soon:         { ru: 'Скоро',                 en: 'Soon' },
  events:       { ru: 'События',               en: 'Events' },
  eventsSub:    { ru: 'Турниры и пак-игры',    en: 'Tournaments & packs' },
};

function s(key) {
  const lang = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const entry = HOME_STRINGS[key];
  if (!entry) return key;
  return lang === 'en' ? entry.en : entry.ru;
}

// ── XSS escape (reuse router.js helper if available) ─────────────────────────
function _esc(str) {
  if (typeof window._esc === 'function') return window._esc(str);
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// ── Main entry ────────────────────────────────────────────────────────────────
export async function renderHomeDashboard() {
  const state = getState();
  if (!state.currentUser) return;

  _renderSkeleton(state);
  _loadRealData(state);
}

// ── Skeleton (sync, instant) ──────────────────────────────────────────────────
function _renderSkeleton(state) {
  // Greeting — use auth metadata as initial; async profile read may override
  const metaName = state.currentUser?.user_metadata?.full_name
    || state.currentUser?.user_metadata?.name
    || state.currentUser?.email?.split('@')[0]
    || 'Игрок';
  _setGreeting(metaName.split(' ')[0]);

  // Neurons
  const neurons = document.getElementById('hdb-neurons');
  if (neurons) neurons.textContent = (state.neurons ?? 0).toLocaleString('ru');

  _renderStreak(state);
  _renderTodayCard(state);
  _renderTexts();
}

function _setGreeting(firstName) {
  const el = document.getElementById('hdb-greeting');
  if (el) el.textContent = `${s('greeting')}, ${firstName} 👋`;
}

function _renderTexts() {
  const map = {
    'hdb-today-label':  s('todayLabel'),
    'hdb-neurons-unit': s('neurons'),
    'hdb-team-label':   s('teamLabel'),
    'hdb-play-label':   s('playLabel'),
  };
  for (const [id, text] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }
}

function _renderStreak(state) {
  const streak = state.streak ?? 0;
  const best   = state.bestStreak ?? 0;

  const valEl = document.getElementById('hdb-streak-val');
  if (valEl) valEl.textContent = streak;

  const subEl = document.getElementById('hdb-streak-sub');
  if (subEl) subEl.textContent = streak > 0
    ? `${s('streakBest')}: ${best} ${s('streakDays')}`
    : s('streakStart');

  const flame = document.getElementById('hdb-streak-flame');
  if (flame) flame.textContent = streak >= 3 ? '🔥' : '💡';
}

// ── Today card priority: A) Weekly Arena  B) Featured Pack  C) Quick Play ───
function _renderTodayCard(state) {
  // A: Weekly Arena — loaded async; fallback to C immediately, upgraded if LIVE
  _renderQuickPlayFallback(state);
  _loadArenaCard();
}

async function _loadArenaCard() {
  if (!window.sb) return;
  try {
    const { data } = await window.sb.rpc('get_weekly_arena');
    if (!data?.ok) return;
    const a = data.arena;
    // Show only when LIVE or starts within 2 hours
    const now = Date.now();
    const startsIn = new Date(a.starts_at).getTime() - now;
    const isLive = a.status === 'live';
    const isSoon = a.status === 'upcoming' && startsIn > 0 && startsIn < 2 * 3600 * 1000;
    if (!isLive && !isSoon) return;

    const label = document.getElementById('hdb-today-label');
    if (label) label.textContent = 'Weekly Arena';

    const badge = document.getElementById('hdb-qp-badge');
    const qpLabel = document.getElementById('hdb-qp-label');
    if (badge) {
      badge.textContent = isLive ? '🔴 Идёт сейчас' : '⏰ Скоро';
      badge.style.color = isLive ? '#3cc864' : '#ffc800';
    }
    if (qpLabel) qpLabel.textContent = a.title || 'Weekly Arena';

    // Make the Quick Play card navigate to arena screen
    const qpCard = document.getElementById('hdb-qp-card');
    if (qpCard) {
      qpCard.onclick = () => { window.showScreen?.('weekly-arena-screen'); window.loadWeeklyArena?.(); };
    }
  } catch (_) { /* silently ignore */ }
}

function _renderQuickPlayFallback(state) {
  const rem = typeof window.getRemainingFreeQuestions === 'function'
    ? window.getRemainingFreeQuestions()
    : null;

  const badge = document.getElementById('hdb-qp-badge');
  if (badge) {
    if (rem === null) {
      badge.textContent = '';
    } else if (rem <= 0) {
      badge.textContent = s('qLimit');
      badge.style.color = 'var(--muted)';
    } else {
      badge.textContent = `${rem} ${s('qRemaining')}`;
      badge.style.color = 'var(--accent)';
    }
  }

  const label = document.getElementById('hdb-qp-label');
  if (label) label.textContent = s('quickPlay');
}

// ── Async data loads ──────────────────────────────────────────────────────────
async function _loadRealData(state) {
  await Promise.allSettled([
    _loadDisplayName(state),
    _loadTeam(),
  ]);
}

async function _loadDisplayName(state) {
  if (!window.sb || !state.currentUser?.id) return;
  try {
    const { data } = await window.sb
      .from('profiles')
      .select('display_name')
      .eq('id', state.currentUser.id)
      .single();
    const name = data?.display_name
      || state.currentUser?.user_metadata?.full_name
      || state.currentUser?.user_metadata?.name
      || state.currentUser?.email?.split('@')[0]
      || 'Игрок';
    _setGreeting(name.split(' ')[0]);
  } catch(e) {
    // greeting already set from metadata
  }
}

async function _loadTeam() {
  if (!window.sb) return;
  try {
    const { data } = await window.sb.rpc('get_my_team');
    _renderTeamPulse(data);
    if (data?.ok && data.id) _loadTeamBF(data.id);
  } catch(e) {
    _renderTeamPulse(null);
  }
}

async function _loadTeamBF(_teamId) {
  // Use authoritative RPC (migration 76) — aggregates from verified contributions only
  try {
    if (!window.sb) return;
    const { data } = await window.sb.rpc('get_brain_fights_week');
    const pts = data?.ok ? data.my_team?.points : null;
    if (!pts) return;

    const bfLine = document.getElementById('hdb-bf-line');
    if (bfLine) {
      bfLine.style.display = '';
      bfLine.textContent = `🧠 Brain Fights: ${pts} очк. на этой неделе`;
    }
  } catch(e) { /* silently ignore */ }
}

function _renderTeamPulse(t) {
  const card = document.getElementById('hdb-team-card');
  if (!card) return;

  if (!t?.ok || !t.name) {
    card.innerHTML = `
      <div class="hdb-team-empty" onclick="showScreen('my-team-screen');window.loadMyTeam?.()">
        <span style="font-size:22px">👥</span>
        <span style="flex:1">
          <span style="display:block;font-size:14px;font-weight:800">${_esc(s('teamJoin'))}</span>
          <span style="display:block;font-size:12px;color:var(--muted)">${_esc(s('teamCreate'))}</span>
        </span>
      </div>`;
    return;
  }

  const safeEmoji   = _esc(t.emoji || '👥');
  const safeName    = _esc(t.name);
  const treasury    = t.treasury_neurons != null
    ? `${Number(t.treasury_neurons).toLocaleString('ru')} ⚡`
    : '—';
  const safeLabel   = _esc(s('treasury'));

  card.innerHTML = `
    <div class="hdb-team-info" onclick="showScreen('my-team-screen');window.loadMyTeam?.()">
      <div style="font-size:28px;flex-shrink:0">${safeEmoji}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${safeName}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">${safeLabel}: ${_esc(treasury)}</div>
        <div id="hdb-bf-line" style="display:none;font-size:11px;color:#3cc864;font-weight:700;margin-top:3px;cursor:pointer"
          onclick="event.stopPropagation();showScreen('brain-fights-screen');window.loadBrainFights?.()"></div>
      </div>
      <span style="color:var(--accent);font-size:18px;font-weight:900">›</span>
    </div>`;
}

// ── Called on neuron/xp state changes ────────────────────────────────────────
export function refreshHomeDashboardState() {
  const state = getState();
  _renderSkeleton(state);
}

window.renderHomeDashboard     = renderHomeDashboard;
window.refreshHomeDashboardState = refreshHomeDashboardState;
