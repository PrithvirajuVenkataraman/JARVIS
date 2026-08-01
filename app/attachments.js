const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACT_CHARS = 120000;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|py|java|cpp|c|h|cs|go|rs|rb|php|sh|yaml|yml|toml|ini|log|sql|rtf)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i;

const pendingAttachments = [];

let pdfLoaderPromise = null;
let jsZipLoaderPromise = null;

export function getPendingAttachments() {
    return pendingAttachments.slice();
}

export function hasPendingAttachments() {
    return pendingAttachments.length > 0;
}

export function clearPendingAttachments() {
    pendingAttachments.splice(0, pendingAttachments.length);
}

export function removePendingAttachment(id) {
    const index = pendingAttachments.findIndex(item => item.id === id);
    if (index === -1) return false;
    const [removed] = pendingAttachments.splice(index, 1);
    if (removed?.previewUrl) {
        try { URL.revokeObjectURL(removed.previewUrl); } catch (_) {}
    }
    return true;
}

export async function addFilesToComposer(fileList = []) {
    const files = Array.from(fileList || []).filter(Boolean);
    const added = [];
    const errors = [];
    for (const file of files) {
        if (pendingAttachments.length >= MAX_ATTACHMENTS) {
            errors.push(`Only ${MAX_ATTACHMENTS} attachments are allowed per message.`);
            break;
        }
        const validation = validateFile(file);
        if (!validation.ok) {
            errors.push(validation.message);
            continue;
        }
        const attachment = await createPendingAttachment(file);
        pendingAttachments.push(attachment);
        added.push(attachment);
    }
    return { added, errors };
}

export function takePendingForSend() {
    const items = pendingAttachments.splice(0, pendingAttachments.length);
    return items;
}

export async function ingestAllForMessage(attachments = [], userText = '') {
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) return null;

    const sections = [];
    const methods = [];
    for (const attachment of items) {
        const result = await ingestAttachmentWithFallback(attachment);
        methods.push({
            name: attachment.name,
            method: result.method,
            provider: result.provider,
            ok: result.ok
        });
        const header = `### ${attachment.name} (${attachment.mimeType || 'unknown'})`;
        if (result.text) {
            sections.push(`${header}\nExtraction: ${result.method}\n\n${clipText(result.text)}`);
        } else {
            sections.push(`${header}\nExtraction failed. ${result.message || 'No readable text found.'}`);
        }
    }

    const combined = sections.join('\n\n---\n\n').trim();
    const prompt = String(userText || '').trim() || 'Please analyze the attached file(s).';
    return {
        grounding: {
            selectedText: combined,
            sourceAnswer: combined,
            originalRequest: prompt,
            customInstruction: [
                'Answer the user using only the attached file content below.',
                'If extraction is partial or missing, say what you can and cannot verify from the attachment.',
                'Do not invent content that is not present in the attachment text.'
            ].join(' ')
        },
        methods,
        combinedText: combined
    };
}

export async function ingestAttachmentWithFallback(attachment) {
    const attempts = [];

    const localText = await extractLocally(attachment).catch(error => ({
        ok: false,
        text: '',
        method: 'client',
        provider: 'client',
        message: String(error?.message || error),
        attempts: [{ stage: 'client', ok: false, method: 'client_error', error: String(error?.message || error) }]
    }));
    attempts.push(...(localText.attempts || []));
    if (localText?.text) {
        return { ...localText, attempts };
    }

    const server = await ingestOnServer(attachment, localText).catch(error => ({
        ok: false,
        text: '',
        method: 'server',
        provider: 'server',
        message: String(error?.message || error),
        attempts: [{ stage: 'server', ok: false, method: 'server_error', error: String(error?.message || error) }]
    }));
    attempts.push(...(server.attempts || []));
    if (server?.text && (server.ok || server.partial)) {
        return { ...server, attempts };
    }

    if (isImageAttachment(attachment)) {
        const vision = await ingestViaVision(attachment).catch(error => ({
            ok: false,
            text: '',
            method: 'vision_ocr',
            provider: 'vision',
            message: String(error?.message || error)
        }));
        attempts.push({ stage: 'vision_ocr', ok: Boolean(vision?.text), method: vision?.method || 'vision_ocr' });
        if (vision?.text) return { ...vision, attempts };
    }

    return {
        ok: false,
        text: server?.text || localText?.text || '',
        partial: Boolean(server?.partial),
        method: 'none',
        provider: 'none',
        message: server?.message || localText?.message || `Could not extract readable content from ${attachment.name}.`,
        attempts
    };
}

async function extractLocally(attachment) {
    const attempts = [];
    const file = attachment?.file;
    if (!file) {
        return { ok: false, text: '', method: 'client', provider: 'client', attempts };
    }

    if (isTextLikeFile(file)) {
        const text = await readFileAsText(file);
        attempts.push({ stage: 'client_text', ok: Boolean(text), method: 'client_text' });
        if (text) {
            return { ok: true, text, method: 'client_text', provider: 'client', attempts };
        }
    }

    if (isPdfFile(file)) {
        const pdfText = await extractPdfTextClient(file).catch(() => '');
        attempts.push({ stage: 'client_pdf', ok: Boolean(pdfText), method: 'client_pdf' });
        if (pdfText) {
            return { ok: true, text: pdfText, method: 'client_pdf', provider: 'client', attempts };
        }
    }

    if (isDocxFile(file)) {
        const docxText = await extractDocxTextClient(file).catch(() => '');
        attempts.push({ stage: 'client_docx', ok: Boolean(docxText), method: 'client_docx' });
        if (docxText) {
            return { ok: true, text: docxText, method: 'client_docx', provider: 'client', attempts };
        }
    }

    return { ok: false, text: '', method: 'client', provider: 'client', attempts };
}

async function ingestOnServer(attachment, localResult = {}) {
    const base64 = attachment?.base64 || await fileToBase64(attachment.file);
    const data = await postJson('/api/ingest-attachment', {
        filename: attachment.name,
        mimeType: attachment.mimeType,
        base64,
        clientText: '',
        clientMethod: ''
    }, { timeoutMs: 45000 });
    return {
        ok: Boolean(data?.ok || data?.success),
        text: String(data?.text || ''),
        partial: data?.partial === true,
        method: String(data?.method || 'server'),
        provider: String(data?.provider || 'server'),
        message: String(data?.message || ''),
        attempts: Array.isArray(data?.attempts) ? data.attempts : []
    };
}

async function ingestViaVision(attachment) {
    const base64 = attachment?.base64 || await fileToBase64(attachment.file);
    const mimeType = normalizeImageMime(attachment.mimeType, attachment.name);
    const data = await postJson('/api/vision', {
        task: 'text_extract',
        prompt: `Extract all readable text from this attachment (${attachment.name}). Preserve line order and numbers.`,
        mimeType,
        imageBase64: base64
    }, { timeoutMs: 45000 });
    const details = data?.details && typeof data.details === 'object' ? data.details : {};
    const fullText = String(details?.fullText || '').trim();
    const snippets = Array.isArray(details?.textDetected)
        ? details.textDetected.map(item => String(item || '').trim()).filter(Boolean).join('\n').trim()
        : '';
    const text = fullText || snippets || String(data?.response || '').trim();
    return {
        ok: Boolean(text),
        text: clipText(text),
        method: 'vision_ocr',
        provider: 'vision'
    };
}

function validateFile(file) {
    if (!file) return { ok: false, message: 'No file selected.' };
    if (file.size > MAX_FILE_BYTES) {
        return { ok: false, message: `${file.name} is too large. Max size is ${formatBytes(MAX_FILE_BYTES)}.` };
    }
    return { ok: true };
}

async function createPendingAttachment(file) {
    const base64 = await fileToBase64(file);
    const previewUrl = (file.type || '').startsWith('image/') || IMAGE_EXTENSIONS.test(file.name)
        ? URL.createObjectURL(file)
        : '';
    return {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: file.type || guessMimeFromName(file.name),
        size: file.size,
        file,
        base64,
        previewUrl
    };
}

function isTextLikeFile(file) {
    return TEXT_EXTENSIONS.test(file.name) || /^text\//i.test(file.type || '') ||
        ['application/json', 'application/xml', 'application/javascript'].includes(file.type || '');
}

function isPdfFile(file) {
    return file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
}

function isDocxFile(file) {
    return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(file.name);
}

function isImageAttachment(attachment) {
    const mimeType = attachment?.mimeType || '';
    const name = attachment?.name || '';
    return /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
}

function normalizeImageMime(mimeType, filename) {
    if (/^image\//i.test(mimeType)) return mimeType;
    if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
    if (/\.png$/i.test(filename)) return 'image/png';
    if (/\.webp$/i.test(filename)) return 'image/webp';
    if (/\.gif$/i.test(filename)) return 'image/gif';
    return 'image/jpeg';
}

function guessMimeFromName(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    return 'application/octet-stream';
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(clipText(String(reader.result || '')));
        reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
        reader.readAsText(file);
    });
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || '');
            const comma = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(reader.error || new Error('Could not encode file.'));
        reader.readAsDataURL(file);
    });
}

async function extractPdfTextClient(file) {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    const doc = await pdfjs.getDocument({ data: buffer }).promise;
    const parts = [];
    const pageCount = Math.min(doc.numPages || 0, 20);
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        const page = await doc.getPage(pageNumber);
        const content = await page.getTextContent();
        const text = content.items.map(item => String(item?.str || '')).join(' ').trim();
        if (text) parts.push(text);
    }
    return clipText(parts.join('\n\n'));
}

async function extractDocxTextClient(file) {
    const JSZip = await loadJsZip();
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const entry = zip.file('word/document.xml');
    if (!entry) return '';
    const xml = await entry.async('text');
    const pieces = Array.from(xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
        .map(match => decodeXmlEntities(match[1] || ''))
        .filter(Boolean);
    return clipText(pieces.join(' ').replace(/\s+/g, ' '));
}

async function loadPdfJs() {
    if (!pdfLoaderPromise) {
        pdfLoaderPromise = import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs')
            .then(mod => {
                const pdfjs = mod?.default || mod;
                if (pdfjs?.GlobalWorkerOptions) {
                    pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
                }
                return pdfjs;
            });
    }
    return pdfLoaderPromise;
}

async function loadJsZip() {
    if (!jsZipLoaderPromise) {
        jsZipLoaderPromise = import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm').then(mod => mod.default || mod);
    }
    return jsZipLoaderPromise;
}

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function clipText(text) {
    const value = String(text || '').replace(/\u0000/g, '').trim();
    if (!value) return '';
    return value.length > MAX_EXTRACT_CHARS ? `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[Truncated]` : value;
}

export function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function renderAttachmentTray(container, attachments, onRemove) {
    if (!container) return;
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    container.innerHTML = items.map(item => {
        const preview = item.previewUrl
            ? `<img src="${escapeHtml(item.previewUrl)}" alt="" class="composer-attachment-thumb">`
            : `<span class="composer-attachment-icon" aria-hidden="true">📄</span>`;
        return `
            <div class="composer-attachment-chip" data-attachment-id="${escapeHtml(item.id)}">
                ${preview}
                <div class="composer-attachment-meta">
                    <span class="composer-attachment-name">${escapeHtml(item.name)}</span>
                    <span class="composer-attachment-size">${escapeHtml(formatBytes(item.size))}</span>
                </div>
                <button type="button" class="composer-attachment-remove" data-remove-attachment="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-remove-attachment]').forEach(button => {
        button.addEventListener('click', () => {
            const id = button.getAttribute('data-remove-attachment');
            if (id) onRemove?.(id);
        });
    });
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

async function postJson(path, payload, options = {}) {
    if (globalThis.JarvisApi?.postJson) {
        return globalThis.JarvisApi.postJson(path, payload, options);
    }
    const timeoutMs = Number(options.timeoutMs) || 30000;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify(payload || {})
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data?.success === false) {
            throw new Error(data?.error?.message || data?.message || `Request failed (${response.status})`);
        }
        return data;
    } finally {
        clearTimeout(timeout);
    }
}

export function showComposerMenuGroup(menu, groupName) {
    if (!menu) return;
    menu.querySelectorAll('[data-composer-group]').forEach(group => {
        group.classList.toggle('hidden', group.getAttribute('data-composer-group') !== groupName);
    });
}
