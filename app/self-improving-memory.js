/**
 * Autonomous Self-Improving Conversational Memory & Preference Engine
 * Dynamically detects user corrections, extracts preference directives,
 * distills negative feedback, persists them in IndexedDB/localStorage,
 * and injects them into system context.
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
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

const STORAGE_KEY = 'jarvis_learned_preferences';

export class SelfImprovingMemoryEngine {
    constructor() {
        this.preferences = [];
        this.initialized = false;
    }

    async init(storageProvider = null) {
        this.storage = storageProvider || (typeof globalThis !== 'undefined' && globalThis.JarvisIndexedDbStorage ? globalThis.JarvisIndexedDbStorage : null);
        await this.loadPreferences();
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
                this.preferences = data.filter(p => p && typeof p.directive === 'string' && p.directive.trim()).map(p => ({
                    enabled: p.enabled !== false,
                    ...p
                }));
            }
        } catch (_) {
            this.preferences = [];
        }
        return this.preferences;
    }

    async savePreferences() {
        try {
            const payload = JSON.stringify(this.preferences);
            if (this.storage?.setItem) {
                await this.storage.setItem(STORAGE_KEY, payload);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(STORAGE_KEY, payload);
            }
        } catch (_) {}
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
                directive: 'Keep answers direct, concise, and free of conversational filler.',
                rawPrompt: raw,
                enabled: true,
                detectedAt: Date.now()
            };
        }

        return null;
    }

    /**
     * Synthesizes an actionable heuristic rule when negative feedback is received with a reason.
     */
    async distillNegativeFeedback(feedbackReason = '', query = '', previousResponse = '') {
        const reason = String(feedbackReason || '').toLowerCase().trim();
        let directive = '';
        let category = 'negative_feedback_adaptation';

        if (reason.includes('verbose') || reason.includes('too long') || reason.includes('wordy')) {
            directive = 'Keep answers direct, concise, and eliminate conversational filler.';
            category = 'conciseness';
        } else if (reason.includes('inaccurate') || reason.includes('wrong') || reason.includes('hallucination') || reason.includes('incorrect')) {
            directive = 'Verify all factual and numerical assertions with extreme scrutiny before outputting.';
            category = 'accuracy_scrutiny';
        } else if (reason.includes('format') || reason.includes('structure') || reason.includes('layout')) {
            directive = 'Strictly adhere to requested output structure without extraneous markdown wrapping.';
            category = 'formatting';
        } else if (reason.includes('unhelpful') || reason.includes('generic')) {
            directive = 'Provide concrete, actionable solutions with specific examples rather than high-level generalizations.';
            category = 'depth_and_rigor';
        } else if (reason.length > 5) {
            directive = `Ensure responses address: ${feedbackReason.slice(0, 80)}.`;
        }

        if (directive) {
            const exists = this.preferences.some(p => p.directive.toLowerCase() === directive.toLowerCase());
            if (!exists) {
                const item = {
                    id: 'pref_neg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                    category,
                    directive,
                    rawPrompt: `Negative feedback: ${feedbackReason}`,
                    enabled: true,
                    detectedAt: Date.now()
                };
                this.preferences.push(item);
                await this.savePreferences();
                return item;
            }
        }
        return null;
    }

    async processUserMessage(userMessage = '', previousAssistantMessage = '') {
        const detected = this.detectCorrectionOrPreference(userMessage, previousAssistantMessage);
        if (!detected) return null;

        const exists = this.preferences.some(p => p.directive.toLowerCase() === detected.directive.toLowerCase());
        if (!exists) {
            const item = {
                id: 'pref_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
                ...detected
            };
            this.preferences.push(item);
            await this.savePreferences();
            return item;
        }
        return null;
    }

    /**
     * Performs semantic vector retrieval across stored preferences against an active query.
     */
    findRelevantPreferences(query = '', threshold = 0.20, topK = 5) {
        const active = this.preferences.filter(p => p.enabled !== false);
        const q = String(query || '').trim();
        if (!q || !active.length) return active.slice(0, topK);

        const queryVec = textToEmbeddingVector(q);
        return active
            .map(p => {
                const text = `${p.directive || ''} ${p.rawPrompt || ''}`.trim();
                const pVec = textToEmbeddingVector(text);
                const score = vectorCosineSimilarity(queryVec, pVec);
                return { preference: p, score };
            })
            .filter(item => item.score >= threshold)
            .sort((a, b) => b.score - a.score)
            .slice(0, topK)
            .map(item => item.preference);
    }

    getDirectives() {
        return this.preferences.filter(p => p.enabled !== false).map(p => p.directive).filter(Boolean);
    }

    getAll() {
        return [...this.preferences];
    }

    async toggle(id, enabled) {
        const item = this.preferences.find(p => p.id === id);
        if (item) {
            item.enabled = Boolean(enabled);
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
        await this.savePreferences();
    }

    injectIntoSystemPrompt(baseSystemPrompt = '', activeQuery = '') {
        const relevant = activeQuery
            ? this.findRelevantPreferences(activeQuery, 0.15)
            : this.preferences.filter(p => p.enabled !== false);
        const directives = relevant.map(p => p.directive).filter(Boolean);
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
