// ── Scout Form — форма внесения результатов бар-квиза ────────────
import { sb } from './services/supabase.js';
import { getState } from './state.js';

let _providers = [];

export async function loadScoutForm() {
  const { currentUser } = getState();
  if (!currentUser) return;

  // Проверяем is_scout
  const { data: profile } = await sb.from('profiles')
    .select('is_scout')
    .eq('id', currentUser.id)
    .single();

  const el = document.getElementById('scout-form-screen');
  if (!el) return;

  if (!profile?.is_scout) {
    el.innerHTML = `<div style="padding:40px;text-align:center;color:var(--muted)">
      Доступ только для скаутов
    </div>`;
    return;
  }

  // Загружаем провайдеров
  const { data: providers } = await sb.from('providers').select('id,name').order('name');
  _providers = providers || [];

  _renderScoutForm(el);
}

function _renderScoutForm(el) {
  const today = new Date().toISOString().slice(0, 10);

  el.innerHTML = `
    <div class="hdr" style="position:sticky;top:0;z-index:10;backdrop-filter:blur(12px);background:rgba(10,10,20,.85)">
      <button onclick="showScreen('home')" style="background:none;border:none;color:var(--text);font-size:22px;cursor:pointer;padding:0 4px">‹</button>
      <div style="font-size:15px;font-weight:900">🎯 Скаут: внести тур</div>
      <div style="width:30px"></div>
    </div>

    <div style="padding:16px;display:flex;flex-direction:column;gap:14px">

      <!-- Провайдер -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Организатор</div>
        <select id="sf-provider" style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;appearance:none">
          <option value="">— выбрать —</option>
          ${_providers.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}
        </select>
      </div>

      <!-- Дата -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:.05em">Дата игры</div>
        <input id="sf-date" type="date" value="${today}"
          style="width:100%;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none;box-sizing:border-box"/>
      </div>

      <!-- 10 команд -->
      <div>
        <div style="font-size:12px;font-weight:700;color:var(--muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em">Места команд (введи названия точно как в базе)</div>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${Array.from({length: 10}, (_, i) => `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="min-width:28px;height:28px;border-radius:50%;background:${i < 3 ? 'var(--gold)' : 'var(--bg2)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;color:${i < 3 ? '#000' : 'var(--muted)'}">
                ${i + 1}
              </div>
              <input
                id="sf-team-${i + 1}"
                type="text"
                placeholder="Название команды ${i + 1} место"
                maxlength="80"
                style="flex:1;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:11px 14px;font-size:14px;color:var(--text);font-family:inherit;outline:none"
              />
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Ошибки -->
      <div id="sf-errors" style="display:none;background:rgba(230,60,60,.1);border:1px solid rgba(230,60,60,.3);border-radius:12px;padding:14px">
        <div style="font-size:13px;font-weight:800;color:var(--red);margin-bottom:6px">⚠️ Команды не найдены в базе:</div>
        <div id="sf-errors-list" style="font-size:13px;color:var(--text)"></div>
        <div style="font-size:12px;color:var(--muted);margin-top:8px">Проверь написание — оно должно совпадать с именем в базе</div>
      </div>

      <!-- Успех -->
      <div id="sf-success" style="display:none;background:rgba(60,200,100,.1);border:1px solid rgba(60,200,100,.3);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:24px;margin-bottom:6px">✅</div>
        <div style="font-size:14px;font-weight:800;color:var(--green)">Тур зафиксирован!</div>
        <div id="sf-success-count" style="font-size:13px;color:var(--muted);margin-top:4px"></div>
      </div>

      <!-- Кнопка -->
      <button id="sf-submit-btn" onclick="window._sfSubmit()"
        style="background:linear-gradient(135deg,var(--accent),var(--accent2));border:none;border-radius:14px;padding:16px;font-size:16px;font-weight:900;color:#fff;cursor:pointer;font-family:inherit;width:100%">
        Зафиксировать тур →
      </button>

    </div>
  `;
}

window._sfSubmit = async function() {
  const btn = document.getElementById('sf-submit-btn');
  const errEl = document.getElementById('sf-errors');
  const errList = document.getElementById('sf-errors-list');
  const succEl = document.getElementById('sf-success');
  const succCount = document.getElementById('sf-success-count');

  errEl.style.display = 'none';
  succEl.style.display = 'none';

  const providerId = document.getElementById('sf-provider').value;
  if (!providerId) { window.toast?.('Выбери организатора'); return; }

  const results = [];
  for (let i = 1; i <= 10; i++) {
    const name = document.getElementById(`sf-team-${i}`)?.value?.trim();
    if (name) results.push({ name, rank: i });
  }

  if (results.length === 0) { window.toast?.('Введи хотя бы одну команду'); return; }

  btn.disabled = true;
  btn.textContent = 'Отправляю...';

  try {
    const { data, error } = await sb.rpc('scout_record_bar_quiz', {
      p_provider_id: providerId,
      p_results: results,
    });

    if (error) throw new Error(error.message);

    if (data.not_found?.length > 0) {
      errList.innerHTML = data.not_found.map(n => `<div style="padding:2px 0">• ${n}</div>`).join('');
      errEl.style.display = 'block';
    }

    if (data.inserted > 0) {
      succCount.textContent = `Записано команд: ${data.inserted}`;
      succEl.style.display = 'block';
      // Очищаем поля успешно записанных
      if (data.not_found?.length === 0) {
        for (let i = 1; i <= 10; i++) {
          const inp = document.getElementById(`sf-team-${i}`);
          if (inp) inp.value = '';
        }
      }
    }
  } catch(e) {
    window.toast?.('Ошибка: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Зафиксировать тур →';
  }
};

window.loadScoutForm = loadScoutForm;
