import { AsyncLocalStorage } from 'node:async_hooks';

export const REQUEST_DEADLINE_MS = 52000;
const requestScope = new AsyncLocalStorage();

export function currentRequestSignal() { return requestScope.getStore()?.signal; }

export function withRequestLifecycle(handler) {
    return async (req, res) => {
        const lifecycle = createRequestLifecycle(req, res);
        return requestScope.run(lifecycle, async () => {
            try { return await handler(req, res); }
            finally { lifecycle.dispose(); }
        });
    };
}

export function runWithSignal(signal, task) {
    const parent = requestScope.getStore();
    return requestScope.run({ ...parent, signal: parent?.signal ? AbortSignal.any([parent.signal, signal]) : signal }, task);
}

export function allowGenerationAttempts(limit = 2) {
    const scope = requestScope.getStore();
    if (!scope?.budget) return;
    const requested = Number(limit);
    if (Number.isFinite(requested) && requested > 0) {
        scope.budget.maxGenerationAttempts = Math.max(scope.budget.maxGenerationAttempts || 2, Math.min(8, Math.floor(requested)));
    }
}

export function fetchWithLifecycle(input, init = {}) {
    const scope = requestScope.getStore();
    const signal = scope?.signal;
    const composed = signal && init.signal ? AbortSignal.any([signal, init.signal]) : signal || init.signal;
    if (composed?.aborted) return Promise.reject(composed.reason);
    if (scope?.budget && /\/chat\/completions|:(?:streamGenerateContent|generateContent)|\/interactions(?:\?|$)/.test(String(input))) {
        const limit = scope.budget.maxGenerationAttempts || 2;
        if (scope.budget.generationAttempts >= limit) return Promise.reject(Object.assign(new Error('The request exhausted its model-attempt budget.'), { code: 'attempt_budget_exhausted' }));
        scope.budget.generationAttempts++;
    }
    return globalThis.fetch(input, { ...init, signal: composed });
}

export function fetchRouterWithLifecycle(input, init = {}) {
    const scope = requestScope.getStore();
    const signal = scope?.signal;
    const composed = signal && init.signal ? AbortSignal.any([signal, init.signal]) : signal || init.signal;
    if (composed?.aborted) return Promise.reject(composed.reason);
    if (scope?.budget) {
        const maxRouterAttempts = 2;
        if ((scope.budget.routerAttempts || 0) >= maxRouterAttempts) {
            return Promise.reject(Object.assign(new Error('The request exhausted its router-attempt budget.'), { code: 'router_budget_exhausted' }));
        }
        scope.budget.routerAttempts = (scope.budget.routerAttempts || 0) + 1;
    }
    return globalThis.fetch(input, { ...init, signal: composed });
}

export function createRequestLifecycle(req, res, timeoutMs = REQUEST_DEADLINE_MS) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const abort = () => controller.abort(new DOMException('The client disconnected.', 'AbortError'));
    const close = () => { if (!res?.writableEnded) abort(); };
    const timer = setTimeout(() => controller.abort(new DOMException('Request deadline exceeded.', 'TimeoutError')), timeoutMs);
    timer.unref?.();
    req?.on?.('aborted', abort);
    res?.on?.('close', close);
    req?.signal?.addEventListener('abort', abort, { once: true });
    if (req?.aborted || req?.signal?.aborted) abort();
    return {
        signal: controller.signal,
        budget: { generationAttempts: 0, maxGenerationAttempts: 2 },
        deadlineAt: startedAt + timeoutMs,
        remainingMs: () => Math.max(0, startedAt + timeoutMs - Date.now()),
        dispose() {
            clearTimeout(timer);
            req?.removeListener?.('aborted', abort);
            res?.removeListener?.('close', close);
            req?.signal?.removeEventListener('abort', abort);
            if (!controller.signal.aborted) controller.abort();
        }
    };
}
