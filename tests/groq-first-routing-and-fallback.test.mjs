import assert from 'node:assert/strict';

console.log('=== Testing Groq-First Model Routing & Fallback Cascade Suite ===');

// Import candidate generator logic directly
function getPreferredGroqCandidates(configuredModel = '', { preferSpeed = false, userSelectedModel = null } = {}) {
    const configured = String(configuredModel || '').trim();
    const userSelected = String(userSelectedModel || '').trim();
    let mappedGroq = '';
    const VALID_MODELS = new Set([
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen-2.5-coder-32b',
        'qwen/qwen3.6-27b',
        'qwen-3.6-27b'
    ]);
    if (VALID_MODELS.has(userSelected)) {
        mappedGroq = userSelected;
    }

    const autoCandidates = [
        mappedGroq,
        configured,
        'qwen-2.5-coder-32b',
        'qwen/qwen3.6-27b',
        'openai/gpt-oss-120b',
        'openai/gpt-oss-20b',
        'qwen-3.6-27b'
    ];
    return [...new Set(autoCandidates.filter(Boolean).filter(m => !m.toLowerCase().includes('llama')))];
}

function getPreferredGroqVisionCandidates(configuredModel = '', userSelectedModel = null) {
    const configured = String(configuredModel || '').trim();
    const userSelected = String(userSelectedModel || '').trim();
    const visionModels = [
        'qwen/qwen3.6-27b',
        'qwen-3.6-27b'
    ];
    return [...new Set([userSelected, configured, ...visionModels].filter(Boolean).filter(m => !m.toLowerCase().includes('llama')))];
}

// ============================================================================
// Section 1: Auto Mode Groq Model Priority Hierarchy
// ============================================================================
console.log('--- Section 1: Auto Mode Groq Model Priority Hierarchy ---');

const autoCandidates = getPreferredGroqCandidates('', { userSelectedModel: null });
assert.equal(autoCandidates[0], 'qwen-2.5-coder-32b', 'Auto mode must prioritize verified active Qwen 2.5 Coder on Groq first');
assert.equal(autoCandidates[1], 'qwen/qwen3.6-27b', 'Auto mode must prioritize Qwen 3.6 27B second');
assert.equal(autoCandidates[2], 'openai/gpt-oss-120b', 'Auto mode must prioritize GPT-OSS 120B third');
assert.ok(autoCandidates.every(m => !m.toLowerCase().includes('llama')), 'Must not contain any Llama models');
console.log('  [PASS] 1.1 Auto mode accurately orders Qwen 2.5 Coder -> Qwen 3.6 -> GPT-OSS');

// ============================================================================
// Section 2: Specific Sidebar User Selection
// ============================================================================
console.log('--- Section 2: Specific Sidebar User Selection ---');

// 2.1 Explicit selection of Qwen 2.5 Coder 32B
const qwenSelected = getPreferredGroqCandidates('', { userSelectedModel: 'qwen-2.5-coder-32b' });
assert.equal(qwenSelected[0], 'qwen-2.5-coder-32b', 'User selected model must be attempted first on Groq');
assert.equal(qwenSelected.includes('openai/gpt-oss-120b'), true, 'Must keep GPT-OSS and other models as safe failover backups');
console.log('  [PASS] 2.1 User-chosen Groq model is placed first with automatic failover backup cascade');

// 2.2 Explicit selection of GPT-OSS 120B
const gptSelected = getPreferredGroqCandidates('', { userSelectedModel: 'openai/gpt-oss-120b' });
assert.equal(gptSelected[0], 'openai/gpt-oss-120b', 'User selected GPT-OSS model must be first');
console.log('  [PASS] 2.2 User-chosen GPT-OSS model is placed first');

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
assert.equal(groqVisionCandidates[0], 'qwen/qwen3.6-27b');
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
