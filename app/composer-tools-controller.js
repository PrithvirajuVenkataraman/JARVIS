let installed = false;

export function positionPopover(menu) {
    const anchor = document.getElementById('input-bar-inner');
    if (!menu || !anchor) return;
    const viewport = window.visualViewport;
    const left = viewport?.offsetLeft || 0, top = viewport?.offsetTop || 0;
    const width = viewport?.width || innerWidth, height = viewport?.height || innerHeight;
    const rect = anchor.getBoundingClientRect(), margin = 10;
    menu.style.width = `${Math.min(440, width - margin * 2)}px`;
    menu.style.maxHeight = `${Math.max(44, Math.min(height - margin * 2, rect.top - top - margin - 8))}px`;
    menu.style.left = `${Math.max(left + margin, Math.min(rect.left, left + width - menu.getBoundingClientRect().width - margin))}px`;
    menu.style.bottom = 'auto';
    menu.style.top = `${Math.max(top + margin, rect.top - menu.getBoundingClientRect().height - 8)}px`;
}

export function syncSearchState() {
    const shell = document.getElementById('input-bar-inner');
    const active = window.getWebSearchMode?.() === 'force';
    shell?.classList.toggle('has-web-search', active);
    const button = document.getElementById('composer-web-search-active');
    if (button) { button.hidden = !active; button.setAttribute('aria-pressed', String(active)); }
    const menuItem = document.getElementById('web-search-toggle-btn');
    menuItem?.setAttribute('aria-checked', String(active));
}

export function menuChanged(open) {
    const menu = document.getElementById('composer-actions-menu');
    if (open) { window.JarvisSlashCommands?.close(); positionPopover(menu); }
}

export function install() {
    if (installed) return; installed = true;
    const shell = document.getElementById('input-bar-inner');
    const outline = document.createElement('div'); outline.className = 'composer-web-outline'; outline.setAttribute('aria-hidden', 'true'); shell.append(outline);
    const button = document.createElement('button'); button.id = 'composer-web-search-active'; button.type = 'button'; button.hidden = true; button.className = 'composer-web-search-active'; button.setAttribute('aria-label', 'Turn off Web search');
    button.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg><span>Web search</span>';
    button.onclick = () => { window.setWebSearchMode('off'); document.getElementById('text-input').focus(); };
    shell.querySelector('.composer-leading').append(button);
    const menu = document.getElementById('composer-actions-menu'), plus = document.getElementById('composer-plus-btn');
    document.body.append(menu); // Fixed popovers must escape the composer's backdrop-filter containing block.
    const items = () => [...menu.querySelectorAll('[role^="menuitem"]')].filter(row => !row.hidden && row.getClientRects().length && !row.disabled);
    plus.addEventListener('keydown', event => {
        if (['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); window.toggleComposerActionsMenu(true); const rows = items(); (event.key === 'ArrowUp' ? rows.at(-1) : rows[0])?.focus(); }
    });
    plus.addEventListener('click', event => { if (event.detail === 0 && !menu.classList.contains('hidden')) items()[0]?.focus(); });
    menu.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); window.closeComposerActionsMenu(); plus.focus(); return; }
        if (event.key === 'Tab') { window.closeComposerActionsMenu(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); const rows = items(), index = rows.indexOf(document.activeElement);
        if (rows.length) rows[event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length].focus();
    });
    menu.addEventListener('click', event => {
        if (event.target.closest('[role^="menuitem"]')) { window.closeComposerActionsMenu(); if (menu.contains(document.activeElement)) document.getElementById('text-input').focus(); }
    });
    const position = () => { if (!menu.classList.contains('hidden')) positionPopover(menu); };
    window.addEventListener('resize', position); window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
    const visibility = () => shell.classList.toggle('web-animation-paused', document.hidden);
    document.addEventListener('visibilitychange', visibility); visibility(); syncSearchState();
}
