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

    // Check for explicit recency / current intent
    if (/\b(?:latest|current|recently|recent|today|now|live|breaking|newest|this\s+year|present|active)\b/.test(raw)) {
        return { type: 'current', weight: 1.0 };
    }

    // Check for leadership or status queries which implicitly require current facts
    if (/\b(?:who\s+is\s+the|what\s+is\s+the\s+current|ceo\s+of|president\s+of|prime\s+minister\s+of|cm\s+of|governor\s+of|price\s+of|weather\s+in)\b/.test(raw)) {
        return { type: 'current', weight: 0.7 };
    }

    return { type: 'neutral', weight: 0.3 };
}

/**
 * Robustly parses publication/update timestamp from document metadata, URL paths, or snippets
 */
export function parseDocumentDate(doc = {}) {
    if (!doc || typeof doc !== 'object') return null;

    // 1. Check explicit structured date fields
    const directDate = doc.date || doc.publishedAt || doc.pubDate || doc.timestamp || doc.startDate || doc.endDate;
    if (directDate) {
        const parsed = Date.parse(directDate);
        if (!Number.isNaN(parsed) && parsed > 0) return parsed;
    }

    // 2. Check URL path patterns (e.g., /2024/08/15/ or /2024-08-15/)
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

    // 3. Check snippet / title / description for leading date patterns
    const text = `${doc.title || ''} ${doc.description || ''} ${doc.text || ''}`;
    const textDateMatch = text.match(/\b((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+(?:19|20)\d\d)\b/i) ||
                          text.match(/\b((?:19|20)\d\d-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01]))\b/);
    if (textDateMatch) {
        const parsed = Date.parse(textDateMatch[1]);
        if (!Number.isNaN(parsed)) return parsed;
    }

    return null;
}

/**
 * Computes temporal relevance score (0.0 to 1.0) based on query date intent
 */
export function computeTemporalScore(docDateMs, dateIntent = { type: 'neutral' }, now = Date.now()) {
    if (!docDateMs || Number.isNaN(docDateMs)) {
        // Unknown dates get neutral baseline score (neither boosted nor heavily penalized)
        return 0.5;
    }

    if (dateIntent.type === 'target_year' && dateIntent.targetYear) {
        const docYear = new Date(docDateMs).getUTCFullYear();
        const diffYears = Math.abs(docYear - dateIntent.targetYear);
        // Exact year = 1.0, 1 year off = 0.67, 2 years off = 0.5, etc.
        return Number((1.0 / (1.0 + diffYears * 0.5)).toFixed(3));
    }

    // For current or neutral queries: Exponential recency decay
    const ageDays = Math.max(0, (now - docDateMs) / (1000 * 60 * 60 * 24));
    
    // Half-life of 180 days for current queries, 365 days for neutral
    const halfLifeDays = dateIntent.type === 'current' ? 180 : 365;
    const decay = Math.exp(-0.693 * (ageDays / halfLifeDays));
    
    // Clamp to 0.05 min so older high-relevance docs aren't zeroed out
    return Number(Math.max(0.05, Math.min(1.0, decay)).toFixed(3));
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

