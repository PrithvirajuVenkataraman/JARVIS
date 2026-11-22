let capabilities = null;
let retryTimer;
const selectors = {
    search: '#web-search-toggle-btn, [data-capability="live_search"], [data-capability="live-search"]',
    vision: '#sidebar-vision-btn, #composer-camera-btn, [data-capability="vision"], [data-capability="document_ocr"]',
    images: '#composer-image-btn, [data-capability="image_generation"], [data-capability="image"], [data-action="generate-image"], [data-creation-id="image"]',
    byok: '#settings-row-byok'
};

export function isAvailable(name) { return capabilities?.[name]?.available === true; }

export function applyCapabilities(value) {
    if (!value || typeof value !== 'object') return;
    const previous = capabilities;
    capabilities = value;
    const sealedKeys = ['jarvis_byok_groq_sealed', 'jarvis_byok_gemini_sealed'].some(key => {
        try { return Boolean(localStorage.getItem(key)); } catch { return false; }
    });
    for (const [name, selector] of Object.entries(selectors)) {
        const available = isAvailable(name) || (name === 'vision' && sealedKeys && isAvailable('byok'));
        for (const element of document.querySelectorAll(selector)) {
            element.hidden = !available;
            element.dataset.capabilityUnavailable = available ? 'false' : 'true';
        }
    }
    if (!isAvailable('search') && (previous?.search?.available || document.getElementById('web-search-toggle-btn')?.dataset.webMode === 'force')) window.setWebSearchMode?.('off', { persist: false });
    if (!isAvailable('images') && previous?.images?.available) window.deactivateComposerImageMode?.();
}

export async function refreshCapabilities() {
    try {
        const response = await fetch('/api/diagnostics', { signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error('Diagnostics unavailable');
        const data = await response.json();
        applyCapabilities(data.diagnostics?.capabilities);
    } catch {
        applyCapabilities(Object.fromEntries(['chat', 'search', 'vision', 'images', 'byok'].map(name => [name, { available: false, reasonCode: 'status_unavailable' }])));
    }
}

export function installCapabilityVisibility() {
    const originalFetch = window.fetch;
    window.fetch = async function (input, init) {
        const response = await originalFetch.call(this, input, init);
        const url = String(typeof input === 'string' ? input : input?.url || '');
        const feature = url.includes('/api/image-proxy') ? 'images' : url.includes('/api/vision') ? 'vision' : url.includes('/api/search') ? 'search' : null;
        if (feature && capabilities && [429, 503].includes(response.status)) {
            applyCapabilities({ ...capabilities, [feature]: { available: false, reasonCode: response.status === 429 ? 'quota_exhausted' : 'temporarily_unavailable' } });
            clearTimeout(retryTimer);
            retryTimer = setTimeout(refreshCapabilities, Math.max(30000, Math.min(300000, (Number(response.headers.get('Retry-After')) || 60) * 1000)));
        }
        return response;
    };
    let pending = false;
    new MutationObserver(records => {
        if (!capabilities || pending || !records.some(record => record.addedNodes.length)) return;
        pending = true;
        requestAnimationFrame(() => { pending = false; applyCapabilities(capabilities); });
    }).observe(document.body, { childList: true, subtree: true });
    refreshCapabilities();
}
