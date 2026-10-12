import assert from 'node:assert/strict';
import handler from '../api/vision.js';

console.log('--- Testing Vision API Handler ---');

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

// 1. Health check task
const healthReq = createMockReq('POST', { task: 'health_check' });
const healthRes = createMockRes();
await handler(healthReq, healthRes);
assert.equal(healthRes.statusCode, 200);
assert.equal(healthRes.data?.success, true);
assert.equal(healthRes.data?.localFallbackAvailable, true);

// 2. Reject non-POST
const getReq = createMockReq('GET');
const getRes = createMockRes();
await handler(getReq, getRes);
assert.equal(getRes.statusCode, 405);

// 3. Reject missing image
const emptyReq = createMockReq('POST', { prompt: 'What is this?' });
const emptyRes = createMockRes();
await handler(emptyReq, emptyRes);
assert.equal(emptyRes.statusCode, 400);

// 4. Test missing provider 503 error when keys are absent
const prevGroq = process.env.GROQ_API_KEY;
const prevGemini = process.env.GEMINI_API_KEY;
const prevOpenAI = process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_KEY;

const missingKeyReq = createMockReq('POST', { 
    imageBase64: Buffer.from('mock img data').toString('base64'),
    mimeType: 'image/jpeg',
    prompt: 'What is this?' 
});
const missingKeyRes = createMockRes();
await handler(missingKeyReq, missingKeyRes);
assert.equal(missingKeyRes.statusCode, 503);
assert.equal(missingKeyRes.data?.error?.code, 'vision_provider_unavailable');

if (prevGroq) process.env.GROQ_API_KEY = prevGroq;
if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
if (prevOpenAI) process.env.OPENAI_API_KEY = prevOpenAI;

console.log('vision-api-tests-ok');
