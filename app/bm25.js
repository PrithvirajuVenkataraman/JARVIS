/**
 * @file app/bm25.js
 * @description Production Enterprise BM25 (Best Matching 25) Information Retrieval Engine for Client-Side ESM.
 * 
 * Implements standard Okapi BM25 ranking function:
 *   Score(D, Q) = sum_{t in Q} IDF(t) * (f(t, D) * (k1 + 1)) / (f(t, D) + k1 * (1 - b + b * (|D| / avgdl)))
 * 
 * Features:
 * - Lucene-compatible IDF with Laplace smoothing: ln(1 + (N - df + 0.5) / (df + 0.5))
 * - Configurable k1 (term saturation, default 1.2) and b (field length normalization, default 0.75)
 * - Automatic syntax stop-word stripping to filter non-discriminative interrogatives (what, where, why, how, who)
 * - Zero external dependencies, pure ES module, sub-millisecond execution.
 */

// Language-agnostic IR stop-words set (kept as empty Set for API backwards compatibility)
export const DEFAULT_SYNTAX_STOP_WORDS = new Set();

/**
 * Enterprise Language-Agnostic Tokenization
 * Normalizes Unicode, removes non-alphanumeric punctuation, and extracts word tokens.
 * Common/structural words are naturally attenuated by mathematical IDF rather than static word lists.
 * @param {string} text - Input raw text
 * @param {Object} [options] - Options
 * @param {number} [options.minTokenLength=2] - Minimum token length
 * @param {Set<string>} [options.stopWords] - Optional caller-supplied stop words set
 * @returns {string[]} Normalized tokens
 */
export function tokenizeText(text = '', options = {}) {
    const minLen = typeof options.minTokenLength === 'number' ? options.minTokenLength : 2;
    const raw = String(text || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ');
    const matches = raw.match(/[\p{L}\p{N}]+/gu) || [];
    
    if (options.stopWords instanceof Set && options.stopWords.size > 0) {
        return matches.filter(match => match.length >= minLen && !options.stopWords.has(match));
    }
    return matches.filter(match => match.length >= minLen);
}

/**
 * Client-side BM25 In-Memory Index
 */
export class BM25Index {
    constructor(options = {}) {
        this.k1 = typeof options.k1 === 'number' ? options.k1 : 1.2;
        this.b = typeof options.b === 'number' ? options.b : 0.75;
        // Dynamic statistical threshold: terms appearing across >= maxDocFreqRatio (default 90%)
        // of documents in the index are statistically ubiquitous and receive zero IDF.
        this.maxDocFreqRatio = typeof options.maxDocFreqRatio === 'number' ? options.maxDocFreqRatio : 0.90;
        this.minDocCountForRatio = typeof options.minDocCountForRatio === 'number' ? options.minDocCountForRatio : 5;
        this.stopWords = options.stopWords instanceof Set ? options.stopWords : null;
        
        this.documents = [];
        this.docLengths = [];
        this.totalDocLength = 0;
        this.avgDocLength = 0;
        
        this.invertedIndex = new Map();
        this.docFreqs = new Map();
        this.idfCache = new Map();
    }

    tokenize(text) {
        return tokenizeText(text, {
            stopWords: this.stopWords
        });
    }

    addDocument(id, text, metadata = {}) {
        const docIndex = this.documents.length;
        const tokens = this.tokenize(text);
        
        const termFreqs = new Map();
        for (const token of tokens) {
            termFreqs.set(token, (termFreqs.get(token) || 0) + 1);
        }

        this.documents.push({ id, text, metadata, index: docIndex });
        this.docLengths.push(tokens.length);
        this.totalDocLength += tokens.length;
        this.avgDocLength = this.totalDocLength / Math.max(1, this.documents.length);

        for (const [term, freq] of termFreqs.entries()) {
            if (!this.invertedIndex.has(term)) {
                this.invertedIndex.set(term, new Map());
                this.docFreqs.set(term, 0);
            }
            this.invertedIndex.get(term).set(docIndex, freq);
            this.docFreqs.set(term, this.docFreqs.get(term) + 1);
        }

        this.idfCache.clear();
        return docIndex;
    }

    getIdf(term) {
        if (this.idfCache.has(term)) return this.idfCache.get(term);
        const df = this.docFreqs.get(term) || 0;
        const n = this.documents.length;
        if (n === 0 || df === 0) {
            this.idfCache.set(term, 0);
            return 0;
        }
        // Statistically ubiquitous terms across the corpus receive 0 IDF (dynamic stop-term dampening)
        if (n >= this.minDocCountForRatio && (df / n) >= this.maxDocFreqRatio) {
            this.idfCache.set(term, 0);
            return 0;
        }
        const idf = Math.max(0, Math.log(1 + (n - df + 0.5) / (df + 0.5)));
        this.idfCache.set(term, idf);
        return idf;
    }

    search(query, options = {}) {
        const topK = options.topK || 10;
        const minScore = typeof options.minScore === 'number' ? options.minScore : 0.001;
        const queryTokens = this.tokenize(query);

        if (!queryTokens.length || !this.documents.length) return [];

        const scores = new Float32Array(this.documents.length);
        const k1 = this.k1;
        const b = this.b;
        const avgdl = Math.max(1, this.avgDocLength);

        for (const term of queryTokens) {
            const postings = this.invertedIndex.get(term);
            if (!postings) continue;
            const idf = this.getIdf(term);
            if (idf <= 0) continue;

            for (const [docIndex, tf] of postings.entries()) {
                const docLength = this.docLengths[docIndex];
                const num = tf * (k1 + 1);
                const denom = tf + k1 * (1 - b + b * (docLength / avgdl));
                scores[docIndex] += idf * (num / Math.max(0.001, denom));
            }
        }

        const ranked = [];
        for (let i = 0; i < scores.length; i++) {
            if (scores[i] >= minScore) {
                ranked.push({
                    doc: this.documents[i],
                    score: Number(scores[i].toFixed(4)),
                    index: i
                });
            }
        }

        return ranked.sort((a, b) => b.score - a.score).slice(0, topK);
    }

    scoreAll(query) {
        const queryTokens = this.tokenize(query);
        if (!queryTokens.length || !this.documents.length) {
            return this.documents.map(() => 0);
        }

        const scores = new Float32Array(this.documents.length);
        const k1 = this.k1;
        const b = this.b;
        const avgdl = Math.max(1, this.avgDocLength);

        for (const term of queryTokens) {
            const postings = this.invertedIndex.get(term);
            if (!postings) continue;
            const idf = this.getIdf(term);
            if (idf <= 0) continue;

            for (const [docIndex, tf] of postings.entries()) {
                const docLength = this.docLengths[docIndex];
                const num = tf * (k1 + 1);
                const denom = tf + k1 * (1 - b + b * (docLength / avgdl));
                scores[docIndex] += idf * (num / Math.max(0.001, denom));
            }
        }

        const out = new Array(scores.length);
        for (let i = 0; i < scores.length; i++) {
            out[i] = Number(scores[i].toFixed(4));
        }
        return out;
    }
}

export function computeBM25Scores(query, documents = [], options = {}) {
    const list = Array.isArray(documents) ? documents : [];
    if (!list.length) return [];

    const index = new BM25Index(options);
    for (let i = 0; i < list.length; i++) {
        const doc = list[i];
        const text = typeof doc === 'string'
            ? doc
            : `${doc.title || ''} ${doc.description || ''} ${doc.text || ''} ${doc.fullArticleText || ''}`;
        index.addDocument(i, text, doc);
    }

    return index.scoreAll(query);
}
