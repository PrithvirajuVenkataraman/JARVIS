import { createHash } from 'node:crypto';
import { fetchRouterWithLifecycle as defaultFetch, fetchWithLifecycle } from './request-lifecycle.js';
import { normalizeGeminiGenerationConfig } from './model-failure.js';

export const REGISTERED_TOOLS = Object.freeze([
    'web_search',
    'web_fetch',
    'code_interpreter',
    'knowledge_lookup',
    'datetime_context',
    'session_memory',
    'document_qa',
    'vision_qa',
    'weather',
    'markets',
    'verify'
]);

const REGISTERED_TOOL_SET = new Set(REGISTERED_TOOLS);
const VALID_STRATEGIES = new Set([
    'direct_chat',
    'fast_simple',
    'live_web',
    'hybrid_live_llm',
    'clarify',
    'document_rag',
    'vision_qa'
]);
const VALID_SCOPES = new Set([
    'overview',
    'person_bio',
    'narrow_fact',
    'comparison',
    'how_to',
    'creative',
    'analytical',
    'reasoning'
]);
const VALID_FRESHNESS = new Set(['none', 'current', 'recent', 'historical', 'scheduled']);
const VALID_WINDOWS = new Set(['none', 'day', 'week', 'month', 'year']);
const VALID_DOC_SCOPES = new Set(['none', 'pinpoint', 'exhaustive']);
const VALID_VISION_LANES = new Set(['none', 'math_diagram', 'fast_ocr_scene', 'fine_grained_id']);
const VALID_COMPLEXITY = new Set(['instant', 'standard', 'deep']);
const VALID_VERTICALS = new Set([
    'general',
    'weather',
    'finance',
    'sports',
    'disasters',
    'vehicles',
    'places',
    'technology',
    'medical',
    'science',
    'history',
    'other'
]);

const SLASH_COMMAND_RE = /^\/(?:help|clear|reset|export|settings|memories?|voice|think|web|search|live|verify|math|py|python|calc|code|new)\b/i;

const routerCooldowns = new Map();
const ROUTE_CACHE = new Map();
const MAX_CACHE_ENTRIES = 250;

export function clearLlmRouterState() {
    routerCooldowns.clear();
    ROUTE_CACHE.clear();
}

export function isAuthorizedTool(toolName) {
    return typeof toolName === 'string' && REGISTERED_TOOL_SET.has(toolName.trim());
}

export function sanitizeRequiredTools(tools) {
    if (!Array.isArray(tools)) return [];
    const out = [];
    for (const raw of tools) {
        const name = String(raw || '').trim();
        if (isAuthorizedTool(name) && !out.includes(name)) out.push(name);
    }
    return out;
}

export function isLlmRouterEnabled(options = {}) {
    if (options.useLlmRouter === false) return false;
    return process.env.JARVIS_LLM_ROUTER_FIRST !== 'false';
}

export function isLlmRouterShadowEnabled(options = {}) {
    if (options.shadowCompare === true) return true;
    return process.env.JARVIS_LLM_ROUTER_SHADOW === 'true';
}

export function shouldBypassRouter(message = '', options = {}) {
    const raw = String(message || '').trim();
    if (!raw) return { bypass: true, reason: 'empty_message' };
    if (options.skipRouter === true) return { bypass: true, reason: 'explicit_skip' };
    if (options.isInternalSummary === true || options.intent === 'chat_title') {
        return { bypass: true, reason: 'internal_task' };
    }
    if (SLASH_COMMAND_RE.test(raw)) {
        return { bypass: true, reason: 'explicit_slash_command' };
    }
    return { bypass: false, reason: '' };
}

function firstKey(value) {
    return String(value || '').split(/[,;\s]+/).find(Boolean) || '';
}

function isCoolingDown(key) {
    const until = routerCooldowns.get(key) || 0;
    if (until <= Date.now()) {
        routerCooldowns.delete(key);
        return false;
    }
    return true;
}

function setCooldown(key, ms) {
    if (!key || !Number.isFinite(ms) || ms <= 0) return;
    if (routerCooldowns.size >= 200) {
        const first = routerCooldowns.keys().next().value;
        routerCooldowns.delete(first);
    }
    routerCooldowns.set(key, Date.now() + ms);
}

export function resolveRouterProviders(options = {}) {
    const groqKey = firstKey(options.customGroqKey || process.env.GROQ_API_KEY || process.env.GROQ_API_KEYS || process.env.GROQ_KEY);
    const geminiKey = String(options.customGeminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    const providers = [];

    if (groqKey && !isCoolingDown(`provider:groq:${groqKey.slice(0, 8)}`)) {
        const groqModel = String(process.env.JARVIS_ROUTER_GROQ_MODEL || 'openai/gpt-oss-20b').trim();
        if (!isCoolingDown(`model:groq:${groqModel}`)) {
            providers.push({ name: 'groq', key: groqKey, model: groqModel });
        }
    }
    if (geminiKey && !isCoolingDown(`provider:gemini:${geminiKey.slice(0, 8)}`)) {
        const geminiModel = String(process.env.JARVIS_ROUTER_GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
        if (!isCoolingDown(`model:gemini:${geminiModel}`)) {
            providers.push({ name: 'gemini', key: geminiKey, model: geminiModel });
        }
    }
    if (options.preferGemini && providers.length === 2 && providers[0].name !== 'gemini') {
        providers.reverse();
    }
    return providers;
}

function cleanText(value, maxLen = 600) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLen);
}

function extractContextSummary(context = [], attachments = [], images = []) {
    const turns = (Array.isArray(context) ? context : []).slice(-6).map(t => ({
        role: t?.role === 'assistant' || t?.ai ? 'assistant' : 'user',
        text: cleanText(t?.content || t?.text || t?.user || t?.ai || '', 320)
    })).filter(t => t.text);

    const attachmentMeta = (Array.isArray(attachments) ? attachments : []).slice(0, 12).map(a => ({
        name: cleanText(a?.name || a?.fileName || 'file', 80),
        mimeType: cleanText(a?.mimeType || a?.type || '', 48),
        charCount: Number(a?.charCount || a?.text?.length || 0),
        kind: cleanText(a?.kind || '', 32)
    }));

    return {
        turns,
        attachmentMeta,
        imageCount: Array.isArray(images) ? images.length : 0
    };
}

function buildRouteCacheKey(message, contextInfo, options = {}) {
    const scope = String(options.cacheScope || options.sessionId || options.userId || '').trim();
    const hasScopedContext = contextInfo.turns.length > 0 || contextInfo.attachmentMeta.length > 0 || contextInfo.imageCount > 0;
    if (!scope && hasScopedContext) {
        // Avoid cross-user cache reuse if conversation or attachment context exists without explicit session isolation.
        return '';
    }
    const payload = JSON.stringify({
        scope: scope || 'anonymous_stateless',
        q: cleanText(message, 1200).toLowerCase(),
        webMode: String(options.webMode || 'auto'),
        turns: contextInfo.turns.map(t => `${t.role}:${t.text.slice(0, 160)}`),
        attachments: contextInfo.attachmentMeta,
        imageCount: contextInfo.imageCount,
        hasGrounding: Boolean(options.grounded || options.grounding?.selectedText)
    });
    return createHash('sha256').update(payload).digest('hex');
}

function getCachedRoute(cacheKey) {
    if (!cacheKey) return null;
    const hit = ROUTE_CACHE.get(cacheKey);
    if (!hit) return null;
    if (hit.expiresAt <= Date.now()) {
        ROUTE_CACHE.delete(cacheKey);
        return null;
    }
    return { ...hit.decision, cacheHit: true };
}

function setCachedRoute(cacheKey, decision) {
    if (!cacheKey || !decision) return;
    if (ROUTE_CACHE.size >= MAX_CACHE_ENTRIES) {
        const first = ROUTE_CACHE.keys().next().value;
        ROUTE_CACHE.delete(first);
    }
    const ttlMs = decision.retrievalRequired || decision.freshness === 'current' || decision.freshness === 'recent'
        ? 60_000
        : 300_000;
    ROUTE_CACHE.set(cacheKey, {
        decision: { ...decision },
        expiresAt: Date.now() + ttlMs
    });
}

export function validateRoutingDecision(raw, message, options = {}) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        return { valid: false, reason: 'non_object_response', decision: null };
    }

    const intent = cleanText(raw.intent, 160);
    if (!intent) {
        return { valid: false, reason: 'missing_intent', decision: null };
    }

    const strategy = VALID_STRATEGIES.has(raw.strategy) ? raw.strategy : '';
    if (!strategy) {
        return { valid: false, reason: 'invalid_strategy', decision: null };
    }

    const answerScope = VALID_SCOPES.has(raw.answerScope) ? raw.answerScope : 'overview';
    const freshness = VALID_FRESHNESS.has(raw.freshness) ? raw.freshness : 'none';
    const temporalWindow = VALID_WINDOWS.has(raw.temporalWindow) ? raw.temporalWindow : 'none';
    const documentScope = VALID_DOC_SCOPES.has(raw.documentScope) ? raw.documentScope : 'none';
    const visionLane = VALID_VISION_LANES.has(raw.visionLane) ? raw.visionLane : 'none';
    const complexity = VALID_COMPLEXITY.has(raw.complexity) ? raw.complexity : 'standard';
    const verticalHint = VALID_VERTICALS.has(raw.verticalHint) ? raw.verticalHint : 'general';

    const intents = Array.isArray(raw.intents)
        ? [...new Set(raw.intents.map(v => cleanText(v, 140)).filter(Boolean))].slice(0, 5)
        : [intent];
    if (!intents.length) intents.push(intent);

    const entities = Array.isArray(raw.entities)
        ? raw.entities
            .filter(e => e && (typeof e === 'string' || typeof e === 'object'))
            .map(e => typeof e === 'string'
                ? { name: cleanText(e, 100), type: 'other', roleOrContext: '' }
                : {
                    name: cleanText(e.name, 100),
                    type: cleanText(e.type || 'other', 32) || 'other',
                    roleOrContext: cleanText(e.roleOrContext || '', 120)
                })
            .filter(e => e.name)
            .slice(0, 8)
        : [];

    let requiredTools = sanitizeRequiredTools(raw.requiredTools);
    let retrievalRequired = Boolean(raw.retrievalRequired);
    let finalStrategy = strategy;
    const standaloneQuery = cleanText(raw.standaloneQuery || message, 800) || cleanText(message, 800);
    const searchQueries = Array.isArray(raw.searchQueries)
        ? [...new Set(raw.searchQueries.map(q => cleanText(q, 240)).filter(Boolean))].slice(0, 4)
        : [];

    const rawSlots = raw.slots && typeof raw.slots === 'object' ? raw.slots : {};
    const slots = {
        location: cleanText(rawSlots.location, 100),
        assetOrTicker: cleanText(rawSlots.assetOrTicker, 60),
        league: cleanText(rawSlots.league, 80),
        make: cleanText(rawSlots.make, 50),
        model: cleanText(rawSlots.model, 50)
    };

    const clarification = finalStrategy === 'clarify'
        ? (cleanText(raw.clarification, 280) || 'Could you clarify which subject or context you are referring to?')
        : '';

    const webMode = String(options.webMode || '').trim().toLowerCase();
    const isWebForced = Boolean(options.isWebForced || webMode === 'force');
    const isWebOff = webMode === 'off';
    const hasImages = Array.isArray(options.images) && options.images.length > 0;
    const hasAttachments = Boolean(options.hasAttachments || (Array.isArray(options.attachments) && options.attachments.length > 0));

    if (hasImages && finalStrategy !== 'clarify') {
        finalStrategy = 'vision_qa';
        if (!requiredTools.includes('vision_qa')) requiredTools.unshift('vision_qa');
    } else if (hasAttachments && !['document_rag', 'vision_qa', 'clarify'].includes(finalStrategy) && !isWebForced) {
        if (requiredTools.includes('document_qa') || documentScope !== 'none') {
            finalStrategy = 'document_rag';
        }
    }

    if (isWebOff) {
        retrievalRequired = false;
        requiredTools = requiredTools.filter(t => t !== 'web_search' && t !== 'web_fetch' && t !== 'verify');
        if (['live_web', 'hybrid_live_llm'].includes(finalStrategy)) {
            finalStrategy = 'direct_chat';
        }
    } else if (isWebForced && !hasImages && finalStrategy !== 'document_rag') {
        retrievalRequired = true;
        if (finalStrategy === 'direct_chat' || finalStrategy === 'fast_simple' || finalStrategy === 'clarify') {
            finalStrategy = intents.length > 1 || ['analytical', 'creative', 'reasoning', 'how_to'].includes(answerScope)
                ? 'hybrid_live_llm'
                : 'live_web';
        }
        if (!requiredTools.includes('web_search')) requiredTools.unshift('web_search');
        if (!searchQueries.length && standaloneQuery) searchQueries.push(standaloneQuery);
    }

    return {
        valid: true,
        reason: '',
        decision: {
            source: 'llm_router',
            intent,
            intents,
            strategy: finalStrategy,
            answerScope,
            entities,
            requiredTools,
            retrievalRequired,
            freshness,
            temporalWindow,
            verticalHint,
            slots,
            documentScope: hasAttachments && documentScope === 'none' ? 'pinpoint' : documentScope,
            visionLane: hasImages && visionLane === 'none' ? 'fast_ocr_scene' : visionLane,
            complexity,
            standaloneQuery,
            searchQueries,
            clarification,
            webDisabled: isWebOff
        }
    };
}

export function minimalDeterministicFallbackRoute(message = '', options = {}) {
    const raw = cleanText(message, 800);
    const webMode = String(options.webMode || '').trim().toLowerCase();
    const isWebForced = Boolean(options.isWebForced || webMode === 'force');
    const isWebOff = webMode === 'off';
    const hasImages = Array.isArray(options.images) && options.images.length > 0;
    const hasAttachments = Boolean(options.hasAttachments || (Array.isArray(options.attachments) && options.attachments.length > 0));

    let strategy = 'direct_chat';
    const requiredTools = [];
    let retrievalRequired = false;
    let documentScope = 'none';
    let visionLane = 'none';
    const searchQueries = [];

    if (hasImages) {
        strategy = 'vision_qa';
        visionLane = 'fast_ocr_scene';
        requiredTools.push('vision_qa');
    } else if (hasAttachments && !isWebForced) {
        strategy = 'document_rag';
        documentScope = 'pinpoint';
        requiredTools.push('document_qa');
    } else if (isWebForced && !isWebOff) {
        strategy = 'live_web';
        retrievalRequired = true;
        requiredTools.push('web_search');
        if (raw) searchQueries.push(raw);
    }

    return {
        source: 'minimal_fallback',
        intent: strategy === 'live_web' ? 'web_search_query' : 'general_assistant_query',
        intents: [strategy === 'live_web' ? 'web_search_query' : 'general_assistant_query'],
        strategy,
        answerScope: 'overview',
        entities: [],
        requiredTools,
        retrievalRequired,
        freshness: isWebForced ? 'recent' : 'none',
        temporalWindow: 'none',
        verticalHint: 'general',
        slots: { location: '', assetOrTicker: '', league: '', make: '', model: '' },
        documentScope,
        visionLane,
        complexity: 'standard',
        standaloneQuery: raw,
        searchQueries,
        clarification: '',
        webDisabled: isWebOff
    };
}

function buildRouterSystemPrompt(todayIso) {
    return [
        `You are JARVIS's centralized semantic router. Current UTC date: ${todayIso}.`,
        'Return strict JSON matching the schema below. Never answer the user question; only classify intent, resolve follow-up context, extract entities/slots, pick authorized tools, and produce focused search queries when web retrieval is needed.',
        `Authorized tool names: ${REGISTERED_TOOLS.join(', ')}. Never invent unregistered tool names.`,
        'Routing rules:',
        '- Treat conversation history and attachment metadata as context to resolve pronouns, ordinals ("first question", "that company"), and follow-ups into standaloneQuery.',
        '- Multi-intent, multi-question & multi-tool: if the user asks 2 or 3 distinct questions or combines live data + reasoning/writing/coding, choose strategy "live_web" or "hybrid_live_llm", set retrievalRequired true, list all intents/entities, and emit focused searchQueries covering EVERY question (up to 4 queries).',
        '- Person queries: whenever a query or sub-question mentions a specific named person — including questions about their role, job, position, involvement, or title (e.g., "What is [Person]\'s role in X?", "Is [Person] the CEO of X?", "[Person] founder/director") — extract that person in entities with type="person", use answerScope="person_bio" for single-person queries, and include both a query covering their role/work and "<person> latest news recent updates ongoing projects". Only omit person_bio when the user asks who holds an unnamed office (e.g., "Who is the CEO of X?").',
        '- Set retrievalRequired=true and strategy="live_web" whenever correctness depends on current/recent/changing facts, latest news, prices, weather, office holders, schedules, obscure current entities, or explicit web/source checks.',
        '- Never rely on narrow keyword matching: interpret shorthand, blunt words, typos, non-English/code-switched queries, incidents, companies, people, math, coding, documents, and images semantically.',
        '- Only use strategy="clarify" if essential context is genuinely missing even after inspecting history and attachments.',
        '- When images are attached, set visionLane ("math_diagram" for equations/geometry/plots, "fast_ocr_scene" for reading/text/scenes, "fine_grained_id" for identifying objects/species/flags/logos/landmarks).',
        '- When documents/attachments are present, set documentScope ("exhaustive" for summaries/comparisons/full reviews across files, "pinpoint" for targeted lookup).',
        'JSON schema:',
        '{"intent":"free-form intent description","intents":["primary","optional secondary"],"strategy":"direct_chat|fast_simple|live_web|hybrid_live_llm|clarify|document_rag|vision_qa","answerScope":"overview|person_bio|narrow_fact|comparison|how_to|creative|analytical|reasoning","entities":[{"name":"","type":"person|company|event|incident|place|product|concept|other","roleOrContext":""}],"requiredTools":["web_search"],"retrievalRequired":false,"freshness":"none|current|recent|historical|scheduled","temporalWindow":"none|day|week|month|year","verticalHint":"general|weather|finance|sports|disasters|vehicles|places|technology|medical|science|history|other","slots":{"location":"","assetOrTicker":"","league":"","make":"","model":""},"documentScope":"none|pinpoint|exhaustive","visionLane":"none|math_diagram|fast_ocr_scene|fine_grained_id","complexity":"instant|standard|deep","standaloneQuery":"","searchQueries":["up to 4 focused queries"],"clarification":""}'
    ].join('\n');
}

async function invokeRouterProvider(provider, system, prompt, timeoutMs, options = {}) {
    if (typeof options.adapter === 'function') {
        return await options.adapter({ provider, system, prompt, timeoutMs, signal: options.signal });
    }
    const fetchFn = options.fetch || (options.countTowardGenerationBudget ? fetchWithLifecycle : defaultFetch);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('router_timeout')), Math.max(200, timeoutMs));
    const onParentAbort = () => controller.abort(options.signal?.reason || new Error('aborted'));
    if (options.signal) {
        if (options.signal.aborted) onParentAbort();
        else options.signal.addEventListener('abort', onParentAbort, { once: true });
    }

    try {
        const isGroq = provider.name === 'groq';
        const url = isGroq
            ? 'https://api.groq.com/openai/v1/chat/completions'
            : `https://generativelanguage.googleapis.com/v1beta/models/${provider.model}:generateContent?key=${encodeURIComponent(provider.key)}`;
        const payload = isGroq
            ? {
                model: provider.model,
                messages: [
                    { role: 'system', content: system },
                    { role: 'user', content: prompt }
                ],
                temperature: 0,
                max_tokens: 450,
                response_format: { type: 'json_object' },
                ...(provider.model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' } : {})
            }
            : {
                system_instruction: { parts: [{ text: system }] },
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: normalizeGeminiGenerationConfig(provider.model, {
                    temperature: 0,
                    maxOutputTokens: 450,
                    thinkingConfig: { thinkingBudget: 0 },
                    responseMimeType: 'application/json'
                })
            };

        const response = await fetchFn(url, {
            method: 'POST',
            signal: controller.signal,
            headers: {
                'Content-Type': 'application/json',
                ...(isGroq ? { Authorization: `Bearer ${provider.key}` } : {})
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            if (response.status === 429) {
                setCooldown(`provider:${provider.name}:${provider.key.slice(0, 8)}`, 60_000);
            } else if (response.status === 404 || response.status === 410) {
                setCooldown(`model:${provider.name}:${provider.model}`, 10 * 60_000);
            } else if (response.status >= 500) {
                setCooldown(`model:${provider.name}:${provider.model}`, 60_000);
            }
            const err = new Error(`router_http_${response.status}`);
            err.status = response.status;
            throw err;
        }

        const data = await response.json();
        const text = isGroq
            ? data?.choices?.[0]?.message?.content
            : (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
        if (!text || typeof text !== 'string') {
            throw new Error('empty_router_response');
        }
        const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        return JSON.parse(cleaned);
    } finally {
        clearTimeout(timer);
        if (options.signal) options.signal.removeEventListener('abort', onParentAbort);
    }
}

export async function routeWithLlm(message, options = {}) {
    const startedAt = Date.now();
    const raw = String(message || '').trim();
    const bypass = shouldBypassRouter(raw, options);
    const baseFallback = minimalDeterministicFallbackRoute(raw, options);

    if (bypass.bypass || !isLlmRouterEnabled(options)) {
        return {
            ...baseFallback,
            bypassReason: bypass.bypass ? bypass.reason : 'feature_flag_disabled',
            latencyMs: Date.now() - startedAt,
            apiCalls: 0
        };
    }

    const contextInfo = extractContextSummary(options.context, options.attachments, options.images);
    const cacheKey = options.bypassCache ? '' : buildRouteCacheKey(raw, contextInfo, options);
    const cached = getCachedRoute(cacheKey);
    if (cached) {
        return {
            ...cached,
            latencyMs: Date.now() - startedAt,
            apiCalls: 0
        };
    }

    const providers = typeof options.adapter === 'function' && options.providers
        ? options.providers
        : resolveRouterProviders(options);

    if (!providers.length && typeof options.adapter !== 'function') {
        return {
            ...baseFallback,
            fallbackReason: 'no_router_credentials',
            latencyMs: Date.now() - startedAt,
            apiCalls: 0
        };
    }

    const effectiveProviders = providers.length ? providers : [{ name: 'adapter', key: 'adapter', model: 'mock-router' }];
    const todayIso = new Date().toISOString().slice(0, 10);
    const system = buildRouterSystemPrompt(todayIso);
    const prompt = JSON.stringify({
        query: raw.slice(0, 2000),
        webMode: String(options.webMode || 'auto'),
        history: contextInfo.turns,
        attachments: contextInfo.attachmentMeta,
        imageCount: contextInfo.imageCount,
        groundedSelection: cleanText(options.grounding?.selectedText || '', 300) || undefined
    });

    const configuredTimeout = Number(options.timeoutMs || process.env.JARVIS_ROUTER_TIMEOUT_MS || 2200);
    const timeoutMs = Math.max(250, Math.min(8000, Number.isFinite(configuredTimeout) ? configuredTimeout : 2200));

    let apiCalls = 0;
    const attempts = [];
    for (const provider of effectiveProviders) {
        if (options.signal?.aborted) break;
        apiCalls++;
        const attemptStart = Date.now();
        try {
            const parsed = await invokeRouterProvider(provider, system, prompt, timeoutMs, options);
            const checked = validateRoutingDecision(parsed, raw, {
                ...options,
                hasAttachments: contextInfo.attachmentMeta.length > 0
            });
            if (checked.valid && checked.decision) {
                attempts.push({ provider: provider.name, model: provider.model, outcome: 'success', durationMs: Date.now() - attemptStart });
                const decision = {
                    ...checked.decision,
                    provider: provider.name,
                    model: provider.model,
                    latencyMs: Date.now() - startedAt,
                    apiCalls,
                    attempts
                };
                setCachedRoute(cacheKey, decision);
                return decision;
            }
            attempts.push({ provider: provider.name, model: provider.model, outcome: checked.reason || 'invalid_schema', durationMs: Date.now() - attemptStart });
        } catch (err) {
            attempts.push({
                provider: provider.name,
                model: provider.model,
                outcome: err?.status === 429 ? 'rate_limited' : (err?.name === 'AbortError' ? 'timeout' : String(err?.message || 'provider_error')),
                durationMs: Date.now() - attemptStart
            });
        }
    }

    return {
        ...baseFallback,
        fallbackReason: attempts.at(-1)?.outcome || 'router_unavailable',
        latencyMs: Date.now() - startedAt,
        apiCalls,
        attempts
    };
}

export function compareRouterVsLegacy(llmDecision, legacyDecision = {}) {
    const llmNeedsLive = Boolean(llmDecision?.retrievalRequired || ['live_web', 'hybrid_live_llm'].includes(llmDecision?.strategy));
    const legacyNeedsLive = Boolean(
        legacyDecision?.strategy === 'live_first'
        || legacyDecision?.strategy === 'search'
        || legacyDecision?.route === 'live_required'
        || legacyDecision?.decision === 'needs_live_search'
    );
    return {
        agreedLiveDecision: llmNeedsLive === legacyNeedsLive,
        llmStrategy: llmDecision?.strategy || 'unknown',
        legacyStrategy: legacyDecision?.strategy || legacyDecision?.route || legacyDecision?.decision || 'unknown',
        llmIntent: llmDecision?.intent || '',
        tools: Array.isArray(llmDecision?.requiredTools) ? llmDecision.requiredTools : []
    };
}

export function buildRouterFallbackFromLegacyRoute(legacy = {}, message = '') {
    const base = minimalDeterministicFallbackRoute(message);
    return {
        ...base,
        source: 'legacy_bridge',
        strategy: legacy.strategy === 'live_first' || legacy.strategy === 'search' ? 'live_web' : base.strategy,
        retrievalRequired: Boolean(legacy.strategy === 'live_first' || legacy.strategy === 'search' || legacy.webEligible),
        requiredTools: legacy.strategy === 'live_first' || legacy.strategy === 'search' ? ['web_search'] : []
    };
}
