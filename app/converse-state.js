export const CONVERSE_STATES = Object.freeze({
    listening: 'listening',
    submitting: 'submitting',
    responding: 'responding',
    speaking: 'speaking',
    interruptible: 'interruptible',
    recovering: 'recovering'
});

export function normalizeConverseState(state) {
    const value = String(state || '').trim().toLowerCase();
    return Object.values(CONVERSE_STATES).includes(value) ? value : CONVERSE_STATES.listening;
}

export function createConverseStateTracker(initialState = CONVERSE_STATES.listening) {
    const listeners = new Set();
    let snapshot = {
        state: normalizeConverseState(initialState),
        reason: 'initial',
        updatedAt: Date.now()
    };
    return {
        getSnapshot() {
            return { ...snapshot };
        },
        getState() {
            return snapshot.state;
        },
        subscribe(listener) {
            if (typeof listener === 'function') {
                listeners.add(listener);
                return () => listeners.delete(listener);
            }
            return () => {};
        },
        setState(state, reason = '') {
            const prevState = snapshot.state;
            snapshot = {
                state: normalizeConverseState(state),
                reason: String(reason || '').trim(),
                updatedAt: Date.now()
            };
            for (const listener of listeners) {
                try {
                    listener({ ...snapshot }, prevState);
                } catch (_) {}
            }
            return { ...snapshot };
        }
    };
}
