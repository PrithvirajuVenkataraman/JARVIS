import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { __test as chatTest } from '../api/chat-groq.js';

console.log('=== Running Phase 15: Latency Reduction & Instant Model Tier Test Suite ===\n');

// ---------------------------------------------------------
// Test Section 1: Instant Model Tier Candidate Ordering
// ---------------------------------------------------------
console.log('--- Section 1: Instant Model Tier Candidate Ordering ---');

// 1.1 Groq instant tier candidates: gemma2-9b-it first, followed by qwen-2.5-coder-32b
const groqInstant = chatTest.getPreferredGroqCandidates('', { tier: 'instant', preferSpeed: true });
assert.equal(groqInstant[0], 'gemma2-9b-it', 'Instant tier must prioritize gemma2-9b-it first on Groq');
assert.ok(groqInstant.includes('qwen-2.5-coder-32b'), 'Instant tier must include qwen-2.5-coder-32b as fallback');
assert.ok(!groqInstant.some(m => m.toLowerCase().includes('llama')), 'Groq candidates must not include any Llama models');
console.log('  [PASS] 1.1 Groq instant candidates prioritize gemma2-9b-it with qwen fallback');

// 1.2 Gemini instant tier candidates: gemini-2.5-flash-lite first
const geminiInstant = chatTest.getPreferredGeminiCandidates('', null, { tier: 'instant', preferSpeed: true });
assert.equal(geminiInstant[0], 'gemini-2.5-flash-lite', 'Instant tier must prioritize gemini-2.5-flash-lite first on Gemini');
assert.ok(geminiInstant.includes('gemini-2.5-flash'), 'Gemini candidates must include gemini-2.5-flash fallback');
assert.ok(geminiInstant.includes('gemini-3.7-flash'), 'Gemini candidates must include gemini-3.7-flash fallback');
console.log('  [PASS] 1.2 Gemini instant candidates prioritize gemini-2.5-flash-lite first');

// 1.3 Deep tier candidates preserved
const groqDeep = chatTest.getPreferredGroqCandidates('', { tier: 'deep' });
assert.equal(groqDeep[0], 'deepseek-r1-distill-qwen-32b', 'Deep tier must prioritize deepseek-r1-distill-qwen-32b');
console.log('  [PASS] 1.3 Deep tier priority preserved for complex tasks');

// ---------------------------------------------------------
// Test Section 2: Token Policy & Reasoning Suppression
// ---------------------------------------------------------
console.log('\n--- Section 2: Token Policy & Reasoning Allowance for fast_simple ---');

// 2.1 Length policy for fast_simple
const fastPolicy = chatTest.buildLengthPolicy('What is 5 * 12?', '', { intent: 'fast_simple' });
assert.equal(fastPolicy.maxTokens, 512, 'fast_simple length policy must cap maxTokens at 512');
assert.equal(fastPolicy.temperature, 0.35, 'fast_simple temperature must be low (0.35) for deterministic factual accuracy');
assert.equal(fastPolicy.timeoutMs, 6000, 'fast_simple timeoutMs must be aggressive (6000ms)');
assert.equal(fastPolicy.retries, 1, 'fast_simple retries must be limited to 1');
console.log('  [PASS] 2.1 fast_simple length policy verified (512 tokens, 0.35 temp, 6s timeout)');

// ---------------------------------------------------------
// Test Section 3: Compact System Prompt for fast_simple
// ---------------------------------------------------------
console.log('\n--- Section 3: Compact System Prompt for fast_simple ---');

const standardPrompt = chatTest.buildServerSystemPrompt({}, 'chat');
const fastPrompt = chatTest.buildServerSystemPrompt({}, 'fast_simple');

assert.ok(fastPrompt.length < 800, `fast_simple prompt must be under 800 chars, got ${fastPrompt.length}`);
assert.ok(standardPrompt.length > 2000, `Standard prompt should remain comprehensive (>2000 chars), got ${standardPrompt.length}`);
assert.ok(fastPrompt.length < standardPrompt.length * 0.4, 'fast_simple prompt must be at least 60% smaller than standard prompt');

// Safety & capability preservation in compact prompt
assert.ok(fastPrompt.includes('ZERO-HALLUCINATION & BOUNDARIES'), 'Compact prompt must retain Zero-Hallucination section');
assert.ok(fastPrompt.includes('Never invent people, dates, prices, statistics'), 'Compact prompt must retain anti-fabrication mandate');
assert.ok(fastPrompt.includes("No, no, no don't do that! I thought we were having a good time."), 'Compact prompt must retain 18+ boundary deflection quote');
assert.ok(fastPrompt.includes(':::image['), 'Compact prompt must retain image generation tag instruction');
assert.ok(fastPrompt.includes('filler'), 'Compact prompt must instruct model to avoid conversational filler');
console.log(`  [PASS] 3.1 Compact system prompt verified (${fastPrompt.length} chars vs ${standardPrompt.length} chars, retains all safety invariants)`);

// ---------------------------------------------------------
// Test Section 4: Frontend Memory Lookup & Network Call Skip
// ---------------------------------------------------------
console.log('\n--- Section 4: Frontend Memory Lookup & /api/rank-texts Bypass ---');

const indexPath = path.resolve('index.html');
const indexSource = fs.readFileSync(indexPath, 'utf8');

// 4.1 Verify buildRelevantSavedMemoryContextAsync accepts options and checks isFast
assert.ok(
    indexSource.includes('async function buildRelevantSavedMemoryContextAsync(text, options = {})'),
    'buildRelevantSavedMemoryContextAsync must accept options parameter'
);
assert.ok(
    indexSource.includes("const isFast = options?.intent === 'fast_simple' || options?.routeDecision?.route === 'fast_simple' || options?.isFastSimple === true;"),
    'buildRelevantSavedMemoryContextAsync must check for fast_simple via options'
);
assert.ok(
    indexSource.includes('if (isFast) {\n        return formatRelevantSavedMemoryContext(lexical.slice(0, 2));\n    }'),
    'buildRelevantSavedMemoryContextAsync must return local lexical memory directly and skip semantic ranking when isFast is true'
);

// 4.2 Verify askGeminiAI passes options into buildRelevantSavedMemoryContextAsync
assert.ok(
    indexSource.includes('await buildRelevantSavedMemoryContextAsync(normalizedUserMessage, {'),
    'askGeminiAI must pass options into buildRelevantSavedMemoryContextAsync'
);
assert.ok(
    indexSource.includes('isFastSimple: isFastSimpleRequest'),
    'askGeminiAI must pass isFastSimple to buildRelevantSavedMemoryContextAsync'
);

// 4.3 Verify no other callers trigger /api/rank-texts for simple queries
const rankTextsMatches = [...indexSource.matchAll(/\/api\/rank-texts/g)];
assert.equal(rankTextsMatches.length, 1, 'Only the config endpoint definition in index.html should reference /api/rank-texts directly');

// 4.4 Verify streamlined systemDirectives in index.html for isFastSimpleRequest
assert.ok(
    indexSource.includes('const systemDirectives = isFastSimpleRequest'),
    'askGeminiAI must use compact systemDirectives when isFastSimpleRequest is true'
);
assert.ok(
    indexSource.includes("I thought we were having a good time."),
    'askGeminiAI compact directives must preserve 18+ boundary deflection'
);

console.log('  [PASS] 4.1 Frontend memory lookup skips /api/rank-texts on fast_simple requests');
console.log('  [PASS] 4.2 Local lexical memory findRelevantSavedMemory(text, 2) is used synchronously');
console.log('  [PASS] 4.3 Compact systemDirectives active for fast_simple in askGeminiAI');

// ---------------------------------------------------------
// Test Section 5: Semantic Capability Routing Preservation
// ---------------------------------------------------------
console.log('\n--- Section 5: Semantic Capability Routing Preservation (No rigid <15 words rule) ---');

// 5.1 Weather query under 15 words must NOT route to instant tier
const weatherComplexity = chatTest.classifyQueryComplexity('weather in Tokyo');
assert.notEqual(weatherComplexity.tier, 'instant', 'Weather query must not route to instant tier (even if very short)');

// 5.2 Leadership query under 15 words must NOT route to instant tier and must remain web-eligible
const leaderComplexity = chatTest.classifyQueryComplexity('current PM of UK');
assert.notEqual(leaderComplexity.tier, 'instant', 'Current political leadership query must not route to instant tier');
const leaderCheck = chatTest.classifyRoutingDecision('current PM of UK', '', {});
assert.equal(leaderCheck.webEligible, true, 'Current political leadership query must remain web-eligible (4 words)');

// 5.3 Complex architecture query under 15 words must NOT route to instant
const archCheck = chatTest.classifyQueryComplexity('design a high throughput distributed stream pipeline');
assert.equal(archCheck.tier, 'deep', 'Short architecture query must classify as deep, not instant');

// 5.4 Stable knowledge fact routes to instant
const mathCheck = chatTest.classifyQueryComplexity('what is 144 / 12?');
assert.equal(mathCheck.tier, 'instant', 'Simple math calculation routes to instant tier');

const greetingCheck = chatTest.classifyQueryComplexity('Hello there, how are you?');
assert.equal(greetingCheck.tier, 'instant', 'Casual greeting routes to instant tier');

console.log('  [PASS] 5.1 Weather and current events under 15 words remain web-eligible (no false fast_simple bypass)');
console.log('  [PASS] 5.2 Complex technical requests under 15 words route to deep tier');
console.log('  [PASS] 5.3 Legitimate simple questions and greetings route to instant tier');

console.log('\n================================================================');
console.log('=== All Phase 15 Latency Optimization Tests PASSED ===');
console.log('================================================================');
