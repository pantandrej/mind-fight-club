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
  const hasDeepLink = p.get('duel') || p.get('tourn') || p.get('official') || p.get('join_club') || p.get('u') || p.get('uid') || p.get('challenge') || p.get('brand');

  // VK ID callback uses query params (?code=...&type=code_v2), not hash
  const hasVKCallback = p.get('code') && p.get('type') === 'code_v2';

  // Pack deep link — show pack landing without requiring login
  if (!existingSession && !isOAuthCallback && !hasVKCallback && p.get('pack')) {
    _bootAuth(false);
    _showPackLanding(p.get('pack'));
    return;
  }

  if (!existingSession && !isOAuthCallback && !hasDeepLink && !hasVKCallback) {
    // Show landing for first-time visitors — but still boot auth listener in background
    _showLanding();
    _bootAuth(); // registers onAuthStateChange so OAuth callback is handled
    return;
  }

  // Official tournament deep link — open tournament immediately without auth screen
  if (!existingSession && !isOAuthCallback && p.get('official')) {
    _bootAuth(false); // register listener but skip auth screen
    if (typeof window.openOfficialTournament === 'function') {
      window.openOfficialTournament(p.get('official'), p.get('ac') || null);
    }
    return;
  }

  _bootAuth();
}

async function _bootAuth(showAuth = true) {
  if (showAuth) {
    showScreen('auth');
    track('auth_screen_viewed', {});
  }

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
  console.trace('[auth] _showLanding called');
  const el = document.getElementById('landing-overlay');
  if (!el) { _bootAuth(); return; }
  el.style.display = 'flex';

  // Load player count
  sb.from('profiles').select('id', { count: 'exact', head: true }).then(({ count }) => {
    const el = document.getElementById('landing-player-count');
    if (el && count) el.textContent = count.toLocaleString('ru');
  });

  // Play now → show auth screen (register/login)
  window._landingPlayNow = function() {
    el.style.display = 'none';
    _bootAuth();
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
async function _showPackLanding(packKey) {
  // Show a full-screen pack intro without requiring login
  const overlay = document.createElement('div');
  overlay.id = 'pack-landing-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:300;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center';
  overlay.innerHTML = `
    <div style="max-width:480px;width:100%">
      <div style="font-size:13px;font-weight:800;letter-spacing:2px;color:var(--muted);margin-bottom:16px">BRAIN FIGHT CLUB</div>
      <div id="pll-img" style="width:100%;aspect-ratio:16/9;background:var(--bg3);border-radius:16px;margin-bottom:20px;overflow:hidden">
        <div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:32px">🎮</div>
      </div>
      <div id="pll-title" style="font-size:26px;font-weight:900;margin-bottom:8px">Загружаем...</div>
      <div id="pll-meta" style="font-size:13px;color:var(--muted);margin-bottom:28px"></div>
      <button id="pll-start-btn" onclick="window._startPackFromLanding('${packKey}')"
        style="width:100%;padding:16px;border-radius:16px;border:none;background:var(--accent);color:#fff;font-size:17px;font-weight:800;cursor:pointer;font-family:inherit">
        ▶ Начать игру
      </button>
      <button onclick="document.getElementById('pack-landing-overlay').remove();showScreen('auth')"
        style="margin-top:12px;background:none;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit">
        Войти / Зарегистрироваться
      </button>
    </div>`;
  document.body.appendChild(overlay);

  // Load pack meta
  try {
    const r = await fetch(`${window._supabaseUrl}/rest/v1/game_packs?import_key=eq.${packKey}&select=title_ru,import_key&status=eq.published`,
      { headers: { apikey: window._supabaseAnonKey } });
    const packs = r.ok ? await r.json() : [];
    const pack = packs[0];
    if (pack) {
      const titleEl = document.getElementById('pll-title');
      if (titleEl) titleEl.textContent = pack.title_ru || packKey.toUpperCase();
      const metaEl = document.getElementById('pll-meta');
      if (metaEl) metaEl.textContent = 'Пак вопросов';
      // Try to show first slide as cover image
      const qr = await fetch(`${window._supabaseUrl}/rest/v1/game_pack_questions?game_pack_id=eq.${pack.id || ''}&select=question_id&order=position&limit=1`,
        { headers: { apikey: window._supabaseAnonKey } });
    }
  } catch(e) {
    const titleEl = document.getElementById('pll-title');
    if (titleEl) titleEl.textContent = packKey.toUpperCase();
  }

  window._startPackFromLanding = function(key) {
    const el = document.getElementById('pack-landing-overlay');
    if (el) el.remove();
    setTimeout(() => window.playDBPack?.(key), 100);
  };
}

function _redirectAfterAuth() {
  // Hide landing overlay in case it was shown (e.g. second initAuth call)
  const lo = document.getElementById('landing-overlay');
  if (lo) lo.style.display = 'none';
  if (typeof window.savePendingRef  === 'function') window.savePendingRef();
  if (typeof window.checkRefParam   === 'function') window.checkRefParam();
  if (!localStorage.getItem('mfc_onboarded') &&
      typeof window.checkOnboarding === 'function') window.checkOnboarding();
  // New onboarding + referral claim
  if (typeof window.checkAndStartOnboarding === 'function') window.checkAndStartOnboarding();

  const p = new URLSearchParams(window.location.search);
  if (p.get('pack')) {
    const el = document.getElementById('pack-landing-overlay');
    if (el) el.remove();
    setTimeout(() => window.playDBPack?.(p.get('pack')), 300);
    return;
  }
  if (p.get('official') && typeof window.openOfficialTournament === 'function') {
    // Guest finished — save their result instead of restarting the game
    const guestResult = sessionStorage.getItem('_otGuestResult');
    if (guestResult && typeof window._saveGuestTournamentResult === 'function') {
      window._saveGuestTournamentResult(p.get('official'), JSON.parse(guestResult));
      return;
    }
    // Game already in progress or finished — don't restart
    if (window._otFinished) return;
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
    if (typeof window.renderBadges         === 'function') window.renderBadges();
    if (typeof window.renderHomeNextGoal   === 'function') window.renderHomeNextGoal();
    if (typeof window.loadDailyStreakData  === 'function') window.loadDailyStreakData();
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
  // Make name available globally for share/challenge mechanics
  window._currentUserName = display_name;

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
// ── Phone OTP ─────────────────────────────────────────────────────
export function togglePhoneAuth() {
  const form = document.getElementById('auth-phone-form');
  const emailForm = document.getElementById('auth-email-form');
  if (form.style.display === 'none') {
    form.style.display = 'block';
    if (emailForm) emailForm.style.display = 'none';
    document.getElementById('auth-phone-input')?.focus();
  } else {
    form.style.display = 'none';
  }
}

export async function sendPhoneOTP() {
  const raw = document.getElementById('auth-phone-input')?.value?.trim();
  if (!raw) return;
  // Normalize: ensure +7 prefix for RU numbers
  const phone = raw.startsWith('+') ? raw : '+7' + raw.replace(/\D/g, '').slice(-10);

  const btn = document.getElementById('auth-phone-send-btn');
  btn.disabled = true; btn.textContent = 'Отправляем...';

  const { error } = await sb.auth.signInWithOtp({ phone });

  if (error) {
    btn.disabled = false; btn.textContent = 'Получить код →';
    const errEl = document.getElementById('auth-error');
    if (errEl) { errEl.textContent = error.message; errEl.style.display = 'block'; }
    return;
  }

  document.getElementById('auth-phone-display').textContent = phone;
  document.getElementById('auth-phone-step1').style.display = 'none';
  document.getElementById('auth-phone-step2').style.display = 'block';
  document.getElementById('auth-otp-input')?.focus();
  btn.disabled = false; btn.textContent = 'Получить код →';
}

export async function verifyPhoneOTP() {
  const phone = document.getElementById('auth-phone-display')?.textContent?.trim();
  const token = document.getElementById('auth-otp-input')?.value?.trim();
  if (!phone || !token) return;

  const btn = document.getElementById('auth-otp-verify-btn');
  btn.disabled = true; btn.textContent = 'Проверяем...';

  const { error } = await sb.auth.verifyOtp({ phone, token, type: 'sms' });

  if (error) {
    btn.disabled = false; btn.textContent = 'Подтвердить ✓';
    const errEl = document.getElementById('auth-error');
    if (errEl) { errEl.textContent = 'Неверный код: ' + error.message; errEl.style.display = 'block'; }
    return;
  }
  // onAuthStateChange will handle the rest
  btn.disabled = false;
}

const VK_APP_ID = '54683964';

function _vkRedirectUri() { return window.location.origin + '/'; }

async function _vkPkce() {
  const arr = crypto.getRandomValues(new Uint8Array(32));
  const verifier = btoa(String.fromCharCode(...arr)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return { verifier, challenge };
}

async function _loadVKSDK() {
  if (window.VKIDSDK) return window.VKIDSDK;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/@vkid/sdk@<3.0.0/dist-sdk/umd/index.js';
    s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
  return window.VKIDSDK;
}

export async function initVKIDCallback() {
  const params    = new URLSearchParams(window.location.search);
  const code      = params.get('code');
  const type      = params.get('type');
  const device_id = params.get('device_id') || '';
  if (!code || type !== 'code_v2') return;
  window.history.replaceState({}, '', window.location.pathname);
  await _vkFinishAuth(code, device_id);
}

async function _vkFinishAuth(code, device_id) {
  toast('⏳ Входим через ВКонтакте...');
  const errEl = document.getElementById('auth-error');
  try {
    const verifier = sessionStorage.getItem('vk_code_verifier') || '';
    sessionStorage.removeItem('vk_code_verifier');

    const tokenBody = new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      device_id:     device_id || sessionStorage.getItem('vk_device_id') || '',
      redirect_uri:  _vkRedirectUri(),
      client_id:     VK_APP_ID,
      code_verifier: verifier,
    });
    const tokenResp = await fetch('https://id.vk.ru/oauth2/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenBody.toString(),
    });
    const tokenData = await tokenResp.json();
    console.log('[vk] token response:', JSON.stringify(tokenData).slice(0, 300));
    const access_token = tokenData.access_token;
    if (!access_token) throw new Error('VK token error: ' + JSON.stringify(tokenData).slice(0, 200));

    const resp = await fetch(`${window._supabaseUrl}/functions/v1/vk-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': window._supabaseAnonKey || '' },
      body: JSON.stringify({ access_token }),
    });
    const result = await resp.json();
    if (result.error) throw new Error(result.error);
    const { error: verifyErr } = await sb.auth.verifyOtp({ token_hash: result.token_hash, type: 'email' });
    if (verifyErr) throw verifyErr;
    track('signup_completed', { method: 'vk' });
    // onAuthStateChange SIGNED_IN fires from verifyOtp — no reload needed
  } catch (e) {
    if (errEl) { errEl.textContent = '❌ Ошибка входа через ВК: ' + (e.message || e); errEl.style.display = 'block'; }
    console.error('[vk-auth]', e);
  }
}

export async function signInVK() {
  const btn   = document.getElementById('vk-sign-in-btn');
  const errEl = document.getElementById('auth-error');
  if (errEl) errEl.style.display = 'none';
  if (btn) { btn.style.opacity = '0.6'; btn.style.pointerEvents = 'none'; }
  track('signup_started', { method: 'vk' });

  const p = new URLSearchParams(window.location.search);
  if (p.get('duel'))  sessionStorage.setItem('mfc_pending_duel',  p.get('duel'));
  if (p.get('tourn')) sessionStorage.setItem('mfc_pending_tourn', p.get('tourn'));

  try {
    const { verifier, challenge } = await _vkPkce();
    const device_id = crypto.randomUUID().replace(/-/g,'').slice(0,16);
    sessionStorage.setItem('vk_code_verifier', verifier);
    sessionStorage.setItem('vk_device_id', device_id);

    // id.vk.ru/authorize — actual VK ID auth URL from SDK source
    const authUrl = 'https://id.vk.ru/authorize?' + new URLSearchParams({
      response_type:         'code',
      client_id:             VK_APP_ID,
      redirect_uri:          _vkRedirectUri(),
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      device_id,
      scope:                 'vkid.personal_info email',
      state:                 crypto.randomUUID(),
    });

    console.log('[vk] auth url:', authUrl.split('?')[0]);
    window.location.href = authUrl;
  } catch(e) {
    if (btn) { btn.style.opacity = ''; btn.style.pointerEvents = ''; }
    if (errEl) { errEl.textContent = '❌ ' + (e.message || e); errEl.style.display = 'block'; }
  }
}

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
  if (p.get('pack')) { showScreen('home'); setTimeout(() => window.playDBPack?.(p.get('pack')), 800); }
  else if (p.get('duel')) { showScreen('duel'); document.getElementById('join-code-input').value = p.get('duel'); }
  else if (p.get('tourn')) { showScreen('tournament'); document.getElementById('t-join-code').value = p.get('tourn'); }
  else if (p.get('challenge')) { showScreen('home'); setTimeout(_showChallengeModal, 500); }
  else showScreen('home');
  if (hypeSlug) setTimeout(() => window.openHypeGame?.(hypeSlug), 100);
}

export async function signOut() {
  await sb.auth.signOut();
}

// ── Challenge deep-link modal ─────────────────────────────────────
function _showChallengeModal() {
  const existing = document.getElementById('challenge-modal');
  if (existing) existing.remove();
  const m = document.createElement('div');
  m.id = 'challenge-modal';
  m.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.82);display:flex;align-items:flex-end;justify-content:center;padding:20px';
  m.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:24px 24px 16px 16px;padding:28px 20px 24px;width:100%;max-width:420px;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">⚔️</div>
      <div style="font-size:20px;font-weight:900;margin-bottom:8px">Тебя вызывают на бой!</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:22px;line-height:1.5">Кто-то из Brain Fight Club бросил тебе вызов. Прими и докажи кто умнее.</div>
      <button onclick="document.getElementById('challenge-modal').remove();window.startMatchmaking?.()"
        style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:15px;font-size:16px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">
        ⚡ Принять вызов
      </button>
      <button onclick="document.getElementById('challenge-modal').remove()"
        style="width:100%;background:none;border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">
        Не сейчас
      </button>
    </div>`;
  document.body.appendChild(m);
  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
}

// ── Helpers ───────────────────────────────────────────────────────
const _timeout = (ms) => new Promise(r => setTimeout(r, ms));

// ── window exports ────────────────────────────────────────────────
window.initAuth        = initAuth;
window.signInGoogle    = signInGoogle;
window.signInVK        = signInVK;
window.togglePhoneAuth = togglePhoneAuth;
window.sendPhoneOTP    = sendPhoneOTP;
window.verifyPhoneOTP  = verifyPhoneOTP;
window.signInEmail     = signInEmail;
window.signUpEmail     = signUpEmail;
window.continueAsGuest = continueAsGuest;
window.toggleEmailAuth = toggleEmailAuth;
window.signOut         = signOut;
window.loadUserNeurons = loadUserNeurons;
window.ensureProfile   = ensureProfile;
