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
    if (/^(?:hi|hello|hey|yo|sup|thanks|thank you|good morning|good afternoon|good evening)$/.test(t)) return true;
    if (/\b(?:how are you|how are you doing|how you doing|what'?s up|are you there)\b/.test(t)) return true;
    if (/^(?:thanks|thank you|thank u|appreciate it)\b/.test(t)) return true;
    return false;
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

    if (context.webMode === 'off') {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'general_reasoning',
            reason: 'web_mode_off'
        };
    }

    const lower = raw.toLowerCase();

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

    const isHistoricalLeader = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history)\b/i.test(lower);
    if (!isHistoricalLeader && (/\b(?:prime\s+minister|chief\s+minister|governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader)\b/i.test(lower) || /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(lower))) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'political_leadership',
            reason: 'mutable_officeholder'
        };
    }

    return {
        isLiveRequired: false,
        isStableKnowledge: true,
        entityTarget: null,
        category: 'general_reasoning',
        reason: 'default_model_reasoning'
    };
}

export function isSimpleStableQuestion(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 200) return false;
    if (isCasualConversationQuery(raw)) return true;
    if (isStableGeographyOrGeneralFactQuery(raw, context)) return true;
    return false;
}

export function isTransformFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 180) return false;
    return /^(?:rewrite|rephrase|summarize|translate|explain\s+simply)\b/i.test(raw);
}

export function isJokeFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    return /^(?:tell\s+me\s+a\s+joke|make\s+me\s+laugh|say\s+something\s+funny)\b/i.test(raw);
}

export function isFastSimpleQuery(text, context = {}) {
    return isCasualConversationQuery(text) ||
        isSimpleStableQuestion(text, context) ||
        isTransformFastQuery(text) ||
        isJokeFastQuery(text);
}

export function decideFrontendRoute(text, context = {}) {
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
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

    if (context.toolAction) {
        return {
            ...base,
            route: 'tool_action',
            reason: String(context.toolReason || 'tool_action_requested'),
            sourcePolicy: 'tool'
        };
    }

    if (isCasualConversationQuery(raw)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'casual_conversation',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    if (isJokeFastQuery(raw)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'joke_request',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    if (isTransformFastQuery(raw)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'transform_request',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    if (context.safetySensitive || /\b(?:medicine|dosage|drug\s+dose|prescription|legal\s+advice|financial\s+advice|self\s*harm)\b/i.test(lower)) {
        return {
            ...base,
            route: 'safety_sensitive',
            reason: 'safety_sensitive_query',
            risk: 'high_risk',
            requiresSources: false,
            sourcePolicy: 'safety'
        };
    }

    if (isWebOff) {
        if (isStableGeographyOrGeneralFactQuery(raw) || isSimpleStableQuestion(raw, { ...context, webMode: 'off' })) {
            return {
                ...base,
                route: 'fast_simple',
                reason: 'web_off_stable_fact',
                risk: 'low_risk',
                minimalThinking: true,
                requiresSources: false,
                sourcePolicy: 'none'
            };
        }
        return {
            ...base,
            route: 'chat_direct',
            reason: 'web_off_direct_chat',
            requiresSources: false,
            sourcePolicy: 'none'
        };
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
        if (context.placeGrounded || entityIntent.category === 'actionable_or_freshness') {
            return {
                ...base,
                route: 'place_grounded',
                reason: 'place_query_requires_evidence',
                risk: context.risk || 'medium_risk',
                requiresSources: true,
                sourcePolicy: 'place_grounded'
            };
        }
        return {
            ...base,
            route: 'live_required',
            reason: entityIntent.reason || 'source_or_freshness_required',
            requiresSources: true,
            sourcePolicy: 'required'
        };
    }

    return {
        ...base,
        route: 'fast_simple',
        reason: 'stable_geography_or_general_fact',
        risk: 'low_risk',
        minimalThinking: true,
        requiresSources: false,
        sourcePolicy: 'none'
    };
}

export function shouldUseMinimalThinking(text, intent = '', context = {}) {
    const normalizedIntent = String(intent || '');
    return isFastSimpleQuery(text, context) ||
        ['fast_simple', 'casual_conversation', 'fast_explainer'].includes(normalizedIntent);
}
