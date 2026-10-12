/**
 * Centralized Snippet & HTML/XML Entity Sanitizer
 * - Multi-pass recursive entity decoder for named, decimal, and hex XML/HTML entities
 * - Strips raw HTML tags and removes trailing publisher signatures/domains
 */

export function decodeHtmlEntities(str = '') {
    if (typeof str !== 'string' || !str) return '';
    let text = str;
    let prev = '';
    let iterations = 0;

    // Recursive entity resolution up to 3 passes to handle multi-encoded tokens
    while (text !== prev && iterations < 3) {
        prev = text;
        iterations += 1;
        text = text
            // Common named HTML entities
            .replace(/&nbsp;/gi, ' ')
            .replace(/&amp;/gi, '&')
            .replace(/&quot;/gi, '"')
            .replace(/&apos;/gi, "'")
            .replace(/&lt;/gi, '<')
            .replace(/&gt;/gi, '>')
            .replace(/&mdash;/gi, '—')
            .replace(/&ndash;/gi, '–')
            .replace(/&hellip;/gi, '...')
            // Decimal entities (e.g., &#160; for nbsp, &#39; for apostrophe, &#8217; for right single quote)
            .replace(/&#(\d+);?/g, (_, dec) => {
                const code = Number(dec);
                if (code === 160) return ' ';
                if (code === 8216 || code === 8217 || code === 39) return "'";
                if (code === 8220 || code === 8221 || code === 34) return '"';
                if (code === 8211) return '–';
                if (code === 8212) return '—';
                return code > 0 && code < 65536 ? String.fromCharCode(code) : '';
            })
            // Hexadecimal entities (e.g., &#x27; for apostrophe, &#xA0; for nbsp)
            .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
                const code = parseInt(hex, 16);
                if (code === 160) return ' ';
                if (code === 8216 || code === 8217 || code === 39) return "'";
                if (code === 8220 || code === 8221 || code === 34) return '"';
                if (code === 8211) return '–';
                if (code === 8212) return '—';
                return code > 0 && code < 65536 ? String.fromCharCode(code) : '';
            });
    }

    return text.replace(/\s+/g, ' ').trim();
}

export function cleanSnippetText(rawSnippet = '') {
    if (!rawSnippet) return '';
    // 1. Decode entities first so that encoded HTML tags like &lt;a href=...&gt; become real tags
    let text = decodeHtmlEntities(String(rawSnippet));
    // 2. Strip HTML tags (e.g. <font color="...">, <a>, <b>, <span>)
    text = text.replace(/<[^>]+>/g, ' ');
    // 3. Decode entities again in case inner text was multi-encoded
    text = decodeHtmlEntities(text);
    // 4. Ensure any remaining tags are fully stripped
    text = text.replace(/<[^>]+>/g, ' ');
    // 5. Strip trailing publisher attribution domains (e.g. "... cbs8.com", "... - BBC News", "... | Reuters", "... - news.bbc.co.uk")
    text = text
        .replace(/\s*(?:[—–|-]|\bvia\b|\bat\b)\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?\s*$/i, '')
        .replace(/\s+(?:https?:\/\/)?(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    return text;
}
