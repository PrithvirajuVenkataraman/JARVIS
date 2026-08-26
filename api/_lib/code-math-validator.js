/**
 * Fast Inline Code & Math Validator & Self-Correction Module
 * Validates markdown fences, syntax integrity, and LaTeX delimiters,
 * automatically applying instant sub-millisecond repairs.
 */

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

    return {
        text: result,
        modified: issues.length > 0,
        issues
    };
}
