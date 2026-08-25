/**
 * Pure lightweight LaTeX math formula formatter for JARVIS.
 * Formats inline math ($...$, \(...\)) and display math ($$...$$, \[...\]).
 */

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const GREEK_SYMBOLS = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π',
    rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ',
    chi: 'χ', psi: 'ψ', omega: 'ω',
    Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε',
    Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ',
    Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω'
};

const MATH_OPERATORS = {
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·',
    approx: '≈', neq: '≠', ne: '≠', leq: '≤', le: '≤',
    geq: '≥', ge: '≥', infty: '∞', to: '→', leftarrow: '←',
    rightarrow: '→', Leftarrow: '⇐', Rightarrow: '⇒',
    sum: '∑', prod: '∏', int: '∫', partial: '∂', nabla: '∇',
    forall: '∀', exists: '∃', subset: '⊂', supset: '⊃',
    cup: '∪', cap: '∩', emptyset: '∅'
};

export function formatLatexExpression(expr = '') {
    let raw = String(expr || '').trim();

    // Replace fractions \frac{a}{b} -> (a / b) with visual fraction styling
    raw = raw.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_, num, den) => {
        return `<span class="math-fraction"><span class="math-num">${formatLatexExpression(num)}</span><span class="math-den">${formatLatexExpression(den)}</span></span>`;
    });

    // Replace square roots \sqrt{x}
    raw = raw.replace(/\\sqrt\s*\{([^{}]+)\}/g, (_, inner) => {
        return `<span class="math-sqrt">&radic;<span class="math-radicand">${formatLatexExpression(inner)}</span></span>`;
    });

    // Replace \text{...} or \mathrm{...}
    raw = raw.replace(/\\(?:text|mathrm|mathbf)\s*\{([^{}]+)\}/g, (_, text) => {
        return `<span class="math-text">${escapeHtml(text)}</span>`;
    });

    // Replace Greek letters \alpha -> α
    raw = raw.replace(/\\([a-zA-Z]+)/g, (match, name) => {
        if (GREEK_SYMBOLS[name]) return GREEK_SYMBOLS[name];
        if (MATH_OPERATORS[name]) return MATH_OPERATORS[name];
        return match;
    });

    // Subscripts and superscripts x_{i+1} or x^2
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^([a-zA-Z0-9])/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_\{([^{}]+)\}/g, '$1<sub>$2</sub>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_([a-zA-Z0-9])/g, '$1<sub>$2</sub>');

    return raw;
}

export function renderMathInText(text = '') {
    let raw = String(text || '');

    // Display math: $$...$$ or \[...\]
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math)}</span></div>`;
    });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math)}</span></div>`;
    });

    // Inline math: $...$ or \(...\)
    raw = raw.replace(/\$([^\$\n]+?)\$/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math)}</span>`;
    });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math)}</span>`;
    });

    return raw;
}
