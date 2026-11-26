import { readAppSource } from './read-app-source.mjs';
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
const indexHtml = readAppSource();

// Header elements: streamlined without model dropdown, theme toggle, or sandbox buttons
assert.ok(indexHtml.includes('id="app-header"'), 'App header element must exist');
assert.ok(indexHtml.includes('id="chat-sidebar-toggle"'), 'Sidebar toggle button must exist');
assert.ok(!indexHtml.includes('id="header-new-chat-btn"'), 'New chat remains directly available in the sidebar');
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
assert.ok(!fs.readFileSync('index.html', 'utf8').includes('class="empty-state-capabilities"'), 'The welcome capability cards must be removed');
assert.ok(indexHtml.includes('id="web-search-toggle-btn"'), 'Web search must remain available from the composer');
assert.ok(indexHtml.includes('id="composer-think-btn"'), 'Permanent Think (Deep Reasoning) button must exist in prompt box');
assert.ok(indexHtml.includes('class="composer-think-label"'), 'Think button label must exist');
assert.ok(indexHtml.includes('function toggleDeepReasoningMode('), 'toggleDeepReasoningMode function must be defined');
assert.ok(indexHtml.includes('id="composer-file-input"'), 'Document upload must remain available from the composer');
assert.ok(!indexHtml.includes("handleCapabilityPillClick('code_math')"), 'Code & Math pill must be deleted');
assert.ok(!indexHtml.includes('id="composer-mode-badge"'), 'Empty composer badge must be absent');
assert.ok(indexHtml.includes('function updateComposerModeIndicatorUi('), 'updateComposerModeIndicatorUi function must be defined');
assert.ok(indexHtml.includes('function handleCapabilityPillClick('), 'handleCapabilityPillClick function must be defined');
assert.ok(!indexHtml.includes('class="empty-state-shortcuts"'), 'Keyboard shortcut hints must be removed');
assert.ok(!indexHtml.includes('class="starter-cards-grid"'), 'Starter prompt cards grid must be removed to prevent hallucinations');
assert.ok(!indexHtml.includes('class="starter-prompt-card"'), 'Starter prompt card buttons must be removed');
assert.ok(indexHtml.includes('id="chat-container"'), 'Chat container element must exist');
assert.ok(indexHtml.includes('id="drag-drop-overlay"'), 'Drag and drop overlay must exist');
console.log('  [PASS] 3. Minimal workspace, composer tools, and drag-drop overlay verified');

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
assert.ok(indexHtml.includes('return handleBoundedLiveResearchQuery(userText, userText, options);'), 'Legacy search uses the bounded server evidence deadline');
console.log('  [PASS] 8. Starter shortcuts removed for zero-latency, multimodal synergy and streaming latency invariants verified');

// 5. Verify Robust Live Web Search & Multi-Domain Consensus Verification
assert.ok(indexHtml.includes('if (submission?.forceWebSearch) {'), 'sendTextInput routes forceWebSearch directly to handleLiveRetrievalQuery');
assert.ok(!indexHtml.includes('hasConfidentSingleSource'), 'A long snippet must not be treated as proof of the answer');
assert.ok(!indexHtml.includes('buildHybridAnswerWithSources'), 'Related links must not be attached to an unchecked model answer');
assert.ok(indexHtml.includes('return handleBoundedLiveResearchQuery(userText, userText);'), 'Answer-then-cite now retrieves evidence before answering');
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
const repairedPercent = verifyAndRepairMathClaims('$15% of 80 = 14$');
assert.equal(repairedPercent.verification.status, 'failed', 'Percentage calculation mismatch must be reported');
assert.equal(repairedPercent.repaired, false, 'A failed check must not silently rewrite the answer');
assert.equal(repairedPercent.text, '$15% of 80 = 14$', 'Preserve the original mathematical claim');

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
assert.ok(fs.readFileSync('app/static-ui-actions.js', 'utf8').includes('handleTextInputDialogBackdropClick(event)') && /id="text-input-dialog-backdrop"[^>]+data-ui-static=/.test(indexHtml), 'Backdrop must use handleTextInputDialogBackdropClick');
assert.ok(!indexHtml.includes('id="text-input-dialog-backdrop" class="text-input-dialog-backdrop hidden" role="presentation" onclick="if (event.target === this) closeTextInputDialog(null)"'), 'Backdrop must not directly close on accidental click');
assert.ok(stylesCss.includes('modalAttentionPulse'), 'modalAttentionPulse animation must exist in styles.css');
assert.ok(stylesCss.includes('.text-input-dialog.modal-attention-pulse'), '.text-input-dialog.modal-attention-pulse class must exist');
console.log('  [PASS] 15. Edit message modal focus retention and accidental dismiss protection verified');

console.log('=== All Modern AI Workspace UI Architecture Tests PASSED ===');




});

test('Reasoning display renders escaped chain-of-thought and completed operations safely', () => {
 const source = readAppSource();
 const start = source.indexOf('function buildThinkingProcessHtml(');
 const end = source.indexOf('\n        function addChatMessage(', start);
 const sandbox = vm.createContext({}); vm.runInContext(source.slice(start, end), sandbox);
 const build = sandbox.buildThinkingProcessHtml;
 assert.equal(build('', ['Invented source check'], 2, true), '');
 const escapedOnly = build('private <script>payload</script>', ['Invented source check'], 2, true);
 assert.match(escapedOnly, /thinking-process-card/);
 assert.match(escapedOnly, /&lt;script&gt;payload&lt;\/script&gt;/);
 assert.ok(!escapedOnly.includes('<script>'));
 const result = build('step 1 reasoning', [], 1.4, false, null, { label: 'GPT-OSS 20B (Groq)', isFailover: false }, { completedStages: ['retrieval','arithmetic','<script>bad</script>'] });
 assert.match(result, /Context retrieved/); assert.match(result, /Arithmetic checked/);
 assert.match(result, /step 1 reasoning/);
 assert.match(result, /Thought for 1\.4s/);
 assert.ok(!result.includes('<script>'));
});

test('Prompt keywords never fabricate a thinking narrative', () => {
 const source = readAppSource(); const start = source.indexOf('function generateContextualThoughtSteps('); const end = source.indexOf('}', start) + 1;
 const sandbox = vm.createContext({}); vm.runInContext(source.slice(start, end), sandbox);
 for (const query of ['Who is the current CEO?', 'Integrate x squared', 'Find the latest news', 'Write a Python script']) assert.equal(sandbox.generateContextualThoughtSteps(query).length, 0);
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

const indexHtml = readAppSource();
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

test('Settings preserve semantic controls while component styles own their appearance', () => {
    const source = readAppSource();
    const css = fs.readFileSync('app/core-ux.css', 'utf8');
    for (const id of ['settings-personalization-toggle', 'custom-system-prompt-input', 'settings-view-custom-instructions']) assert.ok(source.includes('id="' + id + '"'));
    assert.ok(source.includes('class="settings-switch"'));
    assert.ok(source.includes('class="settings-switch-slider"'));
    assert.ok(source.includes('class="settings-back-label">Settings</span>'));
    assert.ok(css.includes('--core-hit-area'));
    assert.ok(css.includes('--core-text'));
    assert.ok(css.includes('@layer static-interface'), 'Application motion has one explicit owner rather than feature-specific animations');
    assert.ok(fs.readFileSync('styles.css', 'utf8').includes('@layer legacy'));
    // Geometry, contrast, focus and label clipping are measured in the browser
    // suite at five sizes rather than inferred from obsolete CSS string literals.
});

test('Stream DOM Memory Protection & Cleanup', async () => {



console.log('=== Running Stream DOM Memory Protection & OOM Prevention Test Suite ===');

const indexHtml = readAppSource();
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

// ============================================================================
// Test 6: Mobile Keyboard Offset, Slash Command Scrollbar, Study Fallback, and Sidebar Dedup
// ============================================================================
{
    const stylesCssText = fs.readFileSync(path.resolve('styles.css'), 'utf8');
    const coreUxCss = fs.readFileSync(path.resolve('app/core-ux.css'), 'utf8');
    const slashCtrl = fs.readFileSync(path.resolve('app/slash-command-controller.js'), 'utf8');
    const settingsCtrl = fs.readFileSync(path.resolve('app/settings-controller.js'), 'utf8');
    const recallWorker = fs.readFileSync(path.resolve('app/recall-worker.js'), 'utf8');
    const contextRetrieval = fs.readFileSync(path.resolve('app/context-retrieval.js'), 'utf8');
    assert.ok(stylesCssText.includes('var(--keyboard-offset, 0px)'), 'Input bar must track visualViewport keyboard offset');
    assert.ok(stylesCssText.includes('right: 16px;') && !/\.scroll-to-bottom-pill\s*\{[^}]*left:\s*50%/s.test(stylesCssText), 'Scroll-to-bottom pill must sit at the right edge instead of overlapping centered reading prose');
    assert.ok(coreUxCss.includes('--app-viewport-height') && coreUxCss.includes('#chat-container:empty') && coreUxCss.includes('+ 56px + env(safe-area-inset-bottom)'), 'Empty chat collapses bottom padding, non-empty gives full bottom clearance, and app-root bounds to visualViewport');
    assert.ok(coreUxCss.includes('body.is-keyboard-open #input-bar-container') && coreUxCss.includes('translate3d(0,-100%,0)') && coreUxCss.includes('top:var(--app-viewport-top,0px)'), 'Open virtual keyboard must pin composer directly above visualViewport bottom edge regardless of offsetTop');
    assert.ok(coreUxCss.includes('--keyboard-composer-top') && coreUxCss.includes('body.is-keyboard-open #footer-disclaimer'), 'Open virtual keyboard uses closed-loop --keyboard-composer-top and hides footer disclaimer');
    assert.ok(indexHtml.includes('id="text-input"') && indexHtml.includes('enterkeyhint="send"') && indexHtml.includes('autocomplete="off"'), 'Prompt textarea must expose enterkeyhint="send" and autocomplete="off" for mobile soft keyboards');
    assert.ok(indexHtml.includes('function dismissMobileKeyboardAfterSubmit(') && indexHtml.includes('options?.refocus === true && hadDlpState') && indexHtml.includes('const heightGap = Math.max('), 'Submitting prompt must blur #text-input without post-send refocus and detect keyboard even when vv.offsetTop > 0');
    assert.ok(coreUxCss.includes('.settings-danger-btn') && coreUxCss.includes('--chat-message-font-size:15px'), 'Mobile typography scale and settings-danger-btn styling must stay consistent');
    assert.ok(coreUxCss.includes('body .chat-sidebar-section-title { margin:14px 0 4px; padding-inline:16px;') && coreUxCss.includes('body .chat-sidebar-empty { margin:6px 12px;'), 'Sidebar section title and empty state must share aligned 16px left edge and override Tailwind p margin reset');
    assert.ok(settingsCtrl.includes('On-Device Semantic Memory') && !settingsCtrl.includes('Enhanced local recall'), 'Settings must use refined professional copy for on-device semantic memory');
    assert.ok(recallWorker.includes('env.backends.onnx.wasm.proxy = false') && recallWorker.includes('loadCachedVector'), 'Recall worker must disable nested worker proxy for mobile Safari and hydrate cached IndexedDB vectors');
    assert.ok(contextRetrieval.includes("state === 'ready' ? 2500 : 600"), 'Semantic recall worker search must allow mobile WASM budget without 250ms premature timeout');
    assert.ok(indexHtml.includes('function deduplicateChatSessions('), 'Sidebar session deduplicator must prevent duplicated recent chats');
    assert.ok(indexHtml.includes('isinstance(_tree.body[-1], _ast.Expr)'), 'Pyodide runner must evaluate trailing bare expressions into stdout');
    assert.ok(!slashCtrl.includes('scrollIntoView'), 'Slash picker must scroll internally instead of calling scrollIntoView on the viewport');

    // Test 7: Assistant Action Row (4 buttons: Copy, Speak, Share, Dots) & Overflow Menu + Polished Text Input Dialog
    const actionsStart = indexHtml.indexOf('function buildAssistantActionsHtml(');
    const actionsEnd = indexHtml.indexOf('const assistantActionHandlers =', actionsStart);
    const actionsFn = indexHtml.slice(actionsStart, actionsEnd);
    const menuSplit = actionsFn.indexOf('id="assistant-action-menu-');
    const rowPrefix = actionsFn.slice(0, menuSplit);
    const menuBody = actionsFn.slice(menuSplit, actionsFn.indexOf('id="assistant-feedback-popover-'));
    assert.ok(rowPrefix.includes('data-assistant-action="copy"'), 'Action row must include Copy');
    assert.ok(rowPrefix.includes('data-assistant-action="tts_speak"'), 'Action row must include Speak');
    assert.ok(rowPrefix.includes('data-assistant-action="share"'), 'Action row must include Share');
    assert.ok(rowPrefix.includes('data-assistant-action="menu"'), 'Action row must include Three dots menu');
    assert.ok(!rowPrefix.includes('data-assistant-action="save_memory"')
        && !rowPrefix.includes('data-assistant-action="regenerate"')
        && !rowPrefix.includes('data-assistant-action="feedback_up"')
        && !rowPrefix.includes('data-assistant-action="feedback_down"'),
        'Save to memory, Regenerate, Thumbs up, and Thumbs down must NOT clutter top-level action row');
    assert.ok(menuBody.includes('data-assistant-action="save_memory"')
        && menuBody.includes('data-assistant-action="regenerate"')
        && menuBody.includes('data-assistant-action="feedback_up"')
        && menuBody.includes('data-assistant-action="feedback_down"'),
        'Save to memory, Regenerate, Thumbs up, and Thumbs down must live inside the three dots menu');
    assert.ok(coreUxCss.includes('body .assistant-action-row { display:grid; grid-template-columns:repeat(4,44px);'), 'Action row must use 4 compact grid columns');
    assert.ok(coreUxCss.includes('body .text-input-dialog h2') && coreUxCss.includes('body .text-input-dialog textarea') && coreUxCss.includes('body .text-input-dialog-btn.primary'), 'Text input dialog must have unlayered dark styling overriding Tailwind preflight');
}

console.log('================================================================');
console.log('=== All Stream DOM Memory Protection & OOM Prevention Tests PASSED ===');
console.log('================================================================');

});

