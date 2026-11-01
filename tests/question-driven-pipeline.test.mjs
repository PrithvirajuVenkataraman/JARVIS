import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildDeterministicSearchQueries,
    extractComparisonEntities,
    extractQuestionAspect,
    isTechnicalDocumentationQuery,
    isSpeculativeOrUnconfirmedClaim,
    __test
} from '../api/search.js';

test('Domain 1: Software Breaking Changes & Deprecations', () => {
    const query = 'What are the breaking changes in Pydantic v2 migration?';
    const queries = buildDeterministicSearchQueries(query);
    assert.ok(queries.length >= 3, 'Must produce multiple targeted retrieval queries');

    const aspect = extractQuestionAspect(query);
    assert.match(aspect, /breaking changes?|migration/i, 'Aspect must detect breaking changes or migration');

    for (const q of queries) {
        assert.ok(!q.includes('What are the'), `Query must not retain conversational phrasing: "${q}"`);
        assert.ok(q.toLowerCase().includes('pydantic'), `Query must retain core library subject: "${q}"`);
    }

    assert.ok(
        queries.some(q => q.toLowerCase().includes('breaking changes') || q.toLowerCase().includes('migration')),
        'Must plan queries specifically searching for breaking changes or migration guide'
    );
});

test('Domain 2: Historical Date Constraint Query Planning', () => {
    const query = 'Who was the Secretary-General of the United Nations in 1968?';
    const queries = buildDeterministicSearchQueries(query);
    assert.ok(queries.length >= 2, 'Must produce queries for historical inquiry');

    for (const q of queries) {
        assert.ok(!q.includes('Who was the'), `Must strip question preamble: "${q}"`);
        assert.ok(q.toLowerCase().includes('united nations') || q.toLowerCase().includes('secretary'), `Must preserve entity/role: "${q}"`);
    }
});

test('Domain 3: New Law & Policy Effective Date Inquiries', () => {
    const query = 'What is the effective date of the EU AI Act compliance obligations?';
    const aspect = extractQuestionAspect(query);
    assert.match(aspect, /effective date|compliance/i, 'Must detect effective date or compliance aspect');

    const queries = buildDeterministicSearchQueries(query);
    assert.ok(queries.length >= 2, 'Must generate targeted regulatory queries');
    for (const q of queries) {
        assert.ok(!q.includes('What is the'), `Must strip question preamble: "${q}"`);
        assert.ok(q.toLowerCase().includes('eu ai act') || q.toLowerCase().includes('ai act'), `Must preserve policy name: "${q}"`);
        assert.ok(
            q.toLowerCase().includes('effective date') || q.toLowerCase().includes('compliance'),
            `Must query the specific regulatory aspect: "${q}"`
        );
    }
});

test('Domain 4: Multi-Criteria Comparison Dynamic Planning (EV Specs & Price)', () => {
    const query = 'Compare the battery range, charging speed, and price of Tesla Model 3 and Hyundai Ioniq 6 as of 2026.';
    const entities = extractComparisonEntities(query);
    assert.ok(entities.length >= 2, 'Must extract both EV models');
    assert.ok(entities.some(e => /tesla/i.test(e)), 'Must include Tesla Model 3');
    assert.ok(entities.some(e => /hyundai/i.test(e)), 'Must include Hyundai Ioniq 6');

    const queries = buildDeterministicSearchQueries(query);
    assert.ok(queries.length >= 4, 'Must produce comparison queries for both entities across facets');

    for (const q of queries) {
        // Critical: must NOT contain hardcoded refund policies or developer revenue split
        assert.ok(!q.toLowerCase().includes('refund policy'), `Must NOT contain hardcoded refund policy: "${q}"`);
        assert.ok(!q.toLowerCase().includes('revenue split'), `Must NOT contain hardcoded developer revenue split: "${q}"`);
        assert.ok(!q.toLowerCase().includes('developer share'), `Must NOT contain hardcoded developer share: "${q}"`);
    }

    // Must query actual comparison facets: battery range, charging speed, or price
    const hasBatteryQuery = queries.some(q => q.toLowerCase().includes('battery range') || q.toLowerCase().includes('range'));
    const hasPriceQuery = queries.some(q => q.toLowerCase().includes('price'));
    assert.ok(hasBatteryQuery || hasPriceQuery, 'Must query dynamic extracted comparison criteria (range/price)');
});

test('Domain 5: Modality & Speculative Rumor Filtering Across Domains', () => {
    const rumors = [
        'Apple is rumored to announce an ultra-thin laptop next month',
        'Company predicts massive revenue growth in upcoming quarters',
        'Analyst makes bold claim about interest rate cuts',
        'Exit polls forecast landslide victory for opposition party'
    ];

    for (const text of rumors) {
        assert.equal(
            isSpeculativeOrUnconfirmedClaim(text),
            true,
            `Must flag speculative/unconfirmed claim: "${text}"`
        );
    }

    const confirmed = [
        'Python 3.12 was released on October 2, 2023 with improved error messages.',
        'The Federal Reserve held the benchmark interest rate at 5.25%-5.50%.',
        'The Eiffel Tower was designed by Gustave Eiffel and completed in 1889.'
    ];

    for (const text of confirmed) {
        assert.equal(
            isSpeculativeOrUnconfirmedClaim(text),
            false,
            `Confirmed fact must NOT be flagged as speculative: "${text}"`
        );
    }
});

test('Domain 6: Insufficient Evidence Handling - No Fake Answers from Snippets', () => {
    const obscureQuery = 'What is the exact tensile strength of hypothetical alloy Z-99?';
    const insufficientResults = [
        {
            title: 'Hypothetical Materials in Science Fiction',
            description: 'Hypothetical Materials in Science Fiction', // Identical to title
            sourceType: 'public_source',
            url: 'https://example.org/scifi'
        },
        {
            title: 'Short snippet',
            description: 'Short snippet',
            sourceType: 'public_source',
            url: 'https://example.org/short'
        }
    ];

    const answer = __test.buildSourceDerivedAnswer(insufficientResults, { query: obscureQuery });
    assert.deepEqual(answer, {}, 'Must return empty object when evidence is insufficient rather than fabricating');
});
