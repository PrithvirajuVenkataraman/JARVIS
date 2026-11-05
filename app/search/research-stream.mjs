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
                if (final || scope.signal.aborted) break;
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
    const { states, provenanceModes, normalizeSources } = helpers;
    const start = performance.now();
    controller.telemetry.t_start = start;
    controller.transition(states.SEARCHING, {}, uiCallbacks);
    let settled = false;
    return new Promise(resolve => {
        const readSources = records => {
            const seen = new Set();
            return (Array.isArray(records) ? records : []).flatMap(source => {
                const item = normalizeSources([source], query, 1)[0];
                if (!item || !Number.isInteger(source.id) || seen.has(source.id)) return [];
                seen.add(source.id);
                return [{ ...item, id: source.id }];
            });
        };
        const finish = (result = {}) => {
            if (settled || controller.isTerminal) return;
            settled = true;
            if (Array.isArray(result.sources)) controller.sources = readSources(result.sources);
            const sources = controller.sources;
            controller.provenance = result.provenance || provenanceModes.NO_SOURCES;
            controller.telemetry.t_completed = performance.now();
            controller.telemetry.totalDurationMs = Math.round(controller.telemetry.t_completed - start);
            controller.telemetry.sourcesCount = sources.length;
            const content = typeof result.content === 'string' ? result.content.trim() : '';
            const validStatuses = ['complete', 'partial', 'unavailable', 'clarification'];
            const answerStatus = content && validStatuses.includes(result.answerStatus)
                ? result.answerStatus
                : controller.provenance === 'clarification' ? 'clarification' : 'unavailable';
            const final = {
                ...result, answerStatus,
                verified: answerStatus === 'complete' && result.verified === true && sources.length > 0,
                success: answerStatus === 'complete' || answerStatus === 'partial',
                content: content || 'Live research did not return a supported answer. Please try again.',
                sources, turnId: controller.turnId, assistantMessageId,
                entity: result.entity || controller.entity || null,
                notableWorks: result.notableWorks || controller.notableWorks || [],
                telemetry: { ...controller.telemetry, research: result.research }
            };
            controller.transition(states.COMPLETE, {}, uiCallbacks);
            controller._resolveExecution = null;
            try { uiCallbacks.onComplete?.(final); } catch { /* UI callbacks cannot reopen a completed request. */ }
            resolve(final);
        };
        controller._resolveExecution = result => { if (!settled) { settled = true; resolve(result); } };
        if (!String(query || '').trim()) { finish({ success: false, provenance: provenanceModes.NO_SOURCES, sources: [] }); return; }
        (async () => researchStreamFn({
            query, userText, context, signal: controller.searchAbortController.signal,
            timeoutMs: RESEARCH_LIMITS.TOTAL_MS + RESEARCH_LIMITS.CLIENT_GRACE_MS,
            onEvent: (event, data) => {
                if (settled || controller.isTerminal) return;
                if (event === 'status') {
                    const nextState = data.status === 'synthesizing' ? states.SOURCE_GROUNDED_SYNTHESIS : states.SEARCHING;
                    controller.transition(nextState, { ...data }, uiCallbacks);
                } else if (event === 'entity') {
                    if (data?.entity) {
                        controller.entity = data.entity;
                        controller.notableWorks = data.notableWorks || [];
                        uiCallbacks.onEntityResolved?.({ entity: data.entity, notableWorks: data.notableWorks || [], assistantMessageId });
                    }
                } else if (event === 'sources') {
                    controller.sources = readSources(data.sources);
                    if (data.entity) {
                        controller.entity = data.entity;
                        controller.notableWorks = data.notableWorks || [];
                    }
                    controller.telemetry.t_sources_rendered = performance.now();
                    uiCallbacks.onSourcesValidated?.({ sources: controller.sources, entity: controller.entity, notableWorks: controller.notableWorks, turnId: controller.turnId, assistantMessageId, provenance: provenanceModes.WEB_GROUNDED });
                } else if (event === 'token') {
                    controller.streamedText += String(data.token || '');
                    if (!controller.telemetry.t_first_token) controller.telemetry.t_first_token = performance.now();
                    uiCallbacks.onToken?.({ token: data.token, streamedText: controller.streamedText, sources: controller.sources, turnId: controller.turnId });
                } else if (event === 'done') finish(data);
            }
        }))().then(finish).catch(error => {
            if (controller.isTerminal || settled) return;
            controller.telemetry.searchError = error.message;
            finish({ success: false, answerStatus: 'unavailable', verified: false, failureReason: error.message, content: 'Live research could not finish. Please try again.', provenance: provenanceModes.NO_SOURCES });
        });
    });
}
