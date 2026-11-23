import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns';
import { Agent } from 'undici';

const ipv6Global = new net.BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Reserved = new net.BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) ipv6Reserved.addSubnet(address, prefix, 'ipv6');

export function isPublicAddress(address) {
    if (net.isIP(address) === 4) {
        const [a, b, c] = address.split('.').map(Number);
        return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
            a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
            a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2)) ||
            a === 100 && b >= 64 && b <= 127 ||
            a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
            a === 203 && b === 0 && c === 113);
    }
    return net.isIP(address) === 6 && ipv6Global.check(address, 'ipv6') && !ipv6Reserved.check(address, 'ipv6');
}

export function isPublicWebUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return false;
        const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
        if (!host || /(?:^|\.)(?:localhost|local|internal|invalid)$/.test(host)) return false;
        return net.isIP(host) ? isPublicAddress(host) : host.includes('.');
    } catch { return false; }
}

// Return the exact vetted DNS answers to the socket, avoiding a second lookup.
export function createPublicLookup(lookup = dnsLookup) {
    return (hostname, options, callback) => {
        lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error) return callback(error);
            if (!addresses?.length || addresses.some(row => !isPublicAddress(row.address))) {
                return callback(Object.assign(new Error('Private network destinations are blocked.'), { code: 'ERR_PRIVATE_ADDRESS' }));
            }
            const family = Number(options?.family) || 0;
            const usable = addresses.filter(row => !family || row.family === family);
            if (!usable.length) return callback(Object.assign(new Error('No public address for this address family.'), { code: 'ENOTFOUND' }));
            if (options?.all) callback(null, usable);
            else callback(null, usable[0].address, usable[0].family);
        });
    };
}

export async function fetchPublicPage(url, init = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('Page deadline exceeded.', 'TimeoutError')), Math.min(10000, init.timeoutMs || 10000));
    const signal = init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal;
    const dispatcher = new Agent({ connect: { lookup: createPublicLookup() }, headersTimeout: 10000, bodyTimeout: 10000 });
    let target = url;
    try {
        const headers = new Headers(init.headers);
        for (const key of ['authorization', 'cookie', 'proxy-authorization', 'host']) headers.delete(key);
        for (let hop = 0; hop < 5; hop++) {
            if (!isPublicWebUrl(target)) return null;
            signal.throwIfAborted();
            const response = await fetch(target, { method: 'GET', headers, signal, dispatcher, redirect: 'manual' });
            if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get('location');
                await response.body?.cancel();
                if (!location) return null;
                target = new URL(location, target).toString();
                continue;
            }
            const type = response.headers.get('content-type') || '';
            if (type && !/^(?:text\/|application\/(?:xhtml\+xml|xml|json))/i.test(type)) { await response.body?.cancel(); return null; }
            const limit = Math.min(2_000_000, init.maxBytes || 2_000_000);
            const chunks = []; let size = 0; let truncated = false;
            const reader = response.body?.getReader();
            try {
                while (reader) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const available = limit - size;
                    const chunk = value.subarray(0, available);
                    chunks.push(chunk); size += chunk.byteLength;
                    if (value.byteLength > available || size >= limit) {
                        truncated = true; await reader.cancel(); break;
                    }
                }
            } finally { reader?.releaseLock(); }
            signal.throwIfAborted();
            const cleanHeaders = new Headers(response.headers);
            cleanHeaders.delete('content-encoding'); cleanHeaders.delete('content-length');
            return { response: new Response(response.status === 204 || response.status === 304 ? null : Buffer.concat(chunks), { status: response.status, headers: cleanHeaders }), url: target, truncated };
        }
        return null;
    } finally {
        clearTimeout(timer);
        await dispatcher.destroy();
    }
}
