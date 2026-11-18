/**
 * @file app/image-generator-worker.js
 * @description Dedicated background Web Worker for AI image generation.
 * Keeps the main UI thread at a responsive 60 FPS.
 */

/* global self */

let isWebGpuAvailable = false;
let gpuAdapter = null;

async function probeWebGpu() {
    try {
        if (typeof navigator !== 'undefined' && 'gpu' in navigator && navigator.gpu) {
            gpuAdapter = await navigator.gpu.requestAdapter();
            if (gpuAdapter) {
                isWebGpuAvailable = true;
                return true;
            }
        }
    } catch (_) {
        isWebGpuAvailable = false;
    }
    return false;
}

// Check on worker boot
probeWebGpu();

async function blobToDataUrl(blob) {
    if (typeof FileReader !== 'undefined') {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    const base64 = btoa(binary);
    return `data:${blob.type || 'image/jpeg'};base64,${base64}`;
}

self.onmessage = async function handleWorkerMessage(event) {
    const data = event.data || {};
    const { action, id, prompt, options = {} } = data;

    if (action === 'check_support') {
        const supported = await probeWebGpu();
        self.postMessage({
            action: 'support_result',
            supported,
            adapterInfo: gpuAdapter ? (gpuAdapter.info || 'WebGPU Adapter Present') : null
        });
        return;
    }

    if (action === 'generate') {
        const startTime = performance.now();
        const width = options.width || 512;
        const height = options.height || 512;

        try {
            self.postMessage({ action: 'progress', id, phase: 'init', percent: 20, message: 'Connecting to Gemini AI engine...' });

            const model = options.model || 'gemini-2.5-flash-image';
            const encodedPrompt = encodeURIComponent(String(prompt || '').trim());
            const seed = options.seed || Math.floor(Math.random() * 1000000);
            const aspectRatio = options.aspectRatio || (width === height ? '1:1' : `${width}:${height}`);

            let proxyUrl = '';
            if (typeof self !== 'undefined' && self.location && self.location.origin && self.location.origin.startsWith('http')) {
                proxyUrl = `${self.location.origin}/api/image-proxy?prompt=${encodedPrompt}&width=${width}&height=${height}&model=${encodeURIComponent(model)}&seed=${seed}&aspectRatio=${encodeURIComponent(aspectRatio)}`;
            } else {
                proxyUrl = `/api/image-proxy?prompt=${encodedPrompt}&width=${width}&height=${height}&model=${encodeURIComponent(model)}&seed=${seed}&aspectRatio=${encodeURIComponent(aspectRatio)}`;
            }

            self.postMessage({ action: 'progress', id, phase: 'download', percent: 55, message: 'Generating Gemini AI image...' });

            async function fetchWithTimeout(url, timeoutMs = 35000) {
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
                try {
                    const response = await fetch(url, { signal: controller.signal });
                    clearTimeout(timeoutId);
                    return response;
                } catch (err) {
                    clearTimeout(timeoutId);
                    throw err;
                }
            }

            let res = null;
            try {
                res = await fetchWithTimeout(proxyUrl, 35000);
                if (!res.ok) {
                    const errJson = await res.json().catch(() => null);
                    throw new Error(errJson?.error?.message || `Image API returned HTTP ${res.status}`);
                }
            } catch (firstErr) {
                // Retry once with fresh seed
                const retrySeed = Math.floor(Math.random() * 1000000);
                const retryUrl = proxyUrl.replace(/seed=\d+/, `seed=${retrySeed}`);
                self.postMessage({ action: 'progress', id, phase: 'download', percent: 75, message: 'Retrying Gemini render...' });
                res = await fetchWithTimeout(retryUrl, 35000);
                if (!res.ok) {
                    const errJson = await res.json().catch(() => null);
                    throw new Error(errJson?.error?.message || `Image API retry returned HTTP ${res.status}`);
                }
            }

            const blob = await res.blob();
            const dataUrl = await blobToDataUrl(blob);
            const durationMs = Math.round(performance.now() - startTime);

            self.postMessage({
                action: 'complete',
                id,
                prompt,
                dataUrl,
                url: proxyUrl,
                provider: 'gemini_api',
                durationMs,
                width,
                height
            });
        } catch (error) {
            self.postMessage({
                action: 'error',
                id,
                error: error.message || 'Image generation failed'
            });
        }
    }
};
