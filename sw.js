// Service Worker for Vibe Music PWA (Samsung One UI / Spotify Dark)
const CACHE_NAME = 'vibe-music-cache-v7-focus-recovery';
const STATIC_ASSETS = [
  './',
  './index.html',
  './style.css',
  './manifest.json',
  './js/app.js',
  './js/config.js',
  './js/catalogs.js',
  './js/api.js',
  './js/state.js',
  './js/audio.js',
  './js/search.js',
  './js/ui.js'
];

self.addEventListener('install', (event) => {
  // Activate immediately without waiting for tabs to close
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
});

self.addEventListener('activate', (event) => {
  // Purge ALL older caches immediately so stale scripts are destroyed
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Purging old service worker cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Allow streaming audio and API calls to pass through directly
  if (
    url.hostname.includes('saavncdn.com') ||
    url.hostname.includes('workers.dev') ||
    url.hostname.includes('sumit.co') ||
    event.request.headers.get('range')
  ) {
    return;
  }

  // Network-First with Cache Fallback for all local application scripts, styles & HTML
  // Guarantees that phone always loads the newest code instantly while online
  if (event.request.method === 'GET') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // If offline or network unavailable, fall back to cached version
          return caches.match(event.request);
        })
    );
  }
});
