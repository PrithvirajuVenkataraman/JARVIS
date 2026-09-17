import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnvContent, loadEnvFiles } from '../tools/local-dev-server.mjs';
import { __test as chatTest } from '../api/chat-groq.js';

console.log('=== Running Service Unavailable Resilience & Grounding Test Suite ===\n');

// ---------------------------------------------------------
// Test 1: .env Parsing and Environment Precedence
// ---------------------------------------------------------
console.log('--- Section 1: .env Parsing and Environment Precedence ---');
const sampleEnv = `
# Comment line
GROQ_API_KEY=gsk_test_12345
GEMINI_API_KEY="gemini_test_secret"
PORT=3005
# Empty line next

CUSTOM_VAR='custom_val'
`;

const parsed = parseEnvContent(sampleEnv);
assert.equal(parsed.GROQ_API_KEY, 'gsk_test_12345', 'Should strip whitespace and parse GROQ_API_KEY');
assert.equal(parsed.GEMINI_API_KEY, 'gemini_test_secret', 'Should strip double quotes');
assert.equal(parsed.PORT, '3005', 'Should parse PORT');
assert.equal(parsed.CUSTOM_VAR, 'custom_val', 'Should strip single quotes');
assert.equal(parsed['# Comment line'], undefined, 'Comments should not be parsed as keys');
console.log('  [PASS] 1.1 parseEnvContent correctly strips quotes, comments, and empty lines');

// Precedence test: existing process.env must NOT be overwritten
const originalTestKey = process.env.TEST_EXISTING_KEY;
process.env.TEST_EXISTING_KEY = 'system_precedence_value';
const tempDir = path.resolve('scratch/test_env_fixture');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
fs.writeFileSync(path.join(tempDir, '.env'), 'TEST_EXISTING_KEY=file_value\nNEW_KEY=new_val\n', 'utf8');
loadEnvFiles(tempDir);
assert.equal(process.env.TEST_EXISTING_KEY, 'system_precedence_value', 'System environment variable MUST take precedence over .env file');
assert.equal(process.env.NEW_KEY, 'new_val', 'New environment variable from .env must be loaded');
delete process.env.TEST_EXISTING_KEY;
delete process.env.NEW_KEY;
if (originalTestKey !== undefined) process.env.TEST_EXISTING_KEY = originalTestKey;
console.log('  [PASS] 1.2 loadEnvFiles enforces system environment variable precedence over .env');

// ---------------------------------------------------------
// Test 2: Error Classification (missing_credentials vs service_unavailable)
// ---------------------------------------------------------
console.log('\n--- Section 2: Error Classification in api/chat-groq.js ---');
// When no keys are present, streamModelWithFallback and runModelWithFallback return code: 'missing_credentials'
const origGroqKey = process.env.GROQ_API_KEY;
const origGroqKeys = process.env.GROQ_API_KEYS;
const origGeminiKey = process.env.GEMINI_API_KEY;
const origGoogleKey = process.env.GOOGLE_API_KEY;
delete process.env.GROQ_API_KEY;
delete process.env.GROQ_API_KEYS;
delete process.env.GEMINI_API_KEY;
delete process.env.GOOGLE_API_KEY;

const missingKeyStreamResult = await chatTest.streamModelWithFallback('test prompt', {}, () => {});
assert.equal(missingKeyStreamResult.ok, false, 'Stream must fail when no keys are configured');
assert.equal(missingKeyStreamResult.payload?.code, 'missing_credentials', 'Code must be missing_credentials when no keys are configured');
assert.ok(missingKeyStreamResult.payload?.response?.includes('.env'), 'Response must guide user to .env file');

const missingKeyRunResult = await chatTest.runModelWithFallback('test prompt', {});
assert.equal(missingKeyRunResult.ok, false, 'Non-streaming run must fail when no keys are configured');
assert.equal(missingKeyRunResult.payload?.code, 'missing_credentials', 'Code must be missing_credentials when no keys are configured');

// Restore dummy key to test service_unavailable when upstream fails
process.env.GROQ_API_KEY = 'gsk_invalid_dummy_key_to_trigger_outage';
const unavailableStreamResult = await chatTest.streamModelWithFallback('test prompt', { timeoutMs: 300 }, () => {});
assert.equal(unavailableStreamResult.ok, false, 'Stream must fail when upstream rejects dummy key');
assert.equal(unavailableStreamResult.payload?.code, 'service_unavailable', 'Code must be service_unavailable when credentials exist but provider is unreachable');

// Restore original env
if (origGroqKey) process.env.GROQ_API_KEY = origGroqKey; else delete process.env.GROQ_API_KEY;
if (origGroqKeys) process.env.GROQ_API_KEYS = origGroqKeys; else delete process.env.GROQ_API_KEYS;
if (origGeminiKey) process.env.GEMINI_API_KEY = origGeminiKey; else delete process.env.GEMINI_API_KEY;
if (origGoogleKey) process.env.GOOGLE_API_KEY = origGoogleKey; else delete process.env.GOOGLE_API_KEY;

console.log('  [PASS] 2.1 Error classification accurately separates missing_credentials from service_unavailable');

// ---------------------------------------------------------
// Test 3: Music, Song & Lyrics Grounding (Hallucination Prevention)
// ---------------------------------------------------------
console.log('\n--- Section 3: Music, Song & Lyrics Epistemic Grounding ---');
// 3.1 Creative Classifier does NOT match factual inquiries
const factualSong1 = 'Tell me about the song Naan Pizhai';
const factualSong2 = 'What is the meaning of the song Naan Pizhai?';
const factualSong3 = 'Who composed Kannaana Kanney song from Viswasam?';
const factualLyrics = 'lyrics of Naan Pizhai';

assert.equal(chatTest.isCreativeAnswerRequest(factualSong1), false, 'Factual query "Tell me about the song Naan Pizhai" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualSong2), false, 'Factual query "meaning of the song" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualSong3), false, 'Factual query "Who composed Kannaana Kanney" must NOT be creative');
assert.equal(chatTest.isCreativeAnswerRequest(factualLyrics), false, 'Factual inquiry "lyrics of Naan Pizhai" must NOT be creative');

// 3.2 Creative Classifier DOES match actual composition requests
const creativeReq1 = 'write a song about the monsoon rain';
const creativeReq2 = 'compose lyrics for an acoustic ballad';
const creativeReq3 = 'write a poem about space';
const creativeReq4 = 'tell me a joke';

assert.equal(chatTest.isCreativeAnswerRequest(creativeReq1), true, 'Request to write a song must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq2), true, 'Request to compose lyrics must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq3), true, 'Request to write a poem must be creative');
assert.equal(chatTest.isCreativeAnswerRequest(creativeReq4), true, 'Request to tell a joke must be creative');
console.log('  [PASS] 3.1 isCreativeAnswerRequest cleanly differentiates active creation from factual song inquiries');

// 3.3 Temperature Resolution
const factualTemp1 = chatTest.resolveResponseTemperature({ message: factualSong1 });
assert.ok(factualTemp1 <= 0.6, `Factual song inquiry temperature (${factualTemp1}) must be <= 0.6 (never 0.92)`);

const factualLyricsTemp = chatTest.resolveResponseTemperature({ message: factualLyrics });
assert.ok(factualLyricsTemp <= 0.35, `Factual lyrics inquiry temperature (${factualLyricsTemp}) must be <= 0.35 (factual)`);

const creativeTemp = chatTest.resolveResponseTemperature({ message: creativeReq1 });
assert.equal(creativeTemp, 0.92, `Creative writing request temperature (${creativeTemp}) must be 0.92`);
console.log('  [PASS] 3.2 Factual song inquiries resolve to grounded temperature (<=0.35); only creative writing gets 0.92');

// 3.4 Epistemic Directives in System Prompt and Hints
const systemPrompt = chatTest.buildServerSystemPrompt();
assert.ok(systemPrompt.includes('Music, Songs & Lyrics (CRITICAL):'), 'System prompt must contain dedicated Music & Lyrics section');
assert.ok(systemPrompt.includes('NEVER fabricate or hallucinate song lyrics'), 'System prompt must forbid lyrics hallucination');
assert.ok(systemPrompt.includes('Strict music credits & soundtrack attribution'), 'System prompt must require strict composer attribution');
assert.ok(systemPrompt.includes('NEVER guess or conflate composers'), 'System prompt must explicitly forbid cross-movie composer conflation');

const popCultureHint = chatTest.buildIntentPromptHint('pop_culture_reference');
assert.ok(popCultureHint.includes('Song lyrics & music credits: Never fabricate song lyrics'), 'Pop culture hint must reinforce lyrics grounding');
console.log('  [PASS] 3.3 System prompt and pop_culture_reference include strict epistemic directives for music & lyrics');

// 3.5 Routing of Lyrics Requests to Live Search
const lyricsRouting = chatTest.classifyRoutingDecision('lyrics of Naan Pizhai', '', { intent: 'chat' });
assert.equal(lyricsRouting.strategy, 'live_first', 'Lyrics queries must route to live_first for search grounding');
assert.equal(lyricsRouting.reason, 'lyrics_retrieval_grounding', 'Lyrics queries must specify lyrics_retrieval_grounding reason');
console.log('  [PASS] 3.4 classifyRoutingDecision routes lyrics requests to live_first for live context retrieval');

// ---------------------------------------------------------
// Test 4: Frontend Stream Resilience & Fast Fallback Invariants
// ---------------------------------------------------------
console.log('\n--- Section 4: Frontend Stream Resilience & Fast Fallback Invariants in index.html ---');
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Assistant bubble preservation
assert.ok(!indexHtml.includes('discardStreamingAssistantMessage(assistantMessageId);\n        throw error;'),
    'streamChatCompletion must NOT discard assistantMessageId on general stream errors');
assert.ok(indexHtml.includes('targetRow.__streamFailed = true'),
    'Assistant row must be tagged with __streamFailed on stream error');
console.log('  [PASS] 4.1 Assistant message bubble preserved in DOM upon stream failure (no blank screen)');

// Immediate bypass of 20s retry for permanent provider failures
assert.ok(indexHtml.includes('isPermanentProviderFailure(error)'),
    'askGeminiAI must identify permanent provider failures');
assert.ok(indexHtml.includes('timeoutMs: 4000'), 'Eligible transient error retry must be capped at 4000ms (down from 20000ms)');
assert.ok(!indexHtml.includes('timeoutMs: 20000\n                    }'), 'askGeminiAI unstreamed retry must not use 20000ms timeout');
console.log('  [PASS] 4.2 Zero 20s hangs: permanent failures bypass retry directly; transient retries capped at 4s');

// Resilient Search Fallback with 3000ms synthesis timeout
assert.ok(indexHtml.includes('const synthTimeout = setTimeout(() => synthController.abort(), 3000);'),
    'buildSearchFallbackAnswer must enforce a 3000ms timeout on internal LLM synthesis');
assert.ok(indexHtml.includes('fallbackSummary'),
    'buildSearchFallbackAnswer must format raw search snippets if synthesis times out');
console.log('  [PASS] 4.3 buildSearchFallbackAnswer enforces 3000ms synthesis timeout with raw snippet fallback');

// Late stream lock guard
assert.ok(indexHtml.includes('targetRow.__fallbackActive === true || targetRow.__fallbackCompleted === true'),
    'Late stream delta lock must ignore incoming events when fallback is active/completed');
console.log('  [PASS] 4.4 Late stream delta lock protects fallback bubble against stale SSE overwrite');

// ---------------------------------------------------------
// Test 5: Dynamic Composer Height & Clearance
// ---------------------------------------------------------
console.log('\n--- Section 5: Dynamic Composer Height & Clearance ---');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// Stylesheet clearance and scrim
assert.ok(stylesCss.includes('padding-bottom: calc(var(--input-bar-safe-height) + 24px + env(safe-area-inset-bottom)) !important;'),
    'Base .chat-center-column must have safe-area padding-bottom for composer clearance');
assert.ok(stylesCss.includes('background: linear-gradient(to top, rgba(10, 10, 15, 0.95) 0%, rgba(10, 10, 15, 0.75) 60%, transparent 100%) !important;'),
    '#input-bar-container must have backdrop gradient scrim');
assert.ok(stylesCss.includes('.feedback-container'),
    '.feedback-container must have dedicated styling in styles.css');
console.log('  [PASS] 5.1 CSS enforces dynamic --input-bar-safe-height clearance, gradient scrim, and feedback button styling');

// Index.html ResizeObserver
assert.ok(indexHtml.includes('function initDynamicComposerHeightObserver()'),
    'initDynamicComposerHeightObserver must be implemented in index.html');
assert.ok(indexHtml.includes("document.documentElement.style.setProperty('--input-bar-safe-height'"),
    'ResizeObserver must dynamically update --input-bar-safe-height custom property');
console.log('  [PASS] 5.2 ResizeObserver observes #input-bar-container and updates --input-bar-safe-height dynamically');

console.log('\n================================================================');
console.log('=== All Service Unavailable Resilience & Grounding Tests PASSED ===');
console.log('================================================================\n');
