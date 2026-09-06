import assert from 'node:assert/strict';
import handler from '../api/stt.js';

console.log('--- Testing STT API Handler & Routing ---');

function createMockReq(method = 'POST', body = {}) {
    return {
        method,
        headers: { 'content-type': 'application/json' },
        body
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        data: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(k, v) {
            this.headers[k] = v;
            return this;
        },
        json(payload) {
            this.data = payload;
            return this;
        },
        end() {
            return this;
        }
    };
    return res;
}

// 1. Rejects non-POST HTTP methods
const getReq = createMockReq('GET');
const getRes = createMockRes();
await handler(getReq, getRes);
assert.equal(getRes.statusCode, 405);

// 2. Rejects empty audio payload
const emptyReq = createMockReq('POST', {});
const emptyRes = createMockRes();
await handler(emptyReq, emptyRes);
assert.equal(emptyRes.statusCode, 400);
assert.equal(emptyRes.data?.success, false);

// 3. Validates missing API key returns fallback flag gracefully
const originalKey = process.env.GROQ_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_API_KEY_SECONDARY;
delete process.env.GROQ_API_KEY_FALLBACK;

const testReq = createMockReq('POST', {
    audioBase64: Buffer.from('mock audio test buffer').toString('base64'),
    mimeType: 'audio/webm'
});
const testRes = createMockRes();
await handler(testReq, testRes);
assert.equal(testRes.statusCode, 503);
assert.equal(testRes.data?.fallbackToBrowser, true);

if (originalKey) {
    process.env.GROQ_API_KEY = originalKey;
}

// 4. Test api/index.js routes /api/stt
import rootApiHandler from '../api/index.js';
const rootReq = {
    method: 'POST',
    url: '/api/stt',
    headers: { 'content-type': 'application/json' },
    body: {}
};
const rootRes = createMockRes();
await rootApiHandler(rootReq, rootRes);
// Expect 400 (missing_audio) which proves it reached sttHandler rather than 404
assert.equal(rootRes.statusCode, 400);
assert.equal(rootRes.data?.error?.code, 'missing_audio');

console.log('stt-api-tests-ok');
