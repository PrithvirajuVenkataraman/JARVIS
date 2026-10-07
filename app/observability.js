const MAX_EVENTS = 80;

function getStore() {
    if (!globalThis.__jarvisObservabilityEvents) {
        globalThis.__jarvisObservabilityEvents = [];
    }
    return globalThis.__jarvisObservabilityEvents;
}

export function trackEvent(name, details = {}) {
    const event = {
        name: String(name || 'event'),
        at: Date.now(),
        details: details && typeof details === 'object' ? { ...details } : {}
    };
    const store = getStore();
    store.push(event);
    if (store.length > MAX_EVENTS) store.splice(0, store.length - MAX_EVENTS);
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
    return getStore().slice(-Math.max(1, Number(limit) || 20));
}

export function getObservabilitySnapshot() {
    const events = getStore();
    const routes = events.filter(item => item.name === 'route').slice(-12);
    const latencies = events.filter(item => item.name === 'latency').slice(-12);
    return {
        eventCount: events.length,
        routes,
        latencies
    };
}
