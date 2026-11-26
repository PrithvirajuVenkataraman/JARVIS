import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFreeImage } from '../app/horde-client.js';
import { generateImage, cancelAllImageGeneration } from '../app/image-generator.js';
import { imageProxyHandler } from '../api/image-proxy.js';
import { buildDiagnosticsStatus } from '../api/diagnostics.js';

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
test('capacity errors carry the server cooldown and forbidden requests remain distinct', async () => {
    const original = globalThis.fetch;
    try {
        for (const [status, retry, code, wait] of [[429, '2', 'image_queue_full', 2000], [429, null, 'image_queue_full', 60000], [403, null, 'image_access_denied', 0]]) {
            let calls = 0;
            globalThis.fetch = async () => { calls++; return { ok: false, status, headers: { get: () => retry } }; };
            await assert.rejects(generateFreeImage('Times Square'), error => error.code === code && error.retryAfterMs === wait);
            assert.equal(calls, 1);
        }
    } finally { globalThis.fetch = original; }
});

function createMockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(name, value) { this.headers[name] = value; },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; return this; },
        end() { return this; }
    };
}

test('POST /api/image-proxy uses Cloudflare Workers AI fast free-tier when configured', async () => {
    const original = globalThis.fetch;
    const saved = {
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        HF_TOKEN: process.env.HF_TOKEN
    };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-account-test';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token-test';
    process.env.HF_TOKEN = 'hf-token-test';
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        return {
            ok: true,
            status: 200,
            headers: { get: () => 'application/json' },
            json: async () => ({ success: true, result: { image: png } })
        };
    };
    try {
        const res = createMockRes();
        await imageProxyHandler({
            method: 'POST',
            headers: { host: 'localhost', 'content-type': 'application/json' },
            socket: { remoteAddress: '127.0.0.1' },
            body: { prompt: 'Sunset mountains', width: 512, height: 512, steps: 4 }
        }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.provider, 'cloudflare_workers_ai');
        assert.ok(res.body.dataUrl.startsWith('data:image/png;base64,'));
        assert.equal(calls.length, 1);
        assert.ok(calls[0].url.includes('/ai/run/@cf/black-forest-labs/flux-1-schnell'));
        const diag = buildDiagnosticsStatus();
        assert.equal(diag.capabilities.images.fastProxy, true);
        assert.equal(diag.capabilities.images.provider, 'cloudflare_workers_ai');
        assert.ok(!JSON.stringify(diag).includes('cf-token-test'));
    } finally {
        globalThis.fetch = original;
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
});

test('POST /api/image-proxy fails over from Cloudflare to Hugging Face free router on quota limit', async () => {
    const original = globalThis.fetch;
    const saved = {
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        HF_TOKEN: process.env.HF_TOKEN
    };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-account-test';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token-test';
    process.env.HF_TOKEN = 'hf-token-test';
    const pngBytes = Buffer.from(png, 'base64');
    const calls = [];
    globalThis.fetch = async (url, init) => {
        calls.push({ url: String(url), init });
        if (String(url).includes('api.cloudflare.com')) {
            return { ok: false, status: 429, headers: { get: () => 'application/json' } };
        }
        return {
            ok: true,
            status: 200,
            headers: { get: () => 'image/png' },
            arrayBuffer: async () => pngBytes.buffer.slice(pngBytes.byteOffset, pngBytes.byteOffset + pngBytes.byteLength)
        };
    };
    try {
        const res = createMockRes();
        await imageProxyHandler({
            method: 'POST',
            headers: { host: 'localhost', 'content-type': 'application/json' },
            socket: { remoteAddress: '127.0.0.2' },
            body: { prompt: 'Neon city', width: 512, height: 512 }
        }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.provider, 'huggingface_inference');
        assert.ok(res.body.dataUrl.startsWith('data:image/png;base64,'));
        assert.equal(calls.length, 2);
        assert.ok(calls[1].url.startsWith('https://router.huggingface.co/hf-inference/models/'));
    } finally {
        globalThis.fetch = original;
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
});

test('POST /api/image-proxy rejects unreadable non-image upstream payloads safely', async () => {
    const original = globalThis.fetch;
    const saved = {
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        HF_TOKEN: process.env.HF_TOKEN
    };
    process.env.CLOUDFLARE_ACCOUNT_ID = 'cf-account-test';
    process.env.CLOUDFLARE_API_TOKEN = 'cf-token-test';
    delete process.env.HF_TOKEN;
    globalThis.fetch = async () => ({
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({ success: true, result: { image: Buffer.from('<svg></svg>').toString('base64') } })
    });
    try {
        const res = createMockRes();
        await imageProxyHandler({
            method: 'POST',
            headers: { host: 'localhost', 'content-type': 'application/json' },
            socket: { remoteAddress: '127.0.0.4' },
            body: { prompt: 'Safe format test' }
        }, res);
        assert.equal(res.statusCode, 502);
        assert.equal(res.body.error.fallbackEligible, true);
    } finally {
        globalThis.fetch = original;
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
});

test('generateImage falls back seamlessly to AI Horde when server fast proxy is unconfigured', async () => {
    const original = globalThis.fetch;
    const originalImage = globalThis.Image;
    const saved = {
        CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID,
        CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN,
        HF_TOKEN: process.env.HF_TOKEN,
        HUGGINGFACE_API_KEY: process.env.HUGGINGFACE_API_KEY,
        HUGGINGFACE_TOKEN: process.env.HUGGINGFACE_TOKEN
    };
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.HF_TOKEN;
    delete process.env.HUGGINGFACE_API_KEY;
    delete process.env.HUGGINGFACE_TOKEN;
    globalThis.Image = class {
        constructor() { this.naturalWidth = 512; this.naturalHeight = 512; this.src = ''; }
        decode() { return Promise.resolve(); }
    };
    const calls = [];
    let checks = 0;
    globalThis.fetch = async (url, init) => {
        calls.push(String(url));
        if (String(url) === '/api/image-proxy') {
            const mockRes = createMockRes();
            await imageProxyHandler({
                method: 'POST',
                headers: { host: 'localhost', 'content-type': 'application/json' },
                socket: { remoteAddress: '127.0.0.3' },
                body: JSON.parse(init.body)
            }, mockRes);
            return {
                ok: mockRes.statusCode >= 200 && mockRes.statusCode < 300,
                status: mockRes.statusCode,
                json: async () => mockRes.body
            };
        }
        if (String(url).endsWith('/async')) return response({ id: job });
        if (String(url).includes('/check/')) return response({ done: ++checks > 0 });
        return response({ generations: [{ img: png, model: 'community' }] });
    };
    try {
        const result = await generateImage('Alpine lake', { preferServerProxy: true, pollMs: 1 });
        assert.equal(result.provider, 'ai_horde_free');
        assert.ok(result.dataUrl.startsWith('data:image/png;base64,'));
        assert.equal(calls[0], '/api/image-proxy');
        assert.ok(calls.some(u => u.startsWith('https://aihorde.net/api/v2/')));
    } finally {
        globalThis.fetch = original;
        globalThis.Image = originalImage;
        for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : process.env[k] = v;
    }
});
