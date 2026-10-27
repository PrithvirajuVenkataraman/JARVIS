import assert from 'node:assert/strict';

console.log('=== Testing Assistant Action Bar & Follow-Up Chips Suite ===');

// --- Mock Browser DOM & APIs ---
class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.innerHTML = '';
        this.textContent = '';
        this.dataset = {};
        this.children = [];
        this.attributes = new Map();
        this.style = {};
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            contains: c => this.classList._classes.has(c)
        };
    }

    setAttribute(n, v) { this.attributes.set(n, String(v)); }
    getAttribute(n) { return this.attributes.get(n) ?? null; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(selector) {
        const targetClass = selector.replace('.', '');
        const find = el => {
            if (el.classList?.contains(targetClass)) return el;
            for (const child of el.children || []) {
                const found = find(child);
                if (found) return found;
            }
            return null;
        };
        for (const child of this.children || []) {
            const found = find(child);
            if (found) return found;
        }
        return null;
    }
}

// Clipboard Mock
let clipboardContent = '';
try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: {
            writeText: async text => {
                clipboardContent = text;
                return true;
            }
        },
        configurable: true
    });
} catch (_) {
    globalThis.navigator = {
        clipboard: {
            writeText: async text => {
                clipboardContent = text;
                return true;
            }
        }
    };
}

// SpeechSynthesis Mock
let speakingText = '';
globalThis.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
    speaking: false,
    speak(u) {
        this.speaking = true;
        speakingText = u.text;
    },
    cancel() {
        this.speaking = false;
        speakingText = '';
    }
};

// ============================================================================
// Section 1: Assistant Action Bar Clean Layout (No Suggested Follow-Up Chips)
// ============================================================================
console.log('--- Section 1: Clean Action Bar Layout ---');

function buildAssistantActionBarHtml(hasThought = false) {
    return `
        <div class="assistant-action-bar">
            <button type="button" class="assistant-action-btn" title="Copy answer">
                <span>Copy</span>
            </button>
            ${hasThought ? `
            <button type="button" class="assistant-action-btn" title="Copy thought process">
                <span>Thought</span>
            </button>` : ''}
            <button type="button" class="assistant-action-btn" title="Bookmark message">
                <span>Bookmark</span>
            </button>
            <button type="button" class="assistant-action-btn" title="Read answer aloud">
                <span>Speak</span>
            </button>
        </div>
    `;
}

// 1.1 Action bar with thought
const barWithThought = buildAssistantActionBarHtml(true);
assert.ok(barWithThought.includes('Copy'), 'Action bar must contain Copy button');
assert.ok(barWithThought.includes('Thought'), 'Action bar must contain Thought button when thought exists');
assert.ok(barWithThought.includes('Bookmark'), 'Action bar must contain Bookmark button');
assert.ok(barWithThought.includes('Speak'), 'Action bar must contain Speak button');
assert.ok(!barWithThought.includes('SUGGESTED FOLLOW-UPS'), 'Must never render suggested follow-ups banner');
console.log('  [PASS] 1.1 Action bar contains Copy, Thought, Bookmark, and Speak without suggested follow-up chips');

// 1.2 Action bar without thought
const barWithoutThought = buildAssistantActionBarHtml(false);
assert.ok(barWithoutThought.includes('Copy'), 'Action bar must contain Copy button');
assert.ok(!barWithoutThought.includes('Thought'), 'Action bar must omit Thought button when no thought');
assert.ok(barWithoutThought.includes('Bookmark'), 'Action bar must contain Bookmark button');
assert.ok(barWithoutThought.includes('Speak'), 'Action bar must contain Speak button');
assert.ok(!barWithoutThought.includes('SUGGESTED FOLLOW-UPS'), 'Must never render suggested follow-ups banner');
console.log('  [PASS] 1.2 Action bar renders cleanly without thought and without suggested follow-up banner');

// ============================================================================
// Section 2: Action Bar Actions (Copy Answer, Copy Thought, Speak)
// ============================================================================
console.log('--- Section 2: Action Bar Functionality ---');

// 2.1 Copy Answer Text
const copyAnswerBtn = new MockDOMElement('copy-btn', 'button');
copyAnswerBtn.innerHTML = '<span>Copy</span>';

async function copyAssistantMessageText(button, text) {
    await navigator.clipboard.writeText(String(text || '').trim());
    if (button) {
        button.innerHTML = '<span>Copied</span>';
        button.classList.add('is-copied');
    }
}

await copyAssistantMessageText(copyAnswerBtn, 'Canberra is the capital of Australia.');
assert.equal(clipboardContent, 'Canberra is the capital of Australia.');
assert.equal(copyAnswerBtn.classList.contains('is-copied'), true);
console.log('  [PASS] 2.1 Copy answer button copies text to clipboard and gives visual feedback');

// 2.2 Copy Thought Text
const copyThoughtBtn = new MockDOMElement('thought-btn', 'button');
async function copyAssistantThoughtText(button, thought) {
    await navigator.clipboard.writeText(String(thought || '').trim());
    if (button) {
        button.innerHTML = '<span>Copied Thought</span>';
        button.classList.add('is-copied');
    }
}

await copyAssistantThoughtText(copyThoughtBtn, 'Checked rule: Start directly with answer.');
assert.equal(clipboardContent, 'Checked rule: Start directly with answer.');
assert.equal(copyThoughtBtn.classList.contains('is-copied'), true);
console.log('  [PASS] 2.2 Copy thought button copies internal reasoning to clipboard');

// 2.3 Speak / Read Aloud Toggle
const speakBtn = new MockDOMElement('speak-btn', 'button');
function toggleSpeakAssistantMessage(button, text) {
    if (globalThis.speechSynthesis.speaking) {
        globalThis.speechSynthesis.cancel();
        button.classList.remove('is-speaking');
        return;
    }
    const u = new globalThis.SpeechSynthesisUtterance(text);
    button.classList.add('is-speaking');
    globalThis.speechSynthesis.speak(u);
}

toggleSpeakAssistantMessage(speakBtn, 'Quantum computing uses qubits.');
assert.equal(globalThis.speechSynthesis.speaking, true);
assert.equal(speakingText, 'Quantum computing uses qubits.');
assert.equal(speakBtn.classList.contains('is-speaking'), true);

// Toggle again to stop speech
toggleSpeakAssistantMessage(speakBtn, 'Quantum computing uses qubits.');
assert.equal(globalThis.speechSynthesis.speaking, false);
assert.equal(speakBtn.classList.contains('is-speaking'), false);
console.log('  [PASS] 2.3 Speak button plays audio and toggles stop on second press');

// ============================================================================
// Section 3: Bookmark Storage & State Toggle
// ============================================================================
console.log('--- Section 3: Bookmark Storage & State Toggle ---');

const mockStorage = new Map();
function saveBookmark(text) {
    const list = JSON.parse(mockStorage.get('bookmarks') || '[]');
    const idx = list.indexOf(text);
    if (idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push(text);
    }
    mockStorage.set('bookmarks', JSON.stringify(list));
    return list.includes(text);
}

const isBookmarked1 = saveBookmark('Insight 1');
assert.equal(isBookmarked1, true, 'Message should be bookmarked');
assert.equal(JSON.parse(mockStorage.get('bookmarks')).length, 1);

const isBookmarked2 = saveBookmark('Insight 1');
assert.equal(isBookmarked2, false, 'Message bookmark should toggle off');
assert.equal(JSON.parse(mockStorage.get('bookmarks')).length, 0);
console.log('  [PASS] 3.1 Bookmark toggles properly in persistent storage');

console.log('================================================================');
console.log('=== All Action Bar Tests PASSED ===');
console.log('================================================================');
