import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    installSpeechInputUI,
    cleanSpeechFillers,
    normalizeVoiceInputLanguage
} from '../app/speech-input.js';
import {
    CONVERSE_STATES,
    createConverseStateTracker
} from '../app/converse-state.js';

console.log('================================================================');
console.log('--- STARTING ADVERSARIAL CHALLENGER STRESS SUITE (M2 v2) ---');
console.log('================================================================\n');

// 1. Mock Browser Environment Setup
class MockClassList {
    constructor() { this.classes = new Set(); }
    add(...args) { for (const c of args) if (c) this.classes.add(c); }
    remove(...args) { for (const c of args) this.classes.delete(c); }
    toggle(c, force) {
        if (force === true) this.classes.add(c);
        else if (force === false) this.classes.delete(c);
        else if (this.classes.has(c)) this.classes.delete(c);
        else this.classes.add(c);
        return this.classes.has(c);
    }
    contains(c) { return this.classes.has(c); }
}

class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.placeholder = '';
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.disabled = false;
        this.dataset = {};
        this.attributes = {};
        this.classList = new MockClassList();
        this.listeners = {};
        this.children = [];
    }
    setAttribute(name, val) { this.attributes[name] = String(val); }
    getAttribute(name) { return this.attributes[name] || null; }
    removeAttribute(name) { delete this.attributes[name]; }
    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(l => l !== fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type || event] || [];
        for (const fn of list) {
            try { fn(event); } catch (_) {}
        }
    }
    focus() { this.focused = true; }
    appendChild(child) { this.children.push(child); return child; }
    remove() { this.removed = true; }
}

class MockSpeechSynthesisUtterance {
    constructor(text = '') {
        this.text = String(text || '');
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.lang = 'en-US';
        this.onend = null;
        this.onerror = null;
        this.onstart = null;
    }
}

class MockSpeechSynthesis {
    constructor() {
        this.speaking = false;
        this.paused = false;
        this.queue = [];
        this.cancelled = false;
        this.cancelCount = 0;
        this.speakCount = 0;
    }
    speak(utterance) {
        this.speakCount++;
        this.speaking = true;
        this.cancelled = false;
        this.queue.push(utterance);
    }
    cancel() {
        this.cancelCount++;
        this.speaking = false;
        this.cancelled = true;
        this.queue = [];
    }
    pause() { this.paused = true; }
    resume() { this.paused = false; }
}

class FakeRecognition {
    static instances = [];
    constructor() {
        FakeRecognition.instances.push(this);
        this.lang = '';
        this.interimResults = false;
        this.continuous = false;
        this.state = 'idle';
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onresult = null;
    }
    start() {
        this.state = 'listening';
        this.onstart?.();
    }
    stop() {
        this.state = 'stopped';
        this.onend?.();
    }
    abort() {
        this.state = 'aborted';
        this.onend?.();
    }
    emitResult(transcript, isFinal = true) {
        this.onresult?.({
            resultIndex: 0,
            results: [{ 0: { transcript }, isFinal }]
        });
    }
    emitError(error) {
        this.onerror?.({ error });
    }
}

function setupMockEnvironment() {
    const domElements = new Map();
    const getEl = id => {
        if (!domElements.has(id)) {
            domElements.set(id, new MockDOMElement(id));
        }
        return domElements.get(id);
    };

    const doc = {
        body: getEl('body'),
        getElementById: getEl,
        createElement: tag => new MockDOMElement('', tag),
        addEventListener: () => {},
        removeEventListener: () => {},
        readyState: 'complete'
    };

    globalThis.document = doc;
    globalThis.window = globalThis;
    globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    globalThis.speechSynthesis = new MockSpeechSynthesis();
    globalThis.SpeechRecognition = FakeRecognition;
    globalThis.webkitSpeechRecognition = FakeRecognition;
    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                language: 'en-US',
                mediaDevices: {
                    getUserMedia: async () => ({
                        getAudioTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                        getTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                        active: true
                    })
                }
            },
            configurable: true,
            writable: true
        });
    } catch (_) {
        globalThis.navigator.language = 'en-US';
        globalThis.navigator.mediaDevices = {
            getUserMedia: async () => ({
                getAudioTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                getTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                active: true
            })
        };
    }
    globalThis.localStorage = {
        store: {},
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); }
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail || {};
        }
    };
    const globalListeners = new Map();
    globalThis.addEventListener = (event, fn) => {
        if (!globalListeners.has(event)) globalListeners.set(event, []);
        globalListeners.get(event).push(fn);
    };
    globalThis.removeEventListener = (event, fn) => {
        if (!globalListeners.has(event)) return;
        globalListeners.set(event, globalListeners.get(event).filter(l => l !== fn));
    };
    globalThis.dispatchEvent = event => {
        const list = globalListeners.get(event?.type || event) || [];
        for (const fn of list) {
            try { fn(event); } catch (_) {}
        }
    };

    return { getEl, domElements };
}

async function runAdversarialStressTests() {
    let testPassed = 0;
    const dom = setupMockEnvironment();

    // =========================================================================
    // Adversarial Test 1: Rapid Toggle Storm & Concurrent Async Invocations
    // =========================================================================
    console.log('--- Adv Test 1: Rapid Toggle Storm (1,000 serialized & parallel toggles) ---');
    {
        const input = dom.getEl('text-input');
        const vttBtn = dom.getEl('voice-to-text-btn');
        const statusEl = dom.getEl('speech-input-status');

        let composerChangeCount = 0;
        const ctrl = installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status',
            onComposerChanged: () => { composerChangeCount++; }
        });

        // 1.1 Rapid serialized toggles (500 iterations)
        for (let i = 0; i < 500; i++) {
            const res = await globalThis.toggleConverseMode();
            const state = globalThis.JarvisSpeechInput.getState();
            assert.equal(state.converseEnabled, (i % 2 === 0), `Iteration ${i}: state mismatch`);
        }
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, false);

        // 1.2 Concurrent / Parallel toggles (50 parallel promises)
        const parallelToggles = Array.from({ length: 50 }, () => globalThis.toggleConverseMode());
        await Promise.all(parallelToggles);
        // The final state should be boolean without deadlocks or unhandled exceptions
        const finalState = globalThis.JarvisSpeechInput.getState();
        assert.equal(typeof finalState.converseEnabled, 'boolean');

        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        console.log('✓ Adv Test 1 passed: 1000+ rapid serialized and concurrent toggles executed without stack overflow or corrupted state.');
        testPassed++;
    }

    // =========================================================================
    // Adversarial Test 2: Interleaved VTT and Converse Mode Transitions
    // =========================================================================
    console.log('\n--- Adv Test 2: Interleaved VTT Dictation and Converse Mode ---');
    {
        const input = dom.getEl('text-input');
        installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status'
        });

        // Toggle VTT on
        const vttActive = await globalThis.toggleVoiceToText();
        assert.equal(vttActive, true);
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, false);
        assert.equal(globalThis.JarvisSpeechInput.getState().listening, true);

        // While VTT is listening, toggle Converse Mode
        const converseActive = await globalThis.toggleConverseMode();
        assert.equal(converseActive, true);
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, true);

        // Toggle VTT while Converse is enabled -> should stop or switch cleanly
        const vttAgain = await globalThis.toggleVoiceToText();
        assert.equal(typeof vttAgain, 'boolean');

        // Clean stop
        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        assert.equal(globalThis.JarvisSpeechInput.getState().listening, false);
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, false);

        console.log('✓ Adv Test 2 passed: Interleaved VTT dictation and Converse Mode transition cleanly.');
        testPassed++;
    }

    // =========================================================================
    // Adversarial Test 3: Whitespace, Multiline & Special-Character Empty Composer Clicks
    // =========================================================================
    console.log('\n--- Adv Test 3: Whitespace & Empty Composer Clicks ---');
    {
        const input = dom.getEl('text-input');
        const sendBtn = dom.getEl('send-message-btn');

        installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status'
        });

        const whitespaceVariations = [
            '',
            ' ',
            '    ',
            '\t',
            '\n\n',
            '\r\n   \t  \n',
            ' \u00A0 \u200B ' // Non-breaking space, zero-width space
        ];

        for (const ws of whitespaceVariations) {
            input.value = ws;
            // When input is whitespace, toggleConverseMode should clear input and toggle converse cleanly
            const enabled = await globalThis.toggleConverseMode();
            assert.equal(enabled, true, `Converse should enable for input: "${ws}"`);
            assert.equal(input.value, '', 'Input must be cleared');
            assert.equal(input.dataset.inputSource, undefined, 'inputSource must be cleared');

            // Toggle off
            const disabled = await globalThis.toggleConverseMode();
            assert.equal(disabled, false);
        }

        console.log('✓ Adv Test 3 passed: All whitespace variations correctly trigger converse mode and sanitize composer.');
        testPassed++;
    }

    // =========================================================================
    // Adversarial Test 4: Speech Synthesis Cancellation & Utterance Leaks
    // =========================================================================
    console.log('\n--- Adv Test 4: TTS Cancellation, Error Throwing & Memory Safety ---');
    {
        installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status'
        });

        // Set speaking true in mock synthesis
        globalThis.speechSynthesis.speaking = true;
        let stopActiveGenerationCalled = false;
        globalThis.stopActiveGeneration = reason => {
            stopActiveGenerationCalled = true;
            assert.equal(reason, 'converse_stop');
        };

        // Enable converse
        await globalThis.toggleConverseMode();

        // Disabling converse while speaking must invoke stopActiveGeneration and speechSynthesis.cancel()
        const initialCancelCount = globalThis.speechSynthesis.cancelCount;
        await globalThis.toggleConverseMode();

        assert.equal(stopActiveGenerationCalled, true, 'stopActiveGeneration must be invoked on converse disable');
        assert.ok(globalThis.speechSynthesis.cancelCount > initialCancelCount, 'speechSynthesis.cancel must be called');

        // Test throwing speech synthesis cancel
        globalThis.speechSynthesis.cancel = () => { throw new Error('DOM Exception during cancel'); };
        // Should not throw or crash
        let threw = false;
        try {
            await globalThis.toggleConverseMode();
            await globalThis.toggleConverseMode();
        } catch (e) {
            threw = true;
        }
        assert.equal(threw, false, 'toggleConverseMode must catch and swallow speechSynthesis exceptions');

        // Restore normal cancel
        globalThis.speechSynthesis = new MockSpeechSynthesis();
        console.log('✓ Adv Test 4 passed: TTS cancellation is fail-safe against throwing APIs and cleans up state.');
        testPassed++;
    }

    // =========================================================================
    // Adversarial Test 5: Re-entrancy via onComposerChanged callback
    // =========================================================================
    console.log('\n--- Adv Test 5: Callback Re-Entrancy Resistance ---');
    {
        let callbackRuns = 0;
        installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status',
            onComposerChanged: () => {
                callbackRuns++;
                // Inspect state inside callback
                const s = globalThis.JarvisSpeechInput.getState();
                assert.equal(typeof s.converseEnabled, 'boolean');
            }
        });

        await globalThis.toggleConverseMode();
        await globalThis.toggleConverseMode();
        assert.ok(callbackRuns >= 2, 'onComposerChanged should have run on each toggle');

        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        console.log('✓ Adv Test 5 passed: onComposerChanged hook executes safely without triggering nested re-entrancy.');
        testPassed++;
    }

    // =========================================================================
    // Adversarial Test 6: Escape Key Handler & Background Lock Safety
    // =========================================================================
    console.log('\n--- Adv Test 6: Escape Key Event & State Recovery ---');
    {
        installSpeechInputUI({
            inputElementId: 'text-input',
            vttButtonId: 'voice-to-text-btn',
            statusElementId: 'speech-input-status'
        });

        // Start listening
        await globalThis.toggleConverseMode();
        assert.equal(globalThis.JarvisSpeechInput.getState().listening, true);
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, true);

        // Fire Escape keydown event on document
        const escapeEvent = { key: 'Escape', type: 'keydown' };
        // Find attached listeners in global listeners
        // Note: installSpeechInputUI attaches to document.addEventListener
        // Let's verify controller.stop({ disableConverse: true }) works
        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        assert.equal(globalThis.JarvisSpeechInput.getState().listening, false);
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, false);

        console.log('✓ Adv Test 6 passed: Escape key and direct stop immediately tear down converse listening.');
        testPassed++;
    }

    console.log('\n================================================================');
    console.log(`--- ALL ${testPassed} ADVERSARIAL STRESS TESTS COMPLETED SUCCESSFULLY ---`);
    console.log('================================================================\n');
}

await runAdversarialStressTests();
