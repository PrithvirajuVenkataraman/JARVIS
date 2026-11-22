import { rankChunks, chunkText } from './text-chunks.js';
import { cacheOperation } from './recall-cache.js';
import { MODEL_CACHE } from './recall-model.js';
const ENABLED = 'jarvis_enhanced_recall_v1';
let sequence = 0, state = 'off', epoch = 0;
const workers = new Map();
const pending = new Map();
export function isEnabled() { try { return localStorage.getItem(ENABLED) === 'true'; } catch { return false; } }
export function getStatus() { return state; }
function publish(value) { state = value; globalThis.dispatchEvent?.(new CustomEvent('jarvis:recall-status', { detail: { state } })); }
function dispose(role) {
    for (const [key, worker] of workers) if (!role || key === role) { worker.terminate(); workers.delete(key); }
    for (const [id, request] of pending) if (!role || request.role === role) { clearTimeout(request.timer); request.reject(new Error('Context worker stopped')); pending.delete(id); }
}
export function callWorker(operation, payload = {}, timeout = 10000) {
    const role = operation === 'initialize' || operation === 'search' && state === 'ready' ? 'semantic' : 'text';
    let worker = workers.get(role);
    if (!worker) {
        worker = new Worker(new URL('./recall-worker.js', import.meta.url), { type: 'module' });
        workers.set(role, worker);
        worker.onmessage = ({ data }) => {
            if (data.status) { publish(data.status); return; }
            const request = pending.get(data.id); if (!request) return;
            pending.delete(data.id); clearTimeout(request.timer);
            data.error ? request.reject(Object.assign(new Error(data.error), { code: data.code })) : request.resolve(data.result);
        };
        worker.onerror = () => { dispose(role); if (role === 'semantic') publish('unavailable'); };
    }
    return new Promise((resolve, reject) => {
        const id = ++sequence;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Context deadline exceeded')); }, timeout);
        pending.set(id, { resolve, reject, timer, operation, role }); worker.postMessage({ id, operation, payload });
    });
}
export async function setEnabled(value) {
    try { localStorage.setItem(ENABLED, value ? 'true' : 'false'); } catch { /* This visit only. */ }
    if (!value) { dispose('semantic'); publish('off'); return; }
    publish('loading');
    try { await callWorker('initialize', {}, 120000); } catch { publish('unavailable'); }
}
export async function clearDerived() {
    await setEnabled(false);
    await cacheOperation('vectors', 'clear').catch(() => {});
    await globalThis.caches?.delete(MODEL_CACHE).catch(() => {});
}
export async function selectDocumentFile(file, id, query) {
    const sessionId = globalThis.getActiveChatSession?.()?.id || 'current';
    return callWorker('document', { file, id, name: file.name, sessionId, query }, 30000);
}
export function exchangeRecords(turns) {
    const records = [];
    for (let i = 0; i < turns.length; i++) {
        if (turns[i].role !== 'user') continue;
        const pair = turns[i + 1]?.role === 'assistant' ? [turns[i], turns[i + 1]] : [turns[i]];
        const text = pair.map(t => `${t.role}: ${t.role === 'assistant' ? String(t.text || t.content || '').replace(/<think>[\s\S]*?(?:<\/think>|$)/gi, '') : t.text || t.content || ''}`).join('\n');
        for (const chunk of chunkText(text)) records.push({ ...chunk, id: `${i}:${chunk.id}`, pair, order: i });
    }
    return records;
}
export function selectExchanges(turns, query, limit = 2) {
    const ranked = rankChunks(exchangeRecords(turns), query).filter(row => row.score > 0);
    return pairsFromRanked(ranked, limit);
}
function pairsFromRanked(ranked, limit) {
    const chosen = new Map();
    for (const row of ranked) { if (row.score <= 0 || chosen.has(row.order)) continue; chosen.set(row.order, row.pair); if (chosen.size >= limit) break; }
    return [...chosen].sort((a, b) => a[0] - b[0]).flatMap(([, pair]) => pair);
}
export async function buildContext(engine, options) {
    const startedEpoch = epoch;
    const turns = engine.getState().turns || [], recent = turns.slice(-8), older = turns.slice(0, -8);
    const query = options.message;
    const records = exchangeRecords(older);
    let retrievedTurns = selectExchanges(older, query);
    const sessionId = globalThis.getActiveChatSession?.()?.id || 'current';
    let sources = [];
    if (typeof Worker !== 'undefined') {
        const results = await Promise.allSettled([
            records.length || state === 'ready' ? callWorker('search', { records, query, sessionId }, 250) : Promise.resolve([]),
            callWorker('sources', { sessionId, query }, 250)
        ]);
        if (results[0].status === 'fulfilled') {
            const rows = Array.isArray(results[0].value) ? results[0].value : results[0].value.records;
            if (rows?.length) retrievedTurns = pairsFromRanked(rows, 2);
        }
        if (results[1].status === 'fulfilled') sources = results[1].value;
        if (results[0].status === 'fulfilled' && results[0].value.documents?.length) {
            const enhanced = new Map(results[0].value.documents.map(source => [source.id, source]));
            sources = sources.map(source => enhanced.get(source.id) || source);
        }
    }
    const context = engine.buildMultiTierContext({ ...options, maxRecentTurns: 8, maxContextChars: 30000, retrievedTurns });
    if (epoch !== startedEpoch) throw new DOMException('Context request cancelled', 'AbortError');
    if (sources.length) {
        const data = sources.slice(-2).map(source => `[Earlier attached document: ${source.name}]\n${source.text}`).join('\n\n');
        context.summaryText = [context.summaryText, data].filter(Boolean).join('\n\n');
    }
    // Ambiguous references are resolved by the answer model against actual dialogue.
    // Never fabricate an entity or substitute a canned reply.
    if (!recent.length && !retrievedTurns.length) context.retrievedTurns = [];
    return context;
}
export function cancel() {
    epoch++;
    for (const [id, request] of pending) if (['document', 'search', 'sources'].includes(request.operation)) {
        clearTimeout(request.timer); request.reject(new DOMException('Context request cancelled', 'AbortError')); pending.delete(id);
    }
}
export async function deleteSession(sessionId) {
    const rows = await cacheOperation('sources', 'getAll', IDBKeyRange.bound(sessionId + ':', sessionId + ':\uffff')) || [];
    await Promise.all(rows.map(row => cacheOperation('sources', 'delete', row.id)));
}
export async function clearAll() {
    cancel(); dispose();
    await cacheOperation('sources', 'clear'); await cacheOperation('vectors', 'clear');
    await globalThis.caches?.delete(MODEL_CACHE);
    publish('off');
}
export function install() {
    globalThis.addEventListener?.('pagehide', () => { cancel(); dispose(); });
    if (isEnabled()) setTimeout(() => void setEnabled(true), 1000);
    globalThis.document?.addEventListener('visibilitychange', () => { if (state === 'ready') void callWorker('pause', { hidden: document.hidden }, 1000).catch(() => {}); });
}
