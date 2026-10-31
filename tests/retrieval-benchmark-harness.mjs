#!/usr/bin/env node
/**
 * Milestone 0: Retrieval Pipeline Benchmark Harness (v2)
 * ─────────────────────────────────────────────────────────────
 * Runs the 60-query benchmark dataset across tuning (80%) and held-out (20%) splits.
 * Computes:
 *   - Gold-Entity Recall @ k (k=4, k=6)
 *   - Tier-1 Precision @ k (substantive sources vs headline teasers)
 *   - Jaccard Echo-Penalty Trigger Rate
 *   - Extraction Success Rate (substantive body vs null/failed)
 *   - Execution Latency (p50 / p95)
 *
 * Saves reproducible baseline metrics to: tests/fixtures/benchmark-baseline-v2.json
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { searchDuckDuckGoHtml, searchWikipediaApi } from '../api/_lib/free-live/providers.js';
import { rankSources, scoreSearchResult, searchPublicSources } from '../api/search.js';
import {
    normalizeResearchSources,
    formatSourcesForPrompt,
    scoreSourcesBM25AndSemantic
} from '../app/bounded-live-research.js';
import { classifySearchIntent, expandQueryDeterministically } from '../api/_lib/query-rewriter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const benchmarkPath = resolve(__dirname, 'fixtures/retrieval-benchmark-v2.json');
const fixturesStorePath = resolve(__dirname, 'fixtures/frozen-search-fixtures-v2.json');

const benchmarkData = JSON.parse(readFileSync(benchmarkPath, 'utf8'));

// Load or initialize frozen search fixtures to ensure offline test reproducibility
let frozenFixtures = {};
if (existsSync(fixturesStorePath)) {
    try {
        frozenFixtures = JSON.parse(readFileSync(fixturesStorePath, 'utf8'));
    } catch (_) {
        frozenFixtures = {};
    }
}

const args = process.argv.slice(2);
const recordMode = args.includes('--record');
const liveMode = args.includes('--live');
const useRewriter = args.includes('--rewriter');
const splitFilter = args.find(a => a.startsWith('--split='))?.split('=')[1] || null;

const baselineOutputPath = useRewriter
    ? resolve(__dirname, 'fixtures/benchmark-rewriter-v2.json')
    : resolve(__dirname, 'fixtures/benchmark-baseline-v2.json');

console.log(`\n======================================================================`);
console.log(`  Retrieval Pipeline Benchmark v2 (Milestone ${useRewriter ? '4: Rewriter Evaluation' : '0: Baseline'})`);
console.log(`  Total Queries: ${benchmarkData.length} | Split Filter: ${splitFilter || 'all'} | Rewriter: ${useRewriter ? 'ENABLED' : 'DISABLED'}`);
console.log(`  Mode: ${liveMode ? 'LIVE NETWORK' : (Object.keys(frozenFixtures).length ? 'OFFLINE FROZEN FIXTURES' : 'LIVE NETWORK (Auto-cache)')}`);
console.log(`======================================================================\n`);

/**
 * Calculates token-set Jaccard similarity between two strings.
 */
function tokenJaccardSimilarity(textA, textB) {
    const tokenize = (t) => new Set(
        String(t || '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2 && !/^(the|and|for|with|about|what|which|who|where|how|this|that|from|can|are|was|were)\b/.test(w))
    );
    const setA = tokenize(textA);
    const setB = tokenize(textB);
    if (!setA.size || !setB.size) return 0;
    let intersection = 0;
    for (const item of setA) {
        if (setB.has(item)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union > 0 ? intersection / union : 0;
}

/**
 * Checks whether a candidate text block contains a gold entity (case-insensitive substring or token match).
 */
function containsEntity(text, entity) {
    if (!text || !entity) return false;
    const lowerText = String(text).toLowerCase();
    const lowerEntity = String(entity).toLowerCase().trim();
    if (lowerText.includes(lowerEntity)) return true;
    const entityTokens = lowerEntity.split(/\s+/).filter(t => t.length > 2);
    if (entityTokens.length >= 2) {
        return entityTokens.every(tok => lowerText.includes(tok));
    }
    return false;
}

/**
 * Evaluates Tier-1 quality of a search candidate.
 * Substantive if distinct from title and length >= 60.
 */
function isSubstantiveTier1(source) {
    if (!source) return false;
    const title = String(source.title || '').trim();
    const snippet = String(source.snippet || source.description || '').trim();
    const fullArticle = String(source.fullArticleText || source.extract || '').trim();
    if (fullArticle && fullArticle.length >= 100) return true;
    return snippet.length >= 60 && snippet.toLowerCase() !== title.toLowerCase();
}

async function fetchSourcesForQuery(queryItem) {
    const fixtureKey = useRewriter ? `${queryItem.id}_rewriter` : queryItem.id;
    if (!liveMode && frozenFixtures[fixtureKey] && frozenFixtures[fixtureKey].length > 0) {
        return frozenFixtures[fixtureKey];
    }

    const collectedSources = [];
    const seenUrls = new Set();

    try {
        // Multi-engine public search racer (DDG, Google News RSS, Wikipedia, Wikidata, GDELT)
        const publicResults = await searchPublicSources(queryItem.query, {
            limit: 8,
            disableRewriter: !useRewriter,
            timeoutMs: 3800
        });
        if (Array.isArray(publicResults) && publicResults.length > 0) {
            for (const item of publicResults) {
                if (item.url && !seenUrls.has(item.url)) {
                    seenUrls.add(item.url);
                    collectedSources.push(item);
                }
            }
        }
    } catch (_) {}

    // Fallback 1: DuckDuckGo HTML
    if (collectedSources.length === 0) {
        try {
            const queriesToRun = [queryItem.query];
            if (useRewriter) {
                const intent = classifySearchIntent(queryItem.query);
                const expanded = expandQueryDeterministically(queryItem.query, intent);
                for (const exp of expanded) {
                    if (exp.query && !queriesToRun.includes(exp.query)) {
                        queriesToRun.push(exp.query);
                        if (queriesToRun.length >= 3) break;
                    }
                }
            }
            for (const q of queriesToRun) {
                const ddg = await searchDuckDuckGoHtml(q, { limit: 8, timeoutMs: 3500 });
                if (Array.isArray(ddg)) {
                    for (const item of ddg) {
                        if (item.url && !seenUrls.has(item.url)) {
                            seenUrls.add(item.url);
                            collectedSources.push(item);
                        }
                    }
                }
                if (collectedSources.length >= 4) break;
            }
        } catch (_) {}
    }

    // Fallback 2: Wikipedia API (guaranteed non-rate-limited fallback)
    if (collectedSources.length === 0) {
        try {
            const wiki = await searchWikipediaApi(queryItem.query, { limit: 6 });
            if (Array.isArray(wiki)) {
                for (const item of wiki) {
                    if (item.url && !seenUrls.has(item.url)) {
                        seenUrls.add(item.url);
                        collectedSources.push(item);
                    }
                }
            }
        } catch (_) {}
    }

    if (collectedSources.length > 0) {
        frozenFixtures[fixtureKey] = collectedSources;
    }
    return collectedSources.length ? collectedSources : (frozenFixtures[fixtureKey] || []);
}

async function runBenchmark() {
    const queries = splitFilter
        ? benchmarkData.filter(q => q.split === splitFilter)
        : benchmarkData;

    const results = [];
    const latencies = [];

    let totalGoldEntitiesFoundK4 = 0;
    let totalGoldEntitiesFoundK6 = 0;
    let totalGoldEntitiesCount = 0;

    let totalTier1SourcesK4 = 0;
    let totalSourcesK4 = 0;

    let totalTier1SourcesK6 = 0;
    let totalSourcesK6 = 0;

    let totalEchoPenaltiesTriggered = 0;
    let totalTeasersDetected = 0;

    for (let i = 0; i < queries.length; i++) {
        const qItem = queries[i];
        const t0 = performance.now();

        const rawResults = await fetchSourcesForQuery(qItem);
        const tFetch = performance.now();

        // Run current ranking pipeline
        const normalized = normalizeResearchSources(rawResults, qItem.query, 8);
        const tRank = performance.now();

        const elapsedMs = Math.round(tRank - t0);
        latencies.push(elapsedMs);

        const top4 = normalized.slice(0, 4);
        const top6 = normalized.slice(0, 6);

        // 1. Gold Entity Recall @ 4 & @ 6
        const goldEntities = Array.isArray(qItem.goldEntities) ? qItem.goldEntities : [];
        let foundEntitiesK4 = 0;
        let foundEntitiesK6 = 0;

        for (const entity of goldEntities) {
            totalGoldEntitiesCount++;
            const inTop4 = top4.some(src => {
                const combined = `${src.title || ''} ${src.snippet || ''} ${src.description || ''} ${src.fullArticleText || ''} ${src.extract || ''}`;
                return containsEntity(combined, entity);
            });
            if (inTop4) {
                foundEntitiesK4++;
                totalGoldEntitiesFoundK4++;
            }

            const inTop6 = top6.some(src => {
                const combined = `${src.title || ''} ${src.snippet || ''} ${src.description || ''} ${src.fullArticleText || ''} ${src.extract || ''}`;
                return containsEntity(combined, entity);
            });
            if (inTop6) {
                foundEntitiesK6++;
                totalGoldEntitiesFoundK6++;
            }
        }

        // 2. Tier-1 Precision @ 4 & @ 6
        const tier1CountK4 = top4.filter(isSubstantiveTier1).length;
        const tier1CountK6 = top6.filter(isSubstantiveTier1).length;

        totalTier1SourcesK4 += tier1CountK4;
        totalSourcesK4 += top4.length;

        totalTier1SourcesK6 += tier1CountK6;
        totalSourcesK6 += top6.length;

        // 3. Echo Penalty & Teaser Detection
        let queryEchoDetected = false;
        for (const src of top4) {
            const snip = String(src.snippet || src.description || '').trim();
            const titl = String(src.title || '').trim();
            const jaccardWithQuery = tokenJaccardSimilarity(snip, qItem.query);
            const isNearTitle = snip.length > 0 && snip.toLowerCase() === titl.toLowerCase();
            if (jaccardWithQuery >= 0.70 || isNearTitle) {
                queryEchoDetected = true;
                totalEchoPenaltiesTriggered++;
            }
            if (!isSubstantiveTier1(src)) {
                totalTeasersDetected++;
            }
        }

        const recallK4 = goldEntities.length ? foundEntitiesK4 / goldEntities.length : 1;
        const precisionK4 = top4.length ? tier1CountK4 / top4.length : 0;

        results.push({
            id: qItem.id,
            category: qItem.category,
            split: qItem.split,
            query: qItem.query,
            sourcesRetrieved: rawResults.length,
            sourcesRankedK4: top4.length,
            recallK4: Number(recallK4.toFixed(2)),
            precisionK4: Number(precisionK4.toFixed(2)),
            queryEchoDetected,
            elapsedMs
        });

        const statusIcon = recallK4 >= 0.66 && precisionK4 >= 0.75 ? '✓' : '✗';
        console.log(`[${String(i + 1).padStart(2, '0')}/${queries.length}] ${statusIcon} [${qItem.category.slice(0, 10)}] ${qItem.query.slice(0, 52)}... | R@4: ${(recallK4*100).toFixed(0)}% | P@4: ${(precisionK4*100).toFixed(0)}% (${elapsedMs}ms)`);
    }

    // Save frozen fixtures if record mode was used or newly cached
    if (recordMode || !existsSync(fixturesStorePath)) {
        writeFileSync(fixturesStorePath, JSON.stringify(frozenFixtures, null, 2), 'utf8');
        console.log(`\n[Fixtures] Saved ${Object.keys(frozenFixtures).length} queries to: ${fixturesStorePath}`);
    }

    latencies.sort((a, b) => a - b);
    const p50 = latencies[Math.floor(latencies.length * 0.50)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;

    const overallRecallK4 = totalGoldEntitiesCount > 0 ? (totalGoldEntitiesFoundK4 / totalGoldEntitiesCount) : 0;
    const overallRecallK6 = totalGoldEntitiesCount > 0 ? (totalGoldEntitiesFoundK6 / totalGoldEntitiesCount) : 0;
    const overallPrecisionK4 = totalSourcesK4 > 0 ? (totalTier1SourcesK4 / totalSourcesK4) : 0;
    const overallPrecisionK6 = totalSourcesK6 > 0 ? (totalTier1SourcesK6 / totalSourcesK6) : 0;

    // Per-category metrics
    const categories = ['declarative_claim', 'wh_question', 'comparison', 'definition_policy', 'recency_sensitive'];
    const categoryMetrics = {};

    for (const cat of categories) {
        const catItems = results.filter(r => r.category === cat);
        if (catItems.length) {
            const avgR = catItems.reduce((acc, r) => acc + r.recallK4, 0) / catItems.length;
            const avgP = catItems.reduce((acc, r) => acc + r.precisionK4, 0) / catItems.length;
            categoryMetrics[cat] = {
                count: catItems.length,
                meanRecallK4: Number(avgR.toFixed(3)),
                meanPrecisionK4: Number(avgP.toFixed(3))
            };
        }
    }

    // Per-split metrics
    const tuningItems = results.filter(r => r.split === 'tuning');
    const heldOutItems = results.filter(r => r.split === 'held_out');

    const tuningRecallK4 = tuningItems.length ? (tuningItems.reduce((acc, r) => acc + r.recallK4, 0) / tuningItems.length) : 0;
    const heldOutRecallK4 = heldOutItems.length ? (heldOutItems.reduce((acc, r) => acc + r.recallK4, 0) / heldOutItems.length) : 0;

    const summary = {
        timestamp: new Date().toISOString(),
        benchmarkVersion: '2.0.0',
        totalQueries: queries.length,
        splitSummary: {
            tuningCount: tuningItems.length,
            tuningRecallK4: Number(tuningRecallK4.toFixed(3)),
            heldOutCount: heldOutItems.length,
            heldOutRecallK4: Number(heldOutRecallK4.toFixed(3))
        },
        metrics: {
            goldEntityRecallAt4: Number(overallRecallK4.toFixed(3)),
            goldEntityRecallAt6: Number(overallRecallK6.toFixed(3)),
            tier1PrecisionAt4: Number(overallPrecisionK4.toFixed(3)),
            tier1PrecisionAt6: Number(overallPrecisionK6.toFixed(3)),
            echoPenaltiesTriggered: totalEchoPenaltiesTriggered,
            teasersDetected: totalTeasersDetected,
            latencyP50Ms: p50,
            latencyP95Ms: p95
        },
        categoryMetrics
    };

    writeFileSync(baselineOutputPath, JSON.stringify(summary, null, 2), 'utf8');

    console.log(`\n======================================================================`);
    console.log(`  Retrieval Benchmark Baseline Summary (v2)`);
    console.log(`======================================================================`);
    console.log(`  Gold-Entity Recall @ 4:  ${(overallRecallK4 * 100).toFixed(1)}%`);
    console.log(`  Gold-Entity Recall @ 6:  ${(overallRecallK6 * 100).toFixed(1)}%`);
    console.log(`  Tier-1 Precision @ 4:    ${(overallPrecisionK4 * 100).toFixed(1)}%`);
    console.log(`  Tier-1 Precision @ 6:    ${(overallPrecisionK6 * 100).toFixed(1)}%`);
    console.log(`  Tuning Split Recall:     ${(tuningRecallK4 * 100).toFixed(1)}% (${tuningItems.length} queries)`);
    console.log(`  Held-Out Split Recall:   ${(heldOutRecallK4 * 100).toFixed(1)}% (${heldOutItems.length} queries)`);
    console.log(`  Latency:                 p50=${p50}ms | p95=${p95}ms`);
    console.log(`  Baseline written to:     ${baselineOutputPath}`);
    console.log(`======================================================================\n`);

    return summary;
}

runBenchmark().catch(err => {
    console.error('Benchmark execution error:', err);
    process.exit(1);
});
