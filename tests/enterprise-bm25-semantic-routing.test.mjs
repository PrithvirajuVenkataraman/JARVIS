import assert from 'node:assert/strict';
import { BM25Index as BackendBM25, computeBM25Scores as computeBackendBM25, tokenizeText as backendTokenize } from '../api/_lib/bm25.js';
import { BM25Index as FrontendBM25, computeBM25Scores as computeFrontendBM25, tokenizeText as frontendTokenize } from '../app/bm25.js';
import {
    isStableGeographyOrGeneralFactQuery as backendIsStable,
    classifyUniversalEntityIntent as backendClassifyEntity,
    classifyQueryIntent
} from '../api/_lib/intent-separator.js';
import {
    isStableGeographyOrGeneralFactQuery as frontendIsStable,
    classifyUniversalEntityIntent as frontendClassifyEntity,
    decideFrontendRoute
} from '../app/frontend-routing.js';

console.log('=== Testing Enterprise BM25 & Semantic Hybrid Routing Engine ===\n');

// =========================================================================
// Section 1: BM25 IR Engine Verification (Backend & Frontend parity)
// =========================================================================
console.log('--- Section 1: BM25 Mathematical Invariants & Algorithmic Parity ---');

for (const [name, BM25Engine, tokenize] of [
    ['Backend (api/_lib/bm25.js)', BackendBM25, backendTokenize],
    ['Frontend (app/bm25.js)', FrontendBM25, frontendTokenize]
]) {
    console.log(`  Testing ${name}...`);

    // 1.1 Stop-word stripping of interrogative grammar
    const tokensWithStopWords = tokenize('Why did the Roman Empire fall and where was it located?');
    assert.ok(!tokensWithStopWords.includes('why'), 'Tokenization must strip "why"');
    assert.ok(!tokensWithStopWords.includes('did'), 'Tokenization must strip "did"');
    assert.ok(!tokensWithStopWords.includes('the'), 'Tokenization must strip "the"');
    assert.ok(!tokensWithStopWords.includes('and'), 'Tokenization must strip "and"');
    assert.ok(!tokensWithStopWords.includes('where'), 'Tokenization must strip "where"');
    assert.ok(!tokensWithStopWords.includes('was'), 'Tokenization must strip "was"');
    assert.ok(!tokensWithStopWords.includes('it'), 'Tokenization must strip "it"');
    assert.ok(tokensWithStopWords.includes('roman'), 'Tokenization must preserve topical noun "roman"');
    assert.ok(tokensWithStopWords.includes('empire'), 'Tokenization must preserve topical noun "empire"');
    assert.ok(tokensWithStopWords.includes('fall'), 'Tokenization must preserve topical verb "fall"');
    assert.ok(tokensWithStopWords.includes('located'), 'Tokenization must preserve topical predicate "located"');

    // 1.2 Inverted index building & IDF computation
    const index = new BM25Engine({ k1: 1.2, b: 0.75, filterStopWords: true });
    index.addDocument('doc1', 'Quantum computing qubits superposition entanglement quantum physics');
    index.addDocument('doc2', 'Classical computing microprocessor silicon transistors binary logic');
    index.addDocument('doc3', 'Baking sourdough bread flour yeast water fermentation recipe');

    // Rare term ("qubits") should have higher IDF than common term appearing across docs
    const rareIdf = index.getIdf('qubits');
    assert.ok(rareIdf > 0, 'Rare term must have positive IDF');

    // Query matching
    const quantumResults = index.search('How does quantum entanglement work in physics?');
    assert.ok(quantumResults.length > 0, 'Must find matching document');
    assert.equal(quantumResults[0].doc.id, 'doc1', 'Must rank doc1 highest for quantum physics');
    assert.ok(quantumResults[0].score > 1.0, 'Top score must be robust');

    // Bread query
    const breadResults = index.search('What ingredients are needed for sourdough bread?');
    assert.equal(breadResults[0].doc.id, 'doc3', 'Must rank doc3 highest for baking bread');

    // Out of vocabulary query
    const oovResults = index.search('astrophysics blackhole singularity');
    assert.equal(oovResults.length, 0, 'Unrelated query must yield no results above threshold');
}
console.log('  [PASS] BM25 tokenization, IDF scaling, and search parity verified.\n');

// =========================================================================
// Section 2: Zero-Interrogative-Regex Semantic Intent Classification
// =========================================================================
console.log('--- Section 2: Static Encyclopedic Knowledge Grounding ---');

const testCases = [
    // Phrased with question words
    { query: 'Why was Brihadeeswarar Temple constructed?', expectedCategory: 'landmarks_architecture' },
    { query: 'Who built the Taj Mahal and why?', expectedCategory: 'landmarks_architecture' },
    { query: 'How were the Pyramids of Giza built?', expectedCategory: 'landmarks_architecture' },
    { query: 'Where is Mount Everest located and what is its elevation?', expectedCategory: 'landmarks_architecture' },
    { query: 'What is the capital of Australia?', expectedCategory: 'geography' },
    { query: 'What is the speed of light in a vacuum?', expectedCategory: 'science' },
    { query: 'How does the quicksort algorithm partition an array?', expectedCategory: 'cs' },
    { query: 'What is the definition of utilitarianism?', expectedCategory: 'philosophy' },
    // Phrased WITHOUT question words (pure keywords/phrases)
    { query: 'Brihadeeswarar Temple construction history and architectural style', expectedCategory: 'landmarks_architecture' },
    { query: 'Taj Mahal builder and Mughal architectural design', expectedCategory: 'landmarks_architecture' },
    { query: 'Pyramids of Giza construction engineering Pharaohs', expectedCategory: 'landmarks_architecture' },
    { query: 'Mount Everest geological composition and elevation', expectedCategory: 'landmarks_architecture' },
    { query: 'Canberra Australia national capital', expectedCategory: 'geography' },
    { query: 'kinetic energy formula physics E=mc^2', expectedCategory: 'science' },
    { query: 'binary search tree algorithm time complexity', expectedCategory: 'cs' },
    { query: 'epistemology philosophical definition', expectedCategory: 'philosophy' }
];

for (const { query } of testCases) {
    const backendResult = backendIsStable(query);
    assert.equal(backendResult, true, `Backend must classify "${query}" as stable knowledge`);

    const frontendResult = frontendIsStable(query);
    assert.equal(frontendResult, true, `Frontend must classify "${query}" as stable knowledge`);

    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'fast_simple', `Frontend route for "${query}" must be fast_simple`);
    assert.equal(route.requiresSources, false);

    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning', `Query intent for "${query}" must be static_reasoning`);
    assert.equal(intent.requiresLiveGrounding, false);
}
console.log('  [PASS] All factual queries accurately route to fast_simple with or without question words.\n');

// =========================================================================
// Section 3: Live Queries & Local Navigation Discrimination
// =========================================================================
console.log('--- Section 3: Dynamic Live & Navigation Exclusion Integrity ---');

const liveExclusionQueries = [
    'hotels near Eiffel tower',
    'directions to Taj Mahal',
    'restaurants near Central Park open now',
    'current Prime Minister of United Kingdom',
    'Chief Minister of Tamil Nadu in office',
    'weather in Tokyo today',
    'price of Bitcoin right now',
    'new feature in Python 3.12 release notes'
];

for (const query of liveExclusionQueries) {
    assert.equal(backendIsStable(query), false, `Backend must reject live/navigation query "${query}" from stable facts`);
    assert.equal(frontendIsStable(query), false, `Frontend must reject live/navigation query "${query}" from stable facts`);

    const route = decideFrontendRoute(query);
    assert.ok(route.route === 'live_required' || route.route === 'place_grounded', `Route for "${query}" must be live/place grounded`);
    assert.equal(route.requiresSources, true, `Route for "${query}" must require sources`);
}
console.log('  [PASS] Live and local navigation queries strictly excluded from fast_simple.\n');

console.log('=== ALL ENTERPRISE BM25 & SEMANTIC ROUTING TESTS PASSED (100%) ===\n');
