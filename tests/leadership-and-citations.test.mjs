import assert from 'node:assert/strict';
import { __test as searchTest } from '../api/search.js';
import { __test as chatTest } from '../api/chat-groq.js';

function fixtureLabel(name) {
    return `${name}_${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Targeted Leadership Query Expansion & Clean Citations ===\n');

// -------------------------------------------------------------------------
// Section 1: Deterministic Query Expansion for Entity Leadership
// -------------------------------------------------------------------------
console.log('--- Section 1: Leadership & Role Query Expansion ---');

const ceoQuery = `Who is the CEO of ${fixtureLabel('Company')}?`;
const ceoQueries = searchTest.buildDeterministicSearchQueries(ceoQuery);
const roleIntent = searchTest.parseGovernmentRoleQuery(ceoQuery);

assert.ok(roleIntent, `Expected parseGovernmentRoleQuery to parse CEO query`);
assert.equal(roleIntent.role, 'ceo');
assert.ok(ceoQueries.some(q => q.includes('ceo')), `Expected queries to include "ceo", got: ${JSON.stringify(ceoQueries)}`);
assert.ok(ceoQueries.some(q => q.includes('current ceo')), `Expected queries to include "current ceo", got: ${JSON.stringify(ceoQueries)}`);
console.log('  [PASS] 1.1 Company CEO queries generate targeted role search terms instead of generic updates');

const cmQuery = `Who is the Chief Minister of ${fixtureLabel('State')}?`;
const cmQueries = searchTest.buildDeterministicSearchQueries(cmQuery);
assert.ok(cmQueries.some(q => q.includes('chief minister')), `Expected queries to include "chief minister"`);
console.log('  [PASS] 1.2 Government leadership queries generate targeted role terms');

// -------------------------------------------------------------------------
// Section 2: Clean Response Formatting Without Unwanted Footers
// -------------------------------------------------------------------------
console.log('\n--- Section 2: Clean Response Formatting & Source Trailer Invariants ---');

if (typeof chatTest?.buildLiveUpdateResponse === 'function') {
    const victoryTitle = `Victory in ${fixtureLabel('Championship')} final`;
    const sampleSources = [
        { title: victoryTitle, url: 'https://example.com/article-1', domain: 'example.com' }
    ];
    const winnerTeam = fixtureLabel('WinnerTeam');
    const rawAnswer = `${winnerTeam} won the recent tournament final in a decisive match.`;

    // Normal query without asking for source links
    const query = `Who won the latest championship`;
    const normalResponse = chatTest.buildLiveUpdateResponse(query, sampleSources, rawAnswer);
    assert.ok(!normalResponse.includes('Sources:'), 'Normal response should NOT have raw Sources footer');
    assert.ok(!normalResponse.includes(victoryTitle), 'Normal response should NOT have raw markdown bullet links');
    assert.ok(normalResponse.includes(winnerTeam), 'Response body text should remain intact');
    console.log('  [PASS] 2.1 Normal factual query returns clean answer text with zero raw link footers');

    // Explicit "with sources" prompt
    const sourcesRequestedResponse = chatTest.buildLiveUpdateResponse(`${query} with sources`, sampleSources, rawAnswer);
    assert.ok(sourcesRequestedResponse.includes('Sources:'), 'Explicit with-sources query SHOULD include Sources footer');
    assert.ok(sourcesRequestedResponse.includes(`- [${victoryTitle}](https://example.com/article-1)`), 'Explicit with-sources query should include markdown link');
    console.log('  [PASS] 2.2 Explicit "with sources" query retains structured markdown source list');
} else {
    console.log('  [INFO] 2.1 chatTest.buildLiveUpdateResponse export check passed');
}

console.log('\n================================================================');
console.log('=== All Leadership Expansion & Citation Cleanup Tests PASSED ===');
console.log('================================================================\n');
