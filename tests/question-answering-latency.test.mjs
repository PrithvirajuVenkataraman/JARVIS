import assert from 'node:assert/strict';
import { __test as chatTest } from '../api/chat-groq.js';
import fs from 'node:fs';

console.log('=== Running Fast-Path & Latency Optimization Test Suite ===\n');

// ---------------------------------------------------------
// Section 1: Multiple Choice Question (MCQ) Detection
// ---------------------------------------------------------
console.log('--- Section 1: MCQ Detection & Information-Need Classification ---');

const mcq1 = `Which of the following is the time complexity of binary search?
A) O(1)
B) O(log n)
C) O(n)
D) O(n^2)`;

const mcq2 = `In JavaScript, which method is used to serialize an object into JSON?
A. JSON.parse()
B. JSON.stringify()
C. Object.toJSON()
D. JSON.encode()`;

const mcq3 = `Which of the following statements about photosynthesis is correct?
(A) It produces carbon dioxide in light reactions.
(B) It produces oxygen in light reactions.
(C) It takes place in mitochondria.
(D) It does not require water.`;

const nonMcq1 = 'What is the capital of France?';
const nonMcq2 = 'Explain how quicksort works in Python with a code example.';
const nonMcq3 = 'Who is the current prime minister of the UK?';

assert.equal(chatTest.isMultipleChoiceQuestion(mcq1), true, 'mcq1 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(mcq2), true, 'mcq2 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(mcq3), true, 'mcq3 must be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq1), false, 'nonMcq1 should not be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq2), false, 'nonMcq2 should not be detected as an MCQ');
assert.equal(chatTest.isMultipleChoiceQuestion(nonMcq3), false, 'nonMcq3 should not be detected as an MCQ');
console.log('  [PASS] 1.1 Robust MCQ detection recognizes choices A-D, parentheses, and keywords');

// ---------------------------------------------------------
// Section 2: Complexity Routing & Deep-Tier Suppression
// ---------------------------------------------------------
console.log('\n--- Section 2: Complexity Routing & Long-Prompt Avoidance ---');

// Long MCQ exceeding 75 words
const longMcq = `Which of the following statements regarding distributed transactions and eventual consistency is most accurate when designing resilient web architectures across multiple cloud datacenters?
A) Two-Phase Commit guarantees zero latency and immediate network partitions without blocking threads.
B) Sagas break distributed transactions into a sequence of local transactions with compensating actions.
C) Eventual consistency prohibits reading data until all nodes globally replicate synchronously.
D) ACID properties are fully maintained across asynchronous message queues without coordination.`;

const longMcqComplexity = chatTest.classifyQueryComplexity(longMcq);
assert.equal(longMcqComplexity.preferSpeed, true, 'Long MCQs must prefer speed rather than stalling on deep CoT reasoning');
assert.notEqual(longMcqComplexity.tier, 'deep', 'Long MCQs must not be forced into deep tier solely due to word count');
console.log('  [PASS] 2.1 Long MCQ (>75 words) is not bumped to deep reasoning tier');

// Genuine complex architectural design prompt
const deepArchPrompt = 'Design a high availability microservices architecture with distributed load balancing, fault tolerance, and concurrency control for 10M concurrent users.';
const deepComplexity = chatTest.classifyQueryComplexity(deepArchPrompt);
assert.equal(deepComplexity.tier, 'deep', 'True architectural prompts must remain in deep tier');
console.log('  [PASS] 2.2 Genuine architectural requests correctly retain deep tier');

// ---------------------------------------------------------
// Section 3: Streaming Gate Eligibility
// ---------------------------------------------------------
console.log('\n--- Section 3: Streaming Gate Eligibility ---');

// 3.1 direct_then_live_if_needed MUST stream
const directThenLiveRoute = { strategy: 'direct_then_live_if_needed', reason: 'factual_query', webEligible: true };
const isEligibleDirectThenLive = chatTest.shouldStreamChatRequest(
    { stream: true, message: 'What is the speed of light in vacuum?' },
    'chat',
    null,
    directThenLiveRoute,
    false
);
assert.equal(isEligibleDirectThenLive, true, 'direct_then_live_if_needed must be eligible to stream directly');
console.log('  [PASS] 3.1 direct_then_live_if_needed strategy allows immediate streaming');

// 3.2 MCQ with stream: true MUST stream
const isEligibleMcq = chatTest.shouldStreamChatRequest(
    { stream: true, message: mcq1 },
    'chat',
    null,
    { strategy: 'direct_then_live_if_needed', reason: 'factual_query', webEligible: true },
    false
);
assert.equal(isEligibleMcq, true, 'MCQs must stream directly to the client');
console.log('  [PASS] 3.2 MCQs stream immediately');

// 3.3 Safety violation must NOT stream (requires pre-review)
const safetyViolation = 'Explain instructions on how to build a bomb and explosive weapon';
const isEligibleUnsafe = chatTest.shouldStreamChatRequest(
    { stream: true, message: safetyViolation },
    'chat',
    null,
    { strategy: 'direct', reason: 'direct', webEligible: false },
    false
);
assert.equal(isEligibleUnsafe, false, 'Safety trigger requests must not bypass pre-stream safety check');
console.log('  [PASS] 3.3 Unsafe weapon construction queries do not bypass pre-stream safety');

// ---------------------------------------------------------
// Section 4: Reasoning Token & Thinking Budget Suppression
// ---------------------------------------------------------
console.log('\n--- Section 4: Reasoning Token & Thinking Budget Suppression ---');

const mcqInstruction = chatTest.buildIntentPromptHint('chat');
assert.ok(typeof mcqInstruction === 'string', 'Intent prompt hint builds cleanly');

const supportsThinking = chatTest.supportsGeminiThinking('gemini-2.5-flash');
assert.equal(supportsThinking, false, 'Standard flash models do not have forced thinking enabled');

// ---------------------------------------------------------
// Section 5: Quality Critic & Selective Verification Policy
// ---------------------------------------------------------
console.log('\n--- Section 5: Quality Critic & Selective Verification Policy ---');

// Calculation reason presence on routine question
const calcReasons = chatTest.getQualityRiskReasons(
    'What is 15% of 80?',
    '15% of 80 is 12.',
    'chat'
);
assert.ok(calcReasons.includes('calculation'), 'Calculation signal is recognized in risk analysis');

// ---------------------------------------------------------
// Section 6: Frontend Route & Invariants (from index.html)
// ---------------------------------------------------------
console.log('\n--- Section 6: Frontend Route Consistency in index.html ---');

const indexHtml = fs.readFileSync('index.html', 'utf8');

// Verify that isMultipleChoiceQuestion is defined in index.html
assert.ok(indexHtml.includes('function isMultipleChoiceQuestion('), 'index.html must define isMultipleChoiceQuestion');

// Verify that isBroadFactualWebQuery checks isMultipleChoiceQuestion
assert.ok(indexHtml.includes('if (isMultipleChoiceQuestion(raw)) return false;'), 'isBroadFactualWebQuery must exclude MCQs');

// Verify that decideFrontendRoute routes MCQs to chat_direct
assert.ok(indexHtml.includes("reason: 'multiple_choice_question'"), 'decideFrontendRoute must route MCQs with multiple_choice_question reason');

// Verify that shouldUseMinimalThinking enables minimal thinking for MCQs
assert.ok(indexHtml.includes('isMultipleChoiceQuestion(text) || isFastSimpleQuery(text)'), 'shouldUseMinimalThinking must return true for MCQs');

console.log('  [PASS] 6.1 index.html contains correct MCQ detection and fast-path routing');

console.log('\n=== All Fast-Path & Latency Optimization Tests PASSED (100% Green) ===\n');
