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

const ROUTES = Object.freeze(['llm', 'cached_latest', 'live_required', 'clarify']);

const STABLE_KNOWLEDGE_VECTOR = textToEmbeddingVector('conceptual exposition didactic explanation algorithmic implementation programming mathematical proof analytical derivation linguistic creative composition tutorial timeless definition meaning poem story quicksort python');
const SQL_GENERATION_VECTOR = textToEmbeddingVector('structured query language relational database schema relational algebra select query statement table column sql syntax');
const UNSUPPORTED_LIVE_VECTOR = textToEmbeddingVector('hyperlocal store inventory current in-stock nearby physical retail merchant opening hours');
const CHANGING_FACT_VECTOR = textToEmbeddingVector('dated event outcome tournament winner executive leadership champion ranking valuation release tenure');
const REVIEW_COMPARE_VECTOR = textToEmbeddingVector('consumer product comparison assessment benchmark evaluation specifications availability market valuation reviews');

const CATEGORY_PATTERNS = Object.freeze([
    {
        category: 'web_search',
        route: 'live_required',
        reason: 'explicit_or_current_topic_search_requires_web_sources',
        pattern: /\b(?:search(?:\s+the\s+web)?|web\s+search|lookup|find\s+online)\b/i,
        vector: textToEmbeddingVector('search lookup browse web sources internet online documents find articles')
    },
    {
        category: 'weather',
        route: 'live_required',
        reason: 'weather_requires_live_source',
        pattern: /\b(?:weather|temperature|forecast|rain|snow|storm|humidity|climate|precipitation)\b/i,
        vector: textToEmbeddingVector('weather temperature forecast rain snow atmospheric climate conditions precipitation meteorology')
    },
    {
        category: 'crypto',
        route: 'live_required',
        reason: 'crypto_price_requires_live_source',
        pattern: /\b(?:crypto|cryptocurrency|blockchain|token|coin|bitcoin|btc|ethereum|eth|solana|sol)\b/i,
        vector: textToEmbeddingVector('cryptocurrency blockchain digital currency pricing market exchange rate tokens quotes bitcoin btc ethereum')
    },
    {
        category: 'sports',
        route: 'live_required',
        reason: 'sports_updates_require_live_source',
        pattern: /\b(?:score|match|game|fixture|standings|tournament|championship|league|ipl|cricket|football|soccer|tennis|racing)\b/i,
        vector: textToEmbeddingVector('athletic tournament match game championship standings competition score league athletics results')
    },
    {
        category: 'disasters',
        route: 'live_required',
        reason: 'disaster_updates_require_live_source',
        pattern: /\b(?:earthquake|wildfire|flood|cyclone|hurricane|typhoon|tsunami|volcano|disaster|calamity)\b/i,
        vector: textToEmbeddingVector('emergency natural disaster hazard evacuation severe alert crisis catastrophe warning')
    },
    {
        category: 'conflicts_geopolitics',
        route: 'live_required',
        reason: 'geopolitical_conflict_requires_live_source',
        pattern: /\b(?:war|conflict|ceasefire|invasion|sanctions|treaty|geopolitics|hostilities)\b/i,
        vector: textToEmbeddingVector('geopolitics international relations armed diplomacy sovereignty treaty statecraft hostilities')
    },
    {
        category: 'space_science',
        route: 'live_required',
        reason: 'space_updates_require_live_source',
        pattern: /\b(?:nasa|spacex|starship|rocket|telescope|astronomy|satellite|spaceflight)\b/i,
        vector: textToEmbeddingVector('astronomy space exploration orbital astrophysics launch celestial planetary missions aerospace')
    },
    {
        category: 'technology',
        route: 'live_required',
        reason: 'tech_updates_require_live_source',
        pattern: /\b(?:hardware|software|processor|semiconductor|chip|ai\s+model|llm|technology)\b/i,
        vector: textToEmbeddingVector('computing technology hardware software architecture processors semiconductor devices breakthrough releases')
    },
    {
        category: 'government',
        route: 'live_required',
        reason: 'government_current_fact_requires_public_source',
        pattern: /\b(?:government|ministry|minister|president|governor|mayor|parliament|election|cabinet|administration|ceo)\b/i,
        vector: textToEmbeddingVector('prime minister president governor mayor minister civic leadership official tenure government parliament cabinet elections executive ceo')
    },
    {
        category: 'tourism_food_places',
        route: 'live_required',
        reason: 'place_or_travel_request_needs_location_source',
        pattern: /\b(?:tourism|tourist|travel|attractions?|hotel|places\s+to\s+visit)\b/i,
        vector: textToEmbeddingVector('travel tourism geography destination lodging heritage hospitality landmarks attractions places')
    },
    {
        category: 'news',
        route: 'cached_latest',
        reason: 'freshness_news_query',
        pattern: /\b(?:news|headline|announcement|press\s+release|breaking|release\s+notes|(?:latest|newest)\s+\w+(?:\s+\w+)?\s+release)\b/i,
        vector: textToEmbeddingVector('breaking journalism reporting periodic publications announcements press releases news updates dispatches')
    }
]);

const LLM_PATTERNS = Object.freeze([
    { test: (t) => vectorCosineSimilarity(textToEmbeddingVector(t), STABLE_KNOWLEDGE_VECTOR) >= 0.16 }
]);

const UNSUPPORTED_FREE_LIVE_PATTERNS = Object.freeze([
    { test: (t) => vectorCosineSimilarity(textToEmbeddingVector(t), UNSUPPORTED_LIVE_VECTOR) >= 0.28 }
]);

export function classifyFreeLiveIntent(message) {
    const text = normalizeMessage(message);
    if (!text) return strictRoute('clarify', 'clarify', 0.2, ['empty_message']);

    const queryVec = textToEmbeddingVector(text);
    const sqlSim = vectorCosineSimilarity(queryVec, SQL_GENERATION_VECTOR);
    if (sqlSim >= 0.28 || /\b(?:SELECT\s+.+\s+FROM|INSERT\s+INTO|CREATE\s+TABLE)\b/i.test(text) || (/\b(?:sql|database)\b/i.test(text) && /\b(?:table|schema|query|column)\b/i.test(text))) {
        return strictRoute('llm', 'sql_generation', 0.99, ['sql_query_generation_request']);
    }

    if (isExplicitSearchCommand(text)) {
        return strictRoute('live_required', 'web_search', 0.88, ['explicit_or_product_search_requires_web_sources']);
    }

    for (const pattern of UNSUPPORTED_FREE_LIVE_PATTERNS) {
        if (pattern.test(text)) {
            return strictRoute('live_required', 'unsupported_free_live', 0.82, ['no_durable_free_source']);
        }
    }

    for (const entry of CATEGORY_PATTERNS.slice(1)) {
        if (entry.pattern.test(text) || vectorCosineSimilarity(queryVec, entry.vector) >= 0.24) {
            return strictRoute(entry.route, entry.category, 0.86, [entry.reason]);
        }
    }

    if (isImplicitCurrentTopicSearch(text)) {
        return strictRoute('live_required', 'web_search', 0.82, ['current_topic_search_requires_web_sources']);
    }

    if (isDatedChangingFactSearch(text)) {
        return strictRoute('live_required', 'web_search', 0.84, ['dated_changing_fact_requires_public_source']);
    }

    const stableScore = vectorCosineSimilarity(queryVec, STABLE_KNOWLEDGE_VECTOR);
    if (stableScore >= 0.16) {
        return strictRoute('llm', 'stable_knowledge', Math.min(0.9, Math.max(0.42, stableScore)), ['default_or_stable_knowledge']);
    }
    return strictRoute('llm', 'stable_knowledge', 0.42, ['default_or_stable_knowledge']);
}

export function routeMessage(message) {
    const route = classifyFreeLiveIntent(message);
    return {
        route: route.route,
        confidence: route.confidence,
        reasons: route.reasons
    };
}

function strictRoute(route, category, confidence, reasons) {
    const normalizedRoute = ROUTES.includes(route) ? route : 'clarify';
    return {
        route: normalizedRoute,
        category: String(category || normalizedRoute),
        confidence: Number(confidence.toFixed(2)),
        reasons: Array.isArray(reasons) ? reasons.map(String).slice(0, 4) : []
    };
}

function normalizeMessage(message) {
    return String(message || '').replace(/\s+/g, ' ').trim().slice(0, 500);
}

function isExplicitSearchCommand(text) {
    return CATEGORY_PATTERNS[0].pattern.test(text);
}

function isImplicitCurrentTopicSearch(text) {
    const normalized = normalizeMessage(text);
    const qVec = textToEmbeddingVector(normalized);
    return vectorCosineSimilarity(qVec, REVIEW_COMPARE_VECTOR) >= 0.18;
}

function isDatedChangingFactSearch(text) {
    const normalized = normalizeMessage(text);
    if (!hasDateWindowSignal(normalized)) return false;
    if (/\b(?:won|winner|champion|champions|ranking|standings|release|price|tenure|election|movie|film|song|album)\b/i.test(normalized)) {
        return true;
    }
    const qVec = textToEmbeddingVector(normalized);
    return vectorCosineSimilarity(qVec, CHANGING_FACT_VECTOR) >= 0.14;
}

function hasDateWindowSignal(text) {
    return /\b(?:\d{4}|\d{1,4}[-/.]\d{1,2}[-/.]\d{2,4}|\p{L}{3,9}\s+\d{1,2},?\s+\d{4})\b/u.test(String(text || ''));
}

function tokenizeForIntent(text) {
    return String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || [];
}

function isIntentStopword(token) {
    return String(token || '').length <= 2;
}

export const __test = {
    CATEGORY_PATTERNS,
    LLM_PATTERNS,
    UNSUPPORTED_FREE_LIVE_PATTERNS,
    isDatedChangingFactSearch,
    hasDateWindowSignal,
    isImplicitCurrentTopicSearch
};
