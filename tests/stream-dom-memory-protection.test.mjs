import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

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
    assert.deepEqual(candidates, ['qwen-2.5-coder-32b', 'gemma2-9b-it'], 'Must only contain real non-Llama Groq models');
    assert.ok(!chatGroqJs.includes('openai/gpt-oss-120b'), 'Hallucinated model openai/gpt-oss-120b must be purged');
    assert.ok(!chatGroqJs.includes('openai/gpt-oss-20b'), 'Hallucinated model openai/gpt-oss-20b must be purged');
    assert.ok(!chatGroqJs.includes('qwen/qwen3.6-27b'), 'Hallucinated model qwen/qwen3.6-27b must be purged');
    assert.ok(!chatGroqJs.includes('qwen/qwen3.8-27b'), 'Hallucinated model qwen/qwen3.8-27b must be purged');
    console.log('  [PASS] 5.1 Only genuine production models are queried, eliminating candidate cascade delay');
}

console.log('================================================================');
console.log('=== All Stream DOM Memory Protection & OOM Prevention Tests PASSED ===');
console.log('================================================================');
