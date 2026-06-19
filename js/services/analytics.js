// ── Analytics ─────────────────────────────────────────────────────
// Fire-and-forget event tracking. Never throws — analytics must not
// break the app.

import { sb } from './supabase.js';
import { getState } from '../state.js';

const _sessionId = Math.random().toString(36).slice(2);

export async function track(eventName, props = {}) {
  try {
    const { currentUser, lang } = getState();
    await sb.from('analytics_events').insert({
      user_id:    currentUser?.id || null,
      session_id: _sessionId,
      event_name: eventName,
      properties: { lang, ...props },
      created_at: new Date().toISOString(),
    });
  } catch (_) {
    // analytics must never break the app
  }
}

// Expose globally for inline HTML handlers and legacy code
window.track = track;
