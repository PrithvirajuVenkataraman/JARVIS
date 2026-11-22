// A bounded expression parser: no eval, Function, property access, or user code.
export function evaluateArithmetic(expression) {
    let text = String(expression || '').trim();
    if (!text || text.length > 1000) return null;
    text = text.replace(/Math\./g, '').replace(/\\(?:left|right|,|!|;)/g, '').replace(/\\(?:times|cdot)|×/g, '*').replace(/\\div|÷/g, '/').replace(/\\([a-zA-Z]+)/g, '$1').replace(/\bof\b/gi, '*');
    const parts = text.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[a-zA-Z]+|[+\-*/^%(){},]/g);
    if (!parts || parts.length > 128 || parts.join('') !== text.replace(/\s/g, '')) return null;
    const functions = { sqrt: Math.sqrt, abs: Math.abs, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log, exp: Math.exp, logten: Math.log10 };
    const constants = { pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E };
    let at = 0, depth = 0;
    const group = () => {
        const open = parts[at++]; if (open !== '(' && open !== '{') throw new Error('Group required');
        const value = sum(); if (parts[at++] !== (open === '(' ? ')' : '}')) throw new Error('Unbalanced group'); return value;
    };
    const primary = () => {
        if (++depth > 32) throw new Error('Expression too deep');
        let value, token = parts[at];
        if (token === '(' || token === '{') value = group();
        else if (/^(?:\d|\.)/.test(token || '')) { at++; value = Number(token); }
        else if (Object.hasOwn(constants, token)) { at++; value = constants[token]; }
        else if (token === 'frac') { at++; value = group() / group(); }
        else if (Object.hasOwn(functions, token)) { at++; value = functions[token](group()); }
        else throw new Error('Unsupported expression');
        if (parts[at] === '%') { at++; value /= 100; }
        depth--; return value;
    };
    const power = () => { const left = primary(); if (parts[at] === '^' || parts[at] === '*' && parts[at + 1] === '*') { at += parts[at] === '^' ? 1 : 2; return left ** unary(); } return left; };
    const unary = () => { if (parts[at] === '+') { at++; return unary(); } if (parts[at] === '-') { at++; return -unary(); } return power(); };
    const product = () => {
        let value = unary();
        while (at < parts.length) {
            const op = parts[at];
            if (op === '*' && parts[at + 1] !== '*' || op === '/') { at++; const right = unary(); value = op === '*' ? value * right : value / right; }
            else if (op === '(' || op === '{' || Object.hasOwn(constants, op) || Object.hasOwn(functions, op)) value *= unary();
            else break;
        }
        return value;
    };
    const sum = () => { let value = product(); while (parts[at] === '+' || parts[at] === '-') { const op = parts[at++], right = product(); value = op === '+' ? value + right : value - right; } return value; };
    try { const result = sum(); return at === parts.length && Number.isFinite(result) && Math.abs(result) <= 1e100 ? result : null; } catch { return null; }
}

export function verifyArithmeticClaims(text) {
    const source = String(text || '').replace(/```[\s\S]*?(?:```|$)/g, '');
    const math = [...source.matchAll(/\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$|\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g)].map(match => match.slice(1).find(value => value !== undefined));
    const lines = source.split('\n').filter(line => !/[$]/.test(line));
    const checks = [];
    for (const raw of [...math, ...lines].slice(0, 128)) {
        const match = raw.trim().match(/^(.+?)\s*(=|≈|\\approx)\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(?:[.!])?$/);
        if (!match) continue;
        const actual = evaluateArithmetic(match[1]);
        if (actual === null) continue;
        const claimed = Number(match[3]); const tolerance = match[2] === '=' ? Math.max(1e-9, Math.abs(claimed) * 1e-9) : Math.max(0.015, Math.abs(claimed) * 0.005);
        checks.push({ kind: 'arithmetic', status: Math.abs(actual - claimed) <= tolerance ? 'passed' : 'failed' });
    }
    return { status: checks.some(check => check.status === 'failed') ? 'failed' : checks.length ? 'passed' : 'unavailable', checks, scope: 'Supported arithmetic equalities only; this is not a proof check.' };
}
