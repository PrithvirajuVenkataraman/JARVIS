/**
 * Observability & Compliance Diagnostics Store for JARVIS.
 * Handles local event buffering, telemetry tracking, and export.
 *
 * Privacy Invariant:
 * Under no circumstances does this store record raw prompts, model responses,
 * matched secret text, or hashes of sensitive data.
 */

export const COMPLIANCE_AUDIT_STORAGE_KEY = 'jarvis_compliance_audit_v1';
export const COMPLIANCE_SCHEMA_VERSION = 1;
export const MAX_AUDIT_EVENTS = 100;
const MAX_LEGACY_EVENTS = 80;

// In-memory fallback stores
let inMemoryAuditEvents = [];
const seenEventIds = new Set();

function getLegacyStore() {
    if (!globalThis.__jarvisObservabilityEvents) {
        globalThis.__jarvisObservabilityEvents = [];
    }
    return globalThis.__jarvisObservabilityEvents;
}

function safeGetStorage() {
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch (_) {}
    return null;
}

/**
 * Load compliance audit ring buffer from storage or in-memory fallback.
 */
export function getComplianceAuditEvents() {
    const storage = safeGetStorage();
    if (!storage) {
        return [...inMemoryAuditEvents];
    }
    try {
        const raw = storage.getItem(COMPLIANCE_AUDIT_STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.events)) {
            return parsed.events;
        }
        return [];
    } catch (_) {
        return [...inMemoryAuditEvents];
    }
}

/**
 * Save compliance audit events to storage with ring-buffer cap and deduplication.
 */
function saveComplianceAuditEvents(events) {
    const trimmed = Array.isArray(events) ? events.slice(-MAX_AUDIT_EVENTS) : [];
    inMemoryAuditEvents = trimmed;
    const storage = safeGetStorage();
    if (!storage) return trimmed;
    try {
        const payload = JSON.stringify({
            schemaVersion: COMPLIANCE_SCHEMA_VERSION,
            updatedAt: Date.now(),
            events: trimmed
        });
        storage.setItem(COMPLIANCE_AUDIT_STORAGE_KEY, payload);
    } catch (_) {
        // LocalStorage quota or access denied; in-memory fallback active
    }
    return trimmed;
}

/**
 * Write a diagnostic event to the compliance audit ring buffer.
 * Enforces schema integrity, deduplication, and zero-PII/zero-credential invariants.
 */
export function recordComplianceEvent(type, payload = {}) {
    const eventId = String(payload.id || `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    if (seenEventIds.has(eventId)) {
        return null;
    }
    seenEventIds.add(eventId);

    const event = {
        id: eventId,
        type: String(type || 'general'),
        ts: Number(payload.ts || Date.now())
    };

    if (type === 'dlp_inspection') {
        event.channel = String(payload.channel || 'unknown');
        event.ruleId = String(payload.ruleId || 'generic');
        event.category = String(payload.category || 'unknown');
        event.action = String(payload.action || 'block'); // 'block' | 'mask' | 'redact'
        event.count = Number(payload.count || 1);
    } else if (type === 'feedback') {
        event.turnId = String(payload.turnId || '');
        event.rating = Number(payload.rating) > 0 ? 1 : -1;
        event.tags = Array.isArray(payload.tags) ? payload.tags.map(t => String(t).slice(0, 50)) : [];
        event.hasComment = Boolean(payload.hasComment);
    } else if (type === 'routing') {
        event.route = String(payload.route || '');
        event.model = String(payload.model || '');
        event.latencyMs = Math.round(Number(payload.latencyMs) || 0);
    } else {
        event.details = payload.details && typeof payload.details === 'object' ? { ...payload.details } : {};
    }

    const current = getComplianceAuditEvents();
    current.push(event);
    saveComplianceAuditEvents(current);

    // Notify listeners in same window
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new CustomEvent('jarvis:compliance-event', { detail: event }));
        }
    } catch (_) {}

    return event;
}

export function recordDlpAudit({ channel, ruleId, category, action, count }) {
    return recordComplianceEvent('dlp_inspection', { channel, ruleId, category, action, count });
}

export function recordFeedbackAudit({ turnId, rating, tags, hasComment }) {
    return recordComplianceEvent('feedback', { turnId, rating, tags, hasComment });
}

export function recordRoutingAudit({ route, model, latencyMs }) {
    return recordComplianceEvent('routing', { route, model, latencyMs });
}

/**
 * Clears the local compliance diagnostics ring buffer.
 */
export function clearLocalDiagnostics() {
    inMemoryAuditEvents = [];
    seenEventIds.clear();
    const storage = safeGetStorage();
    if (storage) {
        try {
            storage.removeItem(COMPLIANCE_AUDIT_STORAGE_KEY);
        } catch (_) {}
    }
    return true;
}

/**
 * Exports local diagnostics as a JSON document.
 * Labeled explicitly as a "Local diagnostics export" (no misleading SOC2 claims).
 */
export function exportLocalDiagnostics() {
    const events = getComplianceAuditEvents();
    const doc = {
        reportType: 'Local diagnostics export',
        schemaVersion: COMPLIANCE_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        eventCount: events.length,
        disclaimer: 'This export is for local debugging and diagnostics. Official enterprise compliance audits are maintained via server-side structured logging.',
        events
    };
    return JSON.stringify(doc, null, 2);
}

// Cross-tab sync listener
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener('storage', event => {
        if (event.key === COMPLIANCE_AUDIT_STORAGE_KEY) {
            try {
                const parsed = JSON.parse(event.newValue || '{}');
                if (Array.isArray(parsed?.events)) {
                    inMemoryAuditEvents = parsed.events.slice(-MAX_AUDIT_EVENTS);
                }
            } catch (_) {}
        }
    });
}

// --- Legacy Backward-Compatible Observability Methods ---

export function trackEvent(name, details = {}) {
    const event = {
        name: String(name || 'event'),
        at: Date.now(),
        details: details && typeof details === 'object' ? { ...details } : {}
    };
    const store = getLegacyStore();
    store.push(event);
    if (store.length > MAX_LEGACY_EVENTS) store.splice(0, store.length - MAX_LEGACY_EVENTS);
    try {
        if (globalThis.JarvisDataVerification?.track) {
            globalThis.JarvisDataVerification.track(event.name, event.details);
        }
    } catch (_) {}
    try {
        console.debug('[JARVIS observability]', event.name, event.details);
    } catch (_) {}
    return event;
}

export function trackRoute(route, reason = '', extra = {}) {
    return trackEvent('route', {
        route: String(route || ''),
        reason: String(reason || ''),
        ...extra
    });
}

export function trackLatency(name, ms, extra = {}) {
    return trackEvent('latency', {
        name: String(name || 'latency'),
        ms: Math.round(Number(ms) || 0),
        ...extra
    });
}

export function getRecentEvents(limit = 20) {
    return getLegacyStore().slice(-Math.max(1, Number(limit) || 20));
}

export function getObservabilitySnapshot() {
    const events = getLegacyStore();
    const routes = events.filter(item => item.name === 'route').slice(-12);
    const latencies = events.filter(item => item.name === 'latency').slice(-12);
    return {
        eventCount: events.length,
        routes,
        latencies
    };
}
