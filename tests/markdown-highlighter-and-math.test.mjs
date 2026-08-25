import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { highlightCode, normalizeLang } from '../app/code-highlighter.js';
import { renderMathInText, formatLatexExpression } from '../app/math-renderer.js';
import { renderMarkdown } from '../app/markdown-renderer.js';

describe('Markdown Renderer, Code Syntax Highlighter & Math Suite', () => {
    describe('1. Syntax Highlighter', () => {
        it('1.1 Tokenizes JavaScript keywords, functions, and string literals', () => {
            const code = 'async function getData(url) {\n  const res = await fetch(url);\n  return res.json();\n}';
            const highlighted = highlightCode(code, 'javascript');
            assert.ok(highlighted.includes('<span class="tok-kw">async</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">function</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">const</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">await</span>'));
            assert.ok(highlighted.includes('<span class="tok-fn">getData</span>'));
            assert.ok(highlighted.includes('<span class="tok-fn">fetch</span>'));
        });

        it('1.2 Tokenizes Python def, class, comments, and numbers', () => {
            const pyCode = '# Calculate total\ndef calculate(n: int) -> float:\n    total = 42.5\n    return total * n';
            const highlighted = highlightCode(pyCode, 'python');
            assert.ok(highlighted.includes('<span class="tok-comm"># Calculate total</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">def</span>'));
            assert.ok(highlighted.includes('<span class="tok-fn">calculate</span>'));
            assert.ok(highlighted.includes('<span class="tok-num">42.5</span>'));
        });

        it('1.3 Tokenizes SQL keywords case-insensitively', () => {
            const sql = 'SELECT id, name FROM users WHERE age >= 21;';
            const highlighted = highlightCode(sql, 'sql');
            assert.ok(highlighted.includes('<span class="tok-kw">SELECT</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">FROM</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">WHERE</span>'));
            assert.ok(highlighted.includes('<span class="tok-num">21</span>'));
        });

        it('1.4 Tokenizes JSON keys, values, numbers, and booleans', () => {
            const json = '{\n  "status": "success",\n  "count": 10,\n  "active": true\n}';
            const highlighted = highlightCode(json, 'json');
            assert.ok(highlighted.includes('<span class="tok-kw">&quot;status&quot;</span>'));
            assert.ok(highlighted.includes('<span class="tok-str">&quot;success&quot;</span>'));
            assert.ok(highlighted.includes('<span class="tok-num">10</span>'));
            assert.ok(highlighted.includes('<span class="tok-kw">true</span>'));
        });
    });

    describe('2. LaTeX Math Formatter', () => {
        it('2.1 Formats inline math and exponents', () => {
            const text = 'The mass-energy equivalence is $E = mc^2$.';
            const rendered = renderMathInText(text);
            assert.ok(rendered.includes('<span class="math-inline">E = mc<sup>2</sup></span>'));
        });

        it('2.2 Formats display math with Greek letters and fractions', () => {
            const text = '$$\\frac{\\alpha + \\beta}{2} = \\pi$$';
            const rendered = renderMathInText(text);
            assert.ok(rendered.includes('<div class="math-display-block">'));
            assert.ok(rendered.includes('<span class="math-fraction">'));
            assert.ok(rendered.includes('α'));
            assert.ok(rendered.includes('β'));
            assert.ok(rendered.includes('π'));
        });

        it('2.3 Formats square roots and subscripts', () => {
            const expr = '\\sqrt{x_1 + x_2}';
            const formatted = formatLatexExpression(expr);
            assert.ok(formatted.includes('<span class="math-sqrt">'));
            assert.ok(formatted.includes('x<sub>1</sub>'));
            assert.ok(formatted.includes('x<sub>2</sub>'));
        });
    });

    describe('3. Unified Markdown Renderer', () => {
        it('3.1 Renders markdown with embedded syntax-highlighted code block and math', () => {
            const markdown = `# Quantum Mechanics
Einstein established that $E = mc^2$.

Here is Python code:
\`\`\`python
def energy(m):
    c = 3e8
    return m * c**2
\`\`\`

| Symbol | Meaning |
|---|---|
| E | Energy |
| m | Mass |
`;
            const html = renderMarkdown(markdown);
            assert.ok(html.includes('<h2 class="assistant-md-heading">Quantum Mechanics</h2>'));
            assert.ok(html.includes('<span class="math-inline">E = mc<sup>2</sup></span>'));
            assert.ok(html.includes('assistant-md-code-container'));
            assert.ok(html.includes('PYTHON'));
            assert.ok(html.includes('<span class="tok-kw">def</span>'));
            assert.ok(html.includes('<table class="assistant-md-table">'));
        });
    });
});
