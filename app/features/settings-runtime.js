function showHelpModal() {
            window.__helpModalReturnFocus = document.activeElement;
            window.__currentSettingsView = 'main';
            currentSettingsView = 'main';
            const modal = document.createElement('div');
            modal.id = 'help-modal';
            modal.className = 'fixed inset-0 bg-black/75 backdrop-blur-md z-[100] flex items-center justify-center p-3 sm:p-4 md:p-6';
            modal.style.zIndex = '100';
            modal.tabIndex = -1;
            modal.setAttribute('role', 'dialog');
            modal.setAttribute('aria-modal', 'true');
            modal.setAttribute('aria-labelledby', 'help-modal-title');

            const modalOpenedAt = Date.now();
            let isBackdropPointerDown = false;
            modal.addEventListener('pointerdown', (e) => {
                isBackdropPointerDown = (e.target === modal);
            });
            modal.addEventListener('click', (e) => {
                if (e.target === modal && isBackdropPointerDown && (Date.now() - modalOpenedAt > 250)) {
                    if (window.__currentSettingsView === 'custom_instructions') {
                        const input = document.getElementById('custom-system-prompt-input');
                        if (input) setCustomSystemPrompt(input.value, false);
                    } else if (window.__currentSettingsView === 'byok') {
                        if (typeof saveByokKeys === 'function') saveByokKeys(false);
                    }
                    closeHelpModal();
                }
                isBackdropPointerDown = false;
            });

            const currentSelectedModel = (typeof getSelectedModel === 'function' ? getSelectedModel() : 'auto') || 'auto';
            const currentPrompt = (typeof customSystemPrompt === 'string' ? customSystemPrompt : (window.customSystemPrompt || ''));
            const charCount = currentPrompt.length;
            const isPersonalized = typeof isPersonalizationEnabled === 'function' ? isPersonalizationEnabled() : true;
            const hasCustom = Boolean(currentPrompt && currentPrompt.trim().length > 0);
            const hasByok = Boolean(
                (localStorage.getItem('jarvis_byok_groq_sealed') || localStorage.getItem('jarvis_byok_groq') || localStorage.getItem('groq_api_key')) ||
                (localStorage.getItem('jarvis_byok_gemini_sealed') || localStorage.getItem('jarvis_byok_gemini') || localStorage.getItem('gemini_api_key'))
            );

            modal.innerHTML = `
                <div class="help-modal-enhanced">
                    <!-- Main Settings View -->
                    <div id="settings-view-main" class="settings-view-panel active">
                        <!-- Modal Header -->
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { closeHelpModal() })} class="help-modal-back-btn" aria-label="Close settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 id="help-modal-title" class="settings-modal-heading">Settings</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { closeHelpModal() })} class="help-modal-ok-btn" aria-label="Close settings" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>

                        <!-- Scrollable Modal Body -->
                        <div class="help-modal-body custom-scrollbar">
                            <!-- Section 0: AI MODEL & ROUTING -->
                            <div class="settings-section-label">AI MODEL &amp; ROUTING</div>
                            <div class="settings-group-card">
                                <!-- Model Selector Row -->
                                <div class="settings-row">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <label id="settings-model-label" for="model-selector" class="settings-row-title cursor-pointer">Default AI Model</label>
                                            <p class="settings-row-desc">Automatically selects the best Gemini or Groq model for each task</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <select id="model-selector" class="settings-select" ${window.JarvisTrustedUI.bindUiEvent("change", function(event) { setSelectedModel(this.value) })} aria-labelledby="settings-model-label">
                                            <option value="auto" ${currentSelectedModel === 'auto' ? 'selected' : ''}>Automatic</option>
                                            <option value="openai/gpt-oss-120b" ${currentSelectedModel === 'openai/gpt-oss-120b' ? 'selected' : ''}>GPT OSS 120B (Reasoning &amp; Multilingual)</option>
                                            <option value="openai/gpt-oss-20b" ${currentSelectedModel === 'openai/gpt-oss-20b' ? 'selected' : ''}>GPT OSS 20B (Fast &amp; Direct)</option>
                                            <option value="qwen/qwen3.8-27b" ${currentSelectedModel === 'qwen/qwen3.8-27b' ? 'selected' : ''}>Qwen 3.8 27B (Vision &amp; Reasoning)</option>
                                            <option value="openai/safety-gpt-oss-20b" ${currentSelectedModel === 'openai/safety-gpt-oss-20b' ? 'selected' : ''}>Safety GPT OSS 20B (Content Moderation)</option>
                                            <option value="gemini-4-hydrogen" ${currentSelectedModel === 'gemini-4-hydrogen' ? 'selected' : ''}>Gemini 4 Hydrogen (Primary Flagship, Thinking &amp; Vision)</option>
                                            <option value="gemini-3.8-flash" ${currentSelectedModel === 'gemini-3.8-flash' ? 'selected' : ''}>Gemini 3.8 Flash (Fast Reasoning &amp; Vision)</option>
                                            <option value="gemini-3.7-flash" ${currentSelectedModel === 'gemini-3.7-flash' ? 'selected' : ''}>Gemini 3.7 Flash (Legacy Fallback &amp; Vision)</option>
                                            <option value="gemini-2.5-pro" ${currentSelectedModel === 'gemini-2.5-pro' ? 'selected' : ''}>Gemini 2.5 Pro (Legacy Deep Reasoning)</option>
                                            <option value="gemini-2.5-flash" ${currentSelectedModel === 'gemini-2.5-flash' ? 'selected' : ''}>Gemini 2.5 Flash (Legacy Multimodal Fallback)</option>
                                        </select>
                                    </div>
                                </div>

                                <!-- Bring Your Own Key (BYOK) Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-byok" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('byok') })} aria-label="API Keys (BYOK)">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-amber" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <circle cx="7.5" cy="15.5" r="4.5"/>
                                                <path d="m21 3-9.5 9.5"/>
                                                <path d="m15.5 7.5 3 3"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">API Keys (BYOK)</h3>
                                            <p class="settings-row-desc">Bring your own Groq &amp; Gemini keys for high rate limits</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <span id="byok-status-badge" class="settings-row-status ${hasByok ? 'configured' : ''}">${hasByok ? 'Custom Active' : 'Platform'}</span>
                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>
                            </div>

                            <!-- Section 1: PERSONALIZATION & BEHAVIOR -->
                            <div class="settings-section-label">PERSONALIZATION &amp; BEHAVIOR</div>
                            <div class="settings-group-card">
                                <!-- Custom Instructions Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-custom-instructions" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('custom_instructions') })} aria-label="Custom Instructions">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Custom Instructions</h3>
                                            <p class="settings-row-desc">Shape how JARVIS responds, sets tone, or formats answers.</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <span id="custom-instructions-status" class="settings-row-status ${hasCustom ? 'configured' : ''}">${hasCustom ? 'Configured' : 'Default'}</span>
                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>

                                <!-- Personalized Experience Row -->
                                <div class="settings-row settings-row-clickable" id="settings-row-personalization" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { if(!event.target.closest('.settings-switch') && !event.target.closest('label')){ document.getElementById('settings-personalization-toggle')?.click(); } })}>
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-purple" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 2a4 4 0 0 1 4 4c0 1.95-1.4 3.58-3.25 3.93L12 18l-3-3"/>
                                                <path d="M9.5 2a4 4 0 0 0-4 4c0 1.95 1.4 3.58 3.25 3.93"/>
                                                <path d="M17 14a5 5 0 0 1 3.5 8.5H3.5A5 5 0 0 1 7 14"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <label id="settings-personalization-label" for="settings-personalization-toggle" class="settings-row-title cursor-pointer">Personalized Experience</label>
                                            <p class="settings-row-desc">Use and learn from previous conversations</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <label class="settings-switch">
                                            <input
                                                type="checkbox"
                                                id="settings-personalization-toggle"
                                                class="settings-switch-input"
                                                role="switch"
                                                aria-labelledby="settings-personalization-label"
                                                aria-checked="${isPersonalized ? 'true' : 'false'}"
                                                ${isPersonalized ? 'checked' : ''}
                                                ${window.JarvisTrustedUI.bindUiEvent("keydown", function(event) { if(event.key==='Enter'){event.preventDefault();this.click();} })}
                                                ${window.JarvisTrustedUI.bindUiEvent("change", function(event) { handlePersonalizationToggleChange(this) })}>
                                            <span class="settings-switch-slider" aria-hidden="true"></span>
                                        </label>
                                    </div>
                                </div>

                                <!-- Saved Memories Row -->
                                <div class="settings-row">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-purple" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <circle cx="12" cy="12" r="3"/>
                                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Saved Memories</h3>
                                            <p class="settings-row-desc">View, search, and manage learned facts and rules</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <button type="button" class="settings-action-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { closeHelpModal(); showMemoryManager(); })}>
                                            <span>Manage &rarr;</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Section 2: TOOLS & ARCHIVES -->
                            <div class="settings-section-label">TOOLS &amp; ARCHIVES</div>
                            <div class="settings-group-card">
                                <!-- Export Conversation Row -->
                                <div class="settings-row">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-emerald" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                                                <polyline points="7 10 12 15 17 10"/>
                                                <line x1="12" y1="15" x2="12" y2="3"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Export Conversation</h3>
                                            <p class="settings-row-desc">Save active conversation as Markdown</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right settings-export-buttons">
                                        <button type="button" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { exportCurrentChat('markdown') })}>
                                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                                                <polyline points="14 2 14 8 20 8"/>
                                            </svg>
                                            <span>Markdown</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Section 3: SAFETY & DATA -->
                            <div class="settings-section-label">SAFETY &amp; DATA</div>
                            <div class="settings-group-card">
                                <!-- Compliance & Observability Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-compliance" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('compliance') })} aria-label="Compliance & Observability">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Sensitive information &amp; activity</h3>
                                            <p class="settings-row-desc">Protect sensitive information and review local activity.</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <span id="compliance-policy-status-pill" class="settings-row-status configured">DLP Active</span>
                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>

                                <!-- Workspace Backup & Storage Health Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-workspace-durability" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('workspace_durability') })} aria-label="Workspace Backup & Storage Health">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-emerald" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <ellipse cx="12" cy="5" rx="9" ry="3"/>
                                                <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
                                                <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Backup &amp; storage</h3>
                                            <p class="settings-row-desc">Back up or restore your chats.</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <span id="workspace-durability-status-pill" class="settings-row-status configured">IndexedDB</span>
                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>

                                <!-- Local Storage & Privacy Row -->
                                <div class="settings-row">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Privacy &amp; data</h3>
                                            <p class="settings-row-desc">Stored locally on this device</p>
                                            <div id="privacy-data-summary" class="settings-privacy-summary">
                                                ${typeof buildPrivacyDataSummaryHtml === 'function' ? buildPrivacyDataSummaryHtml() : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <button type="button" class="settings-danger-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { promptClearAllDataConfirmation() })}>
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                                <polyline points="3 6 5 6 21 6"/>
                                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                            </svg>
                                            <span>Clear All Data</span>
                                        </button>
                                    </div>
                                </div>
                            </div>

                            <!-- Section 4: ABOUT & SYSTEM ARCHITECTURE -->
                            <div class="settings-section-label">ABOUT</div>
                            <div class="settings-group-card">
                                <!-- Important Info & Tradeoffs Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-architecture-info" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('architecture_info') })} aria-label="Important Info &amp; Architecture">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <circle cx="12" cy="12" r="10"/>
                                                <line x1="12" y1="16" x2="12" y2="12"/>
                                                <line x1="12" y1="8" x2="12.01" y2="8"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">About JARVIS</h3>
                                            <p class="settings-row-desc">Version and service information.</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">

                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>

                                <!-- FAQ & Help Row -->
                                <button type="button" class="settings-row settings-row-interactive" id="settings-row-faq" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('faq') })} aria-label="FAQ and Help">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                                <circle cx="12" cy="12" r="10"/>
                                                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/>
                                                <line x1="12" y1="17" x2="12.01" y2="17"/>
                                            </svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">FAQ</h3>
                                            <p class="settings-row-desc">Answers on web search, models, offline vision &amp; privacy.</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <svg class="settings-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                            <path d="M9 18l6-6-6-6"/>
                                        </svg>
                                    </div>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View: Custom Instructions -->
                    <div id="settings-view-custom-instructions" class="settings-view-panel settings-subview-panel">
                        <!-- Sub-view Header -->
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                                <span class="settings-back-label">Settings</span>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 id="custom-instructions-subview-title" class="settings-modal-heading">Custom Instructions</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { saveCustomInstructionsAndReturn() })} class="help-modal-ok-btn" aria-label="Save and return" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>

                        <!-- Sub-view Body -->
                        <div class="help-modal-body custom-scrollbar">
                            <p class="settings-subview-desc">What would you like JARVIS to know about you to provide better responses? These instructions shape JARVIS's tone, reasoning depth, and formatting across all conversations.</p>

                            <!-- Quick Persona Preset Chips -->
                            <div class="settings-presets-container">
                                <span class="settings-presets-label">Quick Presets:</span>
                                <div class="settings-presets-pills">
                                    <button type="button" class="settings-preset-chip" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { applyPresetPrompt('concise') })}>Concise</button>
                                    <button type="button" class="settings-preset-chip" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { applyPresetPrompt('teacher') })}>Socratic</button>
                                    <button type="button" class="settings-preset-chip" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { applyPresetPrompt('coder') })}>Senior Dev</button>
                                    <button type="button" class="settings-preset-chip" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { applyPresetPrompt('academic') })}>Academic</button>
                                </div>
                            </div>

                            <!-- Textarea & live count & Clear button -->
                            <div class="settings-textarea-wrapper">
                                <textarea
                                    id="custom-system-prompt-input"
                                    class="custom-system-prompt-input"
                                    rows="6"
                                    maxlength="1200"
                                    ${window.JarvisTrustedUI.bindUiEvent("input", function(event) { handleCustomPromptInput(this) })}
                                    placeholder="e.g. Reply like ChatGPT. Be concise, structured, direct, and avoid conversational filler.">${escapeHtml(currentPrompt)}</textarea>
                                <div class="settings-textarea-footer">
                                    <button type="button" class="settings-ghost-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { clearCustomInstructionsInput() })} title="Clear custom instructions">
                                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                                            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                                            <path d="M3 3v5h5"/>
                                        </svg>
                                        <span>Clear</span>
                                    </button>
                                    <span id="custom-prompt-char-count" class="settings-char-count">${charCount} / 1200</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View: Compliance & Observability -->
                    <div id="settings-view-compliance" class="settings-view-panel settings-subview-panel" style="display:none;">
                        <!-- Sub-view Header -->
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                                <span class="settings-back-label">Settings</span>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 class="settings-modal-heading">Compliance &amp; Observability</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-ok-btn" aria-label="Done" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>

                        <!-- Sub-view Body -->
                        <div class="help-modal-body custom-scrollbar">
                            <div class="compliance-policy-row flex items-center justify-between gap-3 p-3 rounded-xl bg-white/[0.04] border border-white/10 mb-4">
                                <div>
                                    <div class="text-xs font-semibold text-neutral-300">Policy Mode</div>
                                    <p class="text-[11px] text-neutral-400 mt-0.5">Governs how sensitive data and secrets are handled before leaving your browser.</p>
                                </div>
                                <span id="compliance-policy-badge" class="compliance-badge personal">Personal (User-controlled)</span>
                            </div>

                            <div class="settings-section-label">DATA LOSS PREVENTION (DLP)</div>
                            <div class="settings-group-card mb-4">
                                <div class="settings-row" title="Required for security — cannot be disabled">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-rose" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Block Credentials</h3>
                                            <p class="settings-row-desc">Blocks AWS, OpenAI, Anthropic, Groq, GitHub, JWTs &amp; DB URIs</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <label class="settings-switch opacity-60 cursor-not-allowed">
                                            <input type="checkbox" class="settings-switch-input" checked disabled>
                                            <span class="settings-switch-slider"></span>
                                        </label>
                                    </div>
                                </div>

                                <div class="settings-row settings-row-clickable" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { if(!event.target.closest('.settings-switch') && !event.target.closest('label')){ document.getElementById('compliance-pii-masking-toggle')?.click(); } })}>
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-cyan" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <label for="compliance-pii-masking-toggle" class="settings-row-title cursor-pointer">Mask PII</label>
                                            <p class="settings-row-desc">Masks cards, SSNs, Aadhaar, PAN &amp; emails with reversible placeholders</p>
                                        </div>
                                    </div>
                                    <div class="settings-row-right">
                                        <label class="settings-switch">
                                            <input type="checkbox" id="compliance-pii-masking-toggle" class="settings-switch-input" ${window.JarvisTrustedUI.bindUiEvent("change", function(event) { handlePiiMaskingToggle(this) })}>
                                            <span class="settings-switch-slider"></span>
                                        </label>
                                    </div>
                                </div>
                            </div>

                            <div class="settings-section-label">TELEMETRY &amp; AUDIT LOG</div>
                            <div class="settings-group-card mb-4">
                                <div class="settings-row">
                                    <div class="settings-row-left">
                                        <div class="settings-icon-badge settings-icon-purple" aria-hidden="true">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                                        </div>
                                        <div class="settings-row-text">
                                            <h3 class="settings-row-title">Telemetry Exporter</h3>
                                            <p class="settings-row-desc" id="compliance-telemetry-status">
                                                <span class="compliance-status-dot neutral"></span> Checking exporter...
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <div class="p-3">
                                    <div class="compliance-diagnostics-header flex items-center justify-between gap-3 mb-2">
                                        <div>
                                            <div class="text-xs font-semibold text-neutral-200">Local Diagnostics Log</div>
                                            <div class="text-[11px] text-neutral-400">Ring buffer of last 100 events (Diagnostics aid, not SOC2-grade evidence)</div>
                                        </div>
                                        <div class="flex items-center gap-2">
                                            <button id="btn-export-diagnostics" type="button" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { exportComplianceDiagnostics() })}>Export JSON</button>
                                            <button id="btn-clear-diagnostics" type="button" class="settings-danger-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { clearComplianceDiagnosticsLog() })}>Clear</button>
                                        </div>
                                    </div>
                                    <div id="compliance-audit-list" class="max-h-48 overflow-y-auto space-y-1 pr-1 custom-scrollbar">
                                        <!-- populated dynamically -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View: API Keys (BYOK) -->
                    <div id="settings-view-byok" class="settings-view-panel settings-subview-panel" style="display:none;">
                        <!-- Sub-view Header -->
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                                <span class="settings-back-label">Settings</span>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 class="settings-modal-heading">Bring Your Own Key (BYOK)</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { saveByokKeysAndReturn() })} class="help-modal-ok-btn" aria-label="Save and return" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Save
                            </button>
                        </div>

                        <!-- Sub-view Body -->
                        <div class="help-modal-body custom-scrollbar">
                            <p class="settings-subview-desc">
                                GitHub Secrets-style Asymmetric Encryption: Provide personal API keys to unlock higher rate limits. Keys are sealed client-side with RSA-OAEP + AES-256-GCM. Write-only: raw keys are never stored in browser memory, DOM, or database.
                            </p>

                            <!-- Key Status Banner -->
                            <div class="flex items-center justify-between p-3 rounded-xl bg-white/[0.04] border border-white/10 mb-4">
                                <div>
                                    <div class="text-xs font-semibold text-neutral-300">Active Credential Tier</div>
                                    <div class="text-[11px] text-neutral-400">Personal sealed keys take priority over shared platform quotas.</div>
                                </div>
                                <span id="byok-tier-badge" class="compliance-badge personal">Platform Default</span>
                            </div>

                            <!-- Groq Key Card -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex items-center justify-between mb-2">
                                    <label for="byok-groq-input" class="text-xs font-semibold text-neutral-200 flex items-center gap-2">
                                        <span>Groq API Key</span>
                                        <span class="text-[10px] text-sky-400 font-mono">gsk_...</span>
                                    </label>
                                    <div class="flex items-center gap-2">
                                        <span id="byok-groq-badge" class="compliance-badge personal" style="font-size:10px;">Platform Default</span>
                                        <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer" class="text-[11px] text-sky-400 hover:underline inline-flex items-center gap-1">
                                            <span>Get Free Key</span>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </a>
                                    </div>
                                </div>
                                <div class="relative flex items-center">
                                    <input
                                        type="password"
                                        id="byok-groq-input"
                                        class="w-full bg-neutral-900/90 text-neutral-100 text-xs font-mono rounded-lg px-3 py-2.5 border border-white/10 focus:border-sky-500/60 focus:outline-none pr-10"
                                        placeholder="gsk_..."
                                        autocomplete="off"
                                        spellcheck="false"
                                    />
                                    <div class="absolute right-2.5 text-neutral-400 p-1 flex items-center" title="Write-Only Asymmetric Sealed Secret">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </svg>
                                    </div>
                                </div>
                                <p class="text-[11px] text-neutral-400 mt-1.5">Powers fast LLM generation, reasoning models, and quick streaming responses.</p>
                            </div>

                            <!-- Google Gemini Key Card -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex items-center justify-between mb-2">
                                    <label for="byok-gemini-input" class="text-xs font-semibold text-neutral-200 flex items-center gap-2">
                                        <span>Google Gemini API Key</span>
                                        <span class="text-[10px] text-purple-400 font-mono">AIzaSy...</span>
                                    </label>
                                    <div class="flex items-center gap-2">
                                        <span id="byok-gemini-badge" class="compliance-badge personal" style="font-size:10px;">Platform Default</span>
                                        <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer" class="text-[11px] text-purple-400 hover:underline inline-flex items-center gap-1">
                                            <span>Get Free Key</span>
                                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                        </a>
                                    </div>
                                </div>
                                <div class="relative flex items-center">
                                    <input
                                        type="password"
                                        id="byok-gemini-input"
                                        class="w-full bg-neutral-900/90 text-neutral-100 text-xs font-mono rounded-lg px-3 py-2.5 border border-white/10 focus:border-purple-500/60 focus:outline-none pr-10"
                                        placeholder="AIzaSy..."
                                        autocomplete="off"
                                        spellcheck="false"
                                    />
                                    <div class="absolute right-2.5 text-neutral-400 p-1 flex items-center" title="Write-Only Asymmetric Sealed Secret">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                            <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                                        </svg>
                                    </div>
                                </div>
                                <p class="text-[11px] text-neutral-400 mt-1.5">Powers multimodal image inspection, vision understanding, and Gemini models.</p>
                            </div>

                            <!-- Cryptographic Guarantee Notice -->
                            <div class="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 mb-4 flex items-start gap-2.5">
                                <svg class="text-sky-400 shrink-0 mt-0.5" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                                </svg>
                                <div class="text-[11px] text-sky-200/90 leading-relaxed">
                                    <strong class="text-sky-300">GitHub Secrets-Style Sealed Box Architecture:</strong>
                                    Keys are encrypted client-side using RSA-2048 (OAEP-SHA256) and AES-256-GCM before saving to localStorage. The settings field does not reveal saved keys. Encrypted values remain accessible to scripts on this origin and may be replayed. Keep your browser and deployment trusted. A stable server keypair is required to decrypt saved keys across instances.
                                </div>
                            </div>

                            <!-- Actions Row -->
                            <div class="flex items-center justify-between pt-2">
                                <button type="button" class="settings-danger-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { clearByokKeys() })}>
                                    <span>Reset to Platform Keys</span>
                                </button>
                                <button type="button" class="settings-action-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { saveByokKeysAndReturn() })}>
                                    <span>Save &amp; Seal</span>
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View: Important Info & System Architecture -->
                    <div id="settings-view-architecture-info" class="settings-view-panel settings-subview-panel" style="display:none;">
                        <!-- Sub-view Header -->
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                                <span class="settings-back-label">Settings</span>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 class="settings-modal-heading">Important Info &amp; Architecture</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { closeHelpModal() })} class="help-modal-ok-btn" aria-label="Close settings" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>

                        <!-- Sub-view Body -->
                        <div class="help-modal-body custom-scrollbar">
                            <p class="settings-subview-desc">
                                Transparent architectural disclosures: How JARVIS is hosted, key engineering differences, and tradeoffs compared to multi-billion-dollar enterprise platforms (OpenAI / ChatGPT, Anthropic / Claude).
                            </p>

                            <!-- Runtime Environment Banner -->
                            <div class="p-3 rounded-xl bg-white/[0.04] border border-white/10 mb-4">
                                <div class="flex items-center justify-between mb-2">
                                    <div class="text-xs font-semibold text-neutral-200 flex items-center gap-2">
                                        <span class="inline-block w-2 h-2 rounded-full bg-emerald-400"></span>
                                        <span>Active Production Infrastructure</span>
                                    </div>
                                    <span class="compliance-badge personal">Serverless Vercel</span>
                                </div>
                                <div class="grid grid-cols-2 gap-2 text-[11px] text-neutral-400 mt-2">
                                    <div class="p-2 rounded-lg bg-black/40 border border-white/5">
                                        <div class="text-neutral-500 uppercase tracking-wider text-[9px] font-semibold">Node.js Runtime</div>
                                        <div class="text-neutral-200 font-mono font-medium mt-0.5">22.x (LTS)</div>
                                    </div>
                                    <div class="p-2 rounded-lg bg-black/40 border border-white/5">
                                        <div class="text-neutral-500 uppercase tracking-wider text-[9px] font-semibold">Cold Start Prevention</div>
                                        <div class="text-neutral-200 font-mono font-medium mt-0.5">Disabled (On-Demand)</div>
                                    </div>
                                </div>
                            </div>

                            <div class="settings-section-label">SYSTEM TRADEOFFS VS. ENTERPRISE AI GIANTS</div>

                            <!-- Card 1: Serverless Cold Starts -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                    <h4 class="text-xs font-semibold text-neutral-100 flex items-center gap-2 min-w-0 flex-1">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                                        <span>1. Serverless Cold Starts vs. Dedicated GPU Fleets</span>
                                    </h4>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium shrink-0">Latency Tradeoff</span>
                                </div>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-1">
                                    <strong>The Difference:</strong> Enterprise companies (OpenAI, Anthropic) maintain hundreds of thousands of constantly warm GPU clusters in dedicated datacenters 24/7. JARVIS runs on lightweight on-demand Vercel Serverless Functions with Cold Start Prevention disabled to keep the website free and lightweight.
                                </p>
                                <p class="text-[11px] text-neutral-400 leading-relaxed mt-1.5">
                                    <strong>Drawback &amp; Impact:</strong> If the site is idle for more than a few minutes, the initial request or web search may take 1 to 3 seconds longer while the serverless container initializes. Subsequent turns run at instant streaming speeds.
                                </p>
                            </div>

                            <!-- Card 2: Free Shared Tier vs Paid Subscription -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                    <h4 class="text-xs font-semibold text-neutral-100 flex items-center gap-2 min-w-0 flex-1">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="m16 10-4 4-2-2"/></svg>
                                        <span>2. Free BYOK vs. $20/mo Enterprise Subscriptions</span>
                                    </h4>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium shrink-0">Cost &amp; Quotas</span>
                                </div>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-1">
                                    <strong>The Difference:</strong> JARVIS uses your configured providers and their available quotas. No paid infrastructure was added to this app; provider limits and billing still depend on the keys and accounts you configure.
                                </p>
                                <p class="text-[11px] text-neutral-400 leading-relaxed mt-1.5">
                                    <strong>Drawback &amp; Solution:</strong> During worldwide peak spikes, shared platform limits may occasionally queue requests. You can bypass this completely by bringing your own free personal API keys under <strong>API Keys (BYOK)</strong> in Settings for dedicated, unmetered throughput.
                                </p>
                            </div>

                            <!-- Card 3: 100% Local-First Privacy -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                    <h4 class="text-xs font-semibold text-neutral-100 flex items-center gap-2 min-w-0 flex-1">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                                        <span>3. Local history and provider privacy</span>
                                    </h4>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-medium shrink-0">Privacy Advantage</span>
                                </div>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-1">
                                    <strong>The Difference:</strong> Enterprise AI platforms log all conversations and uploads to remote cloud databases and may retain user data to train future models. JARVIS is client-side first: conversations, attachments, vectors, and memory items reside strictly inside your browser (IndexedDB / localStorage).
                                </p>
                                <p class="text-[11px] text-neutral-400 leading-relaxed mt-1.5">
                                    <strong>Drawback &amp; Tradeoff:</strong> Because we do not operate a remote user database, your chat history stays on this specific device and browser. Clearing browser site data will erase local history unless you export your chats first.
                                </p>
                            </div>

                            <!-- Card 4: Real-Time Live Web Grounding -->
                            <div class="settings-group-card mb-4" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                    <h4 class="text-xs font-semibold text-neutral-100 flex items-center gap-2 min-w-0 flex-1">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a855f7" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                                        <span>4. Live Multi-Source Grounding vs. Closed Crawled Caches</span>
                                    </h4>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20 font-medium shrink-0">Search Latency</span>
                                </div>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-1">
                                    <strong>The Difference:</strong> Big tech search engines query proprietary internal index caches. JARVIS dynamically searches the live open web (DuckDuckGo, SearXNG, Wikipedia) and verifies citations and entity details in real time.
                                </p>
                                <p class="text-[11px] text-neutral-400 leading-relaxed mt-1.5">
                                    <strong>Drawback:</strong> Live retrieval adds variable network and provider latency. Source-backed answers include available evidence; missing or conflicting evidence must remain explicit.
                                </p>
                            </div>

                            <section class="settings-group-card settings-routing-card" aria-labelledby="settings-routing-title">
                                <h4 id="settings-routing-title">Model routing</h4>
                                <p>Automatic mode selects the best available Gemini or Groq model based on task complexity, media, and provider health, failing over seamlessly when a model is unavailable.</p>
                                <dl class="settings-routing-details">
                                    <div><dt>Model preference</dt><dd>${escapeHtml(currentSelectedModel === 'auto' ? 'Automatic' : currentSelectedModel)}</dd></div>
                                    <div><dt>Availability</dt><dd>Depends on provider configuration and quotas</dd></div>
                                    <div><dt>Voice</dt><dd>Browser support or a configured transcription provider</dd></div>
                                    <div><dt>Image creation</dt><dd>Free community queue; availability varies</dd></div>
                                </dl>
                            </section>

                            <!-- Card 6: Responsible Usage & Clinical Boundaries -->
                            <div class="settings-group-card mb-2" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-1.5">
                                    <h4 class="text-xs font-semibold text-neutral-100 flex items-center gap-2 min-w-0 flex-1">
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2"><path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/></svg>
                                        <span>6. Responsible AI &amp; Professional Boundaries</span>
                                    </h4>
                                    <span class="text-[10px] px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 font-medium shrink-0">Important Advisory</span>
                                </div>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-1">
                                    JARVIS provides comprehensive, grounded overviews for scientific and educational questions. However, AI cannot replace a licensed physician, attorney, or emergency operator. Medical inquiries always include an advisory notice to consult a doctor for clinical diagnosis. In emergencies, please contact local emergency services directly.
                                </p>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View 5: Workspace Backup & Storage Health -->
                    <div id="settings-view-workspace-durability" class="settings-view-panel" style="display:none;">
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to Settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 class="settings-modal-heading">Backup &amp; Storage Health</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-ok-btn" aria-label="Done" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>
                        <div class="help-modal-body custom-scrollbar">
                            <div class="settings-section-label">STORAGE HEALTH &amp; MULTI-TAB SYNC</div>
                            <div class="settings-group-card mb-3" style="padding:14px;">
                                <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
                                    <span class="text-xs font-semibold text-neutral-100">Dual-Tier IndexedDB Engine</span>
                                    <div class="flex items-center gap-2">
                                        <span id="durability-active-tabs-badge" class="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-medium">1 Active Tab</span>
                                        <span id="durability-persist-badge" class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30 font-medium">Best-Effort</span>
                                    </div>
                                </div>
                                <div class="w-full h-2 rounded-full bg-white/10 overflow-hidden mb-2">
                                    <div id="durability-quota-bar" class="h-full rounded-full transition-all duration-300" style="width:2%;background:linear-gradient(90deg,#06b6d4,#10b981);"></div>
                                </div>
                                <div id="durability-health-stats" class="text-[11px] text-neutral-300 leading-relaxed mb-3">
                                    Checking browser storage health...
                                </div>
                                <div class="flex flex-wrap items-center gap-2">
                                    <button type="button" id="btn-request-persistent-storage" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { requestWorkspacePersistentStorage() })}>Protect Storage</button>
                                    <button type="button" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { renderWorkspaceDurabilityView() })}>Refresh Metrics</button>
                                </div>
                            </div>

                            <div class="settings-section-label">PORTABLE ENCRYPTED BACKUP</div>
                            <div class="settings-group-card mb-3" style="padding:14px;">
                                <p class="text-[11px] text-neutral-300 leading-relaxed mb-2.5">
                                    Export all durable chats, unified memories, self-improving rules, and custom instructions into a portable archive. BYOK API keys are strictly excluded for security.
                                </p>
                                <label class="flex items-center gap-2 text-xs text-neutral-200 mb-2 cursor-pointer">
                                    <input type="checkbox" id="backup-encrypt-toggle" checked ${window.JarvisTrustedUI.bindUiEvent("change", function(event) { toggleBackupPassphraseField() })} class="rounded border-white/20">
                                    <span>Encrypt with AES-256-GCM (PBKDF2-SHA256)</span>
                                </label>
                                <div id="backup-passphrase-row" class="mb-3">
                                    <input type="password" id="backup-export-passphrase" class="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/15 text-white placeholder-neutral-400" placeholder="Enter backup passphrase (min 4 chars)..." autocomplete="new-password">
                                </div>
                                <button type="button" id="btn-download-workspace-backup" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { downloadEncryptedWorkspaceBackup() })}>
                                    <span>Download Workspace Backup</span>
                                </button>
                            </div>

                            <div class="settings-section-label">RESTORE WORKSPACE</div>
                            <div class="settings-group-card mb-2" style="padding:14px;">
                                <p class="text-[11px] text-neutral-300 leading-relaxed mb-2.5">
                                    Import a <code>.jarvis.json</code> archive from another device. Choose Merge to combine via Last-Write-Wins or Replace to overwrite local workspace data.
                                </p>
                                <input type="file" id="backup-restore-file" accept=".json,application/json" class="w-full text-xs text-neutral-300 mb-2.5">
                                <input type="password" id="backup-restore-passphrase" class="w-full px-3 py-2 rounded-lg text-xs bg-white/5 border border-white/15 text-white placeholder-neutral-400 mb-2.5" placeholder="Backup passphrase (required if encrypted)..." autocomplete="current-password">
                                <div class="flex items-center gap-4 text-xs text-neutral-200 mb-3">
                                    <label class="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="backup-restore-mode" value="merge" checked>
                                        <span>Merge (Keep Existing)</span>
                                    </label>
                                    <label class="flex items-center gap-1.5 cursor-pointer">
                                        <input type="radio" name="backup-restore-mode" value="replace">
                                        <span>Replace All</span>
                                    </label>
                                </div>
                                <button type="button" id="btn-restore-workspace-backup" class="settings-chip-btn" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { restoreWorkspaceBackupFromFile() })}>
                                    <span>Restore Workspace</span>
                                </button>
                                <div id="backup-restore-status" class="text-[11px] text-neutral-300 mt-2"></div>
                            </div>
                        </div>
                    </div>

                    <!-- Sub-View 6: FAQ -->
                    <div id="settings-view-faq" class="settings-view-panel settings-subview-panel" style="display:none;">
                        <div class="help-modal-header">
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { switchSettingsView('main') })} class="help-modal-back-btn settings-subview-back-btn" aria-label="Back to Settings">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                                    <path d="M19 12H5"></path>
                                    <path d="M12 19l-7-7 7-7"></path>
                                </svg>
                                <span class="settings-back-label">Settings</span>
                            </button>
                            <div class="help-modal-title-block">
                                <h2 class="settings-modal-heading">FAQ</h2>
                            </div>
                            <button type="button" ${window.JarvisTrustedUI.bindUiEvent("click", function(event) { closeHelpModal() })} class="help-modal-ok-btn" aria-label="Close settings" style="background:#ffffff!important;color:#000000!important;-webkit-text-fill-color:#000000!important;font-weight:750!important;">
                                Done
                            </button>
                        </div>
                        <div class="help-modal-body custom-scrollbar">
                            <p class="settings-subview-desc">
                                Simple answers to common questions about how JARVIS searches the web, handles images, protects your privacy, and saves your chats.
                            </p>

                            <details class="settings-group-card mb-3" style="padding:14px;" open>
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">How does Live Web Search find fresh information?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    When Web Search is switched on, JARVIS checks live news, reference pages, and trusted public sources across the internet to bring back the newest facts instead of relying only on older background knowledge. Newer articles are prioritized so outdated pages do not show up as current news, and clickable source links are included so you can verify what was found.
                                </p>
                            </details>

                            <details class="settings-group-card mb-3" style="padding:14px;">
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">What happens if free daily limits run out?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    You can add your own personal free API keys anytime under <strong>API Keys (BYOK)</strong> to keep going without shared limits. Even when online image limits run out, JARVIS can still read text in screenshots and recognize everyday photos right on your device so you are never left completely stuck.
                                </p>
                            </details>

                            <details class="settings-group-card mb-3" style="padding:14px;">
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">What does the Think button do?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    Tapping the brain icon next to the message box turns on deeper thinking mode. Use it whenever you want JARVIS to slow down and work carefully through tricky math, coding, or multi-step questions. You can turn it back off anytime by tapping the <strong>Think ×</strong> tag above the input box.
                                </p>
                            </details>

                            <details class="settings-group-card mb-3" style="padding:14px;">
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">Where are my chats, attachments, and saved memories kept — and what is IndexedDB?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    All of your conversations, custom instructions, and saved memories stay privately on your own device and browser — we do not store your personal chat history on our servers. The <strong>IndexedDB</strong> label shown next to <strong>Backup &amp; storage</strong> is simply your browser&apos;s own built-in private storage space (like a locked digital folder inside Safari or Chrome on your device) that holds your full conversations cleanly on your device. You can download the current chat as a Markdown file anytime using <strong>Export Conversation</strong>, or save a password-protected backup under <strong>Backup &amp; storage</strong> to move your chats to another device.
                                </p>
                            </details>

                            <details class="settings-group-card mb-3" style="padding:14px;">
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">How do Personalized Experience and Saved Memories work, and is my private info protected?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    When <strong>Personalized Experience</strong> is switched on in Settings, JARVIS automatically picks up helpful facts and preferences you share (like your name, city, coding tools, or preferred reply style) and uses them behind the scenes in future chats so you do not have to repeat yourself. Your thumbs-up and thumbs-down feedback on replies also helps JARVIS adapt to what you prefer. Turning <strong>Personalized Experience</strong> off pauses both learning new memories and using saved ones until you switch it back on. You can view, edit, export, or delete any saved memory anytime under <strong>Saved Memories</strong>. Built-in safety checks also block accidental sharing of passwords, card numbers, and private keys before messages leave your device.
                                </p>
                            </details>

                            <details class="settings-group-card mb-2" style="padding:14px;">
                                <summary class="text-xs font-semibold text-neutral-100 cursor-pointer">What kinds of photos, documents, and helpers are supported?</summary>
                                <p class="text-[11px] text-neutral-300 leading-relaxed mt-2">
                                    You can upload standard photos, iPhone photos, camera RAW pictures, PDFs, Word documents, spreadsheets, and text files (large photos and uncommon formats are automatically prepared on your device first). JARVIS can also check live web results, open web pages, look up the current date and time, and run quick calculations for you.
                                </p>
                            </details>
                        </div>
                    </div>
                </div>
            `;

            document.querySelector('.page-shell')?.setAttribute('aria-hidden', 'true');
            document.body.appendChild(modal); 
            window.JarvisSettings?.mount(modal);
            if (typeof refreshPrivacyDataSummary === 'function') refreshPrivacyDataSummary();
            if (typeof initModelSelector === 'function') initModelSelector();

            const customInput = modal.querySelector('#custom-system-prompt-input');
            if (customInput) {
                customInput.addEventListener('paste', () => {
                    setTimeout(() => {
                        handleCustomPromptInput(customInput);
                    }, 0);
                });
            }

            const initialFocusTarget = modal.querySelector('.help-modal-ok-btn') || modal;
            initialFocusTarget.focus();
            modal.addEventListener('keydown', trapModalFocus);
        }
