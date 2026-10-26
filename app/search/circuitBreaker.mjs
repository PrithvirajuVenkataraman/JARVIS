/**
 * SearXNG Per-Instance Circuit Breaker & Resilient Dispatcher
 * ─────────────────────────────────────────────────────────────
 * Implements a strict finite-state machine (CLOSED -> OPEN -> HALF_OPEN) per endpoint.
 *
 * State Transitions:
 *  - CLOSED --(trip rule)--> OPEN
 *  - OPEN --(cooldown elapsed)--> HALF_OPEN
 *  - HALF_OPEN --(probe success)--> CLOSED
 *  - HALF_OPEN --(probe failure)--> OPEN (exponential backoff capped at 60m + 10% jitter)
 *
 * Trip Rules:
 *  - HARD Failure (1st occurrence): 429, 403, Cloudflare/bot challenge, or 5xx overload.
 *  - TIMEOUT (2nd consecutive): 1st timeout records failure without tripping; 2nd consecutive trips.
 *  - SOFT Failure (3rd consecutive): 200 with non-JSON, malformed JSON, or empty results.
 *
 * Concurrency Protection:
 *  - HALF_OPEN allows exactly ONE in-flight probe; concurrent requests treat it as OPEN.
 *  - Client-aborted requests are NOT recorded as failures.
 */

import { SCORER_CONSTANTS, recordInstanceOutcome, rankEligibleInstances } from './instanceScorer.mjs';

export const BREAKER_STATES = Object.freeze({
    CLOSED: 'CLOSED',
    OPEN: 'OPEN',
    HALF_OPEN: 'HALF_OPEN'
});

export const FAILURE_TYPES = Object.freeze({
    HARD_FAILURE: 'HARD_FAILURE',
    TIMEOUT: 'TIMEOUT',
    SOFT_FAILURE: 'SOFT_FAILURE',
    CLIENT_ABORT: 'CLIENT_ABORT'
});

export const BREAKER_CONFIG = Object.freeze({
    BASE_COOLDOWN_MS: 5 * 60 * 1000, // 5 minutes
    MAX_COOLDOWN_MS: 60 * 60 * 1000,  // 60 minutes
    MAX_CONSECUTIVE_TIMEOUTS: 2,
    MAX_CONSECUTIVE_SOFT_FAILURES: 3,
    EXPLORATION_RATE: 0.10,          // 10% chance to explore 4th slot
    TOP_N_RACING: 4
});

/**
 * Global In-Memory Registry for SearXNG Instances (Per Warm Container)
 */
class SearXNGCircuitBreakerRegistry {
    constructor() {
        this.states = new Map();     // url -> BREAKER_STATES
        this.stats = new Map();      // url -> { history, ewmaLatencyMs, totalRequests, consecutiveTimeouts, consecutiveSoftFailures }
        this.cooldowns = new Map();  // url -> { openedAt, cooldownMs, backoffMultiplier }
        this.probing = new Set();    // set of urls currently in HALF_OPEN with an active in-flight probe
    }

    reset() {
        this.states.clear();
        this.stats.clear();
        this.cooldowns.clear();
        this.probing.clear();
    }

    getState(url, now = Date.now()) {
        const currentState = this.states.get(url) || BREAKER_STATES.CLOSED;
        if (currentState === BREAKER_STATES.OPEN) {
            const cooldown = this.cooldowns.get(url);
            if (cooldown && now >= (cooldown.openedAt + cooldown.cooldownMs)) {
                // Cooldown elapsed -> transition to HALF_OPEN
                this.states.set(url, BREAKER_STATES.HALF_OPEN);
                this._logTransition(url, BREAKER_STATES.OPEN, BREAKER_STATES.HALF_OPEN, 'cooldown_elapsed');
                return BREAKER_STATES.HALF_OPEN;
            }
        }
        return currentState;
    }

    getStats(url) {
        if (!this.stats.has(url)) {
            this.stats.set(url, {
                history: [],
                ewmaLatencyMs: null,
                totalRequests: 0,
                consecutiveTimeouts: 0,
                consecutiveSoftFailures: 0
            });
        }
        return this.stats.get(url);
    }

    _logTransition(url, from, to, reason) {
        // Structured single line without user queries or PII
        console.log(`[CircuitBreaker] TRANSITION endpoint="${url}" from="${from}" to="${to}" reason="${reason}"`);
    }

    /**
     * Determines whether an endpoint can accept a request right now.
     * Enforces that HALF_OPEN allows exactly ONE concurrent in-flight probe.
     *
     * @param {string} url
     * @param {number} [now=Date.now()]
     * @returns {boolean}
     */
    canAttempt(url, now = Date.now()) {
        const state = this.getState(url, now);
        if (state === BREAKER_STATES.CLOSED) {
            return true;
        }
        if (state === BREAKER_STATES.HALF_OPEN) {
            // Exactly one probe allowed at a time
            return !this.probing.has(url);
        }
        return false;
    }

    /**
     * Marks an endpoint as actively probing in HALF_OPEN state.
     *
     * @param {string} url
     * @returns {boolean} true if lease acquired, false if already probing
     */
    acquireProbeLease(url) {
        if (this.probing.has(url)) return false;
        this.probing.add(url);
        return true;
    }

    releaseProbeLease(url) {
        this.probing.delete(url);
    }

    /**
     * Records a successful response.
     *
     * @param {string} url
     * @param {number} latencyMs
     * @param {number} [now=Date.now()]
     */
    recordSuccess(url, latencyMs, now = Date.now()) {
        this.releaseProbeLease(url);
        const currentState = this.getState(url, now);
        const currentStats = this.getStats(url);

        // Reset consecutive failure counters
        currentStats.consecutiveTimeouts = 0;
        currentStats.consecutiveSoftFailures = 0;

        // Record telemetry outcome
        const updated = recordInstanceOutcome(currentStats, { success: true, latencyMs });
        this.stats.set(url, updated);

        if (currentState === BREAKER_STATES.HALF_OPEN) {
            // Probe success -> CLOSED (reset backoff multiplier)
            this.states.set(url, BREAKER_STATES.CLOSED);
            this.cooldowns.delete(url);
            this._logTransition(url, BREAKER_STATES.HALF_OPEN, BREAKER_STATES.CLOSED, 'probe_succeeded');
        } else if (currentState === BREAKER_STATES.OPEN) {
            // Unlikely, but close if open
            this.states.set(url, BREAKER_STATES.CLOSED);
            this.cooldowns.delete(url);
        }
    }

    /**
     * Records a failure and applies trip rules.
     *
     * @param {string} url
     * @param {object} failureDetails
     * @param {string} failureDetails.type One of FAILURE_TYPES
     * @param {string} [failureDetails.reason]
     * @param {number} [failureDetails.latencyMs]
     * @param {number} [now=Date.now()]
     * @param {function} [rng=Math.random]
     */
    recordFailure(url, failureDetails, now = Date.now(), rng = Math.random) {
        this.releaseProbeLease(url);
        const type = failureDetails?.type || FAILURE_TYPES.HARD_FAILURE;
        if (type === FAILURE_TYPES.CLIENT_ABORT) {
            // Hard-cancels issued by JARVIS must not penalize the endpoint
            return;
        }

        const currentState = this.getState(url, now);
        const currentStats = this.getStats(url);
        const updatedStats = recordInstanceOutcome(currentStats, { success: false, latencyMs: failureDetails?.latencyMs });

        let shouldTrip = false;
        let tripReason = failureDetails?.reason || type;

        if (currentState === BREAKER_STATES.HALF_OPEN) {
            // Failed probe -> Immediately trips back to OPEN with doubled backoff
            shouldTrip = true;
            tripReason = `probe_failed:${tripReason}`;
        } else if (type === FAILURE_TYPES.HARD_FAILURE) {
            // Hard failure trips on 1st occurrence
            shouldTrip = true;
        } else if (type === FAILURE_TYPES.TIMEOUT) {
            updatedStats.consecutiveTimeouts = (currentStats.consecutiveTimeouts || 0) + 1;
            if (updatedStats.consecutiveTimeouts >= BREAKER_CONFIG.MAX_CONSECUTIVE_TIMEOUTS) {
                shouldTrip = true;
                tripReason = `consecutive_timeouts_${updatedStats.consecutiveTimeouts}`;
            }
        } else if (type === FAILURE_TYPES.SOFT_FAILURE) {
            updatedStats.consecutiveSoftFailures = (currentStats.consecutiveSoftFailures || 0) + 1;
            if (updatedStats.consecutiveSoftFailures >= BREAKER_CONFIG.MAX_CONSECUTIVE_SOFT_FAILURES) {
                shouldTrip = true;
                tripReason = `consecutive_soft_failures_${updatedStats.consecutiveSoftFailures}`;
            }
        }

        this.stats.set(url, updatedStats);

        if (shouldTrip) {
            const prevCooldown = this.cooldowns.get(url);
            const currentMultiplier = (currentState === BREAKER_STATES.HALF_OPEN && prevCooldown)
                ? (prevCooldown.backoffMultiplier + 1)
                : 0;

            // Exponential backoff: base * 2^n capped at 60 min, with +/- 10% jitter
            const rawBackoff = Math.min(
                BREAKER_CONFIG.BASE_COOLDOWN_MS * Math.pow(2, currentMultiplier),
                BREAKER_CONFIG.MAX_COOLDOWN_MS
            );
            // Jitter in [-0.10, +0.10]
            const jitterRatio = 1 + ((rng() * 0.20) - 0.10);
            const effectiveCooldownMs = Math.round(rawBackoff * jitterRatio);

            this.cooldowns.set(url, {
                openedAt: now,
                cooldownMs: effectiveCooldownMs,
                backoffMultiplier: currentMultiplier
            });
            this.states.set(url, BREAKER_STATES.OPEN);
            this._logTransition(url, currentState, BREAKER_STATES.OPEN, tripReason);
        }
    }

    /**
     * Selects candidate instances for racing, applying top-4 ranking, probe leasing,
     * and optional 10% exploration of the 4th slot.
     *
     * @param {string[]} endpoints
     * @param {object} [options]
     * @param {number} [options.now]
     * @param {function} [options.rng]
     * @param {number} [options.limit=4]
     * @returns {{ primaryCandidates: string[], secondaryCandidates: string[], skippedOpen: string[] }}
     */
    selectRacingCandidates(endpoints, options = {}) {
        const now = options.now ?? Date.now();
        const rng = options.rng ?? Math.random;
        const limit = options.limit || BREAKER_CONFIG.TOP_N_RACING;

        // Synchronize breaker states to current timestamp
        const activeStates = new Map();
        const skippedOpen = [];

        for (const ep of endpoints) {
            const s = this.getState(ep, now);
            activeStates.set(ep, s);
            if (s === BREAKER_STATES.OPEN) {
                skippedOpen.push(ep);
            }
        }

        // Rank non-OPEN candidates by health score & EWMA latency
        const ranked = rankEligibleInstances(endpoints, this.stats, activeStates);

        // Filter: at most one HALF_OPEN probe allowed across the racing set
        const eligible = [];
        let probeCount = 0;

        for (const cand of ranked) {
            if (cand.state === BREAKER_STATES.HALF_OPEN) {
                if (probeCount === 0 && !this.probing.has(cand.url)) {
                    eligible.push(cand.url);
                    probeCount++;
                }
            } else {
                eligible.push(cand.url);
            }
        }

        if (eligible.length === 0) {
            return {
                primaryCandidates: [],
                secondaryCandidates: [],
                skippedOpen
            };
        }

        let primary = eligible.slice(0, limit);
        const secondary = eligible.slice(limit);

        // Exploration: ~10% probability, swap 4th slot with a lower-ranked CLOSED endpoint
        if (primary.length === limit && secondary.length > 0 && rng() < BREAKER_CONFIG.EXPLORATION_RATE) {
            // Pick a lower-ranked endpoint from secondary
            const exploreIdx = Math.floor(rng() * secondary.length);
            const candidateToExplore = secondary[exploreIdx];
            if (this.getState(candidateToExplore, now) === BREAKER_STATES.CLOSED) {
                const swappedOut = primary[limit - 1];
                primary[limit - 1] = candidateToExplore;
                secondary[exploreIdx] = swappedOut;
            }
        }

        return {
            primaryCandidates: primary,
            secondaryCandidates: secondary,
            skippedOpen
        };
    }

    /**
     * Debug accessor returning current registry snapshot.
     */
    getDebugState(now = Date.now()) {
        const snapshot = {};
        for (const [url, state] of this.states.entries()) {
            const effectiveState = this.getState(url, now);
            const stats = this.stats.get(url) || {};
            const cd = this.cooldowns.get(url);
            snapshot[url] = {
                state: effectiveState,
                score: this.stats.has(url) ? calculateHealthScore(this.stats.get(url)) : 0.5,
                ewmaLatencyMs: stats.ewmaLatencyMs,
                totalRequests: stats.totalRequests || 0,
                consecutiveTimeouts: stats.consecutiveTimeouts || 0,
                consecutiveSoftFailures: stats.consecutiveSoftFailures || 0,
                inCooldown: effectiveState === BREAKER_STATES.OPEN,
                cooldownRemainingMs: cd ? Math.max(0, (cd.openedAt + cd.cooldownMs) - now) : 0,
                isProbing: this.probing.has(url)
            };
        }
        return snapshot;
    }
}

// Singleton module-level instance
export const globalCircuitBreaker = new SearXNGCircuitBreakerRegistry();

/**
 * Checks whether the circuit breaker feature flag is enabled.
 * Defaults to true. Setting SEARCH_CIRCUIT_BREAKER=false disables it.
 */
export function isCircuitBreakerEnabled(options = {}) {
    if (typeof options.circuitBreaker === 'boolean') {
        return options.circuitBreaker;
    }
    const envVal = String(process.env.SEARCH_CIRCUIT_BREAKER || '').trim().toLowerCase();
    return envVal !== 'false' && envVal !== '0' && envVal !== 'off';
}

/**
 * Classifies an HTTP or network response into a standardized FAILURE_TYPES category.
 *
 * @param {object} params
 * @param {number} [params.status]
 * @param {Headers|object} [params.headers]
 * @param {string} [params.body]
 * @param {Error} [params.error]
 * @param {boolean} [params.isTimeout]
 * @param {boolean} [params.isClientAbort]
 * @param {any[]} [params.results]
 * @returns {string|null} FAILURE_TYPES value, or null if success
 */
export function classifyResponseOutcome({ status, headers = {}, body = '', error, isTimeout, isClientAbort, results }) {
    if (isClientAbort) {
        return FAILURE_TYPES.CLIENT_ABORT;
    }

    if (isTimeout || error?.name === 'TimeoutError' || (error?.name === 'AbortError' && String(error?.message).toLowerCase().includes('timeout'))) {
        return FAILURE_TYPES.TIMEOUT;
    }

    if (error && (error?.name === 'AbortError' || String(error?.message).includes('aborted by client'))) {
        return FAILURE_TYPES.CLIENT_ABORT;
    }

    // Check Cloudflare / Bot Challenge
    const hasCfHeader = Boolean(headers?.['cf-mitigated'] || headers?.get?.('cf-mitigated'));
    const bodyStr = typeof body === 'string' ? body.toLowerCase() : '';
    const hasChallengeMarkers = bodyStr.includes('cf-browser-verification') ||
        bodyStr.includes('challenge-running') ||
        bodyStr.includes('turnstile') ||
        bodyStr.includes('just a moment...') ||
        bodyStr.includes('security check');

    // Hard failures
    if (status === 429 || status === 403 || hasCfHeader || hasChallengeMarkers || (status >= 500 && status <= 599)) {
        return FAILURE_TYPES.HARD_FAILURE;
    }

    // If HTTP error without JSON
    if (status && status !== 200) {
        return FAILURE_TYPES.HARD_FAILURE;
    }

    // Soft failures on HTTP 200
    if (status === 200) {
        if (!Array.isArray(results) || results.length === 0) {
            return FAILURE_TYPES.SOFT_FAILURE;
        }
    }

    // Generic error
    if (error) {
        return FAILURE_TYPES.HARD_FAILURE;
    }

    return null; // Success
}

/**
 * Accessor returning current registry debug state snapshot.
 */
export function getCircuitBreakerDebugState(now = Date.now()) {
    return globalCircuitBreaker.getDebugState(now);
}
