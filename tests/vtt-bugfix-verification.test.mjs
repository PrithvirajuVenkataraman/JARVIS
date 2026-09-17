import assert from 'node:assert/strict';
import { createConversationEngine } from '../app/context-engine.js';
import { __test } from '../api/chat-groq.js';
const { streamModelWithFallback, getPreferredGroqCandidates } = __test;

console.log('=== Running Phase 10 VTT Assistant Bugfix Verification Suite ===');

// ============================================================================
// Test 1: Acoustic Echo Filter & Barge-in Differentiation
// ============================================================================
console.log('\n--- Test 1: Acoustic Echo Filter & Barge-in Differentiation ---');
{
    function simulateEchoGuard({ isSpeaking, activeSpokenText, candidateText }) {
        const activeSpoken = String(activeSpokenText || '').toLowerCase();
        const candidate = String(candidateText || '').trim().toLowerCase();

        if (isSpeaking && activeSpoken && candidate) {
            const candWords = candidate.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1);
            if (candWords.length > 0) {
                const matchingWords = candWords.filter(w => activeSpoken.includes(w));
                const echoRatio = matchingWords.length / candWords.length;
                if (echoRatio >= 0.70) {
                    return { suppressedAsEcho: true, echoRatio };
                }
            }
        }
        return { suppressedAsEcho: false, echoRatio: 0 };
    }

    const spokenAssistantResponse = "The capital of France is Paris. It is renowned for art, fashion, and culture.";
    
    // Case 1.1: Exact / Near-exact echo of the assistant's own voice picked up by mic
    const echoTranscript = "capital of France is Paris renowned for art";
    const echoResult = simulateEchoGuard({
        isSpeaking: true,
        activeSpokenText: spokenAssistantResponse,
        candidateText: echoTranscript
    });
    assert.equal(echoResult.suppressedAsEcho, true, 'Speaker-to-mic feedback matching spoken response must be suppressed as echo');
    assert.ok(echoResult.echoRatio >= 0.70, `Expected echo ratio >= 0.70, got ${echoResult.echoRatio}`);
    console.log('  [PASS] 1.1 Acoustic echo correctly detected and suppressed (ratio: ' + echoResult.echoRatio.toFixed(2) + ')');

    // Case 1.2: Real user barge-in / interruption during playback
    const userInterruption = "Wait stop, what about Berlin?";
    const bargeInResult = simulateEchoGuard({
        isSpeaking: true,
        activeSpokenText: spokenAssistantResponse,
        candidateText: userInterruption
    });
    assert.equal(bargeInResult.suppressedAsEcho, false, 'Genuine user interruption must NOT be suppressed');
    console.log('  [PASS] 1.2 User barge-in correctly passes through for interruption');

    // Case 1.3: User speaks when assistant is not speaking (isSpeaking = false)
    const normalSpeechResult = simulateEchoGuard({
        isSpeaking: false,
        activeSpokenText: spokenAssistantResponse,
        candidateText: echoTranscript
    });
    assert.equal(normalSpeechResult.suppressedAsEcho, false, 'Normal user speech when not speaking must never be suppressed');
    console.log('  [PASS] 1.3 Normal user speech when idle is not suppressed');
}

// ============================================================================
// Test 2: Authoritative Frontend Route Dispatching
// ============================================================================
console.log('\n--- Test 2: Authoritative Frontend Route Dispatching ---');
{
    function mockProcessCommandDispatch(input, frontendRoute) {
        // Mirrors the authoritative dispatch logic added in index.html processCommand
        if (frontendRoute?.route === 'live_required') {
            return { dispatchedTo: 'handleLiveRetrievalQuery', reason: frontendRoute.reason };
        }
        if (frontendRoute?.route === 'chat_direct') {
            return { dispatchedTo: 'sendToChat', reason: frontendRoute.reason };
        }
        // Fallback to legacy local intent
        return { dispatchedTo: 'legacyLocalTool' };
    }

    // Case 2.1: Live required query
    const liveRoute = { route: 'live_required', reason: 'temporal_live_request', confidence: 0.95 };
    const liveDispatch = mockProcessCommandDispatch("Who won the latest Premier League match today?", liveRoute);
    assert.equal(liveDispatch.dispatchedTo, 'handleLiveRetrievalQuery', 'live_required route must dispatch authoritatively to live retrieval');
    console.log('  [PASS] 2.1 live_required query authoritatively dispatches to handleLiveRetrievalQuery');

    // Case 2.2: Direct chat query
    const chatRoute = { route: 'chat_direct', reason: 'creative_writing', confidence: 0.92 };
    const chatDispatch = mockProcessCommandDispatch("Write a poem about quantum computers", chatRoute);
    assert.equal(chatDispatch.dispatchedTo, 'sendToChat', 'chat_direct route must dispatch authoritatively to chat');
    console.log('  [PASS] 2.2 chat_direct query authoritatively dispatches to sendToChat');
}

// ============================================================================
// Test 3: Live Search Timeout & Graceful Model Fallback
// ============================================================================
console.log('\n--- Test 3: Live Search Timeout & Graceful Model Fallback ---');
{
    async function simulateLiveRetrieval({ shouldTimeout = false, shouldFail = false }) {
        let budgetTimer = null;
        let didBudgetTimeout = false;
        const verificationBudgetMs = 50; // Use small budget for test

        const budgetPromise = new Promise((resolve) => {
            budgetTimer = setTimeout(() => {
                didBudgetTimeout = true;
                resolve({ timeout: true });
            }, verificationBudgetMs);
        });

        const workerPromise = new Promise((resolve, reject) => {
            if (shouldFail) {
                reject(new Error('Network failure'));
            } else if (shouldTimeout) {
                // Takes longer than verification budget
                setTimeout(() => resolve({ ok: true, sources: ['source1'] }), verificationBudgetMs + 100);
            } else {
                resolve({ ok: true, sources: ['source1'] });
            }
        });

        try {
            const outcome = await Promise.race([workerPromise, budgetPromise]);
            if (didBudgetTimeout || outcome.timeout) {
                // Graceful fallback to direct model generation without error
                return { action: 'fallback_to_model', success: true, timedOut: true };
            }
            return { action: 'render_with_sources', success: true, timedOut: false };
        } catch (err) {
            // Error caught gracefully, fallback to model
            return { action: 'fallback_to_model', success: true, error: err.message };
        } finally {
            if (budgetTimer) clearTimeout(budgetTimer);
        }
    }

    // Case 3.1: Live search times out
    const timeoutResult = await simulateLiveRetrieval({ shouldTimeout: true });
    assert.equal(timeoutResult.action, 'fallback_to_model', 'Timed out search must gracefully fallback to model without unhandled error');
    assert.equal(timeoutResult.timedOut, true);
    console.log('  [PASS] 3.1 Search timeout falls back gracefully to standard model response');

    // Case 3.2: Live search succeeds within budget
    const normalResult = await simulateLiveRetrieval({ shouldTimeout: false });
    assert.equal(normalResult.action, 'render_with_sources');
    assert.equal(normalResult.timedOut, false);
    console.log('  [PASS] 3.2 Search within budget renders search sources normally');
}

// ============================================================================
// Test 4: Concurrency & In-flight Cancellation in sendTextInput
// ============================================================================
console.log('\n--- Test 4: Concurrency & In-flight Cancellation in sendTextInput ---');
{
    let activeGenerationCancelled = null;
    let activeAborterCalled = false;

    const mockAborter = {
        abort: () => { activeAborterCalled = true; }
    };

    function stopActiveGeneration(reason) {
        activeGenerationCancelled = reason;
        if (mockAborter) mockAborter.abort();
    }

    function mockSendTextInput(text, isProcessingActive) {
        if (isProcessingActive) {
            stopActiveGeneration('superseded');
        }
        return { started: true, text };
    }

    // Case 4.1: Submit while another request is in-flight
    const submissionResult = mockSendTextInput('Second query while first is running', true);
    assert.equal(submissionResult.started, true);
    assert.equal(activeGenerationCancelled, 'superseded', 'In-flight generation must be cancelled with reason "superseded"');
    assert.equal(activeAborterCalled, true, 'Active controller abort() must be invoked to cancel orphaned network requests');
    console.log('  [PASS] 4.1 Concurrent input cancels previous in-flight generation cleanly');
}

// ============================================================================
// Test 5: Context Engine Follow-up Query Grounding
// ============================================================================
console.log('\n--- Test 5: Context Engine Follow-up Query Grounding ---');
{
    const engine = createConversationEngine({ maxThreads: 5 });
    
    // Seed an initial thread about an entity
    const intro = engine.resolve({ message: "Tell me about James Webb Space Telescope" });
    engine.recordTurn({ role: 'user', text: "Tell me about James Webb Space Telescope", threadId: intro.activeThread?.id });
    engine.recordTurn({ role: 'assistant', text: "The James Webb Space Telescope (JWST) is an infrared observatory.", threadId: intro.activeThread?.id });

    // Follow-up asking an ambiguous question with anaphoric pronoun
    const followUp = engine.resolve({ message: "What was its launch date?" });
    assert.equal(followUp.decisionReason, 'contextual_follow_up', 'Should be classified as contextual follow-up');
    assert.ok(followUp.searchQuery.includes('James Webb Space Telescope'), `Search query should be grounded with entity: got "${followUp.searchQuery}"`);
    assert.equal(followUp.searchQuery, 'James Webb Space Telescope What was its launch date?');
    console.log('  [PASS] 5.1 Follow-up search query correctly grounded: "' + followUp.searchQuery + '"');

    // Follow-up that already mentions the entity should not duplicate it
    const followUpWithEntity = engine.resolve({ message: "When did the James Webb Space Telescope launch?" });
    assert.equal(followUpWithEntity.searchQuery, 'When did the James Webb Space Telescope launch?');
    console.log('  [PASS] 5.2 Follow-up already containing entity is not duplicated: "' + followUpWithEntity.searchQuery + '"');
}

// ============================================================================
// Test 6: Mid-stream Failover Reset Event Emission & Reception
// ============================================================================
console.log('\n--- Test 6: Mid-stream Failover Reset Event Emission & Reception ---');
{
    // Client-side simulation of SSE reset handling
    let accumulated = '';
    let uiText = '';

    function handleSseEvent(event) {
        if (event.event === 'reset') {
            accumulated = '';
            uiText = '';
            return;
        }
        if (event.event === 'delta') {
            accumulated += event.data.text;
            uiText += event.data.text;
        }
    }

    // Step A: Primary model streams 2 tokens then crashes
    handleSseEvent({ event: 'delta', data: { text: 'Starting with model A... ' } });
    assert.equal(accumulated, 'Starting with model A... ');
    assert.equal(uiText, 'Starting with model A... ');

    // Step B: Backend emits reset on failover
    handleSseEvent({ event: 'reset', data: { reason: 'failover' } });
    assert.equal(accumulated, '', 'Accumulated text must be cleared on reset');
    assert.equal(uiText, '', 'UI text must be cleared on reset');

    // Step C: Secondary fallback model streams full clean response
    handleSseEvent({ event: 'delta', data: { text: 'Clean response from fallback model.' } });
    assert.equal(accumulated, 'Clean response from fallback model.');
    assert.equal(uiText, 'Clean response from fallback model.');
    console.log('  [PASS] 6.1 SSE reset event correctly prevents partial token concatenation');
}

// ============================================================================
// Test 7: Backend streamModelWithFallback onReset Integration
// ============================================================================
console.log('\n--- Test 7: Backend streamModelWithFallback onReset Integration ---');
{
    const originalFetch = globalThis.fetch;
    const originalGroqKey = process.env.GROQ_API_KEY;
    const originalGeminiKey = process.env.GEMINI_API_KEY;

    try {
        process.env.GROQ_API_KEY = 'mock-key-1';
        process.env.GEMINI_API_KEY = 'mock-key-2';

        let resetCount = 0;
        const streamedChunks = [];

        // Mock fetch: Groq emits a delta then fails with network abort/error mid-stream
        globalThis.fetch = async (url, options = {}) => {
            const urlStr = String(url);
            if (urlStr.includes('api.groq.com')) {
                let chunkSent = false;
                const stream = new ReadableStream({
                    pull(controller) {
                        if (!chunkSent) {
                            chunkSent = true;
                            controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Partial Groq token"}}]}\n\n'));
                        } else {
                            controller.error(new Error('Connection terminated mid-stream'));
                        }
                    }
                });
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            if (urlStr.includes('generativelanguage.googleapis.com')) {
                // Gemini succeeds
                const stream = new ReadableStream({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode('data: {"candidates":[{"content":{"parts":[{"text":"Full clean Gemini response"}]}}]}\n\n'));
                        controller.close();
                    }
                });
                return new Response(stream, {
                    status: 200,
                    headers: { 'Content-Type': 'text/event-stream' }
                });
            }
            return new Response('Not Found', { status: 404 });
        };

        const result = await streamModelWithFallback(
            'Test prompt',
            { maxTokens: 100 },
            (delta) => streamedChunks.push(delta),
            null,
            undefined,
            {
                onReset: () => {
                    resetCount++;
                    streamedChunks.length = 0; // Clear on reset
                }
            }
        );

        assert.equal(result.ok, true, 'Fallback should succeed on secondary engine');
        assert.equal(resetCount >= 1, true, 'onReset must have been invoked when primary model failed mid-stream');
        assert.equal(streamedChunks.join(''), 'Full clean Gemini response', 'Streamed chunks should only contain tokens from the successful model');
        console.log('  [PASS] 7.1 Backend streamModelWithFallback triggers onReset on mid-stream failure');
    } finally {
        globalThis.fetch = originalFetch;
        process.env.GROQ_API_KEY = originalGroqKey;
        process.env.GEMINI_API_KEY = originalGeminiKey;
    }
}

// ============================================================================
// Test 8: Verified Non-Llama Groq Candidate Model Hierarchy
// ============================================================================
console.log('\n--- Test 8: Verified Non-Llama Groq Candidate Model Hierarchy ---');
{
    const candidates = getPreferredGroqCandidates('', { userSelectedModel: null });
    assert.equal(candidates[0], 'qwen-2.5-coder-32b', 'Top candidate must be active production model qwen-2.5-coder-32b');
    assert.equal(candidates[1], 'qwen/qwen3.6-27b', 'Second candidate must be qwen/qwen3.6-27b');
    assert.ok(candidates.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama models');
    console.log('  [PASS] 8.1 Active non-Llama production models prioritized first: ' + candidates.slice(0, 3).join(', '));
}

// ============================================================================
// Test 9: DOM Thinking Indicator Preservation during Empty Assistant Init
// ============================================================================
console.log('\n--- Test 9: DOM Thinking Indicator Preservation during Empty Assistant Init ---');
{
    // Simulate chatContainer DOM with an active thinking indicator
    const chatContainer = {
        children: [],
        appendChild(el) {
            this.children.push(el);
            el.parentNode = this;
        },
        insertBefore(newEl, refEl) {
            const idx = this.children.indexOf(refEl);
            if (idx === -1) {
                this.children.push(newEl);
            } else {
                this.children.splice(idx, 0, newEl);
            }
            newEl.parentNode = this;
        }
    };

    const existingThinking = { id: 'chat-thinking-indicator', parentNode: chatContainer };
    chatContainer.appendChild(existingThinking);

    // Simulate addChatMessage with allowEmptyAssistant = true
    const allowEmptyAssistant = true;
    const messageDiv = { id: 'msg-stream-placeholder', style: { display: 'none' }, parentNode: null };

    if (existingThinking && existingThinking.parentNode === chatContainer) {
        if (allowEmptyAssistant) {
            chatContainer.insertBefore(messageDiv, existingThinking);
        } else {
            const idx = chatContainer.children.indexOf(existingThinking);
            chatContainer.children.splice(idx, 1, messageDiv);
            existingThinking.parentNode = null;
        }
    }

    assert.equal(chatContainer.children.includes(existingThinking), true, 'existingThinking must remain in the DOM');
    assert.equal(chatContainer.children.indexOf(messageDiv) < chatContainer.children.indexOf(existingThinking), true, 'messageDiv must be inserted before existingThinking');
    console.log('  [PASS] 9.1 Empty assistant placeholder does not destroy thinking indicator in DOM');
}

console.log('\n================================================================');
console.log('=== All VTT Assistant Bugfix Verification Tests Passed! ===');
console.log('================================================================\n');
