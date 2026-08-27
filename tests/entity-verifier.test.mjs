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
    vectorCosineSimilarity,
    FeedForwardNeuralNetwork
} from '../api/_lib/entity-verifier.js';

console.log('--- Testing Entity Verifier & Grounding Engine (Property-Based & Invariants) ---');

// Procedural seed-based token and symbol generator
const randStr = (seed, len = 8) => {
    let s = seed;
    let res = '';
    for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) | 0;
        res += String.fromCharCode(97 + (Math.abs(s) % 26));
    }
    return res;
};

// ============================================================================
// Invariant 1: Vector Space Normalization & Unit Norm Property
// ============================================================================
for (let seed = 1; seed <= 10; seed++) {
    const text = `${randStr(seed, 6)} ${randStr(seed + 100, 8)} ${randStr(seed + 200, 10)}`;
    const vec = textToEmbeddingVector(text);
    assert.equal(vec.length, 512);

    let normSq = 0;
    for (let i = 0; i < vec.length; i++) normSq += vec[i] * vec[i];
    const norm = Math.sqrt(normSq);
    assert.ok(Math.abs(norm - 1.0) < 1e-4 || norm === 0, 'Vector must satisfy unit-norm invariant');
}

// ============================================================================
// Invariant 2: Cosine Similarity Symmetry & Boundedness [-1, 1]
// ============================================================================
for (let seed = 10; seed <= 20; seed++) {
    const v1 = textToEmbeddingVector(randStr(seed, 12));
    const v2 = textToEmbeddingVector(randStr(seed + 50, 12));

    const sim12 = vectorCosineSimilarity(v1, v2);
    const sim21 = vectorCosineSimilarity(v2, v1);
    assert.ok(Math.abs(sim12 - sim21) < 1e-6, 'Cosine similarity must be strictly symmetric');
    assert.ok(sim12 >= -1.0001 && sim12 <= 1.0001, 'Cosine similarity must be bounded in [-1, 1]');

    const selfSim = vectorCosineSimilarity(v1, v1);
    assert.ok(Math.abs(selfSim - 1.0) < 1e-4, 'Self-similarity must equal 1.0');
}

// ============================================================================
// Invariant 3: Hostname Parsing & Trusted Domain Invariants
// ============================================================================
for (let i = 1; i <= 5; i++) {
    const dom = `${randStr(i * 11, 8)}.gov`;
    assert.equal(isTrustedDomain(dom), true, '.gov domains must always satisfy trust invariant');
    assert.equal(extractHostname(`https://www.${dom}/path/to/resource`), dom);
}
assert.equal(isTrustedDomain(`${randStr(99, 8)}.xyz`), false);

// ============================================================================
// Invariant 4: Universal Grammar Officeholder Extraction Invariant
// ============================================================================
for (let i = 1; i <= 5; i++) {
    const place = `${randStr(i * 31, 8)}`;
    const extracted = extractEntityTarget(`Who is the CEO of ${place}?`);
    assert.ok(extracted, 'Officeholder query must resolve an entity target');
    assert.ok(typeof extracted.role === 'string' && extracted.role.length > 0);
    assert.ok(typeof extracted.jurisdiction === 'string' && extracted.jurisdiction.length > 0);
}

// Non-officeholder query invariant
const nonTarget = extractEntityTarget(`Query ${randStr(42, 10)} status without target`);
assert.equal(nonTarget, null, 'Non-entity query must evaluate to null target');

// ============================================================================
// Invariant 5: Grounding Score Monotonicity Property
// ============================================================================
const sharedCorpus = randStr(500, 40);
const matchingPassage = `Domain report containing ${sharedCorpus} reference data.`;
const matchingScore = computeEvidenceGroundingScore(sharedCorpus, [matchingPassage]);
const disjointScore = computeEvidenceGroundingScore(sharedCorpus, [`Completely disjoint string ${randStr(800, 30)}.`]);

assert.ok(matchingScore.score > disjointScore.score, 'Matching passages must have strictly higher grounding score than disjoint passages');
assert.equal(matchingScore.isGrounded, true);
assert.equal(disjointScore.isGrounded, false);

// ============================================================================
// Invariant 6: Feed-Forward Neural Network Backpropagation Convergence Invariant
// ============================================================================
const nn = new FeedForwardNeuralNetwork(512, 64, 4, 777);
const inputVec = textToEmbeddingVector(`neural test sequence ${randStr(333, 10)}`);
const targetClass = 0; 

const initialP = nn.forward(inputVec).probabilities[targetClass];
for (let step = 0; step < 25; step++) {
    nn.trainStep(inputVec, targetClass, 0.15);
}
const convergedP = nn.forward(inputVec).probabilities[targetClass];

assert.ok(convergedP > initialP, 'Backpropagation gradient descent must monotonically increase target class probability');
assert.ok(convergedP >= 0.80, 'Backpropagation must converge target class probability >= 0.80');

// Softmax probability sum invariant
const probs = nn.forward(inputVec).probabilities;
let pSum = 0;
for (let i = 0; i < probs.length; i++) pSum += probs[i];
assert.ok(Math.abs(pSum - 1.0) < 1e-4, 'Neural output probabilities must sum to 1.0');

console.log('entity-verifier-tests-ok');
