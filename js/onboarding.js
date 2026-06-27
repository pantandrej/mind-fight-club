// ── Onboarding tutorial ───────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

const STEPS = [
  {
    icon: '🧠',
    title: 'Добро пожаловать в Brain Fight Club!',
    text:  'Квиз-платформа для тех, кто любит думать. Тематические паки, живые турниры и баттлы с друзьями.',
    btn:   'Поехали →',
  },
  {
    icon: '🎮',
    title: 'Тематические паки',
    text:  'Нажми ⚡ Играть → выбери тему. Вопрос со слайдом, 4 варианта, таймер. Чем быстрее отвечаешь — тем больше нейронов.',
    btn:   'Понятно →',
    cta:   { label: 'Попробовать сейчас', action: "window.finishOnboarding();window.openSlidePack?.('videogames_v2')" },
  },
  {
    icon: '🏆',
    title: 'Онлайн-турниры',
    text:  'Все игроки отвечают одновременно на одни вопросы. Таймер общий — правильно и быстро = больше очков. Живая таблица во время игры.',
    btn:   'Огонь →',
    cta:   { label: 'Смотреть турниры', action: "window.finishOnboarding();window.showCupScreen?.()" },
  },
  {
    icon: '⚡',
    title: 'Нейроны — твоя валюта',
    text:  'За каждый правильный ответ получаешь нейроны. Копи — и меняй на скидки на живые квизы, аватары и другие плюшки.',
    btn:   'Запомнил →',
  },
  {
    icon: '📤',
    title: 'Делись результатами',
    text:  'После каждой игры — красивая карточка результата. Кидай в TG или сторис, вызывай друзей. Рефералка: друг зарегистрировался — оба +50 нейронов.',
    btn:   'Начать играть 🚀',
  },
];

let _step = 0;

export function shouldShowOnboarding() {
  const { currentUser } = getState();
  if (!currentUser) return false;
  return !localStorage.getItem('bfc_onboarding_done');
}

export function startOnboarding() {
  _step = 0;
  _render();
  document.getElementById('onboarding-overlay').style.display = 'flex';
}

function _render() {
  const s = STEPS[_step];
  const el = document.getElementById('onboarding-overlay');
  if (!el) return;

  el.innerHTML = `
    <div class="onb-card">
      <div class="onb-dots">
        ${STEPS.map((_,i) => `<div class="onb-dot${i===_step?' active':''}"></div>`).join('')}
      </div>
      <div class="onb-icon">${s.icon}</div>
      <div class="onb-title">${s.title}</div>
      <div class="onb-text">${s.text}</div>
      ${s.cta ? `<button onclick="${s.cta.action}" style="width:100%;background:rgba(108,99,255,.15);border:1px solid rgba(108,99,255,.4);border-radius:12px;padding:12px;font-size:13px;font-weight:800;color:var(--accent2);cursor:pointer;font-family:inherit;margin-bottom:8px">${s.cta.label} →</button>` : ''}
      <button class="big-btn onb-btn" id="onb-next-btn">${s.btn}</button>
      ${_step > 0 ? `<button class="onb-skip" id="onb-skip-btn">Пропустить</button>` : ''}
    </div>`;

  document.getElementById('onb-next-btn').onclick = nextStep;
  const skipBtn = document.getElementById('onb-skip-btn');
  if (skipBtn) skipBtn.onclick = finishOnboarding;
}

function nextStep() {
  _step++;
  if (_step >= STEPS.length) {
    finishOnboarding();
  } else {
    _render();
  }
}

async function finishOnboarding() {
  document.getElementById('onboarding-overlay').style.display = 'none';
  localStorage.setItem('bfc_onboarding_done', '1');

  const { currentUser } = getState();
  if (currentUser) {
    await sb.from('profiles').update({ onboarding_done: true }).eq('id', currentUser.id).catch(() => {});
  }

  // Ask for push permission after onboarding
  if (window.requestPushPermission) {
    setTimeout(() => window.requestPushPermission(), 1000);
  }
}

window.startOnboarding    = startOnboarding;
window.finishOnboarding   = finishOnboarding;
window.shouldShowOnboarding = shouldShowOnboarding;
