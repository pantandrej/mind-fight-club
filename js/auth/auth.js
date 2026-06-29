// ── Authentication ─────────────────────────────────────────────────
// Single source of truth for auth state.
// Fix: auth race condition — getSession() and onAuthStateChange cannot
// both trigger onUserLoaded() concurrently.

import { sb }         from '../services/supabase.js';
import { track }      from '../services/analytics.js';
import { getState, setState } from '../state.js';
import { showScreen, toast }  from '../router.js';

// ── Boot counters (for browser smoke test) ────────────────────────
// Each should show count=1 in console after a single page load.
console.count('[boot] initAuth');

// ── Race condition guard ──────────────────────────────────────────
// Ensures onUserLoaded runs at most once per session, even if both
// getSession() and onAuthStateChange fire for the same user.
let _userLoadPromise = null;
let _authed = false;

function _loadUserOnce(user) {
  if (_userLoadPromise) return _userLoadPromise; // already running
  setState({ currentUser: user });
  // Sync legacy shim
  if (window._syncStateToLegacy) window._syncStateToLegacy();
  _userLoadPromise = _onUserLoaded(user).finally(() => {
    _userLoadPromise = null;
  });
  return _userLoadPromise;
}

// ── Entry point ───────────────────────────────────────────────────
export async function initAuth() {
  const { data: { session: existingSession } } = await sb.auth.getSession();

  // Detect OAuth callback in URL hash — must boot immediately to handle SIGNED_IN
  const hash = window.location.hash;
  const isOAuthCallback = hash.includes('access_token=') || hash.includes('code=') || hash.includes('error_description=');

  const p = new URLSearchParams(window.location.search);
  const hasDeepLink = p.get('duel') || p.get('tourn') || p.get('official') || p.get('join_club') || p.get('u') || p.get('uid');

  if (!existingSession && !isOAuthCallback && !hasDeepLink) {
    // Show landing for first-time visitors — but still boot auth listener in background
    _showLanding();
    _bootAuth(); // registers onAuthStateChange so OAuth callback is handled
    return;
  }

  _bootAuth();
}

async function _bootAuth() {
  showScreen('auth');
  track('auth_screen_viewed', {});

  console.count('[auth] listener registered');

  sb.auth.onAuthStateChange(async (event, session) => {
    // Handle each event explicitly — TOKEN_REFRESHED must NOT re-run onboarding
    switch (event) {
      case 'SIGNED_OUT':
        _authed = false;
        _userLoadPromise = null;
        setState({ currentUser: null });
        if (window._syncStateToLegacy) window._syncStateToLegacy();
        showScreen('auth');
        break;

      case 'INITIAL_SESSION':
        // Handled below by getSession() — skip here to avoid race
        break;

      case 'SIGNED_IN':
        if (!_authed && session?.user) {
          _authed = true;
          try { await Promise.race([_loadUserOnce(session.user), _timeout(5000)]); } catch(e) { console.warn('[auth] loadUser error', e); }
          _redirectAfterAuth();
        }
        break;

      case 'TOKEN_REFRESHED':
        // Just update the user object — no profile fetch, no onboarding
        if (session?.user) setState({ currentUser: session.user });
        break;

      case 'USER_UPDATED':
        if (session?.user) setState({ currentUser: session.user });
        break;

      default:
        break;
    }
  });

  // Restore existing session (fires before SIGNED_IN event)
  const { data: { session } } = await sb.auth.getSession();
  if (session?.user && !_authed) {
    _authed = true;
    try { await Promise.race([_loadUserOnce(session.user), _timeout(5000)]); } catch(e) { console.warn('[auth] loadUser error', e); }
    _redirectAfterAuth();
  }
}

// ── Landing page logic ────────────────────────────────────────────
function _showLanding() {
  const el = document.getElementById('landing-overlay');
  if (!el) { _bootAuth(); return; }
  el.style.display = 'flex';

  // Load player count
  sb.from('profiles').select('id', { count: 'exact', head: true }).then(({ count }) => {
    const el = document.getElementById('landing-player-count');
    if (el && count) el.textContent = count.toLocaleString('ru');
  });

  // Play now → guest + immediate bot duel
  window._landingPlayNow = function() {
    el.style.display = 'none';
    // Go straight to matchmaking as guest
    if (typeof window.continueAsGuest === 'function') window.continueAsGuest();
    setTimeout(() => {
      if (typeof window.showScreen === 'function') window.showScreen('duel');
      setTimeout(() => {
        if (typeof window.createDuel === 'function') window.createDuel();
      }, 300);
    }, 200);
    track('landing_play_now', {});
  };

  // Sign in → hide landing, show auth
  window._landingSignIn = function() {
    el.style.display = 'none';
    _bootAuth();
    track('landing_sign_in', {});
  };
}

// ── Post-auth navigation ──────────────────────────────────────────
function _redirectAfterAuth() {
  if (typeof window.savePendingRef  === 'function') window.savePendingRef();
  if (typeof window.checkRefParam   === 'function') window.checkRefParam();
  if (!localStorage.getItem('mfc_onboarded') &&
      typeof window.checkOnboarding === 'function') window.checkOnboarding();
  // New onboarding + referral claim
  if (typeof window.checkAndStartOnboarding === 'function') window.checkAndStartOnboarding();

  const p = new URLSearchParams(window.location.search);
  if (p.get('official') && typeof window.openOfficialTournament === 'function') {
    window.openOfficialTournament(p.get('official'), p.get('ac')); return;
  }
  const hypeSlug  = p.get('hype')  || sessionStorage.getItem('mfc_pending_hype') || window._hypeAutoSlug || null;
  const duelCode  = p.get('duel')  || sessionStorage.getItem('mfc_pending_duel');
  const tournCode = p.get('tourn') || sessionStorage.getItem('mfc_pending_tourn');
  sessionStorage.removeItem('mfc_pending_hype');
  sessionStorage.removeItem('mfc_pending_duel');
  sessionStorage.removeItem('mfc_pending_tourn');
  if (duelCode) {
    // Fetch host name and show incoming call UI
    (async () => {
      let hostName = 'Соперник';
      try {
        const { data } = await window.sb.from('duel_rooms').select('host_name').eq('code', duelCode.toUpperCase()).maybeSingle();
        if (data?.host_name) hostName = data.host_name;
      } catch(e) { /* ignore, use default */ }
      if (typeof window.showLocalNotification === 'function') {
        window.showLocalNotification(
          `⚔️ ${hostName} вызывает на дуэль!`,
          'Открой Brain Fight Club и прими вызов 🔥'
        );
      }
      if (typeof window.showDuelIncoming === 'function') {
        window.showDuelIncoming(duelCode, hostName);
      } else {
        showScreen('duel');
        const el = document.getElementById('join-code-input');
        if (el) { el.value = duelCode; setTimeout(() => window.joinDuel?.(), 300); }
      }
    })();
    return;
  }
  if (tournCode) {
    showScreen('tournament');
    const el = document.getElementById('t-join-code');
    if (el) el.value = tournCode;
    return;
  }
  showScreen('home');
  if (hypeSlug) setTimeout(() => window.openHypeGame?.(hypeSlug), 150);
  if (p.get('u') || p.get('uid')) {
    const uname = p.get('u');
    const uid = p.get('uid');
    setTimeout(() => window.openPublicProfile?.(uname, uid), 300);
  }
  if (p.get('join_club')) {
    const clubId = p.get('join_club');
    setTimeout(() => window.joinClubFromLink?.(clubId), 500);
  }
}

// ── Called once per session after sign-in ─────────────────────────
async function _onUserLoaded(user) {
  console.count('[auth] onUserLoaded');
  if (!user) return;

  if (typeof window.loadCurrentUserRole === 'function') await window.loadCurrentUserRole();
  await loadUserNeurons();
  await ensureProfile();
  if (typeof window.loadRefCode === 'function') await window.loadRefCode();

  // Sync legacy globals after load
  if (window._syncStateToLegacy) window._syncStateToLegacy();

  setTimeout(() => {
    if (typeof window.updateTeamNeurons === 'function' && window.myTeam && getState().currentUser)
      window.updateTeamNeurons();
  }, 1500);
  // Start presence ping
  if (typeof window._startPresencePing === 'function') window._startPresencePing();
  setTimeout(() => {
    if (typeof window.renderBadges       === 'function') window.renderBadges();
    if (typeof window.renderHomeNextGoal === 'function') window.renderHomeNextGoal();
    // Only show onboarding if not already done
    if (typeof window.shouldShowOnboarding === 'function' && window.shouldShowOnboarding() &&
        typeof window.showOnboarding === 'function') window.showOnboarding();
  }, 800);
}

// ── Load balance from server ──────────────────────────────────────
export async function loadUserNeurons() {
  const { currentUser } = getState();
  if (!currentUser) return;

  let data = null;
  const { data: newData } = await sb.from('profiles')
    .select('total_score,neurons,xp,city,display_name')
    .eq('id', currentUser.id)
    .single();

  if (newData) {
    data = { neurons: newData.neurons ?? newData.total_score, xp: newData.xp ?? 0, city: newData.city };
  } else {
    const { data: oldData } = await sb.from('user_profiles')
      .select('neurons,xp,city').eq('id', currentUser.id).single();
    if (oldData) data = oldData;
  }

  if (data) {
    setState({ neurons: data.neurons || 0, xp: data.xp || 0 });
    if (window._syncStateToLegacy) window._syncStateToLegacy();
    if (typeof window.updNeurons === 'function') window.updNeurons();
    if (data.city && !localStorage.getItem('mfc_city'))
      localStorage.setItem('mfc_city', data.city);
  }
}

// ── Ensure profile row exists (idempotent) ────────────────────────
export async function ensureProfile() {
  const { currentUser, neurons, lang } = getState();
  if (!currentUser) return;

  const city         = localStorage.getItem('mfc_city') || null;
  const display_name = currentUser.user_metadata?.full_name
    || currentUser.email?.split('@')[0] || 'Игрок';

  const { data: existing } = await sb.from('profiles')
    .select('id,total_score,ref_code')
    .eq('id', currentUser.id)
    .maybeSingle();

  if (existing) {
    const updates = { display_name, updated_at: new Date().toISOString() };
    if (city && !existing.city) updates.city = city;
    if (!existing.ref_code) {
      const code = Math.random().toString(36).slice(2, 10).toUpperCase();
      updates.ref_code = code;
      setState({ refCode: code });
      localStorage.setItem('mfc_refcode', code);
    } else {
      setState({ refCode: existing.ref_code });
      localStorage.setItem('mfc_refcode', existing.ref_code);
    }
    // Only update display fields — never touch neurons/xp here (RPC only)
    sb.from('profiles').update(updates).eq('id', currentUser.id).then(() => {}).catch(() => {});
  } else {
    const newCode = Math.random().toString(36).slice(2, 10).toUpperCase();
    setState({ refCode: newCode });
    localStorage.setItem('mfc_refcode', newCode);
    // Insert new profile — initial neurons from guest demo balance
    // NOTE: neurons/xp should normally come from RPC; this is new-user bootstrap only
    sb.from('profiles').insert({
      id: currentUser.id, display_name, city,
      total_score: neurons || 0,
      neurons:     neurons || 0,
      xp:          0,
      ref_code: newCode,
      language: lang,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});
  }
}

// ── Google OAuth ──────────────────────────────────────────────────
export async function signInGoogle() {
  const { lang } = getState();
  const btn   = document.getElementById('google-sign-in-btn');
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.style.display = 'none';
  if (btn) {
    btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none';
    btn.querySelector('span').textContent = lang === 'ru' ? 'Открываем Google...' : 'Opening Google...';
  }
  track('signup_started', { method: 'google' });
  try {
    // Preserve duel/tournament params through OAuth redirect
    const p = new URLSearchParams(window.location.search);
    if (p.get('hype'))  sessionStorage.setItem('mfc_pending_hype',  p.get('hype'));
    if (p.get('duel'))  sessionStorage.setItem('mfc_pending_duel',  p.get('duel'));
    if (p.get('tourn')) sessionStorage.setItem('mfc_pending_tourn', p.get('tourn'));
    const redirectTo = window.location.origin + window.location.pathname + window.location.search;
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google', options: { redirectTo, skipBrowserRedirect: false },
    });
    if (error) {
      if (errEl) { errEl.textContent = 'Google error: ' + error.message; errEl.style.display = 'block'; }
      if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; btn.querySelector('span').textContent = 'Войти через Google'; }
    }
  } catch (e) {
    if (errEl) { errEl.textContent = 'Exception: ' + (e.message || e); errEl.style.display = 'block'; }
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; btn.querySelector('span').textContent = 'Войти через Google'; }
  }
}

// ── Email auth ────────────────────────────────────────────────────
function _showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.style.display = 'block'; }
}
function _clearAuthError() {
  const el = document.getElementById('auth-error');
  if (el) el.style.display = 'none';
}

export function toggleEmailAuth() {
  const { lang } = getState();
  const form   = document.getElementById('auth-email-form');
  const txt    = document.getElementById('auth-email-toggle-txt');
  const isOpen = form.style.display !== 'none';
  form.style.display = isOpen ? 'none' : 'block';
  if (txt) txt.textContent = isOpen
    ? (lang === 'ru' ? 'Войти через Email' : 'Sign in with Email')
    : (lang === 'ru' ? 'Скрыть' : 'Hide');
  if (!isOpen) document.getElementById('auth-email-input')?.focus();
}

export async function signInEmail() {
  const { lang } = getState();
  const email = document.getElementById('auth-email-input').value.trim();
  const pass  = document.getElementById('auth-pass-input').value;
  if (!email || !pass) { _showAuthError(lang === 'ru' ? 'Введите email и пароль' : 'Enter email and password'); return; }
  _clearAuthError();
  const btn = document.getElementById('auth-signin-btn');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
  if (btn) { btn.textContent = lang === 'ru' ? 'Войти' : 'Sign In'; btn.disabled = false; }
  if (error) {
    _showAuthError(error.message === 'Invalid login credentials'
      ? (lang === 'ru' ? 'Неверный email или пароль' : 'Wrong email or password')
      : error.message);
    return;
  }
  if (data.user) {
    if (_authed) return; // onAuthStateChange already handled it
    _authed = true;
    await Promise.race([_loadUserOnce(data.user), _timeout(5000)]);
    _redirectAfterAuth();
  }
}

export async function signUpEmail() {
  const { lang } = getState();
  const email = document.getElementById('auth-email-input').value.trim();
  const pass  = document.getElementById('auth-pass-input').value;
  if (!email) { _showAuthError(lang === 'ru' ? 'Введите email' : 'Enter email'); return; }
  if (pass.length < 6) { _showAuthError(lang === 'ru' ? 'Пароль минимум 6 символов' : 'Password min 6 chars'); return; }
  _clearAuthError();
  const btn = document.getElementById('auth-signup-btn');
  if (btn) { btn.textContent = '...'; btn.disabled = true; }
  const { data, error } = await sb.auth.signUp({ email, password: pass });
  if (btn) { btn.textContent = lang === 'ru' ? 'Регистрация' : 'Register'; btn.disabled = false; }
  if (error) { _showAuthError(error.message); return; }
  if (data.user && !data.user.identities?.length) {
    _showAuthError(lang === 'ru' ? 'Email уже зарегистрирован. Нажмите Sign In.' : 'Email already registered. Use Sign In.');
    return;
  }
  if (data.session) {
    if (_authed) return;
    _authed = true;
    track('signup_completed', { method: 'email' });
    await Promise.race([_loadUserOnce(data.user), _timeout(5000)]);
    _redirectAfterAuth();
  } else {
    const hint = document.getElementById('auth-email-hint');
    if (hint) { hint.style.color = 'var(--green)'; hint.textContent = lang === 'ru' ? '✓ Письмо отправлено' : '✓ Confirmation sent'; }
  }
}

export function continueAsGuest() {
  track('guest_started', {});
  if (typeof window.savePendingRef === 'function') window.savePendingRef();
  const p = new URLSearchParams(window.location.search);
  const hypeSlug = p.get('hype') || window._hypeAutoSlug || null;
  if (p.get('duel')) { showScreen('duel'); document.getElementById('join-code-input').value = p.get('duel'); }
  else if (p.get('tourn')) { showScreen('tournament'); document.getElementById('t-join-code').value = p.get('tourn'); }
  else showScreen('home');
  if (hypeSlug) setTimeout(() => window.openHypeGame?.(hypeSlug), 100);
}

export async function signOut() {
  await sb.auth.signOut();
}

// ── Helpers ───────────────────────────────────────────────────────
const _timeout = (ms) => new Promise(r => setTimeout(r, ms));

// ── window exports ────────────────────────────────────────────────
window.initAuth        = initAuth;
window.signInGoogle    = signInGoogle;
window.signInEmail     = signInEmail;
window.signUpEmail     = signUpEmail;
window.continueAsGuest = continueAsGuest;
window.toggleEmailAuth = toggleEmailAuth;
window.signOut         = signOut;
window.loadUserNeurons = loadUserNeurons;
window.ensureProfile   = ensureProfile;
