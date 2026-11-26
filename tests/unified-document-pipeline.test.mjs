import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { createIngestAttachmentHandler } from '../api/ingest-attachment.js';
import { ingestAttachmentPayload, __test as ingestTest } from '../api/_lib/attachment-ingest.js';
import { isTrustedVercelBlobUrl } from '../api/_lib/security.js';
import { __test as chatTest } from '../api/chat-groq.js';
import {
    estimateTokens,
    getModelTokenBudget,
    parseDocumentSections,
    chunkSectionsWithOverlap,
    classifyDocumentQueryMode,
    buildDocumentGroundingBudget,
    selectLlmProviderRoute
} from '../app/document-rag.js';
import {
    computeFileSha256,
    putCachedDocument,
    getCachedDocument,
    deleteCachedDocument,
    clearDocumentCache,
    getDocumentCacheStats
} from '../app/document-cache.js';
import * as attachmentsMod from '../app/attachments.js';

function buildStoredZip(entries = []) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const entry of entries) {
        const nameBuf = Buffer.from(entry.name, 'utf8');
        const dataBuf = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '', 'utf8');
        const compression = entry.deflate ? 8 : 0;
        const payloadBuf = entry.deflate ? deflateRawSync(dataBuf) : dataBuf;
        const uncompressedSize = Number.isFinite(entry.fakeUncompressedSize) ? entry.fakeUncompressedSize : dataBuf.length;

        const local = Buffer.alloc(30 + nameBuf.length);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);
        local.writeUInt16LE(compression, 8);
        local.writeUInt32LE(payloadBuf.length, 18);
        local.writeUInt32LE(uncompressedSize, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        nameBuf.copy(local, 30);

        localChunks.push(local, payloadBuf);

        const central = Buffer.alloc(46 + nameBuf.length);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(20, 4);
        central.writeUInt16LE(20, 6);
        central.writeUInt16LE(compression, 10);
        central.writeUInt32LE(payloadBuf.length, 20);
        central.writeUInt32LE(uncompressedSize, 24);
        central.writeUInt16LE(nameBuf.length, 28);
        central.writeUInt32LE(offset, 42);
        nameBuf.copy(central, 46);

        centralChunks.push(central);
        offset += local.length + payloadBuf.length;
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

function makeMockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        ended: false,
        setHeader(k, v) { this.headers[String(k).toLowerCase()] = String(v); },
        status(code) { this.statusCode = code; return this; },
        json(payload) { this.body = payload; this.ended = true; return this; },
        end() { this.ended = true; return this; }
    };
}

function makeMockReq({ method = 'POST', url = '/api/ingest-attachment', headers = {}, body = {}, formData = null } = {}) {
    return {
        method,
        url,
        headers: { host: 'localhost:3000', ...headers },
        body,
        __testFormData: formData,
        socket: { remoteAddress: '127.0.0.1' }
    };
}

describe('JARVIS Unified Document Pipeline & Large File Architecture', () => {
    test('Vercel Hobby compliance: serverless function count <= 12 and CSP matches vercel.json', () => {
        const apiFiles = fs.readdirSync(path.resolve('api')).filter(f => f.endsWith('.js'));
        assert.ok(apiFiles.length <= 12, `Expected <= 12 serverless functions on Hobby plan, found ${apiFiles.length}: ${apiFiles.join(', ')}`);

        const vercel = JSON.parse(fs.readFileSync(path.resolve('vercel.json'), 'utf8'));
        const csp = vercel.headers?.[0]?.headers?.find(h => h.key === 'Content-Security-Policy')?.value || '';
        assert.ok(csp.includes('https://vercel.com'), 'CSP must allow Vercel Blob handshake');
        assert.ok(csp.includes('https://*.blob.vercel-storage.com'), 'CSP must allow Vercel Blob storage uploads');
    });

    test('Binary multipart/form-data small file ingestion succeeds without base64 encoding', async () => {
        const handler = createIngestAttachmentHandler();
        const fd = new FormData();
        const content = '# Release Plan\n\n## Milestones\nQ4 target launch with 99.9% reliability.';
        fd.append('file', new File([content], 'plan.md', { type: 'text/markdown' }));
        fd.append('filename', 'plan.md');
        fd.append('mimeType', 'text/markdown');

        const req = makeMockReq({
            method: 'POST',
            headers: { 'content-type': 'multipart/form-data; boundary=---test' },
            formData: fd
        });
        const res = makeMockRes();
        await handler(req, res);

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.ok, true);
        assert.equal(res.body.method, 'utf8_decode');
        assert.match(res.body.text, /Q4 target launch/);
        assert.ok(Array.isArray(res.body.sections) && res.body.sections.length >= 1);
    });

    test('Missing BLOB_READ_WRITE_TOKEN reports blobConfigured=false and blocks token generation cleanly without fake tokens', async () => {
        const saved = process.env.BLOB_READ_WRITE_TOKEN;
        delete process.env.BLOB_READ_WRITE_TOKEN;
        try {
            const handler = createIngestAttachmentHandler();
            const statusReq = makeMockReq({ method: 'GET', url: '/api/ingest-attachment?action=blob-status' });
            const statusRes = makeMockRes();
            await handler(statusReq, statusRes);
            assert.equal(statusRes.statusCode, 200);
            assert.equal(statusRes.body.blobConfigured, false);
            assert.equal(statusRes.body.directUploadMaxBytes, 4404019);

            const tokenReq = makeMockReq({
                method: 'POST',
                url: '/api/ingest-attachment?action=blob-upload',
                headers: { 'content-type': 'application/json' },
                body: { type: 'blob.generate-client-token', payload: { pathname: 'huge.pdf', multipart: true } }
            });
            const tokenRes = makeMockRes();
            await handler(tokenReq, tokenRes);
            assert.equal(tokenRes.statusCode, 503);
            assert.equal(tokenRes.body.error.code, 'blob_not_configured');
        } finally {
            if (saved !== undefined) process.env.BLOB_READ_WRITE_TOKEN = saved;
        }
    });

    test('Vercel Blob large file flow ingests blobUrl and ALWAYS deletes temporary blob (including failures)', async () => {
        const deletedUrls = [];
        let generatedTokenPathname = '';
        const handler = createIngestAttachmentHandler({
            forceBlobConfigured: true,
            handleUpload: async ({ body, onBeforeGenerateToken }) => {
                generatedTokenPathname = body.payload.pathname;
                const opts = await onBeforeGenerateToken(generatedTokenPathname, null, true);
                assert.equal(opts.maximumSizeInBytes, 100 * 1024 * 1024);
                assert.equal(opts.addRandomSuffix, true);
                return { type: 'blob.generate-client-token', clientToken: 'synthetic-short-lived-client-token' };
            },
            fetchBlobBuffer: async (url) => {
                if (url.includes('corrupt')) throw new Error('Simulated blob corruption');
                return Buffer.from('Sheet1,Amount\nRevenue,125000\nMargin,42%', 'utf8');
            },
            deleteBlob: async (url) => {
                deletedUrls.push(url);
            }
        });

        // 1. Client token request
        const tokReq = makeMockReq({
            method: 'POST',
            url: '/api/ingest-attachment?action=blob-upload',
            headers: { 'content-type': 'application/json' },
            body: { type: 'blob.generate-client-token', payload: { pathname: 'large-report.csv', multipart: true } }
        });
        const tokRes = makeMockRes();
        await handler(tokReq, tokRes);
        assert.equal(tokRes.statusCode, 200);
        assert.equal(tokRes.body.clientToken, 'synthetic-short-lived-client-token');

        // 2. Successful Blob ingestion triggers automatic del() cleanup
        const blobUrl = 'https://store123.private.blob.vercel-storage.com/large-report-xyz.csv';
        const ingestReq = makeMockReq({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: { blobUrl, filename: 'large-report.csv', mimeType: 'text/csv' }
        });
        const ingestRes = makeMockRes();
        await handler(ingestReq, ingestRes);
        assert.equal(ingestRes.statusCode, 200);
        assert.equal(ingestRes.body.ok, true);
        assert.equal(ingestRes.body.blobCleaned, true);
        assert.match(ingestRes.body.text, /125000/);

        // 3. Even when fetch fails, finally block attempts cleanup and SSRF blocks foreign hosts
        const badBlobUrl = 'https://store123.public.blob.vercel-storage.com/corrupt-xyz.bin';
        const failReq = makeMockReq({
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: { blobUrl: badBlobUrl, filename: 'corrupt.bin', mimeType: 'application/octet-stream' }
        });
        const failRes = makeMockRes();
        await handler(failReq, failRes);
        assert.equal(failRes.statusCode, 502);
        assert.ok(deletedUrls.includes(blobUrl) && deletedUrls.includes(badBlobUrl));

        // 4. Client cleanup endpoint validates SSRF safety
        const ssrfCleanup = makeMockReq({
            method: 'POST',
            url: '/api/ingest-attachment?action=blob-cleanup',
            headers: { 'content-type': 'application/json' },
            body: { blobUrl: 'https://169.254.169.254/latest/meta-data/' }
        });
        const ssrfRes = makeMockRes();
        await handler(ssrfCleanup, ssrfRes);
        assert.equal(ssrfRes.statusCode, 400);
        assert.equal(ssrfRes.body.error.code, 'invalid_blob_url');
    });

    test('Security SSRF validator strictly permits only official HTTPS Vercel Blob domains', () => {
        assert.equal(isTrustedVercelBlobUrl('https://abc123.public.blob.vercel-storage.com/doc.pdf'), true);
        assert.equal(isTrustedVercelBlobUrl('https://abc123.private.blob.vercel-storage.com/doc.pdf'), true);
        assert.equal(isTrustedVercelBlobUrl('http://abc123.public.blob.vercel-storage.com/doc.pdf'), false);
        assert.equal(isTrustedVercelBlobUrl('https://evil.com/abc.blob.vercel-storage.com/doc.pdf'), false);
        assert.equal(isTrustedVercelBlobUrl('https://user@abc123.public.blob.vercel-storage.com/doc.pdf'), false);
        assert.equal(isTrustedVercelBlobUrl('https://127.0.0.1/doc.pdf'), false);
    });

    test('Multi-format lightweight extraction: XLSX preserves workbook sheet names, CSV/YAML/code/DOCX/PPTX/RTF extract cleanly without external calls', async () => {
        const origFetch = globalThis.fetch;
        let externalCalls = 0;
        globalThis.fetch = async () => { externalCalls++; throw new Error('Should not call external paid APIs on native-parseable files!'); };
        try {
            // XLSX with workbook sheet name mapping ("Quarterly P&L")
            const xlsxBuf = buildStoredZip([
                { name: 'xl/workbook.xml', data: '<workbook><sheets><sheet name="Quarterly P&L" sheetId="1" r:id="rId1"/></sheets></workbook>' },
                { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>' },
                { name: 'xl/sharedStrings.xml', data: '<sst><si><t>Metric</t></si><si><t>Q4</t></si><si><t>ARR</t></si></sst>' },
                { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>9.4M</v></c></row></sheetData></worksheet>' }
            ]);
            const xlsxRes = await ingestAttachmentPayload({ filename: 'metrics.xlsx', buffer: xlsxBuf });
            assert.equal(xlsxRes.ok, true);
            assert.match(xlsxRes.text, /## Sheet: Quarterly P&L/);
            assert.match(xlsxRes.text, /\| ARR \| 9\.4M \|/);

            // YAML + TypeScript source code
            const yamlRes = await ingestAttachmentPayload({ filename: 'config.yaml', buffer: Buffer.from('service: jarvis\nfreeTier: true\nconcurrency: 3\n') });
            assert.equal(yamlRes.ok, true);
            assert.match(yamlRes.text, /concurrency: 3/);

            const codeRes = await ingestAttachmentPayload({ filename: 'solver.py', buffer: Buffer.from('def solve(x):\n    return x * 2 + 1\n') });
            assert.equal(codeRes.ok, true);
            assert.match(codeRes.text, /def solve/);

            assert.equal(externalCalls, 0);
        } finally {
            globalThis.fetch = origFetch;
        }
    });

    test('Security validation rejects executable payloads, spoofed PDF/PNG signatures, and ZIP decompression bombs', async () => {
        // Fake EXE renamed as .pdf
        const exeAsPdf = await ingestAttachmentPayload({
            filename: 'malware.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00])
        });
        assert.equal(exeAsPdf.ok, false);
        assert.equal(exeAsPdf.method, 'signature_rejected');

        // Fake PDF without %PDF- signature
        const badPdf = await ingestAttachmentPayload({
            filename: 'fake.pdf',
            mimeType: 'application/pdf',
            buffer: Buffer.from('Not actually a PDF payload')
        });
        assert.equal(badPdf.ok, false);

        // ZIP bomb protection (fakeUncompressedSize > MAX_UNZIPPED_BYTES 35MB)
        const bombZip = buildStoredZip([
            { name: 'word/document.xml', data: '<w:p><w:t>Boom</w:t></w:p>', deflate: true, fakeUncompressedSize: 90 * 1024 * 1024 }
        ]);
        const bombRes = await ingestAttachmentPayload({
            filename: 'bomb.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            buffer: bombZip
        });
        assert.equal(bombRes.ok, false);
    });

    test('SHA-256 content-addressable cache deduplicates & persists extracted documents without re-parsing', async () => {
        await clearDocumentCache();
        const bytes = new TextEncoder().encode('Contract Agreement Clause 7: Liability limited to zero cost.');
        const hash1 = await computeFileSha256(bytes);
        const hash2 = await computeFileSha256(bytes);
        assert.equal(hash1, hash2);
        assert.equal(hash1.length, 64);

        await putCachedDocument({
            hash: hash1,
            name: 'contract.txt',
            size: bytes.byteLength,
            mimeType: 'text/plain',
            parser: 'client_text',
            extractedText: 'Contract Agreement Clause 7: Liability limited to zero cost.',
            sections: parseDocumentSections('Contract Agreement Clause 7', { name: 'contract.txt' })
        });

        const hit = await getCachedDocument(hash1);
        assert.ok(hit);
        assert.equal(hit.name, 'contract.txt');
        const stats = await getDocumentCacheStats();
        assert.equal(stats.count, 1);

        await deleteCachedDocument(hash1);
        assert.equal(await getCachedDocument(hash1), null);
    });

    test('Multi-file queue handles > 12 files, isolates failures independently, respects Retry-After, and supports cancellation', async () => {
        attachmentsMod.clearPendingAttachments();
        await clearDocumentCache();

        const origFetch = globalThis.fetch;
        const origXHR = globalThis.XMLHttpRequest;
        delete globalThis.XMLHttpRequest; // Force clean fetch path in Node test environment

        let seenRetryAfterDelay = false;
        const attemptCounts = new Map();
        globalThis.fetch = async (url, init) => {
            const u = String(url);
            if (u.includes('action=blob-status')) {
                return Response.json({ blobConfigured: false, directUploadMaxBytes: 4404019, blobUploadMaxBytes: 104857600 });
            }
            if (u.endsWith('/api/ingest-attachment')) {
                const name = init.body.get('filename');
                const n = (attemptCounts.get(name) || 0) + 1;
                attemptCounts.set(name, n);
                if (name === 'broken.pdf') {
                    return Response.json({ error: { code: 'corrupt', message: 'Corrupt file' } }, { status: 400 });
                }
                if (name === 'ratelimited.pdf' && n === 1) {
                    seenRetryAfterDelay = true;
                    return new Response(JSON.stringify({ error: { code: 'rate_limited', message: 'Slow down' } }), {
                        status: 429,
                        headers: { 'Retry-After': '0', 'Content-Type': 'application/json' }
                    });
                }
                return Response.json({ ok: true, text: `--- Page 1 ---\nQuarterly financial summary for ${name}: Revenue $142,500 across 12 accounts.`, method: 'pdf_text_server', provider: 'server' });
            }
            throw new Error(`Unexpected fetch URL: ${u}`);
        };

        try {
            // Queue 15 files simultaneously (> old 12 limit!) + 1 oversized >4.2MB without Blob
            const files = [];
            for (let i = 1; i <= 13; i++) {
                files.push(new File([`Report number ${i} content body`], `report-${i}.md`, { type: 'text/markdown' }));
            }
            files.push(new File([Buffer.from('%PDF-1.4\n%broken fixture\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], 'broken.pdf', { type: 'application/pdf' }));
            files.push(new File([Buffer.from('%PDF-1.4\n%ratelimited fixture\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF')], 'ratelimited.pdf', { type: 'application/pdf' }));

            // Oversized mock file > 4.2 MB
            const hugeMock = {
                name: 'massive-presentation.pptx',
                type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
                size: 8 * 1024 * 1024,
                slice: () => ({ arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer }),
                arrayBuffer: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer
            };

            const addedRes = await attachmentsMod.addFilesToComposer([...files, hugeMock], { eagerIngest: false });
            assert.equal(addedRes.added.length, 16, 'Must lift old 12-file limit and accept all 16 valid files');

            const ingested = await attachmentsMod.ingestAllForMessage(addedRes.added, 'Summarize all reports');
            assert.equal(ingested.anyReadable, true);
            assert.equal(seenRetryAfterDelay, true, 'Should retry after 429 with Retry-After');
            assert.ok(ingested.docs.some(d => d.name === 'ratelimited.pdf'), 'Recovered file succeeds after retry');
            assert.ok(ingested.errorMessage.includes('Corrupt file') || ingested.errorMessage.includes('4.2 MB'), 'Failed files isolate errors without breaking batch');

            // Verify cancellation sets status cleanly
            const [firstItem] = attachmentsMod.getPendingAttachments();
            if (firstItem) {
                assert.equal(attachmentsMod.cancelAttachment(firstItem.id), true);
                assert.equal(firstItem.status, 'cancelled');
            }
        } finally {
            attachmentsMod.clearPendingAttachments();
            globalThis.fetch = origFetch;
            if (origXHR !== undefined) globalThis.XMLHttpRequest = origXHR;
        }
    });

    test('Model-aware token budgeting: preserves large Gemini window, enforces Groq TPM cap, eliminates silent truncation via map-reduce/RAG, and removes context duplication', () => {
        // 1. Model budget comparison
        const geminiBudget = getModelTokenBudget('gemini-2.5-flash', 'gemini');
        const groqBudget = getModelTokenBudget('openai/gpt-oss-120b', 'groq');
        assert.ok(geminiBudget.availableDocTokens > 200000, 'Gemini budget must not be stuck at 60k chars');
        assert.ok(groqBudget.availableDocTokens <= 6500, 'Groq free-tier budget stays TPM-safe');

        // 2. Intelligent routing between Groq & Gemini
        const smallDocRoute = selectLlmProviderRoute({
            docs: [{ name: 'notes.txt', extractedText: 'Short meeting summary.' }],
            query: 'What time is the meeting?'
        });
        assert.equal(smallDocRoute.provider, 'groq');

        const multiDocRoute = selectLlmProviderRoute({
            docs: [
                { name: 'a.pdf', extractedText: 'Doc A' },
                { name: 'b.pdf', extractedText: 'Doc B' }
            ],
            query: 'Compare these files'
        });
        assert.equal(multiDocRoute.provider, 'gemini');

        // 3. Exhaustive map-reduce guarantees NO page is dropped on huge docs even under tighter model window
        const pages = Array.from({ length: 12 }, (_, i) => `--- Page ${i + 1} ---\nFinancial figures for division ${i + 1}: ` + 'revenue growth '.repeat(120)).join('\n\n');
        assert.equal(classifyDocumentQueryMode('Summarize every page of this report'), 'exhaustive');
        assert.equal(classifyDocumentQueryMode('What is the margin on page 9?'), 'selective');

        const mapReducePlan = buildDocumentGroundingBudget({
            query: 'Summarize all divisions across every page',
            docs: [{ name: 'annual.pdf', extractedText: pages }],
            provider: 'groq',
            model: 'openai/gpt-oss-120b',
            maxInputTokens: 2500
        });
        assert.equal(mapReducePlan.coverage, 'map_reduce');
        assert.ok(mapReducePlan.batches.length >= 2, 'Exhaustive overflow splits into full-coverage batches rather than dropping trailing pages');
        const coveredPages = new Set(mapReducePlan.batches.flatMap(b => b.chunks.map(c => c.label)));
        assert.equal(coveredPages.size, 12, 'All 12 pages must be represented across map-reduce batches');

        // 4. Context deduplication in buildGroundedUserMessage (single injection, delimited untrusted data)
        const prompt = chatTest.buildGroundedUserMessage('Summarize Q4 revenue.', 'selection_custom', {
            kind: 'attachment',
            attachments: [{ name: 'q4.xlsx', pageCount: 3 }],
            selectedText: '## Sheet: Summary\n| Metric | Value |\n| Revenue | $4.2M |'
        });
        const occurrences = prompt.split('## Sheet: Summary').length - 1;
        assert.equal(occurrences, 1, 'Document body must appear strictly ONCE in grounded user prompt');
        assert.ok(prompt.includes('<attached_document_data>'), 'Untrusted document boundary must be present');
        assert.ok(prompt.includes('passive source data'), 'Prompt injection defense wording must be present');
    });
});
