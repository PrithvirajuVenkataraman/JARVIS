/** @typedef {'chat'|'search'|'vision'|'images'|'byok'} CapabilityName */
/** @typedef {{available:boolean, reasonCode:string}} Capability */
/** @typedef {Record<CapabilityName, Capability>} Capabilities */
/** @typedef {'send'|'first-visible-answer'|'answer-complete'|'cancelled'} RequestStage */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
export function isJsonObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is Capabilities} */
export function isCapabilities(value) {
    return isJsonObject(value) && ['chat', 'search', 'vision', 'images', 'byok'].every(name => {
        const item = value[name];
        return isJsonObject(item) && typeof item.available === 'boolean' && typeof item.reasonCode === 'string';
    });
}
