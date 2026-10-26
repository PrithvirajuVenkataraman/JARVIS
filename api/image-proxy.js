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
                            return {
                                success: false,
                                code: 'invalid_api_key',
                                message: 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
                            };
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
                            return {
                                success: false,
                                code: 'invalid_api_key',
                                message: 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
                            };
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
                            return {
                                success: false,
                                code: 'invalid_api_key',
                                message: 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
                            };
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

    if (lastErrorCode === 'quota_exceeded') {
        return {
            success: false,
            code: 'quota_exceeded',
            message: 'Gemini API quota exceeded across available models. Please link a billing account or use a key with available quota.'
        };
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

    if (geminiResult?.code === 'invalid_api_key') {
        return res.status(401).json({
            success: false,
            error: {
                code: 'invalid_api_key',
                message: geminiResult.message || 'Invalid Gemini API key. Please check your GEMINI_API_KEY.'
            }
        });
    }

    if (geminiResult?.code === 'quota_exceeded') {
        return res.status(429).json({
            success: false,
            error: {
                code: 'quota_exceeded',
                message: geminiResult.message || 'Gemini API quota exceeded. Please check your Google AI Studio quota.'
            }
        });
    }

    return res.status(502).json({
        success: false,
        error: {
            code: 'gemini_image_generation_failed',
            message: geminiResult?.message || 'Gemini image generation failed. Please verify your GEMINI_API_KEY and quota.'
        }
    });
}

export default imageProxyHandler;
