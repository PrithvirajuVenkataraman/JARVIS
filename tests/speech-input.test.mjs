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

// 8. Test Language Switcher
const switchedLang = controller.setLanguage('ta-IN');
assert.equal(switchedLang, 'ta-IN');
assert.equal(controller.getState().language, 'ta-IN');

console.log('speech-input-tests-ok');
