import { extractEntityTarget } from './entity-verifier.js';

export function isStableGeographyOrGeneralFactQuery(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) return false;
    const intent = classifyUniversalEntityIntent(query, context);
    return !intent.isLiveRequired;
}

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

    if (context.explicitWeb || context.webMode === 'on' || /\b(?:search\s+(?:for|the\s+web|online)|look\s+up\s+online|google\s+for|with\s+sources?)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search'
        };
    }

    if (/\b(?:near|nearby|open\s+now|directions|places\s+to\s+visit|things\s+to\s+do)\b/i.test(lower) ||
        /\b(?:what'?s\s+new|new\s+(?:feature|release|update))\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'actionable_or_freshness',
            reason: 'actionable_or_freshness'
        };
    }

    if (/\b(?:weather|forecast|stock|crypto|bitcoin|ethereum|price|score|news)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'live_domain',
            reason: 'time_sensitive_domain'
        };
    }

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

    return {
        isLiveRequired: false,
        isStableKnowledge: true,
        entityTarget: isHistorical ? entityTarget : null,
        category: 'general_reasoning',
        reason: 'default_model_reasoning'
    };
}

export function classifyQueryIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            type: 'static_reasoning',
            category: 'empty_query',
            requiresLiveGrounding: false
        };
    }

    const universal = classifyUniversalEntityIntent(query, context);
    if (!universal.isLiveRequired) {
        const lower = query.toLowerCase();
        let cat = universal.category || 'general_reasoning';
        if (/\b(?:function|def|class|write\s+a\s+python|javascript|c\+\+|coding|algorithm|quicksort)\b/i.test(lower)) {
            cat = 'coding';
        } else if (/\b(?:calculate|compute|solve|integral|derivative|equation|matrix)\b/i.test(lower) || /^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/.test(query)) {
            cat = 'mathematics';
        }
        return {
            type: 'static_reasoning',
            category: cat,
            requiresLiveGrounding: false
        };
    }

    if (universal.category === 'explicit_search') {
        return {
            type: 'explicit_search',
            category: 'web_search',
            requiresLiveGrounding: true
        };
    }

    if (universal.category === 'political_leadership') {
        return {
            type: 'temporal_fact',
            category: 'political_leadership',
            requiresLiveGrounding: true,
            entityTarget: universal.entityTarget
        };
    }

    if (universal.category === 'live_domain') {
        const lower = query.toLowerCase();
        const cat = /\b(?:weather|forecast|temperature)\b/i.test(lower) ? 'weather' : 'finance_crypto';
        return {
            type: 'domain_specific',
            category: cat,
            requiresLiveGrounding: true
        };
    }

    return {
        type: 'explicit_search',
        category: universal.category || 'live_required',
        requiresLiveGrounding: true
    };
}

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
    } catch (_) {}

    const fallback = classifyQueryIntent(query);
    return {
        ...fallback,
        confidence: 0.9,
        method: 'structural'
    };
}
