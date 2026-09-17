function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function formatLatexExpression(expr = '', isDisplay = false) {
    let raw = String(expr || '').trim();
    if (!raw) return '';

    const katex = globalThis.katex || (typeof window !== 'undefined' ? window.katex : null);
    if (katex && typeof katex.renderToString === 'function') {
        try {
            return katex.renderToString(raw, {
                displayMode: Boolean(isDisplay),
                throwOnError: false
            });
        } catch (_) {}
    }

    raw = raw.replace(/\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}/g, (_, num, den) => {
        return `<span class="math-fraction"><span class="math-num">${formatLatexExpression(num)}</span><span class="math-den">${formatLatexExpression(den)}</span></span>`;
    });

    raw = raw.replace(/\\sqrt\s*\{([^{}]+)\}/g, (_, inner) => {
        return `<span class="math-sqrt">&radic;<span class="math-radicand">${formatLatexExpression(inner)}</span></span>`;
    });

    raw = raw.replace(/\\(?:text|mathrm|mathbf)\s*\{([^{}]+)\}/g, (_, text) => {
        return `<span class="math-text">${escapeHtml(text)}</span>`;
    });

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

    raw = raw.replace(/\$\$([\s\S]+?)\$\$/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });
    raw = raw.replace(/\\\[([\s\S]+?)\\\]/g, (_, math) => {
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(math, true)}</span></div>`;
    });

    raw = raw.replace(/(?<!\\)\$(?!\s)([^\$\n]+?)(?<!\s)\$(?!\d)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math, false)}</span>`;
    });
    raw = raw.replace(/\\\(([\s\S]+?)\\\)/g, (_, math) => {
        return `<span class="math-inline">${formatLatexExpression(math, false)}</span>`;
    });

    raw = formatInlineMathPowers(raw);

    return raw;
}
