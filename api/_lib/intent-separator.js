/**
 * @file api/_lib/intent-separator.js
 * @description Upfront Query Intent Separator that categorizes queries into:
 * 1. static_reasoning (History, Science, Space, Tech, AI, CS, Social Science, Coding, Math -> Direct Fast LLM)
 * 2. temporal_fact (Current political leaders, officeholders, live facts -> Instant Fact Layer)
 * 3. domain_specific (Weather, Crypto, Markets -> Targeted JSON APIs)
 * 4. explicit_search (User explicitly asked to search or find articles)
 */

import { extractEntityTarget } from './entity-verifier.js';

/**
 * Determines whether a query is asking for stable general knowledge.
 *
 * @param {string} rawQuery 
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function isStableGeographyOrGeneralFactQuery(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) return false;
    const intent = classifyUniversalEntityIntent(query, context);
    return !intent.isLiveRequired;
}

/**
 * Universal entity intent classifier.
 *
 * @param {string} rawQuery 
 * @param {object} [context={}]
 * @returns {{
 *   isLiveRequired: boolean,
 *   isStableKnowledge: boolean,
 *   entityTarget: { role: string, jurisdiction: string } | null,
 *   category: string,
 *   reason: string
 * }}
 */
export function classifyUniversalEntityIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'empty_query',
            reason: 'empty_query'
        };
    }

    if (context.webMode === 'off') {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'general_reasoning',
            reason: 'web_mode_off'
        };
    }

    const lower = query.toLowerCase();

    // 1. Explicit search requests
    if (context.explicitWeb || context.webMode === 'on' || /\b(?:search\s+(?:for|the\s+web|online|google)|look\s+up\s+online|google\s+for|with\s+sources?|source\s+links?)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search'
        };
    }

    // 2. Actionable location / place / freshness
    if (/\b(?:near\s+me|nearby|open\s+now|directions\s+to|route\s+to|visiting\s+hours|ticket\s+price|hotels?\s+near|restaurants?\s+near|museum\s+near|places\s+to\s+visit|things\s+to\s+do)\b/i.test(lower) ||
        /\b(?:what'?s\s+new|new\s+(?:update|updates|release|version|announcement|news|development|features?))\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'actionable_or_freshness',
            reason: 'actionable_or_freshness'
        };
    }

    // 3. Live domains (weather, live prices, news, sports scores)
    if (/\b(?:weather|forecast|temperature|stock|bitcoin|crypto|ethereum|eth|solana|(?:price\s+of\s+)?(?:gold|silver|crude)\s*(?:price|rate)|price\s+of|market\s+cap|live\s+score|ipl|news|earthquake|latest\s+update)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'live_domain',
            reason: 'time_sensitive_domain'
        };
    }

    // 4. Mutable political leadership & civic officeholders
    const isHistorical = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history)\b/i.test(lower);
    const entityTarget = extractEntityTarget(query);
    if (entityTarget && !isHistorical) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget,
            category: 'political_leadership',
            reason: 'mutable_officeholder'
        };
    }

    if (
        !isHistorical &&
        (/\b(?:prime\s+minister|chief\s+minister|governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader)\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(lower))
    ) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: entityTarget || extractEntityTarget(query),
            category: 'political_leadership',
            reason: 'mutable_officeholder'
        };
    }

    // 5. Default: Stable encyclopedic knowledge & direct reasoning
    return {
        isLiveRequired: false,
        isStableKnowledge: true,
        entityTarget: isHistorical ? entityTarget : null,
        category: 'general_reasoning',
        reason: 'default_model_reasoning'
    };
}

/**
 * Classifies a user query into clean intent categories.
 * @param {string} rawQuery 
 * @param {object} [context={}]
 * @returns {{
 *   type: 'static_reasoning' | 'temporal_fact' | 'domain_specific' | 'explicit_search',
 *   category: string,
 *   requiresLiveGrounding: boolean,
 *   entityTarget?: { role: string, jurisdiction: string } | null
 * }}
 */
export function classifyQueryIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false
        };
    }

    const lower = query.toLowerCase();

    // 1. Explicit search
    if (context.explicitWeb || context.webMode === 'on' || /\b(?:search\s+(?:for|the\s+web|online|google)|look\s+up\s+online|google\s+for|with\s+sources?|source\s+links?)\b/i.test(lower)) {
        return {
            type: 'explicit_search',
            category: 'web_search',
            requiresLiveGrounding: true
        };
    }

    // 2. Domain Specific: Weather
    if (/\b(?:weather|forecast|temperature)\b/i.test(lower)) {
        return {
            type: 'domain_specific',
            category: 'weather',
            requiresLiveGrounding: true
        };
    }

    // 3. Domain Specific: Finance & Crypto
    if (/\b(?:stock\s+price|price\s+of\s+(?:bitcoin|btc|eth|crypto|gold|silver)|bitcoin|crypto)\b/i.test(lower)) {
        return {
            type: 'domain_specific',
            category: 'finance_crypto',
            requiresLiveGrounding: true
        };
    }

    // 4. Temporal Political & Civic Leadership
    const isHistorical = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history)\b/i.test(lower);
    const entityTarget = extractEntityTarget(query);
    if (entityTarget && !isHistorical) {
        return {
            type: 'temporal_fact',
            category: 'political_leadership',
            requiresLiveGrounding: true,
            entityTarget
        };
    }

    if (
        !isHistorical &&
        (/\b(?:current|latest|present|today|now)\s+(?:governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader)\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)?\s*(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|cm|pm))\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(lower))
    ) {
        return {
            type: 'temporal_fact',
            category: 'political_leadership',
            requiresLiveGrounding: true,
            entityTarget: entityTarget || extractEntityTarget(query)
        };
    }

    // 5. Coding & Mathematics
    if (/\b(?:function|def|class|write\s+a\s+python|javascript|c\+\+|coding|algorithm|quicksort)\b/i.test(lower)) {
        return {
            type: 'static_reasoning',
            category: 'coding',
            requiresLiveGrounding: false
        };
    }
    if (/\b(?:calculate|compute|solve|integral|derivative|equation|matrix)\b/i.test(lower) || /^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/.test(query)) {
        return {
            type: 'static_reasoning',
            category: 'mathematics',
            requiresLiveGrounding: false
        };
    }

    return {
        type: 'static_reasoning',
        category: 'general_reasoning',
        requiresLiveGrounding: false
    };
}

/**
 * Semantic vector-based query intent classifier.
 * Uses embedding cosine similarity against intent prototypes.
 *
 * @param {string} rawQuery
 * @param {object} [options={}]
 * @returns {Promise<{
 *   type: string,
 *   category: string,
 *   requiresLiveGrounding: boolean,
 *   confidence: number,
 *   method: 'semantic_embedding' | 'structural'
 * }>}
 */
export async function classifyQueryIntentSemantic(rawQuery = '', options = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false,
            confidence: 1.0,
            method: 'structural'
        };
    }

    try {
        const { embedTexts } = await import('./embeddings.js');
        const PROTOTYPES = [
            { text: 'explain the concept of physics chemistry biology mathematics and history', type: 'static_reasoning', category: 'encyclopedic_knowledge', live: false },
            { text: 'write code program function algorithm in python javascript or c++', type: 'static_reasoning', category: 'coding_math', live: false },
            { text: 'current weather forecast temperature rainfall right now today', type: 'domain_specific', category: 'weather', live: true },
            { text: 'live stock price bitcoin market cap share crypto rate today', type: 'domain_specific', category: 'finance_crypto', live: true },
            { text: 'breaking news latest updates headline results right now today', type: 'temporal_fact', category: 'breaking_live', live: true },
            { text: 'who is current active chief minister prime minister president ceo', type: 'temporal_fact', category: 'political_leadership', live: true },
            { text: 'search the web look up articles find online sources', type: 'explicit_search', category: 'web_search', live: true }
        ];

        const embedResult = await embedTexts([query, ...PROTOTYPES.map(p => p.text)], { timeoutMs: 3000 });
        if (embedResult?.available && embedResult.embeddings.length >= PROTOTYPES.length + 1) {
            const queryVec = embedResult.embeddings[0];
            let bestScore = -1;
            let bestMatch = PROTOTYPES[0];

            for (let i = 0; i < PROTOTYPES.length; i++) {
                const protoVec = embedResult.embeddings[i + 1];
                let dot = 0;
                for (let j = 0; j < queryVec.length; j++) dot += queryVec[j] * protoVec[j];
                if (dot > bestScore) {
                    bestScore = dot;
                    bestMatch = PROTOTYPES[i];
                }
            }

            if (bestScore > 0.55) {
                return {
                    type: bestMatch.type,
                    category: bestMatch.category,
                    requiresLiveGrounding: bestMatch.live,
                    confidence: Number(bestScore.toFixed(3)),
                    method: 'semantic_embedding'
                };
            }
        }
    } catch (_) {
        // Fall back gracefully to standard structural classification
    }

    const fallback = classifyQueryIntent(query);
    return {
        ...fallback,
        confidence: 0.9,
        method: 'structural'
    };
}
