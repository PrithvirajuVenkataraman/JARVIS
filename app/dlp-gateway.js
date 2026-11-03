/**
 * Single Gateway for Data Loss Prevention (DLP) across all outbound-data paths.
 * Enforces policy modes (personal vs enforced), manages reversible client-only
 * placeholders, and records sanitized diagnostic audit events.
 */

import { scanDlp } from './dlp-engine.js';
import { recordDlpAudit } from './observability.js';

export const DLP_CHANNELS = Object.freeze([
    'composer',
    'voice',
    'memory',
    'reminder',
    'search_query',
    'feedback_comment',
    'history',
    'image_prompt',
    'llm_dispatch',
    'web_fetch'
]);

// In-memory reversible mapping per conversation (Client-only: never persisted, never logged, never transmitted)
const conversationContexts = new Map();

function getConversationContext(conversationId = 'default') {
    const id = String(conversationId || 'default');
    if (!conversationContexts.has(id)) {
        conversationContexts.set(id, {
            placeholderToRaw: new Map(),
            rawToPlaceholder: new Map(),
            counters: {
                SECRET: 0,
                EMAIL: 0,
                CARD: 0,
                SSN: 0,
                AADHAAR: 0,
                PAN: 0,
                PHONE: 0
            }
        });
    }
    return conversationContexts.get(id);
}

/**
 * Checks whether DLP is globally enabled via feature flag.
 */
export function isDlpEnabled() {
    if (typeof process !== 'undefined' && process.env) {
        const envVal = String(process.env.DLP_ENABLED || '').trim().toLowerCase();
        if (['0', 'false', 'no', 'off'].includes(envVal)) return false;
    }
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem('jarvis_dlp_enabled');
            if (stored === 'false') return false;
        }
    } catch (_) {}
    return true;
}

/**
 * Resolves current DLP policy mode ("personal" | "enforced").
 */
export function getDlpPolicyMode() {
    if (typeof process !== 'undefined' && process.env) {
        const mode = String(process.env.DLP_POLICY_MODE || '').trim().toLowerCase();
        if (mode === 'enforced') return 'enforced';
    }
    if (typeof window !== 'undefined' && window.__JARVIS_CONFIG?.DLP_POLICY_MODE) {
        return String(window.__JARVIS_CONFIG.DLP_POLICY_MODE).toLowerCase() === 'enforced' ? 'enforced' : 'personal';
    }
    return 'personal';
}

/**
 * Checks whether PII masking is enabled based on policy mode and user preferences.
 */
export function isPiiMaskingEnabled() {
    const mode = getDlpPolicyMode();
    if (mode === 'enforced') {
        return true; // Enforced mode: server and admin mandate PII masking
    }
    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            const stored = window.localStorage.getItem('jarvis_pii_masking_enabled');
            if (stored === 'false') return false;
        }
    } catch (_) {}
    return true;
}

/**
 * Primary DLP Gateway function through which every outbound data path flows.
 *
 * @param {string} text - User prompt, query, memory note, or comment.
 * @param {object} options
 * @param {string} [options.channel='composer'] - Channel origin.
 * @param {string} [options.conversationId='default'] - Active conversation ID.
 * @param {boolean} [options.redactCredentials=false] - If true, replaces credentials with placeholder instead of blocking.
 * @param {boolean} [options.maskPii] - Override PII masking flag.
 * @returns {object} { decision: 'ALLOW' | 'BLOCK' | 'MASK', findings: Array, sanitizedText: string, truncatedScan: boolean }
 */
export function dlpGateway(text, options = {}) {
    if (!isDlpEnabled()) {
        return {
            decision: 'ALLOW',
            findings: [],
            sanitizedText: String(text || ''),
            truncatedScan: false
        };
    }

    const channel = String(options.channel || 'composer');
    const conversationId = String(options.conversationId || 'default');
    const redactCredentials = Boolean(options.redactCredentials);
    const maskPii = options.maskPii !== undefined ? Boolean(options.maskPii) : isPiiMaskingEnabled();
    const context = getConversationContext(conversationId);

    const result = scanDlp(text, {
        maskPii,
        redactCredentials,
        context
    });

    // Record sanitized audit events for findings
    if (Array.isArray(result.findings) && result.findings.length > 0) {
        for (const finding of result.findings) {
            const action = result.decision === 'BLOCK'
                ? 'block'
                : (redactCredentials && finding.severity === 'critical' ? 'redact' : 'mask');
            try {
                recordDlpAudit({
                    channel,
                    ruleId: finding.ruleId,
                    category: finding.category,
                    action,
                    count: finding.count
                });
            } catch (_) {}
        }
    }

    return result;
}

/**
 * Rehydrates masked placeholders back to original values in assistant responses (Client-Only).
 *
 * @param {string} responseText - Assistant response potentially containing [REDACTED_EMAIL_1], etc.
 * @param {string} [conversationId='default'] - Active conversation ID.
 * @returns {string} Rehydrated text with local values restored.
 */
export function rehydrateText(responseText, conversationId = 'default') {
    let text = String(responseText || '');
    if (!text) return '';
    const context = getConversationContext(conversationId);
    if (!context || !context.placeholderToRaw || context.placeholderToRaw.size === 0) {
        return text;
    }

    for (const [placeholder, rawVal] of context.placeholderToRaw.entries()) {
        text = text.split(placeholder).join(rawVal);
    }
    return text;
}

/**
 * Resets in-memory reversible placeholders for a given conversation.
 */
export function clearConversationDlpContext(conversationId = 'default') {
    conversationContexts.delete(String(conversationId || 'default'));
}
