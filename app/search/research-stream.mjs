import { RESEARCH_LIMITS, researchTimeoutSignal } from './research-contract.mjs';

export async function streamResearchRequest(endpoint, payload, { signal, onEvent, timeoutMs } = {}) {
    const scope = researchTimeoutSignal(timeoutMs || RESEARCH_LIMITS.TOTAL_MS + RESEARCH_LIMITS.CLIENT_GRACE_MS, signal);
    let reader;
    const cancel = () => { reader?.cancel().catch(() => {}); };
    scope.signal.addEventListener('abort', cancel, { once: true });
    try {
        const response = await fetch(endpoint, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
            signal: scope.signal, body: JSON.stringify({ ...payload, stream: true })
        });
        if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream')) {
            const data = await response.json().catch(() => null);
            throw new Error(data?.error?.message || `Live research failed (${response.status})`);
        }
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let final = null;
        const drain = flush => {
            buffer = buffer.replace(/\r\n/g, '\n');
            const events = buffer.split('\n\n');
            buffer = flush ? '' : events.pop();
            for (const block of events) {
                const lines = block.split('\n');
                const event = lines.find(l => l.startsWith('event:'))?.slice(6).trim() || 'message';
                const raw = lines.filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n');
                if (!raw) continue;
                let data;
                try { data = JSON.parse(raw); } catch { throw new Error('The research stream returned invalid data.'); }
                if (event === 'done') final = data;
                if (!scope.signal.aborted) onEvent?.(event, data);
            }
        };
        while (!scope.signal.aborted && !final) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 1_000_000) throw new Error('The research stream exceeded its response limit.');
            drain(false);
        }
        buffer += decoder.decode(); drain(true);
        if (scope.signal.aborted) throw new Error('The research request was cancelled or exceeded its deadline.');
        if (!final) throw new Error('The research connection ended before completion.');
        return final;
    } finally {
        scope.signal.removeEventListener('abort', cancel);
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        scope.dispose();
    }
}

// The server owns research timing and evidence IDs. The client renders its events and honours cancellation.
export async function executeRemoteResearch(controller, options, helpers) {
    const { query, userText, context = [], researchStreamFn, uiCallbacks = {}, assistantMessageId } = options;
    const { states, provenanceModes, normalizeSources, fallback } = helpers;
    const start = performance.now();
    controller.telemetry.t_start = start;
    controller.transition(states.SEARCHING, {}, uiCallbacks);
    let settled = false;
    return new Promise(resolve => {
        const finish = result => {
            if (settled || controller.isTerminal) return;
            settled = true;
            const sources = controller.sources;
            controller.provenance = result.provenance || provenanceModes.NO_SOURCES;
            controller.telemetry.t_completed = performance.now();
            controller.telemetry.totalDurationMs = Math.round(controller.telemetry.t_completed - start);
            controller.telemetry.sourcesCount = sources.length;
            const final = { ...result, content: result.content || fallback(query, sources), sources, turnId: controller.turnId, assistantMessageId, telemetry: { ...controller.telemetry, research: result.research } };
            controller.transition(states.COMPLETE, {}, uiCallbacks);
            controller._resolveExecution = null;
            try { uiCallbacks.onComplete?.(final); } catch { /* UI callbacks cannot reopen a completed request. */ }
            resolve(final);
        };
        controller._resolveExecution = result => { if (!settled) { settled = true; resolve(result); } };
        if (!String(query || '').trim()) { finish({ success: false, provenance: provenanceModes.NO_SOURCES, sources: [] }); return; }
        researchStreamFn({
            query, userText, context, signal: controller.searchAbortController.signal,
            timeoutMs: RESEARCH_LIMITS.TOTAL_MS + RESEARCH_LIMITS.CLIENT_GRACE_MS,
            onEvent: (event, data) => {
                if (settled || controller.isTerminal) return;
                if (event === 'status') {
                    const nextState = data.status === 'synthesizing' ? states.SOURCE_GROUNDED_SYNTHESIS : states.SEARCHING;
                    controller.transition(nextState, { ...data }, uiCallbacks);
                } else if (event === 'sources') {
                    const seen = new Set();
                    controller.sources = (data.sources || []).flatMap(s => {
                        const item = normalizeSources([s], query, 1)[0];
                        if (!item || !Number.isInteger(s.id) || seen.has(s.id)) return [];
                        seen.add(s.id); return [{ ...item, id: s.id }];
                    });
                    controller.telemetry.t_sources_rendered = performance.now();
                    uiCallbacks.onSourcesValidated?.({ sources: controller.sources, turnId: controller.turnId, assistantMessageId, provenance: provenanceModes.WEB_GROUNDED });
                } else if (event === 'token') {
                    controller.streamedText += String(data.token || '');
                    if (!controller.telemetry.t_first_token) controller.telemetry.t_first_token = performance.now();
                    uiCallbacks.onToken?.({ token: data.token, streamedText: controller.streamedText, sources: controller.sources, turnId: controller.turnId });
                } else if (event === 'done') finish(data);
            }
        }).then(finish).catch(error => {
            if (controller.isTerminal || settled) return;
            controller.telemetry.searchError = error.message;
            finish({ success: false, fallback: true, content: controller.sources.length ? fallback(query, controller.sources) : 'Live research could not finish. Please try again.', provenance: controller.sources.length ? provenanceModes.SYNTHESIS_FALLBACK : provenanceModes.NO_SOURCES });
        });
    });
}
