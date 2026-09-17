/**
 * Pure, lightweight syntax highlighter for code snippets in JARVIS.
 * Supports JavaScript/TypeScript, Python, HTML/CSS, JSON, SQL, Bash/Shell, Rust, Go, C/C++.
 */

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

const KEYWORDS_BY_LANG = {
    js: new Set([
        'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
        'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for', 'function',
        'if', 'import', 'in', 'instanceof', 'new', 'return', 'super', 'switch', 'this', 'throw',
        'try', 'typeof', 'var', 'void', 'while', 'with', 'yield', 'let', 'static', 'enum',
        'interface', 'implements', 'package', 'private', 'protected', 'public', 'type', 'from', 'as'
    ]),
    py: new Set([
        'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del',
        'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in',
        'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while',
        'with', 'yield', 'self', 'cls', 'None', 'True', 'False'
    ]),
    sql: new Set([
        'select', 'from', 'where', 'insert', 'update', 'delete', 'join', 'left', 'right',
        'inner', 'outer', 'full', 'group', 'by', 'order', 'having', 'limit', 'offset',
        'create', 'table', 'drop', 'alter', 'index', 'view', 'into', 'values', 'set',
        'as', 'on', 'distinct', 'union', 'all', 'case', 'when', 'then', 'else', 'end',
        'and', 'or', 'not', 'null', 'is', 'like', 'in', 'between', 'exists', 'primary', 'key'
    ]),
    bash: new Set([
        'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'in', 'do', 'done', 'case',
        'esac', 'function', 'return', 'exit', 'export', 'local', 'echo', 'cd', 'mkdir',
        'rm', 'cp', 'mv', 'cat', 'grep', 'sed', 'awk', 'curl', 'wget', 'sudo', 'chmod', 'chown'
    ]),
    rust: new Set([
        'as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false',
        'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut',
        'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait',
        'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn'
    ]),
    go: new Set([
        'break', 'default', 'func', 'interface', 'select', 'case', 'defer', 'go', 'map',
        'struct', 'chan', 'else', 'goto', 'package', 'switch', 'const', 'fallthrough',
        'if', 'range', 'type', 'continue', 'for', 'import', 'return', 'var', 'nil', 'true', 'false'
    ]),
    cpp: new Set([
        'alignas', 'alignof', 'and', 'and_eq', 'asm', 'auto', 'bitand', 'bitor', 'bool',
        'break', 'case', 'catch', 'char', 'char16_t', 'char32_t', 'class', 'compl', 'const',
        'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double',
        'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for',
        'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept',
        'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'private', 'protected', 'public',
        'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof', 'static',
        'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local',
        'throw', 'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using',
        'virtual', 'void', 'volatile', 'wchar_t', 'while', 'xor', 'xor_eq'
    ])
};

export function normalizeLang(lang = '') {
    const raw = String(lang || '').toLowerCase().trim();
    if (/^(js|javascript|jsx|mjs|cjs)$/.test(raw)) return 'js';
    if (/^(ts|typescript|tsx)$/.test(raw)) return 'js';
    if (/^(py|python|py3)$/.test(raw)) return 'py';
    if (/^(sql|pgsql|mysql|sqlite)$/.test(raw)) return 'sql';
    if (/^(bash|sh|shell|zsh)$/.test(raw)) return 'bash';
    if (/^(json)$/.test(raw)) return 'json';
    if (/^(html|xml|svg)$/.test(raw)) return 'html';
    if (/^(css|scss|sass|less)$/.test(raw)) return 'css';
    if (/^(rs|rust)$/.test(raw)) return 'rust';
    if (/^(go|golang)$/.test(raw)) return 'go';
    if (/^(c|cpp|c\+\+|h|hpp)$/.test(raw)) return 'cpp';
    return raw || 'text';
}

export function highlightCode(code = '', lang = 'text') {
    const normalized = normalizeLang(lang);
    const rawCode = String(code || '');

    if (normalized === 'json') {
        return highlightJson(rawCode);
    }
    if (normalized === 'html') {
        return highlightHtml(rawCode);
    }

    const keywords = KEYWORDS_BY_LANG[normalized] || KEYWORDS_BY_LANG.js;
    const isCaseInsensitive = normalized === 'sql';

    let html = '';
    let i = 0;
    const len = rawCode.length;

    while (i < len) {
        // Single-line comment // or # or --
        if (
            (rawCode[i] === '/' && rawCode[i + 1] === '/') ||
            (rawCode[i] === '#' && (normalized === 'py' || normalized === 'bash')) ||
            (rawCode[i] === '-' && rawCode[i + 1] === '-' && normalized === 'sql')
        ) {
            let end = rawCode.indexOf('\n', i);
            if (end === -1) end = len;
            const comment = rawCode.slice(i, end);
            html += `<span class="tok-comm">${escapeHtml(comment)}</span>`;
            i = end;
            continue;
        }

        // Multi-line comment /* ... */ or """ ... """
        if (rawCode[i] === '/' && rawCode[i + 1] === '*') {
            let end = rawCode.indexOf('*/', i + 2);
            if (end === -1) end = len;
            else end += 2;
            const comment = rawCode.slice(i, end);
            html += `<span class="tok-comm">${escapeHtml(comment)}</span>`;
            i = end;
            continue;
        }
        if (normalized === 'py' && (rawCode.startsWith('"""', i) || rawCode.startsWith("'''", i))) {
            const quote = rawCode.slice(i, i + 3);
            let end = rawCode.indexOf(quote, i + 3);
            if (end === -1) end = len;
            else end += 3;
            const str = rawCode.slice(i, end);
            html += `<span class="tok-str">${escapeHtml(str)}</span>`;
            i = end;
            continue;
        }

        // String literals ("...", '...', `...`)
        if (rawCode[i] === '"' || rawCode[i] === "'" || rawCode[i] === '`') {
            const quote = rawCode[i];
            let j = i + 1;
            let str = quote;
            while (j < len) {
                if (rawCode[j] === '\\' && j + 1 < len) {
                    str += rawCode[j] + rawCode[j + 1];
                    j += 2;
                    continue;
                }
                str += rawCode[j];
                if (rawCode[j] === quote) {
                    j += 1;
                    break;
                }
                j += 1;
            }
            html += `<span class="tok-str">${escapeHtml(str)}</span>`;
            i = j;
            continue;
        }

        // Numbers (integers, floats, hex, bin)
        if (/\d/.test(rawCode[i]) && (i === 0 || /[\s,()[\{=+\-*/<>&|:;]/.test(rawCode[i - 1]))) {
            let j = i;
            while (j < len && /[\d.a-fA-FxX_]/.test(rawCode[j])) {
                j += 1;
            }
            const num = rawCode.slice(i, j);
            html += `<span class="tok-num">${escapeHtml(num)}</span>`;
            i = j;
            continue;
        }

        // Words / Identifiers / Keywords
        if (/[a-zA-Z_$]/.test(rawCode[i])) {
            let j = i;
            while (j < len && /[a-zA-Z0-9_$]/.test(rawCode[j])) {
                j += 1;
            }
            const word = rawCode.slice(i, j);
            const lookup = isCaseInsensitive ? word.toLowerCase() : word;

            if (keywords.has(lookup)) {
                html += `<span class="tok-kw">${escapeHtml(word)}</span>`;
            } else if (rawCode[j] === '(') {
                html += `<span class="tok-fn">${escapeHtml(word)}</span>`;
            } else if (/^[A-Z][a-zA-Z0-9_]*$/.test(word) && (normalized === 'js' || normalized === 'py' || normalized === 'rust' || normalized === 'cpp')) {
                html += `<span class="tok-type">${escapeHtml(word)}</span>`;
            } else {
                html += escapeHtml(word);
            }
            i = j;
            continue;
        }

        // Special symbols and punctuation
        html += escapeHtml(rawCode[i]);
        i += 1;
    }

    return html;
}

function highlightJson(code = '') {
    return escapeHtml(code)
        .replace(/(&quot;[^&]+&quot;)(\s*:)/g, '<span class="tok-kw">$1</span>$2')
        .replace(/:\s*(&quot;[^&]*&quot;)/g, ': <span class="tok-str">$1</span>')
        .replace(/:\s*(-?\d+\.?\d*)/g, ': <span class="tok-num">$1</span>')
        .replace(/:\s*(true|false|null)/g, ': <span class="tok-kw">$1</span>');
}

function highlightHtml(code = '') {
    return escapeHtml(code)
        .replace(/(&lt;\/?[a-zA-Z0-9\-]+)/g, '<span class="tok-tag">$1</span>')
        .replace(/([a-zA-Z\-]+)=(&quot;[^&]*&quot;)/g, '<span class="tok-attr">$1</span>=<span class="tok-str">$2</span>')
        .replace(/(&gt;)/g, '<span class="tok-tag">$1</span>');
}
