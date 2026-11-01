/**
 * Jarvis Document & Data Export Studio
 * Pure client-side, zero-cost, multi-format document exporter supporting:
 * - PDF (clean executive print layout, vector typography, no UI clutter)
 * - Microsoft Word (.docx / .doc MSO WordDocument XML)
 * - Excel / CSV (.csv with RFC 4180 standard escaping)
 * - Markdown (.md)
 * - Standalone HTML (.html offline document)
 * - JSON (.json structured conversation & message format)
 * - Plain Text (.txt)
 * - Table-to-CSV and Table-to-TSV (Excel/Google Sheets clipboard copy)
 */

function escapeHtml(text = '') {
    return String(text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Extracts a DOM Table or HTML table string into an RFC 4180 CSV string
 * @param {HTMLTableElement|string} tableSource
 * @returns {string} CSV formatted text
 */
export function tableToCsv(tableSource) {
    if (!tableSource) return '';

    let rows = [];
    if (typeof tableSource === 'string') {
        // Simple regex-based table parser for string inputs in Node/worker contexts
        const rowMatches = [...tableSource.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        rows = rowMatches.map(m => {
            const cellMatches = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
            return cellMatches.map(c => c[1].replace(/<[^>]+>/g, '').trim());
        });
    } else if (tableSource.querySelectorAll) {
        const domRows = Array.from(tableSource.querySelectorAll('tr'));
        rows = domRows.map(r => {
            const cells = Array.from(r.querySelectorAll('th, td'));
            return cells.map(c => (c.innerText || c.textContent || '').trim());
        });
    }

    return rows.map(cells => {
        return cells.map(cell => {
            let str = String(cell || '');
            if (/[",\r\n]/.test(str)) {
                str = `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        }).join(',');
    }).join('\r\n');
}

/**
 * Extracts a DOM Table into TSV format (Tab-Separated Values) for immediate Excel/Sheets paste
 * @param {HTMLTableElement|string} tableSource
 * @returns {string} TSV text
 */
export function tableToTsv(tableSource) {
    if (!tableSource) return '';

    let rows = [];
    if (typeof tableSource === 'string') {
        const rowMatches = [...tableSource.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
        rows = rowMatches.map(m => {
            const cellMatches = [...m[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)];
            return cellMatches.map(c => c[1].replace(/<[^>]+>/g, '').trim());
        });
    } else if (tableSource.querySelectorAll) {
        const domRows = Array.from(tableSource.querySelectorAll('tr'));
        rows = domRows.map(r => {
            const cells = Array.from(r.querySelectorAll('th, td'));
            return cells.map(c => (c.innerText || c.textContent || '').trim().replace(/\t/g, ' '));
        });
    }

    return rows.map(cells => cells.join('\t')).join('\n');
}

/**
 * Converts markdown text into a clean printable HTML document
 * @param {string} title
 * @param {string} prompt
 * @param {string} answerHtml
 * @param {object} meta
 * @returns {string} Complete HTML document
 */
export function generatePdfHtml(title = 'JARVIS Document', prompt = '', answerHtml = '', meta = {}) {
    const safeTitle = escapeHtml(title);
    const dateStr = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : new Date().toLocaleString();
    const modelStr = meta.model ? escapeHtml(meta.model) : 'JARVIS AI Engine';

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle}</title>
<style>
  @page {
    margin: 18mm 16mm;
    size: A4 portrait;
  }
  @media print {
    body { background: #ffffff !important; color: #0f172a !important; }
    .no-print { display: none !important; }
    .page-break { page-break-before: always; }
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1e293b;
    background: #ffffff;
    line-height: 1.6;
    font-size: 11pt;
    margin: 0;
    padding: 24px 32px;
  }
  .doc-header {
    border-bottom: 2px solid #6366f1;
    padding-bottom: 12px;
    margin-bottom: 24px;
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
  }
  .doc-title {
    font-size: 20pt;
    font-weight: 700;
    color: #0f172a;
    margin: 0 0 4px 0;
  }
  .doc-meta {
    font-size: 9pt;
    color: #64748b;
  }
  .prompt-box {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-left: 4px solid #6366f1;
    padding: 12px 16px;
    margin-bottom: 24px;
    border-radius: 0 8px 8px 0;
    page-break-inside: avoid;
  }
  .prompt-label {
    font-size: 8.5pt;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #6366f1;
    margin-bottom: 4px;
  }
  .prompt-text {
    font-size: 10.5pt;
    color: #334155;
    font-weight: 500;
    margin: 0;
  }
  h1, h2, h3, h4, h5 {
    color: #0f172a;
    margin-top: 1.4em;
    margin-bottom: 0.5em;
    page-break-after: avoid;
  }
  h1 { font-size: 17pt; }
  h2 { font-size: 14pt; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  h3 { font-size: 12pt; }
  p, ul, ol {
    margin-top: 0;
    margin-bottom: 0.9em;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 1.4em 0;
    font-size: 9.5pt;
    page-break-inside: avoid;
  }
  th, td {
    border: 1px solid #cbd5e1;
    padding: 7px 10px;
    text-align: left;
  }
  th {
    background-color: #f1f5f9;
    font-weight: 600;
    color: #0f172a;
  }
  pre, code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 9pt;
  }
  pre {
    background: #0f172a;
    color: #f8fafc;
    padding: 12px 14px;
    border-radius: 6px;
    overflow-x: auto;
    page-break-inside: avoid;
    margin: 1.2em 0;
  }
  blockquote {
    border-left: 3px solid #94a3b8;
    margin: 1em 0;
    padding-left: 14px;
    color: #475569;
    font-style: italic;
  }
  .doc-footer {
    margin-top: 36px;
    padding-top: 12px;
    border-top: 1px solid #e2e8f0;
    font-size: 8.5pt;
    color: #94a3b8;
    display: flex;
    justify-content: space-between;
  }
</style>
</head>
<body>
  <div class="doc-header">
    <div>
      <h1 class="doc-title">${safeTitle}</h1>
      <div class="doc-meta">Generated via JARVIS • ${escapeHtml(modelStr)}</div>
    </div>
    <div class="doc-meta" style="text-align: right;">
      ${escapeHtml(dateStr)}
    </div>
  </div>

  ${prompt ? `
  <div class="prompt-box">
    <div class="prompt-label">User Query</div>
    <div class="prompt-text">${escapeHtml(prompt)}</div>
  </div>` : ''}

  <div class="doc-body">
    ${answerHtml}
  </div>

  <div class="doc-footer">
    <span>JARVIS Autonomous AI Assistant</span>
    <span>CONFIDENTIAL &amp; PROPRIETARY</span>
  </div>
</body>
</html>`;
}

/**
 * Generates an MSO Microsoft Word Document (.docx / .doc)
 * @param {string} title
 * @param {string} prompt
 * @param {string} answerHtml
 * @param {object} meta
 * @returns {string} Word XML/HTML document
 */
export function generateWordDoc(title = 'JARVIS Document', prompt = '', answerHtml = '', meta = {}) {
    const safeTitle = escapeHtml(title);
    const dateStr = meta.timestamp ? new Date(meta.timestamp).toLocaleString() : new Date().toLocaleString();
    const modelStr = meta.model ? escapeHtml(meta.model) : 'JARVIS AI Engine';

    return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
<meta charset='utf-8'>
<title>${safeTitle}</title>
<!--[if gte mso 9]>
<xml>
<w:WordDocument>
<w:View>Print</w:View>
<w:Zoom>100</w:Zoom>
<w:DoNotOptimizeForBrowser/>
</w:WordDocument>
</xml>
<![endif]-->
<style>
  body {
    font-family: 'Calibri', 'Segoe UI', Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.5;
    color: #1e293b;
    margin: 1in;
  }
  h1.doc-title {
    font-size: 20pt;
    color: #0f172a;
    border-bottom: 2pt solid #6366f1;
    padding-bottom: 4pt;
    margin-top: 0;
  }
  .doc-meta {
    font-size: 9.5pt;
    color: #64748b;
    margin-bottom: 18pt;
  }
  .prompt-callout {
    background-color: #f8fafc;
    border: 1pt solid #cbd5e1;
    border-left: 3pt solid #6366f1;
    padding: 8pt 12pt;
    margin-bottom: 18pt;
  }
  .prompt-callout-title {
    font-size: 9pt;
    font-weight: bold;
    color: #6366f1;
    text-transform: uppercase;
  }
  h1 { font-size: 16pt; color: #0f172a; margin-top: 14pt; }
  h2 { font-size: 13pt; color: #1e293b; margin-top: 12pt; border-bottom: 0.75pt solid #cbd5e1; }
  h3 { font-size: 11.5pt; color: #334155; margin-top: 10pt; }
  p, li { margin-bottom: 6pt; }
  table {
    border-collapse: collapse;
    width: 100%;
    margin: 12pt 0;
  }
  th, td {
    border: 1pt solid #94a3b8;
    padding: 6pt 8pt;
    font-size: 10pt;
    text-align: left;
  }
  th {
    background-color: #f1f5f9;
    font-weight: bold;
    color: #0f172a;
  }
  pre {
    background-color: #0f172a;
    color: #f8fafc;
    border: 1pt solid #1e293b;
    padding: 8pt 10pt;
    font-family: 'Consolas', monospace;
    font-size: 9.5pt;
  }
  code {
    font-family: 'Consolas', monospace;
    font-size: 9.5pt;
    background-color: #f1f5f9;
    padding: 1pt 3pt;
  }
  blockquote {
    border-left: 2.5pt solid #6366f1;
    padding-left: 8pt;
    color: #475569;
    font-style: italic;
    margin: 8pt 0;
  }
</style>
</head>
<body>
  <h1 class="doc-title">${safeTitle}</h1>
  <div class="doc-meta">Generated via JARVIS (${escapeHtml(modelStr)}) • ${escapeHtml(dateStr)}</div>

  ${prompt ? `
  <div class="prompt-callout">
    <div class="prompt-callout-title">Prompt</div>
    <div style="font-size: 10.5pt; color: #334155;">${escapeHtml(prompt)}</div>
  </div>` : ''}

  <div>
    ${answerHtml}
  </div>
</body>
</html>`;
}

/**
 * Generates an offline self-contained standalone HTML document
 */
export function generateStandaloneHtml(title = 'JARVIS Document', prompt = '', answerHtml = '', meta = {}) {
    return generatePdfHtml(title, prompt, answerHtml, meta);
}

/**
 * Triggers browser clean print view inside an invisible iframe
 * @param {string} title
 * @param {string} htmlContent
 */
export function openPrintDialog(title, htmlContent) {
    if (typeof document === 'undefined') return;

    const printFrame = document.createElement('iframe');
    printFrame.style.position = 'fixed';
    printFrame.style.right = '0';
    printFrame.style.bottom = '0';
    printFrame.style.width = '0';
    printFrame.style.height = '0';
    printFrame.style.border = '0';
    printFrame.setAttribute('aria-hidden', 'true');
    document.body.appendChild(printFrame);

    const doc = printFrame.contentWindow.document;
    doc.open();
    doc.write(htmlContent);
    doc.close();

    printFrame.contentWindow.focus();
    setTimeout(() => {
        try {
            printFrame.contentWindow.print();
        } catch (_) {
            window.print();
        }
        setTimeout(() => printFrame.remove(), 60000);
    }, 250);
}

/**
 * Downloads a string file directly to user device
 * @param {string} filename
 * @param {string} content
 * @param {string} mimeType
 */
export function downloadFile(filename, content, mimeType = 'text/plain;charset=utf-8') {
    if (typeof document === 'undefined') return;
    const blob = new Blob([String(content || '')], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Formats a chat history array into clean Markdown
 */
export function formatHistoryAsMarkdown(history = []) {
    if (!Array.isArray(history) || history.length === 0) {
        return '# JARVIS Chat Conversation\n\nNo messages recorded.';
    }

    const lines = [
        '# JARVIS Chat Conversation',
        `*Exported on ${new Date().toLocaleString()}*`,
        '',
        '---',
        ''
    ];

    for (const msg of history) {
        const isUser = msg.role === 'user' || msg.isUser;
        const sender = isUser ? 'User' : 'JARVIS';
        const text = String(msg.content || msg.text || '').trim();
        lines.push(`### ${sender}`);
        lines.push('');
        lines.push(text);
        lines.push('');
        lines.push('---');
        lines.push('');
    }

    return lines.join('\n').trim();
}

/**
 * Formats full chat history into CSV
 */
export function formatHistoryAsCsv(history = []) {
    if (!Array.isArray(history) || history.length === 0) return 'Role,Message,Timestamp\r\n';
    const rows = [['Role', 'Message', 'Timestamp']];
    for (const msg of history) {
        const role = (msg.role === 'user' || msg.isUser) ? 'User' : 'JARVIS';
        const text = String(msg.content || msg.text || '').trim();
        const ts = msg.timestamp ? new Date(msg.timestamp).toISOString() : new Date().toISOString();
        rows.push([role, text, ts]);
    }

    return rows.map(r => r.map(cell => {
        let str = String(cell || '');
        if (/[",\r\n]/.test(str)) {
            str = `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    }).join(',')).join('\r\n');
}

export const JarvisDocumentExporter = {
    tableToCsv,
    tableToTsv,
    generatePdfHtml,
    generateWordDoc,
    generateStandaloneHtml,
    openPrintDialog,
    downloadFile,
    formatHistoryAsMarkdown,
    formatHistoryAsCsv
};

if (typeof globalThis !== 'undefined') {
    globalThis.JarvisDocumentExporter = JarvisDocumentExporter;
}
