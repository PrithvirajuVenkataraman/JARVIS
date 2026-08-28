import assert from 'node:assert/strict';
import { buildCacheKey, getCachedRAGEntry, setCachedRAGEntry, clearL1CacheForTesting } from '../api/_lib/distributed-cache.js';
import { computeBM25Scores, hybridRerank } from '../api/_lib/hybrid-reranker.js';
import { buildParentChildChunks, expandChildMatchesToParentContext } from '../api/_lib/parent-child-chunker.js';
import { evaluateContextRelevance, evaluateGroundedness, evaluateAnswerRelevance, computeRagTriadEvaluation } from '../api/_lib/rag-triad-evaluator.js';
import { renderMarkdown } from '../app/markdown-renderer.js';

function fixtureSubject(label) {
    return `Fixture ${label} ${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Production RAG & Triad Evaluation Suite ===\n');

// Section 1: Distributed & Edge Caching
console.log('--- Section 1: Distributed & Edge Caching Layer ---');
clearL1CacheForTesting();

const mockQuery = `who is the officer of ${fixtureSubject('Org')}`;
const mockAnswer = `Fixture Officer is the current officer of ${fixtureSubject('Org')}.`;
const testKey = buildCacheKey('test_rag', mockQuery);
assert.ok(testKey.startsWith('test_rag:'));

const initialMiss = await getCachedRAGEntry(testKey);
assert.equal(initialMiss, null);

await setCachedRAGEntry(testKey, { verified: true, answer: mockAnswer }, 5000);
const hitResult = await getCachedRAGEntry(testKey);
assert.ok(hitResult);
assert.equal(hitResult.hit, true);
assert.equal(hitResult.tier, 'L1_memory');
assert.equal(hitResult.data.answer, mockAnswer);
console.log('  [PASS] 1.1 L1 in-memory fast caching hit verified');

// SWR Stale validation
await setCachedRAGEntry('swr_key', { verified: true, answer: 'Stale test' }, -10); // already expired
const swrHit = await getCachedRAGEntry('swr_key');
assert.ok(swrHit);
assert.equal(swrHit.stale, true);
console.log('  [PASS] 1.2 Stale-While-Revalidate (SWR) grace window verified');

// Section 2: In-Process Hybrid Reranking (BM25 + RRF)
console.log('\n--- Section 2: In-Process Hybrid Reranking (BM25 + RRF) ---');

const docs = [
    { title: 'Fixture Forecast Item', description: 'Weather report with sunshine in the morning.', url: 'https://fixture-weather.example' },
    { title: 'Fixture Rocket Mission', description: 'Orbital aerospace rocket system launch update.', url: 'https://fixture-space.example' },
    { title: 'Fixture Hardware Review', description: 'Computing processor silicon architecture overview.', url: 'https://fixture-tech.example' }
];

const bm25Scores = computeBM25Scores('Fixture Rocket Mission launch', docs);
assert.ok(bm25Scores[1] > bm25Scores[0]);
assert.ok(bm25Scores[1] > bm25Scores[2]);
console.log('  [PASS] 2.1 BM25 term frequency / inverse document frequency scoring verified');

const reranked = await hybridRerank('Fixture Rocket Mission launch', docs, { skipEmbedding: true });
assert.equal(reranked[0].url, 'https://fixture-space.example');
assert.ok(reranked[0].rrfScore > reranked[1].rrfScore);
console.log('  [PASS] 2.2 Reciprocal Rank Fusion (RRF) ranking verified');

// Section 3: Parent-Child Hierarchical Chunking
console.log('\n--- Section 3: Parent-Child Hierarchical Context Chunking ---');

const sampleArticle = `
Artificial Intelligence has evolved rapidly over the last decade. Large language models represent a paradigm shift in computing.
Retrieval Augmented Generation combines neural models with external search indexes to eliminate hallucinations.
Parent-child chunking indexes micro-spans while returning larger surrounding context blocks to avoid lost in the middle degradation.
Performance optimization reduces latency from forty seconds down to three seconds across public web scrapers.
`.repeat(3);

const parents = buildParentChildChunks(sampleArticle, { url: 'https://example.com/ai' });
assert.ok(parents.length >= 1);
assert.ok(parents[0].children.length >= 2);
assert.ok(parents[0].parentText.length > parents[0].children[0].text.length);
console.log('  [PASS] 3.1 Hierarchical parent-child chunk generation verified');

const childHit = parents[0].children[0];
const expanded = expandChildMatchesToParentContext([childHit]);
assert.equal(expanded.length, 1);
assert.equal(expanded[0].text, parents[0].parentText);
console.log('  [PASS] 3.2 Granular child match expanded to full parent context');

// Section 4: Automated RAG Triad Faithfulness Evaluator
console.log('\n--- Section 4: Automated RAG Triad Faithfulness Evaluator ---');

const sampleSubject = fixtureSubject('Enterprise');
const sampleLeader = fixtureSubject('Executive');
const alternatePerson = fixtureSubject('Alternate');
const evidence = [
    { title: `${sampleSubject} Leadership`, description: `${sampleLeader} is the Chief Executive Officer of ${sampleSubject}, serving actively.`, text: `${sampleLeader} leads ${sampleSubject}.` }
];

const groundedAnswer = `${sampleLeader} is the current CEO of ${sampleSubject}, serving actively.`;
const hallucinatedAnswer = `${alternatePerson} is the CEO of ${sampleSubject} and was never appointed.`;

const groundedEval = computeRagTriadEvaluation(`Who is the CEO of ${sampleSubject}?`, groundedAnswer, evidence);
assert.equal(groundedEval.passed, true);
assert.ok(groundedEval.groundedness >= 0.8);
assert.equal(groundedEval.verdict, 'grounded_verified');
console.log('  [PASS] 4.1 Grounded answer passes RAG Triad evaluation with high score (>0.8)');

const hallucinatedEval = computeRagTriadEvaluation(`Who is the CEO of ${sampleSubject}?`, hallucinatedAnswer, evidence);
assert.equal(hallucinatedEval.passed, false);
assert.ok(hallucinatedEval.groundedness < 0.6);
assert.equal(hallucinatedEval.verdict, 'potential_hallucination_detected');
console.log('  [PASS] 4.2 Hallucinated assertion caught and flagged by Faithfulness guardrail');

// Section 5: Streaming Inline Citation Markdown Badges
console.log('\n--- Section 5: Streaming Inline Citation Markdown Badges ---');

const sampleReport = fixtureSubject('Doc');
const mdWithCitations = `${sampleReport} states findings [^1](https://example.gov/doc1) and confirms details [^2](https://example.gov/doc2).`;
const htmlOutput = renderMarkdown(mdWithCitations);

assert.ok(htmlOutput.includes('class="citation-badge"'));
assert.ok(htmlOutput.includes('href="https://example.gov/doc1"'));
assert.ok(htmlOutput.includes('href="https://example.gov/doc2"'));
assert.ok(htmlOutput.includes('<sup>[1]</sup>'));
assert.ok(htmlOutput.includes('<sup>[2]</sup>'));
console.log('  [PASS] 5.1 Footnote citation tags [^1](url) rendered as interactive badges');

console.log('\n================================================================');
console.log('=== All Enterprise Production RAG & Triad Tests PASSED ===');
console.log('================================================================\n');
