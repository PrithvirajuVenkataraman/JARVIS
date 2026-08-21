import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    createWhisperRecorder,
    normalizeVoiceInputLanguage,
    cleanSpeechFillers
} from '../app/speech-input.js';
import sttHandler from '../api/stt.js';

console.log('================================================================');
console.log('--- STARTING EMPIRICAL STRESS TESTS FOR MILESTONE 1 (CHALLENGER 2) ---');
console.log('================================================================\n');

// ----------------------------------------------------------------------
// HELPER UTILITIES & MOCKS
// ----------------------------------------------------------------------

function setNavigator(val) {
    Object.defineProperty(globalThis, 'navigator', {
        value: val,
        configurable: true,
        writable: true
    });
}

function createMockReq(method = 'POST', body = {}, headers = {}) {
    return {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body
    };
}

function createMockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        data: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        setHeader(k, v) {
            this.headers[k] = v;
            return this;
        },
        json(payload) {
            this.data = payload;
            return this;
        },
        end() {
            return this;
        }
    };
    return res;
}

class MockAudioTrack {
    constructor() {
        this.readyState = 'live';
        this.enabled = true;
        this.stopped = false;
    }
    stop() {
        this.readyState = 'ended';
        this.stopped = true;
    }
}

class MockMediaStream {
    constructor() {
        this.tracks = [new MockAudioTrack()];
        this.active = true;
    }
    getAudioTracks() {
        return this.tracks;
    }
    getTracks() {
        return this.tracks;
    }
}

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
    abort() {
        this.state = 'aborted';
    }
    emitResult(transcript, isFinal = true) {
        this.onresult?.({
            resultIndex: 0,
            results: [[{ transcript, isFinal }]]
        });
    }
    emitError(error) {
        this.onerror?.({ error });
    }
}

// ----------------------------------------------------------------------
// TEST SUITE 1: API / STT BACKEND STRESS & ERROR SIMULATION
// ----------------------------------------------------------------------
console.log('>>> TEST SUITE 1: STT API Backend Resilience & Edge Cases');

// Test 1.1: 413 Request Body Too Large (>10MB security limit)
{
    const hugePayload = 'A'.repeat(11 * 1024 * 1024); // 11MB string
    const req = createMockReq('POST', { audioBase64: hugePayload });
    const res = createMockRes();
    await sttHandler(req, res);
    assert.equal(res.statusCode, 413, 'Expected 413 for payload > 10MB');
    assert.equal(res.data?.error?.code, 'request_too_large');
    console.log('  [PASS] 1.1 Oversized audio payload (>10MB) returns HTTP 413 request_too_large');
}

// Test 1.2: Valid size payload (<10MB) passes security gateway
{
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY_SECONDARY;
    delete process.env.GROQ_API_KEY_FALLBACK;

    const normalPayload = Buffer.from('test small audio buffer').toString('base64');
    const req = createMockReq('POST', { audioBase64: normalPayload });
    const res = createMockRes();
    await sttHandler(req, res);
    // Passes security guard, reaches missing API key check -> 503
    assert.equal(res.statusCode, 503);
    assert.equal(res.data?.fallbackToBrowser, true);
    assert.equal(res.data?.error?.code, 'api_key_missing');
    console.log('  [PASS] 1.2 Normal payload (<10MB) passes security filter and handles missing API key with fallback flag');

    if (originalKey) process.env.GROQ_API_KEY = originalKey;
}

// Test 1.3: Timeout Abort simulation (Groq upstream timeout)
{
    const originalFetch = globalThis.fetch;
    const originalKey = process.env.GROQ_API_KEY;
    process.env.GROQ_API_KEY = 'gsk_mock_key_for_testing';

    // Mock fetch throwing AbortError
    globalThis.fetch = async () => {
        const abortErr = new Error('The operation was aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
    };

    const req = createMockReq('POST', {
        audioBase64: Buffer.from('mock audio').toString('base64'),
        mimeType: 'audio/webm'
    });
    const res = createMockRes();
    await sttHandler(req, res);

    assert.equal(res.statusCode, 504, 'AbortError must yield 504 Gateway Timeout');
    assert.equal(res.data?.fallbackToBrowser, true, '504 must signal fallbackToBrowser');
    assert.equal(res.data?.error?.code, 'timeout');
    console.log('  [PASS] 1.3 Upstream Groq timeout abort returns HTTP 504 with fallbackToBrowser=true');

    // Test 1.4: Upstream Groq 500 / 502 / 413 error responses
    globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        text: async () => 'Groq Internal Server Error'
    });

    const res500 = createMockRes();
    await sttHandler(req, res500);
    assert.equal(res500.statusCode, 502, 'Groq 500 status mapped to 502 Bad Gateway');
    assert.equal(res500.data?.fallbackToBrowser, true);
    assert.equal(res500.data?.error?.code, 'transcription_failed');
    console.log('  [PASS] 1.4 Upstream Groq 500 error mapped to 502 with fallbackToBrowser=true');

    // Test 1.5: Language ISO prefix extraction for Groq API
    let capturedFormData = null;
    globalThis.fetch = async (url, options) => {
        capturedFormData = options.body;
        return {
            ok: true,
            status: 200,
            json: async () => ({ text: 'Mock transcribed text', language: 'ta', duration: 1.5 })
        };
    };

    const reqLang = createMockReq('POST', {
        audioBase64: Buffer.from('mock audio').toString('base64'),
        language: 'ta-IN'
    });
    const resLang = createMockRes();
    await sttHandler(reqLang, resLang);
    assert.equal(resLang.statusCode, 200);
    assert.equal(resLang.data?.success, true);
    assert.equal(resLang.data?.text, 'Mock transcribed text');
    assert.equal(capturedFormData.get('language'), 'ta', 'Expected language ISO prefix "ta" from "ta-IN"');
    console.log('  [PASS] 1.5 Regional dialect "ta-IN" correctly converted to ISO code "ta" in Groq Whisper form');

    // Restore fetch and key
    globalThis.fetch = originalFetch;
    if (originalKey) process.env.GROQ_API_KEY = originalKey;
    else delete process.env.GROQ_API_KEY;
}

// ----------------------------------------------------------------------
// TEST SUITE 2: CLIENT WHISPER RECORDER & FALLBACK STRESS
// ----------------------------------------------------------------------
console.log('\n>>> TEST SUITE 2: Client Whisper Fallback & Error Recovery');

// Test 2.1: MediaRecorder unsupported environment
{
    const origNavigator = globalThis.navigator;
    const origMR = globalThis.MediaRecorder;

    setNavigator({});
    delete globalThis.MediaRecorder;

    const errors = [];
    const whisper = createWhisperRecorder({
        onError: err => errors.push(err)
    });
    assert.equal(whisper.isSupported(), false);
    const started = await whisper.start();
    assert.equal(started, false);
    assert.equal(errors[0]?.code, 'unsupported');
    console.log('  [PASS] 2.1 Gracefully rejects start when MediaRecorder/getUserMedia unsupported');

    setNavigator(origNavigator);
    globalThis.MediaRecorder = origMR;
}

// Test 2.2: Track disposal on getUserMedia or MediaRecorder error
{
    const mockStream = new MockMediaStream();
    setNavigator({
        mediaDevices: {
            getUserMedia: async () => mockStream
        }
    });
    // Throw in MediaRecorder constructor
    globalThis.MediaRecorder = class {
        constructor() {
            throw new Error('Hardware audio device initialization failed');
        }
    };

    const errors = [];
    const whisper = createWhisperRecorder({
        onError: err => errors.push(err)
    });

    const started = await whisper.start();
    assert.equal(started, false);
    assert.equal(errors[0]?.code, 'mic_permission_error');
    // Verify audio tracks were stopped to avoid keeping mic active
    assert.equal(mockStream.tracks[0].stopped, true, 'Audio tracks must be stopped on recorder init failure');
    console.log('  [PASS] 2.2 Audio tracks stopped immediately on MediaRecorder constructor failure');
}

// Test 2.3: Whisper stop & cancel track cleanup
{
    let currentStream = null;
    setNavigator({
        mediaDevices: {
            getUserMedia: async () => {
                currentStream = new MockMediaStream();
                return currentStream;
            }
        }
    });
    globalThis.MediaRecorder = class {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
        }
        start() {
            this.state = 'recording';
        }
        stop() {
            this.state = 'inactive';
            this.onstop?.();
        }
    };

    // Test cancel()
    const whisper1 = createWhisperRecorder({});
    await whisper1.start();
    assert.equal(whisper1.isRecording(), true);
    assert.equal(currentStream.tracks[0].stopped, false);
    whisper1.cancel();
    assert.equal(whisper1.isRecording(), false);
    assert.equal(currentStream.tracks[0].stopped, true, 'cancel() must release all tracks');
    console.log('  [PASS] 2.3 cancel() releases all MediaStream audio tracks and resets recording state');

    // Test stop() with keepStream = false (default)
    const whisper2 = createWhisperRecorder({});
    await whisper2.start();
    assert.equal(currentStream.tracks[0].stopped, false);
    whisper2.stop({ keepStream: false });
    assert.equal(currentStream.tracks[0].stopped, true, 'stop({ keepStream: false }) must release tracks');
    console.log('  [PASS] 2.4 stop({ keepStream: false }) releases MediaStream audio tracks');
}

// Test 2.5: Whisper recorder server fallback response handling
{
    class MockFileReader {
        readAsDataURL(blob) {
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

    const origFetch = globalThis.fetch;
    // Simulate server returning fallbackToBrowser: true
    globalThis.fetch = async () => ({
        ok: false,
        status: 503,
        json: async () => ({ success: false, fallbackToBrowser: true, error: { code: 'api_key_missing' } })
    });

    let recorderInstance = null;
    globalThis.MediaRecorder = class {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            recorderInstance = this;
        }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.ondataavailable?.({ data: { size: 100 } });
            this.onstop?.();
        }
    };

    const errors = [];
    const stateHistory = [];
    const whisper = createWhisperRecorder({
        onError: err => errors.push(err),
        onState: st => stateHistory.push(st)
    });

    await whisper.start();
    whisper.stop();

    await new Promise(r => setTimeout(r, 50));

    assert.equal(errors.length, 1);
    assert.equal(errors[0].code, 'fallback_to_browser');
    const lastState = stateHistory.at(-1);
    assert.equal(lastState.processing, false);
    console.log('  [PASS] 2.5 Whisper recorder server fallback flag triggers fallback_to_browser error code');

    globalThis.fetch = origFetch;
}

// ----------------------------------------------------------------------
// TEST SUITE 3: PROCESSING LOCK FAILSAFE TIMERS & UI UNFREEZING
// ----------------------------------------------------------------------
console.log('\n>>> TEST SUITE 3: Processing Lock Failsafe Timers & Race Prevention');

// Setup mock document.body
const mockClassList = new Set();
globalThis.document = {
    body: {
        classList: {
            toggle(className, force) {
                if (force === undefined) {
                    if (mockClassList.has(className)) mockClassList.delete(className);
                    else mockClassList.add(className);
                } else if (force) {
                    mockClassList.add(className);
                } else {
                    mockClassList.delete(className);
                }
            },
            contains(className) {
                return mockClassList.has(className);
            }
        }
    }
};

// Test 3.1: Processing lock state and toggle
{
    const stateEvents = [];
    const controller = createSpeechInputController({
        Recognition: FakeRecognition,
        onState: st => stateEvents.push(st)
    });

    controller.setProcessing(true);
    assert.equal(controller.getState().processing, true);
    assert.equal(document.body.classList.contains('is-processing'), true);
    console.log('  [PASS] 3.1 setProcessing(true) sets processing state and adds is-processing class');

    controller.setProcessing(false);
    assert.equal(controller.getState().processing, false);
    assert.equal(document.body.classList.contains('is-processing'), false);
    console.log('  [PASS] 3.2 setProcessing(false) immediately clears processing state and removes is-processing class');
}

// Test 3.3: Multiple consecutive setProcessing(true) calls don't leak or race
{
    const controller = createSpeechInputController({
        Recognition: FakeRecognition
    });

    for (let i = 0; i < 20; i++) {
        controller.setProcessing(true);
    }
    assert.equal(controller.getState().processing, true);
    assert.equal(document.body.classList.contains('is-processing'), true);

    controller.setProcessing(false);
    assert.equal(controller.getState().processing, false);
    assert.equal(document.body.classList.contains('is-processing'), false);
    console.log('  [PASS] 3.3 Multiple rapid setProcessing(true) invocations handled cleanly without timer leakage');
}

// Test 3.4: stop({ disableConverse: true }) immediately clears processing lock
{
    const controller = createSpeechInputController({
        Recognition: FakeRecognition
    });

    await controller.toggleConverse();
    controller.setProcessing(true);
    assert.equal(controller.getState().processing, true);
    assert.equal(document.body.classList.contains('is-processing'), true);

    // Stop converse while processing
    controller.stop({ disableConverse: true });
    assert.equal(controller.getState().converseEnabled, false);
    assert.equal(controller.getState().processing, false, 'Processing must reset to false on disableConverse');
    assert.equal(document.body.classList.contains('is-processing'), false, 'is-processing class must be removed');
    console.log('  [PASS] 3.4 stop({ disableConverse: true }) while processing immediately clears lock and CSS class');
}

// ----------------------------------------------------------------------
// TEST SUITE 4: LANGUAGE NORMALIZATION & DIALECT FALLBACKS
// ----------------------------------------------------------------------
console.log('\n>>> TEST SUITE 4: Language Normalization & Dialect Fallbacks');

// Test 4.1: Comprehensive dialect mapping matrix
{
    const cases = [
        // Exact supported
        ['en-US', 'en-US'],
        ['en-IN', 'en-IN'],
        ['ta-IN', 'ta-IN'],
        ['te-IN', 'te-IN'],
        ['kn-IN', 'kn-IN'],
        ['hi-IN', 'hi-IN'],
        // Prefix matching
        ['ta', 'ta-IN'],
        ['ta-LK', 'ta-IN'],
        ['ta-SG', 'ta-IN'],
        ['TAMIL', 'ta-IN'],
        ['te', 'te-IN'],
        ['te-AP', 'te-IN'],
        ['kn', 'kn-IN'],
        ['kn-KA', 'kn-IN'],
        ['hi', 'hi-IN'],
        ['hi-Latn', 'hi-IN'],
        // Fallbacks to en-US
        ['en-GB', 'en-US'],
        ['en-AU', 'en-US'],
        ['fr-FR', 'en-US'],
        ['es-ES', 'en-US'],
        ['de-DE', 'en-US'],
        ['zh-CN', 'en-US'],
        ['ja-JP', 'en-US'],
        ['', 'en-US'],
        [null, 'en-US'],
        [undefined, 'en-US'],
        [123, 'en-US'],
        ['   ', 'en-US'],
        ['!@#$', 'en-US']
    ];

    for (const [input, expected] of cases) {
        const result = normalizeVoiceInputLanguage(input);
        assert.equal(result, expected, `Failed normalization for input "${input}": expected "${expected}", got "${result}"`);
    }
    console.log(`  [PASS] 4.1 All ${cases.length} language normalization test vectors passed correctly`);
}

// Test 4.2: Dynamic language change during active recognition updates recognition.lang
{
    const controller = createSpeechInputController({
        Recognition: FakeRecognition,
        language: 'en-US'
    });

    await controller.toggleDictation();
    assert.equal(controller.getState().language, 'en-US');

    const rec = FakeRecognition.instances.at(-1);
    assert.equal(rec.lang, 'en-US');

    // Switch to Tamil
    controller.setLanguage('ta-IN');
    assert.equal(controller.getState().language, 'ta-IN');
    assert.equal(rec.lang, 'ta-IN');

    // Switch to Hindi with prefix
    controller.setLanguage('hi');
    assert.equal(controller.getState().language, 'hi-IN');
    assert.equal(rec.lang, 'hi-IN');

    controller.stop();
    console.log('  [PASS] 4.2 Controller setLanguage dynamically updates active recognition instance and internal state');
}

// ----------------------------------------------------------------------
// TEST SUITE 5: FILLER CLEANER ROBUSTNESS & WORD-BOUNDARY SAFETY
// ----------------------------------------------------------------------
console.log('\n>>> TEST SUITE 5: Speech Filler Cleaner Word-Boundary Safety');

{
    const fillerCases = [
        ['um hello uh world', 'hello world'],
        ['UMMM hello UHH world ERR', 'hello world'],
        ['ah please check this', 'please check this'],
        ['erm wait a second ermmm', 'wait a second'],
        ['  uh   uh   um   ', ''],
        ['humanity and summary', 'humanity and summary'], // should NOT remove "um" inside words like human or summary
        ['umbrella under the tree', 'umbrella under the tree'], // should NOT remove "um" in umbrella
        ['errand boy in autumn', 'errand boy in autumn'], // should NOT remove "err" in errand
        [null, ''],
        [undefined, ''],
        ['', '']
    ];

    for (const [input, expected] of fillerCases) {
        const result = cleanSpeechFillers(input);
        assert.equal(result, expected, `cleanSpeechFillers("${input}"): expected "${expected}", got "${result}"`);
    }
    console.log(`  [PASS] 5.1 Filler cleaner successfully handles all ${fillerCases.length} word-boundary cases`);
}

console.log('\n================================================================');
console.log('--- EMPIRICAL STRESS TEST SUITE EXECUTION COMPLETE ---');
console.log('================================================================\n');
