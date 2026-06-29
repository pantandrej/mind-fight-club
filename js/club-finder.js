// ── Club Finder (LFG Board) ────────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';
import { track } from './services/analytics.js';

// ── Load board ────────────────────────────────────────────────────
export async function loadClubFinder(filters = {}) {
  const wrap = document.getElementById('club-finder-list');
  if (!wrap) return;

  wrap.innerHTML = _skeleton();

  let query = sb
    .from('club_recruitment_board')
    .select(`
      id, title, description, category, city, slots_open, created_at,
      club:club_id(id, name, emoji, total_neurons),
      creator:creator_id(id, display_name, neurons, xp)
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false })
    .limit(30);

  if (filters.city)     query = query.eq('city', filters.city);
  if (filters.category) query = query.eq('category', filters.category);

  const { data: posts, error } = await query;

  if (error || !posts?.length) {
    wrap.innerHTML = `<div style="text-align:center;padding:40px 20px;color:var(--muted)">
      <div style="font-size:36px;margin-bottom:10px">🔍</div>
      <div style="font-size:14px;font-weight:700">Пока нет активных объявлений</div>
      <div style="font-size:12px;margin-top:6px">Будь первым — создай пост для своего клуба</div>
    </div>`;
    return;
  }

  wrap.innerHTML = posts.map(_renderPost).join('');
}

function _renderPost(p) {
  const club    = p.club    || {};
  const creator = p.creator || {};
  const age     = _timeAgo(p.created_at);
  return `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;padding:16px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:42px;height:42px;border-radius:12px;background:rgba(108,99,255,.15);border:0.5px solid rgba(108,99,255,.3);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">
          ${club.emoji || '🧠'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${_esc(club.name || 'Клуб')}</div>
          <div style="font-size:11px;color:var(--muted)">${_esc(creator.display_name || '')} · ${age}</div>
        </div>
        ${p.slots_open > 0 ? `<div style="background:rgba(74,222,128,.15);border:0.5px solid rgba(74,222,128,.4);border-radius:20px;padding:3px 10px;font-size:11px;font-weight:800;color:#4ade80;flex-shrink:0">${p.slots_open} место${p.slots_open > 1 ? 'а' : ''}</div>` : ''}
      </div>

      <div style="font-size:14px;font-weight:800;margin-bottom:6px">${_esc(p.title)}</div>
      ${p.description ? `<div style="font-size:12px;color:var(--muted);line-height:1.5;margin-bottom:10px">${_esc(p.description)}</div>` : ''}

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        ${p.city     ? `<span style="${_chipStyle()}"">📍 ${_esc(p.city)}</span>` : ''}
        ${p.category ? `<span style="${_chipStyle()}"">🏷 ${_esc(p.category)}</span>` : ''}
        ${creator.xp ? `<span style="${_chipStyle()}"">⚡ ${creator.xp} XP</span>` : ''}
        ${(club.total_neurons||0) > 0 ? `<span style="${_chipStyle()}"">🧠 ${club.total_neurons} нейронов</span>` : ''}
      </div>

      <button onclick="window.applyToClub('${p.id}', this)"
        style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:11px;font-size:13px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">
        Подать заявку →
      </button>
    </div>`;
}

// ── Apply ─────────────────────────────────────────────────────────
window.applyToClub = async function(postId, btn) {
  const { currentUser } = getState();
  if (!currentUser) { window.toast?.('Войдите чтобы подать заявку'); return; }

  btn.disabled = true;
  btn.textContent = '...';

  const { data, error } = await sb.rpc('apply_to_club', { p_post_id: postId });

  if (error || !data?.ok) {
    window.toast?.(error?.message || data?.reason || 'Ошибка');
    btn.disabled = false;
    btn.textContent = 'Подать заявку →';
    return;
  }

  // Send push via send-push edge function
  if (data.creator_id && data.applicant) {
    const a = data.applicant;
    window._sendPushToUser?.(data.creator_id,
      `👥 ${a.name} хочет вступить в твой клуб`,
      `${a.xp} XP · ${a.neurons} нейронов`,
      `${location.origin}/?uid=${a.id}`
    );
  }

  btn.textContent = '✅ Заявка отправлена';
  btn.style.background = 'rgba(74,222,128,.15)';
  btn.style.color = '#4ade80';
  btn.style.border = '1px solid rgba(74,222,128,.4)';
  track('club_finder_apply', { post_id: postId });
};

// ── Publish post (Captain) ────────────────────────────────────────
export async function publishRecruitmentPost(clubId, title, description, category, city, slotsOpen) {
  const { currentUser } = getState();
  if (!currentUser) return;

  const { data, error } = await sb.from('club_recruitment_board').insert({
    club_id:     clubId,
    creator_id:  currentUser.id,
    title:       title.trim(),
    description: description?.trim() || null,
    category:    category || null,
    city:        city || null,
    slots_open:  slotsOpen || 1,
  }).select().maybeSingle();

  if (error) { window.toast?.('Ошибка: ' + error.message); return null; }
  track('club_finder_post_created', { club_id: clubId });
  window.toast?.('✅ Объявление опубликовано');
  return data;
}

// ── Filters ───────────────────────────────────────────────────────
export function renderClubFinderFilters(cities, categories) {
  const wrap = document.getElementById('club-finder-filters');
  if (!wrap) return;

  wrap.innerHTML = `
    <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;-webkit-overflow-scrolling:touch">
      <button onclick="window._cfFilter({})" id="cf-all"
        style="${_filterBtnStyle(true)}">Все</button>
      ${cities.map(c => `
        <button onclick="window._cfFilter({city:'${c}'})"
          style="${_filterBtnStyle(false)}">📍 ${c}</button>`).join('')}
      ${categories.map(c => `
        <button onclick="window._cfFilter({category:'${c}'})"
          style="${_filterBtnStyle(false)}">🏷 ${c}</button>`).join('')}
    </div>`;
}

window._cfFilter = function(filters) {
  document.querySelectorAll('[id^="cf-"]').forEach(b => {
    b.style.background = 'var(--bg2)';
    b.style.color = 'var(--muted)';
  });
  loadClubFinder(filters);
};

// ── Helpers ───────────────────────────────────────────────────────
function _skeleton() {
  return Array(3).fill(0).map(() => `
    <div style="background:var(--bg2);border-radius:16px;padding:16px;margin-bottom:10px;animation:pulse 1.4s ease-in-out infinite">
      <div style="height:42px;background:rgba(255,255,255,.05);border-radius:12px;margin-bottom:10px"></div>
      <div style="height:14px;background:rgba(255,255,255,.05);border-radius:6px;width:70%;margin-bottom:8px"></div>
      <div style="height:11px;background:rgba(255,255,255,.05);border-radius:6px;margin-bottom:6px"></div>
      <div style="height:38px;background:rgba(255,255,255,.05);border-radius:12px;margin-top:10px"></div>
    </div>`).join('');
}

function _chipStyle() {
  return 'background:rgba(255,255,255,.06);border:0.5px solid var(--border);border-radius:20px;padding:3px 9px;font-size:11px;color:var(--muted)';
}

function _filterBtnStyle(active) {
  return `flex-shrink:0;background:${active ? 'var(--accent)' : 'var(--bg2)'};border:0.5px solid ${active ? 'var(--accent)' : 'var(--border)'};border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;color:${active ? '#fff' : 'var(--muted)'};cursor:pointer;font-family:inherit`;
}

function _timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 3600)  return Math.floor(s/60)  + ' мин назад';
  if (s < 86400) return Math.floor(s/3600) + ' ч назад';
  return Math.floor(s/86400) + ' дн назад';
}

function _esc(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.loadClubFinder          = loadClubFinder;
window.publishRecruitmentPost  = publishRecruitmentPost;
window.renderClubFinderFilters = renderClubFinderFilters;
