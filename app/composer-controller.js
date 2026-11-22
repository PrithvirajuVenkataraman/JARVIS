export function isCompositionEvent(event) { return Boolean(event?.isComposing || event?.keyCode === 229); }

export function installComposerAccessibility() {
    const status = document.createElement('div');
    status.id = 'request-status';
    status.className = 'sr-only';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    status.setAttribute('aria-atomic', 'true');
    document.body.append(status);
    const announce = text => { status.textContent = text; };
    const send = window.sendTextInput;
    const stop = window.stopActiveGeneration;
    let sequence = 0;
    let active = null;
    let sawAnswer = false;
    if (typeof send === 'function') window.sendTextInput = async (...args) => {
        const id = ++sequence;
        active = id; sawAnswer = false;
        window.JarvisPerformance.startTurn(id);
        announce('Sending message.');
        try { return await send(...args); }
        finally {
            if (active === id) {
                window.JarvisPerformance.markTurn(id, 'answer-complete');
                announce('Response finished.'); active = null;
                window.JarvisPersistence.flush();
            }
        }
    };
    if (typeof stop === 'function') window.stopActiveGeneration = (...args) => {
        if (active !== null) window.JarvisPerformance.markTurn(active, 'cancelled');
        active = null;
        announce('Response stopped.');
        return stop(...args);
    };
    new MutationObserver(records => {
        if (active === null || sawAnswer) return;
        if (records.some(record => record.target instanceof Element && record.target.closest('.assistant-message-text'))) {
            sawAnswer = true;
            window.JarvisPerformance.markTurn(active, 'first-visible-answer');
        }
    }).observe(document.getElementById('chat-messages') || document.body, { subtree: true, childList: true });
}
