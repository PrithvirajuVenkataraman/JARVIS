// Opt-in live evaluation. Never part of deterministic CI and never sends credentials.
import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const base = new URL(option('--base-url') || 'http://localhost:3000');
const output = option('--output') || 'scratch/research-live-evaluation.json';
const cases = [
    { id: 'passport', query: '3 persons on the world can travel without the passport.', check: text => /Charles/i.test(text) && /Naruhito/i.test(text) && /Masako/i.test(text) && /entry|visa|restrictions?|permission|unverified/i.test(text) },
    { id: 'false-count', query: 'Name the four species of elephant living today.', check: (text, result) => /African|Asian|Loxodonta|Elephas/i.test(text) && result.facts?.some(f => f.premiseCorrection && f.correctedCount === 3) },
    { id: 'nextjs', query: 'What are React Server Components in Next.js?', check: (text, result) => /server/i.test(text) && result.sources?.some(s => /(?:^|\.)nextjs\.org$|(?:^|\.)react\.dev$/.test(s.domain || new URL(s.url).hostname)) && !result.sources?.some(s => /next\.co\.uk/.test(s.url)) },
    { id: 'aliases-comparison', query: 'Compare U.S. and Canada population, with the date of each estimate.', check: text => /United States|U\.S\./i.test(text) && /Canada/i.test(text) && /\d/.test(text) }
];

function inspect(result) {
    const sources = result.sources || result.results || [];
    const facts = result.facts || [];
    const support = facts.map(fact => {
        const source = sources.find(s => s.id === fact.sourceId);
        const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
        return Boolean(source && normalize(source.fullArticleText || source.snippet).includes(normalize(fact.quote)) && normalize(fact.quote).toLowerCase().includes(normalize(fact.value).toLowerCase()));
    });
    const ids = [...String(result.content || result.answer || '').matchAll(/\[(\d+)\]/g)].map(m => Number(m[1]));
    return { facts: facts.length, supportedFacts: support.filter(Boolean).length, quoteSupport: facts.length > 0 && support.every(Boolean), citationSupport: ids.length > 0 && ids.every(id => facts.some(f => f.sourceId === id)), completeness: result.answerStatus, verified: result.verified === true };
}

const report = { evaluatedAt: new Date().toISOString(), baseUrl: base.origin, pipeline: null, evaluations: [] };
try {
    const response = await fetch(new URL('/api/diagnostics', base), { signal: AbortSignal.timeout(15000) });
    const data = await response.json();
    report.pipeline = data.diagnostics?.retrieval?.researchPipeline || null;
} catch { report.diagnosticsFailure = 'diagnostics_unavailable'; }
for (const item of cases) {
    const started = Date.now();
    try {
        const response = await fetch(new URL('/api/search', base), { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(49000), body: JSON.stringify({ query: item.query, mode: 'rag', timeoutMs: 45000 }) });
        const result = await response.json();
        const metrics = inspect(result);
        const passed = response.ok && report.pipeline === 'evidence-driven-v2' && metrics.completeness === 'complete' && metrics.verified && metrics.quoteSupport && metrics.citationSupport && item.check(result.content || result.answer || '', result);
        report.evaluations.push({ id: item.id, query: item.query, passed, latencyMs: Date.now() - started, httpStatus: response.status, ...metrics, failureReasons: [...(result.research?.warnings || []), ...(result.research?.modelAttempts || []).filter(a => a.outcome !== 'success').map(a => `${a.provider || 'model'}:${a.outcome}`), ...(result.research?.coverage?.gaps || [])], result });
        console.log(`${item.id}: ${passed ? 'PASS' : 'FAIL'} ${Date.now() - started}ms; ${metrics.completeness || 'missing_status'}; ${metrics.supportedFacts}/${metrics.facts} supported facts`);
    } catch (error) {
        report.evaluations.push({ id: item.id, passed: false, latencyMs: Date.now() - started, failureReasons: [error.name === 'TimeoutError' ? 'request_timeout' : 'request_failed'] });
        console.log(`${item.id}: FAIL ${report.evaluations.at(-1).failureReasons[0]}`);
    }
}
report.passed = report.evaluations.every(e => e.passed);
await fs.mkdir(path.dirname(output), { recursive: true });
await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(`Evaluation saved to ${output}; pipeline=${report.pipeline || 'unknown'}`);
process.exitCode = report.passed ? 0 : 1;
