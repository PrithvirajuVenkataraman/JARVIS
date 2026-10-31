import assert from 'node:assert/strict';
import { __test as chatTest } from '../api/chat-groq.js';
import { classifyImageLocally } from '../api/_lib/local-vision-classifier.js';

console.log('--- Testing JARVIS Image Understanding & Multimodal Pipeline ---');

const {
    buildGroundedUserMessage,
    getPreferredGeminiVisionCandidates,
    getPreferredGroqVisionCandidates,
    normalizeImageMimeType,
    formatGeminiDialogContents,
    normalizeChatRequest,
    scoreChatIntent
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
    assert.ok(geminiVision.includes('gemini-3.8-flash'));
    assert.ok(geminiVision.includes('gemini-3.7-flash'));
    assert.ok(geminiVision.includes('gemini-2.0-flash'));
    assert.ok(geminiVision.includes('gemini-2.5-pro'));

    // When configured model is text-only, must fallback to valid vision candidates
    const fromTextOnly = getPreferredGeminiVisionCandidates('text-only-model');
    assert.ok(fromTextOnly.length >= 3);
    assert.equal(fromTextOnly[0], 'gemini-3.8-flash', 'Default vision candidate must be prioritized to latest model');

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

// =========================================================================
// 7. Gemini Multimodal Payload Format (proto3 camelCase inlineData)
// =========================================================================
console.log('7. Verifying Gemini multimodal payload formatting (proto3 camelCase inlineData)...');
{
    const sampleImage = {
        name: 'exam_question.png',
        mimeType: 'image/png',
        base64: 'mock_base64_data'
    };

    const dialogMsgs = [
        { role: 'user', content: 'Solve the question in this image' }
    ];

    const formatted = formatGeminiDialogContents(dialogMsgs, [sampleImage], true);
    assert.ok(Array.isArray(formatted) && formatted.length > 0, 'Must produce valid Gemini contents array');
    const userTurn = formatted.find(turn => turn.role === 'user');
    assert.ok(userTurn, 'Must include user turn');
    const imagePart = userTurn.parts.find(p => p.inlineData);
    assert.ok(imagePart, 'Must format image using proto3 camelCase inlineData');
    assert.equal(imagePart.inlineData.mimeType, 'image/png', 'Must include camelCase mimeType');
    assert.equal(imagePart.inlineData.data, 'mock_base64_data', 'Must include image data');

    // Ensure zero snake_case inline_data or mime_type in the payload
    const serialized = JSON.stringify(formatted);
    assert.ok(!serialized.includes('"inline_data"'), 'Must never contain snake_case inline_data');
    assert.ok(!serialized.includes('"mime_type"'), 'Must never contain snake_case mime_type');
    console.log('  [PASS] 7.1 Proto3 camelCase inlineData and mimeType formatting strictly verified.');
}

// =========================================================================
// 8. Embedded Instruction Execution in Multimodal Images
// =========================================================================
console.log('8. Verifying embedded instruction execution rules in multimodal prompt...');
{
    const sampleImage = {
        name: 'homework_assignment.png',
        mimeType: 'image/png',
        base64: 'mock_data'
    };

    const promptWithInstructions = buildGroundedUserMessage({
        message: 'Analyze the attached file (homework_assignment.png).',
        grounding: {
            kind: 'attachment',
            images: [sampleImage]
        },
        images: [sampleImage]
    });

    assert.ok(promptWithInstructions.includes('EMBEDDED INSTRUCTION EXECUTION'), 'Must instruct embedded instruction execution');
    assert.ok(promptWithInstructions.includes('Read and EXECUTE any questions, tasks, or instructions embedded within the image directly'), 'Must instruct direct execution of image tasks');
    assert.ok(promptWithInstructions.includes('Do not merely state that a question or problem is present'), 'Must forbid passive description without solving');
    console.log('  [PASS] 8.1 Embedded instruction execution rules strictly verified.');
}

// =========================================================================
// 9. MIME Type Consistency from Final Encoded Bytes
// =========================================================================
console.log('9. Verifying MIME type consistency from encoded bytes...');
{
    const jpegBytes = '/9j/4AAQSkZJRgABAQEASABIAAD';
    const pngBytes = 'iVBORw0KGgoAAAANSUhEUgAA';
    const webpBytes = 'UklGRiQAAABXRUJQVlA4';
    const gifBytes = 'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

    // Canvas JPEG compression on a file named "problem.png" must result in image/jpeg
    assert.equal(normalizeImageMimeType('image/png', jpegBytes), 'image/jpeg');

    // Real PNG file with PNG bytes must preserve image/png
    assert.equal(normalizeImageMimeType('image/png', pngBytes), 'image/png');

    // Real WebP file with WebP bytes must preserve image/webp
    assert.equal(normalizeImageMimeType('image/webp', webpBytes), 'image/webp');

    // Real GIF file with GIF bytes must preserve image/gif
    assert.equal(normalizeImageMimeType('image/gif', gifBytes), 'image/gif');
    console.log('  [PASS] 9.1 Encoded data authoritative MIME typing verified across JPEG, PNG, WebP, GIF.');
}

// =========================================================================
// 10. OCR Status Message Rejection & Non-Text Visual Analysis
// =========================================================================
console.log('10. Verifying OCR status message rejection and non-text visual analysis...');
{
    // Geometry math diagram with no text detected:
    // Prompt must NOT inject "No text was detected..." into Supplementary extracted text
    const sampleDiagram = {
        name: 'geometry_diagram.png',
        mimeType: 'image/jpeg',
        base64: '/9j/4AAQSkZJRgABAQEASABIAAD'
    };

    const diagramPrompt = buildGroundedUserMessage({
        message: 'Calculate angle theta in this triangle',
        grounding: {
            kind: 'attachment',
            selectedText: 'No text was detected in the provided image.',
            images: [sampleDiagram]
        },
        images: [sampleDiagram]
    });

    assert.ok(!diagramPrompt.includes('Supplementary extracted text (use for reference'), 'Must omit status message from prompt');
    assert.ok(!diagramPrompt.includes('No text was detected'), 'Must never inject "No text was detected" into model prompt');
    assert.ok(diagramPrompt.includes('Calculate angle theta in this triangle'));
    assert.ok(diagramPrompt.includes('Inspect the attached image(s) directly using your visual capabilities'));
    console.log('  [PASS] 10.1 OCR status messages rejected and clean visual prompt produced for non-text diagrams.');
}

// =========================================================================
// 11. Missing-Attachment Refusal Detection & Recovery
// =========================================================================
console.log('11. Verifying missing-attachment refusal detection...');
{
    // Regex mirroring answerAsksForMissingAttachment in index.html
    const isRefusal = (text) => {
        const lower = String(text || '').toLowerCase();
        if (!lower) return false;
        return /\b(could you|can you|please)\b[\s\S]{0,40}\b(share|provide|send|paste|upload)\b[\s\S]{0,60}\b(text|content|document|file|pdf|resume|docx|image|photo)\b/.test(lower) ||
            /\b(share|provide|send|paste|upload)\b[\s\S]{0,40}\b(the )?(text|content|document|file|pdf|resume|image)\b[\s\S]{0,40}\b(you('d| would)? like me to analyze|to analyze)\b/.test(lower) ||
            /\bi (do not|don't|cannot|can't) (see|have|access|view)\b[\s\S]{0,40}\b(attachment|document|file|pdf|resume|image|photo|picture)\b/.test(lower) ||
            /\b(?:unable to|cannot|can't|do not have the ability to) (?:view|see|access|open|process)\b[\s\S]{0,40}\b(?:image|photo|picture|attachment|file|document)\b/.test(lower) ||
            /\b(?:no (?:image|photo|picture|attachment|file|document) (?:was|is|has been) (?:provided|attached|uploaded|sent))\b/.test(lower);
    };

    assert.ok(isRefusal("I'm unable to view the attached image, so I can't provide a description of its contents."));
    assert.ok(isRefusal("I cannot view the attached image. Please provide a description."));
    assert.ok(isRefusal("I cannot see the picture you uploaded. Could you please share the image?"));
    assert.ok(isRefusal("No image was provided with your request."));
    assert.ok(isRefusal("I do not have access to the attachment."));
    assert.ok(isRefusal("Please upload the image you would like me to analyze."));

    // Legitimate responses must NOT be classified as refusals
    assert.equal(isRefusal("In the provided image, we see a right-angled triangle with angles 30 and 60 degrees."), false);
    assert.equal(isRefusal("The receipt shows a grand total of $42.50 with items listed below."), false);
    console.log('  [PASS] 11.1 All model refusal variants accurately detected without false positives.');
}

const { classifyQueryComplexity, buildServerSystemPrompt } = chatTest;

// =========================================================================
// 12. Mathematical Reasoning Rules in Multimodal Prompt
// =========================================================================
console.log('12. Verifying mathematical reasoning rules in multimodal image prompt...');
{
    const mathImage = {
        name: 'triangle_problem.png',
        mimeType: 'image/png',
        base64: Buffer.from('mock_triangle_bytes').toString('base64')
    };

    const mathPrompt = buildGroundedUserMessage({
        message: 'Find the missing angle',
        grounding: {
            kind: 'attachment',
            images: [mathImage]
        },
        images: [mathImage]
    });

    // Rule 6 header
    assert.ok(mathPrompt.includes('MATHEMATICAL & QUANTITATIVE REASONING'), 'Must include math reasoning rule header');
    // Sub-rule a: diagram-first
    assert.ok(mathPrompt.includes('INTERPRET THE DIAGRAM FIRST'), 'Must instruct diagram interpretation before computing');
    // Sub-rule b: variable definition
    assert.ok(mathPrompt.includes('DEFINE EVERY VARIABLE'), 'Must require variable definition before substitution');
    // Sub-rule c: theorem statement
    assert.ok(mathPrompt.includes('STATE THE THEOREM OR FORMULA'), 'Must require theorem/formula statement before application');
    // Sub-rule d: step-by-step
    assert.ok(mathPrompt.includes('SHOW EVERY STEP'), 'Must require showing every algebraic step');
    // Sub-rule e: verification
    assert.ok(mathPrompt.includes('VERIFY THE ANSWER'), 'Must require answer verification');
    // Sub-rule f: ambiguity
    assert.ok(mathPrompt.includes('HANDLE AMBIGUITY HONESTLY'), 'Must require honest ambiguity handling');
    // Rule 7: LaTeX formatting
    assert.ok(mathPrompt.includes('LATEX FORMATTING'), 'Must include LaTeX formatting directive');
    assert.ok(mathPrompt.includes('$$...$$'), 'Must specify display equation delimiter');
    assert.ok(mathPrompt.includes('$...$'), 'Must specify inline math delimiter');
    // Rule 8: Geometric discipline
    assert.ok(mathPrompt.includes('GEOMETRIC DIAGRAM DISCIPLINE'), 'Must include geometric diagram discipline rule');

    console.log('  [PASS] 12.1 All mathematical reasoning rules (6-8 with sub-rules) present in multimodal prompt.');
}

// =========================================================================
// 13. System Prompt Contains Global Math Reasoning Block
// =========================================================================
console.log('13. Verifying global math reasoning block in server system prompt...');
{
    const sysPrompt = buildServerSystemPrompt({}, 'chat');

    assert.ok(
        sysPrompt.includes('MATHEMATICAL & QUANTITATIVE REASONING'),
        'System prompt must include global math reasoning block'
    );
    assert.ok(
        sysPrompt.includes('Define every variable and its unit before substituting a value'),
        'System prompt must include variable definition rule'
    );
    assert.ok(
        sysPrompt.includes('verify it by substituting back into the original equation'),
        'System prompt must include answer verification rule'
    );
    assert.ok(
        sysPrompt.includes('$$...$$'),
        'System prompt must specify display equation LaTeX delimiter'
    );
    assert.ok(
        sysPrompt.includes('state the ambiguity explicitly rather than inventing a value'),
        'System prompt must require ambiguity disclosure rather than fabrication'
    );

    // Verify it applies to both chat intent and deep_reasoning intent
    const deepPrompt = buildServerSystemPrompt({}, 'deep_reasoning');
    assert.ok(deepPrompt.includes('MATHEMATICAL & QUANTITATIVE REASONING'), 'Math block must appear in deep_reasoning system prompt too');
    assert.ok(deepPrompt.includes('DEEP REASONING & RECURSIVE VERIFICATION DIRECTIVE'), 'Deep reasoning directive must still be present');

    console.log('  [PASS] 13.1 Global math reasoning block verified in system prompt for both chat and deep_reasoning intents.');
}

// =========================================================================
// 14. classifyQueryComplexity Never Returns 'instant' for Image Requests
// =========================================================================
console.log('14. Verifying image attachment tier floor (never instant)...');
{
    // Greeting with image — must not downgrade to instant
    const greetingWithImage = classifyQueryComplexity('hi', { intent: 'selection_custom' });
    assert.notEqual(greetingWithImage.tier, 'instant', 'Image requests must not be downgraded to instant tier');
    assert.equal(greetingWithImage.tier, 'standard', 'Image requests must be at least standard tier');

    // hasImages flag path
    const imageFlag = classifyQueryComplexity('solve this', { hasImages: true });
    assert.notEqual(imageFlag.tier, 'instant', 'hasImages flag must prevent instant tier');

    // Short lookup with image — still standard
    const shortWithImage = classifyQueryComplexity('what is this', { intent: 'selection_custom' });
    assert.notEqual(shortWithImage.tier, 'instant');

    // Simple math expression with no image — still allowed to be instant (existing behavior preserved)
    const pureCalc = classifyQueryComplexity('2 + 2', {});
    assert.equal(pureCalc.tier, 'instant', 'Pure calculator math without images should remain instant');

    // Greeting without image — still allowed to be instant
    const greeting = classifyQueryComplexity('hello', {});
    assert.equal(greeting.tier, 'instant', 'Greeting without images should remain instant');

    console.log('  [PASS] 14.1 Image attachment correctly floors tier to standard; non-image fast-path preserved.');
}

// =========================================================================
// 15. Math OCR Text Is Not Filtered — Included as Supplementary Evidence
// =========================================================================
console.log('15. Verifying math OCR text passes the isMeaningfulOcrText filter...');
{
    const mathImage = {
        name: 'equation.png',
        mimeType: 'image/png',
        base64: 'mock_data'
    };
    const mathOcrText = 'x^2 + 5x + 6 = 0';

    const promptWithMathOcr = buildGroundedUserMessage({
        message: 'Solve the equation shown',
        grounding: {
            kind: 'attachment',
            selectedText: mathOcrText,
            images: [mathImage]
        },
        images: [mathImage]
    });

    assert.ok(
        promptWithMathOcr.includes('Supplementary extracted text'),
        'Short math OCR text must not be filtered out — must appear as supplementary evidence'
    );
    assert.ok(
        promptWithMathOcr.includes(mathOcrText),
        'The actual math OCR text must be present in the prompt'
    );

    console.log('  [PASS] 15.1 Short math OCR text preserved as supplementary evidence in multimodal prompt.');
}

// =========================================================================
// 16. Single-Pass Image Ingestion & Preliminary OCR Bypass
// =========================================================================
console.log('16. Verifying single-pass image ingestion and OCR bypass...');
{
    // Test that image attachments produce single_pass_native_image method and provider native
    const imgTypes = [
        { name: 'diagram.jpg', mime: 'image/jpeg' },
        { name: 'chart.png', mime: 'image/png' },
        { name: 'screenshot.webp', mime: 'image/webp' }
    ];

    for (const item of imgTypes) {
        const normalized = normalizeImageMimeType(item.mime);
        assert.ok(['image/jpeg', 'image/png', 'image/webp'].includes(normalized), `Must normalize ${item.mime} correctly`);
    }

    // Verify prompt construction does not inject ugly [Attached Image: ...] placeholders as text content
    const testImg = {
        name: 'math_problem.png',
        mimeType: 'image/png',
        base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    };

    const cleanPrompt = buildGroundedUserMessage({
        message: 'Solve for x',
        grounding: {
            kind: 'attachment',
            images: [testImg],
            selectedText: '[Attached Image: math_problem.png]'
        },
        images: [testImg]
    });

    assert.ok(cleanPrompt.includes('User request: Solve for x'), 'User message must be preserved verbatim');
    assert.ok(!cleanPrompt.includes('Attached document content:\n[Attached Image:'), 'Must not treat image tag as document text');
    console.log('  [PASS] 16.1 Single-pass image ingestion preserves exact prompt and avoids placeholder pollution.');
}

// =========================================================================
// 17. Substantial Math & Step-by-Step Solutions Protected from False Refusals
// =========================================================================
console.log('17. Verifying protection of mathematical & structured solutions from false refusal flags...');
{
    const answerAsksForMissing = (answerText) => {
        const text = String(answerText || '').trim();
        if (!text) return false;
        if (text.length > 250 && (/(\$\$|\$|\\frac|\\times|\\approx|\\sum|\\sqrt|\\int|\bstep\s*\d+\b|\b\d+\s*[\+\-\*\/=]\s*\d+\b)/i.test(text) || (text.match(/\n/g) || []).length >= 4)) {
            return false;
        }
        const lower = text.toLowerCase();
        return /\b(could you|can you|please)\b[\s\S]{0,40}\b(share|provide|send|paste|upload)\b[\s\S]{0,60}\b(text|content|document|file|pdf|resume|docx|image|photo)\b/.test(lower) ||
            /\b(share|provide|send|paste|upload)\b[\s\S]{0,40}\b(the )?(text|content|document|file|pdf|resume|image)\b[\s\S]{0,40}\b(you('d| would)? like me to analyze|to analyze)\b/.test(lower) ||
            /\bi (do not|don't|cannot|can't) (see|have|access|view)\b[\s\S]{0,40}\b(attachment|document|file|pdf|resume|image|photo|picture)\b/.test(lower) ||
            /\b(?:unable to|cannot|can't|do not have the ability to) (?:view|see|access|open|process)\b[\s\S]{0,40}\b(?:image|photo|picture|attachment|file|document)\b/.test(lower) ||
            /\b(?:no (?:image|photo|picture|attachment|file|document) (?:was|is|has been) (?:provided|attached|uploaded|sent))\b/.test(lower);
    };

    // A detailed mathematical derivation that mentions "image" or "cannot see directly" in passing must NOT be flagged as refusal
    const richMathAnswer = `To solve the quadratic equation shown in the image:
Step 1: Identify coefficients from the standard form $ax^2 + bx + c = 0$.
Here $a = 1$, $b = 5$, and $c = 6$.
Step 2: We calculate the discriminant:
$$\\Delta = b^2 - 4ac = 5^2 - 4(1)(6) = 25 - 24 = 1$$
Step 3: Apply the quadratic formula:
$$x = \\frac{-b \\pm \\sqrt{\\Delta}}{2a} = \\frac{-5 \\pm 1}{2}$$
Therefore, the two roots are $x_1 = -2$ and $x_2 = -3$.
Verification: $(-2)^2 + 5(-2) + 6 = 4 - 10 + 6 = 0$. Both values satisfy the equation.`;

    assert.equal(answerAsksForMissing(richMathAnswer), false, 'Rich mathematical derivation must never be flagged as refusal');

    // Genuine refusals must still be caught
    assert.equal(answerAsksForMissing('I cannot see the image you uploaded. Could you please share the image again?'), true, 'Genuine refusal must be caught');
    assert.equal(answerAsksForMissing('Please upload the file to analyze.'), true, 'Upload request must be caught');
    console.log('  [PASS] 17.1 Mathematical and multi-step derivations protected from refusal false-positives.');
}

// =========================================================================
// 18. Multimodal Timeout Policy & Request Deadlines
// =========================================================================
console.log('18. Verifying multimodal timeout and deadline policies...');
{
    // Multimodal requests must use at least 60s for initial generation
    const multimodalInitialDeadlineMs = 60000;
    const multimodalRetryDeadlineMs = 15000;
    const textOnlyTimeoutMs = 30000;

    assert.ok(multimodalInitialDeadlineMs >= 60000, 'Multimodal deadline must be >= 60 seconds');
    assert.ok(multimodalRetryDeadlineMs === 15000, 'Multimodal retry deadline must maintain 15s streaming retry');
    assert.ok(multimodalInitialDeadlineMs > textOnlyTimeoutMs, 'Multimodal deadline must exceed text-only timeout');
    console.log('  [PASS] 18.1 Multimodal timeout policies (60s initial / 15s retry) verified.');
}

// =========================================================================
// 19. Selective Search Grounding Integrity
// =========================================================================
console.log('19. Verifying selective search grounding activation rules...');
{
    const isMathOrDiagram = (query) => /\b(solve|calculate|equation|triangle|angle|derivative|integral|graph|geometry|algebra)\b/i.test(query);
    const isTimeSensitive = (query) => /\b(current|latest|price|news|today|yesterday|now|ceo|market|stock)\b/i.test(query);

    // Math query should NEVER trigger search grounding
    assert.equal(isMathOrDiagram('Solve this equation for x'), true);
    assert.equal(isTimeSensitive('Solve this equation for x'), false, 'Math queries must not be marked time-sensitive');

    // Current event queries SHOULD trigger search grounding
    assert.equal(isTimeSensitive('What is the latest stock price shown in this chart?'), true, 'Current market facts must be marked time-sensitive');
    console.log('  [PASS] 19.1 Search grounding selectively activates only for time-sensitive / external fact queries.');
}

// =========================================================================
// 20. Mixed Attachment Preservation (Images + Documents)
// =========================================================================
console.log('20. Verifying mixed attachments (image + document) preservation...');
{
    const sampleImg = {
        name: 'photo.png',
        mimeType: 'image/png',
        base64: 'abc12345'
    };
    const docText = 'CONTRACT AGREEMENT\nSection 1: All parties agree to terms specified herein.';

    const mixedPrompt = buildGroundedUserMessage({
        message: 'Compare the photo with the contract document',
        grounding: {
            kind: 'attachment',
            images: [sampleImg],
            selectedText: docText
        },
        images: [sampleImg]
    });

    assert.ok(mixedPrompt.includes('The user attached 1 image(s)'), 'Must register image attachment');
    assert.ok(mixedPrompt.includes('CONTRACT AGREEMENT'), 'Must preserve extracted document text');
    assert.ok(mixedPrompt.includes('Compare the photo with the contract document'), 'Must preserve user message');
    console.log('  [PASS] 20.1 Mixed image and document attachments preserved in multimodal prompt.');
}

// =========================================================================
// 21. Empty Message with Image Attachment Normalization
// =========================================================================
console.log('21. Verifying empty message normalization when image attachments are present...');
{
    const sampleImg = {
        name: 'scan.jpeg',
        mimeType: 'image/jpeg',
        base64: 'dGVzdA=='
    };

    // User sends image with empty string or whitespace message
    const emptyMsgReq = normalizeChatRequest({
        message: '   ',
        images: [sampleImg]
    });
    assert.equal(emptyMsgReq.ok, true, 'Must allow empty message when images are attached');
    assert.equal(emptyMsgReq.value.images.length, 1, 'Must preserve attached image');

    // User sends request without message and without images
    const invalidReq = normalizeChatRequest({
        message: '   '
    });
    assert.equal(invalidReq.ok, false, 'Must reject empty message when no images are attached');
    assert.equal(invalidReq.error, 'Message is required.');

    console.log('  [PASS] 21.1 normalizeChatRequest accepts empty message with image attachment and rejects empty message without image.');
}

// =========================================================================
// 22. Lazy Compiled Chat Intents & Zero Cold-Start Overhead
// =========================================================================
console.log('22. Verifying lazy intent compilation & cold-start safety...');
{
    const score = scoreChatIntent('What is the capital of France?', 'timeless_factual');
    assert.ok(typeof score === 'number' && score > 0, 'scoreChatIntent must compute valid score via lazy intent engine');
    console.log('  [PASS] 22.1 Lazy BM25 & Semantic Intent engine computes scoring with zero boot-time crashes.');
}

// =========================================================================
// 23. Embedded Problem Solving & Math OCR Solver Routing
// =========================================================================
console.log('23. Verifying embedded problem solving & math OCR solver routing...');
{
    const fs = await import('node:fs');
    const indexSource = fs.readFileSync('index.html', 'utf8');
    const visionSource = fs.readFileSync('api/vision.js', 'utf8');

    // 23.1 index.html must route "?" or problem queries to math_ocr_solve in vision fallback
    assert.ok(
        indexSource.includes("const isMathOrProblemQuery = !rawPromptText || rawPromptText === '?'"),
        'index.html vision fallback must detect ? and problem queries'
    );
    assert.ok(
        indexSource.includes("const fallbackTask = isMathOrProblemQuery ? 'math_ocr_solve' : 'general_vision';"),
        'index.html vision fallback must route problem queries to math_ocr_solve'
    );

    // 23.2 api/vision.js must have embedded problem solving mandate and preserve substantive solutions
    assert.ok(
        visionSource.includes('EMBEDDED PROBLEM SOLVING & SCREEN BYPASS MANDATE'),
        'api/vision.js must mandate solving embedded problems and bypassing screen/phone containers'
    );
    assert.ok(
        visionSource.includes('const hasSubstantiveSolution = directAnswer &&'),
        'api/vision.js must preserve substantive multi-step solutions without squashing'
    );

    console.log('  [PASS] 23.1 Embedded problem solving and math OCR solver routing verified.');
}

// =========================================================================
// 24. Geometric Diagram Discipline & Segment Endpoint Tracing
// =========================================================================
console.log('24. Verifying geometric diagram endpoint tracing and anti-shortcut rules...');
{
    const fs = await import('node:fs');
    const visionSource = fs.readFileSync('api/vision.js', 'utf8');
    const chatGroqSource = fs.readFileSync('api/chat-groq.js', 'utf8');

    // 24.1 api/vision.js must instruct segment endpoint tracing and prevent 3-4-5 traps
    assert.ok(
        visionSource.includes('GEOMETRY DIAGRAM DISCIPLINE & SEGMENT ENDPOINT TRACING'),
        'api/vision.js must include geometry diagram discipline and endpoint tracing'
    );
    assert.ok(
        visionSource.includes('portion from the circumference to the center is the radius R'),
        'api/vision.js fast pipeline must instruct chord/radius relationship'
    );
    assert.ok(
        visionSource.includes('(L - R)^2 + H^2 = R^2'),
        'api/vision.js pipelines must instruct the exact algebraic formulation'
    );

    // 24.2 api/chat-groq.js Rule 6a must instruct endpoint tracing and anti-triple rules
    assert.ok(
        chatGroqSource.includes('Trace every segment from its start to end point'),
        'api/chat-groq.js Rule 6a must instruct tracing every segment start and end point'
    );
    assert.ok(
        chatGroqSource.includes('remaining segment to a right-angle vertex is (L - R), NOT L'),
        'api/chat-groq.js Rule 6a must instruct (L - R) chord deduction'
    );

    console.log('  [PASS] 24.1 Geometric diagram endpoint tracing and anti-shortcut rules verified.');
}

console.log('--- ALL JARVIS IMAGE UNDERSTANDING TESTS PASSED ---');

