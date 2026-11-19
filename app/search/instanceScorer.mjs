/**
 * SearXNG Instance Scorer
 * ───────────────────────────────────────
 * Pure, deterministic health and latency scoring for search engine endpoints.
 *
 * Scoring Formula:
 *   score = 0.6 * successRate(rolling last 20) + 0.4 * latencyScore
 *   latencyScore = clamp(1 - ewmaLatencyMs / 2800, 0, 1)  (EWMA alpha = 0.3)
 *
 * Invariants:
 *  - New endpoint with no history: default score 0.5 (neutral eligibility).
 *  - Tie-break: lowest EWMA latency, then stable registry order.
 *  - OPEN endpoints are excluded before ranking.
 */

export const SCORER_CONSTANTS = Object.freeze({
    MAX_LATENCY_BUDGET_MS: 2800,
    EWMA_ALPHA: 0.3,
    ROLLING_WINDOW_SIZE: 20,
    DEFAULT_NEUTRAL_SCORE: 0.5,
    WEIGHT_SUCCESS: 0.6,
    WEIGHT_LATENCY: 0.4
});

/**
 * Computes the normalized latency score [0, 1] relative to the 2800ms budget.
 *
 * @param {number} ewmaLatencyMs
 * @param {number} [maxBudgetMs=2800]
 * @returns {number}
 */
export function calculateLatencyScore(ewmaLatencyMs, maxBudgetMs = SCORER_CONSTANTS.MAX_LATENCY_BUDGET_MS) {
    if (!Number.isFinite(ewmaLatencyMs) || ewmaLatencyMs < 0) {
        return 0.5; // neutral fallback
    }
    const score = 1 - (ewmaLatencyMs / maxBudgetMs);
    return Math.max(0, Math.min(1, score));
}

/**
 * Computes health score for an endpoint based on rolling history and latency.
 *
 * @param {object} stats
 * @param {boolean[]} [stats.history] Rolling window of boolean outcomes (true=success, false=failure)
 * @param {number} [stats.ewmaLatencyMs]
 * @param {number} [stats.totalRequests]
 * @returns {number}
 */
export function calculateHealthScore(stats) {
    if (!stats || !Array.isArray(stats.history) || stats.history.length === 0) {
        return SCORER_CONSTANTS.DEFAULT_NEUTRAL_SCORE;
    }

    const window = stats.history.slice(-SCORER_CONSTANTS.ROLLING_WINDOW_SIZE);
    const successCount = window.filter(Boolean).length;
    const successRate = successCount / window.length;

    const ewma = Number.isFinite(stats.ewmaLatencyMs) ? stats.ewmaLatencyMs : 1400;
    const latencyScore = calculateLatencyScore(ewma);

    const score = (SCORER_CONSTANTS.WEIGHT_SUCCESS * successRate) + (SCORER_CONSTANTS.WEIGHT_LATENCY * latencyScore);
    return Math.max(0, Math.min(1, Number(score.toFixed(4))));
}

/**
 * Updates an instance's telemetry stats with a new outcome and latency measurement.
 *
 * @param {object} currentStats
 * @param {object} update
 * @param {boolean} update.success
 * @param {number} [update.latencyMs]
 * @param {number} [alpha=0.3]
 * @returns {object} updated stats object
 */
export function recordInstanceOutcome(currentStats, { success, latencyMs }, alpha = SCORER_CONSTANTS.EWMA_ALPHA) {
    const stats = currentStats ? { ...currentStats } : {
        history: [],
        ewmaLatencyMs: null,
        totalRequests: 0,
        consecutiveTimeouts: 0,
        consecutiveSoftFailures: 0
    };

    stats.history = Array.isArray(stats.history) ? [...stats.history, Boolean(success)] : [Boolean(success)];
    if (stats.history.length > SCORER_CONSTANTS.ROLLING_WINDOW_SIZE) {
        stats.history = stats.history.slice(-SCORER_CONSTANTS.ROLLING_WINDOW_SIZE);
    }
    stats.totalRequests = (stats.totalRequests || 0) + 1;

    if (Number.isFinite(latencyMs) && latencyMs >= 0) {
        if (!Number.isFinite(stats.ewmaLatencyMs) || stats.ewmaLatencyMs === null) {
            stats.ewmaLatencyMs = latencyMs;
        } else {
            stats.ewmaLatencyMs = (alpha * latencyMs) + ((1 - alpha) * stats.ewmaLatencyMs);
        }
        stats.ewmaLatencyMs = Math.round(stats.ewmaLatencyMs * 100) / 100;
    }

    return stats;
}

/**
 * Ranks candidate endpoints by health score, breaking ties by lowest EWMA latency,
 * then original registry order. OPEN endpoints are excluded.
 *
 * @param {Array<string|object>} endpoints Array of endpoints or objects with url
 * @param {Map<string, object>|Record<string, object>} statsMap Map of endpoint URL -> stats
 * @param {Map<string, string>|Record<string, string>} breakerStates Map of endpoint URL -> breaker state ('CLOSED'|'HALF_OPEN'|'OPEN')
 * @returns {Array<{ url: string, score: number, ewmaLatencyMs: number, state: string, originalIndex: number }>}
 */
export function rankEligibleInstances(endpoints, statsMap = new Map(), breakerStates = new Map()) {
    if (!Array.isArray(endpoints)) return [];

    const getStats = (url) => {
        if (statsMap instanceof Map) return statsMap.get(url) || null;
        return statsMap[url] || null;
    };

    const getState = (url) => {
        if (breakerStates instanceof Map) return breakerStates.get(url) || 'CLOSED';
        return breakerStates[url] || 'CLOSED';
    };

    const candidates = [];
    endpoints.forEach((ep, index) => {
        const url = typeof ep === 'string' ? ep : ep?.url;
        if (!url) return;

        const state = getState(url);
        // Exclude OPEN endpoints completely before ranking
        if (state === 'OPEN') return;

        const stats = getStats(url);
        const score = calculateHealthScore(stats);
        const ewma = Number.isFinite(stats?.ewmaLatencyMs) ? stats.ewmaLatencyMs : 1400;

        candidates.push({
            url,
            score,
            ewmaLatencyMs: ewma,
            state,
            originalIndex: index
        });
    });

    candidates.sort((a, b) => {
        // Primary: highest score
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        // Secondary tie-break: lower EWMA latency
        if (a.ewmaLatencyMs !== b.ewmaLatencyMs) {
            return a.ewmaLatencyMs - b.ewmaLatencyMs;
        }
        // Tertiary tie-break: stable registry order
        return a.originalIndex - b.originalIndex;
    });

    return candidates;
}
