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
    const sourceType = String(meta?.sourceType || '').toLowerCase();
    const route = String(meta?.route || meta?.routing?.strategy || '').trim();
    const routeReason = String(meta?.routeReason || meta?.routing?.reason || '').trim();
    const sources = Array.isArray(meta?.sources) ? meta.sources.map(String).filter(Boolean) : extractSources(meta?.text || '');
    const verified = sourceType === 'verified' || meta?.verified === true || route === 'live_first';
    const label = verified ? 'Checked against sources' : (route ? `Route: ${route}` : 'Model answer');
    const parts = [`<div class="source-transparency-badge" data-verified="${verified ? 'true' : 'false'}">`];
    parts.push(`<span class="source-transparency-label">${escapeHtml(label)}</span>`);
    if (routeReason) {
        parts.push(`<span class="source-transparency-reason">${escapeHtml(routeReason)}</span>`);
    }
    if (sources.length) {
        parts.push('<ul class="source-transparency-list">');
        sources.slice(0, 5).forEach(source => {
            parts.push(`<li>${escapeHtml(source)}</li>`);
        });
        parts.push('</ul>');
    }
    parts.push('</div>');
    return parts.join('');
}

export function appendSourceTransparencyToMessage(text, meta = {}) {
    const body = String(text || '').trim();
    const badge = buildSourceTransparencyHtml({ ...meta, text: body });
    if (!badge) return body;
    return `${badge}\n${body}`.trim();
}
