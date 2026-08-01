function readBool(name, fallback = false) {
    const raw = String(process.env[name] || '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
}

function clampInt(value, fallback, min, max) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
}

export function getCostControls() {
    return {
        qualityCriticEnabled: readBool('JARVIS_QUALITY_CRITIC_ENABLED', true),
        streamQualityReviewEnabled: readBool('JARVIS_STREAM_QUALITY_REVIEW', false),
        defaultMaxTokens: clampInt(process.env.JARVIS_DEFAULT_MAX_TOKENS, 10000, 256, 16000),
        fastMaxTokens: clampInt(process.env.JARVIS_FAST_MAX_TOKENS, 2500, 256, 8000),
        streamMaxTokens: clampInt(process.env.JARVIS_STREAM_MAX_TOKENS, 10000, 256, 16000)
    };
}

export function applyCostCapToLengthPolicy(lengthPolicy = {}, options = {}) {
    const controls = getCostControls();
    const intent = String(options.intent || '');
    const isFast = ['fast_simple', 'fast_explainer', 'casual_chat', 'chat_title'].includes(intent);
    const cap = isFast ? controls.fastMaxTokens : (options.stream ? controls.streamMaxTokens : controls.defaultMaxTokens);
    const maxTokens = clampInt(lengthPolicy?.maxTokens, cap, 256, 16000);
    return {
        ...lengthPolicy,
        maxTokens: Math.min(maxTokens, cap)
    };
}
