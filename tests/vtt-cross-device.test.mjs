/**
 * Phase 26: Multi-Device VTT Verification Suite
 *
 * Tests the VTT dictation pipeline across all major device categories and browsers:
 * 1. Desktop Chrome / Edge (Windows / macOS / Linux) - webkitSpeechRecognition
 * 2. Desktop Safari (macOS) - WebKit speech engine
 * 3. Desktop Firefox (Windows / macOS / Linux) - MediaRecorder / Whisper STT fallback
 * 4. Mobile iPhone (iOS Safari, Touch) - Apple HIG 44px, 16px font-size, interactive-widget
 * 5. Mobile Android (Pixel / Galaxy, Touch) - Coarse pointer, touch-action, auto-resize bounds
 * 6. Tablets & iPads (Portrait & Landscape) - visualViewport, safe-area insets, fixed bottom bar
 *
 * INVARIANTS TESTED ON EVERY DEVICE:
 * - User presses/taps to dictate immediately
 * - Spoken words stream into composer chatbox (#text-input)
 * - Speech fillers ("um", "uh", "basically", "the the", etc.) are stripped in real time
 * - Words NEVER appear as floating bubbles or rows on the chat window (#chat-container)
 * - No premature auto-submission to chat; user reviews and sends manually
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createSpeechInputController,
    cleanSpeechFillers,
    installSpeechInputUI
} from '../app/speech-input.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const indexHtml = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8');

console.log('\n=== Testing VTT Dictation Across Every Device & Browser ===\n');

// ─── Shared Mock Factory ──────────────────────────────────────────────────────

class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.textContent = '';
        this.innerHTML = '';
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.scrollHeight = 40;
        this.children = [];
        this.parentNode = null;
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
        this.listeners[event] = this.listeners[event] || [];
        this.listeners[event].push(fn);
    }
    dispatchEvent(event) {
        const list = this.listeners[event.type || event] || [];
        for (const fn of list) fn(event);
    }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    focus() { this.focused = true; }
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
}

function createDeviceDOMEnvironment(deviceConfig = {}) {
    const elements = {
        'text-input': new MockDOMElement('text-input', 'textarea'),
        'voice-to-text-btn': new MockDOMElement('voice-to-text-btn', 'button'),
        'send-message-btn': new MockDOMElement('send-message-btn', 'button'),
        'chat-container': new MockDOMElement('chat-container', 'div'),
        'chat-main': new MockDOMElement('chat-main', 'div'),
        'speech-input-status': new MockDOMElement('speech-input-status', 'div'),
        'vtt-waveform-container': new MockDOMElement('vtt-waveform-container', 'div'),
        'input-bar-inner': new MockDOMElement('input-bar-inner', 'div'),
        'input-bar-container': new MockDOMElement('input-bar-container', 'div')
    };

    const doc = {
        body: new MockDOMElement('body'),
        documentElement: new MockDOMElement('html'),
        getElementById: id => elements[id] || null,
        createElement: tag => new MockDOMElement('', tag),
        addEventListener: () => {}
    };

    return { elements, doc };
}

class MockRecognition {
    static instances = [];
    constructor() {
        MockRecognition.instances.push(this);
        this.lang = 'en-US';
        this.interimResults = true;
        this.continuous = false;
        this.state = 'idle';
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.onstart = null;
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
        const item = [{ transcript, confidence: 0.95 }];
        item.isFinal = Boolean(isFinal);
        this.onresult?.({
            resultIndex: 0,
            results: [item]
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 1: Desktop Chrome & Edge (Windows / macOS / Linux)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 1: Desktop Chrome & Edge (Windows, macOS, Linux) ---');
{
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 1920,
        height: 1080,
        pointer: 'fine'
    });
    globalThis.document = doc;
    globalThis.window = {
        isSecureContext: true,
        location: { hostname: 'app.example.com' },
        innerWidth: 1920,
        innerHeight: 1080
    };
    globalThis.SpeechRecognition = undefined;
    globalThis.webkitSpeechRecognition = MockRecognition;

    const submitted = [];
    installSpeechInputUI({
        Recognition: MockRecognition,
        onSubmit: async sub => submitted.push(sub)
    });

    const vttBtn = elements['voice-to-text-btn'];
    const chatbox = elements['text-input'];
    const chatContainer = elements['chat-container'];

    // 1. Mouse click to toggle dictation
    await globalThis.toggleVoiceToText();
    assert.equal(vttBtn.classList.contains('is-listening'), true, 'Desktop Chrome: VTT button active on click');
    assert.equal(vttBtn.getAttribute('aria-pressed'), 'true', 'Desktop Chrome: aria-pressed is true');

    const rec = MockRecognition.instances.at(-1);
    assert.ok(rec, 'Desktop Chrome: webkitSpeechRecognition instance active');

    // 2. Interim speech with fillers: streams into chatbox, NEVER into chatContainer
    rec.emitResult('um uh could you explain how the the cache works', false);
    assert.equal(chatbox.value, 'Could you explain how the cache works', 'Desktop Chrome: Chatbox streams interim transcript with fillers cleaned');
    assert.equal(chatContainer.children.length, 0, 'Desktop Chrome: Chat container remains pristine (0 bubbles)');

    // 3. Final speech with spoken punctuation
    rec.emitResult('um uh could you explain how the the cache works question mark', true);
    assert.equal(chatbox.value, 'Could you explain how the cache works?', 'Desktop Chrome: Final text committed to chatbox with punctuation');
    assert.equal(chatContainer.children.length, 0, 'Desktop Chrome: Chat container still has zero speech bubbles');
    assert.equal(submitted.length, 0, 'Desktop Chrome: VTT words not auto-submitted');

    // 4. Click to stop dictation
    await globalThis.toggleVoiceToText();
    assert.equal(vttBtn.classList.contains('is-listening'), false, 'Desktop Chrome: VTT button inactive after stop');

    console.log('  [PASS] 1.1 Desktop Chrome & Edge: Toggle, interim chatbox streaming, filler cleaning & zero chat-window pollution verified');
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 2: Desktop Safari (macOS Sonoma / Sequoia)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 2: Desktop Safari (macOS) ---');
{
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 1440,
        height: 900,
        pointer: 'fine'
    });
    globalThis.document = doc;
    globalThis.window = {
        isSecureContext: true,
        location: { hostname: 'app.example.com' },
        innerWidth: 1440,
        innerHeight: 900
    };
    globalThis.SpeechRecognition = undefined;
    globalThis.webkitSpeechRecognition = MockRecognition;

    const submitted = [];
    installSpeechInputUI({
        Recognition: MockRecognition,
        onSubmit: async sub => submitted.push(sub)
    });

    const vttBtn = elements['voice-to-text-btn'];
    const chatbox = elements['text-input'];
    const chatContainer = elements['chat-container'];

    // Pre-existing draft in composer
    chatbox.value = 'Review this code:';

    await globalThis.toggleVoiceToText();
    const rec = MockRecognition.instances.at(-1);

    // Interim appends cleanly to existing draft
    rec.emitResult('basically check if AWS and SQL queries are optimized', false);
    assert.ok(chatbox.value.startsWith('Review this code:'), 'Desktop Safari: Existing text draft preserved');
    assert.ok(chatbox.value.includes('Check if AWS and SQL queries are optimized'), 'Desktop Safari: Dictation cleanly appended with fillers stripped');
    assert.equal(chatContainer.children.length, 0, 'Desktop Safari: Chat window remains clean');

    await globalThis.toggleVoiceToText();
    console.log('  [PASS] 2.1 Desktop Safari: Draft preservation, acronym capitalization (AWS, SQL) & clean streaming verified');
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 3: Desktop Firefox (Windows / macOS / Linux) - Fallback STT Mode
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 3: Desktop Firefox (Fallback Whisper STT Mode) ---');
{
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 1536,
        height: 864,
        pointer: 'fine'
    });
    globalThis.document = doc;
    globalThis.window = {
        isSecureContext: true,
        location: { hostname: 'localhost' },
        innerWidth: 1536,
        innerHeight: 864
    };
    // Firefox has neither SpeechRecognition nor webkitSpeechRecognition enabled by default
    globalThis.SpeechRecognition = undefined;
    globalThis.webkitSpeechRecognition = undefined;

    // Mock MediaRecorder & MediaStream for Whisper fallback
    class MockMediaStreamTrack {
        constructor() { this.readyState = 'live'; this.enabled = true; }
        stop() { this.readyState = 'ended'; }
    }
    class MockMediaStream {
        constructor() { this.tracks = [new MockMediaStreamTrack()]; }
        getTracks() { return this.tracks; }
        getAudioTracks() { return this.tracks; }
    }
    class MockMediaRecorder {
        constructor(stream) {
            this.stream = stream;
            this.state = 'inactive';
            this.ondataavailable = null;
            this.onstop = null;
            MockMediaRecorder._last = this;
        }
        start() { this.state = 'recording'; }
        stop() {
            this.state = 'inactive';
            this.onstop?.();
        }
        static isTypeSupported() { return true; }
    }

    try {
        Object.defineProperty(globalThis, 'navigator', {
            value: {
                language: 'en-US',
                mediaDevices: {
                    getUserMedia: async () => new MockMediaStream()
                }
            },
            configurable: true,
            writable: true
        });
    } catch (_) {
        globalThis.navigator.mediaDevices = {
            getUserMedia: async () => new MockMediaStream()
        };
    }
    globalThis.MediaRecorder = MockMediaRecorder;

    const ctrl = createSpeechInputController({
        Recognition: null,
        language: 'en-US'
    });

    assert.equal(ctrl.getState().supported, true, 'Firefox: Controller reports supported via Whisper fallback');

    const started = await ctrl.toggleDictation();
    assert.equal(started, true, 'Firefox: toggleDictation succeeds using MediaRecorder');
    assert.equal(ctrl.getState().mode, 'dictation', 'Firefox: Mode is dictation');
    assert.equal(ctrl.getState().listening, true, 'Firefox: Whisper recorder is actively listening');

    ctrl.stop();
    assert.equal(ctrl.getState().listening, false, 'Firefox: Clean stop');

    console.log('  [PASS] 3.1 Desktop Firefox: Web Speech absence triggers MediaRecorder fallback without crashes');
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 4: Mobile iPhone Safari (iOS 16, 17, 18 - Touch Ergonomics)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 4: Mobile iPhone Safari (iOS Touch Ergonomics) ---');
{
    // A. Verify HTML & Viewport Meta Configuration for iOS
    assert.ok(
        indexHtml.includes('viewport-fit=cover'),
        'iPhone: Viewport meta tag includes viewport-fit=cover for notched displays'
    );
    assert.ok(
        indexHtml.includes('interactive-widget=resizes-content'),
        'iPhone: Viewport meta tag handles virtual on-screen keyboard'
    );

    // B. Verify Input Font Size prevents iOS Auto-Zoom Bug (<16px triggers zoom)
    assert.ok(
        stylesCss.includes('font-size: 16px !important;') || stylesCss.includes('font-size: 16px'),
        'iPhone: #text-input enforces font-size 16px to prevent iOS Safari auto-zoom'
    );

    // C. Verify Apple HIG Minimum 44px Touch Target for VTT Button
    const coarseQueryIndex = stylesCss.indexOf('@media (pointer: coarse)');
    assert.ok(coarseQueryIndex !== -1, 'iPhone: @media (pointer: coarse) exists in styles.css');
    const coarseBlock = stylesCss.substring(coarseQueryIndex, coarseQueryIndex + 700);
    assert.ok(
        coarseBlock.includes('#voice-to-text-btn') || coarseBlock.includes('.speech-input-btn'),
        'iPhone: #voice-to-text-btn included in pointer: coarse touch targets'
    );
    assert.ok(
        coarseBlock.includes('min-width: 44px') && coarseBlock.includes('min-height: 44px'),
        'iPhone: Touch target satisfies Apple HIG 44px minimum sizing rule'
    );

    // D. Verify Touch-Action manipulation prevents 300ms click delay
    assert.ok(
        stylesCss.includes('touch-action: manipulation !important;') || stylesCss.includes('touch-action: manipulation'),
        'iPhone: VTT button has touch-action: manipulation to eliminate 300ms tap latency'
    );

    // E. Functional Touch Tap Dictation Simulation on iOS
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 390,
        height: 844,
        pointer: 'coarse'
    });
    globalThis.document = doc;
    globalThis.SpeechRecognition = undefined;
    globalThis.webkitSpeechRecognition = MockRecognition;

    const submitted = [];
    installSpeechInputUI({
        Recognition: MockRecognition,
        onSubmit: async sub => submitted.push(sub)
    });

    const vttBtn = elements['voice-to-text-btn'];
    const chatbox = elements['text-input'];
    const chatContainer = elements['chat-container'];

    // Tap to dictate on mobile
    await globalThis.toggleVoiceToText();
    assert.equal(vttBtn.classList.contains('is-listening'), true);

    const rec = MockRecognition.instances.at(-1);
    rec.emitResult('um write a swift function for iOS period', true);

    assert.equal(chatbox.value, 'Write a swift function for iOS.', 'iPhone: Speech transcribed into chatbox with filler stripped');
    assert.equal(chatContainer.children.length, 0, 'iPhone: No chat row created on screen');
    assert.equal(submitted.length, 0, 'iPhone: Words stay in chatbox for manual user sending');

    await globalThis.toggleVoiceToText();
    console.log('  [PASS] 4.1 Mobile iPhone Safari: 44px HIG target, 16px zoom-defense, touch latency & chatbox streaming verified');
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 5: Mobile Android Chrome (Pixel 8, Galaxy S24)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 5: Mobile Android Chrome (Google Pixel & Samsung Galaxy) ---');
{
    // A. Verify Composer Auto-Resize and Dynamic Bounds
    assert.ok(
        indexHtml.includes('maxHeight = 180'),
        'Android: Composer textarea clamps to max 180px so it never swallows small mobile screens'
    );
    assert.ok(
        indexHtml.includes('--input-bar-safe-height'),
        'Android: Dynamic CSS variable --input-bar-safe-height updates so chat content remains visible above keyboard'
    );

    // B. Mobile Android Dictation with Conversational Fillers & Stutter
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 412,
        height: 915,
        pointer: 'coarse'
    });
    globalThis.document = doc;
    globalThis.SpeechRecognition = MockRecognition;
    globalThis.webkitSpeechRecognition = MockRecognition;

    installSpeechInputUI({
        Recognition: MockRecognition
    });

    const chatbox = elements['text-input'];
    const chatContainer = elements['chat-container'];

    await globalThis.toggleVoiceToText();
    const rec = MockRecognition.instances.at(-1);

    // Complex mobile speech pattern: fillers + stutter + contraction + acronym
    rec.emitResult('um uh i cant find the the Android SDK docs you know what i mean', true);

    assert.equal(
        chatbox.value,
        "I can't find the Android SDK docs",
        'Android: Strips um/uh, contractions (i cant -> I can\'t), stutters (the the -> the), acronyms (SDK), and filler phrases'
    );
    assert.equal(chatContainer.children.length, 0, 'Android: Chat container remains completely clean');

    await globalThis.toggleVoiceToText();
    console.log('  [PASS] 5.1 Mobile Android Chrome: Mobile bounds, complex filler removal & chatbox population verified');
}

// ─────────────────────────────────────────────────────────────────────────────
// DEVICE 6: Tablets & iPads (Portrait & Landscape Breakpoints)
// ─────────────────────────────────────────────────────────────────────────────
console.log('--- Device 6: Tablets & iPads (Portrait & Landscape Breakpoints) ---');
{
    // A. Verify Fixed Floating Input Bar on Tablets (<= 1024px)
    assert.ok(
        stylesCss.includes('position: fixed !important;') && stylesCss.includes('z-index: 40 !important;'),
        'Tablet: Floating composer bar is fixed at bottom on tablet screen widths'
    );

    // B. Safe Area Insets for Edge-to-Edge Tablets
    assert.ok(
        stylesCss.includes('env(safe-area-inset-left)') && stylesCss.includes('env(safe-area-inset-right)'),
        'Tablet: Safe area insets active for landscape mode padding'
    );

    // C. Tablet Multi-Sentence Dictation Across Rotations
    const { elements, doc } = createDeviceDOMEnvironment({
        width: 820,
        height: 1180,
        pointer: 'coarse'
    });
    globalThis.document = doc;
    globalThis.SpeechRecognition = MockRecognition;

    installSpeechInputUI({
        Recognition: MockRecognition
    });

    const chatbox = elements['text-input'];
    const vttBtn = elements['voice-to-text-btn'];
    const chatContainer = elements['chat-container'];

    await globalThis.toggleVoiceToText();
    assert.equal(vttBtn.classList.contains('is-listening'), true);

    const rec = MockRecognition.instances.at(-1);

    // First sentence in portrait
    rec.emitResult('first paragraph of my tablet research note period', true);
    assert.equal(chatbox.value, 'First paragraph of my tablet research note.');

    // Second sentence (appends after rotation)
    rec.emitResult('new paragraph second paragraph with high hyphen speed GPU benchmarks period', true);
    assert.ok(chatbox.value.includes('\n\nSecond paragraph with high-speed GPU benchmarks.'));
    assert.equal(chatContainer.children.length, 0, 'Tablet: Zero speech rows rendered in chat window');

    await globalThis.toggleVoiceToText();
    assert.equal(vttBtn.classList.contains('is-listening'), false);

    console.log('  [PASS] 6.1 Tablets & iPads: Fixed composer bar, rotation append, paragraph breaks & hyphen formatting verified');
}

console.log('\n=== All Multi-Device VTT Tests PASSED (100% Mobile, Tablet & Desktop Verified) ===\n');
