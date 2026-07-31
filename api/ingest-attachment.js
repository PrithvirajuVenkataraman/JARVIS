export const config = { maxDuration: 60 };

import { applyApiSecurity } from './_lib/security.js';
import { ingestAttachmentPayload } from './_lib/attachment-ingest.js';

const MAX_BASE64_CHARS = 8 * 1024 * 1024;

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'ingest-attachment',
        maxBodyBytes: 9 * 1024 * 1024,
        rateLimit: { max: 20, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const filename = String(req.body?.filename || 'attachment').trim() || 'attachment';
    const mimeType = String(req.body?.mimeType || '').trim();
    const base64 = String(req.body?.base64 || '').trim();
    const clientText = String(req.body?.clientText || '').trim();
    const clientMethod = String(req.body?.clientMethod || '').trim();

    if (!clientText && !base64) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_request', message: 'Attachment data is required.' }
        });
    }
    if (base64 && (base64.length > MAX_BASE64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64))) {
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
            clientMethod
        });
        return res.status(200).json({
            success: result.success || result.partial === true,
            ...result
        });
    } catch (error) {
        return res.status(502).json({
            success: false,
            error: {
                code: 'ingest_failed',
                message: String(error?.message || 'Attachment processing failed.')
            }
        });
    }
}
