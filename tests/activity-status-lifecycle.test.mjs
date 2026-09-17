import assert from 'node:assert/strict';
import { createInteractionStateMachine, InteractionState, getInteractionStateLabel } from '../app/interaction-state.js';
import { decideFrontendRoute } from '../app/frontend-routing.js';

console.log('--- Testing Phase 8: Authoritative Activity Status & Lifecycle UX ---');

// Mock browser DOM environment
function setupDOM() {
    const elements = new Map();
    const chatContainer = {
        id: 'chat-container',
        children: [],
        appendChild(child) {
            this.children.push(child);
            child.parentNode = this;
        }
    };
    elements.set('chat-container', chatContainer);

    function createElement(tag) {
        const el = {
            tagName: tag.toUpperCase(),
            id: '',
            className: '',
            classList: {
                _classes: new Set(),
                add(c) { this._classes.add(c); },
                remove(c) { this._classes.delete(c); },
                contains(c) { return this._classes.has(c); },
                toggle(c, force) {
                    if (force !== undefined) {
                        if (force) this._classes.add(c);
                        else this._classes.delete(c);
                    } else {
                        if (this._classes.has(c)) this._classes.delete(c);
                        else this._classes.add(c);
                    }
                }
            },
            dataset: {},
            parentNode: null,
            _innerHTML: '',
            _textContent: '',
            get innerHTML() { return this._innerHTML; },
            set innerHTML(val) {
                this._innerHTML = val;
                if (val.includes('thinking-timer')) {
                    const match = val.match(/<span class="thinking-timer">([^<]*)<\/span>/);
                    if (match && this.timerEl) {
                        this.timerEl.textContent = match[1];
                    }
                }
            },
            get textContent() { return this._textContent; },
            set textContent(val) { this._textContent = val; },
            querySelector(sel) {
                if (sel === '.thinking-timer') return this.timerEl;
                return null;
            }
        };
        el.timerEl = {
            textContent: '',
            tagName: 'SPAN',
            className: 'thinking-timer'
        };
        return el;
    }

    function resolveThinkingPhase(message = '') {
        const raw = String(message || '').trim();
        const lower = raw.toLowerCase();
        if (/\b(searching\s+the\s+web)\b/i.test(lower)) {
            return { key: 'searching', label: 'Searching the web...' };
        }
        if (/\b(web search|search(?:ing)?|sources?|retriev|fetch|look(?:ing)?\s+up|checking verified|checking reliable|checking current|finding|lookup)\b/i.test(lower)) {
            return { key: 'searching', label: 'Searching...' };
        }
        if (/\b(generating|drafting|writing)\b/i.test(lower)) {
            return { key: 'generating', label: 'Generating...' };
        }
        if (/\b(speaking)\b/i.test(lower)) {
            return { key: 'speaking', label: 'Speaking...' };
        }
        if (/\b(listening)\b/i.test(lower)) {
            return { key: 'listening', label: 'Listening...' };
        }
        if (/\b(transcrib)\b/i.test(lower)) {
            return { key: 'transcribing', label: 'Transcribing...' };
        }
        if (/\b(analyzing|analyz)\b/i.test(lower)) {
            return { key: 'analyzing', label: 'Analyzing...' };
        }
        if (/\b(thinking)\b/i.test(lower)) {
            return { key: 'thinking', label: raw.includes('...') ? raw : 'Thinking...' };
        }
        return { key: 'analyzing', label: 'Analyzing...' };
    }

    function showThinkingIndicator(message = 'Analyzing...') {
        const phaseInfo = resolveThinkingPhase(message);
        let row = chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
        if (row && row.classList.contains('chat-thinking-indicator-leaving')) {
            chatContainer.children = chatContainer.children.filter(c => c !== row);
            row = null;
        }
        if (!row) {
            row = createElement('div');
            row.id = 'chat-thinking-indicator';
            row.dataset.phase = phaseInfo.key;
            row.dataset.phaseLabel = phaseInfo.label;
            row.timerEl.textContent = phaseInfo.label;
            chatContainer.appendChild(row);
        } else {
            row.dataset.phase = phaseInfo.key;
            row.dataset.phaseLabel = phaseInfo.label;
            row.timerEl.textContent = phaseInfo.label;
        }
    }

    function hideThinkingIndicator() {
        const row = chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
        if (!row) return;
        row.classList.add('chat-thinking-indicator-leaving');
        chatContainer.children = chatContainer.children.filter(c => c !== row);
    }

    function getIndicator() {
        return chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    }

    return { chatContainer, showThinkingIndicator, hideThinkingIndicator, getIndicator };
}

// ---------------------------------------------------------------------------
// 1. Normal LLM Question Lifecycle
// ---------------------------------------------------------------------------
{
    console.log('1. Testing Normal LLM Question Activity Lifecycle...');
    const dom = setupDOM();
    const sm = createInteractionStateMachine();
    const reqId = sm.createRequestId('req');

    // Subscribe indicator to state machine
    sm.subscribe((state) => {
        if (['IDLE', 'GENERATING', 'SPEAKING', 'INTERRUPTED', 'CANCELLED', 'ERROR'].includes(state)) {
            dom.hideThinkingIndicator();
        } else if (state === InteractionState.SEARCHING) {
            dom.showThinkingIndicator('Searching...');
        } else if ([InteractionState.ROUTING, InteractionState.ANALYZING, InteractionState.THINKING].includes(state)) {
            dom.showThinkingIndicator('Analyzing...');
        }
    });

    // Step 1: User submits question ("Explain quantum computing")
    sm.transition(InteractionState.ROUTING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.ROUTING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Analyzing...');
    let ind = dom.getIndicator();
    assert.ok(ind, 'Indicator should be shown during ROUTING');
    assert.equal(ind.dataset.phase, 'analyzing');
    assert.equal(ind.querySelector('.thinking-timer').textContent, 'Analyzing...');

    // Step 2: Router decides Normal LLM -> ANALYZING
    const route = decideFrontendRoute('Explain quantum computing');
    assert.notEqual(route.route, 'live_required');
    sm.transition(InteractionState.ANALYZING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.ANALYZING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Analyzing...');
    ind = dom.getIndicator();
    assert.equal(ind.querySelector('.thinking-timer').textContent, 'Analyzing...');

    // Verify: Normal LLM NEVER enters SEARCHING
    assert.notEqual(sm.getState(), InteractionState.SEARCHING);
    assert.notEqual(ind.dataset.phase, 'searching');

    // Step 3: First token streams -> GENERATING
    sm.transition(InteractionState.GENERATING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.GENERATING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Generating...');
    assert.ok(!dom.getIndicator(), 'Indicator must hide on GENERATING');

    // Step 4: Stream completes -> IDLE
    sm.resetToIdle('send_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] Normal LLM cycled: ROUTING -> ANALYZING -> GENERATING -> IDLE. Never claimed "Searching".');
}

// ---------------------------------------------------------------------------
// 2. Live Web Search Question Lifecycle
// ---------------------------------------------------------------------------
{
    console.log('2. Testing Live Web Search Activity Lifecycle...');
    const dom = setupDOM();
    const sm = createInteractionStateMachine();
    const reqId = sm.createRequestId('req');

    sm.subscribe((state) => {
        if (['IDLE', 'GENERATING', 'SPEAKING', 'INTERRUPTED', 'CANCELLED', 'ERROR'].includes(state)) {
            dom.hideThinkingIndicator();
        } else if (state === InteractionState.SEARCHING) {
            dom.showThinkingIndicator('Searching...');
        } else if ([InteractionState.ROUTING, InteractionState.ANALYZING, InteractionState.THINKING].includes(state)) {
            dom.showThinkingIndicator('Analyzing...');
        }
    });

    // Step 1: User submits live query ("Nenjukkul Peidhidum")
    sm.transition(InteractionState.ROUTING, { requestId: reqId });
    const route = decideFrontendRoute('Nenjukkul Peidhidum');
    assert.equal(route.route, 'live_required');

    // Step 2: Router decides Live Search, but fetch hasn't started yet!
    // Must be in ANALYZING, NOT SEARCHING!
    sm.transition(InteractionState.ANALYZING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.ANALYZING);
    let ind = dom.getIndicator();
    assert.equal(ind.dataset.phase, 'analyzing', 'Must be analyzing before fetch starts');
    assert.equal(ind.querySelector('.thinking-timer').textContent, 'Analyzing...');

    // Step 3: Network fetch to search endpoint begins
    sm.transition(InteractionState.SEARCHING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.SEARCHING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Searching...');
    ind = dom.getIndicator();
    assert.equal(ind.dataset.phase, 'searching', 'Must be searching only when search fetch begins');
    assert.equal(ind.querySelector('.thinking-timer').textContent, 'Searching...');

    // Step 4: Search results arrive -> model synthesis begins (ANALYZING)
    sm.transition(InteractionState.ANALYZING, { requestId: reqId, metadata: { phase: 'synthesizing' } });
    assert.equal(sm.getState(), InteractionState.ANALYZING);
    ind = dom.getIndicator();
    assert.equal(ind.dataset.phase, 'analyzing');
    assert.equal(ind.querySelector('.thinking-timer').textContent, 'Analyzing...');

    // Step 5: Streaming answer begins -> GENERATING
    sm.transition(InteractionState.GENERATING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.GENERATING);
    assert.ok(!dom.getIndicator(), 'Indicator hidden on generation');

    // Step 6: Stream completes -> IDLE
    sm.resetToIdle('send_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] Live web cycled: ROUTING -> ANALYZING -> SEARCHING (on fetch) -> ANALYZING (synthesis) -> GENERATING -> IDLE.');
}

// ---------------------------------------------------------------------------
// 3. VTT Voice-to-Text Full Lifecycle
// ---------------------------------------------------------------------------
{
    console.log('3. Testing VTT Voice Lifecycle...');
    const dom = setupDOM();
    const sm = createInteractionStateMachine();
    const reqId = sm.createRequestId('vtt_req');

    sm.subscribe((state) => {
        if (['IDLE', 'GENERATING', 'SPEAKING', 'INTERRUPTED', 'CANCELLED', 'ERROR'].includes(state)) {
            dom.hideThinkingIndicator();
        } else if (state === InteractionState.SEARCHING) {
            dom.showThinkingIndicator('Searching...');
        } else if ([InteractionState.ROUTING, InteractionState.ANALYZING, InteractionState.THINKING].includes(state)) {
            dom.showThinkingIndicator('Analyzing...');
        }
    });

    // 1. Microphone activates
    sm.transition(InteractionState.LISTENING);
    assert.equal(sm.getState(), InteractionState.LISTENING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Listening...');
    assert.equal(sm.isListening(), true);

    // 2. User finishes speaking, transcribing audio
    sm.transition(InteractionState.TRANSCRIBING);
    assert.equal(sm.getState(), InteractionState.TRANSCRIBING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Transcribing...');
    assert.equal(sm.isProcessing(), true);

    // 3. Transcription complete, submit and route
    sm.transition(InteractionState.ROUTING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.ROUTING);

    // 4. Model analysis in flight
    sm.transition(InteractionState.ANALYZING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.ANALYZING);

    // 5. Answer stream begins
    sm.transition(InteractionState.GENERATING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.GENERATING);

    // 6. Speech synthesis starts audio output
    sm.transition(InteractionState.SPEAKING, { requestId: reqId });
    assert.equal(sm.getState(), InteractionState.SPEAKING);
    assert.equal(getInteractionStateLabel(sm.getState()), 'Speaking...');
    assert.equal(sm.isSpeaking(), true);

    // 7. Verify sendMessage finally block does NOT clobber SPEAKING!
    sm.resetToIdle('send_complete');
    assert.equal(sm.getState(), InteractionState.SPEAKING, 'SPEAKING must be protected from send_complete');

    // 8. TTS audio naturally completes
    sm.transition(InteractionState.IDLE);
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] VTT cycled: LISTENING -> TRANSCRIBING -> ROUTING -> ANALYZING -> GENERATING -> SPEAKING -> IDLE with speaking protection.');
}

// ---------------------------------------------------------------------------
// 4. Cancellation & Stopping
// ---------------------------------------------------------------------------
{
    console.log('4. Testing Cancellation & Stop Flow across states...');
    const sm = createInteractionStateMachine();

    // Cancel during ANALYZING
    sm.transition(InteractionState.ANALYZING);
    assert.equal(sm.isProcessing(), true);
    sm.transition(InteractionState.CANCELLED, { metadata: { reason: 'user_stop' } });
    assert.equal(sm.getState(), InteractionState.CANCELLED);
    sm.resetToIdle('cancelled');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);

    // Cancel during SEARCHING
    sm.transition(InteractionState.SEARCHING);
    assert.equal(sm.isProcessing(), true);
    sm.transition(InteractionState.INTERRUPTED, { metadata: { reason: 'user_barge_in' } });
    assert.equal(sm.getState(), InteractionState.INTERRUPTED);
    sm.resetToIdle('interrupted');
    assert.equal(sm.getState(), InteractionState.IDLE);

    // Cancel during SPEAKING
    sm.transition(InteractionState.SPEAKING);
    assert.equal(sm.isSpeaking(), true);
    sm.transition(InteractionState.INTERRUPTED);
    sm.resetToIdle('speech_stop');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] Cancellation immediately transitions and safely resets to IDLE.');
}

// ---------------------------------------------------------------------------
// 5. Failure / Error Handling
// ---------------------------------------------------------------------------
{
    console.log('5. Testing Error Handling & Composer Recovery...');
    const dom = setupDOM();
    const sm = createInteractionStateMachine();

    sm.subscribe((state) => {
        if (['IDLE', 'GENERATING', 'SPEAKING', 'INTERRUPTED', 'CANCELLED', 'ERROR'].includes(state)) {
            dom.hideThinkingIndicator();
        } else if (state === InteractionState.SEARCHING) {
            dom.showThinkingIndicator('Searching...');
        } else if ([InteractionState.ROUTING, InteractionState.ANALYZING].includes(state)) {
            dom.showThinkingIndicator('Analyzing...');
        }
    });

    // Search fails with 500
    sm.transition(InteractionState.SEARCHING);
    assert.ok(dom.getIndicator());

    sm.transition(InteractionState.ERROR, { error: new Error('500 Search API error') });
    assert.equal(sm.getState(), InteractionState.ERROR);
    assert.ok(!dom.getIndicator(), 'Indicator must be cleared on error');

    sm.resetToIdle('error_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false, 'Composer must be free after error recovery');
    console.log('  [PASS] Errors dismiss activity indicator and safely unlock composer.');
}

// ---------------------------------------------------------------------------
// 6. Rapid Consecutive Requests & Stale Request Fencing
// ---------------------------------------------------------------------------
{
    console.log('6. Testing Rapid Consecutive Requests & Stale Fencing...');
    const sm = createInteractionStateMachine();

    const req1 = sm.createRequestId('req1');
    sm.transition(InteractionState.ROUTING, { requestId: req1 });
    assert.equal(sm.isCurrentRequest(req1), true);

    const req2 = sm.createRequestId('req2');
    sm.transition(InteractionState.ROUTING, { requestId: req2 });
    assert.equal(sm.isCurrentRequest(req1), false, 'req1 must be marked stale');
    assert.equal(sm.isCurrentRequest(req2), true);

    const req3 = sm.createRequestId('req3');
    sm.transition(InteractionState.ANALYZING, { requestId: req3 });
    assert.equal(sm.isCurrentRequest(req1), false);
    assert.equal(sm.isCurrentRequest(req2), false);
    assert.equal(sm.isCurrentRequest(req3), true);

    sm.resetToIdle('req3_done');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] Stale requests are strictly fenced; final request cleanly resets to IDLE.');
}

console.log('--- ALL PHASE 8 ACTIVITY STATUS & LIFECYCLE TESTS PASSED ---');
process.exit(0);


