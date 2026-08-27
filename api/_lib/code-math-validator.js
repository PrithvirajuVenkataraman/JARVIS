/**
 * Fast Inline Code & Math Validator & Self-Correction Module
 * Validates markdown fences, syntax integrity, LaTeX delimiters,
 * and speculative arithmetic correctness, automatically applying instant repairs.
 */

/**
 * Safely evaluates an arithmetic expression without global code execution.
 * @param {string} expr
 * @returns {number | null}
 */
export function safeEvaluateArithmetic(expr) {
    const raw = String(expr || '').trim()
        .replace(/\\times|×/g, '*')
        .replace(/\\div|÷/g, '/')
        .replace(/\\sqrt\{([^}]+)\}/g, 'Math.sqrt($1)')
        .replace(/\\sqrt\(([^)]+)\)/g, 'Math.sqrt($1)')
        .replace(/\\pi|\bpi\b/gi, 'Math.PI')
        .replace(/\\log\(([^)]+)\)/g, 'Math.log($1)')
        .replace(/\^/g, '**');

    // Only allow safe arithmetic characters
    if (!/^[\d\s+\-*/().%<>=,MathPIsqrtlog]+$/.test(raw)) return null;

    try {
        const fn = new Function('Math', `"use strict"; return (${raw});`);
        const res = fn(Math);
        return typeof res === 'number' && Number.isFinite(res) ? res : null;
    } catch {
        return null;
    }
}

/**
 * P2: Verifies inline arithmetic equality claims and auto-repairs calculation hallucinations.
 * @param {string} text
 * @returns {{ text: string, repaired: boolean, repairs: Array<{ expr: string, claimed: number, actual: number }> }}
 */
export function verifyAndRepairMathClaims(text = '') {
    let result = String(text || '');
    if (!result.trim()) return { text: result, repaired: false, repairs: [] };

    const repairs = [];

    // Match arithmetic equality patterns: e.g., "12 * 15 = 175" or "\(25 + 5\) = 30" or "$144 / 12 = 13$"
    const mathEqualityPattern = /(?:\$|\\\(|\b)([\d\s+\-*/().^%×÷\\]+?)\s*(?:=|\\approx|≈)\s*(-?[\d.]+)(?:\$|\\\)|\b)/g;

    result = result.replace(mathEqualityPattern, (fullMatch, leftExpr, claimedValStr) => {
        const claimedVal = parseFloat(claimedValStr);
        if (isNaN(claimedVal)) return fullMatch;

        const evaluated = safeEvaluateArithmetic(leftExpr);
        if (evaluated === null) return fullMatch;

        // If the calculation differs by more than 1e-4 from the claimed value, auto-repair it!
        if (Math.abs(evaluated - claimedVal) > 1e-4) {
            repairs.push({ expr: leftExpr.trim(), claimed: claimedVal, actual: evaluated });
            const prefix = fullMatch.startsWith('$') ? '$' : (fullMatch.startsWith('\\(') ? '\\(' : '');
            const suffix = fullMatch.endsWith('$') ? '$' : (fullMatch.endsWith('\\)') ? '\\)' : '');
            return `${prefix}${leftExpr.trim()} = ${evaluated}${suffix}`;
        }
        return fullMatch;
    });

    return {
        text: result,
        repaired: repairs.length > 0,
        repairs
    };
}

export function validateAndRepairCodeAndMath(text = '') {
    let result = String(text || '');
    if (!result.trim()) return { text: result, modified: false, issues: [] };

    const issues = [];

    // 1. Unclosed Markdown Code Blocks (odd number of ```)
    const codeBlockMatches = result.match(/```/g);
    if (codeBlockMatches && codeBlockMatches.length % 2 !== 0) {
        result += '\n```';
        issues.push('unclosed_code_fence_repaired');
    }

    // 2. Unclosed Display Math ($$...$$ or \[...\])
    const displayMathMatches = result.match(/\$\$/g);
    if (displayMathMatches && displayMathMatches.length % 2 !== 0) {
        result += '\n$$';
        issues.push('unclosed_display_math_repaired');
    }

    // 3. Unclosed Inline LaTeX Brackets \( and \[
    const openParenMath = (result.match(/\\\(/g) || []).length;
    const closeParenMath = (result.match(/\\\)/g) || []).length;
    if (openParenMath > closeParenMath) {
        result += '\\)'.repeat(openParenMath - closeParenMath);
        issues.push('unclosed_latex_inline_math_repaired');
    }

    const openBracketMath = (result.match(/\\\[/g) || []).length;
    const closeBracketMath = (result.match(/\\\]/g) || []).length;
    if (openBracketMath > closeBracketMath) {
        result += '\n\\]'.repeat(openBracketMath - closeBracketMath);
        issues.push('unclosed_latex_display_math_repaired');
    }

    // 4. Broken JSON trailing commas in JSON code blocks
    result = result.replace(/(```(?:json)?\s*[\r\n]+[\s\S]*?)(,\s*[\r\n]+\s*([}\]]))([\s\S]*?```)/gi, (match, prefix, commaGroup, closingBrace, suffix) => {
        issues.push('json_trailing_comma_repaired');
        return prefix + '\n' + closingBrace + suffix;
    });

    // 5. P2: Speculative Math Arithmetic Auto-Repair
    const mathRepairResult = verifyAndRepairMathClaims(result);
    if (mathRepairResult.repaired) {
        result = mathRepairResult.text;
        issues.push('hallucinated_arithmetic_repaired');
    }

    return {
        text: result,
        modified: issues.length > 0,
        issues
    };
}

/**
 * StreamingSpeculativeGuard: Buffers token chunks along sentence & block boundaries,
 * verifying and auto-repairing arithmetic, LaTeX math, and syntax before emitting to SSE stream.
 */
export class StreamingSpeculativeGuard {
    constructor(options = {}) {
        this.buffer = '';
        this.fullAccumulated = '';
        this.onVerifiedChunk = typeof options.onVerifiedChunk === 'function' ? options.onVerifiedChunk : null;
    }

    /**
     * Ingests a new streaming token chunk and yields any verified sentence blocks.
     * @param {string} chunk
     * @returns {string} Verified clean text to emit immediately.
     */
    ingest(chunk = '') {
        const str = String(chunk || '');
        this.buffer += str;
        this.fullAccumulated += str;

        // Split buffer along safe sentence/paragraph delimiters
        const delimiterMatch = this.buffer.match(/^(.*?(?:[.!?]\s+|\n\n|```[\w]*\n))([\s\S]*)$/);
        if (delimiterMatch && delimiterMatch[1]) {
            const sentenceToVerify = delimiterMatch[1];
            const remaining = delimiterMatch[2] || '';

            const repaired = validateAndRepairCodeAndMath(sentenceToVerify);
            this.buffer = remaining;
            const output = repaired.text;
            if (this.onVerifiedChunk) this.onVerifiedChunk(output);
            return output;
        }

        return '';
    }

    /**
     * Flushes any remaining tokens in buffer at stream completion with full terminal validation.
     * @returns {string} Final verified trailing text.
     */
    flushRemaining() {
        if (!this.buffer && !this.fullAccumulated) return '';
        const finalRepaired = validateAndRepairCodeAndMath(this.fullAccumulated);
        const remainingToEmit = finalRepaired.text.slice(this.fullAccumulated.length - this.buffer.length);
        this.buffer = '';
        if (this.onVerifiedChunk && remainingToEmit) this.onVerifiedChunk(remainingToEmit);
        return remainingToEmit;
    }
}
