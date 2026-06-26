// ── Slide Pack Player ─────────────────────────────────────────
// Plays image-based question packs (from PPTX exports)
// Each question shows a slide image + clickable answer buttons below

import { sb }         from '../services/supabase.js';
import { getState }   from '../state.js';
import { track }      from '../services/analytics.js';

let _pack       = null;
let _qIdx       = 0;
let _score      = 0;
let _correct    = 0;
let _answered   = false;
let _timeLeft   = 20;
let _timer      = null;
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

  const screen = document.getElementById('slide-pack-screen');
  if (screen) screen.style.display = 'flex';
  document.getElementById('slide-pack-total').textContent = pack.questions.length;
  renderQuestion();
  track('slide_pack_started', { pack_id: pack.id });
}

function renderQuestion() {
  const q = _pack.questions[_qIdx];
  if (!q) { endPack(); return; }

  _answered = false;
  stopTimer();

  // Header
  document.getElementById('sp-q-num').textContent    = `${_qIdx + 1} / ${_pack.questions.length}`;
  document.getElementById('sp-score').textContent     = _score;

  // Image
  const img = document.getElementById('sp-img');
  img.src   = q.img;
  img.style.display = 'block';

  // Question text (below image)
  document.getElementById('sp-q-text').textContent = q.q;

  // Answer buttons
  const grid = document.getElementById('sp-answers-grid');
  const cols = q.a.length <= 2 ? 2 : q.a.length <= 4 ? 2 : 3;
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.innerHTML = q.a.map((ans, i) =>
    `<button class="sp-ans-btn" data-i="${i}" onclick="spPick(${i})">${ans}</button>`
  ).join('');

  // Timer bar
  _timeLeft = MAX_TIME;
  updateTimerBar();
  startTimer();

  // Progress dots
  renderDots();
}

function startTimer() {
  _timer = setInterval(() => {
    _timeLeft--;
    updateTimerBar();
    if (_timeLeft <= 0) {
      clearInterval(_timer);
      if (!_answered) spPick(-1); // time out
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
  const label = document.getElementById('sp-timer-label');
  if (label) label.textContent = _timeLeft + 's';
}

window.spPick = function(i) {
  if (_answered) return;
  _answered = true;
  stopTimer();

  const q   = _pack.questions[_qIdx];
  const win = i === q.c;
  const pts = win ? Math.max(1, Math.round(30 * _timeLeft / MAX_TIME)) : 0;

  if (win) { _score += pts; _correct++; }

  // Highlight buttons
  document.querySelectorAll('.sp-ans-btn').forEach((btn, idx) => {
    if (idx === q.c)  btn.classList.add('sp-correct');
    else if (idx === i) btn.classList.add('sp-wrong');
    btn.disabled = true;
  });

  // Feedback
  const fb = document.getElementById('sp-feedback');
  if (fb) {
    fb.textContent = win ? `✓ +${pts}` : `✗ ${q.a[q.c]}`;
    fb.className   = 'sp-feedback ' + (win ? 'sp-fb-win' : 'sp-fb-lose');
  }

  document.getElementById('sp-score').textContent = _score;
  renderDots();

  // Auto-advance after 1.8s
  setTimeout(() => {
    _qIdx++;
    if (_qIdx < _pack.questions.length) {
      renderQuestion();
    } else {
      endPack();
    }
  }, 1800);
};

function renderDots() {
  const el = document.getElementById('sp-dots');
  if (!el) return;
  el.innerHTML = _pack.questions.map((_, i) => {
    const cls = i < _qIdx ? 'sp-dot done' : i === _qIdx ? 'sp-dot active' : 'sp-dot';
    return `<div class="${cls}"></div>`;
  }).join('');
}

function endPack() {
  stopTimer();
  track('slide_pack_completed', { pack_id: _pack.id, score: _score, correct: _correct });

  // Show result screen
  document.getElementById('sp-game').style.display   = 'none';
  document.getElementById('sp-result').style.display = 'flex';

  const pct = Math.round(_correct / _pack.questions.length * 100);
  document.getElementById('sp-res-icon').textContent  = pct >= 80 ? '🏆' : pct >= 50 ? '🎯' : '📚';
  document.getElementById('sp-res-score').textContent = _score;
  document.getElementById('sp-res-correct').textContent = `${_correct} / ${_pack.questions.length}`;
  document.getElementById('sp-res-pct').textContent   = pct + '%';

  // Award neurons
  if (_score > 0 && window.awardNeurons) {
    window.awardNeurons(_score, 'quiz_reward', `pack:${_pack.id}:${Date.now()}`);
  }
}

window.spRestart = function() {
  startSlidePack(_pack);
  document.getElementById('sp-game').style.display   = 'flex';
  document.getElementById('sp-result').style.display = 'none';
};

window.spClose = function() {
  stopTimer();
  document.getElementById('slide-pack-screen').style.display = 'none';
  if (window.showScreen) window.showScreen('home');
};

window.startSlidePack = startSlidePack;
window.loadPack       = loadPack;
