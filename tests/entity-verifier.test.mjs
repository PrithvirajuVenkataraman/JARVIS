import assert from 'node:assert/strict';
import {
    extractHostname,
    isTrustedDomain,
    extractEntityTarget,
    classifyTemporalStatus,
    validateEntityResponse,
    computeEvidenceGroundingScore,
    verifyClaimAttributions,
    textToEmbeddingVector,
    vectorCosineSimilarity
} from '../api/_lib/entity-verifier.js';

console.log('--- Testing Entity Verifier & Grounding Engine ---');

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

// 5. P1: Evidence Gate & Vector Grounding Score
const query = 'Who is the Chief Minister of Region Alpha?';
const relevantPassages = [
    'Alex Rivera was elected Chief Minister of Region Alpha in 2021 and remains the incumbent.',
    'Government gazette confirms Alex Rivera serves as the current executive head of Region Alpha.'
];
const groundingRes = computeEvidenceGroundingScore(query, relevantPassages);
assert.equal(groundingRes.isGrounded, true);
assert.ok(groundingRes.score >= 0.35, 'Relevant passages must produce high grounding score');

const irrelevantPassages = [
    'The gravitational constant is an empirical physical constant used in gravitational physics.',
    'Photosynthesis is a biological process used by plants to convert light energy into chemical energy.'
];
const lowGroundingRes = computeEvidenceGroundingScore(query, irrelevantPassages);
assert.equal(lowGroundingRes.isGrounded, false);
assert.equal(lowGroundingRes.confidence, 'low');

// 6. P3: Claim Attribution & Proposition Grounding Verifier
const generatedText = 'Alex Rivera is the current Chief Minister of Region Alpha. He assumed office in May 2021.';
const attribution = verifyClaimAttributions(generatedText, relevantPassages);
assert.equal(attribution.verified, true);
assert.ok(attribution.attributionRatio >= 0.70);
assert.equal(attribution.ungroundedPropositions.length, 0);

const hallucinatedText = 'Alex Rivera is an Olympic swimming champion who won gold in Paris 2024. He also directed a Hollywood film.';
const failedAttribution = verifyClaimAttributions(hallucinatedText, relevantPassages);
assert.equal(failedAttribution.verified, false);
assert.ok(failedAttribution.ungroundedPropositions.length > 0);

console.log('entity-verifier-tests-ok');
