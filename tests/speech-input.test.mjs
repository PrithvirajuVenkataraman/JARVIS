import assert from 'node:assert/strict';
import { createSpeechInputController, createWhisperRecorder } from '../app/speech-input.js';

console.log('--- Testing Speech Input & Converse Controller ---');

// 1. Fake Recognition mock
class FakeRecognition {
    static instances = [];

    constructor() {
        FakeRecognition.instances.push(this);
        this.lang = '';
        this.interimResults = false;
        this.continuous = false;
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

// 2. Test Whisper Recorder interface
const whisper = createWhisperRecorder({
    silenceTimeoutMs: 50
});
assert.equal(typeof whisper.start, 'function');
assert.equal(typeof whisper.stop, 'function');
assert.equal(typeof whisper.isSupported, 'function');

// 3. Test Dual Engine Speech Controller with FakeRecognition
const finalEvents = [];
const interimEvents = [];
const states = [];
const errors = [];

const controller = createSpeechInputController({
    Recognition: FakeRecognition,
    language: 'en-US',
    onInterim: text => interimEvents.push(text),
    onFinal: (text, event) => finalEvents.push({ text, ...event }),
    onState: state => states.push(state),
    onError: error => errors.push(error)
});

assert.equal(controller.getState().supported, true);
assert.equal(controller.getState().mode, 'idle');
assert.equal(controller.getState().converseEnabled, false);

// 4. Test Dictation Toggle
const dictStarted = await controller.toggleDictation();
assert.equal(dictStarted, true);
assert.equal(controller.getState().mode, 'dictation');

const activeRec = FakeRecognition.instances.at(-1);
if (activeRec) {
    activeRec.emitResult('test speech transcription', true);
}
controller.stop();
assert.equal(controller.getState().listening, false);

// 5. Test Converse Mode Toggle
const converseStarted = await controller.toggleConverse();
assert.equal(converseStarted, true);
assert.equal(controller.getState().converseEnabled, true);
assert.equal(controller.getState().mode, 'converse');

// 6. Test Processing & Turn State
controller.setProcessing(true);
assert.equal(controller.getState().processing, true);

controller.setProcessing(false);
assert.equal(controller.getState().processing, false);

controller.stop({ disableConverse: true });
assert.equal(controller.getState().converseEnabled, false);

// 7. Test Error Recovery & Bi-directional Fallback
const failController = createSpeechInputController({
    Recognition: FakeRecognition,
    language: 'en-US',
    onError: error => errors.push(error)
});
await failController.toggleConverse();
assert.equal(failController.getState().converseEnabled, true);

const failingRec = FakeRecognition.instances.at(-1);
if (failingRec) {
    // Simulating browser speech service block
    failingRec.emitError('network');
}
// Should maintain converseEnabled without crashing
assert.equal(failController.getState().converseEnabled, true);
failController.stop({ disableConverse: true });
assert.equal(failController.getState().converseEnabled, false);

// 8. Test English-Only Policy Enforcement
import { detectSpokenLanguage, detectLanguageSwitchCommand } from '../app/speech-input.js';
const switchedLang = controller.setLanguage('ta-IN');
assert.equal(switchedLang, 'en-US');
assert.equal(controller.getState().language, 'en-US');

assert.equal(detectSpokenLanguage('Hello world'), 'en-US');
assert.equal(detectLanguageSwitchCommand('switch to English'), null);

// 9. Test Speech Filler Cleaner & Auto-Corrector
import { cleanSpeechFillers } from '../app/speech-input.js';
assert.equal(cleanSpeechFillers('um hello uh world er'), 'Hello world');
assert.equal(cleanSpeechFillers('ah explain more details please'), 'Explain more details please');
assert.equal(cleanSpeechFillers('yes sure'), 'Yes sure');
assert.equal(cleanSpeechFillers('um i dont know like what is the answer'), "I don't know what is the answer");
assert.equal(cleanSpeechFillers('the the algorithm is is optimal'), "The algorithm is optimal");

// 10. Test Dictation onend Natural Completion and Single-Click Restart
const dictTestController = createSpeechInputController({
    Recognition: FakeRecognition,
    language: 'en-US'
});
await dictTestController.toggleDictation();
assert.equal(dictTestController.getState().mode, 'dictation');
const dictRec = FakeRecognition.instances.at(-1);
assert.ok(dictRec);
// Recognition naturally ends after speaker pause
dictRec.onend?.();
assert.equal(dictTestController.getState().mode, 'idle');
assert.equal(dictTestController.getState().listening, false);
// Subsequent single click starts dictation immediately (no double click bug)
const restarted = await dictTestController.toggleDictation();
assert.equal(restarted, true);
assert.equal(dictTestController.getState().mode, 'dictation');
dictTestController.stop();
assert.equal(dictTestController.getState().mode, 'idle');

// 11. Test Whisper cancel method
assert.equal(typeof whisper.cancel, 'function');
whisper.cancel();
assert.equal(whisper.isRecording(), false);

// 12. Test Elongated Speech Filler Cleaning & Auto-Correction
assert.equal(cleanSpeechFillers('ummm hello uhhh world errr'), 'Hello world');
assert.equal(cleanSpeechFillers('ahhh explain more details please'), 'Explain more details please');
assert.equal(cleanSpeechFillers('ermmm wait a second'), 'Wait a second');
assert.equal(cleanSpeechFillers('human umbrella summary'), 'Human umbrella summary');

// 13. Test Early Toggle-Off Does Not Trigger Fallback Whisper Leak
const earlyStopCtrl = createSpeechInputController({
    Recognition: FakeRecognition,
    language: 'en-US'
});
await earlyStopCtrl.toggleDictation();
assert.equal(earlyStopCtrl.getState().listening, true);
assert.equal(earlyStopCtrl.getState().mode, 'dictation');
// Rapid stop before speech arrives
earlyStopCtrl.stop();
assert.equal(earlyStopCtrl.getState().listening, false);
assert.equal(earlyStopCtrl.getState().mode, 'idle');

// 14. Test Live On-Screen Speech Rendering and Clean Prompt Box (Not Stuffed into Composer)
import { installSpeechInputUI } from '../app/speech-input.js';

class MockDOMElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.placeholder = '';
        this.dataset = {};
        this.attributes = {};
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
    setAttribute(name, val) { this.attributes[name] = String(val); }
    getAttribute(name) { return this.attributes[name] || null; }
    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type] || [];
        for (const fn of list) fn(event);
    }
    focus() { this.focused = true; }
}

globalThis._testDomElements = {};
globalThis.document = {
    body: new MockDOMElement('body'),
    getElementById: id => {
        if (!globalThis._testDomElements[id]) {
            globalThis._testDomElements[id] = new MockDOMElement(id);
        }
        return globalThis._testDomElements[id];
    },
    addEventListener: () => {}
};
globalThis.SpeechRecognition = FakeRecognition;
globalThis.addEventListener = () => {};

let liveScreenSpeechUpdates = [];
let submittedTranscripts = [];
globalThis.updateLiveSpeechTranscriptionOnScreen = (text, isInterim, mode) => {
    liveScreenSpeechUpdates.push({ text, isInterim, mode });
};
globalThis.clearLiveSpeechTranscriptionOnScreen = () => {
    liveScreenSpeechUpdates.push({ cleared: true });
};

const uiCtrl = installSpeechInputUI({
    async onSubmit(submission) {
        submittedTranscripts.push(submission);
    }
});
const textInput = globalThis.document.getElementById('text-input');
textInput.value = '';
textInput.dispatchEvent({ type: 'input' });

await globalThis.toggleVoiceToText();
const activeUiRec = FakeRecognition.instances.at(-1);

// Interim result: appears immediately on screen, NOT stuffed into textInput
activeUiRec.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'um what is the capital of france' }, isFinal: false }]
});
assert.equal(textInput.value, '', 'Prompt box must remain clean');
assert.ok(liveScreenSpeechUpdates.length > 0);
assert.equal(liveScreenSpeechUpdates.at(-1).text, 'What is the capital of france');

// Final result arrives: Auto-corrected and submitted directly onto screen
activeUiRec.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'um what is the capital of france' }, isFinal: true }]
});
assert.equal(textInput.value, '', 'Prompt box stays clean on final submit');
assert.ok(submittedTranscripts.length > 0);
assert.equal(submittedTranscripts.at(-1).text, 'What is the capital of france');
assert.equal(submittedTranscripts.at(-1).source, 'vtt');
await globalThis.toggleVoiceToText(); // stop

// 14b. Test Converse Mode toggle via UI without recursion
textInput.value = 'residual input';
const converseToggledOn = await globalThis.toggleConverseMode();
assert.equal(converseToggledOn, true);
assert.equal(textInput.value, '');
assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, true);

const converseToggledOff = await globalThis.toggleConverseMode();
assert.equal(converseToggledOff, false);
assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, false);

// 15. Test Whisper Recorder FileReader Onloadend Network Error Resilience
{
    class MockFileReader {
        readAsDataURL() {
            setTimeout(() => {
                this.result = 'data:audio/webm;base64,' + Buffer.from('mock audio').toString('base64');
                this.onloadend?.();
            }, 5);
        }
    }
    globalThis.FileReader = MockFileReader;
    globalThis.Blob = class {
        constructor(chunks) { this.chunks = chunks; }
    };
    class MockMediaStreamTrack {
        constructor() { this.readyState = 'live'; this.enabled = true; }
        stop() { this.readyState = 'ended'; }
    }
    class MockMediaStream {
        constructor() { this.tracks = [new MockMediaStreamTrack()]; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks; }
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
        globalThis.navigator.mediaDevices = {
            getUserMedia: async () => new MockMediaStream()
        };
    }
    globalThis.MediaRecorder = class {
        static isTypeSupported = () => true;
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
        }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.ondataavailable?.({ data: { size: 100 } });
            this.onstop?.();
        }
    };

    const origFetch = globalThis.fetch;
    // Simulate network rejection
    globalThis.fetch = async () => {
        throw new TypeError('Failed to fetch: Network offline');
    };

    const netErrors = [];
    const netStates = [];
    const netWhisper = createWhisperRecorder({
        onError: err => netErrors.push(err),
        onState: st => netStates.push(st)
    });

    await netWhisper.start();
    netWhisper.stop();

    await new Promise(r => setTimeout(r, 50));
    assert.equal(netErrors.length, 1);
    assert.equal(netErrors[0].code, 'stt_network_error');
    assert.equal(netStates.at(-1).processing, false);

    globalThis.fetch = origFetch;
}

// 13. Test createAudioVisualizer & installSpeechInputUI UI polish
{
    const { createAudioVisualizer, installSpeechInputUI } = await import('../app/speech-input.js');

    // Test DOM mock elements
    class MockElement {
        constructor(id = '') {
            this.id = id;
            const classes = new Set();
            this.classList = {
                add: (c) => classes.add(c),
                remove: (c) => classes.delete(c),
                toggle: (c, val) => {
                    if (val === undefined) {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    } else if (val) {
                        classes.add(c);
                    } else {
                        classes.delete(c);
                    }
                },
                contains: (c) => classes.has(c)
            };
            this.style = {
                setProperty: (k, v) => { this.style[k] = v; }
            };
            this.children = [];
            this.textContent = '';
            this.value = '';
            this.placeholder = '';
            this.dataset = {};
            this.listeners = {};
        }
        appendChild(child) {
            this.children.push(child);
            return child;
        }
        addEventListener(event, fn) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(fn);
        }
        setAttribute(k, v) {
            this[k] = v;
        }
        focus() {}
    }

    const containerEl = new MockElement('vtt-waveform-container');
    const visualizer = createAudioVisualizer(containerEl);
    assert.equal(typeof visualizer.start, 'function');
    assert.equal(typeof visualizer.stop, 'function');

    // Visualizer DOM init
    visualizer.stop();

    // Test installSpeechInputUI
    const textInput = new MockElement('text-input');
    const vttBtn = new MockElement('voice-to-text-btn');
    const statusEl = new MockElement('speech-input-status');
    const composerShell = new MockElement('input-bar-inner');

    globalThis.document = {
        getElementById(id) {
            if (id === 'text-input') return textInput;
            if (id === 'voice-to-text-btn') return vttBtn;
            if (id === 'speech-input-status') return statusEl;
            if (id === 'vtt-waveform-container') return containerEl;
            if (id === 'input-bar-inner') return composerShell;
            return null;
        },
        createElement(tag) {
            return new MockElement(tag);
        },
        addEventListener(event, fn) {}
    };

    const uiController = installSpeechInputUI();
    assert.ok(uiController);

    // Toggle dictation
    await uiController.toggleDictation();
    assert.equal(composerShell.classList.contains('is-voice-active'), true);
    assert.equal(statusEl.textContent, '', 'Status text should not contain prototype Listening text');

    // Stop dictation
    uiController.stop();
    assert.equal(composerShell.classList.contains('is-voice-active'), false);
    assert.equal(statusEl.textContent, '', 'Status text should remain clean');
}

// 18. Test Adaptive Turn Evaluation
import { evaluateTurnCompleteness, sanitizeTextForConverseSpeech, splitConverseSpeechSegments, createTurnTelemetry, createTurnManager } from '../app/converse-state.js';

const terminalRes = evaluateTurnCompleteness('What is the weather today?');
assert.equal(terminalRes.isComplete, true);
assert.equal(terminalRes.recommendedTimeoutMs, 800);
assert.equal(terminalRes.reason, 'terminal_punctuation');

const trailingConjunctionRes = evaluateTurnCompleteness('I want to visit Paris and');
assert.equal(trailingConjunctionRes.isComplete, false);
assert.equal(trailingConjunctionRes.trailingConnector, true);
assert.equal(trailingConjunctionRes.recommendedTimeoutMs, 1800);
assert.equal(trailingConjunctionRes.reason, 'trailing_connector');

const incompleteInterrogativeRes = evaluateTurnCompleteness('What is');
assert.equal(incompleteInterrogativeRes.isComplete, false);
assert.equal(incompleteInterrogativeRes.recommendedTimeoutMs, 1800);

const completePhraseRes = evaluateTurnCompleteness('The capital of France is Paris and it is lovely');
assert.equal(completePhraseRes.isComplete, true);
assert.equal(completePhraseRes.recommendedTimeoutMs, 1200);

// 19. Test Staged Spoken Text Sanitizer
const rawSpokenInput = `
<think>The user is asking for code</think>
Here is the solution:
\`\`\`javascript
console.log("hello");
\`\`\`
The cost is $4.5B and ₹25L [1]. Also 5^2 equals 25.
`;
const sanitized = sanitizeTextForConverseSpeech(rawSpokenInput);
assert.ok(!sanitized.includes('<think>'));
assert.ok(!sanitized.includes('```'));
assert.ok(!sanitized.includes('[1]'));
assert.ok(sanitized.includes('4 point 5 billion dollars'));
assert.ok(sanitized.includes('25 lakh rupees'));
assert.ok(sanitized.includes('5 squared'));
assert.ok(sanitized.includes('The code snippet is displayed on your screen.'));

// 20. Test Split Converse Speech Segments
const speechSegments = splitConverseSpeechSegments('Sentence one. Sentence two! Sentence three?');
assert.equal(speechSegments.length, 3);
assert.equal(speechSegments[0], 'Sentence one.');

// 21. Test Turn Telemetry Tracking
const telemetry = createTurnTelemetry('turn_test_123');
telemetry.mark('sttStart');
telemetry.mark('firstInterim');
telemetry.mark('finalTranscript');
telemetry.mark('requestSent');
telemetry.mark('firstToken');
telemetry.mark('firstTtsAudio');
telemetry.mark('audiblePlayback');
telemetry.mark('firstSpokenWord');
telemetry.mark('turnCompleted');

const metrics = telemetry.getMetrics();
assert.equal(metrics.turnId, 'turn_test_123');
assert.equal(typeof metrics.sttStartToFirstInterimMs, 'number');
assert.equal(typeof metrics.sttStartToFinalTranscriptMs, 'number');
assert.equal(typeof metrics.llmRequestToFirstTokenMs, 'number');
assert.equal(typeof metrics.firstTokenToFirstTtsAudioMs, 'number');

// 22. Test Turn Manager Cancellation
const turnManager = createTurnManager();
const turn1 = turnManager.startNewTurn();
assert.ok(turn1.turnId);
assert.equal(turnManager.isTurnActive(turn1.turnId), true);

const turn2 = turnManager.startNewTurn();
assert.equal(turnManager.isTurnActive(turn1.turnId), false);
assert.equal(turn1.signal.aborted, true);
assert.equal(turnManager.isTurnActive(turn2.turnId), true);

// 23. Test VTT Button Converse Toggle – is-converse-active class and aria-pressed
{
    class MockElement {
        constructor(id = '') {
            this.id = id;
            const classes = new Set();
            this.classList = {
                add: (c) => classes.add(c),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                toggle: (c, val) => {
                    if (val === undefined) {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    } else if (val) {
                        classes.add(c);
                    } else {
                        classes.delete(c);
                    }
                },
                contains: (c) => classes.has(c)
            };
            this.style = { setProperty: () => {} };
            this.children = [];
            this.textContent = '';
            this.value = '';
            this.placeholder = '';
            this.dataset = {};
            this.listeners = {};
            this.attributes = {};
        }
        appendChild(child) { this.children.push(child); return child; }
        addEventListener(event, fn) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(fn);
        }
        setAttribute(k, v) { this.attributes[k] = String(v); }
        getAttribute(k) { return this.attributes[k] || null; }
        focus() {}
    }

    const textInput2 = new MockElement('text-input');
    const vttBtn2 = new MockElement('voice-to-text-btn');
    const statusEl2 = new MockElement('speech-input-status');
    const containerEl2 = new MockElement('vtt-waveform-container');
    const composerShell2 = new MockElement('input-bar-inner');
    const sendBtn2 = new MockElement('send-message-btn');
    const bodyEl = new MockElement('body');

    // Track speechSynthesis calls
    let spokenTexts = [];
    let synthCancelCalls = 0;
    globalThis.speechSynthesis = {
        speaking: false,
        speak(utterance) { spokenTexts.push(utterance.text || utterance._text || ''); },
        cancel() { synthCancelCalls++; }
    };
    globalThis.SpeechSynthesisUtterance = class {
        constructor(text) { this.text = text; this.lang = ''; }
    };

    // Remove navigator.permissions so the permission helper takes the fallback path
    const origNav = globalThis.navigator;
    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                language: 'en-US',
                mediaDevices: { getUserMedia: async () => ({ active: true, getTracks: () => [], getAudioTracks: () => [{ readyState: 'live', enabled: true, stop() {} }] }) }
            },
            configurable: true,
            writable: true
        });
    } catch (_) {}

    globalThis.document = {
        body: bodyEl,
        getElementById(id) {
            if (id === 'text-input') return textInput2;
            if (id === 'voice-to-text-btn') return vttBtn2;
            if (id === 'speech-input-status') return statusEl2;
            if (id === 'vtt-waveform-container') return containerEl2;
            if (id === 'input-bar-inner') return composerShell2;
            if (id === 'send-message-btn') return sendBtn2;
            return null;
        },
        createElement(tag) { return new MockElement(tag); },
        addEventListener() {}
    };

    globalThis.SpeechRecognition = FakeRecognition;
    globalThis.addEventListener = () => {};

    // Fresh install
    const { installSpeechInputUI: installUI2 } = await import('../app/speech-input.js');
    const ctrl2 = installUI2();
    assert.ok(ctrl2, 'installSpeechInputUI should return controller');

    // --- 23a. Activate Converse via toggle ---
    spokenTexts = [];
    synthCancelCalls = 0;
    const activated = await globalThis.toggleConverseMode();
    assert.equal(activated, true, 'toggleConverseMode should return true on activation');

    // VTT button should have is-converse-active class
    assert.equal(vttBtn2.classList.contains('is-converse-active'), true,
        'VTT button should have is-converse-active class when converse is on');

    // ARIA should be updated
    assert.equal(vttBtn2.attributes['aria-pressed'], 'true',
        'VTT button aria-pressed should be true when converse is active');

    // Send button should also have is-converse-active
    assert.equal(sendBtn2.classList.contains('is-converse-active'), true,
        'Send button should have is-converse-active class');

    // Wait for the async greeting (ensureSpeechSynthesisPermission resolves immediately on fallback path)
    await new Promise(r => setTimeout(r, 100));

    // A greeting should have been spoken
    assert.ok(spokenTexts.length > 0, 'A greeting should have been spoken via speechSynthesis');
    const greetings = [
        "Hey, happy to help!",
        "Hi there! I'm ready to assist you.",
        "Hello! How can I help you today?",
        "Greetings! Let me know what you need.",
        "Welcome! Ask me anything.",
        "Hi! I'm here for you.",
        "Hey! Ready when you are.",
        "Hello! What can I do for you?",
        "Hey there! How can I assist?",
        "Hi! Let's get started."
    ];
    assert.ok(greetings.includes(spokenTexts[0]),
        `Spoken greeting "${spokenTexts[0]}" should be from the hardcoded list`);

    // --- 23b. Deactivate Converse ---
    spokenTexts = [];
    const deactivated = await globalThis.toggleConverseMode();
    assert.equal(deactivated, false, 'toggleConverseMode should return false on deactivation');

    // VTT button class should be removed
    assert.equal(vttBtn2.classList.contains('is-converse-active'), false,
        'VTT button should NOT have is-converse-active after deactivation');

    // ARIA should revert
    assert.equal(vttBtn2.attributes['aria-pressed'], 'false',
        'VTT button aria-pressed should be false after deactivation');

    // No new greeting on deactivation
    assert.equal(spokenTexts.length, 0,
        'No greeting should be spoken on deactivation');

    // --- 23c. Re-activate and verify another greeting is spoken ---
    spokenTexts = [];
    const reactivated = await globalThis.toggleConverseMode();
    assert.equal(reactivated, true);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(spokenTexts.length > 0, 'Greeting should be spoken on re-activation');
    assert.ok(greetings.includes(spokenTexts[0]), 'Re-activation greeting from hardcoded list');

    // Clean up
    await globalThis.toggleConverseMode(); // deactivate

    console.log('  [PASS] 23. VTT button converse toggle: class, ARIA, greeting, deactivation');
}

// 24. Test Error Toast on SpeechSynthesis Failure
{
    class MockElement {
        constructor(id = '') {
            this.id = id;
            const classes = new Set();
            this._classes = classes;
            this.classList = {
                add: (c) => classes.add(c),
                remove: (...cs) => cs.forEach(c => classes.delete(c)),
                toggle: (c, val) => {
                    if (val === undefined) {
                        if (classes.has(c)) classes.delete(c);
                        else classes.add(c);
                    } else if (val) classes.add(c);
                    else classes.delete(c);
                },
                contains: (c) => classes.has(c)
            };
            this.style = { setProperty: () => {} };
            this.children = [];
            this.textContent = '';
            this.value = '';
            this.placeholder = '';
            this.dataset = {};
            this.listeners = {};
            this.attributes = {};
        }
        get className() { return [...this._classes].join(' '); }
        set className(val) {
            this._classes.clear();
            String(val).split(/\s+/).filter(Boolean).forEach(c => this._classes.add(c));
        }
        appendChild(child) { this.children.push(child); return child; }
        addEventListener(event, fn) {
            this.listeners[event] = this.listeners[event] || [];
            this.listeners[event].push(fn);
        }
        setAttribute(k, v) { this.attributes[k] = String(v); }
        getAttribute(k) { return this.attributes[k] || null; }
        focus() {}
        remove() { this._removed = true; }
    }

    const bodyEl3 = new MockElement('body');
    const textInput3 = new MockElement('text-input');
    const vttBtn3 = new MockElement('voice-to-text-btn');
    const statusEl3 = new MockElement('speech-input-status');
    const containerEl3 = new MockElement('vtt-waveform-container');
    const composerShell3 = new MockElement('input-bar-inner');
    const sendBtn3 = new MockElement('send-message-btn');

    // Make speechSynthesis.speak throw to trigger error toast
    globalThis.speechSynthesis = {
        speaking: false,
        speak() { throw new Error('Synthesis engine unavailable'); },
        cancel() {}
    };
    globalThis.SpeechSynthesisUtterance = class {
        constructor(text) { this.text = text; this.lang = ''; }
    };

    globalThis.document = {
        body: bodyEl3,
        getElementById(id) {
            if (id === 'text-input') return textInput3;
            if (id === 'voice-to-text-btn') return vttBtn3;
            if (id === 'speech-input-status') return statusEl3;
            if (id === 'vtt-waveform-container') return containerEl3;
            if (id === 'input-bar-inner') return composerShell3;
            if (id === 'send-message-btn') return sendBtn3;
            return null;
        },
        createElement(tag) { return new MockElement(tag); },
        addEventListener() {}
    };

    globalThis.SpeechRecognition = FakeRecognition;
    globalThis.addEventListener = () => {};

    const { installSpeechInputUI: installUI3 } = await import('../app/speech-input.js');
    const ctrl3 = installUI3();
    assert.ok(ctrl3);

    const activated3 = await globalThis.toggleConverseMode();
    assert.equal(activated3, true);

    // Wait for the async permission + speak attempt
    await new Promise(r => setTimeout(r, 150));

    // The toast should have been appended to body
    const toasts = bodyEl3.children.filter(c => c.classList.contains('error-toast'));
    assert.ok(toasts.length > 0, 'An error toast should appear when speechSynthesis.speak throws');
    assert.ok(toasts[0].textContent.includes('Synthesis engine unavailable'),
        'Toast should contain the error message');
    assert.equal(toasts[0].attributes['role'], 'alert',
        'Toast should have role="alert" for accessibility');

    // Cleanup
    await globalThis.toggleConverseMode();

    console.log('  [PASS] 24. Error toast shown when speechSynthesis fails');
}

console.log('speech-input-tests-ok');

