function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function unescapeHtmlInMath(text) {
    return String(text || '')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<sup>(.*?)<\/sup>/gi, '^{$1}')
        .replace(/<sub>(.*?)<\/sub>/gi, '_{$1}')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
}

function extractBalancedBraces(str, startIndex) {
    let depth = 0;
    for (let i = startIndex; i < str.length; i++) {
        if (str[i] === '{') depth++;
        else if (str[i] === '}') {
            depth--;
            if (depth === 0) {
                return {
                    content: str.slice(startIndex + 1, i),
                    endIndex: i
                };
            }
        }
    }
    return null;
}

function replaceBalancedCommand(str, cmdName, replacer) {
    let result = '';
    let i = 0;
    const prefix = `\\${cmdName}`;

    while (i < str.length) {
        const nextIdx = str.indexOf(prefix, i);
        if (nextIdx === -1) {
            result += str.slice(i);
            break;
        }

        result += str.slice(i, nextIdx);
        let cursor = nextIdx + prefix.length;

        while (cursor < str.length && /\s/.test(str[cursor])) cursor++;

        if (cursor < str.length && str[cursor] === '{') {
            const balanced = extractBalancedBraces(str, cursor);
            if (balanced) {
                result += replacer(balanced.content);
                i = balanced.endIndex + 1;
                continue;
            }
        }

        result += prefix;
        i = nextIdx + prefix.length;
    }

    return result;
}

function replaceFractions(str) {
    let result = '';
    let i = 0;
    const prefixes = ['\\frac', '\\dfrac', '\\tfrac'];

    while (i < str.length) {
        let foundIdx = -1;
        let matchedPrefix = '';

        for (const p of prefixes) {
            const idx = str.indexOf(p, i);
            if (idx !== -1 && (foundIdx === -1 || idx < foundIdx)) {
                foundIdx = idx;
                matchedPrefix = p;
            }
        }

        if (foundIdx === -1) {
            result += str.slice(i);
            break;
        }

        result += str.slice(i, foundIdx);
        let cursor = foundIdx + matchedPrefix.length;
        while (cursor < str.length && /\s/.test(str[cursor])) cursor++;

        if (cursor < str.length && str[cursor] === '{') {
            const num = extractBalancedBraces(str, cursor);
            if (num) {
                let denomCursor = num.endIndex + 1;
                while (denomCursor < str.length && /\s/.test(str[denomCursor])) denomCursor++;
                if (denomCursor < str.length && str[denomCursor] === '{') {
                    const den = extractBalancedBraces(str, denomCursor);
                    if (den) {
                        result += `<span class="math-fraction"><span class="math-num">${formatLatexExpression(num.content, false)}</span><span class="math-den">${formatLatexExpression(den.content, false)}</span></span>`;
                        i = den.endIndex + 1;
                        continue;
                    }
                }
            }
        }

        result += matchedPrefix;
        i = foundIdx + matchedPrefix.length;
    }

    return result;
}

export function formatLatexExpression(expr = '', isDisplay = false) {
    let raw = String(expr || '').trim();
    if (!raw) return '';

    // Step 0: Unescape any HTML entities and strip unwanted tags from earlier pipeline steps
    let katexInput = unescapeHtmlInMath(raw).trim();

    // KaTeX normalization:
    // Convert top-level \begin{align} / \begin{align*} to \begin{aligned}
    katexInput = katexInput
        .replace(/\\begin\s*\{align\*?\}/g, '\\begin{aligned}')
        .replace(/\\end\s*\{align\*?\}/g, '\\end{aligned}')
        .replace(/\\begin\s*\{gather\*?\}/g, '\\begin{gathered}')
        .replace(/\\end\s*\{gather\*?\}/g, '\\end{gathered}')
        .replace(/\\begin\s*\{split\}/g, '\\begin{aligned}')
        .replace(/\\end\s*\{split\}/g, '\\end{aligned}');

    // Clean up unbalanced or dangling alignment tags that would make KaTeX fail
    if (katexInput.includes('\\end{aligned}') && !katexInput.includes('\\begin{aligned}')) {
        katexInput = katexInput.replace(/\\end\{aligned\}/g, '');
    }
    if (katexInput.includes('\\begin{aligned}') && !katexInput.includes('\\end{aligned}')) {
        katexInput = katexInput.replace(/\\begin\{aligned\}/g, '');
    }

    // Clean up \boxed{...} to inner expression for KaTeX to eliminate broken box outlines and enforce horizontal flow
    katexInput = replaceBalancedCommand(katexInput, 'boxed', inner => inner);

    const katex = globalThis.katex || (typeof window !== 'undefined' ? window.katex : null);
    if (katex && typeof katex.renderToString === 'function') {
        try {
            const rendered = katex.renderToString(katexInput, {
                displayMode: Boolean(isDisplay),
                throwOnError: false
            });
            if (rendered && !rendered.includes('katex-error')) {
                return rendered;
            }
        } catch (_) {}
    }

    // Fallback Pure-HTML Notebook Math Engine:
    raw = unescapeHtmlInMath(raw);

    // Multiline alignment environment: aligned, align, split, gather
    raw = raw.replace(/\\begin\s*\{(?:aligned|align\*?|split|gather\*?)\}([\s\S]*?)\\end\s*\{(?:aligned|align\*?|split|gather\*?)\}/g, (_, body) => {
        const rows = body.split(/\\\\|\\newline/g);
        const renderedRows = rows.map(row => {
            const trimmedRow = row.trim();
            if (!trimmedRow) return '';
            const cells = trimmedRow.split('&').map(cell => {
                return `<span class="math-align-cell">${formatLatexExpression(cell.trim(), false)}</span>`;
            });
            return `<div class="math-align-row">${cells.join('')}</div>`;
        }).filter(Boolean);
        return `<div class="math-aligned-block">${renderedRows.join('')}</div>`;
    });

    // Matrices: matrix, pmatrix, bmatrix, vmatrix, cases
    raw = raw.replace(/\\begin\s*\{(pmatrix|bmatrix|vmatrix|matrix|cases)\}([\s\S]*?)\\end\s*\{\1\}/g, (_, type, body) => {
        const rows = body.split(/\\\\|\\newline/g);
        const renderedRows = rows.map(row => {
            const trimmedRow = row.trim();
            if (!trimmedRow) return '';
            const cells = trimmedRow.split('&').map(cell => {
                return `<span class="math-align-cell">${formatLatexExpression(cell.trim(), false)}</span>`;
            });
            return `<div class="math-align-row">${cells.join('')}</div>`;
        }).filter(Boolean);

        let openDelim = '';
        let closeDelim = '';
        if (type === 'pmatrix') { openDelim = '<span class="math-delim">(</span>'; closeDelim = '<span class="math-delim">)</span>'; }
        else if (type === 'bmatrix') { openDelim = '<span class="math-delim">[</span>'; closeDelim = '<span class="math-delim">]</span>'; }
        else if (type === 'vmatrix') { openDelim = '<span class="math-delim">|</span>'; closeDelim = '<span class="math-delim">|</span>'; }
        else if (type === 'cases') { openDelim = '<span class="math-delim">{</span>'; closeDelim = ''; }

        return `<span class="math-matrix-wrap">${openDelim}<div class="math-aligned-block">${renderedRows.join('')}</div>${closeDelim}</span>`;
    });

    // Clean up any remaining dangling / orphaned alignment tags
    raw = raw.replace(/\\(?:begin|end)\s*\{(?:aligned|align\*?|split|gather\*?|cases|matrix|bmatrix|pmatrix|vmatrix)\}/g, '');

    // Boxed final answer (Notebook Highlight without enclosing box borders)
    raw = replaceBalancedCommand(raw, 'boxed', inner => {
        return `<span class="math-notebook-answer">${formatLatexExpression(inner, false)}</span>`;
    });

    // Fractions
    raw = replaceFractions(raw);

    // Binomial coefficients: \binom{n}{k}
    raw = replaceBalancedCommand(raw, 'binom', nStr => {
        return `(${formatLatexExpression(nStr, false)})`;
    });

    // Square roots
    raw = replaceBalancedCommand(raw, 'sqrt', inner => {
        return `<span class="math-sqrt">&radic;<span class="math-radicand">${formatLatexExpression(inner, false)}</span></span>`;
    });

    // Text / roman blocks
    for (const textCmd of ['text', 'mathrm', 'mathbf', 'mathit', 'textbf', 'textit']) {
        raw = replaceBalancedCommand(raw, textCmd, inner => {
            return `<span class="math-text">${escapeHtml(inner)}</span>`;
        });
    }

    // Calculus and Advanced Mathematical Operators
    raw = raw.replace(/\\iiint\b/g, '&int;&int;&int;');
    raw = raw.replace(/\\iint\b/g, '&int;&int;');
    raw = raw.replace(/\\oint\b/g, '&#8750;');
    raw = raw.replace(/\\int\b/g, '&int;');
    raw = raw.replace(/\\sum\b/g, '&sum;');
    raw = raw.replace(/\\coprod\b/g, '&#8720;');
    raw = raw.replace(/\\prod\b/g, '&prod;');
    raw = raw.replace(/\\lim\b/g, '<span class="math-op-lim">lim</span>');
    raw = raw.replace(/\\partial\b/g, '&part;');
    raw = raw.replace(/\\nabla\b/g, '&nabla;');

    // Arrows and Implications
    raw = raw.replace(/\\(?:rightarrow|longrightarrow|to)\b/g, '&rarr;');
    raw = raw.replace(/\\(?:leftarrow|longleftarrow)\b/g, '&larr;');
    raw = raw.replace(/\\(?:Leftarrow|Longleftarrow)\b/g, '&lArr;');
    raw = raw.replace(/\\(?:Rightarrow|Longrightarrow|implies)\b/g, '&rArr;');
    raw = raw.replace(/\\(?:leftrightarrow|longleftrightarrow|iff)\b/g, '&hArr;');

    // Set Theory and Logic
    raw = raw.replace(/\\forall\b/g, '&forall;');
    raw = raw.replace(/\\exists\b/g, '&exist;');
    raw = raw.replace(/\\nexists\b/g, '&#8708;');
    raw = raw.replace(/\\in\b/g, '&isin;');
    raw = raw.replace(/\\notin\b/g, '&notin;');
    raw = raw.replace(/\\subseteq\b/g, '&sube;');
    raw = raw.replace(/\\subset\b/g, '&sub;');
    raw = raw.replace(/\\supseteq\b/g, '&supe;');
    raw = raw.replace(/\\supset\b/g, '&sup;');
    raw = raw.replace(/\\cup\b/g, '&cup;');
    raw = raw.replace(/\\cap\b/g, '&cap;');
    raw = raw.replace(/\\setminus\b/g, '&#8726;');
    raw = raw.replace(/\\(?:land|wedge)\b/g, '&and;');
    raw = raw.replace(/\\(?:lor|vee)\b/g, '&or;');
    raw = raw.replace(/\\neg\b/g, '&not;');

    // Standard Operators & Relations
    raw = raw.replace(/\\approx\b/g, '&asymp;');
    raw = raw.replace(/\\times\b/g, '&times;');
    raw = raw.replace(/\\div\b/g, '&divide;');
    raw = raw.replace(/\\cdot\b/g, '&sdot;');
    raw = raw.replace(/\\pm\b/g, '&plusmn;');
    raw = raw.replace(/\\mp\b/g, '&#8723;');
    raw = raw.replace(/\\(?:le|leq)\b/g, '&le;');
    raw = raw.replace(/\\(?:ge|geq)\b/g, '&ge;');
    raw = raw.replace(/\\neq\b/g, '&ne;');
    raw = raw.replace(/\\equiv\b/g, '&equiv;');
    raw = raw.replace(/\\sim\b/g, '&sim;');
    raw = raw.replace(/\\propto\b/g, '&prop;');
    raw = raw.replace(/\\infty\b/g, '&infin;');
    raw = raw.replace(/\\(?:circ|degree)\b/g, '&deg;');

    // Common Functions with powers (e.g. \sec^2 x, \tan^2 x, \cos^2 x)
    raw = raw.replace(/\\(arcsin|arccos|arctan|sin|cos|tan|sec|csc|cot|ln|log)\^\{?([a-zA-Z0-9_+-]+)\}?/g, '<span class="math-func">$1</span><sup>$2</sup>');

    // Common Functions
    const mathFuncs = ['arcsin', 'arccos', 'arctan', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'ln', 'log', 'exp', 'det', 'max', 'min'];
    for (const fn of mathFuncs) {
        const fnRegex = new RegExp(`\\\\${fn}\\b`, 'g');
        raw = raw.replace(fnRegex, `<span class="math-func">${fn}</span>`);
    }

    // Greek letters (lowercase)
    raw = raw.replace(/\\alpha\b/g, '&alpha;');
    raw = raw.replace(/\\beta\b/g, '&beta;');
    raw = raw.replace(/\\gamma\b/g, '&gamma;');
    raw = raw.replace(/\\delta\b/g, '&delta;');
    raw = raw.replace(/\\epsilon\b/g, '&epsilon;');
    raw = raw.replace(/\\zeta\b/g, '&zeta;');
    raw = raw.replace(/\\eta\b/g, '&eta;');
    raw = raw.replace(/\\theta\b/g, '&theta;');
    raw = raw.replace(/\\iota\b/g, '&iota;');
    raw = raw.replace(/\\kappa\b/g, '&kappa;');
    raw = raw.replace(/\\lambda\b/g, '&lambda;');
    raw = raw.replace(/\\mu\b/g, '&mu;');
    raw = raw.replace(/\\nu\b/g, '&nu;');
    raw = raw.replace(/\\xi\b/g, '&xi;');
    raw = raw.replace(/\\pi\b/g, '&pi;');
    raw = raw.replace(/\\rho\b/g, '&rho;');
    raw = raw.replace(/\\sigma\b/g, '&sigma;');
    raw = raw.replace(/\\tau\b/g, '&tau;');
    raw = raw.replace(/\\upsilon\b/g, '&upsilon;');
    raw = raw.replace(/\\phi\b/g, '&phi;');
    raw = raw.replace(/\\chi\b/g, '&chi;');
    raw = raw.replace(/\\psi\b/g, '&psi;');
    raw = raw.replace(/\\omega\b/g, '&omega;');

    // Greek letters (uppercase)
    raw = raw.replace(/\\Gamma\b/g, '&Gamma;');
    raw = raw.replace(/\\Delta\b/g, '&Delta;');
    raw = raw.replace(/\\Theta\b/g, '&Theta;');
    raw = raw.replace(/\\Lambda\b/g, '&Lambda;');
    raw = raw.replace(/\\Xi\b/g, '&Xi;');
    raw = raw.replace(/\\Pi\b/g, '&Pi;');
    raw = raw.replace(/\\Sigma\b/g, '&Sigma;');
    raw = raw.replace(/\\Upsilon\b/g, '&Upsilon;');
    raw = raw.replace(/\\Phi\b/g, '&Phi;');
    raw = raw.replace(/\\Psi\b/g, '&Psi;');
    raw = raw.replace(/\\Omega\b/g, '&Omega;');

    // Mathematical spacing
    raw = raw.replace(/\\qquad\b/g, '<span class="math-space-qquad">&emsp;&emsp;&emsp;&emsp;</span>');
    raw = raw.replace(/\\quad\b/g, '<span class="math-space-quad">&emsp;&emsp;</span>');
    raw = raw.replace(/\\;/g, '<span class="math-space-med">&emsp;</span>');
    raw = raw.replace(/\\,/g, '<span class="math-space-thin">&thinsp;</span>');
    raw = raw.replace(/\\!/g, '');

    // Sizing delimiters
    raw = raw.replace(/\\left\s*([(\[{|])/g, '$1');
    raw = raw.replace(/\\right\s*([)\]}|])/g, '$1');
    raw = raw.replace(/\\(?:left|right)\s*\./g, '');

    // Superscripts and subscripts
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^\(([^()]+)\)/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^([a-zA-Z0-9_+-]+)/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_\{([^{}]+)\}/g, '$1<sub>$2</sub>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_\(([^()]+)\)/g, '$1<sub>$2</sub>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_([a-zA-Z0-9_+-]+)/g, '$1<sub>$2</sub>');

    return raw;
}

export function formatInlineMathPowers(text = '') {
    let raw = String(text || '');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^\{([^{}]+)\}/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^\(([^()]+)\)/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])\^([a-zA-Z0-9_+-]+)/g, '$1<sup>$2</sup>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_\{([^{}]+)\}/g, '$1<sub>$2</sub>');
    raw = raw.replace(/([a-zA-Z0-9_\)\]\}])_\(([^()]+)\)/g, '$1<sub>$2</sub>');
    return raw;
}

export function renderMathInText(text = '') {
    let raw = String(text || '');
    if (!raw) return '';

    // Protect currency tokens so amounts like $50, $12.99, $1,000, $5k, $100M, $10/month are never treated as math delimiters
    const currencyTokens = [];
    raw = raw.replace(/(?<!\w)\$(\d+(?:,\d{3})*(?:\.\d+)?(?:\s*(?:k|m|b|trillion|million|billion|usd|dollars?|cents?|per|\/))?)(?!\w)/gi, (m) => {
        const idx = currencyTokens.length;
        currencyTokens.push(m);
        return `__CURRENCY_HOLD_${idx}__`;
    });

    // Display math: $$ ... $$ and \[ ... \]
    raw = raw.replace(/(?<!\\)\$\$([\s\S]+?)(?<!\\)\$\$/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });

    // Inline math: \( ... \)
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math, false)}</span>`;
    });

    // Inline math: $ ... $
    raw = raw.replace(/(?<!\\)\$(?!\$)([^\$\n]+?)(?<!\\)\$/g, (_, math) => {
        const trimmed = math.trim();
        if (!trimmed) return '$';
        return `<span class="math-inline">${formatLatexExpression(trimmed, false)}</span>`;
    });

    // Intercept bare un-delimited LaTeX \text{...} or {\text{...}} blocks
    raw = raw.replace(/\{?\\text\{([^}]+)\}\}?/g, (_, inner) => {
        return `<span class="math-text">${escapeHtml(inner)}</span>`;
    });
    raw = raw.replace(/([a-zA-Z]\([a-zA-Z0-9_,+-]+\))_\{?\\?text\{([^}]+)\}\}?/g, '$1<sub>$2</sub>');

    raw = formatInlineMathPowers(raw);

    // Restore protected currency tokens
    raw = raw.replace(/__CURRENCY_HOLD_(\d+)__/g, (_, idx) => currencyTokens[Number(idx)] || '$');

    return raw;
}
