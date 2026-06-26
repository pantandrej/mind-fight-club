// ── Achievements system ───────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

export const BADGES = {
  // Streak
  streak_3:      { icon: '🔥', title: '3 дня подряд',    desc: 'Играй 3 дня без перерыва' },
  streak_7:      { icon: '🔥', title: 'Неделя огня',     desc: '7 дней подряд' },
  streak_30:     { icon: '💎', title: 'Месяц в строю',   desc: '30 дней подряд' },
  streak_100:    { icon: '👑', title: 'Легенда',         desc: '100 дней подряд' },
  // Duels
  first_duel:    { icon: '⚔️', title: 'Первый бой',      desc: 'Сыграй первую дуэль' },
  duel_win_1:    { icon: '🏆', title: 'Победитель',      desc: 'Выиграй первую дуэль' },
  duel_win_10:   { icon: '🥇', title: 'Боец',            desc: '10 побед в дуэлях' },
  duel_win_50:   { icon: '⚡', title: 'Чемпион',         desc: '50 побед в дуэлях' },
  // Accuracy
  perfect_game:  { icon: '🎯', title: 'Без ошибок',      desc: '10/10 в одной игре' },
  accuracy_80:   { icon: '🧠', title: 'Точный ум',       desc: 'Средняя точность 80%+' },
  // Social
  first_referral:{ icon: '🤝', title: 'Рекрутёр',        desc: 'Пригласи первого друга' },
  team_member:   { icon: '🏟️', title: 'Командный игрок', desc: 'Вступи в команду' },
  // Progress
  games_10:      { icon: '🎮', title: 'Новичок',         desc: '10 игр сыграно' },
  games_50:      { icon: '🎮', title: 'Игрок',           desc: '50 игр сыграно' },
  games_100:     { icon: '🎮', title: 'Ветеран',         desc: '100 игр сыграно' },
  neurons_1000:  { icon: '⚡', title: '1000 нейронов',   desc: 'Накопи 1000 нейронов' },
  level_5:       { icon: '🚀', title: 'Уровень 5',       desc: 'Достигни 5 уровня' },
};

let _earned = new Set();

export async function loadAchievements() {
  const { currentUser } = getState();
  if (!currentUser) return [];
  const { data } = await sb.from('user_achievements').select('badge_id,unlocked_at').eq('user_id', currentUser.id);
  _earned = new Set((data || []).map(r => r.badge_id));
  return data || [];
}

export function renderAchievementsScreen(earnedList) {
  const el = document.getElementById('achievements-grid');
  if (!el) return;
  el.innerHTML = Object.entries(BADGES).map(([id, b]) => {
    const done = _earned.has(id);
    return `<div class="badge-card${done ? '' : ' badge-locked'}">
      <div class="badge-icon">${done ? b.icon : '🔒'}</div>
      <div class="badge-title">${done ? b.title : '???'}</div>
      <div class="badge-desc">${done ? b.desc : b.desc}</div>
    </div>`;
  }).join('');
}

// Check and award achievements after game/action
export async function checkAchievements(stats = {}) {
  const { currentUser } = getState();
  if (!currentUser) return;

  const toCheck = [];

  if (stats.streak >= 3)   toCheck.push('streak_3');
  if (stats.streak >= 7)   toCheck.push('streak_7');
  if (stats.streak >= 30)  toCheck.push('streak_30');
  if (stats.streak >= 100) toCheck.push('streak_100');

  if (stats.duels_played >= 1)  toCheck.push('first_duel');
  if (stats.duels_won >= 1)     toCheck.push('duel_win_1');
  if (stats.duels_won >= 10)    toCheck.push('duel_win_10');
  if (stats.duels_won >= 50)    toCheck.push('duel_win_50');

  if (stats.games_played >= 10)  toCheck.push('games_10');
  if (stats.games_played >= 50)  toCheck.push('games_50');
  if (stats.games_played >= 100) toCheck.push('games_100');

  if (stats.perfect_game)    toCheck.push('perfect_game');
  if (stats.accuracy >= 80)  toCheck.push('accuracy_80');
  if (stats.neurons >= 1000) toCheck.push('neurons_1000');
  if (stats.level >= 5)      toCheck.push('level_5');
  if (stats.has_team)        toCheck.push('team_member');
  if (stats.referral_count >= 1) toCheck.push('first_referral');

  const newBadges = [];
  for (const badgeId of toCheck) {
    if (_earned.has(badgeId)) continue;
    try {
      const { data } = await sb.rpc('award_achievement', { p_badge_id: badgeId });
      if (data === true) {
        _earned.add(badgeId);
        newBadges.push(badgeId);
      }
    } catch(e) { /* silent */ }
  }

  // Show toast for each new badge
  newBadges.forEach((id, i) => {
    const b = BADGES[id];
    if (!b) return;
    setTimeout(() => {
      if (window.toast) window.toast(`${b.icon} Достижение: ${b.title}`, 4000);
    }, i * 1500);
  });

  return newBadges;
}

window.loadAchievements    = loadAchievements;
window.renderAchievementsScreen = renderAchievementsScreen;
window.checkAchievements   = checkAchievements;
