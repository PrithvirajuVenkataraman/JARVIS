/**
 * Stage 0: Live Search Network Canary
 * ────────────────────────────────────
 * Standalone live probe script to inspect live upstream provider reachability
 * (Wikipedia, DuckDuckGo, SearXNG public instances).
 *
 * NOTE: This script makes REAL outbound network requests.
 * It is NOT run in CI or npm test. Run manually via:
 *   node tests/canary-live-search.mjs
 */

import { performance } from 'node:perf_hooks';
import { searchWikipedia } from '../api/search.js';
import { searchDuckDuckGoHtml, searchSearXNGRacer } from '../api/_lib/free-live/providers.js';

async function probeProvider(name, query, fetcher) {
    const start = performance.now();
    try {
        const results = await fetcher(query);
        const duration = Number((performance.now() - start).toFixed(1));
        const count = Array.isArray(results) ? results.length : 0;
        const status = count > 0 ? 'HEALTHY' : 'EMPTY_RESULTS';
        const sample = count > 0 ? `"${results[0].title.slice(0, 50)}..."` : 'N/A';
        return { provider: name, status, count, durationMs: duration, sample, error: null };
    } catch (err) {
        const duration = Number((performance.now() - start).toFixed(1));
        return { provider: name, status: 'FAILED', count: 0, durationMs: duration, sample: 'N/A', error: err?.message || String(err) };
    }
}

async function main() {
    console.log('=== Live Search Network Canary Probe (Manual / Non-CI) ===\n');
    console.log('Testing live reachability to public web and reference endpoints...\n');

    const testQuery = 'Next.js';

    const probes = await Promise.all([
        probeProvider('Wikipedia API', testQuery, q => searchWikipedia(q, { limit: 3, timeoutMs: 3000 })),
        probeProvider('DuckDuckGo HTML/Lite', testQuery, q => searchDuckDuckGoHtml(q, { limit: 3, timeoutMs: 3500 })),
        probeProvider('SearXNG Public Fallbacks', testQuery, q => searchSearXNGRacer(q, { limit: 3, timeoutMs: 3500 }))
    ]);

    console.table(probes.map(p => ({
        Provider: p.provider,
        Status: p.status,
        Results: p.count,
        'Latency (ms)': `${p.durationMs} ms`,
        'Sample Result': p.sample
    })));

    const allSuccessful = probes.some(p => p.count > 0);
    if (allSuccessful) {
        console.log('\n[Canary Status] Reachability confirmed on at least one public provider.\n');
    } else {
        console.warn('\n[Canary Warning] All public web providers returned 0 results or timed out from current network/IP.\n');
    }
}

main().catch(err => {
    console.error('Canary execution failed:', err);
});
