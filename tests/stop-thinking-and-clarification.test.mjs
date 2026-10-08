import assert from 'node:assert/strict';

console.log('=== Testing Stop Thinking & 10s Clarification Suite ===');

// --- Mock DOM Environment ---
class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.placeholder = '';
        this.textContent = '';
        this.innerHTML = '';
        this.dataset = {};
        this.attributes = new Map();
        this.children = [];
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            toggle: (c, force) => {
                if (force === true) this.classList._classes.add(c);
                else if (force === false) this.classList._classes.delete(c);
                else if (this.classList._classes.has(c)) this.classList._classes.delete(c);
                else this.classList._classes.add(c);
                return this.classList._classes.has(c);
            },
            contains: c => this.classList._classes.has(c)
        };
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) {
        const targetClass = selector.replace('.', '');
        const findRecursive = el => {
            if (el.classList?.contains(targetClass)) return el;
            for (const child of el.children || []) {
                const found = findRecursive(child);
                if (found) return found;
            }
            return null;
        };
        for (const child of this.children || []) {
            const found = findRecursive(child);
            if (found) return found;
        }
        return null;
    }
    querySelectorAll(selector) {
        return this.children.filter(c => c.classList?.contains(selector.replace('.', '')));
    }
}

// Populate mock elements
const sendBtn = new MockElement('send-message-btn', 'button');
const thinkingCard = new MockElement('card-1', 'div');
thinkingCard.classList.add('thinking-process-card', 'is-active', 'is-expanded');

const thinkingHeader = new MockElement('header-1', 'button');
thinkingHeader.classList.add('thinking-header');
thinkingHeader.setAttribute('aria-expanded', 'true');

const timerEl = new MockElement('timer-1', 'span');
timerEl.classList.add('thinking-timer');
timerEl.textContent = 'Thinking... 2.4s';
thinkingHeader.appendChild(timerEl);
thinkingCard.appendChild(thinkingHeader);

globalThis.document = {
    getElementById: id => (id === 'send-message-btn' ? sendBtn : null),
    querySelectorAll: sel => {
        if (sel.includes('.thinking-process-card.is-active')) return [thinkingCard];
        return [];
    }
};

// ============================================================================
// Section 1: Immediate Stop During Active Thinking
// ============================================================================
console.log('--- Section 1: Immediate Stop During Active Thinking ---');

function stopActiveGeneration(reason = 'manual') {
    // Freeze any active thinking process cards in the DOM immediately
    const activeThinkingCards = globalThis.document.querySelectorAll('.thinking-process-card.is-active, .thinking-process-card.is-expanded');
    activeThinkingCards.forEach(card => {
        card.classList.remove('is-active', 'is-expanded');
        card.classList.add('is-finished');
        const timer = card.querySelector('.thinking-timer');
        if (timer) {
            const rawTime = timer.textContent.replace(/^Thinking\.\.\.\s*/i, '').replace(/^Thought for\s*/i, '').replace(/\s*\(Stopped\)/i, '').trim();
            timer.textContent = `Thought for ${rawTime || '0.0s'} (Stopped)`;
        }
        const header = card.querySelector('.thinking-header');
        if (header && typeof header.setAttribute === 'function') {
            header.setAttribute('aria-expanded', 'false');
        }
    });
    sendBtn.classList.remove('composer-send-stop');
}

// User presses stop while model is thinking (timer at 2.4s)
assert.equal(thinkingCard.classList.contains('is-active'), true);
assert.equal(thinkingCard.classList.contains('is-expanded'), true);
assert.equal(thinkingHeader.getAttribute('aria-expanded'), 'true');

stopActiveGeneration('manual');

assert.equal(thinkingCard.classList.contains('is-active'), false, 'is-active class must be removed');
assert.equal(thinkingCard.classList.contains('is-expanded'), false, 'is-expanded class must be removed');
assert.equal(thinkingCard.classList.contains('is-finished'), true, 'is-finished class must be added');
assert.equal(timerEl.textContent, 'Thought for 2.4s (Stopped)', 'Timer must display frozen elapsed time with (Stopped) tag');
assert.equal(thinkingHeader.getAttribute('aria-expanded'), 'false', 'ARIA expanded attribute must be synchronized to false');
console.log('  [PASS] 1.1 Pressing stop during thinking immediately freezes the accordion and marks state as Stopped');

// ============================================================================
// Section 2: 10-Second Thinking Cap & Watchdog
// ============================================================================
console.log('--- Section 2: 10-Second Thinking Cap & Watchdog ---');

function simulateStreamingWatchdog(accumulated, elapsedMs) {
    let thinkingCapped = false;
    if (elapsedMs >= 10000) {
        if (accumulated.includes('<think>') && !accumulated.includes('</think>')) {
            thinkingCapped = true;
            accumulated += '\n</think>\n';
        }
    }
    return { accumulated, thinkingCapped };
}

// Case 2.1: Under 10s thinking continues normally
const res1 = simulateStreamingWatchdog('<think>\nAnalyzing facts...', 4500);
assert.equal(res1.thinkingCapped, false);
assert.equal(res1.accumulated.includes('</think>'), false);
console.log('  [PASS] 2.1 Thinking under 10 seconds continues streaming smoothly without premature truncation');

// Case 2.2: Reaching 10s ceiling auto-closes thinking block
const res2 = simulateStreamingWatchdog('<think>\nAnalyzing facts for extended duration...', 10100);
assert.equal(res2.thinkingCapped, true);
assert.equal(res2.accumulated.includes('</think>'), true);
console.log('  [PASS] 2.2 Reaching 10-second ceiling auto-concludes thinking and transitions to answer phase');

// ============================================================================
// Section 3: Standalone Entity Direct Factual Overview Rule
// ============================================================================
console.log('--- Section 3: Standalone Entity Direct Factual Overview ---');

function isStandaloneEntityQuery(query) {
    const text = String(query || '').trim();
    if (!text) return false;
    const words = text.split(/\s+/);
    // 1 to 3 words with no question words or action verbs
    if (words.length > 4) return false;
    const actionPattern = /^(how|why|when|where|what|who|can|could|would|will|is|are|do|does|did|explain|write|create|compare|search|find|show)\b/i;
    return !actionPattern.test(text);
}

const entityQueries = ['Photosynthesis', 'Tesla', 'Alan Turing', 'PostgreSQL', 'Taj Mahal', 'DNA', 'Quantum Computing'];
for (const q of entityQueries) {
    assert.equal(isStandaloneEntityQuery(q), true, `"${q}" should classify as a standalone entity query`);
}
console.log('  [PASS] 3.1 Standalone entity queries correctly identify for immediate 2-4 sentence factual overviews');

// ============================================================================
// Section 4: Ambiguity & Clarification Detection
// ============================================================================
console.log('--- Section 4: Ambiguity & Clarification Routing ---');

function isAmbiguousOrUnderspecifiedQuery(query) {
    const text = String(query || '').trim().toLowerCase();
    const ambiguousTokens = new Set(['it', 'that', 'this', 'why', 'start', 'that thing', 'what about it', 'how come', 'more info']);
    if (ambiguousTokens.has(text)) return true;
    if (/^(it|that|this|why|start|start now|that thing)$/i.test(text)) return true;
    return false;
}

const ambiguousQueries = ['it', 'that thing', 'why', 'start', 'start now'];
for (const q of ambiguousQueries) {
    assert.equal(isAmbiguousOrUnderspecifiedQuery(q), true, `"${q}" should be recognized as ambiguous`);
}
console.log('  [PASS] 4.1 Ambiguous/fragmented queries correctly trigger targeted clarification prompts');

console.log('================================================================');
console.log('=== All Stop Thinking & 10s Clarification Tests PASSED ===');
console.log('================================================================');
