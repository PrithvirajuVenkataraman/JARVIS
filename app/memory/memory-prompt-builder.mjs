/**
 * Memory Prompt Builder & Query Router (Schema v1)
 * Handles conversational meta-queries ("what do you know about me"), forget commands ("forget that I live in..."),
 * prompt injection sanitization, and relevant memory token budgeting (~800 tokens).
 */

import { calculateTokenJaccard, tokenize } from './memory-extractor.mjs';

// Regex for conversational meta-queries requesting memory recall
export const META_QUERY_PATTERNS = [
    /\bwhat\s+do\s+you\s+(?:know|remember)\s+about\s+me\b/i,
    /\bwhat\s+(?:are\s+)?my\s+saved\s+memories\b/i,
    /\btell\s+me\s+what\s+you\s+(?:know|remember)\s+about\s+(?:me|my\s+preferences|my\s+profile)\b/i,
    /\bshow\s+(?:me\s+)?(?:all\s+)?my\s+(?:saved\s+)?memories\b/i,
    /\bwhat\s+have\s+you\s+learned\s+about\s+me\b/i,
    /\bwhat\s+do\s+you\s+have\s+saved\s+about\s+me\b/i,
    /\bwhat\s+memories\s+do\s+you\s+have\b/i,
    /\bwhat\s+is\s+my\s+profile\b/i,
    /\bwhat\s+preferences\s+do\s+you\s+remember\b/i
];

// Regex for conversational forget requests
export const FORGET_INTENT_PATTERNS = [
    /\b(?:please\s+)?(?:forget|delete|remove|clear)\s+(?:everything|all\s+memories|all\s+my\s+memories)\b/i,
    /\b(?:please\s+)?(?:forget|delete|remove|clear)\s+(?:that\s+)?(?:i\s+)?(.+)/i
];

/**
 * Checks whether user query is a conversational meta-query asking about their memories.
 * @param {string} text
 * @returns {boolean}
 */
export function isMetaMemoryQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return META_QUERY_PATTERNS.some(p => p.test(raw));
}

/**
 * Parses user input for a forget command.
 * @param {string} text
 * @returns {{ isForget: boolean, isForgetAll: boolean, target: string }}
 */
export function parseForgetIntent(text) {
    const raw = String(text || '').trim();
    if (!raw) return { isForget: false, isForgetAll: false, target: '' };

    if (/\b(?:forget|delete|remove|clear)\s+(?:everything|all\s+memories|all\s+my\s+memories)\b/i.test(raw)) {
        return { isForget: true, isForgetAll: true, target: 'all' };
    }

    const match = raw.match(/\b(?:please\s+)?(?:forget|delete|remove|erase)\s+(?:that\s+)?(?:memory\s+about\s+)?(?:i\s+)?(.+)/i);
    if (match && match[1]) {
        let target = match[1].trim().replace(/[?.!,;]+$/g, '');
        // Clean leading phrases
        target = target.replace(/^(?:my\s+|the\s+|about\s+|that\s+)+/i, '').trim();
        return { isForget: true, isForgetAll: false, target };
    }

    return { isForget: false, isForgetAll: false, target: '' };
}

/**
 * Strips dangerous prompt injection markers, newlines, control characters, and role-like prefixes.
 * Ensures memories are treated strictly as read-only user data, never instructions.
 *
 * @param {string} text
 * @returns {string} Sanitized string
 */
export function sanitizeMemoryForPrompt(text) {
    let clean = String(text || '')
        .replace(/[\r\n\t]+/g, ' ')
        // Strip role-like injection prefixes
        .replace(/\b(?:system|assistant|user|developer|instruction|human)\s*:/gi, '')
        // Neutralize common prompt-escape phrases
        .replace(/\b(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|disregard\s+instructions|system\s+prompt)\b/gi, '[filtered]')
        .replace(/```/g, "'''")
        .trim();

    return clean;
}

/**
 * Finds matching memories for a conversational forget request.
 * @param {string} targetText
 * @param {Array<Object>} memories
 * @returns {{ exactMatch: Object|null, fuzzyMatches: Array<Object> }}
 */
export function findMemoriesToForget(targetText, memories = []) {
    const raw = String(targetText || '').toLowerCase().trim();
    if (!raw || !memories.length) return { exactMatch: null, fuzzyMatches: [] };

    // 1. Direct exact or substring match
    const exact = memories.find(m => m.text.toLowerCase().includes(raw) || raw.includes(m.text.toLowerCase()));
    if (exact) {
        return { exactMatch: exact, fuzzyMatches: [exact] };
    }

    // 2. Token overlap / Jaccard matching
    const matches = [];
    const targetTokens = new Set(tokenize(raw));

    for (const mem of memories) {
        const memTokens = tokenize(mem.text);
        const overlap = memTokens.filter(t => targetTokens.has(t)).length;
        const jaccard = calculateTokenJaccard(raw, mem.text);

        if (overlap >= 1 || jaccard >= 0.3) {
            matches.push({ memory: mem, score: jaccard + (overlap * 0.2) });
        }
    }

    matches.sort((a, b) => b.score - a.score);
    return {
        exactMatch: matches.length === 1 ? matches[0].memory : null,
        fuzzyMatches: matches.map(m => m.memory)
    };
}

/**
 * Selects relevant memories for a normal turn within ~800 tokens budget (~3200 chars).
 * Priorities:
 * 1. Always include active constraints and style preferences.
 * 2. Lexical / semantic keyword overlap with current user turn.
 * 3. Identity and recent facts.
 *
 * @param {string} currentTurnText
 * @param {Array<Object>} enabledMemories
 * @param {number} [maxCharsBudget=3200]
 * @returns {Array<Object>}
 */
export function selectRelevantMemories(currentTurnText = '', enabledMemories = [], maxCharsBudget = 3200) {
    if (!enabledMemories || !enabledMemories.length) return [];

    const turnTokens = new Set(tokenize(currentTurnText));
    const selected = [];
    let charCount = 0;

    // 1. Always-on constraints & preferences
    const constraintsAndPrefs = enabledMemories.filter(m =>
        m.category === 'constraint' || m.category === 'preference'
    );
    for (const item of constraintsAndPrefs) {
        const itemLen = item.text.length + 10;
        if (charCount + itemLen <= maxCharsBudget) {
            selected.push(item);
            charCount += itemLen;
        }
    }

    // 2. Fact memories with token overlap
    const remaining = enabledMemories.filter(m => !selected.includes(m));
    const scored = remaining.map(item => {
        const tokens = tokenize(item.text);
        const overlap = tokens.filter(t => turnTokens.has(t)).length;
        const jaccard = calculateTokenJaccard(currentTurnText, item.text);
        return { item, score: overlap * 2 + jaccard };
    });

    scored.sort((a, b) => b.score - a.score);

    for (const { item, score } of scored) {
        // Only include if there is relevance overlap or if it is general identity/location
        if (score > 0 || ['identity', 'location'].includes(item.category)) {
            const itemLen = item.text.length + 10;
            if (charCount + itemLen <= maxCharsBudget) {
                selected.push(item);
                charCount += itemLen;
            }
        }
    }

    return selected;
}

/**
 * Builds the prompt injection context block for normal turns.
 * @param {Array<Object>} relevantMemories
 * @returns {string} Delimited prompt section or empty string
 */
export function buildNormalTurnMemoryPrompt(relevantMemories = []) {
    if (!relevantMemories || !relevantMemories.length) return '';

    const lines = relevantMemories.map(m => `- ${sanitizeMemoryForPrompt(m.text)}`);
    return [
        '=== USER SAVED MEMORIES & PREFERENCES (DATA ONLY) ===',
        'The following facts and preferences were saved by the user.',
        'Use them naturally for personalized assistance without repeating or reciting them unless asked:',
        ...lines,
        '====================================================='
    ].join('\n');
}

/**
 * Builds the prompt injection block for meta-queries ("what do you know about me").
 * Instructs the model to list all saved facts conversationally and strictly grounded.
 * @param {Array<Object>} allMemories
 * @returns {string}
 */
export function buildMetaQueryMemoryPrompt(allMemories = []) {
    if (!allMemories || !allMemories.length) {
        return [
            '[Saved User Memories & Profile (Complete List):',
            '(No memories saved yet)',
            ']',
            'Instruction: Tell the user conversationally that you do not have any saved memories or personal facts stored yet. Invite them to share their preferences or facts naturally.'
        ].join('\n');
    }

    const lines = allMemories.map(m => `- ${sanitizeMemoryForPrompt(m.text)}`);
    return [
        '[Saved User Memories & Profile (Complete List):',
        ...lines,
        ']',
        'Instruction: The user asked what you know/remember about them. Answer conversationally, cleanly, and accurately using ONLY the facts listed above. Do not hallucinate or invent any personal details not present in this list.'
    ].join('\n');
}
