import net from 'node:net';

export function isPublicWebUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return false;
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
        if (!host || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(host) || host === 'metadata.google.internal') return false;
        if (net.isIP(host) === 4) {
            const [a, b] = host.split('.').map(Number);
            return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19));
        }
        if (net.isIP(host) === 6) return !/^(?:::|fc|fd|fe[89ab]|ff)/i.test(host);
        return host.includes('.');
    } catch { return false; }
}

export async function fetchPublicPage(url, init = {}) {
    let target = url;
    for (let hop = 0; hop < 5; hop++) {
        if (!isPublicWebUrl(target) || init.signal?.aborted) return null;
        const response = await fetch(target, { ...init, redirect: 'manual' });
        if (response.status >= 300 && response.status < 400) {
            const location = response.headers.get('location');
            await response.body?.cancel().catch(() => {});
            if (!location) return null;
            target = new URL(location, target).toString();
        } else return { response, url: target };
    }
    return null;
}
