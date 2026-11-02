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
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
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
    const prefix = '\\frac';

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

        result += prefix;
        i = nextIdx + prefix.length;
    }

    return result;
}

export function formatLatexExpression(expr = '', isDisplay = false) {
    let raw = String(expr || '').trim();
    if (!raw) return '';

    // Step 0: Unescape any HTML entities from earlier pipeline escaping so LaTeX parsers don't choke on &amp;
    const katexInput = unescapeHtmlInMath(raw);

    const katex = globalThis.katex || (typeof window !== 'undefined' ? window.katex : null);
    if (katex && typeof katex.renderToString === 'function') {
        try {
            let sanitized = katexInput;
            // Clean up unbalanced or dangling alignment tags that would make KaTeX fail
            if (sanitized.includes('\\end{aligned}') && !sanitized.includes('\\begin{aligned}')) {
                sanitized = sanitized.replace(/\\end\{aligned\}/g, '');
            }
            if (sanitized.includes('\\begin{aligned}') && !sanitized.includes('\\end{aligned}')) {
                sanitized = sanitized.replace(/\\begin\{aligned\}/g, '');
            }
            const rendered = katex.renderToString(sanitized, {
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

    // Multiline alignment environment
    raw = raw.replace(/\\begin\s*\{(?:aligned|align|split|gather)\}([\s\S]*?)\\end\s*\{(?:aligned|align|split|gather)\}/g, (_, body) => {
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

    // Clean up any remaining dangling / orphaned alignment tags
    raw = raw.replace(/\\(?:begin|end)\s*\{(?:aligned|align|split|gather|cases|matrix|bmatrix|pmatrix)\}/g, '');

    // Boxed final answer (Notebook Highlight)
    raw = replaceBalancedCommand(raw, 'boxed', inner => {
        return `<span class="math-notebook-answer">${formatLatexExpression(inner, false)}</span>`;
    });

    // Fractions
    raw = replaceFractions(raw);

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

    // Mathematical operators & relations
    raw = raw.replace(/\\approx\b/g, '&asymp;');
    raw = raw.replace(/\\times\b/g, '&times;');
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
    raw = raw.replace(/\\circ\b/g, '&deg;');

    // Greek letters
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
    raw = raw.replace(/\\Gamma\b/g, '&Gamma;');
    raw = raw.replace(/\\Delta\b/g, '&Delta;');
    raw = raw.replace(/\\Theta\b/g, '&Theta;');
    raw = raw.replace(/\\Lambda\b/g, '&Lambda;');
    raw = raw.replace(/\\Sigma\b/g, '&Sigma;');
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

    // Display math: $$ ... $$ and \[ ... \]
    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });

    // Inline math: $ ... $ and \( ... \)
    raw = raw.replace(/(?<!\\)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\d)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math, false)}</span>`;
    });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math, false)}</span>`;
    });

    raw = formatInlineMathPowers(raw);

    return raw;
}
