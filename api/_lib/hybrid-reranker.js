/**
 * In-Process Hybrid Reranker (BM25 + Semantic + Reciprocal Rank Fusion)
 * - Computes lexical BM25 relevance scores in-process (0ms network overhead)
 * - Merges lexical rankings and dense semantic embeddings using Reciprocal Rank Fusion (RRF)
 * - Enhances with NVIDIA cross-encoder ranking when configured
 */

import { rankTextsByEmbedding, rerankTexts, hasNvidiaEmbeddingKey, isNvidiaRerankEnabled } from './embeddings.js';

const RRF_K = 60; // Standard reciprocal rank fusion damping factor
const BM25_K1 = 1.2;
const BM25_B = 0.75;

export function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
}

export function computeBM25Scores(query, documents = []) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length || !documents.length) {
        return documents.map(() => 0);
    }

    const docTokenLists = documents.map(doc => {
        const text = `${doc.title || ''} ${doc.description || ''} ${doc.text || ''} ${doc.fullArticleText || ''}`;
        return String(text).toLowerCase().match(/[a-z0-9]{2,}/g) || [];
    });

    const totalDocs = documents.length;
    const avgDocLength = docTokenLists.reduce((sum, list) => sum + list.length, 0) / Math.max(1, totalDocs);

    // Compute Document Frequency (DF) for each query token
    const docFreqs = {};
    for (const token of queryTokens) {
        let count = 0;
        for (const list of docTokenLists) {
            if (list.includes(token)) count += 1;
        }
        docFreqs[token] = count;
    }

    return docTokenLists.map(list => {
        const docLength = list.length;
        const termFreqs = {};
        for (const token of list) {
            termFreqs[token] = (termFreqs[token] || 0) + 1;
        }

        let score = 0;
        for (const token of queryTokens) {
            const tf = termFreqs[token] || 0;
            const df = docFreqs[token] || 0;
            const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
            const num = tf * (BM25_K1 + 1);
            const denom = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / Math.max(1, avgDocLength)));
            score += idf * (num / Math.max(0.001, denom));
        }
        return Number.isFinite(score) ? score : 0;
    });
}

export async function hybridRerank(query, documents = [], options = {}) {
    const list = Array.isArray(documents) ? documents : [];
    if (!list.length) return [];
    if (list.length === 1) return list;

    const queryText = String(query || '').trim();

    // 1. Compute BM25 Lexical Ranking
    const bm25Scores = computeBM25Scores(queryText, list);
    const bm25Ranked = list
        .map((doc, index) => ({ doc, score: bm25Scores[index] || 0, origIndex: index }))
        .sort((a, b) => b.score - a.score);

    const bm25RankMap = new Map();
    bm25Ranked.forEach((item, rank) => {
        bm25RankMap.set(item.origIndex, rank + 1);
    });

    // 2. Compute Semantic Embedding Ranking (if enabled/available)
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

    // 3. Reciprocal Rank Fusion (RRF)
    const fused = list.map((doc, index) => {
        const bm25Rank = bm25RankMap.get(index) || list.length;
        const semanticRank = semanticRankMap.get(index) || bm25Rank;

        const rrfScore = (1 / (RRF_K + bm25Rank)) + (1 / (RRF_K + semanticRank));
        return {
            ...doc,
            bm25Score: bm25Scores[index] || 0,
            rrfScore
        };
    });

    fused.sort((a, b) => b.rrfScore - a.rrfScore);

    // 4. Cross-Encoder Rerank if enabled (NVIDIA NIM)
    if (isNvidiaRerankEnabled() && options.useRerank !== false) {
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
