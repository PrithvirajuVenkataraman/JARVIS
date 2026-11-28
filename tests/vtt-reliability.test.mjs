import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSpeechFillers, cleanPostStopTranscript, mergeTranscriptSegment, createWhisperRecorder, createSpeechInputController } from '../app/speech-input.js';
import { createDictationDraft } from '../app/dictation-session.js';

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
            this.results ||= [];
            const index = this.results.at(-1)?.isFinal ? this.results.length : Math.max(0, this.results.length - 1);
            this.results[index] = { isFinal, 0: { transcript: text } };
            this.onresult?.({ resultIndex: index, results: this.results });
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
        rec.emit('today', false);
        assert.deepEqual(interims, ['Hello', 'Hello world.', 'Hello world. Today']);

        controller.stop();
        assert.equal(controller.getState().listening, false);
        assert.equal(controller.getState().transcribing, true);
        rec.emit('um uh today period', true);
        await new Promise(resolve => setTimeout(resolve, 65));
        assert.equal(controller.getState().transcribing, false);
        assert.equal(finals.at(-1), 'Hello world. Today.');
    } finally {
        controller.stop({ cancelled: true });
    }
});

class DrainingRecognition {
    static instances = [];
    constructor() { this.results = []; DrainingRecognition.instances.push(this); }
    start() { this.onstart?.(); }
    stop() {}
    abort() { this.aborted = true; this.onend?.(); }
    emit(text, isFinal = false) {
        const index = this.results.at(-1)?.isFinal ? this.results.length : Math.max(0, this.results.length - 1);
        this.results[index] = { isFinal, 0: { transcript: text } };
        this.onresult?.({ resultIndex: index, results: this.results });
    }
}

test('Stop preserves the visible interim tail even when the browser never sends its final result', async () => {
    const finals = [];
    const controller = createSpeechInputController({ Recognition: DrainingRecognition, postStopCleanupMs: 15, onFinal: text => finals.push(text) });
    try {
        await controller.toggleDictation(); const rec = DrainingRecognition.instances.at(-1);
        rec.emit('First thought.', true); rec.emit('second thought', false);
        controller.stop(); await new Promise(resolve => setTimeout(resolve, 30));
        assert.equal(finals.at(-1), 'First thought. Second thought');
        assert.equal(controller.getState().finishing, false);
        assert.equal(rec.aborted, true);
    } finally { controller.stop({ cancelled: true }); }
});

test('an immediate restart drains the preceding native result and assigns the next clip a distinct identity', async () => {
    const draft = createDictationDraft(); let value = 'Draft:';
    const ids = [];
    const controller = createSpeechInputController({
        Recognition: DrainingRecognition, postStopCleanupMs: 100,
        onSessionStart({ sessionId }) { ids.push(sessionId); draft.begin(sessionId, value); },
        onInterim(text, event) { value = draft.update(event.sessionId, text, value) ?? value; },
        onFinal(text, event) { value = draft.update(event.sessionId, text, value, event.settled) ?? value; }
    });
    try {
        await controller.toggleDictation(); const first = DrainingRecognition.instances.at(-1);
        first.emit('first', false); controller.stop(); await controller.toggleDictation();
        assert.equal(value, 'Draft: First');
        first.emit('first thought.', true); first.onend(); await tick();
        const second = DrainingRecognition.instances.at(-1); assert.notEqual(second, first);
        second.emit('second thought.', true); controller.stop(); second.onend();
        assert.equal(value, 'Draft: First thought. Second thought.');
        assert.equal(new Set(ids).size, 2);
    } finally { controller.stop({ cancelled: true }); }
});

test('recorded clips finish independently and compose in capture order when responses arrive backwards', async () => recorderEnvironment(async env => {
    const first = deferred(), second = deferred(); let calls = 0, value = 'Keep this:';
    env.respond = () => ++calls === 1 ? first.promise : second.promise;
    const draft = createDictationDraft();
    const controller = createSpeechInputController({ Recognition: null,
        onSessionStart({ sessionId }) { draft.begin(sessionId, value); },
        onFinal(text, event) { value = draft.update(event.sessionId, text, value, event.settled) ?? value; }
    });
    try {
        await controller.toggleDictation(); controller.stop(); await tick();
        const firstSignal = env.requests[0][1].signal;
        await controller.toggleDictation(); controller.stop(); await tick();
        assert.equal(firstSignal.aborted, false); assert.equal(env.requests.length, 2);
        assert.equal(env.tracks.every(item => item.track.readyState === 'ended'), true);
        second.resolve(Response.json({ success: true, text: 'Second thought.' })); await tick();
        assert.equal(value, 'Keep this: Second thought.');
        first.resolve(Response.json({ success: true, text: 'First thought.' })); await tick();
        assert.equal(value, 'Keep this: First thought. Second thought.');
        assert.equal(controller.getState().pendingCount, 0);
    } finally { controller.stop({ cancelled: true }); }
}));

test('an older fallback failure cannot stop a newer native recording', async () => recorderEnvironment(async env => {
    const pending = deferred(), errors = [];
    env.respond = () => pending.promise;
    const controller = createSpeechInputController({ Recognition: DrainingRecognition, onError: message => errors.push(message) });
    try {
        await controller.toggleDictation(); DrainingRecognition.instances.at(-1).onerror({ error: 'network' }); await tick();
        controller.stop(); await tick(); await controller.toggleDictation();
        pending.resolve(Response.json({ success: false, fallbackToBrowser: true }, { status: 503 })); await tick();
        assert.equal(controller.getState().mode, 'dictation'); assert.equal(controller.getState().listening, true);
        assert.equal(errors.length, 1);
    } finally { controller.stop({ cancelled: true }); }
}));

test('cancellation invalidates all pending clips and a late permission grant without publishing stale text', async () => recorderEnvironment(async env => {
    const pending = deferred(), permission = deferred(), finals = [];
    env.respond = () => pending.promise;
    const controller = createSpeechInputController({ Recognition: null, onFinal: text => finals.push(text) });
    try {
        await controller.toggleDictation(); controller.stop(); await tick();
        const signal = env.requests[0][1].signal;
        env.getUserMedia = () => permission.promise;
        const starting = controller.toggleDictation(); controller.stop({ releaseStream: true });
        const lateStream = stream(); permission.resolve(lateStream); await starting;
        pending.resolve(Response.json({ success: true, text: 'Stale words.' })); await tick();
        assert.equal(lateStream.track.readyState, 'ended'); assert.equal(signal.aborted, true);
        assert.deepEqual(finals, []); assert.equal(controller.getState().pendingCount, 0);
    } finally { controller.stop({ cancelled: true }); }
}));

test('assistant processing updates do not clear pending transcription or a recording identity', async () => recorderEnvironment(async env => {
    const pending = deferred(); env.respond = () => pending.promise;
    const controller = createSpeechInputController({ Recognition: null });
    try {
        await controller.toggleDictation(); controller.stop(); await tick();
        controller.setProcessing(false);
        assert.equal(controller.getState().transcribing, true);
        pending.resolve(Response.json({ success: true, text: 'Completed words.' })); await tick();
        assert.equal(controller.getState().transcribing, false);
    } finally { controller.stop({ cancelled: true }); }
}));

test('Send finishes capture and waits for transcription, with duplicate clicks coalesced', async () => recorderEnvironment(async env => {
    const pending = deferred(), finals = []; env.respond = () => pending.promise;
    const controller = createSpeechInputController({ Recognition: null, onFinal: text => finals.push(text) });
    try {
        await controller.toggleDictation(); const sending = controller.prepareSubmit(); await tick();
        assert.equal(controller.getState().listening, false);
        assert.equal(controller.getState().submissionPending, true);
        assert.equal(await controller.prepareSubmit(), false);
        pending.resolve(Response.json({ success: true, text: 'Complete this thought.' }));
        assert.equal(await sending, true); assert.deepEqual(finals, ['Complete this thought.']);
        assert.equal(controller.getState().submissionPending, false);
    } finally { controller.stop({ cancelled: true }); }
}));

test('editing or starting another recording cancels the queued Send without cancelling unrelated finished text', async () => recorderEnvironment(async env => {
    const pending = deferred(); env.respond = () => pending.promise;
    const controller = createSpeechInputController({ Recognition: null });
    try {
        await controller.toggleDictation(); const sending = controller.prepareSubmit(); await tick();
        await controller.toggleDictation();
        pending.resolve(Response.json({ success: true, text: 'First recording.' }));
        assert.equal(await sending, false); assert.equal(controller.getState().listening, true);
        const secondSend = controller.prepareSubmit(); controller.stop({ cancelled: true });
        assert.equal(await secondSend, false);
    } finally { controller.stop({ cancelled: true }); }
}));

test('a transcription timeout cancels queued Send and releases all capture resources', async () => recorderEnvironment(async env => {
    env.respond = (_url, init) => new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    });
    const errors = [], controller = createSpeechInputController({ Recognition: null, transcriptionTimeoutMs: 20, onError: message => errors.push(message) });
    try {
        await controller.toggleDictation();
        const sending = controller.prepareSubmit();
        // Keep a timer alive because AbortSignal.timeout uses an unreferenced timer in Node.
        await new Promise(resolve => setTimeout(resolve, 50));
        assert.equal(await sending, false); assert.match(errors[0], /timed out/);
        assert.equal(controller.getState().pendingCount, 0);
        assert.equal(env.tracks.every(item => item.track.readyState === 'ended'), true);
    } finally { controller.stop({ cancelled: true }); }
}));
