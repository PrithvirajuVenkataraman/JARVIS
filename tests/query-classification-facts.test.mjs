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
    classifyUniversalEntityIntent as verifierClassifyEntity,
    extractEntityTarget
} from '../api/_lib/entity-verifier.js';

console.log('--- Testing Query Classification & Entity Fact Grounding (Milestone 2) ---');

// =========================================================================
// 1. Keyword Collision Tests: Proper Nouns, Geography, Freshness & Code with "new"
// =========================================================================
console.log('1. Testing "new" token collision handling in geography, history, and code...');

const newCollisionQueries = [
    { query: 'Tell me about New South Wales', domain: 'Geography - New South Wales' },
    { query: 'What is the capital of New York?', domain: 'US State Capital' },
    { query: 'What is the capital of New Zealand?', domain: 'Country Capital' },
    { query: 'What is the currency of Papua New Guinea?', domain: 'National Currency - Papua New Guinea' },
    { query: 'Tell me about the capital of New Mexico', domain: 'Geography' },
    { query: 'What is the capital of New Hampshire?', domain: 'Geography' },
    { query: 'What is the capital of New Jersey?', domain: 'Geography' },
    { query: 'Where is New Delhi located?', domain: 'Geography' },
    { query: 'Explain the New Deal economic policies of FDR', domain: 'History - New Deal' },
    { query: 'What was the New Kingdom of Egypt?', domain: 'History' },
    { query: 'How does the new keyword work in C++?', domain: 'Programming' },
    { query: 'new array allocation in C++', domain: 'Programming - new array allocation' },
    { query: 'How does the new keyword work in JavaScript?', domain: 'Programming' },
    { query: 'How to create a new array in Python?', domain: 'Programming' },
    { query: 'Explain new operator overloading in C++', domain: 'Programming' }
];

for (const { query, domain } of newCollisionQueries) {
    // Frontend routing check
    const frontendStable = frontendIsStable(query);
    assert.equal(frontendStable, true, `Expected frontend isStableGeographyOrGeneralFactQuery to be true for [${domain}] "${query}"`);

    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'fast_simple', `Expected decideFrontendRoute to be 'fast_simple' for [${domain}] "${query}", got ${route.route}`);
    assert.equal(route.requiresSources, false, `Expected requiresSources to be false for [${domain}] "${query}"`);

    // Backend intent classification check
    const backendStable = backendIsStable(query);
    assert.equal(backendStable, true, `Expected backend isStableGeographyOrGeneralFactQuery to be true for [${domain}] "${query}"`);

    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning', `Expected classifyQueryIntent to be 'static_reasoning' for [${domain}] "${query}"`);
    assert.equal(intent.requiresLiveGrounding, false, `Expected requiresLiveGrounding to be false for [${domain}] "${query}"`);

    // Entity intent classifier check
    const entityClassification = frontendClassifyEntity(query);
    assert.equal(entityClassification.isLiveRequired, false, `Expected isLiveRequired to be false for [${domain}] "${query}"`);
    assert.equal(entityClassification.isStableKnowledge, true, `Expected isStableKnowledge to be true for [${domain}] "${query}"`);
}

// Freshness queries with "new" -> MUST be live_required
const freshnessNewQueries = [
    { query: 'new feature in Python 3.12', domain: 'Freshness - Python 3.12 new feature' },
    { query: "what's new in React 19", domain: 'Freshness - what is new in React 19' }
];

for (const { query, domain } of freshnessNewQueries) {
    assert.equal(frontendIsStable(query), false, `Expected frontend isStable to be FALSE for [${domain}] "${query}"`);
    assert.equal(backendIsStable(query), false, `Expected backend isStable to be FALSE for [${domain}] "${query}"`);
    const route = decideFrontendRoute(query);
    assert.ok(route.route === 'live_required' || route.route === 'place_grounded', `Expected live_required for [${domain}] "${query}"`);
    assert.equal(route.requiresSources, true);
}

// Place queries with "new" -> MUST be place_grounded
const placeNewQueries = [
    { query: 'New York pizza places near me', domain: 'Place intent - New York pizza near me' }
];

for (const { query, domain } of placeNewQueries) {
    assert.equal(frontendIsStable(query), false, `Expected frontend isStable to be FALSE for [${domain}] "${query}"`);
    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'place_grounded', `Expected place_grounded for [${domain}] "${query}"`);
    assert.equal(route.requiresSources, true);
}
console.log('  [PASS] Proper nouns and code containing "new" correctly classify as stable facts without web retrieval.');

// =========================================================================
// 2. Architectural, Historical & Encyclopedic Geography Tests
// =========================================================================
console.log('2. Testing architectural, historical, and encyclopedic geography classification...');

const landmarkQueries = [
    { query: 'Brihadeeswarar Temple architecture', domain: 'Monument Architecture - Brihadeeswarar Temple' },
    { query: 'Sun Temple Konark history', domain: 'Monument History - Sun Temple Konark' },
    { query: 'Eiffel tower construction date', domain: 'Monument Date - Eiffel tower' },
    { query: 'Why was Brihadeeswarar Temple constructed?', domain: 'Temple History' },
    { query: 'Sun Temple architecture and sculptural style', domain: 'Monument Architecture' },
    { query: 'Explain the geological formation of Yosemite National Park', domain: 'Geology' },
    { query: 'Who designed Central Park in New York?', domain: 'Landscape Architecture' },
    { query: 'Who built the Taj Mahal and why?', domain: 'Monument History' },
    { query: 'Explain the engineering and architecture of the Eiffel Tower', domain: 'Monument Architecture' },
    { query: 'How were the Pyramids of Giza built?', domain: 'Ancient History' },
    { query: 'History and architectural significance of Angkor Wat', domain: 'Monument History' },
    { query: 'How was the Grand Canyon formed by erosion?', domain: 'Geology' },
    { query: 'What is the height and geological composition of Mount Everest?', domain: 'Geography' },
    { query: 'Explain the formation of Niagara Falls', domain: 'Geology' }
];

for (const { query, domain } of landmarkQueries) {
    const frontendStable = frontendIsStable(query);
    assert.equal(frontendStable, true, `Expected frontend isStableGeographyOrGeneralFactQuery to be true for [${domain}] "${query}"`);

    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'fast_simple', `Expected decideFrontendRoute to be 'fast_simple' for [${domain}] "${query}", got ${route.route}`);
    assert.equal(route.requiresSources, false, `Expected requiresSources to be false for [${domain}] "${query}"`);

    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning', `Expected static_reasoning for [${domain}] "${query}"`);
    assert.equal(intent.requiresLiveGrounding, false, `Expected no live grounding for [${domain}] "${query}"`);
}

// Actionable place queries on monuments -> MUST be place_grounded
const actionableMonumentQueries = [
    { query: 'hotels near Eiffel tower', domain: 'Place intent - hotels near Eiffel tower' }
];

for (const { query, domain } of actionableMonumentQueries) {
    assert.equal(frontendIsStable(query), false, `Expected frontend isStable to be FALSE for [${domain}] "${query}"`);
    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'place_grounded', `Expected place_grounded for [${domain}] "${query}"`);
    assert.equal(route.requiresSources, true);
}
console.log('  [PASS] Monuments, architecture, and geological formations route as stable knowledge without forcing place grounding.');

// =========================================================================
// 3. World Capitals & General Encyclopedic Knowledge (Geography, Physics, Math, CS, Chemistry)
// =========================================================================
console.log('3. Testing world capitals, science, math, and definitions...');

const generalKnowledgeQueries = [
    // Geography
    { query: 'What is the capital of France?', domain: 'World Capital' },
    { query: 'What is the capital of Peru?', domain: 'World Capital' },
    { query: 'What is the capital of Australia?', domain: 'World Capital' },
    { query: 'What is the capital of Japan?', domain: 'World Capital' },
    { query: 'What is the capital of Germany?', domain: 'World Capital' },
    { query: 'What is the longest river in the world?', domain: 'Geography' },
    { query: 'What are the seven continents of the world?', domain: 'Geography' },
    // Physics formulas
    { query: 'What is the formula for kinetic energy in physics?', domain: 'Physics - Formula' },
    { query: 'Explain the theory of general relativity and equation E=mc^2', domain: 'Physics - Relativity' },
    { query: 'What is the speed of light in a vacuum?', domain: 'Physics' },
    { query: 'Who discovered penicillin?', domain: 'Science History' },
    // Calculus & Math
    { query: 'What is the Pythagorean theorem?', domain: 'Mathematics' },
    { query: 'Compute the derivative of x^3 + 5x', domain: 'Mathematics - Calculus Derivative' },
    { query: 'What is the integral of sin(x) dx?', domain: 'Mathematics - Calculus Integral' },
    // Definitions & Philosophy
    { query: 'What is the definition of epistemology in philosophy?', domain: 'Philosophy' },
    // CS & Algorithms
    { query: 'Explain the difference between TCP and UDP protocols', domain: 'Computer Science' },
    { query: 'Explain the quicksort algorithm and its time complexity', domain: 'Computer Science - Algorithm' },
    { query: 'Explain binary search algorithm', domain: 'Computer Science - Algorithm' },
    // Chemistry & Biology
    { query: 'Explain how photosynthesis works in plants and its chemical equation', domain: 'Biology/Chemistry' },
    { query: 'What is the chemical formula for water and methane?', domain: 'Chemistry' }
];

for (const { query, domain } of generalKnowledgeQueries) {
    assert.equal(frontendIsStable(query), true, `Frontend stable check failed for [${domain}] "${query}"`);
    assert.equal(backendIsStable(query), true, `Backend stable check failed for [${domain}] "${query}"`);

    const route = decideFrontendRoute(query);
    assert.equal(route.route, 'fast_simple', `Expected fast_simple for [${domain}] "${query}"`);
    assert.equal(route.requiresSources, false);

    const intent = classifyQueryIntent(query);
    assert.equal(intent.type, 'static_reasoning');
    assert.equal(intent.requiresLiveGrounding, false);
}
console.log('  [PASS] World capitals, science, math, and definitions route cleanly to fast model reasoning.');

// =========================================================================
// 4. Time-Sensitive Live Queries (Must remain properly classified as live)
// =========================================================================
console.log('4. Testing time-sensitive live query classification...');

const liveQueries = [
    { query: 'current Prime Minister of UK', expectedType: 'temporal_fact', role: 'Prime Minister', jurisdiction: 'Uk' },
    { query: 'Chief Minister of Maharashtra', expectedType: 'temporal_fact', role: 'Chief Minister', jurisdiction: 'Maharashtra' },
    { query: 'price of Ethereum today', expectedType: 'domain_specific', category: 'finance_crypto' },
    { query: 'weather in London tomorrow', expectedType: 'domain_specific', category: 'weather' },
    { query: 'Who is the Chief Minister of Karnataka?', expectedType: 'temporal_fact', role: 'Chief Minister', jurisdiction: 'Karnataka' },
    { query: 'Who is the current Prime Minister of United Kingdom?', expectedType: 'temporal_fact', role: 'Prime Minister', jurisdiction: 'United Kingdom' },
    { query: 'Who is the current President of France?', expectedType: 'temporal_fact', role: 'President', jurisdiction: 'France' },
    { query: 'Who is the current CEO of Apple?', expectedType: 'temporal_fact', role: 'CEO', jurisdiction: 'Apple' },
    { query: 'Who is the CM of Tamil Nadu', expectedType: 'temporal_fact', role: 'Chief Minister', jurisdiction: 'Tamil Nadu' },
    { query: 'What is the weather in Tokyo today?', expectedType: 'domain_specific', category: 'weather' },
    { query: 'Weather forecast for New York tomorrow', expectedType: 'domain_specific', category: 'weather' },
    { query: 'What is the price of Bitcoin now?', expectedType: 'domain_specific', category: 'finance_crypto' },
    { query: 'Tesla stock price today', expectedType: 'domain_specific', category: 'finance_crypto' },
    { query: 'Latest news about SpaceX Starship launch', expectedType: 'explicit_search_or_live', category: 'breaking_live' },
    { query: 'Live score of cricket match today', expectedType: 'breaking_live', category: 'breaking_live' },
    { query: 'Search the web for recent discoveries with sources', expectedType: 'explicit_search', category: 'explicit_search' }
];

for (const item of liveQueries) {
    // Must NOT be classified as stable geography or general fact
    assert.equal(frontendIsStable(item.query), false, `Expected frontend isStable to be FALSE for live query "${item.query}"`);
    assert.equal(backendIsStable(item.query), false, `Expected backend isStable to be FALSE for live query "${item.query}"`);

    // Entity intent classification
    const entityResult = backendClassifyEntity(item.query);
    assert.equal(entityResult.isLiveRequired, true, `Expected isLiveRequired to be true for "${item.query}"`);
    assert.equal(entityResult.isStableKnowledge, false, `Expected isStableKnowledge to be false for "${item.query}"`);

    if (item.role) {
        assert.equal(entityResult.entityTarget?.role, item.role, `Expected role ${item.role} for "${item.query}"`);
        assert.equal(entityResult.entityTarget?.jurisdiction.toLowerCase(), item.jurisdiction.toLowerCase(), `Expected jurisdiction ${item.jurisdiction} for "${item.query}"`);
    }

    // Frontend routing
    const route = decideFrontendRoute(item.query);
    assert.ok(route.route === 'live_required' || route.route === 'place_grounded', `Expected live_required/place_grounded for "${item.query}", got ${route.route}`);
    assert.equal(route.requiresSources, true, `Expected requiresSources to be true for "${item.query}"`);
}
console.log('  [PASS] Time-sensitive queries (political leaders, weather, crypto, live news) correctly require live grounding.');

// =========================================================================
// 5. Actionable Place Navigation Queries (Must remain place_grounded)
// =========================================================================
console.log('5. Testing actionable place navigation & nearby queries...');

const placeNavQueries = [
    'museum near me',
    'best restaurants open now in Paris',
    'places to visit in Mysore during summer',
    'hotels near Central Park',
    'directions to Eiffel Tower',
    'things to do in Tokyo'
];

for (const query of placeNavQueries) {
    assert.equal(frontendIsStable(query), false, `Expected isStable to be FALSE for place navigation query "${query}"`);
    const route = decideFrontendRoute(query);
    assert.ok(route.route === 'place_grounded' || route.route === 'live_required', `Expected place_grounded/live_required for "${query}", got ${route.route}`);
    assert.equal(route.requiresSources, true);
}
console.log('  [PASS] Actionable place and navigation queries correctly trigger place grounding.');

console.log('query-classification-facts-tests-ok');
