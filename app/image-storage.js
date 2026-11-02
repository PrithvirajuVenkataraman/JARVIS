/**
 * @file app/image-storage.js
 * @description Local IndexedDB persistence for generated AI images and history gallery.
 */

import { getImageConfig } from './image-generation-config.js';

const DB_NAME = 'jarvis_image_db_v1';
const DB_VERSION = 1;
const STORE_NAME = 'generated_images';

let dbPromise = null;

function openDatabase() {
    if (dbPromise) return dbPromise;
    if (typeof indexedDB === 'undefined') {
        return Promise.resolve(null);
    }
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = event => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('timestamp', 'timestamp', { unique: false });
            }
        };
        request.onsuccess = event => resolve(event.target.result);
        request.onerror = event => {
            console.warn('[image-storage] IndexedDB open error:', event.target.error);
            resolve(null);
        };
    });
    return dbPromise;
}

/**
 * Saves a generated image record into IndexedDB and enforces max history limit.
 * @param {object} record
 * @returns {Promise<object>}
 */
export async function saveGeneratedImage(record) {
    if (!record || !record.id) return null;
    const db = await openDatabase();
    const config = getImageConfig();
    const item = {
        id: String(record.id),
        prompt: String(record.prompt || ''),
        dataUrl: String(record.dataUrl || record.imageUrl || ''),
        provider: String(record.provider || 'webgpu'),
        durationMs: Number(record.durationMs || 0),
        width: Number(record.width || config.defaultWidth),
        height: Number(record.height || config.defaultHeight),
        timestamp: Number(record.timestamp || Date.now())
    };

    if (!db) {
        // Fallback to simple localStorage metadata if IndexedDB is disabled
        try {
            const list = JSON.parse(localStorage.getItem('jarvis_recent_images_meta') || '[]');
            list.unshift({ id: item.id, prompt: item.prompt, timestamp: item.timestamp, provider: item.provider });
            if (list.length > config.maxHistoryItems) list.length = config.maxHistoryItems;
            localStorage.setItem('jarvis_recent_images_meta', JSON.stringify(list));
        } catch (_) {}
        return item;
    }

    return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(item);
        tx.oncomplete = async () => {
            await enforceStorageQuota(db, config.maxHistoryItems);
            resolve(item);
        };
        tx.onerror = () => resolve(item);
    });
}

/**
 * Retrieves the most recent generated images from IndexedDB.
 * @param {number} [limit=50]
 * @returns {Promise<Array<object>>}
 */
export async function getRecentGeneratedImages(limit = 50) {
    const db = await openDatabase();
    if (!db) {
        try {
            return JSON.parse(localStorage.getItem('jarvis_recent_images_meta') || '[]');
        } catch (_) {
            return [];
        }
    }

    return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');
        const results = [];

        request.onsuccess = event => {
            const cursor = event.target.result;
            if (cursor && results.length < limit) {
                results.push(cursor.value);
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = () => resolve([]);
    });
}

/**
 * Deletes a generated image by ID.
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteGeneratedImage(id) {
    if (!id) return false;
    const db = await openDatabase();
    if (!db) return false;

    return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.delete(id);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

/**
 * Clears all generated images from local history.
 * @returns {Promise<boolean>}
 */
export async function clearAllGeneratedImages() {
    const db = await openDatabase();
    if (!db) {
        try {
            localStorage.removeItem('jarvis_recent_images_meta');
        } catch (_) {}
        return true;
    }

    return new Promise(resolve => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.clear();
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
    });
}

async function enforceStorageQuota(db, maxItems) {
    try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const countReq = store.count();
        countReq.onsuccess = () => {
            if (countReq.result <= maxItems) return;
            const excess = countReq.result - maxItems;
            const index = store.index('timestamp');
            const cursorReq = index.openCursor(null, 'next'); // oldest first
            let deleted = 0;
            cursorReq.onsuccess = e => {
                const cursor = e.target.result;
                if (cursor && deleted < excess) {
                    store.delete(cursor.primaryKey);
                    deleted++;
                    cursor.continue();
                }
            };
        };
    } catch (_) {}
}

export const saveImage = saveGeneratedImage;
export const getAllImages = getRecentGeneratedImages;
export const deleteImage = deleteGeneratedImage;
export const clearImages = clearAllGeneratedImages;
export const openImageDatabase = openDatabase;

