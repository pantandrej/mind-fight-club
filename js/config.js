// ── App configuration ─────────────────────────────────────────────
// All environment constants. No logic here.

export const SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co';
export const SUPA_KEY = 'sb_publishable_lFVRCP-PPnGnNzn9G60A3A_gTy40vMs';

export const DEV_MODE = false;

// ── Brand ─────────────────────────────────────────────────────────
export const APP_BRAND = {
  shortName:   'BFC',
  fullName:    'Brain Fight Club',
  premiumName: 'BFC Premium',
};

// ── Currency ──────────────────────────────────────────────────────
export const DAILY_GOAL_BONUS    = 50;
export const STREAK_FREEZE_PRICE = 200;

// ── Streak milestone bonuses (neurons only, NOT XP) ──────────────
export const STREAK_REWARDS = [
  { days:  3, neurons:  20 },
  { days:  7, neurons:  50 },
  { days: 14, neurons:  75 },
  { days: 30, neurons: 150 },
  { days: 'every7after30', neurons: 50 },
];

// ── Premium plans ─────────────────────────────────────────────────
export const PREMIUM_PLANS = {
  monthly: {
    id:         'premium_monthly',
    title:      'BFC Premium',
    priceRub:   299,
    periodDays: 30,
    recurring:  true,
  },
  yearly: {
    id:         'premium_yearly',
    title:      'BFC Premium Year',
    priceRub:   1490,
    periodDays: 365,
    recurring:  false,
  },
};

// ── Plan limits ───────────────────────────────────────────────────
// Server-side enforcement via start_game_session RPC.
// Battles: friend + random + bot share one daily counter.
// Tournaments not counted. Social bonus: 1 incoming/day above limit.
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
    trainingQuestionsPerSession:      10,
    battlesPerDay:                    10,
    battleQuestions:                  5,
    incomingSocialBonusBattlesPerDay: 1,
  },
};

// ── Battle question progression ───────────────────────────────────
// Q1: 2 opts, Q2: 3, Q3: 4, Q4: 5, Q5: 6
export const BATTLE_QUESTION_PROGRESSION = [2, 3, 4, 5, 6];
export const POINTS_TABLE = { 2: 60, 3: 50, 4: 40, 5: 30, 6: 20 };

// ── Tournament timing ─────────────────────────────────────────────
export const TOURN_SECS_PER_ANSWER = 10;
export const TOURN_MAX_SECS        = 60;

// ── Non-game screens ──────────────────────────────────────────────
export const NON_GAME_SCREENS = new Set([
  'home', 'play-menu', 'shop', 'profile', 'daily-limit', 'score', 'share',
  'admin', 'admin-import', 'tester', 'author-builder', 'create-question',
  'community-feed', 'character', 'teams', 'rules', 'waitlist', 'onboarding',
  'auth', 'matchmaking', 'tournament', 'duel', 'organizer-cabinet',
  'organizer-apply', 'premium',
]);

// ── MVP Feature Flags ─────────────────────────────────────────────
// Set to false to hide unfinished features from UI.
// Does NOT delete code — only controls visibility.
// Flip to true when feature is ready.
export const MVP_FLAGS = {
  // ✅ VISIBLE in MVP
  training:     true,
  battles:      true,
  tournaments:  true,
  ratings:      true,
  organizer:    true,
  store:        true,
  premium:      true,
  hypeGames:    true,
  b2b:          true,

  // ❌ HIDDEN in MVP (not ready)
  avatars:       false,
  achievements:  false,
  inventory:     false,
  cosmetics:     false,
  character:     false,
  streakPill:    false,
  speedTimer:    false,   // hides the countdown seconds display
  userQuestions: false,   // "Предложить вопрос", "Вопросы участников"
  dailyTasks:    false,   // "Задание дня"
  topicFilter:   false,   // "Выбрать тему" (filter not working yet)
};

window.MVP_FLAGS = MVP_FLAGS;
