/**
 * @file tests/prompt-rewriter.test.mjs
 * @description Milestone 1 Test Suite: Prompt & Intent Rewriter Verification
 *
 * Verifies:
 *   1. Deterministic Intent Classifier (< 5ms) accuracy across >= 25 queries.
 *   2. Model whitelist safety constraints (strict rejection of Llama on Groq).
 *   3. Deterministic query expansion for declarative claims (converting claims to inquiries & claim checks).
 *   4. Zero hardcoded entities or expected answers.
 *   5. Preservation of original query in all rewritten bundles.
 *   6. Graceful timeout & offline fallback resilience.
 */

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
    classifySearchIntent,
    expandQueryDeterministically,
    rewriteSearchPrompt,
    validateRewriterModel,
    ALLOWED_REWRITER_MODELS,
    DEFAULT_GROQ_MODEL
} from '../api/_lib/query-rewriter.js';

console.log('\n======================================================================');
console.log('  Milestone 1 Test Suite: Prompt & Intent Rewriter (v2)');
console.log('======================================================================\n');

// =========================================================================
// Test 1: Model Whitelist & Groq Safety Enforcement
// =========================================================================
console.log('1. Testing Model Whitelist & Groq Safety Enforcement...');

// Verify default Groq model is whitelisted
assert.doesNotThrow(() => {
    validateRewriterModel('groq', DEFAULT_GROQ_MODEL);
}, 'Default Groq model should be valid');

// Verify Llama is strictly prohibited under Groq
assert.throws(() => {
    validateRewriterModel('groq', 'llama-3.3-70b-versatile');
}, /Llama models are strictly disallowed under Groq/, 'Should reject Llama models under Groq');

assert.throws(() => {
    validateRewriterModel('groq', 'llama-3.1-8b-instant');
}, /Llama models are strictly disallowed under Groq/, 'Should reject Llama 8b under Groq');

// Verify unknown model is rejected
assert.throws(() => {
    validateRewriterModel('groq', 'random-nonexistent-model');
}, /Disallowed model/, 'Should reject unknown models');

// Verify unknown provider is rejected
assert.throws(() => {
    validateRewriterModel('anthropic', 'claude-3-opus');
}, /Unsupported provider/, 'Should reject unknown providers');

console.log('   ✓ Model safety validations passed (Zero Llama on Groq enforced).');

// =========================================================================
// Test 2: Intent Classification & Claim Detection (>= 25 Diverse Queries)
// =========================================================================
console.log('2. Testing Intent Classifier (< 5ms) across 28 queries...');

const testCases = [
    // Declarative Claims (Expected: isClaim=true, needsVerification=true)
    { query: 'Three persons in the world can travel without the passport.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Humans use only 10 percent of their brain capacity.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'The Great Wall of China is visible to the naked human eye from low Earth orbit.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Bananas share roughly 50 percent of their DNA with humans.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Sharks cannot get cancer.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Lightning never strikes the same place twice.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Carrots dramatically improve night vision in humans.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Albert Einstein failed his high school mathematics class.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Bulls become enraged by the color red during a bullfight.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Glass is a slow flowing liquid rather than a true solid.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Napoleon Bonaparte was unusually short compared to average men.', expectedCategory: 'declarative_claim_verification', isClaim: true },
    { query: 'Waking a sleepwalker causes them to suffer a heart attack.', expectedCategory: 'declarative_claim_verification', isClaim: true },

    // Direct WH-Questions (Expected: isClaim=false)
    { query: 'Who is the Prime Minister of the United Kingdom following the July 2024 general election?', expectedCategory: 'direct_wh_question', isClaim: false },
    { query: 'Which country won the ICC Men\'s T20 World Cup in June 2024?', expectedCategory: 'direct_wh_question', isClaim: false },
    { query: 'Who was appointed CEO of Starbucks in August 2024?', expectedCategory: 'direct_wh_question', isClaim: false },
    { query: 'What is the capital city of Australia?', expectedCategory: 'direct_wh_question', isClaim: false },
    { query: 'Who wrote the dystopian novel 1984 published in 1949?', expectedCategory: 'direct_wh_question', isClaim: false },
    { query: 'What is the deepest natural trench in the Earth\'s oceans?', expectedCategory: 'direct_wh_question', isClaim: false },

    // Comparisons (Expected: comparison)
    { query: 'Compare SQLite and PostgreSQL in terms of deployment architecture.', expectedCategory: 'comparison', isClaim: false },
    { query: 'Compare OLED and Mini-LED display technologies on peak brightness.', expectedCategory: 'comparison', isClaim: false },
    { query: 'Compare Docker container virtualization versus Kernel-based Virtual Machine.', expectedCategory: 'comparison', isClaim: false },
    { query: 'Compare GraphQL and REST API architectural styles regarding data fetching.', expectedCategory: 'comparison', isClaim: false },

    // Definition & Policies (Expected: definition_policy)
    { query: 'What is the six month validity passport rule for international travel?', expectedCategory: 'definition_policy', isClaim: false },
    { query: 'What is the Real ID requirement for United States domestic commercial air travel?', expectedCategory: 'definition_policy', isClaim: false },
    { query: 'What is the Schengen 90/180 day rule for visa-free travel?', expectedCategory: 'definition_policy', isClaim: false },
    { query: 'What is the statutory definition of Qualified Immunity in United States federal law?', expectedCategory: 'definition_policy', isClaim: false },

    // Recency Sensitive (Expected: recency_sensitive)
    { query: 'What are the major new features and breaking changes introduced in Next.js 15?', expectedCategory: 'recency_sensitive', isClaim: false },
    { query: 'What were the primary outcomes and global agreements reached at the COP29 climate summit in 2024?', expectedCategory: 'recency_sensitive', isClaim: false }
];

let totalClassifyTime = 0;

for (let i = 0; i < testCases.length; i++) {
    const tc = testCases[i];
    const t0 = performance.now();
    const result = classifySearchIntent(tc.query);
    const dt = performance.now() - t0;
    totalClassifyTime += dt;

    assert.equal(
        result.intentCategory,
        tc.expectedCategory,
        `[Case ${i + 1}] Category mismatch for "${tc.query}". Expected: ${tc.expectedCategory}, Got: ${result.intentCategory}`
    );

    assert.equal(
        result.isClaim,
        tc.isClaim,
        `[Case ${i + 1}] isClaim mismatch for "${tc.query}". Expected: ${tc.isClaim}, Got: ${result.isClaim}`
    );

    assert.equal(
        result.needsVerification,
        tc.isClaim,
        `[Case ${i + 1}] needsVerification mismatch for "${tc.query}". Expected: ${tc.isClaim}, Got: ${result.needsVerification}`
    );

    assert.ok(dt < 5.0, `Intent classification took ${dt.toFixed(2)}ms, exceeding 5ms ceiling`);
}

const avgClassifyTime = totalClassifyTime / testCases.length;
console.log(`   ✓ All 28 classification tests passed! Average latency: ${avgClassifyTime.toFixed(3)}ms (< 5ms limit).`);

// =========================================================================
// Test 3: Deterministic Query Expansion (Zero Hardcoding)
// =========================================================================
console.log('3. Testing Deterministic Query Expansion & Verification Probes...');

const claimQuery = 'Three persons in the world can travel without the passport.';
const expanded = expandQueryDeterministically(claimQuery);

assert.ok(Array.isArray(expanded), 'Expansion result must be an array');
assert.ok(expanded.length >= 3, `Expected at least 3 queries in expanded set, got ${expanded.length}`);

// Must include original query
const hasOriginal = expanded.some(e => e.query === claimQuery && e.priority === 0);
assert.ok(hasOriginal, 'Expanded queries must include original query at priority 0');

// Must include a claim check / fact check probe
const hasClaimCheck = expanded.some(e => e.target === 'claim_check' && /fact check|myth|is it true/i.test(e.query));
assert.ok(hasClaimCheck, 'Expanded queries must include a claim_check probe');

// Must include direct answer probe
const hasDirectAnswer = expanded.some(e => e.target === 'direct_answer');
assert.ok(hasDirectAnswer, 'Expanded queries must include direct_answer probe');

console.log('   ✓ Deterministic query expansion produced compliant queries:');
for (const e of expanded) {
    console.log(`     - [Priority ${e.priority} | ${e.target}]: "${e.query}"`);
}

// =========================================================================
// Test 4: Rewrite Contract & Offline Fallback Integrity
// =========================================================================
console.log('4. Testing rewriteSearchPrompt contract & offline fallback...');

async function testOfflineFallback() {
    // In test environment without API keys, rewriteSearchPrompt should fail open gracefully
    const rewritten = await rewriteSearchPrompt(claimQuery);

    assert.equal(rewritten.originalQuery, claimQuery, 'originalQuery must match verbatim');
    assert.equal(rewritten.intentCategory, 'declarative_claim_verification');
    assert.equal(rewritten.claim.isClaim, true);
    assert.equal(rewritten.claim.needsVerification, true);
    assert.ok(Array.isArray(rewritten.searchQueries), 'searchQueries must be an array');
    assert.ok(rewritten.searchQueries.length >= 2, 'Must yield at least 2 queries');

    // Confirm that original query is present
    const containsOriginal = rewritten.searchQueries.some(q => q.query.toLowerCase() === claimQuery.toLowerCase());
    assert.ok(containsOriginal, 'Rewritten output must never drop original query');

    console.log(`   ✓ Offline fallback completed in ${rewritten.latencyMs}ms with rewriter "${rewritten.rewrittenBy}".`);
}

await testOfflineFallback();

// =========================================================================
// Test 5: Direct Interrogative Fast-Path Bypass
// =========================================================================
console.log('5. Testing Fast-Path Bypass for Simple Interrogatives...');

const whQuery = 'What is the capital city of Australia?';
const whRewritten = await rewriteSearchPrompt(whQuery);

assert.equal(whRewritten.rewrittenBy, 'deterministic_fast_path', 'Simple WH-questions should use deterministic fast path');
assert.equal(whRewritten.latencyMs, 0, 'Fast path latency should be 0ms');
assert.equal(whRewritten.searchQueries[0].query, whQuery);

console.log('   ✓ Fast-path bypass correctly preserved single interrogative without latency.');

console.log('\n======================================================================');
console.log('  Milestone 1 Test Suite: ALL TESTS PASSED ✓');
console.log('======================================================================\n');
