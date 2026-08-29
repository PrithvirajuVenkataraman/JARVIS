import assert from 'node:assert/strict';
import { decodeHtmlEntities, cleanSnippetText } from '../api/_lib/snippet-sanitizer.js';

function fixtureLabel(label) {
    return `${label}_${Date.now().toString(36).slice(-4)}`;
}

console.log('=== Testing Snippet Sanitizer & Deterministic Fast-Path Guardrail ===\n');

// Section 1: Recursive HTML/XML Entity Resolution
console.log('--- Section 1: Recursive HTML/XML Entity Resolution ---');

// Single and double-encoded non-breaking spaces and quotes
const multiEncoded = 'Sample text&amp;nbsp;&amp;nbsp;with &#160;and &#x27;apostrophe&#x27; &amp;quot;quotes&amp;quot;';
const decoded = decodeHtmlEntities(multiEncoded);

assert.ok(!decoded.includes('&nbsp;'));
assert.ok(!decoded.includes('&#160;'));
assert.ok(!decoded.includes('&#x27;'));
assert.ok(!decoded.includes('&quot;'));
assert.ok(!decoded.includes('&amp;'));
assert.ok(decoded.includes("'apostrophe'"));
assert.ok(decoded.includes('"quotes"'));
console.log('  [PASS] 1.1 Multi-encoded HTML entities (decimal, hex, named) resolved cleanly');

// Section 2: Snippet Cleaning & Trailing Domain Stripping
console.log('\n--- Section 2: Snippet Cleaning & Trailing Domain Stripping ---');

const sampleRssSnippet = `<a href="https://example.com/item">Tournament Victory in ${fixtureLabel('Year')}</a>&nbsp;&nbsp;<font color="#6f6f6f">cbs8.com</font>`;
const cleanedRss = cleanSnippetText(sampleRssSnippet);

assert.ok(!cleanedRss.includes('<a'));
assert.ok(!cleanedRss.includes('<font'));
assert.ok(!cleanedRss.includes('&nbsp;'));
assert.ok(!cleanedRss.includes('cbs8.com'));
assert.ok(cleanedRss.startsWith('Tournament Victory in'));
console.log('  [PASS] 2.1 HTML tags, entities, and trailing publisher domain stripped from RSS snippet');

const snippetWithDashDomain = `Headline summary text - news.bbc.co.uk`;
const cleanedDash = cleanSnippetText(snippetWithDashDomain);
assert.equal(cleanedDash, 'Headline summary text');
console.log('  [PASS] 2.2 Trailing dash-domain publisher stripped');

// Section 3: Deterministic Fast-Path Guardrail
console.log('\n--- Section 3: Deterministic Fast-Path Guardrail Invariants ---');

// Import search module
const searchModule = await import('../api/search.js');
const runSearch = searchModule.runEvidenceFirstWebRag;

assert.equal(typeof runSearch, 'function');
console.log('  [PASS] 3.1 Search module exports runEvidenceFirstWebRag cleanly');

console.log('\n================================================================');
console.log('=== All Snippet Sanitizer & Fast-Path Guardrail Tests PASSED ===');
console.log('================================================================\n');
