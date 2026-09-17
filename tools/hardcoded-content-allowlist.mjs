/**
 * HARDCODED_CONTENT_ALLOWLIST
 *
 * Strictly reserved for legitimate operational and configuration identifiers that
 * must remain hardcoded (e.g. external data provider names, source registry labels,
 * runtime UI event/action names, and JSON parser property access fragments).
 *
 * This allowlist is strictly for operational/configuration literals and NOT for
 * content classification. It must NEVER be used to preserve entity names, topics,
 * keywords, companies, songs, movies, science concepts, monuments, political terms,
 * or other answer-content vocabulary.
 */
export const HARDCODED_CONTENT_ALLOWLIST = Object.freeze([
    {
        pattern: String.raw`\bNASA EONET\b`,
        category: 'allowed_config',
        reason: 'Operational free-live disaster data provider name, not answer content.'
    },
    {
        pattern: String.raw`\bOpenAI News\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\bAnthropic News\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\bVercel Blog\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\bNext\.js Blog\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\bReact Blog\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\bHacker News\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    },
    {
        pattern: String.raw`\barXiv Computer Science\b`,
        category: 'allowed_config',
        reason: 'Operational latest-source registry label.'
    }
]);
