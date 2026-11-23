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
    const start = performance.now();
    try {
        const image = await generateFreeImage(prompt, { ...opts, signal: controller.signal, onProgress: event => { reportStatus(event.phase); (opts.onProgress || onProgress)?.(event); } });
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
