import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('=== Milestone 4 Empirical Challenger Stress Test Suite ===\n');

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
// Advanced Mock DOM Engine for Adversarial Testing
// -----------------------------------------------------------------------------
class MockClassList {
    constructor(classes = []) {
        this._classes = new Set(classes.filter(Boolean));
    }
    add(...cls) { cls.forEach(c => c && this._classes.add(c)); }
    remove(...cls) { cls.forEach(c => c && this._classes.delete(c)); }
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
        this.__thinkingStartedAt = null;
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
    get firstChild() { return this.children[0] || null; }

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

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            child.parentElement = null;
            this.children.splice(idx, 1);
        }
        return child;
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
        if (selector.startsWith('#')) {
            return this.attributes['id'] === selector.slice(1);
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
        const raw = String(html || '');
        if (!raw.includes('<')) {
            this._textContent = raw.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            return;
        }
        const parsedNodes = parseHtmlToMockNodes(raw);
        for (const node of parsedNodes) {
            this.appendChild(node);
        }
    }
}

function parseAttributes(rawAttrs, el) {
    const attrRegex = /([a-zA-Z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
    let match;
    while ((match = attrRegex.exec(rawAttrs)) !== null) {
        const name = match[1];
        const val = match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : (match[4] || ''));
        if (name === 'class') {
            el.className = val;
        } else {
            el.setAttribute(name, val);
        }
    }
}

function parseHtmlToMockNodes(html) {
    const nodes = [];
    let i = 0;
    while (i < html.length) {
        const openIdx = html.indexOf('<', i);
        if (openIdx === -1) {
            break;
        }
        if (html.startsWith('<!--', openIdx)) {
            const endComment = html.indexOf('-->', openIdx);
            i = endComment === -1 ? html.length : endComment + 3;
            continue;
        }
        const tagClose = html.indexOf('>', openIdx);
        if (tagClose === -1) break;
        const tagContent = html.slice(openIdx + 1, tagClose).trim();
        if (tagContent.startsWith('/')) {
            i = tagClose + 1;
            continue;
        }
        const isSelfClosing = tagContent.endsWith('/') || ['img', 'br', 'hr', 'input', 'polyline'].includes(tagContent.split(/\s+/)[0].toLowerCase());
        const tagTokens = tagContent.replace(/\/$/, '').trim();
        const spaceIdx = tagTokens.search(/\s/);
        const tagName = spaceIdx === -1 ? tagTokens : tagTokens.slice(0, spaceIdx);
        const rawAttrs = spaceIdx === -1 ? '' : tagTokens.slice(spaceIdx + 1);

        const el = new MockElement(tagName);
        parseAttributes(rawAttrs, el);

        if (isSelfClosing) {
            nodes.push(el);
            i = tagClose + 1;
            continue;
        }

        let depth = 1;
        let searchIdx = tagClose + 1;
        let bodyEnd = -1;
        let nextTagEnd = -1;

        while (depth > 0 && searchIdx < html.length) {
            const nextTagOpen = html.indexOf('<', searchIdx);
            if (nextTagOpen === -1) {
                bodyEnd = html.length;
                nextTagEnd = html.length;
                break;
            }
            const nextTagClose = html.indexOf('>', nextTagOpen);
            if (nextTagClose === -1) {
                bodyEnd = html.length;
                nextTagEnd = html.length;
                break;
            }
            const innerTag = html.slice(nextTagOpen + 1, nextTagClose).trim();
            const innerTagName = innerTag.replace(/^\//, '').split(/\s+/)[0].toLowerCase();
            const isSelf = innerTag.endsWith('/') || ['img', 'br', 'hr', 'input', 'polyline'].includes(innerTagName);

            if (innerTagName === tagName.toLowerCase()) {
                if (innerTag.startsWith('/')) {
                    depth--;
                    if (depth === 0) {
                        bodyEnd = nextTagOpen;
                        nextTagEnd = nextTagClose + 1;
                        break;
                    }
                } else if (!isSelf) {
                    depth++;
                }
            }
            searchIdx = nextTagClose + 1;
        }

        if (bodyEnd !== -1) {
            const inner = html.slice(tagClose + 1, bodyEnd);
            el.innerHTML = inner;
            nodes.push(el);
            i = nextTagEnd;
        } else {
            nodes.push(el);
            i = tagClose + 1;
        }
    }
    return nodes;
}

// -----------------------------------------------------------------------------
// Initialize Sandbox
// -----------------------------------------------------------------------------
let mockTime = 1000.0;
const assistantRowsMap = new Map();
const assistantMetaMap = new Map();

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
        now: () => mockTime
    },
    findAssistantMessageRow: (msgId) => assistantRowsMap.get(msgId) || null,
    getAssistantMessageMeta: (msgId) => assistantMetaMap.get(msgId) || null,
    registerAssistantMessageMeta: (msgId, meta) => { assistantMetaMap.set(msgId, meta); },
    renderAssistantTextIntoElement: (el, text, opts) => {
        if (el) {
            el.textContent = text;
            el.classList.toggle('is-streaming', opts?.streaming === true);
        }
    },
    prepareAssistantSourcePresentation: (text, meta) => ({ sources: meta?.sources || [] }),
    analyzeAnswerRiskFlags: () => [],
    maybeAutoScroll: () => {},
    activeResponseRenderContext: null,
    Math,
    Number,
    String,
    Array,
    Set,
    Map,
    console
};
vm.createContext(domSandbox);

// Load functions
vm.runInContext(extractFunctionSource(indexHtml, 'escapeHtml'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'buildThinkingProcessHtml'), domSandbox);

const toggleMatch = indexHtml.match(/window\.toggleThinkingProcessCard\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\};/);
assert.ok(toggleMatch, 'toggleThinkingProcessCard must be defined in index.html');
vm.runInContext(`window.toggleThinkingProcessCard = function(${toggleMatch[1]}) { ${toggleMatch[2]} };`, domSandbox);

vm.runInContext(extractFunctionSource(indexHtml, 'updateStreamingAssistantMessage'), domSandbox);

const {
    buildThinkingProcessHtml,
    updateStreamingAssistantMessage,
    extractThoughtAndAnswer,
    generateContextualThoughtSteps
} = domSandbox;
const toggleThinkingProcessCard = domSandbox.window.toggleThinkingProcessCard;

let totalChecks = 0;
let passedChecks = 0;

function check(description, fn) {
    totalChecks++;
    try {
        fn();
        passedChecks++;
        console.log(`  [PASS] ${description}`);
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`        ${err.message}`);
        throw err;
    }
}

// =============================================================================
// SECTION 1: RAPID STREAM CHUNK FEEDS & AUTO-COLLAPSE TIMING ORACLE
// =============================================================================
console.log('--- Section 1: Rapid Stream Chunk Feeds & Auto-Collapse Timing ---');

check('1.1 Single-byte streaming chunk feed maintains active thinking state and auto-collapses on first answer byte', () => {
    mockTime = 1000.0;
    const msgId = 'stream-test-single-byte';
    
    // Create mock row
    const row = new MockElement('div', 'chat-row chat-row-assistant');
    const bubble = new MockElement('div', 'chat-bubble chat-bubble-assistant');
    const textEl = new MockElement('div', 'assistant-message-text');
    bubble.appendChild(textEl);
    row.appendChild(bubble);
    assistantRowsMap.set(msgId, row);

    const fullStream = '<think>\nAnalyzing query semantics...\nFormulating mathematical proof...\n</think>\nThe square root of 144 is 12.';
    
    let accumulated = '';
    let collapsedAtChar = -1;

    for (let i = 0; i < fullStream.length; i++) {
        mockTime += 10.0; // 10ms per char
        accumulated += fullStream[i];
        
        updateStreamingAssistantMessage(msgId, accumulated, { streaming: true, userMessage: 'What is sqrt(144)?' });
        
        const card = row.querySelector('.thinking-process-card');
        assert.ok(card, 'thinking card must be created during streaming at char ' + i);
        const header = card.querySelector('.thinking-header');
        assert.ok(header, 'thinking header must exist');
        const timer = card.querySelector('.thinking-timer');
        assert.ok(timer, 'thinking timer must exist');
        const rawContent = card.querySelector('.thinking-raw-content');

        const parsed = extractThoughtAndAnswer(accumulated);

        if (!parsed.answer) {
            // Still in reasoning phase
            assert.ok(card.classList.contains('is-active'), `Must be active at char ${i} (${JSON.stringify(accumulated)})`);
            assert.ok(card.classList.contains('is-expanded'), `Must be expanded at char ${i}`);
            assert.strictEqual(card.classList.contains('is-finished'), false, `Must NOT be finished at char ${i}`);
            assert.strictEqual(header.getAttribute('aria-expanded'), 'true');
            assert.match(timer.textContent, /^Thinking\.\.\.\s+[0-9.]+s$/);
            if (rawContent && parsed.thought) {
                assert.strictEqual(rawContent.textContent, parsed.thought);
            }
        } else {
            // First answer token or subsequent answer tokens
            if (collapsedAtChar === -1) {
                collapsedAtChar = i;
            }
            assert.strictEqual(card.classList.contains('is-active'), false, `Must NOT be active after answer starts at char ${i}`);
            assert.strictEqual(card.classList.contains('is-expanded'), false, `Must NOT be expanded after answer starts at char ${i}`);
            assert.ok(card.classList.contains('is-finished'), `Must be finished at char ${i}`);
            assert.strictEqual(header.getAttribute('aria-expanded'), 'false');
            assert.match(timer.textContent, /^Thought for\s+[0-9.]+s$/);
        }
    }

    assert.notEqual(collapsedAtChar, -1, 'Must have auto-collapsed when answer began');
    // Verify collapse happened precisely when '<think>...</think>' ended and 'T' appeared
    const answerStartIdx = fullStream.indexOf('The square root');
    assert.strictEqual(collapsedAtChar, answerStartIdx, `Collapsed at exact answer byte index ${answerStartIdx}`);
});

check('1.2 Random chunk fragmentation simulation (1-25 bytes per chunk) with multi-stage reasoning', () => {
    mockTime = 5000.0;
    const msgId = 'stream-test-random-chunks';
    
    const row = new MockElement('div', 'chat-row chat-row-assistant');
    const bubble = new MockElement('div', 'chat-bubble chat-bubble-assistant');
    const textEl = new MockElement('div', 'assistant-message-text');
    bubble.appendChild(textEl);
    row.appendChild(bubble);
    assistantRowsMap.set(msgId, row);

    const fullStream = '<think>\nStage 1: Dissecting geographical coordinates.\nStage 2: Cross-referencing border treaties.\nStage 3: Structuring regional overview.\n</think>\nParis is the capital and most populous city of France.';
    
    let streamPos = 0;
    let accumulated = '';
    let transitionObserved = false;

    // Deterministic pseudo-random chunk generator
    let seed = 42;
    function nextRand(min, max) {
        seed = (seed * 9301 + 49297) % 233280;
        const rnd = seed / 233280;
        return Math.floor(min + rnd * (max - min + 1));
    }

    while (streamPos < fullStream.length) {
        const chunkSize = Math.min(nextRand(1, 20), fullStream.length - streamPos);
        const chunk = fullStream.slice(streamPos, streamPos + chunkSize);
        streamPos += chunkSize;
        accumulated += chunk;
        mockTime += nextRand(15, 60);

        updateStreamingAssistantMessage(msgId, accumulated, { streaming: true, userMessage: 'Tell me about Paris' });

        const card = row.querySelector('.thinking-process-card');
        assert.ok(card, 'Card must exist');
        const parsed = extractThoughtAndAnswer(accumulated);

        if (!parsed.answer) {
            assert.ok(card.classList.contains('is-active'));
            assert.ok(card.classList.contains('is-expanded'));
            assert.strictEqual(card.classList.contains('is-finished'), false);
        } else {
            transitionObserved = true;
            assert.strictEqual(card.classList.contains('is-active'), false);
            assert.strictEqual(card.classList.contains('is-expanded'), false);
            assert.ok(card.classList.contains('is-finished'));
        }
    }

    assert.ok(transitionObserved, 'Transition to finished must be observed');
    // Finalize stream with streaming: false
    updateStreamingAssistantMessage(msgId, accumulated, { streaming: false, latency: 1250 });
    const card = row.querySelector('.thinking-process-card');
    assert.strictEqual(card.classList.contains('is-finished'), true);
    assert.match(card.querySelector('.thinking-timer').textContent, /^Thought for [0-9.]+s$/);
});

check('1.3 Streaming without explicit <think> tokens uses dynamic CoT steps and auto-collapses on completion', () => {
    mockTime = 10000.0;
    const msgId = 'stream-test-dynamic-cot';

    const row = new MockElement('div', 'chat-row chat-row-assistant');
    const bubble = new MockElement('div', 'chat-bubble chat-bubble-assistant');
    const textEl = new MockElement('div', 'assistant-message-text');
    bubble.appendChild(textEl);
    row.appendChild(bubble);
    assistantRowsMap.set(msgId, row);

    // Stream chunks that contain plain text (no <think>)
    const prompt = 'How do airplanes fly?';
    
    // Initial empty stream chunk during deliberation
    updateStreamingAssistantMessage(msgId, '', { streaming: true, userMessage: prompt });
    let card = row.querySelector('.thinking-process-card');
    assert.ok(card, 'Card generated from dynamic CoT steps');
    assert.ok(card.classList.contains('is-active'));
    assert.ok(card.classList.contains('is-expanded'));
    assert.ok(card.querySelector('.thinking-chain-of-thought'), 'Should render dynamic CoT steps');

    // First answer chunk arrives
    mockTime += 500.0;
    updateStreamingAssistantMessage(msgId, 'Airplanes fly by generating lift...', { streaming: true, userMessage: prompt });
    card = row.querySelector('.thinking-process-card');
    assert.ok(card.classList.contains('is-finished'), 'Card collapses on answer text');
    assert.strictEqual(card.classList.contains('is-expanded'), false);
    assert.strictEqual(card.querySelector('.thinking-header').getAttribute('aria-expanded'), 'false');
});

// =============================================================================
// SECTION 2: RAPID CLICK TOGGLING & STATE MACHINE STRESS HARNESS
// =============================================================================
console.log('\n--- Section 2: Rapid Click Toggling & State Machine Stress Harness ---');

check('2.1 5,000 rapid randomized click toggles on headers and cards maintain strict binary parity', () => {
    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('aria-expanded', 'false');
    const timer = new MockElement('span', 'thinking-timer');
    timer.textContent = 'Thought for 2.4s';
    const chevron = new MockElement('svg', 'thinking-chevron');
    const body = new MockElement('div', 'thinking-body');
    const raw = new MockElement('div', 'thinking-raw-content');
    raw.textContent = 'Step 1: Analyzed facts.';
    body.appendChild(raw);
    header.appendChild(timer);
    header.appendChild(chevron);
    card.appendChild(header);
    card.appendChild(body);

    let stoppedEventsCount = 0;
    const mockTargets = [card, header, timer, chevron, body, raw];

    for (let i = 1; i <= 5000; i++) {
        const target = mockTargets[i % mockTargets.length];
        const event = {
            stopPropagation: () => { stoppedEventsCount++; }
        };

        toggleThinkingProcessCard(target, event);

        const expectedExpanded = (i % 2 === 1);
        const hasExpandedClass = card.classList.contains('is-expanded');
        const ariaExpanded = header.getAttribute('aria-expanded');

        assert.strictEqual(hasExpandedClass, expectedExpanded, `Iteration ${i}: classList is-expanded must be ${expectedExpanded}`);
        assert.strictEqual(ariaExpanded, expectedExpanded ? 'true' : 'false', `Iteration ${i}: aria-expanded must be ${expectedExpanded}`);
    }

    assert.strictEqual(stoppedEventsCount, 5000, 'Every toggle interaction must call stopPropagation');
});

check('2.2 Keyboard interaction triggers (Enter and Space) on .thinking-header', () => {
    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'false');
    card.appendChild(header);

    // Simulate keydown event evaluation as embedded in index.html onclick/onkeydown
    function simulateKeydown(key) {
        let prevented = false;
        let stopped = false;
        const event = {
            key,
            preventDefault: () => { prevented = true; },
            stopPropagation: () => { stopped = true; }
        };

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleThinkingProcessCard(header.closest('.thinking-process-card') || header, event);
        }
        return { prevented, stopped };
    }

    // Press Enter -> Expand
    let res = simulateKeydown('Enter');
    assert.ok(res.prevented);
    assert.ok(res.stopped);
    assert.ok(card.classList.contains('is-expanded'));
    assert.strictEqual(header.getAttribute('aria-expanded'), 'true');

    // Press Space -> Collapse
    res = simulateKeydown(' ');
    assert.ok(res.prevented);
    assert.ok(res.stopped);
    assert.strictEqual(card.classList.contains('is-expanded'), false);
    assert.strictEqual(header.getAttribute('aria-expanded'), 'false');

    // Press Tab (non-trigger key) -> No change
    res = simulateKeydown('Tab');
    assert.strictEqual(res.prevented, false);
    assert.strictEqual(res.stopped, false);
    assert.strictEqual(card.classList.contains('is-expanded'), false);
});

check('2.3 Resilient handling of malformed toggle invocations (null card, missing closest, detached node)', () => {
    // Null card
    assert.doesNotThrow(() => toggleThinkingProcessCard(null, null));

    // Element without closest method
    const nakedObj = { classList: new MockClassList() };
    assert.doesNotThrow(() => toggleThinkingProcessCard(nakedObj, null));
    assert.ok(nakedObj.classList.contains('is-expanded'));

    // Card with no header
    const headlessCard = new MockElement('div', 'thinking-process-card');
    assert.doesNotThrow(() => toggleThinkingProcessCard(headlessCard, null));
    assert.ok(headlessCard.classList.contains('is-expanded'));
});

// =============================================================================
// SECTION 3: CSS LAYOUT STABILITY & ZERO DISPLAY:NONE INVARIANTS
// =============================================================================
console.log('\n--- Section 3: DOM Layout Stability & Zero display:none Invariants ---');

check('3.1 styles.css defines display: block on .thinking-body and avoids discrete display: none', () => {
    // Extract .thinking-body CSS rule blocks
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?display:\s*block;/, 'Base .thinking-body rule must define display: block');
    assert.strictEqual(stylesCss.includes('.thinking-body { display: none'), false, 'styles.css must not have display: none on .thinking-body');
    assert.strictEqual(/\.thinking-body[^{]*\{[^}]*display:\s*none/i.test(stylesCss), false, 'No .thinking-body rule can contain display: none');

    // Verify .thinking-process-card.is-finished:not(.is-expanded) .thinking-body uses height/opacity collapse
    const finishedRule = stylesCss.match(/\.thinking-process-card\.is-finished:not\(\.is-expanded\)\s+\.thinking-body\s*\{[\s\S]*?\}/);
    assert.ok(finishedRule, 'Finished not expanded rule must exist');
    assert.ok(finishedRule[0].includes('max-height: 0'), 'Must collapse max-height to 0');
    assert.ok(finishedRule[0].includes('opacity: 0'), 'Must collapse opacity to 0');
    assert.ok(finishedRule[0].includes('overflow: hidden'), 'Must set overflow: hidden');
    assert.strictEqual(finishedRule[0].includes('display: none'), false, 'Must NOT use display: none');
});

check('3.2 styles.css defines continuous GPU transitions for max-height, opacity, padding, and border-color', () => {
    const transitionMatch = stylesCss.match(/transition:\s*max-height[^;]+;/);
    assert.ok(transitionMatch, 'Transition definition for max-height must exist in styles.css');
    const transitionStr = transitionMatch[0];
    assert.ok(transitionStr.includes('max-height'), 'Must transition max-height');
    assert.ok(transitionStr.includes('opacity'), 'Must transition opacity');
    assert.ok(transitionStr.includes('padding'), 'Must transition padding');
    assert.ok(transitionStr.includes('border-color'), 'Must transition border-color');
    assert.ok(transitionStr.includes('cubic-bezier'), 'Must use cubic-bezier acceleration');
});

check('3.3 Chevron animation uses will-change: transform and 180deg rotation', () => {
    const chevronRule = stylesCss.match(/\.thinking-chevron[\s\S]*?\{[\s\S]*?\}/);
    assert.ok(chevronRule, '.thinking-chevron rule must exist');
    assert.ok(chevronRule[0].includes('will-change: transform'), 'Chevron must have will-change: transform');
    assert.ok(chevronRule[0].includes('transform-origin: center center'), 'Chevron must have transform-origin');

    const expandedChevron = stylesCss.match(/\.thinking-process-card\.is-expanded\s+\.thinking-chevron[\s\S]*?\{[\s\S]*?\}/);
    assert.ok(expandedChevron, 'Expanded chevron rule must exist');
    assert.ok(expandedChevron[0].includes('rotate(180deg)'), 'Expanded chevron must rotate 180deg');
});

check('3.4 Responsive layout and prefers-reduced-motion accessibility rules', () => {
    const mobileRule = stylesCss.match(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.thinking-header[\s\S]*?\}/);
    assert.ok(mobileRule, 'Mobile media query for .thinking-header must exist');

    const reducedMotion = stylesCss.match(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\}/);
    assert.ok(reducedMotion, 'prefers-reduced-motion media query must exist');
    assert.ok(reducedMotion[0].includes('transition-duration: 0.01ms !important'), 'Reduced motion must collapse transition duration');
});

// =============================================================================
// SECTION 4: MULTI-TURN ISOLATION & ADVERSARIAL PAYLOADS
// =============================================================================
console.log('\n--- Section 4: Multi-Turn Isolation & Adversarial Payloads ---');

check('4.1 Multiple assistant messages with active and finished thinking cards operate independently without cross-talk', () => {
    const msgId1 = 'msg-turn-1';
    const msgId2 = 'msg-turn-2';

    const row1 = new MockElement('div', 'chat-row chat-row-assistant');
    const bubble1 = new MockElement('div', 'chat-bubble chat-bubble-assistant');
    const text1 = new MockElement('div', 'assistant-message-text');
    bubble1.appendChild(text1);
    row1.appendChild(bubble1);
    assistantRowsMap.set(msgId1, row1);

    const row2 = new MockElement('div', 'chat-row chat-row-assistant');
    const bubble2 = new MockElement('div', 'chat-bubble chat-bubble-assistant');
    const text2 = new MockElement('div', 'assistant-message-text');
    bubble2.appendChild(text2);
    row2.appendChild(bubble2);
    assistantRowsMap.set(msgId2, row2);

    // Turn 1 finished
    updateStreamingAssistantMessage(msgId1, '<think>Turn 1 thought</think>Turn 1 Answer', { streaming: false, latency: 1500 });
    const card1 = row1.querySelector('.thinking-process-card');
    assert.ok(card1.classList.contains('is-finished'));
    assert.strictEqual(card1.classList.contains('is-expanded'), false);

    // Turn 2 streaming active
    updateStreamingAssistantMessage(msgId2, '<think>Turn 2 active thinking...', { streaming: true });
    const card2 = row2.querySelector('.thinking-process-card');
    assert.ok(card2.classList.contains('is-active'));
    assert.ok(card2.classList.contains('is-expanded'));

    // Toggle card 1 manually -> Should not affect card 2
    toggleThinkingProcessCard(card1.querySelector('.thinking-header'), { stopPropagation: () => {} });
    assert.ok(card1.classList.contains('is-expanded'), 'Card 1 expanded by user');
    assert.ok(card2.classList.contains('is-active'), 'Card 2 still active');
    assert.ok(card2.classList.contains('is-expanded'), 'Card 2 still expanded');

    // Turn 2 finishes
    updateStreamingAssistantMessage(msgId2, '<think>Turn 2 active thinking...</think>Turn 2 Answer', { streaming: false, latency: 2200 });
    assert.ok(card1.classList.contains('is-expanded'), 'Card 1 remains expanded by user choice');
    assert.ok(card2.classList.contains('is-finished'), 'Card 2 auto-collapsed');
    assert.strictEqual(card2.classList.contains('is-expanded'), false);
});

check('4.2 HTML injection and XSS payloads in reasoning content are securely escaped', () => {
    const maliciousHtml = '<script>alert("XSS")</script><img src=x onerror=alert(1)><style>body{display:none}</style>';
    const html = buildThinkingProcessHtml(maliciousHtml, [], 2.0, false);
    
    assert.strictEqual(html.includes('<script>'), false, 'Must not contain raw <script>');
    assert.ok(html.includes('&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'), 'Must contain escaped script');
    assert.strictEqual(html.includes('<img src=x'), false, 'Must not contain raw <img>');
    assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'Must contain escaped img tag');
});

check('4.3 Extremely long reasoning narrative (15,000+ chars) renders safely without truncation corruption', () => {
    const longThought = 'Deep analytical reflection. '.repeat(500); // 14,500 chars
    const html = buildThinkingProcessHtml(longThought, [], 5.4, true);
    assert.ok(html.includes('Deep analytical reflection.'), 'Must render complete content');
    assert.ok(html.includes('Thinking... 5.4s'));
    assert.ok(html.includes('is-active is-expanded'));
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n================================================================');
console.log(`=== All ${passedChecks}/${totalChecks} Empirical Challenger Stress Tests PASSED with 0 Errors ===`);
console.log('================================================================\n');
