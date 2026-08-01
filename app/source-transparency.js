function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function extractSources(text) {
    const raw = String(text || '');
    const match = raw.match(/(?:^|\n)Sources:\s*\n([\s\S]*)$/i);
    if (!match) return [];
    return match[1]
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 8);
}

export function buildSourceTransparencyHtml(meta = {}) {
    return '';
}

export function appendSourceTransparencyToMessage(text, meta = {}) {
    return String(text || '').trim();
}
