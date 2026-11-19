const NVIDIA_EMBEDDINGS_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const NVIDIA_RERANK_URL = 'https://integrate.api.nvidia.com/v1/ranking';
const DEFAULT_NVIDIA_EMBEDDING_MODEL = 'nvidia/nv-embedcode-7b-v1';
const DEFAULT_NVIDIA_RERANK_MODEL = 'nvidia/llama-3.2-nv-rerankqa-1b-v2';
const EMBEDDING_TIMEOUT_MS = 8000;
const RERANK_TIMEOUT_MS = 10000;

export function hasNvidiaEmbeddingKey() {
    return Boolean(getNvidiaEmbeddingKey());
}

export function getNvidiaEmbeddingModel() {
    return String(process.env.NVIDIA_EMBEDDING_MODEL || DEFAULT_NVIDIA_EMBEDDING_MODEL).trim();
}

export function getNvidiaRerankModel() {
    return String(process.env.NVIDIA_RERANK_MODEL || DEFAULT_NVIDIA_RERANK_MODEL).trim();
}

export function isNvidiaRerankEnabled() {
    const flag = String(process.env.NVIDIA_RERANK_ENABLED || 'true').trim().toLowerCase();
    return flag !== '0' && flag !== 'false' && flag !== 'off' && hasNvidiaEmbeddingKey();
}

export async function embedTexts(texts, options = {}) {
    const key = getNvidiaEmbeddingKey();
    const input = normalizeEmbeddingInputs(texts);
    if (!key || !input.length) return { available: false, embeddings: [], model: getNvidiaEmbeddingModel() };
    const response = await fetchWithTimeout(NVIDIA_EMBEDDINGS_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model: String(options.model || getNvidiaEmbeddingModel()).trim(),
            input
        })
    }, Number(options.timeoutMs) || EMBEDDING_TIMEOUT_MS);
    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`NVIDIA embeddings failed with HTTP ${response.status}`);
        error.status = response.status;
        error.detail = detail.slice(0, 300);
        throw error;
    }
    const data = await response.json();
    const rows = Array.isArray(data?.data) ? data.data : [];
    const embeddings = rows
        .map(row => Array.isArray(row?.embedding) ? normalizeVector(row.embedding) : [])
        .filter(vector => vector.length);
    return {
        available: true,
        embeddings,
        model: String(data?.model || options.model || getNvidiaEmbeddingModel()).trim()
    };
}

export async function rankTextsByEmbedding(query, items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const queryText = String(query || '').trim();
    if (!queryText || !list.length || !hasNvidiaEmbeddingKey()) {
        return { available: false, ranked: list, model: getNvidiaEmbeddingModel() };
    }
    const texts = list.map(item => String(item?.text || item?.description || item?.title || '').replace(/\s+/g, ' ').trim());
    const input = [queryText, ...texts];
    const result = await embedTexts(input, options);
    if (!result.available || result.embeddings.length < input.length) {
        return { available: false, ranked: list, model: result.model };
    }
    const [queryEmbedding, ...itemEmbeddings] = result.embeddings;
    const ranked = list
        .map((item, index) => ({
            ...item,
            embeddingScore: cosineSimilarity(queryEmbedding, itemEmbeddings[index] || [])
        }))
        .sort((a, b) => Number(b.embeddingScore || 0) - Number(a.embeddingScore || 0));
    return {
        available: true,
        ranked,
        model: result.model
    };
}

export async function rerankTexts(query, items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const queryText = String(query || '').trim();
    const model = String(options.model || getNvidiaRerankModel()).trim();
    if (!queryText || !list.length || !isNvidiaRerankEnabled()) {
        return { available: false, ranked: list, model };
    }

    const passages = list.map(item => ({
        text: String(item?.text || item?.description || item?.title || item?.embeddingChunk || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1800) || ' '
    }));

    const response = await fetchWithTimeout(NVIDIA_RERANK_URL, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${getNvidiaEmbeddingKey()}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            model,
            query: { text: queryText.slice(0, 1000) },
            passages,
            truncate: 'END'
        })
    }, Number(options.timeoutMs) || RERANK_TIMEOUT_MS);

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        const error = new Error(`NVIDIA rerank failed with HTTP ${response.status}`);
        error.status = response.status;
        error.detail = detail.slice(0, 300);
        throw error;
    }

    const data = await response.json();
    const rankings = Array.isArray(data?.rankings) ? data.rankings : [];
    if (!rankings.length) {
        return { available: false, ranked: list, model: String(data?.model || model).trim() };
    }

    const ordered = rankings
        .map(row => ({
            index: Number(row?.index),
            logit: Number(row?.logit)
        }))
        .filter(row => Number.isInteger(row.index) && row.index >= 0 && row.index < list.length)
        .sort((a, b) => {
            const scoreDiff = (Number.isFinite(b.logit) ? b.logit : -Infinity) - (Number.isFinite(a.logit) ? a.logit : -Infinity);
            if (scoreDiff !== 0) return scoreDiff;
            return a.index - b.index;
        });

    const seen = new Set();
    const ranked = [];
    for (const row of ordered) {
        if (seen.has(row.index)) continue;
        seen.add(row.index);
        ranked.push({
            ...list[row.index],
            rerankScore: Number.isFinite(row.logit) ? row.logit : 0
        });
    }
    for (let i = 0; i < list.length; i += 1) {
        if (seen.has(i)) continue;
        ranked.push(list[i]);
    }

    return {
        available: true,
        ranked,
        model: String(data?.model || model).trim()
    };
}

export async function rankTextsByRelevance(query, items, options = {}) {
    const list = Array.isArray(items) ? items : [];
    const embedResult = await rankTextsByEmbedding(query, list, options);
    const candidates = embedResult.available
        ? embedResult.ranked.slice(0, Math.max(1, Number(options.rerankLimit) || 20))
        : list.slice(0, Math.max(1, Number(options.rerankLimit) || 20));

    if (options.useRerank === false || !isNvidiaRerankEnabled()) {
        return {
            available: embedResult.available,
            ranked: embedResult.available ? embedResult.ranked : list,
            embeddingModel: embedResult.model,
            rerankModel: '',
            embeddingEnhanced: embedResult.available,
            rerankEnhanced: false
        };
    }

    try {
        const rerankResult = await rerankTexts(query, candidates, options);
        if (!rerankResult.available) {
            return {
                available: embedResult.available,
                ranked: embedResult.available ? embedResult.ranked : list,
                embeddingModel: embedResult.model,
                rerankModel: rerankResult.model,
                embeddingEnhanced: embedResult.available,
                rerankEnhanced: false
            };
        }
        const rankedKeys = new Set(rerankResult.ranked.map(itemRelevanceKey));
        const remainder = (embedResult.available ? embedResult.ranked : list)
            .filter(item => !rankedKeys.has(itemRelevanceKey(item)));
        return {
            available: true,
            ranked: [...rerankResult.ranked, ...remainder],
            embeddingModel: embedResult.model,
            rerankModel: rerankResult.model,
            embeddingEnhanced: embedResult.available,
            rerankEnhanced: true
        };
    } catch (error) {
        return {
            available: embedResult.available,
            ranked: embedResult.available ? embedResult.ranked : list,
            embeddingModel: embedResult.model,
            rerankModel: getNvidiaRerankModel(),
            embeddingEnhanced: embedResult.available,
            rerankEnhanced: false,
            warning: String(error?.message || 'rerank_failed')
        };
    }
}

function itemRelevanceKey(item) {
    return String(item?.id || item?.key || item?.url || item?.text || item?.title || '').trim();
}

export function chunkTextForEmbedding(text, options = {}) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const maxChars = Math.max(300, Math.min(2400, Number(options.maxChars) || 1400));
    const overlap = Math.max(0, Math.min(400, Number(options.overlap) || 160));
    const chunks = [];
    let index = 0;
    while (index < clean.length && chunks.length < (Number(options.maxChunks) || 24)) {
        const slice = clean.slice(index, index + maxChars);
        const boundary = slice.length === maxChars ? Math.max(slice.lastIndexOf('. '), slice.lastIndexOf(' ')) : slice.length;
        const end = boundary > maxChars * 0.55 ? index + boundary + 1 : index + slice.length;
        chunks.push(clean.slice(index, end).trim());
        if (end >= clean.length) break;
        index = Math.max(end - overlap, index + 1);
    }
    return chunks.filter(Boolean);
}

function getNvidiaEmbeddingKey() {
    return String(process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || '').trim();
}

function normalizeEmbeddingInputs(texts) {
    return (Array.isArray(texts) ? texts : [texts])
        .map(text => String(text || '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .slice(0, 96);
}

function normalizeVector(values) {
    const vector = values.map(Number).filter(Number.isFinite);
    const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (!norm) return vector;
    return vector.map(value => value / norm);
}

function cosineSimilarity(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
    let dot = 0;
    for (let i = 0; i < a.length; i += 1) dot += a[i] * b[i];
    return dot;
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

export const __test = {
    NVIDIA_EMBEDDINGS_URL,
    NVIDIA_RERANK_URL,
    DEFAULT_NVIDIA_EMBEDDING_MODEL,
    DEFAULT_NVIDIA_RERANK_MODEL,
    chunkTextForEmbedding,
    cosineSimilarity,
    rerankTexts,
    rankTextsByRelevance,
    isNvidiaRerankEnabled
};
