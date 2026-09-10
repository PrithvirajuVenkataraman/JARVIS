import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('--- Testing Dynamic Chain of Thought & Reasoning Engine (Milestone 1) ---');

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const chatGroqJs = fs.readFileSync(new URL('../api/chat-groq.js', import.meta.url), 'utf8');

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

const cotSandbox = {};
vm.createContext(cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), cotSandbox);
const generateSteps = cotSandbox.generateContextualThoughtSteps;
const extractThoughtAndAnswer = cotSandbox.extractThoughtAndAnswer;

// 1. Test Pleasantries and Ultra-Short Greetings return empty array
assert.equal(generateSteps('hi').length, 0);
assert.equal(generateSteps('hello!').length, 0);
assert.equal(generateSteps('thanks').length, 0);
assert.equal(generateSteps('ok').length, 0);
console.log('  [PASS] 1. Pleasantries and short greetings produce no unnecessary CoT steps');

// 2. Test Real-Model-Thinking-Only Invariant across Diverse Queries
const testQueries = [
    { query: 'Write a quicksort algorithm in Python with asymptotic analysis', domain: 'Coding (Python)' },
    { query: 'How to implement a debounce function in TypeScript?', domain: 'Coding (TypeScript)' },
    { query: 'Calculate the derivative of f(x) = x^3 * sin(x)', domain: 'Mathematics' },
    { query: 'Why did the Roman Empire collapse in 476 AD?', domain: 'History' },
    { query: 'Explain how gravitational time dilation works near a black hole', domain: 'Physics' },
    { query: 'What is the capital of Australia and why was Canberra chosen?', domain: 'Geography' },
    { query: 'Compare PostgreSQL vs MongoDB for high-throughput write workloads', domain: 'Comparison' },
    { query: 'How does CRISPR-Cas9 perform targeted gene editing in molecular biology?', domain: 'Biology' },
    { query: 'How do central banks use interest rates to combat inflation?', domain: 'Economics' },
    { query: 'Traditional sourdough bread recipe with hydration percentages', domain: 'Procedural' }
];

for (const { query, domain } of testQueries) {
    const steps = generateSteps(query);
    assert.ok(Array.isArray(steps), 'Steps for ' + domain + ' must be an array');
    assert.ok(steps.length >= 2, 'Must produce structured pipeline reasoning summaries: ' + domain);
    assert.ok(steps.every(s => s.title && s.body), 'Steps must contain title and body: ' + domain);
}
console.log('  [PASS] 2. Structured pipeline reasoning summaries successfully generated across domains');

// 3. Test Multi-Chunk Converse Speech Stream <think> Filtering
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

speechSandbox.startStreamingConverseSpeech('turn-1');
// Delta 1: Start of thinking block
speechSandbox.feedStreamingConverseDelta('<think>\nAnalyzing contextual parameters deeply...', 'turn-1');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'No thinking tokens enqueued');

// Delta 2: Intermediate reasoning tokens across chunk boundaries
speechSandbox.feedStreamingConverseDelta('\nEvaluating domain principles and causal logic...', 'turn-1');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'Intermediate tokens not enqueued');

// Delta 3: Closing thinking tag and starting answer sentence
speechSandbox.feedStreamingConverseDelta('\n</think>\nPrimary verified synthesis statement.\n', 'turn-1');
speechSandbox.feedStreamingConverseDelta('Secondary detailed elaboration text.\n', 'turn-1');
speechSandbox.finishStreamingConverseSpeech('Primary verified synthesis statement.\nSecondary detailed elaboration text.\n', 'turn-1');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.length >= 1, 'Verified answer segments enqueued');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.every(seg => !seg.includes('<think>') && !seg.includes('</think>')), 'No reasoning tags leaked into speech segments');

// Turn 2: Split closing tag across chunk boundary
speechSandbox.startStreamingConverseSpeech('turn-2');
speechSandbox.feedStreamingConverseDelta('<think>internal reasoning steps</th', 'turn-2');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'Partial thinking tag buffer must not emit speech');
speechSandbox.feedStreamingConverseDelta('ink>\nFinal response after split tag.\n', 'turn-2');
speechSandbox.finishStreamingConverseSpeech('Final response after split tag.\n', 'turn-2');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.length >= 1, 'Response after split tag enqueued');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments[0], 'Final response after split tag.');
console.log('  [PASS] 3. Multi-chunk <think> converse stream delta filtering prevents speech leakage');

// 4. Test extractThoughtAndAnswer in client index.html
const extractResult1 = extractThoughtAndAnswer('<think>\nStep-by-step reasoning\n</think>\nHere is the answer.');
assert.equal(extractResult1.thought, 'Step-by-step reasoning');
assert.equal(extractResult1.answer, 'Here is the answer.');

const extractResult2 = extractThoughtAndAnswer('<think>\nActive streaming thought in progress');
assert.equal(extractResult2.thought, 'Active streaming thought in progress');
assert.equal(extractResult2.answer, '');

const extractResult3 = extractThoughtAndAnswer('Simple answer without any reasoning block.');
assert.equal(extractResult3.thought, '');
assert.equal(extractResult3.answer, 'Simple answer without any reasoning block.');
console.log('  [PASS] 4. extractThoughtAndAnswer parses completed and streaming thought blocks');

// 5. Test parseModelText in api/chat-groq.js extracts { response, thought }
const backendSandbox = {};
vm.createContext(backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'extractThoughtAndResponse'), backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'stripThinkingTags'), backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'parseModelText'), backendSandbox);
const parseModelText = backendSandbox.parseModelText;

const parsedWithThought = parseModelText('<think>\nEvaluating mathematical principles\n</think>\nThe derivative is 3x^2.');
assert.equal(parsedWithThought.response, 'The derivative is 3x^2.');
assert.equal(parsedWithThought.thought, 'Evaluating mathematical principles');
assert.equal(parsedWithThought.intent, 'casual_chat');

const parsedJsonWithThought = parseModelText('<think>\nAnalyzing user request\n</think>\n```json\n{"intent":"casual_chat","response":"Hello world!"}\n```');
assert.equal(parsedJsonWithThought.response, 'Hello world!');
assert.equal(parsedJsonWithThought.thought, 'Analyzing user request');

const parsedPlain = parseModelText('Plain text response without thinking tags.');
assert.equal(parsedPlain.response, 'Plain text response without thinking tags.');
assert.equal(parsedPlain.thought, undefined);

// 6. Test system instruction leakage / meta-analysis suppression
const leakedMetaResponse = parseModelText('Analyze User Input:\nThe user asked to solve this math problem from the OCR image, said this: "find x".\n\nCheck Constraints & Rules:\n- Direct answer\n- No meta-talk\n\nFinal Answer:\nx = 42');
assert.equal(leakedMetaResponse.response, 'x = 42');
assert.ok(leakedMetaResponse.thought.includes('Analyze User Input:'));

const clientExtractLeaked = extractThoughtAndAnswer('The user asked to solve the attachment, said this: "calculate integral".\nApplying rules: Start directly with the answer.\n\nHere is the solution:\n\\int x dx = \\frac{x^2}{2} + C');
assert.equal(clientExtractLeaked.answer, '\\int x dx = \\frac{x^2}{2} + C');
assert.ok(clientExtractLeaked.thought.includes('The user asked'));

console.log('  [PASS] 6. System instruction leakage and meta-chatter cleanly tucked into thought');

function fixtureSubject(value) {
    return String(value || '');
}

// 7. Verify Clean Chain of Thoughts (historical stat query produces no fake CoT)
assert.equal(generateSteps("How many 100's did sachin score in International cricket?").length, 0, 'Past sports stat queries must not produce fake CoT steps');
assert.equal(generateSteps("Who scored the winning goal in 2010?").length, 0, 'Past historical scoring questions must not produce fake CoT steps');
assert.ok(!indexHtml.includes('Dispatching real-time multi-source news scrapers'), 'Outdated news scrapers string must be permanently removed');
assert.ok(indexHtml.includes('Querying verified real-time sources'), 'Clean verified sources wording must be used in CoT');
console.log('  [PASS] 7. Dynamic CoT cleanliness and historical stat queries protected');

// 8. Verify Confident Single-Source Early Exit in Search Pipeline
const { __test: searchTest } = await import('../api/search.js');
const confidentSingleSource = [{
    title: fixtureSubject('Athlete Career Record - Wiki'),
    domain: 'wikipedia.org',
    url: 'https://en.wikipedia.org/wiki/Subject',
    description: fixtureSubject('Subject is an international athlete who recorded 100 centuries across professional matches.'),
    sourceType: 'encyclopedia',
    trusted: true
}];
const singleGate = searchTest.evaluateWebRagEvidence('How many centuries did the athlete score in career', confidentSingleSource);
assert.equal(singleGate.pass, true, 'Confident single authoritative source must pass early exit without requiring 2+ domains');
assert.ok(singleGate.confidence >= 0.85, 'Confident single source must have high confidence score');
assert.ok(indexHtml.includes('hasConfidentSingleSource'), 'Frontend handleLiveRetrievalQuery must support confident single-source early exit');
console.log('  [PASS] 8. Confident single-source early exit verified');

// 9. Verify Media Attribution & Entertainment Depth Invariants (Zero Hardcoding)
vm.runInContext(extractFunctionSource(indexHtml, 'isExplicitBrevityRequested'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isEntertainmentMediaQuery'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isMediaAttributionQuery'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isStrictYesNoRequest'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isConciseDirectFactQuery'), cotSandbox);

const { isExplicitBrevityRequested, isEntertainmentMediaQuery, isMediaAttributionQuery, isConciseDirectFactQuery } = cotSandbox;

// 9.1 Syntactic media attribution detection
assert.equal(isMediaAttributionQuery('which movie is the song from?'), true, 'Song to movie query must be detected');
assert.equal(isMediaAttributionQuery('what film has the song track?'), true, 'Film track query must be detected');
assert.equal(isMediaAttributionQuery('who composed the soundtrack of the film?'), true, 'Composer of film soundtrack must be detected');
assert.equal(isMediaAttributionQuery('composer of the track?'), true, 'Composer of track must be detected');
assert.equal(isMediaAttributionQuery('is the song from film Alpha or film Beta?'), true, 'Song film comparison must be detected');
assert.equal(isMediaAttributionQuery('who played the role of the character in the sitcom?'), true, 'Character in sitcom must be detected');
assert.equal(isMediaAttributionQuery('what is the capital of France?'), false, 'Non-media query must not be detected as media attribution');
assert.equal(isMediaAttributionQuery('how to implement quicksort in Python?'), false, 'Coding query must not be detected as media attribution');

// 9.2 Entertainment query depth vs concise fact constraints
assert.equal(isEntertainmentMediaQuery('tell me about the film and its background'), true);
assert.equal(isEntertainmentMediaQuery('who is the character in the sitcom series'), true);
assert.equal(isExplicitBrevityRequested('in one sentence, who composed the score?'), true);
assert.equal(isExplicitBrevityRequested('briefly tell me the origin of the song'), true);
assert.equal(isExplicitBrevityRequested('tell me all about the movie and composer'), false);

// 9.3 Media queries must not be forced into concise 1-liners unless brevity is explicitly asked
assert.equal(isConciseDirectFactQuery('who is the composer of the film soundtrack?'), false, 'Media queries must not be constrained to 1-2 sentence one-liners by default');
assert.equal(isConciseDirectFactQuery('tell me about the sitcom series and character'), false, 'Sitcom query must not be constrained to 1-2 sentence one-liners');
assert.equal(isConciseDirectFactQuery('in one sentence, who is the composer?'), true, 'Explicit brevity query should be recognized as concise');
console.log('  [PASS] 9. Media attribution & unconstrained entertainment depth verified');

// 10. Verify Anti-Hallucination Prompt Invariants in Groq Chat & System Directives
assert.ok(chatGroqJs.includes('Strict entity and soundtrack attribution'), 'Chat backend must enforce strict soundtrack and entity attribution');
assert.ok(chatGroqJs.includes('Never guess or attribute a song to the wrong movie or composer'), 'Chat backend must explicitly forbid cross-movie attribution hallucination');
assert.ok(chatGroqJs.includes('Default to a comprehensive, well-structured response'), 'Chat backend must default to comprehensive responses for pop culture');
assert.ok(indexHtml.includes('Entertainment & Media Guidance'), 'Frontend system directives must provide entertainment & media guidance');
assert.ok(indexHtml.includes('Strictly verify media attribution'), 'Frontend system directives must instruct strict media attribution verification');
console.log('  [PASS] 10. Strict anti-hallucination attribution prompt directives verified');

// 11. Verify Smooth Thinking Indicator & Transition Animations
const stylesCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
assert.ok(stylesCss.includes('#chat-thinking-indicator'), 'styles.css must contain #chat-thinking-indicator transition rules');
assert.ok(stylesCss.includes('chat-thinking-indicator-leaving'), 'styles.css must contain .chat-thinking-indicator-leaving fade-out styles');
assert.ok(stylesCss.includes('assistantBubbleEnter'), 'styles.css must contain assistantBubbleEnter entrance animation');
assert.ok(indexHtml.includes('chat-thinking-indicator-leaving'), 'index.html hideThinkingIndicator must apply leaving transition class');
console.log('  [PASS] 11. Smooth thinking indicator exit and entrance animations verified');

console.log('dynamic-cot-reasoning-tests-ok');
