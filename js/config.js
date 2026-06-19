// ── App configuration ─────────────────────────────────────────────
// All environment constants. No logic here.

export const SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co';
export const SUPA_KEY = 'sb_publishable_lFVRCP-PPnGnNzn9G60A3A_gTy40vMs';

export const DEV_MODE = false;

// ── Currency ──────────────────────────────────────────────────────
export const DAILY_GOAL_BONUS    = 50;   // ⚡ awarded once per day
export const STREAK_FREEZE_PRICE = 200;  // neurons to buy streak freeze

// ── Streak milestone bonuses (neurons only, NOT XP) ──────────────
// XP should reflect gameplay results, not just login streaks
export const STREAK_REWARDS = [
  { days:  3, neurons:  20 },
  { days:  7, neurons:  50 },
  { days: 14, neurons:  75 },
  { days: 30, neurons: 150 },
  // Every 7 days after 30:
  { days: 'every7after30', neurons: 50 },
];

// ── Plan limits ───────────────────────────────────────────────────
// Server-side enforcement is required — UI limits are UX only.
// Battles: friend duel + random duel + bot share the same daily counter.
// Tournament play is NOT counted toward battle limit.
// Social bonus: one incoming challenge from a NEW opponent per day
// is allowed above the battle limit (virality mechanic, no reward farming).
export const PLAN_LIMITS = {
  free: {
    trainingSessionsPerDay:           1,
    trainingQuestionsPerSession:      10,
    battlesPerDay:                    3,
    battleQuestions:                  5,
    incomingSocialBonusBattlesPerDay: 1,
  },
  premium: {
    trainingSessionsPerDay:           5,
    trainingQuestionsPerSession:      10,  // 5 sessions × 10 = 50 questions/day
    battlesPerDay:                    10,
    battleQuestions:                  5,
    incomingSocialBonusBattlesPerDay: 1,
  },
};

// Battle question progression: 5 questions per battle
// Q1: 2 options, Q2: 3, Q3: 4, Q4: 5, Q5: 6
// If the DB doesn't have enough questions for a given option count,
// show a controlled error and fire 'battle_question_shortage' analytics event.
export const BATTLE_QUESTION_PROGRESSION = [2, 3, 4, 5, 6]; // answer counts per question

// ── Question DB versioning ────────────────────────────────────────
export const QUESTION_DB_VERSION = 2;

// ── Points per correct answer by answer count ─────────────────────
export const POINTS_TABLE = { 2: 60, 3: 50, 4: 40, 5: 30, 6: 20 };

// ── Tournament timing ─────────────────────────────────────────────
export const TOURN_SECS_PER_ANSWER = 10; // seconds per answer option
export const TOURN_MAX_SECS        = 60;

// ── Non-game screens (router uses this to stop integrity timer) ───
export const NON_GAME_SCREENS = new Set([
  'home', 'play-menu', 'shop', 'profile', 'daily-limit', 'score', 'share',
  'admin', 'admin-import', 'tester', 'author-builder', 'create-question',
  'community-feed', 'character', 'teams', 'rules', 'waitlist', 'onboarding',
  'auth', 'matchmaking', 'tournament', 'duel', 'organizer-cabinet', 'organizer-apply',
]);
