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
let tTimer      = null;
let tDeadlineMs = 0;
let tQVersion   = 0;
let _fbTournUnsub = null;
let tPoll       = null;
let _tAdvanceLock = false;
let _tServerTimeOffset = 0;
let _tHeartbeatTimer = null;

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

function tSecondsForQ(q){ return (q && q.a ? Math.min(q.a.length, 6) : 2) * 10; }

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
  _tAdvanceLock = false;
}

async function createTournament(){
  // Guard: require safe atomic advance capability
  if (!window.fbTournAdvance && !window.fbTournUpdateConditional) {
    window.toast?.('Синхронный сервер турниров недоступен. Обратитесь к администратору.');
    console.error('[T] Cannot start tournament: fbTournAdvance or fbTournUpdateConditional required');
    return;
  }
  tCleanup();
  if(!currentUser){ toast('🔐 Войдите для участия в турнире'); showScreen('auth'); return; }
  tCode    = randCode();
  tRole    = 'host';
  tMyUserId = currentUser.id; // must be real auth.uid() — no guest IDs
  tMyName  = currentUser?.user_metadata?.full_name?.split(' ')[0]
             || localStorage.getItem('mfc_display_name') || 'Хост';
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

  document.getElementById('t-code-display').textContent = tCode;
  document.getElementById('t-link-txt').textContent = location.origin+location.pathname+'?tourn='+tCode;
  document.getElementById('t-start-btn').style.display = 'block';
  document.getElementById('t-wait-txt').style.display  = 'none';
  showTournSection('t-waiting');
  tListenRoom();
  checkBadges('tourn'); renderBadges();
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
  tMyName   = currentUser?.user_metadata?.full_name?.split(' ')[0]
              || localStorage.getItem('mfc_display_name') || 'Игрок'+(Math.floor(Math.random()*99)+1);
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

  if(window.fbTournListen){
    _fbTournUnsub = window.fbTournListen(tCode, tOnRoomUpdate);
  } else {
    // Supabase polling fallback
    tPoll = setInterval(async()=>{
      const {data, error} = await sb.from('tournaments').select('*').eq('code',tCode).single();
      if(error || !data) return;
      tOnRoomUpdate(data);
    }, 2000);
  }
}

function tOnRoomUpdate(room){
  if(!room) return;

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
        q: (q.q&&typeof q.q==='object') ? (q.q[lang]||q.q.ru||q.q.en||q.q) : q.q,
        a: (q.a&&typeof q.a==='object'&&!Array.isArray(q.a)) ? (q.a[lang]||q.a.ru||q.a.en||q.a) : q.a
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
  buildDots('t-prog-dots', tQs.length);
  tLoadQFromRoom(room);
}

function tLoadQFromRoom(room){
  if(tTimer){ clearInterval(tTimer); tTimer=null; }
  tAnsweredThisQ = false;
  _tAdvanceLock  = false;

  const q = tQs[tIdx];
  if(!q){ return; }

  // Compute deadline from server timestamp, adjusted for local clock skew
  const deadlineAt = room.question_deadline_at;   // Unix ms from server
  if(deadlineAt){
    const serverMs = typeof deadlineAt === 'number' ? deadlineAt : Date.parse(deadlineAt);
    tDeadlineMs = serverToLocal(serverMs); // convert server time to local clock
  } else {
    // Fallback: local time + expected duration
    tDeadlineMs = Date.now() + tSecondsForQ(q) * 1000;
  }

  document.getElementById('t-cat-pill').textContent     = q.cat || '—';
  document.getElementById('t-q-counter').textContent    = (tIdx+1) + '/' + tQs.length;
  document.getElementById('t-q-text').textContent       = q.q;
  document.getElementById('t-my-score-display').textContent = tMyScore;
  renderQMedia('t-media-container', q);
  document.getElementById('t-fb').className = 'fb';

  // Reset next button
  const nextBtn = document.getElementById('t-next-btn');
  nextBtn.className    = 'next-btn';
  nextBtn.textContent  = t('next');
  nextBtn.disabled     = false;
  nextBtn.style.opacity = '';

  // Render answers
  const ans = document.getElementById('t-answers'); ans.innerHTML='';
  q.a.forEach((a,i)=>{
    const b = document.createElement('button'); b.className='ans';
    b.innerHTML = '<span class="ans-l">' + answerLetter(i) + '</span><span>' + a + '</span>';
    b.onclick = ()=>tPickAnswer(i);
    ans.appendChild(b);
  });

  setDot('t-prog-dots', tIdx, 'active');
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
  if(fill){ fill.style.width=pct+'%'; fill.style.background=pct<35?'#e05555':pct<60?'#f0a050':'#6c63ff'; }
  const tv = document.getElementById('t-t-val');
  if(tv){ tv.textContent=remaining+'s'; tv.style.color=remaining<=5?'#e05555':remaining<=10?'#f0a050':'#8b83ff'; }
  const pv = document.getElementById('t-p-val');
  if(pv && q){ pv.textContent = '+' + getFixedPoints(q.a.length); }
}

function tRenderTimer(){
  tTickFromDeadline();
}

function tLocalExpire(){
  if(tAnsweredThisQ) return;
  tAnsweredThisQ = true;
  const q = tQs[tIdx];
  document.querySelectorAll('#t-answers .ans').forEach((b,i)=>{
    b.disabled=true; if(i===q.c) b.className='ans correct';
  });
  showFb('t-fb','⏱ '+q.a[q.c], false);
  setDot('t-prog-dots', tIdx, 'miss');
  tWriteAnswer(-1); // timed out — correctness computed server-side
  tShowWaitingAfterAnswer();
}

async function tPickAnswer(i){
  if(tAnsweredThisQ) return;
  // Check deadline — no answer after server deadline
  if(Date.now() > tDeadlineMs + 500){ tLocalExpire(); return; }
  tAnsweredThisQ = true;
  if(tTimer){ clearInterval(tTimer); tTimer=null; }

  const q   = tQs[tIdx];
  const pts = getFixedPoints(q.a.length);
  document.querySelectorAll('#t-answers .ans').forEach(b=>b.disabled=true);

  if(i === q.c){
    document.querySelectorAll('#t-answers .ans')[i].className='ans correct';
    tMyScore += pts;
    document.getElementById('t-my-score-display').textContent = tMyScore;
    showFb('t-fb', '✓ +'+pts, true);
    setDot('t-prog-dots', tIdx, 'done');
  } else {
    document.querySelectorAll('#t-answers .ans')[i].className='ans wrong';
    document.querySelectorAll('#t-answers .ans')[q.c].className='ans correct';
    showFb('t-fb', '✗ '+q.a[q.c], false);
    setDot('t-prog-dots', tIdx, 'miss');
  }

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
    answered_at: Date.now(),
    last_seen:   Date.now()
    // NOTE: is_correct and points intentionally omitted — not trusted from client
  };

  if(window.fbTournWriteAnswer){
    const {error} = await window.fbTournWriteAnswer(tCode, tMyUserId, tIdx, tQVersion, answerData);
    if(error) console.error('[T] writeAnswer error:', error);
  } else {
    // Supabase fallback: note this fallback is limited (see fix #8 notes)
    const {data: room, error: rErr} = await sb.from('tournaments').select('players').eq('code',tCode).single();
    if(rErr){ console.error('[T] fetchRoom error:', rErr.message); return; }
    const players = room?.players || {};
    players[tMyUserId] = answerData;
    const {error: uErr} = await sb.from('tournaments').update({players}).eq('code',tCode);
    if(uErr) console.error('[T] updateAnswer error:', uErr.message);
  }

  if(tRole === 'host'){
    tMaybeAdvanceAsHost();
  }
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
  if(!tAnsweredThisQ) return; // still thinking — don't update button
  const nextBtn = document.getElementById('t-next-btn');
  if(!nextBtn) return;
  const total    = (room.participant_ids || Object.keys(participants)).length;
  const answered = Object.values(participants).filter(p=>p.q_answered >= tIdx).length;
  const remaining = Math.max(0, Math.ceil((tDeadlineMs - Date.now()) / 1000));
  nextBtn.textContent = `⏳ Ответили ${answered}/${total} · ${remaining}s`;
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
  const answeredCount = participantIds.filter(uid => {
    const p = participants[uid];
    return p && p.q_answered >= tIdx && p.q_version === tQVersion;
  }).length;

  const deadlinePassed = Date.now() > tDeadlineMs + 500; // 500ms grace for network

  // Advance when all answered OR deadline passed
  // Disconnected players: deadline ensures they never block forever
  if(answeredCount >= total || deadlinePassed){
    await tHostAdvanceQuestion(room);
  }
}

async function tHostAdvanceQuestion(room){
  if(_tAdvanceLock) return;
  _tAdvanceLock = true;

  const expectedVersion = tQVersion; // CAS guard
  const nextIdx     = tIdx + 1;
  const isLast      = nextIdx >= tQs.length;
  const nextQ       = tQs[nextIdx];
  const deadlineSec = nextQ ? tSecondsForQ(nextQ) : 0;
  const serverNow   = localToServer(Date.now());
  const newDeadline = serverNow + deadlineSec * 1000 + 1500;
  const newVersion  = expectedVersion + 1;

  // Short pause so everyone sees correct answer
  await new Promise(r=>setTimeout(r, 2500));

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
  } else {
    // No safe conditional advance available.
    // fbTournAdvance (Cloud Function) or fbTournUpdateConditional required.
    // Using plain fbTournUpdate without CAS is REMOVED — it causes double-advance.
    console.error('[T] Tournament cannot advance: deploy Firebase CF fbTournAdvance first.');
    window.toast?.('Синхронный сервер турниров недоступен. Разверните Firebase CF.');
    _tAdvanceLock = false;
    return;
  }
  if (false) { // dead branch — remove in next refactor
  } else {
    // Supabase fallback with conditional: only update if version matches
    const {error} = await sb.from('tournaments')
      .update({ status: updateData.status })
      .eq('code', tCode)
      .eq('question_version', expectedVersion); // won't write if version already changed
    if(error){ console.error('[T] advance SB error:', error.message); _tAdvanceLock=false; return; }
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
  document.getElementById('t-q-counter').textContent =
    (room.current_question_index+1) + '/' + tQs.length;
  document.querySelectorAll('#t-answers .ans').forEach((b,i)=>{
    b.disabled = true; b.style.opacity='0.5';
  });
  const nextBtn = document.getElementById('t-next-btn');
  if(nextBtn){ nextBtn.style.display='none'; }
}

async function startTournament(){
  let questions = [];
  try{
    const {data: tqs, error} = await sb.from('tournament_questions')
      .select('*').eq('active',true).order('position',{ascending:true});
    if(error) throw error;
    if(tqs && tqs.length > 0){
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
    question_deadline_at:    nowMs + deadlineSec * 1000 + 1500
  };

  if(window.fbTournUpdate){
    const {error} = await window.fbTournUpdate(tCode, startData);
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
    q: (q.q&&typeof q.q==='object')?(q.q[lang]||q.q.ru||q.q.en):q.q,
    a: (q.a&&typeof q.a==='object'&&!Array.isArray(q.a))?(q.a[lang]||q.a.ru||q.a.en):q.a
  }));
  tIdx      = 0;
  tQVersion = 1;
  tDeadlineMs = startData.question_deadline_at;
  showTournSection('t-game');
  buildDots('t-prog-dots', tQs.length);
  tLoadQFromRoom(startData);
}

function tRenderPlayerList(participants){
  const el = document.getElementById('t-players-list'); if(!el) return;
  const entries = Object.values(participants);
  document.getElementById('t-player-count').textContent = entries.length + '/50';
  el.innerHTML = entries.map(p=>{
    const isMe = p.name === tMyName;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">${_esc((p.name||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(p.name||'Игрок')}</div>
      <div class="lb-score">${p.score||0}</div>
    </div>`;
  }).join('');
}

function tRenderLeaderboardFromRoom(participants){
  const el = document.getElementById('t-live-lb'); if(!el) return;
  const sorted = Object.values(participants).sort((a,b)=>(b.score||0)-(a.score||0));
  const medals = ['🥇','🥈','🥉'];
  el.innerHTML = sorted.map((p,i)=>{
    const isMe = p.name === tMyName;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank">${medals[i]||i+1}</div>
      <div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">${_esc((p.name||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(p.name||'Игрок')}</div>
      <div class="lb-score${isMe?' me':''}">${p.score||0}</div>
    </div>`;
  }).join('');
}

function tShowResults(participants){
  tCleanup();
  if(_tHeartbeatTimer){ clearInterval(_tHeartbeatTimer); _tHeartbeatTimer=null; }
  const sorted = Object.values(participants).sort((a,b)=>(b.score||0)-(a.score||0));
  const medals = ['🥇','🥈','🥉'];
  document.getElementById('t-final-lb').innerHTML = sorted.map((p,i)=>{
    const isMe = p.name === tMyName;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank">${medals[i]||i+1}</div>
      <div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">${_esc((p.name||'?')[0].toUpperCase())}</div>
      <div class="lb-name">${_esc(p.name||'Игрок')}</div>
      <div class="lb-score${isMe?' me':''}">${p.score||0}</div>
    </div>`;
  }).join('');

  const myEntry = sorted.find(p=>p.name===tMyName);
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
