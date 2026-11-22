import { hasCredentials } from './text-safety.js';
const pasted = new Map();
export function shouldAttachPaste(text) { return text.length >= 8000 || text.split(/\r\n|\r|\n/).length >= 80; }

function recover(text) {
    const input = document.getElementById('text-input');
    input.setRangeText(text, input.selectionStart, input.selectionEnd, 'end');
    window.handleComposerInput?.(); input.focus();
}

export async function handlePaste(event) {
    const data = event.clipboardData;
    if (!data) return;
    const files = Array.from(data.files || []);
    if (!files.length) for (const item of Array.from(data.items || [])) if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
    if (files.length) { event.preventDefault(); await window.handleComposerAttachmentSelection(files); return; }
    const text = data.getData('text/plain') || data.getData('text');
    // Native insertion preserves short formulas and the user's selection exactly.
    if (!shouldAttachPaste(text)) return;
    event.preventDefault();
    let blocked;
    try { blocked = !(await window.JarvisRecall.callWorker('check', { text }, 30000)); }
    catch { blocked = hasCredentials(text); }
    if (blocked) {
        window.showTemporaryMessage?.('This paste contains credentials. Remove them before attaching or sending it.');
        return; // Never cache a credential-bearing clipboard value.
    }
    const file = new File([text], `pasted-text-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`, { type: 'text/plain;charset=utf-8' });
    try {
        const result = await window.JarvisAttachments.addFilesToComposer([file]);
        if (!result?.added?.length) throw new Error(result?.errors?.[0] || 'The paste could not be attached.');
        const attachment = result.added[0]; attachment.pastedText = true;
        pasted.set(attachment.id, text);
        window.refreshComposerAttachmentTray?.(); window.toggleSendButton?.();
        window.showTemporaryMessage?.('Pasted text attached. You can preview it or insert it inline.');
    } catch (error) {
        // The original remains in the clipboard; restore it inline when conversion fails.
        recover(text); window.showTemporaryMessage?.(error.message);
    }
}

export function install() {
    document.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-paste-inline], [data-paste-preview]');
        if (!button) return;
        const id = button.dataset.pasteInline || button.dataset.pastePreview;
        const text = pasted.get(id);
        if (text === undefined) return;
        if (button.hasAttribute('data-paste-inline')) {
            recover(text); await window.JarvisAttachments.removePendingAttachment(id); pasted.delete(id); window.refreshComposerAttachmentTray?.();
        } else {
            const modal = document.createElement('div'); modal.className = 'text-preview-backdrop'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Pasted text preview');
            const panel = document.createElement('section'); panel.className = 'text-preview-panel';
            const close = document.createElement('button'); close.textContent = 'Done'; close.dataset.dialogClose = ''; close.onclick = () => modal.remove();
            const content = document.createElement('pre'); content.textContent = text;
            panel.append(close, content); modal.append(panel); modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); }); document.body.append(modal); close.focus();
        }
    });
    window.addEventListener('pagehide', () => pasted.clear());
}
export function prune() {
    const ids = new Set((window.JarvisAttachments?.getPendingAttachments?.() || []).map(item => item.id));
    for (const id of pasted.keys()) if (!ids.has(id)) pasted.delete(id);
}
