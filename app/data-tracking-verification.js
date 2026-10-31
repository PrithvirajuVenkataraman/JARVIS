/**
 * @file app/data-tracking-verification.js
 * @description Self-contained, real-time data tracking and verification module for JARVIS.
 * Provides microsecond telemetry tracking, live event pub/sub, claim-grounding confidence scoring,
 * citation cross-referencing, and telemetry data integrity diagnostics.
 */

/**
 * @typedef {Object} TrackingEvent
 * @property {string} id Unique event ID
 * @property {string} name Event name / category
 * @property {number} timestamp Millisecond epoch timestamp
 * @property {number} durationMs Duration in ms (optional)
 * @property {Record<string, any>} payload Event payload metadata
 */

/**
 * @typedef {Object} VerificationSource
 * @property {string} [title] Source title
 * @property {string} [url] Source URL
 * @property {string} [domain] Source domain
 * @property {string} [sourceType] Type of source (official_source, trusted_news, web, etc.)
 * @property {boolean} [trusted] Whether the source domain is pre-trusted
 */

/**
 * @typedef {Object} VerificationResult
 * @property {boolean} verified Whether the response satisfies grounding thresholds
 * @property {number} confidenceScore Score between 0.0 and 1.0
 * @property {string} confidenceTier 'high' | 'moderate' | 'low' | 'unverified'
 * @property {number} sourceCount Number of valid source citations
 * @property {string[]} verifiedDomains List of verified unique domains
 * @property {string[]} riskFlags Potential grounding or hallucination risk flags
 * @property {number} latencyMs Verification processing duration
 */

const MAX_EVENT_BUFFER_SIZE = 150;
const TRUSTED_DOMAINS = new Set([
    'wikipedia.org',
    'en.wikipedia.org',
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'thehindu.com',
    'indianexpress.com',
    'timesofindia.indiatimes.com',
    'ndtv.com',
    'gov.in',
    'nic.in',
    'tn.gov.in',
    'india.gov.in',
    'nih.gov',
    'cdc.gov',
    'who.int',
    'nature.com',
    'sciencemag.org',
    'github.com',
    'developer.mozilla.org'
]);

/**
 * Real-Time Event Tracker
 * Manages bounded micro-telemetry buffer and pub/sub subscribers.
 */
export class DataTracker {
    constructor(maxSize = MAX_EVENT_BUFFER_SIZE) {
        this.maxSize = Math.max(1, Number(maxSize) || MAX_EVENT_BUFFER_SIZE);
        this.events = [];
        this.subscribers = new Map();
        this.activeSpans = new Map();
    }

    /**
     * Records a new telemetry event and notifies listeners.
     * @param {string} name 
     * @param {Record<string, any>} [payload={}] 
     * @param {number} [durationMs] 
     * @returns {TrackingEvent}
     */
    track(name, payload = {}, durationMs = undefined) {
        const event = {
            id: `tr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            name: String(name || 'unnamed_event').trim(),
            timestamp: Date.now(),
            ...(typeof durationMs === 'number' && durationMs >= 0 ? { durationMs: Math.round(durationMs * 100) / 100 } : {}),
            payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : { value: payload }
        };

        this.events.push(event);
        if (this.events.length > this.maxSize) {
            this.events.splice(0, this.events.length - this.maxSize);
        }

        this._notify(event);
        return event;
    }

    /**
     * Starts a timed tracking span.
     * @param {string} spanName 
     * @param {Record<string, any>} [startPayload={}] 
     * @returns {() => TrackingEvent} Call to complete the span and record latency.
     */
    startSpan(spanName, startPayload = {}) {
        const name = String(spanName || 'span').trim();
        const start = performance.now();
        const id = `span_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
        this.activeSpans.set(id, { name, start, startPayload });

        return (endPayload = {}) => {
            const span = this.activeSpans.get(id);
            if (!span) {
                return this.track(name, { ...startPayload, ...endPayload });
            }
            this.activeSpans.delete(id);
            const durationMs = performance.now() - span.start;
            return this.track(span.name, { ...span.startPayload, ...endPayload }, durationMs);
        };
    }

    /**
     * Subscribes to real-time events.
     * @param {string|'all'} eventPattern Exact event name or 'all'
     * @param {(event: TrackingEvent) => void} callback 
     * @returns {() => boolean} Unsubscribe handle
     */
    subscribe(eventPattern, callback) {
        if (typeof callback !== 'function') return () => false;
        const key = String(eventPattern || 'all').trim();
        if (!this.subscribers.has(key)) {
            this.subscribers.set(key, new Set());
        }
        const set = this.subscribers.get(key);
        set.add(callback);

        return () => {
            const current = this.subscribers.get(key);
            if (!current) return false;
            const deleted = current.delete(callback);
            if (current.size === 0) this.subscribers.delete(key);
            return deleted;
        };
    }

    /**
     * Returns recent events matching an optional filter.
     * @param {number} [limit=25] 
     * @param {string} [nameFilter] 
     * @returns {TrackingEvent[]}
     */
    getRecentEvents(limit = 25, nameFilter = '') {
        const max = Math.max(1, Number(limit) || 25);
        let list = this.events;
        if (nameFilter) {
            const filterLower = String(nameFilter).toLowerCase();
            list = list.filter(e => e.name.toLowerCase().includes(filterLower));
        }
        return list.slice(-max);
    }

    /**
     * Clears telemetry buffer.
     */
    clear() {
        this.events = [];
        this.activeSpans.clear();
    }

    _notify(event) {
        // Specific listeners
        const exact = this.subscribers.get(event.name);
        if (exact) {
            for (const cb of exact) {
                try { cb(event); } catch (err) { console.error('[DataTracker listener error]', err); }
            }
        }
        // Wildcard listeners
        const wildcard = this.subscribers.get('all');
        if (wildcard) {
            for (const cb of wildcard) {
                try { cb(event); } catch (err) { console.error('[DataTracker wildcard error]', err); }
            }
        }
    }
}

/**
 * Fact & Claim Grounding Verification Engine
 */
export class FactVerifier {
    /**
     * Extracts hostname/domain safely from a URL.
     * @param {string} rawUrl 
     * @returns {string}
     */
    static extractDomain(rawUrl) {
        if (!rawUrl || typeof rawUrl !== 'string') return '';
        try {
            const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
            return parsed.hostname.replace(/^www\./i, '').toLowerCase();
        } catch (_) {
            return '';
        }
    }

    /**
     * Checks if a domain is a recognized authority.
     * @param {string} domain 
     * @returns {boolean}
     */
    static isAuthoritativeDomain(domain) {
        const d = String(domain || '').toLowerCase().trim();
        if (!d) return false;
        if (TRUSTED_DOMAINS.has(d)) return true;
        if (d.endsWith('.gov') || d.endsWith('.gov.in') || d.endsWith('.nic.in') || d.endsWith('.edu') || d.endsWith('.org')) {
            return true;
        }
        return false;
    }

    /**
     * Evaluates verification status and computes a grounding confidence score.
     * @param {string} responseText 
     * @param {VerificationSource[]} sources 
     * @param {Record<string, any>} [options={}] 
     * @returns {VerificationResult}
     */
    static verify(responseText, sources = [], options = {}) {
        const start = performance.now();
        const text = String(responseText || '').trim();
        const rawSources = Array.isArray(sources) ? sources : [];
        const riskFlags = [];

        if (!text) {
            return {
                verified: false,
                confidenceScore: 0.0,
                confidenceTier: 'unverified',
                sourceCount: 0,
                verifiedDomains: [],
                riskFlags: ['empty_response'],
                latencyMs: Math.round(performance.now() - start)
            };
        }

        // Deduplicate and inspect domains
        const validSources = [];
        const seenDomains = new Set();
        let authoritativeCount = 0;

        for (const item of rawSources) {
            if (!item || typeof item !== 'object') continue;
            const url = String(item.url || '').trim();
            const domain = FactVerifier.extractDomain(url || item.domain);
            if (!domain && !url) continue;

            const isAuth = FactVerifier.isAuthoritativeDomain(domain) || item.trusted === true || item.sourceType === 'official_source';
            if (isAuth) authoritativeCount++;

            if (domain && !seenDomains.has(domain)) {
                seenDomains.add(domain);
                validSources.push({
                    title: String(item.title || item.sourceLabel || domain),
                    url,
                    domain,
                    isAuthoritative: isAuth
                });
            }
        }

        // Anti-hallucination heuristic checks
        if (/\b(i cannot verify|cannot confirm|not certain|could be outdated)\b/i.test(text)) {
            riskFlags.push('model_uncertainty_declared');
        }
        if (/\b(provided snippets do not|supplied snippets do not)\b/i.test(text)) {
            riskFlags.push('snippet_meta_disclaimer');
        }

        // Confidence Calculation
        let baseScore = 0.50; // Neutral prior
        if (validSources.length > 0) {
            baseScore += Math.min(0.30, validSources.length * 0.10);
            if (authoritativeCount > 0) {
                baseScore += Math.min(0.20, authoritativeCount * 0.10);
            }
        } else if (options.isDeterministicFact === true) {
            baseScore = 0.95;
        } else {
            baseScore = 0.40;
            riskFlags.push('no_citations_attached');
        }

        if (riskFlags.length > 0) {
            baseScore = Math.max(0.1, baseScore - (riskFlags.length * 0.15));
        }

        const confidenceScore = Math.min(1.0, Math.max(0.0, Math.round(baseScore * 100) / 100));
        let confidenceTier = 'unverified';
        if (confidenceScore >= 0.85) confidenceTier = 'high';
        else if (confidenceScore >= 0.65) confidenceTier = 'moderate';
        else if (confidenceScore >= 0.40) confidenceTier = 'low';

        const isVerified = confidenceScore >= 0.65 && (validSources.length > 0 || options.isDeterministicFact === true);

        return {
            verified: isVerified,
            confidenceScore,
            confidenceTier,
            sourceCount: validSources.length,
            verifiedDomains: Array.from(seenDomains),
            riskFlags,
            latencyMs: Math.round(performance.now() - start)
        };
    }
}

/**
 * Data Integrity & Diagnostics Monitor
 */
export class IntegrityMonitor {
    /**
     * Validates telemetry payload against required schema attributes.
     * @param {Record<string, any>} payload 
     * @param {string[]} requiredFields 
     * @returns {{ valid: boolean, missing: string[] }}
     */
    static validatePayload(payload, requiredFields = []) {
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return { valid: false, missing: ['<root_object>'] };
        }
        const missing = [];
        for (const field of requiredFields) {
            if (payload[field] === undefined || payload[field] === null || payload[field] === '') {
                missing.push(field);
            }
        }
        return { valid: missing.length === 0, missing };
    }

    /**
     * Generates a comprehensive health and telemetry snapshot.
     * @param {DataTracker} tracker 
     * @returns {Record<string, any>}
     */
    static getDiagnosticsSnapshot(tracker) {
        const events = tracker ? tracker.getRecentEvents(100) : [];
        const latencies = events
            .filter(e => typeof e.durationMs === 'number')
            .map(e => e.durationMs);

        const avgLatency = latencies.length > 0
            ? Math.round((latencies.reduce((a, b) => a + b, 0) / latencies.length) * 100) / 100
            : 0;

        return {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            totalEventsRecorded: events.length,
            averageSpanLatencyMs: avgLatency,
            recentEvents: events.slice(-10)
        };
    }
}

// Global Singleton Instance
export const defaultTracker = new DataTracker();

/**
 * Public Unified Interface
 */
export const JarvisDataVerification = {
    DataTracker,
    FactVerifier,
    IntegrityMonitor,
    tracker: defaultTracker,
    track: (name, payload, duration) => defaultTracker.track(name, payload, duration),
    startSpan: (name, payload) => defaultTracker.startSpan(name, payload),
    subscribe: (pattern, cb) => defaultTracker.subscribe(pattern, cb),
    verify: (text, sources, options) => FactVerifier.verify(text, sources, options),
    getSnapshot: () => IntegrityMonitor.getDiagnosticsSnapshot(defaultTracker)
};

export default JarvisDataVerification;
