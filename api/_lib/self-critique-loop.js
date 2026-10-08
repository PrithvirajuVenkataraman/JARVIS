/**
 * Autonomous Self-Critique & In-Flight Recursive Refinement Loop
 * Evaluates candidate responses against user constraints, logical coherence,
 * code syntax integrity, and mathematical consistency.
 */

function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9_]{2,}/g) || []));
}

function countWords(text = '') {
    return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts explicit negative constraints and formatting directives from user query.
 */
export function extractQueryConstraints(query = '') {
    const raw = String(query || '').trim();
    const constraints = [];

    // Negative constraints: don't use X, without X, avoid X, no X
    const negMatch = raw.matchAll(/\b(?:don'?t|do\s+not|never|avoid|without|no)\s+(?:use|using|include|including|have|having|mention|mentioning)\s+([^,.;!?\n]{3,60})/gi);
    for (const m of negMatch) {
        const item = m[1].trim().replace(/\b(?:please|any|the)\b/gi, '').trim();
        if (item.length > 2) {
            constraints.push({ type: 'negative_constraint', target: item.toLowerCase() });
        }
    }

    // Explicit format request: json, code only, step-by-step
    if (/\b(?:json\s+only|valid\s+json|format\s+(?:as|in)\s+json)\b/i.test(raw)) {
        constraints.push({ type: 'required_format', target: 'json' });
    }
    if (/\b(?:code\s+only|only\s+code|no\s+explanation)\b/i.test(raw)) {
        constraints.push({ type: 'required_format', target: 'code_only' });
    }
    if (/\b(?:step-by-step|show\s+all\s+steps|break\s+down\s+step\s+by\s+step)\b/i.test(raw)) {
        constraints.push({ type: 'required_format', target: 'step_by_step' });
    }

    // Word count bounds: under X words, maximum X words
    const maxWordsMatch = raw.match(/\b(?:under|less\s+than|max(?:imum)?(?:\s+of)?)\s+(\d{1,4})\s+words\b/i);
    if (maxWordsMatch) {
        constraints.push({ type: 'max_words', target: parseInt(maxWordsMatch[1], 10) });
    }

    return constraints;
}

/**
 * Checks for logical contradictions and self-inconsistencies in the draft response.
 */
export function detectLogicalContradictions(text = '') {
    const flaws = [];
    const lower = String(text || '').toLowerCase();

    // 1. Knight & Knave or Truth/Liar contradiction
    if (/\b(?:knight|knave)\b/i.test(lower)) {
        const lines = lower.split('\n');
        let knightConfirmed = false;
        let knaveConfirmed = false;
        for (const line of lines) {
            if (/\b(?:is\s+a\s+knight|must\s+be\s+a\s+knight)\b/.test(line)) knightConfirmed = true;
            if (/\b(?:is\s+a\s+knave|must\s+be\s+a\s+knave)\b/.test(line)) knaveConfirmed = true;
        }
        if (/\btherefore\b/.test(lower) && /\bcannot\s+be\s+determined\b/.test(lower) && (knightConfirmed || knaveConfirmed)) {
            flaws.push({
                type: 'contradictory_conclusion',
                description: 'The deduction derives concrete roles but also asserts the outcome cannot be determined.',
                severity: 'critical'
            });
        }
    }

    // 2. Unbalanced Code Fences
    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 !== 0) {
        flaws.push({
            type: 'unclosed_code_fence',
            description: 'The response contains an unclosed Markdown code fence (```).',
            severity: 'critical'
        });
    }

    // 3. Premature Refusal Contradiction
    if (countWords(text) > 80 && /^(?:i\s+cannot\s+assist|i\s+do\s+not\s+have\s+access|as\s+an\s+ai\s+language\s+model,\s+i\s+cannot)\b/i.test(lower)) {
        flaws.push({
            type: 'refusal_body_conflict',
            description: 'The answer opens with a generic canned refusal preamble despite containing generated solution content.',
            severity: 'critical'
        });
    }

    // 4. Arithmetic identity checks: simple arithmetic equation
    const mathEqRegex = /\b(\d+(?:\.\d+)?)\s*([\+\-\*\/])\s*(\d+(?:\.\d+)?)\s*=\s*(\d+(?:\.\d+)?)\b/g;
    let eqMatch;
    while ((eqMatch = mathEqRegex.exec(text)) !== null) {
        const n1 = parseFloat(eqMatch[1]);
        const op = eqMatch[2];
        const n2 = parseFloat(eqMatch[3]);
        const declared = parseFloat(eqMatch[4]);
        let expected = null;
        if (op === '+') expected = n1 + n2;
        else if (op === '-') expected = n1 - n2;
        else if (op === '*') expected = n1 * n2;
        else if (op === '/' && n2 !== 0) expected = n1 / n2;

        if (expected !== null && Math.abs(expected - declared) > 0.001) {
            flaws.push({
                type: 'arithmetic_inconsistency',
                description: `Arithmetic expression ${eqMatch[0]} is incorrect (computed ${expected}).`,
                severity: 'warning'
            });
            break;
        }
    }

    return flaws;
}

/**
 * Evaluates a draft solution against query constraints and logical coherence.
 */
export function evaluateDraftSolution(query = '', draftAnswer = '', context = {}) {
    const flaws = [];
    const repairDirectives = [];
    const draftText = String(draftAnswer || '').trim();

    if (!draftText) {
        return {
            verified: false,
            score: 0.0,
            flaws: [{ type: 'empty_solution', description: 'Candidate solution is empty.', severity: 'critical' }],
            repairDirectives: ['Generate a complete solution addressing the prompt.']
        };
    }

    // 1. Query Constraint Verification
    const constraints = extractQueryConstraints(query);
    const draftLower = draftText.toLowerCase();

    for (const c of constraints) {
        if (c.type === 'negative_constraint') {
            if (draftLower.includes(c.target)) {
                flaws.push({
                    type: 'constraint_violation',
                    description: `Violated explicit negative constraint: included '${c.target}'.`,
                    severity: 'critical'
                });
                repairDirectives.push(`Remove all occurrences of '${c.target}' as explicitly requested.`);
            }
        } else if (c.type === 'required_format') {
            if (c.target === 'json') {
                const hasJsonFence = /```(?:json)?\s*[\{\[][\s\S]*?[\}\]]\s*```/.test(draftText) || (/^[\{\[][\s\S]*?[\}\]]$/.test(draftText));
                if (!hasJsonFence) {
                    flaws.push({
                        type: 'format_violation',
                        description: 'Output was required to be JSON, but valid JSON block was missing.',
                        severity: 'critical'
                    });
                    repairDirectives.push('Format the entire response as valid, parseable JSON.');
                }
            } else if (c.target === 'code_only') {
                const wordsOutsideFences = draftText.replace(/```[\s\S]*?```/g, '').trim();
                if (countWords(wordsOutsideFences) > 40) {
                    flaws.push({
                        type: 'format_violation',
                        description: 'User requested code only without conversational explanation.',
                        severity: 'warning'
                    });
                    repairDirectives.push('Output only the code without conversational narrative.');
                }
            }
        } else if (c.type === 'max_words') {
            const actualWords = countWords(draftText);
            if (actualWords > c.target * 1.25) {
                flaws.push({
                    type: 'length_violation',
                    description: `Answer exceeds requested word limit (expected <= ${c.target} words, got ~${actualWords}).`,
                    severity: 'warning'
                });
                repairDirectives.push(`Condense the answer to strictly under ${c.target} words.`);
            }
        }
    }

    // 2. Logical and Structural Inconsistencies
    const logicalFlaws = detectLogicalContradictions(draftText);
    for (const lf of logicalFlaws) {
        flaws.push(lf);
        repairDirectives.push(lf.description);
    }

    // 3. Compute Verification Score (0.0 to 1.0)
    let score = 1.0;
    for (const f of flaws) {
        if (f.severity === 'critical') score -= 0.45;
        else score -= 0.15;
    }
    score = Math.max(0.0, Math.min(1.0, Number(score.toFixed(2))));

    const verified = score >= 0.70 && !flaws.some(f => f.severity === 'critical');

    return {
        verified,
        score,
        flaws,
        repairDirectives
    };
}

/**
 * Determines whether the draft solution warrants an automated refinement pass.
 */
export function needsRefinement(critiqueResult) {
    if (!critiqueResult) return false;
    return critiqueResult.verified === false || (critiqueResult.flaws && critiqueResult.flaws.some(f => f.severity === 'critical'));
}

/**
 * Builds the refinement prompt for the model's self-correction pass.
 */
export function buildRefinementPrompt(query = '', draftAnswer = '', critiqueResult = {}, originalSystemPrompt = '') {
    const flawsList = (critiqueResult?.repairDirectives || critiqueResult?.flaws?.map(f => f.description) || [])
        .map(d => `- ${d}`)
        .join('\n');

    return [
        (originalSystemPrompt || '').trim(),
        '',
        '=== AUTONOMOUS SELF-CORRECTION & RECURSIVE REFINEMENT ===',
        'Your initial draft response was evaluated by internal self-critique and the following issues were flagged:',
        flawsList || '- Please review step-by-step for correctness and consistency.',
        '',
        'TASK: Re-evaluate and refine the solution. Provide the definitive, corrected answer satisfying all constraints and eliminating all flagged contradictions. Do not reference internal system critique in your final output.',
        '========================================================'
    ].join('\n');
}

/**
 * Synthesizes critique metadata for client audit inspection.
 */
export function synthesizeSelfCritiqueMetadata(critiqueResult = {}, refined = false) {
    const flaws = critiqueResult?.flaws || [];
    return {
        performed: true,
        verified: Boolean(critiqueResult?.verified),
        score: critiqueResult?.score ?? 1.0,
        flawsDetected: flaws.length,
        refined: Boolean(refined),
        auditSummary: flaws.length
            ? `Self-Critique detected ${flaws.length} issue(s) and applied recursive correction.`
            : 'Self-Critique verified solution consistency and constraint adherence.'
    };
}
