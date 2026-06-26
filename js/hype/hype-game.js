// ── Hype Game ─────────────────────────────────────────────────────
import { sb }       from '../services/supabase.js';
import { getState } from '../state.js';
import { showScreen, toast } from '../router.js';

const Q_TIME    = 30;          // seconds per question
const Q_TIME_MS = Q_TIME * 1000;

let _game        = null;
let _qs          = [];
let _score       = 0;
let _playerName  = '';
let _answers     = {};   // qIdx → { chosen, pts, isRight }
let _lastIdx     = -1;   // last rendered question index
let _answered    = false; // for current question
let _idx         = 0;    // current question index (free mode)
let _timeLeft    = Q_TIME;
let _timer       = null; // free-mode countdown interval
let _syncLoop    = null; // sync-mode master loop

// ── Helpers ───────────────────────────────────────────────────────
const _isSynced = () => !!_game?.starts_at;

function _getGameState() {
  if (!_game?.starts_at) return { state: 'free' };
  const now     = Date.now();
  const start   = new Date(_game.starts_at).getTime();
  const elapsed = now - start;
  if (elapsed < 0) return { state: 'waiting', secsLeft: Math.ceil(-elapsed / 1000) };
  const qIdx    = Math.floor(elapsed / Q_TIME_MS);
  if (qIdx >= _qs.length) return { state: 'done' };
  const timeLeft = Math.max(0, Q_TIME - Math.floor((elapsed % Q_TIME_MS) / 1000));
  return { state: 'playing', qIdx, timeLeft };
}

// ── Entry point ───────────────────────────────────────────────────
export async function openHypeGame(slug) {
  showScreen('hype-game');
  _show('hg-intro');

  // Reset
  _answers = {}; _lastIdx = -1; _answered = false;
  _idx = 0; _score = 0; _timeLeft = Q_TIME;
  _cleanup();

  const { data, error } = await sb.from('hype_games')
    .select('*').eq('slug', slug).eq('active', true).maybeSingle();

  if (!data || error) { toast('Игра не найдена 😕'); showScreen('home'); return; }

  _game = data;
  _qs   = Array.isArray(data.questions) ? data.questions : [];

  document.getElementById('hg-title').textContent = data.title || 'Хайп-игра';
  document.getElementById('hg-desc').textContent  = data.description || '';

  const { currentUser } = getState();
  if (currentUser) {
    const el = document.getElementById('hg-guest-name');
    if (el) el.value = currentUser.user_metadata?.full_name?.split(' ')[0]
      || localStorage.getItem('mfc_display_name') || '';
  }

  // If synced and already started — skip intro, jump in
  if (_isSynced()) {
    const gs = _getGameState();
    if (gs.state === 'playing' || gs.state === 'done') {
      _playerName = document.getElementById('hg-guest-name')?.value.trim() || 'Аноним';
      _enterSyncMode();
      return;
    }
  }
}

// ── Start (button click) ──────────────────────────────────────────
window.hypeGameStart = function () {
  if (!_game || !_qs.length) { toast('Вопросы не загружены'); return; }

  _playerName = document.getElementById('hg-guest-name')?.value.trim()
    || getState().currentUser?.user_metadata?.full_name?.split(' ')[0]
    || 'Аноним';

  if (_isSynced()) {
    _enterSyncMode();
  } else {
    // Free mode
    _idx = 0; _score = 0; _answered = false; _answers = {};
    _show('hg-question');
    _renderQuestion();
  }
};

window.hypeGameNext    = _nextQuestion;
window.hypeGameRestart = () => { _cleanup(); openHypeGame(_game?.slug); };

// ── Sync mode ─────────────────────────────────────────────────────
function _enterSyncMode() {
  const gs = _getGameState();

  if (gs.state === 'waiting') {
    // Show waiting screen with countdown
    _show('hg-waiting');
    _updateWaiting(gs.secsLeft);
    _syncLoop = setInterval(() => {
      const s = _getGameState();
      if (s.state === 'waiting') {
        _updateWaiting(s.secsLeft);
      } else {
        clearInterval(_syncLoop);
        _syncLoop = null;
        _startSyncLoop();
      }
    }, 500);
    return;
  }

  _startSyncLoop();
}

function _startSyncLoop() {
  _cleanup();
  _syncLoop = setInterval(() => {
    const gs = _getGameState();

    if (gs.state === 'done') {
      _cleanup();
      if (_lastIdx < _qs.length) {
        _lastIdx = _qs.length;
        _finalizeScore();
        _showResults();
      }
      return;
    }

    if (gs.state !== 'playing') return;

    _timeLeft = gs.timeLeft;

    if (gs.qIdx !== _lastIdx) {
      // Question changed — render new one
      _lastIdx  = gs.qIdx;
      _idx      = gs.qIdx;
      _answered = !!_answers[gs.qIdx];
      _show('hg-question');
      _renderQuestion();
      if (_answered) _restoreAnswerState(gs.qIdx);
    } else {
      // Same question — just tick timer
      _updateTimer();
      if (gs.timeLeft === 0 && !_answered) {
        // Time ran out — auto-submit miss
        _answered = true;
        _answers[_idx] = { chosen: -1, pts: 0, isRight: false };
        _markButtons(_qs[_idx].c ?? 0, -1);
        _revealInline(false, 0, _qs[_idx]);
      }
    }
  }, 500);
}

function _updateWaiting(secsLeft) {
  const el = document.getElementById('hg-wait-countdown');
  if (el) el.textContent = _formatCountdown(secsLeft);
}

function _formatCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
}

function _restoreAnswerState(qIdx) {
  const rec = _answers[qIdx];
  if (!rec) return;
  const q = _qs[qIdx];
  _markButtons(q.c ?? 0, rec.chosen);
  _revealInline(rec.isRight, rec.pts, q);
}

function _finalizeScore() {
  _score = Object.values(_answers).reduce((s, r) => s + (r.pts || 0), 0);
}

// ── Question render ───────────────────────────────────────────────
function _renderQuestion() {
  if (!_isSynced()) _cleanup();
  _answered = !!_answers[_idx];

  const q = _qs[_idx];
  if (!q) { _showResults(); return; }

  document.getElementById('hg-q-num').textContent = `Вопрос ${_idx + 1} / ${_qs.length}`;
  _setProgress((_idx / _qs.length) * 100);

  const isImg   = !!q.img;
  const isAudio = !!q.audio;
  const isVideo = !!q.video;

  const mediaEl    = document.getElementById('hg-media');
  const avEl       = document.getElementById('hg-av-media');
  const nextWrap   = document.getElementById('hg-next-wrap');

  mediaEl.innerHTML = '';
  avEl.innerHTML = '';
  avEl.style.display = 'none';
  nextWrap.style.display = 'none';

  if (isImg) {
    mediaEl.style.cssText = 'display:flex;flex:0 0 50%;min-width:0;overflow:hidden;background:#000;align-items:center;justify-content:center';
    mediaEl.innerHTML = `<img src="${q.img}" alt="" style="width:100%;height:100%;object-fit:contain;display:block"
      onerror="this.style.display='none'">`;
  } else {
    mediaEl.style.display = 'none';
    if (isAudio || isVideo) {
      avEl.style.display = 'block';
      window.renderQMedia?.('hg-av-media', { img: null, audio: q.audio || null, video: q.video || null });
    }
  }

  document.getElementById('hg-q-text').textContent = q.q || '';

  const answersEl = document.getElementById('hg-answers');
  answersEl.innerHTML = '';
  (q.a || []).forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.textContent = ans;
    btn.dataset.idx = i;
    btn.style.cssText = `width:100%;background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;
      padding:13px 16px;font-size:14px;font-weight:600;color:var(--fg);cursor:pointer;
      font-family:inherit;text-align:left;transition:background .15s,border-color .15s`;
    btn.onclick = () => _answer(i);
    answersEl.appendChild(btn);
  });

  _updateTimer();

  // Free mode: start countdown interval
  if (!_isSynced()) {
    _timeLeft = Q_TIME;
    _updateTimer();
    _timer = setInterval(() => {
      _timeLeft--;
      _updateTimer();
      if (_timeLeft <= 0) { clearInterval(_timer); _answer(-1); }
    }, 1000);
  }
}

function _answer(chosen) {
  if (_answered) return;
  _answered = true;
  if (_timer) { clearInterval(_timer); _timer = null; }

  const q       = _qs[_idx];
  const correct = q.c ?? 0;
  const isRight = chosen === correct;
  const pts     = isRight ? Math.max(1, _timeLeft) : 0;

  _answers[_idx] = { chosen, pts, isRight };

  if (!_isSynced()) _score += pts;

  _markButtons(correct, chosen);
  setTimeout(() => _revealInline(isRight, pts, q), 500);
}

function _markButtons(correct, chosen) {
  document.querySelectorAll('#hg-answers button').forEach(btn => {
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
}

function _revealInline(isRight, pts, q) {
  const mediaEl = document.getElementById('hg-media');

  if (q.answer_img) {
    if (!!q.img) {
      const img = mediaEl.querySelector('img');
      if (img) {
        img.style.transition = 'opacity .4s';
        img.style.opacity = '0';
        setTimeout(() => { img.src = q.answer_img; img.style.opacity = '1'; }, 400);
      }
    } else {
      mediaEl.style.cssText = 'display:flex;flex:0 0 45%;min-width:0;overflow:hidden;background:#000;align-items:center;justify-content:center';
      mediaEl.innerHTML = `<img src="${q.answer_img}" alt=""
        style="width:100%;height:100%;object-fit:contain;display:block"
        onerror="this.parentElement.style.display='none'">`;
    }
  }

  const timerEl = document.getElementById('hg-timer');
  if (timerEl) {
    timerEl.textContent = isRight ? `+${pts}` : '✗';
    timerEl.style.color = isRight ? 'var(--green)' : 'var(--red)';
  }

  // In sync mode: no next button — auto-advance by timer
  if (!_isSynced()) {
    const nextWrap = document.getElementById('hg-next-wrap');
    const nextBtn  = document.getElementById('hg-next-btn');
    if (nextWrap) nextWrap.style.display = 'block';
    if (nextBtn)  nextBtn.textContent = _idx >= _qs.length - 1 ? 'Посмотреть результат →' : 'Следующий вопрос →';
  }
}

// ── Free mode: manual next ────────────────────────────────────────
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

  await _saveSession();
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

  if (!data?.length) {
    lbEl.innerHTML = '<div style="font-size:12px;color:var(--muted)">Пока нет результатов</div>';
    return;
  }

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

// ── UI helpers ────────────────────────────────────────────────────
function _show(sectionId) {
  ['hg-intro','hg-waiting','hg-question','hg-reveal','hg-results'].forEach(id => {
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
  if (_timer)    { clearInterval(_timer);    _timer    = null; }
  if (_syncLoop) { clearInterval(_syncLoop); _syncLoop = null; }
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

window.openHypeGame   = openHypeGame;
window.checkHypeParam = checkHypeParam;
window._hypeAutoSlug  = new URLSearchParams(window.location.search).get('hype') || null;
console.log('[hype-game] module loaded');
