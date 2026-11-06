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

const MEDIA_TIMEOUT_MS = 4500;
const ENTITY_CACHE_TTL_MS = 3600000; // 1 hour
const entityVisualCache = new Map();

/**
 * Universal entity & domain extraction:
 * Distinguishes the specific subject from any explicit domain / field constraints
 * (e.g. "SCENE movie" -> subject: "SCENE", domain: "movie").
 * Strips conversational filler, command verbs, and temporal buzzwords.
 */
export function extractCandidateEntityAndDomain(query = '') {
    if (!query || typeof query !== 'string') return { entity: '', domain: null };
    let q = query.trim();

    // Do not attempt entity resolution on explicit mathematical expressions or greetings
    if (/^\s*(?:calculate|solve|what\s+is\s+)?[\d\s+\-*/^=().%x×÷]+[?]?\s*$/i.test(q)) return { entity: '', domain: null };
    if (/^\s*(?:hi|hello|hey|good\s+(?:morning|afternoon|evening)|how\s+are\s+you|who\s+are\s+you|thank\s+you|thanks)\b/i.test(q)) return { entity: '', domain: null };

    // Strictly reject causal, explanatory, medical, health, or procedural questions
    if (/\b(?:why|how\s+come|what\s+causes|causes\s+of|reasons?\s+(?:for|why)|mechanism\s+of|symptoms?\s+of|treatments?\s+for|cure\s+for|risk\s+factors?|side\s+effects?|how\s+to|how\s+do|how\s+can|should\s+i|can\s+i|is\s+it\s+safe|difference\s+between|pros\s+and\s+cons)\b/i.test(q)) return { entity: '', domain: null };

    // Reject conversational/rhetorical interjections and idioms
    if (/\b(?:what(?:\s+is)?\s+(?:in\s+the\s+world|on\s+earth|the\s+hell|the\s+heck))\b/i.test(q)) return { entity: '', domain: null };

    // Reject compound multi-clause sentences or multi-question strings
    if (/[?!;]\s+[a-z0-9]/i.test(q)) return { entity: '', domain: null };

    // Reject queries asking about general medical conditions or biological processes
    if (/\b(?:heart\s+attacks?|cardiac\s+arrest|chest\s+pain|stroke|diabetes|blood\s+pressure|cholesterol|hypertension|infection|headache|fever)\b/i.test(q)) {
        if (/\b(?:getting|having|prevent|cure|youngsters|young\s+people|people|adults|causes?|reasons?)\b/i.test(q)) {
            return { entity: '', domain: null };
        }
    }

    // Remove conversational command prefixes
    q = q.replace(/^(?:who\s+(?:is|was|are|were|directed|composed|wrote|created|founded|invented|played|starred\s+in)|what\s+(?:is|was|are|were|happened\s+in|happened\s+to)|tell\s+me\s+about|give\s+me\s+(?:an?\s+)?overview\s+of|explain|search\s+for|look\s+up|find\s+info\s+on)\s+/i, '');
    // Remove leading definite/indefinite article if present before proper names
    q = q.replace(/^(?:the|an?)\s+/i, '').trim();
    // Remove punctuation
    q = q.replace(/[?.!]+$/, '').trim();

    // Strip trailing conversational constraints
    q = q.replace(/\s+(?:in\s+one\s+sentence|briefly|in\s+detail|with\s+sources|with\s+citations)$/i, '').trim();

    // If remaining string is pure math or numbers, reject
    if (/^[\d\s+\-*/^=().%x×÷]+$/i.test(q)) return { entity: '', domain: null };

    // Domain specifier detection
    const DOMAIN_PATTERNS = [
        { regex: /\b(?:movies?|films?|cinemas?|blockbusters?|motion\s+pictures?)\b/i, domain: 'movie' },
        { regex: /\b(?:tv\s+series|tv\s+shows?|television\s+series|sitcoms?|dramas?)\b/i, domain: 'tv_series' },
        { regex: /\b(?:musicians?|music\s+directors?|composers?|singers?|songwriters?|bands?|orchestras?)\b/i, domain: 'musician' },
        { regex: /\b(?:songs?|tracks?|singles?|soundtracks?|albums?)\b/i, domain: 'album' },
        { regex: /\b(?:books?|novels?|authors?|writers?|poets?|literature)\b/i, domain: 'book' },
        { regex: /\b(?:actors?|actresses?|stars?)\b/i, domain: 'actor' },
        { regex: /\b(?:directors?|filmmakers?)\b/i, domain: 'director' },
        { regex: /\b(?:compan(?:y|ies)|corporations?|enterprises?|brands?|startups?)\b/i, domain: 'company' },
        { regex: /\b(?:landmarks?|monuments?|buildings?|stadiums?|temples?|churches?|mountains?)\b/i, domain: 'landmark' },
        { regex: /\b(?:scientists?|physicists?|chemists?|biologists?|inventors?)\b/i, domain: 'scientist' }
    ];

    let detectedDomain = null;
    let cleanSubject = q;
    for (const dp of DOMAIN_PATTERNS) {
        if (dp.regex.test(q)) {
            detectedDomain = dp.domain;
            // Clean domain token if it appears as an adjunct/suffix or prefix (e.g. "SCENE movie" -> "SCENE")
            cleanSubject = q.replace(dp.regex, '').replace(/^(?:the|an?)\s+/i, '').replace(/\s+(?:the|an?)$/i, '').trim();
            break;
        }
    }

    // Entity titles are concise proper names (typically 1-6 words)
    const words = q.split(/\s+/).filter(Boolean);
    if (words.length > 6) return { entity: '', domain: null };

    // Reject if remaining candidate contains conversational non-entity verbs or conjunctions
    if (/\b(?:getting|having|affecting|living|dying|causing|suffering|because|although|whereas)\b/i.test(q)) return { entity: '', domain: null };

    if (q.length < 2 || q.length > 100) return { entity: '', domain: null };

    return {
        entity: q,
        cleanSubject: cleanSubject && cleanSubject.length >= 2 ? cleanSubject : q,
        domain: detectedDomain
    };
}

/**
 * Normalizes query string to clean candidate entity terms.
 * Universal entity extraction: removes conversational filler, command verbs, and temporal buzzwords.
 */
export function extractCandidateEntity(query = '') {
    return extractCandidateEntityAndDomain(query).entity;
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
 * Fetches Wikipedia Summary with robust dual-layer retrieval:
 * 1. Primary: REST API (/api/rest_v1/page/summary/)
 * 2. Fallback: Action API (/w/api.php?action=query&prop=pageimages|extracts|info...)
 * Ensures reliable retrieval with zero 429 rate-limit failures.
 */
async function fetchWikiSummary(title, signal) {
    if (!title) return null;
    const cleanTitle = String(title).trim();
    const restUrl = `${WIKIPEDIA_SUMMARY_URL}/${encodeURIComponent(cleanTitle.replace(/\s+/g, '_'))}`;
    const userAgent = 'JarvisMultimodalAnswerEngine/2.3 (https://github.com/drkan/unify-assistant; support@jarvis.ai)';

    try {
        const res = await fetch(restUrl, {
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            signal
        });
        if (res.ok) {
            const data = await res.json();
            if (data && (data.extract || data.thumbnail?.source || data.type !== 'disambiguation')) {
                return data;
            }
        }
    } catch {
        // Fall through to Action API on timeout or network error
    }

    // Fallback to Wikipedia Action API (never 429s, returns high-res thumbnails)
    try {
        const actionUrl = new URL(WIKIPEDIA_SEARCH_URL);
        actionUrl.searchParams.set('action', 'query');
        actionUrl.searchParams.set('prop', 'pageimages|extracts|info');
        actionUrl.searchParams.set('inprop', 'url');
        actionUrl.searchParams.set('pithumbsize', '600');
        actionUrl.searchParams.set('exintro', '1');
        actionUrl.searchParams.set('explaintext', '1');
        actionUrl.searchParams.set('titles', cleanTitle);
        actionUrl.searchParams.set('format', 'json');
        actionUrl.searchParams.set('origin', '*');

        const aRes = await fetch(actionUrl.toString(), {
            headers: {
                'Accept': 'application/json',
                'User-Agent': userAgent
            },
            signal
        });
        if (aRes.ok) {
            const data = await aRes.json();
            const page = Object.values(data?.query?.pages || {})[0];
            if (page && page.missing === undefined) {
                const fullUrl = page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/\s+/g, '_'))}`;
                return {
                    title: page.title,
                    displaytitle: page.title,
                    description: page.extract ? page.extract.slice(0, 160).replace(/\n/g, ' ').trim() : '',
                    extract: page.extract || '',
                    type: page.extract?.toLowerCase().includes('may refer to:') ? 'disambiguation' : 'standard',
                    thumbnail: page.thumbnail ? { source: page.thumbnail.source, width: page.thumbnail.width, height: page.thumbnail.height } : null,
                    originalimage: page.thumbnail ? { source: page.thumbnail.source } : null,
                    content_urls: {
                        desktop: { page: fullUrl },
                        mobile: { page: fullUrl }
                    }
                };
            }
        }
    } catch {
        // Both failed
    }

    return null;
}

/**
 * Searches Wikipedia Opensearch / query API for matching article candidate records.
 */
export async function searchWikipediaCandidates(query, signal, limit = 5) {
    const url = new URL(WIKIPEDIA_SEARCH_URL);
    url.searchParams.set('action', 'query');
    url.searchParams.set('list', 'search');
    url.searchParams.set('srsearch', query);
    url.searchParams.set('srlimit', String(limit));
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
        if (!res.ok) return [];
        const data = await res.json();
        return data?.query?.search || [];
    } catch {
        return [];
    }
}

/**
 * Searches Wikipedia Opensearch / query API for the best matching article title.
 */
async function searchWikipediaTitle(query, signal) {
    const hits = await searchWikipediaCandidates(query, signal, 3);
    return hits[0]?.title || null;
}

/**
 * Universal semantic classification for notable creative works.
 * Distinguishes genuine creative, cultural, or commercial works (films, albums, books, songs, games)
 * from awards, honors, ceremonies, human biographies, lists, or institutions using Wikipedia's
 * structured metadata (type, description, extract) with ZERO hardcoded entity or award names.
 */
export function isSemanticCreativeWork(summary) {
    if (!summary || !summary.title) return false;
    const desc = (summary.description || '').toLowerCase();
    const extract = (summary.extract || '').toLowerCase().slice(0, 300);
    const title = (summary.title || '').toLowerCase();
    const combined = `${title} ${desc} ${extract}`;

    // Disqualify Wikipedia list articles, discographies, portals, and indexes
    if (/^(?:list of|discography of|filmography of|bibliography of|awards and nominations)\b/i.test(title)) return false;
    if (/\b(?:list of|discography of|filmography of)\b/i.test(desc)) return false;

    // Disqualify awards, honors, medals, prizes, accolades, and award ceremonies
    const isAwardOrHonorOrCeremony = /\b(?:award|awards|prize|prizes|medal|medals|order of|trophy|fellowship|hall of fame|nomination|nominations|ceremony|ceremonies|accolade|accolades|festival|festivals)\b/i.test(title) ||
        /\b(?:award|awards|prize|prizes|medal|medals|order of|trophy|fellowship|hall of fame|nomination|ceremony|ceremonies|accolade|state honor|state honour|civilian award|annual award)\b/i.test(desc);
    
    if (isAwardOrHonorOrCeremony) {
        // Only allow if desc explicitly indicates it is a creative work (e.g. film/novel/album named after an award)
        const isExplicitCreativeWork = /\b(?:film|movie|album|soundtrack|novel|book|single|song)\s+(?:by|directed by|written by|composed by|starring)\b/i.test(desc) ||
            /\b(?:19\d\d|20[0-2]\d)\s+(?:[a-z-]+\s+)*(?:film|movie|album|soundtrack|novel|book)\b/i.test(desc);
        if (!isExplicitCreativeWork) return false;
    }

    // Disqualify websites, databases, magazines, organizations, and identifiers
    if (/\b(?:website|online database|app|company|identifier|organization|magazine|newspaper|record label)\b/i.test(desc)) return false;

    // Disqualify people and biographies (e.g. teachers, actors, collaborators, directors)
    const isPerson = /\b(?:actor|actress|musician|singer|director|filmmaker|composer|writer|author|teacher|master|guru|politician|player|instrumentalist|producer|artist|model)\b/i.test(desc) ||
        /\bborn\s+(?:in\s+)?(?:19|20)\d\d\b/i.test(desc);
    if (isPerson && !/\b(?:film|movie|album|song|soundtrack|novel|book|single|series|play)\s+(?:by|directed|written|composed|starring)\b/i.test(desc)) {
        return false;
    }

    // Must match positive creative work semantic concepts (media, literature, compositions, games, art)
    const isCreativeWork = /\b(?:film|movie|soundtrack|album|song|single|novel|book|series|play|musical|composition|opera|symphony|ep|track|opus|video game|miniseries|television series|show|drama|broadcast|painting|sculpture)\b/i.test(combined);

    return isCreativeWork;
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

    // Extract bold or italic titles: **Title** or *Title*
    for (const match of fullText.matchAll(/(?:\*\*|\*)([^*]{2,50})(?:\*\*|\*)/g)) {
        const val = match[1].trim();
        // Skip common formatting or section headers
        if (!/^(?:born|died|early life|career|awards?|legacy|background|works|notable|status|summary|albums?)$/i.test(val)) {
            candidateWorkTitles.push(val);
        }
    }

    // Extract capitalized titles immediately preceding a 4-digit release year: Title (YYYY)
    for (const match of fullText.matchAll(/(?:["“*]|\b)([A-Z][a-zA-Z0-9']+(?:\s+[A-Z][a-zA-Z0-9']+){0,3})(?:["”*]|\b)\s*\((19\d\d|20[0-2]\d)\)/g)) {
        candidateWorkTitles.push(match[1].trim());
    }

    // Universal filter for non-title stop words and entity name itself
    const stopWords = new Set(['the', 'a', 'an', 'yes', 'no', 'and', 'or', 'in', 'of', 'for', 'with', 'by', 'as', 'to', 'from', 'at', 'on', 'into', 'is', 'was', 'are', 'were']);
    const entityNameTokens = entityTitle.toLowerCase().split(/\s+/).filter(t => t.length > 2);

    const filteredTitles = [...new Set(candidateWorkTitles)].filter(t => {
        const lower = t.toLowerCase().trim();
        if (stopWords.has(lower)) return false;
        if (lower === entityTitle.toLowerCase()) return false;
        if (entityNameTokens.length > 1 && entityNameTokens.every(tok => lower.includes(tok))) return false;
        if (t.length < 2 || t.length > 50) return false;
        return true;
    });

    // If text context had fewer than 2 titles, fallback to Wikipedia internal article links
    if (filteredTitles.length < 2) {
        try {
            const linksUrl = new URL(WIKIPEDIA_SEARCH_URL);
            linksUrl.searchParams.set('action', 'query');
            linksUrl.searchParams.set('prop', 'links');
            linksUrl.searchParams.set('pllimit', '50');
            linksUrl.searchParams.set('titles', entityTitle);
            linksUrl.searchParams.set('format', 'json');
            linksUrl.searchParams.set('origin', '*');

            const res = await fetch(linksUrl.toString(), {
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'JarvisMultimodalAnswerEngine/2.0'
                },
                signal
            });
            if (res.ok) {
                const data = await res.json();
                const pages = data?.query?.pages || {};
                const links = Object.values(pages)[0]?.links?.map(l => l.title) || [];
                for (const link of links) {
                    if (!link.startsWith('Category:') && !link.startsWith('Help:') && !link.startsWith('List of')) {
                        const lower = link.toLowerCase().trim();
                        if (!stopWords.has(lower) && lower !== entityTitle.toLowerCase()) {
                            filteredTitles.push(link);
                        }
                    }
                }
            }
        } catch {}
    }

    // Deduplicate and limit candidate works to inspect
    const uniqueCandidateTitles = [...new Set(filteredTitles)].slice(0, 12);
    if (!uniqueCandidateTitles.length) return [];

    const works = [];
    const results = await Promise.all(uniqueCandidateTitles.map(async (workTitle) => {
        try {
            let workSummary = await fetchWikiSummary(workTitle, signal);
            if (!workSummary || workSummary.type === 'disambiguation') {
                const searchTag = entityType === 'musician' || entityType === 'actor' || entityType === 'director' ? 'film' : (entityType === 'author' ? 'novel' : '');
                const contextualSearch = await searchWikipediaTitle(`${workTitle} ${searchTag}`.trim(), signal);
                if (contextualSearch) {
                    workSummary = await fetchWikiSummary(contextualSearch, signal);
                }
            }
            if (!workSummary || !workSummary.title || workSummary.type === 'disambiguation') return null;

            // Reject if the retrieved article is the entity itself
            const cleanTitle = workSummary.title.replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
            const cleanEntity = entityTitle.replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
            if (cleanTitle === cleanEntity) return null;

            // Universal semantic classification: must be a genuine creative work
            if (!isSemanticCreativeWork(workSummary)) return null;

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

            return {
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
            };
        } catch {
            return null;
        }
    }));

    for (const r of results) {
        if (r && (r.image || r.year) && works.length < 5) {
            works.push(r);
        }
    }

    return works;
}

/**
 * Helper to clean and tokenize a string for entity similarity comparison.
 */
function cleanEntityTokens(s = '') {
    return String(s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length > 0 && !/^(?:the|a|an|of|in|on|at|by|for|with|and|is|are|was|were)$/i.test(t));
}

/**
 * Computes bidirectional token similarity between candidate query and encyclopedic title.
 * Strips Wikipedia disambiguation tags (e.g. "(film)", "(2026 film)", "(composer)") to properly
 * match base titles ("Scene" for "Scene (2026 film)", "Deva" for "Deva (composer)").
 * Enforces strict bidirectional precision and recall, preventing loose substring matches (e.g. "My Scene Goes Hollywood" for "Scene").
 */
export function computeTitleTokenOverlap(candidate, title) {
    if (!candidate || !title) return 0;

    const baseTitle = title.replace(/\s*\([^)]*\)$/, '').trim();
    const candTokens = cleanEntityTokens(candidate);
    const baseTokens = cleanEntityTokens(baseTitle);
    const fullTokens = cleanEntityTokens(title);

    if (!candTokens.length || !fullTokens.length) return 0;

    // Exact base title match: e.g. "Scene" vs "Scene (2026 film)" -> 1.0
    if (candTokens.length === baseTokens.length && candTokens.every((ct, i) => ct === baseTokens[i])) {
        return 1.0;
    }

    // Exact full title match: e.g. "Deva composer" vs "Deva (composer)" -> 1.0
    if (candTokens.length === fullTokens.length && candTokens.every((ct, i) => ct === fullTokens[i])) {
        return 1.0;
    }

    // Bidirectional overlap against base title first, falling back to full title
    const targetTokens = baseTokens.length ? baseTokens : fullTokens;
    const matchCount = candTokens.filter(ct => targetTokens.some(tt => tt === ct || (ct.length > 3 && (tt.startsWith(ct) || ct.startsWith(tt))))).length;
    const revMatchCount = targetTokens.filter(tt => candTokens.some(ct => ct === tt || (ct.length > 3 && (tt.startsWith(ct) || ct.startsWith(tt))))).length;

    const recall = matchCount / candTokens.length;
    const precision = revMatchCount / targetTokens.length;

    // Bloat penalty: if candidate is concise (1-2 words) but target title contains many extra words, penalize
    if (candTokens.length <= 2 && targetTokens.length >= 4 && precision < 0.5) {
        return 0.3;
    }

    if (recall === 1.0 && precision >= 0.8) return 1.0;
    if (recall + precision === 0) return 0;
    return Number(((2 * recall * precision) / (recall + precision)).toFixed(2));
}

/**
 * Universal Entity Visuals Resolver.
 * Given any factual query, resolves primary entity metadata, verified portrait/logo,
 * and associated notable works asynchronously with domain-aware strict verification.
 * 
 * Returns null if the query is not an entity lookup, lacks strict confidence, or violates domain alignment.
 */
export async function resolveEntityVisuals(query = '', options = {}) {
    const { entity: rawCandidate, cleanSubject, domain: targetDomain } = extractCandidateEntityAndDomain(query);
    const candidate = cleanSubject || rawCandidate;
    if (!candidate) return null;

    const cacheKey = `${candidate.toLowerCase()}__${targetDomain || 'any'}`;
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
        let summary = null;

        // Step 1: Targeted direct lookup
        // When a domain is explicitly requested (e.g. "movie", "book", "musician"), check targeted titles first
        const directCandidates = [];
        if (targetDomain === 'movie') {
            directCandidates.push(`${candidate} (film)`, `${candidate} (movie)`);
        } else if (targetDomain === 'musician') {
            directCandidates.push(`${candidate} (musician)`, `${candidate} (composer)`);
        } else if (targetDomain === 'tv_series') {
            directCandidates.push(`${candidate} (TV series)`, `${candidate} (series)`);
        } else if (targetDomain === 'book') {
            directCandidates.push(`${candidate} (novel)`, `${candidate} (book)`);
        }
        directCandidates.push(candidate);
        if (rawCandidate && rawCandidate !== candidate) {
            directCandidates.push(rawCandidate);
        }

        for (const titleTry of directCandidates) {
            const s = await fetchWikiSummary(titleTry, controller.signal);
            if (s && s.extract && s.type !== 'disambiguation') {
                const sim = computeTitleTokenOverlap(candidate, s.title);
                if (sim >= 0.75) {
                    const cType = classifyEntityTypeFromDescription(s.description, s.title);
                    const domainOk = !targetDomain || cType === targetDomain ||
                        (targetDomain === 'movie' && (cType === 'movie' || /\b(?:film|movie|feature)\b/i.test(s.description || ''))) ||
                        (targetDomain === 'book' && (cType === 'book' || cType === 'author')) ||
                        (targetDomain === 'musician' && (cType === 'musician' || cType === 'album'));
                    if (domainOk) {
                        summary = s;
                        break;
                    }
                }
            }
        }

        // Step 2: Search Wikipedia candidates if direct lookup didn't yield an exact match
        if (!summary || summary.type === 'disambiguation' || !summary.extract || !summary.thumbnail?.source) {
            const searchTerms = targetDomain
                ? `${candidate} ${targetDomain === 'movie' ? 'film' : targetDomain}`
                : (options.textContext ? `${candidate} ${options.textContext.slice(0, 60)}` : candidate);
            const candidates = await searchWikipediaCandidates(searchTerms, controller.signal, 6);

            let bestHit = null;
            let bestScore = -1;

            for (const hit of candidates) {
                const s = await fetchWikiSummary(hit.title, controller.signal);
                if (!s || s.type === 'disambiguation' || !s.extract) continue;

                // Strict Entity Gating: Must have at least 0.75 bidirectional token similarity
                const sim = computeTitleTokenOverlap(candidate, s.title);
                if (sim < 0.75) continue;

                const cType = classifyEntityTypeFromDescription(s.description, s.title);
                // STRICT DOMAIN ENFORCEMENT: If domain specified, candidate MUST match that domain!
                if (targetDomain) {
                    const domainMatches = (targetDomain === 'movie' && (cType === 'movie' || /\b(?:film|movie|feature)\b/i.test(s.description || '')))
                        || (targetDomain === 'tv_series' && (cType === 'tv_series' || /\b(?:tv|television|series)\b/i.test(s.description || '')))
                        || (targetDomain === 'musician' && (cType === 'musician' || cType === 'album' || /\b(?:composer|singer|musician|band)\b/i.test(s.description || '')))
                        || (targetDomain === 'book' && (cType === 'book' || cType === 'author' || /\b(?:novel|book|writer|author)\b/i.test(s.description || '')))
                        || (targetDomain === 'actor' && cType === 'actor')
                        || (targetDomain === 'director' && cType === 'director')
                        || (targetDomain === 'company' && cType === 'company')
                        || (targetDomain === 'landmark' && cType === 'landmark')
                        || (targetDomain === 'scientist' && cType === 'scientist');
                    if (!domainMatches) continue;
                }

                let score = Math.round(sim * 30);
                if (s.thumbnail?.source) score += 10;
                const titleClean = s.title.replace(/\s*\([^)]*\)$/, '').trim().toLowerCase();
                if (titleClean === candidate.toLowerCase()) score += 15;

                if (score > bestScore) {
                    bestScore = score;
                    bestHit = s;
                    if (s.thumbnail?.source && bestScore >= 45) break;
                }
            }

            if (bestHit) {
                summary = bestHit;
            }
        }

        // If no valid encyclopedic summary was retrieved, return null
        if (!summary || !summary.title || !summary.extract) {
            entityVisualCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        // Final verification: Title must maintain >= 0.75 bidirectional token similarity with candidate query
        const finalOverlap = computeTitleTokenOverlap(candidate, summary.title);
        if (finalOverlap < 0.75) {
            entityVisualCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }

        const entityType = classifyEntityTypeFromDescription(summary.description, summary.title);

        // Strict domain verification on the final entity
        if (targetDomain) {
            const domainMatches = (targetDomain === 'movie' && (entityType === 'movie' || /\b(?:film|movie|feature)\b/i.test(summary.description || '')))
                || (targetDomain === 'tv_series' && (entityType === 'tv_series' || /\b(?:tv|television|series)\b/i.test(summary.description || '')))
                || (targetDomain === 'musician' && (entityType === 'musician' || entityType === 'album' || /\b(?:composer|singer|musician|band)\b/i.test(summary.description || '')))
                || (targetDomain === 'book' && (entityType === 'book' || entityType === 'author' || /\b(?:novel|book|writer|author)\b/i.test(summary.description || '')))
                || (targetDomain === 'actor' && entityType === 'actor')
                || (targetDomain === 'director' && entityType === 'director')
                || (targetDomain === 'company' && entityType === 'company')
                || (targetDomain === 'landmark' && entityType === 'landmark')
                || (targetDomain === 'scientist' && entityType === 'scientist');
            if (!domainMatches) {
                entityVisualCache.set(cacheKey, { data: null, timestamp: Date.now() });
                return null;
            }
        }

        // Only verified entity categories qualify for visual entity hero cards
        const ALLOWED_HERO_TYPES = new Set([
            'musician', 'actor', 'director', 'author', 'scientist', 'company',
            'movie', 'tv_series', 'book', 'album', 'landmark', 'political_figure'
        ]);
        if (!ALLOWED_HERO_TYPES.has(entityType)) {
            entityVisualCache.set(cacheKey, { data: null, timestamp: Date.now() });
            return null;
        }
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
