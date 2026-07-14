// ── Supabase client ───────────────────────────────────────────────
// Single instance shared across all modules.
// The global `supabase` object is loaded via CDN <script> in index.html
// before this module is imported.

import { SUPA_URL, SUPA_KEY } from '../config.js';

// eslint-disable-next-line no-undef
export const sb = supabase.createClient(SUPA_URL, SUPA_KEY);

// ── Legacy shim bridge ────────────────────────────────────────────
// legacy.js declares `let sb` and waits for window._sbReady setter.
// ES modules load async — this fires after legacy.js runs but before
// DOMContentLoaded, so the setter is already defined.
window._sbReady         = sb;   // triggers the setter in legacy.js
window.sb               = sb;   // direct access for training.js and inline handlers
window._supabaseAnonKey = SUPA_KEY;
window._supabaseUrl     = SUPA_URL;
