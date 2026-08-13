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
assert.equal(extractHostname('https://en.wikipedia.org/wiki/Main_Page'), 'en.wikipedia.org');
assert.equal(extractHostname('https://www.reuters.com/world/news-item'), 'reuters.com');
assert.equal(isTrustedDomain('en.wikipedia.org'), true);
assert.equal(isTrustedDomain('reuters.com'), true);
assert.equal(isTrustedDomain('state.gov'), true);
assert.equal(isTrustedDomain('untrusted-blog.xyz'), false);

// 2. Entity Target Extraction
const t1 = extractEntityTarget('Who is the CM of Region Alpha?');
assert.equal(t1?.role, 'Chief Minister');
assert.equal(t1?.jurisdiction, 'Region Alpha');

const t2 = extractEntityTarget('Who is the Prime Minister of France?');
assert.equal(t2?.role, 'Prime Minister');
assert.equal(t2?.jurisdiction, 'France');

const t3 = extractEntityTarget('What is the weather today?');
assert.equal(t3, null);

function fixtureSubject(value) {
    return String(value || '');
}

// 3. Temporal Status Classification (Generic Synthetic Fixtures)
const mockSnippets = [
    {
        title: fixtureSubject('Reference'),
        description: fixtureSubject('Alex Rivera is the current Chief Minister of Region Alpha, in office since May 2021.')
    },
    {
        title: fixtureSubject('Review Source'),
        description: fixtureSubject('Jordan Lee is a candidate campaigning for Chief Minister in the 2026 assembly elections.')
    }
];

const incumbentStatus = classifyTemporalStatus(fixtureSubject('Alex Rivera'), 'Chief Minister', mockSnippets, 2026);
assert.equal(incumbentStatus.status, 'incumbent');
assert.ok(incumbentStatus.confidence >= 0.7);

const candidateStatus = classifyTemporalStatus(fixtureSubject('Jordan Lee'), 'Chief Minister', mockSnippets, 2026);
assert.equal(candidateStatus.status, 'candidate');
assert.ok(candidateStatus.confidence >= 0.7);

// 4. Response Validation & Verified Source Payload
const validation = validateEntityResponse(
    'Who is the CM of Region Alpha?',
    fixtureSubject('Alex Rivera is the Chief Minister of Region Alpha.'),
    [
        {
            title: fixtureSubject('Reference'),
            url: 'https://en.wikipedia.org/wiki/Region_Alpha_Council',
            description: fixtureSubject('Alex Rivera is the serving Chief Minister of Region Alpha.')
        }
    ],
    2026
);

assert.equal(validation.entityTarget?.role, 'Chief Minister');
assert.equal(validation.entityTarget?.jurisdiction, 'Region Alpha');
assert.ok(validation.verifiedSourceData);
assert.equal(validation.verifiedSourceData.role, 'Chief Minister');
assert.equal(validation.verifiedSourceData.jurisdiction, 'Region Alpha');
assert.equal(validation.verifiedSourceData.temporalAnchorYear, 2026);
assert.ok(validation.verifiedSourceData.sources.length > 0);

console.log('entity-verifier-tests-ok');
