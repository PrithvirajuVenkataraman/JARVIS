export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';
import { withRequestLifecycle, fetchWithLifecycle as fetch } from './_lib/request-lifecycle.js';
import { MAX_JSON_REQUEST_BYTES } from '../app/request-payload.js';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3-turbo';
const FETCH_TIMEOUT_MS = 18000;

function getGroqApiKeys() {
    const raw = [process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY, process.env.GROQ_KEY, process.env.GROQ_API_KEY_SECONDARY, process.env.GROQ_API_KEY_FALLBACK];
    const keys = [];
    for (const entry of raw) {
        for (const k of String(entry || '').split(/[\s,]+/)) {
            const cleaned = k.trim();
            if (cleaned && !keys.includes(cleaned)) keys.push(cleaned);
        }
    }
    return keys;
}

/**
 * Serverless handler for speech-to-text audio transcription via Groq Whisper.
 */
export default withRequestLifecycle(handler);
async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'stt',
        maxBodyBytes: MAX_JSON_REQUEST_BYTES,
        base64Fields: ['audioBase64', 'audio'],
        rateLimit: { max: 120, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const start = performance.now();
    const body = req.body || {};
    const rawAudio = String(body.audioBase64 || body.audio || '').trim();
    let audioBase64 = (rawAudio.includes(',') ? rawAudio.split(',')[1] : rawAudio)
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    if (audioBase64 && !audioBase64.endsWith('=')) {
        while (audioBase64.length % 4 !== 0) audioBase64 += '=';
    }
    const mimeType = String(body.mimeType || 'audio/webm').trim();
    const language = String(body.language || '').trim();
    const prompt = String(body.prompt || '').trim();

    if (!audioBase64) {
        return res.status(400).json({
            success: false,
            error: { code: 'missing_audio', message: 'audioBase64 is required.' }
        });
    }
    if (audioBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(audioBase64)) {
        return res.status(400).json({ success: false, error: { code: 'invalid_audio', message: 'Audio must be valid base64.' } });
    }
    const audioTypes = { 'audio/webm': 'webm', 'video/webm': 'webm', 'audio/mp4': 'm4a', 'video/mp4': 'mp4', 'audio/x-m4a': 'm4a', 'audio/m4a': 'm4a', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac' };
    const extension = audioTypes[mimeType.toLowerCase().split(';')[0].trim()];
    if (!extension) return res.status(415).json({ success: false, error: { code: 'unsupported_audio', message: 'This audio format is not supported.' } });

    const apiKeys = getGroqApiKeys();
    if (!apiKeys.length) {
        return res.status(503).json({
            success: false,
            fallbackToBrowser: true,
            error: { code: 'api_key_missing', message: 'Groq API key not configured on server.' }
        });
    }

    try {
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        if (audioBuffer.length === 0) {
            return res.status(400).json({
                success: false,
                error: { code: 'invalid_audio', message: 'Audio payload is empty.' }
            });
        }

        const requestedModel = String(body.model || '').trim().toLowerCase();
        const whisperModel = (requestedModel === 'whisper-large-v3' || requestedModel === 'whisper-large-v3-turbo')
            ? requestedModel
            : DEFAULT_WHISPER_MODEL;

        let response = null;
        for (const apiKey of apiKeys) {
            const form = new FormData();
            const audioBlob = new Blob([audioBuffer], { type: mimeType });
            form.append('file', audioBlob, `audio.${extension}`);
            form.append('model', whisperModel);
            form.append('response_format', 'verbose_json');
            if (language) form.append('language', language.split('-')[0].toLowerCase());
            if (prompt) form.append('prompt', prompt.slice(0, 200));

            response = await fetch(GROQ_AUDIO_URL, {
                method: 'POST',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: {
                    Authorization: `Bearer ${apiKey}`
                },
                body: form
            });
            if (response.ok) break;
            await response.body?.cancel().catch(() => {});
            if (![401, 403, 429].includes(response.status) && response.status < 500) break;
        }
        if (!response || !response.ok) {
            const status = response?.status || 502;
            return res.status(status >= 500 ? 502 : status).json({
                success: false,
                fallbackToBrowser: true,
                error: {
                    code: 'transcription_failed',
                    status,
                    message: status === 429 ? 'Voice transcription has reached its provider limit. Please try again later.' : [401, 403].includes(status) ? 'The transcription provider rejected this deployment\'s credentials.' : 'The transcription provider is temporarily unavailable.'
                }
            });
        }

        const data = await response.json();
        const text = String(data.text || '').trim();

        return res.status(200).json({
            success: true,
            text,
            model: whisperModel,
            language: data.language || language || 'en',
            duration: Number(data.duration) || 0,
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });

    } catch (error) {
        if (req.aborted || req.signal?.aborted || res.destroyed || res.writableEnded) return;
        const isAbort = ['AbortError', 'TimeoutError'].includes(error?.name);
        return res.status(isAbort ? 504 : 500).json({
            success: false,
            fallbackToBrowser: true,
            error: {
                code: isAbort ? 'timeout' : 'server_error',
                message: isAbort ? 'Voice transcription timed out. Please try again.' : 'Voice transcription could not complete. Please try again.'
            }
        });
    }
}
