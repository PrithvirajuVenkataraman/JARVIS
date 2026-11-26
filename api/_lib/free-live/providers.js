import { FREE_LIVE_SOURCES } from './source-registry.js';
import { cleanQueryTarget, extractQueryTargetMetadata } from '../query-target-cleanup.js';
import { cleanSnippetText, decodeHtmlEntities } from '../snippet-sanitizer.js';
import { classifyTemporalScope } from '../temporal-query-planner.js';
import { parseDocumentDate, formatDocumentDate } from '../hybrid-reranker.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
    globalCircuitBreaker,
    isCircuitBreakerEnabled,
    classifyResponseOutcome,
    FAILURE_TYPES,
    BREAKER_STATES,
    getCircuitBreakerDebugState
} from '../../../app/search/circuitBreaker.mjs';

let VERIFIED_SEARXNG_POOL = [
    'https://search.sapti.me/search',
    'https://etsi.me/search',
    'https://baresearch.org/search',
    'https://priv.au/search',
    'https://searx.be/search',
    'https://searx.tiekoetter.com/search',
    'https://search.disroot.org/search',
    'https://paulgo.io/search',
    'https://search.ononoki.org/search',
    'https://searx.work/search'
];

try {
    const poolPath = fileURLToPath(new URL('../../../app/search/searxng-pool.json', import.meta.url));
    const poolRaw = readFileSync(poolPath, 'utf8');
    const parsed = JSON.parse(poolRaw);
    if (Array.isArray(parsed?.instances) && parsed.instances.length >= 8) {
        VERIFIED_SEARXNG_POOL = parsed.instances.map(inst => inst.url).filter(Boolean);
    }
} catch (_) {}

const OPEN_METEO_GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price';
const EONET_EVENTS_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
const SPORT_SEARCH_URL = 'https://www.thesportsdb.com/api/v1/json/3/search_all_teams.php';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const NOMINATIM_SEARCH_URL = 'https://nominatim.openstreetmap.org/search';

const CRYPTO_CACHE = new Map();
const COINGECKO_SEARCH_URL = 'https://api.coingecko.com/api/v3/search';

const CRYPTO_STOPWORDS = new Set([
    'what', 'whats', 'is', 'the', 'current', 'latest', 'live', 'today', 'now',
    'price', 'value', 'worth', 'rate', 'rates', 'cost', 'market', 'cap', 'cap?',
    'crypto', 'cryptocurrency', 'coin', 'token', 'usd', 'inr', 'eur', 'of', 'for',
    'in', 'per', 'a', 'an', 'check', 'show', 'me', 'tell', 'give', 'how', 'much'
]);

function extractCryptoQueryTerm(query) {
    const raw = String(query || '').trim();
    const cleaned = raw
        .replace(/[?!.,;:()[\]{}'"]/g, ' ')
        .split(/\s+/)
        .map(w => w.trim())
        .filter(w => w && !CRYPTO_STOPWORDS.has(w.toLowerCase()));
    return cleaned.slice(0, 3).join(' ').trim();
}

async function resolveDynamicCryptoAsset(query, options = {}) {
    const candidate = extractCryptoQueryTerm(query);
    if (!candidate) return null;
    const cacheKey = candidate.toLowerCase();
    const cached = CRYPTO_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.at < 30 * 60 * 1000) return cached.asset;

    try {
        const searchUrl = `${COINGECKO_SEARCH_URL}?query=${encodeURIComponent(candidate)}`;
        const resp = await fetchWithTimeout(searchUrl, {
            signal: options.signal,
            headers: { Accept: 'application/json' }
        }, Math.min(Number(options.timeoutMs) || 2500, 3000));
        if (resp?.ok) {
            const payload = await resp.json();
            const coins = Array.isArray(payload?.coins) ? payload.coins : [];
            const lower = candidate.toLowerCase();
            const exact = coins.find(c =>
                String(c?.symbol || '').toLowerCase() === lower ||
                String(c?.id || '').toLowerCase() === lower ||
                String(c?.name || '').toLowerCase() === lower
            ) || coins[0];
            if (exact?.id) {
                const asset = {
                    id: String(exact.id).toLowerCase(),
                    symbol: String(exact.symbol || candidate).toUpperCase(),
                    name: String(exact.name || exact.id)
                };
                if (CRYPTO_CACHE.size >= 200) CRYPTO_CACHE.delete(CRYPTO_CACHE.keys().next().value);
                CRYPTO_CACHE.set(cacheKey, { asset, at: Date.now() });
                return asset;
            }
        }
    } catch (_) {
        // Fall through to normalized candidate slug
    }

    const fallbackSlug = candidate.toLowerCase().replace(/\s+/g, '-');
    return {
        id: fallbackSlug,
        symbol: candidate.toUpperCase().slice(0, 10),
        name: formatCryptoName(fallbackSlug)
    };
}

export function resolveDateFilter(options = {}, query = '') {
    if (options.dateFilter) {
        const df = String(options.dateFilter).toLowerCase();
        if (df === 'day' || df === 'd') return { ddg: 'd', searx: 'day' };
        if (df === 'week' || df === 'w') return { ddg: 'w', searx: 'week' };
        if (df === 'month' || df === 'm') return { ddg: 'm', searx: 'month' };
        if (df === 'year' || df === 'y') return { ddg: 'y', searx: 'year' };
    }
    const scope = classifyTemporalScope(query);
    if (scope.isTimeSensitive && scope.filter) {
        return { ddg: scope.filter.ddg, searx: scope.filter.searx };
    }
    return null;
}

function reportSearchResponse(options, provider, response) {
    if (options.signal?.aborted || response?.ok && response.status !== 202) return;
    options.onDiagnostic?.({ provider, reason: response?.status ? `http_${response.status}` : 'provider_unavailable' });
}

export async function searchDuckDuckGoHtml(query, options = {}) {
    const limit = options.limit || 8;
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2500, 3500);
    const dateFilter = resolveDateFilter(options, query);

    const tryDdgLite = async (dfParam = dateFilter?.ddg) => {
        const body = dfParam
            ? `q=${encodeURIComponent(query)}&df=${encodeURIComponent(dfParam)}`
            : `q=${encodeURIComponent(query)}`;
        const response = await fetchWithTimeout('https://lite.duckduckgo.com/lite/', {
            method: 'POST',
            signal: options.signal,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br'
            },
            body
        }, timeoutMs);
        reportSearchResponse(options, 'duckduckgo', response);
        if (!response.ok || response.status === 202) return [];
        const html = await response.text();
        return extractDdgMatchedPairs(
            html,
            /<a\s+[^>]*class=['"]result-link['"][^>]*>([\s\S]*?)<\/a>/gi,
            /<td\s+[^>]*class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/gi,
            (match) => {
                const hrefMatch = /href=['"]([^'"]+)['"]/i.exec(match[0]);
                return { rawUrl: hrefMatch ? hrefMatch[1] : '', rawTitle: match[1] };
            },
            limit,
            query
        );
    };

    const tryDdgHtml = async (dfParam = dateFilter?.ddg) => {
        const url = dfParam
            ? `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&df=${encodeURIComponent(dfParam)}`
            : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const response = await fetchWithTimeout(url, {
            signal: options.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br'
            }
        }, timeoutMs);

        reportSearchResponse(options, 'duckduckgo', response);
        if (!response.ok || response.status === 202) return [];
        const html = await response.text();
        return extractDdgMatchedPairs(
            html,
            /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
            /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi,
            (match) => ({ rawUrl: match[1], rawTitle: match[2] }),
            limit,
            query
        );
    };

    function unwrapDdgUrl(rawUrl) {
        let url = String(rawUrl || '');
        if (url.includes('uddg=')) {
            try {
                const u = /uddg=([^&]+)/.exec(url);
                if (u) url = decodeURIComponent(u[1]);
            } catch (_) {}
        }
        if (url.startsWith('//')) url = `https:${url}`;
        return url;
    }

    function extractDdgMatchedPairs(html, linkRegex, snippetRegex, parseLink, maxResults, targetQuery) {
        const linkMatches = [...String(html || '').matchAll(linkRegex)];
        const snippetMatches = [...String(html || '').matchAll(snippetRegex)];
        const results = [];
        let sIdx = 0;

        for (let i = 0; i < linkMatches.length && results.length < maxResults; i++) {
            const match = linkMatches[i];
            const { rawUrl, rawTitle } = parseLink(match);
            const url = unwrapDdgUrl(rawUrl);
            const title = cleanSnippetText(rawTitle || '');
            const startPos = match.index + match[0].length;
            const endPos = i + 1 < linkMatches.length ? linkMatches[i + 1].index : html.length;

            while (sIdx < snippetMatches.length && snippetMatches[sIdx].index < startPos) {
                sIdx++;
            }
            let snip = '';
            if (sIdx < snippetMatches.length && snippetMatches[sIdx].index < endPos) {
                snip = cleanSnippetText(snippetMatches[sIdx][1]);
                sIdx++;
            }

            if (title && url && url.startsWith('http')) {
                const docDateMs = parseDocumentDate({ url, title, snippet: snip, description: snip });
                const dateStr = docDateMs ? formatDocumentDate(docDateMs) : '';
                results.push({
                    title,
                    description: snip,
                    snippet: snip,
                    url,
                    domain: getDomainFromUrl(url),
                    source: 'DuckDuckGo Web',
                    sourceType: 'live_web',
                    trusted: true,
                    date: dateStr,
                    publishedDate: dateStr,
                    publishedMs: docDateMs || 0,
                    freshness: dateStr || 'live_web_index',
                    qualitySignals: ['live_search_index', 'ddg_html'],
                    query: targetQuery
                });
            }
        }
        return results;
    }

    const tryDdgApi = async () => {
        const cleaned = query.replace(/\b(?:latest findings|latest updates|news|today|2024|2025|2026)\b/gi, '').trim();
        const apiTarget = cleaned.length >= 3 ? cleaned : query;
        const res = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(apiTarget)}&format=json`, {
            signal: options.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                Accept: 'application/json'
            }
        }, timeoutMs).catch(() => null);
        reportSearchResponse(options, 'duckduckgo', res);
        if (!res || !res.ok) return [];
        const data = await res.json().catch(() => null);
        if (!data) return [];
        const results = [];
        if (data.AbstractURL && (data.Heading || data.AbstractText)) {
            results.push({
                title: data.Heading || cleanSnippetText(data.AbstractText),
                description: cleanSnippetText(data.AbstractText || data.Heading),
                snippet: cleanSnippetText(data.AbstractText || data.Heading),
                url: data.AbstractURL,
                domain: getDomainFromUrl(data.AbstractURL),
                source: 'DuckDuckGo Web',
                sourceType: 'live_web',
                trusted: true,
                freshness: 'live_web_index',
                qualitySignals: ['live_search_index', 'ddg_api'],
                query
            });
        }
        const topics = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
        for (const topic of topics) {
            if (results.length >= limit) break;
            const topicUrl = topic.FirstURL || (topic.Topics?.[0]?.FirstURL);
            const topicText = topic.Text || (topic.Topics?.[0]?.Text);
            if (topicUrl && topicText && topicUrl.startsWith('http')) {
                results.push({
                    title: cleanSnippetText(topicText.split(' - ')[0] || topicText),
                    description: cleanSnippetText(topicText),
                    snippet: cleanSnippetText(topicText),
                    url: topicUrl,
                    domain: getDomainFromUrl(topicUrl),
                    source: 'DuckDuckGo Web',
                    sourceType: 'live_web',
                    trusted: true,
                    freshness: 'live_web_index',
                    qualitySignals: ['live_search_index', 'ddg_api'],
                    query
                });
            }
        }
        return results;
    };

    try {
        const results = await Promise.any([
            tryDdgLite().then(r => r && r.length ? r : Promise.reject()),
            tryDdgHtml().then(r => r && r.length ? r : Promise.reject())
        ]);
        return results;
    } catch (_) {
        if (dateFilter?.ddg) {
            try {
                const unconstrainedResults = await Promise.any([
                    tryDdgLite(null).then(r => r && r.length ? r : Promise.reject()),
                    tryDdgHtml(null).then(r => r && r.length ? r : Promise.reject())
                ]);
                return unconstrainedResults;
            } catch (_) {}
        }
        const apiResults = await tryDdgApi().catch(() => []);
        if (apiResults.length > 0) return apiResults;
        return [];
    }
}

export function parseSearXNGResults(data, query = '', limit = 8) {
    const hits = Array.isArray(data?.results) ? data.results : [];
    const results = [];
    for (let i = 0; i < hits.length && results.length < limit; i++) {
        const item = hits[i];
        const itemUrl = String(item?.url || '').trim();
        if (!itemUrl || !itemUrl.startsWith('http')) continue;
        const domain = getDomainFromUrl(itemUrl);
        const title = cleanSnippetText(item?.title || domain || 'Web Search Result');
        const content = cleanSnippetText(item?.content || item?.snippet || item?.description || '');
        const engine = String(item?.engine || (Array.isArray(item?.engines) ? item.engines[0] : '') || 'searxng').trim();

        const publishedDateStr = String(item?.publishedDate || item?.pubdate || item?.date || '').trim();
        const docDateMs = parseDocumentDate({ url: itemUrl, title, snippet: content, description: content, date: publishedDateStr });
        const dateStr = publishedDateStr || (docDateMs ? formatDocumentDate(docDateMs) : '');

        results.push({
            title,
            description: content || title,
            snippet: content || title,
            url: itemUrl,
            domain,
            source: engine ? `SearXNG (${engine})` : 'SearXNG Web',
            sourceType: 'live_web',
            trusted: true,
            date: dateStr,
            publishedDate: dateStr,
            publishedMs: docDateMs || 0,
            freshness: dateStr || 'live_web_index',
            qualitySignals: ['searxng_json', engine ? `engine_${engine}` : 'meta_engine'],
            query
        });
    }
    return results;
}

export async function searchSearXNGRacer(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 8, 1, 20);
    const timeoutMs = Math.min(options.timeoutMs || 2000, 2400);
    const dateFilter = resolveDateFilter(options, rawQ);
    const configuredUrl = String(process.env.SEARXNG_URL || process.env.SEARX_URL || '').trim().replace(/\/+$/, '');
    const endpoints = configuredUrl 
        ? [configuredUrl.endsWith('/search') ? configuredUrl : `${configuredUrl}/search`]
        : (Array.isArray(options.endpoints) && options.endpoints.length > 0 ? options.endpoints : VERIFIED_SEARXNG_POOL);

    const fetchSingleEndpoint = async (baseEndpoint, useDateFilter = true, signal = null) => {
        const url = new URL(baseEndpoint);
        url.searchParams.set('q', rawQ);
        url.searchParams.set('format', 'json');
        url.searchParams.set('categories', 'general');
        if (useDateFilter && dateFilter?.searx) {
            url.searchParams.set('time_range', dateFilter.searx);
        }

        const effectiveSignal = signal || options.signal;
        const fetchFn = options.fetchFn || fetchWithTimeout;
        const response = await fetchFn(url.toString(), {
            headers: {
                'Accept': 'application/json, text/javascript, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
            },
            signal: effectiveSignal
        }, timeoutMs);

        reportSearchResponse(options, 'searxng', response);
        return response;
    };

    // Legacy Fallback when SEARCH_CIRCUIT_BREAKER is disabled
    if (!isCircuitBreakerEnabled(options)) {
        const runLegacy = async (ep, useDf) => {
            const res = await fetchSingleEndpoint(ep, useDf);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            const results = parseSearXNGResults(data, rawQ, limit);
            if (!results.length) throw new Error('No results from endpoint');
            return results;
        };

        try {
            return await Promise.any(endpoints.map(ep => runLegacy(ep, true)));
        } catch (_) {
            if (dateFilter?.searx) {
                try {
                    return await Promise.any(endpoints.map(ep => runLegacy(ep, false)));
                } catch (_) {}
            }
            return [];
        }
    }

    // Circuit Breaker & Health Scorer Path
    const breaker = options.circuitBreakerRegistry || globalCircuitBreaker;
    const now = options.now ?? Date.now();
    const rng = options.rng ?? Math.random;

    const { primaryCandidates, secondaryCandidates, skippedOpen } = breaker.selectRacingCandidates(endpoints, { now, rng, limit: 4 });

    if (skippedOpen.length > 0 && options.verbose) {
        console.log(`[SearchRacer] Skipped OPEN endpoints: ${skippedOpen.join(', ')}`);
    }

    if (primaryCandidates.length === 0) {
        console.log('[SearchRacer] All SearXNG endpoints are OPEN. Falling through to non-SearXNG providers.');
        return [];
    }

    const raceTier = async (candidateList) => {
        const tierController = new AbortController();
        let clientAborted = false;

        const onClientAbort = () => {
            clientAborted = true;
            tierController.abort();
        };

        if (options.signal) {
            if (options.signal.aborted) {
                clientAborted = true;
                tierController.abort();
            } else {
                options.signal.addEventListener('abort', onClientAbort, { once: true });
            }
        }

        try {
            const tasks = candidateList.map(async (ep) => {
                const isProbe = breaker.getState(ep, now) === BREAKER_STATES.HALF_OPEN;
                if (isProbe) {
                    breaker.acquireProbeLease(ep);
                }

                const startTime = Date.now();
                const reqController = new AbortController();
                const onTierAbort = () => reqController.abort();
                tierController.signal.addEventListener('abort', onTierAbort, { once: true });

                let failureRecorded = false;
                try {
                    const response = await fetchSingleEndpoint(ep, true, reqController.signal);
                    const latencyMs = Date.now() - startTime;

                    if (!response.ok) {
                        const rawBody = await response.text().catch(() => '');
                        const outcome = classifyResponseOutcome({
                            status: response.status,
                            headers: response.headers,
                            body: rawBody,
                            isClientAbort: clientAborted || tierController.signal.reason === 'winner_found'
                        });
                        if (outcome && outcome !== FAILURE_TYPES.CLIENT_ABORT) {
                            failureRecorded = true;
                            breaker.recordFailure(ep, { type: outcome, reason: `HTTP ${response.status}`, latencyMs }, now, rng);
                        }
                        throw new Error(`HTTP ${response.status}`);
                    }

                    const rawText = await response.text();
                    const hasCfHeader = Boolean(response.headers?.['cf-mitigated'] || response.headers?.get?.('cf-mitigated'));
                    const trimmedRaw = rawText.trimStart();
                    const isHtmlChallenge = trimmedRaw && !trimmedRaw.startsWith('{') && /<(?:html|!doctype|head|title)/i.test(trimmedRaw);
                    const isChallenge = hasCfHeader || isHtmlChallenge || rawText.includes('cf-browser-verification') || rawText.includes('challenge-running') || /cf-turnstile|challenges\.cloudflare\.com\/turnstile/i.test(rawText);
                    if (isChallenge) {
                        failureRecorded = true;
                        breaker.recordFailure(ep, { type: FAILURE_TYPES.HARD_FAILURE, reason: 'bot_challenge', latencyMs }, now, rng);
                        throw new Error('bot_challenge');
                    }

                    let data;
                    try {
                        data = JSON.parse(rawText);
                    } catch (_) {
                        failureRecorded = true;
                        breaker.recordFailure(ep, { type: FAILURE_TYPES.SOFT_FAILURE, reason: 'invalid_json', latencyMs }, now, rng);
                        throw new Error('invalid_json');
                    }

                    const results = parseSearXNGResults(data, rawQ, limit);
                    if (!results.length) {
                        failureRecorded = true;
                        breaker.recordFailure(ep, { type: FAILURE_TYPES.SOFT_FAILURE, reason: 'empty_results', latencyMs }, now, rng);
                        throw new Error('empty_results');
                    }

                    // Success!
                    breaker.recordSuccess(ep, latencyMs, now);
                    tierController.abort('winner_found'); // hard-cancel other in-flight requests in tier
                    return results;
                } catch (err) {
                    const latencyMs = Date.now() - startTime;
                    const isOurAbort = tierController.signal.reason === 'winner_found';
                    if (!failureRecorded && !clientAborted && !isOurAbort) {
                        const isTimeout = err.name === 'TimeoutError' || (err.name === 'AbortError' && !reqController.signal.aborted);
                        const failType = isTimeout ? FAILURE_TYPES.TIMEOUT : FAILURE_TYPES.HARD_FAILURE;
                        breaker.recordFailure(ep, { type: failType, reason: err.message || failType, latencyMs }, now, rng);
                    }
                    throw err;
                }
 finally {
                    tierController.signal.removeEventListener('abort', onTierAbort);
                    if (isProbe) {
                        breaker.releaseProbeLease(ep);
                    }
                }
            });

            return await Promise.any(tasks);
        } finally {
            if (options.signal) {
                options.signal.removeEventListener('abort', onClientAbort);
            }
        }
    };

    try {
        return await raceTier(primaryCandidates);
    } catch (_) {
        // If all 4 in Tier 1 fail or return empty, immediately launch Tier 2
        if (secondaryCandidates.length > 0) {
            const tier2 = secondaryCandidates.slice(0, 4);
            try {
                return await raceTier(tier2);
            } catch (_) {}
        }
        return [];
    }
}


export const searchSearXNGJson = searchSearXNGRacer;

const GOOGLE_NEWS_URL_CACHE = new Map();
const GOOGLE_NEWS_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_GOOGLE_NEWS_CACHE_ENTRIES = 500;

/**
 * Decodes an opaque Google News redirect URL (/rss/articles/CBMi... or /articles/CBMi...)
 * into the direct original publisher URL using Google's batchExecute RPC.
 *
 * @param {string} googleNewsUrl - The redirect URL to decode
 * @param {Object} [options={}] - Options including timeoutMs and signal
 * @returns {Promise<string>} Direct publisher URL, or original URL if decoding fails
 */
export async function decodeGoogleNewsUrl(googleNewsUrl, options = {}) {
    const rawUrl = String(googleNewsUrl || '').trim();
    if (!rawUrl || !rawUrl.includes('news.google.com')) return rawUrl;

    const idMatch = rawUrl.match(/\/(?:rss\/)?articles\/([a-zA-Z0-9\-_]+)/);
    if (!idMatch) return rawUrl;
    const base64Str = idMatch[1];

    const cached = GOOGLE_NEWS_URL_CACHE.get(base64Str);
    if (cached && Date.now() - cached.cachedAt < GOOGLE_NEWS_CACHE_TTL_MS) {
        return cached.resolvedUrl;
    }

    const timeoutMs = Math.min(Number(options.timeoutMs) || 1800, 2500);

    try {
        const pageUrl = `https://news.google.com/rss/articles/${base64Str}`;
        const pageResp = await fetchWithTimeout(pageUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9'
            },
            signal: options.signal
        }, timeoutMs);

        if (!pageResp || !pageResp.ok) return rawUrl;
        const html = await pageResp.text();

        const sgMatch = html.match(/data-n-a-sg="([^"]+)"/);
        const tsMatch = html.match(/data-n-a-ts="([^"]+)"/);
        if (!sgMatch || !tsMatch) return rawUrl;

        const signature = sgMatch[1];
        const timestamp = tsMatch[1];

        const payload = [
            "Fbv4je",
            `["garturlreq",[["X","X",["X","X"],null,null,1,1,"US:en",null,1,null,null,null,null,null,0,1],"X","X",1,[1,1,1],1,1,null,0,0,null,0],"${base64Str}",${timestamp},"${signature}"]`
        ];
        const reqData = `f.req=${encodeURIComponent(JSON.stringify([[payload]]))}`;

        const rpcResp = await fetchWithTimeout("https://news.google.com/_/DotsSplashUi/data/batchexecute", {
            method: 'POST',
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://news.google.com/"
            },
            body: reqData,
            signal: options.signal
        }, timeoutMs);

        if (!rpcResp || !rpcResp.ok) return rawUrl;
        const text = await rpcResp.text();
        const splitParts = text.split(/\r?\n\r?\n/);
        const payloadBlock = splitParts.length >= 2 ? splitParts.slice(1).join('\n\n') : text;
        const jsonCandidate = payloadBlock
            .split(/\r?\n/)
            .map(line => line.trim())
            .find(line => line.startsWith('[['))
            || payloadBlock.replace(/^\s*\d+\s*\r?\n/, '').trim();
        if (jsonCandidate.startsWith('[')) {
            const parsedData = JSON.parse(jsonCandidate);
            const batchResponses = parsedData.filter(d => (d[0] === "wrb.fr" || d[0] === "w779db") && d[1] === "Fbv4je");
            if (batchResponses.length > 0) {
                const inner = JSON.parse(batchResponses[0][2]);
                const decodedUrl = inner[1];
                if (decodedUrl && typeof decodedUrl === 'string' && decodedUrl.startsWith('http')) {
                    if (GOOGLE_NEWS_URL_CACHE.size >= MAX_GOOGLE_NEWS_CACHE_ENTRIES) {
                        const oldest = GOOGLE_NEWS_URL_CACHE.keys().next().value;
                        GOOGLE_NEWS_URL_CACHE.delete(oldest);
                    }
                    GOOGLE_NEWS_URL_CACHE.set(base64Str, { cachedAt: Date.now(), resolvedUrl: decodedUrl });
                    return decodedUrl;
                }
            }
        }
        return rawUrl;
    } catch (_) {
        return rawUrl;
    }
}

export function parseGoogleNewsRssXml(xml, query, limit = 8) {
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

        let rawTitle = cleanSnippetText(titleMatch?.[1] || '');
        let link = decodeHtmlEntities(linkMatch?.[1] || '').trim();
        const pubDate = cleanSnippetText(pubDateMatch?.[1] || '');
        let desc = cleanSnippetText(descMatch?.[1] || '');
        const sourceUrl = decodeHtmlEntities(sourceMatch?.[1] || '').trim();
        const sourceName = cleanSnippetText(sourceMatch?.[2] || '');

        let publisher = sourceName;
        if (rawTitle.includes(' - ')) {
            const parts = rawTitle.split(' - ');
            if (!publisher && parts.length > 1) {
                publisher = parts[parts.length - 1].trim();
            }
        }

        if (rawTitle && link) {
            const sourceDomain = sourceUrl ? getDomainFromUrl(sourceUrl) : '';
            const linkDomain = getDomainFromUrl(link);
            const domain = (sourceDomain && !sourceDomain.includes('google.com'))
                ? sourceDomain
                : (linkDomain || 'news.google.com');

            items.push({
                title: rawTitle,
                description: desc || rawTitle,
                snippet: desc || rawTitle,
                url: link,
                domain: domain,
                publisherDomain: sourceDomain && !sourceDomain.includes('google.com') ? sourceDomain : '',
                publisherUrl: sourceUrl,
                discoveryUrl: link,
                originalUrl: link,
                publisher: publisher || domain,
                source: publisher ? `${publisher} (Google News)` : 'Google News',
                sourceType: 'trusted_news',
                sourceLabel: publisher ? `Google News / ${publisher}` : 'Google News',
                date: pubDate,
                freshness: pubDate || 'live_news',
                trusted: true,
                qualitySignals: ['google_news_rss', 'live_news'],
                confidence: 0.94,
                query
            });
        }
    }
    return items;
}

export async function searchGoogleNewsRss(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 8, 1, 20);
    const timeoutMs = Math.min(options.timeoutMs || 2200, 2800);
    try {
        const url = `https://news.google.com/rss/search?q=${encodeURIComponent(rawQ)}&hl=en&gl=US&ceid=US:en`;
        const response = await fetchWithTimeout(url, {
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
            },
            signal: options.signal
        }, Math.min(timeoutMs, 2000));
        if (!response || !response.ok) return [];
        const xml = await response.text();
        if (!xml || !xml.includes('<item>')) return [];
        const items = parseGoogleNewsRssXml(xml, rawQ, limit);

        // Concurrently decode Google News JS-redirect URLs into direct publisher links
        if (options.decodeUrls !== false && items.length > 0) {
            const decodeTimeout = Math.min(1800, timeoutMs);
            await Promise.allSettled(items.map(async (item) => {
                if (item.url && item.url.includes('news.google.com')) {
                    const resolved = await decodeGoogleNewsUrl(item.url, { timeoutMs: decodeTimeout, signal: options.signal });
                    if (resolved && resolved.startsWith('http') && !resolved.includes('news.google.com')) {
                        item.url = resolved;
                        const host = getDomainFromUrl(resolved);
                        if (host) item.domain = host;
                    }
                }
            }));
        }

        return items;
    } catch (_) {
        return [];
    }
}

export function parseYahooNewsRssXml(xml, query, limit = 6) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    const queryTokens = query ? String(query).toLowerCase().split(/\s+/).filter(t => t.length >= 3) : [];

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit * 3) {
        const itemBlock = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(itemBlock);
        const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemBlock);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemBlock);
        const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(itemBlock);
        const sourceMatch = /<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/i.exec(itemBlock);

        let rawTitle = cleanSnippetText(titleMatch?.[1] || '');
        let link = decodeHtmlEntities(linkMatch?.[1] || '').trim();
        const pubDate = cleanSnippetText(pubDateMatch?.[1] || '');
        let desc = cleanSnippetText(descMatch?.[1] || '');
        const sourceUrl = decodeHtmlEntities(sourceMatch?.[1] || '').trim();
        const sourceName = cleanSnippetText(sourceMatch?.[2] || '');

        if (!rawTitle || !link) continue;

        let publisher = sourceName || 'Yahoo News';
        if (rawTitle.includes(' - ')) {
            const parts = rawTitle.split(' - ');
            if (parts.length > 1) publisher = parts[parts.length - 1].trim();
        }

        const domain = sourceUrl ? getDomainFromUrl(sourceUrl) : (getDomainFromUrl(link) || 'yahoo.com');

        let relevance = 0;
        if (queryTokens.length > 0) {
            const textToScore = `${rawTitle} ${desc}`.toLowerCase();
            for (const token of queryTokens) {
                if (textToScore.includes(token)) relevance += 1;
            }
        }

        items.push({
            title: rawTitle,
            description: desc || rawTitle,
            snippet: desc || rawTitle,
            url: link,
            domain,
            publisher,
            source: publisher ? `${publisher} (Yahoo News)` : 'Yahoo News',
            sourceType: 'trusted_news',
            sourceLabel: publisher ? `Yahoo News / ${publisher}` : 'Yahoo News',
            date: pubDate,
            freshness: pubDate || 'live_news',
            trusted: true,
            qualitySignals: ['yahoo_news_rss', 'live_news'],
            confidence: 0.93,
            relevance,
            query
        });
    }

    if (queryTokens.length > 0) {
        const matching = items.filter(it => it.relevance > 0);
        if (matching.length > 0) {
            matching.sort((a, b) => b.relevance - a.relevance);
            return matching.slice(0, limit);
        }
    }

    return items.slice(0, limit);
}

export async function searchYahooNewsRss(query, options = {}) {
    const rawQ = String(query || '').trim();
    const limit = clampInt(options.limit, 6, 1, 15);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2200, 3000);
    try {
        const url = 'https://news.yahoo.com/rss/';
        const response = await fetchWithTimeout(url, {
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            signal: options.signal
        }, timeoutMs);
        if (!response || !response.ok) return [];
        const xml = await response.text();
        if (!xml || !xml.includes('<item>')) return [];
        return parseYahooNewsRssXml(xml, rawQ, limit);
    } catch (_) {
        return [];
    }
}

export function parseBingNewsRssXml(xml, query, limit = 6) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit) {
        const block = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(block);
        const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(block);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(block);
        const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(block);
        const sourceMatch = /<(?:News:Source|source)[^>]*>([\s\S]*?)<\/(?:News:Source|source)>/i.exec(block);

        const title = cleanSnippetText(titleMatch?.[1] || '');
        let link = decodeHtmlEntities(linkMatch?.[1] || '').trim();
        if (link.includes('url=')) {
            try {
                const parsed = new URL(link);
                const unwrapped = parsed.searchParams.get('url');
                if (unwrapped && unwrapped.startsWith('http')) link = unwrapped;
            } catch (_) {}
        }
        const pubDate = cleanSnippetText(pubDateMatch?.[1] || '');
        const desc = cleanSnippetText(descMatch?.[1] || '');
        const publisher = cleanSnippetText(sourceMatch?.[1] || '') || 'Bing News';

        if (!title || !link || !link.startsWith('http')) continue;
        const domain = getDomainFromUrl(link) || 'bing.com';
        const docDateMs = parseDocumentDate({ url: link, title, snippet: desc, description: desc, pubDate, publishedDate: pubDate });
        const dateStr = docDateMs ? formatDocumentDate(docDateMs) : pubDate;

        items.push({
            title,
            description: desc || title,
            snippet: desc || title,
            url: link,
            domain,
            publisher,
            source: publisher,
            sourceType: 'news',
            trusted: true,
            date: dateStr,
            publishedDate: dateStr,
            publishedMs: docDateMs || 0,
            freshness: dateStr || 'live_news',
            qualitySignals: ['bing_news_rss', 'live_news'],
            query
        });
    }
    return items;
}

export async function searchBingNewsRss(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 6, 1, 15);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://www.bing.com/news/search?q=${encodeURIComponent(rawQ)}&format=rss&mkt=en-US`;
        const response = await fetchWithTimeout(url, {
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            signal: options.signal
        }, timeoutMs);
        if (!response || !response.ok) return [];
        const xml = await response.text();
        if (!xml || !xml.includes('<item>')) return [];
        return parseBingNewsRssXml(xml, rawQ, limit);
    } catch (_) {
        return [];
    }
}

export function parseWorldWireRssXml(xml, query, limit = 6, providerName = 'BBC News', defaultDomain = 'bbc.co.uk') {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    const queryTokens = query ? String(query).toLowerCase().split(/\s+/).filter(t => t.length >= 3) : [];

    while ((match = itemRegex.exec(xml)) !== null && items.length < limit * 3) {
        const itemBlock = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/i.exec(itemBlock);
        const linkMatch = /<link>([\s\S]*?)<\/link>/i.exec(itemBlock);
        const pubDateMatch = /<pubDate>([\s\S]*?)<\/pubDate>/i.exec(itemBlock);
        const descMatch = /<description>([\s\S]*?)<\/description>/i.exec(itemBlock);

        let rawTitle = cleanSnippetText(titleMatch?.[1] || '');
        let link = decodeHtmlEntities(linkMatch?.[1] || '').trim();
        const pubDate = cleanSnippetText(pubDateMatch?.[1] || '');
        let desc = cleanSnippetText(descMatch?.[1] || '');

        if (!rawTitle || !link) continue;

        const domain = getDomainFromUrl(link) || defaultDomain;

        let relevance = 0;
        if (queryTokens.length > 0) {
            const textToScore = `${rawTitle} ${desc}`.toLowerCase();
            for (const token of queryTokens) {
                if (textToScore.includes(token)) relevance += 1;
            }
        }

        items.push({
            title: rawTitle,
            description: desc || rawTitle,
            snippet: desc || rawTitle,
            url: link,
            domain,
            publisher: providerName,
            source: `${providerName} World News`,
            sourceType: 'trusted_news',
            sourceLabel: `${providerName} / World News`,
            date: pubDate,
            freshness: pubDate || 'live_news',
            trusted: true,
            qualitySignals: ['world_wire_rss', 'live_news'],
            confidence: 0.94,
            relevance,
            query
        });
    }

    if (queryTokens.length > 0) {
        const matching = items.filter(it => it.relevance > 0);
        if (matching.length > 0) {
            matching.sort((a, b) => b.relevance - a.relevance);
            return matching.slice(0, limit);
        }
    }

    return items.slice(0, limit);
}

export async function searchWorldWireRss(query, options = {}) {
    const rawQ = String(query || '').trim();
    const limit = clampInt(options.limit, 6, 1, 15);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2000, 2500);
    try {
        const url = 'http://feeds.bbci.co.uk/news/world/rss.xml';
        const response = await fetchWithTimeout(url, {
            headers: {
                'Accept': 'application/rss+xml, application/xml, text/xml, */*',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
            },
            signal: options.signal
        }, timeoutMs);
        if (!response || !response.ok) return [];
        const xml = await response.text();
        if (!xml || !xml.includes('<item>')) return [];
        return parseWorldWireRssXml(xml, rawQ, limit, 'BBC News', 'bbc.co.uk');
    } catch (_) {
        return [];
    }
}

export async function searchYahooFinanceQuotes(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];

    // Financial intent guards: only query Yahoo Finance if the query explicitly mentions
    // stocks, ticker, price, quote, shares, market cap, or contains an explicit $TICKER,
    // or is strictly a standalone ticker symbol (1-5 chars).
    // This prevents generic words like "can", "in", "to", "for" from querying Canaan Inc. or other stocks.
    const hasFinancialContext = /\b(?:stock|stocks|ticker|quote|quotes|shares?|price|pricing|market\s+cap|nyse|nasdaq|crypto|dividend|earnings|etf|forex|valuation|trading)\b/i.test(rawQ);
    const dollarMatch = rawQ.match(/\$([A-Za-z]{1,5})\b/);
    const isStandaloneTicker = /^[A-Za-z]{1,5}(?:\.[A-Za-z]{1,3})?$/i.test(rawQ) && !/^(?:the|and|for|with|what|who|how|when|where|this|that|can|are|was|were|will|have|has|had|not|yes|all|any|our|you|she|his|her|its|one|two|six|ten)$/i.test(rawQ);

    if (!hasFinancialContext && !dollarMatch && !isStandaloneTicker) {
        return [];
    }

    let symbol = '';
    if (dollarMatch) {
        symbol = dollarMatch[1].toUpperCase();
    } else if (isStandaloneTicker) {
        symbol = rawQ.trim().toUpperCase();
    } else {
        const contextMatch = rawQ.match(/\b([A-Z]{1,5}|[A-Z]{1,5}-[A-Z]{2,4})\b/)
            || rawQ.match(/(?:stock|shares?|quote|price\s+of)\s+([A-Za-z]{1,5})\b/i)
            || rawQ.match(/\b([A-Za-z]{1,5})\s+(?:stock|shares?|quote|price)\b/i);
        if (!contextMatch) return [];
        symbol = (contextMatch[1] || contextMatch[0]).toUpperCase();
    }
    const timeoutMs = Math.min(options.timeoutMs || 1800, 2200);
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
        const response = await fetchWithTimeout(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            },
            signal: options.signal
        }, timeoutMs);
        if (!response.ok) return [];
        const data = await response.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta || !meta.regularMarketPrice) return [];
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || meta.previousClose;
        const change = prevClose ? (price - prevClose).toFixed(2) : '0.00';
        const changePct = prevClose ? (((price - prevClose) / prevClose) * 100).toFixed(2) : '0.00';
        const currency = meta.currency || 'USD';
        const name = meta.shortName || meta.symbol || symbol;
        const sign = Number(change) >= 0 ? '+' : '';
        return [{
            title: `${name} (${symbol}): ${price} ${currency} (${sign}${change} / ${sign}${changePct}%)`,
            description: `${name} (${symbol}) is trading at ${price} ${currency} (${sign}${change} / ${sign}${changePct}%).`,
            snippet: `${name} (${symbol}) is trading at ${price} ${currency} (${sign}${change} / ${sign}${changePct}%).`,
            url: `https://finance.yahoo.com/quote/${encodeURIComponent(symbol)}`,
            domain: 'finance.yahoo.com',
            source: 'Yahoo Finance',
            sourceType: 'financial_market',
            trusted: true,
            freshness: 'real_time_quote',
            qualitySignals: ['live_market_quote', 'yahoo_finance'],
            query: rawQ
        }];
    } catch (_) {
        return [];
    }
}

export function parseWikipediaInfobox(wikitext) {
    if (!wikitext || typeof wikitext !== 'string') return null;
    const cleanValue = (text) => {
        if (!text) return '';
        let s = String(text);
        s = s.replace(/<ref[^>]*>.*?<\/ref>/gis, '');
        s = s.replace(/<[^>]+>/g, ' ');
        s = s.replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1');
        s = s.replace(/\{\{(?:unbulleted\s+list|ubl|flatlist|plainlist|hlist|bulleted\s+list)\s*\|([\s\S]*?)\}\}/gi, (_, body) => {
            return body.replace(/^\s*\*\s*/gm, ', ').split('|').join(', ');
        });
        s = s.replace(/\{\{(?:start\s+date\s+and\s+age|start\s+date|launch\s+date)\|([^{}]+)\}\}/gi, (_, body) => {
            return body.split('|').filter(x => /^\d+$/.test(x.trim())).join('-');
        });
        s = s.replace(/\{\{[a-zA-Z0-9_\s-]+\|([^{}]+)\}\}/gi, '$1');
        s = s.replace(/\{\{[^}]*\}\}/g, ' ');
        s = s.replace(/^\s*\*\s*/gm, ', ');
        return s.replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').replace(/^,\s*/, '').trim();
    };

    const startIdx = wikitext.search(/\{\{Infobox/i);
    if (startIdx === -1) return null;
    let depth = 0;
    let boxContent = '';
    for (let i = startIdx; i < wikitext.length; i++) {
        if (wikitext[i] === '{' && wikitext[i + 1] === '{') {
            depth++;
            i++;
        } else if (wikitext[i] === '}' && wikitext[i + 1] === '}') {
            depth--;
            i++;
            if (depth <= 0) {
                boxContent = wikitext.slice(startIdx, i + 1);
                break;
            }
        }
    }
    if (!boxContent) boxContent = wikitext.slice(startIdx);

    const fields = {};
    const fieldRegex = /^\s*\|\s*([a-zA-Z0-9_-]+)\s*=\s*([\s\S]*?)(?=^\s*\|\s*[a-zA-Z0-9_-]+\s*=|(?:\n\s*\}\}\s*$)|$)/gm;
    let match;
    while ((match = fieldRegex.exec(boxContent)) !== null) {
        const key = match[1].toLowerCase().trim();
        const val = cleanValue(match[2]);
        if (val && val.length > 1) {
            fields[key] = val;
        }
    }

    const structured = [];
    if (fields.key_people) structured.push(`Key people: ${fields.key_people}`);
    if (fields.founders || fields.founder) structured.push(`Founders: ${fields.founders || fields.founder}`);
    if (fields.ceo) structured.push(`CEO: ${fields.ceo}`);
    if (fields.president) structured.push(`President: ${fields.president}`);
    if (fields.incumbent) structured.push(`Incumbent: ${fields.incumbent}${fields.incumbent_since ? ` (since ${fields.incumbent_since})` : ''}`);
    if (fields.leader) structured.push(`Leader: ${fields.leader}`);
    if (fields.after_election) structured.push(`Elected: ${fields.after_election}`);
    if (fields.prime_minister) structured.push(`Prime Minister: ${fields.prime_minister}`);
    if (fields.chief_minister) structured.push(`Chief Minister: ${fields.chief_minister}`);
    if (fields.governor) structured.push(`Governor: ${fields.governor}`);
    if (fields.mayor) structured.push(`Mayor: ${fields.mayor}`);
    if (fields.cfo) structured.push(`CFO: ${fields.cfo}`);
    if (fields.coo) structured.push(`COO: ${fields.coo}`);
    if (fields.cto) structured.push(`CTO: ${fields.cto}`);
    if (fields.chairperson || fields.chairman) structured.push(`Chairperson: ${fields.chairperson || fields.chairman}`);
    if (fields.leader_name || fields.leader_name1 || fields.leader_name2) {
        const leaders = [
            fields.leader_title ? `${fields.leader_title}: ${fields.leader_name}` : fields.leader_name,
            fields.leader_title1 ? `${fields.leader_title1}: ${fields.leader_name1}` : fields.leader_name1,
            fields.leader_title2 ? `${fields.leader_title2}: ${fields.leader_name2}` : fields.leader_name2
        ].filter(Boolean);
        if (leaders.length) structured.push(leaders.join(', '));
    }
    if (fields.hq_location || fields.headquarters || fields.location) structured.push(`Headquarters: ${fields.hq_location || fields.headquarters || fields.location}`);
    if (fields.founded || fields.established || fields.foundation) structured.push(`Founded: ${fields.founded || fields.established || fields.foundation}`);

    return {
        fields,
        summary: structured.join(' | ')
    };
}

export async function fetchWikipediaInfobox(title, options = {}) {
    if (!title) return null;
    try {
        const parseUrl = `https://en.wikipedia.org/w/api.php?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&section=0&format=json`;
        const res = await fetchWithTimeout(parseUrl, { headers: { 'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)' }, signal: options.signal }, Math.min(Number(options.timeoutMs) || 5000, 5000));
        if (!res.ok) return null;
        const data = await res.json();
        const wikitext = data?.parse?.wikitext?.['*'];
        return parseWikipediaInfobox(wikitext);
    } catch (_) {
        return null;
    }
}

export async function searchWikipediaApi(query, options = {}) {
    const limit = options.limit || 3;
    try {
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&utf8=&format=json&srlimit=${limit}`;
        const res = await fetchWithTimeout(searchUrl, { headers: { 'User-Agent': 'UnifyAssistant/2.0 (https://github.com/unify; contact@unify.ai)' } }, 5000);
        if (!res.ok) return [];
        const data = await res.json();
        const list = data?.query?.search || [];
        
        const results = await Promise.all(list.map(async (item) => {
            const rawTitle = cleanSnippetText(item.title);
            let description = item.snippet ? cleanSnippetText(item.snippet) : `Wikipedia overview of ${rawTitle}`;
            
            // For top relevant Wikipedia hits, fetch and merge structured Infobox data
            const infobox = await fetchWikipediaInfobox(rawTitle).catch(() => null);
            if (infobox && infobox.summary) {
                description = `${description} | Infobox: ${infobox.summary}`;
            }

            return {
                title: rawTitle,
                description,
                snippet: description,
                url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`,
                source: 'Wikipedia',
                sourceType: 'reference_lookup',
                trusted: true,
                freshness: 'current_encyclopedia',
                qualitySignals: ['open_knowledge_graph', 'wikipedia_api', infobox?.summary ? 'infobox_extracted' : ''].filter(Boolean),
                infobox: infobox?.fields || null,
                query
            };
        }));

        return results;
    } catch (_) {
        return [];
    }
}

export async function searchGdeltNews(query, options = {}) {
    const limit = options.limit || 3;
    try {
        const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${limit}&format=json&timespan=14d`;
        const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } }, 2500);
        if (!res.ok) return [];
        const data = await res.json();
        const articles = data?.articles || [];
        return articles.map(art => ({
            title: art.title || 'Breaking Global News',
            description: art.seendate ? `Published: ${art.seendate} | Source: ${art.domain}` : `News report from ${art.domain || 'global media'}`,
            snippet: art.title,
            url: art.url,
            source: art.domain || 'GDELT Global News',
            sourceType: 'news',
            trusted: true,
            freshness: 'recent_news',
            qualitySignals: ['live_news_stream', 'gdelt_project'],
            query
        }));
    } catch (_) {
        return [];
    }
}

export function mergeResultsRRF(lists = [], limit = 8) {
    const k = 60;
    const byUrl = new Map();
    for (const items of lists) {
        if (!Array.isArray(items)) continue;
        items.forEach((item, rank) => {
            const url = String(item?.url || '').trim();
            if (!url) return;
            const key = url.toLowerCase();
            const rrf = 1 / (k + rank + 1);
            const freshnessBoost = item?.publishedMs && (Date.now() - item.publishedMs) < 30 * 86400000 ? 0.004 : 0;
            const existing = byUrl.get(key);
            if (existing) {
                existing.__rrf += rrf + freshnessBoost;
                if ((item.description || '').length > (existing.item.description || '').length) {
                    existing.item = { ...existing.item, description: item.description, snippet: item.snippet || item.description };
                }
            } else {
                byUrl.set(key, { __rrf: rrf + freshnessBoost + (item.trusted ? 0.002 : 0), item });
            }
        });
    }
    return [...byUrl.values()]
        .sort((a, b) => b.__rrf - a.__rrf)
        .slice(0, clampInt(limit, 8, 1, 20))
        .map(entry => entry.item);
}

export async function searchHackerNewsAlgolia(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 5, 1, 15);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodeURIComponent(rawQ)}&tags=story&hitsPerPage=${limit}`;
        const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
        if (!response?.ok) return [];
        const data = await response.json().catch(() => null);
        const hits = Array.isArray(data?.hits) ? data.hits : [];
        return hits.filter(h => (h.url || h.objectID) && (h.title || h.story_text)).slice(0, limit).map((hit, idx) => {
            const link = hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`;
            const title = cleanSnippetText(hit.title || '');
            const summaryText = cleanSnippetText(hit.story_text || `Hacker News discussion (${hit.points || 0} points, ${hit.num_comments || 0} comments) on ${title}`);
            const dateStr = hit.created_at ? formatDocumentDate(Date.parse(hit.created_at)) : '';
            return {
                title,
                description: summaryText.slice(0, 320),
                snippet: summaryText.slice(0, 320),
                url: link,
                domain: getDomainFromUrl(link) || 'news.ycombinator.com',
                publisher: 'Hacker News',
                source: 'Hacker News',
                sourceType: 'news',
                trusted: true,
                date: dateStr || hit.created_at || '',
                publishedDate: dateStr || hit.created_at || '',
                publishedMs: hit.created_at ? Date.parse(hit.created_at) || 0 : 0,
                freshness: dateStr || 'recent_tech',
                qualitySignals: ['hacker_news_algolia', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        });
    } catch (_) {
        return [];
    }
}

export async function searchGitHubRepos(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 4, 1, 10);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(rawQ)}&sort=updated&order=desc&per_page=${limit}`;
        const response = await fetchWithTimeout(url, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'UnifyAssistantFreeLive/1.0' },
            signal: options.signal
        }, timeoutMs);
        if (!response?.ok) return [];
        const data = await response.json().catch(() => null);
        const items = Array.isArray(data?.items) ? data.items : [];
        return items.filter(r => r.html_url && r.full_name).slice(0, limit).map((repo, idx) => {
            const updatedMs = repo.pushed_at ? Date.parse(repo.pushed_at) || 0 : 0;
            const dateStr = updatedMs ? formatDocumentDate(updatedMs) : '';
            const desc = cleanSnippetText(`${repo.description || ''} Language: ${repo.language || 'N/A'} | Stars: ${repo.stargazers_count || 0}${repo.license?.spdx_id ? ` | License: ${repo.license.spdx_id}` : ''}${dateStr ? ` | Updated: ${dateStr}` : ''}`);
            return {
                title: `${repo.full_name} (GitHub)`,
                description: desc.slice(0, 320),
                snippet: desc.slice(0, 320),
                url: repo.html_url,
                domain: 'github.com',
                publisher: 'GitHub',
                source: 'GitHub Repositories',
                sourceType: 'live_web',
                trusted: true,
                date: dateStr,
                publishedDate: dateStr,
                publishedMs: updatedMs,
                freshness: dateStr || 'live_code_index',
                qualitySignals: ['github_api', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        });
    } catch (_) {
        return [];
    }
}

export async function searchArxivPapers(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 4, 1, 10);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2600, 4000);
    try {
        const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(rawQ)}&start=0&max_results=${limit}&sortBy=submittedDate&sortOrder=descending`;
        const response = await fetchWithTimeout(url, {
            headers: { Accept: 'application/atom+xml, application/xml, text/xml', 'User-Agent': 'UnifyAssistantFreeLive/1.0' },
            signal: options.signal
        }, timeoutMs);
        if (!response?.ok) return [];
        const xml = await response.text();
        const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)];
        return entries.slice(0, limit).map((m, idx) => {
            const block = m[1];
            const title = cleanSnippetText((/<title>([\s\S]*?)<\/title>/i.exec(block)?.[1]) || '');
            const summaryText = cleanSnippetText((/<summary>([\s\S]*?)<\/summary>/i.exec(block)?.[1]) || '');
            const idUrl = decodeHtmlEntities((/<id>([\s\S]*?)<\/id>/i.exec(block)?.[1]) || '').trim();
            const pub = cleanSnippetText((/<published>([\s\S]*?)<\/published>/i.exec(block)?.[1]) || '');
            const pubMs = pub ? Date.parse(pub) || 0 : 0;
            const dateStr = pubMs ? formatDocumentDate(pubMs) : pub;
            if (!title || !idUrl) return null;
            return {
                title,
                description: summaryText.slice(0, 340),
                snippet: summaryText.slice(0, 340),
                url: idUrl,
                domain: 'arxiv.org',
                publisher: 'arXiv',
                source: 'arXiv Preprints',
                sourceType: 'live_web',
                trusted: true,
                date: dateStr,
                publishedDate: dateStr,
                publishedMs: pubMs,
                freshness: dateStr || 'arxiv_latest',
                qualitySignals: ['arxiv_api', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        }).filter(Boolean);
    } catch (_) {
        return [];
    }
}

export async function searchTechRss(query, options = {}) {
    const rawQ = String(query || '').trim();
    const limit = clampInt(options.limit, 5, 1, 15);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2200, 3000);
    const feeds = [
        ['Ars Technica', 'arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/technology-lab'],
        ['The Verge', 'theverge.com', 'https://www.theverge.com/rss/index.xml']
    ];
    const settled = await Promise.allSettled(feeds.map(async ([name, dom, feedUrl]) => {
        const res = await fetchWithTimeout(feedUrl, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: options.signal }, timeoutMs);
        if (!res?.ok) return [];
        const xml = await res.text();
        return parseWorldWireRssXml(xml, rawQ, limit, name, dom);
    }));
    const tokens = tokenize(rawQ);
    return settled
        .flatMap(s => s.status === 'fulfilled' ? s.value : [])
        .filter(item => !tokens.length || matchesTerms(`${item.title} ${item.description}`, tokens))
        .slice(0, limit);
}

export async function searchTechSources(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const settled = await Promise.allSettled([
        searchHackerNewsAlgolia(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchGitHubRepos(query, { limit: 3, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchArxivPapers(query, { limit: 3, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchTechRss(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchBingNewsRss(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchDuckDuckGoHtml(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal })
    ]);
    return mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);
}

export async function searchNhtsaVehicles(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2500, 3800);
    const yearMatch = rawQ.match(/\b(199\d|20[0-2]\d)\b/);
    const year = yearMatch?.[1] || String(new Date().getUTCFullYear());
    let cleanWords = rawQ.replace(/\b(?:199\d|20[0-2]\d|recall|recalls|safety|rating|ratings|reviews?|specs?|mpg|horsepower|vs|versus|compare|car|vehicle)\b/gi, ' ').trim().split(/\s+/).filter(Boolean);
    if (cleanWords.length >= 3) cleanWords = cleanWords.filter(w => !/^(?:suv|sedan|truck|ev)$/i.test(w));
    if (cleanWords.length < 2) return [];
    const make = cleanWords[0];
    const model = cleanWords[1];
    try {
        const recallUrl = `https://api.nhtsa.gov/recalls/recallsByVehicle?make=${encodeURIComponent(make)}&model=${encodeURIComponent(model)}&modelYear=${encodeURIComponent(year)}`;
        const ratingUrl = `https://api.nhtsa.gov/SafetyRatings/modelyear/${encodeURIComponent(year)}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}?format=json`;
        const [recallsRes, ratingsRes] = await Promise.allSettled([
            fetchWithTimeout(recallUrl, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs),
            fetchWithTimeout(ratingUrl, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs)
        ]);
        const items = [];
        if (recallsRes.status === 'fulfilled' && recallsRes.value?.ok) {
            const data = await recallsRes.value.json().catch(() => null);
            const recs = Array.isArray(data?.results) ? data.results : [];
            if (recs.length) {
                const topSummary = recs.slice(0, 3).map(r => `${r.Component || 'Recall'}: ${cleanSnippetText(r.Summary || r.Consequence || '')}`).join(' | ');
                items.push({
                    title: `NHTSA Recalls for ${year} ${make} ${model} (${recs.length} found)`,
                    description: topSummary.slice(0, 360),
                    snippet: topSummary.slice(0, 360),
                    url: `https://www.nhtsa.gov/recalls?nhtsaId=${encodeURIComponent(recs[0].NHTSACampaignNumber || '')}`,
                    domain: 'nhtsa.gov',
                    publisher: 'U.S. NHTSA',
                    source: 'NHTSA Recalls API',
                    sourceType: 'live_web',
                    trusted: true,
                    date: recs[0].ReportReceivedDate || year,
                    freshness: 'official_safety_data',
                    qualitySignals: ['nhtsa_api', 'free_public_api'],
                    query: rawQ
                });
            }
        }
        if (ratingsRes.status === 'fulfilled' && ratingsRes.value?.ok) {
            const rData = await ratingsRes.value.json().catch(() => null);
            const models = Array.isArray(rData?.Results) ? rData.Results : [];
            if (models.length) {
                items.push({
                    title: `NHTSA Safety Ratings: ${year} ${make} ${model}`,
                    description: `Official NHTSA safety records available for trims: ${models.slice(0, 3).map(m => m.VehicleDescription).join('; ')}.`,
                    snippet: `Official NHTSA safety records for ${models.slice(0, 3).map(m => m.VehicleDescription).join('; ')}.`,
                    url: `https://www.nhtsa.gov/ratings`,
                    domain: 'nhtsa.gov',
                    publisher: 'U.S. NHTSA',
                    source: 'NHTSA Safety Ratings API',
                    sourceType: 'live_web',
                    trusted: true,
                    date: year,
                    freshness: 'official_safety_data',
                    qualitySignals: ['nhtsa_api', 'free_public_api'],
                    query: rawQ
                });
            }
        }
        return items;
    } catch (_) {
        return [];
    }
}

export async function searchVehicleSources(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const settled = await Promise.allSettled([
        searchNhtsaVehicles(query, { timeoutMs: options.timeoutMs, signal: options.signal }),
        searchBingNewsRss(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchDuckDuckGoHtml(query, { limit: 5, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchWikipediaApi(query, { limit: 2, timeoutMs: options.timeoutMs, signal: options.signal })
    ]);
    return mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);
}

export async function searchReliefWebReports(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 4, 1, 10);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://api.reliefweb.int/v1/reports?appname=unify-assistant&query[value]=${encodeURIComponent(rawQ)}&limit=${limit}&preset=latest&fields[include][]=title&fields[include][]=url&fields[include][]=date.created&fields[include][]=source.shortname`;
        const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
        if (!response?.ok) return [];
        const data = await response.json().catch(() => null);
        const rows = Array.isArray(data?.data) ? data.data : [];
        return rows.map((row, idx) => {
            const f = row?.fields || {};
            const created = f?.date?.created || '';
            const pubMs = created ? Date.parse(created) || 0 : 0;
            const dateStr = pubMs ? formatDocumentDate(pubMs) : created;
            const org = Array.isArray(f.source) ? f.source.map(s => s.shortname).filter(Boolean).join(', ') : 'UN ReliefWeb';
            return {
                title: cleanSnippetText(f.title || ''),
                description: `${org || 'ReliefWeb'} geopolitical/humanitarian report${dateStr ? ` published ${dateStr}` : ''}: ${cleanSnippetText(f.title || '')}`,
                snippet: `${org || 'ReliefWeb'} report${dateStr ? ` (${dateStr})` : ''}: ${cleanSnippetText(f.title || '')}`,
                url: f.url || 'https://reliefweb.int/',
                domain: 'reliefweb.int',
                publisher: org || 'UN ReliefWeb',
                source: 'UN ReliefWeb',
                sourceType: 'trusted_news',
                trusted: true,
                date: dateStr,
                publishedDate: dateStr,
                publishedMs: pubMs,
                freshness: dateStr || 'recent_affairs',
                qualitySignals: ['reliefweb_api', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        }).filter(r => r.title && r.url);
    } catch (_) {
        return [];
    }
}

export async function searchFederalRegisterDocs(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 4, 1, 10);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://www.federalregister.gov/api/v1/documents.json?conditions[term]=${encodeURIComponent(rawQ)}&per_page=${limit}&order=newest`;
        const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
        if (!response?.ok) return [];
        const data = await response.json().catch(() => null);
        const docs = Array.isArray(data?.results) ? data.results : [];
        return docs.filter(d => d.title && d.html_url).map((doc, idx) => {
            const pubMs = doc.publication_date ? Date.parse(doc.publication_date) || 0 : 0;
            const dateStr = pubMs ? formatDocumentDate(pubMs) : (doc.publication_date || '');
            const desc = cleanSnippetText(doc.abstract || `${doc.type || 'Official document'} (${dateStr || 'recent'})`);
            return {
                title: cleanSnippetText(doc.title),
                description: desc.slice(0, 340),
                snippet: desc.slice(0, 340),
                url: doc.html_url,
                domain: 'federalregister.gov',
                publisher: 'U.S. Federal Register',
                source: 'Federal Register',
                sourceType: 'trusted_news',
                trusted: true,
                date: dateStr,
                publishedDate: dateStr,
                publishedMs: pubMs,
                freshness: dateStr || 'official_policy',
                qualitySignals: ['federal_register_api', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        });
    } catch (_) {
        return [];
    }
}

export async function searchGeopoliticsAndAffairs(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2200, 3000);
    const fetchAffairsFeed = async (name, dom, feedUrl) => {
        try {
            const res = await fetchWithTimeout(feedUrl, { headers: { Accept: 'application/rss+xml, application/xml, text/xml, */*' }, signal: options.signal }, timeoutMs);
            if (!res?.ok) return [];
            return parseWorldWireRssXml(await res.text(), query, 4, name, dom);
        } catch (_) { return []; }
    };
    const settled = await Promise.allSettled([
        searchReliefWebReports(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchFederalRegisterDocs(query, { limit: 3, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchWorldWireRss(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        fetchAffairsFeed('UN News', 'news.un.org', 'https://news.un.org/feed/subscribe/en/news/all/rss.xml'),
        searchBingNewsRss(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchGdeltNews(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal })
    ]);
    return mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);
}

export async function searchLibraryOfCongress(query, options = {}) {
    const rawQ = String(query || '').trim();
    if (!rawQ) return [];
    const limit = clampInt(options.limit, 4, 1, 10);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2500, 3500);
    try {
        const url = `https://www.loc.gov/search/?q=${encodeURIComponent(rawQ)}&fo=json&c=${limit}`;
        const response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
        if (!response?.ok) return [];
        const data = await response.json().catch(() => null);
        const rows = Array.isArray(data?.results) ? data.results : [];
        return rows.filter(r => r.title && r.url).slice(0, limit).map((row, idx) => {
            const desc = Array.isArray(row.description) ? row.description.join(' ') : String(row.description || '');
            return {
                title: cleanSnippetText(row.title),
                description: cleanSnippetText(desc || `Historical archival record from Library of Congress (${row.date || 'undated'})`).slice(0, 340),
                snippet: cleanSnippetText(desc || row.title).slice(0, 340),
                url: row.url,
                domain: 'loc.gov',
                publisher: 'Library of Congress',
                source: 'Library of Congress',
                sourceType: 'free_reference',
                trusted: true,
                date: String(row.date || ''),
                freshness: 'archival_reference',
                qualitySignals: ['loc_api', 'free_public_api'],
                position: idx + 1,
                query: rawQ
            };
        });
    } catch (_) {
        return [];
    }
}

export async function searchHistoryAndReference(query, options = {}) {
    const limit = clampInt(options.limit, 8, 1, 20);
    const settled = await Promise.allSettled([
        searchWikipediaApi(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchLibraryOfCongress(query, { limit: 4, timeoutMs: options.timeoutMs, signal: options.signal }),
        searchDuckDuckGoHtml(query, { limit: 5, timeoutMs: options.timeoutMs, signal: options.signal })
    ]);
    return mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);
}

export async function searchWikivoyageGuide(topic, query, options = {}) {
    const cleanTopic = String(topic || query || '').trim();
    if (!cleanTopic) return [];
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2400, 3500);
    try {
        const url = `https://en.wikivoyage.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(cleanTopic)}&srlimit=3&format=json&origin=*`;
        const res = await fetchWithTimeout(url, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
        if (!res?.ok) return [];
        const data = await res.json().catch(() => null);
        const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
        return hits.map((hit, idx) => {
            const title = String(hit.title || '').trim();
            const slug = encodeURIComponent(title.replace(/\s+/g, '_'));
            const snip = cleanSnippetText(hit.snippet || '');
            return {
                title: `${title} — Wikivoyage Travel & Transit Guide`,
                description: snip.slice(0, 320),
                snippet: snip.slice(0, 320),
                url: `https://en.wikivoyage.org/wiki/${slug}`,
                domain: 'en.wikivoyage.org',
                publisher: 'Wikivoyage',
                source: 'Wikivoyage',
                sourceType: 'free_reference',
                trusted: true,
                freshness: 'travel_guide',
                qualitySignals: ['wikivoyage_api', 'free_public_api'],
                position: idx + 1,
                query
            };
        }).filter(r => r.title);
    } catch (_) {
        return [];
    }
}

export async function searchTransportAndItineraries(query, options = {}) {
    const rawQ = String(query || '').trim();
    const limit = clampInt(options.limit, 8, 1, 20);
    const timeoutMs = Math.min(Number(options.timeoutMs) || 2600, 4000);
    const topic = extractPlaceTopic(rawQ) || cleanQueryTarget(rawQ);
    const routeMatch = rawQ.match(/\bfrom\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})\s+to\s+([a-zA-Z][a-zA-Z\s.'-]{1,40})(?:[?.,]|$|\s+(?:by|on|in|for))/i);

    const routeTask = routeMatch ? (async () => {
        try {
            const geocode = async (place) => {
                const u = `${NOMINATIM_SEARCH_URL}?q=${encodeURIComponent(place.trim())}&format=jsonv2&limit=1`;
                const r = await fetchWithTimeout(u, { headers: { Accept: 'application/json', 'User-Agent': 'UnifyAssistantFreeLive/1.0' }, signal: options.signal }, timeoutMs);
                if (!r?.ok) return null;
                const d = await r.json().catch(() => null);
                return Array.isArray(d) && d[0] ? d[0] : null;
            };
            const [orig, dest] = await Promise.all([geocode(routeMatch[1]), geocode(routeMatch[2])]);
            if (!orig || !dest) return [];
            const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${orig.lon},${orig.lat};${dest.lon},${dest.lat}?overview=false`;
            const osrmRes = await fetchWithTimeout(osrmUrl, { headers: { Accept: 'application/json' }, signal: options.signal }, timeoutMs);
            if (!osrmRes?.ok) return [];
            const osrmData = await osrmRes.json().catch(() => null);
            const route = osrmData?.routes?.[0];
            if (!route) return [];
            const km = (Number(route.distance) / 1000).toFixed(1);
            const mins = Math.round(Number(route.duration) / 60);
            const hours = (mins / 60).toFixed(1);
            return [{
                title: `Route Estimate: ${routeMatch[1].trim()} to ${routeMatch[2].trim()}`,
                description: `Estimated road distance: ${km} km | Estimated driving duration: ${mins} minutes (~${hours} hours) via OSRM public routing.`,
                snippet: `Estimated distance: ${km} km (~${mins} min driving) from ${routeMatch[1].trim()} to ${routeMatch[2].trim()}.`,
                url: `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${orig.lat}%2C${orig.lon}%3B${dest.lat}%2C${dest.lon}`,
                domain: 'openstreetmap.org',
                publisher: 'OSRM / OpenStreetMap',
                source: 'OSRM Routing',
                sourceType: 'free_place_data',
                trusted: true,
                freshness: 'estimated_route',
                qualitySignals: ['osrm_api', 'free_public_api'],
                query: rawQ
            }];
        } catch (_) {
            return [];
        }
    })() : Promise.resolve([]);

    const settled = await Promise.allSettled([
        routeTask,
        searchWikivoyageGuide(topic, rawQ, { timeoutMs, signal: options.signal }),
        topic ? searchOsmPlace(topic, rawQ, { limit: 3, timeoutMs, signal: options.signal }) : Promise.resolve([]),
        searchBingNewsRss(rawQ, { limit: 4, timeoutMs, signal: options.signal }),
        searchDuckDuckGoHtml(rawQ, { limit: 4, timeoutMs, signal: options.signal })
    ]);
    return mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);
}

export async function runFreeLiveSearch(query, route = {}, options = {}) {
    const category = String(route?.category || '').trim() || inferCategory(query);
    const limit = clampInt(options.limit, 8, 1, 20);
    if (category === 'weather') return searchWeather(query, { limit });
    if (category === 'crypto') return searchCrypto(query, { limit });
    if (category === 'disasters') return searchDisasters(query, { limit });
    if (category === 'sports') return searchSports(query, { limit });
    if (category === 'transportation_itineraries') {
        const transportResults = await searchTransportAndItineraries(query, { limit, timeoutMs: options.timeoutMs, signal: options.signal });
        if (transportResults.length > 0) {
            return { results: transportResults, provider: 'free_transport_itinerary', publicSourceCount: transportResults.length, category };
        }
    }
    if (category === 'tourism_food_places') {
        const placeRes = await searchTourismFoodPlaces(query, { limit });
        if (Array.isArray(placeRes?.results) && placeRes.results.length > 0) {
            return placeRes;
        }
    }

    const raceTimeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : undefined;
    if (category === 'technology') {
        const techResults = await searchTechSources(query, { limit, timeoutMs: raceTimeoutMs, signal: options.signal });
        if (techResults.length > 0) return { results: techResults, provider: 'free_tech_vertical', publicSourceCount: techResults.length, category };
    }
    if (category === 'vehicles') {
        const vehicleResults = await searchVehicleSources(query, { limit, timeoutMs: raceTimeoutMs, signal: options.signal });
        if (vehicleResults.length > 0) return { results: vehicleResults, provider: 'free_vehicles_vertical', publicSourceCount: vehicleResults.length, category };
    }
    if (category === 'conflicts_geopolitics' || category === 'government') {
        const affairsResults = await searchGeopoliticsAndAffairs(query, { limit, timeoutMs: raceTimeoutMs, signal: options.signal });
        if (affairsResults.length > 0) return { results: affairsResults, provider: 'free_affairs_vertical', publicSourceCount: affairsResults.length, category };
    }
    if (category === 'history') {
        const historyResults = await searchHistoryAndReference(query, { limit, timeoutMs: raceTimeoutMs, signal: options.signal });
        if (historyResults.length > 0) return { results: historyResults, provider: 'free_history_vertical', publicSourceCount: historyResults.length, category };
    }

    // Universal Zero-Key Multi-Engine Parallel Fast-Race with Reciprocal Rank Fusion
    const settled = await Promise.allSettled([
        searchGoogleNewsRss(query, { limit: 5, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchBingNewsRss(query, { limit: 5, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchYahooNewsRss(query, { limit: 4, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchWorldWireRss(query, { limit: 4, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchDuckDuckGoHtml(query, { limit: 6, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchWikipediaApi(query, { limit: 3, timeoutMs: raceTimeoutMs, signal: options.signal }),
        searchGdeltNews(query, { limit: 3, timeoutMs: raceTimeoutMs, signal: options.signal })
    ]);

    const results = mergeResultsRRF(settled.map(s => s.status === 'fulfilled' ? s.value : []), limit);

    if (results.length > 0) {
        return {
            results: results.slice(0, limit),
            provider: 'free_multi_engine_race',
            publicSourceCount: results.length,
            category: category || 'general_live_web'
        };
    }

    return {
        results: [],
        provider: 'free_public_sources',
        publicSourceCount: 0,
        warnings: [`No live results found for "${query}".`],
        unsupported: true,
        category: category || 'unsupported_free_live'
    };
}

export async function searchWeather(query, options = {}) {
    const location = extractLocation(query);
    if (!location) {
        return unsupportedFreeLive(query, 'weather', 'Weather needs a location. Ask with a city, for example "weather in Chennai".');
    }
    const source = FREE_LIVE_SOURCES.openMeteo;
    try {
        const geocodeUrl = new URL(OPEN_METEO_GEOCODE_URL);
        geocodeUrl.searchParams.set('name', location);
        geocodeUrl.searchParams.set('count', '1');
        geocodeUrl.searchParams.set('language', 'en');
        geocodeUrl.searchParams.set('format', 'json');
        const geoResponse = await fetchWithTimeout(geocodeUrl.toString(), {
            headers: { Accept: 'application/json' }
        }, source.timeoutMs);
        if (!geoResponse.ok) return emptyProvider('open-meteo', 'Weather location lookup failed.');
        const geo = await geoResponse.json();
        const place = Array.isArray(geo?.results) ? geo.results[0] : null;
        if (!place) return emptyProvider('open-meteo', `No weather location matched "${location}".`);

        const forecastUrl = new URL(OPEN_METEO_FORECAST_URL);
        forecastUrl.searchParams.set('latitude', String(place.latitude));
        forecastUrl.searchParams.set('longitude', String(place.longitude));
        forecastUrl.searchParams.set('current', 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m');
        forecastUrl.searchParams.set('daily', 'temperature_2m_max,temperature_2m_min,precipitation_probability_max');
        forecastUrl.searchParams.set('timezone', 'auto');
        const isUsPoint = Number(place.latitude) >= 24 && Number(place.latitude) <= 50 && Number(place.longitude) >= -125 && Number(place.longitude) <= -66;
        const aqiUrl = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(String(place.latitude))}&longitude=${encodeURIComponent(String(place.longitude))}&current=us_aqi,pm2_5`;
        const [forecastResponse, aqiRes, nwsRes] = await Promise.all([
            fetchWithTimeout(forecastUrl.toString(), { headers: { Accept: 'application/json' } }, source.timeoutMs),
            fetchWithTimeout(aqiUrl, { headers: { Accept: 'application/json' } }, Math.min(source.timeoutMs, 2200)).catch(() => null),
            isUsPoint ? fetchWithTimeout(`https://api.weather.gov/alerts/active?point=${Number(place.latitude).toFixed(4)},${Number(place.longitude).toFixed(4)}`, { headers: { Accept: 'application/geo+json', 'User-Agent': 'UnifyAssistantFreeLive/1.0' } }, Math.min(source.timeoutMs, 2200)).catch(() => null) : Promise.resolve(null)
        ]);
        if (!forecastResponse.ok) return emptyProvider('open-meteo', 'Weather forecast lookup failed.');
        const forecast = await forecastResponse.json();
        const aqiData = aqiRes?.ok ? await aqiRes.json().catch(() => null) : null;
        const nwsData = nwsRes?.ok ? await nwsRes.json().catch(() => null) : null;
        const activeAlert = Array.isArray(nwsData?.features) && nwsData.features[0]?.properties?.headline ? nwsData.features[0].properties.headline : '';
        const current = forecast?.current || {};
        const units = forecast?.current_units || {};
        const titleLocation = [place.name, place.admin1, place.country].filter(Boolean).join(', ');
        const description = [
            Number.isFinite(Number(current.temperature_2m)) ? `Temperature: ${current.temperature_2m}${units.temperature_2m || 'C'}` : '',
            Number.isFinite(Number(current.apparent_temperature)) ? `Feels like: ${current.apparent_temperature}${units.apparent_temperature || 'C'}` : '',
            Number.isFinite(Number(current.relative_humidity_2m)) ? `Humidity: ${current.relative_humidity_2m}${units.relative_humidity_2m || '%'}` : '',
            Number.isFinite(Number(current.wind_speed_10m)) ? `Wind: ${current.wind_speed_10m} ${units.wind_speed_10m || 'km/h'}` : '',
            Number.isFinite(Number(aqiData?.current?.us_aqi)) ? `US AQI: ${aqiData.current.us_aqi}` : '',
            activeAlert ? `Alert: ${cleanSnippetText(activeAlert)}` : ''
        ].filter(Boolean).join(' | ');
        return oneResult({
            title: `Current weather for ${titleLocation}`,
            description: description || 'Open-Meteo returned current weather conditions.',
            url: 'https://open-meteo.com/',
            source: source.name,
            sourceType: 'free_weather',
            freshness: 'current_model_data',
            trusted: true,
            qualitySignals: ['free_public_api', 'weather_model'],
            query
        }, 'open-meteo', 'weather');
    } catch (err) {
        return emptyProvider('open-meteo', `Weather lookup temporarily unavailable: ${err?.message || 'timeout'}`);
    }
}

export async function searchCrypto(query, options = {}) {
    const asset = await resolveDynamicCryptoAsset(query, options);
    const id = asset?.id || '';
    if (!id) return unsupportedFreeLive(query, 'crypto', 'Crypto price lookup needs an asset name or ticker symbol.');
    const source = FREE_LIVE_SOURCES.coingecko;
    const url = new URL(COINGECKO_SIMPLE_PRICE_URL);
    url.searchParams.set('ids', id);
    url.searchParams.set('vs_currencies', 'usd,inr');
    url.searchParams.set('include_24hr_change', 'true');
    let usd = NaN;
    let inr = NaN;
    let change = NaN;
    try {
        const response = await fetchWithTimeout(url.toString(), {
            signal: options.signal,
            headers: { Accept: 'application/json' }
        }, source.timeoutMs);
        if (response.ok) {
            const data = await response.json();
            const item = data?.[id] || {};
            usd = Number(item.usd);
            inr = Number(item.inr);
            change = Number(item.usd_24h_change);
        }
    } catch {
        // Fall through to fallback provider
    }

    if (!Number.isFinite(usd) && !Number.isFinite(inr)) {
        try {
            const sym = asset?.symbol || id.toUpperCase();
            const fallbackResp = await fetchWithTimeout(`https://api.coinbase.com/v2/prices/${encodeURIComponent(sym)}-USD/spot`, {
                signal: options.signal,
                headers: { Accept: 'application/json' }
            }, source.timeoutMs);
            if (fallbackResp.ok) {
                const fbData = await fallbackResp.json();
                usd = Number(fbData?.data?.amount);
            }
        } catch {
            // Ignore fallback network error
        }
    }

    if (!Number.isFinite(usd) && !Number.isFinite(inr)) return emptyProvider('coingecko', 'CoinGecko public price lookup failed.');
    return oneResult({
        title: `${asset?.name || formatCryptoName(id)} public price`,
        description: [
            Number.isFinite(usd) ? `USD ${usd}` : '',
            Number.isFinite(inr) ? `INR ${inr}` : '',
            Number.isFinite(change) ? `24h USD change ${change.toFixed(2)}%` : ''
        ].filter(Boolean).join(' | '),
        url: 'https://www.coingecko.com/',
        source: source.name,
        sourceType: 'free_crypto_price',
        freshness: 'public_price_snapshot',
        trusted: true,
        qualitySignals: ['free_public_api', 'market_snapshot'],
        query
    }, 'coingecko', 'crypto');
}

export async function searchDisasters(query, options = {}) {
    const source = FREE_LIVE_SOURCES.eonet;
    const url = new URL(EONET_EVENTS_URL);
    url.searchParams.set('status', 'open');
    url.searchParams.set('limit', String(clampInt(options.limit, 8, 1, 20)));
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return emptyProvider('nasa-eonet', 'NASA EONET lookup failed.');
    const data = await response.json();
    const terms = tokenize(query);
    const events = Array.isArray(data?.events) ? data.events : [];
    const results = events
        .filter(event => matchesTerms(`${event?.title || ''} ${event?.categories?.map(c => c.title).join(' ') || ''}`, terms))
        .slice(0, clampInt(options.limit, 8, 1, 20))
        .map((event, index) => normalizeResult({
            title: String(event?.title || 'Natural event').trim(),
            description: buildEonetDescription(event),
            url: String(event?.sources?.[0]?.url || 'https://eonet.gsfc.nasa.gov/').trim(),
            source: source.name,
            sourceType: 'free_disaster_event',
            date: String(event?.geometry?.[0]?.date || '').trim(),
            freshness: 'open_event',
            trusted: true,
            qualitySignals: ['free_public_api', 'natural_event_tracker'],
            position: index + 1,
            query
        }));
    return summary(results, 'nasa-eonet', 'disasters', results.length ? [] : ['No matching open NASA EONET event was found.']);
}

export async function searchSports(query, options = {}) {
    const league = extractSportsLeague(query);
    if (!league) {
        return unsupportedFreeLive(query, 'sports', 'Free sports coverage needs a league or sport name; live scores may be unavailable on permanent-free sources.');
    }
    const source = FREE_LIVE_SOURCES.theSportsDb;
    const url = new URL(SPORT_SEARCH_URL);
    url.searchParams.set('l', league);
    const response = await fetchWithTimeout(url.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return emptyProvider('thesportsdb', 'TheSportsDB lookup failed.');
    const data = await response.json();
    const teams = Array.isArray(data?.teams) ? data.teams : [];
    const results = teams.slice(0, clampInt(options.limit, 8, 1, 20)).map((team, index) => normalizeResult({
        title: String(team?.strTeam || team?.strAlternate || 'Sports team').trim(),
        description: String(team?.strDescriptionEN || team?.strLeague || source.limitations).replace(/\s+/g, ' ').trim().slice(0, 260),
        url: String(team?.strWebsite ? `https://${String(team.strWebsite).replace(/^https?:\/\//i, '')}` : 'https://www.thesportsdb.com/').trim(),
        source: source.name,
        sourceType: 'free_sports_reference',
        freshness: 'sports_reference',
        trusted: false,
        qualitySignals: ['free_public_api', 'limited_sports_coverage'],
        position: index + 1,
        query
    }));
    return summary(results, 'thesportsdb', 'sports', results.length ? ['Free sports live-score coverage is limited.'] : ['No free sports source result matched this request.']);
}

export async function searchTourismFoodPlaces(query, options = {}) {
    const topic = extractPlaceTopic(query);
    if (!topic) {
        return unsupportedFreeLive(query, 'tourism_food_places', 'Place or tourism lookup needs a place or topic.');
    }
    const [wiki, osm] = await Promise.allSettled([
        searchWikipediaTopic(topic, query, options),
        searchOsmPlace(topic, query, options)
    ]);
    const results = [
        ...(wiki.status === 'fulfilled' ? wiki.value : []),
        ...(osm.status === 'fulfilled' ? osm.value : [])
    ].map(item => attachPlaceEvidence(query, item, topic))
        .filter(item => isRelevantPlaceResult(query, item, topic))
        .slice(0, clampInt(options.limit, 8, 1, 20));
    const warnings = [
        'Free place data does not include reliable reviews, rankings, or open-now guarantees.'
    ];
    if (!results.length) {
        warnings.push('No source-backed matching place was found. Do not name specific attractions unless the user clarifies the place or spelling.');
    }
    return summary(results, 'wikimedia+openstreetmap', 'tourism_food_places', warnings);
}

function unsupportedFreeLive(query, category, message = 'No durable permanent-free live source is configured for this request.') {
    return {
        results: [],
        provider: 'unsupported_free_live',
        publicSourceCount: 0,
        warnings: [message],
        unsupported: true,
        category,
        query
    };
}

function emptyProvider(provider, warning) {
    return {
        results: [],
        provider,
        publicSourceCount: 0,
        warnings: [warning],
        unsupported: false
    };
}

function oneResult(item, provider, category) {
    return summary([normalizeResult(item)], provider, category, []);
}

function summary(results, provider, category, warnings = []) {
    return {
        results,
        provider,
        publicSourceCount: results.length,
        warnings,
        unsupported: false,
        category
    };
}

async function searchWikipediaTopic(topic, query, options = {}) {
    const source = FREE_LIVE_SOURCES.wikimedia;
    const searchUrl = new URL(WIKIPEDIA_SEARCH_URL);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', topic);
    searchUrl.searchParams.set('srlimit', String(Math.min(3, clampInt(options.limit, 8, 1, 20))));
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('origin', '*');
    const response = await fetchWithTimeout(searchUrl.toString(), {
        headers: { Accept: 'application/json' }
    }, source.timeoutMs);
    if (!response.ok) return [];
    const data = await response.json();
    const hits = Array.isArray(data?.query?.search) ? data.query.search : [];
    const results = [];
    for (const hit of hits) {
        const title = String(hit?.title || '').trim();
        if (!title) continue;
        const summaryUrl = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
        const summaryResponse = await fetchWithTimeout(summaryUrl, {
            headers: { Accept: 'application/json' }
        }, source.timeoutMs).catch(() => null);
        const summaryData = summaryResponse?.ok ? await summaryResponse.json() : null;
        results.push(normalizeResult({
            title,
            description: String(summaryData?.extract || hit?.snippet || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 260),
            url: String(summaryData?.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`),
            source: source.name,
            sourceType: 'free_reference',
            freshness: 'reference',
            trusted: true,
            qualitySignals: ['free_public_api', 'reference_source'],
            query
        }));
    }
    return results;
}

async function searchOsmPlace(topic, query, options = {}) {
    const source = FREE_LIVE_SOURCES.osm;
    const url = new URL(NOMINATIM_SEARCH_URL);
    url.searchParams.set('q', topic);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', String(Math.min(3, clampInt(options.limit, 8, 1, 20))));
    const response = await fetchWithTimeout(url.toString(), {
        headers: {
            Accept: 'application/json',
            'User-Agent': 'UnifyAssistantFreeLive/1.0'
        }
    }, source.timeoutMs);
    if (!response.ok) return [];
    const data = await response.json();
    const places = Array.isArray(data) ? data : [];
    return places.map((place, index) => normalizeResult({
        title: String(place?.name || place?.display_name || 'OpenStreetMap place').trim(),
        description: String(place?.display_name || source.limitations).trim().slice(0, 260),
        url: String(place?.osm_id ? `https://www.openstreetmap.org/${place?.osm_type || 'node'}/${place.osm_id}` : 'https://www.openstreetmap.org/'),
        source: source.name,
        sourceType: 'free_place_data',
        freshness: 'map_reference',
        trusted: false,
        qualitySignals: ['free_public_api', 'open_map_data'],
        position: index + 1,
        query
    }));
}

export function isRelevantPlaceResult(query, result, topicOverride = '') {
    const evidence = scorePlaceEvidence(query, result, topicOverride);
    if (evidence.exactishMatch) return true;
    if (evidence.evidenceLevel === 'none') return false;
    const topic = normalizePlaceTopic(topicOverride || extractPlaceTopic(query));
    const topicTokens = topic.split(/\s+/).filter(token => token.length > 2);
    if (!topicTokens.length) return false;
    const requiresPlaceType = /\b(museum|museums|temple|park|beach|fort|palace|landmark|attraction|attractions|restaurant|hotel)\b/i.test(String(query || ''));
    if (requiresPlaceType && evidence.relevanceScore < Math.min(1, 2 / Math.max(topicTokens.length, 1))) return false;
    return evidence.relevanceScore >= Math.ceil(topicTokens.length * 0.67) / topicTokens.length;
}

export function scorePlaceEvidence(query, result, topicOverride = '') {
    const topic = normalizePlaceTopic(topicOverride || extractPlaceTopic(query));
    if (!topic) return {
        title: String(result?.title || '').trim(),
        url: String(result?.url || '').trim(),
        sourceType: String(result?.sourceType || '').trim(),
        relevanceScore: 0,
        exactishMatch: false,
        evidenceLevel: 'none'
    };
    const title = normalizePlaceTopic(result?.title || '');
    const description = normalizePlaceTopic(result?.description || '');
    const hay = `${title} ${description}`.trim();
    if (!hay) return {
        title: String(result?.title || '').trim(),
        url: String(result?.url || '').trim(),
        sourceType: String(result?.sourceType || '').trim(),
        relevanceScore: 0,
        exactishMatch: false,
        evidenceLevel: 'none'
    };
    const exactishMatch = title === topic || title.includes(topic) || topic.includes(title);
    const topicTokens = topic.split(/\s+/).filter(token => token.length > 2);
    if (!topicTokens.length) return {
        title: String(result?.title || '').trim(),
        url: String(result?.url || '').trim(),
        sourceType: String(result?.sourceType || '').trim(),
        relevanceScore: exactishMatch ? 1 : 0,
        exactishMatch,
        evidenceLevel: exactishMatch ? 'strong' : 'none'
    };
    const overlap = topicTokens.filter(token => hay.includes(token)).length;
    const requiresPlaceType = /\b(museum|museums|temple|park|beach|fort|palace|landmark|attraction|attractions|restaurant|hotel)\b/i.test(String(query || ''));
    const overlapScore = overlap / topicTokens.length;
    const relevanceScore = exactishMatch ? Math.max(0.9, overlapScore) : overlapScore;
    const evidenceLevel = relevanceScore >= 0.9 || (relevanceScore >= 0.67 && !requiresPlaceType)
        ? 'strong'
        : (relevanceScore >= 0.5 ? 'weak' : 'none');
    return {
        title: String(result?.title || '').trim(),
        url: String(result?.url || '').trim(),
        sourceType: String(result?.sourceType || '').trim(),
        relevanceScore,
        exactishMatch,
        evidenceLevel
    };
}

function attachPlaceEvidence(query, item, topic) {
    const evidence = scorePlaceEvidence(query, item, topic);
    return {
        ...item,
        relevanceScore: evidence.relevanceScore,
        exactishMatch: evidence.exactishMatch,
        evidenceLevel: evidence.evidenceLevel
    };
}

function normalizeResult(item) {
    const url = String(item?.url || '').trim();
    return {
        title: String(item?.title || '').trim(),
        description: String(item?.description || '').trim(),
        url,
        domain: getDomainFromUrl(url),
        source: String(item?.source || '').trim(),
        sourceType: String(item?.sourceType || 'free_public_source').trim(),
        sourceLabel: String(item?.source || '').trim(),
        date: String(item?.date || '').trim(),
        freshness: String(item?.freshness || 'unknown').trim(),
        position: Number(item?.position) || 1,
        trusted: Boolean(item?.trusted),
        qualitySignals: Array.isArray(item?.qualitySignals) ? item.qualitySignals.map(String) : ['free_public_source'],
        query: String(item?.query || '').trim()
    };
}

function normalizePlaceTopic(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/<[^>]*>/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\b(?:the|a|an|nearby|near|me|museum|museums|place|places|attraction|attractions|restaurant|restaurants|hotel|hotels|visit|tourist|tourism|in|at|of|for|to)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function inferCategory(query) {
    const t = String(query || '').toLowerCase();
    if (/\bweather|forecast|temperature|aqi|air quality\b/.test(t)) return 'weather';
    if (/\bbitcoin|btc|ethereum|eth|crypto\b/.test(t)) return 'crypto';
    if (/\bsports?|score|fixture|standings|ipl|nba|nfl|epl\b/.test(t)) return 'sports';
    if (/\bearthquake|wildfire|flood|cyclone|hurricane|tsunami|volcano\b/.test(t)) return 'disasters';
    if (/\b(?:itinerary|itineraries|day trip|days in|plan a?\s*trip|route from|how to get (?:from|to)|public transit|metro|subway|train route|airport transfer|transportation)\b/i.test(t)) return 'transportation_itineraries';
    if (/\b(?:places to visit|tourist attractions?|sightseeing|things to do in|hotels? in|museums? in|temples? in)\b/i.test(t)) return 'tourism_food_places';
    if (/\b(?:car|cars|vehicle|vehicles|suv|sedan|truck|motorcycle|ev|electric vehicle|mpg|horsepower|recall|safety rating|automotive)\b/i.test(t)) return 'vehicles';
    if (/\b(?:history of|historical|ancient|medieval|dynasty|empire|revolution|treaty of|world war|century|archaeolog)\b/i.test(t)) return 'history';
    if (/\b(?:war|conflict|ceasefire|invasion|sanctions|treaty|geopolitics|parliament|election|cabinet|foreign policy|global affairs|diploma)\b/i.test(t)) return 'conflicts_geopolitics';
    if (/\b(?:hardware|software|processor|semiconductor|chip|gpu|cpu|ai model|llm|technology|tech news|open source|github)\b/i.test(t)) return 'technology';
    return 'general_live_web';
}

function extractLocation(query) {
    const text = String(query || '')
        .replace(/[?.!]+$/g, '')
        .replace(/\b(?:right\s+now|today|tonight|tomorrow|currently|this\s+(?:week|weekend|month)|forecast|weather|temperature)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const match = text.match(/\b(?:in|at|for|near|around)\s+([a-zA-Z][a-zA-Z\s.,'-]{1,80})$/i);
    if (match?.[1]) return cleanQueryTarget(match[1]);
    return '';
}

function extractSportsLeague(query) {
    const t = String(query || '').toLowerCase();
    const aliases = [
        ['ipl', 'Indian Premier League'],
        ['nba', 'NBA'],
        ['nfl', 'NFL'],
        ['epl', 'English Premier League'],
        ['premier league', 'English Premier League'],
        ['cricket', 'Indian Premier League'],
        ['football', 'English Premier League'],
        ['soccer', 'English Premier League']
    ];
    for (const [key, value] of aliases) {
        if (t.includes(key)) return value;
    }
    return '';
}

function extractPlaceTopic(query) {
    const text = String(query || '')
        .replace(/\b(latest|current|today|now|near me|open now|best|top|show me|find|search)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const match = text.match(/\b(?:in|at|near|around)\s+(.+)$/i);
    return cleanQueryTarget(match?.[1] || text).slice(0, 120);
}

function formatCryptoName(id) {
    return String(id || '').split('-').map(part => part ? `${part[0].toUpperCase()}${part.slice(1)}` : '').join(' ');
}

function buildEonetDescription(event) {
    const categories = Array.isArray(event?.categories) ? event.categories.map(c => c?.title).filter(Boolean).join(', ') : '';
    const date = String(event?.geometry?.[0]?.date || '').trim();
    return [categories ? `Category: ${categories}` : '', date ? `Observed: ${date}` : 'Open natural event'].filter(Boolean).join(' | ');
}

function tokenize(text) {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []));
}

function matchesTerms(text, terms) {
    if (!terms.length) return true;
    const lower = String(text || '').toLowerCase();
    return terms.some(term => lower.includes(term));
}

function getDomainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

async function fetchWithTimeout(url, init = {}, timeoutMs = 2500) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let abortListener = null;
    if (init?.signal) {
        if (init.signal.aborted) {
            controller.abort();
        } else {
            abortListener = () => controller.abort();
            init.signal.addEventListener('abort', abortListener, { once: true });
        }
    }
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
        if (init?.signal && abortListener) {
            init.signal.removeEventListener('abort', abortListener);
        }
    }
}

function clampInt(value, fallback, min, max) {
    const n = Number.parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

export const __test = {
    cleanQueryTarget,
    extractQueryTargetMetadata,
    extractCryptoId: (q) => extractCryptoQueryTerm(q).toLowerCase().replace(/\s+/g, '-'),
    resolveDynamicCryptoAsset,
    extractLocation,
    extractPlaceTopic,
    extractSportsLeague,
    isRelevantPlaceResult,
    scorePlaceEvidence,
    normalizeResult,
    parseSearXNGResults,
    searchSearXNGJson,
    searchSearXNGRacer,
    searchGoogleNewsRss,
    decodeGoogleNewsUrl,
    searchYahooNewsRss,
    searchWorldWireRss,
    searchYahooFinanceQuotes,
    getCircuitBreakerDebugState
};

export { getCircuitBreakerDebugState };
