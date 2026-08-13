import assert from 'node:assert/strict';
import {
    extractHostname,
    isTrustedDomain,
    extractEntityTarget,
    classifyTemporalStatus,
    validateEntityResponse
} from '../api/_lib/entity-verifier.js';

console.log('--- Testing Entity Verifier ---');

// 1. Hostname & Domain Checks
assert.equal(extractHostname('https://en.wikipedia.org/wiki/Tamil_Nadu'), 'en.wikipedia.org');
assert.equal(extractHostname('https://www.reuters.com/world/india/article'), 'reuters.com');
assert.equal(isTrustedDomain('en.wikipedia.org'), true);
assert.equal(isTrustedDomain('reuters.com'), true);
assert.equal(isTrustedDomain('tn.gov.in'), true);
assert.equal(isTrustedDomain('untrusted-blog.xyz'), false);

// 2. Entity Target Extraction
const t1 = extractEntityTarget('Who is the CM of Tamil Nadu?');
assert.equal(t1?.role, 'Chief Minister');
assert.equal(t1?.jurisdiction, 'Tamil Nadu');

const t2 = extractEntityTarget('Who is the Prime Minister of India?');
assert.equal(t2?.role, 'Prime Minister');
assert.equal(t2?.jurisdiction, 'India');

const t3 = extractEntityTarget('What is the weather today?');
assert.equal(t3, null);

// 3. Temporal Status Classification
const mockSnippets = [
    {
        title: 'M. K. Stalin - Wikipedia',
        description: 'M. K. Stalin is an Indian politician who is the current and 8th Chief Minister of Tamil Nadu, serving since May 7, 2021.'
    },
    {
        title: 'Vijay (actor) - TVK',
        description: 'In February 2024, Vijay founded the political party Tamilaga Vettri Kazhagam (TVK) as candidate to contest the 2026 assembly elections.'
    }
];

const stalinStatus = classifyTemporalStatus('M. K. Stalin', 'Chief Minister', mockSnippets, 2026);
assert.equal(stalinStatus.status, 'incumbent');
assert.ok(stalinStatus.confidence >= 0.7);

const vijayStatus = classifyTemporalStatus('Vijay', 'Chief Minister', mockSnippets, 2026);
assert.equal(vijayStatus.status, 'candidate');
assert.ok(vijayStatus.confidence >= 0.7);

// 4. Response Validation & Verified Source Payload
const validation = validateEntityResponse(
    'Who is the CM of Tamil Nadu?',
    'M. K. Stalin is the Chief Minister of Tamil Nadu.',
    [
        {
            title: 'Tamil Nadu Ministers',
            url: 'https://en.wikipedia.org/wiki/Tamil_Nadu_Council_of_Ministers',
            description: 'M. K. Stalin is the serving Chief Minister of Tamil Nadu.'
        }
    ],
    2026
);

assert.equal(validation.entityTarget?.role, 'Chief Minister');
assert.equal(validation.entityTarget?.jurisdiction, 'Tamil Nadu');
assert.ok(validation.verifiedSourceData);
assert.equal(validation.verifiedSourceData.role, 'Chief Minister');
assert.equal(validation.verifiedSourceData.jurisdiction, 'Tamil Nadu');
assert.equal(validation.verifiedSourceData.temporalAnchorYear, 2026);
assert.ok(validation.verifiedSourceData.sources.length > 0);

console.log('entity-verifier-tests-ok');
