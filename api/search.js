export const config = { maxDuration: 60 };

import { createHash } from 'node:crypto';
import { applyApiSecurity } from './_lib/security.js';
import { classifyFreeLiveIntent, routeMessage } from './_lib/latest/router.js';
import { searchItems } from './_lib/latest/latest-cache.js';
import { ingestLatestSources } from './_lib/latest/latest-ingest.js';
import { runFreeLiveSearch, searchDuckDuckGoHtml } from './_lib/free-live/providers.js';
import { extractWithCrawl4Ai } from './_lib/crawl4ai-client.js';
import { rankTextsByEmbedding, chunkTextForEmbedding, hasNvidiaEmbeddingKey, rerankTexts, getNvidiaRerankModel } from './_lib/embeddings.js';
import { cleanQueryTarget, extractQueryTargetMetadata } from './_lib/query-target-cleanup.js';

const SERPER_SEARCH_URL = 'https://google.serper.dev/search';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const REDDIT_SEARCH_URL = 'https://www.reddit.com/search.json';
const BRITANNICA_SEARCH_URL = 'https://www.britannica.com/search';
const ARCHIVE_TODAY_SEARCH_URL = 'https://archive.today/search/';
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const EXA_SEARCH_URL = 'https://api.exa.ai/search';
const GEMINI_GENERATE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const SEARCH_TIMEOUT_MS = 3_000;
const PUBLIC_SOURCE_TIMEOUT_MS = 2_500;
const GEMINI_SEARCH_TIMEOUT_MS = 3_000;
const MAX_QUERY_LENGTH = 500;
const LATEST_REFRESH_INTERVAL_MS = 10 * 60 * 1000;
let lastLatestRefreshAt = 0;

const WIKIDATA_ENTITY_CACHE = new Map();
const WIKIDATA_ROLE_CACHE = new Map();

const LOOKUP_ONLY_SOURCE_TYPES = new Set([
    'reference_lookup',
    'archive_lookup',
    'community_discussion'
]);

export const LIVE_SEARCH_DISABLED_RESPONSE = Object.freeze({
    success: false,
    disabled: true,
    error: Object.freeze({
        code: 'feature_disabled',
        message: 'Live search is unavailable.'
    }),
    results: []
});

const TRUSTED_SOURCE_HOSTS = Object.freeze([
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'reuters.com',
    'thehindu.com',
    'indianexpress.com',
    'nytimes.com',
    'washingtonpost.com',
    'who.int',
    'nih.gov',
    'cdc.gov',
    'noaa.gov',
    'nasa.gov',
    'isro.gov.in',
    'rbi.org.in',
    'sec.gov',
    'imf.org',
    'worldbank.org',
    'europa.eu',
    'gov.uk',
    'usa.gov',
    'wikipedia.org',
    'wikidata.org',
    'britannica.com',
    'reddit.com',
    'archive.today',
    'archive.ph',
    'archive.is'
]);

const OFFICIAL_GOVERNMENT_DOMAIN_PATTERNS = Object.freeze([
    /\.gov$/i,
    /\.gouv(?:\.[a-z]{2})?$/i,
    /\.go\.[a-z]{2}$/i,
    /\.gov\.[a-z]{2}$/i,
    /^gov\.[a-z]{2}$/i,
    /^gc\.ca$/i,
    /^europa\.eu$/i,
    /^un\.org$/i
]);

export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'search',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 60, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    if (req.body?.task === 'web_fetch' || req.body?.action === 'web_fetch') {
        const fetchUrl = String(req.body?.url || req.body?.query || '').trim();
        if (!fetchUrl) {
            return res.status(400).json({ success: false, error: 'url is required for web_fetch.' });
        }
        const extracted = await extractWithCrawl4Ai(fetchUrl).catch(e => ({ success: false, error: String(e?.message || e) }));
        return res.status(200).json({
            success: true,
            tool: 'web_fetch',
            url: fetchUrl,
            markdown: extracted?.content || extracted?.markdown || extracted?.text || '',
            content: extracted?.content || extracted?.markdown || extracted?.text || ''
        });
    }

    const originalQuery = normalizeSearchQuery(req.body?.query || req.body?.q || req.body?.url || '');
    const rewrite = buildSearchQueryRewrite(originalQuery);
    const query = rewrite.query;
    if (!query) {
        return res.status(400).json({
            success: false,
            error: { code: 'invalid_request', message: 'Query is required.' },
            results: []
        });
    }

    try {

        const limit = clampInt(req.body?.limit || req.body?.maxResults, 8, 1, 20);
        const mode = normalizeSearchMode(req.body?.mode || req.body?.searchMode || '');
        if (mode === 'rag') {
            const search = await runEvidenceFirstWebRag(query, { limit });
            return res.status(200).json({
                success: true,
                query,
                originalQuery: originalQuery === query ? undefined : originalQuery,
                searchRewrite: rewrite,
                route: {
                    route: 'live_required',
                    category: 'web_rag',
                    confidence: 0.95,
                    reasons: ['evidence_first_web_rag']
                },
                searchRequired: true,
                searchSkipped: false,
                category: 'web_rag',
                ...search
            });
        }
        const route = await resolveRetrievalRoute(originalQuery || query, classifyFreeLiveIntent(originalQuery || query), {
            useModelClassifier: mode === 'auto'
        });
        if (mode === 'classify') {
            return res.status(200).json({
                success: true,
                query,
                originalQuery: originalQuery === query ? undefined : originalQuery,
                searchRewrite: rewrite,
                route,
                searchRequired: route.route !== 'llm',
                searchSkipped: route.route === 'llm',
                results: [],
                provider: 'classifier'
            });
        }
        if (mode === 'auto' && route.route === 'llm') {
            return res.status(200).json({
                success: true,
                query,
                originalQuery: originalQuery === query ? undefined : originalQuery,
                searchRewrite: rewrite,
                route,
                searchRequired: false,
                searchSkipped: true,
                ...buildSearchSkippedSummary(query, route)
            });
        }
        if (route.route === 'live_required') {
            if (route.category === 'government' || route.category === 'news' || route.category === 'web_search') {
                const search = await runVerifiedWebSearch(query, { limit });
                return res.status(200).json({
                    success: true,
                    query,
                    originalQuery: originalQuery === query ? undefined : originalQuery,
                    searchRewrite: rewrite,
                    route,
                    searchRequired: true,
                    searchSkipped: false,
                    ...search,
                    category: search.category || route.category,
                    answerProvider: search.answerProvider || (search.answer ? 'public_source_result' : undefined),
                    answer: search.answer
                });
            }
            const search = await runFreeLiveSearch(query, route, { limit });
            const unsupported = Boolean(search.unsupported);
            return res.status(200).json({
                success: !unsupported,
                disabled: false,
                query,
                originalQuery: originalQuery === query ? undefined : originalQuery,
                searchRewrite: rewrite,
                route,
                searchRequired: true,
                searchSkipped: false,
                error: unsupported
                    ? {
                        code: search.category === 'unsupported_free_live' ? 'unsupported_free_live' : 'clarification_required',
                        message: search.warnings?.[0] || 'No durable permanent-free live source is configured for this request.'
                    }
                    : undefined,
                ...buildSearchSummary(search.results || [], {
                    query,
                    provider: search.provider || 'free_public_sources',
                    publicSourceCount: search.publicSourceCount || 0,
                    geminiEnhanced: false,
                    warnings: search.warnings || []
                }),
                answerProvider: search.answerProvider || (search.provider === 'thesportsdb' ? 'sports_reference_source' : search.provider === 'wikimedia+openstreetmap' ? 'public_place_source' : search.provider ? `${String(search.provider).replace(/-/g, '_')}_source` : undefined),
                answer: search.answer || (search.results?.[0] ? `${search.results[0].title}: ${search.results[0].description}` : undefined),
                category: search.category || route.category
            });
        }
        if (route.route === 'cached_latest') {
            const search = await runCachedLatestSearch(query, { limit });
            return res.status(200).json({
                success: true,
                query,
                originalQuery: originalQuery === query ? undefined : originalQuery,
                searchRewrite: rewrite,
                route,
                searchRequired: true,
                searchSkipped: false,
                ...search
            });
        }
        const search = await runVerifiedWebSearch(query, { limit });
        return res.status(200).json({
            success: true,
            query,
            originalQuery: originalQuery === query ? undefined : originalQuery,
            searchRewrite: rewrite,
            route,
            searchRequired: mode === 'auto',
            searchSkipped: false,
            ...search
        });
    } catch (error) {
        const status = Number(error?.httpStatus) || 502;
        return res.status(status).json({
            success: false,
            error: {
                code: String(error?.code || 'search_failed'),
                message: String(error?.publicMessage || error?.message || 'Live search failed.'),
                upstreamStatus: Number(error?.upstreamStatus) || undefined,
                retryable: error?.retryable !== false,
                keyFingerprint: getSerperKeyFingerprint()
            },
            results: []
        });
    }
}

function normalizeSearchMode(value) {
    const mode = String(value || '').trim().toLowerCase();
    if (mode === 'rag' || mode === 'web_rag') return 'rag';
    if (mode === 'auto' || mode === 'classify') return mode;
    return 'explicit';
}

function buildSearchSkippedSummary(query, route) {
    return {
        results: [],
        answer: undefined,
        answerProvider: undefined,
        distinctDomains: [],
        trustedCount: 0,
        sourceCount: 0,
        answerEvidenceCount: 0,
        distinctDomainCount: 0,
        provider: 'classifier',
        publicSourceCount: 0,
        geminiEnhanced: false,
        warnings: ['Live search skipped because the classifier routed this as stable model knowledge.'],
        refreshed: false,
        category: route?.category || 'stable_knowledge'
    };
}

async function resolveRetrievalRoute(message, fallbackRoute = {}, options = {}) {
    const route = normalizeRetrievalRoute(fallbackRoute);
    if (isSpecializedRetrievalRoute(route) || route.category === 'unsupported_free_live') return route;
    if (route.category === 'web_search' && route.reasons?.includes('explicit_or_product_search_requires_web_sources')) return route;
    if (options.useModelClassifier !== true) return route;
    const modelRoute = await classifyRetrievalIntentWithGemini(message).catch(error => ({
        warning: `gemini_retrieval_classifier_failed:${String(error?.code || error?.message || 'unknown')}`
    }));
    if (!modelRoute?.decision) return route;
    if (modelRoute.decision === 'stable_answer') {
        return {
            route: 'llm',
            category: 'stable_knowledge',
            confidence: modelRoute.confidence || 0.72,
            reasons: ['model_retrieval_classifier_stable']
        };
    }
    if (modelRoute.decision === 'needs_live_search') {
        return {
            route: 'live_required',
            category: 'web_search',
            confidence: modelRoute.confidence || 0.78,
            reasons: ['model_retrieval_classifier_live_search']
        };
    }
    return route;
}

function normalizeRetrievalRoute(route = {}) {
    return {
        route: String(route.route || 'llm'),
        category: String(route.category || 'stable_knowledge'),
        confidence: Number(route.confidence) || 0.42,
        reasons: Array.isArray(route.reasons) ? route.reasons.map(String) : []
    };
}

function isSpecializedRetrievalRoute(route = {}) {
    return ['weather', 'crypto', 'sports', 'disasters', 'government', 'news', 'tourism_food_places'].includes(String(route.category || ''));
}

async function classifyRetrievalIntentWithGemini(message) {
    if (!hasGeminiKey()) return null;
    const prompt = `Return strict JSON only.
Task: decide if this user message needs external live/public-source retrieval.
Rules:
- Choose "needs_live_search" for requests about recent/current information, reviews, prices, availability, comparisons, developing events, or anything likely to change.
- Choose "stable_answer" for explanations, definitions, stable facts, writing, math, code help, summaries, or evergreen knowledge.
- Do not rely on brand or product word lists; reason from the user's intent.
User message: ${JSON.stringify(message)}
JSON shape: {"decision":"needs_live_search|stable_answer","confidence":0.0,"subject":"...","intent":"..."}`;
    const json = await callGeminiJson(prompt, { maxOutputTokens: 260, temperature: 0 });
    const decision = String(json?.decision || '').trim();
    if (!['needs_live_search', 'stable_answer'].includes(decision)) return null;
    return {
        decision,
        confidence: Math.max(0.01, Math.min(0.99, Number(json?.confidence) || 0.72)),
        subject: normalizeSearchQuery(json?.subject || ''),
        intent: normalizeSearchQuery(json?.intent || '')
    };
}

export async function runCachedLatestSearch(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    let results = searchItems(query, { limit });
    let refreshed = false;
    if (!results.length) {
        refreshed = await refreshLatestCacheIfStale(options);
        results = searchItems(query, { limit });
    }
    const normalized = results.map(normalizeLatestCacheResult);
    return {
        ...buildSearchSummary(normalized, {
            query,
            provider: 'latest_cache',
            publicSourceCount: results.length,
            geminiEnhanced: false,
            warnings: results.length ? [] : ['No cached freshness articles matched this request.'],
            refreshed
        }),
        answerProvider: results[0] ? 'latest_cache_source' : undefined,
        answer: results[0] ? `${results[0].title}. ${results[0].summary || ''}`.trim() : undefined
    };
}

export function hasSerperKey() {
    return Boolean(getSerperApiKey());
}

export function hasLiveSearchProvider() {
    return true;
}

export function isPoliticalOrLeadershipQuery(query) {
    const raw = String(query || '').toLowerCase();
    return /\b(cm|chief minister|prime minister|pm|president|governor|mayor|leader|minister|election|elections|mla|mp|cabinet|tenure|political party|candidate|assembly|parliament)\b/i.test(raw);
}

export async function searchPublicSources(query, options = {}) {
    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [];
    const limit = clampInt(options.limit, 8, 1, 20);
    const isPolitical = isPoliticalOrLeadershipQuery(normalizedQuery);
    const deterministicQueries = buildDeterministicSearchQueries(normalizedQuery);
    const plannedQueries = Array.isArray(options.plannedQueries) && options.plannedQueries.length
        ? options.plannedQueries
        : [normalizedQuery];
    const querySet = Array.from(new Set([
        normalizedQuery,
        ...plannedQueries.map(item => normalizeSearchQuery(item)).filter(Boolean),
        ...deterministicQueries
    ])).slice(0, 7);

    const targetQueries = querySet.slice(0, 2);

    const asyncTasks = [
        Promise.allSettled(targetQueries.map(candidate => searchGoogleNewsRss(candidate, { limit }))),
        Promise.allSettled(targetQueries.map(candidate => searchWikipedia(candidate, { limit: 2 }))),
        Promise.allSettled([searchWikidata(targetQueries[0] || normalizedQuery, { limit: 2 })]),
        Promise.allSettled([searchDuckDuckGoHtml(targetQueries[0] || normalizedQuery, { limit: Math.min(5, limit) })]),
        options.skipStructuredRoles === true
            ? Promise.resolve([])
            : Promise.allSettled([searchGovernmentRole(normalizedQuery, { limit: Math.min(3, limit) })]),
        options.skipGdelt === true
            ? Promise.resolve([])
            : Promise.allSettled(targetQueries.map(candidate => searchGdeltNews(candidate, { limit })))
    ];

    const settled = await Promise.all(asyncTasks);
    const liveNews = (Array.isArray(settled[0]) ? settled[0] : []).flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const wiki = (Array.isArray(settled[1]) ? settled[1] : []).flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 3);
    const wikidata = (Array.isArray(settled[2]) ? settled[2] : []).flatMap(r => r.status === 'fulfilled' ? r.value : []).slice(0, 2);
    const liveWeb = (Array.isArray(settled[3]) ? settled[3] : [])
        .flatMap(r => r.status === 'fulfilled' ? r.value : [])
        .filter(item => !isPolitical || (!String(item?.url || '').includes('wikipedia.org') && !String(item?.url || '').includes('wikidata.org')));
    const governmentRoleResults = (Array.isArray(settled[4]) ? settled[4] : []).flatMap(r => r.status === 'fulfilled' ? r.value : []);
    const gdelt = (Array.isArray(settled[5]) ? settled[5] : []).flatMap(r => r.status === 'fulfilled' ? r.value : []);

    const combined = [
        ...wiki,
        ...wikidata,
        ...governmentRoleResults,
        ...liveNews,
        ...gdelt,
        ...liveWeb
    ].filter(Boolean);

    const rankedCandidates = rankSources(normalizedQuery, combined);
    const seenUrls = new Set();
    const deduped = [];
    for (const item of rankedCandidates) {
        if (!item.url || seenUrls.has(item.url)) continue;
        seenUrls.add(item.url);
        deduped.push(item);
        if (deduped.length >= Math.max(limit, 8)) break;
    }
    if (options.skipAutoDeepCrawl !== true && options.allowDeepCrawl === true) {
        await enrichSearchResultsWithDeepCrawl(deduped, 3).catch(() => {});
    }
    return deduped;
}

export async function searchWikipedia(query, options = {}) {
    const limit = clampInt(options.limit, 4, 1, 10);
    const url = new URL(WIKIPEDIA_SEARCH_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', String(limit));
    url.searchParams.set('format', 'json');
    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
    const summaries = await Promise.all(
        hits.slice(0, limit).map(async (hit) => {
            const title = String(hit?.title || '').trim();
            if (!title) return null;
            const summary = await fetchWikipediaSummary(title).catch(() => null);
            return normalizeWikipediaItem(summary || hit, query);
        })
    );
    return summaries.filter(item => item && item.title && item.url);
}

export async function searchGoogleNewsRss(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const encoded = encodeURIComponent(rawQ);

    const url = `https://news.google.com/rss/search?q=${encoded}&hl=en&gl=US&ceid=US:en`;

    const response = await fetchWithTimeout(url, {
        headers: {
            'Accept': 'application/rss+xml, application/xml, text/xml, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS).catch(() => null);

    if (!response || !response.ok) return [];
    const xml = await response.text().catch(() => '');
    if (!xml || !xml.includes('<item>')) return [];

    return parseGoogleNewsRssXml(xml, rawQ, limit);
}

function cleanXmlEntities(str) {
    return String(str || '')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&#160;/g, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&mdash;/gi, '—')
        .replace(/&ndash;/gi, '–')
        .replace(/&#8217;/g, "'")
        .replace(/&#8216;/g, "'")
        .replace(/&#8220;/g, '"')
        .replace(/&#8221;/g, '"')
        .replace(/&#8211;/g, '-')
        .replace(/&#8212;/g, '—')
        .replace(/&hellip;/gi, '...')
        .replace(/\s+/g, ' ')
        .trim();
}

function parseGoogleNewsRssXml(xml, query, limit = 8) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
        const itemBlock = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(itemBlock);
        const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemBlock);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemBlock);
        const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(itemBlock);
        const sourceMatch = /<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i.exec(itemBlock);

        let rawTitle = cleanXmlEntities(titleMatch?.[1] || '');
        let link = cleanXmlEntities(linkMatch?.[1] || '');
        const pubDate = cleanXmlEntities(pubDateMatch?.[1] || '');
        let desc = cleanXmlEntities(descMatch?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const sourceName = cleanXmlEntities(sourceMatch?.[2] || '');

        let publisher = sourceName;
        if (rawTitle.includes(' - ')) {
            const parts = rawTitle.split(' - ');
            if (!publisher && parts.length > 1) {
                publisher = parts[parts.length - 1].trim();
            }
        }

        if (rawTitle && link) {
            const domain = getDomainFromUrl(link) || 'news.google.com';
            items.push({
                title: rawTitle,
                description: desc || rawTitle,
                url: link,
                domain: domain,
                sourceType: 'trusted_news',
                sourceLabel: publisher ? `Google News / ${publisher}` : 'Google News',
                date: pubDate,
                timestamp: pubDate ? (new Date(pubDate).getTime() || Date.now()) : Date.now(),
                confidence: 0.94
            });
        }
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
}

export async function crawlArticleBody(url, options = {}) {
    const targetUrl = String(url || '').trim();
    if (!targetUrl || !targetUrl.startsWith('http')) return null;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|mp4|mp3|zip|gz|tar)$/i.test(targetUrl)) return null;

    const timeoutMs = options.timeoutMs || 3500;
    try {
        const response = await fetchWithTimeout(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            }
        }, timeoutMs);

        if (!response.ok) return null;
        const html = await response.text();
        if (!html || typeof html !== 'string') return null;

        return extractCleanArticleText(html, targetUrl);
    } catch (_) {
        return null;
    }
}

export function extractCleanArticleText(html, url = '') {
    if (!html) return null;
    
    let pubDate = '';
    const dateMatch = html.match(/<meta\s+(?:property|name)=["'](?:article:published_time|pubdate|date|og:published_time|dc\.date)["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:article:published_time|pubdate|date|og:published_time|dc\.date)["']/i);
    if (dateMatch?.[1]) {
        pubDate = dateMatch[1].trim();
    }

    let pageTitle = '';
    const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch?.[1]) {
        pageTitle = cleanXmlEntities(ogTitleMatch[1]);
    } else {
        const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleTagMatch?.[1]) {
            pageTitle = cleanXmlEntities(titleTagMatch[1]);
        }
    }

    let cleaned = html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
        .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
        .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
        .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
        .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
        .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
        .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
        .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, ' ')
        .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ');

    let bodyText = '';
    const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
        || cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
    
    const sourceHtml = articleMatch?.[1] || cleaned;
    const pMatches = sourceHtml.match(/<p\b[^>]*>([\s\S]*?)<\/p>/gi) || [];
    
    if (pMatches.length > 0) {
        const paragraphs = pMatches.map(p => {
            return p.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        }).filter(p => p.length > 30);
        bodyText = paragraphs.slice(0, 10).join('\n\n');
    }

    if (!bodyText) {
        bodyText = sourceHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    }

    bodyText = bodyText.slice(0, 2500).trim();

    return {
        title: pageTitle,
        pubDate,
        bodyText,
        url
    };
}

export async function enrichSearchResultsWithDeepCrawl(results, limit = 3) {
    if (!Array.isArray(results) || !results.length) return results;
    
    const candidates = results.slice(0, limit);
    const crawlPromises = candidates.map(item => {
        const u = String(item?.url || '');
        if (!u || !u.startsWith('http') || u.includes('wikipedia.org') || u.includes('wikidata.org') || u.includes('.example')) return Promise.resolve(null);
        return crawlArticleBody(item.url, { timeoutMs: 2500 }).catch(() => null);
    });

    const settled = await Promise.allSettled(crawlPromises);
    settled.forEach((res, i) => {
        if (res.status === 'fulfilled' && res.value?.bodyText) {
            candidates[i].fullArticleText = res.value.bodyText;
            if (res.value.pubDate && !candidates[i].date) {
                candidates[i].date = res.value.pubDate;
            }
            candidates[i].deepCrawled = true;
        }
    });

    return results;
}

export async function searchGdeltNews(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const url = new URL(GDELT_DOC_URL);
    url.searchParams.set('query', query);
    url.searchParams.set('mode', 'ArtList');
    url.searchParams.set('format', 'json');
    url.searchParams.set('maxrecords', String(Math.min(limit, 20)));
    url.searchParams.set('sort', 'HybridRel');

    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const articles = Array.isArray(data?.articles) ? data.articles : [];
    return articles
        .map((item, index) => normalizeGdeltItem(item, query, index))
        .filter(item => item.title && item.url);
}

export async function searchWikidata(query, options = {}) {
    const limit = clampInt(options.limit, 3, 1, 10);
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('uselang', 'en');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('format', 'json');

    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.search) ? data.search : [];
    return hits
        .map((item, index) => normalizeWikidataItem(item, query, index))
        .filter(item => item.title && item.url);
}

export async function searchGovernmentRole(query, options = {}) {
    const intent = parseGovernmentRoleQuery(query);
    if (!intent) return [];
    const limit = clampInt(options.limit, 3, 1, 6);
    const jurisdiction = await resolveWikidataEntity(intent.jurisdiction).catch(() => null);
    if (!jurisdiction?.id) return [];
    const sparql = buildGovernmentRoleSparql(intent, jurisdiction.id, limit);
    try {
        const response = await fetchWithTimeout(`${WIKIDATA_SPARQL_URL}?query=${encodeURIComponent(sparql)}&format=json`, {
            headers: {
                Accept: 'application/sparql-results+json, application/json',
                'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)'
            }
        }, 3500);
        if (response.ok) {
            const data = await response.json();
            const bindings = normalizeGovernmentRoleBindings(data, intent, jurisdiction, query).slice(0, limit);
            if (bindings.length) return bindings;
        }
    } catch (_) {}

    const wikiQuery = `List of ${intent.role}s of ${intent.jurisdiction}`;
    const wikiResults = await searchWikipedia(wikiQuery, { limit: 2 }).catch(() => []);
    return wikiResults;
}

export async function resolveWikidataEntity(label) {
    const query = normalizeSearchQuery(label);
    if (!query) return null;
    const cacheKey = query.toLowerCase();
    if (WIKIDATA_ENTITY_CACHE.has(cacheKey)) {
        return WIKIDATA_ENTITY_CACHE.get(cacheKey);
    }
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set('action', 'wbsearchentities');
    url.searchParams.set('search', query);
    url.searchParams.set('language', 'en');
    url.searchParams.set('uselang', 'en');
    url.searchParams.set('limit', '5');
    url.searchParams.set('format', 'json');
    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    const data = await response.json();
    const hits = Array.isArray(data?.search) ? data.search : [];
    const ranked = hits
        .map((item, index) => ({
            id: String(item?.id || '').trim(),
            label: String(item?.label || '').trim(),
            description: String(item?.description || '').trim(),
            conceptUri: String(item?.concepturi || '').trim(),
            score: scoreWikidataEntityCandidate(query, item, index)
        }))
        .filter(item => /^Q\d+$/.test(item.id) && item.label)
        .sort((a, b) => b.score - a.score);
    const result = ranked[0] || null;
    if (result) {
        if (WIKIDATA_ENTITY_CACHE.size > 500) {
            const first = WIKIDATA_ENTITY_CACHE.keys().next().value;
            WIKIDATA_ENTITY_CACHE.delete(first);
        }
        WIKIDATA_ENTITY_CACHE.set(cacheKey, result);
    }
    return result;
}

export async function searchReddit(query, options = {}) {
    const limit = clampInt(options.limit, 3, 1, 10);
    const url = new URL(REDDIT_SEARCH_URL);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', 'relevance');
    url.searchParams.set('t', 'year');

    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'JARVISAssistant/1.0 public-source-search'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const posts = Array.isArray(data?.data?.children) ? data.data.children : [];
    return posts
        .map((entry, index) => normalizeRedditItem(entry?.data || entry, query, index))
        .filter(item => item.title && item.url);
}

export async function searchSerper(query, options = {}) {
    const apiKey = getSerperApiKey();
    if (!apiKey) return [];

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [];

    const limit = clampInt(options.limit, 8, 1, 20);
    let response;
    try {
        response = await fetchWithTimeout(SERPER_SEARCH_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-KEY': apiKey
            },
            body: JSON.stringify({
                q: normalizedQuery,
                num: Math.min(20, Math.max(10, limit))
            })
        }, SEARCH_TIMEOUT_MS);
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw createSearchError({
                code: 'search_timeout',
                httpStatus: 504,
                publicMessage: 'Live search timed out while contacting Serper.',
                retryable: true
            });
        }
        throw createSearchError({
            code: 'search_network_error',
            httpStatus: 502,
            publicMessage: 'Live search could not reach Serper from the server.',
            retryable: true
        });
    }

    if (!response.ok) {
        const detail = await response.text().catch(() => '');
        throw createSerperStatusError(response.status, detail);
    }

    const data = await response.json();
    return normalizeSerperResults(data, normalizedQuery).slice(0, limit);
}

export async function searchExa(query, options = {}) {
    const apiKey = getExaApiKey();
    if (!apiKey) return [];

    const normalizedQuery = normalizeSearchQuery(query);
    if (!normalizedQuery) return [];

    const limit = clampInt(options.limit, 8, 1, 20);
    const plannedQueries = Array.isArray(options.plannedQueries)
        ? options.plannedQueries.map(item => normalizeSearchQuery(item)).filter(Boolean)
        : [];
    const querySet = Array.from(new Set([normalizedQuery, ...plannedQueries])).slice(0, 4);

    const isAiGateway = Boolean(process.env.AI_GATEWAY_TOKEN || process.env.VERCEL_AI_GATEWAY_TOKEN);
    const exaEndpoint = isAiGateway && process.env.AI_GATEWAY_EXA_URL
        ? process.env.AI_GATEWAY_EXA_URL
        : EXA_SEARCH_URL;

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey
    };
    if (isAiGateway) {
        headers.Authorization = `Bearer ${apiKey}`;
    }

    const searchPayload = {
        type: 'auto',
        numResults: Math.min(limit, 10),
        contents: {
            text: { maxCharacters: 3000 },
            summary: true,
            highlights: { numSentences: 3, highlightsPerUrl: 3 }
        }
    };
    if (Array.isArray(options.includeDomains) && options.includeDomains.length) {
        searchPayload.includeDomains = options.includeDomains;
    }
    if (Array.isArray(options.excludeDomains) && options.excludeDomains.length) {
        searchPayload.excludeDomains = options.excludeDomains;
    }
    if (options.startPublishedDate) {
        searchPayload.startPublishedDate = options.startPublishedDate;
    }
    if (options.endPublishedDate) {
        searchPayload.endPublishedDate = options.endPublishedDate;
    }

    const settled = await Promise.allSettled(querySet.map(async (candidate, queryIndex) => {
        const response = await fetchWithTimeout(exaEndpoint, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ...searchPayload,
                query: candidate
            })
        }, SEARCH_TIMEOUT_MS);
        if (!response.ok) {
            const detail = await response.text().catch(() => '');
            throw createSearchError({
                code: `exa_status_${response.status}`,
                httpStatus: response.status,
                publicMessage: `Exa search failed${detail ? `: ${sanitizeProviderDetail(detail)}` : '.'}`,
                retryable: response.status >= 500 || response.status === 429
            });
        }
        const data = await response.json();
        return normalizeExaResults(data, normalizedQuery, queryIndex);
    }));

    return dedupeSearchResults(settled.flatMap(result => result.status === 'fulfilled' ? result.value : []))
        .slice(0, limit);
}

export async function runVerifiedWebSearch(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const normalizedQuery = normalizeSearchQuery(query);
    const deterministicQueries = buildDeterministicSearchQueries(normalizedQuery);
    
    const planning = hasGeminiKey()
        ? await buildGeminiSearchPlan(normalizedQuery).catch(error => ({
            queries: [],
            warning: `gemini_query_planning_failed:${String(error?.code || error?.message || 'unknown')}`
        }))
        : { queries: [], warning: '' };

    const searchQueries = Array.from(new Set([
        normalizedQuery,
        ...deterministicQueries,
        ...(planning.queries || [])
    ]));

    // Search using our own scrapers only (no paid APIs)
    const publicSources = await searchPublicSources(normalizedQuery, {
        limit,
        plannedQueries: searchQueries,
        skipAutoDeepCrawl: true
    }).catch(() => []);

    const publicResults = rankSources(normalizedQuery, dedupeSearchResults(publicSources)
        .filter(item => isValidCitationSource(item, normalizedQuery))).slice(0, limit);

    let warnings = buildSearchWarnings(publicResults, planning.warning ? [planning.warning] : []);
    
    let enhancedResults = publicResults;
    let geminiEnhanced = false;
    if (hasGeminiKey()) {
        const enhanced = await enhanceResultsWithGemini(normalizedQuery, publicResults, { limit }).catch(error => ({
            results: publicResults,
            enhanced: false,
            warning: `gemini_enhancement_failed:${String(error?.code || error?.message || 'unknown')}`
        }));
        enhancedResults = rankSources(normalizedQuery, dedupeSearchResults(enhanced.results || publicResults)
            .filter(item => isValidCitationSource(item, normalizedQuery))).slice(0, limit);
        geminiEnhanced = Boolean(enhanced.enhanced);
        warnings = buildSearchWarnings(enhancedResults, [
            ...warnings,
            enhanced.warning || ''
        ].filter(Boolean));
    }

    return buildSearchSummary(enhancedResults, {
        query: normalizedQuery,
        provider: 'public_sources',
        publicSourceCount: enhancedResults.length,
        geminiEnhanced,
        warnings
    });
}

export async function runEvidenceFirstWebRag(query, options = {}) {
    const totalStart = performance.now();
    const FAST_PATH_BUDGET_MS = 8_000;
    const timing = {
        intentMs: 0,
        planningMs: 0,
        exaMs: 0,
        serperMs: 0,
        publicSourcesMs: 0,
        structuredLookupMs: 0,
        embeddingMs: 0,
        rerankMs: 0,
        crawlMs: 0,
        llmMs: 0,
        totalMs: 0,
        // Backward-compatibility aliases
        intentDetectionMs: 0,
        queryGenerationMs: 0,
        embeddingsMs: 0,
        rerankingMs: 0,
        deepCrawlMs: 0,
        finalLlmMs: 0,
        totalLatencyMs: 0
    };

    // Stage 0: Fast Deterministic Intent (< 1ms)
    const intentStart = performance.now();
    const normalizedQuery = normalizeSearchQuery(query);
    const limit = clampInt(options.limit, 8, 1, 20);
    if (!normalizedQuery) {
        return buildUnverifiedRagSummary(normalizedQuery, [], ['Empty query.']);
    }

    const roleIntent = parseGovernmentRoleQuery(normalizedQuery);
    const isFastFactual = Boolean(roleIntent || isCurrentTopicSearchQuery(normalizedQuery) || isDatedChangingFactSearchQuery(normalizedQuery));
    timing.intentMs = Number((performance.now() - intentStart).toFixed(1));
    timing.intentDetectionMs = timing.intentMs;

    // Stage 1: Deterministic Query Generation (skip Gemini on fast path)
    const queryGenStart = performance.now();
    let plannedQueries = buildDeterministicSearchQueries(normalizedQuery);
    let planningWarning = '';
    if (!isFastFactual && !plannedQueries.length && options.forceGeminiPlanning === true) {
        const planning = await buildGeminiSearchPlan(normalizedQuery).catch(error => ({
            queries: [],
            warning: `gemini_query_planning_failed:${String(error?.code || error?.message || 'unknown')}`
        }));
        plannedQueries = planning.queries || plannedQueries;
        planningWarning = planning.warning || '';
    }
    const phases = buildWebRagQueryPhases(normalizedQuery, plannedQueries);
    timing.planningMs = Number((performance.now() - queryGenStart).toFixed(1));
    timing.queryGenerationMs = timing.planningMs;

    const warnings = planningWarning ? [planningWarning] : [];
    const seen = new Set();
    let allResults = [];
    let finalGate = null;
    let finalAnswer = null;
    let finalPhase = 0;
    let embeddingUsed = false;
    let embeddingModel = '';
    let rerankUsed = false;
    let rerankModel = '';

    // Stage 2: Tiered Parallel Scraper Round (Fast Path)
    // Tier 1 scrapers: Google News RSS, Wikipedia, DuckDuckGo, Wikidata generic
    // Structured Wikidata SPARQL runs concurrently but independently
    // GDELT, Reddit, deep crawl, embeddings, reranking = fallback only
    const phase1Queries = phases[0] || [normalizedQuery];
    const searchStart = performance.now();

    const tier1Tasks = [
        searchPublicSources(normalizedQuery, {
            limit,
            plannedQueries: phase1Queries,
            skipStructuredRoles: true,
            skipAutoDeepCrawl: true
        }).then(r => {
            timing.publicSourcesMs = Number((performance.now() - searchStart).toFixed(1));
            return r;
        }).catch(error => {
            warnings.push(`rag_phase_1_failed:${String(error?.code || error?.message || 'unknown')}`);
            return [];
        })
    ];

    // Structured Wikidata role lookup runs concurrently (only for role queries)
    if (roleIntent) {
        tier1Tasks.push(
            searchGovernmentRole(normalizedQuery, { limit: Math.min(3, limit) }).then(r => {
                timing.structuredLookupMs = Number((performance.now() - searchStart).toFixed(1));
                return r;
            }).catch(() => [])
        );
    }

    const tier1Settled = await Promise.all(tier1Tasks);
    const publicResults = tier1Settled[0] || [];
    const structRoleResults = tier1Settled[1] || [];

    // Structured claims go first for priority
    for (const item of [...structRoleResults, ...publicResults]) {
        const key = normalizeResultKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        allResults.push(item);
    }

    allResults = rankSources(normalizedQuery, dedupeSearchResults(allResults)
        .filter(item => isValidCitationSource(item, normalizedQuery)))
        .slice(0, Math.max(limit, 8));

    if (process.env.NVIDIA_API_KEY && allResults.length > 0 && options.skipEmbedding !== true) {
        const embStart = performance.now();
        const embeddingRank = await rankRagResultsWithEmbeddings(normalizedQuery, allResults).catch(() => ({ available: false, ranked: allResults, model: '' }));
        if (embeddingRank.available) {
            embeddingUsed = true;
            embeddingModel = embeddingRank.model || embeddingModel;
            allResults = embeddingRank.ranked.slice(0, Math.max(limit, 8));
        }
        timing.embeddingMs = Number((performance.now() - embStart).toFixed(1));
        timing.embeddingsMs = timing.embeddingMs;

        const rerankStart = performance.now();
        const rerankResult = await rerankRagResults(normalizedQuery, allResults).catch(() => ({ available: false, ranked: allResults, model: '' }));
        if (rerankResult.available) {
            rerankUsed = true;
            rerankModel = rerankResult.model || rerankModel;
            allResults = rerankResult.ranked.slice(0, Math.max(limit, 8));
        }
        timing.rerankMs = Number((performance.now() - rerankStart).toFixed(1));
        timing.rerankingMs = timing.rerankMs;
    }

    finalGate = evaluateWebRagEvidence(normalizedQuery, allResults);
    finalPhase = 1;

    // Stage 3: Early Exit — Deterministic Structured Claim (<1ms)
    if (finalGate.pass || allResults.some(r => r.evidenceLevel === 'structured_claim')) {
        const directAnswer = extractDeterministicLiveFactAnswer(normalizedQuery, allResults);
        if (directAnswer?.verified && directAnswer.answer) {
            finalAnswer = directAnswer;
        }
    }

    // Stage 4: Fast LLM synthesis if deterministic didn't match but evidence passed gate
    if (!finalAnswer?.verified && finalGate.pass) {
        const llmStart = performance.now();
        finalAnswer = await buildGroundedRagAnswer(normalizedQuery, allResults, finalGate, { skipDeepCrawl: true })
            .catch(error => {
                warnings.push(`rag_answer_failed:${String(error?.code || error?.message || 'unknown')}`);
                return null;
            });
        timing.llmMs = Number((performance.now() - llmStart).toFixed(1));
        timing.finalLlmMs = timing.llmMs;
    }

    // Stage 5: Fallback — ONLY if Phase 1 failed to verify
    // Activates: GDELT, deep crawl, embeddings/reranking, secondary search, LLM
    const elapsed = performance.now() - totalStart;
    if (!finalAnswer?.verified && elapsed < FAST_PATH_BUDGET_MS) {
        finalPhase = 2;
        const fallbackQueries = phases[1] || [];

        // Deep crawl top 2 results for more evidence
        const crawlStart = performance.now();
        await enrichSearchResultsWithDeepCrawl(allResults, 2).catch(() => {});
        timing.crawlMs = Number((performance.now() - crawlStart).toFixed(1));
        timing.deepCrawlMs = timing.crawlMs;

        if (fallbackQueries.length) {
            const extraPublic = await searchPublicSources(normalizedQuery, {
                limit,
                plannedQueries: fallbackQueries,
                skipStructuredRoles: false,
                skipAutoDeepCrawl: true,
                skipGdelt: false
            }).catch(() => []);
            for (const item of extraPublic) {
                const key = normalizeResultKey(item);
                if (!key || seen.has(key)) continue;
                seen.add(key);
                allResults.push(item);
            }
            allResults = rankSources(normalizedQuery, dedupeSearchResults(allResults)
                .filter(item => isValidCitationSource(item, normalizedQuery)))
                .slice(0, Math.max(limit, 8));
        }

        // Embeddings & reranking ONLY on fallback
        if (process.env.NVIDIA_API_KEY && allResults.length > 0) {
            const embStart = performance.now();
            const embeddingRank = await rankRagResultsWithEmbeddings(normalizedQuery, allResults).catch(() => ({ available: false, ranked: allResults, model: '' }));
            if (embeddingRank.available) {
                embeddingUsed = true;
                embeddingModel = embeddingRank.model || embeddingModel;
                allResults = embeddingRank.ranked.slice(0, Math.max(limit, 8));
            }
            timing.embeddingMs = Number((performance.now() - embStart).toFixed(1));
            timing.embeddingsMs = timing.embeddingMs;

            const rerankStart = performance.now();
            const rerankResult = await rerankRagResults(normalizedQuery, allResults).catch(() => ({ available: false, ranked: allResults, model: '' }));
            if (rerankResult.available) {
                rerankUsed = true;
                rerankModel = rerankResult.model || rerankModel;
                allResults = rerankResult.ranked.slice(0, Math.max(limit, 8));
            }
            timing.rerankMs = Number((performance.now() - rerankStart).toFixed(1));
            timing.rerankingMs = timing.rerankMs;
        }

        finalGate = evaluateWebRagEvidence(normalizedQuery, allResults);
        if (finalGate.pass) {
            const llmStart = performance.now();
            finalAnswer = await buildGroundedRagAnswer(normalizedQuery, allResults, finalGate, { skipDeepCrawl: false })
                .catch(() => null);
            const extraLlm = Number((performance.now() - llmStart).toFixed(1));
            timing.llmMs = Number((timing.llmMs + extraLlm).toFixed(1));
            timing.finalLlmMs = timing.llmMs;
        }
    }

    timing.totalMs = Number((performance.now() - totalStart).toFixed(1));
    timing.totalLatencyMs = timing.totalMs;

    console.log(`[Search Latency Breakdown] query="${normalizedQuery}" total=${timing.totalMs}ms | intent=${timing.intentMs}ms planning=${timing.planningMs}ms public=${timing.publicSourcesMs}ms structured=${timing.structuredLookupMs}ms embedding=${timing.embeddingMs}ms rerank=${timing.rerankMs}ms crawl=${timing.crawlMs}ms llm=${timing.llmMs}ms phase=${finalPhase}`);

    const results = allResults.slice(0, limit);
    const gate = finalGate || evaluateWebRagEvidence(normalizedQuery, results);
    if (!finalAnswer?.verified || !finalAnswer.answer) {
        const unverifiedText = 'I could not verify this from retrieved sources.';
        return {
            provider: 'web_rag',
            answerProvider: 'web_rag_unverified',
            answer: gate.conflict
                ? 'Retrieved sources conflict, so I cannot verify this confidently.'
                : unverifiedText,
            verified: false,
            confidence: gate.confidence,
            evidenceUsed: [],
            results,
            sourceCount: results.length,
            answerEvidenceCount: gate.evidence.length,
            distinctDomains: Array.from(new Set(results.map(item => item.domain).filter(Boolean))),
            distinctDomainCount: new Set(results.map(item => item.domain).filter(Boolean)).size,
            trustedCount: results.filter(item => item.trusted || item.sourceType === 'official_source').length,
            publicSourceCount: results.length,
            geminiEnhanced: false,
            embeddingEnhanced: embeddingUsed,
            embeddingModel: embeddingModel || undefined,
            rerankEnhanced: rerankUsed,
            rerankModel: rerankModel || undefined,
            ragPhaseCount: finalPhase,
            timing,
            warnings: Array.from(new Set([...warnings, gate.reason].filter(Boolean)))
        };
    }

    const evidencePool = gate.evidence.length ? gate.evidence : results;
    const evidence = selectEvidenceByIndexes(evidencePool, finalAnswer.evidenceIndexes).slice(0, 6);
    return {
        provider: 'web_rag',
        answerProvider: 'web_rag_grounded',
        answer: finalAnswer.answer,
        verified: true,
        confidence: Math.max(gate.confidence, Number(finalAnswer.confidence) || 0),
        evidenceUsed: evidence.map(item => ({
            title: item.title,
            url: item.url,
            domain: item.domain,
            date: item.date || '',
            sourceType: item.sourceType || ''
        })),
        results,
        sourceCount: results.length,
        answerEvidenceCount: evidence.length || gate.evidence.length,
        distinctDomains: Array.from(new Set(results.map(item => item.domain).filter(Boolean))),
        distinctDomainCount: new Set(results.map(item => item.domain).filter(Boolean)).size,
        trustedCount: results.filter(item => item.trusted || item.sourceType === 'official_source').length,
        publicSourceCount: results.length,
        geminiEnhanced: Boolean(finalAnswer.modelAssisted),
        embeddingEnhanced: embeddingUsed,
        embeddingModel: embeddingModel || undefined,
        rerankEnhanced: rerankUsed,
        rerankModel: rerankModel || undefined,
        ragPhaseCount: finalPhase,
        timing,
        warnings: Array.from(new Set(warnings.filter(Boolean)))
    };
}

function buildUnverifiedRagSummary(query, results = [], warnings = []) {
    return {
        provider: 'web_rag',
        answerProvider: 'web_rag_unverified',
        answer: 'I could not verify this from retrieved sources.',
        verified: false,
        confidence: 0,
        evidenceUsed: [],
        results,
        sourceCount: results.length,
        answerEvidenceCount: 0,
        distinctDomains: [],
        distinctDomainCount: 0,
        trustedCount: 0,
        publicSourceCount: results.length,
        geminiEnhanced: false,
        ragPhaseCount: 0,
        warnings
    };
}



export function extractSearchTopic(text) {
    return String(text || '')
        .replace(/^\s*(latest|current|today'?s|recent|breaking)\s+/i, '')
        .replace(/\b(news|headlines|updates?)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

export function isTrustedLiveSource(urlOrDomain) {
    const domain = String(urlOrDomain || '').includes('://')
        ? getDomainFromUrl(urlOrDomain)
        : String(urlOrDomain || '').toLowerCase().replace(/^www\./, '');
    if (!domain) return false;
    return TRUSTED_SOURCE_HOSTS.some(host => domain === host || domain.endsWith(`.${host}`));
}

async function fetchWikipediaSummary(title) {
    const url = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(String(title || '').replace(/\s+/g, '_'))}`;
    const response = await fetchWithTimeout(url, {
        headers: { Accept: 'application/json' }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    return response.json();
}

function normalizeWikipediaItem(item, query) {
    const title = String(item?.title || '').trim();
    const pageUrl = String(item?.content_urls?.desktop?.page || '').trim() ||
        (title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}` : '');
    const description = stripHtml(String(item?.extract || item?.snippet || item?.description || '')).trim();
    const domain = getDomainFromUrl(pageUrl);
    return {
        title,
        description,
        url: pageUrl,
        domain,
        source: 'Wikipedia',
        sourceType: 'encyclopedia',
        sourceLabel: 'Wikipedia',
        date: '',
        freshness: 'reference',
        position: Number(item?.index || 1),
        trusted: true,
        qualitySignals: ['public_reference', 'trusted_source'],
        query
    };
}

function normalizeGdeltItem(item, query, index) {
    const url = String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    const date = normalizeGdeltDate(item?.seendate);
    const title = String(item?.title || '').trim();
    return {
        title,
        description: buildGdeltDescription(item, domain, date),
        url,
        domain,
        source: String(item?.domain || domain || 'GDELT').trim(),
        sourceType: isTrustedLiveSource(domain) ? 'trusted_news' : 'public_news',
        sourceLabel: `${domain || 'GDELT'} via GDELT`,
        date,
        freshness: date ? 'recent_or_indexed' : 'unknown',
        position: index + 1,
        trusted: isTrustedLiveSource(domain),
        qualitySignals: [
            'public_news_index',
            isTrustedLiveSource(domain) ? 'trusted_domain' : ''
        ].filter(Boolean),
        query
    };
}

function normalizeWikidataItem(item, query, index) {
    const id = String(item?.id || '').trim();
    const title = String(item?.label || item?.title || id).trim();
    const description = String(item?.description || item?.match?.text || '').replace(/\s+/g, ' ').trim();
    const url = id ? `https://www.wikidata.org/wiki/${encodeURIComponent(id)}` : String(item?.concepturi || '').trim();
    const domain = getDomainFromUrl(url);
    return {
        title,
        description: description || 'Structured public entity data from Wikidata.',
        url,
        domain,
        source: 'Wikidata',
        sourceType: 'structured_reference',
        sourceLabel: 'Wikidata',
        date: '',
        freshness: 'reference',
        position: index + 1,
        trusted: true,
        qualitySignals: ['public_reference', 'structured_entity_data', 'trusted_source'],
        evidenceLevel: 'reference_summary',
        query
    };
}

export function parseUniversalEntityQuery(query) {
    const raw = normalizeSearchQuery(query);
    if (!raw) return null;
    const dateIntent = parseStructuredDateWindow(raw);

    let predicate = '';
    let subject = '';
    let roleText = '';

    // 1. "[Who/What is/was the] [Predicate] of/for/in [Subject]?"
    const ofMatch = raw.match(/^(?:(?:who|what)\s+(?:is|was|are|were)\s+)?(?:the\s+)?(?:current\s+|latest\s+)?(.+?)\s+(?:of|for|in|during)\s+(.+?)[?.!]*$/i);
    if (ofMatch && ofMatch[1] && ofMatch[2]) {
        predicate = cleanPredicateText(ofMatch[1]);
        subject = cleanSubjectText(ofMatch[2]);
        roleText = ofMatch[1].trim();
    }

    // 2. "[Subject] [Predicate]" e.g. "Tamil Nadu CM", "Apollo 11 commander", "France president"
    if (!predicate || !subject) {
        const withoutLead = raw.replace(/^\s*(?:who|what)\s+(?:is|was|are|were)\s+(?:the\s+)?(?:current\s+|latest\s+)?/i, '').replace(/[?.!]+$/, '').trim();
        const words = withoutLead.split(/\s+/);
        if (words.length >= 2) {
            const lastTwo = words.slice(-2).join(' ');
            if (words.length >= 3 && /^(?:prime minister|chief minister|head of state|head of government|god of war|god of underworld)$/i.test(lastTwo)) {
                predicate = cleanPredicateText(lastTwo);
                subject = cleanSubjectText(words.slice(0, -2).join(' '));
                roleText = lastTwo;
            } else {
                const lastOne = words[words.length - 1];
                predicate = cleanPredicateText(lastOne);
                subject = cleanSubjectText(words.slice(0, -1).join(' '));
                roleText = lastOne;
            }
        }
    }

    if (!predicate || !subject || predicate.length < 2 || subject.length < 2) return null;

    let normalizedRole = predicate.toLowerCase();
    let property = 'P39';
    if (normalizedRole === 'cm') {
        normalizedRole = 'chief minister';
    } else if (normalizedRole === 'pm') {
        normalizedRole = 'prime minister';
        property = 'P6';
    } else if (normalizedRole === 'prime minister' || normalizedRole === 'head of government' || normalizedRole === 'premier' || normalizedRole === 'chancellor') {
        property = 'P6';
    } else if (normalizedRole === 'president' || normalizedRole === 'head of state' || normalizedRole === 'monarch') {
        property = 'P35';
    } else if (normalizedRole === 'ceo') {
        property = 'P169';
    }

    return {
        role: normalizedRole,
        roleText,
        jurisdiction: subject,
        property,
        ...(dateIntent?.hasDate ? { dateIntent } : {})
    };
}

export const parseGovernmentRoleQuery = parseUniversalEntityQuery;

function cleanPredicateText(value) {
    return stripDatePhrasesFromText(value)
        .replace(/^\s*(?:who|what)\s+(?:is|was|are|were)\s+(?:the\s+)?/i, ' ')
        .replace(/^\s*(?:the|a|an)\s+/i, ' ')
        .replace(/\b(current|latest|present|incumbent|official)\b/gi, ' ')
        .replace(/['’]s\b/gi, ' ')
        .replace(/^[,:\s]+|[,:\s?!.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function cleanSubjectText(value) {
    return stripDatePhrasesFromText(value)
        .replace(/^\s*(?:who|what)\s+(?:is|was|are|were)\s+(?:the\s+)?/i, ' ')
        .replace(/^\s*(?:the|a|an)\s+/i, ' ')
        .replace(/\b(current|latest|present|incumbent|official)\b/gi, ' ')
        .replace(/['’]s\b/gi, ' ')
        .replace(/^[,:\s]+|[,:\s?!.]+$/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function buildGovernmentRoleSparql(intent, jurisdictionId, limit = 3) {
    const qid = String(jurisdictionId || '').trim();
    if (!/^Q\d+$/.test(qid)) return '';
    const roleFilter = escapeSparqlString(intent.role);
    const directProps = intent.property === 'P35'
        ? ['P35', 'P488', 'P1037']
        : intent.property === 'P6'
            ? ['P6']
            : intent.property === 'P169'
                ? ['P169', 'P1037', 'P488']
                : [];
    const directBranches = directProps.map(prop => `{
  wd:${qid} p:${prop} ?statement.
  ?statement ps:${prop} ?holder.
  OPTIONAL { ?statement pq:P580 ?start. }
  OPTIONAL { ?statement pq:P582 ?end. }
  BIND("${escapeSparqlString(intent.role)}" AS ?officeLabel)
  BIND("p:${prop}" AS ?claimType)
}`);
    const directBranch = directBranches.join(' UNION ');
    const p39Branch = intent.organizationRole || directProps.length ? '' : `{
    ?holder p:P39 ?statement.
    ?statement ps:P39 ?office.
    OPTIONAL { ?statement pq:P580 ?start. }
    OPTIONAL { ?statement pq:P582 ?end. }
    ?office rdfs:label ?officeLabel.
    FILTER(LANG(?officeLabel) = "en")
    FILTER(CONTAINS(LCASE(STR(?officeLabel)), "${roleFilter}"))
    {
      ?office wdt:P1001 wd:${qid}.
    } UNION {
      ?office wdt:P17 wd:${qid}.
    }
    BIND("p:P39" AS ?claimType)
  }`;
    const branches = [directBranch, p39Branch].filter(Boolean).join(' UNION ');
    return `
SELECT ?holder ?holderLabel ?office ?officeLabel ?start ?end ?article ?claimType WHERE {
  ${branches}
  OPTIONAL {
    ?article schema:about ?holder;
      schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
ORDER BY DESC(?start)
LIMIT ${clampInt(limit, 3, 1, 6)}`;
}

function normalizeGovernmentRoleBindings(data, intent, jurisdiction, query) {
    const bindings = Array.isArray(data?.results?.bindings) ? data.results.bindings : [];
    const normalized = bindings
        .map((binding, index) => normalizeGovernmentRoleBinding(binding, intent, jurisdiction, query, index))
        .filter(item => item.title && item.url);
    return filterGovernmentRoleResultsByDate(normalized, intent?.dateIntent);
}

function normalizeGovernmentRoleBinding(binding, intent, jurisdiction, query, index) {
    let holderName = bindingValue(binding?.holderLabel);
    const holderUri = bindingValue(binding?.holder);
    const holderId = extractWikidataId(holderUri);
    const officeLabel = bindingValue(binding?.officeLabel) || intent.role;
    const article = bindingValue(binding?.article);
    if (!holderName || /^Q\d+$/i.test(holderName)) {
        if (article) {
            try {
                holderName = decodeURIComponent(article.replace(/^.*\/wiki\//, '').replace(/_/g, ' '));
            } catch (_) {}
        }
    }
    const startDate = normalizeWikidataDate(bindingValue(binding?.start));
    const endDate = normalizeWikidataDate(bindingValue(binding?.end));
    const url = holderId ? `https://www.wikidata.org/wiki/${holderId}` : holderUri;
    const description = [
        holderName && jurisdiction?.label ? `${holderName} is listed by Wikidata as ${officeLabel} for ${jurisdiction.label}.` : '',
        startDate ? `Start date: ${startDate}.` : '',
        endDate ? `End date: ${endDate}.` : '',
        article ? `Wikipedia: ${article}` : ''
    ].filter(Boolean).join(' ');
    return {
        title: holderName ? `${holderName} - ${officeLabel}` : officeLabel,
        description: description || `Structured Wikidata claim for current ${intent.role} of ${jurisdiction?.label || intent.jurisdiction}.`,
        url,
        domain: getDomainFromUrl(url),
        source: 'Wikidata',
        sourceType: 'structured_reference',
        sourceLabel: 'Wikidata structured role claim',
        date: startDate,
        freshness: endDate ? 'historical_structured_claim' : 'current_structured_claim',
        position: index + 1,
        trusted: true,
        qualitySignals: ['structured_entity_data', endDate ? 'dated_structured_claim' : 'current_office_claim', 'trusted_source'],
        evidenceLevel: 'structured_claim',
        role: intent.role,
        jurisdiction: jurisdiction?.label || intent.jurisdiction,
        holderName,
        wikidataId: holderId,
        wikipediaUrl: article || '',
        startDate,
        endDate,
        ...(intent?.dateIntent ? { dateIntent: intent.dateIntent } : {}),
        query
    };
}

export function parseStructuredDateWindow(query) {
    const raw = String(query || '').replace(/\s+/g, ' ').trim();
    if (!raw) return { hasDate: false };
    const month = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    const dayMonthYear = new RegExp(`\\b(?:on|as of|at|by)\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s+${month}\\s*,?\\s*(\\d{4})\\b`, 'i');
    const monthDayYear = new RegExp(`\\b(?:on|as of|at|by)\\s+${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(\\d{4})\\b`, 'i');
    const range = raw.match(/\b(?:between|from)\s+(\d{4})\s+(?:and|to|through|-)\s+(\d{4})\b/i);
    if (range) {
        const a = Number.parseInt(range[1], 10);
        const b = Number.parseInt(range[2], 10);
        if (isValidYear(a) && isValidYear(b)) {
            const startYear = Math.min(a, b);
            const endYear = Math.max(a, b);
            return {
                hasDate: true,
                kind: 'range',
                label: `${startYear}-${endYear}`,
                startDate: `${startYear}-01-01`,
                endDate: `${endYear}-12-31`,
                startYear,
                endYear
            };
        }
    }
    let exact = raw.match(dayMonthYear);
    if (exact) {
        const iso = buildIsoDate(Number.parseInt(exact[3], 10), monthIndex(exact[2]) + 1, Number.parseInt(exact[1], 10));
        if (iso) return { hasDate: true, kind: 'exact', label: formatDateLabel(iso), startDate: iso, endDate: iso };
    }
    exact = raw.match(monthDayYear);
    if (exact) {
        const iso = buildIsoDate(Number.parseInt(exact[3], 10), monthIndex(exact[1]) + 1, Number.parseInt(exact[2], 10));
        if (iso) return { hasDate: true, kind: 'exact', label: formatDateLabel(iso), startDate: iso, endDate: iso };
    }
    const asOfYear = raw.match(/\b(?:as of|by)\s+(\d{4})\b/i);
    if (asOfYear && isValidYear(Number.parseInt(asOfYear[1], 10))) {
        const year = Number.parseInt(asOfYear[1], 10);
        return { hasDate: true, kind: 'as_of_year', label: String(year), startDate: `${year}-12-31`, endDate: `${year}-12-31`, year };
    }
    const beforeYear = raw.match(/\bbefore\s+(\d{4})\b/i);
    if (beforeYear && isValidYear(Number.parseInt(beforeYear[1], 10))) {
        const year = Number.parseInt(beforeYear[1], 10);
        return { hasDate: true, kind: 'before', label: `before ${year}`, startDate: '0001-01-01', endDate: `${year - 1}-12-31`, year };
    }
    const afterYear = raw.match(/\bafter\s+(\d{4})\b/i);
    if (afterYear && isValidYear(Number.parseInt(afterYear[1], 10))) {
        const year = Number.parseInt(afterYear[1], 10);
        return { hasDate: true, kind: 'after', label: `after ${year}`, startDate: `${year + 1}-01-01`, endDate: '9999-12-31', year };
    }
    const yearMatch = raw.match(/\b(?:in|during|for)\s+(\d{4})\b/i);
    if (yearMatch && isValidYear(Number.parseInt(yearMatch[1], 10))) {
        const year = Number.parseInt(yearMatch[1], 10);
        return { hasDate: true, kind: 'year', label: String(year), startDate: `${year}-01-01`, endDate: `${year}-12-31`, year };
    }
    return { hasDate: false };
}

function stripDatePhrasesFromText(value) {
    const month = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
    return String(value || '')
        .replace(/\b(?:between|from)\s+\d{4}\s+(?:and|to|through|-)\s+\d{4}\b/gi, ' ')
        .replace(new RegExp(`\\b(?:on|as of|at|by)\\s+\\d{1,2}(?:st|nd|rd|th)?\\s+${month}\\s*,?\\s*\\d{4}\\b`, 'gi'), ' ')
        .replace(new RegExp(`\\b(?:on|as of|at|by)\\s+${month}\\s+\\d{1,2}(?:st|nd|rd|th)?\\s*,?\\s*\\d{4}\\b`, 'gi'), ' ')
        .replace(/\b(?:in|during|for|as of|by|before|after)\s+\d{4}\b/gi, ' ');
}

export function validateClaimTemporalStatus(item, referenceDate = new Date()) {
    const todayNum = compactDateNumber(referenceDate.toISOString().slice(0, 10));
    const startNum = compactDateNumber(item?.startDate);
    const endNum = compactDateNumber(item?.endDate);

    if (startNum && startNum > todayNum) return 'future';
    if (endNum && endNum < todayNum) return 'historical';
    if (startNum && (!endNum || endNum >= todayNum)) return 'current';
    if (!startNum && endNum) {
        return endNum >= todayNum ? 'current' : 'historical';
    }
    if (!startNum && !endNum) {
        if (item?.evidenceLevel === 'official_current_holder') return 'current';
        if (item?.freshness === 'current_structured_claim') return 'current';
        if (item?.freshness === 'historical_structured_claim') return 'historical';
    }
    return 'unknown';
}

export function isCurrentStateQuery(query) {
    const raw = normalizeSearchQuery(query);
    if (!raw) return false;
    const dateIntent = parseStructuredDateWindow(raw);
    if (dateIntent?.hasDate) return false;
    const isHistoricalTerm = /\b(was|were|former|previous|past|first|ex-|history|historical|earlier|ancient|mythological|mythology|myth|origin|invented|founded|created|discovered|painted|wrote|author|composer|during|died|buried)\b/i.test(raw);
    if (isHistoricalTerm) return false;
    return true;
}

function filterGovernmentRoleResultsByDate(results, dateIntent = null) {
    const list = Array.isArray(results) ? results : [];
    if (!dateIntent?.hasDate) {
        const current = list
            .filter(item => validateClaimTemporalStatus(item) === 'current')
            .sort(compareRoleClaimsForCurrent);
        const nonCurrent = list
            .filter(item => validateClaimTemporalStatus(item) !== 'current')
            .sort(compareRoleClaimsForCurrent);
        return [...current, ...nonCurrent].map((item, index) => ({ ...item, position: index + 1 }));
    }
    const filtered = list
        .filter(item => roleClaimOverlapsWindow(item, dateIntent))
        .sort(compareRoleClaimsForDateWindow);
    return filtered.map((item, index) => ({ ...item, position: index + 1, dateIntent }));
}

export function roleClaimOverlapsWindow(item, dateIntent) {
    if (!dateIntent?.hasDate) return true;
    const windowStart = compactDateNumber(dateIntent.startDate);
    const windowEnd = compactDateNumber(dateIntent.endDate);
    if (!windowStart || !windowEnd) return false;
    const claimStart = compactDateNumber(item?.startDate) || 1;
    const claimEnd = compactDateNumber(item?.endDate) || 99991231;
    return claimStart <= windowEnd && claimEnd >= windowStart;
}

function compareRoleClaimsForCurrent(a, b) {
    const aStatus = validateClaimTemporalStatus(a);
    const bStatus = validateClaimTemporalStatus(b);
    if (aStatus === 'current' && bStatus !== 'current') return -1;
    if (bStatus === 'current' && aStatus !== 'current') return 1;
    if (aStatus === 'historical' && bStatus !== 'historical') return 1;
    if (bStatus === 'historical' && aStatus !== 'historical') return -1;
    return (compactDateNumber(b?.startDate) || 0) - (compactDateNumber(a?.startDate) || 0);
}

function compareRoleClaimsForDateWindow(a, b) {
    return (compactDateNumber(a?.startDate) || 0) - (compactDateNumber(b?.startDate) || 0);
}

function compactDateNumber(value) {
    const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return 0;
    return Number(`${match[1]}${match[2]}${match[3]}`);
}

function isValidYear(year) {
    return Number.isInteger(year) && year >= 1 && year <= 9999;
}

function monthIndex(value) {
    const key = String(value || '').slice(0, 3).toLowerCase();
    return ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(key);
}

function buildIsoDate(year, month, day) {
    if (!isValidYear(year) || month < 1 || month > 12 || day < 1 || day > 31) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function formatDateLabel(isoDate) {
    const [year, month, day] = String(isoDate || '').split('-');
    if (!year || !month || !day) return String(isoDate || '');
    const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1] || month;
    return `${Number(day)} ${monthName} ${year}`;
}

function scoreWikidataEntityCandidate(query, item, index) {
    const q = String(query || '').toLowerCase();
    const label = String(item?.label || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    let score = Math.max(0, 20 - index);
    if (label === q) score += 30;
    if (label.includes(q) || q.includes(label)) score += 12;
    if (/\b(country|sovereign state|state|province|city|municipality|administrative territorial entity|federal state|company|corporation|enterprise|business|technology company|multinational|financial institution|organization|international organization)\b/.test(description)) {
        score += 15;
    }
    if (/\b(fruit|species|plant|taxon|organism|disambiguation|family name|given name|film|song|album|book|video game)\b/.test(description)) {
        score -= 25;
    }
    return score;
}

function bindingValue(binding) {
    return String(binding?.value || '').trim();
}

function extractWikidataId(value) {
    const match = String(value || '').match(/\bQ\d+\b/);
    return match ? match[0] : '';
}

function normalizeWikidataDate(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : raw;
}

function escapeRegex(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function escapeSparqlString(value) {
    return String(value || '').toLowerCase().replace(/["\\]/g, '\\$&');
}

function normalizeRedditItem(item, query, index) {
    const permalink = String(item?.permalink || '').trim();
    const url = permalink
        ? `https://www.reddit.com${permalink}`
        : String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    const createdUtc = Number(item?.created_utc);
    const date = Number.isFinite(createdUtc) && createdUtc > 0
        ? new Date(createdUtc * 1000).toISOString()
        : '';
    const subreddit = String(item?.subreddit_name_prefixed || item?.subreddit || '').trim();
    return {
        title: String(item?.title || '').replace(/\s+/g, ' ').trim(),
        description: [
            subreddit ? `Community discussion: ${subreddit}` : 'Community discussion on Reddit.',
            Number.isFinite(Number(item?.score)) ? `Score: ${Number(item.score)}` : '',
            Number.isFinite(Number(item?.num_comments)) ? `Comments: ${Number(item.num_comments)}` : ''
        ].filter(Boolean).join(' | '),
        url,
        domain,
        source: subreddit || 'Reddit',
        sourceType: 'community_discussion',
        sourceLabel: subreddit ? `${subreddit} on Reddit` : 'Reddit',
        date,
        freshness: date ? 'community_dated' : 'community',
        position: index + 1,
        trusted: false,
        qualitySignals: ['public_discussion', 'community_source'],
        query
    };
}

function buildReferenceLookupResults(query, offset = 0) {
    const cleanQuery = normalizeSearchQuery(query);
    if (!cleanQuery) return [];
    const encoded = encodeURIComponent(cleanQuery);
    return [
        {
            title: `Britannica search: ${cleanQuery}`,
            description: 'Reference lookup on Britannica. Use to cross-check encyclopedia-style background.',
            url: `${BRITANNICA_SEARCH_URL}?query=${encoded}`,
            source: 'Britannica',
            sourceType: 'reference_lookup',
            sourceLabel: 'Britannica',
            qualitySignals: ['reference_lookup', 'encyclopedia_cross_check']
        },
        {
            title: `archive.today search: ${cleanQuery}`,
            description: 'Archive lookup for saved snapshots. Useful when a source page changed or disappeared.',
            url: `${ARCHIVE_TODAY_SEARCH_URL}?q=${encoded}`,
            source: 'archive.today',
            sourceType: 'archive_lookup',
            sourceLabel: 'archive.today',
            qualitySignals: ['archive_lookup', 'snapshot_cross_check']
        }
    ].map((item, index) => ({
        ...item,
        domain: getDomainFromUrl(item.url),
        date: '',
        freshness: 'lookup',
        position: offset + index + 1,
        trusted: item.source === 'Britannica',
        query: cleanQuery
    }));
}

async function normalizeOfficialSourceCandidate(item, query, index) {
    const domain = getDomainFromUrl(item.url);
    const exactShortcutMatch = Boolean(item.pattern?.test?.(query));
    const allowHtmlFallback = false;
    const page = await fetchOfficialPageContent(item.url, query, { allowHtmlFallback }).catch(() => null);
    const roleEvidence = page?.text ? extractOfficialCurrentRoleEvidence(page.text, query, item.url) : null;
    return {
        title: page?.title || item.label,
        description: page?.description || `Official source for ${item.label.replace(/\s+official$/i, '')} updates and primary information.`,
        url: item.url,
        domain,
        source: item.label,
        sourceType: 'official_source',
        sourceLabel: item.label,
        date: '',
        freshness: page?.fetched ? 'official_page_fetched' : 'official_homepage_unverified',
        position: index + 1,
        trusted: true,
        pageFetched: Boolean(page?.fetched),
        exactShortcutMatch,
        evidenceLevel: roleEvidence ? 'official_current_holder' : (page?.fetched ? 'official_page' : 'unverified_link'),
        qualitySignals: [
            'official_source',
            'trusted_domain',
            page?.fetched ? 'page_fetched' : 'page_not_fetched',
            page?.extractor,
            item.discoverySignal,
            roleEvidence ? 'current_office_claim' : ''
        ].filter(Boolean),
        officialConfidence: item.officialConfidence || inferOfficialConfidence(item.url, item),
        holderName: roleEvidence?.holderName || '',
        role: roleEvidence?.role || '',
        jurisdiction: roleEvidence?.jurisdiction || '',
        extractedClaim: roleEvidence?.claim || '',
        extractor: page?.extractor || '',
        query
    };
}

async function fetchOfficialPageContent(url, query = '', options = {}) {
    const crawled = await fetchOfficialPageContentWithCrawl4Ai(url, query).catch(() => null);
    if (crawled) return crawled;
    if (!options.allowHtmlFallback) return null;

    const response = await fetchWithTimeout(url, {
        headers: {
            Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
            'User-Agent': 'JARVISAssistant/1.0 public-source-search'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return null;
    const html = await response.text();
    const title = extractHtmlTitle(html) || getDomainFromUrl(url) || 'Official source';
    const description = extractHtmlDescription(html) || extractReadableHtmlText(html).slice(0, 320);
    if (!description || description.length < 20) return null;
    return {
        fetched: true,
        title: title.slice(0, 220),
        description: description.replace(/\s+/g, ' ').trim().slice(0, 420),
        text: extractReadableHtmlText(html).replace(/\s+/g, ' ').trim().slice(0, 4000),
        extractor: 'html_fetched'
    };
}

async function fetchOfficialPageContentWithCrawl4Ai(url, query = '') {
    if (!hasCrawl4AiConfig()) return null;
    const result = await extractWithCrawl4Ai({
        url,
        query,
        textLimit: 4000,
        timeoutMs: PUBLIC_SOURCE_TIMEOUT_MS,
        respectRobots: true
    });
    const title = String(result?.title || getDomainFromUrl(url) || 'Official source').replace(/\s+/g, ' ').trim();
    const description = String(result?.description || result?.text || result?.markdown || '')
        .replace(/[#*_>`~\[\]()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!description || description.length < 20) return null;
    return {
        fetched: true,
        title: title.slice(0, 220),
        description: description.slice(0, 420),
        text: String(result?.text || result?.markdown || description).replace(/\s+/g, ' ').trim().slice(0, 4000),
        extractor: 'crawl4ai_extracted'
    };
}

function normalizeSerperResults(data, query) {
    const organic = Array.isArray(data?.organic) ? data.organic : [];
    const news = Array.isArray(data?.news) ? data.news : [];
    return [...organic, ...news]
        .map((item, index) => normalizeSerperItem(item, query, index))
        .filter(item => item.title && item.url);
}

function normalizeSerperItem(item, query, index) {
    const url = String(item?.link || item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    return {
        title: String(item?.title || '').trim(),
        description: String(item?.snippet || item?.description || '').trim(),
        url,
        domain,
        source: String(item?.source || domain || 'web').trim(),
        sourceType: isTrustedLiveSource(domain) ? 'trusted_web' : 'web',
        sourceLabel: String(item?.source || domain || 'web').trim(),
        date: String(item?.date || '').trim(),
        freshness: String(item?.date || '').trim() ? 'dated' : 'unknown',
        position: Number.isFinite(Number(item?.position)) ? Number(item.position) : index + 1,
        trusted: isTrustedLiveSource(domain),
        qualitySignals: [
            'serper',
            isTrustedLiveSource(domain) ? 'trusted_domain' : ''
        ].filter(Boolean),
        query
    };
}

function normalizeExaResults(data, query, queryIndex = 0) {
    const results = Array.isArray(data?.results) ? data.results : [];
    return results
        .map((item, index) => normalizeExaItem(item, query, (queryIndex * 20) + index))
        .filter(item => item.title && item.url);
}

function normalizeExaItem(item, query, index) {
    const url = String(item?.url || '').trim();
    const domain = getDomainFromUrl(url);
    const text = String(item?.text || item?.highlights?.join(' ') || '').replace(/\s+/g, ' ').trim();
    const summary = String(item?.summary || item?.content || item?.snippet || '').replace(/\s+/g, ' ').trim();
    const description = (summary || text || String(item?.title || '')).slice(0, 520);
    return {
        title: String(item?.title || domain || 'Exa result').replace(/\s+/g, ' ').trim(),
        description,
        text: text.slice(0, 4000),
        url,
        domain,
        source: domain || 'Exa',
        sourceType: isTrustedLiveSource(domain) ? 'exa_trusted_web' : 'exa_web',
        sourceLabel: domain ? `${domain} via Exa` : 'Exa',
        date: String(item?.publishedDate || item?.published_date || item?.date || '').trim(),
        freshness: String(item?.publishedDate || item?.published_date || item?.date || '').trim() ? 'dated' : 'unknown',
        position: index + 1,
        trusted: isTrustedLiveSource(domain),
        qualitySignals: [
            'exa_search',
            isTrustedLiveSource(domain) ? 'trusted_domain' : ''
        ].filter(Boolean),
        query
    };
}

function dedupeSearchResults(results) {
    const seen = new Set();
    const deduped = [];
    for (const item of Array.isArray(results) ? results : []) {
        const key = normalizeResultKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
    }
    return deduped;
}

function buildSearchSummary(results, metadata = {}) {
    const query = String(metadata.query || '').trim();
    const summaryResults = filterSearchResultsForAnswerQuery(query, results);
    const distinctDomains = Array.from(new Set(summaryResults.map(item => item.domain).filter(Boolean)));
    const trustedCount = summaryResults.filter(item => item.trusted).length;
    const directAnswer = buildSourceDerivedAnswer(summaryResults, { ...metadata, query });
    return {
        results: summaryResults,
        answer: directAnswer.answer || undefined,
        answerProvider: directAnswer.provider || undefined,
        distinctDomains,
        trustedCount,
        sourceCount: summaryResults.length,
        answerEvidenceCount: summaryResults.filter(isAnswerEvidenceResult).length,
        distinctDomainCount: distinctDomains.length,
        provider: metadata.provider || 'public_sources',
        publicSourceCount: Number(metadata.publicSourceCount) || 0,
        geminiEnhanced: Boolean(metadata.geminiEnhanced),
        warnings: Array.from(new Set((metadata.warnings || []).filter(Boolean))),
        refreshed: Boolean(metadata.refreshed)
    };
}

function filterSearchResultsForAnswerQuery(query, results) {
    const list = Array.isArray(results) ? results : [];
    const isLeadershipQuery = /\b(who\s+is\s+the\s+)?(cm|chief minister|prime minister|pm|president|governor|mayor|ceo|leader|head of state|head of government)\b/i.test(query);
    const isExplicitElectionQuery = /\b(election|polls?|candidates?|voting)\b/i.test(query);

    let candidates = list;
    if (isLeadershipQuery && !isExplicitElectionQuery) {
        // Exclude future/speculative election predictions or party campaign promotional spam from current office holder queries
        candidates = list.filter(item => {
            const title = String(item?.title || '').toLowerCase();
            const desc = String(item?.description || '').toLowerCase();
            if (/\b(?:202[6-9]|upcoming|next)\s+(?:assembly\s+)?(?:election|legislative assembly election|opinion poll|exit poll|candidates?\s+list)\b/i.test(title)) {
                return false;
            }
            if (/\b(?:all set to swear in|will swear in|predicted to win|landslide victory in 202[6-9])\b/i.test(desc)) {
                return false;
            }
            return true;
        });
        if (!candidates.length) candidates = list;
    }

    const discovery = parseDiscoveryFactQuery(query);
    if (!discovery) return candidates;
    const filtered = candidates.filter(item => isDiscoveryAnswerSource(discovery, item));
    return filtered.length ? filtered : candidates.filter(item => isValidCitationSource(item, query));
}

function buildSourceDerivedAnswer(results, metadata = {}) {
    const list = Array.isArray(results) ? results : [];
    const query = String(metadata.query || list.find(item => item?.query)?.query || '').trim();
    const roleIntent = parseGovernmentRoleQuery(query);
    const structuredRole = list
        .filter(item => item?.evidenceLevel === 'structured_claim' && item?.holderName && item?.role && item?.jurisdiction && item?.url);
    if (structuredRole.length) {
        return buildStructuredRoleAnswer(structuredRole, roleIntent);
    }
    const officialRole = list
        .find(item => item?.evidenceLevel === 'official_current_holder' && item?.holderName && item?.role && item?.jurisdiction && item?.url);
    if (officialRole) {
        const holder = String(officialRole.holderName || '').trim();
        const role = String(officialRole.role || '').trim();
        const jurisdiction = String(officialRole.jurisdiction || '').trim();
        const sourceLabel = String(officialRole.sourceLabel || officialRole.domain || 'official source').trim();
        if (holder && role && jurisdiction) {
            return {
                answer: `${holder} is listed by ${sourceLabel} as current ${role} for ${jurisdiction}.`,
                provider: 'official_crawled_current_holder'
            };
        }
    }
    if (roleIntent && /^(?:cm|chief minister|prime minister|pm|president|governor|mayor|leader|head of state|head of government|ceo|captain|coach)$/i.test(roleIntent.role)) return {};

    const top = list.find(item => isAnswerEvidenceResult(item) && isAcceptableSourceDerivedAnswer(query, item));
    if (!top) return {};
    const sourceType = String(top.sourceType || '').trim();
    const title = String(top.title || '').replace(/\s+/g, ' ').trim();
    const description = String(top.description || '').replace(/\s+/g, ' ').trim();
    const sourceLabel = String(top.sourceLabel || top.source || top.domain || '').replace(/\s+/g, ' ').trim();
    if (!title && !description) return {};

    if (sourceType === 'free_weather') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'open_meteo_source');
    }
    if (sourceType === 'free_crypto_price') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'coingecko_source');
    }
    if (sourceType === 'free_disaster_event') {
        const date = String(top.date || '').trim();
        return sourceAnswer(`${title}${date ? ` (${date.slice(0, 10)})` : ''}${description ? `: ${description}` : ''}`, 'nasa_eonet_source');
    }
    if (sourceType === 'free_reference' || sourceType === 'free_place_data') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'public_place_source');
    }
    if (sourceType === 'free_sports_reference') {
        return sourceAnswer(`${title}${description ? `: ${description}` : ''}`, 'sports_reference_source');
    }
    if (sourceType === 'cached_latest') {
        return sourceAnswer(`${title}${sourceLabel ? ` (${sourceLabel})` : ''}${description ? `: ${description}` : ''}`, 'latest_cache_source');
    }
    if (/^(official_source|trusted_news|public_news|encyclopedia|structured_reference)$/.test(sourceType)) {
        const isSpecificEntityQuestion = /\b(?:who\s+(?:won|is|was)|what\s+(?:is|was)|which\s+team|how\s+many|where\s+is)\b/i.test(query);
        if (!isSpecificEntityQuestion || /^(official_source|encyclopedia)$/.test(sourceType)) {
            const cleanTitle = cleanXmlEntities(title);
            const cleanDesc = cleanXmlEntities(description);
            return sourceAnswer(`${cleanTitle}${cleanDesc ? `: ${cleanDesc}` : ''}`, 'public_source_result');
        }
    }
    return {};
}

function buildStructuredRoleAnswer(results, roleIntent = null) {
    const list = (Array.isArray(results) ? results : [])
        .filter(item => item?.holderName && item?.role && item?.jurisdiction && item?.url);
    if (!list.length) return {};
    const role = String(list[0].role || roleIntent?.role || '').trim();
    const jurisdiction = String(list[0].jurisdiction || roleIntent?.jurisdiction || '').trim();
    if (!role || !jurisdiction) return {};
    const dateIntent = list[0].dateIntent || roleIntent?.dateIntent || null;
    if (dateIntent?.hasDate) {
        const matching = list.filter(item => roleClaimOverlapsWindow(item, dateIntent));
        const chosenList = matching.length ? matching : list;
        const prefix = buildDateSpecificAnswerPrefix(dateIntent);
        const holdersWithRanges = chosenList.slice(0, 4).map(item => {
            const holder = String(item.holderName || '').trim();
            const range = formatClaimDateRange(item);
            return { holder, range };
        }).filter(item => item.holder);
        if (!holdersWithRanges.length) return {};
        if (holdersWithRanges.length === 1) {
            const { holder, range } = holdersWithRanges[0];
            const detail = range ? ` Source dates: ${range}.` : '';
            return {
                answer: `${prefix}, the ${role} of ${jurisdiction} was ${holder}.${detail}`,
                provider: 'wikidata_dated_structured_claim'
            };
        }
        const values = holdersWithRanges
            .map(item => item.range ? `${item.holder} (${item.range})` : item.holder)
            .join('; ');
        return {
            answer: `${prefix}, the ${role} of ${jurisdiction} had these matching Wikidata claims: ${values}.`,
            provider: 'wikidata_dated_structured_claim'
        };
    }
    const currentClaims = list.filter(item => validateClaimTemporalStatus(item) === 'current');
    const top = currentClaims.length ? currentClaims[0] : list[0];
    const holder = String(top.holderName || '').trim();
    if (!holder) return {};
    const startDate = String(top.startDate || '').trim();
    const startText = startDate ? ` Start date: ${startDate}.` : '';
    const today = new Date().toISOString().slice(0, 10);
    return {
        answer: `As of ${today}, ${holder} is listed by Wikidata as current ${role} for ${jurisdiction}.${startText}`,
        provider: 'wikidata_structured_claim'
    };
}

function buildDateSpecificAnswerPrefix(dateIntent) {
    if (dateIntent?.kind === 'exact') return `On ${dateIntent.label}`;
    if (dateIntent?.kind === 'range') return `Between ${dateIntent.label}`;
    if (dateIntent?.kind === 'before' || dateIntent?.kind === 'after') return `For ${dateIntent.label}`;
    return `In ${dateIntent?.label || 'that period'}`;
}

function formatClaimDateRange(item) {
    const start = String(item?.startDate || '').trim();
    const end = String(item?.endDate || '').trim();
    if (start && end) return `${start} to ${end}`;
    if (start) return `${start} onward`;
    if (end) return `until ${end}`;
    return '';
}

function sourceAnswer(text, provider) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return {};
    return {
        answer: clean.endsWith('.') ? clean : `${clean}.`,
        provider
    };
}

function parseDiscoveryFactQuery(query) {
    const lower = String(query || '').toLowerCase().replace(/[?.!]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!lower) return null;
    const match =
        lower.match(/^(?:who\s+)?(?:discovered|invented|founded|created)\s+(.+)$/) ||
        lower.match(/^(?:who\s+was\s+)?(?:the\s+)?(?:discoverer|inventor|founder|creator)\s+of\s+(.+)$/) ||
        lower.match(/^(.+?)\s+(?:discoverer|inventor|founder|creator)$/);
    if (!match?.[1]) return null;
    const subject = match[1]
        .replace(/\b(?:the|a|an)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!subject || subject.length > 90) return null;
    return { subject, relation: 'discovery' };
}

function isAcceptableSourceDerivedAnswer(query, item) {
    const discovery = parseDiscoveryFactQuery(query);
    if (!discovery) return true;
    return isDiscoveryAnswerSource(discovery, item);
}

function isDiscoveryAnswerSource(discovery, item) {
    const subject = String(discovery?.subject || '').toLowerCase();
    if (!subject) return false;
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    const hay = `${title} ${description}`;
    const subjectTerms = tokenize(subject).filter(term => term.length > 2);
    if (!subjectTerms.length) return false;
    const subjectHit = subjectTerms.every(term => hay.includes(term));
    if (!subjectHit) return false;
    if (/\b(discover|discovered|discovery|invent|invented|invention|founder|founded|created|creator)\b/.test(hay)) return true;
    return title.includes(subject);
}

async function refreshLatestCacheIfStale(options = {}) {
    const now = Date.now();
    if (!options.forceRefresh && now - lastLatestRefreshAt < LATEST_REFRESH_INTERVAL_MS) return false;
    lastLatestRefreshAt = now;
    try {
        await ingestLatestSources({ timeoutMs: clampInt(options.timeoutMs, 2500, 1000, 5000) });
        return true;
    } catch (_) {
        return false;
    }
}

function normalizeLatestCacheResult(item) {
    const domain = getDomainFromUrl(item.url);
    return {
        title: item.title,
        description: item.summary,
        url: item.url,
        domain,
        source: item.source || domain || 'latest cache',
        sourceType: 'cached_latest',
        sourceLabel: item.source || domain || 'Latest cache',
        date: item.publishedAt || '',
        freshness: item.publishedAt ? 'cached_recent' : 'cached',
        position: 0,
        trusted: true,
        qualitySignals: ['rss_atom_cache', 'free_source'],
        query: ''
    };
}

function buildWebRagQueryPhases(query, plannedQueries = []) {
    const normalized = normalizeSearchQuery(query);
    const roleIntent = parseGovernmentRoleQuery(normalized);
    const rewrite = buildSearchQueryRewrite(normalized);
    const subject = roleIntent?.jurisdiction || rewrite.subject || extractSearchSubject(normalized) || normalized;
    const role = roleIntent?.role || extractSearchIntentTerm(normalized);

    const targeted = roleIntent ? [
        `${subject} current ${role}`,
        `${subject} ${role} 2026`,
        `${subject} ${role}`,
        `${subject} ${role} official`,
        `${subject} ${role} Wikipedia`
    ] : [];

    const broad = Array.from(new Set([
        normalized,
        ...targeted,
        ...buildDeterministicSearchQueries(normalized),
        ...plannedQueries.map(item => normalizeSearchQuery(item)).filter(Boolean)
    ].filter(Boolean))).slice(0, 6);

    const officialReference = Array.from(new Set([
        `${normalized} official source`,
        `${subject} official`,
        `${normalized} Wikipedia Wikidata`,
        `${subject} current source`
    ].map(normalizeSearchQuery).filter(Boolean))).slice(0, 5);

    return [
        targeted.length ? targeted.slice(0, 4) : [normalized],
        broad,
        officialReference
    ].filter(phase => phase.length);
}

function evaluateWebRagEvidence(query, results = []) {
    const evidence = (Array.isArray(results) ? results : [])
        .filter(item => isValidCitationSource(item, query))
        .filter(item => isRelatedToQuery(query, item));
    const roleIntent = parseGovernmentRoleQuery(query);
    const isCurrent = isCurrentStateQuery(query);

    let explicitEvidence = evidence;
    if (roleIntent) {
        const targetSubject = (roleIntent.subject || roleIntent.jurisdiction || '').toLowerCase();
        const targetPredicate = (roleIntent.predicate || roleIntent.role || '').toLowerCase();
        const subjectTokens = tokenize(targetSubject).filter(t => t.length > 2);
        const predicateTokens = tokenize(targetPredicate).filter(t => t.length > 2);

        explicitEvidence = evidence.filter(item => {
            const text = `${item.title} ${item.description || ''} ${item.fullArticleText || ''}`.toLowerCase();
            const hasSubject = !targetSubject || text.includes(targetSubject) || subjectTokens.some(t => text.includes(t));
            if (!hasSubject) return false;

            if (item.evidenceLevel === 'structured_claim') return true;

            const hasPredicate = !targetPredicate || text.includes(targetPredicate) || predicateTokens.some(t => text.includes(t));
            if (hasPredicate) {
                if (isCurrent) {
                    return validateClaimTemporalStatus(item) !== 'historical';
                }
                return true;
            }
            return false;
        });
    }

    const effectiveEvidence = (roleIntent && explicitEvidence.length) ? explicitEvidence : evidence;
    const domains = Array.from(new Set(effectiveEvidence.map(item => {
        if (item.sourceLabel && item.sourceLabel.startsWith('Google News / ')) {
            return item.sourceLabel.replace('Google News / ', '').trim();
        }
        return item.domain;
    }).filter(Boolean)));
    const strong = effectiveEvidence.filter(isStrongRagEvidenceSource);
    const dated = effectiveEvidence.filter(item => String(item.date || item.startDate || item.endDate || '').trim());
    const conflict = hasObviousRagConflict(effectiveEvidence, query);
    const confidence = Math.min(0.99, (strong.length ? 0.74 : 0.6) + (domains.length >= 2 ? 0.2 : 0.1) + (dated.length ? 0.05 : 0));
    
    const pass = !conflict && (
        (explicitEvidence.length >= 1) ||
        (evidence.length >= 2) ||
        (strong.length >= 1 && evidence.length >= 1)
    );

    return {
        pass,
        conflict,
        confidence: pass ? Math.max(0.86, confidence) : Math.min(0.6, confidence),
        evidence: effectiveEvidence,
        reason: conflict
            ? 'Retrieved sources conflict.'
            : pass
                ? ''
                : (roleIntent
                    ? `I couldn't verify the ${roleIntent.predicate || roleIntent.role || 'information'} from reliable live sources.`
                    : 'Insufficient authoritative retrieved evidence.')
    };
}

async function rankRagResultsWithEmbeddings(query, results = []) {
    if (!hasNvidiaEmbeddingKey() || !Array.isArray(results) || results.length < 1) {
        return { available: false, ranked: results, model: '' };
    }
    const chunkItems = [];
    for (const item of results.slice(0, 12)) {
        const sourceText = [
            item.title,
            item.description,
            item.extractedText,
            item.text
        ].filter(Boolean).join('. ');
        const chunks = chunkTextForEmbedding(sourceText, { maxChunks: 3, maxChars: 1200 });
        chunks.forEach((chunk, chunkIndex) => {
            chunkItems.push({
                title: item.title,
                description: item.description,
                url: item.url,
                domain: item.domain,
                sourceType: item.sourceType,
                sourceLabel: item.sourceLabel,
                date: item.date || '',
                trusted: item.trusted,
                evidenceLevel: item.evidenceLevel,
                qualitySignals: item.qualitySignals || [],
                text: chunk,
                chunkIndex
            });
        });
    }
    const rankedChunks = await rankTextsByEmbedding(query, chunkItems);
    if (!rankedChunks.available) return { available: false, ranked: results, model: rankedChunks.model || '' };
    const byUrl = new Map();
    for (const chunk of rankedChunks.ranked) {
        const key = String(chunk.url || '').trim();
        if (!key || byUrl.has(key)) continue;
        const source = results.find(item => item.url === key) || chunk;
        byUrl.set(key, {
            ...source,
            embeddingScore: chunk.embeddingScore,
            embeddingChunk: chunk.text
        });
    }
    const ranked = [
        ...byUrl.values(),
        ...results.filter(item => item?.url && !byUrl.has(item.url))
    ];
    return {
        available: true,
        ranked,
        model: rankedChunks.model
    };
}

async function rerankRagResults(query, results = []) {
    if (!Array.isArray(results) || results.length < 1) {
        return { available: false, ranked: results, model: getNvidiaRerankModel() };
    }
    const candidates = results.slice(0, 20).map(item => ({
        ...item,
        text: String(item.embeddingChunk || item.extractedText || item.description || item.title || '')
            .replace(/\s+/g, ' ')
            .trim()
    }));
    const reranked = await rerankTexts(query, candidates);
    if (!reranked.available) {
        return { available: false, ranked: results, model: reranked.model || getNvidiaRerankModel() };
    }
    const seen = new Set();
    const ranked = [];
    for (const item of reranked.ranked) {
        const key = String(item.url || item.title || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        ranked.push(item);
    }
    for (const item of results) {
        const key = String(item.url || item.title || '').trim();
        if (!key || seen.has(key)) continue;
        seen.add(key);
        ranked.push(item);
    }
    return {
        available: true,
        ranked,
        model: reranked.model
    };
}

function isStrongRagEvidenceSource(item) {
    const sourceType = String(item?.sourceType || '').trim();
    const domain = String(item?.domain || '').toLowerCase();
    if (item?.evidenceLevel === 'structured_claim') return true;
    if (sourceType === 'official_source' && item?.pageFetched) return true;
    if (item?.trusted && !/reddit|archive\.(today|ph|is)/i.test(domain)) return true;
    return /(?:\.gov$|\.gov\.|\.go\.|gov\.|wikipedia\.org$|wikidata\.org$|bbc\.com$|reuters\.com$|apnews\.com$|thehindu\.com$)/i.test(domain);
}

export function hasObviousRagConflict(evidence = [], query = '') {
    const list = Array.isArray(evidence) ? evidence : [];
    const claims = list.filter(item => item?.holderName && item?.role && item?.jurisdiction);
    if (claims.length < 2) return false;

    const isCurrent = isCurrentStateQuery(query);
    const byRoleJurisdiction = new Map();
    for (const claim of claims) {
        const key = `${String(claim.role || '').toLowerCase()}:::${String(claim.jurisdiction || '').toLowerCase()}`;
        if (!byRoleJurisdiction.has(key)) byRoleJurisdiction.set(key, []);
        byRoleJurisdiction.get(key).push(claim);
    }

    for (const [key, group] of byRoleJurisdiction.entries()) {
        const distinctHolders = Array.from(new Set(group.map(item => String(item.holderName || '').toLowerCase().trim()))).filter(Boolean);
        if (distinctHolders.length <= 1) continue;

        if (isCurrent) {
            // Temporal succession resolution:
            const currentClaims = group.filter(item => validateClaimTemporalStatus(item) === 'current');
            const currentDistinctHolders = Array.from(new Set(currentClaims.map(item => String(item.holderName || '').toLowerCase().trim())));

            if (currentDistinctHolders.length === 1) {
                // Resolved via temporal succession: exactly 1 current holder, others are historical predecessors
                continue;
            }
            if (currentDistinctHolders.length > 1) {
                // Competing concurrent current claims: genuine conflict!
                return true;
            }
            const unknownClaims = group.filter(item => validateClaimTemporalStatus(item) === 'unknown');
            if (unknownClaims.length > 1) {
                return true;
            }
        } else {
            const dateIntent = parseStructuredDateWindow(query);
            if (dateIntent?.hasDate) {
                const matchingClaims = group.filter(item => roleClaimOverlapsWindow(item, dateIntent));
                const matchingHolders = Array.from(new Set(matchingClaims.map(item => String(item.holderName || '').toLowerCase().trim())));
                if (matchingHolders.length > 1) {
                    return true;
                }
            }
        }
    }

    return false;
}

function extractDeterministicLiveFactAnswer(query, evidence = []) {
    if (!Array.isArray(evidence) || !evidence.length) return null;
    const isCurrent = isCurrentStateQuery(query);
    const isRoleQuery = /\b(cm|chief minister|president|prime minister|pm|governor|mayor|leader|head of state|head of government|ceo|captain|skipper|coach)\b/i.test(query);
    const isDefinitionRegex = /\b(is the head of (?:the )?government|is the leader of the (?:state )?cabinet|is the head of the executive|is the highest-ranking executive|is an elected or appointed official|refers to the office|is a constitutional position|debut franchises|Twenty20 cricket team based in|cricket franchise)\b/i;

    const sorted = [...evidence].sort((a, b) => {
        if (isCurrent) {
            const aStatus = validateClaimTemporalStatus(a);
            const bStatus = validateClaimTemporalStatus(b);
            if (aStatus === 'current' && bStatus !== 'current') return -1;
            if (bStatus === 'current' && aStatus !== 'current') return 1;
            if (aStatus === 'historical' && bStatus !== 'historical') return 1;
            if (bStatus === 'historical' && aStatus !== 'historical') return -1;
        }
        return (b?.position || 0) - (a?.position || 0);
    });

    for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        if (isCurrent && isRoleQuery && validateClaimTemporalStatus(item) === 'historical') {
            continue; // Do not let historical claim become direct answer for a current-state query
        }

        if (item.evidenceLevel === 'structured_claim') {
            const derived = buildSourceDerivedAnswer([item], { query });
            return {
                verified: true,
                confidence: 0.95,
                answer: derived?.answer || item.description || item.title,
                evidenceIndexes: [i],
                modelAssisted: false,
                reason: `Extracted from structured reference data: ${item.sourceLabel || item.domain}`
            };
        }

        const text = `${item.title}. ${item.description || ''}`.trim();
        if (text.length > 15) {
            if (isRoleQuery && isDefinitionRegex.test(text)) {
                continue; // Skip generic dictionary definitions of the office or franchise
            }
            if (/\b(?:makes bold claim|bold claim|predicts?|suggests?|speculates?|opinion|rumor|rumour|will captain|could captain|urges?|dances after|net practice|WATCH)\b/i.test(text)) {
                continue; // Skip clickbait and opinion speculation
            }

            if (isRoleQuery) {
                continue; // Defer unstructured text synthesis to buildGroundedRagAnswer
            }

            let chosenAnswer = item.description && item.description.length > 25 && !isDefinitionRegex.test(item.description)
                ? item.description
                : item.title;
            if (chosenAnswer.includes(' - ')) {
                const parts = chosenAnswer.split(' - ');
                if (parts.length > 1 && parts[parts.length - 1].length < 30) {
                    chosenAnswer = parts.slice(0, -1).join(' - ').trim();
                }
            }
            return {
                verified: true,
                confidence: 0.88,
                answer: chosenAnswer,
                evidenceIndexes: [i],
                modelAssisted: false,
                reason: `Extracted directly from live web source: ${item.domain || item.sourceLabel}`
            };
        }
    }
    return null;
}

async function buildGroundedRagAnswer(query, results, gate, options = {}) {
    const evidence = (gate?.evidence || results || []).slice(0, 6);
    if (!evidence.length) return null;
    const isCurrent = isCurrentStateQuery(query);

    const currentEvidence = [];
    const historicalContext = [];
    for (const item of evidence) {
        const temporalStatus = validateClaimTemporalStatus(item);
        if (temporalStatus === 'historical') {
            historicalContext.push({ ...item, temporalStatus: 'historical' });
        } else {
            currentEvidence.push({ ...item, temporalStatus });
        }
    }

    const orderedEvidence = isCurrent && currentEvidence.length
        ? [...currentEvidence, ...historicalContext]
        : evidence;

    if (getGeminiApiKey() || process.env.GROQ_API_KEY) {
        if (options?.allowDeepCrawl === true) {
            await enrichSearchResultsWithDeepCrawl(orderedEvidence, 2).catch(() => {});
        }
        const compact = orderedEvidence.map((item, index) => ({
            index,
            title: item.title,
            snippet: item.description,
            fullArticleContent: item.fullArticleText || item.description,
            url: item.url,
            domain: item.domain,
            sourceType: item.sourceType,
            sourceLabel: item.sourceLabel,
            date: item.date || '',
            startDate: item.startDate || '',
            endDate: item.endDate || '',
            temporalStatus: validateClaimTemporalStatus(item)
        }));
        const todayStr = new Date().toISOString().slice(0, 10);
        const prompt = `Return strict JSON only.
Task: Answer the user's question directly and factually using ONLY the retrieved web evidence below.
Current Date: ${todayStr} (Year 2026).

STRICT ANTI-HEDGING & DIRECT-NAME GROUNDING RULES:
1. FIRST SENTENCE MUST DIRECTLY STATE THE PERSON'S SPECIFIC NAME AND OFFICE (e.g., "The current Chief Minister of Tamil Nadu is M. K. Stalin.").
2. FORBIDDEN: DO NOT write meta-commentary about the search process or snippets (NEVER say "Based on the provided information...", "The verified web content states...", "However, the content does not explicitly name...").
3. FORBIDDEN: DO NOT output generic civics lessons or definitions explaining what the office of CM/PM means.
4. FOR CURRENT QUERIES: Base the active leader strictly on 'current' evidence. DO NOT declare future speculative election winners or past office holders as current leaders.
5. If the provided evidence does not contain the specific answer or is ambiguous, set "verified": false, "confidence": 0.0, "answer": "". Do NOT guess or write an explanatory disclaimer.
6. Return evidenceIndexes citing which evidence blocks you used.

User question: ${JSON.stringify(query)}
Evidence JSON:
${JSON.stringify(compact, null, 2)}
JSON shape: {"verified":true,"confidence":0.0,"answer":"...","evidenceIndexes":[0],"conflict":false,"reason":"..."}`;
        const json = await callGeminiJson(prompt, { maxOutputTokens: 700, temperature: 0 });
        const verified = json?.verified === true && Number(json?.confidence) >= 0.86;
        const answer = sanitizeRagAnswerText(json?.answer || '');
        const evidenceIndexes = Array.isArray(json?.evidenceIndexes)
            ? json.evidenceIndexes.map(Number).filter(Number.isInteger)
            : [];
        if (verified && answer && evidenceIndexes.length) {
            return {
                verified: true,
                confidence: Math.min(0.99, Math.max(0.86, Number(json?.confidence) || 0.86)),
                answer,
                evidenceIndexes,
                modelAssisted: true,
                reason: String(json?.reason || '').trim()
            };
        }
    }
    return extractDeterministicLiveFactAnswer(query, orderedEvidence);
}

function sanitizeRagAnswerText(value) {
    const clean = String(value || '').replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    if (/\b(check|consult|look up)\b.{0,40}\b(latest|official|source|news|website)\b/i.test(clean)) return '';
    if (/\b(i am not sure|not certain|cannot verify|can't verify|unable to verify)\b/i.test(clean)) return '';
    if (/^(?:based on the (?:provided|retrieved) (?:information|content|sources|evidence)|the verified web content states|according to the (?:provided|retrieved) (?:sources|content|information))\b/i.test(clean)) {
        if (/\b(?:does not|do not|cannot|fails to)\s+(?:explicitly\s+)?(?:name|state|mention|identify)\b/i.test(clean)) {
            return '';
        }
    }
    if (/\bhowever,?\s+(?:the\s+)?(?:content|evidence|sources|information)\s+(?:do(?:es)?\s+not|cannot|fails\s+to)\s+(?:explicitly\s+)?(?:name|state|mention|identify)\b/i.test(clean)) {
        return '';
    }
    return clean.endsWith('.') ? clean : `${clean}.`;
}

function selectEvidenceByIndexes(results, indexes = []) {
    const selected = [];
    const used = new Set();
    for (const index of indexes) {
        const item = results[index];
        if (!item?.url || used.has(item.url)) continue;
        used.add(item.url);
        selected.push(item);
    }
    if (selected.length) return selected;
    return (Array.isArray(results) ? results : []).filter(isStrongRagEvidenceSource).slice(0, 3);
}

async function buildGeminiSearchPlan(query) {
    if (!hasGeminiKey()) return { queries: [], enhanced: false };
    const prompt = `Return strict JSON only.
Task: rewrite this user search query into 2 to 4 concise public-source search queries.
Prefer official domains, Wikipedia/Wikidata style entity terms, and news phrasing when current.
User query: ${JSON.stringify(query)}
JSON shape: {"queries":["..."]}`;
    const json = await callGeminiJson(prompt, { maxOutputTokens: 300, temperature: 0.1 });
    const queries = Array.isArray(json?.queries)
        ? json.queries.map(item => normalizeSearchQuery(item)).filter(Boolean).slice(0, 4)
        : [];
    return { queries, enhanced: queries.length > 0 };
}

async function enhanceResultsWithGemini(query, results, options = {}) {
    if (!hasGeminiKey() || !Array.isArray(results) || !results.length) {
        return { results, enhanced: false };
    }
    const limit = clampInt(options.limit, 8, 1, 20);
    const compact = results.slice(0, 12).map((item, index) => ({
        index,
        title: item.title,
        description: item.description,
        domain: item.domain,
        sourceType: item.sourceType,
        sourceLabel: item.sourceLabel,
        date: item.date,
        url: item.url
    }));
    const prompt = `Return strict JSON only.
Task: rank and improve source snippets for a public-source search result list.
Rules:
- Use only the fields provided. Do not invent facts.
- Keep descriptions concise, source-grounded, and under 180 characters.
- Prefer official_source, trusted_news, and exact query relevance.
- Mark relevance as "relevant", "weak", or "irrelevant" based on the user query and source fields.
- Exclude irrelevant sources from the ranked list.
- Return indexes from the input list only.
User query: ${JSON.stringify(query)}
Results JSON: ${JSON.stringify(compact)}
JSON shape: {"ranked":[{"index":0,"relevance":"relevant","description":"...","reason":"..."}]}`;
    const json = await callGeminiJson(prompt, { maxOutputTokens: 900, temperature: 0.1, throwOnError: true });
    const ranked = Array.isArray(json?.ranked) ? json.ranked : [];
    if (!ranked.length) return { results, enhanced: false };
    const byIndex = new Map(results.map((item, index) => [index, item]));
    const used = new Set();
    const enhanced = [];
    for (const entry of ranked) {
        const index = Number(entry?.index);
        const item = byIndex.get(index);
        if (!item || used.has(index)) continue;
        if (String(entry?.relevance || '').toLowerCase() === 'irrelevant') continue;
        used.add(index);
        enhanced.push({
            ...item,
            description: String(entry?.description || item.description || '').replace(/\s+/g, ' ').trim().slice(0, 320),
            qualitySignals: Array.from(new Set([...(item.qualitySignals || []), 'gemini_ranked', String(entry?.relevance || '').toLowerCase() === 'weak' ? 'gemini_weak_relevance' : 'gemini_relevant'])),
            geminiReason: String(entry?.reason || '').slice(0, 160)
        });
    }
    return { results: enhanced.slice(0, limit), enhanced: true };
}

async function callGeminiJson(prompt, options = {}) {
    const apiKey = getGeminiApiKey();
    if (apiKey) {
        try {
            const model = String(process.env.GEMINI_SEARCH_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite').trim();
            const response = await fetchWithTimeout(`${GEMINI_GENERATE_URL}/${model}:generateContent?key=${apiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.1,
                        maxOutputTokens: clampInt(options.maxOutputTokens, 700, 100, 1600)
                    }
                })
            }, GEMINI_SEARCH_TIMEOUT_MS);
            if (response.ok) {
                const data = await response.json();
                const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || '').trim();
                const parsed = extractJsonObject(text);
                if (parsed) return parsed;
            } else if (options.throwOnError) {
                throw createSearchError({
                    code: 'gemini_search_enhancer_failed',
                    httpStatus: 200,
                    upstreamStatus: response.status,
                    publicMessage: 'Gemini search enhancement failed.',
                    retryable: true
                });
            }
        } catch (err) {
            if (options.throwOnError) throw err;
        }
    }

    const groqKey = String(process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
        const groqModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-120b'];
        for (const model of groqModels) {
            try {
                const response = await fetchWithTimeout('https://api.groq.com/openai/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${groqKey}`
                    },
                    body: JSON.stringify({
                        model,
                        messages: [
                            { role: 'system', content: 'You are a strict JSON generator. Return valid JSON only with no markdown or preamble.' },
                            { role: 'user', content: prompt }
                        ],
                        temperature: 0.1,
                        max_tokens: clampInt(options.maxOutputTokens, 700, 100, 1600),
                        response_format: { type: 'json_object' }
                    })
                }, 4500);
                if (response.ok) {
                    const data = await response.json();
                    const text = String(data?.choices?.[0]?.message?.content || '').trim();
                    const parsed = extractJsonObject(text);
                    if (parsed) return parsed;
                }
            } catch (_) {}
        }
    }
    return null;
}

function extractJsonObject(text) {
    const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
    try {
        return JSON.parse(raw);
    } catch (_) {
        const start = raw.indexOf('{');
        const end = raw.lastIndexOf('}');
        if (start >= 0 && end > start) {
            try {
                return JSON.parse(raw.slice(start, end + 1));
            } catch (_) {}
        }
    }
    return null;
}

async function discoverOfficialSourceCandidates(query, options = {}) {
    const cleanQuery = normalizeSearchQuery(query);
    if (!cleanQuery) return [];
    const limit = clampInt(options.limit, 4, 1, 8);
    const candidates = [];
    const add = item => {
        const url = normalizeCandidateUrl(item?.url);
        if (!url || !isOfficialGovernmentUrl(url)) return;
        const domain = getDomainFromUrl(url);
        if (!domain || candidates.some(existing => getDomainFromUrl(existing.url) === domain && normalizeResultKey(existing) === normalizeResultKey({ url }))) {
            return;
        }
        candidates.push({
            label: String(item?.label || item?.sourceLabel || domain).replace(/\s+/g, ' ').trim(),
            url,
            pattern: item?.pattern || null,
            discoverySignal: item?.discoverySignal || 'official_candidate',
            officialConfidence: item?.officialConfidence || inferOfficialConfidence(url, item)
        });
    };

    const roleIntent = parseGovernmentRoleQuery(cleanQuery);
    if (roleIntent) {
        const wikidataOfficial = await discoverWikidataOfficialCandidates(roleIntent.jurisdiction)
            .catch(() => []);
        for (const item of wikidataOfficial) add(item);
    }

    for (const result of Array.isArray(options.seedResults) ? options.seedResults : []) {
        const url = String(result?.url || '').trim();
        if (!url || !isOfficialGovernmentUrl(url)) continue;
        add({
            label: result.sourceLabel || result.source || result.domain || getDomainFromUrl(url),
            url,
            discoverySignal: 'official_result_url',
            officialConfidence: result.trusted ? 'high' : 'medium'
        });
    }

    return candidates.slice(0, limit);
}

async function discoverWikidataOfficialCandidates(jurisdictionLabel) {
    const entity = await resolveWikidataEntity(jurisdictionLabel);
    if (!entity?.id) return [];
    const urls = await fetchWikidataOfficialUrls(entity.id);
    return urls.map(url => ({
        label: `${entity.label} official`,
        url,
        discoverySignal: 'wikidata_official_website',
        officialConfidence: 'high'
    }));
}

async function fetchWikidataOfficialUrls(entityId) {
    const id = String(entityId || '').trim();
    if (!/^Q\d+$/.test(id)) return [];
    const url = new URL(WIKIDATA_SEARCH_URL);
    url.searchParams.set('action', 'wbgetentities');
    url.searchParams.set('ids', id);
    url.searchParams.set('props', 'claims');
    url.searchParams.set('format', 'json');
    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)'
        }
    }, PUBLIC_SOURCE_TIMEOUT_MS);
    if (!response.ok) return [];
    const data = await response.json();
    const claims = data?.entities?.[id]?.claims?.P856;
    if (!Array.isArray(claims)) return [];
    return Array.from(new Set(claims
        .map(claim => normalizeCandidateUrl(claim?.mainsnak?.datavalue?.value))
        .filter(urlValue => urlValue && isOfficialGovernmentUrl(urlValue))));
}

function normalizeCandidateUrl(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        if (!['http:', 'https:'].includes(parsed.protocol)) return '';
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function isOfficialGovernmentUrl(url) {
    const domain = getDomainFromUrl(url);
    if (!domain) return false;
    if (isTrustedLiveSource(domain) && /(?:who\.int|nasa\.gov|isro\.gov\.in|rbi\.org\.in|sec\.gov|imf\.org|worldbank\.org|noaa\.gov|europa\.eu|gov\.uk|usa\.gov)$/i.test(domain)) {
        return true;
    }
    return OFFICIAL_GOVERNMENT_DOMAIN_PATTERNS.some(pattern => pattern.test(domain));
}

function inferOfficialConfidence(url, item = {}) {
    const domain = getDomainFromUrl(url);
    if (!domain) return 'low';
    if (item?.discoverySignal === 'wikidata_official_website') return 'high';
    if (/(\.gov$|\.gov\.[a-z]{2}$|^gov\.|\.go\.[a-z]{2}$|gc\.ca$|europa\.eu$|un\.org$)/i.test(domain)) return 'medium';
    return 'low';
}

function extractOfficialCurrentRoleEvidence(text, query, sourceUrl = '') {
    const intent = parseGovernmentRoleQuery(query);
    if (!intent) return null;
    const role = intent.role;
    const jurisdiction = intent.jurisdiction;
    const clean = String(text || '')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim();
    if (!clean) return null;
    const sentences = clean.match(/[^.!?]+[.!?]?/g) || [clean];
    const stalePattern = /\b(?:former|previous|ex-|served\s+until|was\s+the|had\s+been|from\s+\d{4}\s+(?:to|through|-)\s+\d{4}|history|list\s+of|election)\b/i;
    const holderPatterns = [
        new RegExp(`\\b(?:current\\s+|present\\s+|incumbent\\s+)?${escapeRegex(role)}\\s+(?:of|for|in)\\s+${escapeRegex(jurisdiction)}\\s+(?:is|:|-)\\s+([A-Z][A-Za-z.'’\\-]+(?:\\s+[A-Z][A-Za-z.'’\\-]+){0,5})`, 'i'),
        new RegExp(`\\b([A-Z][A-Za-z.'’\\-]+(?:\\s+[A-Z][A-Za-z.'’\\-]+){0,5})\\s+(?:is|serves\\s+as|has\\s+been\\s+appointed\\s+as)\\s+(?:the\\s+)?(?:current\\s+|present\\s+|incumbent\\s+)?${escapeRegex(role)}\\s+(?:of|for|in)\\s+${escapeRegex(jurisdiction)}`, 'i'),
        new RegExp(`\\b(?:hon'?ble\\s+|honorable\\s+)?(?:shri\\s+|smt\\.?\\s+|mr\\.?\\s+|ms\\.?\\s+|dr\\.?\\s+)?([A-Z][A-Za-z.'’\\-]+(?:\\s+[A-Z][A-Za-z.'’\\-]+){0,5})\\s*,?\\s+(?:${escapeRegex(role)})\\b`, 'i')
    ];
    for (const sentence of sentences.slice(0, 80)) {
        const candidate = sentence.trim();
        if (!candidate || stalePattern.test(candidate)) continue;
        if (!new RegExp(escapeRegex(role), 'i').test(candidate)) continue;
        if (!new RegExp(escapeRegex(jurisdiction), 'i').test(`${candidate} ${sourceUrl}`) && !/\bcurrent|present|incumbent|official\b/i.test(candidate)) continue;
        for (const pattern of holderPatterns) {
            const match = candidate.match(pattern);
            const holderName = cleanHolderName(match?.[1] || '');
            if (holderName) {
                return {
                    holderName,
                    role,
                    jurisdiction,
                    claim: candidate.slice(0, 320)
                };
            }
        }
    }
    return null;
}

function cleanHolderName(value, jurisdiction = '', role = '') {
    let text = String(value || '')
        .replace(/^.*?\b(?:by|with|for|as|named|called|known as|titled)\s+/i, '')
        .replace(/\b(?:the|current|present|incumbent|hon'?ble|honorable|shri|smt|mr|ms|mrs|dr|prof|sir|lord|lady)\b\.?/gi, ' ')
        .replace(/[,;:].*$/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text || text.length < 2 || text.length > 60) return '';
    if (jurisdiction && text.toLowerCase().includes(jurisdiction.toLowerCase())) return '';
    if (role && text.toLowerCase().includes(role.toLowerCase())) return '';
    const nameTokens = text.split(/\s+/).filter(t => /^[A-Z][a-zA-Z.'-]*$/.test(t));
    if (nameTokens.length < 2 || nameTokens.length > 5) return '';
    if (jurisdiction && nameTokens.some(t => jurisdiction.toLowerCase().includes(t.toLowerCase()))) return '';
    if (role && nameTokens.some(t => role.toLowerCase().includes(t.toLowerCase()))) return '';
    return nameTokens.join(' ');
}

function rankSearchResults(query, results) {
    return rankSources(query, results);
}

export function rankSources(query, results) {
    const terms = tokenize(query);
    return [...(Array.isArray(results) ? results : [])].sort((a, b) => scoreSearchResult(b, terms, query) - scoreSearchResult(a, terms, query));
}

function scoreSearchResult(item, terms, query = '') {
    const title = String(item?.title || '').toLowerCase();
    const description = String(item?.description || '').toLowerCase();
    const domain = String(item?.domain || '').toLowerCase();
    let score = 0;
    if (item?.evidenceLevel === 'structured_claim') score += 45;
    if (item?.sourceType === 'official_source') score += 30;
    if (item?.trusted) score += 12;
    if (item?.sourceType === 'trusted_news') score += 8;
    if (item?.sourceType === 'encyclopedia') score += 4;
    if (item?.sourceType === 'structured_reference') score += 3;
    if (item?.sourceType === 'community_discussion') score -= 6;
    if (item?.sourceType === 'reference_lookup') score -= 12;
    if (item?.sourceType === 'archive_lookup') score -= 16;
    for (const term of terms) {
        if (title.includes(term)) score += 5;
        if (domain.includes(term)) score += 4;
        if (description.includes(term)) score += 2;
    }
    if (item?.date) score += 2;

    if (query) {
        const roleIntent = parseGovernmentRoleQuery(query);
        const dateIntent = roleIntent?.dateIntent || parseStructuredDateWindow(query);
        if (dateIntent?.hasDate) {
            if (roleClaimOverlapsWindow(item, dateIntent)) {
                score += 50;
            } else if (item?.startDate || item?.endDate) {
                score -= 40;
            }
        } else if (isCurrentStateQuery(query)) {
            const temporalStatus = validateClaimTemporalStatus(item);
            if (temporalStatus === 'current') {
                score += 50;
            } else if (temporalStatus === 'historical') {
                score -= 40;
            } else if (temporalStatus === 'future') {
                score -= 30;
            }
        }
    }

    return score;
}

function buildSearchWarnings(results, existing = []) {
    const warnings = [...existing];
    if (!Array.isArray(results) || !results.length) {
        warnings.push('No public-source results were found. This is not full-web coverage.');
    } else if (!results.some(isAnswerEvidenceResult)) {
        warnings.push('Only lookup or discussion links were found; no answer-bearing public source was available.');
    } else if (results.length < 3) {
        warnings.push('Limited public-source coverage; results may be incomplete.');
    }
    if (!results.some(item => item.sourceType === 'official_source' || item.trusted)) {
        warnings.push('No trusted or official source was found in the public-source result set.');
    }
    return Array.from(new Set(warnings.filter(Boolean)));
}

function isAnswerEvidenceResult(item) {
    return isValidCitationSource(item, item?.query || '');
}

export function isValidCitationSource(source, query = '') {
    const item = source || {};
    const title = String(item.title || '').trim();
    const url = String(item.url || '').trim();
    const description = String(item.description || '').trim();
    const sourceType = String(item.sourceType || '').trim();
    const domain = String(item.domain || getDomainFromUrl(url)).toLowerCase();
    const combined = `${title} ${description} ${url}`.toLowerCase();
    const fullContent = `${title} ${description} ${item.fullArticleText || ''} ${item.text || ''} ${url}`.toLowerCase();
    if (!title || !url) return false;
    if (!sourceType || LOOKUP_ONLY_SOURCE_TYPES.has(sourceType)) return false;
    // Structured claims (e.g., Wikidata role lookups) always pass — check before description filter
    if (item.evidenceLevel === 'structured_claim') return true;
    if (!description || description.length < 20) return false;
    if (/search:|webcache|cache\.google|\/search(?:[/?#]|$)|[?&]q=/.test(combined)) return false;
    if (/archive\.(today|ph|is)|webcache/i.test(domain)) return false;

    if (query) {
        const isLeadership = /\b(?:who\s+is\s+the\s+)?(?:cm|chief minister|prime minister|pm|president|governor|mayor|ceo|leader|head of state|head of government|captain|skipper|coach|manager)\b/i.test(query);
        const isExplicitElection = /\b(?:election|polls?|voting)\b/i.test(query);
        if (isLeadership) {
            if (!isExplicitElection && /\b(?:202[6-9]|upcoming|next)\s+(?:assembly\s+)?(?:election|legislative assembly election|opinion poll|exit poll|candidates?\s+list)\b/i.test(fullContent)) {
                return false;
            }
            if (/\b(?:all set to swear in|will swear in|predicted to win|landslide victory in 202[6-9]|sworn in today at the jawaharlal|c\.\s*joseph vijay.*chief minister|tvk.*won the 2026)\b/i.test(fullContent)) {
                return false;
            }
            if (/\b(?:stakes?\s+claim|claims?\s+to\s+form|to\s+form\s+(?:the\s+)?gov(?:t|ernment)|eyes\s+(?:the\s+)?(?:cm|pm|captain)|future\s+(?:cm|pm)|vows\s+to\s+become|promises\s+to\s+be|if\s+elected|manifesto|election\s+campaign|political\s+rally|party\s+president\s+vijay|tvk\s+chief|why\s+tamil\s+nadu\s+cm)\b/i.test(fullContent)) {
                return false;
            }
            if (/\b(?:makes bold claim|bold claim|will captain|could captain|predicted to captain|maybe|rumou?r|opinion|suggests|urges|WATCH|net practice)\b/i.test(fullContent)) {
                return false;
            }
        }
    }

    if (sourceType === 'official_source' && !item.pageFetched) return false;
    if (sourceType === 'official_source') return Boolean(item.exactShortcutMatch) || isRelatedToQuery(query, item);
    if (/^(live_web|web_search|encyclopedia|structured_reference|trusted_news|public_news|cached_latest|free_|exa_)/.test(sourceType)) {
        return isRelatedToQuery(query, item);
    }
    return false;
}

function hasCrawl4AiConfig() {
    return Boolean(String(process.env.CRAWL4AI_URL || '').trim());
}

function isRelatedToQuery(query, item) {
    const discovery = parseDiscoveryFactQuery(query);
    if (discovery) return isDiscoveryAnswerSource(discovery, item);
    if (/^free_/i.test(String(item?.sourceType || ''))) return true;
    const terms = tokenize(query).filter(term => term.length >= 2);
    if (!terms.length) return true;
    const hay = `${item?.title || ''} ${item?.description || ''} ${item?.sourceLabel || ''}`.toLowerCase();
    if (isCurrentTopicSearchQuery(query)) {
        return isRelatedCurrentTopicSource(query, hay);
    }
    if (/^(trusted_news|public_news)$/i.test(String(item?.sourceType || '')) && item?.date) {
        return terms.some(term => hay.includes(term));
    }
    return isStrongGenericQuerySourceMatch(query, hay);
}

function isStrongGenericQuerySourceMatch(query, haystack) {
    const subject = extractSearchSubject(query) || query;
    const text = String(haystack || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (!text) return false;

    const compactSubject = String(subject || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const subjectTerms = tokenize(subject)
        .filter(term => term.length >= 2 || /^\d{4}$/.test(term));
    const queryTerms = tokenize(query)
        .filter(term => term.length >= 2 || /^\d{4}$/.test(term));
    if (compactSubject && compactSubject.split(/\s+/).length >= 2 && text.includes(compactSubject)) return true;
    const terms = subjectTerms.length ? subjectTerms : queryTerms;
    if (!terms.length) return false;
    const matched = terms.filter(term => text.includes(term));
    if (terms.length === 1) return terms[0].length >= 2 && matched.length === 1;
    return matched.length >= Math.min(terms.length, Math.max(2, Math.ceil(terms.length * 0.67)));
}

function isRelatedCurrentTopicSource(query, haystack) {
    const subject = extractSearchSubject(query);
    const subjectTerms = tokenize(subject).filter(term => term.length >= 2 && !/^\d$/.test(term));
    const queryTerms = tokenize(query).filter(term => term.length >= 2 && !/^\d$/.test(term));
    const text = String(haystack || '').toLowerCase();
    const matchedSubjectTerms = subjectTerms.filter(term => text.includes(term));
    const matchedQueryTerms = queryTerms.filter(term => text.includes(term));
    const compactText = text.replace(/[^a-z0-9]+/g, ' ').trim();
    const hasSubjectPhrase = subject && compactText.includes(subject.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    if (hasSubjectPhrase) return true;
    if (subjectTerms.length <= 1) return matchedSubjectTerms.length === subjectTerms.length && matchedQueryTerms.length >= 2;
    const requiredSubjectMatches = Math.min(subjectTerms.length, Math.max(2, Math.ceil(subjectTerms.length * 0.67)));
    return matchedSubjectTerms.length >= requiredSubjectMatches && matchedQueryTerms.length >= requiredSubjectMatches;
}

function buildGdeltDescription(item, domain, date) {
    const country = String(item?.sourcecountry || '').trim();
    const parts = [
        domain ? `Source: ${domain}` : '',
        date ? `Indexed: ${date.slice(0, 10)}` : '',
        country ? `Country: ${country}` : ''
    ].filter(Boolean);
    return parts.length ? parts.join(' | ') : 'News article indexed by GDELT.';
}

function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{1,}/g) || []));
}

function normalizeResultKey(item) {
    const url = String(item?.url || '').trim();
    if (url) {
        try {
            const parsed = new URL(url);
            parsed.hash = '';
            parsed.search = '';
            return parsed.toString().replace(/\/$/, '').toLowerCase();
        } catch (_) {
            return url.toLowerCase();
        }
    }
    return `${String(item?.title || '').toLowerCase()}|${String(item?.domain || '').toLowerCase()}`;
}

function normalizeSearchQuery(query) {
    return String(query || '').replace(/\s+/g, ' ').trim().slice(0, MAX_QUERY_LENGTH);
}

function extractSearchTargetQuery(query) {
    const normalized = normalizeSearchQuery(query)
        .replace(/^[“"']+|[”"']+$/g, '')
        .replace(/[?.!]+$/g, '')
        .trim();
    if (!normalized) return '';
    const explicit = normalized.match(/^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|web\s+search(?:\s+for)?|look\s+up|find(?:\s+me)?|google)\s+(.+)$/i);
    if (explicit?.[1]) return cleanSearchTargetPhrase(explicit[1]);
    return cleanSearchTargetPhrase(normalized);
}

function cleanSearchTargetPhrase(value) {
    return cleanQueryTarget(normalizeSearchQuery(String(value || '')
        .replace(/^(?:about|on|for)\s+/i, '')
        .replace(/[?.!]+$/g, '')
        .trim()));
}

function buildSearchQueryRewrite(query) {
    const normalized = normalizeSearchQuery(query)
        .replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
        .trim();
    if (!normalized) {
        return { query: '', subject: '', freshnessNeeded: false, intent: 'general' };
    }
    const explicit = normalized.match(/^(?:please\s+)?(?:can\s+you\s+|could\s+you\s+)?(?:search(?:\s+the\s+web)?(?:\s+for)?|web\s+search(?:\s+for)?|look\s+up|find(?:\s+me)?|google)\s+(.+)$/i);
    const rawTarget = normalizeSearchQuery(String(explicit?.[1] || normalized || '')
        .replace(/^(?:about|on|for)\s+/i, '')
        .replace(/[?.!]+$/g, '')
        .trim());
    const targetMetadata = extractQueryTargetMetadata(rawTarget);
    const target = targetMetadata.target || cleanSearchTargetPhrase(rawTarget);
    const subject = extractSearchSubject(target);
    const intent = extractSearchIntentTerm(target);
    return {
        query: rawTarget || target,
        subject,
        dateContext: targetMetadata.dateContext,
        modifiers: targetMetadata.modifiers,
        freshnessNeeded: isCurrentTopicSearchQuery(target) || isDatedChangingFactSearchQuery(target) || /\b(?:latest|recent|current|newest|today|now|breaking)\b/i.test(target),
        intent
    };
}

function buildDeterministicSearchQueries(query) {
    const normalized = normalizeSearchQuery(query);
    if (!normalized) return [];
    const subject = extractSearchSubject(normalized);
    if (!subject) return [];
    const intent = extractSearchIntentTerm(normalized);
    return Array.from(new Set([
        `${subject} ${intent}`.trim(),
        `${subject} recent ${intent}`.trim(),
        `${subject} latest ${intent}`.trim()
    ].map(normalizeSearchQuery).filter(Boolean)));
}

function isCurrentTopicSearchQuery(query) {
    const text = String(query || '').toLowerCase();
    const hasFreshOrReviewSignal = /\b(reviews?|hands-on|worth\s+it|vs|compare|comparison|price|available|availability|launched)\b/.test(text);
    return (hasFreshOrReviewSignal || isDatedChangingFactSearchQuery(query)) && extractSearchSubject(query).split(/\s+/).filter(Boolean).length >= 2;
}

function isDatedChangingFactSearchQuery(query) {
    const text = String(query || '').toLowerCase();
    if (!parseStructuredDateWindow(text).hasDate) return false;
    return /\b(won|winner|champion|champions|rankings?|standings?|captain|coach|ceo|chair(?:person|man)?|president|prime minister|chief minister|mayor|governor|latest|newest|last|movie|film|song|album|release|released|launched|price|value)\b/.test(text);
}

function extractSearchSubject(query) {
    const universal = parseUniversalEntityQuery(query);
    if (universal?.jurisdiction) return cleanQueryTarget(universal.jurisdiction);
    const normalized = normalizeSearchQuery(query);
    const text = normalized
        .replace(/\b(?:latest|recent|current|newest|reviews?|review|hands-on|worth\s+it|good|best|price|available|availability|launched|released?|winner|won|champion|rankings?|standings?|compare|comparison|vs|movies?|films?|songs?|albums?|releases?)\b/gi, ' ')
        .replace(/\b(?:in|during|as of|by|before|after)\s+\d{4}\b/gi, ' ')
        .replace(/\b(?:of|for|about|on|the|is|are|should|i|buy|get|now|today|live|exact|rate)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return cleanQueryTarget(normalizeSearchQuery(text).replace(/\s*\(\s*/g, ' ').replace(/\s*\)\s*/g, '').trim());
}

function extractSearchIntentTerm(query) {
    const text = String(query || '').toLowerCase();
    if (/\b(?:news|update|updates|breaking|developments?|government|policy|election)\b/.test(text)) return 'news';
    if (/\b(?:price|available|availability|launched|released?)\b/.test(text)) return 'latest';
    if (/\b(?:vs|compare|comparison)\b/.test(text)) return 'comparison';
    if (/\b(?:worth\s+it|review|reviews|best)\b/.test(text)) return 'reviews';
    return 'updates';
}

function createSerperStatusError(status, detail = '') {
    const upstreamStatus = Number(status) || 0;
    const cleanDetail = sanitizeUpstreamDetail(detail);
    if (upstreamStatus === 401 || upstreamStatus === 403) {
        return createSearchError({
            code: 'serper_auth_failed',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rejected the API key or permissions${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    if (upstreamStatus === 429 || /not enough credits|quota|credits/i.test(cleanDetail)) {
        return createSearchError({
            code: 'serper_quota_or_rate_limit',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rate limit, quota, or credits were exhausted${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    if (upstreamStatus >= 400 && upstreamStatus < 500) {
        return createSearchError({
            code: 'serper_request_rejected',
            httpStatus: 502,
            upstreamStatus,
            publicMessage: `Serper rejected the search request${cleanDetail ? `: ${cleanDetail}` : '.'}`,
            retryable: false
        });
    }
    return createSearchError({
        code: 'serper_upstream_error',
        httpStatus: 502,
        upstreamStatus,
        publicMessage: `Serper returned an upstream error${upstreamStatus ? ` (${upstreamStatus})` : ''}${cleanDetail ? `: ${cleanDetail}` : '.'}`,
        retryable: true
    });
}

function createSearchError({ code, httpStatus, upstreamStatus, publicMessage, retryable }) {
    const error = new Error(publicMessage);
    error.code = code;
    error.httpStatus = httpStatus;
    error.upstreamStatus = upstreamStatus;
    error.publicMessage = publicMessage;
    error.retryable = retryable;
    return error;
}

function sanitizeUpstreamDetail(detail) {
    const text = String(detail || '')
        .replace(/\s+/g, ' ')
        .replace(/[A-Za-z0-9_-]{24,}/g, '[redacted]')
        .trim();
    return text.slice(0, 220);
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

function stripHtml(text) {
    return String(text || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
}

function extractHtmlTitle(html) {
    const match = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return stripHtml(match?.[1] || '').trim();
}

function extractHtmlDescription(html) {
    const raw = String(html || '');
    const meta = raw.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i) ||
        raw.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["'][^>]*>/i);
    return stripHtml(meta?.[1] || '').trim();
}

function extractReadableHtmlText(html) {
    return stripHtml(String(html || '')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
        .replace(/<footer[\s\S]*?<\/footer>/gi, ' '));
}

function normalizeGdeltDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{14}$/.test(raw)) return raw;
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(8, 10)}:${raw.slice(10, 12)}:${raw.slice(12, 14)}Z`;
}

function getSerperApiKey() {
    return String(process.env.SERPER_API_KEY || process.env.SERPER_KEY || '').trim();
}

function getExaApiKey() {
    return String(process.env.EXA_API_KEY || process.env.EXA_KEY || process.env.AI_GATEWAY_TOKEN || process.env.VERCEL_AI_GATEWAY_TOKEN || process.env.GATEWAY_TOKEN || '').trim();
}

function getGeminiApiKey() {
    return String(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
}

function hasGeminiKey() {
    return Boolean(getGeminiApiKey());
}

function getSerperKeyFingerprint() {
    const key = getSerperApiKey();
    if (!key) return '';
    return createHash('sha256').update(key).digest('hex').slice(0, 10);
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export const __test = {
    liveSearchDisabledResponse: LIVE_SEARCH_DISABLED_RESPONSE,
    createSerperStatusError,
    getSerperKeyFingerprint,
    normalizeSerperResults,
    normalizeExaResults,
    searchExa,
    runVerifiedWebSearch,
    runEvidenceFirstWebRag,
    searchGoogleNewsRss,
    crawlArticleBody,
    extractCleanArticleText,
    enrichSearchResultsWithDeepCrawl,
    searchGdeltNews,
    searchWikidata,
    searchReddit,
    searchGovernmentRole,
    parseGovernmentRoleQuery,
    parseStructuredDateWindow,
    roleClaimOverlapsWindow,
    normalizeGovernmentRoleBindings,
    isValidCitationSource,
    buildSourceDerivedAnswer,
    validateClaimTemporalStatus,
    isCurrentStateQuery,
    hasObviousRagConflict,
    discoverOfficialSourceCandidates,
    fetchWikidataOfficialUrls,
    isOfficialGovernmentUrl,
    extractOfficialCurrentRoleEvidence,
    parseDiscoveryFactQuery,
    isDiscoveryAnswerSource,
    rankSources,
    searchPublicSources,
    searchWikipedia,
    extractSearchTargetQuery,
    buildSearchQueryRewrite,
    resolveRetrievalRoute,
    classifyRetrievalIntentWithGemini,
    buildDeterministicSearchQueries,
    buildWebRagQueryPhases,
    evaluateWebRagEvidence,
    isCurrentTopicSearchQuery,
    isRelatedCurrentTopicSource,
    isRelatedToQuery,
    buildGeminiSearchPlan,
    enhanceResultsWithGemini,
    isTrustedLiveSource,
    routeMessage,
    runCachedLatestSearch,
    callGeminiJson
};
