/**
 * @file tests/resilient-scraper.test.mjs
 * @description Milestone 2 Test Suite: Resilient Scraping & Readability Extractor Verification
 *
 * Verifies:
 *   1. Domain failure caching with TTL (skips 403/429 blocked domains).
 *   2. Anti-bot challenge detection.
 *   3. Scoped DOM extraction & boilerplate stripping (aside, nav, widgets, trending).
 *   4. Paragraph relevance gating (eliminating Kazakhstan bridge sidebar pollution on passport queries).
 *   5. Fallback preservation of search snippets when extraction fails.
 */

import assert from 'node:assert/strict';
import {
    extractHostname,
    isDomainTemporarilyBlocked,
    recordDomainFailure,
    clearExtractorCaches,
    isBotChallengeHtml,
    isParagraphRelevant,
    filterRelevantParagraphs,
    extractArticleFromHtml
} from '../api/_lib/article-extractor.js';

console.log('\n======================================================================');
console.log('  Milestone 2 Test Suite: Resilient Scraper & Readability Extractor');
console.log('======================================================================\n');

clearExtractorCaches();

// =========================================================================
// Test 1: Domain Failure Cache & TTL Circuit Breaking
// =========================================================================
console.log('1. Testing Domain Failure Cache & TTL Circuit Breaking...');

const testHost = 'blocked-publisher.example.com';
assert.equal(isDomainTemporarilyBlocked(testHost), false, 'Domain should not be blocked initially');

recordDomainFailure(testHost, 'http_403');
assert.equal(isDomainTemporarilyBlocked(testHost), true, 'Domain should be blocked after recording 403');
assert.equal(isDomainTemporarilyBlocked('other-publisher.example.com'), false, 'Unrelated domains should not be blocked');

console.log('   ✓ Domain failure cache successfully isolates blocked hosts.');

// =========================================================================
// Test 2: Anti-Bot Challenge Detection
// =========================================================================
console.log('2. Testing Anti-Bot Challenge Detection...');

const cloudflareChallengeHtml = `
<!DOCTYPE html>
<html>
<head><title>Just a moment...</title></head>
<body>
<div id="challenge-platform">Checking your browser before accessing the site.</div>
</body>
</html>
`;

assert.equal(isBotChallengeHtml(cloudflareChallengeHtml), true, 'Should detect Cloudflare challenge page');

const regularArticleHtml = `
<!DOCTYPE html>
<html>
<head><title>Important Research on Passport Travel</title></head>
<body><article><p>Some valid content.</p></article></body>
</html>
`;

assert.equal(isBotChallengeHtml(regularArticleHtml), false, 'Should not flag valid article HTML as challenge');
console.log('   ✓ Anti-bot challenge detection passed.');

// =========================================================================
// Test 3: Paragraph Relevance Gating (Sidebar Pollution Elimination)
// =========================================================================
console.log('3. Testing Relevance Gating against Sidebar Pollution...');

const passportQueryTokens = ['three', 'persons', 'travel', 'without', 'passport'];

// Relevant paragraph: discusses the monarchs and passport exemptions
const relevantP1 = 'Only three persons in the world can travel internationally without a passport: the King of the United Kingdom and the Emperor and Empress of Japan.';
const relevantP2 = 'Under established diplomatic law, passports are issued in the name of the reigning British monarch, making it legally impossible for King Charles III to hold one.';

// Irrelevant sidebar widget: TengriNews bridge story
const sidebarP = 'The longest automobile bridge in Kazakhstan across the Bukhtarma reservoir has been officially opened for traffic today with ceremony.';

assert.equal(isParagraphRelevant(relevantP1, passportQueryTokens), true, 'Relevant passport paragraph 1 should pass');
assert.equal(isParagraphRelevant(relevantP2, passportQueryTokens), true, 'Relevant passport paragraph 2 should pass');
assert.equal(isParagraphRelevant(sidebarP, passportQueryTokens), false, 'Kazakhstan bridge sidebar paragraph must be rejected');

const filtered = filterRelevantParagraphs([sidebarP, relevantP1, relevantP2], 'three persons travel without passport');
assert.equal(filtered.length, 2, 'Should keep only the 2 relevant paragraphs and drop the sidebar widget');
assert.ok(!filtered.includes(sidebarP), 'Sidebar paragraph must NOT be present in filtered output');

console.log('   ✓ Relevance gating successfully filtered out sidebar widget noise.');

// =========================================================================
// Test 4: Extraction Failure Graceful Fallback (Insufficient Relevant Content)
// =========================================================================
console.log('4. Testing Extraction Rejection when Entire Page is Irrelevant Widget Noise...');

// A page where only sidebar widgets exist (e.g. broken scraper or paywall redirect)
const pollutedPageHtml = `
<!DOCTYPE html>
<html>
<head><title>Some News Page</title></head>
<body>
  <div class="sidebar-widget">
    <p>The longest automobile bridge in Kazakhstan across the Bukhtarma reservoir has been officially opened today.</p>
    <p>In other local news, weather in Almaty remains sunny with mild winds across the region.</p>
  </div>
</body>
</html>
`;

const extractResult = extractArticleFromHtml(pollutedPageHtml, 'https://example.com/page', 'three persons travel without passport');
assert.equal(extractResult, null, 'Must return null when extracted paragraphs fail relevance gating, preserving snippet');

console.log('   ✓ Returned null for irrelevant page; search snippet will be preserved safely.');

// =========================================================================
// Test 5: Full Scoped Article Extraction on Authentic Article Structure
// =========================================================================
console.log('5. Testing Full Scoped Article Extraction on Authentic Article Structure...');

const authenticArticleHtml = `
<!DOCTYPE html>
<html>
<head>
  <title>The Three People Who Travel Without a Passport</title>
  <meta property="og:title" content="The Three People Who Travel Without a Passport">
  <meta property="article:published_time" content="2024-05-10T12:00:00Z">
</head>
<body>
  <nav><a href="/">Home</a><a href="/news">News</a></nav>
  <header><h1>Header Navigation Bar</h1></header>
  <aside class="sidebar-widget">
    <p>Trending stories: Top 10 holiday destinations in Europe for summer vacation.</p>
  </aside>
  <article>
    <h1>The Three People Who Travel Without a Passport</h1>
    <p>Around the world, nearly every human citizen must carry a valid passport to cross international borders and state checkpoints.</p>
    <p>However, exactly three individuals on Earth hold the sovereign right to travel abroad without a passport: King Charles III of Great Britain, and Emperor Naruhito along with Empress Masako of Japan.</p>
    <p>In the United Kingdom, British passports are issued in the name of His Majesty, meaning the monarch cannot issue a document to himself.</p>
  </article>
  <footer><p>Copyright 2024. All rights reserved.</p></footer>
</body>
</html>
`;

const authenticResult = extractArticleFromHtml(
    authenticArticleHtml,
    'https://travel-insider.example.org/passports',
    'three persons travel without passport'
);

assert.ok(authenticResult !== null, 'Authentic article must extract successfully');
assert.equal(authenticResult.title, 'The Three People Who Travel Without a Passport');
assert.equal(authenticResult.pubDate, '2024-05-10T12:00:00Z');
assert.ok(authenticResult.bodyText.includes('King Charles III'), 'Extracted body must contain King Charles III');
assert.ok(authenticResult.bodyText.includes('Emperor Naruhito'), 'Extracted body must contain Emperor Naruhito');
assert.ok(!authenticResult.bodyText.includes('Trending stories: Top 10 holiday'), 'Sidebar must be stripped');

console.log('   ✓ Extracted clean body with entities and zero sidebar contamination:');
console.log(`     Title: "${authenticResult.title}"`);
console.log(`     Paragraph Count: ${authenticResult.paragraphCount}`);
console.log(`     Preview: "${authenticResult.bodyText.slice(0, 120)}..."`);

console.log('\n======================================================================');
console.log('  Milestone 2 Test Suite: ALL TESTS PASSED ✓');
console.log('======================================================================\n');
