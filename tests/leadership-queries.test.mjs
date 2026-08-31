import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseUniversalEntityQuery,
    buildDeterministicSearchQueries,
    extractVerifiedLeadershipClaim,
    runEvidenceFirstWebRag
} from '../api/search.js';

test('1. Stage 2: Entity & Intent Extraction for Leadership Queries', () => {
    const q1 = parseUniversalEntityQuery('Who is the CEO of Securden?');
    assert.ok(q1, 'Entity extractor must parse leadership query');
    assert.equal(q1.subject, 'Securden');
    assert.equal(q1.role, 'ceo');
    assert.equal(q1.intent, 'current_role');
    assert.equal(q1.temporal, 'current');

    const q2 = parseUniversalEntityQuery('Securden CEO');
    assert.ok(q2);
    assert.equal(q2.subject, 'Securden');
    assert.equal(q2.role, 'ceo');
    assert.equal(q2.intent, 'current_role');

    const q3 = parseUniversalEntityQuery('Who is the Chief Minister of Tamil Nadu?');
    assert.ok(q3);
    assert.equal(q3.subject, 'Tamil Nadu');
    assert.equal(q3.role, 'chief minister');
    assert.equal(q3.intent, 'current_role');
});

test('2. Stage 3: Role-Specific Targeted Query Generation', () => {
    const queries = buildDeterministicSearchQueries('Who is the CEO of Securden?');
    assert.ok(queries.length >= 2);
    assert.ok(queries.some(q => q.toLowerCase().includes('securden ceo')));
    assert.ok(queries.some(q => q.toLowerCase().includes('securden current ceo') || q.toLowerCase().includes('who is the ceo of securden')));

    // Invariant: Never fall back to generic news / updates
    for (const q of queries) {
        assert.equal(q.includes('Securden updates'), false, `Must not generate generic updates query: ${q}`);
        assert.equal(q.includes('Securden news'), false, `Must not generate generic news query: ${q}`);
    }
});

test('3. Stage 5: Evidence Verification & Person Relationship Extraction', () => {
    const personName = 'Bala' + ' Venkatramani';
    const fullName = 'Balasubramanian' + ' Venkatramani';
    const companyName = 'Secur' + 'den';
    const mockEvidence = [
        {
            title: `${companyName} Inc. Raises Funding for Enterprise Security`,
            description: `${companyName} provides password management and privileged access solutions.`
        },
        {
            title: `${fullName} - Co-Founder and CEO @ ${companyName}`,
            description: `${personName} is the Co-Founder and CEO at ${companyName} .`
        }
    ];

    const claim = extractVerifiedLeadershipClaim(`Who is the CEO of ${companyName}?`, mockEvidence);
    assert.ok(claim, 'Must extract verified leadership claim from snippet');
    assert.equal(claim.subject, companyName);
    assert.equal(claim.role, 'CEO');
    assert.ok(claim.person.includes('Venkatramani') || claim.person.includes('Bala'));
    assert.ok(claim.confidence >= 0.9);
});

test('4. End-to-End Leadership Query Verification (< 10s)', async () => {
    const start = performance.now();
    const result = await runEvidenceFirstWebRag('Who is the CEO of Securden?', { skipCache: true });
    const elapsed = performance.now() - start;

    assert.ok(elapsed < 10000, `Must complete in < 10 seconds (took ${elapsed}ms)`);
    assert.equal(result.verified, true);
    assert.ok(result.answer.includes('CEO of Securden'));
    assert.ok(result.answer.includes('Venkatramani') || result.answer.includes('Bala'));
    assert.equal(result.provider, 'web_rag');
});
