import wasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url';
import wasmModuleUrl from 'onnxruntime-web/ort-wasm-simd-threaded.jsep.mjs?url';

export const VISION_CAPTION_MODEL_ID = 'Xenova/vit-gpt2-image-captioning';
export const VISION_CLASSIFY_MODEL_ID = 'Xenova/vit-base-patch16-224';
export const VISION_MODEL_CACHE = 'jarvis-local-vision-model-v1';

let captioner = null;
let classifier = null;
let RawImageClass = null;
let loadingPromise = null;

function publishStatus(status) {
    self.postMessage({ status });
}

function isAllowedVisionAssetUrl(href) {
    try {
        const url = new URL(href);
        if (url.protocol !== 'https:') return false;
        return url.hostname === 'huggingface.co'
            || url.hostname.endsWith('.hf.co')
            || url.hostname.endsWith('.huggingface.co');
    } catch {
        return false;
    }
}

async function cachedVisionFetch(input, init) {
    const href = typeof input === 'string' ? input : input?.url || '';
    if (!isAllowedVisionAssetUrl(href)) {
        throw new Error(`Blocked unexpected vision model origin: ${href}`);
    }
    const method = String(init?.method || 'GET').toUpperCase();
    const storage = await globalThis.caches?.open(VISION_MODEL_CACHE).catch(() => null);
    if (method === 'GET' && storage) {
        const cached = await storage.match(href).catch(() => null);
        if (cached) return cached;
    }
    const headers = new Headers(init?.headers || {});
    headers.delete('Range');
    const response = await fetch(href, {
        ...init,
        headers,
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
    });
    if (response.ok && method === 'GET' && storage && response.status === 200) {
        try {
            await storage.put(href, response.clone());
        } catch {
            // Storage quota exhaustion should not block inference.
        }
    }
    return response;
}

async function initializeVisionPipelines() {
    if (!loadingPromise) {
        loadingPromise = (async () => {
            publishStatus('loading');
            const transformers = await import('@huggingface/transformers');
            const { pipeline, env, RawImage } = transformers;
            RawImageClass = RawImage;
            env.allowLocalModels = false;
            env.useBrowserCache = false;
            env.useCustomCache = false;
            env.useWasmCache = false;
            env.fetch = cachedVisionFetch;
            env.backends.onnx.wasm.numThreads = 1;
            env.backends.onnx.wasm.proxy = false;
            env.backends.onnx.wasm.wasmPaths = { wasm: wasmUrl, mjs: wasmModuleUrl };

            const [loadedCaptioner, loadedClassifier] = await Promise.all([
                pipeline('image-to-text', VISION_CAPTION_MODEL_ID, { dtype: 'q8', device: 'wasm' }).catch(() => null),
                pipeline('image-classification', VISION_CLASSIFY_MODEL_ID, { dtype: 'q8', device: 'wasm' }).catch(() => null)
            ]);
            captioner = loadedCaptioner;
            classifier = loadedClassifier;
            if (!captioner && !classifier) {
                throw new Error('Unable to initialize on-device ONNX vision models');
            }
            publishStatus('ready');
            return true;
        })().catch((err) => {
            loadingPromise = null;
            publishStatus('unavailable');
            throw err;
        });
    }
    return loadingPromise;
}

async function analyzeImagePayload(payload = {}) {
    const dataUrl = String(payload?.imageDataUrl || '').trim();
    if (!dataUrl) throw new Error('Missing image data for local vision analysis');
    await initializeVisionPipelines();
    const imageInput = RawImageClass && typeof RawImageClass.fromURL === 'function'
        ? await RawImageClass.fromURL(dataUrl)
        : dataUrl;

    const [captionOut, classifyOut] = await Promise.all([
        captioner ? captioner(imageInput, { max_new_tokens: 48 }).catch(() => null) : Promise.resolve(null),
        classifier ? classifier(imageInput, { top_k: 5 }).catch(() => null) : Promise.resolve(null)
    ]);

    const caption = Array.isArray(captionOut)
        ? String(captionOut[0]?.generated_text || '').trim()
        : String(captionOut?.generated_text || '').trim();
    const labels = Array.isArray(classifyOut)
        ? classifyOut
            .map((entry) => ({
                label: String(entry?.label || '').split(',')[0].trim(),
                score: Number.isFinite(Number(entry?.score)) ? Math.round(Number(entry.score) * 1000) / 1000 : 0
            }))
            .filter((entry) => entry.label && entry.score >= 0.04)
            .slice(0, 5)
        : [];

    if (!caption && labels.length === 0) {
        throw new Error('On-device ONNX vision produced no classification or caption');
    }
    return {
        caption,
        labels,
        models: [
            ...(captioner ? [VISION_CAPTION_MODEL_ID] : []),
            ...(classifier ? [VISION_CLASSIFY_MODEL_ID] : [])
        ]
    };
}

self.onmessage = async ({ data }) => {
    const { id, operation, payload } = data || {};
    try {
        let result;
        if (operation === 'initialize') {
            result = await initializeVisionPipelines();
        } else if (operation === 'analyze') {
            result = await analyzeImagePayload(payload);
        } else {
            throw new Error(`Unknown vision worker operation: ${operation}`);
        }
        self.postMessage({ id, result });
    } catch (error) {
        self.postMessage({ id, error: String(error?.message || 'On-device vision unavailable') });
    }
};
