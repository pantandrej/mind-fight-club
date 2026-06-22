// ── Router & shared UI helpers ────────────────────────────────────
// Handles screen transitions and common DOM utilities used everywhere.

import { NON_GAME_SCREENS } from './config.js';
import { getState }         from './state.js';

// ── Screen navigation ─────────────────────────────────────────────
export function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById(name);
  if (!screen) { console.warn('[router] unknown screen:', name); return; }
  screen.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const ni = document.getElementById('nav-' + name);
  if (ni) ni.classList.add('active');

  window.scrollTo(0, 0);

  // Stop quiz integrity timer when leaving game screens
  if (NON_GAME_SCREENS.has(name) && typeof window.stopIntegrity === 'function') {
    window.stopIntegrity();
  }

  // Lazy render for screens that need it
  setTimeout(() => {
    try {
      if (name === 'shop'    && typeof window.renderShop        === 'function') window.renderShop();
      if (name === 'teams'   && typeof window.renderTeamsScreen  === 'function') window.renderTeamsScreen();
      if (name === 'profile' && typeof window.showProfile        === 'function') window.showProfile();
    } catch (e) { console.error('Screen render error:', e); }
  }, 50);
}

// ── Toast notification ────────────────────────────────────────────
export function toast(msg, dur = 2500) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), dur);
}

// ── Feedback pill (correct/wrong) ─────────────────────────────────
export function showFb(id, txt, ok) {
  const fb = document.getElementById(id);
  if (!fb) return;
  fb.textContent = txt;
  fb.className = 'fb ' + (ok ? 'ok' : 'no') + ' show';
}

// ── Progress dots ─────────────────────────────────────────────────
export function buildDots(id, count) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.className = 'dot' + (i === 0 ? ' active' : '');
    d.id = id + '-dot-' + i;
    el.appendChild(d);
  }
}

export function setDot(id, i, cls) {
  const d = document.getElementById(id + '-dot-' + i);
  if (d) d.className = 'dot ' + cls;
}

// ── Safe DOM helpers ──────────────────────────────────────────────
export function safeEl(id)          { return document.getElementById(id); }
export function setText(id, val)    { const e = safeEl(id); if (e) e.textContent = val; }
export function setHTML(id, val)    { const e = safeEl(id); if (e) e.innerHTML = val; }
export function setPlaceholder(id, val) { const e = safeEl(id); if (e) e.placeholder = val; }
export function setDisplay(id, val) { const e = safeEl(id); if (e) e.style.display = val; }

// ── Answer letter helper (A, B, C…) ──────────────────────────────
export function answerLetter(i) { return String.fromCharCode(65 + i); }

// ── XSS-safe escape ───────────────────────────────────────────────
export function _esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ── Expose to window for inline onclick handlers ──────────────────
window.showScreen = showScreen;
window.toast      = toast;
window.showFb     = showFb;
window.buildDots  = buildDots;
window.setDot     = setDot;
window._esc       = _esc;
window.answerLetter = answerLetter;

// ── Additional exports for legacy.js compatibility ────────────────
window.safeEl          = safeEl;
window.setText         = setText;
window.setHTML         = setHTML;
window.setPlaceholder  = setPlaceholder;
window.setDisplay      = setDisplay;
