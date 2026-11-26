/**
 * Python WebAssembly (Pyodide) Auto-Execution & Final-Answer Formatting Engine
 */

const CODE_AUTHORING_RE = /\b(?:write|create|implement|generate|show|give|provide|draft|build|refactor|optimize|debug|fix|review|explain|teach|how\s+to|example|snippet|sample)\b[\s\S]{0,60}\b(?:python|py|script|code|function|class|program|algorithm|implementation|loop|decorator)\b|\b(?:python|py)\s+(?:code|script|function|class|program|implementation|snippet|example)\b/i;
const RUN_OVERRIDE_RE = /\b(?:run|execute|output\s+of|what\s+(?:does|will|is)\s+(?:this|the)\s+(?:python|code|script)\s+(?:output|print|return)|only\s+(?:the\s+)?final\s+answer|final\s+answer\s+only|solve\s+(?:with|using)\s+python|using\s+python\s+(?:compute|calculate|solve|find))\b/i;
const EXPLICIT_EXECUTE_RE = /\b(?:run|execute|eval(?:uate)?|compute|calculate|output\s+of|what\s+(?:does|will|is)\s+(?:this|the)\s+(?:python|code|script)\s+(?:output|print|return)|only\s+(?:the\s+)?final\s+answer|final\s+answer\s+only|solve\s+(?:with|using)\s+python|using\s+python\s+(?:compute|calculate|solve|find))\b/i;

export function isExplicitCodeAuthoringRequest(prompt = '') {
    const raw = String(prompt || '').trim();
    if (!raw) return false;
    if (RUN_OVERRIDE_RE.test(raw) && !/\b(?:show|include|keep|print)\s+(?:the\s+)?code\b/i.test(raw)) {
        return false;
    }
    return CODE_AUTHORING_RE.test(raw);
}

export function extractPythonCodeBlocks(markdownText = '') {
    const src = String(markdownText || '');
    if (!src.includes('```')) return [];
    const blocks = [];
    const regex = /```(python|py|python3)\b[^\n]*\r?\n([\s\S]*?)```/gi;
    let match;
    while ((match = regex.exec(src)) !== null) {
        const code = String(match[2] || '').trim();
        if (code) {
            blocks.push({
                fullMatch: match[0],
                lang: String(match[1] || 'python').toLowerCase(),
                code
            });
        }
    }
    return blocks;
}

export function shouldAutoExecutePythonResponse(userPrompt = '', responseText = '', options = {}) {
    if (options?.streaming === true) return false;
    const blocks = extractPythonCodeBlocks(responseText);
    if (!blocks.length) return false;
    if (isExplicitCodeAuthoringRequest(userPrompt)) return false;
    return true;
}

export function isPythonScriptAttachment(attachment) {
    const name = String(attachment?.name || '').toLowerCase();
    const mime = String(attachment?.mimeType || '').toLowerCase();
    return /\.py$/i.test(name) || mime === 'text/x-python' || mime === 'application/x-python-code';
}

export function shouldAutoExecutePythonAttachment(attachments = [], userPrompt = '') {
    const list = Array.isArray(attachments) ? attachments : [];
    const hasPy = list.some(isPythonScriptAttachment);
    if (!hasPy) return false;
    const raw = String(userPrompt || '').trim();
    if (!raw) return true;
    if (/\b(?:review|explain|refactor|critique|comment|document|read|summarize)\b/i.test(raw) && !EXPLICIT_EXECUTE_RE.test(raw)) {
        return false;
    }
    return true;
}

export function extractFinalPythonAnswer(stdout = '') {
    const clean = String(stdout || '')
        .replace(/\r\n/g, '\n')
        .split('\n')
        .filter(line => !/^(?:Loading\s+\w+|Loaded\s+\w+|Downloading\s+|Collecting\s+|Successfully\s+installed\b)/i.test(line.trim()))
        .join('\n')
        .trim();
    if (!clean) return '';

    const markerRegex = /^(?:\*{0,2}(?:Final\s+Answer|Final\s+Result|Answer|Result|Output)\*{0,2}\s*:\s*)(.+)$/gmi;
    const markers = [...clean.matchAll(markerRegex)];
    if (markers.length > 0) {
        const lastMatch = markers[markers.length - 1];
        const tailStart = (lastMatch.index ?? 0) + lastMatch[0].indexOf(lastMatch[1]);
        return clean.slice(tailStart).trim();
    }

    const lines = clean.split('\n').map(l => l.trimEnd()).filter(l => l.trim().length > 0);
    if (lines.length <= 1) return clean;

    const looksLikeMarkdownTable = lines.some(l => /^\s*\|.+\|\s*$/.test(l));
    if (looksLikeMarkdownTable) return clean;

    // If earlier lines look like step/debug/intermediate logs and the last line is a clean value, return only the final line
    const intermediateLines = lines.slice(0, -1);
    const hasDebugNoise = intermediateLines.some(l =>
        /^(?:step\s*\d+|debug|trace|log|iter(?:ation)?\s*\d+|checking|testing|intermediate|temp|[a-z_][a-z0-9_]*\s*=)/i.test(l.trim())
    );
    if (hasDebugNoise) {
        return lines[lines.length - 1].trim();
    }

    return clean;
}

export function stripPythonCodeAndBoilerplate(text = '') {
    let out = String(text || '').replace(/```(?:python|py|python3)\b[^\n]*\r?\n[\s\S]*?```/gi, '').trim();
    // Remove boilerplate lines introducing or describing the removed Python snippet
    const lines = out.split('\n').filter(line => {
        const t = line.trim();
        if (!t) return true;
        if (/^(?:here(?:'s| is)\s+(?:the\s+|a\s+)?python(?:\s+code|\s+script)?|you\s+can\s+(?:run|execute)\s+(?:this|the\s+following)\s+python|running\s+this\s+(?:python\s+)?(?:code|script)\s+(?:returns|outputs|gives)|python\s+(?:code|script|implementation):?)\s*[:.]?$/i.test(t)) {
            return false;
        }
        return true;
    });
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function formatPythonExecutionOnlyFinalAnswer({ responseText = '', stdout = '', chartB64 = null, error = '' } = {}) {
    const finalOutput = extractFinalPythonAnswer(stdout);
    const chartMarkdown = chartB64 ? `![Generated Chart](data:image/png;base64,${chartB64})` : '';

    if (error && !finalOutput) {
        const stripped = stripPythonCodeAndBoilerplate(responseText);
        if (stripped) return stripped;
        return `Could not compute the final answer: ${String(error).trim()}`;
    }

    const parts = [];
    if (finalOutput) {
        parts.push(finalOutput);
    }
    if (chartMarkdown) {
        parts.push(chartMarkdown);
    }
    if (parts.length > 0) {
        return parts.join('\n\n').trim();
    }

    const stripped = stripPythonCodeAndBoilerplate(responseText);
    return stripped || 'Execution completed with no output.';
}
