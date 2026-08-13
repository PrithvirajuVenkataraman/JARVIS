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
    },
    // Runtime code strings - error messages, event names, template literals (not canned answers)
    {
        pattern: String.raw`song game recommendation (failed|empty)`,
        category: 'allowed_config',
        reason: 'Runtime error message for song game feature, not canned answer content.'
    },
    {
        pattern: String.raw`song game result invalid`,
        category: 'allowed_config',
        reason: 'Runtime error message for song game feature.'
    },
    {
        pattern: String.raw`song_game_(result|unavailable|invalid_reply|invalid_option)`,
        category: 'allowed_config',
        reason: 'Runtime event/action names for song game feature.'
    },
    {
        pattern: String.raw`I could not generate a song-game result right now\.`,
        category: 'allowed_config',
        reason: 'Runtime fallback message for song game feature.'
    },
    {
        pattern: String.raw`Song game cancelled\.`,
        category: 'allowed_config',
        reason: 'Runtime user-facing message for song game cancellation.'
    },
    {
        pattern: String.raw`Your situation song is \$\{result\.song\}\.`,
        category: 'allowed_config',
        reason: 'Runtime template literal for song game result composition.'
    },
    {
        pattern: String.raw`String\(parsed\.(song|artist|work|why) \|\| ''\)\.trim\(\)`,
        category: 'allowed_config',
        reason: 'Runtime JSON parser field normalization for song game model output.'
    },
    {
        pattern: String.raw`String\(item\?\.(song|artist|work) \|\| ''\)\.trim\(\)`,
        category: 'allowed_config',
        reason: 'Runtime JSON parser field normalization for song game backup model output.'
    },
    {
        pattern: String.raw`artist: result\.artist \|\| ''`,
        category: 'allowed_config',
        reason: 'Runtime song game result metadata fallback, not canned answer content.'
    },
    {
        pattern: String.raw`song:\s*String\(parsed\.song \|\|`,
        category: 'allowed_config',
        reason: 'Scanner fragment from runtime song game JSON parser.'
    },
    {
        pattern: String.raw`artist:\s*String\(parsed\.artist \|\|`,
        category: 'allowed_config',
        reason: 'Scanner fragment from runtime song game JSON parser.'
    },
    {
        pattern: String.raw`backups:\s*\(Array\.isArray\(parsed\.backups\)`,
        category: 'allowed_config',
        reason: 'Scanner fragment from runtime song game backup parser.'
    },
    {
        pattern: String.raw`artist:\s*String\(item\?\.artist \|\|`,
        category: 'allowed_config',
        reason: 'Scanner fragment from runtime song game backup parser.'
    },
    {
        pattern: String.raw`song:\s*result\.song,\s*artist:\s*result\.artist \|\|`,
        category: 'allowed_config',
        reason: 'Scanner fragment from runtime song game result metadata.'
    },
    {
        pattern: String.raw`language-era (hits|blend)`,
        category: 'allowed_config',
        reason: 'Runtime feature names for language-era music feature.'
    },
    {
        pattern: String.raw`era (hits|blend)`,
        category: 'allowed_config',
        reason: 'Runtime feature names for era-based music feature.'
    },
    {
        pattern: String.raw`buildEraLanguageHitsWithAI`,
        category: 'allowed_config',
        reason: 'Runtime function name for language-era hits feature.'
    },
    {
        pattern: String.raw`normalizeEraBucketsToExactCount`,
        category: 'allowed_config',
        reason: 'Runtime function name for era bucket normalization.'
    },
    {
        pattern: String.raw`formatLanguageEraHitsReply`,
        category: 'allowed_config',
        reason: 'Runtime function name for formatting language-era hits reply.'
    },
    {
        pattern: String.raw`renderLanguageEraHitsCard`,
        category: 'allowed_config',
        reason: 'Runtime function name for rendering language-era hits card.'
    }
]);
