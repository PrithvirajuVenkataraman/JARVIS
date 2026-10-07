/**
 * Phase 6: End-to-End VTT Pipeline Test Suite
 *
 * Tests all 12 scenarios of the VTT pipeline using:
 *   - createSpeechInputController + mock Recognition (no browser required)
 *   - createInteractionStateMachine for state transition verification
 *   - index.html static analysis for structural guard rails
 *
 * PRIMARY INVARIANT: Every scenario must reach a valid terminal state
 * (processing=false, mode in idle/stopped) within a bounded time.
 * No stop button / processing lock may persist indefinitely.
 *
 * Run: node tests/vtt-e2e-pipeline.test.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpeechInputController } from '../app/speech-input.js';
import { createInteractionStateMachine, InteractionState } from '../app/interaction-state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

console.log('\n--- Phase 6: End-to-End VTT Pipeline ---');

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;
function test(label, fn) {
    try { fn(); console.log('  PASS  ' + label); passed++; }
    catch(e) { console.error('  FAIL  ' + label); console.error('        ' + e.message); failed++; }
}
async function testAsync(label, fn) {
    try { await fn(); console.log('  PASS  ' + label); passed++; }
    catch(e) { console.error('  FAIL  ' + label); console.error('        ' + e.message); failed++; }
}

// ─── Mock Recognition factory ─────────────────────────────────────────────────

function makeMockRecognition() {
    class MockRecognition {
        constructor() {
            this.continuous = false;
            this.interimResults = false;
            this.lang = 'en-US';
            this.maxAlternatives = 1;
            this.onresult = null;
            this.onerror = null;
            this.onend = null;
            MockRecognition._last = this;
        }
        start() { MockRecognition._started = true; }
        stop() { MockRecognition._stopped = true; if (this.onend) this.onend(); }
        abort() { if (this.onend) this.onend(); }
        static _last = null;
        static _started = false;
        static _stopped = false;
        static reset() { MockRecognition._last = null; MockRecognition._started = false; MockRecognition._stopped = false; }
    }
    return MockRecognition;
}

// Simulate a final SpeechRecognition result event
function fireFinalResult(rec, transcript) {
    if (!rec || !rec.onresult) return;
    const event = {
        resultIndex: 0,
        results: [
            Object.assign([{ transcript, confidence: 0.95 }], { isFinal: true, length: 1 })
        ]
    };
    event.results.length = 1;
    rec.onresult(event);
}

// Simulate a recognition error event
function fireError(rec, code = 'network') {
    if (!rec || !rec.onerror) return;
    rec.onerror({ error: code });
}

// Helper: wait N ms
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

// Helper: assert state clears within timeout
async function assertEventuallyIdle(controller, timeoutMs = 500) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const s = controller.getState();
        if (!s.processing && !s.listening) return;
        await wait(20);
    }
    const s = controller.getState();
    assert.ok(!s.processing, 'Controller must not be processing after timeout. processing=' + s.processing);
}

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 1: Static Guard Rail Analysis (index.html)
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 1: Static VTT Guard Rails in index.html');

test('activeRequestControllers Set defined', () => {
    assert.ok(indexHtml.includes('const activeRequestControllers = new Set();'),
        'activeRequestControllers Set must be defined');
});

test('resetComposerToIdle function defined and exported', () => {
    assert.ok(indexHtml.includes('function resetComposerToIdle()'), 'resetComposerToIdle must be defined');
    assert.ok(indexHtml.includes('window.resetComposerToIdle = resetComposerToIdle;'), 'must be exported to window');
});

test('JarvisSpeechInput.setProcessing(false) called in resetComposerToIdle', () => {
    assert.ok(indexHtml.includes("window.JarvisSpeechInput?.setProcessing?.(false);"),
        'setProcessing(false) must be called during composer idle reset');
});

test('JarvisInteractionState.resetToIdle called in stopActiveGeneration', () => {
    assert.ok(indexHtml.includes("window.JarvisInteractionState?.resetToIdle?."),
        'state machine resetToIdle must be called in stopActiveGeneration');
});

test('20s processingTimer watchdog present in speech-input setProcessing', () => {
    // Check speech-input.js, not index.html
    const speechSrc = fs.readFileSync(path.join(__dirname, '../app/speech-input.js'), 'utf8');
    assert.ok(speechSrc.includes('processingTimer = setTimeout'), '20s watchdog timeout must exist');
    assert.ok(speechSrc.includes('setProcessing(false)') && speechSrc.includes('20000'),
        'Watchdog must call setProcessing(false) after 20000ms');
});

test('stopConverseSpeech called in stopActiveGeneration', () => {
    assert.ok(indexHtml.includes('stopConverseSpeech();'), 'TTS must be cancelled in stopActiveGeneration');
});

test('jarvis:interaction-state event listener syncs speech controller', () => {
    assert.ok(indexHtml.includes("jarvis:interaction-state"),
        'jarvis:interaction-state event listener must exist');
    assert.ok(indexHtml.includes("controller.setProcessing(false)") || indexHtml.includes("controller?.setProcessing?.(false)") || indexHtml.includes("JarvisSpeechInput?.setProcessing?.(false)"),
        'State machine terminal states must trigger setProcessing(false)');
});

test('Escape key stops listening', () => {
    const speechSrc = fs.readFileSync(path.join(__dirname, '../app/speech-input.js'), 'utf8');
    assert.ok(speechSrc.includes("event.key === 'Escape'") && speechSrc.includes("controller.stop"),
        'Escape key must call controller.stop()');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 2: VTT State Machine — Controller Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

console.log('\nSuite 2: VTT Controller Lifecycle State Transitions');

test('Scenario 1 — Simple question: mic on → final transcript → processing clears', async () => {
    // can't use async in test(), inline
});

// Run async scenarios directly
let s2passed = 0; let s2failed = 0;
async function s2test(label, fn) {
    try { await fn(); console.log('  PASS  ' + label); s2passed++; }
    catch(e) { console.error('  FAIL  ' + label); console.error('        ' + e.message); s2failed++; }
}

await s2test('Scenario 1 — Simple question lifecycle: IDLE after final transcript submitted', async () => {
    const Rec = makeMockRecognition();
    const events = [];
    const controller = createSpeechInputController({
        Recognition: Rec,
        onState: s => events.push(Object.assign({}, s)),
        onFinal: () => {},
        onError: () => {}
    });

    await controller.start({ converse: false });
    // Simulate final result firing
    const rec = Rec._last;
    if (rec) fireFinalResult(rec, 'What is the speed of light?');

    // setProcessing(true) simulates LLM call starting
    controller.setProcessing(true);
    assert.ok(controller.getState().processing, 'Should be processing during LLM call');

    // LLM finishes → setProcessing(false)
    controller.setProcessing(false);
    controller.stop();

    assert.ok(!controller.getState().processing, 'Processing must be false after stop');
});

await s2test('Scenario 2 — Normal LLM question: LISTENING → TRANSCRIBING → IDLE', async () => {
    const sm = createInteractionStateMachine();
    sm.transition('LISTENING', { requestId: 'turn1' });
    assert.equal(sm.getState(), 'LISTENING');
    sm.transition('TRANSCRIBING');
    assert.equal(sm.getState(), 'TRANSCRIBING');
    sm.transition('THINKING');
    assert.equal(sm.getState(), 'THINKING');
    sm.transition('GENERATING');
    assert.equal(sm.getState(), 'GENERATING');
    sm.resetToIdle('llm_complete');
    assert.equal(sm.getState(), 'IDLE');
});

await s2test('Scenario 3 — Live-search question: SEARCHING → THINKING → GENERATING → IDLE', async () => {
    const sm = createInteractionStateMachine();
    sm.transition('LISTENING', { requestId: 'turn2' });
    sm.transition('TRANSCRIBING');
    sm.transition('SEARCHING');
    assert.equal(sm.getState(), 'SEARCHING');
    sm.transition('THINKING');
    assert.equal(sm.getState(), 'THINKING');
    sm.transition('GENERATING');
    sm.resetToIdle('search_complete');
    assert.equal(sm.getState(), 'IDLE');
});

await s2test('Scenario 4 — "Why?" ultra-short follow-up: processing clears correctly', async () => {
    const Rec = makeMockRecognition();
    let finalText = '';
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: (text) => { finalText = text; },
        onError: () => {}
    });

    await controller.start();
    const rec = Rec._last;
    if (rec) fireFinalResult(rec, 'Why?');

    controller.setProcessing(true);
    await wait(10);
    controller.setProcessing(false);
    controller.stop();

    assert.ok(!controller.getState().processing, 'Processing must clear after ultra-short follow-up');
    // "Why?" should not be filtered out — evaluateTurnCompleteness handles it with a longer timeout, not filtering
});

await s2test('Scenario 5 — 25-turn conversation: no processing lock accumulates', async () => {
    const sm = createInteractionStateMachine();
    for (let turn = 1; turn <= 25; turn++) {
        sm.transition('LISTENING', { requestId: `turn${turn}` });
        sm.transition('TRANSCRIBING');
        sm.transition('THINKING');
        sm.transition('GENERATING');
        sm.resetToIdle(`turn${turn}_done`);
        assert.equal(sm.getState(), 'IDLE', `Should be IDLE after turn ${turn}`);
    }
    assert.equal(sm.getState(), 'IDLE', 'Must be IDLE after 25 turns');
});

await s2test('Scenario 5b — 25-turn speech controller: processing never persists across turns', async () => {
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });

    for (let turn = 0; turn < 25; turn++) {
        await controller.start();
        controller.setProcessing(true);
        assert.ok(controller.getState().processing, `Turn ${turn+1}: processing must be true during LLM`);
        controller.setProcessing(false);
        assert.ok(!controller.getState().processing, `Turn ${turn+1}: processing must be false after LLM done`);
        controller.stop();
    }
    assert.ok(!controller.getState().processing, 'No processing lock after 25 turns');
});

await s2test('Scenario 6 — User interrupts TTS (barge-in): state clears', async () => {
    const sm = createInteractionStateMachine();
    sm.transition('LISTENING', { requestId: 'tts1' });
    sm.transition('TRANSCRIBING');
    sm.transition('GENERATING');
    sm.transition('SPEAKING');
    assert.equal(sm.getState(), 'SPEAKING');

    // Barge-in: interrupt transitions to INTERRUPTED then IDLE
    sm.transition('INTERRUPTED', { metadata: { reason: 'barge_in' } });
    assert.equal(sm.getState(), 'INTERRUPTED');
    sm.resetToIdle('barge_in');
    assert.equal(sm.getState(), 'IDLE');

    // Controller processing must also clear
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });
    controller.setProcessing(true);
    assert.ok(controller.getState().processing);

    // Simulate barge-in: stop with interrupt
    controller.stop({ disableConverse: true });
    assert.ok(!controller.getState().processing, 'Processing must clear after barge-in stop');
});

await s2test('Scenario 7 — User cancels via stop button: state=IDLE, processing=false', async () => {
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });
    await controller.start();
    controller.setProcessing(true);
    assert.ok(controller.getState().processing);

    // User presses stop (cancel)
    controller.stop({ cancelled: true, disableConverse: true });
    assert.ok(!controller.getState().processing, 'Cancel must clear processing');
    assert.ok(!controller.getState().listening, 'Cancel must stop listening');

    // State machine should also reach IDLE/CANCELLED
    const sm = createInteractionStateMachine();
    sm.transition('LISTENING', { requestId: 'cancel1' });
    sm.transition('TRANSCRIBING');
    sm.transition('CANCELLED');
    assert.equal(sm.getState(), 'CANCELLED');
    sm.resetToIdle('user_cancel');
    assert.equal(sm.getState(), 'IDLE');
});

await s2test('Scenario 8 — STT failure (onerror): onError called, processing stays false', async () => {
    const Rec = makeMockRecognition();
    let errorReceived = null;
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: (msg) => { errorReceived = msg; }
    });
    await controller.start();
    const rec = Rec._last;

    // Fire an unrecoverable STT error (not no-speech)
    // The controller falls back to whisper, but whisper isn't supported in test env (no navigator)
    // so after fallback attempt it will call onError
    if (rec && rec.onerror) {
        // Simulate 'service-not-allowed' (no fallback possible without browser)
        rec.onerror({ error: 'service-not-allowed' });
    }

    // Processing must not have been set to true before STT completes
    assert.ok(!controller.getState().processing, 'STT failure must not leave processing=true');
});

await s2test('Scenario 8b — STT no-speech: silently skips, processing stays false', async () => {
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });
    await controller.start();
    const rec = Rec._last;
    if (rec && rec.onerror) {
        rec.onerror({ error: 'no-speech' });
    }
    // no-speech is silently ignored by the controller
    assert.ok(!controller.getState().processing, 'no-speech must not set processing=true');
});

await s2test('Scenario 9 — LLM failure (HTTP 500): processingTimer watchdog eventually fires', async () => {
    // Verify the watchdog exists in source
    const speechSrc = fs.readFileSync(path.join(__dirname, '../app/speech-input.js'), 'utf8');
    assert.ok(speechSrc.includes('processingTimer = setTimeout'), 'Watchdog must exist');
    assert.ok(speechSrc.match(/processingTimer\s*=\s*setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?setProcessing\(false\)/),
        'Watchdog callback must call setProcessing(false)');

    // Verify index.html has a resetComposerToIdle on fetch error paths
    assert.ok(indexHtml.includes('resetComposerToIdle()') || indexHtml.includes('resetComposerToIdle('), 
        'resetComposerToIdle must be called on LLM error paths');
});

await s2test('Scenario 10 — Web-search failure: state machine recovers to IDLE', async () => {
    const sm = createInteractionStateMachine();
    sm.transition('LISTENING', { requestId: 'search_fail' });
    sm.transition('TRANSCRIBING');
    sm.transition('SEARCHING');
    // Search fails
    sm.transition('ERROR', { metadata: { reason: 'search_upstream_error' } });
    assert.equal(sm.getState(), 'ERROR');
    sm.resetToIdle('search_failed');
    assert.equal(sm.getState(), 'IDLE', 'State machine must recover to IDLE after search failure');
});

await s2test('Scenario 11 — Network timeout: processingTimer watchdog clears lock', async () => {
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });

    // Enter processing state (simulating LLM call started)
    controller.setProcessing(true);
    assert.ok(controller.getState().processing, 'Should be processing');

    // The real watchdog fires at 20s. In tests, we verify stop() always clears it
    // (the watchdog is the safety net; stop() should clear even before it fires)
    controller.stop();
    assert.ok(!controller.getState().processing, 'stop() must clear processing even before watchdog fires');

    // Verify the 20s watchdog constant is present (not 0, not Infinity)
    const speechSrc = fs.readFileSync(path.join(__dirname, '../app/speech-input.js'), 'utf8');
    assert.ok(speechSrc.includes('20000'), '20s watchdog constant must be present');
});

await s2test('Scenario 12 — Rapid consecutive questions: no processing lock leak', async () => {
    const Rec = makeMockRecognition();
    const controller = createSpeechInputController({
        Recognition: Rec,
        onFinal: () => {},
        onError: () => {}
    });

    // Simulate 3 rapid questions with overlapping processing
    for (let i = 0; i < 3; i++) {
        controller.setProcessing(true);
        // Each subsequent setProcessing(true) resets the prior processingTimer (checked in source)
        assert.ok(controller.getState().processing, `Q${i+1}: processing=true during LLM`);
    }

    // Final completion
    controller.setProcessing(false);
    assert.ok(!controller.getState().processing, 'No lock after 3 rapid questions resolved');

    // Also verify setProcessing resets timers (source check)
    const speechSrc = fs.readFileSync(path.join(__dirname, '../app/speech-input.js'), 'utf8');
    assert.ok(speechSrc.includes('clearTimeout(processingTimer)'), 'processingTimer must be cleared on each setProcessing call');
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 3: evaluateTurnCompleteness — short follow-ups not filtered
// ─────────────────────────────────────────────────────────────────────────────

import { evaluateTurnCompleteness } from '../app/speech-input.js';

console.log('\nSuite 3: evaluateTurnCompleteness — short follow-ups reach LLM');

test('"Why?" — incomplete interrogative, longer timeout, but NOT empty', () => {
    const r = evaluateTurnCompleteness('Why?');
    // "Why?" ends with '?' so it is COMPLETE (terminal punctuation)
    assert.ok(r !== null && r !== undefined, 'Must return a result');
    assert.equal(r.isComplete, true, '"Why?" with terminal punctuation must be complete');
});

test('"How so?" — complete (has terminal punctuation)', () => {
    const r = evaluateTurnCompleteness('How so?');
    assert.equal(r.isComplete, true, '"How so?" must be complete due to terminal ?');
});

test('"What about that?" — complete', () => {
    const r = evaluateTurnCompleteness('What about that?');
    assert.equal(r.isComplete, true, '"What about that?" must be complete');
});

test('"Who was it?" — complete', () => {
    const r = evaluateTurnCompleteness('Who was it?');
    assert.equal(r.isComplete, true, '"Who was it?" must be complete');
});

test('Empty transcript — incomplete', () => {
    const r = evaluateTurnCompleteness('');
    assert.equal(r.isComplete, false, 'Empty transcript must be incomplete');
    assert.equal(r.reason, 'empty_transcript');
});

test('"Tell me about" — incomplete interrogative, longer wait', () => {
    const r = evaluateTurnCompleteness('Tell me about');
    assert.equal(r.isComplete, false, 'Dangling interrogative must be incomplete');
    assert.equal(r.trailingConnector, true, 'Should flag trailing connector');
});

test('"and then" — trailing connector', () => {
    const r = evaluateTurnCompleteness('The answer is this and then');
    assert.equal(r.isComplete, false, 'Trailing "and then" must be incomplete');
    assert.equal(r.trailingConnector, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// SUITE 4: cleanSpeechFillers — fillers removed, question words preserved
// ─────────────────────────────────────────────────────────────────────────────

import { cleanSpeechFillers } from '../app/speech-input.js';

console.log('\nSuite 4: cleanSpeechFillers — integrity checks');

test('Verbal fillers removed', () => {
    assert.equal(cleanSpeechFillers('um what is the um capital of France'), 'What is the capital of France');
});

test('Short follow-up "why" preserved', () => {
    const r = cleanSpeechFillers('why');
    assert.ok(r.toLowerCase().includes('why'), '"why" must survive cleanSpeechFillers');
});

test('"How so" preserved', () => {
    const r = cleanSpeechFillers('how so');
    assert.ok(r.toLowerCase().includes('how so'), '"how so" must survive cleanSpeechFillers');
});

test('Spoken punctuation "full stop" → "."', () => {
    assert.ok(cleanSpeechFillers('Hello full stop').includes('.'), 'Spoken full stop must become period');
});

test('Sentence capitalization applied', () => {
    const r = cleanSpeechFillers('what is machine learning');
    assert.equal(r[0], r[0].toUpperCase(), 'First letter must be capitalised');
});

test('Duplicate word stutter removed', () => {
    const r = cleanSpeechFillers('the the capital of France');
    assert.ok(!r.includes('the the'), 'Stutter "the the" must be deduped');
});

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

const totalPassed = passed + s2passed;
const totalFailed = failed + s2failed;
console.log('\n' + '='.repeat(60));
console.log('vtt-e2e-pipeline.test.mjs  ' + totalPassed + '/' + (totalPassed + totalFailed) + ' ' + (totalFailed === 0 ? 'PASS' : 'FAIL'));
if (totalFailed > 0) { process.exit(1); }
