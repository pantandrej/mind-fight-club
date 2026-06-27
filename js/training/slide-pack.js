// ── Slide Pack Player ─────────────────────────────────────────
import { sb }         from '../services/supabase.js';
import { getState }   from '../state.js';
import { track }      from '../services/analytics.js';

let _pack       = null;
let _qIdx       = 0;
let _score      = 0;
let _correct    = 0;
let _answered   = false;
let _paused     = false;
let _timeLeft   = 20;
let _timer      = null;
let _history    = []; // {q, picked, correct} for review
const MAX_TIME  = 20;

export async function loadPack(packId) {
  try {
    const res = await fetch(`/packs/${packId}/pack.json`);
    _pack = await res.json();
    return _pack;
  } catch(e) {
    console.error('[slide-pack] load error', e);
    return null;
  }
}

export function startSlidePack(pack) {
  _pack     = pack;
  _qIdx     = 0;
  _score    = 0;
  _correct  = 0;
  _answered = false;
  _paused   = false;
  _history  = [];

  document.getElementById('slide-pack-screen').style.display = 'flex';
  document.getElementById('sp-game').style.display   = 'flex';
  document.getElementById('sp-result').style.display = 'none';
  document.getElementById('sp-review').style.display = 'none';
  renderQuestion();
  track('slide_pack_started', { pack_id: pack.id });
}

function renderQuestion() {
  const q = _pack.questions[_qIdx];
  if (!q) { endPack(); return; }

  _answered = false;
  _paused   = false;
  stopTimer();

  document.getElementById('sp-q-num').textContent = `${_qIdx + 1} / ${_pack.questions.length}`;
  document.getElementById('sp-score').textContent  = _score;

  const pauseBtn = document.getElementById('sp-pause-btn');
  if (pauseBtn) pauseBtn.textContent = '⏸';

  const img = document.getElementById('sp-img');
  img.src   = q.img;

  document.getElementById('sp-q-text').textContent = q.q;
  document.getElementById('sp-feedback').textContent = '';
  document.getElementById('sp-feedback').className   = 'sp-feedback';

  // Answer buttons — center last one when count is odd
  const grid = document.getElementById('sp-answers-grid');
  const n = q.a.length;
  grid.style.gridTemplateColumns = n <= 2 ? 'repeat(2,1fr)' : 'repeat(2,1fr)';
  grid.innerHTML = q.a.map((ans, i) => {
    const center = (n % 2 === 1 && i === n - 1) ? ' style="grid-column:1/-1;max-width:50%;margin:0 auto;width:100%"' : '';
    return `<button class="sp-ans-btn" data-i="${i}" onclick="spPick(${i})"${center}>${ans}</button>`;
  }).join('');

  _timeLeft = MAX_TIME;
  updateTimerBar();
  startTimer();
  renderDots();
}

function startTimer() {
  _timer = setInterval(() => {
    if (_paused) return;
    _timeLeft--;
    updateTimerBar();
    if (_timeLeft <= 0) {
      clearInterval(_timer);
      if (!_answered) spPick(-1);
    }
  }, 1000);
}

function stopTimer() {
  clearInterval(_timer);
  _timer = null;
}

function updateTimerBar() {
  const bar = document.getElementById('sp-timer-bar');
  if (bar) bar.style.width = (_timeLeft / MAX_TIME * 100) + '%';
}

window.spPick = function(i) {
  if (_answered || _paused) return;
  _answered = true;
  stopTimer();

  const q   = _pack.questions[_qIdx];
  const win = i === q.c;
  const pts = win ? Math.max(1, Math.round(30 * _timeLeft / MAX_TIME)) : 0;

  if (win) { _score += pts; _correct++; }
  _history.push({ q, picked: i, correct: q.c, pts });

  document.querySelectorAll('.sp-ans-btn').forEach((btn, idx) => {
    if (idx === q.c)  btn.classList.add('sp-correct');
    else if (idx === i) btn.classList.add('sp-wrong');
    btn.disabled = true;
  });

  const fb = document.getElementById('sp-feedback');
  fb.textContent = win ? `✓ +${pts}` : `✗ ${q.a[q.c]}`;
  fb.className   = 'sp-feedback ' + (win ? 'sp-fb-win' : 'sp-fb-lose');

  document.getElementById('sp-score').textContent = _score;
  renderDots();

  setTimeout(() => {
    _qIdx++;
    if (_qIdx < _pack.questions.length) renderQuestion();
    else endPack();
  }, 1800);
};

window.spTogglePause = function() {
  if (_answered) return;
  _paused = !_paused;
  const btn = document.getElementById('sp-pause-btn');
  if (btn) btn.textContent = _paused ? '▶' : '⏸';
};

function renderDots() {
  const el = document.getElementById('sp-dots');
  if (!el) return;
  el.innerHTML = _pack.questions.map((_, i) => {
    const h = _history[i];
    const cls = i < _qIdx
      ? ('sp-dot done' + (h && h.picked === h.correct ? '' : ' wrong'))
      : i === _qIdx ? 'sp-dot active' : 'sp-dot';
    return `<div class="${cls}"></div>`;
  }).join('');
}

function endPack() {
  stopTimer();
  track('slide_pack_completed', { pack_id: _pack.id, score: _score, correct: _correct });

  document.getElementById('sp-game').style.display   = 'none';
  document.getElementById('sp-result').style.display = 'flex';

  const pct = Math.round(_correct / _pack.questions.length * 100);
  document.getElementById('sp-res-icon').textContent    = pct >= 80 ? '🏆' : pct >= 50 ? '🎯' : '📚';
  document.getElementById('sp-res-score').textContent   = _score;
  document.getElementById('sp-res-correct').textContent = `${_correct} / ${_pack.questions.length}`;
  document.getElementById('sp-res-pct').textContent     = pct + '%';

  if (_score > 0 && window.awardNeurons) {
    window.awardNeurons(_score, 'quiz_reward', `pack:${_pack.id}:${Date.now()}`);
  }
}

window.spShowReview = function() {
  document.getElementById('sp-result').style.display = 'none';
  const rev = document.getElementById('sp-review');
  rev.style.display = 'flex';

  const list = document.getElementById('sp-review-list');
  list.innerHTML = _history.map((h, i) => {
    const ok = h.picked === h.correct;
    return `<div class="sp-rev-item ${ok ? 'sp-rev-ok' : 'sp-rev-wrong'}">
      <div class="sp-rev-num">${i+1}</div>
      <div class="sp-rev-body">
        <div class="sp-rev-q">${h.q.q || ''}</div>
        <div class="sp-rev-ans">${ok ? '✓' : '✗'} ${h.q.a[h.correct]}${!ok && h.picked >= 0 ? ` <span class="sp-rev-yours">(ты: ${h.q.a[h.picked]})</span>` : ''}</div>
      </div>
    </div>`;
  }).join('');
};

window.spRestart = function() {
  startSlidePack(_pack);
};

window.spClose = function() {
  stopTimer();
  document.getElementById('slide-pack-screen').style.display = 'none';
  if (window.showScreen) window.showScreen('home');
};

window.startSlidePack = startSlidePack;
window.loadPack       = loadPack;
