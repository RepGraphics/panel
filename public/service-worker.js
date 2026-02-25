/* Legacy service worker compatibility shim.
 * Some clients still request /service-worker.js from older builds.
 * Keep a minimal worker here so those requests do not hit Nuxt routing.
 */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
