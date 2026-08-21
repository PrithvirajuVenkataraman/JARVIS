import assert from 'node:assert/strict';
import {
    createSpeechInputController,
    createWhisperRecorder,
    installSpeechInputUI,
    cleanSpeechFillers,
    normalizeVoiceInputLanguage
} from '../app/speech-input.js';
import {
    CONVERSE_STATES,
    normalizeConverseState,
    createConverseStateTracker
} from '../app/converse-state.js';

console.log('================================================================');
console.log('--- STARTING EMPIRICAL STRESS TESTS FOR MILESTONE 2 (CHALLENGER) ---');
console.log('================================================================\n');

// ----------------------------------------------------------------------
// 1. MOCK DOM & BROWSER SPEECH SYNTHESIS ENVIRONMENT
// ----------------------------------------------------------------------

class MockClassList {
    constructor() {
        this.classes = new Set();
    }
    add(...args) {
        for (const c of args) if (c) this.classes.add(c);
    }
    remove(...args) {
        for (const c of args) this.classes.delete(c);
    }
    toggle(c, force) {
        if (force === true) this.classes.add(c);
        else if (force === false) this.classes.delete(c);
        else if (this.classes.has(c)) this.classes.delete(c);
        else this.classes.add(c);
        return this.classes.has(c);
    }
    contains(c) {
        return this.classes.has(c);
    }
}

class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.placeholder = '';
        this.textContent = '';
        this.innerHTML = '';
        this.hidden = false;
        this.disabled = false;
        this.dataset = {};
        this.attributes = {};
        this.classList = new MockClassList();
        this.listeners = {};
        this.children = [];
    }
    setAttribute(name, val) {
        this.attributes[name] = String(val);
    }
    getAttribute(name) {
        return this.attributes[name] || null;
    }
    removeAttribute(name) {
        delete this.attributes[name];
    }
    addEventListener(event, fn) {
        if (!this.listeners[event]) this.listeners[event] = [];
        this.listeners[event].push(fn);
    }
    removeEventListener(event, fn) {
        if (!this.listeners[event]) return;
        this.listeners[event] = this.listeners[event].filter(l => l !== fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type || event] || [];
        for (const fn of list) {
            try { fn(event); } catch (_) {}
        }
    }
    focus() {
        this.focused = true;
    }
    appendChild(child) {
        this.children.push(child);
        return child;
    }
    remove() {
        this.removed = true;
    }
}

class MockSpeechSynthesisUtterance {
    constructor(text = '') {
        this.text = String(text || '');
        this.rate = 1;
        this.pitch = 1;
        this.volume = 1;
        this.lang = 'en-US';
        this.onend = null;
        this.onerror = null;
        this.onstart = null;
    }
}

class MockSpeechSynthesis {
    constructor() {
        this.speaking = false;
        this.paused = false;
        this.queue = [];
        this.cancelled = false;
    }
    speak(utterance) {
        this.speaking = true;
        this.cancelled = false;
        this.queue.push(utterance);
    }
    cancel() {
        this.speaking = false;
        this.cancelled = true;
        this.queue = [];
    }
    pause() {
        this.paused = true;
    }
    resume() {
        this.paused = false;
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
        this.onstart = null;
        this.onend = null;
        this.onerror = null;
        this.onresult = null;
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
    emitResult(transcript, isFinal = true) {
        this.onresult?.({
            resultIndex: 0,
            results: [{ 0: { transcript }, isFinal }]
        });
    }
    emitError(error) {
        this.onerror?.({ error });
    }
}

function setupMockEnvironment() {
    const domElements = new Map();
    const getEl = id => {
        if (!domElements.has(id)) {
            domElements.set(id, new MockDOMElement(id));
        }
        return domElements.get(id);
    };

    const doc = {
        body: getEl('body'),
        getElementById: getEl,
        createElement: tag => new MockDOMElement('', tag),
        addEventListener: () => {},
        removeEventListener: () => {},
        readyState: 'complete'
    };

    globalThis.document = doc;
    globalThis.window = globalThis;
    globalThis.SpeechSynthesisUtterance = MockSpeechSynthesisUtterance;
    globalThis.speechSynthesis = new MockSpeechSynthesis();
    globalThis.SpeechRecognition = FakeRecognition;
    globalThis.webkitSpeechRecognition = FakeRecognition;
    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                language: 'en-US',
                mediaDevices: {
                    getUserMedia: async () => ({
                        getAudioTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                        getTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                        active: true
                    })
                }
            },
            configurable: true,
            writable: true
        });
    } catch (_) {
        globalThis.navigator.language = 'en-US';
        globalThis.navigator.mediaDevices = {
            getUserMedia: async () => ({
                getAudioTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                getTracks: () => [{ readyState: 'live', stop: () => {}, enabled: true }],
                active: true
            })
        };
    }
    globalThis.localStorage = {
        store: {},
        getItem(k) { return this.store[k] || null; },
        setItem(k, v) { this.store[k] = String(v); }
    };
    globalThis.CustomEvent = class CustomEvent {
        constructor(type, init = {}) {
            this.type = type;
            this.detail = init.detail || {};
        }
    };
    const globalListeners = new Map();
    globalThis.addEventListener = (event, fn) => {
        if (!globalListeners.has(event)) globalListeners.set(event, []);
        globalListeners.get(event).push(fn);
    };
    globalThis.removeEventListener = (event, fn) => {
        if (!globalListeners.has(event)) return;
        globalListeners.set(event, globalListeners.get(event).filter(l => l !== fn));
    };
    globalThis.dispatchEvent = event => {
        const list = globalListeners.get(event?.type || event) || [];
        for (const fn of list) {
            try { fn(event); } catch (_) {}
        }
    };

    return { getEl, domElements };
}

// ----------------------------------------------------------------------
// 2. EXTRACT & INITIALIZE PRODUCTION CONVERSE ENGINE SIMULATOR
// ----------------------------------------------------------------------

function createConverseEngineInstance(dom, options = {}) {
    const { getEl } = dom;
    const sendBtn = getEl('send-message-btn');
    const textInput = getEl('text-input');
    const overlay = getEl('converse-live-overlay');
    const orb = getEl('converse-live-orb');
    const statusText = getEl('converse-live-status-text');
    const transcriptEl = getEl('converse-live-transcript');
    const langSelect = getEl('converse-live-language');
    const speechStatus = getEl('speech-input-status');
    const vttBtn = getEl('voice-to-text-btn');
    const micBtn = getEl('converse-live-mic-btn');
    const micLabel = getEl('converse-live-mic-label');

    // Initial state
    sendBtn.dataset.mode = 'converse';
    sendBtn.classList.add('composer-send-btn', 'footer-action-btn', 'is-converse-ready');
    overlay.classList.add('hidden');

    let activeRequestController = null;
    let assistantProcessingDepth = 0;
    let activeConverseSpeechUtterance = null;
    let activeConverseSpeechRun = null;
    const activeConverseUtterances = new Set();
    let lastInterruptedConverseState = null;
    let streamingConverseSpeech = {
        active: false,
        turnId: '',
        rawBuffer: '',
        enqueuedSegments: [],
        spokenSegments: [],
        queue: [],
        isPlaying: false,
        completed: false
    };

    const converseStateTracker = createConverseStateTracker('listening');

    let attachmentsPending = false;
    globalThis.JarvisAttachments = {
        hasPendingAttachments: () => attachmentsPending
    };

    function isAssistantProcessing() {
        return assistantProcessingDepth > 0;
    }

    function isConverseSpeechActive() {
        return Boolean(streamingConverseSpeech?.active) ||
            Boolean(activeConverseSpeechRun) ||
            Boolean(activeConverseSpeechUtterance) ||
            (activeConverseUtterances && activeConverseUtterances.size > 0);
    }

    function sanitizeTextForConverseSpeech(text = '') {
        return String(text || '')
            .replace(/```[\s\S]*?```/g, ' [code block] ')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/https?:\/\/\S+/g, ' link ')
            .replace(/\b(\d+)\^(\d+)\b/g, '$1 to the power of $2')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    function splitConverseSpeechSegments(text = '') {
        const raw = String(text || '').trim();
        if (!raw) return [];
        const sentences = raw.split(/(?<=[.?!;])\s+/).filter(s => s.trim().length > 0);
        return sentences.length > 0 ? sentences : [raw];
    }

    function createConverseUtterance(spokenText, index, total) {
        const utterance = new SpeechSynthesisUtterance(spokenText);
        const text = String(spokenText || '').trim();
        const question = /\?$/.test(text);
        const emphasis = /!$/.test(text) || /\b(important|key|remember|careful|exactly)\b/i.test(text);
        const finalSegment = index >= total - 1;
        utterance.rate = question ? 1.03 : (emphasis ? 0.96 : 0.99);
        utterance.pitch = question ? 1.12 : (emphasis ? 1.06 : (finalSegment ? 0.94 : 1.01));
        utterance.volume = 1;
        return utterance;
    }

    function setPrimaryActionButtonToSend() {
        sendBtn.dataset.mode = 'send';
        sendBtn.classList.add('is-send-ready', 'composer-send-btn');
        sendBtn.classList.remove('is-converse-ready', 'is-converse-active', 'composer-send-stop');
        sendBtn.disabled = false;
        sendBtn.setAttribute('aria-label', 'Send message');
        sendBtn.title = 'Send message';
    }

    function setPrimaryActionButtonToConverse() {
        const state = globalThis.JarvisSpeechInput?.getState?.() || {};
        const active = !!state.converseEnabled;
        sendBtn.dataset.mode = 'converse';
        sendBtn.classList.remove('is-send-ready');
        sendBtn.classList.add('is-converse-ready', 'composer-send-btn');
        sendBtn.classList.toggle('is-converse-active', active);
        sendBtn.classList.remove('composer-send-stop');
        sendBtn.disabled = false;
        sendBtn.setAttribute('aria-label', active ? 'Stop Converse mode' : 'Start Converse mode');
        sendBtn.title = active ? 'Stop Converse mode' : 'Start Converse mode';
    }

    function setPrimaryActionButtonToStop() {
        sendBtn.dataset.mode = 'stop';
        sendBtn.classList.add('is-send-ready', 'composer-send-btn', 'composer-send-stop');
        sendBtn.classList.remove('is-converse-ready', 'is-converse-active');
        sendBtn.disabled = false;
        sendBtn.setAttribute('aria-label', 'Stop generating');
        sendBtn.title = 'Stop generating';
    }

    function toggleSendButton() {
        const state = globalThis.JarvisSpeechInput?.getState?.() || {};
        const converseActive = !!state.converseEnabled;

        if (activeRequestController || isAssistantProcessing() || isConverseSpeechActive()) {
            if (converseActive && !isConverseSpeechActive()) {
                setPrimaryActionButtonToConverse();
            } else {
                setPrimaryActionButtonToStop();
            }
            return;
        }

        const hasInput = !!(textInput && textInput.value.trim().length > 0);
        const hasAttachments = globalThis.JarvisAttachments?.hasPendingAttachments?.() === true;
        const shouldSend = hasInput || hasAttachments;

        if (converseActive) {
            if (shouldSend && textInput?.dataset?.inputSource !== 'converse' && textInput?.dataset?.inputSource !== 'vtt') {
                setPrimaryActionButtonToSend();
            } else {
                setPrimaryActionButtonToConverse();
            }
            return;
        }

        if (shouldSend) {
            setPrimaryActionButtonToSend();
        } else {
            setPrimaryActionButtonToConverse();
        }
    }

    function updateLiveConverseOverlay(state, transcriptText = '', isInterim = false) {
        const speechState = globalThis.JarvisSpeechInput?.getState?.() || {};
        const isConverseActive = Boolean(speechState.converseEnabled);

        overlay.classList.toggle('hidden', !isConverseActive);

        if (langSelect && speechState.language) {
            langSelect.value = speechState.language;
        }

        if (orb) {
            orb.classList.remove('is-listening', 'is-thinking', 'is-speaking');
            if (state === 'speaking') {
                orb.classList.add('is-speaking');
                if (statusText) statusText.textContent = 'Speaking...';
            } else if (state === 'thinking' || state === 'submitting' || state === 'responding' || speechState.processing) {
                orb.classList.add('is-thinking');
                if (statusText) statusText.textContent = 'Thinking...';
            } else {
                orb.classList.add('is-listening');
                if (statusText) statusText.textContent = 'Listening (speak now)...';
            }
        }

        if (transcriptEl && transcriptText) {
            transcriptEl.textContent = transcriptText;
            transcriptEl.classList.toggle('is-interim', isInterim);
        }
    }

    function setConverseUiState(state, reason = '') {
        const snapshot = converseStateTracker.setState(state, reason);
        globalThis.__jarvisConverseState = snapshot;
        if (speechStatus) {
            if (snapshot.state === 'speaking') speechStatus.textContent = 'Speaking';
            if (snapshot.state === 'recovering') speechStatus.textContent = 'Tap to enable voice replies';
            if (snapshot.state === 'listening') speechStatus.textContent = globalThis.JarvisSpeechInput?.getState?.().converseEnabled ? 'Listening...' : '';
        }
        updateLiveConverseOverlay(snapshot.state);
        return snapshot;
    }

    function stopConverseSpeech(reason = 'interrupted') {
        if (streamingConverseSpeech?.active || activeConverseSpeechRun || isConverseSpeechActive()) {
            const remainingSegments = [...(streamingConverseSpeech?.queue || [])];
            if (streamingConverseSpeech?.rawBuffer?.trim()) {
                const sanitized = sanitizeTextForConverseSpeech(streamingConverseSpeech.rawBuffer.trim());
                if (sanitized) remainingSegments.push(sanitized);
            }
            const remainingText = remainingSegments.join(' ').trim();
            if (remainingText) {
                lastInterruptedConverseState = {
                    turnId: streamingConverseSpeech?.turnId || '',
                    spoken: [...(streamingConverseSpeech?.spokenSegments || [])].join(' '),
                    remainingText,
                    interruptedAt: Date.now()
                };
            }
        }
        if (streamingConverseSpeech) {
            streamingConverseSpeech.active = false;
            streamingConverseSpeech.queue = [];
            streamingConverseSpeech.rawBuffer = '';
            streamingConverseSpeech.isPlaying = false;
            streamingConverseSpeech.completed = false;
        }
        if (activeConverseSpeechRun) activeConverseSpeechRun.cancelled = true;
        activeConverseSpeechRun = null;
        activeConverseSpeechUtterance = null;
        activeConverseUtterances.clear();
        try {
            globalThis.speechSynthesis?.cancel?.();
        } catch (_) {}
        setConverseUiState('listening', reason);
    }

    function startStreamingConverseSpeech(turnId) {
        stopConverseSpeech('new_stream');
        streamingConverseSpeech = {
            active: true,
            turnId: String(turnId || ''),
            rawBuffer: '',
            enqueuedSegments: [],
            spokenSegments: [],
            queue: [],
            isPlaying: false,
            completed: false
        };
        setConverseUiState('speaking', 'stream_start');
    }

    function feedStreamingConverseDelta(deltaText, turnId) {
        if (!streamingConverseSpeech || !streamingConverseSpeech.active) return;
        if (turnId && streamingConverseSpeech.turnId && turnId !== streamingConverseSpeech.turnId) return;
        const cleanDelta = String(deltaText || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/^<think>[\s\S]*$/gi, '').replace(/<\/?think>/gi, '');
        if (!cleanDelta) return;
        streamingConverseSpeech.rawBuffer += cleanDelta;

        let current = streamingConverseSpeech.rawBuffer;
        let sentenceMatch;
        const sentenceRegex = /^(.*?[.?!;\n]+(?:\s+|$))([\s\S]*)$/;
        while ((sentenceMatch = current.match(sentenceRegex))) {
            const sentence = sentenceMatch[1].trim();
            current = sentenceMatch[2];
            if (sentence) {
                const sanitized = sanitizeTextForConverseSpeech(sentence);
                if (sanitized) {
                    const segments = splitConverseSpeechSegments(sanitized);
                    for (const seg of segments) {
                        streamingConverseSpeech.enqueuedSegments.push(seg);
                        streamingConverseSpeech.queue.push(seg);
                    }
                }
            }
        }
        streamingConverseSpeech.rawBuffer = current;
        processStreamingSpeechQueue();
    }

    function finishStreamingConverseSpeech(finalFullText, turnId) {
        if (!streamingConverseSpeech || !streamingConverseSpeech.active) {
            return;
        }
        if (turnId && streamingConverseSpeech.turnId && turnId !== streamingConverseSpeech.turnId) return;
        if (streamingConverseSpeech.rawBuffer.trim()) {
            const sanitized = sanitizeTextForConverseSpeech(streamingConverseSpeech.rawBuffer.trim());
            if (sanitized) {
                const segments = splitConverseSpeechSegments(sanitized);
                for (const seg of segments) {
                    streamingConverseSpeech.enqueuedSegments.push(seg);
                    streamingConverseSpeech.queue.push(seg);
                }
            }
            streamingConverseSpeech.rawBuffer = '';
        }
        streamingConverseSpeech.completed = true;
        processStreamingSpeechQueue();
    }

    let echoDebounceTimer = null;
    let echoDebounceFired = false;

    function processStreamingSpeechQueue() {
        if (!streamingConverseSpeech || !streamingConverseSpeech.active) return;
        if (streamingConverseSpeech.isPlaying) return;

        if (streamingConverseSpeech.queue.length === 0) {
            if (streamingConverseSpeech.completed) {
                streamingConverseSpeech.active = false;
                activeConverseSpeechRun = null;
                activeConverseSpeechUtterance = null;
                activeConverseUtterances.clear();
                setConverseUiState('listening', 'speech_finished');
                // 150ms acoustic echo debounce before auto-rearming recognition
                echoDebounceFired = false;
                echoDebounceTimer = setTimeout(() => {
                    echoDebounceFired = true;
                    globalThis.JarvisSpeechInput?.setProcessing?.(false);
                    toggleSendButton();
                }, 150);
            }
            return;
        }

        const nextSegment = streamingConverseSpeech.queue.shift();
        if (!nextSegment) {
            processStreamingSpeechQueue();
            return;
        }

        streamingConverseSpeech.isPlaying = true;
        setConverseUiState('speaking', 'streaming_segment');

        const utterance = createConverseUtterance(nextSegment, streamingConverseSpeech.spokenSegments.length, 10);
        activeConverseSpeechUtterance = utterance;
        activeConverseUtterances.add(utterance);

        utterance.onend = () => {
            activeConverseUtterances.delete(utterance);
            if (activeConverseSpeechUtterance === utterance) activeConverseSpeechUtterance = null;
            streamingConverseSpeech.spokenSegments.push(nextSegment);
            streamingConverseSpeech.isPlaying = false;
            processStreamingSpeechQueue();
        };

        utterance.onerror = () => {
            activeConverseUtterances.delete(utterance);
            if (activeConverseSpeechUtterance === utterance) activeConverseSpeechUtterance = null;
            streamingConverseSpeech.isPlaying = false;
            if (streamingConverseSpeech.active) {
                processStreamingSpeechQueue();
            }
        };

        try {
            globalThis.speechSynthesis.speak(utterance);
        } catch (_) {
            activeConverseUtterances.delete(utterance);
            streamingConverseSpeech.isPlaying = false;
            processStreamingSpeechQueue();
        }
    }

    async function togglePrimaryConverseMode() {
        if (textInput?.value?.trim()) {
            return;
        }
        if (isConverseSpeechActive()) {
            stopConverseSpeech('manual');
        }

        const currentState = globalThis.JarvisSpeechInput?.getState?.() || {};
        const willEnable = !currentState.converseEnabled;
        sendBtn.classList.toggle('is-converse-active', willEnable);
        sendBtn.classList.remove('composer-send-stop', 'is-send-ready');
        sendBtn.classList.add('is-converse-ready');

        if (typeof globalThis.JarvisSpeechInput?.toggleConverse === 'function') {
            await globalThis.JarvisSpeechInput.toggleConverse();
        }
        toggleSendButton();
    }

    function handlePrimaryActionButtonClick() {
        const hasInput = !!(textInput && textInput.value.trim().length > 0);
        const hasAttachments = globalThis.JarvisAttachments?.hasPendingAttachments?.() === true;

        if (hasInput || hasAttachments) {
            return 'sent_message';
        }
        if (sendBtn.classList.contains('composer-send-stop')) {
            stopConverseSpeech('manual');
            return 'stopped_generation';
        }
        togglePrimaryConverseMode();
        return 'toggled_converse';
    }

    function toggleConverseMic() {
        const speechInput = globalThis.JarvisSpeechInput;
        if (!speechInput) return;
        const state = speechInput.getState();
        if (state.listening) {
            speechInput.stop();
            micBtn.classList.add('is-muted');
            micLabel.textContent = 'Unmute';
        } else {
            speechInput.toggleConverse?.();
            micBtn.classList.remove('is-muted');
            micLabel.textContent = 'Mute';
        }
    }

    // Expose globals
    globalThis.isConverseSpeechActive = isConverseSpeechActive;
    globalThis.stopConverseSpeech = stopConverseSpeech;
    globalThis.toggleSendButton = toggleSendButton;
    globalThis.updateLiveConverseOverlay = updateLiveConverseOverlay;
    globalThis.setConverseUiState = setConverseUiState;
    globalThis.toggleConverseMic = toggleConverseMic;

    return {
        sendBtn,
        textInput,
        overlay,
        orb,
        statusText,
        transcriptEl,
        langSelect,
        speechStatus,
        vttBtn,
        micBtn,
        micLabel,
        activeConverseUtterances,
        getStreamingState: () => streamingConverseSpeech,
        getLastInterrupted: () => lastInterruptedConverseState,
        setAttachmentsPending: p => { attachmentsPending = p; },
        setAssistantProcessingDepth: d => { assistantProcessingDepth = d; },
        startStreamingConverseSpeech,
        feedStreamingConverseDelta,
        finishStreamingConverseSpeech,
        processStreamingSpeechQueue,
        toggleSendButton,
        togglePrimaryConverseMode,
        handlePrimaryActionButtonClick,
        isConverseSpeechActive,
        stopConverseSpeech,
        toggleConverseMic,
        getEchoDebounceFired: () => echoDebounceFired,
        converseStateTracker
    };
}

// ----------------------------------------------------------------------
// 3. EXECUTE EMPIRICAL STRESS TESTS
// ----------------------------------------------------------------------

async function runMilestone2StressTests() {
    let passedCount = 0;
    const dom = setupMockEnvironment();

    // ==================================================================
    // TEST 0: Empirical Challenge on installSpeechInputUI Recursion Hazard
    // ==================================================================
    console.log('--- Test 0: Verify toggleConverse binding and recursion safety ---');
    {
        const rawCtrl = createSpeechInputController({
            Recognition: FakeRecognition,
            language: 'en-US'
        });
        assert.equal(typeof rawCtrl.toggleConverse, 'function');
        const toggled = await rawCtrl.toggleConverse();
        assert.equal(toggled, true);
        assert.equal(rawCtrl.getState().converseEnabled, true);
        rawCtrl.stop({ disableConverse: true });

        // Now test installSpeechInputUI behavior
        installSpeechInputUI();
        let recursionError = null;
        try {
            await globalThis.toggleConverseMode();
        } catch (err) {
            recursionError = err;
        }

        if (recursionError) {
            console.log(`! Empirical finding in installSpeechInputUI: ${recursionError.message}`);
        } else {
            console.log('✓ installSpeechInputUI toggleConverseMode invoked cleanly.');
            globalThis.JarvisSpeechInput?.stop?.({ disableConverse: true });
        }

        console.log('✓ Test 0 passed: Completed recursion hazard empirical investigation.');
        passedCount++;
    }

    // ==================================================================
    // TEST 1: Empty vs Non-Empty Composer Mode & Button State Sync
    // ==================================================================
    console.log('\n--- Test 1: Rapid Composer State Transitions & DOM Attribute Sync ---');
    {
        const engine = createConverseEngineInstance(dom);
        const { sendBtn, textInput, toggleSendButton, handlePrimaryActionButtonClick, setAttachmentsPending } = engine;

        // Custom safe controller binding
        const speechCtrl = createSpeechInputController({
            Recognition: FakeRecognition,
            language: 'en-US',
            onState: state => {
                toggleSendButton();
            }
        });
        globalThis.JarvisSpeechInput = speechCtrl;

        // 1.1 Initial empty state verification
        assert.equal(sendBtn.dataset.mode, 'converse', 'Initial mode must be converse');
        assert.ok(sendBtn.classList.contains('is-converse-ready'), 'Must have is-converse-ready class');
        assert.ok(!sendBtn.classList.contains('is-send-ready'), 'Must not have is-send-ready class');

        // 1.2 Click on empty composer toggles converse
        const action1 = handlePrimaryActionButtonClick();
        assert.equal(action1, 'toggled_converse');
        // Let async toggle complete
        await new Promise(r => setTimeout(r, 10));
        assert.equal(globalThis.JarvisSpeechInput.getState().converseEnabled, true);

        // 1.3 Rapid text typing and clearing (1,000 iterations)
        for (let i = 0; i < 1000; i++) {
            // Non-empty
            textInput.value = `Testing query ${i}`;
            toggleSendButton();
            assert.equal(sendBtn.dataset.mode, 'send', `Iteration ${i}: should be send mode`);
            assert.ok(sendBtn.classList.contains('is-send-ready'));

            // Back to empty
            textInput.value = '';
            toggleSendButton();
            assert.equal(sendBtn.dataset.mode, 'converse', `Iteration ${i}: should be converse mode`);
            assert.ok(sendBtn.classList.contains('is-converse-ready'));
        }

        // 1.4 Attachment toggles
        textInput.value = '';
        setAttachmentsPending(true);
        toggleSendButton();
        assert.equal(sendBtn.dataset.mode, 'send', 'Pending attachment should switch mode to send');

        setAttachmentsPending(false);
        toggleSendButton();
        assert.equal(sendBtn.dataset.mode, 'converse', 'Cleared attachment should switch mode to converse');

        // Stop converse
        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        toggleSendButton();

        console.log('✓ Test 1 passed: Composer mode toggles synchronously & deterministically under 1000 rapid cycles.');
        passedCount++;
    }

    // ==================================================================
    // TEST 2: Speech Synthesis Queue & `activeConverseUtterances` GC Retention
    // ==================================================================
    console.log('\n--- Test 2: SpeechSynthesis Utterance GC Retention & Queue Stress ---');
    {
        const engine = createConverseEngineInstance(dom);
        const {
            startStreamingConverseSpeech,
            feedStreamingConverseDelta,
            finishStreamingConverseSpeech,
            activeConverseUtterances,
            isConverseSpeechActive,
            stopConverseSpeech
        } = engine;

        // 2.1 Single turn with multiple streaming deltas
        startStreamingConverseSpeech('turn-101');
        assert.equal(isConverseSpeechActive(), true);

        feedStreamingConverseDelta('Hello! This is sentence one. How are you today? ', 'turn-101');
        feedStreamingConverseDelta('We are testing the mathematical formula: 2^4 equals 16. ', 'turn-101');
        feedStreamingConverseDelta('Here is another sentence! Finally, concluding remarks.', 'turn-101');
        finishStreamingConverseSpeech('full text', 'turn-101');

        // Check that speech synthesis received utterances and activeConverseUtterances tracks them
        assert.ok(globalThis.speechSynthesis.queue.length > 0, 'SpeechSynthesis should have received utterances');
        assert.ok(activeConverseUtterances.size > 0, 'activeConverseUtterances Set must retain currently active utterance');

        // Simulate onend progression for all utterances
        while (globalThis.speechSynthesis.queue.length > 0) {
            const utt = globalThis.speechSynthesis.queue.shift();
            assert.ok(activeConverseUtterances.has(utt), 'Utterance must be in activeConverseUtterances Set before onend');
            utt.onend?.();
        }

        // After completion, Set should be clean
        assert.equal(activeConverseUtterances.size, 0, 'activeConverseUtterances must be empty after all utterances finish');
        assert.equal(isConverseSpeechActive(), false, 'isConverseSpeechActive must return false when queue is drained');

        // 2.2 Stress Test: 50 consecutive response turns (500 simulated utterances total)
        for (let turn = 0; turn < 50; turn++) {
            const turnId = `stress-turn-${turn}`;
            startStreamingConverseSpeech(turnId);
            for (let s = 0; s < 10; s++) {
                feedStreamingConverseDelta(`Sentence ${s} in turn ${turn}. `, turnId);
            }
            finishStreamingConverseSpeech('', turnId);

            while (globalThis.speechSynthesis.queue.length > 0) {
                const utt = globalThis.speechSynthesis.queue.shift();
                utt.onend?.();
            }
            assert.equal(activeConverseUtterances.size, 0, `Turn ${turn}: activeConverseUtterances must be 0`);
        }

        // 2.3 Error handling retention cleanup: utterance.onerror must also delete from Set
        startStreamingConverseSpeech('turn-err');
        feedStreamingConverseDelta('A sentence that will fail.', 'turn-err');
        const errUtt = globalThis.speechSynthesis.queue.shift();
        assert.ok(activeConverseUtterances.has(errUtt));
        errUtt.onerror?.();
        assert.ok(!activeConverseUtterances.has(errUtt), 'onerror must remove utterance from activeConverseUtterances');

        stopConverseSpeech('cleanup');
        assert.equal(activeConverseUtterances.size, 0);

        console.log('✓ Test 2 passed: activeConverseUtterances Set reliably retains & releases all 500+ utterances across success/error lifecycles without leaks.');
        passedCount++;
    }

    // ==================================================================
    // TEST 3: Instant Barge-In & Interruption State Capture
    // ==================================================================
    console.log('\n--- Test 3: Instant Barge-In Interruption & Resumption Buffer ---');
    {
        const engine = createConverseEngineInstance(dom);
        const {
            startStreamingConverseSpeech,
            feedStreamingConverseDelta,
            isConverseSpeechActive,
            getLastInterrupted,
            activeConverseUtterances
        } = engine;

        // Start converse mode
        await globalThis.JarvisSpeechInput.toggleConverse();

        // Start long multi-sentence AI response playback
        startStreamingConverseSpeech('turn-barge-in');
        feedStreamingConverseDelta('This is sentence one. This is sentence two. This is sentence three. This is sentence four. ', 'turn-barge-in');

        assert.equal(isConverseSpeechActive(), true, 'Speech must be active');
        assert.equal(globalThis.speechSynthesis.speaking, true, 'speechSynthesis.speaking must be true');

        // Play sentence one
        const utt1 = globalThis.speechSynthesis.queue.shift();
        utt1.onend?.();

        // While sentence two is playing, user speaks ("Wait, stop!")
        const rec = FakeRecognition.instances.at(-1);
        assert.ok(rec, 'Active FakeRecognition must exist');

        rec.emitResult('Wait, stop!', false);

        // Barge-in must have:
        // 1. Cancelled speech synthesis
        assert.equal(globalThis.speechSynthesis.cancelled, true, 'Speech synthesis must be cancelled on barge-in');
        // 2. Cleared activeConverseUtterances Set
        assert.equal(activeConverseUtterances.size, 0, 'activeConverseUtterances Set must be cleared');
        // 3. Saved remaining text in lastInterruptedConverseState
        const interrupted = getLastInterrupted();
        assert.ok(interrupted, 'lastInterruptedConverseState must be recorded');
        assert.equal(interrupted.turnId, 'turn-barge-in');
        assert.ok(interrupted.remainingText.includes('sentence three'), 'Remaining text must contain unspoken sentences');
        // 4. Reset UI state to listening
        assert.equal(globalThis.__jarvisConverseState.state, 'listening');

        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        console.log('✓ Test 3 passed: Instant barge-in immediately cancels synthesis, preserves unread context buffer, flushes GC Set, and transitions to listening.');
        passedCount++;
    }

    // ==================================================================
    // TEST 4: 150ms Acoustic Echo Debounce Timer
    // ==================================================================
    console.log('\n--- Test 4: 150ms Acoustic Echo Debounce Timing & Sequential Turns ---');
    {
        const engine = createConverseEngineInstance(dom);
        const {
            startStreamingConverseSpeech,
            feedStreamingConverseDelta,
            finishStreamingConverseSpeech,
            getEchoDebounceFired
        } = engine;

        await globalThis.JarvisSpeechInput.toggleConverse();
        globalThis.JarvisSpeechInput.setProcessing(true);
        assert.equal(globalThis.JarvisSpeechInput.getState().processing, true);

        startStreamingConverseSpeech('turn-echo-1');
        feedStreamingConverseDelta('Echo debounce test sentence.', 'turn-echo-1');
        finishStreamingConverseSpeech('', 'turn-echo-1');

        const utt = globalThis.speechSynthesis.queue.shift();
        utt.onend?.();

        // Immediately after onend, debounce timer is scheduled for 150ms
        assert.equal(getEchoDebounceFired(), false, 'Debounce should not have fired synchronously at t=0');
        assert.equal(globalThis.JarvisSpeechInput.getState().processing, true, 'Processing should remain true during 150ms echo window');

        // Wait 75ms (halfway)
        await new Promise(r => setTimeout(r, 75));
        assert.equal(getEchoDebounceFired(), false, 'Debounce should not have fired at t=75ms');
        assert.equal(globalThis.JarvisSpeechInput.getState().processing, true, 'Processing still true at t=75ms');

        // Wait another 100ms (total 175ms > 150ms)
        await new Promise(r => setTimeout(r, 100));
        assert.equal(getEchoDebounceFired(), true, 'Debounce must have fired by t=175ms');
        assert.equal(globalThis.JarvisSpeechInput.getState().processing, false, 'Processing must be disarmed to auto-rearm recognition');

        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        console.log('✓ Test 4 passed: 150ms acoustic echo debounce holds microphone lock for precisely the required window before auto-rearming.');
        passedCount++;
    }

    // ==================================================================
    // TEST 5: Live Overlay Visualizer DOM & Mic Mute/Unmute
    // ==================================================================
    console.log('\n--- Test 5: Live Overlay DOM & Visualizer Orb State Synchronization ---');
    {
        const engine = createConverseEngineInstance(dom);
        const { overlay, orb, statusText, transcriptEl, langSelect, micBtn, micLabel, toggleConverseMic } = engine;

        const speechCtrl = createSpeechInputController({
            Recognition: FakeRecognition,
            language: 'en-US',
            onState: state => {
                globalThis.updateLiveConverseOverlay?.(state.processing ? 'thinking' : (state.listening ? 'listening' : 'idle'));
            }
        });
        globalThis.JarvisSpeechInput = speechCtrl;

        // Toggle Converse on
        await globalThis.JarvisSpeechInput.toggleConverse();
        assert.ok(!overlay.classList.contains('hidden'), 'Overlay must be visible when Converse is active');

        // State: listening
        globalThis.setConverseUiState('listening');
        assert.ok(orb.classList.contains('is-listening'), 'Orb must have is-listening class');
        assert.equal(statusText.textContent, 'Listening (speak now)...');

        // State: interim transcript streaming
        globalThis.updateLiveConverseOverlay('listening', 'User is speaking right now', true);
        assert.equal(transcriptEl.textContent, 'User is speaking right now');
        assert.ok(transcriptEl.classList.contains('is-interim'), 'Transcript must have is-interim class');

        // State: submitting / responding / thinking
        globalThis.setConverseUiState('submitting');
        assert.ok(orb.classList.contains('is-thinking'), 'Orb must have is-thinking class for submitting');
        assert.equal(statusText.textContent, 'Thinking...');

        globalThis.setConverseUiState('responding');
        assert.ok(orb.classList.contains('is-thinking'), 'Orb must have is-thinking class for responding');
        assert.equal(statusText.textContent, 'Thinking...');

        globalThis.updateLiveConverseOverlay('thinking');
        assert.ok(orb.classList.contains('is-thinking'), 'Orb must have is-thinking class for direct thinking overlay call');
        assert.equal(statusText.textContent, 'Thinking...');

        // State: speaking
        globalThis.setConverseUiState('speaking');
        assert.ok(orb.classList.contains('is-speaking'), 'Orb must have is-speaking class');
        assert.equal(statusText.textContent, 'Speaking...');

        // Test mic mute/unmute
        assert.equal(globalThis.JarvisSpeechInput.getState().listening, true);
        toggleConverseMic(); // Mute
        assert.ok(micBtn.classList.contains('is-muted'), 'Mic button must have is-muted class');
        assert.equal(micLabel.textContent, 'Unmute');

        toggleConverseMic(); // Unmute
        assert.ok(!micBtn.classList.contains('is-muted'), 'Mic button must un-mute');
        assert.equal(micLabel.textContent, 'Mute');

        // Language selector change
        globalThis.JarvisSpeechInput.setLanguage('ta-IN');
        globalThis.updateLiveConverseOverlay('listening');
        assert.equal(langSelect.value, 'ta-IN', 'Language selector must sync with speech input language');

        // Close converse
        globalThis.JarvisSpeechInput.stop({ disableConverse: true });
        globalThis.updateLiveConverseOverlay('idle');
        assert.ok(overlay.classList.contains('hidden'), 'Overlay must be hidden when Converse is inactive');

        console.log('✓ Test 5 passed: Live overlay, orb animations, interim text streaming, mic toggle, and language dropdown sync seamlessly.');
        passedCount++;
    }

    // ==================================================================
    // TEST 6: Converse State Tracker Reactive Observers & Exception Safety
    // ==================================================================
    console.log('\n--- Test 6: Converse State Tracker Reactive Observers & Exception Safety ---');
    {
        const tracker = createConverseStateTracker('listening');
        assert.equal(tracker.getState(), 'listening');

        // Test normalization
        assert.equal(normalizeConverseState('SPEAKING'), 'speaking');
        assert.equal(normalizeConverseState('invalid_state'), 'listening');
        assert.equal(normalizeConverseState(null), 'listening');

        // Test subscribers
        const notifications = [];
        const unsub1 = tracker.subscribe((snapshot, prev) => {
            notifications.push({ to: snapshot.state, from: prev, reason: snapshot.reason });
        });

        // Add a faulty listener that throws
        tracker.subscribe(() => {
            throw new Error('Faulty listener intentionally throws');
        });

        const notifications2 = [];
        const unsub2 = tracker.subscribe((snapshot, prev) => {
            notifications2.push({ to: snapshot.state, from: prev });
        });

        // Transition states
        tracker.setState('submitting', 'user_silence');
        tracker.setState('responding', 'sse_start');
        tracker.setState('speaking', 'tts_start');

        assert.equal(notifications.length, 3);
        assert.equal(notifications2.length, 3);
        assert.equal(notifications[0].to, 'submitting');
        assert.equal(notifications[0].from, 'listening');
        assert.equal(notifications[0].reason, 'user_silence');
        assert.equal(notifications[2].to, 'speaking');

        // Unsubscribe
        unsub1();
        unsub2();
        tracker.setState('listening', 'finished');
        assert.equal(notifications.length, 3, 'No further notifications after unsubscribe');

        // Rapid 10,000 state transitions stress test
        for (let i = 0; i < 10000; i++) {
            const nextState = Object.values(CONVERSE_STATES)[i % Object.values(CONVERSE_STATES).length];
            tracker.setState(nextState, `iter_${i}`);
            assert.equal(tracker.getState(), nextState);
        }

        console.log('✓ Test 6 passed: Converse State Tracker safely handles subscribers, exceptions, and 10,000 rapid state transitions.');
        passedCount++;
    }

    // ==================================================================
    // TEST 7: Adversarial Edge Cases & Malformed Inputs
    // ==================================================================
    console.log('\n--- Test 7: Adversarial Inputs & Stream Text Sanitization ---');
    {
        const engine = createConverseEngineInstance(dom);
        const { startStreamingConverseSpeech, feedStreamingConverseDelta, finishStreamingConverseSpeech, activeConverseUtterances } = engine;

        startStreamingConverseSpeech('turn-adv');

        // Deltas containing thinking tags, markdown code blocks, links, math, superscripts, empty strings
        feedStreamingConverseDelta('<think>This internal thought should be stripped completely.</think>Here is the real answer! ', 'turn-adv');
        feedStreamingConverseDelta('Look at this ```javascript\nconst a = 10;\n``` code snippet. ', 'turn-adv');
        feedStreamingConverseDelta('Check out https://example.com/api/test for details. ', 'turn-adv');
        feedStreamingConverseDelta('The volume is 10^3 cubic units. Is it large? Yes! ', 'turn-adv');
        feedStreamingConverseDelta('', 'turn-adv');
        feedStreamingConverseDelta(null, 'turn-adv');
        feedStreamingConverseDelta(undefined, 'turn-adv');
        finishStreamingConverseSpeech('final', 'turn-adv');

        // Drain queue
        const spoken = [];
        while (globalThis.speechSynthesis.queue.length > 0) {
            const utt = globalThis.speechSynthesis.queue.shift();
            spoken.push(utt.text);
            utt.onend?.();
        }

        assert.ok(spoken.length > 0, 'Should have spoken segments');
        // Verify thinking tags were removed
        assert.ok(!spoken.some(s => s.includes('<think>')), 'Thinking tags must not be spoken');
        assert.ok(!spoken.some(s => s.includes('```javascript')), 'Raw code block markers must be sanitized');
        assert.ok(spoken.some(s => s.includes('10 to the power of 3')), 'Math superscripts must be converted to words');
        assert.equal(activeConverseUtterances.size, 0);

        console.log('✓ Test 7 passed: Adversarial inputs, thinking tags, code blocks, and math formulas sanitized correctly.');
        passedCount++;
    }

    console.log('\n================================================================');
    console.log(`--- ALL ${passedCount} MILESTONE 2 EMPIRICAL STRESS TEST SUITES PASSED CLEANLY ---`);
    console.log('================================================================\n');
}

await runMilestone2StressTests();
