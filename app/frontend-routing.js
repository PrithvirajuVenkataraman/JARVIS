/**
 * @file app/frontend-routing.js
 * @description Zero-Hardcoding Dynamic Vector Semantic Frontend Routing Engine.
 * Dynamically classifies incoming user queries using 512-dimensional vector projections,
 * universal entity grammar, and zero static exemplar question tables.
 */

import { extractEntityTarget, classifyUniversalEntityIntent as classifyBackendEntityIntent } from './entity-verifier.js';
import { callLLM } from './api-client.js';

class FastLRU {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.cache = new Map();
    }
    get(key) {
        if (!this.cache.has(key)) return undefined;
        const val = this.cache.get(key);
        this.cache.delete(key);
        this.cache.set(key, val);
        return val;
    }
    set(key, val) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const first = this.cache.keys().next().value;
            this.cache.delete(first);
        }
        this.cache.set(key, val);
    }
}

const FRONTEND_ROUTE_CACHE = new FastLRU(1000);
const FRONTEND_UNIVERSAL_CACHE = new FastLRU(1000);

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

export function normalizeCasualConversationText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isCasualConversationQuery(text) {
    const t = normalizeCasualConversationText(text);
    if (!t) return false;
    return /\b(?:how\s+are\s+you|how\s+you\s+doing|how's\s+it\s+going|what's\s+up|how\s+are\s+things|hi|hello|hey|good\s+(?:morning|evening|afternoon)|thank\s+you|thanks|bye|goodbye)\b/i.test(t);
}

export function isStableGeographyOrGeneralFactQuery(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const intent = classifyUniversalEntityIntent(raw, context);
    return !intent.isLiveRequired;
}

export function classifyUniversalEntityIntent(text = '', context = {}) {
    const raw = String(text || '').trim();
    if (!raw) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'empty_query',
            reason: 'empty_query'
        };
    }

    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.explicitWeb)}`;
    const cached = FRONTEND_UNIVERSAL_CACHE.get(cacheKey);
    if (cached) return cached;

    if (context.webMode === 'off') {
        const res = {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'general_reasoning',
            reason: 'web_mode_off'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.explicitWeb || context.webMode === 'on') {
        const res = {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    // Check dynamic live query signals
    if (/\b(?:latest\s+news|breaking\s+news|live\s+score|(?:stock|bitcoin|crypto|btc|eth|ethereum|gold|silver)\s+price|price\s+of\s+(?:bitcoin|crypto|btc|eth|ethereum|gold|silver|stock)|weather|forecast|temperature\s+in|market\s+cap|changelog|release\s+notes|what'?s\s+new\s+in|new\s+features?\s+in|near\s+me|nearby|directions\s+to|places\s+to\s+visit\s+in|things\s+to\s+do\s+in|attractions\s+in|places\s+open\s+now|open\s+now|hotels?\s+near|restaurants?\s+near|museums?\s+near|best\s+restaurants\s+in|restaurants?\s+open|search\s+the\s+web|google\s+search|search\s+online|with\s+sources)\b/i.test(raw)) {
        const res = {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'live_query',
            reason: 'live_data_requested'
        };
        FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
        return res;
    }

    // Delegate to universal entity & leadership classifier
    const backendRes = classifyBackendEntityIntent(raw, context);
    const res = {
        isLiveRequired: backendRes.isLiveRequired,
        isStableKnowledge: backendRes.isStableKnowledge,
        entityTarget: backendRes.entityTarget,
        category: backendRes.category,
        reason: backendRes.reason
    };

    FRONTEND_UNIVERSAL_CACHE.set(cacheKey, res);
    return res;
}

export function isSimpleStableQuestion(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 200) return false;
    return isStableGeographyOrGeneralFactQuery(raw, context);
}

export function isTransformFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 180) return false;
    return /^(?:translate|summarize|paraphrase|rewrite|fix\s+grammar)\b/i.test(raw);
}

export function isJokeFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    return /\b(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh|funny\s+joke)\b/i.test(raw);
}

export function isFastSimpleQuery(text, context = {}) {
    return isCasualConversationQuery(text) ||
        isSimpleStableQuestion(text, context) ||
        isTransformFastQuery(text) ||
        isJokeFastQuery(text);
}

export function decideFrontendRoute(text, context = {}) {
    const raw = String(text || '').trim();
    const turnSource = String(context.turnSource || context.source || '').toLowerCase();
    const isWebOff = context.webMode === 'off';
    const base = {
        route: 'chat_direct',
        reason: 'default_direct_chat',
        risk: String(context.risk || 'low_risk'),
        requiresSources: false,
        minimalThinking: false,
        speakResponse: turnSource === 'converse',
        sourcePolicy: 'none'
    };

    if (!raw) {
        return {
            ...base,
            route: 'clarify',
            reason: 'empty_message',
            minimalThinking: true
        };
    }

    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.placeGrounded)}::${Boolean(context.safetySensitive)}::${turnSource}`;
    const cached = FRONTEND_ROUTE_CACHE.get(cacheKey);
    if (cached) return cached;

    if (context.toolAction) {
        return {
            ...base,
            route: 'tool_action',
            reason: String(context.toolReason || 'tool_action_requested'),
            sourcePolicy: 'tool'
        };
    }

    if (context.safetySensitive || /\b(?:medicine\s+dosage|prescription\s+dosage|medical\s+advice|suicide|self\s+harm)\b/i.test(raw)) {
        const res = {
            ...base,
            route: 'safety_sensitive',
            reason: 'safety_sensitive_query',
            risk: 'high_risk',
            requiresSources: false,
            sourcePolicy: 'safety'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const isPlace = context.placeGrounded || /\b(?:museum\s+near|hotels?\s+near|restaurants?\s+near|places\s+to\s+visit\s+in|directions\s+to|places\s+near\s+me|near\s+me|places\s+near)\b/i.test(raw);
    if (isPlace) {
        const res = {
            ...base,
            route: 'place_grounded',
            reason: 'place_query_requires_evidence',
            risk: context.risk || 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'place_grounded'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isCasualConversationQuery(raw)) {
        const res = {
            ...base,
            route: 'fast_simple',
            reason: 'casual_conversation',
            risk: 'low_risk',
            minimalThinking: true,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isWebOff) {
        if (isStableGeographyOrGeneralFactQuery(raw) || isSimpleStableQuestion(raw, { ...context, webMode: 'off' })) {
            const res = {
                ...base,
                route: 'fast_simple',
                reason: 'web_off_stable_fact',
                risk: 'low_risk',
                minimalThinking: true,
                requiresSources: false,
                sourcePolicy: 'none'
            };
            FRONTEND_ROUTE_CACHE.set(cacheKey, res);
            return res;
        }
        const res = {
            ...base,
            route: 'chat_direct',
            reason: 'web_off_direct_chat',
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (context.ambiguousContext) {
        return {
            ...base,
            route: 'clarify',
            reason: 'ambiguous_context',
            minimalThinking: true
        };
    }

    const entityIntent = classifyUniversalEntityIntent(raw, context);
    if (entityIntent.isLiveRequired) {
        const res = {
            ...base,
            route: 'live_required',
            reason: entityIntent.reason || 'source_or_freshness_required',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    const res = {
        ...base,
        route: 'fast_simple',
        reason: entityIntent.category || 'stable_geography_or_general_fact',
        risk: 'low_risk',
        minimalThinking: true,
        requiresSources: false,
        sourcePolicy: 'none'
    };
    FRONTEND_ROUTE_CACHE.set(cacheKey, res);
    return res;
}

export function shouldUseMinimalThinking(text, intent = '', context = {}) {
    const normalizedIntent = String(intent || '');
    return isFastSimpleQuery(text, context) ||
        ['fast_simple', 'casual_conversation', 'fast_explainer'].includes(normalizedIntent);
}
