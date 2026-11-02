/**
 * @file api/_lib/article-extractor.js
 * @description Milestone 2: Resilient Article Scraping & Readability Extractor (v2)
 *
 * Implements:
 *   1. Domain Failure Cache with TTL (prevents repeat requests to bot-blocked 403/429 hosts).
 *   2. URL Content Cache with TTL (avoids re-fetching identical URLs across query iterations).
 *   3. Browser-like Request Header Profiles (Desktop Chrome and Mobile Safari).
 *   4. Scoped DOM / Readability Extraction (stripping nav, aside, trending, widgets, ads).
 *   5. Relevance Gating (filters out sidebar pollution; if < 2 relevant paragraphs remain,
 *      treats extraction as failed and falls back to search snippet).
 */

import { cleanSnippetText, decodeHtmlEntities } from './snippet-sanitizer.js';
import { researchTimeoutSignal } from '../../app/search/research-contract.mjs';
import { fetchPublicPage, isPublicWebUrl } from './public-web-url.js';
import { assessSourceRelevance, researchTerms } from './research-evidence.js';

// =========================================================================
// Caching & Domain Health State
// =========================================================================

const DOMAIN_FAILURE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ARTICLE_CACHE_TTL_MS = 15 * 60 * 1000;  // 15 minutes
const MAX_CACHE_ENTRIES = 500;

/** @type {Map<string, { failedAt: number, reason: string }>} */
const DOMAIN_FAILURE_CACHE = new Map();

/** @type {Map<string, { cachedAt: number, data: Object }>} */
const ARTICLE_CONTENT_CACHE = new Map();

/**
 * Extracts normalized hostname from URL
 */
export function extractHostname(url) {
    try {
        const parsed = new URL(String(url || '').trim());
        return parsed.hostname.toLowerCase().replace(/^www\./, '');
    } catch (_) {
        return '';
    }
}

/**
 * Checks if a domain is temporarily suspended due to bot-blocking or consecutive errors.
 */
export function isDomainTemporarilyBlocked(domain) {
    const host = String(domain || '').toLowerCase().trim();
    if (!host) return false;
    const entry = DOMAIN_FAILURE_CACHE.get(host);
    if (!entry) return false;
    const ttl = entry.reason === 'timeout' ? 30000 : DOMAIN_FAILURE_TTL_MS;
    if (Date.now() - entry.failedAt < ttl) {
        return true;
    }
    DOMAIN_FAILURE_CACHE.delete(host);
    return false;
}

/**
 * Records a domain failure (403, 429, challenge page, timeout).
 */
export function recordDomainFailure(domain, reason = 'bot_blocked') {
    const host = String(domain || '').toLowerCase().trim();
    if (!host) return;
    if (DOMAIN_FAILURE_CACHE.size >= MAX_CACHE_ENTRIES) {
        const oldest = DOMAIN_FAILURE_CACHE.keys().next().value;
        DOMAIN_FAILURE_CACHE.delete(oldest);
    }
    DOMAIN_FAILURE_CACHE.set(host, { failedAt: Date.now(), reason });
}

/**
 * Resets the domain failure and article caches (used in testing).
 */
export function clearExtractorCaches() {
    DOMAIN_FAILURE_CACHE.clear();
    ARTICLE_CONTENT_CACHE.clear();
}

// =========================================================================
// Browser Header Profiles
// =========================================================================

export const BROWSER_PROFILES = Object.freeze({
    desktop: Object.freeze({
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Ch-Ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
    }),
    mobile: Object.freeze({
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site'
    })
});

// =========================================================================
// Boilerplate & Noise Removal Regex
// =========================================================================

const SCRIPT_STYLE_REGEX = /<(?:script|style|noscript|svg|form|iframe|nav|footer|header|aside)\b[^<]*(?:(?!<\/(?:script|style|noscript|svg|form|iframe|nav|footer|header|aside)>)<[^<]*)*<\/(?:script|style|noscript|svg|form|iframe|nav|footer|header|aside)>/gi;

const WIDGET_CLASS_REGEX = /<(?:div|section|aside|ul|p)\b[^>]*(?:class|id)=["'][^"']*\b(?:sidebar|widget|trending|popular|related|recommended|comments|advert|ad-|banner|newsletter|social-share|cookie-consent|modal)\b[^"']*["'][^>]*>[\s\S]*?<\/(?:div|section|aside|ul|p)>/gi;

const BOT_CHALLENGE_TITLE_REGEX = /<title[^>]*>\s*(?:Just a moment\.\.\.|Attention Required!|Cloudflare|Security Check|Access Denied|Robot or Human\?|DDOS-GUARD|Security Verification)\s*<\/title>/i;

const BOT_CHALLENGE_STAGE_REGEX = /(?:id|class)=["'](?:challenge-stage|cf-browser-verification|cf-challenge-running|challenge-form|challenge-body-text)["']/i;

const BOT_CHALLENGE_INTERSTITIAL_PHRASES = [
    /checking your browser before accessing/i,
    /please complete the security check/i,
    /verify you are human/i,
    /enable javascript and cookies to continue/i,
    /cf-turnstile-wrapper/i
];

/**
 * Determines whether raw HTML represents an anti-bot challenge or captcha.
 * Avoids false positives on authentic articles that load Cloudflare analytics
 * scripts (/cdn-cgi/challenge-platform/) or contain comment-form captchas.
 */
export function isBotChallengeHtml(html) {
    if (!html || typeof html !== 'string') return true;

    // Check title tag for explicit challenge titles
    if (BOT_CHALLENGE_TITLE_REGEX.test(html)) {
        return true;
    }

    // Short error pages (403/Access Denied)
    if (html.length < 1500 && /403 Forbidden|Access Denied/i.test(html)) {
        return true;
    }

    // Active challenge stage container
    if (BOT_CHALLENGE_STAGE_REGEX.test(html)) {
        return true;
    }

    // Interstitial challenge phrases on non-substantive pages
    const hasArticleContainer = /<article\b[^>]*>[\s\S]{300,}<\/article>/i.test(html)
        || /<main\b[^>]*>[\s\S]{300,}<\/main>/i.test(html);

    if (!hasArticleContainer) {
        if (BOT_CHALLENGE_INTERSTITIAL_PHRASES.some(p => p.test(html))) {
            return true;
        }
        if (html.length < 12000 && (html.includes('challenge-platform') || /captcha/i.test(html)) && /Checking your browser|Ray ID:|cf-browser/i.test(html)) {
            return true;
        }
    }

    return false;
}

// =========================================================================
// Relevance Gating
// =========================================================================

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'has', 'he', 'in', 'is', 'it', 'its', 'of', 'on', 'that', 'the',
    'to', 'was', 'were', 'will', 'with', 'who', 'what', 'which', 'where',
    'when', 'how', 'this', 'there', 'they', 'their', 'only', 'can', 'about'
]);

/**
 * Tokenizes a string into meaningful non-stopword tokens
 */
function extractSignificantTokens(text) {
    return researchTerms(text).filter(t => !STOPWORDS.has(t));
}

/**
 * Evaluates whether an extracted paragraph is relevant to the query premise
 * or represents irrelevant sidebar noise (e.g. Kazakhstan bridge on a passport query).
 *
 * Rules:
 *   - Paragraph length >= 40 chars
 *   - Must contain >= 2 query tokens, OR 1 query token + number / entity token.
 */
export function isParagraphRelevant(paragraphText, queryTokens) {
    const text = String(paragraphText || '').trim();
    if (text.length < 40) return false;
    if (!queryTokens.length) return true;

    const lower = researchTerms(text).join(' ');
    let queryTokenHits = 0;
    for (const token of queryTokens) {
        if (lower.includes(token)) {
            queryTokenHits++;
        }
    }

    if (queryTokenHits >= 2) return true;

    // 1 query token + presence of numbers or capitalized entity phrases
    if (queryTokenHits >= 1) {
        const hasNumbers = /\b\d+\b/.test(text);
        const hasCapitalizedEntity = /[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}/.test(text);
        if (hasNumbers || hasCapitalizedEntity) return true;
    }

    return false;
}


/**
 * Applies paragraph-level relevance gating to a list of candidate paragraphs.
 * A single substantive passage can answer a fact lookup. Source-level relevance
 * is checked separately; extra paragraphs do not prove that requested facts exist.
 */
export function filterRelevantParagraphs(paragraphs, query) {
    if (!Array.isArray(paragraphs) || !paragraphs.length) return [];
    const queryTokens = extractSignificantTokens(query);

    const relevant = paragraphs.filter(p => isParagraphRelevant(p, queryTokens));

    return relevant;
}

// =========================================================================
// HTML Scraper & Extraction
// =========================================================================

/**
 * Cleans entity and XML tags
 */
function stripHtmlTags(str) {
    return decodeHtmlEntities(
        String(str || '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
    );
}

/**
 * Extracts article text from raw HTML using scoped selectors and relevance gating.
 *
 * @param {string} html - Raw page HTML
 * @param {string} url - Source URL
 * @param {string} [query=''] - Target search query for relevance gating
 * @returns {Object|null} Extracted article payload or null if extraction failed / rejected
 */
export function extractArticleFromHtml(html, url = '', query = '') {
    if (!html || typeof html !== 'string') return null;

    if (isBotChallengeHtml(html)) {
        return null;
    }

    // 1. Extract metadata (title & pubDate)
    let pubDate = '';
    const dateMatch = html.match(/<meta\s+(?:property|name)=["'](?:article:published_time|pubdate|date|og:published_time|dc\.date)["']\s+content=["']([^"']+)["']/i)
        || html.match(/<meta\s+content=["']([^"']+)["']\s+(?:property|name)=["'](?:article:published_time|pubdate|date|og:published_time|dc\.date)["']/i);
    if (dateMatch?.[1]) {
        pubDate = dateMatch[1].trim();
    }

    let pageTitle = '';
    const ogTitleMatch = html.match(/<meta\s+(?:property|name)=["']og:title["']\s+content=["']([^"']+)["']/i);
    if (ogTitleMatch?.[1]) {
        pageTitle = stripHtmlTags(ogTitleMatch[1]);
    } else {
        const titleTagMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
        if (titleTagMatch?.[1]) {
            pageTitle = stripHtmlTags(titleTagMatch[1]);
        }
    }

    // 2. Strip scripts, styles, widgets, and sidebars
    let cleaned = html
        .replace(SCRIPT_STYLE_REGEX, ' ')
        .replace(WIDGET_CLASS_REGEX, ' ');

    // 3. Extract scoped content container (<article>, [role="article"], <main>, or .article-body)
    const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
        || cleaned.match(/<[^>]+role=["']article["'][^>]*>([\s\S]*?)<\/[^>]+>/i)
        || cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);

    // A bounded read may end before </main>; keep the substantive prefix instead
    // of falling back to navigation before the main container.
    const openContainer = articleMatch ? null : /<(?:article|main)\b[^>]*>/i.exec(cleaned);
    const scopedHtml = articleMatch ? articleMatch[1] : openContainer ? cleaned.slice(openContainer.index + openContainer[0].length) : cleaned;

    // 4. Extract paragraphs and list items
    const rawParagraphMatches = scopedHtml.match(/<(?:p|li|blockquote|h[2-4])\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote|h[2-4])>/gi) || [];

    const candidateParagraphs = [];
    const candidateTags = [];
    for (const p of rawParagraphMatches) {
        const cleanedP = stripHtmlTags(p);
        const tag = /^<([a-z0-9]+)/i.exec(p)?.[1]?.toLowerCase() || 'p';
        const minLength = /^(?:li|h[2-4])$/.test(tag) ? 5 : 40;
        if (cleanedP.length >= minLength && !/\b(?:all rights reserved|terms of service|privacy policy|cookie settings|subscribe to our newsletter|sign up for free)\b/i.test(cleanedP)) {
            candidateParagraphs.push(cleanedP);
            candidateTags.push(tag);
        }
    }

    if (query && !assessSourceRelevance(query, { title: pageTitle, url, text: candidateParagraphs.join('\n\n') }).relevant) return null;

    // 5. Apply Relevance Gating
    const qualifiedParagraphs = query
        ? filterRelevantParagraphs(candidateParagraphs, query)
        : candidateParagraphs.slice(0, 10);

    if (!qualifiedParagraphs.length) {
        // Extraction failed relevance gating -> fall back to snippet
        return null;
    }

    // Include adjacent paragraphs: names/values often appear immediately after the matching introduction.
    const selected = new Set(qualifiedParagraphs);
    candidateParagraphs.forEach((p, i) => {
        if (!qualifiedParagraphs.includes(p)) return;
        for (let offset = -1; offset <= 2; offset++) if (candidateParagraphs[i + offset]) selected.add(candidateParagraphs[i + offset]);
        // Names and values often live in short lists immediately after an introduction.
        for (let next = i + 1; next < Math.min(candidateParagraphs.length, i + 13); next++) {
            if (!/^(?:li|h[2-4])$/.test(candidateTags[next])) break;
            selected.add(candidateParagraphs[next]);
        }
    });
    const bodyText = candidateParagraphs.filter(p => selected.has(p)).slice(0, 24).join('\n\n').slice(0, 12000).trim();
    const links = [];
    for (const match of scopedHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
        try {
            const target = new URL(decodeHtmlEntities(match[1]), url);
            const title = stripHtmlTags(match[2]);
            if (target.origin === new URL(url).origin && title.length >= 8 && !/\b(?:login|sign in|subscribe|privacy|cookie)\b/i.test(title)) links.push({ url: target.toString(), title });
        } catch { /* Ignore malformed links. */ }
        if (links.length >= 20) break;
    }

    return {
        title: pageTitle,
        pubDate,
        bodyText,
        url,
        paragraphCount: qualifiedParagraphs.length,
        links,
        fetchedAt: new Date().toISOString(),
        extractor: 'html',
        isScraped: true
    };
}

/**
 * Resiliently fetches and extracts clean article body with per-domain failure circuit breaking.
 *
 * @param {string} url - Destination URL
 * @param {string} [query=''] - Target search query for relevance gating
 * @param {Object} [options={}] - Optional fetch options (timeoutMs, profile)
 * @returns {Promise<Object|null>} Extracted article or null if failed / blocked
 */
export async function crawlArticleResilient(url, query = '', options = {}) {
    const targetUrl = String(url || '').trim();
    if (!isPublicWebUrl(targetUrl) || options.signal?.aborted) return null;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|mp4|mp3|zip|gz|tar)$/i.test(targetUrl)) return null;

    const host = extractHostname(targetUrl);
    if (!host) return null;

    // 1. Check per-domain failure cache
    if (isDomainTemporarilyBlocked(host)) {
        options.onDiagnostic?.({ stage: 'page_reading', provider: 'html', reason: 'domain_cooldown' });
        return null;
    }

    // 2. Check URL content cache
    const cacheKey = `${targetUrl}::${query}`;
    const cachedEntry = ARTICLE_CONTENT_CACHE.get(cacheKey);
    const articleTtl = /\b(?:current|latest|today|tonight|yesterday|now|news|price|score|weather|who\s+is)\b/i.test(query) ? 60000 : ARTICLE_CACHE_TTL_MS;
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < articleTtl) {
        return cachedEntry.data;
    }

    const timeoutMs = Math.min(Number(options.timeoutMs) || 2500, 5000);
    const scope = researchTimeoutSignal(timeoutMs, options.signal);

    const profile = options.profile === 'mobile' ? BROWSER_PROFILES.mobile : BROWSER_PROFILES.desktop;

    try {
        const page = await fetchPublicPage(targetUrl, {
            headers: profile,
            signal: scope.signal
        });
        if (!page) return null;
        const { response } = page;

        if (!response.ok) {
            options.onDiagnostic?.({ stage: 'page_reading', provider: 'html', reason: `http_${response.status}` });
            if (response.status === 403 || response.status === 429) {
                recordDomainFailure(host, `http_${response.status}`);
            }
            return null;
        }

        const contentType = response.headers?.get('content-type') || '';
        if (contentType && !/html|text\//i.test(contentType)) { await response.body?.cancel().catch(() => {}); return null; }
        let html = '';
        let truncated = false;
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const cancel = () => { reader.cancel().catch(() => {}); };
            scope.signal.addEventListener('abort', cancel, { once: true });
            let bytes = 0;
            try {
                while (!scope.signal.aborted) {
                    const { value, done } = await reader.read();
                    if (done) break;
                    const available = Math.max(0, 2_000_000 - bytes);
                    const chunk = value.length > available ? value.subarray(0, available) : value;
                    bytes += chunk.length;
                    html += decoder.decode(chunk, { stream: true });
                    if (value.length > available || bytes >= 2_000_000) { truncated = true; await reader.cancel(); break; }
                }
                html += decoder.decode();
            } finally { scope.signal.removeEventListener('abort', cancel); reader.releaseLock(); }
        } else { html = await response.text(); truncated = html.length > 2_000_000; html = html.slice(0, 2_000_000); }
        if (scope.signal.aborted) return null;
        if (!html || typeof html !== 'string') return null;

        if (isBotChallengeHtml(html)) {
            recordDomainFailure(host, 'bot_challenge_detected');
            return null;
        }

        const extracted = extractArticleFromHtml(html, page.url, query);
        if (extracted) {
            if (truncated) extracted.truncated = true;
            if (ARTICLE_CONTENT_CACHE.size >= MAX_CACHE_ENTRIES) {
                const oldest = ARTICLE_CONTENT_CACHE.keys().next().value;
                ARTICLE_CONTENT_CACHE.delete(oldest);
            }
            ARTICLE_CONTENT_CACHE.set(cacheKey, { cachedAt: Date.now(), data: extracted });
            return extracted;
        }

        return null;
    } catch (err) {
        if (err?.name === 'AbortError' && !options.signal?.aborted) {
            recordDomainFailure(host, 'timeout');
        }
        return null;
    } finally {
        scope.dispose();
    }
}
