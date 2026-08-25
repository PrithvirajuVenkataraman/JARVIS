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

// 8. Test Language Switcher & Detection
import { detectSpokenLanguage, detectLanguageSwitchCommand } from '../app/speech-input.js';
const switchedLang = controller.setLanguage('ta-IN');
assert.equal(switchedLang, 'ta-IN');
assert.equal(controller.getState().language, 'ta-IN');

assert.equal(detectSpokenLanguage('வணக்கம் எப்படி இருக்கிறீர்கள்'), 'ta-IN');
assert.equal(detectSpokenLanguage('నమస్కారం ఎలా ఉన్నారు'), 'te-IN');
assert.equal(detectSpokenLanguage('ನಮಸ್ಕಾರ ಹೇಗಿದ್ದೀರಾ'), 'kn-IN');
assert.equal(detectSpokenLanguage('नमस्ते आप कैसे हैं'), 'hi-IN');
assert.equal(detectSpokenLanguage('Hello world'), null);

assert.equal(detectLanguageSwitchCommand('switch to Tamil please'), 'ta-IN');
assert.equal(detectLanguageSwitchCommand('speak in Hindi'), 'hi-IN');
assert.equal(detectLanguageSwitchCommand('change language to Telugu'), 'te-IN');
assert.equal(detectLanguageSwitchCommand('talk in Kannada'), 'kn-IN');
assert.equal(detectLanguageSwitchCommand('switch to English'), 'en-US');

// 9. Test Speech Filler Cleaner
import { cleanSpeechFillers } from '../app/speech-input.js';
assert.equal(cleanSpeechFillers('um hello uh world er'), 'hello world');
assert.equal(cleanSpeechFillers('ah explain more details please'), 'explain more details please');
assert.equal(cleanSpeechFillers('yes sure'), 'yes sure');

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

// 12. Test Elongated Speech Filler Cleaning
assert.equal(cleanSpeechFillers('ummm hello uhhh world errr'), 'hello world');
assert.equal(cleanSpeechFillers('ahhh explain more details please'), 'explain more details please');
assert.equal(cleanSpeechFillers('ermmm wait a second'), 'wait a second');
assert.equal(cleanSpeechFillers('human umbrella summary'), 'human umbrella summary');

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

// 14. Test UI Interim Typing Duplication Prevention
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

const uiCtrl = installSpeechInputUI();
const textInput = globalThis.document.getElementById('text-input');
textInput.value = 'hello';
textInput.dispatchEvent({ type: 'input' });

await globalThis.toggleVoiceToText();
const activeUiRec = FakeRecognition.instances.at(-1);

// Interim result
activeUiRec.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'world how are you' }, isFinal: false }]
});
assert.equal(textInput.value, 'hello world how are you');

// User edits input (adds comma)
textInput.value = 'hello, world how are you';
textInput.dispatchEvent({ type: 'input' });

// Final result arrives
activeUiRec.onresult?.({
    resultIndex: 0,
    results: [{ 0: { transcript: 'world how are you' }, isFinal: true }]
});
assert.equal(textInput.value, 'hello, world how are you');
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

console.log('speech-input-tests-ok');

