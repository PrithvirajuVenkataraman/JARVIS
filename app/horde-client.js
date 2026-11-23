// Anonymous AI Horde only. No API key, account, billing, or automatic provider fallback.
const API = 'https://aihorde.net/api/v2';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const abortError = () => new DOMException('Image generation canceled.', 'AbortError');

async function request(path, options = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    const timer = setTimeout(abort, 15000);
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) controller.abort();
    try {
        const response = await fetch(API + path, { ...options, signal: controller.signal, credentials: 'omit',
            headers: { 'Content-Type': 'application/json', apikey: '0000000000', 'Client-Agent': 'JARVIS:1.0:https://jarvisjr.vercel.app' } });
        if (!response.ok) {
            const rawRetry = response.headers?.get?.('retry-after');
            const seconds = rawRetry != null && /^\d+(?:\.\d+)?$/.test(rawRetry.trim()) ? Number(rawRetry) : NaN;
            const requestedWait = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(rawRetry || '') - Date.now();
            const retryAfterMs = Number.isFinite(requestedWait) ? Math.max(0, Math.min(86400000, requestedWait)) : response.status === 429 ? 60000 : 0;
            throw Object.assign(new Error(response.status === 429
                ? 'The free image queue is at capacity. Please try again later.'
                : 'The free image service is temporarily unavailable. Please try again later.'), {
                code: response.status === 429 ? 'image_queue_full' : response.status === 403 ? 'image_access_denied' : 'image_service_unavailable',
                retryAfterMs
            });
        }
        return await response.json();
    } catch (error) {
        if (controller.signal.aborted && !options.signal?.aborted) throw new Error('The free image service did not respond in time. Please try again later.', { cause: error });
        throw error;
    } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}

function delay(ms, signal) {
    return new Promise((resolve, reject) => {
        const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
        const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(abortError()); };
        const timer = setTimeout(finish, ms);
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
    });
}

export async function generateFreeImage(prompt, { signal, width = 512, height = 512, onProgress, timeoutMs = 600000, pollMs = 4000 } = {}) {
    if (signal?.aborted) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, Math.min(600000, Math.max(1000, timeoutMs)));
    let id = '';
    let complete = false;
    try {
        onProgress?.({ phase: 'submit', message: 'Submitting to the free community queue…' });
        const dimension = value => Math.max(256, Math.min(768, Math.round(Number(value || 512) / 64) * 64));
        const submitted = await request('/generate/async', { method: 'POST', signal: controller.signal, body: JSON.stringify({
            prompt: String(prompt).slice(0, 6000), nsfw: false, censor_nsfw: true, trusted_workers: true,
            r2: false, shared: false, params: { width: dimension(width), height: dimension(height), steps: 25, n: 1, sampler_name: 'k_euler', cfg_scale: 7 }
        }) });
        if (!uuid.test(submitted.id || '')) throw new Error('The image service returned an invalid job.');
        id = submitted.id;
        while (!controller.signal.aborted) {
            const state = await request('/generate/check/' + id, { signal: controller.signal });
            if (state.faulted) throw new Error('The free image worker could not complete this request.');
            if (state.is_possible === false) throw new Error('No free community worker can currently handle this image. Please try again later.');
            if (state.done) break;
            const waiting = Math.max(0, Math.ceil(Number(state.wait_time) || 0));
            onProgress?.({ phase: state.processing ? 'generating' : 'queued', queuePosition: state.queue_position,
                message: state.processing ? 'A community worker is generating your image…' : `Waiting in the free community queue${waiting ? ` · about ${waiting}s` : ''}. You can stop at any time.` });
            await delay(pollMs, controller.signal);
        }
        if (controller.signal.aborted) throw abortError();
        const status = await request('/generate/status/' + id, { signal: controller.signal });
        const image = status.generations?.[0];
        if (!image || image.censored) throw new Error('The image service could not return an image for this request.');
        // r2:false returns base64, never an arbitrary URL supplied by a worker.
        if (typeof image.img !== 'string' || image.img.length > 8000000 || !/^[A-Za-z0-9+/=]+$/.test(image.img)) throw new Error('The image service returned invalid image data.');
        const header = atob(image.img.slice(0, 64));
        const mime = header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP' ? 'image/webp'
            : header.startsWith('\x89PNG') ? 'image/png' : header.startsWith('\xff\xd8\xff') ? 'image/jpeg' : '';
        if (!mime) throw new Error('The image service returned an unsupported image format.');
        complete = true;
        return { dataUrl: `data:${mime};base64,${image.img}`, provider: 'ai_horde_free', model: image.model || 'community', width: dimension(width), height: dimension(height) };
    } catch (error) {
        if (controller.signal.aborted && !signal?.aborted) throw new Error('The free image queue timed out. Your job was canceled. Please try again later.', { cause: error });
        throw error;
    } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (id && !complete) void request('/generate/status/' + id, { method: 'DELETE', keepalive: true }).catch(() => {});
    }
}
