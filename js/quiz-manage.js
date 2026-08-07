// ── Quiz Management ───────────────────────────────────────────────
// Handles: my quizzes list, create, edit, logo upload, admin panel
import { sb } from './services/supabase.js';
import { getState } from './state.js';

const STORAGE_URL = 'https://nhmidxkohjpcnhjucuuh.supabase.co/storage/v1/object/public/quiz-media';

// ── My Quizzes list ───────────────────────────────────────────────

export async function loadMyQuizzes() {
  const el = document.getElementById('my-quizzes-list');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:30px">Загрузка...</div>';

  const { data, error } = await sb.from('quizzes').select('*').eq('owner_id', getState().currentUser?.id).order('created_at', { ascending: false });
  if (error) { el.innerHTML = `<div style="color:var(--red);padding:12px">${error.message}</div>`; return; }

  if (!data?.length) {
    el.innerHTML = `<div style="text-align:center;padding:30px;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:10px">🧠</div>
      <div style="font-size:14px;font-weight:700">У вас пока нет квизов</div>
      <div style="font-size:12px;margin-top:6px">Зарегистрируйте свой квиз — это бесплатно</div>
    </div>`;
    return;
  }

  el.innerHTML = data.map(q => `
    <div onclick="window.loadQuizEdit('${q.id}')" style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:10px;cursor:pointer;display:flex;align-items:center;gap:12px">
      ${q.logo_url
        ? `<img src="${q.logo_url}" style="width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0">`
        : `<div style="width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,rgba(108,99,255,.3),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">🧠</div>`}
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:800;margin-bottom:3px">${_esc(q.name)}</div>
        <div style="font-size:11px;color:var(--muted)">bfc.ru/quiz/${_esc(q.slug)}</div>
      </div>
      <div style="font-size:11px;font-weight:700;padding:4px 9px;border-radius:8px;flex-shrink:0;${_statusStyle(q.status)}">${_statusLabel(q.status)}</div>
    </div>`).join('');
}

// ── Create Quiz ───────────────────────────────────────────────────

export function loadQuizCreate() {
  const el = document.getElementById('quiz-create-inner');
  if (!el) return;
  el.innerHTML = `
    ${_field('qc-name', 'Название квиза', '', 'Например: Quiz Night SPb')}
    ${_field('qc-slug', 'Адрес страницы (slug)', '', 'Только латиница, цифры, дефис — например: quiznight-spb')}
    ${_field('qc-desc', 'Описание', '', 'О чём ваш квиз, где проводится', 'textarea')}
    ${_field('qc-website', 'Сайт', '', 'https://')}
    <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin:14px 0 8px">СОЦСЕТИ</div>
    ${_field('qc-vk', 'ВКонтакте', '', 'https://vk.com/...')}
    ${_field('qc-tg', 'Telegram', '', 'https://t.me/...')}
    ${_field('qc-ig', 'Instagram', '', 'https://instagram.com/...')}
    ${_field('qc-yt', 'YouTube', '', 'https://youtube.com/...')}
    <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin:14px 0 8px">🎁 ОФФЕР НОВИЧКАМ</div>
    ${_field('qc-offer', 'Предложение для новичков', '', 'Например: Первый визит бесплатно! Скажи на входе «BFC»', 'textarea')}
    <button onclick="window._submitCreateQuiz()"
      style="width:100%;margin-top:16px;padding:15px;background:linear-gradient(135deg,#6c63ff,#a78bfa);border:none;border-radius:14px;color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit">
      Отправить заявку
    </button>`;

  // Auto-generate slug from name
  const nameInput = document.getElementById('qc-name');
  const slugInput = document.getElementById('qc-slug');
  if (nameInput && slugInput) {
    nameInput.addEventListener('input', () => {
      if (!slugInput._touched) {
        slugInput.value = nameInput.value.toLowerCase()
          .replace(/[а-яё]/g, c => ({'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'y','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'sch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya'}[c]||c))
          .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50);
      }
    });
    slugInput.addEventListener('input', () => { slugInput._touched = true; });
  }
}

window._submitCreateQuiz = async function() {
  const name  = document.getElementById('qc-name')?.value?.trim();
  const slug  = document.getElementById('qc-slug')?.value?.trim().toLowerCase();
  const desc  = document.getElementById('qc-desc')?.value?.trim() || null;
  const web   = document.getElementById('qc-website')?.value?.trim() || null;
  const offer = document.getElementById('qc-offer')?.value?.trim() || null;
  const social = {
    vk:        document.getElementById('qc-vk')?.value?.trim() || null,
    tg:        document.getElementById('qc-tg')?.value?.trim() || null,
    instagram: document.getElementById('qc-ig')?.value?.trim() || null,
    youtube:   document.getElementById('qc-yt')?.value?.trim() || null,
  };

  if (!name) { window.toast?.('Введите название'); return; }
  if (!slug) { window.toast?.('Введите адрес страницы'); return; }

  const btn = document.querySelector('#quiz-create-inner button');
  if (btn) btn.textContent = 'Отправка...';

  const { data, error } = await sb.rpc('create_quiz', {
    p_name: name, p_slug: slug, p_description: desc,
    p_website_url: web, p_social_links: social, p_newcomer_offer: offer,
  });

  if (btn) btn.textContent = 'Отправить заявку';

  if (error || !data?.ok) {
    const reason = data?.reason;
    if (reason === 'slug_taken') window.toast?.('Этот адрес уже занят — выберите другой');
    else if (reason === 'invalid_slug') window.toast?.('Адрес: только латиница, цифры и дефис');
    else window.toast?.('Ошибка: ' + (error?.message || reason));
    return;
  }

  window.toast?.('✅ Заявка отправлена! Мы проверим и опубликуем.');
  showScreen('my-quizzes');
  loadMyQuizzes();
};

// ── Edit Quiz ─────────────────────────────────────────────────────

window.loadQuizEdit = async function(id) {
  showScreen('quiz-edit');
  const el = document.getElementById('quiz-edit-inner');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:30px">Загрузка...</div>';

  const { data, error } = await sb.from('quizzes').select('*').eq('id', id).single();
  if (error || !data) { el.innerHTML = '<div style="color:var(--red)">Ошибка загрузки</div>'; return; }
  const q = data;
  const sl = q.social_links || {};

  el.innerHTML = `
    <div id="quiz-edit-logo-wrap" style="display:flex;flex-direction:column;align-items:center;margin-bottom:20px">
      ${q.logo_url
        ? `<img id="quiz-edit-logo-img" src="${q.logo_url}" style="width:80px;height:80px;border-radius:20px;object-fit:cover;margin-bottom:10px">`
        : `<div id="quiz-edit-logo-img" style="width:80px;height:80px;border-radius:20px;background:linear-gradient(135deg,rgba(108,99,255,.3),rgba(168,85,247,.2));display:flex;align-items:center;justify-content:center;font-size:36px;margin-bottom:10px">🧠</div>`}
      <label style="font-size:12px;color:var(--accent2);font-weight:700;cursor:pointer">
        📷 Изменить логотип
        <input type="file" accept="image/*" onchange="window._uploadQuizLogo('${q.id}', this)" style="display:none">
      </label>
    </div>
    ${q.status === 'rejected' ? `<div style="background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:12px;padding:12px;margin-bottom:14px;font-size:13px;color:#f87171">❌ Отклонено: ${_esc(q.reject_reason || '—')}</div>` : ''}
    ${_fieldVal('qe-name', 'Название', q.name)}
    <div style="margin-bottom:12px">
      <label style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted)">АДРЕС СТРАНИЦЫ</label>
      <div style="margin-top:6px;padding:10px 14px;background:rgba(255,255,255,.04);border:1px solid var(--border);border-radius:10px;font-size:13px;color:var(--muted)">bfc.ru/quiz/${_esc(q.slug)}</div>
    </div>
    ${_fieldVal('qe-desc', 'Описание', q.description || '', 'textarea')}
    ${_fieldVal('qe-website', 'Сайт', q.website_url || '')}
    <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin:14px 0 8px">СОЦСЕТИ</div>
    ${_fieldVal('qe-vk', 'ВКонтакте', sl.vk || '')}
    ${_fieldVal('qe-tg', 'Telegram', sl.tg || '')}
    ${_fieldVal('qe-ig', 'Instagram', sl.instagram || '')}
    ${_fieldVal('qe-yt', 'YouTube', sl.youtube || '')}
    <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin:14px 0 8px">🎁 ОФФЕР НОВИЧКАМ</div>
    ${_fieldVal('qe-offer', 'Предложение для новичков', q.newcomer_offer || '', 'textarea')}
    <button onclick="window._saveQuizEdit('${q.id}')"
      style="width:100%;margin-top:16px;padding:15px;background:linear-gradient(135deg,#6c63ff,#a78bfa);border:none;border-radius:14px;color:#fff;font-size:15px;font-weight:800;cursor:pointer;font-family:inherit">
      💾 Сохранить
    </button>
    ${q.status === 'active' ? `
    <a href="/quiz/${q.slug}" target="_blank"
      style="display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:10px;padding:12px;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);border-radius:12px;color:#4ade80;font-size:13px;font-weight:700;text-decoration:none">
      🔗 Открыть страницу квиза
    </a>` : ''}`;
};

window._saveQuizEdit = async function(id) {
  const social = {
    vk:        document.getElementById('qe-vk')?.value?.trim() || null,
    tg:        document.getElementById('qe-tg')?.value?.trim() || null,
    instagram: document.getElementById('qe-ig')?.value?.trim() || null,
    youtube:   document.getElementById('qe-yt')?.value?.trim() || null,
  };
  const { data, error } = await sb.rpc('update_quiz', {
    p_id:             id,
    p_name:           document.getElementById('qe-name')?.value?.trim(),
    p_description:    document.getElementById('qe-desc')?.value?.trim() || null,
    p_website_url:    document.getElementById('qe-website')?.value?.trim() || null,
    p_social_links:   social,
    p_newcomer_offer: document.getElementById('qe-offer')?.value?.trim() || null,
  });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  window.toast?.('✅ Сохранено');
};

window._uploadQuizLogo = async function(id, input) {
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { window.toast?.('Файл слишком большой (макс 2 МБ)'); return; }

  window.toast?.('Загружаю...');
  const uid = getState().currentUser?.id;
  const ext = file.name.split('.').pop();
  const path = `${uid}/${id}/logo.${ext}`;

  const { error } = await sb.storage.from('quiz-media').upload(path, file, { upsert: true });
  if (error) { window.toast?.('Ошибка загрузки: ' + error.message); return; }

  const url = `${STORAGE_URL}/${path}`;
  await sb.rpc('set_quiz_logo', { p_id: id, p_logo_url: url });

  // Update preview
  const img = document.getElementById('quiz-edit-logo-img');
  if (img) {
    const el = document.createElement('img');
    el.id = 'quiz-edit-logo-img';
    el.src = url + '?t=' + Date.now();
    el.style.cssText = 'width:80px;height:80px;border-radius:20px;object-fit:cover;margin-bottom:10px';
    img.replaceWith(el);
  }
  window.toast?.('✅ Логотип обновлён');
};

// ── Admin Quiz Panel ──────────────────────────────────────────────

export async function loadAdminQuizzes() {
  const el = document.getElementById('admin-quizzes-inner');
  if (!el) return;

  const tab = window._adminQuizTab || 'pending';
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:14px">
      ${['pending','active','rejected'].map(t => `
        <button onclick="window._adminQuizTab='${t}';loadAdminQuizzes()"
          style="flex:1;padding:8px;border-radius:10px;border:1px solid ${tab===t?'var(--accent)':'var(--border)'};background:${tab===t?'rgba(108,99,255,.15)':'var(--bg2)'};color:${tab===t?'var(--accent2)':'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          ${{pending:'⏳ Заявки',active:'✅ Активные',rejected:'❌ Отклонённые'}[t]}
        </button>`).join('')}
    </div>
    <div id="admin-quizzes-list"><div style="color:var(--muted);text-align:center;padding:30px">Загрузка...</div></div>`;

  const { data, error } = await sb.rpc('admin_get_quizzes', { p_status: tab });
  const list = document.getElementById('admin-quizzes-list');
  if (!list) return;

  if (error || !data?.ok) { list.innerHTML = `<div style="color:var(--red)">${error?.message || data?.reason}</div>`; return; }
  const quizzes = data.quizzes || [];

  if (!quizzes.length) { list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">Пусто</div>'; return; }

  list.innerHTML = quizzes.map(q => `
    <div style="background:var(--bg);border:1px solid var(--border);border-radius:14px;padding:14px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        ${q.logo_url ? `<img src="${q.logo_url}" style="width:40px;height:40px;border-radius:10px;object-fit:cover;flex-shrink:0">` : '<div style="width:40px;height:40px;border-radius:10px;background:rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;flex-shrink:0">🧠</div>'}
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800">${_esc(q.name)}</div>
          <div style="font-size:11px;color:var(--muted)">bfc.ru/quiz/${_esc(q.slug)} · ${new Date(q.created_at).toLocaleDateString('ru')}</div>
        </div>
      </div>
      ${q.description ? `<div style="font-size:12px;color:var(--muted);margin-bottom:10px">${_esc(q.description)}</div>` : ''}
      ${q.reject_reason ? `<div style="font-size:12px;color:#f87171;margin-bottom:8px">Причина отказа: ${_esc(q.reject_reason)}</div>` : ''}
      <div style="display:flex;gap:8px">
        ${tab === 'pending' ? `
          <button onclick="window._adminQuizApprove('${q.id}')"
            style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(74,222,128,.4);background:rgba(74,222,128,.1);color:#4ade80;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit">
            ✅ Одобрить
          </button>
          <button onclick="window._adminQuizReject('${q.id}')"
            style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:#f87171;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit">
            ❌ Отклонить
          </button>` : ''}
        ${tab === 'active' ? `
          <a href="/quiz/${q.slug}" target="_blank"
            style="flex:1;padding:9px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--muted);font-size:12px;font-weight:800;text-decoration:none;text-align:center;cursor:pointer">
            🔗 Открыть
          </a>
          <button onclick="window._adminQuizReject('${q.id}')"
            style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:#f87171;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit">
            Деактивировать
          </button>` : ''}
        ${tab === 'rejected' ? `
          <button onclick="window._adminQuizApprove('${q.id}')"
            style="flex:1;padding:9px;border-radius:10px;border:1px solid rgba(74,222,128,.4);background:rgba(74,222,128,.1);color:#4ade80;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit">
            ↩ Восстановить
          </button>` : ''}
      </div>
    </div>`).join('');
}

window._adminQuizApprove = async function(id) {
  const { data, error } = await sb.rpc('admin_approve_quiz', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  window.toast?.('✅ Квиз опубликован');
  loadAdminQuizzes();
};

window._adminQuizReject = async function(id) {
  const reason = prompt('Причина отклонения (необязательно):') ?? '';
  const { data, error } = await sb.rpc('admin_reject_quiz', { p_id: id, p_reason: reason || null });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  window.toast?.('Квиз отклонён');
  loadAdminQuizzes();
};

// ── Helpers ───────────────────────────────────────────────────────

function _field(id, label, val, placeholder, type = 'input') {
  return _fieldVal(id, label, val, type, placeholder);
}

function _fieldVal(id, label, val, type = 'input', placeholder = '') {
  const s = 'width:100%;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 14px;font-size:13px;color:var(--text);font-family:inherit;box-sizing:border-box';
  const v = _esc(val);
  const p = _esc(placeholder);
  return `<div style="margin-bottom:12px">
    <label style="font-size:10px;font-weight:800;letter-spacing:1px;color:var(--muted)">${label.toUpperCase()}</label>
    ${type === 'textarea'
      ? `<textarea id="${id}" rows="3" placeholder="${p}" style="${s};margin-top:6px;resize:vertical">${v}</textarea>`
      : `<input id="${id}" type="text" value="${v}" placeholder="${p}" style="${s};margin-top:6px">`}
  </div>`;
}

function _statusLabel(s) {
  return { pending: '⏳ На проверке', active: '✅ Активен', rejected: '❌ Отклонён' }[s] || s;
}

function _statusStyle(s) {
  return {
    pending:  'background:rgba(240,192,64,.12);color:var(--gold)',
    active:   'background:rgba(74,222,128,.12);color:#4ade80',
    rejected: 'background:rgba(248,113,113,.12);color:#f87171',
  }[s] || '';
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

window.loadMyQuizzes    = loadMyQuizzes;
window.loadQuizCreate   = loadQuizCreate;
window.loadAdminQuizzes = loadAdminQuizzes;
