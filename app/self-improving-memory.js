/**
 * Autonomous Self-Improving Conversational Memory & Preference Engine
 * Dynamically detects user corrections, extracts preference directives,
 * persists them in IndexedDB, and injects them into system context.
 */

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
                this.preferences = data.filter(p => p && typeof p.directive === 'string' && p.directive.trim());
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
        // e.g. "Don't use bullet points", "Stop using bullet points", "No more bullet lists", "Never give long answers"
        const negativeMatch = raw.match(/\b(?:don'?t|do\s+not|stop|never|avoid|no\s+more)\s+(?:use|using|include|including|give|giving|make|making|write|writing)\s+([^.!?\n]{3,80})/i);
        if (negativeMatch) {
            const subject = negativeMatch[1].trim().replace(/\b(?:please|from\s+now\s+on|anymore|again)\b/gi, '').trim();
            if (subject) {
                return {
                    category: 'negative_constraint',
                    directive: `Avoid ${subject}.`,
                    rawPrompt: raw,
                    detectedAt: Date.now()
                };
            }
        }

        // 2. Positive style / format directive
        // e.g. "Always use bullet points", "Always respond in TypeScript", "From now on, give concise answers", "Prefer Python 3.12"
        const positiveMatch = raw.match(/\b(?:always|from\s+now\s+on\s*,?\s*always|prefer|make\s+sure\s+to|please\s+always)\s+(?:use|give|write|respond\s+in|format\s+in|answer\s+in)\s+([^.!?\n]{3,80})/i);
        if (positiveMatch) {
            const subject = positiveMatch[1].trim().replace(/\b(?:please|from\s+now\s+on)\b/gi, '').trim();
            if (subject) {
                return {
                    category: 'positive_preference',
                    directive: `Prefer ${subject}.`,
                    rawPrompt: raw,
                    detectedAt: Date.now()
                };
            }
        }

        // 3. User Identity / Title declaration
        // e.g. "Call me Dr. Kan", "My name is John", "Address me as Professor"
        const identityMatch = raw.match(/\b(?:call\s+me|address\s+me\s+as|my\s+name\s+is)\s+([^\r\n!?]+?)(?:[!?\n]|$)/i);
        if (identityMatch) {
            const nameOrTitle = identityMatch[1].trim().replace(/[.,;:!?]+$/, '').trim();
            if (nameOrTitle) {
                return {
                    category: 'user_identity',
                    directive: `Address the user as ${nameOrTitle}.`,
                    rawPrompt: raw,
                    detectedAt: Date.now()
                };
            }
        }

        // 4. Concise / Length adjustments
        if (/\b(?:be\s+(?:more\s+)?concise|keep\s+it\s+(?:very\s+)?brief|shorter\s+answers?|no\s+fluff|give\s+direct\s+answers?)\b/i.test(lower)) {
            return {
                category: 'conciseness',
                directive: 'Keep answers direct, concise, and free of conversational filler.',
                rawPrompt: raw,
                detectedAt: Date.now()
            };
        }

        return null;
    }

    async processUserMessage(userMessage = '', previousAssistantMessage = '') {
        const detected = this.detectCorrectionOrPreference(userMessage, previousAssistantMessage);
        if (!detected) return null;

        // Check if an identical or similar directive already exists
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

    getDirectives() {
        return this.preferences.map(p => p.directive).filter(Boolean);
    }

    getAll() {
        return [...this.preferences];
    }

    async remove(id) {
        this.preferences = this.preferences.filter(p => p.id !== id);
        await this.savePreferences();
    }

    async clear() {
        this.preferences = [];
        await this.savePreferences();
    }

    injectIntoSystemPrompt(baseSystemPrompt = '') {
        const directives = this.getDirectives();
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
