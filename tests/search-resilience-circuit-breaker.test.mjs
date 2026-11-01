import test from 'node:test';
import assert from 'node:assert/strict';
import {
    globalCircuitBreaker,
    isCircuitBreakerEnabled,
    classifyResponseOutcome,
    FAILURE_TYPES,
    BREAKER_STATES,
    getCircuitBreakerDebugState
} from '../app/search/circuitBreaker.mjs';
import {
    calculateLatencyScore,
    calculateHealthScore,
    recordInstanceOutcome,
    rankEligibleInstances,
    SCORER_CONSTANTS
} from '../app/search/instanceScorer.mjs';
import {
    extractRegistrableDomain,
    normalizeSourceUrl,
    isVerifiedSource,
    evaluateDeepCorroboration,
    isEarlyExitEnabled,
    computeTokenJaccard,
    extractTokenSet
} from '../app/search/corroboration.mjs';
import { searchSearXNGRacer } from '../api/_lib/free-live/providers.js';

test('Case a: Hard failures (429, 403, challenge page, 5xx) trip on FIRST failure', () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const fakeNow = 1_000_000;

    // 1. HTTP 429 Rate Limit
    const url429 = 'https://searx1.test/search';
    assert.equal(registry.getState(url429, fakeNow), BREAKER_STATES.CLOSED);
    registry.recordFailure(url429, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'HTTP 429' }, fakeNow);
    assert.equal(registry.getState(url429, fakeNow), BREAKER_STATES.OPEN, '429 must trip immediately to OPEN');

    // 2. HTTP 403 Forbidden
    const url403 = 'https://searx2.test/search';
    assert.equal(registry.getState(url403, fakeNow), BREAKER_STATES.CLOSED);
    registry.recordFailure(url403, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'HTTP 403' }, fakeNow);
    assert.equal(registry.getState(url403, fakeNow), BREAKER_STATES.OPEN, '403 must trip immediately to OPEN');

    // 3. Cloudflare Bot Challenge page
    const outcomeChallenge = classifyResponseOutcome({
        status: 200,
        headers: {},
        body: '<html><head><title>Just a moment...</title></head><body><div class="cf-browser-verification"></div></body></html>'
    });
    assert.equal(outcomeChallenge, FAILURE_TYPES.HARD_FAILURE);
    const urlChallenge = 'https://searx3.test/search';
    registry.recordFailure(urlChallenge, { type: outcomeChallenge, reason: 'bot_challenge' }, fakeNow);
    assert.equal(registry.getState(urlChallenge, fakeNow), BREAKER_STATES.OPEN, 'Challenge page must trip immediately');

    // 4. HTTP 503 Overload
    const url503 = 'https://searx4.test/search';
    registry.recordFailure(url503, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'HTTP 503' }, fakeNow);
    assert.equal(registry.getState(url503, fakeNow), BREAKER_STATES.OPEN, '503 must trip immediately');
});

test('Case b: Timeouts (1st does not trip; 2nd consecutive trips; success resets count)', () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const fakeNow = 1_000_000;
    const urlTimeout = 'https://searx-timeout.test/search';

    // 1st timeout: records failure, remains CLOSED
    registry.recordFailure(urlTimeout, { type: FAILURE_TYPES.TIMEOUT, reason: 'timeout' }, fakeNow);
    assert.equal(registry.getState(urlTimeout, fakeNow), BREAKER_STATES.CLOSED, '1st timeout must NOT trip');
    assert.equal(registry.getStats(urlTimeout).consecutiveTimeouts, 1);

    // Success in between resets consecutive timeouts
    registry.recordSuccess(urlTimeout, 400, fakeNow);
    assert.equal(registry.getStats(urlTimeout).consecutiveTimeouts, 0, 'Success must reset consecutive timeouts');
    assert.equal(registry.getState(urlTimeout, fakeNow), BREAKER_STATES.CLOSED);

    // Now 1st timeout again
    registry.recordFailure(urlTimeout, { type: FAILURE_TYPES.TIMEOUT, reason: 'timeout' }, fakeNow);
    assert.equal(registry.getState(urlTimeout, fakeNow), BREAKER_STATES.CLOSED);
    assert.equal(registry.getStats(urlTimeout).consecutiveTimeouts, 1);

    // 2nd consecutive timeout -> Trips to OPEN!
    registry.recordFailure(urlTimeout, { type: FAILURE_TYPES.TIMEOUT, reason: 'timeout' }, fakeNow);
    assert.equal(registry.getState(urlTimeout, fakeNow), BREAKER_STATES.OPEN, '2nd consecutive timeout MUST trip to OPEN');
});

test('Case c: Soft failures (200+HTML, wrong JSON shape, empty results) trip only on 3rd consecutive', () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const fakeNow = 1_000_000;
    const urlSoft = 'https://searx-soft.test/search';

    // 1st soft failure
    registry.recordFailure(urlSoft, { type: FAILURE_TYPES.SOFT_FAILURE, reason: 'invalid_json' }, fakeNow);
    assert.equal(registry.getState(urlSoft, fakeNow), BREAKER_STATES.CLOSED, '1st soft failure must not trip');
    assert.equal(registry.getStats(urlSoft).consecutiveSoftFailures, 1);

    // 2nd soft failure
    registry.recordFailure(urlSoft, { type: FAILURE_TYPES.SOFT_FAILURE, reason: 'empty_results' }, fakeNow);
    assert.equal(registry.getState(urlSoft, fakeNow), BREAKER_STATES.CLOSED, '2nd soft failure must not trip');
    assert.equal(registry.getStats(urlSoft).consecutiveSoftFailures, 2);

    // 3rd soft failure -> Trips to OPEN!
    registry.recordFailure(urlSoft, { type: FAILURE_TYPES.SOFT_FAILURE, reason: 'non_json_html' }, fakeNow);
    assert.equal(registry.getState(urlSoft, fakeNow), BREAKER_STATES.OPEN, '3rd soft failure MUST trip to OPEN');
});

test('Case d: Cooldown (OPEN is bypassed; becomes HALF_OPEN at expiry; exactly 1 probe allowed)', () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const t0 = 1_000_000;
    const url = 'https://searx-cooldown.test/search';

    // Trip with 0% jitter for exact deterministic timestamp testing (rng returns 0.5 -> jitter=0)
    registry.recordFailure(url, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'HTTP 429' }, t0, () => 0.5);
    assert.equal(registry.getState(url, t0), BREAKER_STATES.OPEN);

    // Base cooldown is 5 minutes (300,000 ms)
    const tBeforeExpiry = t0 + 299_999;
    assert.equal(registry.getState(url, tBeforeExpiry), BREAKER_STATES.OPEN, 'Must remain OPEN before 5min');
    assert.equal(registry.canAttempt(url, tBeforeExpiry), false, 'Cannot attempt request while OPEN');

    // Exactly at 5 minutes: transitions to HALF_OPEN
    const tAtExpiry = t0 + 300_000;
    assert.equal(registry.getState(url, tAtExpiry), BREAKER_STATES.HALF_OPEN, 'Must become HALF_OPEN at expiry');
    assert.equal(registry.canAttempt(url, tAtExpiry), true, 'First probe must be permitted');

    // Acquire probe lease
    const lease1 = registry.acquireProbeLease(url);
    assert.equal(lease1, true, 'First probe lease must succeed');

    // Concurrency guard: A second concurrent request while probing must be rejected (treated as OPEN)
    assert.equal(registry.canAttempt(url, tAtExpiry), false, 'Second probe must be blocked while probe in flight');
    const lease2 = registry.acquireProbeLease(url);
    assert.equal(lease2, false, 'Second probe lease must fail');

    // Release probe lease
    registry.releaseProbeLease(url);
    assert.equal(registry.canAttempt(url, tAtExpiry), true, 'Can probe again after release');
});

test('Case e: Recovery (probe success closes breaker; probe failure re-opens with doubled cooldown)', () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const t0 = 1_000_000;
    const url = 'https://searx-recovery.test/search';

    // Trip with 0% jitter
    registry.recordFailure(url, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'HTTP 429' }, t0, () => 0.5);
    const tExpiry = t0 + 300_000;
    assert.equal(registry.getState(url, tExpiry), BREAKER_STATES.HALF_OPEN);

    // Scenario 1: Probe failure re-opens with doubled cooldown (5 min * 2^1 = 10 min = 600,000 ms)
    registry.recordFailure(url, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'probe_500' }, tExpiry, () => 0.5);
    assert.equal(registry.getState(url, tExpiry), BREAKER_STATES.OPEN, 'Failed probe must re-open breaker');

    // Check that cooldown is now 10 minutes: at tExpiry + 599_999 it is still OPEN
    assert.equal(registry.getState(url, tExpiry + 599_999), BREAKER_STATES.OPEN);
    // At tExpiry + 600_000 it becomes HALF_OPEN again
    assert.equal(registry.getState(url, tExpiry + 600_000), BREAKER_STATES.HALF_OPEN);

    // Scenario 2: Probe success closes the breaker
    registry.recordSuccess(url, 250, tExpiry + 600_000);
    assert.equal(registry.getState(url, tExpiry + 600_000), BREAKER_STATES.CLOSED, 'Successful probe must CLOSE breaker');
});

test('Case f: Scoring (formula matches Section 1.3 exactly; new endpoint gets 0.5; deterministic tie-breaks)', () => {
    // Formula: score = 0.6 * successRate + 0.4 * clamp(1 - ewmaLatency / 2800, 0, 1)

    // Table Test 1: New endpoint (no data)
    assert.equal(calculateHealthScore(null), 0.5, 'New endpoint gets 0.5');
    assert.equal(calculateHealthScore({ history: [] }), 0.5);

    // Table Test 2: Perfect endpoint (100% success, 0ms latency)
    // score = 0.6 * 1.0 + 0.4 * 1.0 = 1.0
    const perfectScore = calculateHealthScore({
        history: Array(20).fill(true),
        ewmaLatencyMs: 0
    });
    assert.equal(perfectScore, 1.0);

    // Table Test 3: Moderate endpoint (80% success = 16/20, 1400ms latency)
    // latencyScore = 1 - 1400/2800 = 0.5
    // score = 0.6 * 0.8 + 0.4 * 0.5 = 0.48 + 0.20 = 0.68
    const modScore = calculateHealthScore({
        history: [...Array(16).fill(true), ...Array(4).fill(false)],
        ewmaLatencyMs: 1400
    });
    assert.equal(modScore, 0.68);

    // Table Test 4: Heavy latency (100% success, 2800ms latency -> latencyScore = 0)
    // score = 0.6 * 1.0 + 0.4 * 0 = 0.60
    const slowScore = calculateHealthScore({
        history: Array(20).fill(true),
        ewmaLatencyMs: 2800
    });
    assert.equal(slowScore, 0.60);

    // Ranking test with tie-breaks:
    const endpoints = [
        'https://ep-slow.test/search',
        'https://ep-fast.test/search',
        'https://ep-new.test/search',
        'https://ep-open.test/search'
    ];
    const statsMap = new Map([
        ['https://ep-slow.test/search', { history: Array(20).fill(true), ewmaLatencyMs: 1400 }],
        ['https://ep-fast.test/search', { history: Array(20).fill(true), ewmaLatencyMs: 350 }]
    ]);
    const breakerStates = new Map([
        ['https://ep-slow.test/search', 'CLOSED'],
        ['https://ep-fast.test/search', 'CLOSED'],
        ['https://ep-new.test/search', 'CLOSED'],
        ['https://ep-open.test/search', 'OPEN'] // OPEN must be excluded completely
    ]);

    const ranked = rankEligibleInstances(endpoints, statsMap, breakerStates);
    assert.equal(ranked.length, 3, 'OPEN endpoint must be excluded before ranking');
    assert.equal(ranked[0].url, 'https://ep-fast.test/search', 'Fastest highest-scoring first');
    assert.equal(ranked[1].url, 'https://ep-slow.test/search', 'Moderate second');
    assert.equal(ranked[2].url, 'https://ep-new.test/search', 'New neutral third');
});

test('Case g: Racing (only top-4 contacted; all-4-fail triggers Tier 2; exploration swaps 4th slot; all OPEN falls through)', async () => {
    const registry = new (globalCircuitBreaker.constructor)();
    const fakeNow = 1_000_000;
    const contacted = [];

    const mockEndpoints = [
        'https://node1.test/search',
        'https://node2.test/search',
        'https://node3.test/search',
        'https://node4.test/search',
        'https://node5.test/search', // Tier 2
        'https://node6.test/search'  // Tier 2
    ];

    // Mock fetchFn: Tier 1 nodes (1-4) fail with 500; Tier 2 node5 succeeds!
    const mockFetch = async (urlStr) => {
        contacted.push(urlStr);
        if (urlStr.includes('node1') || urlStr.includes('node2') || urlStr.includes('node3') || urlStr.includes('node4')) {
            return {
                ok: false,
                status: 500,
                headers: {},
                text: async () => 'Server error'
            };
        }
        return {
            ok: true,
            status: 200,
            headers: {},
            text: async () => JSON.stringify({
                results: [{
                    title: 'Tier 2 Result',
                    url: 'https://reliable-news.org/story',
                    content: 'Valid content from tier 2 node'
                }]
            })
        };
    };

    const results = await searchSearXNGRacer('quantum computing update', {
        endpoints: mockEndpoints,
        circuitBreakerRegistry: registry,
        fetchFn: mockFetch,
        now: fakeNow,
        rng: () => 0.5 // no exploration swap (0.5 >= 0.10)
    });

    assert.ok(results.length > 0, 'Must get results from Tier 2');
    assert.equal(results[0].title, 'Tier 2 Result');

    // Verify Tier 1 (nodes 1-4) were contacted, and upon failure node 5/6 were launched!
    assert.ok(contacted.some(u => u.includes('node1')));
    assert.ok(contacted.some(u => u.includes('node4')));
    assert.ok(contacted.some(u => u.includes('node5')), 'Tier 2 node5 must be launched when Tier 1 fails');

    // All OPEN test: If every endpoint is OPEN, falls through to other providers without blocking
    for (const ep of mockEndpoints) {
        registry.recordFailure(ep, { type: FAILURE_TYPES.HARD_FAILURE, reason: '429' }, fakeNow);
    }
    const emptyResults = await searchSearXNGRacer('test fallback', {
        endpoints: mockEndpoints,
        circuitBreakerRegistry: registry,
        now: fakeNow
    });
    assert.deepEqual(emptyResults, [], 'Must return empty without blocking when all endpoints are OPEN');
});

test('Case h: Deep Corroboration Early-Exit (>=4 sources & >=2 domains; rejects insufficient sets; unwrap wrappers)', () => {
    // 1. Satisfied Set: 4 sources across 2 distinct domains (2 from reuters.com, 2 from bbc.com)
    const validSet = [
        { title: 'Story 1', snippet: 'Text 1', url: 'https://www.reuters.com/article/1' },
        { title: 'Story 2', snippet: 'Text 2', url: 'https://www.reuters.com/article/2' },
        { title: 'Story 3', snippet: 'Text 3', url: 'https://www.bbc.com/news/1' },
        { title: 'Story 4', snippet: 'Text 4', url: 'https://www.bbc.com/news/2' }
    ];
    const evalValid = evaluateDeepCorroboration(validSet);
    assert.equal(evalValid.satisfied, true, '4 sources across 2 domains must satisfy early exit');
    assert.equal(evalValid.verifiedCount, 4);
    assert.equal(evalValid.domainCount, 2);

    // 2. Reject: Only 3 sources (even with 2 domains)
    const threeSources = validSet.slice(0, 3);
    assert.equal(evaluateDeepCorroboration(threeSources).satisfied, false, '3 sources must not satisfy cutoff');

    // 3. Reject: 4 sources on ONLY 1 domain
    const singleDomain = [
        { title: 'A', snippet: 'S', url: 'https://apnews.com/a' },
        { title: 'B', snippet: 'S', url: 'https://apnews.com/b' },
        { title: 'C', snippet: 'S', url: 'https://apnews.com/c' },
        { title: 'D', snippet: 'S', url: 'https://apnews.com/d' }
    ];
    const evalSingle = evaluateDeepCorroboration(singleDomain);
    assert.equal(evalSingle.satisfied, false, '4 sources on 1 domain must NOT satisfy cutoff');
    assert.equal(evalSingle.domainCount, 1);

    // 4. Reject: 4 sources where Google redirect wrappers do NOT resolve to independent publishers
    const unresolvedWrappers = [
        { title: 'W1', snippet: 'S', url: 'https://news.google.com/rss/articles/123' },
        { title: 'W2', snippet: 'S', url: 'https://news.google.com/rss/articles/456' },
        { title: 'W3', snippet: 'S', url: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc' },
        { title: 'W4', snippet: 'S', url: 'https://www.google.com/url' }
    ];
    assert.equal(evaluateDeepCorroboration(unresolvedWrappers).satisfied, false, 'Unresolved wrappers must NOT count as independent domains');

    // 5. Unwrapped Google wrappers WITH declared publishers or query param
    const resolvedWrappers = [
        { title: 'W1', snippet: 'S', url: 'https://www.google.com/url?q=https://reuters.com/story1' },
        { title: 'W2', snippet: 'S', url: 'https://www.google.com/url?q=https://reuters.com/story2' },
        { title: 'W3', snippet: 'S', url: 'https://news.google.com/rss/articles/x', publisher: 'bbc.com' },
        { title: 'W4', snippet: 'S', url: 'https://news.google.com/rss/articles/y', publisher: 'bbc.com' }
    ];
    const evalResolved = evaluateDeepCorroboration(resolvedWrappers);
    assert.equal(evalResolved.satisfied, true, 'Unwrapped wrappers to independent domains must satisfy cutoff');
    assert.equal(evalResolved.domainCount, 2);
});

test('Case i: Legacy parity (with flags OFF, outputs match pre-change behavior)', async () => {
    // With SEARCH_CIRCUIT_BREAKER=false, breaker is bypassed
    assert.equal(isCircuitBreakerEnabled({ circuitBreaker: false }), false);
    assert.equal(isEarlyExitEnabled({ earlyExit: false }), false);

    // Mock fetch that records legacy endpoint mapping
    const endpoints = ['https://ep1.test/search', 'https://ep2.test/search'];
    let callCount = 0;
    const mockLegacyFetch = async (urlStr) => {
        callCount++;
        return {
            ok: true,
            status: 200,
            headers: {},
            json: async () => ({
                results: [{ title: 'Legacy Result', url: 'https://example.com/1', content: 'Legacy content' }]
            })
        };
    };

    const res = await searchSearXNGRacer('legacy test', {
        endpoints,
        circuitBreaker: false,
        fetchFn: mockLegacyFetch
    });
    assert.ok(res.length > 0);
    assert.equal(res[0].title, 'Legacy Result');
});

test('Case j: Domain normalization (eTLD+1 compound TLDs, subdomains, www, deduplication)', () => {
    // 1. Compound TLDs
    assert.equal(extractRegistrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
    assert.equal(extractRegistrableDomain('sub.portal.gov.in'), 'portal.gov.in');
    assert.equal(extractRegistrableDomain('sydney.com.au'), 'sydney.com.au');
    assert.equal(extractRegistrableDomain('www.nature.com'), 'nature.com');

    // 2. Subdomains collapse to same domain
    const d1 = extractRegistrableDomain('m.en.wikipedia.org');
    const d2 = extractRegistrableDomain('en.wikipedia.org');
    const d3 = extractRegistrableDomain('wikipedia.org');
    assert.equal(d1, d2);
    assert.equal(d2, d3);
    assert.equal(d1, 'wikipedia.org');

    // 3. Token Jaccard syndication check
    const titleA = 'OpenAI announces new frontier model with reasoning';
    const titleB = 'OpenAI announces new frontier model with reasoning capabilities';
    const jaccard = computeTokenJaccard(extractTokenSet(titleA), extractTokenSet(titleB));
    assert.ok(jaccard >= 0.85, 'Near-identical syndicated wire titles must have high Jaccard');
});
