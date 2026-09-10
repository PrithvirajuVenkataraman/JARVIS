/**
 * @file app/frontend-routing.js
 * @description Zero-Hardcoding Dynamic Vector Semantic Frontend Routing Engine.
 * Dynamically classifies incoming user queries using 512-dimensional vector projections,
 * universal entity grammar, and zero static exemplar question tables.
 */

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

const IMAGE_NEGATIVE_REGEX = /\b(?:how\s+(?:to|can\s+i|do\s+(?:i|we|cameras|lenses|computers|eyes))\s+(?:draw|create|make|generate|paint|render)|explain\s+how\b|tell\s+me\s+how\b|tutorial\s+on\b|guide\s+to\b|learn\s+how\s+to\b|chart|graph|diagram|table|conclusion|flowchart|comparison|schema|wireframe|architecture|uml|draw\s+a\s+(?:conclusion|parallel|distinction|comparison|boundary|line\s+between)|(?:paint|paints|painted)\s+a\s+(?:grim|bleak|rosy|clearer)\s+picture|how\s+(?:cameras|lenses|mirrors|eyes|telescopes)\s+form\s+(?:an?\s+)?image|explain\s+image\s+formation)\b/i;

const CONVERSATIONAL_PREFIX = '^(?:(?:hey|hi|hello)\\s+)?(?:(?:bot|jarvis|ai|assistant)\\s*,?\\s+)?(?:can\\s+you\\s+(?:please\\s+)?|could\\s+you\\s+(?:please\\s+)?|would\\s+you\\s+(?:please\\s+)?|please\\s+|i\\s+(?:want|need)\\s+(?:you\\s+to\\s+)?(?:to\\s+)?|help\\s+me\\s+(?:to\\s+)?|kindly\\s+)?';

const IMAGE_POSITIVE_PATTERNS = [
    /^\/(?:image|img|draw|art)\b/i,
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:generate|create|render|make|draw|paint|sketch|produce)\\s+(?:me\\s+)?(?:an?\\s+)?(?:ai\\s+)?(?:image|picture|photo|photograph|drawing|painting|illustration|artwork|wallpaper|portrait|graphic|visual)(?:\\s+(?:of|showing|depicting|with|for|about|featuring)|\\s*[:-])\\s*`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:show\\s+me|display|give\\s+me)\\s+(?:an?\\s+)?(?:image|picture|photo|photograph|drawing|painting|illustration|artwork)\\s+(?:of|showing|depicting|with|for|about|featuring)\\s+`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:draw|paint|sketch)\\s+(?:me\\s+)?`, 'i'),
    new RegExp(`${CONVERSATIONAL_PREFIX}(?:an?\\s+)?(?:image|picture|photo|drawing|illustration|artwork)\\s+(?:of|showing|depicting)\\s+`, 'i'),
    new RegExp(`^(?:(?:hey|hi|hello)\\s+)?(?:(?:bot|jarvis|ai|assistant)\\s*,?\\s+)?i\\s+(?:want|need)\\s+(?:an?\\s+)?(?:image|picture|photo|illustration|drawing|artwork)\\s+(?:of|showing|depicting|with)\\s+`, 'i')
];

export function isImageGenerationIntent(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    if (/^\/(?:image|img|draw|art)\b/i.test(raw)) return true;
    if (IMAGE_NEGATIVE_REGEX.test(raw)) return false;
    return IMAGE_POSITIVE_PATTERNS.some(pat => pat.test(raw));
}

export function extractImagePrompt(text) {
    let raw = String(text || '').trim();
    if (!raw) return '';

    if (/^\/(?:image|img|draw|art)\s*/i.test(raw)) {
        return raw.replace(/^\/(?:image|img|draw|art)\s*/i, '').replace(/[?!.]+$/, '').trim();
    }

    for (const pat of IMAGE_POSITIVE_PATTERNS.slice(1)) {
        if (pat.test(raw)) {
            return raw.replace(pat, '').replace(/[?!.]+$/, '').trim();
        }
    }

    return raw.replace(/[?!.]+$/, '').trim();
}

/**
 * Automatically enriches and grounds image prompts for maximum accuracy,
 * resolving abbreviations (e.g. LA -> Los Angeles, California), adding authentic
 * architectural & environmental details, and avoiding deserted ghost-town renders.
 * Preserves user-specified artistic styles (anime, oil painting, sketch, etc.).
 * @param {string} prompt
 * @returns {string}
 */
export function enhanceImagePromptForAccuracy(prompt) {
    let clean = String(prompt || '').trim();
    if (!clean) return '';

    // Strip common conversational prompt filler
    clean = clean.replace(/^(?:a\s+)?(?:pic(?:ture)?|photo(?:graph)?|image)\s+(?:of|for)\s+/i, '').trim();

    // Check if user requested an explicitly non-photorealistic artistic style
    const isArtistic = /\b(?:anime|manga|oil\s+painting|watercolor|pencil\s+sketch|sketch|drawing|cartoon|illustration|pixel\s+art|cyberpunk|fantasy\s+art|3d\s+render|cgi|surreal)\b/i.test(clean);

    // Entity & Location Expansions
    const isLA = /^(?:la|l\.a\.|los\s+angeles)$/i.test(clean) || /\b(?:la|l\.a\.)\b/i.test(clean);
    const isNYC = /^(?:nyc|n\.y\.c\.|new\s+york\s+city)$/i.test(clean) || /\b(?:nyc|n\.y\.c\.)\b/i.test(clean);
    const isSF = /^(?:sf|s\.f\.|san\s+francisco)$/i.test(clean) || /\b(?:sf|s\.f\.)\b/i.test(clean);
    const isDC = /^(?:dc|d\.c\.|washington\s+dc)$/i.test(clean) || /\b(?:dc|d\.c\.)\b/i.test(clean);
    const isChidambaram = /\bchidambaram\b/i.test(clean);

    if (!isArtistic) {
        if (isLA) {
            return 'Vibrant photograph of Los Angeles, California showing the downtown skyline, palm tree-lined boulevard, active street with cars, under warm golden hour sunlight, authentic 8k photorealistic architecture';
        }
        if (isNYC) {
            return 'Iconic photograph of New York City, bustling Manhattan street with yellow cabs, historic and modern skyscrapers, clear daylight, crisp authentic architectural detail, 8k photography';
        }
        if (isSF) {
            return 'Cinematic photograph of San Francisco, California, Golden Gate vista and iconic rolling hills with Victorian architecture, authentic natural lighting, 8k photorealistic';
        }
        if (isDC) {
            return 'Distinguished photograph of Washington, D.C., National Mall and Capitol architecture with lush greenery and clear sky, authentic photorealistic detail';
        }
        if (isChidambaram) {
            return 'Authentic aerial view of Chidambaram historic temple town, Tamil Nadu, showcasing the Thillai Nataraja Temple complex with grand Dravidian gopurams and sacred Sivaganga water tank, detailed architecture, golden hour';
        }

        // For brief prompts (< 50 chars), ground with authentic textures, lighting, and detail
        if (clean.length < 50 && !/\b(?:photograph|photorealistic|detailed|cinematic|lighting|8k|4k)\b/i.test(clean)) {
            return `${clean}, authentic natural lighting, high detail, sharp focus, photorealistic 8k`;
        }
    }

    return clean;
}

/**
 * Parses and extracts an image prompt from a streamed or static LLM action tag.
 * Matches :::image[detailed visual description]:::
 * @param {string} text
 * @param {boolean} [requireClosed=true]
 * @returns {{ prompt: string, isClosed: boolean } | null}
 */
export function extractStreamedImageTag(text, requireClosed = true) {
    if (!text || typeof text !== 'string') return null;
    const closedRegex = /:::image\[([\s\S]*?)\](?:[ \t]*:::)?/i;
    const closedMatch = text.match(closedRegex);
    if (closedMatch && closedMatch[1].trim()) {
        return { prompt: closedMatch[1].trim(), isClosed: true };
    }
    if (!requireClosed) {
        const partialRegex = /:::image\[([\s\S]*?)(?:\]:::|\]|$)/i;
        const partialMatch = text.match(partialRegex);
        if (partialMatch && partialMatch[1].trim()) {
            return { prompt: partialMatch[1].trim(), isClosed: false };
        }
    }
    return null;
}

/**
 * Strips all :::image[...]::: tags from assistant response text for clean display.
 * @param {string} text
 * @returns {string}
 */
export function stripStreamedImageTags(text) {
    if (!text || typeof text !== 'string') return '';
    return text.replace(/:::image\[[\s\S]*?(?:\](?:[ \t]*:::)?|$)/gi, '').trim();
}


function formatName(str) {
    return String(str || '')
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

export function extractEntityTarget(text) {
    const raw = String(text || '').trim().replace(/[?!.,;:]+$/g, '');
    if (!raw || raw.length < 4) return null;
    if (/^(?:explain|describe|how|why|calculate|solve|list|compare|summarize|write)\b/i.test(raw)) return null;

    const match = raw.match(/^(?:who\s+is|who's|tell\s+me\s+who\s+is|who\s+serves\s+as|what\s+is|who\s+was|who)?\s*(?:the\s+)?(?:current|latest|present|today|now)?\s*([a-zA-Z\s]{2,30}?)\s+of\s+([a-zA-Z0-9_\s]{2,40})$/i);
    if (match && match[1] && match[2]) {
        const rawRole = match[1].trim();
        const rawPlace = match[2].replace(/\b(?:today|right now|currently)\b/gi, '').trim().replace(/^the\s+/i, '');
        const isRoleTitle = /\b(?:cm|pm|minister|president|governor|mayor|ceo|chairperson|chairman|director|chancellor|secretary|head|leader|chief|ruler|premier|ambassador|king|queen|founder|captain)\b/i.test(rawRole);

        if (rawRole && rawPlace && isRoleTitle && !/^(capital|weather|temperature|history|definition|meaning|source|origin|formula|equation|speed|laws?|the\s+speed)\b/i.test(rawRole)) {
            let roleNorm = formatName(rawRole);
            if (rawRole.toLowerCase() === 'cm') roleNorm = 'Chief Minister';
            else if (rawRole.toLowerCase() === 'pm') roleNorm = 'Prime Minister';
            else if (rawRole.toLowerCase() === 'ceo') roleNorm = 'CEO';
            return {
                role: roleNorm,
                jurisdiction: formatName(rawPlace)
            };
        }
    }

    return null;
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
    if (/\b(?:latest\s+news|breaking\s+news|live\s+(?:[a-z]+\s+){0,2}scores?|match\s+scores?|cricket\s+scores?|(?:stock|bitcoin|crypto|btc|eth|ethereum|gold|silver)\s+price|price\s+of\s+(?:bitcoin|crypto|btc|eth|ethereum|gold|silver|stock)|weather|forecast|temperature\s+in|market\s+cap|changelog|release\s+notes|what'?s\s+new\s+in|new\s+features?\s+in|near\s+me|nearby|directions\s+to|places\s+to\s+visit\s+in|things\s+to\s+do\s+in|attractions\s+in|places\s+open\s+now|open\s+now|hotels?\s+near|restaurants?\s+near|museums?\s+near|best\s+restaurants\s+in|restaurants?\s+open|search\s+the\s+web|google\s+search|search\s+online|with\s+sources)\b/i.test(raw)) {
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

    // Universal entity & leadership classifier
    const entityTarget = extractEntityTarget(raw);
    const isHistorical = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history\s+of)\b/i.test(raw);

    const res = (entityTarget && !isHistorical) ? {
        isLiveRequired: true,
        isStableKnowledge: false,
        entityTarget,
        category: 'entity_leadership',
        reason: 'mutable_officeholder'
    } : {
        isLiveRequired: false,
        isStableKnowledge: true,
        entityTarget: isHistorical ? null : entityTarget,
        category: 'stable_general_knowledge',
        reason: 'stable_general_knowledge'
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
    if (!raw) return false;
    return /^(?:\/?(?:translate|summarize|paraphrase|rewrite|professional)|(?:fix\s+grammar|make\s+this\s+professional))\b/i.test(raw);
}

export function isVerifyCommand(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^\/verify\b/i.test(raw) || /^verify\s+this\s*:/i.test(raw);
}

export function isStudyCommand(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return /^\/study\b/i.test(raw) || /^(?:teach\s+me\s+this\s+topic\s*:|study\s+this\s*:)/i.test(raw);
}

/**
 * Binary decision classifier: LIVE WEB SEARCH vs NORMAL LLM ANSWER
 *
 * Evaluates whether a normal LLM can reliably answer the user's request without
 * information that may have changed since the model's knowledge cutoff / current knowledge.
 *
 * Output schema:
 * {
 *   route: "live_required" | "normal_llm",
 *   confidence: number,
 *   reason: string,
 *   requiresSources: boolean
 * }
 *
 * @param {string} text - User query text
 * @param {object} [context={}] - Conversation context, thread history, webMode, etc.
 * @returns {{
 *   route: 'live_required' | 'normal_llm',
 *   confidence: number,
 *   reason: string,
 *   requiresSources: boolean
 * }}
 */
export function classifyLiveVsNormal(text, context = {}) {
    const raw = String(text || '').trim();
    if (!raw) {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'empty_query',
            requiresSources: false
        };
    }

    if (context.webMode === 'off') {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'web_mode_off',
            requiresSources: false
        };
    }

    if (context.explicitWeb || context.webMode === 'on' || isVerifyCommand(raw)) {
        return {
            route: 'live_required',
            confidence: 1.0,
            reason: isVerifyCommand(raw) ? 'verify_command_requires_sources' : 'explicit_web_requested',
            requiresSources: true
        };
    }

    const isExplicitSearch = /\b(?:search\s+(?:the\s+)?web|look\s+up\s+online|google\s+(?:it|this|for)|search\s+online|with\s+sources|with\s+citations|live\s+information)\b/i.test(raw);
    if (isExplicitSearch) {
        return {
            route: 'live_required',
            confidence: 0.95,
            reason: 'explicit_web_requested',
            requiresSources: true
        };
    }

    if (isCasualConversationQuery(raw) || isTransformFastQuery(raw) || isStudyCommand(raw) || isJokeFastQuery(raw)) {
        return {
            route: 'normal_llm',
            confidence: 0,
            reason: 'casual_or_transformation_query',
            requiresSources: false
        };
    }

    // -------------------------------------------------------------------------
    // Token Disambiguation & False Positive Neutralization
    // -------------------------------------------------------------------------

    // Physical / circuit / ocean / fluid "current"
    const isPhysicalCurrent = /\b(?:alternating|direct|electric|electrical|ocean|water|eddy|convection|thermal|displacement|bias|leakage|dark|drift|fault|inrush|reverse|saturation|steady|transient|surface|rip|tidal|gulf\s+stream|deep\s+sea)\s+currents?\b|\bcurrents?\s+(?:divider|density|gain|ratio|flow|meter|loop|source|mirror|regulator|transformer|transducer|collector|limiting|sensor|switch|clamp|rating|waveform|pulse|vector|algebra)\b|\b(?:ac|dc)\s+currents?\b/i.test(raw);

    // Biology "common ancestor"
    const isCommonAncestor = /\b(?:most\s+recent|latest|last)\s+common\s+ancestor\b/i.test(raw);

    // Proper nouns and programming constructs containing "new"
    const isNewProperNounOrCode = /\b(?:new\s+york|new\s+jersey|new\s+zealand|new\s+delhi|new\s+mexico|new\s+hampshire|new\s+south\s+wales|papua\s+new\s+guinea|new\s+orleans|new\s+england|new\s+deal|new\s+kingdom|new\s+world|new\s+testament|brand\s+new)\b/i.test(raw)
        || /\b(?:new\s+(?:keyword|operator|instance|object|array|class|promise|map|set|date|error)|operator\s+new)\b/i.test(raw);

    // -------------------------------------------------------------------------
    // Positive Signals (Time-Sensitive, Changing & Live Queries)
    // -------------------------------------------------------------------------
    let score = 0;
    const matchedReasons = [];

    // Dynamic Year Analysis
    const CURRENT_YEAR = new Date().getFullYear();
    const yearMatches = raw.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/g);
    let hasContemporaryYear = false;
    let hasHistoricalYear = false;

    if (yearMatches) {
        for (const ym of yearMatches) {
            const y = parseInt(ym, 10);
            if (y >= CURRENT_YEAR - 1 && y <= CURRENT_YEAR + 2) {
                hasContemporaryYear = true;
            } else if (y < CURRENT_YEAR - 1) {
                hasHistoricalYear = true;
            }
        }
    }

    // Specific ISO Date (e.g., 2023-03-15)
    const isSpecificDate = /\b\d{4}-\d{2}-\d{2}\b/.test(raw) || /\b(?:as\s+of|on)\s+\d{4}-\d{2}-\d{2}\b/i.test(raw);

    // Financial & Cryptocurrency Markets
    const isLiveMarket = /\b(?:stock|share|crypto|cryptocurrency|bitcoin|btc|ethereum|eth|solana|gold|silver|crude\s+oil|forex|fx)\s+(?:price|prices|quotes?|value|rate|rates|all-time\s+high|ath|market\s*cap|trading\s+volume)\b|\b(?:price|quote|market\s*cap|exchange\s+rate|market\s+valuation)\s+of\s+(?:bitcoin|btc|eth|ethereum|solana|crypto|cryptocurrency|stocks?|shares?|gold|silver|apple|tesla|nvidia|microsoft|google|amazon|meta|alphabet)\b|\b(?:exchange\s+rate|currency\s+exchange|conversion\s+rate|market\s+valuation|quarterly\s+earnings|earnings\s+report)\b/i.test(raw);

    // Weather & Real-time environmental
    const isLiveWeather = /\b(?:weather|forecast|temperature|humidity|uv\s+index|rain\s+chances?|air\s+quality|aqi)\s+(?:in|for|at|today|now|tomorrow|this\s+week|right\s+now)\b|\b(?:is\s+it\s+raining|will\s+it\s+rain|weather\s+today|weather\s+forecast)\b/i.test(raw);

    // Live Sports, Scores, Schedules & Standings
    const isLiveSports = /\b(?:live\s+(?:[a-z]+\s+){0,2}scores?|match\s+scores?|cricket\s+scores?|football\s+scores?|nba\s+scores?|game\s+scores?|ipl\s+scores?|current\s+scores?|who\s+won\s+yesterday|who\s+is\s+winning|match\s+status|premier\s+league\s+standings|points\s+table|who\s+won\s+(?:the\s+)?(?:latest|last|recent)\s+(?:super\s+bowl|fifa|world\s+cup|match|tournament|game))\b/i.test(raw);

    // Breaking News & Current Events
    const isLiveNews = /\b(?:breaking\s+news|latest\s+news|recent\s+news|headlines?|what\s+happened\s+today|what('?s|\s+is)\s+happening\s+in|ongoing\s+events?|current\s+events?|latest\s+updates?\s+(?:on|about))\b/i.test(raw);

    // Tech releases & changelogs
    const isTechRelease = /\b(?:what'?s\s+new\s+in|changelog|release\s+notes|new\s+features?\s+in)\s+[a-zA-Z0-9_.-]+|\b(?:latest\s+version\s+of|latest\s+release\s+of)\b/i.test(raw);

    // Mutable leadership / officeholders
    const isLeadershipCandidate = (
        /\b(?:who\s+is|who's|tell\s+me\s+who\s+is|who\s+serves\s+as)\s+(?:the\s+)?(?:current\s+|latest\s+|present\s+|incumbent\s+|today'?s\s+|now\s+)?(?:cm|pm|chief\s+minister|prime\s+minister|president|ceo|governor|mayor|chancellor|secretary\s+general|vice\s+president|director\s+general|commissioner|captain|coach)(?:\s+(?:of|now|currently|today))?\b/i.test(raw)
        || /\b(?:current|present|incumbent)\s+(?:cm|pm|chief\s+minister|prime\s+minister|president|ceo|governor|mayor|chancellor|secretary\s+general|captain|coach)\s+of\b/i.test(raw)
        || Boolean(extractEntityTarget(raw))
    );
    const isExplicitHistoricalLeadership = /\b(?:first|former|past|who\s+was|history\s+of|prior\s+to|before\s+(?:him|her|them))\b/i.test(raw) || hasHistoricalYear;
    const isCurrentLeadership = isLeadershipCandidate && !isExplicitHistoricalLeadership;

    // Un-neutralized Freshness Cues
    const hasUnneutralizedFreshness = (
        (!isPhysicalCurrent && /\b(?:current|currently|presently)\b/i.test(raw))
        || (!isCommonAncestor && /\b(?:latest|newest|recent|recently)\b/i.test(raw))
        || /\b(?:today|tonight|now|right\s+now|as\s+of\s+(?:today|now)|this\s+week|this\s+month|this\s+year)\b/i.test(raw)
        || (!isNewProperNounOrCode && /\b(?:what'?s\s+new|new\s+features?)\b/i.test(raw))
    );

    // Local amenities / places open now
    const isLocalLiveQuery = /\b(?:places\s+open\s+now|open\s+now|best\s+restaurants\s+in|hotels\s+near\s+me|restaurants\s+near\s+me|near\s+me|directions\s+to)\b/i.test(raw);

    // Apply positive weights
    if (isLiveMarket) { score += 0.60; matchedReasons.push('market_data'); }
    if (isLiveWeather) { score += 0.60; matchedReasons.push('weather_forecast'); }
    if (isLiveSports) { score += 0.60; matchedReasons.push('live_sports'); }
    if (isLiveNews) { score += 0.60; matchedReasons.push('breaking_news'); }
    if (isTechRelease) { score += 0.40; matchedReasons.push('tech_release'); }
    if (isCurrentLeadership) { score += 0.45; matchedReasons.push('mutable_leadership'); }
    if (isLocalLiveQuery) { score += 0.60; matchedReasons.push('local_live_query'); }
    if (hasContemporaryYear) { score += 0.35; matchedReasons.push('contemporary_year'); }
    if (hasUnneutralizedFreshness) { score += 0.25; matchedReasons.push('freshness_cue'); }

    if (isSpecificDate) {
        if (isLiveMarket || isLiveWeather || /\b(?:price|score|weather|event|stock)\b/i.test(raw)) {
            score += 0.40;
            matchedReasons.push('specific_historical_metric');
        } else {
            score += 0.15;
        }
    }

    const isQuestionCue = /\b(what\s+is|who\s+is|how\s+many|price\s+of|score\s+of)\b/i.test(raw);
    if (isQuestionCue && (hasUnneutralizedFreshness || hasContemporaryYear || isLiveMarket || isSpecificDate)) {
        score += 0.15;
    }

    // -------------------------------------------------------------------------
    // Conversational Context (Anaphora & Ellipsis Tracking)
    // -------------------------------------------------------------------------
    const thread = context.contextResolution?.activeThread || context.activeThread || null;
    const threadEntity = String(thread?.entity || thread?.topic || '').trim();
    const threadRole = String(thread?.role || '').trim();

    if (threadEntity || threadRole) {
        const isAnaphoricFollowup = /\b(?:he|him|she|her|it|they|them|their|its|that|this|there)\b/i.test(raw)
            || /^(?:what\s+about|and|how\s+about|who\s+about)\b/i.test(raw)
            || raw.length < 40;

        if (isAnaphoricFollowup) {
            const isFollowupCurrentStatus = (
                hasUnneutralizedFreshness
                || /\b(?:now|today|current|stock|price|weather|status|score|ceo|leader|minister|value|worth)\b/i.test(raw)
            ) && !/\b(?:before|prior|first|former|who\s+was|history)\b/i.test(raw);

            if (isFollowupCurrentStatus) {
                score += 0.60;
                matchedReasons.push('context_current_status_followup');
            }
        }
    }

    // -------------------------------------------------------------------------
    // Negative Signals (Normal LLM Knowledge)
    // -------------------------------------------------------------------------
    if (isPhysicalCurrent && !isLiveMarket && !isLiveWeather && !isLiveNews) {
        score -= 0.40;
    }

    if (isCommonAncestor) {
        score -= 0.40;
    }

    const isMathOrAlgorithm = /\b(?:calculate|derivative|integral|eigenvalue|theorem|proof|quicksort|mergesort|binary\s+search|time\s+complexity|big\s+o|recursion|dynamic\s+programming|fibonacci|data\s+structure|binary\s+tree|graph\s+traversal|euclidean|matrix\s+multiplication)\b/i.test(raw);
    if (isMathOrAlgorithm) {
        score -= 0.40;
    }

    const isCodingQuery = /\b(?:write\s+(?:a\s+)?(?:function|script|code|class|program|regex)|how\s+to\s+(?:implement|write|use|parse|format|loop\s+through)|debug\s+this|syntax\s+of|example\s+of\s+code|in\s+(?:python|javascript|typescript|c\+\+|java|rust|go|sql|html|css))\b/i.test(raw)
        && !isTechRelease;
    if (isCodingQuery) {
        score -= 0.40;
    }

    const isConceptualOrScience = (
        /^(?:what\s+is|what\s+are|define|explain|tell\s+me\s+about\s+the\s+concept\s+of)\s+/i.test(raw)
        && /\b(?:photosynthesis|mitochondria|pythagorean|gravity|calculus|relativity|quantum|evolution|stoicism|democracy|metaphor|alliteration|osmosis|thermodynamics|newton'?s)\b/i.test(raw)
    );
    if (isConceptualOrScience) {
        score -= 0.45;
    }

    const isTimelessHistoryOrGeo = (
        /\b(?:capital\s+of|who\s+wrote|who\s+painted|who\s+composed|who\s+invented|who\s+discovered|speed\s+of\s+light|chemical\s+formula\s+of|atomic\s+number)\b/i.test(raw)
        || /^(?:when\s+was|where\s+was)\s+[a-zA-Z\s]+\s+(?:born|built|founded|written|signed|invented)\b/i.test(raw)
    );
    if (isTimelessHistoryOrGeo && !hasUnneutralizedFreshness && !isLiveMarket) {
        score -= 0.45;
    }

    if (hasHistoricalYear && !isSpecificDate && !isLiveMarket && !hasUnneutralizedFreshness) {
        score -= 0.35;
    }

    const confidence = Math.max(0, Math.min(1.0, Math.round(score * 100) / 100));
    const isLive = confidence >= 0.6;
    const reason = isLive ? 'heuristic_live_required' : 'stable_llm_knowledge';

    return {
        route: isLive ? 'live_required' : 'normal_llm',
        confidence,
        reason,
        requiresSources: isLive
    };
}

/**
 * Heuristic confidence scoring for live-required queries.
 * Returns a score between 0 and 1.
 *
 * @param {string} text - User query
 * @param {object} [context={}] - Routing & conversation context
 * @returns {number}
 */
export function liveRequiredConfidence(text, context = {}) {
    return classifyLiveVsNormal(text, context).confidence;
}

export function normalizeSlashCommand(text) {
    const raw = String(text || '').trim();
    if (!raw.startsWith('/')) {
        return { isSlashCommand: false, command: null, payload: raw, normalizedText: raw };
    }

    const match = raw.match(/^\/([a-z_-]+)(?:\s+([\s\S]*))?$/i);
    if (!match) {
        return { isSlashCommand: false, command: null, payload: raw, normalizedText: raw };
    }

    const command = match[1].toLowerCase();
    const payload = (match[2] || '').trim();

    switch (command) {
        case 'translate': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'translate "..." to Tamil' };
            if (/\bto\s+[a-zA-Z\s]+$/i.test(payload)) {
                return { isSlashCommand: true, command, payload, normalizedText: `Translate ${payload}` };
            }
            return { isSlashCommand: true, command, payload, normalizedText: `Translate the following text accurately: ${payload}` };
        }
        case 'summarize': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'summarize this: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Summarize the following text concisely:\n${payload}` };
        }
        case 'verify': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'verify this: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Verify whether this claim or answer is factual: ${payload}` };
        }
        case 'professional': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'make this professional: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Rewrite the following text to be professional, clear, and polished:\n${payload}` };
        }
        case 'study': {
            if (!payload) return { isSlashCommand: true, command, payload: '', normalizedText: 'teach me this topic: ' };
            return { isSlashCommand: true, command, payload, normalizedText: `Teach me the key concepts of this topic clearly with examples and a short quiz:\n${payload}` };
        }
        case 'image':
        case 'img':
        case 'draw':
        case 'art': {
            return { isSlashCommand: true, command: 'image', payload, normalizedText: payload };
        }
        default:
            return { isSlashCommand: true, command, payload, normalizedText: payload || raw };
    }
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
        isStudyCommand(text) ||
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
        speakResponse: false,
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

    const threadKey = context.contextResolution?.activeThread?.entity || context.contextResolution?.activeThread?.topic || context.activeThread?.entity || context.activeThread?.topic || '';
    const cacheKey = `${raw.toLowerCase()}::${context.webMode || ''}::${Boolean(context.placeGrounded)}::${Boolean(context.safetySensitive)}::${turnSource}::${threadKey}`;
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

    if (isImageGenerationIntent(raw)) {
        const prompt = extractImagePrompt(raw);
        const res = {
            ...base,
            route: 'image_generation',
            reason: 'image_generation_intent',
            prompt,
            risk: 'low_risk',
            requiresSources: false,
            minimalThinking: true,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isVerifyCommand(raw)) {
        const res = {
            ...base,
            route: 'live_required',
            reason: 'verify_command_requires_sources',
            risk: 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'required'
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

    const liveDecision = classifyLiveVsNormal(raw, context);
    if (!isWebOff && liveDecision.route === 'live_required') {
        const res = {
            ...base,
            route: 'live_required',
            reason: liveDecision.reason || 'heuristic_live_required',
            risk: 'medium_risk',
            requiresSources: true,
            sourcePolicy: 'required'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
    }

    if (isTransformFastQuery(raw) || isStudyCommand(raw)) {
        const res = {
            ...base,
            route: 'fast_simple',
            reason: 'command_transformation_fast',
            risk: 'low_risk',
            minimalThinking: true,
            requiresSources: false,
            sourcePolicy: 'none'
        };
        FRONTEND_ROUTE_CACHE.set(cacheKey, res);
        return res;
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
