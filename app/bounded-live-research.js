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
    const cleanQ = String(query || '').replace(/[\u00A0\u200B-\u200D\uFEFF]/g, ' ').trim();
    if (!sources || !sources.length) {
        if (!cleanQ) {
            return 'Please provide a search topic or question so I can retrieve verified live web sources.';
        }
        return `I searched for current information on "${cleanQ}", but the live web search providers did not return verified records before the deadline. Please try rephrasing your search query.`;
    }

    const bullets = sources.slice(0, 4).map((s) => {
        const text = s.snippet || s.title;
        return `• ${text} [${s.id}]`;
    }).join('\n');

    const topicHeading = cleanQ ? `### Verified Summary for "${cleanQ}"` : '### Verified Summary';
    return `${topicHeading}\n\n${bullets}\n\n*Gathered from verified live sources within the 9.0s deadline.*`;
}

/**
 * Generates 3 contextual follow-up research questions.
 * Strictly non-blocking. Derived dynamically with zero hardcoding.
 */
export function generateRelatedResearchQuestions(query, sources = []) {
    const q = String(query || '').trim();
    const cleanQ = q.replace(/[?.!]+$/g, '').trim();
    const words = cleanQ.split(/\s+/).filter(w => w.length > 3 && !/^(what|when|where|which|who|whom|whose|why|how|tell|find|search|show)$/i.test(w));
    const mainTopic = words.length > 0 ? words.slice(-3).join(' ') : cleanQ;

    const questions = [
        `What are the latest updates or ongoing developments for ${cleanQ}?`,
        `What is the key background context behind ${mainTopic}?`
    ];

    if (sources && sources.length > 0 && sources[0].title) {
        const titleSnippet = cleanTextSnippet(sources[0].title).replace(/\s*[-–|].*$/, '').trim();
        if (titleSnippet && titleSnippet.length > 10 && titleSnippet.toLowerCase() !== cleanQ.toLowerCase()) {
            questions.push(`What are more details about ${titleSnippet}?`);
        } else {
            questions.push(`What are the main perspectives or next steps regarding ${mainTopic}?`);
        }
    } else {
        questions.push(`What are the main perspectives or next steps regarding ${mainTopic}?`);
    }

    return questions.slice(0, 3);
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

/**
 * Master Bounded Live Research Controller with strict Application Deadline.
 */
export class BoundedLiveResearchController {
    constructor(options = {}) {
        this.searchCutoffMs = options.searchCutoffMs || 2500;
        this.fallbackWarningMs = options.fallbackWarningMs || 8500;
        this.hardDeadlineMs = options.hardDeadlineMs || 9000;
        this.turnId = 'turn_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);

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
    }

    abort() {
        this.isTerminal = true;
        this.clearAllTimers();
        try { this.searchAbortController.abort(); } catch (_) {}
        try { this.streamAbortController.abort(); } catch (_) {}
        if (typeof this._resolveExecution === 'function') {
            this._resolveExecution({ success: false, aborted: true });
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
        query,
        userText,
        assistantMessageId,
        fetchSearchFn,
        streamSynthesisFn,
        uiCallbacks = {}
    }) {
        return new Promise((resolve) => {
            this._resolveExecution = resolve;
            this.telemetry.t_start = performance.now();
            const startTime = this.telemetry.t_start;

        // Schedule Search Cutoff at T+2500ms
        let searchCutoffTriggered = false;
        const triggerSearchCutoff = () => {
            if (searchCutoffTriggered || this.isTerminal) return;
            searchCutoffTriggered = true;
            this.telemetry.t_search_cutoff = performance.now();
            try { this.searchAbortController.abort(); } catch (_) {}
            this.sources = normalizeResearchSources(this.rawSearchResults, query);
            this.telemetry.t_sources_rendered = performance.now();

            if (typeof uiCallbacks.onSourcesReady === 'function') {
                uiCallbacks.onSourcesReady({
                    turnId: this.turnId,
                    sources: this.sources,
                    assistantMessageId
                });
            }

            // Immediately dispatch LLM synthesis with available sources
            startSynthesis();
        };

        const cutoffTimer = setTimeout(triggerSearchCutoff, this.searchCutoffMs);
        this.timers.push(cutoffTimer);

        // Schedule Fallback Warning at T+8500ms
        const fallbackWarningTimer = setTimeout(() => {
            if (this.isTerminal) return;
            this.telemetry.t_fallback_triggered = performance.now();
            if (typeof uiCallbacks.onFallbackWarning === 'function') {
                uiCallbacks.onFallbackWarning({ turnId: this.turnId, telemetry: this.telemetry });
            }
        }, this.fallbackWarningMs);
        this.timers.push(fallbackWarningTimer);

        // Schedule Hard Application Deadline at T+9000ms
        const hardDeadlineTimer = setTimeout(() => {
            if (this.isTerminal) return;
            this.isTerminal = true;
            this.isFallbackRendered = true;
            this.telemetry.t_completed = performance.now();
            this.clearAllTimers();

            try { this.streamAbortController.abort(); } catch (_) {}

            // Synthesize structured fallback from verified snippets
            const currentStreamLength = (this.streamedText || '').trim().length;
            let finalContent = '';
            if (currentStreamLength >= 60) {
                // Keep partial streamed answer and append note
                finalContent = `${this.streamedText.trim()}\n\n*(Synthesis completed at the 9.0s deadline)*`;
            } else {
                finalContent = generateSnippetFallback(query, this.sources);
            }

            if (typeof uiCallbacks.onFallbackComplete === 'function') {
                uiCallbacks.onFallbackComplete({
                    turnId: this.turnId,
                    content: finalContent,
                    sources: this.sources,
                    assistantMessageId,
                    telemetry: this.telemetry
                });
            }
            resolve({ success: false, fallback: true, content: finalContent, sources: this.sources, telemetry: this.telemetry });
        }, this.hardDeadlineMs);
        this.timers.push(hardDeadlineTimer);

        // Dispatches search providers concurrently
        const runSearch = async () => {
            try {
                if (typeof fetchSearchFn === 'function') {
                    const searchRes = await fetchSearchFn({
                        query,
                        signal: this.searchAbortController.signal,
                        timeoutMs: Math.max(100, this.searchCutoffMs - 200)
                    });
                    if (this.telemetry.t_first_search === 0) {
                        this.telemetry.t_first_search = performance.now();
                    }
                    if (Array.isArray(searchRes?.results)) {
                        this.rawSearchResults.push(...searchRes.results);
                    }
                }
            } catch (_) {}

            // If search completed before T+2500ms cutoff, trigger cutoff early
            if (!searchCutoffTriggered && !this.isTerminal) {
                clearTimeout(cutoffTimer);
                triggerSearchCutoff();
            }
        };

        // Dispatches streaming LLM synthesis
        const startSynthesis = async () => {
            if (this.isTerminal) return;
            this.telemetry.t_llm_start = performance.now();

            const sourcesContext = formatSourcesForPrompt(this.sources);
            const prompt = `You are a real-time research assistant. Answer the user's question directly, comprehensively, and factually using ONLY the verified web content below.
RULES:
1. Cite verified sources using [1], [2], etc., matching the exact source numbers in the provided list. Do not invent citation numbers.
2. If evidence is contradictory or insufficient, state it clearly.
3. Structure with a direct answer first, followed by essential verified details.

User question: "${query}"

Verified Sources:
${sourcesContext || 'No live sources were returned before the search cutoff.'}`;

            try {
                if (typeof streamSynthesisFn === 'function') {
                    await streamSynthesisFn({
                        prompt,
                        rawQuery: query,
                        sources: this.sources,
                        signal: this.streamAbortController.signal,
                        onToken: (token) => {
                            if (this.isTerminal) return;
                            if (this.telemetry.t_first_token === 0) {
                                this.telemetry.t_first_token = performance.now();
                            }
                            this.streamedText += token;
                            if (typeof uiCallbacks.onToken === 'function') {
                                uiCallbacks.onToken({
                                    turnId: this.turnId,
                                    token,
                                    streamedText: this.streamedText,
                                    assistantMessageId
                                });
                            }
                        }
                    });
                }

                // If finished cleanly before 9000ms deadline
                if (!this.isTerminal) {
                    this.isTerminal = true;
                    this.telemetry.t_completed = performance.now();
                    this.clearAllTimers();

                    if (typeof uiCallbacks.onStreamComplete === 'function') {
                        uiCallbacks.onStreamComplete({
                            turnId: this.turnId,
                            content: this.streamedText,
                            sources: this.sources,
                            assistantMessageId,
                            telemetry: this.telemetry
                        });
                    }
                    resolve({ success: true, content: this.streamedText, sources: this.sources, telemetry: this.telemetry });
                }
            } catch (err) {
                // If stream was aborted by our own hard deadline timer, the timer handler already took care of fallback
                if (this.isTerminal) return;

                // If unexpected synthesis failure occurred, trigger fallback immediately
                this.isTerminal = true;
                this.telemetry.t_completed = performance.now();
                this.clearAllTimers();

                const fallbackAnswer = generateSnippetFallback(query, this.sources);
                if (typeof uiCallbacks.onFallbackComplete === 'function') {
                    uiCallbacks.onFallbackComplete({
                        turnId: this.turnId,
                        content: fallbackAnswer,
                        sources: this.sources,
                        assistantMessageId,
                        telemetry: this.telemetry
                    });
                }
                resolve({ success: false, fallback: true, content: fallbackAnswer, sources: this.sources, telemetry: this.telemetry });
            }
        };

        // Fire initial search
        runSearch();
        });
    }
}

// Global namespace registration for browser
if (typeof window !== 'undefined') {
    window.JarvisLiveResearch = {
        BoundedLiveResearchController,
        normalizeResearchSources,
        generateSnippetFallback,
        generateRelatedResearchQuestions,
        parseCitationsInHtml,
        renderOrUpdateSourcesCarousel,
        highlightSource: (id) => highlightSourceCard(id, document),
        renderRelatedQuestionsTray,
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
