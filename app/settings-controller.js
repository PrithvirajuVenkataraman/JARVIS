import { scanDlp } from './dlp-engine.js';
import * as recall from './context-retrieval.js';
import * as localVision from './local-vision-engine.js';
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
    const group = document.createElement('div'); group.className = 'settings-group-card'; group.id = 'settings-local-recall-group';
    group.innerHTML = `<div class="settings-row"><div class="settings-row-left"><span class="settings-icon-badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z"/><path d="M5 16h14M9 8h6M9 11h4"/></svg></span><div class="settings-row-text"><label for="local-recall-enabled" class="settings-row-title">On-Device Semantic Memory</label><p class="settings-row-desc">Privately index earlier messages and attachments on this device.</p><p class="settings-row-desc settings-row-meta">Optional · ~23 MB one-time download (English)</p><p id="local-recall-status" class="settings-row-desc settings-row-meta" role="status"></p></div></div><div class="settings-row-right"><label class="settings-switch"><input id="local-recall-enabled" class="settings-switch-input" type="checkbox" role="switch" aria-label="Enable on-device semantic memory"><span class="settings-switch-slider" aria-hidden="true"></span></label></div></div><div class="settings-row recall-cache-actions"><button type="button" id="recall-clear-cache" class="settings-action-btn">Clear memory index</button></div>`;
    modal.querySelector('#settings-personalization-toggle')?.closest('.settings-group-card')?.after(group);
    const permissions = document.createElement('div'); permissions.className = 'settings-row settings-permissions-row';
    permissions.innerHTML = '<div class="settings-row-left"><span class="settings-icon-badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z"/><path d="m8 12 3 3 5-6"/></svg></span><div class="settings-row-text"><span class="settings-row-title">Device permissions</span><p class="settings-row-desc">Manage microphone, camera, and location access.</p></div></div><button type="button" id="settings-permissions" class="settings-action-btn">Manage permissions</button>';
    modal.querySelector('#settings-row-compliance')?.closest('.settings-group-card')?.append(permissions);
    const checkbox = group.querySelector('#local-recall-enabled'); checkbox.checked = recall.isEnabled();
    const update = () => {
        const target = group.querySelector('#local-recall-status');
        target.textContent = ({ off: 'Disabled', loading: 'Preparing on-device model…', ready: 'Active on this device', unavailable: 'Model unavailable; standard recall active.' })[recall.getStatus()] || 'Disabled';
    };
    checkbox.setAttribute('aria-checked', String(checkbox.checked));
    checkbox.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); checkbox.click(); } };
    checkbox.onchange = () => { checkbox.setAttribute('aria-checked', String(checkbox.checked)); void recall.setEnabled(checkbox.checked); update(); };
    group.querySelector('#recall-clear-cache').onclick = async () => { await recall.clearDerived(); checkbox.checked = false; checkbox.setAttribute('aria-checked', 'false'); update(); };
    permissions.querySelector('#settings-permissions').onclick = () => { if (allowNavigation(() => { window.closeHelpModal(); void window.JarvisPermissions.show(); })) { window.closeHelpModal(); void window.JarvisPermissions.show(); } };
    const listener = () => { if (!group.isConnected) { window.removeEventListener('jarvis:recall-status', listener); return; } update(); };
    window.addEventListener('jarvis:recall-status', listener); update();

    const visionGroup = document.createElement('div');
    visionGroup.className = 'settings-group-card';
    visionGroup.id = 'settings-local-vision-group';
    visionGroup.innerHTML = `<div class="settings-row"><div class="settings-row-left"><span class="settings-icon-badge" aria-hidden="true"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg></span><div class="settings-row-text"><label for="local-vision-enabled" class="settings-row-title">On-Device Vision Fallback (ONNX)</label><p class="settings-row-desc">Run local image captioning, object classes, and OCR in-browser when cloud vision quotas run out.</p><p class="settings-row-desc settings-row-meta">Loads on demand via Transformers.js WASM (cached locally)</p><p id="local-vision-status" class="settings-row-desc settings-row-meta" role="status"></p></div></div><div class="settings-row-right"><label class="settings-switch"><input id="local-vision-enabled" class="settings-switch-input" type="checkbox" role="switch" aria-label="Enable on-device ONNX vision fallback"><span class="settings-switch-slider" aria-hidden="true"></span></label></div></div><div class="settings-row recall-cache-actions"><button type="button" id="vision-clear-cache" class="settings-action-btn">Clear vision model cache</button></div>`;
    group.after(visionGroup);
    const visionCheckbox = visionGroup.querySelector('#local-vision-enabled');
    visionCheckbox.checked = localVision.isLocalVisionFallbackEnabled();
    const updateVision = () => {
        const target = visionGroup.querySelector('#local-vision-status');
        target.textContent = ({ off: 'Disabled', idle: 'Ready on quota fallback', loading: 'Downloading on-device ONNX vision models…', ready: 'Active on this device', unavailable: 'ONNX vision unavailable; Tesseract OCR remains active.' })[localVision.getLocalVisionStatus()] || 'Ready on quota fallback';
    };
    visionCheckbox.setAttribute('aria-checked', String(visionCheckbox.checked));
    visionCheckbox.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); visionCheckbox.click(); } };
    visionCheckbox.onchange = () => {
        visionCheckbox.setAttribute('aria-checked', String(visionCheckbox.checked));
        void localVision.setLocalVisionFallbackEnabled(visionCheckbox.checked).then(updateVision);
    };
    visionGroup.querySelector('#vision-clear-cache').onclick = async () => {
        await localVision.clearLocalVisionCache();
        updateVision();
    };
    const visionListener = () => {
        if (!visionGroup.isConnected) { window.removeEventListener('jarvis:vision-fallback-status', visionListener); return; }
        updateVision();
    };
    window.addEventListener('jarvis:vision-fallback-status', visionListener);
    updateVision();
}
