import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationEngine, resolveConversationReference } from '../app/context-engine.js';
import { buildContext } from '../app/context-retrieval.js';

const turns = [{ id: 'u1', role: 'user', text: 'Compare Redis and PostgreSQL.' }, { id: 'a1', role: 'assistant', text: '1. Redis: fast cache.\n2. PostgreSQL: relational storage.' }];
test('reference ties remain explicit and original questions remain unchanged', () => {
    const result = resolveConversationReference('Is it secure?', turns);
    assert.equal(result.status, 'ambiguous'); assert.equal(result.originalMessage, 'Is it secure?');
    assert.deepEqual(result.candidates.map(item => item.label), ['Redis', 'PostgreSQL']);
    assert.deepEqual(result.evidenceIds, ['a1']);
    assert.equal(resolveConversationReference('Explain the second one', turns).candidates[0].label, 'PostgreSQL');
    assert.equal(resolveConversationReference('Make this answer shorter', turns).status, 'resolved');
    assert.equal(resolveConversationReference('Compare both of them', turns).status, 'resolved');
    assert.equal(resolveConversationReference('see above', []).status, 'missing');
    assert.deepEqual(resolveConversationReference('see above', [...turns, { id: 'u2', role: 'user', text: 'New topic: write a birthday message.' }, { id: 'a2', role: 'assistant', text: 'Happy birthday!' }]).evidenceIds, ['a2']);
    assert.equal(resolveConversationReference('Is it secure?', [...turns, { id: 'bad', role: 'assistant', text: 'irrelevant', aborted: true }]).status, 'ambiguous');
});
test('caller context window and budget survive retrieval and session reset', async () => {
    const engine = createConversationEngine({ maxTurnHistory: 200 });
    for (let i = 0; i < 15; i++) { engine.resolve({ message: 'Continue the same project' }); engine.recordTurn({ id: `u${i}`, role: 'user', text: `Project requirement ${i}` }); engine.recordTurn({ id: `a${i}`, role: 'assistant', text: `Confirmed requirement ${i}` }); }
    const context = await buildContext(engine, { message: 'see above', maxRecentTurns: 40, maxContextChars: 64000 });
    assert.ok(context.recentTurns.length > 8); assert.ok(context.recentTurns.length <= 40);
    assert.ok(JSON.stringify(context.structuredMessages).length <= 64000);
    engine.reset();
    const empty = await buildContext(engine, { message: 'see above' });
    assert.equal(empty.reference.status, 'missing'); assert.equal(empty.recentTurns.length, 0);
});
test('repeated finalization updates a turn without duplicating its history or changing reference IDs', () => {
    const engine = createConversationEngine();
    engine.recordTurn({ role: 'user', text: 'Compare two stores.', turnId: 'turn-1' });
    const first = engine.recordTurn({ role: 'assistant', text: 'Partial answer.', turnId: 'turn-1' });
    engine.recordTurn({ role: 'user', text: 'Compare two stores.', turnId: 'turn-1' });
    const final = engine.recordTurn({ role: 'assistant', text: 'Completed answer.', turnId: 'turn-1' });
    assert.equal(engine.getState().turns.length, 2);
    assert.equal(first.id, final.id);
    assert.equal(engine.getState().turns[1].text, 'Completed answer.');
});
