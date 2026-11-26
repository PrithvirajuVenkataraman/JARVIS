export function lazyModule(load, fallbacks = {}) {
    let loaded;
    let pending;
    const getModule = () => pending ||= load().then(module => { loaded = module; return module; }).catch(async error => {
        pending = null;
        const msg = String(error?.message || error || '');
        const isChunkFetchError = /dynamically imported module|loading chunk|failed to fetch/i.test(msg);
        if (isChunkFetchError && typeof window !== 'undefined' && typeof navigator !== 'undefined' && navigator.onLine !== false) {
            try {
                const lastReload = Number(window.sessionStorage?.getItem('jarvis_chunk_reload_at') || 0);
                if (!lastReload || (Date.now() - lastReload) > 15000) {
                    window.sessionStorage?.setItem('jarvis_chunk_reload_at', String(Date.now()));
                    window.location.reload();
                    return await new Promise(() => {});
                }
            } catch {
                // Storage unavailable in restricted browser contexts.
            }
        }
        throw error;
    });
    return new Proxy({}, {
        get(_target, name) {
            if (loaded) return loaded[name];
            if (name in fallbacks) return fallbacks[name];
            return (...args) => getModule().then(module => module[name](...args));
        }
    });
}
