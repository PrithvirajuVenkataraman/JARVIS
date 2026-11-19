/**
 * Unified Memory Store (Schema v1)
 * Manages ChatGPT-grade persistent user memory records in localStorage / in-memory fallback.
 * Handles idempotent migration from legacy stores, tab synchronization, bounds enforcement,
 * undo history, and export.
 */

export const STORAGE_KEY_V1 = 'jarvis_unified_memories_v1';
export const LEGACY_KEY_USER_MEMORY = 'jarvis_user_memory';
export const LEGACY_KEY_LEARNED_PREFS = 'jarvis_learned_preferences';
export const LEGACY_BACKUP_KEY = 'jarvis_legacy_memory_backup';

export const MAX_MEMORIES = 200;
export const MAX_TEXT_LENGTH = 200;

export const VALID_CATEGORIES = [
    'identity',
    'location',
    'occupation',
    'preference',
    'constraint',
    'pet_family',
    'hobby',
    'diet_health',
    'tech'
];

/**
 * Generate a standard UUID v4 or crypto random string.
 * @returns {string}
 */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try {
            return crypto.randomUUID();
        } catch (_) {}
    }
    return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/**
 * Clean & truncate text to maximum limit.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeMemoryText(text) {
    return String(text || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}

/**
 * Maps legacy category string to valid schema v1 category.
 * @param {string} rawCategory
 * @param {string} text
 * @returns {string}
 */
export function normalizeCategory(rawCategory = '', text = '') {
    const raw = String(rawCategory || '').toLowerCase().trim();
    if (VALID_CATEGORIES.includes(raw)) return raw;

    const lowerText = String(text || '').toLowerCase();
    if (raw.includes('loc') || lowerText.includes('live') || lowerText.includes('based in')) return 'location';
    if (raw.includes('job') || raw.includes('work') || raw.includes('profession')) return 'occupation';
    if (raw.includes('diet') || raw.includes('allerg') || raw.includes('vegan') || raw.includes('vegetarian')) return 'diet_health';
    if (raw.includes('pet') || raw.includes('dog') || raw.includes('cat') || raw.includes('family')) return 'pet_family';
    if (raw.includes('tech') || raw.includes('code') || raw.includes('stack') || raw.includes('lang')) return 'tech';
    if (raw.includes('neg') || raw.includes('avoid') || raw.includes('constraint') || raw.includes('stop')) return 'constraint';
    if (raw.includes('name') || raw.includes('identity')) return 'identity';
    if (raw.includes('hobby') || raw.includes('sport')) return 'hobby';
    return 'preference';
}

export class UnifiedMemoryStore {
    constructor(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
        this.storage = storage;
        this.memories = [];
        this.undoStack = [];
        this.isInitialized = false;
        this._setupStorageListener();
    }

    /**
     * Initializes the store, loading persisted records and executing idempotent migration if needed.
     */
    init() {
        this.load();
        this.runIdempotentMigration();
        this.isInitialized = true;
        return this;
    }

    _setupStorageListener() {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('storage', (event) => {
                if (event.key === STORAGE_KEY_V1) {
                    this.load();
                }
            });
        }
    }

    /**
     * Safely reads JSON from storage.
     */
    _readStorage(key) {
        if (!this.storage) return null;
        try {
            const raw = this.storage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) {
            return null;
        }
    }

    /**
     * Safely writes JSON to storage.
     */
    _writeStorage(key, value) {
        if (!this.storage) return false;
        try {
            this.storage.setItem(key, JSON.stringify(value));
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * Loads memories from storage key.
     */
    load() {
        const payload = this._readStorage(STORAGE_KEY_V1);
        if (payload && Array.isArray(payload.memories)) {
            this.memories = payload.memories.filter(m => m && typeof m.text === 'string' && m.text.trim());
        } else if (Array.isArray(payload)) {
            this.memories = payload.filter(m => m && typeof m.text === 'string' && m.text.trim());
        } else {
            this.memories = [];
        }
        return this.memories;
    }

    /**
     * Persists memories to storage key.
     */
    save() {
        const payload = {
            schemaVersion: 1,
            updatedAt: new Date().toISOString(),
            memories: this.memories
        };
        this._writeStorage(STORAGE_KEY_V1, payload);
    }

    _snapshotUndo(actionLabel = '') {
        const snapshot = JSON.parse(JSON.stringify(this.memories));
        this.undoStack.push({ actionLabel, snapshot });
        if (this.undoStack.length > 20) this.undoStack.shift();
    }

    /**
     * Undoes the last mutation (add, edit, delete, clear).
     * @returns {{ reverted: boolean, actionLabel: string, count: number }}
     */
    undoLastChange() {
        if (!this.undoStack.length) {
            return { reverted: false, actionLabel: '', count: this.memories.length };
        }
        const last = this.undoStack.pop();
        this.memories = last.snapshot;
        this.save();
        return { reverted: true, actionLabel: last.actionLabel, count: this.memories.length };
    }

    getAll() {
        return [...this.memories];
    }

    getEnabled() {
        return this.memories.filter(m => m.enabled !== false);
    }

    getById(id) {
        return this.memories.find(m => m.id === id) || null;
    }

    /**
     * Adds a new memory item. Enforces limits and schema.
     * @param {Object} memoryCandidate
     * @returns {{ success: boolean, memory?: Object, error?: string }}
     */
    add(candidate) {
        if (!candidate || typeof candidate !== 'object') {
            return { success: false, error: 'Invalid memory object' };
        }

        const text = sanitizeMemoryText(candidate.text);
        if (!text) {
            return { success: false, error: 'Memory text cannot be empty' };
        }

        if (this.memories.length >= MAX_MEMORIES) {
            return {
                success: false,
                error: `Memory limit reached (${MAX_MEMORIES} maximum). Please delete older memories to save new ones.`
            };
        }

        this._snapshotUndo('add');

        const now = new Date().toISOString();
        const record = {
            id: candidate.id && typeof candidate.id === 'string' ? candidate.id : generateUUID(),
            text,
            category: normalizeCategory(candidate.category, text),
            createdAt: candidate.createdAt || now,
            updatedAt: now,
            source: ['auto', 'explicit', 'manual'].includes(candidate.source) ? candidate.source : 'auto',
            enabled: candidate.enabled !== false,
            sensitive: Boolean(candidate.sensitive)
        };

        this.memories.unshift(record);
        this.save();
        return { success: true, memory: record };
    }

    /**
     * Updates an existing memory record.
     * @param {string} id
     * @param {Object} patch
     * @returns {{ success: boolean, memory?: Object, error?: string }}
     */
    update(id, patch = {}) {
        const target = this.memories.find(m => m.id === id);
        if (!target) {
            return { success: false, error: 'Memory not found' };
        }

        this._snapshotUndo('update');

        if (typeof patch.text === 'string') {
            const cleanText = sanitizeMemoryText(patch.text);
            if (!cleanText) return { success: false, error: 'Memory text cannot be empty' };
            target.text = cleanText;
        }

        if (typeof patch.category === 'string') {
            target.category = normalizeCategory(patch.category, target.text);
        }

        if (typeof patch.enabled === 'boolean') {
            target.enabled = patch.enabled;
        }

        if (typeof patch.sensitive === 'boolean') {
            target.sensitive = patch.sensitive;
        }

        target.updatedAt = new Date().toISOString();
        this.save();
        return { success: true, memory: target };
    }

    /**
     * Deletes a memory record by ID.
     * @param {string} id
     * @returns {{ success: boolean, removed?: Object }}
     */
    delete(id) {
        const idx = this.memories.findIndex(m => m.id === id);
        if (idx === -1) {
            return { success: false };
        }
        this._snapshotUndo('delete');
        const [removed] = this.memories.splice(idx, 1);
        this.save();
        return { success: true, removed };
    }

    /**
     * Clears all memories.
     */
    clear() {
        if (!this.memories.length) return { clearedCount: 0 };
        this._snapshotUndo('clear');
        const count = this.memories.length;
        this.memories = [];
        this.save();
        return { clearedCount: count };
    }

    /**
     * Exports all memories as a JSON string.
     */
    exportJson() {
        return JSON.stringify({
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            totalMemories: this.memories.length,
            memories: this.memories
        }, null, 2);
    }

    /**
     * One-time, idempotent migration from legacy stores (jarvis_user_memory and jarvis_learned_preferences).
     * Backs up legacy data under jarvis_legacy_memory_backup and deduplicates against existing v1 memories.
     * Safe to run multiple times without duplicating or corrupting records.
     */
    runIdempotentMigration() {
        let legacyStore1 = null;
        let legacyStore2 = null;

        try {
            legacyStore1 = this._readStorage(LEGACY_KEY_USER_MEMORY);
        } catch (_) {}

        try {
            legacyStore2 = this._readStorage(LEGACY_KEY_LEARNED_PREFS);
        } catch (_) {}

        // If no legacy data found, nothing to migrate
        if (!legacyStore1 && !legacyStore2) return { migrated: 0 };

        // Save backup of raw legacy data under separate key if not already backed up
        const existingBackup = this._readStorage(LEGACY_BACKUP_KEY);
        if (!existingBackup) {
            this._writeStorage(LEGACY_BACKUP_KEY, {
                backupDate: new Date().toISOString(),
                legacyUserMemory: legacyStore1,
                legacyLearnedPreferences: legacyStore2
            });
        }

        const existingTexts = new Set(this.memories.map(m => m.text.toLowerCase().trim()));
        let migratedCount = 0;

        // 1. Migrate from legacyStore1 (object: { key: { value, type, sourcePhrase, createdAt, updatedAt } })
        if (legacyStore1 && typeof legacyStore1 === 'object' && !Array.isArray(legacyStore1)) {
            for (const [key, item] of Object.entries(legacyStore1)) {
                if (key === 'name') continue; // User name is stored in AppState.user.name, not memory
                const value = item && typeof item === 'object' ? item.value : item;
                if (!value || typeof value !== 'string') continue;

                const text = sanitizeMemoryText(value.startsWith(key) ? value : `${key}: ${value}`);
                if (!text || existingTexts.has(text.toLowerCase())) continue;

                const cat = normalizeCategory(item?.type || item?.category || '', text);
                const memoryRecord = {
                    id: generateUUID(),
                    text,
                    category: cat,
                    createdAt: item?.createdAt || new Date().toISOString(),
                    updatedAt: item?.updatedAt || new Date().toISOString(),
                    source: 'explicit',
                    enabled: true,
                    sensitive: cat === 'diet_health'
                };

                if (this.memories.length < MAX_MEMORIES) {
                    this.memories.push(memoryRecord);
                    existingTexts.add(text.toLowerCase());
                    migratedCount++;
                }
            }
        }

        // 2. Migrate from legacyStore2 (array of preferences: [ { directive, rawPrompt, category, enabled, detectedAt } ])
        if (Array.isArray(legacyStore2)) {
            for (const item of legacyStore2) {
                if (!item || !item.directive || typeof item.directive !== 'string') continue;
                const text = sanitizeMemoryText(item.directive);
                if (!text || existingTexts.has(text.toLowerCase())) continue;

                const cat = normalizeCategory(item.category || '', text);
                const memoryRecord = {
                    id: generateUUID(),
                    text,
                    category: cat,
                    createdAt: item.detectedAt ? new Date(item.detectedAt).toISOString() : new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: 'auto',
                    enabled: item.enabled !== false,
                    sensitive: cat === 'diet_health'
                };

                if (this.memories.length < MAX_MEMORIES) {
                    this.memories.push(memoryRecord);
                    existingTexts.add(text.toLowerCase());
                    migratedCount++;
                }
            }
        }

        if (migratedCount > 0) {
            this.save();
        }

        return { migrated: migratedCount };
    }
}

export const unifiedMemoryStore = new UnifiedMemoryStore();
