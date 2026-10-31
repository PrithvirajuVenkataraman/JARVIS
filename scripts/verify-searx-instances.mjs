#!/usr/bin/env node
/**
 * SearXNG Public Instance Verifier
 * ────────────────────────────────
 * Standalone CLI tool to probe candidate SearXNG instances for:
 *  1. HTTPS protocol enforcement
 *  2. format=json endpoint validity
 *  3. Results payload shape and non-empty hit array
 *  4. Absence of Cloudflare / bot challenge pages
 *  5. Latency metrics (RTT)
 *
 * Usage:
 *   node scripts/verify-searx-instances.mjs [--query="canary"] [--timeout=3000] [--output=report.json]
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DEFAULT_POOL_PATH = join(__dirname, '../app/search/searxng-pool.json');
const CANARY_QUERY = 'world news today';
const DEFAULT_TIMEOUT_MS = 3000;

async function probeInstance(endpointUrl, query = CANARY_QUERY, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const started = Date.now();
    try {
        const url = new URL(endpointUrl);
        if (url.protocol !== 'https:') {
            return {
                url: endpointUrl,
                status: 'FAIL',
                error: 'Non-HTTPS protocol forbidden',
                latencyMs: 0
            };
        }

        url.searchParams.set('q', query);
        url.searchParams.set('format', 'json');
        url.searchParams.set('categories', 'general');

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        const response = await fetch(url.toString(), {
            method: 'GET',
            headers: {
                'Accept': 'application/json, text/javascript, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: controller.signal
        }).finally(() => clearTimeout(timer));

        const latencyMs = Date.now() - started;

        // Check Cloudflare / Bot Challenge header
        if (response.headers.get('cf-mitigated') || response.headers.get('cf-ray')) {
            if (response.status === 403 || response.status === 503) {
                return {
                    url: endpointUrl,
                    status: 'FAIL',
                    error: `Cloudflare challenge detected (HTTP ${response.status})`,
                    latencyMs
                };
            }
        }

        if (response.status === 429) {
            return {
                url: endpointUrl,
                status: 'FAIL',
                error: 'HTTP 429 Rate Limited',
                latencyMs
            };
        }

        if (!response.ok) {
            return {
                url: endpointUrl,
                status: 'FAIL',
                error: `HTTP ${response.status}`,
                latencyMs
            };
        }

        const rawText = await response.text();
        if (rawText.includes('cf-browser-verification') || rawText.includes('turnstile') || rawText.includes('just a moment...')) {
            return {
                url: endpointUrl,
                status: 'FAIL',
                error: 'Challenge page detected in body',
                latencyMs
            };
        }

        let data;
        try {
            data = JSON.parse(rawText);
        } catch (_) {
            return {
                url: endpointUrl,
                status: 'FAIL',
                error: 'Invalid JSON response',
                latencyMs
            };
        }

        if (!Array.isArray(data?.results) || data.results.length === 0) {
            return {
                url: endpointUrl,
                status: 'DEGRADED',
                error: 'Empty results array',
                latencyMs,
                resultCount: 0
            };
        }

        return {
            url: endpointUrl,
            status: 'PASS',
            latencyMs,
            resultCount: data.results.length
        };
    } catch (err) {
        return {
            url: endpointUrl,
            status: 'FAIL',
            error: err.name === 'AbortError' ? 'Timeout' : (err.message || 'Fetch failed'),
            latencyMs: Date.now() - started
        };
    }
}

async function runVerification() {
    console.log('=== SearXNG Public Instance Pool Verifier ===');
    let poolData;
    try {
        poolData = JSON.parse(readFileSync(DEFAULT_POOL_PATH, 'utf-8'));
    } catch (err) {
        console.error(`Failed to load pool file at ${DEFAULT_POOL_PATH}:`, err.message);
        process.exit(1);
    }

    const instances = Array.isArray(poolData?.instances) ? poolData.instances : [];
    console.log(`Auditing ${instances.length} candidate instances with canary: "${CANARY_QUERY}"...\n`);

    const results = [];
    for (const inst of instances) {
        process.stdout.write(`Testing: ${inst.url.padEnd(42)} ... `);
        const report = await probeInstance(inst.url);
        if (report.status === 'PASS') {
            console.log(`[PASS] (${report.latencyMs}ms, ${report.resultCount} hits)`);
        } else if (report.status === 'DEGRADED') {
            console.log(`[DEGRADED] (${report.error}, ${report.latencyMs}ms)`);
        } else {
            console.log(`[FAIL] (${report.error}, ${report.latencyMs}ms)`);
        }
        results.push({
            ...inst,
            verificationStatus: report.status,
            probeLatencyMs: report.latencyMs,
            probeError: report.error || null,
            probeDate: new Date().toISOString()
        });
    }

    const passedCount = results.filter(r => r.verificationStatus === 'PASS').length;
    console.log(`\nVerification Summary: ${passedCount}/${results.length} PASSED`);

    const outputReport = {
        auditDate: new Date().toISOString().split('T')[0],
        totalAudited: results.length,
        passedCount,
        results
    };

    const outPath = join(__dirname, `../app/search/searxng-verification-report-${outputReport.auditDate}.json`);
    writeFileSync(outPath, JSON.stringify(outputReport, null, 2), 'utf-8');
    console.log(`Full report saved to: ${outPath}`);
}

runVerification().catch(err => {
    console.error('Fatal verification error:', err);
    process.exit(1);
});
