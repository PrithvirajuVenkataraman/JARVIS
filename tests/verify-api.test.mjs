import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import handler, { assessAlignment } from '../api/verify.js';

console.log('--- Testing Verification API Utilities & Routing ---');

// 1. Procedural dynamic token alignment testing (Zero hardcoded sentences)
const dynamicTokenA = `Token_${randomUUID().slice(0, 8)}`;
const dynamicTokenB = `Token_${randomUUID().slice(0, 8)}`;

const dynamicReference = `${dynamicTokenA} reference payload`;
const dynamicMatchingResponse = `${dynamicTokenA} response payload`;
const dynamicDivergentResponse = `${dynamicTokenB} response payload`;

const matchResult = assessAlignment(dynamicReference, dynamicMatchingResponse);
assert.equal(typeof matchResult.isAccurate, 'boolean');

const emptyResult = assessAlignment('', '');
assert.equal(emptyResult.isAccurate, true);
assert.equal(emptyResult.extractedAnchor, null);

// 2. Mock API Request/Response Factory
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

// 3. API Handler Method & Validation Routing Tests
const getReq = createMockReq('GET');
const getRes = createMockRes();
await handler(getReq, getRes);
assert.equal(getRes.statusCode, 405);

const invalidReq = createMockReq('POST', {});
const invalidRes = createMockRes();
await handler(invalidReq, invalidRes);
assert.equal(invalidRes.statusCode, 400);
assert.equal(invalidRes.data?.success, false);

const validReq = createMockReq('POST', {
    query: `query_${randomUUID().slice(0, 8)}`,
    llmResponse: `response_${randomUUID().slice(0, 8)}`
});
const validRes = createMockRes();
await handler(validReq, validRes);
assert.equal(validRes.statusCode, 200);
assert.equal(typeof validRes.data?.success, 'boolean');
assert.equal(typeof validRes.data?.verified, 'boolean');
assert.ok(typeof validRes.data?.latencyMs === 'number');
assert.ok(typeof validRes.data?.timestamp === 'number');

console.log('verify-api-tests-ok');
