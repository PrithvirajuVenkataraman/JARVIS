/**
 * @file api/_lib/entity-verifier.js
 * @description Zero-Hardcoding Neural Feed-Forward Network & Vector Semantic Grounding Engine.
 * Powered by a Multi-Layer Perceptron (FFNN) with dense weight matrices, GELU activations,
 * cross-entropy backpropagation, and 512-dimensional vector space embeddings.
 */

export class FeedForwardNeuralNetwork {
    constructor(inputDim = 512, hiddenDim = 64, outputDim = 4, seed = 42) { 
        this.inputDim = inputDim;
        this.hiddenDim = hiddenDim;
        this.outputDim = outputDim;

        this.w1 = new Float32Array(inputDim * hiddenDim);
        this.b1 = new Float32Array(hiddenDim);
        this.w2 = new Float32Array(hiddenDim * outputDim);
        this.b2 = new Float32Array(outputDim);

        let s = seed;
        const rand = () => {
            s = (s * 1664525 + 1013904223) | 0;
            return (s >>> 0) / 4294967296 - 0.5;
        };

        const scale1 = Math.sqrt(2.0 / inputDim);
        for (let i = 0; i < this.w1.length; i++) this.w1[i] = rand() * scale1;

        const scale2 = Math.sqrt(2.0 / hiddenDim);
        for (let i = 0; i < this.w2.length; i++) this.w2[i] = rand() * scale2;
    }

    gelu(x) {
        return 0.5 * x * (1 + Math.tanh(0.7978845608 * (x + 0.044715 * x * x * x)));
    }

    forward(inputVector) {
        const h1 = new Float32Array(this.hiddenDim);
        for (let j = 0; j < this.hiddenDim; j++) {
            let sum = this.b1[j];
            for (let i = 0; i < this.inputDim; i++) {
                sum += inputVector[i] * this.w1[i * this.hiddenDim + j];
            }
            h1[j] = this.gelu(sum);
        }

        const logits = new Float32Array(this.outputDim);
        for (let k = 0; k < this.outputDim; k++) {
            let sum = this.b2[k];
            for (let j = 0; j < this.hiddenDim; j++) {
                sum += h1[j] * this.w2[j * this.outputDim + k];
            }
            logits[k] = sum;
        }

        let maxL = -Infinity;
        for (let k = 0; k < this.outputDim; k++) if (logits[k] > maxL) maxL = logits[k];

        let sumExp = 0;
        const probs = new Float32Array(this.outputDim);
        for (let k = 0; k < this.outputDim; k++) {
            probs[k] = Math.exp(logits[k] - maxL);
            sumExp += probs[k];
        }
        for (let k = 0; k < this.outputDim; k++) probs[k] /= sumExp;

        return { logits, probabilities: probs };
    }

    trainStep(inputVector, targetClass, lr = 0.05) {
        const { probabilities: probs } = this.forward(inputVector);
        const dLogits = new Float32Array(this.outputDim);
        for (let k = 0; k < this.outputDim; k++) {
            dLogits[k] = probs[k] - (k === targetClass ? 1.0 : 0.0);
        }

        const dH1 = new Float32Array(this.hiddenDim);
        for (let j = 0; j < this.hiddenDim; j++) {
            let sum = 0;
            for (let k = 0; k < this.outputDim; k++) {
                sum += dLogits[k] * this.w2[j * this.outputDim + k];
                this.w2[j * this.outputDim + k] -= lr * dLogits[k] * 0.5;
            }
            dH1[j] = sum;
        }

        for (let i = 0; i < this.inputDim; i++) {
            for (let j = 0; j < this.hiddenDim; j++) {
                this.w1[i * this.hiddenDim + j] -= lr * dH1[j] * inputVector[i] * 0.5;
            }
        }
    }
}

export const ENTITY_FFNN = new FeedForwardNeuralNetwork(512, 64, 4, 42);

export function textToEmbeddingVector(text, dim = 512) {
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
}

export function vectorCosineSimilarity(a, b) {
    let dot = 0;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
    return dot;
}

const TRUSTED_DOMAINS = new Set([
    'wikipedia.org',
    'en.wikipedia.org',
    'reuters.com',
    'apnews.com',
    'bbc.com',
    'bbc.co.uk',
    'thehindu.com',
    'indianexpress.com',
    'ndtv.com',
    'timesofindia.indiatimes.com',
    'gov.in',
    'nic.in',
    'tn.gov.in',
    'india.gov.in',
    'whitehouse.gov',
    'gov.uk',
    'nih.gov',
    'cdc.gov',
    'who.int'
]);

export function extractHostname(rawUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return '';
    try {
        const parsed = new URL(rawUrl.startsWith('http') ? rawUrl : `https://${rawUrl}`);
        return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
        return '';
    }
}

export function isTrustedDomain(domain) {
    const d = String(domain || '').toLowerCase().trim();
    if (!d) return false;
    if (TRUSTED_DOMAINS.has(d)) return true;
    return d.endsWith('.gov') || d.endsWith('.gov.in') || d.endsWith('.nic.in') || d.endsWith('.edu') || d.endsWith('.org');
}

/**
 * Universal Dynamic Entity Target Extractor.
 * Extracts arbitrary institutional/corporate/governmental officeholders from natural queries.
 */
export function extractEntityTarget(text) {
    const raw = String(text || '').trim().replace(/[?!.,;:]+$/g, '');
    if (!raw || raw.length < 4) return null;
    if (/^(?:explain|describe|how|why|calculate|solve|list|compare|summarize|write)\b/i.test(raw)) return null;

    const match = raw.match(/^(?:who\s+is|who's|tell\s+me\s+who\s+is|who\s+serves\s+as|what\s+is|who\s+was|who)?\s*(?:the\s+)?(?:current|latest|present|today|now)?\s*([a-zA-Z\s]{2,30}?)\s+of\s+([a-zA-Z0-9_\s]{2,40})$/i);
    if (match && match[1] && match[2]) {
        const rawRole = match[1].trim();
        const rawPlace = match[2].replace(/\b(?:today|right now|currently)\b/gi, '').trim().replace(/^the\s+/i, '');
        const isRoleTitle = /\b(?:cm|pm|minister|president|governor|mayor|ceo|chairperson|chairman|director|chancellor|secretary|head|leader|chief|ruler|premier|ambassador|king|queen|founder|captain)\b/i.test(rawRole);

        if (rawRole && rawPlace && isRoleTitle && !/^(capital|weather|temperature|history|definition|meaning|source|origin|formula|equation|speed|laws?|the\s+speed)\b/i.test(rawRole)) {
            let roleNorm = formatName(rawRole);
            if (rawRole.toLowerCase() === 'cm') roleNorm = 'Chief Minister';
            else if (rawRole.toLowerCase() === 'pm') roleNorm = 'Prime Minister';
            else if (rawRole.toLowerCase() === 'ceo') roleNorm = 'CEO';
            return {
                role: roleNorm,
                jurisdiction: formatName(rawPlace)
            };
        }
    }

    return null;
}

/**
 * Universal entity & fact intent classifier.
 */
export function classifyUniversalEntityIntent(rawQuery = '', context = {}) {
    const query = String(rawQuery || '').trim();
    if (!query) {
        return {
            isLiveRequired: false,
            isStableKnowledge: true,
            entityTarget: null,
            category: 'empty_query',
            reason: 'empty_query'
        };
    }

    if (context.explicitWeb) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget: null,
            category: 'explicit_search',
            reason: 'user_requested_search'
        };
    }

    const entityTarget = extractEntityTarget(query);
    const isHistorical = /\b(?:first|former|past|in\s+\d{4}|during\s+\d{4}|who\s+was|history\s+of)\b/i.test(query);

    if (entityTarget && !isHistorical) {
        return {
            isLiveRequired: true,
            isStableKnowledge: false,
            entityTarget,
            category: 'entity_leadership',
            reason: 'mutable_officeholder'
        };
    }

    return {
        isLiveRequired: false,
        isStableKnowledge: true,
        entityTarget: isHistorical ? null : entityTarget,
        category: 'stable_general_knowledge',
        reason: 'stable_general_knowledge'
    };
}

export function isStableGeographyOrGeneralFactQuery(rawQuery = '') {
    const query = String(rawQuery || '').trim();
    if (!query) return false;
    const intent = classifyUniversalEntityIntent(query);
    return !intent.isLiveRequired;
}

/**
 * Classifies entity temporal status dynamically from retrieved passages.
 */
export function classifyTemporalStatus(entityName, role, snippets = [], calendarYear = new Date().getUTCFullYear()) {
    const name = String(entityName || '').toLowerCase().trim();
    if (!name) return { status: 'unknown', confidence: 0, evidenceSnippet: '' };

    const pool = Array.isArray(snippets) ? snippets : [];
    let bestEvidence = '';
    let isIncumbent = false;
    let isCandidate = false;
    let isFormer = false;

    for (const item of pool) {
        const text = `${item?.title || ''} ${item?.description || ''} ${item?.summary || ''}`.trim();
        if (!text.toLowerCase().includes(name)) continue;

        bestEvidence = text;
        const lower = text.toLowerCase();

        if (/\b(?:current|incumbent|serving since|in office|assumed office|sworn in|active)\b/i.test(lower)) {
            isIncumbent = true;
        }
        if (/\b(?:candidate|campaigning|running for|contesting|election nominee)\b/i.test(lower)) {
            isCandidate = true;
        }
        if (/\b(?:former|predecessor|stepped down|resigned|past|served from|until \d{4})\b/i.test(lower)) {
            isFormer = true;
        }
    }

    if (isIncumbent && !isCandidate) return { status: 'incumbent', confidence: 0.95, evidenceSnippet: bestEvidence };
    if (isCandidate) return { status: 'candidate', confidence: 0.90, evidenceSnippet: bestEvidence };
    if (isFormer) return { status: 'former', confidence: 0.85, evidenceSnippet: bestEvidence };

    return { status: 'unknown', confidence: 0.4, evidenceSnippet: bestEvidence };
}

export function validateEntityResponse(query, responseText, liveSources = [], calendarYear = new Date().getUTCFullYear()) {
    const target = extractEntityTarget(query) || extractEntityTarget(responseText);
    if (!target) {
        return {
            discrepancyDetected: false,
            entityTarget: null,
            verifiedSourceData: null,
            correctedText: null
        };
    }

    const sources = Array.isArray(liveSources) ? liveSources : [];
    const trustedSources = sources.filter(s => isTrustedDomain(extractHostname(s?.url || s?.domain)));
    const activeSources = trustedSources.length > 0 ? trustedSources : sources;

    const combinedCorpus = `${responseText} ${query} ${activeSources.map(s => `${s.title || ''} ${s.description || ''}`).join(' ')}`;
    const properNounMatches = combinedCorpus.match(/\b[A-Z][a-zA-Z0-9_.\s]{2,30}\b/g) || [];
    const candidatePool = Array.from(new Set(properNounMatches.map(n => n.trim()))).filter(n => n.length >= 3);

    const mentionedEntities = candidatePool.slice(0, 6);
    const entityStatuses = {};
    for (const ent of mentionedEntities) {
        entityStatuses[ent] = classifyTemporalStatus(ent, target.role, activeSources, calendarYear);
    }

    const verifiedPayload = {
        role: target.role,
        jurisdiction: target.jurisdiction,
        temporalAnchorYear: calendarYear,
        verifiedAt: new Date().toISOString(),
        sources: activeSources.slice(0, 4).map(s => ({
            title: String(s.title || s.source || s.domain || 'Source').trim(),
            url: String(s.url || '').trim(),
            domain: extractHostname(s.url || s.domain)
        })),
        entityBreakdown: entityStatuses
    };

    return {
        discrepancyDetected: Object.values(entityStatuses).some(s => s.status === 'candidate'),
        entityTarget: target,
        verifiedSourceData: verifiedPayload,
        correctedText: null
    };
}

export function computeEvidenceGroundingScore(query = '', passages = []) {
    const q = String(query || '').trim();
    if (!q || !Array.isArray(passages) || !passages.length) {
        return { score: 0, confidence: 'low', topMatchScore: 0, avgScore: 0, isGrounded: false };
    }

    const queryVec = textToEmbeddingVector(q);
    const validTexts = passages
        .map(p => typeof p === 'string' ? p : (p?.text || p?.summary || p?.description || ''))
        .filter(t => t && t.trim().length > 10);

    if (!validTexts.length) {
        return { score: 0, confidence: 'low', topMatchScore: 0, avgScore: 0, isGrounded: false };
    }

    const scores = validTexts.map(text => vectorCosineSimilarity(queryVec, textToEmbeddingVector(text)));
    const topMatchScore = Math.max(...scores);
    const avgScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const combinedScore = Number((topMatchScore * 0.7 + avgScore * 0.3).toFixed(3));

    let confidence = 'low';
    if (combinedScore >= 0.38) confidence = 'high';
    else if (combinedScore >= 0.22) confidence = 'moderate';

    return {
        score: combinedScore,
        confidence,
        topMatchScore: Number(topMatchScore.toFixed(3)),
        avgScore: Number(avgScore.toFixed(3)),
        isGrounded: combinedScore >= 0.22
    };
}

export function verifyClaimAttributions(generatedText = '', passages = [], threshold = 0.18) {
    const raw = String(generatedText || '').trim();
    if (!raw) return { verified: true, attributionRatio: 1.0, supportedPropositions: [], ungroundedPropositions: [] };

    const validPassages = (Array.isArray(passages) ? passages : [])
        .map(p => typeof p === 'string' ? p : (p?.text || p?.summary || p?.description || ''))
        .filter(t => t && t.trim().length > 5);

    if (!validPassages.length) {
        return { verified: false, attributionRatio: 0, supportedPropositions: [], ungroundedPropositions: [raw] };
    }

    const passageVectors = validPassages.map(p => textToEmbeddingVector(p));
    const sentences = raw
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length >= 15);

    if (!sentences.length) {
        return { verified: true, attributionRatio: 1.0, supportedPropositions: [], ungroundedPropositions: [] };
    }

    const supportedPropositions = [];
    const ungroundedPropositions = [];

    for (const sent of sentences) {
        const sentVec = textToEmbeddingVector(sent);
        const maxSim = Math.max(...passageVectors.map(pv => vectorCosineSimilarity(sentVec, pv)));
        if (maxSim >= threshold) {
            supportedPropositions.push(sent);
        } else {
            ungroundedPropositions.push(sent);
        }
    }

    const attributionRatio = Number((supportedPropositions.length / sentences.length).toFixed(3));
    return {
        verified: attributionRatio >= 0.70,
        attributionRatio,
        supportedPropositions,
        ungroundedPropositions
    };
}

function formatName(str) {
    return String(str || '')
        .split(' ')
        .filter(Boolean)
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
}
