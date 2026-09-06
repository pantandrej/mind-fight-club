import { getState, setState } from '../state.js';
import { track } from '../services/analytics.js';

// ── Tournament state variables ─────────────────────────────────────
let tCode       = null;
let tRole       = null;
let tMyUserId   = null;
let tMyName     = 'Игрок';
let tQs         = [];
let tIdx        = 0;
let tMyScore    = 0;
let tAnsweredThisQ = false;
let tMySelectedIdx = -1; // locally selected answer index (revealed after deadline)
let tMyEarnedPts   = 0;  // points earned this question (speed-based)
let tTimer      = null;
let tDeadlineMs = 0;
let tQVersion   = 0;
let _fbTournUnsub = null;
let tPoll       = null;
let _tAdvanceLock = false;
let _tServerTimeOffset = 0;
let _tHeartbeatTimer = null;
let _tSyncPoll = null;
let _tSyncCountdown = null;
let _tPreselectedPackId = null;
let tLastRoom = {}; // last received room state, used for prev_correct_index on guests
let _tAnswerRevealed = false; // guard: reveal answer only once per question
let _tAllConfirmed   = false; // guard: all clicked "Далее" on answer slide

// ── Helpers: real question index (excluding info slides) ──────────
function tRealQIdx(absIdx){
  const q = tQs[absIdx];
  if(!q || q.question_type === 'info') return -1;
  return tQs.slice(0, absIdx).filter(q => q.question_type !== 'info').length;
}
function tRealQCount(){ return tQs.filter(q => q.question_type !== 'info').length; }

// ── Tournament logic ───────────────────────────────────────────────
// NOTE: tHostAdvanceQuestion requires fbTournAdvance or fbTournUpdateConditional.
// Without one of these, the tournament will NOT start (unsafe fallback removed).
// Deploy a Firebase Cloud Function for fbTournAdvance in production.

async function estimateServerTimeOffset(){
  if(!window.fbGetServerTime){ _tServerTimeOffset = 0; return; }
  try{
    const before = Date.now();
    const serverMs = await window.fbGetServerTime(); // returns server Unix ms
    const after = Date.now();
    const roundTrip = after - before;
    _tServerTimeOffset = serverMs - (before + roundTrip/2);
  }catch(e){
    _tServerTimeOffset = 0;
  }
}

function localToServer(ms){ return ms + _tServerTimeOffset; }

function serverToLocal(ms){ return ms - _tServerTimeOffset; }

function tSecondsForQ(q){
  if(!q) return 30;
  if(q.question_type === 'info') return 15;
  return 30;
}

function showTournSection(id){
  document.querySelectorAll('.tourn-section').forEach(s=>s.classList.toggle('active',s.id===id));
}

function tCleanup(){
  if(tTimer){ clearInterval(tTimer); tTimer=null; }
  if(tPoll){  clearInterval(tPoll);  tPoll=null; }
  if(_fbTournUnsub){ _fbTournUnsub(); _fbTournUnsub=null; }
  if(_tHeartbeatTimer){ clearInterval(_tHeartbeatTimer); _tHeartbeatTimer=null; }
  if(_tSyncPoll){ clearInterval(_tSyncPoll); _tSyncPoll=null; }
  if(_tSyncCountdown){ clearInterval(_tSyncCountdown); _tSyncCountdown=null; }
  if(window._tRealtimeCh){ try { sb.removeChannel(window._tRealtimeCh); } catch(_){} window._tRealtimeCh=null; }
  _tAdvanceLock = false;
}

async function createTournament(){
  // Firebase preferred for real-time sync; Supabase Realtime broadcast is the fallback.
  // Both support unlimited players — no hard limit.
  tCleanup();
  if(!currentUser){ toast('🔐 Войдите для участия в турнире'); showScreen('auth'); return; }
  tCode    = randCode();
  tRole    = 'host';
  tMyUserId = currentUser.id; // must be real auth.uid() — no guest IDs
  tMyName  = window._currentUserName
             || localStorage.getItem('mfc_display_name')
             || currentUser?.user_metadata?.full_name;
  // Try profile fetch — most reliable source
  try {
    const {data:prof} = await sb.from('profiles').select('display_name').eq('id',tMyUserId).single();
    if(prof?.display_name && prof.display_name !== 'Игрок') {
      tMyName = window._currentUserName = prof.display_name;
    }
  } catch(_){}
  if(!tMyName || tMyName === 'Игрок') tMyName = 'Хост';
  tQs=[]; tIdx=0; tMyScore=0; tAnsweredThisQ=false;

  const roomData = {
    status: 'waiting',
    host_id: tMyUserId,
    host_name: tMyName,
    current_question_index: -1,
    question_version: 0,
    question_started_at: null,
    question_deadline_at: null,
    participant_ids: [tMyUserId],
    participants: { [tMyUserId]: { name: tMyName, score: 0, q_answered: -1, last_seen: Date.now() } },
    questions: null,
    created_at: Date.now()
  };

  if(window.fbTournCreate){
    await window.fbTournCreate(tCode, tMyName, roomData);
  } else {
    await sb.from('tournaments').upsert({
      code: tCode, status:'waiting', host_id: tMyUserId,
      players: roomData.participants, questions: null
    }).catch(e=>{ console.error('[T] create error:', e); toast('Ошибка создания комнаты'); return; });
  }

  // Patch Firebase with resolved name in case it changed during async profile fetch
  if(window.fbTournPatch){
    window.fbTournPatch(tCode, {
      host_name: tMyName,
      [`participants.${tMyUserId}.name`]: tMyName
    }).catch(()=>{});
  }

  console.log('[T] createTournament: tMyName=', tMyName, '_currentUserName=', window._currentUserName);

  document.getElementById('t-code-display').textContent = tCode;
  document.getElementById('t-link-txt').textContent = location.origin+location.pathname+'?tourn='+tCode;
  document.getElementById('t-start-btn').style.display = 'block';
  document.getElementById('t-wait-txt').style.display  = 'none';
  // Show pack selector for host and load available packs
  const packSel = document.getElementById('t-pack-selector');
  if(packSel){ packSel.style.display = 'block'; tLoadPackOptions(); }
  showTournSection('t-waiting');
  tListenRoom();
  checkBadges('tourn'); if (typeof window.renderBadges === 'function') window.renderBadges();
}

async function joinTournament(){
  const code = document.getElementById('t-join-code').value.trim().toUpperCase();
  if(code.length !== 6){ toast('Введи 6-значный код'); return; }

  tCleanup();

  let room = null;
  if(window.fbTournGet){
    room = await window.fbTournGet(code);
  } else {
    const {data, error} = await sb.from('tournaments').select('*').eq('code',code).single();
    if(error){ toast('Комната не найдена'); return; }
    room = data;
  }

  if(!room){ toast('Комната не найдена'); return; }
  if(room.status === 'playing' || room.status === 'started'){
    // Late join: spectator mode — just listen, no playing
    toast('⚠️ Турнир уже идёт — смотришь как зритель');
    tCode = code; tRole = 'spectator';
    tMyUserId = currentUser?.id || 'spectator';
    tMyName = 'Зритель';
    document.getElementById('t-code-display').textContent = tCode;
    showTournSection('t-waiting');
    tListenRoom();
    return;
  }
  if(room.status === 'done' || room.status === 'finished'){
    toast('Турнир уже завершён'); return;
  }

  if(!currentUser){ toast('🔐 Войдите для участия в турнире'); showScreen('auth'); return; }
  tCode     = code;
  tRole     = 'guest';
  tMyUserId = currentUser.id; // real auth.uid() required
  tMyName   = window._currentUserName
              || localStorage.getItem('mfc_display_name')
              || currentUser?.user_metadata?.full_name;
  try {
    const {data:prof} = await sb.from('profiles').select('display_name').eq('id',tMyUserId).single();
    if(prof?.display_name && prof.display_name !== 'Игрок') {
      tMyName = window._currentUserName = prof.display_name;
    }
  } catch(_){}
  if(!tMyName || tMyName === 'Игрок') tMyName = 'Игрок'+(Math.floor(Math.random()*99)+1);
  tQs=[]; tIdx=0; tMyScore=0; tAnsweredThisQ=false;

  // Register participant — use user_id as key (not name)
  const myParticipant = { name: tMyName, score: 0, q_answered: -1, last_seen: Date.now() };
  if(window.fbTournJoin){
    await window.fbTournJoin(tCode, tMyUserId, myParticipant);
  } else {
    const players = room.players || {};
    players[tMyUserId] = myParticipant;
    const {error} = await sb.from('tournaments').update({players}).eq('code',tCode);
    if(error){ console.error('[T] join error:', error.message); }
  }

  document.getElementById('t-code-display').textContent = tCode;
  document.getElementById('t-link-txt').textContent = location.origin+location.pathname+'?tourn='+tCode;
  document.getElementById('t-start-btn').style.display = 'none';
  document.getElementById('t-wait-txt').style.display  = 'flex';
  showTournSection('t-waiting');
  tListenRoom();
}

function tListenRoom(){
  if(_fbTournUnsub){ _fbTournUnsub(); _fbTournUnsub=null; }
  if(tPoll){ clearInterval(tPoll); tPoll=null; }
  if(window._tRealtimeCh){ try { sb.removeChannel(window._tRealtimeCh); } catch(_){} window._tRealtimeCh=null; }

  if(window.fbTournListen){
    // Firebase realtime — primary for rooms created via Firebase
    _fbTournUnsub = window.fbTournListen(tCode, tOnRoomUpdate);
  } else {
    // Supabase Realtime broadcast — zero polling, scales to 1000+ players
    // Host broadcasts question/room state; players only receive
    const ch = sb.channel('tournament:' + tCode, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'room_update' }, ({ payload }) => {
      if (payload) tOnRoomUpdate(payload);
    });
    ch.on('postgres_changes', {
      event: 'UPDATE', schema: 'public', table: 'tournaments', filter: `code=eq.${tCode}`
    }, ({ new: row }) => { if (row) tOnRoomUpdate(row); });
    ch.subscribe();
    window._tRealtimeCh = ch;

    // One-time fetch to get current state immediately
    sb.from('tournaments').select('*').eq('code', tCode).single()
      .then(({ data }) => { if (data) tOnRoomUpdate(data); });
  }
}

function tOnRoomUpdate(room){
  if(!room) return;
  tLastRoom = room;

  const status = room.status;
  const participants = room.participants || room.players || {};

  // Update live leaderboard from server data
  tRenderLeaderboardFromRoom(participants);
  tRenderPlayerList(participants);

  // Heartbeat: update last_seen so we don't block others
  tHeartbeat();

  if(status === 'waiting'){
    // Still in lobby
    return;
  }

  if((status === 'playing' || status === 'started') && tQs.length === 0){
    // First time seeing started status — load questions
    const qs = room.questions;
    if(qs && qs.length > 0){
      tQs = qs.map(q=>({...q,
        q:     (q.q&&typeof q.q==='object') ? (q.q[lang]||q.q.ru||q.q.en||q.q) : (q.question_text||q.q),
        a:     (q.a&&typeof q.a==='object'&&!Array.isArray(q.a)) ? (q.a[lang]||q.a.ru||q.a.en||q.a) : (q.answers||q.a||[]),
        c:     (q.c !== undefined && q.c !== null) ? q.c : (q.correct !== undefined && q.correct !== null ? q.correct : null),
        img:     q.img     || q.slide_q_url  || null,
        img_a:   q.img_a   || q.slide_a_url  || null,
        audio:   q.audio   || null,
        audio_a: q.audio_a || q.answer_audio_url || null,
        video_a: q.video_a || q.answer_video_url || null,
      }));
    }
    if(tRole === 'spectator'){
      showTournSection('t-game');
      tRenderSpectatorView(room);
      return;
    }
    tBeginGame(room);
    return;
  }

  if(status === 'playing' || status === 'started'){
    // Already in game — check if question advanced on server
    const serverQIdx = room.current_question_index ?? 0;
    const serverQVer = room.question_version    ?? 0;

    if(serverQVer !== tQVersion){
      // Server moved to a new question (or same index, new version)
      tQVersion = serverQVer;
      tIdx = serverQIdx;
      if(tIdx < tQs.length){
        tLoadQFromRoom(room);
      }
    } else {
      // Same question — update answered count display
      tUpdateWaitDisplay(participants, room);
      // Apply correct index from host if we're already in answer-reveal phase
      if(_tAnswerRevealed && room.current_correct_index !== undefined
          && room.current_correct_q_idx === tIdx){
        const q = tQs[tIdx];
        if(q && (q.c === undefined || q.c === null)){
          const ci = room.current_correct_index;
          q.c = ci;
          document.querySelectorAll('#t-answers .ans').forEach((b,i)=>{
            b.disabled = true;
            if(i === ci) b.className = 'ans correct';
            else if(i === tMySelectedIdx && tMySelectedIdx !== -1) b.className = 'ans wrong';
          });
          // Now that we know correct answer, retroactively apply score & feedback
          const isCorrect = tMySelectedIdx !== -1 && tMySelectedIdx === ci;
          if(isCorrect){
            tMyScore += tMyEarnedPts;
            document.getElementById('t-my-score-display').textContent = tMyScore;
            showFb('t-fb', '✓ +'+tMyEarnedPts, true);
            tPlaySound(true);
            if(window.fbTournPatch && tMyUserId){
              window.fbTournPatch(tCode, {
                [`participants.${tMyUserId}.score`]: tMyScore,
                [`participants.${tMyUserId}.is_correct`]: true,
              }).catch(()=>{});
            }
          } else if(tMySelectedIdx !== -1){
            showFb('t-fb', '✗ '+(q.a[ci]||''), false);
            tPlaySound(false);
          } else {
            showFb('t-fb', '⏱ '+(q.a[ci]||''), false);
          }
        }
      }
    }
  }

  if(status === 'done' || status === 'finished'){
    tCleanup();
    tShowResults(participants);
  }
}

function tBeginGame(room){
  tIdx      = room.current_question_index ?? 0;
  tQVersion = room.question_version       ?? 0;
  tMyScore  = 0;
  showTournSection('t-game');
  buildDots('t-prog-dots', tRealQCount());
  tLoadQFromRoom(room);
}

function tLoadQFromRoom(room){
  if(tTimer){ clearInterval(tTimer); tTimer=null; }
  tAnsweredThisQ  = false;
  tMySelectedIdx  = -1;
  tMyEarnedPts    = 0;
  _tAdvanceLock   = false;
  _tAnswerRevealed = false;
  _tAllConfirmed   = false;
  // Hide answer-next button for new question
  const _ansBtn = document.getElementById('t-answer-next');
  if(_ansBtn){ _ansBtn.className = ''; _ansBtn.textContent = '▶ Далее'; }

  const q = tQs[tIdx];
  if(!q){ return; }

  // Use exact deadline from host (question_deadline_at); fall back to started_at + duration
  const startedAt  = room.question_started_at;
  const deadlineAt = room.question_deadline_at;
  if(deadlineAt){
    const serverMs = typeof deadlineAt === 'number' ? deadlineAt : Date.parse(deadlineAt);
    tDeadlineMs = serverToLocal(serverMs);
  } else if(startedAt){
    const serverStartMs = typeof startedAt === 'number' ? startedAt : Date.parse(startedAt);
    tDeadlineMs = serverToLocal(serverStartMs) + tSecondsForQ(q) * 1000;
  } else {
    tDeadlineMs = Date.now() + tSecondsForQ(q) * 1000;
  }

  const isInfo = q.question_type === 'info';

  const realIdx = tRealQIdx(tIdx);
  const realCount = tRealQCount();
  document.getElementById('t-cat-pill').textContent     = isInfo ? 'РАУНД' : (q.cat || '—');
  document.getElementById('t-q-counter').textContent    = isInfo ? '' : (realIdx+1) + '/' + realCount;
  // Show question text only if there's no question slide image
  const qTextEl = document.getElementById('t-q-text');
  const hasSlide = !!(q.img || q.slide_q_url);
  qTextEl.textContent = (isInfo || hasSlide) ? '' : q.q;
  document.getElementById('t-my-score-display').textContent = tMyScore;
  renderQMedia('t-media-container', q);
  document.getElementById('t-fb').className = 'fb';

  // Reset next button
  const nextBtn = document.getElementById('t-next-btn');
  nextBtn.className    = 'next-btn';
  nextBtn.textContent  = t('next');
  nextBtn.disabled     = false;
  nextBtn.style.opacity = '';

  // Info slide: show "Далее" button, advance when all clicked (or after 15s)
  const ans = document.getElementById('t-answers'); ans.innerHTML='';
  if(isInfo){
    tAnsweredThisQ = false; // will be set true when player clicks Далее
    tDeadlineMs = Date.now() + 15000;
    // Use dedicated ansBtn for reliable visibility
    const ansBtnInfo = document.getElementById('t-answer-next');
    if(ansBtnInfo){
      ansBtnInfo.className = 'visible';
      ansBtnInfo.textContent = '▶ Далее';
      ansBtnInfo.disabled = false;
      ansBtnInfo.style.opacity = '';
      ansBtnInfo.onclick = async () => {
        if(tAnsweredThisQ) return;
        tAnsweredThisQ = true;
        ansBtnInfo.disabled = true;
        ansBtnInfo.textContent = '⏳ Ждём остальных…';
        ansBtnInfo.style.opacity = '0.65';
        ansBtnInfo.onclick = null;
        await tWriteAnswer(-1);
      };
    }
    tRenderTimer();
    tTimer = setInterval(tTickFromDeadline, 250);
    return;
  }

  q.a.forEach((a,i)=>{
    const b = document.createElement('button'); b.className='ans';
    b.innerHTML = '<span class="ans-l">' + answerLetter(i) + '</span><span>' + a + '</span>';
    b.onclick = ()=>tPickAnswer(i);
    ans.appendChild(b);
  });

  if(realIdx >= 0) setDot('t-prog-dots', realIdx, 'active');
  tRenderTimer();

  // Local countdown using server deadline
  tTimer = setInterval(tTickFromDeadline, 250);
}

function tTickFromDeadline(){
  const remaining = Math.ceil((tDeadlineMs - Date.now()) / 1000);
  if(remaining <= 0){
    clearInterval(tTimer); tTimer=null;
    tLocalExpire();
    return;
  }
  const q = tQs[tIdx];
  const totalSec = tSecondsForQ(q);
  const pct = Math.min(remaining / totalSec * 100, 100);
  const fill = document.getElementById('t-timer-fill');
  if(fill){ fill.style.width=pct+'%'; fill.style.background=pct<35?'#e05555':pct<60?'#f0a050':'var(--accent)'; }
  const cd = document.getElementById('t-countdown');
  if(cd){ cd.textContent=remaining; cd.style.color=remaining<=5?'#e05555':remaining<=10?'#f0a050':'var(--accent2)'; }
  const pv = document.getElementById('t-p-val');
  if(pv && q){
    const isInfo = q.question_type === 'info';
    pv.textContent = isInfo ? '' : (tAnsweredThisQ ? '+'+tMyEarnedPts : '+'+Math.max(1, remaining));
  }
}

function tRenderTimer(){
  tTickFromDeadline();
}

function tPlaySound(correct){
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if(correct){
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else {
      osc.frequency.setValueAtTime(300, ctx.currentTime);
      osc.frequency.setValueAtTime(220, ctx.currentTime + 0.15);
    }
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
  } catch(_){}
}

function tRevealAnswer(overrideCorrect){
  if(_tAnswerRevealed) return;
  _tAnswerRevealed = true;
  const q = tQs[tIdx];
  if(!q || q.question_type === 'info') return;
  // Host broadcasts correct index to Firebase so guests can highlight the right answer
  if(tRole === 'host' && q.c !== undefined && window.fbTournPatch){
    window.fbTournPatch(tCode, { current_correct_index: q.c, current_correct_q_idx: tIdx }).catch(()=>{});
  }
  // If host sent us correct index via Firebase, use it; local q.c may be 0 (stripped)
  if(overrideCorrect !== undefined){
    q.c = overrideCorrect;
  } else if(tRole !== 'host' && (q.c === undefined || q.c === null)){
    // Try to get from last room state received before reveal
    if(tLastRoom.current_correct_q_idx === tIdx && tLastRoom.current_correct_index !== undefined){
      q.c = tLastRoom.current_correct_index;
    }
  }
  const correctKnown = q.c !== undefined && q.c !== null;
  document.querySelectorAll('#t-answers .ans').forEach((b,i)=>{
    b.disabled = true;
    if(correctKnown && i === q.c) b.className = 'ans correct';
    else if(i === tMySelectedIdx && tMySelectedIdx !== -1) b.className = 'ans wrong';
  });
  const isCorrect = tMySelectedIdx !== -1 && correctKnown && tMySelectedIdx === q.c;
  const _rd = tRealQIdx(tIdx);
  if(isCorrect){
    tMyScore += tMyEarnedPts;
    document.getElementById('t-my-score-display').textContent = tMyScore;
    showFb('t-fb', '✓ +'+tMyEarnedPts, true);
    if(_rd >= 0) setDot('t-prog-dots', _rd, 'done');
    tPlaySound(true);
    // Write score to Firebase so leaderboard reflects it immediately
    if(window.fbTournPatch && tMyUserId){
      window.fbTournPatch(tCode, {
        [`participants.${tMyUserId}.score`]: tMyScore,
        [`participants.${tMyUserId}.is_correct`]: true,
      }).catch(()=>{});
    }
  } else if(tMySelectedIdx !== -1){
    showFb('t-fb', correctKnown ? '✗ '+(q.a[q.c]||'') : '✗', false);
    if(_rd >= 0) setDot('t-prog-dots', _rd, 'miss');
    tPlaySound(false);
  } else {
    showFb('t-fb', correctKnown ? '⏱ '+(q.a[q.c]||'') : '⏱', false);
    if(_rd >= 0) setDot('t-prog-dots', _rd, 'miss');
  }
  // Switch to answer slide if available — use same renderer as question slide
  const ansSlide  = q.img_a || q.slide_a_url;
  const ansAudio  = q.audio_a || q.answer_audio_url || null;
  const ansVideo  = q.video_a || q.answer_video_url || null;
  if(ansSlide || ansAudio || ansVideo){
    // Video takes priority over slide image (image would block video rendering)
    renderQMedia('t-media-container', { ...q,
      img:   ansVideo ? null : (ansSlide || null),
      audio: ansAudio,
      video: ansVideo,
    });
    document.getElementById('t-q-text').textContent = '';
  }
  // Show dedicated answer-next button (separate from t-next-btn to avoid CSS conflicts)
  const ansBtn = document.getElementById('t-answer-next');
  if(ansBtn){
    ansBtn.className = 'visible';
    ansBtn.textContent = '▶ Далее';
    ansBtn.disabled = false;
    ansBtn.style.opacity = '';
    ansBtn.onclick = async () => {
      ansBtn.disabled = true;
      ansBtn.textContent = '⏳ Ждём остальных…';
      ansBtn.style.opacity = '0.65';
      ansBtn.onclick = null;
      if(window.fbTournPatch && tMyUserId){
        window.fbTournPatch(tCode, {
          [`participants.${tMyUserId}.a_confirmed`]: tIdx
        }).catch(()=>{});
      }
    };
    setTimeout(() => ansBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
  }
  // Countdown while answer is shown so players know game isn't frozen
  tStartAnswerCountdown(10);
}

function tStartAnswerCountdown(secs){
  if(tTimer){ clearInterval(tTimer); tTimer = null; }
  const end = Date.now() + secs * 1000;
  const fill = document.getElementById('t-timer-fill');
  const cd   = document.getElementById('t-countdown');
  if(fill){ fill.style.background = 'var(--accent)'; }
  tTimer = setInterval(() => {
    const rem = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    const pct = rem / secs * 100;
    if(fill){ fill.style.width = pct + '%'; }
    if(cd){ cd.textContent = rem; cd.style.color = 'var(--accent2)'; }
    if(rem <= 0){ clearInterval(tTimer); tTimer = null; }
  }, 250);
}

function tLocalExpire(){
  const q = tQs[tIdx];
  const isInfo = q && q.question_type === 'info';

  if(!isInfo) tRevealAnswer(); // show correct answer to everyone

  if(!tAnsweredThisQ){
    // Timed out without answering
    tAnsweredThisQ = true;
    if(!isInfo){
      tWriteAnswer(-1);
      tShowWaitingAfterAnswer();
    }
  }

  // Host always advances when deadline passes — reset lock in case earlier attempt got stuck
  if(tRole === 'host'){
    _tAdvanceLock = false;
    if(isInfo){
      // Give host 3s to see the info slide before advancing
      (window.fbTournGet ? window.fbTournGet(tCode) : Promise.resolve(null)).then(room => {
        tHostAdvanceQuestion(room || { participants: {}, participant_ids: [tMyUserId] }, 3000);
      });
    } else {
      // Read fresh room state then advance after 5s (answer already shown via tRevealAnswer)
      (window.fbTournGet ? window.fbTournGet(tCode) : Promise.resolve(null)).then(room => {
        tHostAdvanceQuestion(room || { participants: {}, participant_ids: [tMyUserId] }, 10000);
      });
    }
  }
}

async function tPickAnswer(i){
  if(tAnsweredThisQ) return;
  // Check deadline — no answer after server deadline
  if(Date.now() > tDeadlineMs + 500){ tLocalExpire(); return; }
  tAnsweredThisQ = true;
  // Keep timer running so countdown stays visible and deadline triggers advance

  const q   = tQs[tIdx];
  // Speed-based: 1 point per remaining second (30 on 1st second, 1 on 30th)
  const remaining = Math.ceil((tDeadlineMs - Date.now()) / 1000);
  tMyEarnedPts = Math.max(1, Math.min(30, remaining));
  document.querySelectorAll('#t-answers .ans').forEach(b=>b.disabled=true);

  // Mark selected only — reveal correct answer after deadline (like Kahoot)
  tMySelectedIdx = i;
  document.querySelectorAll('#t-answers .ans')[i].className='ans selected';
  showFb('t-fb', '⏳ Ждём окончания времени…', false);

  await tWriteAnswer(i); // only selected_idx — server derives correctness
  tShowWaitingAfterAnswer();
}

async function tWriteAnswer(selectedIdx){
  // Validate locally for display only — score stays locally accumulated
  // Firebase stores selected_idx; host computes correctness when advancing
  const answerData = {
    name:        tMyName,
    // score intentionally omitted — clients do not write their own score
    q_answered:  tIdx,
    q_version:   tQVersion,
    selected_idx: selectedIdx,  // -1 = timed out
    speed_pts:   selectedIdx >= 0 ? tMyEarnedPts : 0, // speed-based points (host validates correctness)
    answered_at: Date.now(),
    last_seen:   Date.now()
  };

  if(window.fbTournWriteAnswer){
    const {error} = await window.fbTournWriteAnswer(tCode, tMyUserId, tIdx, tQVersion, answerData);
    if(error) console.error('[T] writeAnswer error:', error);
  } else if(window.fbTournPatch){
    // Patch individual fields — never replace the whole participant object (would wipe score/name)
    const uid = tMyUserId;
    const patch = {
      [`participants.${uid}.name`]:         tMyName,
      [`participants.${uid}.q_answered`]:   tIdx,
      [`participants.${uid}.q_version`]:    tQVersion,
      [`participants.${uid}.selected_idx`]: selectedIdx,
      [`participants.${uid}.speed_pts`]:    selectedIdx >= 0 ? tMyEarnedPts : 0,
      [`participants.${uid}.answered_at`]:  Date.now(),
      [`participants.${uid}.last_seen`]:    Date.now(),
    };
    await window.fbTournPatch(tCode, patch).catch(e=>console.error('[T] writeAnswer patch error:', e));
  }
  // Note: no Supabase fallback — tournaments.players column does not exist
  // Host advances only via tLocalExpire (deadline) — not immediately on answer
}

function tShowWaitingAfterAnswer(){
  const nextBtn = document.getElementById('t-next-btn');
  if(!nextBtn) return;
  nextBtn.className    = 'next-btn show';
  nextBtn.disabled     = true;
  nextBtn.style.opacity = '0.65';
  const remaining = Math.max(0, Math.ceil((tDeadlineMs - Date.now()) / 1000));
  nextBtn.textContent = `⏳ Ответили 1/… · ${remaining}s`;
}

function tUpdateWaitDisplay(participants, room){
  const total    = (room.participant_ids || Object.keys(participants)).length;
  const answered = Object.values(participants).filter(p=>p.q_answered === tIdx && p.q_version === tQVersion).length;

  // Update button counter only if this player already answered
  if(tAnsweredThisQ && !_tAnswerRevealed){
    const nextBtn = document.getElementById('t-next-btn');
    const remaining = Math.max(0, Math.ceil((tDeadlineMs - Date.now()) / 1000));
    if(nextBtn && nextBtn.textContent.includes('⏳')) {
      nextBtn.textContent = `⏳ Ответили ${answered}/${total} · ${remaining}s`;
    }
  }

  // All clicked "Далее" on answer slide — advance immediately
  if(_tAnswerRevealed && !_tAllConfirmed){
    const confirmed = Object.values(participants).filter(p => (p.a_confirmed ?? -1) >= tIdx).length;
    const ansBtn = document.getElementById('t-answer-next');
    if(ansBtn && ansBtn.textContent.includes('⏳')){
      ansBtn.textContent = `⏳ Прочитали ${confirmed}/${total}`;
    }
    if(confirmed >= total && total > 0){
      _tAllConfirmed = true;
      if(tTimer){ clearInterval(tTimer); tTimer = null; }
      if(tRole === 'host'){
        (window.fbTournGet ? window.fbTournGet(tCode) : Promise.resolve(null)).then(r => {
          tHostAdvanceQuestion(r || room, 0);
        });
      }
    }
  }

  // All answered — reveal and advance regardless of whether local player answered
  if(answered >= total && total > 0 && !_tAnswerRevealed){
    if(tTimer){ clearInterval(tTimer); tTimer=null; }
    const isInfo = tQs[tIdx]?.question_type === 'info';
    if(!isInfo){
      tRevealAnswer(); // sets _tAnswerRevealed = true internally
    } else {
      _tAnswerRevealed = true;
    }
    if(tRole === 'host'){
      const delay = isInfo ? 0 : 10000;
      setTimeout(() => {
        (window.fbTournGet ? window.fbTournGet(tCode) : Promise.resolve(null)).then(r => {
          tHostAdvanceQuestion(r || room);
        });
      }, delay);
    }
  }
}

async function tMaybeAdvanceAsHost(){
  if(tRole !== 'host') return;
  if(_tAdvanceLock) return;

  let room = null;
  if(window.fbTournGet){
    room = await window.fbTournGet(tCode);
  } else {
    const {data} = await sb.from('tournaments').select('*').eq('code',tCode).single();
    room = data;
  }
  if(!room) return;

  const participants   = room.participants || room.players || {};
  // participant_ids is fixed at game start — never shrinks during a question
  // Disconnected players count as "not answered" until deadline — they don't block forever
  const participantIds = room.participant_ids || Object.keys(participants);
  const total          = Math.max(1, participantIds.length);

  // Count answers for THIS question version only
  // Host's own answer may not yet be reflected in Firebase — count locally
  const answeredCount = participantIds.filter(uid => {
    if(uid === tMyUserId && tAnsweredThisQ) return true;
    const p = participants[uid];
    return p && p.q_answered >= tIdx && p.q_version === tQVersion;
  }).length;

  const deadlinePassed = Date.now() > tDeadlineMs + 500; // 500ms grace for network

  // Advance when all answered OR deadline passed
  // Disconnected players: deadline ensures they never block forever
  if(answeredCount >= total || deadlinePassed){
    await tHostAdvanceQuestion(room, 10000);
  }
}

async function tHostAdvanceQuestion(roomArg, pauseMs = 0){
  if(_tAdvanceLock) return;
  _tAdvanceLock = true;
  let room = roomArg;

  const expectedVersion = tQVersion; // CAS guard
  const nextIdx     = tIdx + 1;
  const isLast      = nextIdx >= tQs.length;
  const nextQ       = tQs[nextIdx];
  const deadlineSec = nextQ ? tSecondsForQ(nextQ) : 0;
  const newVersion  = expectedVersion + 1;

  // Wait before advancing (caller controls duration)
  if(pauseMs > 0) await new Promise(r=>setTimeout(r, pauseMs));

  // Compute server time AFTER the pause so question_started_at is accurate for guests
  const serverNow   = localToServer(Date.now());
  const newDeadline = serverNow + deadlineSec * 1000;

  // Re-read room for fresh participant data (answers may have arrived during the pause)
  if(window.fbTournGet){
    const freshRoom = await window.fbTournGet(tCode).catch(()=>null);
    if(freshRoom) room = freshRoom;
  }

  // Compute scores for this question — speed-based (1pt per remaining second)
  const participants = room.participants || room.players || {};
  const currentQ = tQs[tIdx];
  if(currentQ && currentQ.c !== undefined && currentQ.question_type !== 'info'){
    const correctIdx = currentQ.c;
    const scoreUpdates = {};
    Object.entries(participants).forEach(([uid, p])=>{
      if(p.q_answered === tIdx && p.selected_idx === correctIdx){
        const pts = Math.max(1, Math.min(30, p.speed_pts || 1));
        const newScore = (p.score||0) + pts;
        scoreUpdates[`participants.${uid}.score`] = newScore;
        scoreUpdates[`participants.${uid}.is_correct`] = true;
      }
    });
    if(Object.keys(scoreUpdates).length > 0 && window.fbTournPatch){
      await window.fbTournPatch(tCode, scoreUpdates).catch(e=>console.error('[T] score patch:', e));
    }
  }

  const updateData = isLast
    ? { status: 'done',    current_question_index: nextIdx, question_version: newVersion }
    : { status: 'playing', current_question_index: nextIdx, question_version: newVersion,
        question_started_at: serverNow, question_deadline_at: newDeadline };

  if(window.fbTournAdvance){
    // Preferred: Firebase callable that does CAS on question_version
    // Returns { ok, alreadyAdvanced, error }
    const result = await window.fbTournAdvance(tCode, expectedVersion, updateData).catch(e=>({error:e.message}));
    if(result?.alreadyAdvanced){ _tAdvanceLock=false; return; } // another tab won
    if(result?.error){ console.error('[T] advance error:', result.error); _tAdvanceLock=false; return; }
  } else if(window.fbTournUpdateConditional){
    // Conditional write: only applies if question_version === expectedVersion
    const {ok, error} = await window.fbTournUpdateConditional(tCode, expectedVersion, updateData);
    if(!ok){ _tAdvanceLock=false; return; } // version mismatch — already advanced
    if(error){ console.error('[T] advance conditional error:', error); _tAdvanceLock=false; return; }
  } else if(window.fbTournUpdate){
    // Fallback: plain Firebase update (no CAS, sufficient for single-host rooms)
    const res = await window.fbTournUpdate(tCode, updateData);
    if(res?.error){ console.error('[T] advance FB error:', res.error); _tAdvanceLock=false; return; }
  } else {
    // Supabase fallback (status + question_version only — no current_question_index)
    const sbData = isLast
      ? { status: 'done', question_version: newVersion }
      : { status: 'playing', question_version: newVersion };
    const { error } = await sb.from('tournaments').update(sbData).eq('code', tCode);
    if(error){ console.error('[T] advance SB error:', error.message); _tAdvanceLock=false; return; }

    // Broadcast new state to all subscribers via Realtime (zero polling)
    if(window._tRealtimeCh){
      window._tRealtimeCh.send({
        type: 'broadcast', event: 'room_update',
        payload: { ...updateData, code: tCode, question_version: newVersion },
      }).catch(()=>{});
    }
  }
  // _tAdvanceLock released when tOnRoomUpdate fires with new question_version
}

function tHeartbeat(){
  if(!tMyUserId || !tCode) return;
  if(_tHeartbeatTimer) return; // already running
  _tHeartbeatTimer = setInterval(async()=>{
    if(!tCode){ clearInterval(_tHeartbeatTimer); _tHeartbeatTimer=null; return; }
    const hb = { [`participants.${tMyUserId}.last_seen`]: Date.now() };
    if(window.fbTournPatch){
      window.fbTournPatch(tCode, hb).catch(()=>{});
    }
  }, 8000);
}

function tRenderSpectatorView(room){
  const q = tQs[room.current_question_index] || tQs[0];
  if(!q) return;
  document.getElementById('t-q-text').textContent = q.q;
  const _sRi = tRealQIdx(room.current_question_index);
  document.getElementById('t-q-counter').textContent =
    _sRi >= 0 ? (_sRi+1) + '/' + tRealQCount() : '';
  document.querySelectorAll('#t-answers .ans').forEach((b,i)=>{
    b.disabled = true; b.style.opacity='0.5';
  });
  const nextBtn = document.getElementById('t-next-btn');
  if(nextBtn){ nextBtn.style.display='none'; }
}

async function tLoadPackOptions(){
  try{
    const {data} = await sb.from('game_packs').select('id,title_ru,import_key,status').order('title_ru');
    const sel = document.getElementById('t-pack-select');
    if(!sel || !data) return;
    // Remove existing dynamic options
    Array.from(sel.options).forEach(o=>{ if(o.value) o.remove(); });
    data.forEach(p=>{
      const opt = document.createElement('option');
      opt.value = p.id;
      const statusTag = p.status === 'published' ? '' : ' [черновик]';
      opt.textContent = (p.title_ru || p.import_key || p.id) + statusTag;
      sel.appendChild(opt);
    });
  } catch(e){ console.error('tLoadPackOptions', e); }
}

async function startTournament(){
  let questions = [];
  const packId = _tPreselectedPackId || document.getElementById('t-pack-select')?.value;
  try{
    if(packId){
      const {data: pqs, error} = await sb.from('game_pack_questions')
        .select('position, questions(question_text,question_ru,answers_json,answers_ru,correct_index,audio_url,video_url,answer_audio_url,answer_video_url,question_type,slide_img_url,answer_slide_img_url,image_url)')
        .eq('game_pack_id', packId).order('position',{ascending:true});
      if(error) throw error;
      if(pqs && pqs.length > 0){
        questions = pqs
          .map(pq=>{
            const q = pq.questions;
            if(!q) return null;
            const a = q.answers_ru || q.answers_json || [];
            const timeMap = {2:30,3:35,4:40,5:45,6:50};
            const isInfo = q.question_type === 'info';
            return {
              cat:           isInfo ? 'info' : 'Турнир',
              question_type: q.question_type,
              q:   {ru: q.question_ru || q.question_text || ''},
              a:   {ru: isInfo ? [] : a},
              c:   isInfo ? 0 : (q.correct_index ?? 0),
              t:   isInfo ? 15 : 30,
              img:     q.slide_img_url || q.image_url,
              img_a:   q.answer_slide_img_url || null,
              audio:   q.audio_url,
              video:   q.video_url,
              audio_a: q.answer_audio_url || null,
              video_a: q.answer_video_url || null,
            };
          }).filter(Boolean);
        toast('✅ Загружено ' + questions.length + ' вопросов из пака');
      }
    }
    if(!questions.length){
      const {data: tqs, error} = await sb.from('tournament_questions')
        .select('*').eq('active',true).order('position',{ascending:true});
      if(!error && tqs && tqs.length > 0){
        const shuffled = [...tqs].sort(()=>Math.random()-.5).slice(0,30);
        questions = shuffled.map(q=>({
          cat: q.cat || 'Турнир',
          q:   {ru: q.question_ru||q.q, en: q.question_en||q.q},
          a:   {ru: q.answers_ru||q.a,  en: q.answers_en||q.a},
          c:   q.correct_index ?? q.c ?? 0,
          t:   q.time_seconds || (((q.answers_ru||q.a||[]).length)*10) || 30
        }));
        toast('✅ Загружено ' + questions.length + ' вопросов');
      } else {
        const raw = [...ALL_Q].sort(()=>Math.random()-.5).slice(0,30);
        questions = raw.map(q=>({cat:q.cat, q:q.q, a:q.a, c:q.c, t:q.t}));
        toast('⚠️ Используем общую базу');
      }
    }
  } catch(e){
    const raw = [...ALL_Q].sort(()=>Math.random()-.5).slice(0,30);
    questions = raw.map(q=>({cat:q.cat, q:q.q, a:q.a, c:q.c, t:q.t}));
  }

  if(!questions.length){ toast('Нет вопросов для турнира'); return; }

  // Snapshot current participants as official participant_ids
  let participantIds = [tMyUserId];
  if(window.fbTournGet){
    const room = await window.fbTournGet(tCode);
    if(room){
      participantIds = Object.keys(room.participants || room.players || {});
      if(!participantIds.includes(tMyUserId)) participantIds.unshift(tMyUserId);
    }
  }

  const firstQ      = questions[0];
  const deadlineSec = tSecondsForQ(firstQ);
  const nowMs       = Date.now();
  // Strip correct answers before putting questions in Firebase (public room)
  // correct index (q.c) stays only in host's local tQs
  const questionsPublic = questions.map(({c, ...rest}) => rest); // omit c

  const startData   = {
    status:                  'playing',
    questions:               questionsPublic, // NO correct answers in public room
    participant_ids:         participantIds,
    current_question_index:  0,
    question_version:        1,
    question_started_at:     nowMs,
    question_deadline_at:    nowMs + deadlineSec * 1000 + 3000
  };

  if(window.fbTournUpdate){
    const res = await window.fbTournUpdate(tCode, startData);
    const error = res?.error;
    if(error){ toast('Ошибка старта: ' + error); return; }
  } else {
    const {error} = await sb.from('tournaments').update({
      status:'started', questions: questionsPublic, players:{}
    }).eq('code',tCode);
    if(error){ toast('Ошибка старта: ' + error.message); return; }
  }

  // Host keeps full questions (with correct answers) locally only
  // Guests receive questionsPublic (without q.c) and validate visually only
  tQs       = questions.map(q=>({...q,
    q:       (q.q&&typeof q.q==='object')?(q.q[lang]||q.q.ru||q.q.en):(q.question_text||q.q),
    a:       (q.a&&typeof q.a==='object'&&!Array.isArray(q.a))?(q.a[lang]||q.a.ru||q.a.en):(q.answers||q.a||[]),
    c:       q.c ?? q.correct ?? 0,
    img:     q.img || q.slide_q_url || null,
    img_a:   q.img_a || q.slide_a_url || null,
    audio:   q.audio || null,
    video:   q.video || null,
    audio_a: q.audio_a || q.answer_audio_url || null,
    video_a: q.video_a || q.answer_video_url || null,
  }));
  tIdx      = 0;
  tQVersion = 1;
  tDeadlineMs = startData.question_deadline_at;
  showTournSection('t-game');
  buildDots('t-prog-dots', tRealQCount());
  tLoadQFromRoom(startData);
}

function tRenderPlayerList(participants){
  const el = document.getElementById('t-players-list'); if(!el) return;
  const entries = Object.entries(participants).map(([uid,p])=>({...p,_uid:uid}));
  document.getElementById('t-player-count').textContent = entries.length + '/50';
  el.innerHTML = entries.map(p=>{
    const isMe = p._uid === tMyUserId;
    const displayName = isMe ? (tMyName || p.name || 'Игрок') : (p.name || 'Игрок');
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-av" style="background:rgba(0,237,181,.15);color:var(--accent2)">${_esc((displayName||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(displayName)}</div>
      <div class="lb-score">${p.score||0}</div>
    </div>`;
  }).join('');
}

function tRenderLeaderboardFromRoom(participants){
  const el = document.getElementById('t-live-lb'); if(!el) return;
  const sorted = Object.entries(participants)
    .map(([uid,p])=>({...p,_uid:uid}))
    .sort((a,b)=>(b.score||0)-(a.score||0));
  const medals = ['🥇','🥈','🥉'];
  el.innerHTML = sorted.map((p,i)=>{
    const isMe = p._uid === tMyUserId;
    const displayName = isMe ? (tMyName || p.name || 'Игрок') : (p.name || 'Игрок');
    const displayScore = p.score || 0;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank">${medals[i]||i+1}</div>
      <div class="lb-av" style="background:rgba(0,237,181,.15);color:var(--accent2)">${_esc((displayName||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(displayName)}</div>
      <div class="lb-score${isMe?' me':''}">${displayScore}</div>
    </div>`;
  }).join('');
}

function tShowResults(participants){
  tCleanup();
  if(_tHeartbeatTimer){ clearInterval(_tHeartbeatTimer); _tHeartbeatTimer=null; }
  const sorted = Object.entries(participants)
    .map(([uid,p])=>({...p,_uid:uid}))
    .sort((a,b)=>(b.score||0)-(a.score||0));
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('t-final-lb').innerHTML = sorted.map((p,i)=>{
    const isMe = p._uid === tMyUserId;
    const displayName = isMe ? (tMyName || p.name || 'Игрок') : (p.name || 'Игрок');
    const displayScore = p.score || 0;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank">${medals[i]||i+1}</div>
      <div class="lb-av" style="background:rgba(0,237,181,.15);color:var(--accent2)">${_esc((displayName||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(displayName)}</div>
      <div class="lb-score${isMe?' me':''}">${displayScore}</div>
    </div>`;
  }).join('');

  const myEntry = sorted.find(p=>p._uid===tMyUserId);
  if(myEntry){
    const myPlace = sorted.indexOf(myEntry)+1;
    const _tc = JSON.parse(localStorage.getItem('mfc_club_fb')||'null');
    const placeStr = (medals[myPlace-1]||'#'+myPlace) + ' место';
    document.getElementById('t-sc-place').textContent = placeStr;
    document.getElementById('t-sc-score').textContent = myEntry.score + ' очков';
    document.getElementById('t-sc-club').textContent  = _tc ? '🏟️ ' + _tc.name : '';
    window._lastTournShare = { place:myPlace, pts:myEntry.score, club:_tc?.name||null, placeStr };
    // Award tournament neurons via server RPC
    if(myPlace <= 3 && currentUser){
      awardNeurons(myPlace===1?150:myPlace===2?80:50, 'tournament_reward',
        'tourn:' + tCode + ':' + currentUser.id);
    }
  }
  showTournSection('t-results');
}

function resetTournament(){
  tCleanup();
  if(_tHeartbeatTimer){ clearInterval(_tHeartbeatTimer); _tHeartbeatTimer=null; }
  tCode=null; tRole=null; tMyUserId=null;
  tQs=[]; tIdx=0; tMyScore=0; tAnsweredThisQ=false;
  document.getElementById('t-join-code').value='';
  showTournSection('t-lobby');
}


// [resetTournament duplicate removed]


// ── window exports ────────────────────────────────────────────────
Object.defineProperty(window, '_tPreselectedPackId', {
  get(){ return _tPreselectedPackId; },
  set(v){ _tPreselectedPackId = v; },
  configurable: true
});
window.createTournament = createTournament;
window.joinTournament   = joinTournament;
window.startTournament  = startTournament;
window.resetTournament  = resetTournament;
window.tPickAnswer      = tPickAnswer;
window.showTournSection = showTournSection;

// ── Window exports ────────────────────────────────────────────────
window.estimateServerTimeOffset    = estimateServerTimeOffset;
window.showTournSection            = showTournSection;
window.tCleanup                    = tCleanup;
window.createTournament            = createTournament;
window.joinTournament              = joinTournament;
window.tListenRoom                 = tListenRoom;
window.tOnRoomUpdate               = tOnRoomUpdate;
window.tBeginGame                  = tBeginGame;
window.tLoadQFromRoom              = tLoadQFromRoom;
window.tTickFromDeadline           = tTickFromDeadline;
window.tRenderTimer                = tRenderTimer;
window.tLocalExpire                = tLocalExpire;
window.tPickAnswer                 = tPickAnswer;
window.tWriteAnswer                = tWriteAnswer;
window.tShowWaitingAfterAnswer     = tShowWaitingAfterAnswer;
window.tUpdateWaitDisplay          = tUpdateWaitDisplay;
window.tMaybeAdvanceAsHost         = tMaybeAdvanceAsHost;
window.tHostAdvanceQuestion        = tHostAdvanceQuestion;
window.tHeartbeat                  = tHeartbeat;
window.tRenderSpectatorView        = tRenderSpectatorView;
window.startTournament             = startTournament;
window.tRenderPlayerList           = tRenderPlayerList;
window.tRenderLeaderboardFromRoom  = tRenderLeaderboardFromRoom;
window.tShowResults                = tShowResults;
window.resetTournament             = resetTournament;
