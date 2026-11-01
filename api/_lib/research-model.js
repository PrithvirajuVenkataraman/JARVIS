import { researchTimeoutSignal } from '../../app/search/research-contract.mjs';

const cooldowns = new Map();
const firstKey = value => String(value || '').split(/[,;\s]+/).find(Boolean) || '';

export function researchModelProviders(options = {}) {
    const groq = firstKey(options.customGroqKey || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.GROQ_KEY);
    const gemini = String(options.customGeminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const selected = String(options.selectedModel || '');
    const providers = [];
    if (groq) providers.push({ name: 'groq', key: groq, model: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'].includes(selected) ? selected : 'openai/gpt-oss-120b' });
    if (gemini) providers.push({ name: 'gemini', key: gemini, model: ['gemini-2.5-flash', 'gemini-2.5-flash-lite'].includes(selected) ? selected : 'gemini-2.5-flash' });
    if (selected.startsWith('gemini-')) providers.reverse();
    return providers.filter(p => (cooldowns.get(p.name) || 0) <= Date.now());
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
            const text = event.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
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
            drain(false);
        }
        buffer += decoder.decode();
        drain(true);
        if (signal?.aborted) throw signal.reason || new Error('Research cancelled');
    } finally { signal?.removeEventListener('abort', abort); reader.releaseLock(); }
}

// Both endpoints are text generation only. Never enable billed search-grounding tools here.
export async function callResearchModel({ system, prompt, json = false, onToken, timeoutMs = 1800, signal, budget, ...options }) {
    if (budget && budget.calls >= budget.maxCalls) return null;
    const deadline = Date.now() + timeoutMs;
    for (const provider of researchModelProviders(options)) {
        if (signal?.aborted || Date.now() >= deadline || (budget && budget.calls >= budget.maxCalls)) break;
        if (budget) budget.calls++;
        const scope = researchTimeoutSignal(deadline - Date.now(), signal);
        let emitted = false;
        try {
            const streaming = typeof onToken === 'function';
            const endpoint = provider.name === 'groq'
                ? 'https://api.groq.com/openai/v1/chat/completions'
                : `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:${streaming ? 'streamGenerateContent?alt=sse&' : 'generateContent?'}key=${encodeURIComponent(provider.key)}`;
            const body = provider.name === 'groq'
                ? { model: provider.model, messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }], temperature: 0.1, max_tokens: json ? 850 : 3000, stream: streaming, ...(provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {}), ...(json ? { response_format: { type: 'json_object' } } : {}) }
                : { system_instruction: { parts: [{ text: system }] }, contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: json ? 1800 : 4000, ...(json ? { responseMimeType: 'application/json' } : {}) } };
            const response = await fetch(endpoint, {
                method: 'POST', signal: scope.signal,
                headers: { 'Content-Type': 'application/json', ...(provider.name === 'groq' ? { Authorization: `Bearer ${provider.key}` } : {}) },
                body: JSON.stringify(body)
            });
            if (!response.ok) {
                if (response.status === 429) {
                    const retry = Number(response.headers.get('retry-after')) || 60;
                    cooldowns.set(provider.name, Date.now() + Math.min(3600, Math.max(1, retry)) * 1000);
                }
                await response.body?.cancel().catch(() => {});
                continue;
            }
            if (streaming) {
                let text = '';
                let finished = false;
                await consumeResearchSse(response.body, data => {
                    if (data.error) throw new Error('Synthesis provider failed');
                    const token = provider.name === 'groq' ? data.choices?.[0]?.delta?.content : (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
                    if (token) { text += token; emitted = true; onToken(token); }
                    const reason = provider.name === 'groq' ? data.choices?.[0]?.finish_reason : data.candidates?.[0]?.finishReason;
                    if (reason === 'stop' || reason === 'STOP') finished = true;
                }, scope.signal);
                if (text.trim() && finished) return text;
                if (emitted) return null;
            } else {
                const data = await response.json();
                const text = provider.name === 'groq' ? data.choices?.[0]?.message?.content : (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
                if (!json) return text || null;
                const match = String(text || '').match(/\{[\s\S]*\}/);
                if (match) return JSON.parse(match[0]);
            }
        } catch {
            // Never append another provider's answer to a partially emitted one.
            if (emitted) return null;
        } finally { scope.dispose(); }
    }
    return null;
}
