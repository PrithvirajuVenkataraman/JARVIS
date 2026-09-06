import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createConversationEngine,
    retrievePastTurns,
    extractRollingExecutiveSummary,
    buildMultiTierContext,
    textToEmbeddingVector
} from '../app/context-engine.js';
import chatHandler from '../api/chat-groq.js';

function okJson(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json' }
    });
}

function mockRequest(url, body) {
    return {
        url,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body
    };
}

async function callHandler(handler, req) {
    let statusCode = 200;
    const responseHeaders = {};
    let responseBody = null;

    const res = {
        status(code) {
            statusCode = code;
            return this;
        },
        setHeader(name, val) {
            responseHeaders[name] = val;
        },
        json(payload) {
            responseBody = payload;
            return this;
        },
        end(data) {
            if (data && !responseBody) {
                try { responseBody = JSON.parse(data); } catch (_) { responseBody = data; }
            }
            return this;
        }
    };

    await handler(req, res);
    return { statusCode, headers: responseHeaders, body: responseBody };
}

test('ChatGPT-Grade Context Architecture Suite', async (t) => {
    await t.test('1. Deep Conversational Retention across 30+ turns', () => {
        const engine = createConversationEngine({ maxTurns: 200 });
        const threadId = 'japan_trip_thread';

        engine.recordTurn({ role: 'user', text: 'I am planning a trip to Kyoto in October and my budget is strictly $1500.', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Kyoto in October is wonderful for autumn foliage. With a $1500 budget, we will focus on affordable ryokans and rail passes.', threadId });

        const fillerTopics = [
            ['What are the best temples to visit?', 'Kinkaku-ji, Fushimi Inari-taisha, and Kiyomizu-dera are iconic.'],
            ['Should I get a JR Pass?', 'For travel within Kansai, a regional Kansai pass is more economical than the nationwide JR pass.'],
            ['What local food should I try?', 'Try Kaiseki dining, matcha desserts in Uji, and Yudofu tofu stew.'],
            ['How do I get around the city?', 'Kyoto has an extensive bus network and subway lines. IC cards like ICOCA work everywhere.'],
            ['What should I pack for October weather?', 'Light layers, a jacket for cool evenings, and comfortable walking shoes.'],
            ['Can you suggest photography spots?', 'Arashiyama bamboo grove early in the morning and Gion at dusk are fantastic.'],
            ['Are there any good day trips?', 'Nara for the deer park and Todai-ji, or Osaka for street food in Dotonbori.'],
            ['Do I need to carry cash?', 'Yes, many traditional shops, shrines, and small restaurants in Kyoto remain cash-only.'],
            ['What are some basic Japanese etiquette tips?', 'Remove shoes when entering traditional accommodations and avoid walking while eating.'],
            ['Where can I experience a traditional tea ceremony?', 'En Tea House near Gion offers welcoming, English-friendly tea ceremonies.'],
            ['Is pocket Wi-Fi or an eSIM better?', 'An eSIM is usually cheaper and more convenient if your phone is unlocked.'],
            ['What souvenir should I bring back?', 'Yatsuhashi sweets and handmade ceramics from Kiyomizu pottery shops.']
        ];

        for (const [u, a] of fillerTopics) {
            engine.recordTurn({ role: 'user', text: u, threadId });
            engine.recordTurn({ role: 'assistant', text: a, threadId });
        }

        const state = engine.getState();
        assert.equal(state.turns.length, 26);
        assert.ok(state.turns[0].embedding instanceof Float32Array, 'Turn 1 must have an embedding stored');
    });

    await t.test('2. Tier 2 In-Session Semantic Retrieval at Turn 28 (recalls Turn 1-2 outside verbatim window)', () => {
        const engine = createConversationEngine({ maxTurns: 200 });
        const threadId = 'japan_trip_thread';

        engine.recordTurn({ role: 'user', text: 'I am planning a trip to Kyoto in October and my budget is strictly $1500.', threadId, id: 'turn_1' });
        engine.recordTurn({ role: 'assistant', text: 'Kyoto in October is wonderful. With a $1500 budget, we will budget carefully.', threadId, id: 'turn_2' });

        const fillerTopics = [
            ['What are the best temples?', 'Kinkaku-ji and Fushimi Inari.'],
            ['Should I get a JR Pass?', 'A Kansai pass is better.'],
            ['What local food should I try?', 'Kaiseki and matcha.'],
            ['How do I get around?', 'Bus network and subway.'],
            ['What should I pack?', 'Light layers and jacket.'],
            ['Can you suggest photo spots?', 'Arashiyama and Gion.'],
            ['Any day trips?', 'Nara and Osaka.'],
            ['Carry cash?', 'Yes, shrines need cash.'],
            ['Japanese etiquette?', 'Remove shoes inside.'],
            ['Tea ceremony?', 'En Tea House near Gion.'],
            ['eSIM or Wi-Fi?', 'eSIM is cheaper.'],
            ['Souvenirs?', 'Yatsuhashi sweets.']
        ];

        for (let i = 0; i < fillerTopics.length; i++) {
            const [u, a] = fillerTopics[i];
            engine.recordTurn({ role: 'user', text: u, threadId, id: `turn_${3 + i * 2}` });
            engine.recordTurn({ role: 'assistant', text: a, threadId, id: `turn_${4 + i * 2}` });
        }

        const query = 'Remind me, what did I say earlier my budget was?';
        const context = engine.buildMultiTierContext({
            message: query,
            maxRecentTurns: 8,
            topK: 2
        });

        assert.equal(context.recentTurns.length, 8);
        const recentTexts = context.recentTurns.map(t => t.text).join(' ');
        assert.ok(!recentTexts.includes('$1500'), 'Active verbatim window should NOT contain Turn 1');

        assert.ok(context.retrievedTurns.length > 0, 'Should have retrieved older turns');
        const retrievedTexts = context.retrievedTurns.map(t => t.text).join(' ');
        assert.match(retrievedTexts, /\$1500|budget/i, 'Retrieved turns must contain the earlier budget statement');
    });

    await t.test('3. Tier 3 Rolling Milestone Summarization tracks constraints and decisions', () => {
        const engine = createConversationEngine({ maxTurns: 200 });
        const threadId = 'milestone_thread';

        engine.recordTurn({ role: 'user', text: 'We must keep total budget under $2000 and we prefer vegan restaurants.', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Noted: Budget capped at $2000 and strictly vegan options.', threadId });
        engine.recordTurn({ role: 'user', text: 'We finalized the destination as Barcelona for July.', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Barcelona in July confirmed. Let us map out Gothic Quarter hotels.', threadId });

        for (let i = 0; i < 5; i++) {
            engine.recordTurn({ role: 'user', text: `Question ${i} about museum hours`, threadId });
            engine.recordTurn({ role: 'assistant', text: `Museum ${i} is open 9am to 6pm`, threadId });
        }

        const summary = extractRollingExecutiveSummary(engine.getState().turns);
        assert.ok(summary.constraints.length > 0, 'Must extract constraints');
        const constraintText = summary.constraints.join(' ');
        assert.match(constraintText, /budget|under|prefer|vegan/i, 'Constraints must reflect budget and preferences');

        const decisionText = summary.decisions.join(' ');
        assert.match(decisionText, /barcelona|destination|july/i, 'Decisions must capture destination selection');
    });

    await t.test('4. Deep Anaphora Resolution across 3-4 turns', () => {
        const engine = createConversationEngine({ maxTurns: 200 });
        const threadId = 'anaphora_thread';

        engine.recordTurn({ role: 'user', text: 'Tell me about Mount Fuji.', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Mount Fuji is an active stratovolcano located on the island of Honshu.', threadId });
        engine.recordTurn({ role: 'user', text: 'Is it visible from Tokyo?', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Yes, on clear days, especially during winter mornings, it can be seen from high observation decks in Tokyo.', threadId });

        const resolved = engine.resolveFollowUp('What is its elevation?');
        assert.match(resolved, /Mount Fuji/i, 'Pronoun "its" should be resolved to Mount Fuji across multiple turns');
    });

    await t.test('5. Clean Unpolluted User Message in Structured Messages', () => {
        const engine = createConversationEngine({ maxTurns: 200 });
        const threadId = 'clean_prompt_thread';

        engine.recordTurn({ role: 'user', text: 'Hello, I want to learn rust programming.', threadId });
        engine.recordTurn({ role: 'assistant', text: 'Rust is great for systems programming with memory safety guarantees.', threadId });

        const systemDirective = 'You are a helpful coding assistant. Maintain concise answers.';
        const userPrompt = 'How do ownership and borrowing work?';

        const multiTier = engine.buildMultiTierContext({
            message: userPrompt,
            systemPrompt: systemDirective,
            maxRecentTurns: 6
        });

        const messages = multiTier.structuredMessages;
        assert.ok(Array.isArray(messages));
        assert.ok(messages.length >= 3);

        assert.equal(messages[0].role, 'system');
        assert.match(messages[0].content, /helpful coding assistant/);

        const lastMsg = messages[messages.length - 1];
        assert.equal(lastMsg.role, 'user');
        assert.equal(lastMsg.content, userPrompt);
        assert.ok(!lastMsg.content.includes('Response length requested:'));
        assert.ok(!lastMsg.content.includes('Style requirements:'));
    });

    await t.test('6. API Handler Integration with Structured Messages and Multi-Tier Context', async () => {
        const ORIGINAL_FETCH = globalThis.fetch;
        process.env.GROQ_API_KEY = 'test-groq-key';

        let receivedMessages = null;
        globalThis.fetch = async (url, init) => {
            const href = String(url);
            if (href.includes('api.groq.com')) {
                const body = JSON.parse(String(init?.body || '{}'));
                receivedMessages = body?.messages;
                return okJson({
                    choices: [{
                        message: {
                            role: 'assistant',
                            content: 'Your earlier budget was $1500 for the Kyoto trip in October.'
                        }
                    }]
                });
            }
            throw new Error(`unexpected fetch: ${href}`);
        };

        try {
            const structuredChat = [
                { role: 'system', content: 'You are Jarvis, a helpful assistant.\n\n[Retrieved Context:\nUser: My budget is strictly $1500.]' },
                { role: 'user', content: 'What temples should I visit?' },
                { role: 'assistant', content: 'Kinkaku-ji and Fushimi Inari.' },
                { role: 'user', content: 'What was my budget again?' }
            ];

            const res = await callHandler(chatHandler, mockRequest('/api/chat-groq', {
                message: 'What was my budget again?',
                structuredMessages: structuredChat,
                retrievedTurns: [{ role: 'user', text: 'My budget is strictly $1500.' }],
                rollingSummary: 'Budget: $1500; Destination: Kyoto in October'
            }));

            assert.equal(res.statusCode, 200);
            assert.match(res.body.response, /\$1500/);
            assert.ok(Array.isArray(receivedMessages), 'Groq must receive structured messages array');
            assert.equal(receivedMessages[0].role, 'system');
            assert.match(receivedMessages[0].content, /\$1500/);
            assert.equal(receivedMessages[receivedMessages.length - 1].role, 'user');
        } finally {
            globalThis.fetch = ORIGINAL_FETCH;
            delete process.env.GROQ_API_KEY;
        }
    });
});
