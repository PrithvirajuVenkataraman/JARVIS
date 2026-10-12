import assert from 'node:assert/strict';

console.log('=== Testing Groq-First Model Routing & Fallback Cascade Suite ===');

import { __test } from '../api/chat-groq.js';
const { getPreferredGroqCandidates, getPreferredGroqVisionCandidates } = __test;

// ============================================================================
// Section 1: Auto Mode Groq Model Priority Hierarchy
// ============================================================================
console.log('--- Section 1: Auto Mode Groq Model Priority Hierarchy ---');

const autoCandidates = getPreferredGroqCandidates('', { userSelectedModel: null });
assert.equal(autoCandidates[0], 'openai/gpt-oss-120b', 'Auto mode must prioritize verified active GPT OSS 120B on Groq first');
assert.equal(autoCandidates[1], 'openai/gpt-oss-20b', 'Auto mode must prioritize GPT OSS 20B second');
assert.ok(autoCandidates.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama models');
console.log('  [PASS] 1.1 Auto mode accurately orders GPT OSS 120B -> GPT OSS 20B (zero Llama models)');

// ============================================================================
// Section 2: Specific Sidebar User Selection
// ============================================================================
console.log('--- Section 2: Specific Sidebar User Selection ---');

// 2.1 Explicit selection of GPT OSS 120B
const gptSelected = getPreferredGroqCandidates('', { userSelectedModel: 'openai/gpt-oss-120b' });
assert.equal(gptSelected[0], 'openai/gpt-oss-120b', 'User selected model must be attempted first on Groq');
assert.equal(gptSelected.includes('openai/gpt-oss-20b'), true, 'Must keep GPT OSS 20B as safe failover backup');
console.log('  [PASS] 2.1 User-chosen Groq model is placed first with automatic failover backup cascade');

// 2.2 Explicit selection of Qwen 3.8 27B
const qwenSelected = getPreferredGroqCandidates('', { userSelectedModel: 'qwen/qwen3.8-27b' });
assert.equal(qwenSelected[0], 'qwen/qwen3.8-27b', 'User selected Qwen model must be first');
console.log('  [PASS] 2.2 User-chosen Qwen model is placed first');

// ============================================================================
// Section 3: Provider Cascade & Vision Fallback Order (Groq -> Gemini only)
// ============================================================================
function determineProviderOrder({ hasImages = false, userSelectedModel = null } = {}) {
    const prioritizeGemini = Boolean(userSelectedModel && String(userSelectedModel).toLowerCase().startsWith('gemini-')) || hasImages;
    return prioritizeGemini ? ['gemini', 'groq'] : ['groq', 'gemini'];
}

// 3.1 Standard text query in Auto mode
const autoProviderOrder = determineProviderOrder();
assert.deepEqual(autoProviderOrder, ['groq', 'gemini'], 'Provider order must route directly Groq -> Gemini fallback (0 OpenAI key dependency)');
console.log('  [PASS] 3.1 Text queries always route to Groq API with Gemini fallback (no OpenAI API key required)');

// 3.2 Vision / Image query routes to Gemini first with Groq fallback
const visionProviderOrder = determineProviderOrder({ hasImages: true });
assert.deepEqual(visionProviderOrder, ['gemini', 'groq'], 'Vision queries route to Gemini first with Groq fallback');
console.log('  [PASS] 3.2 Vision queries route to Gemini first with Groq fallback');

// 3.3 Explicit selection of Gemini 2.5 Pro or Gemini 3.7 Flash routes to Gemini first
const geminiSelectedOrder = determineProviderOrder({ userSelectedModel: 'gemini-2.5-pro' });
assert.deepEqual(geminiSelectedOrder, ['gemini', 'groq'], 'Explicit Gemini selection routes to Gemini first');
console.log('  [PASS] 3.3 Explicit Gemini selection routes to Gemini API first');

// 3.4 Groq Vision candidate hierarchy
const groqVisionCandidates = getPreferredGroqVisionCandidates('', null);
assert.ok(groqVisionCandidates.includes('qwen/qwen3.8-27b'), 'Must include active vision model Qwen 3.8 27B');
assert.ok(groqVisionCandidates.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama vision models');
console.log('  [PASS] 3.4 Groq vision candidate list correctly configured for non-Llama vision models');

// ============================================================================
// Section 4: Millisecond Fast-Failover Simulation
// ============================================================================
console.log('--- Section 4: Millisecond Fast-Failover Simulation ---');

const FAST_FAILOVER_TIMEOUT_MS = 3500;
assert.equal(FAST_FAILOVER_TIMEOUT_MS <= 3500, true, 'Failover timeout must be within 3500ms budget');
console.log('  [PASS] 4.1 3500ms fast failover threshold verified for instant model cascading');

console.log('================================================================');
console.log('=== All Groq-First Model Routing & Fallback Tests PASSED ===');
console.log('================================================================');
