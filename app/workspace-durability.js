/**
 * Local-First Workspace Durability, Multi-Tab LWW Sync & Encrypted Backup Engine
 *
 * Three zero-cost production pillars running entirely client-side:
 * 1. Dual-Tier Write-Through IndexedDB Store:
 *    - Persists full, untruncated chat sessions (up to 500 sessions, full message bodies)
 *      in `jarvis_database_v1` (`sessions` object store) to break the 5MB localStorage cap.
 *    - Works alongside a lightweight localStorage hot-cache for 0ms instant boot.
 * 2. BroadcastChannel Multi-Tab LWW Sync:
 *    - Per-session & per-record Last-Write-Wins (LWW) conflict resolution by `updatedAt`
 *      with delete tombstones (`deletedIds`) so deleted items never resurrect.
 *    - Tracks live open tab count via lightweight presence heartbeats.
 *    - Never interrupts an active streaming response in another tab.
 * 3. Portable Encrypted Workspace Backup & Restore:
 *    - WebCrypto PBKDF2-SHA256 (310,000 iterations) + AES-256-GCM authenticated encryption.
 *    - Strictly excludes BYOK API keys (`jarvis_byok_*`, `groq_api_key`, `gemini_api_key`).
 *    - Supports Merge (LWW dedup) or Replace on restore.
 */

export const WORKSPACE_DB_NAME = 'jarvis_database_v1';
export const WORKSPACE_DB_VERSION = 1;
export const WORKSPACE_SESSIONS_STORE = 'sessions';
export const WORKSPACE_KV_STORE = 'kv_store';
export const WORKSPACE_SYNC_CHANNEL = 'jarvis_workspace_sync_v1';
export const WORKSPACE_BACKUP_FORMAT = 'jarvis-workspace-backup';
export const WORKSPACE_BACKUP_SCHEMA_VERSION = 1;
export const MAX_DURABLE_SESSIONS = 500;
export const HOT_CACHE_MAX_SESSIONS = 15;
export const PBKDF2_ITERATIONS = 310000;

const SECRET_KEY_PATTERN = /(?:byok|api[_-]?key|secret|token|password|sealed|private[_-]?key)/i;

// ─── BASE64 / BYTE HELPERS (BROWSER & NODE SAFE) ─────────────────────────────

function bytesToBase64(bytes) {
    const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (typeof Buffer !== 'undefined' && typeof btoa !== 'function') {
        return Buffer.from(arr).toString('base64');
    }
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < arr.length; i += chunkSize) {
        binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(b64) {
    const clean = String(b64 || '').trim();
    if (typeof Buffer !== 'undefined' && typeof atob !== 'function') {
        return new Uint8Array(Buffer.from(clean, 'base64'));
    }
    const binary = atob(clean);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function getWebCrypto() {
    const c = (typeof globalThis !== 'undefined' && globalThis.crypto) ||
        (typeof window !== 'undefined' && window.crypto) ||
        null;
    if (!c || !c.subtle || typeof c.getRandomValues !== 'function') {
        throw new Error('WebCrypto AES-256-GCM is unavailable in this environment.');
    }
    return c;
}

function toEpochMs(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (!value) return 0;
    const parsed = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : 0;
}

// ─── 1. DUAL-TIER INDEXEDDB STORE ────────────────────────────────────────────

export class WorkspaceIndexedDB {
    constructor(options = {}) {
        this.dbName = options.dbName || WORKSPACE_DB_NAME;
        this.dbVersion = options.dbVersion || WORKSPACE_DB_VERSION;
        this.sessionsStore = options.sessionsStore || WORKSPACE_SESSIONS_STORE;
        this.kvStore = options.kvStore || WORKSPACE_KV_STORE;
        this._dbPromise = null;
    }

    async open() {
        if (typeof indexedDB === 'undefined') return null;
        if (this._dbPromise) return this._dbPromise;
        this._dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(this.dbName, this.dbVersion);
                req.onupgradeneeded = (event) => {
                    const db = event.target.result;
                    if (!db.objectStoreNames.contains(this.kvStore)) {
                        db.createObjectStore(this.kvStore, { keyPath: 'key' });
                    }
                    if (!db.objectStoreNames.contains(this.sessionsStore)) {
                        db.createObjectStore(this.sessionsStore, { keyPath: 'id' });
                    }
                };
                req.onsuccess = (event) => {
                    const db = event.target.result;
                    db.onversionchange = () => {
                        try { db.close(); } catch (_) {}
                        this._dbPromise = null;
                    };
                    resolve(db);
                };
                req.onerror = () => {
                    this._dbPromise = null;
                    resolve(null);
                };
                req.onblocked = () => resolve(null);
            } catch (_) {
                this._dbPromise = null;
                resolve(null);
            }
        });
        return this._dbPromise;
    }

    async loadAllSessions() {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.sessionsStore)) return [];
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.sessionsStore, 'readonly');
                const store = tx.objectStore(this.sessionsStore);
                const req = store.getAll();
                req.onsuccess = () => {
                    const list = Array.isArray(req.result) ? req.result : [];
                    list.sort((a, b) => toEpochMs(a?.updatedAt || a?.createdAt) - toEpochMs(b?.updatedAt || b?.createdAt));
                    resolve(list);
                };
                req.onerror = () => resolve([]);
            } catch (_) {
                resolve([]);
            }
        });
    }

    async saveSessions(sessions = [], deletedIds = []) {
        const startedAt = globalThis.performance?.now() || 0;
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.sessionsStore)) return false;
        return new Promise(resolve => {
            try {
                const tx = db.transaction([this.sessionsStore, this.kvStore], 'readwrite');
                const store = tx.objectStore(this.sessionsStore);
                const kv = tx.objectStore(this.kvStore);
                const tombstones = kv.get('session_tombstones');
                tombstones.onsuccess = () => {
                    const deleted = [...new Set([...(tombstones.result?.value || []), ...Array.from(deletedIds || [])])];
                    const request = store.getAll();
                    request.onsuccess = () => {
                        const existing = request.result || [];
                        const merged = mergeChatSessionsLww(existing, sessions, deleted).slice(-MAX_DURABLE_SESSIONS);
                        const previous = new Map(existing.map(item => [item.id, JSON.stringify(item)]));
                        const retained = new Set(merged.map(item => item.id));
                        for (const item of merged) {
                            const clean = cloneDurableSession(item);
                            if (previous.get(item.id) !== JSON.stringify(clean)) store.put(clean);
                        }
                        for (const item of existing) if (!retained.has(item.id)) store.delete(item.id);
                        kv.put({key:'session_tombstones', value:deleted});
                    };
                };
                tx.oncomplete = () => {
                    globalThis.JarvisPerformance?.recordMetric('storage', (globalThis.performance?.now() || 0) - startedAt);
                    resolve(true);
                };
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch { resolve(false); }
        });
    }

    async replaceAllSessions(sessions = []) {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.sessionsStore)) return false;
        const bounded = (Array.isArray(sessions) ? sessions : [])
            .filter(s => s && s.id && !s.deleted)
            .slice(-MAX_DURABLE_SESSIONS);

        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.sessionsStore, 'readwrite');
                const store = tx.objectStore(this.sessionsStore);
                store.clear();
                for (const session of bounded) {
                    store.put(cloneDurableSession(session));
                }
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.onabort = () => resolve(false);
            } catch (_) {
                resolve(false);
            }
        });
    }

    async deleteSession(sessionId) {
        const id = String(sessionId || '').trim();
        if (!id) return false;
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.sessionsStore)) return false;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.sessionsStore, 'readwrite');
                tx.objectStore(this.sessionsStore).delete(id);
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (_) {
                resolve(false);
            }
        });
    }

    async clearAllSessions() {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.sessionsStore)) return false;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.sessionsStore, 'readwrite');
                tx.objectStore(this.sessionsStore).clear();
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (_) {
                resolve(false);
            }
        });
    }

    async putKv(key, value) {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.kvStore)) return false;
        const valStr = typeof value === 'string' ? value : JSON.stringify(value);
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.kvStore, 'readwrite');
                tx.objectStore(this.kvStore).put({ key: String(key), value: valStr, updatedAt: Date.now() });
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
            } catch (_) {
                resolve(false);
            }
        });
    }

    async getKv(key) {
        const db = await this.open();
        if (!db || !db.objectStoreNames.contains(this.kvStore)) return null;
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(this.kvStore, 'readonly');
                const req = tx.objectStore(this.kvStore).get(String(key));
                req.onsuccess = () => resolve(req.result?.value ?? null);
                req.onerror = () => resolve(null);
            } catch (_) {
                resolve(null);
            }
        });
    }

    async getStorageHealth() {
        let localStorageBytes = 0;
        let localStorageKeys = 0;
        try {
            if (typeof localStorage !== 'undefined') {
                localStorageKeys = localStorage.length;
                for (let i = 0; i < localStorage.length; i += 1) {
                    const k = localStorage.key(i) || '';
                    const v = localStorage.getItem(k) || '';
                    localStorageBytes += (k.length + v.length) * 2;
                }
            }
        } catch (_) {}

        const idbSessions = await this.loadAllSessions();
        let usageBytes = localStorageBytes;
        let quotaBytes = 0;
        let persisted = false;
        let estimateSupported = false;

        try {
            if (typeof navigator !== 'undefined' && navigator.storage) {
                if (typeof navigator.storage.estimate === 'function') {
                    const est = await navigator.storage.estimate();
                    usageBytes = Number(est?.usage || localStorageBytes);
                    quotaBytes = Number(est?.quota || 0);
                    estimateSupported = quotaBytes > 0;
                }
                if (typeof navigator.storage.persisted === 'function') {
                    persisted = Boolean(await navigator.storage.persisted());
                }
            }
        } catch (_) {}

        const localStorageQuotaBytes = 5 * 1024 * 1024;
        const percentUsed = quotaBytes > 0
            ? Math.min(100, Number(((usageBytes / quotaBytes) * 100).toFixed(2)))
            : Math.min(100, Number(((localStorageBytes / localStorageQuotaBytes) * 100).toFixed(2)));

        return {
            indexedDbReady: Boolean(await this.open()),
            durableSessionCount: idbSessions.length,
            localStorageBytes,
            localStorageKeys,
            localStoragePercent: Math.min(100, Number(((localStorageBytes / localStorageQuotaBytes) * 100).toFixed(1))),
            usageBytes,
            quotaBytes,
            percentUsed,
            estimateSupported,
            persisted
        };
    }

    async requestPersistentStorage() {
        try {
            if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.persist === 'function') {
                return Boolean(await navigator.storage.persist());
            }
        } catch (_) {}
        return false;
    }
}

export function cloneDurableSession(session) {
    if (!session || typeof session !== 'object') return null;
    return {
        id: String(session.id || ''),
        title: String(session.title || 'New chat').slice(0, 120),
        messages: (Array.isArray(session.messages) ? session.messages : []).map(item => ({
            role: item?.role === 'assistant' ? 'assistant' : 'user',
            text: String(item?.text || ''),
            timestamp: String(item?.timestamp || ''),
            turnId: String(item?.turnId || ''),
            answerStatus: item?.answerStatus || '',
            verified: item?.answerStatus === 'complete' && item?.verified === true,
            sources: (Array.isArray(item?.sources) ? item.sources : []).slice(0, 16).map(src => ({
                id: src?.id,
                title: String(src?.title || ''),
                url: String(src?.url || ''),
                domain: String(src?.domain || '')
            })),
            attachments: Array.isArray(item?.attachments)
                ? item.attachments.map(att => ({
                    name: String(att?.name || 'attachment').slice(0, 180),
                    mimeType: String(att?.mimeType || '').slice(0, 120),
                    size: Number(att?.size) || 0,
                    kind: String(att?.kind || 'file').slice(0, 20)
                }))
                : []
        })),
        createdAt: session.createdAt || new Date().toISOString(),
        updatedAt: session.updatedAt || session.createdAt || new Date().toISOString(),
        autoTitle: session.autoTitle !== false,
        titleEdited: session.titleEdited === true,
        pinned: session.pinned === true,
        webSearchMode: session.webSearchMode === 'force' ? 'force' : 'off',
        deleted: false
    };
}

// ─── 2. PER-SESSION & PER-RECORD LWW MERGE + MULTI-TAB SYNC ──────────────────

/**
 * Pure Last-Write-Wins (LWW) chat session merger with tombstones.
 * - Any ID present in `deletedIds` is strictly excluded (delete tombstone wins).
 * - If `activeStreamingSessionId` matches a session, the local streaming session's
 *   messages are protected from being overwritten mid-stream.
 */
export function mergeChatSessionsLww(localSessions = [], incomingSessions = [], deletedIds = [], options = {}) {
    const tombstoneSet = new Set(Array.isArray(deletedIds) ? deletedIds : Array.from(deletedIds || []));
    const activeStreamingId = String(options?.activeStreamingSessionId || '').trim();
    const byId = new Map();

    for (const s of (Array.isArray(localSessions) ? localSessions : [])) {
        if (!s || !s.id || s.deleted || tombstoneSet.has(s.id)) continue;
        byId.set(s.id, s);
    }

    for (const incoming of (Array.isArray(incomingSessions) ? incomingSessions : [])) {
        if (!incoming || !incoming.id || incoming.deleted || tombstoneSet.has(incoming.id)) continue;
        const existing = byId.get(incoming.id);
        if (!existing) {
            byId.set(incoming.id, incoming);
            continue;
        }
        if (activeStreamingId && incoming.id === activeStreamingId) {
            // Never interrupt active streaming in this tab; merge only harmless metadata if newer.
            const incTs = toEpochMs(incoming.updatedAt);
            const locTs = toEpochMs(existing.updatedAt);
            if (incTs > locTs) {
                byId.set(incoming.id, {
                    ...existing,
                    pinned: incoming.pinned,
                    title: incoming.titleEdited ? incoming.title : existing.title,
                    titleEdited: incoming.titleEdited || existing.titleEdited
                });
            }
            continue;
        }
        const incTs = toEpochMs(incoming.updatedAt || incoming.createdAt);
        const locTs = toEpochMs(existing.updatedAt || existing.createdAt);
        const incLen = Array.isArray(incoming.messages) ? incoming.messages.length : 0;
        const locLen = Array.isArray(existing.messages) ? existing.messages.length : 0;
        const incChars = (Array.isArray(incoming.messages) ? incoming.messages : []).reduce((sum, m) => sum + String(m?.text || '').length, 0);
        const locChars = (Array.isArray(existing.messages) ? existing.messages : []).reduce((sum, m) => sum + String(m?.text || '').length, 0);

        // Prefer newer timestamp; on equal timestamps, prefer the fuller (untruncated IndexedDB) payload
        if (incTs > locTs || (incTs === locTs && (incLen > locLen || (incLen === locLen && incChars > locChars)))) {
            byId.set(incoming.id, incoming);
        }
    }

    return Array.from(byId.values())
        .sort((a, b) => toEpochMs(a?.updatedAt || a?.createdAt) - toEpochMs(b?.updatedAt || b?.createdAt))
        .slice(-MAX_DURABLE_SESSIONS);
}

/**
 * Pure LWW merger for keyed memory / rule records with case-insensitive text deduplication.
 */
export function mergeRecordsLww(localRecords = [], incomingRecords = [], textField = 'text') {
    const byId = new Map();
    const seenTextToId = new Map();

    const insertRecord = (rec) => {
        if (!rec || typeof rec !== 'object') return;
        const textVal = String(rec[textField] || '').trim();
        if (!textVal) return;
        const normText = textVal.toLowerCase();
        const id = String(rec.id || normText);
        const existingId = byId.has(id) ? id : seenTextToId.get(normText);

        if (!existingId) {
            byId.set(id, { ...rec, id });
            seenTextToId.set(normText, id);
            return;
        }
        const existing = byId.get(existingId);
        const incTs = toEpochMs(rec.updatedAt || rec.createdAt || rec.detectedAt);
        const locTs = toEpochMs(existing.updatedAt || existing.createdAt || existing.detectedAt);
        if (incTs >= locTs) {
            byId.set(existingId, { ...existing, ...rec, id: existingId });
        }
    };

    for (const r of (Array.isArray(localRecords) ? localRecords : [])) insertRecord(r);
    for (const r of (Array.isArray(incomingRecords) ? incomingRecords : [])) insertRecord(r);

    return Array.from(byId.values());
}

export class WorkspaceTabSync {
    constructor(channelName = WORKSPACE_SYNC_CHANNEL) {
        this.channelName = channelName;
        this.tabId = `tab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        this.channel = null;
        this.listeners = new Set();
        this.peers = new Map(); // tabId -> lastSeenMs
        this._heartbeatTimer = null;
        this._boundStorageHandler = null;
        this._boundUnloadHandler = null;
    }

    start() {
        if (this.channel || this._boundStorageHandler) return this;

        if (typeof BroadcastChannel === 'function') {
            try {
                this.channel = new BroadcastChannel(this.channelName);
                this.channel.onmessage = (event) => this._handleIncoming(event?.data);
            } catch (_) {
                this.channel = null;
            }
        }

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            this._boundStorageHandler = (event) => {
                if (!event || !event.key) return;
                if (event.key === `${this.channelName}_ping` && event.newValue) {
                    try {
                        this._handleIncoming(JSON.parse(event.newValue));
                    } catch (_) {}
                } else if (event.key === 'jarvis_chat_sessions_v1') {
                    this._notify({ type: 'sessions_updated', source: 'storage_event', ts: Date.now() });
                } else if (event.key === 'jarvis_unified_memories_v1') {
                    this._notify({ type: 'memories_updated', source: 'storage_event', ts: Date.now() });
                } else if (event.key === 'jarvis_self_improving_memory_v1') {
                    this._notify({ type: 'rules_updated', source: 'storage_event', ts: Date.now() });
                } else if (event.key === 'jarvis_personalized_experience' || event.key === 'jarvis_theme_mode' || event.key === 'jarvis_selected_model' || event.key === 'jarvis_custom_system_prompt') {
                    this._notify({ type: 'settings_updated', key: event.key, source: 'storage_event', ts: Date.now() });
                }
            };
            window.addEventListener('storage', this._boundStorageHandler);

            this._boundUnloadHandler = () => {
                this.broadcast('tab_bye', {});
            };
            window.addEventListener('beforeunload', this._boundUnloadHandler);
        }

        this.broadcast('tab_hello', {});
        if (typeof setInterval === 'function') {
            this._heartbeatTimer = setInterval(() => {
                this._prunePeers();
                this.broadcast('tab_ping', {});
            }, 15000);
            if (this._heartbeatTimer && typeof this._heartbeatTimer.unref === 'function') {
                this._heartbeatTimer.unref();
            }
        }
        return this;
    }

    stop() {
        if (this._heartbeatTimer) {
            clearInterval(this._heartbeatTimer);
            this._heartbeatTimer = null;
        }
        if (this.channel) {
            try { this.channel.close(); } catch (_) {}
            this.channel = null;
        }
        if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
            if (this._boundStorageHandler) window.removeEventListener('storage', this._boundStorageHandler);
            if (this._boundUnloadHandler) window.removeEventListener('beforeunload', this._boundUnloadHandler);
        }
        this._boundStorageHandler = null;
        this._boundUnloadHandler = null;
        this.peers.clear();
    }

    onSync(callback) {
        if (typeof callback === 'function') this.listeners.add(callback);
        return () => this.listeners.delete(callback);
    }

    broadcast(type, payload = {}) {
        const envelope = {
            type: String(type || ''),
            tabId: this.tabId,
            ts: Date.now(),
            payload
        };
        if (this.channel) {
            try {
                this.channel.postMessage(envelope);
                return true;
            } catch (_) {}
        }
        // Fallback via localStorage event when BroadcastChannel is unavailable
        try {
            if (typeof localStorage !== 'undefined' && !type.startsWith('tab_')) {
                localStorage.setItem(`${this.channelName}_ping`, JSON.stringify(envelope));
            }
        } catch (_) {}
        return false;
    }

    getActiveTabCount() {
        this._prunePeers();
        return 1 + this.peers.size;
    }

    _prunePeers() {
        const cutoff = Date.now() - 40000;
        for (const [id, lastSeen] of this.peers.entries()) {
            if (lastSeen < cutoff) this.peers.delete(id);
        }
    }

    _handleIncoming(msg) {
        if (!msg || typeof msg !== 'object' || msg.tabId === this.tabId) return;
        const now = Date.now();
        if (msg.type === 'tab_hello') {
            this.peers.set(msg.tabId, now);
            this.broadcast('tab_pong', {});
            this._notify({ type: 'peers_changed', activeTabs: this.getActiveTabCount(), ts: now });
            return;
        }
        if (msg.type === 'tab_pong' || msg.type === 'tab_ping') {
            const hadPeer = this.peers.has(msg.tabId);
            this.peers.set(msg.tabId, now);
            if (!hadPeer) this._notify({ type: 'peers_changed', activeTabs: this.getActiveTabCount(), ts: now });
            return;
        }
        if (msg.type === 'tab_bye') {
            this.peers.delete(msg.tabId);
            this._notify({ type: 'peers_changed', activeTabs: this.getActiveTabCount(), ts: now });
            return;
        }
        this.peers.set(msg.tabId, now);
        this._notify(msg);
    }

    _notify(msg) {
        for (const fn of this.listeners) {
            try { fn(msg); } catch (_) {}
        }
    }
}

// ─── 3. ENCRYPTED PORTABLE WORKSPACE BACKUP & RESTORE ────────────────────────

export function sanitizeBackupSettings(settings = {}) {
    const clean = {};
    if (!settings || typeof settings !== 'object') return clean;
    for (const [key, val] of Object.entries(settings)) {
        if (SECRET_KEY_PATTERN.test(key)) continue;
        if (typeof val === 'string' && /^(?:gsk_|AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{16,})/.test(val.trim())) continue;
        clean[key] = val;
    }
    return clean;
}

async function deriveAesKeyFromPassphrase(passphrase, saltBytes, iterations = PBKDF2_ITERATIONS) {
    const cryptoApi = getWebCrypto();
    const enc = new TextEncoder();
    const keyMaterial = await cryptoApi.subtle.importKey(
        'raw',
        enc.encode(String(passphrase)),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return cryptoApi.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function createWorkspaceBackup(data = {}, options = {}) {
    const encrypt = options?.encrypt !== false && Boolean(String(options?.passphrase || '').trim());
    const passphrase = String(options?.passphrase || '').trim();
    if (options?.encrypt === true && passphrase.length < 4) {
        throw new Error('Passphrase must be at least 4 characters to encrypt your workspace backup.');
    }

    const sanitizedPayload = {
        sessions: (Array.isArray(data.sessions) ? data.sessions : [])
            .filter(s => s && s.id && !s.deleted)
            .slice(-MAX_DURABLE_SESSIONS)
            .map(cloneDurableSession),
        memories: (Array.isArray(data.memories) ? data.memories : []).filter(m => m && m.text),
        learnedRules: (Array.isArray(data.learnedRules) ? data.learnedRules : []).filter(r => r && r.directive),
        customSystemPrompt: String(data.customSystemPrompt || '').slice(0, 1200),
        settings: sanitizeBackupSettings(data.settings || {})
    };

    const meta = {
        sessionCount: sanitizedPayload.sessions.length,
        memoryCount: sanitizedPayload.memories.length,
        ruleCount: sanitizedPayload.learnedRules.length,
        byokExcluded: true
    };

    const exportedAt = new Date().toISOString();

    if (!encrypt) {
        return JSON.stringify({
            format: WORKSPACE_BACKUP_FORMAT,
            schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
            exportedAt,
            encrypted: false,
            meta,
            payload: sanitizedPayload
        }, null, 2);
    }

    const cryptoApi = getWebCrypto();
    const salt = cryptoApi.getRandomValues(new Uint8Array(16));
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const aesKey = await deriveAesKeyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
    const plaintextBytes = new TextEncoder().encode(JSON.stringify(sanitizedPayload));
    const cipherBuf = await cryptoApi.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintextBytes);

    return JSON.stringify({
        format: WORKSPACE_BACKUP_FORMAT,
        schemaVersion: WORKSPACE_BACKUP_SCHEMA_VERSION,
        exportedAt,
        encrypted: true,
        kdf: 'PBKDF2-SHA256',
        iterations: PBKDF2_ITERATIONS,
        cipher: 'AES-256-GCM',
        salt: bytesToBase64(salt),
        iv: bytesToBase64(iv),
        meta,
        ciphertext: bytesToBase64(new Uint8Array(cipherBuf))
    }, null, 2);
}

export async function parseWorkspaceBackup(rawJson, passphrase = '') {
    let envelope;
    try {
        envelope = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    } catch (_) {
        return { ok: false, code: 'invalid_json', error: 'Backup file is not valid JSON.' };
    }

    if (!envelope || envelope.format !== WORKSPACE_BACKUP_FORMAT) {
        return { ok: false, code: 'invalid_format', error: 'Unrecognized backup file format. Expected a JARVIS Workspace Backup.' };
    }

    let payload = null;
    if (envelope.encrypted === true) {
        const cleanPass = String(passphrase || '').trim();
        if (!cleanPass) {
            return { ok: false, code: 'passphrase_required', encrypted: true, error: 'This backup is encrypted. Enter your passphrase to decrypt it.' };
        }
        try {
            const cryptoApi = getWebCrypto();
            const salt = base64ToBytes(envelope.salt);
            const iv = base64ToBytes(envelope.iv);
            const ciphertext = base64ToBytes(envelope.ciphertext);
            const iterations = Math.max(100000, Math.min(1000000, Number(envelope.iterations) || PBKDF2_ITERATIONS));
            const aesKey = await deriveAesKeyFromPassphrase(cleanPass, salt, iterations);
            const plainBuf = await cryptoApi.subtle.decrypt({ name: 'AES-GCM', iv }, aesKey, ciphertext);
            payload = JSON.parse(new TextDecoder().decode(plainBuf));
        } catch (_) {
            return { ok: false, code: 'decrypt_failed', encrypted: true, error: 'Incorrect passphrase or corrupted backup file.' };
        }
    } else {
        payload = envelope.payload;
    }

    if (!payload || typeof payload !== 'object') {
        return { ok: false, code: 'empty_payload', error: 'Backup payload is empty or invalid.' };
    }

    const cleanPayload = {
        sessions: (Array.isArray(payload.sessions) ? payload.sessions : []).filter(s => s && s.id).map(cloneDurableSession),
        memories: (Array.isArray(payload.memories) ? payload.memories : []).filter(m => m && typeof m.text === 'string' && m.text.trim()),
        learnedRules: (Array.isArray(payload.learnedRules) ? payload.learnedRules : []).filter(r => r && typeof r.directive === 'string' && r.directive.trim()),
        customSystemPrompt: String(payload.customSystemPrompt || '').slice(0, 1200),
        settings: sanitizeBackupSettings(payload.settings || {})
    };

    return {
        ok: true,
        encrypted: Boolean(envelope.encrypted),
        exportedAt: envelope.exportedAt || null,
        payload: cleanPayload,
        summary: {
            sessionCount: cleanPayload.sessions.length,
            memoryCount: cleanPayload.memories.length,
            ruleCount: cleanPayload.learnedRules.length,
            exportedAt: envelope.exportedAt || null
        }
    };
}

export const workspaceDb = new WorkspaceIndexedDB();
export const workspaceTabSync = new WorkspaceTabSync();
