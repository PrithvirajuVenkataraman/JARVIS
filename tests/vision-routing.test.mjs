import assert from 'node:assert/strict';
import { classifyImageLocally } from '../api/_lib/local-vision-classifier.js';

console.log('--- Testing Vision Routing & Local Grounding ---');

// 1. Test local classification on mock image
const mockBase64 = Buffer.from('mock image bytes data').toString('base64');
const localResult = classifyImageLocally({
    imageBase64: mockBase64,
    mimeType: 'image/jpeg',
    prompt: 'What does this diagram show?',
    task: 'general_vision'
});

assert.equal(typeof localResult, 'object');
assert.equal(localResult.success, true);
assert.ok(localResult.response || localResult.summary);

// 2. Validate mathematical formula task
const mathResult = classifyImageLocally({
    imageBase64: mockBase64,
    mimeType: 'image/png',
    prompt: 'Calculate the total formula result',
    task: 'math_ocr_solve'
});
assert.equal(mathResult.success, true);

console.log('vision-routing-tests-ok');
