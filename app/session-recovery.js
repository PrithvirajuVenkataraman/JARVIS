const DRAFT_KEY = 'jarvis_composer_draft_v1';
const SESSION_KEY = 'jarvis_active_session_v1';

export function saveComposerDraft(text) {
    const value = String(text || '');
    try {
        if (!value.trim()) {
            localStorage.removeItem(DRAFT_KEY);
            return;
        }
        localStorage.setItem(DRAFT_KEY, JSON.stringify({
            text: value.slice(0, 4000),
            updatedAt: Date.now()
        }));
    } catch (_) {}
}

export function restoreComposerDraft() {
    try {
        const raw = localStorage.getItem(DRAFT_KEY);
        if (!raw) return '';
        const parsed = JSON.parse(raw);
        return String(parsed?.text || '');
    } catch (_) {
        return '';
    }
}

export function clearComposerDraft() {
    try {
        localStorage.removeItem(DRAFT_KEY);
    } catch (_) {}
}

export function saveActiveSessionSnapshot(snapshot = {}) {
    try {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            chatId: String(snapshot.chatId || ''),
            turnId: String(snapshot.turnId || ''),
            updatedAt: Date.now()
        }));
    } catch (_) {}
}

export function restoreActiveSessionSnapshot() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch (_) {
        return null;
    }
}
