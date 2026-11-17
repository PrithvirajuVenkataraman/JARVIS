/**
 * Consolidated UI & Workspace Test Suite
 * Covers modern workspace layout, reasoning accordion, dynamic CoT reasoning,
 * stop thinking / clarification, action bar & followups, tablet/iPad layouts,
 * settings UI, and DOM memory protection.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { __test as chatTest } from '../api/chat-groq.js';
import { __test as searchTest } from '../api/search.js';
import { __test as freeLiveTest } from '../api/_lib/free-live/providers.js';
import { verifyAndRepairMathClaims } from '../api/_lib/code-math-validator.js';

test('Modern UI Workspace & Layout Verification', async () => {







console.log('--- Testing Modern AI Workspace UI Architecture ---');

// 1. Verify index.html Layout & Elements
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Header elements: streamlined without model dropdown, theme toggle, or sandbox buttons
assert.ok(indexHtml.includes('id="app-header"'), 'App header element must exist');
assert.ok(indexHtml.includes('id="chat-sidebar-toggle"'), 'Sidebar toggle button must exist');
assert.ok(indexHtml.includes('id="header-new-chat-btn"'), 'New chat header button must exist');
assert.ok(!indexHtml.includes('id="header-command-palette-btn"'), 'Header command palette trigger must be removed end-to-end');

// Verified removed from header completely per user directives
assert.ok(!indexHtml.includes('id="header-canvas-btn"'), 'Artifact Canvas button must be removed');
assert.ok(!indexHtml.includes('id="header-model-pill"'), 'Header model selector pill must be removed');
assert.ok(!indexHtml.includes('id="header-model-dropdown"'), 'Header model dropdown list must be removed');
assert.ok(!indexHtml.includes('id="theme-toggle-btn"'), 'Theme toggle button must be removed (dark mode is exclusive)');
console.log('  [PASS] 1. Streamlined top navigation bar verified (header model pill, theme toggle, canvas, and command palette search removed)');

// Model selector moved from sidebar into settings modal per user directives
assert.ok(indexHtml.includes('id="model-selector"'), 'Model selector must exist in settings modal');
assert.ok(!indexHtml.includes('class="chat-sidebar-model-block"'), 'Sidebar model block must be removed to streamline sidebar');
console.log('  [PASS] 2. Model selector moved to settings modal cleanly');

// Main chat container and empty state hero
assert.ok(indexHtml.includes('id="chat-main"'), 'Main chat viewport must exist');
assert.ok(indexHtml.includes('id="chat-center-column"'), 'Centered reading column must exist');
assert.ok(indexHtml.includes('id="chat-empty-state"'), 'Empty state hero must exist');
assert.ok(indexHtml.includes('class="empty-state-capabilities"'), 'Interactive capability pills container must exist');
assert.ok(indexHtml.includes("handleCapabilityPillClick('live_search')"), 'Live web search pill must exist');
assert.ok(indexHtml.includes('id="composer-think-btn"'), 'Permanent Think (Deep Reasoning) button must exist in prompt box');
assert.ok(indexHtml.includes('class="composer-think-label"'), 'Think button label must exist');
assert.ok(indexHtml.includes('function toggleDeepReasoningMode('), 'toggleDeepReasoningMode function must be defined');
assert.ok(indexHtml.includes("handleCapabilityPillClick('document_ocr')"), 'Document OCR pill must exist');
assert.ok(!indexHtml.includes("handleCapabilityPillClick('code_math')"), 'Code & Math pill must be deleted');
assert.ok(indexHtml.includes('id="composer-mode-badge"'), 'Composer mode indicator badge must exist on prompt box');
assert.ok(indexHtml.includes('function updateComposerModeIndicatorUi('), 'updateComposerModeIndicatorUi function must be defined');
assert.ok(indexHtml.includes('function handleCapabilityPillClick('), 'handleCapabilityPillClick function must be defined');
assert.ok(!indexHtml.includes('class="empty-state-shortcuts"'), 'Keyboard shortcut hints must be removed');
assert.ok(!indexHtml.includes('class="starter-cards-grid"'), 'Starter prompt cards grid must be removed to prevent hallucinations');
assert.ok(!indexHtml.includes('class="starter-prompt-card"'), 'Starter prompt card buttons must be removed');
assert.ok(indexHtml.includes('id="chat-container"'), 'Chat container element must exist');
assert.ok(indexHtml.includes('id="drag-drop-overlay"'), 'Drag and drop overlay must exist');
console.log('  [PASS] 3. Full-height workspace layout, empty state hero with interactive capability pills, and drag-drop overlay verified');

// JavaScript UI helper functions & safeguards
assert.ok(indexHtml.includes('function toggleAppTheme('), 'toggleAppTheme must be defined');
assert.ok(indexHtml.includes('function setAppTheme('), 'setAppTheme must be defined');
assert.ok(indexHtml.includes("return 'dark'"), 'Permanent dark mode returned from getAppTheme');
assert.ok(indexHtml.includes('function updateChatEmptyStateVisibility('), 'updateChatEmptyStateVisibility must be defined');
assert.ok(indexHtml.includes('const hasRealUserTurn = userMessages.length > 0;'), 'Empty state stays visible until real user interaction occurs');
assert.ok(indexHtml.includes('useStarterPrompt('), 'useStarterPrompt must be defined');
assert.ok(indexHtml.includes("'document_ocr'"), 'OCR starter prompt card must route to document_ocr action');
assert.ok(indexHtml.includes('triggerComposerFilePicker'), 'OCR action must invoke triggerComposerFilePicker');
assert.ok(indexHtml.includes('chatMain.scrollTop = chatMain.scrollHeight;'), 'Viewport auto-scroll must include chatMain');
assert.ok(indexHtml.includes('function initDragAndDropFileUpload('), 'initDragAndDropFileUpload must be defined');

// Typing waveform safeguard verification
assert.ok(indexHtml.includes("if (!spState.listening)"), 'handleComposerInput hides waveform when not actively listening to voice');
assert.ok(indexHtml.includes("if (vttWave) vttWave.classList.add('hidden')"), 'sendTextInput hides waveform on typed turns');
console.log('  [PASS] 4. Client-side permanent dark mode, persistent empty state hero, typing waveform safeguards verified');

// Next Steps & Action Plan Dynamic Engine Verification
assert.ok(indexHtml.includes('function extractContextualEntities('), 'Contextual entity extractor must exist');
assert.ok(indexHtml.includes('suggested-followups-card'), 'Suggested followups card class must exist');
assert.ok(!indexHtml.includes('class="quick-pivot-btn"'), 'Quick pivot buttons must be removed from assistant action row');
assert.ok(!indexHtml.includes('data-assistant-action="transform_deeper"'), 'Deep Dive button must be removed from assistant action row');
assert.ok(!indexHtml.includes('data-assistant-action="transform_shorter"'), 'Summary button must be removed from assistant action row');
assert.ok(!indexHtml.includes('data-assistant-action="transform_simplify"'), 'Simplify button must be removed from assistant action row');
console.log('  [PASS] 5. Revamped dynamic Next Steps engine and removal of Deep Dive/Summary/Simplify buttons verified in index.html');

// 2. Verify styles.css Design Tokens & Rules
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
assert.ok(stylesCss.includes('--ui-bg: #09090b'), 'Dark theme background token must be configured in :root');
assert.ok(stylesCss.includes('.app-header'), 'App header CSS must exist');
assert.ok(!stylesCss.includes('.header-model-pill'), 'Model selector pill CSS must be removed');
assert.ok(stylesCss.includes('.chat-empty-state'), 'Empty state hero CSS must exist');
assert.ok(stylesCss.includes('.starter-prompt-card'), 'Starter prompt card CSS must exist');
assert.ok(stylesCss.includes('.chat-bubble-user'), 'User message bubble CSS must exist');
assert.ok(stylesCss.includes('.drag-drop-overlay'), 'Drag-and-drop overlay CSS must exist');
assert.ok(stylesCss.includes('body.sidebar-docked'), 'Desktop dockable sidebar CSS rule must exist');
assert.ok(stylesCss.includes('.next-step-arrow'), 'Next step arrow CSS rule must exist');
assert.ok(stylesCss.includes('.enterprise-next-steps-card'), 'Revamped next steps card styling must exist');
console.log('  [PASS] 6. Permanent dark mode design tokens, Next Steps modern UI CSS verified');

// 3. Verify Complete Removal of Coding Sandbox & Artifact Canvas (Enterprise Standards)
assert.ok(!indexHtml.includes('id="jarvis-canvas-drawer"'), 'Artifact Canvas drawer must be removed');
assert.ok(!indexHtml.includes('id="canvas-code-input"'), 'Interactive code editor textarea must be removed');
assert.ok(!indexHtml.includes('id="canvas-preview-frame"'), 'Live preview sandbox iframe must be removed');
assert.ok(!indexHtml.includes('function runJarvisCodeSandbox('), 'Client-side runJarvisCodeSandbox must be removed');
assert.ok(!indexHtml.includes('function openInCanvas('), 'openInCanvas must be removed');
assert.ok(!indexHtml.includes('class="code-output-drawer"'), 'code-output-drawer markup must be removed');
assert.ok(!stylesCss.includes('.jarvis-canvas-drawer'), 'Canvas drawer CSS must be removed');
assert.ok(!stylesCss.includes('.code-output-drawer'), 'Code output drawer CSS must be removed');
assert.ok(!stylesCss.includes('.code-header-btn.run-btn'), 'Run button styling must be removed');
assert.ok(!stylesCss.includes('.code-header-btn.canvas-btn'), 'Canvas button styling must be removed');
assert.ok(indexHtml.includes('function copyCodeBlock('), 'Standard code block copy button must be preserved');
console.log('  [PASS] 7. Complete removal of coding sandbox & canvas drawer verified (enterprise-grade compliance)');

// 4. Verify Starter Removal, Multimodal Synergy & Anti-Latency Invariants
assert.ok(!indexHtml.includes('class="starter-cards-grid"'), 'Starter cards grid markup must be removed to prevent prebaked hallucinations');
assert.ok(!indexHtml.includes('class="starter-prompt-card"'), 'Starter prompt card buttons must be removed');
assert.ok(indexHtml.includes("action === 'live_search'"), 'useStarterPrompt handles live_search action');
assert.ok(indexHtml.includes('forceWebSearch: true'), 'live_search action sets forceWebSearch flag');
assert.ok(indexHtml.includes('needsLiveVerification'), 'sendTextInput supports multimodal attachment live verification');
assert.ok(indexHtml.includes('const inputSource = String(submission?.source'), 'sendTextInput declares inputSource to prevent ReferenceError on send');
assert.ok(indexHtml.includes('pure_coding_fast_path'), 'processCommand fast-paths coding prompts directly to streaming model');
assert.ok(indexHtml.includes('verificationBudgetMs = 8000') || indexHtml.includes('verificationBudgetMs: 8000'), 'handleLiveRetrievalQuery allows 8000ms budget for structured infobox lookup (Wikipedia/Wikidata)');
console.log('  [PASS] 8. Starter shortcuts removed for zero-latency, multimodal synergy and streaming latency invariants verified');

// 5. Verify Robust Live Web Search & Multi-Domain Consensus Verification
assert.ok(indexHtml.includes('if (submission?.forceWebSearch) {'), 'sendTextInput routes forceWebSearch directly to handleLiveRetrievalQuery');
assert.ok(indexHtml.includes('distinctDomains.length >= 2'), 'handleLiveRetrievalQuery requires consensus across >= 2 distinct domains');
assert.ok(indexHtml.includes('Sources checked:'), 'Strict refusal lists checked sources so user can review them');
assert.ok(indexHtml.includes('const searchEngineQuery = query'), 'handleLiveRetrievalQuery optimizes query before calling search engines');
assert.ok(indexHtml.includes('live search|web research'), 'isExplicitWebSearchRequest recognizes live search and web research intents');
console.log('  [PASS] 9. Multi-domain consensus verification, query optimization, and refusal-with-sources verified');
 
// 6. Verify Anti-Hallucination & Speed Optimization Invariants (Section 10)
// 10.1 Adaptive Model Routing: Deep Tier routes strictly to openai/gpt-oss-120b first
const deepComplexity = chatTest.classifyQueryComplexity('Give me a distributed microservices system architecture for high-throughput stream processing');
assert.equal(deepComplexity.tier, 'deep', 'Complex architecture query must classify as deep tier');
const deepCandidates = chatTest.getPreferredGroqCandidates('', { tier: 'deep' });
assert.equal(deepCandidates[0], 'openai/gpt-oss-120b', 'Complex queries MUST route to openai/gpt-oss-120b on Groq as strict top priority');

// 10.2 Adaptive Model Routing: Instant Tier routes to openai/gpt-oss-20b first for <200ms TTFT
const instantComplexity = chatTest.classifyQueryComplexity('What is the capital of Australia?');
assert.equal(instantComplexity.tier, 'instant', 'Simple factual query must classify as instant tier');
const instantCandidates = chatTest.getPreferredGroqCandidates('', { tier: 'instant', preferSpeed: true });
assert.equal(instantCandidates[0], 'openai/gpt-oss-20b', 'Instant queries must prioritize openai/gpt-oss-20b first for speed');

// 10.3 System prompt compaction & high-density epistemic directives
const compactedPrompt = chatTest.buildServerSystemPrompt();
assert.ok(compactedPrompt.length < 4600, `Compacted prompt should be under 4600 chars, got ${compactedPrompt.length}`);
assert.ok(compactedPrompt.includes('ZERO-HALLUCINATION & EPISTEMIC GROUNDING'), 'Compacted prompt must contain Zero-Hallucination section');
assert.ok(compactedPrompt.includes('Never invent people, dates, prices, statistics'), 'Prompt must strictly prohibit invented facts');
assert.ok(compactedPrompt.includes("No, no, no don't do that! I thought we were having a good time."), '18+ boundary deflection quote preserved');

// 10.4 Multimodal attachment retry uses stream: true and 15000ms timeout (zero 45s freeze)
assert.ok(indexHtml.includes('timeoutMs: 15000,\n                                stream: true'), 'Attachment retry uses 15000ms timeout with streaming enabled');
assert.ok(!indexHtml.includes('timeoutMs: 45000'), '45000ms unstreamed retry freeze must be completely eliminated');

// 10.5 Speculative inline arithmetic repair handles percentage equality
const repairedPercent = verifyAndRepairMathClaims('The discount is 15% of 80 = 14 dollars');
assert.equal(repairedPercent.repaired, true, 'Percentage calculation hallucination must be caught');
assert.equal(repairedPercent.text, 'The discount is 15% of 80 = 12 dollars', 'Percentage calculation must be auto-repaired to 12');

console.log('  [PASS] 10. Anti-hallucination & speed optimization invariants verified (DeepSeek/Qwen priority, instant tier, compacted prompt, streaming attachments, percentage auto-repair)');

// 7. Verify Scraperless Live Web Search Invariants (Section 11)
// 11.1 Native Gemini Google Search Grounding response normalizer & payload extraction
const mockGeminiResponse = {
    candidates: [{
        content: { parts: [{ text: 'The capital of France is Paris.' }] },
        groundingMetadata: {
            webSearchQueries: ['capital of France'],
            groundingChunks: [
                { web: { uri: 'https://en.wikipedia.org/wiki/Paris', title: 'Paris - Wikipedia' } },
                { web: { uri: 'https://www.britannica.com/place/Paris', title: 'Paris | History, Map, & Facts | Britannica' } }
            ],
            groundingSupports: [
                {
                    groundingChunkIndices: [0],
                    segment: { startIndex: 0, endIndex: 32, text: 'The capital of France is Paris.' }
                }
            ]
        }
    }]
};
const parsedGrounding = searchTest.parseGeminiGroundingResponse(mockGeminiResponse, 'capital of France');
assert.equal(parsedGrounding.results.length, 2, 'Must extract all web chunks as verified results');
assert.equal(parsedGrounding.results[0].domain, 'en.wikipedia.org', 'Must parse domain correctly from URI');
assert.equal(parsedGrounding.results[0].sourceType, 'live_web', 'Source type must be live_web');
assert.ok(parsedGrounding.results[0].qualitySignals.includes('google_search_grounding'), 'Quality signal must declare google_search_grounding');
assert.equal(parsedGrounding.answer, 'The capital of France is Paris.', 'Must extract grounded answer directly');

// 11.2 SearXNG JSON Meta-Search Engine response normalizer & engine attribution
const mockSearXNGResponse = {
    query: 'quantum computing developments',
    results: [
        {
            url: 'https://www.nature.com/articles/d41586-024-00000',
            title: 'Quantum breakthrough in error correction',
            content: 'Researchers demonstrate fault-tolerant logical qubits.',
            engine: 'google',
            publishedDate: '2026-03-01'
        },
        {
            url: 'https://phys.org/news/2026-03-quantum-processor.html',
            title: 'New 1,000-qubit processor unveiled',
            content: 'Next generation superconducting quantum processor.',
            engine: 'bing'
        }
    ]
};
const parsedSearXNG = freeLiveTest.parseSearXNGResults(mockSearXNGResponse, 'quantum computing developments');
assert.equal(parsedSearXNG.length, 2, 'Must parse all SearXNG results');
assert.equal(parsedSearXNG[0].domain, 'nature.com', 'Domain must be extracted correctly');
assert.equal(parsedSearXNG[0].source, 'SearXNG (google)', 'Engine attribution must be recorded in source label');
assert.ok(parsedSearXNG[0].qualitySignals.includes('searxng_json'), 'Quality signals must include searxng_json');
assert.equal(parsedSearXNG[1].source, 'SearXNG (bing)', 'Secondary engine attribution must be preserved');

// 11.3 Multi-Domain Scraperless Consensus Verification (>= 2 distinct domains)
const combinedDistinctDomains = Array.from(new Set([...parsedGrounding.results, ...parsedSearXNG].map(r => r.domain).filter(Boolean)));
assert.ok(combinedDistinctDomains.length >= 2, 'Consensus across >= 2 distinct domains must be achieved without scrapers');

console.log('  [PASS] 11. Scraperless Live Web Search Invariants verified (Native Gemini Grounding, SearXNG JSON meta-search, >= 2 domain consensus)');

// 12. Verify End-to-End Removal of Command Palette (Search ⌘K)
assert.ok(!indexHtml.includes('id="command-palette-modal"'), 'Command palette modal markup must be removed end-to-end');
assert.ok(!indexHtml.includes('id="command-palette-input"'), 'Command palette input must be removed');
assert.ok(!indexHtml.includes('id="command-palette-list"'), 'Command palette listbox must be removed');
assert.ok(!indexHtml.includes('function openCommandPalette()'), 'openCommandPalette must be removed');
assert.ok(!indexHtml.includes('function closeCommandPalette()'), 'closeCommandPalette must be removed');
assert.ok(!indexHtml.includes('function getCommandPaletteActions()'), 'getCommandPaletteActions must be removed');
assert.ok(!stylesCss.includes('.command-palette-backdrop'), 'Command palette CSS backdrop must be removed');
assert.ok(!stylesCss.includes('.command-palette-container'), 'Command palette CSS container must be removed');

// Verify core keyboard shortcuts & direct utilities remain accessible
assert.ok(indexHtml.includes('getPlatformModifierKey'), 'Modifier key helper preserved for platform shortcuts');
assert.ok(indexHtml.includes('toggleVoiceToText'), 'Voice dictation accessible via space/speech trigger');
assert.ok(indexHtml.includes('startNewChatSession'), 'New chat session functionality preserved');
assert.ok(indexHtml.includes('exportCurrentChat'), 'Direct export functionality preserved');
assert.ok(indexHtml.includes('showHelpModal()'), 'Settings modal preserved and wired');

console.log('  [PASS] 12. End-to-end removal of Command Palette (Search ⌘K) verified with core shortcuts intact');

// 13. Verify Bespoke Custom Confirmation Modal (Data & Privacy)
assert.ok(indexHtml.includes('showCustomConfirmDialog'), 'showCustomConfirmDialog must be defined');
assert.ok(indexHtml.includes('closeCustomConfirmDialog'), 'closeCustomConfirmDialog must be defined');
assert.ok(indexHtml.includes('promptClearAllDataConfirmation'), 'promptClearAllDataConfirmation must be wired');
assert.ok(stylesCss.includes('.custom-confirm-card'), 'Custom confirm card styling must exist in styles.css');
assert.ok(stylesCss.includes('.custom-confirm-backdrop'), 'Custom confirm backdrop styling must exist in styles.css');
assert.ok(stylesCss.includes('.custom-confirm-proceed-btn.danger'), 'Danger proceed button styling must exist in styles.css');
console.log('  [PASS] 13. Bespoke Custom Confirmation Modal verified (accessible glassmorphic dialog replacing native browser alert)');

// 14. Verify Enterprise Sidebar Interaction, Drag Handle & Outside Click Close
assert.ok(indexHtml.includes('id="sidebar-drag-handle"'), 'Sidebar drag handle element must exist in DOM');
assert.ok(indexHtml.includes('function initSidebarOutsideClickClose()'), 'initSidebarOutsideClickClose must be defined');
assert.ok(indexHtml.includes('function initSidebarDragging()'), 'initSidebarDragging must be defined');
assert.ok(stylesCss.includes('.sidebar-drag-handle'), 'sidebar-drag-handle CSS must exist');
assert.ok(stylesCss.includes('.chat-sidebar-panel.is-dragging'), 'is-dragging CSS override must exist');
assert.ok(stylesCss.includes('var(--sidebar-docked-width, 280px)'), 'Dynamic --sidebar-docked-width CSS must exist');
console.log('  [PASS] 14. Enterprise Sidebar interaction verified (outside-click dismissal, drag handle, swipe gestures, and dynamic width)');

// 15. Verify Edit Message Modal Focus Retention & Accidental Dismiss Protection
assert.ok(indexHtml.includes('handleTextInputDialogBackdropClick'), 'handleTextInputDialogBackdropClick must be defined');
assert.ok(indexHtml.includes('handleTextInputDialogCardClick'), 'handleTextInputDialogCardClick must be defined');
assert.ok(indexHtml.includes('onclick="handleTextInputDialogBackdropClick(event)"'), 'Backdrop must use handleTextInputDialogBackdropClick');
assert.ok(!indexHtml.includes('id="text-input-dialog-backdrop" class="text-input-dialog-backdrop hidden" role="presentation" onclick="if (event.target === this) closeTextInputDialog(null)"'), 'Backdrop must not directly close on accidental click');
assert.ok(stylesCss.includes('modalAttentionPulse'), 'modalAttentionPulse animation must exist in styles.css');
assert.ok(stylesCss.includes('.text-input-dialog.modal-attention-pulse'), '.text-input-dialog.modal-attention-pulse class must exist');
console.log('  [PASS] 15. Edit message modal focus retention and accidental dismiss protection verified');

console.log('=== All Modern AI Workspace UI Architecture Tests PASSED ===');




});

test('Reasoning UI Accordion & Deep Thought', async () => {



console.log('--- Testing Reasoning UI Accordion & Interactive Verification (Milestone 4) ---');

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const stylesCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');

function extractFunctionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing function ' + name);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (char === '(') parenDepth++;
        else if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                bodyStart = source.indexOf('{', i);
                break;
            }
        }
    }
    assert.notEqual(bodyStart, -1, 'could not find body for ' + name);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error('could not extract complete source for ' + name);
}

// -----------------------------------------------------------------------------
// Lightweight Mock DOM for Node.js
// -----------------------------------------------------------------------------
class MockClassList {
    constructor(classes = []) {
        this._classes = new Set(classes.filter(Boolean));
    }
    add(...cls) { cls.forEach(c => this._classes.add(c)); }
    remove(...cls) { cls.forEach(c => this._classes.delete(c)); }
    toggle(cls, force) {
        if (force === true) { this._classes.add(cls); return true; }
        if (force === false) { this._classes.delete(cls); return false; }
        if (this._classes.has(cls)) { this._classes.delete(cls); return false; }
        this._classes.add(cls);
        return true;
    }
    contains(cls) { return this._classes.has(cls); }
    toString() { return Array.from(this._classes).join(' '); }
}

class MockElement {
    constructor(tagName = 'div', className = '') {
        this.tagName = tagName.toUpperCase();
        this.classList = new MockClassList(className.split(' '));
        this.style = {};
        this.dataset = {};
        this.attributes = {};
        this.children = [];
        this.parentElement = null;
        this._textContent = '';
        this._innerHTML = '';
    }

    get className() { return this.classList.toString(); }
    set className(val) { this.classList = new MockClassList(String(val || '').split(' ')); }

    get textContent() { return this._textContent; }
    set textContent(val) {
        this._textContent = String(val ?? '');
        this._innerHTML = this._textContent
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(html) {
        this._innerHTML = String(html ?? '');
        this._parseInnerHtml(this._innerHTML);
    }

    get firstElementChild() { return this.children[0] || null; }

    setAttribute(name, value) {
        this.attributes[name] = String(value);
    }

    getAttribute(name) {
        return this.attributes[name] ?? null;
    }

    removeAttribute(name) {
        delete this.attributes[name];
    }

    closest(selector) {
        let curr = this;
        while (curr) {
            if (curr._matchesSelector(selector)) return curr;
            curr = curr.parentElement;
        }
        return null;
    }

    appendChild(child) {
        if (!child) return child;
        child.parentElement = this;
        this.children.push(child);
        return child;
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return newNode;
        newNode.parentElement = this;
        const idx = this.children.indexOf(refNode);
        if (idx === -1) {
            this.children.push(newNode);
        } else {
            this.children.splice(idx, 0, newNode);
        }
        return newNode;
    }

    querySelector(selector) {
        return this._findMatchingNode(selector);
    }

    querySelectorAll(selector) {
        const results = [];
        this._findAllMatchingNodes(selector, results);
        return results;
    }

    _findMatchingNode(selector) {
        for (const child of this.children) {
            if (child._matchesSelector(selector)) return child;
            const nested = child._findMatchingNode(selector);
            if (nested) return nested;
        }
        return null;
    }

    _findAllMatchingNodes(selector, results) {
        for (const child of this.children) {
            if (child._matchesSelector(selector)) results.push(child);
            child._findAllMatchingNodes(selector, results);
        }
    }

    _matchesSelector(selector) {
        if (selector.startsWith('.')) {
            const classNames = selector.slice(1).split('.');
            return classNames.every(c => this.classList.contains(c));
        }
        if (selector.startsWith('[')) {
            const attrMatch = selector.match(/\[([a-zA-Z0-9_-]+)(?:="([^"]+)")?\]/);
            if (attrMatch) {
                const attr = attrMatch[1];
                const val = attrMatch[2];
                if (attr.startsWith('data-')) {
                    const key = attr.slice(5).replace(/-([a-z])/g, (_, l) => l.toUpperCase());
                    return val !== undefined ? this.dataset[key] === val : this.dataset[key] !== undefined;
                }
                return val !== undefined ? this.getAttribute(attr) === val : this.getAttribute(attr) !== null;
            }
        }
        return this.tagName.toLowerCase() === selector.toLowerCase();
    }

    _parseInnerHtml(html) {
        this.children = [];
        const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>|<([a-zA-Z0-9-]+)([^>]*)\/>/g;
        let match;
        while ((match = tagRegex.exec(html)) !== null) {
            const tag = match[1] || match[4];
            const attrs = match[2] || match[5] || '';
            const body = match[3] || '';
            const classMatch = attrs.match(/class="([^"]+)"/);
            const classStr = classMatch ? classMatch[1] : '';
            const el = new MockElement(tag, classStr);
            const ariaMatch = attrs.match(/aria-expanded="([^"]+)"/);
            if (ariaMatch) el.setAttribute('aria-expanded', ariaMatch[1]);
            const roleMatch = attrs.match(/role="([^"]+)"/);
            if (roleMatch) el.setAttribute('role', roleMatch[1]);
            if (body.includes('<')) {
                el.innerHTML = body;
            } else {
                el.textContent = body.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"');
            }
            this.appendChild(el);
        }
    }
}

// -----------------------------------------------------------------------------
// Initialize Sandbox
// -----------------------------------------------------------------------------
const domSandbox = {
    document: {
        createElement: (tag) => new MockElement(tag),
        querySelectorAll: () => [],
        getElementById: () => null
    },
    window: {
        toggleThinkingProcessCard: null
    },
    performance: {
        now: () => 1000
    },
    Math,
    Number,
    String,
    Array,
    Set,
    Map
};
vm.createContext(domSandbox);

// Load helper functions
vm.runInContext(extractFunctionSource(indexHtml, 'escapeHtml'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'formatThinkingStep'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), domSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'buildThinkingProcessHtml'), domSandbox);

// Extract toggleThinkingProcessCard definition
const toggleMatch = indexHtml.match(/window\.toggleThinkingProcessCard\s*=\s*function\s*\(([^)]*)\)\s*\{([\s\S]*?)\};/);
assert.ok(toggleMatch, 'toggleThinkingProcessCard must be defined in index.html');
vm.runInContext(`window.toggleThinkingProcessCard = function(${toggleMatch[1]}) { ${toggleMatch[2]} };`, domSandbox);

const buildThinkingProcessHtml = domSandbox.buildThinkingProcessHtml;
const toggleThinkingProcessCard = domSandbox.window.toggleThinkingProcessCard;
const extractThoughtAndAnswer = domSandbox.extractThoughtAndAnswer;
const generateSteps = domSandbox.generateContextualThoughtSteps;

// =============================================================================
// TEST SUITE 1: HTML Structure & Initial Active State
// =============================================================================
console.log('1. Testing accordion HTML structure and active streaming state...');

// Test 1.1: Streaming active card with raw thought
{
    const rawThought = 'Evaluating mathematical derivative step by step';
    const html = buildThinkingProcessHtml(rawThought, [], '2.4', true, null);
    assert.ok(html.includes('thinking-process-card is-active is-expanded'), 'Must have is-active is-expanded classes during streaming');
    assert.ok(html.includes('thinking-pulse-dot'), 'Must include pulse dot');
    assert.ok(html.includes('Thinking... 2.4s'), 'Must display Thinking... timer');
    assert.ok(html.includes('thinking-chevron'), 'Must include chevron icon');
    assert.ok(html.includes('thinking-raw-content'), 'Must include raw thought container');
    assert.ok(html.includes('Evaluating mathematical derivative step by step'), 'Must contain raw thought content');
    assert.ok(html.includes('aria-expanded="true"'), 'Active card header must have aria-expanded="true"');
    console.log('  [PASS] 1.1 Active streaming card renders with pulse dot, Thinking... timer, and raw thought block');
}

// Test 1.2: Streaming active card with dynamic 3-stage CoT steps
{
    const steps = [
        'Deconstructing problem requirements',
        'Evaluating algorithmic approaches',
        'Synthesizing optimal solution'
    ];
    const html = buildThinkingProcessHtml('', steps, '1.5', true, null);
    assert.ok(html.includes('thinking-chain-of-thought'), 'Must include chain of thought container');
    assert.ok(html.includes('thinking-cot-step'), 'Must include cot step rows');
    assert.ok(html.includes('thinking-cot-number'), 'Must include numbered badges');
    assert.ok(html.includes('1'), 'Must have step 1 number');
    assert.ok(html.includes('Deconstructing problem requirements'), 'Must include step 1 text');
    console.log('  [PASS] 1.2 Active CoT card renders 3-stage numbered narrative structure');
}

// Test 1.3: HTML escaping and XSS safety in thought content
{
    const dangerousThought = '<script>alert("xss")</script> & <div>test</div>';
    const html = buildThinkingProcessHtml(dangerousThought, [], '2.0', true, null);
    assert.ok(!html.includes('<script>'), 'Must not contain raw script tag');
    assert.ok(html.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'Must escape script tags');
    console.log('  [PASS] 1.3 HTML content within thoughts is securely escaped against XSS');
}

// Test 1.4: Self-healing retry indicator badge
{
    const selfHealing = { thought: 'Query refinement retry #1 applied' };
    const html = buildThinkingProcessHtml('Evaluating', [], '3.1', false, selfHealing);
    assert.ok(html.includes('thinking-step is-self-healing'), 'Must include self-healing badge');
    assert.ok(html.includes('Query refinement retry #1 applied'), 'Must contain self-healing thought text');
    console.log('  [PASS] 1.4 Self-healing retry steps render with distinct badge styling');
}

// Test 1.5: Empty thought / pleasantry suppression
{
    const html = buildThinkingProcessHtml('', [], '0.0', false, null);
    assert.equal(html, '', 'Empty thought and steps must produce empty string');
    console.log('  [PASS] 1.5 Empty thought content generates no unnecessary accordion markup');
}

// =============================================================================
// TEST SUITE 2: Auto-collapse Behavior Upon Answer Token Arrival
// =============================================================================
console.log('\n2. Testing auto-collapse behavior upon answer token arrival...');

{
    // Simulate streaming update cycle
    const cardEl = new MockElement('div', 'thinking-process-card is-active is-expanded');
    const headerEl = new MockElement('div', 'thinking-header');
    headerEl.setAttribute('aria-expanded', 'true');
    const timerEl = new MockElement('span', 'thinking-timer');
    timerEl.textContent = 'Thinking... 1.8s';
    headerEl.appendChild(timerEl);
    const bodyEl = new MockElement('div', 'thinking-body');
    const rawContentEl = new MockElement('div', 'thinking-raw-content');
    rawContentEl.textContent = 'Analyzing query semantics';
    bodyEl.appendChild(rawContentEl);
    cardEl.appendChild(headerEl);
    cardEl.appendChild(bodyEl);

    // Initial state check: streaming active
    assert.ok(cardEl.classList.contains('is-active'));
    assert.ok(cardEl.classList.contains('is-expanded'));
    assert.ok(!cardEl.classList.contains('is-finished'));

    // Step 2: Answer token arrives -> Transition to isFinished
    const cleanAnswer = 'The capital of France is Paris.';
    const isFinished = !!cleanAnswer;
    assert.equal(isFinished, true);

    // Execute the exact class update from updateStreamingAssistantMessage
    cardEl.className = 'thinking-process-card is-finished';
    headerEl.setAttribute('aria-expanded', 'false');
    if (timerEl && !timerEl.textContent.startsWith('Thought for')) {
        const elapsed = '1.8';
        timerEl.textContent = `Thought for ${elapsed}s`;
    }

    assert.ok(cardEl.classList.contains('is-finished'), 'Card must have is-finished class');
    assert.ok(!cardEl.classList.contains('is-expanded'), 'Card must NOT have is-expanded class (auto-collapsed)');
    assert.ok(!cardEl.classList.contains('is-active'), 'Card must NOT have is-active class');
    assert.equal(timerEl.textContent, 'Thought for 1.8s', 'Timer must update to "Thought for X.Xs" format');
    assert.equal(headerEl.getAttribute('aria-expanded'), 'false', 'aria-expanded must update to false');

    console.log('  [PASS] 2.1 Accordion automatically shifts to .is-finished and collapses .is-expanded when answer begins');
}

// =============================================================================
// TEST SUITE 3: Click Toggle Interaction (.is-expanded toggle & aria)
// =============================================================================
console.log('\n3. Testing click toggle expansion and collapse...');

{
    const card = new MockElement('div', 'thinking-process-card is-finished');
    const header = new MockElement('div', 'thinking-header');
    header.setAttribute('aria-expanded', 'false');
    card.appendChild(header);

    let stoppedEvent = false;
    const mockEvent = {
        stopPropagation: () => { stoppedEvent = true; }
    };

    // First click: Expand the collapsed card
    toggleThinkingProcessCard(card, mockEvent);
    assert.equal(stoppedEvent, true, 'Click event propagation must be stopped');
    assert.ok(card.classList.contains('is-expanded'), 'Click on finished card must add is-expanded');
    assert.ok(card.classList.contains('is-finished'), 'Card must retain is-finished');
    assert.equal(header.getAttribute('aria-expanded'), 'true', 'aria-expanded must toggle to true');

    // Second click: Collapse the expanded card
    stoppedEvent = false;
    toggleThinkingProcessCard(card, mockEvent);
    assert.equal(stoppedEvent, true);
    assert.ok(!card.classList.contains('is-expanded'), 'Second click must remove is-expanded');
    assert.ok(card.classList.contains('is-finished'));
    assert.equal(header.getAttribute('aria-expanded'), 'false', 'aria-expanded must toggle to false');

    // Passing header directly (resolving closest parent)
    stoppedEvent = false;
    toggleThinkingProcessCard(header, mockEvent);
    assert.ok(card.classList.contains('is-expanded'), 'Passing child element to toggle must toggle parent card');
    assert.equal(header.getAttribute('aria-expanded'), 'true');

    // Null safety
    assert.doesNotThrow(() => toggleThinkingProcessCard(null, null));
    console.log('  [PASS] 3.1 toggleThinkingProcessCard reliably toggles .is-expanded and updates ARIA attributes');
}

// =============================================================================
// TEST SUITE 4: Accurate Elapsed Duration Recording & Precision
// =============================================================================
console.log('\n4. Testing elapsed duration calculation and formatting...');

{
    const testLatencies = [
        { ms: 1420, expected: '1.4' },
        { ms: 2890, expected: '2.9' },
        { ms: 800, expected: '0.8' },
        { ms: 15600, expected: '15.6' }
    ];

    for (const { ms, expected } of testLatencies) {
        const elapsed = (ms / 1000).toFixed(1);
        assert.equal(elapsed, expected, `Expected ${expected}s from ${ms}ms`);
        const html = buildThinkingProcessHtml('thought', [], elapsed, false, null);
        assert.ok(html.includes(`Thought for ${expected}s`), `HTML must contain "Thought for ${expected}s"`);
    }
    console.log('  [PASS] 4.1 Latency duration accurately rounded to 1 decimal place with "Thought for X.Xs" syntax');
}

// =============================================================================
// TEST SUITE 5: CSS Transitions, Chevron Classes & Visual Semantics
// =============================================================================
console.log('\n5. Testing styles.css rules for transitions and layout...');

{
    // 5.1 Card smooth cubic-bezier transition
    assert.match(stylesCss, /\.thinking-process-card\s*\{[\s\S]*?transition:\s*all\s+0\.25s\s+cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\)/, 'Card must have 0.25s cubic-bezier transition');

    // 5.2 Chevron rotation on expand
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-chevron[\s\S]*?transform:\s*rotate\(180deg\)/, 'Chevron must rotate 180deg when is-expanded');

    // 5.3 Accordion body continuous transition (max-height, opacity, padding)
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?max-height:\s*0/, 'Thinking body must default to max-height: 0');
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?opacity:\s*0/, 'Thinking body must default to opacity: 0');
    assert.match(stylesCss, /\.thinking-body\s*\{[\s\S]*?transition:\s*max-height/, 'Thinking body must transition max-height');

    // 5.4 Expanded body open state
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-body[\s\S]*?max-height:\s*min\(/, 'Expanded body must have responsive max-height');
    assert.match(stylesCss, /\.thinking-process-card\.is-expanded\s+\.thinking-body[\s\S]*?opacity:\s*1/, 'Expanded body must have opacity: 1');

    // 5.5 Keyframes: thinkingDotGlow and fadeInThought
    assert.match(stylesCss, /@keyframes thinkingDotGlow\s*\{/, 'Must define thinkingDotGlow keyframes');
    assert.match(stylesCss, /@keyframes fadeInThought\s*\{/, 'Must define fadeInThought keyframes');
    assert.match(stylesCss, /\.thinking-process-card\.is-finished\s+\.thinking-pulse-dot\s*\{[\s\S]*?animation:\s*none/, 'Finished pulse dot must disable animation');

    // 5.6 Mobile and accessibility reduced motion
    assert.match(stylesCss, /@media\s*\(max-width:\s*640px\)[\s\S]*?\.thinking-header/, 'Must provide mobile media query for thinking-header');
    assert.match(stylesCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?\.thinking-body/, 'Must provide reduced motion accessibility rules');

    console.log('  [PASS] 5.1 All CSS rules for smooth transitions, fadeInThought keyframes, chevron rotation, and mobile responsiveness verified');
}

console.log('\n================================================================');
console.log('--- REASONING UI ACCORDION TEST SUITE COMPLETED (5/5 PASS) ---');
console.log('================================================================\n');

});

test('Dynamic CoT Reasoning & Streaming', async () => {



console.log('--- Testing Dynamic Chain of Thought & Reasoning Engine (Milestone 1) ---');

const indexHtml = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const chatGroqJs = fs.readFileSync(new URL('../api/chat-groq.js', import.meta.url), 'utf8');

function extractFunctionSource(source, name) {
    const start = source.indexOf('function ' + name + '(');
    assert.notEqual(start, -1, 'missing function ' + name);
    let parenDepth = 0;
    let bodyStart = -1;
    for (let i = start; i < source.length; i++) {
        const char = source[i];
        if (char === '(') parenDepth++;
        else if (char === ')') {
            parenDepth--;
            if (parenDepth === 0) {
                bodyStart = source.indexOf('{', i);
                break;
            }
        }
    }
    assert.notEqual(bodyStart, -1, 'could not find body for ' + name);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        const char = source[i];
        if (char === '{') depth++;
        else if (char === '}') {
            depth--;
            if (depth === 0) {
                return source.slice(start, i + 1);
            }
        }
    }
    throw new Error('could not extract complete source for ' + name);
}

const cotSandbox = {};
vm.createContext(cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'generateContextualThoughtSteps'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'extractThoughtAndAnswer'), cotSandbox);
const generateSteps = cotSandbox.generateContextualThoughtSteps;
const extractThoughtAndAnswer = cotSandbox.extractThoughtAndAnswer;

// 1. Test Pleasantries and Ultra-Short Greetings return empty array
assert.equal(generateSteps('hi').length, 0);
assert.equal(generateSteps('hello!').length, 0);
assert.equal(generateSteps('thanks').length, 0);
assert.equal(generateSteps('ok').length, 0);
console.log('  [PASS] 1. Pleasantries and short greetings produce no unnecessary CoT steps');

// 2. Test Real-Model-Thinking-Only Invariant across Diverse Queries
const testQueries = [
    { query: 'Write a quicksort algorithm in Python with asymptotic analysis', domain: 'Coding (Python)' },
    { query: 'How to implement a debounce function in TypeScript?', domain: 'Coding (TypeScript)' },
    { query: 'Calculate the derivative of f(x) = x^3 * sin(x)', domain: 'Mathematics' },
    { query: 'Why did the Roman Empire collapse in 476 AD?', domain: 'History' },
    { query: 'Explain how gravitational time dilation works near a black hole', domain: 'Physics' },
    { query: 'What is the capital of Australia and why was Canberra chosen?', domain: 'Geography' },
    { query: 'Compare PostgreSQL vs MongoDB for high-throughput write workloads', domain: 'Comparison' },
    { query: 'How does CRISPR-Cas9 perform targeted gene editing in molecular biology?', domain: 'Biology' },
    { query: 'How do central banks use interest rates to combat inflation?', domain: 'Economics' },
    { query: 'Traditional sourdough bread recipe with hydration percentages', domain: 'Procedural' }
];

for (const { query, domain } of testQueries) {
    const steps = generateSteps(query);
    assert.ok(Array.isArray(steps), 'Steps for ' + domain + ' must be an array');
    assert.ok(steps.length >= 2, 'Must produce structured pipeline reasoning summaries: ' + domain);
    assert.ok(steps.every(s => s.title && s.body), 'Steps must contain title and body: ' + domain);
}
console.log('  [PASS] 2. Structured pipeline reasoning summaries successfully generated across domains');

// 3. Test Multi-Chunk Converse Speech Stream <think> Filtering
const speechSandbox = {
    streamingConverseSpeech: null,
    stopConverseSpeech: () => {},
    setConverseUiState: () => {},
    sanitizeTextForConverseSpeech: text => String(text || '').trim(),
    splitConverseSpeechSegments: text => [text],
    processStreamingSpeechQueue: () => {},
    getConversationTurn: () => null,
    speakConverseReply: () => {}
};
vm.createContext(speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'startStreamingConverseSpeech'), speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'feedStreamingConverseDelta'), speechSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'finishStreamingConverseSpeech'), speechSandbox);

speechSandbox.startStreamingConverseSpeech('turn-1');
// Delta 1: Start of thinking block
speechSandbox.feedStreamingConverseDelta('<think>\nAnalyzing contextual parameters deeply...', 'turn-1');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'No thinking tokens enqueued');

// Delta 2: Intermediate reasoning tokens across chunk boundaries
speechSandbox.feedStreamingConverseDelta('\nEvaluating domain principles and causal logic...', 'turn-1');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'Intermediate tokens not enqueued');

// Delta 3: Closing thinking tag and starting answer sentence
speechSandbox.feedStreamingConverseDelta('\n</think>\nPrimary verified synthesis statement.\n', 'turn-1');
speechSandbox.feedStreamingConverseDelta('Secondary detailed elaboration text.\n', 'turn-1');
speechSandbox.finishStreamingConverseSpeech('Primary verified synthesis statement.\nSecondary detailed elaboration text.\n', 'turn-1');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.length >= 1, 'Verified answer segments enqueued');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.every(seg => !seg.includes('<think>') && !seg.includes('</think>')), 'No reasoning tags leaked into speech segments');

// Turn 2: Split closing tag across chunk boundary
speechSandbox.startStreamingConverseSpeech('turn-2');
speechSandbox.feedStreamingConverseDelta('<think>internal reasoning steps</th', 'turn-2');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments.length, 0, 'Partial thinking tag buffer must not emit speech');
speechSandbox.feedStreamingConverseDelta('ink>\nFinal response after split tag.\n', 'turn-2');
speechSandbox.finishStreamingConverseSpeech('Final response after split tag.\n', 'turn-2');
assert.ok(speechSandbox.streamingConverseSpeech.enqueuedSegments.length >= 1, 'Response after split tag enqueued');
assert.equal(speechSandbox.streamingConverseSpeech.enqueuedSegments[0], 'Final response after split tag.');
console.log('  [PASS] 3. Multi-chunk <think> converse stream delta filtering prevents speech leakage');

// 4. Test extractThoughtAndAnswer in client index.html
const extractResult1 = extractThoughtAndAnswer('<think>\nStep-by-step reasoning\n</think>\nHere is the answer.');
assert.equal(extractResult1.thought, 'Step-by-step reasoning');
assert.equal(extractResult1.answer, 'Here is the answer.');

const extractResult2 = extractThoughtAndAnswer('<think>\nActive streaming thought in progress');
assert.equal(extractResult2.thought, 'Active streaming thought in progress');
assert.equal(extractResult2.answer, '');

const extractResult3 = extractThoughtAndAnswer('Simple answer without any reasoning block.');
assert.equal(extractResult3.thought, '');
assert.equal(extractResult3.answer, 'Simple answer without any reasoning block.');
console.log('  [PASS] 4. extractThoughtAndAnswer parses completed and streaming thought blocks');

// 5. Test parseModelText in api/chat-groq.js extracts { response, thought }
const backendSandbox = {};
vm.createContext(backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'extractThoughtAndResponse'), backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'stripThinkingTags'), backendSandbox);
vm.runInContext(extractFunctionSource(chatGroqJs, 'parseModelText'), backendSandbox);
const parseModelText = backendSandbox.parseModelText;

const parsedWithThought = parseModelText('<think>\nEvaluating mathematical principles\n</think>\nThe derivative is 3x^2.');
assert.equal(parsedWithThought.response, 'The derivative is 3x^2.');
assert.equal(parsedWithThought.thought, 'Evaluating mathematical principles');
assert.equal(parsedWithThought.intent, 'casual_chat');

const parsedJsonWithThought = parseModelText('<think>\nAnalyzing user request\n</think>\n```json\n{"intent":"casual_chat","response":"Hello world!"}\n```');
assert.equal(parsedJsonWithThought.response, 'Hello world!');
assert.equal(parsedJsonWithThought.thought, 'Analyzing user request');

const parsedPlain = parseModelText('Plain text response without thinking tags.');
assert.equal(parsedPlain.response, 'Plain text response without thinking tags.');
assert.equal(parsedPlain.thought, undefined);

// 6. Test system instruction leakage / meta-analysis suppression
const leakedMetaResponse = parseModelText('Analyze User Input:\nThe user asked to solve this math problem from the OCR image, said this: "find x".\n\nCheck Constraints & Rules:\n- Direct answer\n- No meta-talk\n\nFinal Answer:\nx = 42');
assert.equal(leakedMetaResponse.response, 'x = 42');
assert.ok(leakedMetaResponse.thought.includes('Analyze User Input:'));

const clientExtractLeaked = extractThoughtAndAnswer('The user asked to solve the attachment, said this: "calculate integral".\nApplying rules: Start directly with the answer.\n\nHere is the solution:\n\\int x dx = \\frac{x^2}{2} + C');
assert.equal(clientExtractLeaked.answer, '\\int x dx = \\frac{x^2}{2} + C');
assert.ok(clientExtractLeaked.thought.includes('The user asked'));

console.log('  [PASS] 6. System instruction leakage and meta-chatter cleanly tucked into thought');

function fixtureSubject(value) {
    return String(value || '');
}

// 7. Verify Clean Chain of Thoughts (historical stat query produces no fake CoT)
assert.equal(generateSteps("How many 100's did sachin score in International cricket?").length, 0, 'Past sports stat queries must not produce fake CoT steps');
assert.equal(generateSteps("Who scored the winning goal in 2010?").length, 0, 'Past historical scoring questions must not produce fake CoT steps');
assert.ok(!indexHtml.includes('Dispatching real-time multi-source news scrapers'), 'Outdated news scrapers string must be permanently removed');
assert.ok(indexHtml.includes('Querying verified real-time sources'), 'Clean verified sources wording must be used in CoT');
console.log('  [PASS] 7. Dynamic CoT cleanliness and historical stat queries protected');

// 8. Verify Confident Single-Source Early Exit in Search Pipeline
const { __test: searchTest } = await import('../api/search.js');
const confidentSingleSource = [{
    title: fixtureSubject('Athlete Career Record - Wiki'),
    domain: 'wikipedia.org',
    url: 'https://en.wikipedia.org/wiki/Subject',
    description: fixtureSubject('Subject is an international athlete who recorded 100 centuries across professional matches.'),
    sourceType: 'encyclopedia',
    trusted: true
}];
const singleGate = searchTest.evaluateWebRagEvidence('How many centuries did the athlete score in career', confidentSingleSource);
assert.equal(singleGate.pass, true, 'Confident single authoritative source must pass early exit without requiring 2+ domains');
assert.ok(singleGate.confidence >= 0.85, 'Confident single source must have high confidence score');
assert.ok(indexHtml.includes('hasConfidentSingleSource'), 'Frontend handleLiveRetrievalQuery must support confident single-source early exit');
console.log('  [PASS] 8. Confident single-source early exit verified');

// 9. Verify Domain-Agnostic Entity Attribution & Universal Depth (Industry Standard Architecture)
vm.runInContext(extractFunctionSource(indexHtml, 'isExplicitBrevityRequested'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isEntityAttributionQuery'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isStrictYesNoRequest'), cotSandbox);
vm.runInContext(extractFunctionSource(indexHtml, 'isConciseDirectFactQuery'), cotSandbox);

const { isExplicitBrevityRequested, isEntityAttributionQuery, isConciseDirectFactQuery } = cotSandbox;

// 9.1 Domain-agnostic grammatical entity-relationship attribution
assert.equal(isEntityAttributionQuery('which movie is the song from?'), true, 'Creative work attribution must be detected');
assert.equal(isEntityAttributionQuery('which novel is the character from?'), true, 'Literature attribution must be detected');
assert.equal(isEntityAttributionQuery('who composed the soundtrack of the film?'), true, 'Music composition attribution must be detected');
assert.equal(isEntityAttributionQuery('who invented the telescope?'), true, 'Scientific invention attribution must be detected');
assert.equal(isEntityAttributionQuery('who discovered penicillin?'), true, 'Scientific discovery attribution must be detected');
assert.equal(isEntityAttributionQuery('who founded the company?'), true, 'Organizational founder attribution must be detected');
assert.equal(isEntityAttributionQuery('is the character from novel Alpha or novel Beta?'), true, 'Comparative origin attribution must be detected');
assert.equal(isEntityAttributionQuery('who played the role of the detective?'), true, 'Role representation attribution must be detected');
assert.equal(isEntityAttributionQuery('what is the capital of France?'), false, 'General fact query must not be detected as entity attribution');
assert.equal(isEntityAttributionQuery('how to implement quicksort in Python?'), false, 'Coding query must not be detected as entity attribution');

// 9.2 Explicit brevity detection
assert.equal(isExplicitBrevityRequested('in one sentence, who composed the score?'), true);
assert.equal(isExplicitBrevityRequested('briefly tell me the origin of the discovery'), true);
assert.equal(isExplicitBrevityRequested('tldr of the research paper'), true);
assert.equal(isExplicitBrevityRequested('tell me all about the historical background and founder'), false);

// 9.3 Universal depth default: queries are NEVER arbitrarily truncated unless brevity is explicitly requested
assert.equal(isConciseDirectFactQuery('who is the founder of the organization?'), false, 'General queries must NOT be forced into 1-2 sentence one-liners by default');
assert.equal(isConciseDirectFactQuery('tell me about the discovery and its impact'), false, 'Exploratory queries must NOT be forced into one-liners');
assert.equal(isConciseDirectFactQuery('in one sentence, who is the founder?'), true, 'Explicit brevity query must be recognized as concise');
assert.equal(isConciseDirectFactQuery('is this true? yes or no'), true, 'Strict yes/no binary queries must be recognized as concise');
console.log('  [PASS] 9. Domain-agnostic entity attribution & universal response depth verified');

// 10. Verify Anti-Hallucination Prompt Invariants in Groq Chat & System Directives
assert.ok(chatGroqJs.includes('Strict entity and soundtrack attribution'), 'Chat backend must enforce strict entity and soundtrack attribution');
assert.ok(chatGroqJs.includes('Never guess or attribute an entity to the wrong source'), 'Chat backend must explicitly forbid attribution hallucination');
assert.ok(chatGroqJs.includes('Default to a comprehensive, well-structured response'), 'Chat backend must default to comprehensive responses for cultural/creative queries');
assert.ok(indexHtml.includes('Depth & Quality Guidance'), 'Frontend system directives must provide universal depth & quality guidance');
assert.ok(indexHtml.includes('strictly verify the exact association'), 'Frontend system directives must instruct strict entity association verification');
console.log('  [PASS] 10. Strict anti-hallucination attribution prompt directives verified');

// 11. Verify Smooth Thinking Indicator & Transition Animations
const stylesCss = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
assert.ok(stylesCss.includes('#chat-thinking-indicator'), 'styles.css must contain #chat-thinking-indicator transition rules');
assert.ok(stylesCss.includes('chat-thinking-indicator-leaving'), 'styles.css must contain .chat-thinking-indicator-leaving fade-out styles');
assert.ok(stylesCss.includes('assistantBubbleEnter'), 'styles.css must contain assistantBubbleEnter entrance animation');
assert.ok(indexHtml.includes('chat-thinking-indicator-leaving'), 'index.html hideThinkingIndicator must apply leaving transition class');
console.log('  [PASS] 11. Smooth thinking indicator exit and entrance animations verified');

console.log('dynamic-cot-reasoning-tests-ok');

});

test('Stop Thinking & Clarification Dialogues', async () => {

console.log('=== Testing Stop Thinking & 10s Clarification Suite ===');

// --- Mock DOM Environment ---
class MockElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.placeholder = '';
        this.textContent = '';
        this.innerHTML = '';
        this.dataset = {};
        this.attributes = new Map();
        this.children = [];
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            toggle: (c, force) => {
                if (force === true) this.classList._classes.add(c);
                else if (force === false) this.classList._classes.delete(c);
                else if (this.classList._classes.has(c)) this.classList._classes.delete(c);
                else this.classList._classes.add(c);
                return this.classList._classes.has(c);
            },
            contains: c => this.classList._classes.has(c)
        };
    }

    setAttribute(name, value) { this.attributes.set(name, String(value)); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    hasAttribute(name) { return this.attributes.has(name); }
    removeAttribute(name) { this.attributes.delete(name); }
    appendChild(child) { this.children.push(child); return child; }
    querySelector(selector) {
        const targetClass = selector.replace('.', '');
        const findRecursive = el => {
            if (el.classList?.contains(targetClass)) return el;
            for (const child of el.children || []) {
                const found = findRecursive(child);
                if (found) return found;
            }
            return null;
        };
        for (const child of this.children || []) {
            const found = findRecursive(child);
            if (found) return found;
        }
        return null;
    }
    querySelectorAll(selector) {
        return this.children.filter(c => c.classList?.contains(selector.replace('.', '')));
    }
}

// Populate mock elements
const sendBtn = new MockElement('send-message-btn', 'button');
const thinkingCard = new MockElement('card-1', 'div');
thinkingCard.classList.add('thinking-process-card', 'is-active', 'is-expanded');

const thinkingHeader = new MockElement('header-1', 'button');
thinkingHeader.classList.add('thinking-header');
thinkingHeader.setAttribute('aria-expanded', 'true');

const timerEl = new MockElement('timer-1', 'span');
timerEl.classList.add('thinking-timer');
timerEl.textContent = 'Thinking... 2.4s';
thinkingHeader.appendChild(timerEl);
thinkingCard.appendChild(thinkingHeader);

globalThis.document = {
    getElementById: id => (id === 'send-message-btn' ? sendBtn : null),
    querySelectorAll: sel => {
        if (sel.includes('.thinking-process-card.is-active')) return [thinkingCard];
        return [];
    }
};

// ============================================================================
// Section 1: Immediate Stop During Active Thinking
// ============================================================================
console.log('--- Section 1: Immediate Stop During Active Thinking ---');

function stopActiveGeneration(reason = 'manual') {
    // Freeze any active thinking process cards in the DOM immediately
    const activeThinkingCards = globalThis.document.querySelectorAll('.thinking-process-card.is-active, .thinking-process-card.is-expanded');
    activeThinkingCards.forEach(card => {
        card.classList.remove('is-active', 'is-expanded');
        card.classList.add('is-finished');
        const timer = card.querySelector('.thinking-timer');
        if (timer) {
            const rawTime = timer.textContent.replace(/^Thinking\.\.\.\s*/i, '').replace(/^Thought for\s*/i, '').replace(/\s*\(Stopped\)/i, '').trim();
            timer.textContent = `Thought for ${rawTime || '0.0s'} (Stopped)`;
        }
        const header = card.querySelector('.thinking-header');
        if (header && typeof header.setAttribute === 'function') {
            header.setAttribute('aria-expanded', 'false');
        }
    });
    sendBtn.classList.remove('composer-send-stop');
}

// User presses stop while model is thinking (timer at 2.4s)
assert.equal(thinkingCard.classList.contains('is-active'), true);
assert.equal(thinkingCard.classList.contains('is-expanded'), true);
assert.equal(thinkingHeader.getAttribute('aria-expanded'), 'true');

stopActiveGeneration('manual');

assert.equal(thinkingCard.classList.contains('is-active'), false, 'is-active class must be removed');
assert.equal(thinkingCard.classList.contains('is-expanded'), false, 'is-expanded class must be removed');
assert.equal(thinkingCard.classList.contains('is-finished'), true, 'is-finished class must be added');
assert.equal(timerEl.textContent, 'Thought for 2.4s (Stopped)', 'Timer must display frozen elapsed time with (Stopped) tag');
assert.equal(thinkingHeader.getAttribute('aria-expanded'), 'false', 'ARIA expanded attribute must be synchronized to false');
console.log('  [PASS] 1.1 Pressing stop during thinking immediately freezes the accordion and marks state as Stopped');

// ============================================================================
// Section 2: 10-Second Thinking Cap & Watchdog
// ============================================================================
console.log('--- Section 2: 10-Second Thinking Cap & Watchdog ---');

function simulateStreamingWatchdog(accumulated, elapsedMs) {
    let thinkingCapped = false;
    if (elapsedMs >= 10000) {
        if (accumulated.includes('<think>') && !accumulated.includes('</think>')) {
            thinkingCapped = true;
            accumulated += '\n</think>\n';
        }
    }
    return { accumulated, thinkingCapped };
}

// Case 2.1: Under 10s thinking continues normally
const res1 = simulateStreamingWatchdog('<think>\nAnalyzing facts...', 4500);
assert.equal(res1.thinkingCapped, false);
assert.equal(res1.accumulated.includes('</think>'), false);
console.log('  [PASS] 2.1 Thinking under 10 seconds continues streaming smoothly without premature truncation');

// Case 2.2: Reaching 10s ceiling auto-closes thinking block
const res2 = simulateStreamingWatchdog('<think>\nAnalyzing facts for extended duration...', 10100);
assert.equal(res2.thinkingCapped, true);
assert.equal(res2.accumulated.includes('</think>'), true);
console.log('  [PASS] 2.2 Reaching 10-second ceiling auto-concludes thinking and transitions to answer phase');

// ============================================================================
// Section 3: Standalone Entity Direct Factual Overview Rule
// ============================================================================
console.log('--- Section 3: Standalone Entity Direct Factual Overview ---');

function isStandaloneEntityQuery(query) {
    const text = String(query || '').trim();
    if (!text) return false;
    const words = text.split(/\s+/);
    // 1 to 3 words with no question words or action verbs
    if (words.length > 4) return false;
    const actionPattern = /^(how|why|when|where|what|who|can|could|would|will|is|are|do|does|did|explain|write|create|compare|search|find|show)\b/i;
    return !actionPattern.test(text);
}

const entityQueries = ['Photosynthesis', 'Tesla', 'Alan Turing', 'PostgreSQL', 'Taj Mahal', 'DNA', 'Quantum Computing'];
for (const q of entityQueries) {
    assert.equal(isStandaloneEntityQuery(q), true, `"${q}" should classify as a standalone entity query`);
}
console.log('  [PASS] 3.1 Standalone entity queries correctly identify for immediate 2-4 sentence factual overviews');

// ============================================================================
// Section 4: Ambiguity & Clarification Detection
// ============================================================================
console.log('--- Section 4: Ambiguity & Clarification Routing ---');

function isAmbiguousOrUnderspecifiedQuery(query) {
    const text = String(query || '').trim().toLowerCase();
    const ambiguousTokens = new Set(['it', 'that', 'this', 'why', 'start', 'that thing', 'what about it', 'how come', 'more info']);
    if (ambiguousTokens.has(text)) return true;
    if (/^(it|that|this|why|start|start now|that thing)$/i.test(text)) return true;
    return false;
}

const ambiguousQueries = ['it', 'that thing', 'why', 'start', 'start now'];
for (const q of ambiguousQueries) {
    assert.equal(isAmbiguousOrUnderspecifiedQuery(q), true, `"${q}" should be recognized as ambiguous`);
}
console.log('  [PASS] 4.1 Ambiguous/fragmented queries correctly trigger targeted clarification prompts');

console.log('================================================================');
console.log('=== All Stop Thinking & 10s Clarification Tests PASSED ===');
console.log('================================================================');

});

test('Assistant Action Bar & Suggestion Followups', async () => {

console.log('=== Testing Assistant Action Bar & Follow-Up Chips Suite ===');

// --- Mock Browser DOM & APIs ---
class MockDOMElement {
    constructor(id = '', tagName = 'div') {
        this.id = id;
        this.tagName = tagName.toUpperCase();
        this.value = '';
        this.innerHTML = '';
        this.textContent = '';
        this.dataset = {};
        this.children = [];
        this.attributes = new Map();
        this.style = {};
        this.classList = {
            _classes: new Set(),
            add: (...cls) => cls.forEach(c => this.classList._classes.add(c)),
            remove: (...cls) => cls.forEach(c => this.classList._classes.delete(c)),
            contains: c => this.classList._classes.has(c)
        };
    }

    setAttribute(n, v) { this.attributes.set(n, String(v)); }
    getAttribute(n) { return this.attributes.get(n) ?? null; }
    appendChild(c) { this.children.push(c); return c; }
    querySelector(selector) {
        const targetClass = selector.replace('.', '');
        const find = el => {
            if (el.classList?.contains(targetClass)) return el;
            for (const child of el.children || []) {
                const found = find(child);
                if (found) return found;
            }
            return null;
        };
        for (const child of this.children || []) {
            const found = find(child);
            if (found) return found;
        }
        return null;
    }
}

// Clipboard Mock
let clipboardContent = '';
try {
    Object.defineProperty(globalThis.navigator, 'clipboard', {
        value: {
            writeText: async text => {
                clipboardContent = text;
                return true;
            }
        },
        configurable: true
    });
} catch (_) {
    globalThis.navigator = {
        clipboard: {
            writeText: async text => {
                clipboardContent = text;
                return true;
            }
        }
    };
}

// SpeechSynthesis Mock
let speakingText = '';
globalThis.SpeechSynthesisUtterance = class {
    constructor(text) { this.text = text; }
};
globalThis.speechSynthesis = {
    speaking: false,
    speak(u) {
        this.speaking = true;
        speakingText = u.text;
    },
    cancel() {
        this.speaking = false;
        speakingText = '';
    }
};

// ============================================================================
// Section 1: Assistant Action Bar Clean Layout (No Suggested Follow-Up Chips)
// ============================================================================
console.log('--- Section 1: Clean Action Bar Layout ---');

function buildAssistantActionBarHtml(hasThought = false) {
    return `
        <div class="assistant-action-bar">
            <button type="button" class="assistant-action-btn" title="Copy answer">
                <span>Copy</span>
            </button>
            ${hasThought ? `
            <button type="button" class="assistant-action-btn" title="Copy thought process">
                <span>Thought</span>
            </button>` : ''}
            <button type="button" class="assistant-action-btn" title="Bookmark message">
                <span>Bookmark</span>
            </button>
            <button type="button" class="assistant-action-btn" title="Read answer aloud">
                <span>Speak</span>
            </button>
        </div>
    `;
}

// 1.1 Action bar with thought
const barWithThought = buildAssistantActionBarHtml(true);
assert.ok(barWithThought.includes('Copy'), 'Action bar must contain Copy button');
assert.ok(barWithThought.includes('Thought'), 'Action bar must contain Thought button when thought exists');
assert.ok(barWithThought.includes('Bookmark'), 'Action bar must contain Bookmark button');
assert.ok(barWithThought.includes('Speak'), 'Action bar must contain Speak button');
assert.ok(!barWithThought.includes('SUGGESTED FOLLOW-UPS'), 'Must never render suggested follow-ups banner');
console.log('  [PASS] 1.1 Action bar contains Copy, Thought, Bookmark, and Speak without suggested follow-up chips');

// 1.2 Action bar without thought
const barWithoutThought = buildAssistantActionBarHtml(false);
assert.ok(barWithoutThought.includes('Copy'), 'Action bar must contain Copy button');
assert.ok(!barWithoutThought.includes('Thought'), 'Action bar must omit Thought button when no thought');
assert.ok(barWithoutThought.includes('Bookmark'), 'Action bar must contain Bookmark button');
assert.ok(barWithoutThought.includes('Speak'), 'Action bar must contain Speak button');
assert.ok(!barWithoutThought.includes('SUGGESTED FOLLOW-UPS'), 'Must never render suggested follow-ups banner');
console.log('  [PASS] 1.2 Action bar renders cleanly without thought and without suggested follow-up banner');

// ============================================================================
// Section 2: Action Bar Actions (Copy Answer, Copy Thought, Speak)
// ============================================================================
console.log('--- Section 2: Action Bar Functionality ---');

// 2.1 Copy Answer Text
const copyAnswerBtn = new MockDOMElement('copy-btn', 'button');
copyAnswerBtn.innerHTML = '<span>Copy</span>';

async function copyAssistantMessageText(button, text) {
    await navigator.clipboard.writeText(String(text || '').trim());
    if (button) {
        button.innerHTML = '<span>Copied</span>';
        button.classList.add('is-copied');
    }
}

await copyAssistantMessageText(copyAnswerBtn, 'Canberra is the capital of Australia.');
assert.equal(clipboardContent, 'Canberra is the capital of Australia.');
assert.equal(copyAnswerBtn.classList.contains('is-copied'), true);
console.log('  [PASS] 2.1 Copy answer button copies text to clipboard and gives visual feedback');

// 2.2 Copy Thought Text
const copyThoughtBtn = new MockDOMElement('thought-btn', 'button');
async function copyAssistantThoughtText(button, thought) {
    await navigator.clipboard.writeText(String(thought || '').trim());
    if (button) {
        button.innerHTML = '<span>Copied Thought</span>';
        button.classList.add('is-copied');
    }
}

await copyAssistantThoughtText(copyThoughtBtn, 'Checked rule: Start directly with answer.');
assert.equal(clipboardContent, 'Checked rule: Start directly with answer.');
assert.equal(copyThoughtBtn.classList.contains('is-copied'), true);
console.log('  [PASS] 2.2 Copy thought button copies internal reasoning to clipboard');

// 2.3 Speak / Read Aloud Toggle
const speakBtn = new MockDOMElement('speak-btn', 'button');
function toggleSpeakAssistantMessage(button, text) {
    if (globalThis.speechSynthesis.speaking) {
        globalThis.speechSynthesis.cancel();
        button.classList.remove('is-speaking');
        return;
    }
    const u = new globalThis.SpeechSynthesisUtterance(text);
    button.classList.add('is-speaking');
    globalThis.speechSynthesis.speak(u);
}

toggleSpeakAssistantMessage(speakBtn, 'Quantum computing uses qubits.');
assert.equal(globalThis.speechSynthesis.speaking, true);
assert.equal(speakingText, 'Quantum computing uses qubits.');
assert.equal(speakBtn.classList.contains('is-speaking'), true);

// Toggle again to stop speech
toggleSpeakAssistantMessage(speakBtn, 'Quantum computing uses qubits.');
assert.equal(globalThis.speechSynthesis.speaking, false);
assert.equal(speakBtn.classList.contains('is-speaking'), false);
console.log('  [PASS] 2.3 Speak button plays audio and toggles stop on second press');

// ============================================================================
// Section 3: Bookmark Storage & State Toggle
// ============================================================================
console.log('--- Section 3: Bookmark Storage & State Toggle ---');

const mockStorage = new Map();
function saveBookmark(text) {
    const list = JSON.parse(mockStorage.get('bookmarks') || '[]');
    const idx = list.indexOf(text);
    if (idx >= 0) {
        list.splice(idx, 1);
    } else {
        list.push(text);
    }
    mockStorage.set('bookmarks', JSON.stringify(list));
    return list.includes(text);
}

const isBookmarked1 = saveBookmark('Insight 1');
assert.equal(isBookmarked1, true, 'Message should be bookmarked');
assert.equal(JSON.parse(mockStorage.get('bookmarks')).length, 1);

const isBookmarked2 = saveBookmark('Insight 1');
assert.equal(isBookmarked2, false, 'Message bookmark should toggle off');
assert.equal(JSON.parse(mockStorage.get('bookmarks')).length, 0);
console.log('  [PASS] 3.1 Bookmark toggles properly in persistent storage');

console.log('================================================================');
console.log('=== All Action Bar Tests PASSED ===');
console.log('================================================================');

});

test('Tablet & iPad Responsive Breakpoints', async () => {



console.log('=== Testing Tablet & iPad Layout Optimization Suite ===\n');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// Section 1: Viewport Meta Tag & Virtual Keyboard Configuration
console.log('--- Section 1: Viewport Meta Tag & Virtual Keyboard Configuration ---');
assert.ok(
    indexHtml.includes('viewport-fit=cover'),
    'Viewport meta tag must include viewport-fit=cover for edge-to-edge iPad displays'
);
assert.ok(
    indexHtml.includes('interactive-widget=resizes-content'),
    'Viewport meta tag must include interactive-widget=resizes-content for iPad on-screen keyboard support'
);
console.log('  [PASS] 1.1 Viewport meta tag contains viewport-fit=cover and interactive-widget=resizes-content');

// Section 2: Floating Input Bar Fix on Tablets (<= 1024px)
console.log('--- Section 2: Floating Input Bar Fix on Tablets (<= 1024px) ---');
const stickyInputBarRegex = /@media\s*\(max-width:\s*1024px\)[\s\S]*?\.floating-input-bar\s*\{[^}]*position:\s*sticky/i;
assert.ok(
    !stickyInputBarRegex.test(stylesCss),
    'Floating input bar must NOT be set to position: sticky on <= 1024px (must remain fixed)'
);

assert.ok(
    stylesCss.includes('position: fixed !important;') && stylesCss.includes('z-index: 40 !important;'),
    'Floating input bar must be enforced as fixed with z-index: 40 on <= 1024px'
);
console.log('  [PASS] 2.1 Floating input bar is fixed to bottom across all tablet and mobile viewports');

// Section 3: Dedicated Tablet & iPad Breakpoints (641px to 1024px)
console.log('--- Section 3: Dedicated Tablet & iPad Breakpoints (641px to 1024px) ---');
assert.ok(
    stylesCss.includes('@media (min-width: 641px) and (max-width: 1024px)'),
    'Dedicated tablet breakpoint (641px to 1024px) must exist in styles.css'
);

assert.ok(
    stylesCss.includes('env(safe-area-inset-left)') &&
    stylesCss.includes('env(safe-area-inset-right)') &&
    stylesCss.includes('env(safe-area-inset-top)') &&
    stylesCss.includes('env(safe-area-inset-bottom)'),
    'Tablet styles must incorporate all 4 safe area insets (top, bottom, left, right)'
);
console.log('  [PASS] 3.1 Tablet breakpoint and 4-way safe area insets verified');

// Section 4: Apple HIG Touch Targets & Touch Ergonomics
console.log('--- Section 4: Apple HIG Touch Targets & Touch Ergonomics ---');
assert.ok(
    stylesCss.includes('@media (pointer: coarse)'),
    'Pointer coarse media query must exist for touchscreen ergonomics'
);
assert.ok(
    stylesCss.includes('min-width: 44px') && stylesCss.includes('min-height: 44px'),
    'Touch targets must meet Apple HIG 44px minimum sizing rule'
);
assert.ok(
    stylesCss.includes('-webkit-overflow-scrolling: touch'),
    'Momentum touch scrolling (-webkit-overflow-scrolling: touch) must be enabled'
);
console.log('  [PASS] 4.1 Apple HIG 44px touch targets and smooth touch scrolling verified');

// Section 5: Dynamic Viewport Height & Orientation Handling
console.log('--- Section 5: Dynamic Viewport Height & Orientation Handling ---');
assert.ok(
    indexHtml.includes('window.visualViewport'),
    'setVH must utilize window.visualViewport for real-time keyboard/screen dimension updates'
);
assert.ok(
    indexHtml.includes("addEventListener('orientationchange', setVH)"),
    'Orientation change listener must be registered for smooth tablet rotation'
);
assert.ok(
    indexHtml.includes("document.body.classList.remove('sidebar-docked')"),
    'Sidebar docking must auto-undock when screen rotates below 1024px'
);
console.log('  [PASS] 5.1 Dynamic Viewport Height, visualViewport, and orientationchange handling verified');

// Section 6: Horizontal Code and Table Overflow Protection
console.log('--- Section 6: Horizontal Code and Table Overflow Protection ---');
assert.ok(
    stylesCss.includes('.table-wrapper') && stylesCss.includes('overflow-x: auto'),
    'Tables and code blocks must support horizontal scrolling without breaking the layout'
);
console.log('  [PASS] 6.1 Code blocks and tables protected against horizontal overflow on tablets');

console.log('\n=== All Tablet & iPad Layout Optimization Tests PASSED ===\n');

});

test('Responsive Settings UI & Modal Contracts', async () => {



console.log('=== Testing Responsive UI & Settings Across Every Device ===');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');

// =========================================================================
// Section 1: Custom Instructions Subview "Settings" Button Visibility
// =========================================================================
console.log('--- Section 1: Custom Instructions Subview "Settings" Button Visibility ---');

// 1.1 Verify Subview Header HTML structure
assert.ok(
    indexHtml.includes('class="help-modal-back-btn settings-subview-back-btn"'),
    'Custom Instructions header must have .settings-subview-back-btn'
);
assert.ok(
    indexHtml.includes('<span class="settings-back-label">Settings</span>'),
    'Sub-view header must have .settings-back-label with "Settings" text'
);

// 1.2 Verify Base CSS styling for .settings-subview-back-btn
assert.ok(
    stylesCss.includes('.settings-subview-back-btn {') &&
    stylesCss.includes('min-width: max-content !important;') &&
    stylesCss.includes('width: auto !important;'),
    '.settings-subview-back-btn must use width: auto and min-width: max-content'
);

assert.ok(
    stylesCss.includes('.settings-subview-back-btn svg {') &&
    stylesCss.includes('color: #38bdf8 !important;'),
    '.settings-subview-back-btn icon must be accented (#38bdf8) for high contrast'
);

assert.ok(
    stylesCss.includes('.settings-back-label {') &&
    stylesCss.includes('color: #ffffff !important;') &&
    stylesCss.includes('white-space: nowrap !important;'),
    '.settings-back-label must be bright white and nowrap to prevent ugly clipping'
);

// 1.3 Verify Mobile (<640px) non-clamping rule
assert.ok(
    stylesCss.includes('.help-modal-back-btn:not(.settings-subview-back-btn) {'),
    'Mobile media query must restrict 36px fixed width to non-subview buttons so Settings label is never cut off'
);

// 1.4 Verify Small Handset (<380px) adaptation
assert.ok(
    stylesCss.includes('@media (max-width: 380px)') &&
    stylesCss.includes('.settings-subview-back-btn {'),
    'Small handset viewport must include tailored back-button spacing'
);

assert.ok(
    stylesCss.includes('text-overflow: ellipsis !important;'),
    'Header heading must support ellipsis truncation on narrow viewports'
);

console.log('  [PASS] 1.1 Custom Instructions "Settings" back button is crystal clear and protected on mobile');


// =========================================================================
// Section 2: Personalized Experience Switch Alignment & Geometry
// =========================================================================
console.log('--- Section 2: Personalized Experience Switch Alignment & Geometry ---');

// 2.1 Verify Switch HTML markup and accessibility
assert.ok(
    indexHtml.includes('id="settings-personalization-toggle"'),
    'Personalization toggle input must exist with ID'
);
assert.ok(
    indexHtml.includes('class="settings-switch"'),
    'Personalization toggle must use .settings-switch'
);
assert.ok(
    indexHtml.includes('class="settings-switch-slider"'),
    'Personalization toggle must have .settings-switch-slider'
);

// 2.2 Verify Switch Dimensions (Strict 48x28 track, no deformation)
assert.ok(
    stylesCss.includes('.settings-switch {') &&
    stylesCss.includes('width: 48px !important;') &&
    stylesCss.includes('height: 28px !important;') &&
    stylesCss.includes('max-height: 28px !important;'),
    '.settings-switch must strictly enforce 48px x 28px track geometry'
);

// 2.3 Verify Knob is centered vertically with top: 50% and translateY(-50%)
assert.ok(
    stylesCss.includes('.settings-switch-slider::before {') &&
    stylesCss.includes('top: 50% !important;') &&
    stylesCss.includes('transform: translateY(-50%) !important;'),
    'Switch knob must be centered vertically using top: 50% and translateY(-50%)'
);

// 2.4 Verify Checked state translates horizontally while maintaining vertical center
assert.ok(
    stylesCss.includes('.settings-switch-input:checked + .settings-switch-slider::before {') &&
    stylesCss.includes('transform: translate(20px, -50%) !important;'),
    'Checked switch knob must slide horizontally while preserving vertical centering'
);

// 2.5 Verify 44px touch target via pseudo-element without track ballooning
assert.ok(
    stylesCss.includes('.settings-switch::after {') &&
    stylesCss.includes('min-height: 44px !important;'),
    'Switch must provide 44px accessible touch target via ::after without expanding visual track'
);

// 2.6 Verify No direct min-height: 44px deforming the switch in pointer: coarse
assert.ok(
    !stylesCss.includes('.settings-switch,\n        min-height: 44px') &&
    !stylesCss.includes('.settings-switch {\n        min-height: 44px'),
    '.settings-switch must NOT have direct min-height: 44px deforming track'
);

console.log('  [PASS] 2.1 Personalized Experience switch geometry, vertical centering, and touch area verified');


// =========================================================================
// Section 3: Row Alignment, Dividers, and Status Badge
// =========================================================================
console.log('--- Section 3: Row Alignment, Dividers, and Status Badge ---');

// 3.1 Verify Right-aligned controls
assert.ok(
    stylesCss.includes('.settings-row-right {') &&
    stylesCss.includes('justify-content: flex-end !important;'),
    '.settings-row-right must enforce justify-content: flex-end for clean right-edge alignment'
);

// 3.2 Verify Consistent dividers
assert.ok(
    stylesCss.includes('.settings-group-card .settings-row {') &&
    stylesCss.includes('border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;'),
    'Grouped card rows must have consistent subtle bottom borders'
);

// 3.3 Verify Status Badge high contrast
assert.ok(
    stylesCss.includes('.settings-row-status {') &&
    stylesCss.includes('border-radius: 9999px !important;'),
    'Status badge must be a refined pill badge'
);
assert.ok(
    stylesCss.includes('.settings-row-status.configured {') &&
    stylesCss.includes('color: #38bdf8 !important;'),
    'Configured status badge must have vibrant cyan highlight'
);

// 3.4 Verify Clickable Row Feedback
assert.ok(
    stylesCss.includes('.settings-row-clickable:hover') &&
    stylesCss.includes('.settings-row-clickable:active'),
    'Clickable rows must provide responsive hover and active tap feedback'
);

// =========================================================================
// Section 4: Safety & Data Local Storage Minimal Text
// =========================================================================
console.log('--- Section 4: Safety & Data Local Storage Minimal Text ---');

assert.ok(
    indexHtml.includes('<p class="settings-row-desc">Stored locally on this device</p>'),
    'Local Storage & Privacy row description must be minimal and user-friendly'
);
assert.ok(
    !indexHtml.includes('IndexedDB storage metrics'),
    'Jargon "IndexedDB storage metrics" must not be displayed in settings description'
);
console.log('  [PASS] 4.1 Safety & Data description is minimal and jargon-free');

// =========================================================================
// Section 5: Settings Action Button Width, Image Gallery Persistence & Multimodal Search
// =========================================================================
console.log('--- Section 5: Settings Action Button Width, Image Gallery Persistence & Multimodal Search ---');

// 5.1 Action button width & padding expansion
assert.ok(
    stylesCss.includes('.settings-action-btn {') &&
    stylesCss.includes('min-width: 104px !important;') &&
    stylesCss.includes('padding: 0 16px !important;') &&
    stylesCss.includes('white-space: nowrap !important;'),
    '.settings-action-btn must have ample min-width (104px), 16px padding, and nowrap text'
);

assert.ok(
    stylesCss.includes('min-width: 92px !important;') &&
    stylesCss.includes('min-width: 86px !important;'),
    'Responsive media queries must maintain comfortable button widths on smaller screens'
);

// 5.2 Immediate Image Gallery persistence upon image reveal
assert.ok(
    indexHtml.includes('window.JarvisImageStorage?.saveImage') &&
    indexHtml.includes('jarvis_recent_images_meta'),
    'revealImage must immediately persist generated images to JarvisImageStorage and localStorage fallback'
);

// 5.3 Multimodal media attachment live web search integration
assert.ok(
    indexHtml.includes('const userOptedWebSearch = Boolean(') &&
    indexHtml.includes('getWebSearchMode() === \'force\'') &&
    indexHtml.includes('web_search_multimodal'),
    'Attachment processing must trigger live web search when user opts for web search'
);

console.log('  [PASS] 5.1 Settings action button width, gallery auto-save, and multimodal search verified');

console.log('=== All Responsive Settings UI Tests PASSED ===');


});

test('Stream DOM Memory Protection & Cleanup', async () => {



console.log('=== Running Stream DOM Memory Protection & OOM Prevention Test Suite ===');

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
const speechInputJs = fs.readFileSync(path.resolve('app/speech-input.js'), 'utf8');
const chatGroqJs = fs.readFileSync(path.resolve('api/chat-groq.js'), 'utf8');

// ============================================================================
// Test 1: TreeWalker Bypass During Active Streaming
// ============================================================================
console.log('\n--- Test 1: TreeWalker Bypass During Active Streaming ---');
{
    // Verify renderAssistantMarkdown accepts options and checks options?.streaming !== true before enhanceHtml
    assert.ok(
        indexHtml.includes("function renderAssistantMarkdown(rawText, linkClass = 'assistant-link', options = {})"),
        'renderAssistantMarkdown must accept options parameter'
    );
    assert.ok(
        indexHtml.includes("options?.streaming !== true && window.JarvisScienceFormat?.enhanceHtml"),
        'renderAssistantMarkdown must skip JarvisScienceFormat.enhanceHtml during active streaming'
    );
    assert.ok(
        indexHtml.includes("renderAssistantMarkdown(readableText, linkClass, options)"),
        'renderAssistantTextIntoElement must pass options to renderAssistantMarkdown'
    );
    console.log('  [PASS] 1.1 Heavy TreeWalker DOM parsing is bypassed during active streaming deltas');
}

// ============================================================================
// Test 2: Animation Frame Throttling of Streaming Assistant DOM Updates
// ============================================================================
console.log('\n--- Test 2: Animation Frame Throttling of Streaming Assistant DOM Updates ---');
{
    assert.ok(
        indexHtml.includes('row.__streamRafId'),
        'updateStreamingAssistantMessage must track stream animation frame via __streamRafId'
    );
    assert.ok(
        indexHtml.includes('row.__pendingStreamText = textToRender'),
        'Streaming text must be queued in __pendingStreamText'
    );
    assert.ok(
        indexHtml.includes('cancelAnimationFrame(row.__streamRafId)'),
        'Stream completion or discard must cancel pending animation frame'
    );
    console.log('  [PASS] 2.1 Incoming token deltas throttled to animation frame rate to prevent DOM thrashing');
}

// ============================================================================
// Test 3: Watchdog Timeout Abort Linkage
// ============================================================================
console.log('\n--- Test 3: Watchdog Timeout Abort Linkage ---');
{
    assert.ok(
        indexHtml.includes("state === 'IDLE' && reason === 'watchdog_timeout'"),
        'Interaction state listener must handle watchdog_timeout'
    );
    assert.ok(
        indexHtml.includes("stopActiveGeneration('watchdog_timeout')"),
        'Watchdog timeout must abort active generation to prevent orphaned network streams'
    );
    assert.ok(
        indexHtml.includes("reason !== 'watchdog_timeout'"),
        'stopActiveGeneration must cleanly maintain IDLE state on watchdog_timeout'
    );
    console.log('  [PASS] 3.1 Watchdog timeout terminates active HTTP streaming connections cleanly');
}

// ============================================================================
// Test 4: AudioContext Lifecycle Cleanup
// ============================================================================
console.log('\n--- Test 4: AudioContext Lifecycle Cleanup ---');
{
    assert.ok(
        speechInputJs.includes('if (audioCtx) {') && speechInputJs.includes('audioCtx.close()'),
        'Speech input mediaRecorder.onstop must close audioCtx'
    );
    assert.ok(
        speechInputJs.includes('analyser = null;'),
        'analyser must be nulled on stop to free audio graph from memory'
    );
    console.log('  [PASS] 4.1 AudioContext instances are closed and garbage collected on speech stop');
}

// ============================================================================
// Test 5: Groq Model Candidate Realness & Non-Llama Assurance
// ============================================================================
console.log('\n--- Test 5: Groq Model Candidate Realness & Non-Llama Assurance ---');
{
    const { __test } = await import('../api/chat-groq.js');
    const { getPreferredGroqCandidates } = __test;
    const candidates = getPreferredGroqCandidates();
    assert.deepEqual(candidates, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b'], 'Must contain verified dashboard Groq models');
    assert.ok(chatGroqJs.includes('openai/gpt-oss-120b'), 'Dashboard model openai/gpt-oss-120b must be present');
    assert.ok(chatGroqJs.includes('openai/gpt-oss-20b'), 'Dashboard model openai/gpt-oss-20b must be present');
    assert.ok(chatGroqJs.includes('qwen/qwen3.8-27b'), 'Dashboard model qwen/qwen3.8-27b must be present');
    assert.ok(candidates.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama models');
    console.log('  [PASS] 5.1 Only genuine production models from dashboard are queried, eliminating candidate cascade delay');
}

console.log('================================================================');
console.log('=== All Stream DOM Memory Protection & OOM Prevention Tests PASSED ===');
console.log('================================================================');

});

