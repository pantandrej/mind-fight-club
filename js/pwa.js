// ── PWA install + Push notifications ─────────────────────────────────

const VAPID_PUBLIC = 'BALHCo-WxSqcH2MpBHfYscDMfnbNkiC69nJt5fjXOgtBPB9xh6pPkL44Ry3C1q7If9zIQdYJI76XFFEqQoXosuU';

// ── PWA Install ───────────────────────────────────────────────────────

let _deferredPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPrompt = e;
  // Show banner only if not already installed
  if (window.matchMedia('(display-mode: standalone)').matches) return;
  const banner = document.getElementById('pwa-install-banner');
  if (banner) banner.style.display = 'flex';
});

window.pwaInstall = async function() {
  if (!_deferredPrompt) return;
  _deferredPrompt.prompt();
  const { outcome } = await _deferredPrompt.userChoice;
  _deferredPrompt = null;
  document.getElementById('pwa-install-banner').style.display = 'none';
  if (outcome === 'accepted') window.toast?.('✓ Приложение установлено!');
};

window.addEventListener('appinstalled', () => {
  document.getElementById('pwa-install-banner').style.display = 'none';
  window.toast?.('🎉 Brain Fight Club установлен!');
});

// ── Push Notifications ────────────────────────────────────────────────

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC),
      });
    }
    return sub;
  } catch(e) {
    console.warn('[push] subscribe failed:', e.message);
    return null;
  }
}

export async function requestPushForTournament(tournamentId) {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  const sub = await subscribeToPush();
  if (!sub) return;

  // Save subscription + tournament to DB
  const { sb } = await import('./services/supabase.js');
  const user = (await sb.auth.getUser()).data?.user;
  if (!user) return;

  await sb.from('push_subscriptions').upsert({
    user_id: user.id,
    endpoint: sub.endpoint,
    keys: sub.toJSON().keys,
    tournament_id: tournamentId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'endpoint' });

  window.toast?.('🔔 Уведомим за 5 минут до старта!');
}

window.requestPushForTournament = requestPushForTournament;
