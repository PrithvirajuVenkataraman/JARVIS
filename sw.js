/**
 * @file sw.js
 * @description Service Worker for JARVIS PWA & Offline Shell Caching
 */

const CACHE_NAME = 'jarvis-cache-v28';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/app/bootstrap.js?v=2.4.2',
    '/app/bounded-live-research.js?v=2.4.2',
    '/app/markdown-renderer.js?v=2.4.2',
    '/app/search/research-stream.mjs',
    '/app/search/research-contract.mjs',
    '/404.html',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS).catch(() => {});
        })
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key.startsWith('jarvis-cache-') && key !== CACHE_NAME) {
                        return caches.delete(key);
                    }
                })
            );
        }).then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // API calls, streaming SSE, and POST requests must NEVER use cache
    if (request.method !== 'GET' || url.pathname.startsWith('/api/')) {
        return;
    }

    // Network-First for HTML documents, scripts, and modules so code updates deploy immediately
    const isCodeOrDocument = request.mode === 'navigate' ||
        url.pathname === '/' ||
        url.pathname === '' ||
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.mjs') ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.css');

    if (isCodeOrDocument) {
        event.respondWith(
            fetch(request, { cache: 'no-cache' })
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
                        const responseToCache = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseToCache);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => {
                    return caches.open(CACHE_NAME).then(cache => cache.match(request)).then((cached) => {
                        if (cached) return cached;
                        if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '') {
                            return caches.open(CACHE_NAME).then(async cache =>
                                (await cache.match('/index.html')) || (await cache.match('/404.html')) ||
                                new Response('Page unavailable offline', { status: 503 })
                            );
                        }
                        return new Response('Network error and no cache available', { status: 503 });
                    });
                })
        );
        return;
    }

    // Cache-First for static assets (images, icons, fonts)
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(request).then((networkResponse) => {
                if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
                    return networkResponse;
                }
                const responseToCache = networkResponse.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseToCache);
                });
                return networkResponse;
            }).catch(() => {
                return caches.match(request).then((cached) => cached || new Response('Asset unavailable offline', { status: 503 }));
            });
        }).catch(() => {
            return new Response('Network error and no cache available', { status: 503 });
        })
    );
});
