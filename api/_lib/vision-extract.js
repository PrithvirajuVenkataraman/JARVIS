const PROVIDER_TIMEOUT_MS = 20_000;
const GEMINI_API_VERSIONS = ['v1beta', 'v1'];
const GEMINI_MODEL_FALLBACKS = [
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest'
];
const GROQ_VISION_MODEL_FALLBACKS = [
    'llama-3.2-11b-vision-preview',
    'meta-llama/llama-3.2-11b-vision-instruct',
    'llama-3.2-90b-vision-preview'
];

export async function extractTextFromImage({ mimeType = 'image/jpeg', imageBase64 = '', prompt = '' }) {
    const providers = getVisionProviders();
    if (!providers.groqApiKey && !providers.geminiApiKey) {
        throw new Error('Vision provider is not configured.');
    }
    const systemPrompt = [
        'You are a document OCR engine.',
        'Return strict JSON only:',
        '{ "fullText": "all readable text in order", "textDetected": ["line 1", "line 2"], "summary": "short note" }',
        'Do not invent unreadable text.',
        String(prompt || 'Extract all readable text from this image.').trim()
    ].join('\n');

    const rawText = await callVisionText({ providers, systemPrompt, mimeType, imageBase64 });
    if (!rawText) return { ok: false, text: '', method: 'vision_ocr', provider: 'vision' };

    const parsed = safeParseJson(rawText) || extractJsonFromText(rawText) || {};
    const fullText = String(parsed?.fullText || '').trim();
    const snippets = Array.isArray(parsed?.textDetected)
        ? parsed.textDetected.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    const text = fullText || snippets.join('\n').trim() || cleanVisionDisplayText(rawText);
    return {
        ok: Boolean(text),
        text,
        method: 'vision_ocr',
        provider: providers.geminiApiKey ? 'gemini' : 'groq'
    };
}

function getVisionProviders() {
    return {
        groqApiKey: process.env.GROQ_API_KEY || process.env.GROQ_KEY || '',
        groqModel: process.env.GROQ_VISION_MODEL || process.env.GROQ_MODEL || '',
        geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
        geminiModel: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || ''
    };
}

async function callVisionText({ providers, systemPrompt, mimeType, imageBase64 }) {
    if (providers.geminiApiKey) {
        const text = await callGeminiVision({
            apiKey: providers.geminiApiKey,
            configuredModel: providers.geminiModel,
            systemPrompt,
            mimeType,
            imageBase64
        });
        if (text) return text;
    }
    if (providers.groqApiKey) {
        const text = await callGroqVisionText({
            apiKey: providers.groqApiKey,
            configuredModel: providers.groqModel,
            systemPrompt,
            mimeType,
            imageBase64
        });
        if (text) return text;
    }
    return '';
}

async function callGroqVisionText({ apiKey, configuredModel, systemPrompt, mimeType, imageBase64 }) {
    const candidates = [String(configuredModel || '').trim(), ...GROQ_VISION_MODEL_FALLBACKS].filter(Boolean);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
    for (const model of candidates) {
        try {
            const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model,
                    temperature: 0.1,
                    max_tokens: 2500,
                    messages: [{
                        role: 'user',
                        content: [
                            { type: 'text', text: systemPrompt },
                            { type: 'image_url', image_url: { url: dataUrl } }
                        ]
                    }]
                })
            });
            if (!response.ok) continue;
            const data = await response.json();
            const text = extractGroqText(data);
            if (text) return text;
        } catch (_) {}
    }
    return '';
}

async function callGeminiVision({ apiKey, configuredModel = '', systemPrompt, mimeType, imageBase64 }) {
    const modelFallbacks = [String(configuredModel || '').trim(), ...GEMINI_MODEL_FALLBACKS].filter(Boolean);
    for (const apiVersion of GEMINI_API_VERSIONS) {
        for (const model of modelFallbacks) {
            try {
                const response = await fetchWithTimeout(
                    `https://generativelanguage.googleapis.com/${apiVersion}/models/${model}:generateContent?key=${apiKey}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            contents: [{
                                parts: [
                                    { text: systemPrompt },
                                    { inlineData: { mimeType, data: imageBase64 } }
                                ]
                            }],
                            generationConfig: {
                                temperature: 0.1,
                                maxOutputTokens: 2500
                            }
                        })
                    }
                );
                if (!response.ok) continue;
                const data = await response.json();
                const text = extractGeminiText(data);
                if (text) return text;
            } catch (_) {}
        }
    }
    return '';
}

async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function extractGroqText(data) {
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content === 'string') return content.trim();
    if (Array.isArray(content)) {
        return content.map(part => (typeof part === 'string' ? part : part?.text || '')).join('\n').trim();
    }
    return '';
}

function extractGeminiText(payload) {
    const parts = payload?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return '';
    return parts.map(part => (typeof part?.text === 'string' ? part.text : '')).join('\n').trim();
}

function safeParseJson(value) {
    try {
        return JSON.parse(String(value || ''));
    } catch (_) {
        return null;
    }
}

function extractJsonFromText(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return null;
    const unwrapped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    try {
        return JSON.parse(unwrapped);
    } catch (_) {}
    const start = unwrapped.indexOf('{');
    const end = unwrapped.lastIndexOf('}');
    if (start >= 0 && end > start) {
        return safeParseJson(unwrapped.slice(start, end + 1));
    }
    return null;
}

function cleanVisionDisplayText(value) {
    return String(value || '')
        .replace(/^```(?:json)?/i, '')
        .replace(/```$/i, '')
        .trim();
}
