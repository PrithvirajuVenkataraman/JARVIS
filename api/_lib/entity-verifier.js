/**
 * @file api/_lib/entity-verifier.js
 * @description Fallback validation routine that cross-checks time-sensitive political and structural entities
 * (e.g., elected officials, heads of government, corporate officers) against live sources from trusted domain namespaces.
 */

const TRUSTED_DOMAINS = new Set([
    'wikipedia.org',
    'en.wikipedia.org',
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'thehindu.com',
    'indianexpress.com',
    'ndtv.com',
    'timesofindia.indiatimes.com',
    'gov.in',
    'nic.in',
    'tn.gov.in',
    'india.gov.in',
    'whitehouse.gov',
    'gov.uk',
    'nih.gov',
    'cdc.gov',
    'who.int'
]);

/**
 * Extracts domain hostname from URL.
 * @param {string} rawUrl 
 * @returns {string}
 */
export function extractHostname(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

/**
 * Checks if a domain is within trusted namespaces.
 * @param {string} domain 
 * @returns {boolean}
 */
export function isTrustedDomain(domain) {
    const d = String(domain || '').toLowerCase().trim();
    if (!d) return false;
    if (TRUSTED_DOMAINS.has(d)) return true;
    return d.endsWith('.gov') || d.endsWith('.gov.in') || d.endsWith('.nic.in') || d.endsWith('.edu') || d.endsWith('.org');
}

/**
 * Identifies political or structural entity roles in text.
 * @param {string} text 
 * @returns {{ role: string, jurisdiction: string } | null}
 */
export function extractEntityTarget(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;

    const roleMatches = [
        { regex: /\b(?:cm|chief minister)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Chief Minister' },
        { regex: /\b(?:pm|prime minister)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Prime Minister' },
        { regex: /\b(?:president)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'President' },
        { regex: /\b(?:governor)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Governor' },
        { regex: /\b(?:mayor)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Mayor' },
        { regex: /\b(?:ceo|chief executive officer)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'CEO' },
        { regex: /\b(?:chairman|chairperson)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Chairperson' }
    ];

    for (const item of roleMatches) {
        const match = t.match(item.regex);
        if (match && match[1]) {
            const rawJurisdiction = match[1].trim().replace(/\b(the|current|latest|now|today|is|who)\b/g, '').trim();
            if (rawJurisdiction.length >= 2 && rawJurisdiction.length <= 40) {
                return {
                    role: item.role,
                    jurisdiction: formatName(rawJurisdiction)
                };
            }
        }
    }

    // Dynamic abbreviation & reversed pattern: "<Jurisdiction> CM/PM"
    const abbrMatch = t.match(/\b(?:who is|what is|tell me|who's)?\s*(?:the\s+)?([a-z\s]+?)\s+(cm|pm|chief minister|prime minister|president|governor|mayor)\b/i);
    if (abbrMatch && abbrMatch[1] && abbrMatch[2]) {
        const rawRole = abbrMatch[2].trim().toLowerCase();
        const role = rawRole === 'cm' ? 'Chief Minister' : (rawRole === 'pm' ? 'Prime Minister' : formatName(rawRole));
        const rawPlace = abbrMatch[1].replace(/\b(?:current|the|who is|what is|who's|tell me)\b/gi, '').trim();
        if (rawPlace.length >= 2 && rawPlace.length <= 40) {
            return { role, jurisdiction: formatName(rawPlace) };
        }
    }

    return null;
}

/**
 * Universal entity & fact intent classifier.
 * Categorizes queries to decide whether live web grounding is strictly required
 * or if the query can be resolved via stable knowledge / direct model reasoning.
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

    const lower = query.toLowerCase();

    if (context.explicitWeb || /\b(?:search\s+(?:for|the\s+web\s+for|google\s+for)|find\s+(?:articles|news|web\s+pages)\s+about|look\s+up\s+online|with\s+sources?|source\s+links?)\b/i.test(lower)) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search_or_sources'
        };
    }

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

    const isHistorical = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was\s+the|history\s+of)\b/i.test(lower);
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
        (/\b(?:current|latest|present|today|now)\s+(?:governor|pm|cm|president|chancellor|minister|mayor|ceo|chairman|leader|ruler|head\s+of\s+state)\b/i.test(lower) ||
        /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)?\s*(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|chairman))\b/i.test(lower) ||
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

    if (isStableGeographyOrGeneralFactQuery(query)) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: isHistorical ? entityTarget : null,
            category: 'stable_general_knowledge',
            reason: 'stable_fact_or_geography'
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

/**
 * Determines whether a query is asking for stable general knowledge or geography.
 * @param {string} rawQuery 
 * @returns {boolean}
 */
export function isStableGeographyOrGeneralFactQuery(rawQuery = '') {
    const query = String(rawQuery || '').trim();
    if (!query) return false;
    const lower = query.toLowerCase().replace(/[?!.,;:]+$/g, '').trim();

    const liveSignals = /\b(?:who\s+is\s+(?:the\s+)?(?:current|present|latest)\s+(?:chief\s+minister|prime\s+minister|president|governor|mayor|chancellor|ceo|chairman|leader|head\s+of\s+state)|who\s+is\s+(?:the\s+)?(?:cm|pm)\s+of|weather\s+in|forecast\s+for|temperature\s+in|stock\s+price|price\s+of\s+(?:bitcoin|btc|eth|solana|crypto|gold|silver|crude|shares?)|market\s+cap\s+of|live\s+score|ipl\s+(?:score|schedule|match|table)|breaking\s+news|today'?s\s+news|earthquake\s+today|election\s+results?\s+today|as\s+of\s+today|right\s+now|open\s+now|near\s+me|nearby|near\s+[a-z]+|with\s+sources?|source\s+links?|what'?s\s+new|new\s+(?:update|updates|release|version|announcement|news|development|features?)|directions\s+to|route\s+to|how\s+to\s+(?:reach|get\s+to)|hotels?\s+(?:near|around|in)|restaurants?\s+(?:near|around|in)|ticket\s+price|tickets?\s+for|entry\s+fee|visiting\s+hours|timings?\s+of|places\s+to\s+visit|things\s+to\s+do\s+in|sightseeing\s+in)\b/i;
    if (liveSignals.test(lower)) return false;

    if (/\b(?:what\s+(?:is|was)|which\s+city\s+is|name)\s+(?:the\s+)?capital\s+(?:city\s+)?of\s+[a-z\s.'-]+/i.test(lower) ||
        /\b(?:capital\s+(?:city\s+)?of\s+[a-z\s.'-]+)/i.test(lower) ||
        /\b[a-z\s.'-]+\s+capital\b/i.test(lower)) {
        return true;
    }

    const stableSignals = /\b(?:continent|continents|ocean|oceans|sea|seas|river|rivers|mountain|mountains|plateau|desert|island|islands|valley|gulf|bay|peninsula|equator|latitude|longitude|currency\s+of|official\s+language\s+of|population\s+of|area\s+of|located\s+in|location\s+of|where\s+is\s+.+\s+located|where\s+are\s+.+\s+located|architecture\s+of|geological\s+formation|why\s+was\s+.+\s+(?:constructed|built|created|founded)|who\s+(?:built|constructed|designed|founded|created)\s+|when\s+was\s+.+\s+(?:built|constructed|founded)|history\s+of|origin\s+of|significance\s+of|ancient\s+wonder|world\s+heritage|brihadeeswarar\s+temple|sun\s+temple|taj\s+mahal|eiffel\s+tower|colosseum|pyramids?\s+of\s+giza|angkor\s+wat|machu\s+picchu|stonehenge|parthenon|great\s+wall|statue\s+of\s+liberty|yosemite|grand\s+canyon|niagara\s+falls|mount\s+everest|marianas?\s+trench|louvre|central\s+park|history|ancient|medieval|century|empire|dynasty|civilization|battle\s+of|treaty\s+of|revolution|renaissance|archaeology|historical|cold\s+war|french\s+revolution|world\s+war|bronze\s+age|iron\s+age|mesopotamia|byzantine|ottoman|roman\s+empire|indus\s+valley|new\s+deal|new\s+kingdom|fdr|first\s+president\s+of|former\s+president|physics|chemistry|biology|astronomy|cosmology|quantum|gravity|relativity|thermodynamics|optics|evolution|photosynthesis|mitosis|meiosis|dna|rna|gene|protein|cell|atom|molecule|neutron\s+star|black\s+hole|supernova|galaxy|planet|orbit|solar\s+system|exoplanet|speed\s+of\s+light|periodic\s+table|atomic\s+number|penicillin|who\s+discovered|who\s+invented|calculate|compute|solve|integrate|integral|derivative|differentiate|equation|formula|pythagorean|factorial|matrix|matrices|determinant|eigenvalue|function|class|algorithm|data\s+structure|binary\s+search|sorting|quicksort|new\s+(?:keyword|operator|array|object|instance|class)|javascript|python|typescript|java|c\+\+|rust|golang|definition\s+of|meaning\s+of|what\s+is\s+the\s+definition\s+of|what\s+is\s+the\s+meaning\s+of|define\s+|explain\s+(?:the\s+concept\s+of|what|how|why)|difference\s+between|philosophy|ethics|epistemology|metaphysics|stoicism|utilitarianism|existentialism|economics|macroeconomics|microeconomics|inflation|gdp)\b/i;

    if (stableSignals.test(lower)) return true;

    if (/^(?:where\s+is|where\s+was|where\s+are|what\s+is|what\s+are|what'?s|who\s+was|how\s+does|how\s+do|explain|define|tell\s+me\s+about)\s+[\w\s.'-]{2,80}\??$/i.test(query)) {
        return true;
    }

    return false;
}

/**
 * Classifies entity temporal status from text snippets.
 * @param {string} entityName 
 * @param {string} role 
 * @param {Array<{ title?: string, description?: string, summary?: string, url?: string }>} snippets 
 * @param {number} [calendarYear]
 * @returns {{ status: 'incumbent' | 'former' | 'candidate' | 'unknown', confidence: number, evidenceSnippet: string }}
 */
export function classifyTemporalStatus(entityName, role, snippets = [], calendarYear = new Date().getUTCFullYear()) {
    const name = String(entityName || '').toLowerCase().trim();
    if (!name) return { status: 'unknown', confidence: 0, evidenceSnippet: '' };

    const pool = Array.isArray(snippets) ? snippets : [];
    let incumbentSignals = 0;
    let formerSignals = 0;
    let candidateSignals = 0;
    let bestEvidence = '';

    for (const item of pool) {
        const text = `${item?.title || ''} ${item?.description || ''} ${item?.summary || ''}`.toLowerCase();
        if (!text.includes(name)) continue;

        // Incumbent detection
        if (/\b(incumbent|serving since|assumed office|is the current|took oath|sworn in as)\b/.test(text)) {
            incumbentSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }

        // Former detection
        if (/\b(former|predecessor|served from|stepped down|resigned|was the|until \d{4})\b/.test(text)) {
            formerSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }

        // Candidate / party leader detection
        if (/\b(candidate|contesting|party leader|founded|campaigning|presidential candidate|tvk|announced party|runs for)\b/.test(text)) {
            candidateSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }
    }

    if (incumbentSignals > formerSignals && incumbentSignals > candidateSignals) {
        return { status: 'incumbent', confidence: Math.min(1.0, 0.6 + incumbentSignals * 0.1), evidenceSnippet: bestEvidence };
    }
    if (candidateSignals > incumbentSignals) {
        return { status: 'candidate', confidence: Math.min(1.0, 0.6 + candidateSignals * 0.1), evidenceSnippet: bestEvidence };
    }
    if (formerSignals > incumbentSignals) {
        return { status: 'former', confidence: Math.min(1.0, 0.6 + formerSignals * 0.1), evidenceSnippet: bestEvidence };
    }

    return { status: 'unknown', confidence: 0.3, evidenceSnippet: bestEvidence };
}

/**
 * Validates entity assertions in LLM responses and produces a verified source payload.
 * @param {string} query 
 * @param {string} responseText 
 * @param {Array<any>} liveSources 
 * @param {number} [calendarYear]
 * @returns {{
 *   discrepancyDetected: boolean,
 *   entityTarget: { role: string, jurisdiction: string } | null,
 *   verifiedSourceData: Record<string, any> | null,
 *   correctedText: string | null
 * }}
 */
export function validateEntityResponse(query, responseText, liveSources = [], calendarYear = new Date().getUTCFullYear()) {
    const target = extractEntityTarget(query) || extractEntityTarget(responseText);
    if (!target) {
        return {
            discrepancyDetected: false,
            entityTarget: null,
            verifiedSourceData: null,
            correctedText: null
        };
    }

    const sources = Array.isArray(liveSources) ? liveSources : [];
    const trustedSources = sources.filter(s => isTrustedDomain(extractHostname(s?.url || s?.domain)));
    const activeSources = trustedSources.length > 0 ? trustedSources : sources;

    // Dynamically extract proper noun entities mentioned in response, query, or top source snippets
    const combinedCorpus = `${responseText} ${query} ${activeSources.map(s => `${s.title || ''} ${s.description || ''}`).join(' ')}`;
    const properNounMatches = combinedCorpus.match(/\b[A-Z][a-zA-Z.\s]{2,30}\b/g) || [];
    const candidatePool = Array.from(new Set(properNounMatches.map(n => n.trim()))).filter(n =>
        n.length >= 3 &&
        !['Chief', 'Minister', 'Prime', 'President', 'Governor', 'Mayor', 'Wikipedia', 'Source', 'News', 'Article', 'India', 'Tamil', 'Nadu'].includes(n)
    );

    const mentionedEntities = candidatePool.slice(0, 6);

    const entityStatuses = {};
    for (const ent of mentionedEntities) {
        entityStatuses[ent] = classifyTemporalStatus(ent, target.role, activeSources, calendarYear);
    }

    const verifiedPayload = {
        role: target.role,
        jurisdiction: target.jurisdiction,
        temporalAnchorYear: calendarYear,
        verifiedAt: new Date().toISOString(),
        sources: activeSources.slice(0, 4).map(s => ({
            title: String(s.title || s.source || s.domain || 'Source').trim(),
            url: String(s.url || '').trim(),
            domain: extractHostname(s.url || s.domain)
        })),
        entityBreakdown: entityStatuses
    };

    const textLower = String(responseText || '').toLowerCase();
    const isIncumbentAssertion = new RegExp(`\\bis the (?:current )?${target.role.toLowerCase()}\\b`, 'i').test(textLower);
    return {
        discrepancyDetected: Object.values(entityStatuses).some(s => s.status === 'candidate' && isIncumbentAssertion),
        entityTarget: target,
        verifiedSourceData: verifiedPayload,
        correctedText: null
    };
}

function formatName(str) {
    return String(str || '')
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}

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

/**
 * P1: Computes dense vector grounding score between a user query and retrieved evidence passages.
 * @param {string} query
 * @param {Array<string | { text?: string, summary?: string, description?: string }>} passages
 * @returns {{ score: number, confidence: 'high' | 'moderate' | 'low', topMatchScore: number, avgScore: number, isGrounded: boolean }}
 */
export function computeEvidenceGroundingScore(query = '', passages = []) {
    const q = String(query || '').trim();
    if (!q || !Array.isArray(passages) || !passages.length) {
        return { score: 0, confidence: 'low', topMatchScore: 0, avgScore: 0, isGrounded: false };
    }

    const queryVec = textToEmbeddingVector(q);
    const validTexts = passages
        .map(p => typeof p === 'string' ? p : (p?.text || p?.summary || p?.description || ''))
        .filter(t => t && t.trim().length > 10);

    if (!validTexts.length) {
        return { score: 0, confidence: 'low', topMatchScore: 0, avgScore: 0, isGrounded: false };
    }

    const scores = validTexts.map(text => vectorCosineSimilarity(queryVec, textToEmbeddingVector(text)));
    const topMatchScore = Math.max(...scores);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const combinedScore = Number((topMatchScore * 0.7 + avgScore * 0.3).toFixed(3));

    let confidence = 'low';
    if (combinedScore >= 0.38) confidence = 'high';
    else if (combinedScore >= 0.22) confidence = 'moderate';

    return {
        score: combinedScore,
        confidence,
        topMatchScore: Number(topMatchScore.toFixed(3)),
        avgScore: Number(avgScore.toFixed(3)),
        isGrounded: combinedScore >= 0.22
    };
}

/**
 * P3: Verifies proposition-level attribution across generated response text and evidence passages.
 * @param {string} generatedText
 * @param {Array<string | { text?: string, summary?: string }>} passages
 * @param {number} [threshold=0.18]
 * @returns {{ verified: boolean, attributionRatio: number, supportedPropositions: string[], ungroundedPropositions: string[] }}
 */
export function verifyClaimAttributions(generatedText = '', passages = [], threshold = 0.18) {
    const raw = String(generatedText || '').trim();
    if (!raw) return { verified: true, attributionRatio: 1.0, supportedPropositions: [], ungroundedPropositions: [] };

    const validPassages = (Array.isArray(passages) ? passages : [])
        .map(p => typeof p === 'string' ? p : (p?.text || p?.summary || p?.description || ''))
        .filter(t => t && t.trim().length > 5);

    if (!validPassages.length) {
        return { verified: false, attributionRatio: 0, supportedPropositions: [], ungroundedPropositions: [raw] };
    }

    const passageVectors = validPassages.map(p => textToEmbeddingVector(p));
    const sentences = raw
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 15);

    if (!sentences.length) {
        return { verified: true, attributionRatio: 1.0, supportedPropositions: [], ungroundedPropositions: [] };
    }

    const supportedPropositions = [];
    const ungroundedPropositions = [];

    for (const sent of sentences) {
        const sentVec = textToEmbeddingVector(sent);
        const maxSim = Math.max(...passageVectors.map(pv => vectorCosineSimilarity(sentVec, pv)));
        if (maxSim >= threshold) {
            supportedPropositions.push(sent);
        } else {
            ungroundedPropositions.push(sent);
        }
    }

    const attributionRatio = Number((supportedPropositions.length / sentences.length).toFixed(3));
    return {
        verified: attributionRatio >= 0.70,
        attributionRatio,
        supportedPropositions,
        ungroundedPropositions
    };
}
