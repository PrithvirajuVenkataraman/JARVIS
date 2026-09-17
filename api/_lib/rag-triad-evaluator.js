/**
 * Automated RAG Triad Faithfulness & Hallucination Evaluator
 * Computes:
 * 1. Context Relevance (0.0 - 1.0): Query <-> Retrieved Evidence overlap & density
 * 2. Groundedness / Faithfulness (0.0 - 1.0): Answer claims <-> Retrieved Evidence verification
 * 3. Answer Relevance (0.0 - 1.0): Answer <-> User Query semantic completion
 */

function tokenize(text = '') {
    return Array.from(new Set(String(text || '').toLowerCase().match(/[a-z0-9]{2,}/g) || []));
}

function extractSentences(text = '') {
    return String(text || '')
        .split(/(?<=[.?!])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 5);
}

export function evaluateContextRelevance(query, evidenceChunks = []) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length || !evidenceChunks.length) return 0.5;

    const chunkScores = evidenceChunks.map(chunk => {
        const text = String(chunk?.text || chunk?.description || chunk?.title || '').toLowerCase();
        if (!text) return 0;
        const matched = queryTokens.filter(token => text.includes(token));
        return matched.length / Math.max(1, queryTokens.length);
    });

    const maxScore = Math.max(0, ...chunkScores);
    const avgScore = chunkScores.reduce((a, b) => a + b, 0) / chunkScores.length;
    return Number(((maxScore * 0.7) + (avgScore * 0.3)).toFixed(2));
}

export function evaluateGroundedness(answer, evidenceChunks = []) {
    const sentences = extractSentences(answer);
    if (!sentences.length || !evidenceChunks.length) return 0.5;

    const evidenceHaystack = evidenceChunks
        .map(c => `${c.title || ''} ${c.description || ''} ${c.text || ''}`)
        .join(' ')
        .toLowerCase();

    let supportedSentences = 0;
    for (const sentence of sentences) {
        const sentenceTokens = tokenize(sentence).filter(t => t.length > 3);
        if (!sentenceTokens.length) {
            supportedSentences += 1;
            continue;
        }

        const matchCount = sentenceTokens.filter(token => evidenceHaystack.includes(token)).length;
        const matchRatio = matchCount / sentenceTokens.length;
        if (matchRatio >= 0.6) {
            supportedSentences += 1;
        }
    }

    const score = supportedSentences / sentences.length;
    return Number(score.toFixed(2));
}

export function evaluateAnswerRelevance(query, answer) {
    const queryTokens = tokenize(query);
    const answerTokens = tokenize(answer);
    if (!queryTokens.length || !answerTokens.length) return 0.5;

    const matched = queryTokens.filter(token => answerTokens.includes(token));
    const recall = matched.length / queryTokens.length;
    return Number(Math.min(1.0, recall * 1.2).toFixed(2));
}

export function computeRagTriadEvaluation(query, answer, evidenceChunks = []) {
    const contextRelevance = evaluateContextRelevance(query, evidenceChunks);
    const groundedness = evaluateGroundedness(answer, evidenceChunks);
    const answerRelevance = evaluateAnswerRelevance(query, answer);

    const overallScore = Number(((contextRelevance * 0.3) + (groundedness * 0.5) + (answerRelevance * 0.2)).toFixed(2));
    const passed = groundedness >= 0.6 && overallScore >= 0.65;

    return {
        passed,
        overallScore,
        contextRelevance,
        groundedness,
        answerRelevance,
        verdict: passed ? 'grounded_verified' : (groundedness < 0.6 ? 'potential_hallucination_detected' : 'low_context_relevance')
    };
}
