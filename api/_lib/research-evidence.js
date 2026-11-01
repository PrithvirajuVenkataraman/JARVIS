import { extractRegistrableDomain } from '../../app/search/corroboration.mjs';
import { computeBM25Scores } from './bm25.js';
import { classifyDomainTrustTier } from './domain-trust-registry.js';
import { parseDocumentDate, extractQueryDateIntent } from './hybrid-reranker.js';

const STOP = new Set(('a an the and or to of in on at for from by with without as is are was were be been being do does did can could would should will may how what which who where when why tell me please explain compare comparison between versus vs give list name names people persons three two four five six seven eight nine ten official documentation docs information details overview latest current today yesterday recent news updates year').split(' '));

export function researchTerms(text = '') {
    return [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).filter(t => t.length > 2 && !STOP.has(t)))];
}

export function protectedEntities(query = '') {
    // Punctuation carries identity: Next.js is not Next, C++ is not C.
    return [...new Set((String(query).match(/\b[\p{L}\p{N}]+(?:\.[\p{L}]+)+\b|\b[\p{L}][\p{L}\p{N}]*(?:\+\+|#)|(?<!\w)\.[A-Za-z]{2,}\b/gu) || []).map(s => s.toLowerCase()))];
}

export function matchesProtectedEntities(query, text, domain = '') {
    const hay = String(text).toLowerCase();
    const host = String(domain).toLowerCase();
    return protectedEntities(query).every(entity => {
        if (entity.includes('+') || entity.includes('#')) return hay.includes(entity);
        const compact = entity.replace(/[^\p{L}\p{N}]/gu, '');
        const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(hay)
            || host.split('.').some(label => label === compact);
    });
}

export function canonicalResearchUrl(value) {
    try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
        url.hash = '';
        for (const key of [...url.searchParams.keys()]) {
            if (/^(?:utm_.+|fbclid|gclid|msockid)$/i.test(key)) url.searchParams.delete(key);
        }
        return url.toString().replace(/\/$/, '');
    } catch { return ''; }
}

export function assessSourceRelevance(query, source = {}) {
    const text = `${source.title || ''} ${source.description || source.snippet || ''} ${source.fullArticleText || source.text || ''}`;
    const domain = source.domain || (() => { try { return new URL(source.url).hostname; } catch { return ''; } })();
    if (!matchesProtectedEntities(query, text, domain)) return { relevant: false, score: 0 };
    const terms = researchTerms(query);
    const words = new Set(String(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    const hits = terms.filter(t => words.has(t));
    const threshold = Math.min(3, Math.max(1, Math.ceil(terms.length * 0.35)));
    return { relevant: terms.length === 0 || hits.length >= threshold, score: hits.length / Math.max(1, terms.length) };
}

export function normalizeEvidence(source, query) {
    const url = canonicalResearchUrl(source?.url);
    if (!url || !source.title || !assessSourceRelevance(query, source).relevant) return null;
    const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (classifyDomainTrustTier(domain, url).tier === 4) return null;
    const snippet = String(source.snippet || source.description || '').trim();
    const article = String(source.fullArticleText || source.extract || '').trim();
    const pageRead = source.pageFetched === true || source.deepCrawled === true || source.isScraped === true;
    const body = pageRead ? article : '';
    return {
        ...source, url, domain, publisherDomain: extractRegistrableDomain(domain),
        snippet, description: snippet, fullArticleText: body, extract: body,
        evidenceKind: body ? 'article' : source.evidenceLevel === 'structured_claim' ? 'structured' : 'snippet',
        extractionStatus: source.extractionStatus || (body ? 'extracted' : source.accessible === false ? 'blocked' : 'not_fetched'),
        pageFetched: Boolean(body), fetchedAt: source.fetchedAt || null,
        relevance: assessSourceRelevance(query, source).score
    };
}

export function evidenceText(source) {
    return String(source.fullArticleText || source.text || source.snippet || source.description || '').trim();
}

export function rankResearchEvidence(plan, sources, limit = 8) {
    const lexical = computeBM25Scores(plan.query, sources.map(s => ({ text: `${s.title} ${evidenceText(s)}` })));
    const max = Math.max(1, ...lexical);
    const dated = extractQueryDateIntent(plan.query).type !== 'neutral';
    const ranked = sources.map((s, i) => {
        const trust = classifyDomainTrustTier(s.domain, s.url);
        const published = parseDocumentDate(s);
        const freshness = dated && published ? Math.exp(-Math.max(0, Date.now() - published) / (30 * 86400000)) : 0;
        const primary = s.qualitySignals?.includes('direct_primary_source') ? 0.9 : 0;
        return { ...s, retrievalScore: (lexical[i] || 0) / max + s.relevance + (s.pageFetched ? 0.4 : 0) + primary + trust.delta / 200 + freshness * 0.15 };
    }).sort((a, b) => b.retrievalScore - a.retrievalScore);
    const selected = [];
    const domains = new Map();
    const add = source => {
        if (!source || selected.some(s => s.url === source.url) || selected.length >= limit) return;
        selected.push(source); domains.set(source.publisherDomain, (domains.get(source.publisherDomain) || 0) + 1);
    };
    // Preserve coverage of separate subjects/facets before filling the remaining positions.
    for (const facet of plan.facets || []) add(ranked.find(s => assessSourceRelevance(facet, s).relevant));
    for (const source of ranked) if ((domains.get(source.publisherDomain) || 0) < 2) add(source);
    for (const source of ranked) add(source);
    return selected.map((s, i) => ({ ...s, id: i + 1 }));
}

export function evaluateResearchCoverage(plan, sources) {
    const useful = sources.filter(s => evidenceText(s).length >= 100 && evidenceText(s) !== s.title);
    const facets = plan.facets?.length ? plan.facets : [plan.query];
    const gaps = facets.filter(facet => !useful.some(s => assessSourceRelevance(facet, { ...s, title: '', snippet: evidenceText(s), description: '' }).relevant));
    const count = String(plan.query).match(/\b(\d{1,2}|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons?|individuals?|countries|names|items|reasons|ways)\b/i);
    if (count) {
        // A requested count is a hypothesis to verify, never an instruction to invent N items.
        const n = Number(count[1]) || ({ two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 })[count[1].toLowerCase()];
        const text = useful.map(evidenceText).join('\n');
        const names = new Set((text.match(/\b[A-Z][a-z]{2,}(?:\s+(?:[A-Z][a-z]{2,}|[IVX]{1,5})){1,3}\b/g) || []).map(s => s.toLowerCase()));
        if (names.size < n) gaps.push(`Identify and verify the requested ${n} entities; check whether the claimed count is correct`);
    }
    if (!useful.length && !gaps.length) gaps.push(plan.query);
    return { sufficient: gaps.length === 0 && useful.length > 0, gaps: [...new Set(gaps)], usefulCount: useful.length };
}

export function selectResearchExcerpt(text, query, limit = 1600) {
    const raw = String(text || '');
    if (raw.length <= limit) return raw;
    const paragraphs = raw.split(/\n\s*\n/).flatMap(p => p.match(/[\s\S]{1,800}(?:\s|$)/g) || [p]);
    const scores = computeBM25Scores(query, paragraphs);
    const order = paragraphs.map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
    const selected = new Set();
    let length = 0;
    for (const i of order) {
        if (length >= limit) break;
        for (const index of [i, i + 1]) {
            if (paragraphs[index] && !selected.has(index) && length < limit) { selected.add(index); length += paragraphs[index].length; }
        }
    }
    return [...selected].sort((a, b) => a - b).map(i => paragraphs[i]).join('\n\n').slice(0, limit);
}

export function formatResearchEvidence(sources, query = '') {
    // Bound prompt size independently of crawl depth so free text-model quotas remain usable.
    const perSource = Math.min(2400, Math.floor(12000 / Math.max(1, sources.length)));
    return sources.map((s, i) => `[${s.id || i + 1}] ${s.title}\nURL: ${s.url}\nEvidence: ${s.evidenceKind}; extraction: ${s.extractionStatus}${s.date ? `; published: ${s.date}` : ''}\n${selectResearchExcerpt(evidenceText(s), query || s.query || s.title, perSource)}`).join('\n\n');
}
