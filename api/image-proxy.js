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

async function generateGeminiImageBuffer(prompt, { width = 512, height = 512, timeoutMs = 25000 } = {}) {
    const apiKey = String(process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) return null;

    let aspectRatio = '1:1';
    if (width && height) {
        const ratio = width / height;
        if (ratio >= 1.5) aspectRatio = '16:9';
        else if (ratio >= 1.25) aspectRatio = '4:3';
        else if (ratio <= 0.67) aspectRatio = '9:16';
        else if (ratio <= 0.8) aspectRatio = '3:4';
    }

    const primaryTimeout = Math.min(14000, timeoutMs);
    const secondaryTimeout = Math.min(10000, Math.max(5000, timeoutMs - primaryTimeout));

    // 1. Primary: gemini-2.5-flash-image with native IMAGE response modality via Google GenAI REST
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), primaryTimeout);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        responseModalities: ['IMAGE']
                    }
                })
            });
            if (res.ok) {
                const data = await res.json();
                const part = data?.candidates?.[0]?.content?.parts?.find(p => p.inlineData?.data);
                if (part?.inlineData?.data) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    const buffer = Buffer.from(part.inlineData.data, 'base64');
                    return { buffer, contentType: mimeType, model: 'gemini-2.5-flash-image' };
                }
            }
        } finally {
            clearTimeout(timer);
        }
    } catch (_) {}

    // 2. Secondary: imagen-3.0-generate-002 fallback
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), secondaryTimeout);
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/imagen-3.0-generate-002:predict?key=${encodeURIComponent(apiKey)}`;
            const res = await fetch(url, {
                method: 'POST',
                signal: controller.signal,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    instances: [{ prompt }],
                    parameters: { sampleCount: 1, aspectRatio }
                })
            });
            if (res.ok) {
                const data = await res.json();
                const pred = data?.predictions?.[0];
                const b64 = pred?.bytesBase64Encoded;
                if (b64) {
                    const mimeType = pred.mimeType || 'image/png';
                    const buffer = Buffer.from(b64, 'base64');
                    return { buffer, contentType: mimeType, model: 'imagen-3.0' };
                }
            }
        } finally {
            clearTimeout(timer);
        }
    } catch (_) {}

    return null;
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
    const acceptsJson = String(req.headers?.['accept'] || '').includes('application/json') || params.response_format === 'json' || params.format === 'json';

    // Tier 1: Gemini-First high-fidelity generation via native Google GenAI REST
    // Always attempt Gemini first when available unless explicitly forced to use Pollinations
    const forcePollinations = params.provider === 'pollinations' || params.fallback === 'pollinations' || requestedModel === 'pollinations';
    if (!forcePollinations) {
        const geminiResult = await generateGeminiImageBuffer(prompt, { width, height });
        if (geminiResult && geminiResult.buffer && geminiResult.buffer.length > 500) {
            res.setHeader('Content-Type', geminiResult.contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
            res.setHeader('X-Image-Model', geminiResult.model);

            if (acceptsJson) {
                return res.status(200).json({
                    success: true,
                    image: geminiResult.buffer.toString('base64'),
                    dataUrl: `data:${geminiResult.contentType};base64,${geminiResult.buffer.toString('base64')}`,
                    model: geminiResult.model
                });
            }

            const responder = typeof res.status === 'function' ? res.status(200) : res;
            if (responder && typeof responder.send === 'function') return responder.send(geminiResult.buffer);
            if (responder && typeof responder.end === 'function') return responder.end(geminiResult.buffer);
            if (typeof res.send === 'function') return res.send(geminiResult.buffer);
            if (typeof res.end === 'function') return res.end(geminiResult.buffer);
            return;
        }
    }

    // Tier 2: Graceful failover to Pollinations (Flux / Turbo)
    const fallbackModel = (requestedModel.includes('gemini') || requestedModel.includes('google')) ? 'flux' : requestedModel;
    const modelsToTry = Array.from(new Set([fallbackModel, 'flux', 'turbo']));

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

                if (acceptsJson) {
                    return res.status(200).json({
                        success: true,
                        image: buffer.toString('base64'),
                        dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
                        model
                    });
                }

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
