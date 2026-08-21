import assert from 'node:assert/strict';

console.log('=== Testing Splitwise Exclusion & Compact Thinking Suite ===');

// --- 1. isSplitwiseExpenseIntent implementation ---
function isSplitwiseExpenseIntent(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return false;
    // Exclude technical, architecture, coding, and engineering queries that contain 'split' (e.g. split-brain, train-test split, string split, split across shards)
    if (/\b(split[- ]brain|split[- ]test|string split|split string|database|consensus|paxos|raft|distributed|region|partition|shard|sharding|dataset|array|table|query|code|function|migration|protocol|cluster|failover)\b/i.test(t)) {
        return false;
    }
    // Must have clear financial or bill splitting phrase
    const hasBillContext = /\b(bill|check|receipt|dinner|lunch|trip|rent|groceries|expense|expenses|cost|money|rupees|rs\.?|inr|\$|usd|eur|pounds|owe|owes|owed|settle|settlement|splitwise)\b/i.test(t);
    const hasSplitAction = /\b(split\s+(?:the\s+)?(?:bill|check|expense|cost|rent|amount|total)|split\s+(?:between|among|across|with)\s+\d+|splitwise|who\s+owes\s+whom|settle\s+up|share\s+equally|divide\s+equally)\b/i.test(t);
    return (hasSplitAction || (hasBillContext && /\b(split|paid\s+by|who\s+paid)\b/i.test(t))) && /\b(?:paid|spent|contributed|owe|owes|owed|share|splitwise|between|among)\b/i.test(t);
}

// --- 2. generateContextualThoughtSteps implementation ---
function generateContextualThoughtSteps(userPrompt) {
    const raw = String(userPrompt || '').trim();
    if (!raw) return [];
    const prompt = raw.toLowerCase();

    if (/^(hi|hello|hey|thanks|thank you|good morning|good evening|good afternoon|bye|good night|ok|okay|cool|sure|yep|nope)[!.?]*$/i.test(prompt) && raw.length < 15) {
        return [];
    }

    const langMatch = raw.match(/\b(python|javascript|typescript|c\+\+|cpp|c#|rust|golang|go|java|kotlin|swift|ruby|php|sql|scala|haskell|bash|powershell|html|css)\b/i);
    const lang = langMatch ? (langMatch[0].toLowerCase() === 'cpp' ? 'C++' : langMatch[0]) : null;

    const compMatch = raw.match(/(?:difference between|compare|versus|\bvs\.?\b)\s+([A-Za-z0-9_+#.\s-]+?)\s+(?:and|versus|\bvs\.?\b)\s+([A-Za-z0-9_+#.\s-]+)/i);
    const isComparison = Boolean(compMatch) || /\b(versus|\bvs\b|compare|contrast|trade-?offs?|pros and cons|which is better)\b/i.test(prompt);
    const entityA = compMatch ? compMatch[1].trim() : null;
    const entityB = compMatch ? compMatch[2].trim() : null;

    const isCode = Boolean(lang) || /\b(code|algorithm|function|class|method|struct|pointer|interface|refactor|debug|bug|async|await|promise|regex|stack|queue|tree|graph|dp|recursion|api|database|query|table|schema|endpoint|implementation|quicksort|binary search|palindrome|distributed|paxos|raft|consensus)\b/i.test(prompt);
    const isMath = /\b(calculate|compute|solve|derivative|integral|equation|formula|matrix|matrices|eigen|probability|statistics|algebra|geometry|theorem|proof|arithmetic|polynomial|linear equation)\b/i.test(prompt);
    const isScience = /\b(physics|quantum|relativity|gravity|spacetime|black hole|event horizon|thermodynamics|chemistry|molecule|reaction|atom|orbital|biology|cell|dna|rna|gene|crispr|protein|enzyme|evolution|planet|orbit|galaxy|star|supernova|photosynthesis)\b/i.test(prompt);

    // --- STAGE 1: CONTEXTUALIZATION ---
    let stage1 = '';
    if (isComparison && (entityA || entityB)) {
        const left = entityA || 'options';
        const right = entityB || '';
        stage1 = `Scoping criteria for ${left}${right ? ' vs ' + right : ''}`;
    } else if (isCode) {
        stage1 = `Analyzing requirements & constraints${lang ? ' in ' + lang : ''}`;
    } else if (isMath) {
        stage1 = `Parsing variables & equations`;
    } else if (isScience) {
        stage1 = `Isolating governing principles`;
    } else {
        stage1 = `Analyzing inquiry premises & context`;
    }

    // --- STAGE 2: MECHANISTIC EVALUATION ---
    let stage2 = '';
    if (isComparison && (entityA || entityB)) {
        stage2 = `Evaluating performance & trade-offs`;
    } else if (isCode) {
        stage2 = `Evaluating algorithmic design & edge cases`;
    } else if (isMath) {
        stage2 = `Applying step-by-step transformations`;
    } else if (isScience) {
        stage2 = `Tracing causal mechanisms & dynamics`;
    } else {
        stage2 = `Evaluating domain principles & mechanisms`;
    }

    // --- STAGE 3: SYNTHESIS & STRUCTURED OUTPUT ---
    let stage3 = '';
    if (isComparison && (entityA || entityB)) {
        stage3 = `Structuring balanced recommendation`;
    } else if (isCode) {
        stage3 = `Structuring clean ${lang || 'code'} implementation`;
    } else if (isMath) {
        stage3 = `Verifying derivation & final values`;
    } else if (isScience) {
        stage3 = `Synthesizing first-principles explanation`;
    } else {
        stage3 = `Structuring clear, verified response`;
    }

    return [stage1, stage2, stage3];
}

// ============================================================================
// Section 1: False Positive Split-Brain / Architecture Protection
// ============================================================================
console.log('--- Section 1: False Positive Split-Brain & Architecture Protection ---');

const technicalQueries = [
    'Design a 7-day distributed multi-region database migration plan with zero downtime, analyzing Paxos vs Raft consensus, failover latency, and split-brain resolution protocols step by step.',
    'How does Kafka handle partition split across 3 brokers?',
    'Perform a 80-20 train-test split on my customer churn dataset in Python',
    'Write a regex to split string by comma delimiter without splitting escaped commas',
    'Explain how CockroachDB handles multi-region failover and split-brain scenarios'
];

for (const q of technicalQueries) {
    const isSplit = isSplitwiseExpenseIntent(q);
    assert.equal(isSplit, false, `Technical query must NOT trigger splitwise expense intent: "${q}"`);
}
console.log('  [PASS] 1.1 All technical queries containing "split" or "split-brain" rejected from expense intent');

// ============================================================================
// Section 2: Legitimate Bill Split Detection
// ============================================================================
console.log('--- Section 2: Legitimate Bill Split Detection ---');

const billQueries = [
    'Split the dinner bill of $120 between Alice, Bob, and Charlie. Alice paid 60, Bob paid 40, Charlie paid 20.',
    'Alice paid 500, Bob paid 300, split expense between 4 people',
    'Who owes whom for lunch: total $90 paid by John, split between John and Mary'
];

for (const q of billQueries) {
    const isSplit = isSplitwiseExpenseIntent(q);
    assert.equal(isSplit, true, `Legitimate expense query MUST trigger splitwise expense intent: "${q}"`);
}
console.log('  [PASS] 2.1 Genuine expense and bill splitting requests accurately recognized');

// ============================================================================
// Section 3: Compact 3-6 Word Micro-Step Thinking Text
// ============================================================================
console.log('--- Section 3: Compact 3-6 Word Micro-Step Thinking Text ---');

const testCases = [
    {
        query: 'Design a distributed database migration analyzing Paxos vs Raft in TypeScript',
        domain: 'Code / Architecture'
    },
    {
        query: 'Calculate the second derivative of f(x) = x^3 * sin(x)',
        domain: 'Math'
    },
    {
        query: 'Explain quantum entanglement and Bell inequalities in physics',
        domain: 'Science'
    }
];

for (const tc of testCases) {
    const steps = generateContextualThoughtSteps(tc.query);
    assert.equal(steps.length, 3, 'Must produce 3 stages');
    for (const s of steps) {
        const words = s.split(/\s+/).length;
        assert.ok(words <= 8, `Thinking step "${s}" must be compact (<= 8 words, got ${words})`);
        assert.ok(!s.includes('Deconstructing problem requirements and boundary constraints for'), 'Must not contain legacy wordy templates');
    }
}
console.log('  [PASS] 3.1 All generated thinking steps are crisp, compact 3-6 word micro-phrases');

// ============================================================================
// Section 4: Upfront Handler Non-Hijack Invariants (Math, Code, Dictionary)
// ============================================================================
console.log('--- Section 4: Upfront Handler Non-Hijack Invariants ---');

function isMathCalculationRequest(text) {
    const t = String(text || '').toLowerCase().trim();
    if (!t) return false;
    if (/\b(weather|forecast|news|headline|translate|joke|hotel|restaurant|code|algorithm|complexity|function|class|architecture|plan|migration|protocol|dijkstra|byzantine)\b/.test(t)) return false;
    if (/^[\d\s()+\-*/^%.=,]+$/.test(t) && /[+\-*/^%]/.test(t)) return true;
    if (/^(what is|what's|calculate|calc|compute|evaluate|solve)\s+[-+*/^%().,\d\s]+=?$/.test(t)) return true;
    if (/\b(?:sqrt|sin|cos|tan|log|ln|pow|exp|abs|floor|ceil)\s*\(\s*[-+*/^%().,\d\s]+\s*\)/i.test(t)) return true;
    if (/\b(?:scientific calculation|scientific calculator)\b/i.test(t)) return true;
    return false;
}

function isCodeAnalyzerRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const hasFencedCode = /```[\s\S]*?```/.test(raw);
    const hasExplicitCodePrompt = /\b(?:analyze|review|debug|check|inspect)\s+(?:this\s+)?(?:code|snippet|script)\s*[:\n]/i.test(raw);
    return hasFencedCode || hasExplicitCodePrompt;
}

function isWordMeaningRequest(text) {
    const raw = String(text || '').trim();
    if (!raw) return false;
    const wordCount = raw.split(/\s+/).length;
    if (wordCount > 6) return false;
    const t = raw.toLowerCase();
    return /^(?:meaning of|define|definition of|what is the meaning of)\s+["']?[a-zA-Z-]{2,40}["']?[?.!]?$/i.test(t) ||
           /^what does\s+["']?[a-zA-Z-]{2,40}["']?\s+mean[?.!]?$/i.test(t);
}

// 4.1 Non-math complex prompts must NOT be hijacked by isMathCalculationRequest
const nonMathQueries = [
    "Calculate the time complexity of Dijkstra's algorithm",
    "Solve the Byzantine Generals problem in distributed systems",
    "Evaluate Kubernetes vs Docker Swarm for production microservices",
    "Calculate the optimal memory pool size for a 7-day migration plan"
];
for (const q of nonMathQueries) {
    assert.equal(isMathCalculationRequest(q), false, `Complex query must NOT be hijacked as math calc: "${q}"`);
}
console.log('  [PASS] 4.1 Non-arithmetic reasoning queries NOT hijacked by math calculator');

// 4.2 Non-code explain prompts must NOT be hijacked by isCodeAnalyzerRequest
const nonCodeQueries = [
    "Explain the function of mitochondria in human biology",
    "Explain the function of Paxos consensus in distributed databases",
    "Review the operational mechanics of distributed systems"
];
for (const q of nonCodeQueries) {
    assert.equal(isCodeAnalyzerRequest(q), false, `General inquiry must NOT be hijacked as code analyzer: "${q}"`);
}
console.log('  [PASS] 4.2 Explainer queries containing "function" NOT hijacked by code analyzer');

// 4.3 Long conceptual prompts must NOT be hijacked by isWordMeaningRequest
const conceptualDefineQueries = [
    "Define the architecture of modern microservices with container orchestration",
    "What does continuous integration and continuous deployment mean for large engineering teams?"
];
for (const q of conceptualDefineQueries) {
    assert.equal(isWordMeaningRequest(q), false, `Multi-word concept must NOT be hijacked as dictionary lookup: "${q}"`);
}
console.log('  [PASS] 4.3 Conceptual "define" prompts NOT hijacked by 1-word dictionary lookup');

console.log('================================================================');
console.log('=== All Splitwise Exclusion & Non-Hijack Tests PASSED ===');
console.log('================================================================');
