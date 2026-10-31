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

// 5. Data URL prefix (e.g. from canvas or mobile web) must be accepted and stripped
const dataUrlReq = createMockReq('POST', {
    imageBase64: 'data:image/jpeg;base64,' + Buffer.from('mock img data').toString('base64'),
    prompt: 'What is this?'
});
const dataUrlRes = createMockRes();
await handler(dataUrlReq, dataUrlRes);
assert.equal(dataUrlRes.statusCode, 503, 'Data URL prefix must not trigger 413 invalid_image');

// 6. Mobile uploads with MIME linebreaks (\r\n) or trailing spaces must be sanitized
const whitespaceReq = createMockReq('POST', {
    imageBase64: '\r\n ' + Buffer.from('mock img data').toString('base64').slice(0, 8) + '\r\n ' + Buffer.from('mock img data').toString('base64').slice(8) + '\n',
    prompt: 'What is this?'
});
const whitespaceRes = createMockRes();
await handler(whitespaceReq, whitespaceRes);
assert.equal(whitespaceRes.statusCode, 503, 'Base64 with linebreaks must not trigger 413 invalid_image');

// 7. URL-safe base64 (- and _) must be normalized and accepted
const rawBase64 = Buffer.from('mock img data').toString('base64');
const urlSafeBase64 = rawBase64.replace(/\+/g, '-').replace(/\//g, '_');
const urlSafeReq = createMockReq('POST', {
    imageBase64: urlSafeBase64,
    prompt: 'What is this?'
});
const urlSafeRes = createMockRes();
await handler(urlSafeReq, urlSafeRes);
assert.equal(urlSafeRes.statusCode, 503, 'URL-safe base64 must not trigger 413 invalid_image');

// 8. Truly malformed base64 must be rejected with 413 invalid_image
const malformedReq = createMockReq('POST', {
    imageBase64: '%%%not-a-valid-base64-string$$$###',
    prompt: 'What is this?'
});
const malformedRes = createMockRes();
await handler(malformedReq, malformedRes);
assert.equal(malformedRes.statusCode, 413);
assert.equal(malformedRes.data?.error?.code, 'invalid_image');

if (prevGroq) process.env.GROQ_API_KEY = prevGroq;
if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
if (prevOpenAI) process.env.OPENAI_API_KEY = prevOpenAI;

console.log('vision-api-tests-ok');
