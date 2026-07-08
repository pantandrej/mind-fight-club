// ── Daily Limit ───────────────────────────────────────────────────
// Enforces PLAN_LIMITS.free.trainingQuestionsPerSession = 10 questions/day.
// Migrated from legacy.js.

// DAILY QUESTION LIMIT (10 questions/day)
// ═══════════════════════════════════════════
const FREE_QUESTIONS_PER_DAY = 10;

// Debug flag: set window.MFC_TEST_LIMIT_AS_USER = true to test limit as admin
function _isLimitExempt(){
  if(window.MFC_TEST_LIMIT_AS_USER) return false; // admin tests limit as user
  return isAdmin();
}

function todayStr(){ return new Date().toISOString().slice(0,10); }

function getDailyQuestionsUsed(){
  const today = todayStr();
  const data = JSON.parse(localStorage.getItem('mfc_daily_questions')||'{}');
  if(data.date !== today) return 0;
  return data.count || 0;
}

// Set of qIdx values already counted in current game session (resets on new game)
let _dailyCountedSet = new Set();
let _dailyCountedGameId = null;

// true only for free quick play — packs/duel/tournament/community/tester don't count
let _currentGameCountsDailyLimit = false;

function getRemainingFreeQuestions(){
  if(_isLimitExempt()) return Infinity;
  return Math.max(0, FREE_QUESTIONS_PER_DAY - getDailyQuestionsUsed());
}

function incrementDailyQuestion(){
  if(!_currentGameCountsDailyLimit) return; // only quick play counts toward limit
  if(_isLimitExempt()) return;
  // Double-count protection: track by gameId+qIdx
  const gameKey = (_gameId||_gameStartTime||'x') + ':' + qIdx;
  if(_dailyCountedGameId !== (_gameId||_gameStartTime||'x')){
    // New game started — reset counted set
    _dailyCountedSet = new Set();
    _dailyCountedGameId = _gameId||_gameStartTime||'x';
  }
  if(_dailyCountedSet.has(qIdx)) return; // already counted this question
  _dailyCountedSet.add(qIdx);

  const today = todayStr();
  const data = JSON.parse(localStorage.getItem('mfc_daily_questions')||'{}');
  const count = data.date === today ? (data.count||0)+1 : 1;
  localStorage.setItem('mfc_daily_questions', JSON.stringify({date:today, count}));
  if(currentUser){
    sb.rpc('increment_daily_usage', {p_user_id: currentUser.id, p_date: today})
      .then(()=>{}).catch(()=>{});
  }
}

function checkQuestionLimit(){
  if(_isLimitExempt()) return false;
  const used = getDailyQuestionsUsed();
  if(used >= FREE_QUESTIONS_PER_DAY){
    showDailyLimitScreen('training');
    return true;
  }
  return false;
}

// Legacy aliases
function incrementDailyRounds(){ /* no-op — per-question now */ }
function getDailyRoundsPlayed(){ return getDailyQuestionsUsed(); }
function checkDailyLimit(){ return checkQuestionLimit(); }

// Returns display count for daily-limit screen.
// Uses lock as source of truth: if today's quick play was started/completed,
// always show FREE_QUESTIONS_PER_DAY so we never display "0 of 10".
function getDailyLimitDisplayUsed(){
  const lock = (typeof getQuickPlayLock === 'function') ? getQuickPlayLock() : null;
  if(lock && lock.date === todayKey() && (lock.started || lock.completed)){
    return FREE_QUESTIONS_PER_DAY;
  }
  const used = getDailyQuestionsUsed();
  return Math.min(FREE_QUESTIONS_PER_DAY, Math.max(0, used || 0));
}

// type: 'training' | 'battle'
function showDailyLimitScreen(type){
  stopIntegrity();
  showScreen('daily-limit');
  const L = lang === 'ru';
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(24,0,0,0);
  const hoursLeft = Math.ceil((midnight - now) / 3600000);

  const isBattle = type === 'battle';
  const icon  = document.getElementById('dl-icon');
  const title = document.getElementById('dl-title');
  const sub   = document.getElementById('dl-sub');
  const pro   = document.getElementById('dl-pro-desc');
  const next  = document.getElementById('dl-next');

  if(icon)  icon.textContent  = isBattle ? '⚔️' : '🧠';
  if(title) title.textContent = L
    ? (isBattle ? 'Баттлы на сегодня закончились!' : 'Тренировка на сегодня закончилась!')
    : (isBattle ? 'No battles left today!'         : 'Daily training limit reached!');
  if(sub) sub.textContent = L
    ? (isBattle
        ? 'Ты провёл 3 бесплатных баттла сегодня. Возвращайся завтра — лимит обновится в полночь.'
        : 'Ты ответил на 10 бесплатных вопросов сегодня. Возвращайся завтра — лимит обновится в полночь.')
    : (isBattle
        ? 'You played 3 free battles today. Come back tomorrow — limit resets at midnight.'
        : 'You answered 10 free questions today. Come back tomorrow — limit resets at midnight.');
  if(pro) pro.textContent = L
    ? (isBattle
        ? '10 баттлов в день, 50 вопросов тренировки и ранний доступ к турнирам'
        : '50 вопросов в день, 10 баттлов в день и эксклюзивные паки')
    : (isBattle
        ? '10 battles/day, 50 training questions and early tournament access'
        : '50 questions/day, 10 battles/day and exclusive packs');
  if(next) next.textContent = L ? `Сброс через ~${hoursLeft} ч` : `Resets in ~${hoursLeft}h`;

  const inviteBtn = document.getElementById('dl-invite-btn');
  if(inviteBtn) inviteBtn.textContent = L ? '🔗 Позвать друга играть' : '🔗 Invite a friend';
  const homeBtn = document.getElementById('dl-tomorrow-btn');
  if(homeBtn) homeBtn.textContent = L ? '🏠 На главную' : '🏠 Back to home';
}

function copyRefLinkAndToast(){
  const code = getOrCreateRefCode();
  if(!code){
    toast(lang==='ru'?'Войдите чтобы получить ссылку':'Sign in to get your link');
    return;
  }
  const link = location.origin + location.pathname + '?ref=' + code;
  navigator.clipboard.writeText(link).catch(()=>{});
  track('invite_clicked', {source:'daily_limit'});
  // Show the full referral stats inline in daily-limit
  _showReferralInviteCard(code, link);
  toast(lang==='ru'
    ? '🔗 Ссылка скопирована! Бонус начислится после регистрации друга.'
    : '🔗 Link copied! Bonus unlocks after your friend signs up.'
  );
}

async function _showReferralInviteCard(code, link){
  // If a share card isn't already showing, pop a mini referral card inside daily-limit
  const existing = document.getElementById('dl-ref-mini');
  if(existing) return;
  const container = document.querySelector('#daily-limit .limit-actions');
  if(!container) return;

  const mini = document.createElement('div');
  mini.id = 'dl-ref-mini';
  mini.style.cssText = 'width:100%;background:rgba(108,99,255,.12);border:1px solid rgba(108,99,255,.3);border-radius:14px;padding:14px 16px;margin:6px 0;text-align:left';
  mini.innerHTML = `
    <div style="font-size:11px;font-weight:800;color:var(--muted);letter-spacing:1px;margin-bottom:8px">🔗 ТВОЯ РЕФЕРАЛЬНАЯ ССЫЛКА</div>
    <div style="font-size:12px;color:var(--accent2);word-break:break-all;margin-bottom:10px;line-height:1.4">${link}</div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:10px">${lang==='ru'?'Друг регистрируется → оба получают <b style="color:var(--gold)">+50 ⚡</b>':'Friend signs up → both get <b style="color:var(--gold)">+50 ⚡</b>'}</div>
    <div style="display:flex;gap:8px">
      <button onclick="navigator.clipboard.writeText('${link}').catch(()=>{}); this.textContent='✅ Скопировано!'; setTimeout(()=>this.textContent='📋 Копировать',2000)"
        style="flex:1;background:var(--accent);border:none;border-radius:10px;padding:9px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">
        📋 ${lang==='ru'?'Копировать':'Copy'}
      </button>
      <button onclick="shareToTelegramRef('${link}')"
        style="flex:1;background:rgba(29,155,240,.2);border:1px solid rgba(29,155,240,.4);border-radius:10px;padding:9px;font-size:12px;font-weight:700;color:#1d9bf0;cursor:pointer;font-family:inherit">
        ✈️ Telegram
      </button>
    </div>
    <div id="dl-ref-stats" style="margin-top:10px;font-size:12px;color:var(--muted)">Загружаем статистику...</div>
  `;
  container.prepend(mini);

  // Load real referral stats
  if(currentUser){
    try{
      const {data} = await sb.from('referrals')
        .select('id,status,reward_referrer')
        .eq('referrer_id', currentUser.id);
      const total    = (data||[]).length;
      const rewarded = (data||[]).filter(r=>r.status==='rewarded').length;
      const earned   = (data||[]).filter(r=>r.status==='rewarded').reduce((s,r)=>s+(r.reward_referrer||50),0);
      const statsEl = document.getElementById('dl-ref-stats');
      if(statsEl) statsEl.innerHTML = total
        ? `📊 Приглашено: <b style="color:var(--text)">${total}</b> &nbsp;·&nbsp; Активных: <b style="color:var(--green)">${rewarded}</b> &nbsp;·&nbsp; Заработано: <b style="color:var(--gold)">${earned} ⚡</b>`
        : `📊 ${lang==='ru'?'Ты первый среди знакомых! Пригласи друга.':'Be the first! Invite a friend.'}`;
    }catch(e){ /* silent */ }
  }
}

function shareToTelegramRef(link){
  const text = lang==='ru'
    ? `Играю в Brain Fight Club — интеллектуальные дуэли! Присоединяйся: ${link}`
    : `Playing Brain Fight Club — quiz battles! Join me: ${link}`;
  window.open('https://t.me/share/url?url='+encodeURIComponent(link)+'&text='+encodeURIComponent(text), '_blank');
}

// ═══════════════════════════════════════════


// ── Window exports — required because this file is loaded as ES module ──
window.getRemainingFreeQuestions = getRemainingFreeQuestions;
window.getDailyQuestionsUsed     = getDailyQuestionsUsed;
window.incrementDailyQuestion    = incrementDailyQuestion;
window.checkQuestionLimit        = checkQuestionLimit;
window.checkDailyLimit           = checkDailyLimit;
window.incrementDailyRounds      = incrementDailyRounds;
window.getDailyRoundsPlayed      = getDailyRoundsPlayed;
window.showDailyLimitScreen      = showDailyLimitScreen;
window.copyRefLinkAndToast       = copyRefLinkAndToast;
window.shareToTelegramRef        = shareToTelegramRef;
window.getDailyLimitDisplayUsed  = getDailyLimitDisplayUsed;
