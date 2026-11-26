import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { renderMathInText } from '../app/math-renderer.js';
import { renderMarkdown, balanceDelimitersForStreaming } from '../app/markdown-renderer.js';

// Exercise the same bundled engine as the browser, including its MathML and SVG output.
const context = vm.createContext({});
vm.runInContext(readFileSync(new URL('../katex.min.js', import.meta.url), 'utf8'), context);
globalThis.katex = context.katex;

test('blank lines separate Markdown blocks without adding extra visual lines', () => {
    const rendered = renderMarkdown('## Heading\n\nFirst line\nSecond line\n\n\n- First item\n- Second item\n\n> A quote.');
    assert.match(rendered, /First line<br>Second line/);
    assert.equal((rendered.match(/<br>/g) || []).length, 1, 'Only the explicit line break inside the paragraph should remain');
    assert.match(rendered, /<h3[^>]*>Heading<\/h3>/);
    assert.match(rendered, /<ul[^>]*>/);
    assert.match(rendered, /<blockquote[^>]*>/);
});

test('inline equations preserve the complete KaTeX output through Markdown formatting', () => {
    for (const expression of [
        String.raw`x_i^2 + y_j^2 = z_k^2`,
        String.raw`\sqrt{\tan x}`,
        String.raw`\text{net\_income} = a_1 * b_2`,
        String.raw`\frac{1}{2} + \text{[1]}`,
        String.raw`\begin{pmatrix}1 & 2 \\ 3 & 4\end{pmatrix}`,
        String.raw`2 + 2 = 4`
    ]) {
        const rendered = renderMarkdown(`Let $${expression}$ be the expression.`);
        const expected = context.katex.renderToString(expression, { displayMode: false, throwOnError: false });
        assert.ok(rendered.includes(expected), `KaTeX markup was rewritten for ${expression}`);
        assert.ok(!rendered.includes('@@JARVIS_'), 'No math placeholders should leak');
    }
});

test('renderMathInText does not rewrite annotations or reparse generated math', () => {
    const expression = String.raw`x_1^2 + \text{cost: \$50}`;
    const expected = context.katex.renderToString(expression, { displayMode: false, throwOnError: false });
    assert.equal(renderMathInText(`\\(${expression}\\)`), `<span class="math-inline">${expected}</span>`);
});

test('display integrals, nested fractions, alignments and matrices use the bundled engine', () => {
    for (const expression of [
        String.raw`\int \sqrt{\tan x}\,dx`,
        String.raw`\frac{1}{\sqrt{2}}\ln\left|\frac{t^2-\sqrt{2}t+1}{t^2+\sqrt{2}t+1}\right| + C`,
        String.raw`\begin{aligned}t &= \sqrt{\tan x} \\ dx &= \frac{2t}{1+t^4}\,dt\end{aligned}`,
        String.raw`\begin{pmatrix}a & b \\ c & d\end{pmatrix}`
    ]) {
        const rendered = renderMarkdown(`Before.\n\n$$${expression}$$\n\nAfter.`);
        const expected = context.katex.renderToString(expression, { displayMode: true, throwOnError: false });
        assert.ok(rendered.includes(expected), `Display output was rewritten for ${expression}`);
        assert.ok(!rendered.includes('katex-error'));
        assert.ok(!rendered.includes('<p class="assistant-md-p"><div class="math-display-block">'));
    }
});

test('currency, code and surrounding Markdown retain their formatting', () => {
    const rendered = renderMarkdown('Price: $50 each and $12.99 monthly. **Use** $x_1^2$ with `user_id`.\n\n```js\nconst price = "$50";\n```');
    assert.ok(rendered.includes('$50 each and $12.99 monthly'));
    assert.ok(rendered.includes('<strong>Use</strong>'));
    assert.ok(rendered.includes('<code class="assistant-md-inline-code">user_id</code>'));
    assert.ok(rendered.includes('assistant-md-code-block'));
});

test('streaming balances real equations without adding dollars after prices or display math', () => {
    for (const source of [
        'The price is $50 each.',
        'Let $t = x^2$. The price is $50 each.',
        '$$x^2$$',
        String.raw`Let \(x_1^2 + \text{cost: \$50}\) be the expression.`,
        '```js\nconst price = "$50";\n```',
        '```python\narr = "\\[x\\]"\n```\nDone.'
    ]) assert.equal(balanceDelimitersForStreaming(source), source);
    assert.equal(balanceDelimitersForStreaming('Let $x^2'), 'Let $x^2$');
    assert.equal(balanceDelimitersForStreaming('Let $2 + 2 = 4'), 'Let $2 + 2 = 4$');
    const strayCloseRendered = renderMarkdown('Running this code returns the solutions.\n\\]\n\\]\n\\]');
    assert.ok(!strayCloseRendered.includes('\\]'), 'Orphan \\] lines outside code/math must be stripped');
});

test('inline bold stays scoped within blocks and avoids literal ** corruption', () => {
    const bleedRendered = renderMarkdown('**First unclosed heading\n\nSecond**: normal paragraph with **Winner**.');
    assert.match(bleedRendered, /First unclosed heading<\/p>/);
    assert.ok(!bleedRendered.includes('<strong>First unclosed heading</p>'), 'Bold must never span across paragraph tags');
    assert.ok(!bleedRendered.includes('Second**'), 'Dangling ** tokens must not render literally');
    assert.match(bleedRendered, /<strong>Winner<\/strong>/);

    const mixedRendered = renderMarkdown('**Composer A (*Film One*)**: score details.\n**Composer B**: *Film Two* and x**2.');
    assert.match(mixedRendered, /<strong>Composer A \(<em>Film One<\/em>\)<\/strong>: score details\./);
    assert.match(mixedRendered, /<strong>Composer B<\/strong>: <em>Film Two<\/em> and x\*\*2\./);
});
