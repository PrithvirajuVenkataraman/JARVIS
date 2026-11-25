// Shared grammar gate; identity is verified against Wikidata or public sources by the server.
const ANAPHORIC_OR_COMMAND_RE = /^(?:create|generate|render|make|draw|paint|sketch|write|draft|compose|read|extract|analy[sz]e|evaluate|check|review|edit|convert|translate|summarize|explain|calculate|solve|compare|describe|identify|help)\b/i;
const PRONOUN_REFERENCE_RE = /\b(?:it|its|this|that|he|him|his|she|her|they|them|their|above|earlier|previous)\b/i;
const VAGUE_PERSON_SEEKING_RE = /^(?:who\s+(?:is|was|are|were|founded|co-founded|created|leads|runs|owns|heads|directed|plays|played)|tell\s+me\s+(?:who|about)|find\s+(?:out\s+)?who)\b|\b(?:ceo|founder|co-founder|president|chairman|chairperson|director|actor|actress|singer|author|writer|scientist|politician|leader|owner|captain|coach)\b/i;
const NON_PERSON_NAME_TOKEN_RE = /^(?:inc|corp|corporation|llc|ltd|limited|company|group|holdings|university|college|institute|foundation|organization|association|ministry|department|government|republic|kingdom|state|city|county|yes|no|here|there|sorry|could|which|please|note|disclaimer|source|wikipedia)$/i;
const REFUSAL_OR_CLARIFICATION_START_RE = /^(?:i(?:'m| am)\s+(?:not\s+sure|unable|sorry)|i\s+(?:could(?:n't| not)|can(?:n't| not)|do\s+not|don't)\b|could\s+you\s+(?:let\s+me\s+know|clarify|specify)|which\s+\w+\s+are\s+you|please\s+(?:clarify|specify|provide)|sorry\b)/i;

export function personPhotoQuery(input, reference = null) {
    if (reference?.status === 'ambiguous' || reference?.evidenceIds?.length) return '';
    let text = String(input || '').trim();
    if (!text || text.length > 180 || /[\n`<>{}=]/.test(text)) return '';
    text = text.replace(/^(?:please\s+)?(?:show|find|get|give)(?:\s+me)?\s+(?:(?:the|an?)\s+)?(?:(?:latest|recent|current|new|newest|real|actual|existing)\s+)?(?:photo|picture|image|portrait)s?\s+of\s+/i, '')
        .replace(/^(?:(?:latest|recent|current|new|newest|real|actual|existing)\s+)?(?:photo|picture|image|portrait)s?\s+of\s+/i, '')
        .replace(/^(?:who\s+(?:is|was)|tell\s+me\s+about|search\s+for|look\s+up)\s+/i, '')
        .replace(/\s+(?:(?:latest|recent|current|new)\s+)?(?:photo|picture|image|portrait)s?$/i, '')
        .replace(/[?!.,]+$/, '').trim();
    if (!/^[\p{L}\p{M}][\p{L}\p{M}\s.'’\-()]{1,110}$/u.test(text) || text.split(/\s+/).length > 6) return '';
    if (/^(?:read|extract|analy[sz]e|evaluate|check|write|review|generate|create|edit|convert)\b/i.test(text)) return '';
    if (/\b(?:it|its|this|that|he|him|his|she|her|they|them|their|above|earlier|previous|what|where|why|how|which|hello|thanks|please|explain|calculate|solve|compare|describe|identify|translate|summarize|help)\b/i.test(text)) return '';
    return text;
}

function cleanAnswerLead(answerText = '') {
    return String(answerText || '')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[*_`#>]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function isValidPersonNameCandidate(candidate = '') {
    const words = String(candidate || '').trim().split(/\s+/).filter(Boolean);
    if (words.length < 2 || words.length > 4) return false;
    if (words.some(word => NON_PERSON_NAME_TOKEN_RE.test(word.replace(/[.,'’()-]+$/g, '')))) return false;
    const capitalizedCount = words.filter(word => /^\p{Lu}/u.test(word)).length;
    return capitalizedCount >= 2;
}

function extractContextHint(text = '', personName = '') {
    const clean = cleanAnswerLead(text).slice(0, 320);
    if (!clean) return '';
    const match = /\b(?:at|of|for|founded|co-founded|leads?|heads?)\s+(?:the\s+)?([A-Z][\p{L}\p{N}&.-]{1,40}(?:\s+[A-Z][\p{L}\p{N}&.-]{1,30})?)/u.exec(clean);
    const hint = String(match?.[1] || '').replace(/[.,;:!?]+$/g, '').trim();
    if (!hint || hint.toLowerCase() === personName.toLowerCase()) return '';
    return hint;
}

export function extractPersonFromAnswer(answerText = '') {
    const lead = cleanAnswerLead(answerText).slice(0, 420);
    if (!lead || REFUSAL_OR_CLARIFICATION_START_RE.test(lead)) return null;
    // Skip answers that clearly introduce co-equal multiple subjects in the lead ("X and Y co-founded...").
    if (/^[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,2}\s+and\s+[\p{Lu}][\p{L}'’-]+(?:\s+[\p{Lu}][\p{L}'’-]+){1,2}\b/u.test(lead)) return null;

    const NAME_PART = String.raw`[\p{Lu}][\p{L}'’.-]+(?:\s+(?:[\p{Lu}][\p{L}'’.-]+|de|da|del|van|von|al|bin|ibn|el)){1,3}`;
    const leadMatch = new RegExp(`^(${NAME_PART})(?=\\s+(?:is|was|serves|served|works|founded|co-founded|known)\\b|\\s*,|\\s*\\()`, 'u').exec(lead);
    if (leadMatch && isValidPersonNameCandidate(leadMatch[1])) {
        const name = leadMatch[1].trim();
        return { name, contextHint: extractContextHint(lead, name) };
    }
    const copulaMatch = new RegExp(`\\b(?:is|was)\\s+(${NAME_PART})(?=[.,;:\\s]|$)`, 'u').exec(lead);
    const copulaName = String(copulaMatch?.[1] || '').replace(/[.,;:!?]+$/g, '').trim();
    if (copulaName && isValidPersonNameCandidate(copulaName)) {
        return { name: copulaName, contextHint: extractContextHint(lead, copulaName) };
    }
    return null;
}

export function resolvePersonPhotoRequest(input, options = {}) {
    const reference = options.reference || null;
    if (reference?.status === 'ambiguous' || reference?.evidenceIds?.length) return null;
    const raw = String(input || '').trim();
    if (!raw || raw.length > 220 || /[\n`<>{}=]/.test(raw)) return null;
    if (ANAPHORIC_OR_COMMAND_RE.test(raw) || isCurrentPersonPhotoLookup(raw) === false && /^\/(?:image|img|draw|art)\b/i.test(raw)) return null;

    const directQuery = personPhotoQuery(raw, reference);
    const fromAnswer = options.answerText ? extractPersonFromAnswer(options.answerText) : null;
    if (directQuery) {
        return {
            query: directQuery,
            resolvedName: fromAnswer?.name || '',
            contextHint: fromAnswer?.contextHint || ''
        };
    }

    if (PRONOUN_REFERENCE_RE.test(raw) || /\b(?:explain|calculate|solve|compare|describe|identify|translate|summarize|hello|thanks)\b/i.test(raw)) {
        return null;
    }
    if (VAGUE_PERSON_SEEKING_RE.test(raw) && fromAnswer?.name) {
        return {
            query: fromAnswer.name,
            resolvedName: fromAnswer.name,
            contextHint: fromAnswer.contextHint || ''
        };
    }
    return null;
}

export function personPhotoSubject(input) {
    const query = personPhotoQuery(input);
    const roles = 'actor|actress|singer|musician|author|writer|scientist|politician|footballer|cricketer|director|composer';
    const leading = new RegExp(`^(${roles})\\s+(.+)$`, 'i').exec(query);
    const trailing = new RegExp(`^(.+?)\\s*\\((${roles})\\)$`, 'i').exec(query);
    const name = leading?.[2] || trailing?.[1] || query;
    const role = String(leading?.[1] || trailing?.[2] || '').toLowerCase();
    return { query, name, role: ({ actress: 'actor', writer: 'author' })[role] || role };
}

export function isCurrentPersonPhotoLookup(input) {
    const text = String(input || '').trim();
    return !/^(?:\/(?:image|img|draw|art)\b|(?:please\s+)?(?:generate|create|render|make|draw|paint|sketch)\b)/i.test(text)
        && /\b(?:latest|recent|current|newest|real|actual|existing)\s+(?:photo|picture|image|portrait)s?\b/i.test(text)
        && Boolean(personPhotoQuery(text));
}
