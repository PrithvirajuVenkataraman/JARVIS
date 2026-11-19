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
import { validateEnv } from './config.js';
// Simple console logger (no external dependency)
const logger = {
  info:   (...args) => console.info('[INFO]',  ...args),
  error:  (...args) => console.error('[ERROR]', ...args),
  warn:   (...args) => console.warn('[WARN]',   ...args),
  debug:  (...args) => console.debug('[DEBUG]', ...args),
};

// In‑memory cache for LLM responses
const llmCache = new Map();
const getCached = (key) => llmCache.get(key);
const setCached = (key, value) => llmCache.set(key, value);

export async function callLLM(prompt, isVision = false) {
    // Validate environment variables
    const { groqKey, geminiKey } = validateEnv();
    if (!groqKey && !geminiKey) {
        logger.error('Missing LLM API keys');
        return { success: false, error: 'Missing API keys for Groq and Gemini.' };
    }
    // Check cache first
    const cached = getCached(prompt);
    if (cached) {
        logger.info('LLM cache hit');
        return { success: true, response: cached };
    }
    const buildGroqBody = (p) => ({ model: 'mixtral-8x7b-32768', messages: [{ role: 'user', content: p }], temperature: 0.7 });
    const buildGeminiBody = (p) => ({ model: 'gemini-pro', contents: [{ role: 'user', parts: [{ text: p }] }], temperature: 0.7 });
    // Helper to perform request with retry/backoff
    const requestWithRetry = async (url, body, headers) => {
        const maxRetries = 2;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const resp = await postJson(url, body, { headers, timeoutMs: 30000 });
                return { success: true, data: resp };
            } catch (e) {
                if (e instanceof ApiError && e.retryable && attempt < maxRetries) {
                    const backoff = 200 * Math.pow(2, attempt);
                    await new Promise(r => setTimeout(r, backoff));
                    continue;
                }
                return { success: false, error: e?.message || String(e) };
            }
        }
    };
    // Try Groq first
    if (groqKey) {
        const result = await requestWithRetry('https://api.groq.com/openai/v1/chat/completions', buildGroqBody(prompt), { Authorization: `Bearer ${groqKey}` });
        if (result.success && result.data?.choices?.[0]?.message?.content) {
            const answer = result.data.choices[0].message.content;
            setCached(prompt, answer);
            logger.info('Groq LLM success');
            return { success: true, response: answer };
        }
        if (!geminiKey) return { success: false, error: result.error };
    }
    // Gemini fallback
    if (geminiKey) {
        const result = await requestWithRetry('https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=' + encodeURIComponent(geminiKey), buildGeminiBody(prompt), {});
        if (result.success && result.data?.candidates?.[0]?.content?.parts) {
            const text = result.data.candidates[0].content.parts.map(p => p.text).join('');
            setCached(prompt, text);
            logger.info('Gemini LLM success');
            return { success: true, response: text };
        }
        return { success: false, error: result.error || 'Gemini response malformed.' };
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
