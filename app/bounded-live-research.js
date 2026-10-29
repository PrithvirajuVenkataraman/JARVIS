/**
 * Bounded Live-Web Research Pipeline (Perplexity-Style)
 *
 * Strict Application Deadline Contract:
 * - T + 0ms: Start live search mode, dispatch providers in parallel.
 * - T + 0..2500ms: Independent fetch with AbortControllers.
 * - T + 2500ms: Search cutoff. Abort pending search requests. Normalize sources, assign IDs [1]..[N].
 * - T + 2500..2800ms: Render Sources UI immediately. Start LLM streaming synthesis with verified grounding.
 * - T + 8500ms: Trigger forced fallback preparation.
 * - T + 9000ms: HARD APPLICATION DEADLINE. Abort stream. Render verified snippet answer. Lock turn state.
 */

import { normalizeUserQuery, hasSearchableContent } from './query-normalizer.js?v=2.0.5';
import { BM25Index, computeBM25Scores, tokenizeText } from './bm25.js?v=2.0.5';
import { textToEmbeddingVector, vectorCosineSimilarity } from './frontend-routing.js?v=2.0.5';

export {
    normalizeUserQuery,
    hasSearchableContent,
    BM25Index,
    computeBM25Scores,
    tokenizeText,
    textToEmbeddingVector,
    vectorCosineSimilarity
};

export const LIVE_RESEARCH_BUDGETS = Object.freeze({
    HARD_DEADLINE_MS: 9000,
    SEARCH_CUTOFF_MS: 5000,
    SEARCH_TIMEOUT_MS: 4500,
    FALLBACK_WARNING_MS: 8500,
    MIN_SOURCES_FOR_EARLY_SYNTHESIS: 2
});

export const RESEARCH_STATES = Object.freeze({
    REQUESTED: 'REQUESTED',
    SEARCHING: 'SEARCHING',
    SEARCH_DEADLINE: 'SEARCH_DEADLINE',
    SOURCE_VALIDATION: 'SOURCE_VALIDATION',
    SOURCE_GROUNDED_SYNTHESIS: 'SOURCE_GROUNDED_SYNTHESIS',
    NO_SOURCES: 'NO_SOURCES',
    COMPLETE: 'COMPLETE',
    ABORTED: 'ABORTED'
});

export const PROVENANCE_MODES = Object.freeze({
    WEB_GROUNDED: 'web_grounded',
    NO_SOURCES: 'no_sources',
    SYNTHESIS_FALLBACK: 'synthesis_fallback',
    ABORTED: 'aborted'
});

export const RESEARCH_DOMAINS = Object.freeze([
    {
        key: 'leadership',
        text: 'political governance leadership public office administration election tenure ministry portfolios appointments biography career cabinet minister prime minister chief minister president governor executive mayor official cm pm who is who was who are',
        generate: (topic) => [
            `What are the major policies and recent announcements associated with ${topic}`,
            `What is the political background and administrative tenure of ${topic}`,
            `What are the key initiatives and public updates regarding ${topic}`
        ]
    },
    {
        key: 'policy_rules',
        text: 'statutory regulations compliance requirements guidelines administrative policies official mandate restrictions standards legal guidelines visa baggage allowance luggage work authorization rules audit suspension perm green card h-1b immigration',
        generate: (topic) => [
            `What are the specific requirements and compliance guidelines for ${topic}`,
            `What is the official implementation timeline and effective date for ${topic}`,
            `What exemptions or special allowances apply under ${topic}`
        ]
    },
    {
        key: 'technical_release',
        text: 'software development library runtime language framework release notes version changelog breaking changes api migration performance benchmarks deprecations python rust go javascript typescript',
        generate: (topic) => [
            `What are the major new features and breaking changes in ${topic}`,
            `What is the migration path and compatibility requirements for ${topic}`,
            `What performance improvements or benchmarks are reported for ${topic}`
        ]
    },
    {
        key: 'sports',
        text: 'athletics competition match tournament championship league points table game score fixtures standings trophy medal winner team roster player performance statistics ipl fifa olympics',
        generate: (topic) => [
            `What is the upcoming schedule and next fixture for ${topic}`,
            `What are the key statistics and recent performance records for ${topic}`,
            `How does this result impact the standings and tournament qualification for ${topic}`
        ]
    },
    {
        key: 'finance',
        text: 'financial markets equities stock valuation earnings report quarterly revenue profits fiscal guidance analyst ratings economic indicators price forecast nasdaq dow sensex nifty crypto',
        generate: (topic) => [
            `What are the primary market drivers and recent financial results for ${topic}`,
            `What do analyst ratings and price targets forecast for ${topic}`,
            `How do macroeconomic trends affect the current performance of ${topic}`
        ]
    },
    {
        key: 'travel_geography',
        text: 'geography tourism sightseeing travel destinations cities attractions historical monuments heritage culture climate weather guidance places visit visiting visitor travel vacation trip explore flight itinerary',
        generate: (topic) => [
            `What are the top attractions and key highlights in ${topic}`,
            `What is the best time to visit and travel guidance for ${topic}`,
            `What is the cultural and historical significance of ${topic}`
        ]
    },
    {
        key: 'event_mission',
        text: 'aerospace exploration space mission launch schedule countdown flight test milestone expedition summit conference deployment artemis nasa isro spacex',
        generate: (topic) => [
            `What is the timeline and upcoming milestones for ${topic}`,
            `What are the primary objectives and mission parameters for ${topic}`,
            `What technical challenges or next steps have been identified for ${topic}`
        ]
    },
    {
        key: 'concept_mechanism',
        text: 'scientific mechanism working theory conceptual principles advantages disadvantages trade-offs alternatives fundamental explanation how it works biological medical physics',
        generate: (topic) => [
            `How does ${topic} work in practice and real-world applications`,
            `What are the key advantages and potential drawbacks of ${topic}`,
            `What are common alternatives or comparable approaches to ${topic}`
        ]
    }
]);

export const COMPILED_DOMAINS = Object.freeze(RESEARCH_DOMAINS.map((domain, index) => ({
    ...domain,
    index,
    vector: textToEmbeddingVector(domain.text, 512)
})));

export const DOMAIN_BM25_INDEX = new BM25Index({ k1: 1.2, b: 0.75 });
COMPILED_DOMAINS.forEach((domain) => {
    DOMAIN_BM25_INDEX.addDocument(domain.index, domain.text, domain);
});

export function classifyQueryDomainSemantic(query) {
    const raw = String(query || '').trim();
    if (!raw) return null;
    const qVec = textToEmbeddingVector(raw, 512);

    const bm25Results = DOMAIN_BM25_INDEX.search(raw, { minScore: 0.05, topK: 3 });
    const bm25Scores = new Map();
    let maxBm25 = 1;
    for (const r of bm25Results) {
        maxBm25 = Math.max(maxBm25, r.score);
        bm25Scores.set(r.doc.id, r.score);
    }

    let bestDomain = null;
    let bestScore = -1;

    for (const domain of COMPILED_DOMAINS) {
        const cosSim = vectorCosineSimilarity(qVec, domain.vector);
        const normBm25 = (bm25Scores.get(domain.index) || 0) / maxBm25;
        const hybridScore = 0.5 * cosSim + 0.5 * normBm25;
        if (hybridScore > bestScore) {
            bestScore = hybridScore;
            bestDomain = domain;
        }
    }

    if (bestDomain && bestScore >= 0.15) {
        return bestDomain;
    }
    return null;
}

const FRESHNESS_PROTOTYPE_TEXT = 'today tonight yesterday breaking latest current updates recent newest breaking news hours ago days ago past 24 hours past week this month';
const FRESHNESS_PROTOTYPE_VECTOR = textToEmbeddingVector(FRESHNESS_PROTOTYPE_TEXT, 512);

export function isFreshnessQuerySemantic(query = '') {
    const raw = String(query || '').trim();
    if (!raw) return false;
    const qVec = textToEmbeddingVector(raw, 512);
    const cosSim = vectorCosineSimilarity(qVec, FRESHNESS_PROTOTYPE_VECTOR);
    const tokens = tokenizeText(raw);
    const freshnessTokens = new Set(['today', 'tonight', 'yesterday', 'latest', 'current', 'recent', 'recently', 'breaking', 'newest', 'news', 'update', 'updates']);
    const hasFreshnessToken = tokens.some(t => freshnessTokens.has(t));
    return cosSim >= 0.25 || hasFreshnessToken;
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return 'web';
    }
}

export function cleanTextSnippet(text) {
    return String(text || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

export function distillSearchQuery(rawQuery) {
    if (!rawQuery) return '';
    let text = String(rawQuery).trim();
    // Strip persona and roleplay preambles (e.g. "Act as a deep-synthesis reasoning engine...: [question]")
    text = text.replace(/^(?:(?:act\s+as|you\s+are)\s+(?:a|an)\s+[^.:\n]+[.:\n]\s*)*(?:answer\s+the\s+(?:following\s+)?(?:query|question|input)(?:\s+by\s+[^:\n]+)?[:\-]\s*)/i, '');
    text = text.replace(/^(?:(?:act\s+as|you\s+are)\s+(?:a|an)\s+[^.:\n]+[.:\n]\s*)/i, '');

    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const contentLines = [];
        for (const line of lines) {
            if (/^(?:please\s+provide|please\s+include|please\s+format|format\s+as|output\s+as|structure\s+as|requirements?:|instructions?:|columns?:|notes?:|\d+[\.)]\s+|-|\*)/i.test(line)) {
                break;
            }
            contentLines.push(line);
        }
        if (contentLines.length > 0) text = contentLines.join(' ');
        else text = lines[0];
    }
    text = text
        .replace(/\b(?:please\s+)?(?:provide|include|format|output|render|display)\s+(?:a|an|the)?\s+(?:markdown\s+)?(?:table|comparison\s+table|bulleted\s+list|summary|checklist|columns|code\s+block).*$/gi, '')
        .replace(/\b(?:make\s+sure\s+to|be\s+sure\s+to|don't\s+forget\s+to|do\s+not\s+include|ensure\s+that)\b.*$/gi, '')
        .replace(/\b(?:in\s+\d+\s+words|concise\s+summary|step\s+by\s+step|briefly|in\s+detail)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.trim() || rawQuery;
}

const SOURCE_MONTH_NAMES_MAP = Object.freeze({
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
});

const KNOWN_TODAY_BRANDS = /\b(?:usa\s+today|india\s+today|medical\s+news\s+today|psychology\s+today|today's\s+parent|today\s+show|today\.com|the\s+today\s+show|today\s+fm)\b/gi;
const CASUAL_TODAY_PHRASES = /\b(?:in\s+today's\s+(?:world|society|market|digital\s+age|economy)|available\s+today|join\s+today|call\s+(?:us\s+)?today|apply\s+today|start\s+today|order\s+today|buy\s+today|sign\s+up\s+today|shop\s+today|visit\s+today|book\s+today)\b/gi;

export function parseSourceDate(item, now = Date.now()) {
    if (!item || typeof item !== 'object') return null;
    const directDate = item.date || item.publishedAt || item.pubDate || item.timestamp;
    if (directDate) {
        if (typeof directDate === 'number' && Number.isFinite(directDate) && directDate > 0) return directDate;
        if (typeof directDate === 'string') {
            const trimmed = directDate.trim();
            if (/^\d{10,13}$/.test(trimmed)) {
                const num = parseInt(trimmed, 10);
                return num < 10000000000 ? num * 1000 : num;
            }
            const parsed = Date.parse(trimmed);
            if (!Number.isNaN(parsed) && parsed > 0) return parsed;
        }
    }
    const url = String(item.url || '');
    if (url) {
        const urlDateMatch = url.match(/(?:^|\/)((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:\/|$|\?|\.)/);
        if (urlDateMatch) {
            const parsed = Date.UTC(parseInt(urlDateMatch[1], 10), parseInt(urlDateMatch[2], 10) - 1, parseInt(urlDateMatch[3], 10));
            if (!Number.isNaN(parsed)) return parsed;
        }
    }
    const rawText = `${item.title || ''} ${item.description || ''} ${item.snippet || ''}`.trim();
    if (!rawText) {
        if (url) {
            const urlYearMatch = url.match(/(?:^|\/)((?:19|20)\d\d)(?:\/|$|\?|\.)/);
            if (urlYearMatch) {
                const parsed = Date.parse(`${urlYearMatch[1]}-01-01`);
                if (!Number.isNaN(parsed)) return parsed;
            }
        }
        return null;
    }

    const currentYear = new Date(now).getUTCFullYear();
    const currentMonth = new Date(now).getUTCMonth();

    // 1. Explicit Calendar Dates FIRST (American Month DD YYYY, UK DD Month YYYY, ISO, Numeric)
    // American Format: Month DD, YYYY or Month DD (e.g. "October 11, 2026", "Oct 11 2026", "Oct 11")
    let m = rawText.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const mo = SOURCE_MONTH_NAMES_MAP[m[1].toLowerCase().replace('.', '')];
        const day = parseInt(m[2], 10);
        let yr = m[3] ? parseInt(m[3], 10) : currentYear;
        if (!m[3] && mo > currentMonth) yr = currentYear - 1;
        if (mo != null && day >= 1 && day <= 31) return Date.UTC(yr, mo, day);
    }

    // UK / International Format: DD Month YYYY or DD Month (e.g. "11 October 2026", "11th Oct 2026", "11 Oct")
    m = rawText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const day = parseInt(m[1], 10);
        const mo = SOURCE_MONTH_NAMES_MAP[m[2].toLowerCase().replace('.', '')];
        let yr = m[3] ? parseInt(m[3], 10) : currentYear;
        if (!m[3] && mo > currentMonth) yr = currentYear - 1;
        if (mo != null && day >= 1 && day <= 31) return Date.UTC(yr, mo, day);
    }

    // ISO Format: YYYY-MM-DD or YYYY/MM/DD
    m = rawText.match(/\b((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])\b/);
    if (m) {
        return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    // Numeric US & UK Formats: MM/DD/YYYY or DD/MM/YYYY
    m = rawText.match(/\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d\d)\b/);
    if (m) {
        const n1 = parseInt(m[1], 10);
        const n2 = parseInt(m[2], 10);
        const yr = parseInt(m[3], 10);
        const domainStr = String(item.domain || item.url || '').toLowerCase();
        const isUkOrIntl = /\.(?:uk|au|nz|za|ie|in)\b/i.test(domainStr);
        if (n1 > 12 && n2 <= 12) {
            // Unambiguous UK: DD/MM/YYYY
            return Date.UTC(yr, n2 - 1, n1);
        } else if (n2 > 12 && n1 <= 12) {
            // Unambiguous US: MM/DD/YYYY
            return Date.UTC(yr, n1 - 1, n2);
        } else if (n1 <= 12 && n2 <= 31) {
            if (isUkOrIntl) {
                return Date.UTC(yr, n2 - 1, n1);
            }
            return Date.UTC(yr, n1 - 1, n2);
        }
    }

    // 2. Relative timestamps (Search snippets: "2 hours ago", "yesterday", "3 days ago")
    // Sanitize known publisher brand names and casual marketing phrases containing "today"
    const sanitizedText = rawText
        .replace(KNOWN_TODAY_BRANDS, ' ')
        .replace(CASUAL_TODAY_PHRASES, ' ');

    m = sanitizedText.match(/\b(\d+)\s*(?:seconds?|secs?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 1000;
    m = sanitizedText.match(/\b(\d+)\s*(?:minutes?|mins?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 60 * 1000;
    m = sanitizedText.match(/\b(\d+)\s*(?:hours?|hrs?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 3600 * 1000;
    m = sanitizedText.match(/\b(\d+)\s*days?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 24 * 3600 * 1000;
    m = sanitizedText.match(/\b(\d+)\s*weeks?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 7 * 24 * 3600 * 1000;
    m = sanitizedText.match(/\b(\d+)\s*months?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 30 * 24 * 3600 * 1000;

    // Publication-prefixed or explicit marker relative dates
    const snippetText = String(item.snippet || item.description || '').replace(KNOWN_TODAY_BRANDS, ' ').replace(CASUAL_TODAY_PHRASES, ' ').trim();
    if (/(?:^|[|•·—–\-\n])\s*(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(sanitizedText) ||
        /(?:^|[|•·—–\-\n])\s*(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(snippetText) ||
        /\b(?:published|updated|posted|date:?|released)\s+(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(sanitizedText) ||
        /\btoday\s*[-—–:•·|]/i.test(sanitizedText)) {
        return now;
    }
    if (/\b(?:yesterday|yesterday's)\b/i.test(sanitizedText)) {
        return now - 24 * 3600 * 1000;
    }

    // 3. Fallback to URL year if present
    if (url) {
        const urlYearMatch = url.match(/(?:^|\/)((?:19|20)\d\d)(?:\/|$|\?|\.)/);
        if (urlYearMatch) {
            const parsed = Date.parse(`${urlYearMatch[1]}-01-01`);
            if (!Number.isNaN(parsed)) return parsed;
        }
    }

    return null;
}

export function formatSourceDate(parsedMs, now = Date.now()) {
    if (!parsedMs || Number.isNaN(parsedMs)) return '';
    const diffMs = now - parsedMs;
    const diffHours = Math.round(diffMs / 3600000);
    if (diffHours >= 0 && diffHours < 1) return 'Just now';
    if (diffHours >= 1 && diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays <= 6) return `${diffDays} days ago`;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(parsedMs));
}

/**
 * Scores candidate research sources using hybrid lexical BM25 and dense semantic cosine similarity.
 */
export function scoreSourcesBM25AndSemantic(candidates = [], query = '') {
    if (!Array.isArray(candidates) || candidates.length === 0 || !query) return candidates;

    // 1. Build in-memory BM25 index over candidate sources
    const bm25Index = new BM25Index({ k1: 1.2, b: 0.75 });
    candidates.forEach((c, idx) => {
        const text = `${c.title || ''} ${c.snippet || ''} ${c.domain || ''}`.trim();
        bm25Index.addDocument(idx, text, c);
    });

    const rawBm25Scores = bm25Index.scoreAll(query);
    let maxBm25 = 1;
    for (const s of rawBm25Scores) {
        if (s > maxBm25) maxBm25 = s;
    }

    // 2. Dense vector embedding for query
    const queryVector = textToEmbeddingVector(query, 512);

    // 3. Compute hybrid score for each candidate
    for (let i = 0; i < candidates.length; i++) {
        const c = candidates[i];
        const docText = `${c.title || ''} ${c.snippet || ''} ${c.domain || ''}`.trim();
        const docVector = textToEmbeddingVector(docText, 512);
        const cosSim = vectorCosineSimilarity(queryVector, docVector);
        const normBm25 = (rawBm25Scores[i] || 0) / maxBm25;
        const isAuth = isAuthoritativeResearchSource(c, query);

        // Hybrid formula: lexical BM25 (40%) + dense semantic cosine (40%) + authoritative bonus (15%) + trusted bonus (5%)
        const hybridRelevance = (0.40 * normBm25) +
                                (0.40 * Math.max(0, cosSim)) +
                                (isAuth ? 0.15 : 0) +
                                (c.trusted ? 0.05 : 0);

        c.bm25Score = Number((rawBm25Scores[i] || 0).toFixed(4));
        c.semanticSim = Number(cosSim.toFixed(4));
        c.hybridScore = Number(hybridRelevance.toFixed(4));
    }

    return candidates;
}

/**
 * Normalizes, deduplicates, ranks, and assigns stable numeric IDs (1..N) to sources.
 */
export function normalizeResearchSources(results = [], query = '', limit = 8) {
    if (!Array.isArray(results)) return [];
    const seenUrls = new Set();
    const isFreshnessQuery = isFreshnessQuerySemantic(query);
    const candidates = [];

    for (const r of results) {
        if (!r) continue;
        const rawUrl = String(r.url || '').trim();
        if (!rawUrl || !rawUrl.startsWith('http')) continue;
        const cleanUrl = rawUrl.split('#')[0].replace(/\/+$/, '');
        const key = cleanUrl.toLowerCase();
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);

        const domain = (r.domain || getDomainFromUrl(cleanUrl)).toLowerCase();
        const title = cleanTextSnippet(r.title || domain || 'Web Result');
        
        // Pick the most substantive body content available:
        // Prioritize full article text / deep extracts over brief or echoed headlines
        const fullArticle = cleanTextSnippet(r.fullArticleText || r.extract || '');
        const rawSnippet = cleanTextSnippet(r.snippet || r.description || '');
        let snippet = rawSnippet;
        if (fullArticle && (rawSnippet === title || rawSnippet.length < 60 || fullArticle.length > rawSnippet.length)) {
            snippet = fullArticle;
        } else if (!snippet || snippet === title) {
            snippet = fullArticle || rawSnippet || '';
        }

        const parsedDateMs = parseSourceDate({ ...r, title, snippet, url: cleanUrl });
        const dateStr = r.date || (parsedDateMs ? formatSourceDate(parsedDateMs) : '');

        candidates.push({
            title,
            snippet,
            fullArticleText: fullArticle || snippet,
            extract: fullArticle || snippet,
            url: cleanUrl,
            domain,
            favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
            sourceLabel: r.sourceLabel || r.source || domain,
            date: dateStr,
            parsedDateMs,
            trusted: Boolean(r.trusted),
            accessible: r.accessible !== false,
            sourceType: r.sourceType,
            qualitySignals: r.qualitySignals,
            _initialIndex: candidates.length
        });
    }

    scoreSourcesBM25AndSemantic(candidates, query);

    if (isFreshnessQuery || candidates.some(c => c.parsedDateMs)) {
        const now = Date.now();
        const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;
        candidates.sort((a, b) => {
            const timeA = a.parsedDateMs || 0;
            const timeB = b.parsedDateMs || 0;
            if (timeA && timeB) {
                if (timeB !== timeA) return timeB - timeA;
                return ((b.hybridScore || 0) - (a.hybridScore || 0)) || (a._initialIndex - b._initialIndex);
            }
            if (timeA && !timeB) {
                const isRecentA = (now - timeA) < NINETY_DAYS_MS;
                return isRecentA ? -1 : 1;
            }
            if (!timeA && timeB) {
                const isRecentB = (now - timeB) < NINETY_DAYS_MS;
                return isRecentB ? 1 : -1;
            }
            return ((b.hybridScore || 0) - (a.hybridScore || 0)) || (a._initialIndex - b._initialIndex);
        });
    } else {
        candidates.sort((a, b) => {
            const authA = isAuthoritativeResearchSource(a, query) ? 1 : 0;
            const authB = isAuthoritativeResearchSource(b, query) ? 1 : 0;
            if (authA !== authB) return authB - authA;
            return a._initialIndex - b._initialIndex;
        });
    }

    const selected = candidates.slice(0, limit);
    return selected.map((item, idx) => ({
        ...item,
        id: idx + 1
    }));
}

/**
 * Builds the source grounding block for the LLM prompt.
 */
export function formatSourcesForPrompt(sources = []) {
    if (!Array.isArray(sources) || !sources.length) return '';
    return sources.map(s => {
        const substantive = String(s.fullArticleText || s.extract || s.snippet || s.description || s.text || '').trim();
        const excerpt = (substantive && substantive !== s.title) ? substantive : (s.snippet || 'No excerpt available.');
        const publisherStr = s.publisher || s.source ? ` (${s.publisher || s.source})` : '';
        const accessibilityNote = s.accessible === false ? ' [Note: Web page was inaccessible; excerpt from index metadata]' : '';
        return `[${s.id}] Title: ${s.title}${publisherStr}${accessibilityNote}\nDomain: ${s.domain}\nURL: ${s.url}\nExcerpt: ${excerpt}${s.date ? `\nDate: ${s.date}` : ''}`;
    }).join('\n\n');
}


export function isAuthoritativeResearchSource(source, query = '') {
    if (!source) return false;
    const domain = String(source.domain || '').toLowerCase();
    const url = String(source.url || '').toLowerCase();

    // News aggregators and syndicated feeds are not authoritative primary documentation
    if (source.sourceType === 'trusted_news' ||
        domain.startsWith('news.') ||
        /(?:news\.google\.com|yahoo\.com|msn\.com|feedproxy|rss)/i.test(domain)) {
        return false;
    }
    if (source.sourceType === 'official_source') return true;

    // Structural documentation & developer host indicators
    const isDocSubdomain = /^(?:docs?|developer|developers?|api|dev|reference|spec|standards|manual|guide|help)\./i.test(domain);
    if (isDocSubdomain) return true;

    // Structural technical URL paths
    if (/(?:\/)(?:docs?|documentation|changelog|whatsnew|release[-_]?notes?|api|reference|specs?)(?:[\/?#]|$)/i.test(url)) {
        return true;
    }

    // Entity-domain matching for technical documentation
    if (query) {
        const queryTokens = tokenizeText(query, { minTokenLength: 3 });
        const domainBase = domain.replace(/^www\./, '').split('.')[0];
        if (queryTokens.includes(domainBase) && /(?:\.(?:org|dev|io|net|com))$/i.test(domain)) {
            return true;
        }
    }

    return false;
}

export function evaluateSourceQualityForEarlySynthesis(sources = [], query = '') {
    if (!Array.isArray(sources) || sources.length === 0) return false;
    const domain = classifyQueryDomainSemantic(query);
    const isTechDoc = domain?.key === 'technical_release';
    if (isTechDoc) {
        // Technical & software release queries require at least 1 authoritative source or strong relevance consensus (>= 3 sources)
        const hasAuthoritative = sources.some(s => isAuthoritativeResearchSource(s, query));
        if (hasAuthoritative) return true;
        const queryTokens = tokenizeText(query, { minTokenLength: 3 });
        const stopTerms = new Set(['what', 'when', 'where', 'which', 'who', 'how', 'why', 'does', 'will', 'with', 'from', 'than', 'about', 'the', 'and', 'for', 'changed', 'latest', 'release', 'version', 'previous', 'stable']);
        const discriminativeTokens = queryTokens.filter(t => !stopTerms.has(t));
        const matchedSources = sources.filter(s => {
            const text = `${s.title || ''} ${s.snippet || ''}`.toLowerCase();
            return discriminativeTokens.some(t => text.includes(t));
        });
        return matchedSources.length >= 3;
    }
    // General queries require at least 2 sources with descriptive content
    return sources.length >= 2 && sources.some(s => (s.snippet || s.description || s.fullArticleText || '').length >= 20);
}

/**
 * Synthesizes a structured bounded fallback answer strictly from verified source snippets.
 * Produces clean natural-language prose without raw bullets, technical headings, or timing disclaimers.
 * Never stitches disjointed headline titles into a fake answer.
 */
export function generateSnippetFallback(query, sources = []) {
    const cleanQ = normalizeUserQuery(distillSearchQuery(query));
    if (!sources || !sources.length) {
        if (!hasSearchableContent(cleanQ)) {
            return 'Please provide a search topic or question so I can retrieve verified live web sources.';
        }
        return `I searched for current information on "${cleanQ}", but the live web search did not return verified records. Please try rephrasing your search query.`;
    }

    const isTechDoc = /\b(?:release|version|changelog|docs?|documentation|api|whatsnew|what\s+changed\s+in)\b/i.test(cleanQ);
    const authSources = sources.filter(s => isAuthoritativeResearchSource(s, cleanQ));
    const effectiveSources = (isTechDoc && authSources.length) ? authSources : sources;

    // Check if any source provides substantive body text distinct from its title
    const hasAnySubstantiveBody = sources.some(s => {
        const body = cleanTextSnippet(s.fullArticleText || s.extract || s.snippet || s.description || '');
        const title = cleanTextSnippet(s.title || '');
        return body && body.toLowerCase() !== title.toLowerCase() && body.replace(/[^a-zA-Z0-9]/g, '').length >= 5;
    });

    if (!hasAnySubstantiveBody) {
        return `Verified live sources were retrieved regarding "${cleanQ}", but the available records contain only headline references without sufficient substantive detail to construct a verified answer. Please review the verified source references in the carousel above.`;
    }

    const facts = [];
    const seenSentences = new Set();
    const dynamicPublishers = extractDynamicPublisherBlocklist(sources);

    for (const s of effectiveSources.slice(0, 6)) {
        const textParts = [];
        const substantiveBody = cleanTextSnippet(s.fullArticleText || s.extract || s.snippet || s.description || '');
        const sTitle = cleanTextSnippet(s.title || '');
        const hasBody = substantiveBody && substantiveBody.toLowerCase() !== sTitle.toLowerCase() && substantiveBody.replace(/[^a-zA-Z0-9]/g, '').length >= 5;

        // Substantive body only — NEVER push source titles into answer text
        if (hasBody) {
            textParts.push(substantiveBody);
        }
        if (!textParts.length) continue;

        const fullText = textParts.join('. ');
        const rawSentences = fullText.split(/(?<=[.!?])\s+/);
        for (let sentence of rawSentences) {
            if (/\b(?:404|500|502|503|telegram\s+channel|photo:\s*shutterstock|first published|published:\s*\w+\s+\d+|subscribe|newsletter|sign up for)\b/i.test(sentence)) continue;
            sentence = cleanTextSnippet(sentence)
                .replace(/^[-*•\s\d.)\][]+/, '')
                .replace(/^[^\s:]{2,20}:\s*/, '')
                .replace(/^\p{L}{3,9}\s+\d{1,2},?\s+\d{4}\s*[—–-]\s*/u, '')
                .replace(/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*[—–-]\s*/, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (sentence.length < 5 || sentence.length > 400) continue;
            if (/\b(?:404|500|502|503)\b/.test(sentence)) continue;
            if (sentence.replace(/[^a-zA-Z0-9]/g, '').length < 3) continue;

            // Reject fragments under 2 words or standalone publisher/domain tokens
            const sentenceWords = sentence.split(/\s+/).filter(Boolean);
            if (sentenceWords.length < 2) continue;
            if (sentenceWords.length <= 2 && /\.[a-z]{2,6}\.?$/i.test(sentence.replace(/\.$/, ''))) continue;

            // Strip trailing publisher / brand / domain suffix from the end of a sentence
            sentence = sentence
                .replace(/\s+[-—–|·:]\s+[A-Za-z0-9\s.]{2,40}\.?$/, '')
                .replace(/\s+[a-z0-9_-]+\.[a-z]{2,6}\.?$/i, '')
                .trim();

            // Reject interrogative questions, rhetorical questions, or clickbait teasers
            if (/[?]/.test(sentence) || /^(?:who|what|where|when|why|how|can|could|did|do|does|will|would|is|are|was|were)\b/i.test(sentence)) continue;

            // Reject sentence echoing the user query without adding substantive facts
            const normQ = cleanQ.toLowerCase().replace(/[^a-z0-9]/g, '');
            const normalizedSentence = sentence.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normQ && (normalizedSentence === normQ || normQ.includes(normalizedSentence) || (normalizedSentence.length > 20 && normQ.length > 20 && normalizedSentence.includes(normQ)))) continue;

            const stopWords = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'can', 'could', 'should', 'would', 'may', 'might', 'must', 'will', 'shall', 'that', 'this', 'these', 'those', 'it', 'its', 'only', 'some', 'any', 'who', 'what', 'where', 'when', 'why', 'how', 'they', 'them', 'their', 'we', 'you', 'he', 'she', 'without', 'about']);
            const sentenceContentWords = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w));
            const queryContentWords = new Set(cleanQ.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w)));
            if (sentenceContentWords.length > 0 && sentenceContentWords.length <= 8) {
                const newWords = sentenceContentWords.filter(w => !queryContentWords.has(w));
                if (newWords.length === 0) continue;
            }

            // Reject standalone publisher names or domain labels
            if (dynamicPublishers.has(normalizedSentence) || dynamicPublishers.has(sentence.toLowerCase().trim())) continue;
            if (sources.some(s => {
                const domainBase = String(s.domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
                const publisher = String(s.publisher || s.source || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                return (domainBase && normalizedSentence === domainBase) ||
                       (publisher && normalizedSentence === publisher);
            })) continue;

            // Reject clickbait / call-to-action
            if (/\b(?:read more|click here|find out here|learn more|see more|discover more|explore more|subscribe|newsletter|sign up|full article|details inside|watch video|image credit|photo:|telegram channel|follow us)\b/i.test(sentence)) continue;

            // Reject any sentence that matches or closely resembles a source title
            if (sources.some(s => {
                const normTitle = cleanTextSnippet(s.title || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                return normTitle && (normalizedSentence === normTitle || normalizedSentence.includes(normTitle));
            })) continue;

            if (seenSentences.has(normalizedSentence)) continue;
            seenSentences.add(normalizedSentence);
            facts.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
            if (facts.length >= 6) break;
        }
        if (facts.length >= 6) break;
    }

    // Disjointed headline defense: At least one fact must be substantive body prose distinct from all source titles.
    const hasAnyDistinctBodyFact = facts.some(f => {
        const cleanF = f.replace(/\.$/, '').toLowerCase().trim();
        return !sources.some(s => cleanF === cleanTextSnippet(s.title || '').toLowerCase().trim());
    });

    if (!facts.length || !hasAnyDistinctBodyFact) {
        return `Verified live sources were gathered regarding "${cleanQ}", but they did not contain sufficient substantive detail to construct an answer. Please review the verified source references in the carousel above.`;
    }

    // Subject relevance validation for technical documentation queries:
    // If the query asks about a specific technology release (e.g. Python), ensure gathered facts mention it.
    const subjectMatch = cleanQ.match(/(?:(?:latest|current|newest|recent|stable)\s+(?:release|version|update|build)\s+of|changes?\s+in\s+(?:the\s+)?(?:latest\s+)?(?:release|version)\s+of)\s+([a-z0-9_.-]+)/i);
    const subject = subjectMatch ? subjectMatch[1].toLowerCase() : null;
    if (isTechDoc && subject && !facts.some(f => f.toLowerCase().includes(subject))) {
        return `Verified live web sources were retrieved regarding "${cleanQ}", but real-time AI synthesis could not be completed. Please review the verified source references in the carousel above.`;
    }

    // Requirement 5: Never concatenate disjointed headline snippets into a fake answer paragraph.
    const hasSubstantiveProse = facts.some(f => f.length >= 45 && !f.toLowerCase().includes(' - '));
    const isPureNewsFeed = sources.length > 0 && sources.every(s => s.sourceType === 'trusted_news' || s.domain === 'news.google.com' || s.qualitySignals?.includes('google_news_rss'));
    if (isPureNewsFeed && !hasSubstantiveProse) {
        return `Verified live news sources were retrieved regarding "${cleanQ}", but real-time AI synthesis could not be completed. Please explore the verified articles directly in the source carousel above.`;
    }

    return facts.slice(0, 4).join(' ');
}

export function isRawToolCallJson(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    const clean = trimmed
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();

    if (/^<tool_call>[\s\S]*<\/tool_call>$/i.test(clean)) return true;
    if (/^<function=[^>]+>[\s\S]*<\/function>$/i.test(clean)) return true;

    if (clean.startsWith('{') && clean.endsWith('}')) {
        try {
            const parsed = JSON.parse(clean);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                if (typeof parsed.tool === 'string' && (parsed.arguments || parsed.args || parsed.input || parsed.query)) {
                    return true;
                }
                if (typeof parsed.tool_name === 'string' || typeof parsed.function === 'string') {
                    return true;
                }
                if (typeof parsed.name === 'string' && (parsed.arguments || parsed.parameters)) {
                    return true;
                }
                if (Array.isArray(parsed.tool_calls) || Array.isArray(parsed.tools)) {
                    return true;
                }
            }
        } catch (_) {
            if (/^\{\s*"(?:tool|function|tool_name|name)"\s*:\s*"[^"]+"/i.test(clean)) {
                return true;
            }
        }
    }
    if (/^\{\s*"(?:tool|tool_name|function)"\s*:\s*"[^"]+"/i.test(clean)) {
        return true;
    }
    return false;
}

/**
 * Evaluates whether a live search synthesis response is complete, substantive, and verified.
 * Rejects teaser fragments, query echoes, and limitation disclaimers.
 */
export function isSubstantiveLiveAnswer(content, provenance = PROVENANCE_MODES.WEB_GROUNDED) {
    if (provenance !== PROVENANCE_MODES.WEB_GROUNDED) return false;
    if (!content || typeof content !== 'string') return false;
    const trimmed = content.trim();
    if (trimmed.length < 40) return false;
    if (trimmed.endsWith('?')) return false;
    if (isRawToolCallJson(trimmed)) return false;
    const lower = trimmed.toLowerCase();
    if (lower.includes('did not contain sufficient substantive detail')) return false;
    if (lower.includes('contain only headline references')) return false;
    if (lower.includes('could not be completed')) return false;
    if (lower.includes('did not return verified records')) return false;
    if (lower.includes('no verified live web records were returned')) return false;
    return true;
}

/**
 * Dynamically extracts publisher names, domain labels, and title brand tags from candidate sources.
 * Replaces static hardcoded publisher lists with zero-hardcoding metadata extraction.
 */
export function extractDynamicPublisherBlocklist(sources = []) {
    const publisherBlocklist = new Set();
    const addClean = (str) => {
        if (!str || typeof str !== 'string') return;
        const s = str.toLowerCase().trim();
        if (s.length >= 3) {
            publisherBlocklist.add(s);
            const alphanumericOnly = s.replace(/[^a-z0-9]/g, '');
            if (alphanumericOnly.length >= 3) publisherBlocklist.add(alphanumericOnly);
        }
    };

    for (const s of sources) {
        if (!s) continue;
        if (s.domain) {
            const dom = s.domain.toLowerCase().replace(/^www\./, '');
            addClean(dom);
            const noTld = dom.replace(/\.[a-z]{2,}$/i, '');
            addClean(noTld);
            const parts = dom.split('.');
            for (const p of parts) {
                if (p.length >= 4 && !['com', 'org', 'net', 'gov', 'edu', 'io'].includes(p)) {
                    addClean(p);
                }
            }
        }
        addClean(s.sourceLabel);
        addClean(s.source);
        addClean(s.publisher);

        // Extract publisher suffix from title (e.g. "Title - Brand Name", "Title | Brand Name")
        const title = String(s.title || '');
        const brandMatch = title.match(/(?:[-–—|·:]\s*)([A-Za-z0-9\s.]{2,40})$/);
        if (brandMatch) {
            addClean(brandMatch[1]);
        }
    }
    return publisherBlocklist;
}

/**
 * Extracts the primary entity or core topic from a user query.
 */
export function extractCoreTopicSemantic(cleanQ) {
    const primaryClause = cleanQ.split(/[?!;]|\n+/)[0].trim();
    let topic = primaryClause
        .replace(/^(?:please\s+)?(?:can you\s+)?(?:tell me|explain|find|search|lookup|what|which|how|why|who|when|where)\s+(?:is|are|was|were|do|does|did|can|could|will|would|changes\s+did|features\s+did|new\s+features\s+did)?\s*/i, '')
        .replace(/\b(?:latest\s+updates?|latest\s+news|current\s+status|in\s+detail|right\s+now)\b/gi, '')
        .replace(/[?.!]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const regardingMatch = topic.match(/\b(?:regarding|about|concerning)\s+(.+)$/i);
    if (regardingMatch && regardingMatch[1].trim().length >= 3) {
        topic = regardingMatch[1].trim();
    }

    const strippedClause = topic.replace(/\s+(?:and\s+)?(?:how\s+(?:does|do|can|is|will|it)|what\s+(?:is|are|will)|why\s+(?:is|does)|who\s+(?:is|are)).*$/i, '').trim();
    if (strippedClause.length >= 3) {
        topic = strippedClause;
    }
    topic = topic.replace(/^(?:the|a|an)\s+/i, '').trim();
    if (topic.length > 50) {
        topic = topic.slice(0, 50).replace(/\s+\S*$/, '').trim();
    }
    return topic;
}

/**
 * Ranks and diversifies follow-up questions using Maximal Marginal Relevance (MMR)
 * and cosine similarity across 512-dimensional vector embeddings.
 */
export function rankAndDiversifyCandidatesSemantic(candidates = [], query = '', limit = 3) {
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const cleanCand = candidates.filter(c => typeof c === 'string' && c.trim().length > 0);
    if (cleanCand.length <= limit) return cleanCand;

    const queryVec = textToEmbeddingVector(query, 512);
    const candidateData = cleanCand.map(c => ({
        text: c,
        vec: textToEmbeddingVector(c, 512),
        simToQuery: vectorCosineSimilarity(queryVec, textToEmbeddingVector(c, 512))
    }));

    const selected = [];
    const remaining = [...candidateData];

    while (selected.length < limit && remaining.length > 0) {
        let bestIdx = -1;
        let bestScore = -Infinity;

        for (let i = 0; i < remaining.length; i++) {
            const cand = remaining[i];
            let maxSimToSelected = 0;
            for (const sel of selected) {
                const sim = vectorCosineSimilarity(cand.vec, sel.vec);
                if (sim > maxSimToSelected) maxSimToSelected = sim;
            }

            // Redundancy penalty: skip if almost identical (> 0.88 cosine similarity) to an already chosen question
            if (selected.length > 0 && maxSimToSelected > 0.88) {
                continue;
            }

            // MMR score: 70% query relevance, 30% diversity against chosen questions
            const mmrScore = 0.70 * cand.simToQuery - 0.30 * maxSimToSelected;
            if (mmrScore > bestScore) {
                bestScore = mmrScore;
                bestIdx = i;
            }
        }

        if (bestIdx >= 0) {
            selected.push(remaining[bestIdx]);
            remaining.splice(bestIdx, 1);
        } else {
            if (remaining.length > 0) {
                selected.push(remaining[0]);
            }
            break;
        }
    }

    return selected.map(s => s.text);
}

/**
 * Generates 3 contextual follow-up research questions.
 * Derived dynamically from user query intent and conversation context with zero hardcoding.
 * Uses BM25 and 512-dimensional vector semantic search to classify domains and diversify questions.
 */
export function generateRelatedResearchQuestions(optionsOrQuery, sourcesArg = [], answerArg = '') {
    let query = '';
    let topicInput = '';
    let sources = [];
    let answer = '';

    if (optionsOrQuery && typeof optionsOrQuery === 'object' && !Array.isArray(optionsOrQuery)) {
        query = optionsOrQuery.query || '';
        topicInput = optionsOrQuery.topic || '';
        sources = Array.isArray(optionsOrQuery.sources) ? optionsOrQuery.sources : [];
        answer = optionsOrQuery.answer || '';
    } else {
        query = String(optionsOrQuery || '');
        sources = Array.isArray(sourcesArg) ? sourcesArg : [];
        answer = String(answerArg || '');
    }

    if (!Array.isArray(sources) || sources.length === 0) {
        return [];
    }
    const cleanQ = normalizeUserQuery(query).replace(/[?.!]+$/g, '').trim();
    if (!cleanQ) return [];

    const normalizedQuery = cleanQ.toLowerCase();
    const candidates = [];
    const seen = new Set();

    // Dynamic metadata extraction for publisher blocklisting (zero hardcoding)
    const publisherBlocklist = extractDynamicPublisherBlocklist(sources);

    // Normalized titles of all sources for strict anti-copying check
    const normalizedSourceTitles = sources
        .map(s => cleanTextSnippet(s?.title || '').toLowerCase().replace(/[^a-z0-9]/g, ''))
        .filter(t => t.length >= 10);

    // Clickbait and headline fragment prefixes/patterns to strictly reject
    const clickbaitFragmentRegex = /^(?:full\s+list(?:\s+and\s+what\s+it\s+means)?|what\s+(?:it\s+means|you\s+need\s+to\s+know|we\s+know|is\s+next)|here'?s\s+(?:why|what|how|everything)|everything\s+you\s+need|all\s+you\s+need|read\s+more|live\s+updates|breaking\s+news|explained|analysis|opinion|photos|video|watch|in\s+photos)\b/i;

    const isInvalidQuestion = (text) => {
        if (!text || typeof text !== 'string') return true;
        const lower = text.toLowerCase().replace(/[?.!]+$/g, '').trim();
        if (lower.length < 15 || lower.length > 150) return true;
        if (lower === normalizedQuery) return true;
        if (/^https?:\/\//i.test(text) || /^[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/i.test(text)) return true;

        // Check against dynamic publisher blocklist
        for (const pub of publisherBlocklist) {
            if (lower === pub || lower.startsWith(`${pub} `) || lower.endsWith(` ${pub}`)) return true;
            if (lower.includes(pub) && lower.length < pub.length + 15) return true;
        }

        // Check clickbait fragments
        if (clickbaitFragmentRegex.test(lower)) return true;

        // Must start with an interrogative question word
        if (!/^(?:what|how|why|who|when|where|which|can|could|does|do|will|is|are|should)\b/i.test(lower)) {
            return true;
        }

        // Must have at least 4 words
        const words = lower.split(/\s+/).filter(Boolean);
        if (words.length < 4) return true;

        // Must not repeat any 2-word phrase
        for (let i = 0; i < words.length - 2; i++) {
            const phrase = words.slice(i, i + 2).join(' ');
            const remainder = words.slice(i + 2).join(' ');
            if (remainder.includes(phrase)) return true;
        }

        // Must NOT match or heavily copy any source title
        const cleanNoPunct = lower.replace(/[^a-z0-9]/g, '');
        for (const titleNorm of normalizedSourceTitles) {
            if (cleanNoPunct === titleNorm) return true;
            if (titleNorm.length >= 20 && cleanNoPunct.includes(titleNorm)) return true;
            if (cleanNoPunct.length >= 20 && titleNorm.includes(cleanNoPunct)) return true;
        }

        return false;
    };

    const addCandidate = (text) => {
        if (!text || typeof text !== 'string') return;
        let clean = cleanTextSnippet(text)
            .replace(/^[-*•\s\d.)\][]+/, '')
            .replace(/[?.!]+$/g, '')
            .replace(/\s+/g, ' ')
            .trim();

        // Strip trailing publisher tags (require whitespace around hyphens/colons to protect hyphenated words)
        clean = clean.replace(/(?:\s+[-–—:]\s+|\s*[|·]\s*)[^-–—:|·]{2,40}$/, '').trim();

        if (isInvalidQuestion(clean)) return;

        const formatted = `${clean}?`;
        const key = formatted.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            candidates.push(formatted);
        }
    };

    // Extract core subject/topic using semantic token and clause extraction
    const coreTopic = topicInput.trim() || extractCoreTopicSemantic(cleanQ);

    // 1. Semantic Domain-grounded follow-up question generation via BM25 + Vector Cosine Matching
    if (coreTopic.length >= 3) {
        const domain = classifyQueryDomainSemantic(cleanQ);
        if (domain && typeof domain.generate === 'function') {
            const domainCandidates = domain.generate(coreTopic);
            for (const c of domainCandidates) addCandidate(c);
        } else {
            addCandidate(`What are the key implications and latest developments regarding ${coreTopic}`);
            addCandidate(`What official background or recent announcements exist for ${coreTopic}`);
            addCandidate(`What are the primary perspectives and notable viewpoints on ${coreTopic}`);
        }

        // Additional contextual angles
        addCandidate(`How does ${coreTopic} affect the impacted organizations and individuals`);
        addCandidate(`What background factors and context led to ${coreTopic}`);
        addCandidate(`What next steps or actions are expected for ${coreTopic}`);
    }

    // 2. Derive follow-ups from substantive sentences in the generated answer if available
    if (candidates.length < 3 && answer && typeof answer === 'string') {
        const cleanAnswer = cleanTextSnippet(answer);
        const sentences = cleanAnswer.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
            if (candidates.length >= 6) break;
            if (/^(?:what|how|why|who|when|where|which|can|does|is|are|will)\b/i.test(sentence)) {
                addCandidate(sentence);
            }
        }
    }

    return rankAndDiversifyCandidatesSemantic(candidates, cleanQ, 3);
}

/**
 * Replaces inline citation patterns like [1], [2], [1, 2] with interactive citation badges.
 */
export function parseCitationsInHtml(html = '') {
    if (!html || typeof html !== 'string') return '';

    // Replace [1](url) markdown link citations first if present
    let result = html.replace(/\[(\d+)\]\((https?:\/\/[^)]+)\)/g, (match, id, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="citation-badge" data-source-id="${id}" title="Source [${id}]"><sup>[${id}]</sup></a>`;
    });

    // Replace bare [1], [2], or [1, 2] citations (not part of markdown links or code)
    result = result.replace(/(?<![\[\w`])\[(\d+(?:\s*,\s*\d+)*)\](?![\]\(])/g, (match, idsStr) => {
        const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);
        return ids.map(id => {
            return `<button type="button" class="citation-badge" data-source-id="${id}" onclick="window.JarvisLiveResearch?.highlightSource('${id}')" title="View Source [${id}]"><sup>[${id}]</sup></button>`;
        }).join('');
    });

    return result;
}

/**
 * Renders or updates the top Sources Carousel inside an assistant message bubble.
 */
export function renderOrUpdateSourcesCarousel(rowElement, sources = []) {
    if (!rowElement || !Array.isArray(sources) || !sources.length) return;
    const bubble = rowElement.querySelector('.chat-bubble-assistant') || rowElement.querySelector('.min-w-0');
    if (!bubble) return;

    let carousel = bubble.querySelector('.chat-source-carousel');
    const cardsHtml = sources.map((s) => {
        const domain = s.domain || 'web';
        const title = s.title || domain;
        const favicon = s.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
        const url = s.url || '#';
        return `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="source-card-pill" data-source-id="${s.id}" title="${title}">
                <img class="source-card-favicon" src="${favicon}" alt="" loading="lazy" onerror="this.style.display='none'" />
                <div class="source-card-info">
                    <span class="source-card-domain">${domain}</span>
                    <span class="source-card-title">${title}</span>
                </div>
                <span class="source-card-badge">${s.id}</span>
            </a>
        `;
    }).join('');

    const newCarouselHtml = `
        <div class="source-carousel-header">
            <span class="source-carousel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1-4-10z"></path>
                </svg>
                Sources
            </span>
            <span class="source-carousel-count">${sources.length} verified</span>
        </div>
        <div class="source-carousel-track">
            ${cardsHtml}
        </div>
    `;

    const textEl = bubble.querySelector('.assistant-message-text');

    if (carousel) {
        carousel.innerHTML = newCarouselHtml;
        if (textEl && textEl.nextSibling !== carousel) {
            textEl.after(carousel);
        }
    } else {
        const newCarousel = document.createElement('div');
        newCarousel.className = 'chat-source-carousel';
        newCarousel.setAttribute('role', 'region');
        newCarousel.setAttribute('aria-label', 'Web Sources');
        newCarousel.innerHTML = newCarouselHtml;

        if (textEl) {
            textEl.after(newCarousel);
        } else {
            bubble.appendChild(newCarousel);
        }
    }
}

/**
 * Highlights a source card pill in the carousel upon citation badge click or hover.
 */
export function highlightSourceCard(sourceId, container = document) {
    if (!sourceId) return;
    const cards = container.querySelectorAll(`.source-card-pill[data-source-id="${sourceId}"]`);
    cards.forEach(card => {
        card.classList.add('is-highlighted');
        try {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (_) {}
        setTimeout(() => {
            card.classList.remove('is-highlighted');
        }, 1800);
    });
}

/**
 * Renders the 3 related research questions tray below an assistant message bubble.
 */
export function renderRelatedQuestionsTray(rowElement, questions = [], onSelect = null) {
    if (!rowElement || !Array.isArray(questions) || !questions.length) return;
    let slot = rowElement.querySelector('.assistant-next-steps-slot');
    if (!slot) {
        const bubble = rowElement.querySelector('.chat-bubble-assistant') || rowElement.querySelector('.min-w-0');
        if (!bubble) return;
        slot = document.createElement('div');
        slot.className = 'assistant-next-steps-slot';
        bubble.parentNode.appendChild(slot);
    }

    const pillsHtml = questions.map((q, idx) => {
        const text = String(q || '').trim();
        const escaped = cleanTextSnippet(text);
        return `
            <button type="button" class="related-question-pill" data-question-idx="${idx}">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>${escaped}</span>
            </button>
        `;
    }).join('');

    slot.innerHTML = `
        <div class="perplexity-related-tray" role="region" aria-label="Follow up questions">
            <div class="related-tray-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>Follow up questions</span>
            </div>
            <div class="related-pills-list">
                ${pillsHtml}
            </div>
        </div>
    `;

    // Secure event delegation to completely eliminate inline onclick quote-escaping syntax errors
    if (typeof slot.addEventListener === 'function') {
        slot.addEventListener('click', (e) => {
            const btn = e.target?.closest?.('.related-question-pill');
            if (!btn) return;
            e.preventDefault();
            const idx = Number(btn.getAttribute('data-question-idx'));
            const question = questions[idx] || btn.querySelector('span')?.textContent?.trim();
            if (!question) return;
            if (typeof onSelect === 'function') {
                onSelect(question);
            } else {
                window.JarvisLiveResearch?.askRelatedQuestion?.(question);
            }
        });
    }
}

let _globalGenerationCounter = 0;

/**
 * Master Bounded Live Research Controller with strict Application Deadline.
 * Enforces explicit lifecycle state machine and provenance contract:
 * REQUESTED -> SEARCHING -> SEARCH_DEADLINE -> SOURCE_VALIDATION
 *           -> SOURCE_GROUNDED_SYNTHESIS (if sources.length > 0)
 *           -> NO_SOURCES (if sources.length === 0)
 *           -> COMPLETE
 */
export class BoundedLiveResearchController {
    constructor(options = {}) {
        this.searchCutoffMs = options.searchCutoffMs ?? LIVE_RESEARCH_BUDGETS.SEARCH_CUTOFF_MS;
        this.searchTimeoutMs = options.searchTimeoutMs ?? LIVE_RESEARCH_BUDGETS.SEARCH_TIMEOUT_MS;
        this.fallbackWarningMs = options.fallbackWarningMs ?? LIVE_RESEARCH_BUDGETS.FALLBACK_WARNING_MS;
        this.hardDeadlineMs = options.hardDeadlineMs ?? LIVE_RESEARCH_BUDGETS.HARD_DEADLINE_MS;
        this.minSourcesForEarlySynthesis = options.minSourcesForEarlySynthesis ?? LIVE_RESEARCH_BUDGETS.MIN_SOURCES_FOR_EARLY_SYNTHESIS;
        this.turnId = 'turn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        this.generationId = ++_globalGenerationCounter;

        this.state = RESEARCH_STATES.REQUESTED;
        this.provenance = null;
        this.isTerminal = false;
        this.isFallbackRendered = false;
        this.sources = [];
        this.rawSearchResults = [];
        this.streamedText = '';

        this.telemetry = {
            t_start: 0,
            t_first_search: 0,
            t_search_cutoff: 0,
            t_sources_rendered: 0,
            t_llm_start: 0,
            t_first_token: 0,
            t_fallback_triggered: 0,
            t_completed: 0,
            providerTiming: null,
            searchError: null,
            httpStatus: null,
            sourcesCount: 0,
            totalDurationMs: 0
        };

        this.searchAbortController = new AbortController();
        this.streamAbortController = new AbortController();
        this.timers = [];
        this._resolveExecution = null;
    }

    transition(nextState, meta = {}, uiCallbacks = {}) {
        if (this.isTerminal) return false;
        const prevState = this.state;
        this.state = nextState;

        if (nextState === RESEARCH_STATES.COMPLETE || nextState === RESEARCH_STATES.ABORTED) {
            this.isTerminal = true;
            this.clearAllTimers();
        }

        try {
            uiCallbacks.onStateTransition?.({
                state: nextState,
                prevState,
                turnId: this.turnId,
                provenance: this.provenance,
                meta
            });
        } catch (_) {}
        return true;
    }

    abort() {
        if (this.isTerminal) return;
        this.provenance = PROVENANCE_MODES.ABORTED;
        this.transition(RESEARCH_STATES.ABORTED);
        this.clearAllTimers();
        try { this.searchAbortController.abort(); } catch (_) {}
        try { this.streamAbortController.abort(); } catch (_) {}
        if (typeof this._resolveExecution === 'function') {
            this._resolveExecution({
                success: false,
                aborted: true,
                state: RESEARCH_STATES.ABORTED,
                provenance: PROVENANCE_MODES.ABORTED,
                turnId: this.turnId,
                content: '',
                sources: []
            });
            this._resolveExecution = null;
        }
    }

    clearAllTimers() {
        for (const t of this.timers) {
            clearTimeout(t);
        }
        this.timers = [];
    }

    execute({
        query: rawQuery,
        userText,
        context = [],
        conversationHistory = [],
        assistantMessageId,
        fetchSearchFn,
        streamSynthesisFn,
        uiCallbacks = {},
        threadState = null,
        isWebForced = false
    }) {
        return new Promise((resolve) => {
            this._resolveExecution = resolve;
            this.threadState = threadState;
            this.isWebForced = Boolean(isWebForced);
            const query = normalizeUserQuery(rawQuery);
            this.telemetry.t_start = performance.now();

            // Pre-network rejection for empty/whitespace/invisible/non-searchable queries
            if (!hasSearchableContent(query)) {
                this.telemetry.t_completed = performance.now();
                const fallbackContent = generateSnippetFallback(query, []);
                this.provenance = PROVENANCE_MODES.NO_SOURCES;
                this.transition(RESEARCH_STATES.COMPLETE, { provenance: this.provenance }, uiCallbacks);
                const finalPayload = {
                    success: false,
                    fallback: true,
                    state: RESEARCH_STATES.COMPLETE,
                    provenance: PROVENANCE_MODES.NO_SOURCES,
                    content: fallbackContent,
                    sources: [],
                    turnId: this.turnId,
                    assistantMessageId,
                    telemetry: this.telemetry
                };
                if (typeof uiCallbacks.onComplete === 'function') {
                    try { uiCallbacks.onComplete(finalPayload); } catch (_) {}
                }
                if (typeof uiCallbacks.onFallbackComplete === 'function') {
                    try { uiCallbacks.onFallbackComplete(finalPayload); } catch (_) {}
                }
                resolve(finalPayload);
                return;
            }

            this.transition(RESEARCH_STATES.SEARCHING, {}, uiCallbacks);
            let searchCutoffTriggered = false;
            let synthesisStarted = false;

            const incomingContext = Array.isArray(context) && context.length > 0
                ? context
                : (Array.isArray(conversationHistory) ? conversationHistory : []);
            const effectiveContextTurns = incomingContext
                .slice(-10)
                .map(t => {
                    const role = t?.role === 'assistant' || t?.ai ? 'assistant' : 'user';
                    let text = String(t?.content || t?.text || (role === 'user' ? t?.user : t?.ai) || '').trim();
                    if (role === 'assistant') {
                        text = text.replace(/(?:\n{2,}|\s{2,}|\s+)===\s*(?:SOURCE METADATA|VERIFICATION REPORT)\s*===[\s\S]*$/i, '')
                                   .replace(/(?:\n{2,}|\s{2,}|\s+)(?:Sources|Verified Sources|Source Excerpts|Citations|References):[\s\S]*$/i, '')
                                   .replace(/(?:\n{2,}|\s{2,}|\s+)\*(?:Synthesis completed at[\s\S]*?\*|\(Source[s]?:.*?\))/gi, '')
                                   .replace(/(?:\n|\s+)(?:\[\d+\]|-|\*)\s+https?:\/\/\S+/gi, '')
                                   .trim();
                        if (text.length > 800) {
                            text = text.slice(0, 800) + '...';
                        }
                    }
                    return { role, text, content: text };
                })
                .filter(t => t.text.length > 0 && t.text !== '[object Object]');

            const completeExecution = ({ success, fallback = false, provenance, content, sources }) => {
                if (this.state === RESEARCH_STATES.COMPLETE || this.state === RESEARCH_STATES.ABORTED) return;
                this.provenance = provenance;
                this.telemetry.t_completed = performance.now();
                this.telemetry.sourcesCount = (sources || []).length;
                this.telemetry.totalDurationMs = this.telemetry.t_start
                    ? Math.round(this.telemetry.t_completed - this.telemetry.t_start)
                    : 0;
                this.telemetry.degradedAnomaly = Boolean(fallback || !isSubstantiveLiveAnswer(content, provenance));
                this.transition(RESEARCH_STATES.COMPLETE, { provenance }, uiCallbacks);

                const finalPayload = {
                    success,
                    fallback,
                    state: RESEARCH_STATES.COMPLETE,
                    provenance,
                    content,
                    sources: sources || [],
                    turnId: this.turnId,
                    assistantMessageId,
                    sourcesCount: this.telemetry.sourcesCount,
                    totalDurationMs: this.telemetry.totalDurationMs,
                    telemetry: this.telemetry
                };

                // Unified first-class completion callback
                if (typeof uiCallbacks.onComplete === 'function') {
                    try { uiCallbacks.onComplete(finalPayload); } catch (_) {}
                }

                // Backwards-compatible legacy callbacks
                if (success && !fallback) {
                    if (typeof uiCallbacks.onStreamComplete === 'function') {
                        try {
                            uiCallbacks.onStreamComplete({
                                turnId: this.turnId,
                                content,
                                sources: finalPayload.sources,
                                assistantMessageId,
                                telemetry: this.telemetry,
                                provenance
                            });
                        } catch (_) {}
                    }
                } else {
                    this.isFallbackRendered = true;
                    if (typeof uiCallbacks.onFallbackComplete === 'function') {
                        try {
                            uiCallbacks.onFallbackComplete({
                                turnId: this.turnId,
                                content,
                                sources: finalPayload.sources,
                                assistantMessageId,
                                telemetry: this.telemetry,
                                provenance
                            });
                        } catch (_) {}
                    }
                }

                resolve(finalPayload);
            };

            const onSearchDeadline = () => {
                if (searchCutoffTriggered || this.isTerminal) return;
                searchCutoffTriggered = true;
                this.telemetry.t_search_cutoff = performance.now();

                // Abort pending search fetches immediately
                try { this.searchAbortController.abort(); } catch (_) {}

                // If synthesis has already started (early synthesis path), do not restart or transition backwards
                if (synthesisStarted) return;

                this.transition(RESEARCH_STATES.SEARCH_DEADLINE, {}, uiCallbacks);

                // SOURCE_VALIDATION
                this.transition(RESEARCH_STATES.SOURCE_VALIDATION, {}, uiCallbacks);
                this.sources = normalizeResearchSources(this.rawSearchResults, query);
                this.telemetry.t_sources_rendered = performance.now();

                // INVARIANT 1: Zero usable sources -> enter NO_SOURCES state immediately
                if (!this.sources || this.sources.length === 0) {
                    this.transition(RESEARCH_STATES.NO_SOURCES, {}, uiCallbacks);
                    this.clearAllTimers();

                    if (typeof uiCallbacks.onSourcesValidated === 'function') {
                        try {
                            uiCallbacks.onSourcesValidated({
                                turnId: this.turnId,
                                sources: [],
                                provenance: PROVENANCE_MODES.NO_SOURCES,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }

                    // Complete immediately with no-source fallback. Zero LLM delay!
                    const noSourceFallback = generateSnippetFallback(query, []);
                    completeExecution({
                        success: false,
                        fallback: true,
                        provenance: PROVENANCE_MODES.NO_SOURCES,
                        content: noSourceFallback,
                        sources: []
                    });
                    return;
                }

                // INVARIANT 2: Valid usable sources -> enter SOURCE_GROUNDED_SYNTHESIS
                this.transition(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS, { count: this.sources.length }, uiCallbacks);

                if (typeof uiCallbacks.onSourcesValidated === 'function') {
                    try {
                        uiCallbacks.onSourcesValidated({
                            turnId: this.turnId,
                            sources: this.sources,
                            provenance: PROVENANCE_MODES.WEB_GROUNDED,
                            assistantMessageId
                        });
                    } catch (_) {}
                }
                if (typeof uiCallbacks.onSourcesReady === 'function') {
                    try {
                        uiCallbacks.onSourcesReady({
                            turnId: this.turnId,
                            sources: this.sources,
                            assistantMessageId
                        });
                    } catch (_) {}
                }

                startSourceGroundedSynthesis();
            };

            // Guard: only set cutoff timer if budget is positive.
            // A zero searchCutoffMs would fire immediately before any results arrive.
            const cutoffTimer = this.searchCutoffMs > 0
                ? setTimeout(onSearchDeadline, this.searchCutoffMs)
                : null;
            if (cutoffTimer !== null) this.timers.push(cutoffTimer);

            const fallbackWarningTimer = setTimeout(() => {
                if (this.isTerminal || this.state !== RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS) return;
                this.telemetry.t_fallback_triggered = performance.now();
                if (typeof uiCallbacks.onFallbackWarning === 'function') {
                    try { uiCallbacks.onFallbackWarning({ turnId: this.turnId, telemetry: this.telemetry }); } catch (_) {}
                }
            }, this.fallbackWarningMs);
            this.timers.push(fallbackWarningTimer);

            const hardDeadlineTimer = setTimeout(() => {
                if (this.isTerminal) return;
                try { this.streamAbortController.abort(); } catch (_) {}

                const currentStreamLength = (this.streamedText || '').trim().length;
                let finalContent = '';
                let finalProvenance = PROVENANCE_MODES.SYNTHESIS_FALLBACK;

                if (currentStreamLength >= 30) {
                    finalContent = `${this.streamedText.trim()}\n\n*(Synthesis completed at the 9.0s deadline)*`;
                    finalProvenance = PROVENANCE_MODES.WEB_GROUNDED;
                } else {
                    finalContent = generateSnippetFallback(query, this.sources);
                }

                completeExecution({
                    success: finalProvenance === PROVENANCE_MODES.WEB_GROUNDED,
                    fallback: finalProvenance !== PROVENANCE_MODES.WEB_GROUNDED,
                    provenance: finalProvenance,
                    content: finalContent,
                    sources: this.sources
                });
            }, this.hardDeadlineMs);
            this.timers.push(hardDeadlineTimer);

            const runSearch = async () => {
                try {
                    if (typeof fetchSearchFn === 'function') {
                        const searchRes = await fetchSearchFn({
                            query: distillSearchQuery(query) || query,
                            context: effectiveContextTurns,
                            threadState: this.threadState,
                            signal: this.searchAbortController.signal,
                            timeoutMs: this.searchTimeoutMs
                        });
                        // Invariant: drop late search results if deadline has passed or controller is terminal
                        if (searchCutoffTriggered || this.isTerminal) return;

                        if (this.telemetry.t_first_search === 0) {
                            this.telemetry.t_first_search = performance.now();
                        }
                        if (searchRes?.timing || searchRes?.providerTiming) {
                            this.telemetry.providerTiming = searchRes.providerTiming || searchRes.timing;
                        }
                        if (Array.isArray(searchRes?.results)) {
                            this.rawSearchResults.push(...searchRes.results);
                        }
                    }
                } catch (err) {
                    if (searchCutoffTriggered || this.isTerminal) return;
                    const errStr = String(err?.message || err || '').toLowerCase();
                    const isTimeout = err?.name === 'TimeoutError' ||
                        err?.name === 'AbortError' ||
                        Boolean(err?.isTimeout) ||
                        errStr.includes('timed out') ||
                        errStr.includes('timeout') ||
                        errStr.includes('abort') ||
                        this.searchAbortController.signal.aborted;
                    const timeoutBound = this.searchTimeoutMs || 4500;
                    this.telemetry.searchError = isTimeout
                        ? `client_search_timeout (${timeoutBound}ms)`
                        : (err?.message || String(err));
                    this.telemetry.httpStatus = err?.status || null;
                    console.warn(`[BoundedLiveResearch:${this.turnId}] Search failed or timed out:`, err?.message || err);
                    clearTimeout(cutoffTimer);
                    onSearchDeadline();
                    return;
                }

                // Invariant: drop late search results if deadline has passed or controller is terminal
                if (searchCutoffTriggered || this.isTerminal) return;

                const currentSources = normalizeResearchSources(this.rawSearchResults, query);
                this.sources = currentSources;

                // Quality-aware early synthesis:
                // Only trigger early synthesis if sources meet quality standards (e.g. authoritative docs for tech queries)
                // and minimum source count is satisfied.
                const meetsQuality = currentSources.length >= this.minSourcesForEarlySynthesis &&
                    evaluateSourceQualityForEarlySynthesis(currentSources, query);

                if (meetsQuality) {
                    clearTimeout(cutoffTimer);
                    this.telemetry.t_sources_rendered = performance.now();
                    this.transition(RESEARCH_STATES.SOURCE_VALIDATION, { early: true }, uiCallbacks);
                    this.transition(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS, { count: currentSources.length, early: true }, uiCallbacks);

                    if (typeof uiCallbacks.onSourcesValidated === 'function') {
                        try {
                            uiCallbacks.onSourcesValidated({
                                turnId: this.turnId,
                                sources: currentSources,
                                provenance: PROVENANCE_MODES.WEB_GROUNDED,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }
                    if (typeof uiCallbacks.onSourcesReady === 'function') {
                        try {
                            uiCallbacks.onSourcesReady({
                                turnId: this.turnId,
                                sources: currentSources,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }

                    startSourceGroundedSynthesis();
                } else {
                    // Search completed early with fewer than minSourcesForEarlySynthesis or insufficient quality: finalize at cutoff or complete
                    clearTimeout(cutoffTimer);
                    onSearchDeadline();
                }
            };

            const startSourceGroundedSynthesis = async () => {
                // Invariant: SOURCE_GROUNDED_SYNTHESIS requires sources.length > 0
                if (synthesisStarted || this.isTerminal || !this.sources || this.sources.length === 0) {
                    return;
                }
                synthesisStarted = true;

                this.telemetry.t_llm_start = performance.now();
                const sourcesContext = formatSourcesForPrompt(this.sources);
                const now = new Date();
                const currentDateStr = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                const effectiveUserPrompt = String(userText || query || '').trim();

                const contextLines = effectiveContextTurns.length > 0
                    ? effectiveContextTurns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.text}`).join('\n')
                    : '';
                const conversationHistoryBlock = contextLines
                    ? `\nPRIOR CONVERSATION CONTEXT:\n${contextLines}\n`
                    : '';

                const deepSynthesisBlock = this.isWebForced ? `
DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL WEB SEARCH ACTIVATED):
Act as a deep-synthesis reasoning engine. Answer the user's input by performing comprehensive cross-referencing, multi-hop lookups, and logical deduction:
1. DECONSTRUCT THE INPUT: Never rely on a single source or a single surface-level match. Break the query down into its core parameters, underlying logic, and distinct sub-components. Address each part thoroughly.
2. PIVOT ON INCOMPLETE DATA: If initial search findings or evidence reference a count, a category, an error code, a doctrine, or a structural concept without providing the specific contents, names, or values, do not halt execution. Treat those surface findings as clues and scour all available excerpts and adjacent records to extract the missing data points.
3. DEDUCTIVE SYNTHESIS: Connect independent datasets logically. If Dataset A defines a structural rule, system architecture, or conditional logic, and Dataset B contains the live variables or current entities that fit into that logic, synthesize them to deliver the final, specific solution.
4. EPISTEMIC COMPLETENESS: Never conclude that an answer is "unavailable" or "unverifiable" simply because a single summary source or initial data layer lacks the complete picture. Drill down to primary documentation, distinct data layers, or adjacent verified frameworks across the excerpts to fully resolve the query.
` : '';

                const systemRole = this.isWebForced
                    ? 'You are a deep-synthesis reasoning engine and expert real-time research assistant.'
                    : 'You are an expert real-time research assistant.';

                const prompt = `${systemRole} Answer the user's question directly, comprehensively, and factually using ONLY the verified web content below.
TEMPORAL ANCHOR:
Today's Date: ${currentDateStr}. Use this exact date as your reference point for phrases like 'today', 'this month', 'recently', 'latest', 'current', or 'this year'.
${deepSynthesisBlock}
RULES:
1. COMPLETE COVERAGE: Identify and answer every distinct question, sub-question, and requested detail in the user prompt using the retrieved evidence. If the prompt contains multiple parts (such as status, affected entities, requirements, comparisons, or timelines), address each part thoroughly in a dedicated explanation or structured breakdown.
2. SUBSTANTIVE DETAILS: Never return only headlines, source titles, or a list of links as an answer. Extract and explain substantive facts, operational impacts, context, and concrete details from the source excerpts.
3. DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY: Clearly differentiate verified facts and confirmed actions from unconfirmed claims, ongoing status, or speculation. If different sources report conflicting claims, explain the divergence and cite each source. If evidence for any specific part of the user question is missing, inaccessible, or unverified in the excerpts, explicitly state what could not be verified rather than fabricating or omitting it.
4. GROUNDED CITATIONS & NATURAL SYNTHESIS: Ground key statements and extracted facts thoroughly in the verified sources below. Present the answer in clean, natural prose without emitting bracket citations (like [1], [2]) or citation phrases (like 'found in [1]'). Verified sources are tracked and rendered separately in the interface.
5. STRUCTURE: Provide a direct answer first, followed by clear explanations, requested lists, and impact analyses.
6. CHRONOLOGICAL PRIORITY: Sources are ordered chronologically with the newest/most recent updates listed first ([1], [2], ...). For questions about current status, updates, or recent developments, prioritize the latest sources over older sources.
7. ENTITY INTEGRITY & ZERO HALLUCINATION (CRITICAL):
   - For proper nouns, suspect identities, person names, places, and organizations: report ONLY names and places explicitly stated in the retrieved sources below.
   - If a person's name, suspect identity, or specific location is unstated, unconfirmed, or has not been publicly released in the verified sources, explicitly state that authorities or reports have not released the name/location. NEVER guess, assume, or invent person names, places, or affiliations.
   - When answering follow-up questions, stay anchored to the specific event, location, and entities established in the conversation history. Do not conflate or substitute names or locations from unrelated search excerpts.
8. ZERO TOOL EMISSION (CRITICAL): Never emit tool calls, function calls, or JSON objects (such as {"tool": "web_search", ...} or <tool_call>). All required web search has already been performed and all verified sources are provided below. Output the final, synthesized factual response directly in prose.
${conversationHistoryBlock}
User question: "${effectiveUserPrompt}"

Verified Sources:
${sourcesContext}`;

                // Dynamic remaining synthesis budget with controlled retry support
                let synthesisSucceeded = false;
                const maxAttempts = 2;

                for (let attempt = 0; attempt < maxAttempts; attempt++) {
                    if (this.isTerminal) return;
                    const elapsed = performance.now() - this.telemetry.t_start;
                    const attemptBudgetMs = Math.max(800, Math.round(this.hardDeadlineMs - elapsed - 250));

                    if (attempt > 0 && attemptBudgetMs < 1000) {
                        break;
                    }

                    try {
                        if (typeof streamSynthesisFn === 'function') {
                            await streamSynthesisFn({
                                prompt,
                                rawQuery: query,
                                userText: effectiveUserPrompt,
                                sources: this.sources,
                                context: effectiveContextTurns,
                                signal: this.streamAbortController.signal,
                                timeoutMs: attemptBudgetMs,
                                isRetry: attempt > 0,
                                onToken: (token) => {
                                    // Invariant: drop tokens if terminal or no longer in synthesis state
                                    if (this.isTerminal || this.state !== RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS) return;
                                    if (this.telemetry.t_first_token === 0) {
                                        this.telemetry.t_first_token = performance.now();
                                    }
                                    this.streamedText += token;
                                    if (typeof uiCallbacks.onToken === 'function') {
                                        try {
                                            uiCallbacks.onToken({
                                                turnId: this.turnId,
                                                token,
                                                streamedText: this.streamedText,
                                                assistantMessageId
                                            });
                                        } catch (_) {}
                                    }
                                }
                            });
                        }

                        const cleanStreamed = (this.streamedText || '').trim();
                        // Invariant: empty/trivial output protection & tool call JSON rejection
                        if (cleanStreamed.length >= 10 && !isRawToolCallJson(cleanStreamed)) {
                            synthesisSucceeded = true;
                            break;
                        }
                        if (isRawToolCallJson(cleanStreamed)) {
                            this.streamedText = '';
                        }
                    } catch (err) {
                        if (this.isTerminal) return;
                        this.telemetry.synthesisError = err?.message || String(err);
                        const isPermanentError = err?.code === 'missing_credentials' || err?.code === 'service_unavailable';
                        if (attempt === 0 && !isPermanentError) {
                            console.warn(`[BoundedLiveResearch:${this.turnId}] Synthesis attempt 1 failed (${err?.message || err}), attempting controlled retry...`);
                            this.streamedText = '';
                            await new Promise(r => setTimeout(r, 80));
                        } else {
                            if (attempt > 0) {
                                console.error(`[BoundedLiveResearch:${this.turnId}] Synthesis retry failed:`, err);
                            }
                            break;
                        }
                    }
                }

                if (!this.isTerminal) {
                    const cleanStreamed = (this.streamedText || '').trim();
                    if (synthesisSucceeded && cleanStreamed.length >= 10) {
                        completeExecution({
                            success: true,
                            fallback: false,
                            provenance: PROVENANCE_MODES.WEB_GROUNDED,
                            content: cleanStreamed,
                            sources: this.sources
                        });
                    } else {
                        const snippetFallback = generateSnippetFallback(query, this.sources);
                        completeExecution({
                            success: false,
                            fallback: true,
                            provenance: PROVENANCE_MODES.SYNTHESIS_FALLBACK,
                            content: snippetFallback,
                            sources: this.sources
                        });
                    }
                }
            };

            runSearch();
        });
    }
}

// Global namespace registration for browser
if (typeof window !== 'undefined') {
    window.JarvisLiveResearch = {
        LIVE_RESEARCH_BUDGETS,
        RESEARCH_STATES,
        PROVENANCE_MODES,
        BoundedLiveResearchController,
        normalizeResearchSources,
        isAuthoritativeResearchSource,
        evaluateSourceQualityForEarlySynthesis,
        generateSnippetFallback,
        isSubstantiveLiveAnswer,
        isRawToolCallJson,
        generateRelatedResearchQuestions,
        classifyQueryDomainSemantic,
        extractCoreTopicSemantic,
        rankAndDiversifyCandidatesSemantic,
        scoreSourcesBM25AndSemantic,
        isFreshnessQuerySemantic,
        extractDynamicPublisherBlocklist,
        BM25Index,
        textToEmbeddingVector,
        vectorCosineSimilarity,
        parseCitationsInHtml,
        renderOrUpdateSourcesCarousel,
        highlightSource: (id) => highlightSourceCard(id, document),
        renderRelatedQuestionsTray,
        normalizeUserQuery,
        hasSearchableContent,
        askRelatedQuestion: (text) => {
            const composer = document.getElementById('text-input') || document.getElementById('chat-composer-input') || document.getElementById('user-input');
            if (composer) {
                composer.value = text;
                composer.focus();
            }
            if (typeof window.sendTextInput === 'function') {
                window.sendTextInput({ text, forceWebSearch: true });
            }
        }
    };
}

