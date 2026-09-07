// home-dashboard.js — authenticated home dashboard renderer

import { getState } from './state.js';

let _teamCache = null;
let _refreshTimer = null;

export async function renderHomeDashboard() {
  const state = getState();
  if (!state.currentUser) return; // unauthenticated — landing handles it

  _renderSkeleton(state);
  _loadRealData(state);
}

function _renderSkeleton(state) {
  const name = state.currentUser?.user_metadata?.name
    || state.currentUser?.email?.split('@')[0]
    || 'игрок';
  const shortName = name.split(' ')[0];

  const el = document.getElementById('hdb-greeting');
  if (el) el.textContent = `Привет, ${shortName} 👋`;

  const neurons = document.getElementById('hdb-neurons');
  if (neurons) neurons.textContent = (state.neurons ?? 0).toLocaleString('ru');

  _renderStreak(state);
  _renderQuickPlay(state);
}

function _renderStreak(state) {
  const streak = state.streak ?? 0;
  const best   = state.bestStreak ?? 0;

  const el = document.getElementById('hdb-streak-val');
  if (el) el.textContent = streak;

  const sub = document.getElementById('hdb-streak-sub');
  if (sub) sub.textContent = streak > 0
    ? `Лучшая серия: ${best} дн.`
    : 'Сыграй сегодня — начни серию!';

  const flame = document.getElementById('hdb-streak-flame');
  if (flame) flame.textContent = streak >= 7 ? '🔥' : streak >= 3 ? '🔥' : '💡';
}

function _renderQuickPlay(state) {
  const rem = typeof window.getRemainingFreeQuestions === 'function'
    ? window.getRemainingFreeQuestions()
    : null;

  const badge = document.getElementById('hdb-qp-badge');
  if (badge) {
    if (rem === null) {
      badge.textContent = '';
    } else if (rem <= 0) {
      badge.textContent = 'Лимит исчерпан';
      badge.style.color = 'var(--muted)';
    } else {
      badge.textContent = `${rem} вопросов осталось`;
      badge.style.color = 'var(--accent)';
    }
  }
}

async function _loadRealData(state) {
  await Promise.allSettled([
    _loadTeam(),
    _loadActivity(),
  ]);
}

async function _loadTeam() {
  if (!window.sb) return;
  try {
    const { data } = await window.sb.rpc('get_my_team');
    _teamCache = data;
    _renderTeamPulse(data);
  } catch(e) {
    _renderTeamPulse(null);
  }
}

function _renderTeamPulse(t) {
  const card = document.getElementById('hdb-team-card');
  if (!card) return;

  if (!t?.ok || !t.name) {
    card.innerHTML = `
      <div class="hdb-team-empty" onclick="showScreen('my-team-screen');window.loadMyTeam?.()">
        <span style="font-size:22px">👥</span>
        <span style="flex:1">
          <span style="display:block;font-size:14px;font-weight:800">Вступи в команду</span>
          <span style="display:block;font-size:12px;color:var(--muted)">или создай свою →</span>
        </span>
      </div>`;
    return;
  }

  const emoji = t.emoji || '👥';
  const treasury = t.treasury_neurons != null ? `${(t.treasury_neurons).toLocaleString('ru')} ⚡` : '—';

  card.innerHTML = `
    <div class="hdb-team-info" onclick="showScreen('my-team-screen');window.loadMyTeam?.()">
      <div style="font-size:28px;flex-shrink:0">${emoji}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</div>
        <div style="font-size:12px;color:var(--muted);margin-top:2px">Казна: ${treasury}</div>
      </div>
      <span style="color:var(--accent);font-size:18px;font-weight:900">›</span>
    </div>`;
}

async function _loadActivity() {
  // activity feed lives in the existing #home-activity-feed container
  // no-op: handled by legacy loadActivityFeed()
}

// Called on neuron/xp state changes to refresh the neurons display
export function refreshHomeDashboardState() {
  const state = getState();
  _renderSkeleton(state);
}

window.renderHomeDashboard = renderHomeDashboard;
window.refreshHomeDashboardState = refreshHomeDashboardState;
