import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { indexedDB } from 'fake-indexeddb';
import { postJson } from '../app/api-client.js';
import { getSealedSecretsPublicKey, isPersistentByokConfigured, sealSecret, unsealSecret } from '../api/_lib/security.js';
import { createRequestLifecycle, withRequestLifecycle, fetchWithLifecycle } from '../api/_lib/request-lifecycle.js';
import { WorkspaceIndexedDB } from '../app/workspace-durability.js';
import { schedule, flush, writeHotCache } from '../app/persistence-controller.js';
import { buildDiagnosticsStatus } from '../api/diagnostics.js';
import { __test as chat } from '../api/chat-groq.js';

test('JSON requests preserve headers and reject canceled, timed out, and malformed responses', async () => {
    const original = globalThis.fetch;
    try {
        let calls = 0;
        globalThis.fetch = async (_url, init) => { calls++; assert.equal(init.headers.get('x-test'), 'preserved'); return new Response('{"success":true}'); };
        await postJson('/api/test', {}, { headers: { 'x-test': 'preserved' } });
        const controller = new AbortController(); controller.abort();
        await assert.rejects(postJson('/api/test', {}, { signal: controller.signal }), error => error.code === 'request_aborted' && !error.retryable);
        assert.equal(calls, 1);
        globalThis.fetch = async () => new Response('<html>wrong route</html>');
        await assert.rejects(postJson('/api/test', {}), error => error.code === 'invalid_response');
        globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
        await assert.rejects(postJson('/api/test', {}, { timeoutMs: 1000 }), error => error.code === 'request_timeout' && error.retryable);
    } finally { globalThis.fetch = original; }
});

test('saved credentials require matching persistent RSA keys and survive new server instances', () => {
    const saved = { private: process.env.JARVIS_BYOK_PRIVATE_KEY, public: process.env.JARVIS_BYOK_PUBLIC_KEY };
    try {
        delete process.env.JARVIS_BYOK_PRIVATE_KEY; delete process.env.JARVIS_BYOK_PUBLIC_KEY;
        assert.equal(getSealedSecretsPublicKey(), null);
        assert.throws(() => sealSecret('synthetic-secret'));
        const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
        process.env.JARVIS_BYOK_PRIVATE_KEY = pair.privateKey; process.env.JARVIS_BYOK_PUBLIC_KEY = pair.publicKey;
        assert.equal(isPersistentByokConfigured(), true);
        const sealed = sealSecret('synthetic-secret');
        delete globalThis.__jarvisSealedSecretsKeyPair;
        assert.equal(unsealSecret(sealed), 'synthetic-secret');
        process.env.JARVIS_BYOK_PUBLIC_KEY = 'invalid public key';
        assert.equal(isPersistentByokConfigured(), false);
        assert.equal(unsealSecret(sealed), '');
    } finally {
        for (const [name, value] of [['JARVIS_BYOK_PRIVATE_KEY', saved.private], ['JARVIS_BYOK_PUBLIC_KEY', saved.public]]) {
            if (value === undefined) delete process.env[name]; else process.env[name] = value;
        }
        delete globalThis.__jarvisSealedSecretsKeyPair;
    }
});

test('request deadlines and client disconnect abort upstream work', async () => {
    const req = new EventEmitter(); const res = new EventEmitter(); res.writableEnded = false;
    const lifecycle = createRequestLifecycle(req, res, 20);
    await new Promise(resolve => { lifecycle.signal.addEventListener('abort', resolve); setTimeout(resolve, 30); });
    assert.equal(lifecycle.signal.aborted, true); lifecycle.dispose();
    const original = globalThis.fetch;
    try {
        let signal;
        globalThis.fetch = (_url, init) => { signal = init.signal; return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))); };
        const handler = withRequestLifecycle(async () => fetchWithLifecycle('https://provider.example'));
        const result = handler(req, res); res.emit('close');
        await assert.rejects(result); assert.equal(signal.aborted, true);
        assert.equal(res.listenerCount('close'), 0);
    } finally { globalThis.fetch = original; }
});

test('durable writes retain tombstones across instances and enforce the session cap', async () => {
    const original = globalThis.indexedDB; globalThis.indexedDB = indexedDB;
    const db = new WorkspaceIndexedDB({ dbName: 'reliability-' + crypto.randomUUID() });
    try {
        const sessions = Array.from({ length: 505 }, (_, index) => ({ id: String(index), messages: [{ role: 'user', text: 'Message ' + index }], updatedAt: new Date(1700000000000 + index).toISOString() }));
        assert.equal(await db.saveSessions(sessions), true);
        assert.equal((await db.loadAllSessions()).length, 500);
        await db.saveSessions([], ['504']);
        const another = new WorkspaceIndexedDB({ dbName: db.dbName });
        await another.saveSessions([sessions.at(-1)]);
        assert.ok(!(await another.loadAllSessions()).some(item => item.id === '504'));
        (await another.open()).close();
    } finally { (await db.open()).close(); globalThis.indexedDB = original; }
});

test('persistence coalesces writes and avoids repeated hot-cache serialization writes', () => {
    const writes = [];
    schedule(() => writes.push('old')); schedule(() => writes.push('latest')); flush();
    assert.deepEqual(writes, ['latest']);
    let hotWrites = 0;
    writeHotCache([{ id: 'hot' }], () => { hotWrites++; return true; });
    writeHotCache([{ id: 'hot' }], () => { hotWrites++; return true; });
    assert.equal(hotWrites, 1);
});

test('unavailable free-image and saved-key capabilities are reported without secrets', () => {
    const value = buildDiagnosticsStatus();
    assert.equal(typeof value.capabilities.images.available, 'boolean');
    assert.equal(value.model.byokSupported, isPersistentByokConfigured());
    assert.ok(!JSON.stringify(value).includes('PRIVATE KEY'));
});

test('provider fallback uses at most two total attempts and honors explicit provider selection', async () => {
    const original = globalThis.fetch;
    const gemini = process.env.GEMINI_API_KEY;
    try {
        process.env.GEMINI_API_KEY = 'synthetic-key';
        let calls = 0;
        globalThis.fetch = async () => { calls++; return new Response('{}', { status: 503 }); };
        await chat.streamModelWithFallback('Explain the algorithm', {}, () => {}, 'qwen/qwen3-32b', undefined, { customGroqKey: 'synthetic-key' });
        assert.equal(calls, 2);
    } finally { globalThis.fetch = original; if (gemini === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = gemini; }
});

test('an incomplete offline installation cannot replace the working cache', async () => {
    const listeners = {};
    const cacheNames = new Set(['jarvis-cache-working']);
    let skipped = false;
    const context = vm.createContext({
        URL, Response,
        self: { addEventListener: (name, callback) => listeners[name] = callback, skipWaiting: () => { skipped = true; } },
        caches: { open: async name => { cacheNames.add(name); return { put: async () => {} }; }, delete: async name => cacheNames.delete(name) },
        fetch: async url => new Response('fixture', { status: url.includes('styles.css') ? 503 : 200, headers: { 'content-type': 'text/javascript' } })
    });
    vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);
    let installed;
    listeners.install({ waitUntil: value => installed = value });
    await assert.rejects(installed, /Required offline asset failed/);
    assert.equal(skipped, false);
    assert.deepEqual([...cacheNames], ['jarvis-cache-working']);
});
