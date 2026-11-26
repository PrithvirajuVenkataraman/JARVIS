import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import visionHandler from '../api/vision.js';
import { extractTextFromImage } from '../api/_lib/vision-extract.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function response() { const res = new EventEmitter(); return Object.assign(res, { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, end() { this.writableEnded = true; } }); }
function request(body) { return Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body }); }
async function environment(run) {
    const keys = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'GROQ_KEY', 'GEMINI_MODEL', 'GEMINI_VISION_MODEL', 'GROQ_VISION_MODEL', 'DISABLE_VISION_PREPASS'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])); const original = globalThis.fetch;
    Object.assign(process.env, { GEMINI_API_KEY: 'test-gemini', GROQ_API_KEY: 'test-groq', GEMINI_VISION_MODEL: 'gemini-4-hydrogen', GEMINI_MODEL: 'text-only-model', GROQ_VISION_MODEL: 'qwen/qwen3.8-27b', DISABLE_VISION_PREPASS: 'false' });
    try { await run(); } finally { globalThis.fetch = original; for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}

test('OCR reserves a fallback provider, honors the vision model, and reports the provider that actually read the image', async () => environment(async () => {
    const calls = [];
    globalThis.fetch = async (input, init) => {
        calls.push(String(input)); const body = JSON.parse(init.body);
        if (calls.length === 1) {
            assert.match(String(input), /gemini-4-hydrogen/); assert.equal(body.contents[0].parts[1].inlineData.data, png);
            assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'LOW'); assert.equal(body.generationConfig.thinkingConfig.thinkingBudget, undefined);
            return Response.json({ error: { message: 'Unsupported configuration' } }, { status: 400 });
        }
        assert.match(String(input), /groq\.com/); assert.equal(body.messages[0].content[1].image_url.url, `data:image/png;base64,${png}`);
        return Response.json({ choices: [{ message: { content: JSON.stringify({ fullText: 'Invoice REF-4827\nTOTAL 19.50' }) } }] });
    };
    const result = await extractTextFromImage({ imageBase64: png });
    assert.equal(calls.length, 2); assert.equal(result.provider, 'groq'); assert.equal(result.ok, true); assert.match(result.text, /REF-4827/);
}));

test('vision uses configured keys and falls back after a Gemini 400 without spending both attempts there', async () => environment(async () => {
    const calls = [];
    globalThis.fetch = async input => { calls.push(String(input)); return calls.length === 1 ? Response.json({ error: { message: 'Unsupported parameter' } }, { status: 400 }) : Response.json({ choices: [{ message: { content: JSON.stringify({ answer: 'A red circle on the left and a blue square on the right.', summary: 'Two shapes.' }) } }] }); };
    const res = response(); await visionHandler(request({ task: 'general_vision', prompt: 'Describe the visible shapes.', imageBase64: png, mimeType: 'image/png' }), res);
    assert.equal(res.statusCode, 200); assert.match(res.data.response, /red circle/); assert.equal(calls.length, 2); assert.match(calls[1], /groq\.com/);
}));

test('configured quota failures remain quota failures rather than a missing-key message', async () => environment(async () => {
    let calls = 0; globalThis.fetch = async () => { calls++; return Response.json({ error: { message: 'Quota exceeded' } }, { status: 429 }); };
    const res = response(); await visionHandler(request({ task: 'text_extract', imageBase64: png, mimeType: 'image/png' }), res);
    assert.equal(calls, 2); assert.equal(res.statusCode, 429); assert.equal(res.data.error.code, 'vision_rate_limited'); assert.doesNotMatch(res.data.error.message, /configure.*key|requires.*key/i);
}));

test('recognizing a circle or triangle does not accidentally invoke the math-solving pipeline', async () => environment(async () => {
    globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ answer: 'The circle is red.', summary: 'A red circle.' }) }] } }] });
    const res = response(); await visionHandler(request({ task: 'general_vision', prompt: 'What color is the circle?', imageBase64: png, mimeType: 'image/png' }), res);
    assert.equal(res.statusCode, 200); assert.equal(res.data.task, 'general_vision'); assert.match(res.data.response, /red/);
}));

test('unconverted camera bytes are not falsely labelled as JPEG and sent to a vision provider', async () => environment(async () => {
    let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No upstream request expected'); };
    const res = response(); await visionHandler(request({ task: 'text_extract', imageBase64: Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]).toString('base64'), mimeType: 'image/tiff' }), res);
    assert.equal(res.statusCode, 415); assert.equal(res.data.error.code, 'image_conversion_required'); assert.equal(calls, 0);
}));

test('vision JSON repair preserves unescaped LaTeX backslashes in OCR and math responses', async () => environment(async () => {
    const rawJsonWithUnescapedLatex = '{"fullText":"\\int \\sqrt{\\tan \\theta} \\, d\\theta = \\frac{1}{2} \\neq 0","summary":"Integral with \\theta and \\frac"}';
    globalThis.fetch = async () => Response.json({
        candidates: [{ content: { parts: [{ text: rawJsonWithUnescapedLatex }] } }]
    });

    const result = await extractTextFromImage({ imageBase64: `data:image/png;base64,${png.replace(/\+/g, '-').replace(/\//g, '_')}`, mimeType: 'image/png' });
    assert.equal(result.ok, true);
    assert.ok(result.text.includes('\\frac{1}{2}'), `Expected preserved \\frac, got: ${result.text}`);
    assert.ok(result.text.includes('\\tan \\theta'), `Expected preserved \\tan \\theta, got: ${result.text}`);
    assert.ok(result.text.includes('\\neq'), `Expected preserved \\neq, got: ${result.text}`);
}));

test('attachment ingest and client OCR helpers handle edge cases (0-byte, encrypted PDF, short math, pptx, data URL base64)', async () => {
    const { ingestAttachmentPayload } = await import('../api/_lib/attachment-ingest.js');
    const attachmentsMod = await import('../app/attachments.js');
    const t = attachmentsMod.__test;

    assert.equal(t.isPptxFile({ name: 'slides.pptx', mimeType: '' }), true);
    assert.equal(t.isPptxFile({ name: 'slides.txt', mimeType: 'text/plain' }), false);

    assert.equal(t.validateFile({ name: 'empty.pdf', size: 0 }).ok, false);
    assert.match(t.validateFile({ name: 'empty.pdf', size: 0 }).message, /empty/i);

    assert.equal(t.classifyPdfError(new Error('No password given')).code, 'pdf_encrypted');
    assert.equal(t.classifyPdfError(new Error('Invalid PDF structure')).code, 'pdf_corrupt');

    assert.equal(t.hasUsefulExtractedText('E = mc^2'), true);
    assert.equal(t.hasUsefulExtractedText('2x + 5 = 19'), true);
    assert.equal(t.hasUsefulExtractedText('OCR scanning page 1...'), false);

    const utf8B64UrlSafe = Buffer.from('Sample contract clause 12', 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const ingestedText = await ingestAttachmentPayload({
        filename: 'notes.txt',
        mimeType: 'text/plain',
        base64: `data:text/plain;base64,${utf8B64UrlSafe}`
    });
    assert.equal(ingestedText.ok, true);
    assert.match(ingestedText.text, /Sample contract clause 12/);

    const emptyPdfIngest = await ingestAttachmentPayload({
        filename: 'blank.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('%PDF-1.4 invalid', 'utf8').toString('base64')
    });
    assert.equal(emptyPdfIngest.ok, false);
    assert.match(emptyPdfIngest.message, /no readable|unable|could not|empty/i);
});
