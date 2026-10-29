/**
 * In-Process Hybrid Reranker
 * ──────────────────────────
 * Combines four independent ranking signals via Reciprocal Rank Fusion (RRF):
 *  1. BM25 Lexical Relevance       – TF-IDF approximation, <0.2 ms
 *  2. Dense Semantic Embedding     – NVIDIA NIM cosine similarity (optional)
 *  3. Date-Aware Temporal Decay    – Exponential half-life decay per query intent
 *  4. Domain Trust Tier Delta      – Structural T0–T4 authority score
 *
 * Optionally post-reranked by an NVIDIA NIM cross-encoder when configured.
 */

import { rankTextsByEmbedding, rerankTexts, hasNvidiaEmbeddingKey, isNvidiaRerankEnabled } from './embeddings.js';
import { classifyDomainTrustTier, normaliseDomain } from './domain-trust-registry.js';

const RRF_K = 60; // Standard reciprocal rank fusion damping factor
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
}

/**
 * Extracts temporal intent from user query:
 * - 'target_year': User specifically asked for a historical or future year (e.g. 2021, 1998)
 * - 'current': User asked for current/latest/breaking information
 * - 'neutral': General query without strong temporal constraints
 */
const MONTH_NAMES_MAP = Object.freeze({
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
    may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
    sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11
});

export function extractQueryDateIntent(query = '') {
    const raw = String(query || '').toLowerCase();
    
    // Check for explicit 4-digit year (1900-2099)
    const yearMatch = raw.match(/\b(19\d\d|20\d\d)\b/);
    if (yearMatch) {
        const targetYear = parseInt(yearMatch[1], 10);
        const currentYear = new Date().getUTCFullYear();
        // If it's a past year or specific future year, treat as target_year
        if (targetYear !== currentYear || /\b(?:in|during|for|from|back\s+in)\s+(?:19\d\d|20\d\d)\b/.test(raw)) {
            return { type: 'target_year', targetYear, weight: 1.0 };
        }
    }

    // 1. Immediate / Realtime scope (today, yesterday, past 24-48 hours)
    if (/\b(?:today|tonight|yesterday|yesterday's|today's|right\s+now|currently|now|past\s+24\s+hours?|last\s+24\s+hours?|past\s+48\s+hours?|hours?\s+ago)\b/.test(raw)) {
        return { type: 'immediate', weight: 2.0 };
    }

    // 2. Recent week scope (this week, past week, few days ago)
    if (/\b(?:this\s+week|past\s+week|last\s+week|current\s+week|past\s+7\s+days|recent\s+days|few\s+days\s+ago|days?\s+ago)\b/.test(raw)) {
        return { type: 'recent_week', weight: 1.5 };
    }

    // 3. Named month detection (e.g. "october updates", "in may")
    const monthMatch = raw.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/);
    if (monthMatch) {
        const mo = MONTH_NAMES_MAP[monthMatch[1]];
        if (mo !== undefined) {
            return { type: 'target_month', targetMonth: mo, weight: 1.5 };
        }
    }

    // 4. General Recency / Current updates
    if (/\b(?:latest|current|recently|recent|breaking|newest|what('?s|\s+is)\s+new|updates?|this\s+month|past\s+month|news|active|present)\b/.test(raw)) {
        return { type: 'current', weight: 1.2 };
    }

    // Check for leadership or status queries which implicitly require current facts
    if (/\b(?:who\s+is\s+the|what\s+is\s+the\s+current|ceo\s+of|president\s+of|prime\s+minister\s+of|cm\s+of|governor\s+of|price\s+of|weather\s+in)\b/.test(raw)) {
        return { type: 'current', weight: 0.8 };
    }

    // Dynamic changing topics (economic rates, inflation, stocks, markets, war, elections, polls, status, etc.)
    if (/\b(?:rate|rates|rate\s+cut|rate\s+hike|interest\s+rate|inflation|stock|stocks|market|markets|economy|price|prices|gdp|ceasefire|war|conflict|election|elections|polls?|status|deal|talks|merger|acquisition|flight|launch|spacex|boeing)\b/i.test(raw)) {
        return { type: 'current', weight: 1.1 };
    }

    return { type: 'neutral', weight: 0.3 };
}

const KNOWN_TODAY_BRANDS = /\b(?:usa\s+today|india\s+today|medical\s+news\s+today|psychology\s+today|today's\s+parent|today\s+show|today\.com|the\s+today\s+show|today\s+fm)\b/gi;
const CASUAL_TODAY_PHRASES = /\b(?:in\s+today's\s+(?:world|society|market|digital\s+age|economy)|available\s+today|join\s+today|call\s+(?:us\s+)?today|apply\s+today|start\s+today|order\s+today|buy\s+today|sign\s+up\s+today|shop\s+today|visit\s+today|book\s+today)\b/gi;

/**
 * Robustly parses publication/update timestamp from document metadata, URL paths, or snippets
 * Supports ISO, US formats (Month DD, YYYY & MM/DD/YYYY), UK formats (DD Month YYYY & DD/MM/YYYY), and relative times.
 */
export function parseDocumentDate(doc = {}, now = Date.now()) {
    if (!doc || typeof doc !== 'object') return null;

    // 1. Check explicit structured date fields
    const directDate = doc.date || doc.publishedAt || doc.pubDate || doc.timestamp || doc.published_date || doc.time || doc.datetime;
    if (directDate) {
        if (typeof directDate === 'number' && Number.isFinite(directDate) && directDate > 0) {
            return directDate;
        }
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

    // 2. Check URL path patterns (e.g., /2026/10/11/ or /2026-10-11/)
    const url = String(doc.url || '');
    if (url) {
        const urlDateMatch = url.match(/(?:^|\/)((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:\/|$|\?|\.)/);
        if (urlDateMatch) {
            const parsed = Date.UTC(parseInt(urlDateMatch[1], 10), parseInt(urlDateMatch[2], 10) - 1, parseInt(urlDateMatch[3], 10));
            if (!Number.isNaN(parsed)) return parsed;
        }
    }

    // 3. Check snippet / title / description for leading date patterns (American, UK, ISO & Relative)
    const rawText = `${doc.title || ''} ${doc.description || ''} ${doc.snippet || ''} ${doc.text || ''}`.trim();
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

    // 3a. Explicit Calendar Dates FIRST (American Month DD YYYY, UK DD Month YYYY, ISO, Numeric)
    // American Format: Month DD, YYYY or Month DD (e.g. "October 11, 2026", "Oct 11 2026", "Oct 11")
    let m = rawText.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const mo = MONTH_NAMES_MAP[m[1].toLowerCase().replace('.', '')];
        const day = parseInt(m[2], 10);
        let yr = m[3] ? parseInt(m[3], 10) : currentYear;
        if (!m[3] && mo > currentMonth) yr = currentYear - 1;
        if (mo != null && day >= 1 && day <= 31) return Date.UTC(yr, mo, day);
    }

    // UK / International Format: DD Month YYYY or DD Month (e.g. "11 October 2026", "11th Oct 2026", "11 Oct")
    m = rawText.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const day = parseInt(m[1], 10);
        const mo = MONTH_NAMES_MAP[m[2].toLowerCase().replace('.', '')];
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
        const domainStr = String(doc.domain || doc.url || '').toLowerCase();
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

    // 3b. Relative timestamps (Search snippets: "2 hours ago", "yesterday", "3 days ago")
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
    const snippetText = String(doc.snippet || doc.description || '').replace(KNOWN_TODAY_BRANDS, ' ').replace(CASUAL_TODAY_PHRASES, ' ').trim();
    if (/(?:^|[|•·—–\-\n])\s*(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(sanitizedText) ||
        /(?:^|[|•·—–\-\n])\s*(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(snippetText) ||
        /\b(?:published|updated|posted|date:?|released)\s+(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(sanitizedText) ||
        /\btoday\s*[-—–:•·|]/i.test(sanitizedText)) {
        return now;
    }
    if (/\b(?:yesterday|yesterday's)\b/i.test(sanitizedText)) {
        return now - 24 * 3600 * 1000;
    }

    // 3c. Fallback to URL year if present
    if (url) {
        const urlYearMatch = url.match(/(?:^|\/)((?:19|20)\d\d)(?:\/|$|\?|\.)/);
        if (urlYearMatch) {
            const parsed = Date.parse(`${urlYearMatch[1]}-01-01`);
            if (!Number.isNaN(parsed)) return parsed;
        }
    }

    return null;
}

export function formatDocumentDate(docDateMs, now = Date.now()) {
    if (!docDateMs || Number.isNaN(docDateMs)) return '';
    const diffMs = now - docDateMs;
    const diffHours = Math.round(diffMs / 3600000);
    if (diffHours >= 0 && diffHours < 1) return 'Just now';
    if (diffHours >= 1 && diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    const diffDays = Math.round(diffMs / 86400000);
    if (diffDays === 1) return 'Yesterday';
    if (diffDays > 1 && diffDays <= 6) return `${diffDays} days ago`;
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(docDateMs));
}

/**
 * Computes temporal relevance score (0.0 to 1.0) based on query date intent
 */
export function computeTemporalScore(docDateMs, dateIntent = { type: 'neutral' }, now = Date.now()) {
    if (!docDateMs || Number.isNaN(docDateMs)) {
        if (dateIntent.type === 'immediate') return 0.25;
        if (dateIntent.type === 'recent_week') return 0.35;
        if (dateIntent.type === 'target_month') return 0.25;
        return 0.5;
    }

    if (dateIntent.type === 'target_year' && dateIntent.targetYear) {
        const docYear = new Date(docDateMs).getUTCFullYear();
        const diffYears = Math.abs(docYear - dateIntent.targetYear);
        return Number((1.0 / (1.0 + diffYears * 0.5)).toFixed(3));
    }

    if (dateIntent.type === 'target_month' && dateIntent.targetMonth !== undefined) {
        const docMonth = new Date(docDateMs).getUTCMonth();
        const diffMonths = Math.abs(docMonth - dateIntent.targetMonth);
        return Number((1.0 / (1.0 + diffMonths * 0.8)).toFixed(3));
    }

    const ageDays = Math.max(0, (now - docDateMs) / (1000 * 60 * 60 * 24));

    let halfLifeDays = 365;
    if (dateIntent.type === 'immediate') halfLifeDays = 2;
    else if (dateIntent.type === 'recent_week') halfLifeDays = 6;
    else if (dateIntent.type === 'current') halfLifeDays = 21;

    const decay = Math.exp(-0.693 * (ageDays / halfLifeDays));
    return Number(Math.max(0.02, Math.min(1.0, decay)).toFixed(3));
}

import { computeBM25Scores as computeBM25EngineScores } from './bm25.js';

export function computeBM25Scores(query, documents = []) {
    return computeBM25EngineScores(query, documents, { filterStopWords: false });
}

export async function hybridRerank(query, documents = [], options = {}) {
    const list = Array.isArray(documents) ? documents : [];
    if (!list.length) return [];

    const queryText = String(query || '').trim();
    const dateIntent = options.dateIntent || extractQueryDateIntent(queryText);
    const now = options.now || Date.now();

    // 1. Compute BM25 Lexical Ranking
    const bm25Scores = computeBM25Scores(queryText, list);
    const bm25Ranked = list
        .map((doc, index) => ({ doc, score: bm25Scores[index] || 0, origIndex: index }))
        .sort((a, b) => b.score - a.score);

    const bm25RankMap = new Map();
    bm25Ranked.forEach((item, rank) => {
        bm25RankMap.set(item.origIndex, rank + 1);
    });

    // 2. Parse Document Dates & Compute Temporal Scores & Temporal Ranking
    const parsedDates = list.map(doc => parseDocumentDate(doc, now));
    const temporalScores = list.map((doc, index) => {
        return computeTemporalScore(parsedDates[index], dateIntent, now);
    });

    const temporalRanked = list
        .map((doc, index) => ({ doc, score: temporalScores[index] || 0.5, origIndex: index }))
        .sort((a, b) => b.score - a.score);

    const temporalRankMap = new Map();
    temporalRanked.forEach((item, rank) => {
        temporalRankMap.set(item.origIndex, rank + 1);
    });

    // 3. Compute Semantic Embedding Ranking (if enabled/available)
    let semanticRankMap = new Map();
    if (hasNvidiaEmbeddingKey() && options.skipEmbedding !== true) {
        try {
            const embedResult = await rankTextsByEmbedding(queryText, list, options);
            if (embedResult.available && Array.isArray(embedResult.ranked)) {
                embedResult.ranked.forEach((doc, rank) => {
                    const origIndex = list.findIndex(d => d === doc || d.url === doc.url);
                    if (origIndex >= 0) semanticRankMap.set(origIndex, rank + 1);
                });
            }
        } catch (_) {
            // Degrade to BM25 if embedding service fails
        }
    }

    // 4. Reciprocal Rank Fusion (RRF) with Temporal + Domain Trust Balancing
    const hasSemanticRank = semanticRankMap.size > 0;
    const temporalWeight = Math.max(0.3, Math.min(1.5, (dateIntent.weight || 0.5) * 1.2));

    // Pre-compute domain trust tier metadata for each document (O(n), <0.05ms)
    const domainTrustMeta = list.map(doc => {
        const rawDomain = String(doc?.domain || '');
        let hostname = rawDomain;
        if (!hostname) {
            try { hostname = new URL(String(doc?.url || '')).hostname; } catch (_) {}
        }
        return classifyDomainTrustTier(normaliseDomain(hostname), String(doc?.url || ''));
    });

    // Normalise trust delta to RRF scale:
    // RRF scores are typically 0.007–0.016 for ~60 docs.
    // We map delta (−35..+35) so max trust contribution ≈ one rank position.
    const TRUST_SCALE = 1 / (35 * RRF_K * 20);

    const fused = list.map((doc, index) => {
        const bm25Rank = bm25RankMap.get(index) || list.length;
        const semanticRank = hasSemanticRank ? (semanticRankMap.get(index) || list.length) : bm25Rank;
        const temporalRank = temporalRankMap.get(index) || list.length;
        const tScore = temporalScores[index] ?? 0.5;
        const trustMeta = domainTrustMeta[index];

        // Base reciprocal rank across lexical + dense
        const baseRrfScore = hasSemanticRank
            ? (1 / (RRF_K + bm25Rank)) + (1 / (RRF_K + semanticRank))
            : (1 / (RRF_K + bm25Rank));

        // Temporal rank contribution
        const temporalRrf = (temporalWeight / (RRF_K + temporalRank));

        // Domain trust additive term (+ve for T1/T2, −ve for T4, 0 for T3)
        const trustRrf = trustMeta.delta * TRUST_SCALE;

        // Multiplicative temporal scale (boosts relevant dates, softens stale dates)
        const temporalMultiplier = Math.max(0.3, 1.0 + (temporalWeight * (tScore - 0.5)));
        const totalRrfScore = (baseRrfScore + temporalRrf + trustRrf) * temporalMultiplier;

        const docDate = parsedDates[index];
        return {
            ...doc,
            bm25Score: bm25Scores[index] || 0,
            temporalScore: tScore,
            publishedMs: docDate || doc.publishedMs || 0,
            date: doc.date || (docDate ? formatDocumentDate(docDate, now) : ''),
            domainTrustTier: trustMeta.tier,
            domainTrustSignals: trustMeta.signals,
            rrfScore: totalRrfScore
        };
    });

    // Determine if query warrants strict chronological ordering
    const isHistorical = Boolean(
        (dateIntent && dateIntent.type === 'target_year' && dateIntent.targetYear && dateIntent.targetYear < new Date(now).getUTCFullYear()) ||
        /\b(?:history\s+of|origin\s+of|founded\s+in|invented\s+by|built\s+in|born\s+in|died\s+in|ancient|historical(?:ly)?|back\s+in\s+\d{4})\b/i.test(queryText)
    );

    const isChronological = Boolean(
        options.chronological === true ||
        options.forceChronological === true ||
        options.liveMode === true ||
        options.forceLive === true ||
        (!isHistorical && (
            (dateIntent && (dateIntent.type === 'immediate' || dateIntent.type === 'recent_week' || dateIntent.type === 'current' || dateIntent.type === 'target_month')) ||
            /\b(?:today|tonight|yesterday|yesterday's|today's|latest|current|recently|recent|breaking|newest|what('?s|\s+is)\s+new|updates?|hours?\s+ago|days?\s+ago|past\s+24\s+hours?|past\s+48\s+hours?|this\s+week|past\s+week|last\s+week|this\s+month|past\s+month|this\s+year|news|rate\s+cut|inflation|stocks?|markets?|ceasefire|war|election)\b/i.test(queryText) ||
            fused.some(f => f.publishedMs && (now - f.publishedMs) < 30 * 24 * 3600 * 1000)
        ))
    );

    if (isChronological) {
        if (dateIntent && dateIntent.type === 'target_month' && dateIntent.targetMonth !== undefined) {
            fused.sort((a, b) => {
                const moA = a.publishedMs ? new Date(a.publishedMs).getUTCMonth() : null;
                const moB = b.publishedMs ? new Date(b.publishedMs).getUTCMonth() : null;
                if (moA != null && moB != null) {
                    const diffA = Math.abs(moA - dateIntent.targetMonth);
                    const diffB = Math.abs(moB - dateIntent.targetMonth);
                    if (diffA !== diffB) return diffA - diffB;
                    return b.rrfScore - a.rrfScore;
                }
                if (moA != null && moB == null) return -1;
                if (moA == null && moB != null) return 1;
                return b.rrfScore - a.rrfScore;
            });
        } else {
            // Strict Chronological Ordering: newest published date first at #1 descending
            const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;
            fused.sort((a, b) => {
                const timeA = a.publishedMs || 0;
                const timeB = b.publishedMs || 0;
                const aSubstantive = Boolean(a.fullArticleText && a.fullArticleText.length >= 80);
                const bSubstantive = Boolean(b.fullArticleText && b.fullArticleText.length >= 80);
                if (aSubstantive !== bSubstantive) {
                    return bSubstantive ? 1 : -1;
                }
                if (timeA && timeB) {
                    const isSameWindow = Math.abs(timeA - timeB) < 7 * 24 * 3600 * 1000;
                    const rrfRatio = a.rrfScore > 0 && b.rrfScore > 0 ? (b.rrfScore / a.rrfScore) : 1;
                    if (isSameWindow && (rrfRatio >= 1.25 || rrfRatio <= 0.8)) {
                        return b.rrfScore - a.rrfScore;
                    }
                    if (timeA !== timeB) return timeB - timeA;
                    return b.rrfScore - a.rrfScore;
                }
                if (timeA && !timeB) {
                    const isRecentA = (now - timeA) < NINETY_DAYS_MS;
                    if (isRecentA) return -1;
                    return b.rrfScore - a.rrfScore;
                }
                if (!timeA && timeB) {
                    const isRecentB = (now - timeB) < NINETY_DAYS_MS;
                    if (isRecentB) return 1;
                    return b.rrfScore - a.rrfScore;
                }
                return b.rrfScore - a.rrfScore;
            });
        }
    } else {
        fused.sort((a, b) => b.rrfScore - a.rrfScore);
    }

    // 5. Cross-Encoder Rerank if enabled (NVIDIA NIM)
    if (fused.length > 1 && isNvidiaRerankEnabled() && options.useRerank !== false) {
        try {
            const topCandidates = fused.slice(0, Math.min(12, fused.length));
            const reranked = await rerankTexts(queryText, topCandidates, options);
            if (reranked.available && Array.isArray(reranked.ranked)) {
                const candidatePool = [...reranked.ranked, ...fused.slice(topCandidates.length)];
                if (isChronological) {
                    // Re-enforce strict chronological ordering invariant so cross-encoder does not promote stale dates
                    const NINETY_DAYS_MS = 90 * 24 * 3600 * 1000;
                    candidatePool.sort((a, b) => {
                        const timeA = a.publishedMs || 0;
                        const timeB = b.publishedMs || 0;
                        if (timeA && timeB) {
                            if (timeA !== timeB) return timeB - timeA;
                            return (b.score ?? b.rrfScore ?? 0) - (a.score ?? a.rrfScore ?? 0);
                        }
                        if (timeA && !timeB) {
                            const isRecentA = (now - timeA) < NINETY_DAYS_MS;
                            return isRecentA ? -1 : 1;
                        }
                        if (!timeA && timeB) {
                            const isRecentB = (now - timeB) < NINETY_DAYS_MS;
                            return isRecentB ? 1 : -1;
                        }
                        return (b.score ?? b.rrfScore ?? 0) - (a.score ?? a.rrfScore ?? 0);
                    });
                }
                return candidatePool;
            }
        } catch (_) {
            // Keep RRF ranking if cross-encoder fails
        }
    }

    return fused;
}

