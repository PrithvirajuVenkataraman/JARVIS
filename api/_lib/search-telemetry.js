/**
 * Stage 0: Search Provider Observability & Outcome Telemetry
 * ──────────────────────────────────────────────────────────
 * Logs per-provider outcomes for every live search:
 *  - Provider name (searxng, ddg, gemini, google_news, wikipedia, etc.)
 *  - Execution latency (ms)
 *  - Result count
 *  - HTTP status / resolution status
 *  - Timeout / abort flag
 *  - Whether any provider results were used in the final synthesized answer
 *
 * Feature Flag:
 *  SEARCH_STAGE0_OBSERVABILITY_ENABLED=true  (default: false)
 *  Also activated per-call via options.observability = true
 */

import { performance } from 'node:perf_hooks';

export function isObservabilityEnabled(options = {}) {
    if (options && typeof options.observability === 'boolean') {
        return options.observability;
    }
    return String(process.env.SEARCH_STAGE0_OBSERVABILITY_ENABLED || process.env.SEARCH_OBSERVABILITY_ENABLED || '').trim().toLowerCase() === 'true';
}

export function createSearchTelemetryTracker(query = '', options = {}) {
    const enabled = isObservabilityEnabled(options);
    const startTime = performance.now();
    const providers = new Map();

    function startProvider(name) {
        if (!enabled) return;
        providers.set(name, {
            provider: name,
            startTime: performance.now(),
            endTime: null,
            latencyMs: 0,
            resultCount: 0,
            status: 0,
            timedOut: false,
            aborted: false,
            error: null,
            usedInAnswer: false
        });
    }

    function finishProvider(name, outcome = {}) {
        if (!enabled) return;
        const entry = providers.get(name) || {
            provider: name,
            startTime: performance.now(),
            endTime: null,
            latencyMs: 0,
            resultCount: 0,
            status: 0,
            timedOut: false,
            aborted: false,
            error: null,
            usedInAnswer: false
        };

        const now = performance.now();
        entry.endTime = now;
        entry.latencyMs = Number((now - entry.startTime).toFixed(1));
        entry.resultCount = Number(outcome.resultCount) || 0;
        entry.status = outcome.status !== undefined ? outcome.status : (entry.resultCount > 0 ? 200 : (outcome.error ? 500 : 204));
        entry.timedOut = Boolean(outcome.timedOut);
        entry.aborted = Boolean(outcome.aborted);
        entry.error = outcome.error ? String(outcome.error) : null;
        if (outcome.usedInAnswer !== undefined) {
            entry.usedInAnswer = Boolean(outcome.usedInAnswer);
        }

        providers.set(name, entry);
    }

    function markUsedInAnswer(finalResults = []) {
        if (!enabled || !Array.isArray(finalResults)) return;
        const finalUrls = new Set(finalResults.map(r => String(r?.url || '').trim()).filter(Boolean));

        for (const [name, entry] of providers.entries()) {
            // Check if any results matched this provider
            const matched = finalResults.some(r => {
                if (r.__provider === name) return true;
                if (name === 'searxng' && (r.qualitySignals?.includes('searxng_json') || r.source?.includes('SearXNG'))) return true;
                if (name === 'duckduckgo' && (r.qualitySignals?.includes('ddg_html') || r.qualitySignals?.includes('ddg_api') || r.source?.includes('DuckDuckGo'))) return true;
                if (name === 'gemini_grounding' && (r.qualitySignals?.includes('google_search_grounding') || r.source?.includes('Google Grounding'))) return true;
                if (name === 'wikipedia' && (r.url?.includes('wikipedia.org') || r.source?.includes('Wikipedia'))) return true;
                if (name === 'wikidata' && (r.url?.includes('wikidata.org') || r.source?.includes('Wikidata'))) return true;
                if (name === 'google_news_rss' && (r.source?.includes('Google News') || r.qualitySignals?.includes('google_news_rss'))) return true;
                if (name === 'gdelt' && (r.source?.includes('GDELT') || r.qualitySignals?.includes('gdelt_doc'))) return true;
                if (name === 'yahoo_finance' && (r.source?.includes('Yahoo Finance') || r.qualitySignals?.includes('yahoo_finance'))) return true;
                if (name === 'government_role' && (r.evidenceLevel === 'structured_claim' || r.source?.includes('Government Record'))) return true;
                return false;
            });

            if (matched) {
                entry.usedInAnswer = true;
            }
        }
    }

    function getReport() {
        if (!enabled) return null;
        const totalDurationMs = Number((performance.now() - startTime).toFixed(1));
        const providerList = Array.from(providers.values()).map(p => ({
            provider: p.provider,
            latencyMs: p.latencyMs,
            resultCount: p.resultCount,
            status: p.status,
            timedOut: p.timedOut,
            aborted: p.aborted,
            error: p.error,
            usedInAnswer: p.usedInAnswer
        }));

        const totalResults = providerList.reduce((acc, p) => acc + p.resultCount, 0);
        const winningProviders = providerList.filter(p => p.usedInAnswer).map(p => p.provider);

        return {
            query,
            totalDurationMs,
            providerCount: providerList.length,
            totalResultsCollected: totalResults,
            winningProviders,
            providers: providerList
        };
    }

    function logReport() {
        if (!enabled) return;
        const report = getReport();
        if (!report) return;
        for (const p of report.providers) {
            console.log(`[SearchProviderTelemetry] query="${query.slice(0, 40)}" provider=${p.provider} status=${p.status} latency=${p.latencyMs}ms count=${p.resultCount} timedOut=${p.timedOut} usedInAnswer=${p.usedInAnswer}`);
        }
    }

    return {
        enabled,
        startProvider,
        finishProvider,
        markUsedInAnswer,
        getReport,
        logReport
    };
}
