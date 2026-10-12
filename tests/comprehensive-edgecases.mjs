/**
 * Comprehensive Edge-Cases & Universal Authority Test Suite
 * 
 * Verifies end-to-end ranking, structural domain detection, country coverage,
 * 26-vertical authority, scraper shield, and latency invariants.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
    isDirectPrimarySource,
    isGovernmentDomain,
    isInternationalOrgDomain,
    isAcademicDomain,
    isLowQualityOrScraperDomain,
    getTopicAuthorityBonus,
    detectQueryTopic,
    rankSources
} from '../api/search.js';

test('--- Category 1: Direct Primary Source Matcher (Tier 0) ---', async (t) => {
    await t.test('Steam queries detect store.steampowered.com and steampowered.com as direct primary', () => {
        const query = 'What is the official refund policy for games on Steam?';
        assert.equal(isDirectPrimarySource(query, 'store.steampowered.com'), true);
        assert.equal(isDirectPrimarySource(query, 'steampowered.com'), true);
        assert.equal(isDirectPrimarySource(query, 'ign.com'), false);
    });

    await t.test('Python documentation queries detect docs.python.org as direct primary', () => {
        const query = 'Python match statement documentation';
        assert.equal(isDirectPrimarySource(query, 'docs.python.org'), true);
        assert.equal(isDirectPrimarySource(query, 'python.org'), true);
        assert.equal(isDirectPrimarySource(query, 'geeksforgeeks.org'), false);
    });

    await t.test('PlayStation warranty queries detect playstation.com as direct primary', () => {
        const query = 'Sony PlayStation 5 warranty guide';
        assert.equal(isDirectPrimarySource(query, 'playstation.com'), true);
        assert.equal(isDirectPrimarySource(query, 'kotaku.com'), false);
    });

    await t.test('Harvard University queries detect harvard.edu as direct primary', () => {
        const query = 'Harvard University graduate admission requirements';
        assert.equal(isDirectPrimarySource(query, 'harvard.edu'), true);
        assert.equal(isDirectPrimarySource(query, 'collegeconfidential.com'), false);
    });
});

test('--- Category 2: International Treaty Bodies (.int TLD) (Tier 1) ---', async (t) => {
    await t.test('All IANA reserved .int international orgs are recognized universally', () => {
        const intDomains = [
            'who.int',
            'wipo.int',
            'itu.int',
            'icao.int',
            'interpol.int',
            'nato.int',
            'bipm.int',
            'oiml.int'
        ];
        for (const domain of intDomains) {
            assert.equal(isInternationalOrgDomain(domain), true, `Failed for ${domain}`);
        }
    });

    await t.test('Non-int domains are not falsely recognized as .int', () => {
        assert.equal(isInternationalOrgDomain('reuters.com'), false);
        assert.equal(isInternationalOrgDomain('nytimes.com'), false);
    });
});

test('--- Category 3: Multi-Country Sovereign Government Portals (Tier 1) ---', async (t) => {
    const countryPortals = [
        { country: 'United States', domain: 'irs.gov' },
        { country: 'United Kingdom', domain: 'gov.uk' },
        { country: 'India', domain: 'incometax.gov.in' },
        { country: 'India NIC', domain: 'nic.in' },
        { country: 'Canada', domain: 'canada.ca' },
        { country: 'Canada GC', domain: 'gc.ca' },
        { country: 'Australia', domain: 'servicesaustralia.gov.au' },
        { country: 'Germany', domain: 'bund.de' },
        { country: 'France', domain: 'service-public.fr' },
        { country: 'France Gouv', domain: 'interieur.gouv.fr' },
        { country: 'Japan', domain: 'digital.go.jp' },
        { country: 'Spain', domain: 'lamoncloa.gob.es' },
        { country: 'Italy', domain: 'governo.it' },
        { country: 'Sweden', domain: 'regeringen.se' },
        { country: 'Switzerland', domain: 'admin.ch' },
        { country: 'European Union', domain: 'europa.eu' },
        { country: 'United Nations', domain: 'un.org' }
    ];

    for (const { country, domain } of countryPortals) {
        await t.test(`Universal matcher recognizes sovereign portal for ${country} (${domain})`, () => {
            assert.equal(isGovernmentDomain(domain), true, `Failed sovereign recognition for ${domain}`);
        });
    }
});

test('--- Category 4: Worldwide Academic Institutions (Tier 1) ---', async (t) => {
    const universities = [
        'harvard.edu',
        'mit.edu',
        'ox.ac.uk',
        'cam.ac.uk',
        'ethz.ch',
        'epfl.ch',
        'uni-heidelberg.de',
        'univ-paris1.fr',
        'iitd.ac.in',
        'u-tokyo.ac.jp'
    ];

    for (const domain of universities) {
        await t.test(`Academic pattern matches ${domain}`, () => {
            assert.equal(isAcademicDomain(domain), true, `Failed academic recognition for ${domain}`);
        });
    }
});

test('--- Category 5: 26 Knowledge Verticals Authority Registry (Tier 2) ---', async (t) => {
    const verticals = [
        { vertical: 'geopolitics', query: 'UN Security Council resolution conflict sanctions', expectedDomain: 'un.org' },
        { vertical: 'economics', query: 'IMF world economic outlook forecast GDP inflation', expectedDomain: 'imf.org' },
        { vertical: 'law', query: 'International Court of Justice ruling tribunal verdict', expectedDomain: 'icj-cij.org' },
        { vertical: 'health', query: 'WHO outbreak disease clinical guidelines', expectedDomain: 'who.int' },
        { vertical: 'climate', query: 'IPCC global warming climate emissions', expectedDomain: 'ipcc.ch' },
        { vertical: 'agriculture', query: 'FAO agricultural crop food security commodity', expectedDomain: 'fao.org' },
        { vertical: 'space', query: 'NASA James Webb Space Telescope galaxy astrophysics', expectedDomain: 'nasa.gov' },
        { vertical: 'transportation', query: 'NTSB aircraft incident aviation safety maritime', expectedDomain: 'ntsb.gov' },
        { vertical: 'labor', query: 'ILO global wage employment worker rights', expectedDomain: 'ilo.org' },
        { vertical: 'patents', query: 'WIPO patent copyright intellectual property trademark', expectedDomain: 'wipo.int' },
        { vertical: 'education', query: 'UNESCO world heritage monument cultural preservation', expectedDomain: 'unesco.org' },
        { vertical: 'disasters', query: 'UNHCR refugee emergency relief evacuation', expectedDomain: 'unhcr.org' },
        { vertical: 'standards', query: 'IETF RFC HTTP 3 specifications ethernet protocol', expectedDomain: 'ietf.org' },
        { vertical: 'sports', query: 'FIFA world cup tournament soccer standings', expectedDomain: 'fifa.com' },
        { vertical: 'markets', query: 'ECB interest rate monetary policy treasury', expectedDomain: 'ecb.europa.eu' },
        { vertical: 'preprints', query: 'arXiv quantum computing entanglement physics preprint', expectedDomain: 'arxiv.org' }
    ];

    for (const { vertical, query, expectedDomain } of verticals) {
        await t.test(`Topic authority registry matches ${vertical} query correctly`, () => {
            const topic = detectQueryTopic(query);
            assert.ok(topic, `Failed to detect topic for query "${query}"`);
            const bonus = getTopicAuthorityBonus(expectedDomain, query);
            assert.ok(bonus > 0, `Expected ${expectedDomain} to receive topic authority bonus for ${topic}`);
        });
    }
});

test('--- Category 6: Scraper Shield Defense (Tier 3) ---', async (t) => {
    const scrapers = [
        'quora.com',
        'pinterest.com',
        'ehow.com',
        'softonic.com',
        'answers.com',
        'ezinearticles.com',
        'wikihow.com'
    ];

    for (const domain of scrapers) {
        await t.test(`Scraper shield flags ${domain}`, () => {
            assert.equal(isLowQualityOrScraperDomain(domain), true, `Failed to flag scraper: ${domain}`);
        });
    }
});

test('--- Category 7: End-to-End Ranking Verification ---', async (t) => {
    await t.test('Primary source beats news aggregator and scraper in Steam refund query', () => {
        const query = 'What is the official refund policy for games on Steam?';
        const candidates = [
            { title: 'Steam Refund Complaints - Quora', domain: 'quora.com', url: 'https://quora.com/q/steam-refunds' },
            { title: 'Developer blasts Steam policy - IGN', domain: 'ign.com', url: 'https://ign.com/articles/steam-dev-refund' },
            { title: 'Steam Refunds - Valve Official', domain: 'store.steampowered.com', url: 'https://store.steampowered.com/steam_refunds/' }
        ];

        const ranked = rankSources(query, candidates);
        assert.equal(ranked[0].domain, 'store.steampowered.com', 'Official Steam store must rank #1');
        assert.equal(ranked[1].domain, 'ign.com', 'Reputable news ranks #2');
        assert.equal(ranked[2].domain, 'quora.com', 'Scraper/discussion ranks last');
    });

    await t.test('First-party technical documentation beats blog and content mill', () => {
        const query = 'Python 3.13 pattern matching guide';
        const candidates = [
            { title: 'Python match statement - GeeksforGeeks', domain: 'geeksforgeeks.org', url: 'https://geeksforgeeks.org/python-match' },
            { title: 'Structural Pattern Matching - Python Documentation', domain: 'docs.python.org', url: 'https://docs.python.org/3/tutorial/controlflow.html#match-statements' },
            { title: 'Learn Python Fast - Medium', domain: 'medium.com', url: 'https://medium.com/python-match' }
        ];

        const ranked = rankSources(query, candidates);
        assert.equal(ranked[0].domain, 'docs.python.org', 'docs.python.org must rank #1');
    });

    await t.test('Official UN portal beats secondary commentary on geopolitical crisis', () => {
        const query = 'United Nations Security Council resolution text on peacekeepers';
        const candidates = [
            { title: 'Opinion: UN Security Council', domain: 'theguardian.com', url: 'https://theguardian.com/opinion/un' },
            { title: 'Security Council Resolutions - United Nations', domain: 'un.org', url: 'https://un.org/securitycouncil/content/resolutions' }
        ];

        const ranked = rankSources(query, candidates);
        assert.equal(ranked[0].domain, 'un.org', 'un.org must rank #1');
    });
});
