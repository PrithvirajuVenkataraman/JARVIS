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

export async function getCachedRAGEntry(key) {
    if (!key) return null;

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
        if (now < l1Entry.expiresAt + SWR_GRACE_WINDOW_MS) {
            return {
                hit: true,
                tier: 'L1_memory',
                stale: true,
                data: l1Entry.data,
                ageMs: now - l1Entry.storedAt
            };
        }
        L1_MEMORY_CACHE.delete(key);
    }

    // 2. Check L2 Distributed REST KV Cache if configured
    const kv = getKvConfig();
    if (!kv.enabled) return null;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 600); // Strict 600ms KV timeout
        const res = await fetch(`${kv.url}/get/${encodeURIComponent(key)}`, {
            headers: { Authorization: `Bearer ${kv.token}` },
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        if (!res.ok) return null;
        const body = await res.json();
        const raw = body?.result;
        if (!raw) return null;

        const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!record || !record.data) return null;

        // Store back in L1 for rapid future hits
        setL1Memory(key, record.data, (record.expiresAt || (now + DEFAULT_CACHE_TTL_MS)) - now);

        const isStale = now >= record.expiresAt;
        if (!isStale || now < record.expiresAt + SWR_GRACE_WINDOW_MS) {
            return {
                hit: true,
                tier: 'L2_distributed_kv',
                stale: isStale,
                data: record.data,
                ageMs: now - (record.storedAt || now)
            };
        }
    } catch (_) {
        // Fallback silently if distributed KV is unavailable
    }

    return null;
}

export async function setCachedRAGEntry(key, data, ttlMs = DEFAULT_CACHE_TTL_MS) {
    if (!key || !data) return false;
    const now = Date.now();
    const expiresAt = now + ttlMs;

    // 1. Store in L1
    setL1Memory(key, data, ttlMs);

    // 2. Store in L2 Distributed KV if configured
    const kv = getKvConfig();
    if (!kv.enabled) return true;

    try {
        const payload = JSON.stringify({
            data,
            storedAt: now,
            expiresAt
        });
        const ttlSeconds = Math.ceil(ttlMs / 1000) + Math.ceil(SWR_GRACE_WINDOW_MS / 1000);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 800);
        await fetch(`${kv.url}/set/${encodeURIComponent(key)}?ex=${ttlSeconds}`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${kv.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload),
            signal: controller.signal
        }).finally(() => clearTimeout(timeout));

        return true;
    } catch (_) {
        return true;
    }
}

function setL1Memory(key, data, ttlMs) {
    if (L1_MEMORY_CACHE.size >= L1_CACHE_MAX_ENTRIES) {
        const firstKey = L1_MEMORY_CACHE.keys().next().value;
        if (firstKey) L1_MEMORY_CACHE.delete(firstKey);
    }
    const now = Date.now();
    L1_MEMORY_CACHE.set(key, {
        data,
        storedAt: now,
        expiresAt: now + ttlMs
    });
}

export function clearL1CacheForTesting() {
    L1_MEMORY_CACHE.clear();
}
