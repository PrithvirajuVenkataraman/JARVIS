export const config = { maxDuration: 60 };

const DEFAULT_IMAGE_NEGATIVE_PROMPT = 'text,watermark,words,letters,signature,typography,lowres,blurry';
const IMAGE_PROXY_TIMEOUT_MS = 30000;

function getEnvGeminiApiKey() {
    return String(
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        ''
    ).trim();
}

function resolveCandidateApiKeys(customApiKey = '', req = null, params = {}) {
    const keys = [];
    const clientKey = String(
        customApiKey ||
        params?.apiKey ||
        params?.gemini_api_key ||
        params?.key ||
        req?.headers?.['x-gemini-api-key'] ||
        req?.headers?.['x-goog-api-key'] ||
        ''
    ).trim();
    if (clientKey) keys.push(clientKey);

    const envKey = getEnvGeminiApiKey();
    if (envKey && !keys.includes(envKey)) {
        keys.push(envKey);
    }
    return keys;
}

function resolveGeminiApiKey(customApiKey = '', req = null, params = {}) {
    const candidateKeys = resolveCandidateApiKeys(customApiKey, req, params);
    return candidateKeys[0] || '';
}

function extractImageFromData(data) {
    if (!data || typeof data !== 'object') return null;

    // 1. Google GenAI Interactions API steps format (interaction.steps -> step.type == 'model_output' -> part.type == 'image' -> part.data)
    if (Array.isArray(data.steps)) {
        for (const step of data.steps) {
            if (step?.type === 'model_output' && Array.isArray(step?.content)) {
                for (const part of step.content) {
                    if (part?.type === 'image') {
                        const b64 = part.data || part.image?.data || part.inlineData?.data || part.bytesBase64Encoded;
                        if (b64) {
                            const mimeType = part.mimeType || part.mime_type || 'image/png';
                            return { b64, mimeType };
                        }
                    }
                }
            }
        }
    }

    // 2. Direct output_image / outputImage property
    const outImg = data.output_image || data.outputImage;
    if (outImg?.data) {
        return {
            b64: outImg.data,
            mimeType: outImg.mimeType || outImg.mime_type || 'image/png'
        };
    }

    // 3. Gemini generateContent candidates format
    const parts = data.candidates?.[0]?.content?.parts || [];
    for (const p of parts) {
        if (p?.type === 'image' && p?.data) {
            return { b64: p.data, mimeType: p.mimeType || p.mime_type || 'image/png' };
        }
        const b64 = p?.inlineData?.data || p?.inline_data?.data || p?.image?.bytesBase64Encoded || p?.image?.imageBytes;
        if (b64) {
            const mimeType = p?.inlineData?.mimeType || p?.inline_data?.mime_type || p?.mimeType || 'image/png';
            return { b64, mimeType };
        }
    }

    // 4. Imagen predictions format
    const pred = data.predictions?.[0];
    const predB64 = pred?.bytesBase64Encoded || pred?.bytes_base64_encoded || pred?.imageBytes;
    if (predB64) {
        const mimeType = pred?.mimeType || pred?.mime_type || 'image/jpeg';
        return { b64: predB64, mimeType };
    }

    return null;
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
    const candidateKeys = resolveCandidateApiKeys(customApiKey);
    if (candidateKeys.length === 0) {
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
    let lastErrorCode = '';

    // Define candidate models in priority order: prioritized gemini-3.1-flash-lite-image, then multimodal fallbacks
    const candidateModels = [];
    if (requestedModel && !['auto', 'gemini', 'imagen'].includes(requestedModel)) {
        candidateModels.push(requestedModel);
    }
    candidateModels.push(
        'gemini-3.1-flash-lite-image',
        'gemini-3.1-flash-image',
        'gemini-3.1-flash-image-preview',
        'gemini-2.5-flash-image',
        'gemini-3-pro-image',
        'imagen-3.0-generate-002'
    );

    for (const apiKey of candidateKeys) {
        const triedModels = new Set();

        for (const model of candidateModels) {
            if (triedModels.has(model)) continue;
            triedModels.add(model);

            const isImagenPredict = model.includes('imagen-3.0');
            const timeout = Math.min(timeoutMs || 35000, 45000);
            const rawModel = model.replace(/^models\//, '');
            const normalizedModel = model.startsWith('models/') ? model : `models/${model}`;

            try {
                const controller = new AbortController();
                const timer = setTimeout(() => controller.abort(), timeout);

                try {
                    if (isImagenPredict) {
                        // Google GenAI REST :predict
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(rawModel)}:predict?key=${encodeURIComponent(apiKey)}`;
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
                            const data = await res.json().catch(() => null);
                            const extracted = extractImageFromData(data);
                            if (extracted && extracted.b64) {
                                const buffer = Buffer.from(extracted.b64, 'base64');
                                return { success: true, buffer, contentType: extracted.mimeType, model: rawModel };
                            }
                        } else {
                            const errText = await res.text().catch(() => '');
                            let friendlyMsg = '';
                            let errStatus = '';
                            try {
                                const parsed = JSON.parse(errText);
                                friendlyMsg = parsed?.error?.message || '';
                                errStatus = parsed?.error?.status || '';
                            } catch (_) {}

                            if (res.status === 400 && (friendlyMsg.includes('API key') || errStatus === 'INVALID_ARGUMENT')) {
                                lastError = new Error(`Invalid Gemini API key (${model})`);
                                lastErrorCode = 'invalid_api_key';
                                console.warn(`[image-proxy] Invalid API key for ${model}, attempting fallback key/model...`);
                                break;
                            }
                            if (res.status === 429 || friendlyMsg.includes('quota') || errStatus === 'RESOURCE_EXHAUSTED') {
                                lastError = new Error(`Imagen (${model}) HTTP 429: ${friendlyMsg || 'Quota exceeded'}`);
                                lastErrorCode = 'quota_exceeded';
                                console.warn(`[image-proxy] Quota limit for ${model}, attempting fallback to next model...`);
                                continue;
                            }

                            lastError = new Error(`Imagen (${model}) HTTP ${res.status}: ${friendlyMsg || errText.slice(0, 150)}`);
                            console.error(`[image-proxy] Imagen upstream error (${model}):`, res.status, friendlyMsg || errText.slice(0, 200));
                        }
                    } else {
                        // 1. Google GenAI Interactions API (user-specified exact interaction.create protocol)
                        const interactionsUrl = `https://generativelanguage.googleapis.com/v1beta/interactions?key=${encodeURIComponent(apiKey)}&model=${encodeURIComponent(rawModel)}`;
                        let interactionsRes = null;
                        try {
                            interactionsRes = await fetch(interactionsUrl, {
                                method: 'POST',
                                signal: controller.signal,
                                headers: {
                                    'Content-Type': 'application/json',
                                    'x-goog-api-key': apiKey
                                },
                                body: JSON.stringify({
                                    model: normalizedModel,
                                    input: prompt,
                                    generation_config: {
                                        temperature: 1,
                                        max_output_tokens: 65536,
                                        top_p: 0.95,
                                        thinking_level: 'minimal',
                                        image_config: {
                                            image_size: '1K',
                                            aspect_ratio: aspectRatio || '1:1'
                                        }
                                    },
                                    response_modalities: ['image', 'text']
                                })
                            });
                        } catch (fetchErr) {
                            console.warn(`[image-proxy] Interactions endpoint error for ${model}:`, fetchErr?.message || fetchErr);
                        }

                        if (interactionsRes && interactionsRes.ok) {
                            const data = await interactionsRes.json().catch(() => null);
                            const extracted = extractImageFromData(data);
                            if (extracted && extracted.b64) {
                                const buffer = Buffer.from(extracted.b64, 'base64');
                                return { success: true, buffer, contentType: extracted.mimeType, model: rawModel };
                            }
                        }

                        if (interactionsRes) {
                            const errText = await interactionsRes.text().catch(() => '');
                            let friendlyMsg = '';
                            let errStatus = '';
                            try {
                                const parsed = JSON.parse(errText);
                                friendlyMsg = parsed?.error?.message || '';
                                errStatus = parsed?.error?.status || '';
                            } catch (_) {}

                            if (interactionsRes.status === 400 && (friendlyMsg.includes('API key') || errStatus === 'INVALID_ARGUMENT')) {
                                lastError = new Error(`Invalid Gemini API key (${model})`);
                                lastErrorCode = 'invalid_api_key';
                                console.warn(`[image-proxy] Invalid API key for ${model}, attempting fallback key/model...`);
                                break;
                            }
                            if (interactionsRes.status === 429 || friendlyMsg.includes('quota') || errStatus === 'RESOURCE_EXHAUSTED') {
                                lastError = new Error(`Gemini (${model}) HTTP 429: ${friendlyMsg || 'Quota exceeded'}`);
                                lastErrorCode = 'quota_exceeded';
                                console.warn(`[image-proxy] Quota limit for ${model}, attempting fallback to next model...`);
                                continue;
                            }
                        }

                        // 2. Fallback: Google Gemini REST :generateContent with IMAGE modality
                        const genContentUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(rawModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
                        const genRes = await fetch(genContentUrl, {
                            method: 'POST',
                            signal: controller.signal,
                            headers: {
                                'Content-Type': 'application/json',
                                'x-goog-api-key': apiKey
                            },
                            body: JSON.stringify({
                                contents: [{ parts: [{ text: prompt }] }],
                                generationConfig: {
                                    responseModalities: ['TEXT', 'IMAGE'],
                                    imageConfig: {
                                        aspectRatio: aspectRatio || '1:1'
                                    }
                                }
                            })
                        });

                        if (genRes.ok) {
                            const genData = await genRes.json().catch(() => null);
                            const extracted = extractImageFromData(genData);
                            if (extracted && extracted.b64) {
                                const buffer = Buffer.from(extracted.b64, 'base64');
                                return { success: true, buffer, contentType: extracted.mimeType, model: rawModel };
                            }
                        } else {
                            const genErrText = await genRes.text().catch(() => '');
                            let genFriendlyMsg = '';
                            let genErrStatus = '';
                            try {
                                const parsed = JSON.parse(genErrText);
                                genFriendlyMsg = parsed?.error?.message || '';
                                genErrStatus = parsed?.error?.status || '';
                            } catch (_) {}

                            if (genRes.status === 400 && (genFriendlyMsg.includes('API key') || genErrStatus === 'INVALID_ARGUMENT')) {
                                lastError = new Error(`Invalid Gemini API key (${model})`);
                                lastErrorCode = 'invalid_api_key';
                                console.warn(`[image-proxy] Invalid API key for ${model}, attempting fallback key/model...`);
                                break;
                            }
                            if (genRes.status === 429 || genFriendlyMsg.includes('quota') || genErrStatus === 'RESOURCE_EXHAUSTED') {
                                lastError = new Error(`Gemini (${model}) HTTP 429: ${genFriendlyMsg || 'Quota exceeded'}`);
                                lastErrorCode = 'quota_exceeded';
                                console.warn(`[image-proxy] Quota limit for ${model}, attempting fallback to next model...`);
                                continue;
                            }

                            lastError = new Error(`Gemini (${model}) HTTP ${genRes.status}: ${genFriendlyMsg || genErrText.slice(0, 150)}`);
                            console.error(`[image-proxy] Gemini image error (${model}):`, genRes.status, genFriendlyMsg || genErrText.slice(0, 200));
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
    }

    if (lastErrorCode === 'invalid_api_key' && candidateKeys.length === 1) {
        return {
            success: false,
            code: 'invalid_api_key',
            message: 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
        };
    }

    if (lastErrorCode === 'quota_exceeded') {
        return {
            success: false,
            code: 'quota_exceeded',
            message: 'Gemini API quota exceeded across available models. Please link a billing account or use a key with available quota.'
        };
    }

    return {
        success: false,
        code: lastErrorCode || 'gemini_image_generation_failed',
        message: lastError?.message || 'Gemini image generation failed across all available models.'
    };
}

/**
 * Generates an image using AI Horde (free, decentralized community GPU cluster).
 * Zero rate limits, no mandatory API key required (uses default 0000000000).
 */
async function generateAiHordeImageBuffer(prompt, {
    width = 512,
    height = 512,
    timeoutMs = 28000,
    apiKey: customKey = ''
} = {}) {
    const apiKey = customKey || process.env.AI_HORDE_API_KEY || '0000000000';
    const models = ['stable_diffusion', "ICBINP - I Can't Believe It's Not Photography", 'Deliberate', 'Anything v5'];

    // 1. Submit async generation job
    const postRes = await fetch('https://aihorde.net/api/v2/generate/async', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'apikey': apiKey,
            'Client-Agent': 'JarvisAssistant:1.0'
        },
        body: JSON.stringify({
            prompt,
            params: {
                width: Math.min(768, Math.max(384, width)),
                height: Math.min(768, Math.max(384, height)),
                steps: 20,
                n: 1
            },
            models
        })
    });

    if (!postRes.ok) {
        const errText = await postRes.text().catch(() => '');
        throw new Error(`AI Horde submit failed (${postRes.status}): ${errText.slice(0, 100)}`);
    }

    const postData = await postRes.json();
    const id = postData?.id;
    if (!id) throw new Error('AI Horde returned no job ID');

    // 2. Poll check status
    const startTime = Date.now();
    let isDone = false;
    while (!isDone && (Date.now() - startTime) < timeoutMs) {
        await new Promise(r => setTimeout(r, 1500));
        const checkRes = await fetch(`https://aihorde.net/api/v2/generate/check/${id}`, {
            headers: { 'Client-Agent': 'JarvisAssistant:1.0' }
        });
        if (checkRes.ok) {
            const checkData = await checkRes.json();
            if (checkData.done || checkData.finished > 0) {
                isDone = true;
                break;
            }
            if (checkData.faulted) {
                throw new Error('AI Horde job faulted');
            }
        }
    }

    // 3. Fetch completed status & image
    const statusRes = await fetch(`https://aihorde.net/api/v2/generate/status/${id}`, {
        headers: { 'Client-Agent': 'JarvisAssistant:1.0' }
    });
    if (!statusRes.ok) throw new Error(`AI Horde status fetch failed (${statusRes.status})`);

    const statusData = await statusRes.json();
    const generation = statusData.generations?.[0];
    if (!generation) throw new Error('AI Horde returned no generations');

    let imageBuffer = null;
    let contentType = 'image/webp';

    if (generation.img) {
        if (generation.img.startsWith('http://') || generation.img.startsWith('https://')) {
            const imgRes = await fetch(generation.img);
            if (!imgRes.ok) throw new Error(`Failed to download AI Horde image (${imgRes.status})`);
            contentType = imgRes.headers.get('content-type') || 'image/webp';
            const arrBuf = await imgRes.arrayBuffer();
            imageBuffer = Buffer.from(arrBuf);
        } else {
            imageBuffer = Buffer.from(generation.img, 'base64');
        }
    }

    if (!imageBuffer || imageBuffer.length < 100) {
        throw new Error('AI Horde returned empty image payload');
    }

    return {
        success: true,
        buffer: imageBuffer,
        contentType,
        model: `aihorde-${generation.model || 'stable_diffusion'}`
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

    // 1. Primary attempt: Google Gemini (models/gemini-3.1-flash-lite-image)
    let result = await generateGeminiImageBuffer(prompt, {
        width,
        height,
        timeoutMs: 30000,
        apiKey: clientApiKey,
        aspectRatio: params.aspectRatio || params.aspect_ratio || '',
        requestedModel
    });

    // 2. If Gemini fails due to quota limit (e.g. Free Tier limit 0) or upstream service failure:
    // Seamlessly fall back to AI Horde (free, crowd-sourced GPU cluster) so user gets their image
    if (!result?.success && (result?.code === 'quota_exceeded' || result?.code === 'gemini_image_generation_failed' || params?.provider === 'aihorde')) {
        console.warn(`[image-proxy] Gemini image generation unavailable (${result?.code || 'failed'}), attempting AI Horde community fallback...`);
        try {
            const hordeResult = await generateAiHordeImageBuffer(prompt, {
                width,
                height,
                timeoutMs: 25000,
                apiKey: process.env.AI_HORDE_API_KEY || ''
            });
            if (hordeResult && hordeResult.success && hordeResult.buffer && hordeResult.buffer.length > 100) {
                result = hordeResult;
            }
        } catch (hordeErr) {
            console.error('[image-proxy] AI Horde fallback error:', hordeErr?.message || hordeErr);
        }
    }

    if (result && result.success && result.buffer && result.buffer.length > 100) {
        if (typeof res.setHeader === 'function') {
            res.setHeader('Content-Type', result.contentType || 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
            res.setHeader('X-Image-Model', result.model);
        }

        if (acceptsJson) {
            return res.status(200).json({
                success: true,
                image: result.buffer.toString('base64'),
                dataUrl: `data:${result.contentType || 'image/webp'};base64,${result.buffer.toString('base64')}`,
                model: result.model
            });
        }

        const responder = typeof res.status === 'function' ? res.status(200) : res;
        if (responder && typeof responder.send === 'function') return responder.send(result.buffer);
        if (responder && typeof responder.end === 'function') return responder.end(result.buffer);
        if (typeof res.send === 'function') return res.send(result.buffer);
        if (typeof res.end === 'function') return res.end(result.buffer);
        return;
    }

    if (result?.code === 'missing_gemini_key') {
        return res.status(401).json({
            success: false,
            error: {
                code: 'missing_gemini_key',
                message: result.message || 'Gemini API key is required. Please set GEMINI_API_KEY in your environment.'
            }
        });
    }

    if (result?.code === 'invalid_api_key') {
        return res.status(401).json({
            success: false,
            error: {
                code: 'invalid_api_key',
                message: result.message || 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
            }
        });
    }

    if (result?.code === 'quota_exceeded') {
        return res.status(429).json({
            success: false,
            error: {
                code: 'quota_exceeded',
                message: result.message || 'Gemini API quota exceeded. Please check your Google AI Studio quota.'
            }
        });
    }

    return res.status(502).json({
        success: false,
        error: {
            code: 'gemini_image_generation_failed',
            message: result?.message || 'Image generation failed across all available providers.'
        }
    });
}

export default imageProxyHandler;
