// ── Analytics ─────────────────────────────────────────────────────
// Dual-track: Supabase (internal) + Mixpanel (investor metrics / funnels).
// Never throws — analytics must not break the app.

import { sb } from './supabase.js';
import { getState } from '../state.js';

const _sessionId = Math.random().toString(36).slice(2);

// ── Mixpanel setup ────────────────────────────────────────────────
const MIXPANEL_TOKEN = '4b7f2c8a1d3e9f0b6a5c2d8e4f1b7a3c'; // replace with real token
let _mpReady = false;

function _initMixpanel() {
  if (_mpReady || window._mpLoading) return;
  window._mpLoading = true;
  // Load Mixpanel via script tag — avoids strict-mode IIFE issues in ES modules
  const s = document.createElement('script');
  s.src = 'https://cdn.mxpnl.com/libs/mixpanel-2-latest.min.js';
  s.async = true;
  s.onload = () => {
    try {
      window.mixpanel.init(MIXPANEL_TOKEN, {
        persistence: 'localStorage',
        ignore_dnt: true,
        batch_requests: true,
        loaded: () => { _mpReady = true; },
      });
    } catch(_) {}
  };
  document.head.appendChild(s);
}

// ── Key events to track for investor metrics ──────────────────────
const INVESTOR_EVENTS = new Set([
  'landing_play_now', 'landing_sign_in',
  'signup_completed', 'signup_started',
  'duel_created', 'duel_completed',
  'official_tournament_joined',
  'quiz_completed',
  'auth_screen_viewed',
  'share_to_telegram_clicked',
  'share_to_whatsapp_clicked',
]);

export async function track(eventName, props = {}) {
  try {
    const { currentUser, lang } = getState();
    const enriched = { lang, session_id: _sessionId, ...props };

    // Internal: Supabase
    sb.from('analytics_events').insert({
      user_id:    currentUser?.id || null,
      session_id: _sessionId,
      event_name: eventName,
      properties: enriched,
      created_at: new Date().toISOString(),
    }).then(() => {}).catch(() => {});

    // External: Mixpanel (investor funnel events)
    if (INVESTOR_EVENTS.has(eventName)) {
      _initMixpanel();
      if (window.mixpanel) {
        if (currentUser?.id && !window._mpIdentified) {
          window.mixpanel.identify(currentUser.id);
          window.mixpanel.people.set({
            '$name':  currentUser.user_metadata?.full_name || currentUser.email,
            '$email': currentUser.email,
            'lang':   lang,
          });
          window._mpIdentified = true;
        }
        window.mixpanel.track(eventName, enriched);
      }
    }
  } catch (_) {
    // analytics must never break the app
  }
}

// ── Page view + session start ─────────────────────────────────────
export function trackPageView() {
  _initMixpanel();
  try {
    if (window.mixpanel) window.mixpanel.track_pageview();
  } catch (_) {}
  track('session_start', { referrer: document.referrer, url: location.href });
}

// Expose globally for inline HTML handlers and legacy code
window.track = track;
window.trackPageView = trackPageView;
