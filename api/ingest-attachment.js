export const config = { maxDuration: 60 };

import { applyApiSecurity, unsealSecret, isTrustedVercelBlobUrl } from './_lib/security.js';
import { ingestAttachmentPayload } from './_lib/attachment-ingest.js';
import { handleUpload } from '@vercel/blob/client';
import { get as getBlob, del as deleteBlob } from '@vercel/blob';

const DIRECT_UPLOAD_MAX_BYTES = 4404019; // ~4.2 MB conservative cap beneath Vercel Hobby's 4.5 MB limit
const MULTIPART_BODY_CAP_BYTES = Math.floor(4.45 * 1024 * 1024);
const BLOB_UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100 MB large file ceiling via @vercel/blob
const MAX_LEGACY_BASE64_CHARS = 8 * 1024 * 1024;

const BLOB_ALLOWED_CONTENT_TYPES = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.oasis.opendocument.presentation',
    'application/rtf',
    'text/rtf',
    'application/epub+zip',
    'application/zip',
    'application/x-zip-compressed',
    'application/json',
    'application/xml',
    'application/yaml',
    'text/yaml',
    'text/*',
    'image/*'
];

function getQueryAction(req) {
    try {
        const parsed = new URL(String(req?.url || '/api/ingest-attachment'), 'https://jarvis.local');
        return String(parsed.searchParams.get('action') || '').trim().toLowerCase();
    } catch (_) {
        return '';
    }
}

function resolveCustomKeys(req, formFields = null) {
    const pick = (headerNames = [], fieldNames = []) => {
        for (const h of headerNames) {
            const val = String(req?.headers?.[h] || '').trim();
            if (val) return unsealSecret(val);
        }
        for (const f of fieldNames) {
            const val = String(formFields?.[f] ?? req?.body?.customKeys?.[f] ?? '').trim();
            if (val) return unsealSecret(val);
        }
        return '';
    };
    return {
        groqKey: pick(['x-groq-api-key', 'x-byok-groq'], ['groqKey', 'groq']),
        geminiKey: pick(['x-gemini-api-key', 'x-goog-api-key', 'x-byok-gemini'], ['geminiKey', 'gemini']),
        llamaCloudKey: pick(['x-llamacloud-api-key', 'x-llama-cloud-api-key'], ['llamaCloudKey', 'llamaParseKey'])
    };
}

async function readRequestBuffer(req, maxBytes) {
    if (Buffer.isBuffer(req?.rawBody)) return req.rawBody;
    if (Buffer.isBuffer(req?.body)) return req.body;
    if (typeof req?.[Symbol.asyncIterator] !== 'function') return Buffer.alloc(0);

    const chunks = [];
    let total = 0;
    for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        total += buf.byteLength;
        if (total > maxBytes) {
            throw Object.assign(new Error('Multipart upload exceeds Vercel 4.2 MB direct upload limit.'), { status: 413, code: 'request_too_large' });
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}

async function parseMultipartRequest(req) {
    if (req?.__testFormData instanceof FormData) {
        return req.__testFormData;
    }
    const rawBuffer = await readRequestBuffer(req, MULTIPART_BODY_CAP_BYTES);
    if (!rawBuffer.byteLength) {
        throw Object.assign(new Error('Multipart form-data body is empty.'), { status: 400, code: 'invalid_request' });
    }
    const headers = new Headers();
    for (const [k, v] of Object.entries(req?.headers || {})) {
        if (v !== undefined && v !== null) headers.set(k, Array.isArray(v) ? v.join(', ') : String(v));
    }
    const webReq = new Request('https://jarvis.local/api/ingest-attachment', {
        method: 'POST',
        headers,
        body: rawBuffer
    });
    return await webReq.formData();
}

async function readStreamToBuffer(readableStream, maxBytes) {
    const reader = readableStream.getReader();
    const chunks = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.from(value);
        total += buf.byteLength;
        if (total > maxBytes) {
            try { await reader.cancel(); } catch (_) {}
            throw Object.assign(new Error(`Downloaded file exceeds maximum ${Math.round(maxBytes / (1024 * 1024))} MB processing limit.`), { status: 413, code: 'blob_too_large' });
        }
        chunks.push(buf);
    }
    return Buffer.concat(chunks);
}

async function downloadVercelBlob(blobUrl, ops = {}) {
    if (typeof ops.fetchBlobBuffer === 'function') {
        return await ops.fetchBlobBuffer(blobUrl);
    }
    const getFn = ops.getBlob || getBlob;
    let lastError = null;
    for (const access of ['private', 'public']) {
        try {
            const result = await getFn(blobUrl, { access });
            if (result?.statusCode === 200 && result.stream) {
                return await readStreamToBuffer(result.stream, BLOB_UPLOAD_MAX_BYTES);
            }
        } catch (err) {
            lastError = err;
        }
    }
    throw lastError || new Error('Failed to fetch temporary file from Vercel Blob storage.');
}

async function removeVercelBlob(blobUrl, ops = {}) {
    if (!blobUrl || !isTrustedVercelBlobUrl(blobUrl)) return false;
    if (typeof ops.deleteBlob === 'function') {
        await ops.deleteBlob(blobUrl);
        return true;
    }
    if (!process.env.BLOB_READ_WRITE_TOKEN) return false;
    await deleteBlob(blobUrl);
    return true;
}

export function createIngestAttachmentHandler(ops = {}) {
    return async function handler(req, res) {
        const action = getQueryAction(req);

        if (req?.method === 'GET' && action === 'blob-status') {
            const guard = applyApiSecurity(req, res, {
                methods: ['GET'],
                routeKey: 'ingest-attachment-status',
                rateLimit: { max: 60, windowMs: 60 * 1000 },
                skipAbusiveCheck: true
            });
            if (guard.handled) return;
            const hasBlobToken = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim()) || Boolean(ops.forceBlobConfigured);
            return res.status(200).json({
                success: true,
                blobConfigured: hasBlobToken,
                directUploadMaxBytes: DIRECT_UPLOAD_MAX_BYTES,
                blobUploadMaxBytes: BLOB_UPLOAD_MAX_BYTES,
                maxFileBytes: hasBlobToken ? BLOB_UPLOAD_MAX_BYTES : DIRECT_UPLOAD_MAX_BYTES
            });
        }

        const guard = applyApiSecurity(req, res, {
            methods: ['POST', 'GET'],
            routeKey: 'ingest-attachment',
            allowMultipart: true,
            maxBodyBytes: MULTIPART_BODY_CAP_BYTES,
            rateLimit: { max: 45, windowMs: 60 * 1000 },
            skipAbusiveCheck: true
        });
        if (guard.handled) return;

        // Action 1: Issue Vercel Blob client upload token or process completion webhook
        if (action === 'blob-upload' || req?.body?.type === 'blob.generate-client-token' || req?.body?.type === 'blob.upload-completed') {
            const hasToken = Boolean(String(process.env.BLOB_READ_WRITE_TOKEN || '').trim());
            if (!hasToken && typeof ops.handleUpload !== 'function') {
                return res.status(503).json({
                    success: false,
                    error: {
                        code: 'blob_not_configured',
                        message: 'Large files over 4.2 MB require Vercel Blob (BLOB_READ_WRITE_TOKEN is not configured on the server).'
                    }
                });
            }
            try {
                const uploadFn = ops.handleUpload || handleUpload;
                const jsonResponse = await uploadFn({
                    body: req.body,
                    request: req,
                    onBeforeGenerateToken: async (pathname) => {
                        if (String(pathname || '').includes('..')) {
                            throw new Error('Invalid upload pathname.');
                        }
                        return {
                            allowedContentTypes: BLOB_ALLOWED_CONTENT_TYPES,
                            maximumSizeInBytes: BLOB_UPLOAD_MAX_BYTES,
                            addRandomSuffix: true,
                            tokenPayload: JSON.stringify({ issuedAt: Date.now() })
                        };
                    },
                    onUploadCompleted: async () => {}
                });
                return res.status(200).json(jsonResponse);
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'blob_token_failed',
                        message: String(error?.message || 'Unable to authorize large file upload.')
                    }
                });
            }
        }

        // Action 2: Client-initiated cleanup of cancelled or failed temporary Blob uploads
        if (action === 'blob-cleanup') {
            const urls = Array.isArray(req.body?.blobUrls)
                ? req.body.blobUrls
                : (req.body?.blobUrl ? [req.body.blobUrl] : []);
            const invalid = urls.find(u => !isTrustedVercelBlobUrl(u));
            if (!urls.length || invalid) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'invalid_blob_url', message: 'A valid Vercel Blob URL is required for cleanup.' }
                });
            }
            let cleaned = 0;
            for (const url of urls) {
                try {
                    const ok = await removeVercelBlob(url, ops);
                    if (ok) cleaned += 1;
                } catch (_) {}
            }
            return res.status(200).json({ success: true, cleaned });
        }

        // Path A: Binary multipart/form-data upload (direct <= 4.2 MB, zero base64 overhead)
        const contentType = String(req?.headers?.['content-type'] || '').toLowerCase();
        if (contentType.includes('multipart/form-data')) {
            try {
                const formData = await parseMultipartRequest(req);
                const uploadedFile = formData.get('file');
                if (!uploadedFile || typeof uploadedFile.arrayBuffer !== 'function') {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'invalid_request', message: 'Multipart field "file" is required.' }
                    });
                }
                const buffer = Buffer.from(await uploadedFile.arrayBuffer());
                if (!buffer.byteLength) {
                    return res.status(400).json({
                        success: false,
                        error: { code: 'empty_file', message: 'Uploaded file is empty.' }
                    });
                }
                if (buffer.byteLength > DIRECT_UPLOAD_MAX_BYTES) {
                    return res.status(413).json({
                        success: false,
                        error: { code: 'request_too_large', message: 'File exceeds the 4.2 MB direct upload limit; use Vercel Blob client upload.' }
                    });
                }
                const filename = String(formData.get('filename') || uploadedFile.name || 'attachment').trim() || 'attachment';
                const mimeType = String(formData.get('mimeType') || uploadedFile.type || '').trim();
                const customKeys = resolveCustomKeys(req, {
                    groqKey: formData.get('groqKey'),
                    geminiKey: formData.get('geminiKey'),
                    llamaCloudKey: formData.get('llamaCloudKey')
                });

                const result = await ingestAttachmentPayload({
                    filename,
                    mimeType,
                    buffer,
                    customKeys
                });
                return res.status(200).json({
                    success: result.success || result.partial === true || (Array.isArray(result.images) && result.images.length > 0),
                    ...result
                });
            } catch (error) {
                const status = Number(error?.status) || 400;
                return res.status(status).json({
                    success: false,
                    error: {
                        code: error?.code || 'multipart_parse_error',
                        message: String(error?.message || 'Unable to process uploaded file.')
                    }
                });
            }
        }

        // Path B: JSON referencing a temporary Vercel Blob upload (files > 4.2 MB up to 100 MB)
        const customKeys = resolveCustomKeys(req);
        if (req.body?.blobUrl) {
            const blobUrl = String(req.body.blobUrl).trim();
            if (!isTrustedVercelBlobUrl(blobUrl)) {
                return res.status(400).json({
                    success: false,
                    error: { code: 'invalid_blob_url', message: 'Untrusted blob URL rejected.' }
                });
            }
            if (!process.env.BLOB_READ_WRITE_TOKEN && typeof ops.fetchBlobBuffer !== 'function') {
                return res.status(503).json({
                    success: false,
                    error: {
                        code: 'blob_not_configured',
                        message: 'Large files uploaded via Blob require BLOB_READ_WRITE_TOKEN to be configured on the server.'
                    }
                });
            }

            const filename = String(req.body?.filename || 'attachment').trim() || 'attachment';
            const mimeType = String(req.body?.mimeType || '').trim();
            let blobDeleted = false;
            try {
                const buffer = await downloadVercelBlob(blobUrl, ops);
                const result = await ingestAttachmentPayload({
                    filename,
                    mimeType,
                    buffer,
                    customKeys
                });
                blobDeleted = await removeVercelBlob(blobUrl, ops).catch(() => false);
                return res.status(200).json({
                    success: result.success || result.partial === true || (Array.isArray(result.images) && result.images.length > 0),
                    blobCleaned: blobDeleted,
                    ...result
                });
            } catch (error) {
                const status = Number(error?.status) || 502;
                return res.status(status).json({
                    success: false,
                    error: {
                        code: error?.code || 'blob_ingest_failed',
                        message: String(error?.message || 'Unable to ingest uploaded Blob file.')
                    }
                });
            } finally {
                if (!blobDeleted) {
                    await removeVercelBlob(blobUrl, ops).catch(() => {});
                }
            }
        }

        // Path C: Backward-compatible JSON (clientText or small legacy base64 test calls)
        const filename = String(req.body?.filename || 'attachment').trim() || 'attachment';
        const mimeType = String(req.body?.mimeType || '').trim();
        const rawBase64 = String(req.body?.base64 || '').trim();
        const base64 = rawBase64
            .replace(/^data:[^;]+;base64,/i, '')
            .replace(/\s+/g, '')
            .replace(/-/g, '+')
            .replace(/_/g, '/');
        const clientText = String(req.body?.clientText || '').trim();
        const clientMethod = String(req.body?.clientMethod || '').trim();

        if (!clientText && !base64) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'invalid_request',
                    message: 'Attachment file (multipart/form-data), blobUrl, or clientText is required.',
                    details: {
                        missing: ['base64', 'clientText'],
                        accepted: ['file', 'blobUrl', 'clientText', 'base64'],
                        filename,
                        mimeType: mimeType || 'unknown'
                    }
                }
            });
        }
        if (base64 && (base64.length > MAX_LEGACY_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))) {
            return res.status(413).json({
                success: false,
                error: { code: 'payload_too_large', message: 'Attachment is too large or malformed.' }
            });
        }

        try {
            const result = await ingestAttachmentPayload({
                filename,
                mimeType,
                base64,
                clientText,
                clientMethod,
                customKeys
            });
            return res.status(200).json({
                success: result.success || result.partial === true || (Array.isArray(result.images) && result.images.length > 0),
                ...result
            });
        } catch (error) {
            return res.status(502).json({
                success: false,
                error: {
                    code: 'attachment_ingest_failed',
                    message: String(error?.message || 'Unable to inspect the attached file.')
                }
            });
        }
    };
}

export default createIngestAttachmentHandler();
