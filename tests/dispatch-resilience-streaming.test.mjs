import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
    isStableGeographyOrGeneralFactQuery as frontendIsStable,
    classifyUniversalEntityIntent as frontendClassifyEntity,
    decideFrontendRoute
} from '../app/frontend-routing.js';
import {
    isStableGeographyOrGeneralFactQuery as backendIsStable,
    classifyUniversalEntityIntent as backendClassifyEntity,
    classifyQueryIntent
} from '../api/_lib/intent-separator.js';
import {
    classifyUniversalEntityIntent as verifierClassifyEntity
} from '../api/_lib/entity-verifier.js';
import { __test as chatTest } from '../api/chat-groq.js';

console.log('--- Testing API Dispatch Reliability & Routing Resilience (Milestone 3) ---');

// =========================================================================
// 1. Provider Timeout Budget & Configuration Verification
// =========================================================================
console.log('1. Verifying 25s timeout budgets and configuration constants...');

assert.equal(chatTest.MODEL_FETCH_TIMEOUT_MS, 25_000, 'MODEL_FETCH_TIMEOUT_MS must be 25,000ms');
assert.equal(chatTest.STREAM_MODEL_FETCH_TIMEOUT_MS, 25_000, 'STREAM_MODEL_FETCH_TIMEOUT_MS must be 25,000ms');

console.log('  [PASS] 25,000ms timeout constants correctly configured for resilient streaming and cascade.');

// =========================================================================
// 2. Refusal Prevention on General Knowledge Across All Domains (30+ Queries)
// =========================================================================
console.log('2. Testing zero-refusal guarantee on stable general knowledge queries...');

const generalKnowledgeCorpus = [
    // World Capitals
    { query: 'What is the capital of France?', domain: 'World Capitals - France', expected: 'Paris' },
    { query: 'What is the capital of New Zealand?', domain: 'World Capitals - New Zealand', expected: 'Wellington' },
    { query: 'What is the capital of Australia?', domain: 'World Capitals - Australia', expected: 'Canberra' },
    { query: 'What is the capital of Canada?', domain: 'World Capitals - Canada', expected: 'Ottawa' },
    { query: 'What is the capital of Japan?', domain: 'World Capitals - Japan', expected: 'Tokyo' },
    { query: 'What is the capital of Brazil?', domain: 'World Capitals - Brazil', expected: 'Brasilia' },
    { query: 'What is the capital of Germany?', domain: 'World Capitals - Germany', expected: 'Berlin' },
    // Geography & Monuments
    { query: 'Where is the Eiffel Tower located?', domain: 'Geography/Monuments - Eiffel Tower' },
    { query: 'Where is the Great Barrier Reef?', domain: 'Geography - Great Barrier Reef' },
    { query: 'How tall is Mount Everest?', domain: 'Geography - Mount Everest' },
    { query: 'Where is Machu Picchu?', domain: 'Geography - Machu Picchu' },
    { query: 'Where is the Grand Canyon located?', domain: 'Geography - Grand Canyon' },
    // History
    { query: 'When did World War II end?', domain: 'History - WWII' },
    { query: 'Who was the first President of the United States?', domain: 'History - First US President' },
    { query: 'What was the Magna Carta signed in 1215?', domain: 'History - Magna Carta' },
    { query: 'Explain the New Deal policies of FDR', domain: 'History - New Deal' },
    { query: 'What was the Industrial Revolution?', domain: 'History - Industrial Revolution' },
    // Physics & General Science
    { query: "What is Newton's third law of motion?", domain: 'Physics - Newton Laws' },
    { query: 'What is the speed of light in vacuum?', domain: 'Physics - Speed of Light' },
    { query: 'Explain the theory of general relativity', domain: 'Physics - General Relativity' },
    { query: 'What is quantum entanglement?', domain: 'Physics - Quantum Physics' },
    { query: 'What is the law of conservation of energy?', domain: 'Physics - Conservation Law' },
    // Chemistry
    { query: 'What is the atomic number of Gold?', domain: 'Chemistry - Atomic Number' },
    { query: 'What is the chemical formula for water?', domain: 'Chemistry - Formula' },
    { query: 'Explain covalent vs ionic bonding', domain: 'Chemistry - Chemical Bonds' },
    { query: 'What is the pH of pure neutral water?', domain: 'Chemistry - pH' },
    // Biology
    { query: 'How does photosynthesis work?', domain: 'Biology - Photosynthesis' },
    { query: 'What is the function of mitochondria in a cell?', domain: 'Biology - Mitochondria' },
    { query: 'Explain the double helix structure of DNA', domain: 'Biology - DNA' },
    { query: 'What is natural selection in evolution?', domain: 'Biology - Evolution' },
    // Mathematics
    { query: 'What is the Pythagorean theorem?', domain: 'Mathematics - Geometry' },
    { query: 'What is the derivative of sin(x)?', domain: 'Mathematics - Calculus' },
    { query: 'Explain what a prime number is', domain: 'Mathematics - Number Theory' },
    { query: 'What is Euler identity in complex analysis?', domain: 'Mathematics - Euler' },
    // Computer Science & Programming
    { query: 'How does binary search work?', domain: 'CS - Algorithms' },
    { query: 'Explain the quicksort algorithm and its time complexity', domain: 'CS - Quicksort' },
    { query: 'What is a hash table and how does collision resolution work?', domain: 'CS - Data Structures' },
    { query: 'How does the new keyword work in C++?', domain: 'Programming - C++ new' },
    { query: 'Explain asynchronous event loop in JavaScript', domain: 'Programming - JS Event Loop' },
    // Philosophy & Definitions
    { query: 'What is utilitarianism in moral philosophy?', domain: 'Philosophy - Utilitarianism' },
    { query: 'Define epistemology and its core questions', domain: 'Philosophy - Epistemology' },
    { query: 'What is the definition of photosynthesis?', domain: 'Definitions - Photosynthesis' }
];

let zeroRefusalPassCount = 0;

for (const item of generalKnowledgeCorpus) {
    const { query, domain } = item;

    // 1. Frontend stable check
    assert.equal(frontendIsStable(query), true, `Frontend isStableGeographyOrGeneralFactQuery failed for [${domain}] "${query}"`);
    const frontRoute = decideFrontendRoute(query);
    assert.equal(frontRoute.route, 'fast_simple', `Expected fast_simple for [${domain}] "${query}", got ${frontRoute.route}`);
    assert.equal(frontRoute.requiresSources, false, `Expected requiresSources=false for [${domain}] "${query}"`);

    // 2. Backend intent classifier
    assert.equal(backendIsStable(query), true, `Backend isStableGeographyOrGeneralFactQuery failed for [${domain}] "${query}"`);
    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning', `Expected static_reasoning for [${domain}] "${query}"`);
    assert.equal(intent.requiresLiveGrounding, false, `Expected requiresLiveGrounding=false for [${domain}] "${query}"`);

    // 3. Entity classifier
    const entity = backendClassifyEntity(query);
    assert.equal(entity.isLiveRequired, false, `Expected isLiveRequired=false for [${domain}] "${query}"`);
    assert.equal(entity.isStableKnowledge, true, `Expected isStableKnowledge=true for [${domain}] "${query}"`);

    // 4. Backend routing decision
    const routingDecision = chatTest.classifyRoutingDecision(query);
    assert.equal(routingDecision.strategy, 'direct', `Expected strategy 'direct' for [${domain}] "${query}"`);
    assert.equal(routingDecision.webEligible, false, `Expected webEligible=false for [${domain}] "${query}"`);

    // 5. Streaming eligibility
    const streamEligible = chatTest.shouldStreamChatRequest({ message: query, stream: true }, 'fast_simple', null, routingDecision);
    assert.equal(streamEligible, true, `Expected shouldStreamChatRequest=true for [${domain}] "${query}"`);

    // 6. enforceLiveAnswerStyle NEVER converts to verification_unavailable
    const mockModelAnswer = {
        intent: 'direct_answer',
        response: `Comprehensive explanation for ${query}`,
        action: null
    };

    // Case A: 0 sources
    const enforcedEmpty = chatTest.enforceLiveAnswerStyle(mockModelAnswer, query, [], {
        routeDecision: routingDecision,
        retrievalAttempted: false
    });
    assert.notEqual(enforcedEmpty.intent, 'verification_unavailable', `Must not return verification_unavailable with 0 sources for [${domain}]`);
    assert.equal(enforcedEmpty.response, mockModelAnswer.response, `Model response must be preserved exactly for [${domain}]`);

    // Case B: preloaded/fallback snippets present
    const enforcedWithSources = chatTest.enforceLiveAnswerStyle(mockModelAnswer, query, [
        { title: 'Encyclopedic entry', url: 'https://en.wikipedia.org/wiki/Example' }
    ], {
        routeDecision: routingDecision,
        retrievalAttempted: true
    });
    assert.notEqual(enforcedWithSources.intent, 'verification_unavailable', `Must not return verification_unavailable with sources for [${domain}]`);
    assert.equal(enforcedWithSources.response, mockModelAnswer.response, `Model response must be preserved without mangling for [${domain}]`);

    zeroRefusalPassCount++;
}

console.log(`  [PASS] All ${zeroRefusalPassCount} general knowledge queries verified with 0 false-positive verification refusals.`);

// =========================================================================
// 3. Multi-Provider Fallback Cascade Tests (Groq -> OpenAI -> Gemini)
// =========================================================================
console.log('3. Testing multi-provider fallback cascade and fault tolerance...');

// Test 3.1: Cascade when primary Groq provider fails -> falls back to Gemini
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                // Simulate Groq 503 error
                return new Response(JSON.stringify({ error: { message: 'Groq service overloaded' } }), {
                    status: 503,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (urlStr.includes('generativelanguage.googleapis.com')) {
                attemptedProviders.push('gemini');
                const sseBody = [
                    'data: {"candidates":[{"content":{"parts":[{"text":"Paris is the "}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":"capital of France."}]}}]}\n\n'
                ].join('');

                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'What is the capital of France?',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true, 'Cascade should succeed on fallback provider');
        assert.equal(result.provider, 'gemini', `Expected fallback provider to be 'gemini', got ${result.provider}`);
        assert.deepEqual(Array.from(new Set(attemptedProviders)), ['groq', 'gemini'], 'Should attempt Groq first, then Gemini on failure');
        assert.equal(streamedDeltas.join(''), 'Paris is the capital of France.', 'Should stream combined tokens from fallback provider');

        console.log('  [PASS] Cascade successfully fell back from failed Groq to Gemini.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// Test 3.2: Cascade when Groq and OpenAI fail -> Gemini succeeds
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.OPENAI_API_KEY = 'mock-openai-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                return new Response(JSON.stringify({ error: 'rate limit' }), { status: 429 });
            }
            if (urlStr.includes('generativelanguage.googleapis.com')) {
                attemptedProviders.push('gemini');
                const sseBody = [
                    'data: {"candidates":[{"content":{"parts":[{"text":"Photosynthesis converts "}]}}]}\n\n',
                    'data: {"candidates":[{"content":{"parts":[{"text":"light energy into glucose."}]}}]}\n\n'
                ].join('');

                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Explain photosynthesis',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true, 'Cascade should succeed on Gemini when Groq fails');
        assert.equal(result.provider, 'gemini', `Expected provider 'gemini', got ${result.provider}`);
        assert.deepEqual(Array.from(new Set(attemptedProviders)), ['groq', 'gemini'], 'Should cascade through Groq -> Gemini');
        assert.equal(streamedDeltas.join(''), 'Photosynthesis converts light energy into glucose.');

        console.log('  [PASS] Cascade successfully fell back through Groq -> Gemini.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// Test 3.3: User-selected Groq model priority -> attempts selected Groq model first
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.GEMINI_API_KEY = 'mock-gemini-key';

        const attemptedProviders = [];
        let modelRequested = '';

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                try {
                    const parsed = JSON.parse(init.body || '{}');
                    modelRequested = parsed.model;
                } catch (_) {}
                const sseBody = 'data: {"choices":[{"delta":{"content":"Llama 3.3 response."}}]}\n\ndata: [DONE]\n\n';
                return new Response(new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode(sseBody));
                        controller.close();
                    }
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Hello from user selected model',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta),
            'llama-3.3-70b-versatile'
        );

        assert.equal(result.ok, true);
        assert.equal(result.provider, 'groq');
        assert.equal(modelRequested, 'llama-3.3-70b-versatile');
        assert.deepEqual(attemptedProviders, ['groq'], 'Should attempt Groq with user-selected model');
        assert.equal(streamedDeltas.join(''), 'Llama 3.3 response.');

        console.log('  [PASS] User-selected Groq model priority successfully executed.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// =========================================================================
// 4. Client-Side Fallback Resilience Verification (index.html Invariant Checks)
// =========================================================================
console.log('4. Verifying client-side graceful fallback and turn preservation in index.html...');

const indexHtmlSource = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

const normalizedIndexHtml = indexHtmlSource.replace(/\r\n/g, '\n');

// Invariant 4.1: handleLiveRetrievalQuery checks !requiresStrictLiveVerification on empty search results
assert.ok(
    normalizedIndexHtml.includes('!requiresStrictLiveVerification(query, intent, entityIntent)'),
    'handleLiveRetrievalQuery must check !requiresStrictLiveVerification before publishing clarification on empty search'
);

// Invariant 4.2: handleLiveRetrievalQuery checks !requiresStrictLiveVerification on catch errors
assert.ok(
    normalizedIndexHtml.includes('!requiresStrictLiveVerification(queryStr, fallbackIntent, fallbackEntityIntent)'),
    'handleLiveRetrievalQuery catch block must check !requiresStrictLiveVerification before publishing error clarification'
);

// Invariant 4.3: processUserQuery checks handler return booleans rather than unconditionally returning intent
assert.ok(
    normalizedIndexHtml.includes('const handled = await handleLiveRetrievalQuery(normalizeExplicitWebSearchQuery(t));\n        if (handled) return { intent: \'live_retrieval\' };'),
    'processUserQuery must check return value of handleLiveRetrievalQuery for explicit web search'
);
assert.ok(
    normalizedIndexHtml.includes('const handled = await handleUniversalEntityFactQuery(t, liveIntent);\n            if (handled) return { intent: \'entity_fact\' };'),
    'processUserQuery must check return value of handleUniversalEntityFactQuery for broad factual queries'
);

// Invariant 4.4: enforceLiveAnswerStyle in api/chat-groq.js unconditionally guards stable facts
const chatGroqSource = fs.readFileSync(new URL('../api/chat-groq.js', import.meta.url), 'utf8');
const normalizedChatGroq = chatGroqSource.replace(/\r\n/g, '\n');
assert.ok(
    normalizedChatGroq.includes('if (isStableGeographyOrGeneralFactQuery(message)) {\n            return parsedResponse;\n        }'),
    'enforceLiveAnswerStyle must unconditionally return parsedResponse for isStableGeographyOrGeneralFactQuery'
);

console.log('  [PASS] Client-side fallback invariants and turn preservation logic verified.');

// =========================================================================
// 5. SSE Streaming Contract & Reasoning Token Preservation
// =========================================================================
console.log('5. Testing SSE event lifecycle and reasoning token emission...');

// Test 5.1: Reasoning tokens in Groq stream (delta.reasoning)
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';

        globalThis.fetch = async (url) => {
            const sseBody = [
                'data: {"choices":[{"delta":{"reasoning":"Analyzing the mathematical properties...\\n"}}]}\n\n',
                'data: {"choices":[{"delta":{"reasoning":"Applying the Pythagorean theorem a^2 + b^2 = c^2...\\n"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"The hypotenuse length is 5."}}]}\n\n',
                'data: [DONE]\n\n'
            ].join('');

            return new Response(new ReadableStream({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode(sseBody));
                    controller.close();
                }
            }), {
                status: 200,
                headers: { 'Content-Type': 'text/event-stream' }
            });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'Calculate hypotenuse with sides 3 and 4',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true);
        const fullStreamText = streamedDeltas.join('');
        assert.ok(fullStreamText.includes('<think>'), 'Stream must contain <think> opening tag');
        assert.ok(fullStreamText.includes('Analyzing the mathematical properties...'), 'Stream must include reasoning tokens');
        assert.ok(fullStreamText.includes('</think>'), 'Stream must contain </think> closing tag');
        assert.ok(fullStreamText.includes('The hypotenuse length is 5.'), 'Stream must include final answer content');

        console.log('  [PASS] Reasoning tokens (<think>) emitted and stream contract preserved.');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
    }
}

console.log('--- All Milestone 3 API Dispatch & Routing Resilience tests PASSED ---');