import { runEvidenceFirstWebRag } from '../api/search.js';

async function runBenchmark() {
    const queries = process.argv.slice(2);
    if (queries.length === 0) {
        console.log('Usage: node scratch/test-optimized-latency.mjs "<query1>" ["<query2>" ...]');
        return;
    }

    for (const query of queries) {
        console.log(`------------------------------------------------------------`);
        console.log(`Query: "${query}"`);
        const start = performance.now();
        const res = await runEvidenceFirstWebRag(query);
        const duration = ((performance.now() - start) / 1000).toFixed(2);

        console.log(`Answer: "${res.answer}"`);
        console.log(`Verified: ${res.verified} | Confidence: ${res.confidence} | Phases: ${res.ragPhaseCount}`);
        console.log(`Timing Breakdown:`, res.timing);
        console.log(`Wall Clock Time: ${duration}s`);
    }
}

runBenchmark().catch(console.error);
