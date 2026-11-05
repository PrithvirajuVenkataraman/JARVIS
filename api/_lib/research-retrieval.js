import { cleanSnippetText } from './snippet-sanitizer.js';
import { isPublicWebUrl } from './public-web-url.js';
import { comparisonParts, normalizeResearchAliases } from './research-evidence.js';

const COMPARISON_ATTRIBUTE_ALIASES = {
    population: ['population', 'demographic', 'demographics', 'inhabitants'],
    'land area': ['land area', 'surface area', 'square kilomet', 'square mile'],
    area: ['area', 'square kilomet', 'square mile'],
    gdp: ['gdp', 'gross domestic product'],
    price: ['price', 'cost', 'pricing'], cost: ['price', 'cost', 'pricing'],
    'life expectancy': ['life expectancy', 'lifespan'],
    performance: ['performance', 'benchmark', 'throughput', 'latency'],
    speed: ['speed', 'benchmark', 'throughput', 'latency'],
    'release date': ['release date', 'released', 'release schedule'],
    'release dates': ['release date', 'released', 'release schedule']
};

export function buildComparisonSearchQueries(query) {
    const { entities, attributes } = comparisonParts(query);
    if (entities.length !== 2 || !attributes.length) return [];
    return entities.map(entity => `${entity} ${attributes.join(' ')}`.trim());
}

export function matchesComparisonAttribute(query, source) {
    const { attributes } = comparisonParts(query);
    if (!attributes.length) return true;
    const text = normalizeResearchAliases(`${source?.title || ''} ${source?.description || source?.snippet || ''} ${source?.fullArticleText || source?.text || ''}`).toLowerCase();
    return attributes.some(attribute => (COMPARISON_ATTRIBUTE_ALIASES[attribute] || [attribute]).some(alias => text.includes(alias)));
}

const SOFTWARE_DOCUMENTATION = [
    [/\bnext\.js\b/i, 'nextjs.org'],
    [/\breact(?:\.js)?\b|react server components/i, 'react.dev'],
    [/\bnode\.js\b/i, 'nodejs.org'],
    [/\btypescript\b/i, 'typescriptlang.org'],
    [/\bpython\b/i, 'docs.python.org'],
    [/\bvue(?:\.js)?\b/i, 'vuejs.org'],
    [/\bsvelte\b/i, 'svelte.dev'],
    [/\bangular\b/i, 'angular.dev'],
    [/\brust\b/i, 'doc.rust-lang.org'],
    [/\bkubernetes\b/i, 'kubernetes.io'],
    [/\bdocker\b/i, 'docs.docker.com'],
    [/\bpostgres(?:ql)?\b/i, 'postgresql.org'],
    [/\b(?:javascript|css|html)\b/i, 'developer.mozilla.org']
];

export function isConceptualSoftwareQuery(query) {
    const text = String(query || '');
    if (/\b(?:news|headlines?|vulnerabilit(?:y|ies)|exploit|breach|attack|cve-\d+)\b/i.test(text)
        && !/\b(?:explain|how|why|documentation|docs?|guide)\b/i.test(text)) return false;
    return SOFTWARE_DOCUMENTATION.some(([pattern]) => pattern.test(text))
        && /\b(?:what|how|why|explain|understand|compare|comparison|vs|versus|difference|documentation|docs?|guide|api|components?|routing|router|hooks?|rendering|streams?|performance|deployment|syntax|types?|install|configure|tutorial)\b/i.test(text);
}

export function buildOfficialDocumentationQuery(query) {
    const text = String(query || '').trim();
    const domains = SOFTWARE_DOCUMENTATION.filter(([pattern]) => pattern.test(text)).map(([, domain]) => domain);
    // The framework's own documentation takes precedence over a constituent library.
    return domains.length ? `${text} site:${domains[0]}` : `${text} official documentation`;
}

export function isUnrelatedSoftwareIncident(query, source) {
    if (!isConceptualSoftwareQuery(query) || /\b(?:security|vulnerabilit(?:y|ies)|exploit|cve|rce|attack|breach)\b/i.test(query)) return false;
    return /\b(?:cve-\d+|remote.code.execution|rce|vulnerabilit(?:y|ies)|security.advisory|security.update|breach|exploit|supply.chain.attack)\b/i.test(`${source?.title || ''} ${source?.url || ''}`);
}

export function isGoogleNewsWrapper(value) {
    try { return new URL(value).hostname.toLowerCase() === 'news.google.com'; }
    catch { return false; }
}

function hostname(value) {
    try { return new URL(value.includes('://') ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ''); }
    catch { return ''; }
}

export function preserveDiscoveryMetadata(source, query = '') {
    const item = { ...source };
    const wrapper = isGoogleNewsWrapper(item.url);
    const declaredDomain = hostname(String(item.publisherDomain || item.publisherUrl || (wrapper ? item.domain || '' : '')));
    if (declaredDomain && declaredDomain !== 'news.google.com') item.publisherDomain = declaredDomain;
    if (wrapper) {
        item.discoveryUrl = item.discoveryUrl || item.url;
        item.originalUrl = item.originalUrl || item.url;
        item.discoveryDomain = 'news.google.com';
        if (item.publisherDomain) item.domain = item.publisherDomain;
    }
    if (query && !item.query) item.query = query;
    return item;
}

function articleTitle(source) {
    let title = cleanSnippetText(source?.title || '').trim();
    const publisher = cleanSnippetText(source?.publisher || '').trim();
    if (publisher && title.toLowerCase().endsWith(` - ${publisher.toLowerCase()}`)) title = title.slice(0, -(publisher.length + 3)).trim();
    return title.replace(/["“”]/g, '').slice(0, 300);
}

export function buildPublisherRecoveryQuery(source) {
    const item = preserveDiscoveryMetadata(source);
    const title = articleTitle(item);
    if (title.length < 12) return '';
    const domain = item.publisherDomain;
    const publisher = cleanSnippetText(item.publisher || '').trim().slice(0, 100);
    if (!domain && !publisher) return '';
    return `"${title}" ${domain ? `site:${domain}` : publisher}`;
}

export function isMatchingPublisherArticle(candidate, source) {
    if (!isPublicWebUrl(candidate?.url) || isGoogleNewsWrapper(candidate.url)) return false;
    const item = preserveDiscoveryMetadata(source);
    const candidateDomain = hostname(candidate.url);
    if (item.publisherDomain && candidateDomain !== item.publisherDomain && !candidateDomain.endsWith(`.${item.publisherDomain}`)) return false;
    const tokenize = value => cleanSnippetText(value).toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
    const expected = new Set(tokenize(articleTitle(item)));
    const found = new Set(tokenize(articleTitle(candidate)));
    const matching = [...expected].filter(token => found.has(token)).length;
    // A familiar publisher is insufficient: the discovery must locate this article.
    return expected.size >= 2 && matching / expected.size >= (item.publisherDomain ? 0.6 : 0.8);
}
