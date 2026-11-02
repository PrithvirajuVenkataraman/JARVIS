import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import vm from 'node:vm';
import handler, {
    isDirectPrimarySource,
    isValidCitationSource,
    enrichSearchResultsWithDeepCrawl,
    buildDeterministicSearchQueries,
    searchGeminiGrounding,
    searchResearchSources,
    crawlArticleBody,
    recoverPublisherArticleUrl,
    isTechnicalDocumentationQuery
} from '../api/search.js';
import {
    runResearch,
    deterministicResearchPlan,
    cachedResearchSearch,
    planResearch,
    isResearchableClaim
} from '../api/_lib/research-engine.js';
import {
    normalizeEvidence,
    assessSourceRelevance,
    evaluateResearchCoverage,
    rankResearchEvidence,
    selectResearchExcerpt,
    formatResearchEvidence,
    validateResearchAnswer,
    buildResearchRequirements,
    mergeResearchValidation,
    normalizeResearchAliases,
    matchesProtectedEntities
} from '../api/_lib/research-evidence.js';
import { normalizeResearchSources, BoundedLiveResearchController } from '../app/bounded-live-research.js';
import { streamResearchRequest } from '../app/search/research-stream.mjs';
import { clearExtractorCaches, crawlArticleResilient, extractArticleFromHtml, isParagraphRelevant } from '../api/_lib/article-extractor.js';
import { normalizeCrawl4AiResult } from '../api/_lib/crawl4ai-client.js';
import { isPublicWebUrl } from '../api/_lib/public-web-url.js';
import { callResearchModel, researchModelProviders, clearResearchModelHealth } from '../api/_lib/research-model.js';
import {
    buildPublisherRecoveryQuery,
    isMatchingPublisherArticle,
    preserveDiscoveryMetadata,
    buildComparisonSearchQueries,
    matchesComparisonAttribute
} from '../api/_lib/research-retrieval.js';

describe('Evidence Research Core', () => {

const query = 'orbital telescope calibration';
const paragraph = 'The orbital telescope calibration uses a reference star to measure detector response. Researchers repeat the telescope calibration before each orbital observation to reduce measurement uncertainty.';
const articleHtml = `<html><title>Orbital telescope calibration</title><article><p>${paragraph}</p><p>The orbital telescope calibration also checks the optics against a second independent instrument. The calibration measurements and telescope settings are published with each observation.</p></article></html>`;
const source = (extra = {}) => ({ title: 'Orbital telescope calibration', url: 'https://science.example.com/calibration', snippet: 'Orbital telescope calibration research', sourceType: 'live_web', ...extra });
const plan = () => ({ query, originalQuery: query, queries: [query], facets: [query], ambiguous: false });
const structuredFact = (requirement, record, value, quote = record.fullArticleText || record.snippet) => ({ id: 'f1', requirementId: requirement.id, value, sourceId: record.id, quote });
const deps = (extra = {}) => ({
    plan: async () => plan(),
    search: async () => [source()],
    extract: async url => ({ bodyText: paragraph, url }),
    synthesize: async ({ sources, requirements }) => {
        const record = sources.find(item => item.fullArticleText?.includes('reference star'));
        const fact = structuredFact(requirements[0], record, record.fullArticleText.split('. ')[0] + '.');
        return { facts: [fact], answerSegments: [{ text: fact.value, factIds: [fact.id] }], gaps: [] };
    },
    ...extra
});

test('relevance rejects the production Next.js/Next clothing collision', () => {
    const bad = source({ title: 'Next Official Site: Online Fashion, Kids Clothes & Homeware', url: 'https://www.next.co.uk/', domain: 'next.co.uk', description: 'Download the Next App to shop for clothing and homeware.' });
    const q = 'Next.js App Router server components documentation';
    assert.equal(isDirectPrimarySource(q, bad.domain, bad.title), false);
    assert.equal(isValidCitationSource(bad, q), false);
    assert.equal(assessSourceRelevance(q, bad).relevant, false);
    assert.equal(normalizeEvidence(bad, q), null);
    assert.equal(assessSourceRelevance(q, { title: 'Next.js App Router server components', url: 'https://nextjs.org/docs/app' }).relevant, true);
});

test('punctuation keeps C++, .NET and Node.js identities intact', () => {
    for (const [q, wrong, right] of [['C++ memory management', 'C memory management', 'C++ memory management'], ['.NET deployment', 'net deployment', '.NET deployment'], ['Node.js streams', 'Node streams', 'Node.js streams']]) {
        assert.equal(assessSourceRelevance(q, { title: wrong }).relevant, false);
        assert.equal(assessSourceRelevance(q, { title: right }).relevant, true);
    }
});

test('search snippets never become fetched article text in server or UI records', () => {
    const input = source({ snippet: paragraph });
    const evidence = normalizeEvidence(input, query);
    assert.equal(evidence.evidenceKind, 'snippet');
    assert.equal(evidence.fullArticleText, '');
    assert.equal(evidence.pageFetched, false);
    assert.equal(normalizeResearchSources([input], query)[0].fullArticleText, '');
});

test('article text cannot propagate to another article on the same publisher', async () => {
    clearExtractorCaches();
    const original = globalThis.fetch;
    globalThis.fetch = async url => String(url).endsWith('/a') ? new Response(articleHtml, { status: 200 }) : new Response('Forbidden', { status: 403 });
    try {
        const records = [source({ url: 'https://publisher.test/a', domain: 'publisher.test', query }), source({ url: 'https://publisher.test/b', domain: 'publisher.test', query })];
        await enrichSearchResultsWithDeepCrawl(records, 2);
        assert.ok(records[0].fullArticleText?.length > 100);
        assert.equal(records[1].fullArticleText, undefined);
        assert.equal(records[1].deepCrawled, undefined);
        assert.equal(records[1].accessible, false);
    } finally { globalThis.fetch = original; clearExtractorCaches(); }
});

test('ordinary technical documentation is not rewritten into latest release notes', () => {
    const queries = buildDeterministicSearchQueries('Next.js App Router server components documentation');
    assert.ok(queries.some(q => q.includes('Next.js')));
    assert.ok(queries.every(q => !q.includes('latest') && !q.includes('release notes')));
});

test('a precise missing fact causes targeted retrieval before final synthesis', async () => {
    const searched = [];
    let generations = 0;
    const missingQuery = 'orbital telescope calibration detector reference measurements';
    const reference = 'The orbital telescope calibration uses detector reference measurements from a violet target before each orbital observation.';
    const result = await runResearch(query, { timeoutMs: 45000 }, deps({
        search: async q => { searched.push(q); return [source({ url: `https://science.example.com/calibration-${searched.length}` })]; },
        extract: async url => ({ bodyText: searched.length === 1 ? paragraph : reference, url }),
        synthesize: async ({ requirements, sources }) => {
            generations++;
            if (generations === 1) return { facts: [], gaps: [{ requirementId: requirements[0].id, detail: 'detector reference measurements', query: missingQuery }] };
            assert.ok(searched.includes(missingQuery), 'The named evidence gap must trigger retrieval before final synthesis');
            const record = sources.find(item => item.fullArticleText === reference);
            return { facts: [structuredFact(requirements[0], record, reference)], gaps: [] };
        }
    }));
    assert.ok(searched.indexOf(missingQuery) > 0);
    assert.ok(result.research.rounds >= 2 && result.research.rounds <= 3);
    assert.equal(generations, 2);
    assert.equal(result.provenance, 'web_grounded');
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.verified, true);
    assert.match(result.content, /violet target/);
});

test('research reads discovered same-origin references to fill an evidence gap', async () => {
    const read = [];
    const reference = 'The orbital telescope calibration instrument reference confirms the detector settings using an independently measured violet reference target.';
    const result = await runResearch(query, { timeoutMs: 45000 }, deps({
        extract: async url => { read.push(url); return { bodyText: url.endsWith('/reference') ? reference : paragraph, url, links: [{ title: 'Orbital telescope calibration instrument reference', url: 'https://science.example.com/reference' }] }; },
        synthesize: async ({ sources, requirements }) => {
            const record = sources.find(item => item.url.endsWith('/reference') && item.pageFetched);
            return record ? { facts: [structuredFact(requirements[0], record, reference)], gaps: [] }
                : { facts: [], gaps: [{ requirementId: requirements[0].id, detail: 'instrument reference', query: 'orbital telescope calibration instrument reference' }] };
        }
    }));
    assert.ok(read.includes('https://science.example.com/reference'));
    assert.equal(result.research.coverage.sufficient, true);
    assert.equal(result.sources.find(item => item.id === result.facts[0].sourceId).url, 'https://science.example.com/reference');
    assert.equal(result.facts[0].quote, reference);
});

test('an unresolved subject yields a clarification without claiming a web answer', async () => {
    const result = await runResearch('Who won yesterday?', { timeoutMs: 4000 }, deps({ plan: async q => deterministicResearchPlan(q), search: async () => assert.fail('Clarification must precede retrieval') }));
    assert.equal(result.provenance, 'clarification');
    assert.equal(result.clarification, true);
    assert.equal(result.sources.length, 0);
});

test('context is used to resolve a follow-up without rewriting a new standalone subject', () => {
    const context = [{ role: 'user', content: 'Orbital telescope calibration' }];
    assert.match(deterministicResearchPlan('And its detector?', context).query, /Orbital telescope calibration/);
    assert.equal(deterministicResearchPlan('Ocean salinity', context).query, 'Ocean salinity');
});

test('headline-only evidence fails coverage even when many domains are returned', async () => {
    const records = Array.from({ length: 8 }, (_, i) => normalizeEvidence(source({ url: `https://publisher${i}.example.com/article`, snippet: 'Orbital telescope calibration' }), query));
    assert.equal(evaluateResearchCoverage(plan(), records).sufficient, false);
    const result = await runResearch(query, { timeoutMs: 4000 }, deps({ search: async () => records, extract: async () => null, synthesize: async () => assert.fail('Headlines cannot support a normal synthesis') }));
    assert.notEqual(result.provenance, 'web_grounded');
    assert.ok(result.research.rounds <= 3);
    assert.ok(result.research.searchedQueries.length <= 6);
});

test('facet ranking retains evidence for separate subjects', () => {
    const facets = ['orbital telescope calibration', 'ocean salinity measurement'];
    const inputs = [...Array.from({ length: 8 }, (_, i) => normalizeEvidence(source({ url: `https://space.example.com/${i}`, snippet: paragraph }), query)), normalizeEvidence(source({ title: 'Ocean salinity measurement', url: 'https://ocean.example.com/data', snippet: 'Ocean salinity measurement uses independent instruments and repeated observations.' }), 'ocean salinity measurement')];
    const ranked = rankResearchEvidence({ query: 'orbital telescope calibration ocean salinity measurement', facets }, inputs, 4);
    assert.ok(ranked.some(s => s.domain === 'ocean.example.com'));
    assert.equal(new Set(ranked.map(s => s.id)).size, ranked.length);
});

test('deadline cancels outstanding provider requests without late state mutation', async () => {
    let cancelled = false;
    const started = Date.now();
    const result = await runResearch(query, { timeoutMs: 600 }, deps({ search: async (_, { signal }) => new Promise(resolve => signal.addEventListener('abort', () => { cancelled = true; resolve([source()]); }, { once: true })) }));
    assert.ok(Date.now() - started < 1000);
    assert.equal(cancelled, true);
    assert.equal(result.sources.length, 0);
});

test('synthesis failure retains source links without presenting raw excerpts as verified facts', async () => {
    const result = await runResearch(query, { timeoutMs: 4000 }, deps({ synthesize: async () => null }));
    assert.equal(result.provenance, 'synthesis_fallback');
    assert.equal(result.answerStatus, 'unavailable');
    assert.equal(result.verified, false);
    assert.equal(result.facts.length, 0);
    assert.match(result.content, /couldn't verify|could not verify/i);
    assert.ok(!result.content.includes('reference star'));
    assert.ok(!result.content.includes('[1]'));
    assert.equal(result.sources[0].fullArticleText, paragraph);
});

test('structured facts with invented source IDs cannot become cited answers', async () => {
    let payload;
    const result = await runResearch(query, { timeoutMs: 4000 }, deps({ synthesize: async ({ sources, requirements }) => {
        payload = { facts: [{ ...structuredFact(requirements[0], sources[0], paragraph), sourceId: 99 }], answerSegments: [{ text: 'An unsupported asserted answer', factIds: ['f1'] }], gaps: [] };
        return payload;
    } }));
    assert.ok(!result.content.includes('[99]'));
    assert.equal(result.provenance, 'synthesis_fallback');
    assert.equal(result.answerStatus, 'unavailable');
    assert.equal(result.verified, false);
    assert.equal(result.facts.length, 0);
    assert.equal(validateResearchAnswer(payload, result.research.requirements, result.sources).rejectedFacts[0].reason, 'unknown_source');
});

test('validated partial facts survive a failed final generation after targeted retrieval', async () => {
    const q = 'Who developed orbital telescope calibration and when?';
    const report = 'Fixture Observer developed the orbital telescope calibration technique. The detector reference measurements are described in the instrument handbook, which does not state the date of development.';
    const searched = [];
    let generations = 0;
    const result = await runResearch(q, { timeoutMs: 45000 }, {
        search: async candidate => { searched.push(candidate); return [source({ snippet: report })]; },
        extract: async url => ({ bodyText: report, url }),
        synthesize: async ({ requirements, sources }) => {
            if (++generations > 1) return null;
            return {
                facts: [structuredFact(requirements.find(item => item.type === 'names'), sources[0], 'Fixture Observer', report)],
                gaps: [{ requirementId: requirements.find(item => item.type === 'date').id, detail: 'the exact development date', query: 'orbital telescope calibration technique development date' }]
            };
        }
    });
    assert.equal(generations, 2);
    assert.ok(searched.includes('orbital telescope calibration technique development date'));
    assert.equal(result.answerStatus, 'partial');
    assert.equal(result.verified, false);
    assert.equal(result.facts.length, 1);
    assert.equal(result.facts[0].value, 'Fixture Observer');
    assert.match(result.content, /Fixture Observer \[1\]/);
    assert.match(result.content, /Still unverified: the exact development date/);
    assert.ok(result.research.warnings.includes('answer_model_unavailable'));
});

test('identical concurrent retrieval is coalesced, and one cancellation does not cancel another user', async () => {
    let calls = 0;
    const q = `coalesced telescope ${Date.now()}`;
    const first = new AbortController();
    const search = async () => { calls++; await new Promise(r => setTimeout(r, 30)); return [source()]; };
    const a = cachedResearchSearch(q, { signal: first.signal }, search);
    const b = cachedResearchSearch(q, {}, search);
    first.abort();
    assert.deepEqual(await a, []);
    assert.equal((await b).length, 1);
    assert.equal(calls, 1);
    const cached = await cachedResearchSearch(q, {}, () => assert.fail('Expected retrieval cache'));
    cached[0].title = 'mutated';
    assert.notEqual((await cachedResearchSearch(q, {}, search))[0].title, 'mutated');
});

test('private and disguised loopback URLs are rejected before fetching', () => {
    for (const url of ['http://127.1/a', 'http://2130706433/a', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/', 'http://localhost/', 'http://10.0.0.1/', 'file:///etc/passwd']) assert.equal(isPublicWebUrl(url), false, url);
    assert.equal(isPublicWebUrl('https://example.com/article'), true);
});

test('crawler will not follow a redirect to a private address', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } }); };
    try { assert.equal(await crawlArticleResilient('https://redirect.example.com/start'), null); assert.equal(calls, 1); }
    finally { globalThis.fetch = original; }
});

test('rendered Crawl4AI results support the real results-array and markdown-object shape', () => {
    const result = normalizeCrawl4AiResult({ results: [{ url: 'https://example.com/article', markdown: { raw_markdown: '# Telescope\n' + paragraph } }] }, 'https://example.com/article');
    assert.match(result.text, /reference star/);
    assert.ok(!result.text.includes('[object Object]'));
});

test('article extraction retains adjacent evidence and relevant reference links', () => {
    const extracted = extractArticleFromHtml(articleHtml.replace('</article>', '<p>Additional independent observations confirm the instrument settings.</p><a href="/reference">Orbital telescope calibration instrument reference</a></article>'), source().url, query);
    assert.match(extracted.bodyText, /Additional independent/);
    assert.equal(extracted.links[0].url, 'https://science.example.com/reference');
});

test('Google search grounding cannot run accidentally with a configured text-model key', async () => {
    const old = process.env.SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE;
    delete process.env.SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE;
    try { assert.deepEqual((await searchGeminiGrounding(query, { customGeminiKey: 'not-a-real-key' })).results, []); }
    finally { if (old !== undefined) process.env.SEARCH_GEMINI_GROUNDING_FREE_ALLOWANCE = old; }
});

function sseResponse(events, chunks = false) {
    const text = events.map(([event, data]) => `event: ${event}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`).join('');
    const bytes = new TextEncoder().encode(text);
    return new Response(new ReadableStream({ start(c) { if (chunks) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); } else c.enqueue(bytes); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

test('browser stream parser handles split UTF-8, CRLF and canonical completion', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([['status', { message: 'Reading…' }], ['sources', { sources: [{ ...source(), id: 4 }] }], ['token', { token: '測定 [4]' }], ['done', { success: true, content: '測定 [4]', provenance: 'web_grounded', answerStatus: 'complete', verified: true }]], true);
    try { const result = await streamResearchRequest('/api/search', {}, { onEvent() {} }); assert.equal(result.content, '測定 [4]'); assert.equal(result.answerStatus, 'complete'); }
    finally { globalThis.fetch = original; }
});

test('browser detects a truncated stream instead of treating it as success', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => sseResponse([['token', { token: 'unfinished' }]]);
    try { await assert.rejects(streamResearchRequest('/api/search', {}), /before completion/); }
    finally { globalThis.fetch = original; }
});

test('remote controller keeps server citation IDs and does not apply the old five-second cutoff', async () => {
    const controller = new BoundedLiveResearchController({ searchCutoffMs: 5, hardDeadlineMs: 10 });
    let completed = 0;
    const result = await controller.execute({ query, researchStreamFn: async ({ onEvent }) => { await new Promise(r => setTimeout(r, 30)); onEvent('sources', { sources: [{ ...source({ snippet: paragraph }), id: 7 }] }); onEvent('token', { token: 'Supported answer. [7]' }); const final = { content: 'Supported answer. [7]', success: true, provenance: 'web_grounded', answerStatus: 'complete', verified: true }; onEvent('done', final); return final; }, uiCallbacks: { onComplete() { completed++; } } });
    assert.equal(result.provenance, 'web_grounded');
    assert.equal(result.sources[0].id, 7);
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.verified, true);
    assert.equal(completed, 1);
});

test('stopping remote research cancels work and ignores late completion', async () => {
    const controller = new BoundedLiveResearchController();
    let events;
    let completed = 0;
    const task = controller.execute({ query, researchStreamFn: async ({ signal, onEvent }) => { events = onEvent; await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); return { content: 'late', provenance: 'web_grounded' }; }, uiCallbacks: { onComplete() { completed++; } } });
    controller.abort();
    const result = await task;
    events('token', { token: 'late' });
    assert.equal(result.aborted, true);
    assert.equal(controller.streamedText, '');
    assert.equal(completed, 0);
});

test('real search handler emits research status, sources and done with no model-memory answer', async () => {
    const original = globalThis.fetch;
    const env = Object.fromEntries(['GROQ_API_KEY', 'GROQ_API_KEYS', 'GROQ_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'].map(k => [k, process.env[k]]));
    for (const key of Object.keys(env)) delete process.env[key];
    globalThis.fetch = async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    const req = new EventEmitter(); Object.assign(req, { method: 'POST', headers: { 'content-type': 'application/json' }, body: { query: 'unique orbital telescope calibration handler', stream: true } });
    const res = new EventEmitter(); Object.assign(res, { writableEnded: false, text: '', setHeader() {}, writeHead(status, headers) { this.status = status; this.headers = headers; }, write(t) { this.text += t; }, end() { this.writableEnded = true; } });
    try {
        await handler(req, res);
        assert.equal(res.status, 200);
        for (const event of ['status', 'sources', 'done']) assert.ok(res.text.includes(`event: ${event}`));
        assert.match(res.text, /no_sources/);
        assert.ok(!res.text.includes('comprehensive model knowledge'));
        assert.equal(res.writableEnded, true);
    } finally { globalThis.fetch = original; for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test('model-call budget prevents inference after the quota allocated to a turn is consumed', async () => {
    assert.equal(await callResearchModel({ system: '', prompt: '', budget: { calls: 4, maxCalls: 4 }, customGroqKey: 'not-a-real-key' }), null);
});

test('large articles retain the matching passage while the combined model context stays bounded', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Background section ${i}: General astronomy observations and routine instrument maintenance. `.repeat(8)).join('\n\n') + '\n\nThe rare xenon detector calibration requires the violet reference target. The telescope measures the xenon calibration response before observing.\n\nThis adjacent paragraph explains how the target measurement is independently checked.';
    assert.match(selectResearchExcerpt(text, 'xenon detector calibration', 1600), /violet reference target/);
    const sources = Array.from({ length: 8 }, (_, i) => ({ ...source(), id: i + 1, fullArticleText: text, evidenceKind: 'article', extractionStatus: 'extracted' }));
    assert.ok(formatResearchEvidence(sources, 'xenon detector calibration').length < 15000);
});

test('a model planner cannot replace an explicit software entity with a similarly named retailer', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ query: 'Next fashion app', queries: ['Next fashion app'], facets: ['Next fashion app'] }) } }] });
    try {
        const result = await planResearch('Next.js App Router documentation', [], { customGroqKey: 'fixture-key', budget: { calls: 0, maxCalls: 1 } });
        assert.equal(result.query, 'Next.js App Router documentation');
    } finally { globalThis.fetch = original; }
});

test('a provider stream without a normal finish cannot be accepted as a complete synthesis', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: 'An interrupted answer [1]' } }] }) + '\n\n', { headers: { 'content-type': 'text/event-stream' } });
    try {
        let partial = '';
        const result = await callResearchModel({ system: '', prompt: '', customGroqKey: 'fixture-key', budget: { calls: 0, maxCalls: 1 }, onToken: token => { partial += token; } });
        assert.equal(result, null);
        assert.match(partial, /interrupted/);
    } finally { globalThis.fetch = original; }
});

const passportClaim = '3 persons on the world can travel without the passport.';
const mistakenPassportPlan = () => ({ query: passportClaim, originalQuery: passportClaim, queries: [passportClaim, 'What categories of individuals are exempt from passport requirements?'], facets: ['Legal exemptions', 'Diplomatic passport holders', 'Stateless persons'], ambiguous: true, clarification: 'Who are the three specific individuals claimed to be able to travel worldwide without a passport?', interpretations: ['The question seeks the names of three specific people', 'The question asks for types of persons', 'The question refers to a myth and wants verification'] });

test('the exact passport claim cannot become a names-versus-categories clarification menu', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify(mistakenPassportPlan()) } }] });
    try {
        const result = await planResearch(passportClaim, [], { customGroqKey: 'fixture-key', budget: { calls: 0, maxCalls: 1 } });
        assert.equal(result.ambiguous, false);
        assert.equal(result.researchIntent, 'verify_claim');
        assert.deepEqual(result.interpretations, []);
        assert.equal(result.clarification, '');
        assert.deepEqual(result.facets, [passportClaim]);
        assert.ok(result.queries.every(q => !q.includes('categories')));
    } finally { globalThis.fetch = original; }
});

test('execution researches the exact claim even if an injected planner still marks it ambiguous', async () => {
    let searches = 0;
    const identities = 'The passport-free travel claim identifies Fixture Monarch, Fixture Emperor and Fixture Empress as the three named individuals who travel without a passport.';
    const qualification = 'A passport exemption does not grant unrestricted worldwide entry; destination countries may still require entry permission.';
    const report = `${identities} ${qualification}`;
    const events = [];
    const result = await runResearch(passportClaim, { timeoutMs: 6000, onEvent: (event, data) => events.push([event, data]) }, {
        plan: async () => mistakenPassportPlan(),
        search: async () => { searches++; return [{ title: 'Three people who can travel without a passport', url: 'https://publisher.example.com/passport-claim', snippet: report, sourceType: 'live_web' }]; },
        extract: async url => ({ bodyText: report, url }),
        synthesize: async ({ prompt, sources, requirements }) => {
            assert.match(prompt, /Fixture Empress/);
            const names = requirements.find(item => item.type === 'names');
            const limits = requirements.find(item => item.type === 'qualification');
            assert.equal(names.expectedCount, 3);
            assert.ok(limits, 'The broad worldwide-travel premise needs its own requirement');
            return { facts: [
                ...['Fixture Monarch', 'Fixture Emperor', 'Fixture Empress'].map((value, i) => ({ ...structuredFact(names, sources[0], value, identities), id: `person-${i + 1}` })),
                { ...structuredFact(limits, sources[0], qualification, qualification), id: 'travel-limits' }
            ], gaps: [], premise: { status: 'supported', sourceId: sources[0].id, quote: identities } };
        }
    });
    assert.ok(searches > 0);
    assert.ok(result.research.rounds > 0);
    assert.equal(result.provenance, 'web_grounded');
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.verified, true);
    assert.equal(result.facts.length, 4);
    for (const name of ['Fixture Monarch', 'Fixture Emperor', 'Fixture Empress']) assert.ok(result.content.includes(`${name} [1]`));
    assert.ok(result.content.includes(`${qualification} [1]`));
    assert.equal(result.clarification, undefined);
    assert.ok(events.some(([event]) => event === 'sources'));
    assert.ok(!result.content.includes('The question seeks'));
});

test('factual claim uncertainty and grammar do not require choosing a research intent', () => {
    for (const claim of [passportClaim, 'Three countries in the world have no rivers.', '5 animals can survive without oxygen.', 'Humans use only ten percent of their brains.', 'Who are the three people who can travel without a passport?', 'Next.js 15 has breaking changes.', 'This year India has a new president.']) {
        assert.equal(isResearchableClaim(claim), true, claim);
    }
    for (const unresolved of ['They can travel without a passport.', 'Who won yesterday?', 'The price is high.', 'What are the three things that can cause this?', 'Three of them can travel without a passport.']) assert.equal(isResearchableClaim(unresolved), false, unresolved);
    assert.equal(deterministicResearchPlan('This year India has a new president.').ambiguous, false);
});

test('a failed search for a factual claim reports missing evidence rather than returning interpretations', async () => {
    let searches = 0;
    const result = await runResearch(passportClaim, { timeoutMs: 3000 }, { plan: async () => mistakenPassportPlan(), search: async () => { searches++; return []; }, extract: async () => null, review: async () => null });
    assert.ok(searches > 0);
    assert.equal(result.provenance, 'no_sources');
    assert.ok(!result.content.includes('categories'));
});

test('the current user message is not treated as its own missing-reference context', async () => {
    const q = 'They can travel without a passport.';
    const result = await runResearch(q, { timeoutMs: 3000, context: [{ role: 'user', content: q }] }, { plan: async () => deterministicResearchPlan(q, [{ role: 'user', content: q }]), search: async () => assert.fail('The absent subject still needs clarification') });
    assert.equal(result.provenance, 'clarification');
    assert.equal(result.research.rounds, 0);
});

});

describe('Research Evidence Validation', () => {

const passport = '3 persons on the world can travel without the passport.';
const report = 'The three specific individuals who can travel internationally without a passport under special arrangements are Fixture Monarch, Fixture Emperor and Fixture Empress. These arrangements do not establish unrestricted entry to every country.';
const source = (body = report, extra = {}) => ({ id: 1, title: 'People who can travel without a passport', url: 'https://publisher.test/passport', fullArticleText: body, pageFetched: true, ...extra });
const passportFacts = () => ['Fixture Monarch', 'Fixture Emperor', 'Fixture Empress'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, quote: report, sourceId: 1 }));

test('passport claim requires individual names and verifies the worldwide qualification separately', () => {
    const requirements = buildResearchRequirements(passport);
    assert.equal(requirements[0].type, 'names');
    assert.equal(requirements[0].expectedCount, 3);
    assert.equal(requirements[0].countIsClaim, true);
    assert.equal(requirements[1].type, 'qualification');
    const partial = validateResearchAnswer({ facts: passportFacts() }, requirements, [source()]);
    assert.equal(partial.answerStatus, 'partial');
    assert.equal(partial.verified, false);
    assert.match(partial.content, /Fixture Empress \[1\]/);
    assert.deepEqual(partial.missingRequirementIds, ['r2']);
    const complete = validateResearchAnswer({ facts: [...passportFacts(), { id: 'scope', requirementId: 'r2', value: 'These arrangements do not establish unrestricted entry to every country.', quote: report, sourceId: 1 }] }, requirements, [source()]);
    assert.equal(complete.answerStatus, 'complete');
    assert.equal(complete.verified, true);
});

test('generic capitalized phrases and repeated headlines never satisfy a requested count', () => {
    const generic = 'The International Travel rules mention Border Control, British Passport, United Kingdom and Royal Family. A passport is normally required for travel.';
    const sources = [source(generic)];
    assert.equal(evaluateResearchCoverage({ query: passport }, sources).sufficient, false);
    const facts = ['International Travel', 'British Passport', 'Royal Family'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, quote: generic, sourceId: 1 }));
    const result = validateResearchAnswer({ facts }, buildResearchRequirements(passport), sources);
    assert.equal(result.answerStatus, 'unavailable');
    assert.equal(result.facts.length, 0);
    const title = 'Three people who can travel without a passport';
    const echoed = validateResearchAnswer({ facts: [{ id: 'f1', requirementId: 'r1', value: 'Three people', sourceId: 1, quote: title }] }, buildResearchRequirements(passport), [source(title, { title })]);
    assert.equal(echoed.answerStatus, 'unavailable');
});

test('unknown sources, fabricated quotes, paraphrased values and unsupported answer prose are rejected', () => {
    const requirements = buildResearchRequirements('Who can travel internationally without a passport?');
    const result = validateResearchAnswer({ facts: [passportFacts()[0], { ...passportFacts()[1], sourceId: 99 }, { ...passportFacts()[2], quote: 'Fixture Empress can enter any country without restrictions.' }, { ...passportFacts()[2], value: 'Fixture Empress is exempt from all immigration law' }], answerSegments: [{ text: 'All three can enter every country without permission.', factIds: ['f0'] }] }, requirements, [source()]);
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.facts.length, 1);
    assert.equal(result.rejectedFacts.length, 3);
    assert.equal(result.content, 'Fixture Monarch [1]');
    assert.ok(!result.content.includes('every country'));
});

test('one list fact or duplicate abbreviated name cannot manufacture three verified entities', () => {
    const requirements = buildResearchRequirements(passport);
    const list = { id: 'list', requirementId: 'r1', value: 'Fixture Monarch, Fixture Emperor and Fixture Empress', quote: report, sourceId: 1 };
    const result = validateResearchAnswer({ facts: [list] }, requirements, [source()]);
    assert.equal(result.answerStatus, 'partial');
    assert.ok(result.missingRequirementIds.includes('r1'));
    const duplicates = validateResearchAnswer({ facts: [passportFacts()[0], { ...passportFacts()[0], id: 'short', value: 'Monarch' }] }, requirements, [source()]);
    assert.equal(duplicates.facts.length, 1);
});

test('false counts can be corrected by explicit source evidence instead of padding the list', () => {
    const query = 'Three countries in the world have no rivers.';
    const body = 'Only two countries have no rivers: Fixture A and Fixture B. The often repeated claim of three countries is incorrect.';
    const requirements = buildResearchRequirements(query);
    const facts = ['Fixture A', 'Fixture B'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, sourceId: 7, quote: body }));
    const result = validateResearchAnswer({ facts, premise: { status: 'contradicted', sourceId: 7, quote: body } }, requirements, [source(body, { id: 7, title: 'Countries with no rivers' })]);
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.verified, true);
    assert.match(result.content, /Only two countries/);
    const countOnly = validateResearchAnswer({ premise: { status: 'contradicted', sourceId: 7, quote: body } }, requirements, [source(body, { id: 7, title: 'Countries with no rivers' })]);
    assert.equal(countOnly.answerStatus, 'partial');
    const unsupported = validateResearchAnswer({ premise: { status: 'contradicted', sourceId: 7, quote: 'Countries have different water resources.' } }, requirements, [source('Countries have different water resources.', { id: 7, title: 'Countries with no rivers' })]);
    assert.equal(unsupported.answerStatus, 'unavailable');
});

test('aliases preserve geographic relevance without rewriting ordinary pronouns', () => {
    assert.equal(normalizeResearchAliases('U.S. GDP'), 'United States GDP');
    assert.equal(normalizeResearchAliases('Tell us about US population'), 'Tell us about United States population');
    assert.equal(assessSourceRelevance('U.S. population', { title: 'United States population', snippet: 'United States census population estimates.' }).relevant, true);
    assert.equal(assessSourceRelevance('United States population', { title: 'U.S. population estimates' }).relevant, true);
    for (const [query, wrong] of [['Next.js documentation', 'Next clothing documentation'], ['C++ memory management', 'C memory management'], ['.NET deployment', 'net deployment']]) assert.equal(assessSourceRelevance(query, { title: wrong }).relevant, false);
});

test('comparison sources may cover one subject but completion requires both subjects', () => {
    const query = 'Compare U.S. and Canada population';
    const requirements = buildResearchRequirements(query);
    assert.equal(requirements.length, 2);
    assert.deepEqual(requirements.map(r => r.entities[0]), ['United States', 'Canada']);
    const us = source('The United States population was 340 million in this fixture.', { id: 1, title: 'United States population', url: 'https://census.test/us' });
    const ca = source('Canada population was 41 million in this fixture.', { id: 2, title: 'Canada population', url: 'https://statistics.test/ca' });
    assert.equal(assessSourceRelevance(query, us).relevant, true);
    assert.equal(assessSourceRelevance(query, ca).relevant, true);
    const facts = [{ id: 'us', requirementId: 'r1', value: '340 million', sourceId: 1, quote: us.fullArticleText }, { id: 'ca', requirementId: 'r2', value: '41 million', sourceId: 2, quote: ca.fullArticleText }];
    assert.equal(validateResearchAnswer({ facts: facts.slice(0, 1) }, requirements, [us, ca]).answerStatus, 'partial');
    assert.equal(validateResearchAnswer({ facts }, requirements, [us, ca]).answerStatus, 'complete');
    assert.equal(matchesProtectedEntities('Compare Next.js and React performance', 'React performance guide'), true);
    assert.equal(matchesProtectedEntities('Compare C++ and .NET memory management', 'C++ memory management'), true);
});

test('publisher identity and discovery URL survive redirect wrapper normalization', () => {
    const normalized = normalizeEvidence({ title: 'Telescope detector calibration', url: 'https://news.google.com/rss/articles/abc', snippet: 'Telescope detector calibration uses a reference star.', publisher: 'Science Journal', publisherDomain: 'science.test', discoveryUrl: 'https://news.google.com/rss/articles/abc', originalUrl: 'https://science.test/report' }, 'telescope detector calibration');
    assert.equal(normalized.publisher, 'Science Journal');
    assert.equal(normalized.publisherDomain, 'science.test');
    assert.equal(normalized.originalUrl, 'https://science.test/report');
    assert.equal(normalized.discoveryUrl, 'https://news.google.com/rss/articles/abc');
});

test('date and value requirements reject unrelated passages despite a valid quotation', () => {
    const requirements = buildResearchRequirements('When was the Apollo 11 launch?');
    assert.equal(requirements[0].type, 'date');
    const unrelated = source('Fixture Emperor was born on 23 February 1960.', { title: 'Fixture Emperor biography' });
    const result = validateResearchAnswer({ facts: [{ id: 'date', requirementId: 'r1', value: '23 February 1960', quote: unrelated.fullArticleText, sourceId: 1 }] }, requirements, [unrelated]);
    assert.equal(result.answerStatus, 'unavailable');
});

test('a software date or vague topic echo cannot satisfy a requested explanation', () => {
    const requirements = buildResearchRequirements('What are React Server Components in Next.js?');
    const body = 'Next.js was introduced in 2016. React Server Components are components that execute on the server and send a serialized rendering result to the client.';
    const s = source(body, { title: 'Next.js React Server Components explanation' });
    const vague = validateResearchAnswer({ facts: [{ id: 'date', requirementId: 'r1', value: 'Next.js was introduced in 2016.', sourceId: 1, quote: body }] }, requirements, [s]);
    assert.equal(vague.answerStatus, 'unavailable');
    const value = 'React Server Components are components that execute on the server and send a serialized rendering result to the client.';
    const supported = validateResearchAnswer({ facts: [{ id: 'definition', requirementId: 'r1', value, sourceId: 1, quote: body }] }, requirements, [s]);
    assert.equal(supported.answerStatus, 'complete');
    const admittedGap = validateResearchAnswer({ facts: [{ id: 'definition', requirementId: 'r1', value, sourceId: 1, quote: body }], gaps: [{ requirementId: 'r1', detail: 'How the serialized result integrates with the Next.js rendering pipeline', query: 'Next.js React Server Components serialized rendering pipeline' }] }, requirements, [s]);
    assert.equal(admittedGap.answerStatus, 'partial');
    assert.match(admittedGap.nextQueries[0], /serialized/);
});

test('targeted generation retains prior facts and remaps citation IDs by source URL', () => {
    const requirements = buildResearchRequirements(passport);
    const first = validateResearchAnswer({ facts: passportFacts() }, requirements, [source()]);
    const restriction = source('These special passport arrangements do not establish unrestricted entry to every country.', { id: 1, title: 'Passport exemption entry restrictions', url: 'https://official.test/entry' });
    const renumbered = source(report, { id: 5 });
    const merged = mergeResearchValidation(first, { facts: [{ id: 'scope', requirementId: 'r2', value: restriction.fullArticleText, sourceId: 1, quote: restriction.fullArticleText }], gaps: [] }, requirements, [restriction, renumbered]);
    assert.equal(merged.answerStatus, 'complete');
    assert.equal(merged.facts.length, 4);
    assert.match(merged.content, /Fixture Monarch \[5\]/);
    assert.match(merged.content, /country\. \[1\]/);
    const absentSource = mergeResearchValidation(first, { facts: [], gaps: [] }, requirements, [restriction]);
    assert.equal(absentSource.answerStatus, 'unavailable');
});

test('retained false-premise correction stays quoted and is revalidated after another generation', () => {
    const query = 'Three countries have no rivers.';
    const body = 'Only two countries have no rivers: Fixture A and Fixture B. The claim of three countries is incorrect.';
    const requirements = buildResearchRequirements(query);
    const original = source(body, { id: 2, title: 'Countries with no rivers' });
    const facts = ['Fixture A', 'Fixture B'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, sourceId: 2, quote: body }));
    const first = validateResearchAnswer({ facts, premise: { status: 'contradicted', sourceId: 2, quote: body } }, requirements, [original]);
    const merged = mergeResearchValidation(first, { facts: [], gaps: [] }, requirements, [{ ...original, id: 6 }]);
    assert.equal(merged.answerStatus, 'complete');
    assert.equal(merged.facts.find(f => f.premiseCorrection).correctedCount, 2);
    assert.match(merged.content, /Only two countries.*\[6\]/);
    const changed = mergeResearchValidation(first, { facts: [], gaps: [] }, requirements, [{ ...original, id: 6, fullArticleText: 'No relevant factual passage remains on this page.' }]);
    assert.equal(changed.answerStatus, 'unavailable');
});

test('comparison dates are separate requirements for each numerical estimate', () => {
    const query = 'Compare U.S. and Canada population, with the date of each estimate.';
    const requirements = buildResearchRequirements(query);
    assert.deepEqual(requirements.map(r => [r.entities[0], r.type, r.attribute]), [['United States', 'comparison', 'population'], ['United States', 'date', 'date'], ['Canada', 'comparison', 'population'], ['Canada', 'date', 'date']]);
    const us = source('The U.S. population estimate is 340 million as of July 1, 2024.', { title: 'U.S. population estimate', id: 1, url: 'https://census.test/us' });
    const ca = source('The Canada population estimate is 41 million as of July 1, 2024.', { title: 'Canada population estimate', id: 2, url: 'https://statistics.test/ca' });
    const facts = [{ id: 'us-pop', requirementId: 'r1', value: '340 million', sourceId: 1, quote: us.fullArticleText }, { id: 'us-date', requirementId: 'r2', value: 'July 1, 2024', sourceId: 1, quote: us.fullArticleText }, { id: 'ca-pop', requirementId: 'r3', value: '41 million', sourceId: 2, quote: ca.fullArticleText }, { id: 'ca-date', requirementId: 'r4', value: 'July 1, 2024', sourceId: 2, quote: ca.fullArticleText }];
    assert.equal(validateResearchAnswer({ facts: facts.slice(0, 3) }, requirements, [us, ca]).answerStatus, 'partial');
    const complete = validateResearchAnswer({ facts }, requirements, [us, ca]);
    assert.equal(complete.answerStatus, 'complete');
    assert.match(complete.content, /Canada \(date\): July 1, 2024/);
});

test('a species count can be corrected without manufacturing an extra name', () => {
    const requirements = buildResearchRequirements('Name the four species of elephant living today.');
    assert.equal(requirements[0].expectedCount, 4);
    const body = 'There are three living species of elephant: Fixture Savanna Elephant, Fixture Forest Elephant and Fixture Asian Elephant.';
    const s = source(body, { title: 'Living elephant species', id: 1 });
    const facts = ['Fixture Savanna Elephant', 'Fixture Forest Elephant', 'Fixture Asian Elephant'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, sourceId: 1, quote: body }));
    const result = validateResearchAnswer({ facts, premise: { status: 'contradicted', sourceId: 1, quote: body } }, requirements, [s]);
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.facts.filter(f => !f.premiseCorrection).length, 3);
    assert.match(result.content, /three living species/);
});

test('independent named examples do not establish an alleged exclusive count', () => {
    const requirements = buildResearchRequirements('Only three people can use the fictional aurora gate.');
    const body = 'Avery North can use the fictional aurora gate. Emery South can use the fictional aurora gate. Quinn West can use the fictional aurora gate.';
    const facts = ['Avery North', 'Emery South', 'Quinn West'].map((value, index) => ({ id: `f${index}`, requirementId: 'r1', value, sourceId: 1, quote: body }));
    const result = validateResearchAnswer({ facts }, requirements, [source(body, { title: 'Fictional aurora gate access' })]);
    assert.equal(result.answerStatus, 'partial');
    assert.match(result.gaps[0].detail, /exclusivity/);
    const explicit = 'Only three people can use the fictional aurora gate: ' + body;
    const supported = validateResearchAnswer({ facts: facts.map(f => ({ ...f, quote: explicit })) }, requirements, [source(explicit, { title: 'Fictional aurora gate access' })]);
    assert.equal(supported.answerStatus, 'complete');
});

test('role and office-holder queries correctly identify person requirement and validate office holders', () => {
    const queries = ['CM of Tamil Nadu', 'CEO of Apple', 'President of France', 'Mayor of London'];
    for (const q of queries) {
        const reqs = buildResearchRequirements(q);
        assert.equal(reqs[0].type, 'names', `Query "${q}" should produce requirement type "names"`);
        assert.equal(reqs[0].entityKind, 'person');
    }
    const q = 'CM of Tamil Nadu';
    const reqs = buildResearchRequirements(q);
    const body = 'M. K. Stalin is the Chief Minister of Tamil Nadu since May 2021.';
    const s = source(body, { title: 'Chief Minister of Tamil Nadu', url: 'https://tn.gov.in/cm' });
    const result = validateResearchAnswer({ facts: [{ id: 'f1', requirementId: 'r1', value: 'M. K. Stalin', sourceId: 1, quote: body }] }, reqs, [s]);
    assert.equal(result.answerStatus, 'complete');
    assert.equal(result.rejectedFacts.length, 0);
    assert.equal(result.content, 'M. K. Stalin [1]');
});

test('entity and numerical lookups establish appropriate requirements without false explanation fallback', () => {
    const capitalReqs = buildResearchRequirements('capital of France');
    assert.equal(capitalReqs[0].type, 'names');
    assert.equal(capitalReqs[0].entityKind, 'place');
    const capitalBody = 'Paris is the capital of France and its largest city.';
    const capitalSource = source(capitalBody, { title: 'France Overview', url: 'https://france.test' });
    const capitalResult = validateResearchAnswer({ facts: [{ id: 'f1', requirementId: 'r1', value: 'Paris', sourceId: 1, quote: capitalBody }] }, capitalReqs, [capitalSource]);
    assert.equal(capitalResult.answerStatus, 'complete');
    assert.equal(capitalResult.content, 'Paris [1]');

    const popReqs = buildResearchRequirements('population of Tokyo');
    assert.equal(popReqs[0].type, 'value');
    const popBody = 'The population of Tokyo metropolitan area is approximately 37 million people.';
    const popSource = source(popBody, { title: 'Tokyo Demographics', url: 'https://tokyo.test' });
    const popResult = validateResearchAnswer({ facts: [{ id: 'f1', requirementId: 'r1', value: '37 million', sourceId: 1, quote: popBody }] }, popReqs, [popSource]);
    assert.equal(popResult.answerStatus, 'complete');
    assert.equal(popResult.content, '37 million [1]');

    const explainReqs = buildResearchRequirements('How does a CEO get appointed');
    assert.equal(explainReqs[0].type, 'explanation');
    const historyReqs = buildResearchRequirements('History of the Prime Minister of UK');
    assert.equal(historyReqs[0].type, 'explanation');
});

});

describe('Research Model Budget & Failover', () => {

const keys = { customGroqKey: 'fixture-groq-secret', customGeminiKey: 'fixture-gemini-secret' };
const body = { facts: [{ id: 'f1', requirementId: 'r1', value: 'Fixture fact', sourceId: 1, quote: 'Fixture fact is stated here.' }] };
const response = (provider, data = body) => Response.json(provider === 'groq'
    ? { choices: [{ message: { content: JSON.stringify(data) }, finish_reason: 'stop' }] }
    : { candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] });
const invoke = extra => callResearchModel({ ...keys, system: 'Return supported facts.', prompt: 'A question and evidence.', json: true, timeoutMs: 1000, ...extra });

test('actual HTTP response parsing falls back after Groq 400 and records each attempt', async () => {
    clearResearchModelHealth();
    const original = globalThis.fetch;
    const requests = [];
    globalThis.fetch = async (url, init) => {
        const request = JSON.parse(init.body);
        requests.push({ url: String(url), request });
        return String(url).includes('api.groq.com') ? new Response('Unsupported parameter', { status: 400 }) : response('gemini');
    };
    const budget = { calls: 0, maxCalls: 4 };
    try {
        assert.deepEqual(await invoke({ budget, reserveAttempts: 2 }), body);
        assert.equal(budget.calls, 2);
        assert.deepEqual(budget.attempts.map(a => a.outcome), ['http_400', 'success']);
        assert.equal(requests[0].request.response_format.type, 'json_object');
        assert.equal(requests[1].request.generationConfig.responseMimeType, 'application/json');
        assert.ok(!requests[0].request.tools && !requests[1].request.tools);
        assert.ok(!JSON.stringify(budget.attempts).includes('fixture-'));
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('a slow primary gets a bounded attempt while fallback still gets its own time', async () => {
    clearResearchModelHealth();
    const original = globalThis.fetch;
    const attempted = [];
    let aborted = false;
    globalThis.fetch = async (url, { signal } = {}) => {
        const urlStr = String(url);
        if (!urlStr.includes('groq') && !urlStr.includes('googleapis')) {
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        attempted.push(urlStr.includes('groq') ? 'groq' : 'gemini');
        if (urlStr.includes('groq')) return new Promise(() => signal?.addEventListener('abort', () => { aborted = true; }, { once: true }));
        return response('gemini');
    };
    const budget = { calls: 0, maxCalls: 4 };
    try {
        assert.deepEqual(await invoke({ timeoutMs: 120, budget }), body);
        assert.deepEqual(attempted, ['groq', 'gemini']);
        assert.equal(aborted, true);
        assert.deepEqual(budget.attempts.map(a => a.outcome), ['timeout', 'success']);
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('body-read timeout also permits fallback instead of hanging after headers', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async url => String(url).includes('groq')
        ? { ok: true, status: 200, json: () => new Promise(() => {}) }
        : response('gemini');
    const budget = { calls: 0, maxCalls: 4 };
    try {
        assert.deepEqual(await invoke({ timeoutMs: 120, budget }), body);
        assert.deepEqual(budget.attempts.map(a => a.outcome), ['timeout', 'success']);
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('first generation can never consume the two attempts reserved for final answering', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async url => String(url).includes('groq') ? new Response('bad request', { status: 400 }) : response('gemini');
    const budget = { calls: 0, maxCalls: 4 };
    try {
        await invoke({ budget, reserveAttempts: 2, stage: 'initial_answer' });
        assert.equal(budget.calls, 2);
        const noRoomForMorePlanning = await invoke({ budget, reserveAttempts: 2, stage: 'initial_answer' });
        assert.equal(noRoomForMorePlanning, null);
        assert.equal(budget.calls, 2);
        assert.deepEqual(await invoke({ budget, stage: 'final_answer' }), body);
        assert.equal(budget.calls, 4);
        assert.deepEqual(budget.attempts.map(a => a.stage), ['initial_answer', 'initial_answer', 'final_answer', 'final_answer']);
        assert.equal(await invoke({ budget }), null);
        assert.equal(budget.calls, 4);
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('429 cooldown isolates the affected credential and model', async () => {
    clearResearchModelHealth();
    const original = globalThis.fetch;
    globalThis.fetch = async () => new Response('quota exhausted', { status: 429, headers: { 'retry-after': '60' } });
    try {
        await callResearchModel({ system: '', prompt: '', json: true, customGroqKey: 'key-a', budget: { calls: 0, maxCalls: 1 } });
        const unavailableA = researchModelProviders({ customGroqKey: 'key-a', customGeminiKey: '' }).filter(p => p.name === 'groq');
        const availableB = researchModelProviders({ customGroqKey: 'key-b' }).filter(p => p.name === 'groq');
        assert.equal(unavailableA.length, 0);
        assert.equal(availableB.length, 1);
        assert.equal(availableB[0].key, 'key-b');
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('a malformed or incomplete primary response is diagnosed and not accepted as an answer', async () => {
    const original = globalThis.fetch;
    const budget = { calls: 0, maxCalls: 4 };
    globalThis.fetch = async url => String(url).includes('groq')
        ? Response.json({ choices: [{ message: { content: '{bad json' }, finish_reason: 'stop' }] })
        : response('gemini');
    try {
        assert.deepEqual(await invoke({ budget }), body);
        assert.equal(budget.attempts[0].outcome, 'invalid_json');
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('already-cancelled request starts no provider work', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => assert.fail('Cancelled request must not fetch');
    const controller = new AbortController(); controller.abort();
    try { assert.equal(await invoke({ signal: controller.signal }), null); }
    finally { globalThis.fetch = original; }
});

test('paid/unknown selected models never replace the allowed existing text models', () => {
    const providers = researchModelProviders({ ...keys, selectedModel: 'gemini-unrecognized-pro' });
    assert.equal(providers[0].model, 'gemini-2.5-flash');
    assert.ok(providers.every(provider => !provider.model.includes('unrecognized')));
});

});

describe('Research Lifecycle & Streaming', () => {

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

// Execute the production UI entrypoints with a small DOM, rather than reimplementing their logic.
function productionFunction(name) {
    const match = new RegExp(`(?:^|\\n)([ \\t]*)(?:async )?function ${name}\\(`).exec(html);
    assert.ok(match, `Missing production function ${name}`);
    const start = match.index + (html[match.index] === '\n' ? 1 : 0);
    const end = html.indexOf(`\n${match[1]}}`, start);
    assert.ok(end > start, `Missing end of production function ${name}`);
    return html.slice(start, end + match[1].length + 2);
}

function element() {
    return {
        isConnected: true, style: {}, dataset: {}, textContent: '', children: [],
        classList: { add() {}, remove() {}, contains() { return false; } },
        querySelector() { return null; }, querySelectorAll() { return []; },
        setAttribute() {}, appendChild(child) { this.children.push(child); },
        remove() { this.isConnected = false; }
    };
}

function uiHarness({ stream, replacement = false } = {}) {
    const storage = new Map();
    const rows = new Map();
    const renders = [];
    const records = [];
    const transitions = [];
    const indicator = element();
    const chat = element();
    const source = { id: 7, title: 'Orbital telescope calibration', url: 'https://science.example.com/calibration', snippet: 'Reference star observations support calibration.' };
    const noop = () => {};
    const oldRow = element();
    oldRow.textContent = 'The previous supported answer';
    const ctx = {
        console, performance, AbortController, setTimeout, clearTimeout, Intl,
        chatSessions: [{ id: 'chat_a', messages: [{ role: 'user', text: 'Orbital telescope calibration', turnId: 'a1' }], webSearchMode: 'off' }],
        activeChatSessionId: 'chat_a', conversationContext: [{ role: 'user', text: 'Stale unrelated chat' }],
        conversationHistory: [], chatHistory: [], isRestoringChatSession: false,
        pendingChatRestoreSearchQuery: '', pendingChatRestoreTargetMessageId: '',
        activeResponseRenderContext: replacement ? { isRegeneration: true, turnId: 'a1', replacementCandidate: null } : null,
        _composerWebMode: 'off', _activeCapabilityPill: null,
        activeRequestControllers: new Set(), activeRequestController: null,
        activeTypewriterRuns: new Set(), activeTypewriterTimeouts: new Set(),
        CHAT_SESSION_MAX_MESSAGES: 100, CHAT_ACTIVE_DRAFT_STORAGE_KEY: 'draft',
        APP_CONFIG: { endpoints: { search: '/api/search' } },
        localStorage: { setItem: (key, value) => storage.set(key, value), getItem: key => storage.get(key) || null },
        document: {
            body: element(),
            getElementById: id => id === 'chat-container' ? chat : null,
            querySelector: selector => selector.includes('thinking-timer') ? indicator : null,
            querySelectorAll: selector => selector === '.chat-row[data-message-id]' ? [...rows.values()].filter(row => row.isConnected) : [],
            createElement: () => element()
        },
        window: {
            APP_CONFIG: { endpoints: { search: '/api/search' } }, innerWidth: 1200,
            JarvisLiveResearch: { BoundedLiveResearchController, streamResearchRequest: stream
                ? (endpoint, payload, options) => stream({ ...payload, ...options })
                : (async () => ({ content: 'Supported answer. [7]', sources: [source], provenance: 'web_grounded', answerStatus: 'complete', verified: true })) },
            JarvisInteractionState: { transition: (...args) => transitions.push(args), isBusy: () => false, resetToIdle: noop },
            JarvisConversation: { reset: noop, buildContext: () => [{ role: 'user', content: 'Also stale' }] }
        },
        updateWebSearchToggleUi: noop, updateCapabilityPillsUi: noop,
        saveChatSessions: noop, chatSessionHasUserMessage: session => session.messages.some(item => item.role === 'user'),
        isInvalidOrGenericChatTitle: () => false, deriveChatTitleFromMessages: () => 'Example',
        showThinkingIndicator: noop, hideThinkingIndicator: noop, normalizeUserQuery: text => String(text || '').trim(),
        hasSearchableContent: text => Boolean(text?.trim()),
        addChatMessage(text, isUser, typewriter, meta) {
            const id = `message_${rows.size}`;
            const row = element();
            row.dataset.messageId = id;
            row.dataset.turnId = meta.turnId;
            if (ctx.activeResponseRenderContext?.isRegeneration) {
                row.isConnected = false;
                ctx.activeResponseRenderContext.replacementCandidate = {
                    messageId: id, messageDiv: row, replaceTarget: oldRow, replaceMessageId: 'old'
                };
            }
            rows.set(id, row);
            return id;
        },
        updateStreamingAssistantMessage: (id, content, meta) => renders.push({ id, content, meta }),
        recordActiveChatMessage: (...args) => records.push(args), saveToHistory: noop,
        getSelectedModel: () => 'auto',
        isConverseSpeechActive: () => false, isAssistantProcessing: () => false,
        resetComposerToIdle: noop, stopActiveTypewriterAnimations: noop, stopConverseSpeech: noop,
        clearResponseRecoveryPrompt: noop, resetAssistantProcessingState: noop, toggleSendButton: noop,
        showTemporaryMessage: noop, updateChatEmptyStateVisibility: noop, toggleDeepReasoningMode: noop,
        clearVisionContext: noop, persistActiveSessionSnapshot: noop, renderChatSidebarList: noop,
        forgetActiveEmptyChatDraft: noop, closeChatSessionMenu: noop, hydrateSessionMessagesFromHistory: () => false,
        buildHistoryFromChatSession: session => session.messages, restoreConversationEngineForSession: noop,
        assistantMessageMeta: new Map(), getConversationTurn: () => null,
        oldRow
    };
    vm.createContext(ctx);
    for (const name of ['createChatSession', 'normalizeChatSession', 'compactChatSessionForStorage', 'rememberActiveEmptyChatDraft', 'loadActiveEmptyChatDraft', 'getWebSearchMode', 'setWebSearchMode', 'cycleWebSearchMode', 'getActiveResearchContext', 'renderLiveResearchAnswerStatus', 'findAssistantMessageRow', 'stopActiveGeneration', 'startNewChatSession', 'restoreChatSession', 'handleBoundedLiveResearchQuery', 'commitRegenerationCandidate']) {
        vm.runInContext(productionFunction(name), ctx);
    }
    return { ctx, source, renders, records, rows, storage, indicator, transitions, oldRow };
}

test('search stays enabled after canonical completion and persists through storage and restore', async () => {
    const { ctx, renders } = uiHarness();
    ctx.cycleWebSearchMode();
    assert.equal(ctx.getWebSearchMode(), 'force');
    assert.equal(await ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration'), true);
    assert.equal(ctx.getWebSearchMode(), 'force');
    assert.equal(ctx.chatSessions[0].webSearchMode, 'force');
    assert.equal(renders[0].meta.verified, true);
    const saved = JSON.parse(JSON.stringify(ctx.compactChatSessionForStorage(ctx.chatSessions[0])));
    const restored = ctx.normalizeChatSession(saved);
    ctx.chatSessions.push({ id: 'chat_b', messages: [], webSearchMode: 'off' });
    ctx.activeChatSessionId = 'chat_b';
    ctx.setWebSearchMode('off');
    ctx.chatSessions[0] = restored;
    ctx.restoreChatSession('chat_a');
    assert.equal(ctx.getWebSearchMode(), 'force');
    ctx.cycleWebSearchMode();
    assert.equal(ctx.chatSessions[0].webSearchMode, 'off');
});

test('an empty conversation draft retains its mode across reload', () => {
    const { ctx, storage } = uiHarness();
    ctx.chatSessions[0].messages = [];
    ctx.setWebSearchMode('force');
    assert.equal(JSON.parse(storage.get('draft')).webSearchMode, 'force');
    assert.equal(ctx.loadActiveEmptyChatDraft().webSearchMode, 'force');
});

test('new conversations cancel remote research, clear context and start with search off', async () => {
    let aborted = false;
    const { ctx } = uiHarness({ stream: ({ signal }) => new Promise(resolve => signal.addEventListener('abort', () => { aborted = true; resolve({ content: 'late' }); }, { once: true })) });
    ctx.setWebSearchMode('force');
    const pending = ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    const fresh = ctx.startNewChatSession({ forceNew: true });
    assert.equal(aborted, true);
    assert.equal(await pending, false, 'The outer UI promise must settle on cancellation');
    assert.equal(fresh.webSearchMode, 'off');
    assert.equal(ctx.getWebSearchMode(), 'off');
    assert.equal(ctx.conversationContext.length, 0);
});

test('research context contains only the active chat and excludes the submitted message', async () => {
    let actualContext;
    const { ctx } = uiHarness({ stream: async ({ context }) => { actualContext = context; return { content: 'No evidence', answerStatus: 'unavailable', verified: false }; } });
    ctx.chatSessions.push({ id: 'chat_b', messages: [{ role: 'user', text: 'Secret other chat' }], webSearchMode: 'off' });
    ctx.chatSessions[0].messages = [
        { role: 'user', text: 'Tell me about telescope calibration' },
        { role: 'assistant', text: 'Calibration uses a reference star.' },
        { role: 'user', text: 'And its detector?' }
    ];
    await ctx.handleBoundedLiveResearchQuery('And its detector?');
    assert.deepEqual(Array.from(actualContext, item => item.content), ['Tell me about telescope calibration', 'Calibration uses a reference star.']);
    ctx.activeResponseRenderContext = { isRegeneration: true, turnId: '', replacementCandidate: null };
    assert.deepEqual(Array.from(ctx.getActiveResearchContext('And its detector?'), item => item.content), ['Tell me about telescope calibration', 'Calibration uses a reference star.']);
});

test('Stop settles the actual UI request even when a provider ignores cancellation, and late events are ignored', async () => {
    let emit;
    const { ctx, renders, records } = uiHarness({ stream: ({ onEvent }) => { emit = onEvent; return new Promise(() => {}); } });
    const pending = ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    ctx.stopActiveGeneration();
    assert.equal(await Promise.race([pending, new Promise((_, reject) => setTimeout(() => reject(new Error('UI promise hung')), 250))]), false);
    emit('token', { token: 'Late unsupported answer' });
    emit('done', { content: 'Late answer', answerStatus: 'complete', verified: true });
    assert.equal(renders.length, 0);
    assert.equal(records.length, 0);
});

test('switching chats cancels research and rejects all late UI and history updates', async () => {
    let emit;
    const { ctx, renders, records } = uiHarness({ stream: ({ onEvent }) => { emit = onEvent; return new Promise(() => {}); } });
    ctx.chatSessions.push({ id: 'chat_b', messages: [{ role: 'user', text: 'Different topic' }], webSearchMode: 'off' });
    ctx.setWebSearchMode('force');
    const pending = ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    ctx.restoreChatSession('chat_b');
    assert.equal(await pending, false);
    assert.equal(ctx.getWebSearchMode(), 'off');
    assert.deepEqual(Array.from(ctx.conversationContext, item => item.text), ['Different topic']);
    emit('status', { status: 'synthesizing', message: 'late' });
    emit('sources', { sources: [] });
    emit('done', { content: 'Wrong chat', answerStatus: 'complete', verified: true });
    assert.equal(renders.length, 0);
    assert.equal(records.length, 0);
});

test('partial answers remain unverified even when provenance says web_grounded', async () => {
    const harness = uiHarness();
    harness.ctx.window.JarvisLiveResearch.streamResearchRequest = async () => ({ content: 'One supported fact. [7] Missing the date.', sources: [harness.source], answerStatus: 'partial', verified: true, provenance: 'web_grounded' });
    await harness.ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    assert.equal(harness.renders[0].meta.answerStatus, 'partial');
    assert.equal(harness.renders[0].meta.verified, false);
    assert.equal(harness.renders[0].meta.sourceType, 'retrieved');
    assert.equal([...harness.rows.values()][0].dataset.answerStatus, 'partial');
});

test('regeneration preserves the prior response until a supported canonical replacement exists', async () => {
    let emit;
    let finish;
    const { ctx, source, renders, oldRow } = uiHarness({ replacement: true, stream: ({ onEvent }) => { emit = onEvent; return new Promise(resolve => { finish = resolve; }); } });
    const pending = ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    emit('sources', { sources: [source] });
    emit('token', { token: 'Unvalidated proposed answer [7]' });
    assert.equal(renders.length, 0);
    assert.equal(oldRow.textContent, 'The previous supported answer');
    assert.notEqual(oldRow.style.display, 'none');
    assert.equal(ctx.commitRegenerationCandidate(ctx.activeResponseRenderContext), false);
    finish({ content: 'The provider failed', answerStatus: 'unavailable', verified: false, sources: [source] });
    assert.equal(await pending, false);
    assert.equal(renders.length, 0);
    assert.equal(ctx.commitRegenerationCandidate(ctx.activeResponseRenderContext), false);
});

test('a supported canonical answer updates only the detached regeneration candidate before commit', async () => {
    let emit;
    let finish;
    const { ctx, source, renders, oldRow } = uiHarness({ replacement: true, stream: ({ onEvent }) => { emit = onEvent; return new Promise(resolve => { finish = resolve; }); } });
    const pending = ctx.handleBoundedLiveResearchQuery('Orbital telescope calibration');
    emit('token', { token: 'Provisional text' });
    assert.equal(renders.length, 0);
    finish({ content: 'The supported replacement. [7]', answerStatus: 'complete', verified: true, provenance: 'web_grounded', sources: [source] });
    assert.equal(await pending, true);
    assert.equal(renders[0].content, 'The supported replacement. [7]');
    assert.equal(ctx.activeResponseRenderContext.replacementCandidate.researchValidated, true);
    assert.equal(ctx.findAssistantMessageRow(renders[0].id), ctx.activeResponseRenderContext.replacementCandidate.messageDiv);
    assert.equal(oldRow.textContent, 'The previous supported answer');
    assert.notEqual(oldRow.style.display, 'none');
});

test('serialized partial answers retain status and citation IDs without gaining verification', () => {
    const { ctx } = uiHarness();
    ctx.chatSessions[0].messages.push({ role: 'assistant', text: 'Supported fact. [7]', answerStatus: 'partial', verified: true, sources: [{ id: 7, title: 'Source', url: 'https://example.com/reference' }] });
    const serialized = JSON.parse(JSON.stringify(ctx.compactChatSessionForStorage(ctx.chatSessions[0])));
    const restored = ctx.normalizeChatSession(serialized);
    assert.equal(restored.messages[1].answerStatus, 'partial');
    assert.equal(restored.messages[1].verified, false);
    assert.equal(restored.messages[1].sources[0].id, 7);
});

test('canonical completion rejects legacy verification guesses and accepts final-only citation IDs', async () => {
    const controller = new BoundedLiveResearchController();
    const result = await controller.execute({ query: 'orbital telescope calibration', researchStreamFn: async () => ({ content: 'A claimed answer [9]', provenance: 'web_grounded', verified: true, sources: [{ id: 9, title: 'Calibration', url: 'https://example.com/calibration' }] }) });
    assert.equal(result.answerStatus, 'unavailable');
    assert.equal(result.verified, false);
    assert.equal(result.success, false);
    assert.equal(result.sources[0].id, 9);
});

test('the SSE reader emits progress and canonical completion but ignores events after done', async () => {
    const original = globalThis.fetch;
    const events = [];
    const wire = [['status', { message: 'Reading primary sources' }], ['done', { content: 'Supported. [1]', answerStatus: 'complete', verified: true }], ['token', { token: 'late' }]];
    globalThis.fetch = async () => new Response(wire.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } });
    try {
        const result = await streamResearchRequest('/api/search', { query: 'calibration' }, { onEvent: event => events.push(event) });
        assert.equal(result.answerStatus, 'complete');
        assert.deepEqual(events, ['status', 'done']);
    } finally { globalThis.fetch = original; }
});

});

describe('Research Retrieval & Extraction', () => {

function ddgHtml(items) {
    return items.map(item => `<a class="result__a" href="${item.url}">${item.title}</a><a class="result__snippet">${item.snippet || item.title}</a>`).join('\n');
}

async function withProviders(fetcher, run) {
    const original = globalThis.fetch;
    const previous = Object.fromEntries(['SEARXNG_URL', 'SEARCH_CIRCUIT_BREAKER', 'CRAWL4AI_URL'].map(key => [key, process.env[key]]));
    process.env.SEARXNG_URL = 'https://search-provider.test/search';
    process.env.SEARCH_CIRCUIT_BREAKER = 'false';
    delete process.env.CRAWL4AI_URL;
    globalThis.fetch = fetcher;
    clearExtractorCaches();
    try { return await run(); }
    finally {
        globalThis.fetch = original;
        clearExtractorCaches();
        for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    }
}

test('general indexes return relevant originals before any supplementary news request', async () => {
    const seen = [];
    const items = [1, 2].map(i => ({ title: `Orbital telescope calibration instrument reference ${i}`, url: `https://science${i}.test/calibration`, snippet: 'Orbital telescope calibration measures reference stars and instrument response.' }));
    await withProviders(async url => {
        seen.push(String(url));
        if (String(url).includes('html.duckduckgo.com')) return new Response(ddgHtml(items));
        return Response.json({});
    }, async () => {
        const results = await searchResearchSources('orbital telescope calibration', { timeoutMs: 1200 });
        assert.equal(results.length, 2);
        assert.ok(results.every(source => source.sourceType === 'live_web'));
        assert.ok(!seen.some(url => /news\.google|news\.yahoo|gdelt|serper|exa|generativelanguage/.test(url)));
    });
});

test('blocked general providers fall through to news and preserve publisher identity', async () => {
    const seen = [];
    const diagnostics = [];
    const rss = '<rss><channel><item><title>Three people travel without a passport - Royal Publisher</title><link>https://news.google.com/rss/articles/opaque-fixture</link><source url="https://royal.test">Royal Publisher</source><description>The report identifies three people who travel without a passport.</description></item></channel></rss>';
    await withProviders(async url => {
        seen.push(String(url));
        if (String(url).includes('news.google.com/rss/search')) return new Response(rss);
        if (/duckduckgo|search-provider/.test(String(url))) return new Response('Quota exceeded', { status: 429 });
        return Response.json({});
    }, async () => {
        const results = await searchResearchSources('three people travel without a passport', { timeoutMs: 1200, onDiagnostic: item => diagnostics.push(item) });
        const source = results.find(item => item.publisher === 'Royal Publisher');
        assert.ok(source);
        assert.equal(source.publisherDomain, 'royal.test');
        assert.equal(source.domain, 'royal.test');
        assert.equal(source.discoveryUrl, source.url);
        assert.ok(seen.findIndex(url => url.includes('news.google.com')) > seen.findIndex(url => url.includes('duckduckgo')));
        assert.ok(diagnostics.some(item => item.reason === 'http_429'));
    });
});

test('a conceptual Next.js explanation prioritizes official docs and excludes retailer and incident pages', async () => {
    const seen = [];
    const items = [
        { title: 'Next Official Site: clothes and homeware', url: 'https://www.next.co.uk/', snippet: 'Shop clothes in the Next app.' },
        { title: 'React Server Components vulnerability enables remote code execution in Next.js', url: 'https://security.test/rce', snippet: 'React Server Components in Next.js vulnerability advisory.' },
        { title: 'Server and Client Components | Next.js', url: 'https://nextjs.org/docs/app/getting-started/server-and-client-components', snippet: 'React Server Components in Next.js render components on the server.' },
        { title: 'React Server Components explained in Next.js', url: 'https://developer.test/next', snippet: 'An explanation of React Server Components in Next.js.' }
    ];
    await withProviders(async url => {
        seen.push(String(url));
        if (String(url).includes('html.duckduckgo.com')) return new Response(ddgHtml(items));
        return Response.json({});
    }, async () => {
        assert.equal(isTechnicalDocumentationQuery('What are React Server Components in Next.js?'), true);
        assert.equal(isTechnicalDocumentationQuery('Latest Next.js security news'), false);
        const results = await searchResearchSources('What are React Server Components in Next.js?', { timeoutMs: 1200 });
        assert.equal(new URL(results[0].url).hostname, 'nextjs.org');
        assert.ok(!results.some(source => /next\.co\.uk|security\.test/.test(source.url)));
        assert.ok(!seen.some(url => /news\.google|news\.yahoo|gdelt/.test(url)));
    });
});

test('failed opaque wrapper decoding recovers the exact article on its publisher and reads its body', async () => {
    const source = { title: 'Three people travel without a passport - Royal Publisher', url: 'https://news.google.com/rss/articles/recovery-fixture', domain: 'royal.test', publisher: 'Royal Publisher' };
    const direct = 'https://royal.test/features/passport-travel';
    const queries = [];
    await withProviders(async (url, init) => {
        if (String(url).includes('html.duckduckgo.com')) {
            queries.push(new URL(url).searchParams.get('q'));
            return new Response(ddgHtml([{ title: 'Three people travel without a passport', url: direct }]));
        }
        if (String(url) === direct) return new Response('<title>Three people travel without a passport</title><article><p>The passport travel report identifies three people who use special international arrangements.</p><ul><li>Fixture Monarch</li><li>Fixture Emperor</li><li>Fixture Empress</li></ul><p>The special arrangements do not mean unrestricted entry to every country in the world.</p></article>');
        if (String(url).includes('news.google.com/rss/articles')) return new Response('<html>No decode attributes</html>');
        return Response.json({});
    }, async () => {
        const article = await crawlArticleBody(source.url, { source, query: 'three people travel without a passport', timeoutMs: 2000 });
        assert.ok(article);
        assert.equal(article.url, direct);
        assert.equal(article.publisherDomain, 'royal.test');
        assert.equal(article.discoveryUrl, source.url);
        assert.match(article.bodyText, /Fixture Empress/);
        assert.ok(queries.some(query => query === '"Three people travel without a passport" site:royal.test'));
    });
});

test('publisher recovery does not use a similar title on another publisher', async () => {
    const source = { title: 'Three people travel without a passport', url: 'https://news.google.com/rss/articles/wrong-fixture', publisher: 'Royal Publisher', publisherDomain: 'royal.test' };
    assert.equal(buildPublisherRecoveryQuery(source), '"Three people travel without a passport" site:royal.test');
    assert.equal(isMatchingPublisherArticle({ title: source.title, url: 'https://other.test/copy' }, source), false);
    await withProviders(async url => String(url).includes('html.duckduckgo.com') ? new Response(ddgHtml([{ title: source.title, url: 'https://other.test/copy' }])) : Response.json({}), async () => {
        assert.equal(await recoverPublisherArticleUrl(source, { timeoutMs: 500 }), '');
    });
    assert.equal(preserveDiscoveryMetadata(source).publisherDomain, 'royal.test');
});

test('a single factual passage and short adjacent names are retained without accepting unrelated numeric entities', () => {
    const article = extractArticleFromHtml('<title>Passport travel arrangements</title><article><p>Three people can travel without a passport using special arrangements for official visits.</p><ul><li>Fixture Monarch</li><li>Fixture Emperor</li><li>Fixture Empress</li></ul></article>', 'https://royal.test/facts', '3 persons can travel without a passport');
    assert.ok(article);
    for (const name of ['Fixture Monarch', 'Fixture Emperor', 'Fixture Empress']) assert.match(article.bodyText, new RegExp(name));
    assert.equal(isParagraphRelevant('In 2025, Kazakhstan Bridge opened for regular traffic in Central Asia.', ['passport', 'travel']), false);
    const alias = extractArticleFromHtml('<title>United States inflation</title><article><p>United States inflation measures changes in consumer prices over a period of time.</p></article>', 'https://economy.test/data', 'U.S. inflation');
    assert.ok(alias);
});

test('provider deadline cancels real pending requests and cannot add late discovery results', async () => {
    let aborted = 0;
    const diagnostics = [];
    await withProviders((url, init) => new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => { aborted++; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
    }), async () => {
        const started = Date.now();
        const result = await searchResearchSources('orbital telescope calibration', { timeoutMs: 120, onDiagnostic: item => diagnostics.push(item) });
        assert.deepEqual(result, []);
        assert.ok(Date.now() - started < 500);
        assert.ok(aborted > 0);
        const count = diagnostics.length;
        await new Promise(resolve => setTimeout(resolve, 20));
        assert.equal(diagnostics.length, count);
    });
});

test('comparisons discover each subject and require the requested attribute in retained sources', async () => {
    const query = 'Compare the population of the U.S. and Canada.';
    assert.deepEqual(buildComparisonSearchQueries(query), ['United States population', 'Canada population']);
    assert.equal(matchesComparisonAttribute(query, { title: 'How does U.S. life expectancy compare with Canada?' }), false);
    const searched = [];
    await withProviders(async (url, init) => {
        if (String(url).includes('html.duckduckgo.com')) {
            const candidate = new URL(url).searchParams.get('q');
            searched.push(candidate);
            const items = candidate === 'United States population'
                ? [{ title: 'United States population estimates', url: 'https://www.census.gov/quickfacts/US', snippet: 'United States population estimates cover the resident population.' }]
                : candidate === 'Canada population'
                    ? [{ title: 'Canada population estimates', url: 'https://www.statcan.gc.ca/population', snippet: 'Canada population estimates are measured every quarter.' }]
                    : [{ title: 'How does U.S. life expectancy compare to Canada?', url: 'https://health.test/life-expectancy', snippet: 'United States and Canada life expectancy in the latest report.' }];
            return new Response(ddgHtml(items));
        }
        return Response.json({});
    }, async () => {
        const sources = await searchResearchSources(query, { timeoutMs: 1000 });
        assert.ok(searched.includes('United States population'));
        assert.ok(searched.includes('Canada population'));
        assert.equal(sources.length, 2);
        assert.ok(sources.every(source => !source.url.includes('health.test')));
    });
});

test('large HTML responses retain bounded opening evidence instead of discarding the entire page', async () => {
    const body = '<html><title>United States population</title><main><p>The United States population estimate is based on census counts and demographic changes.</p>' + '<div>' + 'Background formatting data. '.repeat(110000) + '</div></main></html>';
    await withProviders(async () => new Response(body, { headers: { 'content-type': 'text/html', 'content-length': String(Buffer.byteLength(body)) } }), async () => {
        const article = await crawlArticleResilient('https://statistics.test/demographics', 'Compare the population of the U.S. and Canada.', { timeoutMs: 1000 });
        assert.ok(article);
        assert.equal(article.truncated, true);
        assert.match(article.bodyText, /United States population estimate/);
        assert.ok(article.bodyText.length < 12000);
    });
});

});

describe('Research Engine HTTP & Providers', () => {

const question = 'Compare U.S. and Canada population';
const us = 'The United States population was 340 million in the fixture census. The population estimate covers residents in all states.';
const canada = 'Canada population was 41 million in the fixture census. This population estimate covers residents across the country.';
const record = (country, text) => ({ title: `${country} population census`, url: `https://census.example/${country}`, snippet: text });
const fact = (requirementId, value, sourceId, quote) => ({ id: requirementId, requirementId, value, sourceId, quote });
const keys = { customGroqKey: 'http-fixture-groq', customGeminiKey: 'http-fixture-gemini' };

test('two real provider generations parse JSON, search a precise gap, and stop at four HTTP attempts', async () => {
    clearResearchModelHealth();
    const original = globalThis.fetch;
    const requests = [];
    const searches = [];
    globalThis.fetch = async (url, init) => {
        const request = JSON.parse(init.body);
        requests.push(request);
        if (String(url).includes('api.groq.com')) return new Response('invalid request', { status: 400 });
        const input = JSON.parse(request.contents[0].parts[0].text);
        const usId = Number(input.sourceExcerpts.match(/\[(\d+)\] United States/)?.[1]);
        const caId = Number(input.sourceExcerpts.match(/\[(\d+)\] Canada/)?.[1]);
        const data = { facts: [fact('r1', us, usId, us)], gaps: [{ requirementId: 'r2', detail: 'Canada population census value', query: 'Canada population census' }] };
        if (caId) { data.facts.push(fact('r2', canada, caId, canada)); data.gaps = []; }
        return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] }, finishReason: 'STOP' }] });
    };
    try {
        const result = await runResearch(question, { ...keys, timeoutMs: 45000 }, {
            search: async q => { searches.push(q); return searches.length === 1 ? [record('United States', us)] : [record('Canada', canada)]; },
            extract: async url => ({ url, bodyText: url.includes('Canada') ? canada : us })
        });
        assert.equal(result.answerStatus, 'complete', JSON.stringify({ facts: result.facts, coverage: result.research.coverage, diagnostics: result.research.diagnostics }));
        assert.equal(result.verified, true);
        assert.equal(result.research.modelGenerations, 2);
        assert.equal(result.research.modelCalls, 4);
        assert.equal(requests.length, 4);
        assert.deepEqual(result.research.modelAttempts.map(a => a.outcome), ['http_400', 'success', 'http_400', 'success']);
        assert.ok(searches.slice(1).some(q => /Canada.*population/i.test(q)));
        assert.match(result.content, /340 million/);
        assert.match(result.content, /41 million/);
        assert.ok(result.facts.every(f => result.sources.some(s => s.id === f.sourceId && s.fullArticleText.includes(f.quote))));
        assert.ok(!JSON.stringify(result.research).includes('http-fixture-'));
        for (const request of requests) assert.ok(!request.tools);
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('real 429 responses exhaust available credentials honestly without model-memory fallback', async () => {
    clearResearchModelHealth();
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => { calls++; return new Response('quota exceeded', { status: 429, headers: { 'retry-after': '60' } }); };
    try {
        const result = await runResearch(question, { ...keys, timeoutMs: 2000 }, {
            search: async () => [record('United States', us)], extract: async url => ({ url, bodyText: us })
        });
        assert.equal(calls, 2);
        assert.equal(result.answerStatus, 'unavailable');
        assert.equal(result.verified, false);
        assert.equal(result.facts.length, 0);
        assert.deepEqual(result.research.modelAttempts.map(a => a.outcome), ['rate_limited', 'rate_limited']);
        assert.ok(result.research.modelAttempts.every(a => a.stage === 'final_answer'));
        assert.match(result.content, /temporarily unavailable/);
        assert.ok(result.sources.length > 0);
        assert.ok(!JSON.stringify(result.research).includes('http-fixture-'));
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

test('an HTTP-successful but invented quote cannot become a verified answer', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () => Response.json({ choices: [{ message: { content: JSON.stringify({ facts: [fact('r1', 'Invented population is 900 million.', 1, 'Invented population is 900 million.')] }) }, finish_reason: 'stop' }] });
    try {
        const result = await runResearch(question, { customGroqKey: keys.customGroqKey, timeoutMs: 2000 }, {
            search: async () => [record('United States', us)], extract: async url => ({ url, bodyText: us })
        });
        assert.equal(result.answerStatus, 'unavailable');
        assert.equal(result.verified, false);
        assert.ok(!result.content.includes('900 million'));
        assert.ok(result.research.warnings.includes('unsupported_answer_facts'));
        assert.ok(result.research.diagnostics.some(d => d.reason === 'unsupported_quote'));
    } finally { globalThis.fetch = original; clearResearchModelHealth(); }
});

});

