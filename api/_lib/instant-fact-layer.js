/**
 * @file api/_lib/instant-fact-layer.js
 * @description Zero-Scraping Instant Fact Grounding Layer using Wikipedia REST API & DuckDuckGo Instant Answers.
 */

const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKIPEDIA_SEARCH_API = 'https://en.wikipedia.org/w/api.php';
const DUCKDUCKGO_API = 'https://api.duckduckgo.com';

const FETCH_TIMEOUT_MS = 2500;

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Fetches Wikipedia Summary for a given page title.
 * @param {string} pageTitle 
 * @returns {Promise<{ title: string, extract: string, description: string, url: string } | null>}
 */
export async function fetchWikipediaSummary(pageTitle) {
    if (!pageTitle) return null;
    const encoded = encodeURIComponent(String(pageTitle).replace(/\s+/g, '_'));
    try {
        const response = await fetchWithTimeout(`${WIKIPEDIA_SUMMARY_URL}/${encoded}`, {
            headers: { 'Accept': 'application/json', 'User-Agent': 'UnifyAssistant/1.0 (knowledge-grounding)' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (!data?.extract) return null;
        return {
            title: String(data.title || pageTitle).trim(),
            extract: String(data.extract || '').trim(),
            description: String(data.description || '').trim(),
            url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`
        };
    } catch (_) {
        return null;
    }
}

/**
 * Searches Wikipedia for relevant article titles.
 * @param {string} query 
 * @returns {Promise<Array<{ title: string, snippet: string }>>}
 */
export async function searchWikipediaArticles(query) {
    if (!query) return [];
    const url = new URL(WIKIPEDIA_SEARCH_API);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('utf8', '1');
    url.searchParams.set('srlimit', '3');
    try {
        const response = await fetchWithTimeout(url.toString(), {
            headers: { 'Accept': 'application/json', 'User-Agent': 'UnifyAssistant/1.0 (knowledge-grounding)' }
        });
        if (!response.ok) return [];
        const data = await response.json();
        const results = Array.isArray(data?.query?.search) ? data.query.search : [];
        return results.map(item => ({
            title: String(item.title || '').trim(),
            snippet: String(item.snippet || '').replace(/<[^>]*>/g, '').trim()
        }));
    } catch (_) {
        return [];
    }
}

/**
 * Fetches DuckDuckGo Instant Answer JSON.
 * @param {string} query 
 * @returns {Promise<{ heading: string, abstract: string, url: string, source: string } | null>}
 */
export async function fetchDuckDuckGoInstantAnswer(query) {
    if (!query) return null;
    const url = new URL(DUCKDUCKGO_API);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'json');
    url.searchParams.set('no_html', '1');
    url.searchParams.set('skip_disambig', '1');
    try {
        const response = await fetchWithTimeout(url.toString(), {
            headers: { 'Accept': 'application/json', 'User-Agent': 'UnifyAssistant/1.0 (instant-answers)' }
        });
        if (!response.ok) return null;
        const data = await response.json();
        const abstract = String(data?.AbstractText || data?.Abstract || '').trim();
        if (!abstract) return null;
        return {
            heading: String(data?.Heading || query).trim(),
            abstract,
            url: String(data?.AbstractURL || '').trim(),
            source: String(data?.AbstractSource || 'DuckDuckGo Instant Answers').trim()
        };
    } catch (_) {
        return null;
    }
}

/**
 * Resolves instant facts for a query without heavy web scraping.
 * @param {string} query 
 * @param {object} intentClassification 
 * @returns {Promise<{
 *   grounded: boolean,
 *   facts: Array<{ title: string, summary: string, url: string, source: string }>,
 *   ragText: string,
 *   directAnswerDirective: string
 * }>}
 */
export async function resolveInstantFact(query, intentClassification = {}) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) {
        return { grounded: false, facts: [], ragText: '', directAnswerDirective: '' };
    }

    const facts = [];
    const entityTarget = intentClassification?.entityTarget;

    // Strategy 1: Targeted Entity Search for political leadership / offices
    if (entityTarget?.role && entityTarget?.jurisdiction) {
        const candidateTitles = [
            `List of ${entityTarget.role.toLowerCase()}s of ${entityTarget.jurisdiction}`,
            `List of ${entityTarget.role}s of ${entityTarget.jurisdiction}`,
            `${entityTarget.role} of ${entityTarget.jurisdiction}`,
            `Government of ${entityTarget.jurisdiction}`
        ];

        for (const title of candidateTitles) {
            const summary = await fetchWikipediaSummary(title);
            if (summary && summary.extract) {
                facts.push({
                    title: summary.title,
                    summary: summary.extract,
                    url: summary.url,
                    source: 'Wikipedia'
                });
                break;
            }
        }
    }

    // Strategy 2: If no targeted entity summary found, search Wikipedia & DuckDuckGo in parallel
    if (!facts.length) {
        const [wikiArticles, ddgAnswer] = await Promise.all([
            searchWikipediaArticles(rawQuery),
            fetchDuckDuckGoInstantAnswer(rawQuery)
        ]);

        if (ddgAnswer && ddgAnswer.abstract) {
            facts.push({
                title: ddgAnswer.heading,
                summary: ddgAnswer.abstract,
                url: ddgAnswer.url,
                source: ddgAnswer.source
            });
        }

        if (wikiArticles.length > 0) {
            const topSummary = await fetchWikipediaSummary(wikiArticles[0].title);
            if (topSummary && topSummary.extract) {
                facts.push({
                    title: topSummary.title,
                    summary: topSummary.extract,
                    url: topSummary.url,
                    source: 'Wikipedia'
                });
            } else if (wikiArticles[0].snippet) {
                facts.push({
                    title: wikiArticles[0].title,
                    summary: wikiArticles[0].snippet,
                    url: `https://en.wikipedia.org/wiki/${encodeURIComponent(wikiArticles[0].title.replace(/\s+/g, '_'))}`,
                    source: 'Wikipedia'
                });
            }
        }
    }

    if (!facts.length) {
        return { grounded: false, facts: [], ragText: '', directAnswerDirective: '' };
    }

    const ragText = facts.map((fact, index) => [
        `[Authoritative Source ${index + 1}: ${fact.source} - ${fact.title}]`,
        `Summary: ${fact.summary}`,
        `URL: ${fact.url}`
    ].join('\n')).join('\n\n');

    const directAnswerDirective = 'Answer the question directly and concisely in 1-2 clear sentences using this verified fact. Do not provide generic advice, disclaimers, or filler.';

    return {
        grounded: true,
        facts,
        ragText,
        directAnswerDirective
    };
}
