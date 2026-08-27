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

const sym = (prefix, i = 1) => `${prefix}_${i}`;

// 1. Hostname & Domain Checks
assert.equal(extractHostname('https://en.wikipedia.org/wiki/Main_Page'), 'en.wikipedia.org');
assert.equal(extractHostname('https://www.reuters.com/world/news-item'), 'reuters.com');
assert.equal(isTrustedDomain('en.wikipedia.org'), true);
assert.equal(isTrustedDomain('reuters.com'), true);
assert.equal(isTrustedDomain('state.gov'), true);
assert.equal(isTrustedDomain('untrusted-blog.xyz'), false);

// 2. Entity Target Extraction
const jurisdictionAlpha = `Region ${sym('Alpha', 1)}`;
const t1 = extractEntityTarget(`Who is the CM of ${jurisdictionAlpha}?`);
assert.equal(t1?.role, 'Chief Minister');
assert.equal(t1?.jurisdiction, jurisdictionAlpha);

const jurisdictionBeta = `Country ${sym('Beta', 2)}`;
const t2 = extractEntityTarget(`Who is the Prime Minister of ${jurisdictionBeta}?`);
assert.equal(t2?.role, 'Prime Minister');
assert.equal(t2?.jurisdiction, jurisdictionBeta);

const t3 = extractEntityTarget(`Query ${sym('param', 3)} status`);
assert.equal(t3, null);

// 3. Temporal Status Classification (Generic Synthetic Fixtures)
const leaderName = sym('LeaderPerson', 10);
const challengerName = sym('ChallengerPerson', 20);

const mockSnippets = [
    {
        title: sym('Source', 1),
        description: `${leaderName} is the current Chief Minister of ${jurisdictionAlpha}, in office since May 2021.`
    },
    {
        title: sym('Source', 2),
        description: `${challengerName} is a candidate campaigning for Chief Minister in the 2026 assembly elections.`
    }
];

const incumbentStatus = classifyTemporalStatus(leaderName, 'Chief Minister', mockSnippets, 2026);
assert.equal(incumbentStatus.status, 'incumbent');
assert.ok(incumbentStatus.confidence >= 0.7);

const candidateStatus = classifyTemporalStatus(challengerName, 'Chief Minister', mockSnippets, 2026);
assert.equal(candidateStatus.status, 'candidate');
assert.ok(candidateStatus.confidence >= 0.7);

// 4. Response Validation & Verified Source Payload
const validation = validateEntityResponse(
    `Who is the CM of ${jurisdictionAlpha}?`,
    `${leaderName} is the Chief Minister of ${jurisdictionAlpha}.`,
    [
        {
            title: sym('Source', 1),
            url: `https://en.wikipedia.org/wiki/${jurisdictionAlpha}`,
            description: `${leaderName} is the serving Chief Minister of ${jurisdictionAlpha}.`
        }
    ],
    2026
);

assert.equal(validation.entityTarget?.role, 'Chief Minister');
assert.equal(validation.entityTarget?.jurisdiction, jurisdictionAlpha);
assert.ok(validation.verifiedSourceData);
assert.equal(validation.verifiedSourceData.role, 'Chief Minister');
assert.equal(validation.verifiedSourceData.jurisdiction, jurisdictionAlpha);
assert.equal(validation.verifiedSourceData.temporalAnchorYear, 2026);
assert.ok(validation.verifiedSourceData.sources.length > 0);

// 5. P1: Evidence Gate & Vector Grounding Score
const query = `Who is the Chief Minister of ${jurisdictionAlpha}?`;
const relevantPassages = [
    `${leaderName} was elected Chief Minister of ${jurisdictionAlpha} in 2021 and remains the incumbent.`,
    `Official publication confirms ${leaderName} serves as the current executive head of ${jurisdictionAlpha}.`
];
const groundingRes = computeEvidenceGroundingScore(query, relevantPassages);
assert.equal(groundingRes.isGrounded, true);
assert.ok(groundingRes.score >= 0.30, 'Relevant passages must produce high grounding score');

const irrelevantPassages = [
    `Unrelated topic ${sym('alpha', 101)} in domain ${sym('beta', 102)}.`,
    `Different field ${sym('gamma', 103)} concerning parameter ${sym('delta', 104)}.`
];
const lowGroundingRes = computeEvidenceGroundingScore(query, irrelevantPassages);
assert.equal(lowGroundingRes.isGrounded, false);
assert.equal(lowGroundingRes.confidence, 'low');

// 6. P3: Claim Attribution & Proposition Grounding Verifier
const generatedText = `${leaderName} is the current Chief Minister of ${jurisdictionAlpha}. He assumed office in May 2021.`;
const attribution = verifyClaimAttributions(generatedText, relevantPassages);
assert.equal(attribution.verified, true);
assert.ok(attribution.attributionRatio >= 0.70);
assert.equal(attribution.ungroundedPropositions.length, 0);

const hallucinatedText = `${leaderName} is an unrelated athlete ${sym('token', 901)} in ${sym('token', 902)}. Directed project ${sym('token', 903)}.`;
const failedAttribution = verifyClaimAttributions(hallucinatedText, relevantPassages);
assert.equal(failedAttribution.verified, false);
assert.ok(failedAttribution.ungroundedPropositions.length > 0);

console.log('entity-verifier-tests-ok');
