/**
 * Autonomous Self-Improving Conversational Memory & Preference Engine (Production Closed-Loop)
 * - Detects user corrections and preference declarations in chat
 * - Learns from both Thumbs Up (positive reinforcement) and Thumbs Down (structured tags + comments)
 * - Resolves conflicting directives automatically (e.g. concise vs. detailed)
 * - Uses Two-Tier Injection: global style/quality rules always active + topic-scoped rules via semantic retrieval
 * - Enforces a strict prompt budget (max 6 rules / 600 chars) so latency never degrades
 */

export function textToEmbeddingVector(text, dim = 512) {
    const v = new Float32Array(dim);
    const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return v;
    for (const token of tokens) {
        let h1 = 0x811c9dc5;
        let h2 = 0x5bd1e995;
        for (let i = 0; i < token.length; i++) {
            const code = token.charCodeAt(i);
            h1 ^= code;
            h1 = Math.imul(h1, 0x01000193);
            h2 ^= code;
            h2 = Math.imul(h2, 0x5bd1e995);
        }
        const idx1 = Math.abs(h1) % dim;
        const idx2 = Math.abs(h2) % dim;
        v[idx1] += 1.0;
        v[idx2] += 0.5;
        if (token.length >= 4) {
            for (let i = 0; i < token.length - 2; i++) {
                const trigram = token.slice(i, i + 3);
                let th = 0;
                for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                v[Math.abs(th) % dim] += 0.2;
            }
        }
    }
    let norm = 0;
    for (let i = 0; i < dim; i++) norm += v[i] * v[i];
    norm = Math.sqrt(norm);
    if (norm > 0) {
        for (let i = 0; i < dim; i++) v[i] /= norm;
    }
    return v;
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    const len = Math.min(a.length, b.length);
    for (let i = 0; i < len; i++) dot += a[i] * b[i];
    return dot;
}

const STORAGE_KEY = 'jarvis_learned_preferences';
const STATS_STORAGE_KEY = 'jarvis_feedback_loop_stats';
const CRSI_STATE_STORAGE_KEY = 'jarvis_crsi_recursive_state_v1';
const MAX_STORED_RULES = 40;
const MAX_INJECTED_RULES = 6;
const MAX_INJECTED_CHARS = 650;
const MAX_HISTORY_ENTRIES = 50;
const MAX_FAILURE_SIGNATURES = 30;
const MAX_POLICY_SNAPSHOTS = 5;
const CONSOLIDATION_INTERVAL_TURNS = 10;
const DECAY_AGE_MS = 14 * 24 * 60 * 60 * 1000;

// Immutable safety invariant guard: learned rules may NEVER weaken safety, hallucination, or DLP policies.
const UNSAFE_RULE_INVARIANT_PATTERN = /\b(?:ignore\s+(?:safety|guardrails|policy|previous\s+instructions)|disable\s+(?:safety|dlp|pii|guardrail)|allow\s+(?:nsfw|porn|hate\s+speech|harassment|cruelty)|make\s+up\s+facts|fabricate\s+citations|reveal\s+system\s+prompt)\b/i;

export function isRuleSafeAgainstInvariants(directive = '') {
    const clean = String(directive || '').trim();
    if (!clean || clean.length < 6) return false;
    return !UNSAFE_RULE_INVARIANT_PATTERN.test(clean);
}

const GLOBAL_CATEGORIES = new Set([
    'conciseness',
    'accuracy_scrutiny',
    'formatting',
    'tone',
    'user_identity',
    'depth_and_rigor',
    'negative_constraint',
    'positive_preference',
    'routing_accuracy',
    'negative_feedback_adaptation'
]);

const CONFLICT_PAIRS = [
    ['conciseness', 'depth_and_rigor']
];

function inferScopeForCategory(category = '') {
    return GLOBAL_CATEGORIES.has(String(category || '').toLowerCase()) ? 'global' : 'topic';
}

function getConflictingCategories(category = '') {
    const c = String(category || '').toLowerCase();
    const out = [];
    for (const [a, b] of CONFLICT_PAIRS) {
        if (c === a) out.push(b);
        else if (c === b) out.push(a);
    }
    return out;
}

export class SelfImprovingMemoryEngine {
    constructor() {
        this.preferences = [];
        this.feedbackStats = { positive: 0, negative: 0, history: [] };
        this.failureLedger = [];
        this.policySnapshots = [];
        this.turnInjections = [];
        this.modelBanditStats = {};
        this.recentOutcomeWindow = [];
        this.turnsSinceConsolidation = 0;
        this.consolidationCount = 0;
        this.rollbackCount = 0;
        this.initialized = false;
    }

    async init(storageProvider = null) {
        this.storage = storageProvider || (typeof globalThis !== 'undefined' && globalThis.JarvisIndexedDbStorage ? globalThis.JarvisIndexedDbStorage : null);
        await this.loadPreferences();
        await this.loadStats();
        await this.loadCrsiState();
        this.initialized = true;
        return this;
    }

    async loadCrsiState() {
        try {
            let data = null;
            if (this.storage?.getItem) {
                const raw = await this.storage.getItem(CRSI_STATE_STORAGE_KEY);
                data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } else if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(CRSI_STATE_STORAGE_KEY);
                data = raw ? JSON.parse(raw) : null;
            }
            if (data && typeof data === 'object') {
                this.failureLedger = Array.isArray(data.failureLedger) ? data.failureLedger.slice(-MAX_FAILURE_SIGNATURES) : [];
                this.policySnapshots = Array.isArray(data.policySnapshots) ? data.policySnapshots.slice(-MAX_POLICY_SNAPSHOTS) : [];
                this.modelBanditStats = data.modelBanditStats && typeof data.modelBanditStats === 'object' ? data.modelBanditStats : {};
                this.recentOutcomeWindow = Array.isArray(data.recentOutcomeWindow) ? data.recentOutcomeWindow.slice(-12) : [];
                this.turnsSinceConsolidation = Number(data.turnsSinceConsolidation) || 0;
                this.consolidationCount = Number(data.consolidationCount) || 0;
                this.rollbackCount = Number(data.rollbackCount) || 0;
            }
        } catch (_) {}
    }

    async saveCrsiState() {
        try {
            const payload = JSON.stringify({
                failureLedger: (this.failureLedger || []).slice(-MAX_FAILURE_SIGNATURES),
                policySnapshots: (this.policySnapshots || []).slice(-MAX_POLICY_SNAPSHOTS),
                modelBanditStats: this.modelBanditStats || {},
                recentOutcomeWindow: (this.recentOutcomeWindow || []).slice(-12),
                turnsSinceConsolidation: this.turnsSinceConsolidation || 0,
                consolidationCount: this.consolidationCount || 0,
                rollbackCount: this.rollbackCount || 0
            });
            if (this.storage?.setItem) {
                await this.storage.setItem(CRSI_STATE_STORAGE_KEY, payload);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(CRSI_STATE_STORAGE_KEY, payload);
            }
        } catch (_) {}
    }

    async loadPreferences() {
        try {
            let data = null;
            if (this.storage?.getItem) {
                const raw = await this.storage.getItem(STORAGE_KEY);
                data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } else if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(STORAGE_KEY);
                data = raw ? JSON.parse(raw) : null;
            }
            if (Array.isArray(data)) {
                this.preferences = data
                    .filter(p => p && typeof p.directive === 'string' && p.directive.trim())
                    .map(p => ({
                        enabled: p.enabled !== false,
                        scope: p.scope || inferScopeForCategory(p.category),
                        confidence: Number.isFinite(Number(p.confidence)) ? Number(p.confidence) : 0.75,
                        reinforcements: Number.isFinite(Number(p.reinforcements)) ? Number(p.reinforcements) : 1,
                        source: p.source || 'conversation',
                        updatedAt: p.updatedAt || p.detectedAt || Date.now(),
                        ...p
                    }));
            }
        } catch (_) {
            this.preferences = [];
        }
        return this.preferences;
    }

    async loadStats() {
        try {
            let data = null;
            if (this.storage?.getItem) {
                const raw = await this.storage.getItem(STATS_STORAGE_KEY);
                data = typeof raw === 'string' ? JSON.parse(raw) : raw;
            } else if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem(STATS_STORAGE_KEY);
                data = raw ? JSON.parse(raw) : null;
            }
            if (data && typeof data === 'object') {
                this.feedbackStats = {
                    positive: Number(data.positive) || 0,
                    negative: Number(data.negative) || 0,
                    history: Array.isArray(data.history) ? data.history.slice(-MAX_HISTORY_ENTRIES) : []
                };
            }
        } catch (_) {
            this.feedbackStats = { positive: 0, negative: 0, history: [] };
        }
        return this.feedbackStats;
    }

    async savePreferences() {
        try {
            if (this.preferences.length > MAX_STORED_RULES) {
                this.preferences = this.preferences
                    .sort((a, b) => (Number(b.confidence || 0.7) - Number(a.confidence || 0.7)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
                    .slice(0, MAX_STORED_RULES);
            }
            const payload = JSON.stringify(this.preferences);
            if (this.storage?.setItem) {
                await this.storage.setItem(STORAGE_KEY, payload);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, payload);
            }
        } catch (_) {}
    }

    async saveStats() {
        try {
            const payload = JSON.stringify({
                positive: this.feedbackStats.positive,
                negative: this.feedbackStats.negative,
                history: (this.feedbackStats.history || []).slice(-MAX_HISTORY_ENTRIES)
            });
            if (this.storage?.setItem) {
                await this.storage.setItem(STATS_STORAGE_KEY, payload);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STATS_STORAGE_KEY, payload);
            }
        } catch (_) {}
    }

    /**
     * Learns an explicit preference/adaptation rule with semantic deduplication,
     * confidence reinforcement, and automatic conflict superseding.
     */
    async learnExplicitRule(directive = '', source = 'feedback', options = {}) {
        const cleanDirective = String(directive || '').replace(/\s+/g, ' ').trim();
        if (!isRuleSafeAgainstInvariants(cleanDirective)) return null;

        const category = String(options.category || 'feedback_adaptation').trim();
        const scope = options.scope || inferScopeForCategory(category);
        const now = Date.now();

        if (!this.policySnapshots.length && this.preferences.length > 0) {
            this.createPolicySnapshot('pre_rule_update');
        }

        // 1. Supersede conflicting categories (e.g. "be concise" supersedes "more detailed")
        const conflicts = getConflictingCategories(category);
        if (conflicts.length > 0) {
            this.preferences = this.preferences.filter(p => !conflicts.includes(String(p.category || '').toLowerCase()));
        }

        // 2. Deduplicate exact or near-duplicate directives (>= 0.82 cosine similarity) by reinforcing confidence
        const newVec = textToEmbeddingVector(cleanDirective);
        const existing = this.preferences.find(p => {
            if (p.directive.toLowerCase() === cleanDirective.toLowerCase()) return true;
            if (p.category === category && vectorCosineSimilarity(newVec, textToEmbeddingVector(p.directive)) >= 0.82) return true;
            return false;
        });

        if (existing) {
            existing.enabled = true;
            existing.confidence = Math.min(1.0, Number((Number(existing.confidence || 0.75) + 0.08).toFixed(2)));
            existing.reinforcements = Number(existing.reinforcements || 1) + 1;
            existing.updatedAt = now;
            if (options.rawPrompt) existing.rawPrompt = String(options.rawPrompt).slice(0, 220);
            await this.savePreferences();
            return existing;
        }

        const item = {
            id: `pref_${source}_${now.toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            category,
            scope,
            source,
            directive: cleanDirective.slice(0, 180),
            rawPrompt: String(options.rawPrompt || `${source}: ${cleanDirective}`).slice(0, 220),
            confidence: Number.isFinite(Number(options.confidence)) ? Number(options.confidence) : (source === 'feedback' ? 0.85 : 0.78),
            reinforcements: 1,
            enabled: true,
            detectedAt: now,
            updatedAt: now
        };
        this.preferences.push(item);
        await this.savePreferences();
        return item;
    }

    /**
     * Records positive (thumbs-up) feedback, reinforcing active learned directives
     * and updating satisfaction telemetry.
     */
    async recordPositiveFeedback({ messageId = '', turnId = '', query = '', response = '', modelUsed = '' } = {}) {
        const now = Date.now();
        this.feedbackStats.positive = Number(this.feedbackStats.positive || 0) + 1;
        this.feedbackStats.history = [
            ...(this.feedbackStats.history || []).slice(-(MAX_HISTORY_ENTRIES - 1)),
            {
                type: 'positive',
                messageId: String(messageId || ''),
                turnId: String(turnId || ''),
                queryPreview: String(query || '').slice(0, 100),
                modelUsed: String(modelUsed || ''),
                at: now
            }
        ];

        // Reinforce currently active global directives that contributed to this liked answer
        let reinforced = 0;
        for (const pref of this.preferences) {
            if (pref.enabled !== false && (pref.scope === 'global' || inferScopeForCategory(pref.category) === 'global')) {
                pref.confidence = Math.min(1.0, Number((Number(pref.confidence || 0.75) + 0.04).toFixed(2)));
                pref.reinforcements = Number(pref.reinforcements || 1) + 1;
                pref.updatedAt = now;
                reinforced++;
            }
        }
        if (reinforced > 0) {
            await this.savePreferences();
        }
        await this.assignTurnOutcome({
            turnId,
            query,
            score: 1,
            weight: 1.0,
            signal: 'thumbs_up',
            modelUsed
        });
        await this.saveStats();
        return { ok: true, reinforced, stats: this.getStats() };
    }

    /**
     * Inspects the user's message for explicit feedback, corrections, or preference declarations.
     */
    detectCorrectionOrPreference(userMessage = '', previousAssistantMessage = '') {
        const raw = String(userMessage || '').trim();
        if (!raw || raw.length < 4 || raw.length > 500) return null;

        const lower = raw.toLowerCase();

        // 1. Negative formatting / style correction
        const negativeMatch = raw.match(/\b(?:don'?t|do\s+not|stop|never|avoid|no\s+more)\s+(?:use|using|include|including|give|giving|make|making|write|writing)\s+([^.!?\n]{3,80})/i);
        if (negativeMatch) {
            const subject = negativeMatch[1].trim().replace(/\b(?:please|from\s+now\s+on|anymore|again)\b/gi, '').trim();
            if (subject) {
                return {
                    category: 'negative_constraint',
                    scope: 'global',
                    directive: `Avoid ${subject}.`,
                    rawPrompt: raw,
                    enabled: true,
                    detectedAt: Date.now()
                };
            }
        }

        // 2. Positive style / format directive
        const positiveMatch = raw.match(/\b(?:always|from\s+now\s+on\s*,?\s*always|prefer|make\s+sure\s+to|please\s+always)\s+(?:use|give|write|respond\s+in|format\s+in|answer\s+in)\s+([^.!?\n]{3,80})/i);
        if (positiveMatch) {
            const subject = positiveMatch[1].trim().replace(/\b(?:please|from\s+now\s+on)\b/gi, '').trim();
            if (subject) {
                return {
                    category: 'positive_preference',
                    scope: 'global',
                    directive: `Prefer ${subject}.`,
                    rawPrompt: raw,
                    enabled: true,
                    detectedAt: Date.now()
                };
            }
        }

        // 3. Programming language / Idiom preferences: "prefer TypeScript over JavaScript", "use Tailwind for CSS"
        const codeIdiomMatch = raw.match(/\b(?:prefer|use)\s+([a-zA-Z0-9.#+_-]{2,25})\s+(?:over|instead\s+of|for)\s+([^.!?\n]{3,40})/i);
        if (codeIdiomMatch) {
            const tool = codeIdiomMatch[1].trim();
            const alt = codeIdiomMatch[2].trim();
            return {
                category: 'code_preference',
                scope: 'topic',
                directive: `Prefer ${tool} instead of ${alt}.`,
                rawPrompt: raw,
                enabled: true,
                detectedAt: Date.now()
            };
        }

        // 4. User Identity / Title declaration
        const identityMatch = raw.match(/\b(?:call\s+me|address\s+me\s+as|my\s+name\s+is)\s+([^\r\n!?]+?)(?:[!?\n]|$)/i);
        if (identityMatch) {
            const nameOrTitle = identityMatch[1].trim().replace(/[.,;:!?]+$/, '').trim();
            if (nameOrTitle) {
                return {
                    category: 'user_identity',
                    scope: 'global',
                    directive: `Address the user as ${nameOrTitle}.`,
                    rawPrompt: raw,
                    enabled: true,
                    detectedAt: Date.now()
                };
            }
        }

        // 5. Concise / Length adjustments
        if (/\b(?:be\s+(?:more\s+)?concise|keep\s+it\s+(?:very\s+)?brief|shorter\s+answers?|no\s+fluff|give\s+direct\s+answers?)\b/i.test(lower)) {
            return {
                category: 'conciseness',
                scope: 'global',
                directive: 'Keep answers direct, concise, and free of conversational filler.',
                rawPrompt: raw,
                enabled: true,
                detectedAt: Date.now()
            };
        }

        return null;
    }

    /**
     * Synthesizes actionable heuristic rules when negative (thumbs-down) feedback is received,
     * supporting both structured reason tags and free-text comments.
     */
    async distillNegativeFeedback(feedbackReason = '', query = '', previousResponse = '', options = {}) {
        const tags = Array.isArray(options?.tags) ? options.tags.map(t => String(t || '').trim()).filter(Boolean) : [];
        const comment = String(options?.comment || '').trim();
        const combinedRaw = [String(feedbackReason || '').trim(), ...tags, comment].filter(Boolean).join('; ');
        const reason = combinedRaw.toLowerCase();
        const now = Date.now();

        this.feedbackStats.negative = Number(this.feedbackStats.negative || 0) + 1;
        this.feedbackStats.history = [
            ...(this.feedbackStats.history || []).slice(-(MAX_HISTORY_ENTRIES - 1)),
            {
                type: 'negative',
                tags,
                reason: combinedRaw.slice(0, 160),
                queryPreview: String(query || '').slice(0, 100),
                at: now
            }
        ];
        await this.saveStats();

        const candidates = [];
        const pushCandidate = (category, directive) => {
            if (!candidates.some(c => c.category === category)) {
                candidates.push({ category, directive });
            }
        };

        if (reason.includes('verbose') || reason.includes('too long') || reason.includes('wordy') || reason.includes('shorter')) {
            pushCandidate('conciseness', 'Keep answers direct, concise, and eliminate conversational filler.');
        }
        if (reason.includes('inaccurate') || reason.includes('wrong') || reason.includes('hallucination') || reason.includes('incorrect') || reason.includes('false')) {
            pushCandidate('accuracy_scrutiny', 'Verify all factual and numerical assertions with extreme scrutiny before outputting.');
        }
        if (reason.includes('format') || reason.includes('structure') || reason.includes('layout') || reason.includes('bullet') || reason.includes('math')) {
            pushCandidate('formatting', 'Strictly adhere to requested output structure without extraneous markdown or broken formatting.');
        }
        if (reason.includes('incomplete') || reason.includes('missing') || reason.includes('unhelpful') || reason.includes('generic') || reason.includes('too short')) {
            pushCandidate('depth_and_rigor', 'Provide complete, concrete, actionable answers covering all parts of the user prompt.');
        }
        if (reason.includes('tone') || reason.includes('rude') || reason.includes('robotic') || reason.includes('preachy')) {
            pushCandidate('tone', 'Maintain a clear, natural, objective tone without lecturing or filler.');
        }
        if (reason.includes('wrong tool') || reason.includes('wrong route') || reason.includes('misrouted')) {
            pushCandidate('routing_accuracy', 'Answer the user\'s literal domain intent directly without misrouting to unrelated tools.');
        }

        // Also distill explicit user comment if it contains actionable detail not covered solely by generic tags
        const customText = comment || (tags.length === 0 ? String(feedbackReason || '').trim() : '');
        if (customText.length > 5 && (candidates.length === 0 || comment.length >= 10)) {
            const detected = this.detectCorrectionOrPreference(customText, previousResponse);
            if (detected) {
                pushCandidate(detected.category, detected.directive);
            } else {
                pushCandidate('negative_feedback_adaptation', `Ensure responses address: ${customText.slice(0, 100)}.`);
            }
        }

        let primaryLearned = null;
        for (const cand of candidates) {
            const learned = await this.learnExplicitRule(cand.directive, 'feedback', {
                category: cand.category,
                scope: inferScopeForCategory(cand.category),
                rawPrompt: `Negative feedback: ${combinedRaw.slice(0, 160)}`,
                confidence: 0.85
            });
            if (learned && !primaryLearned) primaryLearned = learned;
            if (query && cand.directive) {
                await this.recordFailureSignature({
                    query,
                    category: cand.category,
                    pitfall: combinedRaw.slice(0, 140),
                    fixDirective: cand.directive
                });
            }
        }
        await this.assignTurnOutcome({
            turnId: options?.turnId || '',
            query,
            score: -1,
            weight: 1.0,
            signal: 'thumbs_down',
            modelUsed: options?.modelUsed || ''
        });
        return primaryLearned;
    }

    async processUserMessage(userMessage = '', previousAssistantMessage = '') {
        const detected = this.detectCorrectionOrPreference(userMessage, previousAssistantMessage);
        if (!detected) return null;

        return this.learnExplicitRule(detected.directive, 'conversation', {
            category: detected.category,
            scope: detected.scope || inferScopeForCategory(detected.category),
            rawPrompt: detected.rawPrompt,
            confidence: 0.8
        });
    }

    /**
     * Two-tier preference retrieval:
     * - Global style/quality directives always qualify (ranked by confidence & recency)
     * - Topic-scoped directives are retrieved via semantic vector similarity against activeQuery
     */
    findRelevantPreferences(query = '', threshold = 0.20, topK = MAX_INJECTED_RULES) {
        const active = this.preferences.filter(p => p.enabled !== false);
        if (!active.length) return [];

        const q = String(query || '').trim();
        if (!q) {
            return active
                .slice()
                .sort((a, b) => (Number(b.confidence || 0.75) - Number(a.confidence || 0.75)) || ((b.updatedAt || 0) - (a.updatedAt || 0)))
                .slice(0, topK);
        }

        const queryVec = textToEmbeddingVector(q);
        const scored = active.map(p => {
            const isGlobal = (p.scope || inferScopeForCategory(p.category)) === 'global';
            const text = `${p.directive || ''} ${p.rawPrompt || ''}`.trim();
            const sim = vectorCosineSimilarity(queryVec, textToEmbeddingVector(text));
            const conf = Number(p.confidence || 0.75);
            // Global preferences always pass with a confidence-weighted floor; topic preferences require semantic match
            const qualifies = isGlobal || sim >= threshold;
            const rankScore = isGlobal ? (0.45 * conf + 0.55 * sim) : (0.25 * conf + 0.75 * sim);
            return { preference: p, sim, qualifies, rankScore };
        });

        return scored
            .filter(item => item.qualifies)
            .sort((a, b) => b.rankScore - a.rankScore)
            .slice(0, topK)
            .map(item => item.preference);
    }

    getDirectives() {
        return this.preferences.filter(p => p.enabled !== false).map(p => p.directive).filter(Boolean);
    }

    getAll() {
        return [...this.preferences];
    }

    getAllPreferences() {
        return this.getAll();
    }

    getFailureLedger() {
        return [...(this.failureLedger || [])];
    }

    getPolicySnapshots() {
        return [...(this.policySnapshots || [])];
    }

    getRuleUtility(pref) {
        const alpha = Number.isFinite(Number(pref?.alpha)) ? Number(pref.alpha) : 2;
        const beta = Number.isFinite(Number(pref?.beta)) ? Number(pref.beta) : 1;
        return Number((alpha / (alpha + beta)).toFixed(3));
    }

    async setPinned(id, pinned = true) {
        const item = this.preferences.find(p => p.id === id);
        if (!item) return false;
        item.pinned = Boolean(pinned);
        item.updatedAt = Date.now();
        await this.savePreferences();
        return true;
    }

    createPolicySnapshot(reason = 'manual') {
        const snap = {
            id: `snap_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            reason: String(reason || 'manual'),
            createdAt: Date.now(),
            ruleCount: this.preferences.length,
            preferences: JSON.parse(JSON.stringify(this.preferences))
        };
        this.policySnapshots.push(snap);
        if (this.policySnapshots.length > MAX_POLICY_SNAPSHOTS) {
            this.policySnapshots = this.policySnapshots.slice(-MAX_POLICY_SNAPSHOTS);
        }
        return snap;
    }

    async rollbackPolicySnapshot(snapshotId = '') {
        if (!this.policySnapshots.length) return { rolledBack: false, reason: 'no_snapshots' };
        const idx = snapshotId
            ? this.policySnapshots.findIndex(s => s.id === snapshotId)
            : this.policySnapshots.length - 1;
        if (idx < 0) return { rolledBack: false, reason: 'not_found' };
        const [snap] = this.policySnapshots.splice(idx, 1);
        this.preferences = Array.isArray(snap.preferences) ? JSON.parse(JSON.stringify(snap.preferences)) : [];
        this.rollbackCount = (this.rollbackCount || 0) + 1;
        this.recentOutcomeWindow = [];
        await this.savePreferences();
        await this.saveCrsiState();
        return { rolledBack: true, snapshotId: snap.id, restoredRules: this.preferences.length, reason: snap.reason };
    }

    recordTurnInjection({ turnId = '', query = '', ruleIds = [], modelUsed = '', intent = 'general' } = {}) {
        const cleanIds = Array.isArray(ruleIds) ? ruleIds.filter(Boolean) : [];
        this.turnInjections.push({
            turnId: String(turnId || `turn_${Date.now().toString(36)}`),
            query: String(query || '').slice(0, 200),
            ruleIds: cleanIds,
            modelUsed: String(modelUsed || ''),
            intent: String(intent || 'general'),
            timestamp: Date.now()
        });
        if (this.turnInjections.length > 30) {
            this.turnInjections = this.turnInjections.slice(-30);
        }
        this.turnsSinceConsolidation = (this.turnsSinceConsolidation || 0) + 1;
        if (this.turnsSinceConsolidation >= CONSOLIDATION_INTERVAL_TURNS) {
            this.runConsolidationCycle('periodic_auto').catch(() => {});
        }
    }

    async assignTurnOutcome({ turnId = '', query = '', score = 1, weight = 1.0, signal = 'explicit', modelUsed = '', intent = 'general' } = {}) {
        const w = Math.max(0.1, Math.min(2.0, Number(weight) || 1.0));
        const matchedTurn = (turnId && this.turnInjections.find(t => t.turnId === turnId)) ||
            (query && [...this.turnInjections].reverse().find(t => t.query && t.query.toLowerCase() === String(query).slice(0, 200).toLowerCase())) ||
            this.turnInjections[this.turnInjections.length - 1] ||
            null;

        const targetRuleIds = matchedTurn?.ruleIds || [];
        let updatedAny = false;
        for (const id of targetRuleIds) {
            const pref = this.preferences.find(p => p.id === id);
            if (!pref) continue;
            pref.alpha = Number.isFinite(Number(pref.alpha)) ? Number(pref.alpha) : 2;
            pref.beta = Number.isFinite(Number(pref.beta)) ? Number(pref.beta) : 1;
            pref.evaluations = (Number(pref.evaluations) || 0) + 1;
            if (score > 0) {
                pref.alpha = Number((pref.alpha + w).toFixed(2));
                pref.helpedCount = (Number(pref.helpedCount) || 0) + 1;
                pref.confidence = Math.min(1.0, Number((Number(pref.confidence || 0.75) + 0.03 * w).toFixed(3)));
            } else {
                pref.beta = Number((pref.beta + w).toFixed(2));
                pref.hurtCount = (Number(pref.hurtCount) || 0) + 1;
                pref.confidence = Math.max(0.15, Number((Number(pref.confidence || 0.75) - 0.07 * w).toFixed(3)));
            }
            pref.utilityScore = this.getRuleUtility(pref);
            pref.updatedAt = Date.now();
            // Auto-demote consistently harmful unpinned rules after >= 3 evaluations
            if (!pref.pinned && pref.evaluations >= 3 && pref.utilityScore < 0.30) {
                pref.enabled = false;
                pref.autoDemotedAt = Date.now();
            }
            updatedAny = true;
        }

        const effectiveModel = String(modelUsed || matchedTurn?.modelUsed || '').trim();
        const effectiveIntent = String(intent || matchedTurn?.intent || 'general').trim();
        if (effectiveModel) {
            this.recordModelOutcome({ model: effectiveModel, intent: effectiveIntent, positive: score > 0, weight: w });
        }

        // Rolling regression detector: auto-rollback if 3+ negative outcomes hit within last 4 turns after a snapshot
        this.recentOutcomeWindow.push({ score: score > 0 ? 1 : -1, signal, ts: Date.now() });
        if (this.recentOutcomeWindow.length > 12) this.recentOutcomeWindow = this.recentOutcomeWindow.slice(-12);
        const lastFour = this.recentOutcomeWindow.slice(-4);
        const recentNegs = lastFour.filter(x => x.score < 0).length;
        let autoRolledBack = false;
        if (lastFour.length >= 4 && recentNegs >= 3 && this.policySnapshots.length > 0) {
            const rb = await this.rollbackPolicySnapshot();
            autoRolledBack = Boolean(rb?.rolledBack);
        }

        if (updatedAny) await this.savePreferences();
        await this.saveCrsiState();
        return { creditedRules: targetRuleIds.length, autoRolledBack };
    }

    async recordImplicitSignal(signalType = '', meta = {}) {
        const type = String(signalType || '').toLowerCase();
        const map = {
            copy: { score: 1, weight: 0.6 },
            copy_code: { score: 1, weight: 0.65 },
            export: { score: 1, weight: 0.7 },
            save_memory: { score: 1, weight: 0.8 },
            regenerate: { score: -1, weight: 0.75 },
            stop_stream: { score: -1, weight: 0.4 }
        };
        const cfg = map[type];
        if (!cfg) return null;
        return this.assignTurnOutcome({
            turnId: meta?.turnId || '',
            query: meta?.query || '',
            score: cfg.score,
            weight: cfg.weight,
            signal: `implicit_${type}`,
            modelUsed: meta?.modelUsed || '',
            intent: meta?.intent || 'general'
        });
    }

    async recordFailureSignature({ query = '', category = 'general', pitfall = '', fixDirective = '' } = {}) {
        const cleanQuery = String(query || '').trim().slice(0, 220);
        const cleanFix = String(fixDirective || '').trim().slice(0, 180);
        if (!cleanQuery || !cleanFix || !isRuleSafeAgainstInvariants(cleanFix)) return null;
        const qVec = textToEmbeddingVector(cleanQuery);
        const existing = this.failureLedger.find(entry =>
            entry.category === category && vectorCosineSimilarity(qVec, textToEmbeddingVector(entry.querySnippet)) >= 0.78
        );
        if (existing) {
            existing.hitCount = (Number(existing.hitCount) || 1) + 1;
            existing.fixDirective = cleanFix;
            existing.pitfall = String(pitfall || existing.pitfall || '').slice(0, 160);
            existing.updatedAt = Date.now();
            await this.saveCrsiState();
            return existing;
        }
        const sig = {
            id: `fail_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
            querySnippet: cleanQuery,
            category: String(category || 'general'),
            pitfall: String(pitfall || '').slice(0, 160),
            fixDirective: cleanFix,
            hitCount: 1,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };
        this.failureLedger.unshift(sig);
        if (this.failureLedger.length > MAX_FAILURE_SIGNATURES) {
            this.failureLedger = this.failureLedger.slice(0, MAX_FAILURE_SIGNATURES);
        }
        await this.saveCrsiState();
        return sig;
    }

    findMatchingFailureGuardrails(query = '', threshold = 0.32, maxItems = 2) {
        const q = String(query || '').trim();
        if (!q || !this.failureLedger.length) return [];
        const qVec = textToEmbeddingVector(q);
        return this.failureLedger
            .map(sig => ({ sig, sim: vectorCosineSimilarity(qVec, textToEmbeddingVector(sig.querySnippet)) }))
            .filter(item => item.sim >= threshold)
            .sort((a, b) => (b.sim * (1 + Math.min(3, b.sig.hitCount || 1) * 0.1)) - (a.sim * (1 + Math.min(3, a.sig.hitCount || 1) * 0.1)))
            .slice(0, maxItems)
            .map(item => item.sig);
    }

    recordModelOutcome({ model = '', intent = 'general', positive = true, weight = 1.0 } = {}) {
        const key = `${String(intent || 'general').toLowerCase()}::${String(model || '').trim()}`;
        if (!model) return;
        const curr = this.modelBanditStats[key] || { intent, model, alpha: 2, beta: 1, pulls: 0, updatedAt: Date.now() };
        curr.pulls += 1;
        if (positive) curr.alpha = Number((curr.alpha + weight).toFixed(2));
        else curr.beta = Number((curr.beta + weight).toFixed(2));
        curr.score = Number((curr.alpha / (curr.alpha + curr.beta)).toFixed(3));
        curr.updatedAt = Date.now();
        this.modelBanditStats[key] = curr;
    }

    getModelBanditHint(intent = 'general') {
        const prefix = `${String(intent || 'general').toLowerCase()}::`;
        const candidates = Object.entries(this.modelBanditStats || {})
            .filter(([k]) => k.startsWith(prefix))
            .map(([, v]) => v);
        if (!candidates.length) return null;
        const totalPulls = candidates.reduce((sum, c) => sum + (Number(c.pulls) || 0), 0) + 1;
        const scored = candidates.map(c => {
            const mean = Number(c.alpha || 2) / (Number(c.alpha || 2) + Number(c.beta || 1));
            const ucb = mean + Math.sqrt((1.2 * Math.log(totalPulls + 1)) / ((Number(c.pulls) || 0) + 1));
            return { ...c, ucb: Number(ucb.toFixed(3)) };
        }).sort((a, b) => b.ucb - a.ucb);
        return scored[0] || null;
    }

    /**
     * Periodic Sleep / Consolidation Cycle:
     * 1. Snapshots current policy for safe rollback
     * 2. Compresses/merges overlapping rules (cosine >= 0.72)
     * 3. Applies 14-day temporal decay to unpinned stale rules
     * 4. Prunes disabled low-utility rules beyond budget
     */
    async runConsolidationCycle(reason = 'manual') {
        this.createPolicySnapshot(`pre_consolidation_${reason}`);
        const now = Date.now();
        let mergedCount = 0;
        let decayedCount = 0;
        let prunedCount = 0;

        const consolidated = [];
        for (const pref of this.preferences) {
            if (!pref || !pref.directive || !isRuleSafeAgainstInvariants(pref.directive)) {
                prunedCount += 1;
                continue;
            }
            const vec = textToEmbeddingVector(pref.directive);
            const dup = consolidated.find(c =>
                c.category === pref.category &&
                vectorCosineSimilarity(vec, textToEmbeddingVector(c.directive)) >= 0.72
            );
            if (dup) {
                dup.reinforcements = (Number(dup.reinforcements) || 1) + (Number(pref.reinforcements) || 1);
                dup.alpha = Number(((Number(dup.alpha) || 2) + Math.max(0, (Number(pref.alpha) || 2) - 2)).toFixed(2));
                dup.beta = Number(((Number(dup.beta) || 1) + Math.max(0, (Number(pref.beta) || 1) - 1)).toFixed(2));
                dup.confidence = Math.min(1.0, Math.max(Number(dup.confidence || 0.75), Number(pref.confidence || 0.75)) + 0.04);
                dup.pinned = Boolean(dup.pinned || pref.pinned);
                dup.updatedAt = Math.max(Number(dup.updatedAt || 0), Number(pref.updatedAt || 0));
                if (pref.directive.length > dup.directive.length && pref.directive.length <= 160) {
                    dup.directive = pref.directive;
                }
                mergedCount += 1;
                continue;
            }
            // Temporal decay for stale unpinned rules older than 14 days
            const ageMs = now - Number(pref.updatedAt || pref.detectedAt || now);
            if (!pref.pinned && ageMs > DECAY_AGE_MS) {
                pref.confidence = Math.max(0.2, Number((Number(pref.confidence || 0.75) * 0.90).toFixed(3)));
                decayedCount += 1;
            }
            if (!pref.pinned && pref.enabled === false && this.getRuleUtility(pref) < 0.30) {
                prunedCount += 1;
                continue;
            }
            consolidated.push(pref);
        }

        this.preferences = consolidated;
        this.turnsSinceConsolidation = 0;
        this.consolidationCount = (this.consolidationCount || 0) + 1;
        await this.savePreferences();
        await this.saveCrsiState();
        return {
            mergedCount,
            decayedCount,
            prunedCount,
            remainingRules: this.preferences.length,
            consolidationCount: this.consolidationCount
        };
    }

    getStats() {
        const totalRules = this.preferences.length;
        const activeRules = this.preferences.filter(p => p.enabled !== false).length;
        const globalRules = this.preferences.filter(p => p.enabled !== false && (p.scope || inferScopeForCategory(p.category)) === 'global').length;
        const topicRules = Math.max(0, activeRules - globalRules);
        const positiveCount = Number(this.feedbackStats?.positive || 0);
        const negativeCount = Number(this.feedbackStats?.negative || 0);
        const totalVotes = positiveCount + negativeCount;
        const satisfactionRate = totalVotes > 0 ? Math.round((positiveCount / totalVotes) * 100) : null;
        return {
            totalRules,
            activeRules,
            globalRules,
            topicRules,
            positiveCount,
            negativeCount,
            satisfactionRate,
            failureLedgerCount: (this.failureLedger || []).length,
            snapshotCount: (this.policySnapshots || []).length,
            consolidationCount: this.consolidationCount || 0,
            rollbackCount: this.rollbackCount || 0
        };
    }

    async toggle(id, enabled) {
        const item = this.preferences.find(p => p.id === id);
        if (item) {
            item.enabled = Boolean(enabled);
            item.updatedAt = Date.now();
            await this.savePreferences();
            return true;
        }
        return false;
    }

    async remove(id) {
        this.preferences = this.preferences.filter(p => p.id !== id);
        await this.savePreferences();
    }

    async clear() {
        this.preferences = [];
        this.feedbackStats = { positive: 0, negative: 0, history: [] };
        this.failureLedger = [];
        this.policySnapshots = [];
        this.turnInjections = [];
        this.modelBanditStats = {};
        this.recentOutcomeWindow = [];
        this.turnsSinceConsolidation = 0;
        await this.savePreferences();
        await this.saveStats();
        await this.saveCrsiState();
    }

    injectIntoSystemPrompt(baseSystemPrompt = '', activeQuery = '', meta = {}) {
        const relevant = activeQuery
            ? this.findRelevantPreferences(activeQuery, 0.15, MAX_INJECTED_RULES)
            : this.findRelevantPreferences('', 0, MAX_INJECTED_RULES);
        const directives = [];
        const injectedIds = [];
        let charBudget = 0;
        for (const pref of relevant) {
            const line = String(pref?.directive || '').trim();
            if (!line || !isRuleSafeAgainstInvariants(line)) continue;
            if (charBudget + line.length + 3 > MAX_INJECTED_CHARS && directives.length > 0) break;
            directives.push(line);
            if (pref.id) injectedIds.push(pref.id);
            charBudget += line.length + 3;
        }

        // Mistake-Aware Pre-Flight Checklist: attach matching past failure guardrails only on similar queries
        const failureMatches = activeQuery ? this.findMatchingFailureGuardrails(activeQuery, 0.32, 2) : [];
        for (const sig of failureMatches) {
            const line = `Past pitfall guardrail: ${sig.fixDirective}`;
            if (charBudget + line.length + 3 <= MAX_INJECTED_CHARS + 160) {
                directives.push(line);
                charBudget += line.length + 3;
            }
        }

        if (injectedIds.length || activeQuery) {
            this.recordTurnInjection({
                turnId: meta?.turnId || '',
                query: activeQuery,
                ruleIds: injectedIds,
                modelUsed: meta?.modelUsed || '',
                intent: meta?.intent || 'general'
            });
        }

        if (!directives.length) return baseSystemPrompt;

        const learnedBlock = [
            '',
            '=== USER LEARNED PREFERENCES & ADAPTATIONS ===',
            ...directives.map(d => `- ${d}`),
            '=============================================='
        ].join('\n');

        return (baseSystemPrompt || '').trim() + '\n' + learnedBlock;
    }
}

export const selfImprovingMemory = new SelfImprovingMemoryEngine();
