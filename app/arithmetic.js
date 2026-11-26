// Bounded expression evaluator shared by the browser tool dispatcher.
// No eval, Function, property access, or arbitrary code execution.
export function evaluateArithmetic(expression) {
    let text = String(expression || '').trim();
    if (!text || text.length > 1000) return null;
    text = text
        .replace(/Math\./g, '')
        .replace(/\\(?:left|right|,|!|;)/g, '')
        .replace(/\\(?:times|cdot)|×/g, '*')
        .replace(/\\div|÷/g, '/')
        .replace(/\\([a-zA-Z]+)/g, '$1')
        .replace(/\bof\b/gi, '*');
    const parts = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z]+|[+\-*/^%(){},]/g);
    if (!parts || parts.length > 128 || parts.join('') !== text.replace(/\s/g, '')) return null;
    const functions = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log, exp: Math.exp, logten: Math.log10 };
    const constants = { pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E };
    let at = 0;
    let depth = 0;
    const group = () => {
        const open = parts[at++];
        if (open !== '(' && open !== '{') throw new Error('Group required');
        const value = sum();
        if (parts[at++] !== (open === '(' ? ')' : '}')) throw new Error('Unbalanced group');
        return value;
    };
    const primary = () => {
        if (++depth > 32) throw new Error('Expression too deep');
        let value;
        const token = parts[at];
        if (token === '(' || token === '{') value = group();
        else if (/^(?:\d|\.)/.test(token || '')) { at++; value = Number(token); }
        else if (Object.hasOwn(constants, token)) { at++; value = constants[token]; }
        else if (token === 'frac') { at++; value = group() / group(); }
        else if (Object.hasOwn(functions, token)) { at++; value = functions[token](group()); }
        else throw new Error('Unsupported expression');
        if (parts[at] === '%') { at++; value /= 100; }
        depth--;
        return value;
    };
    const power = () => {
        const left = primary();
        if (parts[at] === '^' || (parts[at] === '*' && parts[at + 1] === '*')) {
            at += parts[at] === '^' ? 1 : 2;
            return left ** unary();
        }
        return left;
    };
    const unary = () => {
        if (parts[at] === '+') { at++; return unary(); }
        if (parts[at] === '-') { at++; return -unary(); }
        return power();
    };
    const product = () => {
        let value = unary();
        while (at < parts.length) {
            const op = parts[at];
            if ((op === '*' && parts[at + 1] !== '*') || op === '/') {
                at++;
                const right = unary();
                value = op === '*' ? value * right : value / right;
            } else if (op === '(' || op === '{' || Object.hasOwn(constants, op) || Object.hasOwn(functions, op)) {
                value *= unary();
            } else {
                break;
            }
        }
        return value;
    };
    const sum = () => {
        let value = product();
        while (parts[at] === '+' || parts[at] === '-') {
            const op = parts[at++];
            const right = product();
            value = op === '+' ? value + right : value - right;
        }
        return value;
    };
    try {
        const result = sum();
        return at === parts.length && Number.isFinite(result) && Math.abs(result) <= 1e100 ? result : null;
    } catch {
        return null;
    }
}
