import DOMPurify from 'dompurify';

function safeUrl(value, image = false) {
    if (image && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) return true;
    if (value.startsWith('#')) return true;
    try {
        const url = new URL(value, window.location.href);
        return ['https:', 'http:'].includes(url.protocol);
    } catch { return false; }
}

// App controls use delegated listeners. Untrusted HTML never supplies executable code.
DOMPurify.addHook('afterSanitizeAttributes', node => {
    for (const attribute of Array.from(node.attributes || [])) {
        const name = attribute.name.toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc') node.removeAttribute(attribute.name);
        if (['href', 'src', 'xlink:href'].includes(name) && !safeUrl(attribute.value, node.tagName === 'IMG')) {
            node.removeAttribute(attribute.name);
        }
        if (name === 'style' && /url\s*\(|expression\s*\(|@import|position\s*:\s*fixed/i.test(attribute.value)) {
            node.removeAttribute('style');
        }
    }
    if (node.tagName === 'A') {
        node.setAttribute('target', '_blank');
        node.setAttribute('rel', 'noopener noreferrer');
    }
});

export function sanitizeAssistantMarkup(html) {
    return DOMPurify.sanitize(String(html || ''), {
        USE_PROFILES: { html: true, svg: true, svgFilters: false, mathMl: true },
        ADD_ATTR: ['preserveAspectRatio', 'encoding', 'display'],
        FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 'select'],
        SANITIZE_DOM: true
    });
}

export function installAssistantActions(root = document) {
    const preview = id => {
        const body = document.getElementById(`preview_body_${id}`);
        if (!body) return;
        let frame = body.querySelector('iframe');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = `iframe_${id}`;
            frame.className = 'assistant-code-preview-iframe';
            frame.title = 'Sandboxed HTML preview';
            frame.setAttribute('sandbox', 'allow-scripts');
            body.replaceChildren(frame);
            body.classList.add('hidden');
        }
        frame.srcdoc = document.querySelector(`#container_${CSS.escape(id)} pre code`)?.textContent || '';
    };
    root.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const button = target?.closest('.assistant-message-text [data-assistant-action]');
        if (!button) return;
        const id = button.dataset.blockId;
        const actions = {
            'code-copy': () => window.copyCodeBlock?.(button, id),
            'code-wrap': () => window.toggleCodeBlockWrap?.(button, id),
            'code-collapse': () => window.toggleCodeBlockCollapse?.(button, id),
            'code-run-js': () => window.runJsBlockInBrowser?.(button, id),
            'code-run-python': () => window.runPythonBlockInBrowser?.(button, id),
            'preview-toggle': () => { preview(id); window.toggleCodePreview?.(id); },
            'preview-refresh': () => preview(id),
            'preview-download': () => {
                const code = document.querySelector(`#container_${CSS.escape(id)} pre code`)?.textContent || '';
                const url = URL.createObjectURL(new Blob([code], { type: 'text/html' }));
                const link = document.createElement('a'); link.href = url; link.download = 'preview.html'; link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            },
            'table-menu': () => window.toggleTablePencilMenu?.(button),
            'table-copy': () => { window.copyTableTsv?.(button); window.toggleTablePencilMenu?.(button, false); },
            'table-download': () => { window.downloadTableCsv?.(button); window.toggleTablePencilMenu?.(button, false); }
        };
        actions[button.dataset.assistantAction]?.();
    });
    root.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const citation = target?.closest('.assistant-message-text .citation-source-logo[data-source-id]');
        if (citation) window.JarvisLiveResearch?.highlightSource?.(citation.dataset.sourceId);
    });
}
