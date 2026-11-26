/**
 * Content-Addressable Browser Document Cache (SHA-256 + IndexedDB with LRU quota bounds).
 * Eliminates duplicate parsing and redundant API/Blob uploads across attachments and sessions.
 */

const DB_NAME = 'jarvis_document_cache_v1';
const STORE_NAME = 'documents';
const DB_VERSION = 1;
const MAX_CACHE_ENTRIES = 80;
const MAX_CACHE_TEXT_BYTES = 35 * 1024 * 1024; // 35 MB extracted text quota safety bound

const memoryFallbackStore = new Map();

function hasIndexedDb() {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

async function openCacheDb() {
    if (!hasIndexedDb()) return null;
    return await new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'hash' });
                store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Failed to open document cache IndexedDB'));
    });
}

function bytesToHex(uint8) {
    let hex = '';
    for (let i = 0; i < uint8.length; i += 1) {
        hex += uint8[i].toString(16).padStart(2, '0');
    }
    return hex;
}

export async function computeFileSha256(fileOrBytes) {
    let buffer;
    if (fileOrBytes instanceof ArrayBuffer) {
        buffer = fileOrBytes;
    } else if (ArrayBuffer.isView(fileOrBytes)) {
        buffer = fileOrBytes.buffer.slice(fileOrBytes.byteOffset, fileOrBytes.byteOffset + fileOrBytes.byteLength);
    } else if (fileOrBytes && typeof fileOrBytes.arrayBuffer === 'function') {
        buffer = await fileOrBytes.arrayBuffer();
    } else {
        throw new TypeError('computeFileSha256 expected a File, Blob, ArrayBuffer, or TypedArray.');
    }

    if (globalThis.crypto?.subtle?.digest) {
        const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
        return bytesToHex(new Uint8Array(digest));
    }

    // Non-browser fallback (Node environments without global crypto.subtle if ever called)
    try {
        const { createHash } = await import('node:crypto');
        return createHash('sha256').update(new Uint8Array(buffer)).digest('hex');
    } catch (err) {
        throw new Error('SHA-256 digest unavailable in current runtime.', { cause: err });
    }
}

export async function getCachedDocument(hash) {
    const key = String(hash || '').trim();
    if (!key) return null;

    const db = await openCacheDb().catch(() => null);
    if (!db) {
        const hit = memoryFallbackStore.get(key) || null;
        if (hit) hit.lastAccessedAt = Date.now();
        return hit ? { ...hit } : null;
    }

    try {
        const record = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const getReq = store.get(key);
            getReq.onsuccess = () => {
                const value = getReq.result || null;
                if (value) {
                    value.lastAccessedAt = Date.now();
                    try { store.put(value); } catch { /* ignore read/put race */ }
                }
                resolve(value);
            };
            getReq.onerror = () => reject(getReq.error);
        });
        return record;
    } finally {
        db.close();
    }
}

function estimateRecordBytes(record) {
    const textBytes = String(record?.extractedText || '').length * 2;
    const sectionBytes = Array.isArray(record?.sections)
        ? record.sections.reduce((sum, s) => sum + String(s?.text || '').length * 2, 0)
        : 0;
    return textBytes + Math.min(textBytes, sectionBytes);
}

async function enforceCacheQuota(db) {
    if (!db) {
        if (memoryFallbackStore.size <= MAX_CACHE_ENTRIES) {
            let total = 0;
            for (const entry of memoryFallbackStore.values()) total += estimateRecordBytes(entry);
            if (total <= MAX_CACHE_TEXT_BYTES) return;
        }
        const sorted = [...memoryFallbackStore.values()].sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));
        let total = sorted.reduce((s, e) => s + estimateRecordBytes(e), 0);
        let count = sorted.length;
        for (const old of sorted) {
            if (count <= MAX_CACHE_ENTRIES && total <= MAX_CACHE_TEXT_BYTES) break;
            memoryFallbackStore.delete(old.hash);
            total -= estimateRecordBytes(old);
            count -= 1;
        }
        return;
    }

    const entries = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.getAll();
        req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
        req.onerror = () => reject(req.error);
    });

    let totalBytes = entries.reduce((sum, e) => sum + estimateRecordBytes(e), 0);
    if (entries.length <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_TEXT_BYTES) return;

    entries.sort((a, b) => (a.lastAccessedAt || 0) - (b.lastAccessedAt || 0));
    const toDelete = [];
    let remainingCount = entries.length;
    for (const item of entries) {
        if (remainingCount <= MAX_CACHE_ENTRIES && totalBytes <= MAX_CACHE_TEXT_BYTES) break;
        toDelete.push(item.hash);
        totalBytes -= estimateRecordBytes(item);
        remainingCount -= 1;
    }

    if (toDelete.length > 0) {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            for (const hash of toDelete) store.delete(hash);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }
}

export async function putCachedDocument(record) {
    const hash = String(record?.hash || '').trim();
    if (!hash) return null;
    const now = Date.now();
    const sanitized = {
        hash,
        name: String(record?.name || 'Document'),
        mimeType: String(record?.mimeType || ''),
        size: Number(record?.size || 0),
        pageCount: Number(record?.pageCount || 0),
        parser: String(record?.parser || record?.ocrMethod || 'cached'),
        ocrMethod: String(record?.ocrMethod || record?.parser || 'cached'),
        extractedText: String(record?.extractedText || ''),
        sections: Array.isArray(record?.sections) ? record.sections : [],
        createdAt: Number(record?.createdAt || now),
        lastAccessedAt: now
    };

    const db = await openCacheDb().catch(() => null);
    if (!db) {
        memoryFallbackStore.set(hash, sanitized);
        await enforceCacheQuota(null);
        return sanitized;
    }

    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).put(sanitized);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        await enforceCacheQuota(db).catch(() => {});
        return sanitized;
    } finally {
        db.close();
    }
}

export async function deleteCachedDocument(hash) {
    const key = String(hash || '').trim();
    if (!key) return false;
    memoryFallbackStore.delete(key);
    const db = await openCacheDb().catch(() => null);
    if (!db) return true;
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } finally {
        db.close();
    }
}

export async function clearDocumentCache() {
    memoryFallbackStore.clear();
    const db = await openCacheDb().catch(() => null);
    if (!db) return true;
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            tx.objectStore(STORE_NAME).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
        return true;
    } finally {
        db.close();
    }
}

export async function getDocumentCacheStats() {
    const db = await openCacheDb().catch(() => null);
    if (!db) {
        let bytes = 0;
        for (const item of memoryFallbackStore.values()) bytes += estimateRecordBytes(item);
        return { count: memoryFallbackStore.size, bytes };
    }
    try {
        const entries = await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).getAll();
            req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
            req.onerror = () => reject(req.error);
        });
        const bytes = entries.reduce((sum, item) => sum + estimateRecordBytes(item), 0);
        return { count: entries.length, bytes };
    } finally {
        db.close();
    }
}
