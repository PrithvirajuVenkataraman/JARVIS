/**
 * Favicon proxy endpoint.
 * Fetches favicons from Google/DuckDuckGo or target domains.
 * If 404 or unavailable, gracefully returns an SVG monogram with 200 OK
 * so the browser never logs 404 errors in the console.
 */

const faviconCache = new Map();
const MAX_CACHE = 500;

function generateMonogramSvg(domain = '') {
    const cleanDomain = String(domain || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].split(':')[0];
    const letter = (cleanDomain.charAt(0) || 'S').toUpperCase();
    let hash = 0;
    for (let i = 0; i < cleanDomain.length; i++) {
        hash = (hash << 5) - hash + cleanDomain.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="hsl(${hue}, 60%, 38%)"/><text x="50%" y="54%" font-family="system-ui, -apple-system, sans-serif" font-size="18" font-weight="700" fill="#ffffff" dominant-baseline="central" text-anchor="middle">${letter}</text></svg>`;
}

export default async function faviconHandler(req, res) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const url = new URL(req.url, 'http://localhost');
    const domain = (url.searchParams.get('domain') || req.query?.domain || '').trim().toLowerCase().replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];

    if (!domain) {
        const svg = generateMonogramSvg('web');
        res.setHeader('Content-Type', 'image/svg+xml');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(svg);
    }

    // Check memory cache
    if (faviconCache.has(domain)) {
        const cached = faviconCache.get(domain);
        res.setHeader('Content-Type', cached.contentType);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        return res.status(200).send(cached.body);
    }

    // Try Google S2 Favicon service with a 1500ms timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);

    try {
        const googleUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
        const upstream = await fetch(googleUrl, { signal: controller.signal });
        clearTimeout(timeout);

        if (upstream.ok) {
            const buffer = Buffer.from(await upstream.arrayBuffer());
            const contentType = upstream.headers.get('content-type') || 'image/png';
            if (faviconCache.size >= MAX_CACHE) {
                faviconCache.delete(faviconCache.keys().next().value);
            }
            faviconCache.set(domain, { contentType, body: buffer });
            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.status(200).send(buffer);
        }
    } catch {
        clearTimeout(timeout);
    }

    // Fallback: return SVG monogram with 200 OK so NO 404 is logged in console
    const fallbackSvg = generateMonogramSvg(domain);
    if (faviconCache.size >= MAX_CACHE) {
        faviconCache.delete(faviconCache.keys().next().value);
    }
    faviconCache.set(domain, { contentType: 'image/svg+xml', body: fallbackSvg });
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.status(200).send(fallbackSvg);
}
