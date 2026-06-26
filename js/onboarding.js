// ── Onboarding tutorial ───────────────────────────────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

const STEPS = [
  {
    icon: '🧠',
    title: 'Добро пожаловать в Brain Fight Club!',
    text:  'Тренируй эрудицию, побеждай в баттлах и соревнуйся за свой клуб.',
    btn:   'Поехали →',
  },
  {
    icon: '⚡',
    title: 'Нейроны — твоя валюта',
    text:  'За каждую игру ты зарабатываешь нейроны. Чем быстрее отвечаешь — тем больше. Трать их в магазине на стрик-заморозку и другие плюшки.',
    btn:   'Понятно →',
  },
  {
    icon: '⚔️',
    title: 'Дуэли в реальном времени',
    text:  'Выбери "Играть" → "Случайный бой" и сразись с живым соперником. 10 вопросов, кто больше — тот и победил.',
    btn:   'Круто →',
  },
  {
    icon: '🔥',
    title: 'Не теряй серию',
    text:  'Каждый день когда ты играешь — стрик растёт. На 7, 30 и 100 дней — бонусные нейроны. Если пропустишь — можно заморозить стрик за 150 нейронов.',
    btn:   'Запомнил →',
  },
  {
    icon: '🏟️',
    title: 'Командная игра',
    text:  'Вступай в команду или создай свою. Твой XP идёт в общий счёт клуба — соревнуйтесь с другими командами в рейтинге.',
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
