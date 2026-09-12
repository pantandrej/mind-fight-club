// ── Matchmaking / Random Battle ───────────────────────────────────
// Pairs players for random duels. Shares battle limit with friend duels.

// MATCHMAKING / RANDOM BATTLE
// ═══════════════════════════════════════════
let mmInterval = null;
let mmQueueId = null;
let mmTimeout = null;

// Canonical virtual opponents — exactly 3, structurally isolated from real duels
const BOT_PLAYERS = [
  { name:'Макс',   city:'Казань',   flag:'🇷🇺', avatar:'⚡', skill:0.575, minDelay:4000, maxDelay:14000 },
  { name:'София',  city:'Алматы',   flag:'🇰🇿', avatar:'🌸', skill:0.705, minDelay:3000, maxDelay:12000 },
  { name:'Даниил', city:'Тбилиси',  flag:'🇬🇪', avatar:'🧠', skill:0.84,  minDelay:2000, maxDelay:10000 },
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
  document.getElementById('mm-status').textContent = lang==='ru'?'Ищем соперника...':'Looking for an opponent...';
  document.getElementById('mm-ring').style.display = '';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-bot-offer').style.display = 'none';
  document.getElementById('mm-confirm-wrap').style.display = 'none';
  window._confirmBotMatch = null;
  document.getElementById('mm-cancel-btn').style.display = '';

  // Battle board: show after 15s so real match has time to form
  const boardWrap = document.getElementById('mm-board-wrap');
  if (boardWrap) boardWrap.style.display = 'none';

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
    const remaining = 15 - elapsed;
    if(remaining > 0)
      document.getElementById('mm-sub').textContent = (lang==='ru'?'Осталось ':'Up to ')+remaining+'s';

    // Every tick: attempt atomic server-side claim (BLOCKER 2/3 fix).
    // No pre-query for opponents — claim_random_match handles that under advisory lock.
    const { data: claimData, error: claimErr } = await sb.rpc('claim_random_match');
    if(!claimErr && claimData?.ok && claimData?.matched) {
      clearInterval(mmInterval); mmInterval = null;
      clearInterval(_boardInterval); _boardInterval = null;
      const duelCode   = claimData.duel_code;
      const oppName    = claimData.opponent_name;
      await matchFound(duelCode, myName, oppName);
      return;
    }

    // Timer expired — call canonical cancel RPC then offer virtual opponents
    if(elapsed >= 15){
      clearInterval(mmInterval); mmInterval = null;
      clearInterval(_boardInterval); _boardInterval = null;
      // cancel_random_matchmaking: under advisory lock, safe against claim race
      const { data: cancelData } = await sb.rpc('cancel_random_matchmaking').catch(()=>({data:null}));
      if(cancelData?.matched) {
        // Server matched us just before we tried to cancel — enter real match
        await matchFound(cancelData.duel_code, myName, cancelData.opponent_name || '?');
        return;
      }
      mmQueueId = null;
      _showBotOffer(window._pendingBot || pickRandomBot());
    }
  }, 1000);
}

async function matchFound(duelCode, myName, oppName){
  clearInterval(_boardInterval); _boardInterval = null;
  const boardWrap = document.getElementById('mm-board-wrap');
  if (boardWrap) boardWrap.style.display = 'none';
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
  track('matchmaking_matched', {code: duelCode});

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
    sb.rpc('cancel_random_matchmaking').catch(()=>{});
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
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = 'none';
  document.getElementById('mm-status').style.display = 'none';
  document.getElementById('mm-sub').style.display = 'none';
  document.getElementById('mm-board-wrap').style.display = 'none';
  track('bot_battle_started', {bot: bot.name, city: bot.city});
  startBotDuel(bot.name);
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
  clearInterval(_boardInterval); _boardInterval = null;
  window._pendingBot = null;
  if(mmQueueId){
    sb.rpc('cancel_random_matchmaking').catch(()=>{});
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

// ── Virtual opponent selection screen ────────────────────────────
// Called when live search timer expires. Shows all 3 virtual personas
// for user to choose from. Subtle "виртуальный игрок" disclosure.
// Never auto-starts — waits for explicit user choice.
function _showBotOffer(_ignored) {
  window._isBotDuel = true;

  // Hide search UI
  document.getElementById('mm-ring').style.display        = 'none';
  document.getElementById('mm-status').style.display      = 'none';
  document.getElementById('mm-sub').style.display         = 'none';
  document.getElementById('mm-bot-wrap').style.display    = 'none';
  document.getElementById('mm-cancel-btn').style.display  = 'none';
  document.getElementById('mm-board-wrap').style.display  = 'none';
  document.getElementById('mm-confirm-wrap').style.display= 'none';

  // Reset VS row to generic
  document.getElementById('mm-av-opp').textContent  = '🤖';
  document.getElementById('mm-av-opp').className    = 'mm-av';
  document.getElementById('mm-name-opp').textContent= lang === 'ru' ? 'виртуальный игрок' : 'virtual player';

  // Build persona selection list inside mm-bot-offer
  const offerEl = document.getElementById('mm-bot-offer');
  offerEl.style.display = 'block';

  const label = document.getElementById('mm-bot-offer-label');
  if (label) label.textContent = lang === 'ru'
    ? 'Живых соперников не нашли. Выбери виртуального:'
    : 'No live opponents found. Choose a virtual player:';

  // Render persona cards (replace any previously rendered ones)
  let cardWrap = document.getElementById('mm-persona-cards');
  if (!cardWrap) {
    cardWrap = document.createElement('div');
    cardWrap.id = 'mm-persona-cards';
    cardWrap.style.cssText = 'display:flex;gap:10px;margin-top:12px;flex-wrap:wrap;justify-content:center';
    offerEl.appendChild(cardWrap);
  }
  cardWrap.innerHTML = '';

  BOT_PLAYERS.forEach(bot => {
    const card = document.createElement('button');
    card.style.cssText = 'flex:1;min-width:90px;max-width:120px;padding:12px 8px;border-radius:12px;border:1px solid var(--border);background:var(--bg2);cursor:pointer;font-family:inherit;text-align:center';
    const skillLabel = bot.skill >= 0.8 ? '★★★' : bot.skill >= 0.65 ? '★★☆' : '★☆☆';
    card.innerHTML = `<div style="font-size:22px">${bot.avatar}</div>
      <div style="font-weight:700;font-size:14px;margin:4px 0">${bot.name}</div>
      <div style="font-size:11px;color:var(--muted)">${bot.flag} ${bot.city}</div>
      <div style="font-size:11px;margin-top:4px">${skillLabel}</div>`;
    card.onclick = async () => {
      window._pendingBot = bot;
      window._botPlayer  = bot;
      offerEl.style.display = 'none';

      const lc = await checkBattleLimitBeforeQueue();
      if (!lc.allowed) {
        track('battle_limit_reached', { used: lc.used, limit: lc.limit, plan: lc.plan, trigger: 'bot_offer' });
        window.showDailyLimitScreen?.('battle');
        return;
      }
      // Update VS row with chosen persona
      document.getElementById('mm-av-opp').textContent  = bot.avatar;
      document.getElementById('mm-av-opp').className    = 'mm-av found';
      document.getElementById('mm-name-opp').textContent= `${bot.flag} ${bot.name}`;
      track('bot_battle_started', { bot: bot.name, city: bot.city, via: 'offer' });
      startBotDuel(bot.name);
    };
    cardWrap.appendChild(card);
  });
}

// ── Shared confirmation screen ────────────────────────────────────
// Shows "Соперник найден!" with 10s countdown. Resolves when user taps
// "Начать бой!" or countdown expires. Used for both real matches and bots.
async function _showMatchConfirmation(oppLabel) {
  const confirmWrap = document.getElementById('mm-confirm-wrap');
  const confirmOpp  = document.getElementById('mm-confirm-opp');
  const countdown   = document.getElementById('mm-ready-countdown');
  if (confirmOpp) confirmOpp.textContent = lang === 'ru'
    ? `Соперник: ${oppLabel} — готов к бою?`
    : `Opponent: ${oppLabel} — ready to fight?`;
  if (confirmWrap) confirmWrap.style.display = 'block';

  let secs = 10;
  if (countdown) countdown.textContent = `(${secs})`;

  return new Promise(resolve => {
    const cdInterval = setInterval(() => {
      secs--;
      if (countdown) countdown.textContent = secs > 0 ? `(${secs})` : '';
      if (secs <= 0) {
        clearInterval(cdInterval);
        // Timer expired = auto-decline, go back
        if (confirmWrap) confirmWrap.style.display = 'none';
        window._mmConfirmReady   = null;
        window._mmConfirmDecline = null;
        resolve(false);
      }
    }, 1000);

    window._mmConfirmReady = () => {
      clearInterval(cdInterval);
      if (confirmWrap) confirmWrap.style.display = 'none';
      window._mmConfirmReady   = null;
      window._mmConfirmDecline = null;
      resolve(true);
    };
    window._mmConfirmDecline = () => {
      clearInterval(cdInterval);
      if (confirmWrap) confirmWrap.style.display = 'none';
      window._mmConfirmReady   = null;
      window._mmConfirmDecline = null;
      resolve(false);
    };
  });
}

// ── Battle Board: live list of open challenges ─────────────────────
let _boardInterval = null;

async function _renderBattleBoard() {
  const list = document.getElementById('mm-board-list');
  if (!list) return;
  try {
    const { data } = await sb.from('matchmaking_queue')
      .select('id,display_name,created_at')
      .eq('status', 'waiting')
      .neq('user_id', currentUser?.id || '')
      .order('created_at', { ascending: false })
      .limit(5);

    const rows = data || [];
    // Add bots to fill up to 5 slots
    const bots = [];
    const needed = Math.max(0, 3 - rows.length);
    for (let i = 0; i < needed; i++) {
      const b = BOT_PLAYERS[(Math.floor(Date.now() / 15000) + i * 7) % BOT_PLAYERS.length];
      bots.push({ id: 'bot:' + b.name, display_name: `${b.flag} ${b.name} (${b.city})`, isBot: true, bot: b });
    }

    const all = [...rows.map(r => ({ ...r, isBot: false })), ...bots];
    window._boardDataMap = {};
    list.innerHTML = all.map((r, idx) => {
      window._boardDataMap[idx] = r;
      return `
      <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg2);border-radius:14px;padding:10px 14px">
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(0,237,181,.2);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:var(--accent2)">
            ${r.isBot ? r.bot.avatar : r.display_name[0].toUpperCase()}
          </div>
          <div>
            <div style="font-size:13px;font-weight:700;color:var(--text)">${r.display_name}</div>
            <div style="font-size:11px;color:var(--muted)">${r.isBot ? '🤖 виртуальный игрок' : '🟢 Онлайн'}</div>
          </div>
        </div>
        <button onclick="window._acceptBoardRow(${idx})"
          style="background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:10px;padding:8px 14px;font-size:12px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">
          ⚔️ Принять
        </button>
      </div>`;
    }).join('');
  } catch(e) { /* silent */ }
}

window._acceptBoardRow = function(idx) {
  const r = window._boardDataMap?.[idx];
  if (!r) return;
  window._acceptChallenge(r.id, r.display_name, r.isBot, r.isBot ? r.bot : null);
};

window._acceptChallenge = async function(rowId, oppDisplayName, isBot, botData) {
  clearInterval(_boardInterval); _boardInterval = null;
  clearInterval(mmInterval); mmInterval = null;
  if (mmQueueId) {
    sb.rpc('cancel_random_matchmaking').catch(()=>{});
    mmQueueId = null;
  }

  if (isBot) {
    const bot = botData || pickRandomBot();
    window._botPlayer = bot;
    window._pendingBot = bot;
    window._isBotDuel = true;
    document.getElementById('mm-av-opp').textContent = bot.avatar;
    document.getElementById('mm-av-opp').className = 'mm-av found';
    document.getElementById('mm-name-opp').textContent = `${bot.flag} ${bot.name}`;
    document.getElementById('mm-ring').style.display = 'none';
    document.getElementById('mm-bot-wrap').style.display = 'none';
    document.getElementById('mm-cancel-btn').style.display = 'none';
    document.getElementById('mm-sub').style.display = 'none';
    document.getElementById('mm-board-wrap').style.display = 'none';
    const _botLC = await checkBattleLimitBeforeQueue();
    if (!_botLC.allowed) { window.showDailyLimitScreen?.('battle'); return; }
    startBotDuel(bot.name);
    return;
  }

  // Real player: atomic server-side match claim (B1, B2)
  const myName = currentUser?.user_metadata?.full_name?.split(' ')[0] || currentUser?.email?.split('@')[0] || 'You';
  const { data: claimData, error: claimErr } = await sb.rpc('claim_random_match');
  if(claimErr || !claimData?.ok || !claimData?.matched) {
    window.toast?.(lang==='ru' ? 'Не удалось принять вызов. Попробуй ещё раз.' : 'Could not accept challenge. Try again.');
    return;
  }
  const duelCode = claimData.duel_code;

  const opp = oppDisplayName;
  document.getElementById('mm-av-opp').textContent = opp[0].toUpperCase();
  document.getElementById('mm-av-opp').className = 'mm-av found';
  document.getElementById('mm-name-opp').textContent = opp;
  document.getElementById('mm-ring').style.display = 'none';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = 'none';
  document.getElementById('mm-board-wrap').style.display = 'none';

  const _preLC = await checkBattleLimitBeforeQueue();
  if (!_preLC.allowed) { window.showDailyLimitScreen?.('battle'); return; }

  window._mmDuelCode = duelCode;
  window._mmDuelRole = 'host';
  window._mmDuelMyName = myName;
  window.mmStartAsHost?.(duelCode, myName);
};

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
