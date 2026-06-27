// ── Slide Pack Player ─────────────────────────────────────────
import { sb }       from '../services/supabase.js';
import { getState } from '../state.js';
import { track }    from '../services/analytics.js';

let _pack       = null;
let _qIdx       = 0;
let _score      = 0;
let _correct    = 0;
let _answered   = false;
let _paused     = false;
let _showingAns = false;
let _timeLeft   = 20;
let _timer      = null;
let _history    = [];
let _mediaEl    = null;
let _ansTimer   = null;
const MAX_TIME  = 20;

function showRules(rulesImg) {
  const game = document.getElementById('sp-game');
  const wrap = document.getElementById('sp-rules-wrap');
  if (wrap) {
    wrap.style.display = 'flex';
    document.getElementById('sp-rules-img').src = rulesImg;
    return;
  }
  // Create rules overlay inside slide-pack-screen
  const screen = document.getElementById('slide-pack-screen');
  const div = document.createElement('div');
  div.id = 'sp-rules-wrap';
  div.style.cssText = 'flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:16px;gap:16px';
  div.innerHTML = `
    <img id="sp-rules-img" src="${rulesImg}" style="max-width:100%;max-height:70vh;border-radius:12px;object-fit:contain"/>
    <button class="big-btn" style="width:100%;max-width:340px" onclick="window._spStartGame()">Начать игру →</button>
  `;
  screen.appendChild(div);
  window._spStartGame = () => {
    div.style.display = 'none';
    document.getElementById('sp-game').style.display = 'flex';
    renderQuestion();
  };
}

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
  _pack       = pack;
  _qIdx       = 0;
  _score      = 0;
  _correct    = 0;
  _answered   = false;
  _paused     = false;
  _showingAns = false;
  _history    = [];
  stopMedia();

  document.getElementById('slide-pack-screen').style.display = 'flex';
  document.getElementById('sp-game').style.display   = 'none';
  document.getElementById('sp-result').style.display = 'none';
  document.getElementById('sp-review').style.display = 'none';

  if (pack.rules_img) {
    showRules(pack.rules_img);
  } else {
    document.getElementById('sp-game').style.display = 'flex';
    renderQuestion();
  }
  track('slide_pack_started', { pack_id: pack.id });
}

function renderQuestion() {
  const q = _pack.questions[_qIdx];
  if (!q) { endPack(); return; }

  _answered   = false;
  _paused     = false;
  _showingAns = false;
  stopTimer();
  stopMedia();
  clearInterval(_ansTimer); _ansTimer = null;

  document.getElementById('sp-q-num').textContent = `${_qIdx + 1} / ${_pack.questions.length}`;
  document.getElementById('sp-score').textContent  = _score;

  const pauseBtn = document.getElementById('sp-pause-btn');
  if (pauseBtn) pauseBtn.textContent = '⏸';

  // Show question image
  const img = document.getElementById('sp-img');
  img.src = q.img;

  document.getElementById('sp-q-text').textContent = q.q;
  document.getElementById('sp-feedback').textContent = '';
  document.getElementById('sp-feedback').className   = 'sp-feedback';

  // Media: audio or video before/during question
  const mediaWrap = document.getElementById('sp-media-wrap');
  mediaWrap.innerHTML = '';
  if (q.audio) {
    const audio = document.createElement('audio');
    audio.src = q.audio;
    audio.controls = true;
    audio.autoplay = true;
    audio.style.cssText = 'width:100%;max-width:340px;margin:4px auto;display:block';
    mediaWrap.appendChild(audio);
    _mediaEl = audio;
  } else if (q.video) {
    const video = document.createElement('video');
    video.src = q.video;
    video.controls = true;
    video.autoplay = true;
    video.muted = false;
    video.style.cssText = 'width:100%;max-width:400px;max-height:200px;border-radius:10px;margin:4px auto;display:block';
    mediaWrap.appendChild(video);
    _mediaEl = video;
  }

  // Answer buttons
  const grid = document.getElementById('sp-answers-grid');
  const n = q.a.length;
  grid.style.gridTemplateColumns = 'repeat(2,1fr)';
  grid.innerHTML = q.a.map((ans, i) => {
    const center = (n % 2 === 1 && i === n - 1)
      ? ' style="grid-column:1/-1;max-width:50%;margin:0 auto;width:100%"' : '';
    return `<button class="sp-ans-btn" data-i="${i}" onclick="spPick(${i})"${center}>${ans}</button>`;
  }).join('');

  _timeLeft = MAX_TIME;
  updateTimerBar();
  startTimer();
  renderDots();
}

function startTimer() {
  _timer = setInterval(() => {
    if (_paused || _showingAns) return;
    _timeLeft--;
    updateTimerBar();
    if (_timeLeft <= 0) {
      clearInterval(_timer);
      if (!_answered) spPick(-1);
    }
  }, 1000);
}

function stopTimer() { clearInterval(_timer); _timer = null; }

function stopMedia() {
  if (_mediaEl) { try { _mediaEl.pause(); } catch(_) {} _mediaEl = null; }
}

function updateTimerBar() {
  const bar = document.getElementById('sp-timer-bar');
  if (bar) bar.style.width = (_timeLeft / MAX_TIME * 100) + '%';
}

window.spPick = function(i) {
  if (_answered || _paused) return;
  _answered   = true;
  _showingAns = true;
  stopTimer();
  stopMedia();

  const q   = _pack.questions[_qIdx];
  const win = i === q.c;
  const pts = win ? Math.max(1, Math.round(30 * _timeLeft / MAX_TIME)) : 0;

  if (win) { _score += pts; _correct++; }
  _history.push({ q, picked: i, correct: q.c, pts });

  // Highlight answer buttons
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

  // Show answer slide after 0.8s, hold 15s (or user presses Далее)
  setTimeout(() => {
    if (q.ans_img) document.getElementById('sp-img').src = q.ans_img;

    // Show Далее button + countdown
    const fb = document.getElementById('sp-feedback');
    let left = 15;
    const advance = () => {
      clearInterval(_ansTimer);
      _qIdx++;
      if (_qIdx < _pack.questions.length) renderQuestion();
      else endPack();
    };
    window._spAdvance = advance;

    if (fb) {
      fb.innerHTML = `${win ? `✓ +${pts}` : `✗ ${q.a[q.c]}`} &nbsp;<button onclick="window._spAdvance()" style="background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);border-radius:8px;color:#fff;font-size:12px;font-weight:700;padding:3px 10px;cursor:pointer;font-family:inherit">Далее (<span id="sp-ans-left">${left}</span>s)</button>`;
    }

    _ansTimer = setInterval(() => {
      left--;
      const el = document.getElementById('sp-ans-left');
      if (el) el.textContent = left;
      if (left <= 0) advance();
    }, 1000);
  }, 800);
};

window.spTogglePause = function() {
  if (_answered) return;
  _paused = !_paused;
  const btn = document.getElementById('sp-pause-btn');
  if (btn) btn.textContent = _paused ? '▶' : '⏸';
  if (_mediaEl) { _paused ? _mediaEl.pause() : _mediaEl.play(); }
};

function renderDots() {
  const el = document.getElementById('sp-dots');
  if (!el) return;
  el.innerHTML = _pack.questions.map((_, i) => {
    const h = _history[i];
    let cls = 'sp-dot';
    if (i < _qIdx) cls += h && h.picked === h.correct ? ' done' : ' done wrong';
    else if (i === _qIdx) cls += ' active';
    return `<div class="${cls}"></div>`;
  }).join('');
}

async function endPack() {
  stopTimer();
  stopMedia();
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

  // Save result to DB and localStorage
  const result = {
    pack_id: _pack.id,
    pack_title: _pack.title || _pack.id,
    score: _score,
    correct: _correct,
    total: _pack.questions.length,
    played_at: new Date().toISOString(),
  };
  const history = JSON.parse(localStorage.getItem('bfc_pack_history') || '[]');
  history.unshift(result);
  localStorage.setItem('bfc_pack_history', JSON.stringify(history.slice(0, 50)));

  if (sb) {
    const user = (await sb.auth.getUser()).data?.user;
    if (user) {
      sb.from('pack_results').insert({ user_id: user.id, ...result }).then(() => {}).catch(() => {});
    }
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
        <img src="${h.q.ans_img || h.q.img}" style="width:100%;border-radius:8px;margin-bottom:6px;display:block"/>
        <div class="sp-rev-ans">${ok ? '✓' : '✗'} ${h.q.a[h.correct]}${!ok && h.picked >= 0 ? ` <span class="sp-rev-yours">(ты: ${h.q.a[h.picked]})</span>` : ''}</div>
      </div>
    </div>`;
  }).join('');
};

window.spRestart = function() { startSlidePack(_pack); };

window.spShareResult = function() {
  const pct  = Math.round(_correct / _pack.questions.length * 100);
  const icon = pct >= 80 ? '🏆' : pct >= 50 ? '🎯' : '📚';
  const text = `${icon} Сыграл в «${_pack.title || 'Brain Fight Club'}»\n✅ ${_correct}/${_pack.questions.length} правильных · ⚡${_score} очков · ${pct}%\n\n🧠 Попробуй сам: brain-fight-club.vercel.app`;
  if (navigator.share) {
    navigator.share({ text }).catch(() => {});
  } else {
    navigator.clipboard?.writeText(text).then(() => window.toast?.('Скопировано в буфер!'));
  }
};

window.spClose = function() {
  stopTimer();
  stopMedia();
  document.getElementById('slide-pack-screen').style.display = 'none';
  if (window.showScreen) window.showScreen('home');
};

window.startSlidePack = startSlidePack;
window.loadPack       = loadPack;
