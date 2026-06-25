import { getState, setState } from '../state.js';
import { awardCurrency, spendNeurons, updNeurons } from '../economy/wallet.js';
import { track } from '../services/analytics.js';

// ── Friend Battle (Duel) ─────────────────────────────────────────
// 1v1 real-time duel: create room, join by code, 5 questions (BATTLE_QUESTION_PROGRESSION).
// Shares battle limit counter with matchmaking and bot opponents
// (PLAN_LIMITS.free.battlesPerDay = 3, premium = 15).
// Tournaments are NOT counted in this limit.
// Social bonus: one incoming challenge from a new opponent/day
// is allowed above the limit for virality — no reward farming.

// DUEL — clean rewrite
// ═══════════════════════════════════════════
let duelCode=null,duelRole=null,duelPoll=null;
let duelQs=[],duelIdx=0,duelMyScore=0,duelOppScore=0;
let duelAnswered=false,duelTimer=null,duelTimeLeft=0,duelMaxT=0;
let duelMyName='You',duelOppNameStr='Соперник';
let botAnsweredThisQuestion = false; // per-question flag; reset in loadDuelQ

// Simulate bot answer independently of whether the player has answered.
// Uses qIndex to ignore stale timeouts that fired after "Next" was pressed.
function simulateBotAnswer(q, qIndex){
  if(!window._isBotDuel) return;
  const bot   = window._botPlayer;
  const skill = (bot && typeof bot.skill === 'number') ? bot.skill : 0.65;
  const delay = 2000 + Math.random() * 6000; // 2–8 s
  if(window._botAnswerTimeout) clearTimeout(window._botAnswerTimeout);
  window._botAnswerTimeout = setTimeout(()=>{
    // Guards: wrong question, already answered by bot, duel no longer active
    if(!window._isBotDuel)              return;
    if(qIndex !== duelIdx)              return; // player already moved to next Q
    if(botAnsweredThisQuestion)         return;
    botAnsweredThisQuestion = true;
    const correct = Math.random() < skill;
    if(correct){
      duelOppScore += getFixedPoints(q.a.length);
      updateDuelScores();
    }
    const hint = document.getElementById('opp-hint');
    if(hint){
      hint.textContent = correct
        ? (lang==='ru' ? '✓ Бот ответил правильно' : '✓ Bot answered correctly')
        : (lang==='ru' ? '✗ Бот ошибся'            : '✗ Bot missed');
      hint.className = 'opp-hint answered';
    }
  }, delay);
}

function showDuelSection(id){
  document.querySelectorAll('.duel-section').forEach(s=>s.classList.toggle('active',s.id===id));
}

async function createDuel(){

  duelCode=randCode();duelRole='host';
  duelMyName=currentUser?.user_metadata?.full_name?.split(' ')[0]||'Хост';
  duelMyScore=0;duelOppScore=0;duelQs=[];duelIdx=0;

  await sb.from('duel_rooms').upsert({code:duelCode,host_score:0,guest_score:0,status:'waiting',questions:null,created_at:new Date().toISOString()});
  track('duel_created', {code: duelCode});
  // NOTE: integrity starts in startDuelBattle(), not here (user needs to share invite link)

  document.getElementById('d-code-display').textContent=duelCode;
  const link=location.origin+location.pathname+'?duel='+duelCode;
  document.getElementById('d-link-txt').textContent=link;
  document.getElementById('d-me-name').textContent=duelMyName;
  document.getElementById('d-start-btn').style.display='none';
  document.getElementById('d-wait-txt').style.display='flex';

  showDuelSection('d-waiting');
  startDuelPoll();
  checkBadges('duel');renderBadges();
}

async function joinDuel(){

  const code=document.getElementById('join-code-input').value.trim().toUpperCase();
  if(code.length!==6){toast('Enter 6-letter code');return;}
  const {data,error}=await sb.from('duel_rooms').select('*').eq('code',code).single();
  if(error||!data){toast('Room not found');return;}
  if(data.status==='started'){toast('Game already started');return;}

  duelCode=code;duelRole='guest';
  duelMyName=currentUser?.user_metadata?.full_name?.split(' ')[0]||'Guest'+(Math.floor(Math.random()*99)+1);
  duelMyScore=0;duelOppScore=0;duelQs=[];duelIdx=0;

  await sb.from('duel_rooms').update({status:'ready'}).eq('code',code);
  track('duel_joined', {code});

  document.getElementById('d-code-display').textContent=code;
  const link=location.origin+location.pathname+'?duel='+code;
  document.getElementById('d-link-txt').textContent=link;
  document.getElementById('d-me-name').textContent=duelMyName;
  document.getElementById('opp-name-wait').textContent='Host';
  document.getElementById('opp-status-wait').textContent=t('dReady');
  document.getElementById('opp-status-wait').className='p-st ok';
  document.getElementById('opp-pulse').style.display='none';
  document.getElementById('d-start-btn').style.display='none';
  document.getElementById('d-wait-txt').style.display='flex';

  showDuelSection('d-waiting');
  startDuelPoll();
}

function startDuelPoll(){
  if(duelPoll)clearInterval(duelPoll);
  duelPoll=setInterval(async()=>{
    const {data}=await sb.from('duel_rooms').select('*').eq('code',duelCode).single();
    if(!data)return;
    // Host sees guest joined
    if(duelRole==='host'&&data.status==='ready'){
      document.getElementById('opp-name-wait').textContent='Соперник';
      document.getElementById('opp-status-wait').textContent=t('dReady');
      document.getElementById('opp-status-wait').className='p-st ok';
      document.getElementById('opp-pulse').style.display='none';
      document.getElementById('d-start-btn').style.display='block';
      document.getElementById('d-wait-txt').style.display='none';
    }
    // Guest sees game started — load questions from DB
    if(duelRole==='guest'&&data.status==='started'&&duelQs.length===0){
      const qs=data.questions;
      if(qs&&qs.length>0){
        // Map stored questions to current language
        duelQs = qs.map(q => ({ ...q })); // canonical from host, no remapping
        console.log('[BFC friend battle loaded]', { count: duelQs.length, first: duelQs[0] });
        clearInterval(duelPoll);
        startDuelBattle();
      }
    }
    // Update opponent score
    if(data.status==='started'||data.status==='done'){
      const oppScore=duelRole==='host'?data.guest_score:data.host_score;
      if(oppScore!==undefined){duelOppScore=oppScore;updateDuelScores();}
    }
    if(data.status==='done'&&duelQs.length>0){
      clearInterval(duelPoll);
      setTimeout(()=>endDuel(data),500);
    }
  },2000);
}

async function startDuelGame(){
  // HOST builds canonical 5-question battle [2,3,4,5,6] options
  // loadBattleQuestions queries DB by answer count — returns plain {cat,q,a,c,t}
  let questions = null;
  if (typeof window.loadBattleQuestions === 'function') {
    questions = await window.loadBattleQuestions(lang);
  }

  console.log('[BFC friend battle canonical]', {
    selected: questions?.length,
    optCounts: questions?.map(q => q.a.length),
    first: questions?.[0],
  });

  if (!questions || questions.length < 5) {
    window.toast?.(lang === 'ru'
      ? '⚠️ Недостаточно вопросов для дуэли. Попробуйте позже.'
      : '⚠️ Not enough questions. Try again later.');
    return;
  }

  // Save canonical questions to room — guest reads these exact objects, no re-shuffling
  await sb.from('duel_rooms').update({ status: 'started', questions }).eq('code', duelCode);

  duelQs = questions;  // host uses same canonical array directly
  clearInterval(duelPoll);
  startDuelBattle();
}


async function startDuelBattle({ chargeSession = true, mode = 'friend_battle' } = {}){
  // ── Server-side limit check ────────────────────────────────────
  // Only run if this path is responsible for creating the session.
  // random_battle / virtual_battle paths set chargeSession=false
  // after their own successful start_game_session call.
  // Auto-detect: if upstream already set _battleSessionStarted, skip charging here
  // This covers the matchFound → joinDuel → startDuelBattle path
  if (window._battleSessionStarted && window._currentSessionId) {
    chargeSession = false; // session already created upstream
  }

  if (chargeSession && window.sb && window._appState?.getState().currentUser) {
    const oppId = window._duelOpponentId || null;
    const invId = window._duelInviteId   || null;
    const { data: _sd, error: _se } = await window.sb.rpc('start_game_session', {
      p_mode:        mode,
      p_opponent_id: oppId,
      p_invite_id:   invId,
    });
    if (_se) {
      window.toast?.('Не удалось начать баттл. Проверь интернет.');
      return;
    }
    if (!_sd) {
      window.toast?.('Не удалось начать баттл. Попробуй ещё раз.');
      return;
    }
    if (!_sd.allowed) {
      const plan = _sd.plan || 'free';
      if (window.track) window.track('battle_limit_reached', { plan, used: _sd.used, limit: _sd.limit });
      if (window.track) window.track('premium_paywall_viewed', { trigger: 'battle_limit', plan });
      window.toast?.('Дневной лимит баттлов исчерпан');
      return;
    }
    window._currentSessionId     = _sd.session_id || null;
    window._battleSessionStarted = true;
  }
  // chargeSession=false: session already created upstream — just verify it exists
  if (!chargeSession && !window._currentSessionId) {
    console.warn('[battle] startDuelBattle(chargeSession=false) but no _currentSessionId set');
  }

  duelIdx=0;duelMyScore=0;duelOppScore=0;
  startIntegrity('duel'); // start ONLY when battle begins, not in lobby
  if(duelRole==='guest' && !window._isBotDuel){
    sb.from('duel_rooms').update({guest_score:0}).eq('code',duelCode);
  }
  document.getElementById('ds-me-name').textContent=duelMyName;
  // Opponent display name — bot vs real player
  let oppLabel;
  if(window._isBotDuel){
    const bot = window._botPlayer;
    oppLabel = bot
      ? ((bot.flag ? bot.flag + ' ' : '🤖 ') + bot.name)
      : (window._botName || '🤖 Bot');
  } else {
    oppLabel = duelRole==='host' ? 'Соперник' : 'Host';
  }
  document.getElementById('ds-opp-name').textContent = oppLabel;
  document.getElementById('d-res-opp-name').textContent = oppLabel;
  document.getElementById('d-res-me-name').textContent=duelMyName;
  updateDuelScores();
  buildDots('d-prog-dots',duelQs.length);
  showDuelSection('d-battle');
  loadDuelQ();
}

function loadDuelQ(){
  duelAnswered=false;clearInterval(duelTimer);
  const q=duelQs[duelIdx];duelMaxT=q.t;duelTimeLeft=q.t;
  document.getElementById('d-cat-pill').textContent=q.cat;
  document.getElementById('d-q-counter').textContent=(duelIdx+1)+'/'+duelQs.length;
  document.getElementById('d-q-text').textContent=q.q;
  renderQMedia('d-media-container', q);
  document.getElementById('d-fb').className='fb';
  document.getElementById('d-next-btn').className='next-btn';
  document.getElementById('d-next-btn').textContent=t('next');
  document.getElementById('opp-hint').textContent='';
  document.getElementById('opp-hint').className='opp-hint';
  const ans=document.getElementById('d-answers');ans.innerHTML='';
  q.a.forEach((a,i)=>{
    const b=document.createElement('button');b.className='ans';
    b.innerHTML='<span class="ans-l">'+answerLetter(i)+'</span><span>'+a+'</span>';
    b.onclick=()=>pickDuel(i);ans.appendChild(b);
  });
  setDot('d-prog-dots',duelIdx,'active');
  renderDuelTimer();
  duelTimer=setInterval(duelTick,1000);

  // ── Bot answer simulation ────────────────────────────────────
  // simulateBotAnswer runs independently — does NOT check duelAnswered
  // so the bot scores even when the player answered first.
  if(window._isBotDuel){
    botAnsweredThisQuestion = false;
    simulateBotAnswer(q, duelIdx);
  }
}

function renderDuelTimer(){
  const pct=(duelTimeLeft/duelMaxT)*100;
  const fill=document.getElementById('d-timer-fill');
  fill.style.width=pct+'%';fill.style.background=pct<35?'#e05555':pct<60?'#f0a050':'#6c63ff';
  const tv=document.getElementById('d-t-val');
  tv.textContent=duelTimeLeft+'s';tv.style.color=duelTimeLeft<=5?'#e05555':duelTimeLeft<=10?'#f0a050':'#8b83ff';
  document.getElementById('d-p-val').textContent='+'+(duelTimeLeft>0?duelTimeLeft:1);
}
function duelTick(){if(duelTimeLeft<=0){clearInterval(duelTimer);duelExpire();return;}duelTimeLeft--;renderDuelTimer();}
function duelExpire(){
  if(duelAnswered)return;duelAnswered=true;
  document.querySelectorAll('#d-answers .ans').forEach((b,i)=>{b.disabled=true;if(i===duelQs[duelIdx].c)b.className='ans correct';});
  showFb('d-fb','⏱ '+duelQs[duelIdx].a[duelQs[duelIdx].c],false);
  setDot('d-prog-dots',duelIdx,'miss');
  saveDuelScore();
  document.getElementById('d-next-btn').className='next-btn show';
}
async function pickDuel(i){
  if(duelAnswered)return;duelAnswered=true;clearInterval(duelTimer);
  const q=duelQs[duelIdx];
  document.querySelectorAll('#d-answers .ans').forEach(b=>b.disabled=true);
  const pts=Math.max(1, duelTimeLeft); // score = seconds remaining (max 20, min 1)
  if(i===q.c){
    document.querySelectorAll('#d-answers .ans')[i].className='ans correct';
    duelMyScore+=pts;updateDuelScores();
    showFb('d-fb','✓ +'+pts,true);setDot('d-prog-dots',duelIdx,'done');
  } else {
    document.querySelectorAll('#d-answers .ans')[i].className='ans wrong';
    document.querySelectorAll('#d-answers .ans')[q.c].className='ans correct';
    showFb('d-fb','✗ '+q.a[q.c],false);setDot('d-prog-dots',duelIdx,'miss');
  }
  saveDuelScore();
  document.getElementById('d-next-btn').className='next-btn show';
}
async function saveDuelScore(){
  // Skip all Supabase writes for bot duels — bot has no DB room
  if(window._isBotDuel) return;
  const field=duelRole==='host'?'host_score':'guest_score';
  const isLast=duelIdx>=duelQs.length-1;
  const update={[field]:duelMyScore};
  if(isLast)update.status='done';
  await sb.from('duel_rooms').update(update).eq('code',duelCode);
  // Poll for opponent answered hint
  const {data}=await sb.from('duel_rooms').select('host_score,guest_score').eq('code',duelCode).single();
  if(data){
    const oppF=duelRole==='host'?'guest_score':'host_score';
    if(data[oppF]>duelOppScore){
      document.getElementById('opp-hint').textContent=t('oppAnswered');
      document.getElementById('opp-hint').className='opp-hint answered';
    }
    duelOppScore=data[oppF]||0;updateDuelScores();
  }
}
function updateDuelScores(){
  document.getElementById('ds-me-score').textContent=duelMyScore;
  document.getElementById('ds-opp-score').textContent=duelOppScore;
}
async function duelNextQ(){
  stopAudio();
  // Cancel any pending bot answer for this question
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  duelIdx++;
  if(duelIdx>=duelQs.length){
    clearInterval(duelTimer);
    document.getElementById('d-next-btn').className='next-btn';
    document.getElementById('d-fb').textContent='';
    document.getElementById('d-fb').className='fb';

    if(window._isBotDuel){
      // Bot duel: end immediately — no DB poll needed
      endDuel({host_score: duelMyScore, guest_score: duelOppScore});
    } else {
      // Real duel: mark my side done and wait for opponent
      const myField=duelRole==='host'?'host_done':'guest_done';
      await sb.from('duel_rooms').update({[myField]:true}).eq('code',duelCode);
      document.getElementById('d-q-text').textContent='⏳ Waiting for opponent to finish...';
      document.querySelectorAll('#d-answers .ans').forEach(b=>{b.disabled=true;b.style.opacity='.3';});
      const waitPoll=setInterval(async()=>{
        const {data}=await sb.from('duel_rooms').select('*').eq('code',duelCode).single();
        if(!data)return;
        const bothDone=data.host_done&&data.guest_done;
        if(bothDone||(Date.now()-new Date(data.created_at).getTime()>300000)){
          clearInterval(waitPoll);
          endDuel(data);
        }
      },1500);
    }
  } else {
    loadDuelQ();
  }
}
function endDuel(data){
  clearInterval(duelPoll);clearInterval(duelTimer);
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  // For bot duels use local scores; for real duels use DB scores
  let myS, oppS;
  if(window._isBotDuel){
    myS  = duelMyScore;
    oppS = duelOppScore;
  } else {
    myS  = duelMyScore;
    const hostS  = data?.host_score  || 0;
    const guestS = data?.guest_score || 0;
    oppS = duelRole==='host' ? guestS : hostS;
  }
  const win=myS>oppS, tie=myS===oppS;
  if(win)saveDuelWin();
  stopIntegrity();
  track('duel_completed', {result: win?'win':tie?'tie':'lose', my_score: myS, opp_score: oppS, bot: !!window._isBotDuel});
  // ── Начисляем XP клубу за бой ──
  const _clubBattlePts = win ? 80 : tie ? 40 : 20;
  if(window._syncClubScore) window._syncClubScore(_clubBattlePts);
  if(window._syncQuizScore) window._syncQuizScore(Math.round(_clubBattlePts*0.5));
  document.getElementById('d-result-icon').textContent=win?'🏆':tie?'🤝':'😤';
  // Показываем клубные очки
  const _dClubEl = document.getElementById('d-club-bonus');
  if(_dClubEl) _dClubEl.textContent = (win?'+80':tie?'+40':'+20') + ' ⚡ клубу';
  // Показываем share-card
  const _sc = document.getElementById('d-share-card');
  if(_sc){
    _sc.style.display='';
    document.getElementById('d-sc-result').textContent = win?'🏆 Победа!':tie?'🤝 Ничья!':'😤 Поражение';
    document.getElementById('d-sc-score').textContent = myS + ' : ' + oppS;
    const _tc = JSON.parse(localStorage.getItem('mfc_club_fb')||'null');
    document.getElementById('d-sc-club').textContent = _tc ? '🏟️ ' + _tc.name : '';
    // Сохраняем для шаринга
    window._lastDuelShare = {win, tie, myS, oppS, club: _tc?.name||null, code: duelCode};
  }
  document.getElementById('d-result-title').textContent=win?t('dWin'):tie?t('dTie'):t('dLose');
  document.getElementById('d-result-sub').textContent=win?t('dWinSub'):tie?t('dTieSub'):t('dLoseSub');
  document.getElementById('d-res-me-score').textContent=myS;
  document.getElementById('d-res-opp-score').textContent=oppS;
  document.getElementById('d-res-me-box').className='result-box'+(win?' winner':'');
  document.getElementById('d-res-opp-box').className='result-box'+(oppS>myS?' winner':'');
  showDuelSection('d-result');
}
// ── Share функции для дуэли ──
function _duelShareText(){
  const d = window._lastDuelShare || {};
  const result = d.win ? 'Победил' : d.tie ? 'Ничья' : 'Проиграл';
  const club = d.club ? ' за ' + d.club : '';
  const link = location.origin + location.pathname + '?duel=' + (d.code||'');
  return `⚔️ Brain Fight Club${club}
${result}: ${d.myS||0} : ${d.oppS||0}
Сыграй против меня → ${link}`;
}
function duelShareTG(){
  const text = encodeURIComponent(_duelShareText());
  window.open('https://t.me/share/url?text='+text,'_blank');
}
function duelShareWA(){
  const text = encodeURIComponent(_duelShareText());
  window.open('https://wa.me/?text='+text,'_blank');
}
function duelCopyLink(){
  navigator.clipboard.writeText(_duelShareText()).catch(()=>{});
  toast('🔗 Скопировано!');
}
function duelChallengeFriend(){
  showScreen('duel');
  resetDuel();
}

function resetDuel(){
  // Reset battle session guard for next battle
  window._battleSessionStarted = false;
  window._currentSessionId     = null;
  clearInterval(duelPoll);clearInterval(duelTimer);
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  duelCode=null;duelRole=null;duelQs=[];
  // Clear bot state
  window._isBotDuel  = false;
  window._botPlayer  = null;
  window._botName    = null;
  document.getElementById('join-code-input').value='';
  showDuelSection('d-lobby');
}
function copyDuelLink(){
  const link=document.getElementById('d-link-txt').textContent;
  navigator.clipboard.writeText(link).catch(()=>{});
  document.getElementById('d-copy-btn').textContent=t('dCopied');
  setTimeout(()=>document.getElementById('d-copy-btn').textContent=t('dCopy'),2000);
}

// ═══════════════════════════════════════════
// TOURNAMENT  (server-authoritative sync model)
// Single source of truth: Firebase room document
// Clients only write answers; host RPC advances questions
// ═══════════════════════════════════════════

// ── State ───────────────────────────────────────────────────────
// [tCode] → tournaments/tournament-game.js
   // 6-char room code
// [tRole] → tournaments/tournament-game.js
   // 'host' | 'guest'
// [tMyUserId] → tournaments/tournament-game.js
   // auth.uid() (guests require Firebase Anonymous Auth)
// [tMyName] → tournaments/tournament-game.js

// [tQs] → tournaments/tournament-game.js
     // question array (loaded once on start)
// [tIdx] → tournaments/tournament-game.js
      // current question index (from server)
// [tMyScore] → tournaments/tournament-game.js

// [tAnsweredThisQ] → tournaments/tournament-game.js
 // guard: answer once per question
// [tTimer] → tournaments/tournament-game.js
   // local countdown interval
// [tDeadlineMs] → tournaments/tournament-game.js
      // server deadline as JS timestamp
// [tQVersion] → tournaments/tournament-game.js
      // question_version from server (change = new Q)
// [_fbTournUnsub] → tournaments/tournament-game.js
 // Firebase unsubscribe handle
// [tPoll] → tournaments/tournament-game.js
   // fallback polling interval
// [_tAdvanceLock] → tournaments/tournament-game.js
 // local guard (Firebase transaction is primary guard)
// [_tServerTimeOffset] → tournaments/tournament-game.js
 // estimated ms offset: serverTime = Date.now() + offset

// Estimate server time offset by comparing local time to Firebase server time
// Called once on room creation/join

// [estimateServerTimeOffset] → tournaments/tournament-game.js


// [localToServer] → tournaments/tournament-game.js


// [serverToLocal] → tournaments/tournament-game.js


// Derived: seconds per question by answer count

// [tSecondsForQ] → tournaments/tournament-game.js


// ── Screen helper ────────────────────────────────────────────────

// [showTournSection] → tournaments/tournament-game.js


// ── Cleanup: always call when leaving tournament ─────────────────

// [tCleanup] → tournaments/tournament-game.js


// ── Create room (host) ───────────────────────────────────────────

// [createTournament] → tournaments/tournament-game.js


// ── Join room (guest) ────────────────────────────────────────────

// [joinTournament] → tournaments/tournament-game.js


// ── Real-time room listener ──────────────────────────────────────

// [tListenRoom] → tournaments/tournament-game.js


// ── Central room update handler ──────────────────────────────────

// [tOnRoomUpdate] → tournaments/tournament-game.js


// ── Begin game (called once when status flips to playing) ────────

// [tBeginGame] → tournaments/tournament-game.js


// ── Load question from server room state ─────────────────────────

// [tLoadQFromRoom] → tournaments/tournament-game.js


// ── Timer tick: counts down toward server deadline ───────────────

// [tTickFromDeadline] → tournaments/tournament-game.js



// [tRenderTimer] → tournaments/tournament-game.js


// ── Local timer expired (no answer) ─────────────────────────────

// [tLocalExpire] → tournaments/tournament-game.js


// ── Player picks an answer ───────────────────────────────────────

// [tPickAnswer] → tournaments/tournament-game.js


// ── Write answer to server ───────────────────────────────────────
// tWriteAnswer: client sends only selected_idx.
// is_correct and points are NEVER trusted from client.
// For Firebase: host's Cloud Function (or host client logic) validates correctness
// using q.c which is stored locally on each client (loaded at game start).
// This is a known trade-off: without a Cloud Function, correctness validation
// lives in trusted client code (host). Full server validation requires Firebase CF.

// [tWriteAnswer] → tournaments/tournament-game.js


// ── Show waiting state after answering ───────────────────────────

// [tShowWaitingAfterAnswer] → tournaments/tournament-game.js


// ── Update waiting display from server participants ──────────────

// [tUpdateWaitDisplay] → tournaments/tournament-game.js


// ── Host: check if all answered, advance question ────────────────

// [tMaybeAdvanceAsHost] → tournaments/tournament-game.js


// ── Host: atomically advance to next question ────────────────────

// [tHostAdvanceQuestion] → tournaments/tournament-game.js


// ── Heartbeat: update last_seen every 8s ────────────────────────
// [_tHeartbeatTimer] → tournaments/tournament-game.js


// [tHeartbeat] → tournaments/tournament-game.js


// ── Spectator view (read-only) ───────────────────────────────────

// [tRenderSpectatorView] → tournaments/tournament-game.js


// ── Start tournament (host only) ─────────────────────────────────

// [startTournament] → tournaments/tournament-game.js


// ── Leaderboard renderers ────────────────────────────────────────

// [tRenderPlayerList] → tournaments/tournament-game.js



// [tRenderLeaderboardFromRoom] → tournaments/tournament-game.js


// ── Results screen ───────────────────────────────────────────────

// [tShowResults] → tournaments/tournament-game.js


// ── Reset for replay ─────────────────────────────────────────────

// [resetTournament] → tournaments/tournament-game.js


// ── Share функции турнира ──
function _tournShareText(){
  const d = window._lastTournShare || {};
  const club = d.club ? ' — ' + d.club : '';
  return `🏆 Brain Fight Club${club}
${d.placeStr||'Участник'}: ${d.pts||0} очков
Сыграй в следующем турнире → ${location.origin+location.pathname}`;
}
function tournShareTG(){
  window.open('https://t.me/share/url?text='+encodeURIComponent(_tournShareText()),'_blank');
}
function tournShareWA(){
  window.open('https://wa.me/?text='+encodeURIComponent(_tournShareText()),'_blank');
}
function tournCopyLink(){
  navigator.clipboard.writeText(_tournShareText()).catch(()=>{});
  toast('🔗 Скопировано!');
}


// [resetTournament] → tournaments/tournament-game.js

function copyTournLink(){
  navigator.clipboard.writeText(document.getElementById('t-link-txt').textContent).catch(()=>{});
  document.getElementById('t-copy-btn').textContent=t('tCopied');
  setTimeout(()=>document.getElementById('t-copy-btn').textContent=t('tCopy'),2000);
}

// ═══════════════════════════════════════════
// WAITLIST
// ═══════════════════════════════════════════
function submitWL(){
  const name=document.getElementById('wl-name').value.trim();
  const email=document.getElementById('wl-email').value.trim();
  if(!name||!email){toast('Please enter name and email');return;}
  document.getElementById('wl-form').style.display='none';
  document.getElementById('wl-thanks').style.display='flex';
  wlCount++;document.getElementById('wl-num').textContent=wlCount;
}

// ═══════════════════════════════════════════
// QUESTIONS FROM SUPABASE (with local fallback)
// ═══════════════════════════════════════════
let _remoteQsLoaded = false;
let _remoteQsPromise = null; // so startQuiz can await it

function validateQuestion(q){
  // Only multiple_choice supported
  if(!q.cat) return 'missing category';
  if(!q.q?.en && !q.q?.ru) return 'missing question text';
  const ans = q.a?.en || q.a?.ru || q.a;
  if(!Array.isArray(ans) || ans.length < 2 || ans.length > 6)
    return 'answers must be array[2-6]';
  if(q.c === undefined || q.c === null || q.c < 0 || q.c >= ans.length)
    return 'correct_index out of range';
  if(q._mediaType === 'image' && !q.img) return 'media_type=image but image_url missing';
  if(q._mediaType === 'audio' && !q.audio) return 'media_type=audio but audio_url missing';
  if(q._mediaType === 'video' && !q.video) return 'media_type=video but video_url missing';
  return null;
}

async function loadRemoteQuestions(){
  // DISABLED for Quick Play: Supabase official_general questions may contain
  // old broken questions with correctIndex always 0. Quick Play uses seed v2 only.
  // Supabase questions are used only in tester/admin/pack mode.
  console.log('[MFC] loadRemoteQuestions: skipped for Quick Play (seed v2 is the source)');
  _remoteQsLoaded = true;
  return;
  // eslint-disable-next-line no-unreachable
  try{
    const {data, error} = await sb.from('questions')
      .select('*')
      .eq('status','published')
      .in('source_type',['official_general'])
      .eq('question_type','multiple_choice')
      .not('import_key','like','game_%')
      .limit(500);
    if(!error && data && data.length > 0){
      const remoteQ = data.map(q=>({
        cat: q.category,
        q: {en: q.question_en||q.question_text, ru: q.question_ru||q.question_text},
        a: {en: q.answers_en||q.answers_json, ru: q.answers_ru||q.answers_json},
        c: q.correct_index,
        t: 20,
        // Only extracted crop image goes into gameplay (never full slide screenshot)
        img:   q.media_type==='image' ? (q.image_url||null) : null,
        audio: (q.media_type==='audio') ? (q.audio_url||null) : null,
        video: (q.media_type==='video') ? (q.video_url||null) : null,
          explanation_ru: q.explanation_ru||null,
        _mediaType: q.media_type||null,
        _questionType: q.question_type||'multiple_choice',
        _id: q.id,
        _importKey: q.import_key||null,
      }));

      // Validate and filter
      let validCount = 0, skipCount = 0;
      const valid = remoteQ.filter(q=>{
        const err = validateQuestion(q);
        if(err){ console.warn('[MFC] Skipping question:', err, q.q?.en?.slice(0,40)); skipCount++; return false; }
        validCount++;
        return true;
      });
      if(skipCount > 0) console.warn(`[MFC] Skipped ${skipCount} invalid remote questions`);

      if(valid.length > 0){
        const localTexts = new Set(ALL_Q.map(q=>q.q?.en||q.q));
        const newOnes = valid.filter(q=>!localTexts.has(q.q.en));
        ALL_Q.push(...newOnes);
        _remoteQsLoaded = true;
        console.log(`[MFC] Loaded ${newOnes.length} remote questions (${validCount} valid, ${skipCount} skipped)`);
      }
    }
  }catch(e){ console.warn('[MFC] Remote questions load failed, using local:', e.message); }
}


// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
renderBadges();
applyLang();
// Default to Russian for all users
setLang('ru');

// PWA
// ═══════════════════════════════════════════
// LOCAL BROWSER NOTIFICATIONS
// Uses the Web Notifications API (tab must be open).
// NOT server-side Web Push — no VAPID keys, no push subscription table,
// no service worker push event. Notifications only fire while the tab/PWA
// is running in the background, not when the app is fully closed.
// TODO (post-MVP): add PushManager.subscribe + VAPID + server send for
// true background push when app is closed.
// ═══════════════════════════════════════════
const PUSH_ASKED_KEY = 'mfc_push_asked_v1';

async function requestPushPermission(source='app'){
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted') return true;
  if(Notification.permission === 'denied') return false;
  // Only ask once per session, with a friendly nudge first
  if(localStorage.getItem(PUSH_ASKED_KEY)) return false;
  localStorage.setItem(PUSH_ASKED_KEY, '1');
  const result = await Notification.requestPermission();
  track('push_permission_requested', {source, result});
  if(result === 'granted'){
    toast(lang==='ru'?'🔔 Уведомления включены!':'🔔 Notifications enabled!', 2500);
    return true;
  }
  return false;
}

// Show a local notification (works without server push)
function showLocalNotification(title, body, icon='🧠'){
  if(Notification.permission !== 'granted') return;
  if(document.visibilityState === 'visible') return; // app is open, use toast instead
  try{
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-72.png',
      tag: 'mfc-' + Date.now(),
      requireInteraction: false,
      silent: false,
    });
  }catch(e){}
}

// Ask for notifications after first completed game (best moment — user just had fun)
function maybeAskPushAfterGame(){
  if(Notification.permission !== 'default') return;
  if(localStorage.getItem(PUSH_ASKED_KEY)) return;
  // Show a gentle in-app prompt first
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9999;display:flex;align-items:flex-end;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:1px solid var(--border);border-radius:20px;padding:24px 20px;max-width:400px;width:100%;text-align:center">
      <div style="font-size:36px;margin-bottom:12px">🔔</div>
      <div style="font-size:17px;font-weight:800;margin-bottom:8px">${lang==='ru'?'Не пропусти дуэль!':'Don\'t miss a duel!'}</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:20px">
        ${lang==='ru'
          ? 'Включи уведомления — узнаешь первым, когда кто-то бросит вызов или начнётся турнир.'
          : 'Enable notifications to know when someone challenges you or a tournament starts.'}
      </div>
      <button onclick="requestPushPermission('post_game');this.closest('[style]').remove()"
        style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">
        🔔 ${lang==='ru'?'Включить уведомления':'Enable notifications'}
      </button>
      <button onclick="this.closest('[style]').remove();localStorage.setItem('${PUSH_ASKED_KEY}','1')"
        style="width:100%;background:transparent;border:none;color:var(--muted);font-size:13px;cursor:pointer;font-family:inherit;padding:6px">
        ${lang==='ru'?'Не сейчас':'Not now'}
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

// Notify opponent of a duel challenge
function notifyDuelChallenge(challengerName){
  showLocalNotification(
    `⚔️ ${challengerName} ${lang==='ru'?'бросает вызов!':'challenges you!'}`,
    lang==='ru'?'Открой Brain Fight Club и прими дуэль 🔥':'Open Brain Fight Club and accept the duel 🔥'
  );
}

// Daily streak reminder (call once per day from loadDailyStreakData)
function scheduleDailyStreakReminder(){
  if(Notification.permission !== 'granted') return;
  if(!_dailyStreak || _streakPlayedToday) return;
  // Fire a reminder in 2 hours if tab is still open but user switched away
  setTimeout(()=>{
    if(!_streakPlayedToday){
      showLocalNotification(
        `🔥 ${lang==='ru'?'Серия '+_dailyStreak+' дней под угрозой!':'Streak of '+_dailyStreak+' days at risk!'}`,
        lang==='ru'?'Сыграй Quick Play сегодня, пока не поздно':'Play Quick Play today before it\'s too late'
      );
    }
  }, 2*3600*1000);
}

if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

// Save pending ref on any page load (before auth)
savePendingRef();

// Check URL params
const urlP=new URLSearchParams(window.location.search);
if(urlP.get('duel'))document.getElementById('join-code-input').value=urlP.get('duel');
if(urlP.get('tourn'))document.getElementById('t-join-code').value=urlP.get('tourn');

loadDailyState();
_remoteQsPromise = loadRemoteQuestions(); // store promise so startQuiz can await it
initAuth();

// ═══════════════════════════════════════════


// ── Battle limit analytics ────────────────────────────────────────
function _trackBattleLimitReached() {
  if (typeof window.track === 'function') {
    const plan  = window._userSubscription?.plan || 'free';
    const used  = window._userSubscription?.battlesUsedToday ?? '?';
    const limit = window._userSubscription?.battleLimit ?? 3;
    window.track('battle_limit_reached', { plan, used, limit });
    window.track('premium_paywall_viewed', { trigger: 'battle_limit', plan });
  }
}

// ── window exports ────────────────────────────────────────────────
if (typeof createDuel  !== 'undefined') window.createDuel  = createDuel;
if (typeof createBattleInvite !== 'undefined') window.createBattleInvite = createBattleInvite;
if (typeof acceptBattleInvite !== 'undefined') window.acceptBattleInvite = acceptBattleInvite;
if (typeof openInviteLink     !== 'undefined') window.openInviteLink     = openInviteLink;
if (typeof joinDuel    !== 'undefined') window.joinDuel    = joinDuel;
if (typeof pickD       !== 'undefined') window.pickD       = pickD;

// ── Invite flow for social bonus support ─────────────────────────
// Full flow:
//   Host: createBattleInvite() → gets invite_id → share link with ?invite_id=XXX
//   Guest: openInviteLink() → acceptBattleInvite(invite_id) → joinDuel with invite context
//   At startDuelBattle: passes p_invite_id so server can validate social bonus

let _duelOpponentId = null; // set when joining via invite
let _duelInviteId   = null; // set when accepting an invite

async function createBattleInvite(receiverId) {
  if (!window.sb || !window._appState?.getState().currentUser) return null;
  const sender = window._appState.getState().currentUser;
  const { data, error } = await window.sb.from('battle_invites').insert({
    sender_id:   sender.id,
    receiver_id: receiverId,
    status:      'pending',
  }).select('id').single();
  if (error) { console.error('[invite] create error:', error.message); return null; }
  if (window.track) window.track('battle_invite_created', { invite_id: data.id });
  return data.id;
}

async function acceptBattleInvite(inviteId) {
  if (!window.sb || !window._appState?.getState().currentUser) return false;
  const { data, error } = await window.sb
    .from('battle_invites')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('id', inviteId)
    .eq('receiver_id', window._appState.getState().currentUser.id)
    .eq('status', 'pending')
    .select('sender_id')
    .single();
  if (error || !data) {
    console.error('[invite] accept error:', error?.message);
    return false;
  }
  _duelOpponentId = data.sender_id;
  _duelInviteId   = inviteId;
  if (window.track) window.track('battle_invite_accepted', { invite_id: inviteId });
  return true;
}

// Called when guest opens a duel link containing invite_id
async function openInviteLink(inviteId) {
  const accepted = await acceptBattleInvite(inviteId);
  if (!accepted) {
    window.toast?.('Приглашение недействительно или уже использовано');
    return;
  }
  // Set invite context for startDuelBattle
  window._duelInviteId   = _duelInviteId;
  window._duelOpponentId = _duelOpponentId;
  // Proceed to join the duel room
  if (typeof joinDuel === 'function') {
    const codeEl = document.getElementById('join-code-input');
    if (codeEl && codeEl.value) await joinDuel();
  }
}


// ── Window exports ────────────────────────────────────────────────
window.simulateBotAnswer     = simulateBotAnswer;
window.showDuelSection       = showDuelSection;
window.createDuel            = createDuel;
window.joinDuel              = joinDuel;
window.startDuelPoll         = startDuelPoll;
window.startDuelGame         = startDuelGame;
window.startDuelBattle       = startDuelBattle;
window.loadDuelQ             = loadDuelQ;
window.renderDuelTimer       = renderDuelTimer;
window.duelTick              = duelTick;
window.duelExpire            = duelExpire;
window.pickDuel              = pickDuel;
window.saveDuelScore         = saveDuelScore;
window.updateDuelScores      = updateDuelScores;
window.duelNextQ             = duelNextQ;
window.endDuel               = endDuel;
window.duelShareTG           = duelShareTG;
window.duelShareWA           = duelShareWA;
window.duelCopyLink          = duelCopyLink;
window.duelChallengeFriend   = duelChallengeFriend;
window.resetDuel             = resetDuel;
window.copyDuelLink          = copyDuelLink;
window.tournShareTG          = tournShareTG;
window.tournShareWA          = tournShareWA;
window.tournCopyLink         = tournCopyLink;
window.copyTournLink         = copyTournLink;
window.submitWL              = submitWL;
window.validateQuestion      = validateQuestion;
window.loadRemoteQuestions   = loadRemoteQuestions;
window.requestPushPermission = requestPushPermission;
window.showLocalNotification = showLocalNotification;
window.maybeAskPushAfterGame = maybeAskPushAfterGame;
window.notifyDuelChallenge   = notifyDuelChallenge;
window.scheduleDailyStreakReminder = scheduleDailyStreakReminder;
window.createBattleInvite    = createBattleInvite;
window.acceptBattleInvite    = acceptBattleInvite;
window.openInviteLink        = openInviteLink;

// Called by matchmaking when this player is the "finder" and should act as host
window.mmStartAsHost = async function(code, myName) {
  duelCode     = code;
  duelRole     = 'host';
  duelMyName   = myName || 'Вы';
  duelMyScore  = 0;
  duelOppScore = 0;
  duelQs       = [];
  duelIdx      = 0;
  if (duelPoll)  { clearInterval(duelPoll);  duelPoll  = null; }
  if (duelTimer) { clearInterval(duelTimer); duelTimer = null; }
  await startDuelGame();
};
