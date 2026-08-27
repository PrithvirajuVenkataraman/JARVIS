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

export function semanticSearchConversations(conversations = [], query = '', topK = 10, threshold = 0.15) {
    const list = Array.isArray(conversations) ? conversations : [];
    const q = String(query || '').trim();
    if (!q || !list.length) return list;

    const queryVec = textToEmbeddingVector(q);
    return list
        .map(conv => {
            const title = String(conv?.title || '');
            const msgs = Array.isArray(conv?.messages)
                ? conv.messages.map(m => m?.text || m?.content || '').join(' ')
                : '';
            const fullText = `${title} ${msgs}`.trim();
            const docVec = textToEmbeddingVector(fullText);
            const score = vectorCosineSimilarity(queryVec, docVec);
            const exactSubMatch = fullText.toLowerCase().includes(q.toLowerCase());
            return {
                conversation: conv,
                score: exactSubMatch ? Math.max(score, 0.75) : score
            };
        })
        .filter(item => item.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(item => item.conversation);
}

export function semanticSearchBookmarks(bookmarks = [], query = '', topK = 10, threshold = 0.15) {
    const list = Array.isArray(bookmarks) ? bookmarks : [];
    const q = String(query || '').trim();
    if (!q || !list.length) return list;

    const queryVec = textToEmbeddingVector(q);
    return list
        .map(bm => {
            const text = String(bm?.text || bm?.content || '');
            const title = String(bm?.title || '');
            const fullText = `${title} ${text}`.trim();
            const docVec = textToEmbeddingVector(fullText);
            const score = vectorCosineSimilarity(queryVec, docVec);
            const exactSubMatch = fullText.toLowerCase().includes(q.toLowerCase());
            return {
                bookmark: bm,
                score: exactSubMatch ? Math.max(score, 0.75) : score
            };
        })
        .filter(item => item.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK)
        .map(item => item.bookmark);
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
