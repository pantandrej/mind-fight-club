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

async function startMatchmaking(){

  if(!currentUser){ toast(lang==='ru'?'Войдите для поиска соперника':'Sign in to find opponents'); return; }
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
      window.toast?.('Дневной лимит баттлов исчерпан');
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
  document.getElementById('mm-status').textContent = lang==='ru'?'Соперник найден! 🎉':'Opponent found! 🎉';
  document.getElementById('mm-sub').textContent = lang==='ru'?'Начинаем дуэль...':'Starting duel...';
  document.getElementById('mm-bot-wrap').style.display = 'none';
  document.getElementById('mm-cancel-btn').style.display = 'none';
  track('matchmaking_matched', {code: duelCode});
  await new Promise(r=>setTimeout(r,1200));
  // Navigate to duel
  document.getElementById('join-code-input').value = duelCode;
  showScreen('duel');
  joinDuel();
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
      window.toast?.('Дневной лимит баттлов исчерпан');
      return;
    }
    // Mark session started — startDuelBattle called later will skip its own RPC
    window._currentSessionId     = _sd.session_id || null;
    window._battleSessionStarted = true;
  }

  const bot = window._botPlayer || null;
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

  // Build 7 playable questions from local pool
  let pool = (typeof ALL_Q !== 'undefined' ? ALL_Q : [])
    .concat(typeof ALL_Q_BASE !== 'undefined' ? ALL_Q_BASE : []);
  if(pool.length === 0 && typeof getAvailableQuestions === 'function'){
    pool = getAvailableQuestions('ALL');
  }
  // Normalise and filter
  const playable = (typeof filterPlayableQuestions === 'function'
    ? filterPlayableQuestions(pool.map(q => typeof toPlayableQuestion==='function' ? toPlayableQuestion(q) : q))
    : pool
  ).filter(q => q && q.q && Array.isArray(q.a) && q.a.length >= 2);

  // Shuffle and take 7
  // Build 5-question battle with progression: Q1=2opts, Q2=3, Q3=4, Q4=5, Q5=6
  const PROGRESSION = [2, 3, 4, 5, 6];
  const shuffled = [];
  for (const optCount of PROGRESSION) {
    const pool = playable.filter(q => Array.isArray(q.a) && q.a.length === optCount);
    if (!pool.length) {
      if (window.track) window.track('battle_question_shortage', { needed_option_count: optCount });
      window.toast?.('Недостаточно вопросов для баттла');
      return;
    }
    shuffled.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  if(shuffled.length < 3){
    toast(lang==='ru' ? '⚠️ Недостаточно вопросов для дуэли' : '⚠️ Not enough questions for duel');
    return;
  }
  duelQs = shuffled.map(q => ({
    ...q,
    q:  typeof q.q === 'object' ? (q.q[lang] || q.q.ru || q.q.en || '') : (q.q || ''),
    a:  Array.isArray(q.a)
          ? (typeof q.a[0] === 'object' ? (q.a.map(o => o[lang] || o.ru || o.en || String(o))) : q.a)
          : [],
    t:  q.t || 25,
    c:  q.c ?? q.correct_index ?? 0,
    cat: q.cat || q.category || 'GENERAL',
  }));

  showScreen('duel');
  showDuelSection('d-battle');
  // Session already charged in startBotDuel's RPC call — do not double-charge
  startDuelBattle({ chargeSession: false });
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

// ── Window exports ────────────────────────────────────────────────
window.pickRandomBot      = pickRandomBot;
window.startMatchmaking   = startMatchmaking;
window.matchFound         = matchFound;
window.playWithBot        = playWithBot;
window.startBotDuel       = startBotDuel;
window.cancelMatchmaking  = cancelMatchmaking;
window.toggleRulesSection = toggleRulesSection;
