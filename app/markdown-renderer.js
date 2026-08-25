/**
 * Comprehensive, modular markdown and code block renderer for JARVIS.
 * Integrates syntax highlighting, LaTeX math, citations, tables, and lists.
 */

import { highlightCode } from './code-highlighter.js';
import { renderMathInText } from './math-renderer.js';

function escapeHtml(text) {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderMarkdown(rawText = '', options = {}) {
    if (typeof rawText !== 'string') return '';
    let text = rawText.trim();
    if (!text) return '';

    // Step 1: Extract code blocks before any other substitutions
    const codeBlocks = [];
    text = text.replace(/```([a-zA-Z0-9_\-+]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const idx = codeBlocks.length;
        codeBlocks.push({ lang: (lang || '').trim(), code: code.replace(/\n$/, '') });
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
                `<div class="assistant-md-table-wrap"><table class="assistant-md-table"><thead><tr>${header.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${body.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
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
                !(String(lines[i] || '').trim().startsWith('__CODE_BLOCK_') && String(lines[i] || '').trim().endsWith('__'))
            ) {
                para.push(String(lines[i]));
                i += 1;
            }
            out.push(`<p class="assistant-md-p">${escapeHtml(para.join('\n')).replace(/\n/g, '<br>')}</p>`);
            continue;
        }

        out.push('<br>');
        i += 1;
    }

    let html = out.join('\n');

    // Inline formatting: math, inline code, bold, italics, links & citations
    html = renderMathInText(html);
    html = html.replace(/`([^`\n]+)`/g, '<code class="assistant-md-inline-code">$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\[(\d+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" class="citation-badge" title="Source [$1]"><sup>[$1]</sup></a>`);
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, `<a href="$2" target="_blank" rel="noopener noreferrer" class="assistant-link">$1</a>`);

    // Step 3: Re-inject code blocks with syntax highlighting & action buttons
    html = html.replace(/__CODE_BLOCK_(\d+)__/g, (_, idx) => {
        const block = codeBlocks[Number(idx)];
        if (!block) return '';
        const blockId = `code_block_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
        if (typeof window !== 'undefined') {
            window._jarvisCodeBlocks = window._jarvisCodeBlocks || {};
            window._jarvisCodeBlocks[blockId] = {
                lang: block.lang || 'code',
                code: block.code || ''
            };
        }
        const langLabel = block.lang ? escapeHtml(block.lang.toUpperCase()) : 'CODE';
        const isExecutable = /^(javascript|js|html|htm|json)$/i.test(block.lang);
        const runBtnHtml = isExecutable
            ? `<button type="button" class="code-header-btn run-btn" onclick="runJarvisCodeSandbox('${blockId}')" title="Run code">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
                <span>Run</span>
               </button>`
            : '';
        const canvasBtnHtml = `<button type="button" class="code-header-btn canvas-btn" onclick="openInCanvas('${blockId}')" title="Open in Artifact Canvas">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
            <span>Canvas</span>
        </button>`;
        const copyBtnHtml = `<button type="button" class="code-header-btn" onclick="copyCodeBlock(this, '${blockId}')" title="Copy code">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
        </button>`;

        const highlighted = highlightCode(block.code, block.lang);

        return `
            <div class="assistant-md-code-container" id="container_${blockId}">
                <div class="assistant-md-code-header">
                    <span class="assistant-md-code-lang">${langLabel}</span>
                    <div class="assistant-md-code-actions">
                        ${runBtnHtml}
                        ${canvasBtnHtml}
                        ${copyBtnHtml}
                    </div>
                </div>
                <pre class="assistant-md-code-block"><code class="lang-${escapeHtml(block.lang || 'text')}">${highlighted}</code></pre>
                <div id="output_${blockId}" class="code-output-drawer" style="display: none;"></div>
            </div>
        `;
    });

    return html;
}
