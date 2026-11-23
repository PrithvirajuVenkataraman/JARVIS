import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFreeImage } from '../app/horde-client.js';
import { generateImage, cancelAllImageGeneration } from '../app/image-generator.js';

const job = '12345678-1234-1234-1234-123456789abc';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
const response = data => ({ ok: true, json: async () => data });
test('free queue uses one anonymous submission and validates image bytes', async () => {
    const original = globalThis.fetch, calls = [], progress = [];
    let checks = 0;
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/async')) return response({ id: job });
        if (url.includes('/check/')) return response({ done: ++checks > 1, wait_time: 5, queue_position: 2 });
        return response({ generations: [{ img: png, model: 'community' }] });
    };
    try {
        const result = await generateFreeImage('A quiet forest', { pollMs: 1, onProgress: value => progress.push(value) });
        assert.ok(result.dataUrl.startsWith('data:image/png;base64,'));
        assert.equal(result.provider, 'ai_horde_free');
        assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
        assert.ok(calls.every(c => c.url.startsWith('https://aihorde.net/api/v2/')));
        assert.ok(calls.every(c => c.options.headers.apikey === '0000000000' && c.options.credentials === 'omit'));
        assert.equal(JSON.parse(calls[0].options.body).r2, false);
        assert.ok(progress.some(p => p.phase === 'queued'));
    } finally { globalThis.fetch = original; }
});
test('Stop deletes the community job and never submits a fallback', async () => {
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/async')) return response({ id: job });
        if (url.includes('/check/')) { queueMicrotask(cancelAllImageGeneration); return response({ done: false }); }
        return response({});
    };
    try {
        await assert.rejects(generateImage('A quiet forest', { pollMs: 1 }), { name: 'AbortError' });
        assert.equal(calls.filter(c => c.options.method === 'POST').length, 1);
        assert.equal(calls.filter(c => c.options.method === 'DELETE').length, 1);
    } finally { globalThis.fetch = original; }
});
test('pre-aborted and full queues never cause retries or paid requests', async () => {
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = async (url, options) => { calls.push({ url, options }); return { ok: false, status: 429 }; };
    try {
        await assert.rejects(generateFreeImage('Forest', { signal: AbortSignal.abort() }), { name: 'AbortError' });
        assert.equal(calls.length, 0);
        await assert.rejects(generateFreeImage('Forest'), /at capacity/);
        assert.equal(calls.length, 1);
    } finally { globalThis.fetch = original; }
});
test('unsafe provider image URLs are rejected and the unfinished job is deleted', async () => {
    const original = globalThis.fetch, calls = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/async')) return response({ id: job });
        if (url.includes('/check/')) return response({ done: true });
        return response({ generations: [{ img: 'https://untrusted.invalid/payload.svg' }] });
    };
    try { await assert.rejects(generateFreeImage('Forest'), /invalid image data/); assert.equal(calls.at(-1).options.method, 'DELETE'); }
    finally { globalThis.fetch = original; }
});
test('unfulfillable jobs fail immediately and are removed from the queue', async () => {
    const original = globalThis.fetch, methods = [];
    globalThis.fetch = async (url, options) => {
        methods.push(options.method || 'GET');
        return response(url.endsWith('/async') ? { id: job } : { done: false, is_possible: false });
    };
    try { await assert.rejects(generateFreeImage('Forest'), /No free community worker/); assert.deepEqual(methods, ['POST', 'GET', 'DELETE']); }
    finally { globalThis.fetch = original; }
});
