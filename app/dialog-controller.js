export function installDialogController() {
    let current = null;
    let previousFocus = null;
    let lastExternalFocus = document.activeElement;
    document.addEventListener('focusin', event => {
        if (event.target instanceof Element && !event.target.closest('[role="dialog"], [role="alertdialog"]')) lastExternalFocus = event.target;
    });
    let inerted = [];
    let scheduled = false;
    let stack = [];
    const dialogFocus = new WeakMap();
    document.addEventListener('focusin', event => { if (current?.contains(event.target)) dialogFocus.set(current, event.target); });
    const visible = el => {
        const style = getComputedStyle(el);
        // These overlays fade with opacity. Their explicit state must govern focus and
        // background inactivity before the first frame and during the closing animation.
        if (el.matches('.image-lightbox-overlay, .image-gallery-modal')) {
            return el.classList.contains('is-open') && style.display !== 'none' && el.getBoundingClientRect().width > 0;
        }
        return el.getBoundingClientRect().width > 0 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity) !== 0;
    };
    const focusables = dialog => [...dialog.querySelectorAll('button, a[href], input, textarea, select, [tabindex]')]
        .filter(el => !el.disabled && el.tabIndex >= 0 && visible(el));
    const restoreBackground = () => { for (const el of inerted) el.inert = false; inerted = []; };
    const sync = () => {
        scheduled = false;
        const all = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')];
        const dialogs = all.filter(visible);
        stack = stack.filter(dialog => dialogs.includes(dialog));
        for (const dialog of dialogs) if (!stack.includes(dialog)) stack.push(dialog);
        const next = stack.at(-1) || null;
        const changed = next !== current;
        restoreBackground();
        for (const dialog of all) { dialog.setAttribute('aria-hidden', String(dialog !== next)); dialog.inert = dialog !== next; }
        for (const [index, dialog] of stack.entries()) {
            let root = dialog; while (root.parentElement && root.parentElement !== document.body) root = root.parentElement;
            const order = String(10000 + index * 10);
            if (root.style.zIndex !== order) root.style.zIndex = order;
        }
        if (!next) {
            current = null;
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
            previousFocus = null;
            return;
        }
        if (!current) previousFocus = lastExternalFocus;
        current = next;
        for (let node = next; node?.parentElement && node.parentElement !== document.documentElement; node = node.parentElement) {
            for (const sibling of node.parentElement.children) {
                if (sibling !== node && !sibling.inert && !['SCRIPT', 'STYLE', 'LINK'].includes(sibling.tagName)) {
                    sibling.inert = true; inerted.push(sibling);
                }
            }
        }
        next.setAttribute('aria-modal', 'true');
        if (changed || !next.contains(document.activeElement)) {
            const remembered = dialogFocus.get(next);
            const target = remembered?.isConnected && next.contains(remembered) && visible(remembered) ? remembered : focusables(next)[0] || next;
            if (target === next) next.tabIndex = -1;
            target.focus({ preventScroll: true });
        }
    };
    const observer = new MutationObserver(() => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(sync); }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    document.addEventListener('keydown', event => {
        if (!current) return;
        if (event.key === 'Tab') {
            const targets = focusables(current);
            const first = targets[0] || current;
            const last = targets.at(-1) || current;
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        } else if (event.key === 'Escape') {
            const close = current.querySelector('[data-dialog-close], [aria-label="Close"], .help-modal-close');
            if (close) { event.preventDefault(); close.click(); }
            else {
                const closers = { 'chat-delete-dialog': 'closeChatDeleteDialog', 'confirm-action-dialog': 'closeConfirmActionDialog', 'image-gallery-modal': 'closeImageGalleryModal', 'image-lightbox-overlay': 'closeImageLightbox' };
                const method = closers[current.id];
                if (method && typeof window[method] === 'function') { event.preventDefault(); window[method](false); }
            }
        }
    }, true);
    sync();
}
