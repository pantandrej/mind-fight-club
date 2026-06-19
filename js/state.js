// ── Application State ─────────────────────────────────────────────
// Single mutable store. All modules read/write via getState/setState.
// Direct mutation is allowed within a module for local variables;
// cross-module shared state must go through this file.

// ── Currency ─────────────────────────────────────────────────────
// neurons = spendable currency (shop, prizes)
// xp      = rating points, never decrease, shown in leaderboards
let _neurons = 0;
let _xp      = 0;

// ── Auth ─────────────────────────────────────────────────────────
let _currentUser  = null;
let _lang         = 'ru';
let _refCode      = null;
let _isAdminUser  = false;

// ── Quiz game ────────────────────────────────────────────────────
let _curQ         = [];
let _qIdx         = 0;
let _timeLeft     = 0;
let _maxT         = 0;
let _timerInt     = null;
let _answered     = false;
let _gameId       = null;
let _gameStartTime= null;
let _qStartTime   = null;
let _roundScore   = 0;   // accumulated per correct answer, reset on quiz start
let _streak       = 0;
let _bestStreak   = 0;
let _correctCount = 0;

// ── UI ───────────────────────────────────────────────────────────
let _selectedCat  = 'ALL';
let _selectedMode = 'feed';
let _wlCount      = 247;
let _cityRank     = null;

// ── Achievements ─────────────────────────────────────────────────
let _earnedBadges = new Set(
  JSON.parse(localStorage.getItem('mfc_badges') || '[]')
);

// ── Proxy getter/setter ──────────────────────────────────────────
export function getState() {
  return {
    neurons:       _neurons,
    xp:            _xp,
    currentUser:   _currentUser,
    lang:          _lang,
    refCode:       _refCode,
    isAdminUser:   _isAdminUser,
    curQ:          _curQ,
    qIdx:          _qIdx,
    timeLeft:      _timeLeft,
    maxT:          _maxT,
    timerInt:      _timerInt,
    answered:      _answered,
    gameId:        _gameId,
    gameStartTime: _gameStartTime,
    qStartTime:    _qStartTime,
    roundScore:    _roundScore,
    streak:        _streak,
    bestStreak:    _bestStreak,
    correctCount:  _correctCount,
    selectedCat:   _selectedCat,
    selectedMode:  _selectedMode,
    wlCount:       _wlCount,
    cityRank:      _cityRank,
    earnedBadges:  _earnedBadges,
  };
}

export function setState(patch) {
  if ('neurons'       in patch) _neurons       = patch.neurons;
  if ('xp'           in patch) _xp             = patch.xp;
  if ('currentUser'  in patch) _currentUser    = patch.currentUser;
  if ('lang'         in patch) _lang           = patch.lang;
  if ('refCode'      in patch) _refCode        = patch.refCode;
  if ('isAdminUser'  in patch) _isAdminUser    = patch.isAdminUser;
  if ('curQ'         in patch) _curQ           = patch.curQ;
  if ('qIdx'         in patch) _qIdx           = patch.qIdx;
  if ('timeLeft'     in patch) _timeLeft       = patch.timeLeft;
  if ('maxT'         in patch) _maxT           = patch.maxT;
  if ('timerInt'     in patch) _timerInt       = patch.timerInt;
  if ('answered'     in patch) _answered       = patch.answered;
  if ('gameId'       in patch) _gameId         = patch.gameId;
  if ('gameStartTime'in patch) _gameStartTime  = patch.gameStartTime;
  if ('qStartTime'   in patch) _qStartTime     = patch.qStartTime;
  if ('roundScore'   in patch) _roundScore     = patch.roundScore;
  if ('streak'       in patch) _streak         = patch.streak;
  if ('bestStreak'   in patch) _bestStreak     = patch.bestStreak;
  if ('correctCount' in patch) _correctCount   = patch.correctCount;
  if ('selectedCat'  in patch) _selectedCat    = patch.selectedCat;
  if ('selectedMode' in patch) _selectedMode   = patch.selectedMode;
  if ('wlCount'      in patch) _wlCount        = patch.wlCount;
  if ('cityRank'     in patch) _cityRank       = patch.cityRank;
  if ('earnedBadges' in patch) _earnedBadges   = patch.earnedBadges;
}

// ── Convenience mutators used frequently ─────────────────────────
export function addNeurons(amount) { _neurons += amount; }
export function deductNeurons(amount) { _neurons -= amount; }
export function addXP(amount) { _xp += amount; }

// ── Expose to legacy shim ─────────────────────────────────────────
// legacy.js calls window._appState.getState() / window._appState.setState()
window._appState = { getState, setState, addNeurons, deductNeurons, addXP };

// ── Domain state helpers (used by training/battles modules) ───────
export function setQuizState(patch) {
  // Accepts: curQ, qIdx, answered, timeLeft, maxT, timerInt, gameId, gameStartTime, qStartTime, roundScore, correctCount
  setState(patch);
}
export function setBalance(neurons, xp) {
  setState({ neurons, xp });
}
export function setCurrentUser(user) {
  setState({ currentUser: user });
}
export function incrementCorrectCount() {
  setState({ correctCount: getState().correctCount + 1 });
}
export function addToRoundScore(pts) {
  setState({ roundScore: getState().roundScore + pts });
}
export function setStreak(streak, bestStreak) {
  setState({ streak, bestStreak });
}
