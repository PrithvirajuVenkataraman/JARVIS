/**
 * PII & Secrets Redaction Engine
 * - Masks API keys, tokens, JWTs, AWS credentials, credit card numbers, and SSNs
 * - Uses one-way surrogate tokens so private credentials never leak to external LLM providers
 */

const SECRET_PATTERNS = [
    // OpenAI / Groq / Anthropic / Google AI API keys
    { name: 'OPENAI_API_KEY', regex: /\bsk-(?:proj-|svcacct-)?[a-zA-Z0-9_\-]{20,}\b/g, mask: '[REDACTED_API_KEY]' },
    { name: 'GROQ_API_KEY', regex: /\bgsk_[a-zA-Z0-9]{30,}\b/g, mask: '[REDACTED_API_KEY]' },
    { name: 'ANTHROPIC_API_KEY', regex: /\bsk-ant-[a-zA-Z0-9_\-]{30,}\b/g, mask: '[REDACTED_API_KEY]' },
    { name: 'GOOGLE_API_KEY', regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g, mask: '[REDACTED_API_KEY]' },
    { name: 'GITHUB_TOKEN', regex: /\b(ghp|gho|ghu|ghs|ghr|github_pat)_[a-zA-Z0-9_]{36,}\b/g, mask: '[REDACTED_GITHUB_TOKEN]' },
    { name: 'AWS_ACCESS_KEY', regex: /\bAKIA[0-9A-Z]{16}\b/g, mask: '[REDACTED_AWS_KEY]' },

    // Generic JSON Web Tokens (JWT)
    { name: 'JWT_TOKEN', regex: /\beyJ[a-zA-Z0-9_-]{10,}\.eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_\-.]{10,}\b/g, mask: '[REDACTED_JWT_TOKEN]' },

    // US Social Security Number (SSN)
    { name: 'US_SSN', regex: /\b\d{3}-\d{2}-\d{4}\b/g, mask: '[REDACTED_SSN]' },

    // Credit Card (Visa, MC, Amex, Discover)
    { name: 'CREDIT_CARD', regex: /\b(?:\d{4}[ -]?){3}\d{4}\b|\b3[47]\d{2}[ -]?\d{6}[ -]?\d{5}\b/g, mask: '[REDACTED_CREDIT_CARD]' }
];

export function redactSensitiveData(text = '') {
    let raw = String(text || '');
    if (!raw) return { text: '', redactedCount: 0, redactedTypes: [] };

    let redactedCount = 0;
    const redactedTypes = [];

    for (const rule of SECRET_PATTERNS) {
        if (rule.regex.test(raw)) {
            const matches = raw.match(rule.regex);
            if (matches) {
                redactedCount += matches.length;
                redactedTypes.push(rule.name);
            }
            raw = raw.replace(rule.regex, rule.mask);
        }
    }

    return {
        text: raw,
        redactedCount,
        redactedTypes: Array.from(new Set(redactedTypes))
    };
}
