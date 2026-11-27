/**
 * Client-Side Local Image & ONNX Browser Vision Fallback Engine
 * Provides lightweight Canvas inspection plus an on-demand Transformers.js / ONNX Web Worker
 * fallback when cloud vision quotas (Groq / Gemini) are exhausted or offline.
 */

export const VISION_FALLBACK_STORAGE_KEY = 'jarvis_local_vision_fallback_v1';
export const VISION_MODEL_CACHE = 'jarvis-local-vision-model-v1';

let workerInstance = null;
let requestSequence = 0;
let currentStatus = 'idle';
let memoryEnabledOverride = null;
const pendingRequests = new Map();

function publishStatus(nextStatus) {
    currentStatus = nextStatus;
    try {
        globalThis.dispatchEvent?.(new CustomEvent('jarvis:vision-fallback-status', {
            detail: { state: currentStatus }
        }));
    } catch {
        // Ignore in non-DOM test runtimes.
    }
}

export function getLocalVisionStatus() {
    if (!isLocalVisionFallbackEnabled()) return 'off';
    return currentStatus;
}

export function isLocalVisionFallbackEnabled() {
    try {
        if (globalThis.localStorage) {
            const stored = globalThis.localStorage.getItem(VISION_FALLBACK_STORAGE_KEY);
            return stored !== 'false';
        }
    } catch {
        // Fall through to in-memory session preference.
    }
    return memoryEnabledOverride !== false;
}

export function disposeLocalVisionWorker() {
    if (workerInstance) {
        try {
            workerInstance.terminate();
        } catch {
            // Ignore worker termination errors.
        }
        workerInstance = null;
    }
    for (const [id, req] of pendingRequests) {
        clearTimeout(req.timer);
        req.reject(new Error('On-device vision worker stopped'));
        pendingRequests.delete(id);
    }
}

export async function setLocalVisionFallbackEnabled(enabled) {
    const flag = Boolean(enabled);
    memoryEnabledOverride = flag;
    try {
        globalThis.localStorage?.setItem(VISION_FALLBACK_STORAGE_KEY, flag ? 'true' : 'false');
    } catch {
        // Session-only preference when localStorage is unavailable.
    }
    if (!flag) {
        disposeLocalVisionWorker();
        publishStatus('off');
        return false;
    }
    publishStatus('idle');
    return true;
}

export async function warmLocalVisionModels() {
    await setLocalVisionFallbackEnabled(true);
    publishStatus('loading');
    try {
        await callVisionWorker('initialize', {}, 120000);
        return true;
    } catch {
        publishStatus('unavailable');
        return false;
    }
}

export async function clearLocalVisionCache() {
    disposeLocalVisionWorker();
    publishStatus(isLocalVisionFallbackEnabled() ? 'idle' : 'off');
    try {
        await globalThis.caches?.delete(VISION_MODEL_CACHE);
    } catch {
        // Ignore CacheStorage absence.
    }
}

function callVisionWorker(operation, payload = {}, timeoutMs = 45000) {
    if (typeof Worker === 'undefined') {
        return Promise.reject(new Error('Web Worker unavailable in this environment'));
    }
    if (!workerInstance) {
        workerInstance = new Worker(new URL('./vision-worker.js', import.meta.url), { type: 'module' });
        workerInstance.onmessage = ({ data }) => {
            if (data?.status) {
                publishStatus(data.status);
                return;
            }
            const req = pendingRequests.get(data?.id);
            if (!req) return;
            pendingRequests.delete(data.id);
            clearTimeout(req.timer);
            if (data?.error) {
                req.reject(new Error(data.error));
            } else {
                req.resolve(data?.result);
            }
        };
        workerInstance.onerror = () => {
            disposeLocalVisionWorker();
            publishStatus('unavailable');
        };
    }

    return new Promise((resolve, reject) => {
        const id = ++requestSequence;
        const timer = setTimeout(() => {
            pendingRequests.delete(id);
            reject(new Error('On-device ONNX vision timed out'));
        }, Math.max(1000, Number(timeoutMs) || 45000));
        pendingRequests.set(id, { resolve, reject, timer });
        workerInstance.postMessage({ id, operation, payload });
    });
}

export async function resolveImageInputToDataUrl(imageInput) {
    if (!imageInput) return '';
    if (typeof imageInput === 'string') {
        const trimmed = imageInput.trim();
        if (!trimmed) return '';
        if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || /^https?:\/\//i.test(trimmed)) {
            return trimmed;
        }
        return `data:image/jpeg;base64,${trimmed}`;
    }
    if (typeof imageInput === 'object') {
        if (typeof imageInput.dataUrl === 'string' && imageInput.dataUrl.trim()) {
            return imageInput.dataUrl.trim();
        }
        const b64 = String(imageInput.base64 || imageInput.data || '').trim();
        if (b64) {
            if (b64.startsWith('data:')) return b64;
            const mime = String(imageInput.mimeType || 'image/jpeg').trim() || 'image/jpeg';
            return `data:${mime};base64,${b64}`;
        }
        if (typeof Blob !== 'undefined' && imageInput instanceof Blob) {
            if (typeof FileReader !== 'undefined') {
                return await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
                    reader.onerror = () => resolve('');
                    reader.readAsDataURL(imageInput);
                });
            }
            if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
                return URL.createObjectURL(imageInput);
            }
        }
        if (imageInput.file) {
            return await resolveImageInputToDataUrl(imageInput.file);
        }
    }
    return '';
}

export function formatLocalVisionSummary({ caption = '', labels = [], ocrText = '', prompt = '', dimensions = null } = {}) {
    const cleanCaption = String(caption || '').trim();
    const cleanLabels = (Array.isArray(labels) ? labels : [])
        .filter((entry) => entry && entry.label)
        .slice(0, 5)
        .map((entry) => {
            const pct = Number.isFinite(Number(entry.score)) ? Math.round(Number(entry.score) * 100) : null;
            return pct !== null && pct > 0 ? `${entry.label} (${pct}%)` : String(entry.label);
        });
    const cleanOcr = String(ocrText || '').trim();
    const lines = [
        '**On-Device Vision Analysis (Offline / Quota Fallback)**',
        '_Cloud vision providers were unavailable or rate-limited, so this image was analyzed locally in your browser via ONNX + Tesseract._'
    ];
    if (prompt) {
        lines.push(`**Prompt context:** ${String(prompt).trim()}`);
    }
    if (cleanCaption) {
        lines.push(`**Visual description:** ${cleanCaption}`);
    }
    if (cleanLabels.length > 0) {
        lines.push(`**Detected subjects/classes:** ${cleanLabels.join(', ')}`);
    }
    if (cleanOcr) {
        lines.push(`**Extracted text (Tesseract OCR):**\n${cleanOcr}`);
    }
    if (dimensions?.width && dimensions?.height) {
        lines.push(`**Dimensions:** ${dimensions.width} × ${dimensions.height}px`);
    }
    return lines.join('\n\n');
}

export async function analyzeImageLocallyWithOnnx(imageInput, options = {}) {
    if (!isLocalVisionFallbackEnabled() && options.force !== true) {
        return { ok: false, reason: 'disabled', response: '' };
    }
    const imageDataUrl = await resolveImageInputToDataUrl(imageInput);
    if (!imageDataUrl) {
        return { ok: false, reason: 'missing_image', response: '' };
    }

    const invokeWorker = typeof options.workerCall === 'function'
        ? options.workerCall
        : (op, payload, timeoutMs) => callVisionWorker(op, payload, timeoutMs);

    const dimensions = options.dimensions || await processImageLocallyInBrowser(imageDataUrl).catch(() => null);
    let workerResult = null;
    let workerError = '';

    try {
        workerResult = await invokeWorker('analyze', { imageDataUrl }, options.timeoutMs || 45000);
    } catch (err) {
        workerError = String(err?.message || err);
    }

    let ocrText = String(options.ocrText || '').trim();
    if (!ocrText && typeof options.extractOcrFn === 'function') {
        try {
            const ocrRes = await options.extractOcrFn(imageDataUrl);
            if (ocrRes?.ok && ocrRes?.text) {
                ocrText = String(ocrRes.text).trim();
            }
        } catch {
            // Keep ONNX visual output even if optional OCR pass fails.
        }
    }

    const caption = String(workerResult?.caption || '').trim();
    const labels = Array.isArray(workerResult?.labels) ? workerResult.labels : [];
    if (!caption && labels.length === 0 && !ocrText) {
        return {
            ok: false,
            reason: workerError || 'empty_analysis',
            response: ''
        };
    }

    const response = formatLocalVisionSummary({
        caption,
        labels,
        ocrText,
        prompt: options.prompt || '',
        dimensions
    });

    return {
        ok: true,
        provider: 'onnx_browser',
        modelUsed: Array.isArray(workerResult?.models) && workerResult.models.length
            ? workerResult.models.join(' + ')
            : 'onnx/browser-vision',
        caption,
        labels,
        ocrText,
        dimensions,
        response
    };
}

export async function processImageLocallyInBrowser(fileOrDataUrl) {
    if (typeof window === 'undefined' || typeof Image === 'undefined') return null;

    try {
        const imageElement = await loadImageElement(fileOrDataUrl);
        const { width, height } = imageElement;
        const aspectRatio = width / height;

        return {
            width,
            height,
            aspectRatio
        };
    } catch {
        return null;
    }
}

export function extractLocalImageTagFromAttachment(attachment) {
    if (!attachment || !attachment.mimeType?.startsWith('image/')) return '';
    return '';
}

function loadImageElement(fileOrDataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        let objectUrl = '';
        img.onload = () => {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
            }
            resolve(img);
        };
        img.onerror = (err) => {
            if (objectUrl) {
                try { URL.revokeObjectURL(objectUrl); } catch { /* ignore */ }
            }
            reject(err);
        };

        if (typeof fileOrDataUrl === 'string') {
            img.src = fileOrDataUrl;
        } else if (typeof Blob !== 'undefined' && fileOrDataUrl instanceof Blob) {
            objectUrl = URL.createObjectURL(fileOrDataUrl);
            img.src = objectUrl;
        } else {
            reject(new Error('Invalid image input'));
        }
    });
}
