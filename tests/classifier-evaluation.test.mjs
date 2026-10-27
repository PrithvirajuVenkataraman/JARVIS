import assert from 'node:assert/strict';
import {
    classifyLiveVsNormal,
    liveRequiredConfidence,
    decideFrontendRoute
} from '../app/frontend-routing.js';

console.log('================================================================');
console.log('=== Query Classifier Evaluation: LIVE SEARCH vs NORMAL LLM   ===');
console.log('================================================================\n');

/**
 * 100 Benchmark Queries across 4 balanced categories:
 * - 25 Clearly Static (Definitions, Math, CS, Concepts, Timeless Facts)
 * - 25 Clearly Live (Stocks, Weather, Scores, Leadership, Breaking News)
 * - 25 Ambiguous / Borderline (Token collisions like "current", "new", past years)
 * - 25 Conversational Follow-ups (Anaphora & ellipsis with active context thread)
 */
const BENCHMARK_SUITE = [
    // -------------------------------------------------------------------------
    // Category 1: Clearly Static Queries (25)
    // -------------------------------------------------------------------------
    {
        id: 'S01',
        query: 'What is recursion?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Core computer science foundational concept; completely stable.'
    },
    {
        id: 'S02',
        query: 'Explain the Pythagorean theorem',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Timeless geometric theorem.'
    },
    {
        id: 'S03',
        query: 'What is the capital of France?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Stable world geography fact.'
    },
    {
        id: 'S04',
        query: 'How does quicksort work?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Standard algorithm explanation.'
    },
    {
        id: 'S05',
        query: 'What is photosynthesis?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Established biological science definition.'
    },
    {
        id: 'S06',
        query: 'Write a Python function to reverse a linked list',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Standard coding problem; no external retrieval needed.'
    },
    {
        id: 'S07',
        query: 'What is the speed of light in vacuum?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Universal physical constant.'
    },
    {
        id: 'S08',
        query: 'Explain the difference between stack and heap memory',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Computer architecture concept.'
    },
    {
        id: 'S09',
        query: 'Who wrote the play Hamlet?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Classic literary authorship; immutable history.'
    },
    {
        id: 'S10',
        query: 'What is the atomic number of carbon?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Standard periodic table constant.'
    },
    {
        id: 'S11',
        query: "Explain Newton's second law of motion",
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Fundamental physical law.'
    },
    {
        id: 'S12',
        query: 'What was the New Kingdom of Egypt?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Ancient Egyptian historical era.'
    },
    {
        id: 'S13',
        query: 'Tell me a funny joke',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Creative / entertainment generation.'
    },
    {
        id: 'S14',
        query: "Translate 'Good morning' to Spanish",
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Language translation.'
    },
    {
        id: 'S15',
        query: 'Summarize this: The quick brown fox jumps over the lazy dog.',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Text transformation instruction.'
    },
    {
        id: 'S16',
        query: 'What is the definition of ontology in philosophy?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Philosophical concept definition.'
    },
    {
        id: 'S17',
        query: 'Calculate the derivative of x^3 + 2x with respect to x',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Symbolic calculus calculation.'
    },
    {
        id: 'S18',
        query: 'How to declare an array in C++?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Programming syntax instruction.'
    },
    {
        id: 'S19',
        query: 'When was the US Declaration of Independence signed?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Well-established historical date (1776).'
    },
    {
        id: 'S20',
        query: 'What is the chemical formula of water?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Basic chemical formula (H2O).'
    },
    {
        id: 'S21',
        query: 'Explain the concept of entropy in thermodynamics',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Physics / thermodynamic principle.'
    },
    {
        id: 'S22',
        query: 'What are the primary colors in additive color mixing?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Standard scientific color theory.'
    },
    {
        id: 'S23',
        query: 'Who discovered penicillin?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Historical medical milestone (Fleming).'
    },
    {
        id: 'S24',
        query: 'How does binary search achieve O(log n) time complexity?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Algorithmic complexity analysis.'
    },
    {
        id: 'S25',
        query: 'What is the difference between synchronous and asynchronous code?',
        category: 'static',
        expectedRoute: 'normal_llm',
        rationale: 'Programming concurrency concept.'
    },

    // -------------------------------------------------------------------------
    // Category 2: Clearly Live Queries (25)
    // -------------------------------------------------------------------------
    {
        id: 'L01',
        query: 'Apple stock price today',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Fluctuating equity price requiring real-time market data.'
    },
    {
        id: 'L02',
        query: 'Who is the current Prime Minister of the UK?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Mutable government officeholder.'
    },
    {
        id: 'L03',
        query: 'Live cricket match score today',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Real-time sporting event score.'
    },
    {
        id: 'L04',
        query: 'Weather forecast in Tokyo tomorrow',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Real-time meteorological forecast.'
    },
    {
        id: 'L05',
        query: 'What was the price of Bitcoin on 2023-03-15?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Specific historical financial lookup prone to hallucination.'
    },
    {
        id: 'L06',
        query: 'Latest breaking news headlines today',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Real-time current events.'
    },
    {
        id: 'L07',
        query: 'What is the current market cap of Microsoft?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Dynamically changing financial metric.'
    },
    {
        id: 'L08',
        query: 'Who is the current CEO of Tesla?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Mutable corporate leadership.'
    },
    {
        id: 'L09',
        query: 'What is the temperature in Chicago right now?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Real-time temperature observation.'
    },
    {
        id: 'L10',
        query: "What's new in React 19?",
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Contemporary software release changelog.'
    },
    {
        id: 'L11',
        query: 'Who won the latest world cup tournament?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Recent major tournament winner.'
    },
    {
        id: 'L12',
        query: 'Ethereum price today',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Live cryptocurrency valuation.'
    },
    {
        id: 'L13',
        query: 'Premier League standings points table',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Dynamic sports league standings.'
    },
    {
        id: 'L14',
        query: 'Who is the current Chief Minister of Tamil Nadu?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Active state leadership.'
    },
    {
        id: 'L15',
        query: 'What is the current exchange rate from EUR to USD?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Fluctuating forex exchange rate.'
    },
    {
        id: 'L16',
        query: 'Restaurants open now near me',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Real-time local business operating hours.'
    },
    {
        id: 'L17',
        query: 'Latest release notes for Python 3.12',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Recent software release specifications.'
    },
    {
        id: 'L18',
        query: 'Who is the current President of France?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Active head of state.'
    },
    {
        id: 'L19',
        query: 'Search the web for upcoming lunar eclipses in 2026',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Explicit web search command with contemporary year.'
    },
    {
        id: 'L20',
        query: "Who won yesterday's NBA basketball game?",
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Immediate sports result.'
    },
    {
        id: 'L21',
        query: 'What is the current price of gold per ounce?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Commodity market spot price.'
    },
    {
        id: 'L22',
        query: 'Who is the current governor of California?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'State executive leadership.'
    },
    {
        id: 'L23',
        query: 'Hotels near me open tonight',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Local availability query.'
    },
    {
        id: 'L24',
        query: 'Who is the current chairperson of the Federal Reserve?',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Active central bank leadership.'
    },
    {
        id: 'L25',
        query: 'Latest updates on global crude oil prices',
        category: 'live',
        expectedRoute: 'live_required',
        rationale: 'Live commodity news and price updates.'
    },

    // -------------------------------------------------------------------------
    // Category 3: Ambiguous / Borderline Queries (25)
    // -------------------------------------------------------------------------
    {
        id: 'A01',
        query: 'What is direct current?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Physical electrical current definition; must not trigger freshness on "current".'
    },
    {
        id: 'A02',
        query: 'Explain alternating current vs direct current',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Circuit theory concepts; disambiguates "current".'
    },
    {
        id: 'A03',
        query: 'How does an ocean current affect global climate?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Oceanographic concept; disambiguates "current".'
    },
    {
        id: 'A04',
        query: 'What is the current density of copper wire?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Physics property of conductor; disambiguates "current".'
    },
    {
        id: 'A05',
        query: 'Explain the concept of convection current',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Fluid dynamics / heat transfer concept; disambiguates "current".'
    },
    {
        id: 'A06',
        query: 'What is a current divider in electrical engineering?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Circuit analysis circuit rule; disambiguates "current".'
    },
    {
        id: 'A07',
        query: 'Explain the New Deal economic policies',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical proper noun containing "New"; not a freshness cue.'
    },
    {
        id: 'A08',
        query: 'What is the capital of New York?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'US state capital (Albany) containing "New"; not a freshness cue.'
    },
    {
        id: 'A09',
        query: 'Where is New Delhi located?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Geographic capital city containing "New"; not a freshness cue.'
    },
    {
        id: 'A10',
        query: 'How does the new operator work in C++?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'C++ language keyword "new"; not a freshness cue.'
    },
    {
        id: 'A11',
        query: 'Who was the most recent common ancestor of humans and chimps?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Evolutionary biology concept (MRCA); "recent" does not imply live search.'
    },
    {
        id: 'A12',
        query: 'Who was the US president in 1995?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical year (1995 < current year - 1); past officeholder.'
    },
    {
        id: 'A13',
        query: 'Who was the Prime Minister of the UK in 1940?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical past leader (Churchill); stable knowledge.'
    },
    {
        id: 'A14',
        query: 'Who was the corporate CEO before 2011?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical predecessor; past officeholder.'
    },
    {
        id: 'A15',
        query: 'What was the population of Tokyo in 1980?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical demographic fact.'
    },
    {
        id: 'A16',
        query: 'Who won the FIFA World Cup in 1998?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical tournament result (France).'
    },
    {
        id: 'A17',
        query: 'What happened in the year 2010 in technology?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical retrospective for year 2010.'
    },
    {
        id: 'A18',
        query: 'Tell me about the first President of the United States',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical founder / first leader; not current officeholder.'
    },
    {
        id: 'A19',
        query: 'What was the price of oil in 1973 during the embargo?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical economic event and price context.'
    },
    {
        id: 'A20',
        query: 'How to use new keyword in JavaScript?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'JS constructor syntax with "new".'
    },
    {
        id: 'A21',
        query: 'What was the inflation rate in 1980 in the US?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical economic data.'
    },
    {
        id: 'A22',
        query: 'Who was the governor of California in 2005?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical state leadership (Schwarzenegger).'
    },
    {
        id: 'A23',
        query: 'Explain the architecture of Brihadeeswarar Temple',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical temple architecture; immutable cultural knowledge.'
    },
    {
        id: 'A24',
        query: 'What was the capital of West Germany before reunification?',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Historical geography fact (Bonn).'
    },
    {
        id: 'A25',
        query: 'Explain how transformers work in machine learning',
        category: 'ambiguous',
        expectedRoute: 'normal_llm',
        rationale: 'Fundamental AI architectural concept; stable knowledge.'
    },

    // -------------------------------------------------------------------------
    // Category 4: Conversational Follow-up Queries with Context (25)
    // -------------------------------------------------------------------------
    {
        id: 'C01',
        query: 'Who was it before him?',
        context: { activeThread: { topic: 'Prime Minister of the UK', entity: 'Rishi Sunak' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for historical predecessor; stable knowledge.'
    },
    {
        id: 'C02',
        query: 'What is their stock price today?',
        context: { activeThread: { topic: 'Microsoft Corporation', entity: 'Microsoft' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for real-time equity valuation of antecedent entity.'
    },
    {
        id: 'C03',
        query: 'Who is the CEO now?',
        context: { activeThread: { topic: 'OpenAI Corporation', entity: 'OpenAI' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for current leader of antecedent entity.'
    },
    {
        id: 'C04',
        query: 'What is the weather there right now?',
        context: { activeThread: { topic: 'Tokyo Japan', entity: 'Tokyo' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for live weather of antecedent city.'
    },
    {
        id: 'C05',
        query: 'How much does it cost today?',
        context: { activeThread: { topic: 'Bitcoin', entity: 'BTC' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for live market price of cryptocurrency.'
    },
    {
        id: 'C06',
        query: 'Can you give a Python code example?',
        context: { activeThread: { topic: 'Binary Search Algorithm', entity: 'Binary Search' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for coding illustration of antecedent concept.'
    },
    {
        id: 'C07',
        query: 'What is the time complexity of that?',
        context: { activeThread: { topic: 'Quicksort', entity: 'Quicksort' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for theoretical CS complexity.'
    },
    {
        id: 'C08',
        query: 'Who was the founder?',
        context: { activeThread: { topic: 'Apple Computer', entity: 'Apple' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for historical founder of antecedent firm.'
    },
    {
        id: 'C09',
        query: 'When was it established?',
        context: { activeThread: { topic: 'United Nations', entity: 'UN' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for historical establishment date.'
    },
    {
        id: 'C10',
        query: 'What about right now?',
        context: { activeThread: { topic: 'Nvidia Stock Price', entity: 'NVDA' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Ellipsis follow-up requesting current live status of stock price.'
    },
    {
        id: 'C11',
        query: 'What did they announce this week?',
        context: { activeThread: { topic: 'Google', entity: 'Google' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for recent announcements from antecedent company.'
    },
    {
        id: 'C12',
        query: 'Explain that more simply',
        context: { activeThread: { topic: 'Photosynthesis', entity: 'Photosynthesis' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Clarification request for conceptual explanation.'
    },
    {
        id: 'C13',
        query: 'Translate that to German',
        context: { activeThread: { topic: 'Greeting', entity: 'Welcome' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up requesting translation of previous text.'
    },
    {
        id: 'C14',
        query: 'Who was his predecessor?',
        context: { activeThread: { topic: 'President of France', entity: 'Emmanuel Macron' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for historical predecessor of active leader.'
    },
    {
        id: 'C15',
        query: 'Are they currently winning the match?',
        context: { activeThread: { topic: 'Real Madrid vs Barcelona', entity: 'Real Madrid' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for live sporting match score/status.'
    },
    {
        id: 'C16',
        query: 'What is the capital of that country?',
        context: { activeThread: { topic: 'Brazil Geography', entity: 'Brazil' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for stable national capital.'
    },
    {
        id: 'C17',
        query: 'How many moons does it have?',
        context: { activeThread: { topic: 'Jupiter Planet', entity: 'Jupiter' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for scientific astronomy fact.'
    },
    {
        id: 'C18',
        query: 'What are their latest quarterly earnings?',
        context: { activeThread: { topic: 'Tesla Inc', entity: 'Tesla' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for recent financial corporate report.'
    },
    {
        id: 'C19',
        query: 'Is it raining there today?',
        context: { activeThread: { topic: 'London England', entity: 'London' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for live weather condition at location.'
    },
    {
        id: 'C20',
        query: 'Can you write a unit test for that?',
        context: { activeThread: { topic: 'Palindrome checker', entity: 'Algorithm' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for code test generation.'
    },
    {
        id: 'C21',
        query: 'Who succeeded him after his death?',
        context: { activeThread: { topic: 'Roman Emperors', entity: 'Julius Caesar' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for historical ancient ruler succession.'
    },
    {
        id: 'C22',
        query: 'What is their current market valuation?',
        context: { activeThread: { topic: 'Amazon', entity: 'Amazon' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for dynamic corporate market capitalization.'
    },
    {
        id: 'C23',
        query: 'What is the mathematical proof for that?',
        context: { activeThread: { topic: 'Fermat Theorem', entity: 'Fermat' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for mathematical theory explanation.'
    },
    {
        id: 'C24',
        query: 'What are the latest features released for it?',
        context: { activeThread: { topic: 'TypeScript 5', entity: 'TypeScript' } },
        category: 'context_followup',
        expectedRoute: 'live_required',
        rationale: 'Follow-up asking for fresh tech release details.'
    },
    {
        id: 'C25',
        query: 'Make that explanation more concise',
        context: { activeThread: { topic: 'Quantum entanglement', entity: 'Physics' } },
        category: 'context_followup',
        expectedRoute: 'normal_llm',
        rationale: 'Follow-up asking for stylistic text rewriting.'
    }
];

// -------------------------------------------------------------------------
// Execute Benchmark Evaluation
// -------------------------------------------------------------------------

let tp = 0; // Correctly identified LIVE SEARCH (positive)
let tn = 0; // Correctly identified NORMAL LLM (negative)
let fp = 0; // Wrongly classified NORMAL LLM as LIVE SEARCH
let fn = 0; // Wrongly classified LIVE SEARCH as NORMAL LLM

const failures = [];
const categoryStats = {
    static: { total: 0, correct: 0 },
    live: { total: 0, correct: 0 },
    ambiguous: { total: 0, correct: 0 },
    context_followup: { total: 0, correct: 0 }
};

for (const testCase of BENCHMARK_SUITE) {
    const { id, query, context, expectedRoute, category } = testCase;
    categoryStats[category].total++;

    const classification = classifyLiveVsNormal(query, context || {});
    const frontendRoute = decideFrontendRoute(query, context || {});

    const actualRoute = classification.route;
    const isCorrect = (actualRoute === expectedRoute);

    if (expectedRoute === 'live_required') {
        if (actualRoute === 'live_required') {
            tp++;
            categoryStats[category].correct++;
        } else {
            fn++;
            failures.push({
                id,
                query,
                expected: expectedRoute,
                actual: actualRoute,
                confidence: classification.confidence,
                reason: classification.reason,
                type: 'FALSE_NEGATIVE'
            });
        }
    } else {
        if (actualRoute === 'normal_llm') {
            tn++;
            categoryStats[category].correct++;
        } else {
            fp++;
            failures.push({
                id,
                query,
                expected: expectedRoute,
                actual: actualRoute,
                confidence: classification.confidence,
                reason: classification.reason,
                type: 'FALSE_POSITIVE'
            });
        }
    }

    // Also assert decideFrontendRoute alignment:
    // If expected live_required, frontendRoute.route must be live_required (or place_grounded) and require sources
    if (expectedRoute === 'live_required') {
        assert.ok(
            frontendRoute.route === 'live_required' || frontendRoute.route === 'place_grounded',
            `Frontend route for ${id} "${query}" expected live_required, got: ${frontendRoute.route}`
        );
        assert.equal(frontendRoute.requiresSources, true);
    } else {
        // If expected normal_llm, frontendRoute must NOT require sources
        assert.equal(
            frontendRoute.requiresSources,
            false,
            `Frontend route for ${id} "${query}" must not require sources, got route: ${frontendRoute.route}`
        );
    }
}

const total = BENCHMARK_SUITE.length;
const accuracy = ((tp + tn) / total) * 100;
const precision = tp + fp > 0 ? (tp / (tp + fp)) * 100 : 0;
const recall = tp + fn > 0 ? (tp / (tp + fn)) * 100 : 0;
const f1Score = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

console.log('----------------------------------------------------------------');
console.log('EVALUATION RESULTS:');
console.log('----------------------------------------------------------------');
console.log(`Total Queries Tested:    ${total}`);
console.log(`True Positives (TP):     ${tp} (Correctly classified LIVE SEARCH)`);
console.log(`True Negatives (TN):     ${tn} (Correctly classified NORMAL LLM)`);
console.log(`False Positives (FP):    ${fp} (Wrongly sent to LIVE SEARCH)`);
console.log(`False Negatives (FN):    ${fn} (Wrongly sent to NORMAL LLM)`);
console.log('----------------------------------------------------------------');
console.log(`Overall Accuracy:        ${accuracy.toFixed(2)}%`);
console.log(`Precision:               ${precision.toFixed(2)}%`);
console.log(`Recall:                  ${recall.toFixed(2)}%`);
console.log(`F1-Score:                ${f1Score.toFixed(2)}%`);
console.log('----------------------------------------------------------------');
console.log('BREAKDOWN BY QUERY CATEGORY:');
for (const [cat, stats] of Object.entries(categoryStats)) {
    const pct = ((stats.correct / stats.total) * 100).toFixed(1);
    console.log(`  * ${cat.padEnd(18)}: ${stats.correct}/${stats.total} (${pct}%)`);
}
console.log('----------------------------------------------------------------\n');

if (failures.length > 0) {
    console.log('FAILURES ENCOUNTERED:');
    for (const f of failures) {
        console.log(`  [${f.id}] [${f.type}] "${f.query}" -> Expected: ${f.expected}, Got: ${f.actual} (conf: ${f.confidence}, reason: ${f.reason})`);
    }
}

// Ensure accuracy meets production threshold (>= 98%)
assert.ok(accuracy >= 98, `Classifier accuracy must be >= 98%, was ${accuracy}%`);
assert.equal(fp, 0, 'False positive rate must be zero on the benchmark suite');
assert.equal(fn, 0, 'False negative rate must be zero on the benchmark suite');

console.log('=== All 100 Benchmark Queries Classified with 100% Accuracy ===\n');
