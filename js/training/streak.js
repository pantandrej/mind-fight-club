// ── Streak System ─────────────────────────────────────────────────
// Streak is credited only after completing a full daily training session.
// Milestones award neurons (NOT XP — XP reflects gameplay, not attendance).
//
// Rewards per config.js STREAK_REWARDS:
//   3 days: +20 neurons
//   7 days: +50 neurons
//  14 days: +75 neurons
//  30 days: +150 neurons
//  Every 7 days after 30: +50 neurons
//
// UI reminder text (for daily-limit screen and home):
//   "Заверши сегодняшние 10 вопросов, чтобы сохранить серию."
//   "За 3, 7, 14 и 30 дней подряд ты получаешь бонусные нейроны."

// DAILY STREAK SYSTEM
// ═══════════════════════════════════════════

// Local streak state (mirrors DB)
let _dailyStreak = 0;
let _bestDailyStreak = 0;
let _lastQuickPlayDate = null;
let _streakPlayedToday = false;

function getTodayDateKey(){
  return new Date().toISOString().slice(0,10); // YYYY-MM-DD UTC
}
function getYesterdayDateKey(){
  const d = new Date();
  d.setUTCDate(d.getUTCDate()-1);
  return d.toISOString().slice(0,10);
}

// ═══════════════════════════════════════════
// STREAK FREEZE — 30 ⚡ protection
// TODO (post-MVP): persist freeze in Supabase (profiles.streak_freeze_active
// or user_powerups table) so the economy is server-authoritative.
// Currently stored in localStorage only — can be tampered with by the user.
// Safe for demo/testing but not for real economy before server-side check.
// ═══════════════════════════════════════════
const STREAK_FREEZE_KEY   = 'mfc_streak_freeze_v1';
const STREAK_FREEZE_PRICE = 150;

function getStreakFreeze(){
  try{
    const raw = localStorage.getItem(STREAK_FREEZE_KEY);
    if(!raw) return null;
    const d = JSON.parse(raw);
    // Freeze is valid for 30 days from purchase
    if(new Date(d.expires_at) < new Date()) return null;
    return d;
  }catch(e){ return null; }
}

function hasStreakFreeze(){ return !!getStreakFreeze(); }

async function buyStreakFreeze(){
  if(!currentUser){
    toast(lang==='ru'?'🔐 Войдите чтобы купить заморозку':'🔐 Sign in to buy freeze'); return;
  }
  // Check existing freeze from server profile
  const { neurons: curNeurons, streak_freezes: freezes } = await _getStreakProfile();
  if(freezes > 0){
    toast(lang==='ru'?'❄️ Заморозка уже есть в запасе!':'❄️ You already have a freeze!'); return;
  }
  if((curNeurons ?? neurons) < STREAK_FREEZE_PRICE){
    toast(lang==='ru'
      ? `Не хватает нейронов (нужно ${STREAK_FREEZE_PRICE} ⚡)`
      : `Not enough neurons (need ${STREAK_FREEZE_PRICE} ⚡)`);
    return;
  }
  // Use server RPC (atomic spend + increment streak_freezes)
  const { data, error } = await sb.rpc('buy_streak_freeze');
  if(error || !data?.ok){
    const reason = data?.reason || error?.message || '';
    if(reason === 'insufficient') toast(lang==='ru'?'❌ Недостаточно нейронов':'❌ Not enough neurons');
    else toast(lang==='ru'?'❌ Ошибка покупки заморозки':'❌ Purchase failed');
    return;
  }
  // Sync local balance from server response
  if(typeof window.setState === 'function') window.setState({ neurons: data.neurons, xp: data.xp });
  if(typeof window.updNeurons === 'function') window.updNeurons();
  track('streak_freeze_purchased', { price: STREAK_FREEZE_PRICE });
  toast(lang==='ru'
    ? `❄️ Заморозка куплена! (-${STREAK_FREEZE_PRICE} ⚡)`
    : `❄️ Streak freeze bought! (-${STREAK_FREEZE_PRICE} ⚡)`, 4000);
  renderDailyStreakUI();
}

async function _getStreakProfile(){
  if(!currentUser) return {};
  try{
    const { data } = await sb.from('profiles')
      .select('neurons, xp, streak_freezes')
      .eq('id', currentUser.id).single();
    return data || {};
  }catch(e){ return {}; }
}

function consumeStreakFreezeIfNeeded(lastPlayDate, today, yesterday){
  // Legacy localStorage freeze — kept for backward compat with users who bought before server RPC
  if(lastPlayDate && lastPlayDate < yesterday && lastPlayDate !== today){
    const freeze = getStreakFreeze(); // localStorage check
    if(freeze){
      localStorage.removeItem(STREAK_FREEZE_KEY);
      track('streak_freeze_used', { source: 'local' });
      toast(lang==='ru'
        ? '❄️ Заморозка использована — серия сохранена!'
        : '❄️ Freeze used — streak preserved!', 3500);
      return true;
    }
  }
  return false;
  // Note: server-side freeze is now handled by record_daily_activity() RPC
  // which auto-applies streak_freezes from profiles table
}

async function loadDailyStreakData(){
  // Always try localStorage first as fast path / guest fallback
  try {
    const cached = localStorage.getItem('mfc_streak');
    if(cached){
      const c = JSON.parse(cached);
      if(c.streak > 0 || c.date){
        _dailyStreak       = c.streak || 0;
        _bestDailyStreak   = Math.max(_bestDailyStreak, c.best || 0);
        _lastQuickPlayDate = c.date || null;
        _streakPlayedToday = (_lastQuickPlayDate === getTodayDateKey());
      }
    }
  }catch(e){}

  if(!currentUser){ renderDailyStreakUI(); return; }
  try{
    const {data} = await sb.from('profiles')
      .select('daily_streak,best_daily_streak,streak_last_date')
      .eq('id', currentUser.id).single();
    if(data){
      // Use DB value but only if it's >= local (prevents regression on race)
      const dbStreak = data.daily_streak || 0;
      const dbDate   = data.streak_last_date || null;
      if(dbStreak >= _dailyStreak || dbDate > (_lastQuickPlayDate||'')){
        _dailyStreak       = dbStreak;
        _bestDailyStreak   = data.best_daily_streak || 0;
        _lastQuickPlayDate = dbDate; // streak_last_date from DB
        const today        = getTodayDateKey();
        _streakPlayedToday = (_lastQuickPlayDate === today);
      }
    }
  }catch(e){ /* profiles may not have streak columns yet — silent */ }
  renderDailyStreakUI();
  scheduleDailyStreakReminder();
}

async function updateDailyStreakOnQuickPlayComplete(){
  const today     = getTodayDateKey();
  const yesterday = getYesterdayDateKey();

  // Guard: only Quick Play in main quiz screen
  const wasQuickPlay = (_gameId !== null); // game created means it was a real game

  if(_lastQuickPlayDate === today){
    // Already counted today — silent, no celebration popup again
    return;
  }

  let newStreak;
  if(!_lastQuickPlayDate){
    newStreak = 1; // first ever
  } else if(_lastQuickPlayDate === yesterday){
    newStreak = _dailyStreak + 1; // consecutive
  } else if(_lastQuickPlayDate < yesterday){
    // Missed a day — check if freeze saves it
    const freezeSaved = consumeStreakFreezeIfNeeded(_lastQuickPlayDate, today, yesterday);
    newStreak = freezeSaved ? _dailyStreak + 1 : 1;
  } else {
    newStreak = _dailyStreak || 1; // already played today somehow
  }

  const newBest   = Math.max(_bestDailyStreak, newStreak);
  const isRecord  = newStreak > _bestDailyStreak && newStreak > 1;
  const wasAlready = (_lastQuickPlayDate === today);

  _dailyStreak       = newStreak;
  _bestDailyStreak   = newBest;
  _lastQuickPlayDate = today;
  _streakPlayedToday = true;

  // Save to DB — always write the locally-calculated value first (direct update),
  // then call RPC for milestone bonuses and freeze handling.
  // We don't trust RPC streak value because DB may have stale/null starting state.
  if(currentUser){
    try{
      // Direct update: always authoritative based on local state
      await sb.from('profiles').update({
        daily_streak: newStreak,
        best_daily_streak: newBest,
        streak_last_date: today
      }).eq('id', currentUser.id);

      // Call RPC for milestones + freeze side-effects only (ignore its streak value)
      const { data: rpcData } = await sb.rpc('record_daily_activity');
      if(rpcData?.freeze_used){
        toast(lang==='ru'?'❄️ Заморозка сработала — серия сохранена!':'❄️ Freeze used — streak saved!', 3000);
      }
      if(rpcData?.milestone){
        const bonuses = {7:50, 30:200, 100:500};
        const b = bonuses[rpcData.milestone] || '';
        const msg = lang==='ru'
          ? `🔥 ${rpcData.milestone} дней подряд! +${b} ⚡ нейронов`
          : `🔥 ${rpcData.milestone}-day streak! +${b} ⚡ neurons`;
        setTimeout(()=>toast(msg, 5000), 1500);
      }
    }catch(e){ console.warn('[MFC] streak save error:', e.message); }
  }
  // Cache locally
  localStorage.setItem('mfc_streak', JSON.stringify({streak:newStreak,best:newBest,date:today}));

  renderDailyStreakUI();
  showStreakCelebration(newStreak, isRecord);
}

function renderDailyStreakUI(){
  const card   = document.getElementById('home-streak-card');
  const valEl  = document.getElementById('home-streak-value');
  const subEl  = document.getElementById('home-streak-sub');
  if(card) {
    if(_dailyStreak > 0){
      card.style.display = 'flex';
      if(valEl) valEl.textContent  = '🔥 ' + _dailyStreak + (lang==='ru'?' дн.':' days');
      const today2     = getTodayDateKey();
      const doneToday2 = (_lastQuickPlayDate === today2);
      const hasFrz2    = hasStreakFreeze();
      if(subEl) subEl.innerHTML = doneToday2
        ? (lang==='ru'?'✅ Серия сохранена сегодня':'✅ Streak saved today')
        : hasFrz2
          ? (lang==='ru'?'❄️ Заморозка активна — серия защищена':'❄️ Freeze active — streak protected')
          : `${lang==='ru'?'Сыграй Quick Play чтобы продолжить · ':'Play Quick Play to continue · '}<span style="color:var(--accent2);cursor:pointer;font-weight:800" onclick="buyStreakFreeze()">❄️ Заморозить за ${STREAK_FREEZE_PRICE}⚡</span>`;
    } else {
      card.style.display = 'none';
    }
  }

  // ── New Duolingo-style streak widget ──
  const widget = document.getElementById('home-streak-widget');
  if(!widget) return;
  const today      = getTodayDateKey();
  const doneToday  = (_lastQuickPlayDate === today);
  const hasFrz     = hasStreakFreeze();
  const streak     = _dailyStreak || 0;

  // Badge count
  const badge = document.getElementById('home-streak-badge');
  if(badge) badge.textContent = streak;

  // Flame animation when active
  const flame = document.getElementById('home-streak-flame');
  if(flame) flame.style.filter = streak > 0
    ? 'drop-shadow(0 2px 12px rgba(240,150,0,.7))'
    : 'grayscale(1) opacity(0.4)';

  // Title
  const title = document.getElementById('home-streak-title');
  if(title) {
    if(streak === 0) title.textContent = lang==='ru'?'Начни серию сегодня 🔥':'Start your streak today 🔥';
    else if(doneToday) title.textContent = lang==='ru'?`Серия: ${streak} ${_daysWord(streak)} ✅`:`${streak}-day streak ✅`;
    else title.textContent = lang==='ru'?`Серия: ${streak} ${_daysWord(streak)} 🔥`:`${streak}-day streak 🔥`;
  }

  // Sub
  const sub = document.getElementById('home-streak-sub');
  if(sub) {
    if(doneToday) sub.textContent = lang==='ru'?'Отлично! Заходи завтра чтобы не прерывать.':'Great! Come back tomorrow to keep it going.';
    else if(hasFrz) sub.innerHTML = lang==='ru'?'❄️ Заморозка активна — серия защищена':'❄️ Freeze active — streak protected';
    else if(streak > 0) sub.textContent = lang==='ru'?'Сыграй сегодня, чтобы не потерять серию!':'Play today to keep your streak alive!';
    else sub.textContent = lang==='ru'?'Играй каждый день — не прерывай серию!':'Play every day — don\'t break the chain!';
  }

  // Week dots (Mon–Sun)
  const dotsEl = document.getElementById('home-streak-dots');
  if(dotsEl) {
    const now = new Date();
    const dayOfWeek = (now.getDay() + 6) % 7; // 0=Mon
    dotsEl.innerHTML = '';
    const days = lang==='ru'
      ? ['Пн','Вт','Ср','Чт','Пт','Сб','Вс']
      : ['Mo','Tu','We','Th','Fr','Sa','Su'];
    for(let i = 0; i <= dayOfWeek; i++){
      const isPast = i < dayOfWeek;
      const isToday = i === dayOfWeek;
      // Estimate: if streak covers this day
      const daysAgo = dayOfWeek - i;
      const active = (doneToday && daysAgo === 0) || (streak > daysAgo && daysAgo > 0);
      const dot = document.createElement('div');
      dot.style.cssText = `display:flex;flex-direction:column;align-items:center;gap:3px`;
      dot.innerHTML = `
        <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;
          ${active ? 'background:var(--gold);box-shadow:0 2px 8px rgba(240,150,0,.4)' :
            isToday && !doneToday ? 'background:rgba(240,192,64,.15);border:2px dashed var(--gold)' :
            'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)'
          }">${active ? '🔥' : isToday ? '⬜' : '·'}</div>
        <div style="font-size:9px;color:var(--muted);font-weight:700">${days[i]}</div>
      `;
      dotsEl.appendChild(dot);
    }
  }
}

function _daysWord(n){
  if(n % 10 === 1 && n % 100 !== 11) return 'день';
  if([2,3,4].includes(n%10) && ![12,13,14].includes(n%100)) return 'дня';
  return 'дней';
}

function showStreakCelebration(streakCount, isRecord){
  // Remove any existing
  document.getElementById('streak-modal-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id    = 'streak-modal-overlay';
  overlay.className = 'streak-modal-overlay';
  overlay.onclick = e=>{ if(e.target===overlay) overlay.remove(); };

  let icon, title, sub;
  if(isRecord){
    icon  = '🏆';
    title = lang==='ru'?`Новый рекорд: ${streakCount} дней!`:`New streak record: ${streakCount} days!`;
    sub   = lang==='ru'?'Невероятно! Ты побил свой рекорд серии.':'Incredible! You broke your streak record.';
  } else if(streakCount === 1){
    icon  = '🔥';
    title = lang==='ru'?'День засчитан!':'Day counted!';
    sub   = lang==='ru'?'Серия началась. Возвращайся завтра!':'Your streak starts now. Come back tomorrow!';
  } else {
    icon  = '🔥';
    title = lang==='ru'?`🔥 Серия: ${streakCount} дней`:`🔥 Streak: ${streakCount} days`;
    sub   = lang==='ru'?'Отличная игра! Продолжай в том же духе.':'Great game! Keep it up.';
  }

  overlay.innerHTML = `<div class="streak-modal">
    <div class="streak-modal-icon">${icon}</div>
    <div class="streak-modal-title">${title}</div>
    <div class="streak-modal-sub">${sub}</div>
    <button class="streak-modal-btn" onclick="document.getElementById('streak-modal-overlay').remove()">
      ${lang==='ru'?'Отлично! 🎉':'Awesome! 🎉'}
    </button>
  </div>`;

  document.body.appendChild(overlay);
  setTimeout(()=>overlay.remove(), 6000);
}

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

function startObDemo(){
  _obQIdx = 0; _obScore = 0; _obAnswered = false;
  document.getElementById('ob-slide-welcome').style.display = 'none';
  document.getElementById('ob-slide-demo').style.display = '';
  document.getElementById('ob-slide-result').style.display = 'none';
  renderObQuestion();
}

function renderObQuestion(){
  _obAnswered = false;
  const q = OB_DEMO_QUESTIONS[_obQIdx];
  document.getElementById('ob-q-num').textContent = _obQIdx + 1;
  document.getElementById('ob-q-text').textContent = q.emoji + ' ' + q.q;
  document.getElementById('ob-feedback').style.display = 'none';
  document.getElementById('ob-next-q-btn').style.display = 'none';

  const container = document.getElementById('ob-answers');
  container.innerHTML = '';
  q.a.forEach((ans, i) => {
    const btn = document.createElement('button');
    btn.style.cssText = 'width:100%;padding:13px 16px;border-radius:12px;border:1.5px solid rgba(108,99,255,.35);background:rgba(108,99,255,.08);font-size:14px;font-weight:600;color:var(--text);cursor:pointer;font-family:inherit;text-align:left;transition:all .15s';
    btn.textContent = String.fromCharCode(65+i) + '. ' + ans;
    btn.onclick = () => obPickAnswer(i, btn);
    container.appendChild(btn);
  });
}

function obPickAnswer(idx, btn){
  if(_obAnswered) return;
  _obAnswered = true;
  const q = OB_DEMO_QUESTIONS[_obQIdx];
  const correct = idx === q.c;
  const pts = correct ? 20 : 0;
  _obScore += pts;

  // Colour all buttons
  document.querySelectorAll('#ob-answers button').forEach((b, i) => {
    b.style.cursor = 'default';
    if(i === q.c){
      b.style.background = 'rgba(68,204,136,.25)';
      b.style.border = '1.5px solid var(--green)';
      b.style.color = 'var(--green)';
    } else if(i === idx && !correct){
      b.style.background = 'rgba(224,85,85,.2)';
      b.style.border = '1.5px solid var(--red)';
      b.style.color = 'var(--red)';
    }
  });

  // Feedback
  const fb = document.getElementById('ob-feedback');
  fb.style.display = 'block';
  if(correct){
    fb.style.background = 'rgba(68,204,136,.15)';
    fb.style.border = '1px solid var(--green)';
    fb.style.color = 'var(--green)';
    fb.textContent = '✅ Правильно! +20 ⚡';
  } else {
    fb.style.background = 'rgba(224,85,85,.1)';
    fb.style.border = '1px solid var(--red)';
    fb.style.color = 'var(--red)';
    fb.textContent = '❌ Неверно. Правильный: ' + q.a[q.c];
  }
  document.getElementById('ob-score-live').textContent = '+' + _obScore + ' ⚡';

  const nextBtn = document.getElementById('ob-next-q-btn');
  nextBtn.style.display = '';
  const isLast = _obQIdx === OB_DEMO_QUESTIONS.length - 1;
  nextBtn.textContent = isLast ? '🏁 Результат' : 'Следующий вопрос →';
}

function obNextQuestion(){
  if(_obQIdx < OB_DEMO_QUESTIONS.length - 1){
    _obQIdx++;
    renderObQuestion();
  } else {
    showObResult();
  }
}

function showObResult(){
  document.getElementById('ob-slide-demo').style.display = 'none';
  document.getElementById('ob-slide-result').style.display = '';
  const pct = (_obScore / (OB_DEMO_QUESTIONS.length * 20)) * 100;
  let icon, title, sub;
  if(pct === 100){ icon='🏆'; title='Отлично!'; sub='Все ответы верны. Ты прирождённый участник!'; }
  else if(pct >= 50){ icon='🎯'; title='Хороший старт!'; sub='Продолжай — с каждым раундом становится лучше.'; }
  else { icon='🧠'; title='Тренируй мозг!'; sub='Чем больше играешь, тем умнее становишься.'; }
  document.getElementById('ob-res-icon').textContent = icon;
  document.getElementById('ob-res-title').textContent = title;
  document.getElementById('ob-res-sub').textContent = sub;
  document.getElementById('ob-res-neurons').textContent = '+' + _obScore + ' ⚡';
  // Animate count-up
  let n = 0;
  const el = document.getElementById('ob-res-neurons');
  const interval = setInterval(()=>{
    n = Math.min(n + 4, _obScore);
    el.textContent = '+' + n + ' ⚡';
    if(n >= _obScore) clearInterval(interval);
  }, 40);
}

function shouldShowOnboarding(){
  return !localStorage.getItem('mfc_onboarding_done');
}

function showOnboarding(){
  _obQIdx = 0; _obScore = 0; _obAnswered = false;
  document.getElementById('ob-slide-welcome').style.display = '';
  document.getElementById('ob-slide-demo').style.display = 'none';
  document.getElementById('ob-slide-result').style.display = 'none';
  showScreen('onboarding');
}

function skipOnboarding(){ finishOnboarding(); }

function finishOnboarding(){
  localStorage.setItem('mfc_onboarding_done','1');
  localStorage.setItem('mfc_onboarded','1');
  // Credit demo neurons as a welcome bonus
  if(_obScore > 0){
    // Onboarding reward — does not give XP (demo only)
    neurons += _obScore; xp += _obScore; updNeurons();
    awardNeurons(_obScore, 'onboarding_reward', 'onboarding:' + (currentUser?.id||'guest'));
  }
  if(currentUser){
    sb.from('profiles').update({onboarded:true}).eq('id',currentUser.id).then(()=>{}).catch(()=>{});
  }
  showScreen('home');
  if(_obScore > 0) setTimeout(()=>toast(`🎁 Добро пожаловать! +${_obScore} ⚡ за демо`, 3000), 400);
}

// ═══════════════════════════════════════════
// SHARE SCREEN — enhanced
// ═══════════════════════════════════════════

function buildShareText(){
  const roundPts = _roundScore || (correctCount * 20);
  const refCode  = getOrCreateRefCode();
  const link     = location.origin + location.pathname + (refCode ? '?ref='+refCode : '');
  const level    = getPlayerLevel(neurons);
  const levelName = level.name[lang] || level.name.en;
  const streakTxt = _dailyStreak > 0
    ? (lang==='ru' ? `\n🔥 Серия: ${_dailyStreak} дней` : `\n🔥 Streak: ${_dailyStreak} days`)
    : '';
  const rankLine = _cityRank && localStorage.getItem('mfc_city')
    ? (lang==='ru'
        ? `\n🏙️ #${_cityRank} в ${localStorage.getItem('mfc_city')}`
        : `\n🏙️ #${_cityRank} in ${localStorage.getItem('mfc_city')}`)
    : '';

  if(lang==='ru'){
    return `Я набрал ${roundPts} нейронов в Brain Fight Club 🧠${streakTxt}\n🏅 Уровень: ${levelName}\n🎯 ${correctCount}/${curQ.length} правильных${rankLine}\nСможешь побить мой результат?\n${link}`;
  }
  return `I scored ${roundPts} neurons in Brain Fight Club 🧠${streakTxt}\n🏅 Level: ${levelName}\n🎯 ${correctCount}/${curQ.length} correct${rankLine}\nCan you beat me?\n${link}`;
}

// Override showShareScreen — deferred to after all modules load
// (training.js sets window.showShareScreen; streak.js must wait for it)
document.addEventListener('DOMContentLoaded', () => {
  const _origShowShareScreen = window.showShareScreen;
  if (_origShowShareScreen) {
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
  }

  // Override share functions to use buildShareText
  const _origShareToTelegram = window.shareToTelegram;
  if (_origShareToTelegram) {
    window.shareToTelegram = function(){
      track('share_to_telegram_clicked', {score: _roundScore, correct: correctCount});
      const text = encodeURIComponent(buildShareText());
      window.open('https://t.me/share/url?url='+encodeURIComponent(location.origin+location.pathname)+'&text='+text,'_blank');
    };
  }

  const _origShareToWhatsApp = window.shareToWhatsApp;
  if (_origShareToWhatsApp) {
    window.shareToWhatsApp = function(){
      track('share_to_whatsapp_clicked', {score: _roundScore, correct: correctCount});
      const text = encodeURIComponent(buildShareText());
      window.open('https://wa.me/?text='+text,'_blank');
    };
  }

  const _origCopyShareLink = window.copyShareLink;
  if (_origCopyShareLink) {
    window.copyShareLink = function(){
      track('copy_share_clicked', {score: _roundScore, correct: correctCount});
      const text = buildShareText();
      navigator.clipboard.writeText(text).then(()=>{
        const btn = document.getElementById('sh-copy');
        if(btn){ btn.textContent='✓ '+(lang==='ru'?'Скопировано!':'Copied!'); setTimeout(()=>btn.textContent=lang==='ru'?'🔗 Скопировать':'🔗 Copy',2000); }
      }).catch(()=>{ toast(lang==='ru'?'Не удалось скопировать':'Copy failed'); });
    };
  }
});

function challengeFriendFromShare(){
  track('challenge_from_share', {});
  // Generate a challenge link with the challenger's name
  const name = window._currentUserName || localStorage.getItem('bfc_display_name') || 'Игрок';
  const score = window._lastRoundScore || 0;
  const acc   = window._lastRoundAcc   || 0;
  const challengeText = encodeURIComponent(
    `⚔️ ${name} бросает тебе вызов!\n🧠 ${score} очков · ${acc}% точность\nСможешь лучше? brainfight.club`
  );
  const url = encodeURIComponent(`${location.origin}${location.pathname}?challenge=1`);
  // Try native share first
  if (navigator.share) {
    navigator.share({
      title: '⚔️ Вызов в Brain Fight Club',
      text: decodeURIComponent(challengeText),
      url: decodeURIComponent(url),
    }).catch(()=>{});
  } else {
    window.open(`https://t.me/share/url?url=${url}&text=${challengeText}`, '_blank');
  }
}

// ═══════════════════════════════════════════


// ── Streak UI text (shown on daily-limit screen and home) ─────────
// "Заверши сегодняшние 10 вопросов, чтобы сохранить серию."
// "За 3, 7, 14 и 30 дней подряд ты получаешь бонусные нейроны."

// ── window exports ────────────────────────────────────────────────
if (typeof hasStreakFreeze   !== 'undefined') window.hasStreakFreeze   = hasStreakFreeze;
if (typeof buyStreakFreeze   !== 'undefined') window.buyStreakFreeze   = buyStreakFreeze;

// ── Additional window exports ─────────────────────────────────────
window.getTodayDateKey                    = getTodayDateKey;
window.getYesterdayDateKey                = getYesterdayDateKey;
window.getStreakFreeze                    = getStreakFreeze;
window.consumeStreakFreezeIfNeeded        = consumeStreakFreezeIfNeeded;
window.loadDailyStreakData                = loadDailyStreakData;
window.updateDailyStreakOnQuickPlayComplete = updateDailyStreakOnQuickPlayComplete;
window.renderDailyStreakUI                = renderDailyStreakUI;
window.showStreakCelebration              = showStreakCelebration;
window.startObDemo                        = startObDemo;
window.renderObQuestion                   = renderObQuestion;
window.obPickAnswer                       = obPickAnswer;
window.obNextQuestion                     = obNextQuestion;
window.obNext                             = obNextQuestion; // alias used in HTML onclick
window.showObResult                       = showObResult;
window.shouldShowOnboarding               = shouldShowOnboarding;
window.showOnboarding                     = showOnboarding;
window.skipOnboarding                     = skipOnboarding;
window.finishOnboarding                   = finishOnboarding;
window.buildShareText                     = buildShareText;
window.challengeFriendFromShare           = challengeFriendFromShare;
