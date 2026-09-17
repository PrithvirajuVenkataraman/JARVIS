export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';

const GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const DEFAULT_WHISPER_MODEL = 'whisper-large-v3-turbo';
const FETCH_TIMEOUT_MS = 10000;

function getGroqApiKey() {
    return process.env.GROQ_API_KEY ||
           process.env.GROQ_API_KEY_SECONDARY ||
           process.env.GROQ_API_KEY_FALLBACK ||
           '';
}

/**
 * Serverless handler for speech-to-text audio transcription via Groq Whisper.
 */
export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'stt',
        maxBodyBytes: 10 * 1024 * 1024, // 10MB max audio payload
        rateLimit: { max: 120, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const start = performance.now();
    const body = req.body || {};
    const rawAudio = String(body.audioBase64 || body.audio || '').trim();
    const audioBase64 = rawAudio.includes(',') ? rawAudio.split(',')[1].trim() : rawAudio;
    const mimeType = String(body.mimeType || 'audio/webm').trim();
    const language = String(body.language || '').trim();
    const prompt = String(body.prompt || '').trim();

    if (!audioBase64) {
        return res.status(400).json({
            success: false,
            error: { code: 'missing_audio', message: 'audioBase64 is required.' }
        });
    }

    const apiKey = getGroqApiKey();
    if (!apiKey) {
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

        const extension = mimeType.includes('mp4') || mimeType.includes('m4a') ? 'm4a'
            : mimeType.includes('wav') ? 'wav'
            : mimeType.includes('ogg') ? 'ogg'
            : 'webm';

        const form = new FormData();
        const audioBlob = new Blob([audioBuffer], { type: mimeType });
        form.append('file', audioBlob, `audio.${extension}`);
        form.append('model', DEFAULT_WHISPER_MODEL);
        form.append('response_format', 'verbose_json');
        if (language) form.append('language', language.split('-')[0].toLowerCase());
        if (prompt) form.append('prompt', prompt.slice(0, 200));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const response = await fetch(GROQ_AUDIO_URL, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                Authorization: `Bearer ${apiKey}`
            },
            body: form
        });
        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            return res.status(response.status >= 500 ? 502 : response.status).json({
                success: false,
                fallbackToBrowser: true,
                error: {
                    code: 'transcription_failed',
                    status: response.status,
                    message: errorText || 'Whisper transcription failed.'
                }
            });
        }

        const data = await response.json();
        const text = String(data.text || '').trim();

        return res.status(200).json({
            success: true,
            text,
            language: data.language || language || 'en',
            duration: Number(data.duration) || 0,
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });

    } catch (error) {
        const isAbort = error?.name === 'AbortError';
        return res.status(isAbort ? 504 : 500).json({
            success: false,
            fallbackToBrowser: true,
            error: {
                code: isAbort ? 'timeout' : 'server_error',
                message: error?.message || 'STT processing error.'
            }
        });
    }
}
