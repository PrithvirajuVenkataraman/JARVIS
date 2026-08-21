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
// Section 1: Contextual Follow-Up Suggestion Generation
// ============================================================================
console.log('--- Section 1: Dynamic Contextual Follow-Up Suggestions ---');

function generateContextualFollowUpChips(userPrompt, answerText) {
    const p = String(userPrompt || '').toLowerCase();
    const a = String(answerText || '').toLowerCase();
    
    // Code / programming context
    if (/```|function|const |def |class |import |async |select |<html|sql|javascript|python/i.test(answerText) ||
        /\b(code|function|program|script|regex|sql|query|api|component|bug|error)\b/i.test(p)) {
        return [
            'Add comments and explanations',
            'Write unit tests for this',
            'Can we optimize this further?'
        ];
    }
    
    // Comparison context
    if (/\b(compare|versus|vs|difference|better|pros and cons)\b/i.test(p)) {
        return [
            'Which one is better for beginners?',
            'Give a real-world use case example',
            'Summary table of key trade-offs'
        ];
    }
    
    // Factual / Explain context
    if (/\b(explain|how does|what is|why is|who was|history|tell me about|capital|country)\b/i.test(p)) {
        return [
            'Give a concrete example',
            'Explain more simply',
            'What are the key takeaways?'
        ];
    }
    
    // Default smart chips
    return [
        'Tell me more about this',
        'Summarize in 3 bullet points',
        'What is an alternative viewpoint?'
    ];
}

// 1.1 Coding context
const codeChips = generateContextualFollowUpChips('write a python script to parse json', '```python\nimport json\n```');
assert.deepEqual(codeChips, [
    'Add comments and explanations',
    'Write unit tests for this',
    'Can we optimize this further?'
]);
console.log('  [PASS] 1.1 Code context produces relevant developer follow-ups');

// 1.2 Comparison context
const compareChips = generateContextualFollowUpChips('compare React vs Vue for modern web apps', 'Both React and Vue are popular frontend frameworks...');
assert.deepEqual(compareChips, [
    'Which one is better for beginners?',
    'Give a real-world use case example',
    'Summary table of key trade-offs'
]);
console.log('  [PASS] 1.2 Comparison query produces trade-off and use-case follow-ups');

// 1.3 Factual / Concept context
const factChips = generateContextualFollowUpChips('what is quantum computing', 'Quantum computing leverages superposition and entanglement...');
assert.deepEqual(factChips, [
    'Give a concrete example',
    'Explain more simply',
    'What are the key takeaways?'
]);
console.log('  [PASS] 1.3 Concept/Fact query produces explainer follow-ups');

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
// Section 3: Follow-Up Chip Submission
// ============================================================================
console.log('--- Section 3: Follow-Up Chip Submission ---');

let dispatchedSubmission = null;
const textInput = new MockDOMElement('text-input', 'textarea');

globalThis.document = {
    getElementById: id => (id === 'text-input' ? textInput : null)
};

function triggerFollowUpChip(chipText) {
    const input = document.getElementById('text-input');
    if (input) {
        input.value = chipText;
    }
    dispatchedSubmission = { source: 'followup_chip', text: chipText };
}

triggerFollowUpChip('Give a concrete example');
assert.equal(textInput.value, 'Give a concrete example');
assert.equal(dispatchedSubmission.source, 'followup_chip');
assert.equal(dispatchedSubmission.text, 'Give a concrete example');
console.log('  [PASS] 3.1 Clicking follow-up chip immediately loads and dispatches the query');

console.log('================================================================');
console.log('=== All Action Bar & Follow-Up Chips Tests PASSED ===');
console.log('================================================================');
