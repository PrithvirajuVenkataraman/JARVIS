import assert from 'node:assert/strict';
import { resolveVerificationTarget, extractIncumbentFromSummary } from '../api/verify.js';

console.log('--- Testing Verification API Utilities ---');

// 1. Target Resolution
const r1 = resolveVerificationTarget('Who is the CM of Tamil Nadu?');
assert.equal(r1?.slug, 'Tamil_Nadu');
assert.equal(r1?.role, 'Chief Minister');
assert.equal(r1?.jurisdiction, 'Tamil Nadu');

const r2 = resolveVerificationTarget('who is the chief minister of karnataka');
assert.equal(r2?.slug, 'Karnataka');
assert.equal(r2?.role, 'Chief Minister');

const r3 = resolveVerificationTarget('who is the prime minister of india');
assert.equal(r3?.slug, 'Prime_Minister_of_India');
assert.equal(r3?.role, 'Prime Minister');

const r4 = resolveVerificationTarget('write a quick poem about clouds');
assert.equal(r4, null);

// 2. Incumbent Extraction
const wikiSummary1 = 'M. K. Stalin is an Indian politician who is the current and 8th Chief Minister of Tamil Nadu, serving since May 7, 2021.';
const inc1 = extractIncumbentFromSummary(wikiSummary1, 'Chief Minister');
assert.equal(inc1, 'M. K. Stalin');

const wikiSummary2026 = 'The current Chief Minister of Tamil Nadu is C. Joseph Vijay (popularly known as actor Vijay), who assumed office on May 10, 2026.';
const inc2026 = extractIncumbentFromSummary(wikiSummary2026, 'Chief Minister');
assert.equal(inc2026, 'C. Joseph Vijay');

const wikiSummary2 = 'Siddaramaiah is an Indian politician who is the current Chief Minister of Karnataka since May 2023.';
const inc2 = extractIncumbentFromSummary(wikiSummary2, 'Chief Minister');
assert.equal(inc2, 'Siddaramaiah');

const wikiSummary3 = 'Narendra Modi is the current Prime Minister of India, serving since 2014.';
const inc3 = extractIncumbentFromSummary(wikiSummary3, 'Prime Minister');
assert.equal(inc3, 'Narendra Modi');

console.log('verify-api-tests-ok');
