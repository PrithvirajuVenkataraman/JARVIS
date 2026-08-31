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
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = options.signal;
    const abortExternal = () => controller.abort();
    externalSignal?.addEventListener?.('abort', abortExternal, { once: true });

    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
        return data;
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new ApiError('The request timed out or was cancelled.', {
                code: 'request_aborted',
                retryable: true
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

/**
 * Calls an LLM API (Groq primary, Gemini fallback) with the provided prompt.
 * @param {string} prompt - The user query or instruction.
 * @param {boolean} [isVision=false] - If true, use Gemini Vision endpoint (not implemented here).
 * @returns {Promise<{ success: boolean, response?: any, error?: string }>}
 */
export async function callLLM(prompt, isVision = false) {
    const groqKey = process.env.GROQ_API_KEY;
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!groqKey && !geminiKey) {
        return { success: false, error: 'Missing API keys for Groq and Gemini.' };
    }
    const buildGroqBody = (p) => ({
        model: 'mixtral-8x7b-32768',
        messages: [{ role: 'user', content: p }],
        temperature: 0.7
    });
    const buildGeminiBody = (p) => ({
        model: 'gemini-pro',
        contents: [{ role: 'user', parts: [{ text: p }] }],
        temperature: 0.7
    });
    // Try Groq first
    if (groqKey) {
        try {
            const groqResponse = await postJson('https://api.groq.com/openai/v1/chat/completions', buildGroqBody(prompt), {
                headers: { Authorization: `Bearer ${groqKey}` },
                timeoutMs: 30000
            });
            if (groqResponse && groqResponse.choices && groqResponse.choices[0] && groqResponse.choices[0].message) {
                return { success: true, response: groqResponse.choices[0].message.content };
            }
            return { success: false, error: 'Unexpected Groq response format.' };
        } catch (e) {
            if (e instanceof ApiError && e.retryable && geminiKey) {
                // fall through to Gemini fallback
            } else {
                return { success: false, error: e?.message || String(e) };
            }
        }
    }
    // Gemini fallback
    if (geminiKey) {
        try {
            const geminiResponse = await postJson(
                'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + encodeURIComponent(geminiKey),
                buildGeminiBody(prompt),
                { timeoutMs: 30000 }
            );
            if (
                geminiResponse &&
                geminiResponse.candidates &&
                geminiResponse.candidates[0] &&
                geminiResponse.candidates[0].content &&
                geminiResponse.candidates[0].content.parts
            ) {
                const parts = geminiResponse.candidates[0].content.parts;
                const text = parts.map(p => p.text).join('');
                return { success: true, response: text };
            }
            return { success: false, error: 'Unexpected Gemini response format.' };
        } catch (e) {
            return { success: false, error: e?.message || String(e) };
        }
    }
    return { success: false, error: 'No viable LLM provider available.' };
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
