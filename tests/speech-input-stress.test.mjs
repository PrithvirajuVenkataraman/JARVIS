import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    createWhisperRecorder,
    installSpeechInputUI,
    cleanSpeechFillers,
    normalizeVoiceInputLanguage
} from '../app/speech-input.js';

console.log('=== Empirical Stress & Adversarial Challenge Suite for Speech Input & Converse ===\n');

// Track and MediaStream mocks
class MockMediaStreamTrack {
    constructor(kind = 'audio') {
        this.kind = kind;
        this.enabled = true;
        this.readyState = 'live';
        this.stopped = false;
    }
    stop() {
        this.readyState = 'ended';
        this.stopped = true;
    }
}

class MockMediaStream {
    constructor() {
        this.active = true;
        this.tracks = [new MockMediaStreamTrack('audio')];
    }
    getTracks() {
        return this.tracks;
    }
    getAudioTracks() {
        return this.tracks.filter(t => t.kind === 'audio');
    }
}

class MockMediaRecorder {
    static isTypeSupported = () => true;
    static instances = [];

    constructor(stream, options = {}) {
        MockMediaRecorder.instances.push(this);
        this.stream = stream;
        this.mimeType = options.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
    }

    start() {
        this.state = 'recording';
    }

    stop() {
        this.state = 'inactive';
        if (this.ondataavailable) {
            this.ondataavailable({ data: { size: 1024 } });
        }
        if (this.onstop) {
            this.onstop();
        }
    }
}

class MockSpeechRecognition {
    static instances = [];

    constructor() {
        MockSpeechRecognition.instances.push(this);
        this.lang = 'en-US';
        this.continuous = false;
        this.interimResults = true;
        this.maxAlternatives = 1;
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

    abort() {
        this.state = 'aborted';
        this.onend?.();
    }

    emitResult(interimText = '', finalText = '') {
        const results = [];
        if (interimText) {
            const item = [{ transcript: interimText }];
            item.isFinal = false;
            results.push(item);
        }
        if (finalText) {
            const item = [{ transcript: finalText }];
            item.isFinal = true;
            results.push(item);
        }
        this.onresult?.({
            resultIndex: 0,
            results
        });
    }

    emitError(error) {
        this.onerror?.({ error });
    }
}

class MockElement {
    constructor(id) {
        this.id = id;
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
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
globalThis.MediaRecorder = MockMediaRecorder;
globalThis.SpeechRecognition = MockSpeechRecognition;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
    body: new MockElement('body'),
    getElementById: (id) => {
        if (!globalThis._domElements[id]) {
            globalThis._domElements[id] = new MockElement(id);
        }
        return globalThis._domElements[id];
    },
    addEventListener: () => {}
};
globalThis._domElements = {};

console.log('--- TEST 1: Stress Testing Filler Cleaning & Normalization ---');
assert.equal(cleanSpeechFillers('um uh ahh hello err erm world'), 'hello world');
assert.equal(cleanSpeechFillers('umm uhhh test'), 'test');
assert.equal(cleanSpeechFillers(''), '');
assert.equal(normalizeVoiceInputLanguage('ta'), 'ta-IN');
assert.equal(normalizeVoiceInputLanguage('te-IN'), 'te-IN');
assert.equal(normalizeVoiceInputLanguage('invalid-LANG'), 'en-US');
console.log('  [PASS] Clean speech fillers and language normalization');

console.log('\n--- TEST 2: Whisper Track Disposal on Stop, Cancel, and Throw ---');
let createdStream = null;
globalThis.navigator.mediaDevices.getUserMedia = async () => {
    createdStream = new MockMediaStream();
    return createdStream;
};

const recorder = createWhisperRecorder();
await recorder.start();
assert.equal(recorder.isRecording(), true);
assert.equal(createdStream.getAudioTracks()[0].stopped, false);
recorder.stop();
assert.equal(recorder.isRecording(), false);
assert.equal(createdStream.getAudioTracks()[0].stopped, true);

await recorder.start();
const stream2 = createdStream;
recorder.cancel();
assert.equal(recorder.isRecording(), false);
assert.equal(stream2.getAudioTracks()[0].stopped, true);
console.log('  [PASS] Whisper tracks correctly disposed on stop() and cancel()');

console.log('\n--- TEST 3: Empirical Bug Verification: Early Stop / Toggle-Off triggers Whisper Recorder Leak ---');
const earlyStopController = createSpeechInputController({
    Recognition: MockSpeechRecognition,
    language: 'en-US'
});
await earlyStopController.toggleDictation();
assert.equal(earlyStopController.getState().mode, 'dictation');
assert.equal(earlyStopController.getState().listening, true);

// User toggles off within 100ms before speech arrives
await earlyStopController.toggleDictation();
const earlyStopState = earlyStopController.getState();
console.log('State after early toggle-off:', earlyStopState);
if (earlyStopState.listening === true) {
    console.log('  [CRITICAL BUG FOUND] Controller remains in listening=true because r.onend mistook user stop as early engine crash and started Whisper fallback!');
} else {
    console.log('  [PASS] Early stop did not leak listening state');
}

console.log('\n--- TEST 4: Empirical Bug Verification: Typing During Interim Speech Duplication ---');
globalThis._domElements = {};
const uiController = installSpeechInputUI();
const textInput = globalThis.document.getElementById('text-input');

textInput.value = 'hello';
textInput.dispatchEvent({ type: 'input' });

await globalThis.toggleVoiceToText();
const activeRec = MockSpeechRecognition.instances.at(-1);

// Interim speech comes in
activeRec.emitResult('world how are you', '');
console.log('Input value during interim:', textInput.value);

// User edits input while interim speech is visible
textInput.value = 'hello, world how are you';
textInput.dispatchEvent({ type: 'input' });

// Final speech arrives
activeRec.emitResult('', 'world how are you');
console.log('Input value after final:', textInput.value);
if (textInput.value === 'hello, world how are you world how are you') {
    console.log('  [CRITICAL BUG FOUND] User keystrokes while interim is active baked interim text into committedText, causing duplication on final speech!');
} else {
    console.log('  [PASS] No speech duplication on manual keystroke');
}

console.log('\n=== Empirical Adversarial Testing Completed ===');
