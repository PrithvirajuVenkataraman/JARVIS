import test from 'node:test';
import assert from 'node:assert/strict';

test('unavailable storage never claims an image was saved or exposes broken gallery items', async () => {
    const oldDb = globalThis.indexedDB, oldStorage = globalThis.localStorage;
    globalThis.indexedDB = undefined;
    globalThis.localStorage = { getItem: () => JSON.stringify([{ id: 'old', prompt: 'Metadata only' }]) };
    try {
        const storage = await import('../app/image-storage.js?unavailable');
        const saved = await storage.saveGeneratedImage({ id: 'session-image', dataUrl: 'data:image/png;base64,aGVsbG8=' });
        assert.equal(saved.persisted, false); assert.ok(saved.dataUrl);
        assert.deepEqual(await storage.getRecentGeneratedImages(), []);
    } finally { globalThis.indexedDB = oldDb; globalThis.localStorage = oldStorage; }
});

test('storage can recover after open fails, and quota aborts are reported', async () => {
    const old = globalThis.indexedDB;
    let fails = true;
    const db = { onversionchange: null, transaction() {
        const tx = { objectStore() { return { put() { queueMicrotask(() => tx.onabort()); } }; } };
        return tx;
    } };
    globalThis.indexedDB = { open() { const request = {}; queueMicrotask(() => fails ? request.onerror() : request.onsuccess({ target: { result: db } })); return request; } };
    try {
        const storage = await import('../app/image-storage.js?recover');
        assert.equal((await storage.saveGeneratedImage({ id: 'failed-open' })).persisted, false);
        fails = false;
        assert.equal((await storage.saveGeneratedImage({ id: 'quota-abort' })).persisted, false);
    } finally { globalThis.indexedDB = old; }
});
