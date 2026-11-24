import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler from '../api/stt.js';

function request(body) { return Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body }); }
function response() { return Object.assign(new EventEmitter(), { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, end() { this.writableEnded = true; } }); }
async function environment(run) {
    const keys = ['GROQ_API_KEY', 'GROQ_KEY', 'GROQ_API_KEY_SECONDARY', 'GROQ_API_KEY_FALLBACK'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])), original = globalThis.fetch;
    for (const key of keys) delete process.env[key];
    process.env.GROQ_KEY = ' test-key-alias ';
    try { await run(); } finally { globalThis.fetch = original; for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('large valid audio is treated as binary while metadata still undergoes security checks', async () => environment(async () => {
    let calls = 0;
    globalThis.fetch = async (_url, init) => {
        calls++; assert.equal(init.headers.Authorization, 'Bearer test-key-alias');
        assert.equal(init.body.get('file').name, 'audio.flac');
        assert.equal(init.body.get('file').size, 600000); assert.equal(init.body.get('language'), 'en');
        return Response.json({ text: 'Recognized test speech.', language: 'english', duration: 12 });
    };
    const audioBase64 = Buffer.alloc(600000, 42).toString('base64');
    const res = response(); await handler(request({ audioBase64, mimeType: 'audio/flac', language: 'en-US' }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.data.text, 'Recognized test speech.'); assert.equal(calls, 1);
    const rejected = response(); await handler(request({ audioBase64, mimeType: 'audio/flac', prompt: '<script>untrusted()</script>' }), rejected);
    assert.equal(rejected.statusCode, 400); assert.equal(rejected.data.error.code, 'abusive_payload'); assert.equal(calls, 1);
}));

test('oversize, malformed, and unsupported audio are rejected before contacting a provider', async () => environment(async () => {
    globalThis.fetch = () => { assert.fail('Rejected audio must not reach a provider'); };
    for (const [body, status, code] of [
        [{ audioBase64: 'A'.repeat(4_000_000), mimeType: 'audio/webm' }, 413, 'request_too_large'],
        [{ audioBase64: '%%%invalid%%%', mimeType: 'audio/webm' }, 400, 'invalid_audio'],
        [{ audioBase64: 'YXVkaW8=', mimeType: 'text/html' }, 415, 'unsupported_audio']
    ]) { const res = response(); await handler(request(body), res); assert.equal(res.statusCode, status); assert.equal(res.data.error.code, code); }
}));

test('upstream failures never expose raw provider messages or credentials', async () => environment(async () => {
    globalThis.fetch = async () => new Response('private provider detail: secret-key-token', { status: 429 });
    const res = response(); await handler(request({ audioBase64: 'YXVkaW8=', mimeType: 'audio/webm' }), res);
    assert.equal(res.statusCode, 429); assert.equal(res.data.fallbackToBrowser, true); assert.match(res.data.error.message, /provider limit/); assert.doesNotMatch(JSON.stringify(res.data), /secret-key-token|private provider detail/);
}));

test('disconnecting a transcription request cancels its upstream work without writing a late reply', async () => environment(async () => {
    let started; const waiting = new Promise(resolve => { started = resolve; });
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => { started(init.signal); init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }); });
    const req = request({ audioBase64: 'YXVkaW8=', mimeType: 'audio/webm' }), res = response();
    const task = handler(req, res); const signal = await waiting;
    req.aborted = true; req.emit('aborted'); await task;
    assert.equal(signal.aborted, true); assert.equal(res.data, undefined);
}));
