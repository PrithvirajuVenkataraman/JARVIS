/**
 * @file sw.js
 * @description Service Worker for JARVIS PWA & Offline Shell Caching
 */

const CACHE_NAME = 'jarvis-cache-v63';
const STATIC_ASSETS = [
    '/',
    'index.html',
    'styles.css?v=2.6.7',
    'katex-local.css',
    'katex.min.js',
    'katex-fonts/KaTeX_Main-Regular.woff2',
    'katex-fonts/KaTeX_Main-Bold.woff2',
    'katex-fonts/KaTeX_Main-Italic.woff2',
    'katex-fonts/KaTeX_Main-BoldItalic.woff2',
    'katex-fonts/KaTeX_Math-Italic.woff2',
    'katex-fonts/KaTeX_Math-BoldItalic.woff2',
    'katex-fonts/KaTeX_Size1-Regular.woff2',
    'katex-fonts/KaTeX_Size2-Regular.woff2',
    'katex-fonts/KaTeX_Size3-Regular.woff2',
    'katex-fonts/KaTeX_Size4-Regular.woff2',
    'katex-fonts/KaTeX_AMS-Regular.woff2',
    'katex-fonts/KaTeX_SansSerif-Regular.woff2',
    'katex-fonts/KaTeX_SansSerif-Bold.woff2',
    'katex-fonts/KaTeX_SansSerif-Italic.woff2',
    'katex-fonts/KaTeX_Script-Regular.woff2',
    'katex-fonts/KaTeX_Typewriter-Regular.woff2',
    'app/bootstrap.js?v=2.6.7',
    'app/workspace-durability.js?v=2.4.1',
    'app/interactive-illustrations.js?v=2.4.1',
    'app/bounded-live-research.js?v=2.4.2',
    'app/markdown-renderer.js?v=2.5.1',
    'app/math-renderer.js?v=2.4.7',
    'app/search/research-stream.mjs',
    'app/search/research-contract.mjs',
    '404.html',
    'manifest.json'
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

    // KaTeX CDN Assets: Cache-First for instant offline availability
    if ((url.hostname === 'cdn.jsdelivr.net' || url.hostname === 'cdnjs.cloudflare.com') && url.pathname.includes('katex')) {
        event.respondWith(
            caches.open(CACHE_NAME).then(async (cache) => {
                const cached = await cache.match(request);
                if (cached) return cached;
                try {
                    const res = await fetch(request);
                    if (res && res.status === 200) {
                        cache.put(request, res.clone());
                    }
                    return res;
                } catch (_) {
                    return cached;
                }
            })
        );
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
