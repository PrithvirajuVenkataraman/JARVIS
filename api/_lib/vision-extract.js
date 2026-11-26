import { fetchWithLifecycle as fetch } from './request-lifecycle.js';
import { normalizeGeminiGenerationConfig, visionFailurePayload } from './model-failure.js';
const PROVIDER_TIMEOUT_MS = 20_000;
const GEMINI_API_VERSIONS = ['v1beta', 'v1'];
const GEMINI_MODEL_FALLBACKS = [
    'gemini-4-hydrogen',
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-3.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.5-pro',
    'gemini-3.7-flash',
    'gemini-2.0-flash',
    'gemini-2.0-flash-lite',
    'gemini-1.5-flash',
    'gemini-flash-latest'
];
const GROQ_VISION_MODEL_FALLBACKS = [
    'qwen/qwen3.8-27b',
    'qwen-3.8-27b'
];

const EXTRACT_UNAVAILABLE_MODEL_TTL_MS = 10 * 60 * 1000;
const EXTRACT_UNAVAILABLE_MODELS = new Map();

function filterAvailableExtractModels(prefix, list) {
    const unique = [...new Set(list.filter(Boolean))];
    const now = Date.now();
    const available = unique.filter(m => {
        const exp = EXTRACT_UNAVAILABLE_MODELS.get(`${prefix}:${m}`);
        if (!exp) return true;
        if (now > exp) {
            EXTRACT_UNAVAILABLE_MODELS.delete(`${prefix}:${m}`);
            return true;
        }
        return false;
    });
    return available.length > 0 ? available : unique;
}

function markExtractModelUnavailable(prefix, model, status) {
    if (status === 404 || status === 410) {
        EXTRACT_UNAVAILABLE_MODELS.set(`${prefix}:${model}`, Date.now() + EXTRACT_UNAVAILABLE_MODEL_TTL_MS);
    }
}

// Normalize any image mime type to one accepted by Gemini/Groq (jpeg/png/webp/gif)
function normalizeMimeForProvider(mimeType, base64 = '') {
    if (base64) {
        const head = String(base64).slice(0, 32);
        if (head.startsWith('/9j/')) return 'image/jpeg';
        if (head.startsWith('iVBOR')) return 'image/png';
        if (head.startsWith('R0lGO')) return 'image/gif';
        if (head.startsWith('UklGR')) return 'image/webp';
    }
    const m = String(mimeType || '').trim().toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(m)) return m;
    if (m === 'image/jpg') return 'image/jpeg';
    return 'image/jpeg'; // HEIC, HEIF, AVIF, BMP, TIFF → jpeg (client re-encodes via canvas)
}

const MAX_EXTRACT_BASE64_CHARS = 8 * 1024 * 1024;
const LLM_DIRECT_IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function detectBinaryImageMime(base64 = '') {
    if (!base64 || typeof base64 !== 'string') return '';
    const prefix = base64.slice(0, 32);
    if (prefix.startsWith('/9j/')) return 'image/jpeg';
    if (prefix.startsWith('iVBORw0KGgo')) return 'image/png';
    if (prefix.startsWith('R0lGOD')) return 'image/gif';
    if (prefix.startsWith('UklGR')) return 'image/webp';
    if (prefix.startsWith('Qk')) return 'image/bmp';
    if (prefix.startsWith('SUkq') || prefix.startsWith('TU0A')) return 'image/tiff';
    try {
        const buf = Buffer.from(prefix.slice(0, 24), 'base64');
        if (buf.length >= 12 && buf.toString('ascii', 4, 8) === 'ftyp') {
            const brand = buf.toString('ascii', 8, 12).toLowerCase();
            if (['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
            if (['avif', 'avis'].includes(brand)) return 'image/avif';
        }
    } catch (_) {}
    return '';
}

function cleanIncomingBase64(rawValue = '', rawMime = 'image/jpeg') {
    let mime = String(rawMime || '').trim().toLowerCase();
    const rawStr = String(rawValue || '');
    const dataUrlMatch = rawStr.match(/^data:([^;]+);base64,/i);
    if (dataUrlMatch?.[1] && (!mime || mime === 'application/octet-stream' || mime === 'image/jpeg')) {
        mime = dataUrlMatch[1].trim().toLowerCase();
    }
    let clean = rawStr
        .replace(/^data:[^;]+;base64,/i, '')
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    if (clean && !clean.endsWith('=')) {
        while (clean.length % 4 !== 0) clean += '=';
    }
    return { clean, mime };
}

export async function extractTextFromImage({ mimeType = 'image/jpeg', imageBase64 = '', prompt = '', customKeys = null }) {
    const { clean: cleanBase64, mime: parsedMime } = cleanIncomingBase64(imageBase64, mimeType);
    if (!cleanBase64 || cleanBase64.length > MAX_EXTRACT_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleanBase64)) {
        throw Object.assign(new Error('Image data is empty, malformed, or too large.'), { code: 'invalid_image' });
    }
    const detectedMime = detectBinaryImageMime(cleanBase64);
    if (detectedMime && !LLM_DIRECT_IMAGE_MIMES.has(detectedMime)) {
        throw Object.assign(new Error('This image format requires browser conversion before OCR.'), { code: 'image_conversion_required' });
    }
    const providers = getVisionProviders(customKeys);
    if (!providers.groqApiKey && !providers.geminiApiKey) {
        throw new Error('Vision provider is not configured.');
    }
    const systemPrompt = [
        'You are an enterprise-grade document OCR engine.',
        'Transcribe all visible text exactly as written. Preserve layout, line breaks, bullet points, headers, and section hierarchies.',
        'FORMATTING RULES:',
        '- Render tables, grids, and multi-column data as clean Markdown tables with header separators (| Col 1 | Col 2 |).',
        '- For receipts, bills, and invoices: preserve store/vendor names, dates, itemized lines, quantities, unit prices, tax lines, and grand totals accurately.',
        '- For forms and key-value documents: preserve labels and values (e.g. "Name: ...", "Date: ...").',
        '- For mathematical equations or formulas: transcribe accurately using valid LaTeX notation inside $...$ or $$...$$.',
        '- For handwritten notes: transcribe clearly and do not guess unreadable characters.',
        '- Do not invent, assume, or hallucinate text that is not visible.',
        'Return strict JSON only:',
        '{ "fullText": "complete transcription in Markdown format", "textDetected": ["line 1", "line 2"], "summary": "short 1-sentence document overview" }',
        String(prompt || 'Extract all readable text, tables, and data from this image.').trim()
    ].join('\n');

    const result = await callVisionText({ providers, systemPrompt, mimeType: normalizeMimeForProvider(parsedMime || mimeType, cleanBase64), imageBase64: cleanBase64 });
    const rawText = result?.text;
    if (!rawText) return { ok: false, text: '', method: 'vision_ocr', provider: 'vision' };

    const parsed = safeParseJson(rawText) || extractJsonFromText(rawText) || null;
    const fullText = String(parsed?.fullText || '').trim();
    const snippets = Array.isArray(parsed?.textDetected)
        ? parsed.textDetected.map(item => String(item || '').trim()).filter(Boolean)
        : [];
    let text = fullText || snippets.join('\n').trim();
    if (!text && !parsed) {
        text = cleanVisionDisplayText(rawText);
    }
    if (/^(?:no text (?:was )?detected|no readable text)/i.test(text.trim())) {
        text = '';
    }
    return {
        ok: Boolean(text),
        text,
        summary: String(parsed?.summary || '').trim(),
        method: 'vision_ocr',
        provider: result.provider
    };
}

function getVisionProviders(customKeys = null) {
    const customGroq = String(customKeys?.groqKey || customKeys?.groq || '').trim();
    const customGemini = String(customKeys?.geminiKey || customKeys?.gemini || '').trim();
    return {
        groqApiKey: customGroq || process.env.GROQ_API_KEY || process.env.GROQ_KEY || '',
        groqModel: process.env.GROQ_VISION_MODEL || process.env.GROQ_MODEL || '',
        geminiApiKey: customGemini || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '',
        geminiModel: process.env.GEMINI_VISION_MODEL || process.env.GEMINI_MODEL || '',
        failures: []
    };
}

async function callVisionText({ providers, systemPrompt, mimeType, imageBase64 }) {
    if (providers.geminiApiKey) {
        const text = await callGeminiVision({
            apiKey: providers.geminiApiKey,
            configuredModel: providers.geminiModel,
            systemPrompt,
            mimeType,
            imageBase64,
            allowCompatibilityRetry: !providers.groqApiKey,
            failures: providers.failures
        });
        if (text) return { text, provider: 'gemini' };
    }
    if (providers.groqApiKey) {
        const text = await callGroqVisionText({
            apiKey: providers.groqApiKey,
            configuredModel: providers.groqModel,
            systemPrompt,
            mimeType,
            imageBase64,
            failures: providers.failures
        });
        if (text) return { text, provider: 'groq' };
    }
    const failure = visionFailurePayload(true, providers.failures);
    throw Object.assign(new Error(failure.response), { code: failure.code });
}

async function callGroqVisionText({ apiKey, configuredModel, systemPrompt, mimeType, imageBase64, failures }) {
    const candidates = filterAvailableExtractModels('groq', [String(configuredModel || '').trim(), ...GROQ_VISION_MODEL_FALLBACKS]);
    const dataUrl = `data:${mimeType || 'image/jpeg'};base64,${imageBase64}`;
    for (const model of candidates.slice(0, 3)) {
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
            if (response.status === 404 || response.status === 410) {
                failures.push({ status: response.status });
                markExtractModelUnavailable('groq', model, response.status);
                continue;
            }
            if (!response.ok) { failures.push({ status: response.status }); break; }
            const data = await response.json();
            const text = extractGroqText(data);
            if (text) return text;
        } catch (error) { failures.push({ status: error.status, name: error.name }); }
    }
    return '';
}

async function callGeminiVision({ apiKey, configuredModel = '', systemPrompt, mimeType, imageBase64, allowCompatibilityRetry, failures }) {
    const modelFallbacks = filterAvailableExtractModels('gemini', [String(configuredModel || '').trim(), ...GEMINI_MODEL_FALLBACKS]);
    for (const apiVersion of GEMINI_API_VERSIONS.slice(0, 2)) {
        for (const model of modelFallbacks.slice(0, 3)) {
            if (apiVersion === 'v1' && /^gemini-(?:4|3\.|2\.5)/i.test(model)) continue;
            try {
                const genConfig = {
                    temperature: 0.1,
                    maxOutputTokens: 8192
                };
                if (apiVersion === 'v1beta') {
                    genConfig.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
                    if (/gemini-(?:4|3\.|2\.5-(?:flash|pro))/i.test(model) && !/flash-lite/i.test(model)) {
                        genConfig.thinkingConfig = { thinkingBudget: 0 };
                    }
                }
                const makeReq = (gc) => fetchWithTimeout(
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
                            generationConfig: normalizeGeminiGenerationConfig(model, { ...gc })
                        })
                    }
                );
                let response = await makeReq(genConfig);
                if (allowCompatibilityRetry && response.status === 400 && (genConfig.mediaResolution || genConfig.thinkingConfig)) {
                    const fallbackGc = { ...genConfig };
                    delete fallbackGc.mediaResolution;
                    delete fallbackGc.thinkingConfig;
                    response = await makeReq(fallbackGc);
                }
                if (response.status === 404 || response.status === 410) {
                    failures.push({ status: response.status });
                    markExtractModelUnavailable('gemini', model, response.status);
                    continue;
                }
                if (!response.ok) {
                    failures.push({ status: response.status });
                    return '';
                }
                const data = await response.json();
                const text = extractGeminiText(data);
                if (text) return text;
            } catch (error) { failures.push({ status: error.status, name: error.name }); }
        }
    }
    return '';
}

async function fetchWithTimeout(url, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
        const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
        return await fetch(url, { ...init, signal });
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

// Repair unescaped LaTeX backslashes (\frac, \tan, \theta, \sqrt, \right, \begin, \neq) and raw newlines in JSON strings.
export function repairJsonEscapes(src = '') {
    let out = '';
    let inString = false;
    const s = String(src || '');
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (!inString) {
            if (ch === '"') inString = true;
            out += ch;
            continue;
        }
        if (ch === '"') {
            inString = false;
            out += ch;
            continue;
        }
        if (ch === '\n') { out += '\\n'; continue; }
        if (ch === '\r') { out += '\\r'; continue; }
        if (ch === '\t') { out += '\\t'; continue; }
        if (ch === '\\') {
            const next = s[i + 1];
            if (next === undefined) { out += '\\\\'; continue; }
            if (next === '\\' || next === '"' || next === '/') {
                out += ch + next;
                i++;
                continue;
            }
            if (next === 'u' && /^[0-9a-fA-F]{4}/.test(s.slice(i + 2, i + 6))) {
                out += s.slice(i, i + 6);
                i += 5;
                continue;
            }
            const rest = s.slice(i + 1);
            const isLatexEscape =
                (next === 'f' && /^(?:frac|forall|fbox)\b/i.test(rest)) ||
                (next === 't' && /^(?:tan|tanh|text|textbf|textit|textrm|texttt|theta|tau|tfrac|times|tilde|to|top|triangle|therefore|textstyle)\b/.test(rest)) ||
                (next === 'r' && /^(?:right|rightarrow|Rightarrow|rho|rceil|rfloor|rangle|rm\b|root)/.test(rest)) ||
                (next === 'b' && /^(?:begin|beta|binom|boxed|bar|bmod|bot|bullet|big|bigl|bigr|bigcup|bigcap|because)\b/.test(rest)) ||
                (next === 'n' && /^(?:nabla|neq|ne|nu|notin|nless|ngtr|nleq|ngeq|not|natural|neg|nexists|newline|nonumber)\b/.test(rest));
            if (isLatexEscape || !/[bfnrt]/.test(next)) {
                out += '\\\\' + next;
                i++;
                continue;
            }
            out += ch + next;
            i++;
            continue;
        }
        out += ch;
    }
    return out;
}

export function safeParseJson(value) {
    const raw = String(value || '');
    try {
        return JSON.parse(raw);
    } catch (_) {
        try {
            return JSON.parse(repairJsonEscapes(raw));
        } catch (_) {
            return null;
        }
    }
}

export function extractJsonFromText(rawText) {
    const raw = String(rawText || '').trim();
    if (!raw) return null;
    const unwrapped = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').replace(/^json\s*/i, '').trim();
    const direct = safeParseJson(unwrapped);
    if (direct && typeof direct === 'object') return direct;
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
