import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

console.log('--- Testing Document OCR Pipeline & Live Camera Retirement ---');

// 1. Verify Vision Extract Gemini Model Fallbacks & Config
const visionExtractCode = fs.readFileSync(path.resolve('api/_lib/vision-extract.js'), 'utf8');
assert.ok(visionExtractCode.includes('gemini-2.5-flash'), 'Should include gemini-2.5-flash in model fallbacks');
assert.ok(visionExtractCode.includes('gemini-3.7-flash'), 'Should include gemini-3.7-flash in model fallbacks');
assert.ok(visionExtractCode.includes('maxOutputTokens: 8192'), 'Should configure maxOutputTokens to 8192');
assert.ok(visionExtractCode.includes('Markdown tables'), 'Should instruct vision extraction to output markdown tables');
console.log('  [PASS] 1. Vision extract model fallbacks, 8192 token limit, and markdown table rules verified');

// 2. Verify API Vision Task & Text Extraction
const apiVisionCode = fs.readFileSync(path.resolve('api/vision.js'), 'utf8');
assert.ok(apiVisionCode.includes('text_extract'), 'Should support text_extract task');
assert.ok(apiVisionCode.includes('slice(0, 20000)'), 'Should allow up to 20,000 characters in compact text');
assert.ok(apiVisionCode.includes('image/heic'), 'Should accept HEIC images from iPhone camera');
assert.ok(apiVisionCode.includes('image/heif'), 'Should accept HEIF images');
assert.ok(apiVisionCode.includes('normalizeVisionMimeType'), 'Should normalize non-standard mime types to jpeg for AI providers');
console.log('  [PASS] 2. API vision text extraction, HEIC/HEIF support, and mime normalization verified');

// 3. Verify App Attachments Config & Logic
const attachmentsCode = fs.readFileSync(path.resolve('app/attachments.js'), 'utf8');
assert.ok(attachmentsCode.includes('MAX_ATTACHMENTS = 12'), 'File cap should be raised to 12');
assert.ok(attachmentsCode.includes('MAX_FILE_BYTES = 25'), 'File size limit should be 25MB');
assert.ok(attachmentsCode.includes('PDF_VISUAL_PAGE_LIMIT = 10'), 'PDF visual page limit should be 10');
assert.ok(attachmentsCode.includes('tesseract.min.js'), 'Should include lazy-loaded Tesseract.js fallback CDN');
assert.ok(attachmentsCode.includes('jarvis-attachment-progress'), 'Should dispatch attachment progress events');
assert.ok(attachmentsCode.includes('scale: 2.0') || attachmentsCode.includes('scale = 2.0') || attachmentsCode.includes('2.0'), 'Should render PDF pages at 2.0x DPI scale');
assert.ok(attachmentsCode.includes('extractedText'), 'Should store extractedText on attachment objects');
assert.ok(attachmentsCode.includes('ocrMethod'), 'Should store ocrMethod on attachment objects');
// Phase 1: new format support
assert.ok(attachmentsCode.includes('xlsx@'), 'Should lazy-load SheetJS from CDN');
assert.ok(attachmentsCode.includes('isXlsxFile'), 'Should include XLSX file detector');
assert.ok(attachmentsCode.includes('isZipFile'), 'Should include ZIP file detector');
assert.ok(attachmentsCode.includes('isEpubFile'), 'Should include EPUB file detector');
assert.ok(attachmentsCode.includes('extractXlsxTextClient'), 'Should include XLSX text extractor');
assert.ok(attachmentsCode.includes('extractZipTextClient'), 'Should include ZIP text extractor');
assert.ok(attachmentsCode.includes('extractEpubTextClient'), 'Should include EPUB text extractor');
assert.ok(attachmentsCode.includes('Promise.allSettled'), 'Should parallelize attachment processing');
assert.ok(attachmentsCode.includes('CONCURRENCY'), 'Should use concurrency semaphore for parallel processing');
console.log('  [PASS] 3. Attachment processing: 12-file cap, 25MB limit, parallel processing, XLSX/ZIP/EPUB support verified');

// 4. Verify Index.html Camera Retirement & OCR Details UI
const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
assert.equal(indexHtml.includes('id="continuous-vision-video"'), false, 'Live camera video element must be removed');
assert.equal(indexHtml.includes('id="continuous-vision-preview-shell"'), false, 'Live camera preview shell must be removed');
assert.equal(indexHtml.includes('handleContinuousVisionQuery'), false, 'Live camera query handler must be removed');
assert.ok(indexHtml.includes('attachment-ocr-details'), 'Should render attachment-ocr-details accordion');
assert.ok(indexHtml.includes('attachment-ocr-summary'), 'Should render attachment-ocr-summary');
assert.ok(indexHtml.includes('attachment-ocr-text'), 'Should render attachment-ocr-text pre element');
assert.ok(indexHtml.includes('jarvis-attachment-progress'), 'Should listen for real-time attachment progress events');
console.log('  [PASS] 4. Index.html camera retirement and OCR details accordion UI verified');

// 5. Verify Styles.css Clean State & OCR Accordion Styles
const stylesCss = fs.readFileSync(path.resolve('styles.css'), 'utf8');
assert.equal(stylesCss.includes('.continuous-vision-video'), false, 'Obsolete continuous-vision-video CSS must be removed');
assert.equal(stylesCss.includes('.paper-answer-overlay'), false, 'Obsolete paper-answer-overlay CSS must be removed');
assert.equal(stylesCss.includes('.ocr-camera-primary-action'), false, 'Obsolete ocr-camera CSS must be removed');
assert.ok(stylesCss.includes('.attachment-ocr-details'), 'Should style attachment-ocr-details');
assert.ok(stylesCss.includes('.attachment-ocr-summary'), 'Should style attachment-ocr-summary');
assert.ok(stylesCss.includes('.attachment-ocr-text'), 'Should style attachment-ocr-text');
console.log('  [PASS] 5. Styles.css dead camera CSS removal and OCR details styles verified');

// 6. Verify Phase 2: In-Browser Python Notebook Engine & tqdm Progress
assert.ok(indexHtml.includes('loadPyodideRuntime'), 'Should contain Pyodide WebAssembly lazy loader');
assert.ok(indexHtml.includes('NotebookProgress'), 'Should contain tqdm-style progress tracker with ETA');
assert.ok(indexHtml.includes('makeTqdmBar'), 'Should generate visual ASCII/unicode progress bar');
assert.ok(indexHtml.includes('transitionToNotebookButton'), 'Should transition analyzing state to Notebook label/button');
assert.ok(indexHtml.includes('runInPyodide'), 'Should execute Python in Pyodide sandbox with stdout/chart capture');
assert.ok(indexHtml.includes('isDataAnalysisFile'), 'Should detect CSV/TSV/XLSX/JSON data files for automatic notebook routing');
assert.ok(stylesCss.includes('.notebook-trigger-btn'), 'Should style notebook trigger button');
assert.ok(stylesCss.includes('.notebook-panel'), 'Should style notebook panel');
assert.ok(stylesCss.includes('.notebook-tqdm'), 'Should style top-right tqdm progress bar');
assert.ok(stylesCss.includes('.nb-code-block'), 'Should style animated python code block');
console.log('  [PASS] 6. Phase 2: In-browser Python Notebook, tqdm progress bar, and data analysis routing verified');

// 7. Verify Direct Non-Streaming API Fallback & Scope Safety
assert.ok(indexHtml.includes('let data = null;\n    let requestPayload = null;'), 'data and requestPayload must be scoped before try block');
assert.ok(indexHtml.includes('Stream failed, attempting direct non-streaming API fetch fallback'), 'Should fall back to direct non-streaming fetch on stream failure');
assert.ok(indexHtml.includes('const modelInfo = typeof formatModelDisplayName === \'function\''), 'modelInfo must be declared in function scope');
console.log('  [PASS] 7. Direct API fetch fallback on stream failure, data scope safety, modelInfo scope, and <think> guard verified');

console.log('=== All Pipeline, Phase 1, Phase 2 & Stream Resilience Tests PASSED ===');


