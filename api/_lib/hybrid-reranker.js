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

    // 3. General Recency / Current updates
    if (/\b(?:latest|current|recently|recent|breaking|newest|what('?s|\s+is)\s+new|updates?|this\s+month|news|active|present)\b/.test(raw)) {
        return { type: 'current', weight: 1.2 };
    }

    // Check for leadership or status queries which implicitly require current facts
    if (/\b(?:who\s+is\s+the|what\s+is\s+the\s+current|ceo\s+of|president\s+of|prime\s+minister\s+of|cm\s+of|governor\s+of|price\s+of|weather\s+in)\b/.test(raw)) {
        return { type: 'current', weight: 0.8 };
    }

    return { type: 'neutral', weight: 0.3 };
}

/**
 * Robustly parses publication/update timestamp from document metadata, URL paths, or snippets
 * Supports ISO, US formats (Month DD, YYYY & MM/DD/YYYY), UK formats (DD Month YYYY & DD/MM/YYYY), and relative times.
 */
export function parseDocumentDate(doc = {}, now = Date.now()) {
    if (!doc || typeof doc !== 'object') return null;

    // 1. Check explicit structured date fields
    const directDate = doc.date || doc.publishedAt || doc.pubDate || doc.timestamp || doc.startDate || doc.endDate || doc.time || doc.datetime;
    if (directDate) {
        if (typeof directDate === 'number' && Number.isFinite(directDate) && directDate > 0) {
            return directDate;
        }
        const parsed = Date.parse(directDate);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }

    // 2. Check URL path patterns (e.g., /2026/10/11/ or /2026-10-11/)
    const url = String(doc.url || '');
    if (url) {
        const urlDateMatch = url.match(/(?:^|\/)((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])(?:\/|$|\?|\.)/);
        if (urlDateMatch) {
            const parsed = Date.parse(`${urlDateMatch[1]}-${urlDateMatch[2].padStart(2, '0')}-${urlDateMatch[3].padStart(2, '0')}`);
            if (!Number.isNaN(parsed)) return parsed;
        }
        const urlYearMatch = url.match(/(?:^|\/)((?:19|20)\d\d)(?:\/|$|\?|\.)/);
        if (urlYearMatch) {
            const parsed = Date.parse(`${urlYearMatch[1]}-01-01`);
            if (!Number.isNaN(parsed)) return parsed;
        }
    }

    // 3. Check snippet / title / description for leading date patterns (American, UK, ISO & Relative)
    const text = `${doc.title || ''} ${doc.description || ''} ${doc.snippet || ''} ${doc.text || ''}`.trim();
    if (!text) return null;

    const currentYear = new Date(now).getUTCFullYear();

    // 3a. Relative timestamps (Search snippets: "2 hours ago", "yesterday", "3 days ago")
    let m = text.match(/\b(\d+)\s*(?:seconds?|secs?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 1000;
    m = text.match(/\b(\d+)\s*(?:minutes?|mins?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 60 * 1000;
    m = text.match(/\b(\d+)\s*(?:hours?|hrs?)\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 3600 * 1000;
    if (/\b(?:just\s+now|moments?\s+ago|right\s+now|today)\b/i.test(text)) return now;
    if (/\b(?:yesterday|yesterday's)\b/i.test(text)) return now - 24 * 3600 * 1000;
    m = text.match(/\b(\d+)\s*days?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 24 * 3600 * 1000;
    m = text.match(/\b(\d+)\s*weeks?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 7 * 24 * 3600 * 1000;
    m = text.match(/\b(\d+)\s*months?\s*ago\b/i);
    if (m) return now - parseInt(m[1], 10) * 30 * 24 * 3600 * 1000;

    // 3b. American Format: Month DD, YYYY or Month DD (e.g. "October 11, 2026", "Oct 11 2026", "Oct 11")
    m = text.match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const mo = MONTH_NAMES_MAP[m[1].toLowerCase().replace('.', '')];
        const day = parseInt(m[2], 10);
        const yr = m[3] ? parseInt(m[3], 10) : currentYear;
        if (mo != null && day >= 1 && day <= 31) return Date.UTC(yr, mo, day);
    }

    // 3c. UK / International Format: DD Month YYYY or DD Month (e.g. "11 October 2026", "11th Oct 2026", "11 Oct")
    m = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?(?:,?\s+((?:19|20)\d\d))?\b/i);
    if (m) {
        const day = parseInt(m[1], 10);
        const mo = MONTH_NAMES_MAP[m[2].toLowerCase().replace('.', '')];
        const yr = m[3] ? parseInt(m[3], 10) : currentYear;
        if (mo != null && day >= 1 && day <= 31) return Date.UTC(yr, mo, day);
    }

    // 3d. ISO Format: YYYY-MM-DD or YYYY/MM/DD
    m = text.match(/\b((?:19|20)\d\d)[/-](0?[1-9]|1[0-2])[/-](0?[1-9]|[12]\d|3[01])\b/);
    if (m) {
        return Date.UTC(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }

    // 3e. Numeric US & UK Formats: MM/DD/YYYY or DD/MM/YYYY
    m = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-]((?:19|20)\d\d)\b/);
    if (m) {
        const n1 = parseInt(m[1], 10);
        const n2 = parseInt(m[2], 10);
        const yr = parseInt(m[3], 10);
        if (n1 > 12 && n2 <= 12) {
            // Unambiguous UK: DD/MM/YYYY
            return Date.UTC(yr, n2 - 1, n1);
        } else if (n2 > 12 && n1 <= 12) {
            // Unambiguous US: MM/DD/YYYY
            return Date.UTC(yr, n1 - 1, n2);
        } else if (n1 <= 12 && n2 <= 31) {
            // Default to US MM/DD/YYYY
            return Date.UTC(yr, n1 - 1, n2);
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
        return 0.5;
    }

    if (dateIntent.type === 'target_year' && dateIntent.targetYear) {
        const docYear = new Date(docDateMs).getUTCFullYear();
        const diffYears = Math.abs(docYear - dateIntent.targetYear);
        return Number((1.0 / (1.0 + diffYears * 0.5)).toFixed(3));
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

    // 2. Compute Temporal Scores & Temporal Ranking
    const temporalScores = list.map(doc => {
        const docDateMs = parseDocumentDate(doc);
        return computeTemporalScore(docDateMs, dateIntent, now);
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

        return {
            ...doc,
            bm25Score: bm25Scores[index] || 0,
            temporalScore: tScore,
            domainTrustTier: trustMeta.tier,
            domainTrustSignals: trustMeta.signals,
            rrfScore: totalRrfScore
        };
    });

    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    // 5. Cross-Encoder Rerank if enabled (NVIDIA NIM)
    if (fused.length > 1 && isNvidiaRerankEnabled() && options.useRerank !== false) {
        try {
            const topCandidates = fused.slice(0, Math.min(12, fused.length));
            const reranked = await rerankTexts(queryText, topCandidates, options);
            if (reranked.available && Array.isArray(reranked.ranked)) {
                const rest = fused.slice(topCandidates.length);
                return [...reranked.ranked, ...rest];
            }
        } catch (_) {
            // Keep RRF ranking if cross-encoder fails
        }
    }

    return fused;
}

