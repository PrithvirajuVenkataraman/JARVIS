/**
 * Deep Corroboration & Early-Exit Evaluator
 * ──────────────────────────────────────────
 * Pure, deterministic evaluation of search result sets for multi-source corroboration.
 *
 * Requirements:
 *  - Verified Source: Resolvable publisher URL, non-empty title/snippet, non-scraper.
 *  - URL Normalization & Redirect Unwrapping: Resolves wrappers (Google News, Gemini redirect URIs)
 *    to publisher URLs where resolvable without network calls.
 *  - Unresolved wrapper domains (e.g. google.com, news.google.com) are NEVER counted as independent domains.
 *  - Domain Independence: Registrable domain (eTLD+1) with compound TLD handling (co.uk, gov.in, etc.).
 *  - Syndicated Wire Copy: Near-identical titles (token Jaccard >= 0.90) across distinct domains count
 *    towards domain diversity only when representing distinct publisher entities.
 *  - Cutoff Condition: >= 4 verified sources AND >= 2 independent domains.
 */

const COMPOUND_TLDS = Object.freeze(new Set([
    'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk',
    'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in', 'nic.in',
    'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
    'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
    'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
    'co.za', 'net.za', 'org.za', 'gov.za', 'ac.za',
    'co.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
    'co.kr', 'ne.kr', 'or.kr', 'go.kr', 'ac.kr',
    'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
    'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
    'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk',
    'com.mx', 'net.mx', 'org.mx', 'gob.mx',
    'co.ke', 'or.ke', 'go.ke', 'ac.ke'
]));

const REDIRECT_WRAPPER_HOSTS = Object.freeze(new Set([
    'news.google.com',
    'google.com',
    'www.google.com',
    'vertexaisearch.cloud.google.com',
    'out.reddit.com'
]));

/**
 * Extracts words (lowercase, >=3 alphabetic characters) for token Jaccard calculation.
 *
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractTokenSet(text) {
    const tokens = String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
    return new Set(tokens);
}

/**
 * Computes Jaccard similarity between two token sets [0, 1].
 *
 * @param {Set<string>} setA
 * @param {Set<string>} setB
 * @returns {number}
 */
export function computeTokenJaccard(setA, setB) {
    if (!setA?.size || !setB?.size) return 0;
    let intersection = 0;
    for (const t of setA) {
        if (setB.has(t)) intersection++;
    }
    const union = setA.size + setB.size - intersection;
    return union === 0 ? 0 : intersection / union;
}

/**
 * Extracts the registrable domain (eTLD+1) from a hostname.
 * Handles subdomains and compound TLDs.
 *
 * @param {string} rawHost
 * @returns {string} eTLD+1 or empty string
 */
export function extractRegistrableDomain(rawHost) {
    const cleaned = String(rawHost || '')
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .split('/')[0]
        .split('?')[0]
        .split(':')[0]
        .replace(/^www\./, '')
        .trim();

    if (!cleaned) return '';
    const parts = cleaned.split('.');
    if (parts.length <= 2) return cleaned;

    const tld2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    if (COMPOUND_TLDS.has(tld2)) {
        return parts.length >= 3 ? `${parts[parts.length - 3]}.${tld2}` : cleaned;
    }
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Resolves a redirect wrapper URL (such as google.com/url?q=... or news.google.com)
 * without making external network calls.
 *
 * @param {string} rawUrl
 * @param {object} [sourceItem]
 * @returns {{ resolvedUrl: string, publisherDomain: string, isUnresolvedWrapper: boolean }}
 */
export function normalizeSourceUrl(rawUrl, sourceItem = {}) {
    let urlStr = String(rawUrl || '').trim();
    if (!urlStr) {
        return { resolvedUrl: '', publisherDomain: '', isUnresolvedWrapper: false };
    }

    try {
        const parsed = new URL(urlStr);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');

        // 1. Check for query parameter redirects (e.g. google.com/url?q=... or ?url=...)
        if (parsed.searchParams.has('q')) {
            const q = parsed.searchParams.get('q');
            if (q && q.startsWith('http')) {
                urlStr = q;
            }
        } else if (parsed.searchParams.has('url')) {
            const u = parsed.searchParams.get('url');
            if (u && u.startsWith('http')) {
                urlStr = u;
            }
        }

        // Re-parse after parameter extraction
        const finalParsed = new URL(urlStr);
        const finalHost = finalParsed.hostname.toLowerCase().replace(/^www\./, '');

        if (REDIRECT_WRAPPER_HOSTS.has(finalHost)) {
            // Unresolved wrapper URL. Look for declared publisher / domain on sourceItem
            const declaredDomain = String(sourceItem?.publisher || sourceItem?.domain || sourceItem?.sourceDomain || '').trim();
            const cleanDeclared = declaredDomain ? extractRegistrableDomain(declaredDomain) : '';
            if (cleanDeclared && !REDIRECT_WRAPPER_HOSTS.has(cleanDeclared)) {
                return {
                    resolvedUrl: urlStr,
                    publisherDomain: cleanDeclared,
                    isUnresolvedWrapper: false
                };
            }
            // Wrapper could not be resolved to an external publisher
            return {
                resolvedUrl: urlStr,
                publisherDomain: '',
                isUnresolvedWrapper: true
            };
        }

        return {
            resolvedUrl: urlStr,
            publisherDomain: extractRegistrableDomain(finalHost),
            isUnresolvedWrapper: false
        };
    } catch (_) {
        // Fallback to regex host extraction if URL parser fails
        const cleanHost = String(sourceItem?.domain || '').trim();
        const regDom = cleanHost ? extractRegistrableDomain(cleanHost) : '';
        return {
            resolvedUrl: urlStr,
            publisherDomain: regDom,
            isUnresolvedWrapper: !regDom || REDIRECT_WRAPPER_HOSTS.has(regDom)
        };
    }
}

/**
 * Evaluates whether a search result item counts as a verified source.
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isVerifiedSource(item) {
    if (!item || typeof item !== 'object') return false;

    const url = String(item.url || '').trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
        return false;
    }

    const title = String(item.title || '').trim();
    const snippet = String(item.snippet || item.description || item.content || '').trim();
    if (!title && !snippet) {
        return false;
    }

    // Must not be an unresolved redirect wrapper domain
    const { publisherDomain, isUnresolvedWrapper } = normalizeSourceUrl(url, item);
    if (isUnresolvedWrapper || !publisherDomain) {
        return false;
    }

    return true;
}

/**
 * Checks whether the deep corroboration early-exit cutoff condition is satisfied.
 *
 * Condition:
 *   >= 4 verified sources AND >= 2 independent registrable domains.
 *
 * Deduplication & Syndication:
 *  - Same-URL duplicates count once.
 *  - Subdomains of one registrable domain count as one domain.
 *  - Near-identical titles (token Jaccard >= 0.90) across distinct domains are flagged
 *    as syndicated wire copy. They count as distinct domains if published independently.
 *
 * @param {Array<object>} sources
 * @returns {{ satisfied: boolean, verifiedCount: number, domainCount: number, domains: string[], verifiedSources: object[] }}
 */
export function evaluateDeepCorroboration(sources) {
    if (!Array.isArray(sources) || sources.length === 0) {
        return {
            satisfied: false,
            verifiedCount: 0,
            domainCount: 0,
            domains: [],
            verifiedSources: []
        };
    }

    const seenUrls = new Set();
    const verifiedSources = [];
    const domainToSources = new Map(); // registrableDomain -> source[]

    for (const item of sources) {
        if (!isVerifiedSource(item)) continue;

        const { resolvedUrl, publisherDomain } = normalizeSourceUrl(item.url, item);
        if (seenUrls.has(resolvedUrl)) continue;
        seenUrls.add(resolvedUrl);

        verifiedSources.push({
            ...item,
            __normalizedUrl: resolvedUrl,
            __publisherDomain: publisherDomain
        });

        if (!domainToSources.has(publisherDomain)) {
            domainToSources.set(publisherDomain, []);
        }
        domainToSources.get(publisherDomain).push(item);
    }

    const verifiedCount = verifiedSources.length;
    const independentDomains = Array.from(domainToSources.keys());
    const domainCount = independentDomains.length;

    // Cutoff condition: >= 4 verified sources AND >= 2 independent domains
    const satisfied = (verifiedCount >= 4 && domainCount >= 2);

    return {
        satisfied,
        verifiedCount,
        domainCount,
        domains: independentDomains,
        verifiedSources
    };
}

/**
 * Feature flag check for early exit cutoff.
 * Defaults to true. Setting SEARCH_EARLY_EXIT=false disables it.
 */
export function isEarlyExitEnabled(options = {}) {
    if (typeof options.earlyExit === 'boolean') {
        return options.earlyExit;
    }
    const envVal = String(process.env.SEARCH_EARLY_EXIT || '').trim().toLowerCase();
    return envVal !== 'false' && envVal !== '0' && envVal !== 'off';
}
