// ── Organizer Analytics ───────────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';
import { track } from './services/analytics.js';

// ── Load analytics for organizer cabinet ─────────────────────────
export async function loadOrgAnalytics() {
  const { currentUser } = getState();
  if (!currentUser) return;

  // KPI: sold passes + unique buyers + total neurons spent
  const { data: passes } = await sb
    .from('quiz_passes')
    .select('id, price_neurons, used, used_by, created_at')
    .eq('organizer_id', currentUser.id);

  if (!passes) return;

  const sold     = passes.filter(p => p.used).length;
  const total    = passes.length;
  const revenue  = passes.filter(p => p.used).reduce((s, p) => s + (p.price_neurons || 0), 0);
  const buyers   = new Set(passes.filter(p => p.used_by).map(p => p.used_by)).size;

  const setEl = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  setEl('org-stat-sold',    sold);
  setEl('org-stat-players', buyers);
  setEl('org-stat-revenue', revenue);

  _renderFunnel(total, sold, buyers);

  // Heatmap: fetch last tournament questions with accuracy
  const { data: tournaments } = await sb
    .from('tournaments')
    .select('id, title, questions, participants')
    .eq('host_id', currentUser.id)
    .eq('status', 'finished')
    .order('created_at', { ascending: false })
    .limit(1);

  if (tournaments?.[0]) _renderHeatmap(tournaments[0]);
}

function _renderFunnel(total, sold, buyers) {
  const wrap = document.getElementById('org-funnel');
  if (!wrap) return;

  const steps = [
    { label: 'Проходок создано',  val: total,  color: 'var(--accent2)' },
    { label: 'Куплено',           val: sold,   color: 'var(--gold)' },
    { label: 'Уникальных игроков',val: buyers, color: '#4ade80' },
  ];
  const max = Math.max(total, 1);

  wrap.innerHTML = steps.map(s => `
    <div style="display:flex;align-items:center;gap:8px">
      <div style="width:90px;font-size:10px;color:var(--muted);flex-shrink:0">${s.label}</div>
      <div style="flex:1;background:rgba(255,255,255,.05);border-radius:4px;height:18px;overflow:hidden">
        <div style="width:${Math.round(s.val/max*100)}%;background:${s.color};height:100%;border-radius:4px;transition:width .6s ease"></div>
      </div>
      <div style="width:28px;font-size:12px;font-weight:800;color:${s.color};text-align:right;flex-shrink:0">${s.val}</div>
    </div>`).join('');
}

function _renderHeatmap(tournament) {
  const wrap = document.getElementById('org-heatmap');
  if (!wrap) return;

  const qs           = tournament.questions || [];
  const participants = tournament.participants || {};
  const playerCount  = Object.keys(participants).length;

  if (!qs.length || !playerCount) {
    wrap.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center">Нет данных по вопросам</div>';
    return;
  }

  wrap.innerHTML = qs.map((q, idx) => {
    // Count how many players answered this question correctly
    let correct = 0;
    Object.values(participants).forEach(p => {
      if (p.answers?.[idx] === true) correct++;
    });
    const pct = playerCount > 0 ? Math.round(correct / playerCount * 100) : 0;
    const color = pct >= 70 ? '#4ade80' : pct >= 40 ? '#facc15' : '#f87171';
    const label = pct >= 70 ? 'лёгкий' : pct >= 40 ? 'средний' : 'сложный';
    const qText = typeof q.q === 'object' ? (q.q.ru || q.q.en || '') : (q.q || '');

    return `
      <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid rgba(255,255,255,.05)">
        <div style="width:22px;height:22px;border-radius:6px;background:${color}22;border:0.5px solid ${color}55;display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;color:${color};flex-shrink:0">${idx+1}</div>
        <div style="flex:1;font-size:11px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${_esc(qText)}</div>
        <div style="font-size:11px;font-weight:800;color:${color};flex-shrink:0">${pct}%</div>
        <div style="font-size:9px;color:var(--muted);flex-shrink:0;width:38px">${label}</div>
      </div>`;
  }).join('');
}

// ── CSV Export ────────────────────────────────────────────────────
export async function exportOrgCSV() {
  const { currentUser } = getState();
  if (!currentUser) return;

  const { data: passes } = await sb
    .from('quiz_passes')
    .select(`
      id, title, event_date, city, price_neurons, used, used_at,
      buyer:used_by(display_name, city, xp, neurons)
    `)
    .eq('organizer_id', currentUser.id)
    .eq('used', true)
    .order('used_at', { ascending: false });

  if (!passes?.length) { window.toast?.('Нет данных для экспорта'); return; }

  const rows = [
    ['Квиз', 'Дата события', 'Город', 'Цена (нейроны)', 'Игрок', 'Город игрока', 'XP игрока', 'Нейроны игрока', 'Дата покупки'],
    ...passes.map(p => [
      p.title || '',
      p.event_date || '',
      p.city || '',
      p.price_neurons || '',
      p.buyer?.display_name || '',
      p.buyer?.city || '',
      p.buyer?.xp || '',
      p.buyer?.neurons || '',
      p.used_at ? new Date(p.used_at).toLocaleDateString('ru') : '',
    ]),
  ];

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bfc-organizer-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  track('org_csv_exported', { count: passes.length });
}

function _esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

window.loadOrgAnalytics = loadOrgAnalytics;
window.exportOrgCSV     = exportOrgCSV;
