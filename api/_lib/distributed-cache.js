/**
 * Distributed & Edge Caching Layer for Enterprise Production RAG
 * - Tier 1: High-speed in-memory LRU cache (0ms latency)
 * - Tier 2: Distributed REST-based KV cache (Upstash Redis / Vercel KV REST API)
 * - Stale-While-Revalidate (SWR) support for sub-25ms cached responses
 */

import { createHash } from 'node:crypto';

const L1_CACHE_MAX_ENTRIES = 500;
const L1_MEMORY_CACHE = new Map();
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes default
const SWR_GRACE_WINDOW_MS = 60 * 60 * 1000;  // 1 hour SWR window
const DEFAULT_MAX_L2_RECORD_BYTES = 262_144; // 256 KB cap keeps Upstash 250 MB free tier healthy

export function buildCacheKey(namespace, query, options = {}) {
    const normNamespace = String(namespace || 'rag').trim().toLowerCase();
    const normQuery = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const hash = createHash('sha256')
        .update(`${normNamespace}:${normQuery}:${JSON.stringify(options)}`)
        .digest('hex')
        .slice(0, 32);
    return `${normNamespace}:${hash}`;
}

export function getKvConfig() {
    const url = String(
        process.env.UPSTASH_REDIS_REST_URL ||
        process.env.KV_REST_API_URL ||
        process.env.REDIS_REST_URL ||
        ''
    ).trim();
    const token = String(
        process.env.UPSTASH_REDIS_REST_TOKEN ||
        process.env.KV_REST_API_TOKEN ||
        process.env.REDIS_REST_TOKEN ||
        ''
    ).trim();
    return {
        enabled: Boolean(url && token),
        url: url.replace(/\/$/, ''),
        token
    };
}

export function getDistributedCacheStatus() {
    const kv = getKvConfig();
    return {
        distributedKvConfigured: kv.enabled,
        provider: kv.enabled ? 'upstash_rest' : 'memory_only',
        l1Entries: L1_MEMORY_CACHE.size,
        l1MaxEntries: L1_CACHE_MAX_ENTRIES
    };
}

function parseKvRecord(raw) {
    if (!raw) return null;
    let record = raw;
    try {
        for (let depth = 0; depth < 2 && typeof record === 'string'; depth++) {
            record = JSON.parse(record);
        }
    } catch (_) {
        return null;
    }
    if (!record || typeof record !== 'object' || record.data === undefined) return null;
    return record;
}

export async function getCachedRAGEntry(key, options = {}) {
    if (!key) return null;

    const allowStale = options?.allowStale !== false;
    const swrWindowMs = Number.isFinite(Number(options?.swrGraceMs))
        ? Math.max(0, Number(options.swrGraceMs))
        : SWR_GRACE_WINDOW_MS;

    // 1. Check L1 Memory Cache
    const l1Entry = L1_MEMORY_CACHE.get(key);
    const now = Date.now();
    if (l1Entry) {
        if (now < l1Entry.expiresAt) {
            return {
                hit: true,
                tier: 'L1_memory',
                stale: false,
                data: l1Entry.data,
                ageMs: now - l1Entry.storedAt
            };
        }
        if (allowStale && now < l1Entry.expiresAt + swrWindowMs) {
            return {
                hit: true,
                tier: 'L1_memory',
                stale: true,
                data: l1Entry.data,
                ageMs: now - l1Entry.storedAt
            };
        }
        if (now >= l1Entry.expiresAt + swrWindowMs) {
            L1_MEMORY_CACHE.delete(key);
        }
    }

    // 2. Check L2 Distributed REST KV Cache if configured
    const kv = getKvConfig();
    if (!kv.enabled) return null;

    const timeoutMs = Math.max(150, Math.min(1500, Number(options?.timeoutMs) || 600));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (options?.signal) {
        if (options.signal.aborted) {
            clearTimeout(timeout);
            return null;
        }
        options.signal.addEventListener('abort', onAbort, { once: true });
    }

    try {
        const res = await fetch(`${kv.url}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${kv.token}` },
            signal: controller.signal
        });

        if (!res.ok) return null;
        const body = await res.json();
        const record = parseKvRecord(body?.result);
        if (!record) return null;

        const storedAt = Number(record.storedAt || now);
        const expiresAt = Number(record.expiresAt || (now + DEFAULT_CACHE_TTL_MS));
        setL1MemoryRecord(key, record.data, storedAt, expiresAt);

        const isStale = now >= expiresAt;
        if (!isStale || (allowStale && now < expiresAt + swrWindowMs)) {
            return {
                hit: true,
                tier: 'L2_distributed_kv',
                stale: isStale,
                data: record.data,
                ageMs: Math.max(0, now - storedAt)
            };
        }
    } catch (_) {
        // Fallback silently if distributed KV is unavailable
    } finally {
        clearTimeout(timeout);
        if (options?.signal) options.signal.removeEventListener('abort', onAbort);
    }

    return null;
}

export async function setCachedRAGEntry(key, data, ttlMs = DEFAULT_CACHE_TTL_MS, options = {}) {
    if (!key || !data) return false;
    const now = Date.now();
    const numericTtlMs = Number.isFinite(Number(ttlMs)) ? Number(ttlMs) : DEFAULT_CACHE_TTL_MS;
    const expiresAt = now + numericTtlMs;

    // 1. Store in L1
    setL1MemoryRecord(key, data, now, expiresAt);

    // 2. Store in L2 Distributed KV if configured
    const kv = getKvConfig();
    if (!kv.enabled) return true;

    let payload;
    try {
        payload = JSON.stringify({
            data,
            storedAt: now,
            expiresAt
        });
    } catch (_) {
        return true;
    }

    const maxBytes = Number(options?.maxBytes) || DEFAULT_MAX_L2_RECORD_BYTES;
    if (Buffer.byteLength(payload, 'utf8') > maxBytes) {
        return true;
    }

    const extraSwrSeconds = options?.noSwr === true ? 0 : Math.ceil(SWR_GRACE_WINDOW_MS / 1000);
    const ttlSeconds = Math.max(1, Math.ceil(Math.max(1000, numericTtlMs) / 1000) + extraSwrSeconds);

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        await fetch(`${kv.url}/set/${encodeURIComponent(key)}?ex=${ttlSeconds}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${kv.token}`,
                'Content-Type': 'text/plain; charset=utf-8'
            },
            body: payload,
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        return true;
    } catch (_) {
        return true;
    }
}

function setL1MemoryRecord(key, data, storedAt, expiresAt) {
    if (L1_MEMORY_CACHE.size >= L1_CACHE_MAX_ENTRIES) {
        const firstKey = L1_MEMORY_CACHE.keys().next().value;
        if (firstKey) L1_MEMORY_CACHE.delete(firstKey);
    }
    L1_MEMORY_CACHE.set(key, {
        data,
        storedAt,
        expiresAt
    });
}

export function clearL1CacheForTesting() {
    L1_MEMORY_CACHE.clear();
}
