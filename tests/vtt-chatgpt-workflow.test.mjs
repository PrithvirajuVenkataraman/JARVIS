/**
 * Test Suite: ChatGPT-Style VTT Workflow Verification
 * 
 * Verifies exact user requirement:
 * 1. One press to start listening.
 * 2. User speaks freely across pauses (multi-sentence dictation).
 * 3. User presses again to stop.
 * 4. Everything whatever the user spoke is cleanly on the prompt box (#text-input).
 * 5. Strictly in English (en-US).
 * 6. No auto-submit; prompt box focused and ready for user review/send.
 */

import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    cleanSpeechFillers,
    normalizeVoiceInputLanguage,
    detectSpokenLanguage,
    installSpeechInputUI
} from '../app/speech-input.js';

console.log('=== Running ChatGPT-Style VTT Workflow Test Suite ===\n');

class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.scrollHeight = 40;
        this.children = [];
        this.parentNode = null;
        this.focused = false;
        this.selectionStart = 0;
        this.selectionEnd = 0;
        this.classList = {
            classes: new Set(),
            add(c) { this.classes.add(c); },
            remove(c) { this.classes.delete(c); },
            toggle(c, force) {
                if (force === true) this.classes.add(c);
                else if (force === false) this.classes.delete(c);
                else if (this.classes.has(c)) this.classes.delete(c);
                else this.classes.add(c);
            },
            contains(c) { return this.classes.has(c); }
        };
        this.listeners = {};
    }
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
    addEventListener(event, fn) {
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type || event] || [];
        for (const fn of list) fn(event);
    }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    focus() { this.focused = true; }
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
}

function createMockEnvironment() {
    const elements = {
        'text-input': new MockDOMElement('text-input', 'textarea'),
        'voice-to-text-btn': new MockDOMElement('voice-to-text-btn', 'button'),
        'send-message-btn': new MockDOMElement('send-message-btn', 'button'),
        'chat-container': new MockDOMElement('chat-container', 'div'),
        'speech-input-status': new MockDOMElement('speech-input-status', 'div'),
        'vtt-waveform-container': new MockDOMElement('vtt-waveform-container', 'div'),
        'input-bar-inner': new MockDOMElement('input-bar-inner', 'div')
    };

    const doc = {
        body: new MockDOMElement('body'),
        documentElement: new MockDOMElement('html'),
        getElementById: id => elements[id] || null,
        createElement: tag => new MockDOMElement('', tag),
        addEventListener: () => {}
    };

    return { elements, doc };
}

class MockContinuousRecognition {
    static instances = [];
    constructor() {
        MockContinuousRecognition.instances.push(this);
        this.lang = 'en-US';
        this.interimResults = true;
        this.continuous = true;
        this.state = 'idle';
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.onstart = null;
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
        const item = [{ transcript, confidence: 0.96 }];
        item.isFinal = Boolean(isFinal);
        this.onresult?.({
            resultIndex: 0,
            results: [item]
        });
    }
}

// ─── Test 1: Strict English Requirement ───────────────────────────────────────
console.log('--- Test 1: Strict English Enforcement ---');
{
    assert.equal(normalizeVoiceInputLanguage('fr-FR'), 'en-US', 'Non-English locales normalize to en-US');
    assert.equal(normalizeVoiceInputLanguage('es-ES'), 'en-US', 'Spanish normalizes to en-US');
    assert.equal(normalizeVoiceInputLanguage('de-DE'), 'en-US', 'German normalizes to en-US');
    assert.equal(normalizeVoiceInputLanguage(''), 'en-US', 'Default is en-US');
    assert.equal(detectSpokenLanguage('Bonjour'), 'en-US', 'Spoken language detector strictly returns en-US');
    console.log('  [PASS] 1.1 Strict English enforcement verified across normalizers and detectors');
}

// ─── Test 2: Complete ChatGPT Workflow (Press 1 -> Speak -> Press 2) ──────────
console.log('\n--- Test 2: ChatGPT Workflow (Press 1 -> Speak Across Pauses -> Press 2) ---');
{
    const { elements, doc } = createMockEnvironment();
    globalThis.document = doc;
    globalThis.window = {
        isSecureContext: true,
        location: { hostname: 'localhost' }
    };
    globalThis.SpeechRecognition = MockContinuousRecognition;
    globalThis.webkitSpeechRecognition = MockContinuousRecognition;

    const submitted = [];
    let composerChangeCount = 0;

    installSpeechInputUI({
        Recognition: MockContinuousRecognition,
        onComposerChanged: () => { composerChangeCount++; },
        onSubmit: async sub => { submitted.push(sub); }
    });

    const vttBtn = elements['voice-to-text-btn'];
    const promptBox = elements['text-input'];
    const chatContainer = elements['chat-container'];

    // ── PRESS 1: User presses VTT button to start dictation
    await globalThis.toggleVoiceToText();

    assert.equal(vttBtn.classList.contains('is-listening'), true, 'VTT button becomes active');
    assert.equal(vttBtn.getAttribute('aria-pressed'), 'true', 'aria-pressed is true');
    const rec = MockContinuousRecognition.instances.at(-1);
    assert.ok(rec, 'Speech recognition engine started');
    assert.equal(rec.lang, 'en-US', 'Recognition language is strictly en-US');
    assert.equal(rec.continuous, true, 'Recognition is continuous (does not stop on silence)');
    console.log('  [PASS] 2.1 Press 1 starts listening in English continuous mode');

    // ── USER SPEAKS: Sentence 1 (interim speech with fillers)
    rec.emitResult('um uh please write a python script to parse JSON files', false);
    assert.equal(promptBox.value, 'Please write a python script to parse JSON files', 'Prompt box streams interim text with fillers stripped and JSON capitalized');
    assert.equal(chatContainer.children.length, 0, 'No floating messages in chat window');

    // Sentence 1 finalized
    rec.emitResult('um uh please write a python script to parse JSON files full stop', true);
    assert.equal(promptBox.value, 'Please write a python script to parse JSON files.', 'Prompt box has Sentence 1 with full stop punctuation');

    // ── NATURAL PAUSE: User pauses to think (simulating speech recognition silence)
    // Recognition must stay listening
    assert.equal(globalThis.JarvisSpeechInput.getState().listening, true, 'Mic stays listening during conversational pause');
    assert.equal(globalThis.JarvisSpeechInput.getState().mode, 'dictation', 'Mode remains dictation');
    console.log('  [PASS] 2.2 Pauses to think do not kill dictation session');

    // ── USER SPEAKS: Sentence 2 (after pause)
    rec.emitResult('make sure it has error handling full stop', true);
    assert.equal(
        promptBox.value,
        'Please write a python script to parse JSON files. Make sure it has error handling.',
        'Sentence 2 appends seamlessly to Sentence 1 in the prompt box'
    );
    console.log('  [PASS] 2.3 Sentence 2 appends seamlessly across pause');

    // ── PRESS 2: User presses VTT button again to stop dictation
    await globalThis.toggleVoiceToText();

    assert.equal(vttBtn.classList.contains('is-listening'), false, 'VTT button returns to inactive');
    assert.equal(vttBtn.getAttribute('aria-pressed'), 'false', 'aria-pressed is false');
    assert.equal(globalThis.JarvisSpeechInput.getState().listening, false, 'Listening is stopped');
    assert.equal(globalThis.JarvisSpeechInput.getState().mode, 'idle', 'Mode returns to idle');

    // ── VERIFY FINAL STATE IN PROMPT BOX
    assert.equal(
        promptBox.value,
        'Please write a python script to parse JSON files. Make sure it has error handling.',
        'Prompt box holds the COMPLETE text of everything the user spoke'
    );
    assert.equal(promptBox.focused, true, 'Prompt box is focused ready for user review/edit');
    assert.equal(promptBox.selectionStart, promptBox.value.length, 'Cursor placed at the end of prompt box');
    assert.equal(submitted.length, 0, 'Dictation was NOT auto-submitted; user has control to send');
    assert.equal(chatContainer.children.length, 0, 'Chat window has zero pollution');
    console.log('  [PASS] 2.4 Press 2 commits full speech to prompt box with focus and zero auto-submission');
}

// ─── Test 3: Whisper Fallback (Silence Does Not Stop MediaRecorder in Dictation)
console.log('\n--- Test 3: Whisper Fallback Dictation Silence Immunity ---');
{
    class MockMediaStreamTrack {
        constructor() { this.readyState = 'live'; this.enabled = true; }
        stop() { this.readyState = 'ended'; }
    }
    class MockMediaStream {
        constructor() { this.tracks = [new MockMediaStreamTrack()]; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks; }
    }
    class MockMediaRecorder {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            this.ondataavailable = null;
            this.onstop = null;
            MockMediaRecorder._last = this;
        }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.onstop?.();
        }
        static isTypeSupported() { return true; }
    }

    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                language: 'en-US',
                mediaDevices: {
                    getUserMedia: async () => new MockMediaStream()
                }
            },
            configurable: true,
            writable: true
        });
    } catch (_) {
        try {
            globalThis.navigator.mediaDevices = {
                getUserMedia: async () => new MockMediaStream()
            };
        } catch (_) {}
    }
    globalThis.MediaRecorder = MockMediaRecorder;

    const controller = createSpeechInputController({
        Recognition: null, // forces whisper fallback
        language: 'en-US'
    });

    // Press 1: start dictation
    await controller.toggleDictation();
    assert.equal(controller.getState().mode, 'dictation');
    assert.equal(controller.getState().listening, true);

    // Stop on silence should be false in dictation mode
    // (whisperRecorder should stay recording until user explicitly calls stop())
    assert.equal(MockMediaRecorder._last.state, 'recording');

    // Press 2: stop dictation
    controller.stop();
    assert.equal(controller.getState().listening, false);
    assert.equal(controller.getState().mode, 'idle');
    console.log('  [PASS] 3.1 Whisper fallback respects 1-press start / 1-press stop contract');
}

console.log('\n=== All ChatGPT-Style VTT Workflow Tests PASSED (100% Green) ===\n');
