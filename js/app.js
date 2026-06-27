// ── app.js — Main entry point ─────────────────────────────────────

// ── Iteration 1 ───────────────────────────────────────────────────
import './services/supabase.js';
import './services/analytics.js';
import './state.js';
import './router.js';
import { initAuth } from './auth/auth.js';
import './economy/wallet.js';

// ── Iteration 2 ───────────────────────────────────────────────────
import './training/training.js';
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

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  registerServiceWorker();
  // Show tournament banner if any starts within 24h
  setTimeout(refreshHomeBanner, 2000);
  // Load daily question card on home
  setTimeout(loadDailyQuestion, 3000);
  // Activity feed — who's playing right now
  setTimeout(loadActivityFeed, 4000);
});

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

// Called after successful login to request push permission
window.requestPushPermission = async function() {
  if (!window._swReg || !('PushManager' in window)) return;
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
    // VAPID public key needed for real push — placeholder for now
    // const sub = await window._swReg.pushManager.subscribe({...});
    // await sb.rpc('register_push_token', { p_token: JSON.stringify(sub) });
  } catch(e) {
    console.warn('[push]', e.message);
  }
};
