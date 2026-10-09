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

export const LIVE_RESEARCH_BUDGETS = Object.freeze({
    HARD_DEADLINE_MS: 9000,
    SEARCH_CUTOFF_MS: 5000,
    SEARCH_TIMEOUT_MS: 4500,
    FALLBACK_WARNING_MS: 8500,
    MIN_SOURCES_FOR_EARLY_SYNTHESIS: 2
});

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

export function distillSearchQuery(rawQuery) {
    if (!rawQuery) return '';
    let text = String(rawQuery).trim();
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const contentLines = [];
        for (const line of lines) {
            if (/^(?:please\s+provide|please\s+include|please\s+format|format\s+as|output\s+as|structure\s+as|requirements?:|instructions?:|columns?:|notes?:|\d+[\.)]\s+|-|\*)/i.test(line)) {
                break;
            }
            contentLines.push(line);
        }
        if (contentLines.length > 0) text = contentLines.join(' ');
        else text = lines[0];
    }
    text = text
        .replace(/\b(?:please\s+)?(?:provide|include|format|output|render|display)\s+(?:a|an|the)?\s+(?:markdown\s+)?(?:table|comparison\s+table|bulleted\s+list|summary|checklist|columns|code\s+block).*$/gi, '')
        .replace(/\b(?:make\s+sure\s+to|be\s+sure\s+to|don't\s+forget\s+to|do\s+not\s+include|ensure\s+that)\b.*$/gi, '')
        .replace(/\b(?:in\s+\d+\s+words|concise\s+summary|step\s+by\s+step|briefly|in\s+detail)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text.trim() || rawQuery;
}

/**
 * Normalizes, deduplicates, ranks, and assigns stable numeric IDs (1..N) to sources.
 */
export function normalizeResearchSources(results = [], query = '', limit = 8) {
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
        const textContent = String(s.snippet || s.description || s.text || '').trim();
        const publisherStr = s.publisher || s.source ? ` (${s.publisher || s.source})` : '';
        return `[${s.id}] Title: ${s.title}${publisherStr}\nDomain: ${s.domain}\nURL: ${s.url}\nSnippet: ${textContent || 'No snippet available.'}${s.date ? `\nDate: ${s.date}` : ''}`;
    }).join('\n\n');
}


export function isAuthoritativeResearchSource(source, query = '') {
    if (!source) return false;
    const domain = String(source.domain || '').toLowerCase();
    const url = String(source.url || '').toLowerCase();
    if (source.sourceType === 'trusted_news' || /\b(?:news\.google\.com|yahoo\.com|msn\.com)\b/i.test(domain)) {
        return false;
    }
    if (source.sourceType === 'official_source') return true;
    const isDocDomain = /\b(?:docs\.python\.org|python\.org|github\.com|developer\.mozilla\.org|go\.dev|rust-lang\.org|kernel\.org)\b/i.test(domain)
        || domain.startsWith('docs.')
        || domain.startsWith('developer.')
        || domain.startsWith('api.');
    if (isDocDomain) return true;
    if (/\b(?:docs|documentation|changelog|whatsnew|release-notes)\b/i.test(url)) return true;
    return false;
}

export function evaluateSourceQualityForEarlySynthesis(sources = [], query = '') {
    if (!Array.isArray(sources) || sources.length === 0) return false;
    const isTechDoc = /\b(?:release|version|changelog|docs?|documentation|api|whatsnew|what\s+changed\s+in)\b/i.test(String(query || ''));
    if (isTechDoc) {
        // Technical & software release queries require at least 1 authoritative source or strong relevance consensus (>= 3 sources)
        const hasAuthoritative = sources.some(s => isAuthoritativeResearchSource(s, query));
        if (hasAuthoritative) return true;
        const cleanTerms = String(query).toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(/\s+/).filter(t => t.length >= 3 && !/^(?:what|changed|latest|release|version|previous|stable|with|from|than|does|will|could|should|about|the|and|for)\b/.test(t));
        const matchedSources = sources.filter(s => {
            const text = `${s.title || ''} ${s.snippet || ''}`.toLowerCase();
            return cleanTerms.some(t => text.includes(t));
        });
        return matchedSources.length >= 3;
    }
    // General queries require at least 2 sources with descriptive content
    return sources.length >= 2 && sources.some(s => (s.snippet || s.description || '').length >= 20);
}

/**
 * Synthesizes a structured bounded fallback answer strictly from verified source snippets.
 * Produces clean natural-language prose without raw bullets, technical headings, or timing disclaimers.
 */
export function generateSnippetFallback(query, sources = []) {
    const cleanQ = normalizeUserQuery(distillSearchQuery(query));
    if (!sources || !sources.length) {
        if (!hasSearchableContent(cleanQ)) {
            return 'Please provide a search topic or question so I can retrieve verified live web sources.';
        }
        return `I searched for current information on "${cleanQ}", but the live web search did not return verified records. Please try rephrasing your search query.`;
    }

    const isTechDoc = /\b(?:release|version|changelog|docs?|documentation|api|whatsnew|what\s+changed\s+in)\b/i.test(cleanQ);
    const authSources = sources.filter(s => isAuthoritativeResearchSource(s, cleanQ));
    const effectiveSources = (isTechDoc && authSources.length) ? authSources : sources;

    const facts = [];
    const seenSentences = new Set();

    for (const s of effectiveSources.slice(0, 6)) {
        const textParts = [];
        if (s.title && !/^https?:\/\//i.test(s.title)) {
            textParts.push(s.title);
        }
        if (s.snippet || s.description) {
            textParts.push(s.snippet || s.description);
        }
        const fullText = textParts.join('. ');

        const rawSentences = fullText.split(/(?<=[.!?])\s+/);
        for (let sentence of rawSentences) {
            if (/\b(?:404|500|502|503)\b/.test(sentence)) continue;
            sentence = cleanTextSnippet(sentence)
                .replace(/^[-*•\s\d.)\][]+/, '')
                .replace(/^[^\s:]{2,20}:\s*/, '')
                .replace(/^\p{L}{3,9}\s+\d{1,2},?\s+\d{4}\s*[—–-]\s*/u, '')
                .replace(/^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}\s*[—–-]\s*/, '')
                .replace(/\s+/g, ' ')
                .trim();
            if (sentence.length < 5 || sentence.length > 400) continue;
            if (/\b(?:404|500|502|503)\b/.test(sentence)) continue;
            if (sentence.replace(/[^a-zA-Z0-9]/g, '').length < 3) continue;
            
            const normalized = sentence.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (seenSentences.has(normalized)) continue;
            seenSentences.add(normalized);
            facts.push(sentence.endsWith('.') ? sentence : `${sentence}.`);
            if (facts.length >= 6) break;
        }
        if (facts.length >= 6) break;
    }

    if (!facts.length) {
        return `Verified live sources were gathered regarding "${cleanQ}", but they did not contain sufficient detail to construct a confident answer. Please review the verified source references above.`;
    }

    // Subject relevance validation for technical documentation queries:
    // If the query asks about a specific technology release (e.g. Python), ensure gathered facts mention it.
    const subjectMatch = cleanQ.match(/(?:(?:latest|current|newest|recent|stable)\s+(?:release|version|update|build)\s+of|changes?\s+in\s+(?:the\s+)?(?:latest\s+)?(?:release|version)\s+of)\s+([a-z0-9_.-]+)/i);
    const subject = subjectMatch ? subjectMatch[1].toLowerCase() : null;
    if (isTechDoc && subject && !facts.some(f => f.toLowerCase().includes(subject))) {
        return `Verified live web sources were retrieved regarding "${cleanQ}", but real-time AI synthesis could not be completed. Please review the verified source references in the carousel above.`;
    }

    // Requirement 5: Never concatenate disjointed headline snippets into a fake answer paragraph.
    // If facts are merely brief headline titles or if sources are news aggregators without substantive body prose:
    const hasSubstantiveProse = facts.some(f => f.length >= 45 && !f.toLowerCase().includes(' - '));
    const isPureNewsFeed = sources.length > 0 && sources.every(s => s.sourceType === 'trusted_news' || s.domain === 'news.google.com' || s.qualitySignals?.includes('google_news_rss'));
    if (isPureNewsFeed && !hasSubstantiveProse) {
        return `Verified live news sources were retrieved regarding "${cleanQ}", but real-time AI synthesis could not be completed. Please explore the verified articles directly in the source carousel above.`;
    }

    return facts.slice(0, 4).join(' ');
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
    const cleanQ = normalizeUserQuery(query).replace(/[?.!]+$/g, '').trim();
    if (!cleanQ) return [];

    const normalizedQuery = cleanQ.toLowerCase();
    const candidates = [];
    const seen = new Set();

    const addCandidate = (text) => {
        if (!text || typeof text !== 'string') return;
        const clean = cleanTextSnippet(text)
            .replace(/^[-*•\s\d.)\][]+/, '')
            .replace(/[?.!]+$/g, '')
            .trim();
        if (clean.length < 4 || clean.length > 120) return;
        const lower = clean.toLowerCase();
        if (lower === normalizedQuery) return;
        if (/^https?:\/\//i.test(clean) || /^[a-z0-9-]+\.[a-z]{2,}(?:\/|$)/i.test(clean)) return;

        const formatted = `${clean}?`;
        const key = formatted.toLowerCase();
        if (!seen.has(key)) {
            seen.add(key);
            candidates.push(formatted);
        }
    };

    // 1. Extract from verified source titles and headline segments
    for (const s of sources) {
        if (!s || !s.title) continue;
        const rawTitle = cleanTextSnippet(s.title);
        const mainTitle = rawTitle.replace(/\s*[-–|—:·].*$/, '').trim();
        addCandidate(mainTitle);

        const segments = rawTitle.split(/\s*[-–|—:·]\s*/);
        for (const seg of segments) {
            addCandidate(seg);
            if (candidates.length >= 6) break;
        }
        if (candidates.length >= 6) break;
    }

    // 2. Extract from verified source snippets / answer sentences
    for (const s of sources) {
        if (candidates.length >= 6) break;
        const text = cleanTextSnippet(s?.snippet || s?.description || '');
        if (!text) continue;
        const sentences = text.split(/(?<=[.!?])\s+/);
        for (const sentence of sentences) {
            addCandidate(sentence);
            if (candidates.length >= 6) break;
        }
    }

    // 3. If still fewer than 3 candidates, derive sub-phrases from source titles
    if (candidates.length < 3) {
        for (const s of sources) {
            if (!s || !s.title) continue;
            const words = cleanTextSnippet(s.title).replace(/\s*[-–|—:·].*$/, '').trim().split(/\s+/).filter(Boolean);
            if (words.length >= 4) {
                const mid = Math.ceil(words.length / 2);
                addCandidate(words.slice(mid).join(' '));
                addCandidate(words.slice(0, mid).join(' '));
            }
            if (candidates.length >= 3) break;
        }
    }

    // 4. Fallback combination if still fewer than 3 candidates
    if (candidates.length < 3 && sources[0]?.title) {
        const titleRef = cleanTextSnippet(sources[0].title).replace(/\s*[-–|—:·].*$/, '').trim();
        if (titleRef && !titleRef.toLowerCase().includes(normalizedQuery)) {
            addCandidate(`${titleRef} (${cleanQ})`);
        }
    }

    return candidates.slice(0, 3);
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

    const textEl = bubble.querySelector('.assistant-message-text');

    if (carousel) {
        carousel.innerHTML = newCarouselHtml;
        if (textEl && textEl.nextSibling !== carousel) {
            textEl.after(carousel);
        }
    } else {
        const newCarousel = document.createElement('div');
        newCarousel.className = 'chat-source-carousel';
        newCarousel.setAttribute('role', 'region');
        newCarousel.setAttribute('aria-label', 'Web Sources');
        newCarousel.innerHTML = newCarouselHtml;

        if (textEl) {
            textEl.after(newCarousel);
        } else {
            bubble.appendChild(newCarousel);
        }
    }
}

/**
 * Highlights a source card pill in the carousel upon citation badge click or hover.
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
        this.searchCutoffMs = options.searchCutoffMs ?? LIVE_RESEARCH_BUDGETS.SEARCH_CUTOFF_MS;
        this.searchTimeoutMs = options.searchTimeoutMs ?? LIVE_RESEARCH_BUDGETS.SEARCH_TIMEOUT_MS;
        this.fallbackWarningMs = options.fallbackWarningMs ?? LIVE_RESEARCH_BUDGETS.FALLBACK_WARNING_MS;
        this.hardDeadlineMs = options.hardDeadlineMs ?? LIVE_RESEARCH_BUDGETS.HARD_DEADLINE_MS;
        this.minSourcesForEarlySynthesis = options.minSourcesForEarlySynthesis ?? LIVE_RESEARCH_BUDGETS.MIN_SOURCES_FOR_EARLY_SYNTHESIS;
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
            t_completed: 0,
            providerTiming: null,
            searchError: null,
            httpStatus: null,
            sourcesCount: 0,
            totalDurationMs: 0
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
            let synthesisStarted = false;

            const completeExecution = ({ success, fallback = false, provenance, content, sources }) => {
                if (this.state === RESEARCH_STATES.COMPLETE || this.state === RESEARCH_STATES.ABORTED) return;
                this.provenance = provenance;
                this.telemetry.t_completed = performance.now();
                this.telemetry.sourcesCount = (sources || []).length;
                this.telemetry.totalDurationMs = this.telemetry.t_start
                    ? Math.round(this.telemetry.t_completed - this.telemetry.t_start)
                    : 0;
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
                    sourcesCount: this.telemetry.sourcesCount,
                    totalDurationMs: this.telemetry.totalDurationMs,
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

                // Abort pending search fetches immediately
                try { this.searchAbortController.abort(); } catch (_) {}

                // If synthesis has already started (early synthesis path), do not restart or transition backwards
                if (synthesisStarted) return;

                this.transition(RESEARCH_STATES.SEARCH_DEADLINE, {}, uiCallbacks);

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

            // Guard: only set cutoff timer if budget is positive.
            // A zero searchCutoffMs would fire immediately before any results arrive.
            const cutoffTimer = this.searchCutoffMs > 0
                ? setTimeout(onSearchDeadline, this.searchCutoffMs)
                : null;
            if (cutoffTimer !== null) this.timers.push(cutoffTimer);

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

                if (currentStreamLength >= 30) {
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
                            query: distillSearchQuery(query) || query,
                            signal: this.searchAbortController.signal,
                            timeoutMs: this.searchTimeoutMs
                        });
                        // Invariant: drop late search results if deadline has passed or controller is terminal
                        if (searchCutoffTriggered || this.isTerminal) return;

                        if (this.telemetry.t_first_search === 0) {
                            this.telemetry.t_first_search = performance.now();
                        }
                        if (searchRes?.timing || searchRes?.providerTiming) {
                            this.telemetry.providerTiming = searchRes.providerTiming || searchRes.timing;
                        }
                        if (Array.isArray(searchRes?.results)) {
                            this.rawSearchResults.push(...searchRes.results);
                        }
                    }
                } catch (err) {
                    if (searchCutoffTriggered || this.isTerminal) return;
                    const errStr = String(err?.message || err || '').toLowerCase();
                    const isTimeout = err?.name === 'TimeoutError' ||
                        errStr.includes('timed out') ||
                        errStr.includes('timeout') ||
                        this.searchAbortController.signal.aborted;
                    const timeoutBound = this.searchTimeoutMs || 4500;
                    this.telemetry.searchError = isTimeout
                        ? `client_search_timeout (${timeoutBound}ms)`
                        : (err?.message || String(err));
                    this.telemetry.httpStatus = err?.status || null;
                    console.error(`[BoundedLiveResearch:${this.turnId}] Search failed (status: ${err?.status || 'N/A'}):`, err);
                    clearTimeout(cutoffTimer);
                    onSearchDeadline();
                    return;
                }

                // Invariant: drop late search results if deadline has passed or controller is terminal
                if (searchCutoffTriggered || this.isTerminal) return;

                const currentSources = normalizeResearchSources(this.rawSearchResults, query);
                this.sources = currentSources;

                // Quality-aware early synthesis:
                // Only trigger early synthesis if sources meet quality standards (e.g. authoritative docs for tech queries)
                // and minimum source count is satisfied.
                const meetsQuality = currentSources.length >= this.minSourcesForEarlySynthesis &&
                    evaluateSourceQualityForEarlySynthesis(currentSources, query);

                if (meetsQuality) {
                    clearTimeout(cutoffTimer);
                    this.telemetry.t_sources_rendered = performance.now();
                    this.transition(RESEARCH_STATES.SOURCE_VALIDATION, { early: true }, uiCallbacks);
                    this.transition(RESEARCH_STATES.SOURCE_GROUNDED_SYNTHESIS, { count: currentSources.length, early: true }, uiCallbacks);

                    if (typeof uiCallbacks.onSourcesValidated === 'function') {
                        try {
                            uiCallbacks.onSourcesValidated({
                                turnId: this.turnId,
                                sources: currentSources,
                                provenance: PROVENANCE_MODES.WEB_GROUNDED,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }
                    if (typeof uiCallbacks.onSourcesReady === 'function') {
                        try {
                            uiCallbacks.onSourcesReady({
                                turnId: this.turnId,
                                sources: currentSources,
                                assistantMessageId
                            });
                        } catch (_) {}
                    }

                    startSourceGroundedSynthesis();
                } else {
                    // Search completed early with fewer than minSourcesForEarlySynthesis or insufficient quality: finalize at cutoff or complete
                    clearTimeout(cutoffTimer);
                    onSearchDeadline();
                }
            };

            const startSourceGroundedSynthesis = async () => {
                // Invariant: SOURCE_GROUNDED_SYNTHESIS requires sources.length > 0
                if (synthesisStarted || this.isTerminal || !this.sources || this.sources.length === 0) {
                    return;
                }
                synthesisStarted = true;

                this.telemetry.t_llm_start = performance.now();
                const sourcesContext = formatSourcesForPrompt(this.sources);
                const now = new Date();
                const currentDateStr = now.toLocaleDateString('en-US', {
                    weekday: 'long',
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                const effectiveUserPrompt = String(userText || query || '').trim();
                const prompt = `You are an expert real-time research assistant. Answer the user's question directly, comprehensively, and factually using ONLY the verified web content below.
TEMPORAL ANCHOR:
Today's Date: ${currentDateStr}. Use this exact date as your reference point for phrases like 'today', 'this month', 'recently', 'latest', 'current', or 'this year'.

RULES:
1. COMPLETE COVERAGE: Answer every part and sub-question of the user prompt directly and thoroughly. Extract all relevant facts, names, figures, and entity lists contained in the sources. If multiple entities, companies, or criteria are affected or mentioned across the sources, enumerate all of them explicitly in a structured list.
2. SUBSTANTIVE DETAILS: Do not return only headlines, source titles, or vague high-level summaries. Extract and explain the substantive facts, operational impacts, and policy specifics from the excerpts.
3. DISTINGUISH CONFIRMED FACTS VS. UNCERTAINTY: Clearly differentiate confirmed/official actions (e.g. audits, investigations, PERM labor certification freezes) from ongoing/unaffected status or speculation (e.g. clarify whether existing visas remain valid or are suspended). If evidence is contradictory, evolving, or insufficient on a point, state the exact scope and limitations clearly.
4. GROUNDED CITATIONS: Ground key statements and extracted facts with source citations using [1], [2], etc., matching the numbered verified sources below.
5. STRUCTURE: Provide a direct answer first, followed by clear explanations, enumerated lists, and impact analyses.

User question: "${effectiveUserPrompt}"

Verified Sources:
${sourcesContext}`;

                // Dynamic remaining synthesis budget: hard deadline - elapsed so far - 300ms buffer
                const elapsedSoFar = performance.now() - this.telemetry.t_start;
                const remainingBudgetMs = Math.max(1000, Math.round(this.hardDeadlineMs - elapsedSoFar - 300));

                try {
                    if (typeof streamSynthesisFn === 'function') {
                        await streamSynthesisFn({
                            prompt,
                            rawQuery: query,
                            sources: this.sources,
                            signal: this.streamAbortController.signal,
                            timeoutMs: remainingBudgetMs,
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
                        // Invariant: empty/trivial output protection — 10 chars minimum to distinguish real output from blank
                        if (cleanStreamed.length >= 10) {
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
                    this.telemetry.synthesisError = err?.message || String(err);
                    console.error(`[BoundedLiveResearch:${this.turnId}] Synthesis failed:`, err);
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
        LIVE_RESEARCH_BUDGETS,
        RESEARCH_STATES,
        PROVENANCE_MODES,
        BoundedLiveResearchController,
        normalizeResearchSources,
        isAuthoritativeResearchSource,
        evaluateSourceQualityForEarlySynthesis,
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

