// ── Hype Game ─────────────────────────────────────────────────────
import { sb }       from '../services/supabase.js';
import { getState } from '../state.js';
import { showScreen, toast } from '../router.js';

const Q_TIME = 20; // seconds per question

let _game     = null;   // hype_game row
let _qs       = [];     // questions array
let _idx      = 0;
let _score    = 0;
let _answered = false;
let _timer    = null;
let _timeLeft = Q_TIME;
let _playerName = '';

// ── Entry point ───────────────────────────────────────────────────
export async function openHypeGame(slug) {
  showScreen('hype-game');
  _show('hg-intro');

  const { data, error } = await sb.from('hype_games')
    .select('*').eq('slug', slug).eq('active', true).maybeSingle();

  if (!data || error) {
    toast('Игра не найдена 😕');
    showScreen('home');
    return;
  }

  _game = data;
  _qs   = Array.isArray(data.questions) ? data.questions : [];

  document.getElementById('hg-title').textContent = data.title || 'Хайп-игра';
  document.getElementById('hg-desc').textContent  = data.description || '';

  // Pre-fill name if logged in
  const { currentUser } = getState();
  if (currentUser) {
    const nameInput = document.getElementById('hg-guest-name');
    if (nameInput) {
      nameInput.value = currentUser.user_metadata?.full_name?.split(' ')[0]
        || localStorage.getItem('mfc_display_name') || '';
    }
  }
}

// ── Start ─────────────────────────────────────────────────────────
window.hypeGameStart = function () {
  if (!_game || !_qs.length) { toast('Вопросы не загружены'); return; }

  _playerName = document.getElementById('hg-guest-name')?.value.trim()
    || getState().currentUser?.user_metadata?.full_name?.split(' ')[0]
    || 'Анонимный игрок';
  _idx = 0; _score = 0; _answered = false;

  _show('hg-question');
  _renderQuestion();
};

window.hypeGameNext   = _nextQuestion;
window.hypeGameRestart = () => { _cleanup(); openHypeGame(_game?.slug); };

// ── Question render ───────────────────────────────────────────────
function _renderQuestion() {
  _cleanup();
  _answered = false;
  const q = _qs[_idx];
  if (!q) { _showResults(); return; }

  // Header
  document.getElementById('hg-q-num').textContent = `Вопрос ${_idx + 1} / ${_qs.length}`;
  _setProgress((_idx / _qs.length) * 100);

  // Media
  const mediaEl = document.getElementById('hg-media');
  mediaEl.innerHTML = '';
  const mediaQ = { img: q.img || null, audio: q.audio || null, video: q.video || null };
  if (mediaQ.img || mediaQ.audio || mediaQ.video) {
    window.renderQMedia?.('hg-media', mediaQ);
  }

  // Question text
  document.getElementById('hg-q-text').textContent = q.q || '';

  // Answers
  const answersEl = document.getElementById('hg-answers');
  answersEl.innerHTML = '';
  (q.a || []).forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.textContent = ans;
    btn.dataset.idx = i;
    btn.style.cssText = `
      width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;
      padding:13px 16px;font-size:14px;font-weight:600;color:var(--fg);cursor:pointer;
      font-family:inherit;text-align:left;transition:background .15s,border-color .15s
    `;
    btn.onclick = () => _answer(i);
    answersEl.appendChild(btn);
  });

  // Timer
  _timeLeft = Q_TIME;
  _updateTimer();
  _timer = setInterval(() => {
    _timeLeft--;
    _updateTimer();
    if (_timeLeft <= 0) { clearInterval(_timer); _answer(-1); }
  }, 1000);
}

function _answer(chosen) {
  if (_answered) return;
  _answered = true;
  clearInterval(_timer);

  const q       = _qs[_idx];
  const correct = q.c ?? 0;
  const isRight = chosen === correct;
  const pts     = isRight ? Math.max(1, _timeLeft) : 0;
  _score += pts;

  // Color buttons
  const btns = document.querySelectorAll('#hg-answers button');
  btns.forEach(btn => {
    const bi = Number(btn.dataset.idx);
    btn.style.pointerEvents = 'none';
    if (bi === correct) {
      btn.style.background = 'rgba(0,200,100,.2)';
      btn.style.borderColor = 'var(--green)';
      btn.style.color = 'var(--green)';
    } else if (bi === chosen) {
      btn.style.background = 'rgba(255,60,60,.15)';
      btn.style.borderColor = 'var(--red)';
      btn.style.color = 'var(--red)';
    } else {
      btn.style.opacity = '0.4';
    }
  });

  // Show reveal after 800ms
  setTimeout(() => _showReveal(isRight, pts, q), 800);
}

function _showReveal(isRight, pts, q) {
  _show('hg-reveal');

  document.getElementById('hg-reveal-verdict').innerHTML = isRight
    ? `✅ Правильно! <span style="color:var(--accent)">+${pts} очков</span>`
    : `❌ Неверно`;

  // Answer image
  const revMedia = document.getElementById('hg-reveal-media');
  revMedia.innerHTML = '';
  if (q.answer_img) {
    revMedia.innerHTML = `<img src="${q.answer_img}" alt=""
      style="width:100%;max-height:300px;object-fit:contain;border-radius:12px;display:block;background:#0a0a0f"
      onerror="this.style.display='none'">`;
  }

  document.getElementById('hg-reveal-text').textContent =
    q.explanation || `Верный ответ: ${(q.a || [])[q.c] || ''}`;

  const nextBtn = document.getElementById('hg-next-btn');
  if (_idx >= _qs.length - 1) {
    nextBtn.textContent = 'Посмотреть результат →';
  } else {
    nextBtn.textContent = `Следующий вопрос →`;
  }
}

function _nextQuestion() {
  _idx++;
  if (_idx >= _qs.length) {
    _showResults();
  } else {
    _show('hg-question');
    _renderQuestion();
  }
}

// ── Results ───────────────────────────────────────────────────────
async function _showResults() {
  _cleanup();
  _show('hg-results');

  const max   = _qs.length * Q_TIME;
  const pct   = Math.round((_score / max) * 100);
  const emoji = pct >= 80 ? '🏆' : pct >= 50 ? '🎉' : '💪';

  document.getElementById('hg-result-emoji').textContent = emoji;
  document.getElementById('hg-result-score').textContent = _score;
  document.getElementById('hg-result-label').textContent =
    `из ${max} возможных (${pct}%) · ${_qs.length} вопросов`;

  // Save session
  await _saveSession();

  // Load leaderboard
  _loadLeaderboard();
}

async function _saveSession() {
  if (!_game?.id) return;
  const { currentUser } = getState();
  const max = _qs.length * Q_TIME;

  try {
    await sb.from('hype_game_sessions').insert({
      hype_game_id: _game.id,
      user_id:      currentUser?.id || null,
      guest_name:   _playerName,
      score:        _score,
      max_score:    max,
    });
  } catch (e) {
    console.warn('[hype] session save failed', e);
  }
}

async function _loadLeaderboard() {
  if (!_game?.id) return;
  const lbEl = document.getElementById('hg-lb-rows');
  lbEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Загружаем...</div>';

  const { data } = await sb.from('hype_game_sessions')
    .select('guest_name,score,max_score,played_at')
    .eq('hype_game_id', _game.id)
    .order('score', { ascending: false })
    .limit(20);

  if (!data?.length) { lbEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Пока нет результатов</div>'; return; }

  lbEl.innerHTML = '';
  data.forEach((row, i) => {
    const pct  = row.max_score ? Math.round((row.score / row.max_score) * 100) : 0;
    const isMe = row.guest_name === _playerName;
    const el   = document.createElement('div');
    el.style.cssText = `display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:10px;${isMe ? 'background:rgba(108,99,255,.15);border:0.5px solid rgba(108,99,255,.3)' : ''}`;
    el.innerHTML = `
      <div style="font-size:13px;font-weight:800;color:var(--muted);min-width:22px">${i + 1}</div>
      <div style="flex:1;font-size:13px;font-weight:${isMe ? '800' : '600'}">${_esc(row.guest_name || 'Аноним')}</div>
      <div style="font-size:13px;font-weight:700;color:var(--accent)">${row.score}</div>
      <div style="font-size:11px;color:var(--muted)">${pct}%</div>
    `;
    lbEl.appendChild(el);
  });
}

// ── Helpers ───────────────────────────────────────────────────────
function _show(sectionId) {
  ['hg-intro','hg-question','hg-reveal','hg-results'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.display = id === sectionId ? 'flex' : 'none';
  });
}

function _setProgress(pct) {
  const fill = document.getElementById('hg-progress-fill');
  if (fill) fill.style.width = pct + '%';
}

function _updateTimer() {
  const el = document.getElementById('hg-timer');
  if (!el) return;
  el.textContent = _timeLeft;
  el.style.color = _timeLeft <= 5 ? 'var(--red)' : 'var(--accent)';
}

function _cleanup() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

function _esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ── URL param handler ─────────────────────────────────────────────
export function checkHypeParam() {
  const p = new URLSearchParams(window.location.search);
  const slug = p.get('hype');
  if (slug) openHypeGame(slug);
}

window.openHypeGame  = openHypeGame;
window.checkHypeParam = checkHypeParam;
