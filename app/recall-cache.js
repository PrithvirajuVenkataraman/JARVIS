const DATABASE = 'jarvis-context-cache-v1';
export async function openRecallCache(factory = globalThis.indexedDB) {
    if (!factory) return null;
    return new Promise((resolve, reject) => {
        const request = factory.open(DATABASE, 1);
        request.onupgradeneeded = () => { for (const name of ['sources', 'vectors']) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
}
export async function cacheOperation(store, operation, value) {
    const db = await openRecallCache(); if (!db) return null;
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(store, operation === 'get' || operation === 'getAll' ? 'readonly' : 'readwrite');
            const request = tx.objectStore(store)[operation](value); let result;
            request.onsuccess = () => { result = request.result; };
            tx.oncomplete = () => resolve(result); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error || new Error('Storage transaction cancelled'));
        });
    } finally { db.close(); }
}
export async function saveSource(source) {
    if (source.text.length * 2 > 64 * 1024 * 1024) throw new Error('Source exceeds the local cache budget');
    await cacheOperation('sources', 'put', source);
    const rows = await cacheOperation('sources', 'getAll') || [];
    let bytes = rows.reduce((sum, row) => sum + row.text.length * 2, 0);
    for (const row of rows.sort((a, b) => a.updatedAt - b.updatedAt)) {
        if (bytes <= 64 * 1024 * 1024) break;
        if (row.id === source.id) continue;
        await cacheOperation('sources', 'delete', row.id); bytes -= row.text.length * 2;
    }
}
