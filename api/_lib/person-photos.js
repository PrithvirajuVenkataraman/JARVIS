import { fetchWithLifecycle as fetch, currentRequestSignal } from './request-lifecycle.js';
import { resolveEntityVisuals, isValidImageUrl } from './visual-answer-engine.js';
import { personPhotoQuery, personPhotoSubject } from '../../app/person-photo-query.js';
import { searchDuckDuckGoHtml, searchSearXNGRacer } from './free-live/providers.js';
import { fetchPublicPage, isPublicWebUrl } from './public-web-url.js';
import { isBlockedSafetyDomain } from './safety-guard.js';

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'JARVIS/1.0 (+https://github.com/PrithvirajuVenkataraman/JARVIS)' };
const WEB_PAGE_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
};
const SKIPPED_WEB_PHOTO_DOMAINS = /(?:^|\.)(?:linkedin\.com|facebook\.com|instagram\.com|tiktok\.com|twitter\.com|x\.com|pinterest\.[a-z.]+|gettyimages\.[a-z.]+|shutterstock\.com|alamy\.com|istockphoto\.com|dreamstime\.com|123rf\.com|vecteezy\.com|youtube\.com|youtu\.be)$/i;
const NON_PORTRAIT_IMAGE_RE = /(?:^|[/_-])(?:logo|favicon|sprite|icon|placeholder|default[-_]?avatar|blank|pixel|1x1|spacer|badge|banner-bg)(?:[/_.-]|$)|\.(?:svg|ico)(?:[?#]|$)/i;
const cache = new Map();
const profileCache = new Map();
const profileStatusCache = new Map();

function inheritedSignal(signal) {
    const parent = currentRequestSignal();
    return parent && signal ? AbortSignal.any([parent, signal]) : parent || signal;
}

export function metadataText(value, max = 180) {
    return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(?:amp|quot|apos|lt|gt|nbsp);/g, token => ({ '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' })[token])
        .replace(/\s+/g, ' ').trim().slice(0, max);
}

export function imageDate(value, now = new Date()) {
    const text = metadataText(value);
    const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?(?:$|[ T])/.exec(text);
    if (!match) return null;
    const [, year, month, day] = match;
    if (+year < 1000 || +year > now.getUTCFullYear() || (month && (+month < 1 || +month > 12))) return null;
    if (day && (+day < 1 || +day > new Date(Date.UTC(+year, +month, 0)).getUTCDate())) return null;
    const date = [year, month, day].filter(Boolean).join('-');
    if (date > now.toISOString().slice(0, date.length)) return null;
    return date;
}

function sourceFile(imageUrl) {
    try {
        if (!isValidImageUrl(imageUrl)) return '';
        const path = new URL(imageUrl).pathname.split('/');
        const name = decodeURIComponent(path.includes('thumb') ? path.at(-2) : path.at(-1));
        return name && !/[|\n\r]/.test(name) ? `File:${name}` : '';
    } catch { return ''; }
}

export function commonsImage(page, now = new Date()) {
    const info = page?.imageinfo?.[0];
    const url = info?.thumburl || info?.url;
    if (!info || !isValidImageUrl(url) || !/^image\/(?:jpeg|png|webp)$/i.test(info.mime || '')) return null;
    let source;
    try { source = new URL(info.descriptionurl); } catch { return null; }
    if (source.protocol !== 'https:' || source.hostname !== 'commons.wikimedia.org' || !source.pathname.startsWith('/wiki/File:')) return null;
    const meta = info.extmetadata || {};
    const description = metadataText(meta.ImageDescription?.value, 1000);
    const classification = `${page.title || ''} ${description} ${metadataText(meta.Categories?.value, 3000)}`.replace(/_/g, ' ');
    if (/\b(?:paintings?|drawings?|watercolou?rs?|sketch(?:es)?|gouache|charcoal|illustrations?|caricatures?|cartoons?|sculptures?|statues?|wax figures?|AI.generated|digitally generated|digital art|fan art|photomontages?)\b/i.test(classification)) return null;
    const hasCamera = info.metadata?.some(item => /^(?:Make|Model|LensModel)$/i.test(item.name || '') && item.value);
    if (!hasCamera && !/\b(?:photographs?|photos?|photographic)\b/i.test(classification)) return null;
    // Upload timestamps and page publication dates are deliberately not capture dates.
    return {
        url, sourceUrl: source.href, width: info.thumbwidth || info.width, height: info.thumbheight || info.height,
        imageDate: imageDate(meta.DateTimeOriginal?.value, now),
        author: metadataText(meta.Artist?.value), license: metadataText(meta.LicenseShortName?.value, 60),
        caption: description.slice(0, 180), sourceName: 'Wikimedia Commons'
    };
}

async function json(url, signal) {
    const response = await fetch(url, { headers: HEADERS, signal });
    if (!response.ok) return null;
    return response.json();
}

async function commons(params, signal) {
    const url = new URL(COMMONS);
    for (const [key, value] of Object.entries({ action: 'query', format: 'json', formatversion: 2, prop: 'imageinfo', iiprop: 'url|size|mime|metadata|extmetadata', iiurlwidth: 720, iiextmetadatalanguage: 'en', iiextmetadatafilter: 'DateTimeOriginal|Artist|LicenseShortName|ImageDescription|Categories', ...params })) url.searchParams.set(key, String(value));
    const data = await json(url, signal);
    return (data?.query?.pages || []).map(page => commonsImage(page)).filter(Boolean);
}

// Role-qualified aliases remain useful when an article's canonical name changes.
// Match Wikipedia's own titles/redirects and then verify human identity in Wikidata.
export async function resolveRolePerson(subject, signal) {
    const url = new URL('https://en.wikipedia.org/w/api.php');
    const params = { action: 'query', generator: 'search', gsrsearch: `${subject.name} ${subject.role}`, gsrlimit: 5, gsrnamespace: 0, prop: 'pageprops|pageimages|extracts|info|redirects', ppprop: 'wikibase_item|disambiguation', pithumbsize: 720, exintro: 1, explaintext: 1, exchars: 700, inprop: 'url', rdlimit: 50, format: 'json', formatversion: 2 };
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    const data = await json(url, signal);
    const normalize = value => String(value || '').normalize('NFKC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase();
    const expected = normalize(subject.name);
    const matches = (data?.query?.pages || []).filter(page => {
        if (!/^Q\d+$/.test(page.pageprops?.wikibase_item || '') || Object.hasOwn(page.pageprops || {}, 'disambiguation')) return false;
        const aliases = [page.title, ...(page.redirects || []).map(redirect => redirect.title)];
        if (aliases.some(title => { const alias = personPhotoSubject(title); return normalize(alias.name) === expected && alias.role === subject.role; })) return true;
        const canonical = String(page.title || '').replace(/\s*\([^)]*\)$/, '');
        const roleWords = subject.role === 'actor' ? 'actor|actress' : subject.role === 'author' ? 'author|writer' : subject.role;
        return normalize(canonical) === expected && new RegExp(`\\b(?:${roleWords})\\b`, 'i').test(String(page.extract || '').split(/\n/)[0]);
    });
    const identities = [...new Map(matches.map(page => [page.pageprops.wikibase_item, page])).values()];
    if (identities.length > 1) return { ambiguous: true };
    if (identities.length !== 1) return null;
    const page = identities[0];
    return { id: `entity_${page.pageid}`, name: page.title.replace(/\s*\([^)]*\)$/, ''), fullName: page.title, wikidataId: page.pageprops.wikibase_item, type: subject.role, extract: page.extract || '', source: { name: 'Wikipedia', url: page.fullurl }, image: page.thumbnail ? { url: page.thumbnail.source, width: page.thumbnail.width, height: page.thumbnail.height } : null };
}

function recordProfileStatus(key, status) {
    if (profileStatusCache.size >= 200) profileStatusCache.delete(profileStatusCache.keys().next().value);
    profileStatusCache.set(key, { status, expires: Date.now() + 60000 });
}

export async function resolvePersonProfile(query, options = {}) {
    const subject = personPhotoQuery(query, options.reference);
    const parent = inheritedSignal(options.signal);
    if (!subject || parent?.aborted) return null;
    const key = subject.toLocaleLowerCase();
    const cached = profileCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(4500)]) : AbortSignal.timeout(4500);
    let entity = null;
    let status = 'not_found';
    try {
        const qualified = personPhotoSubject(subject);
        let disambiguated = false;
        if (qualified.role) {
            const roleResult = await resolveRolePerson(qualified, signal);
            if (roleResult?.ambiguous) { disambiguated = true; entity = null; }
            else entity = roleResult;
        } else {
            entity = (await resolveEntityVisuals(subject, {
                signal, timeoutMs: 3500, includeNotableWorks: false, personPhoto: true,
                onDisambiguation: () => { disambiguated = true; }
            }))?.entity;
        }
        if (disambiguated) { status = 'ambiguous'; entity = null; return null; }
        if (!/^Q\d+$/.test(entity?.wikidataId || '')) { entity = null; return null; }
        const claims = new URL('https://www.wikidata.org/w/api.php');
        for (const [k, v] of Object.entries({ action: 'wbgetclaims', entity: entity.wikidataId, property: 'P31', format: 'json' })) claims.searchParams.set(k, v);
        const identity = await json(claims, signal);
        const p31 = identity?.claims?.P31 || [];
        if (!p31.some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5')) {
            if (p31.length > 0) status = 'non_human';
            entity = null;
            return null;
        }
        status = 'person';
        return entity;
    } catch { entity = null; return null; }
    finally {
        if (!signal.aborted) {
            if (profileCache.size >= 200) profileCache.delete(profileCache.keys().next().value);
            profileCache.set(key, { value: entity, expires: Date.now() + (entity ? 900000 : 60000) });
            recordProfileStatus(key, status);
        }
    }
}

function personTokens(name = '') {
    return String(name || '').toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(t => t.length >= 2);
}

function sanitizeImageUrl(rawUrl, baseUrl) {
    try {
        const resolved = new URL(String(rawUrl || '').trim(), baseUrl);
        if (resolved.protocol !== 'https:' || !isPublicWebUrl(resolved.href)) return '';
        if (NON_PORTRAIT_IMAGE_RE.test(resolved.pathname)) return '';
        return resolved.href;
    } catch { return ''; }
}

function parseMetaTags(html = '') {
    const metas = [];
    for (const tag of String(html || '').match(/<meta\b[^>]*>/gi) || []) {
        const key = (/\b(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1] || '').toLowerCase();
        const content = /\bcontent=["']([^"']+)["']/i.exec(tag)?.[1] || '';
        if (key && content) metas.push({ key, content });
    }
    return metas;
}

function extractJsonLdPersonImage(html = '', tokens = []) {
    const scripts = String(html || '').match(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
    for (const block of scripts) {
        const rawJson = block.replace(/^<script[^>]*>|<\/script>$/gi, '').trim();
        if (!rawJson) continue;
        try {
            const parsed = JSON.parse(rawJson);
            const nodes = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.['@graph']) ? parsed['@graph'] : [parsed]);
            for (const node of nodes) {
                const types = Array.isArray(node?.['@type']) ? node['@type'] : [node?.['@type']];
                if (!types.some(t => /^person$/i.test(String(t || '')))) continue;
                const nodeName = String(node?.name || '').toLowerCase();
                if (tokens.length && !tokens.every(t => nodeName.includes(t))) continue;
                const img = Array.isArray(node?.image) ? node.image[0] : node?.image;
                const candidate = typeof img === 'string' ? img : (img?.url || img?.contentUrl || '');
                if (candidate) return candidate;
            }
        } catch { /* ignore malformed JSON-LD */ }
    }
    return '';
}

function extractWebPortraitFromHtml(html = '', pageUrl = '', targetName = '') {
    const text = String(html || '');
    if (!text || /captcha|cloudflare|access denied|sign in to continue|log in/i.test(text.slice(0, 2500)) && text.length < 4000) return null;
    const tokens = personTokens(targetName);
    const titleText = metadataText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(text)?.[1] || '', 300).toLowerCase();
    const h1Text = metadataText(/<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(text)?.[1] || '', 300).toLowerCase();
    const bodyLead = metadataText(text.slice(0, 25000), 5000).toLowerCase();
    const mentionsPerson = tokens.length > 0 && (tokens.every(t => titleText.includes(t) || h1Text.includes(t)) || tokens.every(t => bodyLead.includes(t)));
    if (!mentionsPerson) return null;

    const metas = parseMetaTags(text);
    const width = Number(metas.find(m => m.key === 'og:image:width')?.content) || 0;
    const height = Number(metas.find(m => m.key === 'og:image:height')?.content) || 0;
    const mime = metas.find(m => m.key === 'og:image:type')?.content || '';
    if (mime && !/^image\/(?:jpeg|jpg|png|webp)$/i.test(mime)) return null;
    if ((width && width < 120) || (height && height < 120)) return null;

    const candidates = [];
    const jsonLdImg = extractJsonLdPersonImage(text, tokens);
    if (jsonLdImg) candidates.push({ raw: jsonLdImg, width, height });
    for (const key of ['og:image', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
        const hit = metas.find(m => m.key === key);
        if (hit?.content) candidates.push({ raw: hit.content, width, height });
    }
    for (const tag of text.match(/<img\b[^>]*>/gi) || []) {
        const src = /\b(?:src|data-src|data-desktop)=["']([^"']+)["']/i.exec(tag)?.[1] || '';
        const alt = /\balt=["']([^"']*)["']/i.exec(tag)?.[1] || '';
        if (src && tokens.length && tokens.every(t => `${alt} ${src}`.toLowerCase().includes(t))) {
            candidates.push({ raw: src, width: 0, height: 0 });
        }
    }

    for (const item of candidates) {
        const url = sanitizeImageUrl(item.raw, pageUrl);
        if (!url) continue;
        const host = new URL(pageUrl).hostname.replace(/^www\./, '');
        return {
            url,
            sourceUrl: pageUrl,
            sourceName: host,
            width: item.width || undefined,
            height: item.height || undefined,
            imageDate: null,
            author: '',
            license: '',
            caption: ''
        };
    }
    return null;
}

function scoreWebPersonHit(hit, tokens, contextTokens) {
    let urlObj;
    try { urlObj = new URL(hit?.url || ''); } catch { return -1; }
    if (urlObj.protocol !== 'https:' || !isPublicWebUrl(urlObj.href) || isBlockedSafetyDomain(urlObj.href)) return -1;
    const host = urlObj.hostname.toLowerCase();
    if (SKIPPED_WEB_PHOTO_DOMAINS.test(host)) return -1;

    const title = String(hit.title || '').toLowerCase();
    const snippet = String(hit.snippet || hit.description || '').toLowerCase();
    const combined = `${title} ${urlObj.href.toLowerCase()} ${snippet}`;
    if (tokens.length && !tokens.every(t => combined.includes(t))) return -1;

    let score = 10;
    const joined = tokens.join('');
    if (joined.length >= 5 && host.replace(/[^a-z0-9]/g, '').includes(joined)) score += 45;
    if (tokens.every(t => title.includes(t))) score += 20;
    if (/\/(?:about|bio|biography|team|leadership|management|executive|people|person|profile)\b/i.test(urlObj.pathname)) score += 15;
    if (/(?:forbes\.com|bloomberg\.com|crunchbase\.com|britannica\.com|imdb\.com|reuters\.com|apnews\.com|bbc\.com|nytimes\.com)$/i.test(host)) score += 10;
    if (contextTokens.length && contextTokens.some(t => combined.includes(t))) score += 15;
    return score;
}

export async function resolveWebPersonPhoto(targetName, options = {}, dependencies = {}) {
    const cleanName = metadataText(targetName, 120);
    const contextHint = metadataText(options.contextHint || '', 80);
    const tokens = personTokens(cleanName);
    if (!cleanName || (tokens.length < 2 && !contextHint)) return null;
    if (!options.hasResolvedName && /\b(?:ceo|cfo|cto|coo|founder|co-founder|president|vice\s+president|chairman|chairperson|minister|governor|mayor|company|corporation|inc|llc|ltd|limited|university|country|city|movie|film|album|song|book)\b/i.test(cleanName)) return null;

    const signal = options.signal;
    const searchQuery = contextHint && !cleanName.toLowerCase().includes(contextHint.toLowerCase()) ? `${cleanName} ${contextHint}` : cleanName;
    const searchFn = dependencies.search || (async q => {
        const [ddgRes, searxRes] = await Promise.allSettled([
            searchDuckDuckGoHtml(q, { limit: 6, timeoutMs: 2500, signal }),
            searchSearXNGRacer(q, { limit: 6, timeoutMs: 3200, signal })
        ]);
        const ddg = ddgRes.status === 'fulfilled' && Array.isArray(ddgRes.value) ? ddgRes.value : [];
        const searx = searxRes.status === 'fulfilled' && Array.isArray(searxRes.value) ? searxRes.value : [];
        const seen = new Set();
        return [...ddg, ...searx].filter(item => {
            const url = String(item?.url || '').trim();
            if (!url || seen.has(url)) return false;
            seen.add(url);
            return true;
        });
    });
    const fetchPageFn = dependencies.fetchPage || (url => fetchPublicPage(url, { timeoutMs: 3200, maxBytes: 400_000, headers: WEB_PAGE_HEADERS, signal }));

    const hits = await searchFn(searchQuery).catch(() => []);
    const contextTokens = personTokens(contextHint);
    const ranked = (Array.isArray(hits) ? hits : [])
        .map(hit => ({ hit, score: scoreWebPersonHit(hit, tokens, contextTokens) }))
        .filter(entry => entry.score >= 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
    if (!ranked.length) return null;

    const pages = await Promise.all(ranked.map(async ({ hit }) => {
        try {
            const page = await fetchPageFn(hit.url);
            if (!page?.response?.ok) return null;
            const html = await page.response.text();
            return extractWebPortraitFromHtml(html, page.url || hit.url, cleanName);
        } catch { return null; }
    }));
    const selected = pages.find(Boolean);
    if (!selected) return null;

    const displayName = cleanName.replace(/\b\p{L}/gu, c => c.toUpperCase());
    return {
        entity: {
            id: `web_person_${encodeURIComponent(cleanName.toLowerCase())}`,
            name: displayName,
            fullName: displayName,
            wikidataId: null,
            isPerson: true,
            extract: '',
            image: { ...selected, alt: displayName, selection: 'reference_portrait' }
        },
        notableWorks: []
    };
}

export async function resolvePersonPhoto(query, options = {}) {
    const subject = personPhotoQuery(query, options.reference);
    const resolvedName = metadataText(options.resolvedName || '', 120);
    const contextHint = metadataText(options.contextHint || '', 80);
    const parent = inheritedSignal(options.signal);
    if (!subject || parent?.aborted) return null;
    const key = `${subject.toLocaleLowerCase()}::${resolvedName.toLocaleLowerCase()}::${contextHint.toLocaleLowerCase()}`;
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const signal = parent ? AbortSignal.any([parent, AbortSignal.timeout(11500)]) : AbortSignal.timeout(11500);
    let result = null;
    try {
        const lookupName = resolvedName || subject;
        const entity = await resolvePersonProfile(lookupName, { signal, reference: options.reference });
        const status = profileStatusCache.get(lookupName.toLocaleLowerCase())?.status;
        if (!entity && (status === 'non_human' || (status === 'ambiguous' && !contextHint && !resolvedName))) {
            return null;
        }
        if (entity) {
            const title = sourceFile(entity.image?.url);
            const search = { generator: 'search', gsrnamespace: 6, gsrsort: 'create_timestamp_desc' };
            const [typed, depicted, referenceImages] = await Promise.all([
                commons({ ...search, gsrlimit: 8, gsrsearch: `haswbstatement:P180=${entity.wikidataId} haswbstatement:P31=Q125191 filetype:bitmap` }, signal).catch(() => []),
                commons({ ...search, gsrlimit: 12, gsrsearch: `haswbstatement:P180=${entity.wikidataId} filetype:bitmap` }, signal).catch(() => []),
                title ? commons({ titles: title }, signal).catch(() => []) : []
            ]);
            const candidates = [...typed, ...depicted];
            const reference = referenceImages[0];
            if (reference) candidates.push(reference);
            let selected = candidates.filter(image => image.imageDate).sort((a, b) => b.imageDate.localeCompare(a.imageDate))[0];
            if (!selected) {
                selected = reference;
                selected ||= entity.image ? { ...entity.image, sourceName: 'Wikipedia', imageDate: null, author: '', license: '' } : null;
            }
            if (selected) {
                result = { entity: { ...entity, isPerson: true, image: { ...selected, alt: entity.name, selection: selected.imageDate ? 'dated_image' : 'reference_portrait' } }, notableWorks: [] };
                return result;
            }
        }
        const webTarget = personPhotoSubject(lookupName);
        const webName = webTarget.role ? webTarget.name : lookupName;
        const webContext = [contextHint, webTarget.role].filter(Boolean).join(' ');
        result = await resolveWebPersonPhoto(webName, { contextHint: webContext, signal, hasResolvedName: Boolean(resolvedName) });
        return result;
    } catch { return null; }
    finally {
        if (!signal.aborted) {
            if (cache.size >= 200) cache.delete(cache.keys().next().value);
            cache.set(key, { value: result, expires: Date.now() + (result ? 3600000 : 60000) });
        }
    }
}
