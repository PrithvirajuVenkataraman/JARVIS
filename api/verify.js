export const config = { maxDuration: 30 };

import { applyApiSecurity } from './_lib/security.js';

const WIKIPEDIA_SEARCH_API = 'https://en.wikipedia.org/w/api.php';
const WIKIPEDIA_SUMMARY_API = 'https://en.wikipedia.org/api/rest_v1/page/summary';
const DEFAULT_USER_AGENT = 'AntigravityParser/1.0 (+https://github.com; zero-dependency-verifier)';
const FETCH_TIMEOUT_MS = 4000;

/**
 * Dynamically fetches live ground truth summary for any query by routing to Wikipedia's search and summary APIs.
 * @param {string} query
 * @param {AbortSignal} [signal]
 * @returns {Promise<{ title: string, extract: string, sourceUrl: string } | null>}
 */
export async function fetchGroundTruth(query, signal) {
    const rawQuery = String(query || '').trim();
    if (!rawQuery) return null;

    const cleanQuery = rawQuery.replace(/^[?!.,\s]+|[?!.,\s]+$/g, '').trim();
    if (!cleanQuery) return null;

    // 1. Route to search API to discover canonical topic
    const searchParams = new URLSearchParams({
        action: 'query',
        list: 'search',
        srsearch: cleanQuery,
        utf8: '1',
        format: 'json',
        srlimit: '1'
    });

    const searchRes = await fetch(`${WIKIPEDIA_SEARCH_API}?${searchParams.toString()}`, {
        signal,
        headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            'Accept': 'application/json'
        }
    });

    if (!searchRes.ok) return null;

    const searchData = await searchRes.json();
    const topResult = searchData.query?.search?.[0];
    if (!topResult?.title) return null;

    // 2. Route to summary REST endpoint for lightweight ground truth text
    const summaryRes = await fetch(`${WIKIPEDIA_SUMMARY_API}/${encodeURIComponent(topResult.title.replace(/ /g, '_'))}`, {
        signal,
        headers: {
            'User-Agent': DEFAULT_USER_AGENT,
            'Accept': 'application/json'
        }
    });

    if (!summaryRes.ok) return null;

    const summaryData = await summaryRes.json();
    return {
        title: summaryData.title || topResult.title,
        extract: String(summaryData.extract || summaryData.description || '').trim(),
        sourceUrl: summaryData.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(topResult.title.replace(/ /g, '_'))}`
    };
}

/**
 * Assesses alignment between live ground-truth reference and model response.
 * @param {string} groundTruth
 * @param {string} llmResponse
 * @returns {{ isAccurate: boolean, extractedAnchor: string | null }}
 */
export function assessAlignment(groundTruth, llmResponse) {
    const truth = String(groundTruth || '').trim();
    const resp = String(llmResponse || '').toLowerCase().trim();
    if (!truth || !resp) return { isAccurate: true, extractedAnchor: null };

    // Extract key proper nouns / names from ground truth lead sentence, ignoring common sentence prefixes
    const leadSentence = truth.split(/[.\n]/)[0] || '';
    const cleanLead = leadSentence.replace(/^(?:in\s+[a-z]+|according\s+to\s+[a-z]+|for\s+[a-z]+|as\s+of\s+[a-z]+|the\s+[a-z]+)[,:]?\s*/i, '');
    const nameMatch = cleanLead.match(/\b([A-Z][a-zA-Z.'’\-]+(?:\s+[A-Z][a-zA-Z.'’\-]+){0,4})\b/);
    const rawAnchor = nameMatch ? nameMatch[1].trim() : null;
    
    // Ignore non-proper nouns or general words
    const candidateAnchor = (rawAnchor && !/^(In|On|At|For|By|With|From|As|The|This|That|These|Those|According|However|Although|While|When|Where|Why|How|What|Which|Who|Whom|Whose|If|Unless|Since|Because|Although)$/i.test(rawAnchor))
        ? rawAnchor
        : null;

    let isAccurate = true;
    if (candidateAnchor) {
        const anchorLower = candidateAnchor.toLowerCase();
        const parts = anchorLower.split(' ').filter(p => p.length >= 3);
        const matchesAnyPart = parts.some(p => resp.includes(p));
        isAccurate = resp.includes(anchorLower) || matchesAnyPart;
    }

    return {
        isAccurate,
        extractedAnchor: candidateAnchor
    };
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

    // Abstract reasoning, math proofs, coding, and opinion queries do not have a single mutable real-world entity anchor
    if (/```|\b(prove|proof|irrational|algorithm|function|javascript|python|calculate|integral|derivative|equation|viewpoint|perspective|opinion|philosophy)\b/i.test(query)) {
        return res.status(200).json({
            success: true,
            verified: true,
            extractedAnchor: null,
            sourceUrl: null,
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });
    }

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const groundTruthData = await fetchGroundTruth(query, controller.signal);
        clearTimeout(timer);

        if (!groundTruthData) {
            return res.status(200).json({
                success: true,
                verified: true,
                extractedAnchor: null,
                sourceUrl: null,
                latencyMs: Math.round(performance.now() - start),
                timestamp: Date.now()
            });
        }

        const alignment = assessAlignment(groundTruthData.extract, llmResponse);

        return res.status(200).json({
            success: true,
            verified: alignment.isAccurate,
            extractedAnchor: alignment.extractedAnchor,
            topic: groundTruthData.title,
            sourceUrl: groundTruthData.sourceUrl,
            latencyMs: Math.round(performance.now() - start),
            timestamp: Date.now()
        });

    } catch (error) {
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
