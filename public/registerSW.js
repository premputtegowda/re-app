// Skip SW registration in dev — HMR makes sw.js temporarily unavailable during
// hot-reloads, causing unhandled promise rejections from the update() poll.
if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        // Poll for updates every 60 seconds while the app is open.
        // Swallow any network error (e.g. brief deploy gap) to avoid unhandled rejections.
        setInterval(() => registration.update().catch(() => {}), 60_000);

        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', () => {
            if (
              newWorker.state === 'installed' &&
              navigator.serviceWorker.controller
            ) {
              // Silently activate and reload so the user always gets the latest build.
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => console.error('Service Worker registration failed:', err));

    // Reload the page once the new SW takes control.
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  });
}
