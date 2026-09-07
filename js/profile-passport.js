// profile-passport.js — Player Passport edit modal + share

function _esc(s) {
  return typeof window._esc === 'function' ? window._esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
}

// ── Modal open/close ──────────────────────────────────────────────────────────
window._ppOpenEditModal = function(focus) {
  const modal = document.getElementById('pp-edit-modal');
  if (!modal) return;

  const nameEl    = document.getElementById('pp-modal-name');
  const cityEl    = document.getElementById('pp-modal-city');
  const bioEl     = document.getElementById('pp-modal-bio');
  const modalAv   = document.getElementById('pp-modal-av');
  const profileAv = document.getElementById('profile-av');

  if (nameEl) nameEl.value = document.getElementById('profile-name')?.textContent || '';
  if (cityEl) cityEl.value = document.getElementById('profile-city-display')?.textContent || '';
  if (bioEl)  bioEl.value  = document.getElementById('profile-bio-text')?.textContent || '';

  if (modalAv && profileAv) {
    if (profileAv.style.backgroundImage) {
      modalAv.style.backgroundImage    = profileAv.style.backgroundImage;
      modalAv.style.backgroundSize     = 'cover';
      modalAv.style.backgroundPosition = 'center';
      modalAv.textContent = '';
    } else {
      modalAv.style.backgroundImage = '';
      modalAv.textContent = profileAv.textContent || '🧠';
    }
  }

  modal.style.display = 'flex';
  document.body.style.overflow = 'hidden';

  setTimeout(() => {
    if      (focus === 'bio'    && bioEl)  bioEl.focus();
    else if (focus === 'city'   && cityEl) cityEl.focus();
    else if (focus === 'name'   && nameEl) nameEl.focus();
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
  // display_name: only send if non-empty — empty name is not allowed
  if (name) rpcArgs.p_display_name = name;
  // city & bio: send actual value including '' — empty string clears the field in DB
  // (migration 73: CASE WHEN p_x IS NOT NULL THEN p_x ELSE column END;
  //  '' IS NOT NULL → true → writes '' which clears the field)
  if (city !== undefined) rpcArgs.p_city = city;  // '' clears, 'xxx' sets
  if (bio  !== undefined) rpcArgs.p_bio  = bio;   // '' clears, 'xxx' sets

  const { data, error } = await window.sb.rpc('update_my_profile', rpcArgs);

  if (error || data?.ok !== true) {
    const reason = error?.message || data?.reason || 'unknown';
    window.toast?.('❌ Ошибка сохранения: ' + reason.slice(0, 60));
    return; // do NOT close modal; do NOT update UI or localStorage
  }

  // Write-through to localStorage (only after confirmed ok:true)
  if (name) localStorage.setItem('mfc_display_name', name);
  if (city) localStorage.setItem('mfc_city', city);
  else if (city === '') localStorage.removeItem('mfc_city');

  // Update hero UI immediately
  if (name) {
    const nameEl = document.getElementById('profile-name');
    if (nameEl) nameEl.textContent = name;
    const avEl = document.getElementById('profile-av');
    if (avEl && !avEl.style.backgroundImage) avEl.textContent = name[0].toUpperCase();
  }

  // city: update display or hide tag if cleared
  const cityDisplay = document.getElementById('profile-city-display');
  const cityTag     = document.getElementById('profile-city-tag');
  if (city) {
    if (cityDisplay) cityDisplay.textContent = city;
    if (cityTag)     cityTag.style.display = '';
  } else if (city === '') {
    if (cityTag) cityTag.style.display = 'none';
  }

  // bio: show or hide
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
