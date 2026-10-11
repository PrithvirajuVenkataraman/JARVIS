import assert from 'node:assert/strict';
import {
    isComplexTechnicalQuery,
    isStableGeographyOrGeneralFactQuery,
    decideFrontendRoute,
    isSimpleStableQuestion
} from '../app/frontend-routing.js';
import {
    createConversationEngine,
    resolveOrdinalOrAnaphoricAntecedent,
    classifyInput,
    extractAssistantListItems
} from '../app/context-engine.js';

console.log('--- Testing Follow-up Questions & Technical Architecture Dialogue Integrity ---');

// =========================================================================
// 1. isComplexTechnicalQuery Detection
// =========================================================================
console.log('1. Testing isComplexTechnicalQuery detection...');

const roundRobinQuery = 'How did we implement the round robin technique for concurrent users?';
assert.equal(isComplexTechnicalQuery(roundRobinQuery), true, 'Round robin concurrent users query must classify as complex technical');

const concurrencyQuery = 'how does load balancing handle thread pool starvation and failover?';
assert.equal(isComplexTechnicalQuery(concurrencyQuery), true, 'Concurrency and failover query must classify as complex technical');

const longPastedText = 'The round-robin algorithm distributes incoming requests sequentially across available worker nodes in a circular order. When concurrent traffic spikes, each worker process takes its turn from the queue, maintaining fair share execution without priority starvation across the pool.';
assert.equal(isComplexTechnicalQuery(longPastedText), true, 'Long pasted technical explanation must classify as complex technical');

// General facts and monument architecture must NOT be falsely classified as complex technical
assert.equal(isComplexTechnicalQuery('Tell me about New South Wales'), false);
assert.equal(isComplexTechnicalQuery('What is the capital of New York?'), false);
assert.equal(isComplexTechnicalQuery('Explain new operator overloading in C++'), false);
assert.equal(isComplexTechnicalQuery('What is the speed of light?'), false);
assert.equal(isComplexTechnicalQuery('Explain the engineering and architecture of the Eiffel Tower'), false);
assert.equal(isComplexTechnicalQuery('Sun Temple architecture and sculptural style'), false);
assert.equal(isComplexTechnicalQuery('History and architectural significance of Angkor Wat'), false);

console.log('  [PASS] Complex technical and architecture queries accurately recognized.');

// =========================================================================
// 2. Frontend Routing for Technical Queries & Follow-ups
// =========================================================================
console.log('2. Testing frontend routing for technical and follow-up queries...');

const roundRobinRoute = decideFrontendRoute(roundRobinQuery);
assert.equal(roundRobinRoute.route, 'chat_direct', 'Round robin concurrent implementation query must route to chat_direct (NOT fast_simple)');

const pastedRoute = decideFrontendRoute(longPastedText);
assert.equal(pastedRoute.route, 'chat_direct', 'Pasted technical architecture text must route to chat_direct');

// Follow-up queries in context must NOT route to fast_simple
const followUpContext = {
    isFollowUp: true,
    activeThread: { lastAssistantText: 'We use round robin scheduling.' }
};
const followUpRoute = decideFrontendRoute('Can you explain step 1 in detail?', followUpContext);
assert.equal(followUpRoute.route, 'chat_direct', 'Follow-up query must route to chat_direct');

// Simple stable facts still route to fast_simple
const simpleRoute = decideFrontendRoute('What is the capital of France?');
assert.equal(simpleRoute.route, 'fast_simple', 'Simple geography fact must still route to fast_simple');

console.log('  [PASS] Technical queries and follow-ups route to chat_direct with full token budget.');

// =========================================================================
// 3. Context Engine: Ordinal Antecedent Resolution & List Items
// =========================================================================
console.log('3. Testing ordinal antecedent resolution for step, point, and item...');

const assistantReply = `Here are the steps we followed:
1. Step 1: Initialize the circular worker queue with capacity N.
2. Step 2: Dispatch incoming concurrent requests round-robin using modulo indexing.
3. Step 3: Monitor worker health and automatically eject unresponsive nodes.`;

const listItems = extractAssistantListItems(assistantReply);
assert.ok(listItems.length >= 2, 'Must extract list items from assistant reply');

const mockThread = {
    assistantListItems: listItems,
    assistantEntities: ['Round Robin Queue']
};

const step1Antecedent = resolveOrdinalOrAnaphoricAntecedent('Explain step 1', mockThread);
assert.ok(step1Antecedent && step1Antecedent.toLowerCase().includes('initialize'), `Expected step 1 antecedent, got: ${step1Antecedent}`);

const step2Antecedent = resolveOrdinalOrAnaphoricAntecedent('What about step 2?', mockThread);
assert.ok(step2Antecedent && step2Antecedent.toLowerCase().includes('dispatch'), `Expected step 2 antecedent, got: ${step2Antecedent}`);

const point1Antecedent = resolveOrdinalOrAnaphoricAntecedent('break down point 1', mockThread);
assert.ok(point1Antecedent && point1Antecedent.toLowerCase().includes('initialize'), `Expected point 1 antecedent, got: ${point1Antecedent}`);

const item2Antecedent = resolveOrdinalOrAnaphoricAntecedent('tell me about item 2', mockThread);
assert.ok(item2Antecedent && item2Antecedent.toLowerCase().includes('dispatch'), `Expected item 2 antecedent, got: ${item2Antecedent}`);

console.log('  [PASS] Ordinals ("step 1", "point 1", "item 2") resolve correctly.');

// =========================================================================
// 4. Context Engine: Turn Pairing Integrity (No Orphaned Assistant Turn)
// =========================================================================
console.log('4. Testing context turn pairing integrity in buildContext...');

const engine = createConversationEngine({ maxTurns: 12, maxContextChars: 12000 });
engine.recordTurn({ role: 'user', text: 'How does round robin work?' });
engine.recordTurn({ role: 'assistant', text: assistantReply });

const context = engine.buildContext({ maxContextChars: 12000 });
assert.ok(context.length >= 2, 'Context must retain both user and assistant turns');
assert.equal(context[0].role, 'user', 'Context must not start with an orphaned assistant turn');
assert.equal(context[1].role, 'assistant', 'Context must include the assistant turn');

console.log('  [PASS] Context preserves paired turns and never drops assistant replies.');

console.log('\n=== ALL FOLLOW-UP & TECHNICAL ARCHITECTURE TESTS PASSED ===\n');
