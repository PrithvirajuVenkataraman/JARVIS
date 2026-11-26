import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import visionHandler from '../api/vision.js';
import { extractTextFromImage } from '../api/_lib/vision-extract.js';

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
function response() { const res = new EventEmitter(); return Object.assign(res, { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(data) { this.data = data; this.writableEnded = true; return this; }, end() { this.writableEnded = true; } }); }
function request(body) { return Object.assign(new EventEmitter(), { method: 'POST', headers: { host: 'localhost', 'content-type': 'application/json' }, socket: { remoteAddress: '127.0.0.1' }, body }); }
async function environment(run) {
    const keys = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GROQ_API_KEY', 'GROQ_KEY', 'GEMINI_MODEL', 'GEMINI_VISION_MODEL', 'GROQ_VISION_MODEL', 'DISABLE_VISION_PREPASS', 'LLAMA_CLOUD_API_KEY', 'LLAMACLOUD_API_KEY', 'LLAMAPARSE_TIER'];
    const saved = Object.fromEntries(keys.map(key => [key, process.env[key]])); const original = globalThis.fetch;
    Object.assign(process.env, { GEMINI_API_KEY: 'test-gemini', GROQ_API_KEY: 'test-groq', GEMINI_VISION_MODEL: 'gemini-4-hydrogen', GEMINI_MODEL: 'text-only-model', GROQ_VISION_MODEL: 'qwen/qwen3.8-27b', DISABLE_VISION_PREPASS: 'false', LLAMA_CLOUD_API_KEY: '' });
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

    assert.equal(t.isRateLimitError({ status: 429, message: 'Too many requests' }), true);
    assert.equal(t.isRateLimitError({ code: 'vision_rate_limited' }), true);
    assert.equal(t.isRateLimitError(new Error('Network timeout')), false);
});

test('vision endpoint rate limit accommodates multi-page PDF OCR batches without premature 429 on page 24', async () => environment(async () => {
    globalThis.fetch = async () => Response.json({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ fullText: 'Sample scanned page text content.' }) }] } }]
    });

    for (let page = 1; page <= 25; page++) {
        const res = response();
        const req = request({ task: 'text_extract', prompt: `Page ${page}`, imageBase64: png, mimeType: 'image/png' });
        req.socket.remoteAddress = '198.51.100.42';
        await visionHandler(req, res);
        assert.equal(res.statusCode, 200, `Expected 200 on PDF OCR page ${page}, got ${res.statusCode}`);
    }
}));

function buildStoredZip(entries) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const { name, data } of entries) {
        const nameBuf = Buffer.from(name, 'utf8');
        const bodyBuf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(0, 8);
        local.writeUInt32LE(bodyBuf.length, 18);
        local.writeUInt32LE(bodyBuf.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        nameBuf.copy(local, 30);
        localChunks.push(local, bodyBuf);

        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(0, 10);
        central.writeUInt32LE(bodyBuf.length, 20);
        central.writeUInt32LE(bodyBuf.length, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        nameBuf.copy(central, 46);
        centralChunks.push(central);

        offset += local.length + bodyBuf.length;
    }

    const centralDir = Buffer.concat(centralChunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(centralDir.length, 12);
    eocd.writeUInt32LE(offset, 16);

    return Buffer.concat([...localChunks, centralDir, eocd]);
}

test('API ingest reads PDFs via Gemini inlineData plus Word/PPT/RTF/XLSX and embedded images', async () => environment(async () => {
    const { ingestAttachmentPayload } = await import('../api/_lib/attachment-ingest.js');

    globalThis.fetch = async (_url, init) => {
        const body = JSON.parse(init.body);
        const inline = body?.contents?.[0]?.parts?.[1]?.inlineData;
        if (inline?.mimeType === 'application/pdf') {
            return Response.json({
                candidates: [{ content: { parts: [{ text: 'Scanned PDF Invoice #9042 Total: $420.00' }] } }]
            });
        }
        return Response.json({
            candidates: [{ content: { parts: [{ text: JSON.stringify({ fullText: 'Embedded diagram text: Velocity = 12 m/s', summary: 'Diagram' }) }] } }]
        });
    };

    const pdfRes = await ingestAttachmentPayload({
        filename: 'scanned-bill.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('%PDF-1.4 scanned content', 'utf8').toString('base64')
    });
    assert.equal(pdfRes.ok, true);
    assert.equal(pdfRes.method, 'gemini_pdf_api');
    assert.match(pdfRes.text, /9042/);

    const docxZip = buildStoredZip([
        { name: 'word/document.xml', data: '<w:document><w:body><w:p><w:r><w:t>Short header</w:t></w:r></w:p></w:body></w:document>' },
        { name: 'word/media/image1.png', data: Buffer.from(png, 'base64') }
    ]);
    const docxRes = await ingestAttachmentPayload({
        filename: 'notes.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        base64: docxZip.toString('base64')
    });
    assert.equal(docxRes.ok, true);
    assert.match(docxRes.text, /Short header/);
    assert.match(docxRes.text, /Velocity = 12 m\/s/);
    assert.equal(docxRes.images?.length, 1);

    const pptxZip = buildStoredZip([
        { name: 'ppt/slides/slide1.xml', data: '<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>Q4 Revenue Slide</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>' },
        { name: 'ppt/notesSlides/notesSlide1.xml', data: '<p:notes><a:t>Speaker note: margin up 8%</a:t></p:notes>' },
        { name: 'ppt/media/chart1.png', data: Buffer.from(png, 'base64') }
    ]);
    const pptxRes = await ingestAttachmentPayload({
        filename: 'deck.pptx',
        mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        base64: pptxZip.toString('base64')
    });
    assert.equal(pptxRes.ok, true);
    assert.match(pptxRes.text, /Q4 Revenue Slide/);
    assert.match(pptxRes.text, /margin up 8%/);
    assert.equal(pptxRes.images?.length, 1);

    const rtfRes = await ingestAttachmentPayload({
        filename: 'memo.rtf',
        mimeType: 'application/rtf',
        base64: Buffer.from('{\\rtf1\\ansi Action items for Sprint 4:\\par Complete OCR verification test.}', 'utf8').toString('base64')
    });
    assert.equal(rtfRes.ok, true);
    assert.match(rtfRes.text, /Complete OCR verification test/);

    const xlsxZip = buildStoredZip([
        { name: 'xl/sharedStrings.xml', data: '<sst><si><t>Product</t></si><si><t>Units</t></si><si><t>Widget</t></si></sst>' },
        { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>45</v></c></row></sheetData></worksheet>' }
    ]);
    const xlsxRes = await ingestAttachmentPayload({
        filename: 'sales.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: xlsxZip.toString('base64')
    });
    assert.equal(xlsxRes.ok, true);
    assert.match(xlsxRes.text, /\| Product \| Units \|/);
    assert.match(xlsxRes.text, /\| Widget \| 45 \|/);
}));

test('LlamaParse v2 upload/poll runs before Gemini/local OCR when configured and falls back cleanly on error', async () => environment(async () => {
    const { ingestAttachmentPayload } = await import('../api/_lib/attachment-ingest.js');
    process.env.LLAMA_CLOUD_API_KEY = 'llx-test-key';
    process.env.LLAMAPARSE_TIER = 'agentic';

    const calls = [];
    let pollCount = 0;
    globalThis.fetch = async (url, init) => {
        const u = String(url);
        calls.push({ url: u, method: init?.method || 'GET', auth: init?.headers?.Authorization || init?.headers?.authorization });
        if (u.endsWith('/api/v2/parse/upload')) {
            assert.equal(init.headers.Authorization, 'Bearer llx-test-key');
            assert.equal(init.body instanceof FormData, true);
            assert.match(String(init.body.get('configuration')), /"tier":"agentic"/);
            return Response.json({ id: 'pjb-test-42', status: 'PENDING' });
        }
        if (u.includes('/api/v2/parse/pjb-test-42')) {
            pollCount++;
            if (pollCount === 1) return Response.json({ job: { id: 'pjb-test-42', status: 'PENDING' } });
            return Response.json({
                job: { id: 'pjb-test-42', status: 'SUCCESS' },
                markdown: { pages: [{ page: 1, markdown: '# Invoice Summary\n\n| Item | Total |\n| --- | --- |\n| Widget | $199.00 |' }] }
            });
        }
        throw new Error(`Unexpected upstream call when LlamaParse succeeded: ${u}`);
    };

    const res = await ingestAttachmentPayload({
        filename: 'scanned-report.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('%PDF-1.4 binary', 'utf8').toString('base64')
    });
    assert.equal(res.ok, true);
    assert.equal(res.method, 'llamaparse_api');
    assert.equal(res.provider, 'llamaparse');
    assert.match(res.text, /Invoice Summary/);
    assert.match(res.text, /\$199\.00/);
    assert.equal(pollCount, 2);

    // Fallback check: when LlamaParse returns HTTP 402/error, Gemini native PDF fallback seamlessly handles it
    globalThis.fetch = async (url) => {
        if (String(url).includes('llamaindex.ai')) {
            return Response.json({ detail: 'Credit limit exceeded' }, { status: 402 });
        }
        return Response.json({
            candidates: [{ content: { parts: [{ text: 'Fallback Gemini PDF content verified.' }] } }]
        });
    };
    const fallbackRes = await ingestAttachmentPayload({
        filename: 'scanned-report.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('%PDF-1.4 binary', 'utf8').toString('base64')
    });
    assert.equal(fallbackRes.ok, true);
    assert.equal(fallbackRes.method, 'gemini_pdf_api');
    assert.match(fallbackRes.text, /Fallback Gemini PDF content verified/);
}));
