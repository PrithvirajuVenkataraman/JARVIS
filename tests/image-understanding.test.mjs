import assert from 'node:assert/strict';
import { __test as chatTest } from '../api/chat-groq.js';
import { classifyImageLocally } from '../api/_lib/local-vision-classifier.js';

console.log('--- Testing JARVIS Image Understanding & Multimodal Pipeline ---');

const {
    buildGroundedUserMessage,
    getPreferredGeminiVisionCandidates,
    getPreferredGroqVisionCandidates,
    normalizeImageMimeType
} = chatTest;

// =========================================================================
// 1. Case A: User explicitly specifies a task ("Solve this", code, translate)
// =========================================================================
console.log('1. Verifying Case A: Explicit user intent preservation with attached images...');
{
    const sampleImage = {
        name: 'geometry_problem.png',
        mimeType: 'image/png',
        base64: Buffer.from('mock_png_bytes').toString('base64')
    };

    const promptA = buildGroundedUserMessage({
        message: 'Solve this',
        grounding: {
            kind: 'attachment',
            selectedText: '[Attached Image: geometry_problem.png]',
            images: [sampleImage]
        },
        images: [sampleImage]
    });

    assert.ok(promptA.includes('The user attached 1 image(s)'), 'Prompt must indicate image attachment count');
    assert.ok(promptA.includes('Inspect the attached image(s) directly using your visual capabilities'), 'Prompt must instruct visual inspection');
    assert.ok(promptA.includes('User request: Solve this'), 'Must preserve exact user task');
    assert.ok(promptA.includes('identify all visible text, numbers, equations, diagrams, labels, and choices'), 'Must instruct step-by-step problem solving');
    assert.ok(promptA.includes('Never claim you cannot view, see, open, or access the attachment'), 'Must forbid false claim of inaccessibility');
    // Ensure placeholder text was omitted and not presented as document text
    assert.ok(!promptA.includes('Attached document content:\n[Attached Image:'), 'Must not treat image placeholder as document text');

    // Code screenshot task
    const codePrompt = buildGroundedUserMessage({
        message: 'What is wrong with this code screenshot?',
        grounding: {
            kind: 'attachment',
            images: [sampleImage]
        },
        images: [sampleImage]
    });
    assert.ok(codePrompt.includes('User request: What is wrong with this code screenshot?'));
    assert.ok(codePrompt.includes('transcribe the relevant code and diagnose/fix the issue'));
    console.log('  [PASS] 1.1 Case A explicit tasks ("Solve this", code diagnosis) correctly instruct pixel inspection.');
}

// =========================================================================
// 2. Case B: Implicit user intent (Image attached without explicit task)
// =========================================================================
console.log('2. Verifying Case B: Implicit user intent and automated task inference...');
{
    const sampleImage = {
        name: 'unlabeled_upload.jpg',
        mimeType: 'image/jpeg',
        base64: Buffer.from('mock_jpg_bytes').toString('base64')
    };

    const implicitPrompt = buildGroundedUserMessage({
        message: '',
        grounding: {
            kind: 'attachment',
            images: [sampleImage]
        },
        images: [sampleImage]
    });

    assert.ok(implicitPrompt.includes('The user attached 1 image(s)'));
    assert.ok(implicitPrompt.includes('IMPLICIT INTENT (NO EXPLICIT TASK SPECIFIED)'), 'Must include implicit task guidance');
    assert.ok(implicitPrompt.includes('Mathematics problem: extract expressions and solve it'));
    assert.ok(implicitPrompt.includes('Error screenshot: identify the error and explain the solution'));
    assert.ok(implicitPrompt.includes('Chart or graph: interpret displayed trends and data'));
    assert.ok(implicitPrompt.includes('User request: (User provided image without text; infer and execute the appropriate task)'));
    console.log('  [PASS] 2.1 Case B implicit intent provides structured task inference guidance.');
}

// =========================================================================
// 3. Context-Aware OCR and Supplementary Extracted Text
// =========================================================================
console.log('3. Verifying context-aware OCR integration without requiring "OCR" keyword...');
{
    const sampleImage = {
        name: 'receipt.png',
        mimeType: 'image/png',
        base64: Buffer.from('mock_receipt_bytes').toString('base64')
    };

    const promptWithOcr = buildGroundedUserMessage({
        message: 'How much was the total?',
        selectedText: 'Invoice #4928 Total: $42.50 Tax: $3.50',
        grounding: {
            kind: 'attachment',
            images: [sampleImage]
        },
        images: [sampleImage]
    });

    assert.ok(promptWithOcr.includes('CONTEXT-AWARE OCR INTEGRATION'), 'Must include context-aware OCR rules');
    assert.ok(promptWithOcr.includes('Do not require the user to explicitly say "OCR" or "extract text"'), 'Must not require explicit OCR keyword');
    assert.ok(promptWithOcr.includes('Supplementary extracted text (use for reference, but verify against actual image pixels):\nInvoice #4928 Total: $42.50 Tax: $3.50'), 'Supplementary OCR text included for verification');
    console.log('  [PASS] 3.1 Context-aware OCR rules and supplementary text integration verified.');
}

// =========================================================================
// 4. Multiple Image Attachments Preservation
// =========================================================================
console.log('4. Verifying multiple image attachments preservation...');
{
    const images = [
        { name: 'diagram_part1.png', mimeType: 'image/png', base64: 'abc' },
        { name: 'diagram_part2.png', mimeType: 'image/png', base64: 'def' },
        { name: 'diagram_part3.png', mimeType: 'image/png', base64: 'ghi' }
    ];

    const multiPrompt = buildGroundedUserMessage({
        message: 'Compare these architecture diagrams',
        grounding: {
            kind: 'attachment',
            images
        },
        images
    });

    assert.ok(multiPrompt.includes('The user attached 3 image(s) with this request.'), 'Must track exact count of all 3 images');
    console.log('  [PASS] 4.1 Multiple image attachments preserved across request payload.');
}

// =========================================================================
// 5. Vision Model Candidate Selection & Routing
// =========================================================================
console.log('5. Verifying preferred vision model candidates selection...');
{
    // Gemini Vision Candidates
    const geminiVision = getPreferredGeminiVisionCandidates();
    assert.ok(Array.isArray(geminiVision) && geminiVision.length > 0);
    assert.ok(geminiVision.includes('gemini-3.7-flash'));
    assert.ok(geminiVision.includes('gemini-2.0-flash'));
    assert.ok(geminiVision.includes('gemini-2.5-pro'));

    // When configured model is text-only, must fallback to valid vision candidates
    const fromTextOnly = getPreferredGeminiVisionCandidates('text-only-model');
    assert.ok(fromTextOnly.length >= 3);
    assert.equal(fromTextOnly[0], 'gemini-3.7-flash', 'Default vision candidate must be prioritized');

    // Groq Vision Candidates (must have zero Llama models)
    const groqVision = getPreferredGroqVisionCandidates();
    assert.ok(Array.isArray(groqVision) && groqVision.length > 0);
    assert.ok(groqVision.every(m => !m.toLowerCase().includes('llama')), 'Must never contain Llama models');
    assert.ok(groqVision.some(m => m.includes('qwen')), 'Must contain Qwen multimodal vision models');
    console.log('  [PASS] 5.1 Vision-capable candidate routing verified for Gemini and Groq.');
}

// =========================================================================
// 6. MIME Type Normalization & Local Classifier Cleanliness
// =========================================================================
console.log('6. Verifying MIME type normalization and zero-hallucination local classifier...');
{
    assert.equal(normalizeImageMimeType('image/jpg'), 'image/jpeg');
    assert.equal(normalizeImageMimeType('IMAGE/JPEG'), 'image/jpeg');
    assert.equal(normalizeImageMimeType('image/png'), 'image/png');
    assert.equal(normalizeImageMimeType('image/webp'), 'image/webp');
    assert.equal(normalizeImageMimeType('unknown'), 'image/jpeg');

    const localMeta = classifyImageLocally({
        imageBase64: Buffer.from('test_image_data').toString('base64'),
        mimeType: 'image/png'
    });
    assert.equal(localMeta.success, true);
    assert.ok(localMeta.summary.includes('image/png'));
    // Ensure no fake screen heuristics or hallucinated device categories
    assert.ok(!localMeta.summary.includes('iPad'));
    assert.ok(!localMeta.summary.includes('Smartphone'));
    console.log('  [PASS] 6.1 MIME type normalization and clean local classifier verified.');
}

console.log('--- ALL JARVIS IMAGE UNDERSTANDING TESTS PASSED ---');
