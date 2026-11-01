// Shared by the server orchestrator and its browser client. Keep below Vercel's 60s limit.
export const RESEARCH_LIMITS = Object.freeze({
    TOTAL_MS: 50000,
    RETRIEVAL_MS: 24000,
    SYNTHESIS_MS: 20000,
    CLIENT_GRACE_MS: 3000,
    PROVIDER_MS: 3500,
    PAGE_MS: 3500,
    PLAN_MS: 1800,
    MAX_ROUNDS: 3,
    MAX_QUERIES: 6,
    MAX_PAGES: 10,
    MAX_SOURCES: 8,
    MAX_CONCURRENCY: 3,
    MAX_MODEL_CALLS: 4
});

export function researchTimeoutSignal(timeoutMs, parentSignal) {
    const controller = new AbortController();
    const abort = () => controller.abort(parentSignal?.reason);
    if (parentSignal?.aborted) abort();
    else parentSignal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Research deadline reached')), Math.max(1, timeoutMs));
    return {
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose() { clearTimeout(timer); parentSignal?.removeEventListener('abort', abort); }
    };
}
