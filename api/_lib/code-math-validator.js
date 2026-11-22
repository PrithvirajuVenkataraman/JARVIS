import { evaluateArithmetic, verifyArithmeticClaims } from './arithmetic.js';
/**
 * Formatting repair and bounded arithmetic checks.
 * Repairs supported Markdown/LaTeX delimiters and JSON punctuation.
 * Reports arithmetic mismatches without changing the model's numerical claims.
 */

/**
 * Safely evaluates an arithmetic expression without global code execution.
 * @param {string} expr
 * @returns {number | null}
 */
export function safeEvaluateArithmetic(expr) { const value = evaluateArithmetic(expr); return value === null ? null : Math.round(value * 1e6) / 1e6; }

/**
 * Checks supported arithmetic equalities. The legacy function name is retained
 * for existing callers; numerical claims are never rewritten.
 * @param {string} text
 * @returns {{ text: string, repaired: boolean, repairs: Array<{ expr: string, claimed: number, actual: number }> }}
 */
export function verifyAndRepairMathClaims(text = '') { return { text: String(text || ''), repaired: false, repairs: [], verification: verifyArithmeticClaims(text) }; }

export function validateAndRepairCodeAndMath(text = '', options = {}) {
    let result = String(text || '');
    if (!result.trim()) return { text: result, modified: false, issues: [] };

    const issues = [];
    const isStreamingChunk = options?.isStreamingChunk === true;

    if (!isStreamingChunk) {
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
    }

    // 4. Broken JSON trailing commas in JSON code blocks
    result = result.replace(/(```(?:json)?\s*[\r\n]+[\s\S]*?)(,\s*[\r\n]+\s*([}\]]))([\s\S]*?```)/gi, (match, prefix, commaGroup, closingBrace, suffix) => {
        issues.push('json_trailing_comma_repaired');
        return prefix + '\n' + closingBrace + suffix;
    });

    // 5. Attach limited arithmetic verification without rewriting claims.
    const mathRepairResult = verifyAndRepairMathClaims(result);
    if (mathRepairResult.repaired) {
        result = mathRepairResult.text;
        issues.push('hallucinated_arithmetic_repaired');
    }

    return {
        text: result,
        modified: result !== String(text || ''),
        verification: mathRepairResult.verification,
        issues
    };
}

/**
 * StreamingSpeculativeGuard: Buffers token chunks along sentence & block boundaries,
 * repairing supported formatting before emitting to the SSE stream.
 * Arithmetic verification is metadata, not proof of complete answer correctness.
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

        // Ensure we do not split while inside an unclosed code block or display math block
        const codeFences = (this.buffer.match(/```/g) || []).length;
        const displayMath = (this.buffer.match(/\$\$/g) || []).length;
        if (codeFences % 2 !== 0 || displayMath % 2 !== 0) {
            // High-throughput streaming protection: If buffer inside unclosed block exceeds 200 chars,
            // stream out up to the latest newline to prevent SSE socket starvation and idle timeouts.
            if (this.buffer.length > 200) {
                const lastNl = this.buffer.lastIndexOf('\n');
                if (lastNl > 40) {
                    const toEmit = this.buffer.slice(0, lastNl + 1);
                    this.buffer = this.buffer.slice(lastNl + 1);
                    if (this.onVerifiedChunk) this.onVerifiedChunk(toEmit);
                    return toEmit;
                }
            }
            return '';
        }

        // Split buffer along safe sentence/paragraph delimiters
        const delimiterMatch = this.buffer.match(/^(.*?(?:[.!?]\s+|\n\n))([\s\S]*)$/);
        if (delimiterMatch && delimiterMatch[1]) {
            const sentenceToVerify = delimiterMatch[1];
            const remaining = delimiterMatch[2] || '';

            const repaired = validateAndRepairCodeAndMath(sentenceToVerify, { isStreamingChunk: true });
            this.buffer = remaining;
            const output = repaired.text;
            if (this.onVerifiedChunk) this.onVerifiedChunk(output);
            return output;
        }

        // Bound maximum buffer to prevent starvation on long non-punctuated lines (e.g. math derivations, list items)
        if (this.buffer.length > 180) {
            const lastNl = this.buffer.lastIndexOf('\n');
            if (lastNl > 30) {
                const slice = this.buffer.slice(0, lastNl + 1);
                this.buffer = this.buffer.slice(lastNl + 1);
                const repaired = validateAndRepairCodeAndMath(slice, { isStreamingChunk: true });
                const output = repaired.text;
                if (this.onVerifiedChunk) this.onVerifiedChunk(output);
                return output;
            }
        }

        return '';
    }

    /**
     * Flushes any remaining tokens in buffer at stream completion with full terminal validation.
     * @returns {string} Final verified trailing text.
     */
    flushRemaining() {
        if (!this.buffer) return '';
        const finalRepaired = validateAndRepairCodeAndMath(this.buffer);
        const remainingToEmit = finalRepaired.text;
        this.buffer = '';
        if (this.onVerifiedChunk && remainingToEmit) this.onVerifiedChunk(remainingToEmit);
        return remainingToEmit;
    }
}
