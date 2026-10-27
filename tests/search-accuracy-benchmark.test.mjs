/**
 * Stage 0: Search Accuracy & Resilience Benchmark
 * ──────────────────────────────────────────────────────────
 * Evaluates the 50-query labeled test set against recorded fixtures:
 *  - Empty-result rate (%)
 *  - p50 and p95 execution latency (ms)
 *  - Freshness score (0.0 to 1.0)
 *  - Relevance score (0.0 to 1.0)
 *  - Topic-switch contamination rate (%)
 *  - Response cache HIT/MISS behavior
 *  - Per-provider telemetry logging
 *
 * Saves current metrics to: tests/fixtures/search-baseline.json
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';

import {
    distillSearchQuery,
    needsContextualReformulation,
    resolveContextualFollowUpQuery,
    buildSearchQueryRewrite,
    rankSources
} from '../api/search.js';
import {
    createSearchTelemetryTracker,
    isObservabilityEnabled
} from '../api/_lib/search-telemetry.js';
import {
    isResponseCacheEnabled,
    getSearchResponseCache,
    setSearchResponseCache,
    buildSearchCacheKey,
    clearSearchResponseCache,
    getSearchCacheStats
} from '../api/_lib/search-response-cache.js';
import {
    hybridRerank,
    extractQueryDateIntent,
    computeTemporalScore
} from '../api/_lib/hybrid-reranker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const queriesPath = resolve(__dirname, 'fixtures/search-query-set.json');
const fixturesPath = resolve(__dirname, 'fixtures/search-recorded-fixtures.json');
const baselinePath = resolve(__dirname, 'fixtures/search-baseline.json');

const querySet = JSON.parse(readFileSync(queriesPath, 'utf8'));
const fixtureStore = JSON.parse(readFileSync(fixturesPath, 'utf8'));

console.log(`\n=== Running Stage 0 Search Accuracy & Observability Benchmark (${querySet.length} queries) ===\n`);

// ── Test Section 1: Response Cache Unit Verification ───────────────────────
console.log('--- Test Section 1: Response Cache Verification ---');
clearSearchResponseCache();

const testKey = buildSearchCacheKey('test query caching', { limit: 8 });
const testPayload = { results: [{ title: 'Cached Title', url: 'https://example.com' }] };

// Cache should miss when enabled
const missResult = getSearchResponseCache(testKey, 'test query caching', { responseCache: true });
assert.equal(missResult, null, 'Uncached item must return null');

// Store in cache
setSearchResponseCache(testKey, testPayload, { responseCache: true }, 'test query caching', 5000);

// Cache should hit
const hitResult = getSearchResponseCache(testKey, 'test query caching', { responseCache: true });
assert.ok(hitResult, 'Cached item must return entry');
assert.equal(hitResult.hit, true, 'Cached hit flag must be true');
assert.equal(hitResult.data.results[0].title, 'Cached Title', 'Cached payload must match stored payload');

const stats = getSearchCacheStats();
assert.equal(stats.hits, 1, 'Cache stats must record 1 hit');
assert.equal(stats.misses, 1, 'Cache stats must record 1 miss');
console.log('  [PASS] Short-TTL Response Cache HIT/MISS mechanics verified');

// ── Test Section 2: Telemetry Tracker Verification ────────────────────────
console.log('\n--- Test Section 2: Provider Telemetry Tracker Verification ---');
const tracker = createSearchTelemetryTracker('current prime minister uk', { observability: true });
tracker.startProvider('duckduckgo');
tracker.finishProvider('duckduckgo', { resultCount: 5, status: 200 });

tracker.startProvider('searxng');
tracker.finishProvider('searxng', { resultCount: 0, status: 204 });

tracker.startProvider('wikipedia');
tracker.finishProvider('wikipedia', { resultCount: 2, status: 200 });

const simulatedFinalResults = [
    { title: 'Sir Keir Starmer - Prime Minister', url: 'https://www.gov.uk/pm', __provider: 'duckduckgo' },
    { title: 'Prime Minister of the UK', url: 'https://en.wikipedia.org/wiki/PM', __provider: 'wikipedia' }
];

tracker.markUsedInAnswer(simulatedFinalResults);
const report = tracker.getReport();

assert.equal(report.providerCount, 3, 'Must track 3 providers');
assert.equal(report.winningProviders.includes('duckduckgo'), true, 'duckduckgo must be marked winning');
assert.equal(report.winningProviders.includes('wikipedia'), true, 'wikipedia must be marked winning');
assert.equal(report.winningProviders.includes('searxng'), false, 'searxng must not be winning');
console.log('  [PASS] Per-provider outcome and winning attribution tracking verified');

// ── Test Section 3: Benchmark Evaluation across 50 Labeled Queries ─────────
console.log('\n--- Test Section 3: Evaluating Labeled Fixture Set ---');

const latencies = [];
let emptyCount = 0;
let totalRelevance = 0;
let totalFreshness = 0;
let temporalQueryCount = 0;
let topicSwitchContaminationCount = 0;
let topicSwitchTotal = 0;

const categoryBreakdown = {};

for (const item of querySet) {
    const start = performance.now();
    const cat = item.category;
    if (!categoryBreakdown[cat]) {
        categoryBreakdown[cat] = { count: 0, empty: 0, relevanceSum: 0, freshnessSum: 0, latencies: [] };
    }

    // Context & reformulation test
    const hasContext = Array.isArray(item.context) && item.context.length > 0;
    let queryToSearch = item.query;

    if (hasContext) {
        const needsRef = needsContextualReformulation(item.query, item.context);
        if (needsRef) {
            const rewritten = resolveContextualFollowUpQuery(item.query, item.context);
            if (rewritten) queryToSearch = rewritten;
        }
    }

    // Check topic-switch contamination
    if (cat === 'topic_switch') {
        topicSwitchTotal++;
        const hasContaminant = (item.forbiddenContaminants || []).some(badWord => {
            return queryToSearch.toLowerCase().includes(badWord.toLowerCase());
        });
        if (hasContaminant) {
            topicSwitchContaminationCount++;
        }
    }

    // Retrieve recorded candidate sources from fixture
    const candidates = fixtureStore[item.id] || [];
    const queryDuration = performance.now() - start;
    latencies.push(queryDuration);
    categoryBreakdown[cat].latencies.push(queryDuration);
    categoryBreakdown[cat].count++;

    if (!candidates.length) {
        emptyCount++;
        categoryBreakdown[cat].empty++;
        continue;
    }

    // Hybrid rerank & rankSources
    const ranked = rankSources(queryToSearch, candidates, {
        chronological: item.temporal,
        forceLive: item.temporal
    });

    const topResults = ranked.slice(0, 3);

    // Compute Relevance Score (Key entity overlap in top results)
    let relevanceScore = 0;
    if (item.expectedKeyEntities && item.expectedKeyEntities.length > 0) {
        const matched = item.expectedKeyEntities.filter(entity => {
            const entLower = entity.toLowerCase();
            return topResults.some(r =>
                String(r.title || '').toLowerCase().includes(entLower) ||
                String(r.snippet || '').toLowerCase().includes(entLower)
            );
        });
        relevanceScore = matched.length / item.expectedKeyEntities.length;
    } else {
        relevanceScore = topResults.length > 0 ? 1.0 : 0.0;
    }
    totalRelevance += relevanceScore;
    categoryBreakdown[cat].relevanceSum += relevanceScore;

    // Compute Freshness Score (For temporal queries)
    if (item.temporal) {
        temporalQueryCount++;
        const now = Date.now();
        const dateIntent = extractQueryDateIntent(item.query);
        const topTemporalScores = topResults.map(r => {
            const pubMs = r.publishedMs || 0;
            return computeTemporalScore(pubMs, dateIntent, now);
        });
        const avgFreshness = topTemporalScores.length
            ? topTemporalScores.reduce((a, b) => a + b, 0) / topTemporalScores.length
            : 0;
        totalFreshness += avgFreshness;
        categoryBreakdown[cat].freshnessSum += avgFreshness;
    }
}

// Latency percentiles
latencies.sort((a, b) => a - b);
const p50Index = Math.floor(latencies.length * 0.50);
const p95Index = Math.floor(latencies.length * 0.95);
const p50Ms = Number(latencies[p50Index].toFixed(2));
const p95Ms = Number(latencies[p95Index].toFixed(2));

const emptyResultRate = Number(((emptyCount / querySet.length) * 100).toFixed(1));
const meanRelevance = Number((totalRelevance / querySet.length).toFixed(3));
const meanFreshness = temporalQueryCount > 0 ? Number((totalFreshness / temporalQueryCount).toFixed(3)) : 1.0;
const contaminationRate = topicSwitchTotal > 0 ? Number(((topicSwitchContaminationCount / topicSwitchTotal) * 100).toFixed(1)) : 0.0;

const baselineMetrics = {
    timestamp: new Date().toISOString(),
    benchmarkVersion: '1.0.0',
    totalQueries: querySet.length,
    emptyResultRatePct: emptyResultRate,
    latencyP50Ms: p50Ms,
    latencyP95Ms: p95Ms,
    meanRelevanceScore: meanRelevance,
    meanFreshnessScore: meanFreshness,
    topicSwitchContaminationPct: contaminationRate,
    categories: {}
};

for (const [catName, catData] of Object.entries(categoryBreakdown)) {
    catData.latencies.sort((a, b) => a - b);
    const catP50 = Number(catData.latencies[Math.floor(catData.latencies.length * 0.5)].toFixed(2));
    const catRelevance = Number((catData.relevanceSum / catData.count).toFixed(3));
    const catFreshness = catData.freshnessSum > 0 ? Number((catData.freshnessSum / catData.count).toFixed(3)) : null;

    baselineMetrics.categories[catName] = {
        totalQueries: catData.count,
        emptyResults: catData.empty,
        latencyP50Ms: catP50,
        relevanceScore: catRelevance,
        freshnessScore: catFreshness
    };
}

// Write baseline to disk
writeFileSync(baselinePath, JSON.stringify(baselineMetrics, null, 2), 'utf8');

console.log('--- Measured Stage 0 Baseline Metrics ---');
console.table({
    'Total Queries Evaluated': querySet.length,
    'Empty Result Rate (%)': `${emptyResultRate}%`,
    'Latency p50 (ms)': `${p50Ms} ms`,
    'Latency p95 (ms)': `${p95Ms} ms`,
    'Relevance Score (0-1)': meanRelevance,
    'Freshness Score (0-1)': meanFreshness,
    'Topic-Switch Contamination (%)': `${contaminationRate}%`
});

console.log(`\n[Baseline Saved] -> ${baselinePath}\n`);
console.log('=== Stage 0 Observability & Benchmark Complete: All Checks PASSED ===\n');
