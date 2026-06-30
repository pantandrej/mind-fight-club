// ── Brand display-name resolver (franchise model) ───────────────────
// Always source brand display names from v_city_branches, never raw
// brand_profiles.name — this guarantees "Liga Indigo Tver" style
// city-branch naming is consistent everywhere in the app.
import { sb } from './supabase.js';

const _cache = new Map();   // brand_id -> display_name (5 min TTL)
const _cacheTime = new Map();
const TTL_MS = 5 * 60 * 1000;

export async function getBrandDisplayName(brandId) {
  if (!brandId) return '';
  const cached = _cache.get(brandId);
  if (cached && (Date.now() - _cacheTime.get(brandId)) < TTL_MS) return cached;

  const { data } = await sb.from('v_city_branches')
    .select('display_name').eq('id', brandId).maybeSingle();
  const name = data?.display_name || '';
  _cache.set(brandId, name);
  _cacheTime.set(brandId, Date.now());
  return name;
}

// Batch fetch — use when rendering a list (tournaments, quiz passes, etc.)
export async function getBrandDisplayNames(brandIds) {
  const ids = [...new Set(brandIds.filter(Boolean))];
  if (!ids.length) return {};
  const { data } = await sb.from('v_city_branches')
    .select('id, display_name').in('id', ids);
  const map = {};
  (data || []).forEach(r => {
    map[r.id] = r.display_name;
    _cache.set(r.id, r.display_name);
    _cacheTime.set(r.id, Date.now());
  });
  return map;
}

// Fetch a full branch row (for brand pages, organizer cabinet)
export async function getBrandBranchInfo(brandId) {
  const { data } = await sb.from('v_city_branches')
    .select('*').eq('id', brandId).maybeSingle();
  return data;
}

window.getBrandDisplayName  = getBrandDisplayName;
window.getBrandDisplayNames = getBrandDisplayNames;
