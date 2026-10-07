/**
 * In-Process Prompt Injection & Jailbreak Defense Guardrail
 * - Scans user prompts in <1ms for adversarial system prompt overrides, DAN jailbreaks,
 *   exfiltration commands, and synthetic role delimiters.
 * - Protects upstream LLMs from security policy evasion without external latency overhead.
 */

const INJECTION_PATTERNS = [
    // Direct system override directives
    /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands|guidelines)/i,
    /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands)/i,
    /forget\s+(all\s+)?(previous|prior|above)\s+(instructions|prompts|rules|commands)/i,
    /override\s+(system|core|developer)\s+(prompt|instructions|rules)/i,

    // Jailbreak personas & modes
    /\b(dan\s+mode|unrestricted\s+mode|developer\s+mode\s+enabled|always\s+say\s+yes\s+mode)\b/i,
    /\byou\s+are\s+now\s+(unfiltered|unrestricted|in\s+jailbreak\s+mode|free\s+of\s+rules)\b/i,
    /\bdo\s+anything\s+now\b/i,

    // System prompt exfiltration
    /\b(print|repeat|output|show|reveal|display|leak)\s+(your\s+)?(exact|verbatim|initial|full|original|system)\s+(prompt|instructions|system_prompt)\b/i,
    /\bwhat\s+is\s+your\s+(system\s+prompt|initial\s+instructions|system\s+instruction)\b/i,

    // Synthetic role delimiters / ChatML injection
    /(<\|im_start\|>|<\|im_end\|>|<\|system\|>|<\|user\|>|<\|assistant\|>)/i,
    /\[\s*(system|developer|admin)\s*(message|prompt|instructions)?\s*\]/i,
    /(###\s*(instruction|system|prompt|assistant)\s*:)/i
];

export function inspectPromptSecurity(prompt = '') {
    const text = String(prompt || '').trim();
    if (!text) {
        return { safe: true, flagged: false, reason: '', sanitizedText: '' };
    }

    for (const pattern of INJECTION_PATTERNS) {
        if (pattern.test(text)) {
            return {
                safe: false,
                flagged: true,
                reason: 'prompt_injection_or_jailbreak_detected',
                violationPattern: pattern.source,
                sanitizedText: text,
                rejectionMessage: 'I am unable to process this request because it contains instructions that attempt to override core security policies or exfiltrate system parameters.'
            };
        }
    }

    return {
        safe: true,
        flagged: false,
        reason: '',
        sanitizedText: text
    };
}
