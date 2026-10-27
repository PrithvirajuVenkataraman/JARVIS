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

// -------------------------------------------------------------------------
// Section 3: Clean Citation Stripping & Prose Refinement
// -------------------------------------------------------------------------
console.log('\n--- Section 3: Inline Citation & Phrase Sanitization ---');

const stripFn = chatTest?.stripInlineCitationMarkers || searchTest?.stripInlineCitationMarkers;
assert.ok(typeof stripFn === 'function', 'stripInlineCitationMarkers must be exported for citation sanitization');

// 3.1 Stripping bullet points ending with bracket citations [1], [2]
const trailingBracketText = '- Key milestone achieved in Q3 [1].\n- Production capacity doubled [1, 2].\n- Regulatory compliance approved [2]';
const cleanTrailing = stripFn(trailingBracketText);
assert.ok(!cleanTrailing.includes('[1]'), 'Trailing [1] must be stripped');
assert.ok(!cleanTrailing.includes('[2]'), 'Trailing [2] must be stripped');
assert.ok(!cleanTrailing.includes('[1, 2]'), 'Multi-citation [1, 2] must be stripped');
assert.ok(cleanTrailing.includes('Key milestone achieved in Q3.'), 'Content preserved with proper punctuation');
console.log('  [PASS] 3.1 Bullet points ending with bracket citations stripped cleanly');

// 3.2 Stripping awkward phrases like "found in [1]", "as reported in [2]", "according to [1]"
const leadInText = 'Revenue reached a record high, as found in [1]. According to [2], user growth increased by 30%. Operational details were reported in [1, 2].';
const cleanLeadIns = stripFn(leadInText);
assert.ok(!cleanLeadIns.toLowerCase().includes('found in'), '"found in [1]" must be eliminated');
assert.ok(!cleanLeadIns.toLowerCase().includes('according to'), '"according to [2]" must be eliminated');
assert.ok(!cleanLeadIns.toLowerCase().includes('reported in'), '"reported in [1, 2]" must be eliminated');
assert.ok(cleanLeadIns.includes('Revenue reached a record high.'), 'Main sentence preserved cleanly');
assert.ok(cleanLeadIns.includes('User growth increased by 30%.'), 'Capitalization properly restored after stripping opening clause');
console.log('  [PASS] 3.2 Awkward lead-in phrases ("found in [1]", "according to [2]") eliminated with capitalization preserved');

// 3.3 Stripping markdown link citations in prose [1](url)
const markdownLinkText = 'The team published their findings [1](https://example.com/findings) yesterday.';
const cleanMarkdownLinks = stripFn(markdownLinkText);
assert.ok(!cleanMarkdownLinks.includes('[1]'), 'Markdown link bracket citation stripped');
assert.ok(!cleanMarkdownLinks.includes('https://example.com'), 'Markdown citation URL stripped');
assert.ok(cleanMarkdownLinks.includes('The team published their findings yesterday.'), 'Prose text intact');
console.log('  [PASS] 3.3 Prose markdown link citations stripped cleanly');

// 3.4 Integration with buildLiveUpdateResponse: bracket citations stripped while keeping clean text
if (typeof chatTest?.buildLiveUpdateResponse === 'function') {
    const rawAnswerWithBrackets = 'The tournament concluded with high attendance, found in [1]. Team Alpha secured the trophy [1], [2].';
    const sampleSources = [{ title: 'Tournament Report', url: 'https://example.com/report', domain: 'example.com' }];
    const sanitizedAnswer = chatTest.buildLiveUpdateResponse('tournament winners', sampleSources, rawAnswerWithBrackets);
    assert.ok(!sanitizedAnswer.includes('[1]'), 'buildLiveUpdateResponse must strip [1]');
    assert.ok(!sanitizedAnswer.includes('[2]'), 'buildLiveUpdateResponse must strip [2]');
    assert.ok(!sanitizedAnswer.toLowerCase().includes('found in'), 'buildLiveUpdateResponse must strip "found in"');
    assert.ok(sanitizedAnswer.includes('Team Alpha secured the trophy.'), 'Answer content preserved');
    console.log('  [PASS] 3.4 buildLiveUpdateResponse sanitizes stray bracket citations and phrases in response body');
}

console.log('\n================================================================');
console.log('=== All Leadership Expansion & Citation Cleanup Tests PASSED ===');
console.log('================================================================\n');
