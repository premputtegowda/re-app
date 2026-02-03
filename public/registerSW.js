// Register Service Worker
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        console.log('Service Worker registered successfully:', registration.scope);

        // Check for updates
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;

          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // New service worker available
              console.log('New content is available; please refresh.');

              // Optionally show a notification to user
              if (confirm('New version available! Refresh to update?')) {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                window.location.reload();
              }
            }
          });
        });
      })
      .catch((error) => {
        console.error('Service Worker registration failed:', error);
      });
  });

  // Handle service worker updates
  let refreshing;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}

// PWA Install prompt
let deferredPrompt;

window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent the mini-infobar from appearing on mobile
  e.preventDefault();
  // Stash the event so it can be triggered later
  deferredPrompt = e;

  // Show install button/banner
  console.log('PWA install prompt available');

  // Optionally show custom install UI
  showInstallPromotion();
});

function showInstallPromotion() {
  // You can create a custom UI element to show install button
  const installBanner = document.createElement('div');
  installBanner.id = 'install-banner';
  installBanner.innerHTML = `
    <div style="position: fixed; bottom: 20px; right: 20px; background: #3B82F6; color: white; padding: 16px 24px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 1000; display: flex; align-items: center; gap: 12px;">
      <span>Install REPS Tracker app?</span>
      <button id="install-button" style="background: white; color: #3B82F6; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-weight: 600;">Install</button>
      <button id="dismiss-button" style="background: transparent; color: white; border: 1px solid white; padding: 8px 16px; border-radius: 6px; cursor: pointer;">Later</button>
    </div>
  `;

  document.body.appendChild(installBanner);

  document.getElementById('install-button').addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`User response to install prompt: ${outcome}`);
      deferredPrompt = null;
      document.getElementById('install-banner').remove();
    }
  });

  document.getElementById('dismiss-button').addEventListener('click', () => {
    document.getElementById('install-banner').remove();
  });
}

window.addEventListener('appinstalled', () => {
  console.log('PWA was installed successfully');
  deferredPrompt = null;
});
