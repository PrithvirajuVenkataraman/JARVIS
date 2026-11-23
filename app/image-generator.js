import { getImageConfig } from './image-generation-config.js';
import { saveGeneratedImage, getRecentGeneratedImages, deleteGeneratedImage, clearAllGeneratedImages } from './image-storage.js';
import { dlpGateway } from './dlp-gateway.js';
import { generateFreeImage } from './horde-client.js';

const jobs = new Map();
export async function generateImage(promptOrOptions, options = {}, onProgress = null) {
    const opts = typeof promptOrOptions === 'object' ? { ...promptOrOptions, ...options } : options;
    let prompt = String((promptOrOptions && typeof promptOrOptions === 'object' ? promptOrOptions.prompt : promptOrOptions) || '').trim();
    if (!prompt) throw new Error('Describe the image you want to create.');
    const dlp = dlpGateway(prompt, { channel: 'image' });
    if (dlp.decision === 'BLOCK') throw new Error('Remove sensitive credentials from the image prompt.');
    prompt = dlp.sanitizedText || prompt;
    const id = opts.id || `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    const abort = () => controller.abort();
    opts.signal?.addEventListener('abort', abort, { once: true });
    if (opts.signal?.aborted) controller.abort();
    jobs.set(id, controller);
    const start = performance.now();
    try {
        const image = await generateFreeImage(prompt, { ...opts, signal: controller.signal, onProgress: opts.onProgress || onProgress });
        if (controller.signal.aborted) throw new DOMException('Image generation canceled.', 'AbortError');
        const result = { ...image, id, success: true, prompt, durationMs: Math.round(performance.now() - start) };
        await saveGeneratedImage(result).catch(() => {});
        return result;
    } finally { jobs.delete(id); opts.signal?.removeEventListener('abort', abort); }
}
export function cancelImageGeneration(id) { jobs.get(id)?.abort(); }
export function cancelAllImageGeneration() { for (const job of jobs.values()) job.abort(); }
export async function checkWebGpuSupport() { return false; }
export { getImageConfig, saveGeneratedImage, getRecentGeneratedImages, deleteGeneratedImage, clearAllGeneratedImages };
