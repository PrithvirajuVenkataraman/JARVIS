import { applyApiSecurity } from './_lib/security.js';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 25000;
const DEFAULT_CLOUDFLARE_MODEL = '@cf/black-forest-labs/flux-1-schnell';
const DEFAULT_HF_MODEL = 'black-forest-labs/FLUX.1-schnell';

function isImageGenerationEnabled() {
    return !/^(false|0|off)$/i.test(String(process.env.JARVIS_IMAGE_GENERATION_ENABLED || process.env.JARVIS_IMAGE_FREE_TIER_ENABLED || 'true'));
}

function quantizeDimension(value, fallback = 512) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) return fallback;
    return Math.max(256, Math.min(1024, Math.round(num / 64) * 64));
}

function detectImageMime(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.byteLength < 12 || buffer.byteLength > MAX_IMAGE_BYTES) return '';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    return '';
}

function decodeValidBase64Image(rawBase64) {
    const cleaned = String(rawBase64 || '').replace(/^data:image\/[a-z0-9+.-]+;base64,/i, '').trim();
    if (!cleaned || cleaned.length > 11000000 || !/^[A-Za-z0-9+/=]+$/.test(cleaned)) return null;
    const buffer = Buffer.from(cleaned, 'base64');
    const mime = detectImageMime(buffer);
    if (!mime) return null;
    return { mime, dataUrl: `data:${mime};base64,${buffer.toString('base64')}` };
}

function getConfiguredImageProviders() {
    const cfAccountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || '').trim();
    const cfToken = String(process.env.CLOUDFLARE_API_TOKEN || process.env.CLOUDFLARE_AI_TOKEN || '').trim();
    const rawCfModel = String(process.env.CLOUDFLARE_IMAGE_MODEL || DEFAULT_CLOUDFLARE_MODEL).trim();
    const cfModel = /^@?[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+$/.test(rawCfModel) ? rawCfModel : DEFAULT_CLOUDFLARE_MODEL;

    const hfToken = String(process.env.HF_TOKEN || process.env.HUGGINGFACE_API_KEY || process.env.HUGGINGFACE_TOKEN || '').trim();
    const rawHfModel = String(process.env.HUGGINGFACE_IMAGE_MODEL || DEFAULT_HF_MODEL).trim();
    const hfModel = /^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(rawHfModel) ? rawHfModel : DEFAULT_HF_MODEL;

    return {
        cloudflare: cfAccountId && cfToken ? { accountId: cfAccountId, token: cfToken, model: cfModel } : null,
        huggingface: hfToken ? { token: hfToken, model: hfModel } : null
    };
}

function createAbortCoordinator(req, timeoutMs = PROVIDER_TIMEOUT_MS) {
    const controller = new AbortController();
    let timedOut = false;
    const onAbort = () => controller.abort();
    const onClose = () => {
        if (req?.destroyed || req?.aborted) controller.abort();
    };
    const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
    }, timeoutMs);
    req?.on?.('close', onClose);
    req?.on?.('aborted', onAbort);
    return {
        signal: controller.signal,
        didTimeout: () => timedOut,
        cleanup() {
            clearTimeout(timer);
            req?.off?.('close', onClose);
            req?.off?.('aborted', onAbort);
        }
    };
}

async function generateViaCloudflare(config, params, req) {
    const coordinator = createAbortCoordinator(req, PROVIDER_TIMEOUT_MS);
    const start = Date.now();
    try {
        const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(config.accountId)}/ai/run/${config.model}`;
        const body = { prompt: params.prompt, steps: params.steps };
        if (params.seed !== null) body.seed = params.seed;
        const response = await fetch(endpoint, {
            method: 'POST',
            signal: coordinator.signal,
            headers: {
                Authorization: `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            throw Object.assign(new Error(`Cloudflare Workers AI returned ${response.status}`), {
                status: response.status,
                provider: 'cloudflare_workers_ai'
            });
        }
        const contentType = String(response.headers?.get?.('content-type') || '').toLowerCase();
        if (contentType.startsWith('image/')) {
            const buffer = Buffer.from(await response.arrayBuffer());
            const mime = detectImageMime(buffer);
            if (!mime) throw Object.assign(new Error('Cloudflare returned invalid image bytes.'), { status: 502, provider: 'cloudflare_workers_ai' });
            return {
                dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
                provider: 'cloudflare_workers_ai',
                model: config.model,
                width: params.width,
                height: params.height,
                durationMs: Date.now() - start
            };
        }
        const json = await response.json();
        if (json?.success === false) {
            throw Object.assign(new Error('Cloudflare Workers AI generation unsuccessful.'), { status: 502, provider: 'cloudflare_workers_ai' });
        }
        const decoded = decodeValidBase64Image(json?.result?.image);
        if (!decoded) {
            throw Object.assign(new Error('Cloudflare returned unreadable image data.'), { status: 502, provider: 'cloudflare_workers_ai' });
        }
        return {
            dataUrl: decoded.dataUrl,
            provider: 'cloudflare_workers_ai',
            model: config.model,
            width: params.width,
            height: params.height,
            durationMs: Date.now() - start
        };
    } catch (error) {
        if (coordinator.didTimeout()) {
            throw Object.assign(new Error('Cloudflare Workers AI timed out.'), { status: 504, provider: 'cloudflare_workers_ai' });
        }
        throw error;
    } finally {
        coordinator.cleanup();
    }
}

async function generateViaHuggingFace(config, params, req) {
    const coordinator = createAbortCoordinator(req, PROVIDER_TIMEOUT_MS);
    const start = Date.now();
    try {
        const endpoint = `https://router.huggingface.co/hf-inference/models/${config.model}`;
        const parameters = {
            width: params.width,
            height: params.height,
            num_inference_steps: params.steps
        };
        if (params.seed !== null) parameters.seed = params.seed;
        const response = await fetch(endpoint, {
            method: 'POST',
            signal: coordinator.signal,
            headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'image/png',
                'Content-Type': 'application/json',
                'x-wait-for-model': 'true'
            },
            body: JSON.stringify({ inputs: params.prompt, parameters })
        });
        if (!response.ok) {
            throw Object.assign(new Error(`Hugging Face Inference returned ${response.status}`), {
                status: response.status,
                provider: 'huggingface_inference'
            });
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        const mime = detectImageMime(buffer);
        if (!mime) {
            throw Object.assign(new Error('Hugging Face returned unreadable image data.'), { status: 502, provider: 'huggingface_inference' });
        }
        return {
            dataUrl: `data:${mime};base64,${buffer.toString('base64')}`,
            provider: 'huggingface_inference',
            model: config.model,
            width: params.width,
            height: params.height,
            durationMs: Date.now() - start
        };
    } catch (error) {
        if (coordinator.didTimeout()) {
            throw Object.assign(new Error('Hugging Face Inference timed out.'), { status: 504, provider: 'huggingface_inference' });
        }
        throw error;
    } finally {
        coordinator.cleanup();
    }
}

export async function imageProxyHandler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    const method = String(req?.method || 'GET').toUpperCase();

    // Legacy compatibility GET endpoint: always 410 and never trigger providers.
    if (method === 'GET') {
        return res.status(410).json({
            error: {
                code: 'image_client_upgrade_required',
                message: 'Refresh JARVIS to use free community image generation. No paid image provider is enabled.'
            }
        });
    }

    const security = applyApiSecurity(req, res, {
        routeKey: 'image-proxy',
        maxBodyBytes: 64 * 1024,
        rateMax: 20,
        rateWindowMs: 60 * 1000
    });
    if (security.handled) return;

    if (method !== 'POST') {
        return res.status(405).json({ error: { code: 'method_not_allowed', message: 'Method not allowed.' } });
    }

    if (!isImageGenerationEnabled()) {
        return res.status(503).json({
            error: {
                code: 'image_generation_disabled',
                fallbackEligible: false,
                message: 'Image generation is currently disabled.'
            }
        });
    }

    const body = req?.body && typeof req.body === 'object' ? req.body : {};
    const prompt = String(body.prompt || '').trim();
    if (!prompt || prompt.length > 2000) {
        return res.status(400).json({
            error: {
                code: 'invalid_prompt',
                message: 'Please provide an image prompt between 1 and 2000 characters.'
            }
        });
    }

    const providers = getConfiguredImageProviders();
    if (!providers.cloudflare && !providers.huggingface) {
        return res.status(501).json({
            error: {
                code: 'image_fast_proxy_unconfigured',
                fallbackEligible: true,
                message: 'Fast free-tier server providers are not configured; use the free community queue.'
            }
        });
    }

    const parsedSteps = Number(body.steps);
    const steps = Number.isFinite(parsedSteps) ? Math.max(1, Math.min(8, Math.round(parsedSteps))) : 4;
    const parsedSeed = Number(body.seed);
    const seed = Number.isInteger(parsedSeed) && parsedSeed >= 0 ? parsedSeed : null;
    const params = {
        prompt,
        width: quantizeDimension(body.width, 512),
        height: quantizeDimension(body.height, 512),
        steps,
        seed
    };

    const failures = [];
    const attempts = [];
    if (providers.cloudflare) attempts.push(['cloudflare_workers_ai', () => generateViaCloudflare(providers.cloudflare, params, req)]);
    if (providers.huggingface) attempts.push(['huggingface_inference', () => generateViaHuggingFace(providers.huggingface, params, req)]);

    for (const [providerName, run] of attempts) {
        if (req?.destroyed || req?.aborted) return;
        try {
            const result = await run();
            return res.status(200).json(result);
        } catch (error) {
            if (req?.destroyed || req?.aborted) return;
            failures.push({ provider: providerName, status: Number(error?.status) || 502 });
        }
    }

    return res.status(502).json({
        error: {
            code: 'image_fast_proxy_failed',
            fallbackEligible: true,
            message: 'Fast free-tier image providers could not finish right now; falling back to the free community queue.',
            failures
        }
    });
}

export default imageProxyHandler;
