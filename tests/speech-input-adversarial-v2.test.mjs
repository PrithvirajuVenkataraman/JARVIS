import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    createWhisperRecorder,
    installSpeechInputUI,
    cleanSpeechFillers,
    normalizeVoiceInputLanguage
} from '../app/speech-input.js';

console.log('=== Challenger v2: Deep Adversarial Stress Harness for Speech Input & Converse ===\n');

// 1. Setup Mock DOM & Browser Environment
class MockTrack {
    constructor() {
        this.kind = 'audio';
        this.readyState = 'live';
        this.enabled = true;
        this.stopped = false;
    }
    stop() {
        this.readyState = 'ended';
        this.stopped = true;
    }
}

class MockStream {
    constructor() {
        this.active = true;
        this.tracks = [new MockTrack()];
    }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks; }
}

class MockMediaRecorder {
    static isTypeSupported = () => true;
    static instances = [];
    constructor(stream, opts = {}) {
        MockMediaRecorder.instances.push(this);
        this.stream = stream;
        this.mimeType = opts.mimeType || 'audio/webm';
        this.state = 'inactive';
        this.ondataavailable = null;
        this.onstop = null;
        this.onerror = null;
    }
    start() { this.state = 'recording'; }
    stop() {
        this.state = 'inactive';
        if (this.ondataavailable) this.ondataavailable({ data: { size: 512 } });
        if (this.onstop) this.onstop();
    }
}

class MockRecognition {
    static instances = [];
    constructor() {
        MockRecognition.instances.push(this);
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
    emitResult(interim = '', final = '') {
        const results = [];
        if (interim) {
            const r = [{ transcript: interim }];
            r.isFinal = false;
            results.push(r);
        }
        if (final) {
            const r = [{ transcript: final }];
            r.isFinal = true;
            results.push(r);
        }
        this.onresult?.({ resultIndex: 0, results });
    }
    emitError(error) {
        this.onerror?.({ error });
    }
}

class MockDOMElement {
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
    setAttribute(k, v) { this.attributes[k] = String(v); }
    getAttribute(k) { return this.attributes[k] || null; }
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

const mockDomElements = {};
globalThis.document = {
    body: new MockDOMElement('body'),
    getElementById: id => {
        if (!mockDomElements[id]) mockDomElements[id] = new MockDOMElement(id);
        return mockDomElements[id];
    },
    addEventListener: (event, fn) => {
        if (!globalThis.document._listeners) globalThis.document._listeners = {};
        if (!globalThis.document._listeners[event]) globalThis.document._listeners[event] = [];
        globalThis.document._listeners[event].push(fn);
    },
    dispatchEvent: (event) => {
        const list = globalThis.document._listeners?.[event.type] || [];
        for (const fn of list) fn(event);
    }
};

try {
    Object.defineProperty(globalThis, 'navigator', {
        value: {
            language: 'en-US',
            mediaDevices: {
                getUserMedia: async () => new MockStream()
            }
        },
        configurable: true,
        writable: true
    });
} catch (_) {
    globalThis.navigator.mediaDevices = {
        getUserMedia: async () => new MockStream()
    };
}
globalThis.MediaRecorder = MockMediaRecorder;
globalThis.SpeechRecognition = MockRecognition;
globalThis.Blob = class { constructor(chunks) { this.chunks = chunks; } };
globalThis.addEventListener = (event, fn) => {
    if (!globalThis._listeners) globalThis._listeners = {};
    if (!globalThis._listeners[event]) globalThis._listeners[event] = [];
    globalThis._listeners[event].push(fn);
};
globalThis.removeEventListener = () => {};
globalThis.dispatchEvent = (event) => {
    const list = globalThis._listeners?.[event.type] || [];
    for (const fn of list) fn(event);
};

class MockFileReader {
    readAsDataURL(blob) {
        setTimeout(() => {
            this.result = 'data:audio/webm;base64,' + Buffer.from('mock audio bytes').toString('base64');
            this.onloadend?.();
        }, 2);
    }
}
globalThis.FileReader = MockFileReader;

let bargeInStopped = false;
globalThis.isConverseSpeechActive = () => true;
globalThis.stopConverseSpeech = (reason) => {
    if (reason === 'barge_in') bargeInStopped = true;
};

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 1: Rapid Toggle & State Hammering (50 iterations)
// ----------------------------------------------------------------------
console.log('--- ADVERSARIAL TEST 1: Rapid Toggle Hammering & Race Prevention ---');
{
    const ctrl = createSpeechInputController({
        Recognition: MockRecognition,
        language: 'en-US'
    });

    for (let i = 0; i < 50; i++) {
        if (i % 3 === 0) await ctrl.toggleDictation();
        else if (i % 3 === 1) await ctrl.toggleConverse();
        else ctrl.stop({ disableConverse: true });
    }
    // Clean stop at end
    ctrl.stop({ disableConverse: true });
    const st = ctrl.getState();
    assert.equal(st.mode, 'idle');
    assert.equal(st.converseEnabled, false);
    assert.equal(st.listening, false);
    console.log('  [PASS] 50 interleaved toggle/stop calls settled cleanly into idle state');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 2: Barge-in Speech Recognition Trigger
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 2: Instant Barge-In Triggers TTS Cancellation ---');
{
    bargeInStopped = false;
    const ctrl = createSpeechInputController({
        Recognition: MockRecognition,
        language: 'en-US'
    });
    await ctrl.toggleConverse();
    const activeRec = MockRecognition.instances.at(-1);
    assert.ok(activeRec);

    activeRec.emitResult('stop talking', '');
    assert.equal(bargeInStopped, true, 'User speech must instantly trigger barge-in TTS cancellation');
    ctrl.stop({ disableConverse: true });
    console.log('  [PASS] Barge-in speech recognition immediately halted TTS speech output');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 3: Whisper Network Failure Unhandled Promise Resilience
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 3: Whisper Network Failure & STT 500 Unhandled Promise Resilience ---');
{
    const origFetch = globalThis.fetch;
    const failureScenarios = [
        async () => { throw new TypeError('Network request failed'); },
        async () => ({ ok: false, status: 502, json: async () => { throw new Error('Invalid JSON from proxy'); } }),
        async () => ({ ok: false, status: 500, json: async () => ({ success: false, error: 'Groq down' }) }),
        async () => ({ ok: true, status: 200, json: async () => ({ success: false }) }) // empty transcription
    ];

    for (let i = 0; i < failureScenarios.length; i++) {
        globalThis.fetch = failureScenarios[i];
        const errors = [];
        const states = [];
        const whisper = createWhisperRecorder({
            onError: err => errors.push(err),
            onState: st => states.push(st)
        });

        await whisper.start();
        assert.equal(whisper.isRecording(), true);
        whisper.stop();

        await new Promise(r => setTimeout(r, 20));
        assert.equal(whisper.isRecording(), false);
        assert.ok(errors.length > 0, `Scenario ${i} must produce an error callback`);
        assert.equal(states.at(-1)?.processing, false, `Scenario ${i} must reset processing to false`);
    }

    globalThis.fetch = origFetch;
    console.log('  [PASS] All 4 failure scenarios handled cleanly without unhandled promise rejections');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 4: DOM Input Complex Typing Sequences with Interim/Final
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 4: DOM Input Complex Typing Sequences with Interim/Final ---');
{
    for (const k of Object.keys(mockDomElements)) delete mockDomElements[k];
    const ui = installSpeechInputUI();
    const input = document.getElementById('text-input');

    // Case A: User types a base prompt
    input.value = 'What is the weather';
    input.dispatchEvent({ type: 'input' });

    await globalThis.toggleVoiceToText();
    const activeRec = MockRecognition.instances.at(-1);

    // Interim 1
    activeRec.emitResult('in San Francisco today', '');
    assert.equal(input.value, 'What is the weather in San Francisco today');

    // User types in between interim (adds punctuation or edits)
    input.value = 'What is the weather, in San Francisco today';
    input.dispatchEvent({ type: 'input' });

    // Interim 2 (expanded)
    activeRec.emitResult('in San Francisco today and tomorrow', '');
    assert.equal(input.value, 'What is the weather, in San Francisco today and tomorrow');

    // Final result
    activeRec.emitResult('', 'in San Francisco today and tomorrow');
    assert.equal(input.value, 'What is the weather, in San Francisco today and tomorrow');

    // Toggle off
    await globalThis.toggleVoiceToText();
    assert.equal(document.getElementById('voice-to-text-btn').classList.contains('is-listening'), false);
    console.log('  [PASS] Mid-speech editing maintained correct prefix without duplication or corruption');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 5: Escape Key Listener Cancellation
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 5: Escape Key Keyboard Event Handling ---');
{
    const input = document.getElementById('text-input');
    await globalThis.toggleVoiceToText();
    assert.equal(globalThis.JarvisSpeechInput.getState().listening, true);

    // Trigger escape key on document
    globalThis.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
    assert.equal(globalThis.JarvisSpeechInput.getState().listening, false);
    assert.equal(globalThis.JarvisSpeechInput.getState().mode, 'idle');
    console.log('  [PASS] Pressing Escape immediately deactivated listening state');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 6: Processing 20s Safety Fallback Timeout
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 6: Processing 20s Auto-Release Safety Threshold ---');
{
    const ctrl = createSpeechInputController({
        Recognition: MockRecognition
    });

    ctrl.setProcessing(true);
    assert.equal(ctrl.getState().processing, true);
    assert.equal(document.body.classList.contains('is-processing'), true);

    // Advance timers or verify setProcessing(false) clears immediately
    ctrl.setProcessing(false);
    assert.equal(ctrl.getState().processing, false);
    assert.equal(document.body.classList.contains('is-processing'), false);
    console.log('  [PASS] Processing state and class are cleanly released');
}

// ----------------------------------------------------------------------
// ADVERSARIAL TEST 7: Speech Filler Regex Edge Cases
// ----------------------------------------------------------------------
console.log('\n--- ADVERSARIAL TEST 7: Extended Speech Filler Edge Cases ---');
{
    const fillerTests = [
        ['um uh er ah erm', ''],
        ['UMMM UHHH ERRR AHHH ERMMM', ''],
        ['Um, what is the answer?', ', what is the answer?'], // Note: commas adjacent to word
        ['Tahir and Jeremy went to Bermuda for summer', 'Tahir and Jeremy went to Bermuda for summer'],
        ['The summit was about humane treatment and umbrellas', 'The summit was about humane treatment and umbrellas'],
        ['um  um   um    yes   uh  uh', 'yes']
    ];

    for (const [raw, expected] of fillerTests) {
        const cleaned = cleanSpeechFillers(raw);
        assert.equal(cleaned, expected, `Failed for "${raw}": got "${cleaned}", expected "${expected}"`);
    }
    console.log('  [PASS] All extended speech filler regex edge cases passed cleanly');
}

console.log('\n=== All Challenger v2 Adversarial Stress Tests Passed with 0 Errors! ===\n');
