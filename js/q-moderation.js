// ── Question Moderation ───────────────────────────────────────────
import { sb } from './services/supabase.js';

const PAGE = 20;
let _offset = 0;
let _total  = 0;
let _filter = 'all'; // 'active' | 'all'

export async function loadQModeration() {
  const inner = document.getElementById('qmod-inner');
  if (!inner) return;

  _offset = 0;
  inner.innerHTML = `<div id="qmod-loading" style="text-align:center;padding:40px;color:var(--muted)">Загрузка...</div>`;

  let countQuery = sb.from('questions').select('id', { count: 'exact', head: true });
  if (_filter === 'active') countQuery = countQuery.eq('status', 'active');
  else countQuery = countQuery.neq('status', 'deleted');
  const { count } = await countQuery;

  _total = count || 0;
  _renderFilter(inner);
  await _loadPage(inner, true);
}

function _renderFilter(inner) {
  const counter = document.getElementById('qmod-counter');
  if (counter) counter.textContent = `${_total} вопросов`;

  // filter bar at top
  let bar = document.getElementById('qmod-filter-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'qmod-filter-bar';
    bar.style.cssText = 'display:flex;gap:8px;margin-bottom:14px';
    inner.prepend(bar);
  }
  bar.innerHTML = `
    <button onclick="window._qmodFilter('active')"
      style="flex:1;padding:9px;border-radius:10px;border:1px solid ${_filter==='active'?'var(--gold)':'var(--border)'};background:${_filter==='active'?'rgba(240,192,64,.12)':'var(--bg2)'};color:${_filter==='active'?'var(--gold)':'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      Активные
    </button>
    <button onclick="window._qmodFilter('all')"
      style="flex:1;padding:9px;border-radius:10px;border:1px solid ${_filter==='all'?'var(--accent)':'var(--border)'};background:${_filter==='all'?'rgba(108,99,255,.12)':'var(--bg2)'};color:${_filter==='all'?'var(--accent2)':'var(--muted)'};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
      Все (кроме удалённых)
    </button>`;
}

async function _loadPage(inner, reset = false) {
  let query = sb.from('questions')
    .select('id, question_text, question_ru, answers_json, correct_index, status, category, source_type')
    .order('id')
    .range(_offset, _offset + PAGE - 1);

  if (_filter === 'active') {
    query = query.eq('status', 'active');
  } else {
    query = query.neq('status', 'deleted');
  }

  const { data, error } = await query;
  if (error) {
    inner.innerHTML += `<div style="color:var(--red);padding:12px">Ошибка: ${error.message}</div>`;
    return;
  }

  // Remove loading text and old list if reset
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

  // Load more button
  document.getElementById('qmod-load-more')?.remove();
  if (_offset + PAGE < _total) {
    const btn = document.createElement('button');
    btn.id = 'qmod-load-more';
    btn.textContent = `Ещё ${Math.min(PAGE, _total - _offset - PAGE)} вопросов`;
    btn.style.cssText = 'width:100%;margin-top:8px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit';
    btn.onclick = () => { _offset += PAGE; _loadPage(inner); };
    inner.appendChild(btn);
  }
}

function _buildCard(q) {
  const card = document.createElement('div');
  card.id = `qcard-${q.id}`;
  card.style.cssText = 'background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:14px;position:relative';

  const text = q.question_ru || q.question_text || '';
  const answers = (q.answers_json || []).map((ans, i) => {
    const correct = i === q.correct_index;
    return `<div style="display:flex;align-items:center;gap:6px;margin-top:5px">
      <span style="width:18px;height:18px;border-radius:50%;background:${correct?'rgba(74,222,128,.2)':'rgba(255,255,255,.06)'};border:1px solid ${correct?'rgba(74,222,128,.5)':'var(--border)'};display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:900;color:${correct?'#4ade80':'var(--muted)'};flex-shrink:0">${correct?'✓':String.fromCharCode(65+i)}</span>
      <span style="font-size:12px;color:${correct?'#4ade80':'var(--muted)'}">${_esc(ans)}</span>
    </div>`;
  }).join('');

  const statusBadge = q.status !== 'active'
    ? `<span style="font-size:10px;background:rgba(248,113,113,.15);color:#f87171;border-radius:6px;padding:2px 7px;font-weight:700;margin-left:6px">${q.status}</span>`
    : '';

  card.innerHTML = `
    <div style="font-size:13px;font-weight:800;line-height:1.4;margin-bottom:8px;padding-right:24px">
      ${_esc(text)}${statusBadge}
    </div>
    <div style="margin-bottom:12px">${answers}</div>
    ${q.category ? `<div style="font-size:10px;color:var(--muted);margin-bottom:10px">📂 ${_esc(q.category)}${q.source_type?' · '+_esc(q.source_type):''}</div>` : ''}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button onclick="window._qmodApprove('${q.id}')"
        style="padding:10px;border-radius:10px;border:1px solid rgba(74,222,128,.4);background:rgba(74,222,128,.1);color:#4ade80;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
        ✅ Подходит
      </button>
      <button onclick="window._qmodDelete('${q.id}')"
        style="padding:10px;border-radius:10px;border:1px solid rgba(248,113,113,.4);background:rgba(248,113,113,.1);color:#f87171;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">
        🗑 Удалить
      </button>
    </div>`;

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

window._qmodDelete = async function(id) {
  const { data, error } = await sb.rpc('admin_delete_question', { p_id: id });
  if (error || !data?.ok) { window.toast?.('Ошибка: ' + (error?.message || data?.reason)); return; }

  const card = document.getElementById(`qcard-${id}`);
  if (card) card.remove();
  _total = Math.max(0, _total - 1);
  _updateCounter();
};

function _updateCounter() {
  const el = document.getElementById('qmod-counter');
  if (el) el.textContent = `${_total} вопросов`;
}

function _esc(s) {
  return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

window.loadQModeration = loadQModeration;
