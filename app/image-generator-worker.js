/**
 * @file app/image-generator-worker.js
 * @description Dedicated background Web Worker for zero-cost AI image diffusion
 * and generation. Keeps the main UI thread at a responsive 60 FPS.
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
    // Universal fallback in Worker without FileReader
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
            self.postMessage({ action: 'progress', id, phase: 'init', percent: 20, message: 'Connecting to fast AI engine...' });

            const model = options.model || 'turbo';
            const negativePrompt = encodeURIComponent(options.negativePrompt || 'text,watermark,words,letters,signature,typography,lowres,blurry');
            const encodedPrompt = encodeURIComponent(String(prompt || '').trim());
            let seed = options.seed || Math.floor(Math.random() * 1000000);

            let fallbackUrl = options.fallbackUrl || (options.fallbackEndpointTemplate
                ? options.fallbackEndpointTemplate
                    .replace('{prompt}', encodedPrompt)
                    .replace('{width}', String(width))
                    .replace('{height}', String(height))
                    .replace('{model}', encodeURIComponent(model))
                    .replace('{negativePrompt}', negativePrompt)
                    .replace('{seed}', String(seed))
                : `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&negative_prompt=${negativePrompt}&nologo=true&seed=${seed}`);

            self.postMessage({ action: 'progress', id, phase: 'download', percent: 55, message: 'Generating AI image...' });

            async function fetchWithTimeout(url, timeoutMs = 25000) {
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
                res = await fetchWithTimeout(fallbackUrl, 25000);
                if (!res.ok) throw new Error(`Cloud engine returned HTTP ${res.status}`);
            } catch (firstErr) {
                // Retry once with a fresh random seed and turbo
                seed = Math.floor(Math.random() * 1000000);
                fallbackUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=turbo&negative_prompt=${negativePrompt}&nologo=true&seed=${seed}`;
                self.postMessage({ action: 'progress', id, phase: 'download', percent: 75, message: 'Retrying fast render...' });
                res = await fetchWithTimeout(fallbackUrl, 25000);
                if (!res.ok) throw new Error(`Cloud engine retry returned HTTP ${res.status}`);
            }

            const blob = await res.blob();
            const dataUrl = await blobToDataUrl(blob);
            const durationMs = Math.round(performance.now() - startTime);

            self.postMessage({
                action: 'complete',
                id,
                prompt,
                dataUrl,
                fallbackUrl,
                url: fallbackUrl,
                provider: 'free_cloud',
                durationMs,
                width,
                height
            });
        } catch (error) {
            self.postMessage({
                action: 'error',
                id,
                error: String(error?.message || 'Image generation failed')
            });
        }
    }
};
