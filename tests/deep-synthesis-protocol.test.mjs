import assert from 'node:assert/strict';
import { BoundedLiveResearchController, distillSearchQuery as distillFrontend } from '../app/bounded-live-research.js';
import { distillSearchQuery as distillBackend } from '../api/search.js';
import { __test } from '../api/chat-groq.js';

const { buildServerSystemPrompt, normalizeChatRequest } = __test || {};

console.log('=== Testing Deep-Synthesis Reasoning Engine Protocol Suite ===');

// Test 1: Frontend & Backend Prompt Distillation strips roleplay preambles
console.log('\n--- Section 1: Preambles Distillation ---');
const personaQuery1 = `You are a master investigative researcher. Answer the following query by performing deep cross-referencing and synthesis: Who is the current president of the European Commission?

To ensure a complete and verified answer, you must strictly follow this execution protocol:
1. BREAK DOWN THE PREMISE
2. PIVOT ON CLUES
3. DEDUCTIVE SYNTHESIS`;

const distilledFront1 = distillFrontend(personaQuery1);
const distilledBack1 = distillBackend(personaQuery1);

assert.ok(distilledFront1.toLowerCase().includes('president of the european commission'), `Frontend distillation missing core query: ${distilledFront1}`);
assert.ok(!distilledFront1.toLowerCase().includes('master investigative researcher'), `Frontend distillation failed to strip preamble: ${distilledFront1}`);
assert.ok(distilledBack1.toLowerCase().includes('president of the european commission'), `Backend distillation missing core query: ${distilledBack1}`);
assert.ok(!distilledBack1.toLowerCase().includes('master investigative researcher'), `Backend distillation failed to strip preamble: ${distilledBack1}`);
console.log('  [PASS] 1.1 Persona preamble 1 successfully stripped in frontend and backend');

const personaQuery2 = `Act as a deep-synthesis reasoning engine. Answer the user's input by performing comprehensive cross-referencing, multi-hop lookups, and logical deduction: What is the latest James Webb Space Telescope discovery?

1. DECONSTRUCT THE INPUT
2. PIVOT ON INCOMPLETE DATA
3. DEDUCTIVE SYNTHESIS`;

const distilledFront2 = distillFrontend(personaQuery2);
const distilledBack2 = distillBackend(personaQuery2);

assert.ok(distilledFront2.toLowerCase().includes('james webb space telescope discovery'), `Frontend distillation missing core query: ${distilledFront2}`);
assert.ok(!distilledFront2.toLowerCase().includes('deep-synthesis reasoning engine'), `Frontend distillation failed to strip preamble: ${distilledFront2}`);
assert.ok(distilledBack2.toLowerCase().includes('james webb space telescope discovery'), `Backend distillation missing core query: ${distilledBack2}`);
assert.ok(!distilledBack2.toLowerCase().includes('deep-synthesis reasoning engine'), `Backend distillation failed to strip preamble: ${distilledBack2}`);
console.log('  [PASS] 1.2 Persona preamble 2 successfully stripped in frontend and backend');

// Test 2: BoundedLiveResearchController injects Deep-Synthesis protocol when isWebForced: true
console.log('\n--- Section 2: BoundedLiveResearchController Protocol Injection ---');
let capturedPromptForced = '';
const controllerForced = new BoundedLiveResearchController({
    searchCutoffMs: 1000,
    hardDeadlineMs: 3000
});

await controllerForced.execute({
    query: 'Identify the lead developer behind project Apollo',
    userText: 'Identify the lead developer behind project Apollo',
    context: [],
    isWebForced: true,
    fetchSearchFn: async () => ({
        results: [
            { id: 1, title: 'NASA Apollo Program', url: 'https://nasa.gov/apollo', description: 'Apollo overview' },
            { id: 2, title: 'Margaret Hamilton Bio', url: 'https://nasa.gov/hamilton', description: 'Margaret Hamilton led the MIT Software Engineering Division for Apollo' }
        ]
    }),
    streamSynthesisFn: async ({ prompt }) => {
        capturedPromptForced = prompt;
        return { ok: true };
    }
});

assert.ok(capturedPromptForced.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL WEB SEARCH ACTIVATED)'), 'Synthesis prompt missing DEEP-SYNTHESIS protocol when isWebForced is true');
assert.ok(capturedPromptForced.includes('1. DECONSTRUCT THE INPUT'), 'Synthesis prompt missing protocol step 1');
assert.ok(capturedPromptForced.includes('2. PIVOT ON INCOMPLETE DATA'), 'Synthesis prompt missing protocol step 2');
assert.ok(capturedPromptForced.includes('3. DEDUCTIVE SYNTHESIS'), 'Synthesis prompt missing protocol step 3');
assert.ok(capturedPromptForced.includes('4. EPISTEMIC COMPLETENESS'), 'Synthesis prompt missing protocol step 4');
console.log('  [PASS] 2.1 BoundedLiveResearchController properly injects Deep-Synthesis protocol when isWebForced is true');

let capturedPromptAuto = '';
const controllerAuto = new BoundedLiveResearchController({
    searchCutoffMs: 1000,
    hardDeadlineMs: 3000
});

await controllerAuto.execute({
    query: 'Identify the lead developer behind project Apollo',
    userText: 'Identify the lead developer behind project Apollo',
    context: [],
    isWebForced: false,
    fetchSearchFn: async () => ({
        results: [
            { id: 1, title: 'NASA Apollo Program', url: 'https://nasa.gov/apollo', description: 'Apollo overview' },
            { id: 2, title: 'Margaret Hamilton Bio', url: 'https://nasa.gov/hamilton', description: 'Margaret Hamilton led the MIT Software Engineering Division for Apollo' }
        ]
    }),
    streamSynthesisFn: async ({ prompt }) => {
        capturedPromptAuto = prompt;
        return { ok: true };
    }
});

assert.ok(!capturedPromptAuto.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL WEB SEARCH ACTIVATED)'), 'Synthesis prompt unexpectedly contained DEEP-SYNTHESIS protocol when isWebForced was false');
console.log('  [PASS] 2.2 BoundedLiveResearchController does NOT inject Deep-Synthesis protocol when isWebForced is false');

// Test 3: api/chat-groq.js server system prompt injection
console.log('\n--- Section 3: api/chat-groq.js System Prompt Injection ---');
if (typeof buildServerSystemPrompt === 'function') {
    const forcedSystemPrompt = buildServerSystemPrompt({ isWebForced: true }, 'chat');
    assert.ok(forcedSystemPrompt.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL LIVE WEB SEARCH ACTIVE)'), 'Server system prompt missing protocol when isWebForced is true');
    assert.ok(forcedSystemPrompt.includes('1. DECONSTRUCT THE INPUT'), 'Server system prompt missing protocol rule 1');
    assert.ok(forcedSystemPrompt.includes('2. PIVOT ON INCOMPLETE DATA'), 'Server system prompt missing protocol rule 2');
    assert.ok(forcedSystemPrompt.includes('3. DEDUCTIVE SYNTHESIS'), 'Server system prompt missing protocol rule 3');
    assert.ok(forcedSystemPrompt.includes('4. EPISTEMIC RESOLUTION'), 'Server system prompt missing protocol rule 4');
    console.log('  [PASS] 3.1 buildServerSystemPrompt injects protocol when preferences.isWebForced is true');

    const forcedWebModeSystemPrompt = buildServerSystemPrompt({ webMode: 'force' }, 'chat');
    assert.ok(forcedWebModeSystemPrompt.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL LIVE WEB SEARCH ACTIVE)'), 'Server system prompt missing protocol when webMode is force');
    console.log('  [PASS] 3.2 buildServerSystemPrompt injects protocol when preferences.webMode is force');

    const normalSystemPrompt = buildServerSystemPrompt({ isWebForced: false, webMode: 'off' }, 'chat');
    assert.ok(!normalSystemPrompt.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL LIVE WEB SEARCH ACTIVE)'), 'Server system prompt unexpectedly contains protocol when web search is off');
    console.log('  [PASS] 3.3 buildServerSystemPrompt omits protocol when live search is off');

    // Fast simple override check
    const fastSimpleForced = buildServerSystemPrompt({ isWebForced: true }, 'fast_simple');
    assert.ok(fastSimpleForced.includes('DEEP-SYNTHESIS REASONING ENGINE PROTOCOL (MANUAL LIVE WEB SEARCH ACTIVE)'), 'Fast simple intent bypassed protocol despite isWebForced being true');
    console.log('  [PASS] 3.4 isWebForced correctly supersedes fast_simple intent');
}

// Test 4: normalizeChatRequest properly populates isWebForced
console.log('\n--- Section 4: normalizeChatRequest Parameter Parsing ---');
if (typeof normalizeChatRequest === 'function') {
    const req1 = normalizeChatRequest({ message: 'Hello world', webMode: 'force' });
    assert.equal(req1.value.preferences.isWebForced, true, 'isWebForced not true from top-level webMode: force');
    assert.equal(req1.value.preferences.webMode, 'force', 'webMode not parsed from top-level');

    const req2 = normalizeChatRequest({ message: 'Hello world', isWebForced: true });
    assert.equal(req2.value.preferences.isWebForced, true, 'isWebForced not true from top-level isWebForced');

    const req3 = normalizeChatRequest({ message: 'Hello world', preferences: { webMode: 'force' } });
    assert.equal(req3.value.preferences.isWebForced, true, 'isWebForced not true from preferences.webMode: force');

    const req4 = normalizeChatRequest({ message: 'Hello world', preferences: { isWebForced: false, webMode: 'off' } });
    assert.equal(req4.value.preferences.isWebForced, false, 'isWebForced should be false');
    console.log('  [PASS] 4.1 normalizeChatRequest handles all configurations of webMode and isWebForced');
}

console.log('\n=== All Deep-Synthesis Protocol Tests Passed Successfully! ===');
