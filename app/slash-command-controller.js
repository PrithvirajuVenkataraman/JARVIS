import { positionPopover } from './composer-tools-controller.js';

export const commands = Object.freeze([
    { id: 'image', label: 'Image', hint: 'Describe an image', template: '' },
    { id: 'translate', label: 'Translate', hint: 'Translate text to another language', template: 'Translate this text to [language]: ' },
    { id: 'verify', label: 'Verify', hint: 'Check a claim or answer', template: 'verify this: ' },
    { id: 'summarize', label: 'Summarize', hint: 'Summarize text or a document', template: 'summarize this: ' },
    { id: 'professional', label: 'Professional', hint: 'Polish your wording', template: 'make this professional: ' },
    { id: 'study', label: 'Study', hint: 'Learn or review a topic', template: 'teach me this topic: ' }
]);

export function filterCommands(query, imageAvailable = false) {
    const term = String(query || '').toLowerCase();
    const rank = command => {
        const names = [command.id, command.label.toLowerCase()];
        return names.includes(term) ? 0 : names.some(name => name.startsWith(term)) ? 1 : 2;
    };
    return commands.filter(command => (command.id !== 'image' || imageAvailable) && [command.id, command.label.toLowerCase()].some(name => name.includes(term)))
        .sort((a, b) => rank(a) - rank(b));
}

let input, entry, picker, list, results = [], activeId = '', installed = false, composing = false;
export function close() {
    picker?.remove(); picker = null; list = null; results = []; activeId = '';
    entry?.setAttribute('aria-expanded', 'false'); entry?.removeAttribute('aria-controls'); input?.removeAttribute('aria-controls'); input?.removeAttribute('aria-activedescendant');
}
function select(id = activeId) {
    const command = results.find(row => row.id === id);
    if (!command) return;
    close();
    input.value = command.template; input.dataset.inputSource = 'slash';
    if (command.id === 'image') window.activateComposerImageMode?.({ aspectRatio: '1:1' });
    input.focus();
    const placeholder = input.value.indexOf('[language]');
    input.setSelectionRange(placeholder < 0 ? input.value.length : placeholder, placeholder < 0 ? input.value.length : placeholder + 10);
    window.handleComposerInput?.();
}
function highlight() {
    for (const row of list.children) {
        const selected = row.dataset.command === activeId;
        row.classList.toggle('is-active', selected); row.setAttribute('aria-selected', String(selected));
        if (selected) { input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' }); }
    }
    if (!activeId) input.removeAttribute('aria-activedescendant');
}
export function sync() {
    if (!input || composing) return;
    const match = input.value.match(/^\/([a-z]*)$/i);
    if (!match) { close(); return; }
    results = filterCommands(match[1], window.JarvisCapabilities?.isAvailable('images'));
    if (!results.some(row => row.id === activeId)) activeId = results[0]?.id || '';
    if (!picker) {
        window.closeComposerActionsMenu?.();
        picker = document.createElement('div'); picker.id = 'slash-command-picker'; picker.className = 'slash-command-picker';
        const title = document.createElement('div'); title.className = 'slash-command-title'; title.textContent = 'Commands';
        list = document.createElement('div'); list.id = 'slash-command-results'; list.className = 'slash-command-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Slash commands');
        picker.append(title, list); document.body.append(picker);
        picker.addEventListener('pointerdown', event => event.preventDefault());
        picker.addEventListener('click', event => { const row = event.target.closest('[data-command]'); if (row) select(row.dataset.command); });
    }
    list.replaceChildren();
    for (const command of results) {
        const row = document.createElement('div'); row.id = `slash-option-${command.id}`; row.className = 'slash-command-item'; row.dataset.command = command.id; row.setAttribute('role', 'option');
        const label = document.createElement('span'); label.textContent = command.label;
        const hint = document.createElement('small'); hint.textContent = command.hint; row.append(label, hint); list.append(row);
    }
    picker.querySelector('.slash-command-empty')?.remove();
    if (!results.length) { const empty = document.createElement('p'); empty.className = 'slash-command-empty'; empty.setAttribute('role', 'status'); empty.textContent = 'No matching commands'; picker.append(empty); }
    entry.setAttribute('aria-expanded', 'true'); entry.setAttribute('aria-controls', list.id); input.setAttribute('aria-controls', list.id);
    positionPopover(picker); highlight();
}
export function install() {
    if (installed) return; installed = true;
    input = document.getElementById('text-input'); if (!input) return;
    entry = document.getElementById('composer-entry');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-haspopup', 'listbox');
    input.addEventListener('paste', event => void window.handleComposerPaste?.(event));
    input.addEventListener('compositionstart', () => { composing = true; close(); });
    input.addEventListener('compositionend', () => { composing = false; sync(); });
    input.addEventListener('input', event => { if (!event.isComposing) sync(); });
    input.addEventListener('keydown', event => {
        if (!picker || composing || event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter' && event.shiftKey) { close(); return; }
        if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) { if (event.key === 'Tab') close(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        if (event.key === 'Escape') close();
        else if (event.key === 'Enter') select();
        else if (results.length) { const index = results.findIndex(row => row.id === activeId); activeId = results[(index + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length].id; highlight(); }
    }, true);
    document.addEventListener('pointerdown', event => { if (picker && !picker.contains(event.target) && event.target !== input) close(); });
    document.addEventListener('focusin', event => { if (picker && event.target !== input && !picker.contains(event.target)) close(); });
    window.addEventListener('jarvis:capabilities', () => { if (picker) sync(); });
    const position = () => { if (picker) positionPopover(picker); };
    window.addEventListener('resize', position); window.visualViewport?.addEventListener('resize', position); window.visualViewport?.addEventListener('scroll', position);
}
