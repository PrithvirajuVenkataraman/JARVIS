/**
 * Unified Personalization Memory Gate
 * Centralized gate for checking if the unified personalization & memory system is active.
 * Governed by FEATURE_UNIFIED_MEMORY feature flag and 'jarvis_personalized_experience' setting.
 */

export const FEATURE_UNIFIED_MEMORY = true;
export const PERSONALIZATION_STORAGE_KEY = 'jarvis_personalized_experience';

/**
 * Single source of truth for whether memory learning, extraction, and prompt injection are enabled.
 * When false, ZERO memories are extracted, ZERO memories are injected into prompts,
 * and explicit save requests are informed that personalization is paused.
 *
 * @param {Storage} [storage=globalThis.localStorage]
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
 *
 * @param {boolean} enabled
 * @param {Storage} [storage=globalThis.localStorage]
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
