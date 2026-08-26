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

// 2. Test Dynamic Narrative Structure across Diverse Queries
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

const generatedResults = [];
for (const { query, domain } of testQueries) {
    const steps = generateSteps(query);
    assert.ok(Array.isArray(steps), 'Steps for ' + domain + ' must be an array');
    assert.equal(steps.length, 5, 'Steps for ' + domain + ' must contain 5 multi-stage narratives');
    for (let i = 0; i < steps.length; i++) {
        assert.ok(steps[i].length > 15, `Stage ${i + 1} too short for ${domain}: ${steps[i]}`);
    }
    generatedResults.push({ domain, query, steps });
}

const allStep1s = new Set(generatedResults.map(r => r.steps[0]));
assert.equal(allStep1s.size, generatedResults.length, 'Every distinct query must produce a unique contextualized Stage 1');
console.log('  [PASS] 2. Dynamic 5-stage CoT narratives generated with 100% semantic uniqueness');

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

console.log('dynamic-cot-reasoning-tests-ok');
