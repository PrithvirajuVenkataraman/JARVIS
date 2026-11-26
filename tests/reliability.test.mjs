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
import { visionFailurePayload, describeUpstreamFailure } from '../api/_lib/model-failure.js';
import { lazyModule } from '../app/lazy-features.js';
import { formatBytes, detectImageMime, imageNameForMime } from '../app/file-format.js';
import { prepareRequestPayload, serializeRequestPayload, jsonByteLength, MAX_JSON_REQUEST_BYTES, isPayloadTooLarge } from '../app/request-payload.js';
import { classifyFailure, buildUserFacingErrorMessage, shouldShowFailureFallbackCard } from '../app/failure-policy.js';
import { installRequestPreferences } from '../app/request-preferences.js';

test('image bytes determine the format and prepared filenames match the encoded data', async () => {
    assert.equal(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'image/png');
    assert.equal(detectImageMime(Uint8Array.from([0x49, 0x49, 0x2a, 0])), 'image/tiff');
    assert.equal(detectImageMime(new Uint8Array()), '');
    assert.equal(imageNameForMime('DSC_0158.NEF', 'image/jpeg'), 'DSC_0158.jpg');
    assert.equal(imageNameForMime('diagram.png', 'image/jpeg'), 'diagram.jpg');
    assert.equal(imageNameForMime('photo.jpeg', 'image/jpeg'), 'photo.jpeg');
    const { buildChatAttachmentMeta } = await import('../app/attachments.js');
    const source = { name: 'diagram.png', preparedName: 'diagram.jpg', mimeType: 'image/jpeg', size: 1_000_000, preparedSize: 120_000 };
    const [metadata] = buildChatAttachmentMeta([source]);
    assert.equal(metadata.name, 'diagram.jpg'); assert.equal(metadata.originalName, 'diagram.png');
    assert.equal(metadata.size, 120_000); assert.equal(metadata.originalSize, 1_000_000);
    assert.equal(source.name, 'diagram.png');
});

test('payload failures never offer a transient retry or web-search fallback', () => {
    const error = { status: 413, message: 'Request failed' };
    assert.equal(classifyFailure(error).recoverable, false);
    assert.deepEqual(classifyFailure(error).userActions, []);
    assert.match(buildUserFacingErrorMessage(error), /smaller image/);
    assert.equal(shouldShowFailureFallbackCard(error, 'Read my attachment'), false);
});

test('the final transport budget includes appended custom instructions', async () => {
    const savedWindow = globalThis.window, savedLocation = globalThis.location;
    let calls = 0;
    try {
        globalThis.location = new URL('https://jarvis.example/');
        globalThis.window = { customSystemPrompt: '\u6f22'.repeat(1200), fetch: async (_url, init) => {
            calls++; assert.equal(JSON.parse(init.body).preferences.customSystemPrompt.length, 1200);
            return Response.json({ success: true });
        } };
        installRequestPreferences();
        await assert.rejects(window.fetch('/api/chat-groq', { body: JSON.stringify({ message: 'A'.repeat(MAX_JSON_REQUEST_BYTES - 100) }) }), isPayloadTooLarge);
        assert.equal(calls, 0);
        await window.fetch('/api/chat-groq', { body: JSON.stringify({ message: 'Small request' }) });
        assert.equal(calls, 1);
    } finally {
        if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow;
        if (savedLocation === undefined) delete globalThis.location; else globalThis.location = savedLocation;
    }
});

test('request budgets count UTF-8 JSON and reject oversized text before fetch', async () => {
    const payload = { message: '\u6f22'.repeat(1_400_000) };
    assert.ok(payload.message.length < MAX_JSON_REQUEST_BYTES);
    assert.throws(() => serializeRequestPayload(payload), isPayloadTooLarge);
    const original = globalThis.fetch;
    let calls = 0;
    try {
        globalThis.fetch = async () => { calls++; return Response.json({ success: true }); };
        await assert.rejects(postJson('/api/chat-groq', payload), error => isPayloadTooLarge(error) && !error.retryable);
        assert.equal(calls, 0);
        globalThis.fetch = async () => { calls++; return new Response('FUNCTION_PAYLOAD_TOO_LARGE', { status: 413 }); };
        await assert.rejects(postJson('/api/chat-groq', { message: 'Read the image' }), error => error.status === 413 && error.code === 'request_too_large' && !error.retryable && /smaller image/.test(error.message));
        assert.equal(calls, 1);
    } finally { globalThis.fetch = original; }
});

test('multiple inline images share the complete request budget without losing context or originals', async () => {
    const images = ['first.png', 'second.png', 'third.png'].map(name => ({ name, mimeType: 'image/png', base64: 'A'.repeat(2_000_000) }));
    const payload = { message: 'Explain all three diagrams', context: '\u6f22'.repeat(100_000), preferences: { customSystemPrompt: 'Use concise steps.' }, images };
    const calls = [];
    const prepared = await prepareRequestPayload(payload, { resizeImage: async (base64, mimeType, allowance) => {
        calls.push({ size: base64.length, mimeType, allowance }); return 'B'.repeat(allowance);
    } });
    assert.equal(calls.length, 3);
    assert.ok(jsonByteLength(prepared) < MAX_JSON_REQUEST_BYTES);
    assert.equal(prepared.context, payload.context); assert.deepEqual(prepared.preferences, payload.preferences);
    assert.deepEqual(prepared.images.map(image => image.name), images.map(image => image.name));
    assert.ok(prepared.images.every(image => image.mimeType === 'image/jpeg'));
    assert.ok(images.every(image => image.base64.length === 2_000_000 && image.mimeType === 'image/png'));
    const small = { images: [{ base64: 'small-lossless-image', mimeType: 'image/png' }] };
    assert.equal(await prepareRequestPayload(small), small);
});

test('oversized vision and ingestion images are bounded, and failed or canceled resizing never sends originals', async () => {
    for (const key of ['imageBase64', 'base64']) {
        const payload = { [key]: 'A'.repeat(5_000_000), mimeType: 'image/png', prompt: 'Read the formula' };
        const result = await prepareRequestPayload(payload, { resizeImage: async () => 'B'.repeat(500_000) });
        assert.equal(result[key].length, 500_000); assert.equal(result.mimeType, 'image/jpeg');
        assert.equal(payload[key].length, 5_000_000);
        await assert.rejects(prepareRequestPayload(payload, { resizeImage: async () => 'B'.repeat(5_000_000) }), isPayloadTooLarge);
        const controller = new AbortController();
        await assert.rejects(prepareRequestPayload(payload, { signal: controller.signal, resizeImage: async () => { controller.abort(); return 'B'; } }), error => error.name === 'AbortError');
    }
});

test('rejected attachment batches can be restored without duplicate files', async () => {
    const attachments = await import('../app/attachments.js');
    attachments.clearPendingAttachments();
    const items = [{ id: 'retry-image', name: 'diagram.png', base64: 'source-pixels' }];
    attachments.restorePendingAttachments(items); attachments.restorePendingAttachments(items);
    assert.equal(attachments.getPendingAttachments().length, 1);
    assert.equal(attachments.takePendingForSend()[0], items[0]);
    assert.equal(attachments.getPendingAttachments().length, 0);
});

test('restored attachment sizes remain synchronous before lazy document parsers load', () => {
    const attachments = lazyModule(() => { throw new Error('Formatting must not import document parsers'); }, { formatBytes });
    assert.equal(attachments.formatBytes(23347), '22.8 KB');
    assert.equal(typeof attachments.formatBytes(100), 'string');
});

test('vision distinguishes configured provider failures from missing credentials and reserves the fallback attempt', async () => {
    const original = globalThis.fetch;
    const models = ['GEMINI_VISION_MODEL', 'GROQ_VISION_MODEL', 'GEMINI_MODEL', 'GROQ_MODEL'];
    const saved = Object.fromEntries(models.map(name => [name, process.env[name]]));
    const images = [{ mimeType: 'image/png', base64: 'eA==' }];
    const options = { customGroqKey: 'synthetic-groq', customGeminiKey: 'synthetic-gemini' };
    try {
        process.env.GEMINI_VISION_MODEL = 'gemini-4-hydrogen'; process.env.GROQ_VISION_MODEL = 'qwen/qwen3.8-27b';
        const calls = [];
        globalThis.fetch = async (url, init) => {
            calls.push(String(url)); const body = JSON.parse(init.body);
            if (String(url).includes('googleapis.com')) {
                assert.match(String(url), /models\/gemini-4-hydrogen:/);
                assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'HIGH');
                assert.equal(body.generationConfig.topK, undefined);
                return new Response('{}', { status: 503 });
            }
            assert.equal(body.model, 'qwen/qwen3.8-27b');
            assert.equal(body.messages.at(-1).content[1].type, 'image_url');
            return Response.json({ choices: [{ message: { content: 'The image contains an integral.' } }] });
        };
        const recovered = await chat.runModelWithFallback('Evaluate this integral from the image.', {}, null, images, options);
        assert.equal(recovered.ok, true); assert.equal(recovered.provider, 'groq'); assert.equal(calls.length, 2);
        calls.length = 0;
        globalThis.fetch = async url => { calls.push(String(url)); return new Response('{}', { status: String(url).includes('googleapis.com') ? 429 : 503 }); };
        for (const streaming of [false, true]) {
            calls.length = 0;
            const result = streaming ? await chat.streamModelWithFallback('Read the image.', {}, () => {}, null, images, options) : await chat.runModelWithFallback('Read the image.', {}, null, images, options);
            assert.equal(result.ok, false); assert.equal(result.payload.code, 'vision_rate_limited');
            assert.equal(calls.length, 2); assert.ok(calls[0].includes('googleapis.com')); assert.ok(calls[1].includes('groq.com'));
            assert.doesNotMatch(result.payload.response, /configure.*key|requires.*key/i);
        }
        globalThis.fetch = async (url, init) => {
            assert.match(String(url), /gemini-4-hydrogen/);
            assert.ok(JSON.parse(init.body).contents[0].parts.some(part => part.inlineData));
            return Response.json({ candidates: [{ content: { parts: [{ text: 'The integral can be simplified by substitution.' }] } }] });
        };
        const gemini = await chat.runModelWithFallback('Evaluate this integral.', {}, null, images, options);
        assert.equal(gemini.ok, true); assert.equal(gemini.provider, 'gemini');
        assert.equal(visionFailurePayload(false).code, 'missing_credentials');
        assert.equal(visionFailurePayload(true, [{ status: 401 }, { status: 403 }]).code, 'vision_authentication_failed');
    } finally {
        globalThis.fetch = original;
        for (const name of models) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    }
});

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

test('Automatic chat starts with Hydrogen for JSON and streams, reserves Groq fallback, and honors manual Groq selection', async () => {
    const original = globalThis.fetch; const oldModel = process.env.GEMINI_MODEL;
    process.env.GEMINI_MODEL = 'gemini-2.5-flash';
    const keys = { customGeminiKey: 'synthetic-hydrogen', customGroqKey: 'synthetic-groq' };
    try {
        for (const streaming of [false, true]) {
            const calls = [];
            globalThis.fetch = async (input, init) => { calls.push({ url: String(input), body: JSON.parse(init.body) }); return Response.json({}, { status: 503 }); };
            const run = selected => streaming ? chat.streamModelWithFallback('Actor Example Person', {}, () => {}, selected, undefined, keys) : chat.runModelWithFallback('Actor Example Person', {}, selected, undefined, keys);
            const automatic = await run(null);
            assert.equal(calls.length, 3); assert.match(calls[0].url, /models\/gemini-4-hydrogen:/); assert.match(calls[1].url, /models\/gemini-2\.5-pro:/); assert.match(calls[2].url, /groq\.com/);
            assert.equal(automatic.payload.upstreamAttempts[0].provider, 'gemini');
            assert.equal(automatic.payload.upstreamAttempts[0].status, 503);
            assert.equal(calls[0].body.tools, undefined, 'Automatic chat does not enable billed Google Search tools');
            calls.length = 0; await run('openai/gpt-oss-120b');
            assert.equal(calls.length, 2); assert.match(calls[0].url, /groq\.com/);
        }
        assert.equal(chat.getPreferredGeminiCandidates('', null, { tier: 'deep' })[0], 'gemini-4-hydrogen');
        for (const tier of ['instant', 'standard']) assert.equal(chat.getPreferredGeminiCandidates('', null, { tier, preferSpeed: true })[0], 'gemini-2.5-flash');
        assert.equal(chat.getPreferredGeminiCandidates('', 'gemini-2.5-flash')[0], 'gemini-2.5-flash');
        const groqFallback = chat.getPreferredGroqCandidates('gemini-4-hydrogen', { userSelectedModel: 'gemini-4-hydrogen' });
        assert.equal(groqFallback[0], 'openai/gpt-oss-120b'); assert.ok(groqFallback.every(model => !model.startsWith('gemini-')));
    } finally { globalThis.fetch = original; if (oldModel === undefined) delete process.env.GEMINI_MODEL; else process.env.GEMINI_MODEL = oldModel; }
});

test('upstream diagnostics expose safe categories and parameter names without error text or credentials', async () => {
    const diagnostic = await describeUpstreamFailure(Response.json({ error: { message: 'API key not valid: SECRET-TEST-CREDENTIAL. Unknown parameter includeThoughts' } }, { status: 400 }), 'gemini', 'gemini-4-hydrogen');
    assert.equal(diagnostic.reasonCode, 'invalid_api_key'); assert.deepEqual(diagnostic.parameters, ['includeThoughts']);
    assert.doesNotMatch(JSON.stringify(diagnostic), /SECRET-TEST|Unknown parameter|API key not valid/);
    const rateLimit = await describeUpstreamFailure(Response.json({ private: 'Do not expose this body' }, { status: 429 }), 'gemini', 'gemini-4-hydrogen');
    assert.equal(rateLimit.reasonCode, 'rate_limited'); assert.doesNotMatch(JSON.stringify(rateLimit), /private|expose/);
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

test('service worker uses network-first for app navigations so deploys never serve stale index.html', async () => {
    const listeners = {};
    const puts = [];
    const cachedHtml = new Response('<html>stale</html>', { status: 200 });
    const freshHtml = new Response('<html>fresh</html>', { status: 200 });
    let failNetwork = false;
    const context = vm.createContext({
        URL, Response, Request,
        self: { addEventListener: (name, cb) => listeners[name] = cb, location: { origin: 'https://jarvisjr.vercel.app' } },
        caches: {
            open: async () => ({
                match: async key => key === '/index.html' ? cachedHtml : null,
                put: async (key, val) => puts.push({ key, val })
            }),
            match: async () => null
        },
        fetch: async () => {
            if (failNetwork) throw new Error('offline');
            return freshHtml;
        }
    });
    vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), context);

    let onlineResponse;
    listeners.fetch({
        request: { method: 'GET', mode: 'navigate', url: 'https://jarvisjr.vercel.app/' },
        respondWith: p => onlineResponse = p,
        waitUntil: () => {}
    });
    assert.equal(await (await onlineResponse).text(), '<html>fresh</html>');

    failNetwork = true;
    let offlineResponse;
    listeners.fetch({
        request: { method: 'GET', mode: 'navigate', url: 'https://jarvisjr.vercel.app/' },
        respondWith: p => offlineResponse = p,
        waitUntil: () => {}
    });
    assert.equal(await (await offlineResponse).text(), '<html>stale</html>');
});
