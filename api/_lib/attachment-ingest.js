import { extractTextFromImage, extractDocumentWithGemini } from './vision-extract.js';
import { parseDocumentWithLlamaParse, isLlamaParseSupportedDocument, resolveLlamaCloudApiKey } from './llama-parse.js';
import { parseDocumentSections } from '../../app/document-rag.js';

const MAX_EXTRACT_CHARS = 2000000;
const MAX_UNZIPPED_BYTES = 35 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 450;
const GEMINI_INLINE_MAX_BYTES = 18 * 1024 * 1024;
const TEXT_EXTENSIONS = /\.(txt|md|markdown|json|jsonl|csv|tsv|xml|html|htm|css|js|mjs|cjs|ts|tsx|jsx|py|java|cpp|c|h|hpp|cs|go|rs|rb|php|sh|bash|zsh|ps1|yaml|yml|toml|ini|cfg|conf|env|log|sql|tex|bib|svg)$/i;
const BINARY_EXTENSIONS = /\.(pdf|docx?|pptx?|xlsx?|xlsm|ods|odt|odp|rtf|epub|zip|gz|tar|rar|7z|png|jpe?g|pjpeg|gif|webp|bmp|dib|tiff?|heic|heif|heics|heifs|avif|avifs|dng|raw|cr[23]|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|jp2|j2k|jpf|jpx|jpm|pict?|pct|pic|psd|ico|cur|mp3|mp4|wav|webm|ogg|mov|avi|exe|dll|so|wasm|bin)$/i;
const IMAGE_MIMES = new Set([
    'image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/x-apple-ios-png',
    'image/webp', 'image/gif',
    'image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence', 'image/x-heic', 'image/x-heif',
    'image/avif', 'image/x-avif', 'image/avif-sequence',
    'image/bmp', 'image/x-bmp', 'image/x-ms-bmp',
    'image/tiff', 'image/tiff-fx', 'image/x-tiff',
    'image/dng', 'image/x-adobe-dng', 'image/x-raw', 'image/raw',
    'image/jp2', 'image/jpx', 'image/jpm', 'image/jpeg2000', 'image/x-jpeg2000-image',
    'image/pict', 'image/x-pict', 'image/vnd.adobe.photoshop', 'image/x-icon', 'image/vnd.microsoft.icon', 'image/svg+xml'
]);

export function validateBinarySignature(buffer, filename = '', mimeType = '') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { ok: false, code: 'empty_file', message: 'The uploaded file is empty.' };
    }
    const lowerName = String(filename || '').toLowerCase();
    const lowerMime = String(mimeType || '').toLowerCase();

    // Always block Windows/ELF/Mach-O executables regardless of filename
    if (buffer.length >= 4) {
        const isPe = buffer[0] === 0x4D && buffer[1] === 0x5A; // MZ
        const isElf = buffer[0] === 0x7F && buffer[1] === 0x45 && buffer[2] === 0x4C && buffer[3] === 0x46;
        if (isPe || isElf) {
            return { ok: false, code: 'unsupported_executable', message: `Executable files (${filename}) are not permitted.` };
        }
    }

    if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) {
        const head = buffer.subarray(0, Math.min(buffer.length, 1024)).toString('latin1');
        if (!head.includes('%PDF-')) {
            return { ok: false, code: 'invalid_pdf_signature', message: `"${filename}" does not have a valid PDF file header.` };
        }
    }

    if (/\.(docx|pptx|xlsx|xlsm|odt|odp|ods|epub|zip)$/i.test(lowerName)) {
        const isZipSig = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B &&
            ((buffer[2] === 0x03 && buffer[3] === 0x04) || (buffer[2] === 0x05 && buffer[3] === 0x06));
        if (!isZipSig) {
            return { ok: false, code: 'invalid_archive_signature', message: `"${filename}" does not appear to be a valid Office/ZIP archive.` };
        }
    }

    if (lowerName.endsWith('.png') || lowerMime === 'image/png') {
        const sig = buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47;
        if (!sig) return { ok: false, code: 'invalid_image_signature', message: `"${filename}" is not a valid PNG image.` };
    }

    if (/\.(jpe?g|pjpeg)$/i.test(lowerName) || lowerMime === 'image/jpeg') {
        const sig = buffer.length >= 3 && buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF;
        if (!sig) return { ok: false, code: 'invalid_image_signature', message: `"${filename}" is not a valid JPEG image.` };
    }

    return { ok: true };
}

export async function ingestAttachmentPayload(payload = {}) {
    const filename = String(payload.filename || 'attachment').trim() || 'attachment';
    const rawBuffer = Buffer.isBuffer(payload.buffer)
        ? payload.buffer
        : (ArrayBuffer.isView(payload.buffer) ? Buffer.from(payload.buffer.buffer, payload.buffer.byteOffset, payload.buffer.byteLength) : null);

    const rawBase64 = rawBuffer ? '' : String(payload.base64 || '').trim();
    const dataUrlMatch = rawBase64 ? rawBase64.match(/^data:([^;]+);base64,/i) : null;
    let normalizedBase64 = rawBase64
        .replace(/^data:[^;]+;base64,/i, '')
        .replace(/\s+/g, '')
        .replace(/-/g, '+')
        .replace(/_/g, '/');
    if (normalizedBase64 && !normalizedBase64.endsWith('=')) {
        while (normalizedBase64.length % 4 !== 0) normalizedBase64 += '=';
    }

    let mimeType = String(payload.mimeType || dataUrlMatch?.[1] || '').trim().toLowerCase() || guessMimeFromName(filename);
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

    let buffer = rawBuffer;
    if (!buffer) {
        if (!normalizedBase64) {
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
        try {
            buffer = Buffer.from(normalizedBase64, 'base64');
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
    }

    if (!buffer || !buffer.length) {
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

    const sigCheck = validateBinarySignature(buffer, filename, mimeType);
    if (!sigCheck.ok) {
        attempts.push({ stage: 'signature_check', ok: false, method: sigCheck.code, error: sigCheck.message });
        return buildResult({
            ok: false,
            text: '',
            method: 'signature_rejected',
            provider: 'server',
            filename,
            mimeType,
            message: sigCheck.message,
            attempts
        });
    }

    const ensureBase64 = () => {
        if (!normalizedBase64) normalizedBase64 = buffer.toString('base64');
        return normalizedBase64;
    };

    if (isImage(mimeType, filename)) {
        mimeType = normalizeImageMimeFromBuffer(mimeType, filename, buffer);
    }

    // 1. Plain text, Markdown, code, markup, CSV/TSV, JSON, YAML, XML, HTML (zero API calls)
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

    // 2. Native lightweight structured extractors FIRST for text-based formats (free, zero API credits!)
    // 2a. Text-based PDFs via server pdfjs-dist -> uncompressed literal text layer
    if (isPdf(mimeType, filename)) {
        const localPdf = await extractPdfTextServer(buffer).catch(() => ({ text: '', pageCount: 0, dense: false }));
        const fallbackBasicText = !localPdf.text ? extractPdfTextBasic(buffer) : '';
        const candidatePdfText = localPdf.text || fallbackBasicText;
        const pageCount = localPdf.pageCount || 1;
        const avgCharsPerPage = candidatePdfText.replace(/\s+/g, ' ').trim().length / Math.max(1, pageCount);
        const isDenseTextPdf = hasUsefulServerText(candidatePdfText) && (localPdf.dense || avgCharsPerPage >= 35);
        attempts.push({
            stage: 'pdf_text_server',
            ok: isDenseTextPdf,
            method: localPdf.text ? 'pdf_text_server' : 'pdf_text_layer',
            pageCount
        });
        if (isDenseTextPdf) {
            return buildResult({
                ok: true,
                text: clipText(candidatePdfText),
                pageCount,
                method: localPdf.text ? 'pdf_text_server' : 'pdf_text_layer',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 2b. Word (.docx): native XML extraction + embedded media images FIRST (free)
    if (isDocx(mimeType, filename)) {
        const { text: docxText, images: embeddedImages } = await extractDocxContent(buffer).catch(() => ({ text: '', images: [] }));
        const imageOcrBlocks = (!hasUsefulServerText(docxText) || (embeddedImages.length > 0 && docxText.length < 400))
            ? await ocrEmbeddedImages(embeddedImages, filename, payload.customKeys)
            : [];
        const combinedDocx = [docxText, ...imageOcrBlocks].filter(Boolean).join('\n\n').trim();
        const okDocx = hasUsefulServerText(combinedDocx) || Boolean(combinedDocx.length >= 4) || embeddedImages.length > 0;
        attempts.push({ stage: 'docx_xml_and_media', ok: okDocx, method: 'docx_xml_and_media' });
        if (okDocx) {
            return buildResult({
                ok: true,
                text: clipText(combinedDocx || `[Word document contains ${embeddedImages.length} embedded image(s)]`),
                images: embeddedImages.length ? embeddedImages : undefined,
                method: embeddedImages.length && imageOcrBlocks.length ? 'docx_xml_and_ocr' : 'docx_xml',
                provider: imageOcrBlocks.length ? 'vision' : 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 2c. PowerPoint (.pptx): slide-level extraction + speaker notes + diagrams FIRST (free)
    if (isPptx(mimeType, filename)) {
        const { text: pptxText, images: embeddedImages, slideCount } = await extractPptxContent(buffer).catch(() => ({ text: '', images: [], slideCount: 0 }));
        const imageOcrBlocks = (!hasUsefulServerText(pptxText) || (embeddedImages.length > 0 && pptxText.length < 400))
            ? await ocrEmbeddedImages(embeddedImages, filename, payload.customKeys)
            : [];
        const combinedPptx = [pptxText, ...imageOcrBlocks].filter(Boolean).join('\n\n').trim();
        const okPptx = hasUsefulServerText(combinedPptx) || Boolean(combinedPptx.length >= 4) || embeddedImages.length > 0;
        attempts.push({ stage: 'pptx_xml_and_media', ok: okPptx, method: 'pptx_xml_and_media' });
        if (okPptx) {
            return buildResult({
                ok: true,
                text: clipText(combinedPptx || `[Presentation contains ${embeddedImages.length} slide image(s)]`),
                pageCount: slideCount || undefined,
                images: embeddedImages.length ? embeddedImages : undefined,
                method: embeddedImages.length && imageOcrBlocks.length ? 'pptx_xml_and_ocr' : 'pptx_xml',
                provider: imageOcrBlocks.length ? 'vision' : 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 2d. Spreadsheets (.xlsx, .xlsm, .ods): native XML preserving workbook sheet names, headers, and cell values FIRST (free)
    if (isXlsxOrOds(mimeType, filename)) {
        const sheetRes = await extractSpreadsheetContent(buffer, mimeType, filename).catch(() => ({ text: '', sheetNames: [] }));
        attempts.push({ stage: 'spreadsheet_xml', ok: Boolean(sheetRes.text), method: 'spreadsheet_xml' });
        if (sheetRes.text) {
            return buildResult({
                ok: true,
                text: clipText(sheetRes.text),
                pageCount: sheetRes.sheetNames?.length || undefined,
                metadata: sheetRes.sheetNames?.length ? { sheetNames: sheetRes.sheetNames } : undefined,
                method: 'spreadsheet_xml',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 3. Advanced / Scanned Document Parsers (LlamaParse -> Gemini PDF / Files API) ONLY when native extraction wasn't sufficient
    const llamaApiKey = resolveLlamaCloudApiKey(payload.customKeys);
    if (llamaApiKey && isLlamaParseSupportedDocument(mimeType, filename)) {
        const lp = await parseDocumentWithLlamaParse({
            buffer,
            filename,
            mimeType,
            apiKey: llamaApiKey,
            timeoutMs: 28000
        }).catch(error => ({ ok: false, text: '', error: String(error?.message || error) }));
        const lpUseful = Boolean(lp?.ok && hasUsefulServerText(lp.text));
        attempts.push({
            stage: 'llamaparse_api',
            ok: lpUseful,
            method: 'llamaparse_api',
            error: lp?.error || ''
        });
        if (lpUseful) {
            return buildResult({
                ok: true,
                text: clipText(lp.text),
                method: 'llamaparse_api',
                provider: 'llamaparse',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 4. Scanned / Complex PDF fallback via Gemini (inlineData <= 18 MB, Gemini Files API with delete cleanup > 18 MB)
    if (isPdf(mimeType, filename)) {
        const geminiPdf = buffer.byteLength > GEMINI_INLINE_MAX_BYTES
            ? await extractLargeDocumentWithGeminiFilesApi({ buffer, mimeType: 'application/pdf', filename, customKeys: payload.customKeys })
                .catch(error => ({ ok: false, text: '', error: String(error?.message || error) }))
            : await extractDocumentWithGemini({
                mimeType: 'application/pdf',
                base64: ensureBase64(),
                filename,
                customKeys: payload.customKeys
            }).catch(error => ({ ok: false, text: '', error: String(error?.message || error) }));
        const geminiUseful = Boolean(geminiPdf?.ok && hasUsefulServerText(geminiPdf.text));
        attempts.push({
            stage: 'pdf_gemini_api',
            ok: geminiUseful,
            method: geminiPdf?.method || 'gemini_document_api',
            error: geminiPdf?.error || ''
        });
        if (geminiUseful) {
            return buildResult({
                ok: true,
                text: clipText(geminiPdf.text),
                method: geminiPdf?.method === 'gemini_files_api' ? 'gemini_files_api' : 'gemini_pdf_api',
                provider: 'gemini',
                filename,
                mimeType: 'application/pdf',
                attempts
            });
        }

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

    // 6. Rich Text Format (.rtf)
    if (isRtf(mimeType, filename)) {
        const rtfText = extractRtfText(buffer);
        attempts.push({ stage: 'rtf_decode', ok: Boolean(rtfText), method: 'rtf_decode' });
        if (rtfText) {
            return buildResult({
                ok: true,
                text: clipText(rtfText),
                method: 'rtf_decode',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 7. OpenDocument (.odt, .odp) & Legacy binary Word / PowerPoint (.doc, .ppt)
    if (isOdtOrOdp(mimeType, filename)) {
        const odfText = await extractOdfText(buffer).catch(() => '');
        attempts.push({ stage: 'odf_xml', ok: Boolean(odfText), method: 'odf_xml' });
        if (odfText) {
            return buildResult({
                ok: true,
                text: clipText(odfText),
                method: 'odf_xml',
                provider: 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    if (isLegacyDocOrPpt(mimeType, filename)) {
        const legacyText = extractLegacyBinaryDocText(buffer);
        const embeddedImages = extractEmbeddedImagesFromBinary(buffer, filename);
        const imageOcrBlocks = embeddedImages.length && (!legacyText || legacyText.length < 300)
            ? await ocrEmbeddedImages(embeddedImages, filename, payload.customKeys)
            : [];
        const combinedLegacy = [legacyText, ...imageOcrBlocks].filter(Boolean).join('\n\n').trim();
        const okLegacy = Boolean(combinedLegacy && (hasUsefulServerText(combinedLegacy) || combinedLegacy.length >= 20)) || embeddedImages.length > 0;
        attempts.push({ stage: 'legacy_binary_extract', ok: okLegacy, method: 'legacy_binary_extract' });
        if (okLegacy) {
            return buildResult({
                ok: true,
                text: clipText(combinedLegacy || `[Document contains ${embeddedImages.length} embedded image(s)]`),
                images: embeddedImages.length ? embeddedImages : undefined,
                method: imageOcrBlocks.length ? 'legacy_binary_and_ocr' : 'legacy_binary',
                provider: imageOcrBlocks.length ? 'vision' : 'server',
                filename,
                mimeType,
                attempts
            });
        }
    }

    // 8. EPUB & ZIP Archives
    if (isEpub(mimeType, filename)) {
        const epubText = await extractEpubTextServer(buffer).catch(() => '');
        attempts.push({ stage: 'epub_xml', ok: Boolean(epubText), method: 'epub_xml' });
        if (epubText) {
            return buildResult({ ok: true, text: clipText(epubText), method: 'epub_xml', provider: 'server', filename, mimeType, attempts });
        }
    }

    if (isZip(mimeType, filename)) {
        const zipText = await extractZipTextServer(buffer, filename).catch(() => '');
        attempts.push({ stage: 'zip_extract', ok: Boolean(zipText), method: 'zip_extract' });
        if (zipText) {
            return buildResult({ ok: true, text: clipText(zipText), method: 'zip_extract', provider: 'server', filename, mimeType, attempts });
        }
    }

    // 9. Image files (direct Vision OCR)
    if (isImage(mimeType, filename)) {
        const visionMime = normalizeImageMimeFromBuffer(mimeType, filename, buffer);
        const vision = await extractTextFromImage({
            mimeType: visionMime,
            imageBase64: ensureBase64(),
            prompt: `Extract all readable text, mathematical formulas, equations, numbers, and diagram labels from this image for file "${filename}". Preserve line order, mathematical symbols, and formatting exactly.`,
            customKeys: payload.customKeys
        }).catch(error => ({
            ok: false,
            text: '',
            error: String(error?.message || error)
        }));
        const visionText = hasUsefulServerText(vision?.text) ? vision.text : '';
        attempts.push({
            stage: 'vision_ocr',
            ok: Boolean(visionText),
            method: vision?.method || 'vision_ocr',
            error: vision?.error || ''
        });
        if (visionText) {
            return buildResult({
                ok: true,
                text: clipText(visionText),
                method: vision.method || 'vision_ocr',
                provider: vision.provider || 'vision',
                filename,
                mimeType: visionMime,
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
    const cleanText = String(fields.text || '');
    const sections = fields.ok && cleanText
        ? parseDocumentSections(cleanText, { name: fields.filename })
        : [];
    return {
        success: Boolean(fields.ok),
        ok: Boolean(fields.ok),
        text: cleanText,
        sections,
        pageCount: Number(fields.pageCount || sections.length || 0) || undefined,
        metadata: fields.metadata || undefined,
        images: Array.isArray(fields.images) && fields.images.length ? fields.images : undefined,
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

function isMathematicalOrFormulaContent(text) {
    const str = String(text || '').trim();
    if (str.length < 5) return false;
    const hasEquationOrInequality = /[\d\w\p{L}]+\s*(?:=|<|>|<=|>=|≈|\\approx|\\le|\\ge|≠|\\neq)\s*[\d\w\p{L}]/u.test(str);
    const hasMathOperators = /[\d\w\p{L}]\s*(?:[+\-*/^×÷±]|\\[a-zA-Z]+)\s*[\d\w\p{L}]/u.test(str);
    const hasMathTerms = /\b(?:solve|evaluate|simplify|calculate|derivative|integral|limit|matrix|vector|triangle|hypotenuse|radius|diameter|perimeter|area|volume|angle|degree|sin|cos|tan|log|ln|sqrt|sum|sigma|mean|median|variance|probability)\b/i.test(str);
    const hasLatexMath = /\\(?:frac|sqrt|int|sum|prod|lim|alpha|beta|gamma|theta|pi|partial|cdot|times)/i.test(str);
    return (hasEquationOrInequality || hasMathOperators || hasLatexMath || (hasMathTerms && /\d/.test(str)));
}

function hasUsefulServerText(text) {
    const value = String(text || '').replace(/\s+/g, ' ').trim();
    if (/\b(?:no (?:clear )?(?:readable )?text|no text (?:was )?detected|no text detected|no visible text|could not (?:find|detect|extract) (?:any )?(?:readable )?text|unable to (?:find|detect|extract) (?:any )?(?:readable )?text|does not contain (?:any )?readable text|extraction failed)\b/i.test(value)) {
        return false;
    }
    if (isMathematicalOrFormulaContent(value)) return true;
    if (value.length < 20) return false;
    const lettersOrDigits = (value.match(/[A-Za-z0-9\u00C0-\u024F]/g) || []).length;
    return lettersOrDigits >= 12;
}

function tryUtf8Extract(buffer, mimeType, filename) {
    if (buffer.length >= 2) {
        if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
            const txt = buffer.subarray(2).toString('utf16le').replace(/\u0000/g, '').trim();
            if (txt) return txt;
        }
        if (buffer[0] === 0xFE && buffer[1] === 0xFF) {
            const swapped = Buffer.from(buffer.subarray(2));
            for (let i = 0; i + 1 < swapped.length; i += 2) {
                const b = swapped[i];
                swapped[i] = swapped[i + 1];
                swapped[i + 1] = b;
            }
            const txt = swapped.toString('utf16le').replace(/\u0000/g, '').trim();
            if (txt) return txt;
        }
    }

    const isKnownText = TEXT_EXTENSIONS.test(filename) ||
        /^text\//i.test(mimeType) ||
        ['application/json', 'application/xml', 'application/javascript'].includes(mimeType);
    if (!isKnownText) {
        if (BINARY_EXTENSIONS.test(filename)) return '';
        const sample = buffer.subarray(0, Math.min(buffer.length, 4096)).toString('utf8');
        if (!sample.trim()) return '';
        const badChars = (sample.match(/[\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
        if (badChars / Math.max(sample.length, 1) > 0.02) return '';
    }
    const text = buffer.toString('utf8');
    if (!text.trim()) return '';
    const replacementRatio = (text.match(/\uFFFD/g) || []).length / Math.max(text.length, 1);
    if (replacementRatio > 0.02) return '';
    return text;
}

function isPdf(mimeType, filename) {
    return mimeType === 'application/pdf' || /\.pdf$/i.test(filename);
}

function isDocx(mimeType, filename) {
    return mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(filename);
}

function isLegacyDocOrPpt(mimeType, filename) {
    return mimeType === 'application/msword' ||
        mimeType === 'application/vnd.ms-powerpoint' ||
        /\.(?:doc|ppt)$/i.test(filename);
}

function isPptx(mimeType, filename) {
    return mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' || /\.pptx$/i.test(filename);
}

function isXlsxOrOds(mimeType, filename) {
    return /\.(?:xlsx?|xlsm|ods)$/i.test(filename) ||
        mimeType.includes('spreadsheet') ||
        mimeType.includes('ms-excel');
}

function isRtf(mimeType, filename) {
    return /\.rtf$/i.test(filename) || mimeType === 'application/rtf' || mimeType === 'text/rtf';
}

function isOdtOrOdp(mimeType, filename) {
    return /\.(?:odt|odp)$/i.test(filename) || mimeType.includes('opendocument.text') || mimeType.includes('opendocument.presentation');
}

function isEpub(mimeType, filename) {
    return /\.epub$/i.test(filename) || mimeType === 'application/epub+zip';
}

function isZip(mimeType, filename) {
    return /\.zip$/i.test(filename) || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed';
}

function isImage(mimeType, filename) {
    if (IMAGE_MIMES.has(mimeType) || /^image\//i.test(mimeType)) return true;
    return /\.(jpe?g|pjpeg|png|gif|webp|bmp|dib|tiff?|heic|heif|heics|heifs|avif|avifs|dng|raw|cr[23]|nef|nrw|arw|srf|sr2|raf|rw2|orf|pef|jp2|j2k|jpf|jpx|jpm|pict?|pct|pic|psd|ico|cur|svgz?)$/i.test(filename);
}

function normalizeImageMimeFromBuffer(mimeType, filename = '', buffer = null) {
    if (Buffer.isBuffer(buffer) && buffer.length >= 4) {
        if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
        if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
        if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return 'image/gif';
        if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
            return 'image/webp';
        }
    }
    const cleanMime = String(mimeType || '').trim().toLowerCase();
    if (IMAGE_MIMES.has(cleanMime)) return cleanMime;
    if (/\.(jpe?g|pjpeg)$/i.test(filename)) return 'image/jpeg';
    if (/\.png$/i.test(filename)) return 'image/png';
    if (/\.webp$/i.test(filename)) return 'image/webp';
    if (/\.gif$/i.test(filename)) return 'image/gif';
    return 'image/jpeg';
}

async function extractPdfTextServer(buffer) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const loadingTask = pdfjs.getDocument({
        data: new Uint8Array(buffer),
        useSystemFonts: true,
        isEvalSupported: false,
        verbosity: 0
    });
    const pdf = await loadingTask.promise;
    const totalPages = Number(pdf.numPages || 0);
    const pageBlocks = [];
    let usefulPages = 0;

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
        const page = await pdf.getPage(pageNum);
        const content = await page.getTextContent();
        const items = Array.isArray(content?.items) ? content.items : [];
        let lastY = null;
        const lines = [];
        let currentLine = [];
        for (const item of items) {
            const str = String(item?.str || '');
            if (!str.trim()) continue;
            const y = Array.isArray(item?.transform) ? Math.round(item.transform[5]) : null;
            if (lastY !== null && y !== null && Math.abs(y - lastY) > 4 && currentLine.length) {
                lines.push(currentLine.join(' ').trim());
                currentLine = [];
            }
            currentLine.push(str);
            if (y !== null) lastY = y;
        }
        if (currentLine.length) lines.push(currentLine.join(' ').trim());
        const pageText = lines.filter(Boolean).join('\n').trim();
        if (pageText.replace(/\s+/g, '').length >= 25) usefulPages += 1;
        pageBlocks.push(pageText ? `--- Page ${pageNum} ---\n${pageText}` : `--- Page ${pageNum} ---\n[No selectable text on page ${pageNum}]`);
    }

    const joined = pageBlocks.join('\n\n').trim();
    const dense = totalPages > 0 && usefulPages >= Math.max(1, Math.ceil(totalPages * 0.35));
    return { text: joined, pageCount: totalPages, dense };
}

async function extractLargeDocumentWithGeminiFilesApi({ buffer, mimeType = 'application/pdf', filename = 'document.pdf', customKeys = null }) {
    const apiKey = String(customKeys?.geminiApiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
    if (!apiKey) {
        return { ok: false, text: '', method: 'gemini_files_api', error: 'Gemini API key unavailable' };
    }
    const model = String(process.env.GEMINI_VISION_MODEL || 'gemini-2.5-flash').trim() || 'gemini-2.5-flash';
    let uploadedName = '';

    try {
        // Resumable upload protocol -> POST upload/v1beta/files
        const startRes = await fetch(`https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: {
                'X-Goog-Upload-Protocol': 'resumable',
                'X-Goog-Upload-Command': 'start',
                'X-Goog-Upload-Header-Content-Length': String(buffer.byteLength),
                'X-Goog-Upload-Header-Content-Type': mimeType,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ file: { display_name: filename } })
        });
        const uploadUrl = startRes.headers.get('x-goog-upload-url');
        if (!startRes.ok || !uploadUrl) {
            return { ok: false, text: '', method: 'gemini_files_api', error: `Files API start HTTP ${startRes.status}` };
        }

        const uploadRes = await fetch(uploadUrl, {
            method: 'PUT',
            headers: {
                'Content-Length': String(buffer.byteLength),
                'X-Goog-Upload-Offset': '0',
                'X-Goog-Upload-Command': 'upload, finalize'
            },
            body: buffer
        });
        const filePayload = await uploadRes.json().catch(() => null);
        const fileUri = filePayload?.file?.uri;
        uploadedName = filePayload?.file?.name || '';
        if (!uploadRes.ok || !fileUri) {
            return { ok: false, text: '', method: 'gemini_files_api', error: `Files API upload HTTP ${uploadRes.status}` };
        }

        const genRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    role: 'user',
                    parts: [
                        { text: `Extract ALL readable text, headings, tables (Markdown tables), equations, and page markers ("--- Page N ---") from "${filename}". Preserve page numbers faithfully without skipping any page.` },
                        { fileData: { mimeType, fileUri } }
                    ]
                }],
                generationConfig: { temperature: 0.1, maxOutputTokens: 8192 }
            })
        });
        const genJson = await genRes.json().catch(() => null);
        const text = genJson?.candidates?.[0]?.content?.parts?.map(p => p?.text || '').join('').trim() || '';
        if (!genRes.ok || !text) {
            return { ok: false, text: '', method: 'gemini_files_api', error: `Gemini generation HTTP ${genRes.status}` };
        }
        return { ok: true, text, method: 'gemini_files_api' };
    } finally {
        if (uploadedName) {
            fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedName}?key=${encodeURIComponent(apiKey)}`, {
                method: 'DELETE'
            }).catch(() => {});
        }
    }
}

function guessMimeFromName(filename) {
    const lower = String(filename || '').toLowerCase();
    if (lower.endsWith('.pdf')) return 'application/pdf';
    if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (lower.endsWith('.doc')) return 'application/msword';
    if (lower.endsWith('.pptx')) return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    if (lower.endsWith('.ppt')) return 'application/vnd.ms-powerpoint';
    if (/\.(xlsx|xlsm)$/.test(lower)) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (lower.endsWith('.rtf')) return 'application/rtf';
    if (lower.endsWith('.json')) return 'application/json';
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
    if (/\.(txt|md|csv|tsv|xml|html|js|ts|py)$/.test(lower)) return 'text/plain';
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

function extractWordXmlParagraphs(xml = '') {
    const paragraphs = String(xml || '').split(/<\/w:p>|<w:br[^>]*\/>/i);
    const lines = [];
    for (const p of paragraphs) {
        const pieces = Array.from(p.matchAll(/<(?:w:t|m:t)(?:\s[^>]*)?>([\s\S]*?)<\/(?:w:t|m:t)>/gi))
            .map(match => decodeXmlEntities(match[1] || ''))
            .filter(Boolean);
        const line = pieces.join('').replace(/[ \t]+/g, ' ').trim();
        if (line) lines.push(line);
    }
    return lines.join('\n').trim();
}

async function extractDocxText(buffer) {
    const { text } = await extractDocxContent(buffer);
    return text;
}

async function extractDocxContent(buffer) {
    const xmlEntries = await listNamedZipEntries(buffer, /^word\/(?:document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/i);
    const priority = (name) => name === 'word/document.xml' ? 0 : (/header/i.test(name) ? 1 : (/footer/i.test(name) ? 3 : 2));
    xmlEntries.sort((a, b) => priority(a.name) - priority(b.name) || a.name.localeCompare(b.name));

    const parts = [];
    for (const entry of xmlEntries) {
        const extracted = extractWordXmlParagraphs(entry.data.toString('utf8'));
        if (extracted) parts.push(extracted);
    }

    const mediaEntries = await listNamedZipEntries(buffer, /^word\/media\/.+\.(?:png|jpe?g|webp|gif)$/i);
    const images = collectSupportedEmbeddedImages(mediaEntries, 'word_image');
    return {
        text: parts.join('\n\n').trim(),
        images
    };
}

async function extractPptxText(buffer) {
    const { text } = await extractPptxContent(buffer);
    return text;
}

async function extractPptxContent(buffer) {
    const slides = await listNamedZipEntries(buffer, /^ppt\/slides\/slide\d+\.xml$/i);
    const notes = await listNamedZipEntries(buffer, /^ppt\/notesSlides\/notesSlide\d+\.xml$/i);
    const diagrams = await listNamedZipEntries(buffer, /^ppt\/diagrams\/data\d+\.xml$/i);

    const sortByNum = (list, re) => [...list].sort((a, b) => {
        const na = Number((a.name.match(re) || [])[1] || 0);
        const nb = Number((b.name.match(re) || [])[1] || 0);
        return na - nb;
    });

    const parts = [];
    const sortedSlides = sortByNum(slides, /slide(\d+)/i).slice(0, 500);
    for (const slide of sortedSlides) {
        const num = (slide.name.match(/slide(\d+)/i) || [])[1] || '';
        const xml = slide.data.toString('utf8');
        const paragraphs = xml.split(/<\/a:p>/i).map(p =>
            Array.from(p.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
                .map(m => decodeXmlEntities(m[1] || ''))
                .filter(Boolean)
                .join('')
                .replace(/\s+/g, ' ')
                .trim()
        ).filter(Boolean);
        if (paragraphs.length) {
            parts.push(`## Slide ${num}\n${paragraphs.join('\n')}`);
        }
    }

    for (const note of sortByNum(notes, /notesSlide(\d+)/i).slice(0, 500)) {
        const num = (note.name.match(/notesSlide(\d+)/i) || [])[1] || '';
        const text = Array.from(note.data.toString('utf8').matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
            .map(m => decodeXmlEntities(m[1] || ''))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text && !/^\d+$/.test(text)) parts.push(`Slide ${num} Notes:\n${text}`);
    }

    for (const diag of diagrams.slice(0, 50)) {
        const text = Array.from(diag.data.toString('utf8').matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
            .map(m => decodeXmlEntities(m[1] || ''))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        if (text) parts.push(`Diagram:\n${text}`);
    }

    const mediaEntries = await listNamedZipEntries(buffer, /^ppt\/media\/.+\.(?:png|jpe?g|webp|gif)$/i);
    const images = collectSupportedEmbeddedImages(mediaEntries, 'slide_image');
    return {
        text: parts.join('\n\n').trim(),
        images,
        slideCount: sortedSlides.length
    };
}

function collectSupportedEmbeddedImages(entries = [], prefix = 'embedded') {
    const out = [];
    let totalBytes = 0;
    for (const item of entries.slice(0, 6)) {
        if (!item?.data?.length) continue;
        if (item.data.length > 900 * 1024 || totalBytes + item.data.length > 2 * 1024 * 1024) continue;
        const lower = String(item.name || '').toLowerCase();
        const mimeType = lower.endsWith('.png')
            ? 'image/png'
            : (lower.endsWith('.webp') ? 'image/webp' : (lower.endsWith('.gif') ? 'image/gif' : 'image/jpeg'));
        totalBytes += item.data.length;
        out.push({
            name: item.name.split('/').pop() || `${prefix}_${out.length + 1}`,
            mimeType,
            base64: Buffer.from(item.data).toString('base64')
        });
    }
    return out;
}

async function ocrEmbeddedImages(images = [], parentName = 'document', customKeys = null) {
    if (!images.length) return [];
    const results = [];
    for (let i = 0; i < images.length && i < 4; i++) {
        const img = images[i];
        try {
            const res = await extractTextFromImage({
                mimeType: img.mimeType,
                imageBase64: img.base64,
                prompt: `Extract all readable text, headings, equations, and labels from embedded image ${i + 1} inside "${parentName}".`,
                customKeys
            });
            if (res?.ok && res.text && hasUsefulServerText(res.text)) {
                results.push(`[Embedded Image ${i + 1} OCR]\n${String(res.text).trim()}`);
            }
        } catch (_) {
            // Retain image in result.images so downstream multimodal chat sees it directly
        }
    }
    return results;
}

async function extractSpreadsheetText(buffer, mimeType, filename) {
    const { text } = await extractSpreadsheetContent(buffer, mimeType, filename);
    return text;
}

async function resolveWorkbookSheetNames(buffer) {
    const map = new Map();
    try {
        const wbEntry = await readZipEntry(buffer, 'xl/workbook.xml');
        const relsEntry = await readZipEntry(buffer, 'xl/_rels/workbook.xml.rels');
        if (!wbEntry) return map;
        const wbXml = wbEntry.toString('utf8');
        const relsXml = relsEntry ? relsEntry.toString('utf8') : '';
        const relTargets = new Map();
        for (const rm of relsXml.matchAll(/<Relationship\b([^>]+)>/gi)) {
            const attrs = rm[1] || '';
            const id = (attrs.match(/\bId="([^"]+)"/i) || [])[1] || '';
            const target = (attrs.match(/\bTarget="([^"]+)"/i) || [])[1] || '';
            if (id && target) {
                const normalizedTarget = target.replace(/^\/?xl\//i, '').replace(/^\//, '');
                relTargets.set(id, normalizedTarget.startsWith('worksheets/') ? `xl/${normalizedTarget}` : `xl/${normalizedTarget}`);
            }
        }
        let sheetIdx = 0;
        for (const sm of wbXml.matchAll(/<sheet\b([^>]+)>/gi)) {
            sheetIdx += 1;
            const attrs = sm[1] || '';
            const name = decodeXmlEntities((attrs.match(/\bname="([^"]+)"/i) || [])[1] || `Sheet ${sheetIdx}`);
            const rid = (attrs.match(/\br:id="([^"]+)"/i) || [])[1] || '';
            const targetPath = relTargets.get(rid) || `xl/worksheets/sheet${sheetIdx}.xml`;
            map.set(targetPath.toLowerCase(), name);
        }
    } catch (_) {}
    return map;
}

async function extractSpreadsheetContent(buffer, mimeType, filename) {
    if (/\.ods$/i.test(filename) || mimeType.includes('opendocument')) {
        return { text: await extractOdfText(buffer), sheetNames: [] };
    }
    const sheetNamesMap = await resolveWorkbookSheetNames(buffer);
    const sharedEntry = await readZipEntry(buffer, 'xl/sharedStrings.xml');
    const sharedStrings = [];
    if (sharedEntry) {
        const sXml = sharedEntry.toString('utf8');
        for (const si of sXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
            const val = Array.from(si[1].matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi))
                .map(m => decodeXmlEntities(m[1] || ''))
                .join('');
            sharedStrings.push(val);
        }
    }
    const sheets = await listNamedZipEntries(buffer, /^xl\/worksheets\/sheet\d+\.xml$/i);
    sheets.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    const parts = [];
    const sheetNames = [];
    for (const sheet of sheets.slice(0, 60)) {
        const sXml = sheet.data.toString('utf8');
        const rows = [];
        for (const rowMatch of sXml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gi)) {
            const cells = [];
            for (const cMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
                const attrs = cMatch[1] || '';
                const body = cMatch[2] || '';
                const typeMatch = attrs.match(/\bt="([^"]+)"/i);
                const cellType = typeMatch?.[1] || '';
                let val = '';
                if (cellType === 'inlineStr') {
                    val = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/gi)).map(m => decodeXmlEntities(m[1] || '')).join('');
                } else {
                    const vMatch = body.match(/<v[^>]*>([\s\S]*?)<\/v>/i);
                    const rawVal = vMatch ? decodeXmlEntities(vMatch[1] || '') : '';
                    val = cellType === 's' ? (sharedStrings[Number(rawVal)] ?? rawVal) : rawVal;
                }
                cells.push(String(val || '').replace(/\|/g, '\\|').trim());
            }
            if (cells.some(Boolean)) rows.push(cells);
            if (rows.length >= 2000) break;
        }
        if (!rows.length) continue;
        const resolvedName = sheetNamesMap.get(sheet.name.toLowerCase()) || sheet.name.split('/').pop();
        sheetNames.push(resolvedName);
        const header = rows[0];
        const md = [
            '| ' + header.join(' | ') + ' |',
            '| ' + header.map(() => '---').join(' | ') + ' |',
            ...rows.slice(1).map(r => '| ' + header.map((_, idx) => r[idx] || '').join(' | ') + ' |')
        ].join('\n');
        parts.push(`## Sheet: ${resolvedName}\n\n${md}`);
    }
    return { text: parts.join('\n\n---\n\n').trim(), sheetNames };
}

function extractRtfText(buffer) {
    const rtf = buffer.toString('latin1');
    if (!rtf.includes('{\\rtf')) return '';
    return rtf
        .replace(/\{\\\*(?:\\[a-z]+[^}]*|[^}])*\}/gi, ' ')
        .replace(/\{\\(?:fonttbl|colortbl|stylesheet|info|pict|object|header|footer)[^}]*(?:\{[^}]*\}[^}]*)*\}/gi, ' ')
        .replace(/\\'([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
        .replace(/\\u(-?\d+)\??/g, (_, code) => {
            const n = Number(code);
            return String.fromCharCode(n < 0 ? n + 65536 : n);
        })
        .replace(/\\(?:par|line)\b/gi, '\n')
        .replace(/\\tab\b/gi, '\t')
        .replace(/\\[a-z]+-?\d*\s?/gi, '')
        .replace(/[{}]/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

async function extractOdfText(buffer) {
    const content = await readZipEntry(buffer, 'content.xml');
    if (!content) return '';
    const xml = content.toString('utf8');
    return xml
        .replace(/<text:line-break[^>]*\/>/gi, '\n')
        .replace(/<\/(?:text:p|text:h|table:table-row)>/gi, '\n')
        .replace(/<\/table:table-cell>/gi, ' | ')
        .replace(/<[^>]+>/g, '')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function extractLegacyBinaryDocText(buffer) {
    const chunks = [];
    const utf16 = buffer.toString('utf16le');
    for (const m of utf16.matchAll(/[\u0020-\u007E\u00A0-\u024F\r\n\t]{12,}/g)) {
        const s = String(m[0] || '').trim();
        if (/[A-Za-z]{3,}/.test(s) && !/^Root Entry|WordDocument|PowerPoint Document|SummaryInformation/i.test(s)) {
            chunks.push(s);
        }
    }
    const ascii = buffer.toString('latin1');
    for (const m of ascii.matchAll(/[A-Za-z0-9 ,.;:!?'"()\[\]\-\/+=%]{20,}/g)) {
        const s = String(m[0] || '').trim();
        if (/[A-Za-z]{3,}/.test(s) && !/^Root Entry|WordDocument|PowerPoint Document|Times New Roman|Calibri|Arial|Microsoft/i.test(s)) {
            chunks.push(s);
        }
    }
    return Array.from(new Set(chunks)).join('\n').slice(0, MAX_EXTRACT_CHARS).trim();
}

function extractEmbeddedImagesFromBinary(buffer, prefix = 'legacy') {
    const out = [];
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const pngSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const pngEnd = Buffer.from('IEND');
    let idx = 0;
    while (out.length < 3 && idx < buf.length) {
        const start = buf.indexOf(pngSig, idx);
        if (start < 0) break;
        const iendPos = buf.indexOf(pngEnd, start + 8);
        if (iendPos < 0 || iendPos + 8 - start > 900 * 1024) break;
        const slice = buf.subarray(start, iendPos + 8);
        out.push({ name: `${prefix}_${out.length + 1}.png`, mimeType: 'image/png', base64: slice.toString('base64') });
        idx = iendPos + 8;
    }
    return out;
}

async function extractEpubTextServer(buffer) {
    const htmlEntries = await listNamedZipEntries(buffer, /\.(?:xhtml|html|htm)$/i);
    const parts = [];
    for (const entry of htmlEntries.slice(0, 40)) {
        const stripped = entry.data.toString('utf8')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<\/(?:p|div|h[1-6]|li|tr|br)>/gi, '\n')
            .replace(/<[^>]+>/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
        if (stripped) parts.push(decodeXmlEntities(stripped));
    }
    return parts.join('\n\n').trim();
}

async function extractZipTextServer(buffer, filename) {
    const entries = await listNamedZipEntries(buffer, /./);
    const manifest = entries.slice(0, 100).map(e => `- ${e.name} (${e.data.length} bytes)`).join('\n');
    const parts = [`## ZIP Contents: ${filename}\n\n${manifest}`];
    for (const entry of entries) {
        if (TEXT_EXTENSIONS.test(entry.name) && entry.data.length > 0 && entry.data.length <= 200 * 1024) {
            const text = entry.data.toString('utf8').trim();
            if (text) parts.push(`### File: ${entry.name}\n\n${text.slice(0, 20000)}`);
        }
        if (parts.length >= 12) break;
    }
    return parts.join('\n\n---\n\n').trim();
}

async function listZipEntries(buffer, namePattern) {
    return (await listNamedZipEntries(buffer, namePattern)).map(item => item.data);
}

async function listNamedZipEntries(buffer, namePattern) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return [];
    const totalEntries = Math.min(MAX_ZIP_ENTRIES, view.getUint16(eocdOffset + 10, true));
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let offset = centralDirOffset;
    const matches = [];
    let totalUnzipped = 0;

    for (let i = 0; i < totalEntries; i += 1) {
        if (offset + 46 > buffer.length || view.getUint32(offset, true) !== 0x02014b50) break;
        const compression = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        if (offset + 46 + nameLength > buffer.length) break;
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (!namePattern.test(name)) continue;
        if (uncompressedSize > MAX_UNZIPPED_BYTES || totalUnzipped + uncompressedSize > MAX_UNZIPPED_BYTES) {
            throw new Error('Archive exceeds safe uncompressed extraction limit.');
        }
        if (localHeaderOffset + 30 > buffer.length) continue;
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        if (dataStart + compressedSize > buffer.length) continue;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        let data = null;
        if (compression === 0) data = Buffer.from(compressed);
        else if (compression === 8) {
            const { inflateRawSync } = await import('node:zlib');
            data = inflateRawSync(compressed, { maxOutputLength: MAX_UNZIPPED_BYTES - totalUnzipped });
        }
        if (data) {
            totalUnzipped += data.byteLength;
            if (totalUnzipped > MAX_UNZIPPED_BYTES) {
                throw new Error('Archive decompression limit exceeded.');
            }
            matches.push({ name, data });
        }
    }
    return matches
        .sort((a, b) => {
            const na = Number((a.name.match(/slide(\d+)/i) || [])[1] || 0);
            const nb = Number((b.name.match(/slide(\d+)/i) || [])[1] || 0);
            return na - nb;
        });
}

async function readZipEntry(buffer, targetName) {
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const eocdOffset = findEndOfCentralDirectory(buffer);
    if (eocdOffset < 0) return null;
    const totalEntries = Math.min(MAX_ZIP_ENTRIES, view.getUint16(eocdOffset + 10, true));
    const centralDirOffset = view.getUint32(eocdOffset + 16, true);
    let offset = centralDirOffset;
    for (let i = 0; i < totalEntries; i += 1) {
        if (offset + 46 > buffer.length || view.getUint32(offset, true) !== 0x02014b50) break;
        const compression = view.getUint16(offset + 10, true);
        const compressedSize = view.getUint32(offset + 20, true);
        const uncompressedSize = view.getUint32(offset + 24, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const localHeaderOffset = view.getUint32(offset + 42, true);
        if (offset + 46 + nameLength > buffer.length) break;
        const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
        offset += 46 + nameLength + extraLength + commentLength;
        if (name !== targetName) continue;
        if (uncompressedSize > MAX_UNZIPPED_BYTES || localHeaderOffset + 30 > buffer.length) return null;
        const localNameLength = view.getUint16(localHeaderOffset + 26, true);
        const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
        const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
        if (dataStart + compressedSize > buffer.length) return null;
        const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
        if (compression === 0) return Buffer.from(compressed);
        if (compression === 8) {
            const { inflateRawSync } = await import('node:zlib');
            return inflateRawSync(compressed, { maxOutputLength: MAX_UNZIPPED_BYTES });
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
    extractPdfTextServer,
    validateBinarySignature,
    tryUtf8Extract,
    guessMimeFromName,
    isPdf,
    isImage,
    extractDocxText,
    extractPptxText,
    extractRtfText,
    extractSpreadsheetText,
    extractSpreadsheetContent,
    extractLegacyBinaryDocText,
    listZipEntries
};
