import { chunkText, rankChunks, selectDocumentText } from './text-chunks.js';
import { hasCredentials } from './text-safety.js';
import { cacheOperation, saveSource } from './recall-cache.js';
import { MODEL_ID, MODEL_REVISION, verifiedModelFetch } from './recall-model.js';
import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';

let extractor, loading;
const vectors = new Map();
const status = state => self.postMessage({ status: state });
const mostlyEnglish = text => {
    const letters = String(text).match(/\p{L}/gu) || [];
    return letters.length > 0 && (String(text).match(/[a-z]/gi) || []).length / letters.length >= 0.8;
};
async function initialize() {
    if (!loading) loading = (async () => {
        status('loading');
        const { pipeline, env } = await import('@huggingface/transformers');
        env.allowLocalModels = false; env.useBrowserCache = false; env.useCustomCache = false; env.useWasmCache = false;
        env.fetch = verifiedModelFetch;
        env.backends.onnx.wasm.numThreads = 1;
        env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };
        extractor = await pipeline('feature-extraction', MODEL_ID, { revision: MODEL_REVISION, dtype: 'q8', device: 'wasm' });
        status('ready'); return true;
    })().catch(error => { loading = null; status('unavailable'); throw error; });
    return loading;
}
function checkCredentials(text) { return !hasCredentials(text); }
async function embed(text) {
    if (!extractor) return null;
    const bytes = new TextEncoder().encode(text);
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    const id = MODEL_REVISION + ':' + hash;
    if (vectors.has(id)) return vectors.get(id);
    let vector;
    try { vector = (await cacheOperation('vectors', 'get', id))?.vector; } catch { /* Memory fallback. */ }
    if (!vector) {
        vector = Float32Array.from((await extractor(text, { pooling: 'mean', normalize: true, truncation: true, max_length: 256 })).data);
        try { await cacheOperation('vectors', 'put', { id, vector }); } catch { /* Optional cache. */ }
    }
    vectors.set(id, vector);
    if (vectors.size > 4096) vectors.delete(vectors.keys().next().value);
    return vector;
}
let indexing = 0;
let paused = false;
async function indexRecords(records) {
    const token = ++indexing;
    for (const record of records.slice(-4096).reverse()) {
        if (token !== indexing || !extractor || paused) return;
        if (!mostlyEnglish(record.text)) continue;
        await embed(record.text); await new Promise(resolve => setTimeout(resolve, 0));
    }
    const saved = await cacheOperation('vectors', 'getAll').catch(() => []) || [];
    for (const row of saved.slice(0, Math.max(0, saved.length - 4096))) await cacheOperation('vectors', 'delete', row.id).catch(() => {});
}

async function rankWithSemantic(records, queryText) {
    const ranked = rankChunks(records, queryText);
    if (!extractor || !mostlyEnglish(queryText)) return ranked;
    const query = await embed(queryText), hits = [];
    for (const record of records) {
        if (!mostlyEnglish(record.text)) continue;
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(record.text))), x => x.toString(16).padStart(2, '0')).join('');
        const vector = vectors.get(MODEL_REVISION + ':' + hash); if (!vector) continue;
        const similarity = query.reduce((sum, value, i) => sum + value * vector[i], 0);
        if (similarity >= 0.4) hits.push({ ...record, similarity });
    }
    hits.sort((a, b) => b.similarity - a.similarity);
    const scores = new Map();
    for (const list of [ranked.filter(row => row.score > 0), hits]) list.forEach((item, rank) => scores.set(item.id, (scores.get(item.id) || 0) + 1 / (60 + rank)));
    return records.map(record => ({ ...record, score: scores.get(record.id) || 0 })).sort((a, b) => b.score - a.score);
}

self.onmessage = async ({ data }) => {
    const { id, operation, payload } = data;
    try {
        let result;
        if (operation === 'initialize') result = await initialize();
        else if (operation === 'pause') { paused = Boolean(payload.hidden); if (paused) indexing++; result = true; }
        else if (operation === 'check') result = checkCredentials(payload.text);
        else if (operation === 'document') {
            const text = await payload.file.text();
            if (!checkCredentials(text)) throw Object.assign(new Error('This document contains credentials. Remove them before sending.'), { code: 'document_credentials' });
            const source = { id: payload.sessionId + ':' + payload.id, sessionId: payload.sessionId, name: payload.name, text, updatedAt: Date.now() };
            let saved = true; try { await saveSource(source); } catch { saved = false; }
            const selected = selectDocumentText(text, payload.query);
            result = { text: selected.text, partial: selected.partial, coverage: selected.coverage, saved };
        } else if (operation === 'search') {
            const records = payload.records;
            const ranked = await rankWithSemantic(records, payload.query);
            const documents = [], documentRecords = [];
            if (extractor && payload.sessionId) {
                const rows = await cacheOperation('sources', 'getAll', IDBKeyRange.bound(payload.sessionId + ':', payload.sessionId + ':\uffff')).catch(() => []) || [];
                for (const source of rows.slice(-2)) {
                    // Larger files retain lightweight retrieval, avoiding excess model memory.
                    if (source.text.length > 2 * 1024 * 1024) continue;
                    const chunks = chunkText(source.text, 2400);
                    const selected = await rankWithSemantic(chunks, payload.query);
                    documents.push({ ...source, text: selectDocumentText(source.text, payload.query, 12000, selected).text });
                    documentRecords.push(...chunks);
                }
            }
            result = { records: ranked, documents };
            if (extractor) void indexRecords([...records, ...documentRecords]).catch(() => {});
        } else if (operation === 'sources') {
            const rows = await cacheOperation('sources', 'getAll', IDBKeyRange.bound(payload.sessionId + ':', payload.sessionId + ':\uffff')) || [];
            result = rows.filter(row => row.sessionId === payload.sessionId).map(row => ({ ...row, text: selectDocumentText(row.text, payload.query, 12000).text }));
        } else if (operation === 'chunks') result = chunkText(payload.text);
        else throw new Error('Unknown context operation');
        self.postMessage({ id, result });
    } catch (error) { self.postMessage({ id, error: String(error.message || 'Context unavailable'), code: error.code }); }
};
