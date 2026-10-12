export const config = { maxDuration: 60 };

const DEFAULT_IMAGE_NEGATIVE_PROMPT = 'text,watermark,words,letters,signature,typography,lowres,blurry';
const IMAGE_PROXY_TIMEOUT_MS = 20000;

async function fetchProxyImageBuffer(url, timeoutMs = IMAGE_PROXY_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const upstreamRes = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        });
        if (!upstreamRes.ok) {
            throw new Error(`Upstream returned HTTP ${upstreamRes.status}`);
        }
        const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
        const arrayBuf = await upstreamRes.arrayBuffer();
        return {
            buffer: Buffer.from(arrayBuf),
            contentType
        };
    } finally {
        clearTimeout(timer);
    }
}

function buildPollinationsUrl(prompt, { width = 512, height = 512, model = 'turbo', seed = 42, negativePrompt = '' } = {}) {
    const encodedPrompt = encodeURIComponent(String(prompt || '').trim());
    let url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&nologo=true&seed=${seed}`;
    if (negativePrompt && model !== 'turbo') {
        url += `&negative_prompt=${encodeURIComponent(String(negativePrompt).trim())}`;
    }
    return url;
}

export async function imageProxyHandler(req, res) {
    if (req.method === 'OPTIONS') {
        if (typeof res.setHeader === 'function') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        }
        return res.status(204).end();
    }

    if (typeof res.setHeader === 'function') {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }

    let params = {};
    if (req.method === 'POST') {
        params = req.body || {};
    } else {
        const urlObj = new URL(req.url || '/', 'http://localhost');
        params = Object.fromEntries(urlObj.searchParams.entries());
    }

    const prompt = String(params.prompt || '').trim();
    if (!prompt) {
        return res.status(400).json({
            success: false,
            error: { code: 'missing_prompt', message: 'Prompt parameter is required.' }
        });
    }

    const width = Math.min(1280, Math.max(256, Number(params.width) || 512));
    const height = Math.min(1280, Math.max(256, Number(params.height) || 512));
    const seed = Number(params.seed) || Math.floor(Math.random() * 1000000);
    const requestedModel = String(params.model || 'flux').trim().toLowerCase();
    const negativePrompt = params.negative_prompt || params.negativePrompt || DEFAULT_IMAGE_NEGATIVE_PROMPT;

    const modelsToTry = Array.from(new Set([requestedModel, 'flux', 'turbo']));

    let lastError = null;
    let fallbackDirectUrl = '';
    for (const model of modelsToTry) {
        const targetUrl = buildPollinationsUrl(prompt, { width, height, model, seed, negativePrompt });
        if (!fallbackDirectUrl) fallbackDirectUrl = targetUrl;
        try {
            const { buffer, contentType } = await fetchProxyImageBuffer(targetUrl, IMAGE_PROXY_TIMEOUT_MS);
            if (buffer && buffer.length > 500) {
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                res.setHeader('X-Image-Model', model);
                const responder = typeof res.status === 'function' ? res.status(200) : res;
                if (responder && typeof responder.send === 'function') {
                    return responder.send(buffer);
                }
                if (responder && typeof responder.end === 'function') {
                    return responder.end(buffer);
                }
                if (typeof res.send === 'function') {
                    return res.send(buffer);
                }
                if (typeof res.end === 'function') {
                    return res.end(buffer);
                }
                return;
            }
        } catch (err) {
            lastError = err;
            if (String(err?.message || '').includes('429')) {
                await new Promise(r => setTimeout(r, 1200));
            }
        }
    }

    // Direct browser redirect failover if serverless proxy times out or is rate limited
    if (fallbackDirectUrl && req.method === 'GET') {
        if (typeof res.redirect === 'function') {
            return res.redirect(307, fallbackDirectUrl);
        }
        if (typeof res.setHeader === 'function') {
            res.setHeader('Location', fallbackDirectUrl);
        }
        if (typeof res.status === 'function') {
            const responder = res.status(307);
            if (responder && typeof responder.end === 'function') return responder.end();
        }
        if (typeof res.end === 'function') {
            return res.end();
        }
    }

    return res.status(502).json({
        success: false,
        error: {
            code: 'image_generation_failed',
            message: `Image generation failed across all fallback models: ${lastError?.message || 'Unknown error'}`
        }
    });
}

export default imageProxyHandler;
