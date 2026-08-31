export function validateEnv() {
  const groqKey = process.env.GROQ_API_KEY || '';
  const geminiKey = process.env.GEMINI_API_KEY || '';
  return { groqKey: groqKey || null, geminiKey: geminiKey || null };
}
