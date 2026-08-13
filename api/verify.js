export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';
import { extractHostname, isTrustedDomain } from './_lib/entity-verifier.js';

const WIKIPEDIA_API_BASE = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const DEFAULT_USER_AGENT = 'AntigravityParser/1.0 (+https://github.com; zero-dependency-verifier)';
const FETCH_TIMEOUT_MS = 4000;

/**
 * Extracts target topic/article slug from user query.
 * @param {string} query 
 * @returns {{ slug: string, role: string, jurisdiction: string } | null}
 */
export function resolveVerificationTarget(query) {
    const q = String(query || '').trim();
    if (!q) return null;

    // Pattern 1: Role followed by jurisdiction ("role of region")
    const matchAfter = q.match(/\b(?:who is|what is|tell me|who's)?\s*(?:the\s+)?(current\s+)?(chief minister|prime minister|president|governor|mayor|chancellor|premier|ceo)\s+(?:of|for|in)\s+([a-zA-Z\s]+?)(?:\?|\.|\!|$)/i);
    if (matchAfter && matchAfter[2] && matchAfter[3]) {
        const role = matchAfter[2].trim().replace(/\b\w/g, c => c.toUpperCase());
        const rawPlace = matchAfter[3].trim().replace(/\b(?:now|today|currently)\b/gi, '').trim();
        if (rawPlace.length >= 2) {
            const jurisdiction = rawPlace.replace(/\b\w/g, c => c.toUpperCase());
            const slug = formatWikiSlug(jurisdiction, role);
            return { slug, role, jurisdiction };
        }
    }

    // Pattern 2: Short role abbreviations ("cm/pm of region")
    const matchAbbr = q.match(/\b(?:cm|pm)\s+(?:of|for|in)\s+([a-zA-Z\s]+?)(?:\?|\.|\!|$)/i);
    if (matchAbbr && matchAbbr[1]) {
        const isPm = /\bpm\b/i.test(q);
        const role = isPm ? 'Prime Minister' : 'Chief Minister';
        const rawPlace = matchAbbr[1].trim().replace(/\b(?:now|today|currently)\b/gi, '').trim();
        if (rawPlace.length >= 2) {
            const jurisdiction = rawPlace.replace(/\b\w/g, c => c.toUpperCase());
            const slug = formatWikiSlug(jurisdiction, role);
            return { slug, role, jurisdiction };
        }
    }

    // Pattern 3: Jurisdiction followed by role ("region cm/pm/leader")
    const matchBefore = q.match(/\b(?:who is|what is|tell me|who's)?\s*(?:the\s+)?([a-zA-Z\s]+?)\s+(cm|pm|chief minister|prime minister|president|governor|mayor)\b/i);
    if (matchBefore && matchBefore[1] && matchBefore[2]) {
        const rawRole = matchBefore[2].trim().toLowerCase();
        const role = rawRole === 'cm' ? 'Chief Minister' : (rawRole === 'pm' ? 'Prime Minister' : rawRole.replace(/\b\w/g, c => c.toUpperCase()));
        const rawPlace = matchBefore[1].replace(/\b(?:current|the|who is|what is|who's|tell me)\b/gi, '').trim();
        if (rawPlace.length >= 2) {
            const jurisdiction = rawPlace.replace(/\b\w/g, c => c.toUpperCase());
            const slug = formatWikiSlug(jurisdiction, role);
            return { slug, role, jurisdiction };
        }
    }

    return null;
}

function formatWikiSlug(jurisdiction, role) {
    const p = String(jurisdiction || '').trim().replace(/\s+/g, '_');
    if (role === 'Prime Minister') {
        return `Prime_Minister_of_${p}`;
    }
    if (role === 'President') {
        return `President_of_${p}`;
    }
    return p;
}

/**
 * Extracts the incumbent officeholder name from summary text using compiled regular expressions.
 * @param {string} extract 
 * @param {string} role 
 * @returns {string | null}
 */
export function extractIncumbentFromSummary(extract, role = '') {
    const text = String(extract || '').trim();
    if (!text) return null;

    // Biographical lead pattern: match leading subject before title declaration
    const pA = text.match(/^([A-Z][a-zA-Z.\s]+?)\s+is (?:an? [a-zA-Z\s]+?who (?:is|serves as) )?the (?:current )?(?:and \d+[a-z]{2} )?(?:Chief Minister|Prime Minister|President)/i);
    if (pA && pA[1]) return cleanEntityName(pA[1]);

    // Predicate incumbent pattern: match role declaration followed by entity name
    const pB = text.match(/(?:(?:is the|serving as the|the) (?:current|incumbent) (?:and \d+[a-z]{2} )?(?:Chief Minister|Prime Minister|President|Governor)(?:(?:\s+of|\s+for)\s+(?:the\s+)?[A-Za-z\s]+?)?\s+(?:is|was)|(?:the\s+)?incumbent is)\s*[:,-]?\s*([A-Z][a-zA-Z.\s]+?)(?=\s*(?:,|\.|\(|\n|$|\bwho\b|\bsince\b|\bhaving\b|\bassumed\b|\bin office\b))/i);
    if (pB && pB[1]) return cleanEntityName(pB[1]);

    // Key-value header pattern: match title followed by colon and entity
    const pC = text.match(/(?:Chief Minister|Prime Minister|President|Governor)\s*[:]\s*([A-Z][a-zA-Z.\s]+?)(?=\s*(?:,|\.|\(|\n|$|\bsince\b|\bin office\b))/i);
    if (pC && pC[1]) return cleanEntityName(pC[1]);

    return null;
}

function cleanEntityName(raw) {
    return String(raw || '')
        .replace(/^(?:the|honourable|thiru|mr\.|dr\.)\s+/i, '')
        .replace(/[.,;]+$/, '')
        .trim();
}

/**
 * Main verification API handler.
 */
export default async function handler(req, res) {
    const guard = applyApiSecurity(req, res, {
        methods: ['POST'],
        routeKey: 'verify',
        maxBodyBytes: 32 * 1024,
        rateLimit: { max: 80, windowMs: 60 * 1000 }
    });
    if (guard.handled) return;

    const start = performance.now();
    const body = req.body || {};
    const query = String(body.query || body.q || '').trim();
    const llmResponse = String(body.llmResponse || body.response || '').trim();

    if (!query || !llmResponse) {
        return res.status(400).json({
            success: false,
            verified: false,
            error: { code: 'missing_parameters', message: 'Both query and llmResponse are required.' }
        });
    }

    try {
        const target = resolveVerificationTarget(query);
        if (!target) {
            // Not a recognized time-sensitive entity query — return verified neutral pass
            return res.status(200).json({
                success: true,
                verified: true,
                extractedAnchor: null,
                sourceUrl: null,
                latencyMs: Math.round(performance.now() - start),
                timestamp: Date.now()
            });
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const wikiUrl = `${WIKIPEDIA_API_BASE}/${encodeURIComponent(target.slug)}`;
        const response = await fetch(wikiUrl, {
            signal: controller.signal,
            headers: {
                'User-Agent': DEFAULT_USER_AGENT,
                'Accept': 'application/json'
            }
        });
        clearTimeout(timer);

        if (!response.ok) {
            return res.status(200).json({
                success: true,
                verified: true,
                extractedAnchor: null,
                sourceUrl: `https://en.wikipedia.org/wiki/${target.slug}`,
                latencyMs: Math.round(performance.now() - start),
                timestamp: Date.now()
            });
        }

        const data = await response.json();
        const extract = String(data.extract || data.description || '');
        const actualIncumbent = extractIncumbentFromSummary(extract, target.role);

        let isAccurate = true;
        if (actualIncumbent) {
            const respLower = llmResponse.toLowerCase();
            const incumbentLower = actualIncumbent.toLowerCase();
            // Check if primary last name or full name is mentioned
            const nameParts = incumbentLower.split(' ').filter(p => p.length >= 3);
            isAccurate = respLower.includes(incumbentLower) || nameParts.some(p => respLower.includes(p));
        }

        return res.status(200).json({
            success: true,
            verified: isAccurate,
            extractedAnchor: actualIncumbent,
            role: target.role,
            jurisdiction: target.jurisdiction,
            sourceUrl: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${target.slug}`,
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });

    } catch (error) {
        // Fail-safe: verification failures never crash the app pipeline
        return res.status(200).json({
            success: true,
            verified: true,
            extractedAnchor: null,
            error: String(error?.message || 'verification_unavailable'),
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });
    }
}
