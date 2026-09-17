import assert from 'node:assert/strict';
import { SelfImprovingMemoryEngine } from '../app/self-improving-memory.js';
import { validateAndRepairCodeAndMath, StreamingSpeculativeGuard } from '../api/_lib/code-math-validator.js';
import { __test as searchTest } from '../api/search.js';

const { evaluateWebRagEvidence, buildWebRagQueryPhases } = searchTest;

console.log('=== Testing Autonomous Self-Improving Loops Suite (Pure Dynamic Invariants) ===');

// Seed-based dynamic token and symbol generator
const randStr = (seed, len = 8) => {
    let s = seed;
    let res = '';
    for (let i = 0; i < len; i++) {
        s = (s * 1664525 + 1013904223) | 0;
        res += String.fromCharCode(97 + (Math.abs(s) % 26));
    }
    return res;
};

// ============================================================================
// Section 1: Invariant Testing for Self-Improving Memory Engine
// ============================================================================
console.log('--- Section 1: User Preference & Correction Learning Engine ---');

const mockStorage = {
    data: new Map(),
    async getItem(k) { return this.data.get(k) || null; },
    async setItem(k, v) { this.data.set(k, v); }
};

const memoryEngine = new SelfImprovingMemoryEngine();
await memoryEngine.init(mockStorage);

// Invariant 1.1: Dynamic Directive Extraction & Memory Invariance
for (let i = 1; i <= 5; i++) {
    const symbol = randStr(i * 17, 8);
    const directive = `Avoid using ${symbol}`;
    const detected = memoryEngine.detectCorrectionOrPreference(directive);
    assert.ok(detected, 'Directive must be detected dynamically');
    assert.ok(typeof detected.category === 'string');
    assert.match(detected.directive, new RegExp(symbol));
}
console.log('  [PASS] 1.1 Dynamic negative constraints detected across arbitrary tokens');

// Invariant 1.2: Deduplication & Set Cardinality Invariant
const uniqueKey = randStr(999, 10);
const ruleText = `Avoid using ${uniqueKey}`;
await memoryEngine.processUserMessage(ruleText);
await memoryEngine.processUserMessage(ruleText);
assert.equal(memoryEngine.getAll().filter(item => item.directive.includes(uniqueKey)).length, 1, 'Memory must satisfy deduplication idempotency');
console.log('  [PASS] 1.2 Memory storage satisfies deduplication idempotency invariant');

// Invariant 1.3: Injection Preserves System Prompt Envelope
const basePrompt = `System envelope ${randStr(123, 10)}.`;
const injected = memoryEngine.injectIntoSystemPrompt(basePrompt);
assert.ok(injected.includes(basePrompt), 'Injected prompt must preserve base prompt envelope');
assert.ok(injected.includes(uniqueKey), 'Injected prompt must contain active learned preferences');
console.log('  [PASS] 1.3 System prompt injection preserves base envelope and injects learned memory');

// ============================================================================
// Section 2: Mathematical & Syntactic Invariants for Fast Validator & Speculative Guard
// ============================================================================
console.log('--- Section 2: Fast Inline Code & Math Validator & Auto-Repair ---');

// Invariant 2.1: Code Fence Parity Invariant (Even count of ```)
for (let i = 1; i <= 5; i++) {
    const innerCode = `const ${randStr(i * 10, 6)} = ${i * 42};`;
    const oddFenceCode = `\`\`\`javascript\n${innerCode}\n// trailing`;
    const repaired = validateAndRepairCodeAndMath(oddFenceCode);
    const fenceMatches = (repaired.text.match(/```/g) || []).length;
    assert.equal(fenceMatches % 2, 0, 'Repaired code block must have balanced even code fences');
    assert.equal(repaired.modified, true);
}
console.log('  [PASS] 2.1 Code fence parity balance invariant verified');

// Invariant 2.2: Math Delimiter Parity Invariant (Even count of $$)
for (let i = 1; i <= 5; i++) {
    const brokenMath = `$$\n${randStr(i * 20, 4)}^2 + y^2 = r^2\n`;
    const repaired = validateAndRepairCodeAndMath(brokenMath);
    const mathMatches = (repaired.text.match(/\$\$/g) || []).length;
    assert.equal(mathMatches % 2, 0, 'Repaired math block must have balanced even $$ delimiters');
    assert.equal(repaired.modified, true);
}
console.log('  [PASS] 2.2 Math delimiter parity balance invariant verified');

// Invariant 2.3: Arithmetic Accuracy Property (∀ a, b, op: repair(a op b = wrong) == a op b = (a op b))
for (let i = 1; i <= 5; i++) {
    const a = 10 + i * 3;
    const b = 5 + i * 2;
    const trueProduct = a * b;
    const wrongProduct = trueProduct + (i % 2 === 0 ? 15 : -15);
    const equationText = `Computed: ${a} * ${b} = ${wrongProduct}.`;

    const repaired = validateAndRepairCodeAndMath(equationText);
    assert.equal(repaired.modified, true);
    assert.match(repaired.text, new RegExp(`${a} \\* ${b} = ${trueProduct}`));
}
console.log('  [PASS] 2.3 Speculative arithmetic property-based verification & auto-repair verified');

// Invariant 2.4: Streaming Speculative Guard Invariant
const guard = new StreamingSpeculativeGuard();
for (let i = 1; i <= 3; i++) {
    const x = 6 + i;
    const y = 7 + i;
    const correct = x * y;
    const chunk = `Calc: ${x} * ${y} = ${correct + 10}. `;
    const emitted = guard.ingest(chunk);
    assert.match(emitted, new RegExp(`${x} \\* ${y} = ${correct}`));
}
const flushed = guard.flushRemaining();
assert.ok(typeof flushed === 'string');
console.log('  [PASS] 2.4 Streaming Speculative Guard dynamically repairs streaming arithmetic on the fly');

// ============================================================================
// Section 3: Adaptive Search Multi-Query Invariants
// ============================================================================
console.log('--- Section 3: Adaptive Search Multi-Query Reflection Loop ---');

for (let i = 1; i <= 5; i++) {
    const q = `${randStr(i * 100, 6)} ${randStr(i * 200, 8)} current status`;
    const phases = buildWebRagQueryPhases(q);
    assert.ok(Array.isArray(phases), 'Phases must be an array');
    assert.ok(phases.length >= 2, 'Adaptive search must generate at least 2 progressive query phases');
}
console.log('  [PASS] 3.1 Adaptive search phases monotonically generate fallback query variations');

// Empty evidence gate triggering
const emptyEvidence = evaluateWebRagEvidence([], `target ${randStr(777, 8)}`);
assert.equal(emptyEvidence.pass, false, 'Empty source array must trigger reflection requirement');
console.log('  [PASS] 3.2 Evidence gate correctly triggers reflection requirement on empty evidence');

console.log('=== All Autonomous Self-Improving Loops Tests PASSED (Property-Based) ===');
