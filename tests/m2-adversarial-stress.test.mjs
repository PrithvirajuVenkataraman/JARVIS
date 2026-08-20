import assert from 'node:assert/strict';
import {
    isStableGeographyOrGeneralFactQuery as frontendIsStable,
    classifyUniversalEntityIntent as frontendClassifyEntity,
    decideFrontendRoute,
    isSimpleStableQuestion,
    isCasualConversationQuery
} from '../app/frontend-routing.js';
import {
    isStableGeographyOrGeneralFactQuery as backendIsStable,
    classifyUniversalEntityIntent as backendClassifyEntity,
    classifyQueryIntent
} from '../api/_lib/intent-separator.js';
import {
    classifyUniversalEntityIntent as verifierClassifyEntity,
    extractEntityTarget,
    isTrustedDomain,
    extractHostname,
    classifyTemporalStatus,
    validateEntityResponse
} from '../api/_lib/entity-verifier.js';

console.log('=== Milestone 2 Adversarial Stress Test Harness ===\n');

let totalTests = 0;
let passedTests = 0;

function runTest(description, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(`  [PASS] ${description}`);
    } catch (err) {
        console.error(`  [FAIL] ${description}`);
        console.error(`         ${err.message}`);
        throw err;
    }
}

// =========================================================================
// Category 1: "new" Token Variations
// =========================================================================
console.log('Category 1: Adversarial "new" Token Variations');

// 1.1 Proper Nouns & Geography with "new" -> MUST be Stable
const stableNewGeo = [
    { query: 'Tell me about New South Wales', label: 'New South Wales geography' },
    { query: 'What is the currency of Papua New Guinea?', label: 'Papua New Guinea currency' },
    { query: 'History and impact of the New Deal under FDR', label: 'New Deal history' },
    { query: 'What is the capital of New Caledonia?', label: 'New Caledonia capital' },
    { query: 'Tell me about New Brunswick in Canada', label: 'New Brunswick geography' },
    { query: 'Where is Newfoundland located?', label: 'Newfoundland location' },
    { query: 'Where is New Delhi located on the map?', label: 'New Delhi location' }
];

for (const item of stableNewGeo) {
    runTest(`Stable "new" proper noun: ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), true, 'frontendIsStable should be true');
        assert.equal(backendIsStable(item.query), true, 'backendIsStable should be true');

        const frontendEntity = frontendClassifyEntity(item.query);
        assert.equal(frontendEntity.isLiveRequired, false, 'frontend isLiveRequired should be false');
        assert.equal(frontendEntity.isStableKnowledge, true, 'frontend isStableKnowledge should be true');

        const backendEntity = backendClassifyEntity(item.query);
        assert.equal(backendEntity.isLiveRequired, false, 'backend isLiveRequired should be false');
        assert.equal(backendEntity.isStableKnowledge, true, 'backend isStableKnowledge should be true');

        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'fast_simple', 'route should be fast_simple');
        assert.equal(route.requiresSources, false, 'requiresSources should be false');
    });
}

// 1.2 Programming concepts with "new" -> MUST be Stable
const stableNewCode = [
    { query: 'new array allocation in C++', label: 'C++ new array allocation' },
    { query: 'How does the new operator work in JavaScript?', label: 'JS new operator' },
    { query: 'Explain new Promise constructor in JS', label: 'JS new Promise' },
    { query: 'How to use new keyword in Java object instantiation', label: 'Java new keyword' },
    { query: 'new keyword vs malloc in C++', label: 'new vs malloc in C++' }
];

for (const item of stableNewCode) {
    runTest(`Stable "new" programming: ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), true, 'frontendIsStable should be true');
        assert.equal(backendIsStable(item.query), true, 'backendIsStable should be true');

        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'fast_simple', 'route should be fast_simple');
        assert.equal(route.requiresSources, false, 'requiresSources should be false');

        const intent = classifyQueryIntent(item.query);
        assert.equal(intent.type, 'static_reasoning', 'intent should be static_reasoning');
        assert.equal(intent.requiresLiveGrounding, false, 'requiresLiveGrounding should be false');
    });
}

// 1.3 Freshness / Release / Update with "new" -> MUST be Live
const liveNewFreshness = [
    { query: 'new feature in Python 3.12', label: 'Python 3.12 new feature release' },
    { query: "what's new in React 19", label: "what's new in React 19" },
    { query: 'what are the new updates on the James Webb Telescope?', label: 'new updates query' },
    { query: 'new announcement from RBI today', label: 'new announcement today' }
];

for (const item of liveNewFreshness) {
    runTest(`Live freshness with "new": ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), false, 'frontendIsStable should be false for freshness query');
        assert.equal(backendIsStable(item.query), false, 'backendIsStable should be false for freshness query');

        const route = decideFrontendRoute(item.query);
        assert.ok(route.route === 'live_required' || route.route === 'place_grounded', `route should be live_required, got ${route.route}`);
        assert.equal(route.requiresSources, true, 'requiresSources should be true');
    });
}

// 1.4 Place intent with "new" -> MUST be place_grounded
const liveNewPlace = [
    { query: 'New York pizza places near me', label: 'New York pizza near me' },
    { query: 'hotels in New Delhi near airport', label: 'hotels in New Delhi' },
    { query: 'restaurants near New South Wales parliament', label: 'restaurants near NSW' }
];

for (const item of liveNewPlace) {
    runTest(`Place intent with "new": ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), false, 'frontendIsStable should be false for place navigation');
        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'place_grounded', 'route should be place_grounded');
        assert.equal(route.requiresSources, true, 'requiresSources should be true');
    });
}

// =========================================================================
// Category 2: Monument & Architecture vs Actionable Place Intent
// =========================================================================
console.log('\nCategory 2: Monument & Architecture vs Actionable Place Intent');

// 2.1 Encyclopedic / Architectural knowledge -> MUST be Stable
const encyclopedicMonuments = [
    { query: 'Brihadeeswarar Temple architecture', label: 'Brihadeeswarar Temple architecture' },
    { query: 'Sun Temple Konark history', label: 'Sun Temple Konark history' },
    { query: 'Eiffel tower construction date', label: 'Eiffel tower construction date' },
    { query: 'Why was the Taj Mahal built and what is its architectural style?', label: 'Taj Mahal architecture' },
    { query: 'Colosseum engineering and architectural arches', label: 'Colosseum architecture' },
    { query: 'Pyramids of Giza astronomical alignment and construction', label: 'Pyramids of Giza' },
    { query: 'Geological formation and rock strata of the Grand Canyon', label: 'Grand Canyon geology' },
    { query: 'Who designed Central Park in New York City?', label: 'Central Park design history' }
];

for (const item of encyclopedicMonuments) {
    runTest(`Encyclopedic monument/architecture: ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), true, 'frontendIsStable should be true');
        assert.equal(backendIsStable(item.query), true, 'backendIsStable should be true');

        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'fast_simple', 'route should be fast_simple');
        assert.equal(route.requiresSources, false, 'requiresSources should be false');

        const intent = classifyQueryIntent(item.query);
        assert.equal(intent.type, 'static_reasoning', 'intent should be static_reasoning');
        assert.equal(intent.requiresLiveGrounding, false, 'requiresLiveGrounding should be false');
    });
}

// 2.2 Actionable Place / Travel queries around monuments -> MUST be place_grounded / live_required
const actionableMonuments = [
    { query: 'hotels near Eiffel tower', label: 'hotels near Eiffel tower' },
    { query: 'directions to Brihadeeswarar Temple', label: 'directions to Brihadeeswarar Temple' },
    { query: 'visiting hours and ticket price for Sun Temple Konark', label: 'visiting hours Sun Temple' },
    { query: 'restaurants near Taj Mahal Agra', label: 'restaurants near Taj Mahal' },
    { query: 'how to reach Pyramids of Giza from Cairo airport', label: 'how to reach Pyramids' }
];

for (const item of actionableMonuments) {
    runTest(`Actionable monument travel/place: ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), false, 'frontendIsStable should be false');
        assert.equal(backendIsStable(item.query), false, 'backendIsStable should be false');

        const route = decideFrontendRoute(item.query);
        assert.ok(route.route === 'place_grounded' || route.route === 'live_required', `route should be place_grounded, got ${route.route}`);
        assert.equal(route.requiresSources, true, 'requiresSources should be true');
    });
}

// =========================================================================
// Category 3: Stable Facts Across Diverse Domains
// =========================================================================
console.log('\nCategory 3: Stable Facts Across Diverse Domains');

const stableDomainQueries = [
    // Geography
    { query: 'What is the capital of France?', domain: 'Geography - Capital' },
    { query: 'Where is the Mariana Trench located?', domain: 'Geography - Ocean Trench' },
    { query: 'What is the longest river in South America?', domain: 'Geography - River' },
    { query: 'What is the highest mountain peak in Africa?', domain: 'Geography - Mountain' },
    { query: 'What is the official currency of Japan?', domain: 'Geography - Currency' },

    // Physics formulas & Principles
    { query: 'What is the formula for kinetic energy in classical mechanics?', domain: 'Physics - Kinetic Energy' },
    { query: 'Explain Einstein mass energy equivalence equation E=mc^2', domain: 'Physics - Relativity' },
    { query: 'State Newton second law of motion', domain: 'Physics - Newton Law' },
    { query: 'What is the speed of light in vacuum in meters per second?', domain: 'Physics - Constant' },
    { query: 'What are the laws of thermodynamics?', domain: 'Physics - Thermodynamics' },

    // Calculus derivatives & Mathematics
    { query: 'Compute the derivative of sin(x) * cos(x)', domain: 'Math - Calculus Derivative' },
    { query: 'What is the integral of 1/x dx?', domain: 'Math - Calculus Integral' },
    { query: 'State the Pythagorean theorem and prove it', domain: 'Math - Geometry' },
    { query: 'How to calculate the determinant of a 3x3 matrix?', domain: 'Math - Linear Algebra' },
    { query: '24 * 15 + 100 / 4', domain: 'Math - Arithmetic Expression' },

    // Algorithms & Computer Science
    { query: 'What is the worst case time complexity of quicksort?', domain: 'CS - Quicksort Complexity' },
    { query: 'Explain the binary search algorithm with examples', domain: 'CS - Binary Search' },
    { query: 'How does a hash table resolve hash collisions?', domain: 'CS - Hash Table' },
    { query: 'Explain the difference between TCP and UDP protocols', domain: 'CS - Networking' },
    { query: 'Explain dynamic programming vs memoization', domain: 'CS - Algorithms' },

    // Chemical equations & Biology
    { query: 'What is the chemical equation for photosynthesis?', domain: 'Chemistry/Bio - Photosynthesis' },
    { query: 'What is the chemical formula of water and methane?', domain: 'Chemistry - Formulas' },
    { query: 'Explain the difference between mitosis and meiosis', domain: 'Biology - Cell Division' },
    { query: 'What is the atomic number and electron configuration of Carbon?', domain: 'Chemistry - Periodic Table' },
    { query: 'Who discovered penicillin and in which year?', domain: 'Science History - Penicillin' }
];

for (const item of stableDomainQueries) {
    runTest(`Stable domain fact: [${item.domain}] "${item.query}"`, () => {
        assert.equal(frontendIsStable(item.query), true, 'frontendIsStable should be true');
        assert.equal(backendIsStable(item.query), true, 'backendIsStable should be true');

        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'fast_simple', 'route should be fast_simple');
        assert.equal(route.requiresSources, false, 'requiresSources should be false');

        const intent = classifyQueryIntent(item.query);
        assert.equal(intent.type, 'static_reasoning', 'intent should be static_reasoning');
        assert.equal(intent.requiresLiveGrounding, false, 'requiresLiveGrounding should be false');

        const entity = frontendClassifyEntity(item.query);
        assert.equal(entity.isLiveRequired, false, 'isLiveRequired should be false');
        assert.equal(entity.isStableKnowledge, true, 'isStableKnowledge should be true');
    });
}

// =========================================================================
// Category 4: Time-Sensitive Mutable Facts
// =========================================================================
console.log('\nCategory 4: Time-Sensitive Mutable Facts');

const mutableQueries = [
    {
        query: 'Who is the current Prime Minister of UK?',
        domain: 'Political Leader - UK PM',
        expectedRole: 'Prime Minister',
        expectedJurisdiction: 'Uk',
        category: 'political_leadership'
    },
    {
        query: 'Who is the Chief Minister of Maharashtra?',
        domain: 'Political Leader - Maharashtra CM',
        expectedRole: 'Chief Minister',
        expectedJurisdiction: 'Maharashtra',
        category: 'political_leadership'
    },
    {
        query: 'Who is the current President of France?',
        domain: 'Political Leader - France President',
        expectedRole: 'President',
        expectedJurisdiction: 'France',
        category: 'political_leadership'
    },
    {
        query: 'Who is the CM of Tamil Nadu',
        domain: 'Political Leader - Tamil Nadu CM',
        expectedRole: 'Chief Minister',
        expectedJurisdiction: 'Tamil Nadu',
        category: 'political_leadership'
    },
    {
        query: 'price of Ethereum today',
        domain: 'Finance - Crypto',
        category: 'finance_crypto'
    },
    {
        query: 'What is the price of Bitcoin right now?',
        domain: 'Finance - Bitcoin',
        category: 'finance_crypto'
    },
    {
        query: 'Tesla stock price today',
        domain: 'Finance - Stock',
        category: 'finance_crypto'
    },
    {
        query: 'weather in London tomorrow',
        domain: 'Weather - London',
        category: 'weather'
    },
    {
        query: 'What is the temperature in Tokyo right now?',
        domain: 'Weather - Tokyo',
        category: 'weather'
    },
    {
        query: 'IPL live score today',
        domain: 'Live Sports - IPL',
        category: 'breaking_live'
    }
];

for (const item of mutableQueries) {
    runTest(`Mutable time-sensitive query: [${item.domain}] "${item.query}"`, () => {
        assert.equal(frontendIsStable(item.query), false, 'frontendIsStable must be false');
        assert.equal(backendIsStable(item.query), false, 'backendIsStable must be false');

        const frontendEntity = frontendClassifyEntity(item.query);
        assert.equal(frontendEntity.isLiveRequired, true, 'frontend isLiveRequired must be true');
        assert.equal(frontendEntity.isStableKnowledge, false, 'frontend isStableKnowledge must be false');

        const backendEntity = backendClassifyEntity(item.query);
        assert.equal(backendEntity.isLiveRequired, true, 'backend isLiveRequired must be true');
        assert.equal(backendEntity.isStableKnowledge, false, 'backend isStableKnowledge must be false');

        if (item.expectedRole) {
            const extracted = extractEntityTarget(item.query);
            assert.ok(extracted, `extractEntityTarget should find target for "${item.query}"`);
            assert.equal(extracted.role, item.expectedRole, `role should match ${item.expectedRole}`);
            assert.equal(extracted.jurisdiction.toLowerCase(), item.expectedJurisdiction.toLowerCase(), `jurisdiction should match ${item.expectedJurisdiction}`);
        }

        const route = decideFrontendRoute(item.query);
        assert.ok(route.route === 'live_required' || route.route === 'place_grounded', `route should be live_required, got ${route.route}`);
        assert.equal(route.requiresSources, true, 'requiresSources must be true');
    });
}

// =========================================================================
// Category 5: Historical Leaders & Past Figures vs Live Officeholders
// =========================================================================
console.log('\nCategory 5: Historical Leaders vs Live Officeholders');

const historicalLeaderQueries = [
    { query: 'Who was the first President of the United States?', label: 'First US President' },
    { query: 'Who was the first Prime Minister of India?', label: 'First India PM' },
    { query: 'Who was the President of the USA in 1865 during the Civil War?', label: 'US President 1865' },
    { query: 'History of the Mughal emperors in India', label: 'Mughal emperors history' },
    { query: 'Who was the former Prime Minister of UK during World War II?', label: 'WWII UK PM' }
];

for (const item of historicalLeaderQueries) {
    runTest(`Historical leader (must NOT be treated as live): ${item.label} ("${item.query}")`, () => {
        assert.equal(frontendIsStable(item.query), true, 'frontendIsStable should be true for historical figures');
        assert.equal(backendIsStable(item.query), true, 'backendIsStable should be true for historical figures');

        const frontendEntity = frontendClassifyEntity(item.query);
        assert.equal(frontendEntity.isLiveRequired, false, 'frontend isLiveRequired should be false');
        assert.equal(frontendEntity.isStableKnowledge, true, 'frontend isStableKnowledge should be true');

        const route = decideFrontendRoute(item.query);
        assert.equal(route.route, 'fast_simple', 'route should be fast_simple');
        assert.equal(route.requiresSources, false, 'requiresSources should be false');
    });
}

// =========================================================================
// Category 6: Boundary, Edge Cases, Punctuation & Long Input
// =========================================================================
console.log('\nCategory 6: Boundary, Edge Cases, Punctuation & Long Input');

runTest('Empty string and whitespace query handling', () => {
    assert.equal(frontendIsStable(''), false);
    assert.equal(frontendIsStable('   '), false);
    assert.equal(backendIsStable(''), false);
    assert.equal(backendIsStable('   '), false);

    const emptyRoute = decideFrontendRoute('');
    assert.equal(emptyRoute.route, 'clarify');
});

runTest('Punctuation resilience and case insensitivity', () => {
    const q1 = '  wHaT Is ThE CaPiTaL oF NeW zEaLaNd????!?!  ';
    assert.equal(frontendIsStable(q1), true);
    assert.equal(backendIsStable(q1), true);
    assert.equal(decideFrontendRoute(q1).route, 'fast_simple');

    const q2 = '   WHO IS THE CHIEF MINISTER OF KARNATAKA???   ';
    assert.equal(frontendIsStable(q2), false);
    assert.equal(backendIsStable(q2), false);
    assert.equal(decideFrontendRoute(q2).route, 'live_required');
});

runTest('Long compound query routing', () => {
    const longStable = 'Can you please provide a thorough and detailed explanation of how the photosynthesis light-dependent reaction produces ATP and NADPH in the chloroplast thylakoid membrane?';
    assert.equal(frontendIsStable(longStable), true);
    assert.equal(backendIsStable(longStable), true);
});

// =========================================================================
// Category 7: Entity Verifier Domain Namespace & Assertion Validation
// =========================================================================
console.log('\nCategory 7: Entity Verifier Domain Namespace & Assertion Validation');

runTest('Trusted domain verification helper', () => {
    assert.equal(isTrustedDomain('wikipedia.org'), true);
    assert.equal(isTrustedDomain('en.wikipedia.org'), true);
    assert.equal(isTrustedDomain('reuters.com'), true);
    assert.equal(isTrustedDomain('bbc.com'), true);
    assert.equal(isTrustedDomain('india.gov.in'), true);
    assert.equal(isTrustedDomain('whitehouse.gov'), true);
    assert.equal(isTrustedDomain('harvard.edu'), true);
    assert.equal(isTrustedDomain('random-blog.xyz'), false);
});

runTest('Extract hostname helper', () => {
    assert.equal(extractHostname('https://en.wikipedia.org/wiki/India'), 'en.wikipedia.org');
    assert.equal(extractHostname('http://www.bbc.com/news'), 'bbc.com');
    assert.equal(extractHostname('reuters.com'), 'reuters.com');
});

runTest('Temporal status classification from snippets', () => {
    const incumbentSnippets = [
        { title: 'Leader assumed office in 2021 and is the incumbent Chief Minister.', description: 'Took oath as chief minister.' }
    ];
    const incumbentResult = classifyTemporalStatus('Leader', 'Chief Minister', incumbentSnippets, 2026);
    assert.equal(incumbentResult.status, 'incumbent');
    assert.ok(incumbentResult.confidence > 0.6);

    const formerSnippets = [
        { title: 'Former official stepped down in 2019 after election loss.', description: 'Served from 2014 until 2019.' }
    ];
    const formerResult = classifyTemporalStatus('Official', 'Chief Minister', formerSnippets, 2026);
    assert.equal(formerResult.status, 'former');
});

// =========================================================================
// Summary
// =========================================================================
console.log('\n=============================================================');
console.log(`Adversarial Stress Test Suite Complete: ${passedTests} / ${totalTests} passed (100%)`);
console.log('=============================================================\n');
