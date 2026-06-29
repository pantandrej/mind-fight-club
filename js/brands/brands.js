import { sb } from '../services/supabase.js';
import { getState } from '../state.js';
import { track } from '../services/analytics.js';

// ── Brand Profile Page (?brand=slug) ──────────────────────────────

export async function openBrandPage(slug) {
  if (!slug) return;
  track('brand_page_viewed', { slug });

  const screen = document.getElementById('brand-screen');
  if (!screen) return;

  showScreen('brand');
  _renderBrandSkeleton();

  const [{ data: brand }, { data: tournaments }] = await Promise.all([
    sb.from('brand_profiles').select('*, parent:parent_id(id,name,slug)').eq('slug', slug).maybeSingle(),
    sb.from('official_tournaments')
      .select('id,title,starts_at,status,entry_fee,prize_pool,category')
      .eq('brand_id', _pluck('id', slug))   // will be replaced after brand loads
      .order('starts_at', { ascending: false })
      .limit(20),
  ]);

  if (!brand) { _renderBrandNotFound(); return; }

  // Re-fetch tournaments now that we have the real brand.id
  const { data: tournamentsFinal } = await sb
    .from('official_tournaments')
    .select('id,title,starts_at,status,entry_fee,prize_pool,category')
    .eq('brand_id', brand.id)
    .order('starts_at', { ascending: false })
    .limit(20);

  // Fetch child brands (e.g. Liga Indigo SPb, Liga Indigo Perm)
  const { data: children } = await sb
    .from('brand_profiles')
    .select('id,slug,name,city,logo_url')
    .eq('parent_id', brand.id)
    .order('name');

  _renderBrand(brand, tournamentsFinal || [], children || []);
}

function _pluck(field, slug) {
  // Placeholder — replaced after first fetch; initial tournaments query ignored
  return '00000000-0000-0000-0000-000000000000';
}

function _renderBrandSkeleton() {
  const inner = document.getElementById('brand-inner');
  if (!inner) return;
  inner.innerHTML = `
    <div style="animation:pulse 1.4s ease-in-out infinite">
      <div style="height:80px;background:var(--bg2);border-radius:20px;margin-bottom:16px"></div>
      <div style="height:20px;background:var(--bg2);border-radius:8px;margin-bottom:10px;width:60%"></div>
      <div style="height:14px;background:var(--bg2);border-radius:8px;margin-bottom:6px"></div>
      <div style="height:14px;background:var(--bg2);border-radius:8px;width:80%"></div>
    </div>`;
}

function _renderBrandNotFound() {
  const inner = document.getElementById('brand-inner');
  if (!inner) return;
  inner.innerHTML = `<div style="text-align:center;padding:60px 20px;color:var(--muted)">
    <div style="font-size:48px;margin-bottom:12px">🔍</div>
    <div style="font-size:16px;font-weight:700">Бренд не найден</div>
  </div>`;
}

function _renderBrand(brand, tournaments, children) {
  const inner = document.getElementById('brand-inner');
  if (!inner) return;

  const links = brand.external_links || {};
  const linkBtns = [
    links.tg  && `<a href="${links.tg}"  target="_blank" rel="noopener" style="${_linkStyle('#2CA5E0')}">Telegram</a>`,
    links.vk  && `<a href="${links.vk}"  target="_blank" rel="noopener" style="${_linkStyle('#4C75A3')}">ВКонтакте</a>`,
    links.web && `<a href="${links.web}" target="_blank" rel="noopener" style="${_linkStyle('var(--accent)')}">Сайт</a>`,
    links.ig  && `<a href="${links.ig}"  target="_blank" rel="noopener" style="${_linkStyle('#E1306C')}">Instagram</a>`,
  ].filter(Boolean).join('');

  const parentChip = brand.parent
    ? `<span onclick="openBrandPage('${brand.parent.slug}')" style="font-size:11px;color:var(--accent2);cursor:pointer;background:rgba(108,99,255,.12);border-radius:20px;padding:3px 10px">← ${brand.parent.name}</span>`
    : '';

  const childrenHtml = children.length ? `
    <div style="margin-top:20px">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:10px">Города</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${children.map(c => `
          <div onclick="openBrandPage('${c.slug}')" style="background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px">
            ${c.logo_url ? `<img src="${c.logo_url}" style="width:24px;height:24px;border-radius:6px;object-fit:cover">` : `<div style="font-size:20px">🏙️</div>`}
            <div>
              <div style="font-size:12px;font-weight:800">${_esc(c.name)}</div>
              ${c.city ? `<div style="font-size:10px;color:var(--muted)">${_esc(c.city)}</div>` : ''}
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const tournamentsHtml = tournaments.length ? `
    <div style="margin-top:24px">
      <div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:10px">Турниры</div>
      ${tournaments.map(t => _renderTournamentCard(t)).join('')}
    </div>` : '';

  inner.innerHTML = `
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:16px">
      ${brand.logo_url
        ? `<img src="${brand.logo_url}" style="width:64px;height:64px;border-radius:16px;object-fit:cover;border:0.5px solid var(--border)">`
        : `<div style="width:64px;height:64px;border-radius:16px;background:var(--bg2);border:0.5px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:28px">🏆</div>`}
      <div style="flex:1;min-width:0">
        ${parentChip}
        <div style="font-size:20px;font-weight:900;margin-top:4px;line-height:1.2">${_esc(brand.name)}</div>
        ${brand.city ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">📍 ${_esc(brand.city)}</div>` : ''}
      </div>
    </div>

    ${brand.description ? `<div style="font-size:14px;color:var(--muted);line-height:1.6;margin-bottom:16px">${_esc(brand.description)}</div>` : ''}

    ${linkBtns ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px">${linkBtns}</div>` : ''}

    ${childrenHtml}
    ${tournamentsHtml}`;
}

function _renderTournamentCard(t) {
  const date  = t.starts_at ? new Date(t.starts_at).toLocaleDateString('ru', { day:'numeric', month:'short' }) : '';
  const badge = t.status === 'active' ? `<span style="background:#4ade80;color:#000;border-radius:20px;padding:2px 8px;font-size:10px;font-weight:800">LIVE</span>`
              : t.status === 'upcoming' ? `<span style="background:rgba(108,99,255,.2);color:var(--accent2);border-radius:20px;padding:2px 8px;font-size:10px;font-weight:700">Скоро</span>`
              : `<span style="font-size:10px;color:var(--muted)">${date}</span>`;
  const prize = t.prize_pool > 0 ? `<span style="font-size:11px;color:#fbbf24;font-weight:700">🏆 ${t.prize_pool} ⚡</span>` : '';
  return `
    <div onclick="window.openOfficialTournament?.('${t.id}')"
         style="background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;padding:14px;margin-bottom:8px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:800;margin-bottom:4px">${_esc(t.title)}</div>
        <div style="display:flex;gap:8px;align-items:center">${badge}${prize}</div>
      </div>
      <div style="font-size:18px;color:var(--muted)">›</div>
    </div>`;
}

function _linkStyle(color) {
  return `display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.06);border:0.5px solid var(--border);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;color:${color};text-decoration:none;font-family:inherit`;
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Daily Logic Widget (home screen) ─────────────────────────────

export async function initDailyLogic() {
  const wrap = document.getElementById('daily-logic-wrap');
  if (!wrap) return;

  wrap.innerHTML = _skeletonWidget();

  const today = new Date().toISOString().slice(0, 10);
  const { data: q } = await sb
    .from('daily_logic_questions')
    .select('*, brand:brand_id(name,slug,logo_url)')
    .eq('active_date', today)
    .maybeSingle();

  if (!q) { wrap.style.display = 'none'; return; }
  wrap.style.display = '';

  const { currentUser } = getState();
  let attempt = null;

  if (currentUser) {
    const { data } = await sb
      .from('daily_logic_attempts')
      .select('is_correct')
      .eq('user_id', currentUser.id)
      .eq('question_id', q.id)
      .maybeSingle();
    attempt = data;
  }

  _renderWidget(wrap, q, attempt);
}

function _skeletonWidget() {
  return `<div style="animation:pulse 1.4s ease-in-out infinite;background:var(--bg2);border:0.5px solid var(--border);border-radius:18px;padding:18px">
    <div style="height:12px;background:var(--bg3,rgba(255,255,255,.07));border-radius:6px;width:40%;margin-bottom:12px"></div>
    <div style="height:16px;background:var(--bg3,rgba(255,255,255,.07));border-radius:6px;margin-bottom:8px"></div>
    <div style="height:16px;background:var(--bg3,rgba(255,255,255,.07));border-radius:6px;width:70%"></div>
  </div>`;
}

function _renderWidget(wrap, q, attempt) {
  const brand = q.brand;
  const byLine = brand
    ? `<div style="display:flex;align-items:center;gap:6px;margin-bottom:10px;cursor:pointer" onclick="openBrandPage('${brand.slug}')">
         ${brand.logo_url ? `<img src="${brand.logo_url}" style="width:20px;height:20px;border-radius:6px;object-fit:cover">` : ''}
         <span style="font-size:11px;color:var(--accent2);font-weight:700">${_esc(brand.name)}</span>
       </div>`
    : `<div style="font-size:11px;color:var(--muted);font-weight:700;margin-bottom:10px;letter-spacing:.5px">ВОПРОС ДНЯ · BFC</div>`;

  if (attempt !== null) {
    // Already answered — show result + explanation
    const icon  = attempt.is_correct ? '✅' : '❌';
    const color = attempt.is_correct ? '#4ade80' : '#f87171';
    wrap.innerHTML = `
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:18px;padding:18px">
        ${byLine}
        <div style="font-size:15px;font-weight:700;margin-bottom:12px;line-height:1.4">${_esc(q.question_text)}</div>
        ${q.media_url ? `<img src="${q.media_url}" style="width:100%;border-radius:12px;margin-bottom:12px;object-fit:cover;max-height:180px">` : ''}
        <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">ПРАВИЛЬНЫЙ ОТВЕТ</div>
          <div style="font-size:15px;font-weight:800;color:#fbbf24">${_esc(q.correct_answer_raw)}</div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:10px">${_esc(q.explanation)}</div>
        <div style="font-size:13px;font-weight:700;color:${color}">${icon} ${attempt.is_correct ? 'Ты ответил верно · +50 ⚡' : 'Ты ответил неверно'}</div>
      </div>`;
    return;
  }

  // Not yet answered
  const uid = `dlq_${q.id}`;
  wrap.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:18px;padding:18px">
      ${byLine}
      <div style="font-size:15px;font-weight:700;margin-bottom:12px;line-height:1.4">${_esc(q.question_text)}</div>
      ${q.media_url ? `<img src="${q.media_url}" style="width:100%;border-radius:12px;margin-bottom:12px;object-fit:cover;max-height:180px">` : ''}

      <div id="${uid}_input_wrap">
        <input id="${uid}_input" type="text" placeholder="Твой ответ..."
          style="width:100%;box-sizing:border-box;background:rgba(255,255,255,.06);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;margin-bottom:10px">
        <button onclick="window._dlqReveal('${q.id}')"
          style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:13px;font-size:14px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit">
          Показать ответ
        </button>
      </div>

      <div id="${uid}_reveal" style="display:none">
        <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;margin-bottom:10px">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">ПРАВИЛЬНЫЙ ОТВЕТ</div>
          <div style="font-size:15px;font-weight:800;color:#fbbf24">${_esc(q.correct_answer_raw)}</div>
        </div>
        <div style="font-size:12px;color:var(--muted);line-height:1.6;margin-bottom:14px">${_esc(q.explanation)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <button onclick="window._dlqSubmit('${q.id}', true)"
            style="background:rgba(74,222,128,.15);border:1px solid rgba(74,222,128,.4);border-radius:14px;padding:13px 8px;font-size:13px;font-weight:800;color:#4ade80;cursor:pointer;font-family:inherit;line-height:1.3">
            ✅ Угадал!<br><span style="font-size:11px;opacity:.7">+50 ⚡</span>
          </button>
          <button onclick="window._dlqSubmit('${q.id}', false)"
            style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:14px;padding:13px 8px;font-size:13px;font-weight:800;color:#f87171;cursor:pointer;font-family:inherit;line-height:1.3">
            ❌ Не угадал
          </button>
        </div>
      </div>
    </div>`;

  // Reveal handler
  window._dlqReveal = function(qid) {
    if (qid !== q.id) return;
    document.getElementById(`${uid}_input_wrap`).style.display = 'none';
    document.getElementById(`${uid}_reveal`).style.display = '';
    track('daily_logic_revealed', { question_id: q.id });
  };

  // Submit handler
  window._dlqSubmit = async function(qid, isCorrect) {
    if (qid !== q.id) return;
    const { currentUser } = getState();
    if (!currentUser) {
      window.toast?.('Войдите чтобы сохранить результат');
      return;
    }

    // Disable buttons
    document.querySelectorAll(`#${uid}_reveal button`).forEach(b => { b.disabled = true; b.style.opacity = '0.5'; });

    const { data, error } = await sb.rpc('submit_daily_logic', {
      p_question_id: q.id,
      p_is_correct:  isCorrect,
    });

    if (error && error.code !== '23505') {
      window.toast?.('Ошибка: ' + error.message);
      document.querySelectorAll(`#${uid}_reveal button`).forEach(b => { b.disabled = false; b.style.opacity = '1'; });
      return;
    }

    track('daily_logic_submitted', { question_id: q.id, is_correct: isCorrect });

    if (isCorrect && data?.awarded > 0) {
      window.toast?.(`🎉 +${data.awarded} ⚡ нейронов за правильный ответ!`);
      if (typeof window.updNeurons === 'function') setTimeout(window.updNeurons, 500);
    }

    // Re-render with result
    _renderWidget(wrap, q, { is_correct: isCorrect });
  };
}

// ── Route handler: ?brand=slug ────────────────────────────────────
export function checkBrandRoute() {
  const slug = new URLSearchParams(window.location.search).get('brand');
  if (slug) openBrandPage(slug);
}

// ── Window exports ─────────────────────────────────────────────────
window.openBrandPage   = openBrandPage;
window.initDailyLogic  = initDailyLogic;
window.checkBrandRoute = checkBrandRoute;
