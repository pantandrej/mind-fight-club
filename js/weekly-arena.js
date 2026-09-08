// weekly-arena.js — Weekly Arena screen
// Architecture: individual-paced within a common server-controlled live window.
// Server RPCs: get_weekly_arena, join_weekly_arena, submit_weekly_arena_answer,
//              get_weekly_arena_results.
// Client sends: arena_id, waq_id (opaque token — NOT question_id), selected_index.
// Client never receives: correct_index, is_correct, points (during LIVE).

import { _esc } from './router.js';

// ── i18n ─────────────────────────────────────────────────────────
const S = {
  title:         { ru: 'Weekly Arena',                          en: 'Weekly Arena' },
  upcoming:      { ru: 'Скоро',                                 en: 'Upcoming' },
  live:          { ru: 'Идёт сейчас',                           en: 'Live now' },
  finished:      { ru: 'Завершена',                             en: 'Finished' },
  noArena:       { ru: 'Арен пока нет',                         en: 'No arenas yet' },
  starts:        { ru: 'Начало',                                en: 'Starts' },
  ends:          { ru: 'Конец',                                 en: 'Ends' },
  join:          { ru: 'Участвовать',                           en: 'Join' },
  play:          { ru: 'Играть',                                en: 'Play' },
  results:       { ru: 'Результаты',                            en: 'Results' },
  yourScore:     { ru: 'Мой счёт',                              en: 'My score' },
  correct:       { ru: 'правильных',                            en: 'correct' },
  rank:          { ru: 'Место',                                 en: 'Rank' },
  players:       { ru: 'игроков',                               en: 'players' },
  q:             { ru: 'вопрос',                                en: 'question' },
  of:            { ru: 'из',                                    en: 'of' },
  checking:      { ru: 'Проверяю…',                             en: 'Checking…' },
  loading:       { ru: 'Загрузка…',                             en: 'Loading…' },
  notAuth:       { ru: 'Войдите для участия',                   en: 'Sign in to participate' },
  loadError:     { ru: 'Ошибка загрузки',                       en: 'Load error' },
  connError:     { ru: 'Ошибка соединения',                     en: 'Connection error' },
  joinError:     { ru: 'Ошибка',                                en: 'Error' },
  noQuestions:   { ru: 'Нет вопросов',                          en: 'No questions' },
  accepted:      { ru: '✅ Ответ принят',                        en: '✅ Answer accepted' },
  howTitle:      { ru: 'Как это работает',                      en: 'How it works' },
  how1:          { ru: 'Ответь на все вопросы в едином живом окне', en: 'Answer all questions during the shared live window' },
  how2:          { ru: 'Правильность проверяется сервером',     en: 'Correctness verified by server' },
  how3:          { ru: 'Результат идёт в зачёт Brain Fights',   en: 'Result counts toward Brain Fights' },
  done:          { ru: 'Арена пройдена! 🎉',                     en: 'Arena complete! 🎉' },
  doneWait:      { ru: 'Результаты — после завершения арены',   en: 'Results available after arena ends' },
  bfEarned:      { ru: 'BF очки получены',                      en: 'BF points earned' },
  leaderboard:   { ru: 'Таблица лидеров',                       en: 'Leaderboard' },
  lbLive:        { ru: 'Таблица лидеров будет доступна после завершения арены', en: 'Leaderboard available after arena ends' },
  pts:           { ru: 'очк.',                                  en: 'pts' },
  answered:      { ru: 'отвечено',                              en: 'answered' },
  progress:      { ru: 'Прогресс',                              en: 'Progress' },
};

function _s(key) {
  const lang = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const e = S[key];
  if (!e) return key;
  return lang === 'en' ? e.en : e.ru;
}

function _dateStr(iso) {
  const lang = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const locale = lang === 'en' ? 'en-US' : 'ru-RU';
  return new Date(iso).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

// ── State ─────────────────────────────────────────────────────────
let _arena       = null;
let _questions   = [];
let _qIdx        = 0;
let _partId      = null;
let _answered    = 0;

// ── Entry point ───────────────────────────────────────────────────
export async function loadWeeklyArena() {
  const root = document.getElementById('weekly-arena-screen');
  if (!root) return;
  root.innerHTML = `<div class="wa-loading">${_s('loading')}</div>`;

  if (!window.sb) {
    root.innerHTML = `<div class="wa-loading">${_s('notAuth')}</div>`;
    return;
  }

  try {
    const { data, error } = await window.sb.rpc('get_weekly_arena');
    if (error || !data?.ok) {
      root.innerHTML = _renderNoArena();
      return;
    }
    _arena     = data.arena;
    _questions = data.questions || [];
    const myP  = data.my_participation;

    _partId   = myP?.participant_id || null;
    _answered = myP?.answered       || 0;

    root.innerHTML = _renderArenaShell(data);
    _bindShell(data);
  } catch (e) {
    root.innerHTML = `<div class="wa-loading">${_s('loadError')}</div>`;
    console.error('[WA]', e);
  }
}

// ── Shell render ──────────────────────────────────────────────────
function _renderArenaShell(data) {
  const a      = data.arena;
  const myP    = data.my_participation;
  const status = a.eff_status;

  const statusLabel = { upcoming: _s('upcoming'), live: _s('live'), finished: _s('finished') }[status] || status;
  const statusClass = { upcoming: 'wa-status--upcoming', live: 'wa-status--live', finished: 'wa-status--finished' }[status] || '';

  const endsAt = _dateStr(a.ends_at);

  const participated = myP !== null;
  const completed    = myP?.completed === true;

  let ctaHtml = '';
  if (status === 'upcoming') {
    ctaHtml = `<div class="wa-cta-info">${_s('starts')}: ${_esc(_dateStr(a.starts_at))}</div>`;
  } else if (status === 'live') {
    if (!participated) {
      ctaHtml = `<button class="wa-btn wa-btn--primary" id="wa-join-btn">${_s('join')}</button>`;
    } else if (!completed) {
      ctaHtml = `<button class="wa-btn wa-btn--primary" id="wa-play-btn">${_s('play')}</button>`;
    } else {
      ctaHtml = `<button class="wa-btn wa-btn--secondary" id="wa-results-btn">${_s('results')}</button>`;
    }
  } else if (status === 'finished') {
    ctaHtml = `<button class="wa-btn wa-btn--secondary" id="wa-results-btn">${_s('results')}</button>`;
  }

  // Stats shown only after FINISHED (score/correct hidden during LIVE — P0.3)
  let myStatsHtml = '';
  if (participated && status === 'finished' && myP.score != null) {
    myStatsHtml = `
      <div class="wa-my-stats">
        <div class="wa-stat"><span class="wa-stat-val">${_esc(String(myP.score ?? 0))}</span><span class="wa-stat-lbl">${_s('yourScore')}</span></div>
        <div class="wa-stat"><span class="wa-stat-val">${_esc(String(myP.correct ?? 0))}/${_esc(String(myP.total_questions ?? 0))}</span><span class="wa-stat-lbl">${_s('correct')}</span></div>
        ${myP.rank ? `<div class="wa-stat"><span class="wa-stat-val">#${_esc(String(myP.rank))}</span><span class="wa-stat-lbl">${_s('rank')}</span></div>` : ''}
      </div>`;
  } else if (participated && status === 'live') {
    // During LIVE: show progress only
    myStatsHtml = `
      <div class="wa-my-stats">
        <div class="wa-stat"><span class="wa-stat-val">${_esc(String(myP.answered ?? 0))}/${_esc(String(myP.total_questions ?? 0))}</span><span class="wa-stat-lbl">${_s('answered')}</span></div>
      </div>`;
  }

  return `
    <div class="wa-wrap">
      <div class="wa-hero">
        <div class="wa-hero-label">${_s('title')}</div>
        <div class="wa-hero-title">${_esc(a.title)}</div>
        <div class="wa-status ${statusClass}">${_esc(statusLabel)}</div>
        <div class="wa-time">${_s('ends')}: ${_esc(endsAt)}</div>
        <div class="wa-count">${_esc(String(data.participant_count || 0))} ${_s('players')}</div>
      </div>

      ${myStatsHtml}

      <div class="wa-cta">${ctaHtml}</div>

      <div id="wa-play-area"></div>

      <div class="wa-how">
        <div class="wa-how-title">${_s('howTitle')}</div>
        <div class="wa-how-item">📋 ${_s('how1')}</div>
        <div class="wa-how-item">✅ ${_s('how2')}</div>
        <div class="wa-how-item">🧠 ${_s('how3')}</div>
      </div>
    </div>`;
}

function _renderNoArena() {
  return `<div class="wa-wrap"><div class="wa-hero"><div class="wa-hero-label">${_s('title')}</div><div class="wa-hero-title">${_s('noArena')}</div></div></div>`;
}

// ── Bind CTA buttons ──────────────────────────────────────────────
function _bindShell(data) {
  document.getElementById('wa-join-btn')?.addEventListener('click', () => _doJoin(data.arena.id));
  document.getElementById('wa-play-btn')?.addEventListener('click', () => _startPlay());
  document.getElementById('wa-results-btn')?.addEventListener('click', () => _loadResults(data.arena.id));
}

// ── Join ──────────────────────────────────────────────────────────
async function _doJoin(arenaId) {
  const btn = document.getElementById('wa-join-btn');
  if (btn) { btn.disabled = true; btn.textContent = _s('checking'); }

  try {
    const { data, error } = await window.sb.rpc('join_weekly_arena', { p_arena_id: arenaId });
    if (error || !data?.ok) {
      if (btn) { btn.disabled = false; btn.textContent = _s('join'); }
      window.toast?.(error?.message || data?.reason || _s('joinError'));
      return;
    }
    _partId = data.participant_id;
    const cta = document.querySelector('.wa-cta');
    if (cta) cta.innerHTML = `<button class="wa-btn wa-btn--primary" id="wa-play-btn">${_s('play')}</button>`;
    document.getElementById('wa-play-btn')?.addEventListener('click', () => _startPlay());
  } catch (e) {
    if (btn) { btn.disabled = false; btn.textContent = _s('join'); }
    window.toast?.(_s('connError'));
  }
}

// ── Play flow ─────────────────────────────────────────────────────
function _startPlay() {
  if (!_questions.length) { window.toast?.(_s('noQuestions')); return; }
  _qIdx = _answered;
  if (_qIdx >= _questions.length) { _showDone(null); return; }
  _renderQuestion(_qIdx);
}

function _renderQuestion(idx) {
  const area = document.getElementById('wa-play-area');
  if (!area) return;
  const q = _questions[idx];
  if (!q) { _showDone(null); return; }

  const total   = _questions.length;
  const lang    = document.querySelector('.lang-btn.active')?.textContent?.toLowerCase() || 'ru';
  const answers = (lang === 'en' && q.answers_json ? q.answers_json : (q.answers_ru || q.answers_json || []));
  const qText   = (lang === 'en' ? q.question_text : (q.question_ru || q.question_text || ''));

  const mediaHtml = q.image_url
    ? `<img src="${_esc(q.image_url)}" class="wa-q-img" alt="" />`
    : q.audio_url
    ? `<audio controls src="${_esc(q.audio_url)}" class="wa-q-audio"></audio>`
    : '';

  area.innerHTML = `
    <div class="wa-question">
      <div class="wa-q-progress">${_s('q')} ${idx + 1} ${_s('of')} ${total}</div>
      ${mediaHtml}
      <div class="wa-q-text">${_esc(qText)}</div>
      <div class="wa-answers" id="wa-answers">
        ${answers.map((ans, i) => `
          <button class="wa-ans-btn" data-idx="${i}">${_esc(String(ans))}</button>
        `).join('')}
      </div>
      <div class="wa-q-feedback" id="wa-q-fb" hidden></div>
    </div>`;

  document.querySelectorAll('.wa-ans-btn').forEach(btn => {
    btn.addEventListener('click', () => _pickAnswer(q, parseInt(btn.dataset.idx, 10)));
  });
}

async function _pickAnswer(q, selectedIdx) {
  document.querySelectorAll('.wa-ans-btn').forEach(b => b.disabled = true);

  const fb = document.getElementById('wa-q-fb');
  if (fb) { fb.hidden = false; fb.textContent = _s('checking'); fb.className = 'wa-q-feedback'; }

  try {
    const { data, error } = await window.sb.rpc('submit_weekly_arena_answer', {
      p_arena_id:       _arena.id,
      p_waq_id:         q.waq_id,      // opaque token; server resolves → question_id
      p_selected_index: selectedIdx,
    });

    if (error || !data?.ok) {
      const reason = data?.reason || error?.message || '';
      if (reason === 'already_answered') {
        _qIdx++;
        _answered++;
        setTimeout(() => _advanceOrDone(data), 400);
        return;
      }
      if (fb) { fb.textContent = reason || _s('connError'); fb.className = 'wa-q-feedback wa-q-feedback--error'; }
      document.querySelectorAll('.wa-ans-btn').forEach(b => b.disabled = false);
      return;
    }

    // During LIVE: neutral "Ответ принят" — no colors, no correct/wrong (P0.3)
    if (fb) {
      fb.hidden = false;
      fb.textContent = _s('accepted');
      fb.className = 'wa-q-feedback wa-q-feedback--accepted';
    }

    _answered++;
    _qIdx++;

    setTimeout(() => _advanceOrDone(data), 1000);

  } catch (e) {
    if (fb) { fb.hidden = false; fb.textContent = _s('connError'); fb.className = 'wa-q-feedback wa-q-feedback--error'; }
    document.querySelectorAll('.wa-ans-btn').forEach(b => b.disabled = false);
  }
}

function _advanceOrDone(lastData) {
  if (lastData?.completed || _qIdx >= _questions.length) {
    _showDone(lastData);
  } else {
    _renderQuestion(_qIdx);
  }
}

function _showDone(data) {
  const area = document.getElementById('wa-play-area');
  if (!area) return;
  // During LIVE: no score shown — results revealed after arena ends (P0.3)
  const bfLine = (data?.bf_pts > 0) ? `<div class="wa-done-bf">🧠 +${data.bf_pts} ${_s('bfEarned')}</div>` : '';
  area.innerHTML = `
    <div class="wa-done">
      <div class="wa-done-title">${_s('done')}</div>
      <div class="wa-done-wait">${_s('doneWait')}</div>
      ${bfLine}
      <button class="wa-btn wa-btn--secondary" id="wa-results-btn">${_s('results')}</button>
    </div>`;

  const cta = document.querySelector('.wa-cta');
  if (cta) cta.innerHTML = `<button class="wa-btn wa-btn--secondary" id="wa-results-btn2">${_s('results')}</button>`;

  document.getElementById('wa-results-btn')?.addEventListener('click', () => _loadResults(_arena.id));
  document.getElementById('wa-results-btn2')?.addEventListener('click', () => _loadResults(_arena.id));
}

// ── Results ───────────────────────────────────────────────────────
async function _loadResults(arenaId) {
  const area = document.getElementById('wa-play-area');
  if (area) area.innerHTML = `<div class="wa-loading">${_s('loading')}</div>`;

  try {
    const { data, error } = await window.sb.rpc('get_weekly_arena_results', { p_arena_id: arenaId });
    if (error || !data?.ok) { if (area) area.innerHTML = ''; return; }

    const lb  = data.leaderboard || [];
    const me  = data.my_result;
    const isLive = data.arena?.eff_status === 'live';

    // During LIVE: show progress, no score (P0.3)
    const meHtml = me ? (isLive ? `
      <div class="wa-my-result">
        <div class="wa-stat"><span class="wa-stat-val">${me.answered ?? 0}/${me.total_questions ?? 0}</span><span class="wa-stat-lbl">${_s('answered')}</span></div>
      </div>` : `
      <div class="wa-my-result">
        <div class="wa-stat"><span class="wa-stat-val">#${me.rank}</span><span class="wa-stat-lbl">${_s('rank')}</span></div>
        <div class="wa-stat"><span class="wa-stat-val">${me.score}</span><span class="wa-stat-lbl">${_s('yourScore')}</span></div>
        <div class="wa-stat"><span class="wa-stat-val">${me.correct}/${me.total_questions}</span><span class="wa-stat-lbl">${_s('correct')}</span></div>
      </div>`) : '';

    const lbHtml = isLive
      ? `<div class="wa-lb-soon">${_s('lbLive')}</div>`
      : lb.length ? `
        <div class="wa-lb-title">${_s('leaderboard')}</div>
        ${lb.map(r => `
          <div class="wa-lb-row${r.is_me ? ' wa-lb-me' : ''}">
            <span class="wa-lb-rank">#${r.rank}</span>
            <span class="wa-lb-name">${_esc(r.display_name || '—')}${r.team_name ? ` <span class="wa-lb-team">${_esc(r.team_emoji || '')} ${_esc(r.team_name)}</span>` : ''}</span>
            <span class="wa-lb-score">${r.score} ${_s('pts')}</span>
          </div>`).join('')}` : '';

    if (area) area.innerHTML = `<div class="wa-results">${meHtml}${lbHtml}</div>`;
  } catch (e) {
    if (area) area.innerHTML = '';
    console.error('[WA] results', e);
  }
}

// ── Expose ────────────────────────────────────────────────────────
window.loadWeeklyArena = loadWeeklyArena;
