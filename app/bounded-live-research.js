/**
 * Bounded Live-Web Research Pipeline (Perplexity-Style)
 *
 * Strict Application Deadline Contract:
 * - T + 0ms: Start live search mode, dispatch providers in parallel.
 * - T + 0..2500ms: Independent fetch with AbortControllers.
 * - T + 2500ms: Search cutoff. Abort pending search requests. Normalize sources, assign IDs [1]..[N].
 * - T + 2500..2800ms: Render Sources UI immediately. Start LLM streaming synthesis with verified grounding.
 * - T + 8500ms: Trigger forced fallback preparation.
 * - T + 9000ms: HARD APPLICATION DEADLINE. Abort stream. Render verified snippet answer. Lock turn state.
 */

import { normalizeUserQuery, hasSearchableContent } from './query-normalizer.js';
export { normalizeUserQuery, hasSearchableContent };

export const RESEARCH_STATES = Object.freeze({
    REQUESTED: 'REQUESTED',
    SEARCHING: 'SEARCHING',
    SEARCH_DEADLINE: 'SEARCH_DEADLINE',
    SOURCE_VALIDATION: 'SOURCE_VALIDATION',
    SOURCE_GROUNDED_SYNTHESIS: 'SOURCE_GROUNDED_SYNTHESIS',
    NO_SOURCES: 'NO_SOURCES',
    COMPLETE: 'COMPLETE',
    ABORTED: 'ABORTED'
});

export const PROVENANCE_MODES = Object.freeze({
    WEB_GROUNDED: 'web_grounded',
    NO_SOURCES: 'no_sources',
    SYNTHESIS_FALLBACK: 'synthesis_fallback',
    ABORTED: 'aborted'
});

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return 'web';
    }
}

export function cleanTextSnippet(text) {
    return String(text || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Normalizes, deduplicates, ranks, and assigns stable numeric IDs (1..N) to sources.
 */
export function normalizeResearchSources(results = [], query = '', limit = 6) {
    if (!Array.isArray(results)) return [];
    const seenUrls = new Set();
    const normalized = [];

    for (const r of results) {
        if (!r) continue;
        const rawUrl = String(r.url || '').trim();
        if (!rawUrl || !rawUrl.startsWith('http')) continue;
        const cleanUrl = rawUrl.split('#')[0].replace(/\/+$/, '');
        const key = cleanUrl.toLowerCase();
        if (seenUrls.has(key)) continue;
        seenUrls.add(key);

        const domain = (r.domain || getDomainFromUrl(cleanUrl)).toLowerCase();
        const title = cleanTextSnippet(r.title || domain || 'Web Result');
        const snippet = cleanTextSnippet(r.snippet || r.description || r.fullArticleText || r.extract || title);

        normalized.push({
            id: normalized.length + 1,
            title,
            snippet,
            url: cleanUrl,
            domain,
            favicon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`,
            sourceLabel: r.sourceLabel || r.source || domain,
            date: r.date || '',
            trusted: Boolean(r.trusted)
        });

        if (normalized.length >= limit) break;
    }
    return normalized;
}

/**
 * Builds the source grounding block for the LLM prompt.
 */
export function formatSourcesForPrompt(sources = []) {
    if (!Array.isArray(sources) || !sources.length) return '';
    return sources.map(s => {
        return `[${s.id}] Title: ${s.title}\nDomain: ${s.domain}\nURL: ${s.url}\nSnippet: ${s.snippet}${s.date ? `\nDate: ${s.date}` : ''}`;
    }).join('\n\n');
}

/**
 * Synthesizes a structured bounded fallback answer strictly from verified source snippets.
 * Used when the 9.0s hard application deadline is reached.
 */
export function generateSnippetFallback(query, sources = []) {
    const cleanQ = normalizeUserQuery(query);
    if (!sources || !sources.length) {
        if (!hasSearchableContent(cleanQ)) {
            return 'Please provide a search topic or question so I can retrieve verified live web sources.';
        }
        return `I searched for current information on "${cleanQ}", but the live web search providers did not return verified records before the deadline. Please try rephrasing your search query.`;
    }

    const bullets = sources.slice(0, 4).map((s) => {
        const text = s.snippet || s.title;
        return `• ${text} [${s.id}]`;
    }).join('\n');

    const topicHeading = hasSearchableContent(cleanQ) ? `### Verified Summary for "${cleanQ}"` : '### Verified Summary';
    return `${topicHeading}\n\n${bullets}\n\n*Gathered from verified live sources within the 9.0s deadline.*`;
}

/**
 * Generates 3 contextual follow-up research questions.
 * Strictly non-blocking. Derived dynamically with zero hardcoding.
 */
export function generateRelatedResearchQuestions(optionsOrQuery, sourcesArg = [], answerArg = '') {
    let query = '';
    let topicInput = '';
    let sources = [];
    let answer = '';

    if (optionsOrQuery && typeof optionsOrQuery === 'object' && !Array.isArray(optionsOrQuery)) {
        query = optionsOrQuery.query || '';
        topicInput = optionsOrQuery.topic || '';
        sources = Array.isArray(optionsOrQuery.sources) ? optionsOrQuery.sources : [];
        answer = optionsOrQuery.answer || '';
    } else {
        query = String(optionsOrQuery || '');
        sources = Array.isArray(sourcesArg) ? sourcesArg : [];
        answer = String(answerArg || '');
    }

    if (!Array.isArray(sources) || sources.length === 0) {
        return [];
    }
    const q = String(query || '').trim();
    const cleanQ = q.replace(/[?.!]+$/g, '').trim();
    if (!cleanQ) return [];

    const words = cleanQ.split(/\s+/).filter(w => w.length > 3 && !/^(what|when|where|which|who|whom|whose|why|how|tell|find|search|show)$/i.test(w));
    const mainTopic = words.length > 0 ? words.slice(-3).join(' ') : cleanQ;

    // Strip leading question prefixes to isolate the core subject
    const strippedQuery = cleanQ
        .replace(/^(?:what\s+(?:is|are|was|were)|tell\s+me\s+(?:about)?|search\s+(?:for)?|find\s+(?:out\s+about)?|who\s+(?:is|was)|how\s+does|how\s+to|explain)\s+/i, '')
        .replace(/^(?:the\s+)?(?:latest|current|recent|new)\s+(?:updates?|news|status|developments?|info(?:rmation)?)\s+(?:on|for|about|regarding)?\s*/i, '')
        .trim();
    const topic = strippedQuery || mainTopic;

    const isUpdateQuery = /\b(latest|current|recent|update|updates|news|today|now)\b/i.test(cleanQ);

    const candidates = [];

    if (isUpdateQuery) {
        candidates.push(`What is the key background context behind ${topic}?`);
        candidates.push(`What are the anticipated next steps or timeline for ${topic}?`);
    } else {
        candidates.push(`What are the latest updates or ongoing developments for ${topic}?`);
        candidates.push(`What is the key background context behind ${topic}?`);
    }

    if (sources && sources.length > 0 && sources[0].title) {
        const titleSnippet = cleanTextSnippet(sources[0].title).replace(/\s*[-–|].*$/, '').trim();
        const tLower = titleSnippet.toLowerCase();
        const qLower = cleanQ.toLowerCase();
        if (titleSnippet && titleSnippet.length > 10 && !qLower.includes(tLower) && !tLower.includes(qLower)) {
            candidates.push(`What are more details about ${titleSnippet}?`);
        } else {
            candidates.push(`What are the main perspectives or next steps regarding ${topic}?`);
        }
    } else {
        candidates.push(`What are the main perspectives or next steps regarding ${topic}?`);
    }

    candidates.push(`What are the primary factors or implications surrounding ${topic}?`);

    const qLower = cleanQ.toLowerCase();
    const filtered = [];
    for (const cand of candidates) {
        const cLower = cand.toLowerCase().replace(/[?.!]+$/g, '').trim();
        if (cLower === qLower) continue;
        if (isUpdateQuery && cLower.startsWith('what are the latest updates') && qLower.includes('latest update')) continue;
        if (!filtered.includes(cand)) {
            filtered.push(cand);
        }
        if (filtered.length >= 3) break;
    }

    return filtered.slice(0, 3);
}

/**
 * Replaces inline citation patterns like [1], [2], [1, 2] with interactive citation badges.
 */
export function parseCitationsInHtml(html = '') {
    if (!html || typeof html !== 'string') return '';

    // Replace [1](url) markdown link citations first if present
    let result = html.replace(/\[(\d+)\]\((https?:\/\/[^)]+)\)/g, (match, id, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer" class="citation-badge" data-source-id="${id}" title="Source [${id}]"><sup>[${id}]</sup></a>`;
    });

    // Replace bare [1], [2], or [1, 2] citations (not part of markdown links or code)
    result = result.replace(/(?<![\[\w`])\[(\d+(?:\s*,\s*\d+)*)\](?![\]\(])/g, (match, idsStr) => {
        const ids = idsStr.split(',').map(s => s.trim()).filter(Boolean);
        return ids.map(id => {
            return `<button type="button" class="citation-badge" data-source-id="${id}" onclick="window.JarvisLiveResearch?.highlightSource('${id}')" title="View Source [${id}]"><sup>[${id}]</sup></button>`;
        }).join('');
    });

    return result;
}

/**
 * Renders or updates the top Sources Carousel inside an assistant message bubble.
 */
export function renderOrUpdateSourcesCarousel(rowElement, sources = []) {
    if (!rowElement || !Array.isArray(sources) || !sources.length) return;
    const bubble = rowElement.querySelector('.chat-bubble-assistant') || rowElement.querySelector('.min-w-0');
    if (!bubble) return;

    let carousel = bubble.querySelector('.chat-source-carousel');
    const cardsHtml = sources.map((s) => {
        const domain = s.domain || 'web';
        const title = s.title || domain;
        const favicon = s.favicon || `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
        const url = s.url || '#';
        return `
            <a href="${url}" target="_blank" rel="noopener noreferrer" class="source-card-pill" data-source-id="${s.id}" title="${title}">
                <img class="source-card-favicon" src="${favicon}" alt="" loading="lazy" onerror="this.style.display='none'" />
                <div class="source-card-info">
                    <span class="source-card-domain">${domain}</span>
                    <span class="source-card-title">${title}</span>
                </div>
                <span class="source-card-badge">${s.id}</span>
            </a>
        `;
    }).join('');

    const newCarouselHtml = `
        <div class="source-carousel-header">
            <span class="source-carousel-title">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
                    <circle cx="12" cy="12" r="10"></circle>
                    <line x1="2" y1="12" x2="22" y2="12"></line>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1-4-10z"></path>
                </svg>
                Sources
            </span>
            <span class="source-carousel-count">${sources.length} verified</span>
        </div>
        <div class="source-carousel-track">
            ${cardsHtml}
        </div>
    `;

    if (carousel) {
        carousel.innerHTML = newCarouselHtml;
    } else {
        const newCarousel = document.createElement('div');
        newCarousel.className = 'chat-source-carousel';
        newCarousel.setAttribute('role', 'region');
        newCarousel.setAttribute('aria-label', 'Web Sources');
        newCarousel.innerHTML = newCarouselHtml;

        const textEl = bubble.querySelector('.assistant-message-text');
        if (textEl) {
            bubble.insertBefore(newCarousel, textEl);
        } else {
            bubble.prepend(newCarousel);
        }
    }
}

/**
 * Highlights a source card pill in the carousel when its citation badge is clicked or hovered.
 */
export function highlightSourceCard(sourceId, container = document) {
    if (!sourceId) return;
    const cards = container.querySelectorAll(`.source-card-pill[data-source-id="${sourceId}"]`);
    cards.forEach(card => {
        card.classList.add('is-highlighted');
        try {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        } catch (_) {}
        setTimeout(() => {
            card.classList.remove('is-highlighted');
        }, 1800);
    });
}

/**
 * Renders the 3 related research questions tray below an assistant message bubble.
 */
export function renderRelatedQuestionsTray(rowElement, questions = [], onSelect = null) {
    if (!rowElement || !Array.isArray(questions) || !questions.length) return;
    let slot = rowElement.querySelector('.assistant-next-steps-slot');
    if (!slot) {
        const bubble = rowElement.querySelector('.chat-bubble-assistant') || rowElement.querySelector('.min-w-0');
        if (!bubble) return;
        slot = document.createElement('div');
        slot.className = 'assistant-next-steps-slot';
        bubble.parentNode.appendChild(slot);
    }

    const pillsHtml = questions.map(q => {
        const escaped = cleanTextSnippet(q);
        return `
            <button type="button" class="related-question-pill" onclick="window.JarvisLiveResearch?.askRelatedQuestion(${JSON.stringify(escaped)})">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>${escaped}</span>
            </button>
        `;
    }).join('');

    slot.innerHTML = `
        <div class="perplexity-related-tray" role="region" aria-label="Related Research Questions">
            <div class="related-tray-title">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                <span>Related Research</span>
            </div>
            <div class="related-pills-list">
                ${pillsHtml}
            </div>
        </div>
    `;
}

let _globalGenerationCounter = 0;

/**
 * Master Bounded Live Research Controller with strict Application Deadline.
 * Enforces explicit lifecycle state machine and provenance contract:
 * REQUESTED -> SEARCHING -> SEARCH_DEADLINE -> SOURCE_VALIDATION
 *           -> SOURCE_GROUNDED_SYNTHESIS (if sources.length > 0)
 *           -> NO_SOURCES (if sources.length === 0)
 *           -> COMPLETE
 */
export class BoundedLiveResearchController {
    constructor(options = {}) {
        this.searchCutoffMs = options.searchCutoffMs || 2500;
        this.fallbackWarningMs = options.fallbackWarningMs || 8500;
        this.hardDeadlineMs = options.hardDeadlineMs || 9000;
        this.turnId = 'turn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        this.generationId = ++_globalGenerationCounter;

        this.state = RESEARCH_STATES.REQUESTED;
        this.provenance = null;
        this.isTerminal = false;
        this.isFallbackRendered = false;
        this.sources = [];
        this.rawSearchResults = [];
        this.streamedText = '';

        this.telemetry = {
            t_start: 0,
            t_first_search: 0,
            t_search_cutoff: 0,
            t_sources_rendered: 0,
            t_llm_start: 0,
            t_first_token: 0,
            t_fallback_triggered: 0,
            t_completed: 0
        };

        this.searchAbortController = new AbortController();
        this.streamAbortController = new AbortController();
        this.timers = [];
        this._resolveExecution = null;
    }

    transition(nextState, meta = {}, uiCallbacks = {}) {
        if (this.isTerminal) return false;
        const prevState = this.state;
        this.state = nextState;

        if (nextState === RESEARCH_STATES.COMPLETE || nextState === RESEARCH_STATES.ABORTED) {
            this.isTerminal = true;
            this.clearAllTimers();
        }

        try {
            uiCallbacks.onStateTransition?.({
                state: nextState,
                prevState,
                turnId: this.turnId,
                provenance: this.provenance,
                meta
            });
        } catch (_) {}
        return true;
    }

    abort() {
        if (this.isTerminal) return;
        this.provenance = PROVENANCE_MODES.ABORTED;
        this.transition(RESEARCH_STATES.ABORTED);
        this.clearAllTimers();
        try { this.searchAbortController.abort(); } catch (_) {}
        try { this.streamAbortController.abort(); } catch (_) {}
        if (typeof this._resolveExecution === 'function') {
            this._resolveExecution({
                success: false,
                aborted: true,
                state: RESEARCH_STATES.ABORTED,
                provenance: PROVENANCE_MODES.ABORTED,
                turnId: this.turnId,
                content: '',
                sources: []
            });
            this._resolveExecution = null;
        }
    }

    clearAllTimers() {
        for (const t of this.timers) {
            clearTimeout(t);
        }
        this.timers = [];
    }

    execute({
        query: rawQuery,
        userText,
        assistantMessageId,
        fetchSearchFn,
        streamSynthesisFn,
        uiCallbacks = {}
    }) {
        return new Promise((resolve) => {
            this._resolveExecution = resolve;
            const query = normalizeUserQuery(rawQuery);
            this.telemetry.t_start = performance.now();

            // Pre-network rejection for empty/whitespace/invisible/non-searchable queries
            if (!hasSearchableContent(query)) {
                this.telemetry.t_completed = performance.now();
                const fallbackContent = generateSnippetFallback(query, []);
                this.provenance = PROVENANCE_MODES.NO_SOURCES;
                this.transition(RESEARCH_STATES.COMPLETE, { provenance: this.provenance }, uiCallbacks);
                const finalPayload = {
                    success: false,
                    fallback: true,
                    state: RESEARCH_STATES.COMPLETE,
                    provenance: PROVENANCE_MODES.NO_SOURCES,
                    content: fallbackContent,
                    sources: [],
                    turnId: this.turnId,
                    assistantMessageId,
                    telemetry: this.telemetry
                };
                if (typeof uiCallbacks.onComplete === 'function') {
                    try { uiCallbacks.onComplete(finalPayload); } catch (_) {}
                }
                if (typeof uiCallbacks.onFallbackComplete === 'function') {
                    try { uiCallbacks.onFallbackComplete(finalPayload); } catch (_) {}
                }
                resolve(finalPayload);
                return;
            }

            this.transition(RESEARCH_STATES.SEARCHING, {}, uiCallbacks);
            let searchCutoffTriggered = false;

            const completeExecution = ({ success, fallback = false, provenance, content, sources }) => {
                if (this.state === RESEARCH_STATES.COMPLETE || this.state === RESEARCH_STATES.ABORTED) return;
                this.provenance = provenance;
                this.telemetry.t_completed = performance.now();
                this.transition(RESEARCH_STATES.COMPLETE, { provenance }, uiCallbacks);

                const finalPayload = {
                    success,
                    fallback,
                    state: RESEARCH_STATES.COMPLETE,
                    provenance,
                    content,
                    sources: sources || [],
                    turnId: this.turnId,
                    assistantMessageId,
                    telemetry: this.telemetry
                };

                // Unified first-class completion callback
                if (typeof uiCallbacks.onComplete === 'function') {
                    try { uiCallbacks.onComplete(finalPayload); } catch (_) {}
                }

                // Backwards-compatible legacy callbacks
                if (success && !fallback) {
                    if (typeof uiCallbacks.onStreamComplete === 'function') {
                        try {
                            uiCallbacks.onStreamComplete({
                                turnId: this.turnId,
                                content,
                                sources: finalPayload.sources,
                                assistantMessageId,
                                telemetry: this.telemetry,
                                provenance
                            });
                        } catch (_) {}
                    }
                } else {
                    this.isFallbackRendered = true;
                    if (typeof uiCallbacks.onFallbackComplete === 'function') {
                        try {
                            uiCallbacks.onFallbackComplete({
                                turnId: this.turnId,
                                content,
                                sources: finalPayload.sources,
                                assistantMessageId,
                                telemetry: this.telemetry,
                                provenance
                            });
                        } catch (_) {}
                    }
                }

                resolve(finalPayload);
            };

            const onSearchDeadline = () => {
                if (searchCutoffTriggered || this.isTerminal) return;
                searchCutoffTriggered = true;
                this.telemetry.t_search_cutoff = performance.now();

                this.transition(RESEARCH_STATES.SEARCH_DEADLINE, {}, uiCallbacks);

                // Abort pending search fetches immediately
                try { this.searchAbortController.abort(); } catch (_) {}

                // SOURCE_VALIDATION
                this.transition(RESEARCH_STATES.SOURCE_VALIDATION, {}, uiCallbacks);
                this.sources = normalizeResearchSources(this.rawSearchResults, query);
                this.telemetry.t_sources_rendered = performance.now();

                // INVARIANT 1: Zero usable sources -> enter NO_SOURCES state immediately
                if (!this.sources || this.sources.length === 0) {
                    this.transition(RESEARCH_STATES.NO_SOURCES, {}, uiCallbacks);
                    this.clearAllTimers();

                    if (typeof uiCallbacks.onSourcesValidated === 'function') {
                        try {
                            uiCallbacks.onSourcesValidated({
                                turnId: this.turnId,
                                sources: [],
                                provenance: PROVENANCE_MODES.NO_SOURCES,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }

                    // Complete immediately with no-source fallback. Zero LLM delay!
                    const noSourceFallback = generateSnippetFallback(query, []);
                    completeExecution({
                        success: false,
                        fallback: true,
                        provenance: PROVENANCE_MODES.NO_SOURCES,
                        content: noSourceFallback,
                        sources: []
                    });
                    return;
                }

                // INVARIANT 2: Valid usable sources -> enter SOURCE_GROUNDED_SYNTHESIS
                this.transition(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS, { count: this.sources.length }, uiCallbacks);

                if (typeof uiCallbacks.onSourcesValidated === 'function') {
                    try {
                        uiCallbacks.onSourcesValidated({
                            turnId: this.turnId,
                            sources: this.sources,
                            provenance: PROVENANCE_MODES.WEB_GROUNDED,
                            assistantMessageId
                        });
                    } catch (_) {}
                }
                if (typeof uiCallbacks.onSourcesReady === 'function') {
                    try {
                        uiCallbacks.onSourcesReady({
                            turnId: this.turnId,
                            sources: this.sources,
                            assistantMessageId
                        });
                    } catch (_) {}
                }

                startSourceGroundedSynthesis();
            };

            const cutoffTimer = setTimeout(onSearchDeadline, this.searchCutoffMs);
            this.timers.push(cutoffTimer);

            const fallbackWarningTimer = setTimeout(() => {
                if (this.isTerminal || this.state !== RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS) return;
                this.telemetry.t_fallback_triggered = performance.now();
                if (typeof uiCallbacks.onFallbackWarning === 'function') {
                    try { uiCallbacks.onFallbackWarning({ turnId: this.turnId, telemetry: this.telemetry }); } catch (_) {}
                }
            }, this.fallbackWarningMs);
            this.timers.push(fallbackWarningTimer);

            const hardDeadlineTimer = setTimeout(() => {
                if (this.isTerminal) return;
                try { this.streamAbortController.abort(); } catch (_) {}

                const currentStreamLength = (this.streamedText || '').trim().length;
                let finalContent = '';
                let finalProvenance = PROVENANCE_MODES.SYNTHESIS_FALLBACK;

                if (currentStreamLength >= 60) {
                    finalContent = `${this.streamedText.trim()}\n\n*(Synthesis completed at the 9.0s deadline)*`;
                    finalProvenance = PROVENANCE_MODES.WEB_GROUNDED;
                } else {
                    finalContent = generateSnippetFallback(query, this.sources);
                }

                completeExecution({
                    success: finalProvenance === PROVENANCE_MODES.WEB_GROUNDED,
                    fallback: finalProvenance !== PROVENANCE_MODES.WEB_GROUNDED,
                    provenance: finalProvenance,
                    content: finalContent,
                    sources: this.sources
                });
            }, this.hardDeadlineMs);
            this.timers.push(hardDeadlineTimer);

            const runSearch = async () => {
                try {
                    if (typeof fetchSearchFn === 'function') {
                        const searchRes = await fetchSearchFn({
                            query,
                            signal: this.searchAbortController.signal,
                            timeoutMs: Math.max(100, this.searchCutoffMs - 200)
                        });
                        // Invariant: drop late search results if deadline has passed or controller is terminal
                        if (searchCutoffTriggered || this.isTerminal) return;

                        if (this.telemetry.t_first_search === 0) {
                            this.telemetry.t_first_search = performance.now();
                        }
                        if (Array.isArray(searchRes?.results)) {
                            this.rawSearchResults.push(...searchRes.results);
                        }
                    }
                } catch (_) {}

                // Early search completion before cutoff
                if (!searchCutoffTriggered && !this.isTerminal) {
                    clearTimeout(cutoffTimer);
                    onSearchDeadline();
                }
            };

            const startSourceGroundedSynthesis = async () => {
                // Invariant: SOURCE_GROUNDED_SYNTHESIS requires sources.length > 0
                if (this.isTerminal || !this.sources || this.sources.length === 0) {
                    onSearchDeadline();
                    return;
                }

                this.telemetry.t_llm_start = performance.now();
                const sourcesContext = formatSourcesForPrompt(this.sources);
                const prompt = `You are a real-time research assistant. Answer the user's question directly, comprehensively, and factually using ONLY the verified web content below.
RULES:
1. Cite verified sources using [1], [2], etc., matching the exact source numbers in the provided list. Do not invent citation numbers.
2. If evidence is contradictory or insufficient, state it clearly.
3. Structure with a direct answer first, followed by essential verified details.

User question: "${query}"

Verified Sources:
${sourcesContext}`;

                try {
                    if (typeof streamSynthesisFn === 'function') {
                        await streamSynthesisFn({
                            prompt,
                            rawQuery: query,
                            sources: this.sources,
                            signal: this.streamAbortController.signal,
                            onToken: (token) => {
                                // Invariant: drop tokens if terminal or no longer in synthesis state
                                if (this.isTerminal || this.state !== RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS) return;
                                if (this.telemetry.t_first_token === 0) {
                                    this.telemetry.t_first_token = performance.now();
                                }
                                this.streamedText += token;
                                if (typeof uiCallbacks.onToken === 'function') {
                                    try {
                                        uiCallbacks.onToken({
                                            turnId: this.turnId,
                                            token,
                                            streamedText: this.streamedText,
                                            assistantMessageId
                                        });
                                    } catch (_) {}
                                }
                            }
                        });
                    }

                    if (!this.isTerminal) {
                        const cleanStreamed = (this.streamedText || '').trim();
                        // Invariant: empty/trivial output protection
                        if (cleanStreamed.length >= 20) {
                            completeExecution({
                                success: true,
                                fallback: false,
                                provenance: PROVENANCE_MODES.WEB_GROUNDED,
                                content: cleanStreamed,
                                sources: this.sources
                            });
                        } else {
                            const snippetFallback = generateSnippetFallback(query, this.sources);
                            completeExecution({
                                success: false,
                                fallback: true,
                                provenance: PROVENANCE_MODES.SYNTHESIS_FALLBACK,
                                content: snippetFallback,
                                sources: this.sources
                            });
                        }
                    }
                } catch (err) {
                    if (this.isTerminal) return;
                    const snippetFallback = generateSnippetFallback(query, this.sources);
                    completeExecution({
                        success: false,
                        fallback: true,
                        provenance: PROVENANCE_MODES.SYNTHESIS_FALLBACK,
                        content: snippetFallback,
                        sources: this.sources
                    });
                }
            };

            runSearch();
        });
    }
}

// Global namespace registration for browser
if (typeof window !== 'undefined') {
    window.JarvisLiveResearch = {
        RESEARCH_STATES,
        PROVENANCE_MODES,
        BoundedLiveResearchController,
        normalizeResearchSources,
        generateSnippetFallback,
        generateRelatedResearchQuestions,
        parseCitationsInHtml,
        renderOrUpdateSourcesCarousel,
        highlightSource: (id) => highlightSourceCard(id, document),
        renderRelatedQuestionsTray,
        normalizeUserQuery,
        hasSearchableContent,
        askRelatedQuestion: (text) => {
            const composer = document.getElementById('chat-composer-input') || document.getElementById('user-input');
            if (composer) {
                composer.value = text;
                composer.focus();
                if (typeof window.sendTextInput === 'function') {
                    window.sendTextInput({ text, forceWebSearch: true });
                }
            }
        }
    };
}

