/**
 * @file api/image-proxy.js
 * @description Server-side proxy for zero-cost AI image generation.
 * Strips browser origin headers to prevent Turnstile 403 blocks,
 * and implements multi-model failover (Flux -> Turbo).
 */

import https from 'node:https';

const DEFAULT_NEGATIVE_PROMPT = 'text,watermark,words,letters,signature,typography,lowres,blurry';
const TIMEOUT_MS = 12000;

function fetchImageBuffer(url, timeoutMs = TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = https.request({
            protocol: parsed.protocol,
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: `${parsed.pathname}${parsed.search}`,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36',
                'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchImageBuffer(res.headers.location, timeoutMs).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200) {
                return reject(new Error(`Upstream returned HTTP ${res.statusCode}`));
            }
            const contentType = res.headers['content-type'] || 'image/jpeg';
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                resolve({
                    buffer: Buffer.concat(chunks),
                    contentType
                });
            });
        });

        req.setTimeout(timeoutMs, () => {
            req.destroy(new Error(`Image fetch timed out after ${timeoutMs}ms`));
        });

        req.on('error', reject);
        req.end();
    });
}

function buildPollinationsUrl(prompt, { width = 512, height = 512, model = 'flux', seed = 42, negativePrompt = DEFAULT_NEGATIVE_PROMPT } = {}) {
    const encodedPrompt = encodeURIComponent(String(prompt || '').trim());
    const encodedNeg = encodeURIComponent(String(negativePrompt || DEFAULT_NEGATIVE_PROMPT).trim());
    return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&model=${encodeURIComponent(model)}&negative_prompt=${encodedNeg}&nologo=true&seed=${seed}`;
}

export default async function handler(req, res) {
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
    const negativePrompt = params.negative_prompt || params.negativePrompt || DEFAULT_NEGATIVE_PROMPT;

    // Multi-model failover chain: requested model -> flux -> turbo
    const modelsToTry = Array.from(new Set([requestedModel, 'flux', 'turbo']));

    let lastError = null;
    for (const model of modelsToTry) {
        const targetUrl = buildPollinationsUrl(prompt, { width, height, model, seed, negativePrompt });
        try {
            const { buffer, contentType } = await fetchImageBuffer(targetUrl, 10000);
            if (buffer && buffer.length > 500) {
                res.setHeader('Content-Type', contentType);
                res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
                res.setHeader('X-Image-Model', model);
                return res.status(200).send(buffer);
            }
        } catch (err) {
            lastError = err;
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
