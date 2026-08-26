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
 * Determines whether a query represents stable encyclopedic knowledge, geography,
 * history, architecture, science, mathematics, definitions, or programming concepts
 * that can be answered reliably without live web search.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function isStableGeographyOrGeneralFactQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const lower = raw.toLowerCase().replace(/[?!.,;:]+$/g, '').trim();

    // 1. Live / Time-sensitive exclusions (Must NOT be treated as stable)
    const liveOfficeholderSignals = /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)\s+(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|chairman|leader|head\s+of\s+state))\b/i;
    const liveCmPmSignals = /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i;
    const liveDomainSignals = /\b(?:weather\s+in|forecast\s+for|temperature\s+in|stock\s+price|price\s+of\s+(?:bitcoin|btc|eth|solana|crypto|gold|silver|crude|shares?)|market\s+cap\s+of|live\s+score|ipl\s+(?:score|schedule|match|table)|breaking\s+news|today'?s\s+news|earthquake\s+today|election\s+results?\s+today)\b/i;
    const explicitFreshnessSignals = /\b(?:as\s+of\s+today|right\s+now|open\s+now|near\s+me|with\s+sources?|source\s+links?)\b/i;
    const explicitFreshnessUpdate = /\b(?:what'?s\s+new|new\s+(?:update|updates|release|version|announcement|news|development|features?))\b/i;
    const actionableTravelSignals = /\b(?:directions\s+to|route\s+to|how\s+to\s+(?:reach|get\s+to)|hotels?\s+(?:near|around|in)|restaurants?\s+(?:near|around|in)|ticket\s+price|tickets?\s+for|entry\s+fee|visiting\s+hours|timings?\s+of|places\s+to\s+visit|things\s+to\s+do\s+in|sightseeing\s+in|near\s+me|nearby|near\s+[a-z]+)\b/i;

    if (
        liveOfficeholderSignals.test(lower) ||
        liveCmPmSignals.test(lower) ||
        liveDomainSignals.test(lower) ||
        explicitFreshnessSignals.test(lower) ||
        explicitFreshnessUpdate.test(lower) ||
        actionableTravelSignals.test(lower)
    ) {
        return false;
    }

    // 2. Geography & World Facts (Capitals, countries, rivers, mountains, continents, currencies, borders)
    const capitalPatterns = [
        /\b(?:what\s+(?:is|was)|which\s+city\s+is|name)\s+(?:the\s+)?capital\s+(?:city\s+)?of\s+[a-z\s.'-]+/i,
        /\b(?:capital\s+(?:city\s+)?of\s+[a-z\s.'-]+)/i,
        /\b[a-z\s.'-]+\s+capital\b/i
    ];
    if (capitalPatterns.some(p => p.test(lower))) {
        return true;
    }

    const geographySignals = /\b(?:continent|continents|ocean|oceans|sea|seas|river|rivers|mountain|mountains|mountain\s+range|plateau|desert|island|islands|valley|gulf|bay|strait|peninsula|archipelago|hemisphere|equator|latitude|longitude|tropic\s+of\s+(?:cancer|capricorn)|longest\s+river|highest\s+mountain|deepest\s+ocean|largest\s+desert|largest\s+country|smallest\s+country|currency\s+of|official\s+language\s+of|national\s+animal|national\s+bird|national\s+flower|national\s+anthem|population\s+of|area\s+of|located\s+in|location\s+of|where\s+is\s+.+\s+located|where\s+are\s+.+\s+located)\b/i;
    if (geographySignals.test(lower)) {
        return true;
    }

    // 3. Architecture, Historic Monuments, Landmarks & Geological Formations
    const monumentAndFormationSignals = /\b(?:architecture\s+of|geological\s+formation|formation\s+of|monument|landmark|temple|tomb|pyramid|castle|palace|cathedral|tower|statue|trench|canyon|waterfall|valley|why\s+was\s+.+\s+(?:constructed|built|created|founded)|who\s+(?:built|constructed|designed|founded|created)\s+|when\s+was\s+.+\s+(?:built|constructed|founded)|history\s+of|origin\s+of|significance\s+of|ancient\s+wonder|world\s+heritage)\b/i;
    if (monumentAndFormationSignals.test(lower)) {
        return true;
    }

    // 4. History, Empires, Treaties, Civilizations & Eras
    const historySignals = /\b(?:history|ancient|medieval|century|empire|dynasty|civilization|battle\s+of|treaty\s+of|revolution|renaissance|archaeology|historical|era|age|monarch|emperor|king|queen|pharaoh|ruler|first\s+president\s+of|former\s+president|founder\s+of|constitution|declaration)\b/i;
    if (historySignals.test(lower)) {
        return true;
    }

    // 5. Science (Physics, Chemistry, Biology, Space, Astronomy, Medicine)
    const scienceSignals = /\b(?:physics|chemistry|biology|astronomy|cosmology|quantum|gravity|relativity|thermodynamics|optics|evolution|photosynthesis|mitosis|meiosis|dna|rna|gene|protein|cell|atom|molecule|neutron|supernova|galaxy|planet|orbit|solar\s+system|exoplanet|telescope|nebula|dark\s+matter|electromagnetism|particle|speed\s+of\s+light|periodic\s+table|atomic\s+number|chemical\s+reaction|oxidation|reduction|enzyme|organelle|who\s+discovered|who\s+invented|how\s+was\s+.+\s+discovered)\b/i;
    if (scienceSignals.test(lower)) {
        return true;
    }

    // 6. Mathematics & Logic
    const mathSignals = /\b(?:calculate|compute|solve|integrate|integral|derivative|differentiate|equation|formula|pythagorean|factorial|matrix|matrices|determinant|eigenvalue|eigenvector|probability|permutation|combination|trigonometry|sin|cos|tan|logarithm|prime\s+number|fibonacci|geometry|algebra|calculus)\b/i;
    if (mathSignals.test(lower) || /^\s*[\d\s+\-*/^().=xXyYzZ]+\s*$/.test(raw)) {
        return true;
    }

    // 7. Computer Science, AI, NLP, Programming & Technology Concepts
    const programmingSignals = /\b(?:programming|coding|algorithm|data\s+structure|function|method|class|interface|variable|constant|array|object|pointer|reference|interface|struct|enum|loop|recursion|sorting|binary\s+search|tree|graph|stack|queue|complexity|compiler|interpreter|debug|refactor|framework|database|api|regex|nlp|natural\s+language\s+processing|ai|ml|machine\s+learning|deep\s+learning|artificial\s+intelligence|computer\s+vision|neural\s+networks?|transformers?|llms?|large\s+language\s+models?)\b/i;
    if (programmingSignals.test(lower)) {
        return true;
    }

    // 8. Philosophy, Social Science, Definitions & Linguistics
    const philosophyAndSocialSignals = /\b(?:philosophy|ethics|epistemology|metaphysics|ontology|stoicism|utilitarianism|existentialism|economics|macroeconomics|microeconomics|inflation|gdp|monetary\s+policy|fiscal\s+policy|sociology|psychology|cognitive|linguistics|grammar|syntax|semantics)\b/i;
    const definitionalSignals = /\b(?:definition\s+of|meaning\s+of|what\s+is\s+the\s+definition\s+of|what\s+is\s+the\s+meaning\s+of|define\s+|explain\s+(?:the\s+concept\s+of|what|how|why)|difference\s+between)\b/i;
    if (philosophyAndSocialSignals.test(lower) || (definitionalSignals.test(lower) && raw.length <= 160)) {
        return true;
    }

    // 9. Simple stable questions (e.g. "What is X?", "Who was X?", "Where is X located?", "How does X work?")
    if (/^(?:where\s+is|where\s+was|where\s+are|what\s+is|what\s+was|what\s+are|what'?s|who\s+was|how\s+does|how\s+do|explain|define|tell\s+me\s+about)\s+[\w\s.'-]{2,80}\??$/i.test(raw)) {
        return true;
    }

    return false;
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

    const lower = raw.toLowerCase();

    // 1. Explicit search requests or user asking for source links
    if (context.explicitWeb || /\b(?:search\s+(?:for|the\s+web\s+for|google\s+for)|find\s+(?:articles|news|web\s+pages)\s+about|look\s+up\s+online|with\s+sources?|source\s+links?)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search_or_sources'
        };
    }

    // 2. Domain-specific live data (Weather, Finance / Crypto, Live Sports, Breaking News)
    if (/\b(?:weather|forecast|temperature|humidity|rain|rainfall|precipitation)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'weather',
            reason: 'time_sensitive_weather'
        };
    }
    if (/\b(?:stock\s+price|share\s+price|market\s+cap|price\s+of\s+(?:bitcoin|btc|ethereum|eth|solana|crypto|gold|silver|crude|shares?|stocks?))\b/i.test(lower) ||
        /\b(?:bitcoin|btc|ethereum|eth|solana|crypto|gold|silver|crude)\s+(?:price|rate|valuation|chart|market\s+cap)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'finance_crypto',
            reason: 'live_market_price'
        };
    }
    if (/\b(?:live\s+score|ipl\s+(?:score|match|schedule|fixtures?|table)|election\s+results?\s+today|breaking\s+news|today'?s\s+news|latest\s+news|earthquake\s+today)\b/i.test(lower) ||
        /\b(?:news\s+about|news\s+today|latest\s+updates?\s+on)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'breaking_live',
            reason: 'breaking_news_or_sports'
        };
    }

    // 3. Mutable political leadership & civic officeholders
    const isHistoricalLeader = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was\s+the|history\s+of)\b/i.test(lower);
    if (
        !isHistoricalLeader &&
        (/\b(?:current|latest|present|today|now)\s+(?:governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader|ruler|head\s+of\s+state)\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)?\s*(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|chairman))\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of)\b/i.test(lower))
    ) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'political_leadership',
            reason: 'mutable_officeholder'
        };
    }

    // 4. Stable Geography & General Knowledge
    if (isStableGeographyOrGeneralFactQuery(raw)) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'stable_general_knowledge',
            reason: 'stable_fact_or_geography'
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

    // User explicitly requested sources or web search
    const asksSources = /\b(with sources?|source links?)\b/i.test(raw);
    if (context.explicitWeb || asksSources) {
        return {
            ...base,
            route: 'live_required',
            reason: 'user_requested_sources',
            requiresSources: true,
            sourcePolicy: 'required'
        };
    }

    // Stable geography, encyclopedic history, science, math, definitions, and code route directly to fast reasoning
    if (isStableGeographyOrGeneralFactQuery(raw)) {
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

    if (context.placeGrounded || PLACE_SIGNAL_PATTERN.test(lower)) {
        return {
            ...base,
            route: 'place_grounded',
            reason: 'place_query_requires_evidence',
            risk: context.risk || 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'place_grounded'
        };
    }

    const isHistoricalRole = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was\s+the|history\s+of)\b/i.test(lower);
    if (
        context.requiresSources ||
        context.liveIntent ||
        context.strictLatest ||
        context.currentInfo ||
        context.liveRetrieval ||
        LIVE_SIGNAL_PATTERN.test(lower) ||
        (!isHistoricalRole && (CURRENT_ROLE_PATTERN.test(lower) || /\b(?:cm|pm)\b/i.test(lower)))
    ) {
        return {
            ...base,
            route: 'live_required',
            reason: 'source_or_freshness_required',
            requiresSources: true,
            sourcePolicy: 'required'
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
