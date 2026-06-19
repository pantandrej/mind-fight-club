// ── Wallet / Currency ─────────────────────────────────────────────
// All mutations for authenticated users go through Supabase RPC only.
// Guest users get a local demo balance (not persisted to account).
//
// XP      — rating points; never decrease; drive leaderboards
// Neurons — spendable shop currency; reduced by purchases only

import { sb }    from '../services/supabase.js';
import { track } from '../services/analytics.js';
import { getState, setState } from '../state.js';

// ── Display sync ──────────────────────────────────────────────────
export function updNeurons() {
  const { neurons, xp } = getState();
  [
    'n-home','n-quiz','n-duel','n-tourn','n-shop',
    'n-profile','n-share','n-teams','n-ot','n-mm','n-club-hdr',
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = neurons;
  });
  document.querySelectorAll('.xp-display').forEach(el => el.textContent = xp);
  // Sync legacy shim variables
  if (window._syncStateToLegacy) window._syncStateToLegacy();
}

// ── Award currency (server-authoritative) ─────────────────────────
// API: awardCurrency({ operationType, operationKey, guestPreviewAmount })
//   operationType      — used by server to determine award amount
//   operationKey       — idempotency key (prevents double-award)
//   guestPreviewAmount — used ONLY for guest demo balance display
// Server always determines the real amount for authenticated users.
// Server returns: { neurons, xp, awarded_neurons, awarded_xp, already_processed }
export async function awardCurrency({ operationType, operationKey, guestPreviewAmount = 0 }) {
  const { currentUser } = getState();

  if (!currentUser) {
    // Guest: local demo balance only — not persisted
    const s = getState();
    setState({ neurons: s.neurons + guestPreviewAmount, xp: s.xp + guestPreviewAmount });
    updNeurons();
    const ns = getState();
    return { neurons: ns.neurons, xp: ns.xp, awarded_neurons: guestPreviewAmount, awarded_xp: guestPreviewAmount };
  }

  try {
    const { data, error } = await sb.rpc('award_currency', {
      p_operation_type: operationType || 'generic_reward',
      p_operation_key:  operationKey  || null,
    });
    if (error) {
      console.error('[wallet] award_currency RPC error:', error.message);
      track('award_rpc_error', { op: operationType, err: error.message });
      return null;
    }
    setState({ neurons: data.neurons, xp: data.xp });
    updNeurons();
    return data; // { neurons, xp, awarded, already_claimed }
  } catch (e) {
    console.error('[wallet] awardCurrency exception:', e.message);
    return null;
  }
}

// Legacy alias — callers still use awardNeurons(amount, type, key)
// Deprecated: migrate callers to awardCurrency({}) in Iteration 3+
export async function awardNeurons(amount, operationType, operationKey) {
  return awardCurrency({ operationType, operationKey, guestPreviewAmount: amount });
}

// ── Spend neurons (atomic, XP untouched) ─────────────────────────
export async function spendNeurons(amount, operationType, operationKey) {
  const { currentUser, neurons, xp } = getState();

  if (!currentUser) {
    if (neurons < amount) return { ok: false, reason: 'insufficient' };
    setState({ neurons: neurons - amount });
    updNeurons();
    const s = getState();
    return { ok: true, neurons: s.neurons, xp: s.xp };
  }

  try {
    const { data, error } = await sb.rpc('spend_neurons', {
      p_amount:         amount,
      p_operation_type: operationType || 'purchase',
      p_operation_key:  operationKey  || null,
    });
    if (error) {
      if (error.message?.includes('insufficient')) return { ok: false, reason: 'insufficient' };
      console.error('[wallet] spend_neurons RPC error:', error.message);
      track('spend_rpc_error', { op: operationType, err: error.message });
      return { ok: false, reason: error.message };
    }
    setState({ neurons: data.neurons, xp: data.xp });
    updNeurons();
    return { ok: true, ...data };
  } catch (e) {
    console.error('[wallet] spendNeurons exception:', e.message);
    return { ok: false, reason: e.message };
  }
}

// ── Re-sync balance from server ───────────────────────────────────
export async function refreshBalance() {
  const { currentUser } = getState();
  if (!currentUser) return;
  try {
    const { data, error } = await sb.from('profiles')
      .select('neurons, xp')
      .eq('id', currentUser.id)
      .single();
    if (error) throw error;
    const s = getState();
    setState({ neurons: data.neurons ?? s.neurons, xp: data.xp ?? s.xp });
    updNeurons();
  } catch (e) {
    console.warn('[wallet] refreshBalance error:', e.message);
  }
}

// ── saveNeurons: DEPRECATED ───────────────────────────────────────
// Do NOT use for balance mutations — use RPC only.
// Kept only for display_name / city sync on profile screen.
// Never writes neurons or xp directly.
export async function saveNeurons() {
  const { currentUser, lang } = getState();
  if (!currentUser) return;
  const city         = localStorage.getItem('mfc_city') || null;
  const display_name = currentUser.user_metadata?.full_name
    || currentUser.email?.split('@')[0] || 'Игрок';
  try {
    // Only update non-balance fields — neurons/xp come from RPC
    await sb.from('profiles').update({
      display_name,
      ...(city ? { city } : {}),
      updated_at: new Date().toISOString(),
    }).eq('id', currentUser.id);
  } catch (e) {
    console.warn('[wallet] saveNeurons (display sync) error:', e.message);
  }
  if (typeof window.updateTeamNeurons === 'function' && window.myTeam) {
    window.updateTeamNeurons();
  }
}

// ── window exports ────────────────────────────────────────────────
window.updNeurons     = updNeurons;
window.awardNeurons   = awardNeurons;   // legacy alias
window.awardCurrency  = awardCurrency;  // new API
window.spendNeurons   = spendNeurons;
window.refreshBalance = refreshBalance;
window.saveNeurons    = saveNeurons;
