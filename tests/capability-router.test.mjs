/**
 * Phase 7: Semantic Capability Router Tests
 *
 * Tests classifyQueryShape() and the updated decideFrontendRoute() integration.
 * Key invariants:
 *   - Bare entity queries (song/movie/person/product/company titles) -> live_required
 *   - Conceptual/explanation queries -> normal_llm (chat_direct / fast_simple)
 *   - Image commands -> image_generation (unchanged)
 *   - Conversational -> fast_simple (unchanged)
 *   - No query text is ever rewritten or modified
 *
 * Run: node tests/capability-router.test.mjs
 */

import assert from 'node:assert/strict';
import { classifyQueryShape, decideFrontendRoute } from '../app/frontend-routing.js';

console.log('\n--- Phase 7: Semantic Capability Router ---');

function fixtureSubject(label) {
    return `Subject ${label}`;
}

let passed = 0; let failed = 0;
function test(label, fn) {
    try { fn(); console.log('  PASS  ' + label); passed++; }
    catch(e) { console.error('  FAIL  ' + label); console.error('        ' + e.message); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: classifyQueryShape -- shape detection
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 1: classifyQueryShape -- structural shape detection');

test('"Nenjukkul Peidhidum" -> entity_bare', () => {
    const s = classifyQueryShape('Nenjukkul Peidhidum');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
    assert.equal(s.hasQueryVerb, false);
});

test('"Inception" -> entity_bare (English movie title)', () => {
    const s = classifyQueryShape('Inception');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"Dune Part Two" -> entity_bare (multi-word title)', () => {
    const s = classifyQueryShape('Dune Part Two');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"Billie Eilish" -> entity_bare (artist name)', () => {
    const s = classifyQueryShape('Billie Eilish');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"OpenAI" -> entity_bare (company name)', () => {
    const s = classifyQueryShape('OpenAI');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"iPhone 16 Pro" -> entity_bare (product name)', () => {
    const s = classifyQueryShape('iPhone 16 Pro');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"Taylor Swift" -> entity_bare (person name)', () => {
    const s = classifyQueryShape('Taylor Swift');
    assert.equal(s.shape, 'entity_bare', `expected entity_bare, got ${s.shape}`);
});

test('"Interstellar" -> entity_bare (single word title)', () => {
    const s = classifyQueryShape('Interstellar');
    assert.equal(s.shape, 'entity_bare');
});

test('Tamil Unicode script -> entity_bare + hasNonLatinScript', () => {
    const tamQuery = 'நெஞ்சுக்குள் பைதியம்';
    const s = classifyQueryShape(tamQuery);
    assert.equal(s.shape, 'entity_bare', `Tamil script query must be entity_bare, got ${s.shape}`);
    assert.equal(s.hasNonLatinScript, true);
});

test('"Who sang Nenjukkul Peidhidum?" -> entity_question + media', () => {
    const s = classifyQueryShape('Who sang Nenjukkul Peidhidum?');
    assert.equal(s.shape, 'entity_question', `expected entity_question, got ${s.shape}`);
    assert.equal(s.hasMediaContext, true, 'must detect "sang" as media context');
});

test('"What movie is Inception from?" -> entity_question + media', () => {
    const s = classifyQueryShape('What movie is Inception from?');
    assert.equal(s.shape, 'entity_question', `expected entity_question, got ${s.shape}`);
    assert.equal(s.hasMediaContext, true);
});

test('"Who is the director of Dune?" -> entity_question + media', () => {
    const s = classifyQueryShape('Who is the director of Dune?');
    assert.equal(s.shape, 'entity_question');
    assert.equal(s.hasMediaContext, true);
});

test('"Explain what a transformer is" -> command/conceptual, not entity_bare', () => {
    const s = classifyQueryShape('Explain what a transformer is');
    assert.notEqual(s.shape, 'entity_bare');
});

test('"How does photosynthesis work?" -> conceptual, not entity_bare', () => {
    const s = classifyQueryShape('How does photosynthesis work?');
    assert.equal(s.shape, 'conceptual', `expected conceptual, got ${s.shape}`);
});

test('"What is machine learning?" -> not entity_bare', () => {
    const s = classifyQueryShape('What is machine learning?');
    assert.notEqual(s.shape, 'entity_bare');
});

test('"Create an image of a cat" -> command shape', () => {
    const s = classifyQueryShape('Create an image of a cat');
    assert.equal(s.shape, 'command', `expected command, got ${s.shape}`);
});

test('"Translate this to French" -> command shape', () => {
    const s = classifyQueryShape('Translate this to French');
    assert.equal(s.shape, 'command');
});

test('"Hi" -> conversational', () => {
    const s = classifyQueryShape('Hi');
    assert.equal(s.shape, 'conversational');
});

test('"Thank you" -> conversational', () => {
    const s = classifyQueryShape('Thank you');
    assert.equal(s.shape, 'conversational');
});

test('"Why?" -> interrogative shape, not entity_bare', () => {
    const s = classifyQueryShape('Why?');
    assert.notEqual(s.shape, 'entity_bare', '"Why?" must not be entity_bare');
    assert.equal(s.hasQueryVerb, true);
});

test('"ok" -> not entity_bare (all-lowercase, no title-case signal)', () => {
    const s = classifyQueryShape('ok');
    assert.notEqual(s.shape, 'entity_bare', '"ok" must not be entity_bare');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: decideFrontendRoute -- end-to-end entity routing
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 2: decideFrontendRoute -- entity routing integration');

test('"Nenjukkul Peidhidum" -> live_required', () => {
    const r = decideFrontendRoute('Nenjukkul Peidhidum', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}. reason: ${r.reason}`);
    assert.equal(r.requiresSources, true);
});

test('"Inception" -> live_required', () => {
    const r = decideFrontendRoute('Inception', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"Billie Eilish" -> live_required', () => {
    const r = decideFrontendRoute('Billie Eilish', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"iPhone 16 Pro" -> live_required', () => {
    const r = decideFrontendRoute('iPhone 16 Pro', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"OpenAI" -> live_required', () => {
    const r = decideFrontendRoute('OpenAI', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"Dune Part Two" -> live_required', () => {
    const r = decideFrontendRoute('Dune Part Two', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"Who sang Nenjukkul Peidhidum?" -> live_required (entity_media_question)', () => {
    const r = decideFrontendRoute('Who sang Nenjukkul Peidhidum?', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"What movie is Inception from?" -> live_required', () => {
    const r = decideFrontendRoute('What movie is Inception from?', {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"Explain what a transformer is" -> NOT live_required', () => {
    const r = decideFrontendRoute('Explain what a transformer is', {});
    assert.notEqual(r.route, 'live_required', `"Explain..." must stay in LLM path, got ${r.route}`);
});

test('"What is machine learning?" -> NOT live_required', () => {
    const r = decideFrontendRoute('What is machine learning?', {});
    assert.notEqual(r.route, 'live_required', `Conceptual question must not go live, got ${r.route}`);
});

test('"Create an image of a sunset" -> image_generation (unchanged)', () => {
    const r = decideFrontendRoute('Create an image of a sunset', {});
    assert.equal(r.route, 'image_generation', `expected image_generation, got ${r.route}`);
});

test('"What is Apple stock price?" -> live_required (live signal)', () => {
    const r = decideFrontendRoute("What is Apple's stock price?", {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test(`"What is the latest song from ${fixtureSubject('Artist')}?" -> live_required (freshness)`, () => {
    const r = decideFrontendRoute(`What is the latest song from ${fixtureSubject('Artist')}?`, {});
    assert.equal(r.route, 'live_required', `expected live_required, got ${r.route}`);
});

test('"Hi" -> fast_simple (conversational, unchanged)', () => {
    const r = decideFrontendRoute('Hi', {});
    assert.equal(r.route, 'fast_simple', `expected fast_simple, got ${r.route}`);
});

test('"Why?" -> NOT live_required (follow-up, no entity)', () => {
    const r = decideFrontendRoute('Why?', {});
    assert.notEqual(r.route, 'live_required', '"Why?" is a follow-up, not an entity lookup');
});

test('webMode=off: entity_bare check is skipped', () => {
    const r = decideFrontendRoute('Nenjukkul Peidhidum', { webMode: 'off' });
    assert.notEqual(r.route, 'live_required', 'Web-off must prevent entity_bare from going live');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

console.log('\n' + '='.repeat(60));
const total = passed + failed;
console.log(`capability-router.test.mjs  ${passed}/${total} ${failed === 0 ? 'PASS' : 'FAIL'}`);
if (failed > 0) process.exit(1);
