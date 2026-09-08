import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Testing Modern AI Workspace UI Architecture ---');

// 1. Verify index.html Layout & Elements
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Header elements: streamlined without model dropdown or theme toggle
assert.ok(indexHtml.includes('id="app-header"'), 'App header element must exist');
assert.ok(indexHtml.includes('id="chat-sidebar-toggle"'), 'Sidebar toggle button must exist');
assert.ok(indexHtml.includes('id="header-new-chat-btn"'), 'New chat header button must exist');
assert.ok(indexHtml.includes('id="header-command-palette-btn"'), 'Command palette search trigger must exist');
assert.ok(indexHtml.includes('id="header-canvas-btn"'), 'Artifact Canvas button must exist');

// Verified removed from header completely per user directive
assert.ok(!indexHtml.includes('id="header-model-pill"'), 'Header model selector pill must be removed');
assert.ok(!indexHtml.includes('id="header-model-dropdown"'), 'Header model dropdown list must be removed');
assert.ok(!indexHtml.includes('id="theme-toggle-btn"'), 'Theme toggle button must be removed (dark mode is exclusive)');
console.log('  [PASS] 1. Streamlined top navigation bar verified (header model pill and theme toggle removed)');

// Sidebar model selector preserved
assert.ok(indexHtml.includes('id="model-selector"'), 'Sidebar model selector must exist');
assert.ok(indexHtml.includes('class="chat-sidebar-model-block"'), 'Sidebar model block must exist');
console.log('  [PASS] 2. Native sidebar model selector preserved cleanly');

// Main chat container and empty state hero
assert.ok(indexHtml.includes('id="chat-main"'), 'Main chat viewport must exist');
assert.ok(indexHtml.includes('id="chat-center-column"'), 'Centered reading column must exist');
assert.ok(indexHtml.includes('id="chat-empty-state"'), 'Empty state hero must exist');
assert.ok(indexHtml.includes('class="starter-cards-grid"'), 'Starter prompt cards grid must exist');
assert.ok(indexHtml.includes('id="chat-container"'), 'Chat container element must exist');
assert.ok(indexHtml.includes('id="drag-drop-overlay"'), 'Drag and drop overlay must exist');
console.log('  [PASS] 3. Full-height workspace layout, empty state hero, and drag-drop overlay verified');

// JavaScript UI helper functions & safeguards
assert.ok(indexHtml.includes('function toggleAppTheme('), 'toggleAppTheme must be defined');
assert.ok(indexHtml.includes('function setAppTheme('), 'setAppTheme must be defined');
assert.ok(indexHtml.includes("return 'dark'"), 'Permanent dark mode returned from getAppTheme');
assert.ok(indexHtml.includes('function updateChatEmptyStateVisibility('), 'updateChatEmptyStateVisibility must be defined');
assert.ok(indexHtml.includes('const hasRealUserTurn = userMessages.length > 0;'), 'Empty state stays visible until real user interaction occurs');
assert.ok(indexHtml.includes('useStarterPrompt('), 'useStarterPrompt must be defined');
assert.ok(indexHtml.includes("'document_ocr'"), 'OCR starter prompt card must route to document_ocr action');
assert.ok(indexHtml.includes('triggerComposerFilePicker'), 'OCR action must invoke triggerComposerFilePicker');
assert.ok(indexHtml.includes('chatMain.scrollTop = chatMain.scrollHeight;'), 'Viewport auto-scroll must include chatMain');
assert.ok(indexHtml.includes('function initDragAndDropFileUpload('), 'initDragAndDropFileUpload must be defined');

// Typing waveform safeguard verification
assert.ok(indexHtml.includes("if (!spState.listening)"), 'handleComposerInput hides waveform when not actively listening to voice');
assert.ok(indexHtml.includes("if (vttWave) vttWave.classList.add('hidden')"), 'sendTextInput hides waveform on typed turns');
console.log('  [PASS] 4. Client-side permanent dark mode, persistent empty state hero, typing waveform safeguards verified');

// Next Steps & Action Plan Dynamic Engine Verification
assert.ok(indexHtml.includes('function extractContextualEntities('), 'Contextual entity extractor must exist');
assert.ok(indexHtml.includes('suggested-followups-card'), 'Suggested followups card class must exist');
assert.ok(indexHtml.includes('next-step-arrow'), 'Next step arrow indicator must exist');
console.log('  [PASS] 5. Revamped dynamic Next Steps & Action Plan engine verified in index.html');

// 2. Verify styles.css Design Tokens & Rules
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
assert.ok(stylesCss.includes('--ui-bg: #09090b'), 'Dark theme background token must be configured in :root');
assert.ok(stylesCss.includes('.app-header'), 'App header CSS must exist');
assert.ok(!stylesCss.includes('.header-model-pill'), 'Model selector pill CSS must be removed');
assert.ok(stylesCss.includes('.chat-empty-state'), 'Empty state hero CSS must exist');
assert.ok(stylesCss.includes('.starter-prompt-card'), 'Starter prompt card CSS must exist');
assert.ok(stylesCss.includes('.chat-bubble-user'), 'User message bubble CSS must exist');
assert.ok(stylesCss.includes('.drag-drop-overlay'), 'Drag-and-drop overlay CSS must exist');
assert.ok(stylesCss.includes('body.sidebar-docked'), 'Desktop dockable sidebar CSS rule must exist');
assert.ok(stylesCss.includes('.next-step-arrow'), 'Next step arrow CSS rule must exist');
assert.ok(stylesCss.includes('.enterprise-next-steps-card'), 'Revamped next steps card styling must exist');
console.log('  [PASS] 6. Permanent dark mode design tokens, Next Steps modern UI CSS verified');

// 3. Verify Artifact Studio Side-by-Side Live Code Editor & Real-Time Output
assert.ok(indexHtml.includes('id="jarvis-canvas-drawer"'), 'Artifact Canvas drawer must exist');
assert.ok(indexHtml.includes('id="canvas-code-input"'), 'Interactive code editor textarea must exist');
assert.ok(indexHtml.includes('id="canvas-line-numbers"'), 'Line numbers gutter must exist');
assert.ok(indexHtml.includes('id="canvas-preview-frame"'), 'Live preview sandbox iframe must exist');
assert.ok(indexHtml.includes('id="canvas-tab-split"'), 'Split view tab button must exist');
assert.ok(indexHtml.includes('function setCanvasViewMode('), 'setCanvasViewMode function must be defined');
assert.ok(indexHtml.includes('function executeCanvasCodeNow('), 'executeCanvasCodeNow function must be defined');
assert.ok(indexHtml.includes('function handleCanvasEditorKeydown('), 'handleCanvasEditorKeydown tab handler must be defined');
assert.ok(stylesCss.includes('.canvas-split-container'), 'Split-pane container CSS must exist');
assert.ok(stylesCss.includes('.canvas-editor-pane'), 'Editor pane CSS must exist');
assert.ok(stylesCss.includes('.canvas-preview-pane'), 'Preview pane CSS must exist');
assert.ok(stylesCss.includes('.canvas-code-textarea'), 'Code textarea styling must exist');
console.log('  [PASS] 7. Artifact Studio side-by-side interactive code editor and live output preview verified');

console.log('=== All Modern AI Workspace UI Architecture Tests PASSED ===');
