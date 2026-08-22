import assert from 'node:assert/strict';
import { classifyQueryIntent } from '../api/_lib/intent-separator.js';
import { resolveInstantFact } from '../api/_lib/instant-fact-layer.js';

console.log('--- Testing Smart Intent Separator & Knowledge Domains ---');

// 1. General Knowledge & Academic Domains (Must ALL be static_reasoning / Pre-trained First)
const domains = [
    { query: 'Why did the Roman Empire fall?', domain: 'History' },
    { query: 'What were the main causes of the French Revolution?', domain: 'History' },
    { query: 'Explain how photosynthesis works in C4 plants', domain: 'Biology / Science' },
    { query: 'What is the theory of general relativity and spacetime curvature?', domain: 'Physics / Science' },
    { query: 'How do neutron stars and black holes form after a supernova?', domain: 'Space / Astronomy' },
    { query: 'Explain the mechanism of self-attention in Transformer models', domain: 'AI / Tech' },
    { query: 'How does backpropagation with gradient descent optimize weights?', domain: 'AI / Machine Learning' },
    { query: 'What is the difference between TCP and UDP protocols?', domain: 'Computer Science' },
    { query: 'Implement a Red-Black Tree in C++', domain: 'Computer Science / Coding' },
    { query: 'Explain the concept of utilitarianism in moral philosophy', domain: 'Philosophy / Ethics' },
    { query: 'How does monetary policy impact macroeconomic inflation and GDP?', domain: 'Economics / Social Science' },
    { query: 'What are the constitutional differences between parliamentary and presidential systems?', domain: 'Political Theory' }
];

for (const { query, domain } of domains) {
    const result = classifyQueryIntent(query);
    assert.equal(result.type, 'static_reasoning', `Expected ${domain} query "${query}" to be static_reasoning`);
    assert.equal(result.requiresLiveGrounding, false, `Expected ${domain} query "${query}" to require NO live grounding`);
}

// 1b. Stable Geography, Proper Nouns with 'new', Architecture & Monuments
const stableFacts = [
    'What is the capital of New York?',
    'What is the capital of New Zealand?',
    'What is the currency of Papua New Guinea?',
    'Why was Brihadeeswarar Temple constructed?',
    'Sun Temple architecture and history',
    'Explain the geological formation of Yosemite National Park',
    'Who designed Central Park in New York?',
    'Explain the New Deal policies of FDR',
    'How does the new keyword work in C++?',
    'Create a new array in Python'
];

for (const query of stableFacts) {
    const result = classifyQueryIntent(query);
    assert.equal(result.type, 'static_reasoning', `Expected "${query}" to be static_reasoning`);
    assert.equal(result.requiresLiveGrounding, false, `Expected "${query}" to require NO live grounding`);
}

// 2. Coding & Math
const codeRes = classifyQueryIntent('Write a python function for quicksort');
assert.equal(codeRes.type, 'static_reasoning');
assert.equal(codeRes.category, 'coding');

const mathRes = classifyQueryIntent('Compute the integral of e^(2x) dx');
assert.equal(mathRes.type, 'static_reasoning');
assert.equal(mathRes.category, 'mathematics');

// 3. Temporal / Political Leadership Facts (Requires Instant Grounding)
const cmRes = classifyQueryIntent('Who is the cm of karnataka');
assert.equal(cmRes.type, 'temporal_fact');
assert.equal(cmRes.requiresLiveGrounding, true);
assert.equal(cmRes.entityTarget?.role, 'Chief Minister');
assert.equal(cmRes.entityTarget?.jurisdiction, 'Karnataka');

const pmRes = classifyQueryIntent('Who is the current Prime Minister of United Kingdom?');
assert.equal(pmRes.type, 'temporal_fact');
assert.equal(pmRes.requiresLiveGrounding, true);

// 4. Domain Specific (Weather & Crypto)
const weatherRes = classifyQueryIntent('What is the weather in Tokyo today?');
assert.equal(weatherRes.type, 'domain_specific');
assert.equal(weatherRes.category, 'weather');

const cryptoRes = classifyQueryIntent('What is the price of Bitcoin?');
assert.equal(cryptoRes.type, 'domain_specific');
assert.equal(cryptoRes.category, 'finance_crypto');

// 5. Explicit Search
const searchRes = classifyQueryIntent('Search the web for recent James Webb telescope discoveries');
assert.equal(searchRes.type, 'explicit_search');
assert.equal(searchRes.requiresLiveGrounding, true);

// 6. Instant Fact Layer Resolution
console.log('--- Testing Instant Fact Layer Resolution ---');
const resolvedFact = await resolveInstantFact('Who is the cm of karnataka', cmRes);
assert.ok(resolvedFact.grounded === true || resolvedFact.grounded === false);
if (resolvedFact.grounded) {
    assert.ok(resolvedFact.facts.length > 0);
    assert.ok(resolvedFact.ragText.length > 0);
    assert.ok(resolvedFact.directAnswerDirective.length > 0);
}

console.log('intent-separator-tests-ok');
