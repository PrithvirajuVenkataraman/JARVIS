import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
    isExplicitCodeAuthoringRequest,
    extractPythonCodeBlocks,
    shouldAutoExecutePythonResponse,
    isPythonScriptAttachment,
    shouldAutoExecutePythonAttachment,
    extractFinalPythonAnswer,
    stripPythonCodeAndBoilerplate,
    formatPythonExecutionOnlyFinalAnswer
} from '../app/python-wasm-runner.js';

test('auto-execution classifier distinguishes computation prompts from explicit code-authoring requests', () => {
    assert.equal(isExplicitCodeAuthoringRequest('Write a Python script to sort a list'), true);
    assert.equal(isExplicitCodeAuthoringRequest('Show me the Python code for Fibonacci'), true);
    assert.equal(isExplicitCodeAuthoringRequest('Solve this equation using Python and show only the final answer'), false);
    assert.equal(isExplicitCodeAuthoringRequest('What is the determinant of [[4, 3], [6, 3]]?'), false);

    const responseWithCode = "Here's the Python script:\n```python\nimport math\nprint(math.factorial(6))\n```\nRunning this gives the answer.";
    assert.equal(shouldAutoExecutePythonResponse('Compute 6!', responseWithCode), true);
    assert.equal(shouldAutoExecutePythonResponse('Compute 6!', responseWithCode, { streaming: true }), false);
    assert.equal(shouldAutoExecutePythonResponse('Write a Python script to compute 6!', responseWithCode), false);
    assert.equal(extractPythonCodeBlocks(responseWithCode).length, 1);
});

test('python script attachment detection auto-runs scripts unless user asks to review or explain', () => {
    const pyAtt = { name: 'solve.py', mimeType: 'text/x-python' };
    const txtAtt = { name: 'notes.txt', mimeType: 'text/plain' };
    assert.equal(isPythonScriptAttachment(pyAtt), true);
    assert.equal(isPythonScriptAttachment(txtAtt), false);

    assert.equal(shouldAutoExecutePythonAttachment([pyAtt], ''), true);
    assert.equal(shouldAutoExecutePythonAttachment([pyAtt], 'Execute and tell me the result'), true);
    assert.equal(shouldAutoExecutePythonAttachment([pyAtt], 'Review this Python file for bugs'), false);
    assert.equal(shouldAutoExecutePythonAttachment([pyAtt], 'Explain what this code does'), false);
});

test('extractFinalPythonAnswer and formatPythonExecutionOnlyFinalAnswer output only the final answer', () => {
    const noisyStdout = [
        'Loading numpy',
        'Step 1: initializing matrix',
        'iter 1 residual = 0.25',
        'Final Answer: 720'
    ].join('\n');
    assert.equal(extractFinalPythonAnswer(noisyStdout), '720');

    const traceStdout = [
        'debug: x = 10',
        'intermediate = 42',
        '42.5'
    ].join('\n');
    assert.equal(extractFinalPythonAnswer(traceStdout), '42.5');

    const mdTable = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    assert.equal(extractFinalPythonAnswer(mdTable), mdTable);

    const finalOnly = formatPythonExecutionOnlyFinalAnswer({
        responseText: "Here's the Python script:\n```python\nprint(720)\n```",
        stdout: noisyStdout
    });
    assert.equal(finalOnly, '720');
    assert.ok(!finalOnly.includes('```'), 'Final response must not contain Python code fences');
    assert.ok(!/here's the python/i.test(finalOnly), 'Final response must not contain code boilerplate');

    const withChart = formatPythonExecutionOnlyFinalAnswer({
        responseText: '```python\nplt.plot([1,2],[3,4])\n```',
        stdout: 'Mean: 3.5',
        chartB64: 'AAA='
    });
    assert.equal(withChart, 'Mean: 3.5\n\n![Generated Chart](data:image/png;base64,AAA=)');
    assert.equal(stripPythonCodeAndBoilerplate("Here's the Python code:\n```python\nx=1\n```\nThe answer is 1."), 'The answer is 1.');
});

test('legacy-runtime executes Python WASM silently and presents only the final answer', () => {
    const src = readFileSync(new URL('../app/legacy-runtime.js', import.meta.url), 'utf8');

    assert.match(src, /async function autoExecutePythonInResponse\(/);
    assert.match(src, /async function runPythonScriptAttachments\(/);
    assert.match(src, /async function runPythonCodeInPyodide\(/);
    assert.match(src, /finally:[\s\S]*sys\.stdout = _orig_stdout/);

    const notebookFnStart = src.indexOf('async function runPythonNotebook(');
    const notebookFnEnd = src.indexOf('function showThinkingIndicator(', notebookFnStart);
    assert.ok(notebookFnStart > 0 && notebookFnEnd > notebookFnStart);
    const notebookFnBody = src.slice(notebookFnStart, notebookFnEnd);

    assert.ok(!notebookFnBody.includes('buildNotebookAnalyzingPanel('), 'runPythonNotebook must execute silently without visible notebook card');
    assert.ok(!notebookFnBody.includes('typeCodeIntoNotebook('), 'runPythonNotebook must not type raw Python code into chat');
    assert.ok(!notebookFnBody.includes('transitionToNotebookButton('), 'runPythonNotebook must not render a visible Notebook button card');

    const normFnStart = src.indexOf('function normalizeMathExpression(');
    const normFnEnd = src.indexOf('}', normFnStart);
    const normBody = src.slice(normFnStart, normFnEnd + 1);
    assert.ok(!normBody.includes('Ã—'), 'normalizeMathExpression must not contain UTF-8 mojibake');
    assert.ok(!normBody.includes('[Ã—x]'), 'normalizeMathExpression must not corrupt exp/max identifiers');
});
