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

// ── Boot ──────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => { initAuth(); });
