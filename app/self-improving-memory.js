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
const MAX_STORED_RULES = 40;
const MAX_INJECTED_RULES = 6;
const MAX_INJECTED_CHARS = 650;
const MAX_HISTORY_ENTRIES = 50;

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
        this.initialized = false;
    }

    async init(storageProvider = null) {
        this.storage = storageProvider || (typeof globalThis !== 'undefined' && globalThis.JarvisIndexedDbStorage ? globalThis.JarvisIndexedDbStorage : null);
        await this.loadPreferences();
        await this.loadStats();
        this.initialized = true;
        return this;
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
        if (!cleanDirective || cleanDirective.length < 6) return null;

        const category = String(options.category || 'feedback_adaptation').trim();
        const scope = options.scope || inferScopeForCategory(category);
        const now = Date.now();

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
        }
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
            satisfactionRate
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
        await this.savePreferences();
        await this.saveStats();
    }

    injectIntoSystemPrompt(baseSystemPrompt = '', activeQuery = '') {
        const relevant = activeQuery
            ? this.findRelevantPreferences(activeQuery, 0.15, MAX_INJECTED_RULES)
            : this.findRelevantPreferences('', 0, MAX_INJECTED_RULES);
        const directives = [];
        let charBudget = 0;
        for (const pref of relevant) {
            const line = String(pref?.directive || '').trim();
            if (!line) continue;
            if (charBudget + line.length + 3 > MAX_INJECTED_CHARS && directives.length > 0) break;
            directives.push(line);
            charBudget += line.length + 3;
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
