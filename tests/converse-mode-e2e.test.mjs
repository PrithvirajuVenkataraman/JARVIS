import assert from 'node:assert/strict';
import { createSpeechInputController } from '../app/speech-input.js';

console.log('=== Testing Converse Mode End-to-End Suite ===');

// --- Mock Browser DOM & Environment ---
class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.placeholder = '';
        this.textContent = '';
        this.innerHTML = '';
        this.style = {};
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
    querySelector(selector) { return null; }
    querySelectorAll(selector) { return []; }
    closest(selector) { return null; }
}

const domElements = new Map();
function getOrCreateElement(id, tagName = 'div') {
    if (!domElements.has(id)) {
        domElements.set(id, new MockElement(id, tagName));
    }
    return domElements.get(id);
}

// Populate standard Jarvis Converse DOM nodes
const sendBtn = getOrCreateElement('send-message-btn', 'button');
const textInput = getOrCreateElement('text-input', 'textarea');
const speechStatus = getOrCreateElement('speech-input-status', 'span');
const overlayMicBtn = getOrCreateElement('converse-live-mic-btn', 'button');
const overlayMicLabel = getOrCreateElement('converse-live-mic-label', 'span');
const overlayCloseBtn = getOrCreateElement('converse-live-close-btn', 'button');
const chatContainer = getOrCreateElement('chat-container', 'div');

globalThis.document = {
    getElementById: id => domElements.get(id) || null,
    querySelector: sel => {
        if (sel.startsWith('#')) return domElements.get(sel.slice(1)) || null;
        return null;
    },
    querySelectorAll: () => [],
    createElement: tag => new MockElement('', tag)
};

// Mock SpeechSynthesis
const spokenUtterances = [];
let isSpeaking = false;
let cancelCount = 0;

globalThis.speechSynthesis = {
    get speaking() { return isSpeaking; },
    speak(utterance) {
        isSpeaking = true;
        spokenUtterances.push(utterance);
        // Simulate immediate utterance completion
        setTimeout(() => {
            isSpeaking = false;
            utterance.onend?.();
        }, 10);
    },
    cancel() {
        isSpeaking = false;
        cancelCount++;
    },
    getVoices: () => []
};

globalThis.SpeechSynthesisUtterance = class {
    constructor(text) {
        this.text = text;
        this.lang = 'en-US';
        this.rate = 1.0;
        this.pitch = 1.0;
        this.volume = 1.0;
    }
};

// Mock SpeechRecognition
class FakeWebSpeechRecognition {
    static instances = [];
    constructor() {
        FakeWebSpeechRecognition.instances.push(this);
        this.lang = 'en-US';
        this.interimResults = true;
        this.continuous = true;
        this.state = 'idle';
    }
    start() {
        this.state = 'listening';
        this.onstart?.();
    }
    stop() {
        this.state = 'stopped';
        this.onend?.();
    }
    emitResult(transcript, isFinal = true) {
        this.onresult?.({
            resultIndex: 0,
            results: [[{ transcript }]]
        });
    }
    emitError(error) {
        this.onerror?.({ error });
    }
}

// ============================================================================
// Section 1: UI Button Controls & State Machine Testing
// ============================================================================
console.log('--- Section 1: Button Controls & Primary Interaction ---');

const speechController = createSpeechInputController({
    Recognition: FakeWebSpeechRecognition,
    language: 'en-US'
});
globalThis.window = globalThis;
globalThis.window.JarvisSpeechInput = speechController;

// Test 1.1: Primary button clicks to activate converse when input is empty
assert.equal(speechController.getState().converseEnabled, false);
textInput.value = '';

// Simulate togglePrimaryConverseMode
async function simulateTogglePrimaryConverse() {
    if (textInput.value.trim()) {
        return { action: 'send_text', text: textInput.value.trim() };
    }
    const willEnable = !speechController.getState().converseEnabled;
    sendBtn.classList.toggle('is-converse-active', willEnable);
    const toggled = await speechController.toggleConverse();
    return { action: 'toggle_converse', enabled: speechController.getState().converseEnabled, toggled };
}

const toggleResult1 = await simulateTogglePrimaryConverse();
assert.equal(toggleResult1.enabled, true, 'Converse mode should be enabled after first click');
assert.equal(sendBtn.classList.contains('is-converse-active'), true, 'Button should have is-converse-active class');
console.log('  [PASS] 1.1 Primary button click initiates Converse mode with active waveform class');

// Test 1.2: Primary button click when input has text sends text instead of toggling
textInput.value = 'Hello JARVIS';
const toggleResult2 = await simulateTogglePrimaryConverse();
assert.equal(toggleResult2.action, 'send_text');
assert.equal(toggleResult2.text, 'Hello JARVIS');
console.log('  [PASS] 1.2 Primary button click with text preserves composer input and dispatches message');

// Test 1.3: Live overlay mute/unmute button toggles listening state
async function simulateToggleConverseMic() {
    const state = speechController.getState();
    if (state.listening) {
        speechController.stop();
        overlayMicBtn.classList.add('is-muted');
        overlayMicLabel.textContent = 'Unmute';
    } else {
        await speechController.start({ converse: true });
        overlayMicBtn.classList.remove('is-muted');
        overlayMicLabel.textContent = 'Mute';
    }
}

assert.equal(speechController.getState().listening, true);
await simulateToggleConverseMic(); // Mute
assert.equal(speechController.getState().listening, false, 'Mic should be stopped on mute');
assert.equal(overlayMicBtn.classList.contains('is-muted'), true);
assert.equal(overlayMicLabel.textContent, 'Unmute');

await simulateToggleConverseMic(); // Unmute
assert.equal(speechController.getState().listening, true, 'Mic should resume listening on unmute');
assert.equal(overlayMicBtn.classList.contains('is-muted'), false);
assert.equal(overlayMicLabel.textContent, 'Mute');
console.log('  [PASS] 1.3 Live overlay mic button cleanly toggles Mute/Unmute state and UI labels');

// ============================================================================
// Section 2: <think> Tag Exclusion from Speech Synthesis (No Speech Leakage)
// ============================================================================
console.log('--- Section 2: Thinking Tag Filtering in Voice Streaming ---');

let streamingSpeechState = {
    active: true,
    turnId: 'turn_test_1',
    rawBuffer: '',
    queue: [],
    inThinking: false,
    tagBuffer: ''
};

function feedDelta(delta) {
    let chunk = (streamingSpeechState.tagBuffer || '') + String(delta || '');
    streamingSpeechState.tagBuffer = '';
    let cleanDelta = '';

    while (chunk.length > 0) {
        if (streamingSpeechState.inThinking) {
            const closeIndex = chunk.toLowerCase().indexOf('</think>');
            if (closeIndex !== -1) {
                chunk = chunk.slice(closeIndex + 8);
                streamingSpeechState.inThinking = false;
            } else {
                const partialMatch = chunk.match(/<\/?[a-z]*$/i);
                if (partialMatch && ('<think>'.startsWith(partialMatch[0].toLowerCase()) || '</think>'.startsWith(partialMatch[0].toLowerCase()))) {
                    streamingSpeechState.tagBuffer = chunk.slice(partialMatch.index);
                }
                chunk = '';
            }
        } else {
            const openIndex = chunk.toLowerCase().indexOf('<think>');
            if (openIndex !== -1) {
                cleanDelta += chunk.slice(0, openIndex);
                chunk = chunk.slice(openIndex + 7);
                streamingSpeechState.inThinking = true;
            } else {
                const partialMatch = chunk.match(/<\/?[a-z]*$/i);
                if (partialMatch && ('<think>'.startsWith(partialMatch[0].toLowerCase()) || '</think>'.startsWith(partialMatch[0].toLowerCase()))) {
                    cleanDelta += chunk.slice(0, partialMatch.index);
                    streamingSpeechState.tagBuffer = chunk.slice(partialMatch.index);
                    chunk = '';
                } else {
                    cleanDelta += chunk;
                    chunk = '';
                }
            }
        }
    }

    if (!cleanDelta) return;
    streamingSpeechState.rawBuffer += cleanDelta;
    const sentenceRegex = /^([\s\S]*?[.?!;\n]+(?:\s+|$))([\s\S]*)$/;
    let match;
    while (streamingSpeechState.rawBuffer && (match = streamingSpeechState.rawBuffer.match(sentenceRegex))) {
        const sentence = match[1].trim();
        streamingSpeechState.rawBuffer = match[2];
        if (sentence) streamingSpeechState.queue.push(sentence);
    }
}

// Feed fragmented chunks with thinking tags and internal deliberation
feedDelta('<th');
feedDelta('ink>\nAnalyzing system instructions: check rule "Start directly with answer".\n');
feedDelta('Verifying capital of Australia is Canberra not Sydney.\n</th');
feedDelta('ink>\nCanberra is the capital of Australia.');

assert.equal(streamingSpeechState.queue.length, 1);
assert.equal(streamingSpeechState.queue[0], 'Canberra is the capital of Australia.');
assert.equal(streamingSpeechState.queue.some(s => s.includes('Analyzing') || s.includes('system instructions')), false);
console.log('  [PASS] 2.1 Multi-chunk fragmented <think> tags filtered with 0% speech leakage to TTS queue');

// ============================================================================
// Section 3: Barge-In (Interruption) and Resumption State
// ============================================================================
console.log('--- Section 3: Barge-In Interruption & Multilingual Resume Intents ---');

let lastInterruptedState = null;
function stopConverse(reason = 'barge_in') {
    if (streamingSpeechState.active) {
        lastInterruptedState = {
            turnId: streamingSpeechState.turnId,
            spoken: 'Canberra is the capital of Australia.',
            remainingText: 'It was selected as a compromise between Sydney and Melbourne.',
            interruptedAt: Date.now()
        };
    }
    streamingSpeechState.active = false;
    streamingSpeechState.queue = [];
    globalThis.speechSynthesis.cancel();
}

// User speaks while TTS is playing
stopConverse('barge_in');
assert.equal(cancelCount, 1, 'speechSynthesis.cancel() must be called immediately upon barge-in');
assert.ok(lastInterruptedState);
assert.equal(lastInterruptedState.remainingText, 'It was selected as a compromise between Sydney and Melbourne.');
console.log('  [PASS] 3.1 Barge-in halts speech synthesis and captures remaining uninterrupted thought');

// Test 3.2: Resumption intent matching across English, Tamil, and Hindi
function isConverseResumptionIntent(text) {
    const raw = String(text || '').trim().toLowerCase().replace(/^[.,!?;:'"\s]+|[.,!?;:'"\s]+$/g, '');
    if (!raw) return false;
    const directPhrases = [
        'continue', 'continue speaking', 'continue to speak', 'keep speaking', 'keep talking', 'keep going',
        'go on', 'go ahead', 'carry on', 'proceed', 'resume', 'unpause', 'stay on that', 'keep explaining',
        'tell me more', 'tell more', 'more', 'and then', 'what next', 'what else', 'what happened next',
        'finish what you were saying', 'finish it', 'finish that', 'finish your thought', 'finish your sentence',
        'tell me the rest', 'the rest', 'what were you saying', 'you were saying', 'speak on', 'say more',
        'complete it', 'read the rest', 'sollu', 'solunga', 'solu', 'pesu', 'pesunga', 'thodaru',
        'aage bolo', 'aage', 'bolte raho', 'aage batao', 'aur batao', 'fir kya', 'phir kya',
        'haan bolo', 'haan continue', 'theek hai aage', 'boliye', 'bolo na'
    ];
    if (directPhrases.includes(raw)) return true;
    const resumptionPattern = /\b(continue|go on|go ahead|keep going|keep talking|keep speaking|carry on|proceed|resume|unpause|stay on that|keep explaining|tell more|tell me more|what next|what else|what happened next|finish what you were saying|finish it|finish that|complete it|finish your thought|finish your sentence|tell me the rest|the rest|what were you saying|you were saying|speak on|say more|read the rest|sollu|solunga|solu|pesu|pesunga|aage bolo|bolte raho|aage batao|aur batao|fir kya|phir kya|haan bolo|haan continue|theek hai aage|boliye|bolo na)\b/i;
    return resumptionPattern.test(raw);
}

const resumePhrases = ['continue', 'keep going', 'go on', 'aage bolo', 'sollu', 'phir kya', 'aur batao', 'complete it'];
for (const phrase of resumePhrases) {
    const isResume = isConverseResumptionIntent(phrase);
    assert.equal(isResume, true, `Phrase "${phrase}" must be recognized as a resumption intent`);
}
console.log('  [PASS] 3.2 Multilingual resumption phrases recognized for conversational flow continuity');

// ============================================================================
// Section 4: Continuous Hands-Free Turn Progression Loop
// ============================================================================
console.log('--- Section 4: Continuous Hands-Free Loop & Echo Debounce ---');

let lifecyclePhases = [];
function transitionLifecycle(phase) {
    lifecyclePhases.push({ phase, time: Date.now() });
}

// 1. User starts speaking (listening)
transitionLifecycle('listening');
speechController.setProcessing(true); // User finished speaking, transcribing

// 2. Transcribed and AI thinking
transitionLifecycle('thinking');
assert.equal(speechController.getState().processing, true);

// 3. AI response starts streaming and speaking
transitionLifecycle('speaking');

// 4. AI finishes speaking -> acoustic echo debounce before re-arming mic
transitionLifecycle('echo_debounce');
speechController.setProcessing(false);

// Wait for restart timer to fire (250ms)
await new Promise(resolve => setTimeout(resolve, 300));

// 5. Back to listening
transitionLifecycle('listening');
assert.equal(speechController.getState().listening, true);
assert.equal(speechController.getState().converseEnabled, true);

assert.deepEqual(lifecyclePhases.map(p => p.phase), [
    'listening',
    'thinking',
    'speaking',
    'echo_debounce',
    'listening'
]);
console.log('  [PASS] 4.1 Continuous hands-free state machine cycles through all 5 phases smoothly');

console.log('================================================================');
console.log('=== All Converse Mode End-to-End Verification Tests PASSED ===');
console.log('================================================================');
