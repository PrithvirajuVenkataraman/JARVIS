import { RAW_IMAGE_EXTENSIONS } from './image-decoder-core.js';
import { decodeImageFile, cancelImageDecoding } from './image-decoder.js';
import { formatBytes, detectImageMime, imageNameForMime } from './file-format.js';
import { postJson as postApiJson } from './api-client.js';
import { jsonByteLength, MAX_JSON_REQUEST_BYTES, payloadSizeError } from './request-payload.js';
import * as BM25Module from './bm25.js?v=2.0.5';

const BM25Index = BM25Module.BM25Index;
const computeBM25Scores = BM25Module.computeBM25Scores;

const textToEmbeddingVector = typeof BM25Module.textToEmbeddingVector === 'function'
    ? BM25Module.textToEmbeddingVector
    : function fallbackTextToEmbeddingVector(text, dim = 512) {
        const v = new Float32Array(dim);
        const tokens = String(text || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
        if (!tokens.length) return v;
        for (const token of tokens) {
            let h1 = 0x811c9dc5;
            let h2 = 0x5bd1e995;
            for (let i = 0; i < token.length; i++) {
                const code = token.charCodeAt(i);
                h1 ^= code;
                h1 = Math.imul(h1, 0x01000193);
                h2 ^= code;
                h2 = Math.imul(h2, 0x5bd1e995);
            }
            const idx1 = Math.abs(h1) % dim;
            const idx2 = Math.abs(h2) % dim;
            v[idx1] += 1.0;
            v[idx2] += 0.5;
            if (token.length >= 4) {
                for (let i = 0; i < token.length - 2; i++) {
                    const trigram = token.slice(i, i + 3);
                    let th = 0;
                    for (let j = 0; j < trigram.length; j++) th = (th * 31 + trigram.charCodeAt(j)) | 0;
                    v[Math.abs(th) % dim] += 0.2;
                }
            }
        }
        let norm = 0;
        for (let i = 0; i < dim; i++) norm += v[i] * v[i];
        norm = Math.sqrt(norm);
        if (norm > 0) {
            for (let i = 0; i < dim; i++) v[i] /= norm;
        }
        return v;
    };

const vectorCosineSimilarity = typeof BM25Module.vectorCosineSimilarity === 'function'
    ? BM25Module.vectorCosineSimilarity
    : function fallbackVectorCosineSimilarity(a, b) {
        if (!a || !b) return 0;
        let dot = 0;
        const len = Math.min(a.length, b.length);
        for (let i = 0; i < len; i++) dot += a[i] * b[i];
        return dot;
    };

const MAX_ATTACHMENTS = 12;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_EXTRACT_CHARS = 500000;
const PDF_DIGITAL_PAGE_LIMIT = 100;
const PDF_VISUAL_PAGE_LIMIT = 100; // expanded to 100 pages for heavy scanned documents (batch-streamed)
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|py|java|cpp|c|h|cs|go|rs|rb|php|sh|yaml|yml|toml|ini|log|sql|rtf|eml|msg)$/i;
const IMAGE_EXTENSIONS = /\.(jpe?g|pjpeg|png|gif|webp|bmp|dib|tiff?|heic|heif|heics|heifs|avif|avifs|dng|raw|cr[23]|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|jp2|j2k|jpf|jpx|jpm|pict?|pct|pic|psd|psb|jxl|tga|qoi|exr|hdr|dds|pcx|ppm|pgm|pbm|rwl|srw|kdc|dcr|mrw|x3f|ico|cur|svgz?)$/i;
const VISION_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const XLSX_EXTENSIONS = /\.(xlsx|xls|ods)$/i;
const ZIP_EXTENSIONS = /\.(zip|cbz)$/i;
const EPUB_EXTENSIONS = /\.epub$/i;

/* ── BM25 & Semantic Vector Engine for Attachments ────────── */
const ATTACHMENT_INTENT_INDEX = new BM25Index({ k1: 1.2, b: 0.75 });
const ATTACHMENT_INTENTS = [
    {
        id: 'pinpoint_extraction',
        text: 'find extract locate search pinpoint specific date name number email phone address section clause quote fact detail cite lookup where when who which'
    },
    {
        id: 'global_synthesis',
        text: 'analyze review summarize explain understand read inspect see everything whole entire full overall all pages attached document comprehensive walkthrough synopsis'
    },
    {
        id: 'ocr_status_diagnostic',
        text: 'no clear readable text detected visible could not find detect extract any text unable to detect does not contain readable text no text was detected empty image extraction failed no readable text could be extracted attached file type could not extract readable error status notice'
    },
    {
        id: 'substantive_content',
        text: 'experience education skills resume curriculum project internship objective summary email phone work history employment professional background degree university college certification responsibilities achievements publication research company organization report document data table analysis findings conclusion methodology results discussion section chapter'
    },
    {
        id: 'scene_visual_analysis',
        text: 'what is this identify object animal vehicle scene describe photo picture image view look at visual appearance'
    },
    {
        id: 'document_text_task',
        text: 'read text extract document transcribe scan receipt invoice words text page tabular sheet form statement'
    }
];

const COMPILED_ATTACHMENT_INTENTS = ATTACHMENT_INTENTS.map(p => {
    ATTACHMENT_INTENT_INDEX.addDocument(p.id, p.text, p);
    return {
        ...p,
        vector: textToEmbeddingVector(p.text, 512)
    };
});

function scoreAttachmentIntent(query, categoryId) {
    const raw = String(query || '').trim();
    if (!raw) return 0;
    const proto = COMPILED_ATTACHMENT_INTENTS.find(p => p.id === categoryId);
    if (!proto) return 0;

    const queryVec = textToEmbeddingVector(raw, 512);
    const semSim = vectorCosineSimilarity(queryVec, proto.vector);

    const bm25Res = ATTACHMENT_INTENT_INDEX.search(raw, { topK: 10 });
    const match = bm25Res.find(r => r.doc.id === categoryId);
    const bm25Score = match ? Math.min(1.0, match.score / 4.0) : 0;

    return semSim * 0.5 + bm25Score * 0.5;
}

const pendingAttachments = [];
let preparationEpoch = 0;

// Sliding Window Multimodal Memory for multi-turn visual dialogue continuity (ChatGPT/Gemini style)
const activeSessionImages = [];
const MAX_ACTIVE_SESSION_IMAGES = 3;
const MAX_TOTAL_IMAGE_PAYLOAD_BYTES = 3_000_000; // Encoded characters; reserve space for JSON and chat context.

export function getActiveSessionImages() {
    return activeSessionImages.map(img => ({ ...img }));
}

export function recordActiveSessionImage(imagePayload) {
    if (!imagePayload || typeof imagePayload !== 'object') return;
    const base64 = String(imagePayload.base64 || imagePayload.data || '').trim();
    if (!base64 || base64.length < 50) return;
    const item = {
        name: String(imagePayload.name || 'image.png').trim(),
        mimeType: String(imagePayload.mimeType || 'image/jpeg').trim(),
        base64,
        timestamp: Date.now()
    };
    const existingIdx = activeSessionImages.findIndex(img => img.name === item.name || img.base64.slice(0, 80) === item.base64.slice(0, 80));
    if (existingIdx >= 0) {
        activeSessionImages.splice(existingIdx, 1);
    }
    activeSessionImages.push(item);
    while (activeSessionImages.length > MAX_ACTIVE_SESSION_IMAGES) {
        activeSessionImages.shift();
    }
    let totalSize = activeSessionImages.reduce((sum, img) => sum + img.base64.length, 0);
    while (activeSessionImages.length > 1 && totalSize > MAX_TOTAL_IMAGE_PAYLOAD_BYTES) {
        activeSessionImages.shift();
        totalSize = activeSessionImages.reduce((sum, img) => sum + img.base64.length, 0);
    }
}

export function clearActiveSessionImages() {
    activeSessionImages.splice(0, activeSessionImages.length);
}

let pdfLoaderPromise = null;
let jsZipLoaderPromise = null;
let sheetJsLoaderPromise = null;
let tesseractLoaderPromise = null;

export function getPendingAttachments() {
    return pendingAttachments.slice();
}

export function hasPendingAttachments() {
    return pendingAttachments.length > 0;
}

export function clearPendingAttachments() {
    preparationEpoch++; cancelImageDecoding();
    for (const item of pendingAttachments) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
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
    const epoch = preparationEpoch;
    const files = Array.from(fileList || []).filter(Boolean);
    const added = [];
    const errors = [];
    for (const file of files) {
        if (epoch !== preparationEpoch) break;
        if (pendingAttachments.length >= MAX_ATTACHMENTS) {
            errors.push(`Only ${MAX_ATTACHMENTS} attachments are allowed per message.`);
            break;
        }
        const validation = validateFile(file);
        if (!validation.ok) {
            errors.push(validation.message);
            continue;
        }
        try {
            const attachment = await createPendingAttachment(file);
            if (epoch !== preparationEpoch) { if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl); break; }
            pendingAttachments.push(attachment);
            added.push(attachment);
        } catch (error) {
            if (error?.name !== 'AbortError') errors.push(String(error?.message || 'This file could not be prepared.'));
        }
    }
    return { added, errors };
}

export function takePendingForSend() {
    const items = pendingAttachments.splice(0, pendingAttachments.length);
    return items;
}

export function restorePendingAttachments(items = []) {
    for (const item of items) {
        if (!item?.id || pendingAttachments.length >= MAX_ATTACHMENTS || pendingAttachments.some(existing => existing.id === item.id)) continue;
        pendingAttachments.push(item);
    }
}

const NATIVE_PDF_DIRECT_MAX_BYTES = 2_600_000;

export async function ingestAllForMessage(attachments = [], userText = '') {
    const items = Array.isArray(attachments) ? attachments : [];
    if (!items.length) return null;

    // Process all attachments in parallel, max 4 concurrent to avoid saturating network
    const CONCURRENCY = 4;
    const semaphore = { count: 0 };
    const acquire = () => new Promise(resolve => {
        const tryAcquire = () => {
            if (semaphore.count < CONCURRENCY) { semaphore.count++; resolve(); }
            else setTimeout(tryAcquire, 30);
        };
        tryAcquire();
    });
    const release = () => { semaphore.count--; };

    let totalNativeMediaBytes = 0;

    const processOne = async (attachment) => {
        await acquire();
        try {
            const isImg = isImageAttachment(attachment);
            let imagePayload = null;
            if (isImg) {
                const base64 = await resolveAttachmentBase64(attachment).catch(() => '');
                if (base64) {
                    const finalMime = normalizeImageMime(attachment.mimeType, attachment.name, base64);
                    attachment.mimeType = finalMime;
                    imagePayload = {
                        name: attachment.preparedName || attachment.name,
                        mimeType: finalMime,
                        base64
                    };
                }
                const result = {
                    ok: Boolean(base64),
                    text: '',
                    method: 'single_pass_native_image',
                    provider: 'native'
                };
                attachment.extractedText = '';
                attachment.ocrMethod = 'single_pass_native_image';
                return { attachment, isImg, isPdfNative: false, imagePayload, result };
            }

            // Direct native PDF pass-through: send PDF bytes straight to the Gemini API without client canvas/Tesseract
            const rawFile = attachment?.file;
            const rawPdfSize = Number(rawFile?.size || attachment?.size || 0);
            if (isPdfFile(rawFile || attachment) && rawFile && rawPdfSize > 0 && rawPdfSize <= NATIVE_PDF_DIRECT_MAX_BYTES && (totalNativeMediaBytes + rawPdfSize) <= NATIVE_PDF_DIRECT_MAX_BYTES) {
                totalNativeMediaBytes += rawPdfSize;
                const pdfBase64 = await fileToBase64(rawFile).catch(() => '');
                if (pdfBase64) {
                    attachment.mimeType = 'application/pdf';
                    imagePayload = {
                        name: attachment.preparedName || attachment.name || 'document.pdf',
                        mimeType: 'application/pdf',
                        base64: pdfBase64
                    };
                    const result = {
                        ok: true,
                        text: '',
                        method: 'single_pass_native_pdf',
                        provider: 'native'
                    };
                    attachment.extractedText = '';
                    attachment.ocrMethod = 'single_pass_native_pdf';
                    return { attachment, isImg: false, isPdfNative: true, imagePayload, result };
                }
            }

            const result = await ingestAttachmentWithFallback(attachment, userText);
            attachment.extractedText = String(result.text || '').trim();
            attachment.ocrMethod = result.method || '';
            return { attachment, isImg, isPdfNative: false, imagePayload, result };
        } finally {
            release();
        }
    };

    const settled = await Promise.allSettled(items.map(processOne));

    const sections = [];
    const methods = [];
    const imagePayloads = [];
    const extractionErrors = [];
    let anyReadable = false;

    for (const outcome of settled) {
        if (outcome.status === 'rejected') continue;
        const { attachment, isImg, isPdfNative, imagePayload, result } = outcome.value;

        if (imagePayload) {
            anyReadable = true;
            imagePayloads.push(imagePayload);
            if (isImg) recordActiveSessionImage(imagePayload);
        }

        if (Array.isArray(result?.images) && result.images.length > 0) {
            for (const embeddedImg of result.images.slice(0, 4)) {
                if (embeddedImg?.base64 && imagePayloads.length < 6) {
                    imagePayloads.push(embeddedImg);
                    anyReadable = true;
                }
            }
        }

        const hasResultImages = Array.isArray(result?.images) && result.images.length > 0;
        const hasUsefulText = Boolean(result.text && (hasUsefulExtractedText(result.text) || (result.ok && String(result.text).trim().length >= 4)));

        methods.push({
            name: attachment.name,
            method: result.method || (isImg ? 'single_pass_native_image' : 'none'),
            provider: result.provider || (isImg || isPdfNative ? 'native' : 'none'),
            ok: Boolean(result.ok || ((isImg || isPdfNative) && imagePayload) || hasResultImages)
        });
        const header = `### ${attachment.name} (${attachment.mimeType || 'unknown'})`;
        if (hasUsefulText) {
            anyReadable = true;
            sections.push(`${header}\nExtraction: ${result.method}\n\n${clipText(result.text)}`);
        } else if (isPdfNative && imagePayload) {
            anyReadable = true;
            sections.push(`[Attached Document: ${attachment.name}]`);
        } else if (isImg && imagePayload) {
            anyReadable = true;
            sections.push(`[Attached Image: ${attachment.name}]`);
        } else if (hasResultImages) {
            anyReadable = true;
            sections.push(`[Attached Document Images: ${attachment.name}]`);
        } else {
            if (result?.message) extractionErrors.push(result.message);
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
    const attachmentText = String(readableSections || combined || '').slice(0, 180000);
    return {
        grounding: anyReadable
            ? {
                kind: 'attachment',
                selectedText: attachmentText.slice(0, 60000),
                images: imagePayloads.length ? imagePayloads : undefined,
                sourceAnswer: '',
                originalRequest: prompt,
                customInstruction: [
                    'The user has attached image(s)/document(s).',
                    'Describe and answer directly about what is depicted, including text, diagrams, mathematical expressions, equations, or geometric figures.',
                    'For mathematical or quantitative problems: identify all given values and unknowns from the image; define each variable explicitly before using it; state the relevant formula or theorem; show every calculation step clearly on its own line; verify the answer by substituting back into the original equation; format equations using $...$ (inline) and $$...$$ (display); include appropriate units.',
                    'Do not write meta-commentary about vision algorithms. Do not state that you cannot see the attachment. Answer directly from the evidence.'
                ].join(' ')
            }
            : null,

        methods,
        combinedText: attachmentText,
        errorMessage: extractionErrors[0] || '',
        anyReadable
    };
}
async function rankAttachmentTextForQuery(query, text) {
    const source = String(text || '').trim();
    if (!source || source.length < 35000) return source;
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
    const value = String(query || '').trim();
    if (!value) return false;
    const pinpointScore = scoreAttachmentIntent(value, 'pinpoint_extraction');
    const globalScore = scoreAttachmentIntent(value, 'global_synthesis');
    return pinpointScore > 0.15 && pinpointScore > globalScore;
}

export async function ingestAttachmentWithFallback(attachment, query = '') {
    const attempts = [];
    const file = attachment?.file || attachment;
    const isPlainText = Boolean(file && isTextLikeFile(file));
    const isPdf = isPdfFile(file);

    // 1. Plain text / code files: read locally first so DLP/credential checks run strictly on-device
    if (isPlainText) {
        const localText = await extractLocally(attachment, query).catch(error => {
            if (error.name === 'AbortError') throw error;
            return ({
                ok: false,
                blocked: isTextLikeFile(file || {}) || error.code === 'document_credentials',
                text: '',
                method: error.code || 'client',
                provider: 'client',
                message: String(error?.message || error),
                attempts: [{ stage: 'client', ok: false, method: error.code || 'client_error', error: String(error?.message || error) }]
            });
        });
        attempts.push(...(localText.attempts || []));
        if (localText.blocked) return { ...localText, message: 'The text could not be read safely on this device. No server upload was attempted.' };
        if (hasUsefulExtractedText(localText?.text) || (localText?.ok && String(localText.text || '').trim())) {
            return { ...localText, ok: true, attempts };
        }
    }

    // 2. API-first for Word (.docx/.doc), PPT (.pptx/.ppt), Excel, RTF, PDF, and any other document format
    const rawSize = Number(file?.size || attachment?.size || 0);
    if (!isPdf || rawSize <= NATIVE_PDF_DIRECT_MAX_BYTES) {
        const server = await ingestOnServer(attachment, { text: '', method: 'api_first' }).catch(error => ({
            ok: false,
            text: '',
            method: 'server',
            provider: 'server',
            message: String(error?.message || error),
            attempts: [{ stage: 'server', ok: false, method: 'server_error', error: String(error?.message || error) }]
        }));
        attempts.push(...(server.attempts || []));
        const hasServerImages = Array.isArray(server?.images) && server.images.length > 0;
        const hasServerText = Boolean(server?.text && (hasUsefulExtractedText(server.text) || String(server.text).trim().length >= 10));
        if ((hasServerText && !isMetadataOnlyExtract(server.text)) || hasServerImages) {
            return { ...server, ok: true, attempts };
        }
    }

    // 3. Local extraction fallback (for offline use or oversize > 2.6MB files)
    const localText = await extractLocally(attachment, query).catch(error => {
        if (error.name === 'AbortError') throw error;
        return ({
            ok: false,
            blocked: error.code === 'document_credentials',
            fatalPdfError: error.code === 'pdf_encrypted' || error.code === 'pdf_corrupt',
            text: '',
            method: error.code || 'client',
            provider: 'client',
            message: String(error?.message || error),
            attempts: [{ stage: 'client', ok: false, method: error.code || 'client_error', error: String(error?.message || error) }]
        });
    });
    attempts.push(...(localText.attempts || []));
    if (localText.blocked) return { ...localText, message: 'The text could not be read safely on this device. No server upload was attempted.' };
    if (localText.fatalPdfError) return { ...localText, ok: false, attempts };
    if (isPdf) {
        return await ingestPdfAttachmentWithVisuals(attachment, localText, attempts);
    }
    if (hasUsefulExtractedText(localText?.text)) {
        return { ...localText, ok: true, attempts };
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
    }

    return {
        ok: false,
        text: '',
        partial: false,
        method: 'none',
        provider: 'none',
        message: localText?.message || `Could not extract readable content from ${attachment?.name || 'file'}.`,
        attempts
    };
}
async function ingestPdfAttachmentWithVisuals(attachment, localText, attempts) {
    // Fast-path: If the PDF already has a readable digital text layer (resumes, documents, reports),
    // return it in milliseconds without running 60+ seconds of heavy visual OCR.
    if (hasUsefulExtractedText(localText?.text) && !isMetadataOnlyExtract(localText?.text)) {
        const text = clipText(String(localText.text || '').trim());
        return {
            ok: true,
            text,
            partial: false,
            method: localText.method || 'client_pdf',
            provider: localText.provider || 'client',
            message: '',
            attempts
        };
    }

    let server = null;
    server = await ingestOnServer(attachment, localResultSafe(localText)).catch(error => ({
        ok: false,
        text: '',
        method: 'server',
        provider: 'server',
        message: String(error?.message || error),
        attempts: [{ stage: 'server', ok: false, method: 'server_error', error: String(error?.message || error) }]
    }));
    attempts.push(...(server.attempts || []));

    if (hasUsefulExtractedText(server?.text) && !isMetadataOnlyExtract(server?.text)) {
        const text = clipText(String(server.text || '').trim());
        return {
            ok: true,
            text,
            partial: server?.partial === true,
            method: server.method || 'server_pdf',
            provider: server.provider || 'server',
            message: '',
            attempts
        };
    }

    // Fallback: Image-only or scanned PDF without digital text layer requires vision OCR
    const vision = await extractPdfViaVision(attachment).catch(error => ({
        ok: false,
        text: '',
        method: 'pdf_vision_ocr',
        provider: 'vision',
        message: String(error?.message || error)
    }));
    attempts.push({
        stage: vision?.method || 'pdf_vision_ocr',
        ok: hasUsefulExtractedText(vision?.text) || String(vision?.text || '').trim().length >= 40,
        method: vision?.method || 'pdf_vision_ocr'
    });

    const combined = clipText(String(vision?.text || '').trim());
    const ok = hasUsefulExtractedText(combined) || combined.length >= 40;
    return {
        ok,
        text: combined,
        partial: vision?.partial === true,
        method: vision?.method || 'pdf_vision_ocr',
        provider: vision?.provider || 'vision',
        message: ok ? '' : (vision?.message || server?.message || localText?.message || `Could not extract readable content from ${attachment?.name || 'PDF'}.`),
        attempts
    };
}

function localResultSafe(localText) {
    if (hasUsefulExtractedText(localText?.text) && !isMetadataOnlyExtract(localText?.text)) return localText;
    return { text: '', method: localText?.method || 'client' };
}

async function extractLocally(attachment, query = '') {
    const attempts = [];
    const file = attachment?.file;
    if (!file) {
        return { ok: false, text: '', method: 'client', provider: 'client', attempts };
    }

    if (isTextLikeFile(file)) {
        if (globalThis.JarvisRecall?.selectDocumentFile) {
            const selected = await globalThis.JarvisRecall.selectDocumentFile(file, attachment.id, query);
            if (!selected.saved) globalThis.showTemporaryMessage?.('Document available for this request; browser storage could not keep a copy for later.');
            return { ok: true, text: selected.text, method: selected.partial ? 'selected_text_passages' : 'client_text', provider: 'client', partial: selected.partial, coverage: selected.coverage, attempts };
        }
        const text = await readFileAsText(file);
        attempts.push({ stage: 'client_text', ok: Boolean(text), method: 'client_text' });
        if (text) {
            return { ok: true, text, method: 'client_text', provider: 'client', attempts };
        }
    }

    if (isPdfFile(file)) {
        const pdfText = await extractPdfTextClient(file, attachment);
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

    if (isXlsxFile(file)) {
        const xlsxText = await extractXlsxTextClient(file).catch(() => '');
        const useful = hasUsefulExtractedText(xlsxText);
        attempts.push({ stage: 'client_xlsx', ok: useful, method: 'client_xlsx' });
        if (useful) {
            return { ok: true, text: xlsxText, method: 'client_xlsx', provider: 'client', attempts };
        }
    }

    if (isZipFile(file)) {
        const zipText = await extractZipTextClient(file).catch(() => '');
        const useful = hasUsefulExtractedText(zipText) || String(zipText || '').length > 20;
        attempts.push({ stage: 'client_zip', ok: useful, method: 'client_zip' });
        if (useful) {
            return { ok: true, text: zipText, method: 'client_zip', provider: 'client', attempts };
        }
    }

    if (isEpubFile(file)) {
        const epubText = await extractEpubTextClient(file).catch(() => '');
        const useful = hasUsefulExtractedText(epubText);
        attempts.push({ stage: 'client_epub', ok: useful, method: 'client_epub' });
        if (useful) {
            return { ok: true, text: epubText, method: 'client_epub', provider: 'client', attempts };
        }
    }

    return { ok: false, text: '', method: 'client', provider: 'client', attempts };
}


async function ingestOnServer(attachment, localResult = {}) {
    const clientText = hasUsefulExtractedText(localResult?.text) ? String(localResult.text || '') : '';
    let base64 = '';
    if (!clientText) {
        base64 = await resolveAttachmentBase64(attachment, { allowEmpty: true }).catch(() => '');
    }
    if (!clientText && !base64) {
        throw new Error(`Attachment payload is empty for ${attachment?.name || 'attachment'}. Please reattach the file and try again.`);
    }
    const finalMime = isImageAttachment(attachment)
        ? normalizeImageMime(attachment.mimeType, attachment.name, base64)
        : (attachment.mimeType || guessMimeFromName(attachment.name));
    attachment.mimeType = finalMime;
    logAttachmentIngestDiagnostics(attachment, { base64, clientText });
    const serverPayload = {
        filename: attachment.name,
        mimeType: finalMime,
        base64,
        clientText,
        clientMethod: String(localResult?.method || '')
    };
    if (jsonByteLength(serverPayload) > MAX_JSON_REQUEST_BYTES) {
        return {
            ok: false, text: '', method: 'server_skipped_large_file', provider: 'client',
            message: 'Processing this document on your device because it is too large to upload in one request.',
            attempts: [{ stage: 'server', ok: false, method: 'server_skipped_large_file', error: 'Encoded request exceeds transfer budget' }]
        };
    }
    const data = await postJson('/api/ingest-attachment', serverPayload, { timeoutMs: 35000 });
    const hasImages = Array.isArray(data?.images) && data.images.length > 0;
    const hasText = hasUsefulExtractedText(data?.text) || (Boolean(data?.ok || data?.success) && String(data?.text || '').trim().length >= 10);
    return {
        ok: Boolean(data?.ok || data?.success) && (hasText || hasImages),
        text: String(data?.text || ''),
        images: hasImages ? data.images : undefined,
        partial: data?.partial === true,
        method: String(data?.method || 'server'),
        provider: String(data?.provider || 'server'),
        message: String(data?.message || ''),
        attempts: Array.isArray(data?.attempts) ? data.attempts : []
    };
}
async function ingestViaVision(attachment) {
    const base64 = await resolveAttachmentBase64(attachment);
    const mimeType = normalizeImageMime(attachment.mimeType, attachment.name, base64);
    attachment.mimeType = mimeType;
    notifyAttachmentProgress(attachment, `Running cloud OCR on ${attachment.name}...`);
    try {
        const data = await postJson('/api/vision', {
            task: 'text_extract',
            prompt: `Transcribe all readable text, tables, and details from this image (${attachment.name}) in clean Markdown format. Preserve layout, line breaks, bullet points, and render all tables with markdown syntax (| Col 1 | Col 2 |).`,
            mimeType,
            imageBase64: base64
        }, { timeoutMs: 8000 });
        const details = data?.details && typeof data.details === 'object' ? data.details : {};
        const fullText = String(details?.fullText || '').trim();
        const snippets = Array.isArray(details?.textDetected)
            ? details.textDetected.map(item => String(item || '').trim()).filter(Boolean).join('\n').trim()
            : '';
        let text = fullText || snippets;
        if (!text && !details?.fullText && (!details?.textDetected || details.textDetected.length === 0)) {
            const rawCandidate = String(data?.response || '').replace(/^Detected text:\s*/i, '').trim();
            if (!isMetadataOnlyExtract(rawCandidate) && !isOcrStatusMessage(rawCandidate)) {
                text = rawCandidate;
            }
        }
        if (text && hasUsefulExtractedText(text)) {
            return {
                ok: true,
                text: clipText(text),
                method: 'vision_ocr',
                provider: 'vision'
            };
        }
    } catch (serverErr) {
        console.warn('Server vision OCR failed, attempting Tesseract fallback:', serverErr);
    }

    // Client-side Tesseract.js fallback for offline or missing cloud keys
    if (attachment?.file && typeof window !== 'undefined') {
        notifyAttachmentProgress(attachment, `Running local OCR fallback (Tesseract)...`);
        const tess = await extractTextViaTesseract(attachment.file, pct => {
            notifyAttachmentProgress(attachment, `Local OCR: ${pct}%`);
        });
        if (tess.ok) {
            return tess;
        }
    }

    return {
        ok: false,
        text: '',
        method: 'vision_ocr',
        provider: 'none'
    };
}

async function resolveAttachmentBase64(attachment, options = {}) {
    const existing = String(attachment?.base64 || '').trim();
    if (existing) {
        if (isImageAttachment(attachment) && !VISION_IMAGE_TYPES.has(encodedImageMime(existing))) throw unsupportedImageError(attachment.name);
        return existing;
    }
    if (attachment?.preEncodedPromise) {
        try {
            const preEncoded = String(await attachment.preEncodedPromise || '').trim();
            if (preEncoded) {
                attachment.base64 = preEncoded;
                return preEncoded;
            }
        } catch (_) {}
    }
    const file = attachment?.file;
    if (!file) {
        if (options.allowEmpty) return '';
        throw new Error(`Missing file data for ${attachment?.name || 'attachment'}. Please reattach the file and try again.`);
    }
    const isImg = isImageAttachment(attachment);
    const encoded = String((isImg ? await compressImageFileToBase64(file) : await fileToBase64(file)) || '').trim();
    if (isImg && !VISION_IMAGE_TYPES.has(encodedImageMime(encoded))) throw unsupportedImageError(attachment.name);
    if (encoded) {
        attachment.base64 = encoded;
    }
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
    if (file.size === 0) {
        return { ok: false, message: `${file.name || 'This file'} is empty (0 bytes) and has no content to read.` };
    }
    if (file.size > MAX_FILE_BYTES) {
        return { ok: false, message: `${file.name} is too large. Max size is ${formatBytes(MAX_FILE_BYTES)}.` };
    }
    return { ok: true };
}

function encodedImageMime(base64) {
    try { return detectImageMime(Uint8Array.from(atob(base64.slice(0, 32)), character => character.charCodeAt(0))); }
    catch { return ''; }
}

function unsupportedImageError(name) {
    return Object.assign(new Error(`${name || 'This image'} could not be opened on this device. It may be damaged or use an unsupported codec.`), { code: 'unsupported_media' });
}

async function createPendingAttachment(file) {
    const detectedMime = detectImageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    const isImage = Boolean(detectedMime) || (file.type || '').startsWith('image/') || IMAGE_EXTENSIONS.test(file.name || '');
    let fileName = String(file.name || '').trim();
    if (!fileName || fileName === 'blob' || fileName === 'image.png') {
        const mimeType = detectedMime || file.type;
        const ext = mimeType ? (mimeType.split('/')[1]?.replace('jpeg', 'jpg') || 'png') : 'png';
        fileName = `pasted-media-${Date.now()}.${ext}`;
    }
    const storedMimeType = detectedMime || file.type || guessMimeFromName(fileName);
    const attachment = {
        id: `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: fileName,
        mimeType: storedMimeType,
        size: file.size || 0,
        file,
        base64: '',
        previewUrl: '',
        preEncodedPromise: null
    };

    if (isImage) {
        // A chip is ready only after the browser has produced a valid preview and payload.
        const source = storedMimeType !== file.type ? new File([file], fileName, { type: storedMimeType, lastModified: file.lastModified }) : file;
        attachment.preEncodedPromise = compressImageFileToBase64(source)
            .then((encoded) => {
                const clean = String(encoded || '').trim();
                const mimeType = encodedImageMime(clean);
                if (!clean || !VISION_IMAGE_TYPES.has(mimeType)) throw unsupportedImageError(fileName);
                attachment.base64 = clean;
                attachment.mimeType = mimeType;
                attachment.preparedName = imageNameForMime(fileName, mimeType);
                const bytes = Uint8Array.from(atob(clean), character => character.charCodeAt(0));
                attachment.preparedSize = bytes.length;
                attachment.previewUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
                return clean;
            });
        await attachment.preEncodedPromise;
    } else {
        attachment.base64 = await fileToBase64(file);
    }

    return attachment;
}

/**
 * Reads the EXIF orientation tag from the raw binary of a JPEG file.
 * Returns 1 (normal) if not found or not a JPEG.
 * Orientation values: 1=normal, 3=180°, 6=90°CW, 8=90°CCW
 */
async function readExifOrientation(file) {
    try {
        // Only JPEG files have EXIF — skip for PNG/GIF/WebP
        const header = await file.slice(0, 3).arrayBuffer();
        const headerBytes = new Uint8Array(header);
        // JPEG starts with FF D8
        if (headerBytes[0] !== 0xFF || headerBytes[1] !== 0xD8) return 1;

        const buffer = await file.slice(0, 64 * 1024).arrayBuffer();
        const view = new DataView(buffer);
        let offset = 2;
        while (offset < view.byteLength - 4) {
            const marker = view.getUint16(offset);
            offset += 2;
            if (marker === 0xFFE1) {
                // APP1 segment — check for Exif header
                const segLen = view.getUint16(offset);
                offset += 2;
                const exifHeader = view.getUint32(offset);
                if (exifHeader !== 0x45786966) return 1; // 'Exif'
                offset += 6; // skip 'Exif\0\0'
                const tiffStart = offset;
                const byteOrder = view.getUint16(tiffStart);
                const littleEndian = byteOrder === 0x4949;
                const getUint16 = (o) => view.getUint16(tiffStart + o, littleEndian);
                const getUint32 = (o) => view.getUint32(tiffStart + o, littleEndian);
                const ifdOffset = getUint32(4);
                const numEntries = getUint16(ifdOffset);
                for (let i = 0; i < numEntries; i++) {
                    const entryOffset = ifdOffset + 2 + (i * 12);
                    if (entryOffset + 12 > view.byteLength - tiffStart) break;
                    const tag = getUint16(entryOffset);
                    if (tag === 0x0112) { // Orientation tag
                        return getUint16(entryOffset + 8);
                    }
                }
                return 1;
            } else if ((marker & 0xFF00) === 0xFF00) {
                offset += view.getUint16(offset);
            } else {
                break;
            }
        }
    } catch (_) {}
    return 1;
}

/**
 * Applies canvas rotation transform for EXIF orientation.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} orientation - EXIF orientation (1-8)
 * @param {number} width - original image width
 * @param {number} height - original image height
 * @returns {{ canvasWidth: number, canvasHeight: number }}
 */
function applyExifOrientationTransform(ctx, orientation, width, height) {
    switch (orientation) {
        case 2: ctx.transform(-1, 0, 0, 1, width, 0); return { canvasWidth: width, canvasHeight: height };
        case 3: ctx.transform(-1, 0, 0, -1, width, height); return { canvasWidth: width, canvasHeight: height };
        case 4: ctx.transform(1, 0, 0, -1, 0, height); return { canvasWidth: width, canvasHeight: height };
        case 5: ctx.transform(0, 1, 1, 0, 0, 0); return { canvasWidth: height, canvasHeight: width };
        case 6: ctx.transform(0, 1, -1, 0, height, 0); return { canvasWidth: height, canvasHeight: width };
        case 7: ctx.transform(0, -1, -1, 0, height, width); return { canvasWidth: height, canvasHeight: width };
        case 8: ctx.transform(0, -1, 1, 0, 0, width); return { canvasWidth: height, canvasHeight: width };
        default: return { canvasWidth: width, canvasHeight: height };
    }
}

const LOSSLESS_PASSTHROUGH_MAX_BYTES = 400 * 1024;
const LOSSLESS_PASSTHROUGH_MIMES = new Set(['image/png', 'image/webp']);

async function compressImageFileToBase64(file, maxDimension = 1600, quality = 0.88) {
    const detected = detectImageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    const raw = RAW_IMAGE_EXTENSIONS.test(file.name || '') && (!detected || detected === 'image/tiff');
    if (!raw) {
        try { return await compressNativeImage(file, maxDimension, quality); } catch (_) {}
    }
    const decoded = await decodeImageFile(file, { maxDimension });
    return fileToBase64(decoded);
}

async function compressNativeImage(file, maxDimension = 1600, quality = 0.88) {
    if (typeof document === 'undefined') {
        return fileToBase64(file);
    }

    const rawMime = String(file?.type || '').trim().toLowerCase();
    const isLosslessCandidate = LOSSLESS_PASSTHROUGH_MIMES.has(rawMime) &&
        Number(file?.size || 0) > 0 &&
        Number(file?.size || 0) <= LOSSLESS_PASSTHROUGH_MAX_BYTES;

    // Read EXIF orientation FIRST (before any decode) for phone camera photos
    const exifOrientation = await readExifOrientation(file).catch(() => 1);
    const needsRotation = exifOrientation >= 5 && exifOrientation <= 8; // 90° or 270° rotations swap W/H

    // Modern memory-efficient decoding via createImageBitmap
    // NOTE: createImageBitmap does NOT reliably apply EXIF orientation on iOS Safari / older Android
    // We always apply orientation manually via canvas transform to guarantee correctness.
    if (typeof createImageBitmap === 'function') {
        try {
            // imageOrientation: 'none' forces raw pixel data without browser auto-rotation
            // so our manual EXIF transform is always authoritative
            const bitmap = await createImageBitmap(file, { imageOrientation: 'none' }).catch(() => createImageBitmap(file));
            const srcWidth = bitmap.width;
            const srcHeight = bitmap.height;

            // Preserve small crisp PNG/WebP images losslessly (prevents JPEG chroma bleed on flags, emblems & OCR text)
            if (isLosslessCandidate && exifOrientation === 1 && srcWidth <= maxDimension && srcHeight <= maxDimension) {
                bitmap.close?.();
                const direct = await fileToBase64(file);
                if (direct && direct.length > 50) return direct;
            }

            // Apply dimension scaling BEFORE rotation for proper aspect ratio
            let drawWidth = srcWidth;
            let drawHeight = srcHeight;
            const maxDim = needsRotation ? maxDimension : maxDimension;
            if (srcWidth > maxDim || srcHeight > maxDim) {
                if (srcWidth > srcHeight) {
                    drawHeight = Math.round((srcHeight * maxDim) / srcWidth);
                    drawWidth = maxDim;
                } else {
                    drawWidth = Math.round((srcWidth * maxDim) / srcHeight);
                    drawHeight = maxDim;
                }
            }

            // Calculate canvas dimensions accounting for rotation
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            const { canvasWidth, canvasHeight } = applyExifOrientationTransform(
                ctx, exifOrientation, drawWidth, drawHeight
            );
            canvas.width = canvasWidth;
            canvas.height = canvasHeight;
            // Fill opaque white before EXIF rotation so transparent OCR/math PNGs keep legible contrast in JPEG
            const ctx2 = canvas.getContext('2d');
            ctx2.fillStyle = '#ffffff';
            ctx2.fillRect(0, 0, canvasWidth, canvasHeight);
            ctx2.imageSmoothingEnabled = true;
            ctx2.imageSmoothingQuality = 'high';
            applyExifOrientationTransform(ctx2, exifOrientation, drawWidth, drawHeight);
            ctx2.drawImage(bitmap, 0, 0, drawWidth, drawHeight);
            bitmap.close?.();
            const dataUrl = canvas.toDataURL('image/jpeg', quality);
            canvas.width = 0;
            canvas.height = 0;
            const comma = dataUrl.indexOf(',');
            const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
            if (base64 && base64.length > 50) return base64;
        } catch (_) {}
    }

    // Fallback using URL.createObjectURL + <img> element
    return new Promise((resolve, reject) => {
        let objectUrl = '';
        try {
            objectUrl = URL.createObjectURL(file);
        } catch (_) {
            reject(unsupportedImageError(file.name));
            return;
        }

        const img = new Image();
        img.onload = () => {
            try {
                const isSvg = rawMime === 'image/svg+xml' || /\.svgz?$/i.test(file?.name || '');
                const srcWidth = img.naturalWidth || img.width || (isSvg ? 1200 : 0);
                const srcHeight = img.naturalHeight || img.height || (isSvg ? 1200 : 0);
                if (!srcWidth || !srcHeight) {
                    URL.revokeObjectURL(objectUrl);
                    reject(unsupportedImageError(file.name));
                    return;
                }
                if (isLosslessCandidate && exifOrientation === 1 && srcWidth <= maxDimension && srcHeight <= maxDimension) {
                    URL.revokeObjectURL(objectUrl);
                    fileToBase64(file).then(resolve).catch(reject);
                    return;
                }
                let drawWidth = srcWidth;
                let drawHeight = srcHeight;
                if (srcWidth > maxDimension || srcHeight > maxDimension) {
                    if (srcWidth > srcHeight) {
                        drawHeight = Math.round((srcHeight * maxDimension) / srcWidth);
                        drawWidth = maxDimension;
                    } else {
                        drawWidth = Math.round((srcWidth * maxDimension) / srcHeight);
                        drawHeight = maxDimension;
                    }
                }

                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                const { canvasWidth, canvasHeight } = applyExifOrientationTransform(
                    ctx, exifOrientation, drawWidth, drawHeight
                );
                canvas.width = canvasWidth;
                canvas.height = canvasHeight;
                const ctx2 = canvas.getContext('2d');
                ctx2.fillStyle = '#ffffff';
                ctx2.fillRect(0, 0, canvasWidth, canvasHeight);
                ctx2.imageSmoothingEnabled = true;
                ctx2.imageSmoothingQuality = 'high';
                applyExifOrientationTransform(ctx2, exifOrientation, drawWidth, drawHeight);
                ctx2.drawImage(img, 0, 0, drawWidth, drawHeight);
                const dataUrl = canvas.toDataURL('image/jpeg', quality);
                canvas.width = 0;
                canvas.height = 0;
                const comma = dataUrl.indexOf(',');
                const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
                URL.revokeObjectURL(objectUrl);
                resolve(base64);
            } catch (err) {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            }
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(unsupportedImageError(file.name));
        };
        img.src = objectUrl;
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

function isXlsxFile(file) {
    const t = file.type || '';
    return XLSX_EXTENSIONS.test(file.name) ||
        t === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
        t === 'application/vnd.ms-excel' ||
        t === 'application/x-vnd.ms-excel';
}

function isZipFile(file) {
    const t = file.type || '';
    return ZIP_EXTENSIONS.test(file.name) ||
        t === 'application/zip' ||
        t === 'application/x-zip-compressed' ||
        t === 'application/x-zip';
}

function isEpubFile(file) {
    const t = file.type || '';
    return EPUB_EXTENSIONS.test(file.name) ||
        t === 'application/epub+zip' ||
        t === 'application/epub';
}


function isImageAttachment(attachment) {
    const mimeType = attachment?.mimeType || '';
    const name = attachment?.name || '';
    return /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
}

function isOcrStatusMessage(text) {
    const s = String(text || '').trim();
    if (!s) return true;
    const statusScore = scoreAttachmentIntent(s, 'ocr_status_diagnostic');
    const contentScore = scoreAttachmentIntent(s, 'substantive_content');
    return statusScore >= 0.25 && statusScore > contentScore;
}

function isMathematicalOrFormulaContent(text) {
    const str = String(text || '').trim();
    if (str.length < 5) return false;
    const hasEquationOrInequality = /[\d\w\p{L}]+\s*(?:=|<|>|<=|>=|≈|\\approx|\\le|\\ge|≠|\\neq)\s*[\d\w\p{L}]/u.test(str);
    const hasMathOperators = /[\d\w\p{L}]\s*(?:[+\-*/^×÷±]|\\[a-zA-Z]+)\s*[\d\w\p{L}]/u.test(str);
    const hasMathTerms = /\b(?:solve|evaluate|simplify|calculate|derivative|integral|limit|matrix|vector|triangle|hypotenuse|radius|diameter|perimeter|area|volume|angle|degree|sin|cos|tan|log|ln|sqrt|sum|sigma|mean|median|variance|probability|total|subtotal|tax|price)\b/i.test(str);
    const hasLatexMath = /\\(?:frac|sqrt|int|sum|prod|lim|alpha|beta|gamma|theta|pi|partial|cdot|times)/i.test(str);
    return (hasEquationOrInequality || hasMathOperators || hasLatexMath || (hasMathTerms && /\d/.test(str)));
}

function hasUsefulExtractedText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (isMetadataOnlyExtract(value) || isOcrStatusMessage(value)) return false;
    if (isMathematicalOrFormulaContent(value)) return true;
    if (value.length < 40) return false;
    const letters = (value.match(/[\p{L}]/gu) || []).length;
    return letters >= 24;
}

function isMetadataOnlyExtract(text) {
    const value = String(text || '').trim();
    if (!value) return true;
    if (isOcrStatusMessage(value)) return true;
    const statusScore = scoreAttachmentIntent(value, 'ocr_status_diagnostic');
    const contentScore = scoreAttachmentIntent(value, 'substantive_content');
    return statusScore >= 0.20 && contentScore < 0.15;
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
        const name = String(item?.preparedName || item?.name || 'attachment');
        const isImage = /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
        const kind = isImage
            ? 'image'
            : (/\.pdf$/i.test(name) || mimeType === 'application/pdf'
                ? 'pdf'
                : (/\.docx?$/i.test(name) ? 'doc' : (/\.pptx?$/i.test(name) ? 'ppt' : 'file')));
        let previewUrl = '';
        if (isImage) {
            previewUrl = item.previewUrl || (item.base64 ? `data:${normalizeImageMime(mimeType, name, item.base64)};base64,${item.base64}` : '');
        }
        return {
            id: String(item?.id || ''),
            name,
            originalName: String(item?.name || name),
            mimeType,
            size: Number(item?.preparedSize || item?.size) || 0,
            originalSize: Number(item?.size) || 0,
            kind,
            previewUrl,
            extractedText: String(item?.extractedText || item?.text || '').trim(),
            ocrMethod: String(item?.ocrMethod || item?.method || '').trim()
        };
    });
}

function normalizeImageMime(mimeType, filename = '', base64 = '') {
    if (base64 && typeof base64 === 'string') {
        const clean = base64.trim();
        if (clean.startsWith('/9j/')) return 'image/jpeg';
        if (clean.startsWith('iVBOR')) return 'image/png';
        if (clean.startsWith('R0lGO')) return 'image/gif';
        if (clean.startsWith('UklGR')) return 'image/webp';
    }
    const cleanMime = String(mimeType || '').trim().toLowerCase();
    if (['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(cleanMime)) return cleanMime;
    if (/\.(jpe?g)$/i.test(filename)) return 'image/jpeg';
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
    if (/\.(jpe?g|pjpeg)$/.test(lower)) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (/\.(heic|heif|heics|heifs)$/.test(lower)) return 'image/heic';
    if (/\.(avif|avifs)$/.test(lower)) return 'image/avif';
    if (/\.(dng|raw|cr[23]|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef)$/.test(lower)) return 'image/dng';
    if (/\.(jp2|j2k|jpf|jpx|jpm)$/.test(lower)) return 'image/jp2';
    if (/\.(tiff?)$/.test(lower)) return 'image/tiff';
    if (/\.(bmp|dib)$/.test(lower)) return 'image/bmp';
    if (/\.(pict?|pct|pic)$/.test(lower)) return 'image/pict';
    if (lower.endsWith('.psd')) return 'image/vnd.adobe.photoshop';
    if (/\.(ico|cur)$/.test(lower)) return 'image/x-icon';
    if (/\.svgz?$/.test(lower)) return 'image/svg+xml';
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

export async function downsampleImageFileToSafeBase64(file, maxBytes = 3.2 * 1024 * 1024) {
    if (!file) return '';
    const detectedMime = detectImageMime(new Uint8Array(await file.slice(0, 32).arrayBuffer()));
    const isImage = Boolean(detectedMime) || /^image\//i.test(file.type || '') || IMAGE_EXTENSIONS.test(file.name || '');
    if (!isImage) return fileToBase64(file);
    const source = detectedMime && detectedMime !== file.type ? new File([file], file.name, { type: detectedMime }) : file;
    for (const [dimension, quality] of [[1600, 0.88], [1280, 0.75], [1024, 0.7], [768, 0.6]]) {
        const encoded = await compressImageFileToBase64(source, dimension, quality);
        if (!VISION_IMAGE_TYPES.has(encodedImageMime(encoded))) throw unsupportedImageError(file.name);
        if (encoded.length * 0.75 <= maxBytes) return encoded;
    }
    throw payloadSizeError();
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
        reader.onerror = () => reject(reader.error || new Error('Could not read this file.'));
        reader.readAsDataURL(file);
    });
}

/**
 * Reconstructs 2D spatial layout from PDF.js items (multi-column flows, tables, paragraphs)
 * replicating and exceeding Python pdfminer/pypdf fidelity entirely client-side.
 */
function reconstructPdfPageLayout(items = [], viewport = { width: 612, height: 792 }) {
    if (!items || !items.length) return '';

    const pageHeight = viewport?.height || 792;
    const pageWidth = viewport?.width || 612;

    const normalized = items.map(it => {
        const x = Number(it.transform?.[4] ?? it.x ?? 0);
        const rawY = Number(it.transform?.[5] ?? it.y ?? 0);
        // Flip PDF bottom-up coordinate system to top-down
        const y = pageHeight - rawY;
        const width = Number(it.width || (it.str ? it.str.length * 6 : 0));
        const height = Number(it.height || Math.abs(it.transform?.[0]) || 12);
        const str = String(it.str || '').trim();
        return { str, x, y, width, height, right: x + width, bottom: y + height };
    }).filter(it => it.str.length > 0);

    if (!normalized.length) return '';

    // Multi-column detection: split items across horizontal halves if divided by a vertical gutter
    const midX = pageWidth / 2;
    const gutterWidth = 18;
    const leftColItems = [];
    const rightColItems = [];
    const spanColItems = [];

    for (const it of normalized) {
        if (it.width > pageWidth * 0.6) {
            spanColItems.push(it);
        } else if (it.right < midX - (gutterWidth / 2)) {
            leftColItems.push(it);
        } else if (it.x > midX + (gutterWidth / 2)) {
            rightColItems.push(it);
        } else {
            spanColItems.push(it);
        }
    }

    const isMultiColumn = leftColItems.length >= 8 && rightColItems.length >= 8;

    function groupIntoLinesAndParagraphs(itemList) {
        if (!itemList.length) return '';
        // Sort items: top-to-bottom (y), then left-to-right (x)
        itemList.sort((a, b) => {
            if (Math.abs(a.y - b.y) <= 3) return a.x - b.x;
            return a.y - b.y;
        });

        // Group into lines by y proximity
        const lines = [];
        let currentLine = [];
        let currentY = -999;

        for (const it of itemList) {
            if (Math.abs(it.y - currentY) > 4) {
                if (currentLine.length) lines.push(currentLine);
                currentLine = [it];
                currentY = it.y;
            } else {
                currentLine.push(it);
            }
        }
        if (currentLine.length) lines.push(currentLine);

        // Process lines and detect tables
        const outputLines = [];
        let prevLineY = 0;
        let tableBuffer = [];

        function flushTable() {
            if (!tableBuffer.length) return;
            if (tableBuffer.length >= 2) {
                // Format as clean Markdown table
                const numCols = Math.max(...tableBuffer.map(r => r.length));
                outputLines.push('| ' + tableBuffer[0].map(c => c.trim()).join(' | ') + ' |');
                outputLines.push('| ' + Array(numCols).fill('---').join(' | ') + ' |');
                for (let r = 1; r < tableBuffer.length; r++) {
                    outputLines.push('| ' + tableBuffer[r].map(c => c.trim()).join(' | ') + ' |');
                }
            } else {
                outputLines.push(tableBuffer[0].join('    '));
            }
            tableBuffer = [];
        }

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            const lineY = line[0].y;
            const deltaY = prevLineY ? (lineY - prevLineY) : 0;
            prevLineY = lineY;

            // Check if this line has multiple spaced cells (possible table row)
            const cells = [];
            let currentCell = '';
            for (let j = 0; j < line.length; j++) {
                const it = line[j];
                const prev = line[j - 1];
                if (prev && (it.x - prev.right) > 28) {
                    cells.push(currentCell.trim());
                    currentCell = it.str;
                } else {
                    currentCell += (currentCell ? ' ' : '') + it.str;
                }
            }
            if (currentCell) cells.push(currentCell.trim());

            if (cells.length >= 2) {
                tableBuffer.push(cells);
            } else {
                flushTable();
                if (deltaY > 18 && outputLines.length) {
                    outputLines.push(''); // Paragraph break
                }
                outputLines.push(cells[0] || '');
            }
        }
        flushTable();

        return outputLines.join('\n');
    }

    if (isMultiColumn) {
        const spanText = groupIntoLinesAndParagraphs(spanColItems);
        const col1Text = groupIntoLinesAndParagraphs(leftColItems);
        const col2Text = groupIntoLinesAndParagraphs(rightColItems);
        return [spanText, col1Text, col2Text].filter(Boolean).join('\n\n');
    }

    return groupIntoLinesAndParagraphs(normalized);
}

function classifyPdfError(err, filename = 'This PDF') {
    const name = String(err?.name || '');
    const msg = String(err?.message || '');
    if (name === 'PasswordException' || /password|encrypted/i.test(msg)) {
        return Object.assign(new Error(`${filename} is password-protected and cannot be read.`), { code: 'pdf_encrypted' });
    }
    if (name === 'InvalidPDFException' || /invalid pdf/i.test(msg)) {
        return Object.assign(new Error(`${filename} appears damaged or is not a valid PDF.`), { code: 'pdf_corrupt' });
    }
    return null;
}

function createPdfOcrState() {
    return {
        cloudDisabled: false,
        consecutiveRateLimits: 0,
        rateLimitHit: false,
        cooldownUntil: 0,
        localPagesAttempted: 0,
        localOcrFailed: false
    };
}

function isRateLimitError(err) {
    const status = Number(err?.status || 0);
    const code = String(err?.code || '').toLowerCase();
    const message = String(err?.message || '').toLowerCase();
    return status === 429 ||
        code === 'rate_limited' ||
        code === 'vision_rate_limited' ||
        message.includes('too many requests') ||
        message.includes('rate limit');
}

async function extractPdfTextClient(file, attachment = null) {
    const pdfjs = await loadPdfJs();
    const buffer = await file.arrayBuffer();
    let doc;
    try {
        doc = await pdfjs.getDocument({ data: buffer }).promise;
    } catch (err) {
        const classified = classifyPdfError(err, file?.name || attachment?.name);
        if (classified) throw classified;
        return '';
    }
    const parts = [];
    const pageCount = Math.min(doc.numPages || 0, PDF_DIGITAL_PAGE_LIMIT);
    const CHUNK_SIZE = 5;
    let visionPagesAttempted = 0;
    const ocrState = createPdfOcrState();

    for (let i = 1; i <= pageCount; i += CHUNK_SIZE) {
        const chunkEnd = Math.min(i + CHUNK_SIZE - 1, pageCount);
        if (attachment) {
            notifyAttachmentProgress(attachment, `Extracting layout: Pages ${i}–${chunkEnd} of ${pageCount}...`);
        }
        for (let pageNumber = i; pageNumber <= chunkEnd; pageNumber++) {
            const page = await doc.getPage(pageNumber);
            const viewport = page.getViewport({ scale: 1.0 });
            const content = await page.getTextContent();
            const rawLength = content.items.reduce((acc, it) => acc + (it.str?.length || 0), 0);

            let pageText = '';
            if (rawLength >= 15) {
                // High-fidelity 2D Spatial Reconstruction (multi-column, tables, paragraphs)
                pageText = reconstructPdfPageLayout(content.items, viewport);
            } else if (doc.numPages <= 30 || visionPagesAttempted < 15) {
                // Hybrid Per-Page Fallback: page is sparse/scanned, run vision OCR for this specific page
                visionPagesAttempted++;
                try {
                    pageText = await processPdfPageVision(attachment || { name: file.name, file }, pdfjs, doc, pageNumber, pageCount, ocrState);
                } catch (_) {
                    pageText = '';
                }
            }

            if (pageText && pageText.trim()) {
                parts.push(pageText.trim());
            }
        }
        // Micro-yield to the browser event loop to preserve silky smooth UI responsiveness
        await new Promise(r => setTimeout(r, 0));
    }
    return clipText(parts.join('\n\n'));
}

async function extractPdfViaVision(attachment) {
    const file = attachment?.file;
    if (!file) {
        return { ok: false, text: '', method: 'pdf_vision_ocr', provider: 'vision', message: 'Missing PDF file.' };
    }
    const pdfjs = await loadPdfJs();
    let doc;
    try {
        doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
    } catch (err) {
        const classified = classifyPdfError(err, file?.name || attachment?.name);
        return {
            ok: false,
            text: '',
            method: classified?.code || 'pdf_vision_ocr',
            provider: 'vision',
            message: classified?.message || 'Could not open this PDF for visual OCR.'
        };
    }
    const pageCount = Math.min(doc.numPages || 0, PDF_VISUAL_PAGE_LIMIT);

    const parts = [];
    const ocrState = createPdfOcrState();
    const BATCH_SIZE = 2;
    for (let i = 1; i <= pageCount; i += BATCH_SIZE) {
        const batchEnd = Math.min(i + BATCH_SIZE - 1, pageCount);
        notifyAttachmentProgress(attachment, `Scanning pages ${i}–${batchEnd} of ${pageCount}...`);
        const batchPromises = [];
        for (let pageNumber = i; pageNumber <= batchEnd; pageNumber++) {
            batchPromises.push(processPdfPageVision(attachment, pdfjs, doc, pageNumber, pageCount, ocrState));
        }
        const results = await Promise.allSettled(batchPromises);
        for (const res of results) {
            if (res.status === 'fulfilled' && res.value) {
                parts.push(res.value);
            }
        }
        // Gentle inter-batch pacing for multi-page documents to stay within vision API RPM limits
        if (batchEnd < pageCount && pageCount > 4 && !ocrState.cloudDisabled) {
            await new Promise(r => setTimeout(r, 150));
        }
    }

    const text = clipText(parts.join('\n\n'));
    const ok = hasUsefulExtractedText(text);
    const message = ok
        ? ''
        : (ocrState.rateLimitHit
            ? 'Cloud OCR rate limit reached while scanning this document. Wait a moment and retry, or upload a smaller section.'
            : 'PDF vision OCR found little readable text.');
    return {
        ok,
        text,
        method: ok && ocrState.rateLimitHit ? 'pdf_vision_partial_ocr' : 'pdf_vision_ocr',
        provider: 'vision',
        message
    };
}

async function processPdfPageVision(attachment, pdfjs, doc, pageNumber, totalPages = 1, ocrState = createPdfOcrState()) {
    try {
        const page = await doc.getPage(pageNumber);
        // High-resolution DPI scale (up to 2.0x) for crystal-clear character and table recognition
        let scale = 1.6;
        let viewport = page.getViewport({ scale });
        const MAX_PAGE_DIM = 1600;
        if (viewport.width > MAX_PAGE_DIM || viewport.height > MAX_PAGE_DIM) {
            scale = (MAX_PAGE_DIM / Math.max(viewport.width, viewport.height)) * scale;
            viewport = page.getViewport({ scale });
        }
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.floor(viewport.width));
        canvas.height = Math.max(1, Math.floor(viewport.height));
        const context = canvas.getContext('2d', { alpha: false });
        if (!context) return '';
        // Fill opaque white so transparent vector/math PDFs stay dark-on-white
        context.fillStyle = '#ffffff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: context, viewport }).promise;
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        // Explicitly clear canvas backbuffer to prevent memory accumulation across 100 pages
        canvas.width = 0;
        canvas.height = 0;
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!base64) return '';

        const visionPayload = {
            task: 'text_extract',
            prompt: `Transcribe all readable text from page ${pageNumber} of PDF "${attachment.name}". Preserve headings, bullet points, math equations in LaTeX, and render all tables in clean Markdown table format (| Col 1 | Col 2 |). For line items, capture labels, dates, and amounts accurately.`,
            mimeType: 'image/jpeg',
            imageBase64: base64
        };

        if (!ocrState.cloudDisabled) {
            for (let attempt = 0; attempt < 2; attempt++) {
                if (ocrState.cloudDisabled) break;
                const remainingCooldown = ocrState.cooldownUntil - Date.now();
                if (remainingCooldown > 0) {
                    await new Promise(r => setTimeout(r, Math.min(remainingCooldown, 2500)));
                }
                try {
                    const data = await postJson('/api/vision', visionPayload, { timeoutMs: 25000 });
                    ocrState.consecutiveRateLimits = 0;

                    const details = data?.details && typeof data.details === 'object' ? data.details : {};
                    const fullText = String(details?.fullText || '').trim();
                    const snippets = Array.isArray(details?.textDetected)
                        ? details.textDetected.map(item => String(item || '').trim()).filter(Boolean).join('\n').trim()
                        : '';
                    const cleanedResponse = String(data?.response || '').replace(/^Detected text:\s*/i, '').trim();
                    const pageText = (fullText || snippets || cleanedResponse).trim();

                    if (pageText && !isOcrStatusMessage(pageText) && !isMetadataOnlyExtract(pageText) && (hasUsefulExtractedText(pageText) || pageText.length >= 20)) {
                        return `Page ${pageNumber}:\n${pageText}`;
                    }
                    break;
                } catch (cloudErr) {
                    if (isRateLimitError(cloudErr)) {
                        ocrState.rateLimitHit = true;
                        ocrState.cooldownUntil = Date.now() + 1800;
                        if (attempt === 0) {
                            notifyAttachmentProgress(attachment, `Rate limit reached on page ${pageNumber}; retrying briefly...`);
                            await new Promise(r => setTimeout(r, 1500));
                            continue;
                        }
                        ocrState.consecutiveRateLimits += 1;
                        if (ocrState.consecutiveRateLimits >= 2) {
                            ocrState.cloudDisabled = true;
                        }
                        console.warn(`Cloud vision OCR rate-limited for page ${pageNumber}, switching to local OCR fallback.`);
                    } else {
                        console.warn(`Cloud vision OCR failed for page ${pageNumber}, trying Tesseract:`, cloudErr);
                    }
                    break;
                }
            }
        }

        // Local Tesseract.js fallback for failed/rate-limited pages (bounded to keep browser responsive)
        const MAX_LOCAL_OCR_PAGES = 10;
        if (typeof window !== 'undefined' && !ocrState.localOcrFailed && ocrState.localPagesAttempted < MAX_LOCAL_OCR_PAGES) {
            ocrState.localPagesAttempted += 1;
            notifyAttachmentProgress(attachment, `Running local OCR on page ${pageNumber} of ${totalPages}...`);
            const tess = await extractTextViaTesseract(dataUrl);
            if (tess.ok) {
                return `Page ${pageNumber} (Local OCR):\n${tess.text}`;
            }
            if (tess.loadFailed) {
                ocrState.localOcrFailed = true;
            }
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
        pdfLoaderPromise = import('pdfjs-dist/build/pdf.mjs')
            .then(async mod => {
                const pdfjs = mod?.default || mod;
                if (pdfjs?.GlobalWorkerOptions) {
                    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
                }
                return pdfjs;
            });
    }
    return pdfLoaderPromise;
}

async function loadJsZip() {
    if (!jsZipLoaderPromise) {
        jsZipLoaderPromise = import('jszip').then(mod => mod.default || mod);
    }
    return jsZipLoaderPromise;
}

async function loadSheetJs() {
    if (!sheetJsLoaderPromise) {
        sheetJsLoaderPromise = import('read-excel-file/browser').then(mod => mod.default);
    }
    return sheetJsLoaderPromise;
}

// ── XLSX / XLS / ODS extractor ────────────────────────────────────────────────
async function extractXlsxTextClient(file) {
    const XLSX = await loadSheetJs();
    const sheets = await XLSX(file);
    const parts = [];
    for (const sheet of sheets.slice(0, 20)) {
        const sheetName = sheet.sheet;

        // Convert sheet to array-of-arrays then render as Markdown table
        const aoa = sheet.data;
        if (!aoa.length) continue;
        const rows = aoa.filter(row => Array.isArray(row) && row.some(cell => String(cell || '').trim()));
        if (!rows.length) continue;
        const header = rows[0].map(c => String(c || '').trim());
        const separator = header.map(() => '---');
        const body = rows.slice(1).map(row =>
            header.map((_, i) => String(row[i] ?? '').replace(/\|/g, '\\|').trim())
        );
        const mdTable = [header, separator, ...body]
            .map(r => '| ' + r.join(' | ') + ' |')
            .join('\n');
        parts.push(`### Sheet: ${sheetName}\n\n${mdTable}`);
    }
    return clipText(parts.join('\n\n---\n\n'));
}

// ── ZIP extractor ─────────────────────────────────────────────────────────────
// Lists contents + extracts readable text files (txt, csv, json, md, code) inside
async function extractZipTextClient(file) {
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());
    const READABLE = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html|htm|yaml|yml|toml|ini|log|sql|py|js|ts|jsx|tsx|java|cpp|c|h|cs|go|rb|php|sh|rs)$/i;
    const IMAGE_OR_BIN = /\.(jpe?g|png|gif|webp|bmp|exe|dll|so|class|pyc|zip|gz|tar|rar|7z)$/i;
    const entries = Object.entries(zip.files)
        .filter(([, f]) => !f.dir)
        .sort(([a], [b]) => a.localeCompare(b));

    // Build manifest
    const manifest = entries.map(([name, f]) => `- ${name} (${formatBytes(f._data?.uncompressedSize || 0)})`).join('\n');
    const parts = [`## ZIP Contents: ${file.name}\n\n${manifest}`];

    // Extract readable text files (max 10 files, 20KB each)
    let extracted = 0;
    for (const [name, entry] of entries) {
        if (extracted >= 10) break;
        if (IMAGE_OR_BIN.test(name)) continue;
        if (!READABLE.test(name)) continue;
        try {
            const text = await entry.async('text');
            const clipped = text.slice(0, 20000).trim();
            if (clipped.length >= 20) {
                parts.push(`### ${name}\n\`\`\`\n${clipped}\n\`\`\``);
                extracted++;
            }
        } catch (_) {}
    }
    return clipText(parts.join('\n\n---\n\n'));
}

// ── EPUB extractor ────────────────────────────────────────────────────────────
// EPUBs are ZIP archives with HTML content chapters
async function extractEpubTextClient(file) {
    const JSZip = await loadJsZip();
    const zip = await JSZip.loadAsync(await file.arrayBuffer());

    // Find spine order from content.opf
    let chapterPaths = [];
    const opfEntry = Object.keys(zip.files).find(n => /\.opf$/i.test(n));
    if (opfEntry) {
        try {
            const opfXml = await zip.files[opfEntry].async('text');
            const idrefs = Array.from(opfXml.matchAll(/<itemref[^>]+idref="([^"]+)"/g)).map(m => m[1]);
            const hrefMap = {};
            for (const m of opfXml.matchAll(/<item[^>]+id="([^"]+)"[^>]+href="([^"]+)"/g)) {
                hrefMap[m[1]] = m[2];
            }
            const base = opfEntry.includes('/') ? opfEntry.slice(0, opfEntry.lastIndexOf('/') + 1) : '';
            chapterPaths = idrefs.map(id => hrefMap[id]).filter(Boolean).map(href => base + href);
        } catch (_) {}
    }
    if (!chapterPaths.length) {
        // Fallback: all HTML/xhtml files
        chapterPaths = Object.keys(zip.files).filter(n => /\.(html|xhtml|htm)$/i.test(n)).sort().slice(0, 30);
    }

    const parts = [];
    for (const path of chapterPaths.slice(0, 20)) {
        const entry = zip.files[path] || zip.files[path.replace(/^.*\//, '')];
        if (!entry) continue;
        try {
            const html = await entry.async('text');
            // Strip tags, decode entities, collapse whitespace
            const text = html
                .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ').trim();
            if (text.length >= 30) parts.push(text);
        } catch (_) {}
    }
    return clipText(parts.join('\n\n'));
}


function notifyAttachmentProgress(attachment, message) {
    if (typeof window !== 'undefined' && window.dispatchEvent) {
        try {
            window.dispatchEvent(new CustomEvent('jarvis-attachment-progress', {
                detail: {
                    id: attachment?.id || '',
                    name: attachment?.name || '',
                    message: String(message || '')
                }
            }));
        } catch (_) {}
    }
}

async function loadTesseractJs() {
    if (!tesseractLoaderPromise) {
        tesseractLoaderPromise = (async () => {
            if (typeof globalThis !== 'undefined' && globalThis.Tesseract) {
                return globalThis.Tesseract;
            }
            if (typeof document === 'undefined') {
                throw new Error('DOM unavailable for Tesseract.js loading');
            }
            return new Promise((resolve, reject) => {
                const script = document.createElement('script');
                const timer = setTimeout(() => {
                    script.remove();
                    reject(new Error('Timed out loading Tesseract.js'));
                }, 10000);
                script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
                script.async = true;
                script.onload = () => {
                    clearTimeout(timer);
                    if (globalThis.Tesseract) resolve(globalThis.Tesseract);
                    else reject(new Error('Tesseract global not available after script load'));
                };
                script.onerror = () => {
                    clearTimeout(timer);
                    script.remove();
                    reject(new Error('Failed to load Tesseract.js from CDN'));
                };
                document.head.appendChild(script);
            });
        })().catch(err => {
            tesseractLoaderPromise = null;
            throw err;
        });
    }
    return tesseractLoaderPromise;
}

async function extractTextViaTesseract(imageSource, onProgress) {
    try {
        const Tesseract = await loadTesseractJs();
        const worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (typeof onProgress === 'function' && m.status === 'recognizing text' && typeof m.progress === 'number') {
                    onProgress(Math.round(m.progress * 100));
                }
            }
        });
        let ret;
        try {
            ret = await worker.recognize(imageSource);
        } finally {
            await worker.terminate().catch(() => {});
        }
        const text = String(ret?.data?.text || '').trim();
        return {
            ok: Boolean(text && (hasUsefulExtractedText(text) || text.length >= 10)),
            text: clipText(text),
            method: 'tesseract_client_ocr',
            provider: 'tesseract'
        };
    } catch (err) {
        const msg = String(err?.message || err);
        const loadFailed = /cdn|load tesseract|dom unavailable|timed out/i.test(msg);
        console.warn('Tesseract client OCR fallback failed:', msg);
        return { ok: false, text: '', method: 'tesseract_client_ocr', error: msg, loadFailed };
    }
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
    return value.length > MAX_EXTRACT_CHARS ? `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[Partial extraction: first ${MAX_EXTRACT_CHARS} of ${value.length} characters. The original file is retained; do not claim the entire source was read.]` : value;
}

export { formatBytes } from './file-format.js';

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
    const statusHtml = '';
    const fileIcon = `<span class="composer-attachment-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path></svg></span>`;
    container.innerHTML = statusHtml + items.map(item => {
        const preview = item.previewUrl
            ? `<img src="${escapeHtml(item.previewUrl)}" alt="" class="composer-attachment-thumb">`
            : fileIcon;
        return `
            <div class="composer-attachment-chip" data-attachment-id="${escapeHtml(item.id)}">
                ${preview}
                <div class="composer-attachment-meta">
                    <span class="composer-attachment-name" title="${escapeHtml(item.name)}">${escapeHtml(item.preparedName || item.name)}</span>
                    <span class="composer-attachment-size">${escapeHtml(formatBytes(item.preparedSize || item.size))}</span>
                    ${item.pastedText ? `<button type="button" class="paste-chip-action" data-paste-preview="${escapeHtml(item.id)}">Preview</button><button type="button" class="paste-chip-action" data-paste-inline="${escapeHtml(item.id)}">Insert inline</button>` : ''}
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
        container.classList.add('is-reading');
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

    // Score filename against document text task via BM25 & semantics
    const nameDocScore = scoreAttachmentIntent(name, 'document_text_task');
    const isImage = /^image\//i.test(mimeType) || IMAGE_EXTENSIONS.test(name);
    const isLikelyPhoto = isImage && nameDocScore < 0.20;

    // Check user text intent via BM25 + semantic similarity
    const userText = String(globalThis?.currentUserText || '').trim();
    const sceneScore = scoreAttachmentIntent(userText, 'scene_visual_analysis');
    const docScore = scoreAttachmentIntent(userText, 'document_text_task');
    const wantsSceneAnalysis = sceneScore > 0.25 && sceneScore >= docScore;

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
    return (globalThis.JarvisApi?.postJson || postApiJson)(path, payload, options);
}

export function showComposerMenuGroup(menu, groupName) {
    if (!menu) return;
    menu.querySelectorAll('[data-composer-group]').forEach(group => {
        group.classList.toggle('hidden', group.getAttribute('data-composer-group') !== groupName);
    });
}

export const __test = {
    normalizeImageMime,
    hasUsefulExtractedText,
    isOcrStatusMessage,
    isMetadataOnlyExtract, classifyPdfError, validateFile, isPptxFile, isRateLimitError
};
