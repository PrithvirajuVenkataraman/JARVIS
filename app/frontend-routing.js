const CASUAL_FILLER_PATTERN = /\b(?:no|nope|nah|just|generally|actually|i'?m|im|i am|asking|so|well|um|uh|like)\b/g;
const LIVE_SIGNAL_PATTERN = /\b(latest|current|currently|today|tonight|now|recent|news|update|updates|as of|live|real[-\s]?time|open now|near me|nearby|weather|price|stock|crypto|score|sources?|cite|citation|web|search)\b|\b(?:what'?s\s+new|new\s+(?:update|updates|release|version|announcement|news|info|findings|development|features?))\b/i;
const PLACE_SIGNAL_PATTERN = /\b(museum|museums|landmark|landmarks|attraction|attractions|restaurant|restaurants|hotel|hotels|near me|nearby|near\s+[a-z]|directions|map|places to visit|tourist|tourism|beach|beaches|hill station|hill stations|waterfall|temple|park|sightseeing|things to do|how to reach|visiting hours|ticket price|open now)\b/i;
const SAFETY_SIGNAL_PATTERN = /\b(medical|medicine|diagnosis|symptom|dose|dosage|drug|treatment|legal|lawyer|contract|court|tax|investment|financial advice|self[-\s]?harm|suicide|weapon|malware)\b/i;
const CURRENT_ROLE_PATTERN = /\b(ceo|cfo|cto|president|prime minister|chief minister|governor|mayor|minister|captain|coach|founder|founded|head of|leader)\b/i;
const SIMPLE_STABLE_PATTERN = /^(?:what\s+is|what'?s|who\s+is|who\s+was|how\s+does|how\s+do|explain|define|tell\s+me\s+about)\s+[\w\s.'-]{2,80}\??$/i;
const CAPABILITY_QUESTION_PATTERN = /^(?:do|can|are|will)\s+you\b|^do\s+you\s+understand\s+[A-Za-z][A-Za-z\s-]{1,40}\??$/i;
const TRANSFORM_FAST_PATTERN = /^(?:rewrite|rephrase|summarize|summarise|translate|make (?:it|this|that) (?:shorter|simpler|more professional)|explain (?:this|that|it) (?:simply|in simple terms)|turn (?:this|that|it) into (?:bullets|steps))\b/i;
const JOKE_FAST_PATTERN = /^(?:tell me a joke|make me laugh|say something funny)\b/i;

export function normalizeCasualConversationText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s']/gu, ' ')
        .replace(CASUAL_FILLER_PATTERN, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function isCasualConversationQuery(text) {
    const t = normalizeCasualConversationText(text);
    if (!t) return false;
    if (/^(?:hi|hello|hey|yo|sup|thanks|thank you|good morning|good afternoon|good evening)$/.test(t)) return true;
    if (/\b(how are you|how are you doing|how you doing|how is your day|how's your day|what'?s up|are you there|you there)\b/.test(t)) return true;
    if (/^(?:thanks|thank you|thank u|appreciate it)\b/.test(t)) return true;
    return false;
}

/**
 * Determines whether a query represents stable encyclopedic knowledge.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {boolean}
 */
export function isStableGeographyOrGeneralFactQuery(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const intent = classifyUniversalEntityIntent(raw, context);
    return !intent.isLiveRequired;
}

/**
 * Universal entity intent classifier.
 *
 * @param {string} text
 * @param {object} [context={}]
 * @returns {{
 *   isLiveRequired: boolean,
 *   isStableKnowledge: boolean,
 *   entityTarget: { role: string, jurisdiction: string } | null,
 *   category: string,
 *   reason: string
 * }}
 */
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
    const isHistoricalLeader = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history)\b/i.test(lower);
    if (!isHistoricalLeader && (CURRENT_ROLE_PATTERN.test(lower) || /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(lower))) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'political_leadership',
            reason: 'mutable_officeholder'
        };
    }

    // 5. Default: Direct conversational & general reasoning
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
    const lower = raw.toLowerCase();
    if (!raw || raw.length > 200) return false;
    if (isCasualConversationQuery(raw)) return true;
    if (isStableGeographyOrGeneralFactQuery(raw)) return true;
    if (
        context.requiresSources ||
        context.liveIntent ||
        context.explicitWeb ||
        context.strictLatest ||
        context.currentInfo ||
        LIVE_SIGNAL_PATTERN.test(lower) ||
        SAFETY_SIGNAL_PATTERN.test(lower) ||
        PLACE_SIGNAL_PATTERN.test(lower) ||
        CURRENT_ROLE_PATTERN.test(lower)
    ) {
        return false;
    }
    if (SIMPLE_STABLE_PATTERN.test(raw) || CAPABILITY_QUESTION_PATTERN.test(raw)) return true;
    // Short definitional / explainer questions without live signals.
    if (/^(?:what\s+does|why\s+do|why\s+does|why\s+is|how\s+to|difference\s+between)\b/i.test(raw) && raw.length <= 160) {
        return true;
    }
    return false;
}

export function isTransformFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 180) return false;
    return TRANSFORM_FAST_PATTERN.test(raw);
}

export function isJokeFastQuery(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length > 120) return false;
    return JOKE_FAST_PATTERN.test(raw);
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

    if (context.safetySensitive || SAFETY_SIGNAL_PATTERN.test(lower)) {
        return {
            ...base,
            route: 'safety_sensitive',
            reason: 'safety_sensitive_query',
            risk: 'high_risk',
            requiresSources: false,
            sourcePolicy: 'safety'
        };
    }

    // When webMode is explicitly set to 'off', bypass all web search and live grounding
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

    // Stable geography, encyclopedic history, science, math, definitions, and code route directly to fast reasoning
    return {
        ...base,
        route: 'fast_simple',
        reason: 'stable_geography_or_general_fact',
        risk: 'low_risk',
        minimalThinking: true,
        requiresSources: false,
        sourcePolicy: 'none'
    };

    if (context.ambiguousContext) {
        return {
            ...base,
            route: 'clarify',
            reason: 'ambiguous_context',
            minimalThinking: true
        };
    }

    if (isSimpleStableQuestion(raw, context)) {
        return {
            ...base,
            route: 'fast_simple',
            reason: 'simple_stable_question',
            risk: 'low_risk',
            minimalThinking: true
        };
    }

    return base;
}

export function shouldUseMinimalThinking(text, intent = '', context = {}) {
    const normalizedIntent = String(intent || '');
    return isFastSimpleQuery(text, context) ||
        ['fast_simple', 'casual_conversation', 'fast_explainer'].includes(normalizedIntent);
}
