/**
 * Universal Document RAG, Section Preservation, Model-Aware Token Budgeting,
 * and Free-Tier LLM Provider Routing (Browser + Node ESM, zero paid dependencies).
 */

const TOKEN_CHAR_RATIO = 3.8;
const TOKENS_PER_IMAGE = 1024;

export const MODEL_CONTEXT_LIMITS = Object.freeze({
    // Gemini free-tier models (1M+ context windows; capped at conservative free latency/quota targets)
    'gemini-2.5-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-2.5-flash-lite': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 240000, maxOutputTokens: 8192 },
    'gemini-2.5-pro': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-3.5-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-3.7-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-3.8-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-4-hydrogen': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 280000, maxOutputTokens: 8192 },
    'gemini-2.0-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 220000, maxOutputTokens: 8192 },
    'gemini-1.5-flash': { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 220000, maxOutputTokens: 8192 },

    // Groq free-tier models: context windows are up to 128k-131k, but free tier is TPM-capped (6k-12k TPM).
    // Safe single-turn input budgets stay conservatively below free-tier TPM limits to avoid 413/429 failures.
    'openai/gpt-oss-120b': { provider: 'groq', contextWindow: 131072, safeInputTokens: 6500, maxOutputTokens: 4096 },
    'openai/gpt-oss-20b': { provider: 'groq', contextWindow: 131072, safeInputTokens: 6500, maxOutputTokens: 4096 },
    'qwen/qwen3.8-27b': { provider: 'groq', contextWindow: 131072, safeInputTokens: 5500, maxOutputTokens: 4096 },
    'qwen-2.5-coder-32b': { provider: 'groq', contextWindow: 131072, safeInputTokens: 5500, maxOutputTokens: 4096 },
    'deepseek-r1-distill-qwen-32b': { provider: 'groq', contextWindow: 131072, safeInputTokens: 5500, maxOutputTokens: 4096 },
    'gemma2-9b-it': { provider: 'groq', contextWindow: 8192, safeInputTokens: 4500, maxOutputTokens: 2048 }
});

export function estimateTokens(text = '', imageCount = 0) {
    const str = String(text || '');
    const textTokens = str ? Math.ceil(str.length / TOKEN_CHAR_RATIO) : 0;
    const imgTokens = Math.max(0, Number(imageCount || 0)) * TOKENS_PER_IMAGE;
    return textTokens + imgTokens;
}

export function getModelTokenBudget(model = '', provider = 'auto', options = {}) {
    const normalizedModel = String(model || '').trim().toLowerCase();
    const inferredProvider = provider && provider !== 'auto'
        ? String(provider).toLowerCase()
        : (normalizedModel.startsWith('gemini') ? 'gemini' : (normalizedModel ? 'groq' : 'gemini'));

    const spec = MODEL_CONTEXT_LIMITS[normalizedModel] || (
        inferredProvider === 'gemini'
            ? { provider: 'gemini', contextWindow: 1048576, safeInputTokens: 240000, maxOutputTokens: 8192 }
            : { provider: 'groq', contextWindow: 131072, safeInputTokens: 6000, maxOutputTokens: 4096 }
    );

    const systemTokens = Math.max(0, Number(options.systemTokens || 600));
    const historyTokens = Math.max(0, Number(options.historyTokens || 0));
    const queryTokens = Math.max(0, Number(options.queryTokens || 120));
    const imageTokens = Math.max(0, Number(options.imageCount || 0)) * TOKENS_PER_IMAGE;
    const reserveOutputTokens = Math.min(
        spec.maxOutputTokens,
        Math.max(512, Number(options.reserveOutputTokens || 2048))
    );

    const effectiveCap = Math.min(
        spec.safeInputTokens,
        Math.max(2048, spec.contextWindow - reserveOutputTokens)
    );
    const hardOverride = Number(options.maxInputTokens || 0);
    const targetInputTokens = hardOverride > 0 ? Math.min(effectiveCap, hardOverride) : effectiveCap;

    const availableDocTokens = Math.max(
        512,
        targetInputTokens - systemTokens - historyTokens - queryTokens - imageTokens
    );

    return {
        provider: spec.provider,
        model: normalizedModel || (spec.provider === 'gemini' ? 'gemini-2.5-flash' : 'openai/gpt-oss-120b'),
        contextWindow: spec.contextWindow,
        safeInputTokens: targetInputTokens,
        reserveOutputTokens,
        availableDocTokens
    };
}

const SECTION_MARKER_RE = /^(?:---\s*Page\s+(\d+)\s*---|\[Page\s+(\d+)\]|##+\s*(Slide\s+\d+[^\n]*)|##+\s*(Sheet:\s*[^\n]+)|(#{1,4}\s+[^\n]+))/i;

export function parseDocumentSections(rawText = '', meta = {}) {
    const docName = String(meta?.name || meta?.filename || 'Document').trim() || 'Document';
    const text = String(rawText || '').replace(/\r\n?/g, '\n').trim();
    if (!text) return [];

    const lines = text.split('\n');
    const sections = [];
    let current = {
        docName,
        label: meta?.defaultLabel || 'Section 1',
        pageOrSlide: meta?.pageOrSlide || '',
        sheetName: meta?.sheetName || '',
        heading: '',
        lines: []
    };

    const flushCurrent = () => {
        const body = current.lines.join('\n').trim();
        if (!body) return;
        sections.push({
            id: `${docName}#${sections.length + 1}`,
            docName,
            label: current.label,
            pageOrSlide: current.pageOrSlide,
            sheetName: current.sheetName,
            heading: current.heading,
            text: body,
            tokens: estimateTokens(body)
        });
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const match = SECTION_MARKER_RE.exec(trimmed);
        if (match) {
            if (current.lines.length > 0) flushCurrent();
            const pageNum = match[1] || match[2];
            const slideLabel = match[3];
            const sheetLabel = match[4];
            const mdHeading = match[5];
            current = {
                docName,
                label: pageNum
                    ? `Page ${pageNum}`
                    : (slideLabel || sheetLabel || mdHeading.replace(/^#+\s*/, '')).trim(),
                pageOrSlide: pageNum ? `Page ${pageNum}` : (slideLabel ? slideLabel.trim() : ''),
                sheetName: sheetLabel ? sheetLabel.replace(/^Sheet:\s*/i, '').trim() : '',
                heading: mdHeading ? mdHeading.replace(/^#+\s*/, '').trim() : '',
                lines: [line]
            };
        } else {
            current.lines.push(line);
        }
    }
    flushCurrent();

    if (!sections.length) {
        sections.push({
            id: `${docName}#1`,
            docName,
            label: 'Document',
            pageOrSlide: '',
            sheetName: '',
            heading: '',
            text,
            tokens: estimateTokens(text)
        });
    }
    return sections;
}

export function chunkSectionsWithOverlap(sections = [], { chunkTokens = 700, overlapTokens = 100 } = {}) {
    const safeChunkChars = Math.max(400, Math.floor(chunkTokens * TOKEN_CHAR_RATIO));
    const safeOverlapChars = Math.min(Math.floor(safeChunkChars * 0.4), Math.max(0, Math.floor(overlapTokens * TOKEN_CHAR_RATIO)));
    const chunks = [];

    for (const section of sections) {
        const text = String(section?.text || '').trim();
        if (!text) continue;
        if (text.length <= safeChunkChars) {
            chunks.push({
                ...section,
                chunkIndex: 0,
                text,
                tokens: estimateTokens(text)
            });
            continue;
        }
        let offset = 0;
        let part = 0;
        while (offset < text.length) {
            let end = Math.min(text.length, offset + safeChunkChars);
            if (end < text.length) {
                const nl = text.lastIndexOf('\n', end);
                const sp = text.lastIndexOf(' ', end);
                const breakAt = Math.max(nl, sp);
                if (breakAt > offset + Math.floor(safeChunkChars * 0.55)) end = breakAt;
            }
            const slice = text.slice(offset, end).trim();
            if (slice) {
                part += 1;
                chunks.push({
                    ...section,
                    id: `${section.id}:part${part}`,
                    chunkIndex: part - 1,
                    text: slice,
                    tokens: estimateTokens(slice)
                });
            }
            if (end >= text.length) break;
            offset = Math.max(offset + 1, end - safeOverlapChars);
        }
    }
    return chunks;
}

const EXHAUSTIVE_INTENT_RE = /\b(summari[sz]e|overview|full\s+document|entire\s+(?:file|document|pdf|deck|report|contract)|every\s+(?:page|slide|section|clause|item|row)|all\s+(?:pages|slides|sections|chapters|tables|clauses|requirements)|compare|contrast|difference(?:s)?\s+between|across\s+(?:all|the)\s+(?:files|documents)|table\s+of\s+contents|outline|extract\s+all|complete\s+(?:review|analysis|breakdown))\b/i;

export function classifyDocumentQueryMode(query = '') {
    const q = String(query || '').trim();
    if (!q) return 'exhaustive';
    if (EXHAUSTIVE_INTENT_RE.test(q)) return 'exhaustive';
    return 'selective';
}

function tokenizeWords(text = '') {
    return String(text || '')
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(tok => tok.length > 1);
}

export function scoreSectionRelevance(query = '', chunk = {}, corpusStats = null) {
    const queryTerms = tokenizeWords(query);
    if (!queryTerms.length) return 1;
    const content = `${chunk.docName || ''} ${chunk.label || ''} ${chunk.heading || ''} ${chunk.text || ''}`;
    const docTerms = tokenizeWords(content);
    if (!docTerms.length) return 0;

    const avgLen = corpusStats?.avgLen || Math.max(1, docTerms.length);
    const idfMap = corpusStats?.idf || null;
    const freq = new Map();
    for (const term of docTerms) freq.set(term, (freq.get(term) || 0) + 1);

    const k1 = 1.2;
    const b = 0.75;
    let score = 0;
    const seen = new Set();
    for (const term of queryTerms) {
        if (seen.has(term)) continue;
        seen.add(term);
        const tf = freq.get(term) || 0;
        if (tf === 0) continue;
        const idf = idfMap?.get(term) ?? 1.0;
        score += idf * ((tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docTerms.length / avgLen))));
    }

    // Metadata filter boost: if user explicitly references "page 12", "slide 4", "sheet revenue", or doc filename
    const qLower = String(query || '').toLowerCase();
    const labelLower = String(chunk.label || '').toLowerCase();
    const docLower = String(chunk.docName || '').toLowerCase();
    if (labelLower && qLower.includes(labelLower)) score += 6;
    if (docLower && qLower.includes(docLower.replace(/\.[^.]+$/, ''))) score += 3;

    return score;
}

function buildCorpusStats(chunks = []) {
    if (!chunks.length) return { avgLen: 1, idf: new Map() };
    const docFreq = new Map();
    let totalLen = 0;
    const tokenized = chunks.map(ch => tokenizeWords(`${ch.label || ''} ${ch.text || ''}`));
    for (const terms of tokenized) {
        totalLen += terms.length;
        const unique = new Set(terms);
        for (const t of unique) docFreq.set(t, (docFreq.get(t) || 0) + 1);
    }
    const N = chunks.length;
    const idf = new Map();
    for (const [term, df] of docFreq.entries()) {
        idf.set(term, Math.log(1 + (N - df + 0.5) / (df + 0.5)));
    }
    return { avgLen: Math.max(1, totalLen / N), idf };
}

function formatDocumentBlock(doc, bodyText) {
    const headerParts = [`### ${doc.name || 'Document'}`];
    if (doc.pageCount) headerParts.push(`Pages/Sections: ${doc.pageCount}`);
    if (doc.parser || doc.ocrMethod) headerParts.push(`Extraction: ${doc.parser || doc.ocrMethod}`);
    return `${headerParts.join(' | ')}\n${String(bodyText || '').trim()}`;
}

function formatChunkBlock(chunk) {
    const loc = [chunk.docName || 'Document', chunk.label || ''].filter(Boolean).join(' — ');
    return `[Source: ${loc}]\n${String(chunk.text || '').trim()}`;
}

export function buildDocumentGroundingBudget({
    query = '',
    docs = [],
    provider = 'auto',
    model = '',
    systemTokens = 650,
    historyTokens = 0,
    imageCount = 0,
    reserveOutputTokens = 2048,
    maxInputTokens = 0,
    chunkTokens = 700,
    overlapTokens = 100
} = {}) {
    const cleanDocs = (Array.isArray(docs) ? docs : [])
        .map(doc => {
            const rawText = String(doc?.extractedText ?? doc?.text ?? '').trim();
            const sections = Array.isArray(doc?.sections) && doc.sections.length
                ? doc.sections.map(s => ({
                    ...s,
                    docName: s.docName || doc.name || doc.filename || 'Document',
                    tokens: s.tokens || estimateTokens(s.text)
                }))
                : parseDocumentSections(rawText, { name: doc?.name || doc?.filename || 'Document' });
            return {
                name: String(doc?.name || doc?.filename || 'Document').trim() || 'Document',
                mimeType: String(doc?.mimeType || '').trim(),
                size: Number(doc?.size || doc?.sizeBytes || 0),
                pageCount: Number(doc?.pageCount || sections.length || 0),
                parser: String(doc?.parser || doc?.ocrMethod || '').trim(),
                text: rawText,
                sections,
                tokens: estimateTokens(rawText)
            };
        })
        .filter(d => d.text || d.sections.length);

    const budget = getModelTokenBudget(model, provider, {
        systemTokens,
        historyTokens,
        queryTokens: estimateTokens(query) + 120,
        imageCount,
        reserveOutputTokens,
        maxInputTokens
    });

    if (!cleanDocs.length) {
        return {
            coverage: 'empty',
            text: '',
            sectionsUsed: [],
            batches: [],
            totalDocTokens: 0,
            estimatedTokens: 0,
            availableDocTokens: budget.availableDocTokens,
            budget
        };
    }

    const fullCombined = cleanDocs.map(d => formatDocumentBlock(d, d.text)).join('\n\n---\n\n');
    const totalDocTokens = estimateTokens(fullCombined);

    // Zero truncation when everything fits cleanly within the active model's budget!
    if (totalDocTokens <= budget.availableDocTokens) {
        return {
            coverage: 'full',
            text: fullCombined,
            sectionsUsed: cleanDocs.flatMap(d => d.sections),
            batches: [],
            totalDocTokens,
            estimatedTokens: totalDocTokens,
            availableDocTokens: budget.availableDocTokens,
            budget
        };
    }

    const mode = classifyDocumentQueryMode(query);
    const allSections = cleanDocs.flatMap(d => d.sections);
    const chunks = chunkSectionsWithOverlap(allSections, { chunkTokens, overlapTokens });

    if (mode === 'exhaustive') {
        // Controlled Map-Reduce batches covering 100% of sections/chunks without dropping pages
        const perBatchBudget = Math.max(800, Math.floor(budget.availableDocTokens * 0.78));
        const batches = [];
        let currentBatch = [];
        let currentTokens = 0;

        for (const chunk of chunks) {
            const block = formatChunkBlock(chunk);
            const blockTokens = estimateTokens(block) + 12;
            if (currentBatch.length > 0 && currentTokens + blockTokens > perBatchBudget) {
                batches.push({
                    index: batches.length,
                    text: currentBatch.map(formatChunkBlock).join('\n\n'),
                    chunks: currentBatch,
                    tokens: currentTokens
                });
                currentBatch = [];
                currentTokens = 0;
            }
            currentBatch.push(chunk);
            currentTokens += blockTokens;
        }
        if (currentBatch.length > 0) {
            batches.push({
                index: batches.length,
                text: currentBatch.map(formatChunkBlock).join('\n\n'),
                chunks: currentBatch,
                tokens: currentTokens
            });
        }

        // Also provide an even sampled preview across ALL batches if single-turn fallback is invoked
        const previewBudget = budget.availableDocTokens;
        const selected = [];
        let used = 0;
        let round = 0;
        while (used < previewBudget) {
            let addedInRound = false;
            for (const batch of batches) {
                const candidate = batch.chunks[round];
                if (!candidate) continue;
                const formatted = formatChunkBlock(candidate);
                const t = estimateTokens(formatted) + 12;
                if (used + t <= previewBudget) {
                    selected.push(candidate);
                    used += t;
                    addedInRound = true;
                }
            }
            if (!addedInRound) break;
            round += 1;
        }

        return {
            coverage: batches.length > 1 ? 'map_reduce' : 'full',
            text: selected.map(formatChunkBlock).join('\n\n'),
            sectionsUsed: selected,
            batches,
            totalDocTokens,
            estimatedTokens: used,
            availableDocTokens: budget.availableDocTokens,
            budget
        };
    }

    // Selective QA: BM25 + section/page metadata ranking within available token budget
    const corpusStats = buildCorpusStats(chunks);
    const ranked = chunks
        .map((chunk, idx) => ({ chunk, idx, score: scoreSectionRelevance(query, chunk, corpusStats) }))
        .sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

    const chosen = [];
    let usedTokens = 0;
    for (const item of ranked) {
        const formatted = formatChunkBlock(item.chunk);
        const t = estimateTokens(formatted) + 12;
        if (usedTokens + t > budget.availableDocTokens) {
            if (chosen.length === 0) {
                const maxChars = Math.max(400, Math.floor((budget.availableDocTokens - 60) * TOKEN_CHAR_RATIO));
                chosen.push({
                    idx: item.idx,
                    chunk: { ...item.chunk, text: item.chunk.text.slice(0, maxChars) }
                });
                usedTokens += estimateTokens(chosen[0].chunk.text);
            }
            break;
        }
        chosen.push(item);
        usedTokens += t;
    }

    // Restore chronological document order for coherence
    chosen.sort((a, b) => a.idx - b.idx);
    const selectedChunks = chosen.map(c => c.chunk);

    return {
        coverage: selectedChunks.length === chunks.length ? 'full' : 'rag_selected',
        text: selectedChunks.map(formatChunkBlock).join('\n\n'),
        sectionsUsed: selectedChunks,
        batches: [],
        totalDocTokens,
        estimatedTokens: usedTokens,
        availableDocTokens: budget.availableDocTokens,
        budget
    };
}

export function selectLlmProviderRoute({
    docs = [],
    images = [],
    query = '',
    selectedModel = '',
    hasGroq = true,
    hasGemini = true,
    groqRateLimited = false,
    geminiRateLimited = false
} = {}) {
    const cleanModel = String(selectedModel || '').trim().toLowerCase();
    const hasImg = Array.isArray(images) && images.length > 0;
    const totalDocTokens = (Array.isArray(docs) ? docs : []).reduce(
        (sum, d) => sum + estimateTokens(d?.extractedText ?? d?.text ?? ''),
        0
    );
    const docCount = Array.isArray(docs) ? docs.length : 0;
    const queryMode = classifyDocumentQueryMode(query);

    if (cleanModel && cleanModel !== 'auto') {
        const wantsGemini = cleanModel.startsWith('gemini');
        if (wantsGemini && hasGemini && !geminiRateLimited) {
            return { provider: 'gemini', reason: 'user_selected_model', totalDocTokens, coverageMode: queryMode };
        }
        if (!wantsGemini && hasGroq && !groqRateLimited) {
            return { provider: 'groq', reason: 'user_selected_model', totalDocTokens, coverageMode: queryMode };
        }
    }

    if (hasImg || docCount > 1 || totalDocTokens > 5200) {
        if (hasGemini && !geminiRateLimited) {
            return {
                provider: 'gemini',
                reason: hasImg ? 'multimodal_attachment' : (docCount > 1 ? 'multi_document_context' : 'large_document_context'),
                totalDocTokens,
                coverageMode: queryMode
            };
        }
    }

    if (docCount === 1 && totalDocTokens > 0 && totalDocTokens <= 5200 && queryMode === 'selective') {
        if (hasGroq && !groqRateLimited) {
            return {
                provider: 'groq',
                reason: 'compact_document_fast_qa',
                totalDocTokens,
                coverageMode: queryMode
            };
        }
    }

    if (hasGemini && !geminiRateLimited) {
        return { provider: 'gemini', reason: 'default_primary_gemini', totalDocTokens, coverageMode: queryMode };
    }
    if (hasGroq && !groqRateLimited) {
        return { provider: 'groq', reason: 'fallback_groq', totalDocTokens, coverageMode: queryMode };
    }
    return { provider: hasGemini ? 'gemini' : (hasGroq ? 'groq' : 'none'), reason: 'best_available', totalDocTokens, coverageMode: queryMode };
}
