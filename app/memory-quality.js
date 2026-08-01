const FORGET_PATTERN = /\b(?:forget|delete|remove|clear)\s+(?:that|this|the)?\s*(?:memory|memories)\b(?:\s+(?:about|for)\s+(.+))?$/i;
const FORGET_KEY_PATTERN = /\bforget\s+(?:that\s+)?(?:my\s+)?(.+?)(?:\s+is\s+|\s+are\s+|$)/i;

export function isForgetMemoryRequest(text) {
    return FORGET_PATTERN.test(String(text || '').trim());
}

export function extractForgetMemoryKey(text) {
    const raw = String(text || '').trim();
    const match = raw.match(FORGET_KEY_PATTERN) || raw.match(FORGET_PATTERN);
    if (!match?.[1]) return '';
    return String(match[1]).replace(/[?.!,;]+$/g, '').trim().slice(0, 80);
}

export function forgetMemoryKey(memoryStore, key) {
    const normalized = String(key || '').trim().toLowerCase();
    if (!normalized || !memoryStore || typeof memoryStore !== 'object') return { removed: false, key: '' };
    const exact = Object.keys(memoryStore).find(item => item.toLowerCase() === normalized);
    if (exact) {
        delete memoryStore[exact];
        return { removed: true, key: exact };
    }
    const fuzzy = Object.keys(memoryStore).find(item => item.toLowerCase().includes(normalized) || normalized.includes(item.toLowerCase()));
    if (fuzzy) {
        delete memoryStore[fuzzy];
        return { removed: true, key: fuzzy }; 
    }
    return { removed: false, key: '' };
}

export function formatUsedMemoryNote(keys = []) {
    const list = (Array.isArray(keys) ? keys : []).map(String).filter(Boolean).slice(0, 3);
    if (!list.length) return '';
    return `\n\n<div class="memory-used-chip" role="note">Used memory: ${list.map(escapeHtml).join(', ')}</div>`;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
