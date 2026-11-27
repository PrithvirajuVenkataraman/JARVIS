import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
    REGISTERED_TOOLS,
    clearLlmRouterState,
    compareRouterVsLegacy,
    isAuthorizedTool,
    minimalDeterministicFallbackRoute,
    routeWithLlm,
    sanitizeRequiredTools,
    shouldBypassRouter,
    validateRoutingDecision
} from '../api/_lib/llm-router.js';
import { answerEvidencePolicy } from '../api/_lib/factual-answer.js';
import { runResearch } from '../api/_lib/research-engine.js';
import { rewriteSearchPrompt } from '../api/_lib/query-rewriter.js';
import { classifyRetrievalDecision } from '../api/search.js';
import visionHandler from '../api/vision.js';
import { decideFrontendRoute } from '../app/frontend-routing.js';
import { classifyDocumentQueryMode } from '../app/document-rag.js';

function createMockRes() {
    return Object.assign(new EventEmitter(), {
        headers: {},
        chunks: [],
        statusCode: 200,
        writableEnded: false,
        setHeader(k, v) { this.headers[k] = v; },
        status(code) { this.statusCode = code; return this; },
        json(data) { this.data = data; this.writableEnded = true; return this; },
        write(chunk) { this.chunks.push(chunk); },
        end() { this.writableEnded = true; }
    });
}

test('Centralized LLM router validates strict JSON schema and rejects unregistered tools', async () => {
    clearLlmRouterState();
    assert.ok(REGISTERED_TOOLS.includes('web_search'));
    assert.equal(isAuthorizedTool('web_search'), true);
    assert.equal(isAuthorizedTool('exec_shell'), false);
    assert.deepEqual(
        sanitizeRequiredTools(['web_search', 'rm_rf', 'code_interpreter', 'web_search', 'eval']),
        ['web_search', 'code_interpreter']
    );

    const invalid = validateRoutingDecision(null, 'test');
    assert.equal(invalid.valid, false);

    const missingIntent = validateRoutingDecision({ strategy: 'live_web' }, 'test');
    assert.equal(missingIntent.valid, false);

    const checked = validateRoutingDecision({
        intent: 'compare current EV prices and generate summary python script',
        intents: ['market comparison', 'python scripting'],
        strategy: 'hybrid_live_llm',
        answerScope: 'comparison',
        entities: [{ name: 'BYD Seal', type: 'product', roleOrContext: 'EV sedan' }],
        requiredTools: ['web_search', 'shell_exec', 'code_interpreter', 'eval'],
        retrievalRequired: true,
        freshness: 'current',
        temporalWindow: 'month',
        verticalHint: 'vehicles',
        slots: { location: 'India', make: 'BYD', model: 'Seal' },
        documentScope: 'none',
        visionLane: 'none',
        complexity: 'deep',
        standaloneQuery: 'Compare BYD Seal price in India and write a Python table script',
        searchQueries: ['BYD Seal price India 2026', 'BYD Seal specs review']
    }, 'compare byd seal and write python script');

    assert.equal(checked.valid, true);
    assert.equal(checked.decision.strategy, 'hybrid_live_llm');
    assert.deepEqual(checked.decision.requiredTools, ['web_search', 'code_interpreter']);
    assert.equal(checked.decision.slots.make, 'BYD');
    assert.equal(checked.decision.slots.model, 'Seal');
});

test('routeWithLlm routes via mocked provider adapter, enforces webMode controls, and passes history + attachment metadata', async () => {
    clearLlmRouterState();
    const seenPayloads = [];
    const adapter = async ({ prompt }) => {
        const parsedPrompt = JSON.parse(prompt);
        seenPayloads.push(parsedPrompt);
        const wantsSummary = /summary|summarize|contract|pdf/i.test(parsedPrompt.query || '');
        return {
            intent: wantsSummary ? 'exhaustive document summary' : 'follow-up latest news on that company',
            intents: wantsSummary ? ['document summarization'] : ['entity resolution', 'latest news'],
            strategy: wantsSummary ? 'document_rag' : 'live_web',
            answerScope: 'overview',
            entities: wantsSummary ? [] : [{ name: 'OpenAI', type: 'company', roleOrContext: 'from history' }],
            requiredTools: wantsSummary ? ['document_qa'] : ['web_search', 'web_fetch'],
            retrievalRequired: !wantsSummary,
            freshness: wantsSummary ? 'none' : 'recent',
            temporalWindow: wantsSummary ? 'none' : 'week',
            verticalHint: wantsSummary ? 'other' : 'technology',
            slots: { location: '' },
            documentScope: wantsSummary && parsedPrompt.attachments?.length ? 'exhaustive' : 'none',
            visionLane: 'none',
            complexity: 'standard',
            standaloneQuery: wantsSummary ? 'Summarize q3-report.pdf' : 'OpenAI latest announcements this week',
            searchQueries: wantsSummary ? [] : ['OpenAI latest announcements', 'OpenAI news this week']
        };
    };

    const route = await routeWithLlm('what happened with them this week?', {
        adapter,
        sessionId: 'sess-alpha',
        context: [
            { role: 'user', content: 'Tell me about OpenAI' },
            { role: 'assistant', content: 'OpenAI is an AI research organization.' }
        ],
        attachments: [{ name: 'q3-report.pdf', mimeType: 'application/pdf', charCount: 4200, kind: 'document' }]
    });

    assert.equal(route.source, 'llm_router');
    assert.equal(route.strategy, 'live_web');
    assert.equal(route.retrievalRequired, true);
    assert.equal(route.documentScope, 'pinpoint');
    assert.equal(route.apiCalls, 1);
    assert.equal(seenPayloads[0].history.length, 2);
    assert.equal(seenPayloads[0].attachments[0].name, 'q3-report.pdf');

    const docRoute = await routeWithLlm('Summarize the attached pdf contract', {
        adapter,
        sessionId: 'sess-alpha',
        attachments: [{ name: 'contract.pdf', mimeType: 'application/pdf', charCount: 14200, kind: 'document' }]
    });
    assert.equal(docRoute.strategy, 'document_rag');
    assert.equal(docRoute.documentScope, 'exhaustive');

    // Cache hit for same session + history
    const cached = await routeWithLlm('what happened with them this week?', {
        adapter,
        sessionId: 'sess-alpha',
        context: [
            { role: 'user', content: 'Tell me about OpenAI' },
            { role: 'assistant', content: 'OpenAI is an AI research organization.' }
        ],
        attachments: [{ name: 'q3-report.pdf', mimeType: 'application/pdf', charCount: 4200, kind: 'document' }]
    });
    assert.equal(cached.cacheHit, true);
    assert.equal(cached.apiCalls, 0);

    // Different session MUST NOT reuse context-bound cache if history differs (cache isolation)
    const otherSession = await routeWithLlm('what happened with them this week?', {
        adapter,
        sessionId: 'sess-beta',
        context: [{ role: 'user', content: 'Tell me about Anthropic' }],
        attachments: []
    });
    assert.equal(otherSession.cacheHit, undefined);
    assert.equal(otherSession.apiCalls, 1);

    // Deterministic webMode=off control overrides retrievalRequired without breaking valid schema
    const offlineRoute = await routeWithLlm('latest announcements for OpenAI', {
        adapter,
        webMode: 'off',
        bypassCache: true
    });
    assert.equal(offlineRoute.retrievalRequired, false);
    assert.equal(offlineRoute.strategy, 'direct_chat');
    assert.equal(offlineRoute.webDisabled, true);
    assert.ok(!offlineRoute.requiredTools.includes('web_search'));
});

test('routeWithLlm handles slash command bypass, configurable timeouts, Groq->Gemini failover, invalid schema, and 429 exhaustion', async () => {
    clearLlmRouterState();

    // Explicit slash commands skip LLM classification completely (0 API calls)
    const slash = await routeWithLlm('/clear', {
        adapter: async () => assert.fail('Slash command must bypass LLM router')
    });
    assert.equal(slash.apiCalls, 0);
    assert.equal(slash.bypassReason, 'explicit_slash_command');
    assert.equal(shouldBypassRouter('/help').bypass, true);

    // Timeout on slow primary provider fails over to fast secondary provider
    const callOrder = [];
    const recovered = await routeWithLlm('Current weather in Tokyo', {
        bypassCache: true,
        timeoutMs: 250,
        providers: [
            { name: 'groq', key: 'g-test', model: 'openai/gpt-oss-20b' },
            { name: 'gemini', key: 'm-test', model: 'gemini-2.5-flash-lite' }
        ],
        adapter: async ({ provider, signal }) => {
            callOrder.push(provider.name);
            if (provider.name === 'groq') {
                return await new Promise((_resolve, reject) => {
                    signal.addEventListener('abort', () => {
                        const err = new Error('timeout');
                        err.name = 'AbortError';
                        reject(err);
                    }, { once: true });
                });
            }
            return {
                intent: 'live weather forecast lookup',
                intents: ['weather'],
                strategy: 'live_web',
                answerScope: 'narrow_fact',
                entities: [{ name: 'Tokyo', type: 'place', roleOrContext: 'city' }],
                requiredTools: ['weather', 'web_search'],
                retrievalRequired: true,
                freshness: 'current',
                temporalWindow: 'day',
                verticalHint: 'weather',
                slots: { location: 'Tokyo' },
                documentScope: 'none',
                visionLane: 'none',
                complexity: 'instant',
                standaloneQuery: 'Tokyo current weather',
                searchQueries: ['Tokyo weather today']
            };
        }
    });
    assert.deepEqual(callOrder, ['groq', 'gemini']);
    assert.equal(recovered.source, 'llm_router');
    assert.equal(recovered.provider, 'gemini');
    assert.equal(recovered.slots.location, 'Tokyo');

    // Rate-limit (429) exhaustion + invalid schema fall back gracefully to minimal deterministic fallback
    const exhausted = await routeWithLlm('Summarize quarterly earnings PDF', {
        bypassCache: true,
        attachments: [{ name: 'earnings.pdf', mimeType: 'application/pdf', charCount: 9000 }],
        providers: [
            { name: 'groq', key: 'g-429', model: 'openai/gpt-oss-20b' },
            { name: 'gemini', key: 'm-bad', model: 'gemini-2.5-flash-lite' }
        ],
        adapter: async ({ provider }) => {
            if (provider.name === 'groq') {
                const err = new Error('rate limited');
                err.status = 429;
                throw err;
            }
            return { broken: 'missing_required_fields' };
        }
    });
    assert.equal(exhausted.source, 'minimal_fallback');
    assert.equal(exhausted.strategy, 'document_rag');
    assert.equal(exhausted.apiCalls, 2);

    const minFallback = minimalDeterministicFallbackRoute('Analyze photo', { images: ['abc'], webMode: 'force' });
    assert.equal(minFallback.strategy, 'vision_qa');
    assert.ok(minFallback.requiredTools.includes('vision_qa'));
});

test('Downstream pipeline (search, research-engine, query-rewriter, factual-answer, vision, doc-rag, frontend) consumes centralized route cleanly', async () => {
    const precomputedRoute = {
        source: 'llm_router',
        intent: 'company overview and recent developments',
        intents: ['company research', 'latest news'],
        strategy: 'live_web',
        answerScope: 'overview',
        entities: [{ name: 'Stripe', type: 'company', roleOrContext: 'payments company' }],
        requiredTools: ['web_search'],
        retrievalRequired: true,
        freshness: 'recent',
        temporalWindow: 'month',
        verticalHint: 'finance',
        slots: { location: '', assetOrTicker: '' },
        documentScope: 'exhaustive',
        visionLane: 'math_diagram',
        complexity: 'standard',
        standaloneQuery: 'Stripe company overview and recent news 2026',
        searchQueries: ['Stripe company overview', 'Stripe recent news 2026']
    };

    // factual-answer honors precomputedRoute without running legacy regex
    const ev = answerEvidencePolicy({ message: 'tell me about Stripe', webMode: 'auto', precomputedRoute });
    assert.equal(ev.required, true);
    assert.equal(ev.mode, 'retrieved_passages');

    // query-rewriter reuses router searchQueries with 0 extra LLM calls
    const rw = await rewriteSearchPrompt('tell me about them', { precomputedRoute });
    assert.equal(rw.rewrittenBy, 'centralized_llm_router');
    assert.deepEqual(rw.searchQueries.map(q => q.query), ['Stripe company overview', 'Stripe recent news 2026']);

    // research-engine honors precomputedRoute searchQueries instead of invoking duplicate planResearch LLM call
    const seenCandidates = [];
    const seenOpts = [];
    const passage1 = 'Stripe processes online payments globally and expanded treasury features in 2026.';
    const passage2 = 'Stripe reported strong payment volume growth in 2026.';
    const researchResult = await runResearch(
        'tell me about them',
        {
            context: [{ role: 'user', content: 'How does Stripe make money?' }],
            precomputedRoute
        },
        {
            search: async (candidate, opts) => {
                seenCandidates.push(candidate);
                seenOpts.push(opts);
                return [
                    { title: 'Stripe Overview', url: 'https://example.com/stripe', snippet: passage1, extract: passage1, pageFetched: true, source: 'web', publishedAt: '2026-10-01' },
                    { title: 'Stripe News', url: 'https://news.example.com/stripe', snippet: passage2, extract: passage2, pageFetched: true, source: 'web', publishedAt: '2026-11-01' }
                ];
            },
            extract: async (url) => ({ url, bodyText: `${passage1} ${passage2}`, extractor: 'mock' }),
            generate: async (_prompt, opts) => {
                const reqId = JSON.parse(_prompt)?.requirements?.[0]?.id || 'r1';
                opts?.onAttempt?.({ outcome: 'success', model: 'mock-model', provider: 'groq' });
                return {
                    ok: true,
                    text: JSON.stringify({
                        facts: [
                            { id: 'f1', requirementId: reqId, value: passage1, sourceId: 1, quote: passage1 },
                            { id: 'f2', requirementId: reqId, value: passage2, sourceId: 2, quote: passage2 }
                        ],
                        gaps: []
                    }),
                    model: 'mock-model',
                    provider: 'groq'
                };
            }
        }
    );
    assert.ok(seenCandidates.includes('Stripe company overview'), `Expected router search query to execute, got ${JSON.stringify(seenCandidates)}`);
    assert.equal(seenOpts[0].query, 'Stripe company overview and recent news 2026');
    assert.equal(seenOpts[0].precomputedRoute.source, 'llm_router');
    assert.ok(researchResult.content.includes('Stripe'));

    // search.js classifyRetrievalDecision uses centralized LLM router when adapter is passed
    const searchDecision = await classifyRetrievalDecision('why was it late?', {
        context: [{ role: 'user', content: 'Caltrain schedule today' }],
        adapter: async () => ({
            intent: 'transit delay check',
            strategy: 'live_web',
            answerScope: 'narrow_fact',
            retrievalRequired: true,
            freshness: 'current',
            verticalHint: 'places',
            slots: { location: 'San Francisco' },
            standaloneQuery: 'Caltrain delays today',
            searchQueries: ['Caltrain delays today']
        })
    });
    assert.equal(searchDecision.decision, 'needs_live_search');
    assert.equal(searchDecision.llmRoute.standaloneQuery, 'Caltrain delays today');

    // app/document-rag.js & app/frontend-routing.js respect router contracts
    assert.equal(classifyDocumentQueryMode('Summarize the risks', { llmRoute: precomputedRoute }), 'exhaustive');
    const feDeferred = decideFrontendRoute('any natural language query', { deferSemanticRoutingToBackend: true });
    assert.equal(feDeferred.route, 'chat_direct');
    assert.equal(feDeferred.reason, 'backend_llm_router');

    // shadow comparison utility
    const diff = compareRouterVsLegacy(precomputedRoute, { strategy: 'direct' });
    assert.equal(diff.agreedLiveDecision, false);
    assert.equal(diff.llmStrategy, 'live_web');

    // api/vision.js honors precomputed visionLane hint from centralized router cleanly
    const origVisionEnv = { GROQ_API_KEY: process.env.GROQ_API_KEY, GEMINI_API_KEY: process.env.GEMINI_API_KEY };
    delete process.env.GROQ_API_KEY;
    delete process.env.GEMINI_API_KEY;
    try {
        const req = Object.assign(new EventEmitter(), {
            method: 'POST',
            headers: { host: 'localhost', 'content-type': 'application/json' },
            socket: { remoteAddress: '127.0.0.1' },
            body: {
                task: 'describe',
                visionLane: 'math_diagram',
                prompt: 'check this',
                mimeType: 'image/png',
                imageBase64: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aW1sAAAAASUVORK5CYII=', 'base64').toString('base64')
            }
        });
        const res = createMockRes();
        await visionHandler(req, res);
        // Without credentials returns structured error (not 500 crash), confirming visionLane parsing stayed safe
        assert.ok([200, 400, 503].includes(res.statusCode));
    } finally {
        if (origVisionEnv.GROQ_API_KEY) process.env.GROQ_API_KEY = origVisionEnv.GROQ_API_KEY;
        if (origVisionEnv.GEMINI_API_KEY) process.env.GEMINI_API_KEY = origVisionEnv.GEMINI_API_KEY;
    }
});
