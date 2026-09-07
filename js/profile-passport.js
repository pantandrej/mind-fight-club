// profile-passport.js — Player Passport edit modal + share

function _esc(s) {
  return typeof window._esc === 'function' ? window._esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

// ── Modal open/close ──────────────────────────────────────────────────────────
window._ppOpenEditModal = function(focus) {
  const modal = document.getElementById('pp-edit-modal');
  if (!modal) return;

  // Pre-fill fields from current UI values
  const nameEl  = document.getElementById('pp-modal-name');
  const cityEl  = document.getElementById('pp-modal-city');
  const bioEl   = document.getElementById('pp-modal-bio');
  const modalAv = document.getElementById('pp-modal-av');
  const profileAv = document.getElementById('profile-av');

  if (nameEl) nameEl.value = document.getElementById('profile-name')?.textContent || '';
  if (cityEl) cityEl.value = document.getElementById('profile-city-display')?.textContent || '';
  if (bioEl)  bioEl.value  = document.getElementById('profile-bio-text')?.textContent || '';

  // Mirror avatar state into modal avatar preview
  if (modalAv && profileAv) {
    if (profileAv.style.backgroundImage) {
      modalAv.style.backgroundImage  = profileAv.style.backgroundImage;
      modalAv.style.backgroundSize   = 'cover';
      modalAv.style.backgroundPosition = 'center';
      modalAv.textContent = '';
    } else {
      modalAv.style.backgroundImage = '';
      modalAv.textContent = profileAv.textContent || '🧠';
    }
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  // Focus the requested field
  setTimeout(() => {
    if (focus === 'bio'    && bioEl)  bioEl.focus();
    else if (focus === 'city' && cityEl) cityEl.focus();
    else if (focus === 'name' && nameEl) nameEl.focus();
    else if (focus === 'avatar') document.getElementById('pp-avatar-file-modal')?.click();
  }, 80);
};

window._ppCloseEditModal = function() {
  const modal = document.getElementById('pp-edit-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
};

// ── Save all profile fields at once ──────────────────────────────────────────
window._ppSaveAllFields = async function() {
  const name = document.getElementById('pp-modal-name')?.value?.trim();
  const city = document.getElementById('pp-modal-city')?.value?.trim();
  const bio  = document.getElementById('pp-modal-bio')?.value?.trim();

  if (!window.sb) { window.toast?.('❌ Нет соединения'); return; }

  const rpcArgs = {};
  if (name !== undefined && name !== null) rpcArgs.p_display_name = name || null;
  if (city !== undefined && city !== null) rpcArgs.p_city         = city || null;
  if (bio  !== undefined && bio  !== null) rpcArgs.p_bio          = bio  || null;

  const { error } = await window.sb.rpc('update_my_profile', rpcArgs);
  if (error) { window.toast?.('❌ Ошибка сохранения'); return; }

  // Write-through to localStorage
  if (name) localStorage.setItem('mfc_display_name', name);
  if (city) localStorage.setItem('mfc_city', city);

  // Update hero UI immediately — no reload needed
  if (name) {
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = name;
    const avEl = document.getElementById('profile-av');
    if (avEl && !avEl.style.backgroundImage) avEl.textContent = name[0].toUpperCase();
  }
  if (city) {
    const cityDisplay = document.getElementById('profile-city-display');
    if (cityDisplay) cityDisplay.textContent = city;
    const cityTag = document.getElementById('profile-city-tag');
    if (cityTag) cityTag.style.display = '';
  }
  const bioTextEl = document.getElementById('profile-bio-text');
  const bioPhEl   = document.getElementById('profile-bio-placeholder');
  if (bio) {
    if (bioTextEl) { bioTextEl.textContent = bio; bioTextEl.style.display = ''; }
    if (bioPhEl)   bioPhEl.style.display = 'none';
  } else {
    if (bioTextEl) bioTextEl.style.display = 'none';
    if (bioPhEl)   bioPhEl.style.display = '';
  }

  window._ppCloseEditModal();
  window.toast?.('✅ Профиль сохранён');
};

// ── Share profile ─────────────────────────────────────────────────────────────
window.shareProfile = function() {
  const uid = window._appState?.getState().currentUser?.id || '';
  const url = uid ? `${location.origin}${location.pathname}?uid=${uid}` : location.href;
  if (navigator.share) {
    navigator.share({ title: 'BFC Player Passport', url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url)
      .then(() => window.toast?.('🔗 Ссылка на профиль скопирована!'))
      .catch(() => window.toast?.('🔗 ' + url));
  }
};

// ── Keyboard close ────────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') window._ppCloseEditModal?.();
});
