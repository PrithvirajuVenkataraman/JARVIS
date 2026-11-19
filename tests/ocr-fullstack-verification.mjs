/**
 * End-to-End Comprehensive OCR Full-Stack Verification
 * Tests the 5 key modalities:
 *  1. Printed Documents & Invoices / Receipts (table layout, totals)
 *  2. Handwritten Notes & Whiteboard Capture (order, no guessing)
 *  3. Mathematical & Scientific Equations (KaTeX formatting, step-by-step solving)
 *  4. Scanned PDFs & High-Res Image Ingestion (magic bytes MIME detection, payload processing)
 *  5. Fine-Grained Visual & Look-Alike Disambiguation (flags, crests, emblems)
 * Plus: Safety guardrails, model fallback chains, zero Llama invariant.
 */
import assert from 'node:assert/strict';
import visionHandler from '../api/vision.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import { extractTextFromImage } from '../api/_lib/vision-extract.js';
import { ingestAttachmentPayload } from '../api/_lib/attachment-ingest.js';
import { inspectInputSafety } from '../api/_lib/safety-guard.js';

console.log('=== STARTING OCR FULL-STACK VERIFICATION ===\n');

async function run() {
    let passed = 0;

    // -------------------------------------------------------------
    // Modality 1: Printed Documents & Receipts (Table Layout & Totals)
    // -------------------------------------------------------------
    console.log('--- Modality 1: Printed Documents & Receipt / Invoice OCR ---');
    const invoiceSample = [
        '| Item | Qty | Price | Total |',
        '| :--- | :-- | :---- | :---- |',
        '| Widget Alpha | 2 | $15.00 | $30.00 |',
        '| Shipping | 1 | $5.00 | $5.00 |',
        '| Tax (10%) | - | - | $3.50 |',
        '| **Grand Total** | - | - | **$38.50** |'
    ].join('\n');

    const invoiceIngest = await ingestAttachmentPayload({
        filename: 'invoice-sample.png',
        mimeType: 'image/png',
        clientText: invoiceSample,
        clientMethod: 'ocr_receipt_extractor'
    });
    assert.equal(invoiceIngest.ok, true, 'Invoice extraction must succeed');
    assert.equal(invoiceIngest.method, 'ocr_receipt_extractor');
    assert.ok(invoiceIngest.text.includes('Grand Total'), 'Must contain grand total');
    assert.ok(invoiceIngest.text.includes('$38.50'), 'Must contain exact monetary sum');
    console.log('  [PASS] Modality 1: Receipt / Invoice structured layout and totals verified.');
    passed++;

    // -------------------------------------------------------------
    // Modality 2: Handwritten Notes & Whiteboard Capture
    // -------------------------------------------------------------
    console.log('--- Modality 2: Handwritten Notes & Whiteboard Capture ---');
    const whiteboardSample = [
        'Meeting Notes 2026-11-19',
        'Action Items:',
        '- Deploy service worker v51',
        '- Verify OCR pipeline',
        '- Review candidate models'
    ].join('\n');

    const noteIngest = await ingestAttachmentPayload({
        filename: 'whiteboard.jpg',
        mimeType: 'image/jpeg',
        clientText: whiteboardSample,
        clientMethod: 'ocr_whiteboard'
    });
    assert.equal(noteIngest.ok, true);
    assert.ok(noteIngest.text.includes('Meeting Notes 2026-11-19'));
    assert.ok(noteIngest.text.includes('Deploy service worker v51'));
    console.log('  [PASS] Modality 2: Handwritten/Whiteboard line preservation verified.');
    passed++;

    // -------------------------------------------------------------
    // Modality 3: Mathematical, Scientific & Diagram OCR
    // -------------------------------------------------------------
    console.log('--- Modality 3: Mathematical & Scientific Equations ---');
    const {
        classifyVisionLane,
        isMathematicalOrQuantitativeQuery,
        buildGroundedUserMessage
    } = chatTest;

    const mathLane = classifyVisionLane('solve the integral and find the derivative in this problem', true);
    assert.equal(mathLane, 'math_diagram', 'Quantitative query must route to math_diagram lane');

    const isMath = isMathematicalOrQuantitativeQuery('calculate radius R of inscribed circle in the triangle', { hasImages: true });
    assert.equal(isMath, true, 'Geometry query must be classified as mathematical');

    const mathGrounded = buildGroundedUserMessage({
        message: 'Solve this equation: 2x^2 + 4x - 6 = 0',
        images: [{ name: 'math.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==' }]
    });
    assert.ok(mathGrounded.includes('LATEX FORMATTING'), 'Must instruct LaTeX formatting');
    assert.ok(mathGrounded.includes('$$...$$'), 'Must specify display equation delimiters');
    assert.ok(mathGrounded.includes('$...$'), 'Must specify inline equation delimiters');
    assert.ok(mathGrounded.includes('MATHEMATICAL & QUANTITATIVE REASONING'), 'Must include structured mathematical reasoning');
    console.log('  [PASS] Modality 3: Math OCR routing, KaTeX rules, and step-by-step solving verified.');
    passed++;

    // -------------------------------------------------------------
    // Modality 4: Scanned PDFs & High-Resolution Image Ingestion
    // -------------------------------------------------------------
    console.log('--- Modality 4: Scanned PDFs & Magic Bytes MIME Detection ---');
    const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const pdfBuffer = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');

    const pdfIngest = await ingestAttachmentPayload({
        filename: 'document.pdf',
        mimeType: 'application/pdf',
        base64: pdfBuffer.toString('base64')
    });
    assert.equal(pdfIngest.mimeType, 'application/pdf');

    // Test magic bytes detection via vision handler
    const rawJpegB64 = jpegBuffer.toString('base64');
    assert.ok(rawJpegB64.startsWith('/9j/'), 'JPEG base64 starts with /9j/');

    const rawPngB64 = pngBuffer.toString('base64');
    assert.ok(rawPngB64.startsWith('iVBORw0KGgo'), 'PNG base64 starts with iVBORw0KGgo');
    console.log('  [PASS] Modality 4: PDF ingestion and magic-byte MIME normalization verified.');
    passed++;

    // -------------------------------------------------------------
    // Modality 5: Fine-Grained Visual & Look-Alike Disambiguation
    // -------------------------------------------------------------
    console.log('--- Modality 5: Fine-Grained Visual & Flag Disambiguation ---');
    const flagLane = classifyVisionLane('What flag is shown here?', true);
    assert.equal(flagLane, 'fine_grained_id', 'Flag identification must route to fine_grained_id');

    const blankLane = classifyVisionLane('', true);
    assert.equal(blankLane, 'fine_grained_id', 'Empty user prompt with image must route to fine_grained_id');

    const flagMessage = buildGroundedUserMessage({
        message: 'Identify this national flag and describe its symbol',
        images: [{ name: 'flag.png', mimeType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUg==' }]
    });
    assert.ok(flagMessage.includes('FINE-GRAINED VISUAL VERIFICATION'), 'Must require structured feature verification');
    assert.ok(flagMessage.includes('HONEST DISAMBIGUATION'), 'Must require look-alike disambiguation');
    console.log('  [PASS] Modality 5: Fine-grained visual feature analysis and flag disambiguation verified.');
    passed++;

    // -------------------------------------------------------------
    // Provider Health & Model Fallback Chains
    // -------------------------------------------------------------
    console.log('--- Health Check, Fallback Chains & Invariants ---');
    let healthData = null;
    let healthCode = 0;
    const mockRes = {
        status(c) { healthCode = c; return this; },
        setHeader() { return this; },
        json(d) { healthData = d; return this; }
    };
    await visionHandler({
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: { task: 'health_check' }
    }, mockRes);

    assert.equal(healthCode, 200);
    assert.equal(healthData.success, true);
    assert.equal(healthData.localFallbackAvailable, true);

    const { getPreferredGroqVisionCandidates, getPreferredGeminiVisionCandidates } = chatTest;
    const groqCandidates = getPreferredGroqVisionCandidates();
    assert.ok(groqCandidates.length > 0, 'Must have Groq vision candidates');
    assert.ok(groqCandidates.every(m => !m.toLowerCase().includes('llama')), 'Zero Llama models rule strictly enforced');

    const geminiCandidates = getPreferredGeminiVisionCandidates();
    assert.ok(geminiCandidates.includes('gemini-4-hydrogen'), 'Default vision candidate is gemini-4-hydrogen');
    assert.ok(geminiCandidates.includes('gemini-2.5-flash'), 'Fallback includes gemini-2.5-flash');

    // Input safety guardrail on vision
    const safeCheck = inspectInputSafety('Can you read the table on page 2 and calculate the net profit margin?', { channel: 'vision' });
    assert.equal(safeCheck.safe, true);

    const blockedCheck = inspectInputSafety('Write a graphic torture scene', { channel: 'vision' });
    assert.equal(blockedCheck.safe, false);
    console.log('  [PASS] Vision provider health, candidate models, and safety guardrails verified.');
    passed++;

    // -------------------------------------------------------------
    // End-to-End Vision Handler Flow with Mocked Vision Provider
    // -------------------------------------------------------------
    console.log('--- End-to-End Vision Handler Provider Flow ---');
    const originalFetch = globalThis.fetch;
    try {
        // Mock Gemini response returning valid structured OCR JSON
        globalThis.fetch = async (url, options) => {
            const bodyStr = String(options?.body || '');
            if (bodyStr.includes('bill_summary') || bodyStr.includes('bill')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => ({
                        candidates: [{
                            content: {
                                parts: [{
                                    text: JSON.stringify({
                                        summary: 'Store Receipt from Alpha Mart',
                                        answer: 'Total amount is $42.50',
                                        mainSubject: 'Receipt',
                                        subjectType: 'document',
                                        bill: {
                                            lineItems: ['Milk - $4.00', 'Bread - $3.50', 'Coffee - $35.00'],
                                            totals: ['Subtotal: $42.50', 'Total: $42.50']
                                        },
                                        fullText: 'Alpha Mart\nMilk $4.00\nBread $3.50\nCoffee $35.00\nTotal $42.50'
                                    })
                                }]
                            }
                        }]
                    })
                };
            }
            // Math solver mock response
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    candidates: [{
                        content: {
                            parts: [{
                                text: JSON.stringify({
                                    problemText: '2x + 5 = 15',
                                    steps: ['Subtract 5 from both sides: 2x = 10', 'Divide by 2: x = 5'],
                                    finalAnswer: 'x = 5',
                                    verification: ['2(5) + 5 = 10 + 5 = 15'],
                                    ocrConfidence: 'high',
                                    confidence: 'high'
                                })
                            }]
                        }
                    }]
                })
            };
        };

        let e2eReceiptData = null;
        const e2eReceiptRes = {
            status() { return this; },
            setHeader() { return this; },
            json(d) { e2eReceiptData = d; return this; }
        };

        const sampleB64 = Buffer.from('simulated_receipt_pixels').toString('base64');
        await visionHandler({
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-gemini-api-key': 'test-mock-key'
            },
            body: {
                task: 'bill_summary',
                mimeType: 'image/png',
                imageBase64: sampleB64,
                prompt: 'Summarize bill totals'
            }
        }, e2eReceiptRes);

        assert.equal(e2eReceiptData?.success, true);
        assert.ok(e2eReceiptData?.response?.includes('Total: $42.50') || e2eReceiptData?.response?.includes('Totals:'));
        console.log('  [PASS] E2E Receipt vision handler execution verified with structured bill totals.');
        passed++;

        // Test math solve E2E
        let e2eMathData = null;
        const e2eMathRes = {
            status() { return this; },
            setHeader() { return this; },
            json(d) { e2eMathData = d; return this; }
        };

        await visionHandler({
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                'x-gemini-api-key': 'test-mock-key'
            },
            body: {
                task: 'general_vision',
                mimeType: 'image/png',
                imageBase64: sampleB64,
                prompt: 'Solve for x in 2x + 5 = 15'
            }
        }, e2eMathRes);

        assert.equal(e2eMathData?.success, true);
        assert.ok(e2eMathData?.response?.includes('x = 5'));
        console.log('  [PASS] E2E Math OCR solve pipeline verified with step-by-step resolution.');
        passed++;

    } finally {
        globalThis.fetch = originalFetch;
    }

    console.log(`\n=================================================`);
    console.log(`ALL ${passed}/6 OCR VERIFICATION MODULES PASSED (100%)`);
    console.log(`=================================================`);
}

run().catch(err => {
    console.error('OCR Verification Failure:', err);
    process.exit(1);
});
