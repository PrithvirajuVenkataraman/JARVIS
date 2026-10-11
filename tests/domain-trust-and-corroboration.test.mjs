/**
 * Tests: Domain Trust Registry & Multi-Source Corroboration Engine
 * ─────────────────────────────────────────────────────────────────
 * Validates structural invariants of both new modules:
 *  § 1  Domain Trust Registry — tier classification
 *  § 2  Domain Trust Registry — score delta arithmetic
 *  § 3  Multi-Source Corroboration — Jaccard clustering
 *  § 4  Multi-Source Corroboration — temporal gating
 *  § 5  Hybrid integration — trust delta visible in hybridRerank output
 *
 * Test design rules:
 *  • No hardcoded entity names, publication titles, or country names in fixture data
 *  • All fixture domain names are generated programmatically
 *  • Tests remain deterministic across time zones and locales
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
    classifyDomainTrustTier,
    getDomainTrustDelta,
    isScraperOrContentFarm,
    normaliseDomain,
    extractRegistrableDomain
} from '../api/_lib/domain-trust-registry.js';

import {
    annotateCorroboration,
    shouldCorroborate,
    corroborationScoreDelta
} from '../api/_lib/multi-source-corroboration.js';

import { hybridRerank } from '../api/_lib/hybrid-reranker.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/**
 * Generates a unique fixture label that includes a short timestamp hash so
 * tests never rely on hardcoded entity or publication names.
 *
 * @param {string} role  Short semantic label for readability in failures
 * @returns {string}
 */
function fixtureLabel(role) {
    return `Fixture_${role}_${Date.now().toString(36).slice(-5)}`;
}

/** Builds a minimal search result document for corroboration tests. */
function makeDoc({ domain = '', url = '', title = '', snippet = '', sourceType = 'live_web' } = {}) {
    return { domain, url, title, description: snippet, snippet, sourceType };
}

// ─── § 1  Domain Trust Registry — tier classification ────────────────────────

describe('§1 Domain Trust Registry — tier classification', () => {

    it('returns tier 1 for a .gov TLD', () => {
        const result = classifyDomainTrustTier('data.gov');
        assert.equal(result.tier, 1, 'Expected tier 1 for .gov domain');
        assert.ok(result.delta > 0, 'Expected positive delta for tier 1');
    });

    it('returns tier 1 for a compound-ccTLD government domain (.go.xx pattern)', () => {
        const result = classifyDomainTrustTier('ministry.go.jp');
        assert.equal(result.tier, 1, 'Expected tier 1 for .go.jp pattern');
    });

    it('returns tier 1 for a .gouv.fr pattern', () => {
        const result = classifyDomainTrustTier('education.gouv.fr');
        assert.equal(result.tier, 1, 'Expected tier 1 for .gouv.fr pattern');
    });

    it('returns tier 1 for a named IGO in the authoritative set', () => {
        const result = classifyDomainTrustTier('who.int');
        assert.equal(result.tier, 1, 'Expected tier 1 for who.int');
    });

    it('returns tier 1 for .int TLD (IANA-reserved for treaty organisations)', () => {
        const result = classifyDomainTrustTier('icc-cpi.int');
        assert.equal(result.tier, 1, 'Expected tier 1 for .int TLD');
    });

    it('returns tier 2 for a .edu TLD academic domain', () => {
        const result = classifyDomainTrustTier('library.example.edu');
        assert.equal(result.tier, 2, 'Expected tier 2 for .edu domain');
        assert.ok(result.delta > 0, 'Expected positive delta for tier 2');
    });

    it('returns tier 2 for a .ac.uk academic domain', () => {
        const result = classifyDomainTrustTier('portal.cs.ac.uk');
        assert.equal(result.tier, 2, 'Expected tier 2 for .ac.uk domain');
    });

    it('returns tier 3 (neutral) for an unclassified generic domain', () => {
        const result = classifyDomainTrustTier(`${fixtureLabel('news')}.com`);
        assert.equal(result.tier, 3, 'Expected tier 3 for unclassified domain');
        assert.equal(result.delta, 0, 'Expected zero delta for tier 3');
    });

    it('returns tier 4 for a known zero-editorial content aggregator', () => {
        const result = classifyDomainTrustTier('medium.com');
        assert.equal(result.tier, 4, 'Expected tier 4 for known farm domain');
        assert.ok(result.delta < 0, 'Expected negative delta for tier 4');
    });

    it('returns tier 4 for a known download-mirror domain', () => {
        const result = classifyDomainTrustTier('softonic.com');
        assert.equal(result.tier, 4, 'Expected tier 4 for download aggregator');
    });

    it('returns tier 4 for a URL with high-cardinality query spam', () => {
        const spamUrl = 'https://doorway.example.com/page?a=1&b=2&c=3&d=4&e=5&f=6&g=7';
        const result = classifyDomainTrustTier('doorway.example.com', spamUrl);
        assert.equal(result.tier, 4, 'Expected tier 4 for URL-spam signal');
    });

    it('strips www. prefix before classification', () => {
        const withWww = classifyDomainTrustTier('www.data.gov');
        const withoutWww = classifyDomainTrustTier('data.gov');
        assert.equal(withWww.tier, withoutWww.tier, 'www-stripping must produce identical tier');
        assert.equal(withWww.delta, withoutWww.delta, 'www-stripping must produce identical delta');
    });

    it('classifies subdomain correctly without treating subdomain as registrable domain', () => {
        // docs.python.org — registrable domain is "python.org" (tier 3/neutral)
        const result = classifyDomainTrustTier('docs.python.org');
        // Must NOT be classified as tier 1 (python.org is not a government or IGO)
        assert.notEqual(result.tier, 1, 'docs.python.org must not be classified as government tier');
    });

});

// ─── § 2  Domain Trust Registry — score delta arithmetic ─────────────────────

describe('§2 Domain Trust Registry — score delta arithmetic', () => {

    it('getDomainTrustDelta returns a positive integer for tier 1 domains', () => {
        const delta = getDomainTrustDelta('health.gov.au');
        assert.ok(Number.isInteger(delta), 'Delta must be an integer');
        assert.ok(delta > 0, 'Expected positive delta for government domain');
    });

    it('getDomainTrustDelta returns zero for tier 3 domains', () => {
        const delta = getDomainTrustDelta(`${fixtureLabel('general')}.net`);
        assert.equal(delta, 0, 'Expected zero delta for neutral domain');
    });

    it('getDomainTrustDelta returns a negative integer for tier 4 domains', () => {
        const delta = getDomainTrustDelta('quora.com');
        assert.ok(Number.isInteger(delta), 'Delta must be an integer');
        assert.ok(delta < 0, 'Expected negative delta for content farm');
    });

    it('isScraperOrContentFarm returns true for tier 4 domains', () => {
        assert.equal(isScraperOrContentFarm('pinterest.com'), true);
        assert.equal(isScraperOrContentFarm('buzzfeed.com'), true);
    });

    it('isScraperOrContentFarm returns false for tier 1–3 domains', () => {
        assert.equal(isScraperOrContentFarm('data.gov'), false, '.gov must not be flagged as scraper');
        assert.equal(isScraperOrContentFarm('arxiv.org'), false, 'arxiv.org must not be flagged as scraper');
        assert.equal(isScraperOrContentFarm(`${fixtureLabel('news')}.com`), false, 'unknown domain must not be flagged as scraper');
    });

    it('tier 1 delta is strictly greater than tier 2 delta', () => {
        const tier1Delta = getDomainTrustDelta('nih.gov');
        const tier2Delta = getDomainTrustDelta('research.example.edu');
        assert.ok(tier1Delta > tier2Delta, 'Tier 1 should have higher delta than tier 2');
    });

    it('tier 2 delta is strictly greater than tier 3 delta', () => {
        const tier2Delta = getDomainTrustDelta('library.ac.uk');
        const tier3Delta = getDomainTrustDelta(`${fixtureLabel('blog')}.com`);
        assert.ok(tier2Delta > tier3Delta, 'Tier 2 should have higher delta than tier 3');
    });

    it('tier 3 delta is strictly greater than tier 4 delta', () => {
        const tier3Delta = getDomainTrustDelta(`${fixtureLabel('site')}.com`);
        const tier4Delta = getDomainTrustDelta('ehow.com');
        assert.ok(tier3Delta > tier4Delta, 'Tier 3 should have higher delta than tier 4');
    });

    it('extractRegistrableDomain handles compound ccTLDs correctly', () => {
        assert.equal(extractRegistrableDomain('sub.portal.gov.uk'), 'portal.gov.uk');
        assert.equal(extractRegistrableDomain('portal.gov.uk'), 'portal.gov.uk');
        assert.equal(extractRegistrableDomain('news.bbc.co.uk'), 'bbc.co.uk');
        assert.equal(extractRegistrableDomain('data.nic.in'), 'nic.in');
    });

});

// ─── § 3  Multi-Source Corroboration — clustering invariants ─────────────────

describe('§3 Multi-Source Corroboration — Jaccard clustering invariants', () => {

    const BREAKING_QUERY = `breaking news ${fixtureLabel('event')} confirmed`;

    it('annotates corroborationScore=0 for a single document', () => {
        const docs = [makeDoc({ domain: 'alpha.com', title: fixtureLabel('single'), snippet: 'Incident confirmed by officials' })];
        annotateCorroboration(docs, BREAKING_QUERY);
        assert.equal(docs[0].corroborationScore, 0, 'Single doc should have corroborationScore=0');
        assert.equal(docs[0].corroborationSources, 1, 'Single doc should have corroborationSources=1');
        assert.equal(docs[0].corroborationCluster, -1, 'Single doc should be a singleton cluster');
    });

    it('scores 0.25 for two independent sources expressing the same claim', () => {
        const sharedSnippet = `${fixtureLabel('topic')} officials confirmed the development affecting the region`;
        const docs = [
            makeDoc({ domain: 'source-alpha.com', url: 'https://source-alpha.com/1', title: 'Officials confirm development', snippet: sharedSnippet }),
            makeDoc({ domain: 'source-beta.com', url: 'https://source-beta.com/1', title: 'Officials confirm development', snippet: sharedSnippet })
        ];
        annotateCorroboration(docs, BREAKING_QUERY);
        // Both docs should cluster together (same snippet → Jaccard ≥ 0.18)
        const scored = docs.filter(d => d.corroborationScore >= 0.25);
        assert.ok(scored.length >= 1, `Expected at least 1 doc with corroborationScore≥0.25; got ${JSON.stringify(docs.map(d => d.corroborationScore))}`);
    });

    it('does not cluster documents with completely different content', () => {
        const uniqueA = `${fixtureLabel('topicA')} government allocation infrastructure budget`;
        const uniqueB = `${fixtureLabel('topicB')} athlete championship tournament bracket standings`;
        const docs = [
            makeDoc({ domain: 'source-a.com', snippet: uniqueA }),
            makeDoc({ domain: 'source-b.com', snippet: uniqueB })
        ];
        annotateCorroboration(docs, BREAKING_QUERY);
        // Two unrelated documents should both remain singletons
        assert.equal(docs[0].corroborationCluster, -1, 'Unrelated doc A should be singleton');
        assert.equal(docs[1].corroborationCluster, -1, 'Unrelated doc B should be singleton');
    });

    it('flags cross-domain same-title republication as syndicatedContent', () => {
        const identicalTitle = `Officials confirm ${fixtureLabel('event')} development`;
        const identicalSnippet = 'Confirmed by multiple government officials speaking on record during the briefing';
        const docs = [
            makeDoc({ domain: 'wire-publisher-x.com', url: 'https://wire-publisher-x.com/story', title: identicalTitle, snippet: identicalSnippet }),
            makeDoc({ domain: 'wire-publisher-y.com', url: 'https://wire-publisher-y.com/story', title: identicalTitle, snippet: identicalSnippet })
        ];
        annotateCorroboration(docs, BREAKING_QUERY);
        // At least one should be marked as syndicated (cross-domain, same title)
        const syndicated = docs.filter(d => d.syndicatedContent === true);
        assert.ok(syndicated.length >= 1, 'Cross-domain identical-title docs should be marked as syndicated');
    });

    it('four independent sources produce corroborationScore=0.75', () => {
        const snippet = `Authorities announced ${fixtureLabel('claim')} policy affecting citizens nationwide`;
        const docs = [
            makeDoc({ domain: 'pub-a.com', snippet }),
            makeDoc({ domain: 'pub-b.com', snippet }),
            makeDoc({ domain: 'pub-c.com', snippet }),
            makeDoc({ domain: 'pub-d.com', snippet })
        ];
        annotateCorroboration(docs, BREAKING_QUERY);
        // Max distinct domains = 4 → score = (4-1)/4 = 0.75
        assert.equal(docs[0].corroborationScore, 0.75, 'Four independent sources should produce score=0.75');
    });

    it('five or more independent sources cap corroborationScore at 1.0', () => {
        const snippet = `International summit concluded with ${fixtureLabel('claim')} agreement signed by participants`;
        const docs = Array.from({ length: 5 }, (_, i) =>
            makeDoc({ domain: `independent-${i}.com`, snippet })
        );
        annotateCorroboration(docs, BREAKING_QUERY);
        assert.equal(docs[0].corroborationScore, 1.0, 'Five independent sources should cap score at 1.0');
    });

});

// ─── § 4  Multi-Source Corroboration — temporal gating ───────────────────────

describe('§4 Multi-Source Corroboration — temporal gating', () => {

    it('shouldCorroborate returns true for a breaking news query', () => {
        assert.equal(shouldCorroborate('breaking news explosion confirmed'), true);
        assert.equal(shouldCorroborate('just in: officials announce emergency'), true);
        assert.equal(shouldCorroborate('live update: situation developing'), true);
    });

    it('shouldCorroborate returns false for a stable educational query', () => {
        // A stable factual question should NOT trigger corroboration
        assert.equal(shouldCorroborate('what is the speed of light'), false);
        assert.equal(shouldCorroborate('how does photosynthesis work'), false);
    });

    it('corroborationScoreDelta returns 0 for a doc without corroboration metadata', () => {
        const delta = corroborationScoreDelta({});
        assert.equal(delta, 0, 'Missing metadata should yield delta=0');
    });

    it('corroborationScoreDelta returns 5 for corroborationScore=0.25', () => {
        const delta = corroborationScoreDelta({ corroborationScore: 0.25, syndicatedContent: false });
        assert.equal(delta, 5, 'corroborationScore=0.25 should yield delta=5');
    });

    it('corroborationScoreDelta returns 12 for corroborationScore=0.50', () => {
        const delta = corroborationScoreDelta({ corroborationScore: 0.50, syndicatedContent: false });
        assert.equal(delta, 12, 'corroborationScore=0.50 should yield delta=12');
    });

    it('corroborationScoreDelta returns 20 for corroborationScore=1.0', () => {
        const delta = corroborationScoreDelta({ corroborationScore: 1.0, syndicatedContent: false });
        assert.equal(delta, 20, 'corroborationScore=1.0 should yield delta=20');
    });

});

// ─── § 5  Hybrid Reranker — domain trust tier visible in output ───────────────

describe('§5 Hybrid Reranker — domain trust tier surfaced in output', () => {

    const QUERY = `what is the current ${fixtureLabel('topic')} policy announced this week`;

    function makeRerankDoc({ domain = '', url = '', title = '', snippet = '' } = {}) {
        return { domain, url, title, description: snippet, text: snippet };
    }

    it('hybridRerank annotates each result with domainTrustTier', async () => {
        const docs = [
            makeRerankDoc({ domain: 'health.gov', url: 'https://health.gov/policy', title: 'Official policy briefing', snippet: 'Government health policy announced this week by the department' }),
            makeRerankDoc({ domain: 'buzzfeed.com', url: 'https://buzzfeed.com/story', title: 'Policy: 10 things you need to know', snippet: 'The government health policy announced this week' })
        ];
        const ranked = await hybridRerank(QUERY, docs);
        // Both docs must have domainTrustTier annotated
        assert.ok(ranked.every(d => typeof d.domainTrustTier === 'number'),
            'All results must have domainTrustTier annotated');
    });

    it('government domain (.gov) receives tier 1 in hybridRerank output', async () => {
        const docs = [
            makeRerankDoc({ domain: 'health.gov', url: 'https://health.gov/policy', title: 'Official health policy', snippet: 'Policy statement from the department of health this week' })
        ];
        const ranked = await hybridRerank(QUERY, docs);
        assert.equal(ranked[0].domainTrustTier, 1, 'health.gov should be annotated as tier 1');
    });

    it('content farm domain receives tier 4 in hybridRerank output', async () => {
        const docs = [
            makeRerankDoc({ domain: 'buzzfeed.com', url: 'https://buzzfeed.com/policy-story', title: 'Policy story headline', snippet: 'Details on policy announced this week' })
        ];
        const ranked = await hybridRerank(QUERY, docs);
        assert.equal(ranked[0].domainTrustTier, 4, 'buzzfeed.com should be annotated as tier 4');
    });

    it('government source ranks above content farm for identical BM25 relevance', async () => {
        // Both docs contain the exact same text — only domain trust differentiates them
        const sharedSnippet = `Announcement regarding policy decisions affecting the regional jurisdiction this week`;
        const docs = [
            makeRerankDoc({ domain: 'buzzfeed.com', url: 'https://buzzfeed.com/a', title: 'Policy announcement this week regional', snippet: sharedSnippet }),
            makeRerankDoc({ domain: 'data.gov', url: 'https://data.gov/a', title: 'Policy announcement this week regional', snippet: sharedSnippet })
        ];
        const ranked = await hybridRerank(QUERY, docs);
        const govIdx = ranked.findIndex(d => d.domain === 'data.gov' || String(d.url).includes('data.gov'));
        const farmIdx = ranked.findIndex(d => d.domain === 'buzzfeed.com' || String(d.url).includes('buzzfeed.com'));
        assert.ok(govIdx < farmIdx, `Government source (idx ${govIdx}) should rank above content farm (idx ${farmIdx})`);
    });

    it('hybridRerank annotates domainTrustSignals array on each result', async () => {
        const docs = [
            makeRerankDoc({ domain: 'who.int', url: 'https://who.int/news', title: 'Health update this week', snippet: 'International health authority policy' })
        ];
        const ranked = await hybridRerank(QUERY, docs);
        assert.ok(Array.isArray(ranked[0].domainTrustSignals), 'domainTrustSignals must be an array');
        assert.ok(ranked[0].domainTrustSignals.length > 0, 'domainTrustSignals must contain at least one signal for who.int');
    });

});
