const MAX_ATTACHMENTS = 6;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const MAX_EXTRACT_CHARS = 120000;
const PDF_VISUAL_PAGE_LIMIT = 4;
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
    const imagePayloads = [];
    let anyReadable = false;

    for (const attachment of items) {
        if (isImageAttachment(attachment)) {
            const base64 = await resolveAttachmentBase64(attachment).catch(() => '');
            if (base64) {
                anyReadable = true;
                imagePayloads.push({
                    name: attachment.name,
                    mimeType: normalizeImageMime(attachment.mimeType, attachment.name),
                    base64
                });
                methods.push({ name: attachment.name, method: 'single_pass_native_image', provider: 'native', ok: true });
                sections.push(`### ${attachment.name} (Attached Image)\n[Image attached for native vision processing]`);
                continue;
            }
        }

        const result = await ingestAttachmentWithFallback(attachment);
        methods.push({
            name: attachment.name,
            method: result.method,
            provider: result.provider,
            ok: result.ok
        });
        const header = `### ${attachment.name} (${attachment.mimeType || 'unknown'})`;
        if (result.text && hasUsefulExtractedText(result.text)) {
            anyReadable = true;
            sections.push(`${header}\nExtraction: ${result.method}\n\n${clipText(result.text)}`);
        } else {
            sections.push(`${header}\nExtraction failed or returned too little readable text. ${result.message || 'No readable text found.'}`);
        }
    }

    const combined = sections.join('\n\n---\n\n').trim();
    const prompt = String(userText || '').trim() || 'Please analyze the attached file(s).';
    let readableSections = anyReadable
        ? sections.filter(section => !/Extraction failed or returned too little readable text/i.test(section)).join('\n\n---\n\n').trim()
        : '';
    if (anyReadable && readableSections && shouldRankAttachmentText(prompt)) {
        readableSections = await rankAttachmentTextForQuery(prompt, readableSections).catch(() => readableSections);
    }
    return {
        grounding: anyReadable
            ? {
                kind: 'attachment',
                selectedText: readableSections || combined,
                images: imagePayloads.length ? imagePayloads : undefined,
                sourceAnswer: readableSections || combined,
                originalRequest: prompt,
                customInstruction: [
                    'The content below is the attached document(s)/image(s).',
                    'Answer the user request using this attachment content.',
                    'Do not ask the user to upload, paste, share, or provide the same file again.'
                ].join(' ')
            }
            : null,
        methods,
        combinedText: readableSections || combined,
        anyReadable
    };
}

async function rankAttachmentTextForQuery(query, text) {
    const source = String(text || '').trim();
    if (!source || source.length < 900) return source;
    try {
        const data = await postJson('/api/rank-texts', {
            query: String(query || '').trim(),
            text: source,
            limit: 6,
            maxChunks: 16,
            useRerank: true
        }, { timeoutMs: 15000 });
        if (!data?.available || !Array.isArray(data?.ranked) || !data.ranked.length) return source;
        const rankedText = data.ranked
            .map(item => String(item?.text || '').trim())
            .filter(Boolean)
            .join('\n\n');
        return rankedText || source;
    } catch (_) {
        return source;
    }
}

function shouldRankAttachmentText(query) {
    const value = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (!value) return false;
    if (/\b(analy[sz]e|review|summari[sz]e|explain|understand|read|see everything|whole|entire|full|overall|all pages?|attached file|attached document|pdf)\b/.test(value)) {
        return false;
    }
    return /\b(find|extract|where|when|who|which|specific|date|dates|name|names|number|numbers|email|phone|address|section|clause|quote)\b/.test(value);
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
    if (isPdfFile(attachment?.file || attachment)) {
        return await ingestPdfAttachmentWithVisuals(attachment, localText, attempts);
    }
    if (hasUsefulExtractedText(localText?.text)) {
        return { ...localText, ok: true, attempts };
    }

    const server = await ingestOnServer(attachment, localResultSafe(localText)).catch(error => ({
        ok: false,
        text: '',
        method: 'server',
        provider: 'server',
        message: String(error?.message || error),
        attempts: [{ stage: 'server', ok: false, method: 'server_error', error: String(error?.message || error) }]
    }));
    attempts.push(...(server.attempts || []));
    if (hasUsefulExtractedText(server?.text) && !isMetadataOnlyExtract(server?.text)) {
        return { ...server, ok: true, attempts };
    }

    if (isImageAttachment(attachment)) {
        const vision = await ingestViaVision(attachment).catch(error => ({
            ok: false,
            text: '',
            method: 'vision_analysis',
            provider: 'vision',
            message: String(error?.message || error)
        }));
        const hasVisualText = Boolean(vision?.text && String(vision.text).trim().length >= 10);
        attempts.push({
            stage: 'vision_analysis',
            ok: hasVisualText,
            method: vision?.method || 'vision_analysis'
        });
        if (hasVisualText) {
            return { ...vision, ok: true, attempts };
        }
    } else if (isPdfFile(attachment?.file || attachment)) {
        const vision = await extractPdfViaVision(attachment).catch(error => ({
            ok: false,
            text: '',
            method: 'pdf_vision_ocr',
            provider: 'vision',
            message: String(error?.message || error)
        }));
        attempts.push({
            stage: vision?.method || 'pdf_vision_ocr',
            ok: hasUsefulExtractedText(vision?.text),
            method: vision?.method || 'pdf_vision_ocr'
        });
        if (hasUsefulExtractedText(vision?.text)) {
            return { ...vision, ok: true, attempts };
        }
    }

    return {
        ok: false,
        text: '',
        partial: false,
        method: 'none',
        provider: 'none',
        message: server?.message || localText?.message || `Could not extract readable content from ${attachment.name}.`,
        attempts
    };
}

async function ingestPdfAttachmentWithVisuals(attachment, localText, attempts) {
    let server = null;
    if (!hasUsefulExtractedText(localText?.text) || isMetadataOnlyExtract(localText?.text)) {
        server = await ingestOnServer(attachment, localResultSafe(localText)).catch(error => ({
            ok: false,
            text: '',
            method: 'server',
            provider: 'server',
            message: String(error?.message || error),
            attempts: [{ stage: 'server', ok: false, method: 'server_error', error: String(error?.message || error) }]
        }));
        attempts.push(...(server.attempts || []));
    }

    const vision = await extractPdfViaVision(attachment).catch(error => ({
        ok: false,
        text: '',
        method: 'pdf_visual_analysis',
        provider: 'vision',
        message: String(error?.message || error)
    }));
    attempts.push({
        stage: vision?.method || 'pdf_visual_analysis',
        ok: hasUsefulExtractedText(vision?.text) || String(vision?.text || '').trim().length >= 40,
        method: vision?.method || 'pdf_visual_analysis'
    });

    const sections = [];
    if (hasUsefulExtractedText(localText?.text)) {
        sections.push(`PDF text layer (${localText.method || 'client_pdf'}):\n${String(localText.text || '').trim()}`);
    }
    if (hasUsefulExtractedText(server?.text) && !isDuplicateText(server.text, localText?.text)) {
        sections.push(`Server text extraction (${server.method || 'server_pdf'}):\n${String(server.text || '').trim()}`);
    }
    if (String(vision?.text || '').trim()) {
        sections.push(`Rendered page visual analysis (${vision.method || 'pdf_visual_analysis'}):\n${String(vision.text || '').trim()}`);
    }

    const combined = clipText(dedupeSections(sections).join('\n\n'));
    const ok = hasUsefulExtractedText(combined) || combined.length >= 40;
    return {
        ok,
        text: combined,
        partial: vision?.partial === true || server?.partial === true,
        method: sections.length > 1 ? 'pdf_text_plus_visual' : (localText?.method || server?.method || vision?.method || 'pdf'),
        provider: sections.length > 1 ? 'client+vision' : (localText?.provider || server?.provider || vision?.provider || 'client'),
        message: ok ? '' : (vision?.message || server?.message || localText?.message || `Could not extract readable content from ${attachment?.name || 'PDF'}.`),
        attempts
    };
}

function localResultSafe(localText) {
    if (hasUsefulExtractedText(localText?.text) && !isMetadataOnlyExtract(localText?.text)) return localText;
    return { text: '', method: localText?.method || 'client' };
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
        const useful = hasUsefulExtractedText(pdfText);
        attempts.push({ stage: 'client_pdf', ok: useful, method: 'client_pdf' });
        if (useful) {
            return { ok: true, text: pdfText, method: 'client_pdf', provider: 'client', attempts };
        }
    }

    if (isDocxFile(file)) {
        const docxText = await extractDocxTextClient(file).catch(() => '');
        const useful = hasUsefulExtractedText(docxText);
        attempts.push({ stage: 'client_docx', ok: useful, method: 'client_docx' });
        if (useful) {
            return { ok: true, text: docxText, method: 'client_docx', provider: 'client', attempts };
        }
    }

    if (isPptxFile(file)) {
        const pptxText = await extractPptxTextClient(file).catch(() => '');
        const useful = hasUsefulExtractedText(pptxText);
        attempts.push({ stage: 'client_pptx', ok: useful, method: 'client_pptx' });
        if (useful) {
            return { ok: true, text: pptxText, method: 'client_pptx', provider: 'client', attempts };
        }
    }

    return { ok: false, text: '', method: 'client', provider: 'client', attempts };
}

async function ingestOnServer(attachment, localResult = {}) {
    const clientText = hasUsefulExtractedText(localResult?.text) ? String(localResult.text || '') : '';
    const base64 = await resolveAttachmentBase64(attachment, { allowEmpty: Boolean(clientText) });
    if (!clientText && !base64) {
        throw new Error(`Attachment payload is empty for ${attachment?.name || 'attachment'}. Please reattach the file and try again.`);
    }
    logAttachmentIngestDiagnostics(attachment, { base64, clientText });
    const data = await postJson('/api/ingest-attachment', {
        filename: attachment.name,
        mimeType: attachment.mimeType,
        base64,
        clientText,
        clientMethod: String(localResult?.method || '')
    }, { timeoutMs: 45000 });
    return {
        ok: Boolean(data?.ok || data?.success) && hasUsefulExtractedText(data?.text),
        text: String(data?.text || ''),
        partial: data?.partial === true,
        method: String(data?.method || 'server'),
        provider: String(data?.provider || 'server'),
        message: String(data?.message || ''),
        attempts: Array.isArray(data?.attempts) ? data.attempts : []
    };
}

async function ingestViaVision(attachment) {
    const base64 = await resolveAttachmentBase64(attachment);
    const mimeType = normalizeImageMime(attachment.mimeType, attachment.name);
    const data = await postJson('/api/vision', {
        task: 'general_vision',
        prompt: `Analyze and describe this image (${attachment.name}) in complete detail. Describe the subject, scene, objects, people, background, colors, layout, text (if any), and key visual features.`,
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
        ok: Boolean(text && text.length >= 10),
        text: clipText(text),
        method: 'vision_analysis',
        provider: 'vision'
    };
}

async function resolveAttachmentBase64(attachment, options = {}) {
    const existing = String(attachment?.base64 || '').trim();
    if (existing) return existing;
    const file = attachment?.file;
    if (!file) {
        if (options.allowEmpty) return '';
        throw new Error(`Missing file data for ${attachment?.name || 'attachment'}. Please reattach the file and try again.`);
    }
    const encoded = String(await fileToBase64(file) || '').trim();
    if (!encoded && !options.allowEmpty) {
        throw new Error(`Could not encode ${attachment?.name || file.name || 'attachment'}. Please reattach the file and try again.`);
    }
    return encoded;
}

function logAttachmentIngestDiagnostics(attachment, payload = {}) {
    try {
        const host = String(globalThis?.location?.hostname || '');
        const isDev = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
        if (!isDev) return;
        console.info('[attachments] ingest request', {
            filename: attachment?.name || 'attachment',
            mimeType: attachment?.mimeType || '',
            size: Number(attachment?.size) || Number(attachment?.file?.size) || 0,
            hasBase64: Boolean(payload.base64),
            base64Length: String(payload.base64 || '').length,
            hasClientText: Boolean(payload.clientText)
        });
    } catch (_) {}
}

function validateFile(file) {
    if (!file) return { ok: false, message: 'No file selected.' };
    if (file.size > MAX_FILE_BYTES) {
        return { ok: false, message: `${file.name} is too large. Max size is ${formatBytes(MAX_FILE_BYTES)}.` };
    }
    return { ok: true };
}

async function createPendingAttachment(file) {
    const isImage = (file.type || '').startsWith('image/') || IMAGE_EXTENSIONS.test(file.name);
    const base64 = isImage
        ? await compressImageFileToBase64(file).catch(() => fileToBase64(file))
        : await fileToBase64(file);
    const previewUrl = isImage ? URL.createObjectURL(file) : '';
    return {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        mimeType: isImage ? 'image/jpeg' : (file.type || guessMimeFromName(file.name)),
        size: file.size,
        file,
        base64,
        previewUrl
    };
}

async function compressImageFileToBase64(file, maxDimension = 1280, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (typeof document === 'undefined' || typeof Image === 'undefined') {
            return resolve(fileToBase64(file));
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let width = img.width;
                let height = img.height;
                if (width > maxDimension || height > maxDimension) {
                    if (width > height) {
                        height = Math.round((height * maxDimension) / width);
                        width = maxDimension;
                    } else {
                        width = Math.round((width * maxDimension) / height);
                        height = maxDimension;
                    }
                }
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                const comma = dataUrl.indexOf(',');
                resolve(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl);
            };
            img.onerror = () => {
                fileToBase64(file).then(resolve).catch(reject);
            };
            img.src = e.target.result;
        };
        reader.onerror = () => fileToBase64(file).then(resolve).catch(reject);
        reader.readAsDataURL(file);
    });
}

function isTextLikeFile(file) {
    return TEXT_EXTENSIONS.test(file.name) || /^text\//i.test(file.type || '') ||
        ['application/json', 'application/xml', 'application/javascript'].includes(file.type || '');
}

function isPdfFile(fileOrAttachment) {
    const file = fileOrAttachment?.file || fileOrAttachment;
    const name = file?.name || fileOrAttachment?.name || fileOrAttachment?.filename || '';
    const type = file?.type || fileOrAttachment?.type || fileOrAttachment?.mimeType || '';
    return type === 'application/pdf' || /\.pdf$/i.test(name);
}

function isDocxFile(file) {
    return file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(file.name);
}

function isPptxFile(file) {
    return file.type === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || /\.pptx$/i.test(file.name);
}

function isImageAttachment(attachment) {
    const mimeType = attachment?.mimeType || '';
    const name = attachment?.name || '';
    return /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
}

function hasUsefulExtractedText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length < 40) return false;
    if (isMetadataOnlyExtract(value)) return false;
    const letters = (value.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return letters >= 24;
}

function isMetadataOnlyExtract(text) {
    const value = String(text || '').toLowerCase();
    if (!value) return true;
    return /no readable text could be extracted|extraction failed|attached file:\s*.+\s*type:\s*|could not extract readable/.test(value) &&
        !/\b(experience|education|skills|resume|curriculum|project|internship|objective|summary|email|phone|@)\b/i.test(value);
}

function isDuplicateText(left, right) {
    const a = String(left || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    const b = String(right || '').replace(/\s+/g, ' ').trim().slice(0, 1200);
    return Boolean(a && b && (a === b || a.includes(b.slice(0, 300)) || b.includes(a.slice(0, 300))));
}

function dedupeSections(sections = []) {
    const out = [];
    for (const section of sections.map(item => String(item || '').trim()).filter(Boolean)) {
        if (!out.some(existing => isDuplicateText(existing, section))) out.push(section);
    }
    return out;
}

export function buildChatAttachmentMeta(attachments = []) {
    return (Array.isArray(attachments) ? attachments : []).map(item => {
        const mimeType = item?.mimeType || guessMimeFromName(item?.name || '');
        const name = String(item?.name || 'attachment');
        const isImage = /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
        const kind = isImage
            ? 'image'
            : (/\.pdf$/i.test(name) || mimeType === 'application/pdf'
                ? 'pdf'
                : (/\.docx?$/i.test(name) ? 'doc' : (/\.pptx?$/i.test(name) ? 'ppt' : 'file')));
        let previewUrl = '';
        if (isImage) {
            previewUrl = item.previewUrl || (item.base64 ? `data:${normalizeImageMime(mimeType, name)};base64,${item.base64}` : '');
        }
        return {
            id: String(item?.id || ''),
            name,
            mimeType,
            size: Number(item?.size) || 0,
            kind,
            previewUrl
        };
    });
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
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
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
        if (!file) {
            reject(new Error('Missing file.'));
            return;
        }
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

async function extractPdfViaVision(attachment) {
    const file = attachment?.file;
    if (!file) {
        return { ok: false, text: '', method: 'pdf_vision_ocr', provider: 'vision', message: 'Missing PDF file.' };
    }
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    const pageCount = Math.min(doc.numPages || 0, PDF_VISUAL_PAGE_LIMIT);

    // Process pages in parallel for speed (max 3 concurrent)
    const pagePromises = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
        pagePromises.push(processPdfPageVision(attachment, pdfjs, doc, pageNumber));
    }

    // Wait for all pages with a shorter overall timeout
    const results = await Promise.allSettled(pagePromises);
    const parts = [];
    for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
            parts.push(result.value);
        }
    }

    const text = clipText(parts.join('\n\n'));
    return {
        ok: hasUsefulExtractedText(text),
        text,
        method: 'pdf_vision_ocr',
        provider: 'vision',
        message: hasUsefulExtractedText(text) ? '' : 'PDF vision OCR found little readable text.'
    };
}

async function processPdfPageVision(attachment, pdfjs, doc, pageNumber) {
    try {
        const page = await doc.getPage(pageNumber);
        // Use lower scale (1.2 instead of 1.6) for faster rendering
        const viewport = page.getViewport({ scale: 1.2 });
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return '';
        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75); // Lower quality for speed
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!base64) return '';

        // Reduced timeout for per-page vision calls
        const data = await postJson('/api/vision', {
            task: 'general_vision',
            prompt: `Analyze page ${pageNumber} of PDF "${attachment.name}" like a multimodal document reader. Extract all readable text, but also describe visible tables, charts, diagrams, screenshots, handwriting, layout, labels, stamps, signatures, and relationships between visual elements. Preserve important names, dates, emails, phone numbers, amounts, headings, and page structure. If a page is mostly visual, describe what is visible instead of saying no text was found.`,
            mimeType: 'image/jpeg',
            imageBase64: base64
        }, { timeoutMs: 15000 }); // Reduced from 45000 to 15000

        const details = data?.details && typeof data.details === 'object' ? data.details : {};
        const fullText = String(details?.fullText || '').trim();
        const snippets = Array.isArray(details?.textDetected)
            ? details.textDetected.map(item => String(item || '').trim()).filter(Boolean).join('\n').trim()
            : '';
        const pageText = [fullText || snippets, String(data?.response || '').trim()]
            .filter(Boolean)
            .join('\n\n')
            .trim();

        if (hasUsefulExtractedText(pageText) || pageText.length >= 40) {
            return `Page ${pageNumber} visual observations:\n${pageText}`;
        }
        return '';
    } catch (error) {
        console.warn(`PDF page ${pageNumber} vision OCR failed:`, error);
        return '';
    }
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

async function extractPptxTextClient(file) {
    const JSZip = await loadJsZip();
    const buffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(buffer);
    const slideFiles = Object.keys(zip.files || {})
        .filter(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
        .sort((a, b) => {
            const na = Number((a.match(/slide(\d+)/i) || [])[1] || 0);
            const nb = Number((b.match(/slide(\d+)/i) || [])[1] || 0);
            return na - nb;
        })
        .slice(0, 30);
    const parts = [];
    for (const slideName of slideFiles) {
        const entry = zip.file(slideName);
        if (!entry) continue;
        const xml = await entry.async('text');
        const pieces = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
            .map(match => decodeXmlEntities(match[1] || ''))
            .filter(Boolean);
        const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
        if (text) parts.push(text);
    }
    return clipText(parts.join('\n\n'));
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

export function renderAttachmentTray(container, attachments, onRemove, options = {}) {
    if (!container) return;
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) {
        container.innerHTML = '';
        container.classList.add('hidden');
        return;
    }
    container.classList.remove('hidden');
    const reading = Boolean(options?.reading);
    container.classList.toggle('is-reading', reading);
    const statusHtml = reading
        ? `<div class="composer-attachment-status" role="status">Reading attachments…</div>`
        : '';
    const fileIcon = `<span class="composer-attachment-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg></span>`;
    container.innerHTML = statusHtml + items.map(item => {
        const preview = item.previewUrl
            ? `<img src="${escapeHtml(item.previewUrl)}" alt="" class="composer-attachment-thumb">`
            : fileIcon;
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

export function setAttachmentTrayReading(container, reading = true) {
    if (!container) return;
    if (reading) {
        container.classList.remove('hidden');
        container.classList.add('is-reading');
        if (!container.querySelector('.composer-attachment-status')) {
            container.insertAdjacentHTML('afterbegin', `<div class="composer-attachment-status" role="status">Reading attachments…</div>`);
        }
        return;
    }
    container.classList.remove('is-reading');
    container.querySelector('.composer-attachment-status')?.remove();
    if (!container.querySelector('.composer-attachment-chip')) {
        container.innerHTML = '';
        container.classList.add('hidden');
    }
}

function detectSceneTask(attachment) {
    const name = (attachment?.name || '').toLowerCase();
    const mimeType = (attachment?.mimeType || '').toLowerCase();

    // Use scene understanding for images that are likely photos/scenes, not documents
    const isLikelyPhoto = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(name) &&
        !/(scan|document|receipt|invoice|bill|statement|form|page|slide|screenshot)/i.test(name);

    // Check if user text suggests they want to know "what is this" vs "read this"
    const userText = (globalThis?.currentUserText || '').toLowerCase();
    const wantsSceneAnalysis = /\b(what is this|what's this|identify|what do you see|what animal|what object|what vehicle|describe|analyze|scene|photo|picture)\b/i.test(userText);

    // For PDFs, check if it's likely a scanned document vs a presentation with images
    const isPdf = mimeType === 'application/pdf' || /\.pdf$/i.test(name);

    return (isLikelyPhoto || wantsSceneAnalysis) && !isPdf;
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
