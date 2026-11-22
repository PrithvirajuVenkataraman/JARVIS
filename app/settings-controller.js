import { scanDlp } from './dlp-engine.js';
import * as recall from './context-retrieval.js';
let editor = null, saved = '', confirming = false;
const valueOf = element => String(element?.value || '').trim().slice(0, 1200);
function status(message) {
    let target = document.getElementById('instruction-save-status');
    if (!target && editor) { target = document.createElement('p'); target.id = 'instruction-save-status'; target.className = 'settings-save-status'; target.setAttribute('role', 'status'); editor.after(target); }
    if (target) target.textContent = message;
}
export function allowNavigation(proceed) {
    if (!editor?.isConnected || valueOf(editor) === saved) return true;
    if (confirming) return false;
    confirming = true;
    void window.openConfirmActionDialog({ title: 'Discard changes?', message: 'Your custom instructions have not been saved.', confirmLabel: 'Discard changes', cancelLabel: 'Keep editing' }).then(discard => {
        confirming = false;
        if (discard) { editor.value = saved; window.updateCustomPromptCharCount?.(editor); proceed(); }
        else editor?.focus();
    });
    return false;
}
export function commit() {
    if (!editor) return;
    const value = valueOf(editor);
    if (scanDlp(value, { maskPii: false }).decision === 'BLOCK') { status('Remove credentials from these instructions before saving.'); return; }
    const persistent = window.setCustomSystemPrompt(value, false);
    saved = value;
    status(persistent === false ? 'Applied for this visit. Browser storage is unavailable.' : 'Saved. Applies to your next message.');
    if (persistent !== false) window.switchSettingsView('main');
}
export function mount(modal) {
    editor = modal.querySelector('#custom-system-prompt-input'); saved = valueOf(editor);
    editor?.addEventListener('input', () => status(valueOf(editor) === saved ? 'No unsaved changes.' : 'Unsaved changes. Select Done to apply.'));
    modal.querySelector('.settings-presets-container')?.addEventListener('click', () => status('Unsaved changes. Select Done to apply.'));
    const body = modal.querySelector('#settings-view-main .help-modal-body');
    const group = document.createElement('div'); group.className = 'settings-group-card';
    group.innerHTML = `<div class="settings-row"><div class="settings-row-text"><label for="local-recall-enabled" class="settings-row-title">Enhanced local recall</label><p class="settings-row-desc">Optional English recall on this device. Downloads 23 MB of model weights plus the WASM runtime. Chat works without it.</p><p id="local-recall-status" class="settings-row-desc" role="status"></p></div><label class="recall-toggle-hit"><input id="local-recall-enabled" type="checkbox" aria-label="Enable enhanced local recall"></label></div><div class="settings-row"><button type="button" id="recall-clear-cache" class="settings-action-btn">Clear recall cache</button><button type="button" id="settings-permissions" class="settings-action-btn">Manage permissions</button></div>`;
    body?.append(group);
    const checkbox = group.querySelector('#local-recall-enabled'); checkbox.checked = recall.isEnabled();
    const update = () => {
        const target = group.querySelector('#local-recall-status');
        target.textContent = ({ off: 'Off', loading: 'Downloading or loading the local model…', ready: 'Ready on this device', unavailable: 'Local model unavailable. Lightweight recall remains available.' })[recall.getStatus()] || 'Not loaded yet';
    };
    checkbox.onchange = () => { void recall.setEnabled(checkbox.checked); update(); };
    group.querySelector('#recall-clear-cache').onclick = async () => { await recall.clearDerived(); checkbox.checked = false; update(); };
    group.querySelector('#settings-permissions').onclick = () => { if (allowNavigation(() => { window.closeHelpModal(); void window.JarvisPermissions.show(); })) { window.closeHelpModal(); void window.JarvisPermissions.show(); } };
    const listener = () => { if (!group.isConnected) { window.removeEventListener('jarvis:recall-status', listener); return; } update(); };
    window.addEventListener('jarvis:recall-status', listener); update();
}
