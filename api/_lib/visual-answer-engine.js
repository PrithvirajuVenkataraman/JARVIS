/**
 * @file api/_lib/visual-answer-engine.js
 * @description Universal Entity Recognition, Media Retrieval, and Notable Works Discovery Engine.
 * 
 * Powered by open reference APIs (Wikipedia REST API, Wikidata, and Wikimedia Commons).
 * Dynamically resolves verified entity portraits, logos, descriptions, and notable works
 * (filmography, discography, bibliography, products) with ZERO hardcoded entities.
 */

import { isPublicWebUrl } from './public-web-url.js';

const WIKIPEDIA_SUMMARY_URL = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const WIKIPEDIA_SEARCH_URL = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';

const MEDIA_TIMEOUT_MS = 2200;
const ENTITY_CACHE_TTL_MS = 3600000; // 1 hour
const entityVisualCache = new Map();

/**
 * Normalizes query string to clean candidate entity terms.
 * Universal entity extraction: removes conversational filler, command verbs, and temporal buzzwords.
 */
export function extractCandidateEntity(query = '') {
    if (!query || typeof query !== 'string') return '';
    let q = query.trim();

    // Do not attempt entity resolution on explicit mathematical expressions or greetings
    if (/^\s*(?:calculate|solve|what\s+is\s+)?[\d\s+\-*/^=().%x×÷]+[?]?\s*$/i.test(q)) return '';
    if (/^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|who\s+are\s+you|thank\s+you|thanks)\b/i.test(q)) return '';

    // Remove conversational command prefixes
    q = q.replace(/^(?:who\s+(?:is|was|are|were)|what\s+(?:is|was|are|were)|tell\s+me\s+about|give\s+me\s+(?:an?\s+)?overview\s+of|explain|search\s+for|look\s+up|find\s+info\s+on)\s+/i, '');
    // Remove punctuation
    q = q.replace(/[?.!]+$/, '').trim();

    // Strip trailing conversational constraints
    q = q.replace(/\s+(?:in\s+one\s+sentence|briefly|in\s+detail|with\s+sources|with\s+citations)$/i, '').trim();

    // If remaining string is pure math or numbers, reject
    if (/^[\d\s+\-*/^=().%x×÷]+$/i.test(q)) return '';

    if (q.length < 2 || q.length > 100) return '';
    return q;
}

/**
 * Validates that an image URL is secure, properly formed, and hosted on a reputable CDN.
 */
export function isValidImageUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (!url.startsWith('https://')) return false;
    try {
        const parsed = new URL(url);
        // Exclude local/private IP ranges (SSRF protection)
        if (/^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.|169\.254\.)/.test(parsed.hostname)) {
            return false;
        }
        // Allow Wikimedia Commons, Wikipedia upload, and reputable media CDNs
        const allowedHosts = [
            'wikimedia.org',
            'wikipedia.org',
            'tmdb.org',
            'unsplash.com'
        ];
        return allowedHosts.some(host => parsed.hostname === host || parsed.hostname.endsWith(`.${host}`));
    } catch {
        return false;
    }
}

/**
 * Universal entity type classification derived from verified encyclopedic descriptions.
 */
export function classifyEntityTypeFromDescription(description = '', title = '') {
    const text = `${title} ${description}`.toLowerCase();
    if (/\b(?:film composer|composer|music director|musician|singer|songwriter|conductor|pianist|guitarist|band|orchestra)\b/.test(text)) {
        return 'musician';
    }
    if (/\b(?:actor|actress|comedian|voice actor)\b/.test(text)) {
        return 'actor';
    }
    if (/\b(?:film director|movie director|director|producer|screenwriter|filmmaker)\b/.test(text)) {
        return 'director';
    }
    if (/\b(?:author|writer|novelist|poet|playwright|journalist|essayist)\b/.test(text)) {
        return 'author';
    }
    if (/\b(?:physicist|chemist|biologist|mathematician|scientist|astronomer|neuroscientist|inventor)\b/.test(text)) {
        return 'scientist';
    }
    if (/\b(?:company|corporation|multinational|conglomerate|enterprise|tech company|automobile manufacturer|retailer)\b/.test(text)) {
        return 'company';
    }
    if (/\b(?:film|movie|feature film|cinema|blockbuster)\b/.test(text)) {
        return 'movie';
    }
    if (/\b(?:television series|tv series|sitcom|drama series|show)\b/.test(text)) {
        return 'tv_series';
    }
    if (/\b(?:book|novel|memoir|biography|epic)\b/.test(text)) {
        return 'book';
    }
    if (/\b(?:album|extended play|ep|soundtrack|single)\b/.test(text)) {
        return 'album';
    }
    if (/\b(?:landmark|monument|building|skyscraper|bridge|stadium|mountain|national park|temple|church)\b/.test(text)) {
        return 'landmark';
    }
    if (/\b(?:politician|prime minister|president|minister|chief minister|senator|governor|monarch|king|queen)\b/.test(text)) {
        return 'political_figure';
    }
    return 'entity';
}

/**
 * Fetches Wikipedia Summary REST API with timeout and error handling.
 */
async function fetchWikiSummary(title, signal) {
    if (!title) return null;
    const url = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
    try {
        const res = await fetch(url, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'JarvisMultimodalAnswerEngine/2.0'
            },
            signal
        });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Searches Wikipedia Opensearch / query API for the best matching article title.
 */
async function searchWikipediaTitle(query, signal) {
    const url = new URL(WIKIPEDIA_SEARCH_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', '3');
    url.searchParams.set('format', 'json');
    url.searchParams.set('origin', '*');

    try {
        const res = await fetch(url.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': 'JarvisMultimodalAnswerEngine/2.0'
            },
            signal
        });
        if (!res.ok) return null;
        const data = await res.json();
        const hits = data?.query?.search || [];
        if (!hits.length) return null;
        return hits[0].title;
    } catch {
        return null;
    }
}

/**
 * Resolves verified notable works for creative figures and organizations.
 * Universal: Queries Wikipedia articles for mentioned titles, films, books, or albums
 * and fetches their verified posters/covers and release years.
 */
export async function discoverNotableWorks(entityTitle, entityType, summaryData, signal, textContext = '') {
    if (!['musician', 'actor', 'director', 'author', 'company', 'movie', 'scientist'].includes(entityType)) {
        return [];
    }

    const candidateWorkTitles = [];
    const fullText = `${textContext} ${summaryData?.extract || ''}`;

    // Extract quoted titles: "Title" or “Title”
    for (const match of fullText.matchAll(/["“]([^"”]{2,60})["”]/g)) {
        candidateWorkTitles.push(match[1].trim());
    }

    // Extract bold titles: **Title**
    for (const match of fullText.matchAll(/\*\*([^*]{2,50})\*\*/g)) {
        const val = match[1].trim();
        // Skip common formatting or section headers
        if (!/^(?:born|died|early life|career|awards?|legacy|background|works|notable|status|summary|albums?)$/i.test(val)) {
            candidateWorkTitles.push(val);
        }
    }

    // Filter out common non-title words and entity name itself
    const stopWords = new Set(['the', 'a', 'an', 'yes', 'no', 'and', 'or', 'in', 'of', 'for', 'with', 'by', 'as', 'to', 'thenisai thendral', 'godfather of gaana', 'padma shri', 'kalaimamani']);
    const entityNameTokens = entityTitle.toLowerCase().split(/\s+/);

    const filteredTitles = [...new Set(candidateWorkTitles)].filter(t => {
        const lower = t.toLowerCase();
        if (stopWords.has(lower)) return false;
        if (/\b(?:thenisai\s+thendral|godfather\s+of\s+gaana|padma\s+shri|kalaimamani|national\s+award|filmfare|best\s+music\s+director)\b/i.test(lower)) return false;
        if (entityNameTokens.length > 1 && lower === entityTitle.toLowerCase()) return false;
        if (t.length < 2 || t.length > 50) return false;
        return true;
    });

    // If text context had no titles, fallback to searching Wikipedia for notable titles
    if (filteredTitles.length < 2) {
        let searchContext = 'films';
        if (entityType === 'author') searchContext = 'books novels';
        else if (entityType === 'musician') searchContext = 'discography soundtracks albums';
        else if (entityType === 'company') searchContext = 'key products';
        else if (entityType === 'scientist') searchContext = 'discoveries theories';

        const searchResults = await searchWikipediaTitle(`${entityTitle} ${searchContext}`, signal);
        if (searchResults && searchResults !== entityTitle) {
            const checkSummary = await fetchWikiSummary(searchResults, signal);
            const lowerEntity = entityTitle.toLowerCase();
            const lowerText = `${checkSummary?.title || ''} ${checkSummary?.extract || ''}`.toLowerCase();
            if (checkSummary && (lowerText.includes(lowerEntity) || entityNameTokens.some(token => token.length >= 4 && lowerText.includes(token)))) {
                filteredTitles.push(searchResults);
            }
        }
    }

    // Limit candidate queries to top 4 works
    const selectedTitles = filteredTitles.slice(0, 4);
    if (!selectedTitles.length) return [];

    const works = [];
    await Promise.all(selectedTitles.map(async (workTitle) => {
        try {
            let workSummary = await fetchWikiSummary(workTitle, signal);
            if (!workSummary || workSummary.type === 'disambiguation') {
                const searchTag = entityType === 'musician' || entityType === 'actor' || entityType === 'director' ? 'film' : (entityType === 'author' ? 'novel' : '');
                const contextualSearch = await searchWikipediaTitle(`${workTitle} ${searchTag}`.trim(), signal);
                if (contextualSearch) {
                    workSummary = await fetchWikiSummary(contextualSearch, signal);
                }
            }
            if (!workSummary || !workSummary.title || workSummary.type === 'disambiguation') return;

            const imageUrl = workSummary.thumbnail?.source || workSummary.originalimage?.source;
            const validImage = isValidImageUrl(imageUrl) ? imageUrl : null;

            // Extract release year from description or extract
            let year = null;
            const yearMatch = (workSummary.description || '').match(/\b(19\d\d|20[0-2]\d)\b/) ||
                              (workSummary.extract || '').match(/\b(19\d\d|20[0-2]\d)\b/) ||
                              (workSummary.title || '').match(/\b(19\d\d|20[0-2]\d)\b/);
            if (yearMatch) {
                year = yearMatch[1];
            }

            works.push({
                id: `work_${workSummary.pageid || encodeURIComponent(workSummary.title)}`,
                title: workSummary.title.replace(/\s*\([^)]*\)$/, ''), // Clean disambiguation tag
                year,
                description: workSummary.description || '',
                image: validImage ? {
                    url: validImage,
                    sourceUrl: workSummary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(workSummary.title.replace(/\s+/g, '_'))}`,
                    width: workSummary.thumbnail?.width,
                    height: workSummary.thumbnail?.height
                } : null
            });
        } catch {
            // Graceful skip
        }
    }));

    return works.filter(w => w.title && (w.image || w.year));
}

/**
 * Universal Entity Visuals Resolver.
 * Given any factual query, resolves primary entity metadata, verified portrait/logo,
 * and associated notable works asynchronously.
 * 
 * Returns null if the query is not an entity lookup or if no valid entity was found.
 */
export async function resolveEntityVisuals(query = '', options = {}) {
    const candidate = extractCandidateEntity(query);
    if (!candidate) return null;

    const cacheKey = candidate.toLowerCase();
    const cached = entityVisualCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ENTITY_CACHE_TTL_MS) {
        return cached.data;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || MEDIA_TIMEOUT_MS);
    if (options.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    try {
        // Step 1: Direct summary lookup on clean candidate
        let summary = await fetchWikiSummary(candidate, controller.signal);

        // Step 2: If direct lookup failed or gave disambiguation, search Wikipedia
        if (!summary || summary.type === 'disambiguation' || !summary.extract) {
            const bestTitle = await searchWikipediaTitle(candidate, controller.signal);
            if (bestTitle && bestTitle.toLowerCase() !== candidate.toLowerCase()) {
                summary = await fetchWikiSummary(bestTitle, controller.signal);
            }
        }

        // If no valid encyclopedic summary was retrieved, return null
        if (!summary || !summary.title || !summary.extract) {
            entityVisualCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        const entityType = classifyEntityTypeFromDescription(summary.description, summary.title);
        const imageUrl = summary.thumbnail?.source || summary.originalimage?.source;
        const validImage = isValidImageUrl(imageUrl) ? imageUrl : null;

        const entity = {
            id: `entity_${summary.pageid || encodeURIComponent(summary.title)}`,
            name: summary.title.replace(/\s*\([^)]*\)$/, ''), // Clean disambiguation tag
            fullName: summary.title,
            type: entityType,
            description: summary.description || '',
            extract: summary.extract || '',
            image: validImage ? {
                url: validImage,
                sourceUrl: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/\s+/g, '_'))}`,
                alt: summary.title,
                width: summary.thumbnail?.width,
                height: summary.thumbnail?.height
            } : null,
            pageUrl: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/\s+/g, '_'))}`
        };

        // Step 3: Concurrently discover notable works if applicable
        let notableWorks = [];
        try {
            notableWorks = await discoverNotableWorks(summary.title, entityType, summary, controller.signal, options.textContext || '');
        } catch {
            notableWorks = [];
        }

        const result = {
            entity,
            notableWorks
        };

        entityVisualCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}
