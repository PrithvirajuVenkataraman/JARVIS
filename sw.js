// Production replaces this list and version with the verified build manifest.
const CACHE_NAME = 'jarvis-cache-development';
const STATIC_ASSETS = ['/index.html', '/styles.css', '/generated-tailwind.css', '/katex.min.js', '/science-format.js'];
self.addEventListener('install', event => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        try {
            await Promise.all(STATIC_ASSETS.map(async url => {
                const response = await fetch(url, { cache: 'reload' });
                if (!response.ok) throw new Error(`Required offline asset failed: ${url}`);
                if (/\.m?js$/.test(url) && !/(?:java|ecma)script/i.test(response.headers.get('content-type') || '')) throw new Error(`Invalid script response: ${url}`);
                await cache.put(url, response);
            }));
        } catch (error) { await caches.delete(CACHE_NAME); throw error; }
        await self.skipWaiting();
    })());
});
self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const previous = (await caches.keys()).filter(key => key.startsWith('jarvis-cache-') && key !== CACHE_NAME);
        await Promise.all(previous.slice(0, -1).map(key => caches.delete(key)));
        await self.clients.claim();
    })());
});
self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
    const appNavigation = request.mode === 'navigate' && ['/', '/index.html'].includes(url.pathname);
    const networkFirst = request.mode === 'navigate' || !url.pathname.startsWith('/assets/');
    event.respondWith((async () => {
        const cache = await caches.open(CACHE_NAME);
        if (!networkFirst) {
            const hit = await caches.match(request);
            if (hit) return hit;
        }
        try {
            const response = await (appNavigation
                ? fetch(new URL('/index.html', url.origin).href, { cache: 'no-cache' })
                : fetch(request));
            if (response.ok) {
                event.waitUntil(cache.put(appNavigation ? '/index.html' : request, response.clone()));
                return response;
            }
            if (response.status >= 500) {
                const cachedFallback = (await caches.match(request)) || (appNavigation ? await cache.match('/index.html') : null);
                if (cachedFallback) return cachedFallback;
            }
            return response;
        } catch {
            return (await caches.match(request)) || (appNavigation ? await cache.match('/index.html') : null) || new Response('Unavailable offline. Reconnect and retry.', { status: 503 });
        }
    })());
});
