import DOMPurify from 'dompurify';
import { isTrustedBinding } from './trusted-ui.js';

function safeUrl(value, image = false) {
    if (image && /^data:image\/(?:png|jpeg|webp|gif);base64,[a-z\d+/=\s]+$/i.test(value)) return true;
    if (value.startsWith('#')) return true;
    try {
        const url = new URL(value, window.location.href);
        return ['https:', 'http:'].includes(url.protocol);
    } catch { return false; }
}

export function isSafeImagePreview(value) {
    if (typeof value !== 'string' || !value || value.startsWith('#')) return false;
    if (value.startsWith('blob:')) {
        try { return new URL(value).origin === window.location.origin; } catch { return false; }
    }
    return safeUrl(value, true);
}

// App controls use delegated listeners. Untrusted HTML never supplies executable code.
DOMPurify.addHook('afterSanitizeAttributes', node => {
    const trusted = Array.from(node.attributes || []).some(attribute => isTrustedBinding(attribute.name, attribute.value));
    for (const attribute of Array.from(node.attributes || [])) {
        const name = attribute.name.toLowerCase();
        if (!trusted && ['data-assistant-action', 'data-block-id'].includes(name)) node.removeAttribute(attribute.name);
        if (name.startsWith('data-ui-') && !isTrustedBinding(name, attribute.value)) node.removeAttribute(attribute.name);
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

function preview(id) {
        const body = document.getElementById(`preview_body_${id}`);
        if (!body) return;
        let frame = body.querySelector('iframe');
        if (!frame) {
            frame = document.createElement('iframe');
            frame.id = `iframe_${id}`;
            frame.className = 'assistant-code-preview-iframe';
            frame.title = 'Sandboxed HTML preview';
            frame.setAttribute('sandbox', '');
            body.replaceChildren(frame);
            body.classList.add('hidden');
        }
        const code = document.querySelector(`#container_${CSS.escape(id)} pre code`)?.textContent || '';
        // A visual preview is inert. Executable snippets use the explicit Run
        // action and its separately isolated, time-limited no-network worker.
        frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; form-action 'none'; base-uri 'none'">${code}`;
}
export function performAssistantAction(button, action, id) {
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
    actions[action]?.();
}
export function installAssistantActions(root = document) {
    root.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const attachment = target?.closest('.chat-attachment-list [data-attachment-preview]');
        if (attachment) {
            const url = attachment.dataset.attachmentPreview;
            if (isSafeImagePreview(url)) window.openImageLightbox?.(url, attachment.dataset.attachmentName || 'Image');
            return;
        }
    });
    root.addEventListener('keydown', event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const target = event.target instanceof Element ? event.target : null;
        const attachment = target?.closest('.chat-attachment-list [data-attachment-preview]');
        if (attachment) { event.preventDefault(); attachment.click?.(); }
    });
    root.addEventListener('error', event => {
        const image = event.target;
        if (!(image instanceof HTMLImageElement) || !image.classList.contains('chat-attachment-image')) return;
        const card = image.closest('.chat-attachment-card[data-attachment-preview]');
        if (!card) return;
        image.remove();
        const badge = card.querySelector('.chat-attachment-badge');
        if (badge) badge.hidden = false;
        card.classList.remove('is-image');
        card.removeAttribute('role'); card.removeAttribute('tabindex');
        card.removeAttribute('data-attachment-preview');
        card.title = 'Preview unavailable. Reattach a JPEG or PNG image.';
        const notice = document.createElement('span');
        notice.className = 'chat-attachment-size'; notice.textContent = 'Preview unavailable';
        card.querySelector('.chat-attachment-meta')?.append(notice);
    }, true);
    root.addEventListener('click', event => {
        const target = event.target instanceof Element ? event.target : null;
        const citation = target?.closest('.assistant-message-text .citation-source-logo[data-source-id]');
        if (citation) window.JarvisLiveResearch?.highlightSource?.(citation.dataset.sourceId);
    });
}
