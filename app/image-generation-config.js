/**
 * @file app/image-generation-config.js
 * @description Dynamic, non-hardcoded configuration engine for zero-cost WebGPU
 * image generation and graceful zero-cost fallback routing.
 */

export const DEFAULT_IMAGE_CONFIG = Object.freeze({
    modelId: 'latent-consistency/lcm-dreamshaper-v7',
    modelName: 'LCM-Dreamshaper-v7 (4-Step WebGPU)',
    quantization: 'int8',
    defaultSteps: 4,
    defaultWidth: 512,
    defaultHeight: 512,
    guidanceScale: 1.0,
    maxHistoryItems: 50,
    timeoutMs: 60000,
    minVramBytes: 2 * 1024 * 1024 * 1024, // 2GB minimum VRAM heuristic
    fallbackEndpointTemplate: 'https://image.pollinations.ai/prompt/{prompt}?width={width}&height={height}&nologo=true&seed={seed}',
    storageKey: 'jarvis_image_config_v1'
});

/**
 * Retrieves the current effective image generation configuration,
 * allowing user or environment overrides stored in localStorage.
 * @returns {typeof DEFAULT_IMAGE_CONFIG}
 */
let memoryOverrides = null;

export function getImageConfig() {
    let stored = null;
    if (typeof localStorage !== 'undefined') {
        try {
            const raw = localStorage.getItem(DEFAULT_IMAGE_CONFIG.storageKey);
            if (raw) stored = JSON.parse(raw);
        } catch (_) {}
    } else if (memoryOverrides) {
        stored = memoryOverrides;
    }
    return {
        ...DEFAULT_IMAGE_CONFIG,
        ...(typeof stored === 'object' && stored !== null ? stored : {})
    };
}

/**
 * Persists runtime configuration overrides to localStorage or memory.
 * @param {Partial<typeof DEFAULT_IMAGE_CONFIG>} overrides
 * @returns {typeof DEFAULT_IMAGE_CONFIG}
 */
export function updateImageConfig(overrides = {}) {
    const current = getImageConfig();
    const updated = {
        ...current,
        ...(typeof overrides === 'object' && overrides !== null ? overrides : {})
    };
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(DEFAULT_IMAGE_CONFIG.storageKey, JSON.stringify(updated));
        } catch (_) {
            // Storage quota or security error ignored
        }
    } else {
        memoryOverrides = updated;
    }
    return updated;
}

/**
 * Resets image generation configuration to factory defaults.
 */
export function resetImageConfig() {
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.removeItem(DEFAULT_IMAGE_CONFIG.storageKey);
        } catch (_) {}
    }
    memoryOverrides = null;
    return { ...DEFAULT_IMAGE_CONFIG };
}

/**
 * Dynamically builds a zero-cost fallback URL by injecting prompt and dimensions.
 * @param {string} prompt
 * @param {object} [options]
 * @returns {string}
 */
export function buildFallbackImageUrl(prompt, options = {}) {
    const config = getImageConfig();
    const template = String(options.template || config.fallbackEndpointTemplate);
    const width = Number(options.width || config.defaultWidth);
    const height = Number(options.height || config.defaultHeight);
    const seed = Number(options.seed || Math.floor(Math.random() * 1000000));
    const encodedPrompt = encodeURIComponent(String(prompt || '').trim());

    return template
        .replace('{prompt}', encodedPrompt)
        .replace('{width}', String(width))
        .replace('{height}', String(height))
        .replace('{seed}', String(seed));
}
