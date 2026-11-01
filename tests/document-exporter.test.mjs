import test from 'node:test';
import assert from 'node:assert/strict';
import {
    tableToCsv,
    tableToTsv,
    generatePdfHtml,
    generateWordDoc,
    generateStandaloneHtml,
    formatHistoryAsMarkdown,
    formatHistoryAsCsv
} from '../app/document-exporter.js';
import { renderMarkdown } from '../app/markdown-renderer.js';

test('Document Exporter - Table to RFC 4180 CSV conversion', () => {
    const sampleHtmlTable = `
    <table>
        <thead>
            <tr><th>Language</th><th>Creator</th><th>Year</th></tr>
        </thead>
        <tbody>
            <tr><td>Python</td><td>Guido van Rossum</td><td>1991</td></tr>
            <tr><td>JavaScript</td><td>Brendan Eich, "Netscape"</td><td>1995</td></tr>
            <tr><td>C++</td><td>Bjarne Stroustrup</td><td>1985</td></tr>
        </tbody>
    </table>`;

    const csv = tableToCsv(sampleHtmlTable);
    assert.ok(csv.includes('Language,Creator,Year'), 'Header line must be present');
    assert.ok(csv.includes('Python,Guido van Rossum,1991'), 'Standard row must match');
    assert.ok(csv.includes('"Brendan Eich, ""Netscape"""'), 'Quotes and commas must be escaped per RFC 4180');
});

test('Document Exporter - Table to TSV (Excel paste) conversion', () => {
    const sampleHtmlTable = `
    <table>
        <thead><tr><th>Metric</th><th>Q1</th><th>Q2</th></tr></thead>
        <tbody><tr><td>Revenue</td><td>$10M</td><td>$12M</td></tr></tbody>
    </table>`;

    const tsv = tableToTsv(sampleHtmlTable);
    assert.ok(tsv.includes('Metric\tQ1\tQ2'), 'TSV header must be tab-delimited');
    assert.ok(tsv.includes('Revenue\t$10M\t$12M'), 'TSV row must be tab-delimited');
});

test('Document Exporter - Native Vector Print PDF Document generation', () => {
    const title = 'Quarterly Strategy Report';
    const prompt = 'Outline key Q3 performance milestones';
    const answerHtml = '<h2>Executive Summary</h2><p>All objectives were achieved.</p>';
    const meta = { model: 'llama-3.3-70b-versatile', timestamp: 1718000000000 };

    const pdfDoc = generatePdfHtml(title, prompt, answerHtml, meta);
    assert.ok(pdfDoc.includes('<!DOCTYPE html>'), 'Must produce valid HTML5 document');
    assert.ok(pdfDoc.includes('<title>Quarterly Strategy Report</title>'), 'Must include document title');
    assert.ok(pdfDoc.includes('@media print'), 'Must include dedicated print stylesheet');
    assert.ok(pdfDoc.includes('Executive Summary'), 'Must embed answer content');
    assert.ok(pdfDoc.includes('Outline key Q3 performance milestones'), 'Must embed user prompt');
    assert.ok(pdfDoc.includes('llama-3.3-70b-versatile'), 'Must embed model metadata');
});

test('Document Exporter - Microsoft Word (.docx / .doc) Document generation', () => {
    const title = 'Technical Architecture Manifesto';
    const prompt = 'Explain microservice trade-offs';
    const answerHtml = '<p>Microservices offer modular deployment.</p>';
    const meta = { model: 'deepseek-r1-distill-llama-70b', timestamp: 1718000000000 };

    const wordDoc = generateWordDoc(title, prompt, answerHtml, meta);
    assert.ok(wordDoc.includes('xmlns:w=\'urn:schemas-microsoft-com:office:word\''), 'Must include Word namespace');
    assert.ok(wordDoc.includes('<w:View>Print</w:View>'), 'Must configure Word Print layout');
    assert.ok(wordDoc.includes('Technical Architecture Manifesto'), 'Must contain document title');
    assert.ok(wordDoc.includes('Microservices offer modular deployment.'), 'Must contain body content');
});

test('Document Exporter - Chat History Export to Markdown and CSV', () => {
    const history = [
        { role: 'user', content: 'What is the speed of light in vacuum?', timestamp: 1718000000000 },
        { role: 'assistant', content: 'The speed of light in vacuum is approximately 299,792,458 m/s.', timestamp: 1718000001000 }
    ];

    const md = formatHistoryAsMarkdown(history);
    assert.ok(md.includes('### User'), 'Must format user turn');
    assert.ok(md.includes('What is the speed of light in vacuum?'), 'Must contain user query');
    assert.ok(md.includes('### JARVIS'), 'Must format assistant turn');

    const csv = formatHistoryAsCsv(history);
    assert.ok(csv.includes('Role,Message,Timestamp'), 'Must include CSV header');
    assert.ok(csv.includes('User,What is the speed of light in vacuum?'), 'Must format user row');
    assert.ok(csv.includes('JARVIS,"The speed of light in vacuum is approximately 299,792,458 m/s."'), 'Must format assistant row');
});

test('Markdown Renderer - Integrated Table Toolbar & Code Execution Sandbox', () => {
    // 1. Markdown Table with action buttons
    const tableMd = `
| Feature | Supported | Free Tier |
|---------|-----------|-----------|
| PDF     | Yes       | Unlimited |
| Word    | Yes       | Unlimited |
| CSV     | Yes       | Unlimited |
`;
    const renderedTable = renderMarkdown(tableMd);
    assert.ok(renderedTable.includes('assistant-table-toolbar'), 'Rendered table must include toolbar');
    assert.ok(renderedTable.includes('window.downloadTableCsv'), 'Must have CSV download button');
    assert.ok(renderedTable.includes('window.copyTableTsv'), 'Must have TSV copy button');

    // 2. Python Code Block with WASM Runner
    const pyMd = '```python\nprint("Hello from Pyodide")\n```';
    const renderedPy = renderMarkdown(pyMd);
    assert.ok(renderedPy.includes('window.runPythonBlockInBrowser'), 'Python block must have Pyodide runner');

    // 3. JavaScript Code Block with Sandbox Runner
    const jsMd = '```javascript\nconsole.log(42 * 2);\n```';
    const renderedJs = renderMarkdown(jsMd);
    assert.ok(renderedJs.includes('window.runJsBlockInBrowser'), 'JavaScript block must have JS runner');

    // 4. HTML Code Block with Auto-Rendered Live Preview
    const htmlMd = '```html\n<div style="color:red;">Interactive Widget</div>\n```';
    const renderedHtml = renderMarkdown(htmlMd);
    assert.ok(renderedHtml.includes('assistant-code-preview-wrap'), 'HTML block must include preview wrapper');
    assert.ok(renderedHtml.includes('assistant-code-preview-iframe'), 'HTML block must include preview iframe');
    assert.ok(renderedHtml.includes('sandbox="allow-scripts allow-modals allow-forms"'), 'Iframe must have security sandbox');
    assert.ok(renderedHtml.includes('window.toggleCodePreview'), 'Must include toggle preview button');
    assert.ok(renderedHtml.includes('window.refreshCodePreview'), 'Must include refresh preview button');
    assert.ok(renderedHtml.includes('window.openCodePreviewInNewTab'), 'Must include open new tab button');
});
