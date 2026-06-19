// ── Supabase client ───────────────────────────────────────────────
// Single instance shared across all modules.
// The global `supabase` object is loaded via CDN <script> in index.html
// before this module is imported.

import { SUPA_URL, SUPA_KEY } from '../config.js';

// eslint-disable-next-line no-undef
export const sb = supabase.createClient(SUPA_URL, SUPA_KEY);
