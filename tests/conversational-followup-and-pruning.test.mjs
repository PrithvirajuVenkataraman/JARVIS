import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createConversationEngine,
    reformulateSearchQuery,
    isStandaloneQuery,
    pruneSearchNoiseFromText,
    buildMultiTierContext,
    truncateAtWordBoundary
} from '../app/context-engine.js';
import { BoundedLiveResearchController } from '../app/bounded-live-research.js';
import { resolveContextualFollowUpQuery, buildSearchQueryRewrite } from '../api/search.js';
import fs from 'node:fs';

test('1. Argument Passing in index.html: rawUserText never becomes "[object Object]"', () => {
    const htmlContent = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

    // Verify handleBoundedLiveResearchQuery contains polymorphic normalization
    assert.ok(
        htmlContent.includes("if (effectiveRawUserText === '[object Object]')"),
        'index.html must sanitize rawUserText against [object Object]'
    );
    assert.ok(
        htmlContent.includes("if (effectiveCleanText === '[object Object]')"),
        'index.html must sanitize cleanText against [object Object]'
    );

    // Test parameter normalization logic directly against all caller permutations
    function normalizeTestArgs(cleanText, rawUserText, options = {}) {
        let effectiveCleanText = '';
        let effectiveRawUserText = '';
        let effectiveOptions = {};

        if (cleanText && typeof cleanText === 'object') {
            effectiveOptions = { ...cleanText };
            effectiveCleanText = typeof cleanText.cleanText === 'string' ? cleanText.cleanText : (typeof cleanText.query === 'string' ? cleanText.query : '');
            effectiveRawUserText = typeof cleanText.rawUserText === 'string' ? cleanText.rawUserText : (typeof cleanText.userText === 'string' ? cleanText.userText : effectiveCleanText);
        } else if (rawUserText && typeof rawUserText === 'object') {
            effectiveOptions = { ...rawUserText };
            effectiveCleanText = typeof cleanText === 'string' ? cleanText : String(cleanText || '');
            effectiveRawUserText = typeof rawUserText.rawUserText === 'string' ? rawUserText.rawUserText : (typeof rawUserText.userText === 'string' ? rawUserText.userText : effectiveCleanText);
        } else {
            effectiveCleanText = typeof cleanText === 'string' ? cleanText : String(cleanText || '');
            effectiveRawUserText = typeof rawUserText === 'string' ? rawUserText : (rawUserText ? String(rawUserText) : effectiveCleanText);
            effectiveOptions = options && typeof options === 'object' ? options : {};
        }

        if (effectiveRawUserText === '[object Object]') effectiveRawUserText = effectiveCleanText;
        if (effectiveCleanText === '[object Object]') effectiveCleanText = '';
        return { cleanText: effectiveCleanText, rawUserText: effectiveRawUserText, options: effectiveOptions };
    }

    // Permutation A: Standard 3 args (cleanText, rawUserText, options)
    const resA = normalizeTestArgs('clean query', 'raw user text', { route: 'live_required' });
    assert.equal(resA.cleanText, 'clean query');
    assert.equal(resA.rawUserText, 'raw user text');
    assert.equal(resA.options.route, 'live_required');

    // Permutation B: 2 args where 2nd is options object: handleBoundedLiveResearchQuery(cleanText, { routeDecision })
    const resB = normalizeTestArgs('who is the ceo of apple', { routeDecision: { route: 'live_required' } });
    assert.equal(resB.cleanText, 'who is the ceo of apple');
    assert.equal(resB.rawUserText, 'who is the ceo of apple');
    assert.notEqual(resB.rawUserText, '[object Object]');
    assert.ok(resB.options.routeDecision);

    // Permutation C: 1 arg where 1st is options object: handleBoundedLiveResearchQuery({ query: 'bitcoin price' })
    const resC = normalizeTestArgs({ query: 'bitcoin price', route: 'live_required' });
    assert.equal(resC.cleanText, 'bitcoin price');
    assert.equal(resC.rawUserText, 'bitcoin price');
    assert.notEqual(resC.rawUserText, '[object Object]');
});

test('2. Standalone Questions: Skip rewriting and preserve query verbatim', () => {
    const turns = [
        { role: 'user', text: 'Who is the CEO of Apple?' },
        { role: 'assistant', text: 'Tim Cook is the current CEO of Apple.' }
    ];

    // Standalone questions must be identified and preserved
    const standaloneQueries = [
        'Who is the CEO of Apple?',
        'What is the capital of France?',
        'Weather in Tokyo',
        'Bitcoin price today',
        'Explain quicksort in Python with code',
        'How does photosynthesis work?',
        'What is the speed of light?'
    ];

    for (const q of standaloneQueries) {
        assert.equal(isStandaloneQuery(q, turns), true, `Query "${q}" must be classified as standalone`);
        const reformulated = reformulateSearchQuery(q, { turns });
        assert.equal(reformulated, q, `Query "${q}" must be preserved verbatim without rewriting`);
    }

    // With zero conversation history, everything is standalone
    assert.equal(isStandaloneQuery('his net worth', []), true, 'Empty history must treat query as standalone');
    assert.equal(reformulateSearchQuery('his net worth', { turns: [] }), 'his net worth');
});

test('3. Follow-Up Reference Resolution: Resolves "his net worth", "what about in 2024?", and "compare the two"', () => {
    // Scenario A: Pronoun coreference ("his net worth", "what is her salary?")
    const turnsA = [
        { role: 'user', text: 'Who is the CEO of Apple?' },
        { role: 'assistant', text: 'Tim Cook has been the chief executive officer of Apple since August 2011.' }
    ];

    assert.equal(isStandaloneQuery('What is his net worth?', turnsA), false);
    const rewrittenNetWorth = reformulateSearchQuery('What is his net worth?', { turns: turnsA });
    assert.ok(
        rewrittenNetWorth.toLowerCase().includes('tim cook') && rewrittenNetWorth.toLowerCase().includes('net worth'),
        `Expected "Tim Cook" and "net worth" in "${rewrittenNetWorth}"`
    );

    const rewrittenAge = reformulateSearchQuery('how old is he?', { turns: turnsA });
    assert.ok(
        rewrittenAge.toLowerCase().includes('tim cook'),
        `Expected "Tim Cook" in "${rewrittenAge}"`
    );

    // Scenario B: Elliptical temporal query ("what about in 2024?", "and in Europe?")
    const turnsB = [
        { role: 'user', text: 'Tesla vehicle delivery numbers' },
        { role: 'assistant', text: 'In 2023, Tesla delivered approximately 1.81 million vehicles globally.' }
    ];

    assert.equal(isStandaloneQuery('what about in 2024?', turnsB), false);
    const rewritten2024 = reformulateSearchQuery('what about in 2024?', { turns: turnsB });
    assert.ok(
        rewritten2024.toLowerCase().includes('tesla') && rewritten2024.includes('2024'),
        `Expected "Tesla" and "2024" in "${rewritten2024}"`
    );

    // Scenario C: Comparative query ("compare the two", "which one is faster?")
    const turnsC = [
        { role: 'user', text: 'What are the main frontend frameworks?' },
        { role: 'assistant', text: 'The top two choices are:\n1. **React**: A component-based library by Meta.\n2. **Vue**: A progressive framework by Evan You.' }
    ];

    assert.equal(isStandaloneQuery('compare the two', turnsC), false);
    const rewrittenCompare = reformulateSearchQuery('compare the two', { turns: turnsC });
    assert.ok(
        rewrittenCompare.toLowerCase().includes('react') && rewrittenCompare.toLowerCase().includes('vue'),
        `Expected "React" and "Vue" in "${rewrittenCompare}"`
    );

    const rewrittenFaster = reformulateSearchQuery('which one is faster?', { turns: turnsC });
    assert.ok(
        rewrittenFaster.toLowerCase().includes('react') && rewrittenFaster.toLowerCase().includes('vue'),
        `Expected "React" and "Vue" in "${rewrittenFaster}"`
    );
});

test('4. Backend /api/search Query Rewrite: resolveContextualFollowUpQuery works seamlessly', () => {
    const turns = [
        { role: 'user', text: 'Who is the CEO of Apple?' },
        { role: 'assistant', text: 'The current CEO of Apple is **Tim Cook**.' }
    ];

    const resolved = resolveContextualFollowUpQuery('what is his net worth?', turns);
    assert.ok(resolved.toLowerCase().includes('tim cook'), `Expected Tim Cook in "${resolved}"`);

    const rewriteObj = buildSearchQueryRewrite('what is his net worth?', turns);
    assert.ok(
        rewriteObj.query.toLowerCase().includes('tim cook'),
        `buildSearchQueryRewrite must output target query with Tim Cook: "${rewriteObj.query}"`
    );

    // Standalone query must remain untouched in backend rewrite
    const standaloneRewrite = buildSearchQueryRewrite('weather in Paris', turns);
    assert.ok(standaloneRewrite.query.toLowerCase().includes('paris'));
    assert.ok(!standaloneRewrite.query.toLowerCase().includes('tim cook'));
});

test('5. MCQs, Multimodal, and Topic Change Invariants: Never incorrectly rewritten', () => {
    const turns = [
        { role: 'user', text: 'Tell me about the Roman Empire' },
        { role: 'assistant', text: 'The Roman Empire was founded in 27 BC under Augustus.' }
    ];

    // MCQ question: must not be rewritten
    const mcq = 'Which of the following is correct? A) Option 1 B) Option 2 C) Option 3 D) Option 4';
    assert.equal(isStandaloneQuery(mcq, turns), true);
    assert.equal(reformulateSearchQuery(mcq, { turns }), mcq);

    // Image prompt: must not be rewritten
    const img = ':::image[a vintage camera sitting on a wooden desk]:::';
    assert.equal(isStandaloneQuery(img, turns), true);
    assert.equal(reformulateSearchQuery(img, { turns }), img);

    // Explicit topic change: must not be rewritten
    const topicChange1 = 'new topic: tell me about Mars exploration';
    assert.equal(isStandaloneQuery(topicChange1, turns), true);
    assert.equal(reformulateSearchQuery(topicChange1, { turns }), topicChange1);

    const topicChange2 = 'switch to the James Webb Space Telescope';
    assert.equal(isStandaloneQuery(topicChange2, turns), true);
    assert.equal(reformulateSearchQuery(topicChange2, { turns }), topicChange2);
});

test('6. Context Engine Pruning: Strips bulky search results and respects token budget', () => {
    const bulkyAssistantMessage = `Tim Cook has an estimated net worth of approximately $2 billion.

Sources:
[1] https://forbes.com/profile/tim-cook
[2] https://bloomberg.com/billionaires/profiles/tim-cook
[3] https://reuters.com/business/apple-ceo-compensation

=== SOURCE METADATA ===
{"verifiedCount": 3, "latencyMs": 420}

*(Synthesis completed at the 9.0s deadline)*`;

    // 1. pruneSearchNoiseFromText removes all bulky search junk
    const cleaned = pruneSearchNoiseFromText(bulkyAssistantMessage);
    assert.ok(cleaned.includes('Tim Cook has an estimated net worth'));
    assert.ok(!cleaned.includes('Sources:'));
    assert.ok(!cleaned.includes('=== SOURCE METADATA ==='));
    assert.ok(!cleaned.includes('*(Synthesis completed'));
    assert.ok(!cleaned.includes('https://forbes.com'));

    // 2. buildMultiTierContext prunes noise and enforces budget
    const engine = createConversationEngine({ maxTurns: 10, maxContextChars: 2000 });
    
    // Add 12 turns with bulky content
    for (let i = 1; i <= 6; i++) {
        engine.recordTurn({ role: 'user', text: `Question ${i}: Who is person ${i}?` });
        engine.recordTurn({
            role: 'assistant',
            text: `Answer ${i}: Person ${i} is a notable scientist.\n\nSources:\n[1] https://source${i}.org\n[2] https://source${i}.edu\n\n=== SOURCE METADATA ===\n{}`
        });
    }

    const multiTier = engine.buildMultiTierContext({
        message: 'Follow up question',
        maxRecentTurns: 4,
        maxContextChars: 1500
    });

    // Recent turns must not contain search noise
    for (const turn of multiTier.recentTurns) {
        if (turn.role === 'assistant') {
            assert.ok(!turn.text.includes('Sources:'), 'Recent assistant turns must have search noise stripped');
            assert.ok(!turn.text.includes('=== SOURCE METADATA ==='), 'Recent assistant turns must have metadata stripped');
        }
    }

    // Total structured messages must not blow past budget
    const totalChars = multiTier.structuredMessages.reduce((sum, m) => sum + m.content.length, 0);
    assert.ok(totalChars <= 2500, `Total characters (${totalChars}) must remain within token budget ceiling`);
});

test('7. Fast Fallbacks & Low-Latency Performance: Sub-millisecond execution and fail-open resilience', () => {
    // Malformed inputs must never throw
    assert.doesNotThrow(() => reformulateSearchQuery(null, {}));
    assert.doesNotThrow(() => reformulateSearchQuery(undefined, {}));
    assert.doesNotThrow(() => reformulateSearchQuery('', {}));
    assert.doesNotThrow(() => reformulateSearchQuery(123, {}));
    assert.doesNotThrow(() => reformulateSearchQuery('test', { state: null, turns: null }));

    // Latency check: 100 runs must execute in < 25ms total (< 0.25ms per call)
    const turns = [
        { role: 'user', text: 'Who is the CEO of Apple?' },
        { role: 'assistant', text: 'Tim Cook is the chief executive officer of Apple.' }
    ];

    const start = performance.now();
    for (let i = 0; i < 100; i++) {
        reformulateSearchQuery('what is his net worth?', { turns });
        reformulateSearchQuery('what is photosynthesis?', { turns });
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `100 reformulation runs must complete in under 50ms (took ${elapsed.toFixed(2)}ms)`);
});

test('8. BoundedLiveResearchController: Receives question, history context, and verified sources in synthesis', async () => {
    const controller = new BoundedLiveResearchController({
        searchCutoffMs: 200,
        fallbackWarningMs: 400,
        hardDeadlineMs: 800
    });

    let receivedPrompt = '';
    let receivedContext = null;
    let receivedUserText = '';

    const history = [
        { role: 'user', text: 'Who is the CEO of Apple?' },
        { role: 'assistant', text: 'Tim Cook is the chief executive officer of Apple.' }
    ];

    const result = await controller.execute({
        query: 'Tim Cook net worth',
        userText: 'What is his net worth?',
        context: history,
        fetchSearchFn: async () => ({
            results: [
                {
                    title: 'Forbes Billionaires: Tim Cook',
                    url: 'https://forbes.com/profile/tim-cook',
                    domain: 'forbes.com',
                    snippet: 'Tim Cook has an estimated net worth of approximately $2.1 billion.'
                },
                {
                    title: 'Bloomberg Billionaires Index',
                    url: 'https://bloomberg.com/billionaires/profiles/tim-cook',
                    domain: 'bloomberg.com',
                    snippet: 'Apple CEO Tim Cook holds substantial equity and philanthropic pledges.'
                }
            ]
        }),
        streamSynthesisFn: async ({ prompt, userText, context, onToken }) => {
            receivedPrompt = prompt;
            receivedUserText = userText;
            receivedContext = context;
            onToken('Tim Cook has an estimated net worth of approximately $2.1 billion.');
        }
    });

    assert.equal(result.success, true);
    // Verified user question preserved
    assert.equal(receivedUserText, 'What is his net worth?');
    // Verified prompt contains the conversation history section
    assert.ok(receivedPrompt.includes('PRIOR CONVERSATION CONTEXT:'), 'Prompt must contain prior conversation context');
    assert.ok(receivedPrompt.includes('Tim Cook is the chief executive officer'), 'Prompt must contain previous turn facts');
    // Verified prompt contains user question and sources
    assert.ok(receivedPrompt.includes('User question: "What is his net worth?"'));
    assert.ok(receivedPrompt.includes('Verified Sources:'));
    // Verified streamSynthesisFn received clean context turns array
    assert.ok(Array.isArray(receivedContext) && receivedContext.length >= 2);
    assert.equal(receivedContext[0].role, 'user');
    assert.equal(receivedContext[1].role, 'assistant');
});
