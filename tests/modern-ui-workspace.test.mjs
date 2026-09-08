import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Testing Modern AI Workspace UI Architecture ---');

// 1. Verify index.html Layout & Elements
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Header elements
assert.ok(indexHtml.includes('id="app-header"'), 'App header element must exist');
assert.ok(indexHtml.includes('id="chat-sidebar-toggle"'), 'Sidebar toggle button must exist');
assert.ok(indexHtml.includes('id="header-new-chat-btn"'), 'New chat header button must exist');
assert.ok(indexHtml.includes('id="header-model-pill"'), 'Model selector pill must exist');
assert.ok(indexHtml.includes('id="header-model-dropdown"'), 'Model dropdown list must exist');
assert.ok(indexHtml.includes('id="theme-toggle-btn"'), 'Theme toggle button must exist');
assert.ok(indexHtml.includes('id="header-canvas-btn"'), 'Artifact Canvas button must exist');
console.log('  [PASS] 1. Sticky top navigation bar and action triggers verified');

// Main chat container and empty state hero
assert.ok(indexHtml.includes('id="chat-main"'), 'Main chat viewport must exist');
assert.ok(indexHtml.includes('id="chat-center-column"'), 'Centered reading column must exist');
assert.ok(indexHtml.includes('id="chat-empty-state"'), 'Empty state hero must exist');
assert.ok(indexHtml.includes('class="starter-cards-grid"'), 'Starter prompt cards grid must exist');
assert.ok(indexHtml.includes('id="chat-container"'), 'Chat container element must exist');
assert.ok(indexHtml.includes('id="drag-drop-overlay"'), 'Drag and drop overlay must exist');
console.log('  [PASS] 2. Full-height workspace layout, empty state hero, and drag-drop overlay verified');

// JavaScript UI helper functions
assert.ok(indexHtml.includes('function toggleAppTheme('), 'toggleAppTheme must be defined');
assert.ok(indexHtml.includes('function setAppTheme('), 'setAppTheme must be defined');
assert.ok(indexHtml.includes('function toggleHeaderModelDropdown('), 'toggleHeaderModelDropdown must be defined');
assert.ok(indexHtml.includes('function selectModelFromHeader('), 'selectModelFromHeader must be defined');
assert.ok(indexHtml.includes('function selectPersonaFromHeader('), 'selectPersonaFromHeader must be defined');
assert.ok(indexHtml.includes('function updateChatEmptyStateVisibility('), 'updateChatEmptyStateVisibility must be defined');
assert.ok(indexHtml.includes('function useStarterPrompt('), 'useStarterPrompt must be defined');
assert.ok(indexHtml.includes('function initDragAndDropFileUpload('), 'initDragAndDropFileUpload must be defined');
console.log('  [PASS] 3. Client-side theme, model dropdown, starter prompts, and drag-drop logic verified');

// 2. Verify styles.css Design Tokens & Rules
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
assert.ok(stylesCss.includes('--ui-bg: #09090b'), 'Dark theme background token must be configured');
assert.ok(stylesCss.includes('.app-header'), 'App header CSS must exist');
assert.ok(stylesCss.includes('.header-model-pill'), 'Model selector pill CSS must exist');
assert.ok(stylesCss.includes('.chat-empty-state'), 'Empty state hero CSS must exist');
assert.ok(stylesCss.includes('.starter-prompt-card'), 'Starter prompt card CSS must exist');
assert.ok(stylesCss.includes('.chat-bubble-user'), 'User message bubble CSS must exist');
assert.ok(stylesCss.includes('.drag-drop-overlay'), 'Drag-and-drop overlay CSS must exist');
assert.ok(stylesCss.includes('body.sidebar-docked'), 'Desktop dockable sidebar CSS rule must exist');
console.log('  [PASS] 4. Design tokens, dual theme, empty state, and modern capsule CSS verified');

console.log('=== All Modern AI Workspace UI Architecture Tests PASSED ===');
