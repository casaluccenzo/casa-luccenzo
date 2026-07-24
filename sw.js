// Service Worker for offline operations
const CACHE_NAME = 'casa-lucenzo-v170';

const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './css/main.css',
  './css/variables.css',
  './css/layout.css',
  './css/components.css',
  './js/app.js',
  './js/storage.js',
  './js/supabase.js',
  './js/recipes.js',
  './js/audio.js',
  './js/share.js',
  './js/agent.js',
  './js/ui.js',
  './img/logo-192.png',
  './img/logo-512.png'
];

// Install Event - cache assets
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Caching offline assets');
        return cache.addAll(ASSETS_TO_CACHE);
      })
      .then(() => self.skipWaiting())
  );
});

// Activate Event - clean old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      const cleanupPromises = cacheNames
        .filter(name => name !== CACHE_NAME)
        .map(name => {
          console.log('Clearing old cache:', name);
          return caches.delete(name);
        });
      return Promise.all(cleanupPromises);
    }).then(() => self.clients.claim())
  );
});

// Fetch Event - Stale-While-Revalidate caching strategy
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        if (cachedResponse) {
          // background fetch to update the cache (stale-while-revalidate)
          fetch(event.request)
            .then(networkResponse => {
              if (networkResponse.status === 200) {
                caches.open(CACHE_NAME).then(cache => {
                  cache.put(event.request, networkResponse.clone());
                });
              }
            })
            .catch(() => {});
          return cachedResponse;
        }

        // Cache miss: request from network
        return fetch(event.request)
          .then(networkResponse => {
            if (networkResponse.status === 200) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseClone);
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // Offline fallback for navigation requests
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
      })
  );
});
