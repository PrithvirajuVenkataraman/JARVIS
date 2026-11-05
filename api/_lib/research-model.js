import { createHash } from 'node:crypto';
import { researchTimeoutSignal, RESEARCH_LIMITS } from '../../app/search/research-contract.mjs';

const cooldowns = new Map();
const firstKey = value => String(value || '').split(/[,;\s]+/).find(Boolean) || '';
const healthKey = provider => createHash('sha256').update(`${provider.name}:${provider.model}:${provider.key}`).digest('hex');

export function clearResearchModelHealth() { cooldowns.clear(); }

export function researchModelProviders(options = {}) {
    const groq = firstKey(options.customGroqKey || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.GROQ_KEY);
    const gemini = String(options.customGeminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const selected = String(options.selectedModel || '');
    const providers = [];
    if (groq) providers.push({ name: 'groq', key: groq, model: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].includes(selected) ? selected : 'openai/gpt-oss-120b' });
    if (gemini) providers.push({ name: 'gemini', key: gemini, model: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(selected) ? selected : 'gemini-2.5-flash' });
    if (selected.startsWith('gemini-')) providers.reverse();
    return providers.filter(provider => {
        const key = healthKey(provider);
        const until = cooldowns.get(key) || 0;
        if (until <= Date.now()) { cooldowns.delete(key); return true; }
        return false;
    });
}

export async function consumeResearchSse(body, onEvent, signal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    const abort = () => { reader.cancel().catch(() => {}); };
    signal?.addEventListener('abort', abort, { once: true });
    const drain = final => {
        buffer = buffer.replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = final ? '' : events.pop();
        for (const event of events) {
            const text = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
            if (!text || text === '[DONE]') continue;
            let payload;
            try { payload = JSON.parse(text); } catch { continue; }
            onEvent(payload);
        }
    };
    try {
        while (!signal?.aborted) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 200000) throw new Error('Model response exceeded its limit');
            drain(false);
        }
        buffer += decoder.decode(); drain(true);
        if (signal?.aborted) throw signal.reason || new Error('Research cancelled');
    } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

function retryDelay(response) {
    const raw = response.headers?.get('retry-after') || '';
    const seconds = Number(raw);
    return Math.min(3600000, Math.max(1000, Number.isFinite(seconds) && raw ? seconds * 1000 : (Date.parse(raw) - Date.now()) || 60000));
}

// Text generation only; no billed search tools or quota-evasion key rotation.
export async function callResearchModel({ system, prompt, json = false, onToken, timeoutMs = RESEARCH_LIMITS.SYNTHESIS_MS, signal, budget, stage = 'answer', reserveAttempts = 0, maxAttempts = RESEARCH_LIMITS.MAX_ATTEMPTS_PER_GENERATION, maxOutputTokens, ...options }) {
    const ledger = budget || { calls: 0, maxCalls: RESEARCH_LIMITS.MAX_MODEL_CALLS };
    ledger.attempts ||= [];
    const allowance = Math.min(maxAttempts, Math.max(0, ledger.maxCalls - ledger.calls - reserveAttempts));
    if (!allowance || signal?.aborted) return null;
    const deadline = Date.now() + Math.max(1, timeoutMs);
    const providers = researchModelProviders(options).slice(0, allowance);
    if (!providers.length) ledger.attempts.push({ stage, outcome: 'no_available_credentials', durationMs: 0 });
    for (let index = 0; index < providers.length; index++) {
        if (signal?.aborted || ledger.calls >= ledger.maxCalls - reserveAttempts) break;
        const available = deadline - Date.now();
        if (available <= 0) break;
        const provider = providers[index];
        const fallbackReserve = index === 0 && providers.length > 1 ? Math.min(4000, Math.max(1, Math.floor(timeoutMs / 3))) : 0;
        const attemptMs = Math.max(1, Math.min(index === 0 ? 8000 : 4000, available - fallbackReserve));
        const scope = researchTimeoutSignal(attemptMs, signal);
        const attempt = { stage, provider: provider.name, model: provider.model, outcome: 'network_error', durationMs: 0 };
        const started = Date.now();
        ledger.calls++;
        let emitted = false;
        let abort;
        try {
            const task = async () => {
                const streaming = typeof onToken === 'function' && !json;
                const endpoint = provider.name === 'groq'
                    ? 'https://api.groq.com/openai/v1/chat/completions'
                    : `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:${streaming ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(provider.key)}`;
                const tokens = maxOutputTokens || (json ? 2400 : 3000);
                const body = provider.name === 'groq'
                    ? { model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: tokens, stream: streaming, ...(provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }
                    : { system_instruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: tokens, ...(json ? { responseMimeType: 'application/json' } : {}) } };
                const response = await fetch(endpoint, { method: 'POST', signal: scope.signal, headers: { 'Content-Type': 'application/json', ...(provider.name === 'groq' ? { Authorization: `Bearer ${provider.key}` } : {}) }, body: JSON.stringify(body) });
                attempt.httpStatus = response.status;
                if (!response.ok) {
                    attempt.outcome = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
                    if (response.status === 429) {
                        if (cooldowns.size >= 200) cooldowns.delete(cooldowns.keys().next().value);
                        cooldowns.set(healthKey(provider), Date.now() + retryDelay(response));
                    }
                    await response.body?.cancel().catch(() => {});
                    return null;
                }
                if (streaming) {
                    let text = '';
                    let finished = false;
                    await consumeResearchSse(response.body, data => {
                        if (data.error) throw new Error('Provider stream failed');
                        const token = provider.name === 'groq' ? data.choices?.[0]?.delta?.content : (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
                        if (token && !scope.signal.aborted) { text += token; emitted = true; onToken(token); }
                        const reason = provider.name === 'groq' ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
                        if (reason === 'stop' || reason === 'STOP') finished = true;
                    }, scope.signal);
                    attempt.outcome = finished && text.trim() ? 'success' : 'incomplete_response';
                    return finished && text.trim() ? text : null;
                }
                const data = await response.json();
                if (scope.signal.aborted) return null;
                const reason = provider.name === 'groq' ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
                if (reason && !['stop', 'STOP'].includes(reason)) { attempt.outcome = 'incomplete_response'; return null; }
                const text = provider.name === 'groq' ? data.choices?.[0]?.message?.content : (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
                if (!text) { attempt.outcome = 'empty_response'; return null; }
                if (!json) { attempt.outcome = 'success'; return text; }
                try {
                    const parsed = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
                    attempt.outcome = 'success'; return parsed;
                } catch { attempt.outcome = 'invalid_json'; return null; }
            };
            const cancelled = new Promise((_, reject) => {
                abort = () => reject(new Error('Model attempt cancelled'));
                if (scope.signal.aborted) abort(); else scope.signal.addEventListener('abort', abort, { once: true });
            });
            const result = await Promise.race([task(), cancelled]);
            if (result !== null) return result;
            if (emitted) return null;
        } catch {
            attempt.outcome = signal?.aborted ? 'cancelled' : scope.signal.aborted ? 'timeout' : 'network_error';
            if (emitted) return null;
        } finally {
            attempt.durationMs = Date.now() - started;
            ledger.attempts.push(attempt);
            scope.signal.removeEventListener('abort', abort);
            scope.dispose();
        }
    }
    return null;
}