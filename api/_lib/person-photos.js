import { fetchWithLifecycle as fetch } from './request-lifecycle.js';
import { resolveEntityVisuals, isValidImageUrl } from './visual-answer-engine.js';
import { personPhotoQuery, personPhotoSubject } from '../../app/person-photo-query.js';

const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const HEADERS = { Accept: 'application/json', 'User-Agent': 'JARVIS/1.0 (+https://github.com/PrithvirajuVenkataraman/JARVIS)' };
const cache = new Map();

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
    if (identities.length !== 1) return null;
    const page = identities[0];
    return { id: `entity_${page.pageid}`, name: page.title.replace(/\s*\([^)]*\)$/, ''), fullName: page.title, wikidataId: page.pageprops.wikibase_item, type: subject.role, extract: page.extract || '', source: { name: 'Wikipedia', url: page.fullurl }, image: page.thumbnail ? { url: page.thumbnail.source, width: page.thumbnail.width, height: page.thumbnail.height } : null };
}

export async function resolvePersonPhoto(query, options = {}) {
    const subject = personPhotoQuery(query, options.reference);
    if (!subject || options.signal?.aborted) return null;
    const key = subject.toLocaleLowerCase();
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(7500)]) : AbortSignal.timeout(7500);
    let result = null;
    try {
        const qualified = personPhotoSubject(subject);
        const entity = qualified.role
            ? await resolveRolePerson(qualified, signal)
            : (await resolveEntityVisuals(subject, { signal, timeoutMs: 4500, includeNotableWorks: false, personPhoto: true }))?.entity;
        if (!/^Q\d+$/.test(entity?.wikidataId || '')) return null;
        const claims = new URL('https://www.wikidata.org/w/api.php');
        for (const [k, v] of Object.entries({ action: 'wbgetclaims', entity: entity.wikidataId, property: 'P31', format: 'json' })) claims.searchParams.set(k, v);
        const identity = await json(claims, signal);
        if (!identity?.claims?.P31?.some(claim => claim.mainsnak?.datavalue?.value?.id === 'Q5')) return null;
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
        if (selected) result = { entity: { ...entity, isPerson: true, image: { ...selected, alt: entity.name, selection: selected.imageDate ? 'dated_image' : 'reference_portrait' } }, notableWorks: [] };
        return result;
    } catch { return null; }
    finally {
        if (!signal.aborted) {
            if (cache.size >= 200) cache.delete(cache.keys().next().value);
            cache.set(key, { value: result, expires: Date.now() + (result ? 3600000 : 60000) });
        }
    }
}
