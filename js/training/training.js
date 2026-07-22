import { getState, setState, setQuizState, incrementCorrectCount, addToRoundScore } from '../state.js';
import { updNeurons, awardNeurons, awardCurrency, spendNeurons } from '../economy/wallet.js';
import { sb } from '../services/supabase.js';
import { track } from '../services/analytics.js';

// ── State accessors (replaces bare global reads) ──────────────────
// During migration, reads use getState(); writes use setState()
// Legacy shim keeps bare globals in sync via _syncStateToLegacy()

// ── Training / Quick Play ─────────────────────────────────────────
// Quiz game loop: question loading, answer handling, scoring.
// Migrated from legacy.js — references to bare globals (neurons, xp, currentUser)
// are valid during migration via legacy shim _syncStateToLegacy().
// TODO Iteration 3: replace with getState()/setState() calls.
//
// NOTE: this file is a direct extraction — no logic changes.
// Functions are exposed via window.* for inline onclick compatibility.

// Dependencies from modules (set on window by their modules):
// window.sb, window.track, window.awardNeurons, window.spendNeurons
// window.toast, window.showFb, window.buildDots, window.setDot
// window.showScreen, window._esc

// ─── DAILY GOAL BONUS ─────────────────────────────────────────
// TODO (post-MVP): persist daily goal claim server-side in Supabase
//   (e.g. profiles.daily_goal_claimed_date or a daily_rewards table)
// Currently stored in localStorage — safe for demo.
const DAILY_GOAL_BONUS = 50; // ⚡ awarded once per day for finishing Quick Play

function getTrainingTodayKey(){ return new Date().toISOString().slice(0,10); }

function isDailyGoalClaimed(){
  return localStorage.getItem('mfc_daily_goal_claimed_' + getTrainingTodayKey()) === 'true';
}

async function claimDailyGoalBonus(){
  // Server-side idempotency: RPC uses operation_key daily_goal:{user_id}:{date}
  // Client-side optimistic guard to avoid redundant calls
  if(isDailyGoalClaimed()) return 0;

  const todayKey = getTrainingTodayKey(); // YYYY-MM-DD from local clock (display only)
  // The server uses NOW() AT TIME ZONE 'UTC' for the real date — not browser time

  const result = await awardNeurons(
    DAILY_GOAL_BONUS,
    'daily_goal',
    'daily_goal:' + todayKey  // server validates uniqueness per user per UTC day
  );

  if(result === null){
    // RPC failed or already claimed on server — no double award
    return 0;
  }

  // Mark locally only as UX cache so we don't spam the RPC
  localStorage.setItem('mfc_daily_goal_claimed_' + todayKey, 'true');
  track('daily_goal_claimed', {bonus: DAILY_GOAL_BONUS});
  return DAILY_GOAL_BONUS;
}

function showOfficialFromMenu(){
  const item = document.getElementById('pm-official-item');
  const code = item?.getAttribute('data-code');
  if(code){
    openOfficialTournament(code);
  } else {
    // No active official tournament — show the official tournament screen
    // which already handles the "coming soon" state gracefully.
    showScreen('official-tournament');
    // Provide friendly placeholder text if no tournament is loaded
    setTimeout(()=>{
      const titleEl = document.querySelector('#official-tournament .ot-title');
      if(titleEl && (!titleEl.textContent || titleEl.textContent.trim() === '')){
        titleEl.textContent = lang==='ru' ? '🏆 Кубок скоро' : '🏆 Cup coming soon';
      }
      const subEl = document.querySelector('#official-tournament .ot-desc, #official-tournament .ot-sub');
      if(subEl && (!subEl.textContent || subEl.textContent.trim() === '')){
        subEl.textContent = lang==='ru'
          ? 'Следующий официальный турнир появится здесь. Следи за обновлениями!'
          : 'The next official tournament will appear here. Stay tuned!';
      }
    }, 200);
  }
}

// ── Game type tracking (Fix: smart "Play again") ──
let currentGameType = null;   // 'quick' | 'pack' | 'community' | 'daily'
let currentPackKey  = null;   // import_key for pack games

// ═══════════════════════════════════════════
// QUICK PLAY DAILY LOCK — one round per day
// ═══════════════════════════════════════════
const QUICK_PLAY_LOCK_KEY = 'mfc_quick_play_lock_v1';

function todayKey(){
  return new Date().toISOString().slice(0,10);
}

function getQuickPlayLock(){
  try{
    const raw = localStorage.getItem(QUICK_PLAY_LOCK_KEY);
    if(!raw) return null;
    const data = JSON.parse(raw);
    if(data.date !== todayKey()) return null; // yesterday's lock — expired
    return data;
  }catch(e){ return null; }
}

// Lock applies to ALL users including admins. Use MFC_RESET_QUICK_PLAY_LOCK() to test.
function isQuickPlayLocked(){
  const lock = getQuickPlayLock();
  return !!(lock && (lock.started || lock.completed));
}

function lockQuickPlayStarted(){
  localStorage.setItem(QUICK_PLAY_LOCK_KEY, JSON.stringify({
    date: todayKey(),
    started: true,
    completed: false,
    started_at: new Date().toISOString()
  }));
}

function lockQuickPlayCompleted(){
  const existing = getQuickPlayLock();
  localStorage.setItem(QUICK_PLAY_LOCK_KEY, JSON.stringify({
    date: todayKey(),
    started: true,
    completed: true,
    started_at: existing ? existing.started_at : new Date().toISOString(),
    completed_at: new Date().toISOString()
  }));
}

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

function getLocalPlayedQuestionIds(mode='quick'){
  try{
    const raw = localStorage.getItem(PLAYED_QUESTION_IDS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    return new Set((data[mode] || []).map(String));
  }catch(e){ return new Set(); }
}

function addLocalPlayedQuestionId(questionId, mode='quick'){
  if(!questionId) return;
  try{
    const raw = localStorage.getItem(PLAYED_QUESTION_IDS_KEY);
    const data = raw ? JSON.parse(raw) : {};
    const arr = Array.isArray(data[mode]) ? data[mode].map(String) : [];
    const id = String(questionId);
    if(!arr.includes(id)) arr.push(id);
    data[mode] = arr.slice(-5000); // cap at 5000 to avoid unbounded growth
    localStorage.setItem(PLAYED_QUESTION_IDS_KEY, JSON.stringify(data));
  }catch(e){}
}

async function getRemotePlayedQuestionIds(mode='quick'){
  if(!currentUser?.id) return new Set();
  try{
    const {data, error} = await sb
      .from('user_question_history')
      .select('question_id')
      .eq('user_id', currentUser.id)
      .eq('mode', mode)
      .limit(10000);
    if(error) throw error;
    return new Set((data || []).map(r => String(r.question_id)));
  }catch(e){
    console.warn('[MFC] getRemotePlayedQuestionIds failed:', e.message);
    return new Set();
  }
}

async function getPlayedQuestionIds(mode='quick'){
  const local = getLocalPlayedQuestionIds(mode);
  const remote = await getRemotePlayedQuestionIds(mode);
  return new Set([...local, ...remote]);
}

// Called at question show-time (not answer-time) so refresh can't give same Q again
async function markQuestionSeen(questionId, mode='quick'){
  if(!questionId) return;
  addLocalPlayedQuestionId(questionId, mode);
  if(!currentUser?.id) return;
  try{
    await sb.from('user_question_history').upsert({
      user_id:      currentUser.id,
      question_id:  String(questionId),
      mode,
      first_seen_at: new Date().toISOString()
    }, { onConflict: 'user_id,question_id,mode' });
  }catch(e){
    console.warn('[MFC] markQuestionSeen failed:', e.message);
  }
}

// ── Lowest-level guard: one check covers ALL entry points ──────────
function blockQuickPlayIfLocked(){
  // Note: localStorage lock is UX-cache only.
  // Server RPC (start_game_session) is the authoritative limit check.
  // Premium users may have sessions > 1/day — server decides, not localStorage.
  // We check localStorage only BEFORE the server call as a fast-path UX hint.
  // If server says allowed=true, we proceed regardless of localStorage state.
  const _localLocked = isQuickPlayLocked();
  const _localRemaining = getRemainingFreeQuestions();
  if(_localLocked && _localRemaining <= 0 && !window._appState?.getState().currentUser){
    // Guest with local lock — no server to override
    if (typeof showDailyLimitScreen === 'function') showDailyLimitScreen('training');
    else if (window.showScreen) window.showScreen('daily-limit');
    return;
  }
  // For authenticated users, the RPC call below is authoritative.
  // Do NOT return early here — let the server decide.
  if(!window._appState?.getState().currentUser && _localLocked){
    showDailyLimitScreen('training');
    return true;
  }
  return false;
}

// Flag to prevent showScore from running twice for the same round
let _scoreShownForGame = false;
let _roundAnswers = []; // tracks picked index per question for AI review
// Session flag: once quick play finishes, any restart attempt → daily-limit
let _quickPlayCompletedThisSession = false;

// Flag: true only during the synchronous hand-off from startQuickPlay → startQuiz,
// so startQuiz doesn't see the freshly-written lock as a block.
let _quickPlayStartInProgress = false;

async function startQuickPlay(){
  // ── Server-side limit check (enforces PLAN_LIMITS server-side) ──
  if (typeof window.sb !== 'undefined' && window._appState?.getState().currentUser) {
    const { data: sessionData, error: sessionErr } = await window.sb.rpc('start_game_session', {
      p_mode: 'training'
    });
    if (sessionErr) {
      console.error('[training] start_game_session error:', sessionErr.message);
      // Block on RPC error — do not allow rating play without server verification
      window.toast?.('Не удалось проверить дневной лимит. Проверь интернет и попробуй ещё раз.');
      return;
    } else if (sessionData && !sessionData.allowed) {
      const plan  = sessionData.plan  || 'free';
      const used  = sessionData.used  ?? '?';
      const limit = sessionData.limit ?? 10;
      if (typeof window.track === 'function') {
        window.track('training_limit_reached', { plan, used, limit });
        window.track('premium_paywall_viewed', { trigger: 'training_limit', plan });
      }
      if (typeof window.showDailyLimitScreen === 'function') window.showDailyLimitScreen('training');
      else if (typeof window.showScreen === 'function') window.showScreen('daily-limit');
      return;
    }
    // Store session_id for later reference (analytics, leaderboard)
    if (sessionData?.session_id) window._currentSessionId = sessionData.session_id;
  }

  // Iron-clad lock — applies to everyone, including admins
  if(blockQuickPlayIfLocked()) return;
  currentGameType = 'quick';
  currentPackKey  = null;
  selectedCat = 'ALL';
  _scoreShownForGame = false; _roundAnswers = [];
  _quickPlayCompletedThisSession = false; // reset for fresh round
  // Do NOT lock yet — lock only after DB questions are loaded and standard is built.
  // _quickPlayStartInProgress lets startQuiz skip the lock-check on entry.
  _quickPlayStartInProgress = true;
  try{
    await startQuiz(null, false);
  } finally {
    _quickPlayStartInProgress = false;
  }
}

function showPlayTopics(){
  showScreen('home');
  // Scroll to category chips
  setTimeout(()=>{ const el=document.getElementById('chip-all'); if(el) el.scrollIntoView({behavior:'smooth', block:'center'}); }, 100);
}

async function showMyPacks(){
  // showScreen('shop') triggers renderShop() which already calls renderDBGamePacks().
  // Do NOT call renderDBGamePacks() again here — that causes duplicate pack cards.
  showScreen('shop');
}

// Render-token: each call increments this; async continuations bail if token changed.
let _packsRenderToken = 0;

async function renderDBGamePacks(){
  const myToken = ++_packsRenderToken;
  const grid = document.getElementById('packs-grid');
  if(!grid) return;
  // Remove previous DB pack cards (keep local demo cards if any)
  grid.querySelectorAll('.db-pack-card').forEach(el=>el.remove());

  try{
    // Load all packs from Supabase
    let {data: packs, error} = await sb.from('game_packs')
      .select('*').order('created_at', {ascending:false});
    if(myToken !== _packsRenderToken) return; // superseded while waiting
    if(error) throw error;
    if(!packs) packs = [];

    // Load purchase state so we can show buy vs play buttons
    await loadUserPackPurchases();

    const HIDDEN = ['archived_unsupported','needs_reimport','archived'];
    const visible = isAdmin()
      ? packs.filter(p=>!HIDDEN.includes(p.status))
      : packs.filter(p=>p.status==='published');

    // ── Dedup: if multiple packs share the same normalised title,
    //    keep the one with the "best" status (published > tester > draft),
    //    and if still tied, keep the newest (highest created_at).
    const STATUS_RANK = {published:0, tester:1, draft:2};
    const dedupMap = new Map(); // normalizedTitle → pack
    for(const pack of visible){
      const key = (pack.title_ru || pack.title_en || pack.import_key || '').trim().toLowerCase();
      const existing = dedupMap.get(key);
      if(!existing){
        dedupMap.set(key, pack);
      } else {
        const rankNew = STATUS_RANK[pack.status] ?? 99;
        const rankEx  = STATUS_RANK[existing.status] ?? 99;
        if(rankNew < rankEx){
          // New one has better status — prefer it
          dedupMap.set(key, pack);
        } else if(rankNew === rankEx){
          // Same status — prefer newer created_at
          if((pack.created_at||'') > (existing.created_at||'')) dedupMap.set(key, pack);
        }
        // else: existing is better — keep it
      }
    }
    const dedupedVisible = [...dedupMap.values()];

    if(!dedupedVisible.length){
      if(myToken !== _packsRenderToken) return;
      // Empty state
      const empty = document.createElement('div');
      empty.className = 'db-pack-card';
      empty.style.cssText = 'width:100%;padding:32px 16px;text-align:center;background:var(--bg2);border:0.5px solid var(--border);border-radius:14px;color:var(--muted)';
      empty.innerHTML = '<div style="font-size:32px;margin-bottom:10px">📦</div>'
        + '<div style="font-size:14px;font-weight:700;margin-bottom:6px">'+(lang==='ru'?'Паков пока нет':'No packs yet')+'</div>'
        + '<div style="font-size:12px;line-height:1.5">'+(lang==='ru'?'Админ может загрузить новый пак через Мастер импорта.':'Admin can upload a new pack via the Import Wizard.')+'</div>'
        + (isAdmin() ? '<button onclick="showAdminImportWizard()" style="margin-top:12px;background:var(--accent);border:none;border-radius:8px;padding:8px 16px;font-size:12px;font-weight:700;color:#fff;cursor:pointer;font-family:inherit">📥 Мастер импорта</button>' : '');
      grid.appendChild(empty);
      return;
    }

    const MIN_PLAYABLE = 10;

    // Count published questions per pack — primary: via game_pack_questions join;
    // fallback: via import_key prefix on questions table (covers older packs with
    // mismatched keys). We take the MAX of both to be safe.
    async function countPackQuestions(pack){
      let countByJoin = 0;
      let countByPrefix = 0;

      // Primary: game_pack_questions → questions (published only)
      if(pack.id){
        const {count} = await sb.from('game_pack_questions')
          .select('question_id, questions!inner(id)', {count:'exact', head:true})
          .eq('game_pack_id', pack.id)
          .eq('questions.status', 'published');
        countByJoin = count || 0;
      }

      // Fallback: import_key LIKE prefix (works when import_key = batchKey)
      if(pack.import_key){
        const {count} = await sb.from('questions')
          .select('*', {count:'exact', head:true})
          .like('import_key', pack.import_key + '_%')
          .eq('status', 'published');
        countByPrefix = count || 0;
      }

      return Math.max(countByJoin, countByPrefix);
    }

    // Gold-standard check via game_pack_questions join (primary) or import_key prefix
    async function checkGoldStandard(pack){
      let qs = null;

      // Try via join first
      if(pack.id){
        const {data} = await sb.from('game_pack_questions')
          .select('questions!inner(answers_json)')
          .eq('game_pack_id', pack.id)
          .eq('questions.status', 'published')
          .limit(200);
        if(data && data.length) qs = data.map(r => r.questions);
      }

      // Fallback via import_key prefix
      if((!qs || !qs.length) && pack.import_key){
        const {data} = await sb.from('questions')
          .select('answers_json')
          .like('import_key', pack.import_key + '_%')
          .eq('status', 'published')
          .limit(200);
        qs = data || [];
      }

      if(!qs || qs.length < MIN_PLAYABLE) return false;
      const byLen = {};
      for(const q of qs){
        let a = q.answers_json;
        if(typeof a==='string'){ try{ a=JSON.parse(a); }catch(e){ a=[]; } }
        const n = Array.isArray(a) ? a.length : 0;
        if(n>=2 && n<=6) byLen[n] = (byLen[n]||0) + 1;
      }
      return [2,3,4,5,6].every(n=>(byLen[n]||0)>=2);
    }

    for(const pack of dedupedVisible){
      const count = await countPackQuestions(pack);
      const isDraft = pack.status !== 'published';
      const isIncomplete = count < MIN_PLAYABLE;

      // Regular users: skip incomplete packs
      if(!isAdmin() && isIncomplete) continue;

      const icon  = pack.icon||'🎯';
      const title = pack.title_ru||pack.title_en||pack.import_key||'Пак';
      const desc  = pack.description_ru||pack.theme||'';
      const price = pack.price_neurons || 0;
      const isFree = pack.is_free || price === 0;
      const owned  = isAdmin() || isPackOwned(pack.id);

      const incompleteLabel = isIncomplete
        ? ' <span style="font-size:10px;color:var(--red)">⚠️ Неполный ('+count+'/'+MIN_PLAYABLE+')</span>'
        : '';
      const draftLabel = isDraft
        ? ' <span style="font-size:10px;color:var(--gold)">(черновик)</span>'
        : '';

      // CTA button
      let ctaHtml = '';
      let priceTagHtml = '';

      if(isAdmin()){
        // Admin: always show Test button (no purchase needed)
        priceTagHtml = price > 0
          ? `<div style="font-size:10px;color:var(--gold);margin-top:3px">⚡ ${price} нейронов</div>`
          : `<div style="font-size:10px;color:var(--green);margin-top:3px">${lang==='ru'?'Бесплатно':'Free'}</div>`;
        if(!isIncomplete){
          ctaHtml = `<button class="big-btn" style="margin-top:8px;padding:10px;font-size:13px;background:rgba(240,192,64,.15);border:1px solid var(--gold);color:var(--gold)"
            onclick="event.stopPropagation();playDBPack('${pack.import_key}','${pack.id}')">
            🧪 ${lang==='ru'?'Тестировать':'Test'}
          </button>`;
        } else {
          ctaHtml = `<button onclick="event.stopPropagation();startTesterMode('pack','${pack.import_key}')"
            style="width:100%;margin-top:8px;background:rgba(224,85,85,.1);border:0.5px solid var(--red);border-radius:10px;padding:8px;font-size:11px;font-weight:700;color:var(--red);cursor:pointer;font-family:inherit">
            ⚠️ Нужно ${MIN_PLAYABLE-count} вопросов → Тестер
          </button>`;
        }
      } else if(!isIncomplete){
        if(isFree || owned){
          // Free or already purchased
          priceTagHtml = owned && !isFree
            ? `<div style="font-size:10px;color:var(--green);font-weight:700;margin-top:3px">✅ ${lang==='ru'?'Куплен':'Owned'}</div>`
            : `<div style="font-size:10px;color:var(--green);margin-top:3px">${lang==='ru'?'Бесплатно':'Free'}</div>`;
          ctaHtml = `<button class="big-btn" style="margin-top:8px;padding:10px;font-size:13px"
            onclick="event.stopPropagation();playDBPack('${pack.import_key}','${pack.id}')">
            ▶ ${lang==='ru'?'Играть':'Play'}
          </button>`;
        } else {
          // Paid, not purchased
          priceTagHtml = `<div style="font-size:12px;color:var(--accent2);font-weight:800;margin-top:4px">🔒 ${price} ⚡</div>`;
          ctaHtml = `<button class="big-btn" style="margin-top:8px;padding:10px;font-size:13px;background:linear-gradient(135deg,var(--accent),var(--accent2))"
            onclick="event.stopPropagation();buyDBPack('${pack.id}',${price},false)">
            🔓 ${lang==='ru'?`Купить за ${price} ⚡`:`Buy for ${price} ⚡`}
          </button>`;
        }
      }

      const card = document.createElement('div');
      card.className = 'pack-card db-pack-card';
      card.style.border = isDraft
        ? '0.5px solid rgba(240,192,64,.3)'
        : isIncomplete
          ? '0.5px solid rgba(224,85,85,.25)'
          : (owned || isFree || isAdmin())
            ? '0.5px solid rgba(68,204,136,.3)'
            : '0.5px solid rgba(108,99,255,.3)';
      card.innerHTML = `<div class="pack-icon">${icon}</div>
        <div class="pack-name">${title}${draftLabel}${incompleteLabel}</div>
        <div class="pack-desc">${desc}</div>
        <div style="font-size:10px;color:var(--muted);margin-top:4px">${count} вопросов</div>
        ${priceTagHtml}
        ${ctaHtml}
        ${isDraft && isAdmin() ? `<button onclick="event.stopPropagation();startTesterMode('pack','${pack.import_key}')"
          style="width:100%;margin-top:6px;background:rgba(240,192,64,.1);border:0.5px solid var(--gold);border-radius:10px;padding:7px;font-size:11px;font-weight:700;color:var(--gold);cursor:pointer;font-family:inherit">
          📝 Тестировать черновик
        </button>` : ''}`;      // Stale-token guard: abort if a newer renderDBGamePacks call started
      if(myToken !== _packsRenderToken) return;
      grid.appendChild(card);
    }
  }catch(e){
    if(myToken !== _packsRenderToken) return; // another call superseded us
    console.warn('renderDBGamePacks error:', e);
    const errEl = document.createElement('div');
    errEl.className = 'db-pack-card';
    errEl.style.cssText = 'padding:16px;color:var(--red);font-size:12px;text-align:center';
    errEl.textContent = '❌ Ошибка загрузки паков: ' + e.message;
    grid.appendChild(errEl);
  }
}
// ── Pack purchases cache ──────────────────────────────────────────
let _userPackPurchases = null; // Set of game_pack_id strings the user owns

async function loadUserPackPurchases(){
  if(!currentUser){ _userPackPurchases = new Set(); return; }
  try{
    const {data} = await sb.from('user_pack_purchases')
      .select('game_pack_id').eq('user_id', currentUser.id);
    _userPackPurchases = new Set((data||[]).map(r=>r.game_pack_id));
  }catch(e){ _userPackPurchases = new Set(); }
}

function isPackOwned(packId){ return !!(_userPackPurchases && _userPackPurchases.has(packId)); }

async function buyDBPack(packId, priceNeurons, isFree){
  // Guest: require sign-in for paid packs
  if(!currentUser){
    if(isFree || priceNeurons === 0){
      playDBPack(null, packId); // free packs work for guests
      return;
    }
    toast(lang==='ru'
      ? '🔐 Войдите, чтобы покупать паки и сохранить доступ'
      : '🔐 Sign in to buy packs and keep access', 3500);
    return;
  }
  if(isAdmin()){ playDBPack(null, packId); return; } // admins bypass purchase

  // Already purchased?
  if(!_userPackPurchases) await loadUserPackPurchases();
  if(isPackOwned(packId)){ playDBPack(null, packId); return; }

  const price = isFree ? 0 : (priceNeurons || 0);

  // Free packs: create purchase record silently, then play
  if(price === 0){
    await sb.from('user_pack_purchases').insert({
      user_id:      currentUser.id,
      game_pack_id: packId,
      price_neurons: 0,
      purchased_at: new Date().toISOString()
    }).then(()=>{}).catch(()=>{});
    _userPackPurchases.add(packId);
    playDBPack(null, packId);
    return;
  }

  // Paid pack: check balance
  if(neurons < price){
    toast(lang==='ru'
      ? `❌ Не хватает нейронов (нужно ${price} ⚡, у вас ${neurons} ⚡)`
      : `❌ Not enough neurons (need ${price} ⚡, you have ${neurons} ⚡)`, 3500);
    return;
  }

  // Deduct neurons and record purchase
  const packSpend = await spendNeurons(price, 'pack_purchase', 'pack:' + packId + ':' + (currentUser?.id||''));
  if(!packSpend || !packSpend.ok){
    toast(lang==='ru'?'❌ Ошибка покупки пака':'❌ Pack purchase failed');
    return;
  }

  const {error} = await sb.from('user_pack_purchases').insert({
    user_id:       currentUser.id,
    game_pack_id:  packId,
    price_neurons: price,
    purchased_at:  new Date().toISOString()
  });
  if(error){
    toast('❌ ' + (lang==='ru' ? 'Ошибка покупки: ' : 'Purchase error: ') + error.message);
    track('pack_purchase_error', { pack_id: packId, error: error.message });
    // Note: spendNeurons RPC already rolled back — no local rollback needed
    await refreshBalance(); // re-sync from server
    return;
  }

  _userPackPurchases.add(packId);
  track('pack_purchased', {pack_id: packId, price});
  toast(lang==='ru' ? `✅ Пак открыт! (-${price} ⚡)` : `✅ Pack unlocked! (-${price} ⚡)`);

  // Refresh shop UI so button switches to "Играть", then auto-launch the pack
  const shopEl = document.getElementById('shop');
  if(shopEl && shopEl.classList.contains('active')) await renderDBGamePacks();
  playDBPack(null, packId);
}

async function playDBPack(importKey, packId){
  currentGameType = 'pack';
  currentPackKey  = importKey;
  _scoreShownForGame = false; _roundAnswers = [];
  const _gsp = document.getElementById('game-score-pill');
  const _gsv = document.getElementById('game-score-val');
  if(_gsp){ _gsp.style.display='flex'; } if(_gsv) _gsv.textContent='0';
  toast(lang==='ru'?'⏳ Загружаем пак...':'⏳ Loading pack...', 1500);

  // Load pack meta — by packId (UUID) or importKey (string)
  let packData = null;
  if(packId){
    const {data} = await sb.from('game_packs').select('*').eq('id', packId).single();
    packData = data;
    if(packData) importKey = packData.import_key; // sync importKey for currentPackKey
  } else if(importKey){
    const {data} = await sb.from('game_packs').select('*').eq('import_key', importKey).single();
    packData = data;
    if(packData) packId = packData.id;
  }
  currentPackKey = importKey;

  // Access control: require purchase unless free, admin, or owned
  if(packData && !isAdmin()){
    const price = packData.price_neurons || 0;
    const isFree = packData.is_free || price === 0;
    if(!isFree){
      if(!_userPackPurchases) await loadUserPackPurchases();
      if(!isPackOwned(packData.id)){
        // Not purchased — prompt to buy; direct console call cannot bypass this
        if(!currentUser){
          toast(lang==='ru'
            ? '🔐 Войдите, чтобы покупать паки'
            : '🔐 Sign in to buy packs', 3000);
        } else {
          toast(lang==='ru'
            ? `🔒 Этот пак стоит ${price} ⚡ — купите его в магазине`
            : `🔒 This pack costs ${price} ⚡ — buy it in the shop`, 3000);
        }
        showScreen('shop');
        return;
      }
    }
  }

  const renderMode = packData?.render_mode || 'extracted_question';
  const packTitle  = packData?.title_ru || packData?.title_en || importKey;
  const prefix     = (importKey||'').replace('game_','');

  // Load questions: first get IDs from game_pack_questions, then load questions by ID
  let data, error;

  if(packData?.id){
    // Step 1: get question IDs ordered by position
    const {data: links} = await sb.from('game_pack_questions')
      .select('question_id, position')
      .eq('game_pack_id', packData.id)
      .order('position');

    if(links && links.length){
      const ids = links.map(r => r.question_id);
      // Use raw fetch (no user JWT) — authenticated role loses access to answers_json/answers_ru
      const QCOLS = 'id,question_text,question_ru,answers_json,answers_ru,correct_index,slide_img_url,answer_slide_img_url,image_url,audio_url,video_url,media_type,category,language,status,import_key,explanation_ru,question_type,game_type,source_type';
      const idsParam = ids.map(id=>`"${id}"`).join(',');
      const qRes = await fetch(`${window._supabaseUrl}/rest/v1/questions?id=in.(${idsParam})&status=eq.published&select=${QCOLS}`, {
        headers: { apikey: window._supabaseAnonKey }
      });
      data = qRes.ok ? await qRes.json() : null;
      // Re-sort by position order from links
      if(data && data.length){
        const posMap = Object.fromEntries(links.map(r => [r.question_id, r.position]));
        data.sort((a,b) => (posMap[a.id]||0) - (posMap[b.id]||0));
      }
    }

    // Fallback: load by import_key prefix (e.g. mb4_q001, mb4_q002...)
    if(!data || !data.length){
      const packPrefix = (importKey||'').toLowerCase();
      const QCOLS = 'id,question_text,question_ru,answers_json,answers_ru,correct_index,slide_img_url,answer_slide_img_url,image_url,audio_url,video_url,media_type,category,language,status,import_key,explanation_ru,question_type,game_type,source_type';
      const fbRes = await fetch(`${window._supabaseUrl}/rest/v1/questions?import_key=like.${packPrefix}_q%&status=eq.published&select=${QCOLS}&order=import_key`, {
        headers: { apikey: window._supabaseAnonKey }
      });
      data = fbRes.ok ? await fbRes.json() : null;
    }
  } else {
    ({data, error} = await sb.from('questions')
      .select('*')
      .like('import_key', prefix+'_q%')
      .eq('status','published')
      .order('import_key'));
  }

  if(!data || !data.length){
    // Check for draft questions (both linked and by prefix)
    const {data: draft} = await sb.from('questions')
      .select('id').like('import_key', prefix+'_q%');
    toast(draft?.length
      ? (lang==='ru'
          ? `В паке ${draft.length} вопросов, но они ещё draft — опубликуй через Tester!`
          : `${draft.length} questions are draft — publish via Tester first!`)
      : (lang==='ru'?'Нет вопросов в паке':'No questions in this pack'));
    return;
  }

  // All packs now use standard MC quiz player
  startExtractedPack(data, packTitle, importKey);
}

// ─── DB QUESTION LOADER FOR QUICK PLAY ──────────────────────────
// Maps a raw Supabase `questions` row to the internal playable format.
// Handles every field variant we've seen in production.
function normalizeDBQuestionForQuickPlay(row){
  if(!row) return null;

  // ── Question text ────────────────────────────────────────────────
  const qText =
    (typeof row.question_ru === 'string' && row.question_ru.trim()) ? row.question_ru.trim() :
    (typeof row.question_text === 'string' && row.question_text.trim()) ? row.question_text.trim() :
    (typeof row.question === 'string' && row.question.trim()) ? row.question.trim() :
    (typeof row.text === 'string' && row.text.trim()) ? row.text.trim() :
    (typeof row.prompt === 'string' && row.prompt.trim()) ? row.prompt.trim() : '';

  // ── Answers ──────────────────────────────────────────────────────
  let answers = null;

  // Priority: answers_json (JSONB or JSON string)
  if(row.answers_json !== null && row.answers_json !== undefined){
    let aj = row.answers_json;
    if(typeof aj === 'string'){ try{ aj = JSON.parse(aj); }catch(e){ aj = null; } }
    if(Array.isArray(aj)) answers = aj;
  }
  // Fallback candidates
  if(!answers){
    const cands = [row.answers_ru, row.answers_en, row.answers, row.options];
    for(const c of cands){
      if(Array.isArray(c)){ answers = c; break; }
      if(typeof c === 'string'){
        try{ const p = JSON.parse(c); if(Array.isArray(p)){ answers = p; break; } }catch(e){}
      }
    }
  }
  answers = (answers || []).map(String).filter(a => a.trim() !== '');

  // ── Correct index — normalise to 0-based ────────────────────────
  let correctIdx = null;
  if(Number.isInteger(row.correct_index)) correctIdx = row.correct_index;
  else if(Number.isInteger(row.correctIndex)) correctIdx = row.correctIndex;
  else if(Number.isInteger(row.c)) correctIdx = row.c;
  else if(typeof row.correct_answer === 'string'){
    // 'A','B','C'… → 0,1,2…
    const letter = row.correct_answer.trim().toUpperCase();
    if(/^[A-F]$/.test(letter)) correctIdx = letter.charCodeAt(0) - 65;
    // numeric string '0','1'…
    else if(!isNaN(parseInt(row.correct_answer, 10))) correctIdx = parseInt(row.correct_answer, 10);
  }

  // ── Media ────────────────────────────────────────────────────────
  const mtype = row.media_type || 'none';
  const murl  = row.image_url || row.audio_url || row.video_url || row.media_url || '';
  const media = { type: mtype, url: murl, filename: '', placeholder: '' };

  return {
    id:   row.id,
    _id:  row.id,
    q:    qText,
    a:    answers,
    c:    correctIdx !== null ? correctIdx : 0,
    correct_index: correctIdx !== null ? correctIdx : 0,
    cat:  row.category || row.cat || 'GENERAL',
    t:    20 + (answers.length * 5),
    img:  mtype === 'image' ? murl : null,
    audio: mtype === 'audio' ? murl : null,
    video: mtype === 'video' ? murl : null,
    media,
    explanation:    row.explanation_ru || row.explanation || '',
    explanation_ru: row.explanation_ru || '',
    status:         row.status || 'published',
    import_key:     row.import_key || null,
    _importKey:     row.import_key || null,
    _mediaType:     mtype,
    _questionType:  row.question_type || 'multiple_choice',
    _rawCorrect:    correctIdx, // keep original for validation
  };
}

// Loads published questions from Supabase for Quick Play use.
// Returns normalised + validated array, or [] on error.
async function loadPublishedQuickQuestionsFromDB(){
  try{
    const {data, error} = await sb
      .from('questions')
      .select('*')
      .eq('status', 'published')
      .eq('source_type', 'official_general')
      .order('created_at', {ascending: false})
      .limit(1000);
    if(error) throw error;
    const rows = data || [];
    const normalised = rows
      .map(row => normalizeDBQuestionForQuickPlay(row))
      .filter(q => q && isPlayableQuestion(q));
    console.log(`[MFC] loadPublishedQuickQuestionsFromDB: ${rows.length} rows → ${normalised.length} playable`);
    return normalised;
  }catch(e){
    console.warn('[MFC] loadPublishedQuickQuestionsFromDB failed:', e.message);
    return [];
  }
}

// Shows a friendly "no new questions" state on the daily-limit screen.
function showNoFreshQuickQuestionsScreen(){
  if(typeof stopIntegrity === 'function') stopIntegrity();
  showDailyLimitScreen('training'); // sets up the screen structure
  const L = lang === 'ru';
  const title = document.getElementById('dl-title');
  const sub   = document.getElementById('dl-sub');
  if(title) title.textContent = L
    ? '🧠 Новые бесплатные вопросы закончились'
    : '🧠 No fresh free questions left';
  if(sub) sub.textContent = L
    ? 'Вы уже сыграли все доступные бесплатные вопросы. Возвращайтесь позже или играйте в паки.'
    : "You've played all available free questions. Come back later or play packs.";
}

// ─── GOLD STANDARD pack builder (Fix 2) ──────────────────────────
// Groups questions by answer count and picks exactly 2 of each type
// (2,3,4,5,6 options) → 10 questions in order 2,2,3,3,4,4,5,5,6,6
// Returns null and shows toast if any type has < 2 questions.
function buildStandardPackQuestions(questions){
  const byCount = {2:[], 3:[], 4:[], 5:[], 6:[]};
  for(const q of questions){
    const n = Array.isArray(q.a) ? q.a.length : 0;
    if(n >= 2 && n <= 6) byCount[n].push(q);
  }
  // Check if we have at least 2 of each type
  const missing = [2,3,4,5,6].filter(n => byCount[n].length < 2);
  if(missing.length){
    const counts = [2,3,4,5,6].map(n => n+'вар.:'+byCount[n].length).join(', ');
    toast('⚠️ В паке не хватает вопросов: нужно по 2 каждого типа 2/3/4/5/6 | ' + counts, 4000);
    if(isAdmin()){
      console.warn('[MFC] buildStandardPackQuestions: missing types', missing, '| counts:', byCount);
    }
    return null;
  }
  // Pick 2 of each, shuffle within each bucket, order: 2,2,3,3,4,4,5,5,6,6
  const result = [];
  for(const n of [2,3,4,5,6]){
    const shuffled = byCount[n].sort(()=>Math.random()-.5);
    result.push(shuffled[0], shuffled[1]);
  }
  return result; // exactly 10
}

// ─── EXTRACTED QUESTION pack (standard quiz UI) ──────────────────
function startExtractedPack(data, packTitle, importKey){
  // Map to playable format
  console.error('[MFC-KEYS]', Object.keys(data[0]||{}).join(','));
  console.error('[MFC-ANS]', 'answers_json='+JSON.stringify(data[0]?.answers_json), 'answers_ru='+JSON.stringify(data[0]?.answers_ru));
  let mapped = data.map(q=>{
    const ans = Array.isArray(q.answers_ru) ? q.answers_ru :
                Array.isArray(q.answers_json) ? q.answers_json :
                Array.isArray(q.answers) ? q.answers : [];
    const slideImgUrl = q.slide_img_url||null;
    const imgUrl = q.image_url||slideImgUrl||null;
    const audUrl = q.audio_url||null;
    const vidUrl = q.video_url||null;
    const mediaUrl = imgUrl||audUrl||vidUrl||'';
    const mediaType = q.media_type || (vidUrl?'video':audUrl?'audio':imgUrl?'image':'none');
    return {
      ...q,  // preserve all DB fields so toPlayableQuestion can find them
      cat: q.category||'GENERAL',
      q: lang==='ru'?(q.question_ru||q.question_text||''):(q.question_text||q.question_ru||''),
      a: ans,
      c: q.correct_index||0,
      t: q.question_type==='info' ? 0 : (25 + (ans.length || 4) * 5),
      img: slideImgUrl || (mediaType==='image'?imgUrl:null),
      audio: mediaType==='audio'?audUrl:null,
      video: mediaType==='video'?vidUrl:null,
      slide_img_url:        q.slide_img_url||null,
      answer_slide_img_url: q.answer_slide_img_url||null,
      explanation_ru:  q.explanation_ru||null,
      _mediaType:      mediaType,
      _questionType:   q.question_type||'multiple_choice',
      status: q.status||'published',
      media: { type: mediaType, url: mediaUrl, filename:'', placeholder:'' },
      _id: q.id, _importKey: q.import_key||null,
    };
  });

  // Filter out unplayable questions
  let playable = filterPlayableQuestions(mapped, {logBad: true});

  if(playable.length === 0){
    toast(lang==='ru' ? '⚠️ В паке нет пригодных вопросов' : '⚠️ No playable questions in pack', 3000);
    return;
  }

  // Admins can play any number of questions without the 10-question standard check
  let finalQ;
  if(isAdmin()){
    finalQ = playable;
  } else {
    // Apply gold standard: 2×2opt, 2×3opt, 2×4opt, 2×5opt, 2×6opt
    finalQ = buildStandardPackQuestions(playable);
    if(!finalQ){
      return;
    }
  }
  setState({ curQ: finalQ });
  if(window._syncStateToLegacy) window._syncStateToLegacy();

  setState({ qIdx: 0, correctCount: 0, streak: 0, bestStreak: 0, roundScore: 0 });
  _gameStartTime=Date.now(); _gameId=null;
  buildDots('prog-dots', curQ.length);
  track('pack_started', {pack:importKey, mode:'extracted', count:curQ.length});
  createGameRow('pack');
  startIntegrity('pack');
  _currentGameCountsDailyLimit = false; // packs don't count toward daily limit
  showScreen('quiz'); loadQ();
}

// ─── SLIDE DECK engine ────────────────────────────────────────────
// ═══════════════════════════════════════════

// QUIZ
// ═══════════════════════════════════════════
function showExplanation(q, isCorrect){
  const block = document.getElementById('explanation-block');
  const img = document.getElementById('explanation-img');
  if(!block || !img) return;

  let hasContent = false;

  // Show explanation image (answer slide)
  console.error('[MFC-DEBUG] showExplanation answer_slide_img_url=', q.answer_slide_img_url, 'explanation_img=', q.explanation_img);
  if(q.answer_slide_img_url||q.explanation_img){
    img.src = q.answer_slide_img_url||q.explanation_img;
    img.style.display = 'block';
    hasContent = true;
  } else {
    img.style.display = 'none';
  }

  // Show explanation text
  let textEl = document.getElementById('explanation-text');
  if(!textEl){
    textEl = document.createElement('div');
    textEl.id = 'explanation-text';
    textEl.style.cssText = 'padding:8px 12px 10px;font-size:13px;color:var(--muted);line-height:1.5';
    block.appendChild(textEl);
  }
  if((q.explanation_ru || q.explanation) && (q.explanation_ru||q.explanation||'').length > 3){
    textEl.textContent = q.explanation_ru || q.explanation;
    textEl.style.display = 'block';
    hasContent = true;
  } else {
    textEl.style.display = 'none';
  }

  block.style.display = hasContent ? 'block' : 'none';
  // Scroll "Далее" button into view so user never has to hunt for it
  if(hasContent){
    setTimeout(()=>{
      const btn = document.getElementById('next-btn');
      if(btn) btn.scrollIntoView({behavior:'smooth', block:'nearest'});
    }, 120);
  }
}

function hideExplanation(){
  const block = document.getElementById('explanation-block');
  if(block) block.style.display = 'none';
  const img = document.getElementById('explanation-img');
  if(img){ img.src = ''; img.style.display = 'none'; }
  const textEl = document.getElementById('explanation-text');
  if(textEl) textEl.style.display = 'none';
}


// ── normalizeAndShuffleQuestion ───────────────────────────────────
// Shuffles answer array, recalculates correct index.
// Works for both DB questions (question_ru/answers_ru) and ALL_Q format.
// Does NOT mutate the original — returns a new object.
function normalizeAndShuffleQuestion(q) {
  if (!q || !Array.isArray(q.a) || q.a.length < 2) return q;
  const original = q.a;
  const correctAns = original[q.c ?? 0];
  // Fisher-Yates shuffle on a copy
  const shuffled = [...original];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const newCorrectIdx = shuffled.indexOf(correctAns);
  return { ...q, a: shuffled, c: newCorrectIdx };
}
window.normalizeAndShuffleQuestion = normalizeAndShuffleQuestion;

function loadQ(){
  answered=false;clearInterval(timerInt);
  hideExplanation();
  // Normalize before rendering
  let q=toPlayableQuestion(curQ[qIdx]);
  q=normalizeAndShuffleQuestion(q); // shuffle answers so correct isn't always A
  curQ[qIdx]=q;

  // Info slide (organizational — round header, rules, etc.) — just show image + Next
  if(q._questionType === 'info' || q.question_type === 'info'){
    document.getElementById('cat-pill').textContent = q.cat||'';
    document.getElementById('q-counter').textContent = (qIdx+1)+'/'+curQ.length;
    document.getElementById('q-text').textContent = '';
    document.getElementById('answers').innerHTML = '';
    document.getElementById('fb').className = 'fb';
    document.getElementById('timer-fill').style.width = '0%';
    document.getElementById('t-val').textContent = '';
    renderQMedia('q-media-container', q);
    setDot('prog-dots', qIdx, 'active');
    answered = true; // allow next immediately
    const nb = document.getElementById('next-btn');
    nb.className = 'next-btn show';
    nb.textContent = lang==='ru' ? 'Далее →' : 'Next →';
    return;
  }

  // Record question as seen immediately (before answer) so page-refresh can't repeat it
  if(currentGameType === 'quick' && q._id){
    markQuestionSeen(q._id, 'quick'); // async, fire-and-forget — never blocks UI
  }
  maxT=q.t;timeLeft=q.t;
  document.getElementById('cat-pill').textContent=q.cat;
  document.getElementById('q-counter').textContent=(qIdx+1)+'/'+curQ.length;
  // Hide question text when slide image is present (text is already in the image)
  const qEl = document.getElementById('q-text');
  if(q.slide_img_url || q.img) {
    qEl.textContent = '';
    qEl.style.display = 'none';
  } else {
    qEl.style.display = '';
    if(q.question_html_ru && lang==='ru'){
      const safe = q.question_html_ru.replace(/<(?!\/?(b|strong|i|em|br|span)[^>]*>)/gi,'&lt;');
      qEl.innerHTML = safe;
    } else {
      qEl.textContent = q.q;
    }
  }
  document.getElementById('fb').className='fb';
  document.getElementById('next-btn').className='next-btn';
  document.getElementById('next-btn').textContent=t('next');
  // Render media if present
  renderQMedia('q-media-container', q);
  // Report button
  setTimeout(()=>renderReportBtn('quiz-inner', curQ[qIdx]), 50);
  // Use already-shuffled question (shuffled above)
  const qNorm = curQ[qIdx];

  const ans=document.getElementById('answers');ans.innerHTML='';

  if(!qNorm.a||qNorm.a.length<2){
    console.error('[MFC-NOANSWERS] a='+JSON.stringify(qNorm.a)+' answers_json='+JSON.stringify(qNorm.answers_json)+' answers_ru='+JSON.stringify(qNorm.answers_ru));
    track('question_render_error',{id:qNorm._id,q:(qNorm.q||'').slice(0,50)});
    const errDiv=document.createElement('div');
    errDiv.style.cssText='background:rgba(224,85,85,.15);border:0.5px solid var(--red);border-radius:12px;padding:16px;text-align:center;margin:8px 0';
    errDiv.innerHTML='<div style="color:var(--red);font-weight:800;margin-bottom:8px">⚠️ Ошибка вопроса: нет вариантов ответа</div>'
      +'<button onclick="nextQ()" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Пропустить вопрос</button>';
    ans.appendChild(errDiv);
    setDot('prog-dots',qIdx,'active');
    return; // don't start timer
  }

  // Only multiple_choice — always show answer buttons
  try{
    qNorm.a.forEach((a,i)=>{
      const b=document.createElement('button');b.className='ans';
      b.innerHTML='<span class="ans-l">'+answerLetter(i)+'</span><span>'+a+'</span>';
      b.onclick=()=>pick(i);ans.appendChild(b);
    });
  }catch(renderErr){
    console.error('[MFC] Answer render error:', renderErr);
    track('answer_render_error', {error: renderErr.message, q_idx: qIdx, id: qNorm._id});
    ans.innerHTML = '';
    const errDiv=document.createElement('div');
    errDiv.style.cssText='background:rgba(224,85,85,.15);border:0.5px solid var(--red);border-radius:12px;padding:16px;text-align:center;margin:8px 0';
    errDiv.innerHTML='<div style="color:var(--red);font-weight:800;margin-bottom:8px">⚠️ Ошибка рендера вариантов</div>'
      +'<div style="font-size:12px;color:var(--muted);margin-bottom:12px">'+renderErr.message+'</div>'
      +'<button onclick="nextQ()" style="background:var(--bg3);border:0.5px solid var(--border);border-radius:8px;padding:8px 16px;font-size:13px;font-weight:700;color:var(--muted);cursor:pointer;font-family:inherit">Пропустить вопрос →</button>';
    ans.appendChild(errDiv);
    setDot('prog-dots',qIdx,'miss');
    return;
  }
  setDot('prog-dots',qIdx,'active');renderTimer();
  timerInt=setInterval(tick,1000);
}

function renderTimer(){
  const q=curQ[qIdx];
  const pct=(timeLeft/maxT)*100;
  const fill=document.getElementById('timer-fill');
  fill.style.width=pct+'%';fill.style.background=pct<35?'#e05555':pct<60?'#f0a050':'#6c63ff';
  const tv=document.getElementById('t-val');
  tv.textContent=timeLeft+'s';tv.style.color=timeLeft<=5?'#e05555':timeLeft<=10?'#f0a050':'#8b83ff';
  const pv=document.getElementById('p-val');
  if(pv) pv.textContent='+'+(q ? getTimedPoints((q.a||[]).length||2, timeLeft, maxT) : 30);
}
function tick(){if(timeLeft<=0){clearInterval(timerInt);expire();return;}timeLeft--;renderTimer();}
function expire(){
  if(answered)return;answered=true;streak=0;updStreak();
  incrementDailyQuestion(); // count timed-out question too
  const q=curQ[qIdx];
  document.querySelectorAll('#answers .ans').forEach((b,i)=>{b.disabled=true;if(i===q.c)b.className='ans correct';});
  showFb('fb',"⏱ "+q.a[q.c],false);
  setDot('prog-dots',qIdx,'miss');
  document.getElementById('next-btn').className='next-btn show';
  _updateNextBtnLabel();
  saveAnswerRow(-1, q, 0, false, maxT*1000, true);
  track('question_answered', {correct: false, cat: q.cat, q_idx: qIdx, timeout: true});
  showExplanation(q, false);
}

// ── State sync helper ─────────────────────────────────────────────
// Keeps state.js in sync with legacy globals so _syncStateToLegacy()
// never overwrites active quiz state with stale data.
function _syncQuizStateToStore() {
  if (window._appState && window._appState.setState) {
    window._appState.setState({
      curQ, qIdx, correctCount, streak, bestStreak,
      roundScore: _roundScore, answered,
    });
  }
}

function pick(i){
  if(answered)return;answered=true;clearInterval(timerInt);
  incrementDailyQuestion(); // count this question toward daily limit
  const q=curQ[qIdx];
  document.querySelectorAll('#answers .ans').forEach(b=>b.disabled=true);
  const pts=getTimedPoints(q.a.length, timeLeft, maxT);
  const responseMs = _qStartTime ? Date.now()-_qStartTime : null;
  const isCorrect = i===q.c;
  track('question_answered', {correct: isCorrect, cat: q.cat, q_idx: qIdx, time_ms: responseMs});
  if(isCorrect){
    const correctBtn = document.querySelectorAll('#answers .ans')[i];
    correctBtn.className='ans correct';
    // Correct answer animation
    correctBtn.classList.add('burst');
    setTimeout(()=>correctBtn.classList.remove('burst'), 550);
    const rect = correctBtn.getBoundingClientRect();
    const fl = document.createElement('div');
    fl.className = 'float-score';
    fl.textContent = '+' + pts;
    fl.style.left = (rect.left + rect.width/2 - 20) + 'px';
    fl.style.top = (rect.top + window.scrollY - 10) + 'px';
    fl.style.position = 'fixed';
    document.body.appendChild(fl);
    setTimeout(()=>fl.remove(), 950);
    correctCount += 1;
    streak += 1;
    _roundScore += pts;
    if(streak>bestStreak)bestStreak=streak;
    _syncQuizStateToStore();
    updNeurons();
    const gsv = document.getElementById('game-score-val');
    if(gsv) gsv.textContent = _roundScore;
    const pillEl=document.getElementById('n-quiz').closest('.neurons-pill');
    if(pillEl){pillEl.classList.add('pop');setTimeout(()=>pillEl.classList.remove('pop'),220);}
    showFb('fb',(streak>1?'🔥 '+streak+'x! ':'✓ ')+'+'+pts,true);
    setDot('prog-dots',qIdx,'done');
  } else {
    document.querySelectorAll('#answers .ans')[i].className='ans wrong';
    document.querySelectorAll('#answers .ans')[q.c].className='ans correct';
    streak=0;
    _syncQuizStateToStore();
    showFb('fb','✗ '+q.a[q.c],false);
    setDot('prog-dots',qIdx,'miss');
  }
  updStreak();
  _roundAnswers[qIdx] = i;
  saveAnswerRow(i, q, pts, isCorrect, responseMs, false);
  document.getElementById('next-btn').className='next-btn show';
  _updateNextBtnLabel();
  // Show explanation slide after answering
  showExplanation(q, isCorrect);
}
function updStreak(){
  const el=document.getElementById('streak-pill');
  if(streak>=2){el.style.display='flex';document.getElementById('streak-num').textContent=streak;}
  else el.style.display='none';
}
function _updateNextBtnLabel(){
  const btn = document.getElementById('next-btn');
  if(!btn) return;
  const isLast = qIdx >= curQ.length - 1;
  btn.textContent = isLast ? (lang==='ru' ? 'Показать результат →' : 'Show result →') : t('next');
}
function nextQ(){
  stopAudio();
  qIdx++;
  _syncQuizStateToStore();
  if(qIdx >= curQ.length){
    try{ showScore(); }
    catch(e){
      console.error('[MFC] showScore error:', e);
      track('show_score_error', {error: e.message});
      showScreen('score');
    }
  } else {
    loadQ();
    _updateNextBtnLabel();
  }
}
async function loadScoreCityRank(){
  const card = document.getElementById('sc-city-rank-card');
  if(!card) return;
  if(!currentUser){ card.style.display='none'; return; }
  card.style.display = '';
  try{
    // Get all profiles with neurons > 0, ordered by neurons desc
    const {data: top} = await sb.from('profiles')
      .select('id,display_name,neurons,city')
      .gt('neurons',0)
      .order('neurons',{ascending:false})
      .limit(200);
    if(!top || !top.length){ card.style.display='none'; return; }
    const myIdx = top.findIndex(p=>p.id===currentUser.id);
    const rank = myIdx >= 0 ? myIdx+1 : top.length+1;
    const myNeurons = neurons;
    const above = myIdx > 0 ? top[myIdx-1] : null;
    const gap = above ? (above.neurons - myNeurons) : 0;
    document.getElementById('sc-city-place').textContent = '#' + rank;
    document.getElementById('sc-city-name').textContent =
      rank === 1 ? '🥇 Ты на первом месте!' :
      `из ${top.length} участников`;
    document.getElementById('sc-city-gap').textContent = above && gap > 0
      ? `До #${rank-1}: ${gap} ⚡`
      : '';
  }catch(e){
    card.style.display='none';
  }
}

function spawnConfetti(){
  const colors = ['#6c63ff','#f0c040','#44cc88','#e05555','#8b83ff','#ff6b9d','#00d4ff'];
  const scoreEl = document.getElementById('sc-neurons');
  const rect = scoreEl ? scoreEl.getBoundingClientRect() : {left: window.innerWidth/2, top: 120, width:0};
  for(let i = 0; i < 36; i++){
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.background = colors[i % colors.length];
    piece.style.left = (rect.left + rect.width/2 - 4 + (Math.random()-0.5)*120) + 'px';
    piece.style.top  = (rect.top + (Math.random()-0.5)*30) + 'px';
    piece.style.animationDelay = (Math.random() * 0.4) + 's';
    piece.style.animationDuration = (0.9 + Math.random() * 0.5) + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    document.body.appendChild(piece);
    setTimeout(()=>piece.remove(), 1800);
  }
}

async function _loadPackLeaderboard(packMode, myScore){
  const lbEl = document.getElementById('sc-pack-leaderboard');
  const rowsEl = document.getElementById('sc-pack-lb-rows');
  if(!lbEl || !rowsEl || !window.sb) return;
  lbEl.style.display = 'block';
  rowsEl.innerHTML = '<div style="color:var(--muted);font-size:12px">Загружаем...</div>';
  try {
    const {data} = await window.sb.from('game_sessions')
      .select('user_id, score')
      .eq('mode', packMode)
      .order('score', {ascending: false})
      .limit(10);
    if(!data || !data.length){ lbEl.style.display='none'; return; }
    // Get user names
    const uids = [...new Set(data.map(r=>r.user_id))];
    const {data: profiles} = await window.sb.from('profiles')
      .select('id,display_name,username')
      .in('id', uids);
    const nameMap = Object.fromEntries((profiles||[]).map(p=>[p.id, p.display_name||p.username||'Игрок']));
    const myId = window.currentUser?.id;
    rowsEl.innerHTML = data.map((r,i)=>{
      const isMe = r.user_id === myId && r.score === myScore;
      const medal = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}.`;
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:10px;background:${isMe?'rgba(108,99,255,.18)':'var(--bg3)'};${isMe?'border:1px solid var(--accent);':''}">
        <span style="font-size:16px;min-width:24px">${medal}</span>
        <span style="flex:1;font-size:13px;font-weight:${isMe?'800':'600'};color:${isMe?'var(--accent2)':'var(--text)'}">${nameMap[r.user_id]||'Игрок'}</span>
        <span style="font-size:13px;font-weight:800;color:var(--gold)">${r.score}</span>
      </div>`;
    }).join('');
  } catch(e){ lbEl.style.display='none'; }
}

function showScore(){
  // Guard: prevent double-execution for the same round
  if(_scoreShownForGame) return;
  _scoreShownForGame = true;

  clearInterval(timerInt);
  // _roundScore already accumulated in pick() - DO NOT overwrite here
  _cityRank = null;

  // Show round score with count-up animation
  const scNeuronsEl = document.getElementById('sc-neurons');
  scNeuronsEl.textContent = '0';
  let n = 0;
  const target = _roundScore;
  const step = Math.max(1, Math.ceil(target / 30));
  const countUp = setInterval(()=>{
    n = Math.min(n + step, target);
    scNeuronsEl.textContent = n;
    if(n >= target){ clearInterval(countUp); }
  }, 35);
  // Brief scale pop on the number
  scNeuronsEl.style.transition = 'transform .15s';
  scNeuronsEl.style.transform = 'scale(1.18)';
  setTimeout(()=>{ scNeuronsEl.style.transform = 'scale(1)'; }, 200);
  // Use globals (curQ/correctCount) as source of truth — they're set by legacy startQuiz
  // state.js curQ may be empty if setState was never called with curQ
  const _totalQs = (Array.isArray(curQ) && curQ.length > 0) ? curQ.length : Math.max(qIdx, correctCount, 1);
  const _acc = _totalQs > 0 ? Math.round(correctCount / _totalQs * 100) : 0;
  document.getElementById('sc-correct').textContent = correctCount + '/' + _totalQs;
  document.getElementById('sc-streak').textContent=bestStreak;
  document.getElementById('sc-acc').textContent= _acc + '%';

  // Confetti when player got ≥ 50% correct
  if(correctCount >= Math.ceil(curQ.length * 0.5)) setTimeout(spawnConfetti, 150);

  // Load city rank teaser asynchronously
  loadScoreCityRank();

  // Update "neurons earned" label
  const scNeuronsLbl = document.getElementById('sc-neurons-lbl');
  if(scNeuronsLbl) scNeuronsLbl.textContent = lang==='ru' ? 'XP + нейронов заработано' : 'neurons earned this game';
  const earned=[];
  if(checkBadges('first'))earned.push('first');
  if(bestStreak>=3&&checkBadges('streak3'))earned.push('streak3');
  if(bestStreak>=5&&checkBadges('streak5'))earned.push('streak5');
  if(correctCount===curQ.length&&checkBadges('perfect'))earned.push('perfect');
  if(neurons>=100&&checkBadges('neurons100'))earned.push('neurons100');
  const popup=document.getElementById('badge-earned-popup');
  if(earned.length>0){showBadgeEarned(earned[0]);popup.classList.add('show');}
  else popup.classList.remove('show');
  const scShareBtn=document.getElementById('sc-share-btn');
  if(scShareBtn)scShareBtn.textContent=lang==='ru'?'📤 Поделиться результатом':'📤 Share result';
  const scAgainBtn=document.getElementById('sc-again-btn');
  if(scAgainBtn)scAgainBtn.textContent=lang==='ru'?'⚡ Играть снова':'⚡ Play again';
  const scDuelBtn=document.getElementById('sc-duel-btn');
  if(scDuelBtn)scDuelBtn.textContent=lang==='ru'?'⚔️ Дуэль':'⚔️ Live Duel';
  // Award earned neurons + xp via server RPC (idempotent by game_id)
  // Save session stats for leaderboard/profile
  if(window._currentSessionId && window.sb){
    window.sb.from('game_sessions').update({
      correct_answers: correctCount,
      questions_count: Array.isArray(curQ) ? curQ.length : 10,
      score:           _roundScore,
    }).eq('id', window._currentSessionId).then(()=>{}).catch(()=>{});
  }
  // Hide game score pill
  const _gsp2 = document.getElementById('game-score-pill');
  if(_gsp2) _gsp2.style.display = 'none';
  // Pack leaderboard: save + show top
  if(currentGameType === 'pack' && currentPackKey && window.sb && window.currentUser){
    const packMode = 'pack:' + currentPackKey;
    window.sb.from('game_sessions').insert({
      user_id: window.currentUser.id, mode: packMode,
      score: _roundScore, correct_answers: correctCount,
      questions_count: Array.isArray(curQ) ? curQ.length : 10,
    }).then(()=>{}).catch(()=>{});
    _loadPackLeaderboard(packMode, _roundScore);
  } else {
    const lbEl = document.getElementById('sc-pack-leaderboard');
    if(lbEl) lbEl.style.display = 'none';
  }
  // Sync team score async (club aggregation)
  if(window.syncTeamScoreAfterGame) window.syncTeamScoreAfterGame();

  if(_roundScore > 0 && _gameId){
    awardNeurons(_roundScore, 'quiz_reward', 'quiz:' + _gameId).then(result => {
      if(result){
        updNeurons();
      }
    });
  } else if(_roundScore > 0) {
    // Guest or no gameId: local only
    setState({ neurons: getState().neurons + _roundScore, xp: getState().xp + _roundScore, roundScore: _roundScore });
    updNeurons();
  }
  window.saveGameStats?.(correctCount,curQ.length,bestStreak);
  completeGameRow(correctCount, curQ.length); // no addSeasonPoints inside
  updateDailyProgress(correctCount, correctCount===curQ.length);
  incrementDailyRounds(); // track daily usage
  stopIntegrity(); // stop anti-cheat tracking
  // Lock quick play as completed for today (hard daily lock)
  if(currentGameType === 'quick'){
    _quickPlayCompletedThisSession = true;
    lockQuickPlayCompleted();
    // Single idempotent RPC call
    activateReferral();
    updateDailyStreakOnQuickPlayComplete();
    // Award weekly club neurons (fire-and-forget)
    window.awardWeeklyNeurons?.(_roundScore || correctCount * 2);
    // Daily goal bonus — 50 ⚡ once per day for completing Quick Play
    const goalBonus = claimDailyGoalBonus();
    if(goalBonus > 0){
      // Show a bonus card on score screen
      setTimeout(()=>{
        const existing = document.getElementById('sc-daily-goal-card');
        if(existing) existing.remove();
        const card = document.createElement('div');
        card.id = 'sc-daily-goal-card';
        card.style.cssText = 'width:100%;background:rgba(68,204,136,.12);border:1px solid rgba(68,204,136,.35);border-radius:14px;padding:12px 16px;margin:8px 0;text-align:center';
        card.innerHTML = `
          <div style="font-size:11px;font-weight:800;letter-spacing:1px;color:var(--green);margin-bottom:4px">🎯 ДНЕВНАЯ ЦЕЛЬ ВЫПОЛНЕНА</div>
          <div style="font-size:20px;font-weight:800;color:var(--gold)">+${goalBonus} ⚡</div>
          <div style="font-size:11px;color:var(--muted);margin-top:4px">Сыграй 10 вопросов сегодня — бонус начислен!</div>`;
        const statsRow = document.querySelector('.stats-row');
        if(statsRow) statsRow.insertAdjacentElement('afterend', card);
      }, 600);
    }
    // Ask for push permission after game (best moment — user just had fun)
    setTimeout(()=>maybeAskPushAfterGame(), 2200);
  }
  track('quiz_completed', {correct: correctCount, total: curQ.length, round_score: _roundScore, total_neurons: neurons, streak: bestStreak});
  track('result_viewed', {correct: correctCount, round_score: _roundScore});
  // Mark first game done (no extra activateReferral here)
  if(!localStorage.getItem('mfc_first_game_done')){
    localStorage.setItem('mfc_first_game_done','1');
  }
  // addSeasonPoints ONCE here with accumulated _roundScore
  if(_roundScore > 0) addSeasonPoints(_roundScore);
  if(_roundScore > 0 && window._syncClubScore) window._syncClubScore(_roundScore);
  if(_roundScore > 0 && window._syncQuizScore) window._syncQuizScore(Math.round(_roundScore*0.5));
  showScreen('score');
  updateScoreScreenButtons(); // Fix 1: update "play again" based on limit

  // Show AI review button if at least 5 questions played
  const aiBtn = document.getElementById('sc-ai-btn');
  if (aiBtn && Array.isArray(curQ) && curQ.length >= 5) {
    aiBtn.style.display = '';
    window._lastRoundQuestions = curQ;
    window._lastRoundAnswers   = [..._roundAnswers];
    window.requestAIReview = async function() {
      aiBtn.style.display = 'none';
      const reviewEl = document.getElementById('sc-ai-review');
      const textEl   = document.getElementById('sc-ai-review-text');
      const catsEl   = document.getElementById('sc-ai-cats');
      if (!reviewEl || !textEl) return;
      reviewEl.style.display = '';
      textEl.textContent = '⏳ Анализируем...';
      try {
        const { data: { session } } = await window.sb.auth.getSession();
        const res = await fetch('https://nhmidxkohjpcnhjucuuh.supabase.co/functions/v1/analyze-game', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + (session?.access_token || ''),
            'apikey': window._supabaseAnonKey || '',
          },
          body: JSON.stringify({
            questions: window._lastRoundQuestions,
            answers:   window._lastRoundAnswers,
            lang:      lang || 'ru',
          }),
        });
        const json = await res.json();
        if (json.ok) {
          textEl.textContent = json.text;
          if (catsEl && json.cats?.length > 1) {
            catsEl.innerHTML = json.cats.map(c =>
              `<span style="background:rgba(${c.pct>=70?'68,204,136':c.pct>=40?'255,193,7':'255,82,82'},.15);border:1px solid rgba(${c.pct>=70?'68,204,136':c.pct>=40?'255,193,7':'255,82,82'},.35);border-radius:20px;padding:4px 10px;font-size:11px;font-weight:700;color:var(--text)">${c.cat} ${c.pct}%</span>`
            ).join('');
          }
        } else {
          textEl.textContent = 'Не удалось получить разбор 😔';
        }
      } catch(e) {
        textEl.textContent = 'Ошибка: ' + e.message;
      }
    };
  } else if (aiBtn) {
    aiBtn.style.display = 'none';
  }
}

function restartQuiz(){
  // Triple guard: game type, session flag, and persistent daily lock
  if(currentGameType === 'quick' || _quickPlayCompletedThisSession || isQuickPlayLocked()){
    showDailyLimitScreen('training');
    return;
  }
  if(currentGameType === 'pack' && currentPackKey){
    playDBPack(currentPackKey);
  } else if(currentGameType === 'community'){
    startCommunityFeed();
  } else if(currentGameType === 'daily'){
    playDailyChallenge();
  } else {
    // unknown — safe default
    showDailyLimitScreen('training');
  }
}

// Update score screen "Play again" button based on game type
function updateScoreScreenButtons(){
  const scAgainBtn = document.getElementById('sc-again-btn');
  if(!scAgainBtn) return;
  // Remove any inline onclick attribute that may compete with .onclick
  scAgainBtn.removeAttribute('onclick');
  scAgainBtn.disabled = false;

  // Triple guard: game type, session completion flag, persistent daily lock
  const isQuickLocked = currentGameType === 'quick'
    || _quickPlayCompletedThisSession
    || isQuickPlayLocked();

  if(isQuickLocked){
    scAgainBtn.textContent = lang==='ru' ? '🔒 Лимит на сегодня исчерпан' : '🔒 Daily limit reached';
    scAgainBtn.onclick = function(e){ e.preventDefault(); showDailyLimitScreen('training'); return false; };
  } else if(currentGameType === 'pack' && currentPackKey){
    scAgainBtn.textContent = lang==='ru' ? '🔄 Играть пак снова' : '🔄 Play pack again';
    scAgainBtn.onclick = function(e){ e.preventDefault(); playDBPack(currentPackKey); return false; };
  } else if(currentGameType === 'community'){
    scAgainBtn.textContent = lang==='ru' ? '🌐 Ещё вопросы участников' : '🌐 More community questions';
    scAgainBtn.onclick = function(e){ e.preventDefault(); startCommunityFeed(); return false; };
  } else if(currentGameType === 'daily'){
    scAgainBtn.textContent = lang==='ru' ? '🎯 Задание дня' : '🎯 Daily Challenge';
    scAgainBtn.onclick = function(e){ e.preventDefault(); playDailyChallenge(); return false; };
  } else {
    scAgainBtn.textContent = lang==='ru' ? '🔒 Лимит на сегодня исчерпан' : '🔒 Daily limit reached';
    scAgainBtn.onclick = function(e){ e.preventDefault(); showDailyLimitScreen('training'); return false; };
  }
}

// ─── SHARE ─────────────────────────────────────────────────────────────────
async function fetchCityRank(){
  if(!currentUser) return null;
  const city = localStorage.getItem('mfc_city');
  if(!city) return null;
  try{
    const {data} = await sb.from('profiles')
      .select('id,total_score')
      .eq('city', city)
      .order('total_score',{ascending:false})
      .limit(100);
    if(!data) return null;
    const rank = data.findIndex(p=>p.id===currentUser.id)+1;
    return rank > 0 ? rank : null;
  }catch(e){ return null; }
}

async function showShareScreen(){
  track('share_screen_viewed', {score: _roundScore||neurons, correct: correctCount});
  // Save for challenge-share mechanic
  window._lastRoundScore = _roundScore || (correctCount * 20);
  window._lastRoundAcc   = curQ.length > 0 ? Math.round(correctCount / curQ.length * 100) : 0;
  const city = localStorage.getItem('mfc_city')||'';
  const roundPts = _roundScore || (correctCount * 20);
  const accuracy = curQ.length>0?Math.round(correctCount/curQ.length*100):0;

  document.getElementById('share-score').textContent = roundPts;
  document.getElementById('share-label').textContent = lang==='ru'?'очков в этом раунде':'points this round';

  // Fetch city rank async
  const rank = await fetchCityRank();
  _cityRank = rank;
  const rankTxt = rank ? (lang==='ru'?'#'+rank+' в '+city+' сегодня':'#'+rank+' in '+city+' today') : '';
  document.getElementById('share-rank').textContent = accuracy+'% · '+getState().correctCount+'/'+getState().curQ.length+(rankTxt?' · '+rankTxt:'');
  const cityEl=document.getElementById('share-city');
  cityEl.textContent = city ? '📍 '+city+(rank?' · Rank #'+rank:'') : (lang==='ru'?'Добавь город → получи ранг':'Add city → get your rank');
  document.getElementById('n-share').textContent = neurons;
  document.getElementById('sh-tg').textContent = lang==='ru'?'Поделиться в Telegram':'Share to Telegram';
  document.getElementById('sh-wa').textContent = lang==='ru'?'Поделиться в WhatsApp':'Share to WhatsApp';
  document.getElementById('sh-copy').textContent = lang==='ru'?'Скопировать':'Copy';
  document.getElementById('sh-duel').textContent = lang==='ru'?'Вызвать на дуэль':'Challenge a friend';
  const shTeam = document.getElementById('sh-team'); if (shTeam) shTeam.textContent = lang==='ru'?'Вступить в клуб':'Join / create club';
  document.getElementById('sh-home').textContent = lang==='ru'?'← На главную':'← Back to home';
  showScreen('share');
}

function getShareText(){
  const city = localStorage.getItem('mfc_city');
  const acc = curQ.length>0?Math.round(correctCount/curQ.length*100):0;
  const roundPts = _roundScore || (correctCount * 20);
  const refCode = getOrCreateRefCode();
  const link = location.origin+location.pathname+(refCode?'?ref='+refCode:'');
  const rankLine = _cityRank && city ? (lang==='ru'?`\n🏙️ #${_cityRank} в ${city}`:`\n🏙️ #${_cityRank} in ${city}`) : '';

  if(lang==='ru'){
    return `⚡ Я набрал ${roundPts} очков в Brain Fight Club!\n🎯 ${correctCount}/${curQ.length} правильных (${acc}%)${rankLine}\nСможешь лучше? 🧠\n${link}`;
  }
  return `⚡ I scored ${roundPts} points in Brain Fight Club!\n🎯 ${correctCount}/${curQ.length} correct (${acc}%)${rankLine}\nCan you beat me? 🧠\n${link}`;
}

function shareToTelegram(){
  track('share_to_telegram_clicked', {score: _roundScore, correct: correctCount});
  const text = encodeURIComponent(getShareText());
  window.open('https://t.me/share/url?url='+encodeURIComponent(location.origin+location.pathname)+'&text='+text,'_blank');
}
function shareToWhatsApp(){
  track('share_to_whatsapp_clicked', {score: _roundScore, correct: correctCount});
  const text = encodeURIComponent(getShareText());
  window.open('https://wa.me/?text='+text,'_blank');
}
function copyShareLink(){
  track('copy_share_clicked', {score: _roundScore, correct: correctCount});
  const text = getShareText();
  navigator.clipboard.writeText(text).then(()=>{
    const btn=document.getElementById('sh-copy');
    if(btn){btn.textContent='✓ '+(lang==='ru'?'Скопировано!':'Copied!');setTimeout(()=>btn.textContent=lang==='ru'?'🔗 Скопировать':'🔗 Copy',2000);}
  }).catch(()=>{});
}

// ─── SHARE CARD (Canvas image export) ─────────────────────────────────────
function drawShareCard(){
  const canvas = document.getElementById('share-canvas');
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const W = 1080, H = 1080;
  canvas.width = W; canvas.height = H;

  // Dark background
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0d0d1a'); bg.addColorStop(0.5, '#111128'); bg.addColorStop(1, '#0a0a18');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

  // Glow top-right
  ctx.save(); ctx.globalAlpha = 0.13;
  const g1 = ctx.createRadialGradient(W, 0, 0, W, 0, 620);
  g1.addColorStop(0, '#8b83ff'); g1.addColorStop(1, 'transparent');
  ctx.fillStyle = g1; ctx.fillRect(0, 0, W, H); ctx.restore();

  // Glow bottom-left
  ctx.save(); ctx.globalAlpha = 0.09;
  const g2 = ctx.createRadialGradient(0, H, 0, 0, H, 520);
  g2.addColorStop(0, '#f0c040'); g2.addColorStop(1, 'transparent');
  ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H); ctx.restore();

  // Header
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.font = 'bold 46px Arial'; ctx.textAlign = 'left';
  ctx.fillText('BRAIN FIGHT CLUB', 80, 98);
  ctx.strokeStyle = 'rgba(108,99,255,0.4)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(80, 118); ctx.lineTo(W-80, 118); ctx.stroke();

  // Score big number
  const score = document.getElementById('share-score')?.textContent || '0';
  const label = document.getElementById('share-label')?.textContent || 'очков';
  ctx.fillStyle = '#f0c040';
  ctx.font = 'bold 230px Arial'; ctx.textAlign = 'center';
  ctx.fillText(score, W/2, 430);
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = 'bold 44px Arial';
  ctx.fillText(label.toUpperCase(), W/2, 498);

  // Stats row
  const rank = document.getElementById('share-rank')?.textContent || '';
  if (rank) {
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.font = '38px Arial'; ctx.fillText(rank, W/2, 590);
  }

  // City
  const city = document.getElementById('share-city')?.textContent || '';
  if (city && !city.includes('Добавь')) {
    ctx.fillStyle = '#8b83ff'; ctx.font = 'bold 38px Arial';
    ctx.fillText(city, W/2, 660);
  }

  // Streak
  const streakEl = document.getElementById('share-streak-row');
  if (streakEl?.style.display !== 'none' && streakEl?.textContent?.trim()) {
    ctx.fillStyle = '#ff9f43'; ctx.font = 'bold 44px Arial';
    ctx.fillText(streakEl.textContent, W/2, 740);
  }

  // Bottom line + CTA
  ctx.strokeStyle = 'rgba(108,99,255,0.3)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(80, H-150); ctx.lineTo(W-80, H-150); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.font = '34px Arial';
  ctx.fillText('brainfightclub.com · Проверь себя!', W/2, H-78);

  return canvas;
}

async function downloadShareCard(){
  const canvas = drawShareCard();
  if (!canvas) return;
  if (navigator.share && navigator.canShare) {
    canvas.toBlob(async blob => {
      const file = new File([blob], 'bfc-result.png', { type: 'image/png' });
      try {
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: 'Brain Fight Club', text: getShareText() });
          track('share_card_native', { score: _roundScore }); return;
        }
      } catch(e) { /* fallback to download */ }
      _triggerCanvasDownload(canvas);
    }, 'image/png');
    return;
  }
  _triggerCanvasDownload(canvas);
}

function _triggerCanvasDownload(canvas){
  const a = document.createElement('a');
  a.download = 'bfc-result.png';
  a.href = canvas.toDataURL('image/png');
  a.click();
  track('share_card_downloaded', { score: _roundScore });
}

// ─── PROFILE CITY ──────────────────────────────────────────────────────────
function toggleNameEdit(){
  const edit = document.getElementById('profile-name-edit');
  const btn  = document.getElementById('profile-name-btn');
  if (!edit) return;
  const isOpen = edit.style.display !== 'none';
  edit.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? '✏️ Изменить имя' : 'Отмена';
  if (!isOpen) {
    const inp = document.getElementById('profile-name-input');
    inp.value = document.getElementById('profile-name')?.textContent || '';
    inp.focus();
  }
}
async function saveProfileName(){
  const name = document.getElementById('profile-name-input').value.trim();
  if (!name) return;
  document.getElementById('profile-name').textContent = name;
  localStorage.setItem('mfc_display_name', name);
  document.getElementById('profile-name-edit').style.display = 'none';
  document.getElementById('profile-name-btn').textContent = '✏️ Изменить имя';
  if (currentUser) {
    sb.from('profiles').upsert({ id: currentUser.id, display_name: name, updated_at: new Date().toISOString() }, { onConflict: 'id' }).then(()=>{}).catch(()=>{});
  }
  toast(lang === 'ru' ? '✓ Имя сохранено' : '✓ Name saved');
}

function toggleCityEdit(){
  const edit=document.getElementById('profile-city-edit');
  const btn=document.getElementById('profile-city-btn');
  if(!edit)return;
  const isOpen=edit.style.display!=='none';
  edit.style.display=isOpen?'none':'block';
  btn.style.display=isOpen?'':'none';
  if(!isOpen){
    const input=document.getElementById('profile-city-input');
    input.value=localStorage.getItem('mfc_city')||'';
    input.focus();
  }
}
async function saveProfileCity(){
  const city=document.getElementById('profile-city-input').value.trim();
  if(city){
    localStorage.setItem('mfc_city',city);
    const cityDisplay=document.getElementById('profile-city-display');
    const cityTag=document.getElementById('profile-city-tag');
    const cityBtn=document.getElementById('profile-city-btn');
    if(cityDisplay)cityDisplay.textContent=city;
    if(cityTag)cityTag.style.display='inline-flex';
    if(cityBtn)cityBtn.style.display='none';
    document.getElementById('profile-city-edit').style.display='none';
    if(currentUser){
      sb.from('profiles').upsert({id:currentUser.id,city,updated_at:new Date().toISOString()},{onConflict:'id'}).then(()=>{}).catch(()=>{});
      // user_profiles city/name update only — balance NOT written here (RPC only)
      sb.from('user_profiles').update({city,display_name:currentUser.user_metadata?.full_name||currentUser.email?.split('@')[0]||'Игрок',updated_at:new Date().toISOString()}).eq('id',currentUser.id).then(()=>{}).catch(()=>{});
    }
    track('city_added', {city});
    toast(lang==='ru'?'📍 Город сохранён — теперь ты в городском рейтинге!':'📍 City saved — you\'re in the city leaderboard!');
  }
}
function renderProfileCity(){
  const city=localStorage.getItem('mfc_city')||'';
  const cityDisplay=document.getElementById('profile-city-display');
  const cityTag=document.getElementById('profile-city-tag');
  const cityBtn=document.getElementById('profile-city-btn');
  if(cityDisplay)cityDisplay.textContent=city;
  if(cityTag)cityTag.style.display=city?'inline-flex':'none';
  if(cityBtn){
    cityBtn.style.display=city?'none':'';
    cityBtn.textContent=lang==='ru'?'+ Добавить город':'+ Add city';
  }
}

// ═══════════════════════════════════════════


// ── Analytics: plan limit events ─────────────────────────────────
// Called when user hits daily training limit
function _trackTrainingLimitReached() {
  if (typeof window.track === 'function') {
    const plan = window._userSubscription?.plan || 'free';
    const used  = window._userSubscription?.trainingUsedToday ?? '?';
    const limit = window._userSubscription?.trainingLimit ?? 10;
    window.track('training_limit_reached', { plan, used, limit });
    window.track('premium_paywall_viewed', { trigger: 'training_limit', plan });
  }
}
// Called when premium paywall is shown
function _trackPremiumPaywallViewed(trigger) {
  if (typeof window.track === 'function') {
    window.track('premium_paywall_viewed', { trigger });
  }
}


// ── window exports (inline onclick compatibility) ─────────────────
window.startQuickPlay = startQuickPlay; // training.js is the only owner
if (typeof pick            !== 'undefined') window.pick = pick; // training.js is the only owner
if (typeof showScore       !== 'undefined') window.showScore = showScore; // training.js is the only owner
if (typeof loadQ           !== 'undefined') window.loadQ = loadQ; // training.js is the only owner
if (typeof getFixedPoints  !== 'undefined') window.getFixedPoints  = getFixedPoints;
if (typeof claimDailyGoalBonus !== 'undefined') window.claimDailyGoalBonus = claimDailyGoalBonus;
if (typeof isDailyGoalClaimed  !== 'undefined') window.isDailyGoalClaimed  = isDailyGoalClaimed;
if (typeof getTodayKey         !== 'undefined') window.getTodayKey         = getTodayKey;


// ── loadBattleQuestions ───────────────────────────────────────────
// Loads exactly 5 questions from DB with strict answer counts per
// BATTLE_QUESTION_PROGRESSION = [2, 3, 4, 5, 6].
// Uses jsonb_array_length(answers_ru) filter so each slot is correct.
// Falls back to ALL_Q_BASE only if DB returns nothing for that slot.
// Returns array of 5 normalised {cat,q,a,c,t} or null if not enough.
export async function loadBattleQuestions(lang = 'ru') {
  const PROGRESSION = [2, 3, 4, 5, 6];
  const result = [];
  const usedIds = new Set();

  for (const optCount of PROGRESSION) {
    let question = null;

    // 1. Try DB — filter by jsonb_array_length(answers_ru) = optCount
    try {
      const { data, error } = await sb
        .from('questions')
        .select('*')
        .eq('status', 'published')
        .filter('answers_ru', 'not.is', null);
        // Note: Supabase REST doesn't support jsonb_array_length directly.
        // We fetch candidates and filter in JS.

      if (!error && data && data.length > 0) {
        const candidates = data
          .map(row => normalizeDBQuestionForQuickPlay(row))
          .filter(q => {
            if (!q || usedIds.has(q.id)) return false;
            if (!Array.isArray(q.a) || q.a.length !== optCount) return false;
            if (!q.q || q.q.trim().length < 3) return false;
            if (q.c < 0 || q.c >= q.a.length) return false;
            return true;
          });
        if (candidates.length > 0) {
          question = candidates[Math.floor(Math.random() * candidates.length)];
          usedIds.add(question.id);
        }
      }
    } catch (e) {
      console.warn('[battle] DB fetch failed for optCount=' + optCount, e.message);
    }

    // 2. Fallback: ALL_Q / ALL_Q_BASE — but ONLY if it has exactly optCount answers
    if (!question) {
      const localPool = (typeof ALL_Q !== 'undefined' ? ALL_Q : [])
        .filter(q => {
          if (!q || usedIds.has(q.id || q.q)) return false;
          const answers = Array.isArray(q.a) ? q.a
            : (Array.isArray(q.a?.ru) ? q.a.ru : null);
          if (!answers || answers.length !== optCount) return false;
          const text = (typeof q.q === 'string') ? q.q : (q.q?.ru || q.q?.en || '');
          return text.trim().length > 2;
        });

      if (localPool.length > 0) {
        const picked = localPool[Math.floor(Math.random() * localPool.length)];
        const answers = Array.isArray(picked.a) ? picked.a : picked.a.ru;
        const text = (typeof picked.q === 'string') ? picked.q : (picked.q?.ru || picked.q?.en || '');
        question = {
          id:  picked.id || picked.q,
          cat: picked.cat || 'GENERAL',
          q:   text,
          a:   answers,
          c:   picked.c ?? 0,
          t:   30,
        };
        usedIds.add(question.id);
      }
    }

    if (!question) {
      console.warn('[battle] No question found for optCount=' + optCount);
      return null; // can't build a valid battle
    }

    // Canonical format — plain text, pre-adapted, same for both players
    result.push({
      cat: question.cat || 'GENERAL',
      q:   question.q,
      a:   question.a,   // exactly optCount answers
      c:   question.c,   // correct index
      t:   30,
    });
  }

  console.log('[BFC] loadBattleQuestions:', result.length, 'questions', result.map(q => q.a.length + ' opts'));
  return result;
}

// Export to window for use in friend-battle.js and matchmaking.js
window.loadBattleQuestions = loadBattleQuestions;

// ── Additional window exports (legacy.js depends on these) ────────
window.isQuickPlayLocked        = isQuickPlayLocked;
window.blockQuickPlayIfLocked   = blockQuickPlayIfLocked;
window.getQuickPlayLock         = getQuickPlayLock;
window.showShareScreen          = showShareScreen;
// showScore already exported above
window.restartQuiz = restartQuiz; // training.js is the only owner
window.showPlayTopics           = showPlayTopics;
window.showMyPacks              = showMyPacks;
window.renderDBGamePacks        = renderDBGamePacks;
window.loadUserPackPurchases    = loadUserPackPurchases;
window.playDBPack               = playDBPack;
window.startExtractedPack       = startExtractedPack;
window.showOfficialFromMenu     = showOfficialFromMenu;
window.shareToTelegram          = shareToTelegram;
window.copyShareLink            = copyShareLink;
window.downloadShareCard        = downloadShareCard;
window.drawShareCard            = drawShareCard;

// ── Full window exports for legacy.js compatibility ───────────────
window.loadPublishedQuickQuestionsFromDB = loadPublishedQuickQuestionsFromDB;
window.normalizeDBQuestionForQuickPlay   = normalizeDBQuestionForQuickPlay;
window.showNoFreshQuickQuestionsScreen   = showNoFreshQuickQuestionsScreen;
window.buildStandardPackQuestions        = buildStandardPackQuestions;
window.lockQuickPlayStarted              = lockQuickPlayStarted;
window.lockQuickPlayCompleted            = lockQuickPlayCompleted;
window.getLocalPlayedQuestionIds         = getLocalPlayedQuestionIds;
window.addLocalPlayedQuestionId          = addLocalPlayedQuestionId;
window.getRemotePlayedQuestionIds        = getRemotePlayedQuestionIds;
window.getPlayedQuestionIds              = getPlayedQuestionIds;
window.markQuestionSeen                  = markQuestionSeen;
window.isPackOwned                       = isPackOwned;
window.buyDBPack                         = buyDBPack;
window.showExplanation                   = showExplanation;
window.hideExplanation                   = hideExplanation;
// loadQ already exported above
window.renderTimer                       = renderTimer;
window.tick                              = tick;
window.expire                            = expire;
window.updStreak                         = updStreak;
window._updateNextBtnLabel               = _updateNextBtnLabel;
window.nextQ = nextQ; // training.js is the only owner
window.loadScoreCityRank                 = loadScoreCityRank;
window.spawnConfetti                     = spawnConfetti;
window.updateScoreScreenButtons          = updateScoreScreenButtons;
window.fetchCityRank                     = fetchCityRank;
window.getShareText                      = getShareText;
window.shareToWhatsApp                   = shareToWhatsApp;
window.toggleCityEdit                    = toggleCityEdit;
window.saveProfileCity                   = saveProfileCity;
window.toggleNameEdit                    = toggleNameEdit;
window.saveProfileName                   = saveProfileName;
window.renderProfileCity                 = renderProfileCity;
window.claimDailyGoalBonus              = claimDailyGoalBonus;
window.isDailyGoalClaimed               = isDailyGoalClaimed;
window.todayKey                          = todayKey;

function toggleAvatarEdit() {
  const panel = document.getElementById('profile-avatar-edit');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  if (!isOpen) {
    const isPro = window._userSubscription?.isPremium ?? false;
    if (!isPro) {
      toast('📸 Загрузка фото — только для Pro');
      setTimeout(() => {
        if (typeof window.openPremiumScreen === 'function') window.openPremiumScreen();
        else showScreen('premium');
      }, 800);
      return;
    }
  }
  panel.style.display = isOpen ? 'none' : 'block';
}

async function saveAvatarFile(input) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast('❌ Файл больше 2 МБ'); return; }
  if (!currentUser) { toast('❌ Войди в аккаунт'); return; }

  toast('⏳ Загружаем фото...');
  const ext = file.name.split('.').pop().toLowerCase() || 'jpg';
  const path = `avatars/${currentUser.id}.${ext}`;
  const { error: upErr } = await sb.storage.from('mfc-media').upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) { toast('❌ Ошибка загрузки: ' + upErr.message.slice(0, 60)); return; }

  const { data: urlData } = sb.storage.from('mfc-media').getPublicUrl(path);
  const url = urlData?.publicUrl;
  if (!url) { toast('❌ Не удалось получить URL'); return; }

  // Save to profile
  await sb.from('profiles').upsert({ id: currentUser.id, avatar_url: url, updated_at: new Date().toISOString() }, { onConflict: 'id' });
  await sb.auth.updateUser({ data: { avatar_url: url } });

  // Update avatar in UI
  const avEl = document.getElementById('profile-av');
  if (avEl) {
    avEl.style.backgroundImage = `url(${url})`;
    avEl.style.backgroundSize = 'cover';
    avEl.style.backgroundPosition = 'center';
    avEl.textContent = '';
  }

  toggleAvatarEdit();
  toast('✅ Фото сохранено!');
}

window.toggleAvatarEdit = toggleAvatarEdit;
window.saveAvatarFile   = saveAvatarFile;
