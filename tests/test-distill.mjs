import { runVerifiedWebSearch, runEvidenceFirstWebRag, distillSearchQuery, extractComparisonEntities } from '../api/search.js';

const prompt = `Compare the official refund policies and developer revenue-split models of Steam, Epic Games Store, and the PlayStation Network as of 2026. 

Please provide:
1. A Markdown comparison table with columns: Platform, Playtime Limit, Ownership Window (Days), Standard Developer Revenue Share (%), and Exceptions/Exclusions.
2. The exact official first-party help/support source domain for each platform.
3. A concise summary of any recent controversies or updates regarding automated refunds and developer protection in the last 12-18 months.`;

console.log('--- Testing Prompt Distillation & Multi-Entity Search ---');
console.log('Raw prompt length:', prompt.length, 'characters');

const distilled = distillSearchQuery(prompt);
console.log('Distilled query:', distilled);

const entities = extractComparisonEntities(distilled);
console.log('Extracted entities:', entities);

const res = await runVerifiedWebSearch(prompt, { limit: 8 });
console.log('\n--- runVerifiedWebSearch Results ---');
console.log('Provider:', res.provider);
console.log('Total results:', res.results?.length);
(res.results || []).slice(0, 5).forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    URL: ${r.url}`);
    console.log(`    Domain: ${r.domain} (Tier: ${r.authorityTier})`);
});

const ragRes = await runEvidenceFirstWebRag(prompt, { answer: false, limit: 8 });
console.log('\n--- runEvidenceFirstWebRag Results ---');
console.log('Provider:', ragRes.provider);
console.log('Total results:', ragRes.results?.length);
(ragRes.results || []).slice(0, 5).forEach((r, i) => {
    console.log(`[${i + 1}] ${r.title}`);
    console.log(`    URL: ${r.url}`);
    console.log(`    Domain: ${r.domain}`);
});
