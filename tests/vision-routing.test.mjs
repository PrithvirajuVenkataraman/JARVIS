import assert from 'node:assert/strict';
import { classifyImageLocally } from '../api/_lib/local-vision-classifier.js';
import chatHandler from '../api/chat-groq.js';

console.log('--- Testing Vision Routing & Local Grounding ---');

// 1. Test local classification on mock image - ensures zero fake heuristics
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
// Crucial: Must NEVER contain fake device/screen heuristic labels
assert.equal(String(localResult.response).includes('Smartphone / mobile device'), false);
assert.equal(String(localResult.response).includes('weather application'), false);
assert.equal(String(localResult.summary).includes('Tablet / iPad'), false);

// 2. Validate mathematical formula task
const mathResult = classifyImageLocally({
    imageBase64: mockBase64,
    mimeType: 'image/png',
    prompt: 'Calculate the total formula result',
    task: 'math_ocr_solve'
});
assert.equal(mathResult.success, true);

// 3. Test chat endpoint returns honest disclaimer when vision keys are absent
const prevGroq = process.env.GROQ_API_KEY;
const prevGemini = process.env.GEMINI_API_KEY;
const prevOpenAI = process.env.OPENAI_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_KEY;

const mockReq = {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: {
        message: '?',
        images: [{
            name: 'photo.jpg',
            mimeType: 'image/jpeg',
            base64: mockBase64
        }]
    }
};

let capturedResponse = null;
const mockRes = {
    statusCode: 200,
    headers: {},
    status(c) { this.statusCode = c; return this; },
    setHeader(k, v) { this.headers[k] = v; return this; },
    json(payload) { capturedResponse = payload; return this; },
    end() { return this; }
};

await chatHandler(mockReq, mockRes);
assert.ok(capturedResponse);
assert.equal(capturedResponse.success, true);
assert.ok(capturedResponse.response.includes('Image recognition requires a Gemini'));

if (prevGroq) process.env.GROQ_API_KEY = prevGroq;
if (prevGemini) process.env.GEMINI_API_KEY = prevGemini;
if (prevOpenAI) process.env.OPENAI_API_KEY = prevOpenAI;

console.log('vision-routing-tests-ok');
