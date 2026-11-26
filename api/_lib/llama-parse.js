const LLAMA_CLOUD_BASE_URL = 'https://api.cloud.llamaindex.ai';
const LLAMAPARSE_SUPPORTED_RE = /\.(?:pdf|docx?|pptx?|xlsx?|xlsm|xlsb|ods|odt|odp|rtf|epub|html?|xml)$/i;
const LLAMAPARSE_VALID_TIERS = new Set(['fast', 'cost_effective', 'agentic', 'agentic_plus']);

export function resolveLlamaCloudApiKey(customKeys = null) {
    return String(
        customKeys?.llamaCloudKey ||
        customKeys?.llamaParseKey ||
        process.env.LLAMA_CLOUD_API_KEY ||
        process.env.LLAMACLOUD_API_KEY ||
        ''
    ).trim();
}

export function resolveLlamaParseTier(explicitTier = '') {
    const candidate = String(explicitTier || process.env.LLAMAPARSE_TIER || 'cost_effective')
        .trim()
        .toLowerCase();
    return LLAMAPARSE_VALID_TIERS.has(candidate) ? candidate : 'cost_effective';
}

export function isLlamaParseSupportedDocument(mimeType = '', filename = '') {
    const cleanMime = String(mimeType || '').trim().toLowerCase();
    const cleanName = String(filename || '').trim().toLowerCase();
    if (LLAMAPARSE_SUPPORTED_RE.test(cleanName)) return true;
    return [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/rtf',
        'text/rtf',
        'application/epub+zip',
        'application/vnd.oasis.opendocument.text',
        'application/vnd.oasis.opendocument.presentation',
        'application/vnd.oasis.opendocument.spreadsheet'
    ].includes(cleanMime);
}

export function extractMarkdownFromLlamaParseResult(payload) {
    if (!payload || typeof payload !== 'object') return '';

    const mdPages = Array.isArray(payload?.markdown?.pages) ? payload.markdown.pages : null;
    if (mdPages && mdPages.length > 0) {
        const joined = mdPages
            .map(page => String(page?.markdown ?? page?.text ?? '').trim())
            .filter(Boolean)
            .join('\n\n')
            .trim();
        if (joined) return joined;
    }

    if (typeof payload?.markdown_full === 'string' && payload.markdown_full.trim()) {
        return payload.markdown_full.trim();
    }
    if (typeof payload?.markdown === 'string' && payload.markdown.trim()) {
        return payload.markdown.trim();
    }

    const textPages = Array.isArray(payload?.text?.pages) ? payload.text.pages : null;
    if (textPages && textPages.length > 0) {
        const joined = textPages
            .map(page => String(page?.text ?? '').trim())
            .filter(Boolean)
            .join('\n\n')
            .trim();
        if (joined) return joined;
    }
    if (typeof payload?.text === 'string' && payload.text.trim()) {
        return payload.text.trim();
    }
    return '';
}

export async function parseDocumentWithLlamaParse({
    buffer = null,
    base64 = '',
    filename = 'document.pdf',
    mimeType = 'application/octet-stream',
    apiKey = '',
    customKeys = null,
    tier = '',
    timeoutMs = 25000
} = {}) {
    const resolvedKey = String(apiKey || resolveLlamaCloudApiKey(customKeys)).trim();
    if (!resolvedKey) {
        return {
            ok: false,
            configured: false,
            text: '',
            method: 'llamaparse_api',
            provider: 'llamaparse',
            error: 'LLAMA_CLOUD_API_KEY is not configured.'
        };
    }

    let fileBuffer = Buffer.isBuffer(buffer) ? buffer : null;
    if (!fileBuffer && base64) {
        const clean = String(base64).replace(/^data:[^;]+;base64,/i, '').replace(/\s+/g, '');
        if (clean) fileBuffer = Buffer.from(clean, 'base64');
    }
    if (!fileBuffer || !fileBuffer.length) {
        return {
            ok: false,
            configured: true,
            text: '',
            method: 'llamaparse_api',
            provider: 'llamaparse',
            error: 'Empty file buffer for LlamaParse.'
        };
    }

    const resolvedTier = resolveLlamaParseTier(tier);
    const safeFilename = String(filename || 'document').replace(/[/\\]/g, '_').trim() || 'document';
    const deadline = Date.now() + Math.max(5000, Math.min(Number(timeoutMs) || 25000, 45000));

    try {
        const form = new FormData();
        form.append('file', new Blob([fileBuffer], { type: mimeType || 'application/octet-stream' }), safeFilename);
        form.append('configuration', JSON.stringify({
            tier: resolvedTier,
            version: 'latest'
        }));

        const uploadRemainingMs = Math.max(3000, deadline - Date.now());
        const uploadResp = await fetch(`${LLAMA_CLOUD_BASE_URL}/api/v2/parse/upload`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${resolvedKey}`,
                Accept: 'application/json'
            },
            body: form,
            signal: AbortSignal.timeout(uploadRemainingMs)
        });

        const uploadData = await uploadResp.json().catch(() => null);
        if (!uploadResp.ok) {
            const detail = uploadData?.detail || uploadData?.error?.message || uploadData?.message || `HTTP ${uploadResp.status}`;
            return {
                ok: false,
                configured: true,
                text: '',
                method: 'llamaparse_api',
                provider: 'llamaparse',
                error: `LlamaParse upload failed (${uploadResp.status}): ${String(detail)}`
            };
        }

        const immediateText = extractMarkdownFromLlamaParseResult(uploadData);
        if (immediateText) {
            return {
                ok: true,
                configured: true,
                text: immediateText,
                method: 'llamaparse_api',
                provider: 'llamaparse',
                tier: resolvedTier,
                jobId: String(uploadData?.id || uploadData?.job?.id || '')
            };
        }

        const jobId = String(uploadData?.id || uploadData?.job?.id || '').trim();
        if (!jobId) {
            return {
                ok: false,
                configured: true,
                text: '',
                method: 'llamaparse_api',
                provider: 'llamaparse',
                error: 'LlamaParse did not return a job ID.'
            };
        }

        let pollIntervalMs = 700;
        while (Date.now() < deadline) {
            await new Promise(resolve => setTimeout(resolve, Math.min(pollIntervalMs, Math.max(50, deadline - Date.now()))));
            if (Date.now() >= deadline) break;

            const remainingMs = Math.max(2000, deadline - Date.now());
            const pollResp = await fetch(
                `${LLAMA_CLOUD_BASE_URL}/api/v2/parse/${encodeURIComponent(jobId)}?expand=markdown`,
                {
                    method: 'GET',
                    headers: {
                        Authorization: `Bearer ${resolvedKey}`,
                        Accept: 'application/json'
                    },
                    signal: AbortSignal.timeout(remainingMs)
                }
            );

            const pollData = await pollResp.json().catch(() => null);
            if (!pollResp.ok) {
                if (pollResp.status === 429 || pollResp.status >= 500) {
                    pollIntervalMs = Math.min(pollIntervalMs + 400, 1800);
                    continue;
                }
                const detail = pollData?.detail || pollData?.error?.message || pollData?.message || `HTTP ${pollResp.status}`;
                return {
                    ok: false,
                    configured: true,
                    text: '',
                    method: 'llamaparse_api',
                    provider: 'llamaparse',
                    error: `LlamaParse poll failed (${pollResp.status}): ${String(detail)}`
                };
            }

            const status = String(pollData?.job?.status || pollData?.status || '').trim().toUpperCase();
            if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'READY'].includes(status)) {
                const parsedText = extractMarkdownFromLlamaParseResult(pollData);
                if (parsedText) {
                    return {
                        ok: true,
                        configured: true,
                        text: parsedText,
                        method: 'llamaparse_api',
                        provider: 'llamaparse',
                        tier: resolvedTier,
                        jobId
                    };
                }
                return {
                    ok: false,
                    configured: true,
                    text: '',
                    method: 'llamaparse_api',
                    provider: 'llamaparse',
                    error: 'LlamaParse completed with empty output.'
                };
            }

            if (['ERROR', 'FAILED', 'CANCELLED', 'CANCELED'].includes(status)) {
                const errMsg = pollData?.job?.error_message || pollData?.error_message || status;
                return {
                    ok: false,
                    configured: true,
                    text: '',
                    method: 'llamaparse_api',
                    provider: 'llamaparse',
                    error: `LlamaParse job failed: ${String(errMsg)}`
                };
            }

            pollIntervalMs = Math.min(pollIntervalMs + 300, 1500);
        }

        return {
            ok: false,
            configured: true,
            text: '',
            method: 'llamaparse_api',
            provider: 'llamaparse',
            error: 'LlamaParse timed out before job completion.'
        };
    } catch (err) {
        return {
            ok: false,
            configured: true,
            text: '',
            method: 'llamaparse_api',
            provider: 'llamaparse',
            error: String(err?.message || err)
        };
    }
}
