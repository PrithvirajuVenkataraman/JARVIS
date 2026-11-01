import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import handler, { isDirectPrimarySource, isValidCitationSource, enrichSearchResultsWithDeepCrawl, buildDeterministicSearchQueries, searchGeminiGrounding } from '../api/search.js';
import { runResearch, deterministicResearchPlan, cachedResearchSearch, planResearch } from '../api/_lib/research-engine.js';
import { normalizeEvidence, assessSourceRelevance, evaluateResearchCoverage, rankResearchEvidence, selectResearchExcerpt, formatResearchEvidence } from '../api/_lib/research-evidence.js';
import { normalizeResearchSources, BoundedLiveResearchController } from '../app/bounded-live-research.js';
import { streamResearchRequest } from '../app/search/research-stream.mjs';
import { clearExtractorCaches, crawlArticleResilient, extractArticleFromHtml } from '../api/_lib/article-extractor.js';
import { normalizeCrawl4AiResult } from '../api/_lib/crawl4ai-client.js';
import { isPublicWebUrl } from '../api/_lib/public-web-url.js';
import { callResearchModel } from '../api/_lib/research-model.js';

const query = 'orbital telescope calibration';
const paragraph = 'The orbital telescope calibration uses a reference star to measure detector response. Researchers repeat the telescope calibration before each orbital observation to reduce measurement uncertainty.';
const articleHtml = `<html><title>Orbital telescope calibration</title><article><p>${paragraph}</p><p>The orbital telescope calibration also checks the optics against a second independent instrument. The calibration measurements and telescope settings are published with each observation.</p></article></html>`;
const source = (extra = {}) => ({ title: 'Orbital telescope calibration', url: 'https://science.example.com/calibration', snippet: 'Orbital telescope calibration research', sourceType: 'live_web', ...extra });
const plan = () => ({ query, originalQuery: query, queries: [query], facets: [query], ambiguous: false });
const deps = (extra = {}) => ({ plan: async () => plan(), review: async () => null, search: async () => [source()], extract: async () => ({ bodyText: paragraph, url: source().url }), synthesize: async ({ onToken }) => { const answer = 'The orbital telescope calibration uses a reference star and repeated detector measurements. [1]'; onToken?.(answer); return answer; }, ...extra });

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

test('missing evidence causes actual follow-up searches before synthesis', async () => {
    const searched = [];
    let writes = 0;
    const result = await runResearch(query, { timeoutMs: 8000 }, deps({
        search: async q => { searched.push(q); return [source({ url: `https://science.example.com/calibration-${searched.length}` })]; },
        extract: async () => ++writes === 1 ? null : { bodyText: paragraph, url: source().url },
        review: async () => writes === 1 ? { sufficient: false, gaps: ['detector reference measurements'], queries: ['orbital telescope calibration detector reference measurements'] } : { sufficient: true, gaps: [] }
    }));
    assert.equal(searched.length, 2);
    assert.ok(searched[1].includes('reference'));
    assert.equal(result.research.rounds, 2);
    assert.equal(result.provenance, 'web_grounded');
});

test('research reads discovered same-origin references to fill an evidence gap', async () => {
    const read = [];
    const result = await runResearch(query, { timeoutMs: 8000 }, deps({
        extract: async url => { read.push(url); return { bodyText: paragraph, url, links: [{ title: 'Orbital telescope calibration instrument reference', url: 'https://science.example.com/reference' }] }; },
        review: async () => ({ sufficient: read.length >= 2, gaps: read.length >= 2 ? [] : ['instrument reference'], queries: [] })
    }));
    assert.ok(read.includes('https://science.example.com/reference'));
    assert.equal(result.research.coverage.sufficient, true);
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

test('synthesis failure preserves cited evidence and never falls back to model memory', async () => {
    const result = await runResearch(query, { timeoutMs: 4000 }, deps({ synthesize: async () => null }));
    assert.equal(result.provenance, 'synthesis_fallback');
    assert.match(result.content, /reference star/);
    assert.match(result.content, /\[1\]/);
});

test('invented source IDs and uncited synthesized answers are rejected', async () => {
    const result = await runResearch(query, { timeoutMs: 4000 }, deps({ synthesize: async () => 'Unsupported asserted answer. [99]' }));
    assert.ok(!result.content.includes('[99]'));
    assert.equal(result.provenance, 'synthesis_fallback');
    assert.ok(result.research.warnings.includes('missing_claim_citations'));
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
    globalThis.fetch = async () => sseResponse([['status', { message: 'Reading…' }], ['sources', { sources: [{ ...source(), id: 4 }] }], ['token', { token: '測定 [4]' }], ['done', { success: true, content: '測定 [4]', provenance: 'web_grounded' }]], true);
    try { const result = await streamResearchRequest('/api/search', {}, { onEvent() {} }); assert.equal(result.content, '測定 [4]'); }
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
    const result = await controller.execute({ query, researchStreamFn: async ({ onEvent }) => { await new Promise(r => setTimeout(r, 30)); onEvent('sources', { sources: [{ ...source({ snippet: paragraph }), id: 7 }] }); onEvent('token', { token: 'Supported answer. [7]' }); const final = { content: 'Supported answer. [7]', success: true, provenance: 'web_grounded' }; onEvent('done', final); return final; }, uiCallbacks: { onComplete() { completed++; } } });
    assert.equal(result.provenance, 'web_grounded');
    assert.equal(result.sources[0].id, 7);
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
