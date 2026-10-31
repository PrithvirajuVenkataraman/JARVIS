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
    if (Date.now() - entry.failedAt < DOMAIN_FAILURE_TTL_MS) {
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

const COMMON_BOT_CHALLENGE_PATTERNS = [
    /<title>\s*(?:Just a moment\.\.\.|Attention Required!|Cloudflare|Security Check|Access Denied|Robot or Human\?)\s*<\/title>/i,
    /cf-browser-verification/i,
    /challenge-platform/i,
    /ray-id/i,
    /captcha/i
];

/**
 * Determines whether raw HTML represents an anti-bot challenge or captcha.
 */
export function isBotChallengeHtml(html) {
    if (!html || typeof html !== 'string') return true;
    if (html.length < 500 && /403 Forbidden|Access Denied/i.test(html)) return true;
    return COMMON_BOT_CHALLENGE_PATTERNS.some(p => p.test(html));
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
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length >= 3 && !STOPWORDS.has(t));
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

    const lower = text.toLowerCase();
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

    // Numeric-count query path: the user query contains a numeric count ("3", "three", "five", etc.)
    // but the article body uses proper-noun named-entity language (e.g. "King Charles III").
    // Accept the paragraph if it contains BOTH a number AND at least one multi-word proper noun.
    // This prevents rejection of entity-rich articles whose vocabulary doesn't overlap the count query.
    const hasProperNounPhrase = /[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+/.test(text);
    if (hasProperNounPhrase && /\b\d+\b/.test(text)) return true;

    return false;
}


/**
 * Applies paragraph-level relevance gating to a list of candidate paragraphs.
 * If fewer than 2 relevant paragraphs remain, returns an empty array to indicate failure.
 */
export function filterRelevantParagraphs(paragraphs, query) {
    if (!Array.isArray(paragraphs) || !paragraphs.length) return [];
    const queryTokens = extractSignificantTokens(query);

    const relevant = paragraphs.filter(p => isParagraphRelevant(p, queryTokens));

    // If fewer than 2 relevant paragraphs, reject extraction to prevent sidebar pollution
    if (relevant.length < 2) {
        return [];
    }

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

    const scopedHtml = articleMatch ? articleMatch[1] : cleaned;

    // 4. Extract paragraphs and list items
    const rawParagraphMatches = scopedHtml.match(/<(?:p|li|blockquote)\b[^>]*>([\s\S]*?)<\/(?:p|li|blockquote)>/gi) || [];

    const candidateParagraphs = [];
    for (const p of rawParagraphMatches) {
        const cleanedP = stripHtmlTags(p);
        if (cleanedP.length >= 40 && !/\b(?:all rights reserved|terms of service|privacy policy|cookie settings|subscribe to our newsletter|sign up for free)\b/i.test(cleanedP)) {
            candidateParagraphs.push(cleanedP);
        }
    }

    // 5. Apply Relevance Gating
    const qualifiedParagraphs = query
        ? filterRelevantParagraphs(candidateParagraphs, query)
        : candidateParagraphs.slice(0, 10);

    if (!qualifiedParagraphs.length) {
        // Extraction failed relevance gating -> fall back to snippet
        return null;
    }

    const bodyText = qualifiedParagraphs.slice(0, 8).join('\n\n').slice(0, 2500).trim();

    return {
        title: pageTitle,
        pubDate,
        bodyText,
        url,
        paragraphCount: qualifiedParagraphs.length,
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
    if (!targetUrl || !targetUrl.startsWith('http')) return null;
    if (/\.(pdf|jpg|jpeg|png|gif|svg|mp4|mp3|zip|gz|tar)$/i.test(targetUrl)) return null;

    const host = extractHostname(targetUrl);
    if (!host) return null;

    // 1. Check per-domain failure cache
    if (isDomainTemporarilyBlocked(host)) {
        return null;
    }

    // 2. Check URL content cache
    const cacheKey = `${targetUrl}::${query}`;
    const cachedEntry = ARTICLE_CONTENT_CACHE.get(cacheKey);
    if (cachedEntry && Date.now() - cachedEntry.cachedAt < ARTICLE_CACHE_TTL_MS) {
        return cachedEntry.data;
    }

    const timeoutMs = Math.min(Number(options.timeoutMs) || 2500, 3000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const profile = options.profile === 'mobile' ? BROWSER_PROFILES.mobile : BROWSER_PROFILES.desktop;

    try {
        const response = await fetch(targetUrl, {
            headers: profile,
            signal: controller.signal
        });

        if (!response.ok) {
            if (response.status === 403 || response.status === 429) {
                recordDomainFailure(host, `http_${response.status}`);
            }
            return null;
        }

        const html = await response.text();
        if (!html || typeof html !== 'string') return null;

        if (isBotChallengeHtml(html)) {
            recordDomainFailure(host, 'bot_challenge_detected');
            return null;
        }

        const extracted = extractArticleFromHtml(html, targetUrl, query);
        if (extracted) {
            if (ARTICLE_CONTENT_CACHE.size >= MAX_CACHE_ENTRIES) {
                const oldest = ARTICLE_CONTENT_CACHE.keys().next().value;
                ARTICLE_CONTENT_CACHE.delete(oldest);
            }
            ARTICLE_CONTENT_CACHE.set(cacheKey, { cachedAt: Date.now(), data: extracted });
            return extracted;
        }

        return null;
    } catch (err) {
        if (err?.name === 'AbortError') {
            recordDomainFailure(host, 'timeout');
        }
        return null;
    } finally {
        clearTimeout(timer);
    }
}
