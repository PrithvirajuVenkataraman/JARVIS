import assert from 'node:assert/strict';
import { createInteractionStateMachine, InteractionState } from '../app/interaction-state.js';

console.log('--- Testing Authoritative Interaction State Machine ---');

// 1. Verify Enum Completeness
{
    console.log('1. Verifying InteractionState enum constants...');
    const expectedStates = [
        'IDLE',
        'LISTENING',
        'TRANSCRIBING',
        'SUBMITTING',
        'THINKING',
        'SEARCHING',
        'GENERATING',
        'SPEAKING',
        'INTERRUPTED',
        'CANCELLED',
        'ERROR'
    ];
    for (const state of expectedStates) {
        assert.equal(InteractionState[state], state, `InteractionState.${state} should exist and equal ${state}`);
    }
    assert.throws(() => {
        InteractionState.NEW_STATE = 'FAIL';
    }, 'InteractionState should be frozen');
    console.log('  [PASS] All expected interaction states defined and enum is immutable.');
}

// 2. Lifecycle transitions: IDLE -> LISTENING -> TRANSCRIBING -> SUBMITTING -> THINKING -> GENERATING -> SPEAKING -> IDLE
{
    console.log('2. Testing standard voice & text lifecycle transitions...');
    const sm = createInteractionStateMachine();
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    assert.equal(sm.isProcessing(), false);

    const history = [];
    sm.subscribe((state, record) => {
        history.push({ state, reqId: record.requestId });
    });

    const req1 = sm.createRequestId('test_req');

    // LISTENING
    sm.transition(InteractionState.LISTENING);
    assert.equal(sm.getState(), InteractionState.LISTENING);
    assert.equal(sm.isListening(), true);
    assert.equal(sm.isBusy(), false);

    // TRANSCRIBING
    sm.transition(InteractionState.TRANSCRIBING);
    assert.equal(sm.getState(), InteractionState.TRANSCRIBING);
    assert.equal(sm.isProcessing(), true);
    assert.equal(sm.isBusy(), true);

    // SUBMITTING
    sm.transition(InteractionState.SUBMITTING, { requestId: req1, metadata: { text: 'Hello' } });
    assert.equal(sm.getState(), InteractionState.SUBMITTING);
    assert.equal(sm.getRequestId(), req1);
    assert.equal(sm.isProcessing(), true);

    // THINKING
    sm.transition(InteractionState.THINKING);
    assert.equal(sm.getState(), InteractionState.THINKING);
    assert.equal(sm.isProcessing(), true);

    // GENERATING
    sm.transition(InteractionState.GENERATING);
    assert.equal(sm.getState(), InteractionState.GENERATING);
    assert.equal(sm.isProcessing(), true);

    // SPEAKING
    sm.transition(InteractionState.SPEAKING);
    assert.equal(sm.getState(), InteractionState.SPEAKING);
    assert.equal(sm.isSpeaking(), true);
    assert.equal(sm.isProcessing(), false);
    assert.equal(sm.isBusy(), true);

    // Reset to IDLE
    sm.resetToIdle('turn_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    assert.equal(sm.isSpeaking(), false);

    assert.equal(history.length, 7);
    console.log('  [PASS] Complete voice/text lifecycle transitioned cleanly.');
}

// 3. Search Flow: IDLE -> SUBMITTING -> SEARCHING -> GENERATING -> IDLE
{
    console.log('3. Testing search flow lifecycle...');
    const sm = createInteractionStateMachine();
    const req = sm.createRequestId('search');

    sm.transition(InteractionState.SUBMITTING, { requestId: req });
    assert.equal(sm.getState(), InteractionState.SUBMITTING);

    sm.transition(InteractionState.SEARCHING, { metadata: { query: 'latest tech news' } });
    assert.equal(sm.getState(), InteractionState.SEARCHING);
    assert.equal(sm.isProcessing(), true);
    assert.equal(sm.isBusy(), true);

    sm.transition(InteractionState.GENERATING);
    assert.equal(sm.getState(), InteractionState.GENERATING);

    sm.resetToIdle('search_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    console.log('  [PASS] Search flow transitioned successfully.');
}

// 4. Terminal Flows: INTERRUPTED, CANCELLED, ERROR
{
    console.log('4. Testing terminal flows (INTERRUPTED, CANCELLED, ERROR)...');
    const sm = createInteractionStateMachine();

    // INTERRUPTED
    sm.transition(InteractionState.THINKING);
    sm.transition(InteractionState.INTERRUPTED, { metadata: { reason: 'user_stop' } });
    assert.equal(sm.getState(), InteractionState.INTERRUPTED);
    assert.equal(sm.isBusy(), false);
    sm.resetToIdle('stop_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);

    // CANCELLED
    sm.transition(InteractionState.LISTENING);
    sm.transition(InteractionState.CANCELLED, { metadata: { reason: 'user_esc' } });
    assert.equal(sm.getState(), InteractionState.CANCELLED);
    assert.equal(sm.isBusy(), false);
    sm.resetToIdle('cancel_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);

    // ERROR
    sm.transition(InteractionState.GENERATING);
    sm.transition(InteractionState.ERROR, { error: new Error('Network timeout') });
    assert.equal(sm.getState(), InteractionState.ERROR);
    assert.equal(sm.isBusy(), false);
    assert.ok(sm.getSnapshot().error);
    sm.resetToIdle('error_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.getSnapshot().error, null);

    console.log('  [PASS] Terminal states handled and reset cleanly.');
}

// 5. Stale Request Fencing
{
    console.log('5. Testing request ID sequence and stale request fencing...');
    const sm = createInteractionStateMachine();

    const req1 = sm.createRequestId('turn');
    const req2 = sm.createRequestId('turn');
    assert.notEqual(req1, req2);

    sm.transition(InteractionState.SUBMITTING, { requestId: req1 });
    assert.equal(sm.isCurrentRequest(req1), true);
    assert.equal(sm.isCurrentRequest(req2), false);

    // Supervening request begins
    sm.transition(InteractionState.SUBMITTING, { requestId: req2 });
    assert.equal(sm.isCurrentRequest(req1), false, 'Old request req1 must now be fenced out as stale');
    assert.equal(sm.isCurrentRequest(req2), true, 'New request req2 must be recognized as current');

    console.log('  [PASS] Request fencing accurately distinguishes current and stale requests.');
}

// 6. Watchdog Auto-Recovery Guarantee
{
    console.log('6. Testing watchdog auto-recovery when a request is stuck...');
    const sm = createInteractionStateMachine({ watchdogMs: 60 });
    const req = sm.createRequestId('stuck_turn');

    sm.transition(InteractionState.THINKING, { requestId: req });
    assert.equal(sm.getState(), InteractionState.THINKING);
    assert.equal(sm.isBusy(), true);

    await new Promise((resolve) => setTimeout(resolve, 100));

    // Watchdog should have auto-reset to IDLE
    assert.equal(sm.getState(), InteractionState.IDLE, 'State machine should have reset to IDLE after watchdog timeout');
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] Watchdog successfully recovered stuck request to IDLE.');
}

// 7. Event Dispatching & Backward-Compatibility
{
    console.log('7. Testing browser event dispatch & assistant-processing compatibility...');
    const dispatchedEvents = [];
    const fakeWindow = {
        dispatchEvent(evt) {
            dispatchedEvents.push(evt);
        }
    };

    const sm = createInteractionStateMachine({ windowRef: fakeWindow });
    sm.transition(InteractionState.SUBMITTING);

    const stateEvt = dispatchedEvents.find((e) => e.type === 'jarvis:interaction-state');
    assert.ok(stateEvt, 'jarvis:interaction-state event should be dispatched');
    assert.equal(stateEvt.detail.state, InteractionState.SUBMITTING);

    const procEvt = dispatchedEvents.find((e) => e.type === 'jarvis:assistant-processing');
    assert.ok(procEvt, 'jarvis:assistant-processing event should be dispatched for backward compatibility');
    assert.equal(procEvt.detail.active, true);

    sm.resetToIdle('done');
    const procEndEvt = dispatchedEvents.filter((e) => e.type === 'jarvis:assistant-processing').pop();
    assert.ok(procEndEvt);
    assert.equal(procEndEvt.detail.active, false);

    console.log('  [PASS] Events and backward-compatible payloads properly dispatched.');
}

console.log('--- ALL INTERACTION STATE MACHINE TESTS PASSED ---');
process.exit(0);
