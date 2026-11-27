import { fetchWithLifecycle as fetch } from './request-lifecycle.js';
import { normalizeGeminiGenerationConfig } from './model-failure.js';
import { createHash } from 'node:crypto';
import { researchTimeoutSignal, RESEARCH_LIMITS } from '../../app/search/research-contract.mjs';

const cooldowns = new Map();
const TRANSIENT_COOLDOWN_MS = 90_000;
const DEPRECATED_COOLDOWN_MS = 10 * 60_000;
const firstKey = value => String(value || '').split(/[,;\s]+/).find(Boolean) || '';
const providerHealthKey = provider => createHash('sha256').update(`provider:${provider.name}:${provider.key}`).digest('hex');
const modelHealthKey = provider => createHash('sha256').update(`model:${provider.name}:${provider.model}:${provider.key}`).digest('hex');

function isCoolingDown(key) {
    const until = cooldowns.get(key) || 0;
    if (until <= Date.now()) {
        cooldowns.delete(key);
        return false;
    }
    return true;
}

function recordCooldown(key, durationMs) {
    if (!key || !Number.isFinite(durationMs) || durationMs <= 0) return;
    if (cooldowns.size >= 200) cooldowns.delete(cooldowns.keys().next().value);
    cooldowns.set(key, Date.now() + durationMs);
}

export function clearResearchModelHealth() { cooldowns.clear(); }

export function researchModelProviders(options = {}) {
    const groq = firstKey(options.customGroqKey || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.GROQ_KEY);
    const gemini = String(options.customGeminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const selected = String(options.selectedModel || '').trim();
    const configuredGemini = String(process.env.GEMINI_MODEL || '').trim();
    const allowedGroq = ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'];
    const allowedGemini = ['gemini-2.5-flash', 'gemini-3.5-flash', 'gemini-2.5-flash-lite', 'gemini-4-hydrogen', 'gemini-3.8-flash', 'gemini-2.5-pro'];

    const geminiModels = gemini
        ? [...new Set([
            allowedGemini.includes(selected) ? selected : '',
            'gemini-2.5-flash',
            'gemini-2.5-flash-lite',
            configuredGemini.startsWith('gemini-') && allowedGemini.includes(configuredGemini) ? configuredGemini : '',
            'gemini-3.5-flash',
            'gemini-4-hydrogen'
        ].filter(Boolean))]
        : [];
    const groqModels = groq
        ? [...new Set([
            allowedGroq.includes(selected) ? selected : '',
            'openai/gpt-oss-120b',
            'qwen/qwen3.8-27b',
            'openai/gpt-oss-20b'
        ].filter(Boolean))]
        : [];

    const providers = [];
    if (groqModels.length && !isCoolingDown(providerHealthKey({ name: 'groq', key: groq }))) {
        const activeGroq = groqModels.find(model => !isCoolingDown(modelHealthKey({ name: 'groq', key: groq, model })));
        if (activeGroq) providers.push({ name: 'groq', key: groq, model: activeGroq });
    }
    if (geminiModels.length && !isCoolingDown(providerHealthKey({ name: 'gemini', key: gemini }))) {
        const activeGemini = geminiModels.find(model => !isCoolingDown(modelHealthKey({ name: 'gemini', key: gemini, model })));
        if (activeGemini) providers.push({ name: 'gemini', key: gemini, model: activeGemini });
    }
    // Prefer Groq (openai/gpt-oss-120b -> qwen/qwen3.8-27b) by default for synthesis;
    // reverse to Gemini only when explicitly selected by the user.
    if (selected.startsWith('gemini-')) providers.reverse();
    return providers;
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
    return Math.min(3600000, Math.max(1000, Number.isFinite(seconds) && raw ? seconds * 1000 : (Date.parse(raw) - Date.now()) || 15000));
}

// Text generation only; no billed search tools or quota-evasion key rotation.
export async function callResearchModel({ system, prompt, json = false, onToken, timeoutMs = RESEARCH_LIMITS.SYNTHESIS_MS, signal, budget, stage = 'answer', reserveAttempts = 0, maxAttempts = RESEARCH_LIMITS.MAX_ATTEMPTS_PER_GENERATION, maxOutputTokens, ...options }) {
    const ledger = budget || { calls: 0, maxCalls: RESEARCH_LIMITS.MAX_MODEL_CALLS };
    ledger.attempts ||= [];
    const allowance = Math.min(maxAttempts, Math.max(0, ledger.maxCalls - ledger.calls - reserveAttempts));
    if (!allowance || signal?.aborted) return null;
    const deadline = Date.now() + Math.max(1, timeoutMs);
    const initialProviders = researchModelProviders(options);
    if (!initialProviders.length) {
        ledger.attempts.push({ stage, outcome: 'no_available_credentials', durationMs: 0 });
        return null;
    }
    const tried = new Set();
    let lastProviderName = '';
    for (let index = 0; index < allowance; index++) {
        if (signal?.aborted || ledger.calls >= ledger.maxCalls - reserveAttempts) break;
        const available = deadline - Date.now();
        if (available <= 0) break;
        const avoidSet = new Set(Array.isArray(options.avoidModels) ? options.avoidModels : []);
        const rawCandidates = researchModelProviders(options).filter(p => !tried.has(`${p.name}:${p.model}:${p.key}`));
        const preferredPool = avoidSet.size ? rawCandidates.filter(p => !avoidSet.has(`${p.name}:${p.model}`)) : rawCandidates;
        const candidates = preferredPool.length ? preferredPool : rawCandidates;
        if (!candidates.length) break;
        const alternate = lastProviderName ? candidates.find(p => p.name !== lastProviderName) : null;
        const provider = alternate || candidates[0];
        tried.add(`${provider.name}:${provider.model}:${provider.key}`);
        lastProviderName = provider.name;
        if (options.onProviderSelected) options.onProviderSelected(`${provider.name}:${provider.model}`);

        const hasRemainingAlternative = candidates.length > 1;
        const fallbackReserve = hasRemainingAlternative ? Math.min(4500, Math.max(1, Math.floor(available * 0.42))) : 0;
        const attemptMs = Math.max(1, Math.min(9000, available - fallbackReserve));
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
                const baseTokens = maxOutputTokens || (json ? 4096 : 6000);
                const tokens = provider.name === 'groq' && json ? Math.min(baseTokens, 3072) : baseTokens;
                const body = provider.name === 'groq'
                    ? { model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: tokens, stream: streaming, ...(provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }
                    : { system_instruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: prompt }] }], generationConfig: normalizeGeminiGenerationConfig(provider.model, { temperature: 0.1, maxOutputTokens: tokens, thinkingConfig: { thinkingBudget: 0 }, ...(json ? { responseMimeType: 'application/json' } : {}) }) };
                const response = await fetch(endpoint, { method: 'POST', signal: scope.signal, headers: { 'Content-Type': 'application/json', ...(provider.name === 'groq' ? { Authorization: `Bearer ${provider.key}` } : {}) }, body: JSON.stringify(body) });
                attempt.httpStatus = response.status;
                if (!response.ok) {
                    attempt.outcome = response.status === 429 ? 'rate_limited' : `http_${response.status}`;
                    if (response.status === 429) {
                        recordCooldown(providerHealthKey(provider), retryDelay(response));
                    } else if (response.status === 413) {
                        recordCooldown(modelHealthKey(provider), TRANSIENT_COOLDOWN_MS);
                    } else if (response.status === 404 || response.status === 410) {
                        recordCooldown(modelHealthKey(provider), DEPRECATED_COOLDOWN_MS);
                    } else if (response.status >= 500) {
                        recordCooldown(modelHealthKey(provider), TRANSIENT_COOLDOWN_MS);
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
                        if (reason && ['stop', 'STOP'].includes(reason)) finished = true;
                    }, scope.signal);
                    if (!finished) { attempt.outcome = 'incomplete_stream'; return null; }
                    if (!text) { attempt.outcome = 'empty_response'; return null; }
                    attempt.outcome = 'success';
                    return text;
                }
                const data = await response.json();
                if (scope.signal.aborted) return null;
                const reason = provider.name === 'groq' ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
                if (reason && !['stop', 'STOP'].includes(reason)) { attempt.outcome = 'incomplete_response'; recordCooldown(modelHealthKey(provider), 15000); return null; }
                const text = provider.name === 'groq' ? data.choices?.[0]?.message?.content : (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
                if (!text) { attempt.outcome = 'empty_response'; recordCooldown(modelHealthKey(provider), 15000); return null; }
                if (!json) { attempt.outcome = 'success'; return text; }
                try {
                    const parsed = JSON.parse(String(text).replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, ''));
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
                    attempt.outcome = 'success'; return parsed;
                } catch { attempt.outcome = 'invalid_json'; recordCooldown(modelHealthKey(provider), 15000); return null; }
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
            if (!signal?.aborted) recordCooldown(modelHealthKey(provider), TRANSIENT_COOLDOWN_MS);
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
