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

/**
 * Initiates an AI image generation request.
 * @param {string} prompt - Text description of image to generate
 * @param {object} [options] - Generation settings (steps, width, height, forceCloud)
 * @param {function} [onProgress] - Callback receiving progressive state updates
 * @returns {Promise<object>}
 */
export async function generateImage(prompt, options = {}, onProgress = null) {
    const cleanPrompt = String(prompt || '').trim();
    if (!cleanPrompt) {
        throw new Error('Prompt is required for image generation.');
    }

    const config = getImageConfig();
    const id = `img_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const worker = getOrCreateWorker();

    if (!worker) {
        // Direct main-thread fallback fetch if workers are unsupported
        if (typeof onProgress === 'function') {
            onProgress({ phase: 'download', percent: 50, message: 'Fetching from zero-cost cloud engine...' });
        }
        const fallbackUrl = buildFallbackImageUrl(cleanPrompt, options);
        const startTime = performance.now();
        const res = await fetch(fallbackUrl);
        if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUrl = await new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        const durationMs = Math.round(performance.now() - startTime);

        const result = {
            success: true,
            id,
            prompt: cleanPrompt,
            dataUrl,
            provider: 'free_cloud',
            durationMs,
            width: options.width || config.defaultWidth,
            height: options.height || config.defaultHeight
        };
        await saveGeneratedImage(result);
        return result;
    }

    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            pendingJobs.delete(id);
            reject(new Error('Image generation timed out. Please try again.'));
        }, options.timeoutMs || config.timeoutMs);

        pendingJobs.set(id, {
            prompt: cleanPrompt,
            onProgress,
            resolve: val => {
                clearTimeout(timeout);
                resolve(val);
            },
            reject: err => {
                clearTimeout(timeout);
                reject(err);
            }
        });

        worker.postMessage({
            action: 'generate',
            id,
            prompt: cleanPrompt,
            options: {
                width: options.width || config.defaultWidth,
                height: options.height || config.defaultHeight,
                steps: options.steps || config.defaultSteps,
                forceCloud: options.forceCloud === true
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
