import { extractRegistrableDomain } from '../../app/search/corroboration.mjs';
import { computeBM25Scores } from './bm25.js';
import { classifyDomainTrustTier } from './domain-trust-registry.js';
import { parseDocumentDate, extractQueryDateIntent } from './hybrid-reranker.js';

const STOP = new Set(('a an the and or to of in on at for from by with without as is are was were be been being do does did can could would should will may how what which who where when why tell me please explain compare comparison between versus vs give list name names people persons three two four five six seven eight nine ten official documentation docs information details overview latest current today yesterday recent news updates year').split(' '));

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const SPACE = /\s+/g;
const cleanText = value => String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(SPACE, ' ').trim();
export const cleanAnswerText = value => {
    if (!value || typeof value !== 'string') return '';
    return value
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/^\s*[-*•+–—]\s+(#{1,6}\s+)/gm, '$1') // unbulletize accidentally bulleted headings
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
};
const normalizedText = value => cleanText(value).normalize('NFKC').toLowerCase();
const countValue = value => Number(value) || NUMBER_WORDS[String(value).toLowerCase()] || 0;

// Expand known aliases before lexical matching; punctuation still identifies software.
export function normalizeResearchAliases(value = '') {
    return String(value).replace(/\bUnited States(?: of America)?\b/gi, 'United States')
        .replace(/\bU\.?S\.?(?:A\.?)?(?=\W|$)/g, 'United States').replace(/\bu\.s\.?(?:a\.)?(?=\W|$)/gi, 'United States')
        .replace(/\bUnited Kingdom\b/gi, 'United Kingdom').replace(/\bU\.?K\.?(?=\W|$)/g, 'United Kingdom');
}

const isComparison = value => /\b(?:compare|comparison|versus|vs\.?|difference(?:s)? between)\b/i.test(String(value));
const COMPARISON_ATTRIBUTE = /\b(?:population|land area|area|price|cost|performance|speed|latency|memory management|memory|features|benefits|risks|advantages|disadvantages|release dates?|estimate dates?|dates?|GDP|life expectancy|literacy|climate|tax(?:es)?|fees|security|licen[cs](?:e|ing))\b/gi;

export function comparisonParts(query) {
    if (!isComparison(query)) return { entities: [], attributes: [] };
    const attributes = [...new Set((String(query).match(COMPARISON_ATTRIBUTE) || []).map(s => s.toLowerCase()))];
    let subject = normalizeResearchAliases(query).replace(/^.*?\b(?:between|compare)\s+/i, '').replace(/^.*?\bof\s+(?=.+\b(?:vs\.?|versus)\b)/i, '');
    subject = subject.split(/\s+(?:for|on|in terms of|with respect to|with|including)\s+|,\s*(?:with|including)\s+/i)[0];
    const prefix = subject.match(/^(.*?)\bof\s+/i);
    if (prefix && !/\b(?:and|versus|vs\.?)\b/i.test(prefix[1]) && (prefix[1].match(COMPARISON_ATTRIBUTE) || []).length) {
        subject = subject.slice(prefix[0].length);
    }
    const parts = subject.split(/\s+(?:versus|vs\.?)\s+|\s+and\s+/i).slice(0, 2);
    const entities = parts.map(p => cleanText(p.replace(COMPARISON_ATTRIBUTE, '').replace(/^(?:the\s+)?(?:difference(?:s)?|comparison)\s+(?:of|between)\s*/i, '').replace(/^(?:(?:the|of)\s+)+/i, '').replace(/^[\s,:]+|[\s,?.:]+$/g, ''))).filter(Boolean);
    return { entities: entities.length === 2 ? entities : [], attributes };
}

const TWO_LETTER_STOP = new Set('of in to on at by as is or an we he it so no my up me if am be do re vs'.split(' '));

export function researchTerms(text = '') {
    return [...new Set((normalizeResearchAliases(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])
        .filter(t => (t.length > 2 || (t.length === 2 && !TWO_LETTER_STOP.has(t))) && !STOP.has(t)))];
}

export function protectedEntities(query = '') {
    // Punctuation carries identity: Next.js is not Next, C++ is not C.
    return [...new Set((normalizeResearchAliases(query).match(/\b[\p{L}\p{N}]+(?:\.[\p{L}]+)+\b|\b[\p{L}][\p{L}\p{N}]*(?:\+\+|#)|(?<!\w)\.[A-Za-z]{2,}\b/gu) || []).map(s => s.toLowerCase()))];
}

export function matchesProtectedEntities(query, text, domain = '') {
    const hay = String(text).toLowerCase();
    const host = String(domain).toLowerCase();
    const entities = protectedEntities(query);
    const matches = entity => {
        if (entity.includes('+') || entity.includes('#')) return hay.includes(entity);
        const compact = entity.replace(/[^\p{L}\p{N}]/gu, '');
        const escaped = entity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(hay)
            || host.split('.').some(label => label === compact);
    };
    // A comparison is assembled across documents; a document may cover one subject.
    if (!entities.length || entities.every(matches)) return true;
    if (!isComparison(query)) return false;
    return entities.some(matches) || comparisonParts(query).entities.some(entity => {
        if (protectedEntities(entity).length) return false;
        return normalizedText(normalizeResearchAliases(text)).includes(normalizedText(entity));
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
    const words = new Set(normalizeResearchAliases(text).toLowerCase().match(/[\p{L}\p{N}]+/gu) || []);
    const hits = terms.filter(t => words.has(t));
    const threshold = Math.min(isComparison(query) ? 2 : 3, Math.max(1, Math.ceil(terms.length * (isComparison(query) ? 0.2 : 0.35))));
    return { relevant: terms.length === 0 || hits.length >= threshold, score: hits.length / Math.max(1, terms.length) };
}

export function normalizeEvidence(source, query) {
    const url = canonicalResearchUrl(source?.url);
    if (!url || !source.title || !assessSourceRelevance(query, source).relevant) return null;
    const domain = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (classifyDomainTrustTier(domain, url).tier === 4) return null;
    const desc = String(source.description || '').trim();
    const snip = String(source.snippet || '').trim();
    const snippet = snip && snip.length > desc.length && snip !== source.title ? snip : (desc || snip);
    const article = String(source.fullArticleText || source.extract || '').trim();
    const pageRead = source.pageFetched === true || source.deepCrawled === true || source.isScraped === true;
    const body = pageRead ? article : '';
    return {
        ...source, url, domain, publisherDomain: source.publisherDomain || extractRegistrableDomain(domain),
        snippet, description: snippet, fullArticleText: body, extract: body,
        evidenceKind: body ? 'article' : source.evidenceLevel === 'structured_claim' ? 'structured' : 'snippet',
        extractionStatus: source.extractionStatus || (body ? 'extracted' : source.accessible === false ? 'blocked' : 'not_fetched'),
        pageFetched: Boolean(body), fetchedAt: source.fetchedAt || null,
        relevance: assessSourceRelevance(query, source).score
    };
}

export function evidenceText(source) {
    let base = String(source.fullArticleText || source.text || source.snippet || source.description || '').trim();
    if (source.infobox && typeof source.infobox === 'object') {
        const infoboxEntries = Object.entries(source.infobox)
            .filter(([k, v]) => v && typeof v === 'string')
            .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
            .join('; ');
        if (infoboxEntries && !base.includes(infoboxEntries)) {
            base = base ? `${base}\nInfobox Details: ${infoboxEntries}` : `Infobox Details: ${infoboxEntries}`;
        }
    }
    return base;
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
        const isRef = s.infobox || s.sourceType === 'encyclopedia' || /wikipedia\.org|britannica\.com|\.gov(?:\.|$)/i.test(s.url) ? 0.35 : 0;
        return { ...s, retrievalScore: (lexical[i] || 0) / max + s.relevance + (s.pageFetched ? 0.4 : 0) + primary + isRef + trust.delta / 200 + freshness * 0.15 };
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

/** Requirements describe the user's requested facts, independently of retrieved headlines. */
export function buildResearchRequirements(query, _context = []) {
    const q = cleanText(query).slice(0, 1000);
    const count = q.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(people|persons?|individuals?|countries|nations|animals?|species|names|items|reasons|ways|steps|things)\b/i);
    const isExplanationIntent = /\b(?:how|why|explain|describe)\b|\b(?:history|evolution|timeline|overview|summary|mechanism|process|guide|tutorial|causes?|reasons?)\b/i.test(q)
        || (/^what\s+(?:is|are)\s+(?:an?\s+)?(?:[a-z\s]+)$/i.test(q) && !/\b(?:price|cost|population|rate|score|temperature|height|weight|depth|distance|revenue|market\s*cap|valuation|number|amount|percentage|figure|date|year)\b/i.test(q));
    const isRole = !isExplanationIntent && /\b(?:c[efot]o|chief\s+(?:executive|financial|operating|technology|information)\s+officer|managing\s+director|chair(?:person|man|woman)?|(?:prime|chief)\s+minister|[cp]m|president|vice\s+president|vp|governor|mayor|chancellor|premier|minister|director|head\s+of\s+(?:state|government)|leader|civic\s+leader|captain|coach|commander|founder|co-founder|secretary[\s-]+general|monarch|king|queen|emperor|empress|pope|author|writer|novelist|actor|actress|inventor|creator|discoverer|discoverers|winner|champion)\b/i.test(q);
    const isEntityLookup = !isExplanationIntent && /\b(?:capital|headquarters|hq|birthplace|currency|symbol|mascot|national\s+(?:animal|bird|flower|anthem|tree|fruit|sport|flag)|official\s+language)\b/i.test(q);
    const entityKind = count?.[2]?.toLowerCase() || (/\b(?:who|people|persons?|individuals?)\b/i.test(q) || isRole ? 'person' : /\bcountries|nations\b/i.test(q) ? 'country' : isEntityLookup ? (/\bcapital|headquarters|hq|birthplace\b/i.test(q) ? 'place' : /\bcurrency\b/i.test(q) ? 'currency' : 'entity') : 'entity');
    const expectedCount = count ? countValue(count[1]) : undefined;
    const comparison = comparisonParts(q);
    const requirements = [];
    const add = (type, description, extra = {}) => requirements.push({ id: `r${requirements.length + 1}`, type, description, query: q, ...extra });
    if (comparison.entities.length === 2) {
        for (const entity of comparison.entities) {
            for (const attribute of comparison.attributes.length ? comparison.attributes : ['relevant characteristics']) {
                add(/\bdate/.test(attribute) ? 'date' : 'comparison', `${attribute} of ${entity}`, { entities: [entity], attribute, searchQuery: `${entity} ${/\bdate/.test(attribute) ? `${comparison.attributes.filter(a => !/\bdate/.test(a)).join(' ')} estimate ` : ''}${attribute}` });
            }
        }
    } else {
        const names = /\b(?:who|name(?:s)?|which (?:people|persons?|individuals?|countries|nations|animals?|teams?|cities|companies|brands?))\b/i.test(q)
            || isRole
            || isEntityLookup
            || (count && !/^(?:reasons|ways|steps)$/i.test(count[2]));
        const date = /\bwhen\b|\b(?:what|which)\s+(?:is\s+the\s+)?(?:date|year)|\b(?:release|birth|publication|election|founding|launch|start|end)?\s*dates?\b/i.test(q);
        const value = !isExplanationIntent && (/\bhow (?:many|much|old|long|far|fast|large|big|tall|deep|wide)\b/i.test(q)
            || /\b(?:what(?:'s| is)?|current|latest)?\s*(?:the\s+)?(?:price|cost|population|rate|score|temperature|gdp|net\s*worth|height|weight|depth|distance|revenue|market\s*cap|valuation|inflation)\b/i.test(q)
            || /\b(?:what(?:'s| is)?|current|latest)\s+(?:the\s+)?value\b/i.test(q));
        if (names) {
            const description = isRole
                ? `Identify the specific ${/person|people|individual/.test(entityKind) ? 'individuals' : entityKind} satisfying the stated role or condition; verify the official office holder`
                : isEntityLookup
                    ? `Identify the specific ${entityKind} requested for ${q}`
                    : `Identify the specific ${/person|people|individual/.test(entityKind) ? 'individuals' : entityKind} satisfying the stated condition; verify the alleged count`;
            add('names', description, { entityKind, expectedCount, countIsClaim: Boolean(count), exclusiveCount: Boolean(count && /\b(?:only|exactly|just)\s+(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i.test(q)) });
        }
        if (date) add('date', `Establish the requested date or year for ${q}`, { expectedCount: names && /\bdates\b/i.test(q) ? expectedCount : undefined });
        if (value) add('value', `Establish the requested numerical value for ${q}`);
        if (!requirements.length) {
            const isBiographicalOrCreative = (Array.isArray(_context) && _context.some(c => c?.entityKind === 'person' || c?.type === 'person'))
                || /\b(?:biography|bio|life\s+of|career\s+of|born|composer|musician|music\s+director|singer|lyricist|songwriter|director|filmmaker|producer|artist|painter|sculptor|actor|actress|author|writer|poet|novelist|scientist|physicist|chemist|biologist|mathematician|astronomer|inventor|architect|philosopher|historian|economist|scholar|athlete|player|coach)\b/i.test(q)
                || /^(?:dr|prof|mr|mrs|ms|sir|lord)\.?\s+[A-Za-z]/i.test(q);
            if (isBiographicalOrCreative) {
                add('explanation', `Core identity, background, and significance of ${q}`);
                add('explanation', `Notable works, career milestones, contributions, and achievements of ${q}`);
                add('explanation', `Awards, recognition, life status, and recent developments for ${q}`);
            } else {
                add('explanation', `Explain or verify: ${q}`, { expectedCount: /^(?:reasons|ways|steps)$/i.test(count?.[2] || '') ? expectedCount : undefined });
            }
        }
    }
    if (/\btravel\b/i.test(q) && /\b(?:worldwide|world|every country|all countries|anywhere)\b/i.test(q)) {
        add('qualification', 'Verify whether the evidence establishes unrestricted worldwide travel, including the limits of the stated passport exemption', { searchQuery: q.replace(/^.*?\b(?:travel|passport)\b/i, 'passport exemption international entry restrictions ') });
    }
    return requirements;
}

function sourceQuote(source, quote) {
    if (typeof quote !== 'string') return '';
    const value = cleanText(quote);
    if (value.length < 18 || value.length > 4000) return '';
    const text = cleanText(evidenceText(source));
    if (!text) return '';
    const normValue = normalizedText(value);
    const normText = normalizedText(text);
    const normTitle = normalizedText(source.title || '');
    if (normValue === normTitle) return '';
    // Headlines and title echoes are discovery clues, not evidence of an answer.
    if (text.length <= cleanText(source.title).length + 12 && normText.includes(normTitle)) return '';
    if (normText.includes(normValue)) return value;
    const stripPunct = s => s.replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
    const cleanPunctValue = stripPunct(normValue);
    const cleanPunctText = stripPunct(normText);
    if (cleanPunctValue && cleanPunctText.includes(cleanPunctValue)) {
        if (cleanPunctValue === stripPunct(normTitle)) return '';
        return value;
    }
    const words = cleanPunctValue.split(' ').filter(w => w.length > 2);
    if (words.length >= 4) {
        const needle = words.slice(0, Math.min(8, words.length)).join(' ');
        if (needle && cleanPunctText.includes(needle)) {
            if (cleanPunctValue === stripPunct(normTitle)) return '';
            return value;
        }
    }
    return '';
}

function valueFitsRequirement(value, quote, requirement, source = {}) {
    const val = cleanText(value);
    if (!val || val.length > 1800 || !normalizedText(quote).includes(normalizedText(val))) return false;
    if (normalizedText(val) === normalizedText(requirement.query) || /^[\s\W]*$/.test(val)) return false;
    if (!assessSourceRelevance(requirement.type === 'qualification' ? requirement.description : requirement.query, { title: source.title, snippet: quote, url: source.url, domain: source.domain }).relevant) return false;
    if (requirement.entities?.some(entity => !normalizedText(normalizeResearchAliases(quote)).includes(normalizedText(normalizeResearchAliases(entity))))) return false;
    if (requirement.type === 'names') {
        // Entity values are explicitly extracted spans, never counts of capitalized phrases.
        if (val.length > 120 || val.split(SPACE).length > 16 || /[?!:;]/.test(val)) return false;
        if (/^(?:the\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons?|individuals?|countries|names)\b/i.test(val)) return false;
        if (/person|people|individual/.test(requirement.entityKind || '') && /\b(?:passport|travel|control|kingdom|family|requirements?|exemptions?|countries|government|people|persons?|individuals?)\b/i.test(val)) return false;
        if (/^(?:the\s+)?(?:monarch|emperor|empress|king|queen|president|vice\s+president|vp|pope|prince|leader|chief\s+minister|prime\s+minister|[cp]m|c[efot]o|governor|mayor|chancellor|premier|minister|director|head\s+of\s+state|founder|author|actor|actress|inventor|coach|captain)$/i.test(val)) return false;
        const terms = researchTerms(requirement.query).filter(t => !/^\d+$/.test(t) && !/^(?:world|countries|country|individuals|persons|person|only|claim|claimed)$/.test(t));
        const words = new Set(researchTerms(`${source.title || ''} ${quote}`));
        if (terms.length && !terms.some(t => words.has(t))) return false;
    } else if (requirement.type === 'date') {
        if (!/\b(?:\d{1,4}|January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/i.test(val)) return false;
    } else if (requirement.type === 'value') {
        if (!/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|trillion)\b/i.test(val)) return false;
    } else if (requirement.type === 'qualification') {
        if (!/\b(?:entry|enter|visa|permission|restrictions?|countries|every|all)\b/i.test(val)) return false;
        if (!/\b(?:not|only|require|requires|required|subject|arrangements?|permission|restricted|restrictions?|exempt|exemption|every|all|any)\b/i.test(val)) return false;
    } else if (requirement.type === 'comparison' && /\b(?:population|area|price|cost|speed|latency|GDP|life expectancy|literacy|tax|fees)\b/i.test(requirement.attribute || '')) {
        if (!/\d|\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|trillion)\b/i.test(val)) return false;
    } else {
        if (val.length < 24 || !/[\p{L}]/u.test(val)) return false;
        const terms = researchTerms(requirement.entities?.join(' ') || requirement.query);
        const words = new Set(researchTerms(`${source.title || ''} ${quote} ${val}`));
        if (terms.length && !terms.some(term => words.has(term))) return false;
        if (/^(?:what|who|which|how|why|when|where)\b/i.test(val)) return false;
        if (requirement.type === 'explanation' && /^(?:what (?:is|are)|explain|how .+ works?\b)/i.test(requirement.query) && protectedEntities(requirement.query).length && !/\b(?:is|are|means|refers?|allows?|enables?|renders?|runs?|executes?|functions?|uses?|supports?|processes?|represents?|makes?|can|designed|built)\b/i.test(val)) return false;
    }
    return true;
}

function countContradiction(premise, requirements, sources) {
    if (premise?.status !== 'contradicted') return null;
    const source = sources.find(s => s.id != null && premise.sourceId != null && String(s.id) === String(premise.sourceId));
    const quote = source && sourceQuote(source, premise.quote);
    if (!quote) return null;
    const counted = requirements.find(r => r.countIsClaim && r.expectedCount);
    if (!counted || !assessSourceRelevance(counted.query, { title: quote }).relevant) return null;
    const counts = [...quote.matchAll(/\b(\d{1,2}|zero|no|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:(?:specific|living|extant|known|recogni[sz]ed|remaining|different|distinct|such|named|surviving|confirmed|eligible|current|present|total)\s+){0,3}(?:people|persons?|individuals?|countries|nations|animals?|species|items|names)\b/gi)].map(m => countValue(m[1]));
    const negates = new RegExp(`\\b(?:not|incorrect|false|myth|no evidence)\\b`, 'i').test(quote) && (quote.includes(String(counted.expectedCount)) || Object.entries(NUMBER_WORDS).some(([word, n]) => n === counted.expectedCount && new RegExp(`\\b${word}\\b`, 'i').test(quote)));
    if (!counts.some(n => n !== counted.expectedCount) && !negates) return null;
    return { requirementId: counted.id, sourceId: source.id, sourceUrl: source.url, quote, value: quote, id: 'premise-correction', premiseCorrection: true, correctedCount: counts.find(n => n !== counted.expectedCount) };
}

function missingQuery(requirement, proposed) {
    const q = cleanText(proposed).slice(0, 400);
    if (q && normalizedText(q) !== normalizedText(requirement.query) && matchesProtectedEntities(requirement.query, q) && researchTerms(requirement.query).some(term => researchTerms(q).includes(term))) return q;
    if (requirement.searchQuery) return cleanText(requirement.searchQuery).slice(0, 400);
    const topic = requirement.query.replace(/^[\s\d]*(?:one|two|three|four|five|six|seven|eight|nine|ten)?\s*(?:people|persons?|individuals?|countries|nations|animals?)?\s*/i, '').replace(/[?.!]$/g, '');
    return `${topic} ${requirement.type === 'names' ? `specific ${requirement.entityKind} names identified` : requirement.type === 'date' ? 'exact event date' : requirement.type === 'value' ? 'measured value official data' : 'explanation evidence'}`.slice(0, 400);
}

function hasExclusiveCountSupport(requirement, facts) {
    if (!requirement.exclusiveCount) return true;
    const count = requirement.expectedCount;
    const words = [String(count), ...Object.entries(NUMBER_WORDS).filter(([, n]) => n === count).map(([word]) => word)].join('|');
    const explicit = new RegExp(`\\b(?:only|exactly|just|total(?: of)?)\\s+(?:${words})\\b`, 'i');
    return facts.some(f => explicit.test(f.quote));
}

/**
 * Strips fact tags, lenticular brackets, and trailing citation numbers / bracket markers from bullet points.
 * Ensures that lines ending with e.g. "【f1】 .", "[1] .", "(1).", "1." have those citation markers removed
 * and trailing punctuation cleanly preserved.
 */
export function cleanBulletEndCitations(text, isItem = false) {
    if (!text || typeof text !== 'string') return '';
    return text.split('\n').map(line => {
        // Strip accidentally prefixed bullet markers from headings: "- ## Heading" -> "## Heading"
        line = line.replace(/^[\s\-*•+–—]+\s*(#{1,6}\s+)/, '$1');

        let cleaned = line
            .replace(/\s*【[^】]*】\s*([.,;!?]?)/g, '$1')
            .replace(/\s*\[f\d+(?:\s*,\s*f?\d+)*\]\s*([.,;!?]?)/g, '$1');

        const bulletMatch = cleaned.match(/^(\s*(?:[-*•+]|\d+\.)\s+)(.*)$/);
        if (bulletMatch) {
            const prefix = bulletMatch[1];
            let body = bulletMatch[2];
            body = body.replace(/^[\s\-*•+–—]+(?:\s+|$)/, '');
            body = body.replace(/(?:[\s\u00A0]*(?:【[^】]*】|\[f?\d+(?:\s*,\s*f?\d+)*\]|\([1-9]\d{0,1}\)))+[\s\u00A0]*([.,;!?]?)$/g, '$1');
            body = body.replace(/([.,;!?])\s*(?:【[^】]*】|\[f?\d+(?:\s*,\s*f?\d+)*\]|\([1-9]\d{0,1}\))\s*$/g, '$1');
            body = body.replace(/[\s\u00A0]+([.,;!?])/g, '$1').trimEnd();
            return isItem ? body : `${prefix}${body}`;
        }

        if (isItem) {
            cleaned = cleaned.replace(/^[\s\-*•+–—]+(?:\s+|$)/, '');
            cleaned = cleaned.replace(/(?:[\s\u00A0]*(?:【[^】]*】|\[f?\d+(?:\s*,\s*f?\d+)*\]|\([1-9]\d{0,1}\)))+[\s\u00A0]*([.,;!?]?)$/g, '$1');
            cleaned = cleaned.replace(/([.,;!?])\s*(?:【[^】]*】|\[f?\d+(?:\s*,\s*f?\d+)*\]|\([1-9]\d{0,1}\))\s*$/g, '$1');
            cleaned = cleaned.replace(/[\s\u00A0]+([.,;!?])/g, '$1').trimEnd();
        }

        return cleaned;
    }).join('\n');
}

/** Validate exact passages before exposing any model-produced answer as a factual result. */
export function validateResearchAnswer(data, requirements, sources) {
    const requested = Array.isArray(requirements) && requirements.length ? requirements : buildResearchRequirements('requested facts');
    const available = Array.isArray(sources) ? sources : [];
    const facts = [];
    const rejectedFacts = [];
    for (const [index, input] of (Array.isArray(data?.facts) ? data.facts : []).slice(0, 40).entries()) {
        const requirement = requested.find(r => r.id === input?.requirementId);
        const source = available.find(s => s.id != null && input?.sourceId != null && String(s.id) === String(input.sourceId));
        const quote = source && sourceQuote(source, input.quote);
        const value = cleanText(input?.value);
        if (!requirement || !source || !quote || !valueFitsRequirement(value, quote, requirement, source)) { rejectedFacts.push({ id: input?.id || `f${index + 1}`, reason: !requirement ? 'unknown_requirement' : !source ? 'unknown_source' : !quote ? 'unsupported_quote' : 'unsupported_value' }); continue; }
        if (facts.some(f => f.requirementId === requirement.id && (normalizedText(f.value) === normalizedText(value) || (requirement.type === 'names' && (normalizedText(f.value).includes(normalizedText(value)) || normalizedText(value).includes(normalizedText(f.value))))))) continue;
        facts.push({ id: cleanText(input.id) || `f${index + 1}`, requirementId: requirement.id, value, sourceId: source.id, sourceUrl: source.url, quote });
    }
    const correction = countContradiction(data?.premise, requested, available);
    if (correction) facts.push(correction);
    const rawAnswer = typeof data?.answer === 'string' ? cleanAnswerText(data.answer) : '';
    const missing = requested.filter(requirement => {
        if ((Array.isArray(data?.gaps) ? data.gaps : []).some(g => g?.requirementId === requirement.id && cleanText(g.detail))) return true;
        const matches = facts.filter(f => f.requirementId === requirement.id);
        const corrected = matches.find(f => f.premiseCorrection);
        if (corrected) return corrected.correctedCount === undefined || matches.filter(f => !f.premiseCorrection).length < corrected.correctedCount;
        if (requirement.type === 'explanation' && rawAnswer && rawAnswer.length >= 30) {
            return false;
        }
        return matches.length < Math.max(1, requirement.expectedCount || 1) || !hasExclusiveCountSupport(requirement, matches);
    });
    // Gaps come from unsatisfied requirements, not an untrusted model success flag.
    const gaps = missing.map(requirement => {
        const proposed = (Array.isArray(data?.gaps) ? data.gaps : []).find(g => g?.requirementId === requirement.id);
        const countOnly = requirement.exclusiveCount && facts.filter(f => f.requirementId === requirement.id).length >= requirement.expectedCount && !hasExclusiveCountSupport(requirement, facts.filter(f => f.requirementId === requirement.id));
        return { requirementId: requirement.id, detail: cleanText(proposed?.detail) || (countOnly ? `Verify that only ${requirement.expectedCount} entities satisfy the condition; the identified examples do not establish exclusivity` : requirement.description), query: missingQuery(requirement, proposed?.query) };
    });
    // Render validated text. If an explicit conversational answer citing validated sources was provided,
    // use it for fluent Grounded RAG synthesis. Otherwise render the verified spans.
    const lines = [];
    for (const fact of facts) {
        const requirement = requested.find(r => r.id === fact.requirementId);
        const label = requirement?.entities?.length && requirement.attribute ? `${requirement.entities.join(', ')} (${requirement.attribute}): ` : '';
        const lineKey = `${label}${normalizedText(fact.value)}`;
        if (lines.some(line => line.key === lineKey)) continue;
        lines.push({ key: lineKey, value: normalizedText(fact.value), text: `${label}${fact.value} [${fact.sourceId}]` });
    }
    let content = '';
    if (rawAnswer && (facts.length > 0 || available.length > 0 || requested.some(r => r.type === 'explanation'))) {
        const validSourceIds = new Set(available.map(s => s.id));
        let sanitizedAnswer = cleanBulletEndCitations(rawAnswer);
        sanitizedAnswer = sanitizedAnswer.replace(/\[(\d+)\]/g, (match, num) => {
            const id = Number(num);
            return validSourceIds.has(id) ? match : '';
        }).replace(/[ \t]+([.,;!?])/g, '$1').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
        sanitizedAnswer = cleanBulletEndCitations(sanitizedAnswer);
        if (sanitizedAnswer.length >= 30) {
            content = sanitizedAnswer;
            if (!facts.length && available.length > 0) {
                const usedCitations = [...content.matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
                const citeIds = usedCitations.length ? [...new Set(usedCitations)].filter(id => validSourceIds.has(id)) : [available[0].id];
                for (const cid of citeIds.slice(0, 4)) {
                    const s = available.find(item => item.id === cid);
                    if (s) {
                        facts.push({
                            id: `f${facts.length + 1}`,
                            requirementId: requested[0]?.id || 'r1',
                            value: s.title,
                            sourceId: s.id,
                            sourceUrl: s.url,
                            quote: selectResearchExcerpt(evidenceText(s), content, 150) || s.title
                        });
                    }
                }
            }
        }
    }
    if (!content) content = lines.map(line => line.text).join('\n\n');
    const hasUnmetCountClaim = requested.some(r => r.countIsClaim && missing.some(m => m.id === r.id));
    if (gaps.length) {
        const details = gaps.map(g => g.detail).join('; ');
        if (!content) {
            const hasOnlyExplanationReqs = requested.length > 0 && requested.every(r => r.type === 'explanation');
            if (!hasOnlyExplanationReqs) {
                content = `I couldn't verify the requested facts from the retrieved passages. Missing: ${details}.`;
            }
        } else if (hasUnmetCountClaim || (!rawAnswer && !requested.some(r => r.type === 'explanation'))) {
            content = `${content}\n\nStill unverified: ${details}.`;
        }
    }
    const hasGroundedAnswer = Boolean(rawAnswer && rawAnswer.length >= 30 && (facts.length > 0 || available.length > 0));
    const answerStatus = (facts.length > 0 || hasGroundedAnswer)
        ? (gaps.length ? 'partial' : 'complete')
        : 'unavailable';
    return { content, facts, claims: facts, gaps, missingRequirementIds: missing.map(r => r.id), nextQueries: [...new Set(gaps.map(g => g.query))].slice(0, 2), answerStatus, verified: answerStatus === 'complete', rejectedFacts, coverage: { sufficient: answerStatus === 'complete', gaps: gaps.map(g => g.detail), usefulCount: new Set(facts.map(f => f.sourceId)).size, satisfiedRequirementIds: requested.filter(r => !missing.includes(r)).map(r => r.id), missingRequirementIds: missing.map(r => r.id) } };
}

/** Revalidate retained facts when targeted retrieval adds sources or changes citation IDs. */
export function mergeResearchValidation(previous, payload, requirements, sources) {
    const currentSources = Array.isArray(sources) ? sources : [];
    const remap = fact => {
        const url = canonicalResearchUrl(fact.sourceUrl);
        const source = url && currentSources.find(s => canonicalResearchUrl(s.url) === url);
        // Older validations without source URLs cannot safely survive citation renumbering.
        return source ? { ...fact, sourceId: source.id } : null;
    };
    const retained = (Array.isArray(previous?.facts) ? previous.facts : []).map(remap).filter(Boolean);
    const fresh = Array.isArray(payload?.facts) ? payload.facts : [];
    const correction = retained.find(f => f.premiseCorrection);
    const priorPremise = correction ? { status: 'contradicted', sourceId: correction.sourceId, quote: correction.quote } : undefined;
    const incomingPremise = countContradiction(payload?.premise, requirements, currentSources);
    const premise = incomingPremise ? payload.premise : priorPremise || payload?.premise;
    const gaps = [...(Array.isArray(payload?.gaps) ? payload.gaps : [])];
    for (const gap of Array.isArray(previous?.gaps) ? previous.gaps : []) {
        if (fresh.some(f => f?.requirementId === gap.requirementId) || gaps.some(g => g?.requirementId === gap.requirementId)) continue;
        gaps.push(gap);
    }
    if (incomingPremise && correction && incomingPremise.correctedCount !== correction.correctedCount) {
        gaps.push({ requirementId: correction.requirementId, detail: 'Retrieved passages give conflicting counts; the actual count remains unverified', query: `${requirements.find(r => r.id === correction.requirementId)?.query || ''} actual count primary evidence` });
    }
    return validateResearchAnswer({ ...payload, facts: [...retained.filter(f => !f.premiseCorrection), ...fresh], premise, gaps }, requirements, currentSources);
}

export function evaluateResearchCoverage(plan, sources, validatedFacts = []) {
    const requirements = plan.requirements || buildResearchRequirements(plan.query);
    const validation = validateResearchAnswer({ facts: validatedFacts }, requirements, sources);
    // Retrieval readiness remains separate from factual completeness.
    const useful = sources.filter(s => evidenceText(s).length >= 100 && normalizedText(evidenceText(s)) !== normalizedText(s.title));
    return { ...validation.coverage, usefulCount: useful.length, retrievalReady: useful.length > 0 };
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
