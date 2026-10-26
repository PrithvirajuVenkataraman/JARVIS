/**
 * Comprehensive, modular markdown and code block renderer for JARVIS.
 * Integrates syntax highlighting, LaTeX math, citations, tables, and lists.
 */

import { highlightCode } from './code-highlighter.js';
import { renderMathInText, formatLatexExpression } from './math-renderer.js';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function isMathCodeBlock(lang = '', code = '') {
    const normalizedLang = String(lang || '').trim().toLowerCase();
    if (['math', 'latex', 'tex', 'katex', 'calc', 'formula', 'equation', 'algebra', 'derivation', 'geometry', 'steps'].includes(normalizedLang)) {
        return true;
    }
    const trimmed = String(code || '').trim();
    if (!trimmed) return false;

    // Make sure it doesn't look like actual programming code
    const hasCodeKeywords = /\b(?:function|def|import|from|class|const|let|var|return|console\.log|public|private|interface|struct|namespace|package|void|static|val|fn)\b/.test(trimmed);
    if (hasCodeKeywords) return false;

    // Check if it contains characteristic LaTeX math markers or environment tags
    const hasMathCommands = /\\(?:frac|sqrt|boxed|begin\{(?:aligned|align|split|gather|cases|matrix|bmatrix|pmatrix)\}|approx|times|cdot|sum|int|partial|alpha|beta|gamma|theta|pi|le|ge|neq|pm|quad|qquad|text|mathrm|mathbf)\b/.test(trimmed);
    const hasDanglingMathEnv = /\\(?:end\{(?:aligned|align|cases|matrix)\})/.test(trimmed);
    if (hasMathCommands || hasDanglingMathEnv) return true;

    // Intercept unlabeled, calc, text, or formula code blocks containing arithmetic/algebra
    if (['', 'text', 'txt', 'plaintext', 'calc', 'formula'].includes(normalizedLang)) {
        const lines = trimmed.split('\n').map(l => l.trim()).filter(Boolean);
        if (lines.length > 0) {
            let mathLines = 0;
            for (const line of lines) {
                if (/[=≈≠≤≥<>]/.test(line) && /[\d\w]/.test(line)) {
                    mathLines++;
                } else if (/^(?:Step\s*\d+:?|Therefore|Hence|Since|So|Given|We have)/i.test(line)) {
                    mathLines++;
                } else if (/^[\d\w\s()+\-*/^=._]+$/.test(line) && /[+\-*/^]/.test(line)) {
                    mathLines++;
                }
            }
            if (mathLines >= Math.ceil(lines.length * 0.5)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Automatically balances unclosed code fences, LaTeX display and inline math blocks,
 * and environments during token-by-token live streaming to prevent layout shift and popping.
 * @param {string} rawText
 * @returns {string} Balanced text
 */
export function balanceDelimitersForStreaming(rawText = '') {
    let text = String(rawText || '');
    if (!text) return '';

    // 1. Balance unclosed code blocks ```
    const codeFenceMatches = text.match(/```/g) || [];
    if (codeFenceMatches.length % 2 === 1) {
        text += '\n```\n';
    }

    // 2. Balance unclosed display math $$
    const displayMathMatches = text.match(/(?<!\\)\$\$/g) || [];
    if (displayMathMatches.length % 2 === 1) {
        // Also check if there's an unclosed LaTeX environment inside the display math block
        const envOpenMatches = [...text.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)];
        const envCloseMatches = [...text.matchAll(/\\end\{([a-zA-Z*]+)\}/g)];
        const openStack = [];
        for (const m of envOpenMatches) {
            openStack.push(m[1]);
        }
        for (const m of envCloseMatches) {
            const idx = openStack.lastIndexOf(m[1]);
            if (idx !== -1) openStack.splice(idx, 1);
        }
        while (openStack.length > 0) {
            const envName = openStack.pop();
            text += `\n\\end{${envName}}`;
        }
        text += '\n$$\n';
    } else {
        // Even if $$ is balanced, check for open LaTeX environments
        const envOpenMatches = [...text.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)];
        const envCloseMatches = [...text.matchAll(/\\end\{([a-zA-Z*]+)\}/g)];
        const openStack = [];
        for (const m of envOpenMatches) {
            openStack.push(m[1]);
        }
        for (const m of envCloseMatches) {
            const idx = openStack.lastIndexOf(m[1]);
            if (idx !== -1) openStack.splice(idx, 1);
        }
        while (openStack.length > 0) {
            const envName = openStack.pop();
            text += `\n\\end{${envName}}`;
        }
    }

    // 3. Balance unclosed display math \[ and \]
    const openDisplay = (text.match(/\\\[/g) || []).length;
    const closeDisplay = (text.match(/\\\]/g) || []).length;
    if (openDisplay > closeDisplay) {
        text += '\n\\]\n'.repeat(openDisplay - closeDisplay);
    }

    // 4. Balance unclosed inline math \( and \)
    const openInline = (text.match(/\\\(/g) || []).length;
    const closeInline = (text.match(/\\\)/g) || []).length;
    if (openInline > closeInline) {
        text += '\\)'.repeat(openInline - closeInline);
    }

    return text;
}

export function renderMarkdown(rawText = '', options = {}) {
    if (typeof rawText !== 'string') return '';
    let text = rawText.trim();
    if (!text) return '';

    // Automatically balance unclosed code fences and math blocks during streaming
    text = balanceDelimitersForStreaming(text);

    // Step 1: Extract math blocks and programming code blocks before any other substitutions
    const codeBlocks = [];
    const mathBlocks = [];

    text = text.replace(/```([a-zA-Z0-9_\-+]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const rawCode = code.replace(/\n$/, '');
        if (isMathCodeBlock(lang, rawCode)) {
            const mathIdx = mathBlocks.length;
            mathBlocks.push(rawCode.trim());
            return `__MATH_BLOCK_${mathIdx}__`;
        }
        const idx = codeBlocks.length;
        codeBlocks.push({ lang: (lang || '').trim(), code: rawCode });
        return `__CODE_BLOCK_${idx}__`;
    });

    // Step 2: Line-by-line block parsing (headers, lists, tables, blockquotes, paragraphs)
    const lines = text.split('\n');
    const out = [];
    let i = 0;

    while (i < lines.length) {
        const line = lines[i];
        const trim = line.trim();

        if (trim.startsWith('__CODE_BLOCK_') && trim.endsWith('__')) {
            out.push(trim);
            i += 1;
            continue;
        }

        if (trim.startsWith('__MATH_BLOCK_') && trim.endsWith('__')) {
            out.push(trim);
            i += 1;
            continue;
        }

        if (/^#{1,4}\s+/.test(line)) {
            const level = line.match(/^(#{1,4})\s+/)[1].length;
            const headingText = line.replace(/^#{1,4}\s+/, '');
            const tag = `h${Math.min(level + 1, 5)}`;
            out.push(`<${tag} class="assistant-md-heading">${escapeHtml(headingText)}</${tag}>`);
            i += 1;
            continue;
        }

        if (/^\s*>/.test(line)) {
            const bqLines = [];
            while (i < lines.length && /^\s*>/.test(String(lines[i] || ''))) {
                bqLines.push(String(lines[i]).replace(/^\s*>\s?/, ''));
                i += 1;
            }
            out.push(`<blockquote class="assistant-md-blockquote">${escapeHtml(bqLines.join('\n'))}</blockquote>`);
            continue;
        }

        if (/^\s*[-*]\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*[-*]\s+/.test(String(lines[i] || ''))) {
                items.push(String(lines[i]).replace(/^\s*[-*]\s+/, ''));
                i += 1;
            }
            out.push(`<ul class="assistant-md-list">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`);
            continue;
        }

        if (/^\s*\d+\.\s+/.test(line)) {
            const items = [];
            while (i < lines.length && /^\s*\d+\.\s+/.test(String(lines[i] || ''))) {
                items.push(String(lines[i]).replace(/^\s*\d+\.\s+/, ''));
                i += 1;
            }
            out.push(`<ol class="assistant-md-olist">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ol>`);
            continue;
        }

        const isPipeRow = /^\s*\|.+\|\s*$/.test(line);
        const nextLine = i + 1 < lines.length ? String(lines[i + 1] || '') : '';
        const isSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(nextLine);
        if (isPipeRow && isSeparator) {
            const tableRows = [line];
            i += 2;
            while (i < lines.length && /^\s*\|.+\|\s*$/.test(String(lines[i] || ''))) {
                tableRows.push(String(lines[i]));
                i += 1;
            }
            const cells = row => row.trim().replace(/^\||\|$/g, '').split('|').map(c => escapeHtml(c.trim()));
            const header = cells(tableRows[0]);
            const body = tableRows.slice(1).map(cells);
            out.push(
                `<div class="assistant-md-table-wrap">
                    <div class="assistant-table-toolbar">
                        <span class="assistant-table-badge">Data Table</span>
                        <div class="assistant-table-actions">
                            <button type="button" class="assistant-table-btn" onclick="window.downloadTableCsv?.(this)" title="Download as CSV (Excel compatible)">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                                <span>CSV</span>
                            </button>
                            <button type="button" class="assistant-table-btn" onclick="window.copyTableTsv?.(this)" title="Copy table for Excel or Sheets">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                                <span>Copy</span>
                            </button>
                        </div>
                    </div>
                    <table class="assistant-md-table"><thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>
                </div>`
            );
            continue;
        }

        if (trim) {
            const para = [];
            while (
                i < lines.length &&
                String(lines[i] || '').trim() &&
                !/^\s*[-*]\s+/.test(String(lines[i] || '')) &&
                !/^\s*\d+\.\s+/.test(String(lines[i] || '')) &&
                !/^\s*>/.test(String(lines[i] || '')) &&
                !/^(#{1,4})\s+/.test(String(lines[i] || '')) &&
                !/^\s*\|.+\|\s*$/.test(String(lines[i] || '')) &&
                !(String(lines[i] || '').trim().startsWith('__CODE_BLOCK_') && String(lines[i] || '').trim().endsWith('__')) &&
                !(String(lines[i] || '').trim().startsWith('__MATH_BLOCK_') && String(lines[i] || '').trim().endsWith('__'))
            ) {
                para.push(String(lines[i]));
                i += 1;
            }
            let pContent = escapeHtml(para.join('\n')).replace(/\n/g, '<br>');
            pContent = pContent.replace(/^<strong>(Step\s*\d+[^<]*)<\/strong>/i, '<span class="math-step-label">$1</span>');
            pContent = pContent.replace(/^(Step\s*\d+:[^\n<]*)/im, '<span class="math-step-label">$1</span>');
            out.push(`<p class="assistant-md-p">${pContent}</p>`);
            continue;
        }

        out.push('<br>');
        i += 1;
    }

    let html = out.join('\n');

    // Inline formatting: math, inline code, bold, italics, links & citations
    html = renderMathInText(html);

    // Handle backticked content: route math expressions to inline math instead of code badge boxes
    html = html.replace(/`([^`\n]+)`/g, (match, inner) => {
        const trimmed = inner.trim();
        const isExplicitMath = /^\$[^$]+\$$/.test(trimmed) ||
                               /\\(?:frac|sqrt|boxed|approx|times|cdot|pm|le|ge|neq|alpha|beta|gamma|pi|theta|text|mathrm|mathbf|sum|int|partial|nabla|infty|degree|circ)\b/.test(trimmed);
        const isEquationOrRelation = /^[a-zA-Z0-9_\(\)]+\s*(?:=|≈|&asymp;|\approx|\+|-|\*|\/|\\times|\\approx|≠|<=|>=|<|>|\\le|\\ge|\\neq)\s*[\d\w\s\\.+*/^_-]+/.test(trimmed);
        const isCoordinate = /^\([a-zA-Z0-9_+-]+,\s*[a-zA-Z0-9_+-]+\)$/.test(trimmed);
        const isSubSuper = /^[a-zA-Z]\s*[\^_]\{?[\w\d+-]+\}?$/.test(trimmed);
        const isArithmetic = /^(?:[\d\w_]+\s*[\+\-\*\/\^]\s*)+[\d\w_]+$/.test(trimmed) && /[+\-*/^]/.test(trimmed) && !/[a-zA-Z]{5,}/.test(trimmed);

        const isMath = isExplicitMath || isEquationOrRelation || isCoordinate || isSubSuper || isArithmetic;

        if (isMath) {
            const cleanExpr = trimmed.replace(/^\$|\$$/g, '');
            return `<span class="math-inline">${formatLatexExpression(cleanExpr, false)}</span>`;
        }
        return `<code class="assistant-md-inline-code">${inner}</code>`;
    });

    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[\^(\d+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" class="citation-badge" title="Source [$1]"><sup>[$1]</sup></a>`);
    html = html.replace(/\[\^(\d+)\]/g, `<span class="citation-badge-static" title="Citation [$1]"><sup>[$1]</sup></span>`);
    html = html.replace(/\[(\d+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" class="citation-badge" title="Source [$1]"><sup>[$1]</sup></a>`);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" class="assistant-link">$1</a>`);

    // Step 3: Re-inject display math blocks with clean notebook styling (NO code container / copy buttons)
    html = html.replace(/__MATH_BLOCK_(\d+)__/g, (_, idx) => {
        const mathCode = mathBlocks[Number(idx)];
        if (!mathCode) return '';
        return `<div class="math-display-block"><span class="math-display-inner">${formatLatexExpression(mathCode, true)}</span></div>`;
    });

    // Step 4: Re-inject code blocks with syntax highlighting & action buttons
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => {
        const block = codeBlocks[Number(idx)];
        if (!block) return '';
        const blockId = `code_block_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        if (typeof window !== 'undefined') {
            window._jarvisCodeBlocks = window._jarvisCodeBlocks || {};
            window._jarvisCodeBlocks[blockId] = {
                lang: block.lang || 'code',
                code: block.code || ''
            };
        }
        const langLabel = block.lang ? escapeHtml(block.lang.toUpperCase()) : 'CODE';
        const isPython = /^(python|py|python3)$/i.test(block.lang || '');
        const isHtml = /^(html|htm)$/i.test(block.lang || '');
        const isJs = /^(javascript|js|typescript|ts)$/i.test(block.lang || '');

        let runBtnHtml = '';
        if (isPython) {
            runBtnHtml = `<button type="button" class="code-header-btn code-run-btn" onclick="window.runPythonBlockInBrowser?.(this, '${blockId}')" title="Run code in Python WebAssembly (Pyodide)">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Run</span>
            </button>`;
        } else if (isJs) {
            runBtnHtml = `<button type="button" class="code-header-btn code-run-btn" onclick="window.runJsBlockInBrowser?.(this, '${blockId}')" title="Run JavaScript in client sandbox">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Run</span>
            </button>`;
        }

        const copyBtnHtml = `<button type="button" class="code-header-btn" onclick="copyCodeBlock(this, '${blockId}')" title="Copy code">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
        </button>`;

        const highlighted = highlightCode(block.code, block.lang);

        let previewHtml = '';
        if (isHtml && block.code.trim()) {
            const escapedCode = String(block.code || '')
                .replace(/&/g, '&amp;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
            previewHtml = `
                <div class="assistant-code-preview-wrap" id="preview_wrap_${blockId}">
                    <div class="assistant-code-preview-header">
                        <div class="assistant-code-preview-title">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>
                            <span>Live Interactive Preview</span>
                        </div>
                        <div class="assistant-code-preview-actions">
                            <button type="button" class="code-preview-btn" onclick="window.toggleCodePreview?.('${blockId}')" title="Collapse / Expand Preview">Toggle</button>
                            <button type="button" class="code-preview-btn" onclick="window.refreshCodePreview?.('${blockId}')" title="Reload Preview">Refresh</button>
                            <button type="button" class="code-preview-btn" onclick="window.openCodePreviewInNewTab?.('${blockId}')" title="Open Fullscreen in New Window">New Window</button>
                        </div>
                    </div>
                    <div class="assistant-code-preview-body" id="preview_body_${blockId}">
                        <iframe class="assistant-code-preview-iframe" id="iframe_${blockId}" sandbox="allow-scripts allow-modals allow-forms" loading="lazy" srcdoc="${escapedCode}"></iframe>
                    </div>
                </div>`;
        }

        return `
            <div class="assistant-md-code-container" id="container_${blockId}">
                <div class="assistant-md-code-header">
                    <span class="assistant-md-code-lang">${langLabel}</span>
                    <div class="assistant-md-code-actions">
                        ${runBtnHtml}
                        ${copyBtnHtml}
                    </div>
                </div>
                <pre class="assistant-md-code-block"><code class="lang-${escapeHtml(block.lang || 'text')}">${highlighted}</code></pre>
                ${previewHtml}
                <div class="assistant-code-output" id="output_${blockId}" style="display:none;"></div>
            </div>
        `;
    });

    return html;
}
