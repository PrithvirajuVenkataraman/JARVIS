// Deterministic browser-test backend. This file is never deployed as an API route.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
const directory = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml' };
const capabilities = Object.fromEntries(['chat', 'search', 'vision', 'images', 'byok'].map(name => [name, { available: name !== 'byok', reasonCode: name === 'byok' ? 'persistent_keypair_required' : 'available' }]));
let failWorkerUpdate = false;
const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/__test/fail-worker-update') { failWorkerUpdate = true; res.writeHead(204); return res.end(); }
    if (url.pathname === '/sw.js' && failWorkerUpdate) {
        failWorkerUpdate = false;
        const worker = (await readFile(resolve(directory, 'sw.js'), 'utf8'))
            .replace(/const CACHE_NAME = .*?;/, "const CACHE_NAME = 'jarvis-cache-failed-fixture';")
            .replace(/const STATIC_ASSETS = \[[\s\S]*?\];/, "const STATIC_ASSETS = ['/missing-required-asset.js'];");
        res.writeHead(200, { 'content-type': 'text/javascript', 'service-worker-allowed': '/', 'cache-control': 'no-store' }); return res.end(worker);
    }
    if (url.pathname === '/api/diagnostics') {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, diagnostics: { capabilities, model: { groqConfigured: true, byokSupported: false }, retrieval: { liveSearchEnabled: true } } }));
    }
    if (url.pathname === '/api/chat-groq') {
        if (req.method === 'HEAD') { res.writeHead(200); return res.end(); }
        let raw = ''; for await (const chunk of req) raw += chunk;
        let body; try { body = JSON.parse(raw); } catch { body = {}; }
        if (!body.stream) {
            res.writeHead(200, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ success: true, response: 'Integral Substitution', intent: 'chat' }));
        }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
        const send = (event, value) => { if (!res.destroyed) res.write(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`); };
        send('meta', { requestId: 'browser-fixture' });
        const text = /stop fixture/i.test(body.message) ? 'A partial answer that can be stopped.' : String.raw`Use the substitution $t=\arctan x$. Then $dx/(1+x^2)=dt$.

$$I=\int_0^{\pi/4}\ln(1+\tan t)\,dt=\frac{\pi\ln 2}{8}.$$

The exact answer is $\frac{\pi\ln 2}{8}$.`;
        send('delta', { text: text.slice(0, 24) });
        const timer = setTimeout(() => {
            send('delta', { text: text.slice(24) });
            send('done', { success: true, response: text, intent: 'chat', provider: 'fixture', modelUsed: 'fixture' });
            res.end();
        }, /stop fixture/i.test(body.message) ? 5000 : 150);
        res.on('close', () => clearTimeout(timer));
        return;
    }
    if (url.pathname.startsWith('/api/')) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"success":false,"error":{"code":"fixture_unavailable"}}'); }
    const path = resolve(directory, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
    if (!path.startsWith(directory + sep)) { res.writeHead(403); return res.end(); }
    try {
        const contents = await readFile(path);
        const compress = /\.(?:js|mjs|css|html)$/.test(path) && /gzip/.test(req.headers['accept-encoding'] || '');
        res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream', ...(compress ? { 'content-encoding': 'gzip', vary: 'Accept-Encoding' } : {}) });
        res.end(compress ? gzipSync(contents) : contents);
    } catch { res.writeHead(404); res.end(); }
});
server.listen(4173, '127.0.0.1');
