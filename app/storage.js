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
 * Approximate Nearest Neighbor (ANN) Partitioned Inverted File (IVF) Vector Index.
 * Clusters dense 512-dimensional vectors into K centroids and prunes searches to the top-N closest candidate buckets.
 */
export class PartitionedIVFIndex {
    constructor(options = {}) {
        this.numClusters = Math.max(2, Math.min(64, Number(options.numClusters) || 8));
        this.nProbe = Math.max(1, Math.min(this.numClusters, Number(options.nProbe) || 2));
        this.dim = Number(options.dim) || 512;
        this.centroids = [];
        this.buckets = [];
        this.totalItems = 0;
        this.itemsSinceRebalance = 0;
        this._initClusters();
    }

    _initClusters() {
        this.centroids = [];
        this.buckets = [];
        for (let i = 0; i < this.numClusters; i++) {
            const v = new Float32Array(this.dim);
            let norm = 0;
            for (let j = 0; j < this.dim; j++) {
                const seed = (i + 1) * 31 + (j + 1) * 17;
                v[j] = Math.sin(seed);
                norm += v[j] * v[j];
            }
            norm = Math.sqrt(norm);
            if (norm > 0) {
                for (let j = 0; j < this.dim; j++) v[j] /= norm;
            }
            this.centroids.push(v);
            this.buckets.push([]);
        }
    }

    add(item, text) {
        const textStr = String(text || '').trim();
        const vector = textToEmbeddingVector(textStr, this.dim);
        const clusterIdx = this._findNearestCentroid(vector);
        const entry = { item, vector, text: textStr, id: `entry_${this.totalItems++}` };
        this.buckets[clusterIdx].push(entry);
        this.itemsSinceRebalance++;
        if (this.itemsSinceRebalance >= 50 && this.totalItems >= this.numClusters * 3) {
            this.rebalance();
        }
        return entry;
    }

    _findNearestCentroid(vector) {
        let bestIdx = 0;
        let bestSim = -Infinity;
        for (let i = 0; i < this.centroids.length; i++) {
            const sim = vectorCosineSimilarity(vector, this.centroids[i]);
            if (sim > bestSim) {
                bestSim = sim;
                bestIdx = i;
            }
        }
        return bestIdx;
    }

    _findTopCentroids(vector, nProbe = this.nProbe) {
        const scores = this.centroids.map((c, idx) => ({
            idx,
            score: vectorCosineSimilarity(vector, c)
        }));
        scores.sort((a, b) => b.score - a.score);
        return scores.slice(0, nProbe).map(s => s.idx);
    }

    search(query, topK = 10, threshold = 0.15) {
        const q = String(query || '').trim();
        if (!q || this.totalItems === 0) return [];
        const queryVec = textToEmbeddingVector(q, this.dim);

        // ANN pruning: query top-N closest cluster centroids
        const probeIndices = this._findTopCentroids(queryVec, this.nProbe);
        const candidates = [];

        for (const cIdx of probeIndices) {
            const bucket = this.buckets[cIdx] || [];
            for (const entry of bucket) {
                const sim = vectorCosineSimilarity(queryVec, entry.vector);
                const subMatch = entry.text.toLowerCase().includes(q.toLowerCase());
                const finalScore = subMatch ? Math.max(sim, 0.75) : sim;
                if (finalScore >= threshold) {
                    candidates.push({ item: entry.item, score: finalScore, text: entry.text });
                }
            }
        }

        candidates.sort((a, b) => b.score - a.score);
        return candidates.slice(0, topK);
    }

    rebalance() {
        const allEntries = this.buckets.flat();
        if (allEntries.length < this.numClusters) return;

        const newCentroids = [];
        for (let k = 0; k < this.numClusters; k++) {
            const seedEntry = allEntries[Math.floor((k * allEntries.length) / this.numClusters)];
            newCentroids.push(new Float32Array(seedEntry.vector));
        }

        const newBuckets = Array.from({ length: this.numClusters }, () => []);

        for (const entry of allEntries) {
            let bestIdx = 0;
            let bestSim = -Infinity;
            for (let k = 0; k < newCentroids.length; k++) {
                const sim = vectorCosineSimilarity(entry.vector, newCentroids[k]);
                if (sim > bestSim) {
                    bestSim = sim;
                    bestIdx = k;
                }
            }
            newBuckets[bestIdx].push(entry);
        }

        for (let k = 0; k < this.numClusters; k++) {
            const bucket = newBuckets[k];
            if (bucket.length > 0) {
                const mean = new Float32Array(this.dim);
                for (const e of bucket) {
                    for (let j = 0; j < this.dim; j++) mean[j] += e.vector[j];
                }
                let norm = 0;
                for (let j = 0; j < this.dim; j++) norm += mean[j] * mean[j];
                norm = Math.sqrt(norm);
                if (norm > 0) {
                    for (let j = 0; j < this.dim; j++) mean[j] /= norm;
                    newCentroids[k] = mean;
                }
            }
        }

        this.centroids = newCentroids;
        this.buckets = newBuckets;
        this.itemsSinceRebalance = 0;
    }
}

export function semanticSearchConversations(conversations = [], query = '', topK = 10, threshold = 0.15) {
    const list = Array.isArray(conversations) ? conversations : [];
    const q = String(query || '').trim();
    if (!q || !list.length) return list;

    // Use ANN Partitioned IVF Index for retrieval
    const index = new PartitionedIVFIndex({ numClusters: Math.min(8, Math.max(2, Math.floor(list.length / 4))), nProbe: 2 });
    for (const conv of list) {
        const title = String(conv?.title || '');
        const msgs = Array.isArray(conv?.messages)
            ? conv.messages.map(m => m?.text || m?.content || '').join(' ')
            : '';
        const fullText = `${title} ${msgs}`.trim();
        index.add(conv, fullText);
    }

    const results = index.search(q, topK, threshold);
    return results.map(r => r.item);
}

export function semanticSearchBookmarks(bookmarks = [], query = '', topK = 10, threshold = 0.15) {
    const list = Array.isArray(bookmarks) ? bookmarks : [];
    const q = String(query || '').trim();
    if (!q || !list.length) return list;

    // Use ANN Partitioned IVF Index for retrieval
    const index = new PartitionedIVFIndex({ numClusters: Math.min(8, Math.max(2, Math.floor(list.length / 4))), nProbe: 2 });
    for (const bm of list) {
        const text = String(bm?.text || bm?.content || '');
        const title = String(bm?.title || '');
        const fullText = `${title} ${text}`.trim();
        index.add(bm, fullText);
    }

    const results = index.search(q, topK, threshold);
    return results.map(r => r.item);
}

export function createSafeStorage(storage = globalThis.localStorage) {
    return {
        getJson(key, fallback = null) {
            try {
                const value = storage?.getItem?.(key);
                return value == null ? fallback : JSON.parse(value);
            } catch {
                return fallback;
            }
        },
        setJson(key, value) {
            try {
                storage?.setItem?.(key, JSON.stringify(value));
                return true;
            } catch {
                return false;
            }
        },
        remove(key) {
            try {
                storage?.removeItem?.(key);
                return true;
            } catch {
                return false;
            }
        }
    };
}
