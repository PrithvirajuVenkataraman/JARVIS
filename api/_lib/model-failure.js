export function visionFailurePayload(configured, failures = []) {
    let code = 'vision_unavailable', response = 'Image analysis is temporarily unavailable. Please retry your attached image.';
    if (!configured) { code = 'missing_credentials'; response = 'Image analysis is not configured for this deployment. Contact the app owner or connect an available provider in Settings.'; }
    else if (failures.length && failures.every(row => [401, 403].includes(row.status))) { code = 'vision_authentication_failed'; response = 'The image providers rejected this deployment’s credentials. The app owner needs to check the provider configuration.'; }
    else if (failures.some(row => row.status === 429)) { code = 'vision_rate_limited'; response = 'Image analysis has reached its provider limit. Please try again later.'; }
    else if (failures.some(row => ['AbortError', 'TimeoutError'].includes(row.name))) { code = 'vision_timeout'; response = 'Image analysis timed out. Please retry your attached image.'; }
    return { code, intent: 'vision_unavailable', response, action: null, provider: 'none' };
}

export function normalizeGeminiGenerationConfig(model, config) {
    if (/^gemini-[34](?:[.-]|$)/i.test(model)) {
        delete config.topK;
        const budget = config.thinkingConfig?.thinkingBudget;
        config.thinkingConfig = { thinkingLevel: budget > 0 ? 'HIGH' : 'LOW', includeThoughts: false };
    }
    return config;
}

// Public diagnostics contain status/categories and known parameter names only.
// Never return upstream error text, URLs, keys, prompts, or response bodies.
export async function describeUpstreamFailure(response, provider, model) {
    const status = Number(response?.status) || 0;
    const result = { provider, model, status, reasonCode: status === 429 ? 'rate_limited' : [401, 403].includes(status) ? 'access_denied' : [404, 410].includes(status) ? 'model_unavailable' : status === 400 ? 'request_rejected' : status >= 500 ? 'provider_error' : 'upstream_error' };
    const reader = response?.body?.getReader?.();
    if (!reader) return result;
    if (status !== 400) { await reader.cancel().catch(() => {}); reader.releaseLock(); return result; }
    let timer, text = '', bytes = 0;
    try {
        timer = setTimeout(() => { void reader.cancel().catch(() => {}); }, 250);
        const decoder = new TextDecoder();
        while (bytes < 4096) {
            const chunk = await reader.read(); if (chunk.done) break;
            bytes += chunk.value.byteLength; text += decoder.decode(chunk.value.subarray(0, Math.max(0, 4096 - (bytes - chunk.value.byteLength))), { stream: true });
        }
        const parameters = ['thinkingConfig', 'thinkingLevel', 'thinkingBudget', 'includeThoughts', 'maxOutputTokens', 'topK', 'topP', 'temperature', 'mediaResolution', 'responseMimeType', 'system_instruction'].filter(name => text.includes(name));
        if (parameters.length) result.parameters = parameters;
        if (/API_KEY_INVALID|API key not valid|invalid api key/i.test(text)) result.reasonCode = 'invalid_api_key';
    } catch { /* Status remains useful when a provider sends no readable body. */ }
    finally { clearTimeout(timer); await reader.cancel().catch(() => {}); reader.releaseLock(); }
    return result;
}

export function upstreamAttemptSummary(failures) {
    return failures.slice(0, 2).map(failure => failure.upstream || { status: Number(failure.status) || 0, reasonCode: failure.code === 'attempt_budget_exhausted' ? 'attempt_budget_exhausted' : ['AbortError', 'TimeoutError'].includes(failure.name) ? 'timeout' : 'network_error' });
}
