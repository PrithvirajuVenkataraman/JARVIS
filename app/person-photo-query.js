// Shared grammar gate; identity is verified against Wikidata by the server.
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
