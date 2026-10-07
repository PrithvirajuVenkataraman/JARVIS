export function computeIntentConfidence(goal) {
  // Simple heuristic: if the goal contains a concrete entity ("of <X>") assume high confidence
  const explicit = /\bof\s+\w+/i.test(goal);
  return explicit ? 0.92 : 0.55;
}

export function computeEntityConfidence(goal) {
  // Look for proper nouns or known entity patterns
  const hasEntity = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*/.test(goal);
  return hasEntity ? 0.88 : 0.5;
}

export function computeEvidenceConfidence(evidence) {
  // evidence is expected to be an array of source objects
  if (!Array.isArray(evidence)) return 0;
  const count = evidence.length;
  if (count >= 3) return 0.95;
  if (count === 2) return 0.78;
  return 0.4; // insufficient evidence
}

import { textToEmbeddingVector, vectorCosineSimilarity } from './agent-orchestrator.js';

export function computeAnswerGroundingConfidence(answer, evidence) {
  if (!answer || !Array.isArray(evidence) || evidence.length === 0) return 0;
  try {
    const ansVec = textToEmbeddingVector(answer);
    // Average evidence vector
    const evVec = new Float32Array(ansVec.length);
    for (const src of evidence) {
      const vec = textToEmbeddingVector(src.text || src.title || '');
      for (let i = 0; i < evVec.length; i++) evVec[i] += vec[i];
    }
    for (let i = 0; i < evVec.length; i++) evVec[i] /= evidence.length;
    const sim = vectorCosineSimilarity(ansVec, evVec);
    // Scale similarity to 0-1 confidence range
    return Math.max(0, Math.min(1, (sim + 1) / 2));
  } catch (_) {
    return 0;
  }
}
