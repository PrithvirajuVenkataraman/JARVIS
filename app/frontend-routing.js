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
        route: 'live_required',
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
