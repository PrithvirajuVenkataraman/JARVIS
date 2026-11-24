import { classifyQueryIntent } from './intent-separator.js';
import { currentRequestSignal } from './request-lifecycle.js';

// Select the evidence contract before generation, rather than trusting the
// model's confidence after it has already published an answer.
export function answerEvidencePolicy({ message = '', intent = 'chat', route = {}, webMode = '', grounded = false, internal = false, referenceStatus = '' } = {}) {
    if (grounded) return { mode: 'supplied_material', required: false };
    if (internal || ['ambiguous', 'missing'].includes(referenceStatus) || intent === 'chat_title') return { mode: 'conversation', required: false };
    const forced = webMode === 'force';
    const classification = classifyQueryIntent(message);
    const opinion = /\b(?:what do you think|your (?:opinion|take|assessment)|how do you feel|would you rather)\b/i.test(message);
    const creative = /^(?:write|draft|rewrite|translate|imagine|compose|create|generate|draw)\b/i.test(message);
    const specificFacts = /\b(?:biograph(?:y|ies)|born|birthplace|net worth|owns?|owned|ownership|production (?:house|company)|business(?:es)?|founded|founder|awards?|achievements?|filmography|discography)\b/i.test(message);
    const explicitCheck = /\b(?:fact[- ]?check|verify|is (?:that|this|it) true|are you sure|made (?:that|it) up|hallucinat\w*|sources?|citations?)\b/i.test(message);
    const temporal = /\b(?:current|currently|latest|today|recent|incumbent|right now|as of)\b/i.test(message);
    if (!forced && !specificFacts && !explicitCheck && !temporal && ['fast_simple', 'casual_chat'].includes(intent)) return { mode: 'model_knowledge', required: false };
    const required = forced || (!creative && !opinion && (specificFacts || explicitCheck || classification.requiresLiveGrounding || ['search', 'live_first', 'direct_then_live_if_needed'].includes(route.strategy)));
    return { mode: required ? (webMode === 'off' ? 'evidence_unavailable' : 'retrieved_passages') : 'model_knowledge', required };
}

export async function factualAnswer(message, { context = [], preferences = {}, signal = currentRequestSignal(), customGroqKey, customGeminiKey, unavailable = false, onEvent } = {}, research) {
    if (unavailable) return { success: true, response: 'I can’t verify that with Web search turned off. Enable Web search or attach a reliable source.', sources: [], facts: [], verified: false, sourceBased: false, answerStatus: 'unavailable', provenance: 'no_sources', verificationScope: 'none', provider: 'evidence_policy' };
    const run = research || (await import('../search.js')).runWebResearch;
    const result = await run(message, { context, preferences, selectedModel: preferences.selectedModel, customGroqKey, customGeminiKey, signal, onEvent, maxModelCalls: 2, finalOnly: true });
    return { ...result, response: result.content, intent: 'factual_answer', provider: 'public_sources', sourceBased: Boolean(result.facts?.length), verificationScope: 'retrieved_passages', modelUsed: result.research?.modelAttempts?.findLast(attempt => attempt.outcome === 'success')?.model };
}
