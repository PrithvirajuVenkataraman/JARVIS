import assert from 'node:assert/strict';
import {
    extractQueryConstraints,
    detectLogicalContradictions,
    evaluateDraftSolution,
    needsRefinement,
    buildRefinementPrompt,
    synthesizeSelfCritiqueMetadata
} from '../api/_lib/self-critique-loop.js';

console.log('=== Testing Autonomous Self-Critique & In-Flight Refinement Suite ===');

// --- Section 1: Query Constraint Extraction ---
console.log('--- Section 1: Query Constraint Extraction ---');
{
    const query = "Explain photosynthesis step-by-step without using the word chloroplast, format in JSON, max 50 words";
    const constraints = extractQueryConstraints(query);

    const neg = constraints.find(c => c.type === 'negative_constraint');
    assert.ok(neg, 'Must extract negative constraint');
    assert.ok(neg.target.includes('chloroplast'), 'Must target chloroplast');

    const fmt = constraints.find(c => c.type === 'required_format' && c.target === 'json');
    assert.ok(fmt, 'Must extract JSON format requirement');

    const step = constraints.find(c => c.type === 'required_format' && c.target === 'step_by_step');
    assert.ok(step, 'Must extract step_by_step requirement');

    const words = constraints.find(c => c.type === 'max_words');
    assert.ok(words, 'Must extract max words limit');
    assert.equal(words.target, 50);

    console.log('  [PASS] 1.1 All constraint types accurately extracted');
}

// --- Section 2: Logical Contradiction Detection ---
console.log('--- Section 2: Logical Contradiction Detection ---');
{
    // Unclosed code fences
    const brokenCode = "Here is the code:\n" + "```" + "javascript\nconst x = 10;\n";
    const flaws = detectLogicalContradictions(brokenCode);
    assert.ok(flaws.some(f => f.type === 'unclosed_code_fence'), 'Must catch unclosed code fence');
    console.log('  [PASS] 2.1 Unclosed markdown code fence detected');

    // Knight / Knave contradiction
    const contradictoryKnights = "Alice is a knight. Bob is a knave. Therefore, their identities cannot be determined.";
    const knightFlaws = detectLogicalContradictions(contradictoryKnights);
    assert.ok(knightFlaws.some(f => f.type === 'contradictory_conclusion'), 'Must catch contradictory deduction outcome');
    console.log('  [PASS] 2.2 Deductive contradiction detected');

    // Arithmetic inconsistency
    const badMath = "The sum is 15 + 25 = 45 in total.";
    const mathFlaws = detectLogicalContradictions(badMath);
    assert.ok(mathFlaws.some(f => f.type === 'arithmetic_inconsistency'), 'Must flag erroneous arithmetic statement');
    console.log('  [PASS] 2.3 Arithmetic inconsistency detected');
}

// --- Section 3: Draft Solution Evaluation & Refinement Decision ---
console.log('--- Section 3: Draft Solution Evaluation & Refinement Decision ---');
{
    // Clean, valid solution
    const query = "Write a Python function to square a number without using pow";
    const goodDraft = "Here is the Python solution:\n```python\ndef square(n):\n    return n * n\n```";
    const cleanEval = evaluateDraftSolution(query, goodDraft);
    assert.equal(cleanEval.verified, true, 'Clean solution must pass verification');
    assert.equal(needsRefinement(cleanEval), false, 'Clean solution must not require refinement');
    console.log('  [PASS] 3.1 Clean compliant solution verified with score: ' + cleanEval.score);

    // Flawed solution (violates negative constraint)
    const flawedDraft = "Here is the Python solution:\n```python\ndef square(n):\n    return pow(n, 2)\n```";
    const flawedEval = evaluateDraftSolution(query, flawedDraft);
    assert.equal(flawedEval.verified, false, 'Flawed solution must fail verification');
    assert.equal(needsRefinement(flawedEval), true, 'Flawed solution must trigger refinement');
    assert.ok(flawedEval.flaws.some(f => f.type === 'constraint_violation'), 'Must list constraint violation');
    console.log('  [PASS] 3.2 Negative constraint violation triggers refinement');

    // Refinement Prompt Generation
    const refinementPrompt = buildRefinementPrompt(query, flawedDraft, flawedEval, "Base system prompt");
    assert.ok(refinementPrompt.includes('AUTONOMOUS SELF-CORRECTION & RECURSIVE REFINEMENT'));
    assert.ok(refinementPrompt.includes('pow'));
    console.log('  [PASS] 3.3 Refinement prompt injects targeted repair directives');

    // Metadata Synthesis
    const meta = synthesizeSelfCritiqueMetadata(flawedEval, true);
    assert.equal(meta.performed, true);
    assert.equal(meta.refined, true);
    assert.ok(meta.flawsDetected > 0);
    console.log('  [PASS] 3.4 Critique metadata synthesized cleanly');
}

console.log('\n=== All Autonomous Self-Critique & In-Flight Refinement Tests PASSED ===');
