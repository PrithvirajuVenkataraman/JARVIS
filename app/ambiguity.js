export function isAmbiguous(query) {
  // Heuristic: question words present but no explicit entity/qualifier.
  const questionWords = /\b(?:who|what|where|when|which|how)\b/i;
  const hasQualifier = /\b(of|for|in|about)\s+\w+/i.test(query);
  return questionWords.test(query) && !hasQualifier;
}
