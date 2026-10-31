import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Testing Responsive UI & Settings Across Every Device ===');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// =========================================================================
// Section 1: Custom Instructions Subview "Settings" Button Visibility
// =========================================================================
console.log('--- Section 1: Custom Instructions Subview "Settings" Button Visibility ---');

// 1.1 Verify Subview Header HTML structure
assert.ok(
    indexHtml.includes('class="help-modal-back-btn settings-subview-back-btn"'),
    'Custom Instructions header must have .settings-subview-back-btn'
);
assert.ok(
    indexHtml.includes('<span class="settings-back-label">Settings</span>'),
    'Sub-view header must have .settings-back-label with "Settings" text'
);

// 1.2 Verify Base CSS styling for .settings-subview-back-btn
assert.ok(
    stylesCss.includes('.settings-subview-back-btn {') &&
    stylesCss.includes('min-width: max-content !important;') &&
    stylesCss.includes('width: auto !important;'),
    '.settings-subview-back-btn must use width: auto and min-width: max-content'
);

assert.ok(
    stylesCss.includes('.settings-subview-back-btn svg {') &&
    stylesCss.includes('color: #38bdf8 !important;'),
    '.settings-subview-back-btn icon must be accented (#38bdf8) for high contrast'
);

assert.ok(
    stylesCss.includes('.settings-back-label {') &&
    stylesCss.includes('color: #ffffff !important;') &&
    stylesCss.includes('white-space: nowrap !important;'),
    '.settings-back-label must be bright white and nowrap to prevent ugly clipping'
);

// 1.3 Verify Mobile (<640px) non-clamping rule
assert.ok(
    stylesCss.includes('.help-modal-back-btn:not(.settings-subview-back-btn) {'),
    'Mobile media query must restrict 36px fixed width to non-subview buttons so Settings label is never cut off'
);

// 1.4 Verify Small Handset (<380px) adaptation
assert.ok(
    stylesCss.includes('@media (max-width: 380px)') &&
    stylesCss.includes('.settings-subview-back-btn {'),
    'Small handset viewport must include tailored back-button spacing'
);

assert.ok(
    stylesCss.includes('text-overflow: ellipsis !important;'),
    'Header heading must support ellipsis truncation on narrow viewports'
);

console.log('  [PASS] 1.1 Custom Instructions "Settings" back button is crystal clear and protected on mobile');


// =========================================================================
// Section 2: Personalized Experience Switch Alignment & Geometry
// =========================================================================
console.log('--- Section 2: Personalized Experience Switch Alignment & Geometry ---');

// 2.1 Verify Switch HTML markup and accessibility
assert.ok(
    indexHtml.includes('id="settings-personalization-toggle"'),
    'Personalization toggle input must exist with ID'
);
assert.ok(
    indexHtml.includes('class="settings-switch"'),
    'Personalization toggle must use .settings-switch'
);
assert.ok(
    indexHtml.includes('class="settings-switch-slider"'),
    'Personalization toggle must have .settings-switch-slider'
);

// 2.2 Verify Switch Dimensions (Strict 48x28 track, no deformation)
assert.ok(
    stylesCss.includes('.settings-switch {') &&
    stylesCss.includes('width: 48px !important;') &&
    stylesCss.includes('height: 28px !important;') &&
    stylesCss.includes('max-height: 28px !important;'),
    '.settings-switch must strictly enforce 48px x 28px track geometry'
);

// 2.3 Verify Knob is centered vertically with top: 50% and translateY(-50%)
assert.ok(
    stylesCss.includes('.settings-switch-slider::before {') &&
    stylesCss.includes('top: 50% !important;') &&
    stylesCss.includes('transform: translateY(-50%) !important;'),
    'Switch knob must be centered vertically using top: 50% and translateY(-50%)'
);

// 2.4 Verify Checked state translates horizontally while maintaining vertical center
assert.ok(
    stylesCss.includes('.settings-switch-input:checked + .settings-switch-slider::before {') &&
    stylesCss.includes('transform: translate(20px, -50%) !important;'),
    'Checked switch knob must slide horizontally while preserving vertical centering'
);

// 2.5 Verify 44px touch target via pseudo-element without track ballooning
assert.ok(
    stylesCss.includes('.settings-switch::after {') &&
    stylesCss.includes('min-height: 44px !important;'),
    'Switch must provide 44px accessible touch target via ::after without expanding visual track'
);

// 2.6 Verify No direct min-height: 44px deforming the switch in pointer: coarse
assert.ok(
    !stylesCss.includes('.settings-switch,\n        min-height: 44px') &&
    !stylesCss.includes('.settings-switch {\n        min-height: 44px'),
    '.settings-switch must NOT have direct min-height: 44px deforming track'
);

console.log('  [PASS] 2.1 Personalized Experience switch geometry, vertical centering, and touch area verified');


// =========================================================================
// Section 3: Row Alignment, Dividers, and Status Badge
// =========================================================================
console.log('--- Section 3: Row Alignment, Dividers, and Status Badge ---');

// 3.1 Verify Right-aligned controls
assert.ok(
    stylesCss.includes('.settings-row-right {') &&
    stylesCss.includes('justify-content: flex-end !important;'),
    '.settings-row-right must enforce justify-content: flex-end for clean right-edge alignment'
);

// 3.2 Verify Consistent dividers
assert.ok(
    stylesCss.includes('.settings-group-card .settings-row {') &&
    stylesCss.includes('border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;'),
    'Grouped card rows must have consistent subtle bottom borders'
);

// 3.3 Verify Status Badge high contrast
assert.ok(
    stylesCss.includes('.settings-row-status {') &&
    stylesCss.includes('border-radius: 9999px !important;'),
    'Status badge must be a refined pill badge'
);
assert.ok(
    stylesCss.includes('.settings-row-status.configured {') &&
    stylesCss.includes('color: #38bdf8 !important;'),
    'Configured status badge must have vibrant cyan highlight'
);

// 3.4 Verify Clickable Row Feedback
assert.ok(
    stylesCss.includes('.settings-row-clickable:hover') &&
    stylesCss.includes('.settings-row-clickable:active'),
    'Clickable rows must provide responsive hover and active tap feedback'
);

// =========================================================================
// Section 4: Safety & Data Local Storage Minimal Text
// =========================================================================
console.log('--- Section 4: Safety & Data Local Storage Minimal Text ---');

assert.ok(
    indexHtml.includes('<p class="settings-row-desc">Stored locally on this device</p>'),
    'Local Storage & Privacy row description must be minimal and user-friendly'
);
assert.ok(
    !indexHtml.includes('IndexedDB storage metrics'),
    'Jargon "IndexedDB storage metrics" must not be displayed in settings description'
);
console.log('  [PASS] 4.1 Safety & Data description is minimal and jargon-free');

// =========================================================================
// Section 5: Settings Action Button Width, Image Gallery Persistence & Multimodal Search
// =========================================================================
console.log('--- Section 5: Settings Action Button Width, Image Gallery Persistence & Multimodal Search ---');

// 5.1 Action button width & padding expansion
assert.ok(
    stylesCss.includes('.settings-action-btn {') &&
    stylesCss.includes('min-width: 104px !important;') &&
    stylesCss.includes('padding: 0 16px !important;') &&
    stylesCss.includes('white-space: nowrap !important;'),
    '.settings-action-btn must have ample min-width (104px), 16px padding, and nowrap text'
);

assert.ok(
    stylesCss.includes('min-width: 92px !important;') &&
    stylesCss.includes('min-width: 86px !important;'),
    'Responsive media queries must maintain comfortable button widths on smaller screens'
);

// 5.2 Immediate Image Gallery persistence upon image reveal
assert.ok(
    indexHtml.includes('window.JarvisImageStorage?.saveImage') &&
    indexHtml.includes('jarvis_recent_images_meta'),
    'revealImage must immediately persist generated images to JarvisImageStorage and localStorage fallback'
);

// 5.3 Multimodal media attachment live web search integration
assert.ok(
    indexHtml.includes('const userOptedWebSearch = Boolean(') &&
    indexHtml.includes('getWebSearchMode() === \'force\'') &&
    indexHtml.includes('web_search_multimodal'),
    'Attachment processing must trigger live web search when user opts for web search'
);

console.log('  [PASS] 5.1 Settings action button width, gallery auto-save, and multimodal search verified');

console.log('=== All Responsive Settings UI Tests PASSED ===');

