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
        .filter(line => line && !/^sources?:\s*$/i.test(line))
        .slice(0, 8)
        .map(parseSourceLine)
        .filter(Boolean);
}

function parseSourceLine(line) {
    const raw = String(line || '').trim().replace(/^[-*•]\s*/, '').replace(/^\d+[\.)]\s*/, '');
    if (!raw) return null;
    const md = raw.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/);
    if (md) {
        return { title: md[1].trim(), url: md[2].trim(), domain: domainFromUrl(md[2]) };
    }
    const urlMatch = raw.match(/(https?:\/\/[^\s)]+)/i);
    if (urlMatch) {
        const url = urlMatch[1].replace(/[.,;:]+$/, '');
        const title = raw.replace(urlMatch[0], '').replace(/[\s|—–-]+$/g, '').trim() || domainFromUrl(url);
        return { title, url, domain: domainFromUrl(url) };
    }
    return { title: raw, url: '', domain: '' };
}

function domainFromUrl(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./i, '');
    } catch (_) {
        return '';
    }
}

function normalizeSourceItems(items = []) {
    if (!Array.isArray(items)) return [];
    return items
        .map(item => {
            if (typeof item === 'string') return parseSourceLine(item);
            if (!item || typeof item !== 'object') return null;
            const url = String(item.url || '').trim();
            const title = String(item.title || item.sourceLabel || item.domain || '').trim() || domainFromUrl(url) || 'Source';
            return {
                title,
                url,
                domain: String(item.domain || domainFromUrl(url) || '').trim()
            };
        })
        .filter(item => item && (item.title || item.url))
        .slice(0, 8);
}

export function splitAnswerAndSources(text) {
    const raw = String(text || '').trim();
    if (!raw) return { answer: '', sources: [] };
    const match = raw.match(/(?:^|\n)Sources:\s*\n?/i);
    if (!match || match.index == null) {
        return { answer: raw, sources: [] };
    }
    const answer = raw.slice(0, match.index).replace(/\n{2,}/g, '\n\n').trim();
    const sources = extractSources(raw);
    return { answer, sources };
}

export function buildSourceTransparencyHtml(meta = {}, text = '') {
    const split = splitAnswerAndSources(text);
    const sources = normalizeSourceItems(
        (Array.isArray(meta?.sources) && meta.sources.length)
            ? meta.sources
            : ((Array.isArray(meta?.evidenceUsed) && meta.evidenceUsed.length)
                ? meta.evidenceUsed
                : ((Array.isArray(meta?.evidenceSources) && meta.evidenceSources.length)
                    ? meta.evidenceSources
                    : split.sources))
    );

    const sourceType = String(meta?.sourceType || '').toLowerCase();
    const verified = meta?.verified === true
        || sourceType === 'verified'
        || Boolean(meta?.routing?.verified)
        || sources.length > 0 && /verified/i.test(String(meta?.sourceLabel || ''));
    const reason = String(meta?.reason || meta?.sourceReason || '').trim();

    if (!sources.length && !verified && !reason && sourceType !== 'verified') {
        return '';
    }

    const badgeLabel = verified ? 'Verified sources' : (sources.length ? 'Sources checked' : 'Generated answer');
    const listHtml = sources.length
        ? `<ul class="source-transparency-list">${sources.map(item => {
            const label = escapeHtml(item.title || item.domain || 'Source');
            const domain = item.domain ? `<span class="source-transparency-domain">${escapeHtml(item.domain)}</span>` : '';
            if (item.url && /^https?:\/\//i.test(item.url)) {
                return `<li><a href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">${label}</a>${domain}</li>`;
            }
            return `<li><span>${label}</span>${domain}</li>`;
        }).join('')}</ul>`
        : '';

    return `
        <div class="source-transparency" data-verified="${verified ? 'true' : 'false'}">
            <div class="source-transparency-badge" data-verified="${verified ? 'true' : 'false'}">${escapeHtml(badgeLabel)}</div>
            ${reason ? `<p class="source-transparency-reason">${escapeHtml(reason)}</p>` : ''}
            ${listHtml}
        </div>
    `.trim();
}

export function appendSourceTransparencyToMessage(text, meta = {}) {
    const split = splitAnswerAndSources(text);
    const html = buildSourceTransparencyHtml({
        ...meta,
        sources: meta?.sources || meta?.evidenceUsed || meta?.evidenceSources || split.sources
    }, text);
    if (!html) return String(text || '').trim();
    const answer = split.answer || String(text || '').trim();
    return `${answer}\n\n${html}`.trim();
}

export const __test = {
    extractSources,
    parseSourceLine,
    splitAnswerAndSources,
    normalizeSourceItems
};
