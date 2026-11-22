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
