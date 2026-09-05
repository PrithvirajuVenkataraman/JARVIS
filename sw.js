/**
 * @file sw.js
 * @description Service Worker for JARVIS PWA & Offline Shell Caching
 */

const CACHE_NAME = 'jarvis-cache-v2';
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
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
                    if (key !== CACHE_NAME) {
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
        url.pathname.endsWith('.js') ||
        url.pathname.endsWith('.mjs') ||
        url.pathname.endsWith('.html') ||
        url.pathname.endsWith('.css');

    if (isCodeOrDocument) {
        event.respondWith(
            fetch(request)
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
                    return caches.match(request).then((cached) => {
                        if (cached) return cached;
                        if (request.mode === 'navigate') {
                            return caches.match('/index.html') || caches.match('/404.html');
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
            });
        })
    );
});
