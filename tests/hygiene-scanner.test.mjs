import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    scanContent,
    scanFile,
    stableHash,
    tokenizeContent
} from '../tools/hardcoded-content-scanner.mjs';

console.log('--- Testing Hardcoded Content & Hygiene Scanner (Phase 9) ---');

// =========================================================================
// SECTION 1: Genuine Hardcoding Violations (Must be detected and flagged)
// =========================================================================
console.log('1. Verifying detection of genuine hardcoded answer-content & routing violations...');

// 1.1 Entity Regex Dictionary in routing/classification
const entityRegexViolation = scanContent(`
const mediaRegex = /\\b(?:interstellar|inception|dune|oppenheimer|avatar|titanic)\\b/i;
if (mediaRegex.test(query)) return 'chat_direct';
`, { relativePath: 'app/frontend-routing.js' });
assert.ok(entityRegexViolation.findings.some(item => item.category === 'entity_regex_dictionary'),
    'Must detect entity regex dictionary with 4+ media entities');

const stockRegexViolation = scanContent(`
const tickers = /\\b(?:apple|tesla|nvidia|microsoft|google|amazon|meta)\\b/i;
`, { relativePath: 'app/frontend-routing.js' });
assert.ok(stockRegexViolation.findings.some(item => item.category === 'entity_regex_dictionary'),
    'Must detect entity regex dictionary with company tickers');

// 1.2 Entity Keyword List in runtime arrays
const entityListViolation = scanContent(`
const POPULAR_ARTISTS = [
    'Taylor Swift',
    'Dua Lipa',
    'Billie Eilish',
    'Ed Sheeran'
];
`, { relativePath: 'app/frontend-routing.js' });
assert.ok(entityListViolation.findings.some(item => item.category === 'entity_keyword_list'),
    'Must detect hardcoded entity array of artist names');

const monumentListViolation = scanContent(`
const MONUMENTS = ['Taj Mahal', 'Eiffel Tower', 'Brihadeeswarar Temple', 'Colosseum'];
`, { relativePath: 'api/chat-groq.js' });
assert.ok(monumentListViolation.findings.some(item => item.category === 'entity_keyword_list'),
    'Must detect hardcoded entity array of monument names');

// 1.3 Canned Knowledge Catalogs & Rows
const runtimeCatalog = scanContent(`
const rows = [
    { song: 'Yesterday', artist: 'The Beatles' }
];
`, { relativePath: 'index.html' });
assert.ok(runtimeCatalog.findings.some(item => item.category === 'canned_knowledge_catalog'),
    'Must detect hardcoded song row catalog');

// 1.4 Query-Specific Routing Exception
const queryExceptionViolation = scanContent(`
if (raw === 'who is the ceo of apple') {
    return 'live_required';
}
`, { relativePath: 'app/frontend-routing.js' });
assert.ok(queryExceptionViolation.findings.some(item => item.category === 'query_specific_exception'),
    'Must detect query-specific exact question routing hack');

// 1.5 Prohibited Legacy Symbols
const legacySymbolViolation = scanContent(`
const legacy = SITCOM_MOVIE_REFERENCE_CATALOG;
`, { relativePath: 'index.html' });
assert.ok(legacySymbolViolation.findings.some(item => item.category === 'legacy_catalog_symbol'),
    'Must detect prohibited legacy catalog symbols');

const landmarkKnowledgeViolation = scanContent(`
const data = landmarkKnowledge;
`, { relativePath: 'api/chat-groq.js' });
assert.ok(landmarkKnowledgeViolation.findings.some(item => item.category === 'legacy_catalog_symbol'),
    'Must detect landmarkKnowledge catalog symbol');

// 1.6 Prohibited Named Content in Runtime Files
const namedContentViolation = scanContent(`
const answer = 'Jordan Vale was known for this role.';
`, { relativePath: 'index.html' });
assert.ok(namedContentViolation.findings.some(item => item.category === 'prohibited_named_content'),
    'Must detect prohibited named content in runtime code');

console.log('  [PASS] All genuine hardcoding violation categories successfully detected.');

// =========================================================================
// SECTION 2: False Positive Immunity (Legitimate configuration & patterns)
// =========================================================================
console.log('2. Verifying immunity for legitimate configuration, commands, and patterns...');

// 2.1 Approved Operational Provider Identifiers
const operationalConfig = scanContent(`
export const source = { name: 'NASA EONET', attribution: 'NASA Earth Observatory Natural Event Tracker' };
`, { relativePath: 'api/_lib/free-live/source-registry.js' });
assert.equal(operationalConfig.findings.length, 0,
    'Must NOT flag approved operational provider names');

// 2.2 Model Configuration Lists
const modelConfig = scanContent(`
export const CANDIDATE_MODELS = [
    'llama-3.3-70b-versatile',
    'gemini-2.5-flash',
    'deepseek-r1-distill-llama-70b',
    'whisper-large-v3'
];
`, { relativePath: 'api/chat-groq.js' });
assert.equal(modelConfig.findings.length, 0,
    'Must NOT flag candidate model configuration arrays');

// 2.3 System Commands & Slash Contracts
const slashCommands = scanContent(`
export const SLASH_COMMANDS = ['/agent', '/workflow', '/image', '/weather', '/search', '/clear', '/export'];
`, { relativePath: 'app/frontend-routing.js' });
assert.equal(slashCommands.findings.length, 0,
    'Must NOT flag slash command contract arrays');

// 2.4 Structural Grammar & Intent Patterns
const structuralGrammar = scanContent(`
const interrogatives = /^(?:what|where|when|who|how|why|which|explain|define|tell me about)\\b/i;
const marketPattern = /\\b(?:market\\s*cap|stock\\s+price|share\\s+price)\\s+of\\s+[a-zA-Z0-9_.-]+\\b/i;
const landmarkTypes = /\\b(?:temple|monument|tower|palace|cathedral|mosque|pyramid|castle|fort|memorial)\\b/i;
const weatherPatterns = /\\b(weather|temperature|forecast|rain|snow|wind)\\b/i;
`, { relativePath: 'app/frontend-routing.js' });
assert.equal(structuralGrammar.findings.length, 0,
    'Must NOT flag structural grammar or syntactic capability regexes');

// 2.5 Runtime Error Messages, Logs, and JSON Property Access
const runtimeCodeStrings = scanContent(`
const errMsg = 'song game recommendation failed';
const song = String(parsed.song || '').trim();
const artist = String(result.artist || '').trim();
logRoutingDebug('handler enter: universal_entity_fact', userText);
const disclaimer = 'Information provided is for general reference.';
`, { relativePath: 'index.html' });
assert.equal(runtimeCodeStrings.findings.length, 0,
    'Must NOT flag runtime property accesses, error messages, or logs');

// 2.6 Test Files with Normal Test Queries
const testQueries = scanContent(`
test('"Who sang Nenjukkul Peidhidum?" -> entity_question', () => {
    const s = classifyQueryShape('Who sang Nenjukkul Peidhidum?');
    assert.equal(s.shape, 'entity_question');
});
test('Route stable geography', () => {
    const r = decideFrontendRoute('What is the capital of France?');
    assert.equal(r.route, 'fast_simple');
});
`, { relativePath: 'tests/capability-router.test.mjs' });
assert.equal(testQueries.findings.length, 0,
    'Must NOT flag test queries, test assertions, or input strings in test files');

console.log('  [PASS] All legitimate configuration, patterns, and test suites immune from false positives.');

// =========================================================================
// SECTION 3: Utility & Cache Integrity
// =========================================================================
assert.ok(tokenizeContent('Alpha beta Alpha').includes('Alpha'));
assert.equal(stableHash('same'), stableHash('same'));
assert.notEqual(stableHash('same'), stableHash('different'));

const tempDir = await mkdtemp(path.join(tmpdir(), 'hygiene-scanner-test-'));
try {
    const filePath = path.join(tempDir, 'fixture.mjs');
    const uniqueContent = `export const value = "Operational Config Identifier"; // ${Date.now()}`;
    await writeFile(filePath, uniqueContent, 'utf8');
    const first = await scanFile(filePath, { root: tempDir });
    const second = await scanFile(filePath, { root: tempDir });
    assert.equal(first.cacheHit, false);
    assert.equal(second.cacheHit, true);
    assert.equal(second.findings.length, 0);
} finally {
    await rm(tempDir, { recursive: true, force: true });
}

console.log('--- ALL HYGIENE SCANNER TESTS PASSED (Phase 9 Complete) ---');

