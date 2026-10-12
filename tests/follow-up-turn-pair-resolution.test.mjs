import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createConversationEngine,
    extractAssistantListItems,
    extractAssistantKeyEntities,
    resolveOrdinalOrAnaphoricAntecedent,
    classifyInput,
    buildMultiTierContext
} from '../app/context-engine.js';
import chatGroqModule from '../api/chat-groq.js';

test('Follow-up turn pair resolution & assistant entity retention', async (t) => {

    await t.test('1. extractAssistantListItems parses numbered and bulleted options', () => {
        const assistantText = `Here are 3 great options:
1. **Designing Data-Intensive Applications** - A comprehensive guide to data systems.
2. **Database Internals** - Deep dive into storage engines and distributed databases.
3. **Site Reliability Engineering** - Google's approach to operations.`;

        const items = extractAssistantListItems(assistantText);
        assert.equal(items.length, 3);
        assert.ok(items[0].includes('Designing Data-Intensive Applications'));
        assert.ok(items[1].includes('Database Internals'));
        assert.ok(items[2].includes('Site Reliability Engineering'));
    });

    await t.test('2. extractAssistantKeyEntities extracts bolded entities and proper nouns', () => {
        const assistantText = `You should visit **Yellowstone National Park** and **Grand Teton**. Both have incredible wildlife.`;
        const entities = extractAssistantKeyEntities(assistantText);
        assert.ok(entities.includes('Yellowstone National Park'));
        assert.ok(entities.includes('Grand Teton'));
    });

    await t.test('3. resolveOrdinalOrAnaphoricAntecedent correctly resolves ordinal references', () => {
        const mockThread = {
            id: 'thread_1',
            topic: 'books',
            entity: 'Distributed Systems',
            assistantListItems: [
                'Designing Data-Intensive Applications',
                'Database Internals',
                'Site Reliability Engineering'
            ],
            assistantEntities: ['Martin Kleppmann', 'Alex Petrov']
        };

        // Ordinal references
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('Tell me more about the second one', mockThread), 'Database Internals');
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('Explain the first option', mockThread), 'Designing Data-Intensive Applications');
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('What about option 3?', mockThread), 'Site Reliability Engineering');
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('Can you elaborate on the latter?', mockThread), 'Database Internals');
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('What is the last option?', mockThread), 'Site Reliability Engineering');

        // Pronoun reference
        assert.equal(resolveOrdinalOrAnaphoricAntecedent('Why is it so popular?', mockThread), 'Distributed Systems');
    });

    await t.test('4. End-to-end multi-turn conversation retains assistant turn and resolves follow-ups', () => {
        const engine = createConversationEngine({ maxTurns: 10 });

        // Turn 1
        const turn1Resolution = engine.resolve({ message: 'Recommend some great database books' });
        assert.equal(turn1Resolution.primaryIntent, 'new_unrelated_task');

        const activeThreadId = turn1Resolution.activeThread.id;
        engine.recordTurn({
            role: 'user',
            text: 'Recommend some great database books',
            threadId: activeThreadId
        });

        const assistantReply1 = `Here are two excellent choices:
1. **Designing Data-Intensive Applications** by Martin Kleppmann.
2. **Database Internals** by Alex Petrov.`;

        engine.recordTurn({
            role: 'assistant',
            text: assistantReply1,
            threadId: activeThreadId
        });

        // Turn 2 follow-up referencing "the second one"
        const turn2Resolution = engine.resolve({ message: 'Can you elaborate on the second one?' });
        assert.equal(turn2Resolution.decisionReason, 'contextual_follow_up');
        assert.equal(turn2Resolution.activeThread.id, activeThreadId);
        assert.equal(turn2Resolution.resolvedAntecedent, 'Database Internals');
        assert.ok(turn2Resolution.searchQuery.includes('Database Internals'));
        assert.equal(turn2Resolution.resolvedMessage, 'Can you elaborate on the second one?');

        // Check buildMultiTierContext contains both Turn 1 user and assistant messages
        const multiTier = engine.buildMultiTierContext({
            message: 'Can you elaborate on the second one?',
            systemPrompt: 'You are Jarvis.'
        });

        assert.ok(multiTier.recentTurns.length >= 2, 'Must include both prior user and assistant turns');
        const roles = multiTier.recentTurns.map(t => t.role);
        assert.ok(roles.includes('user'), 'Must contain user turn');
        assert.ok(roles.includes('assistant'), 'Must contain assistant turn');

        const assistantTurnInContext = multiTier.recentTurns.find(t => t.role === 'assistant');
        assert.ok(assistantTurnInContext.text.includes('Database Internals'), 'Assistant text must be preserved in context');
    });

    await t.test('5. classifyInput does not trigger clearNewIntent for follow-ups referencing assistant output', () => {
        const mockThread = {
            id: 'thread_travel',
            topic: 'travel',
            entity: 'Japan',
            assistantEntities: ['Kyoto', 'Osaka', 'Tokyo'],
            assistantListItems: ['Kyoto temples', 'Osaka street food', 'Tokyo skyline']
        };

        const classification = classifyInput('How do I get to Osaka from there?', null, mockThread);
        assert.equal(classification.clearNewIntent, false);
        assert.equal(classification.isFollowUp, true);
    });

    await t.test('6. chat-groq API preserves full turn pairs in context', () => {
        const validateFn = chatGroqModule.validateChatRequest;
        if (typeof validateFn === 'function') {
            const sampleRequest = {
                message: 'Tell me more about it',
                context: [
                    { role: 'user', text: 'Tell me about quantum computing' },
                    { role: 'assistant', text: 'Quantum computing leverages quantum mechanics like superposition and entanglement.' }
                ]
            };
            const validated = validateFn(sampleRequest);
            assert.equal(validated.ok, true);
            assert.equal(validated.value.context.length, 2);
            assert.equal(validated.value.context[0].role, 'user');
            assert.equal(validated.value.context[1].role, 'assistant');
        }
    });

});
