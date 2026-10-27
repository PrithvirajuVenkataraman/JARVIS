export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';
import { scanDlp } from '../app/dlp-engine.js';
import { exportFeedbackScore } from './_lib/telemetry-exporter.js';

export default async function handler(req, res) {
    const security = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'feedback',
        maxBodyBytes: 16 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (security.handled) return;

    try {
        const body = req.body || {};
        const turnId = String(body.turnId || '').trim();
        const traceId = String(body.traceId || turnId || `fb_${Date.now()}`);
        const score = Number(body.score) > 0 ? 1 : -1;
        const tags = Array.isArray(body.tags) ? body.tags.slice(0, 10).map(t => String(t).slice(0, 50)) : [];
        const rawComment = String(body.comment || '').trim().slice(0, 200);

        // Server DLP scan on comment
        let sanitizedComment = '';
        if (rawComment) {
            const dlpResult = scanDlp(rawComment, { maskPii: true });
            if (dlpResult.decision === 'BLOCK') {
                return res.status(400).json({
                    success: false,
                    code: 'dlp_violation',
                    error: { code: 'dlp_violation', message: 'Feedback comment contains sensitive credentials.' }
                });
            }
            sanitizedComment = dlpResult.sanitizedText;
        }

        // Export score to external OTel/Langfuse if configured
        await exportFeedbackScore({
            traceId,
            turnId,
            score,
            tags,
            comment: sanitizedComment
        });

        return res.status(200).json({
            success: true,
            turnId,
            recordedAt: Date.now()
        });
    } catch (err) {
        return res.status(500).json({
            success: false,
            error: { code: 'feedback_error', message: 'Failed to record feedback.' }
        });
    }
}
