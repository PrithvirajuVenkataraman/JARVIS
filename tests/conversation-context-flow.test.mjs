import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationEngine } from '../app/context-engine.js';

test('Phase 4: Conversation Context Pipeline (20-30+ Turns & Zero Rewriting)', async (t) => {
    const engine = createConversationEngine({
        maxTurns: 30,
        maxTurnHistory: 200,
        maxContextChars: 16000,
        maxThreads: 8
    });

    const threadId = 'japan_trip_thread';

    // Step 1: Initial Foundational Turns (Turns 1-4)
    // Establishing topic, entities, constraints, and initial decisions
    const initialExchanges = [
        {
            user: 'We are planning a 7-day trip to Kyoto in November. Our budget is strictly $2000 and we prefer traditional ryokan accommodations.',
            asst: 'Kyoto in November is peak autumn foliage season. With a $2000 budget and ryokan preference, we will focus on central Kyoto ryokans like Gion or Arashiyama with seasonal kaiseki dining.'
        },
        {
            user: 'Which historic temple was designed by Sen no Rikyu for tea ceremonies?',
            asst: 'Sen no Rikyu is intimately associated with the tea houses at Daitoku-ji temple complex and Myoki-an in Yamazaki, home to the Taian teahouse.'
        }
    ];

    for (let i = 0; i < initialExchanges.length; i++) {
        const { user, asst } = initialExchanges[i];
        const res = engine.resolve({ message: user });
        assert.equal(res.resolvedMessage, user, 'Initial user message must be preserved verbatim');
        const activeTid = res.activeThread.id;
        engine.recordTurn({ role: 'user', text: user, threadId: activeTid, id: `turn_${i * 2 + 1}` });
        engine.recordTurn({ role: 'assistant', text: asst, threadId: activeTid, id: `turn_${i * 2 + 2}` });
    }

    // Step 2: Build realistic turns up to Turn 25+
    const progressionTurns = [
        ['What train pass should we buy for Kansai?', 'The Kansai Thru Pass or JR West Kansai Area Pass is ideal.'],
        ['Is it better to stay in Gion or Arashiyama?', 'Gion offers vibrant night walks and dining, while Arashiyama is quieter.'],
        ['Can you recommend vegan dining spots in Kyoto?', 'Ain Soph Journey and Shigetsu inside Tenryu-ji serve excellent Shojin Ryori.'],
        ['What is the best way to get to Fushimi Inari?', 'Take the JR Nara Line from Kyoto Station to Inari Station (5 minutes).'],
        ['Should we hike all the way to the summit?', 'The summit hike takes 2-3 hours and gets significantly less crowded past the Yotsutsuji intersection.'],
        ['Are luggage delivery services reliable in Japan?', 'Yes, Yamato Transport (Takkyubin) offers reliable same-day hotel-to-hotel delivery.'],
        ['What should we pack for November weather?', 'Light jackets, comfortable walking shoes, layers, and socks suitable for temple floors.'],
        ['Do most street vendors accept credit cards?', 'Many street markets in Kyoto still prefer cash, though IC cards (Suica/Pasmo) are widely accepted.'],
        ['How does the Kyoto bus day pass work?', 'The Kyoto City Bus One-Day Pass was discontinued in favor of the Subway & Bus 1-Day Pass (1100 yen).'],
        ['Can we do a day trip to Nara from Kyoto?', 'Yes, the Kintetsu or JR lines reach Nara in about 45 minutes.'],
        ['What is the etiquette when visiting a Shinto shrine?', 'Bow twice, clap twice, make your prayer, and bow once (Ni-rei, ni-hai, ichi-rei).'],
        ['Is tap water safe to drink throughout Kyoto?', 'Yes, tap water throughout Japan is clean and completely safe to drink.']
    ];

    let currentTurnIndex = 5;
    for (const [u, a] of progressionTurns) {
        const res = engine.resolve({ message: u });
        assert.equal(res.resolvedMessage, u, 'Progression user message must remain verbatim');
        const activeTid = res.activeThread.id;
        engine.recordTurn({ role: 'user', text: u, threadId: activeTid, id: `turn_${currentTurnIndex}` });
        engine.recordTurn({ role: 'assistant', text: a, threadId: activeTid, id: `turn_${currentTurnIndex + 1}` });
        currentTurnIndex += 2;
    }

    // At this point we have 28 turns recorded.
    assert.ok(engine.getState().turns.length >= 28, 'Must have at least 28 turns recorded');

    // =========================================================================
    // SUBTEST 1: Test "why?" follow-up
    // =========================================================================
    await t.test('1. Test "why?" follow-up: exact verbatim prompt, no regex hacks', () => {
        const query = 'why?';
        const res = engine.resolve({ message: query });
        assert.equal(res.resolvedMessage, 'why?', 'Message must NOT be rewritten to "why regarding Kyoto?"');
        assert.equal(res.verbatimMessage, 'why?');
        assert.equal(res.decisionReason, 'contextual_follow_up');
        assert.equal(res.activeThread.id, engine.getState().activeThreadId);

        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8
        });
        const lastMsg = context.structuredMessages.at(-1);
        assert.equal(lastMsg.role, 'user');
        assert.equal(lastMsg.content, 'why?', 'Structured message to LLM must be exact verbatim "why?"');
    });

    // =========================================================================
    // SUBTEST 2: Test "how so?" follow-up
    // =========================================================================
    await t.test('2. Test "how so?" follow-up: exact verbatim prompt, no regex hacks', () => {
        const query = 'how so?';
        const res = engine.resolve({ message: query });
        assert.equal(res.resolvedMessage, 'how so?', 'Message must NOT be rewritten');
        assert.equal(res.verbatimMessage, 'how so?');
        assert.equal(res.decisionReason, 'contextual_follow_up');
        assert.equal(res.activeThread.id, engine.getState().activeThreadId);

        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8
        });
        const lastMsg = context.structuredMessages.at(-1);
        assert.equal(lastMsg.content, 'how so?');
    });

    // =========================================================================
    // SUBTEST 3: Test "what about that?" follow-up
    // =========================================================================
    await t.test('3. Test "what about that?" follow-up: zero pronoun rewriting ("that" -> entity)', () => {
        const query = 'what about that?';
        const res = engine.resolve({ message: query });
        assert.equal(res.resolvedMessage, 'what about that?', 'Pronoun "that" must NOT be replaced with entity');
        assert.equal(res.verbatimMessage, 'what about that?');
        assert.equal(res.decisionReason, 'contextual_follow_up');
        assert.equal(res.activeThread.id, engine.getState().activeThreadId);

        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8
        });
        const lastMsg = context.structuredMessages.at(-1);
        assert.equal(lastMsg.content, 'what about that?');
    });

    // =========================================================================
    // SUBTEST 4: Test "who was it?" follow-up
    // =========================================================================
    await t.test('4. Test "who was it?" follow-up: zero pronoun rewriting ("it" -> entity)', () => {
        const query = 'who was it?';
        const res = engine.resolve({ message: query });
        assert.equal(res.resolvedMessage, 'who was it?', 'Pronoun "it" must NOT be replaced with entity');
        assert.equal(res.verbatimMessage, 'who was it?');
        assert.equal(res.decisionReason, 'contextual_follow_up');
        assert.equal(res.activeThread.id, engine.getState().activeThreadId);

        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8
        });
        const lastMsg = context.structuredMessages.at(-1);
        assert.equal(lastMsg.content, 'who was it?');
    });

    // =========================================================================
    // SUBTEST 5: Test "what did we discuss earlier?" retrospective query
    // =========================================================================
    await t.test('5. Test "what did we discuss earlier?": Tier 2 semantic retrieval + Tier 3 milestone summary', () => {
        const query = 'what did we discuss earlier?';
        const res = engine.resolve({ message: query });
        assert.equal(res.resolvedMessage, 'what did we discuss earlier?');
        assert.equal(res.verbatimMessage, 'what did we discuss earlier?');
        assert.equal(res.decisionReason, 'contextual_follow_up');

        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8,
            topK: 2
        });

        // 1. Verbatim user prompt reaching LLM unchanged
        const lastMsg = context.structuredMessages.at(-1);
        assert.equal(lastMsg.content, 'what did we discuss earlier?');

        // 2. Tier 1: Recent turns window
        assert.equal(context.recentTurns.length, 8);
        const recentTexts = context.recentTurns.map(t => t.text).join(' ');
        assert.ok(!recentTexts.includes('$2000'), 'Active verbatim window (Tier 1) should not contain Turn 1');

        // 3. Tier 2: Semantically retrieved earlier turns
        assert.ok(context.retrievedTurns.length > 0, 'Tier 2 must retrieve earlier turns outside the recent window');
        const retrievedTexts = context.retrievedTurns.map(t => t.text).join(' ');
        assert.match(retrievedTexts, /Kyoto|November|ryokan|Sen no Rikyu/i, 'Retrieved turns should contain foundational discussion');

        // 4. Tier 3: Rolling Milestone Summary
        assert.ok(context.summaryText, 'Tier 3 summary must exist for 28+ turns');
        assert.match(context.summaryText, /budget|prefer|2000|ryokan/i, 'Milestone summary must capture established constraints');
    });

    // =========================================================================
    // SUBTEST 6: Multi-tier Context with Persistent Memory Integration
    // =========================================================================
    await t.test('6. Persistent Memory & System Directives remain cleanly in system messages', () => {
        const query = 'Can they accommodate my diet?';
        const persistentUserMemory = 'User dietary preferences: Strictly gluten-free and vegetarian.';
        const baseSystemDirective = 'You are Jarvis, an intelligent personal AI assistant.';

        const context = engine.buildMultiTierContext({
            message: query,
            systemPrompt: `${baseSystemDirective}\n\n[Saved User Memory & Profile:\n${persistentUserMemory}]`,
            maxRecentTurns: 8
        });

        // System message has memory + milestones + retrieved context
        const systemMsg = context.structuredMessages[0];
        assert.equal(systemMsg.role, 'system');
        assert.ok(systemMsg.content.includes('gluten-free'), 'System message must include persistent memory');
        assert.ok(systemMsg.content.includes('Milestone Summary'), 'System message must include Tier 3 milestones');

        // Last message has unchanged user text with pronoun "they" intact
        const userMsg = context.structuredMessages.at(-1);
        assert.equal(userMsg.role, 'user');
        assert.equal(userMsg.content, 'Can they accommodate my diet?', 'Pronoun "they" must NOT be rewritten');
    });
});
