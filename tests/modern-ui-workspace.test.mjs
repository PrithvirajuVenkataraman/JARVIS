import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { __test as chatTest } from '../api/chat-groq.js';
import { __test as searchTest } from '../api/search.js';
import { __test as freeLiveTest } from '../api/_lib/free-live/providers.js';
import { verifyAndRepairMathClaims } from '../api/_lib/code-math-validator.js';

console.log('--- Testing Modern AI Workspace UI Architecture ---');

// 1. Verify index.html Layout & Elements
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');

// Header elements: streamlined without model dropdown, theme toggle, or sandbox buttons
assert.ok(indexHtml.includes('id="app-header"'), 'App header element must exist');
assert.ok(indexHtml.includes('id="chat-sidebar-toggle"'), 'Sidebar toggle button must exist');
assert.ok(indexHtml.includes('id="header-new-chat-btn"'), 'New chat header button must exist');
assert.ok(indexHtml.includes('id="header-command-palette-btn"'), 'Command palette search trigger must exist');

// Verified removed from header completely per user directives
assert.ok(!indexHtml.includes('id="header-canvas-btn"'), 'Artifact Canvas button must be removed');
assert.ok(!indexHtml.includes('id="header-model-pill"'), 'Header model selector pill must be removed');
assert.ok(!indexHtml.includes('id="header-model-dropdown"'), 'Header model dropdown list must be removed');
assert.ok(!indexHtml.includes('id="theme-toggle-btn"'), 'Theme toggle button must be removed (dark mode is exclusive)');
console.log('  [PASS] 1. Streamlined top navigation bar verified (header model pill, theme toggle, and canvas trigger removed)');

// Sidebar model selector preserved
assert.ok(indexHtml.includes('id="model-selector"'), 'Sidebar model selector must exist');
assert.ok(indexHtml.includes('class="chat-sidebar-model-block"'), 'Sidebar model block must exist');
console.log('  [PASS] 2. Native sidebar model selector preserved cleanly');

// Main chat container and empty state hero
assert.ok(indexHtml.includes('id="chat-main"'), 'Main chat viewport must exist');
assert.ok(indexHtml.includes('id="chat-center-column"'), 'Centered reading column must exist');
assert.ok(indexHtml.includes('id="chat-empty-state"'), 'Empty state hero must exist');
assert.ok(!indexHtml.includes('class="starter-cards-grid"'), 'Starter prompt cards grid must be removed to prevent hallucinations');
assert.ok(!indexHtml.includes('class="starter-prompt-card"'), 'Starter prompt card buttons must be removed');
assert.ok(indexHtml.includes('id="chat-container"'), 'Chat container element must exist');
assert.ok(indexHtml.includes('id="drag-drop-overlay"'), 'Drag and drop overlay must exist');
console.log('  [PASS] 3. Full-height workspace layout, empty state hero, and drag-drop overlay verified');

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
assert.ok(indexHtml.includes('pure_coding_fast_path'), 'processCommand fast-paths coding prompts directly to streaming model');
assert.ok(indexHtml.includes('verificationBudgetMs = 3500'), 'handleLiveRetrievalQuery caps search timeout at 3500ms for low latency');
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

// 10.2 Adaptive Model Routing: Instant Tier routes to llama-3.1-8b-instant first for <200ms TTFT
const instantComplexity = chatTest.classifyQueryComplexity('What is the capital of Australia?');
assert.equal(instantComplexity.tier, 'instant', 'Simple factual query must classify as instant tier');
const instantCandidates = chatTest.getPreferredGroqCandidates('', { tier: 'instant', preferSpeed: true });
assert.equal(instantCandidates[0], 'llama-3.1-8b-instant', 'Instant queries must prioritize llama-3.1-8b-instant first for speed');

// 10.3 System prompt compaction & high-density epistemic directives
const compactedPrompt = chatTest.buildServerSystemPrompt();
assert.ok(compactedPrompt.length < 3800, `Compacted prompt should be under 3800 chars, got ${compactedPrompt.length}`);
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

console.log('  [PASS] 10. Anti-hallucination & speed optimization invariants verified (GPT-OSS-120B priority, instant 8B tier, compacted prompt, streaming attachments, percentage auto-repair)');

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

// 12. Verify Command Palette (Ctrl+K / ⌘K) Full Functionality & Action Verification
assert.ok(indexHtml.includes('id="command-palette-modal"'), 'Command palette modal markup must exist');
assert.ok(indexHtml.includes('id="command-palette-input"'), 'Command palette input must exist');
assert.ok(indexHtml.includes('id="command-palette-list"'), 'Command palette listbox must exist');
assert.ok(indexHtml.includes('function openCommandPalette()'), 'openCommandPalette must be defined');
assert.ok(indexHtml.includes('function closeCommandPalette()'), 'closeCommandPalette must be defined');
assert.ok(indexHtml.includes('function getCommandPaletteActions()'), 'getCommandPaletteActions must be defined');
assert.ok(indexHtml.includes('function renderCommandPaletteList()'), 'renderCommandPaletteList must be defined');
assert.ok(indexHtml.includes('function handleCommandPaletteKeydown('), 'handleCommandPaletteKeydown must be defined');
assert.ok(indexHtml.includes('function getAllChatSessions()'), 'getAllChatSessions must be defined');

// 12.1 Verify Action 1: New Chat Session
assert.ok(indexHtml.includes("id: 'new-chat'"), 'New chat session action must exist');
assert.ok(indexHtml.includes('startNewChatSession'), 'New chat session must route to startNewChatSession');

// 12.2 Verify Action 2: Toggle Voice Dictation (VTT)
assert.ok(indexHtml.includes("id: 'toggle-speech'"), 'Toggle voice dictation action must exist');
assert.ok(indexHtml.includes('toggleVoiceToText'), 'Voice dictation must route to toggleVoiceToText');
assert.ok(indexHtml.includes('id="voice-to-text-btn"'), 'voice-to-text-btn element must exist in DOM');

// 12.3 Verify Action 3: Export Chat as Markdown (.md)
assert.ok(indexHtml.includes("id: 'export-markdown'"), 'Export markdown action must exist');
assert.ok(indexHtml.includes("exportCurrentChat('markdown')"), 'Markdown export must route to exportCurrentChat');

// 12.4 Verify Action 4: Export Chat as JSON (.json)
assert.ok(indexHtml.includes("id: 'export-json'"), 'Export JSON action must exist');
assert.ok(indexHtml.includes("exportCurrentChat('json')"), 'JSON export must route to exportCurrentChat');
assert.ok(indexHtml.includes('exportChatHistoryJson'), 'JSON export fallback must route to exportChatHistoryJson');

// 12.5 Verify Action 5: Open Settings & Privacy
assert.ok(indexHtml.includes("id: 'open-settings'"), 'Open settings action must exist');
assert.ok(indexHtml.includes('showHelpModal()'), 'Settings must route to showHelpModal');
assert.ok(indexHtml.includes('Data & Privacy'), 'Settings modal must contain Data & Privacy section');
assert.ok(indexHtml.includes('deleteAllLocalDataNow()'), 'Privacy section must support deleteAllLocalDataNow');

// 12.6 Verify Platform-adaptive shortcuts & keyboard handlers
assert.ok(indexHtml.includes('getPlatformModifierKey'), 'Modifier key must adapt to platform');
assert.ok(indexHtml.includes("e.key.toLowerCase() === 'k'"), 'Ctrl+K / Cmd+K listener must be registered');
assert.ok(indexHtml.includes("e.key === 'Escape'"), 'Escape key handler must close palette');

console.log('  [PASS] 12. Command Palette full functionality verified (all 5 actions, search, shortcuts, and privacy wired)');

console.log('=== All Modern AI Workspace UI Architecture Tests PASSED ===');
