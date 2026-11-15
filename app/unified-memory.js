/**
 * Unified Memory System (Schema v1) — Single consolidated module
 *
 * Consolidates: memory-gate.mjs, unified-memory-store.mjs, memory-extractor.mjs,
 *               memory-prompt-builder.mjs
 *
 * WHY: The browser resolves `bootstrap.js` → `./memory/index.mjs` →
 * sub-directory files with NO `?v=` cache-busting. When the deployment
 * environment (Vercel / CDN) doesn't serve files inside `app/memory/` it
 * returns 404 for `/app/memory/index.mjs`. Because `bootstrap.js` is an ES
 * Module, ONE failed import aborts the ENTIRE module graph — making
 * `JarvisUnifiedMemory`, `JarvisConversation`, `JarvisInteractionState` and
 * every other global undefined, which breaks live web search, chat, and all
 * features that depend on the bootstrap registry.
 *
 * FIX: Inline all memory exports into a single `.js` file loaded with the
 * standard `?v=2.0.5` cache-busting that every other bootstrap import uses.
 * This makes it a regular HTTP GET request with no sub-path resolution.
 */

// ─── MEMORY GATE ─────────────────────────────────────────────────────────────

export const FEATURE_UNIFIED_MEMORY = true;
export const PERSONALIZATION_STORAGE_KEY = 'jarvis_personalized_experience';

/**
 * Single source of truth for whether memory learning & prompt injection are active.
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function isMemoryActive(storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    if (!FEATURE_UNIFIED_MEMORY) return false;
    try {
        if (!storage) return true;
        const val = storage.getItem(PERSONALIZATION_STORAGE_KEY);
        return val !== 'false';
    } catch (_) {
        return true;
    }
}

/**
 * Toggles the Personalized Experience setting.
 * @param {boolean} enabled
 * @param {Storage} [storage]
 * @returns {boolean}
 */
export function setMemoryActive(enabled, storage = (typeof localStorage !== 'undefined' ? localStorage : null)) {
    try {
        if (!storage) return Boolean(enabled);
        storage.setItem(PERSONALIZATION_STORAGE_KEY, enabled ? 'true' : 'false');
        return Boolean(enabled);
    } catch (_) {
        return Boolean(enabled);
    }
}

// ─── UNIFIED MEMORY STORE ────────────────────────────────────────────────────

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

/** Generate UUID v4 or a random fallback string. */
export function generateUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        try { return crypto.randomUUID(); } catch (_) {}
    }
    return 'mem_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** Clean & truncate memory text to the maximum limit. */
export function sanitizeMemoryText(text) {
    return String(text || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_TEXT_LENGTH);
}

/** Maps a raw category string to a valid schema v1 category. */
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

    init() {
        this.load();
        this.runIdempotentMigration();
        this.isInitialized = true;
        return this;
    }

    _setupStorageListener() {
        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('storage', (event) => {
                if (event.key === STORAGE_KEY_V1) { this.load(); }
            });
        }
    }

    _readStorage(key) {
        if (!this.storage) return null;
        try {
            const raw = this.storage.getItem(key);
            if (!raw) return null;
            return JSON.parse(raw);
        } catch (_) { return null; }
    }

    _writeStorage(key, value) {
        if (!this.storage) return false;
        try { this.storage.setItem(key, JSON.stringify(value)); return true; }
        catch (_) { return false; }
    }

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

    /** Undo last mutation. */
    undoLastChange() {
        if (!this.undoStack.length) return { reverted: false, actionLabel: '', count: this.memories.length };
        const last = this.undoStack.pop();
        this.memories = last.snapshot;
        this.save();
        return { reverted: true, actionLabel: last.actionLabel, count: this.memories.length };
    }

    // Alias used by existing code
    undo() { return this.undoLastChange(); }

    getAll() { return [...this.memories]; }
    getEnabled() { return this.memories.filter(m => m.enabled !== false); }
    getById(id) { return this.memories.find(m => m.id === id) || null; }

    add(candidate) {
        if (!candidate || typeof candidate !== 'object') return { success: false, error: 'Invalid memory object' };
        const text = sanitizeMemoryText(candidate.text);
        if (!text) return { success: false, error: 'Memory text cannot be empty' };
        if (this.memories.length >= MAX_MEMORIES) {
            return { success: false, error: `Memory limit reached (${MAX_MEMORIES} maximum). Please delete older memories to save new ones.` };
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

    update(id, patch = {}) {
        const target = this.memories.find(m => m.id === id);
        if (!target) return { success: false, error: 'Memory not found' };
        this._snapshotUndo('update');
        if (typeof patch.text === 'string') {
            const cleanText = sanitizeMemoryText(patch.text);
            if (!cleanText) return { success: false, error: 'Memory text cannot be empty' };
            target.text = cleanText;
        }
        if (typeof patch.category === 'string') target.category = normalizeCategory(patch.category, target.text);
        if (typeof patch.enabled === 'boolean') target.enabled = patch.enabled;
        if (typeof patch.sensitive === 'boolean') target.sensitive = patch.sensitive;
        target.updatedAt = new Date().toISOString();
        this.save();
        return { success: true, memory: target };
    }

    delete(id) {
        const idx = this.memories.findIndex(m => m.id === id);
        if (idx === -1) return { success: false };
        this._snapshotUndo('delete');
        const [removed] = this.memories.splice(idx, 1);
        this.save();
        return { success: true, removed };
    }

    clear() {
        if (!this.memories.length) return { clearedCount: 0 };
        this._snapshotUndo('clear');
        const count = this.memories.length;
        this.memories = [];
        this.save();
        return { clearedCount: count };
    }

    exportJson() {
        return JSON.stringify({
            schemaVersion: 1,
            exportedAt: new Date().toISOString(),
            totalMemories: this.memories.length,
            memories: this.memories
        }, null, 2);
    }

    runIdempotentMigration() {
        let legacyStore1 = null;
        let legacyStore2 = null;
        try { legacyStore1 = this._readStorage(LEGACY_KEY_USER_MEMORY); } catch (_) {}
        try { legacyStore2 = this._readStorage(LEGACY_KEY_LEARNED_PREFS); } catch (_) {}
        if (!legacyStore1 && !legacyStore2) return { migrated: 0 };

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

        if (legacyStore1 && typeof legacyStore1 === 'object' && !Array.isArray(legacyStore1)) {
            for (const [key, item] of Object.entries(legacyStore1)) {
                if (key === 'name') continue;
                const value = item && typeof item === 'object' ? item.value : item;
                if (!value || typeof value !== 'string') continue;
                const text = sanitizeMemoryText(value.startsWith(key) ? value : `${key}: ${value}`);
                if (!text || existingTexts.has(text.toLowerCase())) continue;
                const cat = normalizeCategory(item?.type || item?.category || '', text);
                const record = {
                    id: generateUUID(), text, category: cat,
                    createdAt: item?.createdAt || new Date().toISOString(),
                    updatedAt: item?.updatedAt || new Date().toISOString(),
                    source: 'explicit', enabled: true, sensitive: cat === 'diet_health'
                };
                if (this.memories.length < MAX_MEMORIES) {
                    this.memories.push(record);
                    existingTexts.add(text.toLowerCase());
                    migratedCount++;
                }
            }
        }

        if (Array.isArray(legacyStore2)) {
            for (const item of legacyStore2) {
                if (!item || !item.directive || typeof item.directive !== 'string') continue;
                const text = sanitizeMemoryText(item.directive);
                if (!text || existingTexts.has(text.toLowerCase())) continue;
                const cat = normalizeCategory(item.category || '', text);
                const record = {
                    id: generateUUID(), text, category: cat,
                    createdAt: item.detectedAt ? new Date(item.detectedAt).toISOString() : new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                    source: 'auto', enabled: item.enabled !== false, sensitive: cat === 'diet_health'
                };
                if (this.memories.length < MAX_MEMORIES) {
                    this.memories.push(record);
                    existingTexts.add(text.toLowerCase());
                    migratedCount++;
                }
            }
        }

        if (migratedCount > 0) this.save();
        return { migrated: migratedCount };
    }
}

export const unifiedMemoryStore = new UnifiedMemoryStore();

// ─── MEMORY EXTRACTOR ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
    'a', 'an', 'the', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'to', 'in',
    'on', 'at', 'by', 'for', 'with', 'about', 'of', 'as', 'it', 'its', 'my', 'your',
    'his', 'her', 'their', 'our', 'this', 'that', 'these', 'those', 'am', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'very', 'really', 'so', 'too',
    'bit', 'little', 'today', 'now', 'right', 'just', 'still', 'always', 'currently'
]);

const NON_OCCUPATION_WORDS = new Set([
    'fan', 'bit', 'little', 'lot', 'big', 'huge', 'supporter', 'follower', 'believer',
    'person', 'human', 'guy', 'girl', 'man', 'woman', 'kid', 'teen', 'amateur', 'beginner',
    'novice', 'user', 'member', 'resident', 'native', 'citizen', 'traveler', 'tourist',
    'tired', 'happy', 'sad', 'hungry', 'sick', 'fine', 'good', 'bad', 'proud', 'glad'
]);

export function tokenize(str) {
    return String(str || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

export function calculateTokenJaccard(a, b) {
    const tokensA = new Set(tokenize(a));
    const tokensB = new Set(tokenize(b));
    if (!tokensA.size && !tokensB.size) return 1.0;
    if (!tokensA.size || !tokensB.size) return 0.0;
    let intersectionCount = 0;
    for (const t of tokensA) { if (tokensB.has(t)) intersectionCount++; }
    const unionSize = tokensA.size + tokensB.size - intersectionCount;
    return unionSize > 0 ? intersectionCount / unionSize : 0;
}

export function sanitizeCapturedGroup(captured) {
    if (!captured || typeof captured !== 'string') return null;
    let clean = captured.trim().replace(/^[,\s;:]+|[,\s;:.]+$/g, '');
    clean = clean.split(/\b(?:and|but|because|when|while|since|although|though|however|so|if|where|who|at\s+(?:a|an|the)|for\s+(?:a|an|the))\b/i)[0].trim();
    clean = clean.replace(/\b(?:recently|lately|now|currently|today|yesterday|this\s+year|last\s+year|every\s+day|daily|all\s+the\s+time|a\s+few\s+months\s+ago|a\s+while\s+ago)\b/gi, '').trim();
    clean = clean.replace(/^[,\s;:]+|[,\s;:.]+$/g, '');
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length === 0 || words.length > 5) return null;
    const nonStop = words.filter(w => !STOP_WORDS.has(w.toLowerCase()));
    if (!nonStop.length) return null;
    return clean;
}

export function shouldIgnoreForExtraction(text) {
    const raw = String(text || '').trim();
    if (!raw || raw.length < 5 || raw.length > 400) return true;
    if (/\?$/.test(raw)) return true;
    if (/^(?:can\s+you|could\s+you|would\s+you|should\s+i|what\s+is|what\s+are|where\s+is|where\s+are|why\s+is|why\s+do|how\s+do|how\s+can|how\s+is|who\s+is|do\s+i|do\s+you|are\s+you|is\s+it|tell\s+me\s+if)\b/i.test(raw)) return true;
    if (/\b(?:if\s+i\s+(?:were|was)|imagine\s+(?:if|that)\s+i|suppose\s+i|what\s+if\s+i|pretend\s+(?:that\s+)?i|as\s+if\s+i)\b/i.test(raw)) return true;
    if (/^["'"'].+["'"']$/.test(raw)) return true;
    if (/^(?:he|she|they|my\s+(?:friend|colleague|brother|sister|dad|mom|father|mother|cousin|boss|roommate)|someone)\s+(?:is|works|lives|moved|has|eats|codes)\b/i.test(raw)) return true;
    if (/\b(?:i\s+am|i'm)\s+(?:a\s+bit|feeling|just|so|pretty|really|super)\s+(?:tired|exhausted|sleepy|sick|ill|happy|sad|upset|hungry|bored|busy)\b/i.test(raw)) return true;
    return false;
}

export function hasNegation(clause) {
    return /\b(?:not|don'?t|do\s+not|never|no\s+longer|quit|stopped|ain'?t)\b/i.test(clause);
}

function _capitalizeWords(str) {
    return String(str || '').split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function extract(utterance = '') {
    const raw = String(utterance || '').trim();
    if (shouldIgnoreForExtraction(raw)) return [];
    const candidates = [];

    const locationMatch = raw.match(/\b(?:i\s+(?:currently\s+)?live\s+in|i'm\s+based\s+in|i\s+am\s+based\s+in|i\s+(?:recently\s+)?moved\s+to|i\s+am\s+living\s+in|i'm\s+living\s+in)\s+([^.!?,\n]+)/i);
    if (locationMatch && !hasNegation(raw.slice(0, locationMatch.index + 15))) {
        const place = sanitizeCapturedGroup(locationMatch[1]);
        if (place && !/\b(?:here|there|home|a\s+house|an\s+apartment)\b/i.test(place)) {
            candidates.push({ text: `Lives in ${_capitalizeWords(place)}`, category: 'location', slot: 'location', sensitive: false, confidence: 0.95 });
        }
    }

    const professionMatch = raw.match(/\b(?:i\s+work\s+as\s+(?:an?|the)?|my\s+job\s+is\s+(?:an?|the)?|my\s+profession\s+is\s+(?:an?|the)?)\s+([^.!?,\n]+)/i);
    if (professionMatch && !hasNegation(raw.slice(0, professionMatch.index + 15))) {
        const job = sanitizeCapturedGroup(professionMatch[1]);
        if (job) candidates.push({ text: `Works as a ${_capitalizeWords(job)}`, category: 'occupation', slot: 'occupation', sensitive: false, confidence: 0.95 });
    } else {
        const iAmMatch = raw.match(/\b(?:i\s+am|i'm)\s+(?:an?)\s+([a-zA-Z\s-]+?)(?:[.,;!?\n]|$)/i);
        if (iAmMatch && !hasNegation(raw.slice(0, iAmMatch.index + 10))) {
            const rawJob = sanitizeCapturedGroup(iAmMatch[1]);
            if (rawJob && !NON_OCCUPATION_WORDS.has(rawJob.split(/\s+/)[0].toLowerCase())) {
                candidates.push({ text: `Works as a ${_capitalizeWords(rawJob)}`, category: 'occupation', slot: 'occupation', sensitive: false, confidence: 0.85 });
            }
        }
    }

    if (/\b(?:i\s+am|i'm)\s+(?:a\s+)?(?:vegetarian|pescatarian)\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({ text: 'Diet: Vegetarian', category: 'diet_health', slot: 'diet', sensitive: true, confidence: 0.95 });
    } else if (/\b(?:i\s+am|i'm)\s+(?:a\s+)?vegan\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({ text: 'Diet: Vegan', category: 'diet_health', slot: 'diet', sensitive: true, confidence: 0.95 });
    }

    const allergyMatch = raw.match(/\b(?:i\s+am|i'm|i\s+have\s+an?)\s+allergic\s+to\s+([^.!?,\n]+)/i);
    if (allergyMatch && !hasNegation(raw.slice(0, allergyMatch.index + 15))) {
        const allergen = sanitizeCapturedGroup(allergyMatch[1]);
        if (allergen) candidates.push({ text: `Allergic to ${allergen.toLowerCase()}`, category: 'diet_health', slot: `allergy_${allergen.toLowerCase().replace(/\s+/g, '_')}`, sensitive: true, confidence: 0.95 });
    }

    if (/\b(?:i\s+am|i'm)\s+(?:strictly\s+)?gluten[-\s]?free\b/i.test(raw) && !hasNegation(raw)) {
        candidates.push({ text: 'Diet: Gluten-free', category: 'diet_health', slot: 'diet_gluten', sensitive: true, confidence: 0.95 });
    }

    const petNamedMatch = raw.match(/\b(?:i\s+have\s+an?|my)\s+([a-zA-Z]+)(?:'s\s+name\s+is|\s+named|\s+called)\s+([a-zA-Z]+)\b/i);
    if (petNamedMatch && !hasNegation(raw.slice(0, petNamedMatch.index + 15))) {
        const petType = petNamedMatch[1].toLowerCase().trim();
        const petName = _capitalizeWords(petNamedMatch[2].trim());
        if (['dog', 'cat', 'puppy', 'kitten', 'parrot', 'hamster', 'rabbit', 'horse', 'golden retriever', 'labrador', 'pet'].includes(petType)) {
            candidates.push({ text: `Has a ${petType} named ${petName}`, category: 'pet_family', slot: `pet_${petType}`, sensitive: false, confidence: 0.95 });
        }
    }

    const codeInMatch = raw.match(/\b(?:i\s+code\s+in|i\s+(?:mostly\s+)?develop\s+in|i\s+write\s+code\s+in|i\s+program\s+in)\s+([a-zA-Z0-9#+._\s]+?)(?:[.,;!?\n]|$)/i);
    if (codeInMatch && !hasNegation(raw.slice(0, codeInMatch.index + 15))) {
        const lang = sanitizeCapturedGroup(codeInMatch[1]);
        if (lang) candidates.push({ text: `Codes in ${lang}`, category: 'tech', slot: 'primary_language', sensitive: false, confidence: 0.95 });
    }

    const myStackMatch = raw.match(/\bmy\s+stack\s+is\s+([^.!?\n]+)/i);
    if (myStackMatch && !hasNegation(raw.slice(0, myStackMatch.index + 15))) {
        const stack = sanitizeCapturedGroup(myStackMatch[1]);
        if (stack) candidates.push({ text: `Tech stack: ${stack}`, category: 'tech', slot: 'tech_stack', sensitive: false, confidence: 0.92 });
    }

    if (/\b(?:be\s+(?:more\s+)?concise|keep\s+(?:your\s+)?answers?\s+(?:very\s+)?brief|no\s+fluff|give\s+direct\s+answers?)\b/i.test(raw)) {
        candidates.push({ text: 'Preference: Direct and concise answers with no fluff', category: 'preference', slot: 'conciseness', sensitive: false, confidence: 0.95 });
    }

    const negativeConstraintMatch = raw.match(/\b(?:don'?t|do\s+not|never|avoid|stop)\s+(?:use|using|include|including|give|giving|write|writing)\s+([^.!?\n]{3,80})/i);
    if (negativeConstraintMatch) {
        const subject = sanitizeCapturedGroup(negativeConstraintMatch[1]);
        if (subject) candidates.push({ text: `Constraint: Avoid ${subject}`, category: 'constraint', slot: `avoid_${subject.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`, sensitive: false, confidence: 0.90 });
    }

    const alwaysFormatMatch = raw.match(/\b(?:always|from\s+now\s+on\s*,?\s*always|prefer)\s+(?:format\s+(?:in|as)|respond\s+in|answer\s+in)\s+([^.!?\n]{3,80})/i);
    if (alwaysFormatMatch && !hasNegation(raw.slice(0, alwaysFormatMatch.index + 10))) {
        const style = sanitizeCapturedGroup(alwaysFormatMatch[1]);
        if (style) candidates.push({ text: `Preference: Always format as ${style}`, category: 'preference', slot: `format_${style.toLowerCase().replace(/\s+/g, '_').slice(0, 30)}`, sensitive: false, confidence: 0.90 });
    }

    return candidates;
}

export function resolveConflictsAndDedup(candidates = [], existingMemories = []) {
    const toAdd = [], toUpdate = [], toSupersede = [];
    for (const cand of candidates) {
        let isDuplicate = false;
        let slotConflictMatch = null;
        for (const existing of existingMemories) {
            const similarity = calculateTokenJaccard(cand.text, existing.text);
            if (similarity >= 0.8 || cand.text.toLowerCase().trim() === existing.text.toLowerCase().trim()) {
                isDuplicate = true;
                toUpdate.push({ id: existing.id, patch: { updatedAt: new Date().toISOString() } });
                break;
            }
            if (cand.slot && existing.category === cand.category) {
                if (cand.slot === 'location' && existing.text.toLowerCase().startsWith('lives in')) slotConflictMatch = existing;
                else if (cand.slot === 'occupation' && existing.text.toLowerCase().startsWith('works as')) slotConflictMatch = existing;
                else if (cand.slot === 'diet' && existing.text.toLowerCase().startsWith('diet:')) slotConflictMatch = existing;
            }
        }
        if (isDuplicate) continue;
        if (slotConflictMatch) toSupersede.push({ oldId: slotConflictMatch.id, newCandidate: cand });
        else toAdd.push(cand);
    }
    return { toAdd, toUpdate, toSupersede };
}

// ─── MEMORY PROMPT BUILDER ───────────────────────────────────────────────────

export const META_QUERY_PATTERNS = [
    /\bwhat\s+do\s+you\s+(?:know|remember)\s+about\s+me\b/i,
    /\bwhat\s+(?:are\s+)?my\s+saved\s+memories\b/i,
    /\btell\s+me\s+what\s+you\s+(?:know|remember)\s+about\s+(?:me|my\s+preferences|my\s+profile)\b/i,
    /\bshow\s+(?:me\s+)?(?:all\s+)?my\s+(?:saved\s+)?memories\b/i,
    /\bwhat\s+have\s+you\s+learned\s+about\s+me\b/i,
    /\bwhat\s+do\s+you\s+have\s+saved\s+about\s+me\b/i,
    /\bwhat\s+memories\s+do\s+you\s+have\b/i,
    /\bwhat\s+is\s+my\s+profile\b/i,
    /\bwhat\s+preferences\s+do\s+you\s+remember\b/i
];

export const FORGET_INTENT_PATTERNS = [
    /\b(?:please\s+)?(?:forget|delete|remove|clear)\s+(?:everything|all\s+memories|all\s+my\s+memories)\b/i,
    /\b(?:please\s+)?(?:forget|delete|remove|clear)\s+(?:that\s+)?(?:i\s+)?(.+)/i
];

export function isMetaMemoryQuery(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    return META_QUERY_PATTERNS.some(p => p.test(raw));
}
export const isMetaQuery = isMetaMemoryQuery;

export function parseForgetIntent(text) {
    const raw = String(text || '').trim();
    if (!raw) return { isForget: false, isForgetAll: false, forgetAll: false, target: '' };
    if (/\b(?:forget|delete|remove|clear)\s+(?:everything|all\s+memories|all\s+my\s+memories)\b/i.test(raw)) {
        return { isForget: true, isForgetAll: true, forgetAll: true, target: 'all' };
    }
    const match = raw.match(/\b(?:please\s+)?(?:forget|delete|remove|erase)\s+(?:that\s+)?(?:memory\s+about\s+)?(?:i\s+)?(.+)/i);
    if (match && match[1]) {
        let target = match[1].trim().replace(/[?.!,;]+$/g, '');
        target = target.replace(/^(?:my\s+|the\s+|about\s+|that\s+)+/i, '').trim();
        return { isForget: true, isForgetAll: false, forgetAll: false, target };
    }
    return { isForget: false, isForgetAll: false, forgetAll: false, target: '' };
}

export function sanitizeMemoryForPrompt(text) {
    return String(text || '')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\b(?:system|assistant|user|developer|instruction|human)\s*:/gi, '')
        .replace(/\b(?:ignore\s+(?:all\s+)?(?:previous|prior)\s+instructions|disregard\s+instructions|system\s+prompt)\b/gi, '[filtered]')
        .replace(/```/g, "'''")
        .trim();
}

export function findMemoriesToForget(targetText, memories = []) {
    const raw = String(targetText || '').toLowerCase().trim();
    if (!raw || !memories.length) {
        const empty = [];
        empty.exactMatch = null;
        empty.fuzzyMatches = [];
        return empty;
    }
    const exact = memories.find(m => m.text.toLowerCase().includes(raw) || raw.includes(m.text.toLowerCase()));
    if (exact) {
        const arr = [exact];
        arr.exactMatch = exact;
        arr.fuzzyMatches = [exact];
        return arr;
    }
    const matches = [];
    const targetTokens = new Set(tokenize(raw));
    for (const mem of memories) {
        const memTokens = tokenize(mem.text);
        const overlap = memTokens.filter(t => targetTokens.has(t)).length;
        const jaccard = calculateTokenJaccard(raw, mem.text);
        if (overlap >= 1 || jaccard >= 0.3) matches.push({ memory: mem, score: jaccard + (overlap * 0.2) });
    }
    matches.sort((a, b) => b.score - a.score);
    const arr = matches.map(m => m.memory);
    arr.exactMatch = matches.length === 1 ? matches[0].memory : null;
    arr.fuzzyMatches = matches.map(m => m.memory);
    return arr;
}

export function selectRelevantMemories(currentTurnText = '', enabledMemories = [], maxCharsBudget = 3200) {
    if (!enabledMemories || !enabledMemories.length) return [];
    const turnTokens = new Set(tokenize(currentTurnText));
    const selected = [];
    let charCount = 0;

    const constraintsAndPrefs = enabledMemories.filter(m => m.category === 'constraint' || m.category === 'preference');
    for (const item of constraintsAndPrefs) {
        const itemLen = item.text.length + 10;
        if (charCount + itemLen <= maxCharsBudget) { selected.push(item); charCount += itemLen; }
    }

    const remaining = enabledMemories.filter(m => !selected.includes(m));
    const scored = remaining.map(item => {
        const tokens = tokenize(item.text);
        const overlap = tokens.filter(t => turnTokens.has(t)).length;
        const jaccard = calculateTokenJaccard(currentTurnText, item.text);
        return { item, score: overlap * 2 + jaccard };
    });
    scored.sort((a, b) => b.score - a.score);
    for (const { item, score } of scored) {
        if (score > 0 || ['identity', 'location'].includes(item.category)) {
            const itemLen = item.text.length + 10;
            if (charCount + itemLen <= maxCharsBudget) { selected.push(item); charCount += itemLen; }
        }
    }
    return selected;
}

export function buildNormalTurnMemoryPrompt(relevantMemories = []) {
    if (!relevantMemories || !relevantMemories.length) return '';
    const lines = relevantMemories.map(m => `- ${sanitizeMemoryForPrompt(m.text)}`);
    return [
        '=== USER SAVED MEMORIES & PREFERENCES (DATA ONLY) ===',
        'The following facts and preferences were saved by the user.',
        'Use them naturally for personalized assistance without repeating or reciting them unless asked:',
        ...lines,
        '====================================================='
    ].join('\n');
}

export function buildMetaQueryMemoryPrompt(allMemories = []) {
    if (!allMemories || !allMemories.length) {
        return [
            '[Saved User Memories & Profile (Complete List):',
            '(No memories saved yet)',
            ']',
            'Instruction: Tell the user conversationally that you do not have any saved memories or personal facts stored yet. Invite them to share their preferences or facts naturally.'
        ].join('\n');
    }
    const lines = allMemories.map(m => `- ${sanitizeMemoryForPrompt(m.text)}`);
    return [
        '[Saved User Memories & Profile (Complete List):',
        ...lines,
        ']',
        'Instruction: The user asked what you know/remember about them. Answer conversationally, cleanly, and accurately using ONLY the facts listed above. Do not hallucinate or invent any personal details not present in this list.'
    ].join('\n');
}
