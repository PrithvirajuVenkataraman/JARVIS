import assert from 'node:assert/strict';
import { SelfImprovingMemoryEngine } from '../app/self-improving-memory.js';
import { validateAndRepairCodeAndMath } from '../api/_lib/code-math-validator.js';
import { __test as searchTest } from '../api/search.js';

const { evaluateWebRagEvidence, buildWebRagQueryPhases } = searchTest;

console.log('=== Testing Autonomous Self-Improving Loops Suite ===');

// ============================================================================
// Section 1: User Preference & Correction Learning Engine
// ============================================================================
console.log('--- Section 1: User Preference & Correction Learning Engine ---');

const mockStorage = {
    data: new Map(),
    async getItem(k) { return this.data.get(k) || null; },
    async setItem(k, v) { this.data.set(k, v); }
};

const memoryEngine = new SelfImprovingMemoryEngine();
await memoryEngine.init(mockStorage);

// 1.1 Negative constraint detection
const neg1 = memoryEngine.detectCorrectionOrPreference("Don't use bullet points in explanations");
assert.equal(neg1?.category, 'negative_constraint');
assert.match(neg1?.directive, /Avoid bullet points in explanations/i);
console.log('  [PASS] 1.1 Negative style constraint detected');

// 1.2 Positive preference detection
const pos1 = memoryEngine.detectCorrectionOrPreference("Always respond in TypeScript with strict types");
assert.equal(pos1?.category, 'positive_preference');
assert.match(pos1?.directive, /Prefer TypeScript with strict types/i);
console.log('  [PASS] 1.2 Positive language/framework preference detected');

// 1.3 User identity declaration
const id1 = memoryEngine.detectCorrectionOrPreference("Call me Dr. Kan");
assert.equal(id1?.category, 'user_identity');
assert.equal(id1?.directive, 'Address the user as Dr. Kan.');
console.log('  [PASS] 1.3 User identity and title detected');

// 1.4 Conciseness detection
const con1 = memoryEngine.detectCorrectionOrPreference("Keep it brief and concise");
assert.equal(con1?.category, 'conciseness');
assert.match(con1?.directive, /direct, concise/i);
console.log('  [PASS] 1.4 Conciseness preference detected');

// 1.5 Process message, deduplicate, and inject into system prompt
await memoryEngine.processUserMessage("Don't use bullet points");
await memoryEngine.processUserMessage("Don't use bullet points"); // Duplicate
assert.equal(memoryEngine.getAll().length, 1, 'Duplicate preferences must not be added');

const promptWithMemory = memoryEngine.injectIntoSystemPrompt('You are JARVIS.');
assert.match(promptWithMemory, /=== USER LEARNED PREFERENCES & ADAPTATIONS ===/);
assert.match(promptWithMemory, /Avoid bullet points/);
console.log('  [PASS] 1.5 Learned preferences injected into system prompt and deduplicated');

// ============================================================================
// Section 2: Fast Inline Code & Math Validator & Auto-Repair
// ============================================================================
console.log('--- Section 2: Fast Inline Code & Math Validator & Auto-Repair ---');

// 2.1 Unclosed code block auto-repair
const brokenCode = 'Here is the function:\n```javascript\nfunction test() { return 42; }\n// missing closing backticks';
const repairedCode = validateAndRepairCodeAndMath(brokenCode);
assert.equal(repairedCode.modified, true);
assert.match(repairedCode.text, /```$/);
assert.equal(repairedCode.issues.includes('unclosed_code_fence_repaired'), true);
console.log('  [PASS] 2.1 Unclosed markdown code fences automatically healed');

// 2.2 Unclosed display math ($$) auto-repair
const brokenMath = 'The equation is:\n$$\nx^2 + y^2 = r^2\n';
const repairedMath = validateAndRepairCodeAndMath(brokenMath);
assert.equal(repairedMath.modified, true);
assert.match(repairedMath.text, /\$\$$/);
assert.equal(repairedMath.issues.includes('unclosed_display_math_repaired'), true);
console.log('  [PASS] 2.2 Unclosed display math delimiters ($$) automatically healed');

// 2.3 Unclosed LaTeX inline math (\(...\)) auto-repair
const brokenInlineMath = 'Let \\(E = mc^2 be Einstein\'s equation.';
const repairedInlineMath = validateAndRepairCodeAndMath(brokenInlineMath);
assert.equal(repairedInlineMath.modified, true);
assert.match(repairedInlineMath.text, /\\\)$/);
assert.equal(repairedInlineMath.issues.includes('unclosed_latex_inline_math_repaired'), true);
console.log('  [PASS] 2.3 Unclosed LaTeX inline math delimiters \\(...\\) automatically healed');

// 2.4 Valid code is not modified
const validText = '```javascript\nconsole.log("hello");\n```';
const validResult = validateAndRepairCodeAndMath(validText);
assert.equal(validResult.modified, false);
assert.equal(validResult.text, validText);
console.log('  [PASS] 2.4 Valid code/math is untouched');

// 2.5 P2: Speculative arithmetic auto-repair
const hallucinatedCalculation = 'The total cost is 15 * 12 = 175 dollars for the whole team.';
const repairedCalculation = validateAndRepairCodeAndMath(hallucinatedCalculation);
assert.equal(repairedCalculation.modified, true);
assert.match(repairedCalculation.text, /15 \* 12 = 180/);
assert.equal(repairedCalculation.issues.includes('hallucinated_arithmetic_repaired'), true);
console.log('  [PASS] 2.5 Speculative arithmetic calculation automatically verified & repaired');

// ============================================================================
// Section 3: Adaptive Search Multi-Query Reflection Loop
// ============================================================================
console.log('--- Section 3: Adaptive Search Multi-Query Reflection Loop ---');

// 3.1 Multi-tier query phases for targeted and fallback search
const phases = buildWebRagQueryPhases('Who is the current Prime Minister of the UK?');
assert.equal(Array.isArray(phases), true);
assert.equal(phases.length >= 2, true, 'Must generate multi-tier query phases');
console.log('  [PASS] 3.1 Adaptive search phases generated for multi-source fallback');

// 3.2 Evidence gate evaluates conflict and confidence
const weakGate = evaluateWebRagEvidence('Who is the captain of CSK?', []);
assert.equal(weakGate.pass, false, 'Empty search results must fail evidence gate and trigger phase 2 reflection');
console.log('  [PASS] 3.2 Evidence gate correctly triggers reflection on empty or weak evidence');

console.log('================================================================');
console.log('=== All Autonomous Self-Improving Loops Tests PASSED ===');
console.log('================================================================');
