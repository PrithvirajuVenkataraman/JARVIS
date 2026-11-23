import { isSafeImagePreview } from './markup-security.js';

let installed = false;
export function install() {
    if (installed) return;
    installed = true;
    const menu = document.createElement('div');
    menu.id = 'generated-image-menu'; menu.className = 'image-actions-menu'; menu.hidden = true;
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Image actions');
    let currentImage = null, press = null, timer, suppressedClick = null;
    const imageAt = target => target instanceof Element ? target.closest('.free-image-card img.image-gen-img, #image-lightbox-img[data-generated-card-id]') : null;
    const cardFor = image => image?.closest('.free-image-card') || document.getElementById(image?.dataset.generatedCardId || '');
    const clearPress = () => { clearTimeout(timer); press = null; };
    const close = (restore = false) => {
        const image = currentImage;
        menu.hidden = true; currentImage = null;
        image?.setAttribute('aria-expanded', 'false');
        if (restore && image?.isConnected) image.focus({ preventScroll: true });
    };
    const usable = image => image?.isConnected && image.complete && image.naturalWidth > 0 && isSafeImagePreview(cardFor(image)?.dataset.imageUrl);
    const open = (image, x, y) => {
        if (!usable(image)) return;
        close(); currentImage = image;
        (image.closest('[role="dialog"]') || document.body).append(menu);
        menu.inert = false; menu.hidden = false;
        image.setAttribute('aria-expanded', 'true');
        const viewport = window.visualViewport;
        const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
        const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
        const bounds = menu.getBoundingClientRect();
        menu.style.left = `${Math.max(left + 8, Math.min(x, left + width - bounds.width - 8))}px`;
        menu.style.top = `${Math.max(top + 8, Math.min(y, top + height - bounds.height - 8))}px`;
        menu.querySelector('button').focus({ preventScroll: true });
    };
    for (const [label, action] of [['Copy', 'copyImageCard'], ['Download', 'downloadImageCard']]) {
        const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('role', 'menuitem'); button.textContent = label;
        button.addEventListener('click', () => {
            const image = currentImage, card = cardFor(image);
            close(true);
            if (usable(image) && card?.id) Promise.resolve(window[action]?.(card.id)).catch(() => window.showTemporaryMessage?.('This image action could not finish. Please try again.'));
        });
        menu.append(button);
    }
    document.body.append(menu);
    document.addEventListener('contextmenu', event => {
        const image = imageAt(event.target);
        if (!usable(image)) return;
        event.preventDefault(); clearPress();
        if (currentImage !== image || menu.hidden) open(image, event.clientX, event.clientY);
    });
    document.addEventListener('pointerdown', event => {
        clearPress(); suppressedClick = null;
        if (!menu.contains(event.target)) close();
        const image = imageAt(event.target);
        if (!event.isPrimary || event.pointerType === 'mouse' || event.button !== 0 || !usable(image)) return;
        press = { image, id: event.pointerId, x: event.clientX, y: event.clientY };
        timer = setTimeout(() => {
            if (!press) return;
            const { image, x, y } = press; suppressedClick = image;
            open(image, x, y); clearPress();
        }, 500);
    }, { passive: true });
    document.addEventListener('pointermove', event => {
        if (press && event.pointerId === press.id && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) clearPress();
    }, { passive: true });
    document.addEventListener('pointerup', clearPress, { passive: true });
    document.addEventListener('pointercancel', clearPress, { passive: true });
    document.addEventListener('click', event => {
        if (imageAt(event.target) === suppressedClick && suppressedClick) {
            event.preventDefault(); event.stopImmediatePropagation(); suppressedClick = null;
        } else if (!menu.contains(event.target)) close();
    }, true);
    window.addEventListener('keydown', event => {
        const image = imageAt(event.target);
        if (image && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) {
            event.preventDefault(); const rect = image.getBoundingClientRect(); open(image, rect.left + 8, rect.top + 8); return;
        }
        if (menu.hidden || !menu.contains(event.target)) return;
        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault(); event.stopPropagation(); close(true); return;
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
            event.preventDefault(); event.stopPropagation();
            const buttons = [...menu.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
            buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
        }
    }, true);
    document.addEventListener('focusin', event => { if (!menu.hidden && !menu.contains(event.target) && event.target !== currentImage) close(); });
    const dismiss = () => { clearPress(); close(); };
    document.addEventListener('scroll', dismiss, { capture: true, passive: true });
    window.addEventListener('resize', dismiss); window.addEventListener('pagehide', dismiss);
    window.visualViewport?.addEventListener('resize', dismiss); window.visualViewport?.addEventListener('scroll', dismiss);
    document.addEventListener('visibilitychange', () => { if (document.hidden) dismiss(); });
}
