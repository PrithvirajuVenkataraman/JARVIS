/**
 * Optional Server-Side Telemetry & Trace Exporter for OpenTelemetry / Langfuse.
 *
 * Privacy Invariants:
 * - Metadata-only spans by default (route, model, latency, tokens, dlp actions).
 * - Never logs or transmits raw secrets.
 * - Non-blocking: all export errors are swallowed with an error counter,
 *   never delaying or failing user requests.
 */

let exportFailureCount = 0;

function isExportEnabled() {
    const flag = String(process.env.TELEMETRY_EXPORT_ENABLED || '').trim().toLowerCase();
    if (['0', 'false', 'no', 'off'].includes(flag)) return false;
    return Boolean(
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        process.env.LANGFUSE_PUBLIC_KEY
    );
}

export function isTelemetryExporterConfigured() {
    return Boolean(
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
        process.env.LANGFUSE_PUBLIC_KEY
    );
}

export function getExportFailureCount() {
    return exportFailureCount;
}

/**
 * Parses header strings like "key1=val1,key2=val2" or JSON format.
 */
function parseHeaders(rawHeaders = '') {
    const headers = { 'Content-Type': 'application/json' };
    if (!rawHeaders) return headers;
    try {
        if (rawHeaders.trim().startsWith('{')) {
            return { ...headers, ...JSON.parse(rawHeaders) };
        }
    } catch (_) {}
    const pairs = rawHeaders.split(',');
    for (const pair of pairs) {
        const [k, v] = pair.split('=');
        if (k && v) {
            headers[k.trim()] = v.trim();
        }
    }
    return headers;
}

/**
 * Asynchronously exports an execution trace span to OTel or Langfuse.
 */
export async function exportTraceSpan({
    traceId = '',
    route = '',
    model = '',
    latencyMs = 0,
    tokens = {},
    dlpAction = null,
    dlpFindings = []
}) {
    if (!isExportEnabled()) return false;

    const spanPayload = {
        traceId: String(traceId || `trace_${Date.now()}`),
        timestamp: new Date().toISOString(),
        route: String(route || ''),
        model: String(model || ''),
        latencyMs: Math.round(Number(latencyMs) || 0),
        tokens: {
            prompt: Number(tokens.prompt || 0),
            completion: Number(tokens.completion || 0),
            total: Number(tokens.total || 0)
        },
        dlp: {
            action: dlpAction || 'none',
            findingCount: Array.isArray(dlpFindings) ? dlpFindings.length : 0
        }
    };

    // Non-blocking dispatch
    const exportPromise = (async () => {
        try {
            // 1. OpenTelemetry OTLP endpoint
            const otelEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
            if (otelEndpoint) {
                const url = otelEndpoint.endsWith('/') ? `${otelEndpoint}v1/traces` : `${otelEndpoint}/v1/traces`;
                const headers = parseHeaders(process.env.OTEL_EXPORTER_OTLP_HEADERS);
                await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ resourceSpans: [{ span: spanPayload }] }),
                    signal: AbortSignal.timeout(2500)
                }).catch(() => {});
            }

            // 2. Langfuse endpoint
            const langfuseKey = process.env.LANGFUSE_PUBLIC_KEY;
            const langfuseSecret = process.env.LANGFUSE_SECRET_KEY;
            if (langfuseKey && langfuseSecret) {
                const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
                const url = `${baseUrl.replace(/\/+$/, '')}/api/public/ingestion`;
                const authHeader = 'Basic ' + Buffer.from(`${langfuseKey}:${langfuseSecret}`).toString('base64');
                await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Authorization': authHeader,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        batch: [
                            {
                                id: spanPayload.traceId,
                                type: 'generation-create',
                                timestamp: spanPayload.timestamp,
                                body: {
                                    traceId: spanPayload.traceId,
                                    name: spanPayload.route,
                                    model: spanPayload.model,
                                    metadata: {
                                        latencyMs: spanPayload.latencyMs,
                                        dlp: spanPayload.dlp
                                    },
                                    usage: spanPayload.tokens
                                }
                            }
                        ]
                    }),
                    signal: AbortSignal.timeout(2500)
                }).catch(() => {});
            }
        } catch (_) {
            exportFailureCount++;
        }
    })();

    // Safeguard: fire and forget or short-timeout race
    return Promise.race([
        exportPromise,
        new Promise(resolve => setTimeout(resolve, 50))
    ]).catch(() => {});
}

/**
 * Asynchronously exports a user feedback evaluation score to Langfuse / OTel.
 */
export async function exportFeedbackScore({
    traceId = '',
    turnId = '',
    score = 1,
    tags = [],
    comment = ''
}) {
    if (!isExportEnabled()) return false;

    const feedbackPayload = {
        traceId: String(traceId || turnId || `fb_${Date.now()}`),
        turnId: String(turnId || ''),
        value: Number(score) > 0 ? 1 : 0,
        tags: Array.isArray(tags) ? tags : [],
        comment: String(comment || '').slice(0, 200),
        timestamp: new Date().toISOString()
    };

    try {
        const langfuseKey = process.env.LANGFUSE_PUBLIC_KEY;
        const langfuseSecret = process.env.LANGFUSE_SECRET_KEY;
        if (langfuseKey && langfuseSecret) {
            const baseUrl = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
            const url = `${baseUrl.replace(/\/+$/, '')}/api/public/scores`;
            const authHeader = 'Basic ' + Buffer.from(`${langfuseKey}:${langfuseSecret}`).toString('base64');
            await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    traceId: feedbackPayload.traceId,
                    name: 'user_feedback',
                    value: feedbackPayload.value,
                    comment: feedbackPayload.tags.join(', ') + (feedbackPayload.comment ? ` - ${feedbackPayload.comment}` : '')
                }),
                signal: AbortSignal.timeout(2500)
            }).catch(() => {});
        }
    } catch (_) {
        exportFailureCount++;
    }
}
