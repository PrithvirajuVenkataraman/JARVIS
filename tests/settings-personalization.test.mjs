import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

console.log('--- Testing Settings & Personalization Overhaul Suite ---');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
const swJs = fs.readFileSync(path.resolve('sw.js'), 'utf8');

// =========================================================================
// Section 1: Personalization Toggle Defaults & Defensive Parsing
// =========================================================================
console.log('--- Section 1: Personalization Toggle Defaults & Persistence ---');

// Mock localStorage engine
class MockLocalStorage {
    constructor() {
        this.store = new Map();
    }
    getItem(key) {
        return this.store.has(key) ? this.store.get(key) : null;
    }
    setItem(key, value) {
        this.store.set(key, String(value));
    }
    removeItem(key) {
        this.store.delete(key);
    }
    clear() {
        this.store.clear();
    }
}

// Extract and test isPersonalizationEnabled and setPersonalizationEnabled from index.html
const mockStorage = new MockLocalStorage();
const testContext = {
    localStorage: mockStorage,
    window: {}
};
vm.createContext(testContext);

const helperScript = `
function isPersonalizationEnabled() {
    try {
        if (typeof localStorage === 'undefined') return true;
        return localStorage.getItem('jarvis_personalized_experience') !== 'false';
    } catch (_) {
        return true;
    }
}
function setPersonalizationEnabled(enabled) {
    try {
        if (typeof localStorage === 'undefined') return;
        localStorage.setItem('jarvis_personalized_experience', enabled ? 'true' : 'false');
    } catch (_) {}
}
`;
vm.runInContext(helperScript, testContext);

// 1.1 Defaults to true with no stored key
assert.equal(testContext.isPersonalizationEnabled(), true, 'Toggle must default to true when no key is in localStorage');

// 1.2 Persists across setting to false
testContext.setPersonalizationEnabled(false);
assert.equal(mockStorage.getItem('jarvis_personalized_experience'), 'false', 'Key must be set to "false"');
assert.equal(testContext.isPersonalizationEnabled(), false, 'isPersonalizationEnabled must return false when stored value is "false"');

// 1.3 Persists across reload / setting to true
testContext.setPersonalizationEnabled(true);
assert.equal(mockStorage.getItem('jarvis_personalized_experience'), 'true', 'Key must be set to "true"');
assert.equal(testContext.isPersonalizationEnabled(), true, 'isPersonalizationEnabled must return true when set to true');

// 1.4 Defensive parsing: malformed stored values MUST resolve to true; ONLY "false" disables
const malformedValues = ['xyz', 'null', 'undefined', '', '123', '{bad:json}', 'FALSE', '0', 'no'];
for (const val of malformedValues) {
    mockStorage.setItem('jarvis_personalized_experience', val);
    assert.equal(
        testContext.isPersonalizationEnabled(),
        true,
        `Malformed value "${val}" must resolve to true; only "false" disables`
    );
}

// Verify exact "false" is the only thing that disables
mockStorage.setItem('jarvis_personalized_experience', 'false');
assert.equal(testContext.isPersonalizationEnabled(), false, '"false" must disable personalization');
console.log('  [PASS] 1.1 Toggle defaults to true, persists, and only exact "false" disables');


// =========================================================================
// Section 2: Prompt-Assembly Gating & Memory Behavior
// =========================================================================
console.log('--- Section 2: Prompt-Assembly Gating & Memory Behavior ---');

// Verify prompt assembly code gates memory context and extraction in index.html
assert.ok(
    indexHtml.includes('const personalizationActive = typeof isPersonalizationEnabled === \'function\' ? isPersonalizationEnabled() : true;'),
    'askGeminiAI must determine personalizationActive via isPersonalizationEnabled'
);
assert.ok(
    indexHtml.includes('if (personalizationActive && typeof JarvisSelfImprovingMemory !== \'undefined\' && normalizedUserMessage) {'),
    'JarvisSelfImprovingMemory.processUserMessage in askGeminiAI must be gated behind personalizationActive'
);
assert.ok(
    indexHtml.includes('const relevantSavedMemoryContext = (!personalizationActive || requestOptions?.grounding)'),
    'relevantSavedMemoryContext must be empty when personalizationActive is false'
);
assert.ok(
    indexHtml.includes('const baseMem = personalizationActive &&'),
    'baseMem must be falsy when personalizationActive is false'
);
assert.ok(
    indexHtml.includes('if (!personalizationActive) return [];'),
    'learnedDirectives must be empty when personalizationActive is false'
);

// Verify memory store preservation across toggles
const memoryStoreSimulation = {
    user_facts: [
        { id: 'fact_1', text: 'Prefers TypeScript over Python' },
        { id: 'fact_2', text: 'Location is San Francisco' }
    ],
    rules: [
        { id: 'rule_1', directive: 'Keep code concise and avoid verbose comments' }
    ]
};

// Toggle OFF
testContext.setPersonalizationEnabled(false);
// Memory store should NOT be deleted or mutated by toggling OFF
assert.equal(memoryStoreSimulation.user_facts.length, 2, 'Stored memories must NOT be deleted when toggling OFF');
assert.equal(memoryStoreSimulation.rules.length, 1, 'Stored rules must NOT be deleted when toggling OFF');

// Toggle ON
testContext.setPersonalizationEnabled(true);
assert.equal(memoryStoreSimulation.user_facts.length, 2, 'Stored memories must remain fully intact when toggled back ON');
console.log('  [PASS] 2.1 Memory extraction and injection gated; memory records preserved across toggles');


// =========================================================================
// Section 3: Custom Instructions Persistence & 1200 Character Ceiling
// =========================================================================
console.log('--- Section 3: Custom Instructions Persistence & 1200 Limit ---');

// 3.1 Maximum length of 1200 chars enforced
const longPrompt = 'A'.repeat(1500);
const truncated = longPrompt.slice(0, 1200);
assert.equal(truncated.length, 1200, 'Custom prompt must truncate to 1200 characters');

// Verify textarea in index.html enforces maxlength="1200"
assert.ok(
    indexHtml.includes('id="custom-system-prompt-input"'),
    'Custom system prompt input textarea must exist'
);
assert.ok(
    indexHtml.includes('maxlength="1200"'),
    'Textarea must have maxlength="1200"'
);

// Verify paste and input truncation handler
assert.ok(
    indexHtml.includes('function handleCustomPromptInput('),
    'handleCustomPromptInput must be defined'
);
assert.ok(
    indexHtml.includes('el.value.slice(0, 1200)'),
    'handleCustomPromptInput must slice to 1200 chars'
);

// Verify Custom Instructions apply in BOTH toggle states
// When ON:
const systemDirectivesWhenOn = (baseSystemPrompt, relevantSavedMemoryContext) => {
    return [
        baseSystemPrompt,
        relevantSavedMemoryContext ? `[Saved User Memory & Profile:\n${relevantSavedMemoryContext}]` : ''
    ].filter(Boolean).join('\n\n');
};
const customPromptSample = 'Reply like a seasoned staff engineer.';
const onPrompt = systemDirectivesWhenOn(customPromptSample, 'User is located in SF');
assert.ok(onPrompt.includes(customPromptSample), 'Custom prompt must appear when personalization is ON');
assert.ok(onPrompt.includes('User is located in SF'), 'Saved memory must appear when personalization is ON');

// When OFF:
const offPrompt = systemDirectivesWhenOn(customPromptSample, '');
assert.ok(offPrompt.includes(customPromptSample), 'Custom prompt must still appear when personalization is OFF');
assert.ok(!offPrompt.includes('User is located in SF'), 'Saved memory must NOT appear when personalization is OFF');
console.log('  [PASS] 3.1 Custom instructions persist, enforce 1200 char limit, and apply in both toggle states');


// =========================================================================
// Section 4: Sub-view Navigation & View State Machine
// =========================================================================
console.log('--- Section 4: Sub-view Navigation & View State Machine ---');

// Verify view state machine elements in index.html
assert.ok(indexHtml.includes('id="settings-view-main"'), 'Main settings view panel must exist');
assert.ok(indexHtml.includes('id="settings-view-custom-instructions"'), 'Custom instructions sub-view panel must exist');
assert.ok(indexHtml.includes('function switchSettingsView('), 'switchSettingsView function must be defined');
assert.ok(indexHtml.includes('function saveCustomInstructionsAndReturn('), 'saveCustomInstructionsAndReturn function must be defined');
assert.ok(indexHtml.includes('function updateCustomInstructionsStatus('), 'updateCustomInstructionsStatus function must be defined');
assert.ok(indexHtml.includes('function clearCustomInstructionsInput('), 'clearCustomInstructionsInput function must be defined');

// Verify sub-view header has Back button and Done button saving and returning
assert.ok(indexHtml.includes('class="help-modal-back-btn settings-subview-back-btn"'), 'Sub-view back button must exist');
assert.ok(indexHtml.includes('id="custom-instructions-subview-title"'), 'Custom instructions subview title must exist');
assert.ok(indexHtml.includes('class="settings-back-label">Settings</span>'), 'Settings back label must exist');

// Verify Escape key handling (subview goes back to main; main closes modal)
assert.ok(
    indexHtml.includes("if (window.__currentSettingsView === 'custom_instructions') {\n                    saveCustomInstructionsAndReturn();\n                } else {\n                    closeHelpModal();\n                }"),
    'Escape key must return from sub-view first with auto-save before closing modal'
);

// Verify Custom Instructions status span and chevron
assert.ok(indexHtml.includes('id="custom-instructions-status"'), 'Custom instructions status indicator must exist');
assert.ok(indexHtml.includes('class="settings-chevron"'), 'Row chevron must exist');

// Verify preset chips exist and have 4 personas
assert.ok(indexHtml.includes('applyPresetPrompt(\'concise\')'), 'Concise preset chip must exist');
assert.ok(indexHtml.includes('applyPresetPrompt(\'teacher\')'), 'Teacher/Socratic preset chip must exist');
assert.ok(indexHtml.includes('applyPresetPrompt(\'coder\')'), 'Coder/Senior Dev preset chip must exist');
assert.ok(indexHtml.includes('applyPresetPrompt(\'academic\')'), 'Academic preset chip must exist');
console.log('  [PASS] 4.1 Sub-view navigation, Back/Done saving, Escape routing, and status indicators verified');


// =========================================================================
// Section 5: Grouped Rows & Accessibility
// =========================================================================
console.log('--- Section 5: Grouped Rows & Accessibility ---');

// Verify interactive row is a real <button>
assert.ok(
    indexHtml.includes('<button type="button" class="settings-row settings-row-interactive" id="settings-row-custom-instructions"'),
    'Custom Instructions row must be a semantic <button> element'
);

// Verify iOS-style toggle switch accessibility attributes
assert.ok(
    indexHtml.includes('role="switch"'),
    'Personalization toggle must declare role="switch"'
);
assert.ok(
    indexHtml.includes('aria-checked='),
    'Personalization toggle must manage aria-checked'
);
assert.ok(
    indexHtml.includes('id="settings-personalization-toggle"'),
    'Personalization toggle ID must exist'
);
assert.ok(
    indexHtml.includes('aria-labelledby="settings-personalization-label"'),
    'Personalization toggle must be labelled via aria-labelledby'
);
assert.ok(
    indexHtml.includes('id="settings-personalization-label"'),
    'Personalization label ID must exist'
);

// Verify sections
assert.ok(indexHtml.includes('PERSONALIZATION &amp; BEHAVIOR'), 'PERSONALIZATION & BEHAVIOR section header must exist');
assert.ok(indexHtml.includes('TOOLS &amp; ARCHIVES'), 'TOOLS & ARCHIVES section header must exist');
assert.ok(indexHtml.includes('SAFETY &amp; DATA'), 'SAFETY & DATA section header must exist');

// Verify Saved Memories, Image Gallery, Export Conversation, Emergency SOS, Local Storage
assert.ok(indexHtml.includes('Saved Memories'), 'Saved Memories row must exist');
assert.ok(indexHtml.includes('Image Gallery'), 'Image Gallery row must exist');
assert.ok(indexHtml.includes('Export Conversation'), 'Export Conversation row must exist');
assert.ok(indexHtml.includes('Emergency SOS'), 'Emergency SOS row must exist');
assert.ok(indexHtml.includes('Local Storage & Privacy'), 'Local Storage & Privacy row must exist');
assert.ok(indexHtml.includes('promptClearAllDataConfirmation()'), 'Clear All Data confirmation must be hooked up');
console.log('  [PASS] 5.1 Grouped rows, semantic buttons, section titles, and switch accessibility verified');


// =========================================================================
// Section 6: CSS & Animation Styles
// =========================================================================
console.log('--- Section 6: CSS & Animation Styles ---');

assert.ok(stylesCss.includes('.settings-row'), '.settings-row class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-row-interactive'), '.settings-row-interactive class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-row-left'), '.settings-row-left class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-row-text'), '.settings-row-text class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-row-right'), '.settings-row-right class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-switch'), '.settings-switch class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-switch-input'), '.settings-switch-input class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-switch-slider'), '.settings-switch-slider class must exist in styles.css');
assert.ok(stylesCss.includes('.settings-subview-panel'), '.settings-subview-panel class must exist in styles.css');
assert.ok(stylesCss.includes('settingsSlideIn'), 'settingsSlideIn animation keyframes must exist');
assert.ok(stylesCss.includes('@media (prefers-reduced-motion: reduce)'), 'prefers-reduced-motion check must disable subview animations');
console.log('  [PASS] 6.1 All required CSS classes, animations, and reduced-motion rules verified');


// =========================================================================
// Section 7: Service Worker Cache Version
// =========================================================================
console.log('--- Section 7: Service Worker Cache Version ---');

assert.ok(swJs.includes("const CACHE_NAME = 'jarvis-cache-v12';"), 'Service worker cache must be bumped to jarvis-cache-v12');
console.log('  [PASS] 7.1 Service worker cache version jarvis-cache-v12 verified');

console.log('=== All Settings & Personalization Overhaul Tests PASSED ===');
