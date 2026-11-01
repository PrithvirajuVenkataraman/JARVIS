/**
 * Phase 5: Natural Follow-Up Behavior - Test Suite
 * Run: node tests/follow-up-behavior.test.mjs
 */

// ─── Inline the stripping logic exactly as in index.html after Phase 5 ───────

function stripRoboticMetaTalk(text) {
    return text
        .replace(/\s*(?:this is the answer[.!]?\s*)?(?:i(?:' a'm|'m)|i am)\s+(?:going to|gonna|about to)\s+(?:end|stop)\s+(?:it|this|here)(?:\s+here)?[.!]?\s*$/i, '')
        .replace(/\s*i(?:' wi'|'ll)\s+stop\s+here(?:\s+because[^.?!]*)?[.!]?\s*$/i, '')
        .replace(/\s*(?:so,?\s*)?this is (?:the|my) (?:final )?answer[.!]?\s*$/i, '')
        .trim();
}

function stripGenericOffers(text) {
    return text
        .replace(/\s*(?:would you (?:like|want|care) (?:to (?:know|learn|explore|hear)(?: more| about (?:this|that|any of these))?|me to (?:elaborate|explain|expand|continue|go (?:deeper|further)|cover anything else))|(?:is )?(?:there (?:anything|something) else(?: i can| you(?:' d like me to))? (?:help|assist|clarify|explain|cover)))[^.?!]*[.?!]?\s*$/i, '')
        .replace(/\s*(?:(?:let|feel free to) (?:me know|ask)(?: (?:me )?(?:if|whenever|anytime) you (?:have|need|want|require)|about anything))[^.?!]*[.?!]?\s*$/i, '')
        .replace(/\s*(?:(?:do|did) you have (?:any (?:other|further|more|additional)|another) (?:questions?|queries?|things? (?:you(?:' d like)|to (?:ask|cover))))[^.?!]*[.?!]?\s*$/i, '')
        .replace(/\s*(?:hope (?:this|that)[^.!]*[.!]?)\s*$/i, '')
        .replace(/\s*(?:happy to (?:help|assist|answer|clarify|elaborate)(?: (?:further|more|with anything else))?[.!]?)\s*$/i, '')
        .trim();
}

function postProcess(text) {
    let t = stripRoboticMetaTalk(String(text || '').trim());
    return stripGenericOffers(t);
}

// ─── Test runner ──────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;
function test(label, fn) {
    try { fn(); console.log('  PASS  ' + label); passed++; }
    catch(e) { console.error('  FAIL  ' + label); console.error('        ' + e.message); failed++; }
}
function assertStripped(raw, desc) {
    const result = postProcess(raw);
    if (result === raw.trim()) throw new Error('Expected stripping but text unchanged: ' + desc);
    if (!result.length) throw new Error('Result empty after strip: ' + desc);
}
function assertPreserved(raw, desc) {
    const result = postProcess(raw);
    if (result !== raw.trim()) throw new Error('Expected preservation but got: ' + JSON.stringify(result) + ' for: ' + desc);
}

// ─── Suite 1: hollow endings that must be stripped ───────────────────────────

console.log('\nSuite 1: Generic hollow endings — must be stripped');
test('"Would you like to know more?"', () => assertStripped('Photosynthesis converts sunlight into glucose. Would you like to know more?', 'know more'));
test('"Would you like me to elaborate?"', () => assertStripped('The CPU runs a fetch-decode-execute cycle. Would you like me to elaborate?', 'elaborate'));
test('"Is there anything else I can help with?"', () => assertStripped('React uses a virtual DOM. Is there anything else I can help with?', 'anything else help'));
test('"Is there something else I can clarify?"', () => assertStripped('Transformers use self-attention. Is there something else I can clarify?', 'clarify'));
test('"Let me know if you have any questions!"', () => assertStripped('Node.js uses an event loop. Let me know if you have any questions!', 'let me know questions'));
test('"Feel free to ask if you need anything."', () => assertStripped('Gradient descent minimises loss. Feel free to ask if you need anything.', 'feel free ask'));
test('"Do you have any other questions?"', () => assertStripped('Rust eliminates data races at compile time. Do you have any other questions?', 'other questions'));
test('"Hope this helps!"', () => assertStripped('Mitochondria produce ATP via oxidative phosphorylation. Hope this helps!', 'hope this helps'));
test('"Hope that clarifies things!"', () => assertStripped('Async/await is sugar over Promises. Hope that clarifies things!', 'hope that clarifies'));
test('"Happy to help!"', () => assertStripped('The Turing test measures machine intelligence. Happy to help!', 'happy to help'));
test('"Happy to elaborate further."', () => assertStripped('HTTPS adds TLS encryption. Happy to elaborate further.', 'happy elaborate'));
test('"Would you like to explore this further?"', () => assertStripped('Kubernetes orchestrates containers. Would you like to explore this further?', 'explore further'));

// ─── Suite 2: legitimate follow-ups that must be preserved ───────────────────

console.log('\nSuite 2: Legitimate contextual follow-ups — must be preserved');
test('Specific technical follow-up preserved', () => assertPreserved(
    "React's reconciler compares virtual DOM trees. Do you want to walk through how keys help the diffing algorithm avoid unnecessary re-renders?",
    'technical diffing follow-up'
));
test('Concrete next step preserved', () => assertPreserved(
    'Your base image is 1.2 GB. Switching to a distroless base cuts that to 120 MB. Want me to show the updated Dockerfile?',
    'actionable dockerfile step'
));
test('Contextual planning follow-up preserved', () => assertPreserved(
    'The Shinkansen connects Tokyo to Kyoto in ~2h 15m. Should I add it to your itinerary with recommended departure times?',
    'itinerary planning follow-up'
));
test('Specific clarification preserved', () => assertPreserved(
    'That error usually means your SSL certificate expired. Which web server are you running — nginx or Apache?',
    'specific clarifying question'
));
test('Simple factual answer with no ending passes through', () => assertPreserved(
    'The speed of light in a vacuum is approximately 299,792,458 metres per second.',
    'pure factual, no ending'
));

// ─── Suite 3: pre-existing meta-talk endings still stripped ──────────────────

console.log('\nSuite 3: Pre-existing meta-talk endings — must still be stripped');
test('"This is my final answer."', () => assertStripped('The answer is 42. This is my final answer.', 'final answer'));
test('"I will stop here."', () => assertStripped("Vue 3 lifecycle hooks covered. I'll stop here.", "i'll stop here"));

// ─── Suite 4: edge cases ─────────────────────────────────────────────────────

console.log('\nSuite 4: Edge cases');
test('Body survives stripping', () => {
    const result = postProcess('WebAssembly runs near-native code in the browser. Is there anything else I can help with?');
    if (!result.includes('WebAssembly')) throw new Error('Body text lost after stripping');
    if (result.includes('anything else')) throw new Error('Offer not stripped');
});
test('Empty string returns empty', () => {
    if (postProcess('') !== '') throw new Error('Expected empty string');
});
test('Clean answer passes through unchanged', () => {
    const clean = 'The Nyquist theorem states that a signal must be sampled at least twice its highest frequency.';
    if (postProcess(clean) !== clean) throw new Error('Clean answer was mutated');
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log('\n' + '-'.repeat(55));
console.log('follow-up-behavior.test.mjs  ' + passed + '/' + (passed+failed) + ' ' + (failed===0?'PASS':'FAIL'));
if (failed > 0) { process.exit(1); }

