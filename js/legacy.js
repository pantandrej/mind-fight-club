// ═══════════════════════════════════════════════════════════════════
// LEGACY SHIM — compatibility layer during ES module migration
// These aliases make legacy code use the module-provided globals.
// Remove each line as the corresponding module takes over.
// ═══════════════════════════════════════════════════════════════════


// ── Boot counters — remove before production ─────────────────────
// Each should show count=1 after a single page load.
// If any shows >1, there's a duplicate initialization bug.
console.count('[supabase] client created (legacy shim - should be 0 if module loaded first)');

// State aliases (legacy code uses bare variable names)
// These are live references — mutations in legacy still work
// because window.setState() syncs them back.
// TODO Iteration 2+: replace all bare variable references with getState()
let neurons     = 0;   // synced from state.js on balance update
let xp          = 0;
let currentUser = null;
let streak      = 0;
let bestStreak  = 0;
let correctCount= 0;
let curQ        = [];
let qIdx        = 0;
let timeLeft    = 0;
let maxT        = 0;
let timerInt    = null;
let answered    = false;
let _gameId     = null;
let _gameStartTime = null;
let _qStartTime    = null;
let _roundScore    = 0;
let _cityRank      = null;
let selectedCat    = 'ALL';
let selectedMode   = 'feed';
let wlCount        = 247;
let earnedBadges   = new Set(JSON.parse(localStorage.getItem('mfc_badges') || '[]'));
let lang           = 'ru';
let refCode        = null;

// Sync state module ↔ legacy globals (called after any state change)
function _syncStateToLegacy() {
  if (!window._appState) return;
  const s = window._appState.getState();
  neurons      = s.neurons;
  xp           = s.xp;
  currentUser  = s.currentUser;
  streak       = s.streak;
  bestStreak   = s.bestStreak;
  correctCount = s.correctCount;
  curQ         = s.curQ;
  qIdx         = s.qIdx;
  timeLeft     = s.timeLeft;
  maxT         = s.maxT;
  timerInt     = s.timerInt;
  answered     = s.answered;
  _gameId      = s.gameId;
  _roundScore  = s.roundScore;
  selectedCat  = s.selectedCat;
  selectedMode = s.selectedMode;
  lang         = s.lang;
  refCode      = s.refCode;
  earnedBadges = s.earnedBadges;
}
window._syncStateToLegacy = _syncStateToLegacy;

// Service aliases (legacy code calls sb directly)
// sb is set by services/supabase.js on the window object
// after the module loads (deferred — app.js loads after this script)
// We use a Proxy so calls before module load queue safely
let sb;
Object.defineProperty(window, '_sbReady', {
  set(client) { sb = client; },
  configurable: true,
});

// ═══════════════════════════════════════════════════════════════════


// [SUPABASE client] → moved to js/services/supabase.js
// sb is imported from that module and exposed via window.sb


// [ANALYTICS track()] → moved to js/services/analytics.js


// ═══════════════════════════════════════════
// I18N
// ═══════════════════════════════════════════
const T={
  en:{
    authSub:'Войдите, чтобы сохранить нейроны и соревноваться глобально',
    authGoogle:'Войти через Google',authOr:'или',
    authGuest:'Continue as guest',authNote:"Guest progress won't be saved",
    hLabel:'Beta',hTitle:'Fight with your mind. Win with your heart.',
    hSub:'Real-time quiz duels — with a friend, a random rival, or in a tournament.',
    hPlay:'⚡ Играть',hMode:'Режим',hTopic:'Тема',hBadges:'Achievements',
    mFeedName:'Quick Play',mFeedDesc:'10 questions per day — free',
    mDuelName:'Live Duel',mDuelDesc:'Real-time battle with a friend',
    chipAll:'All topics',
    categories:{SCIENCE:'Science',HISTORY:'History',GEOGRAPHY:'Geography',CINEMA:'Cinema',SPORTS:'Sports',MUSIC:'Music',ART:'Art',GAMING:'Gaming'},
    bFirst:'First game',bStreak3:'Streak x3',bStreak5:'Streak x5',bPerfect:'Perfect',bDuel:'First duel',bTourn:'Tournament',bNeurons:'100 neurons',
    dTitle:'Live Duel',dSub:'Challenge a friend to a Одни вопросы, один таймер — кто быстрее отвечает, тот побеждает.',
    dCreate:'⚡ Create a duel room',dOr:'или войти по коду',dCodePlaceholder:'Enter 6-letter code',dJoin:'Join →',
    dCodeLabel:'Share this code with your friend',dCopy:'Copy',dCopied:'Copied!',dReady:'✓ Ready',dWaiting:'Waiting...',dShareCode:'Share the code',
    dStart:'⚔️ Start the battle!',dWaitOpp:'Waiting for opponent...',
    dWin:'Победа!',dLose:'You lost!',dTie:"It's a tie!",dWinSub:'You outscored your opponent.',dLoseSub:'Better luck next time!',dTieSub:'Perfectly matched brains.',
    dPlayAgain:'Play again',
    tTitle:'Mind Championship',tMeta:'20 questions · All topics · Up to 50 players',
    tCreate:'⚡ Create tournament room',tJoin:'Join →',tCodeLabel:'Room code — share with players',
    tCopy:'Copy',tCopied:'Copied!',tPlayersLabel:'Players joined',tStart:'🏆 Start!',tWait:'Waiting for host to start...',
    tScoreLabel:'Score:',tOverTitle:'Tournament Over!',tFinalLabel:'Final standings',tFinalHdr:'Leaderboard',tAgain:'Play again',
    wlBadge:'Early access',wlTitle:'The app is coming.<br>Be the first.',
    wlSub:"Мы строим Brain Fight Club — глобальную платформу для интеллектуальных боёв.",
    wlSubmit:'Get early access →',wlThanksTitle:"You're on the list!",wlThanksSub:"We'll email you when Brain Fight Club launches.",
    wlCount:'Joined:',wlCountSuffix:'people from 38 countries',
    scLabel:'Round complete',scSub:'neurons earned',scCorrectLabel:'Correct',scStreakLabel:'Best streak',scAccLabel:'Accuracy',
    scAgain:'⚡ Play again',scDuel:'⚔️ Live Duel',scTourn:'🏆 Tournament',scJoin:'📧 Join waitlist',
    next:'Далее →',navHome:'Главная',navPlay:'Режимы игры',navDuel:'Дуэль',navCup:'Турнир',navJoin:'Войти',
    badgeEarned:'🏆 Badge earned:',oppAnswered:'✓ Opponent answered',
    statsTitle:'Statistics',statsGames:'Games',statsCorrect:'Correct',statsAcc:'Accuracy',statsStreak:'Best streak',
    achievTitle:'Achievements',rulesTitle:'How it works',freeVsPrem:'Free vs Premium',
    neuronsExplTitle:'What are Neurons?',tracksTitle:'Tracks',packsTitle:'Question Packs',
    playMenu:'Play',quickPlay:'Быстрая игра',chooseTopic:'Choose Topic',myPacks:'Bonuses',
    dailyChallenge:'Daily Challenge',randomBattle:'Random Battle',duelFriend:'Duel a Friend',
  },
  ru:{
    authSub:'Войдите чтобы сохранить нейроны и соревноваться глобально',
    authGoogle:'Войти через Google',authOr:'или',
    authGuest:'Продолжить как гость',authNote:'Прогресс гостя не сохраняется',
    hLabel:'Бета-версия',hTitle:'Сражайся умом. Побеждай сердцем.',
    hSub:'Квиз-дуэли в реальном времени — с другом, со случайным соперником или на турнире.',
    hPlay:'⚡ Играть',hMode:'Режим',hTopic:'Тема',hBadges:'Достижения',
    mFeedName:'Быстрая игра',mFeedDesc:'10 вопросов в день — бесплатно',
    mDuelName:'Дуэль',mDuelDesc:'Бой в реальном времени с другом',
    chipAll:'Все темы',
    categories:{SCIENCE:'Наука',HISTORY:'История',GEOGRAPHY:'География',CINEMA:'Кино',SPORTS:'Спорт',MUSIC:'Музыка',ART:'Искусство',GAMING:'Игры'},
    bFirst:'Первая игра',bStreak3:'Серия x3',bStreak5:'Серия x5',bPerfect:'Идеально',bDuel:'Первая дуэль',bTourn:'Турнир',bNeurons:'100 нейронов',
    dTitle:'Дуэль',dSub:'Вызов другу в режиме реального времени. Одни вопросы, один таймер — кто быстрее отвечает, тот побеждает.',
    dCreate:'⚡ Создать комнату дуэли',dOr:'или войти по коду',dCodePlaceholder:'Введите 6-буквенный код',dJoin:'Войти →',
    dCodeLabel:'Поделитесь кодом с другом',dCopy:'Копировать',dCopied:'Скопировано!',dReady:'✓ Готов',dWaiting:'Ждём...',dShareCode:'Поделитесь кодом',
    dStart:'⚔️ Начать бой!',dWaitOpp:'Ждём соперника...',
    dWin:'Вы победили!',dLose:'Вы проиграли!',dTie:'Ничья!',dWinSub:'Вы обошли соперника.',dLoseSub:'В следующий раз повезёт!',dTieSub:'Одинаково сильные умы.',
    dPlayAgain:'Играть снова',
    tTitle:'Чемпионат умов',tMeta:'10 вопросов · Все темы · До 50 игроков',
    tCreate:'⚡ Создать комнату турнира',tJoin:'Войти →',tCodeLabel:'Код комнаты — поделитесь с игроками',
    tCopy:'Копировать',tCopied:'Скопировано!',tPlayersLabel:'Игроков вошло',tStart:'🏆 Старт!',tWait:'Ждём начала от хоста...',
    tScoreLabel:'Очки:',tOverTitle:'Турнир завершён!',tFinalLabel:'Финальные результаты',tFinalHdr:'Таблица',tAgain:'Играть снова',
    wlBadge:'Ранний доступ',wlTitle:'Приложение скоро.<br>Будь первым.',
    wlSub:'Мы строим Brain Fight Club — глобальную платформу для интеллектуальных боёв.',
    wlSubmit:'Получить ранний доступ →',wlThanksTitle:'Вы в списке!',wlThanksSub:'Напишем когда Brain Fight Club запустится.',
    wlCount:'Присоединились:',wlCountSuffix:'человек из 38 стран',
    scLabel:'Раунд завершён',scSub:'нейронов заработано',scCorrectLabel:'Верных',scStreakLabel:'Лучшая серия',scAccLabel:'Точность',
    scAgain:'⚡ Играть снова',scDuel:'⚔️ Дуэль',scTourn:'🏆 Турнир',scJoin:'📧 Вступить',
    next:'Далее →',navHome:'Главная',navPlay:'Режимы игры',navDuel:'Дуэль',navCup:'Турнир',navJoin:'Войти',
    badgeEarned:'🏆 Достижение:',oppAnswered:'✓ Соперник ответил',
    statsTitle:'Статистика',statsGames:'Игры',statsCorrect:'Верных',statsAcc:'Точность',statsStreak:'Лучшая серия',
    achievTitle:'Достижения',rulesTitle:'Как это работает',freeVsPrem:'Бесплатно и Premium',
    neuronsExplTitle:'Что такое нейроны?',tracksTitle:'Треки',packsTitle:'Активности',
    playMenu:'Играть',quickPlay:'Быстрая игра',chooseTopic:'Выбрать тему',myPacks:'Бонусы',
    dailyChallenge:'Задание дня',randomBattle:'Случайный бой',duelFriend:'Дуэль с другом',
    scAgain:'⚡ Играть снова',scDuel:'⚔️ Дуэль',scTourn:'🏆 Турнир',scJoin:'📧 Присоединиться',
    next:'Далее →',navHome:'Главная',navPlay:'Режимы игры',navDuel:'Дуэль',navCup:'Турнир',navJoin:'Войти',
    badgeEarned:'🏆 Достижение:',
    oppAnswered:'✓ Соперник ответил',
  }
};

lang='ru'; // deduped: declared in shim header
function setLang(l){
  lang=l;
  document.querySelectorAll('.lang-btn').forEach(b=>b.classList.toggle('active',b.textContent===l.toUpperCase()));
  applyLang();
}
function t(key){return T[lang][key]||T.en[key]||key;}
// ─── Safe DOM helpers (inline shims — router.js ES-module registers real versions later) ──
function safeEl(id){ return document.getElementById(id); }
function setText(id,v){ const e=safeEl(id); if(e) e.textContent=v; }
function setHTML(id,v){ const e=safeEl(id); if(e) e.innerHTML=v; }
function setPlaceholder(id,v){ const e=safeEl(id); if(e) e.placeholder=v; }

// [setDisplay] → js/router.js


function applyLang(){
  const L=T[lang]||T['ru'];
  // Auth
  setText('auth-sub',L.authSub);
  setText('auth-google-btn',L.authGoogle);
  setText('auth-or',L.authOr);
  setText('auth-guest-btn',L.authGuest);
  setText('auth-note',L.authNote);
  const emailToggleTxt=safeEl('auth-email-toggle-txt');
  if(emailToggleTxt&&safeEl('auth-email-form')&&safeEl('auth-email-form').style.display==='none')
    emailToggleTxt.textContent=lang==='ru'?'Войти через Email':'Sign in with Email';
  const signinBtn=safeEl('auth-signin-btn');
  if(signinBtn)signinBtn.textContent=lang==='ru'?'Войти':'Sign In';
  const signupBtn=safeEl('auth-signup-btn');
  if(signupBtn)signupBtn.textContent=lang==='ru'?'Регистрация':'Register';
  setPlaceholder('auth-email-input','Email');
  setPlaceholder('auth-pass-input',lang==='ru'?'Пароль (мин. 6 символов)':'Password (min 6 chars)');
  // Home
  setText('h-label',L.hLabel);
  setText('h-title',L.hTitle);
  setText('h-sub',L.hSub);
  setText('h-play',L.hPlay);
  setText('h-mode-title',L.hMode);
  setText('h-topic-title',L.hTopic);
  setText('h-badges-title',L.hBadges);
  setText('m-feed-name',L.mFeedName);
  setText('m-feed-desc',L.mFeedDesc);
  setText('m-duel-name',L.mDuelName);
  setText('m-duel-desc',L.mDuelDesc);
  setText('chip-all',L.chipAll);
  document.querySelectorAll('.chip-label').forEach(el=>{
    const cat=el.closest('[data-cat]')&&el.closest('[data-cat]').dataset.cat;
    if(cat&&L.categories&&L.categories[cat])el.textContent=L.categories[cat];
  });
  // Badge labels (elements may not exist — safe)
  setText('b-first',L.bFirst);
  setText('b-streak3',L.bStreak3);
  setText('b-streak5',L.bStreak5);
  setText('b-perfect',L.bPerfect);
  setText('b-duel',L.bDuel);
  setText('b-tourn',L.bTourn);
  setText('b-neurons100',L.bNeurons);
  // Duel
  setText('d-title',L.dTitle);
  setText('d-sub',L.dSub);
  setText('d-create-btn',L.dCreate);
  setText('d-или',L.dOr);
  setPlaceholder('join-code-input',L.dCodePlaceholder);
  setText('d-join-btn',L.dJoin);
  setText('d-code-label',L.dCodeLabel);
  setText('d-copy-btn',L.dCopy);
  setText('d-slot-ready-txt',L.dReady);
  setText('opp-name-wait',L.dWaiting);
  setText('opp-status-wait',L.dShareCode);
  setText('d-start-btn',L.dStart);
  const dWaitSpan=safeEl('d-wait-txt')&&safeEl('d-wait-txt').querySelector('span');
  if(dWaitSpan)dWaitSpan.textContent=L.dWaitOpp;
  setText('d-play-again-btn',L.dPlayAgain);
  // Tournament
  setText('t-title',L.tTitle);
  setText('t-meta',L.tMeta);
  setText('t-create-btn',L.tCreate);
  setText('t-join-btn',L.tJoin);
  setPlaceholder('t-join-code',lang==='ru'?'Код комнаты':'Room code');
  setText('t-code-label',L.tCodeLabel);
  setText('t-copy-btn',L.tCopy);
  setText('t-players-label',L.tPlayersLabel);
  setText('t-start-btn',L.tStart);
  const tWaitSpan=safeEl('t-wait-txt')&&safeEl('t-wait-txt').querySelector('span');
  if(tWaitSpan)tWaitSpan.textContent=L.tWait;
  setText('t-wait-label',L.tWait);
  setText('t-score-label',L.tScoreLabel);
  setText('t-over-title',L.tOverTitle);
  setText('t-final-label',L.tFinalLabel);
  setText('t-final-hdr',L.tFinalHdr);
  setText('t-again-btn',L.tAgain);
  // Waitlist
  setText('wl-badge',L.wlBadge);
  setHTML('wl-title',L.wlTitle);
  setText('wl-sub',L.wlSub);
  setText('wl-submit-btn',L.wlSubmit);
  setText('wl-thanks-title',L.wlThanksTitle);
  setText('wl-thanks-sub',L.wlThanksSub);
  // Score
  setText('sc-label',L.scLabel);
  setText('sc-sub',L.scSub);
  setText('sc-correct-label',L.scCorrectLabel);
  setText('sc-streak-label',L.scStreakLabel);
  setText('sc-acc-label',L.scAccLabel);
  setText('sc-again-btn',L.scAgain);
  setText('sc-duel-btn',L.scDuel);
  setText('sc-tourn-btn',L.scTourn);
  setText('sc-join-btn',L.scJoin);
  setText('sc-share-btn',lang==='ru'?'📤 Поделиться':'📤 Share result');
  // Nav
  setText('nav-home-label',L.navHome);
  setText('nav-play-label',L.navPlay);
  setText('nav-duel-label',L.navDuel);
  setText('nav-cup-label',L.navCup||'Турнир');
  setText('nav-profile-label','Профиль');
  setText('nav-teams-label','Команда');
  const shopNav=safeEl('nav-shop-label');
  if(shopNav)shopNav.textContent=lang==='ru'?'Бонусы':'Bonuses';
  // Play menu
  setText('pm-title',L.playMenu||'Режимы игры');
  setText('pm-quick',L.quickPlay||'Быстрая игра');
  setText('pm-quick-sub',lang==='ru'?'10 бесплатных вопросов в день':'10 free questions per day');
  setText('pm-topics',L.chooseTopic||'Выбор темы');
  setText('pm-topics-sub',lang==='ru'?'Наука, кино, спорт и другие':'Science, Cinema, Sports and more');
  setText('pm-packs',L.myPacks||'Активности');
  setText('pm-packs-sub',lang==='ru'?'Призы, паки и бонусы за нейроны':'Prizes, packs and bonuses for neurons');
  setText('pm-daily',L.dailyChallenge||'Задание дня');
  setText('pm-daily-sub',lang==='ru'?'Выполни задание и получи бонусные нейроны':"Complete today's task for bonus neurons");
  setText('pm-random',L.randomBattle||'Случайный бой');
  setText('pm-random-sub',lang==='ru'?'Найди случайного соперника онлайн':'Find a random opponent online');
  setText('pm-duel',L.duelFriend||'Дуэль с другом');
  setText('pm-duel-sub',lang==='ru'?'Отправь ссылку и сыграй вместе':'Send a link and play together');
  setText('pm-official',lang==='ru'?'Официальный турнир':'Официальный турнир');
  setText('pm-official-sub',lang==='ru'?'Идёт сейчас — успей присоединиться':'Live now — join before it starts');
  // Teams
  setText('th-title',lang==='ru'?'Команды':'Teams');
  setText('th-sub',lang==='ru'?'Вступи в команду и соревнуйся вместе. Ваш XP влияет на городской рейтинг.':'Join a team and compete together.');
  setText('t-create-team-btn',lang==='ru'?'⚡ Создать команду':'⚡ Create a team');
  setText('t-team-или',lang==='ru'?'или вступить в существующую':'или вступить в существующую');
  setPlaceholder('team-join-input',lang==='ru'?'Код команды':'Team code');
  setText('tc-title',lang==='ru'?'Создать команду':'Create Team');
  setText('tc-sub',lang==='ru'?'Ваша команда появится в городском рейтинге':'Команда появится в городском рейтинге');
  setPlaceholder('team-name-input',lang==='ru'?'Название команды':'Team name');
  setPlaceholder('team-city-input',lang==='ru'?'Город':'City');
  setText('tc-confirm-btn',lang==='ru'?'Создать →':'Create →');
  setText('tc-cancel-btn',lang==='ru'?'← Отмена':'← Cancel');
  setText('tm-invite-btn',lang==='ru'?'🔗 Пригласить друзей':'🔗 Invite friends');
  setText('tm-leave-btn',lang==='ru'?'Покинуть команду':'Leave team');
  setText('tm-members-label',lang==='ru'?'Участники':'Members');
  // City leaderboard
  setText('t-global-title',lang==='ru'?'🌆 Рейтинг городов':'🌆 City Leaderboard');
  setText('city-tab-teams',lang==='ru'?'Команды':'Teams');
  setText('city-tab-players',lang==='ru'?'Игроки':'Players');
  setText('city-tab-week',lang==='ru'?'🏅 Неделя':'🏅 Week');
  // Matchmaking
  setText('mm-title','Поиск соперника...');
  setText('mm-sub','До 30 секунд');
  setText('mm-cancel-btn','Отмена');
  setText('mm-bot-btn','Играть против Бота');
  // Shop/daily
  setText('daily-label',lang==='ru'?'Задание дня':'Daily Challenge');
  setText('ref-title',lang==='ru'?'Пригласить друзей':'Invite friends');
  setText('ref-sub',lang==='ru'?'Оба получите +50 нейронов при регистрации':'Both of you get +50 neurons when they sign up');
  setText('shop-section-title',lang==='ru'?'Активности':'Activities');
  // Profile
  setText('profile-stats-title',lang==='ru'?'Статистика':'Statistics');
  setText('profile-badges-title',lang==='ru'?'Достижения':'Achievements');
  setText('profile-signout-btn',lang==='ru'?'Выйти':'Sign out');
  setText('ps-games-lbl',lang==='ru'?'Игр сыграно':'Games');
  setText('ps-correct-lbl',lang==='ru'?'Верных ответов':'Correct');
  // Share
  setHTML('sh-tg',lang==='ru'?'Отправить в Telegram':'Share to Telegram');
  setHTML('sh-wa',lang==='ru'?'Отправить в WhatsApp':'Share to WhatsApp');
  setHTML('sh-copy',lang==='ru'?'Копировать ссылку':'Copy link');
  setHTML('sh-duel',lang==='ru'?'Вызвать друга':'Challenge a friend');
  setHTML('sh-team',lang==='ru'?'Команды':'Join / create team');
  setText('sh-home',lang==='ru'?'← Назад':'← Back to home');
  // Next buttons
  document.querySelectorAll('.next-btn').forEach(b=>{if(b)b.textContent=L.next||'Далее →';});
}

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// DEV MODE — set to false for production
// ═══════════════════════════════════════════
const DEV_MODE = false;

// QUESTIONS (bilingual)
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// ВЕРСИОНИРОВАНИЕ БАЗЫ ВОПРОСОВ v2
// ═══════════════════════════════════════════
const QUESTION_DB_VERSION = 2;

function migrateQuestionDB(){
  const stored = parseInt(localStorage.getItem('mfc_question_db_version')||'0');
  if(stored < QUESTION_DB_VERSION){
    console.log('[MFC] Migrating question DB v'+stored+' → v'+QUESTION_DB_VERSION);
    localStorage.removeItem('mfc_questions_local');
    localStorage.removeItem('mfc_seed_questions');
    localStorage.setItem('mfc_question_db_version', String(QUESTION_DB_VERSION));
    console.log('[MFC] Question DB migrated. User profile preserved.');
  }
}
migrateQuestionDB();

// ═══════════════════════════════════════════
// БАЗА ВОПРОСОВ v2 — 100+ общих вопросов
// correctIndex равномерно распределён (не всегда 0)
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════════════════
// БАЗА ВОПРОСОВ v2 — 114 вопросов
// correctIndex ВЫРОВНЕН: 0/1/2/3 равномерно
// ═══════════════════════════════════════════════════════
const ALL_Q_BASE=[
// ── НАУКА (15) ──────────────────────────────────────────────────
{id:'q_g_001',cat:'SCIENCE',difficulty:'easy',
 q:{ru:'Что является энергетической станцией клетки?'},
 a:{ru:['Ядро','Рибосома','Аппарат Гольджи','Митохондрия']},c:3,t:20,
 explanation:'Митохондрии производят АТФ — основной источник энергии клетки.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['биология'],status:'approved',source:'seed'},

{id:'q_g_002',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Сколько костей в теле взрослого человека?'},
 a:{ru:['196','206','216','226']},c:1,t:20,
 explanation:'У взрослого человека 206 костей (у новорождённого около 270).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['анатомия'],status:'approved',source:'seed'},

{id:'q_g_003',cat:'SCIENCE',difficulty:'easy',
 q:{ru:'Химический символ золота?'},
 a:{ru:['Ag','Gd','Go','Au']},c:3,t:15,
 explanation:'Au — от латинского «aurum» (золото).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['химия'],status:'approved',source:'seed'},

{id:'q_g_004',cat:'SCIENCE',difficulty:'easy',
 q:{ru:'При какой температуре кипит вода на уровне моря (°C)?'},
 a:{ru:['90','100','110']},c:1,t:15,
 explanation:'Вода кипит при 100 °C на уровне моря.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['физика'],status:'approved',source:'seed'},

{id:'q_g_005',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Правда или ложь: Великая китайская стена видна из космоса невооружённым глазом?'},
 a:{ru:['Правда','Ложь']},c:1,t:20,
 explanation:'Это миф. Стена слишком узкая — около 5 м, её не видно из космоса.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['астрономия'],status:'approved',source:'seed'},

{id:'q_g_006',cat:'SCIENCE',difficulty:'easy',
 q:{ru:'Сколько планет в Солнечной системе?'},
 a:{ru:['8','9','10','7']},c:0,t:10,
 explanation:'С 2006 г. официально 8 планет — Плутон переклассифицирован в карликовые.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['астрономия'],status:'approved',source:'seed'},

{id:'q_g_007',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Самый распространённый газ в атмосфере Земли?'},
 a:{ru:['Аргон','Кислород','Углекислый газ','Азот']},c:3,t:20,
 explanation:'Азот составляет ≈78% атмосферы Земли.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['химия'],status:'approved',source:'seed'},

{id:'q_g_008',cat:'SCIENCE',difficulty:'hard',
 q:{ru:'Сколько хромосом в клетке человека?'},
 a:{ru:['46','48','44','23']},c:0,t:25,
 explanation:'В каждой клетке человека 46 хромосом (23 пары).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['генетика'],status:'approved',source:'seed'},

{id:'q_g_009',cat:'SCIENCE',difficulty:'hard',
 q:{ru:'Скорость света в вакууме (км/с)?'},
 a:{ru:['200 000','350 000','250 000','300 000']},c:3,t:25,
 explanation:'Скорость света ≈299 792 км/с.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['физика'],status:'approved',source:'seed'},

{id:'q_g_010',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Какой орган производит инсулин?'},
 a:{ru:['Почки','Поджелудочная железа','Желудок','Печень']},c:1,t:20,
 explanation:'Инсулин вырабатывается бета-клетками поджелудочной железы.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['анатомия'],status:'approved',source:'seed'},

{id:'q_g_011',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Что изучает орнитология?'},
 a:{ru:['Насекомых','Рыб','Птиц','Пресмыкающихся','Млекопитающих','Грибы']},c:2,t:20,
 explanation:'Орнитология — раздел зоологии, изучающий птиц.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['биология'],status:'approved',source:'seed'},

{id:'q_g_012',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Какой элемент обозначается символом Fe?'},
 a:{ru:['Фтор','Железо','Фосфор']},c:1,t:20,
 explanation:'Fe — от латинского «ferrum» (железо).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['химия'],status:'approved',source:'seed'},

{id:'q_g_013',cat:'SCIENCE',difficulty:'hard',
 q:{ru:'Как называется слой атмосферы, ближайший к поверхности Земли?'},
 a:{ru:['Стратосфера','Мезосфера','Тропосфера','Термосфера']},c:2,t:25,
 explanation:'Тропосфера — нижний слой атмосферы, до 10–18 км.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['метеорология'],status:'approved',source:'seed'},

{id:'q_g_014',cat:'SCIENCE',difficulty:'easy',
 q:{ru:'Формула воды?'},
 a:{ru:['H2O','HO','H3O','OH2']},c:0,t:10,
 explanation:'H₂O — два атома водорода и один атом кислорода.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['химия'],status:'approved',source:'seed'},

{id:'q_g_015',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'Какое излучение поглощает озоновый слой Земли?'},
 a:{ru:['Инфракрасное','Рентгеновское','Ультрафиолетовое','Гамма']},c:2,t:20,
 explanation:'Озоновый слой поглощает большую часть ультрафиолетового излучения Солнца.',
 media:{type:'image',url:'',filename:'ozone_layer.jpg',placeholder:'Схема атмосферных слоёв и озонового слоя'},
 tags:['экология'],status:'approved',source:'seed'},

// ── ИСТОРИЯ (10) ────────────────────────────────────────────────
{id:'q_g_016',cat:'HISTORY',difficulty:'medium',
 q:{ru:'В каком году закончилась Вторая мировая война?'},
 a:{ru:['1945','1943','1944','1946']},c:0,t:25,
 explanation:'Вторая мировая война завершилась 2 сентября 1945 года.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_017',cat:'HISTORY',difficulty:'medium',
 q:{ru:'Кто написал «Мону Лизу»?'},
 a:{ru:['Рафаэль','Донателло','Леонардо да Винчи','Микеланджело']},c:2,t:20,
 explanation:'Леонардо да Винчи написал «Мону Лизу» около 1503–1519 гг.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_018',cat:'HISTORY',difficulty:'medium',
 q:{ru:'В каком году пала Берлинская стена?'},
 a:{ru:['1990','1988','1987','1989']},c:3,t:25,
 explanation:'Берлинская стена пала 9 ноября 1989 года.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_019',cat:'HISTORY',difficulty:'easy',
 q:{ru:'Кто был первым человеком в космосе?'},
 a:{ru:['Юрий Гагарин','Нил Армстронг','Алексей Леонов','Герман Титов']},c:0,t:15,
 explanation:'Юрий Гагарин полетел в космос 12 апреля 1961 года.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_020',cat:'HISTORY',difficulty:'medium',
 q:{ru:'Какая страна подарила США статую Свободы?'},
 a:{ru:['Великобритания','Испания','Германия','Франция']},c:3,t:20,
 explanation:'Статуя Свободы — подарок Франции к столетию независимости США (1886).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_021',cat:'HISTORY',difficulty:'medium',
 q:{ru:'В каком году началась Первая мировая война?'},
 a:{ru:['1913','1912','1914','1915']},c:2,t:20,
 explanation:'Первая мировая война началась 28 июля 1914 года.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_022',cat:'HISTORY',difficulty:'medium',
 q:{ru:'Кто был первым президентом США?'},
 a:{ru:['Джон Адамс','Томас Джефферсон','Джордж Вашингтон','Бенджамин Франклин']},c:2,t:20,
 explanation:'Джордж Вашингтон стал первым президентом США (1789–1797).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_023',cat:'HISTORY',difficulty:'easy',
 q:{ru:'Титаник затонул в Атлантическом океане?'},
 a:{ru:['Да','Нет']},c:0,t:15,
 explanation:'Титаник затонул в Северной Атлантике 15 апреля 1912 года.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_024',cat:'HISTORY',difficulty:'hard',
 q:{ru:'В каком десятилетии завершилась холодная война?'},
 a:{ru:['1970-е','1980-е','2000-е','1960-е','1990-е']},c:4,t:25,
 explanation:'Холодная война завершилась в начале 1990-х с распадом СССР (1991).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

{id:'q_g_025',cat:'HISTORY',difficulty:'easy',
 q:{ru:'Где находится Колизей?'},
 a:{ru:['Рим','Афины','Мадрид','Париж']},c:0,t:15,
 explanation:'Колизей расположен в центре Рима, построен в 72–80 гг. н.э.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['история'],status:'approved',source:'seed'},

// ── ГЕОГРАФИЯ (10) ──────────────────────────────────────────────
{id:'q_g_026',cat:'GEOGRAPHY',difficulty:'medium',
 q:{ru:'Столица Австралии?'},
 a:{ru:['Сидней','Мельбурн','Брисбен','Канберра']},c:3,t:20,
 explanation:'Столица Австралии — Канберра, а не Сидней.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_027',cat:'GEOGRAPHY',difficulty:'hard',
 q:{ru:'В какой стране больше всего природных озёр?'},
 a:{ru:['Канада','Россия','США','Финляндия']},c:0,t:25,
 explanation:'В Канаде более 2 млн озёр — больше, чем в любой другой стране.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_028',cat:'GEOGRAPHY',difficulty:'medium',
 q:{ru:'Самая длинная река в мире?'},
 a:{ru:['Амазонка','Янцзы','Миссисипи','Нил']},c:3,t:25,
 explanation:'Нил — самая длинная река (6 853 км).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_029',cat:'GEOGRAPHY',difficulty:'easy',
 q:{ru:'Страна с наибольшей площадью суши?'},
 a:{ru:['США','Канада','Россия','Китай']},c:2,t:20,
 explanation:'Россия — крупнейшая страна мира (17,1 млн км²).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_030',cat:'GEOGRAPHY',difficulty:'easy',
 q:{ru:'Какой океан самый большой?'},
 a:{ru:['Атлантический','Тихий','Индийский']},c:1,t:20,
 explanation:'Тихий океан — крупнейший, занимает около 46% мирового океана.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_031',cat:'GEOGRAPHY',difficulty:'medium',
 q:{ru:'На каком континенте нет постоянного населения?'},
 a:{ru:['Африка','Азия','Европа','Антарктида','Австралия','Южная Америка']},c:3,t:30,
 explanation:'В Антарктиде нет постоянного населения — только научные станции.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_032',cat:'GEOGRAPHY',difficulty:'easy',
 q:{ru:'Столица Японии?'},
 a:{ru:['Осака','Киото','Иокогама','Токио']},c:3,t:15,
 explanation:'Токио — столица и крупнейший город Японии.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_033',cat:'GEOGRAPHY',difficulty:'easy',
 q:{ru:'Самая высокая гора в мире?'},
 a:{ru:['Эверест','К2','Канченджанга','Лхоцзе']},c:0,t:15,
 explanation:'Эверест (8 849 м) — высочайшая вершина мира.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_034',cat:'GEOGRAPHY',difficulty:'medium',
 q:{ru:'В какой стране находится Мачу-Пикчу?'},
 a:{ru:['Бразилия','Чили','Перу','Колумбия']},c:2,t:20,
 explanation:'Мачу-Пикчу — город инков в Андах, Перу.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

{id:'q_g_035',cat:'GEOGRAPHY',difficulty:'hard',
 q:{ru:'Какая из этих стран не имеет выхода к морю: Австрия, Венгрия, Португалия?'},
 a:{ru:['Только Австрия','Только Венгрия','Австрия и Венгрия','Португалия']},c:2,t:25,
 explanation:'И Австрия, и Венгрия — страны без выхода к морю.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['география'],status:'approved',source:'seed'},

// ── КИНО (10) ───────────────────────────────────────────────────
{id:'q_g_036',cat:'CINEMA',difficulty:'medium',
 q:{ru:'Кто снял «Криминальное чтиво»?'},
 a:{ru:['Скорсезе','Финчер','Кубрик','Тарантино']},c:3,t:20,
 explanation:'«Криминальное чтиво» (1994) — режиссёрский шедевр Квентина Тарантино.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_037',cat:'CINEMA',difficulty:'hard',
 q:{ru:'Что из этого НЕ фильм Кристофера Нолана?'},
 a:{ru:['Начало','Тёмный рыцарь','Интерстеллар','Помни','Аватар']},c:4,t:30,
 explanation:'«Аватар» снял Джеймс Кэмерон, все остальные — работы Нолана.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_038',cat:'CINEMA',difficulty:'medium',
 q:{ru:'Кто снял «2001: Космическая одиссея»?'},
 a:{ru:['Спилберг','Нолан','Кубрик','Скотт']},c:2,t:20,
 explanation:'«2001: Космическая одиссея» (1968) — фильм Стэнли Кубрика.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_039',cat:'CINEMA',difficulty:'easy',
 q:{ru:"В каком фильме звучит фраза «I'll be back»?"},
 a:{ru:['РобоКоп','Терминатор','Хищник','Вспомнить всё']},c:1,t:20,
 explanation:"«I'll be back» — знаменитая фраза Терминатора (1984).",
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_040',cat:'CINEMA',difficulty:'easy',
 q:{ru:'Кто сыграл Тони Старка / Железного человека?'},
 a:{ru:['Крис Хемсворт','Марк Руффало','Роберт Дауни-мл.','Крис Эванс']},c:2,t:15,
 explanation:'Роберт Дауни-мл. играл Тони Старка в киновселенной Marvel.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_041',cat:'CINEMA',difficulty:'hard',
 q:{ru:'В каком фильме Леонардо ДиКаприо получил первый «Оскар»?'},
 a:{ru:['Джанго освобождённый','Авиатор','Волк с Уолл-стрит','Выживший']},c:3,t:25,
 explanation:'ДиКаприо получил «Оскар» за роль в фильме «Выживший» (2016).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_042',cat:'CINEMA',difficulty:'medium',
 q:{ru:'Какой фильм заработал больше всего в истории кино?'},
 a:{ru:['Аватар','Мстители: Финал','Аватар: Путь воды','Титаник']},c:0,t:25,
 explanation:'«Аватар» (2009) — самый кассовый фильм в истории.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_043',cat:'CINEMA',difficulty:'easy',
 q:{ru:'В каком городе живёт Бэтмен?'},
 a:{ru:['Метрополис','Нью-Йорк','Аркхем','Готэм']},c:3,t:20,
 explanation:'Готэм — вымышленный город, где живёт Бэтмен.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_044',cat:'CINEMA',difficulty:'easy',
 q:{ru:'Как называется анимационная студия, создавшая «Историю игрушек»?'},
 a:{ru:['Pixar','DreamWorks','Disney','Illumination']},c:0,t:15,
 explanation:'«История игрушек» (1995) создана студией Pixar.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

{id:'q_g_045',cat:'CINEMA',difficulty:'medium',
 q:{ru:'Сколько фильмов в оригинальной трилогии «Звёздные войны»?'},
 a:{ru:['2','3','4']},c:1,t:15,
 explanation:'Оригинальная трилогия — эпизоды IV, V и VI (1977–1983).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['кино'],status:'approved',source:'seed'},

// ── МУЗЫКА (10) ─────────────────────────────────────────────────
{id:'q_g_046',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Какая группа выпустила альбом «Abbey Road»?'},
 a:{ru:['Rolling Stones','Led Zeppelin','Pink Floyd','The Beatles']},c:3,t:20,
 explanation:'«Abbey Road» — последний записанный альбом The Beatles (1969).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_047',cat:'MUSIC',difficulty:'easy',
 q:{ru:'Сколько струн у стандартной гитары?'},
 a:{ru:['6','4','5','7']},c:0,t:15,
 explanation:'Стандартная гитара имеет 6 струн.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_048',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Настоящее имя Леди Гаги?'},
 a:{ru:['Стефани Джерманотта','Кэти Хадсон','Нила Фента','Бейонсе Ноулс']},c:0,t:20,
 explanation:'Леди Гага — псевдоним Стефани Джоанн Анджелины Джерманотты.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_049',cat:'MUSIC',difficulty:'easy',
 q:{ru:'Из какой страны группа BTS?'},
 a:{ru:['Японии','Таиланда','Китая','Южной Кореи']},c:3,t:15,
 explanation:'BTS — южнокорейская K-pop группа, основана в 2013 году.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_050',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Кто написал Девятую симфонию, будучи глухим?'},
 a:{ru:['Бетховен','Шопен','Бах','Моцарт']},c:0,t:20,
 explanation:'Людвиг ван Бетховен завершил Девятую симфонию в 1824 году, будучи глухим.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_051',cat:'MUSIC',difficulty:'easy',
 q:{ru:'Кто записал «Bohemian Rhapsody»?'},
 a:{ru:['Led Zeppelin','The Beatles','Queen','Rolling Stones']},c:2,t:15,
 explanation:'«Bohemian Rhapsody» — песня группы Queen, 1975.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_052',cat:'MUSIC',difficulty:'easy',
 q:{ru:'Какой основной инструмент у Элтона Джона?'},
 a:{ru:['Скрипка','Фортепиано','Гитара']},c:1,t:15,
 explanation:'Элтон Джон — прежде всего пианист.',
 media:{type:'audio',url:'',filename:'elton_john_hint.mp3',placeholder:'Аудиофрагмент из репертуара Элтона Джона'},
 tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_053',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Какая певица выпустила альбом «1989»?'},
 a:{ru:['Тейлор Свифт','Кэти Перри','Ариана Гранде','Бейонсе']},c:0,t:20,
 explanation:'«1989» — пятый студийный альбом Тейлор Свифт (2014).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_054',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Как называет себя рэпер Обри Дрейк Грэм?'},
 a:{ru:['Post Malone','Kendrick Lamar','The Weeknd','Drake']},c:3,t:20,
 explanation:'Обри Дрейк Грэм выступает под псевдонимом Drake.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

{id:'q_g_055',cat:'MUSIC',difficulty:'medium',
 q:{ru:'Кто из певиц прозван «Королевой поп-музыки»?'},
 a:{ru:['Мадонна','Бейонсе','Рианна','Леди Гага']},c:0,t:15,
 explanation:'Мадонна — «Королева поп-музыки», икона 1980–90-х годов.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['музыка'],status:'approved',source:'seed'},

// ── СПОРТ (10) ──────────────────────────────────────────────────
{id:'q_g_056',cat:'SPORTS',difficulty:'easy',
 q:{ru:'Сколько игроков баскетбольной команды на площадке одновременно?'},
 a:{ru:['4','6','5','7']},c:2,t:15,
 explanation:'В баскетболе на площадке по 5 игроков от каждой команды.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_057',cat:'SPORTS',difficulty:'medium',
 q:{ru:'Где прошли летние Олимпийские игры 2016 года?'},
 a:{ru:['Токио','Пекин','Рио-де-Жанейро','Лондон']},c:2,t:20,
 explanation:'Олимпийские игры 2016 прошли в Рио-де-Жанейро, Бразилия.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_058',cat:'SPORTS',difficulty:'easy',
 q:{ru:'Какой вид спорта на Уимблдоне?'},
 a:{ru:['Гольф','Теннис','Крикет']},c:1,t:10,
 explanation:'Уимблдон — старейший теннисный турнир «Большого шлема».',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_059',cat:'SPORTS',difficulty:'hard',
 q:{ru:'Какая страна больше всего раз выигрывала ЧМ по футболу?'},
 a:{ru:['Германия','Испания','Франция','Аргентина','Бразилия','Италия']},c:4,t:30,
 explanation:'Бразилия — 5 побед (1958, 1962, 1970, 1994, 2002).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_060',cat:'SPORTS',difficulty:'easy',
 q:{ru:'В каком виде спорта используется шайба?'},
 a:{ru:['Хоккей','Бенди','Кёрлинг','Флорбол']},c:0,t:10,
 explanation:'В хоккее на льду используют резиновую шайбу.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_061',cat:'SPORTS',difficulty:'hard',
 q:{ru:'Кто является рекордсменом по голам за сборную?'},
 a:{ru:['Пеле','Лионель Месси','Герд Мюллер','Криштиану Роналду']},c:3,t:25,
 explanation:'Криштиану Роналду — рекордсмен по голам за сборную.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_062',cat:'SPORTS',difficulty:'medium',
 q:{ru:'В каком году прошли первые современные Олимпийские игры?'},
 a:{ru:['1892','1900','1904','1896']},c:3,t:25,
 explanation:'Первые современные Олимпийские игры прошли в Афинах в 1896 году.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_063',cat:'SPORTS',difficulty:'easy',
 q:{ru:'Сколько игроков хоккейной команды на льду (включая вратаря)?'},
 a:{ru:['5','7','6']},c:2,t:15,
 explanation:'На льду одновременно 6 игроков: 5 полевых + вратарь.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_064',cat:'SPORTS',difficulty:'medium',
 q:{ru:'Какая страна выиграла ЧМ 2022 года в Катаре?'},
 a:{ru:['Аргентина','Германия','Франция','Бразилия']},c:0,t:20,
 explanation:'Аргентина победила Францию по пенальти в финале ЧМ-2022.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

{id:'q_g_065',cat:'SPORTS',difficulty:'medium',
 q:{ru:'Какой теннисный турнир проходит на грунтовом покрытии?'},
 a:{ru:['Уимблдон','Открытый чемпионат Австралии','Открытый чемпионат США','Ролан Гаррос']},c:3,t:20,
 explanation:'Ролан Гаррос — единственный турнир «Большого шлема» на грунте.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['спорт'],status:'approved',source:'seed'},

// ── ТЕХНОЛОГИИ (7) ──────────────────────────────────────────────
{id:'q_g_066',cat:'TECH',difficulty:'medium',
 q:{ru:'Что означает HTTP?'},
 a:{ru:['High Text Transfer Protocol','HyperText Transfer Protocol','Hyper Transfer Text Protocol']},c:1,t:25,
 explanation:'HTTP — HyperText Transfer Protocol, протокол передачи гипертекста.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_067',cat:'TECH',difficulty:'easy',
 q:{ru:'Кто основал компанию Apple вместе со Стивом Джобсом?'},
 a:{ru:['Марк Цукерберг','Стив Возняк','Билл Гейтс','Илон Маск']},c:1,t:15,
 explanation:'Apple основана Стивом Джобсом, Стивом Возняком и Роном Уэйном в 1976 году.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_068',cat:'TECH',difficulty:'hard',
 q:{ru:'В каком году был создан ARPANET — предшественник интернета?'},
 a:{ru:['1959','1979','1989','1969']},c:3,t:25,
 explanation:'ARPANET запущен в 1969 году Министерством обороны США.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_069',cat:'TECH',difficulty:'easy',
 q:{ru:'Что означает CPU?'},
 a:{ru:['Цифровой процессор','Центральный порт','Цифровой узел','Центральный процессор']},c:3,t:20,
 explanation:'CPU — Central Processing Unit (центральный процессор).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_070',cat:'TECH',difficulty:'easy',
 q:{ru:'Что такое VPN?'},
 a:{ru:['Высокоскоростной протокол','Виртуальная частная сеть','Видеоконтентный провайдер']},c:1,t:20,
 explanation:'VPN — Virtual Private Network, технология шифрования соединения.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_071',cat:'TECH',difficulty:'easy',
 q:{ru:'Операционная система Apple для компьютеров?'},
 a:{ru:['Android','Linux','macOS','Windows']},c:2,t:10,
 explanation:'macOS — операционная система для компьютеров Mac от Apple.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

{id:'q_g_072',cat:'TECH',difficulty:'easy',
 q:{ru:'Что означает HTML?'},
 a:{ru:['High Transfer Markup Language','HyperText Machine Language','HyperText Markup Language','HyperType Meta Language']},c:2,t:20,
 explanation:'HTML — HyperText Markup Language, язык разметки веб-страниц.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['технологии'],status:'approved',source:'seed'},

// ── ЖИВОТНЫЕ (7) ────────────────────────────────────────────────
{id:'q_g_073',cat:'ANIMALS',difficulty:'easy',
 q:{ru:'Какое животное самое быстрое на суше?'},
 a:{ru:['Лев','Борзая','Лошадь','Гепард']},c:3,t:15,
 explanation:'Гепард разгоняется до 120 км/ч — быстрее всех наземных животных.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_074',cat:'ANIMALS',difficulty:'easy',
 q:{ru:'Сколько ног у паука?'},
 a:{ru:['6','10','8']},c:2,t:15,
 explanation:'Пауки — арахниды, у них 8 ног.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_075',cat:'ANIMALS',difficulty:'easy',
 q:{ru:'Самое большое животное на Земле?'},
 a:{ru:['Голубой кит','Слон','Жираф','Большая белая акула']},c:0,t:15,
 explanation:'Голубой кит — крупнейшее животное на Земле (до 30 м длиной).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_076',cat:'ANIMALS',difficulty:'easy',
 q:{ru:'Какая птица не умеет летать?'},
 a:{ru:['Страус','Орёл','Попугай','Альбатрос']},c:0,t:15,
 explanation:'Страус — нелетающая птица, зато самая быстрая бегущая.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_077',cat:'ANIMALS',difficulty:'easy',
 q:{ru:'Какое животное изображено на гербе Австралии?'},
 a:{ru:['Коала','Вомбат','Кенгуру','Утконос']},c:2,t:15,
 explanation:'Кенгуру и эму изображены на гербе Австралии.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_078',cat:'ANIMALS',difficulty:'medium',
 q:{ru:'У жирафа столько же шейных позвонков, сколько у человека?'},
 a:{ru:['Да','Нет']},c:0,t:25,
 explanation:'У жирафа те же 7 шейных позвонков, что и у человека — просто они длиннее.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

{id:'q_g_079',cat:'ANIMALS',difficulty:'medium',
 q:{ru:'Как называется детёныш кенгуру?'},
 a:{ru:['Кидди','Джоуи','Куб','Пап']},c:1,t:20,
 explanation:'Детёныш кенгуру называется «джоуи» (joey).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['животные'],status:'approved',source:'seed'},

// ── ЕДА (5) ─────────────────────────────────────────────────────
{id:'q_g_080',cat:'FOOD',difficulty:'easy',
 q:{ru:'В какой стране придумали пиццу?'},
 a:{ru:['Испания','Греция','Франция','Италия']},c:3,t:15,
 explanation:'Пицца родом из Неаполя, Италия.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['еда'],status:'approved',source:'seed'},

{id:'q_g_081',cat:'FOOD',difficulty:'easy',
 q:{ru:'Из чего делают тофу?'},
 a:{ru:['Коровьего молока','Соевых бобов','Козьего молока']},c:1,t:20,
 explanation:'Тофу — соевый творог из свёрнутого соевого молока.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['еда'],status:'approved',source:'seed'},

{id:'q_g_082',cat:'FOOD',difficulty:'medium',
 q:{ru:'Томат — это фрукт или овощ (ботанически)?'},
 a:{ru:['Овощ','Фрукт']},c:1,t:20,
 explanation:'Ботанически томат — плод (ягода).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['еда'],status:'approved',source:'seed'},

{id:'q_g_083',cat:'FOOD',difficulty:'easy',
 q:{ru:'В какой стране изобрели суши?'},
 a:{ru:['Китай','Таиланд','Корея','Япония']},c:3,t:15,
 explanation:'Суши — традиционное блюдо японской кухни.',
 media:{type:'image',url:'https://upload.wikimedia.org/wikipedia/commons/thumb/2/2f/Culinary_fruits_front_view.jpg/640px-Culinary_fruits_front_view.jpg',filename:'fruits.jpg',placeholder:''},
 tags:['еда'],status:'approved',source:'seed'},

{id:'q_g_084',cat:'FOOD',difficulty:'medium',
 q:{ru:'Что является основным ингредиентом гуакамоле?'},
 a:{ru:['Томат','Лайм','Авокадо','Манго']},c:2,t:15,
 explanation:'Гуакамоле — соус на основе авокадо, традиционное мексиканское блюдо.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['еда'],status:'approved',source:'seed'},

// ── ЛИТЕРАТУРА (5) ──────────────────────────────────────────────
{id:'q_g_085',cat:'LITERATURE',difficulty:'easy',
 q:{ru:'Кто написал «Войну и мир»?'},
 a:{ru:['Достоевский','Тургенев','Чехов','Толстой']},c:3,t:15,
 explanation:'Лев Толстой написал «Войну и мир» в 1865–1869 годах.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['литература'],status:'approved',source:'seed'},

{id:'q_g_086',cat:'LITERATURE',difficulty:'medium',
 q:{ru:'Кто автор «Мастера и Маргариты»?'},
 a:{ru:['Булгаков','Набоков','Пастернак','Ахматова']},c:0,t:20,
 explanation:'Михаил Булгаков писал «Мастера и Маргариту» в 1930–1940 годах.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['литература'],status:'approved',source:'seed'},

{id:'q_g_087',cat:'LITERATURE',difficulty:'medium',
 q:{ru:'Как зовут главного героя «Преступления и наказания»?'},
 a:{ru:['Иван Карамазов','Алёша Карамазов','Андрей Болконский','Родион Раскольников']},c:3,t:20,
 explanation:'Главный герой — Родион Романович Раскольников.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['литература'],status:'approved',source:'seed'},

{id:'q_g_088',cat:'LITERATURE',difficulty:'medium',
 q:{ru:'Кто написал «Дон Кихота»?'},
 a:{ru:['Сервантес','Шекспир','Данте','Вольтер']},c:0,t:20,
 explanation:'Мигель де Сервантес написал «Дон Кихота» в начале XVII века.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['литература'],status:'approved',source:'seed'},

{id:'q_g_089',cat:'LITERATURE',difficulty:'easy',
 q:{ru:'В каком произведении есть персонаж Гермиона Грейнджер?'},
 a:{ru:['Нарния','Дивергент','Гарри Поттер','Властелин колец']},c:2,t:10,
 explanation:'Гермиона Грейнджер — подруга Гарри Поттера из книг Дж. К. Роулинг.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['литература'],status:'approved',source:'seed'},

// ── ПОП-КУЛЬТУРА (5) ────────────────────────────────────────────
{id:'q_g_090',cat:'POPCULTURE',difficulty:'medium',
 q:{ru:'Сколько камней бесконечности в киновселенной Marvel?'},
 a:{ru:['4','5','6','7']},c:2,t:20,
 explanation:'Шесть камней: Разум, Время, Пространство, Реальность, Душа, Сила.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['поп-культура'],status:'approved',source:'seed'},

{id:'q_g_091',cat:'POPCULTURE',difficulty:'medium',
 q:{ru:'Как называется мир в «Игре престолов»?'},
 a:{ru:['Средиземье','Нарния','Арда','Вестерос']},c:3,t:20,
 explanation:'Действие «Игры престолов» происходит в Вестеросе.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['поп-культура'],status:'approved',source:'seed'},

{id:'q_g_092',cat:'POPCULTURE',difficulty:'easy',
 q:{ru:'Какой игровой персонаж Nintendo — итальянский водопроводчик?'},
 a:{ru:['Марио','Sonic','Link','Donkey Kong']},c:0,t:10,
 explanation:'Марио — знаменитый водопроводчик Nintendo.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['поп-культура'],status:'approved',source:'seed'},

{id:'q_g_093',cat:'POPCULTURE',difficulty:'easy',
 q:{ru:'В каком сериале снялся персонаж Уолтер Уайт?'},
 a:{ru:['Озарк','Декстер','Клан Сопрано','Во все тяжкие']},c:3,t:15,
 explanation:'Уолтер Уайт — главный герой «Во все тяжкие» (Breaking Bad).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['поп-культура'],status:'approved',source:'seed'},

{id:'q_g_094',cat:'POPCULTURE',difficulty:'medium',
 q:{ru:'Какой персонаж Marvel носит щит в форме звезды?'},
 a:{ru:['Капитан Америка','Тор','Железный человек','Чёрная Вдова']},c:0,t:15,
 explanation:'Капитан Америка носит вибраниевый щит с пятиконечной звездой.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['поп-культура'],status:'approved',source:'seed'},

// ── ЛОГИКА (5) ──────────────────────────────────────────────────
{id:'q_g_095',cat:'LOGIC',difficulty:'easy',
 q:{ru:'Следующее число в ряду: 2, 4, 8, 16, ?'},
 a:{ru:['24','28','36','32']},c:3,t:15,
 explanation:'Каждое число умножается на 2: 16 × 2 = 32.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['логика'],status:'approved',source:'seed'},

{id:'q_g_096',cat:'LOGIC',difficulty:'easy',
 q:{ru:'Что тяжелее: килограмм железа или килограмм перьев?'},
 a:{ru:['Железо','Перья','Одинаково']},c:2,t:15,
 explanation:'Килограмм есть килограмм — они весят одинаково.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['логика'],status:'approved',source:'seed'},

{id:'q_g_097',cat:'LOGIC',difficulty:'easy',
 q:{ru:'У меня 3 яблока, я отдал 2. Сколько осталось?'},
 a:{ru:['0','2','3','1']},c:3,t:10,
 explanation:'3 − 2 = 1 яблоко.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['логика'],status:'approved',source:'seed'},

{id:'q_g_098',cat:'LOGIC',difficulty:'medium',
 q:{ru:'Сколько месяцев в году имеют ровно 28 дней?'},
 a:{ru:['1','6','12']},c:2,t:20,
 explanation:'Все 12 месяцев имеют минимум 28 дней.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['логика'],status:'approved',source:'seed'},

{id:'q_g_099',cat:'LOGIC',difficulty:'medium',
 q:{ru:'Если перевернуть цифру 9, какой цифрой она станет?'},
 a:{ru:['1','9','пусто','6']},c:3,t:15,
 explanation:'Перевёрнутая цифра 9 выглядит как 6.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['логика'],status:'approved',source:'seed'},

// ── МЕДИА-ВОПРОСЫ (image×3, audio×2, video×2) ───────────────────
{id:'q_g_100',cat:'ART',difficulty:'medium',
 q:{ru:'🖼 Кто написал этот знаменитый портрет?'},
 a:{ru:['Микеланджело','Рафаэль','Боттичелли','Леонардо да Винчи']},c:3,t:25,
 explanation:'«Мона Лиза» — шедевр Леонардо да Винчи, около 1503–1519 гг.',
 media:{type:'image',url:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mona_Lisa.jpg/402px-Mona_Lisa.jpg',filename:'mona_lisa.jpg',placeholder:''},
 tags:['искусство','живопись'],status:'approved',source:'seed'},

{id:'q_g_101',cat:'ART',difficulty:'medium',
 q:{ru:'🖼 Кто написал эту картину с ночным небом?'},
 a:{ru:['Ван Гог','Клод Моне','Поль Гоген','Камиль Писсарро']},c:0,t:20,
 explanation:'«Звёздная ночь» — шедевр Винсента ван Гога (1889).',
 media:{type:'image',url:'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ea/Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg/640px-Van_Gogh_-_Starry_Night_-_Google_Art_Project.jpg',filename:'starry_night.jpg',placeholder:''},
 tags:['искусство'],status:'approved',source:'seed'},

{id:'q_g_102',cat:'SCIENCE',difficulty:'medium',
 q:{ru:'🎵 Это звуковой сигнал ... — первый сигнал из космоса'},
 a:{ru:['Луны-1','Спутника-1','Мира','Востока-1']},c:1,t:25,
 explanation:'Спутник-1 (1957) — первый искусственный спутник Земли — издавал характерный звуковой сигнал.',
 media:{type:'audio',url:'',filename:'sputnik_beep.mp3',placeholder:'Аудиозапись сигнала спутника-1 (1957)'},
 tags:['наука','история'],status:'approved',source:'seed'},

{id:'q_g_103',cat:'GEOGRAPHY',difficulty:'medium',
 q:{ru:'🎬 Узнай страну по видеофрагменту'},
 a:{ru:['Испания','Франция','Австрия','Италия']},c:1,t:30,
 explanation:'Франция — страна Эйфелевой башни, Парижа и французской кухни.',
 media:{type:'video',url:'',filename:'france_landmarks.mp4',placeholder:'Видеофрагмент с достопримечательностями Франции'},
 tags:['география'],status:'approved',source:'seed'},

// ── ИСКУССТВО (5) ───────────────────────────────────────────────
{id:'q_g_104',cat:'ART',difficulty:'easy',
 q:{ru:'Кто автор «Звёздной ночи»?'},
 a:{ru:['Пикассо','Дали','Ван Гог','Моне']},c:2,t:15,
 explanation:'«Звёздная ночь» написана Ван Гогом в 1889 году.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['искусство'],status:'approved',source:'seed'},

{id:'q_g_105',cat:'ART',difficulty:'easy',
 q:{ru:'В каком музее хранится «Мона Лиза»?'},
 a:{ru:['Эрмитаж','Прадо','Лувр','Метрополитен']},c:2,t:15,
 explanation:'«Мона Лиза» хранится в Лувре, Париж.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['искусство'],status:'approved',source:'seed'},

{id:'q_g_106',cat:'ART',difficulty:'easy',
 q:{ru:'«Девятый вал» написал Айвазовский?'},
 a:{ru:['Да','Нет']},c:0,t:15,
 explanation:'«Девятый вал» (1850) — знаменитая марина Ивана Айвазовского.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['искусство'],status:'approved',source:'seed'},

{id:'q_g_107',cat:'ART',difficulty:'easy',
 q:{ru:'В каком городе находится Эрмитаж?'},
 a:{ru:['Москва','Санкт-Петербург','Казань']},c:1,t:15,
 explanation:'Государственный Эрмитаж расположен в Санкт-Петербурге.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['искусство'],status:'approved',source:'seed'},

{id:'q_g_108',cat:'ART',difficulty:'medium',
 q:{ru:'Кто написал «Рождение Венеры»?'},
 a:{ru:['Рафаэль','Тициан','Микеланджело','Боттичелли']},c:3,t:20,
 explanation:'«Рождение Венеры» — картина Боттичелли, около 1484–1486 гг.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['искусство'],status:'approved',source:'seed'},

// ── DISNEY (5) ──────────────────────────────────────────────────
{id:'q_g_109',cat:'DISNEY',difficulty:'easy',
 q:{ru:'Как зовут злого дядю Симбы?'},
 a:{ru:['Шрам','Муфаса','Рафики','Зазу']},c:0,t:15,
 explanation:'Злого дядю Симбы зовут Шрам (Scar).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['disney'],status:'approved',source:'seed'},

{id:'q_g_110',cat:'DISNEY',difficulty:'easy',
 q:{ru:'В каком фильме Disney звучит «Let It Go»?'},
 a:{ru:['Рапунцель','Храбрая сердцем','Холодное сердце','Моана']},c:2,t:20,
 explanation:'«Let It Go» — песня из «Холодного сердца» (Frozen, 2013).',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['disney'],status:'approved',source:'seed'},

{id:'q_g_111',cat:'DISNEY',difficulty:'easy',
 q:{ru:'Что превратили в карету для Золушки?'},
 a:{ru:['Яблоко','Арбуз','Тыкву']},c:2,t:15,
 explanation:'Фея-крёстная превратила тыкву в золочёную карету.',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['disney'],status:'approved',source:'seed'},

{id:'q_g_112',cat:'DISNEY',difficulty:'easy',
 q:{ru:'Как зовут ковбоя в «Истории игрушек»?'},
 a:{ru:['Базз','Хэм','Рекс','Вуди']},c:3,t:15,
 explanation:'Вуди (Woody) — главный ковбой «Истории игрушек».',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['disney'],status:'approved',source:'seed'},

{id:'q_g_113',cat:'DISNEY',difficulty:'medium',
 q:{ru:'Кем является диснеевский Себастьян?'},
 a:{ru:['Рыба','Дракон','Осьминог','Краб']},c:3,t:25,
 explanation:'Себастьян — краб, придворный музыкант в «Русалочке».',
 media:{type:'none',url:'',filename:'',placeholder:''},tags:['disney'],status:'approved',source:'seed'},

// ── ДОПОЛНИТЕЛЬНЫЙ VIDEO-ВОПРОС ─────────────────────────────────
{id:'q_g_114',cat:'POPCULTURE',difficulty:'medium',
 q:{ru:'🎬 Из какого известного сериала этот видеофрагмент?'},
 a:{ru:['Во все тяжкие','Игра престолов','Острые козырьки','Чёрное зеркало']},c:1,t:30,
 explanation:'«Игра престолов» (Game of Thrones) — фэнтезийный сериал HBO, 2011–2019.',
 media:{type:'video',url:'',filename:'got_scene.mp4',placeholder:'Видеофрагмент из «Игры престолов»'},
 tags:['поп-культура','сериалы'],status:'approved',source:'seed'},
];
// ALL_Q = base questions always available
const ALL_Q = [...ALL_Q_BASE];


// ─── Universal question normalizer for rendering ─────────────────
function toPlayableQuestion(raw){
  if(!raw) return {q:'',a:[],c:0,cat:'GENERAL',t:20,media:{type:'none',url:'',filename:'',placeholder:''}};
  const qText =
    (raw.q && typeof raw.q==='object') ? (raw.q[lang]||raw.q.ru||raw.q.en||'') :
    (typeof raw.q === 'string' && raw.q) ? raw.q :
    raw.question||raw.question_ru||raw.question_text||'';

  // Parse JSON-string fields upfront
  let _ajson = raw.answers_json;
  if(typeof _ajson==='string'){ try{ _ajson=JSON.parse(_ajson); }catch(e){ _ajson=null; } }
  let _ojson = raw.options_json;
  if(typeof _ojson==='string'){ try{ _ojson=JSON.parse(_ojson); }catch(e){ _ojson=null; } }

  let answers =
    Array.isArray(raw.a) ? raw.a :
    (raw.a && typeof raw.a==='object' && !Array.isArray(raw.a))
      ? (raw.a[lang]||raw.a.ru||raw.a.en||[]) :
    Array.isArray(raw.options) ? raw.options :
    Array.isArray(raw.answers) ? raw.answers :
    Array.isArray(raw.answers_ru) ? raw.answers_ru :
    Array.isArray(raw.answers_en) ? raw.answers_en :
    Array.isArray(_ajson) ? _ajson :
    Array.isArray(_ojson) ? _ojson :
    [];

  if(typeof answers==='string'){
    try{ answers=JSON.parse(answers); }catch(e){ answers=[]; }
  }
  answers=(answers||[]).filter(a=>a!==null&&a!==undefined&&String(a).trim()!=='');

  const correct=
    Number.isInteger(raw.c) ? raw.c :
    Number.isInteger(raw.correctIndex) ? raw.correctIndex :
    Number.isInteger(raw.correct_index) ? raw.correct_index :
    0;

  const mediaObj = raw.media && raw.media.type
    ? raw.media
    : {
        type: raw.video?'video':raw.audio?'audio':raw.img?'image':'none',
        url:  raw.video||raw.audio||raw.img||'',
        filename: '',
        placeholder: ''
      };

  return {
    ...raw,
    q: qText,
    a: answers,
    c: Math.max(0, Math.min(correct, Math.max(0, answers.length-1))),
    cat: raw.cat||raw.category||'GENERAL',
    t:   raw.t||raw.time||(function(n){const m={2:20,3:30,4:40,5:50,6:60};return m[n]||20;})(
      (Array.isArray(raw.a)?raw.a:Array.isArray(raw.answers_ru)?raw.answers_ru:Array.isArray(raw.answers)?raw.answers:[]).filter(x=>x!=null&&String(x).trim()!=='').length
    ),
    media: mediaObj,
    explanation: raw.explanation||raw.explanation_ru||'',
    _id: raw._id||raw.id||null,
  };
}

function getQ(q){
  return toPlayableQuestion(q);
}

// ═══════════════════════════════════════════
// PLAYABLE QUESTION VALIDATOR (v87)
// ═══════════════════════════════════════════
const EXCLUDED_STATUSES = new Set(['archived','deleted','rejected','draft','tester','fix','archived_unsupported','needs_reimport']);

// Unified status exclusion — use everywhere before serving questions to players
function isHiddenQuestionStatus(status){
  if(!status) return false;
  return EXCLUDED_STATUSES.has(String(status).toLowerCase());
}

// Only these statuses are playable by users
function isPublishedStatus(status){
  if(!status) return false;
  const s = String(status).toLowerCase();
  return s === 'published' || s === 'approved' || s === 'community_published';
}

const PLACEHOLDER_STRINGS = [
  'медиа будет добавлено','будет добавлено позже','медийки будут позже',
  'media will be added','will be added later'
];

function hasPlaceholderText(str){
  if(!str) return false;
  const s = String(str).toLowerCase();
  return PLACEHOLDER_STRINGS.some(p => s.includes(p));
}

function isPlayableQuestion(raw){
  // Info slides always pass — they have no answers but are valid pack items
  if(raw.question_type === 'info' || raw._questionType === 'info' || raw.media_type === 'info') return true;

  // ── 1. Extract raw answers (same logic as toPlayableQuestion, before filtering)
  let _ajson = raw.answers_json;
  if(typeof _ajson==='string'){ try{ _ajson=JSON.parse(_ajson); }catch(e){ _ajson=null; } }
  let _ojson = raw.options_json;
  if(typeof _ojson==='string'){ try{ _ojson=JSON.parse(_ojson); }catch(e){ _ojson=null; } }

  let rawAnswers =
    Array.isArray(raw.a) ? raw.a :
    (raw.a && typeof raw.a==='object' && !Array.isArray(raw.a))
      ? (raw.a[lang]||raw.a.ru||raw.a.en||[]) :
    Array.isArray(raw.options)   ? raw.options :
    Array.isArray(raw.answers)   ? raw.answers :
    Array.isArray(raw.answers_ru)? raw.answers_ru :
    Array.isArray(raw.answers_en)? raw.answers_en :
    Array.isArray(_ajson)        ? _ajson :
    Array.isArray(_ojson)        ? _ojson : [];

  if(typeof rawAnswers==='string'){
    try{ rawAnswers=JSON.parse(rawAnswers); }catch(e){ rawAnswers=[]; }
  }
  rawAnswers = (rawAnswers||[]).filter(a=>a!==null&&a!==undefined&&String(a).trim()!=='');

  // ── 2. Extract raw correct index — NO clamping
  const rawCorrect =
    Number.isInteger(raw.c)            ? raw.c :
    Number.isInteger(raw.correctIndex) ? raw.correctIndex :
    Number.isInteger(raw.correct_index)? raw.correct_index :
    null;

  // ── 3. Validate BEFORE normalization (catches clamp-hidden bad indices)
  if(rawAnswers.length < 2) return false;
  if(rawCorrect === null || rawCorrect < 0 || rawCorrect >= rawAnswers.length) return false;

  // ── 4. Question text check (use toPlayableQuestion for text extraction only)
  const q = toPlayableQuestion(raw);
  if(!q.q || q.q.trim().length < 2) return false;

  // ── 5. Media check: claimed type but no real URL
  const mtype = q.media && q.media.type;
  const murl  = q.media && q.media.url;
  if(mtype && mtype !== 'none' && mtype !== 'text' && !murl) return false;

  // ── 6. Placeholder text check
  if(hasPlaceholderText(q.q)) return false;
  if(q.media && hasPlaceholderText(q.media.placeholder)) return false;

  return true;
}

function filterPlayableQuestions(arr, opts){
  opts = opts || {};
  const result = arr.filter(q => {
    if(q.status && isHiddenQuestionStatus(q.status)) return false;
    return isPlayableQuestion(q);
  });
  if(opts.logBad && result.length < arr.length){
    console.warn('[MFC] Filtered out', arr.length - result.length, 'unplayable of', arr.length);
    track('playable_filter', {removed: arr.length - result.length, total: arr.length});
  }
  return result;
}

// ═══════════════════════════════════════════
// ANSWER LETTERS — global, declared once here
// ═══════════════════════════════════════════
const LETTERS = ['A','B','C','D','E','F'];

// Safe accessor — never throws even with >6 options or bad index
// [answerLetter] → js/router.js



function getFixedPoints(numOptions){
  // Время = очки: 2→30, 3→35, 4→40, 5→45, 6→50
  return 20 + (numOptions || 4) * 5;
}
// Очки = оставшиеся секунды (каждая секунда = 1 очко, минимум 1)
function getTimedPoints(numOptions, timeLeft, maxTime){
  return Math.max(1, timeLeft);
}

// [STATE] → moved to js/state.js (getState/setState)
// Legacy references to neurons, xp, currentUser etc. read from window.* 
// which are populated by state.js via the ES module


// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
// Screens where no active game can be in progress — stop integrity when entering them
// [NON_GAME_SCREENS] → js/config.js


// [showScreen] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [toast] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [showFb] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [buildDots] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [setDot] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [updNeurons] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// Award neurons AND xp together (use this instead of neurons++ directly when possible)
// ── Server-first currency functions ──────────────────────────────
// For authenticated users: all mutations go through Supabase RPC.
// Guest users get a local demo balance (not persisted to account).

// [awardNeurons] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [spendNeurons] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [refreshBalance] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

function randCode(){return Math.random().toString(36).slice(2,8).toUpperCase();}

// ═══════════════════════════════════════════
// ACHIEVEMENTS
// ═══════════════════════════════════════════
function checkBadges(newBadge){
  if(!earnedBadges.has(newBadge)){
    earnedBadges.add(newBadge);
    localStorage.setItem('mfc_badges',JSON.stringify([...earnedBadges]));
    renderBadges();
    return true;
  }
  return false;
}
function renderBadges(){
  // Update home screen badge IDs (legacy compatibility)
  const map={first:'badge-first',streak3:'badge-streak3',streak5:'badge-streak5',perfect:'badge-perfect',duel:'badge-duel',tourn:'badge-tourn',neurons100:'badge-neurons100'};
  Object.entries(map).forEach(([key,id])=>{
    const el=document.getElementById(id);
    if(el)el.classList.toggle('earned',earnedBadges.has(key));
  });
  // Re-render full badge grid in profile if visible
  if(document.getElementById('profile')?.classList.contains('active')){
    renderProfileBadges();
  }
  // Update home next goal
  renderHomeNextGoal();
}
function showBadgeEarned(key){
  const names={first:t('bFirst'),streak3:t('bStreak3'),streak5:t('bStreak5'),perfect:t('bPerfect'),duel:t('bDuel'),tourn:t('bTourn'),neurons100:t('bNeurons')};
  const el=document.getElementById('badge-earned-popup');
  el.textContent=t('badgeEarned')+' '+names[key];
  el.classList.add('show');
}


// ═══════════════════════════════════════════
// PROFILE
// ═══════════════════════════════════════════
const BADGE_DEFS = [
  {key:'first',     icon:'⚡', name:{ru:'Первая игра'},    desc:{ru:'Сыграй первый квиз'},                    cond:{ru:'Сыграй 1 игру'}},
  {key:'streak3',   icon:'🔥', name:{ru:'Серия x3'},       desc:{ru:'3 дня подряд в игре'},                   cond:{ru:'Заходи 3 дня подряд'}},
  {key:'streak5',   icon:'💥', name:{ru:'Серия x5'},       desc:{ru:'5 дней подряд в игре'},                  cond:{ru:'Заходи 5 дней подряд'}},
  {key:'perfect',   icon:'🎯', name:{ru:'Идеально'},       desc:{ru:'Все вопросы правильно'},                 cond:{ru:'Ответь на все вопросы в игре верно'}},
  {key:'duel',      icon:'⚔️', name:{ru:'Первая дуэль'},   desc:{ru:'Сыграй первую дуэль'},                   cond:{ru:'Сыграй дуэль с кем-нибудь'}},
  {key:'duel_win',  icon:'🏅', name:{ru:'Победа в дуэли'}, desc:{ru:'Выиграй дуэль'},                         cond:{ru:'Победи в дуэли'}},
  {key:'tourn',     icon:'🏆', name:{ru:'Турнир'},         desc:{ru:'Участвуй в турнире'},                    cond:{ru:'Сыграй в любом турнире'}},
  {key:'neurons100',icon:'🧠', name:{ru:'100 нейронов'},   desc:{ru:'Набери 100 нейронов'},                   cond:{ru:'Накопи 100 нейронов'}},
  {key:'speed',     icon:'⚡', name:{ru:'Молния'},         desc:{ru:'Быстро отвечай на вопросы'},             cond:{ru:'Ответь на 5 вопросов менее чем за 5 сек'}},
  {key:'bug_finder',icon:'🔍', name:{ru:'Искатель ошибок'},desc:{ru:'Помоги улучшить игру'},                  cond:{ru:'Отправь первую жалобу на вопрос'}},
  {key:'author',    icon:'✍️', name:{ru:'Автор'},          desc:{ru:'Внеси свой вклад'},                      cond:{ru:'Предложи первый вопрос'}},
  {key:'editor',    icon:'📝', name:{ru:'Редактор'},       desc:{ru:'Твой вопрос приняли!'},                  cond:{ru:'Отправь вопрос, который одобрят'}},
];

function showProfile(){
  try{
  renderProfileBadges();
  if(!currentUser){
    document.getElementById('profile-guest').style.display='flex';
    const heroEl=document.getElementById('profile-hero-div');
    if(heroEl)heroEl.style.display='none';
    const statsEl=document.querySelector('.profile-stats-grid');
    if(statsEl)statsEl.style.display='none';
    const badgesEl=document.getElementById('profile-badges-grid');
    if(badgesEl)badgesEl.style.display='none';
    // translate guest screen
    document.getElementById('pg-title').textContent=lang==='ru'?'Вы играете как гость':"You're playing as guest";
    document.getElementById('pg-sub').textContent=lang==='ru'?'Войдите чтобы сохранить прогресс и соревноваться глобально':'Войдите, чтобы сохранить прогресс';
    document.getElementById('pg-google-btn').textContent=lang==='ru'?'Войти через Google':'Войти через Google';
    return;
  }
  document.getElementById('profile-guest').style.display='none';
  const ph=document.getElementById('profile-hero-div');if(ph)ph.style.display='block';
  const ps=document.querySelector('.profile-stats-grid');if(ps)ps.style.display='grid';
  const pb=document.getElementById('profile-badges-grid');if(pb)pb.style.display='grid';
  // Fill user info — prefer display_name from profiles (user may have changed it)
  const metaName = currentUser.user_metadata?.full_name||currentUser.email?.split('@')[0]||'Игрок';
  const savedName = localStorage.getItem('mfc_display_name');
  const name = savedName || metaName;
  const initial=name[0].toUpperCase();
  document.getElementById('profile-av').textContent=initial;
  document.getElementById('profile-name').textContent=name;
  document.getElementById('profile-email').textContent=currentUser.email||'';
  // Async: fetch display_name from DB and update if different
  if(currentUser){
    sb.from('profiles').select('display_name').eq('id',currentUser.id).single().then(({data})=>{
      // localStorage wins over DB — user may have just saved (upsert still in-flight)
      const currentSaved = localStorage.getItem('mfc_display_name');
      const displayName = currentSaved || data?.display_name;
      if(displayName && displayName !== name){
        if(!currentSaved) localStorage.setItem('mfc_display_name', displayName);
        document.getElementById('profile-name').textContent = displayName;
        document.getElementById('profile-av').textContent = displayName[0].toUpperCase();
      }
    }).catch(()=>{});
  }
  // Show level with progress bar (Fix 7)
  const level = getPlayerLevel(neurons);
  const levelName = level.name[lang];
  const existingBadge = document.querySelector('.level-badge');
  const progressPct = Math.min(100, Math.round((level.progress||0) * 100));
  const nextInfo = level.next
    ? `${lang==='ru'?'До':'Until'} ${level.next >= 1000 ? (level.next/1000)+'k' : level.next} ⚡`
    : (lang==='ru' ? 'Максимальный уровень!' : 'Max level!');

  const badgeHTML = `<div class="level-badge">${level.icon} ${levelName}</div>
    <div style="margin:4px 0 0;max-width:200px">
      <div style="height:4px;background:var(--bg3);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${progressPct}%;background:var(--gold);border-radius:4px;transition:width .3s"></div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-top:2px">${nextInfo}</div>
    </div>`;

  // New profile design: update static rank badge element
  const rankBadgeEl = document.getElementById('profile-rank-badge');
  if (rankBadgeEl) {
    const rank = getRank(xp);
    rankBadgeEl.textContent = rank.icon + ' ' + rank.name;
  } else {
    // Fallback for old profile layout
    const afterEl = document.getElementById('profile-email');
    document.querySelectorAll('.level-badge').forEach(b=>b.parentElement?.removeChild(b));
    const levelWrap = document.createElement('div');
    levelWrap.innerHTML = badgeHTML;
    afterEl?.insertAdjacentElement('afterend', levelWrap);
    document.querySelectorAll('.profile-rank-wrap').forEach(b=>b.remove());
    const rankWrap = document.createElement('div');
    rankWrap.className = 'profile-rank-wrap';
    rankWrap.innerHTML = _rankBadgeHTML(xp);
    levelWrap.insertAdjacentElement('afterend', rankWrap);
  }
  document.getElementById('n-profile').textContent=neurons;
  // Load stats from DB
  loadProfileStats();
  renderProfileCity();
  if(isAdmin()) loadAdminDashboard();
  updatePushBtn();
  // Translate labels
  const L=T[lang];
  const _st = (id,v) => { const e=document.getElementById(id); if(e) e.textContent=v; };
  _st('profile-stats-title','Статистика');
  const statLabels = document.querySelectorAll('.stat-label');
  const statMap = {
    'Games': L.statsGames||'Игры', 'Игры': L.statsGames||'Игры',
    'Correct': L.statsCorrect||'Верных', 'Верных': L.statsCorrect||'Верных',
    'Accuracy': L.statsAcc||'Точность', 'Точность': L.statsAcc||'Точность',
    'Best streak': L.statsStreak||'Лучшая серия', 'Лучшая серия': L.statsStreak,
  };
  statLabels.forEach(el=>{ if(statMap[el.textContent]) el.textContent=statMap[el.textContent]; });
  _st('profile-badges-title',lang==='ru'?'Достижения':'Achievements');
  _st('ps-neurons-lbl','Нейроны'); _st('ps-games-lbl',lang==='ru'?'Игры':'Games');
  _st('ps-streak-lbl',lang==='ru'?'Лучшая серия':'Best streak');
  _st('ps-acc-lbl',lang==='ru'?'Точность':'Accuracy');
  _st('ps-duels-lbl',lang==='ru'?'Дуэли выиграны':'Duels won');
  _st('ps-correct-lbl',lang==='ru'?'Верных ответов':'Correct answers');
  _st('profile-signout-btn',lang==='ru'?'Выйти':'Sign out');

  // Set ref link immediately from user id (fallback if DB unavailable)
  if(currentUser) {
    const _fallbackCode = currentUser.id.slice(0,8);
    const _refEl = document.getElementById('profile-ref-link');
    if(_refEl && _refEl.textContent.includes('Войди')) {
      _refEl.textContent = location.origin + location.pathname + '?ref=' + _fallbackCode;
    }
  }
  // Share profile button
  const signoutBtn = document.getElementById('profile-signout-btn');
  if (signoutBtn && !document.getElementById('profile-share-btn')) {
    const shareBtn = document.createElement('button');
    shareBtn.id = 'profile-share-btn';
    shareBtn.className = signoutBtn.className;
    shareBtn.style.cssText = 'width:100%;margin-bottom:8px;background:rgba(108,99,255,.12);border:0.5px solid var(--accent2);color:var(--accent2);border-radius:14px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit';
    shareBtn.textContent = '🔗 Поделиться профилем';
    shareBtn.onclick = () => {
      const displayName = document.getElementById('profile-name')?.textContent || '';
      navigator.clipboard.writeText(location.origin + '?u=' + encodeURIComponent(displayName))
        .then(() => window.toast?.('🔗 Ссылка на профиль скопирована!'));
    };
    signoutBtn.parentElement.insertBefore(shareBtn, signoutBtn);
  }
  }catch(e){console.error('Profile error:',e);}
}

function updatePushBtn(){
  const btn = document.getElementById('push-notif-btn');
  if(!btn) return;
  if(!('Notification' in window)){
    btn.style.display = 'none';
    return;
  }
  if(Notification.permission === 'granted'){
    btn.textContent = '✅ Уведомления включены';
    btn.disabled = true;
    btn.style.opacity = '.5';
    btn.style.cursor = 'default';
  } else if(Notification.permission === 'denied'){
    btn.textContent = '🚫 Уведомления заблокированы';
    btn.disabled = true;
    btn.style.opacity = '.5';
    btn.style.cursor = 'default';
  } else {
    btn.textContent = '🔔 Включить уведомления о дуэлях';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

async function loadProfileStats(){
  if(!currentUser) return;
  try{
    // Use player_stats view (aggregates game_sessions + profiles)
    const {data, error} = await sb.from('player_stats')
      .select('*').eq('user_id', currentUser.id).single();

    if(error) throw error;
    if(!data) return;

    const setText = (id, val) => { const el=document.getElementById(id); if(el) el.textContent=val; };
    setText('ps-neurons',       data.neurons   || 0);
    setText('ps-games',         data.games_played || 0);
    setText('ps-streak',        data.best_streak  || 0);
    setText('ps-acc',           (data.accuracy_pct || 0) + '%');
    setText('ps-duels',         data.duels_played  || 0);
    setText('ps-correct',       data.correct_total || 0);
    setText('ps-duels-played',  data.duels_played  || 0);
    setText('ps-packs',         data.games_played  || 0);

    // Show stats block if hidden
    const titleEl = document.getElementById('profile-stats-title');
    if(titleEl) titleEl.style.display = '';

    // Local stats (not in DB)
    const submittedQ = JSON.parse(localStorage.getItem('mfc_pending_questions')||'[]').length;
    const reportsCount = JSON.parse(localStorage.getItem('mfc_question_reports')||'[]').length;
    setText('ps-questions-submitted', submittedQ);
    setText('ps-reports', reportsCount);

  }catch(e){
    console.warn('[BFC] loadProfileStats fallback:', e.message);
    // Fallback: just show neurons from profiles
    const {data: pd} = await sb.from('profiles').select('neurons,xp,daily_streak,best_daily_streak').eq('id',currentUser.id).single();
    if(pd){
      const setText=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
      setText('ps-neurons', pd.neurons||0);
      setText('ps-streak',  pd.best_daily_streak||0);
    }
  }
  loadAnalyticsSummary();
  loadPackHistory();
  loadDuelHistory();
  loadFriends();
  loadPendingChallenges();
}

async function loadPackHistory() {
  const wrap = document.getElementById('pack-history-wrap');
  const list = document.getElementById('pack-history-list');
  if (!wrap || !list) return;

  // Try DB first, fall back to localStorage
  let rows = [];
  if (currentUser && sb) {
    const { data } = await sb.from('pack_results')
      .select('*').eq('user_id', currentUser.id)
      .order('played_at', { ascending: false }).limit(10);
    rows = data || [];
  }
  if (!rows.length) {
    rows = JSON.parse(localStorage.getItem('bfc_pack_history') || '[]').slice(0, 10);
  }
  if (!rows.length) return;

  wrap.style.display = '';
  const icons = { 0: '📚', 50: '🎯', 80: '🏆' };
  list.innerHTML = rows.map(r => {
    const pct = Math.round((r.correct / (r.total || 1)) * 100);
    const icon = pct >= 80 ? '🏆' : pct >= 50 ? '🎯' : '📚';
    const date = new Date(r.played_at).toLocaleDateString('ru', { day: 'numeric', month: 'short' });
    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px">
      <div style="font-size:24px">${icon}</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${r.pack_title || r.pack_id}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${r.correct}/${r.total} верных · ${date}</div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:16px;font-weight:900;color:var(--accent2)">⚡${r.score}</div>
        <div style="font-size:11px;color:var(--muted)">${pct}%</div>
      </div>
    </div>`;
  }).join('');
}

async function loadDuelHistory() {
  const wrap = document.getElementById('duel-history-wrap');
  const list  = document.getElementById('duel-history-list');
  if (!wrap || !list || !currentUser) return;

  const { data: sessions } = await sb
    .from('game_sessions')
    .select('id, mode, score, correct_answers, questions_count, won, started_at, opponent_name')
    .eq('user_id', currentUser.id)
    .in('mode', ['friend_battle', 'random_battle', 'virtual_battle'])
    .order('started_at', { ascending: false })
    .limit(20);

  if (!sessions || sessions.length === 0) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = 'block';
  list.innerHTML = sessions.map(s => {
    const won   = s.won;
    const date  = new Date(s.started_at).toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const mode  = s.mode === 'friend_battle' ? 'Друг' : s.mode === 'random_battle' ? 'Случайный' : 'Бот';
    const opp   = s.opponent_name || mode;
    const result = won === true ? '🏆 Победа' : won === false ? '💀 Поражение' : '🤝 Ничья';
    const color  = won === true ? 'var(--green, #4ade80)' : won === false ? 'var(--red, #f87171)' : 'var(--muted)';
    const acc    = s.questions_count > 0 ? Math.round((s.correct_answers || 0) / s.questions_count * 100) : 0;
    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:12px">
      <div style="font-size:20px">${won === true ? '🏆' : won === false ? '💀' : '🤝'}</div>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">vs ${opp}</div>
        <div style="font-size:11px;color:var(--muted)">${date} · ${mode}</div>
      </div>
      <div style="text-align:right">
        <div style="font-weight:800;font-size:13px;color:${color}">${result}</div>
        <div style="font-size:11px;color:var(--muted)">⚡${s.score || 0} · ${acc}%</div>
      </div>
    </div>`;
  }).join('');
}

async function loadAnalyticsSummary(){
  // Техническая аналитика перенесена в админку.
  // В профиле показываем только пользовательские достижения — уже отображены выше.
  const wrap = document.getElementById('profile-analytics');
  if(wrap) wrap.style.display = 'none';
}

// Техническая аналитика только для админки
const ANALYTICS_LABEL_MAP = {
  'question_answered':      'Ответы на вопросы',
  'play_menu_viewed':       'Открытия меню игры',
  'quiz_window_blur':       '⚙️ Уход с вкладки (античит)',
  'quiz_tab_hidden':        '⚙️ Скрытая вкладка (античит)',
  'quiz_integrity_warning': '⚙️ Предупреждение (античит)',
  'quiz_started':           'Начатые игры',
  'quiz_completed':         'Завершённые игры',
  'app_opened':             'Открытия приложения',
  'result_viewed':          'Просмотры результата',
  'item_purchased':         'Покупки предметов',
  'pack_played':            'Сыгранные паки',
  'pack_started':           'Запуски паков',
  'guest_started':          'Старт как гость',
  'matchmaking_started':    'Запуски случайного боя',
  'daily_completed':        'Выполненные задания дня',
  'daily_started':          'Запуски задания дня',
  'powerup_used':           'Использованные усиления',
  'share_screen_viewed':    'Открытия экрана шаринга',
  'duel_created':           'Созданные дуэли',
  'duel_joined':            'Подключения к дуэли',
  'duel_completed':         'Завершённые дуэли',
  'signup_started':         'Начало регистрации',
  'referral_clicked':       'Клики по реф. ссылке',
  'referral_signed_up':     'Регистрации по реф.',
  'author_questions_submitted': 'Отправленные вопросы авторов',
};

async function _checkOrgApplications() {
  const alert = document.getElementById('admin-org-alert');
  if (!alert) return;
  const { count } = await sb.from('organizer_profiles')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'pending');
  if (count > 0) {
    alert.style.display = 'block';
    document.getElementById('admin-org-alert-text').textContent = `${count} новых заявок организаторов`;
  }
}

window.loadAdminOrgApplications = async function() {
  const list = document.getElementById('admin-org-list');
  if (!list) return;

  const { data } = await sb.from('organizer_profiles')
    .select('user_id, display_name, contact_email, city, about, status, created_at')
    .order('created_at', { ascending: false })
    .limit(20);

  if (!data?.length) { list.innerHTML = '<div style="color:var(--muted);font-size:12px">Нет заявок</div>'; return; }

  list.innerHTML = data.map(r => `
    <div style="border-bottom:0.5px solid var(--border);padding:10px 0;font-size:12px">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px">
        <span style="font-weight:800">${r.display_name || '—'}</span>
        <span style="background:${r.status==='pending'?'rgba(240,192,64,.15)':'rgba(74,222,128,.15)'};color:${r.status==='pending'?'var(--gold)':'var(--green)'};border-radius:6px;padding:2px 8px">${r.status}</span>
      </div>
      <div style="color:var(--muted)">${r.contact_email} · ${r.city || 'город не указан'}</div>
      <div style="color:var(--muted);margin-top:3px;line-height:1.4">${(r.about||'').slice(0,120)}</div>
      ${r.status === 'pending' ? `
        <div style="display:flex;gap:6px;margin-top:8px">
          <button onclick="approveOrg('${r.user_id}')" style="background:rgba(74,222,128,.15);border:0.5px solid var(--green);border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;font-family:inherit">✓ Одобрить</button>
          <button onclick="rejectOrg('${r.user_id}')" style="background:rgba(224,85,85,.1);border:0.5px solid rgba(224,85,85,.3);border-radius:8px;padding:5px 12px;font-size:11px;font-weight:700;color:var(--red);cursor:pointer;font-family:inherit">✗ Отклонить</button>
        </div>` : ''}
    </div>`).join('');
};

window.approveOrg = async function(userId) {
  const { error } = await sb.from('organizer_profiles')
    .update({ status: 'approved', approved_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('✓ Организатор одобрен');
  window.loadAdminOrgApplications();
};

window.rejectOrg = async function(userId) {
  const { error } = await sb.from('organizer_profiles')
    .update({ status: 'rejected' })
    .eq('user_id', userId);
  if (error) { toast('Ошибка: ' + error.message); return; }
  toast('Заявка отклонена');
  window.loadAdminOrgApplications();
};

window.loadAdminKPI = async function() {
  if (!isAdmin()) return;
  const el = document.getElementById('admin-kpi-content');
  if (!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:8px 0">⏳ Загрузка...</div>';

  const since30 = new Date(Date.now() - 30*24*60*60*1000).toISOString();
  const since7  = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  const today   = new Date(); today.setHours(0,0,0,0);

  try {
    const [
      { count: totalUsers },
      { count: newUsers30 },
      { count: dau },
      { count: packPlays7 },
      { count: trnParticipants30 },
      { data: topPacks },
    ] = await Promise.all([
      sb.from('profiles').select('*', { count: 'exact', head: true }),
      sb.from('profiles').select('*', { count: 'exact', head: true }).gte('created_at', since30),
      sb.from('analytics_events').select('*', { count: 'exact', head: true }).eq('event_name', 'session_start').gte('created_at', today.toISOString()),
      sb.from('pack_results').select('*', { count: 'exact', head: true }).gte('played_at', since7),
      sb.from('tournament_participants').select('*', { count: 'exact', head: true }).gte('created_at', since30),
      sb.from('pack_results').select('pack_id, pack_title').gte('played_at', since7).limit(200),
    ]);

    // Count pack plays
    const packCounts = {};
    (topPacks || []).forEach(r => { packCounts[r.pack_title || r.pack_id] = (packCounts[r.pack_title || r.pack_id] || 0) + 1; });
    const topPackList = Object.entries(packCounts).sort((a,b) => b[1]-a[1]).slice(0, 3);

    const kpi = [
      { label: 'Всего пользователей', value: totalUsers ?? '—', icon: '👤' },
      { label: 'Новых за 30 дней',    value: newUsers30 ?? '—', icon: '🆕' },
      { label: 'Сессий сегодня (DAU)', value: dau ?? '—',       icon: '📅' },
      { label: 'Игр в паки (7 дней)', value: packPlays7 ?? '—', icon: '🎮' },
      { label: 'Турнирных участий (30д)', value: trnParticipants30 ?? '—', icon: '🏆' },
    ];

    const grid = kpi.map(k => `
      <div style="background:var(--bg3);border-radius:10px;padding:12px;text-align:center">
        <div style="font-size:20px;margin-bottom:4px">${k.icon}</div>
        <div style="font-size:22px;font-weight:900;color:var(--accent2)">${k.value}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px;line-height:1.3">${k.label}</div>
      </div>`).join('');

    const packsHtml = topPackList.length ? `
      <div style="margin-top:12px;font-size:11px;font-weight:800;color:var(--muted);letter-spacing:.5px;margin-bottom:6px">ТОП ПАКИ (7 дней)</div>
      ${topPackList.map(([name, n], i) => `
        <div style="display:flex;justify-content:space-between;font-size:12px;padding:5px 0;border-bottom:0.5px solid var(--border)">
          <span>${['🥇','🥈','🥉'][i]} ${name}</span>
          <span style="color:var(--accent2);font-weight:800">${n} игр</span>
        </div>`).join('')}` : '';

    el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:4px">${grid}</div>${packsHtml}`;
  } catch(e) {
    el.innerHTML = `<div style="color:var(--muted);font-size:12px">Ошибка: ${e.message}</div>`;
  }
};

async function loadAdminAnalytics(){
  if(!isAdmin()) return;
  const el = document.getElementById('admin-analytics-content');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">⏳ Загрузка...</div>';
  const since = new Date(Date.now() - 7*24*60*60*1000).toISOString();
  try{
    const {data: events} = await sb.from('analytics_events')
      .select('event_name,created_at')
      .gte('created_at', since)
      .order('created_at', {ascending:false})
      .limit(1000);
    if(!events||!events.length){
      el.innerHTML = '<div style="color:var(--muted);font-size:12px">Нет событий за 7 дней</div>';
      return;
    }
    const counts = {};
    events.forEach(e=>{ counts[e.event_name]=(counts[e.event_name]||0)+1; });
    const rows = Object.entries(counts).sort((a,b)=>b[1]-a[1]).map(([name,n])=>{
      const label = ANALYTICS_LABEL_MAP[name] || name;
      return `<div style="display:flex;justify-content:space-between;border-bottom:0.5px solid var(--border);padding:4px 0;font-size:12px">
        <span style="color:${label.startsWith('⚙️')?'var(--muted)':'var(--text)'}">${label}</span>
        <span style="color:var(--accent2);font-weight:800">${n}</span>
      </div>`;
    }).join('');
    el.innerHTML = rows;
  }catch(e){
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Нет доступа к аналитике</div>';
  }
}

// ═══════════════════════════════════════════
// ADMIN HEALTH CHECK
// ═══════════════════════════════════════════
async function runHealthCheck(){
  const el = document.getElementById('admin-health-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);padding:4px 0">⏳ Checking...</div>';

  const checks = [];

  // Helper: check table exists by doing a limit-1 select
  async function checkTable(name){
    try{
      const {error} = await sb.from(name).select('id').limit(1);
      return error ? {ok:false, error: error.message} : {ok:true};
    }catch(e){ return {ok:false, error:e.message}; }
  }

  // Helper: check column exists
  async function checkColumn(table, col){
    try{
      const {data, error} = await sb.from(table).select(col).limit(1);
      return error ? {ok:false, error: error.message} : {ok:true};
    }catch(e){ return {ok:false, error:e.message}; }
  }

  // Tables
  const tables = [
    'questions','question_reviews','official_tournaments',
    'official_tournament_questions','official_tournament_players',
    'official_tournament_answers','matchmaking_queue'
  ];
  for(const t of tables){
    const r = await checkTable(t);
    checks.push({label:`Table: ${t}`, ...r});
  }

  // Columns — verify only real current columns
  const cols = [
    ['official_tournament_players','disqualified'],
    ['official_tournament_players','violations'],
    ['official_tournament_players','total_away_ms'],
    ['questions','import_key'],
    ['questions','correct_index'],
    ['questions','category'],
    ['questions','source_type'],
    ['questions','question_type'],
    ['questions','question_scope'],
    ['game_packs','pack_type'],
    ['game_packs','source_type'],
  ];
  for(const [t,c] of cols){
    const r = await checkColumn(t,c);
    checks.push({label:`${t}.${c}`, ...r});
  }

  // Questions stats — detailed breakdown
  try{
    const {count: ogPublished} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('source_type','official_general').eq('status','published').not('import_key','like','game_%');
    const {count: ogDraft} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('source_type','official_general').eq('status','draft').not('import_key','like','game_%');
    const {count: opPublished} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('source_type','official_pack').eq('status','published');
    const {count: opDraft} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('source_type','official_pack').eq('status','draft');
    const {count: community} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('source_type','community');
    const {count: archived} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('status','archived_unsupported');
    const {count: legacyGame} = await sb.from('questions').select('*',{count:'exact',head:true})
      .like('import_key','game_%').not('status','eq','archived_unsupported');
    const {count: invalidMC} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('question_type','multiple_choice').eq('status','published').is('correct_index',null);

    const noOfficial = (ogPublished||0) === 0;
    checks.push({
      label: noOfficial
        ? `⚠️ Нет валидных official_general published — импортируй official_general_mc.csv`
        : `official_general published: ${ogPublished}`,
      ok: !noOfficial, info: !noOfficial
    });
    checks.push({label:`official_general draft: ${ogDraft||0}`, ok:true, info:true});
    checks.push({label:`official_pack published: ${opPublished||0}`, ok:true, info:true});
    checks.push({label:`official_pack draft: ${opDraft||0}`, ok:true, info:true});
    if(community) checks.push({label:`Community questions: ${community}`, ok:true, info:true});
    if(legacyGame) checks.push({label:`Старые game_% (не archived): ${legacyGame} — запусти cleanup_old_imports.sql`, ok:false});
    if(invalidMC) checks.push({label:`Invalid MC (no correct_index): ${invalidMC}`, ok:false});
    checks.push({label:`Archived unsupported: ${archived||0} (не мешают игре)`, ok:true, info:true});
  }catch(e){ checks.push({label:'Questions count error', ok:false, error:e.message}); }

  // Render
  el.innerHTML = checks.map(c=>{
    const icon = c.ok ? '✅' : '❌';
    const color = c.ok ? (c.info ? 'var(--muted)' : 'var(--green)') : 'var(--red)';
    const errMsg = !c.ok && c.error ? ` <span style="opacity:.6;font-size:10px">${c.error.slice(0,40)}</span>` : '';
    return `<div style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:0.5px solid var(--border)">
      <span style="color:${color};flex-shrink:0;font-size:13px">${icon}</span>
      <span style="color:${c.ok?(c.info?'var(--muted)':'var(--text)'):'var(--red)'};font-size:12px">${c.label}</span>${errMsg}
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════
// TOURNAMENT PREFLIGHT CHECK
// ═══════════════════════════════════════════
async function tournamentPreflight(tournamentId){
  try{
    const {count: qCount} = await sb.from('official_tournament_questions')
      .select('*',{count:'exact',head:true}).eq('tournament_id', tournamentId);
    const {count: pCount} = await sb.from('official_tournament_players')
      .select('*',{count:'exact',head:true}).eq('tournament_id', tournamentId);
    const {data: mediaQs} = await sb.from('official_tournament_questions')
      .select('question_id').eq('tournament_id', tournamentId);

    let mediaCount = 0;
    if(mediaQs && mediaQs.length){
      const ids = mediaQs.map(q=>q.question_id);
      const {count} = await sb.from('questions')
        .select('*',{count:'exact',head:true})
        .in('id', ids)
        .not('media_type','is',null);
      mediaCount = count||0;
    }

    const warnings = [];
    if(!qCount || qCount===0) warnings.push('❌ Нет вопросов в турнире!');
    if(!pCount || pCount < 2) warnings.push(`⚠️ Игроков: ${pCount||0} (нужно минимум 2)`);

    const summary = [
      `📋 Вопросов: ${qCount||0}`,
      `👥 Игроков: ${pCount||0}`,
      `🎬 С медиа: ${mediaCount}`,
      ...warnings
    ].join('\n');

    return {ok: warnings.filter(w=>w.startsWith('❌')).length===0, summary, qCount, pCount, warnings};
  }catch(e){
    return {ok:false, summary:'Ошибка проверки: '+e.message, qCount:0, pCount:0, warnings:['❌ '+e.message]};
  }
}

// ADMIN DASHBOARD
// ═══════════════════════════════════════════
const ADMIN_EMAILS = ['pantandrej@yandex.ru', 'mozgokvest.intop@gmail.com']; // fallback — never remove

let currentUserRole = null; // 'owner' | 'admin' | 'moderator' | null

function isAdmin(){
  // Hardcoded fallback always works
  if(currentUser && ADMIN_EMAILS.includes(currentUser.email)) return true;
  // Dynamic role from admin_users table
  return currentUserRole === 'owner' || currentUserRole === 'admin' || currentUserRole === 'superadmin';
}

function isModerator(){
  return isAdmin() || currentUserRole === 'moderator';
}

async function loadCurrentUserRole(){
  if(!currentUser) { currentUserRole = null; return; }
  // Hardcoded fallback — already owner
  if(ADMIN_EMAILS.includes(currentUser.email)){ currentUserRole = 'owner'; return; }
  try{
    const {data} = await sb.from('admin_users')
      .select('role')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    currentUserRole = data ? data.role : null;
  }catch(e){ currentUserRole = null; }
}

async function loadAdminDashboard(){
  // Show compact admin button in profile
  const dash = document.getElementById('admin-dashboard');
  if(dash && isAdmin()) dash.style.display = 'block';
  // Show create tournament button for admins
  const ctrn = document.getElementById('create-trn-btn-wrap');
  if(ctrn && isAdmin()) ctrn.style.display = 'block';
  if(!isAdmin()) return;
  // Check for pending organizer applications
  _checkOrgApplications();

  const kpiEl = document.getElementById('admin-kpis');
  const evEl  = document.getElementById('admin-events');

  if(kpiEl) kpiEl.innerHTML = '<div style="grid-column:1/-1;color:var(--muted);font-size:12px;text-align:center;padding:8px">⏳ Загрузка метрик...</div>';
  if(evEl) evEl.innerHTML = '';

  try{
    await _loadAdminDashboardInner(kpiEl, evEl);
  }catch(err){
    console.error('[MFC] loadAdminDashboard error:', err);
    if(kpiEl) kpiEl.innerHTML = `
      <div style="grid-column:1/-1;padding:16px;text-align:center">
        <div style="color:var(--red);font-size:13px;margin-bottom:10px">❌ Ошибка загрузки метрик:<br>${err.message||err}</div>
        <button onclick="loadAdminDashboard()"
          style="background:var(--accent);border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">
          🔄 Попробовать снова
        </button>
      </div>`;
  }
}

async function _loadAdminDashboardInner(kpiEl, evEl){
  loadAdminOTList();
  loadAdminGames();
  loadAdminOrgApplications();

  // ── Dates ──────────────────────────────────────────────
  const now      = new Date();
  const todayISO = now.toISOString().slice(0,10);
  const yday     = new Date(now - 86400000).toISOString().slice(0,10);
  const d7ago    = new Date(now - 7*86400000).toISOString().slice(0,10);
  const d30ago   = new Date(now - 30*86400000).toISOString().slice(0,10);

  // ── Parallel data load ─────────────────────────────────
  const [
    {count: totalUsers},
    {count: totalGames},
    {count: totalAnswers},
    {count: dau},
    {count: wau},
    {data: eventsData},
    {data: packSales},
    {data: neuronsData},
    {data: newUsersToday},
    {data: d1Cohort},
    {data: d7Cohort},
  ] = await Promise.all([
    sb.from('profiles').select('*',{count:'exact',head:true}),
    sb.from('games').select('*',{count:'exact',head:true}),
    sb.from('game_answers').select('*',{count:'exact',head:true}),
    // DAU: users who played quick play today (via analytics)
    sb.from('analytics_events').select('*',{count:'exact',head:true})
      .eq('event_name','quiz_completed')
      .gte('created_at', todayISO+'T00:00:00Z'),
    // WAU: last 7 days
    sb.from('analytics_events').select('*',{count:'exact',head:true})
      .eq('event_name','quiz_completed')
      .gte('created_at', d7ago+'T00:00:00Z'),
    // Event funnel
    sb.from('analytics_events').select('event_name').in('event_name',[
      'quiz_completed','signup_completed','signup_started',
      'referral_signed_up','referral_activated',
      'duel_completed','team_created','team_joined','share_clicked',
      'pack_purchased','bot_battle_started','bot_battle_auto',
    ]).limit(10000),
    // Pack sales
    sb.from('user_pack_purchases').select('price_neurons,purchased_at')
      .gte('purchased_at', d30ago+'T00:00:00Z'),
    // Neurons earned (from profiles)
    sb.from('profiles').select('neurons').gt('neurons',0).limit(5000),
    // New users today
    sb.from('profiles').select('id,created_at')
      .gte('created_at', todayISO+'T00:00:00Z'),
    // D1 cohort: users who signed up yesterday
    sb.from('profiles').select('id')
      .gte('created_at', yday+'T00:00:00Z')
      .lt('created_at', todayISO+'T00:00:00Z'),
    // D1 active: all user_ids who completed quiz today (we'll intersect)
    sb.from('analytics_events').select('user_id')
      .eq('event_name','quiz_completed')
      .gte('created_at', todayISO+'T00:00:00Z')
      .not('user_id','is',null),
  ]);

  // ── Compute derived metrics ────────────────────────────
  const evCounts = {};
  (eventsData||[]).forEach(e=>{ evCounts[e.event_name]=(evCounts[e.event_name]||0)+1; });

  const totalPackRevenue = (packSales||[]).reduce((s,r)=>s+(r.price_neurons||0),0);
  const packSalesCount   = (packSales||[]).length;
  const totalNeurons     = (neuronsData||[]).reduce((s,r)=>s+(r.neurons||0),0);
  const avgNeurons       = neuronsData?.length ? Math.round(totalNeurons/(neuronsData.length)) : 0;

  // ── Correct D1 retention ─────────────────────────────────
  // Yesterday's signups who played today
  const yesterdaySignupIds = new Set((d1Cohort||[]).map(r=>r.id));
  const todayActiveIds     = new Set((d7Cohort||[]).map(r=>r.user_id).filter(Boolean));
  const d1Returned = [...yesterdaySignupIds].filter(id => todayActiveIds.has(id)).length;
  const d1Base     = yesterdaySignupIds.size;
  const MIN_D1_SAMPLE = 5; // don't show % if data is too sparse
  const d1RetVal = d1Base >= MIN_D1_SAMPLE
    ? Math.round((d1Returned / d1Base) * 100) + '%'
    : d1Base === 0 ? '—' : `${d1Returned}/${d1Base} (мало данных)`;
  const d1Color = d1Base < MIN_D1_SAMPLE
    ? 'var(--muted)'
    : d1Returned / d1Base >= 0.2 ? 'var(--green)' : 'var(--red)';

  const kpis = [
    {val: totalUsers||0,        lbl: '👥 Всего пользователей', color:''},
    {val: (newUsersToday||[]).length, lbl: '🆕 Новых сегодня',  color:'var(--green)'},
    {val: dau||0,               lbl: '📅 DAU (игр сегодня)',   color:'var(--accent2)'},
    {val: wau||0,               lbl: '📆 WAU (7 дней)',        color:'var(--accent2)'},
    {val: d1RetVal,             lbl: `📈 D1 Retention (n=${d1Base})`, color: d1Color},
    {val: totalGames||0,        lbl: '🎮 Игр сыграно',         color:''},
    {val: totalAnswers||0,      lbl: '✅ Ответов дано',         color:''},
    {val: evCounts.duel_completed||0, lbl:'⚔️ Дуэлей завершено', color:''},
    {val: evCounts.referral_signed_up||0, lbl:'🔗 Рефералов',   color:'var(--gold)'},
    {val: evCounts.referral_activated||0, lbl:'🎁 Активировано',color:'var(--gold)'},
    {val: packSalesCount,       lbl: '📦 Паков куплено (30д)', color:'var(--accent2)'},
    {val: totalPackRevenue+' ⚡', lbl:'💰 Выручка нейроны',   color:'var(--gold)'},
    {val: Math.round(totalNeurons/1000)+'k ⚡', lbl:'⚡ Всего нейронов', color:''},
    {val: avgNeurons+' ⚡',     lbl: '📊 Средний баланс',      color:''},
    {val: (evCounts.bot_battle_started||0) + (evCounts.bot_battle_auto||0), lbl:'🤖 Бот-дуэлей', color:''},
  ];

  kpiEl.innerHTML = kpis.map(k=>
    `<div class="admin-kpi">
      <div class="admin-kpi-val" style="${k.color?'color:'+k.color:''}">${k.val}</div>
      <div class="admin-kpi-lbl">${k.lbl}</div>
    </div>`
  ).join('');

  // ── Event funnel ──────────────────────────────────────
  const funnelEvents = [
    'app_opened','auth_screen_viewed','guest_started',
    'signup_started','signup_completed',
    'quiz_started','quiz_completed','result_viewed',
    'share_screen_viewed','share_to_telegram_clicked','share_to_whatsapp_clicked','copy_share_clicked',
    'team_created','team_joined','invite_clicked',
    'referral_link_copied','referral_clicked','referral_signed_up','referral_activated',
    'duel_created','duel_joined','duel_completed',
    'daily_started','daily_completed','city_added'
  ];
  const {data: allEvents} = await sb.from('analytics_events')
    .select('event_name').limit(10000);
  const allCounts = {};
  (allEvents||[]).forEach(e=>{ allCounts[e.event_name]=(allCounts[e.event_name]||0)+1; });
  const sortedFunnel = funnelEvents.filter(e=>allCounts[e]).sort((a,b)=>allCounts[b]-allCounts[a]);
  evEl.innerHTML = sortedFunnel.length ? sortedFunnel.map(name=>
    `<div class="admin-event-row">
      <span class="admin-event-name">${name}</span>
      <span class="admin-event-count">${allCounts[name]||0}</span>
    </div>`
  ).join('') : '<div style="color:var(--muted);font-size:12px">No events yet</div>';

  // ── Media question stats ──────────────────────────────
  const mediaEl = document.getElementById('admin-media-q');
  if(mediaEl){
    // Count from DB questions table
    const {data: qRows} = await sb.from('questions').select('media_type,status').limit(1000);
    const {data: localMediaQ} = {data: null}; // placeholder
    const published = (qRows||[]).filter(q=>q.status==='published');
    const imgs   = published.filter(q=>q.media_type==='image').length;
    const audios = published.filter(q=>q.media_type==='audio').length;
    const videos = published.filter(q=>q.media_type==='video').length;
    const noMedia = published.filter(q=>!q.media_type).length;
    const total  = published.length;
    // Also count local ALL_Q
    const localImgs   = ALL_Q.filter(q=>q.img).length;
    const localAudios = ALL_Q.filter(q=>q.audio).length;
    const localVideos = ALL_Q.filter(q=>q.video).length;
    mediaEl.innerHTML = `
      <div class="admin-event-row"><span class="admin-event-name">🖼 Image (DB)</span><span class="admin-event-count">${imgs}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">🎵 Audio (DB)</span><span class="admin-event-count">${audios}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">🎬 Video (DB)</span><span class="admin-event-count">${videos}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">📝 Text only (DB)</span><span class="admin-event-count">${noMedia}</span></div>
      <div class="admin-event-row" style="border-top:0.5px solid var(--border);margin-top:4px;padding-top:4px">
        <span class="admin-event-name">🖼 Image (local)</span><span class="admin-event-count">${localImgs}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">🎵 Audio (local)</span><span class="admin-event-count">${localAudios}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">🎬 Video (local)</span><span class="admin-event-count">${localVideos}</span></div>
      <div class="admin-event-row"><span class="admin-event-name">📦 Total DB published</span><span class="admin-event-count">${total}</span></div>
    `;
  }
  const {data: qaData} = await sb.from('game_answers')
    .select('question_key,category,is_correct')
    .not('question_key','is',null)
    .limit(5000);

  if(qaData && qaData.length){
    // Aggregate
    const qStats = {};
    qaData.forEach(a=>{
      const k = a.question_key;
      if(!qStats[k]) qStats[k]={key:k,cat:a.category||'',total:0,correct:0};
      qStats[k].total++;
      if(a.is_correct) qStats[k].correct++;
    });
    const statsArr = Object.values(qStats).filter(s=>s.total>=2);

    // Stats now go into admin-events if it exists
    const evEl2 = document.getElementById('admin-events');
    if(evEl2 && statsArr.length){
      const top5 = [...statsArr].sort((a,b)=>b.total-a.total).slice(0,5);
      evEl2.innerHTML += '<div style="font-size:11px;font-weight:800;color:var(--muted);margin:8px 0 4px">ТОП ВОПРОСОВ</div>' +
        top5.map((s,i)=>{
          const pct = Math.round(s.correct/s.total*100);
          const color = pct>=60?'var(--green)':pct>=40?'var(--gold)':'var(--red)';
          return `<div class="admin-event-row"><span class="admin-event-name">${i+1}. ${s.key.slice(0,40)}</span><span style="color:${color};font-weight:700">${pct}%</span></div>`;
        }).join('');
    }
  }
}

function renderProfileBadges(){
  const grid = document.getElementById('profile-badges-grid');
  if(!grid) return;
  grid.innerHTML = BADGE_DEFS.map(b=>{
    const earned = earnedBadges.has(b.key);
    const name = b.name?.ru || b.name?.en || b.key;
    const desc = b.desc?.ru || '';
    const cond = b.cond?.ru || '';
    return `<div class="badge ${earned?'earned':''}" title="${earned?'Получено!':cond}" style="min-width:80px;max-width:100px">
      <div class="badge-icon">${b.icon}</div>
      <div class="badge-name">${name}</div>
      ${desc?`<div style="font-size:9px;color:var(--muted);margin-top:2px;line-height:1.3;text-align:center">${earned?'✓ Получено':cond}</div>`:''}
    </div>`;
  }).join('');
}

// ─── Universal media extractor ───────────────────────────────────
function getQuestionMedia(q){
  if(q.media && q.media.type && q.media.type!=='none') return q.media;
  if(q.media && q.media.type==='none' && (q.media.url||q.media.filename||q.media.placeholder)) return q.media;
  if(q.video) return {type:'video',url:q.video,filename:'',placeholder:''};
  if(q.audio) return {type:'audio',url:q.audio,filename:'',placeholder:''};
  if(q.img)   return {type:'image',url:q.img,  filename:'',placeholder:''};
  if(q._mediaType && q._mediaType!=='none') return {
    type:        q._mediaType,
    url:         q._mediaUrl||q.image_url||q.audio_url||q.video_url||'',
    filename:    q.media_filename||q._mediaFilename||'',
    placeholder: q.media_placeholder||q._mediaPlaceholder||'',
  };
  return {type:'none',url:'',filename:'',placeholder:''};
}

let currentAudio = null;
let currentVideo = null;

function stopMedia(){
  try{
    if(currentAudio){
      currentAudio.pause();
      currentAudio.currentTime=0;
    }
  }catch(e){}
  currentAudio=null;
  try{
    if(currentVideo){
      currentVideo.pause();
      currentVideo.currentTime=0;
    }
  }catch(e){}
  currentVideo=null;
}

// Keep stopAudio as alias for compatibility
function stopAudio(){ stopMedia(); }

function renderQMedia(containerId, q){
  const container = document.getElementById(containerId);
  if(!container) return;
  stopMedia();
  container.innerHTML = '';

  // Support new media object format alongside legacy img/audio/video fields
  const mediaType = (q.media && q.media.type) || (q.img ? 'image' : q.audio ? 'audio' : q.video ? 'video' : 'none');
  const mediaUrl  = (q.media && q.media.url)  || q.img || q.audio || q.video || '';
  const mediaPlaceholder = (q.media && q.media.placeholder) || '';

  // Merge back to legacy fields for the rest of the function
  if(!q.img && mediaType==='image' && mediaUrl)  q = Object.assign({},q,{img:mediaUrl});
  if(!q.audio && mediaType==='audio' && mediaUrl) q = Object.assign({},q,{audio:mediaUrl});
  if(!q.video && mediaType==='video' && mediaUrl) q = Object.assign({},q,{video:mediaUrl});

  // Show placeholder if media type set but no URL
  // In regular game mode: HIDE placeholder silently. Only in tester/admin: show warning.
  if(mediaType !== 'none' && !mediaUrl){
    const isAdminContainer = containerId.startsWith('tester') || containerId === 'aq-media';
    if(isAdminContainer && mediaPlaceholder){
      const mtIcon = mediaType==='image'?'🖼':mediaType==='audio'?'🎵':'🎬';
      container.innerHTML = '<div class="q-media" style="padding:14px;text-align:center">'
        +'<div style="font-size:28px;margin-bottom:6px">'+mtIcon+'</div>'
        +'<div style="font-size:12px;color:var(--red)">⚠️ У вопроса заявлено медиа, но файл не загружен:<br>'+mediaPlaceholder+'</div>'
        +'</div>';
    }
    // All other containers (quiz, duel, tournament, ot): skip silently
    return;
  }

  if(q.img){
    const hint = '';
    if(q.img.startsWith('http') || q.img.startsWith('data:')){
      const audioHtml = q.audio ? (() => {
        const bid2 = 'audio-btn-img-'+containerId, pid2 = 'audio-prog-img-'+containerId;
        setTimeout(()=>{
          currentAudio = new Audio(q.audio);
          currentAudio.ontimeupdate = ()=>{ const p=document.getElementById(pid2); if(p&&currentAudio.duration) p.style.width=(currentAudio.currentTime/currentAudio.duration*100)+'%'; };
          currentAudio.onended = ()=>{ const b=document.getElementById(bid2); if(b) b.textContent='▶️'; };
        }, 0);
        return `<div style="display:flex;align-items:center;gap:10px;margin-top:8px;padding:8px 12px;background:var(--bg3);border-radius:10px">
          <button id="${bid2}" onclick="toggleAudio('${containerId}')" style="width:40px;height:40px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:18px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">▶️</button>
          <div style="flex:1"><div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden"><div id="${pid2}" style="height:100%;width:0%;background:var(--accent2);border-radius:2px;transition:width .1s linear"></div></div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">Нажми ▶️ и слушай</div></div></div>`;
      })() : '';
      container.innerHTML = `<div class="q-media">
        <img src="${q.img}" alt="" style="width:100%;max-height:55vh;object-fit:contain;display:block;border-radius:8px;background:#0a0a1a" onerror="this.parentElement.innerHTML='<div style=\'padding:16px;text-align:center;color:var(--muted);font-size:12px\'>🖼 Изображение недоступно</div>'">
        ${q.video ? `<video src="${q.video}" controls style="width:100%;border-radius:8px;margin-top:8px" playsinline></video>` : ''}
        ${audioHtml}
        <div class="q-media-hint">${hint}</div>
      </div>`;
    } else {
      // Placeholder URL — hide in regular game, show warning only in tester/admin
      const isAdminContainer = containerId.startsWith('tester') || containerId === 'aq-media';
      if(isAdminContainer){
        container.innerHTML = `<div class="q-media" style="padding:16px;text-align:center">
        <div style="font-size:32px;margin-bottom:6px">🖼</div>
        <div style="font-size:12px;color:var(--red)">⚠️ У вопроса заявлено медиа, но файл не загружен: ${q.img}</div>
      </div>`;
      }
      // In regular game (quiz, duel, tournament, ot): skip silently
    }

  } else if(q.audio){
    const hint = lang==='ru'?'Нажми ▶️ и слушай':'Press ▶️ and listen';
    const bid = 'audio-btn-'+containerId;
    const pid = 'audio-prog-'+containerId;
    container.innerHTML = `<div class="q-media" style="padding:14px">
      <div style="display:flex;align-items:center;gap:12px">
        <button id="${bid}" onclick="toggleAudio('${containerId}')"
          style="width:44px;height:44px;border-radius:50%;border:none;background:var(--accent);color:#fff;font-size:20px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center">▶️</button>
        <div style="flex:1">
          <div style="height:4px;background:rgba(255,255,255,.1);border-radius:2px;overflow:hidden;margin-bottom:4px">
            <div id="${pid}" style="height:100%;width:0%;background:var(--accent2);border-radius:2px;transition:width .1s linear"></div>
          </div>
          <div style="font-size:11px;color:var(--muted)">${hint}</div>
        </div>
      </div>
    </div>`;
    currentAudio = new Audio(q.audio);
    currentAudio.ontimeupdate = ()=>{
      const prog = document.getElementById(pid);
      if(prog && currentAudio.duration)
        prog.style.width = (currentAudio.currentTime/currentAudio.duration*100)+'%';
    };
    currentAudio.onended = ()=>{
      const btn = document.getElementById(bid);
      if(btn) btn.textContent='▶️';
      const prog = document.getElementById(pid);
      if(prog) prog.style.width='100%';
    };

  } else if(q.video){
    const hint = '';
    const vid = 'vid-'+containerId;
    container.innerHTML = `<div class="q-media">
      <video id="${vid}" src="${q.video}" controls playsinline preload="metadata"
        style="width:100%;max-height:240px;display:block;background:#000;border-radius:0">
      </video>
      <div class="q-media-hint">${hint}</div>
    </div>`;
    currentVideo = document.getElementById(vid);
  }
}

function toggleAudio(containerId){
  if(!currentAudio) return;
  const btn = document.getElementById('audio-btn-'+containerId);
  if(currentAudio.paused){
    currentAudio.play();
    if(btn) btn.textContent='⏸️';
  } else {
    currentAudio.pause();
    if(btn) btn.textContent='▶️';
  }
}


// ═══════════════════════════════════════════
// GAME & ANSWER TRACKING
// ═══════════════════════════════════════════
async function createGameRow(mode){
  if(!currentUser) return;
  try{
    const {data} = await sb.from('games').insert({
      user_id: currentUser.id, mode, score:0,
      correct_count:0, total_count:0,
      created_at: new Date().toISOString()
    }).select('id').single();
    if(data) _gameId = data.id;
  }catch(e){}
}

function saveAnswerRow(selectedIdx, q, pts, isCorrect, responseMs, isTimeout){
  if(!_gameId) return;
  const qKey = (q._id||q.q?.en||q.q||'').slice(0,100);
  sb.from('game_answers').insert({
    game_id: _gameId,
    user_id: currentUser?.id||null,
    question_key: qKey,
    question_id: q._id||null,
    category: q.cat||null,
    selected_index: selectedIdx,
    correct_index: q.c,
    is_correct: isCorrect,
    is_timeout: isTimeout||false,
    response_time_ms: responseMs,
    points: isCorrect ? pts : 0,
    answer_count: Array.isArray(q.a) ? q.a.length : (Array.isArray(q.a?.en) ? q.a.en.length : 4),
    created_at: new Date().toISOString()
  }).then(()=>{}).catch(()=>{});
}

async function completeGameRow(correct, total){
  if(!_gameId) return;
  const dur = _gameStartTime ? Math.round((Date.now()-_gameStartTime)/1000) : null;
  try{
    await sb.from('games').update({
      score: _roundScore, correct_count: correct,
      total_count: total, best_streak: bestStreak, duration_sec: dur
    }).eq('id',_gameId);
    // DO NOT call addSeasonPoints here — called once in showScore()
  }catch(e){}
}

// ═══════════════════════════════════════════
// WEEKLY SEASONS
// ═══════════════════════════════════════════
function getSeasonKey(){
  const now = new Date();
  const day = now.getDay(); // 0=Sun,1=Mon...
  const diff = now.getDate() - day + (day===0?-6:1); // Monday
  const monday = new Date(now.setDate(diff));
  return 'season_'+monday.toISOString().slice(0,10);
}

function getSeasonPoints(){
  const key = getSeasonKey();
  const data = JSON.parse(localStorage.getItem('mfc_season')||'{}');
  if(data.key !== key) return {key, points:0, rank:null};
  return data;
}

function addSeasonPoints(pts){
  if(!pts||pts<=0) return;
  // Update local season cache
  const season = getSeasonPoints();
  season.points = (season.points||0) + pts;
  localStorage.setItem('mfc_season', JSON.stringify(season));
  // Persist to DB via RPC (atomic increment)
  if(currentUser){
    const city = localStorage.getItem('mfc_city')||null;
    const teamId = myTeam?.id||null;
    sb.rpc('upsert_season_score', {
      p_user_id: currentUser.id,
      p_season_key: season.key,
      p_points: pts,
      p_city: city,
      p_team_id: teamId
    }).then(()=>{}).catch(()=>{});
  }
}

async function loadWeeklyLeaderboard(){
  // Reads from season_scores, not leaderboard_snapshots
  const key = getSeasonKey();
  const {data} = await sb.from('season_scores')
    .select('user_id,points,city')
    .eq('season_key', key)
    .order('points',{ascending:false})
    .limit(20);
  return data||[];
}

// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// OFFICIAL TOURNAMENTS
// ═══════════════════════════════════════════
let otData = null;
let otJoined = false;
let otQs = [];
let otQIdx = 0;
let otScore = 0;
let otCorrect = 0;
let otTimerInt = null;
let otTimeLeft = 0;
let otAnswered = false;
let otRoundScore = 0;
let otPollInt = null;
let otDisqualified = false; // Fix 4: prevent score override after disq

function randOTCode(){
  return 'OT'+Math.random().toString(36).slice(2,7).toUpperCase();
}

async function openOfficialTournament(code, accessCode){
  // accessCode can come from URL param ?ac=... or be passed directly
  const ac = accessCode || new URLSearchParams(window.location.search).get('ac') || null;

  // Fetch tournament to check if private
  const {data:t} = await sb.from('official_tournaments')
    .select('is_private,access_code,title,org_name').eq('code',code).maybeSingle();

  if(t?.is_private && t.access_code) {
    if(!ac || ac.toUpperCase() !== t.access_code.toUpperCase()) {
      // Prompt for access code
      _promptPrivateAccess(code, t);
      return;
    }
  }

  showScreen('official-tournament');
  document.getElementById('n-ot').textContent = neurons;
  await loadOfficialTournament(code);
}

function _promptPrivateAccess(code, t){
  let modal = document.getElementById('private-access-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'private-access-modal';
    modal.style.cssText='position:fixed;inset:0;z-index:9996;background:rgba(10,10,20,.9);display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(modal);
  }
  modal.innerHTML=`<div style="background:var(--bg2);border-radius:20px;padding:24px;width:100%;max-width:340px;text-align:center">
    <div style="font-size:32px;margin-bottom:8px">🔒</div>
    <div style="font-size:17px;font-weight:900;margin-bottom:4px">${t.title||'Приватный турнир'}</div>
    ${t.org_name?`<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${t.org_name}</div>`:'<div style="margin-bottom:12px"></div>'}
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Введите код доступа, который дал организатор</div>
    <input id="private-ac-input" maxlength="8" placeholder="XXXXXX"
      style="width:100%;text-align:center;font-size:24px;font-weight:900;letter-spacing:4px;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:12px"
      oninput="this.value=this.value.toUpperCase()" />
    <div id="private-ac-err" style="font-size:12px;color:var(--red);margin-bottom:10px;min-height:16px"></div>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('private-access-modal').remove()" style="flex:1;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
      <button onclick="_submitPrivateAccess('${code}')" style="flex:1;background:var(--accent);border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">Войти →</button>
    </div>
  </div>`;
  modal.style.display='flex';
  setTimeout(()=>document.getElementById('private-ac-input')?.focus(),100);
}

async function _submitPrivateAccess(code){
  const entered = (document.getElementById('private-ac-input')?.value||'').trim().toUpperCase();
  if(!entered){ document.getElementById('private-ac-err').textContent='Введите код'; return; }
  const {data:t} = await sb.from('official_tournaments')
    .select('access_code').eq('code',code).maybeSingle();
  if(!t || entered !== (t.access_code||'').toUpperCase()){
    document.getElementById('private-ac-err').textContent='Неверный код. Попробуй ещё раз.';
    return;
  }
  document.getElementById('private-access-modal')?.remove();
  showScreen('official-tournament');
  document.getElementById('n-ot').textContent = neurons;
  await loadOfficialTournament(code);
}

async function loadOfficialTournament(code){
  document.getElementById('ot-lobby-section').style.display='block';
  document.getElementById('ot-play-section').style.display='none';
  document.getElementById('ot-finish-section').style.display='none';

  const {data, error} = await sb.from('official_tournaments')
    .select('*').eq('code', code).single();
  if(error || !data){ toast('Tournament not found'); return; }
  otData = data;

  const badge = document.getElementById('ot-status-badge');
  badge.textContent = data.status.toUpperCase();
  badge.className = '';
  badge.style.cssText = 'display:inline-block;border-radius:20px;padding:4px 14px;font-size:11px;font-weight:800;letter-spacing:1px;margin-bottom:12px';
  if(data.status==='live') badge.classList.add('ot-status-live');
  else if(data.status==='finished') badge.classList.add('ot-status-finished');
  else { badge.style.background='rgba(108,99,255,.2)'; badge.style.border='0.5px solid var(--accent)'; badge.style.color='var(--accent2)'; }

  document.getElementById('ot-title').textContent = data.title||'Официальный турнир';
  document.getElementById('ot-desc').textContent = data.description||'';

  // Show prize pool banner if entry fee > 0
  let prizeEl = document.getElementById('ot-prize-banner');
  if (!prizeEl) {
    prizeEl = document.createElement('div');
    prizeEl.id = 'ot-prize-banner';
    document.getElementById('ot-title')?.insertAdjacentElement('afterend', prizeEl);
  }
  if (data.entry_fee > 0) {
    prizeEl.style.cssText = 'background:rgba(255,193,7,.12);border:1px solid rgba(255,193,7,.35);border-radius:12px;padding:10px 14px;margin:8px 0;text-align:center';
    prizeEl.innerHTML = `<span style="font-size:13px;font-weight:800;color:#fbbf24">🏆 Призовой фонд: ${data.prize_pool} ⚡</span><span style="font-size:11px;color:var(--muted);margin-left:8px">Взнос: ${data.entry_fee} ⚡</span>`;
  } else {
    prizeEl.style.display = 'none';
  }

  await refreshOTPlayers();

  if(data.status === 'finished'){
    showOTFinished();
    return;
  }
  if(data.status === 'live'){
    if(!otJoined) {
      // Auto-join for guests or unjoined users when tournament is already live
      await joinOfficialTournament();
    }
    startOTGameplay();
    return;
  }

  // Poll for status changes
  clearInterval(otPollInt);
  otPollInt = setInterval(async ()=>{
    const {data:fresh} = await sb.from('official_tournaments').select('status').eq('code', code).single();
    if(fresh?.status === 'live' && otJoined){ clearInterval(otPollInt); startOTGameplay(); }
    if(fresh?.status === 'finished'){ clearInterval(otPollInt); showOTFinished(); }
    refreshOTPlayers();
  }, 3000);
}

async function refreshOTPlayers(){
  if(!otData) return;
  const {data: players} = await sb.from('official_tournament_players')
    .select('user_id,display_name,score,finished_at,disqualified')
    .eq('tournament_id', otData.id)
    .order('score', {ascending:false});

  const list = players||[];
  document.getElementById('ot-players-count').textContent = list.length + (list.length===1?' player joined':' players joined');

  const listEl = document.getElementById('ot-players-list');
  if(!list.length){
    listEl.innerHTML = '<div style="padding:14px;text-align:center;color:var(--muted);font-size:13px">No players yet</div>';
    return;
  }
  const medals=['🥇','🥈','🥉'];
  listEl.innerHTML = list.map((p,i)=>`
    <div class="ot-player-row">
      <div class="lb-rank">${medals[i]||i+1}</div>
      <div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">${(p.display_name||'?')[0].toUpperCase()}</div>
      <div class="lb-name">${p.display_name||'Игрок'}${p.finished_at?'<span style="margin-left:6px;font-size:10px;color:var(--green)">✓</span>':''}</div>
      ${otData.status!=='lobby'?`<div class="lb-score">${p.score}</div>`:''}
    </div>`).join('');

  const joinBtn = document.getElementById('ot-join-btn');
  const joinedMsg = document.getElementById('ot-joined-msg');
  if(currentUser){
    otJoined = list.some(p => p.user_id === currentUser.id);
    if(otJoined){ if(joinBtn)joinBtn.style.display='none'; if(joinedMsg)joinedMsg.style.display='block'; }
    else { if(joinBtn)joinBtn.style.display=''; if(joinedMsg)joinedMsg.style.display='none'; }
  } else if(otJoined) {
    // Guest already pressed join — keep the joined state visible
    if(joinBtn)joinBtn.style.display='none';
    if(joinedMsg)joinedMsg.style.display='block';
  }
}

async function joinOfficialTournament(){
  if(!otData){ return; }
  if(otData.status==='finished'){ toast('Tournament is finished'); return; }

  if(currentUser) {
    // Pay entry fee if tournament has one
    if (otData.entry_fee > 0) {
      const { data: feeRes } = await sb.rpc('pay_tournament_entry', { p_tournament_id: otData.id });
      if (!feeRes?.ok && !feeRes?.already_paid) {
        const reason = feeRes?.reason;
        if (reason === 'not_enough') {
          toast(`Недостаточно нейронов (нужно ${feeRes.need} ⚡, есть ${feeRes.have} ⚡)`);
        } else {
          toast('Ошибка оплаты: ' + (reason || 'unknown'));
        }
        return;
      }
      if (!feeRes?.already_paid) {
        toast(`💰 Взнос ${otData.entry_fee} ⚡ в призовой фонд!`);
        if (typeof window.updNeurons === 'function') window.updNeurons();
      }
    }

    const name = currentUser.user_metadata?.full_name?.split(' ')[0]||currentUser.email?.split('@')[0]||'Игрок';
    const {error} = await sb.from('official_tournament_players').insert({
      tournament_id: otData.id,
      user_id: currentUser.id,
      display_name: name,
      score: 0, correct_count: 0, total_count: 0,
      joined_at: new Date().toISOString()
    });
    if(error && !error.message.includes('duplicate')){ toast('Error joining: '+error.message); return; }
    track('official_tournament_joined', {code: otData.code});
  }

  otJoined = true;
  document.getElementById('ot-join-btn').style.display='none';
  document.getElementById('ot-joined-msg').style.display='block';
  if(!currentUser){
    toast('✅ '+(lang==='ru'?'Начинаем! Войди после игры чтобы сохранить результат.':'Starting! Sign in after to save results.'));
  } else {
    toast('✅ '+(lang==='ru'?'Вы в турнире! Ожидайте старта.':'Joined! Waiting for start...'));
  }
  refreshOTPlayers();
}

async function startOTGameplay(){
  if(!otData) return;
  clearInterval(otPollInt);
  // No integrity check for live tournaments — switching screens is normal
  document.getElementById('ot-lobby-section').style.display='none';
  document.getElementById('ot-play-section').style.display='block';

  // Load questions for this tournament
  const {data: tqs} = await sb.from('official_tournament_questions')
    .select('position, question_id, questions(*)')
    .eq('tournament_id', otData.id)
    .order('position');

  if(!tqs || !tqs.length){ toast('No questions in tournament'); return; }

  otQs = tqs.map(tq=>{
    const q = tq.questions;
    if(!q) return null;
    const lang_q = lang==='ru' ? (q.question_ru||q.question_en) : (q.question_en||q.question_ru);
    const lang_a = lang==='ru' ? (q.answers_ru||q.answers_en) : (q.answers_en||q.answers_ru);
    return {
      _id: q.id,
      cat: q.category,
      q: lang_q,
      a: Array.isArray(lang_a) ? lang_a : [],
      c: q.correct_index,
      t: 20,
      slide_img:    q.image_url||null,
      img:          q.media_type==='image' ? (q.image_url||null) : null,
      audio:        q.media_type==='audio' ? q.audio_url : null,
      video:        q.media_type==='video' ? q.video_url : null,
      answer_img:   q.answer_image_url||null,
      answer_video: q.answer_video_url||null,
      explanation_ru: q.explanation_ru||null,
    };
  }).filter(Boolean);

  otQIdx=0; otScore=0; otCorrect=0; otRoundScore=0; otDisqualified=false;
  window._otFinished = false;

  // Show org slides before starting if tournament has them
  const orgSlides = otData.org_slides_json;
  if (orgSlides && orgSlides.length) {
    _showOrgSlidesSequence(orgSlides, 0, () => otLoadQ());
  } else {
    otLoadQ();
  }
}

function _showOrgSlidesSequence(slides, idx, onDone) {
  if (idx >= slides.length) { onDone(); return; }
  const slide = slides[idx];
  if (slide.before_q !== 1 && (otQIdx + 1) !== slide.before_q) {
    _showOrgSlidesSequence(slides, idx + 1, onDone);
    return;
  }
  _showOrgSlideOverlay(slide.url, slide.duration || 10000, () => {
    _showOrgSlidesSequence(slides, idx + 1, onDone);
  });
}

let _orgSlideTimer = null;
function _showOrgSlideOverlay(url, duration, onDone) {
  clearTimeout(_orgSlideTimer);
  stopMedia();

  // Reuse the exact same question UI — same layout as question slides
  const qMedia = document.getElementById('ot-q-media');
  const answersEl = document.getElementById('ot-answers');
  const timerBar = document.getElementById('ot-timer-bar');
  const qtextEl = document.getElementById('ot-q-text');
  const catPill = document.getElementById('ot-cat-pill');
  const counter = document.getElementById('ot-counter');
  const nextBtn = document.getElementById('ot-next-btn');
  const fb = document.getElementById('ot-fb');
  const ansMedia = document.getElementById('ot-answer-media');

  // Hide question-specific UI
  if (qtextEl) qtextEl.style.display = 'none';
  if (catPill) catPill.style.display = 'none';
  if (counter) counter.style.display = 'none';
  if (timerBar) { timerBar.parentElement.style.display = 'none'; }
  if (fb) fb.className = 'fb';
  if (ansMedia) { ansMedia.style.display = 'none'; ansMedia.innerHTML = ''; }
  if (nextBtn) nextBtn.className = 'next-btn';

  // Show slide in same media container
  if (qMedia) qMedia.innerHTML = `<img src="${url}" alt="" style="width:100%;border-radius:12px;display:block">`;

  // Replace answers with progress bar + "Далее" button
  if (answersEl) {
    answersEl.innerHTML = `
      <div style="margin-bottom:10px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden">
        <div id="ot-org-bar" style="height:4px;background:var(--accent);border-radius:2px;width:100%;transition:width ${duration}ms linear"></div>
      </div>
      <button id="ot-org-next-btn" onclick="window._orgSlideNext()" style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:16px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">Далее →</button>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const bar = document.getElementById('ot-org-bar');
      if (bar) bar.style.width = '0%';
    }));
  }

  const finish = () => {
    clearTimeout(_orgSlideTimer);
    // Restore UI visibility
    if (catPill) catPill.style.display = '';
    if (counter) counter.style.display = '';
    if (timerBar) timerBar.parentElement.style.display = '';
    onDone();
  };

  window._orgSlideNext = finish;
  _orgSlideTimer = setTimeout(finish, duration);
}

function otLoadQ(){
  const q = otQs[otQIdx];
  if(!q){ otFinish(); return; }

  // Check if there's an org slide to show before this question
  const orgSlides = otData?.org_slides_json;
  if (orgSlides && otQIdx > 0) {
    const slide = orgSlides.find(s => s.before_q === otQIdx + 1);
    if (slide) {
      _showOrgSlideOverlay(slide.url, slide.duration || 10000, () => _doLoadQ(q));
      return;
    }
  }
  _doLoadQ(q);
}

function _doLoadQ(q){
  otAnswered = false;
  clearInterval(otTimerInt);

  document.getElementById('ot-cat-pill').textContent = q.cat||'';
  document.getElementById('ot-counter').textContent = (otQIdx+1)+'/'+otQs.length;
  // Hide text when slide image carries the question
  const qtextEl = document.getElementById('ot-q-text');
  if (q.slide_img) {
    qtextEl.style.display = 'none';
  } else {
    qtextEl.style.display = '';
    qtextEl.textContent = q.q;
  }
  document.getElementById('ot-fb').className = 'fb';
  const nextBtn = document.getElementById('ot-next-btn');
  nextBtn.className = 'next-btn';
  nextBtn.textContent = lang==='ru' ? 'Далее →' : 'Next →';
  nextBtn.style.pointerEvents = '';
  nextBtn.style.opacity = '';
  const ansMedia = document.getElementById('ot-answer-media');
  if (ansMedia) { ansMedia.style.display = 'none'; ansMedia.innerHTML = ''; }

  // Always show slide image first, then add audio/video below if present
  const qMedia = document.getElementById('ot-q-media');
  if (q.slide_img) {
    qMedia.innerHTML = `<img src="${q.slide_img}" alt="" style="width:100%;border-radius:12px;display:block">`;
    if (q.audio) {
      qMedia.insertAdjacentHTML('beforeend',
        `<audio src="${q.audio}" controls autoplay style="width:100%;margin-top:8px"></audio>`);
    } else if (q.video) {
      qMedia.insertAdjacentHTML('beforeend',
        `<video src="${q.video}" controls autoplay style="width:100%;border-radius:8px;margin-top:8px"></video>`);
    }
  } else {
    renderQMedia('ot-q-media', q);
  }

  const answersEl = document.getElementById('ot-answers');
  answersEl.innerHTML = q.a.map((a,i)=>
    `<button class="ans" onclick="otPick(${i})">${answerLetter(i)}. ${a}</button>`
  ).join('');

  // Timer
  otTimeLeft = q.t;
  const bar = document.getElementById('ot-timer-bar');
  const secsEl = document.getElementById('ot-timer-secs');
  if(bar) bar.style.width='100%';
  if(secsEl) secsEl.textContent = otTimeLeft;
  otTimerInt = setInterval(()=>{
    otTimeLeft--;
    if(bar) bar.style.width=(otTimeLeft/q.t*100)+'%';
    if(secsEl) secsEl.textContent = otTimeLeft > 0 ? otTimeLeft : '';
    if(otTimeLeft<=0){ clearInterval(otTimerInt); otExpire(); }
  },1000);
}

function otPick(i){
  if(otAnswered || otDisqualified) return;
  otAnswered = true;
  const q = otQs[otQIdx];
  const isSync = !!otData?.sync_mode;

  // In sync mode keep timer running — auto-advance on expire
  if (!isSync) clearInterval(otTimerInt);

  document.querySelectorAll('#ot-answers .ans').forEach(b=>b.disabled=true);
  const pts = getFixedPoints(q.a.length);
  const correct = i===q.c;
  if(correct){ otScore+=pts; otCorrect++; otRoundScore+=pts; }
  if(isSync){
    // Hide all feedback until timer ends — don't reveal correctness
    const fb = document.getElementById('ot-fb');
    if (fb) { fb.textContent = ''; fb.className = 'fb'; }
  } else {
    if(correct){
      document.querySelectorAll('#ot-answers .ans')[i].className='ans correct';
      showFb('ot-fb','✓ +'+pts, true);
    } else {
      document.querySelectorAll('#ot-answers .ans')[i].className='ans wrong';
      document.querySelectorAll('#ot-answers .ans')[q.c].className='ans correct';
      showFb('ot-fb','✗ '+q.a[q.c], false);
    }
  }
  // Save answer
  sb.from('official_tournament_answers').insert({
    tournament_id: otData.id, user_id: currentUser?.id||null,
    question_id: q._id, question_key: q.q?.slice(0,100),
    selected_index: i, correct_index: q.c,
    is_correct: i===q.c, points: i===q.c?pts:0,
    created_at: new Date().toISOString()
  }).then(()=>{}).catch(()=>{});

  // In sync mode don't reveal answer slide until timer expires
  if (!isSync) _otShowAnswerMedia(q);

  if (isSync) {
    // Show waiting message instead of Next button
    const nb = document.getElementById('ot-next-btn');
    if (nb) {
      nb.className = 'next-btn show';
      nb.textContent = lang==='ru' ? '⏳ Ваш ответ принят, ждём всех...' : '⏳ Answer saved, waiting...';
      nb.style.pointerEvents = 'none';
      nb.style.opacity = '0.7';
    }
  } else {
    document.getElementById('ot-next-btn').className='next-btn show';
  }
}

function otExpire(){
  const isSync = !!otData?.sync_mode;
  const q = otQs[otQIdx];

  // Reveal correct answer for everyone (whether they answered or not)
  document.querySelectorAll('#ot-answers .ans').forEach((b,i)=>{ b.disabled=true; if(i===q.c)b.className='ans correct'; });
  if(!otAnswered){
    otAnswered = true;
    showFb('ot-fb','⏱ '+q.a[q.c], false);
  } else {
    // Show whether they were right
    const myBtn = document.getElementById('ot-answers')?.querySelectorAll('.ans');
    if(myBtn) showFb('ot-fb', q.a[q.c], true);
  }
  _otShowAnswerMedia(q);

  if (isSync) {
    const nb = document.getElementById('ot-next-btn');
    if(nb){ nb.className='next-btn show'; nb.textContent=lang==='ru'?'Далее →':'Next →'; nb.style.pointerEvents=''; nb.style.opacity=''; }
    // Auto-advance after 4s so everyone can see the answer
    setTimeout(() => { stopMedia(); otQIdx++; if(otQIdx>=otQs.length) otFinish(); else otLoadQ(); }, 4000);
  } else {
    document.getElementById('ot-next-btn').className='next-btn show';
  }
}

function _otShowAnswerMedia(q){
  const el = document.getElementById('ot-answer-media');
  if (!el) return;
  if (q.answer_video) {
    el.innerHTML = `<video src="${q.answer_video}" controls autoplay style="width:100%;max-height:280px;border-radius:14px"></video>`;
    el.style.display = 'block';
  } else if (q.answer_img) {
    el.innerHTML = `<img src="${q.answer_img}" alt="" style="width:100%;max-height:280px;object-fit:contain;background:#0a0a0f;border-radius:14px">`;
    el.style.display = 'block';
  }
}

function otNextQ(){
  if(otDisqualified) return;
  stopMedia();
  otQIdx++;
  if(otQIdx>=otQs.length) otFinish();
  else otLoadQ();
}

async function otFinish(){
  stopMedia();
  clearInterval(otTimerInt);
  window._otFinished = true;
  if(currentUser && otData){
    await sb.from('official_tournament_players').update({
      score: otDisqualified ? 0 : otScore,
      correct_count: otDisqualified ? 0 : otCorrect,
      total_count: otQs.length,
      finished_at: new Date().toISOString(),
      disqualified: otDisqualified
    }).eq('tournament_id', otData.id).eq('user_id', currentUser.id);
  } else if(!currentUser && otData) {
    // Save guest result so it can be claimed after login
    sessionStorage.setItem('_otGuestResult', JSON.stringify({
      tournament_id: otData.id,
      score: otDisqualified ? 0 : otScore,
      correct_count: otDisqualified ? 0 : otCorrect,
      total_count: otQs.length,
      disqualified: otDisqualified
    }));
  }
  track('official_tournament_completed', {code: otData?.code, score: otDisqualified ? 0 : otScore, disqualified: otDisqualified});
  showOTFinished();
}

async function showOTFinished(){
  // Close integrity overlay if open
  const overlay = document.getElementById('integrity-overlay');
  if(overlay) overlay.remove();

  document.getElementById('ot-lobby-section').style.display='none';
  document.getElementById('ot-play-section').style.display='none';
  document.getElementById('ot-finish-section').style.display='block';
  document.getElementById('ot-finish-title').textContent = lang==='ru'
    ? (otData?.title||'Турнир завершён!')
    : (otData?.title||'Tournament Complete!');

  // Fix 1+2: show DQ result if disqualified
  if(otDisqualified){
    document.getElementById('ot-my-result').innerHTML =
      '<span style="color:var(--red);font-weight:800">🚫 '+(lang==='ru'?'Дисквалификация — результат аннулирован':'Disqualified — result voided')+'</span>';
  } else {
    document.getElementById('ot-my-result').textContent = lang==='ru'
      ? `Ваш результат: ${otScore} очков · ${otCorrect}/${otQs.length} правильных`
      : `Your result: ${otScore} pts · ${otCorrect}/${otQs.length} correct`;
  }

  // Fix 1: include user_id and disqualified in select
  // Guest prompt — show after result
  const existingSavePrompt = document.getElementById('ot-guest-save-prompt');
  if(existingSavePrompt) existingSavePrompt.remove();
  if(!currentUser){
    const prompt = document.createElement('div');
    prompt.id = 'ot-guest-save-prompt';
    prompt.style.cssText = 'margin:12px 0;padding:14px 16px;background:rgba(108,99,255,.15);border:1px solid var(--accent);border-radius:14px;text-align:center';
    prompt.innerHTML = `<div style="font-size:14px;font-weight:700;margin-bottom:8px">${lang==='ru'?'Войдите чтобы сохранить результат':'Sign in to save your result'}</div>
      <button onclick="showScreen('auth')" style="background:var(--accent);border:none;border-radius:10px;padding:10px 24px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">${lang==='ru'?'Войти / Зарегистрироваться':'Sign in / Register'}</button>`;
    document.getElementById('ot-my-result').insertAdjacentElement('afterend', prompt);
  }

  const {data: players} = await sb.from('official_tournament_players')
    .select('user_id,display_name,score,correct_count,total_count,disqualified')
    .eq('tournament_id', otData?.id||'')
    .order('score',{ascending:false});

  const medals=['🥇','🥈','🥉'];
  const lb = document.getElementById('ot-leaderboard');
  lb.innerHTML = (players||[]).map((p,i)=>{
    const isMe = currentUser && p.user_id === currentUser.id;
    const dqMark = p.disqualified
      ? '<span style="margin-left:6px;font-size:10px;color:var(--red);font-weight:800">DQ</span>' : '';
    const score = p.disqualified ? '<span style="color:var(--red)">0 DQ</span>' : p.score;
    return `<div class="lb-row${isMe?' me':''}">
      <div class="lb-rank">${p.disqualified?'—':(medals[i]||i+1)}</div>
      <div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">${(p.display_name||'?')[0].toUpperCase()}</div>
      <div class="lb-name">${p.display_name}${dqMark} <span style="font-size:10px;color:var(--muted)">${p.correct_count||0}/${p.total_count||0}</span></div>
      <div class="lb-score${isMe?' me':''}">${score}</div>
    </div>`;
  }).join('') || '<div style="padding:14px;text-align:center;color:var(--muted)">No results yet</div>';
}

// Save guest tournament result after login
window._saveGuestTournamentResult = async function(code, result) {
  const name = currentUser?.user_metadata?.full_name?.split(' ')[0] || currentUser?.email?.split('@')[0] || 'Игрок';
  // Join first (upsert)
  await sb.from('official_tournament_players').upsert({
    tournament_id: result.tournament_id,
    user_id: currentUser.id,
    display_name: name,
    score: result.score,
    correct_count: result.correct_count,
    total_count: result.total_count,
    finished_at: new Date().toISOString(),
    disqualified: result.disqualified,
    joined_at: new Date().toISOString()
  }, { onConflict: 'tournament_id,user_id' });

  sessionStorage.removeItem('_otGuestResult');
  // Restore tournament finish screen with updated leaderboard
  const {data: t} = await sb.from('official_tournaments').select('*').eq('id', result.tournament_id).single();
  if (t) {
    otData = t;
    otScore = result.score;
    otCorrect = result.correct_count;
    otQs = { length: result.total_count };
    otDisqualified = result.disqualified;
    showScreen('official-tournament');
    showOTFinished();
  }
};

// ─── ADMIN: AI QUESTION GENERATION ───────────────────────
window._aiGeneratedQuestions = null;

window.adminGenerateAIQuestions = async function() {
  if (!isAdmin()) { toast('Admin only'); return; }
  const topic = document.getElementById('ai-topic-input')?.value.trim();
  if (!topic) { toast('Введи тему'); return; }
  const count = parseInt(document.getElementById('ai-count')?.value) || 10;
  const lang  = document.getElementById('ai-lang')?.value || 'ru';

  const btn      = document.getElementById('ai-gen-btn');
  const resultEl = document.getElementById('ai-gen-result');
  if (btn) { btn.textContent = '⏳ Генерирую...'; btn.disabled = true; }
  if (resultEl) resultEl.innerHTML = '';

  try {
    const { data, error } = await sb.functions.invoke('generate-questions', {
      body: { topic, count, lang },
    });
    if (error || !data?.ok) throw new Error(data?.reason || error?.message || 'Ошибка');

    window._aiGeneratedQuestions = data.questions;

    // Auto-fill tournament title if empty
    const titleInput = document.getElementById('ot-new-title');
    if (titleInput && !titleInput.value) titleInput.value = 'Квиз: ' + topic;

    if (resultEl) {
      resultEl.innerHTML =
        `<div style="color:#4ade80;font-weight:700;margin-bottom:6px">✅ Готово: ${data.count} вопросов</div>` +
        data.questions.slice(0, 3).map((q, i) =>
          `<div style="padding:5px 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:11px;line-height:1.4">${i+1}. ${q.q}</div>`
        ).join('') +
        (data.count > 3 ? `<div style="color:var(--muted);font-size:11px;margin-top:3px">...и ещё ${data.count-3} вопросов</div>` : '') +
        `<div style="margin-top:6px;font-size:11px;color:var(--accent2)">👆 Нажми «Создать турнир» чтобы запустить с этими вопросами</div>`;
    }
  } catch(e) {
    if (resultEl) resultEl.innerHTML = `<div style="color:var(--red)">❌ ${e.message}</div>`;
  } finally {
    if (btn) { btn.textContent = '✨ Сгенерировать вопросы'; btn.disabled = false; }
  }
};

// ─── ADMIN: CREATE OFFICIAL TOURNAMENT ───────────────────
async function adminCreateOfficialTournament(){
  if(!isAdmin()){ toast('Admin only'); return; }
  const title = document.getElementById('ot-new-title').value.trim();
  if(!title){ toast('Enter title'); return; }
  const desc    = (document.getElementById('ot-new-desc')||{}).value?.trim() || '';
  const orgName = (document.getElementById('ot-new-org')||{}).value?.trim() || null;
  const numQs   = parseInt(document.getElementById('ot-new-qs').value)||10;
  const cat     = document.getElementById('ot-new-cat').value;
  const isPrivate = document.getElementById('ot-new-private')?.checked || false;
  const entryFee  = Math.max(0, parseInt(document.getElementById('ot-new-fee')?.value || '0') || 0);
  const code = randOTCode();
  const accessCode = isPrivate ? Math.random().toString(36).slice(2,8).toUpperCase() : null;

  const btn = document.querySelector('[onclick="adminCreateOfficialTournament()"]');
  if(btn){ btn.textContent='Creating...'; btn.disabled=true; }

  // Create tournament
  const {data:ot, error:otErr} = await sb.from('official_tournaments').insert({
    code, title, description:desc, status:'lobby',
    is_private: isPrivate, access_code: accessCode, org_name: orgName,
    entry_fee: entryFee, prize_pool: 0,
    created_by: currentUser.id, created_at: new Date().toISOString()
  }).select().single();
  if(otErr){ toast('Ошибка: '+otErr.message); if(btn){btn.textContent='Create Tournament →';btn.disabled=false;} return; }

  // ── Use AI-generated questions if available ───────────────
  if (window._aiGeneratedQuestions?.length) {
    const aiQs = window._aiGeneratedQuestions.slice(0, numQs);
    window._aiGeneratedQuestions = null;
    if(document.getElementById('ai-gen-result')) document.getElementById('ai-gen-result').innerHTML='';
    if(document.getElementById('ai-topic-input')) document.getElementById('ai-topic-input').value='';
    // Store inline so the tournament gameplay can read them (same format as ALL_Q)
    window._officialTournamentLocalQs = aiQs;
    if(btn){btn.textContent='Create Tournament →';btn.disabled=false;}
    _finishCreateOT(ot, title, code, accessCode, isPrivate, orgName, numQs, cat, true);
    return;
  }

  // Pick questions from ALL_Q + local (fallback if no DB questions)
  let pool = cat==='ALL' ? ALL_Q : ALL_Q.filter(q=>(q.cat||'')===cat);
  pool = pool.sort(()=>Math.random()-.5).slice(0, numQs);

  // Try to get questions from DB
  let dbQs = [];
  const qFilter = cat==='ALL'
    ? sb.from('questions').select('id').eq('status','published').eq('source_type','official_general').limit(numQs*3)
    : sb.from('questions').select('id').eq('status','published').eq('source_type','official_general').eq('category',cat).limit(numQs*3);
  const {data:dbQRows} = await qFilter;
  if(dbQRows && dbQRows.length){
    dbQs = dbQRows.sort(()=>Math.random()-.5).slice(0,numQs);
    await sb.from('official_tournament_questions').insert(
      dbQs.map((q,i)=>({ tournament_id:ot.id, question_id:q.id, position:i+1 }))
    );
  } else {
    toast('⚠️ No DB questions found — using local questions for this tournament');
  }

  if(btn){btn.textContent='Create Tournament →';btn.disabled=false;}
  _finishCreateOT(ot, title, code, accessCode, isPrivate, orgName, numQs, cat, false);
}

function _finishCreateOT(ot, title, code, accessCode, isPrivate, orgName, numQs, cat, aiUsed){
  document.getElementById('ot-new-title').value='';
  if(document.getElementById('ot-new-org')) document.getElementById('ot-new-org').value='';
  if(document.getElementById('ot-new-private')) document.getElementById('ot-new-private').checked=false;

  const link = isPrivate
    ? location.origin+location.pathname+'?official='+code+'&ac='+accessCode
    : location.origin+location.pathname+'?official='+code;
  navigator.clipboard.writeText(link).catch(()=>{});
  toast('✅ Турнир создан!' + (aiUsed?' (AI-вопросы)':'') + ' Ссылка скопирована', 4000);
  track('official_tournament_created', {code, title, numQs, cat, isPrivate, ai: aiUsed});

  if(isPrivate) showPrivateTournamentQR(ot.id, code, accessCode, title, orgName);
  loadAdminOTList();
}

function showPrivateTournamentQR(id, code, accessCode, title, orgName){
  const link = location.origin+location.pathname+'?official='+code+'&ac='+accessCode;
  const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=240x240&data='+encodeURIComponent(link);
  let modal = document.getElementById('private-qr-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'private-qr-modal';
    modal.style.cssText='position:fixed;inset:0;z-index:9995;background:rgba(10,10,20,.9);display:flex;align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px 24px 0 0;padding:24px;width:100%;max-width:480px;text-align:center">
    <div style="font-size:18px;font-weight:900;margin-bottom:4px">🔒 Приватный турнир</div>
    <div style="font-size:14px;font-weight:700;color:var(--accent2);margin-bottom:2px">${title}</div>
    ${orgName?`<div style="font-size:12px;color:var(--muted);margin-bottom:12px">${orgName}</div>`:'<div style="margin-bottom:12px"></div>'}
    <img src="${qrUrl}" alt="QR" style="width:180px;height:180px;border-radius:16px;background:#fff;padding:8px;box-sizing:border-box;margin-bottom:16px" />
    <div style="background:rgba(108,99,255,.15);border:0.5px solid var(--accent);border-radius:12px;padding:10px;margin-bottom:12px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Код доступа</div>
      <div style="font-size:28px;font-weight:900;letter-spacing:4px;color:var(--accent2)">${accessCode}</div>
    </div>
    <div style="font-size:12px;color:var(--muted);word-break:break-all;margin-bottom:16px">${link}</div>
    <div style="display:flex;gap:8px">
      <button onclick="navigator.clipboard.writeText('${link}').catch(()=>{});window.toast('Ссылка скопирована!')" style="flex:1;background:var(--accent);border:none;border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">📋 Копировать ссылку</button>
      <button onclick="document.getElementById('private-qr-modal').remove()" style="flex:1;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
    </div>
  </div>`;
  modal.style.display='flex';
}

async function loadAdminOTList(){
  const el = document.getElementById('ot-admin-items');
  if(!el || !isAdmin()) return;
  const {data} = await sb.from('official_tournaments')
    .select('id,code,title,status,starts_at')
    .order('created_at',{ascending:false}).limit(10);
  if(!data||!data.length){ el.innerHTML='<div style="color:var(--muted)">No tournaments yet</div>'; return; }
  el.innerHTML = data.map(ot=>`
    <div style="background:var(--bg3);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:800">${ot.is_private?'🔒 ':''} ${ot.title}</div>
          <div style="font-size:10px;color:var(--muted)">${ot.code} · ${ot.status.toUpperCase()}${ot.org_name?' · '+ot.org_name:''}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
          ${ot.is_private&&ot.access_code
            ? `<button onclick="showPrivateTournamentQR('${ot.id}','${ot.code}','${ot.access_code}','${ot.title.replace(/'/g,"\\'")}','${(ot.org_name||'').replace(/'/g,"\\'")}') " style="background:var(--bg2);border:0.5px solid var(--accent);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">📱 QR</button>`
            : `<button onclick="copyOTLink('${ot.code}')" style="background:var(--bg2);border:0.5px solid var(--border);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">🔗 Link</button>`}
          ${ot.status==='lobby'?`<button onclick="adminStartOT('${ot.id}')" style="background:var(--green);border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">▶ Start</button>`:''}
          ${ot.status==='live'?`<button onclick="adminFinishOT('${ot.id}')" style="background:var(--red);border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">⏹ Finish</button>`:''}
          <button onclick="openOfficialTournament('${ot.code}')" style="background:var(--accent);border:none;border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">👁 View</button>
          ${ot.status==='finished'?`<button onclick="showTournamentAnalytics('${ot.id}','${ot.title.replace(/'/g,"\\'")}') " style="background:rgba(108,99,255,.2);border:1px solid rgba(108,99,255,.4);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">📊</button>`:''}
        </div>
      </div>
    </div>`).join('');
}

window.showTournamentAnalytics = async function(tournId, title) {
  let modal = document.getElementById('tourn-analytics-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'tourn-analytics-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:800;background:var(--bg);overflow-y:auto;display:flex;flex-direction:column';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="padding:20px;max-width:600px;margin:0 auto;width:100%">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button onclick="document.getElementById('tourn-analytics-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0">←</button>
      <div>
        <div style="font-size:18px;font-weight:900">📊 Аналитика</div>
        <div style="font-size:12px;color:var(--muted)">${title}</div>
      </div>
    </div>
    <div id="analytics-loading" style="text-align:center;padding:40px;color:var(--muted)">⏳ Загружаем данные...</div>
  </div>`;
  modal.style.display = 'flex';

  const [playersRes, otRes] = await Promise.all([
    sb.from('official_tournament_players')
      .select('user_id,display_name,score,correct_count,total_count,disqualified,joined_at')
      .eq('tournament_id', tournId),
    sb.from('official_tournaments')
      .select('title,status,entry_fee,prize_pool,created_at')
      .eq('id', tournId).single(),
  ]);

  const players = playersRes.data || [];
  const ot = otRes.data || {};
  const total = players.length;
  const completed = players.filter(p => p.total_count > 0).length;
  const dq = players.filter(p => p.disqualified).length;
  const avgScore = total ? Math.round(players.reduce((s,p) => s + (p.score||0), 0) / total) : 0;
  const avgAcc = completed ? Math.round(players.filter(p=>p.total_count>0).reduce((s,p) => s + (p.correct_count||0) / (p.total_count||1), 0) / completed * 100) : 0;

  // Funnel
  const funnelSteps = [
    { label: 'Зашли в лобби', val: total },
    { label: 'Ответили хотя бы 1', val: completed },
    { label: 'Дошли до конца', val: players.filter(p => (p.total_count||0) >= 5).length },
    { label: 'Дисквалифицированы', val: dq },
  ];
  const funnelMax = total || 1;

  const funnelHTML = funnelSteps.map(s => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
        <span>${s.label}</span><span style="font-weight:800">${s.val}</span>
      </div>
      <div style="height:8px;background:rgba(255,255,255,.08);border-radius:4px;overflow:hidden">
        <div style="height:100%;border-radius:4px;background:var(--accent);width:${Math.round(s.val/funnelMax*100)}%"></div>
      </div>
    </div>`).join('');

  // Per-question accuracy heatmap (from correct_count/total_count per player — aggregate)
  // We don't have per-question per-player breakdown in DB yet, so show player accuracy distribution
  const buckets = [0,0,0,0,0]; // 0-20, 20-40, 40-60, 60-80, 80-100
  players.filter(p=>p.total_count>0).forEach(p => {
    const pct = p.correct_count / p.total_count;
    buckets[Math.min(4, Math.floor(pct * 5))]++;
  });
  const bucketLabels = ['0–20%','20–40%','40–60%','60–80%','80–100%'];
  const bucketMax = Math.max(...buckets, 1);
  const heatmapHTML = buckets.map((v,i) => `
    <div style="text-align:center;flex:1">
      <div style="height:${Math.max(4, Math.round(v/bucketMax*80))}px;background:${i<2?'rgba(255,82,82,.6)':i===2?'rgba(255,193,7,.6)':'rgba(74,222,128,.6)'};border-radius:4px 4px 0 0;margin-bottom:4px"></div>
      <div style="font-size:10px;color:var(--muted)">${bucketLabels[i]}</div>
      <div style="font-size:12px;font-weight:800">${v}</div>
    </div>`).join('');

  // Top players
  const top = [...players].filter(p=>!p.disqualified).sort((a,b)=>(b.score||0)-(a.score||0)).slice(0,5);
  const topHTML = top.map((p,i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:8px;background:rgba(255,255,255,.04);border-radius:10px;margin-bottom:4px">
      <div style="font-size:14px;width:24px;text-align:center">${['🥇','🥈','🥉','4','5'][i]}</div>
      <div style="flex:1;font-size:13px;font-weight:700">${p.display_name}</div>
      <div style="font-size:12px;color:var(--muted)">${p.correct_count||0}/${p.total_count||0} · ${p.score||0}pts</div>
    </div>`).join('');

  const loadingEl = document.getElementById('analytics-loading');
  if (!loadingEl) return;
  loadingEl.outerHTML = `
    <!-- Stats cards -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:20px">
      <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:var(--accent2)">${total}</div>
        <div style="font-size:11px;color:var(--muted)">Участников</div>
      </div>
      <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:var(--accent2)">${avgAcc}%</div>
        <div style="font-size:11px;color:var(--muted)">Средняя точность</div>
      </div>
      <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
        <div style="font-size:24px;font-weight:900;color:var(--accent2)">${ot.prize_pool||0}⚡</div>
        <div style="font-size:11px;color:var(--muted)">Призовой фонд</div>
      </div>
    </div>
    <!-- Funnel -->
    <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:12px">📉 ВОРОНКА УЧАСТИЯ</div>
      ${funnelHTML}
    </div>
    <!-- Accuracy distribution -->
    <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:12px">🔥 РАСПРЕДЕЛЕНИЕ ТОЧНОСТИ</div>
      <div style="display:flex;align-items:flex-end;gap:6px;height:100px">${heatmapHTML}</div>
    </div>
    <!-- Top players -->
    <div style="background:rgba(255,255,255,.04);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="font-size:12px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:12px">🏆 ТОП ИГРОКИ</div>
      ${topHTML || '<div style="color:var(--muted);font-size:13px">Нет данных</div>'}
    </div>
    <!-- CSV Export -->
    <button onclick="exportTournamentCSV('${tournId}','${title.replace(/'/g,"\\'")}') " style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit">
      ⬇️ Скачать CSV
    </button>`;
};

window.exportTournamentCSV = async function(tournId, title) {
  const { data: players } = await sb.from('official_tournament_players')
    .select('display_name,score,correct_count,total_count,disqualified,joined_at')
    .eq('tournament_id', tournId)
    .order('score', { ascending: false });
  if (!players?.length) { toast('Нет данных'); return; }

  const rows = [
    ['Место','Имя','Очки','Правильно','Всего','Точность','Дисквалифицирован','Зашёл'],
    ...players.map((p, i) => [
      i + 1, p.display_name, p.score||0, p.correct_count||0, p.total_count||0,
      p.total_count ? Math.round((p.correct_count||0)/(p.total_count)*100)+'%' : '—',
      p.disqualified ? 'Да' : 'Нет',
      p.joined_at ? new Date(p.joined_at).toLocaleString('ru') : '—',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `${title}_results.csv`; a.click();
  URL.revokeObjectURL(url);
  toast('✅ CSV скачан!');
};

function copyOTLink(code){
  const link = location.origin+location.pathname+'?official='+code;
  navigator.clipboard.writeText(link).catch(()=>{});
  toast('🔗 Ссылка скопирована!');
}

async function adminStartOT(id){
  if(!isAdmin()) return;

  // Preflight check
  const preflight = await tournamentPreflight(id);
  const msg = preflight.summary + '\n\nЗапустить турнир?';

  if(!preflight.ok){
    // Has blocking errors - show and block start
    toast('❌ ' + preflight.warnings[0]);
    alert('⚠️ Турнир нельзя запустить:\n\n' + preflight.summary);
    return;
  }

  // Warnings only - confirm
  const confirmed = confirm(msg);
  if(!confirmed) return;

  const {data:ot} = await sb.from('official_tournaments')
    .update({status:'live', started_at:new Date().toISOString()})
    .eq('id',id).select('title,code').single();
  toast('▶ Tournament started!');
  // Push all subscribers of this tournament
  if (window.sendPushToTournament && ot) {
    window.sendPushToTournament(id, {
      title: '🏆 Турнир начался!',
      body:  `«${ot.title}» — заходи прямо сейчас!`,
      url:   '/?official=' + ot.code,
      tag:   'tournament-start',
    });
  }
  loadAdminOTList();
}

async function adminFinishOT(id){
  if(!isAdmin()) return;
  await sb.from('official_tournaments').update({status:'finished',finished_at:new Date().toISOString()}).eq('id',id);
  toast('⏹ Tournament finished!');
  loadAdminOTList();
}

// ═══════════════════════════════════════════
// PLAY MENU
// ═══════════════════════════════════════════

// ── Хайп-паки ──
const HYPE_PACK_NAMES = { slovo: "Квиз: Слово пацана", squid: "Квиз: Игра в кальмара", worldcup: "Квиз: ЧМ по футболу" };
const HYPE_PACKS = {"slovo": [{"q": "В каком году выходит сериал «Слово пацана»?", "a": ["2023", "2022", "2024", "2021"], "c": 0, "cat": "Слово пацана"}, {"q": "Главного героя сериала зовут...", "a": ["Андрей", "Марат", "Вова", "Костя"], "c": 0, "cat": "Слово пацана"}, {"q": "В каком городе происходят события сериала?", "a": ["Казань", "Москва", "Пермь", "Уфа"], "c": 0, "cat": "Слово пацана"}, {"q": "Как называется группировка главных героев?", "a": ["Универсам", "Тяп-Ляп", "Борисково", "Грязь"], "c": 0, "cat": "Слово пацана"}, {"q": "Кто режиссёр сериала «Слово пацана»?", "a": ["Жора Крыжовников", "Данила Козловский", "Юрий Быков", "Кирилл Серебренников"], "c": 0, "cat": "Слово пацана"}, {"q": "На каком стриминге вышел сериал?", "a": ["Кинопоиск", "Netflix", "START", "Иви"], "c": 0, "cat": "Слово пацана"}, {"q": "В каком десятилетии происходят события?", "a": ["1980-е", "1970-е", "1990-е", "2000-е"], "c": 0, "cat": "Слово пацана"}, {"q": "Как звали учительницу которая помогала Андрею?", "a": ["Ирина Васильевна", "Татьяна Ивановна", "Наталья Петровна", "Светлана Сергеевна"], "c": 0, "cat": "Слово пацана"}, {"q": "Сколько серий в первом сезоне?", "a": ["8", "6", "10", "12"], "c": 0, "cat": "Слово пацана"}, {"q": "Какая песня стала символом сериала?", "a": ["Пыяла", "Ночь", "Перемен", "Прекрасное далёко"], "c": 0, "cat": "Слово пацана"}], "squid": [{"q": "Сколько игроков участвует в Игре в кальмара в начале?", "a": ["456", "365", "999", "100"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Какая игра первая в сериале?", "a": ["Светофор", "Дёрни за верёвочку", "Медовые соты", "Перетягивание каната"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Как зовут главного героя?", "a": ["Сон Ги-хун", "Чо Сан-у", "Кан Сэ-бёк", "Пак Чон-бэ"], "c": 0, "cat": "Игра в кальмара"}, {"q": "На каком сервисе вышел сериал?", "a": ["Netflix", "Disney+", "HBO", "Amazon"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Какой приз ждёт победителя?", "a": ["45,6 млрд вон", "1 млрд долларов", "100 млн вон", "10 млрд иен"], "c": 0, "cat": "Игра в кальмара"}, {"q": "В какой стране снят сериал?", "a": ["Южная Корея", "Япония", "Китай", "США"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Как называется 4-я игра?", "a": ["Стеклянный мост", "Перетягивание каната", "Мрамор", "Кальмар"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Кто является Фронтменом?", "a": ["Ин-хо", "Ги-хун", "Сан-у", "Иль-нам"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Какой номер у главного героя?", "a": ["456", "001", "067", "218"], "c": 0, "cat": "Игра в кальмара"}, {"q": "Сколько сезонов вышло к 2024 году?", "a": ["2", "1", "3", "4"], "c": 0, "cat": "Игра в кальмара"}], "worldcup": [{"q": "Кто выиграл ЧМ 2022?", "a": ["Аргентина", "Франция", "Бразилия", "Германия"], "c": 0, "cat": "Футбол"}, {"q": "Где проходил ЧМ 2022?", "a": ["Катар", "Россия", "Бразилия", "ОАЭ"], "c": 0, "cat": "Футбол"}, {"q": "Кто забил больше всех голов на ЧМ 2022?", "a": ["Килиан Мбаппе", "Лионель Месси", "Оливье Жиру", "Энер Валенсия"], "c": 0, "cat": "Футбол"}, {"q": "Сколько раз Бразилия выигрывала ЧМ?", "a": ["5", "4", "3", "6"], "c": 0, "cat": "Футбол"}, {"q": "В каком году Россия принимала ЧМ?", "a": ["2018", "2014", "2010", "2022"], "c": 0, "cat": "Футбол"}, {"q": "Кто выиграл ЧМ 2018?", "a": ["Франция", "Хорватия", "Бельгия", "Англия"], "c": 0, "cat": "Футбол"}, {"q": "Где пройдёт ЧМ 2026?", "a": ["США/Канада/Мексика", "Австралия", "Китай", "Саудовская Аравия"], "c": 0, "cat": "Футбол"}, {"q": "Какой рекорд голов на одном ЧМ?", "a": ["13 голов (Жюст Фонтэн, 1958)", "16 голов", "10 голов", "12 голов"], "c": 0, "cat": "Футбол"}, {"q": "Месси выиграл ЧМ в каком году?", "a": ["2022", "2018", "2014", "2026"], "c": 0, "cat": "Футбол"}, {"q": "Сколько команд участвует в ЧМ 2026?", "a": ["48", "32", "36", "40"], "c": 0, "cat": "Футбол"}]};

function startHypePack(packId){
  const qs = HYPE_PACKS[packId];
  if(!qs || !qs.length){ toast('Пак не найден'); return; }
  // Hype packs are free viral games — bypass daily training limit
  const packData = qs.map(q => ({ ...q, t: q.t || (Array.isArray(q.a) ? q.a.length * 8 : 20) }));
  // Use startExtractedPack from training.js (handles quiz screen + loadQ)
  if(typeof window.startExtractedPack === 'function'){
    window.startExtractedPack(packData, HYPE_PACK_NAMES?.[packId] || 'Хайп-квиз', 'hype_' + packId);
  } else {
    toast('⚠️ Ошибка загрузки — попробуйте позже');
  }
}

// ── Шеринг хайп-игры ─────────────────────────────────────────────
function shareHypePack(packId){
  const link = location.origin + location.pathname + '?hype=' + encodeURIComponent(packId);
  const names = {
    slovo:    lang==='ru' ? 'Квиз «Слово пацана»'   : 'Quiz: Slovo Patsana',
    squid:    lang==='ru' ? 'Квиз «Игра в кальмара»' : 'Quiz: Squid Game',
    worldcup: lang==='ru' ? 'Квиз «ЧМ по футболу»'  : 'Quiz: World Cup',
  };
  const name = names[packId] || 'Хайп-квиз';
  const text = lang==='ru'
    ? `🔥 Сыграй в ${name} на Brain Fight Club!`
    : `🔥 Play ${name} on Brain Fight Club!`;
  if(navigator.share){
    navigator.share({ title: name, text, url: link }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(link).catch(()=>{});
    toast(lang==='ru' ? '🔗 Ссылка скопирована!' : '🔗 Link copied!');
  }
  track('hype_pack_shared', { pack_id: packId });
}

function shareHypeToTG(packId){
  const link = location.origin + location.pathname + '?hype=' + encodeURIComponent(packId);
  const names = { slovo:'Слово пацана', squid:'Игра в кальмара', worldcup:'ЧМ по футболу' };
  const name = names[packId] || 'Хайп-квиз';
  const text = lang==='ru'
    ? `🔥 Сыграй в квиз «${name}» на Brain Fight Club!`
    : `🔥 Play the ${name} quiz on Brain Fight Club!`;
  window.open('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text),'_blank');
  track('hype_pack_shared_tg', { pack_id: packId });
}

function shareHypeToWA(packId){
  const link = location.origin + location.pathname + '?hype=' + encodeURIComponent(packId);
  const names = { slovo:'Слово пацана', squid:'Игра в кальмара', worldcup:'ЧМ по футболу' };
  const name = names[packId] || 'Хайп-квиз';
  const text = lang==='ru'
    ? `🔥 Сыграй в квиз «${name}»! ${link}`
    : `🔥 Play the ${name} quiz! ${link}`;
  window.open('https://wa.me/?text='+encodeURIComponent(text),'_blank');
  track('hype_pack_shared_wa', { pack_id: packId });
}

// Загрузка хайп-игры из базы по import_key (для кастомных паков по ссылке)
async function loadHypePackFromDB(importKey){
  try{
    const { data: pack, error } = await sb.from('questions')
      .select('*')
      .like('import_key', 'game_' + importKey + '%')
      .eq('status','published')
      .limit(30);
    if(error || !pack || !pack.length){
      toast(lang==='ru' ? '❌ Игра не найдена' : '❌ Game not found');
      return;
    }
    customQs = pack.map(q => ({
      q:   (q.q_ru||q.q_en||q.question||''),
      a:   (q.a_ru||q.a_en||q.answers||[]),
      c:   q.correct_index ?? 0,
      cat: q.cat || 'Хайп',
      t:   ((q.a_ru||q.a_en||q.answers||[]).length) * 10,
    })).filter(q => q.q && q.a && q.a.length >= 2);
    if(!customQs.length){ toast('❌ Нет вопросов'); return; }
    if(typeof startCustomGame === 'function') startCustomGame(customQs);
    track('hype_pack_played_from_link', { import_key: importKey });
  }catch(e){
    toast('Ошибка загрузки: ' + e.message);
  }
}

// Проверяем ?hype= в URL при старте
function checkHypeParam(){
  const p = new URLSearchParams(location.search);
  const hype = p.get('hype');
  if(!hype) return;
  if(HYPE_PACKS[hype]){
    // Встроенный пак
    setTimeout(()=>startHypePack(hype), 800);
  } else {
    // Кастомный пак из БД
    setTimeout(()=>loadHypePackFromDB(hype), 800);
  }
}

const CONSUMABLES = {
  // streak_freeze: handled by buyStreakFreeze() in streak.js — do NOT duplicate
  hint:         { name: 'Подсказка',       cost: 50,  key: 'bfc_hints' },
  double_xp:    { name: 'Двойные нейроны', cost: 200, key: 'bfc_double_xp' },
  avatar_frame: { name: 'Рамка аватара',   cost: 500, key: 'bfc_avatar_frame' },
};

window.buyConsumable = async function(type) {
  if (type === 'streak_freeze') { window.buyStreakFreeze?.(); return; }

  const item = CONSUMABLES[type];
  if (!item) return;
  const n = neurons ?? 0;
  if (n < item.cost) {
    toast(`Нужно ${item.cost} ⚡, у тебя ${n}`);
    return;
  }
  if (!confirm(`Потратить ${item.cost} ⚡ на «${item.name}»?`)) return;

  const result = await spendNeurons(item.cost, 'consumable', `${type}:${Date.now()}`);
  if (!result?.ok) {
    toast(result?.reason === 'insufficient' ? '❌ Недостаточно нейронов' : '❌ Ошибка списания');
    return;
  }

  if (type === 'hint') {
    const cur = parseInt(localStorage.getItem(item.key) || '0');
    localStorage.setItem(item.key, cur + 1);
    toast(`💡 Подсказка добавлена! У тебя: ${cur + 1} шт.`);
  } else if (type === 'double_xp') {
    const expires = Date.now() + 3600000;
    localStorage.setItem(item.key, expires);
    toast('✨ Двойные нейроны активны 1 час!');
  } else if (type === 'avatar_frame') {
    localStorage.setItem(item.key, '1');
    toast('🖼️ Рамка активирована! Видна в лидерборде.');
  }

  track('consumable_bought', { type, cost: item.cost });
};

async function redeemPrize(type){
  const costs = {disc20: 500, disc50: 1500, free: 3000};
  const names = {disc20:'Скидка 20%', disc50:'Скидка 50%', free:'Игра бесплатно'};
  const cost = costs[type];
  if(!cost){ toast('Неизвестный приз'); return; }
  if(neurons < cost){
    toast('Недостаточно нейронов. Нужно ' + cost + ' ⚡');
    return;
  }
  if(!confirm('Потратить ' + cost + ' нейронов на «' + names[type] + '»?')) return;

  const result = await spendNeurons(cost, 'prize_redeem', 'prize:' + type + ':' + Date.now());
  if(!result || !result.ok){
    if(result && result.reason === 'insufficient'){
      toast('❌ Недостаточно нейронов на счёте');
    } else {
      toast('❌ Ошибка списания. Попробуйте снова');
    }
    return;
  }
  toast('✅ Запрос отправлен! Промокод придёт в течение 24 часов');
  track('prize_redeemed', {type, cost});
}

function showPlayMenu(){
  showScreen('play-menu');
  document.getElementById('n-play-menu').textContent = neurons;
  const L = lang === 'ru';
  document.getElementById('pm-title').textContent = L ? 'Режимы игры' : 'Play';

  // Quick Play — show lock state if today's round is spent
  const quickLocked = isQuickPlayLocked();
  const pmQuickEl = document.getElementById('pm-quick');
  const pmQuickSubEl = document.getElementById('pm-quick-sub');
  if(pmQuickEl) pmQuickEl.textContent = quickLocked
    ? (L ? '🔒 Быстрая игра' : '🔒 Quick Play')
    : (L ? 'Быстрая игра' : 'Quick Play');
  if(pmQuickSubEl) pmQuickSubEl.textContent = quickLocked
    ? (L ? 'Дневной лимит исчерпан — возвращайтесь завтра' : 'Daily limit reached — come back tomorrow')
    : (L ? '10 бесплатных вопросов в день' : '10 free questions per day');

  const _pm = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  _pm('pm-topics',     L ? 'Выбрать тему' : 'Choose Topic');
  _pm('pm-topics-sub', L ? 'Наука, кино, спорт и другое' : 'Science, Cinema, Sports and more');
  _pm('pm-packs',      L ? 'Бонусы' : 'Bonuses');
  _pm('pm-packs-sub',  L ? 'Призы, паки и бонусы за нейроны' : 'Prizes, packs and bonuses for neurons');
  _pm('pm-daily',      L ? 'Дневное задание' : 'Daily Challenge');
  _pm('pm-daily-sub',  L ? 'Бонусные нейроны за задание' : 'Bonus neurons for today\'s task');
  _pm('pm-random',     L ? 'Случайный бой' : 'Random Battle');
  _pm('pm-random-sub', L ? 'Найти случайного соперника онлайн' : 'Find a random opponent online');
  _pm('pm-duel',       L ? 'Дуэль с другом' : 'Duel a Friend');
  _pm('pm-duel-sub',   L ? 'Отправь ссылку и играйте вместе' : 'Send a link and play together');
  // Show owned packs count
  const ownedCount = ownedPacks ? ownedPacks.size : 0;
  const badge = document.getElementById('pm-packs-count');
  if(ownedCount > 0){ badge.textContent = ownedCount; badge.style.display = ''; }
  else badge.style.display = 'none';
  // Check for live official tournament
  checkLiveOfficialTournament();
  track('play_menu_viewed', {});
}

async function checkLiveOfficialTournament(){
  const item = document.getElementById('pm-official-item');
  if(!item) return;
  try{
    const {data} = await sb.from('official_tournaments').select('code,title')
      .eq('status','live').or('is_private.is.null,is_private.eq.false').limit(1).maybeSingle();
    if(data){
      item.style.display = 'flex';
      document.getElementById('pm-official').textContent = data.title||'Официальный турнир';
      item.setAttribute('data-code', data.code);
    } else { item.style.display = 'none'; }
  }catch(e){ item.style.display = 'none'; }
}

// ─── CUP / OFFICIAL TOURNAMENT ENTRY POINT ───────────────────
// showCupScreen: always leads to the official tournament.
// If there's a live tournament → show it. Otherwise show a friendly placeholder.
function showCupScreen(){
  if (window.openTournamentsListScreen) { window.openTournamentsListScreen(); return; }
  showOfficialFromMenu();
}

// Called from the old nav_tournament — kept as alias
function showTournamentFromNav(){ showCupScreen(); }

// ─── DAILY GOAL BONUS ─────────────────────────────────────────
// TODO (post-MVP): persist daily goal claim server-side in Supabase
//   (e.g. profiles.daily_goal_claimed_date or a daily_rewards table)
// Currently stored in localStorage — safe for demo.
const DAILY_GOAL_BONUS = 50; // ⚡ awarded once per day for finishing Quick Play


function getTodayKey(){ return new Date().toISOString().slice(0,10); } // restored: needed before ES modules load



// [isDailyGoalClaimed] → deleted from legacy.js (now in ES module)



// [claimDailyGoalBonus] → deleted from legacy.js (now in ES module)



// [showOfficialFromMenu] → deleted from legacy.js (now in ES module)


// ── Game type tracking (Fix: smart "Play again") ──
let currentGameType = null;   // 'quick' | 'pack' | 'community' | 'daily'
let currentPackKey  = null;   // import_key for pack games

// ═══════════════════════════════════════════
// QUICK PLAY DAILY LOCK — one round per day
// ═══════════════════════════════════════════
const QUICK_PLAY_LOCK_KEY = 'mfc_quick_play_lock_v1';


// [todayKey] → deleted from legacy.js (now in ES module)



// [getQuickPlayLock] → deleted from legacy.js (now in ES module)


// Lock applies to ALL users including admins. Use MFC_RESET_QUICK_PLAY_LOCK() to test.

// [isQuickPlayLocked] → deleted from legacy.js (now in ES module)



// [lockQuickPlayStarted] → deleted from legacy.js (now in ES module)



// [lockQuickPlayCompleted] → deleted from legacy.js (now in ES module)


// Dev helper — reset lock for testing
window.MFC_RESET_QUICK_PLAY_LOCK = function(){
  localStorage.removeItem(QUICK_PLAY_LOCK_KEY);
  localStorage.removeItem('mfc_daily_questions');
  console.log('[MFC] Quick play lock reset');
};

// ═══════════════════════════════════════════
// QUESTION HISTORY — never repeat seen questions in quick play
// ═══════════════════════════════════════════
const PLAYED_QUESTION_IDS_KEY = 'mfc_played_question_ids_v1';


// [getLocalPlayedQuestionIds] → deleted from legacy.js (now in ES module)



// [addLocalPlayedQuestionId] → deleted from legacy.js (now in ES module)



// [getRemotePlayedQuestionIds] → deleted from legacy.js (now in ES module)



// [getPlayedQuestionIds] → deleted from legacy.js (now in ES module)


// Called at question show-time (not answer-time) so refresh can't give same Q again

// [markQuestionSeen] → deleted from legacy.js (now in ES module)


// ── Lowest-level guard: one check covers ALL entry points ──────────

// [blockQuickPlayIfLocked] → deleted from legacy.js (now in ES module)


// Flag to prevent showScore from running twice for the same round
let _scoreShownForGame = false;
// Session flag: once quick play finishes, any restart attempt → daily-limit
let _quickPlayCompletedThisSession = false;

// Flag: true only during the synchronous hand-off from startQuickPlay → startQuiz,
// so startQuiz doesn't see the freshly-written lock as a block.
let _quickPlayStartInProgress = false;


// [startQuickPlay] → deleted from legacy.js (now in ES module)



// [showPlayTopics] → deleted from legacy.js (now in ES module)



// [showMyPacks] → deleted from legacy.js (now in ES module)


// Render-token: each call increments this; async continuations bail if token changed.
let _packsRenderToken = 0;


// [renderDBGamePacks] → deleted from legacy.js (now in ES module)

// ── Pack purchases cache ──────────────────────────────────────────
let _userPackPurchases = null; // Set of game_pack_id strings the user owns


// [loadUserPackPurchases] → deleted from legacy.js (now in ES module)



// [isPackOwned] → deleted from legacy.js (now in ES module)



// [buyDBPack] → deleted from legacy.js (now in ES module)



// [playDBPack] → deleted from legacy.js (now in ES module)


// ─── DB QUESTION LOADER FOR QUICK PLAY ──────────────────────────
// Maps a raw Supabase `questions` row to the internal playable format.
// Handles every field variant we've seen in production.

// [normalizeDBQuestionForQuickPlay] → deleted from legacy.js (now in ES module)


// Loads published questions from Supabase for Quick Play use.
// Returns normalised + validated array, or [] on error.

// [loadPublishedQuickQuestionsFromDB] → deleted from legacy.js (now in ES module)


// Shows a friendly "no new questions" state on the daily-limit screen.

// [showNoFreshQuickQuestionsScreen] → deleted from legacy.js (now in ES module)


// ─── GOLD STANDARD pack builder (Fix 2) ──────────────────────────
// Groups questions by answer count and picks exactly 2 of each type
// (2,3,4,5,6 options) → 10 questions in order 2,2,3,3,4,4,5,5,6,6
// Returns null and shows toast if any type has < 2 questions.

// [buildStandardPackQuestions] → deleted from legacy.js (now in ES module)


// ─── EXTRACTED QUESTION pack (standard quiz UI) ──────────────────

// [startExtractedPack] → deleted from legacy.js (now in ES module)


// ─── SLIDE DECK engine ────────────────────────────────────────────
// ═══════════════════════════════════════════
// DAILY QUESTION LIMIT (10 questions/day)
// ═══════════════════════════════════════════
const FREE_QUESTIONS_PER_DAY = 10;

// Debug flag: set window.MFC_TEST_LIMIT_AS_USER = true to test limit as admin

// [_isLimitExempt] → deleted from legacy.js (now in ES module)



// [todayStr] → deleted from legacy.js (now in ES module)



// [getDailyQuestionsUsed] → deleted from legacy.js (now in ES module)


// Set of qIdx values already counted in current game session (resets on new game)
let _dailyCountedSet = new Set();
let _dailyCountedGameId = null;

// true only for free quick play — packs/duel/tournament/community/tester don't count
let _currentGameCountsDailyLimit = false;


// [getRemainingFreeQuestions] → deleted from legacy.js (now in ES module)



// [incrementDailyQuestion] → deleted from legacy.js (now in ES module)



// [checkQuestionLimit] → deleted from legacy.js (now in ES module)


// Legacy aliases

// [incrementDailyRounds] → deleted from legacy.js (now in ES module)


// [getDailyRoundsPlayed] → deleted from legacy.js (now in ES module)


// [checkDailyLimit] → deleted from legacy.js (now in ES module)


// Returns display count for daily-limit screen.
// Uses lock as source of truth: if today's quick play was started/completed,
// always show FREE_QUESTIONS_PER_DAY so we never display "0 of 10".

// [getDailyLimitDisplayUsed] → deleted from legacy.js (now in ES module)



// [showDailyLimitScreen] → deleted from legacy.js (now in ES module)



// [copyRefLinkAndToast] → deleted from legacy.js (now in ES module)



// [_showReferralInviteCard] → deleted from legacy.js (now in ES module)



// [shareToTelegramRef] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
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


// [pickRandomBot] → deleted from legacy.js (now in ES module)


// Legacy: keep BOT_NAMES for any old references
const BOT_NAMES = BOT_PLAYERS.map(b => `${b.flag} ${b.name} (${b.city})`);


// [startMatchmaking] → deleted from legacy.js (now in ES module)



// [matchFound] → deleted from legacy.js (now in ES module)



// [playWithBot] → deleted from legacy.js (now in ES module)



// [startBotDuel] → deleted from legacy.js (now in ES module)



// [cancelMatchmaking] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// RULES SCREEN
// ═══════════════════════════════════════════

// [toggleRulesSection] → deleted from legacy.js (now in ES module)


// Also update showProfile to translate new elements
const _origShowProfile = typeof showProfile === 'function' ? showProfile : null;

// ═══════════════════════════════════════════
// MATCHMAKING QUEUE TABLE SQL (run once)
// (table created lazily if not exists)
// ═══════════════════════════════════════════
async function ensureMatchmakingTable(){
  // This is handled by supabase migration - just attempt upsert and ignore error
}

// ═══════════════════════════════════════════
// TESTER MODE
// ═══════════════════════════════════════════
let testerQuestions = [];
let testerIdx = 0;
let testerResults = {};    // import_key → {verdict, note, db_id}
let testerAnswerShown = false;
let testerFlagActive = false;
let testerFilterFix = false; // true = show only fix/bad questions

async function startTesterMode(mode, packImportKey){
  if(!isAdmin()){ toast('Admin only'); return; }

  // If no mode passed, show selector screen
  if(!mode){
    showScreen('tester');
    document.getElementById('tester-pack-selector').style.display = 'flex';
    document.getElementById('tester-content').style.display = 'none';
    // Load packs list
    loadTesterPackList();
    return;
  }

  _testerMode = mode;
  _testerPackKey = (mode === 'pack') ? packImportKey : null;
  testerFilterFix = (mode === 'fix');
  showScreen('tester');
  document.getElementById('tester-pack-selector').style.display = 'none';
  document.getElementById('tester-content').style.display = 'flex';

  toast('⏳ Загружаем вопросы...');

  let query;

  if(mode === 'fix'){
    // Only questions with fix/bad reviews
    const {data: reviews} = await sb.from('question_reviews')
      .select('import_key').in('verdict',['fix','bad']);
    if(!reviews || !reviews.length){ toast('Нет вопросов с замечаниями'); return; }
    const keys = [...new Set(reviews.map(r=>r.import_key))];
    query = sb.from('questions').select('*').in('import_key', keys).order('import_key');
  } else if(mode === 'pack' && packImportKey){
    // Questions for a specific pack (via game_pack_questions)
    const {data: pack} = await sb.from('game_packs')
      .select('id,title_ru').eq('import_key', packImportKey).single();
    if(!pack){ toast('Пак не найден'); return; }
    document.getElementById('tester-progress-txt').textContent = pack.title_ru;
    // Try linked questions first, fallback to import_key prefix
    let tryQuery = await sb.from('questions')
      .select('*, game_pack_questions!inner(position)')
      .eq('game_pack_questions.game_pack_id', pack.id)
      .order('position', {foreignTable:'game_pack_questions'});
    if(tryQuery.data && tryQuery.data.length){
      query = {then: ()=>tryQuery}; // already resolved
      const {data, error} = tryQuery;
      if(!error && data && data.length){
        // Use this result directly
        testerQuestions = buildTesterQuestions(data);
        testerIdx=0; testerAnswerShown=false;
        showScreen('tester');
        document.getElementById('tester-pack-selector').style.display='none';
        document.getElementById('tester-content').style.display='flex';
        testerRender(); return;
      }
    }
    // Fallback: load by import_key prefix (when game_pack_questions not populated)
    // Tester pack fallback: load by import_key prefix
    const packPrefix = packImportKey.replace('game_','');
    // Show only MC questions in tester — skip archived/unsupported
    query = sb.from('questions').select('*')
      .like('import_key', packPrefix+'_q%')
      .not('status','in','(archived_unsupported,needs_reimport,archived)')
      .eq('question_type','multiple_choice')
      .order('import_key');
  } else if(mode === 'import' && packImportKey){
    // Questions from a specific import batch (by batch key prefix)
    query = sb.from('questions')
      .select('*')
      .like('import_key', packImportKey + '_q%')
      .eq('question_type', 'multiple_choice')
      .order('import_key');
  } else if(mode === 'community'){
    // Community questions — for admin review
    query = sb.from('questions')
      .select('*')
      .eq('source_type','community')
      .eq('question_type','multiple_choice')
      .not('status','in','(archived_unsupported,needs_reimport,archived)')
      .order('created_at', {ascending: false})
      .limit(200);
  } else {
    // General: official_general + official_pack, MC only, no archived, no legacy game_% keys
    query = sb.from('questions')
      .select('*')
      .in('source_type', ['official_general','official_pack'])
      .eq('question_type','multiple_choice')
      .not('status','in','(archived_unsupported,needs_reimport,archived)')
      .not('import_key','like','game_%')
      .order('import_key')
      .limit(500);
  }

  const {data, error} = await query;
  if(error || !data || !data.length){
    // Empty state — don't show blank screen
    showScreen('tester');
    document.getElementById('tester-pack-selector').style.display = 'none';
    document.getElementById('tester-content').style.display = 'flex';
    document.getElementById('tester-content').innerHTML = `
      <div style="text-align:center;padding:40px 20px">
        <div style="font-size:40px;margin-bottom:12px">📭</div>
        <div style="font-size:16px;font-weight:800;margin-bottom:8px">Нет валидных вопросов</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:20px">
          ${mode==='pack' ? 'В этом паке нет валидных multiple_choice вопросов.' : 'Нет вопросов для проверки.'}
        </div>
        <button onclick="testerBackToSelector()" class="big-btn" style="max-width:200px">← Назад</button>
      </div>`;
    return;
  }

  // Load existing reviews
  const {data: existingReviews} = await sb.from('question_reviews')
    .select('*').eq('reviewer_id', currentUser.id).order('created_at', {ascending:false});
  testerResults = {};
  if(existingReviews){
    for(const r of existingReviews){
      if(!testerResults[r.import_key])
        testerResults[r.import_key] = {verdict: r.verdict, note: r.note, db_id: r.id};
    }
  }

  testerQuestions = buildTesterQuestions(data);
  testerIdx = 0; testerAnswerShown = false;
  testerRender();
}

function buildTesterQuestions(data){
  return data.map(q=>{
    const lang_q = lang==='ru'?(q.question_ru||q.question_text):(q.question_text||q.question_ru);
    const lang_a = lang==='ru'?(q.answers_ru||q.answers_json):(q.answers_json||q.answers_ru);
    const mtype = q.media_type||'none';
    const murl  = q.image_url||q.audio_url||q.video_url||'';
    return {
      _dbId: q.id, _importKey: q.import_key||q.id?.slice(0,8),
      _status: q.status, cat: q.category||'GENERAL',
      q: lang_q||'(текст пустой)',
      a: Array.isArray(lang_a)?lang_a:(typeof lang_a==='string'?JSON.parse(lang_a||'[]'):[]),
      c: q.correct_index||0, t:20,
      img:   mtype==='image'?(q.image_url||null):null,
      audio: q.audio_url||null,
      video: q.video_url||null,
      explanation_ru: q.explanation_ru||null,
      _mediaType: mtype,
      _mediaUrl: murl,
      // Proper media object — used by openTesterMediaPreview and renderQMedia
      media: {
        type:     mtype,
        url:      murl,
        filename: q.media_filename||q.image_url?.split('/').pop()||q.audio_url?.split('/').pop()||'',
        placeholder: (!murl && mtype!=='none') ? (q.explanation_ru||mtype) : '',
      },
      _renderMode: q.render_mode||'extracted_question',
      _questionType: q.question_type||'multiple_choice',
      _questionScope: q.question_scope||'general',
      _mediaRequired: q.media_required||false,
      _variants: Array.isArray(lang_a)?lang_a.length:0,
      _difficulty: q.difficulty||null,
    };
  });
}

async function loadAdminGames(){
  const el = document.getElementById('admin-games-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">⏳...</div>';
  const {data: packs} = await sb.from('game_packs')
    .select('id,import_key,title_ru,status,pack_type,source_type')
    .in('status', ['draft','published'])
    .order('title_ru');
  if(!packs || !packs.length){
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Нет игр. Создайте через конструктор.</div>';
    return;
  }
  let html = '';
  for(const p of packs){
    const {count} = await sb.from('game_pack_questions')
      .select('*',{count:'exact',head:true}).eq('game_pack_id', p.id);
    const qCount = count||0;
    const qColor = qCount>=10?'var(--green)':qCount>0?'var(--gold)':'var(--red)';
    const sColor = p.status==='published'?'var(--green)':'var(--gold)';
    html += `<div style="padding:12px 0;border-bottom:0.5px solid var(--border)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div>
          <div style="font-size:14px;font-weight:800">${_esc(p.title_ru||p.import_key)}</div>
          <div style="font-size:11px;color:var(--muted)">${_esc(p.import_key)} · <span style="color:${qColor}">${qCount} вопр.</span></div>
        </div>
        <select onchange="adminSetPackType('${p.id}',this.value)"
          style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:4px 8px;font-size:12px;color:var(--text);font-family:inherit">
          <option value="standard" ${p.pack_type==='standard'?'selected':''}>📦 Пак</option>
          <option value="tournament" ${p.pack_type==='tournament'?'selected':''}>🏆 Турнир</option>
        </select>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px;display:flex;align-items:center;gap:6px">
        🔗 <span style="user-select:all;color:var(--accent2)">${location.origin}/?pack=${p.import_key}</span>
        <button onclick="navigator.clipboard.writeText('${location.origin}/?pack=${p.import_key}').then(()=>toast('✅ Ссылка скопирована'))"
          style="padding:2px 8px;border-radius:6px;border:none;background:rgba(108,99,255,.15);color:var(--accent2);font-size:11px;cursor:pointer;font-family:inherit">
          Копировать
        </button>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="adminSetPackStatus('${p.id}','${p.status==='published'?'draft':'published'}')"
          style="flex:1;padding:7px 0;border-radius:8px;border:none;background:${p.status==='published'?'rgba(0,200,100,.15)':'rgba(240,192,64,.15)'};color:${sColor};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          ${p.status==='published'?'✅ Опубл.':'🟡 Черновик'}
        </button>
        <button onclick="playDBPack('${p.import_key}','${p.id}')"
          style="flex:1;padding:7px 0;border-radius:8px;border:none;background:rgba(108,99,255,.15);color:var(--accent2);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          ▶ Играть
        </button>
        <button onclick="adminEditGame('${p.id}','${p.import_key}')"
          style="flex:1;padding:7px 0;border-radius:8px;border:none;background:rgba(255,255,255,.06);color:var(--text);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          ✏️ Ред.
        </button>
        <button onclick="adminDeleteGame('${p.id}','${_esc(p.title_ru||p.import_key)}')"
          style="padding:7px 12px;border-radius:8px;border:none;background:rgba(220,50,50,.15);color:var(--red);font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
          🗑
        </button>
      </div>
    </div>`;
  }
  el.innerHTML = html || '<div style="color:var(--muted);font-size:12px">Нет игр</div>';
}

async function adminSetPackStatus(packId, newStatus){
  await sb.from('game_packs').update({status: newStatus}).eq('id', packId);
  loadAdminGames();
}

async function adminSetPackType(packId, newType){
  await sb.from('game_packs').update({pack_type: newType}).eq('id', packId);
}

async function adminDeleteGame(packId, title){
  if(!confirm(`Удалить игру «${title}»?\nЭто удалит все вопросы пака.`)) return;
  const SB_URL = window._supabaseUrl;
  const SB_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5obWlkeGtvaGpwY25oanVjdXVoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMzNzI3NSwiZXhwIjoyMDk0OTEzMjc1fQ.7KMc9cTJj9PfJFbMS0JUJTOY_QF5hhcrJo-72oV1mOo';
  const H = { 'apikey': SB_SVC, 'Authorization': 'Bearer ' + SB_SVC };
  await fetch(`${SB_URL}/rest/v1/game_pack_questions?game_pack_id=eq.${packId}`, { method: 'DELETE', headers: H });
  await fetch(`${SB_URL}/rest/v1/game_packs?id=eq.${packId}`, { method: 'DELETE', headers: H });
  toast('🗑 Игра удалена');
  loadAdminGames();
}

async function adminEditGame(packId, importKey){
  showScreen('game-creator');
  toast('⏳ Загружаем данные игры...');
  try {
    const SB_URL = window._supabaseUrl;
    const SB_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5obWlkeGtvaGpwY25oanVjdXVoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMzNzI3NSwiZXhwIjoyMDk0OTEzMjc1fQ.7KMc9cTJj9PfJFbMS0JUJTOY_QF5hhcrJo-72oV1mOo';
    const H = { 'apikey': SB_SVC, 'Authorization': 'Bearer ' + SB_SVC };

    // Load pack meta
    const pr = await fetch(`${SB_URL}/rest/v1/game_packs?id=eq.${packId}&select=*`, { headers: H });
    const packs = await pr.json();
    const pack = packs[0];

    // Load questions in order
    const lr = await fetch(`${SB_URL}/rest/v1/game_pack_questions?game_pack_id=eq.${packId}&select=question_id,position&order=position`, { headers: H });
    const links = await lr.json();
    const qids = links.map(l => `"${l.question_id}"`).join(',');
    const qr = await fetch(`${SB_URL}/rest/v1/questions?id=in.(${qids})&select=*`, { headers: H });
    const qrows = await qr.json();
    const posMap = Object.fromEntries(links.map(l => [l.question_id, l.position]));
    qrows.sort((a,b) => (posMap[a.id]||0) - (posMap[b.id]||0));

    // Build _gcData-compatible structure
    const _slideNum = url => { const m = (url||'').match(/slide[_-]?(\d+)\./i); return m ? parseInt(m[1],10) : null; };
    const questions = qrows.map((q, i) => ({
      sq: _slideNum(q.slide_img_url),
      sa: _slideNum(q.answer_slide_img_url),
      text: q.question_ru || q.question_text || '',
      media: q.audio_url || q.video_url || null,
      opts: Array.isArray(q.answers_json) ? q.answers_json : (JSON.parse(q.answers_json||'[]')),
      correct: q.correct_index ?? 0,
      question_type: q.question_type || 'multiple_choice',
    }));

    // Reconstruct slides from question image URLs for filmstrip
    const slideMap = new Map();
    qrows.forEach(q => {
      [q.slide_img_url, q.answer_slide_img_url].forEach(url => {
        if (!url) return;
        const m = url.match(/slide[_-]?(\d+)\./i);
        const n = m ? parseInt(m[1], 10) : null;
        if (n && !slideMap.has(n)) slideMap.set(n, { n, url });
      });
    });
    const slides = [...slideMap.values()].sort((a, b) => a.n - b.n);
    _gcData = { folder: importKey, slides, media: [], questions };

    setTimeout(() => {
      const nameEl = document.getElementById('gc-name');
      const codeEl = document.getElementById('gc-code');
      if(nameEl) nameEl.value = pack.title_ru || importKey;
      if(codeEl) codeEl.value = importKey.toUpperCase();

      // Show the loaded section and render filmstrip
      const gcLoaded = document.getElementById('gc-loaded');
      if(gcLoaded) gcLoaded.style.display = 'flex';
      const film = document.getElementById('gc-filmstrip');
      if(film) film.innerHTML = (_gcData.slides || []).map(s =>
        `<div style="flex-shrink:0;text-align:center">
           <img src="${s.url}" style="height:70px;border-radius:6px;display:block;cursor:pointer"
                onclick="gcFilmClick(${s.n})" title="Слайд ${s.n}">
           <div style="font-size:10px;color:var(--muted);margin-top:2px">${s.n}</div>
         </div>`
      ).join('');

      // Clear existing question cards
      _gcQCount = 0; _gcCorrect = {}; _gcOptCount = {};
      const container = document.getElementById('gc-questions');
      if(container) container.innerHTML = '';

      // Load questions into form
      for(let i = 0; i < questions.length; i++){
        const q = questions[i];
        gcAddQuestion();
        const qi = _gcQCount - 1;
        setTimeout(((qi,q) => () => {
          if(q.sq) { const el = document.getElementById(`gc-sq-${qi}`); if(el){ el.value = q.sq; gcUpdatePreview(qi,'q'); } }
          if(q.sa) { const el = document.getElementById(`gc-sa-${qi}`); if(el){ el.value = q.sa; gcUpdatePreview(qi,'a'); } }
          if(q.text) { const el = document.getElementById(`gc-qtxt-${qi}`); if(el) el.value = q.text; }
          if(q.media) { const el = document.getElementById(`gc-media-${qi}`); if(el) el.value = q.media; }
          (q.opts||[]).forEach((opt, ai) => {
            let el = document.getElementById(`gc-opt-txt-${qi}-${ai}`);
            if(!el){ gcAddOption(qi); el = document.getElementById(`gc-opt-txt-${qi}-${ai}`); }
            if(el && opt) el.value = opt;
          });
          if(q.correct !== null && q.correct !== undefined) gcSelectCorrect(qi, q.correct);
          if(q.question_type === 'info'){
            const optsEl = document.getElementById(`gc-opts-${qi}`);
            if(optsEl?.parentElement) optsEl.parentElement.style.display = 'none';
          }
        })(qi,q), 0);
      }
      toast(`✅ Загружено: ${questions.length} вопросов`);
    }, 300);
  } catch(e) {
    toast('❌ Ошибка загрузки: ' + e.message);
  }
}

async function loadAdminPacks(){
  const el = document.getElementById('admin-packs-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">⏳ Загрузка...</div>';
  // Only active (draft/published) packs — hide all archived/legacy
  const {data: packs} = await sb.from('game_packs')
    .select('id,import_key,title_ru,status,pack_type,source_type')
    .in('status', ['draft','published'])
    .order('title_ru');
  if(!packs || !packs.length){
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;text-align:center;padding:16px">Нет паков.<br><span style="font-size:11px">Добавьте через official_pack_10.csv</span></div>';
    return;
  }
  // For each pack count valid MC questions (via game_pack_questions)
  let rows = '';
  for(const p of packs){
    const {data: gpqs} = await sb.from('game_pack_questions').select('question_id').eq('game_pack_id', p.id);
    const ids = (gpqs||[]).map(r=>r.question_id);
    let qCount = 0;
    if(ids.length){
      const {count} = await sb.from('questions').select('*',{count:'exact',head:true})
        .in('id', ids).eq('question_type','multiple_choice')
        .not('status','in','(archived_unsupported,needs_reimport,archived)');
      qCount = count||0;
    }
    const sColor = p.status==='published'?'var(--green)':'var(--gold)';
    const qColor = qCount>=10?'var(--green)':qCount>0?'var(--gold)':'var(--red)';
    rows += `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid var(--border)">
      <div>
        <div style="font-size:13px;font-weight:700">${p.title_ru||p.import_key}</div>
        <div style="font-size:11px;color:var(--muted)">${p.import_key}</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:12px;font-weight:800;color:${qColor}">${qCount}/10</div>
        <div style="font-size:10px;color:${sColor}">${p.status}</div>
      </div>
    </div>`;
  }
  el.innerHTML = rows || '<div style="color:var(--muted);font-size:12px;padding:8px">Нет валидных паков</div>';
}

async function loadAdminCommunity(){
  const el = document.getElementById('admin-community-list');
  if(!el) return;
  el.innerHTML = '⏳ Загрузка...';
  const {data: qs} = await sb.from('questions')
    .select('id,question_ru,status,avg_rating,play_count,report_count,author_user_id,created_at')
    .eq('source_type','community')
    .not('status','in','(archived_unsupported,archived)')
    .order('avg_rating',{ascending:false})
    .limit(30);
  if(!qs || !qs.length){
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Пока нет вопросов участников.</div>';
    return;
  }
  el.innerHTML = qs.map(q=>{
    const statusColor = q.status==='community_published' ? 'var(--green)'
                      : q.status==='community_pending'   ? 'var(--gold)' : 'var(--muted)';
    return '<div style="padding:8px 0;border-bottom:0.5px solid var(--border)">'
      + '<div style="font-size:13px;font-weight:600;margin-bottom:3px">' + _esc((q.question_ru||'').slice(0,60)) + '…</div>'
      + '<div style="display:flex;gap:12px;font-size:11px;color:var(--muted)">'
      + '<span>⭐ ' + (q.avg_rating||0) + '</span>'
      + '<span>▶ ' + (q.play_count||0) + '</span>'
      + '<span style="color:' + ((q.report_count||0)>0?'var(--red)':'var(--muted)') + '">⚠ ' + (q.report_count||0) + '</span>'
      + '<span style="color:' + statusColor + '">' + _esc(q.status||'') + '</span>'
      + '</div></div>';
  }).join('');
}

async function loadTesterPackList(){
  const listEl = document.getElementById('tester-pack-list');
  if(!listEl) return;
  listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">⏳ Загрузка...</div>';

  // Load only valid packs — hide all legacy/archived
  const SHOW_STATUSES = ['draft','published'];
  const {data: allPacks} = await sb.from('game_packs')
    .select('id,import_key,title_ru,status,pack_type,source_type,render_mode')
    .in('status', SHOW_STATUSES)
    .order('title_ru');

  if(!allPacks || !allPacks.length){
    listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Пока нет валидных паков по 10 вопросов.<br>Импортируйте official_pack_10.csv.</div>';
    return;
  }

  // For each pack, count valid MC questions
  const validPacks = [];
  for(const pack of allPacks){
    const {count} = await sb.from('questions')
      .select('*', {count:'exact', head:true})
      .eq('question_type','multiple_choice')
      .not('status','in','(archived_unsupported,needs_reimport,archived)')
      .in('id',
        // subquery via game_pack_questions
        (await sb.from('game_pack_questions').select('question_id').eq('game_pack_id', pack.id)
        ).data?.map(r=>r.question_id) || []
      );
    const qCount = count || 0;
    if(qCount > 0) validPacks.push({...pack, validCount: qCount});
  }

  if(!validPacks.length){
    listEl.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px">Пока нет паков с вопросами.<br>Импортируйте official_pack_10.csv.</div>';
    return;
  }

  listEl.innerHTML = validPacks.map(p=>{
    const isComplete = p.validCount >= 10;
    const countColor = isComplete ? 'var(--green)' : 'var(--gold)';
    const statusBadge = p.status === 'published'
      ? '<span style="color:var(--green);font-weight:700">published</span>'
      : '<span style="color:var(--gold);font-weight:700">draft</span>';
    return `<button onclick="startTesterMode('pack','${p.import_key}')"
      style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px;
             font-size:13px;font-weight:700;color:var(--text);cursor:pointer;font-family:inherit;text-align:left;width:100%">
      🎯 ${p.title_ru||p.import_key}
      <span style="font-size:10px;margin-left:6px;color:${countColor}">${p.validCount}/10</span>
      <span style="font-size:10px;margin-left:6px">${statusBadge}</span>
    </button>`;
  }).join('');
}



function testerRender(){
  stopMedia();
  const q = testerQuestions[testerIdx];
  if(!q) return;
  testerAnswerShown = false;
  testerFlagActive = false;

  const total = testerQuestions.length;
  const reviewed = Object.keys(testerResults).length;
  const flagged = Object.values(testerResults).filter(r=>r.verdict==='fix').length;

  document.getElementById('tester-progress-txt').textContent =
    `${testerIdx+1}/${total} · ✏️${flagged}`;
  document.getElementById('tester-bar').style.width = ((testerIdx+1)/total*100)+'%';

  const ik = q._importKey||'';
  document.getElementById('tester-cat').textContent = q.cat;
  document.getElementById('tester-meta').textContent = [
    q._variants ? q._variants+' вар.' : '',
    (q._difficulty && q._difficulty > 1) ? 'сл.'+q._difficulty : '',
    q._status || '',
    q._renderMode && q._renderMode !== 'extracted_question' ? q._renderMode : '',
  ].filter(Boolean).join(' · ');
  document.getElementById('tester-key').textContent = ik;


  // Clean media render — battle view only (image_url / audio_url / video_url)
  const mediaEl = document.getElementById('tester-media');
  if(mediaEl){
    if(q.img || q.audio || q.video){
      mediaEl.innerHTML = '';
      renderQMedia('tester-media', q);
    } else {
      mediaEl.innerHTML = '<div style="padding:6px 0;font-size:12px;color:var(--muted)">📝 Текстовый вопрос</div>';
    }
  }

  const qEl = document.getElementById('tester-q-text');
  qEl.textContent = (!q.q||q.q==='(текст пустой)') ? '⚠️ Текст пустой' : q.q;
  qEl.style.color = (!q.q||q.q==='(текст пустой)') ? 'var(--red)' : '';

  const answersEl = document.getElementById('tester-answers');
  const qtype = q._questionType || 'multiple_choice';

  if(!q.a||!q.a.length){
    answersEl.innerHTML = '<div style="color:var(--red);font-size:13px">⚠️ Варианты ответа пустые</div>';
  } else {
    answersEl.innerHTML = q.a.map((a,i)=>`
      <div onclick="testerShowAnswer()" id="tester-ans-${i}" style="
        padding:10px 14px;border-radius:12px;font-size:13px;cursor:pointer;
        background:var(--bg2);border:0.5px solid ${i===q.c?'rgba(68,204,136,.25)':'var(--border)'};
        display:flex;gap:10px;align-items:center">
        <span style="width:22px;height:22px;border-radius:50%;background:${i===q.c?'rgba(68,204,136,.15)':'var(--bg3)'};
          display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;
          color:${i===q.c?'var(--green)':'var(--muted)'};flex-shrink:0">${answerLetter(i)}</span>
        <span>${a}</span>
        <span id="tester-mark-${i}" style="display:none;margin-left:auto;color:var(--green);font-size:11px;font-weight:800">✓</span>
      </div>`).join('');
  }

  // Fix 6: red warning if image required but missing
  if(q._mediaType==='image' && !q.img){
    answersEl.insertAdjacentHTML('afterbegin',`<div style="background:rgba(224,85,85,.1);border:0.5px solid var(--red);border-radius:10px;padding:10px;color:var(--red);font-size:12px;font-weight:700;margin-bottom:8px">⚠️ Нужна image_url, но картинка не задана. В боевую игру не попадёт.</div>`);
  }

  // No slide warnings — slides are optional in new model

  // Restore verdict state using new Good/Fix/Bad buttons
  const prevVerdict = testerResults[ik]?.verdict || null;
  _updateVerdictButtons(prevVerdict);
  const _nw = document.getElementById('tester-note-wrap');
  const _ne = document.getElementById('tester-note');
  const _vi = document.getElementById('tester-verdict-indicator');
  if(_nw) _nw.style.display = (prevVerdict==='fix'||prevVerdict==='bad') ? 'block' : 'none';
  if(_ne) _ne.value = testerResults[ik]?.note || '';
  if(_vi){
    const _vl = {good:'✅ Одобрено',fix:'🟡 На правку',bad:'❌ Плохой'};
    const _vc = {good:'var(--green)',fix:'var(--gold)',bad:'var(--red)'};
    _vi.textContent = prevVerdict ? (_vl[prevVerdict]||'') : '';
    _vi.style.color = prevVerdict ? (_vc[prevVerdict]||'var(--muted)') : 'var(--muted)';
  }

  document.getElementById('tester-summary-wrap').style.display = 'none';
  const nextBtn = document.getElementById('tester-next-btn');
  nextBtn.style.display = '';
  nextBtn.textContent = testerIdx < testerQuestions.length-1 ? 'Следующий →' : '📊 Итоги';
}

function testerShowAnswer(){
  if(testerAnswerShown) return;
  testerAnswerShown = true;
  const q = testerQuestions[testerIdx];
  for(let i=0;i<(q.a?.length||0);i++){
    const mark = document.getElementById(`tester-mark-${i}`);
    if(mark && i===q.c) mark.style.display='inline';
    const row = document.getElementById(`tester-ans-${i}`);
    if(row && i===q.c) row.style.background='rgba(68,204,136,.08)';
  }
}

// Current tester mode/pack context (for scoped publishing)
let _testerMode = 'general';
let _testerPackKey = null;

function testerSetVerdict(verdict){
  const q = testerQuestions[testerIdx];
  if(!q) return;
  const key = q._dbId || q._importKey || '';
  const note = document.getElementById('tester-note')?.value?.trim() || '';

  // Store by _dbId (same format as bulkVerdict) so publishGoodQuestions can find it
  testerResults[key] = {verdict, note, _id: q._dbId, _ik: q._importKey};

  // Save to DB (upsert by question_id+reviewer_id)
  saveTesterReview(q, verdict, note);

  // Update UI
  _updateVerdictButtons(verdict);
  const noteWrap = document.getElementById('tester-note-wrap');
  if(noteWrap) noteWrap.style.display = (verdict==='fix'||verdict==='bad') ? 'block' : 'none';
  const ind = document.getElementById('tester-verdict-indicator');
  if(ind){
    const labels = {good:'✅ Одобрено',fix:'🟡 На правку',bad:'❌ Плохой'};
    const colors = {good:'var(--green)',fix:'var(--gold)',bad:'var(--red)'};
    ind.textContent = labels[verdict]||'';
    ind.style.color = colors[verdict]||'var(--muted)';
  }

  // Auto-advance on good
  if(verdict === 'good'){
    setTimeout(()=>testerNext(), 300);
  }
}

function _updateVerdictButtons(activeVerdict){
  const styles = {
    good: 'rgba(68,204,136,.3)',
    fix:  'rgba(240,192,64,.3)',
    bad:  'rgba(224,85,85,.3)',
    skip: 'var(--border)',
  };
  ['good','fix','bad'].forEach(v=>{
    const btn = document.getElementById('tbtn-'+v);
    if(!btn) return;
    const isActive = v === activeVerdict;
    btn.style.borderWidth = isActive ? '2px' : '1px';
    btn.style.opacity = isActive ? '1' : '0.6';
    btn.style.transform = isActive ? 'scale(1.04)' : '';
  });
}

// Legacy alias
function testerToggleFlag(){ testerSetVerdict('fix'); }

async function saveTesterReview(q, verdict, note){
  if(!currentUser) return;
  try{
    const key = q._dbId || q._importKey || '';
    const {data, error} = await sb.from('question_reviews').upsert({
      question_id: q._dbId,
      import_key:  q._importKey,
      reviewer_id: currentUser.id,
      verdict,
      note: note||null,
      created_at: new Date().toISOString()
    },{onConflict:'question_id,reviewer_id'}).select().single();
    if(data && testerResults[key]){
      testerResults[key].db_id = data.id;
    }
  }catch(e){ console.warn('Review save error:', e); }
}

function testerNext(){
  const q = testerQuestions[testerIdx];
  // Save note if fix/bad verdict exists
  const note = document.getElementById('tester-note')?.value?.trim() || '';
  const key = (q && (q._dbId || q._importKey)) || '';
  const existing = testerResults[key];
  if(existing && (existing.verdict==='fix'||existing.verdict==='bad') && note && existing.note !== note){
    existing.note = note;
    saveTesterReview(q, existing.verdict, note);
  }
  // Skip just advances — no verdict saved
  if(testerIdx < testerQuestions.length-1){
    testerIdx++;
    testerRender();
  } else {
    testerShowSummary();
  }
}

function testerPrev(){
  if(testerIdx > 0){ testerIdx--; testerRender(); }
}

function testerShowSummary(){
  stopMedia();
  document.getElementById('tester-next-btn').style.display = 'none';
  document.getElementById('tester-summary-wrap').style.display = 'block';

  const all = Object.values(testerResults);
  const good = all.filter(r=>r.verdict==='good').length;
  const fix = all.filter(r=>r.verdict==='fix').length;
  const skipped = testerQuestions.length - all.length;
  const fixList = all.filter(r=>r.verdict==='fix');

  let html = `<div style="display:flex;gap:12px;margin-bottom:12px;text-align:center">
    <div style="flex:1"><div style="font-size:22px;font-weight:800;color:var(--green)">${good}</div><div style="font-size:10px;color:var(--muted)">ОК → опубликуется</div></div>
    <div style="flex:1"><div style="font-size:22px;font-weight:800;color:var(--gold)">${fix}</div><div style="font-size:10px;color:var(--muted)">ПРАВКА → draft</div></div>
    <div style="flex:1"><div style="font-size:22px;font-weight:800;color:var(--muted)">${skipped}</div><div style="font-size:10px;color:var(--muted)">ПРОПУЩЕНО</div></div>
  </div>`;

  if(fixList.length){
    html += '<div style="font-size:11px;font-weight:800;color:var(--gold);margin-bottom:6px">НУЖНА ПРАВКА:</div>';
    fixList.forEach(r=>{
      const q = testerQuestions.find(q=>q._importKey===r.import_key||testerResults[q._importKey]===r);
      const key = Object.keys(testerResults).find(k=>testerResults[k]===r)||'?';
      const noteHtml = r.note ? '<div style="color:var(--gold);margin-top:2px">💬 ' + _esc(r.note) + '</div>' : '';
      html += '<div style="padding:5px 0;border-bottom:0.5px solid var(--border);font-size:12px">'
        + '<div><b>✏️ ' + _esc(key) + '</b></div>'
        + noteHtml
        + '</div>';
    });
  }
  document.getElementById('tester-summary-content').innerHTML = html;
}

async function publishGoodQuestions(){
  if(!isAdmin()) return;

  // Collect good/fix/bad IDs from testerResults (keyed by _dbId or _importKey)
  const goodIds = [];
  const fixIds  = [];
  const badIds  = [];

  // First try from in-memory testerResults (keyed by _dbId)
  for(const [key, res] of Object.entries(testerResults)){
    if(!res._id) continue; // skip import_key-keyed entries without _id
    if(res.verdict === 'good') goodIds.push(res._id);
    else if(res.verdict === 'fix') fixIds.push(res._id);
    else if(res.verdict === 'bad') badIds.push(res._id);
  }

  // Scope to current tester questions if in pack/import mode
  const scopedIds = testerQuestions.map(q=>q._dbId).filter(Boolean);
  const scopedGoodIds = goodIds.filter(id=>scopedIds.includes(id));
  const scopedFixIds  = fixIds.filter(id=>scopedIds.includes(id));
  const scopedBadIds  = badIds.filter(id=>scopedIds.includes(id));

  const isScopedMode = (_testerMode === 'pack' && _testerPackKey) || _testerMode === 'import';

  const finalGoodIds = isScopedMode ? scopedGoodIds : goodIds;
  const finalFixIds  = isScopedMode ? scopedFixIds  : fixIds;
  const finalBadIds  = isScopedMode ? scopedBadIds  : badIds;

  if(!finalGoodIds.length){
    const hint = isScopedMode
      ? 'Нет одобренных вопросов в этом импорте.\nНажми "✅ Одобрить все видимые" сначала.'
      : 'Нет вопросов с вердиктом "good".\nОдобри вопросы в Тестере.';
    toast(hint, 3000);
    return;
  }

  const label = isScopedMode
    ? `${finalGoodIds.length} вопросов из текущего импорта`
    : `${finalGoodIds.length} одобренных вопросов`;

  if(!confirm(`Опубликовать ${label}?\nFix: ${finalFixIds.length} → status fix\nBad: ${finalBadIds.length} → status rejected`)) return;

  // Publish good questions
  const {error: pubErr, count: pubCount} = await sb.from('questions')
    .update({status:'published'})
    .in('id', finalGoodIds)
    .in('status', ['draft','tester','approved','fix']);
  if(pubErr){ toast('Ошибка публикации: '+pubErr.message); return; }

  // Mark fix questions
  if(finalFixIds.length){
    await sb.from('questions').update({status:'fix'}).in('id', finalFixIds);
  }
  // Mark bad questions as rejected
  if(finalBadIds.length){
    await sb.from('questions').update({status:'rejected'}).in('id', finalBadIds);
  }

  const published = finalGoodIds.length;
  toast(`✅ Опубликовано: ${published} · Fix: ${finalFixIds.length} · Rejected: ${finalBadIds.length}`);
}

function exportTesterResults(){
  const fixList = Object.entries(testerResults).filter(([k,v])=>v.verdict==='fix');
  const text = fixList.map(([k,v])=>`✏️ ${k}${v.note?' → '+v.note:''}`).join('\n');
  navigator.clipboard.writeText(text||'Замечаний нет ✅').catch(()=>{});
  toast('📋 Скопировано!');
}

function exitTester(){
  stopMedia();
  showScreen('home');
}

function testerBackToSelector(){
  stopMedia();
  document.getElementById('tester-pack-selector').style.display = 'flex';
  document.getElementById('tester-content').style.display = 'none';
  document.getElementById('tester-progress-txt').textContent = '';
  loadTesterPackList();
}

// Tester vote alias (legacy)
function testerVote(verdict){ testerToggleFlag(); }



// ═══════════════════════════════════════════
// QUIZ INTEGRITY (anti-cheat)
// ═══════════════════════════════════════════
let quizIntegrity = {
  active: false, mode: null, violations: 0,
  awayStartedAt: null, totalAwayMs: 0
};

function startIntegrity(mode){
  quizIntegrity = { active: true, mode, violations: 0, awayStartedAt: null, totalAwayMs: 0 };
}

function stopIntegrity(){
  quizIntegrity.active = false;
  quizIntegrity.awayStartedAt = null;
}

// ── Duel forfeit when player leaves page too long ─────────────
function forfeitDuelByBlur(awayMs){
  if(!quizIntegrity.active || quizIntegrity.mode !== 'duel') return;
  clearInterval(duelTimer);  duelTimer = null;
  clearInterval(duelPoll);   duelPoll  = null;
  if(window._botAnswerTimeout){ clearTimeout(window._botAnswerTimeout); window._botAnswerTimeout = null; }
  stopMedia();
  stopIntegrity();

  // Disable answer buttons
  document.querySelectorAll('#d-answers .ans').forEach(b=>{ b.disabled=true; b.style.opacity='0.5'; });

  // Forfeit: player score → 0, ensure opponent has at least some score
  duelMyScore  = 0;
  if(duelOppScore <= 0) duelOppScore = getFixedPoints((duelQs?.[duelIdx]?.a?.length) || 2);
  updateDuelScores();

  track('duel_forfeit_by_blur', {away_ms: awayMs, bot: !!window._isBotDuel});

  // Show result screen with forfeit state
  document.getElementById('d-result-icon').textContent  = '🚫';
  document.getElementById('d-result-title').textContent = lang==='ru' ? 'Поражение'            : 'Forfeit';
  document.getElementById('d-result-sub').textContent   = lang==='ru' ? 'Ты покинул страницу во время дуэли.' : 'You left the page during the duel.';
  document.getElementById('d-res-me-score').textContent  = duelMyScore;
  document.getElementById('d-res-opp-score').textContent = duelOppScore;
  document.getElementById('d-res-me-box').classList.remove('winner');
  document.getElementById('d-res-opp-box').classList.add('winner');
  showDuelSection('d-result');
}

function integrityViolation(reason){
  if(!quizIntegrity.active) return;
  quizIntegrity.violations++;
  const v = quizIntegrity.violations;
  track('quiz_integrity_warning', {mode: quizIntegrity.mode, violations: v, reason});

  if(quizIntegrity.mode === 'tournament'){
    if(v === 1){
      showIntegrityOverlay('⚠️ Предупреждение', 'Не переключайся между вкладками во время турнира. При повторном нарушении — дисквалификация.');
      track('quiz_tab_hidden', {mode:'tournament'});
    } else {
      // Disqualify: set flag, stop everything, write to DB
      otDisqualified = true;
      clearInterval(otTimerInt);
      stopMedia();
      stopIntegrity();
      document.querySelectorAll('#ot-answers .ans').forEach(b=>{ b.disabled=true; b.style.opacity='0.4'; });
      const nextBtn = document.getElementById('ot-next-btn');
      if(nextBtn) nextBtn.style.display = 'none';
      track('quiz_disqualified', {mode:'tournament'});
      showIntegrityOverlay('🚫 Дисквалификация', 'Ты покинул страницу во время турнира. Результат аннулирован. Нажми "Показать результаты" чтобы увидеть таблицу.', ()=>showOTFinished());
      if(currentUser && otData){
        sb.from('official_tournament_players').update({
          disqualified: true, score: 0, violations: v, total_away_ms: quizIntegrity.totalAwayMs
        }).eq('tournament_id', otData.id).eq('user_id', currentUser.id).then(()=>{}).catch(()=>{});
      }
    }
  } else if(quizIntegrity.mode === 'duel'){
    const awayMs = quizIntegrity.totalAwayMs;
    if(v === 1 && awayMs < 10000){
      // First offence under 10s — warn only
      toast('⚠️ ' + (lang==='ru'
        ? 'Не уходи со страницы! Ещё раз — засчитаем поражение.'
        : 'Stay on page! Next time it\'s a forfeit.'), 5000);
    } else if(awayMs > 10000 || v >= 2){
      // Second offence or >10s away — forfeit
      showIntegrityOverlay(
        '🚫 Поражение',
        lang==='ru'
          ? 'Ты покинул страницу во время дуэли. Бой засчитан как поражение.'
          : 'You left the page during the duel. Match forfeited.',
        ()=>forfeitDuelByBlur(awayMs)
      );
      forfeitDuelByBlur(awayMs);
    } else {
      toast('⚠️ ' + (lang==='ru' ? 'Не уходи со страницы во время дуэли!' : 'Stay on page during duel!'), 3000);
    }
  }
}

function showIntegrityOverlay(title, msg, onDismiss){
  const existing = document.getElementById('integrity-overlay');
  if(existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'integrity-overlay';
  el.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  const btnLabel = onDismiss
    ? (lang==='ru'?'Показать результаты':'Show results')
    : (lang==='ru'?'Понял':'OK');
  el.innerHTML = `<div style="background:var(--bg2);border:1px solid var(--red);border-radius:20px;padding:28px 20px;max-width:380px;width:100%;text-align:center">
    <div style="font-size:36px;margin-bottom:10px">🛡️</div>
    <div style="font-size:17px;font-weight:800;margin-bottom:8px;color:var(--red)">${title}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px;line-height:1.5">${msg}</div>
    <button id="integrity-dismiss-btn" style="background:var(--accent);border:none;border-radius:12px;padding:12px 24px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">${btnLabel}</button>
  </div>`;
  document.body.appendChild(el);
  document.getElementById('integrity-dismiss-btn').onclick = ()=>{
    el.remove();
    if(onDismiss) onDismiss();
  };
}

// Returns true only when an actual interactive game is in progress on screen.
// Prevents false "violation" toasts on menus, score screen, daily-limit, etc.
function shouldIntegrityBeActiveNow(){
  if(!quizIntegrity || !quizIntegrity.active) return false;
  const active = document.querySelector('.screen.active');
  const id = active ? active.id : '';
  if(id === 'quiz') return true;
  if(id === 'duel'){
    const battle = document.getElementById('d-battle');
    return !!(battle && battle.classList.contains('active'));
  }
  if(id === 'tournament'){
    const game = document.getElementById('t-game');
    return !!(game && game.classList.contains('active'));
  }
  if(id === 'official-tournament'){
    const play = document.getElementById('ot-play-section');
    return !!(play && play.style.display !== 'none');
  }
  return false;
}

// Event listeners for tab/window focus
document.addEventListener('visibilitychange', ()=>{
  if(!quizIntegrity.active) return;
  // Duel tab-switching is handled by _duelTabWarn in friend-battle.js — skip here
  if(quizIntegrity.mode === 'duel') return;
  if(document.hidden){
    if(!shouldIntegrityBeActiveNow()) return;
    quizIntegrity.awayStartedAt = Date.now();
    track('quiz_tab_hidden', {mode: quizIntegrity.mode});
  } else {
    if(quizIntegrity.awayStartedAt){
      const ms = Date.now() - quizIntegrity.awayStartedAt;
      quizIntegrity.totalAwayMs += ms;
      quizIntegrity.awayStartedAt = null;
      if(ms > 1500 && shouldIntegrityBeActiveNow()) integrityViolation('tab_hidden_'+ ms +'ms');
    }
  }
});

window.addEventListener('blur', ()=>{
  if(!quizIntegrity.active) return;
  if(quizIntegrity.mode === 'duel') return; // duel handled by _duelTabWarn
  if(!shouldIntegrityBeActiveNow()) return;
  if(!quizIntegrity.awayStartedAt) quizIntegrity.awayStartedAt = Date.now();
  track('quiz_window_blur', {mode: quizIntegrity.mode});
});

window.addEventListener('focus', ()=>{
  if(!quizIntegrity.active || !quizIntegrity.awayStartedAt) return;
  const ms = Date.now() - quizIntegrity.awayStartedAt;
  quizIntegrity.totalAwayMs += ms;
  quizIntegrity.awayStartedAt = null;
  if(ms > 2000 && shouldIntegrityBeActiveNow()) integrityViolation('window_blur_'+ ms +'ms');
});

// ═══════════════════════════════════════════
// CREATE QUESTION (community)
// ═══════════════════════════════════════════
let cqAnswerCount = 4;
let cqCorrectIdx = 0;

function showCreateQuestion(){
  showScreen('create-question');
  cqAnswerCount = 4; cqCorrectIdx = 0;
  cqRenderAnswers();
}

function cqRenderAnswers(){
  const container = document.getElementById('cq-answers');
  if(!container) return;
  container.innerHTML = '';
  for(let i=0; i<cqAnswerCount; i++){
    const isCorrect = i === cqCorrectIdx;
    const div = document.createElement('div');
    div.style.cssText='display:flex;gap:8px;align-items:center';
    div.innerHTML = `
      <button onclick="cqSetCorrect(${i})" style="
        width:28px;height:28px;border-radius:50%;flex-shrink:0;cursor:pointer;font-size:14px;
        background:${isCorrect?'var(--green)':'var(--bg3)'};
        border:2px solid ${isCorrect?'var(--green)':'var(--border)'};
        color:${isCorrect?'#fff':'var(--muted)'}">
        ${isCorrect?'✓':answerLetter(i)}
      </button>
      <input id="cq-ans-${i}" type="text" placeholder="Вариант ${i+1}..."
        oninput="cqUpdatePreview()"
        style="flex:1;background:var(--bg2);border:0.5px solid ${isCorrect?'var(--green)':'var(--border)'};border-radius:10px;
               padding:10px 12px;font-size:14px;color:var(--text);font-family:inherit;outline:none;
               border-width:${isCorrect?'1.5px':'0.5px'}">`;
    container.appendChild(div);
  }
  cqUpdatePreview();
}

function cqSetCorrect(idx){ cqCorrectIdx=idx; cqRenderAnswers(); }
function cqAddAnswer(){ if(cqAnswerCount<6){cqAnswerCount++;cqRenderAnswers();} }
function cqRemoveAnswer(){ if(cqAnswerCount>2){if(cqCorrectIdx>=cqAnswerCount-1)cqCorrectIdx=cqAnswerCount-2;cqAnswerCount--;cqRenderAnswers();} }

function _esc(str){
  // Escape HTML special chars to prevent XSS in innerHTML
  return String(str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function cqUpdatePreview(){
  const qtext = document.getElementById('cq-text')?.value?.trim();
  const preview = document.getElementById('cq-preview');
  if(!preview) return;
  if(!qtext){ preview.innerHTML='<div style="color:var(--muted);font-size:13px">Заполни вопрос выше...</div>'; return; }
  const answers = [];
  for(let i=0;i<cqAnswerCount;i++){
    const v = document.getElementById('cq-ans-'+i)?.value?.trim();
    if(v) answers.push({text:v, correct:i===cqCorrectIdx});
  }
  let html = '<div style="font-size:15px;font-weight:700;margin-bottom:10px">' + _esc(qtext) + '</div>';
  answers.forEach(function(a, i){
    html += '<div style="padding:8px 12px;border-radius:10px;font-size:13px;margin-bottom:6px;'
      + 'background:' + (a.correct?'rgba(68,204,136,.12)':'var(--bg3)') + ';'
      + 'border:0.5px solid ' + (a.correct?'var(--green)':'var(--border)') + ';'
      + 'color:' + (a.correct?'var(--green)':'var(--text)') + '">'
      + '<b>' + answerLetter(i) + '</b> ' + _esc(a.text) + (a.correct?' ✓':'')
      + '</div>';
  });

  // Show media preview chip if file selected
  const mf = _cqMediaFile;
  if(mf){
    const icon = mf.type.startsWith('video')?'🎬':mf.type.startsWith('audio')?'🎵':'🖼';
    html += '<div style="font-size:11px;color:var(--accent2);margin-top:6px">' + icon + ' ' + _esc(mf.name) + '</div>';
  }
  preview.innerHTML = html;
}

// Media file for single create-question form
var _cqMediaFile = null;

function cqHandleMedia(input){
  var file = input.files && input.files[0];
  if(!file) return;
  _cqMediaFile = file;
  var preview = document.getElementById('cq-media-preview');
  if(preview){
    var icon = file.type.startsWith('video')?'🎬':file.type.startsWith('audio')?'🎵':'🖼';
    preview.textContent = icon + ' ' + file.name + ' (' + Math.round(file.size/1024) + 'KB)';
    preview.style.display = 'block';
  }
  cqUpdatePreview();
}

async function submitCommunityQuestion(){
  if(!currentUser){ toast('Войдите чтобы создавать вопросы'); return; }
  const qtext = document.getElementById('cq-text')?.value?.trim();
  if(!qtext || qtext.length < 5){ toast('Напишите текст вопроса'); return; }
  const answers = [];
  for(let i=0;i<cqAnswerCount;i++){
    const v = document.getElementById('cq-ans-'+i)?.value?.trim();
    if(!v){ toast('Заполните вариант ' + (i+1)); return; }
    answers.push(v);
  }
  if(!answers[cqCorrectIdx]){ toast('Выберите правильный ответ'); return; }
  const expl = document.getElementById('cq-explanation')?.value?.trim()||'';
  const cat  = document.getElementById('cq-category')?.value||'GENERAL';

  // Upload media if present
  let mediaType = null, imageUrl = null, audioUrl = null, videoUrl = null;
  if(_cqMediaFile){
    toast('🖼 Загружаем медиа...');
    try{
      const mfname = 'community/' + currentUser.id.slice(0,8) + '_' + Date.now() + '_' + _cqMediaFile.name;
      const upRes  = await sb.storage.from('mfc-media').upload(mfname, _cqMediaFile, {upsert:true});
      if(upRes.data){
        const urlRes = sb.storage.from('mfc-media').getPublicUrl(mfname);
        const url    = urlRes.data && urlRes.data.publicUrl;
        mediaType    = _cqMediaFile.type.startsWith('video') ? 'video'
                     : _cqMediaFile.type.startsWith('audio') ? 'audio' : 'image';
        if(mediaType==='image')  imageUrl = url;
        if(mediaType==='audio')  audioUrl = url;
        if(mediaType==='video')  videoUrl = url;
      }
    }catch(e){ console.warn('[MFC] cq media upload:', e.message); }
  }

  toast('📤 Отправляем вопрос...');
  const {error} = await sb.from('questions').insert({
    question_text:  qtext, question_ru: qtext, question_en: qtext,
    answers_json:   answers, answers_ru: answers,
    correct_index:  cqCorrectIdx,
    explanation_ru: expl,
    category:       cat, difficulty: 1,
    source_type:    'community',
    author_user_id: currentUser.id,
    status:         'community_pending',
    question_type:  'multiple_choice',
    media_type:     mediaType,
    image_url:      imageUrl,
    audio_url:      audioUrl,
    video_url:      videoUrl,
    import_key:     'community_' + currentUser.id.slice(0,8) + '_' + Date.now(),
    created_at:     new Date().toISOString(),
  });
  if(error){ toast('Ошибка: '+error.message); return; }
  toast('✅ Вопрос отправлен на проверку!');
  track('community_question_created', {cat});
  _cqMediaFile = null;
  // Reset form
  const qt = document.getElementById('cq-text');
  const mp = document.getElementById('cq-media-preview');
  if(qt) qt.value = '';
  if(mp){ mp.textContent=''; mp.style.display='none'; }
  showScreen('home');
}

// ═══════════════════════════════════════════
// COMMUNITY FEED
// ═══════════════════════════════════════════
let _cfQuestions = [];
let _cfIdx = 0;

async function startCommunityFeed(){
  showScreen('community-feed');
  document.getElementById('cf-loading').style.display='block';
  document.getElementById('cf-empty').style.display='none';

  // Load community questions not yet played by user
  let query = sb.from('questions')
    .select('*')
    .eq('source_type','community')
    .eq('status','community_published')
    .limit(20);

  // Exclude already played if logged in
  if(currentUser){
    const {data: played} = await sb.from('community_question_plays')
      .select('question_id').eq('user_id',currentUser.id);
    const playedIds = (played||[]).map(p=>p.question_id);
    if(playedIds.length) query = query.not('id','in','('+playedIds.join(',')+')');
  }

  const {data} = await query;
  document.getElementById('cf-loading').style.display='none';

  if(!data || !data.length){
    document.getElementById('cf-empty').style.display='block';
    return;
  }

  _cfQuestions = data.map(q=>({
    cat: q.category||'GENERAL',
    q: q.question_ru||q.question_text,
    a: q.answers_ru||q.answers_json||[],
    c: q.correct_index||0, t:20,
    img: q.media_type==='image'?q.image_url:null,
    audio: q.audio_url, video: q.video_url,
    explanation_ru: q.explanation_ru,
    _id: q.id, _importKey: q.import_key,
    _questionType: 'multiple_choice',
    status: q.status||'community_published',
    media: {type: q.media_type||'none', url: q.image_url||q.audio_url||q.video_url||'', filename:'', placeholder:''},
    _source: 'community',
  }));

  // Filter out unplayable questions
  _cfQuestions = filterPlayableQuestions(_cfQuestions, {logBad: true});

  // Guard: if nothing left after filtering, show empty state
  if(!_cfQuestions.length){
    document.getElementById('cf-loading').style.display='none';
    document.getElementById('cf-empty').style.display='block';
    toast(lang==='ru' ? '⚠️ Нет пригодных вопросов участников' : '⚠️ No playable community questions', 2500);
    return;
  }

  // Play as regular quiz but from community pool
  currentGameType = 'community';
  currentPackKey  = null;
  curQ = _cfQuestions;
  qIdx=0; correctCount=0; streak=0; bestStreak=0; _roundScore=0;
  _gameStartTime=Date.now(); _gameId=null;
  buildDots('prog-dots', curQ.length);
  track('community_feed_started', {count: curQ.length});
  createGameRow('community');
  _currentGameCountsDailyLimit = false; // community feed doesn't count toward daily limit
  showScreen('quiz'); loadQ();
}
// ═══════════════════════════════════════════
function checkOnboarding(){
  const done = localStorage.getItem('mfc_onboarded');
  if(!done){
    showScreen('onboarding');
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════
// VK AUTH
// ═══════════════════════════════════════════
// VK auth is handled by auth.js (window.signInVK set there)

// Show VK button only if enabled
(function(){
  const vkBtn = document.getElementById('vk-login-btn');
  if(vkBtn && typeof VK_LOGIN_ENABLED !== 'undefined' && VK_LOGIN_ENABLED){
    vkBtn.style.display = 'flex';
  }
})();

// Listen for VK callback message
window.addEventListener('message', (ev)=>{
  if(ev.data?.type === 'vk_auth_success' && ev.data.session){
    sb.auth.setSession(ev.data.session).then(({data})=>{
      if(data.user){ toast('✅ Вход через VK выполнен!'); if (typeof window.initAuth === 'function') window.initAuth(); }
    });
  }
});

// ═══════════════════════════════════════════
// ANALYTICS EVENT LABELS (human-readable)
// ═══════════════════════════════════════════
const EVENT_LABELS_RU = {
  quiz_started: 'Игра начата',
  quiz_completed: 'Игра завершена',
  question_answered: 'Ответ дан',
  result_viewed: 'Результат просмотрен',
  quiz_tab_hidden: 'Уход со вкладки',
  quiz_window_blur: 'Потеря фокуса',
  quiz_integrity_warning: 'Предупреждение о честности',
  play_menu_viewed: 'Меню игры открыто',
  app_opened: 'Приложение открыто',
  pack_started: 'Пак запущен',
  pack_played: 'Пак сыгран',
  daily_completed: 'Задание дня выполнено',
  duel_created: 'Дуэль создана',
  duel_joined: 'Дуэль: вход',
  duel_completed: 'Дуэль завершена',
  invite_clicked: 'Ссылка скопирована',
  official_tournament_completed: 'Турнир завершён',
  quiz_disqualified: 'Дисквалификация',
};
function eventLabel(name){ return (lang==='ru' && EVENT_LABELS_RU[name]) ? EVENT_LABELS_RU[name] : name; }
// ═══════════════════════════════════════════
// TEAMS
// ═══════════════════════════════════════════
let myTeam = JSON.parse(localStorage.getItem('mfc_team')||'null');
let cityTabMode = 'teams'; // 'teams' или 'players'

function showCreateTeam(){
  ['team-none','team-mine'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  });
  const createEl=document.getElementById('team-create');
  createEl.style.display='flex';
  document.getElementById('team-name-input').value='';
  document.getElementById('team-city-input').value=localStorage.getItem('mfc_city')||'';
}

function cancelCreateTeam(){
  document.getElementById('team-create').style.display='none';
  if(myTeam){
    document.getElementById('team-mine').style.display='flex';
  } else {
    document.getElementById('team-none').style.display='flex';
  }
}

async function createTeam(){
  const name = document.getElementById('team-name-input').value.trim();
  if(!name){toast(lang==='ru'?'Введите название команды':'Enter team name');return;}
  if(!currentUser){toast(lang==='ru'?'Войдите чтобы создать команду':'Sign in to create a team');return;}

  const city = document.getElementById('team-city-input').value.trim();
  const emoji = document.getElementById('team-emoji-select').value;
  const code = Math.random().toString(36).slice(2,8).toUpperCase();

  const btn = document.getElementById('tc-confirm-btn');
  btn.textContent = lang==='ru'?'Создаём...':'Creating...';
  btn.disabled = true;

  // Insert into teams_v2 (new clean schema)
  const {data: teamData, error: teamErr} = await sb.from('teams_v2').insert({
    name, code, city, avatar_emoji: emoji,
    created_by: currentUser.id, total_score: 0,
    created_at: new Date().toISOString()
  }).select().single();

  if(teamErr){
    btn.disabled = false; btn.textContent = lang==='ru'?'Создать →':'Create →';
    toast((lang==='ru'?'Ошибка: ':'Error: ')+(teamErr.message||'try again'));
    console.error('Team create error:', teamErr);
    return;
  }

  // Add creator as captain in team_members
  await sb.from('team_members').insert({
    team_id: teamData.id, user_id: currentUser.id,
    team_code: code,
    display_name: currentUser.user_metadata?.full_name?.split(' ')[0] || currentUser.email?.split('@')[0] || 'Игрок',
    role: 'captain', score: neurons, joined_at: new Date().toISOString()
  });

  myTeam = {...teamData, _v2: true};
  btn.disabled = false; btn.textContent = lang==='ru'?'Создать →':'Create →';
  if(city) localStorage.setItem('mfc_city', city);
  localStorage.setItem('mfc_team', JSON.stringify(myTeam));
  track('team_created', {team_code: code, city});
  renderMyTeam();
  toast(lang==='ru'?'🎉 Команда создана!':'🎉 Team created!');
}

async function joinTeam(){
  const code = document.getElementById('team-join-input').value.trim().toUpperCase();
  if(code.length < 4){toast(lang==='ru'?'Введите код команды':'Enter team code');return;}

  // Try teams_v2 first
  const {data: v2data} = await sb.from('teams_v2').select('*').eq('code', code).single();
  if(v2data){
    if(currentUser){
      await sb.from('team_members').upsert({
        team_id: v2data.id, user_id: currentUser.id,
        team_code: code,
        display_name: currentUser.user_metadata?.full_name?.split(' ')[0] || currentUser.email?.split('@')[0] || 'Игрок',
        role: 'member', score: neurons, joined_at: new Date().toISOString()
      }, {onConflict: 'team_id,user_id'});
    }
    track('team_joined', {team_code: code});
    myTeam = {...v2data, _v2: true};
    localStorage.setItem('mfc_team', JSON.stringify(myTeam));
    renderMyTeam();
    toast(lang==='ru'?'Вы вступили в команду '+v2data.name+'!':'Joined '+v2data.name+'!');
    return;
  }

  // Fallback: old teams table
  const {data, error} = await sb.from('teams').select('*').eq('code', code).single();
  if(error||!data){toast(lang==='ru'?'Команда не найдена':'Team not found');return;}
  const memberName = currentUser?.user_metadata?.full_name?.split(' ')[0] || 'Игрок';
  const members = data.members||{};
  members[memberName] = {neurons, joined: new Date().toISOString()};
  await sb.from('teams').update({members}).eq('code', code);
  myTeam = {...data, members};
  localStorage.setItem('mfc_team', JSON.stringify(myTeam));
  renderMyTeam();
  toast(lang==='ru'?'Вы вступили в команду '+data.name+'!':'Joined '+data.name+'!');
}

function renderMyTeam(){
  ['team-none','team-mine','team-create'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.style.display='none';
  });
  if(!myTeam){
    document.getElementById('team-none').style.display='flex';
    loadGlobalTeams();
    return;
  }
  document.getElementById('team-mine').style.display='flex';
  // Update emoji without destroying the ✏️ edit badge child
  const _emojiEl = document.getElementById('my-team-emoji');
  if(_emojiEl){
    const _badge = _emojiEl.querySelector('div');
    _emojiEl.textContent = myTeam.avatar_emoji||myTeam.emoji||'⚡';
    if(_badge) _emojiEl.appendChild(_badge);
  }
  document.getElementById('my-team-name').textContent = myTeam.name;
  document.getElementById('my-team-code').textContent = 'Code: '+myTeam.code;
  const cityEl = document.getElementById('my-team-city');
  if(cityEl) cityEl.textContent = myTeam.city ? '📍 '+myTeam.city : '';

  // Always load fresh members from DB
  loadTeamMembers();
  loadGlobalTeams();
}

async function loadTeamMembers(){
  if(!myTeam) return;
  const list = document.getElementById('team-members-list');
  const scoreEl = document.getElementById('my-team-score');
  const countEl = document.getElementById('my-team-count');

  // Try new schema: team_members table
  if(myTeam.id){
    const {data: members} = await sb.from('team_members')
      .select('display_name,score,role,user_id')
      .eq('team_id', myTeam.id)
      .order('score', {ascending:false});

    if(members && members.length){
      const total = members.reduce((s,m)=>s+(m.score||0),0);
      if(scoreEl) scoreEl.textContent = total;
      if(countEl) countEl.textContent = members.length;
      if(list) list.innerHTML = members.map((m,i)=>{
        const name = m.display_name||'Игрок';
        const isMe = currentUser && m.user_id === currentUser.id;
        const roleIcon = m.role==='captain'?'👑':'';
        return '<div class="lb-row'+(isMe?' me':'')+'"><div class="lb-rank">'+(i+1)+'</div><div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+name[0].toUpperCase()+'</div><div class="lb-name">'+roleIcon+name+'</div><div class="lb-score">'+(m.score||0)+'</div></div>';
      }).join('');
      // Also update teams_v2 total_score directly (trigger may not exist yet)
      await sb.from('teams_v2').update({total_score: total}).eq('id', myTeam.id);
      return;
    }
  }

  // Fallback: old members json
  const members = myTeam.members||{};
  const sorted = Object.entries(members).sort((a,b)=>(b[1].neurons||0)-(a[1].neurons||0));
  const totalNeurons = sorted.reduce((s,[,d])=>s+(d.neurons||0),0);
  if(scoreEl) scoreEl.textContent = totalNeurons;
  if(countEl) countEl.textContent = sorted.length;
  if(list) list.innerHTML = sorted.map(([name,d],i)=>{
    const isMe = name===(currentUser?.user_metadata?.full_name?.split(' ')[0]||'Игрок');
    return '<div class="lb-row'+(isMe?' me':'')+'"><div class="lb-rank">'+(i+1)+'</div><div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+name[0].toUpperCase()+'</div><div class="lb-name">'+name+'</div><div class="lb-score">'+(d.neurons||0)+'</div></div>';
  }).join('');
}

async function updateTeamNeurons(){
  if(!myTeam||!currentUser) return;
  const displayName = currentUser.user_metadata?.full_name?.split(' ')[0]||currentUser.email?.split('@')[0]||'Игрок';

  if(myTeam.id){
    // New schema — upsert into team_members
    const {error} = await sb.from('team_members').upsert({
      team_id: myTeam.id,
      user_id: currentUser.id,
      team_code: myTeam.code,
      display_name: displayName,
      score: neurons,
      role: myTeam.created_by===currentUser.id ? 'captain' : 'member'
    }, {onConflict: 'team_id,user_id'});
    if(!error){
      // Update teams_v2 total_score
      const {data: members} = await sb.from('team_members').select('score').eq('team_id', myTeam.id);
      if(members){
        const total = members.reduce((s,m)=>s+(m.score||0),0);
        await sb.from('teams_v2').update({total_score: total}).eq('id', myTeam.id);
      }
      return;
    }
  }

  // Old schema fallback
  const {data} = await sb.from('teams').select('members').eq('code',myTeam.code).single();
  if(!data) return;
  const members = data.members||{};
  members[displayName] = {neurons, joined: members[displayName]?.joined||new Date().toISOString()};
  await sb.from('teams').update({members}).eq('code',myTeam.code);
  myTeam.members = members;
  localStorage.setItem('mfc_team', JSON.stringify(myTeam));
}

function switchCityTab(mode){
  cityTabMode = mode;
  track('leaderboard_viewed', {tab: mode});
  document.getElementById('city-tab-teams').classList.toggle('active', mode==='teams');
  document.getElementById('city-tab-players').classList.toggle('active', mode==='players');
  const weekTab = document.getElementById('city-tab-week');
  if(weekTab) weekTab.classList.toggle('active', mode==='week');
  loadGlobalTeams();
}

async function loadGlobalTeams(){
  const el = document.getElementById('global-teams-lb');
  if(!el) return;
  el.innerHTML = '<div style="padding:16px;text-align:center;color:var(--muted);font-size:12px">Загрузка...</div>';

  // ── WEEK TAB ──────────────────────────────
  if(cityTabMode === 'week'){
    const key = getSeasonKey();
    const weekDate = key.replace('season_','');
    const {data, error} = await sb.from('season_scores')
      .select('user_id,points,city')
      .eq('season_key', key)
      .order('points',{ascending:false})
      .limit(20);

    if(error || !data || !data.length){
      const local = getSeasonPoints();
      el.innerHTML = '<div style="padding:14px;text-align:center">'
        +'<div style="font-size:11px;color:var(--muted);margin-bottom:8px">Week of '+weekDate+'</div>'
        +'<div class="lb-row me"><div class="lb-rank">—</div>'
        +'<div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+(currentUser?currentUser.email[0].toUpperCase():'?')+'</div>'
        +'<div class="lb-name">'+(lang==='ru'?'Вы':'You')+'</div>'
        +'<div class="lb-score me">'+(local.points||0)+' pts</div></div></div>';
      return;
    }

    const medals=['🥇','🥈','🥉'];
    el.innerHTML = '<div style="padding:6px 14px 4px;font-size:10px;color:var(--muted);letter-spacing:1px">🏅 '+(lang==='ru'?'Неделя':'Week')+' '+weekDate+'</div>'
      + data.map((row,i)=>{
        const isMe = currentUser && row.user_id === currentUser.id;
        const name = isMe ? (currentUser.user_metadata?.full_name?.split(' ')[0]||currentUser.email?.split('@')[0]||'You') : 'Игрок';
        const cityTag = row.city ? '<span class="lb-city-tag">'+row.city+'</span>' : '';
        return '<div class="lb-row'+(isMe?' me':'')+'"><div class="lb-rank">'+(medals[i]||i+1)+'</div><div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+name[0].toUpperCase()+'</div><div class="lb-name">'+name+cityTag+'</div><div class="lb-score'+(isMe?' me':'')+'">'+row.points+' pts</div></div>';
      }).join('');
    return;
  }

  if(cityTabMode === 'teams'){
    // Try teams_v2 (new schema)
    const {data, error} = await sb.from('teams_v2')
      .select('id,name,avatar_emoji,code,city,total_score')
      .order('total_score', {ascending:false})
      .limit(20);

    if(error || !data || !data.length){
      // Fallback: old schema with members json
      const {data: old} = await sb.from('teams').select('name,emoji,members,code,city').limit(20);
      if(!old || !old.length){
        el.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">'+(lang==='ru'?'Пока нет команд — создайте первую!':'No teams yet — create the first!')+'</div>';
        return;
      }
      const sorted = old.map(t=>({
        ...t, avatar_emoji: t.emoji,
        total: Object.values(t.members||{}).reduce((s,m)=>s+(m.neurons||0),0),
        count: Object.keys(t.members||{}).length
      })).sort((a,b)=>b.total-a.total);
      const medals=['🥇','🥈','🥉'];
      el.innerHTML = sorted.map((t,i)=>{
        const isMyTeam = myTeam&&t.code===myTeam.code;
        const cityTag = t.city?'<span class="lb-city-tag">'+t.city+'</span>':'';
        return '<div class="lb-row'+(isMyTeam?' me':'')+'"><div class="lb-rank">'+(medals[i]||i+1)+'</div><div style="font-size:18px;flex-shrink:0">'+(t.avatar_emoji||'⚡')+'</div><div class="lb-name">'+t.name+cityTag+'<div style="font-size:10px;color:var(--muted)">'+t.count+' members</div></div><div class="lb-score">'+t.total+'</div></div>';
      }).join('');
      return;
    }

    // New schema with team_members count
    const medals=['🥇','🥈','🥉'];
    el.innerHTML = data.map((t,i)=>{
      const isMyTeam = myTeam&&t.code===myTeam.code;
      const cityTag = t.city?'<span class="lb-city-tag">'+t.city+'</span>':'';
      return '<div class="lb-row'+(isMyTeam?' me':'')+'"><div class="lb-rank">'+(medals[i]||i+1)+'</div><div style="font-size:18px;flex-shrink:0">'+(t.avatar_emoji||'⚡')+'</div><div class="lb-name">'+t.name+cityTag+'</div><div class="lb-score">'+(t.total_score||0)+'</div></div>';
    }).join('');

  } else if(cityTabMode === 'players') {
    const {data, error} = await sb.from('profiles')
      .select('id,display_name,city,total_score')
      .order('total_score', {ascending:false})
      .limit(20);

    const rows = (!error && data && data.length) ? data : null;

    if(!rows){
      // Fallback to user_profiles
      const {data: old} = await sb.from('user_profiles')
        .select('id,display_name,city,neurons')
        .order('neurons', {ascending:false})
        .limit(20);
      if(!old||!old.length){
        el.innerHTML='<div style="padding:20px;text-align:center;color:var(--muted);font-size:13px">'+(lang==='ru'?'Нет данных':'No data yet')+'</div>';
        return;
      }
      const medals=['🥇','🥈','🥉'];
      el.innerHTML = old.map((p,i)=>{
        const isMe = currentUser&&p.id===currentUser.id;
        const cityTag = p.city?'<span class="lb-city-tag">'+p.city+'</span>':'';
        const name = p.display_name||'Игрок';
        return '<div class="lb-row'+(isMe?' me':'')+'"><div class="lb-rank">'+(medals[i]||i+1)+'</div><div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+name[0].toUpperCase()+'</div><div class="lb-name">'+name+cityTag+'</div><div class="lb-score'+(isMe?' me':'')+'">'+p.neurons+'</div></div>';
      }).join('');
      return;
    }

    const medals=['🥇','🥈','🥉'];
    el.innerHTML = rows.map((p,i)=>{
      const isMe = currentUser&&p.id===currentUser.id;
      const cityTag = p.city?'<span class="lb-city-tag">'+p.city+'</span>':'';
      const name = p.display_name||'Игрок';
      return '<div class="lb-row'+(isMe?' me':'')+'"><div class="lb-rank">'+(medals[i]||i+1)+'</div><div class="lb-av" style="background:rgba(108,99,255,.15);color:var(--accent2)">'+name[0].toUpperCase()+'</div><div class="lb-name">'+name+cityTag+'</div><div class="lb-score'+(isMe?' me':'')+'">'+p.total_score+'</div></div>';
    }).join('');
  }
}

function copyTeamCode(){
  if(!myTeam) return;
  const link = location.origin+location.pathname+'?team='+myTeam.code;
  navigator.clipboard.writeText(link).catch(()=>{});
  track('invite_clicked', {type: 'team', code: myTeam.code});
  toast(lang==='ru'?'Ссылка скопирована! 🔗':'Link copied! 🔗');
}

function leaveTeam(){
  myTeam = null;
  localStorage.removeItem('mfc_team');
  renderMyTeam();
  toast(lang==='ru'?'Вы покинули команду':'You left the team');
}

// showTeamsScreen is called from nav - goes to screen then renders
function showTeamsScreen(){
  showScreen('teams');
}

function renderTeamsScreen(){
  renderMyTeam();
  document.getElementById('th-title').textContent = lang==='ru'?'Команды':'Teams';
  document.getElementById('th-sub').textContent = lang==='ru'?'Создай команду с городом и соревнуйтесь в городской лиге.':'Create a city team and compete in the city league.';
  document.getElementById('t-create-team-btn').textContent = lang==='ru'?'⚡ Создать команду':'⚡ Create a team';
  document.getElementById('t-team-или').textContent = lang==='ru'?'или вступить в существующий':'или вступить в существующий';
  document.getElementById('t-join-team-btn').textContent = lang==='ru'?'Войти →':'Join →';
  document.getElementById('team-join-input').placeholder = lang==='ru'?'Код команды':'Team code';
  document.getElementById('tc-title').textContent = lang==='ru'?'Создать команду':'Create Team';
  const tcSub = document.getElementById('tc-sub');
  if(tcSub) tcSub.textContent = lang==='ru'?'Команда появится в городском рейтинге':'Team will appear in city leaderboard';
  document.getElementById('team-name-input').placeholder = lang==='ru'?'Название (напр. Питерские Нейроны)':'Team name (e.g. Miami Sharks)';
  document.getElementById('team-city-input').placeholder = lang==='ru'?'Город (напр. Санкт-Петербург)':'City (e.g. Miami)';
  document.getElementById('tc-confirm-btn').textContent = lang==='ru'?'Создать →':'Create →';
  document.getElementById('tc-cancel-btn').textContent = lang==='ru'?'← Отмена':'← Cancel';
  document.getElementById('tm-invite-btn').textContent = lang==='ru'?'🔗 Пригласить друзей':'🔗 Invite friends';
  document.getElementById('tm-leave-btn').textContent = lang==='ru'?'Покинуть команду':'Leave team';
  document.getElementById('tm-members-label').textContent = lang==='ru'?'Участники':'Members';
  const tgt = document.getElementById('t-global-title'); if (tgt) tgt.textContent = lang==='ru'?'🌆 Городской рейтинг':'🌆 City Leaderboard';
  document.getElementById('nav-teams-label').textContent = 'Команда';
  document.getElementById('n-teams').textContent = neurons;
  document.getElementById('city-tab-teams').textContent = lang==='ru'?'Команды':'Teams';
  document.getElementById('city-tab-players').textContent = lang==='ru'?'Игроки':'Players';

  // Render weekly competition banner
  renderTeamCompetitionBanner();
}

async function renderTeamCompetitionBanner(){
  // Find or create banner container in the teams inner
  let banner = document.getElementById('team-competition-banner');
  if(!banner){
    banner = document.createElement('div');
    banner.id = 'team-competition-banner';
    const inner = document.querySelector('.teams-inner');
    if(inner) inner.prepend(banner);
    else return;
  }

  // Compute season end (next Monday 00:00 UTC)
  const now = new Date();
  const msUntilMonday = ((8 - now.getUTCDay()) % 7 || 7) * 86400000
    - now.getUTCHours()*3600000 - now.getUTCMinutes()*60000 - now.getUTCSeconds()*1000;
  const days    = Math.floor(msUntilMonday / 86400000);
  const hours   = Math.floor((msUntilMonday % 86400000) / 3600000);
  const mins    = Math.floor((msUntilMonday % 3600000) / 60000);
  const timeStr = days > 0 ? `${days}д ${hours}ч` : `${hours}ч ${mins}м`;

  // Load top 2 teams for the rivalry display
  let rivalry = '';
  try{
    const {data: topTeams} = await sb.from('teams')
      .select('name,city,weekly_score,total_score')
      .order('weekly_score', {ascending:false})
      .limit(2);
    if(topTeams && topTeams.length >= 2){
      const t1 = topTeams[0]; const t2 = topTeams[1];
      rivalry = `
        <div style="display:flex;align-items:center;justify-content:space-between;margin:10px 0;gap:8px">
          <div style="text-align:center;flex:1">
            <div style="font-size:14px;font-weight:800;color:var(--text)">${t1.name}</div>
            <div style="font-size:11px;color:var(--muted)">${t1.city||''}</div>
            <div style="font-size:20px;font-weight:800;color:var(--accent2);margin-top:4px">${t1.weekly_score||0} ⚡</div>
          </div>
          <div style="font-size:18px;font-weight:800;color:var(--gold)">VS</div>
          <div style="text-align:center;flex:1">
            <div style="font-size:14px;font-weight:800;color:var(--text)">${t2.name}</div>
            <div style="font-size:11px;color:var(--muted)">${t2.city||''}</div>
            <div style="font-size:20px;font-weight:800;color:var(--accent2);margin-top:4px">${t2.weekly_score||0} ⚡</div>
          </div>
        </div>`;
    } else if(topTeams && topTeams.length === 1){
      rivalry = `<div style="font-size:13px;color:var(--muted);text-align:center;margin:10px 0">Стань первой командой сезона!</div>`;
    }
  }catch(e){ /* silent */ }

  banner.innerHTML = `
    <div style="background:linear-gradient(135deg,rgba(108,99,255,.18),rgba(240,192,64,.12));border:1px solid rgba(240,192,64,.35);border-radius:16px;padding:14px 16px;margin-bottom:4px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
        <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--gold)">🏆 НЕДЕЛЬНЫЙ СЕЗОН</div>
        <div style="font-size:11px;color:var(--muted);font-weight:700">⏱ ${timeStr}</div>
      </div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${lang==='ru'?'Очки команды — сумма нейронов всех участников за эту неделю':'Team score = all members neurons earned this week'}</div>
      ${rivalry}
      <div style="font-size:11px;color:var(--muted);text-align:center;margin-top:6px">${lang==='ru'?'Топ команда получит бейдж чемпиона 🥇':'Top team earns the champion badge 🥇'}</div>
    </div>`;

  // Auto-refresh countdown every minute
  if(!banner._countdownInterval){
    banner._countdownInterval = setInterval(()=>renderTeamCompetitionBanner(), 60000);
  }
}

// ═══════════════════════════════════════════
// SHOP & DAILY CHALLENGE
// ═══════════════════════════════════════════
const PACKS = [
// ─────────────────────────────────────────────────────────────────
// 1. ЧЕМПИОНАТЫ МИРА ПО ФУТБОЛУ — 20 вопросов
// варианты: 3×2, 3×3, 8×4, 3×5, 3×6 | image+audio+video
// ─────────────────────────────────────────────────────────────────
{
  id:'world_cup',icon:'🏆',
  name:{ru:'Чемпионаты мира по футболу'},
  desc:{ru:'Финалы, легенды, рекорды и великие моменты'},
  price:150,color:'rgba(68,204,136,.15)',
  questions:[
    {id:'q_wc_01',cat:'SPORTS',difficulty:'easy',
     q:{ru:'Пеле выигрывал чемпионат мира три раза?'},
     a:{ru:['Да','Нет']},c:0,t:20,
     explanation:'Пеле выигрывал ЧМ в 1958, 1962 и 1970 годах — три раза.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_04',cat:'SPORTS',difficulty:'medium',
     q:{ru:'В каких трёх странах пройдёт ЧМ-2026?'},
     a:{ru:['Австралия/Новая Зеландия/Япония','США/Канада/Мексика','Китай/Япония/Корея']},c:1,t:25,
     explanation:'ЧМ-2026 примут США, Канада и Мексика.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_15',cat:'SPORTS',difficulty:'hard',
     q:{ru:'На каком месте завершила ЧМ-2022 сборная Марокко?'},
     a:{ru:['1-е','2-е','3-е','4-е','Группа']},c:3,t:25,
     explanation:'Марокко заняла историческое 4-е место на ЧМ-2022 — лучший результат африканской сборной.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_16',cat:'SPORTS',difficulty:'medium',
     q:{ru:'Сколько команд будет участвовать в ЧМ начиная с 2026 года?'},
     a:{ru:['32','36','40','48','64']},c:3,t:20,
     explanation:'С 2026 года формат расширяется до 48 команд.',
     media:{type:'audio',url:'',filename:'world_cup_anthem.mp3',placeholder:'Аудиофрагмент гимна чемпионата мира FIFA'},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_18',cat:'SPORTS',difficulty:'easy',
     q:{ru:'Какая страна — рекордсмен по числу побед на ЧМ?'},
     a:{ru:['Германия','Италия','Аргентина','Франция','Бразилия','Испания']},c:4,t:20,
     explanation:'Бразилия побеждала на ЧМ 5 раз (1958, 1962, 1970, 1994, 2002).',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_19',cat:'SPORTS',difficulty:'expert',
     q:{ru:'Кто автор «Гола века» на ЧМ-1986 в матче с Англией?'},
     a:{ru:['Пеле','Зидан','Роналдо','Марадона','Ромарио','Платини']},c:3,t:20,
     explanation:'Диего Марадона забил «Гол века» в матче Аргентина–Англия (ЧМ-1986).',
     media:{type:'image',url:'',filename:'maradona_goal_1986.jpg',placeholder:'Фото «Гола века» Марадоны 1986'},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_20',cat:'SPORTS',difficulty:'hard',
     q:{ru:'Как расположены полосы на форме сборной Аргентины?'},
     a:{ru:['Горизонтальные','Вертикальные','Диагональные','Клетка','По кругу','Без полос']},c:1,t:20,
     explanation:'Форма Аргентины — вертикальные голубо-белые полосы (celeste y blanco).',
     media:{type:'video',url:'',filename:'argentina_kit.mp4',placeholder:'Видео формы сборной Аргентины'},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_07',cat:'SPORTS',difficulty:'medium',
     q:{ru:'Кто держит рекорд — 13 голов на одном ЧМ (1958)?'},
     a:{ru:['Роналду','Жюст Фонтен','Герд Мюллер','Пеле']},c:1,t:25,
     explanation:'Жюст Фонтен забил 13 голов на ЧМ-1958 — непобитый рекорд.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_08',cat:'SPORTS',difficulty:'medium',
     q:{ru:'В каком году прошёл первый чемпионат мира по футболу?'},
     a:{ru:['1926','1930','1934','1938']},c:1,t:25,
     explanation:'Первый ЧМ прошёл в Уругвае в 1930 году.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
    {id:'q_wc_09',cat:'SPORTS',difficulty:'medium',
     q:{ru:'Кто выиграл «Золотой мяч» ЧМ-2022?'},
     a:{ru:['Килиан Мбаппе','Эмилиано Мартинес','Оливье Жиру','Лионель Месси']},c:3,t:20,
     explanation:'Лионель Месси получил «Золотой мяч» — лучший игрок ЧМ-2022.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'world_cup',status:'approved',source:'seed',tags:['футбол','чемпионат мира','спорт']},
  ]
},
// ─────────────────────────────────────────────────────────────────
// 2. ПОП-ЗВЁЗДЫ — 20 вопросов
// варианты: 3×2, 3×3, 8×4, 3×5, 3×6 | image+audio+video
// ─────────────────────────────────────────────────────────────────
{
  id:'pop_stars',icon:'🌟',
  name:{ru:'Поп-звёзды'},
  desc:{ru:'Мировые поп-звёзды, хиты, альбомы и рекорды'},
  price:150,color:'rgba(240,192,64,.1)',
  questions:[
    {id:'q_ps_01',cat:'MUSIC',difficulty:'easy',
     q:{ru:'Настоящая фамилия Леди Гаги — Джерманотта?'},
     a:{ru:['Да','Нет']},c:0,t:15,
     explanation:'Леди Гага — псевдоним Стефани Джоанн Анджелины Джерманотты.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_04',cat:'MUSIC',difficulty:'easy',
     q:{ru:'Какой певец прозван «Королём рок-н-ролла»?'},
     a:{ru:['Майкл Джексон','Чак Берри','Элвис Пресли']},c:2,t:15,
     explanation:'Элвис Пресли — «Король рок-н-ролла».',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_14',cat:'MUSIC',difficulty:'medium',
     q:{ru:'🎵 Как называется это произведение Бетховена?'},
     a:{ru:['Лунная соната','К Элизе','Патетическая соната','Ода к радости']},c:1,t:30,
     explanation:'«К Элизе» (Für Elise) — знаменитая фортепианная пьеса Бетховена.',
     media:{type:'audio',url:'https://upload.wikimedia.org/wikipedia/commons/transcoded/a/a4/En-us-beethoven.ogg/En-us-beethoven.ogg.mp3',filename:'beethoven_fur_elise.mp3',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_15',cat:'MUSIC',difficulty:'expert',
     q:{ru:'Сколько Grammy выиграла Бейонсе к 2024 году?'},
     a:{ru:['12','20','26','32','42']},c:3,t:25,
     explanation:'Бейонсе выиграла 32 Grammy — абсолютный рекорд в истории премии.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_16',cat:'MUSIC',difficulty:'medium',
     q:{ru:'🖼 Кто этот артист?'},
     a:{ru:['Эд Ширан','Дрейк','Шон Мендес','Джастин Бибер','Нид Таймс']},c:0,t:25,
     explanation:'Эд Ширан — британский певец и автор песен, один из самых популярных в мире.',
     media:{type:'image',url:'',filename:'ed_sheeran_portrait.jpg',placeholder:'Фото артиста'},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_18',cat:'MUSIC',difficulty:'hard',
     q:{ru:'Кто продал больше всего альбомов за всю историю?'},
     a:{ru:['Элвис Пресли','Майкл Джексон','Мадонна','ABBA','AC/DC','The Beatles']},c:5,t:25,
     explanation:'The Beatles — самый продаваемый музыкальный коллектив (600+ млн).',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_20',cat:'MUSIC',difficulty:'medium',
     q:{ru:'🎬 Угадай певца/певицу по видеоклипу'},
     a:{ru:['Тейлор Свифт','Дженнифер Лопес','Рианна','Шакира','Бейонсе','Дуа Липа']},c:3,t:30,
     explanation:'Шакира — колумбийская певица, автор хитов «Waka Waka» и «Hips Don\'t Lie».',
     media:{type:'video',url:'',filename:'pop_star_video.mp4',placeholder:'Видеоклип поп-звезды'},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_07',cat:'MUSIC',difficulty:'medium',
     q:{ru:'Настоящее имя Рианны?'},
     a:{ru:['Бейонсе Ноулс','Ариана Гранде','Нина Симон','Робин Рианна Фенти']},c:3,t:20,
     explanation:'Рианна родилась как Робин Рианна Фенти на Барбадосе.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_08',cat:'MUSIC',difficulty:'medium',
     q:{ru:'Какая певица выпустила альбом «21»?'},
     a:{ru:['Тейлор Свифт','Кэти Перри','Адель','Дуа Липа']},c:2,t:20,
     explanation:'Адель выпустила «21» в 2011 году — многократно платиновый альбом.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
    {id:'q_ps_09',cat:'MUSIC',difficulty:'medium',
     q:{ru:'В каком году Ариана Гранде выпустила «Thank U, Next»?'},
     a:{ru:['2016','2017','2018','2019']},c:2,t:20,
     explanation:'«Thank U, Next» вышел в ноябре 2018 года.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'pop_stars',status:'approved',source:'seed',tags:['музыка','поп-звёзды','хиты']},
  ]
},
// ─────────────────────────────────────────────────────────────────
// 3. DISNEY — 20 вопросов
// варианты: 3×2, 3×3, 8×4, 3×5, 3×6 | image+audio+video
// ─────────────────────────────────────────────────────────────────
{
  id:'disney',icon:'🏰',
  name:{ru:'Disney'},
  desc:{ru:'Мультфильмы, персонажи, песни и магия Disney'},
  price:200,color:'rgba(108,99,255,.2)',
  questions:[
    {id:'q_ds_01',cat:'DISNEY',difficulty:'easy',
     q:{ru:'«Белоснежка и семь гномов» был первым полнометражным анимационным фильмом Disney?'},
     a:{ru:['Да','Нет']},c:0,t:15,
     explanation:'«Белоснежка» (1937) — первый полнометражный мультфильм Disney.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_04',cat:'DISNEY',difficulty:'easy',
     q:{ru:'Как зовут ковбоя в «Истории игрушек»?'},
     a:{ru:['Базз','Вуди','Рекс']},c:1,t:15,
     explanation:'Вуди (Woody) — ковбой, главный герой «Истории игрушек».',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_14',cat:'DISNEY',difficulty:'medium',
     q:{ru:'🎵 Из какого мультфильма Disney эта песня?'},
     a:{ru:['Моана','Мулан','Рапунцель','Храбрая сердцем']},c:0,t:30,
     explanation:'«How Far I\'ll Go» — главная песня мультфильма «Моана» (Moana, 2016).',
     media:{type:'audio',url:'',filename:'disney_moana_song.mp3',placeholder:'Аудиофрагмент главной песни «Моаны»'},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_15',cat:'DISNEY',difficulty:'medium',
     q:{ru:'Как называется город антропоморфных животных из «Зверополиса»?'},
     a:{ru:['Анималити','Фауналэнд','Зоополис','Джунглград','Зверополис']},c:4,t:20,
     explanation:'Zootopia (Зверополис) — город, где живут антропоморфные звери.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_17',cat:'DISNEY',difficulty:'medium',
     q:{ru:'🖼 Из какого мультфильма этот персонаж?'},
     a:{ru:['Мулан','Покахонтас','Моана','Рапунцель','Ариэль']},c:2,t:25,
     explanation:'Моана — дочь вождя полинезийского племени.',
     media:{type:'image',url:'',filename:'disney_princess.jpg',placeholder:'Кадр из мультфильма Disney с принцессой'},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_18',cat:'DISNEY',difficulty:'medium',
     q:{ru:'Как зовут фею в «Питере Пэне»?'},
     a:{ru:['Твинкл','Флёр','Бель','Виви','Лили','Динь-Динь']},c:5,t:15,
     explanation:'Крошечная фея Питера Пэна — Динь-Динь (Tinker Bell).',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_20',cat:'DISNEY',difficulty:'medium',
     q:{ru:'🎬 Из какого мультфильма этот отрывок?'},
     a:{ru:['Мулан','Покахонтас','Золушка','Красавица и Чудовище','Рапунцель','Аладдин']},c:4,t:30,
     explanation:'«Рапунцель: Запутанная история» (Tangled, 2010) — история принцессы с магическими волосами.',
     media:{type:'video',url:'',filename:'disney_rapunzel_clip.mp4',placeholder:'Видеоотрывок из «Рапунцель»'},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_07',cat:'DISNEY',difficulty:'easy',
     q:{ru:'В каком фильме звучит «Let It Go»?'},
     a:{ru:['Рапунцель','Храбрая сердцем','Моана','Холодное сердце']},c:3,t:20,
     explanation:'«Let It Go» — песня из «Холодного сердца» (Frozen, 2013).',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_08',cat:'DISNEY',difficulty:'medium',
     q:{ru:'Как зовут злого дядю Симбы?'},
     a:{ru:['Муфаса','Зазу','Рафики','Шрам']},c:3,t:15,
     explanation:'Шрам (Scar) — злой брат Муфасы, главный злодей «Короля Льва».',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
    {id:'q_ds_09',cat:'DISNEY',difficulty:'easy',
     q:{ru:'Как зовут синюю рыбку с потерей памяти из «В поисках Немо»?'},
     a:{ru:['Немо','Жемчуг','Дори','Дорс']},c:2,t:15,
     explanation:'Дори — синяя рыба-хирург с кратковременной потерей памяти.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'disney',status:'approved',source:'seed',tags:['disney','мультфильмы','персонажи']},
  ]
},
// ─────────────────────────────────────────────────────────────────
// 4. ГАРРИ ПОТТЕР — 20 вопросов
// варианты: 3×2, 3×3, 8×4, 3×5, 3×6 | image+audio+video
// ─────────────────────────────────────────────────────────────────
{
  id:'harry_potter',icon:'⚡',
  name:{ru:'Гарри Поттер'},
  desc:{ru:'Книги, фильмы, персонажи, заклинания и факультеты'},
  price:200,color:'rgba(180,100,255,.15)',
  questions:[
    {id:'q_hp_01',cat:'CINEMA',difficulty:'easy',
     q:{ru:'Гарри Поттер учился на факультете Гриффиндор?'},
     a:{ru:['Да','Нет']},c:0,t:15,
     explanation:'Гарри Поттер — студент факультета Гриффиндор.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_04',cat:'CINEMA',difficulty:'easy',
     q:{ru:'Какое заклинание убивает?'},
     a:{ru:['Экспеллиармус','Протего','Авада Кедавра']},c:2,t:15,
     explanation:'Авада Кедавра — убивающее заклинание, одно из трёх Непростительных.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_13',cat:'CINEMA',difficulty:'medium',
     q:{ru:'🎵 Это музыкальная тема из фильмов о Гарри Поттере?'},
     a:{ru:['Да — главная тема Хогвартса','Да — тема Слизерина','Нет — это Властелин колец','Нет — это Нарния']},c:0,t:30,
     explanation:'«Hedwig\'s Theme» — главная музыкальная тема фильмов о Гарри Поттере.',
     media:{type:'audio',url:'',filename:'hp_hedwigs_theme.mp3',placeholder:'Аудио: музыкальная тема «Гарри Поттера»'},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_15',cat:'CINEMA',difficulty:'easy',
     q:{ru:'Какое животное символизирует факультет Гриффиндор?'},
     a:{ru:['Орёл','Барсук','Змея','Волк','Лев']},c:4,t:15,
     explanation:'Символ Гриффиндора — лев.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_16',cat:'CINEMA',difficulty:'medium',
     q:{ru:'🖼 Узнай факультет по цветам герба'},
     a:{ru:['Когтевран','Пуффендуй','Слизерин','Гриффиндор','Дурмстранг']},c:3,t:20,
     explanation:'Красный и золотой цвета — цвета Гриффиндора.',
     media:{type:'image',url:'',filename:'gryffindor_crest.jpg',placeholder:'Герб факультета Гриффиндор (красный и золотой)'},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_18',cat:'CINEMA',difficulty:'medium',
     q:{ru:'Как зовут питомца Гермионы?'},
     a:{ru:['Кроха','Пушинка','Крошка','Мохнатик','Сушка','Кручинка']},c:5,t:20,
     explanation:'Кота Гермионы зовут Кручинка (Crookshanks).',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_20',cat:'CINEMA',difficulty:'medium',
     q:{ru:'🎬 Что происходит в этой сцене?'},
     a:{ru:['Битва на Хогвартсе','Матч по квиддичу','Урок магии','Сцена в Азкабане','Посещение Косого переулка','Встреча с Дамблдором']},c:1,t:30,
     explanation:'Квиддич — волшебная игра на мётлах, один из центральных видов спорта в мире Гарри Поттера.',
     media:{type:'video',url:'',filename:'hp_quidditch_scene.mp4',placeholder:'Видеофрагмент матча по квиддичу'},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_07',cat:'CINEMA',difficulty:'medium',
     q:{ru:'Настоящее имя Волдеморта?'},
     a:{ru:['Том Сиддл Реддл','Том Тёмный Лорд','Том Лорд Слизерин','Том Марволо Реддл']},c:3,t:20,
     explanation:'Настоящее имя Тёмного Лорда — Том Марволо Реддл.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_08',cat:'CINEMA',difficulty:'easy',
     q:{ru:'Сколько книг в серии «Гарри Поттер»?'},
     a:{ru:['5','6','7','8']},c:2,t:15,
     explanation:'Серия состоит из 7 книг Дж. К. Роулинг.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
    {id:'q_hp_09',cat:'CINEMA',difficulty:'medium',
     q:{ru:'Какой предмет изначально преподаёт профессор Снейп?'},
     a:{ru:['Трансфигурацию','Защиту от тёмных искусств','Зелья','Травологию']},c:2,t:20,
     explanation:'Снейп преподаёт Зелья, хотя мечтал о Защите от тёмных искусств.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'harry_potter',status:'approved',source:'seed',tags:['гарри поттер','магия','хогвартс']},
  ]
},
// ─────────────────────────────────────────────────────────────────
// 5. ИСКУССТВО — 20 вопросов
// варианты: 3×2, 3×3, 8×4, 3×5, 3×6 | image+audio+video
// ─────────────────────────────────────────────────────────────────
{
  id:'art',icon:'🎨',
  name:{ru:'Искусство'},
  desc:{ru:'Картины, художники, стили, музеи и эпохи'},
  price:150,color:'rgba(224,85,85,.15)',
  questions:[
    {id:'q_art_01',cat:'ART',difficulty:'easy',
     q:{ru:'«Девятый вал» написал Айвазовский?'},
     a:{ru:['Да','Нет']},c:0,t:15,
     explanation:'«Девятый вал» (1850) — знаменитая марина Ивана Айвазовского.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_04',cat:'ART',difficulty:'easy',
     q:{ru:'Кто автор «Звёздной ночи»?'},
     a:{ru:['Пикассо','Моне','Ван Гог']},c:2,t:15,
     explanation:'«Звёздная ночь» написана Ван Гогом в 1889 году.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_07',cat:'ART',difficulty:'medium',
     q:{ru:'🖼 Как называется эта знаменитая картина?'},
     a:{ru:['Дева с жемчужной серёжкой','Рождение Венеры','Тайная вечеря','Мона Лиза']},c:3,t:25,
     explanation:'«Мона Лиза» написана Леонардо да Винчи около 1503–1519 гг.',
     media:{type:'image',url:'https://upload.wikimedia.org/wikipedia/commons/thumb/6/6a/Mona_Lisa.jpg/402px-Mona_Lisa.jpg',filename:'mona_lisa.jpg',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_14',cat:'ART',difficulty:'medium',
     q:{ru:'🎵 Это музыкальное произведение относится к...'},
     a:{ru:['Джазу','Поп-музыке','Классической музыке','Року']},c:2,t:30,
     explanation:'Классическая музыка охватывает произведения Баха, Моцарта, Бетховена и других.',
     media:{type:'audio',url:'',filename:'classical_music_sample.mp3',placeholder:'Аудиофрагмент классического произведения'},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_15',cat:'ART',difficulty:'medium',
     q:{ru:'Кто написал «Рождение Венеры»?'},
     a:{ru:['Рафаэль','Тициан','Леонардо','Микеланджело','Боттичелли']},c:4,t:20,
     explanation:'«Рождение Венеры» написана Боттичелли около 1484–1486 гг.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_18',cat:'ART',difficulty:'easy',
     q:{ru:'Как называется самый посещаемый музей мира?'},
     a:{ru:['Эрмитаж','Метрополитен','Британский музей','Прадо','Уффици','Лувр']},c:5,t:20,
     explanation:'Лувр в Париже — самый посещаемый музей мира.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_20',cat:'ART',difficulty:'medium',
     q:{ru:'🎬 К какому художественному направлению относится этот видеообзор?'},
     a:{ru:['Кубизм','Сюрреализм','Рококо','Барокко','Экспрессионизм','Импрессионизм']},c:5,t:30,
     explanation:'Импрессионизм — художественное течение конца XIX века, представители: Моне, Ренуар, Дега.',
     media:{type:'video',url:'',filename:'impressionism_overview.mp4',placeholder:'Видеообзор направления импрессионизма'},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_08',cat:'ART',difficulty:'hard',
     q:{ru:'Сколько фигур в «Танце» Матисса (1910)?'},
     a:{ru:['4','5','6','7']},c:1,t:25,
     explanation:'В «Танце» Матисса (1910) изображены 5 фигур.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_09',cat:'ART',difficulty:'hard',
     q:{ru:'Кто написал «Сикстинскую Мадонну»?'},
     a:{ru:['Леонардо да Винчи','Микеланджело','Боттичелли','Рафаэль']},c:3,t:25,
     explanation:'«Сикстинская Мадонна» написана Рафаэлем около 1512 года.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
    {id:'q_art_10',cat:'ART',difficulty:'medium',
     q:{ru:'В какой технике расписан потолок Сикстинской капеллы?'},
     a:{ru:['Масло','Акварель','Гуашь','Фреска']},c:3,t:20,
     explanation:'Микеланджело расписал потолок Сикстинской капеллы в технике фрески.',
     media:{type:'none',url:'',filename:'',placeholder:''},packId:'art',status:'approved',source:'seed',tags:['искусство','живопись','художники']},
  ]
},
];

// ── DEMO PACKS GATE ──────────────────────────────────────────────────────
// Set to true ONLY for local dev/testing. In production: false.
const ENABLE_LOCAL_DEMO_PACKS = false;

let ownedPacks = new Set(JSON.parse(localStorage.getItem('mfc_packs')||'[]'));
let dailyState = JSON.parse(localStorage.getItem('mfc_daily')||'{}');
refCode = localStorage.getItem('mfc_refcode')||null; // moved to shim header

// ── DAILY CHALLENGE ──────────────────────────────────────────────────────
const DAILY_CHALLENGES = [
  {id:'q5',    title:{en:'Answer 5 questions correctly',ru:'Ответь правильно на 5 вопросов'},    cat:'ALL',   count:5,  reward:50},
  {id:'q5sci', title:{en:'5 Science questions correct', ru:'5 правильных по науке'},             cat:'SCIENCE',count:5, reward:60},
  {id:'q5hist',title:{en:'5 History questions correct',  ru:'5 правильных по истории'},           cat:'HISTORY',count:5, reward:60},
  {id:'q5geo', title:{en:'5 Geography questions',        ru:'5 вопросов по географии'},           cat:'GEOGRAPHY',count:5,reward:60},
  {id:'perfect',title:{en:'Get a perfect round',         ru:'Идеальный раунд без ошибок'},        cat:'ALL',   count:1,  reward:100, perfect:true},
  {id:'duel',  title:{en:'Win a duel',                   ru:'Выиграй дуэль'},                     cat:'DUEL',  count:1,  reward:80},
  {id:'q10',   title:{en:'Answer 10 questions correctly',ru:'Ответь правильно на 10 вопросов'},   cat:'ALL',   count:10, reward:80},
];


// getTodayKey — defined earlier in this file


function getDailyChallenge(){
  const today = getTodayKey();
  // Pick challenge based on day of year
  const dayOfYear = Math.floor((new Date()-new Date(new Date().getFullYear(),0,0))/86400000);
  return DAILY_CHALLENGES[dayOfYear % DAILY_CHALLENGES.length];
}

function loadDailyState(){
  const today = getTodayKey();
  if(dailyState.date !== today){
    dailyState = {date:today, progress:0, done:false, streak: (dailyState.date === getPrevDay() ? (dailyState.streak||0) : 0)};
    localStorage.setItem('mfc_daily', JSON.stringify(dailyState));
  }
  renderDailyChallenge();
}

function getPrevDay(){
  const d = new Date(); d.setDate(d.getDate()-1);
  return d.toISOString().slice(0,10);
}

function renderDailyChallenge(){
  const ch = getDailyChallenge();
  const L = T[lang];
  // Update home teaser too
  const homeLabel = document.getElementById('home-daily-label');
  const homeTitle = document.getElementById('home-daily-title');
  const homeReward = document.getElementById('home-daily-reward');
  if(homeLabel) homeLabel.textContent = lang==='ru'?'Задание дня':'Daily Challenge';
  if(homeTitle) homeTitle.textContent = (dailyState.done ? (lang==='ru'?'✓ Выполнено сегодня':'✓ Done today') : (ch.title[lang]||ch.title.en));
  if(homeReward) homeReward.textContent = dailyState.done ? '✓' : '+'+ch.reward+' ⚡';
  document.getElementById('daily-label').textContent = lang==='ru'?'Задание дня':'Daily Challenge';
  document.getElementById('daily-title').textContent = ch.title[lang]||ch.title.en;
  document.getElementById('daily-reward').textContent = '+'+ch.reward+' ⚡';
  const prog = dailyState.progress||0;
  const total = ch.count;
  const pct = Math.min(prog/total*100, 100);
  document.getElementById('daily-fill').style.width = pct+'%';
  document.getElementById('daily-prog-txt').textContent = prog+' / '+total;
  document.getElementById('daily-streak').textContent = '🔥 '+(dailyState.streak||0)+' '+(lang==='ru'?'дней подряд':'дней подряд');
  const btn = document.getElementById('daily-play-btn');
  const card = document.getElementById('daily-card');
  if(dailyState.done){
    btn.textContent = lang==='ru'?'✓ Выполнено!':'✓ Completed!';
    btn.disabled = true; btn.style.opacity = '.6';
    card.classList.add('daily-done');
  } else {
    btn.textContent = lang==='ru'?'Играть →':'Play now →';
    btn.disabled = false; btn.style.opacity = '1';
    card.classList.remove('daily-done');
  }
}

// Daily challenge runs outside the free-question limit — never counts, never gets cut
function startDailyChallengeQuiz(){
  currentGameType = 'daily';
  currentPackKey  = null;
  _currentGameCountsDailyLimit = false;
  window._quickPlayRemaining = null;
  startQuiz(null, true); // skipLimitCheck=true: no limit gate, no remaining slice
}

function playDailyChallenge(){
  const ch = getDailyChallenge();
  track('daily_started', {challenge_id: ch.id, cat: ch.cat});
  if(ch.cat === 'DUEL'){ showScreen('duel'); return; }
  selectedCat = ch.cat === 'ALL' ? 'ALL' : ch.cat;
  document.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
  if(ch.cat==='ALL') document.getElementById('chip-all').classList.add('sel');
  showScreen('home');
  setTimeout(startDailyChallengeQuiz, 100);
}

function updateDailyProgress(correctAnswers, isPerfect){
  if(dailyState.done) return;
  const ch = getDailyChallenge();
  if(ch.perfect && isPerfect){
    dailyState.progress = ch.count;
  } else if(ch.cat==='ALL'||ch.cat===curQ[0]?.cat){
    dailyState.progress = (dailyState.progress||0) + correctAnswers;
  }
  if(dailyState.progress >= ch.count){
    dailyState.done = true;
    dailyState.streak = (dailyState.streak||0)+1;
    awardNeurons(ch.reward, 'challenge_reward', 'challenge:' + ch.id + ':' + (currentUser?.id||'guest'));
    track('daily_completed', {challenge_id: ch.id, streak: dailyState.streak, reward: ch.reward});
    toast('🎯 '+(lang==='ru'?'Задание дня выполнено! +':'Задание дня выполнено! +')+ch.reward+' нейронов', 3000);
  }
  localStorage.setItem('mfc_daily', JSON.stringify(dailyState));
}

// ── REFERRAL ─────────────────────────────────────────────────────────────

function getPlayerLevel(n){
  if(n >= 100000) return {icon:'🏛️', name:{en:'Legend',      ru:'Легенда'},    next:null,          progress:1};
  if(n >= 50000)  return {icon:'🧠', name:{en:'Genius',      ru:'Гений'},      next:100000,        progress:(n-50000)/50000};
  if(n >= 25000)  return {icon:'🏆', name:{en:'Master',      ru:'Мастер'},     next:50000,         progress:(n-25000)/25000};
  if(n >= 10000)  return {icon:'🎓', name:{en:'Expert',      ru:'Эксперт'},    next:25000,         progress:(n-10000)/15000};
  if(n >= 5000)   return {icon:'📚', name:{en:'Erudite',     ru:'Эрудит'},     next:10000,         progress:(n-5000)/5000};
  if(n >= 2000)   return {icon:'🔬', name:{en:'Connoisseur', ru:'Знаток'},     next:5000,          progress:(n-2000)/3000};
  if(n >= 500)    return {icon:'⚡', name:{en:'Amateur',     ru:'Любитель'},   next:2000,          progress:(n-500)/1500};
  return             {icon:'🌱', name:{en:'Beginner',    ru:'Новичок'},    next:500,           progress:n/500};
}

function getOrCreateRefCode(){
  if(!currentUser) return null;
  // Use stored ref_code from profile, NOT uuid slice
  if(refCode) return refCode;
  refCode = localStorage.getItem('mfc_refcode');
  return refCode;
}

async function loadRefCode(){
  if(!currentUser) return;
  // Try to get ref_code from profiles table
  const {data} = await sb.from('profiles').select('ref_code').eq('id', currentUser.id).single();
  if(data && data.ref_code){
    refCode = data.ref_code;
    localStorage.setItem('mfc_refcode', refCode);
  } else {
    // Generate and save ref_code
    const newCode = Math.random().toString(36).slice(2,10).toUpperCase();
    refCode = newCode;
    localStorage.setItem('mfc_refcode', newCode);
    sb.from('profiles').update({ref_code: newCode}).eq('id', currentUser.id).then(()=>{}).catch(()=>{});
  }
}

async function renderRefCard(){
  const code = getOrCreateRefCode();
  document.getElementById('ref-title').textContent = lang==='ru'?'Пригласи друзей':'Invite friends';
  document.getElementById('ref-sub').textContent = lang==='ru'?'Оба получат +50 нейронов когда друг пройдёт первый квиз':'Both get +50 neurons when your friend completes their first quiz';
  document.getElementById('ref-count-lbl').textContent = lang==='ru'?' друзей активировали':'friends activated';
  document.getElementById('ref-earned-lbl').textContent = lang==='ru'?' нейронов заработано':' нейронов заработано';
  if(code){
    const link = location.origin+location.pathname+'?ref='+code;
    document.getElementById('ref-link').textContent = link;
    document.getElementById('ref-copy-btn').textContent = lang==='ru'?'Копировать':'Copy';
    // Load real stats from DB
    if(currentUser){
      const {data} = await sb.from('referrals')
        .select('id,status,reward_referrer')
        .eq('referrer_id', currentUser.id)
        .eq('status','rewarded');
      if(data){
        document.getElementById('ref-count').textContent = data.length;
        document.getElementById('ref-earned').textContent = data.reduce((s,r)=>s+(r.reward_referrer||50),0);
      }
    }
  } else {
    document.getElementById('ref-link').textContent = lang==='ru'?'Войдите чтобы получить ссылку':'Sign in to get your link';
  }
}

function copyRefLink(){
  const code = getOrCreateRefCode();
  if(!code){ toast(lang==='ru'?'Сначала войдите':'Sign in first'); return; }
  const link = location.origin+location.pathname+'?ref='+code;
  navigator.clipboard.writeText(link).catch(()=>{});
  track('referral_link_copied', {ref_code: code});
  document.getElementById('ref-copy-btn').textContent = lang==='ru'?'Скопировано!':'Copied!';
  setTimeout(()=>document.getElementById('ref-copy-btn').textContent=lang==='ru'?'Копировать':'Copy', 2000);
}

// Save pending ref code when user arrives via ref link (before auth)
function savePendingRef(){
  const ref = new URLSearchParams(location.search).get('ref');
  if(ref && ref.length === 8){
    localStorage.setItem('mfc_pending_ref', ref);
    track('referral_clicked', {ref_code: ref});
  }
}

async function checkRefParam(){
  if(!currentUser) return;
  const ref = localStorage.getItem('mfc_pending_ref');
  if(!ref) return;
  const myRef = getOrCreateRefCode();
  if(ref === myRef){ localStorage.removeItem('mfc_pending_ref'); return; } // own link

  // Check if already has a referral record
  const {data: existing} = await sb.from('referrals')
    .select('id').eq('invited_user_id', currentUser.id).limit(1);
  if(existing && existing.length){ localStorage.removeItem('mfc_pending_ref'); return; }

  // Find referrer by ref_code
  const referrerId = await findUserByRefCode(ref);
  if(!referrerId){ localStorage.removeItem('mfc_pending_ref'); return; }

  // Create referral record
  await sb.from('referrals').insert({
    referrer_id: referrerId,
    invited_user_id: currentUser.id,
    ref_code: ref,
    status: 'signed_up',
    reward_referrer: 100,
    reward_invited: 100,
    signed_up_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  });
  localStorage.removeItem('mfc_pending_ref');
  track('referral_signed_up', {ref_code: ref});

  // Award new user (referral signup bonus)
  try {
    const {data: awardData} = await sb.rpc('award_currency', {
      p_operation_type: 'referral_bonus',
      p_operation_key: 'ref_new:' + currentUser.id
    });
    if (awardData?.ok && !awardData?.already_processed) {
      await refreshBalance();
      toast('🎁 +' + (awardData.awarded_neurons || 100) + ' нейронов за регистрацию по приглашению!', 3500);
    }
  } catch(e) { console.log('Referral signup award failed:', e); }

  // Award referrer via server-side RPC (runs as SECURITY DEFINER to bypass RLS)
  try {
    await sb.rpc('award_referrer', {
      p_referrer_id: referrerId,
      p_invited_id: currentUser.id
    });
  } catch(e) { console.log('Referrer award RPC failed:', e); }
}

async function findUserByRefCode(code){
  // Search by proper ref_code column
  const {data} = await sb.from('profiles').select('id').eq('ref_code', code).maybeSingle();
  if(data) return data.id;
  return null;
}

async function activateReferral(){
  if(!currentUser) return;
  try{
    // Use server-side RPC - atomic, cannot be abused from client
    const {data, error} = await sb.rpc('activate_referral', {p_invited_user_id: currentUser.id});
    if(error){ console.log('Referral RPC error:', error.message); return; }
    if(data?.ok){
      const reward = data.reward_invited||50;
      // Referral reward already awarded server-side — refresh local balance
      await refreshBalance();
      track('referral_activated', {reward});
      toast('🎁 +'+(reward)+(lang==='ru'?' нейронов! Реферальный бонус':' neurons! Referral bonus'), 3500);
    }
  }catch(e){ console.log('Referral activation failed:', e); }
}

// ── PACKS SHOP ────────────────────────────────────────────────────────────
function renderShop(){
  loadDailyState();
  renderRefCard();
  document.getElementById('n-shop').textContent = neurons;
  document.getElementById('shop-section-title').textContent = lang==='ru'?'Активности':'Activities';
  const grid = document.getElementById('packs-grid');
  grid.innerHTML = '';

  if(ENABLE_LOCAL_DEMO_PACKS){
    // Dev only: show hardcoded demo packs
    PACKS.forEach(p=>{
      const owned = ownedPacks.has(p.id);
      const name = p.name[lang]||p.name.en;
      const desc = p.desc[lang]||p.desc.en;
      const card = document.createElement('div');
      card.className = 'pack-card' + (owned?' owned':'');
      card.innerHTML = '<div class="pack-icon">'+p.icon+'</div>'
        +'<div class="pack-name">'+name+' <span style="font-size:10px;color:var(--gold)">[demo]</span></div>'
        +'<div class="pack-desc">'+desc+'</div>'
        +(owned
          ? '<button class="big-btn" style="margin-top:8px;padding:10px;font-size:13px" onclick="event.stopPropagation();_legacyStartLocalPack(\''+p.id+'\')">▶ '+(lang==='ru'?'Играть':'Play')+'</button>'
          : '<div class="pack-price'+(p.price===0?' free':'')+'">'+(p.price===0?'Бесплатно':p.price+' ⚡')+'</div>'
        );
      if(!owned) card.addEventListener('click', ()=>_legacyBuyLocalPack(p.id));
      grid.appendChild(card);
    });
  }

  // Always load DB packs (sole source in production)
  renderDBGamePacks();
  // Load partner offers (curated: 1 featured + up to 3 per category)
  loadPartnerOffers();
}

async function loadPartnerOffers(){
  const container = document.getElementById('partner-offers-list');
  if(!container) return;
  try{
    const { data, error } = await sb.from('partner_offers')
      .select('*')
      .in('status', ['active','featured'])
      .order('status', { ascending: false }) // featured first
      .limit(7);
    if(error || !data || !data.length){
      container.innerHTML = '';
      return;
    }
    // Split: 1 featured (partner of the week) + up to 3 events + up to 2 prizes
    const featured = data.filter(o=>o.status==='featured').slice(0,1);
    const events   = data.filter(o=>o.status==='active'&&o.offer_type==='experience').slice(0,3);
    const prizes   = data.filter(o=>o.status==='active'&&o.offer_type!=='experience').slice(0,2);
    const shown    = [...featured, ...events, ...prizes];
    if(!shown.length){ container.innerHTML = ''; return; }
    container.innerHTML = shown.map(o => {
      const isFeatured = o.status === 'featured';
      return `<div onclick="redeemPartnerOffer('${_esc(o.id)}')"
        style="background:var(--bg2);border:0.5px solid ${isFeatured?'rgba(240,192,64,.4)':'var(--border)'};border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer;position:relative">
        ${isFeatured?'<div style="position:absolute;top:8px;right:10px;font-size:9px;font-weight:800;color:var(--gold);letter-spacing:1px">⭐ ПАРТНЁР НЕДЕЛИ</div>':''}
        <div style="font-size:28px;flex-shrink:0">${o.offer_type==='experience'?'🎟️':o.offer_type==='product'?'🎁':'💎'}</div>
        <div style="flex:1;${isFeatured?'margin-top:12px':''}">
          <div style="font-size:14px;font-weight:800">${_esc(o.title)}</div>
          <div style="font-size:11px;color:var(--muted)">${_esc(o.partner_name)}</div>
          ${o.description?`<div style="font-size:11px;color:var(--muted);margin-top:2px">${_esc(o.description.slice(0,60))}${o.description.length>60?'…':''}</div>`:''}
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:800;color:var(--gold)">${o.price_neurons||0} ⚡</div>
          ${o.slots_total?`<div style="font-size:10px;color:var(--muted);margin-top:2px">осталось ${(o.slots_total||0)-(o.slots_sold||0)}</div>`:''}
        </div>
      </div>`;
    }).join('');
  }catch(e){
    console.warn('[shop] loadPartnerOffers:', e.message);
  }
}

async function redeemPartnerOffer(offerId){
  if(!currentUser){ toast(lang==='ru'?'Войдите чтобы купить':'Sign in to purchase'); return; }
  // Fetch offer details
  const { data: offer, error } = await sb.from('partner_offers')
    .select('*').eq('id', offerId).single();
  if(error || !offer){ toast('Оффер не найден'); return; }
  if(!confirm(`Потратить ${offer.price_neurons} ⚡ на «${offer.title}»?`)) return;
  const result = await spendNeurons(offer.price_neurons, 'partner_offer', 'partner:'+offerId+':'+currentUser.id);
  if(!result || !result.ok){
    toast(result?.reason==='insufficient'?`❌ Недостаточно нейронов (нужно ${offer.price_neurons} ⚡)`:'❌ Ошибка покупки');
    return;
  }
  // Record redemption
  const { data: redemption, error: rErr } = await sb.from('partner_redemptions').insert({
    offer_id: offerId,
    user_id:  currentUser.id,
    status:   'pending',
  }).select('code').single();
  if(rErr && !rErr.message.includes('unique')){
    // Rollback not possible here — log and notify
    console.error('[shop] redemption insert error:', rErr.message);
  }
  const code = redemption?.code || '—';
  track('partner_offer_redeemed', { offer_id: offerId, price: offer.price_neurons });
  // Show confirmation modal
  const modal = document.createElement('div');
  modal.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML=`<div style="background:var(--bg2);border:0.5px solid rgba(108,99,255,.4);border-radius:20px;padding:28px 20px;max-width:380px;width:100%;text-align:center">
    <div style="font-size:48px;margin-bottom:12px">🎉</div>
    <div style="font-size:18px;font-weight:800;margin-bottom:6px">${_esc(offer.title)}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:16px">Код для предъявления партнёру:</div>
    <div style="background:var(--bg3);border:0.5px solid rgba(108,99,255,.3);border-radius:14px;padding:14px;margin-bottom:16px">
      <div style="font-size:24px;font-weight:900;letter-spacing:3px;color:var(--accent2)">${_esc(code)}</div>
    </div>
    ${offer.partner_contact?`<div style="font-size:12px;color:var(--muted);margin-bottom:14px">Контакт: ${_esc(offer.partner_contact)}</div>`:''}
    <div style="display:flex;gap:10px">
      <button onclick="navigator.clipboard.writeText('${_esc(code)}').catch(()=>{}); this.textContent='✅'" style="flex:1;background:rgba(108,99,255,.15);border:0.5px solid var(--accent);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--accent2);cursor:pointer;font-family:inherit">📋 Скопировать</button>
      <button onclick="this.closest('div[style*=fixed]').remove()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  loadPartnerOffers();
}

// Legacy local-pack helpers — only used when ENABLE_LOCAL_DEMO_PACKS=true
function _legacyStartLocalPack(packId){
  track('pack_played', {pack_id: packId});
  startQuiz(packId);
}
function _legacyBuyLocalPack(id){
  if(ownedPacks.has(id)){ toast('Пак уже куплен!'); return; }
  const pack = PACKS.find(p=>p.id===id);
  if(!pack) return;
  if(pack.isFree === true || pack.price === 0){
    ownedPacks.add(id); localStorage.setItem('mfc_packs', JSON.stringify([...ownedPacks]));
    toast('✅ Пак открыт!'); renderShop(); return;
  }
  if(neurons < pack.price){ toast('Не хватает нейронов!'); return; }
  // Legacy local pack — use spendNeurons RPC for auth users, local for guests
  spendNeurons(pack.price, 'legacy_pack', 'legacypack:' + id + ':' + (currentUser?.id||'guest')).then(r => {
    if(r && r.ok){ ownedPacks.add(id); localStorage.setItem('mfc_packs', JSON.stringify([...ownedPacks])); renderShop(); }
    else if(!currentUser){ ownedPacks.add(id); neurons -= pack.price; updNeurons(); localStorage.setItem('mfc_packs', JSON.stringify([...ownedPacks])); renderShop(); }
    else toast('❌ Ошибка покупки');
  });
  track('pack_bought', {pack_id: id, price: pack.price});
}

function startPackFromShop(packId){
  // In production always route to DB pack
  playDBPack(packId);
}

function buyPack(id){
  if(!ENABLE_LOCAL_DEMO_PACKS){ toast(lang==='ru'?'Демо-паки отключены':'Demo packs disabled'); return; }
  _legacyBuyLocalPack(id);
}

function showPackUnlockedModal(pack){
  const name = (pack.name && typeof pack.name==='object') ? (pack.name[lang]||pack.name.ru||pack.name.en||'') : (pack.name||'');
  // Create overlay modal
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:500;display:flex;align-items:center;justify-content:center;padding:20px';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:20px;padding:28px 20px;max-width:360px;width:100%;text-align:center">
      <div style="font-size:52px;margin-bottom:12px">${pack.icon}</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:6px">${lang==='ru'?'Пак открыт!':'Pack unlocked!'}</div>
      <div style="font-size:14px;color:var(--muted);margin-bottom:20px">${name}</div>
      <button class="big-btn" style="margin-bottom:10px" onclick="this.closest('div[style]').parentElement.remove();startQuiz('${pack.id}')">${lang==='ru'?'▶ Играть сейчас':'▶ Play now'}</button>
      <button class="score-sec-btn" style="width:100%" onclick="this.closest('div[style]').parentElement.remove()">${lang==='ru'?'Позже':'Later'}</button>
    </div>`;
  document.body.appendChild(overlay);
}

function getAvailableQuestions(cat){
  let pool = [...ALL_Q];
  // Add owned pack questions
  // Quick play question pool from owned local packs (only in dev mode)
  if(ENABLE_LOCAL_DEMO_PACKS){
    PACKS.forEach(p=>{
      if(ownedPacks.has(p.id)) pool = pool.concat(p.questions);
    });
  }
  if(cat==='ALL') return pool;
  return pool.filter(q=>Array.isArray(cat)?cat.includes(q.cat):q.cat===cat);
}

// ═══════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════
let _authed = false;

// [initAuth] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [redirectAfterAuth] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [ensureProfile] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [onUserLoaded] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [loadUserNeurons] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [saveNeurons] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [signInGoogle] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [toggleEmailAuth] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [showAuthError] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)

// [clearAuthError] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [signInEmail] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [signUpEmail] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// [continueAsGuest] → moved to ES module (see js/auth/auth.js, js/economy/wallet.js, js/router.js)


// ═══════════════════════════════════════════
// HOME
// ═══════════════════════════════════════════
function selectMode(m){
  selectedMode=m;
  document.getElementById('mode-feed').classList.toggle('active-mode',m==='feed');
  document.getElementById('mode-duel').classList.toggle('active-mode',m==='duel');
}
function toggleCat(el){
  const cat=el.dataset.cat;
  if(cat==='ALL'){
    document.querySelectorAll('.chip').forEach(c=>c.classList.remove('sel'));
    el.classList.add('sel');selectedCat='ALL';
  } else {
    document.getElementById('chip-all').classList.remove('sel');
    el.classList.toggle('sel');
    const sels=[...document.querySelectorAll('.chip.sel')].map(c=>c.dataset.cat).filter(c=>c!=='ALL');
    selectedCat=sels.length===0?'ALL':sels;
  }
}
async function startQuiz(packId, skipLimitCheck){
  // ── Daily limit: quick play only (not packs, tester, duel, tournament) ──
  if(!skipLimitCheck && !packId){
    // Hard daily lock check — skip only when startQuickPlay is in progress
    if(isQuickPlayLocked() && !_quickPlayStartInProgress){
      showDailyLimitScreen('training');
      return;
    }
    const remaining = getRemainingFreeQuestions();
    if(remaining <= 0 && !_quickPlayStartInProgress){
      showDailyLimitScreen('training');
      return;
    }
    // NOTE: lockQuickPlayStarted() is NOT called here.
    // It is called only after standard questions are successfully assembled below,
    // so a failed DB load or insufficient questions never locks the user out.
    window._quickPlayRemaining = remaining;
    _currentGameCountsDailyLimit = true;
    currentGameType = 'quick';
    currentPackKey  = null;
  } else {
    window._quickPlayRemaining = null;
    _currentGameCountsDailyLimit = false;  // packs/admin/tester/duel don't count
  }

  // If remote questions still loading, wait (max 3s) then continue with whatever we have
  if(!_remoteQsLoaded && _remoteQsPromise){
    toast(lang==='ru'?'⏳ Загружаем вопросы...':'⏳ Loading questions...', 1500);
    await Promise.race([_remoteQsPromise, new Promise(r=>setTimeout(r,3000))]);
  }
  if(selectedMode==='duel'){showScreen('duel');return;}
  
  // If specific pack selected, play ONLY that pack
  if(packId){
    const pack = PACKS.find(p=>p.id===packId);
    // Local demo packs: only if ENABLE_LOCAL_DEMO_PACKS is true
    if(pack && !ENABLE_LOCAL_DEMO_PACKS){
      // Route to DB pack instead
      playDBPack(packId);
      return;
    }
    if(pack && !ownedPacks.has(packId)){
      toast(lang==='ru'?'Сначала купите пак':'Buy the pack first');
      showScreen('shop');return;
    }
    if(pack && ownedPacks.has(packId)){
      const packQs = filterPlayableQuestions(pack.questions.map(getQ), {logBad:true});
      if(packQs.length === 0){
        toast(lang==='ru' ? '⚠️ В паке нет пригодных вопросов' : '⚠️ No playable questions in pack', 3000);
        return;
      }
      curQ = packQs.sort(()=>Math.random()-.5).slice(0,Math.min(10,packQs.length));
      qIdx=0;correctCount=0;streak=0;bestStreak=0;
      _roundScore=0;
      _gameStartTime=Date.now();
      _gameId=null;
      buildDots('prog-dots',curQ.length);
      track('quiz_started', {cat: packId, mode:'pack', pack_id: packId});
      createGameRow('pack');
      _currentGameCountsDailyLimit = false; // local packs don't count toward daily limit
      showScreen('quiz');loadQ();
      return;
    }
  }
  
  // ── Quick play: load from DB, filter history, build gold-standard 10 ──
  // Show loading toast while we fetch from Supabase
  toast(lang==='ru' ? '⏳ Загружаем вопросы...' : '⏳ Loading questions...', 1800);

  // 1. Load published questions from DB
  const dbPool = await loadPublishedQuickQuestionsFromDB();

  if(dbPool.length === 0){
    // DB unavailable or no published questions at all
    toast(lang==='ru'
      ? '❌ Не удалось загрузить вопросы из базы'
      : "❌ Couldn't load questions", 3000);
    showNoFreshQuickQuestionsScreen();
    return;
  }

  // 2. Filter out already-seen questions (history: local + remote)
  const playedIds = await getPlayedQuestionIds('quick');
  let pool = dbPool.filter(q => !playedIds.has(String(q.id)));

  if(pool.length === 0){
    showNoFreshQuickQuestionsScreen();
    return;
  }

  // 3. Build exactly 10 questions by gold standard 2,2,3,3,4,4,5,5,6,6
  const standard = buildStandardPackQuestions(pool);

  if(!standard){
    // buildStandardPackQuestions shows toast with missing type counts
    // but we still want to show the "no fresh questions" screen (not just a toast)
    showNoFreshQuickQuestionsScreen();
    return;
  }

  // ✅ Questions are assembled — lock quick play NOW (game will definitely start)
  lockQuickPlayStarted();

  curQ = standard; // exactly 10, ordered 2×2opt,2×3opt,2×4opt,2×5opt,2×6opt
  // Note: _quickPlayRemaining limit is not applied here — DB always provides exactly 10.
  qIdx=0;correctCount=0;streak=0;bestStreak=0;_roundScore=0;
  _scoreShownForGame = false; // reset guard for new round

  // CRITICAL: sync globals → state.js so training.js pick()/nextQ() never
  // overwrites curQ/qIdx via _syncStateToLegacy() with stale state.js values
  if (window._appState && window._appState.setState) {
    window._appState.setState({
      curQ: curQ, qIdx: 0, correctCount: 0,
      streak: 0, bestStreak: 0, roundScore: 0, answered: false,
    });
  }

  buildDots('prog-dots',curQ.length);
  track('quiz_started', {cat: String(selectedCat), mode: selectedMode});
  _gameStartTime = Date.now();
  _gameId = null;
  createGameRow(selectedMode==='duel'?'duel':'quiz');
  startIntegrity('quiz');
  showScreen('quiz');loadQ();
}

// ═══════════════════════════════════════════
// QUIZ
// ═══════════════════════════════════════════

// [showExplanation] → deleted from legacy.js (now in ES module)



// [hideExplanation] → deleted from legacy.js (now in ES module)



// [loadQ] → deleted from legacy.js (now in ES module)



// [renderTimer] → deleted from legacy.js (now in ES module)


// [tick] → deleted from legacy.js (now in ES module)


// [expire] → deleted from legacy.js (now in ES module)


// [pick] → deleted from legacy.js (now in ES module)


// [updStreak] → deleted from legacy.js (now in ES module)


// [_updateNextBtnLabel] → deleted from legacy.js (now in ES module)


// [nextQ] → deleted from legacy.js (now in ES module)


// [loadScoreCityRank] → deleted from legacy.js (now in ES module)



// [spawnConfetti] → deleted from legacy.js (now in ES module)



// [showScore] → deleted from legacy.js (now in ES module)



// [restartQuiz] → deleted from legacy.js (now in ES module)


// Update score screen "Play again" button based on game type

// [updateScoreScreenButtons] → deleted from legacy.js (now in ES module)


// ─── SHARE ─────────────────────────────────────────────────────────────────

// [fetchCityRank] → deleted from legacy.js (now in ES module)



// [showShareScreen] → deleted from legacy.js (now in ES module)



// [getShareText] → deleted from legacy.js (now in ES module)



// [shareToTelegram] → deleted from legacy.js (now in ES module)


// [shareToWhatsApp] → deleted from legacy.js (now in ES module)


// [copyShareLink] → deleted from legacy.js (now in ES module)


// ─── PROFILE CITY ──────────────────────────────────────────────────────────

// [toggleCityEdit] → deleted from legacy.js (now in ES module)


// [saveProfileCity] → deleted from legacy.js (now in ES module)


// [renderProfileCity] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// DUEL — clean rewrite
// ═══════════════════════════════════════════
let duelCode=null,duelRole=null,duelPoll=null;
let duelQs=[],duelIdx=0,duelMyScore=0,duelOppScore=0;
let duelAnswered=false,duelTimer=null,duelTimeLeft=0,duelMaxT=0;
let duelMyName='You',duelOppNameStr='Соперник';
let botAnsweredThisQuestion = false; // per-question flag; reset in loadDuelQ

// Simulate bot answer independently of whether the player has answered.
// Uses qIndex to ignore stale timeouts that fired after "Next" was pressed.

// [simulateBotAnswer] → deleted from legacy.js (now in ES module)



// [showDuelSection] → deleted from legacy.js (now in ES module)



// [createDuel] → deleted from legacy.js (now in ES module)



// [joinDuel] → deleted from legacy.js (now in ES module)



// [startDuelPoll] → deleted from legacy.js (now in ES module)



// [startDuelGame] → deleted from legacy.js (now in ES module)



// [startDuelBattle] → deleted from legacy.js (now in ES module)



// [loadDuelQ] → deleted from legacy.js (now in ES module)



// [renderDuelTimer] → deleted from legacy.js (now in ES module)


// [duelTick] → deleted from legacy.js (now in ES module)


// [duelExpire] → deleted from legacy.js (now in ES module)


// [pickDuel] → deleted from legacy.js (now in ES module)


// [saveDuelScore] → deleted from legacy.js (now in ES module)


// [updateDuelScores] → deleted from legacy.js (now in ES module)


// [duelNextQ] → deleted from legacy.js (now in ES module)


// [endDuel] → deleted from legacy.js (now in ES module)

// ── Share функции для дуэли ──

// [_duelShareText] → deleted from legacy.js (now in ES module)


// [duelShareTG] → deleted from legacy.js (now in ES module)


// [duelShareWA] → deleted from legacy.js (now in ES module)


// [duelCopyLink] → deleted from legacy.js (now in ES module)


// [duelChallengeFriend] → deleted from legacy.js (now in ES module)



// [resetDuel] → deleted from legacy.js (now in ES module)


// [copyDuelLink] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// TOURNAMENT  (server-authoritative sync model)
// Single source of truth: Firebase room document
// Clients only write answers; host RPC advances questions
// ═══════════════════════════════════════════

// ── State ───────────────────────────────────────────────────────
let tCode       = null;   // 6-char room code
let tRole       = null;   // 'host' | 'guest'
let tMyUserId   = null;   // auth.uid() (guests require Firebase Anonymous Auth)
let tMyName     = 'Игрок';
let tQs         = [];     // question array (loaded once on start)
let tIdx        = 0;      // current question index (from server)
let tMyScore    = 0;
let tAnsweredThisQ = false; // guard: answer once per question
let tTimer      = null;   // local countdown interval
let tDeadlineMs = 0;      // server deadline as JS timestamp
let tQVersion   = 0;      // question_version from server (change = new Q)
let _fbTournUnsub = null; // Firebase unsubscribe handle
let tPoll       = null;   // fallback polling interval
let _tAdvanceLock = false; // local guard (Firebase transaction is primary guard)
let _tServerTimeOffset = 0; // estimated ms offset: serverTime = Date.now() + offset

// Estimate server time offset by comparing local time to Firebase server time
// Called once on room creation/join

// [estimateServerTimeOffset] → deleted from legacy.js (now in ES module)


// [localToServer] → deleted from legacy.js (now in ES module)


// [serverToLocal] → deleted from legacy.js (now in ES module)


// Derived: seconds per question by answer count

// [tSecondsForQ] → deleted from legacy.js (now in ES module)


// ── Screen helper ────────────────────────────────────────────────

// [showTournSection] → deleted from legacy.js (now in ES module)


// ── Cleanup: always call when leaving tournament ─────────────────

// [tCleanup] → deleted from legacy.js (now in ES module)


// ── Create room (host) ───────────────────────────────────────────

// [createTournament] → deleted from legacy.js (now in ES module)


// ── Join room (guest) ────────────────────────────────────────────

// [joinTournament] → deleted from legacy.js (now in ES module)


// ── Real-time room listener ──────────────────────────────────────

// [tListenRoom] → deleted from legacy.js (now in ES module)


// ── Central room update handler ──────────────────────────────────

// [tOnRoomUpdate] → deleted from legacy.js (now in ES module)


// ── Begin game (called once when status flips to playing) ────────

// [tBeginGame] → deleted from legacy.js (now in ES module)


// ── Load question from server room state ─────────────────────────

// [tLoadQFromRoom] → deleted from legacy.js (now in ES module)


// ── Timer tick: counts down toward server deadline ───────────────

// [tTickFromDeadline] → deleted from legacy.js (now in ES module)



// [tRenderTimer] → deleted from legacy.js (now in ES module)


// ── Local timer expired (no answer) ─────────────────────────────

// [tLocalExpire] → deleted from legacy.js (now in ES module)


// ── Player picks an answer ───────────────────────────────────────

// [tPickAnswer] → deleted from legacy.js (now in ES module)


// ── Write answer to server ───────────────────────────────────────
// tWriteAnswer: client sends only selected_idx.
// is_correct and points are NEVER trusted from client.
// For Firebase: host's Cloud Function (or host client logic) validates correctness
// using q.c which is stored locally on each client (loaded at game start).
// This is a known trade-off: without a Cloud Function, correctness validation
// lives in trusted client code (host). Full server validation requires Firebase CF.

// [tWriteAnswer] → deleted from legacy.js (now in ES module)


// ── Show waiting state after answering ───────────────────────────

// [tShowWaitingAfterAnswer] → deleted from legacy.js (now in ES module)


// ── Update waiting display from server participants ──────────────

// [tUpdateWaitDisplay] → deleted from legacy.js (now in ES module)


// ── Host: check if all answered, advance question ────────────────

// [tMaybeAdvanceAsHost] → deleted from legacy.js (now in ES module)


// ── Host: atomically advance to next question ────────────────────

// [tHostAdvanceQuestion] → deleted from legacy.js (now in ES module)


// ── Heartbeat: update last_seen every 8s ────────────────────────
let _tHeartbeatTimer = null;

// [tHeartbeat] → deleted from legacy.js (now in ES module)


// ── Spectator view (read-only) ───────────────────────────────────

// [tRenderSpectatorView] → deleted from legacy.js (now in ES module)


// ── Start tournament (host only) ─────────────────────────────────

// [startTournament] → deleted from legacy.js (now in ES module)


// ── Leaderboard renderers ────────────────────────────────────────

// [tRenderPlayerList] → deleted from legacy.js (now in ES module)



// [tRenderLeaderboardFromRoom] → deleted from legacy.js (now in ES module)


// ── Results screen ───────────────────────────────────────────────

// [tShowResults] → deleted from legacy.js (now in ES module)


// ── Reset for replay ─────────────────────────────────────────────

// [resetTournament] → deleted from legacy.js (now in ES module)


// ── Share функции турнира ──

// [_tournShareText] → deleted from legacy.js (now in ES module)


// [tournShareTG] → deleted from legacy.js (now in ES module)


// [tournShareWA] → deleted from legacy.js (now in ES module)


// [tournCopyLink] → deleted from legacy.js (now in ES module)



// [resetTournament] → deleted from legacy.js (now in ES module)


// [copyTournLink] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// WAITLIST
// ═══════════════════════════════════════════

// [submitWL] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// QUESTIONS FROM SUPABASE (with local fallback)
// ═══════════════════════════════════════════
let _remoteQsLoaded = false;
let _remoteQsPromise = null; // so startQuiz can await it


// [validateQuestion] → deleted from legacy.js (now in ES module)



// [loadRemoteQuestions] → deleted from legacy.js (now in ES module)



// ═══════════════════════════════════════════
// INIT — deferred until ES modules are ready
// ═══════════════════════════════════════════
// applyLang() uses setText() from router.js (ES module).
// ES modules load async after legacy.js, so we defer to DOMContentLoaded.
document.addEventListener('DOMContentLoaded', () => {
  if (typeof renderBadges === 'function') renderBadges();
  if (typeof applyLang   === 'function') applyLang();
  setLang('ru');
});

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


// [requestPushPermission] → deleted from legacy.js (now in ES module)


// Show a local notification (works without server push)

// [showLocalNotification] → deleted from legacy.js (now in ES module)


// Ask for notifications after first completed game (best moment — user just had fun)

// [maybeAskPushAfterGame] → deleted from legacy.js (now in ES module)


// Notify opponent of a duel challenge

// [notifyDuelChallenge] → deleted from legacy.js (now in ES module)


// Daily streak reminder (call once per day from loadDailyStreakData)

// [scheduleDailyStreakReminder] → deleted from legacy.js (now in ES module)


if('serviceWorker' in navigator){
  navigator.serviceWorker.register('/sw.js').catch(()=>{});
}

// Save pending ref on any page load (before auth)
savePendingRef();

// Check URL params
const urlP=new URLSearchParams(window.location.search);
if(urlP.get('duel'))document.getElementById('join-code-input').value=urlP.get('duel');
if(urlP.get('tourn'))document.getElementById('t-join-code').value=urlP.get('tourn');

// loadDailyState uses getTodayKey (now available above) — safe to call here
loadDailyState();
// loadRemoteQuestions and initAuth need ES modules — defer to DOMContentLoaded
// (initAuth is already called by app.js on DOMContentLoaded, so skip it here)
document.addEventListener('DOMContentLoaded', () => {
  if (typeof loadRemoteQuestions === 'function' && !_remoteQsPromise)
    _remoteQsPromise = loadRemoteQuestions();
});

// ═══════════════════════════════════════════
// DAILY STREAK SYSTEM
// ═══════════════════════════════════════════

// Local streak state (mirrors DB)
let _dailyStreak = 0;
let _bestDailyStreak = 0;
let _lastQuickPlayDate = null;
let _streakPlayedToday = false;


// [getTodayDateKey] → deleted from legacy.js (now in ES module)


// [getYesterdayDateKey] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// STREAK FREEZE — 30 ⚡ protection
// TODO (post-MVP): persist freeze in Supabase (profiles.streak_freeze_active
// or user_powerups table) so the economy is server-authoritative.
// Currently stored in localStorage only — can be tampered with by the user.
// Safe for demo/testing but not for real economy before server-side check.
// ═══════════════════════════════════════════
const STREAK_FREEZE_KEY   = 'mfc_streak_freeze_v1';
const STREAK_FREEZE_PRICE = 30;


// [getStreakFreeze] → deleted from legacy.js (now in ES module)



// [hasStreakFreeze] → deleted from legacy.js (now in ES module)



// [buyStreakFreeze] → deleted from legacy.js (now in ES module)



// [consumeStreakFreezeIfNeeded] → deleted from legacy.js (now in ES module)



// [loadDailyStreakData] → deleted from legacy.js (now in ES module)



// [updateDailyStreakOnQuickPlayComplete] → deleted from legacy.js (now in ES module)



// [renderDailyStreakUI] → deleted from legacy.js (now in ES module)



// [showStreakCelebration] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// ONBOARDING — live 3-question demo
// ═══════════════════════════════════════════
const OB_DEMO_QUESTIONS = [
  { q: 'Какая планета ближайшая к Солнцу?', a: ['Меркурий','Венера','Земля','Марс'], c: 0, emoji: '☀️' },
  { q: 'Сколько цветов в радуге?', a: ['5','6','7','8'], c: 2, emoji: '🌈' },
  { q: 'Кто написал «Война и мир»?', a: ['Достоевский','Толстой','Чехов','Пушкин'], c: 1, emoji: '📚' },
];
let _obQIdx  = 0;
let _obScore = 0;
let _obAnswered = false;


// [startObDemo] → deleted from legacy.js (now in ES module)



// [renderObQuestion] → deleted from legacy.js (now in ES module)



// [obPickAnswer] → deleted from legacy.js (now in ES module)



// [obNextQuestion] → deleted from legacy.js (now in ES module)



// [showObResult] → deleted from legacy.js (now in ES module)



// [shouldShowOnboarding] → deleted from legacy.js (now in ES module)



// [showOnboarding] → deleted from legacy.js (now in ES module)



// [skipOnboarding] → deleted from legacy.js (now in ES module)



// [finishOnboarding] → deleted from legacy.js (now in ES module)


// ═══════════════════════════════════════════
// SHARE SCREEN — enhanced
// ═══════════════════════════════════════════


// [buildShareText] → deleted from legacy.js (now in ES module)


// Override showShareScreen — deferred until ES modules expose window.showShareScreen
document.addEventListener('DOMContentLoaded', () => {
  const _origShowShareScreen = window.showShareScreen;
  if (!_origShowShareScreen) return;
  window.showShareScreen = async function(){
    await _origShowShareScreen.apply(this, arguments);
    const streakRow = document.getElementById('share-streak-row');
    const levelRow  = document.getElementById('share-level-row');
    if(streakRow){
      if(_dailyStreak > 0){
        streakRow.textContent  = lang==='ru' ? `🔥 Серия: ${_dailyStreak} дней` : `🔥 Streak: ${_dailyStreak} days`;
        streakRow.style.display = '';
      } else {
        streakRow.style.display = 'none';
      }
    }
    if(levelRow){
      const level = getPlayerLevel(neurons);
      const levelName = level.name[lang] || level.name.en;
      levelRow.textContent  = `${level.icon} ${lang==='ru'?'Уровень':'Level'}: ${levelName}`;
      levelRow.style.display = '';
    }
  };
});

// ── All ES-module-dependent overrides deferred to DOMContentLoaded ──
document.addEventListener('DOMContentLoaded', () => {

  // Override share functions to use buildShareText
  if (typeof window.shareToTelegram === 'function') {
    window.shareToTelegram = function(){
      track('share_to_telegram_clicked', {score: _roundScore, correct: correctCount});
      const text = encodeURIComponent(window.buildShareText ? window.buildShareText() : '');
      window.open('https://t.me/share/url?url='+encodeURIComponent(location.origin+location.pathname)+'&text='+text,'_blank');
    };
  }
  if (typeof window.shareToWhatsApp === 'function') {
    window.shareToWhatsApp = function(){
      track('share_to_whatsapp_clicked', {score: _roundScore, correct: correctCount});
      const text = encodeURIComponent(window.buildShareText ? window.buildShareText() : '');
      window.open('https://wa.me/?text='+text,'_blank');
    };
  }
  if (typeof window.copyShareLink === 'function') {
    window.copyShareLink = function(){
      track('copy_share_clicked', {score: _roundScore, correct: correctCount});
      const text = window.buildShareText ? window.buildShareText() : '';
      navigator.clipboard.writeText(text).then(()=>{
        const btn = document.getElementById('sh-copy');
        if(btn){ btn.textContent='✓ '+(lang==='ru'?'Скопировано!':'Copied!'); setTimeout(()=>btn.textContent=lang==='ru'?'🔗 Скопировать':'🔗 Copy',2000); }
      }).catch(()=>{ toast(lang==='ru'?'Не удалось скопировать':'Copy failed'); });
    };
  }

  // HOOK showScore TO TRIGGER STREAK UPDATE
  if (typeof window.showScore === 'function') {
    const _origShowScore_v68 = window.showScore;
    window.showScore = function(){
      _origShowScore_v68.apply(this, arguments);
      setTimeout(()=> { if(typeof updateDailyStreakOnQuickPlayComplete==='function') updateDailyStreakOnQuickPlayComplete(); }, 800);
    };
  }

  // Hook showScreen home to load streak
  if (typeof window.showScreen === 'function') {
    const _origShowScreenV67 = window.showScreen;
    window.showScreen = function(id){
      _origShowScreenV67.apply(this, arguments);
      if(id==='home') {
        if(typeof renderDailyStreakUI==='function') renderDailyStreakUI();
        if(currentUser && !playerInventory.length) _loadCharacterDataIfNeeded();
        if(currentUser) renderCharacter();
      }
      if(id==='profile'){
        if(currentUser && !playerInventory.length) _loadCharacterDataIfNeeded();
        renderCharacter();
      }
      if(id==='character'){
        renderCharacter();
        showCharTab('appearance');
        // Load inventory/shop then render presets (async)
        const nEl = document.getElementById('n-character');
        if(nEl) nEl.textContent = neurons;
        Promise.all([loadPlayerInventory(), loadShopItems()]).then(()=>{
          renderAvatarPresets();
          renderInventoryInline();
          renderShopItemsInline();
        });
      }
    };
  }

}); // end DOMContentLoaded

// [challengeFriendFromShare] → deleted from legacy.js (now in ES module)
// _origOnUserLoaded_v68 — removed (onUserLoaded no longer exists as global)

// Load streak on first auth
setTimeout(async ()=>{
  if(currentUser) await loadDailyStreakData();
}, 1500);

// ═══════════════════════════════════════════
// CHARACTER & INVENTORY SYSTEM MVP
// ═══════════════════════════════════════════

// ── Avatar presets ────────────────────────
const AVATAR_PRESETS = [
  {code:'brain_fighter', icon:'🧠', name:'Brain Fighter'},
  {code:'cyber_kid',     icon:'🤖', name:'Cyber Kid'},
  {code:'wizard',        icon:'🧙', name:'Wizard'},
  {code:'ninja',         icon:'🥷', name:'Ninja'},
  {code:'robot',         icon:'🦾', name:'Robot'},
  {code:'scholar',       icon:'📚', name:'Scholar'},
];
const ACCESSORY_PRESETS = [
  {code:'none',       icon:'⠀',  name:'Нет'},
  {code:'glasses',    icon:'🕶️',  name:'Очки'},
  {code:'mask',       icon:'😷', name:'Маска'},
  {code:'headphones', icon:'🎧', name:'Наушники'},
  {code:'aura',       icon:'✨', name:'Аура'},
  {code:'crown',      icon:'👑', name:'Корона'},
];

// ── State ─────────────────────────────────
let shopItems = [];          // from Supabase shop_items
let playerInventory = [];    // from Supabase player_inventory
let equippedCosmetics = {};  // loaded from Supabase profiles
let currentShopTab = 'cosmetic';
let currentCharTab = 'appearance';

// ── Powerup session state ─────────────────
let swordUsedThisSession = false;

// ─────────────────────────────────────────
// SHOW CHARACTER SCREEN
// ─────────────────────────────────────────
async function showCharacterScreen(){
  showScreen('character');
  document.getElementById('n-character').textContent = neurons;
  renderCharacter();
  await Promise.all([loadPlayerInventory(), loadShopItems()]);
  renderAvatarPresets();
  renderInventoryInline();
  renderShopItemsInline();
}

function showCharTab(tab){
  currentCharTab = tab;
  ['appearance','inventory','shop'].forEach(t=>{
    const el = document.getElementById('char-tab-'+t);
    if(el) el.style.display = (t===tab) ? '' : 'none';
  });
  if(tab==='inventory') renderInventoryInline();
  if(tab==='shop') renderShopItemsInline();
}

// ─────────────────────────────────────────
// RENDER CHARACTER (emoji composition)
// ─────────────────────────────────────────
function renderCharacter(){
  const avatarCode = equippedCosmetics.avatar_base || 'brain_fighter';
  const accCode    = equippedCosmetics.accessory || 'none';

  const avatarP = AVATAR_PRESETS.find(p=>p.code===avatarCode) || AVATAR_PRESETS[0];
  const accP    = ACCESSORY_PRESETS.find(p=>p.code===accCode) || ACCESSORY_PRESETS[0];

  const mainEl = document.getElementById('char-avatar-main');
  const subEl  = document.getElementById('char-avatar-accessory');
  if(mainEl) mainEl.textContent = avatarP.icon;
  if(subEl)  subEl.textContent  = accP.code !== 'none' ? accP.icon : '⠀';

  // Neurons and level in character screen
  const lvl = getPlayerLevel(neurons);
  const levelEl = document.getElementById('char-level-text');
  const neurEl  = document.getElementById('char-neurons-display');
  if(levelEl) levelEl.textContent = lvl.name[lang] || lvl.name.ru;
  if(neurEl)  neurEl.textContent  = neurons;

  // Update profile avatar in profile screen too
  const profileAv = document.getElementById('profile-av');
  if(profileAv) profileAv.textContent = avatarP.icon;
}

// ─────────────────────────────────────────
// LOAD PLAYER INVENTORY FROM SUPABASE
// ─────────────────────────────────────────
async function loadPlayerInventory(){
  playerInventory = [];
  if(!currentUser) return;
  try{
    const {data, error} = await sb.from('player_inventory')
      .select('*, shop_items(*)')
      .eq('user_id', currentUser.id);
    if(!error && data) playerInventory = data;
  }catch(e){ console.warn('[MFC] loadPlayerInventory error:', e.message); }

  // Load equipped cosmetics from profiles
  try{
    const {data: pd} = await sb.from('profiles')
      .select('equipped_avatar_base,equipped_accessory')
      .eq('id', currentUser.id).single();
    if(pd){
      equippedCosmetics.avatar_base = pd.equipped_avatar_base || 'brain_fighter';
      equippedCosmetics.accessory   = pd.equipped_accessory || 'none';
    }
  }catch(e){}
  renderCharacter();
}

// ─────────────────────────────────────────
// LOAD SHOP ITEMS FROM SUPABASE
// ─────────────────────────────────────────
async function loadShopItems(){
  shopItems = [];
  try{
    const {data, error} = await sb.from('shop_items')
      .select('*').eq('is_active', true).order('price_neurons');
    if(!error && data) shopItems = data;
  }catch(e){ console.warn('[MFC] loadShopItems error:', e.message); }
}

// ─────────────────────────────────────────
// AVATAR PRESETS RENDER
// ─────────────────────────────────────────
function renderAvatarPresets(){
  const avatarGrid = document.getElementById('char-avatar-presets');
  const accGrid    = document.getElementById('char-accessory-presets');
  if(!avatarGrid || !accGrid) return;

  const currentAvatar = equippedCosmetics.avatar_base || 'brain_fighter';
  const currentAcc    = equippedCosmetics.accessory || 'none';

  // Check which avatar cosmetics are owned (from shop or defaults)
  const ownedCodes = new Set(['brain_fighter','scholar']); // free defaults
  playerInventory.forEach(inv=>{
    if(inv.shop_items?.type==='cosmetic') ownedCodes.add(inv.shop_items.code);
  });

  avatarGrid.innerHTML = AVATAR_PRESETS.map(p=>{
    const isOwned    = ownedCodes.has(p.code);
    const isEquipped = p.code === currentAvatar;
    // Find in shop
    const shopItem = shopItems.find(s=>s.code===('avatar_'+p.code.replace('avatar_','')) || s.code.includes(p.code));
    const locked = !isOwned && shopItem;
    return `<div class="preset-card ${isEquipped?'equipped':''}" onclick="tryEquipAvatar('${p.code}')">
      <div class="preset-icon">${p.icon}</div>
      <div class="preset-name">${p.name}${isEquipped?' ✓':locked?' 🔒':''}</div>
    </div>`;
  }).join('');

  const accOwnedCodes = new Set(['none','mask','headphones']); // free defaults
  playerInventory.forEach(inv=>{
    if(inv.shop_items?.cosmetic_slot==='accessory') accOwnedCodes.add(inv.shop_items.code.replace('accessory_',''));
  });

  accGrid.innerHTML = ACCESSORY_PRESETS.map(p=>{
    const isOwned    = accOwnedCodes.has(p.code);
    const isEquipped = p.code === currentAcc;
    const shopItem   = shopItems.find(s=>s.code==='accessory_'+p.code);
    const locked = !isOwned && shopItem;
    return `<div class="preset-card ${isEquipped?'equipped':''}" onclick="tryEquipAccessory('${p.code}')">
      <div class="preset-icon">${p.icon}</div>
      <div class="preset-name">${p.name}${isEquipped?' ✓':locked?' 🔒':''}</div>
    </div>`;
  }).join('');
}

async function tryEquipAvatar(code){
  // Check if owned or free
  const freeCodes = ['brain_fighter','scholar'];
  if(freeCodes.includes(code)){
    await equipCosmetic('avatar_base', code);
    return;
  }
  // Check shop
  const shopItem = shopItems.find(s=>s.cosmetic_slot==='avatar_base' && s.code.includes(code.replace('avatar_','')));
  if(shopItem){
    const owned = playerInventory.some(inv=>inv.shop_items?.code === shopItem.code);
    if(owned){
      await equipCosmetic('avatar_base', code);
    } else {
      toast(lang==='ru'?'🔒 Купи в магазине!':'🔒 Buy in the shop!');
      showCharTab('shop');
    }
  } else {
    await equipCosmetic('avatar_base', code);
  }
}

async function tryEquipAccessory(code){
  const freeCodes = ['none','mask','headphones'];
  if(freeCodes.includes(code)){
    await equipCosmetic('accessory', code);
    return;
  }
  const shopItem = shopItems.find(s=>s.cosmetic_slot==='accessory' && s.code==='accessory_'+code);
  if(shopItem){
    const owned = playerInventory.some(inv=>inv.shop_items?.code === shopItem.code);
    if(owned){
      await equipCosmetic('accessory', code);
    } else {
      toast(lang==='ru'?'🔒 Купи в магазине!':'🔒 Buy in the shop!');
      showCharTab('shop');
    }
  } else {
    await equipCosmetic('accessory', code);
  }
}

// ─────────────────────────────────────────
// EQUIP COSMETIC
// ─────────────────────────────────────────
async function equipCosmetic(slot, code){
  equippedCosmetics[slot] = code;
  renderCharacter();
  renderAvatarPresets();
  toast(lang==='ru'?'✓ Экипировано!':'✓ Equipped!');
  // Save to Supabase
  if(!currentUser) return;
  try{
    const update = {};
    if(slot==='avatar_base') update.equipped_avatar_base = code;
    if(slot==='accessory')   update.equipped_accessory   = code;
    await sb.from('profiles').update(update).eq('id', currentUser.id);
  }catch(e){ console.warn('[MFC] equipCosmetic save error:', e.message); }
  // Update equipped flag in player_inventory if item exists there
  if(code !== 'none'){
    const invItem = playerInventory.find(inv=>inv.shop_items?.cosmetic_slot===slot);
    if(invItem){
      // Unequip all of this slot, equip the right one
      playerInventory.forEach(inv=>{
        if(inv.shop_items?.cosmetic_slot===slot) inv.equipped = false;
      });
      const target = playerInventory.find(inv=>
        inv.shop_items?.code===('accessory_'+code) || inv.shop_items?.code===('avatar_'+code) || inv.shop_items?.code===code
      );
      if(target) target.equipped = true;
    }
  }
}

// ─────────────────────────────────────────
// SHOP RENDER
// ─────────────────────────────────────────
function switchShopTab(tab){
  currentShopTab = tab;
  document.getElementById('char-shop-tab-cosmetic').classList.toggle('active', tab==='cosmetic');
  document.getElementById('char-shop-tab-powerup').classList.toggle('active', tab==='powerup');
  renderShopItemsInline();
}

function renderShopItemsInline(){
  const grid = document.getElementById('char-shop-items');
  if(!grid) return;

  const filtered = shopItems.filter(s=>s.type===currentShopTab);
  if(!filtered.length){
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:30px 0;color:var(--muted);font-size:13px">Товаров пока нет</div>`;
    return;
  }

  grid.innerHTML = filtered.map(item=>{
    const ownedEntry = playerInventory.find(inv=>inv.item_id===item.id);
    const owned      = !!ownedEntry;
    const qty        = ownedEntry?.quantity || 0;
    const price      = item.price_neurons;
    const canAfford  = neurons >= price;
    const rarityClass= 'rarity-'+(item.rarity||'common');

    let btnHtml = '';
    if(item.type==='cosmetic'){
      if(owned){
        const slotCode = item.cosmetic_slot==='avatar_base'
          ? item.code.replace('avatar_','')
          : item.code.replace('accessory_','');
        const isEq = (item.cosmetic_slot==='avatar_base' && equippedCosmetics.avatar_base===slotCode)
                  || (item.cosmetic_slot==='accessory'   && equippedCosmetics.accessory===slotCode);
        btnHtml = isEq
          ? `<button class="shop-item-btn owned">✓ Экипировано</button>`
          : `<button class="shop-item-btn equip" onclick="buyAndEquip('${item.code}')">Экипировать</button>`;
      } else {
        btnHtml = `<button class="shop-item-btn buy" ${!canAfford?'disabled style="opacity:.4"':''} onclick="buyShopItem('${item.code}')">Купить — ${price} ⚡</button>`;
      }
    } else { // powerup
      btnHtml = `<button class="shop-item-btn buy" ${!canAfford?'disabled style="opacity:.4"':''} onclick="buyShopItem('${item.code}')">Купить — ${price} ⚡</button>`;
      if(owned) btnHtml += `<div class="shop-item-qty">В инвентаре: ${qty}</div>`;
    }

    return `<div class="shop-item-card ${rarityClass} ${owned&&item.type==='cosmetic'?'owned':''}">
      ${item.rarity && item.rarity!=='common' ? `<div class="shop-item-badge">${({rare:'Rare',epic:'Epic',legendary:'Legendary'}[item.rarity]||'')}</div>`:''}
      <div class="shop-item-icon">${item.icon||'📦'}</div>
      <div class="shop-item-rarity ${item.rarity||'common'}">${item.rarity||'common'}</div>
      <div class="shop-item-name">${lang==='ru'?(item.title_ru||item.title_en):(item.title_en||item.title_ru)}</div>
      <div class="shop-item-desc">${lang==='ru'?(item.description_ru||item.description_en||''):(item.description_en||item.description_ru||'')}</div>
      ${btnHtml}
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
// BUY ITEM  (inventory-first, safe purchase)
// ─────────────────────────────────────────
async function buyShopItem(itemCode){
  // Guard: must be logged in
  if(!currentUser){
    toast(lang==='ru'?'Войдите, чтобы покупать предметы.':'Sign in to buy items.');
    return;
  }
  // Find item
  const item = shopItems.find(s=>s.code===itemCode);
  if(!item){ toast(lang==='ru'?'Предмет не найден.':'Item not found.'); return; }

  // Guard: enough neurons
  if(neurons < item.price_neurons){
    toast(lang==='ru'?'Недостаточно нейронов.':'Not enough neurons.');
    return;
  }

  // Guard: cosmetic already owned
  if(item.type==='cosmetic'){
    const alreadyOwned = playerInventory.some(inv=>inv.item_id===item.id);
    if(alreadyOwned){ toast(lang==='ru'?'Уже куплено!':'Already owned!'); return; }
  }

  // Disable button visually during purchase
  const buyBtn = document.querySelector(`[onclick="buyShopItem('${itemCode}')"]`);
  if(buyBtn){ buyBtn.disabled=true; buyBtn.style.opacity='0.5'; buyBtn.textContent=lang==='ru'?'Покупка...':'Buying...'; }

  // STEP 1: write inventory first (no money deducted yet)
  try{
    const existingEntry = playerInventory.find(inv=>inv.item_id===item.id);
    let savedEntry = null;

    if(existingEntry && item.type==='powerup'){
      const newQty = (existingEntry.quantity||1) + 1;
      const {error} = await sb.from('player_inventory')
        .update({quantity: newQty, updated_at: new Date().toISOString()})
        .eq('id', existingEntry.id);
      if(error) throw error;
      existingEntry.quantity = newQty;
      savedEntry = existingEntry;
    } else {
      const {data: newEntry, error} = await sb.from('player_inventory').insert({
        user_id: currentUser.id, item_id: item.id,
        quantity: 1, equipped: false,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString()
      }).select('*, shop_items(*)').single();
      if(error) throw error;
      if(newEntry) playerInventory.push(newEntry);
      savedEntry = newEntry;
    }

    // STEP 2: inventory saved — now deduct neurons via server RPC
    const spendResult = await spendNeurons(
      item.price_neurons, 'shop_item', 'shop:' + itemCode + ':' + (currentUser?.id||'')
    );
    if(!spendResult || !spendResult.ok){
      // Rollback: remove from inventory
      playerInventory = playerInventory.filter(inv=>inv.item_id!==item.id);
      toast(lang==='ru'?'❌ Ошибка списания нейронов':'❌ Neuron deduction failed');
      return;
    }
    const charNEl = document.getElementById('n-character');
    if(charNEl) charNEl.textContent = neurons;

    // Success UI
    const itemName = lang==='ru'?(item.title_ru||item.title_en):(item.title_en||item.title_ru);
    toast(`✅ ${itemName} ${lang==='ru'?'куплено':'purchased'}! (-${item.price_neurons} ⚡)`);
    renderShopItemsInline();
    renderInventoryInline();
    updatePowerupUI();
    track('item_purchased', {item_code: itemCode, price: item.price_neurons});

  }catch(e){
    // Inventory write failed — no neurons deducted, nothing to refund
    console.error('[MFC] buyShopItem error:', e);
    toast(lang==='ru'?`Ошибка покупки: ${e.message||'попробуй ещё раз'}`:`Purchase failed: ${e.message||'try again'}`);
    // Re-enable button
    if(buyBtn){ buyBtn.disabled=false; buyBtn.style.opacity=''; buyBtn.textContent=`${lang==='ru'?'Купить':'Buy'} — ${item.price_neurons} ⚡`; }
  }
}

async function buyAndEquip(itemCode){
  // For owned cosmetics: just equip
  const item = shopItems.find(s=>s.code===itemCode);
  if(!item) return;
  if(item.type!=='cosmetic') return;
  const slotCode = item.cosmetic_slot==='avatar_base'
    ? item.code.replace('avatar_','')
    : item.code.replace('accessory_','');
  await equipCosmetic(item.cosmetic_slot, slotCode);
  renderShopItemsInline();
}

// ─────────────────────────────────────────
// INVENTORY RENDER
// ─────────────────────────────────────────
function renderInventoryInline(){
  const container = document.getElementById('char-inv-content');
  if(!container) return;

  if(!currentUser){
    container.innerHTML = `<div class="inv-empty"><div class="inv-empty-icon">🔐</div><div class="inv-empty-text">Войдите, чтобы видеть инвентарь</div></div>`;
    return;
  }

  if(!playerInventory.length){
    container.innerHTML = `<div class="inv-empty">
      <div class="inv-empty-icon">🎒</div>
      <div class="inv-empty-text">У тебя пока нет предметов.<br>Зайди в <b>Магазин</b>.</div>
    </div>`;
    return;
  }

  container.innerHTML = playerInventory.map(inv=>{
    const item = inv.shop_items;
    if(!item) return '';
    const isCosmetic = item.type==='cosmetic';
    const slotCode   = isCosmetic
      ? (item.cosmetic_slot==='avatar_base' ? item.code.replace('avatar_','') : item.code.replace('accessory_',''))
      : null;
    const isEquipped = isCosmetic && (
      (item.cosmetic_slot==='avatar_base' && equippedCosmetics.avatar_base===slotCode) ||
      (item.cosmetic_slot==='accessory'   && equippedCosmetics.accessory===slotCode)
    );

    const actions = isCosmetic
      ? `<button class="inv-btn ${isEquipped?'equipped':'equip'}" onclick="${isEquipped?'':' buyAndEquip(\''+item.code+'\')'}">${isEquipped?'✓ Экипировано':'Экипировать'}</button>`
      : `<button class="inv-btn buy-more" onclick="switchShopTab('powerup');showCharTab('shop')">Купить ещё</button>`;

    return `<div class="inv-item-card ${isEquipped?'equipped-item':''}">
      <div class="inv-item-icon">${item.icon||'📦'}</div>
      <div class="inv-item-info">
        <div class="inv-item-name">${lang==='ru'?(item.title_ru||item.title_en):(item.title_en||item.title_ru)}</div>
        <div class="inv-item-qty">${isCosmetic?'Косметика':'x'+inv.quantity+' шт.'}</div>
      </div>
      <div class="inv-item-actions">${actions}</div>
    </div>`;
  }).join('');
}

// ─────────────────────────────────────────
// POWERUP HELPERS
// ─────────────────────────────────────────
function getPowerupQuantity(itemCode){
  const inv = playerInventory.find(i=>i.shop_items?.code===itemCode);
  return inv ? (inv.quantity||0) : 0;
}

function canUsePowerupsInCurrentMode(){
  // Only in Quick Play (not duels/tournaments/official tournament)
  const activeScreen = document.querySelector('.screen.active');
  return activeScreen && activeScreen.id === 'quiz';
}

// ─────────────────────────────────────────
// POWERUP UI IN QUIZ
// ─────────────────────────────────────────
function updatePowerupUI(){
  const bar  = document.getElementById('powerup-bar');
  const btns = document.getElementById('powerup-btns');
  if(!bar || !btns) return;

  // Only show for logged-in users in quiz mode
  if(!currentUser || !canUsePowerupsInCurrentMode()){
    bar.style.display = 'none';
    return;
  }

  const swordQty = getPowerupQuantity('sword_remove_one');
  if(swordQty <= 0 && !swordUsedThisSession){
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';

  const swordDisabled = swordUsedThisSession || answered || swordQty <= 0;
  const swordClass    = swordUsedThisSession ? 'used' : (swordQty <= 0 ? 'no-items' : '');
  btns.innerHTML = `<button class="powerup-btn ${swordClass}" id="sword-btn"
    ${swordDisabled?'disabled':''}
    onclick="useSwordPowerup()">
    ⚔️ Меч${swordQty > 0 ? ' x'+swordQty : ''}
  </button>`;
}

// ─────────────────────────────────────────
// SWORD POWERUP
// ─────────────────────────────────────────
async function useSwordPowerup(){
  if(!currentUser){
    toast(lang==='ru'?'Войдите чтобы использовать предметы':'Sign in to use items');
    return;
  }
  if(swordUsedThisSession){
    toast(lang==='ru'?'⚔️ Меч уже использован в этой игре.':'⚔️ Sword already used this game.');
    return;
  }
  if(answered){
    toast(lang==='ru'?'Уже ответили на этот вопрос.':'Already answered this question.');
    return;
  }

  const swordQty = getPowerupQuantity('sword_remove_one');
  if(swordQty <= 0){
    toast(lang==='ru'?'⚔️ У тебя нет мечей. Купи в магазине.':'⚔️ You have no swords. Buy in the shop.');
    return;
  }

  hideWrongAnswer();
  swordUsedThisSession = true;

  // Decrement quantity in Supabase
  const inv = playerInventory.find(i=>i.shop_items?.code==='sword_remove_one');
  if(inv){
    inv.quantity = Math.max(0, (inv.quantity||1) - 1);
    try{
      await sb.from('player_inventory')
        .update({quantity: inv.quantity, updated_at: new Date().toISOString()})
        .eq('id', inv.id);
    }catch(e){ console.warn('[MFC] sword decrement error:', e.message); }
  }

  // Log usage
  try{
    const q = curQ && curQ[qIdx];
    await sb.from('player_powerup_usage').insert({
      user_id: currentUser.id,
      item_code: 'sword_remove_one',
      game_session_id: _gameId || null,
      question_id: q?._id || null,
      used_at: new Date().toISOString()
    });
  }catch(e){}

  updatePowerupUI();
  toast(lang==='ru'?'⚔️ Меч использован — один неверный вариант убран!':'⚔️ Sword used — one wrong answer removed!');
  track('powerup_used', {item_code:'sword_remove_one', q_idx: qIdx});
}

function hideWrongAnswer(){
  const q = curQ && curQ[qIdx];
  if(!q) return;
  const correctIdx = q.c;
  const buttons    = document.querySelectorAll('#answers .ans');
  if(!buttons.length) return;

  // Collect wrong indices (not yet disabled/styled)
  const wrongIdxs = [];
  buttons.forEach((btn, i)=>{
    if(i !== correctIdx && !btn.disabled) wrongIdxs.push(i);
  });

  if(!wrongIdxs.length) return;

  // Pick a random wrong one
  const removeIdx = wrongIdxs[Math.floor(Math.random() * wrongIdxs.length)];
  const btn = buttons[removeIdx];
  btn.disabled = true;
  btn.style.opacity = '0.2';
  btn.style.pointerEvents = 'none';
  btn.style.transform = 'scale(0.97)';
  btn.style.transition = 'opacity 0.3s, transform 0.3s';
}

// ─────────────────────────────────────────
// RESET SWORD ON NEW GAME
// ─────────────────────────────────────────
// Patch startQuiz to reset sword state
const _origStartQuiz_forSword = typeof startQuiz === 'function' ? startQuiz : null;

// Hook into loadQ to reset sword flag per game session (not per question)
// We track by game ID — sword resets when a new quiz starts
let _lastSwordGameId = null;
function _resetSwordForNewGame(){
  if(_gameId !== _lastSwordGameId){
    _lastSwordGameId = _gameId;
    swordUsedThisSession = false;
  }
}

// Patch loadQ and pick — deferred: these come from ES modules
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.loadQ === 'function') {
    const _origLoadQ = window.loadQ;
    window.loadQ = function(){
      _origLoadQ.apply(this, arguments);
      _resetSwordForNewGame();
      setTimeout(updatePowerupUI, 30);
    };
  }
  if (typeof window.pick === 'function') {
    const _origPick = window.pick;
    window.pick = function(i){
      _origPick.apply(this, arguments);
      setTimeout(updatePowerupUI, 30);
    };
  }
});

// ─────────────────────────────────────────
// LOAD INVENTORY ON LOGIN (non-blocking)
// ─────────────────────────────────────────
// initAuth moved to js/auth/auth.js ES module — do not reference here
// We hook into updateProfileUI which runs after auth

async function _loadCharacterDataIfNeeded(){
  if(!currentUser) return;
  // Load quietly in background
  try{
    await Promise.all([loadShopItems(), loadPlayerInventory()]);
    updatePowerupUI();
  }catch(e){}
}

// Override updNeurons — deferred: comes from ES module wallet.js
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.updNeurons === 'function') {
    const _origUpdNeurons = window.updNeurons;
    window.updNeurons = function(){
      _origUpdNeurons.apply(this, arguments);
      const charN = document.getElementById('char-neurons-display');
      if(charN) charN.textContent = neurons;
      const charNH = document.getElementById('n-character');
      if(charNH) charNH.textContent = neurons;
    };
  }
});

// ─────────────────────────────────────────
// HEALTH CHECK: add shop_items and player_inventory tables
// ─────────────────────────────────────────
const _origRunHealthCheck = typeof runHealthCheck === 'function' ? runHealthCheck : null;
runHealthCheck = async function(){
  if(_origRunHealthCheck) await _origRunHealthCheck.apply(this, arguments);
  // Additional checks for character system tables
  const el = document.getElementById('admin-health-list');
  if(!el) return;
  const charTables = ['shop_items','player_inventory','player_powerup_usage'];
  for(const t of charTables){
    try{
      const {error} = await sb.from(t).select('id').limit(1);
      const ok = !error;
      el.innerHTML += `<div style="display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:0.5px solid var(--border)">
        <span style="color:${ok?'var(--green)':'var(--red)'};flex-shrink:0">${ok?'✅':'❌'}</span>
        <span style="font-size:12px;color:${ok?'var(--muted)':'var(--red)'}">Table: ${t}${!ok?' — run character_inventory_migration.sql':''}</span>
      </div>`;
    }catch(e){}
  }
};

// loadQ, pick are defined later in the file as named functions,
// so the patching above runs after them. But since they're function declarations
// we need an alternative: we patch via the window object after DOMContentLoaded.
// Actually since this script block runs sequentially and loadQ/pick are defined
// as function declarations earlier (hoisted), the const _orig = loadQ is valid.
// The reassignment loadQ = function(){...} works as long as loadQ isn't const/let.
// In MFC-66, loadQ and pick are plain function declarations, so this works.

// ═══════════════════════════════════════════════════════════════
// ADMIN IMPORT WIZARD
// ═══════════════════════════════════════════════════════════════

let _importFiles     = {};   // filename → {content|blob, type, matched}
let _importQuestions = [];   // parsed question objects
let _importEditIdx   = null;
let _importBatchKey  = '';   // shared key for all questions in this import

function showAdminImportWizard(){
  showScreen('admin-import');
  _importFiles     = {};
  _importQuestions = [];
  _importBatchKey  = 'batch_' + Date.now();
  document.getElementById('import-step-2').style.display   = 'none';
  document.getElementById('import-step-3').style.display   = 'none';
  document.getElementById('import-edit-modal').style.display = 'none';
  var pr = document.getElementById('import-parse-result');
  if(pr){ pr.style.display='none'; pr.textContent=''; }
  _setImportStep(1);
  // Show/hide pack fields based on save mode
  document.getElementById('import-save-mode').onchange = _onImportSaveModeChange;
  _onImportSaveModeChange();
}

function _onImportSaveModeChange(){
  const mode = document.getElementById('import-save-mode').value;
  const packFields = document.getElementById('import-pack-fields');
  const existSel   = document.getElementById('import-existing-pack-wrap');
  if(packFields)  packFields.style.display   = mode === 'new-pack' ? 'flex' : 'none';
  if(existSel)    existSel.style.display     = mode === 'existing-pack' ? 'flex' : 'none';
  if(mode === 'existing-pack') _loadExistingPacksForImport();
}

async function _loadExistingPacksForImport(){
  const sel = document.getElementById('import-existing-pack-sel');
  if(!sel) return;
  sel.innerHTML = '<option value="">Загрузка...</option>';
  const {data} = await sb.from('game_packs').select('id,title_ru,import_key').order('title_ru');
  if(!data || !data.length){ sel.innerHTML = '<option value="">Нет паков</option>'; return; }
  sel.innerHTML = data.map(p => '<option value="' + p.id + '">' + (p.title_ru || p.import_key) + '</option>').join('');
}

function _setImportStep(n){
  [1,2,3,4].forEach(function(i){
    var el = document.getElementById('imp-s'+i);
    if(!el) return;
    el.style.color      = i === n ? 'var(--accent2)' : '';
    el.style.fontWeight = i === n ? '800' : '400';
  });
}

function handleImportDrop(e){
  e.preventDefault();
  document.getElementById('import-drop-zone').classList.remove('drag-over');
  var file = e.dataTransfer.files[0];
  if(file) handleImportFile(file);
}

async function handleImportFile(file){
  if(!file) return;
  toast('📦 Обрабатываем файл...');
  _importFiles     = {};
  _importQuestions = [];

  var name = file.name.toLowerCase();

  if(name.endsWith('.zip')){
    await parseZipBundle(file);
  } else if(name.endsWith('.csv')){
    var text = await file.text();
    _importFiles['__main.csv'] = {content: text, type: 'csv'};
    _showImportFileList();
  } else if(name.endsWith('.txt')){
    var text2 = await file.text();
    _importFiles['__main.txt'] = {content: text2, type: 'txt'};
    _showImportFileList();
  } else if(name.endsWith('.json')){
    var text3 = await file.text();
    _importFiles['__main.json'] = {content: text3, type: 'json'};
    _showImportFileList();
  } else if(name.endsWith('.pptx')){
    await _parsePptxFile(file);
  } else if(name.endsWith('.docx')){
    await _parseDocxFile(file);
  } else {
    toast('Поддерживаются: .zip, .csv, .txt, .json, .pptx, .docx');
  }
}

// ─── PPTX parser (via JSZip — reads slide XML text) ────────────
async function _parsePptxFile(file){
  if(typeof JSZip === 'undefined'){ toast('JSZip не загружен'); return; }
  toast('🔍 Читаем слайды...');
  var zip = await JSZip.loadAsync(file);
  var slideFiles = [];
  zip.forEach(function(path, entry){
    if(/^ppt\/slides\/slide\d+\.xml$/.test(path) && !entry.dir)
      slideFiles.push({path: path, entry: entry});
  });
  slideFiles.sort(function(a,b){ return a.path.localeCompare(b.path, undefined, {numeric:true}); });

  // Parse each slide into structured runs + plain text
  var structuredSlides = [];
  for(var i = 0; i < slideFiles.length; i++){
    var xml = await slideFiles[i].entry.async('text');
    structuredSlides.push(_parsePptxSlideXml(xml, i+1));
  }

  // Store both structured data and plain text fallback
  _importFiles['__pptx_slides'] = {
    content:         structuredSlides.map(function(s){ return s.plainText; }).join('\n\n---SLIDE---\n\n'),
    type:            'pptx_slides',
    structuredSlides: structuredSlides   // NEW: structured data for advanced parsing
  };
  _showImportFileList();
}

// Parse one slide XML → structured object with runs (text + color + bold)
function _parsePptxSlideXml(xml, slideNum){
  // ── Parse each <p:sp> shape separately ──────────────────────────
  var shapes = [];
  var allRuns = [];
  var spRe = /<p:sp>([\s\S]*?)<\/p:sp>/g;
  var m;

  while((m = spRe.exec(xml)) !== null){
    var spXml = m[1];

    // Shape fill color
    var fillColor = null;
    var sfSrgb = spXml.match(/<p:spPr>[\s\S]*?solidFill[\s\S]*?<a:srgbClr val="([A-Fa-f0-9]{6})"/);
    if(sfSrgb) fillColor = sfSrgb[1].toUpperCase();
    var sfScheme = spXml.match(/<p:spPr>[\s\S]*?solidFill[\s\S]*?<a:schemeClr val="([^"]+)"/);
    if(!fillColor && sfScheme) fillColor = 'scheme:' + sfScheme[1];

    // Shape line/border color
    var lineColor = null;
    var lnSrgb = spXml.match(/<a:ln[\s\S]*?<a:srgbClr val="([A-Fa-f0-9]{6})"/);
    if(lnSrgb) lineColor = lnSrgb[1].toUpperCase();
    var lnScheme = spXml.match(/<a:ln[\s\S]*?<a:schemeClr val="([^"]+)"/);
    if(!lineColor && lnScheme) lineColor = 'scheme:' + lnScheme[1];

    // Parse runs inside this shape
    var shapeRuns = [];
    var runRe2 = /<a:r>([\s\S]*?)<\/a:r>/g;
    var mr;
    while((mr = runRe2.exec(spXml)) !== null){
      var runXml = mr[1];
      var textM  = runXml.match(/<a:t[^>]*>([\s\S]*?)<\/a:t>/);
      if(!textM) continue;
      var text = textM[1].trim();
      if(!text) continue;

      var runColor = null;
      var rSrgb = runXml.match(/srgbClr val="([A-Fa-f0-9]{6})"/);
      if(rSrgb) runColor = rSrgb[1].toUpperCase();
      var rScheme = runXml.match(/schemeClr val="([^"]+)"/);
      if(!runColor && rScheme) runColor = 'scheme:' + rScheme[1];

      var bold     = /\bb="1"/.test(runXml);
      var szM      = runXml.match(/\bsz="(\d+)"/);
      var fontSize = szM ? parseInt(szM[1]) : 0;

      var run = {text:text, color:runColor, bold:bold, fontSize:fontSize};
      shapeRuns.push(run);
      allRuns.push(run);
    }

    if(shapeRuns.length === 0) continue;

    var shapeText = shapeRuns.map(function(r){ return r.text; }).join(' ').trim();
    shapes.push({
      text:      shapeText,
      runs:      shapeRuns,
      fillColor: fillColor,
      lineColor: lineColor
    });
  }

  var plainText = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return {slideNum:slideNum, shapes:shapes, runs:allRuns, plainText:plainText};
}

// Advanced PPTX parser: pair question+answer slides
function _parsePptxSlidesAdvanced(slides){
  var qs = [];

  // Determine if slides come in pairs (Q, A, Q, A...) or are standalone
  // Heuristic: if even slides have fewer unique runs, they are answer slides
  var i = 0;
  while(i < slides.length){
    var qSlide = slides[i];
    var aSlide = (i+1 < slides.length) ? slides[i+1] : null;

    var parsed = _parsePptxQuestionSlide(qSlide, aSlide, i);
    if(parsed){
      qs.push(parsed);
      // If aSlide was used as answer slide, skip it
      if(aSlide && parsed._usedAnswerSlide) i += 2;
      else i += 1;
    } else {
      i += 1;
    }
  }
  return qs;
}

// Parse one question slide, optionally using answer slide for correct answer
function _parsePptxQuestionSlide(qSlide, aSlide, si){
  var runs  = qSlide.runs;
  var lines = _runsToLines(runs);
  if(!lines.length) return null;

  // ── Find question text ──────────────────────────────────────────
  // Question: typically the longest run / line, often contains a highlighted keyword
  // Strategy: find the biggest text block that isn't a single letter (A/B/C)
  var question  = '';
  var answers   = [];
  var catLine   = '';

  // Collect all text, group by visual proximity
  var allText = runs.map(function(r){ return r.text; }).join(' ').trim();

  // Try to find explicit A:/B: markers first
  var explicitAnswers = [];
  var explicitCorrect = -1;
  lines.forEach(function(line){
    var am = line.match(/^([A-Fa-f])[.:]\s*(.+)/);
    if(am){ explicitAnswers.push(am[2].trim()); return; }
    var cm = line.match(/^(correct|answer|правильный|ответ)[:\s]+(.+)/i);
    if(cm){
      var ci = 'ABCDEF'.indexOf(cm[2].trim().toUpperCase()[0]);
      if(ci >= 0) explicitCorrect = ci;
    }
  });

  // Heuristic: separate question from answers by font size or content
  // Large text = question, smaller repeated blocks = answers
  var maxFontSize = 0;
  runs.forEach(function(r){ if(r.fontSize > maxFontSize) maxFontSize = r.fontSize; });

  if(explicitAnswers.length >= 2){
    // Explicit A:/B: format — find question as first long non-answer line
    for(var li = 0; li < lines.length; li++){
      var l = lines[li];
      if(!l.match(/^[A-F][.:]/i) && !l.match(/^(correct|answer)/i) && l.length > 8){
        if(!question) question = l;
      }
    }
    answers = explicitAnswers;
  } else {
    // Heuristic: big font / long text = question; shorter distinct blocks = answers
    var questionRuns = runs.filter(function(r){ return r.fontSize >= maxFontSize * 0.7 && r.text.length > 3; });
    var questionText = questionRuns.map(function(r){ return r.text; }).join(' ').trim();

    // If question is composite, rebuild from full text until we hit short blocks
    if(!questionText || questionText.length < 5){
      questionText = lines[0] || '';
    }
    question = questionText;

    // Answers: short distinct text blocks after the question
    // Find runs with significantly smaller font size or different color from question
    var answerRuns = runs.filter(function(r){
      return r.fontSize < maxFontSize * 0.6 && r.text.length > 1;
    });
    if(answerRuns.length >= 2){
      // Group consecutive answer runs into options
      answers = _groupRunsToAnswers(answerRuns);
    } else {
      // Fallback: take all short lines that could be answers
      lines.forEach(function(line){
        if(line.length > 1 && line.length < 60 && line !== question && !line.match(/^[A-F][.:]/i)){
          if(answers.length < 6) answers.push(line);
        }
      });
    }
  }

  if(!question || answers.length < 2) return null;

  // ── Determine correct answer ────────────────────────────────────
  var correct_index      = 0;
  var correct_confidence = 'low';
  var correct_source     = 'fallback';
  var usedAnswerSlide    = false;

  // Priority 1: explicit Correct:/Answer: marker on question slide
  if(explicitCorrect >= 0 && explicitCorrect < answers.length){
    correct_index      = explicitCorrect;
    correct_confidence = 'high';
    correct_source     = 'explicit_marker';
  }

  // Priority 2: answer slide
  else if(aSlide){
    var ansResult = _detectCorrectFromAnswerSlide(aSlide, answers);
    if(ansResult.index >= 0){
      correct_index      = ansResult.index;
      correct_confidence = ansResult.confidence;
      correct_source     = ansResult.source;
      usedAnswerSlide    = true;
      // Flag ambiguous shapes — will add warning after q is created
      if(ansResult.ambiguous) correct_confidence = 'low';
    }
  }

  // Priority 3: highlighted run on question slide itself
  if(correct_source === 'fallback'){
    var highlightResult = _detectCorrectByColor(runs, answers, qSlide.shapes);
    if(highlightResult.index >= 0){
      correct_index      = highlightResult.index;
      correct_confidence = highlightResult.confidence;
      correct_source     = highlightResult.source;
    }
  }

  // Priority 4: checkmark/tick in text
  if(correct_source === 'fallback'){
    var tickResult = _detectCorrectByTick(allText, answers);
    if(tickResult.index >= 0){
      correct_index      = tickResult.index;
      correct_confidence = 'high';
      correct_source     = 'tick_marker';
    }
  }

  var q = {
    question:           question,
    answers:            answers,
    correct_index:      correct_index,
    correct_confidence: correct_confidence,
    correct_source:     correct_source,
    _usedAnswerSlide:   usedAnswerSlide,
    category:           'GENERAL',
    explanation:        '',
    errors:             [],
    warnings:           [],
    media:              null
  };

  _validateQ(q, si+1);

  if(correct_confidence === 'low'){
    q.warnings.push('Не удалось уверенно определить правильный ответ — проверьте вручную');
  }

  return q;
}

// Group answer runs into distinct answer options
function _groupRunsToAnswers(runs){
  var answers = [];
  var current = '';
  for(var i = 0; i < runs.length; i++){
    var text = runs[i].text.trim();
    if(!text) continue;
    // New answer starts if: current is non-empty and texts seem like different options
    // Simple heuristic: if current is full word and next starts new word
    if(current && (current.length > 2 || i > 0)){
      // Check if this run is "close" to previous (same answer) or new option
      // Heuristic: start new answer if current looks complete (ends with letter/digit)
      answers.push(current);
      current = text;
    } else {
      current = current ? current + ' ' + text : text;
    }
  }
  if(current) answers.push(current);
  return answers.slice(0, 6);
}

// Convert runs to text lines
function _runsToLines(runs){
  var combined = runs.map(function(r){ return r.text; }).join(' ');
  return combined.split(/\s{3,}|\n/).map(function(l){ return l.trim(); }).filter(Boolean);
}

// Normalize text for fuzzy matching
function _normalizeForMatch(text){
  return String(text||'')
    .toLowerCase()
    .replace(/ё/g,'е')
    .replace(/[^\wа-яa-z0-9 ]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

// Match answer text against list of answers, return index or -1
function _fuzzyMatchAnswer(answerText, answers){
  var norm    = _normalizeForMatch(answerText);
  var bestIdx = -1;
  var bestLen = 0;
  for(var i = 0; i < answers.length; i++){
    var aNorm = _normalizeForMatch(answers[i]);
    if(!aNorm) continue;
    // Exact match
    if(norm === aNorm) return i;
    // Substring match (answer contains or is contained in answerText)
    if(norm.indexOf(aNorm) !== -1 || aNorm.indexOf(norm) !== -1){
      if(aNorm.length > bestLen){ bestLen = aNorm.length; bestIdx = i; }
    }
  }
  return bestIdx;
}

// Detect correct answer from answer slide
function _detectCorrectFromAnswerSlide(aSlide, answers){
  var runs    = aSlide.runs;
  var shapes  = aSlide.shapes || [];
  var result  = {index:-1, confidence:'low', source:'fallback'};

  // ── Step 1: explicit text markers ──────────────────────────────
  var allText = aSlide.plainText;
  var markerM = allText.match(/(?:correct|answer|правильный|ответ|правильно)[:\s\u2013\u2014-]+(.+?)(?:\.|,|$)/i);
  if(markerM){
    var idx = _fuzzyMatchAnswer(markerM[1].trim(), answers);
    if(idx >= 0) return {index:idx, confidence:'high', source:'explicit_marker'};
  }

  // ── Step 2: shape-level highlight (fill OR line color) ─────────
  // Find shapes whose fill/line color stands out (explicit srgb, not dark-bg)
  var DARK_FILLS  = ['002060','00215E','1F3864','0D1F3C','000000','FFFFFF','FEFEFE'];
  var highlightedShapes = shapes.filter(function(s){
    var fc = s.fillColor;
    var lc = s.lineColor;
    var fcOk = fc && fc.indexOf('scheme:') === -1 && DARK_FILLS.indexOf(fc) === -1;
    var lcOk = lc && lc.indexOf('scheme:') === -1 && lc !== '000000';
    return fcOk || lcOk;
  });

  if(highlightedShapes.length === 1){
    // Single highlighted shape → high confidence
    var idx = _fuzzyMatchAnswer(highlightedShapes[0].text, answers);
    if(idx >= 0) return {index:idx, confidence:'high', source:'answer_slide_shape_highlight'};
  } else if(highlightedShapes.length > 1){
    // Multiple highlighted shapes → find which one matches an answer
    var matched = [];
    highlightedShapes.forEach(function(s){
      var idx = _fuzzyMatchAnswer(s.text, answers);
      if(idx >= 0) matched.push({index:idx, text:s.text});
    });
    if(matched.length === 1){
      return {index:matched[0].index, confidence:'medium', source:'answer_slide_shape_highlight'};
    } else if(matched.length > 1){
      // Ambiguous — return first match with warning flag
      return {index:matched[0].index, confidence:'low', source:'answer_slide_shape_highlight', ambiguous:true};
    }
  }

  // ── Step 3: run-level text color highlight ──────────────────────
  var coloredRunTexts = {};
  runs.forEach(function(r){
    if(r.color && r.color.indexOf('scheme:') === -1 && r.color !== 'FFFFFF' && r.color !== '000000'){
      coloredRunTexts[r.color] = (coloredRunTexts[r.color]||'') + ' ' + r.text;
    }
  });
  var highlightColors = Object.keys(coloredRunTexts).filter(function(c){
    return c !== 'FEFEFE';
  });
  if(highlightColors.length > 0){
    for(var ci = 0; ci < highlightColors.length; ci++){
      var colorText = coloredRunTexts[highlightColors[ci]].trim();
      var idx = _fuzzyMatchAnswer(colorText, answers);
      if(idx >= 0) return {index:idx, confidence:'high', source:'answer_slide_highlight'};
    }
  }

  // ── Step 4: plain text match on answer slide ────────────────────
  var answerSlideLines = allText.split(/\s{2,}|\n/).map(function(l){ return l.trim(); }).filter(Boolean);
  for(var li = 0; li < answerSlideLines.length; li++){
    var idx = _fuzzyMatchAnswer(answerSlideLines[li], answers);
    if(idx >= 0) return {index:idx, confidence:'medium', source:'answer_slide_text_match'};
  }

  return result;
}

// Detect correct by highlight color ON the question slide itself
function _detectCorrectByColor(runs, answers, shapes){
  var result = {index:-1, confidence:'low', source:'fallback'};
  shapes = shapes || [];

  // Check shape-level highlights on question slide
  var DARK_FILLS = ['002060','00215E','1F3864','0D1F3C','000000','FFFFFF','FEFEFE'];
  var hlShapes = shapes.filter(function(s){
    var fc = s.fillColor;
    return fc && fc.indexOf('scheme:') === -1 && DARK_FILLS.indexOf(fc) === -1;
  });
  if(hlShapes.length === 1){
    var idx = _fuzzyMatchAnswer(hlShapes[0].text, answers);
    if(idx >= 0) return {index:idx, confidence:'medium', source:'question_slide_shape_highlight'};
  }

  // Check run-level color
  var colorGroups = {};
  runs.forEach(function(r){
    if(r.color && r.color.indexOf('scheme:') === -1 && r.color !== 'FFFFFF' && r.color !== '000000'){
      colorGroups[r.color] = (colorGroups[r.color]||'') + ' ' + r.text;
    }
  });
  var colors = Object.keys(colorGroups);
  for(var ci = 0; ci < colors.length; ci++){
    var colorText = colorGroups[colors[ci]].trim();
    var idx = _fuzzyMatchAnswer(colorText, answers);
    if(idx >= 0){
      return {index:idx, confidence:'medium', source:'question_slide_highlight'};
    }
  }
  return result;
}

// Detect correct by checkmark/tick
function _detectCorrectByTick(allText, answers){
  var result = {index:-1};
  var tickM  = allText.match(/([^\n✓✔✅]{2,50})\s*[✓✔✅]/);
  if(tickM){
    var idx = _fuzzyMatchAnswer(tickM[1].trim(), answers);
    if(idx >= 0){ result.index = idx; }
  }
  return result;
}

// ─── DOCX parser (via JSZip — reads word/document.xml) ─────────
async function _parseDocxFile(file){
  if(typeof JSZip === 'undefined'){ toast('JSZip не загружен'); return; }
  toast('🔍 Читаем документ...');
  var zip = await JSZip.loadAsync(file);
  var docEntry = zip.file('word/document.xml');
  if(!docEntry){ toast('Не удалось найти document.xml в docx'); return; }
  var xml  = await docEntry.async('text');
  var text = xml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  _importFiles['__docx_text'] = {content: text, type: 'docx_text'};
  _showImportFileList();
}

// ─── ZIP bundle ─────────────────────────────────────────────────
async function parseZipBundle(file){
  if(typeof JSZip === 'undefined'){ toast('JSZip не загружен. Обновите страницу.'); return; }
  var zip = await JSZip.loadAsync(file);
  var mediaExts = ['jpg','jpeg','png','webp','gif','mp3','wav','ogg','mp4','webm','mov'];
  var docExts   = ['csv','txt','json'];

  var entries = [];
  zip.forEach(function(path, entry){ entries.push({path: path, entry: entry}); });

  for(var i = 0; i < entries.length; i++){
    var path  = entries[i].path;
    var entry = entries[i].entry;
    if(entry.dir) continue;
    var fname = path.split('/').pop();
    var ext   = fname.split('.').pop().toLowerCase();
    if(fname.startsWith('._')) continue;

    if(docExts.indexOf(ext) !== -1){
      var text = await entry.async('text');
      _importFiles[fname] = {content: text, type: ext};
    } else if(ext === 'pptx'){
      var pptxBlob = await entry.async('blob');
      await _parsePptxFile(new File([pptxBlob], fname));
    } else if(ext === 'docx'){
      var docxBlob = await entry.async('blob');
      await _parseDocxFile(new File([docxBlob], fname));
    } else if(mediaExts.indexOf(ext) !== -1){
      var blob = await entry.async('blob');
      var mType = (['mp4','webm','mov'].indexOf(ext) !== -1) ? 'video'
                : (['mp3','wav','ogg'].indexOf(ext) !== -1)  ? 'audio' : 'image';
      _importFiles[fname] = {blob: blob, type: mType, ext: ext, matched: false};
    }
  }
  _showImportFileList();
}

function _showImportFileList(){
  var icons = {csv:'📋', txt:'📝', json:'📄', pptx_slides:'📊', docx_text:'📝', image:'🖼', audio:'🎵', video:'🎬'};
  var listEl = document.getElementById('import-file-list');
  var rows = Object.keys(_importFiles).map(function(name){
    var f    = _importFiles[name];
    var icon = icons[f.type] || '📁';
    var size = f.blob    ? Math.round(f.blob.size/1024)+'KB'
             : f.content ? Math.round(f.content.length/1024)+'KB' : '';
    var isDoc = ['csv','txt','json','pptx_slides','docx_text'].indexOf(f.type) !== -1;
    var label = isDoc ? '✓ Документ' : 'Медиа';
    return '<div class="wizard-file-row">'
      + '<span class="wizard-file-icon">' + icon + '</span>'
      + '<span class="wizard-file-name">' + name + '</span>'
      + '<span class="wizard-file-size">' + size + '</span>'
      + '<span class="wizard-file-status' + (isDoc?' ok':'') + '">' + label + '</span>'
      + '</div>';
  });
  listEl.innerHTML = rows.join('') || '<div style="color:var(--muted);font-size:12px">Нет файлов</div>';
  document.getElementById('import-step-2').style.display = 'flex';
  _setImportStep(2);
}

// Service slide patterns — filtered out before question parsing
var _SERVICE_SLIDE_PATTERNS = [
  /^(первый|второй|третий|четвёртый|четвертый|пятый)\s+(раунд|тур)/i,
  /^round\s+\d/i,
  /^(проверим|проверим\s+звук|sound\s+check)/i,
  /^(желаем|желаем\s+хорошей|good\s+luck)/i,
  /^(по\s+\d+\s+секунд)/i,
  /^\d+\s+вопрос/i,
  /^(варианты?\s+ответ|answer\s+option)/i,
  /^(правила|rules)/i,
  /^(конец|финал|game\s+over|спасибо)/i,
];

function _isServiceSlide(slide){
  var text = slide.plainText.replace(/\s+/g,' ').trim();
  // Very short slides (< 20 chars) with no answer-like structure are likely titles
  if(text.length < 15) return true;
  // Check against service patterns
  if(_SERVICE_SLIDE_PATTERNS.some(function(p){ return p.test(text); })) return true;
  // Slide has no runs that look like distinct answer options (< 2 non-trivial runs)
  var meaningfulRuns = slide.runs.filter(function(r){ return r.text.trim().length > 2; });
  if(meaningfulRuns.length < 2) return true;
  return false;
}

async function runImportParsing(){
  toast('🔍 Распознаём вопросы...');
  _importQuestions = [];

  var hasPptx     = false;
  var hasCsv      = false;
  var csvQuestions = [];

  // Pass 1: collect CSV questions (source of truth for correct answers)
  Object.keys(_importFiles).forEach(function(fname){
    var f = _importFiles[fname];
    if(f.type === 'csv'){
      var parsed = _parseCSV(f.content);
      csvQuestions = csvQuestions.concat(parsed);
      hasCsv = true;
    } else if(f.type === 'txt'){
      csvQuestions = csvQuestions.concat(_parseTXT(f.content));
      hasCsv = true;
    } else if(f.type === 'json'){
      try{
        var data = JSON.parse(f.content);
        if(Array.isArray(data)) csvQuestions = csvQuestions.concat(data.map(function(q){ return _rowToQuestion(q,0); }));
        hasCsv = true;
      }catch(e){}
    }
  });

  // Pass 2: PPTX/DOCX
  var pptxQuestions = [];
  Object.keys(_importFiles).forEach(function(fname){
    var f = _importFiles[fname];
    if(f.type === 'pptx_slides'){
      hasPptx = true;
      var slides = f.structuredSlides;
      if(slides){
        // Filter service slides before advanced parsing
        var questionSlides = slides.filter(function(s){ return !_isServiceSlide(s); });
        pptxQuestions = pptxQuestions.concat(_parsePptxSlidesAdvanced(questionSlides));
      } else {
        pptxQuestions = pptxQuestions.concat(_parseSlidesText(f.content));
      }
    } else if(f.type === 'docx_text'){
      hasPptx = true;
      pptxQuestions = pptxQuestions.concat(_parseDocText(f.content));
    }
  });

  // Merge strategy:
  // If both CSV and PPTX: CSV is source of truth.
  //   Merge by slide_number or question index.
  //   PPTX supplies media only (images from answer slides can be added later).
  // If only CSV: use CSV questions.
  // If only PPTX: use PPTX questions, but BLOCK fallback ones.

  if(hasCsv && hasPptx){
    // CSV is master — mark source, try to attach PPTX media by slide_number
    _importQuestions = csvQuestions.map(function(q, i){
      q._source = 'csv';
      // Try to match slide by slide_number field or by index
      var slideNum = parseInt(q._slideNumber || q.slide_number || (i+1));
      var matchSlide = (pptxQuestions[i] && pptxQuestions[i]._slideNum) ? pptxQuestions[i] : null;
      // If media not already assigned and we have a matching PPTX slide, note it
      if(!q.media && matchSlide && matchSlide.media) q.media = matchSlide.media;
      return q;
    });
  } else if(hasCsv){
    _importQuestions = csvQuestions.map(function(q){ q._source = 'csv'; return q; });
  } else if(hasPptx){
    // PPTX-only: mark source, BLOCK fallback questions
    _importQuestions = pptxQuestions.map(function(q){
      q._source = (q.correct_source === 'fallback') ? 'fallback' : 'pptx_auto';
      return q;
    });
  }

  if(!_importQuestions.length){ toast('⚠️ Не удалось распознать вопросы. Проверь формат.'); return; }

  matchMediaToQuestions();

  // Show CSV template download button if PPTX was found without CSV
  var dlBtn = document.getElementById('import-dl-csv-template-btn');
  if(dlBtn) dlBtn.style.display = (hasPptx && !hasCsv) ? 'block' : 'none';

  // Stats
  var total     = _importQuestions.length;
  var csvCount  = _importQuestions.filter(function(q){ return q._source==='csv'; }).length;
  var pptxCount = _importQuestions.filter(function(q){ return q._source==='pptx_auto'; }).length;
  var fallCount = _importQuestions.filter(function(q){ return q._source==='fallback'; }).length;
  var valid     = _importQuestions.filter(function(q){ return !q.errors.length && q._source !== 'fallback'; }).length;
  var withMedia = _importQuestions.filter(function(q){ return q.media; }).length;

  var summaryEl = document.getElementById('import-parse-result');
  if(summaryEl){
    var parts = ['Распознано: ' + total];
    if(csvCount)  parts.push('📋 CSV: ' + csvCount);
    if(pptxCount) parts.push('📊 PPTX: ' + pptxCount);
    if(fallCount) parts.push('❌ без ответа: ' + fallCount);
    if(withMedia) parts.push('🖼 с медиа: ' + withMedia);
    summaryEl.textContent = parts.join(' · ');
    summaryEl.style.display = 'block';
    summaryEl.style.color = fallCount > 0 ? 'var(--gold)' : 'var(--green)';
  }

  // Show/hide fallback block warning and disable save buttons
  _updateFallbackWarning(fallCount, total);

  renderImportPreviewTable();
  _setImportStep(3);
}

function _updateFallbackWarning(fallCount, total){
  var warningEl  = document.getElementById('import-fallback-warning');
  var saveDraft  = document.getElementById('import-save-draft-btn');
  var saveTester = document.getElementById('import-save-tester-btn');

  if(!warningEl) return;

  if(fallCount > 0){
    warningEl.style.display = 'block';
    warningEl.innerHTML = '❌ ' + fallCount + ' из ' + total + ' вопросов без уверенно найденного правильного ответа (источник: fallback).'
      + '<br>Нельзя сохранить эти вопросы. Отредактируйте их в таблице или скачайте CSV-шаблон и заполните ответы вручную.';
    // Count saveable
    var saveableCount = _importQuestions.filter(function(q){ return !q.errors.length && q._source !== 'fallback'; }).length;
    if(saveableCount > 0){
      warningEl.innerHTML += '<br><span style="color:var(--gold)">Можно сохранить только ' + saveableCount + ' вопросов с уверенным ответом.</span>';
      if(saveDraft)  { saveDraft.disabled  = false; saveDraft.style.opacity  = ''; }
      if(saveTester) { saveTester.disabled = false; saveTester.style.opacity = ''; }
    } else {
      if(saveDraft)  { saveDraft.disabled  = true; saveDraft.style.opacity  = '0.4'; }
      if(saveTester) { saveTester.disabled = true; saveTester.style.opacity = '0.4'; }
    }
  } else {
    warningEl.style.display = 'none';
    if(saveDraft)  { saveDraft.disabled  = false; saveDraft.style.opacity  = ''; }
    if(saveTester) { saveTester.disabled = false; saveTester.style.opacity = ''; }
  }
}

// ─── CSV ────────────────────────────────────────────────────────
function _parseCSV(text){
  var lines = text.trim().split('\n');
  if(lines.length < 2) return [];
  var header = lines[0].split(',').map(function(h){ return h.trim().toLowerCase().replace(/['"]/g,''); });
  var qs = [];
  for(var i = 1; i < lines.length; i++){
    var vals = _splitCSVLine(lines[i]);
    if(!vals.length || !vals[0]) continue;
    var row = {};
    header.forEach(function(h, idx){ row[h] = (vals[idx]||'').replace(/^["']|["']$/g,'').trim(); });
    qs.push(_rowToQuestion(row, i));
  }
  return qs;
}

function _splitCSVLine(line){
  var result = [], cur = '', inQ = false;
  for(var i = 0; i < line.length; i++){
    var ch = line[i];
    if(ch === '"'){ inQ = !inQ; continue; }
    if(ch === ',' && !inQ){ result.push(cur); cur = ''; continue; }
    cur += ch;
  }
  result.push(cur);
  return result;
}

// ─── TXT (Q:/A:/B:/Correct: format) ────────────────────────────
function _parseTXT(text){
  var blocks = text.trim().split(/\n\s*\n/);
  var qs = [];
  blocks.forEach(function(block, i){
    var lines = block.trim().split('\n');
    var q = {question:'', answers:[], correct_index:0, category:'GENERAL', explanation:'', errors:[], warnings:[], media:null};
    lines.forEach(function(line){
      var m = line.match(/^([A-Fa-f]|Q|Correct|Category|Explanation|Time)[:\s]+(.+)/i);
      if(!m) return;
      var key = m[1].trim().toUpperCase();
      var val = m[2].trim();
      if(key === 'Q') q.question = val;
      else if('ABCDEF'.indexOf(key) !== -1 && key.length === 1) q.answers.push(val);
      else if(key === 'CORRECT' || key === 'ANSWER'){
        var ci = 'ABCDEF'.indexOf(val.toUpperCase()[0]);
        q.correct_index = ci >= 0 ? ci : 0;
      }
      else if(key === 'CATEGORY') q.category = val.toUpperCase();
      else if(key === 'EXPLANATION') q.explanation = val;
    });
    if(q.question) { _validateQ(q, i+1); qs.push(q); }
  });
  return qs;
}

// ─── PPTX slides text parser ────────────────────────────────────
// Tries to find pairs of slides: question slide + answer slide
function _parseSlidesText(text){
  var slides = text.split('---SLIDE---').map(function(s){ return s.trim(); });
  var qs = [];
  // Strategy: every odd slide is question, even is answer — or parse each for Q/A patterns
  slides.forEach(function(slide, si){
    // Look for answer patterns A: / B: or numbered
    var lines = slide.split(/\s{2,}|\n/).map(function(l){ return l.trim(); }).filter(Boolean);
    if(!lines.length) return;

    // Heuristic: first long line = question, short lines = answers
    var question = '';
    var answers  = [];
    var correct_index = 0;
    var category = 'GENERAL';

    lines.forEach(function(line){
      // explicit answer line A: B: etc
      var am = line.match(/^([A-F])[.:]\s+(.+)/i);
      if(am){ answers.push(am[2].trim()); return; }
      // correct marker
      var cm = line.match(/^(correct|answer|правильный)[:\s]+([A-F0-9])/i);
      if(cm){
        var ci = 'ABCDEF'.indexOf(cm[2].toUpperCase());
        correct_index = ci >= 0 ? ci : parseInt(cm[2]) || 0;
        return;
      }
      // if no question yet and line is reasonably long — treat as question
      if(!question && line.length > 10) question = line;
    });

    // If we only got a question and no answers — try to treat next slide as answer slide
    if(question && answers.length < 2) return; // skip partial

    if(question && answers.length >= 2){
      var q = {question:question, answers:answers, correct_index:correct_index,
               category:category, explanation:'', errors:[], warnings:[], media:null};
      _validateQ(q, si+1);
      qs.push(q);
    }
  });
  return qs;
}

// ─── DOCX text parser ───────────────────────────────────────────
function _parseDocText(text){
  // Try Q:/A:/B: format first
  if(/\bQ:/i.test(text)) return _parseTXT(text.replace(/  +/g,'\n'));

  // Fallback: split by numbered questions "1. " or "Вопрос N"
  var blocks = text.split(/(?=\d+[.)]\s|\bВопрос\s+\d+)/i).filter(function(b){ return b.trim().length > 10; });
  return blocks.map(function(block, i){
    return _rowToQuestion({question: block.slice(0,200).trim(), answer_a:'', answer_b:''}, i+1);
  }).filter(function(q){ return q.question.length > 5; });
}

// ─── Row → Question ─────────────────────────────────────────────
function _rowToQuestion(row, idx){
  var answers = ['answer_a','answer_b','answer_c','answer_d','answer_e','answer_f']
    .map(function(k){ return row[k]||row[k.replace('answer_','')]||''; })
    .filter(Boolean);
  var correctRaw = row['correct_answer']||row['correct']||'A';
  var correct_index = 0;
  if(/^[0-9]$/.test(correctRaw)) correct_index = parseInt(correctRaw);
  else correct_index = Math.max(0, 'ABCDEF'.indexOf(correctRaw.toUpperCase()[0]));

  var q = {
    question:             row['question']||row['question_text']||row['question_ru']||'',
    answers:              answers,
    correct_index:        correct_index,
    category:             (row['category']||'GENERAL').toUpperCase(),
    explanation:          row['explanation']||row['explanation_ru']||'',
    media_filename:       row['media_filename']||row['image_filename']||row['audio_filename']||row['video_filename']||'',
    slide_img_url:        row['slide_img_url']||row['slide_q_url']||null,
    answer_slide_img_url: row['answer_slide_img_url']||row['slide_a_url']||null,
    audio_url:            row['audio_url']||row['audio']||null,
    video_url:            row['video_url']||row['video']||null,
    question_type:        row['question_type']||'multiple_choice',
    _slideNumber:         parseInt(row['slide_number']||row['slide']||'0')||0,
    errors:[], warnings:[], media:null
  };
  _validateQ(q, idx);
  return q;
}

// Generate CSV template based on detected PPTX question slides
function downloadPptxCsvTemplate(){
  var pptxFile = null;
  Object.keys(_importFiles).forEach(function(fname){
    if(_importFiles[fname].type === 'pptx_slides') pptxFile = _importFiles[fname];
  });

  var questionCount = 0;
  var rows = [];

  if(pptxFile && pptxFile.structuredSlides){
    var nonServiceSlides = pptxFile.structuredSlides.filter(function(s){ return !_isServiceSlide(s); });
    // Take only odd-numbered slides (question slides in Q+A pair format)
    for(var i = 0; i < nonServiceSlides.length; i += 2){
      var s = nonServiceSlides[i];
      questionCount++;
      // Get text hint from slide
      var hint = s.runs.length > 0 ? s.runs[0].text.slice(0,60) : 'Вопрос ' + questionCount;
      rows.push([
        questionCount,            // slide_number
        _csvEscape(hint),         // question (from slide text)
        '', '', '', '',           // answer_a..d
        '',                       // correct_answer (empty — user fills)
        'GENERAL',                // category
        'slide_' + nonServiceSlides[i].slideNum + '.jpg'  // media_filename hint
      ]);
    }
  }

  // Fallback: use existing _importQuestions if already parsed
  if(!rows.length && _importQuestions.length){
    _importQuestions.forEach(function(q, i){
      rows.push([
        i+1,
        _csvEscape(q.question.slice(0,80)),
        _csvEscape(q.answers[0]||''), _csvEscape(q.answers[1]||''),
        _csvEscape(q.answers[2]||''), _csvEscape(q.answers[3]||''),
        '',   // correct_answer — user fills
        q.category||'GENERAL',
        q.media ? q.media.fname : ''
      ]);
    });
  }

  var header = 'slide_number,question,answer_a,answer_b,answer_c,answer_d,correct_answer,category,media_filename\n';
  var content = header + rows.map(function(r){ return r.join(','); }).join('\n');

  var blob = new Blob([content], {type:'text/csv'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'pptx_questions_template.csv';
  a.click();
  toast('⬇ CSV-шаблон скачан — заполни correct_answer и загрузи вместе с PPTX в ZIP');
}

function _csvEscape(str){
  str = String(str||'').replace(/"/g,'""');
  return (str.indexOf(',') !== -1 || str.indexOf('"') !== -1 || str.indexOf('\n') !== -1)
    ? '"' + str + '"' : str;
}

function _validateQ(q, idx){
  q.errors   = [];
  q.warnings = [];
  if(!q.question || q.question.length < 3)     q.errors.push('Пустой вопрос');
  if(!q.answers  || q.answers.length < 2)      q.errors.push('Меньше 2 вариантов');
  if(q.answers   && q.answers.length > 6)      q.errors.push('Больше 6 вариантов');
  if(q.correct_index >= (q.answers||[]).length) q.errors.push('Неверный индекс ответа');
  var dupes = (q.answers||[]).filter(function(a,i,arr){ return arr.indexOf(a) !== i; });
  if(dupes.length) q.warnings.push('Дублирующиеся варианты');
}

// ─── Media matching ─────────────────────────────────────────────
function matchMediaToQuestions(){
  var mediaFiles = Object.keys(_importFiles).filter(function(fn){
    var t = _importFiles[fn].type;
    return t === 'image' || t === 'audio' || t === 'video';
  });

  _importQuestions.forEach(function(q, qi){
    var n = qi + 1;
    // 1. Explicit media_filename field
    if(q.media_filename && _importFiles[q.media_filename]){
      var mf = _importFiles[q.media_filename];
      q.media = {fname: q.media_filename, type: mf.type, blob: mf.blob};
      mf.matched = true;
      return;
    }
    // 2. Pattern match
    var patterns = [
      new RegExp('^(q|question_|slide_)?0*' + n + '\\.(jpg|jpeg|png|webp|mp3|mp4|wav|ogg|mov|webm)$', 'i'),
      new RegExp('^0*' + n + '[._]', 'i'),
    ];
    for(var j = 0; j < mediaFiles.length; j++){
      var fname = mediaFiles[j];
      var f     = _importFiles[fname];
      if(f.matched) continue;
      if(patterns.some(function(p){ return p.test(fname); })){
        q.media  = {fname: fname, type: f.type, blob: f.blob};
        f.matched = true;
        break;
      }
    }
  });
}

// ─── Preview table ───────────────────────────────────────────────
function renderImportPreviewTable(){
  var total     = _importQuestions.length;
  var ok        = _importQuestions.filter(function(q){ return !q.errors.length; }).length;
  var errs      = _importQuestions.filter(function(q){ return q.errors.length; }).length;
  var withMedia = _importQuestions.filter(function(q){ return q.media; }).length;

  document.getElementById('import-stats-bar').innerHTML = [
    {v:total, l:'Всего',   c:'var(--text)'},
    {v:ok,    l:'Готово',  c:'var(--green)'},
    {v:errs,  l:'Ошибки',  c: errs ? 'var(--red)' : 'var(--muted)'},
    {v:withMedia, l:'С медиа', c:'var(--accent2)'},
  ].map(function(s){
    return '<div class="import-stat-card">'
      + '<div class="import-stat-val" style="color:' + s.c + '">' + s.v + '</div>'
      + '<div class="import-stat-lbl">' + s.l + '</div>'
      + '</div>';
  }).join('');

  var tbody = document.getElementById('import-preview-body');
  tbody.innerHTML = _importQuestions.map(function(q, i){
    var rowClass = (q._source === 'fallback') ? 'row-err'
                 : q.errors.length            ? 'row-err'
                 : q.warnings.length          ? 'row-warn' : 'row-ok';
    var ansHtml   = (q.answers||[]).map(function(a, ai){
      var isCorrect = ai === q.correct_index;
      var aText     = a.length>28 ? a.slice(0,28)+'…' : a;
      return '<div style="color:' + (isCorrect?'var(--green)':'var(--muted)') + ';font-weight:' + (isCorrect?800:400) + '">'
        + answerLetter(ai) + '. ' + _esc(aText) + (isCorrect?' ✓':'')
        + '</div>';
    }).join('');
    var errHtml   = q.errors.map(function(e){ return '<span class="import-err-badge">' + _esc(e) + '</span>'; }).join(' ');
    var warnHtml  = q.warnings.map(function(w){ return '<span class="import-warn-badge">' + _esc(w) + '</span>'; }).join(' ');

    // Confidence indicator for PPTX-imported questions
    var confHtml = '';
    if(q.correct_confidence){
      var confColor  = q.correct_confidence==='high' ? 'var(--green)' : q.correct_confidence==='medium' ? 'var(--gold)' : 'var(--red)';
      var confLabel  = q.correct_confidence==='high' ? '✓ уверенно' : q.correct_confidence==='medium' ? '~ вероятно' : '? неизвестно';
      var srcLabel   = {
        explicit_marker:             'маркер',
        answer_slide_highlight:      'цвет текста',
        answer_slide_shape_highlight:'плашка/рамка',
        answer_slide_text_match:     'текст слайда',
        question_slide_highlight:    'цвет вопроса',
        question_slide_shape_highlight:'плашка вопроса',
        tick_marker:                 'галочка',
        fallback:                    'fallback'
      }[q.correct_source] || q.correct_source || '';
      confHtml = '<div style="font-size:10px;color:' + confColor + ';margin-top:3px">' + confLabel + (srcLabel ? ' · ' + srcLabel : '') + '</div>';
    }
    var mediaHtml = q.slide_img_url
      ? '<img src="' + q.slide_img_url + '" style="max-width:120px;max-height:68px;border-radius:4px;object-fit:cover;display:block">'
      : q.media
        ? '<span class="import-media-chip">' + (q.media.type==='video'?'🎬':q.media.type==='audio'?'🎵':'🖼') + ' ' + _esc(q.media.fname.slice(0,12)) + '</span>'
        : (q.audio_url ? '🎵 audio' : q.video_url ? '🎬 video' : '—');
    var qText = q.question.length>80 ? q.question.slice(0,80)+'…' : q.question;

    // Source badge
    var sourceLabel = q._source === 'csv'       ? '<span style="color:var(--green);font-weight:800;font-size:11px">📋 CSV</span>'
                    : q._source === 'pptx_auto' ? '<span style="color:var(--accent2);font-size:11px">📊 PPTX</span>'
                    : q._source === 'fallback'  ? '<span style="color:var(--red);font-weight:800;font-size:11px">❌ fallback</span>'
                    : '<span style="color:var(--muted);font-size:11px">—</span>';

    return '<tr class="' + rowClass + '">'
      + '<td style="color:var(--muted);font-size:11px">' + (i+1) + '</td>'
      + '<td style="max-width:220px"><div style="font-weight:600;font-size:12px;line-height:1.4">' + _esc(qText) + '</div>'
      + '<div style="margin-top:3px">' + errHtml + warnHtml + '</div>'
      + confHtml + '</td>'
      + '<td style="font-size:11px;min-width:160px">' + ansHtml + '</td>'
      + '<td style="font-size:11px;white-space:nowrap">' + _esc(q.category||'—') + '</td>'
      + '<td>' + mediaHtml + '</td>'
      + '<td>' + sourceLabel + '</td>'
      + '<td style="white-space:nowrap"><div style="display:flex;gap:4px">'
      + '<button onclick="openImportEdit(' + i + ')" style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--accent2);font-family:inherit">✏️</button>'
      + '<button onclick="deleteImportQ(' + i + ')" style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--red);font-family:inherit">✕</button>'
      + '</div></td>'
      + '</tr>';
  }).join('');

  document.getElementById('import-step-3').style.display = 'flex';
}

function deleteImportQ(i){
  _importQuestions.splice(i,1);
  var fallCount = _importQuestions.filter(function(q){ return q._source==='fallback'||q.correct_source==='fallback'; }).length;
  _updateFallbackWarning(fallCount, _importQuestions.length);
  renderImportPreviewTable();
}

function openImportEdit(i){
  _importEditIdx = i;
  var q     = _importQuestions[i];
  var modal = document.getElementById('import-edit-modal');
  document.getElementById('imp-edit-q').value           = q.question||'';
  document.getElementById('imp-edit-explanation').value = q.explanation||'';
  document.getElementById('imp-edit-cat').value         = q.category||'GENERAL';

  var wrap = document.getElementById('imp-edit-answers');
  wrap.innerHTML = (q.answers||[]).map(function(a, ai){
    return '<div style="display:flex;gap:6px;align-items:center">'
      + '<span style="font-size:12px;font-weight:800;color:var(--muted);width:16px">' + answerLetter(ai) + '</span>'
      + '<input value="' + _esc(a) + '" id="imp-edit-ans-' + ai + '"'
      + ' style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:8px;font-size:13px;color:var(--text);font-family:inherit;outline:none">'
      + '</div>';
  }).join('');

  var sel = document.getElementById('imp-edit-correct');
  sel.innerHTML = (q.answers||[]).map(function(a, ai){
    return '<option value="' + ai + '"' + (ai===q.correct_index?' selected':'') + '>' + answerLetter(ai) + ': ' + _esc(a.slice(0,30)) + '</option>';
  }).join('');

  modal.style.display = 'flex';
  modal.scrollIntoView({behavior:'smooth'});
}

function closeImportEdit(){ document.getElementById('import-edit-modal').style.display='none'; _importEditIdx=null; }

function saveImportEdit(){
  if(_importEditIdx === null) return;
  var q   = _importQuestions[_importEditIdx];
  q.question    = document.getElementById('imp-edit-q').value.trim();
  q.explanation = document.getElementById('imp-edit-explanation').value.trim();
  q.category    = document.getElementById('imp-edit-cat').value;
  q.correct_index = parseInt(document.getElementById('imp-edit-correct').value)||0;
  var ansCnt = (q.answers||[]).length;
  q.answers = [];
  for(var i = 0; i < ansCnt; i++){
    var v = document.getElementById('imp-edit-ans-'+i);
    if(v && v.value.trim()) q.answers.push(v.value.trim());
  }
  _validateQ(q, _importEditIdx+1);
  // If question was fallback and now has valid correct_index, promote to pptx_auto
  if(q._source === 'fallback'){
    q._source = 'pptx_auto';
    q.correct_source = 'manual_edit';
    q.correct_confidence = 'high';
  }
  var fallCount = _importQuestions.filter(function(q){ return q._source==='fallback'||q.correct_source==='fallback'; }).length;
  _updateFallbackWarning(fallCount, _importQuestions.length);
  closeImportEdit();
  renderImportPreviewTable();
  toast('✓ Вопрос обновлён');
}

function downloadImportJson(){
  var blob = new Blob([JSON.stringify(_importQuestions,null,2)],{type:'application/json'});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mfc_import.json';
  a.click();
}

function downloadImportTemplate(fmt){
  var content, filename, type;
  if(fmt === 'csv'){
    content  = 'question,answer_a,answer_b,answer_c,answer_d,correct_answer,category,explanation,media_filename\n';
    content += '"Какой язык программирования создал Гвидо ван Россум?","Java","Python","C++","Ruby","B","SCIENCE","Python был создан в 1991 году",""\n';
    content += '"Сколько планет в Солнечной системе?","7","8","9","10","B","SCIENCE","С 2006 года официально 8 планет",""\n';
    filename = 'mfc_template.csv'; type = 'text/csv';
  } else {
    content  = 'Q: Какой язык программирования создал Гвидо ван Россум?\nA: Java\nB: Python\nC: C++\nD: Ruby\nCorrect: B\nCategory: SCIENCE\nExplanation: Python был создан в 1991 году\n\n';
    content += 'Q: Сколько планет в Солнечной системе?\nA: 7\nB: 8\nC: 9\nD: 10\nCorrect: B\nCategory: SCIENCE\n';
    filename = 'mfc_template.txt'; type = 'text/plain';
  }
  var blob = new Blob([content],{type: type});
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

async function saveImportedQuestions(mode){
  var validQs = _importQuestions.filter(function(q){ return !q.errors.length; });
  if(!validQs.length){ toast('Нет валидных вопросов для сохранения'); return; }
  if(!currentUser){ toast('Нужно войти'); return; }

  var saveMode = document.getElementById('import-save-mode').value;
  var packId   = null;

  // ── Block fallback questions (no correct answer) ──
  var fallbackQs = validQs.filter(function(q){ return q._source === 'fallback' || q.correct_source === 'fallback'; });
  if(fallbackQs.length === validQs.length){
    toast('❌ Нельзя сохранить: все ' + fallbackQs.length + ' вопросов без уверенного правильного ответа. Исправьте в таблице или загрузите CSV.');
    return;
  }
  // Silently exclude fallback from save — they stay as draft-blocked
  validQs = validQs.filter(function(q){ return q._source !== 'fallback' && q.correct_source !== 'fallback'; });
  if(!validQs.length){ toast('Нет вопросов для сохранения'); return; }

  // ── Medium/low confidence: just note in toast, don't block ──
  var lowConfCount = validQs.filter(function(q){ return q.correct_confidence === 'low' || q.correct_confidence === 'medium'; }).length;
  if(lowConfCount > 0){
    // Non-blocking info — user already saw warnings in preview table
    toast('ℹ️ ' + lowConfCount + ' вопросов с неуверенным ответом будут сохранены как draft — проверьте в Тестере.');
  }

  // ── New pack ──
  if(saveMode === 'new-pack'){
    var packTitle = ((document.getElementById('import-pack-title')||{}).value||'').trim();
    var packDesc  = ((document.getElementById('import-pack-desc')||{}).value||'').trim();
    if(!packTitle){ toast('Введите название пака'); return; }
    var packPriceRaw = parseInt((document.getElementById('import-pack-price')||{}).value||'200', 10);
    var packIsFree   = !!(document.getElementById('import-pack-free')||{}).checked;
    var packPrice    = packIsFree ? 0 : (isNaN(packPriceRaw) ? 200 : Math.max(0, packPriceRaw));
    toast('📦 Создаём / обновляем пак...');

    // IMPORTANT: use _importBatchKey as import_key so that game_packs.import_key
    // matches questions' import_key prefix (batchKey_q1, batchKey_q2, …).
    var importKey  = _importBatchKey;
    var packStatus = (mode === 'tester') ? 'tester' : 'draft';

    // ── Dedup: look for existing pack by import_key first, then by title ──
    var existingPack = null;

    // 1. Exact import_key match
    var {data: byKey} = await sb.from('game_packs')
      .select('*').eq('import_key', importKey).maybeSingle();
    if(byKey) existingPack = byKey;

    // 2. Normalized title match (avoid duplicate display names)
    if(!existingPack){
      var normTitle = packTitle.trim().toLowerCase();
      var {data: byTitle} = await sb.from('game_packs')
        .select('*')
        .or('title_ru.ilike.' + packTitle.replace(/'/g,"''") + ',title_en.ilike.' + packTitle.replace(/'/g,"''"))
        .not('status', 'in', '(archived_unsupported,needs_reimport,archived)')
        .limit(1)
        .maybeSingle();
      if(byTitle) existingPack = byTitle;
    }

    if(existingPack){
      // Update existing pack — don't create a duplicate
      var {error: upErr} = await sb.from('game_packs').update({
        import_key:    importKey,   // align key in case this was a legacy pack
        title_ru:      packTitle,
        title_en:      packTitle,
        description_ru: packDesc || existingPack.description_ru || ('Импорт: ' + packTitle),
        status:        packStatus,
        render_mode:   'extracted_question',
        price_neurons: packPrice,
        is_free:       packIsFree,
        updated_at:    new Date().toISOString()
      }).eq('id', existingPack.id);
      if(upErr){ toast('Ошибка обновления пака: ' + upErr.message); return; }
      packId = existingPack.id;
      // Clear old game_pack_questions links so we start fresh
      await sb.from('game_pack_questions').delete().eq('game_pack_id', packId);
    } else {
      // Create a genuinely new pack
      var packRes = await sb.from('game_packs').insert({
        import_key:    importKey,
        title_ru:      packTitle,
        title_en:      packTitle,
        description_ru: packDesc || ('Импорт: ' + packTitle),
        pack_type:     'thematic',
        source_type:   'official_pack',
        render_mode:   'extracted_question',
        status:        packStatus,
        price_neurons: packPrice,
        is_free:       packIsFree,
        created_at:    new Date().toISOString()
      }).select().single();
      if(packRes.error){ toast('Ошибка создания пака: ' + packRes.error.message); return; }
      packId = packRes.data.id;
    }
  }

  // ── Existing pack ──
  if(saveMode === 'existing-pack'){
    var sel = document.getElementById('import-existing-pack-sel');
    packId = sel ? sel.value : null;
    if(!packId){ toast('Выберите пак'); return; }
  }

  // ── Upload media ──
  var hasMedia = validQs.some(function(q){ return q.media && q.media.blob; });
  if(hasMedia) toast('🖼 Загружаем медиафайлы...');
  for(var mi = 0; mi < validQs.length; mi++){
    var q = validQs[mi];
    if(q.media && q.media.blob){
      try{
        var fname = 'imports/' + _importBatchKey + '_' + q.media.fname;
        var upRes = await sb.storage.from('mfc-media').upload(fname, q.media.blob, {upsert:true});
        if(upRes.data){
          var urlRes = sb.storage.from('mfc-media').getPublicUrl(fname);
          q._mediaUrl  = urlRes.data && urlRes.data.publicUrl;
          q._mediaType = q.media.type;
        }
      }catch(e){ console.warn('[MFC] media upload:', e.message); }
    }
  }

  // ── Insert questions ──
  toast('💾 Сохраняем ' + validQs.length + ' вопросов...');
  var batchKey   = _importBatchKey;
  var insertData = validQs.map(function(q, qi){
    // Status: 'tester' when saving to tester, 'draft' otherwise
    var qStatus = (mode === 'tester') ? 'tester' : 'draft';
    return {
      question_text:   q.question,
      question_ru:     q.question,
      answers_json:    q.answers,
      answers_ru:      q.answers,
      correct_index:   q.correct_index,
      category:        q.category||'GENERAL',
      explanation_ru:  q.explanation||'',
      source_type:     packId ? 'official_pack' : 'official_general',
      question_type:        q.question_type||'multiple_choice',
      status:               qStatus,
      difficulty:           1,
      author_user_id:       currentUser.id,
      media_type:           q._mediaType||(q.audio_url?'audio':q.video_url?'video':q.slide_img_url?'image':null),
      image_url:            q._mediaType==='image'  ? q._mediaUrl : null,
      audio_url:            q._mediaType==='audio'  ? q._mediaUrl : (q.audio_url||null),
      video_url:            q._mediaType==='video'  ? q._mediaUrl : (q.video_url||null),
      slide_img_url:        q.slide_img_url||null,
      answer_slide_img_url: q.answer_slide_img_url||null,
      import_key:      batchKey + '_q' + (qi+1),
      created_at:      new Date().toISOString()
    };
  });

  var saveRes = await sb.from('questions').insert(insertData).select('id');
  if(saveRes.error){ toast('Ошибка сохранения: ' + saveRes.error.message); return; }
  var savedQs = saveRes.data;

  // ── Link to pack ──
  if(packId && savedQs && savedQs.length){
    toast('🔗 Привязываем к паку...');
    // Get current max position in pack to append correctly
    var posRes = await sb.from('game_pack_questions')
      .select('position').eq('game_pack_id', packId).order('position', {ascending:false}).limit(1);
    var startPos = (posRes.data && posRes.data[0] && posRes.data[0].position) || 0;
    var links = savedQs.map(function(q, i){
      return {game_pack_id: packId, question_id: q.id, position: startPos + i + 1};
    });
    var linkRes = await sb.from('game_pack_questions').insert(links);
    if(linkRes.error) toast('⚠️ Вопросы сохранены, но ошибка привязки к паку: ' + linkRes.error.message);
  }

  var savedCount = savedQs && savedQs.length || 0;
  track('import_saved', {count: savedCount, mode: saveMode, status: mode==='tester'?'tester':'draft'});

  if(mode === 'tester'){
    toast('✅ ' + savedCount + ' вопросов сохранено (статус: tester) → открываем Тестер...');
    showScreen('admin');
    setTimeout(function(){
      startTesterMode('import', batchKey);
    }, 600);
  } else {
    // Show post-save panel with action buttons
    var wizEl = document.getElementById('import-wizard-overlay');
    if(wizEl){
      var actHtml = '<div style="background:var(--bg2);border:0.5px solid var(--green);border-radius:14px;padding:16px;margin-top:12px">'
        + '<div style="font-size:14px;font-weight:800;color:var(--green);margin-bottom:10px">✅ Сохранено ' + savedCount + ' вопросов (статус: draft)</div>'
        + '<div style="display:flex;flex-direction:column;gap:8px">'
        + '<button onclick="startTesterMode(\'import\',\''+batchKey+'\')" style="background:rgba(240,192,64,.15);border:1px solid var(--gold);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--gold);cursor:pointer;font-family:inherit">🧪 Перейти в Тестер</button>'
        + '<button onclick="adminPublishImport(\''+batchKey+'\')" style="background:rgba(74,222,128,.15);border:1px solid var(--green);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--green);cursor:pointer;font-family:inherit">🚀 Опубликовать весь импорт сейчас</button>'
        + '<button onclick="showAdminImports()" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">📋 Открыть импорты</button>'
        + '</div></div>';
      // Append action panel to wizard content
      var content = wizEl.querySelector('.import-wizard-inner') || wizEl.firstElementChild;
      if(content){ content.insertAdjacentHTML('beforeend', actHtml); content.scrollTop = content.scrollHeight; }
    } else {
      toast('✅ Сохранено ' + savedCount + ' вопросов (статус: draft). Используй "Импорты вопросов" для публикации.');
      showScreen('admin');
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTHOR QUESTION BUILDER (multi-draft, with media upload)
// ═══════════════════════════════════════════════════════════════

var _abDrafts      = [];
var _abAnswerCount = 4;
var _abCorrectIdx  = 0;
var _abMediaFile   = null;  // pending media for current question

function initAuthorBuilder(){
  _abDrafts      = [];
  _abAnswerCount = 4;
  _abCorrectIdx  = 0;
  _abMediaFile   = null;
  var qt = document.getElementById('ab-qtext');
  var ex = document.getElementById('ab-explanation');
  if(qt) qt.value = '';
  if(ex) ex.value = '';
  abRenderAnswers();
  abRenderDrafts();
}

function showAuthorQuestionBuilder(){
  showScreen('author-builder');
  initAuthorBuilder();
}

function abRenderAnswers(){
  var wrap = document.getElementById('ab-answers');
  if(!wrap) return;
  var html = '';
  for(var i = 0; i < _abAnswerCount; i++){
    var isCorrect = (i === _abCorrectIdx);
    var existing  = (function(idx){
      var el = document.getElementById('ab-ans-'+idx);
      return el ? el.value : '';
    })(i);
    html += '<div style="display:flex;gap:8px;align-items:center">'
      + '<div onclick="abSetCorrect(' + i + ')" style="width:28px;height:28px;border-radius:50%;'
      + 'background:' + (isCorrect?'var(--green)':'var(--bg3)') + ';'
      + 'border:2px solid ' + (isCorrect?'var(--green)':'var(--border)') + ';'
      + 'cursor:pointer;display:flex;align-items:center;justify-content:center;'
      + 'font-size:11px;font-weight:800;color:' + (isCorrect?'#fff':'var(--muted)') + ';flex-shrink:0">'
      + answerLetter(i)
      + '</div>'
      + '<input id="ab-ans-' + i + '" placeholder="Вариант ' + answerLetter(i) + '" value="' + existing.replace(/"/g,'&quot;') + '"'
      + ' style="flex:1;background:var(--bg3);border:0.5px solid ' + (isCorrect?'rgba(68,204,136,.3)':'var(--border)') + ';'
      + 'border-radius:10px;padding:10px 12px;font-size:14px;color:var(--text);font-family:inherit;outline:none">'
      + '</div>';
  }
  wrap.innerHTML = html;
}

function abSetCorrect(i){ _abCorrectIdx = i; abRenderAnswers(); }
function abAddAnswer(){    if(_abAnswerCount < 6){ _abAnswerCount++; abRenderAnswers(); } }
function abRemoveAnswer(){
  if(_abAnswerCount > 2){
    if(_abCorrectIdx >= _abAnswerCount-1) _abCorrectIdx = _abAnswerCount-2;
    _abAnswerCount--;
    abRenderAnswers();
  }
}

function abHandleMedia(input){
  var file = input.files && input.files[0];
  if(!file) return;
  _abMediaFile = file;
  var preview = document.getElementById('ab-media-preview');
  if(preview){
    var mtype = file.type.startsWith('video')   ? '🎬'
              : file.type.startsWith('audio')   ? '🎵' : '🖼';
    preview.textContent = mtype + ' ' + file.name + ' (' + Math.round(file.size/1024) + 'KB)';
    preview.style.display = 'block';
  }
}

function _collectAbForm(){
  var question   = (document.getElementById('ab-qtext')||{}).value||'';
  question = question.trim();
  var answers = [];
  for(var i = 0; i < _abAnswerCount; i++){
    var el = document.getElementById('ab-ans-'+i);
    answers.push(el ? (el.value||'').trim() : '');
  }
  var category    = (document.getElementById('ab-category')||{}).value   || 'GENERAL';
  var difficulty  = parseInt((document.getElementById('ab-difficulty')||{}).value) || 2;
  var explanation = (document.getElementById('ab-explanation')||{}).value || '';
  explanation = explanation.trim();
  return {question:question, answers:answers, correct_index:_abCorrectIdx, category:category, difficulty:difficulty, explanation:explanation};
}

function _validateAbForm(data){
  if(!data.question || data.question.length < 5){ toast('Напишите текст вопроса'); return false; }
  var filled = data.answers.filter(Boolean);
  if(filled.length < 2){ toast('Нужно минимум 2 варианта ответа'); return false; }
  if(!data.answers[data.correct_index]){ toast('Выберите правильный ответ'); return false; }
  var dupes = data.answers.filter(function(a,i,arr){ return a && arr.indexOf(a) !== i; });
  if(dupes.length) toast('⚠️ Есть дублирующиеся варианты');
  return true;
}

function addAuthorDraftQuestion(){
  var data = _collectAbForm();
  if(!_validateAbForm(data)) return;
  var draft = {
    question:      data.question,
    answers:       data.answers.filter(Boolean),
    correct_index: data.correct_index,
    category:      data.category,
    difficulty:    data.difficulty,
    explanation:   data.explanation,
    mediaFile:     _abMediaFile || null
  };
  _abDrafts.push(draft);
  // Reset form
  var qt = document.getElementById('ab-qtext');
  var ex = document.getElementById('ab-explanation');
  if(qt) qt.value = '';
  if(ex) ex.value = '';
  _abCorrectIdx = 0; _abAnswerCount = 4; _abMediaFile = null;
  abRenderAnswers();
  var mp = document.getElementById('ab-media-preview');
  if(mp){ mp.textContent = ''; mp.style.display = 'none'; }
  abRenderDrafts();
  toast('✓ Вопрос ' + _abDrafts.length + ' добавлен в список');
}

function abRenderDrafts(){
  var section = document.getElementById('ab-drafts-section');
  var list    = document.getElementById('ab-drafts-list');
  var cntEl   = document.getElementById('ab-draft-count');
  if(cntEl) cntEl.textContent = _abDrafts.length + ' черновик' + (_abDrafts.length === 1 ? '' : 'ов');
  if(!section || !list) return;
  if(!_abDrafts.length){ section.style.display = 'none'; return; }
  section.style.display = 'flex';

  var html = '';
  for(var i = 0; i < _abDrafts.length; i++){
    var q = _abDrafts[i];
    var answersHtml = '';
    for(var ai = 0; ai < q.answers.length; ai++){
      var isCorr = (ai === q.correct_index);
      answersHtml += '<div class="author-draft-ans' + (isCorr ? ' correct' : '') + '">'
        + answerLetter(ai) + '. ' + _esc(q.answers[ai]) + (isCorr ? ' ✓' : '')
        + '</div>';
    }
    var mediaChip = q.mediaFile
      ? '<span style="font-size:10px;color:var(--accent2)">'
        + (q.mediaFile.type.startsWith('video')?'🎬':q.mediaFile.type.startsWith('audio')?'🎵':'🖼')
        + ' ' + _esc(q.mediaFile.name) + '</span>'
      : '';
    html += '<div class="author-draft-card">'
      + '<div class="author-draft-num">#' + (i+1) + '</div>'
      + '<div class="author-draft-q">' + _esc(q.question) + '</div>'
      + '<div class="author-draft-answers">' + answersHtml + '</div>'
      + '<div style="font-size:10px;color:var(--muted);margin-bottom:6px">' + _esc(q.category) + ' · сл.' + q.difficulty + ' ' + mediaChip + '</div>'
      + '<div class="author-draft-actions">'
      + '<button onclick="abDeleteDraft(' + i + ')" style="padding:5px 12px;border-radius:8px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg3);color:var(--red);font-family:inherit">Удалить</button>'
      + '</div></div>';
  }
  list.innerHTML = html;
}

function abDeleteDraft(i){ _abDrafts.splice(i,1); abRenderDrafts(); }

async function submitAuthorQuestions(){
  var cur = _collectAbForm();
  if(cur.question && cur.answers.filter(Boolean).length >= 2 && _validateAbForm(cur)){
    _abDrafts.push({
      question:      cur.question,
      answers:       cur.answers.filter(Boolean),
      correct_index: cur.correct_index,
      category:      cur.category,
      difficulty:    cur.difficulty,
      explanation:   cur.explanation,
      mediaFile:     _abMediaFile || null
    });
  }

  if(!_abDrafts.length){ toast('Добавьте хотя бы один вопрос'); return; }

  if(!currentUser){
    toast('Войдите, чтобы отправить вопросы');
    setTimeout(function(){ showScreen('auth'); }, 1000);
    return;
  }

  toast('📤 Отправляем ' + _abDrafts.length + ' вопросов...');

  var insertData = [];
  for(var i = 0; i < _abDrafts.length; i++){
    var draft = _abDrafts[i];
    var mediaUrl  = null;
    var mediaType = null;

    // Upload media if present
    if(draft.mediaFile){
      try{
        var mfname = 'community/' + currentUser.id.slice(0,8) + '_' + Date.now() + '_' + draft.mediaFile.name;
        var upRes  = await sb.storage.from('mfc-media').upload(mfname, draft.mediaFile, {upsert:true});
        if(upRes.data){
          var urlRes = sb.storage.from('mfc-media').getPublicUrl(mfname);
          mediaUrl  = urlRes.data && urlRes.data.publicUrl;
          mediaType = draft.mediaFile.type.startsWith('video') ? 'video'
                    : draft.mediaFile.type.startsWith('audio') ? 'audio' : 'image';
        }
      }catch(e){ console.warn('[MFC] media upload:', e.message); }
    }

    insertData.push({
      question_text:   draft.question,
      question_ru:     draft.question,
      answers_json:    draft.answers,
      answers_ru:      draft.answers,
      correct_index:   draft.correct_index,
      category:        draft.category,
      difficulty:      draft.difficulty,
      explanation_ru:  draft.explanation||'',
      source_type:     'community',
      question_type:   'multiple_choice',
      status:          'community_pending',
      author_user_id:  currentUser.id,
      media_type:      mediaType,
      image_url:       mediaType === 'image' ? mediaUrl : null,
      audio_url:       mediaType === 'audio' ? mediaUrl : null,
      video_url:       mediaType === 'video' ? mediaUrl : null,
      import_key:      'community_' + currentUser.id.slice(0,8) + '_' + Date.now() + '_' + i,
      created_at:      new Date().toISOString()
    });
  }

  var res = await sb.from('questions').insert(insertData);
  if(res.error){ toast('Ошибка: ' + res.error.message); return; }

  track('author_questions_submitted', {count: _abDrafts.length});
  // Save to pending for display in profile stats
  const existing = JSON.parse(localStorage.getItem('mfc_pending_questions')||'[]');
  insertData.forEach(q => existing.push({question: q.question_ru, submitted_at: q.created_at}));
  localStorage.setItem('mfc_pending_questions', JSON.stringify(existing.slice(-50)));
  // Badge: author
  if(checkBadges('author')) setTimeout(()=>showBadgeEarned('author'), 800);
  _abDrafts = []; _abMediaFile = null;

  toast('✅ ' + insertData.length + ' вопросов отправлено на проверку!');
  showScreen('home');
  setTimeout(function(){
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:5000;display:flex;align-items:center;justify-content:center;padding:20px';
    overlay.innerHTML = '<div style="background:var(--bg2);border:0.5px solid var(--green);border-radius:20px;padding:32px 24px;text-align:center;max-width:340px;width:100%">'
      + '<div style="font-size:52px;margin-bottom:12px">🎉</div>'
      + '<div style="font-size:18px;font-weight:800;margin-bottom:8px">Вопросы отправлены!</div>'
      + '<div style="font-size:14px;color:var(--muted);line-height:1.6;margin-bottom:20px">После проверки модератором они появятся в игре.</div>'
      + '<button onclick="this.closest(\'[style]\').remove()" style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">Отлично!</button>'
      + '</div>';
    document.body.appendChild(overlay);
    setTimeout(function(){ overlay.remove(); }, 6000);
  }, 400);
}

// ═══════════════════════════════════════════════════════════════
// TESTER TABLE MODE
// ═══════════════════════════════════════════════════════════════

var _testerViewMode    = 'card';
var _testerTableFilter = 'all';

function switchTesterMode(mode){
  _testerViewMode = mode;
  var tabCard  = document.getElementById('tester-tab-card');
  var tabTable = document.getElementById('tester-tab-table');
  var cardMode = document.getElementById('tester-card-mode');
  var tableMode= document.getElementById('tester-table-mode');
  if(tabCard)  tabCard.classList.toggle('active',  mode==='card');
  if(tabTable) tabTable.classList.toggle('active', mode==='table');
  if(cardMode)  cardMode.style.display  = mode==='card'  ? '' : 'none';
  if(tableMode) tableMode.style.display = mode==='table' ? 'flex' : 'none';
  if(mode==='table') renderTesterTable();
}

function filterTesterTable(filter){
  _testerTableFilter = filter;
  document.querySelectorAll('.tt-filter').forEach(function(el){
    el.classList.toggle('active', el.dataset.f === filter);
  });
  renderTesterTable();
}

function renderTesterTable(){
  var tbody = document.getElementById('tester-table-body');
  if(!tbody || !testerQuestions.length) return;

  var qs = testerQuestions;
  if(_testerTableFilter === 'none')
    qs = qs.filter(function(q){ return !testerResults[q._importKey]; });
  else if(_testerTableFilter !== 'all')
    qs = qs.filter(function(q){ return testerResults[q._importKey] && testerResults[q._importKey].verdict === _testerTableFilter; });

  if(!qs.length){
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--muted);font-size:13px">Нет вопросов</td></tr>';
    return;
  }

  var html = '';
  for(var ri = 0; ri < qs.length; ri++){
    var q       = qs[ri];
    var ik      = q._importKey || '';
    var verdict = testerResults[ik] && testerResults[ik].verdict || null;
    var realIdx = testerQuestions.indexOf(q);
    var rowClass = verdict ? 'verdict-' + verdict : '';
    var mediaIcon = q._mediaType==='video'?'🎬':q._mediaType==='audio'?'🎵':q._mediaType==='image'?'🖼':'';

    var ansHtml = '';
    for(var ai = 0; ai < (q.a||[]).length; ai++){
      var isCorr = (ai === q.c);
      ansHtml += '<div style="color:' + (isCorr?'var(--green)':'var(--muted)') + ';font-weight:' + (isCorr?700:400) + ';font-size:11px">'
        + answerLetter(ai) + '. ' + (q.a[ai].length>25 ? q.a[ai].slice(0,25)+'…' : q.a[ai]) + (isCorr?' ✓':'')
        + '</div>';
    }

    var vBtns = '';
    ['good','fix','bad'].forEach(function(v){
      var lbl = v==='good'?'✅':v==='fix'?'🟡':'❌';
      var cls = verdict===v ? ('tt-v-active-'+v) : ('tt-v-'+v);
      vBtns += '<button class="tt-verdict-btn ' + cls + '" onclick="ttSetVerdict(\'' + ik + '\',' + realIdx + ',\'' + v + '\')">' + lbl + '</button>';
    });

    html += '<tr class="' + rowClass + '">'
      + '<td style="color:var(--muted);font-size:11px">' + (realIdx+1) + '</td>'
      + '<td style="max-width:220px"><div style="font-size:12px;font-weight:600;line-height:1.4">' + (q.q.length>70?q.q.slice(0,70)+'…':q.q) + '</div>'
      + '<div style="font-size:10px;color:var(--muted);margin-top:2px">' + q.cat + '</div></td>'
      + '<td style="min-width:140px">' + ansHtml + '</td>'
      + '<td style="text-align:center">' + (mediaIcon||'—') + '</td>'
      + '<td style="white-space:nowrap"><div style="display:flex;gap:4px">' + vBtns + '</div></td>'
      + '<td style="white-space:nowrap"><div style="display:flex;gap:3px">'
      + '<button onclick="openTesterMediaPreview(' + realIdx + ')" title="Медиа" style="padding:3px 7px;border-radius:6px;font-size:11px;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--muted);font-family:inherit">' + (mediaIcon||'🖼') + '</button>'
      + '<button onclick="openTesterEdit(' + realIdx + ')" title="Редактировать" style="padding:3px 7px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--gold);font-family:inherit">✏️</button>'
      + '<button onclick="goToTesterCard(' + realIdx + ')" title="Открыть" style="padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--accent2);font-family:inherit">Открыть</button>'
      + '</div></td>'
      + '</tr>';
  }
  tbody.innerHTML = html;
}

function ttSetVerdict(ik, qIdx, verdict){
  var q = testerQuestions[qIdx];
  var key = (q && q._dbId) || ik;
  if(testerResults[key] && testerResults[key].verdict === verdict){
    delete testerResults[key];
    verdict = null;
  } else {
    testerResults[key] = {verdict: verdict, note: '', _id: q && q._dbId, _ik: ik};
  }
  if(currentUser && q && q._dbId){
    sb.from('question_reviews').upsert({
      import_key:  ik,
      question_id: q._dbId,
      reviewer_id: currentUser.id,
      verdict:     verdict,
      note:        '',
      created_at:  new Date().toISOString()
    }, {onConflict:'question_id,reviewer_id'}).then(function(){}).catch(function(){});
  }
  renderTesterTable();
}

function goToTesterCard(idx){
  testerIdx = idx;
  switchTesterMode('card');
  testerRender();
}

function bulkVerdict(verdict){
  var qs = testerQuestions;
  if(_testerTableFilter === 'none')
    qs = qs.filter(function(q){ return !testerResults[q._dbId||q._importKey]; });
  else if(_testerTableFilter !== 'all')
    qs = qs.filter(function(q){
      var r = testerResults[q._dbId||q._importKey];
      return r && r.verdict === _testerTableFilter;
    });
  qs.forEach(function(q){
    var key = q._dbId || q._importKey || '';
    testerResults[key] = {verdict: verdict, note: '', _id: q._dbId, _ik: q._importKey};
    if(currentUser && q._dbId){
      sb.from('question_reviews').upsert({
        import_key:  q._importKey||'',
        question_id: q._dbId,
        reviewer_id: currentUser.id,
        verdict:     verdict,
        note:        '',
        created_at:  new Date().toISOString()
      },{onConflict:'question_id,reviewer_id'}).then(function(){}).catch(function(){});
    }
  });
  renderTesterTable();
  toast('✅ ' + qs.length + ' вопросов → ' + verdict);
}

// Патч startTesterMode: поддержка import batch filter + reset table
var _origStartTesterMode_v69 = startTesterMode;
startTesterMode = async function(mode, batchKeyOrPackKey){
  _testerViewMode = 'card';
  var tabCard  = document.getElementById('tester-tab-card');
  var tabTable = document.getElementById('tester-tab-table');
  var cm       = document.getElementById('tester-card-mode');
  var tm       = document.getElementById('tester-table-mode');
  if(tabCard)  tabCard.classList.add('active');
  if(tabTable) tabTable.classList.remove('active');
  if(cm) cm.style.display  = '';
  if(tm) tm.style.display  = 'none';
  await _origStartTesterMode_v69.apply(this, arguments);
};


// ═══════════════════════════════════════════
// СИСТЕМА ЖАЛОБ НА ВОПРОСЫ
// ═══════════════════════════════════════════
let _reportTargetQ = null;

function openReportModal(q){
  _reportTargetQ = q;
  const existing = document.getElementById('report-modal-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'report-modal-overlay';
  overlay.className = 'report-modal-overlay';
  overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };

  overlay.innerHTML = `
    <div class="report-modal">
      <div style="font-size:15px;font-weight:800;margin-bottom:12px">⚠️ Что не так с вопросом?</div>
      <label class="report-opt"><input type="radio" name="report-reason" value="wrong_answer"> Неправильный ответ</label>
      <label class="report-opt"><input type="radio" name="report-reason" value="typo"> Ошибка в тексте</label>
      <label class="report-opt"><input type="radio" name="report-reason" value="bad_media"> Плохая картинка/аудио/видео</label>
      <label class="report-opt"><input type="radio" name="report-reason" value="unclear"> Вопрос непонятный</label>
      <label class="report-opt"><input type="radio" name="report-reason" value="duplicate"> Повтор вопроса</label>
      <label class="report-opt"><input type="radio" name="report-reason" value="other"> Другое</label>
      <textarea class="report-comment" id="report-comment-txt" placeholder="Дополнительный комментарий (не обязательно)"></textarea>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button onclick="submitReport()" style="flex:1;background:var(--accent);border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">Отправить</button>
        <button onclick="document.getElementById('report-modal-overlay').remove()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function submitReport(){
  const q = _reportTargetQ;
  if(!q){ toast('Ошибка: вопрос не найден'); return; }

  const reasonEl = document.querySelector('input[name="report-reason"]:checked');
  const reason = reasonEl ? reasonEl.value : 'other';
  const comment = (document.getElementById('report-comment-txt')||{}).value || '';

  const report = {
    question_text: (q.q?.ru || q.q || '').slice(0,200),
    question_id:   q._id || null,
    reason,
    comment,
    user_id:       currentUser?.id || null,
    reported_at:   new Date().toISOString(),
    status:        'open',
  };

  // Save to localStorage
  const reports = JSON.parse(localStorage.getItem('mfc_question_reports')||'[]');
  reports.push(report);
  localStorage.setItem('mfc_question_reports', JSON.stringify(reports));

  // Try Supabase
  if(currentUser){
    try{
      await sb.from('question_reports').insert({
        question_id:   q._id || null,
        question_text: report.question_text,
        reason,
        comment,
        reporter_id:   currentUser.id,
        status:        'open',
        created_at:    report.reported_at
      });
    }catch(e){ /* Supabase table may not exist yet — local report saved */ }
  }

  document.getElementById('report-modal-overlay')?.remove();
  toast('✅ Спасибо, мы проверим вопрос', 3000);
  track('question_reported', {reason, has_comment: !!comment});

  // Badge: первая жалоба
  if(checkBadges('bug_finder')){
    setTimeout(()=>showBadgeEarned('bug_finder'), 800);
  }
}

// Render report button on question card
function renderReportBtn(containerId, q){
  const container = document.getElementById(containerId);
  if(!container) return;
  // Remove old report btn if any
  container.querySelectorAll('.report-btn').forEach(b=>b.remove());
  const btn = document.createElement('button');
  btn.className = 'report-btn';
  btn.title = 'Сообщить об ошибке';
  btn.textContent = '⚠️';
  btn.onclick = (e)=>{ e.stopPropagation(); openReportModal(q); };
  // Ensure container is position:relative
  if(getComputedStyle(container).position === 'static'){
    container.style.position = 'relative';
  }
  container.appendChild(btn);
}

// ─── ADMIN: View reports ──────────────────────────────────────────
async function loadAdminReports(){
  const el = document.getElementById('admin-reports-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:12px">⏳ Загрузка жалоб...</div>';

  // Load from Supabase first
  let reports = [];
  try{
    const {data} = await sb.from('question_reports')
      .select('*')
      .eq('status','open')
      .order('created_at',{ascending:false})
      .limit(50);
    if(data && data.length) reports = data;
  }catch(e){}

  // Merge with localStorage reports
  const localReports = JSON.parse(localStorage.getItem('mfc_question_reports')||'[]')
    .filter(r=>r.status!=='closed');
  
  const reasonLabels = {
    wrong_answer:'Неправильный ответ', typo:'Ошибка в тексте',
    bad_media:'Плохое медиа', unclear:'Непонятный вопрос',
    duplicate:'Повтор', other:'Другое'
  };

  const all = [...reports, ...localReports];
  if(!all.length){
    el.innerHTML = '<div style="color:var(--muted);font-size:12px;padding:12px">Жалоб нет 🎉</div>';
    return;
  }

  el.innerHTML = all.map((r,i)=>{
    const dt = r.created_at ? new Date(r.created_at).toLocaleDateString('ru') : '?';
    const reason = reasonLabels[r.reason] || r.reason || 'Другое';
    const isLocal = !r.id;
    return `<div style="padding:10px 0;border-bottom:0.5px solid var(--border)">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px">${isLocal?'[local] ':''}${(r.question_text||'?').slice(0,80)}</div>
      <div style="display:flex;gap:10px;font-size:11px;color:var(--muted)">
        <span style="color:var(--red)">${reason}</span>
        <span>${dt}</span>
        ${r.comment?`<span>💬 ${r.comment.slice(0,40)}</span>`:''}
      </div>
      ${r.id?`<div style="display:flex;gap:6px;margin-top:6px">
        <button onclick="resolveReport('${r.id}','dismissed')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg3);color:var(--muted);font-family:inherit">Отклонить</button>
        <button onclick="resolveReport('${r.id}','resolved')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--green);background:rgba(68,204,136,.1);color:var(--green);font-family:inherit">Исправлено</button>
      </div>`:''}
    </div>`;
  }).join('');
}

async function resolveReport(id, status){
  try{
    await sb.from('question_reports').update({status, resolved_at: new Date().toISOString()}).eq('id', id);
    toast('✅ Жалоба обновлена');
    loadAdminReports();
  }catch(e){ toast('Ошибка: '+e.message); }
}

// ─── Extend BADGE_DEFS with new badges ───────────────────────────
// We add dynamically after BADGE_DEFS is defined
setTimeout(()=>{
  if(typeof BADGE_DEFS !== 'undefined'){
    const newBadges = [
      {key:'bug_finder', icon:'🔍', name:{ru:'Искатель ошибок',en:'Bug Finder'},
       desc:{ru:'Отправь первую жалобу на вопрос',en:'Submit your first question report'}},
      {key:'author',     icon:'✍️', name:{ru:'Автор',en:'Author'},
       desc:{ru:'Предложи первый вопрос',en:'Submit your first question'}},
      {key:'editor',     icon:'📝', name:{ru:'Редактор',en:'Editor'},
       desc:{ru:'Твой вопрос одобрили',en:'Your question was approved'}},
    ];
    newBadges.forEach(b=>{ if(!BADGE_DEFS.find(d=>d.key===b.key)) BADGE_DEFS.push(b); });
  }
}, 100);

// ─── ADMIN HEALTH CHECK: add local question stats ─────────────────
function runLocalHealthCheck(){
  const el = document.getElementById('admin-health-list');
  if(!el) return;

  const allNorm = getAllNormalizedQuestions();
  const general = allNorm.filter(q=>!q.packId);
  const inPacks  = allNorm.filter(q=>q.packId);
  const total = allNorm.length;

  // ── Global integrity ──────────────────────────────────────────
  const noQ       = allNorm.filter(q=>!q.question||q.question.trim().length<2).length;
  const noAns     = allNorm.filter(q=>!Array.isArray(q.options)||q.options.length<2).length;
  const dupOpts   = allNorm.filter(q=>{const a=q.options||[];return new Set(a).size<a.length;}).length;
  const noCorrect = allNorm.filter(q=>q.correctIndex===undefined||q.correctIndex===null).length;
  const outRange  = allNorm.filter(q=>Array.isArray(q.options)&&(q.correctIndex<0||q.correctIndex>=q.options.length)).length;
  const noDiff    = allNorm.filter(q=>!q.difficulty).length;
  const noExpl    = allNorm.filter(q=>!q.explanation||q.explanation.length<3).length;
  const mediaQ    = allNorm.filter(q=>q.media&&q.media.type&&q.media.type!=='none');
  const mediaBad  = mediaQ.filter(q=>!q.media.url&&!q.media.filename&&!q.media.placeholder).length;

  // ── Playable render check (via toPlayableQuestion) ────────────
  let playErr = 0;
  allNorm.forEach(rawQ=>{
    const pq = toPlayableQuestion(rawQ);
    if(!pq.q||pq.q.trim().length<1) playErr++;
    else if(!pq.a||pq.a.length<2) playErr++;
    else if(pq.c<0||pq.c>=pq.a.length) playErr++;
  });

  // ── ALL_Q_BASE correctIndex ────────────────────────────────────
  const genCidx={};
  general.forEach(q=>{const c=String(q.correctIndex);genCidx[c]=(genCidx[c]||0)+1;});
  const genMaxC = general.length>0?Math.max(...Object.values(genCidx)):0;
  const genCidxStr = Object.entries(genCidx).sort((a,b)=>+a[0]-+b[0]).map(([k,v])=>`[${k}]:${v}`).join(' ');
  const genCidxWarn = genMaxC > general.length*0.35;
  const genMediaD = {image:0,audio:0,video:0,none:0};
  general.forEach(q=>{const t=(q.media&&q.media.type)||'none';genMediaD[t]=(genMediaD[t]||0)+1;});

  // ── Overall correctIndex & variants ───────────────────────────
  const dist={};
  allNorm.forEach(q=>{const c=String(q.correctIndex);dist[c]=(dist[c]||0)+1;});
  const maxIdx = Object.values(dist).length?Math.max(...Object.values(dist)):0;
  const distStr = Object.entries(dist).sort((a,b)=>+a[0]-+b[0]).map(([k,v])=>`[${k}]:${v}`).join(' ');
  const distWarn = maxIdx > total*0.35;
  const ansD={};
  allNorm.forEach(q=>{const n=String((q.options||[]).length);ansD[n]=(ansD[n]||0)+1;});
  const ansStr = Object.entries(ansD).sort((a,b)=>+a[0]-+b[0]).map(([k,v])=>`${k}вар:${v}`).join(' ');

  // ── Per-pack ───────────────────────────────────────────────────
  // Local demo packs health check (only in dev mode)
  let packChecks = [];
  if(ENABLE_LOCAL_DEMO_PACKS){
    packChecks = PACKS.map(pack=>{
    const pq = allNorm.filter(q=>q.packId===pack.id);
    const packAnsD={};
    pq.forEach(q=>{const n=String((q.options||[]).length);packAnsD[n]=(packAnsD[n]||0)+1;});
    const packMedia={image:0,audio:0,video:0};
    pq.forEach(q=>{const t=(q.media&&q.media.type)||'none';if(packMedia[t]!==undefined)packMedia[t]++;});
    const packCidx={};
    pq.forEach(q=>{const c=String(q.correctIndex);packCidx[c]=(packCidx[c]||0)+1;});
    const packMaxC = pq.length>0?Math.max(...Object.values(packCidx)):0;
    const hasAllMedia = packMedia.image>0&&packMedia.audio>0&&packMedia.video>0;
    const ansTypes = Object.keys(packAnsD).map(Number).sort();
    const hasVariety = ansTypes.includes(2)&&ansTypes.includes(6);
    return {
      id:pack.id, name:pack.name?.ru||pack.id, count:pq.length,
      price:pack.price||0, isPaid:(pack.price||0)>0,
      hasImg:packMedia.image>0, hasAudio:packMedia.audio>0, hasVideo:packMedia.video>0,
      hasAllMedia, ansTypes, hasVariety,
      cidxWarn:packMaxC>pq.length*0.4,
      mediaStr:`img:${packMedia.image} aud:${packMedia.audio} vid:${packMedia.video}`,
      hasPackId:pq.every(q=>q.packId), hasStatus:pq.every(q=>q.status), hasTags:pq.every(q=>q.tags&&q.tags.length>0),
    };
  }); // end PACKS.map
  } // end if(ENABLE_LOCAL_DEMO_PACKS)

  const dbVer  = localStorage.getItem('mfc_question_db_version')||'?';
  const reports = JSON.parse(localStorage.getItem('mfc_question_reports')||'[]').length;
  const pending = JSON.parse(localStorage.getItem('mfc_pending_questions')||'[]').length;

  const mkRow = (ok,label,sub) => {
    const icon = ok===true?'✅':ok===null?'⚠️':'❌';
    const color = ok===true?'var(--green)':ok===null?'var(--gold)':'var(--red)';
    return `<div style="display:flex;align-items:flex-start;gap:5px;padding:3px 0;border-bottom:0.5px solid var(--border)">
      <span style="color:${color};flex-shrink:0;font-size:12px">${icon}</span>
      <span style="font-size:11px;color:${ok===false?'var(--red)':ok===null?'var(--gold)':'var(--muted)'}">
        ${label}${sub?`<br><span style="font-size:10px;opacity:.7">${sub}</span>`:''}
      </span>
    </div>`;
  };

  let html = '';
  html += mkRow(true,`БД v${dbVer} | Всего: ${total} (общих: ${general.length}, в паках: ${inPacks.length})`);
  html += mkRow(noQ===0,`Без текста: ${noQ}`);
  html += mkRow(noAns===0,`Менее 2 вариантов: ${noAns}`);
  html += mkRow(dupOpts===0,`Дубли вариантов: ${dupOpts}`);
  html += mkRow(noCorrect===0,`Без correctIndex: ${noCorrect}`);
  html += mkRow(outRange===0,`correctIndex вне диапазона: ${outRange}`);
  html += mkRow(noDiff===0,`Без difficulty: ${noDiff}`);
  html += mkRow(noExpl<total*0.15,`Без explanation: ${noExpl}`);
  html += mkRow(mediaBad===0,`Медиа без url/filename/placeholder: ${mediaBad}`);
  html += mkRow(playErr===0,`Playable render check: ${playErr===0?'OK':'ошибок '+playErr}`,
    playErr>0?'Вопросы без вариантов или вне диапазона correctIndex':'');

  // ALL_Q_BASE
  html += '<div style="margin-top:6px;font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px">ALL_Q_BASE:</div>';
  html += mkRow(!genCidxWarn,`correctIndex: ${genCidxStr}`,genCidxWarn?'⚠️ дисбаланс > 35%':'');
  html += mkRow(genMediaD.video>=2,`Медиа: img:${genMediaD.image} aud:${genMediaD.audio} vid:${genMediaD.video}`,genMediaD.video<2?'⚠️ нужно ≥2 video':'');

  html += '<div style="margin-top:6px;font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px">ВСЕГО:</div>';
  html += mkRow(!distWarn,`correctIndex: ${distStr}`,distWarn?'⚠️ дисбаланс':'');
  html += mkRow(!!ansD['2']&&!!ansD['6'],`Варианты: ${ansStr}`);

  // Packs
  html += '<div style="margin-top:6px;font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px">ПАКИ:</div>';
  packChecks.forEach(p=>{
    const ok10  = p.count===10;
    const okPaid = p.isPaid;
    html += `<div style="font-size:11px;padding:2px 0;border-bottom:0.5px solid var(--border)">
      <span style="color:${ok10?'var(--green)':'var(--red)'}">●</span>
      <b>${p.name}</b>: ${p.count}q
      <span style="color:${okPaid?'var(--green)':'var(--red)'}"> | ${p.price}⚡</span>
      <span style="color:${p.hasAllMedia?'var(--green)':'var(--red)'}"> | ${p.mediaStr}</span>
      <span style="color:${p.hasVariety?'var(--green)':'var(--gold)'}"> | вар:${p.ansTypes.join(',')}</span>
      ${p.cidxWarn?'<span style="color:var(--gold)"> | ⚠️cidx</span>':''}
    </div>`;
  });

  const cats={},diffs={};
  allNorm.forEach(q=>{cats[q.category]=(cats[q.category]||0)+1;diffs[q.difficulty||'?']=(diffs[q.difficulty||'?']||0)+1;});
  html += '<div style="margin-top:6px;font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px">КАТЕГОРИИ:</div>';
  html += '<div style="font-size:10px;color:var(--muted)">'+Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(' | ')+'</div>';
  html += '<div style="font-size:10px;color:var(--muted)">'+['easy','medium','hard','expert'].filter(d=>diffs[d]).map(d=>`${d}:${diffs[d]}`).join(' | ')+'</div>';
  html += mkRow(true,`Жалоб: ${reports} | На проверке: ${pending}`);

  el.innerHTML = html;
}

// Download health report as JSON
function downloadHealthReport(){
  const allQ = [...ALL_Q_BASE];
  if(ENABLE_LOCAL_DEMO_PACKS) PACKS.forEach(p => allQ.push(...(p.questions||[])));
  const report = {
    generated_at: new Date().toISOString(),
    db_version: localStorage.getItem('mfc_question_db_version'),
    total: allQ.length,
    general: ALL_Q_BASE.length,
    packs: PACKS.map(p=>({id:p.id, name:p.name?.ru, count:p.questions?.length})),
    issues: {
      no_text: allQ.filter(q=>!q.q?.ru&&!q.q?.en&&!q.q).length,
      no_answers: allQ.filter(q=>!Array.isArray(q.a?.ru||q.a)).length,
      no_correct: allQ.filter(q=>q.c===undefined||q.c===null).length,
      no_explanation: allQ.filter(q=>!q.explanation).length,
    },
    correctIndex_distribution: (()=>{
      const d={};
      allQ.forEach(q=>{const c=String(q.c);d[c]=(d[c]||0)+1;});
      return d;
    })(),
    reports_local: JSON.parse(localStorage.getItem('mfc_question_reports')||'[]').length,
  };
  const blob = new Blob([JSON.stringify(report,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'mfc_health_report_'+new Date().toISOString().slice(0,10)+'.json';
  a.click();
}

// ─── ADMIN: Clear all questions (with confirmation) ───────────────
function adminClearQuestions(){
  if(!isAdmin()){toast('Нет прав');return;}
  if(!confirm('⚠️ Очистить ЛОКАЛЬНУЮ базу вопросов?\n\nЭто удалит вопросы из localStorage браузера.\nВопросы в Supabase НЕ удаляются.\nПрофиль, нейроны, достижения СОХРАНЯТСЯ.\n\nПродолжить?')) return;
  if(!confirm('ПОДТВЕРЖДЕНИЕ: Удалить все локальные вопросы?')) return;
  localStorage.removeItem('mfc_questions_local');
  localStorage.removeItem('mfc_seed_questions');
  localStorage.removeItem('mfc_question_db_version');
  toast('✅ Локальные вопросы удалены. Профиль сохранён.');
  setTimeout(()=>location.reload(), 1500);
}

// ─── Patch runHealthCheck to also run local check ────────────────
const _origRunHC = typeof runHealthCheck === 'function' ? runHealthCheck : null;
if(_origRunHC){
  runHealthCheck = async function(){
    await _origRunHC.apply(this, arguments);
    runLocalHealthCheck();
  };
}


// ─── Render next goal widget on home ─────────────────────────────
function renderHomeNextGoal(){
  const el = document.getElementById('home-next-goal-widget');
  if(!el) return;

  const goals = [];

  // Check achievements not yet earned
  if(!earnedBadges.has('first'))
    goals.push({icon:'⚡', text:'Сыграй первую игру', action:()=>startQuickPlay()});
  if(!earnedBadges.has('perfect'))
    goals.push({icon:'🎯', text:'Ответь на все вопросы правильно (Идеально)', action:null});
  if(!earnedBadges.has('streak3'))
    goals.push({icon:'🔥', text:'Играй 3 дня подряд (Серия x3)', action:null});
  if(!earnedBadges.has('duel'))
    goals.push({icon:'⚔️', text:'Сыграй первую дуэль', action:()=>showScreen('duel')});
  if(!earnedBadges.has('neurons100')){
    const needed = Math.max(0, 100 - neurons);
    goals.push({icon:'🧠', text:`Набери 100 нейронов (ещё ${needed})`, action:null});
  }
  if(!earnedBadges.has('author'))
    goals.push({icon:'✍️', text:'Предложи вопрос (стань автором)', action:()=>{openAuthorBuilder()}});

  if(!goals.length){
    el.innerHTML = '<div style="font-size:13px;font-weight:700;color:var(--gold)">🏆 Все основные достижения получены!</div>';
    return;
  }

  const g = goals[0];
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px">
      <div style="font-size:24px;flex-shrink:0">${g.icon}</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:700;margin-bottom:2px">${g.text}</div>
        <div style="font-size:11px;color:var(--muted)">Ближайшая цель · ${goals.length} целей всего</div>
      </div>
      ${g.action?`<button onclick="(${g.action.toString()})()" style="background:rgba(108,99,255,.2);border:0.5px solid rgba(108,99,255,.4);border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit;white-space:nowrap">→</button>`:''}
    </div>`;
}

// Hook renderHomeNextGoal into showScreen('home') — deferred
document.addEventListener('DOMContentLoaded', () => {
  if (typeof window.showScreen === 'function') {
    const _origShowScreen_goals = window.showScreen;
    window.showScreen = function(name){
      _origShowScreen_goals.apply(this, arguments);
      if(name === 'home') {
        setTimeout(renderHomeNextGoal, 60);
        setTimeout(() => window.checkDailyReward?.(), 1000);
        _loadHomePlayerCount();
      }
    };
  }
});

async function _loadHomePlayerCount() {
  const wrap = document.getElementById('home-player-count');
  const val  = document.getElementById('home-player-count-val');
  if (!wrap || !val) return;
  // Cache for 10 minutes
  const CACHE_KEY = 'bfc_player_count_cache';
  const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
  if (cached && Date.now() - cached.ts < 600_000) {
    val.textContent = cached.count.toLocaleString('ru');
    wrap.style.display = '';
    return;
  }
  const { count } = await sb.from('profiles').select('id', { count: 'exact', head: true });
  if (count && count > 0) {
    val.textContent = count.toLocaleString('ru');
    wrap.style.display = '';
    localStorage.setItem(CACHE_KEY, JSON.stringify({ count, ts: Date.now() }));
  }
}

// ── Daily login reward ────────────────────────────────────────────────
window.checkDailyReward = async function() {
  if (!currentUser) return;
  const key = 'bfc_daily_reward_' + currentUser.id;
  const lastClaim = localStorage.getItem(key);
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  if (lastClaim === today) return; // already claimed today

  // Call award_currency with daily_login operation type
  const { data } = await sb.rpc('award_currency', {
    p_operation_type: 'daily_login',
    p_operation_key: 'daily_login_' + today + '_' + currentUser.id,
  });

  if (data?.ok && !data.already_processed) {
    localStorage.setItem(key, today);
    // Calculate streak for bonus message
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const streak = lastClaim === yesterday
      ? parseInt(localStorage.getItem(key + '_streak') || '0') + 1
      : 1;
    localStorage.setItem(key + '_streak', streak);

    // Show reward toast
    _showDailyRewardPopup(data.awarded_neurons, streak);

    // Update neuron display
    if (typeof window.updNeurons === 'function') window.updNeurons();
    if (typeof window.loadUserNeurons === 'function') window.loadUserNeurons();
  }
};

function _showDailyRewardPopup(neurons, streak) {
  const isBonus = streak > 0 && streak % 7 === 0;
  let modal = document.getElementById('daily-reward-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'daily-reward-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,20,.85);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.onclick = () => modal.remove();
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px;padding:28px;width:100%;max-width:320px;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">${isBonus ? '🎁' : '⚡'}</div>
    <div style="font-size:20px;font-weight:900;margin-bottom:4px">${isBonus ? 'Бонус недели!' : 'Ежедневная награда'}</div>
    <div style="font-size:36px;font-weight:900;color:var(--accent2);margin:12px 0">+${neurons} ⚡</div>
    ${streak > 1 ? `<div style="font-size:13px;color:var(--muted);margin-bottom:8px">🔥 ${streak} дней подряд</div>` : ''}
    ${streak === 1 && neurons > 0 ? `<div style="font-size:12px;color:var(--muted);margin-bottom:8px">Вчера не заходил? <span onclick="document.getElementById('daily-reward-modal').remove();window.showStreakRestoreModal?.()" style="color:var(--accent2);cursor:pointer;font-weight:700">Восстановить серию →</span></div>` : ''}
    ${isBonus ? `<div style="font-size:13px;color:#4ade80;margin-bottom:8px">7-дневный стрик!</div>` : ''}
    <button onclick="document.getElementById('daily-reward-modal').remove()" style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-top:8px">Забрать!</button>
  </div>`;
  modal.style.display = 'flex';
  setTimeout(() => modal.remove(), 8000);
}

// ── Streak Restore ─────────────────────────────────────────────────────
window.showStreakRestoreModal = async function() {
  if (!currentUser) { toast('Войдите в аккаунт'); return; }
  const COST = 50;
  let modal = document.getElementById('streak-restore-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'streak-restore-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,20,.88);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px;padding:28px;width:100%;max-width:320px;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">🔥</div>
    <div style="font-size:18px;font-weight:900;margin-bottom:6px">Восстановить серию?</div>
    <div style="font-size:13px;color:var(--muted);line-height:1.5;margin-bottom:20px">
      Твоя ежедневная серия прервалась.<br>
      Заплати <b style="color:var(--accent2)">${COST} ⚡</b> и продолжи с 1 дня.
    </div>
    <div id="streak-restore-err" style="font-size:12px;color:var(--red);min-height:16px;margin-bottom:8px"></div>
    <button onclick="doRestoreStreak()" style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">Восстановить за ${COST} ⚡</button>
    <button onclick="document.getElementById('streak-restore-modal').remove()" style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Не сейчас</button>
  </div>`;
  modal.style.display = 'flex';
};

window.doRestoreStreak = async function() {
  const btn = document.querySelector('#streak-restore-modal button');
  if (btn) btn.textContent = '...';
  const { data, error } = await sb.rpc('restore_streak');
  const errEl = document.getElementById('streak-restore-err');
  if (error || !data?.ok) {
    const reason = data?.reason;
    const msg = reason === 'not_enough'
      ? `Недостаточно нейронов (нужно ${data.need}, есть ${data.have})`
      : reason === 'streak_active'
      ? 'Серия уже активна!'
      : 'Ошибка: ' + (error?.message || reason);
    if (errEl) errEl.textContent = msg;
    if (btn) btn.textContent = `Восстановить за 50 ⚡`;
    return;
  }
  document.getElementById('streak-restore-modal')?.remove();
  toast('🔥 Серия восстановлена!');
  if (typeof window.updNeurons === 'function') window.updNeurons();
  if (typeof window.loadUserNeurons === 'function') window.loadUserNeurons();
};

// ── Ticket Check-in (for organizers) ──────────────────────────────────
window.openTicketCheckin = function() {
  let modal = document.getElementById('checkin-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'checkin-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9990;background:var(--bg);display:flex;flex-direction:column';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="padding:20px">
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <button onclick="document.getElementById('checkin-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0">←</button>
      <div style="font-size:18px;font-weight:900">Отметка на входе</div>
    </div>
    <div style="background:rgba(108,99,255,.08);border:1px solid rgba(108,99,255,.25);border-radius:16px;padding:20px;margin-bottom:16px;text-align:center">
      <div style="font-size:13px;color:var(--muted);margin-bottom:10px">Введи код билета участника</div>
      <input id="checkin-code-input" placeholder="BFC-XXXX-XXXX" maxlength="14"
        style="width:100%;text-align:center;font-size:20px;font-weight:900;letter-spacing:2px;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:12px;text-transform:uppercase"
        oninput="this.value=this.value.toUpperCase()"
        onkeydown="if(event.key==='Enter')redeemTicket()" />
      <button onclick="redeemTicket()" style="width:100%;background:var(--accent);border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">✓ Отметить</button>
    </div>
    <div id="checkin-result" style="font-size:14px;text-align:center;min-height:24px"></div>
    <div style="margin-top:16px">
      <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:8px">ПОСЛЕДНИЕ ОТМЕТКИ</div>
      <div id="checkin-recent" style="font-size:13px;color:var(--muted)"></div>
    </div>
  </div>`;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('checkin-code-input')?.focus(), 100);
};

window.redeemTicket = async function() {
  const code = document.getElementById('checkin-code-input')?.value.trim().toUpperCase();
  const resultEl = document.getElementById('checkin-result');
  const recentEl = document.getElementById('checkin-recent');
  if (!code) return;

  const { data: ticket, error } = await sb.from('quiz_pass_purchases')
    .select('id, buyer_name, is_redeemed, quiz_passes(title, organizer_id)')
    .eq('ticket_code', code)
    .maybeSingle();

  if (error || !ticket) {
    if (resultEl) resultEl.innerHTML = '<div style="color:var(--red);font-size:28px">❌ Билет не найден</div>';
    return;
  }

  // Check organizer owns this pass
  if (ticket.quiz_passes?.organizer_id !== currentUser?.id) {
    if (resultEl) resultEl.innerHTML = '<div style="color:var(--red)">❌ Это не твоё мероприятие</div>';
    return;
  }

  if (ticket.is_redeemed) {
    if (resultEl) resultEl.innerHTML = `<div style="color:#f59e0b;font-size:20px">⚠️ Уже отмечен<br><span style="font-size:13px;color:var(--muted)">${ticket.buyer_name}</span></div>`;
    return;
  }

  await sb.from('quiz_pass_purchases').update({ is_redeemed: true }).eq('id', ticket.id);
  if (resultEl) resultEl.innerHTML = `<div style="color:#4ade80;font-size:28px">✅ Вход разрешён<br><span style="font-size:16px">${ticket.buyer_name}</span></div>`;
  if (document.getElementById('checkin-code-input')) document.getElementById('checkin-code-input').value = '';

  // Add to recent list
  const item = document.createElement('div');
  item.style.cssText = 'padding:8px;background:rgba(74,222,128,.08);border-radius:10px;margin-bottom:6px;font-size:12px';
  item.innerHTML = `<span style="color:#4ade80">✓</span> ${ticket.buyer_name} · ${new Date().toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}`;
  recentEl?.prepend(item);
};


// ═══════════════════════════════════════════
// НОРМАЛИЗАЦИЯ ВОПРОСОВ — единый формат
// ═══════════════════════════════════════════
function normalizeQuestion(q, packId){
  const rawQ = q.q && typeof q.q === 'object' ? (q.q.ru || q.q.en || '') : (q.q || '');
  const rawA = q.a && !Array.isArray(q.a) ? (q.a.ru || q.a.en || []) : (q.a || []);
  const mediaType = q.img ? 'image' : q.audio ? 'audio' : q.video ? 'video' : 'none';
  const mediaUrl  = q.img || q.audio || q.video || (q.media && q.media.url) || '';
  const mediaPlaceholder = (q.media && q.media.placeholder) || '';
  return {
    id:          q.id || q._id || ('q_' + Math.abs(rawQ.split('').reduce((a,c)=>a+c.charCodeAt(0),0)).toString(36)),
    question:    rawQ,
    options:     rawA,
    correctIndex: q.c !== undefined ? q.c : (q.correctIndex !== undefined ? q.correctIndex : 0),
    category:    q.cat || q.category || 'GENERAL',
    difficulty:  q.difficulty || 'medium',
    explanation: q.explanation || q.explanation_ru || '',
    media:       {
      type:        q.media ? (q.media.type || mediaType) : mediaType,
      url:         q.media ? (q.media.url || mediaUrl) : mediaUrl,
      filename:    q.media ? (q.media.filename || '') : '',
      placeholder: q.media ? (q.media.placeholder || mediaPlaceholder) : mediaPlaceholder,
    },
    tags:        q.tags || [],
    packId:      packId || q.packId || null,
    status:      q.status || (q._status) || 'approved',
    source:      q.source || '_source' in q ? q._source : 'seed',
    // Legacy game fields preserved
    cat: q.cat || q.category || 'GENERAL',
    q:   rawQ,
    a:   rawA,
    c:   q.c !== undefined ? q.c : 0,
    t:   q.t || 20,
    img: q.img || null,
    audio: q.audio || null,
    video: q.video || null,
    _id: q._id || null,
    explanation_ru: q.explanation || q.explanation_ru || '',
  };
}

// Pre-normalize all seed questions once at startup for health check
function getAllNormalizedQuestions(){
  const result = [];
  ALL_Q_BASE.forEach((q,i) => {
    const n = normalizeQuestion(q, null);
    n.id = 'q_general_' + String(i+1).padStart(3,'0');
    n.status = 'approved';
    n.source = 'seed';
    result.push(n);
  });
  PACKS.forEach(pack => {
    (pack.questions||[]).forEach((q,i) => {
      const n = normalizeQuestion(q, pack.id);
      n.id = 'q_' + pack.id + '_' + String(i+1).padStart(3,'0');
      n.status = 'approved';
      n.source = 'seed';
      result.push(n);
    });
  });
  return result;
}


function openAuthorBuilder(){
  showScreen('author-builder');
  setTimeout(()=>{ if(typeof initAuthorBuilder==='function') initAuthorBuilder(); },50);
}


// ─── Tester: Edit question modal ─────────────────────────────────
let _testerEditIdx = null;

function openTesterEdit(idx){
  _testerEditIdx = idx;
  const q = testerQuestions[idx];
  if(!q){ toast('Вопрос не найден'); return; }

  const existing = document.getElementById('tester-edit-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'tester-edit-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:4000;overflow-y:auto;padding:16px;display:flex;align-items:flex-start;justify-content:center';
  overlay.onclick = e=>{ if(e.target===overlay) closeTesterEdit(); };

  const answers = Array.isArray(q.a) ? q.a : (q.a && typeof q.a==='object' ? (q.a.ru||q.a.en||[]) : []);
  const mediaObj = q.media||{type:'none',url:'',filename:'',placeholder:''};
  const isSeed = !q._id || String(q._id).startsWith('q_');

  let ansHtml = answers.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <input type="radio" name="te-correct" value="${i}" ${q.c===i?'checked':''} style="accent-color:var(--green);flex-shrink:0">
      <input id="te-ans-${i}" type="text" value="${a.replace(/"/g,'&quot;')}"
        style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:6px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
    </div>`).join('');

  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;padding:20px;width:100%;max-width:560px;margin:auto">
      <div style="font-size:15px;font-weight:800;margin-bottom:14px">✏️ Редактирование вопроса #${idx+1}
        ${isSeed?'<span style="font-size:11px;color:var(--gold);margin-left:8px">[seed — изменения только в памяти]</span>':''}
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Текст вопроса</div>
      <textarea id="te-qtext" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;color:var(--text);font-family:inherit;outline:none;resize:vertical;min-height:80px;margin-bottom:10px">${(q.q||'').replace(/</g,'&lt;')}</textarea>
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Варианты ответа (выбери правильный слева)</div>
      <div id="te-answers-list">${ansHtml}</div>
      <div style="display:flex;gap:8px;margin-bottom:10px">
        <div style="flex:1">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Категория</div>
          <input id="te-cat" type="text" value="${q.cat||''}" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
        </div>
        <div style="flex:1">
          <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Сложность</div>
          <select id="te-diff" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
            ${['easy','medium','hard','expert'].map(d=>`<option value="${d}" ${q.difficulty===d?'selected':''}>${d}</option>`).join('')}
          </select>
        </div>
      </div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Объяснение</div>
      <textarea id="te-expl" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;color:var(--text);font-family:inherit;outline:none;resize:vertical;min-height:60px;margin-bottom:10px">${(q.explanation||q.explanation_ru||'').replace(/</g,'&lt;')}</textarea>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Медиа</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">Тип</div>
          <select id="te-mtype" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
            ${['none','image','audio','video'].map(t=>`<option value="${t}" ${mediaObj.type===t?'selected':''}>${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">URL</div>
          <input id="te-murl" type="text" value="${(mediaObj.url||'').replace(/"/g,'&quot;')}" placeholder="https://..." style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">Filename</div>
          <input id="te-mfile" type="text" value="${(mediaObj.filename||'').replace(/"/g,'&quot;')}" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
        </div>
        <div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:3px">Placeholder</div>
          <input id="te-mplaceholder" type="text" value="${(mediaObj.placeholder||'').replace(/"/g,'&quot;')}" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:6px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
        </div>
      </div>
      <div style="display:flex;gap:8px">
        <button onclick="saveTesterEdit()" style="flex:1;background:var(--accent);border:none;border-radius:12px;padding:12px;font-size:14px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">Сохранить</button>
        <button onclick="closeTesterEdit()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function saveTesterEdit(){
  const idx = _testerEditIdx;
  if(idx===null||idx===undefined) return;
  const q = testerQuestions[idx];
  if(!q) return;

  const newQ = document.getElementById('te-qtext')?.value||'';
  const newCat = document.getElementById('te-cat')?.value||q.cat;
  const newDiff = document.getElementById('te-diff')?.value||q.difficulty;
  const newExpl = document.getElementById('te-expl')?.value||'';
  const newMType = document.getElementById('te-mtype')?.value||'none';
  const newMUrl = document.getElementById('te-murl')?.value||'';
  const newMFile = document.getElementById('te-mfile')?.value||'';
  const newMPh = document.getElementById('te-mplaceholder')?.value||'';

  // Collect answers
  const newAnswers = [];
  let ai = 0;
  while(document.getElementById('te-ans-'+ai)){
    newAnswers.push(document.getElementById('te-ans-'+ai).value);
    ai++;
  }
  const correctEl = document.querySelector('input[name="te-correct"]:checked');
  const newCorrect = correctEl ? parseInt(correctEl.value) : q.c;

  if(!newQ.trim()){ toast('Текст вопроса не может быть пустым'); return; }
  if(newAnswers.filter(Boolean).length < 2){ toast('Минимум 2 варианта ответа'); return; }

  // Update in memory
  testerQuestions[idx] = {
    ...q,
    q: newQ,
    a: newAnswers.filter(Boolean),
    c: newCorrect,
    cat: newCat,
    difficulty: newDiff,
    explanation: newExpl,
    explanation_ru: newExpl,
    media: { type:newMType, url:newMUrl, filename:newMFile, placeholder:newMPh },
  };

  // If it has a real Supabase id, try to update
  if(q._id && !String(q._id).startsWith('q_')){
    sb.from('questions').update({
      question_ru: newQ, question: newQ,
      answers_json: JSON.stringify(newAnswers.filter(Boolean)),
      correct_index: newCorrect,
      category: newCat,
      difficulty: newDiff,
      explanation_ru: newExpl,
      media_type: newMType, media_url: newMUrl,
    }).eq('id', q._id).then(({error})=>{
      if(error) toast('⚠️ Supabase: '+error.message.slice(0,50));
      else toast('✅ Сохранено в Supabase');
    });
  } else {
    toast('✅ Изменено в памяти (seed-вопрос)');
  }

  closeTesterEdit();
  renderTesterTable();
  if(_testerViewMode==='card') testerRender();
}

function closeTesterEdit(){
  document.getElementById('tester-edit-overlay')?.remove();
  _testerEditIdx = null;
}

// ─── Tester: Media preview modal ─────────────────────────────────
function openTesterMediaPreview(idx){
  const q = testerQuestions[idx];
  if(!q){ toast('Вопрос не найден'); return; }

  const existing = document.getElementById('tester-media-overlay');
  if(existing) existing.remove();

  const mediaObj = q.media||{type:q._mediaType||'none',url:q._mediaUrl||'',placeholder:''};
  const mtype = mediaObj.type||'none';
  const murl = mediaObj.url||'';
  const mplaceholder = mediaObj.placeholder||'';

  let mediaContent = '';
  if(mtype==='image' && murl){
    mediaContent = `<img src="${murl}" alt="" style="max-width:100%;max-height:60vh;object-fit:contain;border-radius:8px">`;
  } else if(mtype==='audio' && murl){
    mediaContent = `<audio controls style="width:100%;margin:8px 0"><source src="${murl}"></audio>`;
  } else if(mtype==='video' && murl){
    mediaContent = `<video controls style="max-width:100%;max-height:50vh;border-radius:8px"><source src="${murl}"></video>`;
  } else if(mtype!=='none' && mplaceholder){
    mediaContent = `<div style="padding:24px;text-align:center;background:var(--bg3);border-radius:12px">
      <div style="font-size:32px;margin-bottom:8px">${mtype==='image'?'🖼':mtype==='audio'?'🎵':'🎬'}</div>
      <div style="font-size:13px;color:var(--muted)">Медиа будет добавлено:<br>${mplaceholder}</div>
      ${mediaObj.filename?`<div style="font-size:11px;color:var(--accent2);margin-top:6px">${mediaObj.filename}</div>`:''}
    </div>`;
  } else {
    mediaContent = `<div style="padding:24px;text-align:center;color:var(--muted)">У вопроса нет медиа</div>`;
  }

  const overlay = document.createElement('div');
  overlay.id = 'tester-media-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:4000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;padding:20px;width:100%;max-width:520px">
      <div style="font-size:14px;font-weight:800;margin-bottom:12px">Предпросмотр медиа — вопрос #${idx+1}</div>
      ${mediaContent}
      <div style="font-size:12px;color:var(--muted);margin-top:10px;padding-top:8px;border-top:0.5px solid var(--border)">
        Тип: <b>${mtype}</b>${mediaObj.filename?' | Файл: <b>'+mediaObj.filename+'</b>':''}
        ${murl?' | URL: <span style="font-size:10px">'+murl.slice(0,50)+(murl.length>50?'…':'')+'</span>':''}
      </div>
      <button onclick="this.closest('#tester-media-overlay').remove()" 
        style="width:100%;margin-top:12px;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">
        Закрыть
      </button>
    </div>`;
  document.body.appendChild(overlay);
}

// ══════════════════════════════════════════════════════════════
// v87: ALL QUESTIONS ADMIN MODE
// ══════════════════════════════════════════════════════════════
let _aqFilter = 'all';
let _aqData   = [];
let _aqSearchTimeout = null;

const AQ_STATUS_LABELS = {
  published:'Опубл.', draft:'Draft', tester:'Tester', approved:'Approved',
  archived:'Архив', deleted:'Удалён', rejected:'Отклонён', fix:'На правку'
};
const AQ_FILTERS = [
  {key:'all',        label:'Все'},
  {key:'published',  label:'Опубликованные'},
  {key:'official',   label:'Официальные'},
  {key:'pack',       label:'Паки'},
  {key:'community',  label:'Community'},
  {key:'draft',      label:'Draft'},
  {key:'tester',     label:'Tester'},
  {key:'approved',   label:'Approved'},
  {key:'fix',        label:'Fix'},
  {key:'rejected',   label:'Rejected'},
  {key:'archived',   label:'Archived'},
  {key:'deleted',    label:'Deleted'},
  {key:'problems',   label:'⚠️ Проблемные'},
  {key:'no_media',   label:'Без медиа'},
  {key:'ph_media',   label:'Placeholder-медиа'},
  {key:'dupes',      label:'Дубликаты'},
];
let _aqCatFilter = '';   // category filter ('' = all)
let _aqPackFilter = '';  // import_key prefix filter ('' = all)

async function showAllQuestionsAdmin(initialFilter){
  if(!isAdmin()){ toast('Нет прав'); return; }
  _aqFilter = initialFilter || 'all';

  const existing = document.getElementById('aq-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'aq-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:5000;display:flex;flex-direction:column;overflow:hidden';

  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:0.5px solid var(--border);background:var(--bg2);flex-shrink:0">
      <button onclick="document.getElementById('aq-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1">←</button>
      <div style="font-size:14px;font-weight:800;color:var(--text);flex:1">🗂 Все вопросы</div>
      <button onclick="aqStartBulkReview()" style="background:var(--accent);border:none;border-radius:8px;padding:5px 12px;font-size:11px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">▶ Проверить все</button>
      <div id="aq-count" style="font-size:12px;color:var(--muted)">—</div>
    </div>
    <div style="padding:8px 12px;border-bottom:0.5px solid var(--border);background:var(--bg2);flex-shrink:0;overflow-x:auto;white-space:nowrap">
      <div style="display:inline-flex;gap:6px">
        ${AQ_FILTERS.map(f=>`<button onclick="aqSetFilter('${f.key}')" id="aqf-${f.key}"
          style="background:${_aqFilter===f.key?'var(--accent)':'var(--bg3)'};border:0.5px solid var(--border);border-radius:20px;padding:5px 12px;font-size:11px;font-weight:700;color:${_aqFilter===f.key?'#fff':'var(--muted)'};cursor:pointer;font-family:inherit;white-space:nowrap"
          >${f.label}</button>`).join('')}
      </div>
    </div>
    <div style="padding:6px 12px;border-bottom:0.5px solid var(--border);background:var(--bg2);flex-shrink:0;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
      <select id="aq-cat-filter" onchange="aqSetCat(this.value)" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:5px 8px;font-size:11px;color:var(--text);font-family:inherit;outline:none">
        <option value="">Все категории</option>
        <option value="SCIENCE">Наука</option><option value="HISTORY">История</option>
        <option value="GEOGRAPHY">География</option><option value="SPORTS">Спорт</option>
        <option value="CINEMA">Кино</option><option value="MUSIC">Музыка</option>
        <option value="GENERAL">General</option>
      </select>
      <input id="aq-pack-filter" oninput="aqSetPack(this.value)" placeholder="import_key содержит..."
        style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:5px 8px;font-size:11px;color:var(--text);font-family:inherit;outline:none;width:140px">
      <input id="aq-search" oninput="aqSearch(this.value)" placeholder="🔍 Поиск..."
        style="flex:1;min-width:120px;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:5px 10px;font-size:11px;color:var(--text);font-family:inherit;outline:none">
    </div>
    <div id="aq-table-wrap" style="flex:1;overflow-y:auto;padding:8px 12px 80px">
      <div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">⏳ Загрузка...</div>
    </div>`;

  document.body.appendChild(overlay);
  await aqLoad();
}

async function aqLoad(){
  const wrap = document.getElementById('aq-table-wrap');
  if(!wrap) return;
  wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:24px">⏳ Загрузка вопросов из Supabase...</div>';

  try{
    const {data, error} = await sb.from('questions')
      .select('id,question_ru,question_text,answers_json,answers_ru,correct_index,category,status,source_type,import_key,media_type,image_url,audio_url,video_url,explanation_ru,created_at')
      .order('created_at', {ascending:false})
      .limit(2000);

    if(error) throw error;
    _aqData = data || [];
    aqRender();
  }catch(e){
    if(wrap) wrap.innerHTML = `<div style="color:var(--red);padding:16px;font-size:13px">❌ Ошибка: ${e.message}</div>`;
  }
}

function aqGetFiltered(searchStr){
  let rows = _aqData;
  const s = _aqFilter;

  const textCount = {};
  _aqData.forEach(q=>{ const t=(q.question_ru||q.question_text||'').trim().toLowerCase(); textCount[t]=(textCount[t]||0)+1; });

  rows = rows.filter(q=>{
    const mtype = q.media_type||'none';
    const murl  = q.image_url||q.audio_url||q.video_url||'';
    const qtext = (q.question_ru||q.question_text||'').trim().toLowerCase();
    const hasPlaceholder = hasPlaceholderText(qtext) || hasPlaceholderText(q.explanation_ru||'');
    const hasMissedMedia = mtype!=='none' && !murl;
    const isDupe = (textCount[qtext]||0) > 1;
    const answers = (() => {
      let a = q.answers_ru||q.answers_json;
      if(typeof a==='string'){ try{ a=JSON.parse(a); }catch(e){ a=[]; } }
      return Array.isArray(a) ? a.filter(Boolean) : [];
    })();
    const isProblem = !qtext || answers.length < 2 || q.correct_index===null || q.correct_index===undefined
      || q.correct_index < 0 || q.correct_index >= answers.length || hasMissedMedia || hasPlaceholder;

    if(s==='published')  return q.status==='published';
    if(s==='official')   return q.source_type==='official_general';
    if(s==='pack')       return q.source_type==='official_pack' || (q.import_key||'').includes('game_');
    if(s==='community')  return q.source_type==='community';
    if(s==='draft')      return q.status==='draft';
    if(s==='tester')     return q.status==='tester';
    if(s==='approved')   return q.status==='approved';
    if(s==='fix')        return q.status==='fix';
    if(s==='rejected')   return q.status==='rejected';
    if(s==='archived')   return q.status==='archived';
    if(s==='deleted')    return q.status==='deleted';
    if(s==='problems')   return isProblem;
    if(s==='no_media')   return mtype==='none';
    if(s==='ph_media')   return hasMissedMedia || hasPlaceholder;
    if(s==='dupes')      return isDupe;
    return true;
  });

  if(_aqCatFilter){
    rows = rows.filter(q=>(q.category||'').toUpperCase()===_aqCatFilter.toUpperCase());
  }
  if(_aqPackFilter){
    const lc = _aqPackFilter.toLowerCase();
    rows = rows.filter(q=>(q.import_key||'').toLowerCase().includes(lc));
  }
  if(searchStr && searchStr.length > 1){
    const lc = searchStr.toLowerCase();
    rows = rows.filter(q=>(q.question_ru||q.question_text||'').toLowerCase().includes(lc));
  }
  return rows;
}

function aqSetFilter(key){
  _aqFilter = key;
  AQ_FILTERS.forEach(f=>{
    const btn = document.getElementById('aqf-'+f.key);
    if(btn){
      btn.style.background = f.key===key ? 'var(--accent)' : 'var(--bg3)';
      btn.style.color = f.key===key ? '#fff' : 'var(--muted)';
    }
  });
  aqRender();
}

function aqSetCat(val){
  _aqCatFilter = val;
  aqRender();
}

function aqSetPack(val){
  _aqPackFilter = val.trim();
  clearTimeout(_aqSearchTimeout);
  _aqSearchTimeout = setTimeout(()=>aqRender(), 300);
}

function aqSearch(val){
  clearTimeout(_aqSearchTimeout);
  _aqSearchTimeout = setTimeout(()=> aqRender(val), 250);
}

function aqRender(searchStr){
  const wrap = document.getElementById('aq-table-wrap');
  const countEl = document.getElementById('aq-count');
  if(!wrap) return;

  const search = searchStr !== undefined ? searchStr : (document.getElementById('aq-search')||{}).value||'';
  const rows = aqGetFiltered(search);
  if(countEl) countEl.textContent = rows.length + ' вопросов';

  if(!rows.length){
    wrap.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:32px">Нет вопросов</div>';
    return;
  }

  const statusColor = {published:'var(--green)',approved:'var(--green)',draft:'var(--gold)',tester:'var(--accent2)',
    fix:'#f0a050',rejected:'var(--red)',deleted:'var(--red)',archived:'var(--muted)'};

  wrap.innerHTML = rows.slice(0, 500).map((q,i)=>{
    const st = q.status||'?';
    const stColor = statusColor[st]||'var(--muted)';
    const qtext = q.question_ru||q.question_text||'—';
    const mtype = q.media_type||'none';
    const murl  = q.image_url||q.audio_url||q.video_url||'';
    const mediaIcon = mtype==='none'?'—': murl?'✅':'⚠️ нет файла';
    const shortId = String(q.id||'').slice(0,8);
    const date = q.created_at ? q.created_at.slice(0,10) : '—';

    let answers = q.answers_ru||q.answers_json||[];
    if(typeof answers==='string'){ try{ answers=JSON.parse(answers); }catch(e){ answers=[]; } }
    if(!Array.isArray(answers)) answers=[];
    answers = answers.filter(Boolean);
    const ci = q.correct_index;
    const correctAns = (answers[ci]||'?').slice(0,30);

    return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:800;color:var(--text);line-height:1.4;margin-bottom:4px">${qtext.slice(0,120)}${qtext.length>120?'…':''}</div>
          <div style="font-size:10px;color:var(--muted)">
            <span style="color:${stColor};font-weight:700">${st}</span>
            · ${q.source_type||'?'} · ${q.category||'—'} · ${date}
            ${q.import_key?'· <span style="color:var(--accent2)">'+q.import_key.slice(0,20)+'</span>':''}
          </div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">
            Медиа: <b style="color:${murl?'var(--green)':mtype!=='none'?'var(--red)':'var(--muted)'}">${mediaIcon}</b>
            · Ответов: <b>${answers.length}</b>
            · Правильный: <b style="color:var(--accent2)">${correctAns}</b>
          </div>
        </div>
        <div style="font-size:10px;color:var(--muted);flex-shrink:0">#${shortId}</div>
      </div>
      <div style="display:flex;gap:5px;flex-wrap:wrap">
        <button onclick="aqPreviewQuestion('${q.id}')" style="${aqBtnStyle('var(--text)')}">▶ Проверить</button>
        <button onclick="aqOpenQuestion('${q.id}')" style="${aqBtnStyle('var(--accent2)')}">🔍 Открыть</button>
        <button onclick="aqEditQuestion('${q.id}')" style="${aqBtnStyle('var(--accent)')}">✏️ Редактировать</button>
        <button onclick="aqAction('approved','${q.id}')" style="${aqBtnStyle('var(--green)')}">✅ Одобрить</button>
        <button onclick="aqAction('fix','${q.id}')" style="${aqBtnStyle('var(--gold)')}">🔧 На правку</button>
        <button onclick="aqAction('rejected','${q.id}')" style="${aqBtnStyle('#f0a050')}">🚫 Отклонить</button>
        <button onclick="aqAction('archived','${q.id}')" style="${aqBtnStyle('var(--muted)')}">🙈 Скрыть</button>
        <button onclick="aqAction('deleted','${q.id}')" style="${aqBtnStyle('var(--red)')}">🗑 Удалить</button>
      </div>
    </div>`;
  }).join('') + (rows.length > 500 ? `<div style="color:var(--muted);font-size:12px;text-align:center;padding:12px">Показано 500 из ${rows.length}. Используй поиск для фильтрации.</div>` : '');
}

function aqBtnStyle(color){
  return `background:transparent;border:0.5px solid ${color};border-radius:8px;padding:4px 8px;font-size:11px;font-weight:700;color:${color};cursor:pointer;font-family:inherit`;
}

async function aqAction(newStatus, qId){
  if(!isAdmin()){ toast('Нет прав'); return; }
  const label = {approved:'одобрен',fix:'на правку',archived:'скрыт',deleted:'удалён'}[newStatus]||newStatus;
  if(newStatus==='deleted' && !confirm('Мягко удалить вопрос? (статус → deleted)')) return;

  try{
    const {error} = await sb.from('questions').update({status: newStatus}).eq('id', qId);
    if(error) throw error;
    toast(`✅ Вопрос ${label}`);
    // Update local cache
    const idx = _aqData.findIndex(q=>String(q.id)===String(qId));
    if(idx>=0) _aqData[idx].status = newStatus;
    aqRender();
  }catch(e){
    toast('❌ Ошибка: '+e.message.slice(0,60));
  }
}

// ══════════════════════════════════════════════════════════════
// TASK 1: IMPORTS PANEL
// ══════════════════════════════════════════════════════════════
async function openImportQuestions(batchKey){
  await showAllQuestionsAdmin();
  // Wait for data to load before applying pack filter
  setTimeout(()=>aqSetPack(batchKey), 400);
}

async function showAdminImports(){
  if(!isAdmin()){ toast('Нет прав'); return; }
  const existing = document.getElementById('admin-imports-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-imports-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:5000;display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:0.5px solid var(--border);background:var(--bg2);flex-shrink:0">
      <button onclick="document.getElementById('admin-imports-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1">←</button>
      <div style="font-size:14px;font-weight:800;color:var(--text);flex:1">📋 Импорты вопросов</div>
      <button onclick="loadAdminImportsList()" style="background:var(--accent);border:none;border-radius:8px;padding:5px 12px;font-size:11px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">↺ Обновить</button>
    </div>
    <div id="admin-imports-list" style="flex:1;overflow-y:auto;padding:12px 16px 80px">
      <div style="color:var(--muted);text-align:center;padding:24px">⏳ Загрузка...</div>
    </div>`;
  document.body.appendChild(overlay);
  await loadAdminImportsList();
}

async function loadAdminImportsList(){
  const el = document.getElementById('admin-imports-list');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);text-align:center;padding:24px">⏳ Загрузка...</div>';

  try{
    // Group questions by batch key (strip _qN suffix)
    const {data, error} = await sb.from('questions')
      .select('id,import_key,status,category,source_type,created_at')
      .not('import_key','is',null)
      .order('created_at', {ascending:false})
      .limit(3000);
    if(error) throw error;

    // Group by batch key
    const batches = {};
    for(const q of (data||[])){
      const bk = (q.import_key||'').replace(/_q\d+$/, '');
      if(!bk) continue;
      if(!batches[bk]) batches[bk] = {key:bk, count:0, statuses:{}, cats:new Set(), latest:q.created_at};
      batches[bk].count++;
      batches[bk].statuses[q.status||'?'] = (batches[bk].statuses[q.status||'?']||0)+1;
      if(q.category) batches[bk].cats.add(q.category);
      if(q.created_at > batches[bk].latest) batches[bk].latest = q.created_at;
    }

    const list = Object.values(batches).sort((a,b)=>b.latest.localeCompare(a.latest));
    if(!list.length){ el.innerHTML='<div style="color:var(--muted);text-align:center;padding:32px">Нет импортов</div>'; return; }

    const statusColor = {published:'var(--green)',tester:'var(--accent2)',draft:'var(--gold)',fix:'#f0a050',rejected:'var(--red)',archived:'var(--muted)'};

    el.innerHTML = list.map(b=>{
      const statusBadges = Object.entries(b.statuses).map(([s,n])=>
        `<span style="font-size:10px;padding:2px 6px;border-radius:10px;background:var(--bg3);color:${statusColor[s]||'var(--muted)'};font-weight:700">${s}: ${n}</span>`
      ).join(' ');
      const date = b.latest ? b.latest.slice(0,10) : '—';
      return `<div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px">
          <div>
            <div style="font-size:12px;font-weight:800;color:var(--text);margin-bottom:2px">${b.key}</div>
            <div style="font-size:10px;color:var(--muted)">${b.count} вопросов · ${date} · ${[...b.cats].slice(0,3).join(', ')}</div>
            <div style="margin-top:4px;display:flex;gap:4px;flex-wrap:wrap">${statusBadges}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-wrap:wrap">
          <button onclick="startTesterMode('import','${b.key}')" style="background:rgba(240,192,64,.1);border:0.5px solid var(--gold);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--gold);cursor:pointer;font-family:inherit">🧪 В тестер</button>
          <button onclick="openImportQuestions('${b.key}')" style="background:rgba(108,99,255,.1);border:0.5px solid var(--accent);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">👁 Открыть</button>
          <button onclick="adminPublishImport('${b.key}')" style="background:rgba(74,222,128,.1);border:0.5px solid var(--green);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;font-family:inherit">🚀 Опубликовать</button>
          <button onclick="adminImportSetStatus('${b.key}','fix')" style="background:rgba(240,192,64,.08);border:0.5px solid var(--gold);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--gold);cursor:pointer;font-family:inherit">🟡 На правку</button>
          <button onclick="adminImportSetStatus('${b.key}','archived')" style="background:rgba(128,128,128,.1);border:0.5px solid var(--muted);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">🗑 Скрыть</button>
        </div>
      </div>`;
    }).join('');
  }catch(e){
    el.innerHTML = `<div style="color:var(--red);padding:16px">❌ ${e.message}</div>`;
  }
}

async function adminPublishImport(batchKey){
  if(!isAdmin()){ toast('Нет прав'); return; }
  if(!confirm(`Опубликовать все вопросы импорта "${batchKey}"?\n(статусы draft/tester/approved → published)`)) return;

  toast('⏳ Публикуем...');

  // 1. Publish questions
  const {error: qErr} = await sb.from('questions')
    .update({status:'published'})
    .like('import_key', batchKey + '_%')
    .in('status', ['draft','tester','approved']);
  if(qErr){ toast('❌ Ошибка публикации вопросов: '+qErr.message); return; }

  // 2. Publish linked game_pack
  //    Primary: exact import_key match (v87-14+ packs where import_key === batchKey)
  let packUpdated = false;
  const {data: exactMatch, error: packErr1} = await sb.from('game_packs')
    .update({status:'published'})
    .eq('import_key', batchKey)
    .in('status', ['draft','tester','approved'])
    .select('id');
  if(!packErr1 && exactMatch && exactMatch.length) packUpdated = true;

  //    Fallback: find pack via game_pack_questions join (legacy packs with different import_key)
  if(!packUpdated){
    const {data: sampleQ} = await sb.from('questions')
      .select('id').like('import_key', batchKey+'_%').limit(1);
    if(sampleQ && sampleQ.length){
      const {data: gpqRow} = await sb.from('game_pack_questions')
        .select('game_pack_id').eq('question_id', sampleQ[0].id).limit(1);
      if(gpqRow && gpqRow.length){
        const {error: packErr2} = await sb.from('game_packs')
          .update({status:'published'})
          .eq('id', gpqRow[0].game_pack_id)
          .in('status', ['draft','tester','approved']);
        if(!packErr2) packUpdated = true;
        else console.warn('[MFC] adminPublishImport fallback pack update failed:', packErr2.message);
      }
    }
  }

  // 3. Count published questions
  const {count} = await sb.from('questions').select('*',{count:'exact',head:true})
    .like('import_key', batchKey+'_%').eq('status','published');

  const packMsg = packUpdated ? ' · пак опубликован' : ' · ⚠️ пак не найден в game_packs';
  toast(`✅ Опубликовано ${count||'?'} вопросов${packMsg}`);

  // 4. Refresh UI
  await loadAdminImportsList();
  // Refresh shop grid if visible
  const shopEl = document.getElementById('shop');
  if(shopEl && shopEl.classList.contains('active')) renderDBGamePacks();
}

async function adminImportSetStatus(batchKey, newStatus){
  if(!isAdmin()) return;
  const label = {fix:'На правку',archived:'Скрыть/архив'}[newStatus]||newStatus;
  if(!confirm(`Пометить все вопросы импорта "${batchKey}" как "${label}"?`)) return;
  const {error} = await sb.from('questions')
    .update({status: newStatus})
    .like('import_key', batchKey+'_%');
  if(error){ toast('❌ '+error.message); return; }
  toast(`✅ Статус → ${newStatus}`);
  await loadAdminImportsList();
}

// ══════════════════════════════════════════════════════════════
// TASK 4: ADMIN USERS PANEL
// ══════════════════════════════════════════════════════════════
async function showAdminUsersPanel(){
  if(!isAdmin()){ toast('Нет прав'); return; }
  const existing = document.getElementById('admin-users-overlay');
  if(existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'admin-users-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:var(--bg);z-index:5000;display:flex;flex-direction:column;overflow:hidden';
  overlay.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:12px 16px;border-bottom:0.5px solid var(--border);background:var(--bg2);flex-shrink:0">
      <button onclick="document.getElementById('admin-users-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;padding:0 4px;line-height:1">←</button>
      <div style="font-size:14px;font-weight:800;color:var(--text);flex:1">👤 Управление админами</div>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px">
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:14px;margin-bottom:12px">
        <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:10px">ДОБАВИТЬ АДМИНА</div>
        <input id="au-email" placeholder="email@example.com" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:8px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:8px">
        <div style="display:flex;gap:8px;margin-bottom:8px">
          <select id="au-role" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:8px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
            <option value="moderator">moderator — просмотр, тестер</option>
            <option value="admin">admin — полный доступ</option>
            ${currentUserRole==='owner'?'<option value="owner">owner — владелец</option>':''}
          </select>
        </div>
        <button onclick="adminAddUser()" style="width:100%;background:var(--accent);border:none;border-radius:8px;padding:10px;font-size:13px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">+ Добавить</button>
      </div>

      <div style="font-size:12px;font-weight:800;color:var(--muted);margin-bottom:8px">ТЕКУЩИЕ АДМИНЫ</div>
      <div id="au-list"><div style="color:var(--muted);text-align:center;padding:16px">⏳ Загрузка...</div></div>

      <div style="margin-top:16px;background:var(--bg2);border:0.5px solid var(--border);border-radius:12px;padding:12px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:6px">SQL ДЛЯ СОЗДАНИЯ ТАБЛИЦЫ</div>
        <pre style="font-size:10px;color:var(--accent2);line-height:1.5;overflow-x:auto;white-space:pre-wrap">create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  role text not null default 'admin',
  created_at timestamptz default now(),
  created_by uuid null,
  is_active boolean default true
);

-- Включить RLS
alter table public.admin_users enable row level security;

-- Читать могут только залогиненные (нужно для проверки роли)
create policy "admin_users_select" on public.admin_users
  for select using (auth.uid() is not null);

-- Писать могут только owner/admin (проверяем через свою же таблицу)
create policy "admin_users_insert" on public.admin_users
  for insert with check (
    exists (
      select 1 from public.admin_users
      where email = auth.email()
        and role in ('owner','admin')
        and is_active = true
    )
    or auth.email() = any(array['pantandrej@yandex.ru'])
  );

create policy "admin_users_update" on public.admin_users
  for update using (
    exists (
      select 1 from public.admin_users
      where email = auth.email()
        and role in ('owner','admin')
        and is_active = true
    )
    or auth.email() = any(array['pantandrej@yandex.ru'])
  );</pre>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  await loadAdminUsersList();
}

async function loadAdminUsersList(){
  const el = document.getElementById('au-list');
  if(!el) return;
  try{
    const {data, error} = await sb.from('admin_users').select('*').order('created_at');
    if(error) throw error;

    // Also show hardcoded
    const hardcoded = ADMIN_EMAILS.map(e=>({email:e, role:'owner (hardcoded)', is_active:true, id:'hardcoded_'+e}));
    const all = [...hardcoded, ...(data||[])];

    const roleColor = {owner:'var(--gold)','owner (hardcoded)':'var(--gold)',admin:'var(--green)',moderator:'var(--accent2)'};
    el.innerHTML = all.map(u=>`
      <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--bg2);border:0.5px solid var(--border);border-radius:10px;margin-bottom:6px">
        <div>
          <div style="font-size:12px;font-weight:700;color:var(--text)">${u.email}</div>
          <div style="font-size:10px;color:${roleColor[u.role]||'var(--muted)'}">
            ${u.role} · ${u.is_active?'<span style="color:var(--green)">активен</span>':'<span style="color:var(--red)">деактивирован</span>'}
          </div>
        </div>
        ${!u.id.startsWith('hardcoded_') ? `
        <div style="display:flex;gap:4px">
          ${u.is_active
            ? `<button onclick="adminDeactivateUser('${u.id}')" style="background:rgba(224,85,85,.1);border:0.5px solid var(--red);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;color:var(--red);cursor:pointer;font-family:inherit">Деактивировать</button>`
            : `<button onclick="adminActivateUser('${u.id}')" style="background:rgba(74,222,128,.1);border:0.5px solid var(--green);border-radius:6px;padding:4px 8px;font-size:11px;font-weight:700;color:var(--green);cursor:pointer;font-family:inherit">Активировать</button>`
          }
        </div>` : '<span style="font-size:10px;color:var(--muted)">нельзя изменить</span>'}
      </div>`).join('');
  }catch(e){
    el.innerHTML = `<div style="color:var(--red);font-size:12px;padding:8px">❌ Таблица admin_users не найдена.<br>Создай её через SQL выше.</div>`;
  }
}

async function adminAddUser(){
  if(!isAdmin()) return;
  const email = (document.getElementById('au-email')?.value||'').trim().toLowerCase();
  const role  = document.getElementById('au-role')?.value||'moderator';
  if(!email || !email.includes('@')){ toast('Введите корректный email'); return; }
  if(role==='owner' && currentUserRole!=='owner'){ toast('Только owner может добавлять owner'); return; }
  const {error} = await sb.from('admin_users').upsert({
    email, role, is_active:true, created_by: currentUser?.id, created_at: new Date().toISOString()
  },{onConflict:'email'});
  if(error){ toast('❌ '+error.message); return; }
  toast(`✅ Добавлен: ${email} (${role})`);
  document.getElementById('au-email').value = '';
  await loadAdminUsersList();
}

async function adminDeactivateUser(id){
  const {error} = await sb.from('admin_users').update({is_active:false}).eq('id',id);
  if(error){ toast('❌ '+error.message); return; }
  toast('✅ Деактивирован');
  await loadAdminUsersList();
}

async function adminActivateUser(id){
  const {error} = await sb.from('admin_users').update({is_active:true}).eq('id',id);
  if(error){ toast('❌ '+error.message); return; }
  toast('✅ Активирован');
  await loadAdminUsersList();
}


function aqPreviewQuestion(qId){
  const raw = _aqData.find(r=>String(r.id)===String(qId));
  if(!raw){ toast('Вопрос не найден'); return; }
  let answers = raw.answers_ru||raw.answers_json||[];
  if(typeof answers==='string'){ try{ answers=JSON.parse(answers); }catch(e){ answers=[]; } }
  if(!Array.isArray(answers)) answers=[];
  answers = answers.filter(Boolean);
  const ci = raw.correct_index ?? 0;
  const qtext = raw.question_ru||raw.question_text||'—';
  const expl  = raw.explanation_ru||'';
  const mtype = raw.media_type||'none';
  const murl  = raw.image_url||raw.audio_url||raw.video_url||'';
  const existing = document.getElementById('aq-preview-overlay');
  if(existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = 'aq-preview-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:7000;display:flex;align-items:center;justify-content:center;padding:16px';
  let mediaHtml = '';
  if(mtype !== 'none' && murl){
    if(mtype==='image') mediaHtml = `<img src="${murl}" style="width:100%;max-height:200px;object-fit:contain;border-radius:10px;margin-bottom:12px;background:#0a0a0f">`;
    else if(mtype==='audio') mediaHtml = `<audio controls style="width:100%;margin-bottom:12px"><source src="${murl}"></audio>`;
    else if(mtype==='video') mediaHtml = `<video controls style="width:100%;max-height:160px;border-radius:10px;margin-bottom:12px"><source src="${murl}"></video>`;
  } else if(mtype !== 'none' && !murl){
    mediaHtml = `<div style="background:rgba(224,85,85,.1);border:0.5px solid var(--red);border-radius:8px;padding:8px;font-size:11px;color:var(--red);margin-bottom:10px">⚠️ Медиа заявлено (${mtype}), URL не загружен</div>`;
  }
  const answersHtml = answers.map((a,i)=>`
    <button id="aqprev-ans-${i}" onclick="aqPreviewPick(${i},${ci})"
      style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px 12px;font-size:13px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;text-align:left;margin-bottom:6px;display:flex;gap:8px;align-items:center">
      <span style="font-size:11px;font-weight:800;color:var(--muted);flex-shrink:0">${answerLetter(i)}</span>
      <span>${a}</span>
    </button>`).join('');
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;width:100%;max-width:520px;max-height:92vh;overflow-y:auto;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:11px;font-weight:800;color:var(--muted)">${raw.category||'GENERAL'} · ${raw.status||'?'}</span>
        <button onclick="document.getElementById('aq-preview-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>
      ${mediaHtml}
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:14px;line-height:1.5">${qtext}</div>
      <div id="aqprev-answers">${answersHtml}</div>
      <div id="aqprev-expl" style="display:none;background:var(--bg3);border-radius:10px;padding:10px;margin-top:8px;font-size:12px;color:var(--muted);line-height:1.5">${expl}</div>
      <div id="aqprev-actions" style="display:none;margin-top:14px">
        <div style="font-size:11px;font-weight:800;color:var(--muted);margin-bottom:8px">Решение по вопросу:</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button onclick="aqAction('approved','${raw.id}');document.getElementById('aq-preview-overlay').remove()" style="${aqBtnStyle('var(--green)')}">✅ Оставить</button>
          <button onclick="aqEditQuestion('${raw.id}');document.getElementById('aq-preview-overlay').remove()" style="${aqBtnStyle('var(--accent)')}">✏️ Исправить</button>
          <button onclick="aqAction('fix','${raw.id}');document.getElementById('aq-preview-overlay').remove()" style="${aqBtnStyle('var(--gold)')}">🟡 На правку</button>
          <button onclick="aqAction('archived','${raw.id}');document.getElementById('aq-preview-overlay').remove()" style="${aqBtnStyle('var(--muted)')}">🙈 Скрыть</button>
          <button onclick="aqAction('deleted','${raw.id}');document.getElementById('aq-preview-overlay').remove()" style="${aqBtnStyle('var(--red)')}">🗑 Удалить</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function aqPreviewPick(picked, correct){
  document.querySelectorAll('[id^="aqprev-ans-"]').forEach((btn,i)=>{
    btn.style.background = i===correct ? 'rgba(74,222,128,.15)' : (i===picked&&i!==correct ? 'rgba(224,85,85,.15)' : 'var(--bg3)');
    btn.style.borderColor = i===correct ? 'var(--green)' : (i===picked&&i!==correct ? 'var(--red)' : 'var(--border)');
    btn.style.color = i===correct ? 'var(--green)' : (i===picked&&i!==correct ? 'var(--red)' : 'var(--muted)');
    btn.disabled = true;
  });
  const explEl = document.getElementById('aqprev-expl');
  if(explEl && explEl.textContent.trim()) explEl.style.display = 'block';
  const actEl = document.getElementById('aqprev-actions');
  if(actEl) actEl.style.display = 'block';
}

// ══════════════════════════════════════════════════════════════
// v87: AQ — BULK REVIEW MODE
// ══════════════════════════════════════════════════════════════
let _brRows = [];
let _brIdx  = 0;
const _BR_STORAGE_KEY = 'mfc_bulk_review_progress';

function aqStartBulkReview(){
  const search = (document.getElementById('aq-search')||{}).value||'';
  _brRows = aqGetFiltered(search);
  if(!_brRows.length){ toast('Нет вопросов для ревизии'); return; }
  const saved = JSON.parse(localStorage.getItem(_BR_STORAGE_KEY)||'{}');
  const currentFilter = _aqFilter+'|'+_aqCatFilter+'|'+_aqPackFilter;
  _brIdx = (saved.filter===currentFilter && saved.idx < _brRows.length) ? saved.idx : 0;
  aqRenderBulkReview();
}

function aqRenderBulkReview(){
  const existing = document.getElementById('aq-bulk-overlay');
  if(existing) existing.remove();
  if(_brIdx >= _brRows.length){
    toast('✅ Ревизия завершена!', 3000);
    localStorage.removeItem(_BR_STORAGE_KEY);
    return;
  }
  const q = _brRows[_brIdx];
  let answers = q.answers_ru||q.answers_json||[];
  if(typeof answers==='string'){ try{ answers=JSON.parse(answers); }catch(e){ answers=[]; } }
  if(!Array.isArray(answers)) answers=[];
  answers = answers.filter(Boolean);
  const ci = q.correct_index ?? 0;
  const qtext = q.question_ru||q.question_text||'—';
  const mtype = q.media_type||'none';
  const murl  = q.image_url||q.audio_url||q.video_url||'';
  const pct = Math.round(_brIdx/_brRows.length*100);
  const currentFilter = _aqFilter+'|'+_aqCatFilter+'|'+_aqPackFilter;
  localStorage.setItem(_BR_STORAGE_KEY, JSON.stringify({filter:currentFilter, idx:_brIdx}));
  let mediaHtml = '';
  if(mtype!=='none' && murl){
    if(mtype==='image') mediaHtml = `<img src="${murl}" style="width:100%;max-height:160px;object-fit:contain;border-radius:8px;margin-bottom:10px;background:#0a0a0f">`;
    else if(mtype==='audio') mediaHtml = `<audio controls style="width:100%;margin-bottom:10px"><source src="${murl}"></audio>`;
    else if(mtype==='video') mediaHtml = `<video controls style="width:100%;max-height:140px;border-radius:8px;margin-bottom:10px"><source src="${murl}"></video>`;
  } else if(mtype!=='none'){ mediaHtml = `<div style="font-size:11px;color:var(--red);margin-bottom:8px">⚠️ Медиа заявлено, URL не загружен</div>`; }
  const answersHtml = answers.map((a,i)=>`
    <div style="display:flex;gap:8px;align-items:center;padding:6px 8px;border-radius:8px;background:${i===ci?'rgba(74,222,128,.1)':'var(--bg3)'};border:0.5px solid ${i===ci?'var(--green)':'var(--border)'};margin-bottom:4px">
      <span style="font-size:11px;font-weight:800;color:${i===ci?'var(--green)':'var(--muted)'};flex-shrink:0">${answerLetter(i)}${i===ci?' ✓':''}</span>
      <span style="font-size:12px;color:${i===ci?'var(--green)':'var(--text)'}">${a}</span>
    </div>`).join('');
  const overlay = document.createElement('div');
  overlay.id = 'aq-bulk-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:7000;display:flex;flex-direction:column';
  overlay.innerHTML = `
    <div style="background:var(--bg2);border-bottom:0.5px solid var(--border);padding:10px 16px;display:flex;align-items:center;gap:10px;flex-shrink:0">
      <button onclick="document.getElementById('aq-bulk-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1;padding:0 4px">×</button>
      <div style="flex:1">
        <div style="font-size:12px;font-weight:800;color:var(--text)">Ревизия: ${_brIdx+1} / ${_brRows.length}</div>
        <div style="height:4px;background:var(--bg3);border-radius:2px;margin-top:4px">
          <div style="height:100%;width:${pct}%;background:var(--accent);border-radius:2px"></div>
        </div>
      </div>
      <span style="font-size:11px;color:var(--muted)">${pct}%</span>
    </div>
    <div style="flex:1;overflow-y:auto;padding:16px;max-width:560px;width:100%;margin:0 auto">
      <div style="font-size:10px;color:var(--muted);margin-bottom:8px">${q.status||'?'} · ${q.category||'—'} ${q.import_key?'· '+q.import_key.slice(0,20):''}</div>
      ${mediaHtml}
      <div style="font-size:15px;font-weight:700;color:var(--text);margin-bottom:12px;line-height:1.5">${qtext}</div>
      <div>${answersHtml}</div>
      ${q.explanation_ru?`<div style="background:var(--bg3);border-radius:8px;padding:10px;font-size:12px;color:var(--muted);margin-top:8px">💡 ${q.explanation_ru}</div>`:''}
    </div>
    <div style="background:var(--bg2);border-top:0.5px solid var(--border);padding:12px 16px;flex-shrink:0">
      <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;max-width:560px;margin:0 auto">
        <button onclick="aqBulkAction('approved','${q.id}')" style="${aqBtnStyle('var(--green)')}">✅ Одобрить</button>
        <button onclick="aqBulkAction('fix','${q.id}')" style="${aqBtnStyle('var(--gold)')}">🟡 На правку</button>
        <button onclick="aqBulkAction('rejected','${q.id}')" style="${aqBtnStyle('#f0a050')}">🚫 Отклонить</button>
        <button onclick="aqBulkAction('archived','${q.id}')" style="${aqBtnStyle('var(--muted)')}">🙈 Скрыть</button>
        <button onclick="aqBulkAction('deleted','${q.id}')" style="${aqBtnStyle('var(--red)')}">🗑 Удалить</button>
        <button onclick="aqBulkSkip()" style="${aqBtnStyle('var(--accent2)')}">→ Пропустить</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function aqBulkAction(newStatus, qId){
  await aqAction(newStatus, qId);
  _brIdx++;
  aqRenderBulkReview();
}

function aqBulkSkip(){
  _brIdx++;
  aqRenderBulkReview();
}

// ══════════════════════════════════════════════════════════════
// v87: AQ — OPEN & EDIT QUESTION MODALS
// ══════════════════════════════════════════════════════════════
function aqOpenQuestion(qId){
  const q = _aqData.find(r=>String(r.id)===String(qId));
  if(!q){ toast('Вопрос не найден'); return; }

  const existing = document.getElementById('aq-open-overlay');
  if(existing) existing.remove();

  let answers = q.answers_ru||q.answers_json||[];
  if(typeof answers==='string'){ try{ answers=JSON.parse(answers); }catch(e){ answers=[]; } }
  if(!Array.isArray(answers)) answers=[];
  answers = answers.filter(Boolean);

  const ci = q.correct_index;
  const mtype = q.media_type||'none';
  const murl  = q.image_url||q.audio_url||q.video_url||'';
  const statusColor = {published:'var(--green)',approved:'var(--green)',draft:'var(--gold)',
    tester:'var(--accent2)',fix:'#f0a050',rejected:'var(--red)',deleted:'var(--red)',archived:'var(--muted)'};

  const answersHtml = answers.map((a,i)=>`
    <div style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:0.5px solid var(--border)">
      <span style="font-size:11px;font-weight:800;color:${i===ci?'var(--green)':'var(--muted)'};flex-shrink:0;margin-top:2px">${'ABCDEF'[i]}${i===ci?' ✓':''}</span>
      <span style="font-size:12px;color:${i===ci?'var(--green)':'var(--text)'}">${a}</span>
    </div>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'aq-open-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;width:100%;max-width:560px;max-height:90vh;overflow-y:auto;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:800;color:var(--text)">🔍 Вопрос</div>
        <button onclick="document.getElementById('aq-open-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>

      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
        <span style="font-size:10px;padding:3px 8px;border-radius:20px;background:var(--bg3);color:var(--muted)">${q.source_type||'?'}</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:20px;background:var(--bg3);color:${statusColor[q.status||'']||'var(--muted)'};font-weight:700">${q.status||'?'}</span>
        <span style="font-size:10px;padding:3px 8px;border-radius:20px;background:var(--bg3);color:var(--accent2)">${q.category||'—'}</span>
        ${q.import_key?`<span style="font-size:10px;padding:3px 8px;border-radius:20px;background:var(--bg3);color:var(--muted)">${q.import_key}</span>`:''}
      </div>

      <div style="font-size:14px;font-weight:700;color:var(--text);margin-bottom:12px;line-height:1.5">${q.question_ru||q.question_text||'—'}</div>

      <div style="margin-bottom:12px">${answersHtml}</div>

      ${q.explanation_ru?`<div style="background:var(--bg3);border-radius:10px;padding:10px;margin-bottom:10px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">💡 ОБЪЯСНЕНИЕ</div>
        <div style="font-size:12px;color:var(--muted);line-height:1.5">${q.explanation_ru}</div>
      </div>`:''}

      <div style="background:var(--bg3);border-radius:10px;padding:10px;margin-bottom:14px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:6px">🎬 МЕДИА</div>
        <div style="font-size:12px;color:var(--muted)">
          Тип: <b style="color:${mtype!=='none'?'var(--accent2)':'var(--muted)'}">${mtype}</b>
          ${murl?`<br>URL: <span style="color:var(--text);font-size:11px;word-break:break-all">${murl}</span>`:''}
          ${!murl&&mtype!=='none'?'<br><span style="color:var(--red)">⚠️ URL не задан</span>':''}
        </div>
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="aqEditQuestion('${q.id}');document.getElementById('aq-open-overlay').remove()" style="flex:1;background:var(--accent);border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">✏️ Редактировать</button>
        <button onclick="document.getElementById('aq-open-overlay').remove()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

function aqEditQuestion(qId){
  const q = _aqData.find(r=>String(r.id)===String(qId));
  if(!q){ toast('Вопрос не найден'); return; }

  const existing = document.getElementById('aq-edit-overlay');
  if(existing) existing.remove();

  let answers = q.answers_ru||q.answers_json||[];
  if(typeof answers==='string'){ try{ answers=JSON.parse(answers); }catch(e){ answers=[]; } }
  if(!Array.isArray(answers)) answers=[];
  answers = answers.filter(Boolean);
  // Pad to 4 for editing
  while(answers.length < 2) answers.push('');

  const mtype = q.media_type||'none';
  const murl  = q.image_url||q.audio_url||q.video_url||'';

  const ansInputs = answers.map((a,i)=>`
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
      <span style="font-size:11px;font-weight:800;color:var(--muted);width:14px;flex-shrink:0">${'ABCDEF'[i]}</span>
      <input id="aqe-ans-${i}" value="${(a||'').replace(/"/g,'&quot;')}" 
        style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
    </div>`).join('');

  const statusOptions = ['published','approved','draft','tester','fix','archived','deleted','rejected']
    .map(s=>`<option value="${s}"${q.status===s?' selected':''}>${s}</option>`).join('');

  const mediaOptions = ['none','image','audio','video']
    .map(t=>`<option value="${t}"${mtype===t?' selected':''}>${t}</option>`).join('');

  const overlay = document.createElement('div');
  overlay.id = 'aq-edit-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.8);z-index:6000;display:flex;align-items:center;justify-content:center;padding:16px';
  overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:16px;width:100%;max-width:560px;max-height:92vh;overflow-y:auto;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div style="font-size:13px;font-weight:800;color:var(--text)">✏️ Редактировать вопрос</div>
        <button onclick="document.getElementById('aq-edit-overlay').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;cursor:pointer;line-height:1">×</button>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">ВОПРОС</div>
        <textarea id="aqe-q" style="width:100%;min-height:70px;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;color:var(--text);font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">${q.question_ru||q.question_text||''}</textarea>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">ВАРИАНТЫ ОТВЕТА</div>
        ${ansInputs}
        <div style="display:flex;align-items:center;gap:8px;margin-top:4px">
          <span style="font-size:11px;color:var(--muted)">Правильный ответ:</span>
          <select id="aqe-ci" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
            ${answers.map((_,i)=>`<option value="${i}"${q.correct_index===i?' selected':''}>${'ABCDEF'[i]}</option>`).join('')}
          </select>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">КАТЕГОРИЯ</div>
          <input id="aqe-cat" value="${q.category||''}" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
        </div>
        <div>
          <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">СТАТУС</div>
          <select id="aqe-status" style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
            ${statusOptions}
          </select>
        </div>
      </div>

      <div style="margin-bottom:10px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">ОБЪЯСНЕНИЕ</div>
        <textarea id="aqe-expl" style="width:100%;min-height:50px;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:12px;color:var(--text);font-family:inherit;resize:vertical;outline:none;box-sizing:border-box">${q.explanation_ru||''}</textarea>
      </div>

      <div style="margin-bottom:14px">
        <div style="font-size:10px;font-weight:800;color:var(--muted);margin-bottom:4px">МЕДИА</div>
        <div style="display:flex;gap:6px;margin-bottom:6px;align-items:center">
          <span style="font-size:11px;color:var(--muted)">Тип:</span>
          <select id="aqe-mtype" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:5px 8px;font-size:12px;color:var(--text);font-family:inherit;outline:none">
            ${mediaOptions}
          </select>
        </div>
        <input id="aqe-murl" value="${murl.replace(/"/g,'&quot;')}" placeholder="URL медиафайла (https://...)"
          style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:12px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box">
      </div>

      <div style="display:flex;gap:8px">
        <button onclick="aqSaveEdit('${qId}',${answers.length})" style="flex:1;background:var(--accent);border:none;border-radius:10px;padding:12px;font-size:13px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">💾 Сохранить</button>
        <button onclick="document.getElementById('aq-edit-overlay').remove()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
}

async function aqSaveEdit(qId, ansCount){
  if(!isAdmin()){ toast('Нет прав'); return; }
  const newQ     = (document.getElementById('aqe-q')?.value||'').trim();
  const newCat   = (document.getElementById('aqe-cat')?.value||'').trim();
  const newStatus= document.getElementById('aqe-status')?.value||'';
  const newExpl  = (document.getElementById('aqe-expl')?.value||'').trim();
  const newMtype = document.getElementById('aqe-mtype')?.value||'none';
  const newMurl  = (document.getElementById('aqe-murl')?.value||'').trim();
  const newCI    = parseInt(document.getElementById('aqe-ci')?.value||'0', 10);

  const newAnswers = [];
  for(let i=0; i<ansCount; i++){
    const v = (document.getElementById('aqe-ans-'+i)?.value||'').trim();
    if(v) newAnswers.push(v);
  }

  if(!newQ){ toast('⚠️ Текст вопроса не может быть пустым'); return; }
  if(newAnswers.length < 2){ toast('⚠️ Нужно минимум 2 варианта ответа'); return; }
  if(newCI < 0 || newCI >= newAnswers.length){ toast('⚠️ Неверный индекс правильного ответа'); return; }

  // Build Supabase update payload
  const updatePayload = {
    question_ru: newQ,
    question_text: newQ,
    answers_json: JSON.stringify(newAnswers),
    answers_ru: newAnswers,
    correct_index: newCI,
    category: newCat||'GENERAL',
    explanation_ru: newExpl,
    status: newStatus,
    media_type: newMtype === 'none' ? null : newMtype,
  };
  if(newMtype === 'image')   updatePayload.image_url = newMurl || null;
  if(newMtype === 'audio')   updatePayload.audio_url = newMurl || null;
  if(newMtype === 'video')   updatePayload.video_url = newMurl || null;

  try{
    const {error} = await sb.from('questions').update(updatePayload).eq('id', qId);
    if(error) throw error;
    toast('✅ Сохранено в Supabase');
    // Update local cache
    const idx = _aqData.findIndex(r=>String(r.id)===String(qId));
    if(idx>=0){
      Object.assign(_aqData[idx], {
        question_ru: newQ, question_text: newQ,
        answers_json: newAnswers, answers_ru: newAnswers,
        correct_index: newCI, category: newCat||'GENERAL',
        explanation_ru: newExpl, status: newStatus,
        media_type: newMtype==='none'?null:newMtype,
        image_url: newMtype==='image'?(newMurl||null):_aqData[idx].image_url,
        audio_url: newMtype==='audio'?(newMurl||null):_aqData[idx].audio_url,
        video_url: newMtype==='video'?(newMurl||null):_aqData[idx].video_url,
      });
    }
    document.getElementById('aq-edit-overlay')?.remove();
    aqRender();
  }catch(e){
    toast('❌ Ошибка сохранения: '+e.message.slice(0,60));
  }
}


async function runDBQualityCheck(){
  const el = document.getElementById('admin-health-list');
  if(!el) return;

  const addRow = (ok, label, link) => {
    const icon = ok===true?'✅':ok===null?'⚠️':'❌';
    const color = ok===true?'var(--green)':ok===null?'var(--gold)':'var(--red)';
    const linkBtn = link ? `<button onclick="${link}" style="margin-left:8px;background:none;border:0.5px solid var(--accent);border-radius:6px;padding:2px 8px;font-size:10px;color:var(--accent2);cursor:pointer;font-family:inherit">→ Открыть</button>` : '';
    el.innerHTML += `<div style="display:flex;align-items:center;gap:4px;padding:3px 0;border-bottom:0.5px solid var(--border)">
      <span style="color:${color};flex-shrink:0;font-size:12px">${icon}</span>
      <span style="font-size:11px;color:${ok?'var(--text)':'var(--red)'}">${label}${linkBtn}</span>
    </div>`;
  };

  el.innerHTML += '<div style="margin-top:8px;font-size:10px;font-weight:800;color:var(--muted);letter-spacing:1px">🔬 КАЧЕСТВО БАЗЫ (v87):</div>';

  try{
    // No question text
    const {count:noText} = await sb.from('questions').select('*',{count:'exact',head:true})
      .or('question_ru.is.null,question_ru.eq.').eq('status','published');
    addRow(noText===0, `Published без текста вопроса: ${noText||0}`,
      noText ? `showAllQuestionsAdmin('problems')` : null);

    // No answers
    const {count:noAns} = await sb.from('questions').select('*',{count:'exact',head:true})
      .or('answers_json.is.null,answers_ru.is.null').eq('status','published');
    addRow(noAns===0, `Published без вариантов: ${noAns||0}`,
      noAns ? `showAllQuestionsAdmin('problems')` : null);

    // No correct index
    const {count:noCI} = await sb.from('questions').select('*',{count:'exact',head:true})
      .is('correct_index',null).eq('status','published');
    addRow(noCI===0, `Published без correct_index: ${noCI||0}`,
      noCI ? `showAllQuestionsAdmin('problems')` : null);

    // Media type set but no URL
    const {count:mediaNoUrl} = await sb.from('questions').select('*',{count:'exact',head:true})
      .not('media_type','in','(none,null)')
      .or('image_url.is.null,audio_url.is.null,video_url.is.null')
      .eq('status','published');
    addRow(mediaNoUrl===0, `Published: media_type заявлен, но URL пуст: ${mediaNoUrl||0}`,
      mediaNoUrl ? `showAllQuestionsAdmin('ph_media')` : null);

    // Deleted/archived count (soft-deleted)
    const {count:delCount} = await sb.from('questions').select('*',{count:'exact',head:true})
      .in('status',['deleted','archived']);
    addRow(true, `Мягко удалено/архивировано: ${delCount||0}`, null);

    // Draft count
    const {count:draftCount} = await sb.from('questions').select('*',{count:'exact',head:true})
      .eq('status','draft');
    addRow(null, `Draft (не видны игрокам): ${draftCount||0}`,
      draftCount ? `showAllQuestionsAdmin('draft')` : null);

  }catch(e){
    el.innerHTML += `<div style="font-size:11px;color:var(--red)">❌ Ошибка quality check: ${e.message.slice(0,80)}</div>`;
  }
}

// Hook into runHealthCheck to also run quality check
const _origRunHC_v87 = typeof runHealthCheck === 'function' ? runHealthCheck : null;
if(_origRunHC_v87){
  runHealthCheck = async function(){
    await _origRunHC_v87.apply(this, arguments);
    await runDBQualityCheck();
  };
}

// ═══════════════════════════════════════════════════════════════
// ORGANIZER CABINET & QUIZ PASSES SHOP
// ═══════════════════════════════════════════════════════════════

async function showOrganizerCabinet(){
  if(!currentUser){ toast('Войдите чтобы стать организатором'); return; }

  // Check organizer status from server
  try{
    const {data, error} = await sb.from('organizer_profiles')
      .select('status')
      .eq('user_id', currentUser.id)
      .maybeSingle();

    if(error && error.code !== 'PGRST116'){
      console.error('[Org] status check error:', error.message);
      toast('Ошибка проверки статуса');
      return;
    }

    if(!data){
      // Not applied yet — show application form
      showScreen('organizer-apply');
      return;
    }
    if(data.status === 'pending'){
      toast('⏳ Ваша заявка на рассмотрении. Мы напишем вам.');
      return;
    }
    if(data.status === 'suspended'){
      toast('🚫 Ваш аккаунт организатора приостановлен.');
      return;
    }
    if(data.status !== 'approved'){
      showScreen('organizer-apply');
      return;
    }
    // Approved — show full cabinet
    showScreen('organizer-cabinet');
    loadOrgPasses();
    updateOrgRefLink();
    updateOrgStats();
    // Load advanced analytics (new module)
    setTimeout(() => window.loadOrgAnalytics?.(), 800);
    // Populate master-franchise dropdown for branch registration
    loadMasterFranchiseOptions();
  } catch(e){
    console.error('[Org] showOrganizerCabinet:', e.message);
    toast('Ошибка: ' + e.message);
  }
}

// ── Franchise: load master brands into dropdown ───────────────────
async function loadMasterFranchiseOptions(){
  const sel = document.getElementById('org-branch-parent');
  if(!sel) return;
  const { data, error } = await sb.from('brand_profiles')
    .select('id,name')
    .is('parent_id', null)
    .order('name');
  if(error || !data) return;
  const opts = data.map(b => `<option value="${b.id}">${b.name.replace(/</g,'&lt;')}</option>`).join('');
  sel.innerHTML = '<option value="">— Самостоятельный бренд (без франшизы) —</option>' + opts;
}

// ── Franchise: register a new city branch ──────────────────────────
async function registerCityBranch(){
  const statusEl = document.getElementById('org-branch-status');
  const parentId = document.getElementById('org-branch-parent')?.value || null;
  const city     = document.getElementById('org-branch-city')?.value.trim();
  const slug     = document.getElementById('org-branch-slug')?.value.trim();

  if(parentId && !city){
    if(statusEl) statusEl.textContent = '⚠️ Укажите город для филиала франшизы';
    return;
  }
  if(!slug){
    if(statusEl) statusEl.textContent = '⚠️ Укажите slug бренда';
    return;
  }

  if(statusEl) statusEl.textContent = '⏳ Регистрация...';

  try {
    if(parentId){
      // Branch registration via RPC (validates parent is a master brand)
      const { data, error } = await sb.rpc('register_city_branch', {
        p_parent_brand_id: parentId,
        p_city: city,
        p_slug: slug,
        p_country_code: 'RU',
      });
      if(error) throw error;
      if(statusEl) statusEl.textContent = '✅ Филиал «' + (data?.name || '') + ' ' + city + '» зарегистрирован';
    } else {
      // Standalone master brand — direct insert (owner_id RLS-scoped)
      const { error } = await sb.from('brand_profiles').insert({
        owner_id: currentUser.id,
        slug,
        name: slug,
        city: city || null,
      });
      if(error) throw error;
      if(statusEl) statusEl.textContent = '✅ Бренд зарегистрирован';
    }
    document.getElementById('org-branch-city').value = '';
    document.getElementById('org-branch-slug').value = '';
  } catch(e){
    if(statusEl) statusEl.textContent = '❌ Ошибка: ' + e.message;
  }
}
window.registerCityBranch = registerCityBranch;
window.loadMasterFranchiseOptions = loadMasterFranchiseOptions;

async function submitOrgApplication(){
  if(!currentUser){ toast('Войдите для подачи заявки'); return; }
  const name    = document.getElementById('org-apply-name')?.value?.trim();
  const email   = document.getElementById('org-apply-email')?.value?.trim();
  const city    = document.getElementById('org-apply-city')?.value?.trim();
  const phone   = document.getElementById('org-apply-phone')?.value?.trim();
  const social  = document.getElementById('org-apply-social')?.value?.trim();
  const aboutRaw = document.getElementById('org-apply-about')?.value?.trim();
  const aboutParts = [aboutRaw, phone ? `📞 ${phone}` : '', social ? `🔗 ${social}` : ''].filter(Boolean);
  const about = aboutParts.join('\n');

  if(!name || !email){ toast('Заполните имя и email'); return; }

  // Check if already has a profile (pending or otherwise)
  const {data: existing} = await sb.from('organizer_profiles')
    .select('status').eq('user_id', currentUser.id).maybeSingle();

  let applyError = null;
  if(!existing){
    // First application — INSERT only (RLS allows insert of own row)
    // status is set by DB default ('pending') — client cannot override it
    const {error} = await sb.from('organizer_profiles').insert({
      user_id:       currentUser.id,
      display_name:  name,
      contact_email: email,
      city:          city || '',
      about:         about || ''
      // status NOT sent — DB default = 'pending', trigger enforces it
    });
    applyError = error;
  } else if(existing.status === 'pending'){
    // Edit pending application — UPDATE only non-status fields
    const {error} = await sb.from('organizer_profiles').update({
      display_name:  name,
      contact_email: email,
      city:          city || '',
      about:         about || ''
      // status/approved_at/approved_by NOT sent — RLS only allows pending→pending
    }).eq('user_id', currentUser.id).eq('status', 'pending');
    applyError = error;
  } else {
    toast('Статус заявки нельзя изменить после обработки');
    return;
  }
  const error = applyError;

  if(error){
    toast('Ошибка подачи заявки: ' + error.message);
    return;
  }
  toast('✅ Заявка сохранена. Мы свяжемся с вами по email.');
  track('org_application_submitted', {});
  showScreen('home');
}

function updateOrgRefLink(){
  const link = location.origin + location.pathname + '?ref=org_' + (currentUser?.id?.slice(0,8)||'');
  const el = document.getElementById('org-ref-link');
  if(el) el.textContent = link;
}

function copyOrgRefLink(){
  const link = location.origin + location.pathname + '?ref=org_' + (currentUser?.id?.slice(0,8)||'');
  navigator.clipboard.writeText(link).catch(()=>{});
  toast('🔗 Ссылка скопирована!');
}

async function submitOrgPass(){
  if(!currentUser){ toast('🔐 Войдите чтобы добавить проходку'); return; }

  const title = document.getElementById('org-pass-title')?.value?.trim();
  const date  = document.getElementById('org-pass-date')?.value?.trim();
  const city  = document.getElementById('org-pass-city')?.value?.trim();
  const price = parseInt(document.getElementById('org-pass-price')?.value) || 300;
  const slots = parseInt(document.getElementById('org-pass-slots')?.value) || 10;
  const desc  = document.getElementById('org-pass-desc')?.value?.trim() || '';

  if(!title || title.length < 3){ toast('⚠️ Введите название (минимум 3 символа)'); return; }
  if(!date){  toast('⚠️ Укажите дату'); return; }
  if(!city){  toast('⚠️ Укажите город'); return; }
  if(price < 50 || price > 5000){ toast('⚠️ Цена: 50–5000 нейронов'); return; }
  if(slots < 1 || slots > 200){   toast('⚠️ Мест: 1–200'); return; }

  // XSS sanitize free-text fields
  const safe = s => s.replace(/[<>"']/g, c => ({'<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const btn = document.querySelector('#organizer-cabinet button[onclick="submitOrgPass()"]');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ Публикуем...'; }

  try{
    const {error} = await sb.from('quiz_passes').insert({
      organizer_id:   currentUser.id,
      organizer_name: safe(currentUser.user_metadata?.full_name || currentUser.email?.split('@')[0] || 'Организатор'),
      title:          safe(title),
      description:    safe(desc),
      date_text:      safe(date),
      city:           safe(city),
      price_neurons:  price,
      slots_total:    slots,
      slots_left:     slots,
      status:         'active'
    });
    if(error) throw error;
    toast('✅ Проходка опубликована!');
    ['org-pass-title','org-pass-date','org-pass-city','org-pass-desc'].forEach(id=>{
      const el = document.getElementById(id); if(el) el.value='';
    });
    document.getElementById('org-pass-price').value='300';
    document.getElementById('org-pass-slots').value='10';
    loadOrgPasses();
    if(typeof loadQuizPasses === 'function') loadQuizPasses();
    track('org_pass_created', {price, slots});
  }catch(e){
    console.error('[BFC] submitOrgPass:', e.message);
    toast('❌ Ошибка: ' + e.message);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = '🚀 Опубликовать проходку'; }
  }
}

async function loadOrgPasses(){
  if(!currentUser) return;
  const el = document.getElementById('org-my-passes');
  if(!el) return;
  el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">⏳ Загрузка...</div>';
  try{
    const {data} = await sb.from('quiz_passes')
      .select('*')
      .eq('organizer_id', currentUser.id)
      .order('created_at', {ascending:false})
      .limit(20);
    if(!data||!data.length){
      el.innerHTML = '<div style="color:var(--muted);font-size:13px;text-align:center;padding:16px">У тебя пока нет проходок</div>';
      return;
    }
    // Use _esc() for all user content to prevent XSS
    el.innerHTML = data.map(p=>`
      <div style="background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px 14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
          <div style="font-size:13px;font-weight:800">${_esc(p.title||'—')}</div>
          <div style="font-size:12px;font-weight:800;color:var(--gold)">${p.price_neurons||0} ⚡</div>
        </div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:6px">📅 ${_esc(p.date_text||'—')} · 📍 ${_esc(p.city||'—')}</div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:11px;color:var(--muted)">Мест: ${p.slots_left||0}/${p.slots_total||0}</div>
          <button onclick="deleteOrgPass('${_esc(p.id)}')" style="padding:4px 10px;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer;border:0.5px solid var(--border);background:var(--bg2);color:var(--red);font-family:inherit">Удалить</button>
        </div>
      </div>`).join('');
  }catch(e){
    el.innerHTML = '<div style="color:var(--red);font-size:12px;padding:12px">Ошибка загрузки</div>';
  }
}

async function deleteOrgPass(passId){
  if(!confirm('Отменить проходку? Если есть покупки — нейроны вернутся покупателям.')) return;

  // Check for existing purchases
  const {count, error: cErr} = await sb.from('quiz_pass_purchases')
    .select('*', {count:'exact', head:true})
    .eq('pass_id', passId).eq('status','confirmed');

  if(cErr){ toast('Ошибка проверки покупок'); return; }

  if(count && count > 0){
    // Has purchases — use cancel_quiz_pass RPC to refund atomically
    const {data, error} = await sb.rpc('cancel_quiz_pass', { p_pass_id: passId });
    if(error){ toast('Ошибка отмены: ' + error.message); return; }
    toast(`✅ Проходка отменена. Возврат ${count} покупателям выполнен.`);
  } else {
    // No purchases — safe to cancel directly
    const {error} = await sb.from('quiz_passes')
      .update({status:'cancelled'})
      .eq('id', passId)
      .eq('organizer_id', currentUser.id);
    if(error){ toast('Ошибка: ' + error.message); return; }
    toast('Проходка отменена');
  }
  loadOrgPasses();
  loadQuizPasses();
}

async function updateOrgStats(){
  if(!currentUser) return;
  try{
    const {count:sold} = await sb.from('quiz_pass_purchases')
      .select('*',{count:'exact',head:true}).eq('organizer_id',currentUser.id);
    const soldEl = document.getElementById('org-stat-sold');
    const plEl   = document.getElementById('org-stat-players');
    if(soldEl) soldEl.textContent = sold||0;
    if(plEl)   plEl.textContent = sold||0;
  }catch(e){}
}

// Load quiz passes for shop display
async function loadQuizPasses(){
  const el = document.getElementById('quiz-passes-list');
  if(!el) return;
  try{
    const {data, error} = await sb.from('quiz_passes')
      .select('*')
      .eq('status','active')
      .gt('slots_left',0)
      .order('created_at',{ascending:false})
      .limit(10);
    if(error){ console.error('[MFC] loadQuizPasses:', error.message); return; }
    if(!data||!data.length) return; // keep placeholder
    // XSS-safe: all user content goes through _esc()
    // price comes from DB server-side in buyQuizPass — not passed from client
    el.innerHTML = data.map(p=>{
      const dateStr = p.event_date ? new Date(p.event_date).toLocaleDateString('ru-RU',{day:'numeric',month:'long'}) : (p.date_text||'—');
      const loc = p.location || p.city || '—';
      const priceN = p.price ?? p.price_neurons ?? 0;
      return `
      <div style="background:var(--bg2);border:0.5px solid rgba(108,99,255,.3);border-radius:14px;padding:14px;display:flex;align-items:center;gap:12px;cursor:pointer" onclick="buyQuizPass('${_esc(p.id)}')">
        <div style="font-size:28px;flex-shrink:0">🎟️</div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:800">${_esc(p.title||'Квиз')}</div>
          <div style="font-size:11px;color:var(--muted)">📅 ${_esc(dateStr)} · 📍 ${_esc(loc)}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">от ${_esc(p.organizer_name||'Организатор')} · мест: ${p.slots_left||0}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-size:16px;font-weight:800;color:var(--gold)">${priceN} ⚡</div>
          <div style="font-size:10px;color:var(--muted);margin-top:2px">нейронов</div>
        </div>
      </div>`;}).join('');
  }catch(e){ console.error('[MFC] loadQuizPasses exception:', e.message); }
}

async function buyQuizPass(passId){
  if(!currentUser){ toast('🔐 Войдите чтобы купить проходку'); return; }
  if(!passId){ toast('Ошибка: ID проходки не указан'); return; }
  if(!confirm('Купить проходку? Нейроны будут списаны согласно цене в базе данных.')) return;

  try{
    // Single atomic RPC — client sends only pass ID, no price
    // Server: locks pass FOR UPDATE, checks status/slots/balance,
    //         deducts neurons (NOT xp), creates purchase + ticket, returns result
    const { data, error } = await sb.rpc('purchase_quiz_pass', { p_pass_id: passId });

    if(error){
      console.error('[MFC] purchase_quiz_pass error:', error.message);
      track('quiz_pass_purchase_error', { pass_id: passId, error: error.message });
      toast('❌ Ошибка покупки: ' + error.message);
      await refreshBalance();
      return;
    }

    if(!data || !data.ok){
      const reasons = {
        insufficient:      '❌ Недостаточно нейронов',
        sold_out:          '❌ Места закончились',
        already_purchased: '❌ Вы уже купили эту проходку',
        not_active:        '❌ Проходка недоступна',
      };
      toast(reasons[data?.reason] || '❌ Ошибка покупки');
      await refreshBalance();
      return;
    }

    // Sync local balance from server response
    if(typeof data.neurons === 'number'){ neurons = data.neurons; xp = data.xp ?? xp; updNeurons(); }

    track('quiz_pass_purchased', { pass_id: passId, ticket_code: data.ticket_code });
    toast(`✅ Проходка куплена! Код билета: ${data.ticket_code}`);
    showTicketScreen(data);
    loadQuizPasses();
  }catch(e){
    console.error('[MFC] buyQuizPass exception:', e.message);
    track('quiz_pass_purchase_error', { pass_id: passId, error: e.message });
    await refreshBalance();
    toast('❌ Ошибка: ' + e.message);
  }
}

function showTicketScreen(purchaseData){
  // Show a simple modal with ticket details
  const existing = document.getElementById('ticket-modal');
  if(existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'ticket-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = `
    <div style="background:var(--bg2);border:0.5px solid rgba(108,99,255,.4);border-radius:20px;padding:28px;max-width:380px;width:100%;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🎟️</div>
      <div style="font-size:18px;font-weight:800;margin-bottom:6px">Проходка куплена!</div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:18px">Покажи код организатору на входе</div>
      <div style="background:var(--bg3);border:0.5px solid rgba(108,99,255,.3);border-radius:14px;padding:16px;margin-bottom:16px">
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px;text-transform:uppercase;letter-spacing:1px">Код билета</div>
        <div style="font-size:28px;font-weight:900;letter-spacing:4px;color:var(--accent2)" id="ticket-code-display">${_esc(purchaseData.ticket_code||'—')}</div>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:14px">
        <button onclick="navigator.clipboard.writeText('${_esc(purchaseData.ticket_code||'')}').then(()=>toast('Скопировано!'))" style="flex:1;background:rgba(108,99,255,.15);border:0.5px solid var(--accent);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--accent2);cursor:pointer;font-family:inherit">📋 Копировать</button>
        <button onclick="document.getElementById('ticket-modal').remove()" style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;padding:10px;font-size:13px;font-weight:800;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
      </div>
      <div style="font-size:11px;color:var(--muted);line-height:1.5">Организатор свяжется с вами для подтверждения деталей</div>
    </div>`;
  document.body.appendChild(modal);
}

// Update shop balance display
const _origRenderShop = typeof renderShop === 'function' ? renderShop : null;
if(_origRenderShop){
  renderShop = function(){
    _origRenderShop.apply(this,arguments);
    const xpEl = document.getElementById('shop-xp-display');
    const nEl  = document.getElementById('shop-neurons-display');
    if(xpEl) xpEl.textContent = xp;
    if(nEl)  nEl.textContent = neurons;
    loadQuizPasses();
  };
} else {
  // Fallback: hook via setTimeout after DOM ready
  setTimeout(()=>{
    const xpEl = document.getElementById('shop-xp-display');
    const nEl  = document.getElementById('shop-neurons-display');
    if(xpEl) xpEl.textContent = xp;
    if(nEl)  nEl.textContent = neurons;
    loadQuizPasses();
  }, 300);
}

// Load xp from profile on auth
const _origUpdateProfileUI = typeof updateProfileUI === 'function' ? updateProfileUI : null;



// ════════════════════════════════════════════════════════════════
// КОРПОРАТИВНЫЕ КВИЗЫ (B2B)
// Квизы для компаний, спортклубов, мероприятий
// Хранятся в таблицах: organizations, corporate_tournaments
// ════════════════════════════════════════════════════════════════

// ── Открыть корпоративный турнир по invite_code ───────────────────
async function openCorporateTournament(inviteCode){
  if(!currentUser){ showScreen('auth'); return; }
  try{
    const { data: tourn, error } = await sb.from('corporate_tournaments')
      .select('*, organizations(name,logo_url)')
      .eq('invite_code', inviteCode.toUpperCase())
      .in('status',['scheduled','live'])
      .single();
    if(error || !tourn){ toast('Турнир не найден или уже завершён'); return; }
    showCorporateTournamentLobby(tourn);
    track('corp_tournament_opened', { tournament_id: tourn.id });
  }catch(e){
    toast('Ошибка: ' + e.message);
  }
}

// ── Экран лобби корпоративного турнира ───────────────────────────
function showCorporateTournamentLobby(tourn){
  const org = tourn.organizations;
  // Создаём модальный экран поверх текущего
  const existing = document.getElementById('corp-tourn-modal');
  if(existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'corp-tourn-modal';
  modal.className = 'screen active';
  modal.style.cssText = 'position:fixed;inset:0;z-index:1000;background:var(--bg);overflow-y:auto';
  modal.innerHTML = `
    <div class="hdr">
      <button onclick="document.getElementById('corp-tourn-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer">←</button>
      <div style="font-size:13px;font-weight:800">🏆 ${_esc(org?.name||'Корпоративный турнир')}</div>
      <div></div>
    </div>
    <div style="width:100%;max-width:560px;padding:16px 16px 100px;display:flex;flex-direction:column;gap:14px">
      <div style="background:linear-gradient(135deg,var(--bg3),var(--bg2));border:0.5px solid rgba(108,99,255,.4);border-radius:18px;padding:24px 20px;text-align:center">
        ${org?.logo_url?`<img src="${_esc(org.logo_url)}" style="width:60px;height:60px;border-radius:12px;object-fit:cover;margin-bottom:12px" alt="logo">`:'<div style="font-size:48px;margin-bottom:12px">🏢</div>'}
        <div style="font-size:20px;font-weight:800;margin-bottom:6px">${_esc(tourn.title)}</div>
        ${tourn.description?`<div style="font-size:13px;color:var(--muted);margin-bottom:12px">${_esc(tourn.description)}</div>`:''}
        <div style="display:inline-block;background:rgba(68,204,136,.12);border:0.5px solid var(--green);border-radius:20px;padding:4px 14px;font-size:12px;font-weight:800;color:var(--green)">${tourn.status==='live'?'🔴 ИДЁТ СЕЙЧАС':'📅 Скоро начнётся'}</div>
      </div>
      ${tourn.scoring_mode!=='individual'?`
      <div style="background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;padding:14px">
        <div style="font-size:12px;font-weight:800;margin-bottom:10px">🏬 Выбери отдел</div>
        <div id="corp-dept-list" style="display:flex;flex-direction:column;gap:8px">
          <div style="color:var(--muted);font-size:13px">Загрузка...</div>
        </div>
      </div>`:''}
      <button onclick="joinCorporateTournament('${_esc(tourn.id)}')" style="background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit">
        🚀 Присоединиться к турниру
      </button>
      <div id="corp-leaderboard" style="background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;overflow:hidden">
        <div style="padding:10px 14px;border-bottom:0.5px solid var(--border);font-size:10px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:var(--muted)">
          ${tourn.scoring_mode==='department'?'🏬 Рейтинг отделов':'👤 Рейтинг участников'}
        </div>
        <div id="corp-lb-rows" style="padding:10px 14px;color:var(--muted);font-size:13px">Загрузка...</div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // Load departments and leaderboard
  loadCorporateDepts(tourn.id, tourn.scoring_mode);
  loadCorporateLeaderboard(tourn.id, tourn.scoring_mode);
}

async function loadCorporateDepts(tournId, scoringMode){
  if(scoringMode === 'individual') return;
  const el = document.getElementById('corp-dept-list');
  if(!el) return;
  try{
    const { data: teams } = await sb.from('corporate_tournament_teams')
      .select('id,name,total_score').eq('tournament_id', tournId).order('total_score',{ascending:false});
    if(!teams||!teams.length){ el.innerHTML = '<div style="color:var(--muted);font-size:13px">Отделы не найдены</div>'; return; }
    el.innerHTML = teams.map(t=>`
      <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--bg3);border:0.5px solid var(--border);border-radius:10px;cursor:pointer">
        <input type="radio" name="corp-dept" value="${_esc(t.id)}" style="accent-color:var(--accent)">
        <span style="flex:1;font-size:13px;font-weight:700">${_esc(t.name)}</span>
        <span style="font-size:12px;color:var(--gold);font-weight:800">${t.total_score||0} pts</span>
      </label>`).join('');
  }catch(e){ el.innerHTML = '<div style="color:var(--red);font-size:12px">Ошибка загрузки</div>'; }
}

async function loadCorporateLeaderboard(tournId, scoringMode){
  const el = document.getElementById('corp-lb-rows');
  if(!el) return;
  try{
    let data, error;
    if(scoringMode === 'department'){
      ({data, error} = await sb.from('corporate_tournament_teams')
        .select('name,total_score').eq('tournament_id', tournId)
        .order('total_score',{ascending:false}).limit(10));
    } else {
      ({data, error} = await sb.from('corporate_tournament_results')
        .select('score, profiles(display_name)')
        .eq('tournament_id', tournId)
        .order('score',{ascending:false}).limit(10));
    }
    if(error || !data || !data.length){ el.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:4px">Пока нет участников</div>'; return; }
    const medals = ['🥇','🥈','🥉'];
    el.innerHTML = data.map((r,i)=>`
      <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:0.5px solid rgba(108,99,255,.06)">
        <div style="font-size:14px;font-weight:800;width:20px;text-align:center">${medals[i]||i+1}</div>
        <div style="flex:1;font-size:13px;font-weight:600">${_esc(r.name||r.profiles?.display_name||'Участник')}</div>
        <div style="font-size:13px;font-weight:800;color:var(--accent2)">${r.total_score||r.score||0}</div>
      </div>`).join('');
  }catch(e){ el.innerHTML = '<div style="color:var(--red);font-size:12px">Ошибка</div>'; }
}

async function joinCorporateTournament(tournId){
  if(!currentUser){ toast('Войдите чтобы участвовать'); return; }
  const deptInput = document.querySelector('input[name="corp-dept"]:checked');
  const teamId = deptInput?.value || null;
  try{
    const { error } = await sb.from('corporate_tournament_results').upsert({
      tournament_id: tournId,
      user_id:       currentUser.id,
      team_id:       teamId,
      score:         0,
    }, { onConflict: 'tournament_id,user_id' });
    if(error){ toast('Ошибка регистрации: ' + error.message); return; }
    toast('✅ Вы зарегистрированы в турнире!');
    track('corp_tournament_joined', { tournament_id: tournId, team_id: teamId });
    // Close modal and go to official tournament view
    const modal = document.getElementById('corp-tourn-modal');
    if(modal) modal.remove();
  }catch(e){
    toast('Ошибка: ' + e.message);
  }
}

// ── Квизы для спортклубов/мероприятий (через официальные турниры) ─
// Организатор создаёт турнир в admin-панели, игроки входят по ссылке ?official=CODE
// openOfficialTournament(code) уже реализована в legacy.js ↑

// ── Генерация шер-ссылки для корпоративного турнира ──────────────
function getCorporateTournamentLink(inviteCode){
  return location.origin + location.pathname + '?corp=' + encodeURIComponent(inviteCode);
}
function shareCorporateTournamentLink(inviteCode, tournTitle){
  const link = getCorporateTournamentLink(inviteCode);
  const text = lang==='ru'
    ? `Присоединяйся к корпоративному квизу «${tournTitle}»!`
    : `Join the corporate quiz "${tournTitle}"!`;
  if(navigator.share){
    navigator.share({ title: tournTitle, text, url: link }).catch(()=>{});
  } else {
    navigator.clipboard.writeText(link).catch(()=>{});
    toast(lang==='ru' ? '🔗 Ссылка скопирована!' : '🔗 Link copied!');
  }
}

// Expose to window
window.openCorporateTournament     = openCorporateTournament;
window.joinCorporateTournament     = joinCorporateTournament;
window.getCorporateTournamentLink  = getCorporateTournamentLink;
window.shareCorporateTournamentLink= shareCorporateTournamentLink;
window.shareHypePack               = shareHypePack;
window.shareHypeToTG               = shareHypeToTG;
window.shareHypeToWA               = shareHypeToWA;
window.checkHypeParam              = checkHypeParam;
window.loadPartnerOffers           = loadPartnerOffers;
window.redeemPartnerOffer          = redeemPartnerOffer;

// ════════════════════════════════════════════════════════════════
// PREMIUM — BFC Premium via ЮKassa
// Frontend NEVER activates Premium directly.
// Flow: openPremiumScreen → startPremiumCheckout → Edge Function
//       → YooKassa → webhook → Edge Function (service role) → activated
// ════════════════════════════════════════════════════════════════

let _subscriptionCache = null; // { plan, status, current_period_end, cancel_at_period_end }

async function refreshSubscriptionStatus(){
  if(!currentUser) return null;
  try{
    const { data } = await sb.from('subscriptions')
      .select('plan,status,current_period_end,cancel_at_period_end,canceled_at')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    _subscriptionCache = data || { plan:'free', status:'inactive' };
    const _now = new Date();
    const premiumActive =
      _subscriptionCache.plan === 'premium'
      && _subscriptionCache.status === 'active'
      && !!_subscriptionCache.current_period_end
      && new Date(_subscriptionCache.current_period_end) > _now;
    window._userSubscription = {
      plan:          _subscriptionCache.plan,
      isPremium:     premiumActive,
      trainingLimit: premiumActive ? 50 : 10,
      battleLimit:   premiumActive ? 10 :  3,
    };
    return _subscriptionCache;
  }catch(e){
    console.warn('[premium] refreshSubscriptionStatus:', e.message);
    return null;
  }
}

function isPremiumActive(){
  const s = _subscriptionCache;
  if(!s) return false;
  return s.plan === 'premium'
    && s.status === 'active'
    && s.current_period_end
    && new Date(s.current_period_end) > new Date();
}

function openPremiumScreen(){
  if(!currentUser){ toast('Войдите чтобы оформить Premium'); showScreen('auth'); return; }
  track('premium_view', {});
  showScreen('premium');
  renderPremiumStatus();
}

async function renderPremiumStatus(){
  const sub = await refreshSubscriptionStatus();
  const statusBlock   = document.getElementById('premium-status-block');
  const statusText    = document.getElementById('premium-status-text');
  const cancelBtn     = document.getElementById('premium-cancel-btn');
  const checkoutBlock = document.getElementById('premium-checkout-block');
  if(!statusBlock || !checkoutBlock) return;

  if(isPremiumActive()){
    const endDate = new Date(sub.current_period_end).toLocaleDateString('ru-RU');
    statusBlock.style.display = '';
    checkoutBlock.style.display = 'none';
    if(sub.cancel_at_period_end){
      statusText.textContent = `⭐ Premium активен до ${endDate}. Автопродление отменено.`;
      if(cancelBtn) cancelBtn.style.display = 'none';
    } else {
      statusText.textContent = `⭐ Premium активен до ${endDate}`;
      if(cancelBtn) cancelBtn.style.display = '';
    }
  } else {
    statusBlock.style.display = 'none';
    checkoutBlock.style.display = 'flex';
  }
}

async function startPremiumCheckout(plan){
  if(!currentUser){ toast('Войдите чтобы оформить Premium'); return; }
  if(!['monthly','yearly'].includes(plan)) return;

  const btnLabels = {
    monthly: 'Оформить за 299 ₽ / месяц',
    yearly:  'Купить год за 1490 ₽',
  };
  track(plan === 'monthly' ? 'premium_click_monthly' : 'premium_click_yearly', {});

  const btnId = plan === 'monthly' ? 'btn-premium-monthly' : 'btn-premium-yearly';
  const btn = document.getElementById(btnId);
  if(btn){ btn.textContent = '⏳ Создаём платёж...'; btn.disabled = true; }

  try{
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    if(!token){ toast('Ошибка авторизации'); return; }

    const res = await fetch(
      `https://${location.hostname === 'localhost' ? 'nhmidxkohjpcnhjucuuh' : 'nhmidxkohjpcnhjucuuh'}.supabase.co/functions/v1/create_yookassa_payment`,
      {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ plan }),
      }
    );
    const data = await res.json();

    if(!res.ok || !data.confirmation_url){
      toast('Ошибка: ' + (data.error || 'Попробуй ещё раз'));
      if(btn){ btn.textContent = `Оформить за ${prices[plan]} / месяц`; btn.disabled = false; }
      return;
    }

    track('premium_checkout_created', { plan, payment_id: data.payment_id });
    // Redirect to YooKassa
    location.href = data.confirmation_url;

  }catch(e){
    toast('Ошибка: ' + e.message);
    if(btn){ btn.textContent = btnLabels[plan]; btn.disabled = false; }
  }
}

async function cancelPremium(){
  if(!currentUser) return;
  if(!confirm('Отменить автопродление? Premium останется активным до конца оплаченного периода.')) return;
  track('premium_cancel_clicked', {});
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(
      'https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/cancel_subscription',
      { method: 'POST', headers: { 'Authorization': `Bearer ${session?.access_token}` } }
    );
    const data = await res.json();
    if(res.ok){
      toast('✅ Автопродление отменено. Premium активен до ' + new Date(data.period_end).toLocaleDateString('ru-RU'));
      track('premium_cancelled', {});
      renderPremiumStatus();
    } else {
      toast('Ошибка: ' + (data.error || 'Попробуй ещё раз'));
    }
  }catch(e){ toast('Ошибка: ' + e.message); }
}

async function applyPremiumPromoCode(){
  const code = prompt('Введи промокод:');
  if(!code) return;
  if(!currentUser){ toast('Войдите сначала'); return; }
  try{
    const { data: { session } } = await sb.auth.getSession();
    const res = await fetch(
      'https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/apply_premium_promocode',
      {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${session?.access_token}` },
        body: JSON.stringify({ code }),
      }
    );
    const data = await res.json();
    if(res.ok){
      toast('🎉 ' + data.message);
      track('premium_promocode_applied', { code });
      await refreshSubscriptionStatus();
      renderPremiumStatus();
    } else {
      toast('❌ ' + (data.error || 'Неверный промокод'));
    }
  }catch(e){ toast('Ошибка: ' + e.message); }
}

// Check ?premium_return=1 on page load (user came back from YooKassa)
async function checkPremiumReturn(){
  const p = new URLSearchParams(location.search);
  if(!p.get('premium_return')) return;
  // Remove param from URL without reload
  history.replaceState({}, '', location.pathname);
  track('premium_payment_return', {});
  // Show processing state and poll for activation
  showScreen('premium');
  const proc = document.getElementById('premium-processing');
  const chk  = document.getElementById('premium-checkout-block');
  if(proc) proc.style.display = '';
  if(chk)  chk.style.display  = 'none';

  let activated = false;
  for(let i = 0; i < 8; i++){
    await new Promise(r => setTimeout(r, 1500));
    const sub = await refreshSubscriptionStatus();
    if(isPremiumActive()){
      activated = true;
      break;
    }
  }
  if(proc) proc.style.display = 'none';
  if(activated){
    toast('🎉 BFC Premium активирован!');
    track('premium_activated', { source: 'return' });
    renderPremiumStatus();
  } else {
    toast('Оплата обрабатывается. Premium включится автоматически.');
    if(chk) chk.style.display = 'flex';
  }
}

// Premium CTA helper — shown on daily-limit, score, play-menu
function showPremiumCTA(trigger){
  track('premium_limit_upsell', { trigger });
  const cta = document.createElement('div');
  cta.style.cssText = 'background:linear-gradient(135deg,rgba(240,192,64,.12),rgba(108,99,255,.08));border:0.5px solid rgba(240,192,64,.4);border-radius:14px;padding:14px 16px;margin:12px 0;cursor:pointer';
  cta.innerHTML = `
    <div style="font-size:13px;font-weight:800;color:var(--gold);margin-bottom:4px">⭐ BFC Premium</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">50 вопросов в день · 10 баттлов · Закрытые турниры</div>
    <div style="background:var(--gold);border:none;border-radius:10px;padding:9px 16px;font-size:13px;font-weight:800;color:#1a1a00;display:inline-block">Попробовать за 299 ₽/мес</div>`;
  cta.onclick = () => openPremiumScreen();
  return cta;
}

// Expose to window
window.openPremiumScreen        = openPremiumScreen;
window.startPremiumCheckout     = startPremiumCheckout;
window.cancelPremium            = cancelPremium;
window.renderPremiumStatus      = renderPremiumStatus;
window.applyPremiumPromoCode    = applyPremiumPromoCode;
window.refreshSubscriptionStatus= refreshSubscriptionStatus;
window.isPremiumActive          = isPremiumActive;
window.checkPremiumReturn       = checkPremiumReturn;
window.showPremiumCTA           = showPremiumCTA;

// ═══════════════════════════════════════════
// DUEL INCOMING CALL UI
// ═══════════════════════════════════════════
let _diCode = null, _diTimer = null, _diCountdown = 30;

window.showDuelIncoming = function(code, hostName) {
  _diCode = code;
  _diCountdown = 30;
  const el = document.getElementById('duel-incoming');
  if (!el) return;
  document.getElementById('di-caller').textContent = (hostName || '?')[0].toUpperCase();
  document.getElementById('di-name').textContent = hostName || 'Соперник';
  el.style.display = 'flex';
  _diTimer = setInterval(() => {
    _diCountdown--;
    const cd = document.getElementById('di-countdown');
    if (cd) cd.textContent = `Автоотклонение через ${_diCountdown}с`;
    if (_diCountdown <= 0) declineDuelIncoming();
  }, 1000);
};

window.acceptDuelIncoming = function() {
  clearInterval(_diTimer);
  document.getElementById('duel-incoming').style.display = 'none';
  if (_diCode) {
    showScreen('duel');
    document.getElementById('join-code-input').value = _diCode;
    setTimeout(() => window.joinDuel?.(), 300);
  }
};

window.declineDuelIncoming = function() {
  clearInterval(_diTimer);
  const el = document.getElementById('duel-incoming');
  if (el) el.style.display = 'none';
  _diCode = null;
};

// Onboarding is handled by js/training/streak.js → window.showOnboarding / showScreen('onboarding')

// ═══════════════════════════════════════════
// OPPONENT MINI PROFILE MODAL
// ═══════════════════════════════════════════
window.showOppProfile = async function(userId, displayName) {
  let modal = document.getElementById('opp-profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'opp-profile-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(10,10,20,.85);display:flex;align-items:flex-end;justify-content:center';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  const initial = (displayName || '?')[0].toUpperCase();
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px 24px 0 0;padding:24px;width:100%;max-width:480px;border-top:0.5px solid var(--border)">
    <div style="text-align:center;margin-bottom:16px">
      <div style="width:64px;height:64px;border-radius:50%;background:rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;font-size:28px;font-weight:900;color:var(--accent2)">${initial}</div>
      <div style="font-size:18px;font-weight:900">${displayName || 'Соперник'}</div>
      <div id="opp-profile-rank" style="margin-top:6px"></div>
      <div id="opp-profile-loading" style="font-size:13px;color:var(--muted);margin-top:4px">Загрузка...</div>
    </div>
    <div id="opp-profile-stats" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px"></div>
    <div id="opp-friend-btn-wrap" style="margin-bottom:8px"></div>
    <button onclick="document.getElementById('opp-profile-modal').remove()" style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
  </div>`;
  modal.style.display = 'flex';

  try {
    let query = sb.from('player_stats').select('*');
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('display_name', displayName);
    const { data } = await query.single();
    const loadEl = document.getElementById('opp-profile-loading');
    const statsEl = document.getElementById('opp-profile-stats');
    if (!data) { if (loadEl) loadEl.textContent = 'Нет данных'; return; }
    if (loadEl) loadEl.textContent = '';
    const rankEl = document.getElementById('opp-profile-rank');
    if (rankEl) rankEl.innerHTML = _rankBadgeHTML(data.xp || 0);
    if (statsEl) statsEl.innerHTML = [
      { v: data.games_played || 0,         l: 'Игр' },
      { v: data.duels_played || 0,         l: 'Дуэлей' },
      { v: (data.accuracy_pct || 0) + '%', l: 'Точность' },
      { v: data.neurons || 0,              l: 'Нейроны ⚡' },
      { v: data.best_streak || 0,          l: 'Лучший стрик' },
      { v: data.duels_won || 0,            l: 'Побед' },
    ].map(s => `<div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
      <div style="font-size:18px;font-weight:900;color:var(--accent2)">${s.v}</div>
      <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.l}</div>
    </div>`).join('');

    // Friend button — only for logged-in users viewing someone else
    const friendBtnWrap = document.getElementById('opp-friend-btn-wrap');
    const targetId = data.user_id || userId;
    if (friendBtnWrap && currentUser && targetId && targetId !== currentUser.id) {
      const { data: existing } = await sb.from('friendships')
        .select('friend_id').eq('user_id', currentUser.id).eq('friend_id', targetId).maybeSingle();
      if (existing) {
        friendBtnWrap.innerHTML = `<div style="text-align:center;font-size:13px;color:#4ade80;font-weight:700;padding:10px 0">✅ Уже в друзьях</div>`;
      } else {
        friendBtnWrap.innerHTML = `<button onclick="addFriendFromProfile('${targetId}','${(data.display_name||displayName||'').replace(/'/g,"\\'")}',this)"
          style="width:100%;background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit;margin-bottom:0">
          👥 Добавить в друзья
        </button>`;
      }
    }
  } catch (e) {
    const loadEl = document.getElementById('opp-profile-loading');
    if (loadEl) loadEl.textContent = 'Нет данных';
  }
};

// ── THEME TOGGLE ──────────────────────────────────────────────────────────────
function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'light' ? 'dark' : 'light';
  if (next === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
  } else {
    document.documentElement.removeAttribute('data-theme');
  }
  localStorage.setItem('bfc_theme', next);
  _applyThemeButtons(next);
}
function _applyThemeButtons(theme) {
  const isLight = theme === 'light';
  const icon = isLight ? '☀️' : '🌙';
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.textContent = isLight ? '☀️ Светлая тема' : '🌙 Тёмная тема';
  const hdrBtn = document.getElementById('theme-toggle-hdr');
  if (hdrBtn) hdrBtn.textContent = icon;
  const navIcon = document.getElementById('nav-theme-icon');
  if (navIcon) navIcon.textContent = icon;
}
window.toggleTheme = toggleTheme;
window.updatePushBtn = updatePushBtn;

// Apply saved theme immediately on load
(function() {
  const saved = localStorage.getItem('bfc_theme');
  if (saved === 'light') {
    document.documentElement.setAttribute('data-theme', 'light');
    window.addEventListener('DOMContentLoaded', () => { _applyThemeButtons('light'); });
  }
})();

// ═══════════════════════════════════════════
// RANKS SYSTEM
// ═══════════════════════════════════════════
const RANKS = [
  { min: 0,     name: 'Новобранец',   icon: '🥉', color: '#cd7f32' },
  { min: 500,   name: 'Ученик',       icon: '📚', color: '#888' },
  { min: 1500,  name: 'Знаток',       icon: '🥈', color: '#aaa' },
  { min: 3000,  name: 'Эксперт',      icon: '⭐', color: '#f0c040' },
  { min: 6000,  name: 'Мастер',       icon: '🥇', color: '#ffd700' },
  { min: 12000, name: 'Гроссмейстер', icon: '💎', color: '#a78bfa' },
  { min: 25000, name: 'Легенда',      icon: '👑', color: '#f59e0b' },
];

function getRank(xpVal) {
  let rank = RANKS[0];
  for (const r of RANKS) { if ((xpVal || 0) >= r.min) rank = r; }
  return rank;
}
window.getRank = getRank;

function _rankBadgeHTML(xpVal) {
  const rank = getRank(xpVal);
  const nextRank = RANKS.find(r => r.min > (xpVal || 0));
  const prevMin = rank.min;
  const nextMin = nextRank ? nextRank.min : null;
  let progressHTML = '';
  if (nextMin) {
    const pct = Math.min(100, Math.round(((xpVal || 0) - prevMin) / (nextMin - prevMin) * 100));
    progressHTML = `<div class="rank-progress"><div class="rank-progress-fill" style="width:${pct}%;background:${rank.color}"></div></div>
    <div style="font-size:10px;color:var(--muted);margin-top:2px;text-align:center">${xpVal || 0} / ${nextMin} XP</div>`;
  } else {
    progressHTML = `<div style="font-size:10px;color:var(--muted);margin-top:4px;text-align:center">Максимальный ранг!</div>`;
  }
  return `<div style="text-align:center">
    <div class="rank-badge" style="color:${rank.color};border-color:${rank.color}40">${rank.icon} ${rank.name}</div>
    ${progressHTML}
  </div>`;
}

// ═══════════════════════════════════════════
// PUBLIC PROFILE MODAL
// ═══════════════════════════════════════════
window.openPublicProfile = async function(username, userId) {
  let modal = document.getElementById('pub-profile-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pub-profile-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9995;background:rgba(10,10,20,.88);display:flex;align-items:center;justify-content:center;padding:16px';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:20px;padding:28px;width:100%;max-width:440px;border:0.5px solid var(--border);text-align:center">
    <div id="pub-profile-inner"><div style="color:var(--muted);font-size:14px">Загрузка...</div></div>
  </div>`;
  modal.style.display = 'flex';

  try {
    let query = sb.from('player_stats').select('*');
    if (userId) query = query.eq('user_id', userId);
    else query = query.eq('display_name', username);
    const { data } = await query.single();
    if (!data) {
      document.getElementById('pub-profile-inner').innerHTML = '<div style="color:var(--muted)">Профиль не найден</div>';
      return;
    }
    const initial = (data.display_name || username || '?')[0].toUpperCase();
    const rankHTML = _rankBadgeHTML(data.xp || 0);
    const shareUrl = location.origin + '?u=' + encodeURIComponent(data.display_name || username || '');
    document.getElementById('pub-profile-inner').innerHTML = `
      <div style="width:72px;height:72px;border-radius:50%;background:rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;margin:0 auto 12px;font-size:32px;font-weight:900;color:var(--accent2)">${initial}</div>
      <div style="font-size:20px;font-weight:900;margin-bottom:4px">${data.display_name || username || '—'}</div>
      ${data.city ? `<div style="font-size:13px;color:var(--muted);margin-bottom:8px">📍 ${data.city}</div>` : ''}
      <div style="margin-bottom:12px">${rankHTML}</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:20px">
        ${[
          { v: data.neurons || 0,              l: '⚡ Нейроны' },
          { v: data.xp || 0,                   l: 'XP' },
          { v: data.games_played || 0,          l: 'Игр' },
          { v: data.duels_played || 0,          l: 'Дуэлей' },
          { v: (data.accuracy_pct || 0) + '%',  l: 'Точность' },
          { v: data.best_streak || 0,           l: 'Лучший стрик' },
          { v: data.duels_won || 0,             l: 'Побед' },
        ].map(s => `<div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px">
          <div style="font-size:18px;font-weight:900;color:var(--accent2)">${s.v}</div>
          <div style="font-size:11px;color:var(--muted);margin-top:2px">${s.l}</div>
        </div>`).join('')}
      </div>
      <div id="pub-friend-btn-wrap" style="margin-bottom:8px"></div>
      <button onclick="navigator.clipboard.writeText('${shareUrl}').then(()=>window.toast?.('🔗 Ссылка скопирована!'))" style="width:100%;background:rgba(108,99,255,.15);border:0.5px solid var(--accent2);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit;margin-bottom:8px">🔗 Поделиться профилем</button>
      <button onclick="document.getElementById('pub-profile-modal').remove()" style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Закрыть</button>
    `;
    // Friend button in public profile
    const pubFriendWrap = document.getElementById('pub-friend-btn-wrap');
    const targetId = data.user_id || userId;
    if (pubFriendWrap && currentUser && targetId && targetId !== currentUser.id) {
      const { data: existing } = await sb.from('friendships')
        .select('friend_id').eq('user_id', currentUser.id).eq('friend_id', targetId).maybeSingle();
      if (existing) {
        pubFriendWrap.innerHTML = `<div style="text-align:center;font-size:13px;color:#4ade80;font-weight:700;padding:10px 0">✅ Уже в друзьях</div>`;
      } else {
        pubFriendWrap.innerHTML = `<button onclick="addFriendFromProfile('${targetId}','${(data.display_name||'').replace(/'/g,"\\'")}',this)"
          style="width:100%;background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">
          👥 Добавить в друзья
        </button>`;
      }
    }
  } catch (e) {
    const inner = document.getElementById('pub-profile-inner');
    if (inner) inner.innerHTML = '<div style="color:var(--muted)">Нет данных</div>';
  }
};

// ─── Friends & Async Challenges ────────────────────────────────────────────

async function loadFriends() {
  if (!currentUser) return;
  const el = document.getElementById('friends-list');
  if (!el) return;

  const { data } = await sb.from('friendships')
    .select('friend_id, profiles!friendships_friend_id_fkey(display_name, xp, neurons, last_seen)')
    .eq('user_id', currentUser.id)
    .limit(20);

  if (!data || !data.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:12px">Пока нет друзей — добавь первого!</div>';
    return;
  }

  const ONLINE_MS = 5 * 60 * 1000; // 5 minutes
  const now = Date.now();

  // Sort: online first
  const sorted = [...data].sort((a, b) => {
    const aOnline = a.profiles?.last_seen && (now - new Date(a.profiles.last_seen).getTime()) < ONLINE_MS;
    const bOnline = b.profiles?.last_seen && (now - new Date(b.profiles.last_seen).getTime()) < ONLINE_MS;
    return (bOnline ? 1 : 0) - (aOnline ? 1 : 0);
  });

  el.innerHTML = sorted.map(f => {
    const p = f.profiles;
    const rank = window.getRank ? window.getRank(p?.xp || 0) : { icon: '🥉' };
    const isOnline = p?.last_seen && (now - new Date(p.last_seen).getTime()) < ONLINE_MS;
    const onlineDot = isOnline
      ? '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-left:4px;vertical-align:middle;box-shadow:0 0 6px #4ade80"></span>'
      : '';
    const challengeBtn = isOnline
      ? `<button onclick="event.stopPropagation();challengeFriend('${f.friend_id}','${(p?.display_name||'').replace(/'/g,"\\'")}')
          " style="background:var(--accent);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:800;color:#fff;cursor:pointer;font-family:inherit;animation:pulse 1.5s infinite">⚔️ Вызвать</button>`
      : `<button onclick="event.stopPropagation();challengeFriend('${f.friend_id}','${(p?.display_name||'').replace(/'/g,"\\'")}')
          " style="background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.3);border-radius:8px;padding:5px 10px;font-size:11px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit">⚔️</button>`;
    return `<div onclick="window.showOppProfile('${f.friend_id}','${(p?.display_name||'').replace(/'/g,"\\'")}')
      " style="display:flex;align-items:center;gap:10px;padding:10px;background:${isOnline?'rgba(74,222,128,.06)':'rgba(255,255,255,.05)'};border:1px solid ${isOnline?'rgba(74,222,128,.2)':'rgba(255,255,255,.06)'};border-radius:12px;margin-bottom:6px;cursor:pointer">
      <div style="position:relative;width:36px;height:36px;flex-shrink:0">
        <div style="width:36px;height:36px;border-radius:50%;background:rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:900;color:var(--accent2)">${(p?.display_name||'?')[0].toUpperCase()}</div>
        ${isOnline ? '<span style="position:absolute;bottom:0;right:0;width:10px;height:10px;border-radius:50%;background:#4ade80;border:2px solid var(--bg);box-shadow:0 0 6px #4ade80"></span>' : ''}
      </div>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:700">${p?.display_name||'Игрок'} ${rank.icon} ${isOnline ? '<span style="font-size:10px;color:#4ade80;font-weight:800">● онлайн</span>' : ''}</div>
        <div style="font-size:11px;color:var(--muted)">${p?.neurons||0} ⚡</div>
      </div>
      ${challengeBtn}
    </div>`;
  }).join('');
}

// ── Presence ping — update last_seen every 60s ─────────────────────
window._startPresencePing =
function _startPresencePing() {
  if (!currentUser) return;
  (async () => { try { await sb.rpc('ping_presence'); } catch(e) {} })();
  setInterval(() => {
    if (currentUser) (async () => { try { await sb.rpc('ping_presence'); } catch(e) {} })();
  }, 60_000);
}
// Called after user is loaded
document.addEventListener('DOMContentLoaded', () => {
  const _checkPresence = setInterval(() => {
    if (window.currentUser || window.sb) {
      clearInterval(_checkPresence);
      if (window.currentUser) _startPresencePing();
    }
  }, 1000);
});

window.addFriendFromProfile = async function(targetId, targetName, btn) {
  if (!currentUser) { toast('Войдите в аккаунт'); return; }
  if (btn) { btn.textContent = '...'; btn.disabled = true; }

  const { error } = await sb.from('friendships')
    .insert({ user_id: currentUser.id, friend_id: targetId });

  if (error && error.code !== '23505') {
    toast('Ошибка: ' + error.message);
    if (btn) { btn.textContent = '👥 Добавить в друзья'; btn.disabled = false; }
    return;
  }

  // Update button
  const wrap = btn?.closest('#opp-friend-btn-wrap, #pub-friend-btn-wrap');
  if (wrap) wrap.innerHTML = `<div style="text-align:center;font-size:13px;color:#4ade80;font-weight:700;padding:10px 0">✅ Добавлен в друзья!</div>`;

  toast('✅ ' + targetName + ' добавлен в друзья!');
  loadFriends();

  // Push notification to the new friend
  const myName = currentUser.user_metadata?.full_name?.split(' ')[0]
    || currentUser.email?.split('@')[0] || 'Игрок';
  if (window.sendPushToUser) {
    window.sendPushToUser(targetId, {
      title: `👥 ${myName} добавил тебя в друзья`,
      body: 'Зайди в Brain Fight Club и вызови на дуэль!',
      url: `/?uid=${currentUser.id}`,
      tag: 'friend-request',
    });
  }
};

window.showAddFriendModal = async function() {
  let modal = document.getElementById('add-friend-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'add-friend-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9990;background:rgba(10,10,20,.85);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:20px;padding:24px;width:100%;max-width:340px">
    <div style="font-size:17px;font-weight:900;margin-bottom:12px">Найти игрока</div>
    <input id="add-friend-input" placeholder="Поиск по имени..."
      oninput="searchFriendUsers(this.value)"
      style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:15px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:8px" />
    <div id="add-friend-results" style="max-height:280px;overflow-y:auto;margin-bottom:6px"></div>
    <div id="add-friend-err" style="font-size:12px;color:var(--red);min-height:16px;margin-bottom:8px"></div>
    <button onclick="document.getElementById('add-friend-modal').remove()" style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
  </div>`;
  modal.style.display = 'flex';

  // Pre-load existing friends
  const resEl = document.getElementById('add-friend-results');
  if (resEl && currentUser) {
    resEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:4px 0">Загружаем...</div>';
    try {
      const { data: friendships } = await sb.from('friendships')
        .select('friend_id, profiles!friendships_friend_id_fkey(id, display_name, city)')
        .eq('user_id', currentUser.id).limit(20);
      if (friendships?.length) {
        const label = '<div style="font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Мои друзья</div>';
        resEl.innerHTML = label + friendships.map(f => {
          const u = f.profiles;
          if (!u) return '';
          return `<div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:var(--bg3);margin-bottom:4px">
            <div style="width:32px;height:32px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#fff;flex-shrink:0">${(u.display_name||'?')[0].toUpperCase()}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:var(--text)">${u.display_name || 'Игрок'}</div>
              ${u.city ? `<div style="font-size:11px;color:var(--muted)">${u.city}</div>` : ''}
            </div>
            <button onclick="submitAddFriend('${u.id}','${(u.display_name||'').replace(/'/g,"\\'")}')"
              style="background:var(--accent);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;flex-shrink:0">
              Выбрать
            </button>
          </div>`;
        }).join('');
      } else {
        resEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:4px 0">Друзей пока нет — найди через поиск</div>';
      }
    } catch(e) { resEl.innerHTML = ''; }
  }

  setTimeout(() => document.getElementById('add-friend-input')?.focus(), 100);
};

let _friendSearchTimer = null;
window.searchFriendUsers = function(query) {
  clearTimeout(_friendSearchTimer);
  const resEl = document.getElementById('add-friend-results');
  const errEl = document.getElementById('add-friend-err');
  if (errEl) errEl.textContent = '';
  if (!query || query.length < 2) { if (resEl) resEl.innerHTML = ''; return; }
  if (resEl) resEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0">Ищем...</div>';
  _friendSearchTimer = setTimeout(async () => {
    const { data } = await sb.from('profiles').select('id,display_name,city')
      .ilike('display_name', `%${query}%`).limit(8);
    if (!resEl) return;
    if (!data?.length) { resEl.innerHTML = '<div style="font-size:12px;color:var(--muted);padding:6px 0">Никого не нашли</div>'; return; }
    resEl.innerHTML = data.map(u => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:10px;background:var(--bg3);margin-bottom:4px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:var(--text)">${u.display_name || 'Игрок'}</div>
          ${u.city ? `<div style="font-size:11px;color:var(--muted)">${u.city}</div>` : ''}
        </div>
        <button onclick="submitAddFriend('${u.id}','${(u.display_name||'').replace(/'/g,"\\'")}')"
          style="background:var(--accent);border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;flex-shrink:0">
          Добавить
        </button>
      </div>`).join('');
  }, 350);
};

window.submitAddFriend = async function(friendId, friendName) {
  const errEl = document.getElementById('add-friend-err');
  if (!friendId) { if(errEl) errEl.textContent = 'Выбери пользователя из списка'; return; }
  if (friendId === currentUser?.id) { if(errEl) errEl.textContent = 'Нельзя добавить себя'; return; }

  const { error } = await sb.from('friendships').insert({ user_id: currentUser.id, friend_id: friendId }).single();
  if (error && error.code !== '23505') { if(errEl) errEl.textContent = 'Ошибка: ' + error.message; return; }

  document.getElementById('add-friend-modal')?.remove();
  window.toast?.('✅ ' + friendName + ' добавлен в друзья!');
  loadFriends();
};

window.challengeFriend = async function(friendId, friendName) {
  if (typeof window.createDuel === 'function') {
    await window.createDuel();
    if (window.sendPushToUser && window._currentDuelCode) {
      window.sendPushToUser(friendId, {
        title: `⚔️ ${window.currentUser?.user_metadata?.full_name || 'Друг'} вызывает на дуэль!`,
        body: 'Зайди в Brain Fight Club и прими вызов!',
        url: '/?duel=' + window._currentDuelCode,
        tag: 'duel-invite',
      });
    }
  }
};

window.loadPendingChallenges = async function() {
  if (!currentUser) return;
  const { data, count } = await sb.from('async_challenges')
    .select('*', { count: 'exact' })
    .eq('challenged_id', currentUser.id)
    .eq('status', 'pending')
    .gt('expires_at', new Date().toISOString());

  const badge = document.getElementById('challenges-badge');
  if (badge) badge.textContent = count > 0 ? count : '';
  if (badge) badge.style.display = count > 0 ? 'flex' : 'none';

  const pendingEl = document.getElementById('pending-challenges');
  if (!pendingEl || !data?.length) return;
  pendingEl.innerHTML = data.map(c => `
    <div style="background:rgba(108,99,255,.1);border:1px solid rgba(108,99,255,.3);border-radius:12px;padding:12px;margin-bottom:8px">
      <div style="font-size:13px;font-weight:700;margin-bottom:4px">⚔️ Тебя вызвали на дуэль!</div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:10px">Истекает через ${_timeUntil(c.expires_at)}</div>
      <button onclick="acceptAsyncChallenge('${c.id}')" style="width:100%;background:var(--accent);border:none;border-radius:10px;padding:10px;font-size:13px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">Принять вызов →</button>
    </div>`).join('');
};

function _timeUntil(isoStr) {
  const ms = new Date(isoStr) - Date.now();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}ч ${m}м` : `${m} мин`;
}

// ══════════════════════════════════════════════════════════
// CLUBS
// ══════════════════════════════════════════════════════════

// showClubScreen is called from the nav button (id="nav-teams")
window.showClubScreen = function() { openClubsScreen(); };

window.openClubsScreen = async function() {
  const screen = document.getElementById('clubs-screen');
  if (!screen) return;
  screen.style.display = 'flex';
  loadClubsList();
  loadMyClub();
};

async function loadClubsList() {
  const el = document.getElementById('clubs-list');
  if (!el) return;
  const { data } = await sb.from('clubs')
    .select('id,name,emoji,description,member_count,total_neurons')
    .order('total_neurons', { ascending: false })
    .limit(20);
  if (!data?.length) { el.innerHTML = '<div style="color:var(--muted);font-size:13px">Клубов ещё нет — создай первый!</div>'; return; }
  el.innerHTML = data.map((c, i) => `
    <div onclick="openClubDetail('${c.id}')" style="display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;cursor:pointer">
      <div style="font-size:28px;width:44px;text-align:center">${c.emoji||'🧠'}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:800">${c.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${c.member_count} участников · ${c.total_neurons.toLocaleString('ru')} ⚡</div>
      </div>
      <div style="font-size:18px;font-weight:900;color:var(--accent2)">#${i+1}</div>
    </div>`).join('');
}

async function loadMyClub() {
  const el = document.getElementById('my-club-section');
  if (!el || !currentUser) return;
  const { data: member } = await sb.from('club_members')
    .select('club_id, clubs(id,name,emoji,member_count,total_neurons)')
    .eq('user_id', currentUser.id).maybeSingle();
  if (!member?.clubs) { el.innerHTML = ''; return; }
  const c = member.clubs;
  el.innerHTML = `
    <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:8px">МОЙ КЛУБ</div>
    <div onclick="openClubDetail('${c.id}')" style="display:flex;align-items:center;gap:12px;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:14px;cursor:pointer;margin-bottom:12px">
      <div style="font-size:28px">${c.emoji||'🧠'}</div>
      <div style="flex:1">
        <div style="font-size:14px;font-weight:800">${c.name}</div>
        <div style="font-size:11px;color:var(--muted);margin-top:2px">${c.member_count} участников · ${c.total_neurons.toLocaleString('ru')} ⚡</div>
      </div>
      <div style="font-size:12px;color:var(--accent2);font-weight:700">→</div>
    </div>`;
  // Update profile subtitle too
  const sub = document.getElementById('profile-club-sub');
  if (sub) sub.textContent = c.name;
}

window.openClubDetail = async function(clubId) {
  const { data: club } = await sb.from('clubs').select('*').eq('id', clubId).single();
  if (!club) return;
  const { data: members } = await sb.from('club_members')
    .select('user_id, role, profiles(display_name, neurons, xp)')
    .eq('club_id', clubId)
    .order('profiles(neurons)', { ascending: false })
    .limit(50);

  const { data: myMembership } = currentUser ? await sb.from('club_members')
    .select('role').eq('club_id', clubId).eq('user_id', currentUser.id).maybeSingle() : { data: null };

  let modal = document.getElementById('club-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'club-detail-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:600;background:var(--bg);overflow-y:auto;display:flex;flex-direction:column';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div style="padding:20px">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <button onclick="document.getElementById('club-detail-modal').remove()" style="background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;padding:0">←</button>
        <div style="font-size:32px">${club.emoji||'🧠'}</div>
        <div>
          <div style="font-size:18px;font-weight:900">${club.name}</div>
          <div style="font-size:12px;color:var(--muted)">${club.member_count} участников</div>
        </div>
      </div>
      ${club.description ? `<div style="font-size:13px;color:var(--muted);margin-bottom:16px;line-height:1.5">${club.description}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:20px">
        <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:var(--accent2)">${club.total_neurons.toLocaleString('ru')}</div>
          <div style="font-size:11px;color:var(--muted)">Нейроны ⚡</div>
        </div>
        <div style="background:rgba(255,255,255,.05);border-radius:12px;padding:12px;text-align:center">
          <div style="font-size:20px;font-weight:900;color:var(--accent2)">${club.member_count}</div>
          <div style="font-size:11px;color:var(--muted)">Участников</div>
        </div>
      </div>
      <button onclick="shareClubLink('${club.id}','${club.name.replace(/'/g,"\\'")}','${club.emoji||'🧠'}')" style="width:100%;background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:12px;font-size:14px;font-weight:700;color:var(--accent2);cursor:pointer;font-family:inherit;margin-bottom:10px">🔗 Поделиться ссылкой</button>
      ${!myMembership && club.member_count < 50 ? `<button onclick="joinClub('${club.id}')" style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:16px">Вступить в клуб</button>` : ''}
      ${myMembership ? `<button onclick="leaveClub('${club.id}')" style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit;margin-bottom:16px">Покинуть клуб</button>` : ''}
      <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--muted);margin-bottom:10px">🏅 УЧАСТНИКИ</div>
      ${(members||[]).map((m, i) => {
        const p = m.profiles;
        const rank = window.getRank ? window.getRank(p?.xp||0) : {icon:'🥉'};
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.04);border-radius:12px;margin-bottom:6px">
          <div style="font-size:14px;font-weight:900;color:var(--muted);width:24px">${i+1}</div>
          <div style="width:36px;height:36px;border-radius:50%;background:rgba(108,99,255,.2);display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:900;color:var(--accent2)">${(p?.display_name||'?')[0].toUpperCase()}</div>
          <div style="flex:1">
            <div style="font-size:13px;font-weight:700">${p?.display_name||'Игрок'} ${rank.icon}</div>
            <div style="font-size:11px;color:var(--muted)">${p?.neurons||0} ⚡</div>
          </div>
          ${m.role==='owner'?'<div style="font-size:11px;color:var(--accent2);font-weight:700">👑</div>':''}
        </div>`;
      }).join('')}
    </div>`;
  modal.style.display = 'flex';
};

window.joinClub = async function(clubId) {
  if (!currentUser) { toast('Войдите чтобы вступить в клуб'); return; }
  const { error } = await sb.from('club_members').insert({ club_id: clubId, user_id: currentUser.id });
  if (error) { toast('Ошибка: ' + error.message); return; }
  await sb.rpc('join_club', { p_club_id: clubId }).catch(() => {});
  toast('✅ Ты в клубе!');
  openClubDetail(clubId);
  loadMyClub();
  loadClubsList();
};

window.leaveClub = async function(clubId) {
  if (!currentUser) return;
  await sb.from('club_members').delete().eq('club_id', clubId).eq('user_id', currentUser.id);
  await sb.rpc('leave_club', { p_club_id: clubId }).catch(() => {});
  toast('Ты покинул клуб');
  document.getElementById('club-detail-modal')?.remove();
  loadMyClub();
  loadClubsList();
};

window.showCreateClubModal = function() {
  let modal = document.getElementById('create-club-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'create-club-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:700;background:rgba(10,10,20,.9);display:flex;align-items:flex-end;justify-content:center';
    modal.onclick = e => { if(e.target===modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px 24px 0 0;padding:24px;width:100%;max-width:480px">
    <div style="font-size:18px;font-weight:900;margin-bottom:16px">Создать клуб</div>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input id="club-emoji-input" value="🧠" maxlength="2"
        style="width:56px;text-align:center;font-size:24px;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:10px;color:var(--text);font-family:inherit;outline:none" />
      <input id="club-name-input" placeholder="Название клуба" maxlength="40"
        style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:14px;color:var(--text);font-family:inherit;outline:none" />
    </div>
    <textarea id="club-desc-input" placeholder="Описание (необязательно)" rows="2" maxlength="200"
      style="width:100%;background:var(--bg3);border:0.5px solid var(--border);border-radius:12px;padding:12px;font-size:13px;color:var(--text);font-family:inherit;outline:none;resize:none;box-sizing:border-box;margin-bottom:12px"></textarea>
    <div id="create-club-err" style="font-size:12px;color:var(--red);min-height:16px;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px">
      <button onclick="document.getElementById('create-club-modal').remove()" style="flex:1;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Отмена</button>
      <button onclick="submitCreateClub()" style="flex:1;background:var(--accent);border:none;border-radius:14px;padding:13px;font-size:14px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">Создать →</button>
    </div>
  </div>`;
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('club-name-input')?.focus(), 100);
};

// Join club via invite link (?join_club=ID)
window.joinClubFromLink = async function(clubId) {
  if (!currentUser) return;
  const { data: club } = await sb.from('clubs').select('id,name,emoji,member_count').eq('id', clubId).maybeSingle();
  if (!club) { toast('Клуб не найден'); return; }
  // Check if already a member
  const { data: existing } = await sb.from('club_members').select('club_id').eq('club_id', clubId).eq('user_id', currentUser.id).maybeSingle();
  if (existing) { window.openClubDetail?.(clubId); return; }

  let modal = document.getElementById('join-club-invite-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'join-club-invite-modal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(10,10,20,.88);display:flex;align-items:center;justify-content:center;padding:20px';
    modal.onclick = e => { if (e.target === modal) modal.remove(); };
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div style="background:var(--bg2);border-radius:24px;padding:28px;width:100%;max-width:320px;text-align:center">
    <div style="font-size:48px;margin-bottom:8px">${club.emoji||'🧠'}</div>
    <div style="font-size:18px;font-weight:900;margin-bottom:4px">${club.name}</div>
    <div style="font-size:13px;color:var(--muted);margin-bottom:20px">${club.member_count} участников</div>
    <button onclick="window.joinClub('${club.id}');document.getElementById('join-club-invite-modal').remove()"
      style="width:100%;background:var(--accent);border:none;border-radius:14px;padding:14px;font-size:15px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit;margin-bottom:10px">
      Вступить в клуб
    </button>
    <button onclick="document.getElementById('join-club-invite-modal').remove()"
      style="width:100%;background:rgba(255,255,255,.07);border:0.5px solid var(--border);border-radius:14px;padding:12px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">
      Не сейчас
    </button>
  </div>`;
  modal.style.display = 'flex';
  // Open clubs screen in background
  window.openClubsScreen?.();
};

window.shareClubLink = function(clubId, name, emoji) {
  const url = window.location.origin + '/?join_club=' + clubId;
  if (navigator.share) {
    navigator.share({ title: emoji + ' ' + name, text: 'Присоединяйся к клубу «' + name + '» в Brain Fight Club!', url });
  } else {
    navigator.clipboard.writeText(url).then(() => toast('🔗 Ссылка скопирована!')).catch(() => toast(url));
  }
};

window.submitCreateClub = async function() {
  const name  = document.getElementById('club-name-input')?.value.trim();
  const emoji = document.getElementById('club-emoji-input')?.value.trim() || '🧠';
  const desc  = document.getElementById('club-desc-input')?.value.trim();
  const errEl = document.getElementById('create-club-err');
  if (!name) { if(errEl) errEl.textContent = 'Введи название'; return; }
  if (!currentUser) { if(errEl) errEl.textContent = 'Нужно войти'; return; }

  const { data: club, error } = await sb.from('clubs').insert({
    name, emoji, description: desc || null, owner_id: currentUser.id
  }).select().single();
  if (error) { if(errEl) errEl.textContent = error.code === '23505' ? 'Такое название уже занято' : error.message; return; }

  await sb.from('club_members').insert({ club_id: club.id, user_id: currentUser.id, role: 'owner' });
  document.getElementById('create-club-modal')?.remove();
  toast('🎉 Клуб «' + name + '» создан!');
  loadClubsList();
  loadMyClub();
  openClubDetail(club.id);
};

// ═══════════════════════════════════════════════════════════════
// GAME CREATOR  (manual question builder)
// ═══════════════════════════════════════════════════════════════

let _gcData      = null;  // loaded game.json
let _gcQCount    = 0;     // total question cards added
let _gcCorrect   = {};    // qi → ai (selected correct option index)
let _gcOptCount  = {};    // qi → number of option rows

const _gcIS = 'background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box;width:100%';

function _gcSlideUrl(n) {
  if (!_gcData || !n) return null;
  const s = _gcData.slides.find(s => s.n === Number(n));
  return s ? s.url : null;
}

function _gcShowLoaded() {
  const loadedEl = document.getElementById('gc-loaded');
  loadedEl.style.display = 'flex';

  // Auto-fill code from folder name
  document.getElementById('gc-code').value =
    (_gcData.folder || '').toUpperCase().replace(/[^A-Z0-9]/g,'');

  // Filmstrip
  const film = document.getElementById('gc-filmstrip');
  film.innerHTML = (_gcData.slides || []).map(s =>
    `<div style="flex-shrink:0;text-align:center">
       <img src="${s.url}" style="height:70px;border-radius:6px;display:block;cursor:pointer"
            onclick="gcFilmClick(${s.n})" title="Слайд ${s.n}">
       <div style="font-size:10px;color:var(--muted);margin-top:2px">${s.n}</div>
     </div>`
  ).join('');

  // Reset questions
  _gcQCount = 0; _gcCorrect = {}; _gcOptCount = {};
  document.getElementById('gc-questions').innerHTML = '';
}

window.gcFilmClick = function(n) {
  toast(`Слайд ${n} — введи номер в поле вопроса`);
};

window.gcSaveDraft = function() {
  if (!_gcData) return;
  const questions = [];
  for (let qi = 0; qi < _gcQCount; qi++) {
    if (!document.getElementById(`gc-q-${qi}`)) continue;
    const opts = [];
    for (let ai = 0; ai < (_gcOptCount[qi] || 4); ai++) {
      opts.push(document.getElementById(`gc-opt-txt-${qi}-${ai}`)?.value || '');
    }
    questions.push({
      sq: document.getElementById(`gc-sq-${qi}`)?.value || '',
      sa: document.getElementById(`gc-sa-${qi}`)?.value || '',
      text: document.getElementById(`gc-qtxt-${qi}`)?.value || '',
      media: document.getElementById(`gc-media-${qi}`)?.value || '',
      opts,
      correct: _gcCorrect[qi],
    });
  }
  const draft = {
    jsonUrl: document.getElementById('gc-json-url')?.value || '',
    gameData: _gcData,
    name: document.getElementById('gc-name')?.value || '',
    code: document.getElementById('gc-code')?.value || '',
    type: document.getElementById('gc-type')?.value || 'pack',
    time: document.getElementById('gc-time')?.value || '20',
    questions,
    savedAt: Date.now(),
  };
  localStorage.setItem('gc_draft', JSON.stringify(draft));
  toast('💾 Черновик сохранён');
};

window.gcLoadDraft = function() {
  const raw = localStorage.getItem('gc_draft');
  if (!raw) { toast('Нет сохранённого черновика'); return; }
  const draft = JSON.parse(raw);
  _gcData = draft.gameData;
  _gcShowLoaded();
  // Restore meta
  if (draft.name) document.getElementById('gc-name').value = draft.name;
  if (draft.code) document.getElementById('gc-code').value = draft.code;
  if (draft.type) document.getElementById('gc-type').value = draft.type;
  if (draft.time) document.getElementById('gc-time').value = draft.time;
  if (draft.jsonUrl) document.getElementById('gc-json-url').value = draft.jsonUrl;
  // Restore questions in reverse order (they insert at top)
  const qs = draft.questions || [];
  for (let i = qs.length - 1; i >= 0; i--) {
    const q = qs[i];
    gcAddQuestion();
    const qi = _gcQCount - 1;
    // fill in values after DOM is ready
    setTimeout(((qi, q) => () => {
      if (q.sq) { document.getElementById(`gc-sq-${qi}`).value = q.sq; gcUpdatePreview(qi,'q'); }
      if (q.sa) { document.getElementById(`gc-sa-${qi}`).value = q.sa; gcUpdatePreview(qi,'a'); }
      if (q.text) document.getElementById(`gc-qtxt-${qi}`).value = q.text;
      if (q.media) { const s = document.getElementById(`gc-media-${qi}`); if(s) s.value = q.media; }
      // fill options
      q.opts.forEach((opt, ai) => {
        let el = document.getElementById(`gc-opt-txt-${qi}-${ai}`);
        if (!el) { gcAddOption(qi); el = document.getElementById(`gc-opt-txt-${qi}-${ai}`); }
        if (el && opt) el.value = opt;
      });
      // set correct
      if (q.correct !== null && q.correct !== undefined) gcSelectCorrect(qi, q.correct);
    })(qi, q), 0);
  }
  const d = new Date(draft.savedAt);
  toast(`✅ Черновик восстановлен (сохранён в ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')})`);
};

window.gcAddQuestion = function() {
  const qi = _gcQCount++;
  _gcCorrect[qi] = null;
  _gcOptCount[qi] = 4;

  const mediaOpts = (_gcData.media || []).map(m =>
    `<option value="${m.url}">${m.name}</option>`).join('');

  const card = document.createElement('div');
  card.id = `gc-q-${qi}`;
  card.style.cssText = 'background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;padding:14px';
  card.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;cursor:pointer" onclick="gcToggleQuestion(${qi})">
        <span id="gc-toggle-${qi}" style="font-size:13px;color:var(--muted);user-select:none">▾</span>
        <div style="font-size:11px;font-weight:800;color:var(--muted)">ВОПРОС ${qi+1}</div>
        <span id="gc-summary-${qi}" style="font-size:11px;color:var(--muted)"></span>
      </div>
      <button onclick="gcRemoveQuestion(${qi})" style="background:none;border:none;color:var(--muted);cursor:pointer;font-size:18px;line-height:1;padding:0">×</button>
    </div>
    <div id="gc-body-${qi}">

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Слайд вопроса #</div>
        <input type="number" id="gc-sq-${qi}" min="1" placeholder="№"
          oninput="gcUpdatePreview(${qi},'q')" style="${_gcIS}">
        <img id="gc-sq-img-${qi}" style="width:100%;border-radius:6px;margin-top:6px;display:none">
      </div>
      <div>
        <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Слайд ответа #</div>
        <input type="number" id="gc-sa-${qi}" min="1" placeholder="№"
          oninput="gcUpdatePreview(${qi},'a')" style="${_gcIS}">
        <img id="gc-sa-img-${qi}" style="width:100%;border-radius:6px;margin-top:6px;display:none">
      </div>
    </div>

    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Текст вопроса (необязательно)</div>
      <input type="text" id="gc-qtxt-${qi}" placeholder="Текст вопроса..." style="${_gcIS}">
    </div>

    <div style="margin-bottom:10px">
      <div style="font-size:11px;color:var(--muted);margin-bottom:6px">Варианты — нажми ◯ рядом с правильным</div>
      <div id="gc-opts-${qi}" style="display:flex;flex-direction:column;gap:5px">
        ${[0,1,2,3].map(ai => _gcOptRow(qi,ai)).join('')}
      </div>
      <button onclick="gcAddOption(${qi})" style="margin-top:6px;background:none;border:0.5px solid var(--border);border-radius:8px;padding:5px 12px;font-size:12px;color:var(--muted);cursor:pointer;font-family:inherit">+ ещё вариант</button>
    </div>

    ${mediaOpts ? `<div>
      <div style="font-size:11px;color:var(--muted);margin-bottom:4px">Медиа (опционально)</div>
      <select id="gc-media-${qi}" style="${_gcIS}">
        <option value="">Без медиа</option>${mediaOpts}
      </select>
    </div>` : ''}
  </div>`;
  const container = document.getElementById('gc-questions');
  container.insertBefore(card, container.firstChild);
};

window.gcToggleQuestion = function(qi) {
  const body = document.getElementById(`gc-body-${qi}`);
  const arrow = document.getElementById(`gc-toggle-${qi}`);
  if (!body) return;
  const collapsed = body.style.display === 'none';
  body.style.display = collapsed ? '' : 'none';
  arrow.textContent = collapsed ? '▾' : '▸';
  // Update summary when collapsing
  if (!collapsed) {
    const sqN = document.getElementById(`gc-sq-${qi}`)?.value;
    const saN = document.getElementById(`gc-sa-${qi}`)?.value;
    const correctAi = _gcCorrect[qi];
    const correctTxt = correctAi !== null
      ? document.getElementById(`gc-opt-txt-${qi}-${correctAi}`)?.value?.trim()
      : null;
    const summary = document.getElementById(`gc-summary-${qi}`);
    if (summary) {
      const parts = [];
      if (sqN) parts.push(`слайды ${sqN}→${saN || '?'}`);
      if (correctTxt) parts.push(`✅ ${correctTxt}`);
      summary.textContent = parts.length ? '· ' + parts.join(' · ') : '';
    }
  } else {
    const summary = document.getElementById(`gc-summary-${qi}`);
    if (summary) summary.textContent = '';
  }
};

function _gcOptRow(qi, ai) {
  return `<div style="display:flex;gap:6px;align-items:center" id="gc-opt-row-${qi}-${ai}">
    <button onclick="gcSelectCorrect(${qi},${ai})" id="gc-correct-${qi}-${ai}"
      style="width:28px;height:28px;flex-shrink:0;border-radius:50%;border:2px solid var(--border);background:none;cursor:pointer;font-size:15px;display:flex;align-items:center;justify-content:center;transition:all .15s">◯</button>
    <input type="text" id="gc-opt-txt-${qi}-${ai}" placeholder="Вариант ${ai+1}"
      style="flex:1;background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:7px 10px;font-size:13px;color:var(--text);font-family:inherit;outline:none">
  </div>`;
}

window.gcUpdatePreview = function(qi, type) {
  const n = document.getElementById(`gc-s${type}-${qi}`)?.value;
  const img = document.getElementById(`gc-s${type}-img-${qi}`);
  if (!img) return;
  const url = _gcSlideUrl(n);
  if (url) { img.src = url; img.style.display = ''; }
  else      { img.style.display = 'none'; }
};

window.gcSelectCorrect = function(qi, ai) {
  _gcCorrect[qi] = ai;
  const count = _gcOptCount[qi] || 4;
  for (let i = 0; i < count; i++) {
    const btn = document.getElementById(`gc-correct-${qi}-${i}`);
    if (!btn) continue;
    const sel = i === ai;
    btn.textContent = sel ? '✅' : '◯';
    btn.style.border = `2px solid ${sel ? 'var(--green)' : 'var(--border)'}`;
  }
};

window.gcAddOption = function(qi) {
  const ai = _gcOptCount[qi]++;
  if (ai >= 8) return;
  const container = document.getElementById(`gc-opts-${qi}`);
  if (!container) return;
  container.insertAdjacentHTML('beforeend', _gcOptRow(qi, ai));
};

window.gcRemoveQuestion = function(qi) {
  document.getElementById(`gc-q-${qi}`)?.remove();
};

window.gcExportJson = function() {
  if (!_gcData) { toast('Сначала загрузи game.json'); return; }
  const time = parseInt(document.getElementById('gc-time')?.value) || 20;
  const questions = _gcCollectQuestions(time);
  const blob = new Blob([JSON.stringify(questions, null, 2)], {type: 'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (document.getElementById('gc-code')?.value || 'game') + '_questions.json';
  a.click();
  toast('✅ Скачан файл — запусти publish_game.py');
};

window.gcLoadFromUrl = async function() {
  const url = document.getElementById('gc-json-url').value.trim();
  if (!url) return;
  try {
    const res = await fetch(url);
    _gcData = await res.json();
    _gcShowLoaded();
    toast('✅ game.json загружен — ' + (_gcData.slides||[]).length + ' слайдов');
  } catch(e) { toast('❌ ' + e.message); }
};

window.gcLoadFromFile = function(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      _gcData = JSON.parse(e.target.result);
      _gcShowLoaded();
      const qs = _gcData.questions || [];
      if (qs.length) {
        for (let i = 0; i < qs.length; i++) {
          const q = qs[i];
          gcAddQuestion();
          const qi = _gcQCount - 1;
          setTimeout(((qi, q) => () => {
            if (q.sq) { document.getElementById(`gc-sq-${qi}`).value = q.sq; gcUpdatePreview(qi,'q'); }
            if (q.sa) { document.getElementById(`gc-sa-${qi}`).value = q.sa; gcUpdatePreview(qi,'a'); }
            if (q.text) document.getElementById(`gc-qtxt-${qi}`).value = q.text;
            if (q.media) { const s = document.getElementById(`gc-media-${qi}`); if(s) s.value = q.media; }
            (q.opts||[]).forEach((opt, ai) => {
              let el = document.getElementById(`gc-opt-txt-${qi}-${ai}`);
              if (!el) { gcAddOption(qi); el = document.getElementById(`gc-opt-txt-${qi}-${ai}`); }
              if (el && opt) el.value = opt;
            });
            if (q.correct !== null && q.correct !== undefined) gcSelectCorrect(qi, q.correct);
            if (q.question_type === 'info') {
              // hide options block: gc-opts is inside a wrapper div
              const optsEl = document.getElementById(`gc-opts-${qi}`);
              if (optsEl) {
                let wrap = optsEl.parentElement;
                if (wrap) wrap.style.display = 'none';
              }
              // also hide the correct-answer label
              const bodyEl = document.getElementById(`gc-body-${qi}`);
              if (bodyEl) {
                const labels = bodyEl.querySelectorAll('[style*="margin-bottom:10px"]');
                labels.forEach(el => { if (el.querySelector(`#gc-opts-${qi}`)) el.style.display = 'none'; });
              }
            }
          })(qi, q), 0);
        }
        toast('✅ Файл загружен — ' + (_gcData.slides||[]).length + ' слайдов, ' + qs.length + ' вопросов');
      } else {
        toast('✅ Файл загружен — ' + (_gcData.slides||[]).length + ' слайдов');
      }
    } catch { toast('❌ Неверный JSON'); }
  };
  reader.readAsText(file);
};

function _gcCollectQuestions() {
  const questions = [];
  for (let qi = 0; qi < _gcQCount; qi++) {
    if (!document.getElementById(`gc-q-${qi}`)) continue; // removed

    const sqN    = parseInt(document.getElementById(`gc-sq-${qi}`)?.value) || null;
    const saN    = parseInt(document.getElementById(`gc-sa-${qi}`)?.value) || null;
    const text   = document.getElementById(`gc-qtxt-${qi}`)?.value.trim() || '';
    const media  = document.getElementById(`gc-media-${qi}`)?.value || '';
    const correctAi = _gcCorrect[qi];

    // Collect non-empty options
    const opts = [];
    const rawIndices = [];
    for (let ai = 0; ai < (_gcOptCount[qi] || 4); ai++) {
      const v = document.getElementById(`gc-opt-txt-${qi}-${ai}`)?.value.trim();
      if (v) { opts.push(v); rawIndices.push(ai); }
    }

    // Map correctAi to filtered index
    const correct = correctAi !== null ? rawIndices.indexOf(correctAi) : null;

    // Info slide = no answer options
    const isInfo = opts.length === 0;
    // Time per question based on number of options (scheme: 2→30s, 3→35s, 4→40s, 5→45s, 6→50s)
    const t = isInfo ? 0 : Math.max(30, 25 + opts.length * 5);

    const mediaName = media ? media.split('/').pop() : '';
    const isAudio = mediaName.endsWith('.mp3') || mediaName.endsWith('.wav');
    const isVideo = mediaName.endsWith('.mp4') || mediaName.endsWith('.webm');
    questions.push({
      n: questions.length + 1,
      question_text: text,
      answers: opts,
      correct: isInfo ? 0 : (correct >= 0 ? correct : null),
      slide_q_url: _gcSlideUrl(sqN),
      slide_a_url: _gcSlideUrl(saN),
      audio: isAudio ? media : null,
      video: isVideo ? media : null,
      question_type: isInfo ? 'info' : 'multiple_choice',
      t,
    });
  }
  return questions;
}

window.gcPublish = async function() {
  if (!_gcData) return;
  const name     = document.getElementById('gc-name').value.trim();
  const code     = document.getElementById('gc-code').value.trim().toUpperCase();
  const type     = document.getElementById('gc-type').value;
  const statusEl = document.getElementById('gc-publish-status');

  if (!name) { toast('Введи название'); return; }
  if (!code) { toast('Введи код'); return; }

  const questions = _gcCollectQuestions();
  if (!questions.length) { toast('Нет вопросов'); return; }

  const real = questions.filter(q => q.question_type !== 'info');
  const noCorrect = real.filter(q => q.correct === null || q.correct === undefined);
  if (noCorrect.length) { toast(`⚠️ Не выбран правильный ответ у ${noCorrect.length} вопросов`); return; }
  const noOptions = real.filter(q => !q.answers.length);
  if (noOptions.length) { toast(`⚠️ Нет вариантов у ${noOptions.length} вопросов`); return; }

  statusEl.textContent = '⏳ Публикация...';

  // Use service key to bypass RLS (admin-only operation)
  const SB_URL = window._supabaseUrl;
  const SB_SVC = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5obWlkeGtvaGpwY25oanVjdXVoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3OTMzNzI3NSwiZXhwIjoyMDk0OTEzMjc1fQ.7KMc9cTJj9PfJFbMS0JUJTOY_QF5hhcrJo-72oV1mOo';
  const H = { 'apikey': SB_SVC, 'Authorization': 'Bearer ' + SB_SVC, 'Content-Type': 'application/json', 'Prefer': 'return=representation' };

  const post = async (table, body, extra='') => {
    const r = await fetch(`${SB_URL}/rest/v1/${table}${extra}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.message || d.error || JSON.stringify(d));
    return Array.isArray(d) ? d[0] : d;
  };
  const del = async (table, filter) => {
    await fetch(`${SB_URL}/rest/v1/${table}?${filter}`, { method: 'DELETE', headers: H });
  };

  try {
    if (type === 'tournament') {
      const t = await post('official_tournaments', { name, code, status: 'lobby', sync_mode: false, is_private: false });
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qRow = await post('questions', {
          question_text: q.question_text || `Вопрос ${i+1}`,
          question_ru: q.question_text || `Вопрос ${i+1}`,
          answers_json: q.answers, correct_index: q.correct,
          slide_img_url: q.slide_q_url || null,
          answer_slide_img_url: q.slide_a_url || null,
          audio_url: q.audio || null, video_url: q.video || null,
          media_type: q.audio ? 'audio' : q.video ? 'video' : q.slide_q_url ? 'image' : 'text',
          question_type: q.question_type || 'multiple_choice',
          category: 'general', language: 'ru', status: 'published',
        });
        await post('official_tournament_questions', { tournament_id: t.id, question_id: qRow.id, order_index: i + 1 });
      }
      statusEl.textContent = `✅ Турнир «${name}» создан! Код: ${code}`;
      toast(`🎮 Турнир создан: ${code}`);

    } else {
      // Upsert pack via PATCH if exists, POST if new
      const upsertH = { ...H, 'Prefer': 'return=representation,resolution=merge-duplicates' };
      const pr = await fetch(`${SB_URL}/rest/v1/game_packs?on_conflict=import_key`, {
        method: 'POST', headers: upsertH,
        body: JSON.stringify({ title_ru: name, import_key: code.toLowerCase(), status: 'published', pack_type: 'standard', source_type: 'official_pack' })
      });
      const pd = await pr.json();
      if (!pr.ok) throw new Error((Array.isArray(pd) ? pd[0] : pd).message || JSON.stringify(pd));
      const packRow = Array.isArray(pd) ? pd[0] : pd;
      const packId = packRow.id;

      await del('game_pack_questions', `game_pack_id=eq.${packId}`);

      for (let i = 0; i < questions.length; i++) {
        const q = questions[i];
        const qRow = await post('questions', {
          question_text: q.question_text || `Вопрос ${i+1}`,
          question_ru: q.question_text || `Вопрос ${i+1}`,
          answers_json: q.answers, correct_index: q.correct,
          slide_img_url: q.slide_q_url || null,
          answer_slide_img_url: q.slide_a_url || null,
          audio_url: q.audio || null, video_url: q.video || null,
          media_type: q.audio ? 'audio' : q.video ? 'video' : q.slide_q_url ? 'image' : 'text',
          question_type: q.question_type || 'multiple_choice',
          category: 'general', language: 'ru', status: 'published', source_type: 'official_pack',
        });
        await post('game_pack_questions', { game_pack_id: packId, question_id: qRow.id, position: i + 1 });
      }
      statusEl.innerHTML = `✅ Пак «${name}» опубликован!<br><span style="font-size:11px;color:var(--muted)">ID: ${packId} · ${questions.length} слайдов</span>`;
      toast(`✅ Пак «${name}» опубликован`);
    }
  } catch(err) {
    statusEl.textContent = '❌ ' + err.message;
    toast('❌ ' + err.message);
  }
};
