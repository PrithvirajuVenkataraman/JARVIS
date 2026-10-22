/**
 * Stage 0: Short-TTL Search Response Cache
 * ─────────────────────────────────────────
 * In-memory response cache for repeated search queries with explicit HIT/MISS logging.
 *
 * Feature Flag:
 *  SEARCH_STAGE0_CACHE_ENABLED=true or SEARCH_RESPONSE_CACHE_ENABLED=true (default: false)
 *  Also activated per-call via options.responseCache = true
 *
 * Characteristics:
 *  - Short default TTL (60s) to keep live results reasonably fresh
 *  - Max cache size of 200 entries to prevent memory growth
 *  - Strict hit/miss outcome logging 
 */

import { createHash } from 'node:crypto';

const DEFAULT_CACHE_TTL_MS = 60 * 1000; // 60 seconds
const MAX_CACHE_ENTRIES = 200;
const SEARCH_RESPONSE_CACHE = new Map();

let cacheStats = {
    hits: 0,
    misses: 0,
    stores: 0,
    evictions: 0
};

export function isResponseCacheEnabled(options = {}) {
    if (options && typeof options.responseCache === 'boolean') {
        return options.responseCache;
    }
    return String(process.env.SEARCH_STAGE0_CACHE_ENABLED || process.env.SEARCH_RESPONSE_CACHE_ENABLED || '').trim().toLowerCase() === 'true';
}

export function buildSearchCacheKey(query = '', options = {}) {
    const normQ = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const signature = JSON.stringify({
        q: normQ,
        limit: options.limit || 8,
        mode: options.mode || 'default',
        dateFilter: options.dateFilter || null
    });
    return createHash('sha256').update(signature).digest('hex').slice(0, 32);
}

export function getSearchResponseCache(key, query = '', options = {}) {
    if (!isResponseCacheEnabled(options) || !key) return null;

    const entry = SEARCH_RESPONSE_CACHE.get(key);
    const now = Date.now();

    if (entry) {
        if (now < entry.expiresAt) {
            cacheStats.hits++;
            const ageMs = now - entry.storedAt;
            console.log(`[SearchResponseCache] HIT: "${query.slice(0, 45)}" (age=${ageMs}ms, entries=${SEARCH_RESPONSE_CACHE.size})`);
            return {
                hit: true,
                ageMs,
                data: entry.data
            };
        }
        // Expired
        SEARCH_RESPONSE_CACHE.delete(key);
    }

    cacheStats.misses++;
    console.log(`[SearchResponseCache] MISS: "${query.slice(0, 45)}" (entries=${SEARCH_RESPONSE_CACHE.size})`);
    return null;
}

export function setSearchResponseCache(key, data, options = {}, query = '', customTtlMs = null) {
    if (!isResponseCacheEnabled(options) || !key || !data) return;

    // Prune oldest if at capacity
    if (SEARCH_RESPONSE_CACHE.size >= MAX_CACHE_ENTRIES) {
        const oldestKey = SEARCH_RESPONSE_CACHE.keys().next().value;
        if (oldestKey) {
            SEARCH_RESPONSE_CACHE.delete(oldestKey);
            cacheStats.evictions++;
        }
    }

    const ttlMs = Number(customTtlMs || options.cacheTtlMs) || DEFAULT_CACHE_TTL_MS;
    const now = Date.now();

    SEARCH_RESPONSE_CACHE.set(key, {
        storedAt: now,
        expiresAt: now + ttlMs,
        data
    });
    cacheStats.stores++;
}

export function clearSearchResponseCache() {
    SEARCH_RESPONSE_CACHE.clear();
    cacheStats = {
        hits: 0,
        misses: 0,
        stores: 0,
        evictions: 0
    };
}

export function getSearchCacheStats() {
    return {
        ...cacheStats,
        size: SEARCH_RESPONSE_CACHE.size,
        maxSize: MAX_CACHE_ENTRIES
    };
}
