import assert from 'node:assert/strict';
import {
    isStableGeographyOrGeneralFactQuery as frontendIsStable,
    classifyUniversalEntityIntent as frontendClassifyEntity,
    decideFrontendRoute,
    isSimpleStableQuestion
} from '../app/frontend-routing.js';
import {
    isStableGeographyOrGeneralFactQuery as backendIsStable,
    classifyUniversalEntityIntent as backendClassifyEntity,
    classifyQueryIntent
} from '../api/_lib/intent-separator.js';
import {
    isStableGeographyOrGeneralFactQuery as verifierIsStable,
    classifyUniversalEntityIntent as verifierClassifyEntity,
    extractEntityTarget
} from '../api/_lib/entity-verifier.js';

console.log('================================================================');
console.log(' empirical verification suite: Milestone 2 (Challenger 1)');
console.log('================================================================');

const findings = {
    passed: 0,
    failed: 0,
    failures: []
};

function recordTest(testName, fn) {
    try {
        fn();
        findings.passed++;
    } catch (err) {
        findings.failed++;
        findings.failures.push({
            test: testName,
            error: err.message,
            stack: err.stack
        });
        console.error(`  ❌ FAIL: ${testName} -> ${err.message}`);
    }
}

// -----------------------------------------------------------------------------
// Suite 1: Boundary & Token Collision Stress Tests ("new" token)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 1: Boundary & "new" Token Collision Stress Tests ---');

const newBoundaryStableQueries = [
    { q: 'What is the capital of New York?', domain: 'US Geography' },
    { q: 'What is the capital of New Zealand?', domain: 'World Geography' },
    { q: 'What is the capital of New Mexico?', domain: 'US Geography' },
    { q: 'What is the capital of New Hampshire?', domain: 'US Geography' },
    { q: 'What is the capital of New Jersey?', domain: 'US Geography' },
    { q: 'What is the currency of Papua New Guinea?', domain: 'Geography/Currency' },
    { q: 'Where is New Delhi located?', domain: 'Geography' },
    { q: 'Where is New Orleans located?', domain: 'Geography' },
    { q: 'Explain the New Deal policies of Franklin D. Roosevelt', domain: 'History' },
    { q: 'What was the New Kingdom period in ancient Egypt?', domain: 'History' },
    { q: 'Explain Newton\'s second law of motion', domain: 'Physics' },
    { q: 'How does the new operator work in C++?', domain: 'Programming' },
    { q: 'How to instantiate a new object in JavaScript with new keyword?', domain: 'Programming' },
    { q: 'How to allocate a new array dynamically in C++?', domain: 'Programming' },
    { q: 'How to create a new dictionary in Python?', domain: 'Programming' },
    { q: 'What is the function of new Promise in JavaScript?', domain: 'Programming' },
    { q: 'Explain new Map and new Set in ES6', domain: 'Programming' },
    { q: 'Difference between malloc and new in C++', domain: 'Programming' },
    { q: 'Explain New Classical economics theory', domain: 'Economics' }
];

for (const { q, domain } of newBoundaryStableQueries) {
    recordTest(`[Stable "new"] ${domain}: "${q}"`, () => {
        // Frontend stable
        const fStable = frontendIsStable(q);
        assert.equal(fStable, true, `Frontend isStable must be true for "${q}"`);
        
        // Backend stable
        const bStable = backendIsStable(q);
        assert.equal(bStable, true, `Backend isStable must be true for "${q}"`);

        // Verifier stable
        const vStable = verifierIsStable(q);
        assert.equal(vStable, true, `Verifier isStable must be true for "${q}"`);

        // Frontend route
        const fRoute = decideFrontendRoute(q);
        assert.equal(fRoute.route, 'fast_simple', `Expected fast_simple route for "${q}", got ${fRoute.route}`);
        assert.equal(fRoute.requiresSources, false, `requiresSources must be false for "${q}"`);

        // Backend intent
        const bIntent = classifyQueryIntent(q);
        assert.equal(bIntent.type, 'static_reasoning', `Expected static_reasoning for "${q}", got ${bIntent.type}`);
        assert.equal(bIntent.requiresLiveGrounding, false, `requiresLiveGrounding must be false for "${q}"`);

        // Entity intent
        const fEnt = frontendClassifyEntity(q);
        assert.equal(fEnt.isLiveRequired, false, `isLiveRequired must be false for "${q}"`);
        assert.equal(fEnt.isStableKnowledge, true, `isStableKnowledge must be true for "${q}"`);
    });
}

const newBoundaryLiveQueries = [
    { q: "What's new in React 19?", domain: 'Tech freshness' },
    { q: 'New updates on earthquake in Japan today', domain: 'Breaking news' },
    { q: 'What are the new features in Python 3.13?', domain: 'Tech freshness' },
    { q: 'New announcement from Federal Reserve today', domain: 'Financial news' },
    { q: 'What is the new price of Bitcoin today?', domain: 'Finance' },
    { q: 'New release notes for Ubuntu 24.04 LTS', domain: 'Tech freshness' },
    { q: 'Latest new developments in Ukraine war', domain: 'News' }
];

for (const { q, domain } of newBoundaryLiveQueries) {
    recordTest(`[Live "new"] ${domain}: "${q}"`, () => {
        const fStable = frontendIsStable(q);
        assert.equal(fStable, false, `Frontend isStable must be FALSE for live query "${q}"`);

        const bStable = backendIsStable(q);
        assert.equal(bStable, false, `Backend isStable must be FALSE for live query "${q}"`);

        const fRoute = decideFrontendRoute(q);
        assert.ok(fRoute.route === 'live_required' || fRoute.requiresSources === true, `Expected live_required or requiresSources for "${q}"`);

        const bEntity = backendClassifyEntity(q);
        assert.equal(bEntity.isLiveRequired, true, `Expected isLiveRequired true for "${q}"`);
        assert.equal(bEntity.isStableKnowledge, false, `Expected isStableKnowledge false for "${q}"`);
    });
}

// -----------------------------------------------------------------------------
// Suite 2: Stable Encyclopedic Knowledge (Geography, Science, Math, CS, History)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 2: Stable Knowledge Across Domains (100+ queries) ---');

const stableGeographyQueries = [
    'What is the capital of France?',
    'What is the capital of Australia?',
    'What is the capital of Canada?',
    'What is the capital of Brazil?',
    'What is the capital of South Africa?',
    'What is the capital of Mongolia?',
    'What is the capital of Argentina?',
    'What is the capital of Norway?',
    'What is the capital of Egypt?',
    'What is the capital of Thailand?',
    'What is the longest river in South America?',
    'What is the highest mountain in North America?',
    'What is the deepest trench in the world ocean?',
    'What is the largest desert in the world?',
    'What is the official language of Austria?',
    'What is the currency of Switzerland?',
    'Where is the Sahara Desert located?',
    'Where is Mount Kilimanjaro located?',
    'Where is the Amazon Rainforest located?',
    'What are the tectonic plates of the Earth?',
    'What is the Tropic of Capricorn and its latitude?',
    'What is the difference between latitude and longitude?',
    'What is the archipelago of Indonesia?'
];

for (const q of stableGeographyQueries) {
    recordTest(`[Geography] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

const stableScienceQueries = [
    'Explain how photosynthesis works in green plants',
    'What is the structure of DNA and RNA molecules?',
    'Explain the process of mitosis and meiosis in cells',
    'What is the function of mitochondria in eukaryotic cells?',
    'What is the theory of general relativity by Einstein?',
    'What is the second law of thermodynamics and entropy?',
    'What is quantum entanglement and superposition?',
    'What is the speed of light in vacuum?',
    'How do black holes form from collapsing stars?',
    'What is a supernova explosion and neutron star?',
    'What is the periodic table atomic number of gold?',
    'Explain oxidation and reduction chemical reactions',
    'Who discovered penicillin and when was it found?',
    'Who discovered the structure of DNA?',
    'What is the law of universal gravitation by Isaac Newton?',
    'How does CRISPR gene editing work?',
    'What is dark matter and dark energy in cosmology?',
    'How does the Doppler effect work for sound waves and light?'
];

for (const q of stableScienceQueries) {
    recordTest(`[Science] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

const stableMathQueries = [
    'What is the Pythagorean theorem formula?',
    'Calculate the derivative of f(x) = x^4 - 3x^2 + 7',
    'Evaluate the integral of cos(x) dx',
    'How to calculate the determinant of a 3x3 matrix?',
    'What are eigenvalues and eigenvectors in linear algebra?',
    'Explain Bayes theorem formula and probability',
    'What is the difference between permutation and combination?',
    'What is the Fibonacci sequence formula?',
    'What is a prime number and the sieve of Eratosthenes?',
    'Solve for x: 2x + 10 = 30',
    'Calculate 25 * 4 + 100 / 5',
    'What is Euler\'s formula e^(i*pi) + 1 = 0?'
];

for (const q of stableMathQueries) {
    recordTest(`[Math] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

const stableCodingQueries = [
    'Explain the quicksort algorithm and its worst-case time complexity',
    'How does binary search work on a sorted array?',
    'Explain Dijkstra\'s shortest path algorithm',
    'What is dynamic programming and memoization?',
    'What is the difference between a stack and a queue data structure?',
    'Explain object-oriented programming encapsulation and polymorphism',
    'How do closures work in JavaScript?',
    'What is the difference between TCP and UDP protocols?',
    'How does garbage collection work in V8 engine?',
    'Explain the concept of virtual DOM in frontend frameworks',
    'What is a REST API and HTTP methods GET, POST, PUT, DELETE?',
    'Explain pointer arithmetic in C and C++',
    'What is a hash table and how does collision resolution work?'
];

for (const q of stableCodingQueries) {
    recordTest(`[Coding] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

const stableHistoryAndSocialQueries = [
    'What caused the fall of the Roman Empire?',
    'Explain the French Revolution of 1789 and its causes',
    'What was the Treaty of Versailles and its impact?',
    'Describe the Indus Valley Civilization cities Harappa and Mohenjo-daro',
    'Who was the first president of the United States?',
    'Explain the historical significance of the Renaissance era',
    'What were the major alliances during World War I?',
    'Explain the concept of utilitarianism in moral philosophy',
    'What is epistemology in philosophical inquiry?',
    'Explain supply and demand equilibrium in microeconomics',
    'What is inflation and how does monetary policy control it?',
    'Explain Gross Domestic Product (GDP) definition and calculation'
];

for (const q of stableHistoryAndSocialQueries) {
    recordTest(`[History/Social] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

const stableLandmarkArchitectureQueries = [
    'Why was Brihadeeswarar Temple constructed in Thanjavur?',
    'Explain the architecture and stone carvings of Sun Temple Konark',
    'Who built the Taj Mahal and what is its architectural style?',
    'Explain the structural engineering of the Eiffel Tower',
    'How was the Colosseum in Rome constructed?',
    'How were the Pyramids of Giza aligned and built?',
    'What is the history and design of Angkor Wat in Cambodia?',
    'Explain the geological erosion that formed the Grand Canyon',
    'How was Yosemite Valley formed by glacial activity?',
    'Explain the geological formation of Niagara Falls'
];

for (const q of stableLandmarkArchitectureQueries) {
    recordTest(`[Landmark/Architecture] "${q}"`, () => {
        assert.equal(frontendIsStable(q), true, `Frontend isStable failed for "${q}"`);
        assert.equal(backendIsStable(q), true, `Backend isStable failed for "${q}"`);
        const route = decideFrontendRoute(q);
        assert.equal(route.route, 'fast_simple', `decideFrontendRoute failed for "${q}"`);
        assert.equal(route.requiresSources, false);
    });
}

// -----------------------------------------------------------------------------
// Suite 3: Live Queries (Weather, Crypto, Sports, News, Officeholders, Places)
// -----------------------------------------------------------------------------
console.log('\n--- Suite 3: Live Time-Sensitive Queries ---');

const liveQueriesToTest = [
    { q: 'Who is the Chief Minister of Karnataka?', type: 'political', role: 'Chief Minister', jur: 'Karnataka' },
    { q: 'Who is the Prime Minister of UK?', type: 'political', role: 'Prime Minister', jur: 'Uk' },
    { q: 'Who is the President of France?', type: 'political', role: 'President', jur: 'France' },
    { q: 'Who is the Governor of California?', type: 'political', role: 'Governor', jur: 'California' },
    { q: 'Who is the Mayor of London?', type: 'political', role: 'Mayor', jur: 'London' },
    { q: 'Who is the current CEO of Microsoft?', type: 'political', role: 'CEO', jur: 'Microsoft' },
    { q: 'Who is the current CM of Tamil Nadu?', type: 'political', role: 'Chief Minister', jur: 'Tamil Nadu' },
    { q: 'What is the weather in Paris today?', type: 'weather' },
    { q: 'What is the temperature in New York right now?', type: 'weather' },
    { q: 'Weather forecast for London tomorrow', type: 'weather' },
    { q: 'What is the price of Bitcoin today?', type: 'finance' },
    { q: 'Ethereum stock price and market cap now', type: 'finance' },
    { q: 'Tesla stock price today', type: 'finance' },
    { q: 'Live score of football match today', type: 'sports' },
    { q: 'IPL match schedule and live score today', type: 'sports' },
    { q: 'Breaking news on volcanic eruption today', type: 'news' },
    { q: 'Election results today live updates', type: 'news' },
    { q: 'Search the web for latest quantum computing breakthrough with sources', type: 'explicit' }
];

for (const item of liveQueriesToTest) {
    recordTest(`[Live] ${item.type}: "${item.q}"`, () => {
        assert.equal(frontendIsStable(item.q), false, `Frontend isStable must be FALSE for live query "${item.q}"`);
        assert.equal(backendIsStable(item.q), false, `Backend isStable must be FALSE for live query "${item.q}"`);
        assert.equal(verifierIsStable(item.q), false, `Verifier isStable must be FALSE for live query "${item.q}"`);

        const entityRes = backendClassifyEntity(item.q);
        assert.equal(entityRes.isLiveRequired, true, `isLiveRequired must be true for "${item.q}"`);
        assert.equal(entityRes.isStableKnowledge, false, `isStableKnowledge must be false for "${item.q}"`);

        if (item.role) {
            assert.equal(entityRes.entityTarget?.role, item.role, `Expected role ${item.role} for "${item.q}"`);
        }

        const route = decideFrontendRoute(item.q);
        assert.ok(route.route === 'live_required' || route.route === 'place_grounded' || route.requiresSources === true, `Route must require sources for "${item.q}", got ${route.route}`);
    });
}

// -----------------------------------------------------------------------------
// Suite 4: Actionable Place & Travel Navigation vs Stable Landmark Facts
// -----------------------------------------------------------------------------
console.log('\n--- Suite 4: Place Navigation vs Encyclopedic Landmark Knowledge ---');

const actionablePlaceQueries = [
    { q: 'museum near me', reason: 'nearby search' },
    { q: 'best restaurants open now in Paris', reason: 'open now + restaurant' },
    { q: 'hotels near Central Park', reason: 'hotel near landmark' },
    { q: 'hotels near Taj Mahal', reason: 'hotel near landmark' },
    { q: 'directions to Eiffel Tower', reason: 'directions navigation' },
    { q: 'directions to Sun Temple', reason: 'directions navigation' },
    { q: 'visiting hours and ticket price of Louvre Museum', reason: 'visiting hours/tickets' },
    { q: 'places to visit in Mysore during summer', reason: 'travel recommendations' },
    { q: 'things to do in Tokyo this weekend', reason: 'travel/events' }
];

for (const { q, reason } of actionablePlaceQueries) {
    recordTest(`[Actionable Place] (${reason}) "${q}"`, () => {
        // Place navigation queries must NOT be marked as stable general facts
        const fStable = frontendIsStable(q);
        assert.equal(fStable, false, `Frontend isStable must be FALSE for navigation query "${q}"`);

        const bStable = backendIsStable(q);
        assert.equal(bStable, false, `Backend isStable must be FALSE for navigation query "${q}"`);

        const route = decideFrontendRoute(q);
        assert.ok(route.route === 'place_grounded' || route.route === 'live_required', `Route must be place_grounded or live_required for "${q}", got ${route.route}`);
        assert.equal(route.requiresSources, true, `requiresSources must be true for "${q}"`);
    });
}

// -----------------------------------------------------------------------------
// Summary of Results
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log(` EMPIRICAL TEST HARNESS SUMMARY`);
console.log(` Total Tests Run: ${findings.passed + findings.failed}`);
console.log(` Passed: ${findings.passed}`);
console.log(` Failed: ${findings.failed}`);
console.log('================================================================');

if (findings.failed > 0) {
    console.log('\nDETAILED FAILURE BREAKDOWN:');
    findings.failures.forEach((f, idx) => {
        console.log(`\n[${idx + 1}] ${f.test}`);
        console.log(`    Error: ${f.error}`);
    });
}
