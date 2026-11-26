import { getImageConfig } from './image-generation-config.js';
import { saveGeneratedImage, getRecentGeneratedImages, deleteGeneratedImage, clearAllGeneratedImages } from './image-storage.js';
import { dlpGateway } from './dlp-gateway.js';
import { generateFreeImage } from './horde-client.js';

const jobs = new Map();
let latestJobId;
export async function validateGeneratedImage(dataUrl, signal) {
    signal?.throwIfAborted();
    const image = new Image();
    image.src = dataUrl;
    let timer;
    let abort;
    try {
        await new Promise((resolve, reject) => {
            abort = () => { image.src = ''; reject(signal.reason); };
            signal?.addEventListener('abort', abort, { once: true });
            timer = setTimeout(() => { image.src = ''; reject(new Error('Image decoding exceeded its time limit.')); }, 5000);
            image.decode().then(resolve, reject);
        });
        signal?.throwIfAborted();
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 4096 || image.naturalHeight > 4096 || image.naturalWidth * image.naturalHeight > 16777216) throw new Error('Invalid image dimensions.');
        return { width: image.naturalWidth, height: image.naturalHeight };
    } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw Object.assign(new Error('The image worker returned an unreadable image.', { cause: error }), { code: 'image_decode_failed' });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); image.src = ''; }
}
function shouldTryFastProxy(opts) {
    if (typeof opts?.preferServerProxy === 'boolean') return opts.preferServerProxy;
    const capApi = globalThis.JarvisCapabilities;
    if (capApi?.hasLoaded?.()) {
        return capApi.getCapability?.('images')?.fastProxy === true;
    }
    return typeof window !== 'undefined';
}

async function generateFastProxyImage(prompt, { signal, width = 512, height = 512, steps, seed, onProgress } = {}) {
    signal?.throwIfAborted();
    onProgress?.({ phase: 'generating', provider: 'fast_proxy', message: 'Creating your image…' });
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 45000);
    signal?.addEventListener('abort', abort, { once: true });
    try {
        const payload = { prompt, width, height };
        if (Number.isFinite(Number(steps))) payload.steps = Number(steps);
        if (Number.isInteger(Number(seed)) && Number(seed) >= 0) payload.seed = Number(seed);
        const response = await fetch('/api/image-proxy', {
            method: 'POST',
            signal: controller.signal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await response.json().catch(() => null);
        if (!response.ok || !data || typeof data.dataUrl !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,/i.test(data.dataUrl)) {
            throw Object.assign(new Error(data?.error?.message || 'Fast free-tier image generation unavailable.'), {
                code: data?.error?.code || 'image_fast_proxy_failed',
                fallbackEligible: data?.error?.fallbackEligible !== false,
                status: response.status
            });
        }
        return data;
    } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
    }
}

export async function generateImage(promptOrOptions, options = {}, onProgress = null) {
    const opts = typeof promptOrOptions === 'object' ? { ...promptOrOptions, ...options } : options;
    let prompt = String((promptOrOptions && typeof promptOrOptions === 'object' ? promptOrOptions.prompt : promptOrOptions) || '').trim();
    if (!prompt) throw new Error('Describe the image you want to create.');
    const dlp = dlpGateway(prompt, { channel: 'image_prompt', conversationId: opts.conversationId || globalThis.getActiveChatSession?.()?.id || 'current' });
    if (dlp.decision === 'BLOCK') throw new Error('Remove sensitive credentials from the image prompt.');
    prompt = dlp.sanitizedText || prompt;
    const id = opts.id || `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) controller.abort();
    jobs.set(id, controller);
    latestJobId = id;
    const reportStatus = (state, reason = state) => { if (latestJobId === id) globalThis.JarvisCapabilities?.setRuntimeStatus?.('images', state, reason); };
    const forwardProgress = event => { reportStatus(event.phase); (opts.onProgress || onProgress)?.(event); };
    const start = performance.now();
    try {
        let image = null;
        if (shouldTryFastProxy(opts)) {
            try {
                image = await generateFastProxyImage(prompt, { ...opts, signal: controller.signal, onProgress: forwardProgress });
            } catch (proxyError) {
                if (controller.signal.aborted) throw proxyError;
                if (proxyError?.fallbackEligible === false) throw proxyError;
                forwardProgress({ phase: 'queued', provider: 'ai_horde_free', message: 'Switching to the free community queue…' });
            }
        }
        if (!image) {
            image = await generateFreeImage(prompt, { ...opts, signal: controller.signal, onProgress: forwardProgress });
        }
        if (controller.signal.aborted) throw new DOMException('Image generation canceled.', 'AbortError');
        const dimensions = await validateGeneratedImage(image.dataUrl, controller.signal);
        const result = { ...image, ...dimensions, id, success: true, prompt, durationMs: Math.round(performance.now() - start) };
        const saved = await saveGeneratedImage(result, { signal: controller.signal }).catch(() => ({ persisted: false }));
        if (controller.signal.aborted) { if (saved?.persisted) await deleteGeneratedImage(id); throw new DOMException('Image generation canceled.', 'AbortError'); }
        result.persisted = saved?.persisted === true;
        reportStatus('ready', 'generation_complete');
        return result;
    } catch (error) {
        reportStatus(controller.signal.aborted ? 'idle' : error.code === 'image_queue_full' ? 'busy' : 'unavailable', controller.signal.aborted ? 'cancelled' : error.code || 'image_provider_failure');
        throw error;
    } finally { jobs.delete(id); opts.signal?.removeEventListener('abort', abort); }
}
export function cancelImageGeneration(id) { jobs.get(id)?.abort(); }
export function cancelAllImageGeneration() { for (const job of jobs.values()) job.abort(); }
globalThis.addEventListener?.('pagehide', cancelAllImageGeneration);
export async function checkWebGpuSupport() { return false; }
export { getImageConfig, saveGeneratedImage, getRecentGeneratedImages, deleteGeneratedImage, clearAllGeneratedImages };
