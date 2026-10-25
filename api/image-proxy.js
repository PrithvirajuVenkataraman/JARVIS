export const config = { maxDuration: 60 };

const DEFAULT_IMAGE_NEGATIVE_PROMPT = 'text,watermark,words,letters,signature,typography,lowres,blurry';
const IMAGE_PROXY_TIMEOUT_MS = 30000;

function resolveGeminiApiKey(customApiKey = '', req = null, params = {}) {
    return String(
        customApiKey ||
        params?.apiKey ||
        params?.gemini_api_key ||
        params?.key ||
        req?.headers?.['x-gemini-api-key'] ||
        req?.headers?.['x-goog-api-key'] ||
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        ''
    ).trim();
}

/**
 * Generates an image using Google Gemini / Imagen models exclusively.
 * Routes to native Google Generative Language REST APIs.
 */
async function generateGeminiImageBuffer(prompt, {
    width = 512,
    height = 512,
    timeoutMs = 35000,
    apiKey: customApiKey = '',
    aspectRatio: customAspectRatio = '',
    requestedModel = ''
} = {}) {
    const apiKey = resolveGeminiApiKey(customApiKey);
    if (!apiKey) {
        return {
            success: false,
            code: 'missing_gemini_key',
            message: 'Gemini API key is required. Please configure GEMINI_API_KEY in your environment or provide it in the request.'
        };
    }

    let aspectRatio = '1:1';
    const validRatios = new Set(['1:1', '3:4', '4:3', '9:16', '16:9']);
    if (customAspectRatio && validRatios.has(customAspectRatio)) {
        aspectRatio = customAspectRatio;
    } else if (width && height) {
        const ratio = width / height;
        if (ratio >= 1.5) aspectRatio = '16:9';
        else if (ratio >= 1.25) aspectRatio = '4:3';
        else if (ratio <= 0.67) aspectRatio = '9:16';
        else if (ratio <= 0.8) aspectRatio = '3:4';
    }

    let lastError = null;

    // Define candidate models in priority order: genuine Imagen 3 predict model, then Gemini image candidate
    const candidateModels = [];
    if (requestedModel && !['auto', 'gemini', 'imagen'].includes(requestedModel)) {
        candidateModels.push(requestedModel);
    }
    candidateModels.push(
        'imagen-3.0-generate-002',
        'gemini-2.5-flash-image'
    );

    const triedModels = new Set();

    for (const model of candidateModels) {
        if (triedModels.has(model)) continue;
        triedModels.add(model);

        const isImagenPredict = model.includes('imagen-3.0');
        const timeout = Math.min(25000, timeoutMs);

        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);

            try {
                if (isImagenPredict) {
                    // Google GenAI REST :predict
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(apiKey)}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        signal: controller.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': apiKey
                        },
                        body: JSON.stringify({
                            instances: [{ prompt }],
                            parameters: {
                                sampleCount: 1,
                                aspectRatio,
                                outputMimeType: 'image/jpeg'
                            }
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const pred = data?.predictions?.[0];
                        const b64 = pred?.bytesBase64Encoded;
                        if (b64) {
                            const mimeType = pred.mimeType || 'image/jpeg';
                            const buffer = Buffer.from(b64, 'base64');
                            return { success: true, buffer, contentType: mimeType, model };
                        }
                    } else {
                        const errText = await res.text().catch(() => '');
                        lastError = new Error(`Imagen (${model}) HTTP ${res.status}: ${errText.slice(0, 200)}`);
                        console.error(`[image-proxy] Imagen upstream error (${model}):`, res.status, errText.slice(0, 200));
                    }
                } else {
                    // Google Gemini REST :generateContent with IMAGE modality
                    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
                    const res = await fetch(url, {
                        method: 'POST',
                        signal: controller.signal,
                        headers: {
                            'Content-Type': 'application/json',
                            'x-goog-api-key': apiKey
                        },
                        body: JSON.stringify({
                            contents: [{ parts: [{ text: prompt }] }],
                            generationConfig: {
                                responseModalities: ['TEXT', 'IMAGE']
                            }
                        })
                    });

                    if (res.ok) {
                        const data = await res.json();
                        const parts = data?.candidates?.[0]?.content?.parts || [];
                        const imagePart = parts.find(p => p.inlineData?.data);
                        if (imagePart?.inlineData?.data) {
                            const mimeType = imagePart.inlineData.mimeType || 'image/png';
                            const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
                            return { success: true, buffer, contentType: mimeType, model };
                        }
                    } else {
                        const errText = await res.text().catch(() => '');
                        lastError = new Error(`Gemini (${model}) HTTP ${res.status}: ${errText.slice(0, 200)}`);
                        console.error(`[image-proxy] Gemini image error (${model}):`, res.status, errText.slice(0, 200));
                    }
                }
            } finally {
                clearTimeout(timer);
            }
        } catch (err) {
            lastError = err;
            console.error(`[image-proxy] Request error for model ${model}:`, err?.message || err);
        }
    }

    return {
        success: false,
        code: 'gemini_image_generation_failed',
        message: lastError?.message || 'Gemini image generation failed across all available models.'
    };
}

export async function imageProxyHandler(req, res) {
    if (req.method === 'OPTIONS') {
        if (typeof res.setHeader === 'function') {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-gemini-api-key, x-goog-api-key');
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
    const requestedModel = String(params.model || '').trim().toLowerCase();
    const acceptsJson = String(req.headers?.['accept'] || '').includes('application/json') || params.response_format === 'json' || params.format === 'json';
    const clientApiKey = resolveGeminiApiKey('', req, params);

    // Route exclusively to Gemini API (Imagen 3 / Gemini multimodal image generation)
    const geminiResult = await generateGeminiImageBuffer(prompt, {
        width,
        height,
        timeoutMs: 35000,
        apiKey: clientApiKey,
        aspectRatio: params.aspectRatio || params.aspect_ratio || '',
        requestedModel
    });

    if (geminiResult && geminiResult.success && geminiResult.buffer && geminiResult.buffer.length > 500) {
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

    if (geminiResult?.code === 'missing_gemini_key') {
        return res.status(401).json({
            success: false,
            error: {
                code: 'missing_gemini_key',
                message: geminiResult.message || 'Gemini API key is required. Please set GEMINI_API_KEY in your environment.'
            }
        });
    }

    // Tier 2: Resilient failover to high-fidelity diffusion (Flux / Turbo) when Gemini/Imagen encounters quota, 403/404, or upstream failure
    console.warn('[image-proxy] Google GenAI image generation unavailable, failing over to Tier-2 diffusion:', geminiResult?.message);
    const fallbackSeed = Number(params.seed) || Math.floor(Math.random() * 1000000);
    const fallbackModels = ['flux', 'turbo'];
    for (const fbModel of fallbackModels) {
        const encodedPrompt = encodeURIComponent(prompt);
        const fbUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${fbModel}&nologo=true&seed=${fallbackSeed}`;
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 20000);
            const upstreamRes = await fetch(fbUrl, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
                }
            });
            clearTimeout(timer);
            if (upstreamRes.ok) {
                const arrayBuf = await upstreamRes.arrayBuffer();
                const buffer = Buffer.from(arrayBuf);
                if (buffer.length > 500) {
                    const contentType = upstreamRes.headers.get('content-type') || 'image/jpeg';
                    res.setHeader('Content-Type', contentType);
                    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                    res.setHeader('X-Image-Model', `fallback-${fbModel}`);
                    if (acceptsJson) {
                        return res.status(200).json({
                            success: true,
                            image: buffer.toString('base64'),
                            dataUrl: `data:${contentType};base64,${buffer.toString('base64')}`,
                            model: `fallback-${fbModel}`
                        });
                    }
                    const responder = typeof res.status === 'function' ? res.status(200) : res;
                    if (responder && typeof responder.send === 'function') return responder.send(buffer);
                    if (responder && typeof responder.end === 'function') return responder.end(buffer);
                    if (typeof res.send === 'function') return res.send(buffer);
                    if (typeof res.end === 'function') return res.end(buffer);
                    return;
                }
            }
        } catch (fbErr) {
            console.error(`[image-proxy] Tier-2 fallback model ${fbModel} failed:`, fbErr?.message || fbErr);
        }
    }

    return res.status(502).json({
        success: false,
        error: {
            code: 'image_generation_failed',
            message: 'Unable to generate image. Please check your network connection and try again.'
        }
    });
}

export default imageProxyHandler;
