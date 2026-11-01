/**
 * @file tests/information-gain-reranker.test.mjs
 * @description Milestone 3 Test Suite: Information-Gain Reranker Verification
 *
 * Verifies:
 *   1. Entity density calculation (D_entity): rewarding named entities, proper nouns, and numbers.
 *   2. Cross-source agreement calculation (A_agree): rewarding corroboration across multiple publishers.
 *   3. Query echo penalty (P_echo): penalizing snippet-title repetition and query echoing (Jaccard >= 0.70).
 *   4. Formula execution: S_final = S_lexical + beta*D_entity + delta*A_agree + epsilon*R_source - gamma*P_echo.
 *   5. Informative articles outranking repetitive teaser clickbait headlines.
 */

import assert from 'node:assert/strict';
import {
    tokenJaccardSimilarity,
    computeEntityDensity,
    computeCrossSourceAgreement,
    computeQueryEchoPenalty,
    scoreSourcesBM25AndSemantic,
    normalizeResearchSources
} from '../app/bounded-live-research.js';

console.log('\n======================================================================');
console.log('  Milestone 3 Test Suite: Information-Gain Reranker Verification');
console.log('======================================================================\n');

// =========================================================================
// Test 1: Query Echo Penalty (P_echo)
// =========================================================================
console.log('1. Testing Query Echo Penalty (P_echo)...');

const query = 'Three persons in the world can travel without the passport.';

// Echoing teaser snippet (nearly exact match of user prompt)
const echoSnippet = 'Three persons in the world can travel without the passport. Find out who they are.';
const echoTitle = 'Three persons in the world can travel without the passport';

const echoPenalty = computeQueryEchoPenalty(echoSnippet, echoTitle, query);
assert.equal(echoPenalty, 1.0, 'Echoing teaser snippet must trigger echo penalty = 1.0');

// Near-title snippet (snippet is identical to title)
const identicalTitleSnippet = 'Travel news and passport updates';
const identicalTitle = 'Travel news and passport updates';
assert.equal(computeQueryEchoPenalty(identicalTitleSnippet, identicalTitle, 'visa rules'), 1.0, 'Snippet matching title exactly must trigger echo penalty');

// Informative snippet (answers the question with names and context)
const informativeSnippet = 'The British monarch, King Charles III, along with Emperor Naruhito and Empress Masako of Japan, cross international borders under sovereign diplomatic exception without passports.';
const informativeTitle = 'Sovereign Diplomatic Exemption from International Passports';

const nonEchoPenalty = computeQueryEchoPenalty(informativeSnippet, informativeTitle, query);
assert.equal(nonEchoPenalty, 0.0, 'Informative snippet must not trigger echo penalty (expected 0.0)');

console.log('   ✓ Query echo penalty correctly identifies clickbait echoes vs informative text.');

// =========================================================================
// Test 2: Entity Density (D_entity)
// =========================================================================
console.log('2. Testing Entity Density (D_entity)...');

const lowEntityTeaser = 'These people can go anywhere around the world and you will never believe how they do it or what happens next.';
const highEntityBody = 'In July 2024, Prime Minister Keir Starmer appointed Rachel Reeves as Chancellor of the Exchequer, representing the 650 constituencies of the United Kingdom.';

const lowDensity = computeEntityDensity(lowEntityTeaser);
const highDensity = computeEntityDensity(highEntityBody);

assert.ok(highDensity > lowDensity * 2, `High entity text (${highDensity.toFixed(3)}) must have significantly higher density than teaser (${lowDensity.toFixed(3)})`);
console.log(`   ✓ Entity density verified: Teaser = ${lowDensity.toFixed(3)} | Informative = ${highDensity.toFixed(3)}`);

// =========================================================================
// Test 3: Cross-Source Agreement (A_agree)
// =========================================================================
console.log('3. Testing Cross-Source Agreement (A_agree)...');

const candidateGroup = [
    {
        title: 'Monarch Passport Rules',
        snippet: 'King Charles III and Emperor Naruhito do not need passports under diplomatic convention.',
        url: 'https://source-a.org'
    },
    {
        title: 'British Foreign Office Protocol',
        snippet: 'Under royal prerogative, King Charles III travels without a passport.',
        url: 'https://source-b.org'
    },
    {
        title: 'Japanese Imperial Household Guide',
        snippet: 'Emperor Naruhito and Empress Masako do not hold Japanese passports for overseas travel.',
        url: 'https://source-c.org'
    },
    {
        title: 'Random Travel Blog',
        snippet: 'Pack your bags with lightweight clothing for your summer European adventure.',
        url: 'https://source-d.org'
    }
];

const agreementCandidate0 = computeCrossSourceAgreement(candidateGroup[0], candidateGroup, 0);
const agreementCandidate3 = computeCrossSourceAgreement(candidateGroup[3], candidateGroup, 3);

assert.ok(agreementCandidate0 > 0.3, `Corroborated candidate must receive agreement bonus, got ${agreementCandidate0}`);
assert.equal(agreementCandidate3, 0.0, `Uncorroborated candidate should receive 0 agreement bonus, got ${agreementCandidate3}`);

console.log(`   ✓ Cross-source agreement verified: Corroborated = ${agreementCandidate0.toFixed(3)} | Isolated = ${agreementCandidate3.toFixed(3)}`);

// =========================================================================
// Test 4: End-to-End Information-Gain Reranking
// =========================================================================
console.log('4. Testing Full Information-Gain Reranker vs Echo Paradox...');

const candidates = [
    // Candidate 1: Clickbait title repeater (BM25 echo winner, but zero information)
    {
        title: 'Three persons in the world can travel without the passport.',
        snippet: 'Three persons in the world can travel without the passport. Click here to read more.',
        domain: 'clickbait-central.com',
        url: 'https://clickbait-central.com/post-1',
        trusted: false
    },
    // Candidate 2: Substantive informative article (Answers the claim with sovereign names)
    {
        title: 'Why Sovereign Heads of State Do Not Carry Passports',
        snippet: 'King Charles III of the United Kingdom and Emperor Naruhito and Empress Masako of Japan travel internationally under established sovereign privilege.',
        fullArticleText: 'Under international diplomatic law and British constitutional tradition, passports are issued in the name of the sovereign. King Charles III and Emperor Naruhito with Empress Masako are exempt from holding passports.',
        domain: 'international-law-review.org',
        url: 'https://international-law-review.org/sovereign-exemptions',
        trusted: true
    }
];

scoreSourcesBM25AndSemantic(candidates, query);

const echoCandidate = candidates[0];
const informativeCandidate = candidates[1];

console.log('   Candidate 1 (Clickbait echo):', {
    bm25: echoCandidate.bm25Score,
    entityDensity: echoCandidate.entityDensity,
    echoPenalty: echoCandidate.echoPenalty,
    hybridScore: echoCandidate.hybridScore
});

console.log('   Candidate 2 (Informative article):', {
    bm25: informativeCandidate.bm25Score,
    entityDensity: informativeCandidate.entityDensity,
    echoPenalty: informativeCandidate.echoPenalty,
    hybridScore: informativeCandidate.hybridScore
});

assert.ok(
    informativeCandidate.hybridScore > echoCandidate.hybridScore,
    `Informative candidate (${informativeCandidate.hybridScore}) must outrank echo teaser (${echoCandidate.hybridScore})`
);

// Verify ranking in normalizeResearchSources
const normalized = normalizeResearchSources(candidates, query, 2);
assert.equal(normalized[0].domain, 'international-law-review.org', 'Informative article must take Rank 1');
assert.equal(normalized[1].domain, 'clickbait-central.com', 'Teaser must be demoted to Rank 2');

console.log('   ✓ Informative article successfully overtook clickbait teaser at Rank 1!');

console.log('\n======================================================================');
console.log('  Milestone 3 Test Suite: ALL TESTS PASSED ✓');
console.log('======================================================================\n');
