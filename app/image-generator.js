/**
 * @file app/image-generator.js
 * @description Main-thread orchestrator for zero-cost AI image generation.
 * Controls Web Worker lifecycle, telemetry, IndexedDB caching, and UI progress bus.
 */

import { getImageConfig, buildFallbackImageUrl } from './image-generation-config.js';
import { saveGeneratedImage, getRecentGeneratedImages, deleteGeneratedImage, clearAllGeneratedImages } from './image-storage.js';

let activeWorker = null;
const pendingJobs = new Map();
let isWebGpuSupportedCache = null;

/**
 * Checks whether the current browser environment supports WebGPU.
 * @returns {Promise<boolean>}
 */
export async function checkWebGpuSupport() {
    if (isWebGpuSupportedCache !== null) return isWebGpuSupportedCache;
    if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
        isWebGpuSupportedCache = false;
        return false;
    }
    try {
        const adapter = await navigator.gpu.requestAdapter();
        isWebGpuSupportedCache = Boolean(adapter);
        return isWebGpuSupportedCache;
    } catch (_) {
        isWebGpuSupportedCache = false;
        return false;
    }
}

function getOrCreateWorker() {
    if (activeWorker) return activeWorker;
    if (typeof Worker === 'undefined') return null;

    try {
        activeWorker = new Worker('app/image-generator-worker.js?v=2.0.1');
        activeWorker.onmessage = event => {
            const data = event.data || {};
            const { action, id } = data;
            const job = pendingJobs.get(id);

            if (!job) return;

            if (action === 'progress') {
                if (typeof job.onProgress === 'function') {
                    job.onProgress(data);
                }
            } else if (action === 'complete') {
                pendingJobs.delete(id);
                // Save to local IndexedDB
                saveGeneratedImage({
                    id,
                    prompt: job.prompt,
                    dataUrl: data.dataUrl,
                    provider: data.provider,
                    durationMs: data.durationMs,
                    width: data.width,
                    height: data.height
                }).catch(() => {});

                job.resolve({
                    success: true,
                    id,
                    prompt: job.prompt,
                    dataUrl: data.dataUrl,
                    provider: data.provider,
                    durationMs: data.durationMs,
                    width: data.width,
                    height: data.height
                });
            } else if (action === 'error') {
                pendingJobs.delete(id);
                job.reject(new Error(data.error || 'Generation failed'));
            }
        };

        activeWorker.onerror = error => {
            console.error('[image-generator] Worker error:', error);
        };
    } catch (e) {
        console.warn('[image-generator] Could not create Worker, will use direct fallback:', e);
        activeWorker = null;
    }
    return activeWorker;
}

async function generateDirectFallback(id, prompt, options = {}, onProgress = null) {
    if (typeof onProgress === 'function') {
        onProgress({ phase: 'download', percent: 50, message: 'Generating AI image...' });
    }
    const config = getImageConfig();
    const fallbackUrl = buildFallbackImageUrl(prompt, options);
    const startTime = performance.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 25000);
    let res = null;
    try {
        res = await fetch(fallbackUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    } catch (fetchErr) {
        clearTimeout(timeoutId);
        throw fetchErr;
    }
    const blob = await res.blob();
    const dataUrl = await new Promise(resolve => {
        if (typeof FileReader !== 'undefined') {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        } else {
            blob.arrayBuffer().then(buf => {
                const bytes = new Uint8Array(buf);
                let binary = '';
                for (let i = 0; i < bytes.length; i += 8192) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
                }
                resolve(`data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`);
            }).catch(() => resolve(fallbackUrl));
        }
    });
    const durationMs = Math.round(performance.now() - startTime);

    const result = {
        success: true,
        id,
        prompt,
        dataUrl,
        fallbackUrl,
        url: fallbackUrl,
        provider: 'free_cloud',
        durationMs,
        width: options.width || config.defaultWidth,
        height: options.height || config.defaultHeight
    };
    await saveGeneratedImage(result);
    return result;
}

/**
 * Initiates an AI image generation request.
 * Supports both generateImage(prompt, options, onProgress) and generateImage({ prompt, ... })
 * @param {string|object} promptOrOptions - Text prompt or parameter dictionary
 * @param {object} [options] - Generation settings (width, height, model)
 * @param {function} [onProgress] - Callback receiving progressive state updates
 * @returns {Promise<object>}
 */
export async function generateImage(promptOrOptions, options = {}, onProgress = null) {
    let cleanPrompt = '';
    let opts = options || {};
    let progressCb = onProgress;

    if (promptOrOptions && typeof promptOrOptions === 'object') {
        cleanPrompt = String(promptOrOptions.prompt || '').trim();
        opts = { ...promptOrOptions, ...options };
        if (typeof promptOrOptions.onProgress === 'function') {
            progressCb = promptOrOptions.onProgress;
        }
    } else {
        cleanPrompt = String(promptOrOptions || '').trim();
    }

    if (!cleanPrompt) {
        throw new Error('Prompt is required for image generation.');
    }

    const config = getImageConfig();
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const worker = getOrCreateWorker();

    if (!worker) {
        return generateDirectFallback(id, cleanPrompt, opts, progressCb);
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingJobs.delete(id);
            generateDirectFallback(id, cleanPrompt, opts, progressCb)
                .then(resolve)
                .catch(() => reject(new Error('Image generation timed out. Please try again.')));
        }, opts.timeoutMs || config.timeoutMs);

        pendingJobs.set(id, {
            prompt: cleanPrompt,
            options: opts,
            onProgress: progressCb,
            resolve: val => {
                clearTimeout(timeout);
                resolve(val);
            },
            reject: err => {
                clearTimeout(timeout);
                generateDirectFallback(id, cleanPrompt, opts, progressCb)
                    .then(resolve)
                    .catch(() => reject(err));
            }
        });

        worker.postMessage({
            action: 'generate',
            id,
            prompt: cleanPrompt,
            options: {
                width: opts.width || config.defaultWidth,
                height: opts.height || config.defaultHeight,
                steps: opts.steps || config.defaultSteps,
                forceCloud: true,
                model: opts.model || config.model || 'turbo',
                negativePrompt: opts.negativePrompt || config.defaultNegativePrompt,
                fallbackEndpointTemplate: opts.fallbackEndpointTemplate || config.fallbackEndpointTemplate
            }
        });
    });
}

/**
 * Cancels a pending image generation task.
 * @param {string} id
 */
export function cancelImageGeneration(id) {
    if (pendingJobs.has(id)) {
        const job = pendingJobs.get(id);
        pendingJobs.delete(id);
        job.reject(new Error('Generation cancelled by user.'));
    }
}

export {
    getImageConfig,
    saveGeneratedImage,
    getRecentGeneratedImages,
    deleteGeneratedImage,
    clearAllGeneratedImages
};
