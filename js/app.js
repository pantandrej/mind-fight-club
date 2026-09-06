// ── app.js — Main entry point ─────────────────────────────────────

// ── Iteration 1 ───────────────────────────────────────────────────
import './services/supabase.js';
import './services/analytics.js';
import './state.js';
import './router.js';
import { initAuth, initVKIDCallback } from './auth/auth.js';
import { trackPageView } from './services/analytics.js';
import './economy/wallet.js';

// ── Iteration 2 ───────────────────────────────────────────────────
import './training/training.js?v=20260716e';
import './training/daily-limit.js';
import './training/streak.js';
import './battles/friend-battle.js';
import './battles/matchmaking.js';
import './tournaments/tournament-game.js';
import './hype/hype-game.js';
import './achievements.js';
import './onboarding.js';
import './leaderboard.js';
import './training/slide-pack.js';
import { refreshHomeBanner } from './tournaments/tournament-pack.js';
import { loadDailyQuestion } from './daily-question.js';
import { loadActivityFeed }  from './activity-feed.js';
import './pwa.js';
import { initDailyLogic, checkBrandRoute } from './brands/brands.js';
import { loadClubFinder } from './club-finder.js';
import { loadMyTeam } from './my-team.js';
import { loadScoutForm } from './scout-form.js';
import { sendPushToUser } from './pwa.js';
import { loadOrgAnalytics, exportOrgCSV } from './organizer-analytics.js';
import { loadWeeklyChest, awardWeeklyNeurons } from './weekly-chest.js';
import { loadSuperQuestion } from './super-question.js';
import { loadQModeration } from './q-moderation.js';

// ── Boot ──────────────────────────────────────────────────────────
window.loadMyTeam    = loadMyTeam;
window.loadScoutForm = loadScoutForm;
window._sendPushToUser    = sendPushToUser;
window.loadOrgAnalytics   = loadOrgAnalytics;
window.exportOrgCSV       = exportOrgCSV;
window.loadWeeklyChest    = loadWeeklyChest;
window.awardWeeklyNeurons = awardWeeklyNeurons;
window.loadQModeration    = loadQModeration;

document.addEventListener('DOMContentLoaded', () => {
  trackPageView();
  initAuth();
  initVKIDCallback();
  registerServiceWorker();
  checkBrandRoute();
  _bootHomeWidgets();
});

async function _bootHomeWidgets() {
  refreshHomeBanner();
  await loadDailyQuestion();
  await initDailyLogic();
  await loadActivityFeed();
  await loadSuperQuestion();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    // Ask push permission after first login (called from auth flow)
    window._swReg = reg;
  } catch(e) {
    console.warn('[SW] registration failed:', e.message);
  }
}

// Called after successful login to request push permission — delegates to pwa.js
window.requestPushPermission = async function(context = 'general') {
  const { requestPushPermission } = await import('./pwa.js');
  return requestPushPermission(context);
};
