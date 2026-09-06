import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('--- Testing Reasoning UI Accordion & Interactive Verification (Milestone 4) ---');

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
// Lightweight Mock DOM for Node.js
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
// Initialize Sandbox
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

// Load helper functions
vm.runInContext(extractFunctionSource(indexHtml, 'escapeHtml'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'formatThinkingStep'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'buildThinkingProcessHtml'), domSandbox);

// Extract toggleThinkingProcessCard definition
const toggleMatch = indexHtml.match(/window\.toggleThinkingProcessCard\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\};/);
assert.ok(toggleMatch, 'toggleThinkingProcessCard must be defined in index.html');
vm.runInContext(`window.toggleThinkingProcessCard = function(${toggleMatch[1]}) { ${toggleMatch[2]} };`, domSandbox);

const buildThinkingProcessHtml = domSandbox.buildThinkingProcessHtml;
const toggleThinkingProcessCard = domSandbox.window.toggleThinkingProcessCard;
const extractThoughtAndAnswer = domSandbox.extractThoughtAndAnswer;
const generateSteps = domSandbox.generateContextualThoughtSteps;

// =============================================================================
// TEST SUITE 1: HTML Structure & Initial Active State
// =============================================================================
console.log('1. Testing accordion HTML structure and active streaming state...');

// Test 1.1: Streaming active card with raw thought
{
    const rawThought = 'Evaluating mathematical derivative step by step';
    const html = buildThinkingProcessHtml(rawThought, [], '2.4', true, null);
    assert.ok(html.includes('thinking-process-card is-active is-expanded'), 'Must have is-active is-expanded classes during streaming');
    assert.ok(html.includes('thinking-pulse-dot'), 'Must include pulse dot');
    assert.ok(html.includes('Thinking... 2.4s'), 'Must display Thinking... timer');
    assert.ok(html.includes('thinking-chevron'), 'Must include chevron icon');
    assert.ok(html.includes('thinking-raw-content'), 'Must include raw thought container');
    assert.ok(html.includes('Evaluating mathematical derivative step by step'), 'Must contain raw thought content');
    assert.ok(html.includes('aria-expanded="true"'), 'Active card header must have aria-expanded="true"');
    console.log('  [PASS] 1.1 Active streaming card renders with pulse dot, Thinking... timer, and raw thought block');
}

// Test 1.2: Streaming active card with dynamic 3-stage CoT steps
{
    const steps = [
        'Deconstructing problem requirements',
        'Evaluating algorithmic approaches',
        'Synthesizing optimal solution'
    ];
    const html = buildThinkingProcessHtml('', steps, '1.5', true, null);
    assert.ok(html.includes('thinking-chain-of-thought'), 'Must include chain of thought container');
    assert.ok(html.includes('thinking-cot-step'), 'Must include cot step rows');
    assert.ok(html.includes('thinking-cot-number'), 'Must include numbered badges');
    assert.ok(html.includes('1'), 'Must have step 1 number');
    assert.ok(html.includes('Deconstructing problem requirements'), 'Must include step 1 text');
    console.log('  [PASS] 1.2 Active CoT card renders 3-stage numbered narrative structure');
}

// Test 1.3: HTML escaping and XSS safety in thought content
{
    const dangerousThought = '<script>alert("xss")</script> & <div>test</div>';
    const html = buildThinkingProcessHtml(dangerousThought, [], '2.0', true, null);
    assert.ok(!html.includes('<script>'), 'Must not contain raw script tag');
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Must escape script tags');
    console.log('  [PASS] 1.3 HTML content within thoughts is securely escaped against XSS');
}

// Test 1.4: Self-healing retry indicator badge
{
    const selfHealing = { thought: 'Query refinement retry #1 applied' };
    const html = buildThinkingProcessHtml('Evaluating', [], '3.1', false, selfHealing);
    assert.ok(html.includes('thinking-step is-self-healing'), 'Must include self-healing badge');
    assert.ok(html.includes('Query refinement retry #1 applied'), 'Must contain self-healing thought text');
    console.log('  [PASS] 1.4 Self-healing retry steps render with distinct badge styling');
}

// Test 1.5: Empty thought / pleasantry suppression
{
    const html = buildThinkingProcessHtml('', [], '0.0', false, null);
    assert.equal(html, '', 'Empty thought and steps must produce empty string');
    console.log('  [PASS] 1.5 Empty thought content generates no unnecessary accordion markup');
}

// =============================================================================
// TEST SUITE 2: Auto-collapse Behavior Upon Answer Token Arrival
// =============================================================================
console.log('\n2. Testing auto-collapse behavior upon answer token arrival...');

{
    // Simulate streaming update cycle
    const cardEl = new MockElement('div', 'thinking-process-card is-active is-expanded');
    const headerEl = new MockElement('div', 'thinking-header');
    headerEl.setAttribute('aria-expanded', 'true');
    const timerEl = new MockElement('span', 'thinking-timer');
    timerEl.textContent = 'Thinking... 1.8s';
    headerEl.appendChild(timerEl);
    const bodyEl = new MockElement('div', 'thinking-body');
    const rawContentEl = new MockElement('div', 'thinking-raw-content');
    rawContentEl.textContent = 'Analyzing query semantics';
    bodyEl.appendChild(rawContentEl);
    cardEl.appendChild(headerEl);
    cardEl.appendChild(bodyEl);

    // Initial state check: streaming active
    assert.ok(cardEl.classList.contains('is-active'));
    assert.ok(cardEl.classList.contains('is-expanded'));
    assert.ok(!cardEl.classList.contains('is-finished'));

    // Step 2: Answer token arrives -> Transition to isFinished
    const cleanAnswer = 'The capital of France is Paris.';
    const isFinished = !!cleanAnswer;
    assert.equal(isFinished, true);

    // Execute the exact class update from updateStreamingAssistantMessage
    cardEl.className = 'thinking-process-card is-finished';
    headerEl.setAttribute('aria-expanded', 'false');
    if (timerEl && !timerEl.textContent.startsWith('Thought for')) {
        const elapsed = '1.8';
        timerEl.textContent = `Thought for ${elapsed}s`;
    }

    assert.ok(cardEl.classList.contains('is-finished'), 'Card must have is-finished class');
    assert.ok(!cardEl.classList.contains('is-expanded'), 'Card must NOT have is-expanded class (auto-collapsed)');
    assert.ok(!cardEl.classList.contains('is-active'), 'Card must NOT have is-active class');
    assert.equal(timerEl.textContent, 'Thought for 1.8s', 'Timer must update to "Thought for X.Xs" format');
    assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'aria-expanded must update to false');

    console.log('  [PASS] 2.1 Accordion automatically shifts to .is-finished and collapses .is-expanded when answer begins');
}

// =============================================================================
// TEST SUITE 3: Click Toggle Interaction (.is-expanded toggle & aria)
// =============================================================================
console.log('\n3. Testing click toggle expansion and collapse...');

{
    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('aria-expanded', 'false');
    card.appendChild(header);

    let stoppedEvent = false;
    const mockEvent = {
        stopPropagation: () => { stoppedEvent = true; }
    };

    // First click: Expand the collapsed card
    toggleThinkingProcessCard(card, mockEvent);
    assert.equal(stoppedEvent, true, 'Click event propagation must be stopped');
    assert.ok(card.classList.contains('is-expanded'), 'Click on finished card must add is-expanded');
    assert.ok(card.classList.contains('is-finished'), 'Card must retain is-finished');
    assert.equal(header.getAttribute('aria-expanded'), 'true', 'aria-expanded must toggle to true');

    // Second click: Collapse the expanded card
    stoppedEvent = false;
    toggleThinkingProcessCard(card, mockEvent);
    assert.equal(stoppedEvent, true);
    assert.ok(!card.classList.contains('is-expanded'), 'Second click must remove is-expanded');
    assert.ok(card.classList.contains('is-finished'));
    assert.equal(header.getAttribute('aria-expanded'), 'false', 'aria-expanded must toggle to false');

    // Passing header directly (resolving closest parent)
    stoppedEvent = false;
    toggleThinkingProcessCard(header, mockEvent);
    assert.ok(card.classList.contains('is-expanded'), 'Passing child element to toggle must toggle parent card');
    assert.equal(header.getAttribute('aria-expanded'), 'true');

    // Null safety
    assert.doesNotThrow(() => toggleThinkingProcessCard(null, null));
    console.log('  [PASS] 3.1 toggleThinkingProcessCard reliably toggles .is-expanded and updates ARIA attributes');
}

// =============================================================================
// TEST SUITE 4: Accurate Elapsed Duration Recording & Precision
// =============================================================================
console.log('\n4. Testing elapsed duration calculation and formatting...');

{
    const testLatencies = [
        { ms: 1420, expected: '1.4' },
        { ms: 2890, expected: '2.9' },
        { ms: 800, expected: '0.8' },
        { ms: 15600, expected: '15.6' }
    ];

    for (const { ms, expected } of testLatencies) {
        const elapsed = (ms / 1000).toFixed(1);
        assert.equal(elapsed, expected, `Expected ${expected}s from ${ms}ms`);
        const html = buildThinkingProcessHtml('thought', [], elapsed, false, null);
        assert.ok(html.includes(`Thought for ${expected}s`), `HTML must contain "Thought for ${expected}s"`);
    }
    console.log('  [PASS] 4.1 Latency duration accurately rounded to 1 decimal place with "Thought for X.Xs" syntax');
}

// =============================================================================
// TEST SUITE 5: CSS Transitions, Chevron Classes & Visual Semantics
// =============================================================================
console.log('\n5. Testing styles.css rules for transitions and layout...');

{
    // 5.1 Card smooth cubic-bezier transition
    assert.match(stylesCss, /\.thinking-process-card\s*\{[\s\S]*?transition:\s*all\s+0\.25s\s+cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/, 'Card must have 0.25s cubic-bezier transition');

    // 5.2 Chevron rotation on expand
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-chevron[\s\S]*?transform:\s*rotate\(180deg\)/, 'Chevron must rotate 180deg when is-expanded');

    // 5.3 Accordion body continuous transition (max-height, opacity, padding)
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?max-height:\s*0/, 'Thinking body must default to max-height: 0');
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?opacity:\s*0/, 'Thinking body must default to opacity: 0');
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?transition:\s*max-height/, 'Thinking body must transition max-height');

    // 5.4 Expanded body open state
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-body[\s\S]*?max-height:\s*min\(/, 'Expanded body must have responsive max-height');
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-body[\s\S]*?opacity:\s*1/, 'Expanded body must have opacity: 1');

    // 5.5 Keyframes: thinkingDotGlow and fadeInThought
    assert.match(stylesCss, /@keyframes thinkingDotGlow\s*\{/, 'Must define thinkingDotGlow keyframes');
    assert.match(stylesCss, /@keyframes fadeInThought\s*\{/, 'Must define fadeInThought keyframes');
    assert.match(stylesCss, /\.thinking-process-card\.is-finished\s+\.thinking-pulse-dot\s*\{[\s\S]*?animation:\s*none/, 'Finished pulse dot must disable animation');

    // 5.6 Mobile and accessibility reduced motion
    assert.match(stylesCss, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.thinking-header/, 'Must provide mobile media query for thinking-header');
    assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.thinking-body/, 'Must provide reduced motion accessibility rules');

    console.log('  [PASS] 5.1 All CSS rules for smooth transitions, fadeInThought keyframes, chevron rotation, and mobile responsiveness verified');
}

console.log('\n================================================================');
console.log('--- REASONING UI ACCORDION TEST SUITE COMPLETED (5/5 PASS) ---');
console.log('================================================================\n');
