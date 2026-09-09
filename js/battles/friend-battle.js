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
let duelQs=[],duelIdx=0,duelMyScore=0,duelOppScore=0,duelMyCorrect=0,_duelSpeedNeurons=0;
let duelAnswered=false,duelTimer=null,duelTimeLeft=0,duelMaxT=0;
let _oppPollInterval=null; // continuous opponent-score watcher during real duel
let duelMyName='You',duelOppNameStr='Соперник';
let _duelOppUserId = null; // set when duel starts for profile tap
let botAnsweredThisQuestion = false;
let _tabWarnCount = 0;
let _isRandomBattle = false; // true when came from matchmaking (not friend duel)
let _oppScoreAtQStart = 0;  // opponent score when current question started (to detect miss)
let _myAnswers = []; // per-question points for this player (0 = miss)
let _duelChannel = null; // Supabase Realtime broadcast channel for reactions/phrases

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
    let botPts = 0;
    if(correct){
      botPts = Math.max(1, duelTimeLeft);
      duelOppScore += botPts;
      updateDuelScores();
    }
    const hint = document.getElementById('opp-hint');
    if(hint){
      const botLabel = window._botPlayer?.name || window._botName || 'Соперник';
      hint.textContent = correct
        ? `✓ ${botLabel} ответил правильно`
        : `✗ ${botLabel} ошибся`;
      hint.className = 'opp-hint answered';
    }
    setOppDot(qIndex, correct, botPts);
  }, delay);
}

function showDuelSection(id){
  document.querySelectorAll('.duel-section').forEach(s=>s.classList.toggle('active',s.id===id));
}

async function createDuel(){
  if(!currentUser){ window._showSignInToPlay?.(); return; }
  window._isBotDuel = false; window._botPlayer = null; window._pendingBot = null;

  duelRole='host';
  duelMyScore=0;duelOppScore=0;duelQs=[];duelIdx=0;duelMyCorrect=0;_duelSpeedNeurons=0;

  // SERVER creates room and generates code — client does not supply these
  const { data: res, error } = await sb.rpc('create_duel');
  if (error || !res?.ok) {
    toast('Ошибка создания комнаты: ' + (error?.message || res?.error));
    return;
  }
  duelCode  = res.code;
  duelMyName = res.host_name || currentUser?.user_metadata?.full_name?.split(' ')[0] || 'Хост';

  track('duel_created', {code: duelCode});

  document.getElementById('d-code-display').textContent=duelCode;
  const link=location.origin+location.pathname+'?duel='+duelCode;
  document.getElementById('d-link-txt').textContent=link;
  document.getElementById('d-me-name').textContent=duelMyName;
  document.getElementById('d-start-btn').style.display='none';
  document.getElementById('d-wait-txt').style.display='flex';

  showDuelSection('d-waiting');
  startDuelPoll();
  checkBadges('duel'); if (typeof window.renderBadges === 'function') window.renderBadges();
}

async function joinDuel(){
  if(!currentUser){ window._showSignInToPlay?.(); return; }
  window._isBotDuel = false; window._botPlayer = null; window._pendingBot = null;

  const code=document.getElementById('join-code-input').value.trim().toUpperCase();
  if(code.length!==6){toast('Введи 6-значный код');return;}

  // SERVER validates and joins — rejects self-join, third player, wrong state
  const { data: res, error } = await sb.rpc('join_duel_by_code', { p_code: code });
  if(error){toast('Ошибка: ' + error.message);return;}
  if(!res?.ok){
    const msg = {
      'not_found':       'Комната не найдена — проверь код',
      'self_join':       'Нельзя играть против себя',
      'room_full':       'Комната уже занята',
      'room_not_joinable': 'Дуэль уже началась или завершена',
    }[res?.error] || ('Ошибка: ' + res?.error);
    toast(msg);
    return;
  }

  // Guest limit is checked server-side in start_duel() when host clicks Start.
  // No start_game_session call here — quota consumed only when duel transitions READY→STARTED.

  duelCode=code; duelRole='guest';
  duelMyName = res.guest_name || currentUser?.user_metadata?.full_name?.split(' ')[0] || 'Гость';
  duelMyScore=0;duelOppScore=0;duelQs=[];duelIdx=0;duelMyCorrect=0;_duelSpeedNeurons=0;
  track('duel_joined', {code});

  document.getElementById('d-code-display').textContent=code;
  const link=location.origin+location.pathname+'?duel='+code;
  document.getElementById('d-link-txt').textContent=link;
  document.getElementById('d-me-name').textContent=duelMyName;
  document.getElementById('opp-name-wait').textContent = res.host_name || 'Хост';
  document.getElementById('opp-status-wait').textContent=t('dReady');
  document.getElementById('opp-status-wait').className='p-st ok';
  document.getElementById('opp-pulse').style.display='none';
  document.getElementById('d-start-btn').style.display='none';
  document.getElementById('d-wait-txt').style.display='flex';
  const lpGuest = document.getElementById('duel-lobby-phrases');
  if (lpGuest) lpGuest.style.display = 'block';
  _initDuelChannel(code);

  showDuelSection('d-waiting');
  startDuelPoll();
}

function startDuelPoll(){
  if(duelPoll)clearInterval(duelPoll);
  const _lobbyDeadline = Date.now() + 3 * 60 * 1000;
  duelPoll=setInterval(async()=>{
    // Poll via get_duel RPC — returns only safe fields, no private data
    const { data } = await sb.rpc('get_duel', { p_code: duelCode });
    if(!data?.ok) return;

    // Auto-abandon lobby after 3 minutes
    if(Date.now() > _lobbyDeadline && data.status !== 'started'){
      clearInterval(duelPoll);
      window.toast?.('⏱ Соперник не вышел на бой — возврат в меню');
      showScreen('play-menu');
      return;
    }

    // Host sees guest joined (status = ready)
    if(duelRole==='host' && data.status==='ready'){
      duelOppNameStr = data.guest_name || 'Соперник';
      document.getElementById('opp-name-wait').textContent = duelOppNameStr;
      document.getElementById('opp-status-wait').textContent=t('dReady');
      document.getElementById('opp-status-wait').className='p-st ok';
      document.getElementById('opp-pulse').style.display='none';
      document.getElementById('d-start-btn').style.display='block';
      document.getElementById('d-wait-txt').style.display='none';
      const lp = document.getElementById('duel-lobby-phrases');
      if (lp) lp.style.display = 'block';
      _initDuelChannel(duelCode);
    }

    // Guest sees game started — load sanitized questions from RPC response (no correct_index, no id)
    if(duelRole==='guest' && data.status==='started' && duelQs.length===0){
      const qs = data.questions;
      if(qs && qs.length > 0){
        duelQs = qs; // sanitized: {idx, cat, q, a, t} — no c field
        duelOppNameStr = data.host_name || 'Хост';
        console.log('[BFC] guest loaded sanitized questions:', duelQs.length);
        clearInterval(duelPoll);
        startDuelBattle({ chargeSession: false, mode: 'friend_battle' });
      } else {
        console.log('[BFC] guest: questions not yet available, retrying...');
      }
    }

  },2000);
}

async function startDuelGame(){
  // HOST triggers start. start_duel() atomically checks BOTH players' limits,
  // selects questions, inserts game_sessions, and transitions READY→STARTED.
  // No start_game_session call here — server is the sole authority.
  const { data: res, error } = await sb.rpc('start_duel', { p_code: duelCode });

  if (error || !res?.ok) {
    const errCode = error?.message || res?.error;
    if (errCode === 'host_limit_reached') {
      if (window.track) window.track('battle_limit_reached', { trigger: 'host_duel_start' });
      window.showDailyLimitScreen?.('battle');
    } else if (errCode === 'guest_limit_reached') {
      window.toast?.('У соперника закончился лимит дуэлей на сегодня.');
    } else if (errCode === 'not_enough_secure_questions') {
      window.toast?.('⚠️ Недостаточно вопросов для безопасной дуэли. Попробуйте позже.');
    } else if (errCode === 'not_ready') {
      window.toast?.('Дождитесь, пока соперник присоединится.');
    } else {
      window.toast?.('Ошибка запуска дуэли: ' + errCode);
    }
    console.error('[duel] start_duel failed:', errCode);
    return;
  }

  // Server returns sanitized questions: {idx, cat, q, a, t} — no id, no correct_index
  duelQs = res.questions || [];
  if (duelQs.length < 5) {
    window.toast?.('Сервер вернул недостаточно вопросов. Попробуйте позже.');
    return;
  }

  clearInterval(duelPoll);
  // chargeSession=false: game_sessions already inserted by start_duel() server-side
  startDuelBattle({ chargeSession: false });
}


async function startDuelBattle({ chargeSession = true, mode = 'friend_battle', questions = null } = {}){
  // ── Server-side limit check ────────────────────────────────────
  // chargeSession=true  → Bot Duel (virtual_battle) path only.
  // chargeSession=false → Friend Duel (both host and guest): start_duel() already
  //   inserted game_sessions server-side. _battleSessionStarted/_currentSessionId
  //   are NOT used for Friend Duel — do not rely on them here.
  // Note: Random Duel is disabled in v1.
  if (window._battleSessionStarted && window._currentSessionId) {
    chargeSession = false; // Bot Duel already created session upstream
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
      window.showDailyLimitScreen?.('battle');
      return;
    }
    window._currentSessionId     = _sd.session_id || null;
    window._battleSessionStarted = true;
  }
  // chargeSession=false: session already created upstream — just verify it exists
  if (!chargeSession && !window._currentSessionId) {
    console.warn('[battle] startDuelBattle(chargeSession=false) but no _currentSessionId set');
  }

  // Load questions: from parameter, or from _pendingDuelQs, or keep existing duelQs
  if (questions && questions.length > 0) {
    duelQs = questions;
  } else if (window._pendingDuelQs && window._pendingDuelQs.length > 0) {
    duelQs = window._pendingDuelQs;
    window._pendingDuelQs = null;
  }

  duelIdx=0;duelMyScore=0;duelOppScore=0;_myAnswers=[];
  startIntegrity('duel'); // start ONLY when battle begins, not in lobby
  // Do NOT write guest_score:0 — waitPoll checks (score >= 0) to detect "opponent answered".
  // A pre-written 0 would trigger that check immediately and end the duel after 5s timeout.
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
  buildBattleDots(duelQs.length);
  showDuelSection('d-battle');

  // Opponent profile tap: direct duel_rooms read removed (no client SELECT grant).
  // _duelOppUserId stays null in v1; opponent name is already in duelOppNameStr.
  _duelOppUserId = null;
  // Make opponent name elements tappable to show mini profile
  ['ds-opp-name', 'd-res-opp-name'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.cursor = 'pointer';
    el.onclick = () => window.showOppProfile(_duelOppUserId, oppLabel);
  });
  // Init chat channel; hide lobby phrases, show post-game phrases on result
  _initDuelChannel(duelCode);
  const lobbyPhrases = document.getElementById('duel-lobby-phrases');
  if (lobbyPhrases) lobbyPhrases.style.display = 'none';
  // Reactions bar: hide for bot duels
  const reactBar = document.getElementById('duel-reactions');
  if (reactBar) reactBar.style.display = window._isBotDuel ? 'none' : 'flex';

  // Tab warning: first switch = toast, second = forfeit
  _tabWarnCount = 0;
  document.removeEventListener('visibilitychange', window._duelTabWarn);
  window._duelTabWarn = () => {
    if(document.visibilityState !== 'hidden') return;
    _tabWarnCount++;
    if(_tabWarnCount === 1){
      window.toast?.('⚠️ Ещё раз уйдёшь со страницы — засчитаем поражение!', 5000);
    } else {
      document.removeEventListener('visibilitychange', window._duelTabWarn);
      clearInterval(duelTimer); clearInterval(duelPoll);
      if(window._isBotDuel){
        // Bot duels are noncompetitive — just end locally
        endDuel({ my_score: duelMyScore, op_score: duelOppScore, _botResult: true, _forfeit: true });
      } else {
        // Real duel: server records forfeit, then fetch canonical result
        sb.rpc('forfeit_duel', { p_code: duelCode }).then(() => {
          sb.rpc('get_duel_result', { p_code: duelCode }).then(({ data: res }) => {
            endDuel(res || { my_score: 0, op_score: 0, win: false, tie: false, _forfeit: true });
          });
        });
      }
    }
  };
  document.addEventListener('visibilitychange', window._duelTabWarn);

  // Neutral opponent progress poll via get_duel() RPC (real duels only).
  // Shows only how many questions opponent has answered — never correct/wrong.
  // Scores are hidden until FINISHED (via get_duel_result).
  if(!window._isBotDuel){
    if(_oppPollInterval) clearInterval(_oppPollInterval);
    let _lastOppAnswered = 0;
    _oppPollInterval = setInterval(async () => {
      if(window._isBotDuel){ clearInterval(_oppPollInterval); return; }
      try {
        const { data } = await sb.rpc('get_duel', { p_code: duelCode });
        if(!data?.ok) return;
        const oppAnswered = data.opponent_answered_count ?? 0;
        const totalQs    = data.total_questions ?? duelQs.length;
        if(oppAnswered > _lastOppAnswered){
          // Show neutral dot for each newly answered question (no correctness info)
          for(let i = _lastOppAnswered; i < oppAnswered; i++){
            setOppDot(i, null); // null = neutral submitted state
          }
          // Neutral hint — no right/wrong information
          const hint = document.getElementById('opp-hint');
          if(hint){
            hint.textContent = `• ${duelOppNameStr} ответил (${oppAnswered}/${totalQs})`;
            hint.className = 'opp-hint answered';
          }
          _lastOppAnswered = oppAnswered;
        }
      } catch(e) { /* silent */ }
    }, 2000);
  }

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
  // Real duel: opponent dots are set ONLY by get_duel() neutral progress polling.
  // Never infer miss/correctness from local question progression.
  // Bot duel dots are handled by simulateBotAnswer() which has correctness info.
  _oppScoreAtQStart = duelOppScore;
  setDot('d-my-dots',duelIdx,'active');
  // Don't set opp dot active here — opp progress is driven by DB polling
  // so we only know their real state after they answer, not when WE advance
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
  fill.style.width=pct+'%';fill.style.background=pct<35?'#e05555':pct<60?'#f0a050':'var(--accent)';
  const tv=document.getElementById('d-t-val');
  tv.textContent=duelTimeLeft+'s';tv.style.color=duelTimeLeft<=5?'#e05555':duelTimeLeft<=10?'#f0a050':'var(--accent2)';
  // v1: fixed server scoring — timer is for pacing only, not speed-based points
  document.getElementById('d-p-val').textContent='+10';
}
function duelTick(){if(duelTimeLeft<=0){clearInterval(duelTimer);duelExpire();return;}duelTimeLeft--;renderDuelTimer();}
async function duelExpire(){
  if(duelAnswered)return;duelAnswered=true;
  document.querySelectorAll('#d-answers .ans').forEach(b=>b.disabled=true);

  if(window._isBotDuel){
    const q = duelQs[duelIdx];
    if(q?.c != null && document.querySelectorAll('#d-answers .ans')[q.c]){
      document.querySelectorAll('#d-answers .ans')[q.c].className='ans correct';
    }
    showFb('d-fb','⏱ '+(q?.a?.[q?.c]||'Время вышло'),false);
    setMyDot(duelIdx, 0, false);
    document.getElementById('d-next-btn').className='next-btn show';
    return;
  }

  // Real duel: record timeout on server (-1 = no answer)
  // Neutral response — correct answer NOT revealed during LIVE (P0.6)
  try {
    await sb.rpc('submit_duel_answer', {
      p_code:         duelCode,
      p_question_idx: duelIdx,
      p_selected_idx: -1,
    });
  } catch(e){ console.warn('[duel] expire submit failed:', e.message); }
  showFb('d-fb','⏱ Время вышло',false);
  setMyDot(duelIdx, null); // neutral timeout state — correctness unknown during LIVE
  document.getElementById('d-next-btn').className='next-btn show';
}
function triggerCorrectAnimation(pts, buttonEl){
  if(!buttonEl) return;
  // Add burst class
  buttonEl.classList.add('burst');
  setTimeout(()=>buttonEl.classList.remove('burst'), 550);
  // Floating +N score
  const rect = buttonEl.getBoundingClientRect();
  const fl = document.createElement('div');
  fl.className = 'float-score';
  fl.textContent = '+' + pts;
  fl.style.left = (rect.left + rect.width/2 - 20) + 'px';
  fl.style.top = (rect.top + window.scrollY - 10) + 'px';
  fl.style.position = 'fixed';
  document.body.appendChild(fl);
  setTimeout(()=>fl.remove(), 950);
}
async function pickDuel(i){
  if(duelAnswered)return;duelAnswered=true;clearInterval(duelTimer);
  const q=duelQs[duelIdx];
  const answerBtns = document.querySelectorAll('#d-answers .ans');
  answerBtns.forEach(b=>b.disabled=true);

  if(window._isBotDuel){
    // Bot duels: local correctness check (noncompetitive/unranked, no abuse vector)
    const localC = q.c;
    const pts = Math.max(1, duelTimeLeft);
    if(i === localC){
      answerBtns[i].className='ans correct';
      triggerCorrectAnimation(pts, answerBtns[i]);
      duelMyScore+=pts;duelMyCorrect++;updateDuelScores();
      showFb('d-fb','✓ +'+pts,true);setMyDot(duelIdx, pts, true);
    } else {
      answerBtns[i].className='ans wrong';
      if(localC != null && answerBtns[localC]) answerBtns[localC].className='ans correct';
      showFb('d-fb','✗ '+(q.a?.[localC]||''),false);setMyDot(duelIdx, 0, false);
    }
    document.getElementById('d-next-btn').className='next-btn show';
    return;
  }

  // Real duel: SERVER decides correctness. Client shows neutral "accepted" state.
  // P0.6: response must NOT reveal correct_index, is_correct, or points.
  if(i >= 0 && answerBtns[i]) answerBtns[i].className='ans selected';

  try {
    const { data: res, error: rpcErr } = await sb.rpc('submit_duel_answer', {
      p_code:         duelCode,
      p_question_idx: duelIdx,
      p_selected_idx: i,
    });

    if(rpcErr || !res?.ok){
      console.error('[duel] submit_duel_answer error:', rpcErr?.message || res?.error);
      showFb('d-fb','⚠️ Ошибка соединения',false);
      document.getElementById('d-next-btn').className='next-btn show';
      return;
    }

    // Neutral feedback — correct answer is NEVER revealed during LIVE
    showFb('d-fb','✓ Ответ принят',true);
    // Neutral dot: null = submitted, correctness unknown during LIVE
    setMyDot(duelIdx, null);
    if(res.completed){
      // Player answered all questions — score/result comes from get_duel_result
      duelMyCorrect = 0; // will be set from server result
    }
  } catch(e){
    console.error('[duel] pickDuel RPC exception:', e);
    showFb('d-fb','⚠️ Ошибка',false);
  }

  document.getElementById('d-next-btn').className='next-btn show';
}
// saveDuelScore is DISABLED for real duels — server handles all score writes
// via submit_duel_answer RPC (SECURITY DEFINER). Client must not write scores directly.
// Bot duels are local-only and never write to duel_rooms.
async function saveDuelScore(){
  // no-op: score authority moved to submit_duel_answer RPC
}
function updateDuelScores(){
  document.getElementById('ds-me-score').textContent=duelMyScore;
  document.getElementById('ds-opp-score').textContent=duelOppScore;
}
async function duelNextQ(){
  stopAudio();
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  duelIdx++;
  if(duelIdx>=duelQs.length){
    document.removeEventListener('visibilitychange', window._duelTabWarn);
    clearInterval(duelTimer);
    document.getElementById('d-next-btn').className='next-btn';
    document.getElementById('d-fb').textContent='';
    document.getElementById('d-fb').className='fb';

    if(window._isBotDuel){
      endDuel({_botResult: true, my_score: duelMyScore, op_score: duelOppScore});
    } else {
      document.getElementById('d-answers').innerHTML = '';
      document.getElementById('d-q-text').textContent = '⏳ Ты ответил на все вопросы! Ждём соперника...';
      document.getElementById('d-cat-pill').textContent = '';

      // Server derives completion from immutable ledger (duel_answers).
      // endDuel() may only be called when server returns waiting===false.
      // Never fabricate a 0:0 result — server expires_at is authoritative.
      const _waitStart = Date.now();
      let _waitEnded = false;
      let _waitInterval = 2000; // start at 2s, slow down after 60s
      const _doWaitPoll = async () => {
        if(_waitEnded) return;
        try {
          const { data: res } = await sb.rpc('get_duel_result', { p_code: duelCode });
          if(!res?.ok || _waitEnded) return;

          if(res.waiting === false){
            // Server has authoritative result — only acceptable path to endDuel
            _waitEnded = true;
            clearInterval(waitPoll);
            endDuel(res);
          }
          // waiting===true: keep polling, never fabricate result
        } catch(e){ console.warn('[duel] waitPoll error:', e); }
      };
      const waitPoll = setInterval(async() => {
        if(_waitEnded) return;
        const elapsed = Date.now() - _waitStart;
        const txt = document.getElementById('d-q-text');

        if(elapsed < 60000){
          // First 60s: show countdown
          const remaining = Math.max(0, Math.ceil((60000 - elapsed) / 1000));
          if(txt) txt.textContent = elapsed < 10000
            ? '⏳ Ждём соперника...'
            : `⏳ Ждём соперника... (${remaining}с)`;
        } else {
          // After 60s: server expires_at decides — keep waiting, slow to 5s
          if(txt) txt.textContent = '⏳ Соперник ещё играет...';
          // Show back-to-menu option without ending the duel
          const _backBtn = document.getElementById('d-wait-back-btn');
          if(_backBtn) _backBtn.style.display = 'block';
          // Reduce polling cadence (reschedule at 5s)
          if(_waitInterval === 2000){
            _waitInterval = 5000;
            clearInterval(waitPoll);
            const _slowPoll = setInterval(async() => {
              if(_waitEnded){ clearInterval(_slowPoll); return; }
              await _doWaitPoll();
            }, 5000);
          }
        }
        await _doWaitPoll();
      }, 2000);
    }
  } else {
    loadDuelQ();
  }
}
async function _saveDuelStats(myS, oppS, win) {
  // Real duel result is stored in duel_rooms.winner_id + duel_answers (authoritative).
  // game_sessions is used only for start/limit accounting in v1.
  // won/score/questions_count are intentionally NOT written to game_sessions for real duels
  // (no stable duel→session link exists; heuristic matching was removed).
  // For bot duels: write session stats locally (unranked, noncompetitive).
  const sessionId = window._currentDuelSessionId || window._currentSessionId;
  if (window._isBotDuel && window.sb && sessionId) {
    try {
      await window.sb.from('game_sessions').update({
        score:           myS,
        correct_answers: duelMyCorrect || 0,
        questions_count: duelQs?.length || 5,
        won:             win,
      }).eq('id', sessionId);
    } catch(e) { /* silent */ }
  }

  // Win streak in localStorage (display only, not authoritative)
  const _streakKey = 'bfc_duel_win_streak';
  if (win) {
    const prev = parseInt(localStorage.getItem(_streakKey) || '0', 10);
    localStorage.setItem(_streakKey, prev + 1);
  } else {
    localStorage.setItem(_streakKey, '0');
  }

  // P0.9: NO record_duel_win_bf call — neither for real duels nor bot duels.
  // Brain Fights contributions must not be created from any duel path in v1.
  // Speed neurons: DISABLED (client must not control currency awards).

  // Achievements
  if (window.checkAchievements && window.sb) {
    const { data: stats } = await window.sb.from('player_stats').select('*')
      .eq('user_id', (await window.sb.auth.getUser()).data.user?.id)
      .single().catch(() => ({ data: null }));
    if (stats) window.checkAchievements({
      duels_played: stats.duels_played,
      duels_won:    stats.duels_won,
      games_played: stats.games_played,
      streak:       stats.streak,
      neurons:      stats.neurons,
    });
  }

  if (window.syncTeamScoreAfterGame) window.syncTeamScoreAfterGame();
}

function endDuel(data){
  clearInterval(duelPoll);clearInterval(duelTimer);
  if(_oppPollInterval){ clearInterval(_oppPollInterval); _oppPollInterval = null; }
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }

  // For bot duels: data._botResult flag; use local scores (noncompetitive)
  // For real duels: data comes from get_duel_result RPC — authoritative server scores
  let myS, oppS, win, tie;
  if(window._isBotDuel || data?._botResult){
    myS  = data?.my_score  ?? duelMyScore;
    oppS = data?.op_score  ?? duelOppScore;
    win  = myS > oppS;
    tie  = myS === oppS;
  } else {
    // Server-authoritative result from get_duel_result
    myS  = data?.my_score  ?? 0;
    oppS = data?.op_score  ?? 0;
    win  = data?.win  === true;
    tie  = data?.tie  === true;
    // Update local score display to match server
    duelMyScore  = myS;
    duelOppScore = oppS;
    updateDuelScores();
  }

  _saveDuelStats(myS, oppS, win);
  stopIntegrity();
  track('duel_completed', {result: win?'win':tie?'tie':'lose', my_score: myS, opp_score: oppS, bot: !!window._isBotDuel});
  document.getElementById('d-result-icon').textContent=win?'🏆':tie?'🤝':'😤';
  const _dClubEl = document.getElementById('d-club-bonus');
  if(_dClubEl) _dClubEl.style.display = 'none';
  const _sc = document.getElementById('d-share-card');
  if(_sc){
    _sc.style.display='';
    document.getElementById('d-sc-result').textContent = win?'🏆 Победа!':tie?'🤝 Ничья!':'😤 Поражение';
    document.getElementById('d-sc-score').textContent = myS + ' : ' + oppS;
    const _tc = JSON.parse(localStorage.getItem('mfc_club_fb')||'null');
    document.getElementById('d-sc-club').textContent = _tc ? '🏟️ ' + _tc.name : '';
    window._lastDuelShare = {win, tie, myS, oppS, club: _tc?.name||null, code: duelCode};
  }
  document.getElementById('d-result-title').textContent=win?t('dWin'):tie?t('dTie'):t('dLose');
  document.getElementById('d-result-sub').textContent=win?t('dWinSub'):tie?t('dTieSub'):t('dLoseSub');
  const _forfeit = data?._forfeit;
  document.getElementById('d-res-me-score').textContent = _forfeit ? '—' : myS;
  document.getElementById('d-res-opp-score').textContent = _forfeit ? '🏳️' : oppS;
  document.getElementById('d-res-me-box').className='result-box'+(win?' winner':'');
  document.getElementById('d-res-opp-box').className='result-box'+(oppS>myS?' winner':'');
  showDuelSection('d-result');
  // Update daily streak — duels count too
  setTimeout(()=>{ window.updateDailyStreakOnQuickPlayComplete?.(); }, 800);
  // Show win streak badge if >= 2 wins in a row
  if (win) {
    const _streak = parseInt(localStorage.getItem('bfc_duel_win_streak') || '0', 10);
    if (_streak >= 2) {
      const badge = document.createElement('div');
      badge.className = 'streak-badge';
      badge.textContent = '🔥 Серия: ' + _streak + ' побед подряд!';
      document.body.appendChild(badge);
      setTimeout(() => {
        badge.style.transition = 'opacity .4s';
        badge.style.opacity = '0';
        setTimeout(() => badge.remove(), 450);
      }, 3500);
    }
  }
  // Show post-game phrases for real (non-bot) duels
  const pgPhrases = document.getElementById('duel-postgame-phrases');
  if (pgPhrases) pgPhrases.style.display = window._isBotDuel ? 'none' : 'block';
  // Rematch button (only for real, non-bot duels)
  if (!window._isBotDuel && _duelOppUserId) {
    setTimeout(() => {
      const rematchEl = document.createElement('div');
      rematchEl.id = 'rematch-hint';
      rematchEl.style.cssText = 'margin-top:12px';
      rematchEl.innerHTML = `
        <button onclick="window.startRematch?.()" style="width:100%;background:${win?'rgba(255,255,255,.07)':'var(--accent)'};border:${win?'0.5px solid var(--border)':'none'};border-radius:14px;padding:14px;font-size:15px;font-weight:700;color:${win?'var(--muted)':'#fff'};cursor:pointer;font-family:inherit">
          ⚔️ Реванш
        </button>`;
      document.getElementById('d-result')?.appendChild(rematchEl);
      // Auto-hide after 60s (opponent may have left)
      setTimeout(() => rematchEl.remove(), 60000);
    }, 800);
  }

  // After a win, gently prompt for push permission if not yet asked
  if (win && typeof Notification !== 'undefined' && Notification.permission === 'default') {
    setTimeout(() => {
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:14px;background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;text-align:center';
      hint.innerHTML = `
        <div style="font-size:15px;font-weight:700;margin-bottom:6px">🔔 Узнавай о вызовах первым!</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:12px">Включи уведомления, чтобы не пропустить дуэль</div>
        <div style="display:flex;gap:8px;justify-content:center">
          <button onclick="requestPushPermission('post_win').then(()=>this.closest('div[style]').remove())"
            style="background:var(--accent);border:none;border-radius:10px;padding:9px 18px;font-size:13px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">
            Включить
          </button>
          <button onclick="this.closest('div[style]').remove()"
            style="background:transparent;border:1px solid var(--border);border-radius:10px;padding:9px 14px;font-size:13px;color:var(--muted);cursor:pointer;font-family:inherit">
            Не сейчас
          </button>
        </div>`;
      document.getElementById('d-result')?.appendChild(hint);
    }, 2000);
  }
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

function duelPlayAgain(){
  const wasRandom = _isRandomBattle || window._isBotDuel;
  resetDuel();
  if(wasRandom){
    // Go back to matchmaking, not friend duel lobby
    if(typeof window.showPlayMenu === 'function') window.showPlayMenu();
    else showScreen('home');
  }
  // friend duel: resetDuel already shows d-lobby
}

// ── Duel chat / reactions ────────────────────────────────────────────────────

function _initDuelChannel(code) {
  if (_duelChannel) { try { sb.removeChannel(_duelChannel); } catch(e){} _duelChannel = null; }
  if (window._isBotDuel) return;
  _duelChannel = sb.channel(`duel-chat:${code}`, { config: { broadcast: { self: false } } });
  _duelChannel.on('broadcast', { event: 'msg' }, ({ payload }) => _onDuelMsg(payload));
  _duelChannel.subscribe();
}

function _onDuelMsg({ text, isReaction }) {
  if (isReaction) {
    _floatEmoji(text, false);
  } else {
    // Show phrase as a toast / in opp-hint
    const hint = document.getElementById('opp-hint');
    if (hint) { hint.textContent = `💬 ${duelOppNameStr}: ${text}`; hint.className = 'opp-hint answered'; }
    _showPhraseToast(`${duelOppNameStr}: ${text}`);
  }
}

function _floatEmoji(emoji, isMine) {
  const layer = document.getElementById('duel-float-layer');
  if (!layer) return;
  const el = document.createElement('div');
  el.className = 'duel-float-emoji';
  // Mine floats on left side, opponent's on right
  el.style.left = isMine ? `${15 + Math.random()*20}%` : `${60 + Math.random()*20}%`;
  el.textContent = emoji;
  layer.appendChild(el);
  setTimeout(() => el.remove(), 1900);
}

function _showPhraseToast(text) {
  const el = document.getElementById('duel-phrase-toast') || document.querySelector('.duel-phrase-toast');
  if (!el) return;
  el.textContent = text;
  el.style.display = 'block';
  clearTimeout(el._hideTimer);
  el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 3000);
}

window.sendDuelReaction = function(emoji) {
  if (window._isBotDuel || !_duelChannel) return;
  _duelChannel.send({ type: 'broadcast', event: 'msg', payload: { text: emoji, isReaction: true } });
  _floatEmoji(emoji, true);
};

window.sendDuelPhrase = function(text) {
  _showPhraseToast(`Вы: ${text}`);
  if (window._isBotDuel || !duelCode) return;
  // Send via Realtime if channel is alive
  if (_duelChannel) {
    _duelChannel.send({ type: 'broadcast', event: 'msg', payload: { text, isReaction: false } });
  }
  // DB last_phrase fallback removed — no UPDATE grant on duel_rooms (v1: Realtime only)
  // Disable the button briefly to prevent spam
  const allBtns = document.querySelectorAll('.duel-phrase-btn');
  allBtns.forEach(b => { b.disabled = true; setTimeout(() => { b.disabled = false; }, 2000); });
};

// ── Reset ────────────────────────────────────────────────────────────────────

function resetDuel(){
  window._battleSessionStarted = false;
  window._currentSessionId     = null;
  clearInterval(duelPoll); duelPoll = null;
  clearInterval(duelTimer); duelTimer = null;
  if(_oppPollInterval){ clearInterval(_oppPollInterval); _oppPollInterval = null; }
  if(_duelChannel){ try { sb.removeChannel(_duelChannel); } catch(e){} _duelChannel = null; }
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  // Full state reset
  duelCode=null; duelRole=null; duelQs=[]; duelIdx=0;
  duelMyScore=0; duelOppScore=0; duelAnswered=false;
  duelMyName='Вы'; duelOppNameStr='Соперник';
  // Full bot state reset
  window._isBotDuel   = false;
  window._botPlayer   = null;
  window._botName     = null;
  window._pendingBot  = null;
  window._pendingDuelQs = null;
  _isRandomBattle     = false;
  window._isRandomBattle = false;
  // Remove tab forfeit listener
  if(window._duelTabWarn){
    document.removeEventListener('visibilitychange', window._duelTabWarn);
    window._duelTabWarn = null;
  }
  _tabWarnCount = 0;
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
if (typeof window.renderBadges === 'function') window.renderBadges();
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
  overlay.id = 'push-ask-overlay';
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
      <button onclick="requestPushPermission('post_game');document.getElementById('push-ask-overlay')?.remove()"
        style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:13px;font-size:15px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">
        🔔 ${lang==='ru'?'Включить уведомления':'Enable notifications'}
      </button>
      <button onclick="document.getElementById('push-ask-overlay')?.remove();localStorage.setItem('${PUSH_ASKED_KEY}','1')"
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
// initAuth() is called by app.js — do not call again here

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


// ── Rematch ───────────────────────────────────────────────────────
async function startRematch() {
  document.getElementById('rematch-hint')?.remove();
  const oppUserId = _duelOppUserId;
  const oppName   = duelOppNameStr;
  // Create a fresh duel as host
  await createDuel();
  // Notify opponent via push
  if (window.sendPushToUser && oppUserId && duelCode) {
    window.sendPushToUser(oppUserId, {
      title: `⚔️ ${duelMyName} предлагает реванш!`,
      body: 'Открой Brain Fight Club — соперник ждёт',
      url: '/?duel=' + duelCode,
      tag: 'duel-rematch',
    });
  }
  if (typeof window.toast === 'function') window.toast('⚔️ Реванш! Ждём ' + oppName + '…');
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
window.duelPlayAgain         = duelPlayAgain;
window.startRematch          = startRematch;
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

// ── Per-player dot helpers ────────────────────────────────────────
function buildBattleDots(n) {
  buildDots('d-my-dots', n);
  buildDots('d-opp-dots', n);
  // Label opp row with short name
  const oppShort = window._isBotDuel
    ? (window._botPlayer?.name?.split(' ')[0] || 'Бот')
    : (duelOppNameStr?.split(' ')[0] || 'Соп.');
  const lbl = document.getElementById('d-opp-dots-label');
  if (lbl) lbl.textContent = oppShort.slice(0, 6);
  const me = document.getElementById('d-my-dots-label');
  if (me) me.textContent = duelMyName?.split(' ')[0]?.slice(0, 6) || 'Я';
}

function setMyDot(i, pts, isCorrect) {
  const d = document.getElementById('d-my-dots-dot-' + i);
  if (!d) return;
  // pts===null → neutral submitted (real duel LIVE — correctness intentionally hidden)
  if (pts === null) {
    d.className = 'dot answered';
    d.textContent = '•';
    return;
  }
  d.className = 'dot ' + (isCorrect ? 'done' : 'miss');
  d.textContent = isCorrect ? '+' + pts : '✗';
}

function setOppDot(i, isCorrect, pts) {
  const d = document.getElementById('d-opp-dots-dot-' + i);
  if (!d) return;
  // isCorrect===null → neutral submitted (real duel LIVE — opponent correctness hidden)
  if (isCorrect === null) {
    d.className = 'dot answered';
    d.textContent = '•';
    return;
  }
  d.className = 'dot ' + (isCorrect ? 'done' : 'miss');
  d.textContent = isCorrect ? (pts ? '+' + pts : '✓') : '✗';
}

// Called by matchmaking when this player is the "finder" and should act as host
window.mmStartAsHost = async function(code, myName) {
  _isRandomBattle = true;
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
