import assert from 'node:assert/strict';
import {
    createConversationEngine,
    textToEmbeddingVector,
    vectorCosineSimilarity
} from '../app/context-engine.js';

function token(index) {
    return String.fromCharCode(97 + (index % 26)).repeat(4);
}

function titleToken(index) {
    const value = token(index);
    return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function syntheticTopic(index) {
    return `${titleToken(index)} ${titleToken(index + 1)}`;
}

function syntheticSentence(indices) {
    return indices.map(i => token(i)).join(' ');
}

function semanticSearch(query, documents, topK = 3) {
    const queryVec = textToEmbeddingVector(query);
    return documents
        .map(doc => {
            const text = typeof doc === 'string' ? doc : (doc?.text || doc?.content || '');
            const vec = textToEmbeddingVector(text);
            const score = vectorCosineSimilarity(queryVec, vec);
            return { doc, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
}

function assertSemanticMatch(actualText, referenceText, minSimilarity = 0.20, message = '') {
    const v1 = textToEmbeddingVector(actualText);
    const v2 = textToEmbeddingVector(referenceText);
    const sim = vectorCosineSimilarity(v1, v2);
    assert.ok(
        sim >= minSimilarity,
        `${message || 'Semantic similarity check failed'}: expected similarity >= ${minSimilarity}, got ${sim.toFixed(3)} for "${actualText}" vs "${referenceText}"`
    );
}

const TOPIC = Object.freeze({
    primary: token(0),
    secondary: token(1),
    namedEntity: syntheticTopic(2),
    temporary: token(4),
    pendingBypass: `${token(5)} ${token(6)}`,
    placePrimary: titleToken(7),
    placeSecondary: titleToken(8)
});

const SAMPLE = Object.freeze({
    usefulUser: syntheticSentence([9, 10]),
    usefulAssistant: syntheticSentence([11, 12]),
    failedAssistant: syntheticSentence([13, 14]),
    interruptedUser: syntheticSentence([15, 16]),
    interruptedAssistant: syntheticSentence([17, 18])
});

const PROMPT = Object.freeze({
    introduce: topic => `Tell me about ${topic}`,
    explain: topic => `Explain ${topic}`,
    followUp: 'Tell me more about it',
    acknowledgement: 'okay',
    namedEntityQuestion: entity => `Who is ${entity}?`,
    repair: 'No, I meant explain its practical use',
    resume: topic => `Go back to ${topic}`,
    temporarySwitch: topic => `Switch to a temporary topic about ${topic}`,
    listRequest: `Give me 10 tips for ${token(19)}`,
    modify: 'make it shorter',
    liveRequest: 'weather forecast now',
    compare: topic => `compare it with ${topic}`,
    switchQuestion: topic => `Another question: what is ${topic}?`,
    ambiguousReference: 'compare them',
    placeRelative: 'nearby beaches',
    placeCategory: 'hill stations',
    placeGeneral: 'tourist places',
    placeSpecific: (category, place) => `nearby ${category} in ${place}`
});

const PENDING_SCENARIOS = Object.freeze([
    { type: 'weather_location', expected: 'location' },
    { type: 'travel_location', expected: 'location' },
    { type: 'translator_input', expected: 'free_text' },
    { type: 'screen_suggestion', expected: 'free_text' },
    { type: 'location_choice', expected: 'number', options: [titleToken(20), titleToken(21)] },
    { type: 'transport_confirmation', expected: 'yes_no' }
]);

function recordExchange(engine, threadId, userText, assistantText, source = 'text') {
    engine.recordTurn({ role: 'user', text: userText, threadId, source });
    engine.recordTurn({ role: 'assistant', text: assistantText, threadId });
}

function resolveAndRecordTopic(engine, topic, source = 'text') {
    const result = engine.resolve({ message: PROMPT.introduce(topic) });
    assert.equal(result.decisionReason, 'clear_new_intent');
    recordExchange(engine, result.activeThread.id, result.resolvedMessage, `${topic} summary.`, source);
    return result.activeThread.id;
}

function assertUsesThread(result, threadId, message = 'expected active thread') {
    assert.equal(result.activeThread.id, threadId, message);
}

function assertDoesNotUseThread(result, threadId, message = 'expected new thread') {
    assert.notEqual(result.activeThread.id, threadId, message);
}

// ----------------------------------------------------------------------------
// Core Conversation Engine Lifecycle & State Recovery
// ----------------------------------------------------------------------------
const engine = createConversationEngine({ maxTurns: 8, maxContextChars: 600 });

let result = engine.resolve({ message: PROMPT.introduce(TOPIC.primary) });
assert.equal(result.decisionReason, 'clear_new_intent');
const primaryThread = result.activeThread.id;
recordExchange(engine, primaryThread, result.resolvedMessage, `${TOPIC.primary} details.`);

result = engine.resolve({ message: PROMPT.followUp });
assert.equal(result.decisionReason, 'contextual_follow_up');
assertSemanticMatch(result.resolvedMessage, TOPIC.primary, 0.20, 'Resolved follow-up must anchor to primary topic');
assertUsesThread(result, primaryThread);

engine.setPending({ type: 'weather_location', expected: 'location', threadId: primaryThread });
result = engine.resolve({ message: PROMPT.explain(TOPIC.secondary) });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.reason, 'superseded_by_new_intent');
assertDoesNotUseThread(result, primaryThread);

engine.setPending({ type: 'location_choice', expected: 'number', options: [titleToken(22), titleToken(23)] });
result = engine.resolve({ message: '2' });
assert.equal(result.decisionReason, 'pending_clarification_answer');

engine.setPending({ type: 'weather_location', expected: 'location', threadId: primaryThread });
result = engine.resolve({ message: TOPIC.placePrimary });
assert.equal(result.decisionReason, 'pending_clarification_answer');
assertUsesThread(result, primaryThread);

engine.setPending({ type: 'location_choice', expected: 'number', options: [titleToken(24), titleToken(25)] });
result = engine.resolve({ message: PROMPT.listRequest });
assert.equal(result.decisionReason, 'clear_new_intent');
assert.equal(result.cancelledPendingState.type, 'location_choice');

result = engine.resolve({ message: PROMPT.acknowledgement });
assert.notEqual(result.decisionReason, 'clear_new_intent');

const currentThread = engine.getState().activeThreadId;
recordExchange(engine, currentThread, SAMPLE.usefulUser, SAMPLE.usefulAssistant);
engine.recordTurn({ role: 'assistant', text: SAMPLE.failedAssistant, threadId: currentThread, error: true });
assert.equal(engine.buildContext().some(turn => turn.text === SAMPLE.failedAssistant), false);

engine.recordTurn({ id: 'interrupted_user', turnId: 'turn_interrupted', role: 'user', text: SAMPLE.interruptedUser, threadId: currentThread });
engine.recordTurn({ id: 'interrupted_answer', turnId: 'turn_interrupted', role: 'assistant', text: SAMPLE.interruptedAssistant, threadId: currentThread });
assert.equal(engine.discardTurn('turn_interrupted'), 2);
assert.equal(engine.buildContext().some(turn => [SAMPLE.interruptedUser, SAMPLE.interruptedAssistant].includes(turn.text)), false);

const before = engine.getState();
engine.buildContext();
assert.deepEqual(engine.getState(), before, 'building regeneration context must not mutate state');

engine.resolve({ message: PROMPT.temporarySwitch(TOPIC.temporary) });
engine.recordTurn({ role: 'user', text: `${TOPIC.temporary} temporary question` });
engine.restoreState(before);
assert.deepEqual(engine.getState(), before, 'restoring a regeneration snapshot must recover the exact conversation state');

// ----------------------------------------------------------------------------
// Multi-Thread Mixed Interaction & Conversational Repair
// ----------------------------------------------------------------------------
const mixedInputEngine = createConversationEngine({ maxTurns: 12, maxContextChars: 1200 });
const mixedPrimaryThread = resolveAndRecordTopic(mixedInputEngine, TOPIC.primary);

let mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assert.equal(mixed.decisionReason, 'contextual_follow_up');
assertUsesThread(mixed, mixedPrimaryThread);
assertSemanticMatch(mixed.resolvedMessage, TOPIC.primary, 0.20);
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(mixedInputEngine.getState().turns.at(-1).source, 'converse');

mixed = mixedInputEngine.resolve({ message: PROMPT.explain(TOPIC.secondary) });
const secondaryThread = mixed.activeThread.id;
assertDoesNotUseThread(mixed, mixedPrimaryThread);
mixedInputEngine.recordTurn({
    role: 'user',
    text: mixed.resolvedMessage,
    threadId: secondaryThread,
    source: 'vtt'
});

mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assertUsesThread(mixed, secondaryThread);

mixed = mixedInputEngine.resolve({ message: PROMPT.namedEntityQuestion(TOPIC.namedEntity) });
assert.equal(mixed.decisionReason, 'clear_new_intent');
assertDoesNotUseThread(mixed, secondaryThread);
const entityThread = mixed.activeThread.id;
recordExchange(mixedInputEngine, entityThread, mixed.resolvedMessage, `${TOPIC.namedEntity} information.`);

mixed = mixedInputEngine.resolve({ message: PROMPT.followUp });
assert.equal(mixed.decisionReason, 'contextual_follow_up');
assertSemanticMatch(mixed.resolvedMessage, TOPIC.namedEntity, 0.20);

mixed = mixedInputEngine.resolve({ message: PROMPT.repair });
assert.equal(mixed.decisionReason, 'conversation_repair');
assertUsesThread(mixed, entityThread);

mixed = mixedInputEngine.resolve({ message: PROMPT.resume(TOPIC.primary) });
assert.equal(mixed.decisionReason, 'explicit_thread_resume');
assertUsesThread(mixed, mixedPrimaryThread);

const topicBeforeAcknowledgement = mixedInputEngine.getState().threads
    .find(thread => thread.id === mixedPrimaryThread).topic;
mixed = mixedInputEngine.resolve({ message: PROMPT.acknowledgement });
mixedInputEngine.recordTurn({
    role: 'user',
    text: PROMPT.acknowledgement,
    threadId: mixed.activeThread.id,
    source: 'converse'
});
assert.equal(
    mixedInputEngine.getState().threads.find(thread => thread.id === mixedPrimaryThread).topic,
    topicBeforeAcknowledgement,
    'acknowledgements must not replace the active topic'
);

for (const pending of PENDING_SCENARIOS) {
    mixedInputEngine.setPending({ ...pending, threadId: mixedPrimaryThread });
    const switched = mixedInputEngine.resolve({ message: PROMPT.explain(TOPIC.pendingBypass) });
    assert.equal(switched.decisionReason, 'clear_new_intent', `${pending.type} must not intercept a new spoken intent`);
    assert.equal(switched.cancelledPendingState.type, pending.type);
}

// ----------------------------------------------------------------------------
// Context Copilot Thread Resolution & Intent Transitions
// ----------------------------------------------------------------------------
const contextCopilotEngine = createConversationEngine({ maxTurns: 12, maxContextChars: 1200 });
const primaryContextTopic = syntheticTopic(0);
const secondaryContextTopic = syntheticTopic(2);
const personContextTopic = syntheticTopic(4);
let copilot = contextCopilotEngine.resolve({ message: PROMPT.introduce(primaryContextTopic) });
assert.equal(copilot.decisionReason, 'clear_new_intent');
const primaryContextThread = copilot.activeThread.id;
recordExchange(contextCopilotEngine, primaryContextThread, copilot.resolvedMessage, `${primaryContextTopic} summary.`);

copilot = contextCopilotEngine.resolve({ message: PROMPT.followUp });
assert.equal(copilot.decisionReason, 'contextual_follow_up');
assertSemanticMatch(copilot.resolvedMessage, primaryContextTopic, 0.20);
recordExchange(contextCopilotEngine, primaryContextThread, copilot.resolvedMessage, `${primaryContextTopic} latest summary.`);

const syntheticInstrumentTopic = syntheticSentence([5, 6, 7, 8]);
copilot = contextCopilotEngine.resolve({ message: PROMPT.introduce(syntheticInstrumentTopic) });
assert.equal(copilot.decisionReason, 'clear_new_intent');
const instrumentThread = copilot.activeThread.id;
recordExchange(contextCopilotEngine, instrumentThread, copilot.resolvedMessage, `${syntheticInstrumentTopic} summary.`);

copilot = contextCopilotEngine.resolve({ message: TOPIC.placePrimary });
assert.equal(copilot.decisionReason, 'clear_new_intent');
assertDoesNotUseThread(copilot, instrumentThread, 'bare place-like replies should start a new topic instead of blocking on clarification');
assert.equal(copilot.resolvedMessage, TOPIC.placePrimary);
recordExchange(contextCopilotEngine, copilot.activeThread.id, copilot.resolvedMessage, `${TOPIC.placePrimary} info.`);

copilot = contextCopilotEngine.resolve({ message: PROMPT.liveRequest });
assert.notEqual(copilot.decisionReason, 'contextual_follow_up');
assertDoesNotUseThread(copilot, instrumentThread, 'live request must not inherit previous context');
assert.equal(copilot.resolvedMessage, PROMPT.liveRequest);

copilot = contextCopilotEngine.resolve({ message: PROMPT.introduce(secondaryContextTopic) });
assert.equal(copilot.decisionReason, 'clear_new_intent');
const secondaryContextThread = copilot.activeThread.id;
assertDoesNotUseThread(copilot, primaryContextThread);
recordExchange(contextCopilotEngine, secondaryContextThread, copilot.resolvedMessage, `${secondaryContextTopic} summary.`);

copilot = contextCopilotEngine.resolve({ message: PROMPT.compare(primaryContextTopic) });
assert.equal(copilot.decisionReason, 'contextual_follow_up');
assertUsesThread(copilot, secondaryContextThread);
assertSemanticMatch(copilot.resolvedMessage, secondaryContextTopic, 0.20);
assertSemanticMatch(copilot.resolvedMessage, primaryContextTopic, 0.20);

copilot = contextCopilotEngine.resolve({ message: PROMPT.repair });
assert.equal(copilot.decisionReason, 'conversation_repair');
assertUsesThread(copilot, secondaryContextThread);
assertSemanticMatch(copilot.resolvedMessage, secondaryContextTopic, 0.20);

copilot = contextCopilotEngine.resolve({ message: PROMPT.resume(primaryContextTopic) });
assert.equal(copilot.decisionReason, 'explicit_thread_resume');
assertUsesThread(copilot, primaryContextThread);

const syntheticScienceTopic = syntheticTopic(10);
copilot = contextCopilotEngine.resolve({ message: PROMPT.switchQuestion(syntheticScienceTopic) });
assert.equal(copilot.decisionReason, 'clear_new_intent');
assert.equal(copilot.primaryIntent, 'new_unrelated_task');
assertDoesNotUseThread(copilot, primaryContextThread);
const scienceThread = copilot.activeThread.id;
recordExchange(contextCopilotEngine, scienceThread, copilot.resolvedMessage, `${syntheticScienceTopic} summary.`);

copilot = contextCopilotEngine.resolve({ message: PROMPT.modify });
assert.equal(copilot.decisionReason, 'contextual_follow_up');
assert.equal(copilot.primaryIntent, 'continue_previous_task');
assertUsesThread(copilot, scienceThread);

copilot = contextCopilotEngine.resolve({ message: PROMPT.namedEntityQuestion(personContextTopic) });
assert.equal(copilot.decisionReason, 'clear_new_intent');
assertDoesNotUseThread(copilot, primaryContextThread);
const personContextThread = copilot.activeThread.id;

copilot = contextCopilotEngine.resolve({ message: PROMPT.ambiguousReference });
assert.equal(copilot.decisionReason, 'ambiguous_reference_context');
assert.equal(copilot.primaryIntent, 'clarification');
assertUsesThread(copilot, personContextThread);

const personTopicBeforeAcknowledgement = contextCopilotEngine.getState().threads
    .find(thread => thread.id === personContextThread).topic;
copilot = contextCopilotEngine.resolve({ message: PROMPT.acknowledgement });
assert.notEqual(copilot.decisionReason, 'clear_new_intent');
contextCopilotEngine.recordTurn({ role: 'user', text: PROMPT.acknowledgement, threadId: copilot.activeThread.id });
assert.equal(
    contextCopilotEngine.getState().threads.find(thread => thread.id === personContextThread).topic,
    personTopicBeforeAcknowledgement,
    'Context Copilot acknowledgement must not overwrite active topic'
);

// ----------------------------------------------------------------------------
// Generative Multi-Domain Follow-Up Sequences
// ----------------------------------------------------------------------------
for (const scenario of [
    {
        anchor: syntheticTopic(12),
        standalone: PROMPT.namedEntityQuestion(syntheticTopic(14)),
        followup: PROMPT.followUp
    },
    {
        anchor: syntheticTopic(16),
        standalone: PROMPT.explain(syntheticTopic(18)),
        followup: PROMPT.followUp
    }
]) {
    const engineForScenario = createConversationEngine({ maxTurns: 10, maxContextChars: 1000 });
    let generic = engineForScenario.resolve({ message: PROMPT.introduce(scenario.anchor) });
    const anchorThread = generic.activeThread.id;
    recordExchange(engineForScenario, anchorThread, generic.resolvedMessage, `${scenario.anchor} summary.`);

    generic = engineForScenario.resolve({ message: scenario.standalone });
    assert.equal(generic.decisionReason, 'clear_new_intent');
    assertDoesNotUseThread(generic, anchorThread, `${scenario.standalone} must not inherit ${scenario.anchor}`);
    const standaloneThread = generic.activeThread.id;
    recordExchange(engineForScenario, standaloneThread, generic.resolvedMessage, `${scenario.standalone} summary.`);

    generic = engineForScenario.resolve({ message: scenario.followup });
    assert.equal(generic.decisionReason, 'contextual_follow_up');
    assertUsesThread(generic, standaloneThread);
}

// ----------------------------------------------------------------------------
// Fast Topic Switches & Place Grounding
// ----------------------------------------------------------------------------
const placeFollowEngine = createConversationEngine({ maxTurns: 8, maxContextChars: 800 });
let placeFollow = placeFollowEngine.resolve({ message: PROMPT.introduce(TOPIC.placePrimary) });
assert.equal(placeFollow.decisionReason, 'clear_new_intent');
const ootyThread = placeFollow.activeThread.id;
recordExchange(placeFollowEngine, ootyThread, placeFollow.resolvedMessage, `${TOPIC.placePrimary} location.`);
placeFollow = placeFollowEngine.resolve({ message: PROMPT.placeRelative });
assert.equal(placeFollow.decisionReason, 'contextual_follow_up');
assertUsesThread(placeFollow, ootyThread);
assertSemanticMatch(placeFollow.resolvedMessage, TOPIC.placePrimary, 0.20);
assertSemanticMatch(placeFollow.resolvedMessage, 'beaches', 0.20);
placeFollow = placeFollowEngine.resolve({ message: PROMPT.placeCategory });
assert.equal(placeFollow.decisionReason, 'contextual_follow_up');
assertUsesThread(placeFollow, ootyThread);
assertSemanticMatch(placeFollow.resolvedMessage, TOPIC.placePrimary, 0.20);
placeFollow = placeFollowEngine.resolve({ message: PROMPT.placeGeneral });
assert.equal(placeFollow.decisionReason, 'contextual_follow_up');
assertSemanticMatch(placeFollow.resolvedMessage, TOPIC.placePrimary, 0.20);
placeFollow = placeFollowEngine.resolve({ message: PROMPT.placeSpecific('beaches', TOPIC.placeSecondary) });
assert.equal(placeFollow.decisionReason, 'clear_new_intent');

// ============================================================================
// Dense Vector Semantic Search & Embeddings Suite
// ============================================================================
const domainA = syntheticSentence([1, 2, 3, 4, 5]);
const domainB = syntheticSentence([1, 2, 3, 6, 7]);
const domainC = syntheticSentence([10, 11, 12, 13, 14]);

const vA = textToEmbeddingVector(domainA);
const vB = textToEmbeddingVector(domainB);
const vC = textToEmbeddingVector(domainC);

assert.equal(vA.length, 512, 'Embedding vector dimensionality must be 512');
let normA = 0;
for (let i = 0; i < vA.length; i++) normA += vA[i] * vA[i];
assert.ok(Math.abs(Math.sqrt(normA) - 1.0) < 1e-4, 'Embedding vector must have unit L2 norm');

const similarScore = vectorCosineSimilarity(vA, vB);
const orthogonalScore = vectorCosineSimilarity(vA, vC);
assert.ok(similarScore > 0.35, `Similar intents must have high cosine similarity (got ${similarScore.toFixed(3)})`);
assert.ok(orthogonalScore < 0.20, `Orthogonal intents must have low cosine similarity (got ${orthogonalScore.toFixed(3)})`);

const documents = [
    { id: 1, text: `${syntheticSentence([1, 2, 3])} database storage relational persistence` },
    { id: 2, text: `${syntheticSentence([4, 5, 6])} strict typing compiler language rules` },
    { id: 3, text: `${syntheticSentence([7, 8, 9])} real-time live forecast weather temperature` },
    { id: 4, text: `${syntheticSentence([10, 11, 12])} partition queue message consumer stream` },
    { id: 5, text: `${syntheticSentence([13, 14, 15])} step-by-step numbered format instructions` }
];

const topDbResults = semanticSearch('database storage relational persistence', documents, 2);
assert.equal(topDbResults[0].doc.id, 1, 'Top search result for database query must be document 1');
assert.ok(topDbResults[0].score > topDbResults[1].score, 'Top-1 score must exceed top-2');

const topConstraintResults = semanticSearch('strict typing compiler language rules', documents, 1);
assert.equal(topConstraintResults[0].doc.id, 2, 'Top search result for compiler rules must be document 2');

console.log('context-engine-tests-ok');
