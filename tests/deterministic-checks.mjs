import assert from 'node:assert/strict';
import fs from 'node:fs';

// Real API handlers & test helpers
import apiHandler from '../api/_lib/api-router.js';
import chatHandler, { __test as chatTest } from '../api/chat-groq.js';
import currentFactsHandler, { __test as currentFacts } from '../api/_lib/current-facts.js';
import searchHandler, { __test as searchTest } from '../api/search.js';
import diagnosticsHandler from '../api/diagnostics.js';
import sttHandler from '../api/stt.js';
import visionHandler from '../api/vision.js';
import ingestAttachmentHandler from '../api/ingest-attachment.js';
import { clearItems, saveItems } from '../api/_lib/latest/latest-cache.js';
import { classifyFreeLiveIntent, routeMessage } from '../api/_lib/latest/router.js';
import { cleanQueryTarget, extractQueryTargetMetadata } from '../api/_lib/query-target-cleanup.js';
import { __test as freeLiveProviderTest } from '../api/_lib/free-live/providers.js';
import { __test as attachmentIngestTest } from '../api/_lib/attachment-ingest.js';

// Real modular app imports
import {
    decideFrontendRoute,
    isCasualConversationQuery,
    isFastSimpleQuery,
    isSimpleStableQuestion,
    textToEmbeddingVector,
    vectorCosineSimilarity
} from '../app/frontend-routing.js';
import {
    classifyFailure,
    shouldShowFailureFallbackCard,
    getFallbackFailureReason
} from '../app/failure-policy.js';
import {
    scorePlaceEvidence,
    isRelevantPlaceResult
} from '../app/place-grounding.js';
import {
    cleanPhoneDigits,
    saveEmergencyContact,
    getEmergencyContacts,
    generateDistressPayload,
    buildSmsUrl,
    buildWhatsAppUrl,
    buildTelUrl,
    deleteEmergencyContact,
    dispatchImmediateEmergencySms
} from '../app/emergency-sos.js';
import { highlightCode } from '../app/code-highlighter.js';
import { renderMathInText, formatLatexExpression } from '../app/math-renderer.js';
import { renderMarkdown, cleanBulletEndCitations, splitReadableSentences, deBulletizePseudoListIfNeeded } from '../app/markdown-renderer.js';
import {
    cleanAnswerText,
    validateResearchAnswer,
    buildResearchRequirements
} from '../api/_lib/research-evidence.js';
import {
    extractCandidateEntity,
    isValidImageUrl,
    classifyEntityTypeFromDescription,
    isSemanticCreativeWork,
    computeTitleTokenOverlap
} from '../api/_lib/visual-answer-engine.js';

// Load science formatter
import '../science-format.js';
const science = globalThis.JarvisScienceFormat;

// =========================================================================
// Mock Request / Response Helper for Serverless Handlers
// =========================================================================
function createMockReqRes(options = {}) {
    const headers = { 'content-type': 'application/json', ...(options.headers || {}) };
    const req = {
        method: options.method || 'POST',
        url: options.url || '/',
        headers,
        body: options.body || {},
        query: options.query || {}
    };
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        chunks: [],
        writableEnded: false,
        setHeader(name, value) {
            this.headers[name.toLowerCase()] = value;
            return this;
        },
        getHeader(name) {
            return this.headers[name.toLowerCase()];
        },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            this.writableEnded = true;
            return this;
        },
        send(data) {
            this.body = data;
            this.writableEnded = true;
            return this;
        },
        write(chunk) {
            this.chunks.push(String(chunk));
            return true;
        },
        end(chunk) {
            if (chunk) this.chunks.push(String(chunk));
            this.writableEnded = true;
            return this;
        }
    };
    return { req, res };
}

async function callHandler(handler, options = {}) {
    const { req, res } = createMockReqRes(options);
    await handler(req, res);
    return res;
}

console.log('--- Section 1: Real Serverless API Router & Dispatch (api/index.js) ---');
{
    // Unknown route returns 404
    const notFoundRes = await callHandler(apiHandler, { url: '/api/non-existent-route', method: 'GET' });
    assert.equal(notFoundRes.statusCode, 404);
    assert.equal(notFoundRes.body?.error?.code, 'route_not_found');

    // Retired route returns 410
    const retiredRagRes = await callHandler(apiHandler, { url: '/api/rag', method: 'POST' });
    assert.equal(retiredRagRes.statusCode, 410);
    assert.equal(retiredRagRes.body?.error?.code, 'route_retired');

    const retiredDocRes = await callHandler(apiHandler, { url: '/api/document-ingest', method: 'POST' });
    assert.equal(retiredDocRes.statusCode, 410);
    assert.equal(retiredDocRes.body?.error?.code, 'route_retired');

    // Diagnostics via router returns 200
    const diagRes = await callHandler(apiHandler, { url: '/api/diagnostics', method: 'GET' });
    assert.equal(diagRes.statusCode, 200);
    assert.equal(diagRes.body?.ok, true);
    assert.equal(diagRes.body?.diagnostics?.streaming?.available, true);

    // Vercel Hobby Plan Compliance: root api/*.js functions strictly <= 12
    const rootApiJsFiles = fs.readdirSync('api').filter(f => f.endsWith('.js'));
    assert.ok(rootApiJsFiles.length <= 12, `Vercel Hobby plan allows at most 12 Serverless Functions, found ${rootApiJsFiles.length}`);
    assert.ok(rootApiJsFiles.length <= 11, `Safety margin: expected <= 11 root API functions, found ${rootApiJsFiles.length}`);

    // Aux route dispatch through diagnostics
    const smsRouteRes = await callHandler(diagnosticsHandler, { url: '/api/diagnostics?__route=send-sms', method: 'POST', body: {} });
    assert.equal(smsRouteRes.statusCode, 400);
    assert.equal(smsRouteRes.body?.error?.code, 'invalid_recipient');

    const faviconRouteRes = await callHandler(diagnosticsHandler, { url: '/api/diagnostics?__route=favicon', method: 'GET' });
    assert.equal(faviconRouteRes.statusCode, 200);
    assert.equal(faviconRouteRes.headers['content-type'], 'image/svg+xml');

    const extractRouteRes = await callHandler(diagnosticsHandler, { url: '/api/diagnostics?__route=extract-url', method: 'POST', body: {} });
    assert.equal(extractRouteRes.statusCode, 400);
    assert.equal(extractRouteRes.body?.error?.code, 'invalid_url');

    console.log('  [PASS] Top-level API router correctly routes 404, 410, and live sub-endpoints');
}

console.log('--- Section 2: Diagnostics & System Health (api/diagnostics.js) ---');
{
    const diagPost = await callHandler(diagnosticsHandler, { method: 'POST' });
    assert.equal(diagPost.statusCode, 200);
    assert.equal(diagPost.body?.ok, true);
    assert.ok(typeof diagPost.body?.diagnostics?.model === 'object');
    assert.ok(typeof diagPost.body?.diagnostics?.retrieval === 'object');
    assert.ok(typeof diagPost.body?.diagnostics?.costControls === 'object');
    console.log('  [PASS] Diagnostics handler reports comprehensive system configuration');
}

console.log('--- Section 3: Current Facts & Cache Layer (api/current-facts.js) ---');
{
    // Empty request validation
    const emptyRes = await callHandler(currentFactsHandler, { method: 'POST', body: {} });
    assert.equal(emptyRes.statusCode, 400);
    assert.equal(emptyRes.body?.error?.code, 'invalid_request');

    // Cache hit resolution
    clearItems();
    saveItems([{
        title: 'Release update announcement',
        url: 'https://example.org/release-update',
        summary: 'Package updates and improvements.',
        source: 'Reference',
        publishedAt: new Date().toISOString()
    }]);

    const hitRes = await callHandler(currentFactsHandler, {
        method: 'POST',
        body: { query: 'release update' }
    });
    assert.equal(hitRes.statusCode, 200);
    assert.equal(hitRes.body?.resolved, true);
    assert.equal(hitRes.body?.sources[0]?.source, 'Reference');
    console.log('  [PASS] Current facts API enforces request validation and serves cached items');
}

console.log('--- Section 4: Chat Groq API & Reasoning Protocols (api/chat-groq.js) ---');
{
    // Missing body returns 400
    const emptyChat = await callHandler(chatHandler, { method: 'POST', body: {} });
    assert.equal(emptyChat.statusCode, 400);
    assert.equal(emptyChat.body?.error?.code, 'invalid_request');

    // Model selection normalization
    assert.equal(chatTest.normalizeSelectedModel('qwen-2.5-coder-32b'), 'qwen-2.5-coder-32b');
    assert.equal(chatTest.normalizeSelectedModel('deepseek-r1-distill-qwen-32b'), 'deepseek-r1-distill-qwen-32b');
    assert.equal(chatTest.normalizeSelectedModel('gemini-2.5-flash'), 'gemini-2.5-flash');

    // Prompt composition: Native reasoning model receives think instruction
    const r1Prompt = chatTest.composeFinalPrompt('System prompt', '', '', 'Prove Fermat theorem', '', 'chat', 'deepseek-r1-distill-qwen-32b');
    assert.match(r1Prompt, /<think>\.\.\.<\/think>/);

    // Standard model receives explicit instruction not to emit artificial think tags
    const standardPrompt = chatTest.composeFinalPrompt('System prompt', '', '', 'Explain photosynthesis', '', 'chat', 'qwen-2.5-coder-32b');
    assert.match(standardPrompt, /Do not output artificial <think> tags/);

    // Word count parsing and enforcement
    const spec50 = chatTest.parseWordCountRequest('explain photosynthesis in 50 words');
    assert.equal(spec50?.targetWords, 50);
    assert.equal(spec50?.mode, 'exact');

    const spec120 = chatTest.parseWordCountRequest('summarize under 120 words');
    assert.equal(spec120?.maxWords, 120);
    assert.equal(spec120?.mode, 'max');

    assert.equal(chatTest.countWords('Hello world this is a test'), 6);
    console.log('  [PASS] Chat API validates input, normalizes models, and preserves reasoning protocols');
}

console.log('--- Section 5: Search & Web RAG Pipelines (api/search.js) ---');
{
    // Empty query validation
    const emptySearch = await callHandler(searchHandler, { method: 'POST', body: {} });
    assert.equal(emptySearch.statusCode, 400);
    assert.equal(emptySearch.body?.error?.code, 'invalid_request');

    // Search target extraction
    assert.equal(searchTest.extractSearchTargetQuery('Search the web for quantum computing advances'), 'quantum computing advances');

    // Comparison query rewrite
    const comparison = searchTest.buildSearchQueryRewrite('compare iPhone 16 vs Galaxy S24');
    assert.equal(comparison.intent, 'comparison');
    assert.equal(comparison.freshnessNeeded, true);

    // Relevance filtering
    const isRelated = searchTest.isRelatedToQuery('iPhone 16 reviews', {
        title: 'iPhone 16 hands-on review: camera and battery test',
        description: 'Comprehensive review of the iPhone 16 camera, battery, and display.',
        sourceLabel: 'Tech Review'
    });
    assert.equal(isRelated, true);

    const notRelated = searchTest.isRelatedToQuery('iPhone 16 reviews', {
        title: 'Ancient Greek Pottery in Mediterranean Museums',
        description: 'Historical overview of classical Mediterranean ceramics.',
        sourceLabel: 'History Archive'
    });
    assert.equal(notRelated, false);

    // Query target cleaning
    assert.equal(cleanQueryTarget('weather in Tokyo around July'), 'weather in Tokyo');
    assert.equal(cleanQueryTarget('Paris, France tomorrow'), 'Paris, France');
    console.log('  [PASS] Search API enforces query validation, target extraction, and relevance filtering');
}

console.log('--- Section 6: STT, Vision, and Ingestion Endpoints ---');
{
    // STT missing audio validation
    const emptyStt = await callHandler(sttHandler, { method: 'POST', body: {} });
    assert.equal(emptyStt.statusCode, 400);
    assert.equal(emptyStt.body?.error?.code, 'missing_audio');

    // Vision missing image validation
    const emptyVision = await callHandler(visionHandler, { method: 'POST', body: {} });
    assert.equal(emptyVision.statusCode, 400);
    assert.equal(emptyVision.body?.error?.code, 'invalid_request');

    // Ingest attachment missing body validation
    const emptyIngest = await callHandler(ingestAttachmentHandler, { method: 'POST', body: {} });
    assert.equal(emptyIngest.statusCode, 400);
    assert.equal(emptyIngest.body?.error?.code, 'invalid_request');

    // Attachment helper tests
    assert.equal(attachmentIngestTest.tryUtf8Extract(Buffer.from('hello world'), 'text/plain', 'notes.txt'), 'hello world');
    assert.equal(attachmentIngestTest.isPdf('application/pdf', 'doc.pdf'), true);
    assert.equal(attachmentIngestTest.isImage('image/png', 'scan.png'), true);
    console.log('  [PASS] STT, Vision, and Ingestion endpoints properly guard payloads');
}

console.log('--- Section 7: Dynamic Vector Frontend Routing (app/frontend-routing.js) ---');
{
    // Vector embedding invariants
    const v1 = textToEmbeddingVector('artificial intelligence machine learning');
    assert.equal(v1.length, 512);
    let norm = 0;
    for (let i = 0; i < v1.length; i++) norm += v1[i] * v1[i];
    assert.ok(Math.abs(Math.sqrt(norm) - 1.0) < 1e-4, 'Embedding vector must have unit norm');

    // Cosine similarity
    const v2 = textToEmbeddingVector('artificial intelligence machine learning');
    const similaritySame = vectorCosineSimilarity(v1, v2);
    assert.ok(Math.abs(similaritySame - 1.0) < 1e-4, 'Identical vectors must have cosine similarity ~1.0');

    const vDiff = textToEmbeddingVector('cooking pasta bolognese dinner');
    const similarityDiff = vectorCosineSimilarity(v1, vDiff);
    assert.ok(similarityDiff < 0.5, 'Dissimilar texts must have significantly lower similarity');

    // Frontend route decision logic
    assert.equal(isCasualConversationQuery('how are you doing today'), true);
    assert.equal(isCasualConversationQuery('thanks so much'), true);
    assert.equal(isCasualConversationQuery('what is photosynthesis'), false);

    const casualRoute = decideFrontendRoute('So how are you doing today', { turnSource: 'vtt' });
    assert.equal(casualRoute.route, 'fast_simple');
    assert.equal(casualRoute.minimalThinking, true);

    const stableFactRoute = decideFrontendRoute('What is photosynthesis?');
    assert.equal(stableFactRoute.route, 'fast_simple');

    const liveRoute = decideFrontendRoute('Latest news about Bitcoin price');
    assert.equal(liveRoute.route, 'live_required');
    assert.equal(liveRoute.requiresSources, true);

    const heuristicLiveRoute = decideFrontendRoute('What was the price of Bitcoin on 2023-03-15?');
    assert.equal(heuristicLiveRoute.route, 'live_required');
    assert.ok(heuristicLiveRoute.requiresSources);
    assert.equal(heuristicLiveRoute.reason, 'heuristic_live_required');

    const safetyRoute = decideFrontendRoute('how much medicine dosage should I take');
    assert.equal(safetyRoute.route, 'safety_sensitive');
    console.log('  [PASS] Frontend routing accurately classifies vectors, casual queries, facts, and live search');
}

console.log('--- Section 8: Failure Policy & Grounding (app/failure-policy.js, app/place-grounding.js) ---');
{
    const timeoutErr = new Error('network timeout');
    assert.equal(classifyFailure(timeoutErr).code, 'network_timeout');
    assert.equal(getFallbackFailureReason(timeoutErr), 'transient_failure');
    assert.equal(shouldShowFailureFallbackCard('transient_failure', 'museum near me'), true);
    assert.equal(shouldShowFailureFallbackCard('transient_failure', 'how are you'), false);

    const placeEvidence = scorePlaceEvidence('museum in Paris', {
        title: 'Louvre Museum',
        description: 'Historic art museum in Paris, France.',
        url: 'https://louvre.fr',
        sourceType: 'free_place_data'
    }, 'Paris');
    assert.equal(placeEvidence.evidenceLevel, 'strong');

    assert.equal(isRelevantPlaceResult('museum in Paris', {
        title: 'Operating Systems Concept Guide',
        description: 'Guide to Unix operating systems.'
    }, 'Paris'), false);
    console.log('  [PASS] Failure classification and place grounding evidence scoring verified');
}

console.log('--- Section 9: Satellite Emergency SOS (app/emergency-sos.js) ---');
{
    // Phone digit normalization
    assert.equal(cleanPhoneDigits('+91 98765-43210'), '+919876543210');
    assert.equal(cleanPhoneDigits('112'), '112');

    // Contact storage & retrieval
    const contact = saveEmergencyContact({ name: 'Emergency Contact', phone: '+1 555-123-4567', relationship: 'Family', isPrimary: true });
    assert.ok(contact?.id);
    const contacts = getEmergencyContacts();
    assert.ok(contacts.some(c => c.name === 'Emergency Contact'));

    // Distress payload generation
    const payload = generateDistressPayload({
        latitude: 12.969286,
        longitude: 77.770689,
        accuracy: 15.4,
        address: 'Market St, San Francisco, CA',
        batteryLevel: 85
    });
    assert.ok(payload.googleMapsUrl.includes('12.969286'));
    assert.ok(payload.distressText.includes('85%'));

    // Dispatch URLs & Immediate SMS Transmission
    const smsUrl = buildSmsUrl('+15551234567', payload.distressText);
    const waUrl = buildWhatsAppUrl('+15551234567', payload.distressText);
    const telUrl = buildTelUrl('+15551234567');
    assert.ok(smsUrl.startsWith('sms:+15551234567?body='));
    assert.ok(waUrl.startsWith('https://api.whatsapp.com/send?phone='));
    assert.equal(telUrl, 'tel:+15551234567');

    const dispatchedUrl = dispatchImmediateEmergencySms(payload, contact);
    assert.ok(dispatchedUrl.startsWith('sms:+15551234567?body='));
    assert.ok(dispatchedUrl.includes(encodeURIComponent('12.969286')));

    // Cleanup
    deleteEmergencyContact(contact.id);
    console.log('  [PASS] Emergency SOS contacts, distress telemetry, and immediate dispatch channels verified');
}

console.log('--- Section 10: Code Highlighter, Math & Markdown Renderers ---');
{
    // Code highlighting
    const jsHigh = highlightCode('const x = 42;\nfunction test() { return x; }', 'javascript');
    assert.ok(jsHigh.includes('<span class="tok-kw">const</span>'));
    assert.ok(jsHigh.includes('<span class="tok-fn">test</span>'));

    const pyHigh = highlightCode('def calculate(n):\n    return n * 2', 'python');
    assert.ok(pyHigh.includes('<span class="tok-kw">def</span>'));

    const sqlHigh = highlightCode('SELECT id, name FROM users WHERE id = 1;', 'sql');
    assert.ok(sqlHigh.includes('<span class="tok-kw">SELECT</span>'));

    // Math rendering
    const inlineMath = renderMathInText('Energy is $E = mc^2$.');
    assert.ok(inlineMath.includes('<span class="math-inline">E = mc<sup>2</sup></span>'));

    const displayMath = renderMathInText('$$\\frac{a + b}{2} = \\pi$$');
    assert.ok(displayMath.includes('<div class="math-display-block">'));

    const sqrtExpr = formatLatexExpression('\\sqrt{x_1 + x_2}');
    assert.ok(sqrtExpr.includes('math-sqrt') || sqrtExpr.includes('sqrt'));

    // Notebook math rendering tests: boxed answers, multiline alignments, and symbol normalization
    const boxedExpr = formatLatexExpression('\\boxed{r = 3 \\sqrt{13}\\ cm \\; (\\approx 10.8\\ cm)}');
    assert.ok(boxedExpr.includes('math-notebook-answer'), 'Must render boxed expressions as notebook answers');
    assert.ok(!boxedExpr.includes('\\boxed'), 'Must strip literal \\boxed syntax');
    assert.ok(boxedExpr.includes('&asymp;'), 'Must normalize \\approx to &asymp;');

    // Multiline alignment in math block
    const alignMd = '```latex\n\\begin{aligned}\nr &\\approx 3 \\times 3.6055 \\\\\n  &\\approx 10.82\\text{ cm}\n\\end{aligned}\n```';
    const alignRendered = renderMarkdown(alignMd);
    assert.ok(alignRendered.includes('math-display-block'), 'Latex block must render as display math, NOT code block');
    assert.ok(!alignRendered.includes('assistant-md-code-container'), 'Latex block must NEVER produce assistant-md-code-container');
    assert.ok(!alignRendered.includes('\\end{aligned}'), 'Must not leak dangling \\end{aligned}');

    // Inline backticked math unwrap
    const backtickMd = 'The radius is `r \\approx 3 \\times 3.6055` and answer `\\boxed{10.8\\ cm}`.';
    const backtickRendered = renderMarkdown(backtickMd);
    assert.ok(!backtickRendered.includes('assistant-md-inline-code'), 'Backticked math must NOT produce assistant-md-inline-code badge');
    assert.ok(backtickRendered.includes('math-notebook-answer'), 'Backticked \\boxed must produce math-notebook-answer');

    // Markdown rendering
    const md = `# Title\n\nInline math $a^2 + b^2 = c^2$\n\n\`\`\`python\ndef add(a, b):\n    return a + b\n\`\`\`\n`;
    const rendered = renderMarkdown(md);
    assert.ok(rendered.includes('<h2 class="assistant-md-heading">Title</h2>'));
    assert.ok(rendered.includes('assistant-md-code-container'));

    // Science format
    assert.ok(science, 'Science format API must be available');
    const sciHtml = science.enhancePlainText('6.022e23 mol^-1 and 1.602176634e-19 C.');
    assert.ok(sciHtml.includes('science-value-sci'));
    assert.equal(science.normalizeScienceText('0xFF 255.'), 'hex F F 255.');
    assert.ok(science.normalizeScienceText('C2H6 + O2 -> CO2 + H2O').includes('yields'));

    // Bullet point trailing citation / fact number removal contracts
    const testBullet1 = '- Popularized the Gaana style in movies, earning the nickname "Thenisai Thendral" 【f1】 .';
    const testBullet2 = '- Breakthrough came with "Maattukara Mannaru" (1986) and "Baasha" (1995) 【f2】 .';
    const testBullet3 = '- Legendary figure in South-Indian cinema 【f3】 .';
    const testBullet4 = '- Released albums in 2024 [1] .';
    const testBullet5 = '- Watched Top Gun 2.';
    const testBullet6 = '- Born in (1950).';
    const bulletMd = `${testBullet1}\n${testBullet2}\n${testBullet3}\n${testBullet4}\n${testBullet5}\n${testBullet6}`;
    const bulletRendered = renderMarkdown(bulletMd);
    assert.ok(!bulletRendered.includes('【f1】'), 'Must strip 【f1】 fact tag from bullet');
    assert.ok(!bulletRendered.includes('【f2】'), 'Must strip 【f2】 fact tag from bullet');
    assert.ok(!bulletRendered.includes('【f3】'), 'Must strip 【f3】 fact tag from bullet');
    assert.ok(!bulletRendered.includes('[1]'), 'Must strip [1] citation number from bullet end');
    assert.ok(bulletRendered.includes('Thenisai Thendral') && bulletRendered.includes('.</li>'), 'Must cleanly attach period after removing 【f1】');
    assert.ok(bulletRendered.includes('(1995).'), 'Must preserve 4-digit release years');
    assert.ok(bulletRendered.includes('Top Gun 2.'), 'Must preserve title numbers like Top Gun 2');
    assert.ok(bulletRendered.includes('(1950).'), 'Must preserve 4-digit birth years');

    // Double-bullet dash stripping (e.g. "• - " or "- - ")
    const doubleDashMd = '- - First Item\n• - Second Item\n* - Third Item\n+ - Fourth Item';
    const doubleDashRendered = renderMarkdown(doubleDashMd);
    assert.ok(doubleDashRendered.includes('<li>First Item</li>'), 'Must cleanly strip duplicate leading dash');
    assert.ok(doubleDashRendered.includes('<li>Second Item</li>'), 'Must cleanly strip bullet-dash combinations');
    assert.ok(doubleDashRendered.includes('<li>Third Item</li>'), 'Must cleanly strip asterisk-dash combinations');
    assert.ok(doubleDashRendered.includes('<li>Fourth Item</li>'), 'Must cleanly strip plus-dash combinations');
    assert.ok(!doubleDashRendered.includes('- First Item'), 'Must not retain dash inside list item');
    assert.ok(!doubleDashRendered.includes('- Second Item'), 'Must not retain dash inside list item');

    // Markdown inline styling: italics, bold, bold-italic, strikethrough
    const italicMd = 'Popularised the *Gaana* style, earning the nicknames *"Godfather of Gaana music"* and _Thenisai Thendral_.';
    const italicRendered = renderMarkdown(italicMd);
    assert.ok(italicRendered.includes('<em>Gaana</em>'), 'Must parse single asterisk italics');
    assert.ok(italicRendered.includes('<em>&quot;Godfather of Gaana music&quot;</em>'), 'Must parse quoted single asterisk italics with safe html encoding');
    assert.ok(italicRendered.includes('<em>Thenisai Thendral</em>'), 'Must parse underscore italics');

    const boldItalicMd = 'This is ***crucial fact*** and ~~deprecated note~~.';
    const boldItalicRendered = renderMarkdown(boldItalicMd);
    assert.ok(boldItalicRendered.includes('<strong><em>crucial fact</em></strong>'), 'Must parse bold italic');
    assert.ok(boldItalicRendered.includes('<del>deprecated note</del>'), 'Must parse strikethrough');

    // List item initial merging (healing broken initialisms in bulleted lists)
    const brokenInitialsListMd = '- Studied Indian classical harmonium under J.\n- B.\n- Krishna.';
    const healedInitialsHtml = renderMarkdown(brokenInitialsListMd);
    assert.ok(healedInitialsHtml.includes('under J. B. Krishna.'), 'Must heal broken initials J. B. Krishna into a single list item');
    assert.ok(!healedInitialsHtml.includes('<li>B.</li>'), 'Must not leave orphaned B. bullet');
    assert.ok(!healedInitialsHtml.includes('<li>Krishna.</li>'), 'Must not leave orphaned Krishna. bullet');

    console.log('  [PASS] Code highlighting, math expressions, markdown, and science formatting verified');
}

console.log('--- Section 11: Zero-Cost Image Generation Architecture Contracts ---');
{
    const imgRoute1 = decideFrontendRoute('/image neon cyberpunk street in rain');
    assert.equal(imgRoute1.route, 'image_generation');
    assert.equal(imgRoute1.prompt, 'neon cyberpunk street in rain');

    const imgRoute2 = decideFrontendRoute('generate an image of a majestic lion');
    assert.equal(imgRoute2.route, 'image_generation');
    assert.equal(imgRoute2.prompt, 'a majestic lion');

    const notImg = decideFrontendRoute('how to draw a line chart in chart.js');
    assert.notEqual(notImg.route, 'image_generation');
    console.log('  [PASS] Zero-cost image generation routing and prompt extraction contracts verified');
}

console.log('--- Section 12: Dynamic Visual Answer Engine & SSRF Security Contracts ---');
{
    // Universal candidate entity extraction
    assert.equal(extractCandidateEntity('Music composer Deva'), 'Music composer Deva');
    assert.equal(extractCandidateEntity('who is Marie Curie?'), 'Marie Curie');
    assert.equal(extractCandidateEntity('tell me about Quantum Computing in detail'), 'Quantum Computing');
    assert.equal(extractCandidateEntity('What is 2 + 2?'), '', 'Math queries must not trigger entity visual searches');
    assert.equal(extractCandidateEntity('10 * 50'), '', 'Math queries must not trigger entity visual searches');
    assert.equal(extractCandidateEntity('hello'), '', 'Greetings must not trigger entity visual searches');

    // Strict Entity Gating: Causal, explanatory, medical, and multi-sentence questions must NOT extract entities
    assert.equal(extractCandidateEntity('What is in the world man? Why are lot of youngsters are getting heart attacks?'), '', 'Multi-clause casual/medical query must be rejected');
    assert.equal(extractCandidateEntity('Why are lot of youngsters getting heart attacks?'), '', 'Causal medical inquiry must be rejected');
    assert.equal(extractCandidateEntity('What causes heart attacks in youth?'), '', 'Causal query must be rejected');
    assert.equal(extractCandidateEntity('how do vaccines work?'), '', 'Procedural/mechanistic query must be rejected');

    // Strict Token Overlap ratio verification
    assert.equal(computeTitleTokenOverlap('Harris Jayaraj', 'Harris Jayaraj'), 1.0);
    assert.equal(computeTitleTokenOverlap('Deva composer', 'Deva (composer)'), 1.0);
    assert.equal(computeTitleTokenOverlap('youngsters heart attacks', 'All Creatures Great and Small'), 0, 'Irrelevant entity must have 0 overlap');

    // Secure image CDN domain validation and SSRF guards
    assert.equal(isValidImageUrl('https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Deva.jpg/220px-Deva.jpg'), true);
    assert.equal(isValidImageUrl('https://thumb.wikimedia.org/image.png'), true);
    assert.equal(isValidImageUrl('https://images.unsplash.com/photo-12345'), true);
    assert.equal(isValidImageUrl('http://upload.wikimedia.org/test.jpg'), false, 'Insecure HTTP must be rejected');
    assert.equal(isValidImageUrl('https://192.168.1.1/test.jpg'), false, 'Private IP addresses must be rejected (SSRF)');
    assert.equal(isValidImageUrl('https://127.0.0.1/test.jpg'), false, 'Loopback IP addresses must be rejected (SSRF)');
    assert.equal(isValidImageUrl('https://169.254.169.254/latest/meta-data'), false, 'Cloud metadata IP must be rejected (SSRF)');
    assert.equal(isValidImageUrl('https://evil-domain.com/avatar.png'), false, 'Untrusted third-party hosts must be rejected');

    // Dynamic entity classification
    assert.equal(classifyEntityTypeFromDescription('Indian film score composer and singer', 'Deva'), 'musician');
    assert.equal(classifyEntityTypeFromDescription('American actor and film producer', 'Leonardo DiCaprio'), 'actor');
    assert.equal(classifyEntityTypeFromDescription('British theoretical physicist', 'Stephen Hawking'), 'scientist');
    assert.equal(classifyEntityTypeFromDescription('American multinational technology company', 'Apple Inc.'), 'company');
    assert.equal(classifyEntityTypeFromDescription('1995 Indian Tamil-language action film', 'Baashha'), 'movie');

    // Universal Semantic Classification for Notable Works vs Awards / Honors / Non-works
    assert.equal(isSemanticCreativeWork({ title: 'Baashha', description: '1995 Indian film by Suresh Krissna', extract: 'Baashha is a 1995 Indian action film...' }), true);
    assert.equal(isSemanticCreativeWork({ title: 'Annaamalai', description: '1992 film by Suresh Krissna', extract: 'Annaamalai is a 1992 Indian drama film...' }), true);
    assert.equal(isSemanticCreativeWork({ title: 'Inception', description: '2010 film by Christopher Nolan', extract: 'Inception is a 2010 sci-fi film...' }), true);
    assert.equal(isSemanticCreativeWork({ title: 'To Kill a Mockingbird', description: '1960 novel by Harper Lee', extract: 'To Kill a Mockingbird is a 1960 novel...' }), true);
    // Universal rejection of awards, honors, ceremonies, lists, and people without hardcoded rules
    assert.equal(isSemanticCreativeWork({ title: 'Padma Shri', description: 'Fourth highest civilian award of India', extract: 'The Padma Shri is the fourth-highest civilian award...' }), false);
    assert.equal(isSemanticCreativeWork({ title: 'Kalaimamani', description: 'Highest civilian award in Tamil Nadu', extract: 'The Kalaimamani is the highest civilian award...' }), false);
    assert.equal(isSemanticCreativeWork({ title: 'Filmfare Awards', description: 'Annual film awards in India', extract: 'The Filmfare Awards are annual awards...' }), false);
    assert.equal(isSemanticCreativeWork({ title: 'Nobel Prize in Literature', description: 'Prize established in 1895', extract: 'The Nobel Prize in Literature is a Swedish prize...' }), false);
    assert.equal(isSemanticCreativeWork({ title: 'Dhanraj Master', description: 'Indian music teacher', extract: 'Dhanraj was an Indian classical teacher...' }), false);
    assert.equal(isSemanticCreativeWork({ title: 'List of Deva songs', description: 'Wikipedia list article', extract: 'This is a list of songs...' }), false);

    console.log('  [PASS] Dynamic Visual Answer Engine, Semantic Classification and SSRF security contracts verified');
}

// =========================================================================
// Section 13: Response Formatting, Markdown Hierarchy & Paragraph Preservation
// =========================================================================
console.log('--- Section 13: Response Formatting, Markdown Hierarchy & Paragraph Preservation ---');
{
    // Test 1: cleanAnswerText preserves double newlines (paragraphs) and does not collapse them into a single line
    const multiParaAnswer = 'Devanesan Chokkalingam, popularly known as Deva, is an Indian music composer.\n\nOver a career spanning four decades, he composed music for over 400 films.\n\nHe is widely known as the Godfather of Gaana.';
    const cleanedAnswer = cleanAnswerText(multiParaAnswer);
    assert.equal(cleanedAnswer.includes('\n\n'), true, 'cleanAnswerText must preserve paragraph breaks (\\n\\n)');
    assert.equal(cleanedAnswer.split('\n\n').length, 3, 'cleanAnswerText must retain 3 distinct paragraphs');

    // Test 2: cleanAnswerText unbulletizes accidentally prefixed headings
    const badHeadingAnswer = '- ## Early Career\n\nDeva began his journey in music.\n\n- ### Major Achievements\n\nHe won numerous accolades.';
    const fixedHeadingAnswer = cleanAnswerText(badHeadingAnswer);
    assert.equal(fixedHeadingAnswer.includes('## Early Career'), true);
    assert.equal(fixedHeadingAnswer.includes('- ##'), false, 'Bullet prefix on heading must be stripped');
    assert.equal(fixedHeadingAnswer.includes('### Major Achievements'), true);
    assert.equal(fixedHeadingAnswer.includes('- ###'), false, 'Bullet prefix on sub-heading must be stripped');

    // Test 3: validateResearchAnswer preserves paragraph narrative without flattening into bullets
    const sampleReqs = buildResearchRequirements('music composer deva');
    const sampleSources = [{ id: 1, title: 'Deva Biography', url: 'https://deva.test', bodyText: 'Deva composed over 400 films.' }];
    const validated = validateResearchAnswer({
        answer: 'Devanesan Chokkalingam, popularly known as Deva, is an Indian music composer [1].\n\nOver a career spanning four decades, he composed music for over 400 films [1].',
        facts: [{ id: 'f1', requirementId: sampleReqs[0].id, value: 'Deva composed over 400 films', sourceId: 1, quote: 'Deva composed over 400 films.' }]
    }, sampleReqs, sampleSources);
    assert.equal(validated.content.includes('\n\n'), true, 'Validated content must retain paragraph separation');
    assert.equal(/^\s*-\s+/m.test(validated.content), false, 'Validated explanatory narrative must NOT be converted to bullet points');

    // Test 4: renderMarkdown renders headings, paragraphs, and genuine lists with proper HTML semantics
    const markdownInput = `## Biography\n\nDevanesan Chokkalingam was born on Nov. 20, 1950. He studied under J. B. Krishna.\n\n### Notable Films\n\n- Baasha (1995)\n- Annamalai (1992)\n- Panchathanthiram (2002)`;
    const renderedHtml = renderMarkdown(markdownInput);
    assert.equal(renderedHtml.includes('<h3 class="assistant-md-heading">Biography</h3>'), true, 'H2 heading rendered as assistant-md-heading');
    assert.equal(renderedHtml.includes('<h4 class="assistant-md-heading">Notable Films</h4>'), true, 'H3 heading rendered as assistant-md-heading');
    assert.equal(renderedHtml.includes('<p class="assistant-md-p">'), true, 'Paragraph rendered as assistant-md-p');
    assert.equal(renderedHtml.includes('<ul class="assistant-md-list">'), true, 'Genuine list rendered as assistant-md-list');
    assert.equal(renderedHtml.includes('<li>Baasha (1995)</li>'), true, 'List items cleanly contained in ul');

    // Test 5: renderMarkdown heals accidentally bulleted headings
    const accidentalBulletedHeading = `- ## Historical Overview\n\nThe event began in 1914.`;
    const renderedHealedHtml = renderMarkdown(accidentalBulletedHeading);
    assert.equal(renderedHealedHtml.includes('<h3 class="assistant-md-heading">Historical Overview</h3>'), true, 'Accidentally bulleted heading healed to heading tag');
    assert.equal(renderedHealedHtml.includes('<ul class="assistant-md-list">'), false, 'Heading must not be wrapped inside a ul');

    // Test 6: cleanBulletEndCitations cleans trailing citation numbers in list items while preserving terminal punctuation
    const rawList = `- First point in discussion [1].\n- Second point in discussion (2).\n- Third point in discussion 【f3】 .`;
    const cleanedList = cleanBulletEndCitations(rawList);
    assert.equal(cleanedList, '- First point in discussion.\n- Second point in discussion.\n- Third point in discussion.', 'Trailing citation markers cleanly stripped from bullet points');

    // Test 7: splitReadableSentences preserves initials, dates, and decimals
    const sampleBioText = 'Deva was born on Nov 20, 1950. He studied Indian classical harmonium under J. B. Krishna. His score was 3.14 on Next.js.';
    const sentences = splitReadableSentences(sampleBioText);
    assert.equal(sentences.length, 3, 'Must split into exactly 3 sentences');
    assert.ok(sentences[0].includes('Nov 20, 1950'), 'Must preserve date without splitting at Nov');
    assert.ok(sentences[1].includes('J. B. Krishna'), 'Must preserve initials without splitting at J. or B.');
    assert.ok(sentences[2].includes('3.14 on Next.js'), 'Must preserve decimals and dot-syntax without splitting');

    // Test 8: deBulletizePseudoListIfNeeded converts narrative lists into prose paragraphs
    const pseudoNarrativeList = `- Devanesan Chokkalingam, popularly known as Deva, was a prolific Indian music composer and singer best known for his work in Tamil cinema.\n- Over a career that spanned nearly four decades he composed music for more than 400 films and is widely credited with popularising the Gaana style.\n- Deva's breakthrough came with the 1986 Tamil film Maattukara Mannaru, and he later created iconic scores including Baasha and Annamalai.\n- Tributes poured in from industry peers confirming his status as a legendary figure in South-Indian cinema.`;
    const deBulletized = deBulletizePseudoListIfNeeded(pseudoNarrativeList);
    assert.ok(!deBulletized.startsWith('- '), 'Pseudo-list must not start with bullet dash');
    assert.ok(deBulletized.includes('\n\n'), 'Pseudo-list must be grouped into natural paragraphs');
    assert.ok(!/^\s*[-*•+]\s+/m.test(deBulletized), 'Pseudo-list must have bullet dashes removed');

    // Test 9: deBulletizePseudoListIfNeeded strictly preserves genuine procedural lists and key-value specs
    const genuineProcedure = `- Step 1: Clone the repository.\n- Step 2: Run npm install.\n- Step 3: Run npm test.`;
    assert.equal(deBulletizePseudoListIfNeeded(genuineProcedure), genuineProcedure, 'Must preserve genuine procedural step lists');

    // Test 10: cleanAnswerText strips unwanted meta-commentary sentences
    const metaAnswer = 'Harris Jayaraj is an Indian composer born in 1975. He has composed scores for numerous Tamil films.\n\nThe answer integrates verified information from the Times of India profile and the Wikipedia entry, while noting the missing detailed early-career timeline.';
    const cleanedMeta = cleanAnswerText(metaAnswer);
    assert.equal(cleanedMeta.includes('integrates verified information'), false, 'Must strip "The answer integrates verified information" sentence');
    assert.equal(cleanedMeta.includes('while noting the missing'), false, 'Must strip "while noting the missing" clause');
    assert.equal(cleanedMeta.includes('Harris Jayaraj is an Indian composer born in 1975.'), true, 'Must preserve actual substantive answer');

    const genuineSpecs = `- **Processor**: Apple M3 Max\n- **Memory**: 36GB Unified\n- **Storage**: 1TB NVMe SSD`;
    assert.equal(deBulletizePseudoListIfNeeded(genuineSpecs), genuineSpecs, 'Must preserve genuine key-value specifications');

    console.log('  [PASS] Response Formatting, Markdown Hierarchy & Paragraph Preservation verified');
}

console.log('deterministic-checks-ok');
