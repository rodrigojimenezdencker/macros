import { registerSW } from 'virtual:pwa-register';

/** How long after the app is opened (or brought back) a new version may still reload it on the spot. */
const FRESH_MS = 10_000;

/**
 * Reload into a new version right away only while the app is hidden or was
 * opened a moment ago, so nothing the user is typing is lost; otherwise wait
 * until they leave the app.
 */
export function shouldReloadNow(msSinceShown: number, visibility: DocumentVisibilityState): boolean {
  return visibility === 'hidden' || msSinceShown < FRESH_MS;
}

/**
 * Keeps installed copies of the app up to date. The service worker downloads a
 * new version in the background; then the page reloads into it. Installed
 * apps (iPhone especially) resume without reloading, so every return to the
 * app also checks for a new version.
 */
export function keepUpToDate(): void {
  if (!('serviceWorker' in navigator)) return;
  let shownAt = performance.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') shownAt = performance.now();
  });

  registerSW({
    immediate: true,
    onNeedReload() {
      if (shouldReloadNow(performance.now() - shownAt, document.visibilityState)) return location.reload();
      const whenHidden = () => {
        if (document.visibilityState !== 'hidden') return;
        document.removeEventListener('visibilitychange', whenHidden);
        location.reload();
      };
      document.addEventListener('visibilitychange', whenHidden);
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      document.addEventListener('visibilitychange', () => {
        // Offline, or the server is unreachable: try again next time.
        if (document.visibilityState === 'visible') registration.update().catch(() => {});
      });
    },
    // Blocked or unsupported service workers: the app still works, just without offline/updates.
    onRegisterError() {},
  });
}
