/**
 * @file api/_lib/entity-verifier.js
 * @description Fallback validation routine that cross-checks time-sensitive political and structural entities
 * (e.g., elected officials, heads of government, corporate officers) against live sources from trusted domain namespaces.
 */

const TRUSTED_DOMAINS = new Set([
    'wikipedia.org',
    'en.wikipedia.org',
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'thehindu.com',
    'indianexpress.com',
    'ndtv.com',
    'timesofindia.indiatimes.com',
    'gov.in',
    'nic.in',
    'tn.gov.in',
    'india.gov.in',
    'whitehouse.gov',
    'gov.uk',
    'nih.gov',
    'cdc.gov',
    'who.int'
]);

/**
 * Extracts domain hostname from URL.
 * @param {string} rawUrl 
 * @returns {string}
 */
export function extractHostname(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

/**
 * Checks if a domain is within trusted namespaces.
 * @param {string} domain 
 * @returns {boolean}
 */
export function isTrustedDomain(domain) {
    const d = String(domain || '').toLowerCase().trim();
    if (!d) return false;
    if (TRUSTED_DOMAINS.has(d)) return true;
    return d.endsWith('.gov') || d.endsWith('.gov.in') || d.endsWith('.nic.in') || d.endsWith('.edu') || d.endsWith('.org');
}

/**
 * Identifies political or structural entity roles in text.
 * @param {string} text 
 * @returns {{ role: string, jurisdiction: string } | null}
 */
export function extractEntityTarget(text) {
    const t = String(text || '').toLowerCase();
    if (!t) return null;

    const roleMatches = [
        { regex: /\b(?:cm|chief minister)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Chief Minister' },
        { regex: /\b(?:pm|prime minister)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Prime Minister' },
        { regex: /\b(?:president)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'President' },
        { regex: /\b(?:governor)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Governor' },
        { regex: /\b(?:mayor)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Mayor' },
        { regex: /\b(?:ceo|chief executive officer)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'CEO' },
        { regex: /\b(?:chairman|chairperson)\s+(?:of\s+)?([a-z\s]+?)(?:\?|\.|\n|$|,)/i, role: 'Chairperson' }
    ];

    for (const item of roleMatches) {
        const match = t.match(item.regex);
        if (match && match[1]) {
            const rawJurisdiction = match[1].trim().replace(/\b(the|current|latest|now|today|is|who)\b/g, '').trim();
            if (rawJurisdiction.length >= 2 && rawJurisdiction.length <= 40) {
                return {
                    role: item.role,
                    jurisdiction: formatName(rawJurisdiction)
                };
            }
        }
    }

    // Direct role keyword fallback
    if (/\b(?:cm|chief minister)\b/i.test(t) && /\btamil\s*nadu\b/i.test(t)) {
        return { role: 'Chief Minister', jurisdiction: 'Tamil Nadu' };
    }
    if (/\b(?:pm|prime minister)\b/i.test(t) && /\bindia\b/i.test(t)) {
        return { role: 'Prime Minister', jurisdiction: 'India' };
    }
    if (/\b(?:president)\b/i.test(t) && /\b(?:usa|united states|america)\b/i.test(t)) {
        return { role: 'President', jurisdiction: 'United States' };
    }

    return null;
}

/**
 * Classifies entity temporal status from text snippets.
 * @param {string} entityName 
 * @param {string} role 
 * @param {Array<{ title?: string, description?: string, summary?: string, url?: string }>} snippets 
 * @param {number} [calendarYear]
 * @returns {{ status: 'incumbent' | 'former' | 'candidate' | 'unknown', confidence: number, evidenceSnippet: string }}
 */
export function classifyTemporalStatus(entityName, role, snippets = [], calendarYear = new Date().getUTCFullYear()) {
    const name = String(entityName || '').toLowerCase().trim();
    if (!name) return { status: 'unknown', confidence: 0, evidenceSnippet: '' };

    const pool = Array.isArray(snippets) ? snippets : [];
    let incumbentSignals = 0;
    let formerSignals = 0;
    let candidateSignals = 0;
    let bestEvidence = '';

    for (const item of pool) {
        const text = `${item?.title || ''} ${item?.description || ''} ${item?.summary || ''}`.toLowerCase();
        if (!text.includes(name)) continue;

        // Incumbent detection
        if (/\b(incumbent|serving since|assumed office|is the current|took oath|sworn in as)\b/.test(text)) {
            incumbentSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }

        // Former detection
        if (/\b(former|predecessor|served from|stepped down|resigned|was the|until \d{4})\b/.test(text)) {
            formerSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }

        // Candidate / party leader detection
        if (/\b(candidate|contesting|party leader|founded|campaigning|presidential candidate|tvk|announced party|runs for)\b/.test(text)) {
            candidateSignals += 2;
            if (!bestEvidence) bestEvidence = String(item?.description || item?.title || '').trim();
        }
    }

    if (incumbentSignals > formerSignals && incumbentSignals > candidateSignals) {
        return { status: 'incumbent', confidence: Math.min(1.0, 0.6 + incumbentSignals * 0.1), evidenceSnippet: bestEvidence };
    }
    if (candidateSignals > incumbentSignals) {
        return { status: 'candidate', confidence: Math.min(1.0, 0.6 + candidateSignals * 0.1), evidenceSnippet: bestEvidence };
    }
    if (formerSignals > incumbentSignals) {
        return { status: 'former', confidence: Math.min(1.0, 0.6 + formerSignals * 0.1), evidenceSnippet: bestEvidence };
    }

    return { status: 'unknown', confidence: 0.3, evidenceSnippet: bestEvidence };
}

/**
 * Validates entity assertions in LLM responses and produces a verified source payload.
 * @param {string} query 
 * @param {string} responseText 
 * @param {Array<any>} liveSources 
 * @param {number} [calendarYear]
 * @returns {{
 *   discrepancyDetected: boolean,
 *   entityTarget: { role: string, jurisdiction: string } | null,
 *   verifiedSourceData: Record<string, any> | null,
 *   correctedText: string | null
 * }}
 */
export function validateEntityResponse(query, responseText, liveSources = [], calendarYear = new Date().getUTCFullYear()) {
    const target = extractEntityTarget(query) || extractEntityTarget(responseText);
    if (!target) {
        return {
            discrepancyDetected: false,
            entityTarget: null,
            verifiedSourceData: null,
            correctedText: null
        };
    }

    const sources = Array.isArray(liveSources) ? liveSources : [];
    const trustedSources = sources.filter(s => isTrustedDomain(extractHostname(s?.url || s?.domain)));
    const activeSources = trustedSources.length > 0 ? trustedSources : sources;

    // Detect mentioned names
    const mentionedEntities = [];
    const textLower = String(responseText || '').toLowerCase();
    const queryLower = String(query || '').toLowerCase();

    // Check specific known entities in regional context
    if (target.jurisdiction === 'Tamil Nadu' && target.role === 'Chief Minister') {
        if (textLower.includes('stalin') || queryLower.includes('stalin')) mentionedEntities.push('M. K. Stalin');
        if (textLower.includes('vijay') || queryLower.includes('vijay')) mentionedEntities.push('Vijay');
    }

    const entityStatuses = {};
    for (const ent of mentionedEntities) {
        entityStatuses[ent] = classifyTemporalStatus(ent, target.role, activeSources, calendarYear);
    }

    const verifiedPayload = {
        role: target.role,
        jurisdiction: target.jurisdiction,
        temporalAnchorYear: calendarYear,
        verifiedAt: new Date().toISOString(),
        sources: activeSources.slice(0, 4).map(s => ({
            title: String(s.title || s.source || s.domain || 'Source').trim(),
            url: String(s.url || '').trim(),
            domain: extractHostname(s.url || s.domain)
        })),
        entityBreakdown: entityStatuses
    };

    const isIncumbentAssertion = new RegExp(`\\bis the (?:current )?${target.role.toLowerCase()}\\b`, 'i').test(textLower);
    return {
        discrepancyDetected: Object.values(entityStatuses).some(s => s.status === 'candidate' && isIncumbentAssertion),
        entityTarget: target,
        verifiedSourceData: verifiedPayload,
        correctedText: null
    };
}

function formatName(str) {
    return String(str || '')
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}
