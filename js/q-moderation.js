// ── Question Moderation ───────────────────────────────────────────
import { sb } from './services/supabase.js';
import { SUPA_URL, SUPA_KEY } from './config.js';

const PAGE = 20;
let _offset = 0;
let _total  = 0;
let _filter = 'pending'; // 'pending' | 'active'
let _pendingCache = null; // все pending-вопросы, загруженные без OR-фильтра

// Два параллельных запроса вместо OR (OR ломается через Vercel прокси)
async function _fetchPendingAll() {
  const SEL = 'id,question_text,question_ru,answers_json,correct_index,status,category,source_type,approved_at';
  const hdrs = { cache: 'no-store', headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } };
  const ts = Date.now();
  const [r1, r2] = await Promise.all([
    fetch(`${SUPA_URL}/rest/v1/questions?select=${SEL}&status=is.null&order=id.desc&limit=5000&_=${ts}a`, hdrs),
    fetch(`${SUPA_URL}/rest/v1/questions?select=${SEL}&status=eq.published&order=id.desc&limit=5000&_=${ts}b`, hdrs),
  ]);
  const d1 = r1.ok ? await r1.json() : [];
  const d2 = r2.ok ? await r2.json() : [];
  const all = [...(Array.isArray(d1) ? d1 : []), ...(Array.isArray(d2) ? d2 : [])];
  all.sort((a, b) => (b.id > a.id ? 1 : -1));
  return all;
}

export async function loadQModeration() {
  const inner = document.getElementById('qmod-inner');
  if (!inner) return;

  _offset = 0;
  _pendingCache = null;
  inner.innerHTML = `<div id="qmod-loading" style="text-align:center;padding:40px;color:var(--muted)">Загрузка...</div>`;

  if (_filter === 'active') {
    const { count } = await sb.from('questions').select('id', { count: 'exact', head: true }).eq('status', 'active');
    _total = count || 0;
  } else {
    _pendingCache = await _fetchPendingAll();
    _total = _pendingCache.length;
  }

  _renderFilter(inner);
  await _loadPage(inner, true);
}

function _renderFilter(inner) {
  const counter = document.getElementById('qmod-counter');
  if (counter) counter.textContent = `${_total} вопросов`;

  let bar = document.getElementById('qmod-filter-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'qmod-filter-bar';
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
    inner.prepend(bar);
  }
  bar.innerHTML = `
    <button onclick="window._qmodFilter('pending')"
      style="flex:1;padding:9px;border-radius:10px;border:1px solid ${_filter==='pending'?'var(--accent)':'var(--border)'};background:${_filter==='pending'?'rgba(108,99,255,.12)':'var(--bg2)'};color:${_filter==='pending'?'var(--accent2)':'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      🗂 На сортировку
    </button>
    <button onclick="window._qmodFilter('active')"
      style="flex:1;padding:9px;border-radius:10px;border:1px solid ${_filter==='active'?'#4ade80':'var(--border)'};background:${_filter==='active'?'rgba(74,222,128,.12)':'var(--bg2)'};color:${_filter==='active'?'#4ade80':'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      ✅ Одобренные
    </button>`;
}

async function _loadPage(inner, reset = false) {
  let data, error;

  if (_filter === 'active') {
    const res = await sb.from('questions')
      .select('id, question_text, question_ru, answers_json, correct_index, status, category, source_type, approved_at')
      .eq('status', 'active')
      .order('approved_at', { ascending: false, nullsFirst: false })
      .range(_offset, _offset + PAGE - 1);
    data = res.data; error = res.error;
  } else {
    // Читаем из кеша (OR-фильтр ломается через Vercel прокси)
    if (!_pendingCache) _pendingCache = await _fetchPendingAll();
    data = _pendingCache.slice(_offset, _offset + PAGE);
    error = null;
  }

  if (error) {
    inner.innerHTML += `<div style="color:var(--red);padding:12px">Ошибка: ${error.message}</div>`;
    return;
  }

  if (reset) {
    document.getElementById('qmod-loading')?.remove();
    document.getElementById('qmod-list')?.remove();
    document.getElementById('qmod-load-more')?.remove();
  }

  let list = document.getElementById('qmod-list');
  if (!list) {
    list = document.createElement('div');
    list.id = 'qmod-list';
    list.style.cssText = 'display:flex;flex-direction:column;gap:10px';
    inner.appendChild(list);
  }

  (data || []).forEach(q => list.appendChild(_buildCard(q)));

  document.getElementById('qmod-load-more')?.remove();
  if (_offset + PAGE < _total) {
    const remaining = _total - _offset - PAGE;
    const wrap = document.createElement('div');
    wrap.id = 'qmod-load-more';
    wrap.style.cssText = 'display:flex;gap:8px;margin-top:8px';

    const moreBtn = document.createElement('button');
    moreBtn.textContent = `Ещё ${Math.min(PAGE, remaining)} вопросов`;
    moreBtn.style.cssText = 'flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit';
    moreBtn.onclick = () => { _offset += PAGE; _loadPage(inner); };

    const allBtn = document.createElement('button');
    allBtn.textContent = `Показать все (${_total})`;
    allBtn.style.cssText = 'flex:1;background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.4);border-radius:12px;padding:12px;font-size:13px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit';
    allBtn.onclick = async () => {
      wrap.remove();
      const loadingAll = document.createElement('div');
      loadingAll.style.cssText = 'text-align:center;padding:12px;color:var(--muted);font-size:13px';
      loadingAll.textContent = 'Загрузка всех вопросов...';
      inner.appendChild(loadingAll);

      let allRows, allErr;
      if (_filter === 'active') {
        const res = await sb.from('questions')
          .select('id, question_text, question_ru, answers_json, correct_index, status, category, source_type, approved_at')
          .eq('status', 'active')
          .order('approved_at', { ascending: false, nullsFirst: false })
          .range(0, (_total || 2000) - 1);
        allRows = res.data; allErr = res.error;
      } else {
        if (!_pendingCache) _pendingCache = await _fetchPendingAll();
        allRows = _pendingCache; allErr = null;
      }

      loadingAll.remove();
      if (allErr) { inner.insertAdjacentHTML('beforeend', `<div style="color:red;padding:12px;font-size:13px">Ошибка загрузки: ${allErr.message}</div>`); return; }

      // Удаляем старый список и создаём новый (надёжнее, чем innerHTML)
      inner.querySelector('#qmod-list')?.remove();
      const newList = document.createElement('div');
      newList.id = 'qmod-list';
      newList.style.cssText = 'display:flex;flex-direction:column;gap:10px';
      (allRows || []).forEach(q => {
        try { newList.appendChild(_buildCard(q)); } catch(e) { console.error('qmod card error', q?.id, e); }
      });
      inner.appendChild(newList);
      _offset = _total;
      newList.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.toast?.(`Загружено ${(allRows||[]).length} вопросов`);
    };

    wrap.appendChild(moreBtn);
    wrap.appendChild(allBtn);
    inner.appendChild(wrap);
  }
}

function _buildCard(q) {
  const card = document.createElement('div');
  card.id = `qcard-${q.id}`;
  card.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:14px;position:relative';

  const text = q.question_ru || q.question_text || '';
  const isApproved = q.status === 'active';

  const answers = (q.answers_json || []).map((ans, i) => {
    const correct = i === q.correct_index;
    return `<div style="display:flex;align-items:center;gap:6px;margin-top:5px">
      <span style="width:18px;height:18px;border-radius:50%;background:${correct?'rgba(74,222,128,.2)':'rgba(255,255,255,.06)'};border:1px solid ${correct?'rgba(74,222,128,.5)':'var(--border)'};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:${correct?'#4ade80':'var(--muted)'};flex-shrink:0">${correct?'✓':String.fromCharCode(65+i)}</span>
      <span style="font-size:12px;color:${correct?'#4ade80':'var(--muted)'}">${_esc(ans)}</span>
    </div>`;
  }).join('');

  const statusBadge = isApproved
    ? `<span style="font-size:10px;background:rgba(74,222,128,.15);color:#4ade80;border-radius:6px;padding:2px 7px;font-weight:700;margin-left:6px">✅ одобрен</span>`
    : '';

  const editBtn = `<button onclick="window._qmodEdit('${q.id}')"
    style="padding:10px;border-radius:10px;border:1px solid rgba(108,99,255,.4);background:rgba(108,99,255,.1);color:var(--accent2);font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
    ✏️ Редактировать
  </button>`;

  const actionButtons = isApproved
    ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <button onclick="window._qmodUnapprove('${q.id}')"
          style="padding:10px;border-radius:10px;border:1px solid rgba(240,192,64,.4);background:rgba(240,192,64,.1);color:var(--gold);font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
          ↩ Отменить
        </button>
        <button onclick="window._qmodDelete('${q.id}')"
          style="padding:10px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:#f87171;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
          🗑 Удалить
        </button>
      </div>${editBtn}`
    : `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
        <button onclick="window._qmodApprove('${q.id}')"
          style="padding:10px;border-radius:10px;border:1px solid rgba(74,222,128,.4);background:rgba(74,222,128,.1);color:#4ade80;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
          ✅ Подходит
        </button>
        <button onclick="window._qmodDelete('${q.id}')"
          style="padding:10px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:#f87171;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
          ❌ Не подходит
        </button>
      </div>${editBtn}`;

  card.innerHTML = `
    <div id="qcard-view-${q.id}">
      <div style="font-size:13px;font-weight:800;line-height:1.4;margin-bottom:8px;padding-right:24px">
        ${_esc(text)}${statusBadge}
      </div>
      <div style="margin-bottom:12px">${answers}</div>
      ${q.category ? `<div style="font-size:10px;color:var(--muted);margin-bottom:10px">📂 ${_esc(q.category)}${q.source_type?' · '+_esc(q.source_type):''}</div>` : ''}
      ${actionButtons}
    </div>`;

  card._qdata = q;
  return card;
}

window._qmodFilter = async function(f) {
  _filter = f;
  const inner = document.getElementById('qmod-inner');
  if (inner) await loadQModeration();
};

function _afterCardRemove(id) {
  const card = document.getElementById(`qcard-${id}`);
  if (card) card.remove();
  _total = Math.max(0, _total - 1);
  // Удалить из кеша pending, чтобы пагинация не сдвигалась
  if (_pendingCache) _pendingCache = _pendingCache.filter(q => q.id !== id);
  _updateCounter();
  // Если список опустел — перезагрузить следующую порцию
  const list = document.getElementById('qmod-list');
  if (list && list.children.length === 0 && _total > 0) {
    const inner = document.getElementById('qmod-inner');
    if (inner) _loadPage(inner, true);
  }
}

window._qmodApprove = async function(id) {
  const { data, error } = await sb.rpc('admin_approve_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  _afterCardRemove(id);
};

window._qmodUnapprove = async function(id) {
  const { data, error } = await sb.rpc('admin_unapprove_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  _afterCardRemove(id);
};

window._qmodDelete = async function(id) {
  const { data, error } = await sb.rpc('admin_delete_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  _afterCardRemove(id);
};

window._qmodEdit = function(id) {
  const card = document.getElementById(`qcard-${id}`);
  if (!card) return;
  const q = card._qdata;
  if (!q) return;

  const view = document.getElementById(`qcard-view-${id}`);
  if (!view) return;

  const text = q.question_ru || q.question_text || '';
  const answers = q.answers_json || [];

  const answerInputs = answers.map((ans, i) => `
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <button type="button" onclick="window._qmodSetCorrect('${id}',${i})"
        id="qcorr-${id}-${i}"
        style="width:20px;height:20px;border-radius:50%;flex-shrink:0;border:1px solid ${i===q.correct_index?'rgba(74,222,128,.6)':'var(--border)'};background:${i===q.correct_index?'rgba(74,222,128,.2)':'rgba(255,255,255,.06)'};cursor:pointer;font-size:9px;color:${i===q.correct_index?'#4ade80':'var(--muted)'}">
        ${i===q.correct_index?'✓':String.fromCharCode(65+i)}
      </button>
      <input id="qans-${id}-${i}" value="${_esc(ans)}"
        style="flex:1;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:6px 10px;font-size:12px;color:var(--text);font-family:inherit">
    </div>`).join('');

  view.innerHTML = `
    <div style="margin-bottom:10px">
      <label style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px">ВОПРОС</label>
      <textarea id="qtext-${id}" rows="3"
        style="width:100%;margin-top:4px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;font-weight:700;color:var(--text);font-family:inherit;resize:vertical;box-sizing:border-box">${_esc(text)}</textarea>
    </div>
    <div style="margin-bottom:12px">
      <label style="font-size:10px;color:var(--muted);font-weight:700;letter-spacing:1px">ВАРИАНТЫ (нажми кружок — правильный)</label>
      <div id="qans-list-${id}" style="margin-top:6px">${answerInputs}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button onclick="window._qmodSaveEdit('${id}')"
        style="padding:10px;border-radius:10px;border:1px solid rgba(108,99,255,.5);background:rgba(108,99,255,.15);color:var(--accent2);font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
        💾 Сохранить
      </button>
      <button onclick="window._qmodCancelEdit('${id}')"
        style="padding:10px;border-radius:10px;border:1px solid var(--border);background:var(--bg2);color:var(--muted);font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
        Отмена
      </button>
    </div>`;
  view._editCorrect = q.correct_index;
};

window._qmodSetCorrect = function(id, idx) {
  const card = document.getElementById(`qcard-${id}`);
  if (!card) return;
  const q = card._qdata;
  const view = document.getElementById(`qcard-view-${id}`);
  view._editCorrect = idx;
  (q.answers_json || []).forEach((_, i) => {
    const btn = document.getElementById(`qcorr-${id}-${i}`);
    if (!btn) return;
    const active = i === idx;
    btn.style.border = `1px solid ${active?'rgba(74,222,128,.6)':'var(--border)'}`;
    btn.style.background = active ? 'rgba(74,222,128,.2)' : 'rgba(255,255,255,.06)';
    btn.style.color = active ? '#4ade80' : 'var(--muted)';
    btn.textContent = active ? '✓' : String.fromCharCode(65+i);
  });
};

window._qmodSaveEdit = async function(id) {
  const card = document.getElementById(`qcard-${id}`);
  if (!card) return;
  const q = card._qdata;
  const view = document.getElementById(`qcard-view-${id}`);

  const newText = document.getElementById(`qtext-${id}`)?.value?.trim();
  if (!newText) { window.toast?.('Введите текст вопроса'); return; }

  const newAnswers = (q.answers_json || []).map((_, i) =>
    document.getElementById(`qans-${id}-${i}`)?.value?.trim() || ''
  );
  const newCorrect = view._editCorrect ?? q.correct_index;

  const { data, error } = await sb.rpc('admin_update_question', {
    p_id: id,
    p_text: newText,
    p_answers: newAnswers,
    p_correct: newCorrect,
  });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }

  q.question_ru = newText;
  q.question_text = newText;
  q.answers_json = newAnswers;
  q.correct_index = newCorrect;
  card._qdata = q;
  _rebuildCardView(card, q);
  window.toast?.('Сохранено ✓');
};

window._qmodCancelEdit = function(id) {
  const card = document.getElementById(`qcard-${id}`);
  if (!card) return;
  _rebuildCardView(card, card._qdata);
};

function _rebuildCardView(card, q) {
  const tmpCard = _buildCard(q);
  const newView = tmpCard.querySelector(`[id^="qcard-view-"]`);
  const oldView = card.querySelector(`[id^="qcard-view-"]`);
  if (oldView && newView) {
    card.replaceChild(newView, oldView);
    card._qdata = q;
  }
}

function _updateCounter() {
  const el = document.getElementById('qmod-counter');
  if (el) el.textContent = `${_total} вопросов`;
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window._qmodImportFile = async function(input) {
  const file = input.files?.[0];
  if (!file) return;
  input.value = '';

  let questions;
  try {
    questions = JSON.parse(await file.text());
  } catch {
    window.toast?.('Ошибка: невалидный JSON');
    return;
  }
  if (!Array.isArray(questions) || !questions.length) {
    window.toast?.('Файл пустой или не массив');
    return;
  }

  window.toast?.(`Загружаю ${questions.length} вопросов...`);
  const { data, error } = await sb.rpc('admin_import_questions', { p_questions: questions });
  if (error || !data?.ok) {
    window.toast?.('Ошибка: ' + (error?.message || data?.reason));
    return;
  }
  window.toast?.(`✅ Загружено ${data.imported} вопросов → На сортировку`);
  if (_filter === 'pending') loadQModeration();
};

window.loadQModeration = loadQModeration;
