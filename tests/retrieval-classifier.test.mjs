import assert from 'node:assert/strict';
import { classifyRetrievalDecision, classifyDeterministicRetrievalIntent, resolveRetrievalRoute } from '../api/search.js';

console.log('=== Testing Unified Retrieval Classifier & Intent Routing ===\n');

// -------------------------------------------------------------------------
// Section 1: Live Time-Sensitive Queries -> needs_live_search (temporal: true)
// -------------------------------------------------------------------------
console.log('--- Section 1: Live & Changing Intent Queries ---');

const liveQueries = [
    'Who is the current CM of Tamil Nadu?',
    "Who is India's current Prime Minister?",
    'What is the current captain of CSK?',
    'Who won the latest FIFA cup',
    'Current price of Bitcoin',
    'Weather forecast in Tokyo today',
    'Who won the last Super Bowl',
    'Latest election results in the UK'
];

for (const query of liveQueries) {
    const res = await classifyRetrievalDecision(query);
    assert.equal(res.decision, 'needs_live_search', `Expected needs_live_search for: "${query}", got: ${res.decision}`);
    assert.equal(res.temporal, true, `Expected temporal: true for: "${query}"`);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0, `Expected non-empty reason for: "${query}"`);
    assert.ok(res.confidence >= 0.5, `Expected confidence >= 0.5 for: "${query}"`);

    const route = await resolveRetrievalRoute(query);
    assert.equal(route.route, 'live_required', `Expected route: live_required for "${query}"`);
    console.log(`  [PASS] Live: "${query}" -> ${res.decision} (temporal: ${res.temporal})`);
}

// -------------------------------------------------------------------------
// Section 2: Stable Knowledge & Cultural Concepts -> stable_answer (temporal: false)
// -------------------------------------------------------------------------
console.log('\n--- Section 2: Stable Knowledge, Concepts, Math & Education ---');

const stableQueries = [
    'What is Inat?',
    'What does Inat mean in Serbian culture?',
    'What is photosynthesis?',
    'Explain RAG.',
    'What is the capital of Serbia?',
    'Who wrote this poem?',
    'Explain binary search in Python',
    'What is the Pythagorean theorem?',
    'Define polymorphism in object oriented programming',
    'Translate hello to French'
];

for (const query of stableQueries) {
    const res = await classifyRetrievalDecision(query);
    assert.equal(res.decision, 'stable_answer', `Expected stable_answer for: "${query}", got: ${res.decision}`);
    assert.equal(res.temporal, false, `Expected temporal: false for: "${query}"`);
    assert.ok(typeof res.reason === 'string' && res.reason.length > 0, `Expected non-empty reason for: "${query}"`);

    const route = await resolveRetrievalRoute(query);
    assert.equal(route.route, 'llm', `Expected route: llm for "${query}"`);
    console.log(`  [PASS] Stable: "${query}" -> ${res.decision} (temporal: ${res.temporal})`);
}

// -------------------------------------------------------------------------
// Section 3: Strict Schema Compliance
// -------------------------------------------------------------------------
console.log('\n--- Section 3: Strict JSON Schema Invariant ---');

const sampleRes = await classifyRetrievalDecision('What is photosynthesis?');
const requiredKeys = ['decision', 'confidence', 'reason', 'temporal'];
for (const key of requiredKeys) {
    assert.ok(key in sampleRes, `Missing required key "${key}" in classifier response`);
}
assert.ok(['needs_live_search', 'stable_answer'].includes(sampleRes.decision));
assert.equal(typeof sampleRes.confidence, 'number');
assert.equal(typeof sampleRes.reason, 'string');
assert.equal(typeof sampleRes.temporal, 'boolean');

console.log('  [PASS] Output conforms strictly to {"decision", "confidence", "reason", "temporal"}');

console.log('\n================================================================');
console.log('=== All Retrieval Classifier Intent Routing Tests PASSED ===');
console.log('================================================================\n');
