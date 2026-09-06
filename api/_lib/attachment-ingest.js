import { extractTextFromImage } from './vision-extract.js';

const MAX_EXTRACT_CHARS = 120000;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|py|java|cpp|c|h|cs|go|rs|rb|php|sh|yaml|yml|toml|ini|log|sql|rtf)$/i;
const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp', 'image/tiff']);

export async function ingestAttachmentPayload(payload = {}) {
    const filename = String(payload.filename || 'attachment').trim() || 'attachment';
    const mimeType = String(payload.mimeType || '').trim().toLowerCase() || guessMimeFromName(filename);
    const base64 = String(payload.base64 || '').trim();
    const clientText = String(payload.clientText || '').trim();
    const clientMethod = String(payload.clientMethod || '').trim();
    const attempts = [];

    if (clientText) {
        return buildResult({
            ok: true,
            text: clipText(clientText),
            method: clientMethod || 'client',
            provider: 'client',
            filename,
            mimeType,
            attempts: [{ stage: 'client', ok: true, method: clientMethod || 'client' }]
        });
    }

    if (!base64) {
        return buildResult({
            ok: false,
            text: '',
            method: 'none',
            provider: 'none',
            filename,
            mimeType,
            message: 'No file data was provided.',
            attempts
        });
    }

    let buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch (_) {
        return buildResult({
            ok: false,
            text: '',
            method: 'none',
            provider: 'none',
            filename,
            mimeType,
            message: 'File data was malformed.',
            attempts
        });
    }

    if (!buffer.length) {
        return buildResult({
            ok: false,
            text: '',
            method: 'none',
            provider: 'none',
            filename,
            mimeType,
            message: 'The file was empty.',
            attempts
        });
    }

    const utf8Text = tryUtf8Extract(buffer, mimeType, filename);
    attempts.push({ stage: 'utf8_decode', ok: Boolean(utf8Text), method: 'utf8_decode' });
    if (utf8Text) {
        return buildResult({
            ok: true,
            text: clipText(utf8Text),
            method: 'utf8_decode',
            provider: 'server',
            filename,
            mimeType,
            attempts
        });
    }

    if (isPdf(mimeType, filename)) {
        const pdfText = extractPdfTextBasic(buffer);
        const useful = hasUsefulServerText(pdfText);
        attempts.push({ stage: 'pdf_text_layer', ok: useful, method: 'pdf_text_layer' });
        if (useful) {
            return buildResult({
                ok: true,
                text: clipText(pdfText),
                method: 'pdf_text_layer',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    if (isDocx(mimeType, filename)) {
        const docxText = await extractDocxText(buffer).catch(() => '');
        attempts.push({ stage: 'docx_xml', ok: Boolean(docxText), method: 'docx_xml' });
        if (docxText) {
            return buildResult({
                ok: true,
                text: clipText(docxText),
                method: 'docx_xml',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    if (isPptx(mimeType, filename)) {
        const pptxText = await extractPptxText(buffer).catch(() => '');
        attempts.push({ stage: 'pptx_xml', ok: Boolean(pptxText), method: 'pptx_xml' });
        if (pptxText) {
            return buildResult({
                ok: true,
                text: clipText(pptxText),
                method: 'pptx_xml',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    if (isImage(mimeType, filename)) {
        const vision = await extractTextFromImage({
            mimeType: normalizeImageMime(mimeType, filename),
            imageBase64: base64,
            prompt: `Extract all readable text from this image for file "${filename}". Preserve line order and numbers exactly.`
        }).catch(error => ({
            ok: false,
            text: '',
            error: String(error?.message || error)
        }));
        attempts.push({
            stage: 'vision_ocr',
            ok: Boolean(vision?.text),
            method: vision?.method || 'vision_ocr',
            error: vision?.error || ''
        });
        if (vision?.text) {
            return buildResult({
                ok: true,
                text: clipText(vision.text),
                method: vision.method || 'vision_ocr',
                provider: vision.provider || 'vision',
                filename,
                mimeType,
                attempts
            });
        }
    }

    const metadata = describeBinaryFile(buffer, filename, mimeType);
    return buildResult({
        ok: false,
        text: '',
        method: 'metadata_only',
        provider: 'server',
        filename,
        mimeType,
        partial: true,
        message: metadata || `Could not extract readable text from ${filename}.`,
        attempts
    });
}

function buildResult(fields) {
    return {
        success: Boolean(fields.ok),
        ok: Boolean(fields.ok),
        text: String(fields.text || ''),
        method: String(fields.method || 'none'),
        provider: String(fields.provider || 'none'),
        filename: String(fields.filename || 'attachment'),
        mimeType: String(fields.mimeType || 'application/octet-stream'),
        partial: fields.partial === true,
        message: String(fields.message || ''),
        attempts: Array.isArray(fields.attempts) ? fields.attempts : []
    };
}

function clipText(text) {
    const value = String(text || '').replace(/\u0000/g, '').trim();
    if (!value) return '';
    return value.length > MAX_EXTRACT_CHARS ? `${value.slice(0, MAX_EXTRACT_CHARS)}\n\n[Truncated]` : value;
}

function hasUsefulServerText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (value.length < 40) return false;
    const letters = (value.match(/[A-Za-z\u00C0-\u024F]/g) || []).length;
    return letters >= 24;
}

function tryUtf8Extract(buffer, mimeType, filename) {
    if (TEXT_EXTENSIONS.test(filename) || /^text\//i.test(mimeType) || ['application/json', 'application/xml', 'application/javascript'].includes(mimeType)) {
        const text = buffer.toString('utf8');
        if (!text.trim()) return '';
        const replacementRatio = (text.match(/\uFFFD/g) || []).length / Math.max(text.length, 1);
        if (replacementRatio > 0.02) return '';
        return text;
    }
    return '';
}

function isPdf(mimeType, filename) {
    return mimeType === 'application/pdf' || /\.pdf$/i.test(filename);
}

function isDocx(mimeType, filename) {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(filename);
}

function isPptx(mimeType, filename) {
    return mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || /\.pptx$/i.test(filename);
}

function isImage(mimeType, filename) {
    if (IMAGE_MIMES.has(mimeType) || /^image\//i.test(mimeType)) return true;
    return /\.(jpe?g|png|gif|webp|bmp|tiff?)$/i.test(filename);
}

function normalizeImageMime(mimeType, filename) {
    if (IMAGE_MIMES.has(mimeType)) return mimeType;
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
    if (lower.endsWith('.json')) return 'application/json';
    if (/\.(jpe?g)$/.test(lower)) return 'image/jpeg';
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    if (lower.endsWith('.gif')) return 'image/gif';
    if (/\.(txt|md|csv|xml|html|js|ts|py)$/.test(lower)) return 'text/plain';
    return 'application/octet-stream';
}

function extractPdfTextBasic(buffer) {
    const raw = buffer.toString('latin1');
    const chunks = [];
    const literalMatches = raw.matchAll(/\((?:\\.|[^\\)]){1,800}\)/g);
    for (const match of literalMatches) {
        const piece = String(match[0] || '')
            .slice(1, -1)
            .replace(/\\n/g, '\n')
            .replace(/\\r/g, '\r')
            .replace(/\\t/g, '\t')
            .replace(/\\\(/g, '(')
            .replace(/\\\)/g, ')')
            .replace(/\\\\/g, '\\')
            .trim();
        if (piece.length >= 2 && /[A-Za-z0-9]/.test(piece)) chunks.push(piece);
    }
    const text = Array.from(new Set(chunks)).join('\n').replace(/\s+\n/g, '\n').trim();
    return text.length >= 20 ? text : '';
}

async function extractDocxText(buffer) {
    const entry = await readZipEntry(buffer, 'word/document.xml');
    if (!entry) return '';
    const xml = entry.toString('utf8');
    const pieces = Array.from(xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g))
        .map(match => decodeXmlEntities(match[1] || ''))
        .filter(Boolean);
    return pieces.join(' ').replace(/\s+/g, ' ').trim();
}

async function extractPptxText(buffer) {
    const slides = await listZipEntries(buffer, /^ppt\/slides\/slide\d+\.xml$/i);
    const parts = [];
    for (const slide of slides.slice(0, 30)) {
        const xml = slide.toString('utf8');
        const pieces = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g))
            .map(match => decodeXmlEntities(match[1] || ''))
            .filter(Boolean);
        const text = pieces.join(' ').replace(/\s+/g, ' ').trim();
        if (text) parts.push(text);
    }
    return parts.join('\n\n').trim();
}

async function listZipEntries(buffer, namePattern) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return [];
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let offset = centralDirOffset;
    const matches = [];
    for (let i = 0; i < totalEntries; i += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const compression = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (!namePattern.test(name)) continue;
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        let data = null;
        if (compression === 0) data = Buffer.from(compressed);
        else if (compression === 8) {
            const { inflateRawSync } = await import('node:zlib');
            data = inflateRawSync(compressed);
        }
        if (data) matches.push({ name, data });
    }
    return matches
        .sort((a, b) => {
            const na = Number((a.name.match(/slide(\d+)/i) || [])[1] || 0);
            const nb = Number((b.name.match(/slide(\d+)/i) || [])[1] || 0);
            return na - nb;
        })
        .map(item => item.data);
}

async function readZipEntry(buffer, targetName) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return null;
    const totalEntries = view.getUint16(eocdOffset + 10, true);
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let offset = centralDirOffset;
    for (let i = 0; i < totalEntries; i += 1) {
        if (view.getUint32(offset, true) !== 0x02014b50) break;
        const compression = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (name !== targetName) continue;
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        if (compression === 0) return Buffer.from(compressed);
        if (compression === 8) {
            const { inflateRawSync } = await import('node:zlib');
            return inflateRawSync(compressed);
        }
        return null;
    }
    return null;
}

function findEndOfCentralDirectory(buffer) {
    const minOffset = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= minOffset; i -= 1) {
        if (buffer.readUInt32LE(i) === 0x06054b50) return i;
    }
    return -1;
}

function decodeXmlEntities(value) {
    return String(value || '')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function describeBinaryFile(buffer, filename, mimeType) {
    const sizeKb = Math.max(1, Math.round(buffer.length / 1024));
    return `Attached file: ${filename}\nType: ${mimeType || 'unknown'}\nSize: ${sizeKb} KB\nNo readable text could be extracted automatically.`;
}

export const __test = {
    extractPdfTextBasic,
    tryUtf8Extract,
    guessMimeFromName,
    isImage,
    isPdf,
    isDocx,
    isPptx
};
