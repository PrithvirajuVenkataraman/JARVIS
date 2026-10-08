import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createInteractionStateMachine, InteractionState } from '../app/interaction-state.js';
import { decideFrontendRoute } from '../app/frontend-routing.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('--- Testing Phase 3: Thinking / Searching UX & Activity Indicator ---');

const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

// Helper to extract function implementations from index.html for testing in isolation
function extractFunction(source, fnName) {
    const signature = `function ${fnName}(`;
    const start = source.indexOf(signature);
    assert.ok(start !== -1, `Function ${fnName} must exist in source`);
    let depth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        if (source[i] === '{') {
            if (depth === 0) bodyStart = i;
            depth++;
        } else if (source[i] === '}') {
            depth--;
            if (depth === 0 && bodyStart !== -1) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error(`Could not extract body for ${fnName}`);
}

// -----------------------------------------------------------------------------
// Lightweight Mock DOM
// -----------------------------------------------------------------------------
class MockElement {
    constructor(tagName = 'div', id = '') {
        this.tagName = tagName.toUpperCase();
        this.id = id;
        this.className = '';
        this.dataset = {};
        this.style = {};
        this.children = [];
        this.parentNode = null;
        this._innerHTML = '';
        this.attributes = {};
    }

    get innerHTML() {
        return this._innerHTML;
    }

    set innerHTML(html) {
        this._innerHTML = html;
        this.children = [];
        if (html.includes('thinking-timer')) {
            const timerEl = new MockElement('span');
            timerEl.className = 'thinking-timer';
            const match = html.match(/class="thinking-timer">([^<]*)</);
            if (match) timerEl.textContent = match[1];
            this.children.push(timerEl);
        }
        if (html.includes('thinking-pulse-dot')) {
            const dot = new MockElement('span');
            dot.className = 'thinking-pulse-dot';
            this.children.push(dot);
        }
    }

    get classList() {
        const self = this;
        const getClassSet = () => new Set(self.className.split(/\s+/).filter(Boolean));
        return {
            add(...cls) {
                const s = getClassSet();
                cls.forEach(c => s.add(c));
                self.className = Array.from(s).join(' ');
            },
            remove(...cls) {
                const s = getClassSet();
                cls.forEach(c => s.delete(c));
                self.className = Array.from(s).join(' ');
            },
            toggle(cls, force) {
                const s = getClassSet();
                if (force === true) s.add(cls);
                else if (force === false) s.delete(cls);
                else if (s.has(cls)) s.delete(cls);
                else s.add(cls);
                self.className = Array.from(s).join(' ');
                return s.has(cls);
            },
            contains(cls) {
                return getClassSet().has(cls);
            }
        };
    }

    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this.children.indexOf(child);
        if (idx !== -1) {
            this.children.splice(idx, 1);
            child.parentNode = null;
        }
        return child;
    }

    remove() {
        if (this.parentNode) {
            this.parentNode.removeChild(this);
        }
    }

    querySelector(selector) {
        if (selector === '.thinking-timer') {
            return this.children.find(c => c.className?.includes('thinking-timer')) || null;
        }
        if (selector === '.thinking-pulse-dot') {
            return this.children.find(c => c.className?.includes('thinking-pulse-dot')) || null;
        }
        return null;
    }

    querySelectorAll(selector) {
        const found = [];
        if (selector.includes('thinking-process-card')) {
            if (this.className.includes('thinking-process-card')) found.push(this);
        }
        for (const child of this.children) {
            if (typeof child.querySelectorAll === 'function') {
                found.push(...child.querySelectorAll(selector));
            }
        }
        return found;
    }
}

function setupTestEnvironment() {
    const chatContainer = new MockElement('div', 'chat-container');
    const compShell = new MockElement('div', 'input-bar-inner');
    const body = new MockElement('body');

    const domElements = new Map([
        ['chat-container', chatContainer],
        ['input-bar-inner', compShell]
    ]);

    const context = {
        document: {
            body,
            getElementById: (id) => domElements.get(id) || null,
            createElement: (tag) => new MockElement(tag),
            querySelectorAll: () => []
        },
        window: {
            __lastThinkingPhaseStartedAt: null,
            __lastUserMessage: '',
            addEventListener: () => {}
        },
        globalThis: {},
        Date,
        Math,
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
        escapeHtml: (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        updateChatEmptyStateVisibility: () => {},
        maybeAutoScroll: () => {},
        thinkingPhaseTimer: null
    };

    vm.createContext(context);

    // Extract and run resolveThinkingPhase, showThinkingIndicator, hideThinkingIndicator
    const resolveSource = extractFunction(indexHtml, 'resolveThinkingPhase');
    const showSource = extractFunction(indexHtml, 'showThinkingIndicator');
    const hideSource = extractFunction(indexHtml, 'hideThinkingIndicator');

    const timelineSource = extractFunction(indexHtml, 'startThinkingPhaseTimeline');

    vm.runInContext(resolveSource, context);
    vm.runInContext(timelineSource, context);
    vm.runInContext(showSource, context);
    vm.runInContext(hideSource, context);

    // Patch getElementById to find dynamically added chat-thinking-indicator
    context.document.getElementById = (id) => {
        if (id === 'chat-thinking-indicator') {
            return chatContainer.children.find(c => c.id === 'chat-thinking-indicator') || null;
        }
        return domElements.get(id) || null;
    };

    return {
        context,
        chatContainer,
        compShell,
        body,
        resolveThinkingPhase: context.resolveThinkingPhase,
        showThinkingIndicator: context.showThinkingIndicator,
        hideThinkingIndicator: context.hideThinkingIndicator
    };
}

// =============================================================================
// 1. Normal question: routes to Thinking... and disappears on generation
// =============================================================================
{
    console.log('1. Testing Normal LLM Question Activity Indicator...');
    const env = setupTestEnvironment();
    const sm = createInteractionStateMachine();

    // Normal question routing check
    const route = decideFrontendRoute('What is quantum entanglement?');
    assert.equal(route.requiresSources, false, 'General knowledge query does not require live sources');

    // Lifecycle starts
    sm.transition(InteractionState.SUBMITTING);
    assert.equal(sm.isProcessing(), true);

    // Normal LLM transitions to THINKING
    sm.transition(InteractionState.THINKING);
    env.showThinkingIndicator('Thinking');

    const indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator, 'Activity indicator element should be created in chat container');
    assert.equal(indicator.dataset.phase, 'thinking');
    assert.equal(indicator.dataset.phaseLabel, 'Thinking...');

    const timer = indicator.querySelector('.thinking-timer');
    assert.ok(timer, 'Thinking timer label should exist');
    assert.equal(timer.textContent, 'Thinking...', 'Normal question must display "Thinking..."');

    // First token received: transitions to GENERATING -> indicator disappears
    sm.transition(InteractionState.GENERATING);
    env.hideThinkingIndicator();
    assert.ok(indicator.classList.contains('chat-thinking-indicator-leaving'), 'Indicator must have leaving class');

    // Turn finishes cleanly
    sm.resetToIdle('turn_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false, 'Composer must return to unbusy usable state');
    console.log('  [PASS] Normal LLM question displayed "Thinking...", disappeared on stream start, and returned to idle.');
}

// =============================================================================
// 2. Live-search question: routes to Searching the web..., then Thinking..., then disappears
// =============================================================================
{
    console.log('2. Testing Live-Search Question Activity Indicator & Synthesis Transition...');
    const env = setupTestEnvironment();
    const sm = createInteractionStateMachine();

    // Live-search routing check
    const route = decideFrontendRoute('Who is the current Prime Minister of the UK in 2026?');
    assert.ok(route.requiresSources || route.route === 'live_required', 'Current fact query must require live sources');

    // Lifecycle starts in SUBMITTING
    sm.transition(InteractionState.SUBMITTING);

    // Live search enters SEARCHING
    sm.transition(InteractionState.SEARCHING);
    env.showThinkingIndicator('Searching the web...');

    let indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator, 'Indicator element must exist');
    assert.equal(indicator.dataset.phase, 'searching');
    assert.equal(indicator.dataset.phaseLabel, 'Searching the web...');

    let timer = indicator.querySelector('.thinking-timer');
    assert.equal(timer.textContent, 'Searching the web...', 'Live search must display "Searching the web..."');

    // Web search completes -> LLM synthesis begins
    sm.transition(InteractionState.THINKING);
    env.showThinkingIndicator('Thinking...');

    assert.equal(indicator.dataset.phase, 'thinking');
    assert.equal(indicator.dataset.phaseLabel, 'Thinking...');
    assert.equal(timer.textContent, 'Thinking...', 'After search, indicator must update seamlessly to "Thinking..."');

    // Model response stream arrives: GENERATING -> indicator disappears
    sm.transition(InteractionState.GENERATING);
    env.hideThinkingIndicator();
    assert.ok(indicator.classList.contains('chat-thinking-indicator-leaving'), 'Indicator must leave when response starts');

    // Request completes
    sm.resetToIdle('live_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false, 'Composer must be usable after live search completes');
    console.log('  [PASS] Live search displayed "Searching the web...", transitioned to "Thinking...", and disappeared on generation.');
}

// =============================================================================
// 3. Failed request: indicator disappears and UI returns to usable state
// =============================================================================
{
    console.log('3. Testing Failed Request Handling...');
    const env = setupTestEnvironment();
    const sm = createInteractionStateMachine();

    sm.transition(InteractionState.SUBMITTING);
    sm.transition(InteractionState.THINKING);
    env.showThinkingIndicator('Thinking...');

    const indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator);

    // Error occurs
    sm.transition(InteractionState.ERROR, { error: new Error('Network failure 503') });
    env.hideThinkingIndicator();

    assert.equal(sm.getState(), InteractionState.ERROR);
    assert.ok(indicator.classList.contains('chat-thinking-indicator-leaving'), 'Indicator must be dismissed on error');

    // Error recovery cleanup
    sm.resetToIdle('error_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false, 'UI must return to usable non-busy state after error');
    console.log('  [PASS] Failed request dismissed indicator and returned UI to usable idle state.');
}

// =============================================================================
// 4. Cancelled request: user stop dismisses indicator and frees UI immediately
// =============================================================================
{
    console.log('4. Testing Cancelled Request Handling...');
    const env = setupTestEnvironment();
    const sm = createInteractionStateMachine();

    sm.transition(InteractionState.SUBMITTING);
    sm.transition(InteractionState.SEARCHING);
    env.showThinkingIndicator('Searching the web...');

    const indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator);
    assert.equal(indicator.dataset.phase, 'searching');

    // User presses Stop
    sm.transition(InteractionState.INTERRUPTED, { metadata: { reason: 'user_aborted' } });
    env.hideThinkingIndicator();

    assert.equal(sm.getState(), InteractionState.INTERRUPTED);
    assert.ok(indicator.classList.contains('chat-thinking-indicator-leaving'), 'Indicator must leave immediately on abort');

    sm.resetToIdle('aborted_handled');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false, 'UI must be ready for next request');
    console.log('  [PASS] Cancelled request dismissed indicator immediately and freed the composer.');
}

// =============================================================================
// 5. VTT Question: follows the same state machine and displays appropriate indicator
// =============================================================================
{
    console.log('5. Testing VTT Question Workflow...');
    const env = setupTestEnvironment();
    const sm = createInteractionStateMachine();

    // User speaks: LISTENING
    sm.transition(InteractionState.LISTENING);
    assert.equal(sm.isListening(), true);
    assert.equal(sm.isBusy(), false);

    // Audio received: TRANSCRIBING
    sm.transition(InteractionState.TRANSCRIBING);
    assert.equal(sm.isProcessing(), true);
    assert.equal(sm.isBusy(), true);

    // Transcribed text submitted: "Search for today's headlines"
    const transcribedText = "search for today's headlines";
    const route = decideFrontendRoute(transcribedText);
    assert.ok(route.requiresSources || route.route === 'live_required', 'Voice search query requires live sources');

    // Enters SUBMITTING then SEARCHING
    sm.transition(InteractionState.SUBMITTING, { metadata: { text: transcribedText, isVoice: true } });
    sm.transition(InteractionState.SEARCHING);
    env.showThinkingIndicator('Searching the web...');

    let indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator);
    assert.equal(indicator.dataset.phase, 'searching');
    assert.equal(indicator.querySelector('.thinking-timer').textContent, 'Searching the web...');

    // Web search completes -> LLM answer synthesis
    sm.transition(InteractionState.THINKING);
    env.showThinkingIndicator('Thinking...');
    assert.equal(indicator.querySelector('.thinking-timer').textContent, 'Thinking...');

    // Generation starts
    sm.transition(InteractionState.GENERATING);
    env.hideThinkingIndicator();
    assert.ok(indicator.classList.contains('chat-thinking-indicator-leaving'));

    // Audio playback for converse: SPEAKING
    sm.transition(InteractionState.SPEAKING);
    assert.equal(sm.isSpeaking(), true);

    // Complete
    sm.resetToIdle('vtt_complete');
    assert.equal(sm.getState(), InteractionState.IDLE);
    assert.equal(sm.isBusy(), false);
    console.log('  [PASS] VTT question executed through LISTENING -> TRANSCRIBING -> SEARCHING -> THINKING -> GENERATING -> SPEAKING -> IDLE.');
}

// =============================================================================
// 6. Verification of No Fake Chain-of-Thought
// =============================================================================
{
    console.log('6. Verifying No Fake Chain-of-Thought in Indicator DOM...');
    const env = setupTestEnvironment();

    env.showThinkingIndicator('Thinking...');
    const indicator = env.chatContainer.children.find(c => c.id === 'chat-thinking-indicator');
    assert.ok(indicator);

    // Ensure no fake CoT steps are present in the DOM
    const html = indicator.innerHTML;
    assert.equal(html.includes('thinking-chain-of-thought'), false, 'Indicator must not render fake chain of thought container');
    assert.equal(html.includes('thinking-cot-step'), false, 'Indicator must not render fake CoT steps');
    assert.equal(html.includes('thinking-cot-number'), false, 'Indicator must not render fake step numbers');
    assert.ok(html.includes('thinking-pulse-dot'), 'Indicator must include authentic pulse dot');
    assert.ok(html.includes('thinking-timer'), 'Indicator must include authentic timer/label');
    console.log('  [PASS] Activity indicator contains only authentic pulse dot and action text, with zero simulated CoT.');
}

console.log('--- ALL PHASE 3 ACTIVITY INDICATOR & ROUTING TESTS PASSED ---');
process.exit(0);
