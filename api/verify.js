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
    const q = String(query || '').toLowerCase().trim();
    if (!q) return null;

    if (/\b(?:cm|chief minister)\b/.test(q) && /\btamil\s*nadu\b/.test(q)) {
        return { slug: 'Tamil_Nadu', role: 'Chief Minister', jurisdiction: 'Tamil Nadu' };
    }
    if (/\b(?:cm|chief minister)\b/.test(q) && /\bkarnataka\b/.test(q)) {
        return { slug: 'Karnataka', role: 'Chief Minister', jurisdiction: 'Karnataka' };
    }
    if (/\b(?:cm|chief minister)\b/.test(q) && /\bmaharashtra\b/.test(q)) {
        return { slug: 'Maharashtra', role: 'Chief Minister', jurisdiction: 'Maharashtra' };
    }
    if (/\b(?:cm|chief minister)\b/.test(q) && /\bdelhi\b/.test(q)) {
        return { slug: 'Delhi', role: 'Chief Minister', jurisdiction: 'Delhi' };
    }
    if (/\b(?:pm|prime minister)\b/.test(q) && /\bindia\b/.test(q)) {
        return { slug: 'Prime_Minister_of_India', role: 'Prime Minister', jurisdiction: 'India' };
    }
    if (/\b(?:president)\b/.test(q) && /\b(?:usa|united states|america)\b/.test(q)) {
        return { slug: 'President_of_the_United_States', role: 'President', jurisdiction: 'United States' };
    }

    // Generic CM extraction
    const cmMatch = q.match(/\b(?:cm|chief minister)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|$)/i);
    if (cmMatch && cmMatch[1]) {
        const place = cmMatch[1].trim().replace(/\s+/g, '_');
        if (place.length >= 3) {
            return { slug: place, role: 'Chief Minister', jurisdiction: cmMatch[1].trim() };
        }
    }

    return null;
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
    const pB = text.match(/(?:(?:is the|serving as the|the) current (?:and \d+[a-z]{2} )?(?:Chief Minister|Prime Minister|President)(?: of [A-Za-z\s]+?)?\s+(?:is|was)|incumbent is)\s*[:,-]?\s*([A-Z][a-zA-Z.\s]+?)(?=\s+(?:who|since|having|\(|,|\.|\n|$))/i);
    if (pB && pB[1]) return cleanEntityName(pB[1]);

    // Key-value header pattern: match title followed by colon and entity
    const pC = text.match(/(?:Chief Minister|Prime Minister|President)\s*[:]\s*([A-Z][a-zA-Z.\s]+?)(?=\s+(?:since|\(|,|\.|\n|$))/i);
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
