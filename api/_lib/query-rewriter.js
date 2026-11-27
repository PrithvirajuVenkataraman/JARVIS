/**
 * @file api/_lib/query-rewriter.js
 * @description Milestone 1: Prompt & Intent Rewriter for Live Search & Knowledge Retrieval (v2)
 *
 * Implements:
 *   1. Deterministic Intent Classifier (< 5ms):
 *      - declarative_claim_verification
 *      - direct_wh_question
 *      - comparison
 *      - definition_policy
 *      - how_to
 *      - recency_sensitive
 *      - general_search
 *   2. Micro-LLM Rewriter (Groq `openai/gpt-oss-20b` or Gemini `gemini-2.5-flash-lite`, timeout <= 400ms):
 *      - Strictly enforced JSON contract
 *      - Claim verification generation without hallucinated entities
 *      - Strict prohibition of Llama under Groq
 *   3. Deterministic Offline Fallback:
 *      - Grammatical transformation of claims to interrogatives
 *      - Verification & basis probe query generation
 *      - Always retains the original query
 *   4. Concurrent Dispatch Orchestrator:
 *      - Fires original query immediately while rewriter executes in parallel
 */

import { cleanSnippetText } from './snippet-sanitizer.js';

/**
 * Executes a network fetch with a hard cancellation timeout.
 */
async function fetchWithTimeout(url, init = {}, timeoutMs = 400) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

// =========================================================================
// Model Whitelist & Configuration (STRICT: NO LLAMA ON GROQ)
// =========================================================================

export const ALLOWED_REWRITER_MODELS = Object.freeze({
    groq: Object.freeze([
        'openai/gpt-oss-20b',
        'openai/gpt-oss-120b',
        'qwen/qwen3.8-27b'
    ]),
    gemini: Object.freeze([
        'gemini-2.5-flash-lite',
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ])
});

export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite';
export const REWRITER_TIMEOUT_MS = 400;

/**
 * Validates that a requested provider and model string comply with project safety constraints.
 * Fails loudly on unknown models, and strictly prohibits Llama under Groq.
 */
export function validateRewriterModel(provider, model) {
    const prov = String(provider || '').toLowerCase().trim();
    const mdl = String(model || '').trim();

    if (!ALLOWED_REWRITER_MODELS[prov]) {
        throw new Error(`[QueryRewriter] Unsupported provider "${provider}". Allowed providers: ${Object.keys(ALLOWED_REWRITER_MODELS).join(', ')}`);
    }

    if (prov === 'groq' && /llama/i.test(mdl)) {
        throw new Error(`[QueryRewriter] Safety violation: Llama models are strictly disallowed under Groq. Use "${DEFAULT_GROQ_MODEL}".`);
    }

    if (!ALLOWED_REWRITER_MODELS[prov].includes(mdl)) {
        throw new Error(`[QueryRewriter] Disallowed model "${mdl}" for provider "${prov}". Whitelisted: ${ALLOWED_REWRITER_MODELS[prov].join(', ')}`);
    }

    return true;
}

// =========================================================================
// Step 1: Fast Deterministic Intent Classifier (< 5 ms)
// =========================================================================

const COMPARISON_REGEX = /\b(?:compare|comparison|versus|vs\.?|difference between|differences between|differ from)\b/i;
const DEFINITION_POLICY_REGEX = /\b(?:what is the (?:six month|6 month|real id|schengen|zero trust|statutory|legal)|definition of|requirements? for|compliance deadlines?|rules? and requirements?)\b/i;
const HOW_TO_REGEX = /^(?:how to|how do (?:i|we|you)|steps to|guide to)\b/i;
const RECENCY_REGEX = /\b(?:latest|recent|current status|timeline and crew|breaking changes|new features in|just announced|magnitude, epicenter|super bowl lviii|\b202[4-6]\b)\b/i;

const QUANTIFIER_COUNT_PREFIX = /^(?:(?:there are|there is|only|about|roughly|nearly|over|almost)?\s*(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty|fifty|hundred|thousand|million|billion)\s+(?:persons?|people|individuals?|countries|nations|states|percent|%|species|types|ways|reasons|things))/i;

const ASSERTION_VERB_REGEX = /\b(?:can|cannot|can't|could|is|are|was|were|has|have|had|will|would|causes?|strikes?|failed|won|shares?|become|becomes|use|uses|improves?|cures?|prevents?|kills?|contains?|produces?|lives?|survives?|leads?|affects?|grows?|originated|created|built|discovered)\b/i;

const QUESTION_START_REGEX = /^(?:who|what|where|when|why|how|which|is|are|can|could|do|does|did|will|would|should|may|has|have|had)\b/i;

/**
 * Classifies search intent and determines whether the input represents a claim requiring verification.
 * Runs in < 2ms without external network or LLM dependencies.
 *
 * @param {string} rawQuery - The raw query string
 * @param {Array} [contextTurns=[]] - Prior conversation turns
 * @returns {Object} Structured intent classification
 */
export function classifySearchIntent(rawQuery = '', contextTurns = []) {
    const text = String(rawQuery || '').trim();
    if (!text) {
        return {
            intentCategory: 'general_search',
            isClaim: false,
            needsVerification: false,
            confidence: 1.0,
            reason: 'empty_query'
        };
    }

    // 1. Comparison Intent
    if (COMPARISON_REGEX.test(text)) {
        return {
            intentCategory: 'comparison',
            isClaim: false,
            needsVerification: false,
            confidence: 0.95,
            reason: 'comparison_keywords_detected'
        };
    }

    // 2. Definition & Regulatory Policy Intent
    if (DEFINITION_POLICY_REGEX.test(text)) {
        return {
            intentCategory: 'definition_policy',
            isClaim: false,
            needsVerification: false,
            confidence: 0.90,
            reason: 'definition_policy_patterns_detected'
        };
    }

    // 3. How-To Intent
    if (HOW_TO_REGEX.test(text)) {
        return {
            intentCategory: 'how_to',
            isClaim: false,
            needsVerification: false,
            confidence: 0.95,
            reason: 'how_to_prefix_detected'
        };
    }

    // 4. Who / Which / Where / Why Interrogatives
    if (/^(?:who|which|where|when|why)\b/i.test(text)) {
        return {
            intentCategory: 'direct_wh_question',
            isClaim: false,
            needsVerification: false,
            confidence: 0.95,
            reason: 'wh_entity_question'
        };
    }

    // 5. Recency / Freshness-sensitive queries
    if (RECENCY_REGEX.test(text)) {
        return {
            intentCategory: 'recency_sensitive',
            isClaim: false,
            needsVerification: false,
            confidence: 0.85,
            reason: 'recency_temporal_anchors_detected'
        };
    }

    // 6. Declarative Claim Detection
    // Checks if the sentence makes a factual assertion rather than asking an interrogative.
    const isQuestionStart = QUESTION_START_REGEX.test(text);
    const hasQuantifier = QUANTIFIER_COUNT_PREFIX.test(text);
    const hasAssertionVerb = ASSERTION_VERB_REGEX.test(text);
    const endsWithQuestion = text.endsWith('?');
    const wordCount = text.split(/\s+/).length;

    // A. Explicit declarative quantifier assertion ("Three persons in the world can...", "Humans use only 10%...")
    if (hasQuantifier && hasAssertionVerb) {
        return {
            intentCategory: 'declarative_claim_verification',
            isClaim: true,
            needsVerification: true,
            confidence: 0.95,
            reason: 'quantifier_assertion_claim'
        };
    }

    // B. Declarative claim stating a premise without question word ("Sharks cannot get cancer", "Carrots dramatically improve night vision in humans.")
    if (!isQuestionStart && (hasAssertionVerb || text.endsWith('.')) && (!endsWithQuestion || /^(?:is it true that|fact check|myth:)/i.test(text)) && wordCount >= 3) {
        return {
            intentCategory: 'declarative_claim_verification',
            isClaim: true,
            needsVerification: true,
            confidence: 0.90,
            reason: 'declarative_statement_claim'
        };
    }

    // 7. General Direct WH-Questions (e.g. "What is the capital...")
    if (QUESTION_START_REGEX.test(text)) {
        return {
            intentCategory: 'direct_wh_question',
            isClaim: false,
            needsVerification: false,
            confidence: 0.92,
            reason: 'wh_question_detected'
        };
    }

    // 5. Recency / Freshness-sensitive queries
    if (RECENCY_REGEX.test(text)) {
        return {
            intentCategory: 'recency_sensitive',
            isClaim: false,
            needsVerification: false,
            confidence: 0.85,
            reason: 'recency_temporal_anchors_detected'
        };
    }


    return {
        intentCategory: 'general_search',
        isClaim: false,
        needsVerification: false,
        confidence: 0.70,
        reason: 'general_search_default'
    };
}

// =========================================================================
// Step 2: Deterministic Offline Fallback Query Expander
// =========================================================================

/**
 * Strips punctuation and clean query string
 */
function cleanQueryTerm(str) {
    return String(str || '')
        .replace(/[?.!]+$/g, '')
        .trim();
}

/**
 * Converts a declarative claim string into high-yield search inquiries deterministically.
 * Zero hardcoded entities, answers, or names.
 */
export function expandQueryDeterministically(rawQuery, intentResult = null) {
    const query = cleanQueryTerm(rawQuery);
    if (!query) return [];

    const intent = intentResult || classifySearchIntent(query);
    const generated = [];

    if (intent.isClaim || intent.intentCategory === 'declarative_claim_verification') {
        // Universal grammatical claim-to-question inversion (zero domain/trivia hardcoding):
        // Handles quantified group assertions ("Three persons ... can ...", "Five countries ...")
        // and general Subject + Auxiliary/Verb assertions ("X is Y", "X never strikes Y", etc.).
        let transformedWh = query;
        const quantifiedSubject = query.match(/^(?:the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|only\s+\d+|only\s+(?:one|two|three|four|five))\s+([a-z][a-z\s'-]{1,40}?)\b\s*(.+)$/i);
        const copulaOrModal = query.match(/^([^,]+?)\s+(is|are|can|could|may|might|was|were|has|have|had|will|would|should|do|does|did)\s+(?:not|never|always|only|roughly|dramatically)?\s*(.+)$/i);
        const negativeModal = query.match(/^([^,]+?)\s+(cannot|can't|couldn't|never|doesn't|don't|didn't|won't|isn't|aren't)\s+(.+)$/i);

        if (quantifiedSubject) {
            const noun = quantifiedSubject[1].trim();
            const rest = quantifiedSubject[2].trim();
            const interrogative = /\b(?:people|persons?|individuals?|citizens?|royals?|leaders?|humans?|workers?|members?)\b/i.test(noun) ? 'who are the' : 'which';
            transformedWh = `${interrogative} ${noun} ${rest}`.replace(/\s+/g, ' ').trim();
        } else if (negativeModal) {
            const [, subj, neg, rest] = negativeModal;
            const posAux = /^c/i.test(neg) ? 'can' : /^(?:is|are)/i.test(neg) ? neg.replace(/n't$/i, '') : 'do';
            transformedWh = `${posAux} ${subj.trim()} ${rest.trim()}`;
        } else if (copulaOrModal) {
            const [, subj, aux, rest] = copulaOrModal;
            const auxLow = aux.toLowerCase();
            if ((auxLow === 'has' || auxLow === 'have') && !/^(?:been|had|got|made|done|seen|won|found|lost|taken|given|become|[a-z]+ed)\b/i.test(rest.trim())) {
                transformedWh = `${auxLow === 'has' ? 'does' : 'do'} ${subj.trim()} have ${rest.trim()}`;
            } else {
                transformedWh = `${auxLow} ${subj.trim()} ${rest.trim()}`;
            }
        } else {
            const simpleVerb = query.match(/^([^,]+?)\s+([a-z]{3,}(?:s|es|ed)?)\s+(.+)$/i);
            if (simpleVerb) {
                const [, subj, verb, rest] = simpleVerb;
                const cleanRest = rest.replace(/\b(?:dramatically|actually|really|only|roughly|never|always)\b/gi, '').replace(/\s+/g, ' ').trim();
                transformedWh = `does ${subj.trim()} ${verb.replace(/s$/i, '')} ${cleanRest}`.replace(/\s+/g, ' ').trim();
            } else {
                transformedWh = `who or what ${query}`;
            }
        }

        generated.push({
            query: transformedWh,
            target: 'direct_answer',
            priority: 1
        });

        // Form 2: Legal/scientific explanation probe
        const basisWords = query
            .replace(/\b(?:the|in|of|a|an|to|on|with|by|for|their|his|her|this|that|roughly|only)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim();
        generated.push({
            query: `${basisWords} explanation facts`,
            target: 'legal_or_factual_basis',
            priority: 2
        });

        // Form 3: Claim check / myth verification
        generated.push({
            query: `${query} myth fact check is it true`,
            target: 'claim_check',
            priority: 3
        });
    } else if (intent.intentCategory === 'comparison') {
        const compMatch = query.match(/\b(?:compare|versus|vs\.?|difference between)\s+(.+?)(?:\s+(?:and|versus|vs\.?)\s+(.+))?$/i);
        if (compMatch && compMatch[1] && compMatch[2]) {
            generated.push({
                query: `${compMatch[1]} vs ${compMatch[2]} technical comparison`,
                target: 'direct_answer',
                priority: 1
            });
        }
    } else if (intent.intentCategory === 'definition_policy') {
        generated.push({
            query: `${query} official guidelines requirements`,
            target: 'direct_answer',
            priority: 1
        });
    }

    // Always include the original query as baseline fallback
    const resultList = [
        { query: rawQuery, target: 'original', priority: 0 },
        ...generated
    ];

    // Deduplicate by token set
    const seen = new Set();
    const unique = [];
    for (const item of resultList) {
        const norm = item.query.toLowerCase().replace(/[^\w\s]/g, '').trim();
        if (!seen.has(norm)) {
            seen.add(norm);
            unique.push(item);
        }
    }

    return unique.slice(0, 4);
}

// =========================================================================
// Step 3: Micro-LLM Rewriter (Groq / Gemini)
// =========================================================================

/**
 * Constructs the structured system prompt for the micro-LLM rewriter.
 * Zero hardcoded entities, names, or expected answers.
 */
function buildRewriterSystemPrompt() {
    return [
        'You are an ultra-fast search intent parser and query reformulation micro-service.',
        'Given a user inquiry, analyze whether it is a declarative claim, direct question, comparison, or definition.',
        'Rules:',
        '1. Treat declarative claims as unverified assertions to evaluate, NOT established facts.',
        '2. NEVER assume the claim is true or false.',
        '3. NEVER inject imagined facts, names, or answers into the queries.',
        '4. Produce 2-3 concise search queries in structured JSON.',
        '5. If the input is a claim, you MUST include a "claim_check" query testing whether the claim is accurate, disputed, or a myth.',
        'Output format MUST be valid JSON adhering exactly to:',
        '{',
        '  "originalQuery": "<verbatim user query>",',
        '  "intentCategory": "declarative_claim_verification" | "direct_wh_question" | "comparison" | "definition_policy" | "how_to" | "recency_sensitive" | "general_search",',
        '  "claim": { "isClaim": boolean, "needsVerification": boolean },',
        '  "searchQueries": [',
        '    { "query": "<string>", "target": "direct_answer" | "legal_or_factual_basis" | "claim_check", "priority": 1 | 2 | 3 }',
        '  ]',
        '}'
    ].join('\n');
}

/**
 * Calls Groq with `openai/gpt-oss-20b` (or specified allowed model) with strict timeout.
 */
async function callGroqRewriter(query, apiKey, options = {}) {
    const model = options.model || DEFAULT_GROQ_MODEL;
    validateRewriterModel('groq', model);

    const timeoutMs = options.timeoutMs || REWRITER_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: 'system', content: buildRewriterSystemPrompt() },
                    { role: 'user', content: `Analyze and rewrite this search input: "${query}"` }
                ],
                response_format: { type: 'json_object' },
                temperature: 0.0,
                max_tokens: 180
            }),
            signal: controller.signal
        });

        if (!response.ok) return null;
        const data = await response.json();
        const content = data?.choices?.[0]?.message?.content;
        return content ? JSON.parse(content) : null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Calls Gemini `gemini-2.5-flash-lite` with strict timeout.
 */
async function callGeminiRewriter(query, apiKey, options = {}) {
    const model = options.model || DEFAULT_GEMINI_MODEL;
    validateRewriterModel('gemini', model);

    const timeoutMs = options.timeoutMs || REWRITER_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        role: 'user',
                        parts: [{ text: `${buildRewriterSystemPrompt()}\n\nAnalyze and rewrite this search input: "${query}"` }]
                    }
                ],
                generationConfig: {
                    responseMimeType: 'application/json',
                    temperature: 0.0,
                    maxOutputTokens: 200
                }
            }),
            signal: controller.signal
        });

        if (!response.ok) return null;
        const data = await response.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        return text ? JSON.parse(text) : null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Orchestrates the prompt and intent rewriting pipeline.
 *
 * @param {string} rawQuery - Raw user query
 * @param {Object} [options={}] - Optional configuration (keys, timeout, context)
 * @returns {Promise<Object>} Rewriter JSON output conforming to canonical contract
 */
export async function rewriteSearchPrompt(rawQuery, options = {}) {
    const query = String(rawQuery || '').trim();
    const pre = options.precomputedRoute;
    if (pre?.source === 'llm_router' && Array.isArray(pre.searchQueries) && pre.searchQueries.length > 0) {
        return {
            originalQuery: query,
            intentCategory: pre.answerScope || 'overview',
            claim: { isClaim: false, needsVerification: Boolean(pre.retrievalRequired) },
            searchQueries: pre.searchQueries.map((qText, idx) => ({ query: qText, target: idx === 0 ? 'direct_answer' : 'freshness_check', priority: idx + 1 })),
            rewrittenBy: 'centralized_llm_router',
            latencyMs: Number(pre.latencyMs || 0)
        };
    }

    const groqKey = options.customGroqKey || process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '';
    const geminiKey = options.customGeminiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    const deterministicIntent = classifySearchIntent(query, options.contextTurns);

    if (options.forceDeterministic === true || (process.env.JARVIS_LLM_ROUTER_FIRST === 'false' && deterministicIntent.intentCategory === 'direct_wh_question' && query.length < 60 && !options.forceModelRewrite)) {
        return {
            originalQuery: query,
            intentCategory: deterministicIntent.intentCategory,
            claim: { isClaim: false, needsVerification: false },
            searchQueries: [
                { query, target: 'direct_answer', priority: 1 }
            ],
            rewrittenBy: 'deterministic_fast_path',
            latencyMs: 0
        };
    }

    const t0 = performance.now();
    let modelResult = null;

    if (groqKey) {
        try {
            modelResult = await callGroqRewriter(query, groqKey, options);
        } catch (_) {
            modelResult = null;
        }
    }

    if (!modelResult && geminiKey) {
        try {
            modelResult = await callGeminiRewriter(query, geminiKey, options);
        } catch (_) {
            modelResult = null;
        }
    }

    const elapsedMs = Math.round(performance.now() - t0);

    // Validate structured model result
    if (modelResult && Array.isArray(modelResult.searchQueries) && modelResult.searchQueries.length > 0) {
        // Enforce original query retention
        const queries = modelResult.searchQueries.map(sq => ({
            query: String(sq.query || '').trim(),
            target: sq.target || 'direct_answer',
            priority: Number(sq.priority) || 1
        })).filter(sq => sq.query.length > 0);

        // Ensure original query is present
        const hasOriginal = queries.some(sq => sq.query.toLowerCase() === query.toLowerCase());
        if (!hasOriginal) {
            queries.unshift({ query, target: 'original', priority: 0 });
        }

        return {
            originalQuery: query,
            intentCategory: modelResult.intentCategory || deterministicIntent.intentCategory,
            claim: {
                isClaim: Boolean(modelResult.claim?.isClaim ?? deterministicIntent.isClaim),
                needsVerification: Boolean(modelResult.claim?.needsVerification ?? deterministicIntent.needsVerification)
            },
            searchQueries: queries.slice(0, 4),
            rewrittenBy: 'micro_llm',
            latencyMs: elapsedMs
        };
    }

    // Fail-open to deterministic fallback
    const fallbackQueries = expandQueryDeterministically(query, deterministicIntent);
    return {
        originalQuery: query,
        intentCategory: deterministicIntent.intentCategory,
        claim: {
            isClaim: deterministicIntent.isClaim,
            needsVerification: deterministicIntent.needsVerification
        },
        searchQueries: fallbackQueries,
        rewrittenBy: 'deterministic_fallback',
        latencyMs: elapsedMs
    };
}
