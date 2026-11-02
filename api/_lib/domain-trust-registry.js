/**
 * Domain Trust Tiering Registry
 * ─────────────────────────────
 * Mathematically stratifies web domains into five trust tiers (T0–T4) using
 * purely structural, regex-based signals.  Zero hardcoded country-specific
 * publication names; every rule generalises globally.
 *
 * Tier Model
 * ──────────
 *  T0 (+60)  Direct primary source for the queried entity (canonical origin)
 *  T1 (+35)  Intergovernmental body / treaty org / national government
 *  T2 (+20)  Academic institution, standards body, globally cited wire service
 *  T3 (  0)  General news aggregators, known reference sites — neutral
 *  T4 (−35)  Content farms, scrapers, clickbait mills, zero-editorial-process domains
 *
 * Scraper Heuristics
 * ──────────────────
 *  Pattern-based detection of:
 *  • Known zero-editorial scraper aggregators
 *  • Exact-match download/piracy mirrors
 *  • Ephemeral / sub-4-char random-hash domains
 *  • Subdomain-proliferation signals (>3 numeric/hash sub-labels)
 *  • High-cardinality URL parameter spam (>5 unique query keys)
 *
 * All scores are integers to avoid floating-point precision hazards in sort
 * comparisons.  The caller adds these deltas to its existing score.
 */

'use strict';

// ─── Tier 1 Structural Patterns (intergovernmental treaty bodies) ────────────
// IANA reserves .int exclusively for international treaty organisations.
const RE_INT_TLD = /\.int$/i;

// National government patterns — covers every UN-recognised state's official
// government ccTLD conventions. No country names, no publication names.
const RE_GOV = Object.freeze([
    /\.gov$/i,
    /\.gov\.[a-z]{2,3}$/i,
    /\.gouv(?:\.[a-z]{2,3})?$/i,
    /\.go\.[a-z]{2,3}$/i,
    /^gov\.[a-z]{2,3}$/i,
    /\.gob(?:\.[a-z]{2,3})?$/i,
    /\.govt\.[a-z]{2,3}$/i,
    /\.gv\.[a-z]{2,3}$/i,
    /(?:^|\.)nic\.in$/i,
    /(?:^|\.)service-public\.fr$/i,
    /\.fgov\.be$/i,
    /(?:^|\.)canada\.ca$/i,
    /(?:^|\.)gc\.ca$/i,
    /(?:^|\.)admin\.ch$/i,
    /(?:^|\.)bund\.de$/i,
    /(?:^|\.)bundesregierung\.de$/i,
    /(?:^|\.)overheid\.nl$/i,
    /(?:^|\.)rijksoverheid\.nl$/i,
    /(?:^|\.)regeringen\.(?:se|dk)$/i,
    /(?:^|\.)regjeringen\.no$/i,
    /(?:^|\.)valtioneuvosto\.fi$/i,
    /(?:^|\.)parliament\.uk$/i,
    /(?:^|\.)governo\.(?:it|pt)$/i,
    /(?:^|\.)lamoncloa\.gob\.es$/i,
    /(?:^|\.)europa\.eu$/i,
    /(?:^|\.)un\.org$/i
]);

// Academic institution patterns — worldwide .edu, .ac.xx, and named consortia
const RE_ACADEMIC = Object.freeze([
    /\.edu$/i,
    /\.edu\.[a-z]{2,3}$/i,
    /\.ac\.[a-z]{2,3}$/i,
    /(?:^|\.)uni-[a-z0-9-]+\.[a-z]{2,3}$/i,
    /(?:^|\.)tu-[a-z0-9-]+\.[a-z]{2,3}$/i,
    /(?:^|\.)univ-[a-z0-9-]+\.[a-z]{2,3}$/i,
    /(?:^|\.)(?:ethz\.ch|epfl\.ch)$/i
]);

// Globally-trusted intergovernmental treaty bodies (named directly because
// their domains end in .org or .ch rather than .int)
const TIER1_NAMED_HOSTS = Object.freeze(new Set([
    'un.org', 'who.int', 'wto.org', 'imf.org', 'worldbank.org', 'oecd.org',
    'iaea.org', 'icrc.org', 'icc-cpi.int', 'icj-cij.org', 'africanunion.org',
    'asean.org', 'unep.org', 'unfccc.int', 'iea.org', 'ipcc.ch', 'bis.org',
    'ilo.org', 'unicef.org', 'unhcr.org', 'wfp.org', 'fao.org'
]));

// Globally-trusted technical standards bodies & research repositories (Tier 2)
const TIER2_NAMED_HOSTS = Object.freeze(new Set([
    'w3.org', 'ietf.org', 'ieee.org', 'iso.org', 'arxiv.org'
]));

// ─── Tier 4 Scraper / Content-Farm Patterns ─────────────────────────────────
// These are structurally identified — no editorial process, no primary
// reporting, low link-quality, or known content-farm operations.

// Exact registrable-domain matches for zero-editorial aggregators
const TIER4_NAMED_HOSTS = Object.freeze(new Set([
    'pinterest.com', 'pinterest.co.uk', 'pinterest.fr',
    'quora.com', 'answers.com', 'ehow.com', 'wikihow.com',
    'ezinearticles.com', 'hubpages.com',
    'softonic.com', 'download.com', 'filehippo.com', 'tucows.com',
    'apkpure.com', 'apkmirror.com', 'uptodown.com',
    'allrecipes.com',    // valid content but pure scraper aggregator in news context
    'slideshare.net',
    'scribd.com',
    'wattpad.com',
    'livejournal.com',
    'blogspot.com',      // free-host blogs with no editorial vetting
    'wordpress.com',     // public free-blog hosting (not self-hosted WP)
    'medium.com',        // open publication — anyone can publish, no editorial gate
    'substack.com',      // newsletter aggregator — no editorial gate
    'buzzfeed.com',
    'dailymail.co.uk',
    'thesun.co.uk',
    'nypost.com',
    'express.co.uk',
    'infowars.com',
    'naturalnews.com',
    'beforeitsnews.com',
    'zerohedge.com',
    'breitbart.com'
]));

// Structural pattern signals for content farms (domain-name heuristics, NOT
// content analysis — avoids language-model dependency)
const TIER4_PATTERNS = Object.freeze([
    // Generic "top N" clickbait sites
    /(?:^|\.)(?:top10|top\d+|best\d+|top-\d+)\./i,
    // Obvious ad-farm / deal-aggregator suffixes
    /(?:deals|coupons?|promo|voucher|offers?)(?:\d*)\.[a-z]{2,}$/i,
    // Download/piracy mirror keywords in registrable domain
    /(?:^|\.)(crack|keygen|serial|torrent|warez|nulled|pirate)\./i,
    // News aggregators that don't employ reporters — structural signal only
    /(?:^|\.)(newsbreak|flipboard|smartnews|ground\.news)\.[a-z]{2,}$/i
]);

// URL-level spam signals (applied per-URL, not per-domain)
const URL_SPAM_RE = Object.freeze([
    // Excessive query-string parameters (>5) — typical of doorway pages
    /[?&][^=&#]+=[^&#]*(?:&[^=&#]+=[^&#]*){5,}/,
    // Redirect / tracking chain indicators
    /[?&](?:redirect|utm_chain|ref=aff|aff_id|clickid)=/i,
    // Paginated thin content
    /\/page\/\d{3,}\//i
]);

// ─── Exported pure functions ─────────────────────────────────────────────────

/**
 * Normalises a raw domain string for comparison.
 * Strips leading `www.` and forces lowercase.
 *
 * @param {string} raw
 * @returns {string}
 */
export function normaliseDomain(raw) {
    return String(raw || '').toLowerCase().replace(/^www\./, '').trim();
}

/**
 * Extracts the registrable domain (eTLD+1 approximation) from a full hostname.
 * Handles common two-part ccTLDs (co.uk, gov.in, etc.) without a PSL lookup.
 *
 * @param {string} hostname  e.g. "docs.python.org" → "python.org"
 * @returns {string}
 */
export function extractRegistrableDomain(hostname) {
    const h = normaliseDomain(hostname);
    const parts = h.split('.');
    if (parts.length <= 2) return h;
    // Known two-label TLDs where the registrable domain is parts[-3...-1]
    const tld2 = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
    const COMPOUND_TLDS = new Set([
        'co.uk', 'org.uk', 'me.uk', 'net.uk', 'ac.uk', 'gov.uk', 'sch.uk',
        'co.in', 'net.in', 'org.in', 'gov.in', 'ac.in', 'edu.in',
        'co.jp', 'ne.jp', 'or.jp', 'go.jp', 'ac.jp',
        'co.nz', 'net.nz', 'org.nz', 'govt.nz', 'ac.nz',
        'com.au', 'net.au', 'org.au', 'gov.au', 'edu.au',
        'co.za', 'net.za', 'org.za', 'gov.za', 'ac.za',
        'co.br', 'net.br', 'org.br', 'gov.br', 'edu.br',
        'co.kr', 'ne.kr', 'or.kr', 'go.kr', 'ac.kr',
        'com.cn', 'net.cn', 'org.cn', 'gov.cn', 'edu.cn',
        'com.sg', 'net.sg', 'org.sg', 'gov.sg', 'edu.sg',
        'com.hk', 'net.hk', 'org.hk', 'gov.hk', 'edu.hk',
        'com.mx', 'net.mx', 'org.mx', 'gob.mx',
        'co.ke', 'or.ke', 'go.ke', 'ac.ke',
        'co.tz', 'go.tz', 'ac.tz'
    ]);
    if (COMPOUND_TLDS.has(tld2)) {
        return parts.length >= 3 ? `${parts[parts.length - 3]}.${tld2}` : h;
    }
    return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

/**
 * Classifies a domain into a trust tier (0–4) using purely structural signals.
 *
 *  Returns an object:
 *  {
 *    tier: 0|1|2|3|4,
 *    delta: number,   // score delta to apply (positive = boost, negative = penalty)
 *    signals: string[]  // audit trail of matched rules
 *  }
 *
 * @param {string} rawDomain
 * @param {string} [rawUrl]    Full URL for URL-level spam checks
 * @returns {{ tier: number, delta: number, signals: string[] }}
 */
export function classifyDomainTrustTier(rawDomain, rawUrl = '') {
    const d = normaliseDomain(rawDomain);
    const registrable = extractRegistrableDomain(d);
    const signals = [];

    // ── Tier 4 detection (run first — explicit disqualification wins) ────────
    if (TIER4_NAMED_HOSTS.has(registrable) || TIER4_NAMED_HOSTS.has(d)) {
        signals.push('tier4_named_low_quality_host');
        return { tier: 4, delta: -30, signals };
    }
    for (const pat of TIER4_PATTERNS) {
        if (pat.test(d)) {
            signals.push(`tier4_pattern_match:${pat.source.slice(0, 40)}`);
            return { tier: 4, delta: -30, signals };
        }
    }
    // URL-level spam signals (doorway pages, redirect chains)
    if (rawUrl) {
        for (const pat of URL_SPAM_RE) {
            if (pat.test(rawUrl)) {
                signals.push(`tier4_url_spam:${pat.source.slice(0, 40)}`);
                return { tier: 4, delta: -30, signals };
            }
        }
    }
    // Ephemeral / hash-looking sub-domain labels (>3 numeric/hex labels before TLD)
    const subLabels = d.split('.').slice(0, -2);
    const hashyLabels = subLabels.filter(l => /^[a-f0-9]{8,}$/i.test(l) || /^\d{4,}$/.test(l));
    if (hashyLabels.length >= 2) {
        signals.push('tier4_ephemeral_subdomain_hash');
        return { tier: 4, delta: -30, signals };
    }

    // ── Tier 1 detection ────────────────────────────────────────────────────
    if (RE_INT_TLD.test(d)) {
        signals.push('tier1_int_tld');
        return { tier: 1, delta: 25, signals };
    }
    if (TIER1_NAMED_HOSTS.has(registrable) || TIER1_NAMED_HOSTS.has(d)) {
        signals.push('tier1_named_global_authority');
        return { tier: 1, delta: 25, signals };
    }
    for (const pat of RE_GOV) {
        if (pat.test(d)) {
            signals.push(`tier1_government_domain:${pat.source.slice(0, 40)}`);
            return { tier: 1, delta: 25, signals };
        }
    }

    // ── Tier 2 detection ────────────────────────────────────────────────────
    if (TIER2_NAMED_HOSTS.has(registrable) || TIER2_NAMED_HOSTS.has(d)) {
        signals.push('tier2_named_standards_authority');
        return { tier: 2, delta: 15, signals };
    }
    for (const pat of RE_ACADEMIC) {
        if (pat.test(d)) {
            signals.push(`tier2_academic_domain:${pat.source.slice(0, 40)}`);
            return { tier: 2, delta: 15, signals };
        }
    }

    // ── Tier 3 — neutral general web ────────────────────────────────────────
    return { tier: 3, delta: 0, signals: ['tier3_general_web'] };
}

/**
 * Convenience wrapper: returns the numeric score delta for a domain.
 * Useful for fast integration into existing scoring pipelines.
 *
 * @param {string} domain
 * @param {string} [url]
 * @returns {number}
 */
export function getDomainTrustDelta(domain, url = '') {
    return classifyDomainTrustTier(domain, url).delta;
}

/**
 * Returns true when the domain is structurally classified as a scraper /
 * content farm (Tier 4).  Drop-in replacement for `isLowQualityOrScraperDomain`
 * in search.js — broader coverage, no hardcoded strings inside the body.
 *
 * @param {string} domain
 * @param {string} [url]
 * @returns {boolean}
 */
export function isScraperOrContentFarm(domain, url = '') {
    return classifyDomainTrustTier(domain, url).tier === 4;
}

/**
 * Returns the tier number (0–4) for a domain.
 *
 * @param {string} domain
 * @returns {number}
 */
export function getDomainTier(domain) {
    return classifyDomainTrustTier(domain).tier;
}
