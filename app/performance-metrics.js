const events = [];
const turns = new Map();
const MAX_EVENTS = 120;
const allowed = new Set(['send', 'first-visible-answer', 'answer-complete', 'cancelled', 'render', 'storage', 'lcp', 'cls', 'inp', 'long-task']);

export function recordMetric(stage, durationMs = 0) {
    if (!allowed.has(stage)) return;
    events.push({ stage, durationMs: Math.max(0, Math.round(Number(durationMs) || 0)), at: Date.now() });
    if (events.length > MAX_EVENTS) events.shift();
}

export function startTurn(id) { turns.set(id, performance.now()); recordMetric('send'); }
export function markTurn(id, stage) {
    const start = turns.get(id);
    if (start === undefined) return;
    recordMetric(stage, performance.now() - start);
    if (['answer-complete', 'cancelled'].includes(stage)) turns.delete(id);
}
export function getMetrics() { return events.map(event => ({ ...event })); }

export function installPerformanceObservers() {
    if (typeof PerformanceObserver === 'undefined') return;
    for (const type of ['largest-contentful-paint', 'layout-shift', 'event', 'longtask']) {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
        try {
            new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                    if (type === 'layout-shift' && entry.hadRecentInput) continue;
                    const stage = { 'largest-contentful-paint': 'lcp', 'layout-shift': 'cls', event: 'inp', longtask: 'long-task' }[type];
                    recordMetric(stage, type === 'largest-contentful-paint' ? entry.startTime : type === 'layout-shift' ? entry.value * 1000 : entry.duration);
                }
            }).observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 40 } : {}) });
        } catch { /* An older browser may not support buffered observation. */ }
    }
}
