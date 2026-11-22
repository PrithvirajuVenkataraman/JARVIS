export class ApiError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = Number(options.status) || 0;
        this.code = String(options.code || 'request_failed');
        this.retryable = Boolean(options.retryable);
        this.details = options.details ?? null;
    }
}

export async function postJson(path, payload, options = {}) {
    const timeoutMs = clamp(options.timeoutMs, 30000, 1000, 60000);
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
    const externalSignal = options.signal;
    const abortExternal = () => controller.abort();
    externalSignal?.addEventListener?.('abort', abortExternal, { once: true });

    try {
        if (externalSignal?.aborted) {
            throw new ApiError('The request was cancelled.', { code: 'request_aborted' });
        }
        const headers = new Headers(options.headers || {});
        if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
        const response = await fetch(path, {
            method: 'POST',
            headers,
            signal: controller.signal,
            body: JSON.stringify(payload ?? {})
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || data?.success === false) {
            const error = data?.error;
            const code = String(error?.code || data?.code || 'request_failed');
            throw new ApiError(
                formatApiErrorMessage(response.status, code, error?.message || error),
                {
                    status: response.status,
                    code,
                    retryable: response.status === 429 || response.status >= 500,
                    details: error?.details || null
                }
            );
        }
        if (!data || typeof data !== 'object') {
            throw new ApiError('The service returned an invalid response.', { code: 'invalid_response', status: response.status });
        }
        return data;
    } catch (error) {
        if (controller.signal.aborted || error?.name === 'AbortError') {
            throw new ApiError(timedOut ? 'The request timed out. Please try again.' : 'The request was cancelled.', {
                code: timedOut ? 'request_timeout' : 'request_aborted',
                retryable: timedOut
            });
        }
        if (error instanceof ApiError) throw error;
        throw new ApiError('The service is unavailable. Please try again.', {
            code: 'network_error',
            retryable: true,
            details: String(error?.message || error)
        });
    } finally {
        clearTimeout(timeout);
        externalSignal?.removeEventListener?.('abort', abortExternal);
    }
}

// Model credentials and provider routing belong exclusively on the server.
export async function callLLM(prompt, isVision = false) {
    try {
        const data = await postJson('/api/chat-groq', {message: String(prompt || ''), intent: isVision ? 'vision' : 'chat', stream: false});
        return {success:true, response:data.response || data.text || ''};
    } catch (error) { return {success:false, error:error.message}; }
}

function formatApiErrorMessage(status, code, message) {
    if (status === 403 && code === 'origin_not_allowed') {
        return 'This deployment is blocking same-origin API calls. Add the site URL to CORS_ALLOWED_ORIGINS or allow same-origin requests.';
    }
    return String(message || `Request failed with status ${status}`);
}

function clamp(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}
