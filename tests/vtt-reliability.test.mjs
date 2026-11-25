import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeechFillers, cleanPostStopTranscript, mergeTranscriptSegment, createWhisperRecorder, createSpeechInputController } from '../app/speech-input.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 10));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function stream() {
    const track = { enabled: true, readyState: 'live', stop() { this.readyState = 'ended'; } };
    return { active: true, track, getTracks: () => [track], getAudioTracks: () => [track] };
}
async function recorderEnvironment(run) {
    const names = ['navigator', 'window', 'MediaRecorder', 'FileReader', 'fetch'];
    const saved = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const tracks = [], recordings = [], requests = [];
    const env = { tracks, recordings, requests, encoded: 'YXVkaW8=', getUserMedia: async () => { const value = stream(); tracks.push(value); return value; }, respond: async () => Response.json({ success: true, text: 'Recognized words.' }) };
    class Recorder {
        static isTypeSupported(type) { return type === 'audio/webm'; }
        constructor(value) { this.stream = value; this.mimeType = 'audio/webm'; this.state = 'inactive'; recordings.push(this); }
        start() { this.state = 'recording'; }
        stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['recorded audio']) }); this.onstop?.(); }); }
    }
    class Reader {
        readAsDataURL() { queueMicrotask(() => { this.result = `data:audio/webm;base64,${env.encoded}`; this.onloadend?.(); }); }
    }
    for (const [name, value] of Object.entries({ navigator: { mediaDevices: { getUserMedia: (...args) => env.getUserMedia(...args) } }, window: {}, MediaRecorder: Recorder, FileReader: Reader, fetch: async (...args) => { requests.push(args); return env.respond(...args); } })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    try { await run(env); }
    finally { for (const value of tracks) value.getTracks().forEach(track => track.stop()); for (const [name, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } }
}

test('speech cleanup preserves recognized Unicode and meaningful bracketed content', () => {
    for (const text of ['வணக்கம் நண்பரே', 'नमस्ते दुनिया', 'ಕನ್ನಡದಲ್ಲಿ ಹೇಳಿ', '你好世界']) assert.equal(cleanSpeechFillers(text), text);
    assert.equal(cleanSpeechFillers('explain f(x) and [1, 2]'), 'Explain f(x) and [1, 2]');
    assert.equal(cleanSpeechFillers('[noise] (cough) ...'), '');
    assert.equal(cleanSpeechFillers('i am ill and need my id'), 'I am ill and need my ID');
});

test('cancel during the microphone permission request releases the late stream and never starts recording', async () => recorderEnvironment(async env => {
    const permission = deferred(); env.getUserMedia = () => permission.promise;
    const recorder = createWhisperRecorder(); const starting = recorder.start();
    recorder.cancel();
    const granted = stream(); permission.resolve(granted);
    try { assert.equal(await starting, false); assert.equal(granted.track.readyState, 'ended'); assert.equal(env.recordings.length, 0); }
    finally { recorder.cancel(); granted.track.stop(); }
}));

test('cancel ignores the asynchronous final audio chunk instead of uploading it', async () => recorderEnvironment(async env => {
    const results = [];
    const recorder = createWhisperRecorder({ onTranscribed: text => results.push(text) });
    try { await recorder.start(); recorder.cancel(); await tick(); assert.equal(env.requests.length, 0); assert.deepEqual(results, []); assert.equal(env.tracks[0].track.readyState, 'ended'); }
    finally { recorder.cancel(); }
}));

test('a canceled transcription aborts its request and cannot publish a late result', async () => recorderEnvironment(async env => {
    const pending = deferred(), results = [];
    env.respond = () => pending.promise;
    const recorder = createWhisperRecorder({ onTranscribed: text => results.push(text) });
    try {
        await recorder.start(); recorder.stop(); await tick(); assert.equal(env.requests.length, 1);
        const signal = env.requests[0][1].signal;
        recorder.cancel(); pending.resolve(Response.json({ success: true, text: 'Obsolete result.' })); await tick();
        assert.equal(signal?.aborted, true); assert.deepEqual(results, []);
    } finally { recorder.cancel(); }
}));

test('finishing a clip transcribes it once and releases the microphone', async () => recorderEnvironment(async env => {
    const results = [], recorder = createWhisperRecorder({ onTranscribed: text => results.push(text) });
    try { await recorder.start(); recorder.stop(); await tick(); assert.deepEqual(results, ['Recognized words.']); assert.equal(env.tracks[0].track.readyState, 'ended'); }
    finally { recorder.cancel(); }
}));

class Recognition {
    static instances = [];
    constructor() { Recognition.instances.push(this); }
    start() { this.onstart?.(); }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
}

test('permission denial is terminal and does not open a second microphone capture', async () => recorderEnvironment(async env => {
    const errors = [], controller = createSpeechInputController({ Recognition, onError: error => errors.push(error) });
    try {
        await controller.toggleDictation(); Recognition.instances.at(-1).onerror({ error: 'not-allowed' }); await tick();
        assert.equal(env.tracks.length, 0); assert.equal(controller.getState().mode, 'idle'); assert.match(errors[0], /permission was denied/);
    } finally { controller.stop({ disableConverse: true, cancelled: true }); }
}));

test('recognition-service failure switches to recording without its abort event ending dictation', async () => recorderEnvironment(async env => {
    const controller = createSpeechInputController({ Recognition });
    try {
        await controller.toggleDictation(); Recognition.instances.at(-1).onerror({ error: 'network' }); await tick();
        assert.equal(controller.getState().mode, 'dictation'); assert.equal(controller.getState().listening, true); assert.equal(env.recordings.length, 1);
    } finally { controller.stop({ disableConverse: true, cancelled: true }); }
}));

test('oversized audio is rejected locally without a Vercel request', async () => recorderEnvironment(async env => {
    env.encoded = 'A'.repeat(4_000_000); const errors = [];
    const recorder = createWhisperRecorder({ onError: error => errors.push(error) });
    try { await recorder.start(); recorder.stop(); await tick(); assert.equal(env.requests.length, 0); assert.equal(errors[0].code, 'audio_too_large'); }
    finally { recorder.cancel(); }
}));

test('Whisper preserves hands-free Converse submission while dictation stays manual', async () => recorderEnvironment(async env => {
    const results = [], controller = createSpeechInputController({ Recognition: null, onFinal: (text, event) => results.push({ text, ...event }) });
    try {
        await controller.toggleConverse(); env.recordings[0].stop(); await tick();
        assert.equal(results.length, 1); assert.equal(results[0].source, 'converse'); assert.equal(results[0].autoSubmit, true);
        assert.equal(env.tracks[0].track.readyState, 'ended');
    } finally { controller.stop({ disableConverse: true, cancelled: true }); }
}));

test('a failed fallback terminates cleanly instead of cycling back to failed browser recognition', async () => recorderEnvironment(async env => {
    const errors = [], controller = createSpeechInputController({ Recognition, onError: error => errors.push(error) });
    env.respond = async () => Response.json({ success: false, fallbackToBrowser: true }, { status: 503 });
    try {
        await controller.toggleDictation(); const instances = Recognition.instances.length;
        Recognition.instances.at(-1).onerror({ error: 'network' }); await tick();
        env.recordings[0].stop(); await tick();
        assert.equal(Recognition.instances.length, instances); assert.equal(controller.getState().mode, 'idle'); assert.equal(controller.getState().listening, false); assert.match(errors[0], /temporarily unavailable/);
    } finally { controller.stop({ disableConverse: true, cancelled: true }); }
}));

test('word-by-word VTT deduplicates punctuation drift and runs post-stop cleanup before committing final text', async () => {
    assert.equal(mergeTranscriptSegment('Hello world.', 'hello world today'), 'Hello world. today');
    assert.equal(cleanPostStopTranscript('um i want to i want to deploy this'), 'I want to deploy this');

    const interims = [];
    const finals = [];
    const states = [];
    class StreamingRecognition {
        static instances = [];
        constructor() { StreamingRecognition.instances.push(this); }
        start() { this.onstart?.(); }
        stop() {}
        emit(text, isFinal) {
            this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] });
        }
    }
    const controller = createSpeechInputController({
        Recognition: StreamingRecognition,
        postStopCleanupMs: 40,
        onInterim: text => interims.push(text),
        onFinal: text => finals.push(text),
        onState: state => states.push({ listening: state.listening, transcribing: state.transcribing })
    });
    try {
        await controller.toggleDictation();
        const rec = StreamingRecognition.instances.at(-1);
        rec.emit('hello', false);
        rec.emit('hello world.', true);
        rec.emit('hello world today', false);
        assert.deepEqual(interims, ['Hello', 'Hello world.', 'Hello world. Today']);

        controller.stop();
        assert.equal(controller.getState().listening, false);
        assert.equal(controller.getState().transcribing, true);
        rec.emit('um uh hello world today period', true);
        await new Promise(resolve => setTimeout(resolve, 65));
        assert.equal(controller.getState().transcribing, false);
        assert.equal(finals.at(-1), 'Hello world. Today.');
    } finally {
        controller.stop({ cancelled: true });
    }
});
