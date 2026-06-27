// ── Activity Feed ─────────────────────────────────────────────────────
// Shows recent pack plays on home screen — creates social presence

import { sb } from './services/supabase.js';

const PACK_ICONS = {
  videogames: '🎮', videogames_v2: '🎮',
  slovo: '🗡️', squid: '🦑', worldcup: '⚽',
};

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  const h = Math.floor(diff / 3600000);
  if (m < 1)  return 'только что';
  if (m < 60) return `${m} мин назад`;
  if (h < 24) return `${h}ч назад`;
  return `вчера`;
}

export async function loadActivityFeed() {
  const wrap = document.getElementById('home-activity-feed');
  const list = document.getElementById('home-activity-list');
  if (!wrap || !list) return;

  try {
    const since = new Date(Date.now() - 24 * 3600000).toISOString();
    const { data } = await sb
      .from('pack_results')
      .select('pack_id, pack_title, score, correct, total, played_at, profiles(display_name)')
      .gte('played_at', since)
      .order('played_at', { ascending: false })
      .limit(8);

    if (!data?.length) return;

    const rows = data.map(r => {
      const name  = r.profiles?.display_name || 'Игрок';
      const icon  = PACK_ICONS[r.pack_id] || '📦';
      const title = r.pack_title || r.pack_id;
      const pct   = r.total > 0 ? Math.round((r.correct / r.total) * 100) : 0;
      const ago   = timeAgo(r.played_at);
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid rgba(255,255,255,.05)">
        <div style="font-size:18px;flex-shrink:0">${icon}</div>
        <div style="flex:1;min-width:0">
          <span style="font-size:12px;font-weight:700">${name}</span>
          <span style="font-size:12px;color:var(--muted)"> сыграл «${title}»</span>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:12px;font-weight:800;color:var(--accent2)">⚡ ${r.score}</div>
          <div style="font-size:10px;color:var(--muted)">${pct}% · ${ago}</div>
        </div>
      </div>`;
    }).join('');

    list.innerHTML = rows;
    wrap.style.display = 'block';
  } catch(e) {
    // Fail silently — feed is non-critical
  }
}
