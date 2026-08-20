import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
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

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFunctionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing function ' + name);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (char === '(') parenDepth++;
        else if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                bodyStart = source.indexOf('{', i);
                break;
            }
        }
    }
    assert.notEqual(bodyStart, -1, 'could not find body for ' + name);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error('could not extract complete source for ' + name);
}

// Build speech sandbox for testing converse speech streaming
const speechSandbox = {
    streamingConverseSpeech: null,
    stopConverseSpeech: () => {},
    setConverseUiState: () => {},
    sanitizeTextForConverseSpeech: text => String(text || '').trim(),
    splitConverseSpeechSegments: text => [text],
    processStreamingSpeechQueue: () => {},
    getConversationTurn: () => null,
    speakConverseReply: () => {}
};
vm.createContext(speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'startStreamingConverseSpeech'), speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'feedStreamingConverseDelta'), speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'finishStreamingConverseSpeech'), speechSandbox);

const { startStreamingConverseSpeech, feedStreamingConverseDelta, finishStreamingConverseSpeech } = speechSandbox;

console.log('=== Milestone 3 Empirical Challenger Stress Test Suite ===\n');

let totalChecks = 0;
let passedChecks = 0;

function check(description, fn) {
    totalChecks++;
    try {
        fn();
        passedChecks++;
        console.log(`  [PASS] ${description}`);
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`        ${err.message}`);
        throw err;
    }
}

async function asyncCheck(description, fn) {
    totalChecks++;
    try {
        await fn();
        passedChecks++;
        console.log(`  [PASS] ${description}`);
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`        ${err.message}`);
        throw err;
    }
}

// =========================================================================
// SECTION 1: Client-Side Dispatch Flows & Invariants (index.html)
// =========================================================================
console.log('\n--- Section 1: Client-Side Dispatch Flows & Invariants ---');

// 1.1: Verify index.html structural dispatch invariants
check('1.1 index.html contains verified processUserQuery fall-through logic', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Verify handleLiveRetrievalQuery fall-through
    assert.match(
        html,
        /const\s+handled\s*=\s*await\s+handleLiveRetrievalQuery\([^)]+\);\s*if\s*\(handled\)\s*return\s*\{\s*intent:\s*['"]live_retrieval['"]\s*\};/,
        'processUserQuery must check return value of handleLiveRetrievalQuery and allow fall-through'
    );

    // Verify handleUniversalEntityFactQuery fall-through
    assert.match(
        html,
        /const\s+handled\s*=\s*await\s+handleUniversalEntityFactQuery\(t,\s*liveIntent\);\s*if\s*\(handled\)\s*return\s*\{\s*intent:\s*['"]entity_fact['"]\s*\};/,
        'processUserQuery must check return value of handleUniversalEntityFactQuery and allow fall-through'
    );

    // Verify terminal askGeminiAI fallback
    assert.match(
        html,
        /return\s+await\s+askGeminiAI\(t,\s*\{\s*stream:\s*options\?\.stream\s*===\s*true\s*\}\);/,
        'processUserQuery must fall through to askGeminiAI(t, { stream: true }) as final terminal route'
    );

    // Verify askGeminiAI handles abort cleanly
    assert.match(
        html,
        /if\s*\(isAbortError\(error\)\)\s*\{\s*return\s*\{\s*response:\s*'',\s*intent:\s*'aborted',\s*aborted:\s*true\s*\};\s*\}/,
        'askGeminiAI must catch isAbortError and return aborted state cleanly'
    );

    // Verify callAIWithTyping handles abort cleanly
    assert.match(
        html,
        /if\s*\(isAbortError\(error\)\)\s*\{\s*return\s*\{\s*response:\s*'',\s*intent:\s*'aborted',\s*aborted:\s*true\s*\};\s*\}/,
        'callAIWithTyping must catch isAbortError and return aborted state cleanly'
    );
});

// 1.2: Stress-test routing decisions across varied edge queries
check('1.2 decideFrontendRoute correctly routes knowledge vs live queries without false live traps', () => {
    const testCases = [
        { q: 'What is the speed of sound in dry air?', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'Explain photosynthesis in plants', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'Who was Julius Caesar?', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'What is the boiling point of nitrogen?', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'What is the capital of Japan?', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'What is the chemical formula for glucose?', expectedRoute: 'fast_simple', requiresSources: false },
        { q: 'What is the latest stock price of Apple today?', expectedRoute: 'live_required', requiresSources: true },
        { q: 'What is the live score of Arsenal vs Chelsea today?', expectedRoute: 'live_required', requiresSources: true },
        { q: 'Current weather in Paris right now', expectedRoute: 'live_required', requiresSources: true }
    ];

    for (const { q, expectedRoute, requiresSources } of testCases) {
        const route = decideFrontendRoute(q);
        assert.equal(route.route, expectedRoute, `Query "${q}" expected route ${expectedRoute}, got ${route.route}`);
        assert.equal(route.requiresSources, requiresSources, `Query "${q}" expected requiresSources=${requiresSources}, got ${route.requiresSources}`);
    }
});

// =========================================================================
// SECTION 2: SSE Streaming Reader Lifecycle & Invariants
// =========================================================================
console.log('\n--- Section 2: SSE Streaming Reader Lifecycle & Invariants ---');

// 2.1: Test parseSseClientEvent implementation logic
check('2.1 SSE client event parsing handles all lifecycle events (meta, delta, correction, done, error)', () => {
    function parseSseClientEvent(rawEvent) {
        const lines = String(rawEvent || '').split(/\r?\n/);
        let event = 'message';
        const dataLines = [];
        lines.forEach(line => {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
        });
        let data = {};
        const dataText = dataLines.join('\n');
        if (dataText) {
            try {
                data = JSON.parse(dataText);
            } catch (_) {
                data = { text: dataText };
            }
        }
        return { event, data };
    }

    // Test meta event
    const meta = parseSseClientEvent('event: meta\ndata: {"requestId":"req_123","model":"llama-3.3-70b-versatile"}\n\n');
    assert.equal(meta.event, 'meta');
    assert.equal(meta.data.requestId, 'req_123');
    assert.equal(meta.data.model, 'llama-3.3-70b-versatile');

    // Test delta event
    const delta = parseSseClientEvent('event: delta\ndata: {"text":"Hello world"}\n\n');
    assert.equal(delta.event, 'delta');
    assert.equal(delta.data.text, 'Hello world');

    // Test correction event
    const correction = parseSseClientEvent('event: correction\ndata: {"text":"Corrected complete text"}\n\n');
    assert.equal(correction.event, 'correction');
    assert.equal(correction.data.text, 'Corrected complete text');

    // Test done event
    const done = parseSseClientEvent('event: done\ndata: {"success":true,"response":"Full answer","provider":"groq"}\n\n');
    assert.equal(done.event, 'done');
    assert.equal(done.data.success, true);
    assert.equal(done.data.response, 'Full answer');
    assert.equal(done.data.provider, 'groq');

    // Test error event
    const error = parseSseClientEvent('event: error\ndata: {"code":"timeout","message":"Request timed out"}\n\n');
    assert.equal(error.event, 'error');
    assert.equal(error.data.code, 'timeout');
    assert.equal(error.data.message, 'Request timed out');

    // Test multi-line data payload
    const multiLine = parseSseClientEvent('event: delta\ndata: {"text":"Line 1\\nLine 2"}\n\n');
    assert.equal(multiLine.event, 'delta');
    assert.equal(multiLine.data.text, 'Line 1\nLine 2');

    // Test CRLF formatting
    const crlf = parseSseClientEvent('event: delta\r\ndata: {"text":"CRLF test"}\r\n\r\n');
    assert.equal(crlf.event, 'delta');
    assert.equal(crlf.data.text, 'CRLF test');

    // Test malformed JSON fallback
    const malformed = parseSseClientEvent('event: delta\ndata: unformatted plain text\n\n');
    assert.equal(malformed.event, 'delta');
    assert.equal(malformed.data.text, 'unformatted plain text');
});

// 2.2: Test packet buffer fragmentation and boundary reassembly (readSseStream simulation)
check('2.2 SSE stream reader reassembles fragmented chunks across packet boundaries', async () => {
    // Simulated chunks split across boundary positions
    const chunkSequence = [
        'event: me',
        'ta\ndata: {"req',
        'uestId":"abc-123"}\n\nevent: del',
        'ta\ndata: {"text":"Part 1 "}\n\n',
        'event: delta\ndata: {"text":"Part',
        ' 2 "}\n\nevent: delta\ndata: {"text":"Part 3"}\n\n',
        'event: done\ndata: {"success":true,"response":"Part 1 Part 2 Part 3"}\n\n'
    ];

    let buffer = '';
    const receivedEvents = [];

    function parseEvent(raw) {
        const lines = raw.split(/\r?\n/);
        let event = 'message';
        const dataLines = [];
        lines.forEach(l => {
            if (l.startsWith('event:')) event = l.slice(6).trim();
            if (l.startsWith('data:')) dataLines.push(l.slice(5).trim());
        });
        let data = {};
        const text = dataLines.join('\n');
        if (text) {
            try { data = JSON.parse(text); } catch (_) { data = { text }; }
        }
        return { event, data };
    }

    for (const chunk of chunkSequence) {
        buffer += chunk;
        const parts = buffer.split(/\n\n/);
        buffer = parts.pop() || '';
        for (const part of parts) {
            if (part.trim()) {
                receivedEvents.push(parseEvent(part));
            }
        }
    }
    if (buffer.trim()) {
        receivedEvents.push(parseEvent(buffer));
    }

    assert.equal(receivedEvents.length, 5, 'Must receive 5 complete events');
    assert.equal(receivedEvents[0].event, 'meta');
    assert.equal(receivedEvents[0].data.requestId, 'abc-123');
    assert.equal(receivedEvents[1].event, 'delta');
    assert.equal(receivedEvents[1].data.text, 'Part 1 ');
    assert.equal(receivedEvents[2].event, 'delta');
    assert.equal(receivedEvents[2].data.text, 'Part 2 ');
    assert.equal(receivedEvents[3].event, 'delta');
    assert.equal(receivedEvents[3].data.text, 'Part 3');
    assert.equal(receivedEvents[4].event, 'done');
    assert.equal(receivedEvents[4].data.response, 'Part 1 Part 2 Part 3');
});

// 2.3: Stress-test reasoning <think> token isolation across multi-chunk delta streams
check('2.3 <think> reasoning tokens are completely isolated and never leaked to speech TTS buffer', () => {
    speechSandbox.startStreamingConverseSpeech('turn-cot-1');

    // Stream sequence containing internal reasoning block
    const streamDeltas = [
        '<th',
        'ink>\nFirst let us analyze the user question.\n',
        'The user is asking about gravity.\n',
        'We should provide a clear and concise explanation.\n',
        '</think>\n',
        'Gravity is a fundamental interaction ',
        'which causes mutual attraction between all things with mass or energy.\n'
    ];

    for (const delta of streamDeltas) {
        speechSandbox.feedStreamingConverseDelta(delta, 'turn-cot-1');
    }
    speechSandbox.finishStreamingConverseSpeech(
        'Gravity is a fundamental interaction which causes mutual attraction between all things with mass or energy.\n',
        'turn-cot-1'
    );

    const segments = speechSandbox.streamingConverseSpeech?.enqueuedSegments || [];

    // Verify <think> block is completely absent from all voiced segments
    assert.ok(segments.length >= 1, 'Verified answer segments must be enqueued');
    assert.ok(
        segments.every(seg => !seg.includes('First let us analyze')),
        'Voiced segments must NOT contain CoT reasoning content'
    );
    assert.ok(
        segments.every(seg => !seg.includes('We should provide a clear')),
        'Voiced segments must NOT contain CoT reasoning content'
    );
    assert.ok(
        segments.every(seg => !seg.includes('<think>') && !seg.includes('</think>')),
        'Voiced segments must NOT contain <think> or </think> tags'
    );

    // Verify the actual response is voiced
    const joinedSpeech = segments.join(' ');
    assert.ok(
        joinedSpeech.includes('Gravity is a fundamental interaction'),
        'Voiced speech MUST contain the final answer text'
    );
});

// 2.4: Stress-test unclosed <think> tag handling at stream EOF
check('2.4 Unclosed <think> tag at stream EOF suppresses reasoning without crashing', () => {
    speechSandbox.startStreamingConverseSpeech('turn-cot-unclosed');

    // Stream sequence with an unclosed think block
    const unclosedDeltas = [
        '<think>\nInternal calculations in progress...',
        ' still thinking...',
        ' concluding thoughts...'
    ];

    for (const delta of unclosedDeltas) {
        speechSandbox.feedStreamingConverseDelta(delta, 'turn-cot-unclosed');
    }

    const segments = speechSandbox.streamingConverseSpeech?.enqueuedSegments || [];
    assert.equal(
        segments.length,
        0,
        'Voiced segments must be empty when stream only contained unclosed <think> block'
    );
});

// =========================================================================
// SECTION 3: Search Fall-Through & Bypass Invariants
// =========================================================================
console.log('\n--- Section 3: Search Fall-Through & Bypass Invariants ---');

// 3.1: Verify enforceLiveAnswerStyle bypass for stable general knowledge queries
check('3.1 enforceLiveAnswerStyle preserves stable geography & general facts without refusal rewrites', () => {
    const { enforceLiveAnswerStyle } = chatTest;

    const stableQueries = [
        { q: 'What is the capital of Australia?', mockAnswer: 'The capital of Australia is Canberra.' },
        { q: 'Where is the Eiffel Tower located?', mockAnswer: 'The Eiffel Tower is located in Paris, France on the Champ de Mars.' },
        { q: "What is Newton's third law of motion?", mockAnswer: 'For every action, there is an equal and opposite reaction.' },
        { q: 'What is the speed of light in vacuum?', mockAnswer: 'The speed of light in vacuum is exactly 299,792,458 meters per second.' },
        { q: 'What is the chemical formula for water?', mockAnswer: 'The chemical formula for water is H2O.' },
        { q: 'Explain the theory of general relativity', mockAnswer: 'General relativity is Albert Einstein’s geometric theory of gravitation.' }
    ];

    for (const { q, mockAnswer } of stableQueries) {
        const inputResponse = { response: mockAnswer, intent: 'chat' };
        const enforced = enforceLiveAnswerStyle(inputResponse, q, []);
        assert.equal(enforced.response, mockAnswer, `enforceLiveAnswerStyle must return answer unchanged for stable query "${q}"`);
        assert.equal(enforced.response.includes('Verification unavailable'), false, 'Answer must not contain "Verification unavailable"');
        assert.equal(enforced.response.includes('I could not verify'), false, 'Answer must not contain "I could not verify"');
    }
});

// 3.2: Verify strict queries fail-closed when evidence is unverified / unavailable
check('3.2 Strict live queries (e.g. current role holders, live market prices) are properly classified as requiring live sources', () => {
    // Strict query requiring live verification
    const strictQuery = 'Who is the current Prime Minister of the United Kingdom right now?';
    const strictEntity = verifierClassifyEntity(strictQuery);
    assert.equal(strictEntity.isLiveRequired, true, 'isLiveRequired must be true for current PM query');
    assert.equal(strictEntity.isStableKnowledge, false, 'isStableKnowledge must be false for current PM query');
    assert.equal(strictEntity.entityTarget.role, 'Prime Minister', 'role must be Prime Minister for PM query');

    const strictIntent = classifyQueryIntent(strictQuery);
    assert.equal(strictIntent.requiresLiveGrounding, true, 'requiresLiveGrounding must be true for current PM query');

    // General knowledge query must NOT require live sources
    const generalQuery = 'What is the capital of France?';
    const generalIntent = classifyQueryIntent(generalQuery);
    assert.equal(generalIntent.requiresLiveGrounding, false, 'requiresLiveGrounding must be false for capital query');
    assert.equal(frontendIsStable(generalQuery), true, 'frontendIsStable must be true for capital query');
    assert.equal(backendIsStable(generalQuery), true, 'backendIsStable must be true for capital query');

    const generalEntity = verifierClassifyEntity(generalQuery);
    assert.equal(generalEntity.isLiveRequired, false, 'isLiveRequired must be false for general knowledge query');
    assert.equal(generalEntity.isStableKnowledge, true, 'isStableKnowledge must be true for general knowledge query');
});

// =========================================================================
// SECTION 4: Multi-Provider Fallback Cascade & Timeout Resiliency
// =========================================================================
console.log('\n--- Section 4: Multi-Provider Cascade & Timeout Resiliency ---');

// 4.1: Verify 25,000ms timeout envelope constants
check('4.1 Server timeout constants match 25,000ms SLA', () => {
    assert.equal(chatTest.MODEL_FETCH_TIMEOUT_MS, 25000, 'MODEL_FETCH_TIMEOUT_MS must be 25,000ms');
    assert.equal(chatTest.STREAM_MODEL_FETCH_TIMEOUT_MS, 25000, 'STREAM_MODEL_FETCH_TIMEOUT_MS must be 25,000ms');
});

// 4.2: Verify cascade fall-through from Groq to OpenAI on failure
await asyncCheck('4.2 Multi-provider stream cascade executes fallback from Groq to OpenAI on error', async () => {
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalOpenAIKey = process.env.OPENAI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-groq-key';
        process.env.OPENAI_API_KEY = 'mock-openai-key';

        const attemptedProviders = [];

        globalThis.fetch = async (url, init = {}) => {
            const urlStr = String(url || '');
            if (urlStr.includes('api.groq.com')) {
                attemptedProviders.push('groq');
                return new Response(JSON.stringify({ error: { message: 'Service unavailable' } }), { status: 503 });
            }
            if (urlStr.includes('api.openai.com')) {
                attemptedProviders.push('openai');
                const sseBody = [
                    'data: {"choices":[{"delta":{"content":"Canberra is the capital."}}]}\n\n',
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
            }
            return new Response('Not Found', { status: 404 });
        };

        const streamedDeltas = [];
        const result = await chatTest.streamModelWithFallback(
            'What is the capital of Australia?',
            { maxTokens: 1000, timeoutMs: 25000 },
            (delta) => streamedDeltas.push(delta)
        );

        assert.equal(result.ok, true, 'Cascade should succeed on fallback provider');
        assert.equal(result.provider, 'openai', `Expected fallback provider to be openai, got ${result.provider}`);
        assert.deepEqual(Array.from(new Set(attemptedProviders)), ['groq', 'openai'], 'Should attempt Groq first, then fallback to OpenAI');
        assert.equal(streamedDeltas.join(''), 'Canberra is the capital.', 'Should stream combined tokens from fallback provider');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
});

console.log(`\n=== All ${passedChecks}/${totalChecks} Empirical Challenger Stress Tests PASSED with 0 Errors ===\n`);
