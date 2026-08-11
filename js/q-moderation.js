// ── Question Moderation ───────────────────────────────────────────
import { sb } from './services/supabase.js';

const PAGE = 20;
let _offset = 0;
let _total  = 0;
let _filter = 'pending'; // 'pending' | 'active'

export async function loadQModeration() {
  const inner = document.getElementById('qmod-inner');
  if (!inner) return;

  _offset = 0;
  inner.innerHTML = `<div id="qmod-loading" style="text-align:center;padding:40px;color:var(--muted)">Загрузка...</div>`;

  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true });
  if (_filter === 'active') countQuery = countQuery.eq('status', 'active');
  else countQuery = countQuery.or('status.is.null,status.eq.published').neq('status', 'deleted');
  const { count } = await countQuery;

  _total = count || 0;
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
  let query = sb.from('questions')
    .select('id, question_text, question_ru, answers_json, correct_index, status, category, source_type, approved_at')
    .order(_filter === 'active' ? 'approved_at' : 'id', { ascending: false, nullsFirst: false })
    .range(_offset, _offset + PAGE - 1);

  if (_filter === 'active') {
    query = query.eq('status', 'active');
  } else {
    query = query.or('status.is.null,status.eq.published').neq('status', 'deleted');
  }

  const { data, error } = await query;
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
      let fetchOffset = _offset + PAGE;
      while (fetchOffset < _total) {
        let q2 = sb.from('questions')
          .select('id, question_text, question_ru, answers_json, correct_index, status, category, source_type, approved_at')
          .order(_filter === 'active' ? 'approved_at' : 'id', { ascending: false, nullsFirst: false })
          .range(fetchOffset, fetchOffset + PAGE - 1);
        if (_filter === 'active') q2 = q2.eq('status', 'active');
        else q2 = q2.neq('status', 'active').neq('status', 'deleted');
        const { data: d2 } = await q2;
        (d2 || []).forEach(q => list.appendChild(_buildCard(q)));
        fetchOffset += PAGE;
        _offset = fetchOffset - PAGE;
      }
      loadingAll.remove();
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

window._qmodApprove = async function(id) {
  const { data, error } = await sb.rpc('admin_approve_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  const card = document.getElementById(`qcard-${id}`);
  if (card) card.remove();
  _total = Math.max(0, _total - 1);
  _updateCounter();
};

window._qmodUnapprove = async function(id) {
  const { data, error } = await sb.rpc('admin_unapprove_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  const card = document.getElementById(`qcard-${id}`);
  if (card) card.remove();
  _total = Math.max(0, _total - 1);
  _updateCounter();
};

window._qmodDelete = async function(id) {
  const { data, error } = await sb.rpc('admin_delete_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }
  const card = document.getElementById(`qcard-${id}`);
  if (card) card.remove();
  _total = Math.max(0, _total - 1);
  _updateCounter();
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
