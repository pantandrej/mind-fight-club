// ── Matchmaking / Random Battle ───────────────────────────────────
// Pairs players for random duels. Shares battle limit with friend duels.

// MATCHMAKING / RANDOM BATTLE
// ═══════════════════════════════════════════
let mmInterval = null;
let mmQueueId = null;
let mmTimeout = null;

const BOT_PLAYERS = [
  // 🇷🇺 Russia
  { name:'Алексей М.',    city:'Москва',              flag:'🇷🇺', avatar:'🧠', skill:0.72 },
  { name:'Катя В.',       city:'Санкт-Петербург',     flag:'🇷🇺', avatar:'🎯', skill:0.65 },
  { name:'Тимур Р.',      city:'Казань',              flag:'🇷🇺', avatar:'⚡', skill:0.80 },
  { name:'Ника З.',       city:'Новосибирск',         flag:'🇷🇺', avatar:'🦊', skill:0.60 },
  // 🇺🇸 USA
  { name:'James T.',      city:'New York',            flag:'🇺🇸', avatar:'🏆', skill:0.78 },
  { name:'Sofia R.',      city:'Los Angeles',         flag:'🇺🇸', avatar:'🌟', skill:0.70 },
  { name:'Marcus L.',     city:'Chicago',             flag:'🇺🇸', avatar:'🔥', skill:0.66 },
  { name:'Emma K.',       city:'Austin',              flag:'🇺🇸', avatar:'💡', skill:0.74 },
  // 🇬🇧 UK
  { name:'Oliver B.',     city:'London',              flag:'🇬🇧', avatar:'👑', skill:0.82 },
  { name:'Chloe W.',      city:'Manchester',          flag:'🇬🇧', avatar:'🎭', skill:0.67 },
  // 🇩🇪 Germany
  { name:'Lukas F.',      city:'Berlin',              flag:'🇩🇪', avatar:'⚙️', skill:0.77 },
  { name:'Anna S.',       city:'Munich',              flag:'🇩🇪', avatar:'🧪', skill:0.71 },
  // 🇫🇷 France
  { name:'Léa M.',        city:'Paris',               flag:'🇫🇷', avatar:'🗼', skill:0.69 },
  { name:'Hugo D.',       city:'Lyon',                flag:'🇫🇷', avatar:'🍷', skill:0.62 },
  // 🇪🇸 Spain
  { name:'Pablo G.',      city:'Madrid',              flag:'🇪🇸', avatar:'⚽', skill:0.75 },
  { name:'María C.',      city:'Barcelona',           flag:'🇪🇸', avatar:'🎨', skill:0.68 },
  // 🇮🇹 Italy
  { name:'Marco R.',      city:'Rome',                flag:'🇮🇹', avatar:'🏛️', skill:0.73 },
  { name:'Giulia F.',     city:'Milan',               flag:'🇮🇹', avatar:'👗', skill:0.64 },
  // 🇧🇷 Brazil
  { name:'Lucas O.',      city:'São Paulo',           flag:'🇧🇷', avatar:'🎸', skill:0.76 },
  { name:'Ana B.',        city:'Rio de Janeiro',      flag:'🇧🇷', avatar:'🌴', skill:0.61 },
  // 🇯🇵 Japan
  { name:'Yuki T.',       city:'Tokyo',               flag:'🇯🇵', avatar:'🌸', skill:0.85 },
  { name:'Kenji M.',      city:'Osaka',               flag:'🇯🇵', avatar:'⛩️', skill:0.79 },
  // 🇰🇷 South Korea
  { name:'Jimin P.',      city:'Seoul',               flag:'🇰🇷', avatar:'🎮', skill:0.83 },
  { name:'Soyeon K.',     city:'Busan',               flag:'🇰🇷', avatar:'🎵', skill:0.70 },
  // 🇨🇳 China
  { name:'Wei Zhang',     city:'Shanghai',            flag:'🇨🇳', avatar:'🐉', skill:0.81 },
  { name:'Mei Lin',       city:'Beijing',             flag:'🇨🇳', avatar:'🏮', skill:0.74 },
  // 🇮🇳 India
  { name:'Arjun S.',      city:'Mumbai',              flag:'🇮🇳', avatar:'🎯', skill:0.77 },
  { name:'Priya N.',      city:'Bangalore',           flag:'🇮🇳', avatar:'💻', skill:0.80 },
  // 🇦🇺 Australia
  { name:'Liam C.',       city:'Sydney',              flag:'🇦🇺', avatar:'🦘', skill:0.66 },
  { name:'Olivia H.',     city:'Melbourne',           flag:'🇦🇺', avatar:'🌊', skill:0.72 },
  // 🇨🇦 Canada
  { name:'Noah M.',       city:'Toronto',             flag:'🇨🇦', avatar:'🍁', skill:0.69 },
  { name:'Emma T.',       city:'Vancouver',           flag:'🇨🇦', avatar:'🏔️', skill:0.63 },
  // 🇹🇷 Turkey
  { name:'Emre A.',       city:'Istanbul',            flag:'🇹🇷', avatar:'🕌', skill:0.74 },
  { name:'Ayşe K.',       city:'Ankara',              flag:'🇹🇷', avatar:'🌙', skill:0.67 },
  // 🇦🇷 Argentina
  { name:'Matías L.',     city:'Buenos Aires',        flag:'🇦🇷', avatar:'🥩', skill:0.71 },
  // 🇳🇬 Nigeria
  { name:'Chidi O.',      city:'Lagos',               flag:'🇳🇬', avatar:'🦁', skill:0.76 },
  // 🇿🇦 South Africa
  { name:'Thabo M.',      city:'Johannesburg',        flag:'🇿🇦', avatar:'🌍', skill:0.68 },
  // 🇸🇦 Saudi Arabia
  { name:'Faisal A.',     city:'Riyadh',              flag:'🇸🇦', avatar:'🌴', skill:0.70 },
  // 🇲🇽 Mexico
  { name:'Carlos H.',     city:'Mexico City',         flag:'🇲🇽', avatar:'🌮', skill:0.65 },
  // 🇵🇱 Poland
  { name:'Piotr W.',      city:'Warsaw',              flag:'🇵🇱', avatar:'🦅', skill:0.73 },
];

function pickRandomBot(){
  return BOT_PLAYERS[Math.floor(Math.random() * BOT_PLAYERS.length)];
}

// Legacy: keep BOT_NAMES for any old references
const BOT_NAMES = BOT_PLAYERS.map(b => `${b.flag} ${b.name} (${b.city})`);


// ── checkBattleLimitBeforeQueue ───────────────────────────────────
// Reads today's battle count from game_sessions + checks subscription.
// Does NOT create any session record — safe to call before queue insert.
// Returns { allowed, used, limit, plan }
async function checkBattleLimitBeforeQueue() {
  if (!window.sb || !currentUser) return { allowed: true, used: 0, limit: 3, plan: 'free' };
  try {
    const today = new Date().toISOString().slice(0, 10);

    // Count today's non-social battles
    const { count: used, error: cErr } = await window.sb
      .from('game_sessions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUser.id)
      .eq('day_utc', today)
      .in('mode', ['friend_battle', 'random_battle', 'virtual_battle'])
      .eq('social_bonus', false);

    if (cErr) throw cErr;

    // Check active premium
    const { data: subRows } = await window.sb
      .from('subscriptions')
      .select('plan')
      .eq('user_id', currentUser.id)
      .eq('plan', 'premium')
      .gt('current_period_end', new Date().toISOString())
      .limit(1);

    const isPremium = Array.isArray(subRows) && subRows.length > 0;
    const plan      = isPremium ? 'premium' : 'free';
    // Use PLAN_LIMITS from config.js if available; fallback to safe defaults
    const planLimits = typeof PLAN_LIMITS !== 'undefined'
      ? PLAN_LIMITS
      : { free: { battlesPerDay: 3 }, premium: { battlesPerDay: 10 } };
    const limit = planLimits[plan]?.battlesPerDay ?? (isPremium ? 10 : 3);

    return { allowed: (used ?? 0) < limit, used: used ?? 0, limit, plan };
  } catch (e) {
    console.warn('[matchmaking] battle limit pre-check failed:', e.message);
    return { allowed: true, used: 0, limit: 3, plan: 'free' }; // fail-open; server enforces
  }
}

async function startMatchmaking(){

  if(!currentUser){ _showSignInToPlay(); return; }

  // ── Pre-check: limit BEFORE opening matchmaking screen or inserting to queue ──
  const _preLC = await checkBattleLimitBeforeQueue();
  if (!_preLC.allowed) {
    track('battle_limit_reached', { used: _preLC.used, limit: _preLC.limit, plan: _preLC.plan, trigger: 'matchmaking_pre' });
    window.showDailyLimitScreen?.('battle');
    return;
  }

  showScreen('matchmaking');
  document.getElementById('n-mm').textContent = neurons;
  const myName = currentUser.user_metadata?.full_name?.split(' ')[0]||currentUser.email?.split('@')[0]||'You';
  const myInitial = myName[0].toUpperCase();
  document.getElementById('mm-av-me').textContent = myInitial;
  document.getElementById('mm-name-me').textContent = myName;
  document.getElementById('mm-av-opp').textContent = '?';
  document.getElementById('mm-av-opp').className = 'mm-av searching';
  document.getElementById('mm-name-opp').textContent = '...';
  document.getElementById('mm-status').textContent = lang==='ru'?'Ищем соперника...':'Ищем соперника...';
  document.getElementById('mm-ring').style.display = '';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = '';

  // Insert into matchmaking queue
  const {data:qRow, error} = await sb.from('matchmaking_queue').insert({
    user_id: currentUser.id,
    display_name: myName,
    status: 'waiting',
    created_at: new Date().toISOString()
  }).select().single();

  if(error){ toast('Error: '+error.message); return; }
  mmQueueId = qRow.id;
  track('matchmaking_started', {});

  let elapsed = 0;
  mmInterval = setInterval(async()=>{
    elapsed++;
    // Update countdown
    const remaining = 30 - elapsed;
    if(remaining > 0)
      document.getElementById('mm-sub').textContent = (lang==='ru'?'Осталось ':'Up to ')+remaining+'s';

    // Check if matched
    const {data:myRow} = await sb.from('matchmaking_queue').select('status,matched_duel_id').eq('id',mmQueueId).single();
    if(myRow?.status === 'matched' && myRow?.matched_duel_id){
      clearInterval(mmInterval);
      await matchFound(myRow.matched_duel_id, myName);
      return;
    }

    // Check for waiting opponents
    const {data:opponents} = await sb.from('matchmaking_queue')
      .select('id,user_id,display_name')
      .eq('status','waiting')
      .neq('user_id', currentUser.id)
      .limit(1);

    if(opponents && opponents.length > 0){
      const opp = opponents[0];
      // Create duel and match both
      const duelCode = randCode();
      await sb.from('duel_rooms').insert({
        code: duelCode, host_score:0, guest_score:0,
        status:'waiting', created_at:new Date().toISOString(),
        host_name: myName, guest_name: opp.display_name
      });
      // Match both players
      await sb.from('matchmaking_queue').update({status:'matched', matched_duel_id:duelCode}).eq('id',mmQueueId);
      await sb.from('matchmaking_queue').update({status:'matched', matched_duel_id:duelCode}).eq('id',opp.id);
      clearInterval(mmInterval);
      // Push notify opponent (fire-and-forget, don't block on failure)
      if (window.sendPushToUser) {
        window.sendPushToUser(opp.user_id, {
          title: `⚔️ ${myName} вызывает на дуэль!`,
          body:  'Соперник найден — открой Brain Fight Club!',
          url:   '/?duel=' + duelCode,
          tag:   'duel-invite',
        });
      }
      await matchFound(duelCode, myName, opp.display_name);
      return;
    }

    // Show bot option after 10s
    if(elapsed === 10){
      const bot = pickRandomBot();
      window._pendingBot = bot;
      document.getElementById('mm-bot-wrap').style.display = '';
      const botBtn = document.getElementById('mm-bot-btn');
      if(botBtn) botBtn.textContent =
        lang==='ru'
          ? `🤖 Играть с ${bot.flag} ${bot.name} (${bot.city})`
          : `🤖 Play vs ${bot.flag} ${bot.name} (${bot.city})`;
    }
    // Auto-start bot after 30s — don't leave user stranded
    if(elapsed >= 30){
      clearInterval(mmInterval); mmInterval = null;
      // Auto-launch the pre-selected bot
      if(window._pendingBot){
        window._botPlayer = window._pendingBot;
        window._isBotDuel = true;
        const bot = window._pendingBot;
        document.getElementById('mm-av-opp').textContent = bot.avatar;
        document.getElementById('mm-av-opp').className = 'mm-av found';
        document.getElementById('mm-name-opp').textContent = `${bot.flag} ${bot.name}`;
        document.getElementById('mm-ring').style.display = 'none';
        document.getElementById('mm-status').textContent =
          lang==='ru' ? `Нашли соперника: ${bot.flag} ${bot.name} из ${bot.city}` : `Found: ${bot.flag} ${bot.name} from ${bot.city}`;
        document.getElementById('mm-sub').textContent =
          lang==='ru' ? 'Начинаем...' : 'Starting...';
        document.getElementById('mm-bot-wrap').style.display = 'none';
        document.getElementById('mm-cancel-btn').style.display = 'none';
        if(mmQueueId){
          sb.from('matchmaking_queue').update({status:'cancelled'}).eq('id',mmQueueId).then(()=>{}).catch(()=>{});
          mmQueueId = null;
        }
        track('bot_battle_auto', {bot: bot.name});
        setTimeout(()=>startBotDuel(bot.name), 1000);
      } else {
        document.getElementById('mm-ring').style.display = 'none';
        document.getElementById('mm-status').textContent = lang==='ru'?'Соперников не найдено':'No opponents found';
        document.getElementById('mm-sub').textContent = lang==='ru'?'Попробуй сыграть с ботом':'Try playing with a bot';
      }
    }
  }, 1000);
}

async function matchFound(duelCode, myName, oppName){
  // ── Charge session when match is actually found ──────────────────
  if (window.sb && window._appState?.getState().currentUser) {
    const { data: _sd, error: _se } = await window.sb.rpc('start_game_session', {
      p_mode: 'random_battle',
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
    // Mark session as already started — startDuelBattle will skip its own RPC call
    window._currentSessionId     = _sd.session_id || null;
    window._battleSessionStarted = true;
  }

  const opp = oppName || '?';
  const initial = opp[0].toUpperCase();
  document.getElementById('mm-av-opp').textContent = initial;
  document.getElementById('mm-av-opp').className = 'mm-av found';
  document.getElementById('mm-name-opp').textContent = opp;
  document.getElementById('mm-ring').style.display = 'none';
  document.getElementById('mm-status').style.display = 'none';
  document.getElementById('mm-sub').style.display = 'none';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = 'none';
  const confirmWrap = document.getElementById('mm-confirm-wrap');
  const confirmOpp  = document.getElementById('mm-confirm-opp');
  const countdown   = document.getElementById('mm-ready-countdown');
  if(confirmOpp) confirmOpp.textContent = lang==='ru'?`Соперник: ${opp} — готов к бою?`:`Opponent: ${opp} — ready to fight?`;
  if(confirmWrap) confirmWrap.style.display = 'block';
  track('matchmaking_matched', {code: duelCode});

  // Countdown 3s → auto-start if no tap
  let secs = 3;
  if(countdown) countdown.textContent = `(${secs})`;
  const cdInterval = setInterval(()=>{
    secs--;
    if(countdown) countdown.textContent = secs > 0 ? `(${secs})` : '';
    if(secs <= 0) { clearInterval(cdInterval); window._mmConfirmReady?.(); }
  }, 1000);

  // Ready button handler
  await new Promise(resolve => {
    window._mmConfirmReady = ()=>{
      clearInterval(cdInterval);
      if(confirmWrap) confirmWrap.style.display = 'none';
      window._mmConfirmReady = null;
      resolve();
    };
  });

  if (oppName) {
    // This player found the match — act as host: load questions and start game
    showScreen('duel');
    showDuelSection('d-battle');
    // Set module-level duel state via the input (joinDuel reads it)
    document.getElementById('join-code-input').value = duelCode;
    // Set global duel vars directly so startDuelGame uses the right code
    window._mmDuelCode = duelCode;
    window._mmDuelRole = 'host';
    window._mmDuelMyName = myName;
    // Initialise state and start as host
    window.mmStartAsHost?.(duelCode, myName);
  } else {
    // This player was waiting — act as guest: poll for questions from host
    if(typeof window !== 'undefined') window._isRandomBattle = true;
    document.getElementById('join-code-input').value = duelCode;
    showScreen('duel');
    joinDuel();
  }
}

async function playWithBot(){

  clearInterval(mmInterval); mmInterval = null;
  clearTimeout(mmTimeout);   mmTimeout  = null;

  // Reuse the bot already shown on screen; fall back to a fresh pick if needed
  const bot = window._pendingBot || pickRandomBot();
  window._pendingBot = bot;   // keep consistent for the rest of the flow
  window._botPlayer  = bot;
  window._botName    = bot.name;
  window._isBotDuel  = true;

  if(mmQueueId){
    sb.from('matchmaking_queue').update({status:'cancelled'}).eq('id',mmQueueId).then(()=>{}).catch(()=>{});
    mmQueueId = null;
  }

  // ── Pre-check: limit BEFORE showing "bot accepted" and before startBotDuel ──
  const _botLC = await checkBattleLimitBeforeQueue();
  if (!_botLC.allowed) {
    track('battle_limit_reached', { used: _botLC.used, limit: _botLC.limit, plan: _botLC.plan, trigger: 'bot_pre' });
    window.showDailyLimitScreen?.('battle');
    return;
  }

  document.getElementById('mm-av-opp').textContent = bot.avatar;
  document.getElementById('mm-av-opp').className = 'mm-av found';
  document.getElementById('mm-name-opp').textContent = `${bot.flag} ${bot.name}`;
  document.getElementById('mm-ring').style.display = 'none';
  document.getElementById('mm-status').textContent =
    lang==='ru' ? `${bot.flag} ${bot.name} из ${bot.city} принял вызов!` : `${bot.flag} ${bot.name} from ${bot.city} accepted!`;
  document.getElementById('mm-sub').textContent =
    lang==='ru' ? 'Начинаем дуэль...' : 'Starting duel...';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = 'none';
  track('bot_battle_started', {bot: bot.name, city: bot.city});
  setTimeout(()=>{ startBotDuel(bot.name); }, 1000);
}

async function startBotDuel(botName){
  // ── Server-side limit check (battle limit) ────────────────────
  if (window.sb && window._appState?.getState().currentUser) {
    const { data: _sd, error: _se } = await window.sb.rpc('start_game_session', {
      p_mode: 'virtual_battle',
      p_opponent_id: null,
      p_invite_id:   null,
    });
    // Hard block on any failure — no fallback for rated play
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
    // Mark session started — startDuelBattle called later will skip its own RPC
    window._currentSessionId     = _sd.session_id || null;
    window._battleSessionStarted = true;
  }

  let bot = window._botPlayer || null;
  window._botName    = botName;
  window._isBotDuel  = true;
  window._botAnswerTimeout = null;

  // State
  duelRole     = 'host';
  duelCode     = 'BOT-' + Date.now(); // local-only, never sent to Supabase
  duelMyName   = currentUser?.user_metadata?.full_name?.split(' ')[0]
                 || currentUser?.user_metadata?.name
                 || currentUser?.email?.split('@')[0]
                 || 'Вы';
  duelMyScore  = 0;
  duelOppScore = 0;
  duelIdx      = 0;
  duelQs       = [];
  if(duelPoll)  { clearInterval(duelPoll);  duelPoll  = null; }
  if(duelTimer) { clearInterval(duelTimer); duelTimer = null; }

  // Load canonical 5-question battle [2,3,4,5,6] from DB via loadBattleQuestions
  // This is the SAME source as friend battle — ensures consistent q/a/c format
  let botBattleQs = null;
  if (typeof window.loadBattleQuestions === 'function') {
    botBattleQs = await window.loadBattleQuestions(lang);
  }

  console.log('[BFC bot battle questions]', {
    selected: botBattleQs?.length,
    optCounts: botBattleQs?.map(q => q.a?.length),
    first: botBattleQs?.[0],
  });

  if (!botBattleQs || botBattleQs.length < 5) {
    window.toast?.(lang === 'ru'
      ? '⚠️ Недостаточно вопросов для баттла. Попробуйте позже.'
      : '⚠️ Not enough questions. Try again later.');
    showScreen('home');
    return;
  }
  // Pre-set opponent name so it shows immediately (CSS uppercases it)
  bot = window._botPlayer;
  if (bot) {
    const oppEl = document.getElementById('ds-opp-name');
    if (oppEl) oppEl.textContent = (bot.flag ? bot.flag + ' ' : '') + bot.name;
  }
  window._pendingDuelQs = botBattleQs;
  showScreen('duel');
  showDuelSection('d-battle');
  window.startDuelBattle({ chargeSession: false, questions: botBattleQs });
}

function cancelMatchmaking(){
  clearInterval(mmInterval); mmInterval = null;
  clearTimeout(mmTimeout);   mmTimeout  = null;
  window._pendingBot = null;
  if(mmQueueId){
    sb.from('matchmaking_queue').update({status:'cancelled'}).eq('id',mmQueueId).then(()=>{}).catch(()=>{});
    mmQueueId = null;
  }
  window._isBotDuel = false;
  showPlayMenu();
}

// ═══════════════════════════════════════════
// RULES SCREEN
// ═══════════════════════════════════════════
function toggleRulesSection(id){
  const body = document.getElementById(id);
  const arrow = document.getElementById(id+'-arr');
  if(!body) return;
  const isOpen = body.classList.contains('open');
  // Close all
  document.querySelectorAll('.rules-body').forEach(b=>b.classList.remove('open'));
  document.querySelectorAll('.rules-arrow').forEach(a=>a.classList.remove('open'));
  // Open clicked if was closed
  if(!isOpen){
    body.classList.add('open');
    if(arrow) arrow.classList.add('open');
  }
}

// Also update showProfile to translate new elements
const _origShowProfile = typeof showProfile === 'function' ? showProfile : null;

// ═══════════════════════════════════════════


// ── window exports ────────────────────────────────────────────────
if (typeof startMatchmaking !== 'undefined') window.startMatchmaking = startMatchmaking;
if (typeof stopMatchmaking  !== 'undefined') window.stopMatchmaking  = stopMatchmaking;

// ── Sign-in wall for guest matchmaking ───────────────────────────
function _showSignInToPlay() {
  let modal = document.getElementById('signin-to-play-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'signin-to-play-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,20,.88);display:flex;align-items:flex-end;justify-content:center';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  const L = lang === 'ru';
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px 24px 0 0;padding:28px 24px;width:100%;max-width:480px;border-top:0.5px solid var(--border)">
    <div style="font-size:22px;font-weight:900;margin-bottom:6px">⚔️ ${L ? 'Войди чтобы играть' : 'Sign in to play'}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:24px;line-height:1.5">
      ${L ? 'Для случайных боёв нужен аккаунт — чтобы сохранять рекорды и находить реальных соперников.' : 'An account is needed for random battles — to save your records and find real opponents.'}
    </div>
    <button onclick="document.getElementById('signin-to-play-modal').remove();if(typeof window.signInGoogle==='function')window.signInGoogle()"
      style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:15px;font-size:15px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px;display:flex;align-items:center;justify-content:center;gap:10px">
      <svg width="18" height="18" viewBox="0 0 18 18"><path fill="#fff" opacity=".9" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908C16.658 14.074 17.64 11.768 17.64 9.2z"/><path fill="#fff" opacity=".9" d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332C2.438 15.983 5.482 18 9 18z"/><path fill="#fff" opacity=".9" d="M3.964 10.707c-.18-.54-.282-1.117-.282-1.707s.102-1.167.282-1.707V4.961H.957C.347 6.175 0 7.548 0 9s.348 2.825.957 4.039l3.007-2.332z"/><path fill="#fff" opacity=".9" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.961L3.964 7.293C4.672 5.166 6.656 3.58 9 3.58z"/></svg>
      ${L ? 'Войти через Google' : 'Sign in with Google'}
    </button>
    <button onclick="document.getElementById('signin-to-play-modal').remove();if(typeof window.startBotDuel==='function')window.startBotDuel(window.pickRandomBot?.()?.name||'Bot')"
      style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit;margin-bottom:8px">
      🤖 ${L ? 'Сыграть с ботом (без регистрации)' : 'Play vs bot (no sign-in)'}
    </button>
    <button onclick="document.getElementById('signin-to-play-modal').remove()"
      style="width:100%;background:transparent;border:none;padding:10px;font-size:13px;color:var(--muted);cursor:pointer;font-family:inherit">
      ${L ? 'Отмена' : 'Cancel'}
    </button>
  </div>`;
  modal.style.display = 'flex';
}

// ── Window exports ────────────────────────────────────────────────
window.pickRandomBot      = pickRandomBot;
window.startMatchmaking   = startMatchmaking;
window.matchFound         = matchFound;
window.playWithBot        = playWithBot;
window.startBotDuel       = startBotDuel;
window.cancelMatchmaking  = cancelMatchmaking;
window.toggleRulesSection = toggleRulesSection;
