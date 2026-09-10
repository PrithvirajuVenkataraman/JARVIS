import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('=== Testing Tablet & iPad Layout Optimization Suite ===\n');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// Section 1: Viewport Meta Tag & Virtual Keyboard Configuration
console.log('--- Section 1: Viewport Meta Tag & Virtual Keyboard Configuration ---');
assert.ok(
    indexHtml.includes('viewport-fit=cover'),
    'Viewport meta tag must include viewport-fit=cover for edge-to-edge iPad displays'
);
assert.ok(
    indexHtml.includes('interactive-widget=resizes-content'),
    'Viewport meta tag must include interactive-widget=resizes-content for iPad on-screen keyboard support'
);
console.log('  [PASS] 1.1 Viewport meta tag contains viewport-fit=cover and interactive-widget=resizes-content');

// Section 2: Floating Input Bar Fix on Tablets (<= 1024px)
console.log('--- Section 2: Floating Input Bar Fix on Tablets (<= 1024px) ---');
const stickyInputBarRegex = /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.floating-input-bar\s*\{[^}]*position:\s*sticky/i;
assert.ok(
    !stickyInputBarRegex.test(stylesCss),
    'Floating input bar must NOT be set to position: sticky on <= 1024px (must remain fixed)'
);

assert.ok(
    stylesCss.includes('position: fixed !important;') && stylesCss.includes('z-index: 40 !important;'),
    'Floating input bar must be enforced as fixed with z-index: 40 on <= 1024px'
);
console.log('  [PASS] 2.1 Floating input bar is fixed to bottom across all tablet and mobile viewports');

// Section 3: Dedicated Tablet & iPad Breakpoints (641px to 1024px)
console.log('--- Section 3: Dedicated Tablet & iPad Breakpoints (641px to 1024px) ---');
assert.ok(
    stylesCss.includes('@media (min-width: 641px) and (max-width: 1024px)'),
    'Dedicated tablet breakpoint (641px to 1024px) must exist in styles.css'
);

assert.ok(
    stylesCss.includes('env(safe-area-inset-left)') &&
    stylesCss.includes('env(safe-area-inset-right)') &&
    stylesCss.includes('env(safe-area-inset-top)') &&
    stylesCss.includes('env(safe-area-inset-bottom)'),
    'Tablet styles must incorporate all 4 safe area insets (top, bottom, left, right)'
);
console.log('  [PASS] 3.1 Tablet breakpoint and 4-way safe area insets verified');

// Section 4: Apple HIG Touch Targets & Touch Ergonomics
console.log('--- Section 4: Apple HIG Touch Targets & Touch Ergonomics ---');
assert.ok(
    stylesCss.includes('@media (pointer: coarse)'),
    'Pointer coarse media query must exist for touchscreen ergonomics'
);
assert.ok(
    stylesCss.includes('min-width: 44px') && stylesCss.includes('min-height: 44px'),
    'Touch targets must meet Apple HIG 44px minimum sizing rule'
);
assert.ok(
    stylesCss.includes('-webkit-overflow-scrolling: touch'),
    'Momentum touch scrolling (-webkit-overflow-scrolling: touch) must be enabled'
);
console.log('  [PASS] 4.1 Apple HIG 44px touch targets and smooth touch scrolling verified');

// Section 5: Dynamic Viewport Height & Orientation Handling
console.log('--- Section 5: Dynamic Viewport Height & Orientation Handling ---');
assert.ok(
    indexHtml.includes('window.visualViewport'),
    'setVH must utilize window.visualViewport for real-time keyboard/screen dimension updates'
);
assert.ok(
    indexHtml.includes("addEventListener('orientationchange', setVH)"),
    'Orientation change listener must be registered for smooth tablet rotation'
);
assert.ok(
    indexHtml.includes("document.body.classList.remove('sidebar-docked')"),
    'Sidebar docking must auto-undock when screen rotates below 1024px'
);
console.log('  [PASS] 5.1 Dynamic Viewport Height, visualViewport, and orientationchange handling verified');

// Section 6: Horizontal Code and Table Overflow Protection
console.log('--- Section 6: Horizontal Code and Table Overflow Protection ---');
assert.ok(
    stylesCss.includes('.table-wrapper') && stylesCss.includes('overflow-x: auto'),
    'Tables and code blocks must support horizontal scrolling without breaking the layout'
);
console.log('  [PASS] 6.1 Code blocks and tables protected against horizontal overflow on tablets');

console.log('\n=== All Tablet & iPad Layout Optimization Tests PASSED ===\n');
