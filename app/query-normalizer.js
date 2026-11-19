/**
 * Canonical Query Normalization & Searchable Content Validation Module
 * 
 * Provides unified, single-source-of-truth query sanitization across the entire
 * Jarvis Assistant application (DOM input, bounded live research, and fallback generation).
 */

/**
 * Normalizes a user query by safely converting null/undefined, normalizing HTML &nbsp;,
 * stripping standalone blank glyphs, removing Unicode format characters (\p{Cf}),
 * normalizing Unicode whitespace (\p{Zs}), collapsing repeated whitespace, and trimming.
 * 
 * Preserves all legitimate multilingual characters across English, Hindi, Tamil,
 * Kannada, Chinese, Japanese, and all other Unicode scripts.
 * 
 * @param {*} value - Raw user query or string
 * @returns {string} - Clean, normalized query string
 */
export function normalizeUserQuery(value) {
    if (value == null) return '';
    let text = String(value);

    // 1. Normalize HTML non-breaking space entities
    text = text.replace(/&nbsp;/gi, ' ');

    // 2. Normalize standalone blank glyphs (Braille pattern blank, Hangul fillers)
    text = text.replace(/[\u2800\u3164\uFFA0]/g, ' ');

    // 3. Remove Unicode format characters (\p{Cf}: zero-width spaces, bidi marks, word joiners, BOM, etc.)
    text = text.replace(/\p{Cf}/gu, '');

    // 4. Normalize all Unicode space separators (\p{Zs}) and ASCII whitespace controls to standard space
    text = text.replace(/[\p{Zs}\s]+/gu, ' ');

    return text.trim();
}

/**
 * Validates whether a query contains searchable content (at least one Unicode letter or number).
 * 
 * @param {*} value - Query to evaluate
 * @returns {boolean} - True if query contains at least one letter or number
 */
export function hasSearchableContent(value) {
    const normalized = normalizeUserQuery(value);
    return /[\p{L}\p{N}]/u.test(normalized);
}

// Global namespace registration for browser environments
if (typeof window !== 'undefined') {
    window.JarvisQueryNormalizer = {
        normalizeUserQuery,
        hasSearchableContent
    };
    window.normalizeUserQuery = normalizeUserQuery;
    window.hasSearchableContent = hasSearchableContent;
}
