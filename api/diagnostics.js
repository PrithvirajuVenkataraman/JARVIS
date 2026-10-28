import { applyApiSecurity } from './_lib/security.js';
import { getCostControls } from './_lib/cost-controls.js';
import { isTelemetryExporterConfigured } from './_lib/telemetry-exporter.js';
import handleFeedback from './_lib/feedback-handler.js';
import { resolveRequestPath } from './_lib/api-router.js';

function hasEnv(name) {
    return String(process.env[name] || '').trim().length > 0;
}

function isEnabled(name) {
    return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase());
}

function isPublicFactSearchEnabled() {
    const flag = String(process.env.JARVIS_PUBLIC_FACT_SEARCH || '').trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(flag)) return false;
    return true;
}

export function buildDiagnosticsStatus() {
  const costControls = getCostControls();
    return {
        model: {
            groqConfigured: hasEnv('GROQ_API_KEY'),
            geminiConfigured: hasEnv('GEMINI_API_KEY') || hasEnv('GOOGLE_API_KEY'),
            byokSupported: true
        },
        streaming: {
            available: true
        },
        vision: {
            configured: hasEnv('GEMINI_API_KEY') || hasEnv('GOOGLE_API_KEY') || hasEnv('GROQ_API_KEY') || hasEnv('GROQ_KEY')
        },
        retrieval: {
            liveSearchEnabled: isEnabled('LIVE_RETRIEVAL_ENABLED'),
            publicFactSearchEnabled: isPublicFactSearchEnabled(),
            exaConfigured: hasEnv('EXA_API_KEY') || hasEnv('EXA_KEY'),
            nvidiaConfigured: hasEnv('NVIDIA_API_KEY') || hasEnv('NVIDIA_NIM_API_KEY'),
            crawl4aiConfigured: hasEnv('CRAWL4AI_URL') || hasEnv('CRAWL4AI_ENDPOINT')
        },
        compliance: {
            dlpEnabled: process.env.DLP_ENABLED !== 'false',
            policyMode: process.env.DLP_POLICY_MODE === 'enforced' ? 'enforced' : 'personal',
            telemetryExportEnabled: process.env.TELEMETRY_EXPORT_ENABLED !== 'false',
            exporterConfigured: isTelemetryExporterConfigured(),
            feedbackEnabled: process.env.FEEDBACK_ENABLED !== 'false'
        },
        costControls
    };
}

export default async function handler(req, res) {
    const matchedPath = String(req?.headers?.['x-matched-path'] || req?.headers?.['x-original-uri'] || '').trim();
    const reqPath = resolveRequestPath(req);
    const isFeedback = (
        reqPath === '/api/feedback' ||
        matchedPath === '/api/feedback' ||
        req?.query?.__route === 'feedback' ||
        req.url?.includes('__route=feedback') ||
        req.url?.includes('feedback') ||
        req.body?.score !== undefined
    );
    if (isFeedback) {
        return handleFeedback(req, res);
    }

    const security = applyApiSecurity(req, res, {
        methods: ['GET', 'POST', 'OPTIONS'],
        rateLimit: { key: 'diagnostics', max: 40 }
    });
    if (security.handled) return;

    try {
        return res.status(200).json({
            ok: true,
            diagnostics: buildDiagnosticsStatus()
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: { code: 'diagnostics_error', message: err?.message || 'Failed to inspect diagnostics.' }
        });
    }
}
