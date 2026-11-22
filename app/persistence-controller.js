let pending = null;
let timer = null;
let lastSerialized = '';

export function schedule(save, immediate = false) {
    pending = save;
    clearTimeout(timer);
    if (immediate) return flush();
    timer = setTimeout(flush, 250);
}

export function flush() {
    clearTimeout(timer);
    timer = null;
    const save = pending;
    pending = null;
    return save?.();
}

export function writeHotCache(payload, write) {
    const serialized = JSON.stringify(payload);
    if (serialized === lastSerialized) return true;
    const result = write(payload);
    if (result !== false) lastSerialized = serialized;
    return result;
}

export function reportStorageResult(saved) {
    if (saved === false) window.dispatchEvent(new CustomEvent('jarvis:storage-error'));
}

export function installPersistenceLifecycle() {
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    window.addEventListener('jarvis:storage-error', () => {
        window.showTemporaryMessage?.('This browser could not save your latest changes. Keep this tab open and export a backup.');
    });
}
