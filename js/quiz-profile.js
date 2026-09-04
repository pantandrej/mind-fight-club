// ── Quiz Profile Screen (inside SPA) ─────────────────────────────
import { sb } from './services/supabase.js';

const SUPA_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co';
const SUPA_KEY = 'sb_publishable_lFVRCP-PPnGnNzn9G60A3A_gTy40vMs';

export async function loadQuizProfile(slug) {
  const el = document.getElementById('quiz-profile-screen');
  if (!el) return;
  window._quizProfileSlug = slug;

  el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted);font-size:14px">Загрузка...</div>`;

  const res = await fetch(`${SUPA_URL}/rest/v1/rpc/get_quiz_by_slug`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'apikey': SUPA_KEY },
    body: JSON.stringify({ p_slug: slug }),
  });
  const json = await res.json();
  if (!json?.ok) {
    el.innerHTML = `<div style="padding:60px 20px;text-align:center;color:var(--muted)">Квиз не найден 🙁</div>`;
    return;
  }

  const q = json.quiz;
  const sl = q.social_links || {};

  // Топ команды параллельно
  const { data: topTeams } = await sb
    .from('teams')
    .select('id,name,score,logo_url')
    .order('score', { ascending: false })
    .limit(5);

  const socialBtns = [
    sl.vk        && `<a href="${_esc(sl.vk)}" target="_blank" style="${_socialStyle()}">🔵 ВКонтакте</a>`,
    sl.tg        && `<a href="${_esc(sl.tg)}" target="_blank" style="${_socialStyle()}">✈️ Telegram</a>`,
    sl.instagram && `<a href="${_esc(sl.instagram)}" target="_blank" style="${_socialStyle()}">📸 Instagram</a>`,
    sl.youtube   && `<a href="${_esc(sl.youtube)}" target="_blank" style="${_socialStyle()}">▶️ YouTube</a>`,
    q.website_url && `<a href="${_esc(q.website_url)}" target="_blank" style="${_socialStyle()}">🌐 Сайт</a>`,
  ].filter(Boolean).join('');

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  const teamsHtml = (topTeams || []).map((t, i) => `
    <div onclick="window.loadTeamProfile?.('${t.id}')" style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:0.5px solid var(--border);cursor:pointer">
      <div style="font-size:18px;width:28px;text-align:center;flex-shrink:0">${medals[i] || (i+1)+'.'}</div>
      ${t.logo_url
        ? `<img src="${_esc(t.logo_url)}" style="width:36px;height:36px;border-radius:10px;object-fit:cover;flex-shrink:0">`
        : `<div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,rgba(0,237,181,.3),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🧠</div>`}
      <div style="flex:1;font-size:13px;font-weight:700">${_esc(t.name)}</div>
      <div style="font-size:12px;font-weight:800;color:var(--accent2)">${t.score || 0} BF</div>
    </div>`).join('');

  el.innerHTML = `
    <div style="padding:0 16px 80px">
      <!-- Шапка -->
      <div style="display:flex;flex-direction:column;align-items:center;padding:32px 0 24px">
        ${q.logo_url
          ? `<img src="${_esc(q.logo_url)}" style="width:88px;height:88px;border-radius:22px;object-fit:cover;border:2px solid var(--border)">`
          : `<div style="width:88px;height:88px;border-radius:22px;background:linear-gradient(135deg,rgba(0,237,181,.3),rgba(168,85,247,.2));border:2px solid rgba(0,237,181,.4);display:flex;align-items:center;justify-content:center;font-size:40px">🧠</div>`}
        <div style="font-size:22px;font-weight:900;text-align:center;margin-top:14px">${_esc(q.name)}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:4px">bfc.ru/quiz/${_esc(q.slug)}</div>
        ${q.description ? `<div style="font-size:13px;color:var(--muted);line-height:1.6;text-align:center;margin-top:10px;max-width:320px">${_esc(q.description)}</div>` : ''}
      </div>

      ${socialBtns ? `
      <div style="${_sectionStyle()}">
        <div style="${_sectionTitleStyle()}">МЫ ЗДЕСЬ</div>
        <div style="display:flex;flex-wrap:wrap;gap:8px">${socialBtns}</div>
      </div>` : ''}

      ${q.newcomer_offer ? `
      <div style="${_sectionStyle()};border-color:rgba(240,192,64,.25);background:rgba(240,192,64,.06)">
        <div style="${_sectionTitleStyle()};color:var(--gold)">🎁 НОВИЧКАМ</div>
        <div style="font-size:13px;line-height:1.6;white-space:pre-line">${_esc(q.newcomer_offer)}</div>
      </div>` : ''}

      ${teamsHtml ? `
      <div style="${_sectionStyle()}">
        <div style="${_sectionTitleStyle()}">🏆 ЛУЧШИЕ КОМАНДЫ В BFC</div>
        ${teamsHtml}
      </div>` : ''}
    </div>`;
}

function _socialStyle() {
  return 'display:inline-flex;align-items:center;gap:7px;padding:9px 14px;background:var(--bg);border:0.5px solid var(--border);border-radius:10px;text-decoration:none;color:var(--text);font-size:13px;font-weight:700';
}

function _sectionStyle() {
  return 'background:var(--bg2);border:0.5px solid var(--border);border-radius:18px;padding:18px;margin-bottom:12px';
}

function _sectionTitleStyle() {
  return 'font-size:10px;font-weight:800;letter-spacing:1.5px;color:var(--muted);margin-bottom:12px';
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.loadQuizProfile = loadQuizProfile;
